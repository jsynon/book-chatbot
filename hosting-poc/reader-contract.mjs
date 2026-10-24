// Browser/Worker/evaluator contract. Keep frontend and Worker copies byte-identical.
export const CONTRACT_VERSION='reader-evidence-v2';
export const RETRIEVAL_LIMIT=12;
export function citationIds(text){
  return [...new Set([...String(text||'').matchAll(/\[([^\]]+)\]/g)]
    .flatMap(match=>match[1].match(/\bS\d+\b/g)||[]))];
}
export function catalogIdentity(title){
  const [work,...rest]=String(title||'').split(/\s+[—–]\s+/);
  const byline=rest.join(' ');
  const editor=byline.match(/\b(?:edited|translated) by\s+([^)]*)/i)?.[1]?.trim()||'';
  const author=byline.replace(/\([^)]*\)/g,'').replace(/\b(?:edited|translated) by\b.*$/i,'').trim();
  const aliases=[work,...[...work.matchAll(/\(([^)]+)\)/g)].map(m=>m[1]),
    work.replace(/\([^)]*\)/g,'').trim(),...work.split(':').slice(1)];
  return {work,authors:author.split(/\s+and\s+/i).filter(Boolean),editors:editor?[editor]:[],
    aliases:[...new Set(aliases.flatMap(v=>{const clean=v.trim();return [clean,clean.replace(/^(the|a|an)\s+/i,'').trim()];}).filter(v=>v.length>=4))]};
}
export function normalizeQuote(text){
  return String(text||'').normalize('NFKC').replace(/[’‘]/g,"'").replace(/[“”]/g,'"')
    .replace(/\s+/g,' ').trim();
}
export function quotations(text){
  // Single quotes must begin at a word boundary, so possessives are not quotes.
  return [...String(text||'').matchAll(/“([^”]+)”|"([^"\n]+)"|‘([^’]+)’|(?<![\p{L}\p{N}])'([^'\n]+)'(?![\p{L}\p{N}])/gu)]
    .map(m=>({text:m[1]||m[2]||m[3]||m[4],start:m.index,end:m.index+m[0].length}));
}
export function auditFinalAnswer(answer,sources){
  const byId=new Map(sources.map(s=>[s.id,s]));
  const ids=citationIds(answer),unknownIds=ids.filter(id=>!byId.has(id));
  const quoteFailures=[];
  for(const quote of quotations(answer)){
    // Bind to the first following citation group in this sentence/paragraph.
    // Do not allow an unrelated quote anywhere in the packet to validate it.
    const tail=answer.slice(quote.end);
    const next=tail.match(/^[^\n.!?]*(?:[.!?]\s*)?(\[\s*S\d+(?:\s*,\s*S\d+)*\s*\])/);
    const ownIds=next?citationIds(next[1]):[];
    if(!ownIds.length||!ownIds.some(id=>normalizeQuote(byId.get(id)?.text??byId.get(id)?.preview)
      .includes(normalizeQuote(quote.text))))quoteFailures.push({...quote,sourceIds:ownIds});
  }
  return {ok:!unknownIds.length&&!quoteFailures.length,ids,unknownIds,quoteFailures};
}
export function normalizePlan(raw,question,catalog={},selectedBookId=''){
  const bounded=(v,max)=>typeof v==='string'?v.trim().slice(0,max):'';
  const resolvedQuestion=bounded(raw?.resolvedQuestion,600)||question;
  const entities=Array.isArray(raw?.sources)?raw.sources.filter(s=>s&&typeof s==='object'&&!Array.isArray(s)).slice(0,8):[];
  const sources=entities.map(s=>({label:bounded(s.label,120),role:['primary','subject','commentary'].includes(s.role)?s.role:'primary',
    bookIds:[...new Set((Array.isArray(s.bookIds)?s.bookIds:[]).map(String).filter(id=>Object.hasOwn(catalog,id)))]}));
  if(selectedBookId)sources.splice(0,sources.length,{label:catalog[selectedBookId],role:'primary',bookIds:[selectedBookId]});
  const parts=(Array.isArray(raw?.parts)?raw.parts:[]).slice(0,6).map((p,i)=>({id:'P'+(i+1),question:bounded(typeof p==='string'?p:p?.question,240)})).filter(p=>p.question);
  return {version:CONTRACT_VERSION,resolvedQuestion,intent:['explain','compare','interpret','locate'].includes(raw?.intent)?raw.intent:'explain',
    sources,parts:parts.length?parts:[{id:'P1',question}],scope:bounded(raw?.scope,200),
    clarification:bounded(raw?.clarification,240),queries:Array.isArray(raw?.queries)?raw.queries.slice(0,4).map(q=>bounded(q,160)).filter(Boolean):[]};
}
export async function fetchWithDeadline(fetcher,url,options={},timeoutMs=30000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(new Error('Request deadline exceeded')),timeoutMs);
  const onAbort=()=>controller.abort(options.signal.reason);
  if(options.signal?.aborted)onAbort();
  else options.signal?.addEventListener('abort',onAbort,{once:true});
  try{return await fetcher(url,{...options,signal:controller.signal});}
  finally{clearTimeout(timer);options.signal?.removeEventListener('abort',onAbort);}
}
