// Keep reviewer spans aligned with the public sentence-anchor ceiling. This
// lets a common long sentence stay intact instead of ending at an arbitrary
// 220-character cutoff that later becomes an awkward citation highlight.
const DEFAULT_MAX_SPAN_LENGTH=320;
// Keep short neighboring sentences grouped as before; only a single longer
// source sentence gets the wider budget, so passage ranking stays granular.
const MAX_MERGED_SPAN_LENGTH=220;
const MIN_SPAN_LENGTH=12;
const REQUIRED_ANSWER_CANDIDATE_WINDOW=6;

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
  const mergeLimit=Math.min(maxSpanLength,MAX_MERGED_SPAN_LENGTH);
  const ranges=sentenceRanges(source),spans=[];let pending=null;
  const flush=()=>{if(pending){spans.push(pending);pending=null;}};
  for(const range of ranges){
    if(range.text.length>maxSpanLength){
      flush();spans.push(...splitLongRange(source,range,maxSpanLength));continue;
    }
    if(pending&&range.start-pending.end<=2&&range.end-pending.start<=mergeLimit){
      pending=trimRange(source,pending.start,range.end);continue;
    }
    flush();
    if(range.text.length<MIN_SPAN_LENGTH&&spans.length){
      const previous=spans.at(-1);
      if(range.start-previous.end<=2&&range.end-previous.start<=mergeLimit){
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
// These small families help rank ordinary paraphrases and inflections. They
// are ranking hints only: the semantic reviewer still decides support, and
// exact word-form overlap always receives the stronger score. These families
// are read from original tokens so related forms stay easy to audit.
const REVIEW_TERM_FAMILIES=[
  ['complete','completeness','incomplete','incompleteness'],
  ['wealth','wealthy','prosperity','prosperous','riches'],
  ['temporary','temporarily','transient','transitory','impermanent','remain','remains']
];
const REVIEW_TERM_FAMILY_BY_TERM=new Map(REVIEW_TERM_FAMILIES.flatMap(family=>
  family.map(term=>[term,family[0]])));
function reviewTermFamilies(value){
  const terms=String(value||'').normalize('NFKC').toLocaleLowerCase()
    .match(/[\p{L}\p{N}]{3,}/gu)||[];
  return new Set(terms.map(term=>REVIEW_TERM_FAMILY_BY_TERM.get(term)).filter(Boolean));
}
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
  const answerFamilies=reviewTermFamilies(answer),questionFamilies=reviewTermFamilies(question);
  const score=text=>{
    const terms=reviewTerms(text);
    const spanFamilies=reviewTermFamilies(text);
    let value=0;
    for(const term of terms){
      if(answerTerms.has(term))value+=3;
      if(questionTerms.has(term))value+=1;
    }
    // A related form can surface a likely passage in the short hint list, but
    // scores below exact normalized overlap and never grants support.
    for(const family of spanFamilies){
      if(answerFamilies.has(family))value+=2;
      if(questionFamilies.has(family))value+=1;
    }
    return value;
  };
  return spans.map((span,index)=>({span,index,score:score(span.text)}))
    .sort((a,b)=>b.score-a.score||a.index-b.index).map(item=>item.span);
}

/**
 * Keep the review packet small while reserving one missing claim-specific span
 * for the part's required first answer. Broad ranking retains the other slots;
 * the semantic reviewer still decides whether any span supports the claim.
 */
export function selectReviewPacketSpans(spans,{question='',answer='',requiredAnswer='',limit=8}={}){
  if(!Number.isInteger(limit)||limit<0)return [];
  const ranked=rankReviewSpans(spans,{question,answer});
  if(!limit||!requiredAnswer)return ranked.slice(0,limit);
  const packet=ranked.slice(0,limit);
  if(!packet.length)return packet;
  // The whole answer can push the required first-answer passage below the
  // packet cap. If one of its six strongest claim-specific candidates is
  // missing, replace only the packet's last item so seven broad slots remain.
  const packetIds=new Set(packet.map(span=>span.spanId));
  const requiredCandidate=rankReviewSpans(spans,{question,answer:requiredAnswer})
    .slice(0,REQUIRED_ANSWER_CANDIDATE_WINDOW)
    .find(span=>!packetIds.has(span.spanId));
  if(!requiredCandidate)return packet;
  return [...packet.slice(0,-1),requiredCandidate];
}
