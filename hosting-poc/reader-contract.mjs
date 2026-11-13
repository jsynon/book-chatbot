// Worker-side plan and citation contract. The site copy lives in
// antilogicalism/reading-companion/reader-contract.mjs. They are not
// byte-identical: coordinated multi-part normalization and optional-query
// linkage currently differ. Compare both copies before changing shared plan
// or citation behavior; this Worker copy also owns server-side quote cleanup.
export const CONTRACT_VERSION='reader-evidence-v2';
// A validated plan source whose book set is wider than any single
// author's presence in the catalog is a collective credit (an anthology
// byline shared by unrelated works), not a scope. Measured on v49: the
// widest genuine author byline is Plato at 22 books, while a collective
// "Various authors" set validated to 55. The limit is a catalog
// property, not a per-question choice; see stageB3-checkpoint.
export const COLLECTIVE_SOURCE_BOOK_LIMIT=24;
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
// Build a deterministic, catalog-bounded plan when the hosted planner is
// unavailable or returns no usable plan. Only unique author surnames/full
// names and unambiguous work aliases from the supplied catalog are accepted.
// This keeps direct-search recovery useful without inventing source IDs or
// making another model call.
export function catalogFallbackPlan(question,catalog={},selectedBookId=''){
  const text=String(question||'');
  const normalize=value=>String(value||'').normalize('NFKC').toLocaleLowerCase()
    .replace(/[’‘]/g,"'").replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
  const contains=(haystack,phrase)=>{
    const needle=normalize(phrase),source=normalize(haystack);
    return needle.length>=4&&(' '+source+' ').includes(' '+needle+' ');
  };
  if(selectedBookId&&Object.hasOwn(catalog,String(selectedBookId))){
    const title=String(catalog[String(selectedBookId)]||'');
    return {intent:'explain',resolvedQuestion:text,queries:[text],sources:[
      {label:title,role:'primary',bookIds:[String(selectedBookId)]}],parts:[text]};
  }
  const authors=new Map(),authorTokenOwners=new Map(),aliasOwners=new Map();
  for(const [rawId,titleValue] of Object.entries(catalog||{})){
    const id=String(rawId),title=String(titleValue||''),identity=catalogIdentity(title);
    for(const author of identity.authors){
      const key=normalize(author);if(!key)continue;
      const entry=authors.get(key)||{label:author,bookIds:new Set()};entry.bookIds.add(id);authors.set(key,entry);
      for(const token of key.split(' ').filter(token=>token.length>=4&&!['from','with'].includes(token))){
        const owners=authorTokenOwners.get(token)||new Set();owners.add(key);authorTokenOwners.set(token,owners);
      }
    }
    for(const alias of [identity.work,...identity.aliases]){
      const key=normalize(alias);if(!key)continue;
      const owners=aliasOwners.get(key)||new Set();owners.add(id);aliasOwners.set(key,owners);
    }
  }
  const matchedAuthors=[...authors.entries()].filter(([key])=>contains(text,key)||
    key.split(' ').some(token=>token.length>=4&&authorTokenOwners.get(token)?.size===1&&contains(text,token)));
  const namedWorkIds=new Set([...aliasOwners.entries()]
    .filter(([alias,owners])=>owners.size===1&&contains(text,alias))
    .flatMap(([,owners])=>[...owners]));
  const sources=matchedAuthors.map(([,entry])=>{
    const titleNarrowed=[...entry.bookIds].filter(id=>namedWorkIds.has(id));
    return {label:entry.label,role:'primary',bookIds:titleNarrowed.length?titleNarrowed:[...entry.bookIds]};
  });
  const represented=new Set(sources.flatMap(source=>source.bookIds));
  for(const id of namedWorkIds){
    if(represented.has(id))continue;
    const identity=catalogIdentity(catalog[id]);
    sources.push({label:identity.authors[0]||identity.work,role:'primary',bookIds:[id]});
  }
  const comparison=/\b(?:compare|contrast|differ(?:s|ed|ence|ent)?|versus|vs\.?|similar(?:ity)?|alike)\b/i.test(text);
  return {intent:comparison&&sources.length>1?'compare':'explain',resolvedQuestion:text,
    queries:[text],sources:sources.slice(0,8).map(source=>({...source,bookIds:source.bookIds.slice(0,16)})),parts:[text]};
}
// Corpus-specific voice notes are deliberately guarded by both the stable v48
// book ID and its exact title. They describe publication/section context, not
// proof that every sentence on a page is spoken by that voice.
const CURATED_VOICE_IDENTITIES=Object.freeze({
  '140':{title:'Fear and Trembling — Søren Kierkegaard',workVoice:{kind:'pseudonymous-author',name:'Johannes de Silentio',creditedAuthor:'Søren Kierkegaard'}},
  '192':{title:'Philosophical Fragments — Søren Kierkegaard',workVoice:{kind:'pseudonymous-author',name:'Johannes Climacus',creditedAuthor:'Søren Kierkegaard'}},
  '253':{title:'The Sickness Unto Death — Søren Kierkegaard',workVoice:{kind:'pseudonymous-author',name:'Anti-Climacus',creditedAuthor:'Søren Kierkegaard'}},
  '185':{title:'Last Writings: Nothingness and the Religious Worldview — Kitarō Nishida',
    editorialPages:{
      17:{kind:'editorial-introduction',name:'David A. Dilworth',creditedAuthor:'Kitarō Nishida'},
      18:{kind:'editorial-introduction',name:'David A. Dilworth',creditedAuthor:'Kitarō Nishida'}
    }},
  '178':{title:'Mūlamadhyamakakārikā — Nāgārjuna',
    editorialPages:{
      88:{kind:'editorial-introduction',name:'David J. Kalupahana',creditedAuthor:'Nāgārjuna'},
      104:{kind:'editorial-commentary',name:'David J. Kalupahana',creditedAuthor:'Nāgārjuna'},
      164:{kind:'editorial-commentary',name:'David J. Kalupahana',creditedAuthor:'Nāgārjuna'}
    }},
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
  const effectiveSectionHint=pageVoice?.kind?.includes('commentary')?'commentary':
    pageVoice?.kind?.includes('introduction')?'introduction':pageSectionHint;
  const effectiveVoiceHint=pageVoice?
    `${pageVoice.kind.replace(/^editorial-/u,'')} by ${pageVoice.name}`:pageVoiceHint;
  return {work:identity.work||String(source?.title||''),creditedAuthors:identity.authors||[],
    creditedEditors:identity.editors||[],creditedTranslators:identity.translators||[],plannerSourceRole:role,
    pageSectionHint:effectiveSectionHint,pageVoiceHint:effectiveVoiceHint,
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
    const next=tail.match(/^[^\n.!?]*?(?:[.!?](?=\s*\[))?\s*(\[\s*S\d+(?:\s*,\s*S\d+)*\s*\])/);
    const ownIds=next?citationIds(next[1]):[];
    if(!ownIds.length||!ownIds.some(id=>normalizeQuote(byId.get(id)?.text??byId.get(id)?.preview)
      .includes(normalizeQuote(quoteText))))quoteFailures.push({...quote,sourceIds:ownIds});
  }
  return {ok:!unknownIds.length&&!quoteFailures.length,ids,unknownIds,quoteFailures};
}
// A phrase that is not an exact source quotation can still be a sound
// paraphrase. Remove only its quote marks, then let the ordinary source-span
// reviewer decide whether the cited claim is supported; never silently keep it
// as a direct quotation.
export function removeUnsupportedQuoteMarks(answer,sources){
  let text=String(answer||'');
  const audit=auditFinalAnswer(text,sources);
  const repairs=[];
  for(const quote of audit.quoteFailures.slice().sort((a,b)=>b.start-a.start)){
    if(quote.end<=quote.start+1)continue;
    const value=text.slice(quote.start+1,quote.end-1);
    text=text.slice(0,quote.start)+value+text.slice(quote.end);
    repairs.unshift({quote:String(quote.text||value).slice(0,180),
      sourceIds:[...(quote.sourceIds||[])],action:'removed-nonexact-quotation-marks'});
  }
  return {text,repairs,unknownIds:audit.unknownIds};
}
export function normalizePlan(raw,question,catalog={},selectedBookId=''){
  const bounded=(v,max)=>typeof v==='string'?v.trim().slice(0,max):'';
  const fallback=catalogFallbackPlan(question,catalog,selectedBookId);
  const planInput=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:fallback;
  const resolvedQuestion=bounded(planInput.resolvedQuestion,600)||question;
  const entities=Array.isArray(planInput.sources)?planInput.sources.filter(s=>s&&typeof s==='object'&&!Array.isArray(s)).slice(0,8):[];
  const identity=value=>String(value||'').normalize('NFKC').toLocaleLowerCase()
    .replace(/[’‘]/g,"'").replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
  const authorNames=Object.values(catalog).flatMap(title=>catalogIdentity(title).authors)
    .map(identity).filter(Boolean);
  const tokenOwners=new Map();
  for(const name of authorNames)for(const token of name.split(' ')){
    const owners=tokenOwners.get(token)||new Set();owners.add(name);tokenOwners.set(token,owners);
  }
  const labelMatchesTitle=(label,title)=>{
    const labelKey=identity(label),titleIdentity=catalogIdentity(title);
    return [titleIdentity.work,...titleIdentity.aliases].some(alias=>{
      const key=identity(alias);return key===labelKey||(' '+key+' ').includes(' '+labelKey+' ');
    });
  };
  const labelMatchesAuthor=(label,title)=>{
    const labelKey=identity(label);
    if(!labelKey)return false;
    return catalogIdentity(title).authors.some(name=>{
      const authorKey=identity(name);
      if(authorKey===labelKey)return true;
      const authorTokens=authorKey.split(' ');
      return labelKey.split(' ').some(token=>authorTokens.includes(token)&&
        token.length>2&&tokenOwners.get(token)?.size===1);
    });
  };
  // The browser returns this plan to the Worker with its candidate pages.
  // Treat plan source IDs as claims: a known ID is still rejected when its
  // catalog byline/title does not match the planner's proposed identity.
  const sources=entities.map(s=>{
    const label=bounded(s.label,120),role=['primary','subject','commentary'].includes(s.role)?s.role:'primary';
    const bookIds=[...new Set((Array.isArray(s.bookIds)?s.bookIds:[]).map(String).filter(id=>{
      if(!Object.hasOwn(catalog,id))return false;
      const title=catalog[id];
      return labelMatchesAuthor(label,title)||labelMatchesTitle(label,title);
    }))];
    return {label,role,bookIds};
  }).filter(source=>source.bookIds.length);
  if(!sources.length&&fallback.sources.length)sources.push(...fallback.sources.slice(0,8));
  if(selectedBookId)sources.splice(0,sources.length,{label:catalog[selectedBookId],role:'primary',bookIds:[selectedBookId]});
  // Collective sources stay in the plan as leads (their queries remain
  // search facets) but never hard-scope a part, a question-named match,
  // or a comparison side: scoping to an anthology byline's full set
  // silently excludes every book outside it, including the ones the
  // reader's question is actually about.
  const collectiveSourceIndexes=new Set(sources
    .map((source,index)=>source.bookIds.length>COLLECTIVE_SOURCE_BOOK_LIMIT?index:-1)
    .filter(index=>index>=0));
  const collectiveSources=sources
    .filter((source,index)=>collectiveSourceIndexes.has(index))
    .map(source=>({label:source.label,bookCount:source.bookIds.length}));
  const intent=['explain','compare','interpret','locate'].includes(planInput.intent)?planInput.intent:'explain';
  const queries=Array.isArray(planInput.queries)?planInput.queries.slice(0,4).map(q=>bounded(q,160)).filter(Boolean):[];
  const exactQuestionAnchor=(candidate,partQuestion)=>{
    const anchor=typeof candidate==='string'?candidate.trim():'';
    // Anchors are literal excerpts from the current reader turn. Resolved
    // follow-up wording and planner paraphrases are useful context, but are
    // not substitutes for the words the reader actually supplied.
    if(anchor.length>=3&&anchor.length<=400&&question.includes(anchor))return anchor;
    if(typeof partQuestion==='string'&&partQuestion.length>=3&&partQuestion.length<=400&&
       question.includes(partQuestion))return partQuestion;
    return question.slice(0,400);
  };
  const parts=(Array.isArray(planInput.parts)?planInput.parts:[]).slice(0,6).map((p,i)=>({
    id:'P'+(i+1),question:bounded(typeof p==='string'?p:p?.question,240),
    requirements:Array.isArray(p?.requirements)?p.requirements.slice(0,4).flatMap(requirement=>{
      const text=bounded(typeof requirement==='string'?requirement:requirement?.text,200);
      if(!text)return [];
      return [{text,questionAnchor:exactQuestionAnchor(
        typeof requirement==='object'?requirement?.questionAnchor??requirement?.anchor:'',
        bounded(typeof p==='string'?p:p?.question,240))}];
    }).filter((requirement,index,all)=>all.findIndex(item=>
      item.text.toLocaleLowerCase()===requirement.text.toLocaleLowerCase())===index):[],
    plannedSearchQueries:Array.isArray(p?.searchQueries)?[...new Set(p.searchQueries
      .slice(0,5).map(query=>bounded(query,400)).filter(Boolean))]:[]
  })).filter(p=>p.question);
  let normalizedParts=parts.length?parts:[{id:'P1',question,requirements:[]}];
  const identityText=value=>String(value||'').normalize('NFKC').toLocaleLowerCase()
    .replace(/[’‘]/g,"'").replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
  const plannerQueryStopWords=new Set(['a','an','and','are','as','at','be','by','do','does','for','from','how',
    'in','into','is','it','of','on','or','that','the','their','them','they','this','to','what','when','where',
    'which','who','why','with']);
  const queryTerms=value=>[...new Set(identityText(value).split(' ').map(term=>
    term.length>5&&term.endsWith('s')?term.slice(0,-1):term)
    .filter(term=>term.length>2&&!plannerQueryStopWords.has(term)))];
  const plannerQueryAffinity=(query,part)=>{
    const terms=queryTerms(query),partTerms=new Set(queryTerms(part));
    if(terms.length<2||partTerms.size<2)return 0;
    const overlap=terms.filter(term=>partTerms.has(term)).length;
    const ratio=overlap/Math.min(terms.length,partTerms.size);
    return overlap>=2&&ratio>=0.3?overlap+ratio:0;
  };
  const containsPhrase=(haystack,phrase)=>{
    const normalized=identityText(phrase);
    return normalized.length>=4&&(' '+identityText(haystack)+' ').includes(' '+normalized+' ');
  };
  const containsSourcePhrase=(haystack,phrase)=>{
    const normalized=identityText(phrase);
    if(normalized.split(' ').length===1){
      const token=String(phrase||'').trim();
      if(token&&token[0]===token[0].toLocaleUpperCase())
        return new RegExp('(?<![\\p{L}\\p{N}])'+token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+
          '(?![\\p{L}\\p{N}])','u').test(String(haystack||''));
    }
    return containsPhrase(haystack,phrase);
  };
  const asksAnotherFacet=/\b(?:and|or)\s+(?:(?:what|how|why|whether|when|where|who|does|do|did|is|are|can|could|would|should|will|must)\b|(?:its|their|his|her)\s+(?:role|function|importance|effect|impact|origin|history|example|implication|operation)\b|(?:the\s+)?(?:role|function|importance|effect|impact|origin|history|example|implication|operation)\b)|[,;]\s*(?:and\s+)?(?:how|why|what|whether|when|where|who|does|do|did|is|are|can|could|would|should|will|must)\b/i.test(resolvedQuestion);
  const hypotheticalAuthorResponse=/\b(?:what|how)\s+would\b[^?!.]{0,120}\b(?:think|say|respond|react|view|regard)\b[^?!.]{0,100}\b(?:about|of|on|regarding|concerning|to)\b/i.test(resolvedQuestion);
  const comparisonPattern=/\b(?:compare|contrast|differ(?:s|ed|ence|ent)?|versus|vs\.?|similar(?:ity)?|alike)\b/i;
  const hasMultipleQuestions=(resolvedQuestion.match(/\?/g)||[]).length>1;
  // The planner can distinguish coordinated outcomes that this compact
  // surface-form check cannot name in advance. Preserve that decision when a
  // coordinated question arrives with multiple parts, while keeping ordinary
  // single questions on the one-part path.
  const plannerDecomposedCoordination=normalizedParts.length>1&&/\b(?:and|or)\b/i.test(resolvedQuestion);
  const explicitMultiPartRequest=asksAnotherFacet||hasMultipleQuestions||
    comparisonPattern.test(resolvedQuestion)||plannerDecomposedCoordination;
  // Planner parts become required coverage obligations. Keep a single direct
  // question as one part; use search leads and supported prose for helpful
  // context instead of turning inferred themes into new answer requirements.
  if(!explicitMultiPartRequest&&!hypotheticalAuthorResponse){
    const plannedSearchQueries=[...new Set(normalizedParts.flatMap(part=>part.plannedSearchQueries||[]))];
    const requirements=[...new Map(normalizedParts.flatMap(part=>part.requirements||[])
      .map(requirement=>[requirement.text.toLocaleLowerCase(),requirement])).values()];
    normalizedParts=[{id:'P1',question:resolvedQuestion,plannedSearchQueries,requirements}];
  }
  const sourcePhrases=source=>{
    const phrases=[source.label];
    for(const token of String(source.label||'').split(/[^\p{L}\p{N}]+/u))
      if(token.length>=4&&tokenOwners.get(identity(token))?.size===1)phrases.push(token);
    for(const id of source.bookIds){
      const title=catalog[id];if(!title)continue;
      const identity=catalogIdentity(title);
      phrases.push(identity.work,...identity.authors,...identity.authors.map(author=>String(author).split(/\s+/u).at(-1)),...identity.aliases);
    }
    const unique=new Map();
    for(const phrase of phrases){
      const key=identityText(phrase);if(key.length>=4&&!unique.has(key))unique.set(key,String(phrase).trim());
    }
    return [...unique.values()];
  };
  const sourceMentionIndex=source=>sourcePhrases(source).map(phrase=>({
    index:identityText(resolvedQuestion).indexOf(identityText(phrase))
  })).filter(item=>item.index>=0).sort((a,b)=>a.index-b.index)[0]?.index??Number.MAX_SAFE_INTEGER;
  const namesAWorkInCollection=(source,text)=>source.bookIds.some(id=>{
    const catalogTitle=catalog[id];if(!catalogTitle)return false;
    const identity=catalogIdentity(catalogTitle);
    if(!/\b(?:complete|collected)\s+(?:works|writings|plays|poems)\b/i.test(identity.work))return false;
    const catalogTokens=new Set([identity.work,...identity.authors,...identity.aliases]
      .flatMap(value=>identityText(value).split(' ')).filter(Boolean));
    return [...String(text||'').matchAll(/(?<![\p{L}\p{N}])([\p{Lu}][\p{L}\p{N}-]{2,})(?:['’]s)?(?![\p{L}\p{N}])/gu)]
      .some(match=>match.index>0&&!catalogTokens.has(identityText(match[1])));
  });
  const counterfactualSources=sources.filter((source,index)=>['primary','subject'].includes(source.role)&&source.bookIds.length&&
    !collectiveSourceIndexes.has(index));
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
  const questionNamedSources=sources.map((source,index)=>({source,index,phrases:sourcePhrases(source)}))
    .filter(group=>!collectiveSourceIndexes.has(group.index)&&
      group.phrases.some(phrase=>containsSourcePhrase(resolvedQuestion,phrase)));
  const partSourceGroups=normalizedParts.map(part=>{
    let matches=sources.map((source,index)=>({source,index,phrases:sourcePhrases(source)}))
      .filter(group=>!collectiveSourceIndexes.has(group.index)&&group.phrases.some(phrase=>
        containsSourcePhrase(part.question,phrase)&&containsSourcePhrase(resolvedQuestion,phrase)));
    // For an author asking about another thinker, the answer belongs to the
    // named primary author unless the plan explicitly makes this a comparison.
    if(intent!=='compare'&&matches.length>1){
      const primary=matches.filter(group=>group.source.role==='primary');
      if(primary.length)matches=primary;
    }
    // A planner's single catalog-valid source is only a search lead unless
    // the reader named it. An explicit book selection remains a hard scope.
    if(!matches.length&&selectedBookId){
      matches=sources.map((source,index)=>({source,index}))
        .filter(group=>group.source.bookIds.some(id=>String(id)===String(selectedBookId)));
    }
    // A named play, poem, or other work can live inside a cataloged collected
    // works volume even when the individual work is not a catalog entry.
    // Preserve that explicit work request when the planner supplied its
    // validated primary author as the sole source lead.
    if(!matches.length&&!selectedBookId&&sources.length===1&&!collectiveSourceIndexes.has(0)&&
       namesAWorkInCollection(sources[0],resolvedQuestion)&&
       namesAWorkInCollection(sources[0],part.question))
      matches=sources.map((source,index)=>({source,index}));
    if(!matches.length&&intent==='compare'&&questionNamedSources.length>1)
      matches=questionNamedSources;
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
  const comparisonSources=sources.filter((source,index)=>['primary','subject'].includes(source.role)&&
    source.bookIds.length&&!collectiveSourceIndexes.has(index)&&(selectedBookId?
      source.bookIds.some(id=>String(id)===String(selectedBookId)):
      questionNamedSources.some(group=>group.source===source)));
  const hasPlannedComparison=normalizedParts.some((part,index)=>comparisonPattern.test(part.question)&&
    comparisonSources.filter(source=>source.bookIds.some(id=>(partSourceGroups[index]||[]).includes(id))).length>=2);
  const comparisonBookIds=[...new Set(comparisonSources.flatMap(source=>source.bookIds))];
  if(intent==='compare'&&(comparisonPattern.test(resolvedQuestion)||hypotheticalAuthorResponse)&&comparisonSources.length>=2&&
    comparisonBookIds.length>=2&&!hasPlannedComparison){
    normalizedParts.push({id:'P'+(normalizedParts.length+1),
      question:bounded('How do the named sources compare in response to this question: '+resolvedQuestion,240)});
    partSourceGroups.push(comparisonBookIds);
  }
  // Drop only an unambiguous repeated comparison wrapper or an exact repeated
  // part. The wrapper restates the original question after a substantive
  // comparison part has already preserved that requested relation.
  const seenParts=[];
  const retainedPartSourceGroups=[];
  const comparisonPartPattern=/\b(?:compar\w*|differ\w*|versus|vs\.?|similar\w*|alike)\b/i;
  normalizedParts=normalizedParts.filter((part,originalIndex)=>{
    const key=identity(part.question);
    if(seenParts.some(previous=>identity(previous.question)===key))return false;
    const wrapper=part.question.match(/^How do the named sources compare in response to this question:\s*(.+)$/i);
    if(wrapper&&seenParts.some(previous=>comparisonPartPattern.test(previous.question)))return false;
    seenParts.push(part);retainedPartSourceGroups.push(partSourceGroups[originalIndex]||null);return true;
  }).map((part,index)=>{
    const id='P'+(index+1);
    const requirements=[...new Map((part.requirements||[]).map(requirement=>[
      String(requirement?.text||'').trim().toLocaleLowerCase(),{
        text:String(requirement?.text||'').trim(),
        questionAnchor:exactQuestionAnchor(requirement?.questionAnchor,part.question)
      }])).values()].filter(requirement=>requirement.text).slice(0,4)
      .map((requirement,requirementIndex)=>({id:id+'-R'+(requirementIndex+1),...requirement}));
    const {requirements:_,...normalizedPart}=part;
    return {...normalizedPart,id,...(requirements.length?{requirements}:{})};
  });
  partSourceGroups.splice(0,partSourceGroups.length,...retainedPartSourceGroups);
  const partsWithSources=normalizedParts.map((part,index)=>{
    const allowedIds=partSourceGroups[index]||[];
    const allowedSourceIndexes=sources.map((source,sourceIndex)=>source.bookIds.some(id=>allowedIds.includes(id))?sourceIndex:-1)
      .filter(sourceIndex=>sourceIndex>=0);
    const matchingQueries=queries.filter(query=>sources.some((source,sourceIndex)=>
      allowedSourceIndexes.includes(sourceIndex)&&sourcePhrases(source).some(phrase=>containsPhrase(query,phrase))));
    if(normalizedParts.length===1)matchingQueries.push(...queries);
    // For one direct question, every planner query remains an optional search
    // lead for that part, even when a conceptual phrasing shares few surface
    // words. This grants retrieval eligibility only; it is not evidence.
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
    const {plannedSearchQueries=[],...normalizedPart}=part;
    // Global planner queries can contain the clearest wording for a requested
    // subpart even when they omit the catalog title/author. Link the single
    // strongest lexical match as a bounded hint; it remains a retrieval cue,
    // never evidence or a new coverage obligation.
    const linkedPlannerQuery=normalizedParts.length>1?queries.map((query,queryIndex)=>({query,queryIndex,
      affinity:plannerQueryAffinity(query,part.question)})).filter(item=>item.affinity>0)
      .sort((a,b)=>b.affinity-a.affinity||a.queryIndex-b.queryIndex)[0]?.query:undefined;
    return {...normalizedPart,sourceBookIds:partSourceGroups[index],
      searchQueries:[...new Set([...(linkedPlannerQuery?[linkedPlannerQuery]:[]),...plannedSearchQueries,...matchingQueries,
       ...(syntheticComparison||sourceSidePart?[]:[contextualQuery])])].slice(0,5)};
  });
  return {version:CONTRACT_VERSION,resolvedQuestion,intent,
    sources,parts:partsWithSources,
    ...(collectiveSources.length?{collectiveSources}:{}),
    scope:bounded(planInput.scope,200),
    clarification:bounded(planInput.clarification,240),queries};
}
