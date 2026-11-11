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

const HEADING_FUNCTION_WORDS=new Set(('a an the of to in on for and or but by with from at as per via upon among between is are was were').split(' '));
/**
 * Deterministic heading-shape test for a single span. Sentence-splitting
 * turns a book's heading lines into selectable "sentences" ("Relation of
 * the Baptist to Elijah."), and a heading span can then be accepted as a
 * claim's quote and surface as its highlight. A span is heading-only when
 * it is a single short line whose content words are all capitalized (a
 * title), or a chapter/section opener: a "Chap. XXVII.—" prefix glued to
 * its title by a dash is structural and decisive, and a chapter/numbered
 * prefix leaves a remainder that must still pass the title test. A
 * lowercase verb-bearing sentence never classifies: any lowercase content
 * word (a verb, a common noun, an adjective) marks sentence flow.
 */
export function isHeadingLine(text){
  const value=String(text||'').trim();
  if(!value||/[\r\n]/u.test(value))return false;
  const wordsOf=s=>s.split(/\s+/u).filter(Boolean);
  if(wordsOf(value).length>14)return false;
  // Chapter opener glued to its title by a dash ("Chap. XXVII.—How
  // little the precepts…"): body prose does not open this way.
  if(/^(?:chapter|chap\.?)\s+(?:[IVXLCDM]+|\d+)\.?\s*[—–]/iu.test(value))return true;
  // Batch 9 (B9-7b): a bare structural marker line ("CHAPTER VII.") is
  // a heading by itself — the prefix rule below consumes the whole
  // line and leaves nothing to test, so it never classified before.
  if(/^(?:chapter|chap\.?|book|part|section|appendix)\s+(?:[IVXLCDM]+|\d+)[.:]?$/iu.test(value))return true;
  let rest=value;
  const prefix=value.match(/^(?:(?:chapter|chap\.?|book|part|section|appendix)\s+(?:[IVXLCDM]+|\d+)[.:]?\s+|\d+(?:\.\d+)+\.?\s+|\d+\.\s+)/iu);
  if(prefix)rest=value.slice(prefix[0].length).trim();
  const words=wordsOf(rest);
  if(!words.length||words.length>9)return false;
  const content=words
    .map(word=>word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu,''))
    .filter(word=>/\p{L}/u.test(word)&&!HEADING_FUNCTION_WORDS.has(word.toLocaleLowerCase()));
  if(!content.length)return false;
  return content.every(word=>/^\p{Lu}/u.test(word));
}

export function isHeadingOnlySpan(text){
  const value=String(text||'').trim();
  if(!value)return false;
  if(!/[\r\n]/u.test(value))return isHeadingLine(value);
  // Batch 9 (B9-7b): multi-line heading blocks. Page text in older
  // scans keeps a heading's lines together in one span ("THE
  // VENERABLE, 27 / CHAPTER VII. / THE VENERABLE (ARHAT)."), and the
  // single-line predicate rejected every multi-line span outright, so
  // these blocks stayed selectable as claim evidence. A multi-line
  // span is heading-only when EVERY non-empty line is a heading line
  // and the block stays short; one substantive line — lowercase
  // content words, a verb, ordinary sentence flow — keeps the whole
  // span body text.
  const lines=value.split(/\r?\n/u).map(line=>line.trim()).filter(Boolean);
  if(lines.length<2)return lines.length===1&&isHeadingLine(lines[0]);
  const totalWords=lines.reduce((sum,line)=>sum+line.split(/\s+/u).filter(Boolean).length,0);
  return totalWords<=28&&lines.every(line=>isHeadingLine(line));
}

export const REVIEW_STOP_WORDS=new Set(('a an and are as at be because been being by can could did do does for from had has have how i in into is it its may might of on or our shall should that the their them then there these they this those to was were what when where which who will with would').split(' '));
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

/**
 * Rank spans for one explicit answer requirement. Only reserve a span when
 * it shares at least one normalized content term with that requirement or its
 * verbatim question anchor; a zero-match span is left to the broad fallback
 * ranking. This is a lexical routing hint, never a support decision.
 */
export function selectRequirementReviewSpans(spans,{requirement='',questionAnchor='',limit=1}={}){
  if(!Number.isInteger(limit)||limit<0||!limit)return [];
  const query=[requirement,questionAnchor].filter(value=>
    typeof value==='string'&&value.trim()).join(' ');
  const terms=reviewTerms(query);
  if(!terms.size)return [];
  return rankReviewSpans(spans,{answer:query}).filter(span=>{
    const spanTerms=reviewTerms(span.text);
    return [...terms].some(term=>spanTerms.has(term));
  }).slice(0,limit);
}
