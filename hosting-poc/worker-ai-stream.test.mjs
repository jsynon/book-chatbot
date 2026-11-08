import test from 'node:test';
import assert from 'node:assert/strict';
import {runWorkersAiStream} from './worker-ai-stream.mjs';
import {parseReviewJson} from './evidence-answer.mjs';

function stream(chunks,{cancel}={}){
  let index=0;
  return new ReadableStream({
    pull(controller){
      if(index>=chunks.length){controller.close();return;}
      controller.enqueue(chunks[index++]);
    },cancel
  });
}
function sseDelta(text){
  return [...text].map(value=>'data: '+JSON.stringify({choices:[{delta:{content:value}}]})+'\r\n\r\n').join('')+
    'data: '+JSON.stringify({choices:[{finish_reason:'stop',delta:{}}],usage:{
      prompt_tokens:13,completion_tokens:21,total_tokens:34,neurons:0.75}})+'\r\n\r\n'+
    'data: [DONE]\r\n\r\n';
}

test('streams fragmented UTF-8 SSE into the current parser shape with usage metadata',async()=>{
  const expected=JSON.stringify({claims:[],parts:[],note:'Kierkegaard — 信仰 📚'});
  const wire=new TextEncoder().encode(sseDelta(expected));
  const pieces=[...wire].map(value=>Uint8Array.of(value));
  const ai={run:async(_model,request)=>{
    assert.equal(request.stream,true);
    return stream(pieces);
  }};
  const result=await runWorkersAiStream(ai,'@cf/google/gemma-4-26b-a4b-it',{
    messages:[{role:'system',content:'same request'}],max_completion_tokens:3000
  },{timeoutMs:1000,stage:'review'});
  assert.deepEqual(parseReviewJson(result.response),parseReviewJson({response:expected}));
  assert.deepEqual(result.response.usage,{prompt_tokens:13,completion_tokens:21,total_tokens:34,neurons:0.75});
  assert.equal(result.diagnostics.completionSignal,'finish-reason');
  assert.equal(result.diagnostics.usageAvailable,true);
  assert.equal(result.diagnostics.cancelOutcome,'not-requested');
  assert.equal(result.diagnostics.providerInferenceCancellation,'completed-normally');
});

test('accepts native Workers AI response chunks without inventing usage values',async()=>{
  const expected='{"claims":[],"parts":[]}';
  const wire='data: '+JSON.stringify({response:expected})+'\n\n';
  const result=await runWorkersAiStream({run:async()=>stream([
    new TextEncoder().encode(wire)
  ])},'same-model',{messages:[]},{timeoutMs:1000,stage:'review'});
  assert.deepEqual(parseReviewJson(result.response),{claims:[],parts:[]});
  assert.equal(result.response.usage,undefined);
  assert.equal(result.diagnostics.usageAvailable,false);
  assert.equal(result.diagnostics.completionSignal,'stream-eof');
});

test('malformed stream output fails closed',async()=>{
  await assert.rejects(runWorkersAiStream({run:async()=>stream([
    new TextEncoder().encode('data: {bad-json}\n\n')
  ])},'same-model',{messages:[]},{timeoutMs:1000,stage:'review'}),
  error=>error.code==='stream-output-invalid');
  await assert.rejects(runWorkersAiStream({run:async()=>stream([
    new TextEncoder().encode('data: [DONE]\n\n')
  ])},'same-model',{messages:[]},{timeoutMs:1000,stage:'review'}),
  error=>error.code==='stream-output-invalid');
});

test('deadline asks the source stream to cancel and waits for its acknowledgement',async()=>{
  const order=[];
  const ai={run:async()=>new ReadableStream({
    async cancel(){
      order.push('cancel-start');
      await new Promise(resolve=>setTimeout(resolve,15));
      order.push('cancel-settled');
    }
  })};
  await assert.rejects(runWorkersAiStream(ai,'same-model',{messages:[]},
    {timeoutMs:20,stage:'review'}),error=>{
      assert.equal(error.code,'inference-deadline-exceeded');
      assert.equal(error.streamDiagnostics.cancelOutcome,'acknowledged');
      assert.equal(error.streamDiagnostics.retrySafe,true);
      assert.equal(error.streamDiagnostics.timeoutClassification,'stream-cancel-acknowledged');
      assert.equal(error.streamDiagnostics.providerInferenceCancellation,'unconfirmed');
      return true;
    });
  assert.deepEqual(order,['cancel-start','cancel-settled']);
});

test('deadline exposes buffered review text for full-contract validation without replay',async()=>{
  const expected=JSON.stringify({claims:[],parts:[]});
  const wire='data: '+JSON.stringify({response:expected})+'\n\n';
  const ai={run:async()=>new ReadableStream({
    start(controller){controller.enqueue(new TextEncoder().encode(wire));},
    cancel(){}
  })};
  await assert.rejects(runWorkersAiStream(ai,'same-model',{messages:[]},
    {timeoutMs:15,stage:'review'}),error=>{
      assert.equal(error.code,'inference-deadline-exceeded');
      assert.equal(error.partialResponse,expected);
      assert.equal(error.streamDiagnostics.cancelOutcome,'acknowledged');
      assert.equal(error.streamDiagnostics.providerInferenceCancellation,'unconfirmed');
      return true;
    });
});

test('unconfirmed cancellation is non-retryable',async()=>{
  let calls=0;
  const ai={run:async()=>{calls++;return new ReadableStream({cancel(){return new Promise(()=>{});}});}};
  await assert.rejects(runWorkersAiStream(ai,'same-model',{messages:[]},
    {timeoutMs:10,stage:'review'}),error=>{
      assert.equal(error.code,'inference-cancel-unconfirmed');
      assert.equal(error.streamDiagnostics.retrySafe,false);
      assert.equal(error.streamDiagnostics.timeoutClassification,'cancel-unconfirmed');
      return true;
    });
  assert.equal(calls,1);
});
