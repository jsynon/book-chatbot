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
  const editor=byline.match(/\bedited by\s+([^)]*)/i)?.[1]?.trim()||'';
  const translator=byline.match(/\btranslated by\s+([^)]*)/i)?.[1]?.trim()||'';
  const author=byline.replace(/\([^)]*\)/g,'').replace(/\b(?:edited|translated) by\b.*$/i,'').trim();
  const aliases=[work,...[...work.matchAll(/\(([^)]+)\)/g)].map(m=>m[1]),
    work.replace(/\([^)]*\)/g,'').trim(),...work.split(':').slice(1)];
  return {work,authors:author.split(/\s+and\s+/i).filter(Boolean),editors:editor?[editor]:[],
    translators:translator?[translator]:[],
    aliases:[...new Set(aliases.flatMap(v=>{const clean=v.trim();return [clean,clean.replace(/^(the|a|an)\s+/i,'').trim()];}).filter(v=>v.length>=4))]};
}
// Corpus-specific voice notes are deliberately guarded by both the stable v48
// book ID and its exact title. They describe publication/section context, not
// proof that every sentence on a page is spoken by that voice.
const CURATED_VOICE_IDENTITIES=Object.freeze({
  '140':{title:'Fear and Trembling — Søren Kierkegaard',workVoice:{kind:'pseudonymous-author',name:'Johannes de Silentio',creditedAuthor:'Søren Kierkegaard'}},
  '192':{title:'Philosophical Fragments — Søren Kierkegaard',workVoice:{kind:'pseudonymous-author',name:'Johannes Climacus',creditedAuthor:'Søren Kierkegaard'}},
  '253':{title:'The Sickness Unto Death — Søren Kierkegaard',workVoice:{kind:'pseudonymous-author',name:'Anti-Climacus',creditedAuthor:'Søren Kierkegaard'}},
  '185':{title:'Last Writings: Nothingness and the Religious Worldview — Kitarō Nishida',
    editorialPages:{18:{kind:'editorial-introduction',name:'David A. Dilworth',creditedAuthor:'Kitarō Nishida'}}},
  '239':{title:'The Portable Nietzsche — Friedrich Nietzsche (edited by Walter Kaufmann)',
    editorialPages:{578:{kind:'editorial-commentary',name:'Walter Kaufmann',creditedAuthor:'Friedrich Nietzsche'}}}
});
export function sourceProvenance(source,plan,pageText=''){
  const identity=catalogIdentity(source?.title||'');
  const role=(plan?.sources||[]).find(item=>(item.bookIds||[]).map(String).includes(String(source?.bookId)))?.role||'unspecified';
  const heading=String(pageText||'').slice(0,2500).match(/(?:^|\n)\s*(?:the\s+)?(?:(editor|translator|author)['’]s\s+)?(introduction|preface|commentary|notes|index)\b/i);
  const pageSectionHint=heading?heading[2].toLowerCase():'undetermined';
  const pageVoiceHint=heading?.[1]?heading[1].toLowerCase()+'-authored section':
    ['introduction','preface','commentary','notes'].includes(pageSectionHint)?'editorial-or-front-matter; verify against the passage':
    pageSectionHint==='index'?'reference matter':'undetermined';
  const curated=CURATED_VOICE_IDENTITIES[String(source?.bookId)];
  const titleMatches=curated&&String(source?.title||'').trim()===curated.title;
  const pageVoice=titleMatches?curated.editorialPages?.[Number(source?.page)]:undefined;
  return {work:identity.work||String(source?.title||''),creditedAuthors:identity.authors||[],
    creditedEditors:identity.editors||[],creditedTranslators:identity.translators||[],plannerSourceRole:role,
    pageSectionHint,pageVoiceHint,
    ...(titleMatches&&curated.workVoice?{workVoice:curated.workVoice}:{}),
    ...(pageVoice?{pageVoice}:{}),
    roleMeaning:'The planner role describes intended source selection, not the voice or genre of this individual page.'};
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
    const quoteText=quote.text.replace(/[.,!?;:]+$/u,'');
    // Short, single-token quotation marks usually mark a term of art rather
    // than claim to reproduce a source sentence (for example, Aristotle's
    // "whatness"). The cited source and all multiword quoted text remain
    // subject to exact substring validation.
    if(!/\s/u.test(quoteText)&&quoteText.length<=24)continue;
    // Bind to the first following citation group in this sentence/paragraph.
    // Do not allow an unrelated quote anywhere in the packet to validate it.
    const tail=answer.slice(quote.end);
    const next=tail.match(/^[^\n.!?]*(?:[.!?]\s*)?(\[\s*S\d+(?:\s*,\s*S\d+)*\s*\])/);
    const ownIds=next?citationIds(next[1]):[];
    if(!ownIds.length||!ownIds.some(id=>normalizeQuote(byId.get(id)?.text??byId.get(id)?.preview)
      .includes(normalizeQuote(quoteText))))quoteFailures.push({...quote,sourceIds:ownIds});
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
  let normalizedParts=parts.length?parts:[{id:'P1',question}];
  const identityText=value=>String(value||'').normalize('NFKC').toLocaleLowerCase()
    .replace(/[’‘]/g,"'").replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
  const containsPhrase=(haystack,phrase)=>{
    const normalized=identityText(phrase);
    return normalized.length>=4&&(' '+identityText(haystack)+' ').includes(' '+normalized+' ');
  };
  const simpleDefinition=/^\s*(?:what\s+is|what['’]s|define)\s+.+?\??\s*$/i.test(resolvedQuestion)||
    /^\s*what\s+does\s+.+?\s+mean\s*\??\s*$/i.test(resolvedQuestion);
  const asksAnotherFacet=/\b(?:and|or)\s+(?:(?:what|how|why|whether|when|where|who|does|do|did|is|are|can|could|would|should|will|must)\b|(?:its|their|his|her)\s+(?:role|function|importance|effect|impact|origin|history|example|implication|operation)\b|(?:the\s+)?(?:role|function|importance|effect|impact|origin|history|example|implication|operation)\b)|[,;]\s*(?:and\s+)?(?:how|why|what|whether|when|where|who|does|do|did|is|are|can|could|would|should)\b/i
    .test(resolvedQuestion);
  // The planner may expand a direct definition into adjacent topics that the
  // reader did not ask for. Keep the requested definition as one coverage
  // part, while preserving explicitly coordinated questions such as "what is
  // X and how does it work?".
  if(simpleDefinition&&!asksAnotherFacet)
    normalizedParts=[{id:'P1',question:resolvedQuestion}];
  const hypotheticalAuthorResponse=/\b(?:what|how)\s+would\b[^?!.]{0,120}\b(?:think|say|respond|react|view|regard)\b[^?!.]{0,100}\b(?:about|of|on|regarding|concerning|to)\b/i.test(resolvedQuestion);
  const comparisonPattern=/\b(?:compare|contrast|differ(?:s|ed|ence|ent)?|versus|vs\.?|similar(?:ity)?|alike)\b/i;
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
  const sourceMentionIndex=source=>sourcePhrases(source).map(phrase=>({
    index:identityText(resolvedQuestion).indexOf(phrase)
  })).filter(item=>item.index>=0).sort((a,b)=>a.index-b.index)[0]?.index??Number.MAX_SAFE_INTEGER;
  const counterfactualSources=sources.filter(source=>['primary','subject'].includes(source.role)&&source.bookIds.length);
  if(hypotheticalAuthorResponse&&counterfactualSources.length===2){
    counterfactualSources.sort((a,b)=>sourceMentionIndex(a)-sourceMentionIndex(b));
    const [stance,object]=counterfactualSources;
    sources.splice(0,sources.length,...counterfactualSources,...sources.filter(source=>!counterfactualSources.includes(source)));
    // Keep retrieval responsibilities distinct: each thinker is grounded in
    // their own books, while the synthesis explicitly permits a cautious
    // inference from both sides.
    normalizedParts=[
      {id:'P1',question:`What position does ${stance.label} take on the ideas under discussion?`},
      {id:'P2',question:`What position does ${object.label} take on the ideas under discussion?`},
      {id:'P3',question:'How do the two positions compare, and what response can cautiously be inferred from the original question?'}
    ];
  }else if(intent!=='compare'&&sources.length===1){
    const broadAuthorQuestion=resolvedQuestion.match(/^\s*what\s+(?:(?:did|does|do)\s+)?(.{2,100}?)\s+(?:have\s+to\s+say|say|think|argue|believe|write|teach|hold|maintain)\s+(?:anything\s+)?(?:about|on|regarding|concerning)\s+(.+?)\??\s*$/i);
    const topic=broadAuthorQuestion?.[2]||'';
    if(broadAuthorQuestion&&!/\b(?:and|or|versus|vs\.?|compare|contrast)\b/i.test(topic))
      normalizedParts=[{id:'P1',question:resolvedQuestion}];
  }
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
      // Narrow an author's works only when the reader's question names a
      // distinctive work phrase. A lone author token can also occur inside a
      // catalog title and must not silently turn an author-wide question into
      // one book.
      const titleMatches=bookIds.filter(id=>{
        const title=catalog[id];if(!title)return false;
        const identity=catalogIdentity(title);
        const authorTokens=new Set(identity.authors.flatMap(author=>identityText(author).split(' ')));
        const titlePhrases=[identity.work,...identity.aliases].map(value=>{
          const tokens=identityText(value).split(' ')
            .filter(token=>token&&!/^\d+$/.test(token)&&token!=='s'&&!authorTokens.has(token));
          while(['the','a','an'].includes(tokens[0]))tokens.shift();
          return tokens.join(' ');
        });
        return titlePhrases.some(phrase=>containsPhrase(resolvedQuestion,phrase));
      });
      return titleMatches.length===1?titleMatches:bookIds;
    });
    return narrowed.length?[...new Set(narrowed)]:null;
  });
  const comparisonSources=sources.filter(source=>['primary','subject'].includes(source.role)&&source.bookIds.length);
  const hasPlannedComparison=normalizedParts.some((part,index)=>comparisonPattern.test(part.question)&&
    comparisonSources.filter(source=>source.bookIds.some(id=>(partSourceGroups[index]||[]).includes(id))).length>=2);
  const comparisonBookIds=[...new Set(comparisonSources.flatMap(source=>source.bookIds))];
  if(intent==='compare'&&(comparisonPattern.test(resolvedQuestion)||hypotheticalAuthorResponse)&&comparisonSources.length>=2&&
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
    const syntheticComparison=/^How do the named sources compare in response to this question:/i.test(part.question)||
      (hypotheticalAuthorResponse&&index===2&&comparisonPattern.test(part.question));
    const sourceSidePart=hypotheticalAuthorResponse&&index<2;
    const contextDependent=/\b(?:he|she|it|they|his|her|its|their|this|that|these|those|the same)\b|\b(?:this|that|the)\s+(?:soliloquy|passage|scene|argument|account|position)\b/i
      .test(part.question);
    const contextualQuery=contextDependent&&intent!=='compare'&&!syntheticComparison
      ?[resolvedQuestion.slice(0,200),part.question.slice(0,200)].filter(Boolean).join(' ').slice(0,400)
      :part.question;
    return {...part,sourceBookIds:partSourceGroups[index],
      searchQueries:[...new Set([...matchingQueries,...(syntheticComparison||sourceSidePart?[]:[contextualQuery])])].slice(0,5)};
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
