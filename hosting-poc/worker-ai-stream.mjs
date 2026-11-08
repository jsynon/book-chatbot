/* Buffered SSE adapter for the evaluation-only Workers AI transport test.
 * The caller receives a normal completed response object; no partial answer
 * can leave the Worker. Prompts and model inputs are preserved verbatim apart
 * from `stream: true`.
 */

function adapterError(message,code,stage){
  return Object.assign(new Error(message),{code,stage});
}

function eventText(event){
  if(typeof event?.response==='string')return event.response;
  const content=event?.choices?.[0]?.delta?.content;
  if(typeof content==='string')return content;
  if(Array.isArray(content))return content.map(part=>typeof part?.text==='string'?part.text:'').join('');
  return '';
}

function updateUsage(previous,next){
  if(!next||typeof next!=='object')return previous;
  const recognized=['neurons','prompt_tokens','completion_tokens','total_tokens'];
  const usage={...(previous||{})};
  let found=false;
  for(const key of recognized){
    if(Number.isFinite(next[key])){usage[key]=next[key];found=true;}
  }
  return found?usage:previous;
}

async function consumeSse(reader,diagnostics,onText){
  const decoder=new TextDecoder();
  let buffer='',eventData=[],response='',finishReason=null,usage=null,doneMarker=false;
  const consumeEvent=raw=>{
    if(!raw)return;
    if(raw==='[DONE]'){doneMarker=true;return;}
    let event;
    try{event=JSON.parse(raw);}
    catch{throw adapterError('Workers AI returned malformed SSE JSON.','stream-output-invalid',diagnostics.stage);}
    if(event?.error){
      throw adapterError('Workers AI stream returned an error event.','stream-provider-error',diagnostics.stage);
    }
    const text=eventText(event);
    response+=text;
    if(text)onText?.(response);
    if(text){diagnostics.textEvents++;diagnostics.responseCharacters+=text.length;}
    const choice=event?.choices?.[0];
    if(typeof choice?.finish_reason==='string')finishReason=choice.finish_reason;
    usage=updateUsage(usage,event?.usage);
  };
  const consumeLine=line=>{
    if(line===''){
      if(eventData.length)consumeEvent(eventData.join('\n'));
      eventData=[];
      return;
    }
    if(line.startsWith(':'))return;
    const separator=line.indexOf(':');
    const field=separator<0?line:line.slice(0,separator);
    if(field!=='data')return;
    let value=separator<0?'':line.slice(separator+1);
    if(value.startsWith(' '))value=value.slice(1);
    eventData.push(value);
  };
  while(true){
    const {value,done}=await reader.read();
    if(value&&diagnostics.firstChunkMs===null)
      diagnostics.firstChunkMs=Date.now()-diagnostics.startedAt;
    buffer+=done?decoder.decode():decoder.decode(value,{stream:true});
    let newline;
    while((newline=buffer.indexOf('\n'))>=0){
      let line=buffer.slice(0,newline);
      buffer=buffer.slice(newline+1);
      if(line.endsWith('\r'))line=line.slice(0,-1);
      consumeLine(line);
    }
    if(done)break;
  }
  if(buffer)consumeLine(buffer.endsWith('\r')?buffer.slice(0,-1):buffer);
  if(eventData.length)consumeEvent(eventData.join('\n'));
  if(!response.trim())
    throw adapterError('Workers AI stream returned no text.','stream-output-invalid',diagnostics.stage);
  diagnostics.finishReason=finishReason;
  diagnostics.completionSignal=finishReason?'finish-reason':doneMarker?'done-marker':'stream-eof';
  diagnostics.usageAvailable=Boolean(usage);
  return {response,choices:[{finish_reason:finishReason}],...(usage?{usage}:{})};
}

/**
 * Run one Workers AI call in streaming mode, buffer it to completion, and
 * enforce the same per-stage deadline as the existing non-streaming path.
 * A completed local stream cancellation is recorded separately from provider
 * inference cancellation, which is not observable through this binding API.
 */
export async function runWorkersAiStream(ai,model,request,{timeoutMs,stage}={}){
  const startedAt=Date.now();
  let timer,reader,stream,timedOut=false,finished=false,cancelTask=Promise.resolve();
  let partialResponse='';
  const diagnostics={transport:'streaming-buffered',stage,timeoutMs,
    startedAt,firstChunkMs:null,textEvents:0,responseCharacters:0,
    completionSignal:null,finishReason:null,usageAvailable:false,
    timeoutFired:false,cancelRequested:false,cancelSettled:false,
    cancelOutcome:'not-requested',cancelElapsedMs:null,
    retrySafe:null,providerInferenceCancellation:'unconfirmed',elapsedMs:null};
  const timeoutError=adapterError('Inference deadline exceeded.','inference-deadline-exceeded',stage);
  timeoutError.timeoutMs=timeoutMs;
  let sourcePromise;
  const work=Promise.resolve().then(()=>{
    sourcePromise=Promise.resolve(ai.run(model,{...request,stream:true})).catch(error=>{
      if(!timedOut){
        diagnostics.retrySafe=true;
        diagnostics.timeoutClassification='provider-terminal-failure';
        diagnostics.providerInferenceCancellation='provider-rejected';
      }
      throw error;
    });
    return sourcePromise;
  }).then(async result=>{
    stream=result;
    if(timedOut){
      cancelTask=Promise.resolve(stream.cancel(timeoutError)).then(()=>{
        diagnostics.cancelSettled=true;diagnostics.cancelOutcome='acknowledged';
      },()=>{diagnostics.cancelOutcome='rejected';});
      await cancelTask;
      throw timeoutError;
    }
    if(!stream||typeof stream.getReader!=='function')
      throw adapterError('Workers AI streaming did not return a readable stream.','stream-output-invalid',stage);
    reader=stream.getReader();
    try{
      const response=await consumeSse(reader,diagnostics,value=>{partialResponse=value;});
      if(timedOut){await cancelTask;throw timeoutError;}
      finished=true;
      diagnostics.elapsedMs=Date.now()-startedAt;
      diagnostics.retrySafe=false;
      diagnostics.providerInferenceCancellation='completed-normally';
      return {response,diagnostics};
    }catch(error){
      if(timedOut){await cancelTask;throw timeoutError;}
      diagnostics.elapsedMs=Date.now()-startedAt;
      throw error;
    }finally{
      try{reader.releaseLock();}catch{}
    }
  });
  const deadline=new Promise((_,reject)=>{
    timer=setTimeout(async()=>{
      if(finished)return;
      timedOut=true;
      diagnostics.timeoutFired=true;
      diagnostics.timeoutAtMs=Date.now()-startedAt;
      diagnostics.cancelRequested=true;
      diagnostics.cancelRequestedAtMs=Date.now()-startedAt;
      if(partialResponse)timeoutError.partialResponse=partialResponse;
      try{
        const cancel=reader?reader.cancel(timeoutError):stream?
          stream.cancel(timeoutError):sourcePromise?.then(value=>value.cancel(timeoutError));
        cancelTask=Promise.resolve(cancel).then(()=>{
          diagnostics.cancelSettled=true;
          diagnostics.cancelOutcome='acknowledged';
          diagnostics.cancelElapsedMs=Date.now()-startedAt-diagnostics.cancelRequestedAtMs;
        },()=>{
          diagnostics.cancelOutcome='rejected';
          diagnostics.cancelElapsedMs=Date.now()-startedAt-diagnostics.cancelRequestedAtMs;
        });
        const confirmed=await Promise.race([cancelTask.then(()=>diagnostics.cancelSettled),
          new Promise(resolve=>setTimeout(()=>resolve(false),500))]);
        if(confirmed){
          // The reader acknowledged only local cancellation. The provider
          // may still be computing, so replay could duplicate billable work.
          diagnostics.retrySafe=false;
          diagnostics.timeoutClassification='local-cancel-ack-provider-unconfirmed';
          reject(timeoutError);
        }else{
          diagnostics.retrySafe=false;
          diagnostics.timeoutClassification='cancel-unconfirmed';
          const error=adapterError('Inference timed out and stream cancellation was not confirmed.',
            'inference-cancel-unconfirmed',stage);
          error.timeoutMs=timeoutMs;
          if(partialResponse)error.partialResponse=partialResponse;
          error.streamDiagnostics=diagnostics;
          reject(error);
        }
      }catch{
        diagnostics.cancelOutcome='rejected';
        diagnostics.retrySafe=false;
        diagnostics.timeoutClassification='cancel-unconfirmed';
        const error=adapterError('Inference timed out and stream cancellation was not confirmed.',
          'inference-cancel-unconfirmed',stage);
        error.timeoutMs=timeoutMs;
        if(partialResponse)error.partialResponse=partialResponse;
        error.streamDiagnostics=diagnostics;
        reject(error);
      }
    },timeoutMs);
  });
  try{return await Promise.race([work,deadline]);}
  catch(error){
    diagnostics.elapsedMs=Date.now()-startedAt;
    if(!error.streamDiagnostics)error.streamDiagnostics=diagnostics;
    throw error;
  }finally{clearTimeout(timer);}
}
