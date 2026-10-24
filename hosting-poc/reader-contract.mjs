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
  const intent=['explain','compare','interpret','locate'].includes(raw?.intent)?raw.intent:'explain';
  const queries=Array.isArray(raw?.queries)?raw.queries.slice(0,4).map(q=>bounded(q,160)).filter(Boolean):[];
  const parts=(Array.isArray(raw?.parts)?raw.parts:[]).slice(0,6).map((p,i)=>({id:'P'+(i+1),question:bounded(typeof p==='string'?p:p?.question,240)})).filter(p=>p.question);
  const normalizedParts=parts.length?parts:[{id:'P1',question}];
  const identityText=value=>String(value||'').normalize('NFKC').toLocaleLowerCase()
    .replace(/[’‘]/g,"'").replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
  const containsPhrase=(haystack,phrase)=>{
    const normalized=identityText(phrase);
    return normalized.length>=4&&(' '+identityText(haystack)+' ').includes(' '+normalized+' ');
  };
  const sourcePhrases=source=>{
    const phrases=[source.label];
    for(const token of String(source.label||'').split(/[^\p{L}\p{N}]+/u))
      if(token.length>=4)phrases.push(token);
    for(const id of source.bookIds){
      const title=catalog[id];if(!title)continue;
      const identity=catalogIdentity(title);
      phrases.push(identity.work,...identity.authors,...identity.authors.map(author=>String(author).split(/\s+/u).at(-1)),...identity.aliases);
    }
    return [...new Set(phrases.map(identityText).filter(value=>value.length>=4))];
  };
  const partSourceGroups=normalizedParts.map(part=>{
    let matches=sources.map((source,index)=>({source,index,phrases:sourcePhrases(source)}))
      .filter(group=>group.phrases.some(phrase=>containsPhrase(part.question,phrase)));
    // For an author asking about another thinker, the answer belongs to the
    // named primary author unless the plan explicitly makes this a comparison.
    if(intent!=='compare'&&matches.length>1){
      const primary=matches.filter(group=>group.source.role==='primary');
      if(primary.length)matches=primary;
    }
    if(!matches.length&&sources.length===1)matches=sources.map((source,index)=>({source,index}));
    if(!matches.length&&intent==='compare'&&sources.length>1)
      matches=sources.map((source,index)=>({source,index}));
    const narrowed=matches.flatMap(group=>{
      const bookIds=group.source.bookIds;
      // A part may name only its author while the original question names a
      // particular work. Honor that explicit title hint when it uniquely
      // identifies one of the author's books in the catalog.
      const titleMatches=bookIds.filter(id=>{
        const title=catalog[id];if(!title)return false;
        const work=catalogIdentity(title).work;
        const titleTokens=work.match(/[\p{Lu}][\p{L}\p{N}]*/gu)||[];
        return titleTokens.some(token=>token.length>=5&&new RegExp('(?:^|[^\\p{L}\\p{N}])'+
          token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?=$|[^\\p{L}\\p{N}])','u').test(resolvedQuestion));
      });
      return titleMatches.length===1?titleMatches:bookIds;
    });
    return narrowed.length?[...new Set(narrowed)]:null;
  });
  const comparisonPattern=/\b(?:compare|contrast|differ(?:s|ed|ence|ent)?|versus|vs\.?|similar(?:ity)?|alike)\b/i;
  const comparisonSources=sources.filter(source=>['primary','subject'].includes(source.role)&&source.bookIds.length);
  const hasPlannedComparison=normalizedParts.some((part,index)=>comparisonPattern.test(part.question)&&
    comparisonSources.filter(source=>source.bookIds.some(id=>(partSourceGroups[index]||[]).includes(id))).length>=2);
  const comparisonBookIds=[...new Set(comparisonSources.flatMap(source=>source.bookIds))];
  if(intent==='compare'&&comparisonPattern.test(resolvedQuestion)&&comparisonSources.length>=2&&
    comparisonBookIds.length>=2&&!hasPlannedComparison){
    normalizedParts.push({id:'P'+(normalizedParts.length+1),
      question:bounded('How do the named sources compare in response to this question: '+resolvedQuestion,240)});
    partSourceGroups.push(comparisonBookIds);
  }
  const partsWithSources=normalizedParts.map((part,index)=>{
    const allowedIds=partSourceGroups[index]||[];
    const allowedSourceIndexes=sources.map((source,sourceIndex)=>source.bookIds.some(id=>allowedIds.includes(id))?sourceIndex:-1)
      .filter(sourceIndex=>sourceIndex>=0);
    const matchingQueries=queries.filter(query=>sources.some((source,sourceIndex)=>
      allowedSourceIndexes.includes(sourceIndex)&&sourcePhrases(source).some(phrase=>containsPhrase(query,phrase))));
    if(!matchingQueries.length&&sources.length===1)matchingQueries.push(...queries);
    // The synthetic comparison part is a coverage check over the already
    // planned source-side searches. Searching its generic wording spends a
    // scarce page slot on a broad, often weak hit; source-side passages can
    // support the synthesis once the Worker links them to this part.
    const syntheticComparison=/^How do the named sources compare in response to this question:/i.test(part.question);
    return {...part,sourceBookIds:partSourceGroups[index],
      searchQueries:[...new Set([...matchingQueries,...(syntheticComparison?[]:[part.question])])].slice(0,5)};
  });
  return {version:CONTRACT_VERSION,resolvedQuestion,intent,
    sources,parts:partsWithSources,scope:bounded(raw?.scope,200),
    clarification:bounded(raw?.clarification,240),queries};
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
