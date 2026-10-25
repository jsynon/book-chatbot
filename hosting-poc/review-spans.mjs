const DEFAULT_MAX_SPAN_LENGTH=220;
const MIN_SPAN_LENGTH=12;

function trimRange(text,start,end){
  while(start<end&&/\s/u.test(text[start]))start++;
  while(end>start&&/\s/u.test(text[end-1]))end--;
  return {start,end,text:text.slice(start,end)};
}

function sentenceRanges(text){
  const ranges=[];
  const pattern=/[^.!?]+[.!?]+["'’”)}\]]*|[^.!?]+$/gu;
  for(const match of text.matchAll(pattern)){
    const range=trimRange(text,match.index,match.index+match[0].length);
    if(range.text)ranges.push(range);
  }
  return ranges;
}

function splitLongRange(text,range,maxLength){
  const output=[];let start=range.start;
  while(start<range.end){
    let end=Math.min(start+maxLength,range.end);
    if(end<range.end){
      const boundary=text.lastIndexOf(' ',end);
      if(boundary>start+Math.floor(maxLength*.55))end=boundary;
    }
    const chunk=trimRange(text,start,end);
    if(chunk.text.length>=MIN_SPAN_LENGTH)output.push(chunk);
    start=end;
  }
  return output;
}

/**
 * Build deterministic, verbatim evidence choices from source text. IDs are
 * local to one source and every span is a contiguous slice of that text.
 */
export function buildReviewSpans(sourceId,text,{maxSpanLength=DEFAULT_MAX_SPAN_LENGTH}={}){
  const source=String(text||'');
  if(!/^S[1-9]\d*$/.test(String(sourceId))||!Number.isInteger(maxSpanLength)||
    maxSpanLength<MIN_SPAN_LENGTH) return [];
  const ranges=sentenceRanges(source),spans=[];let pending=null;
  const flush=()=>{if(pending){spans.push(pending);pending=null;}};
  for(const range of ranges){
    if(range.text.length>maxSpanLength){
      flush();spans.push(...splitLongRange(source,range,maxSpanLength));continue;
    }
    if(pending&&range.start-pending.end<=2&&range.end-pending.start<=maxSpanLength){
      pending=trimRange(source,pending.start,range.end);continue;
    }
    flush();
    if(range.text.length<MIN_SPAN_LENGTH&&spans.length){
      const previous=spans.at(-1);
      if(range.start-previous.end<=2&&range.end-previous.start<=maxSpanLength){
        spans[spans.length-1]=trimRange(source,previous.start,range.end);continue;
      }
    }
    pending=range;
  }
  flush();
  return spans.filter(span=>span.text.length>=MIN_SPAN_LENGTH).map((span,index)=>({
    spanId:`${sourceId}-Q${index+1}`,start:span.start,end:span.end,text:span.text
  }));
}
