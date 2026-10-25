export function normalizedEvidenceQuote(text) {
  return String(text||'').toLocaleLowerCase().normalize('NFKC')
    // OCR in older scans often substitutes the multi-purpose glyph Ɵ for “ti”.
    .replace(/[Ɵɵ]/g,'ti')
    .replace(/[^\p{L}\p{N}]+/gu,' ').trim();
}
export function completeEvidenceAnchor(text,quote,max=320) {
  const content=String(text||'').replace(/\s+/g,' ').trim();
  const target=normalizedEvidenceQuote(quote);
  if(!target)return quote;
  const boundary=/[.!?](?:["'’”)}\]]*)(?=\s|$)/g;
  let start=0,match;
  while((match=boundary.exec(content))) {
    const end=boundary.lastIndex;
    const sentence=content.slice(start,end).trim();
    if(sentence&&normalizedEvidenceQuote(sentence).includes(target))
      return sentence.length<=max?sentence:quote;
    start=end;
  }
  const tail=content.slice(start).trim();
  if(tail&&normalizedEvidenceQuote(tail).includes(target))
    return tail.length<=max?tail:quote;
  return quote;
}
export function verifiedEvidenceQuote(quote,text,{maxInputLength=2000,maxAnchorLength=220}={}) {
  const supplied=String(quote||'').trim();
  const normalized=normalizedEvidenceQuote(supplied);
  const source=String(text||'');
  const normalizedSource=normalizedEvidenceQuote(source);
  // Verify the entire reviewer quote against this source before deriving a
  // short, contiguous source anchor for the evidence map.
  if(supplied.length<12||supplied.length>maxInputLength||normalized.length<12||
    !normalizedSource.includes(normalized))return null;
  let bounded=supplied;
  if(bounded.length>maxAnchorLength){
    const sentences=bounded.match(/[^.!?]+[.!?]+|[^.!?]+$/gu)||[];
    const sentence=sentences.map(value=>value.trim()).find(value=>
      value.length>=12&&value.length<=maxAnchorLength&&
      normalizedSource.includes(normalizedEvidenceQuote(value)));
    if(sentence)bounded=sentence;
    else{
      const words=[...bounded.matchAll(/[\p{L}\p{N}]+(?:[’'\-][\p{L}\p{N}]+)*/gu)];
      let exact='';
      for(let count=words.length;count>0;count--){
        const end=words[count-1].index+words[count-1][0].length;
        const candidate=bounded.slice(0,end).trim();
        if(candidate.length<=maxAnchorLength&&candidate.length>=12&&
          normalizedSource.includes(normalizedEvidenceQuote(candidate))){
          exact=candidate;break;
        }
      }
      if(!exact)return null;
      bounded=exact;
    }
  }
  return {quote:bounded,anchorQuote:completeEvidenceAnchor(source,bounded)};
}
