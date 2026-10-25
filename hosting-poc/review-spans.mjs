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

const REVIEW_STOP_WORDS=new Set(('a an and are as at be because been being by can could did do does for from had has have how i in into is it its may might of on or our shall should that the their them then there these they this those to was were what when where which who will with would').split(' '));
function reviewTerms(value){
  return new Set((String(value||'').normalize('NFKC').toLocaleLowerCase()
    .match(/[\p{L}\p{N}]{3,}/gu)||[]).map(term=>{
      const simple=term.replace(/(?:ing|ed|es|s)$/u,'');
      return simple.length>=3?simple:term;
    }).filter(term=>!REVIEW_STOP_WORDS.has(term)));
}

/**
 * Put likely answer-bearing spans first while preserving every exact span and
 * its stable ID. This helps a bounded reviewer notice direct evidence without
 * turning lexical overlap into a support decision.
 */
export function rankReviewSpans(spans,{question='',answer=''}={}){
  const answerTerms=reviewTerms(answer),questionTerms=reviewTerms(question);
  const score=text=>{
    const terms=reviewTerms(text);
    let value=0;
    for(const term of terms){if(answerTerms.has(term))value+=3;if(questionTerms.has(term))value+=1;}
    return value;
  };
  return spans.map((span,index)=>({span,index,score:score(span.text)}))
    .sort((a,b)=>b.score-a.score||a.index-b.index).map(item=>item.span);
}
