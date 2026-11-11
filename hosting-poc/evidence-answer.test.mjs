import test from 'node:test';
import assert from 'node:assert/strict';
import {composeEvidenceAnswer,linkEvidenceToParts,COMPOSER_PROMPT,EXPANSION_PROMPT,REVIEW_PROMPT,parseReviewJson,parseAnswerRepairJson,normalizeAnswerMarkdown,sanitizeInternalAnswerIds,unwrapBoldWrappedParagraphs,findUntracedCitedClaims,stripUntracedCitedClaims,stripUntracedCitedClaimsToFixpoint,removeClaimsFromPart,hasAssemblyEndingViolation,speakerIsWorkAuthor,personNamesMatch,namedSpeakerAttribution,claimPersonSubjects,claimTextAppears,attachScaffoldingToPart,isListLeadInAnswer,introducesDuplicatedParagraph,composerPassageWindows,normalizeClaimClauseDecisions,claimPossessiveOnlySubjects} from './evidence-answer.mjs';
import {auditFinalAnswer,normalizePlan,sourceProvenance,removeUnsupportedQuoteMarks} from './reader-contract.mjs';
import {buildReviewSpans,rankReviewSpans,selectReviewPacketSpans,selectRequirementReviewSpans,isHeadingOnlySpan} from './review-spans.mjs';
import {splitCitedSentenceUnits,reconcileFinalPartCoverage,findTextAbsentShippedClaims} from './evidence-answer.mjs';

test('batch 15 preserves quoted sentence punctuation and leading Markdown subtitles',()=>{
 for(const text of [
  'The notice says "Keep moving. Watch the ridge! Wait... then proceed?" [S1].',
  'The notice says “Keep moving. Watch the ridge! Wait… then proceed?” [S1].',
  '**Practice vs. Reason:** Custom guides expectation [S1].',
  '* **Stability vs. Dissolution:** Luxury affects workers [S1].',
  '__Practice vs. Reason:__ Custom guides expectation [S1].',
  'Dr. Vale quotes "W.E.B. remains here. Wait!" [S1].',
  'The notice says "Use ZXQREADERSTRUCTUREPUNCTUATION0ZXQ. Wait!" [S1].'
 ])assert.deepEqual(splitCitedSentenceUnits(text),[text]);
 assert.deepEqual(splitCitedSentenceUnits('One fact [S1]. Another fact [S1].'),
  ['One fact [S1].','Another fact [S1].']);
 const unmatched='The notice says "Keep moving. Watch the ridge [S1].';
 assert.equal(splitCitedSentenceUnits(unmatched).join(' ').replace(/\s+/g,' '),unmatched);
});

test('Batch 21 requirement passages cannot consume the whole composer span allowance',()=>{
 const text=Array.from({length:24},(_,index)=>`Passage ${index+1} discusses the shared question and a distinct idea.`).join(' ');
 const requirements=Array.from({length:8},(_,index)=>({id:`P1-R${index+1}`,text:`Requirement idea ${index+1}`}));
 const result=composerPassageWindows('S1',text,'shared question',[{id:'P1',question:'shared question',
  requirements,searchQueries:['shared question']}]);
 const reserved=result.selection.filter(item=>item.reservedForRequirement);
 assert.ok(reserved.length<=4);
 assert.ok(result.selection.some(item=>!item.reservedForRequirement),
  'broad relevance ranking must retain at least some composer slots');
});

test('Batch 21 preserves the named paraphrased support span alongside requirement reservations',()=>{
 const supportingSpan='Repeated encounters condition expectation; observing events recur teaches the mind to anticipate what comes next, although no necessary connection is directly observed.';
 const passages=[
  ...Array.from({length:8},(_,index)=>`Requirement anchor ${index+1} discusses a distinct requested topic and its surrounding context in detail.`),
  supportingSpan,
  ...Array.from({length:8},(_,index)=>`Background passage ${index+1} concerns unrelated historical details and offers no explanation of experience or expectation.`)
 ].join(' ');
 const result=composerPassageWindows('S1',passages,
  'How does repeated experience produce expectation and inference?', [{id:'P1',
   question:'How does repeated experience produce expectation and inference?',
   searchQueries:['repeated experience expectation inference mind events custom'],
   requirements:Array.from({length:8},(_,index)=>({id:`P1-R${index+1}`,
    text:`Requirement anchor ${index+1}`}))}]);
 assert.ok(result.passages.some(passage=>passage.spanIds.includes('S1-Q9')),
  'the paraphrased supporting span S1-Q9 must survive in this part’s composed window');
 assert.ok(result.selection.some(item=>item.reservedForRequirement),
  'requirement-matching passages remain available alongside the supporting span');
});

test('Batch 21 clause offsets that split words remain unresolved and partial',()=>{
 const claim='Hume explains that custom shapes expectation.';
 const splitAt=claim.indexOf('custom')+2;
 const result=normalizeClaimClauseDecisions([{start:splitAt,end:claim.indexOf(' expectation')+5,
  text:claim.slice(splitAt,claim.indexOf(' expectation')+5),status:'answered',issueCode:'none',sources:[]}],
  claim,new Set(['S1']),new Map());
 assert.equal(result.decisions.length,1);
 assert.equal(result.decisions[0].status,'partial');
 assert.equal(result.decisions[0].unresolved,true);
 assert.ok(result.warnings.includes('clause-range-not-word-boundary'));
});



test('Batch 21 person-subject extraction covers subordinate actions and possessive states',()=>{
 assert.deepEqual(claimPersonSubjects('Although Marlow hesitated, Kurtz’s conviction shaped his command.'),
  ['Marlow','Kurtz']);
 assert.deepEqual(claimPersonSubjects('Custom shapes expectation, while reason explains causal inference.'),[]);
});

test('batch 15 quote repair survives review scaffolding without restoring quotation marks',async()=>{
 const ai=makeAI([answer('PART P1\nHume links necessity to custom and regular conjunction. [S1]\n\nThe account explains "learned expectation".'),
  (_model,{messages})=>{
   const payload=parsePayload(messages);
   assert.equal(payload.parts[0].contextClaims[0].text,'The account explains learned expectation.');
   return answer(JSON.stringify({parts:[{partId:'P1',status:'answered',answerStatus:'answered',
    directAnswerClaimIds:['P1-C1'],scaffoldingLinks:[{claimId:'P1-C2',supportClaimIds:['P1-C1']}]}],
    claims:payload.claims.map(claim=>({claimId:claim.claimId,status:'answered',
     sources:claim.sourceIds.map(sourceId=>({sourceId,status:'answered',spanIds:[sourceId+'-Q1']}))}))}));
  }]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],
  {plan:onePartPlan,catalog,trace:true});
 assert.match(result.answer,/The account explains learned expectation\. \[S1\]/);
 assert.doesNotMatch(result.answer,/"learned expectation"/);
 assert.equal(auditFinalAnswer(result.answer,[hume]).ok,true);
 assert.equal(result.trace.quoteRepairs[0].claimId,'P1-C2');
 assert.equal(result.trace.quoteRepairs[0].canonicalTextUpdated,true);
 assert.equal(ai.calls.length,2);
});

test('batch 15 full review path keeps a subtitle intact and its citation on the body',async()=>{
 const ai=makeAI([answer('PART P1\n**Practice vs. Reason:** Hume links necessity to custom and regular conjunction. [S1]'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],
  {plan:onePartPlan,catalog,trace:true});
 assert.match(result.answer,/\*\*Practice vs\. Reason:\*\*/);
 assert.doesNotMatch(result.answer,/\*\*[^*]*\[S\d+\][^*]*\*\*/);
 assert.match(result.answer,/conjunction\. \[S1\]/);
 assert.equal(result.trace.claimInheritance,undefined);
 assert.equal(ai.calls.length,2);
});

test('batch 15 final coverage follows surviving claims without promoting partial judgments',()=>{
 const item={part:{id:'P1'},status:'answered',answerStatus:'answered',
  answers:[{claimId:'P1-C1',sourceIds:[]}],requirementsComplete:true,
  requirementCoverage:[
   {requirementId:'R1',status:'answered',answerClaimIds:['P1-C1']},
   {requirementId:'R2',status:'answered',answerClaimIds:['P1-C1','P1-C2']},
   {requirementId:'R3',status:'answered',answerClaimIds:['P1-C2']},
   {requirementId:'R4',status:'partial',answerClaimIds:['P1-C1']} ]};
 const trace=reconcileFinalPartCoverage([item],new Set(['P1']));
 assert.deepEqual(item.requirementCoverage.map(x=>x.status),['answered','partial','unanswered','partial']);
 assert.equal(item.answerStatus,'partial');assert.equal(item.requirementsComplete,false);
 assert.deepEqual(trace[0].shippedClaimIds,['P1-C1'],'approved context survives without forced citations');
 assert.equal(trace[0].requirements.length,2);
 reconcileFinalPartCoverage([item],new Set(['P1']),{suppressed:true});
 assert.ok(item.requirementCoverage.every(x=>x.status==='unanswered'&&!x.answerClaimIds.length));
 assert.equal(item.answerStatus,'unanswered');
});

test('batch 15 refuses reviewer citation attachment to a subtitle',()=>{
 const part={answers:[{claimId:'C1',text:'**Practice vs. Reason:**',sourceIds:[]},
  {claimId:'C2',text:'Custom guides expectation.',sourceIds:['S1']}],
  evidence:[{claimId:'C2',sourceId:'S1',quote:'Custom guides expectation.'}]};
 const result=attachScaffoldingToPart(part,[{claimId:'C1',supportClaimIds:['C2']}]);
 assert.equal(result.invalidLinks,1);
 assert.equal(result.invalidLinkDetails[0].reason,'target-heading');
 assert.deepEqual(part.answers[0].sourceIds,[]);
});

test('batch 15 final-audit salvage clears dropped requirement and evidence references',async()=>{
 const plan={...twoSidePlan,parts:twoSidePlan.parts.map(p=>({...p,
  requirements:[{id:p.id+'-R1',text:'Explain this position.'}]}))};
 const draft='PART P1\nHume explains causal expectation through custom. [S1]\n'+
  'PART P2\nKant treats causality as an a priori category. [S2]\n'+
  'PART P3\nHume emphasizes custom while Kant emphasizes an a priori category. [S1, S2]';
 const reviewAll=review([['P1','answered'],['P2','answered'],['P3','answered']]);
 const ai=makeAI([answer(draft),reviewAll,reviewAll,reviewAll]);
 const result=await composeEvidenceAnswer(twoSidePlan.resolvedQuestion,[hume,kant],ai,[],
  {plan,catalog,trace:true,postReviewAuditPartId:'P1'});
 const dropped=result.questionParts.find(p=>p.partId==='P1');
 assert.deepEqual(dropped.claimIds,[]);
 assert.equal(dropped.requirementsComplete,false);
 assert.equal(dropped.requirementCoverage[0].status,'unanswered');
 assert.deepEqual(dropped.requirementCoverage[0].answerClaimIds,[]);
 assert.ok(result.evidenceMap.every(e=>e.partId!=='P1'));
 const original=result.trace.reviewContract.partDecisions.find(p=>p.partId==='P1');
 assert.equal(original.requirementCoverage[0].status,'answered','original reviewer record retained');
 assert.equal(original.outputRequirementCoverage[0].status,'unanswered');
 assert.equal(result.answerCompleteness,'partial');
});

const catalog={35:'An Enquiry Concerning Human Understanding — David Hume',40:'Critique of Pure Reason — Immanuel Kant'};
function parsePayload(messages){
 const payload=JSON.parse(messages[1].content);
 if(!Array.isArray(payload.spanCatalog))return payload;
 const spans=new Map(payload.spanCatalog.map(span=>[span.spanId,span]));
 const contexts=new Map((payload.sourceContexts||[]).map(context=>[context.sourceId,context.text]));
 const sourceCatalog=new Map(Object.entries(payload.sourceCatalog||{}));
 for(const part of payload.parts||[])for(const evidence of part.evidence||[]){
  const sourceDetails=sourceCatalog.get(evidence.sourceDetailsId||evidence.id);
  if(sourceDetails)Object.assign(evidence,sourceDetails);
  if(Array.isArray(evidence.spanIds))Object.defineProperty(evidence,'spans',{enumerable:false,
   value:evidence.spanIds.map(id=>spans.get(id)).filter(Boolean)});
  if(contexts.has(evidence.id))Object.defineProperty(evidence,'contextText',{enumerable:false,
   value:contexts.get(evidence.id)});
 }
 return payload;
}
const hume={id:'S1',bookId:'35',title:catalog[35],page:42,url:'https://example.test/hume#page=42',
 text:'Our idea of necessity and causation arises from the uniformity observable in nature, where similar objects are constantly conjoined, and the mind is determined by custom to infer one from the other.',
 preview:'Our idea of necessity and causation arises from uniformity and custom.'};
const kant={id:'S2',bookId:'40',title:catalog[40],page:53,url:'https://example.test/kant#page=53',
 text:'Causality is one of the categories of relation. The categories are pure conceptions of the understanding and are a priori.',
 preview:'Causality is one of the categories of relation.'};
function answer(text){return {response:text,usage:{neurons:8,prompt_tokens:100,completion_tokens:60}};}
function review(statuses,{evidenceByPart={},includeEvidence=true,directAnswerClaimIdsByPart={}}={}){
 return (_model,{messages})=>{
  const payload=parsePayload(messages);
  const statusByPart=new Map(statuses);
  const parts=payload.parts.map(part=>({partId:part.partId,
   status:statusByPart.get(part.partId)||'partial',
   ...(Object.hasOwn(directAnswerClaimIdsByPart,part.partId)?
    {directAnswerClaimIds:directAnswerClaimIdsByPart[part.partId]}:{})}));
  const claims=payload.claims.map(claim=>{
   const status=statusByPart.get(claim.partId)||'partial';
   const defaultEvidence=claim.sourceIds.map(sourceId=>({sourceId,spanIds:[sourceId+'-Q1']}));
   const evidence=!includeEvidence||status==='unanswered'?[]:
    (evidenceByPart[claim.partId]||defaultEvidence).filter(item=>claim.sourceIds.includes(item.sourceId));
   return {claimId:claim.claimId,status,spanIds:evidence.flatMap(item=>item.spanIds)};
  });
  return {response:JSON.stringify({parts,claims})};
 };
}
function reviewWithSubjects(statuses,options={}){
 const base=review(statuses,options);
 return (_model,request)=>{
  const payload=parsePayload(request.messages),parsed=JSON.parse(base(_model,request).response);
  parsed.claims=parsed.claims.map(claim=>{
   const answerClaim=payload.claims.find(item=>item.claimId===claim.claimId);
   const subjects=claimPersonSubjects(answerClaim?.text||'');
   if(!subjects.length)return claim;
   return {...claim,sources:answerClaim.sourceIds.map((sourceId,index)=>({sourceId,
    status:claim.status,spanIds:(claim.spanIds||[]).filter(id=>String(id).startsWith(sourceId+'-')),
    subjectAttributionStatus:'supported',
    attributedSubject:subjects[Math.min(index,subjects.length-1)]}))};
  });
  return {response:JSON.stringify(parsed)};
 };
}
function makeAI(responses,{decorateReview=true,decorateClauses=true,decorateSubject=true}={}){
 const calls=[];
 return {calls,run:async(model,request)=>{calls.push({model,request});const next=responses.shift();
   if(next instanceof Error)throw next;
   const result=typeof next==='function'?next(model,request):next;
   // Most fixtures predate the explicit answer/context decisions. Give legacy
   // fixtures realistic reviewer selections; focused contract tests opt out.
   const systemText=String(request?.messages?.[0]?.content||'');
   if((decorateReview||decorateClauses||decorateSubject)&&systemText.includes('directAnswerClaimIds')&&
      typeof result?.response==='string'){
    try{
     const reviewObject=JSON.parse(result.response);
     const payload=parsePayload(request.messages);
    if(Array.isArray(reviewObject.parts)&&Array.isArray(reviewObject.claims)){
      if(decorateReview)for(const part of reviewObject.parts){
       const planPart=payload.parts.find(item=>item.partId===part.partId);
       const contextClaims=planPart?.contextClaims||[];
       const partClaims=payload.claims.filter(claim=>claim.partId===part.partId);
       if(!Array.isArray(part.directAnswerClaimIds))part.directAnswerClaimIds=payload.claims
        .filter(claim=>claim.partId===part.partId).slice(0,1).map(claim=>claim.claimId);
       if(!Array.isArray(part.retainedContextClaimIds))part.retainedContextClaimIds=
        part.status==='answered'?contextClaims.map(claim=>claim.claimId):part.status==='partial'?
         part.directAnswerClaimIds.filter(id=>contextClaims.some(claim=>claim.claimId===id)):[];
       if(!Array.isArray(part.requirementCoverage))part.requirementCoverage=
        (planPart?.requirements||[]).map(requirement=>({requirementId:requirement.id,
         status:part.answerStatus||part.status,
         answerClaimIds:(part.directAnswerClaimIds.length?part.directAnswerClaimIds:partClaims
          .slice(0,1).map(claim=>claim.claimId))}));
      }
      if(decorateSubject)for(const claim of reviewObject.claims){
       const answerClaim=payload.claims.find(item=>item.claimId===claim.claimId);
       const text=String(answerClaim?.text||'');
       const people=claimPersonSubjects(text);
       if(!people.length)continue;
       const sourceIds=answerClaim?.sourceIds||[];
       if(!Array.isArray(claim.sources)&&sourceIds.length&&Array.isArray(claim.spanIds))
        claim.sources=sourceIds.map(sourceId=>({sourceId,
         status:claim.status||'answered',spanIds:claim.spanIds.filter(id=>String(id).startsWith(sourceId+'-'))}));
       for(const [index,source] of (Array.isArray(claim.sources)?claim.sources:[]).entries()){
        if(source.subjectAttributionStatus===undefined){
         source.subjectAttributionStatus='supported';
         source.attributedSubject=people[Math.min(index,people.length-1)];
        }
       }
      }
      if(decorateClauses)for(const claim of reviewObject.claims){
       if(Array.isArray(claim.clauses))continue;
       const sourceIds=payload.claims.find(item=>item.claimId===claim.claimId)?.sourceIds||[];
       const sourceDecisions=Array.isArray(claim.sources)?claim.sources:
        sourceIds.map(sourceId=>({sourceId,
         status:claim.status||'answered',
         spanIds:(Array.isArray(claim.spanIds)?claim.spanIds:[])
          .filter(spanId=>String(spanId).startsWith(sourceId+'-'))}));
       claim.clauses=[{text:payload.claims.find(item=>item.claimId===claim.claimId)?.text||'',
        status:claim.status||'answered',issueCode:'none',
        sources:sourceDecisions.map(item=>({sourceId:item.sourceId,
         status:item.status||claim.status||'answered',spanIds:item.spanIds||[]}))}];
      }
      return {...result,response:JSON.stringify(reviewObject)};
     }
    }catch{}
   }
   return result;}};
}

// Batch 24 (B24-1): the zero-accept rescue re-review adds one call
// for a source-required part whose review accepted nothing. Fixtures
// written before batch 24 that queue a downstream response (answer
// repair, gate repair, re-review) insert this stub after the review
// response so the rescue rejects every requested pair and the rest of
// the sequence runs exactly as before.
function rescueRejection(){
 return (_model,{messages})=>{
  const payload=JSON.parse(messages[1].content);
  return {response:JSON.stringify({decisions:(payload.decisions||[]).map(item=>({
   claimId:item.claimId,sourceId:item.sourceId,verdict:'not-supported',
   fragment:item.spans?.[0]?.text||'no support'}))})};
 };
}

test('selected-books hypothetical answers recover author groups from verified source titles when planning was skipped',async()=>{
 const question='What would Nietzsche think about Kierkegaard’s account of faith?';
 const sources=[
  {id:'S1',bookId:'140',title:'Fear and Trembling — Søren Kierkegaard',page:34,
   text:'Faith is this paradox, and the individual absolutely cannot make himself intelligible to anybody.',
   preview:'Faith is this paradox, and the individual cannot make himself intelligible.'},
  {id:'S2',bookId:'144',title:'On the Genealogy of Morals — Friedrich Nietzsche',page:84,
   text:'Our faith in scientific knowledge still rests on a metaphysical belief: that God is the truth and the truth is divine.',
   preview:'Our faith in scientific knowledge rests on the belief that God is the truth.'}
 ];
 const ai=makeAI([answer('PART P1\nNietzsche questions Christian faith’s claim to truth. [S2]\n'+
  'PART P2\nJohannes de Silentio presents faith as a paradox that cannot be made intelligible to others. [S1]\n'+
  'PART P3\nAs a cautious reader inference, Nietzsche might question whether Johannes de Silentio’s account establishes truth about God. [S1, S2]'),
  review([['P1','answered'],['P2','answered'],['P3','answered']]),
  review([['P1','answered'],['P2','answered'],['P3','answered']]),
  review([['P1','answered'],['P2','answered'],['P3','answered']])]);
 const result=await composeEvidenceAnswer(question,sources,ai,[],{catalog:{
  140:'Fear and Trembling — Søren Kierkegaard',
  144:'On the Genealogy of Morals — Friedrich Nietzsche'},trace:true,review:true});
 assert.equal(result.trace.plan.intent,'compare');
 assert.deepEqual(result.trace.plan.sources.map(source=>source.label),
  ['Friedrich Nietzsche','Søren Kierkegaard']);
 assert.deepEqual(result.trace.plan.parts.map(part=>part.sourceBookIds),
  [['144'],['140'],['144','140']]);
 assert.deepEqual(result.questionParts.map(part=>part.status),['supported','supported','supported']);
 assert.equal(ai.calls.length,4,'the reconstructed plan uses the existing composition and one review call per part');
});

test('curated provenance is title-guarded and distinguishes pseudonymous work voice from page voice',()=>{
 const plan={sources:[{role:'primary',bookIds:['140']}]};
 const fear=sourceProvenance({bookId:'140',title:'Fear and Trembling — Søren Kierkegaard',page:32},plan);
 assert.deepEqual(fear.workVoice,{kind:'pseudonymous-author',name:'Johannes de Silentio',creditedAuthor:'Søren Kierkegaard'});
 assert.equal(fear.pageVoice,undefined,'work-level pseudonym does not assert that every page sentence uses that voice');
 const mismatched=sourceProvenance({bookId:'140',title:'Unrelated work — Someone Else',page:32},plan);
 assert.equal(mismatched.workVoice,undefined,'a changed catalog title disables curated metadata');
 const intro=sourceProvenance({bookId:'185',title:'Last Writings: Nothingness and the Religious Worldview — Kitarō Nishida',page:18},
  {sources:[{role:'primary',bookIds:['185']}]},'INTRODUCTION\nA discussion of Nishida follows.');
 assert.deepEqual(intro.pageVoice,{kind:'editorial-introduction',name:'David A. Dilworth',creditedAuthor:'Kitarō Nishida'});
 const intro17=sourceProvenance({bookId:'185',title:'Last Writings: Nothingness and the Religious Worldview — Kitarō Nishida',page:17},
  {sources:[{role:'primary',bookIds:['185']}]},'26\nIntroduction\nNishida describes the logic of soku hi.');
 assert.deepEqual(intro17.pageVoice,{kind:'editorial-introduction',name:'David A. Dilworth',creditedAuthor:'Kitarō Nishida'});
 const NishidaText=sourceProvenance({bookId:'185',title:'Last Writings: Nothingness and the Religious Worldview — Kitarō Nishida',page:48},
  {sources:[{role:'primary',bookIds:['185']}]},'The religious self is self-determining by transcending the here and now.');
 assert.equal(NishidaText.pageVoice,undefined,'the main essay remains distinguishable from Dilworth’s introduction');
 const portableTitle='The Portable Nietzsche — Friedrich Nietzsche (edited by Walter Kaufmann)';
 const portablePage=sourceProvenance({bookId:'239',title:portableTitle,page:578},
  {sources:[{role:'primary',bookIds:['239']}]});
 assert.deepEqual(portablePage.pageVoice,{kind:'editorial-commentary',name:'Walter Kaufmann',creditedAuthor:'Friedrich Nietzsche'});
 assert.equal(sourceProvenance({bookId:'239',title:portableTitle,page:547},
  {sources:[{role:'primary',bookIds:['239']}] }).pageVoice,undefined,
  'direct Nietzsche text elsewhere in the volume does not inherit the page-578 editorial label');
 const kalupahana=sourceProvenance({bookId:'178',title:'Mūlamadhyamakakārikā — Nāgārjuna',page:88},
  {sources:[{role:'primary',bookIds:['178']}]},
  'THE PHILOSOPHY OF THE MIDDLE WAY\nWith that analysis, Nagarjuna was ready to defend the four noble truths.');
 assert.deepEqual(kalupahana.pageVoice,
  {kind:'editorial-introduction',name:'David J. Kalupahana',creditedAuthor:'Nāgārjuna'});
 for(const page of [104,164]){
  const commentary=sourceProvenance({bookId:'178',title:'Mūlamadhyamakakārikā — Nāgārjuna',page},
   {sources:[{role:'primary',bookIds:['178']}]},
   page===104?'These two verses show that the Madhyamikas have a positive thesis.':
    'Nāgārjuna used the middle path to avoid the extremes described above.');
  assert.deepEqual(commentary.pageVoice,
   {kind:'editorial-commentary',name:'David J. Kalupahana',creditedAuthor:'Nāgārjuna'});
  assert.equal(commentary.pageSectionHint,'commentary');
  assert.match(commentary.pageVoiceHint,/commentary by David J\. Kalupahana/);
 }
 assert.equal(sourceProvenance({bookId:'178',title:'Mūlamadhyamakakārikā — Nāgārjuna',page:100},
  {sources:[{role:'primary',bookIds:['178']}] }).pageVoice,undefined,
  'the introduction attribution does not spill over to Nagarjuna’s translated text');
});

test('editorial commentary cannot be surfaced as the credited author speaking without mediation',async()=>{
 const title='The Portable Nietzsche — Friedrich Nietzsche (edited by Walter Kaufmann)';
 const source={...hume,id:'S1',bookId:'239',title,page:578,
  text:'Kaufmann discusses Nietzsche’s view of the New Testament in this editorial passage.',
  preview:'Kaufmann discusses Nietzsche’s view of the New Testament in this editorial passage.'};
 const plan={...onePartPlan,sources:[{label:'Friedrich Nietzsche',role:'primary',bookIds:['239']}],
  parts:[{...onePartPlan.parts[0],question:'What did Nietzsche say about Christianity?',sourceBookIds:['239'],candidateSourceIds:['S1']}]};
 const run=async(draft)=>{
  const ai=makeAI([answer('PART P1\n'+draft),(_model,{messages})=>{
   const payload=parsePayload(messages),claim=payload.claims[0],sourceDecision=claim.sourceEvidence[0];
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered'}],claims:[{
    claimId:claim.claimId,status:'answered',sources:[{sourceId:'S1',status:'answered',
     spanIds:[sourceDecision.spanIds[0]]}]}]})};
  }]);
  return composeEvidenceAnswer('What did Nietzsche say about Christianity?',[source],ai,[],
   {plan,catalog:{...catalog,239:title},trace:true});
 };
 const unqualified=await run('Nietzsche argued that the New Testament represented a decline. [S1]');
 assert.equal(unqualified.coverage,'none');
 assert.ok(unqualified.trace.reviewContract.supportIssues.some(issue=>
  issue.reason==='editorial-source-attribution-unqualified'));
 assert.doesNotMatch(unqualified.answer,/Nietzsche argued/);
 const mediated=await run('Kaufmann’s commentary presents Nietzsche as viewing the New Testament as a decline. [S1]');
 assert.equal(mediated.coverage,'full');
 assert.match(mediated.answer,/Kaufmann’s commentary/);
});

test('known Kalupahana commentary pages cannot be stated as Nagarjuna speaking directly',async()=>{
 const title='Mūlamadhyamakakārikā — Nāgārjuna';
 const source={id:'S1',bookId:'178',title,page:164,url:'https://example.test/nagarjuna#page=164',
  text:'These two verses explain that the Madhyamikas have a positive thesis about the middle path.',
  preview:'These two verses explain that the Madhyamikas have a positive thesis about the middle path.'};
 const plan={version:'reader-evidence-v2',intent:'explain',
  sources:[{label:'Nāgārjuna',role:'primary',bookIds:['178']}],
  parts:[{id:'P1',question:'What is sunyata?',sourceBookIds:['178'],searchQueries:['sunyata'],candidateSourceIds:['S1']}]};
 const ai=makeAI([answer('PART P1\nNagarjuna intended to establish a positive thesis about the middle path. [S1]'),
  (_model,{messages})=>{
   const payload=parsePayload(messages),claim=payload.claims[0];
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered'}],claims:[{
    claimId:claim.claimId,status:'answered',sources:[{sourceId:'S1',status:'answered',
     spanIds:[claim.sourceEvidence[0].spanIds[0]]}]}]})};
  }]);
 const result=await composeEvidenceAnswer('What is sunyata?',[source],ai,[],
  {plan,catalog:{178:title},trace:true});
 assert.equal(result.coverage,'none');
 assert.ok(result.trace.reviewContract.supportIssues.some(issue=>
  issue.reason==='editorial-source-attribution-unqualified'&&issue.sourceId==='S1'));
 assert.doesNotMatch(result.answer,/Nagarjuna intended/);
});

test('a pronoun-led claim preserves editorial mediation from the named-author antecedent',async()=>{
 const portableTitle='The Portable Nietzsche — Friedrich Nietzsche (edited by Walter Kaufmann)';
 const directTitle='On the Genealogy of Morals — Friedrich Nietzsche';
 const sources=[
  {...hume,id:'S1',bookId:'54',title:directTitle,page:46,
   text:'Nietzsche criticized the moral ideals of Christianity.',
   preview:'Nietzsche criticized the moral ideals of Christianity.'},
  {...hume,id:'S2',bookId:'239',title:portableTitle,page:578,
   text:'Kaufmann discusses Nietzsche’s view of the New Testament. In The Antichrist itself, Nietzsche cites Luke 6:23, and Kaufmann comments on what that citation represents.',
   preview:'Kaufmann discusses Nietzsche’s view of the New Testament. In The Antichrist itself, Nietzsche cites Luke 6:23, and Kaufmann comments on what that citation represents.'}
 ];
 const plan={...onePartPlan,
  sources:[{label:'Friedrich Nietzsche',role:'primary',bookIds:['54','239']}],
  parts:[{...onePartPlan.parts[0],question:'What did Nietzsche think about Christianity?',
   sourceBookIds:['54','239'],candidateSourceIds:['S1','S2']}]};
 const run=async(secondSentence)=>{
  const ai=makeAI([answer('PART P1\nNietzsche argued that Christianity’s moral ideals were life-denying. [S1] '+secondSentence),
   (_model,{messages})=>{
    const payload=parsePayload(messages);
    const unmediatedCommentary=payload.claims.some(claim=>claim.sourceIds.includes('S2')&&
     !/According to Kaufmann’s commentary/.test(claim.text));
    return {response:JSON.stringify({parts:[{partId:'P1',status:unmediatedCommentary?'partial':'answered'}],
     claims:payload.claims.map(claim=>({claimId:claim.claimId,status:'answered',
      sources:claim.sourceIds.map(sourceId=>({sourceId,status:'answered',
       spanIds:[claim.sourceEvidence.find(item=>item.sourceId===sourceId).spanIds[0]]}))}))})};
   }]);
  return composeEvidenceAnswer('What did Nietzsche think about Christianity?',sources,ai,[],{
   plan,catalog:{...catalog,54:directTitle,239:portableTitle},trace:true
  });
 };
 const unmediated=await run('He characterized the New Testament as representing the outcasts and sinners of Judaism rather than progress over the Old Testament. [S2]');
 assert.equal(unmediated.coverage,'partial');
 assert.ok(unmediated.trace.reviewContract.supportIssues.some(issue=>
  issue.reason==='editorial-source-attribution-unqualified'&&issue.sourceId==='S2'));
 assert.doesNotMatch(unmediated.answer,/He characterized/);
 const mediated=await run('According to Kaufmann’s commentary, he characterized the New Testament as representing the outcasts and sinners of Judaism rather than progress over the Old Testament. [S2]');
 assert.equal(mediated.coverage,'full');
 assert.match(mediated.answer,/According to Kaufmann’s commentary/);
});

test('review span IDs map only to exact contiguous source slices and stay within the prompt bound',()=>{
 const text='A first short sentence. '+('A long sentence contains a precise claim and supporting qualification. '.repeat(8))+
  'A final sentence.';
 const spans=buildReviewSpans('S7',text);
 assert.ok(spans.length>2);
 assert.equal(new Set(spans.map(span=>span.spanId)).size,spans.length);
 for(const span of spans){
  assert.ok(span.text.length>=12&&span.text.length<=320);
  assert.equal(text.slice(span.start,span.end),span.text);
  assert.ok(text.includes(span.text));
 }
 assert.ok(spans.every(span=>/^S7-Q[1-9]\d*$/.test(span.spanId)));
 assert.deepEqual(buildReviewSpans('not-a-source',text),[]);
});
test('review spans put direct paraphrase evidence first without discarding other spans',()=>{
 const text='A historical introduction recounts debates about institutions, books, readers, editions, publication, libraries, translations, commentaries, editors, authors, scholars, chronology, archives, and the long development of literary criticism across several generations. No immediate transition from a proof of probability to faith is possible. The author then considers another example.';
 const spans=buildReviewSpans('S5',text);
 const ranked=rankReviewSpans(spans,{question:'What does faith require?',
  answer:'There is no immediate transition from proof of probability to faith.'});
 assert.match(ranked[0].text,/^No immediate transition from a proof of probability to faith is possible\./);
 assert.deepEqual(new Set(ranked.map(span=>span.spanId)),new Set(spans.map(span=>span.spanId)));
 assert.ok(ranked.every(span=>text.includes(span.text)));
});
test('requirement span ranking reserves an exact topical match and skips zero-match spans',()=>{
 const spans=[
  {spanId:'S1-Q1',text:'The custom of repeated conjunction trains the mind to expect one event after another.'},
  {spanId:'S1-Q2',text:'The author discusses a broad history of books, editors, and philosophical schools.'}
 ];
 assert.deepEqual(selectRequirementReviewSpans(spans,{
  requirement:'Habitual expectation follows repeated conjunction.',
  questionAnchor:'what role does custom play?'
 }).map(span=>span.spanId),['S1-Q1']);
 assert.deepEqual(selectRequirementReviewSpans(spans,{
  requirement:'zqvblorp flibbertigibbet',
  questionAnchor:'xyzzynotfound'
 }),[],'an empty lexical match leaves the existing broad fallback in control');
});
test('composer windows use requirement text within the same per-source span cap and trace the selection',async()=>{
 const question='How does Hume explain causal necessity, and what role does custom play?';
 const distractors=Array.from({length:18},(_,index)=>
  `Hume discusses custom and causal necessity in this broad introductory passage ${index+1}.`);
 const target='Repeated conjunction creates habitual expectation, training the mind to infer one event from another.';
 const text=[...distractors,target,'A final passage summarizes the surrounding discussion without adding a mechanism.'].join('\n\n');
 const source={...hume,text,preview:text,candidatePartIds:['P1']};
 const spans=buildReviewSpans('S1',text);
 const plan={...onePartPlan,resolvedQuestion:question,parts:[{
  id:'P1',question:'How does Hume explain causal necessity?',sourceBookIds:['35'],
  searchQueries:['Hume custom causal necessity'],candidateSourceIds:['S1'],
  requirements:[{id:'P1-R1',text:'Repeated conjunction forms habitual expectation.',
   questionAnchor:'what role does custom play?'}]
 }]};
 const baseline=selectReviewPacketSpans(spans,{question,
  answer:'How does Hume explain causal necessity? Hume custom causal necessity',limit:8});
 const targetSpan=spans.find(span=>span.text.includes(target));
 assert.ok(targetSpan);
 assert.ok(!baseline.some(span=>span.spanId===targetSpan.spanId),
  'the baseline question/query-only rank misses the requirement-specific passage');
 const ai=makeAI([answer('PART P1\nHume explains that repeated conjunction trains expectation.'),
  review([['P1','answered']],{includeEvidence:false})]);
 const result=await composeEvidenceAnswer(question,[source],ai,[],{plan,catalog,trace:true});
 const selected=result.trace.composerWindowSelection.find(item=>item.sourceId==='S1').selectedSpans;
 assert.ok(selected.some(item=>item.spanId===targetSpan.spanId&&item.requirementIds.includes('P1-R1')));
 assert.ok(selected.length<=8,'selected spans remain within the existing per-source cap');
 const payload=parsePayload(ai.calls[0].request.messages);
 assert.ok(payload.evidence[0].passages.some(window=>window.spanIds.includes(targetSpan.spanId)),
  'the composer receives the requirement-selected exact span');
 assert.ok(payload.evidence[0].passages.every(window=>!Object.hasOwn(window,'requirementIds')),
  'selection metadata is recorded in the trace and does not enlarge the model payload');
});
test('review hint ranking promotes the run-17 Boethius wealth and completeness passage',()=>{
 const spans=[
  {spanId:'S4-Q1',text:"Fortune's gift of happiness, you must listen while I recall how many and how great are your sources of happiness: and thus, if you have possessed that which is the most precious among all Fortune's gifts, and if that is"},
  {spanId:'S4-Q2',text:'still safe and unharmed in your possession, you will never, while you keep these better gifts, be able to justly charge Fortune with unkindness.'},
  {spanId:'S4-Q5',text:'Again, your wife lives, a woman whose character is full of virtue, whose modesty excels its kind; a woman who (to put in a word the gifts she brought you) is like her father.'},
  {spanId:'S4-Q9',text:"Fortune's hatred has not yet been so great as to destroy all your holds upon happiness: the tempest that is fallen upon you is not too great for you: your anchors hold yet firm, and they should keep ever nigh to"},
  {spanId:'S4-Q15',text:"For the condition of our welfare is a matter fraught with care: either its completeness never appears, or it never remains. One man's wealth is abundant, but his birth and breeding put him to shame."}
 ];
 const ranked=rankReviewSpans(spans,{
  question:"What do Lady Philosophy's descriptions of Fortune's gifts reveal about the nature of true happiness?",
  answer:"Her assessment of Fortune's gifts suggests that external prosperity is unreliable because it is often incomplete or temporary."
 });
 assert.equal(ranked.length,spans.length,'ranking must preserve the complete exact-span set');
 assert.ok(ranked.slice(0,4).some(span=>span.spanId==='S4-Q15'),
  'wealth/prosperity, completeness/incompleteness, and temporary/remains cues should surface the direct passage in the four claim hints');
 const exactFirst=rankReviewSpans([
  {spanId:'S1-Q1',text:'The wealth remains secure.'},
  {spanId:'S1-Q2',text:'The prosperity remains secure.'}
 ],{answer:'Wealth is secure.'});
 assert.equal(exactFirst[0].spanId,'S1-Q1',
  'exact normalized overlap must outrank a related-family hint');
});
test('review request orders the cited page by the answer sentence while preserving span IDs',async()=>{
 const text='A historical introduction recounts debates about institutions, books, readers, editions, publication, libraries, translations, commentaries, editors, authors, scholars, chronology, archives, and the long development of literary criticism across several generations. No immediate transition from a proof of probability to faith is possible. The author then considers another example.';
 const source={...hume,text,preview:text};
 let reviewPayload;
 const ai={run:async(_model,{messages})=>{
  const system=messages[0].content;
  if(system.startsWith('Answer the reader'))return answer('PART P1\nNo transition from proof of probability to faith is possible. [S1]');
  reviewPayload=parsePayload(messages);
  const selected=reviewPayload.parts[0].evidence[0].spans[0];
  const claim=reviewPayload.claims[0];
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',directAnswerClaimIds:['P1-C1']}],
   claims:[{claimId:claim.claimId,status:'answered',spanIds:[selected.spanId],clauses:[{
    text:claim.text,status:'answered',issueCode:'none',sources:[{sourceId:'S1',
     status:'answered',spanIds:[selected.spanId]}]}]}]})};
 }};
 const result=await composeEvidenceAnswer('What is the relation between faith and probability?',[source],ai,[],{
  catalog,plan:{intent:'explain',sources:[{label:'David Hume',role:'primary',bookIds:['35']}],
   parts:[{id:'P1',question:'How does the text relate probability and faith?',sourceBookIds:['35']}],
   queries:['Hume probability faith']}
 });
 assert.match(reviewPayload.parts[0].evidence[0].spans[0].text,/^No immediate transition/);
 assert.equal(result.coverage,'full');
 assert.equal(result.evidenceMap[0].quote,reviewPayload.parts[0].evidence[0].spans[0].text);
});
test('the bounded review packet keeps a required direct-answer passage when broader claims crowd it out',async()=>{
 const question='What do the gifts of Fortune reveal about the nature of true happiness?';
 const claims=[
  'The gifts of Fortune reveal that true happiness cannot be found in external, shifting circumstances but must be sought within oneself.',
  "Lady Philosophy observes that Fortune's gifts, such as wealth, are not truly one's own because they rely on the nature of others and can be lost or diminished when transferred.",
  'She explains that if happiness is tied to things that can be taken away, such as the stability of the body, then mortals are constantly on the verge of wretchedness.',
  'Consequently, true happiness requires being master of oneself, as this provides a possession that Fortune can never seize.'
 ];
 const text=[
  'snatched away, is not the highest good (since that which is best cannot be snatched away), it is plain that Fortune by its own uncertainty can never come near to reaching happiness.',
  'you cannot doubt that, if death can carry away happiness, the whole race of mortals is sinking into wretchedness to be found upon the border of death.',
  'But we know that many have sought the enjoyment of happiness not only by death, but even by sorrow and sufferings: how then can the presence of this life make us happy, when its end cannot make us unhappy?',
  "You, I know well, are firmly persuaded that men's understandings can never die; this truth is planted deep in you by many proofs: since then it is plain that the happiness of fortune is bounded by the death of the body,",
  'If the gifts of Fortune fade not nor pass quickly away, even so, what is there in them which could ever be truly yours, or which would not lose its value when examined or thought upon?',
  'If he knows it, he must needs live in fear of losing that which he cannot doubt that he may lose; wherefore an ever-present fear allows not such an one to be happy.',
  'But that cannot remain with one person which is handed over to another: therefore money becomes valuable to its possessor when, by being scattered, it is transferred to others, and ceases to be possessed.',
  'If then you are master of yourself, you will be in possession of that which you will never wish to lose, and which Fortune will never be able to take from you.',
  "Are riches valuable for their own nature, or on account of your and other men's natures? Which is the more valuable, the gold itself or the power of the stored up-money?",
  'delights the care-ridden. Wherefore, then, O mortal men, seek ye that happiness without, which lies within yourselves? Ye are confounded by error and ignorance.'
 ].join('\n\n\n');
 const source={id:'S1',bookId:'21',title:'The Consolation of Philosophy — Boethius',page:14,
  candidatePartIds:['P1'],text,preview:text};
 const allAnswerText=claims.join(' ');
 const allSpans=buildReviewSpans(source.id,text);
 const oldPacket=rankReviewSpans(allSpans,{question,answer:allAnswerText}).slice(0,8);
 const requiredClaimSpans=rankReviewSpans(allSpans,{question,answer:claims[0]});
 const directPassage=allSpans.find(span=>/happiness without|lies within yourselves/i.test(span.text));
 assert.ok(!oldPacket.some(span=>span.spanId===directPassage.spanId),
  'the broad answer ranking reproduces the run-22 omission');
 assert.ok(requiredClaimSpans.slice(0,6).some(span=>span.spanId===directPassage.spanId),
  'the direct-answer ranking finds the missing passage within its six-candidate window');

 let reviewPayload;
 const ai=makeAI([answer('PART P1\n'+claims.map(claim=>claim+' [S1]').join('\n\n')),
  (_model,{messages})=>{
   reviewPayload=parsePayload(messages);
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
    directAnswerClaimIds:[reviewPayload.parts[0].requiredAnswerClaimId]}],
    claims:reviewPayload.claims.map(claim=>({claimId:claim.claimId,status:'answered',
     sources:claim.sourceIds.map(sourceId=>({sourceId,status:'answered',spanIds:[
      claim.sourceEvidence.find(item=>item.sourceId===sourceId).spanIds[0]]}))}))})};
  }],{decorateReview:false});
 const result=await composeEvidenceAnswer(question,[source],ai,[],{
  plan:{intent:'explain',sources:[{label:'Boethius',role:'primary',bookIds:['21']}],
   parts:[{id:'P1',question,sourceBookIds:['21'],candidateSourceIds:['S1']}]},
  catalog:{21:source.title},trace:true
 });
 const packet=reviewPayload.parts[0].evidence[0].spans;
 assert.equal(packet.length,8,'claim priority keeps the existing per-source packet cap');
 assert.ok(packet.some(span=>/happiness without|lies within yourselves/i.test(span.text)),
  'the required direct-answer passage reaches review despite its lower broad-answer rank');
 assert.equal(packet.filter(span=>oldPacket.some(old=>old.spanId===span.spanId)).length,7,
  'only the lowest broad-ranked span is displaced to protect the direct answer');
 assert.equal(result.questionParts[0].status,'supported');
 assert.equal(ai.calls.length,2,'the handoff improvement adds no model call');
});
test('compact review decisions validate exact spans without rationale text or repeated payload fields',async()=>{
 let reviewPayload;
 const ai={run:async(_model,{messages,max_completion_tokens})=>{
  if(messages[0].content.startsWith('Answer the reader'))return answer('PART P1\nHume links necessity to custom and regular conjunction. [S1]');
  reviewPayload=parsePayload(messages);
  const claim=reviewPayload.claims[0],span=reviewPayload.parts[0].evidence[0].spans[0];
  assert.equal(max_completion_tokens,messages[0].content.startsWith('Answer the reader')?1800:1420);
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',directAnswerClaimIds:[claim.claimId]}],
   claims:[{claimId:claim.claimId,status:'answered',sources:[{sourceId:'S1',status:'answered',
    subjectAttributionStatus:'supported',attributedSubject:'Hume',
    spanIds:[span.spanId,...reviewPayload.parts[0].evidence[0].spans.slice(1,2).map(item=>item.spanId)]}],
    clauses:[{text:claim.text,status:'answered',issueCode:'none',sources:[{sourceId:'S1',
     status:'answered',spanIds:[span.spanId]}]}]}]})};
 }};
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true
 });
 assert.equal(result.outcome,'verified-source-draft');
 assert.equal(result.coverage,'full');
 assert.equal(result.evidenceMap.length,1,'the Worker keeps at most one exact span per cited page');
 assert.equal(result.failureCode,undefined);
 assert.deepEqual(result.evidenceMap.map(item=>item.quote),[reviewPayload.parts[0].evidence[0].spans[0].text]);
 assert.deepEqual(Object.keys(reviewPayload.claims[0]).sort(),['claimId','partId','sourceEvidence','sourceIds','text']);
 assert.deepEqual(reviewPayload.sourceCatalog.S1.sourceGroup,{label:'David Hume',role:'primary'});
 assert.deepEqual(reviewPayload.claims[0].sourceEvidence[0],{sourceId:'S1',
  spanIds:reviewPayload.claims[0].sourceEvidence[0].spanIds});
 assert.equal('candidateSourceIds' in reviewPayload.parts[0],false);
 assert.equal('sha256' in reviewPayload.parts[0].evidence[0],false);
});

test('review payload sends repeated exact spans and shared context text once with part-scoped references',async()=>{
 const plan={...onePartPlan,parts:[
  {id:'P1',question:'How does Hume explain necessity?',sourceBookIds:['35'],candidateSourceIds:['S1']},
  {id:'P2',question:'How does Hume explain causal expectation?',sourceBookIds:['35'],candidateSourceIds:['S1']}
 ]};
 const rawReviewPayloads=[];
 const fullText=hume.text+'\n\nThe discussion also notes that experience shapes expectations in ordinary life.';
 const captureReview=(_model,{messages})=>{
  rawReviewPayloads.push(JSON.parse(messages[1].content));
  return review([['P1','answered'],['P2','answered']])(_model,{messages});
 };
 const ai=makeAI([answer('PART P1\nHume links necessity to custom. [S1]\n\n'+
  'PART P2\nHume links causal expectation to repeated experience. [S1]'),
  captureReview,captureReview]);
 const result=await composeEvidenceAnswer('How does Hume explain necessity and causal expectation?',
  [{...hume,text:fullText,scopeText:hume.text}],ai,[],{plan,catalog,trace:true});
 assert.equal(result.outcome,'verified-source-draft');
 assert.equal(rawReviewPayloads.length,2,'each part is reviewed in its own call');
 assert.deepEqual(rawReviewPayloads.map(payload=>payload.parts.map(part=>part.partId)),
  [['P1'],['P2']],'each review payload contains only its own part');
 // The compacting guarantees now hold within each per-part payload: exact
 // span text and source metadata are each transmitted once per call, and
 // evidence entries link to them by ID instead of repeating them.
 for(const [index,rawReviewPayload] of rawReviewPayloads.entries()){
  const sourceRefs=rawReviewPayload.parts.map(part=>part.evidence[0]);
  assert.ok(sourceRefs.every(item=>Array.isArray(item.spanIds)));
  assert.ok(sourceRefs.every(item=>!Object.hasOwn(item,'spans')));
  assert.deepEqual(rawReviewPayload.spanCatalog.map(span=>span.spanId),
   [...new Set(sourceRefs.flatMap(item=>item.spanIds))],
   'the span catalog contains one text record per distinct exact span');
  assert.equal(rawReviewPayload.sourceContexts.length,1,
   'the source context text is transmitted once per part payload');
  assert.ok(sourceRefs.every(item=>!Object.hasOwn(item,'contextSourceId')),
   'the evidence id already links to its optional source context');
  assert.ok(sourceRefs.every(item=>!Object.hasOwn(item,'sourceDetailsId')),
   'the evidence id already keys shared metadata when no per-part metadata variant exists');
  const reviewStage=result.trace.stages.filter(stage=>stage.stage==='review')[index];
  assert.equal(reviewStage.partId,rawReviewPayload.parts[0].partId);
  assert.equal(reviewStage.payloadMetrics.spanCount,rawReviewPayload.spanCatalog.length);
  assert.equal(reviewStage.payloadMetrics.sourceMetadataCount,1,
   'repeated source title, page, and provenance metadata is represented once');
  assert.equal(reviewStage.payloadMetrics.spanReferenceCount,
   sourceRefs.reduce((n,item)=>n+item.spanIds.length,0));
  assert.equal(reviewStage.payloadMetrics.systemPromptCharacters,REVIEW_PROMPT.length);
  assert.equal(reviewStage.payloadMetrics.requestCharacters,
   reviewStage.payloadMetrics.serializedCharacters+REVIEW_PROMPT.length,
   'workload diagnostics include both the fixed review instructions and variable evidence payload');
  assert.deepEqual(Object.keys(rawReviewPayload.sourceCatalog),['S1']);
  assert.ok(sourceRefs.every(item=>!Object.hasOwn(item,'title')&&!Object.hasOwn(item,'page')&&
   !Object.hasOwn(item,'provenance')&&!Object.hasOwn(item,'attributionRequirement')),
   'part-scoped source references retain IDs and span links without repeating source metadata');
  const previousShape={...rawReviewPayload,
   parts:rawReviewPayload.parts.map(part=>({...part,evidence:part.evidence.map(item=>({...item,
    sourceDetailsId:item.id,...(rawReviewPayload.sourceContexts?.some(context=>context.sourceId===item.id)?
     {contextSourceId:item.id}:{})}))})),
   claims:rawReviewPayload.claims.map(claim=>({...claim,sourceEvidence:claim.sourceEvidence.map(item=>({...item,
    sourceGroup:rawReviewPayload.sourceCatalog[item.sourceId].sourceGroup}))}))};
  assert.ok(JSON.stringify(rawReviewPayload).length<JSON.stringify(previousShape).length,
   'the compact shape removes repeated source-group, metadata-pointer, and context-pointer fields');
  const linksIntact=rawReviewPayload.claims.every(claim=>claim.sourceEvidence.every(item=>
   item.sourceId in rawReviewPayload.sourceCatalog&&item.spanIds.every(id=>
    rawReviewPayload.parts.some(part=>part.evidence.some(evidence=>evidence.id===item.sourceId&&
     evidence.spanIds.includes(id))))));
  assert.ok(linksIntact,'payload compaction keeps each claim source and its part-scoped span hints intact');
 }
 assert.match(REVIEW_PROMPT,/Never borrow a span from another part/);
 assert.match(REVIEW_PROMPT,/look them up using sourceDetailsId when present, otherwise use the evidence entry's id/);
});


test('source-grouped review makes each cited source decision explicit and keeps a missing side partial',async()=>{
 const plan={...twoSidePlan,parts:[{id:'P1',question:'How do Hume and Kant differ?',sourceBookIds:['35','40'],
  candidateSourceIds:['S1','S2']}]};
 const ai=makeAI([answer('PART P1\nHume grounds necessity in custom, while Kant treats causality as a priori. [S1, S2]'),
  (_model,{messages})=>{
   const payload=parsePayload(messages),claim=payload.claims[0];
   const sourceDecision=(sourceId,status)=>({sourceId,status,spanIds:status==='answered'?
    [claim.sourceEvidence.find(item=>item.sourceId===sourceId).spanIds[0]]:[]});
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered'}],claims:[{
    claimId:claim.claimId,status:'answered',sources:[sourceDecision('S1','answered'),sourceDecision('S2','partial')]}]})};
  }]);
 const result=await composeEvidenceAnswer('How do Hume and Kant differ over causal necessity?',
  [{...hume,candidatePartIds:['P1']},{...kant,candidatePartIds:['P1']}],ai,[],{plan,catalog,trace:true});
 const payload=parsePayload(ai.calls[1].request.messages);
 assert.deepEqual(payload.claims[0].sourceIds,['S1','S2']);
 assert.deepEqual(payload.claims[0].sourceEvidence.map(item=>item.sourceId),['S1','S2']);
 assert.equal(result.coverage,'none');
 assert.ok(result.trace.reviewContract.supportIssues.some(issue=>
  issue.sourceId==='S2'&&issue.reason==='claim-source-not-supported'));
 assert.equal(result.evidenceMap.length,0);
 assert.equal(ai.calls.length,2,'missing repairability keeps the unsupported source side fail-closed without a repair round trip');
});
test('compatible duplicate same-source review entries merge spans while conflicting entries fail closed',async()=>{
 const run=async(second)=>{
  const ai=makeAI([answer('PART P1\nHume links necessity to custom and regular conjunction. [S1]'),
   (_model,{messages})=>{
    const payload=parsePayload(messages),claim=payload.claims[0],spanId=claim.sourceEvidence[0].spanIds[0];
    const first={sourceId:'S1',status:'answered',spanIds:[spanId],supportBoundary:'custom grounds expectation'};
    return {response:JSON.stringify({parts:[{partId:'P1',status:'answered'}],claims:[{
     claimId:claim.claimId,status:'answered',sources:[first,second(spanId)]}]})};
   }]);
  const result=await composeEvidenceAnswer('How does Hume explain necessity?',[{...hume,candidatePartIds:['P1']}],
   ai,[],{plan:onePartPlan,catalog,trace:true});
  return result;
 };
 const compatible=await run(spanId=>({sourceId:'S1',status:'answered',spanIds:[spanId],
  supportBoundary:'repeated conjunction guides inference'}));
 assert.equal(compatible.coverage,'full');
 assert.ok(compatible.trace.reviewContract.warnings.some(item=>
  item.code==='duplicate-claim-source-merged'&&item.sourceId==='S1'));
 assert.ok(!compatible.trace.reviewContract.issues.includes('duplicate-claim-source'));
 const conflicting=await run(spanId=>({sourceId:'S1',status:'partial',spanIds:[]}));
 assert.notEqual(conflicting.coverage,'full');
 assert.ok(conflicting.trace.reviewContract.issues.includes('duplicate-claim-source'));
});
test('a supported source in the same planned group keeps a claim when an alternate citation is weak',async()=>{
 const title='The Consolation of Philosophy — Boethius';
 const sources=[
  {id:'S1',bookId:'21',title,page:11,candidatePartIds:['P1'],
   text:'I turn my wheel and delight to make the lowest turn to the top, the highest to the bottom.',
   preview:'I turn my wheel and delight to make the lowest turn to the top.'},
  {id:'S2',bookId:'21',title,page:10,candidatePartIds:['P1'],
   text:'If Fortune begin to stay still, she is no longer Fortune. Her changing nature is her constant way.',
   preview:'If Fortune begin to stay still, she is no longer Fortune.'}
 ];
 const plan={version:'reader-evidence-v2',intent:'explain',
  sources:[{label:'Boethius',role:'primary',bookIds:['21']}],
  parts:[{id:'P1',question:'Why can Fortune not remain still?',sourceBookIds:['21'],
   searchQueries:['Fortune cannot remain still'],candidateSourceIds:['S1','S2']}]};
 const ai=makeAI([answer('PART P1\nFortune cannot be stayed; if she remained still, she would no longer be Fortune. [S1, S2]'),
  (_model,{messages})=>{
   const payload=parsePayload(messages),claim=payload.claims[0];
   const span=sourceId=>claim.sourceEvidence.find(item=>item.sourceId===sourceId).spanIds[0];
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered'}],claims:[{
    claimId:claim.claimId,status:'answered',sources:[
     {sourceId:'S1',status:'partial',spanIds:[span('S1')]},
     {sourceId:'S2',status:'answered',spanIds:[span('S2')]}
    ]}]})};
  }]);
 const result=await composeEvidenceAnswer('Why can Fortune not remain still?',sources,ai,[],
  {plan,catalog:{...catalog,21:title},trace:true});
 assert.equal(result.coverage,'full');
 assert.equal(result.questionParts[0].status,'supported');
 assert.match(result.answer,/\[S2\]$/);
 assert.doesNotMatch(result.answer,/\[S1, S2\]/);
 assert.deepEqual(result.citations.map(source=>source.id),['S2']);
 assert.deepEqual(result.evidenceMap.map(item=>item.id),['S2']);
 assert.ok(result.trace.reviewContract.supportIssues.some(issue=>
  issue.sourceId==='S1'&&issue.reason==='claim-source-not-supported'));
 assert.equal(result.trace.reviewContract.reviewDecisions.find(item=>item.sourceId==='S1').accepted,false);
 assert.equal(result.trace.reviewContract.reviewDecisions.find(item=>item.sourceId==='S2').accepted,true);
});
test('an explicitly rejected spanless alternate can be omitted when same-group evidence supports the claim',async()=>{
 const title='The Consolation of Philosophy — Boethius';
 const sources=[
  {id:'S1',bookId:'21',title,page:11,candidatePartIds:['P1'],
   text:'Fortune cannot remain constant, for change is her nature.',preview:'Change is Fortune’s nature.'},
  {id:'S2',bookId:'21',title,page:10,candidatePartIds:['P1'],
   text:'If Fortune begin to stay still, she is no longer Fortune. Her changing nature is her constant way.',
   preview:'If Fortune begin to stay still, she is no longer Fortune.'}
 ];
 const plan={version:'reader-evidence-v2',intent:'explain',
  sources:[{label:'Boethius',role:'primary',bookIds:['21']}],
  parts:[{id:'P1',question:'Why can Fortune not remain still?',sourceBookIds:['21'],
   candidateSourceIds:['S1','S2']}]};
 for(const rejectedStatus of ['partial','unanswered']){
  const ai=makeAI([answer('PART P1\nFortune cannot be stayed; if she remained still, she would no longer be Fortune. [S1, S2]'),
   (_model,{messages})=>{
    const payload=parsePayload(messages),claim=payload.claims[0];
    const span=claim.sourceEvidence.find(item=>item.sourceId==='S2').spanIds[0];
    return {response:JSON.stringify({parts:[{partId:'P1',status:'answered'}],claims:[{
     claimId:claim.claimId,status:'answered',sources:[
      {sourceId:'S1',status:rejectedStatus,spanIds:[]},
      {sourceId:'S2',status:'answered',spanIds:[span]}
     ]}]})};
   }]);
  const result=await composeEvidenceAnswer('Why can Fortune not remain still?',sources,ai,[],
   {plan,catalog:{...catalog,21:title},trace:true});
  assert.equal(result.coverage,'full',`${rejectedStatus} without spans is an explicit rejection, not an unresolved citation`);
  assert.match(result.answer,/\[S2\]$/);
  assert.deepEqual(result.citations.map(source=>source.id),['S2']);
  assert.ok(result.trace.reviewContract.supportIssues.some(issue=>
   issue.sourceId==='S1'&&issue.reason==='claim-source-not-supported'));
 }
});
test('a source marked answered without an accepted exact span still blocks subset promotion',async()=>{
 const title='The Consolation of Philosophy — Boethius';
 const sources=[
  {id:'S1',bookId:'21',title,page:11,candidatePartIds:['P1'],
   text:'Fortune cannot remain constant, for change is her nature.',preview:'Change is Fortune’s nature.'},
  {id:'S2',bookId:'21',title,page:10,candidatePartIds:['P1'],
   text:'If Fortune begin to stay still, she is no longer Fortune. Her changing nature is her constant way.',
   preview:'If Fortune begin to stay still, she is no longer Fortune.'}
 ];
 const plan={version:'reader-evidence-v2',intent:'explain',
  sources:[{label:'Boethius',role:'primary',bookIds:['21']}],
  parts:[{id:'P1',question:'Why can Fortune not remain still?',sourceBookIds:['21'],
   candidateSourceIds:['S1','S2']}]};
 const ai=makeAI([answer('PART P1\nFortune cannot be stayed; if she remained still, she would no longer be Fortune. [S1, S2]'),
  (_model,{messages})=>{
   const payload=parsePayload(messages),claim=payload.claims[0];
   const span=claim.sourceEvidence.find(item=>item.sourceId==='S2').spanIds[0];
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered'}],claims:[{
    claimId:claim.claimId,status:'answered',sources:[
     {sourceId:'S1',status:'answered',spanIds:[]},
     {sourceId:'S2',status:'answered',spanIds:[span]}
    ]}]})};
  }]);
 const result=await composeEvidenceAnswer('Why can Fortune not remain still?',sources,ai,[],
  {plan,catalog:{...catalog,21:title},trace:true});
 assert.equal(result.coverage,'none');
 assert.equal(result.questionParts[0].status,'unsupported');
 assert.equal(result.evidenceMap.length,0);
 assert.ok(result.trace.reviewContract.supportIssues.some(issue=>
  issue.sourceId==='S1'&&issue.reason==='missing-claim-source-span'));
});
test('compact review cannot verify a sentence unless every cited source has a selected span',async()=>{
 const ai=makeAI([answer('PART P1\nHume grounds necessity in custom, while Kant treats causality as a priori. [S1, S2]'),
  (_model,{messages})=>{
   const payload=parsePayload(messages),part=payload.parts[0],claim=payload.claims.find(claim=>claim.partId===part.partId);
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered'}],
    claims:[{claimId:claim.claimId,status:'answered',spanIds:['S1-Q1']}]})};
  }]);
 const plan={...twoSidePlan,parts:[{id:'P1',question:'How do Hume and Kant differ?',sourceBookIds:['35','40'],
  candidateSourceIds:['S1','S2']}]};
 const result=await composeEvidenceAnswer('How do Hume and Kant differ?',
  [{...hume,candidatePartIds:['P1']},{...kant,candidatePartIds:['P1']}],ai,[],{plan,catalog,trace:true});
 assert.equal(result.outcome,'insufficient-evidence');
 assert.equal(result.questionParts[0].status,'unsupported');
 assert.ok(result.trace.reviewContract.supportIssues.some(item=>item.reason==='missing-claim-source-span'));
 assert.equal(result.evidenceMap.length,0);
 assert.equal(ai.calls.length,2,'an incomplete source checklist does not trigger an unmarked repair');
});
test('review truncation gets one compact retry, then suppresses when the only part remains unvalidated',async()=>{
 const truncated={choices:[{finish_reason:'length',message:{content:'{"parts":[{"partId":"P1"'}}],
   usage:{neurons:3,prompt_tokens:500,completion_tokens:1800}};
 const ai=makeAI([answer('PART P1\nHume links necessity to custom and regular conjunction. [S1]'),
  truncated,truncated]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true
 });
 assert.equal(ai.calls.length,3,'the truncated review is retried once and no further call is made');
 assert.deepEqual(result.trace.reviewRetry,{attempted:true,reason:'review-output-truncated',applied:false,
  parts:[{partId:'P1',reason:'review-output-truncated',applied:false}]});
 assert.equal(result.outcome,'generation-failed');
 assert.equal(result.reviewStatus,'review-format-failed');
 assert.equal(result.failureCode,'review-output-truncated');
 assert.equal(result.failureStage,'review');
 assert.deepEqual(result.trace.reviewContract.issues,['review-output-truncated']);
 assert.equal(result.trace.stages[1].finishReason,'length');
 assert.equal(result.trace.stages[1].status,'failed');
 assert.equal(result.trace.stages[1].failureCode,'review-output-truncated');
 assert.ok(result.trace.stages[1].payloadMetrics.serializedCharacters>0);
 assert.equal(result.trace.final.reviewFailure.code,'review-output-truncated');
 assert.equal(result.answer,'I could not complete a reliable answer this time. Please try again.');
 assert.deepEqual(result.trace.reviewCompletion,{totalParts:1,unvalidatedPartIds:['P1'],
  disposition:'suppressed-not-strict-minority'});
 // Batch 7 (B7-5b): the failed review's deterministic fallback now
 // applies the union-coverage standard, and this claim's span covers
 // only two of its six content terms, so the weak link the batch-2
 // fallback used to attach is withheld. The draft itself still ships.
 assert.equal(result.trace.fallbackEvidence,undefined);
 assert.equal(result.evidenceMap.length,0);
});
test('claim-level review removes a sentence when its cited quote supports only a neighboring claim',async()=>{
 const text='The movement of infinity is the last stage preceding faith, so that he who has not made the movement of infinity cannot have faith.';
 const source={...hume,id:'S5',bookId:'140',title:'Fear and Trembling — Søren Kierkegaard',text,preview:text};
 const ai=makeAI([
  answer('PART P1\nJohannes de Silentio presents faith as following the movement of infinity. [S5] Faith is inwardness higher than outwardness. [S5]'),
  (_model,{messages})=>{
   const payload=parsePayload(messages),part=payload.parts[0],partClaims=payload.claims.filter(claim=>claim.partId===part.partId),quote=part.evidence[0].spans[0].spanId;
   return {response:JSON.stringify({parts:[{partId:'P1',status:'partial'}],claims:[
    {claimId:partClaims[0].claimId,status:'answered',spanIds:[quote]},
    {claimId:partClaims[1].claimId,status:'partial',spanIds:[]}
   ]})};
  }
 ]);
 const result=await composeEvidenceAnswer('What does Kierkegaard say about faith?',[source],ai,[],{
  catalog,plan:{intent:'explain',sources:[{label:'Søren Kierkegaard',role:'primary',bookIds:['140']}],
   parts:[{id:'P1',question:'What does Kierkegaard say about faith?',sourceBookIds:['140']}],queries:['Kierkegaard faith']},trace:true
 });
 assert.equal(result.coverage,'partial');
 assert.match(result.answer,/Johannes de Silentio presents faith as following the movement of infinity/);
 assert.doesNotMatch(result.answer,/inwardness higher than outwardness/);
 assert.deepEqual(result.evidenceMap.map(item=>({claimId:item.claimId,point:item.point})),[
  {claimId:'P1-C1',point:'Johannes de Silentio presents faith as following the movement of infinity.'}
 ]);
 assert.equal(result.evidenceMap[0].quote,text);
});

test('claim review can retain a narrower supported sentence without another AI call',async()=>{
 const text='Custom is the great guide of human life.';
 const source={...hume,id:'S1',bookId:'35',text,preview:text};
 const broad='Custom guides human life, and reason alone determines moral judgment.';
 const narrow='Custom is the great guide of human life.';
 const ai=makeAI([answer(`PART P1\n${broad} [S1]`),(_model,{messages})=>{
  const payload=parsePayload(messages),claim=payload.claims[0];
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',answerStatus:'answered',
   repairable:false,directAnswerClaimIds:[claim.claimId],retainedContextClaimIds:[]}],claims:[{
    claimId:claim.claimId,status:'partial',supportedText:narrow,sources:[{
     sourceId:'S1',status:'answered',spanIds:[claim.sourceEvidence[0].spanIds[0]],
     attributionStatus:'not_applicable',attributedSpeaker:''}]}]})};
 }]);
 const result=await composeEvidenceAnswer('What guides human life?',[source],ai,[],{
  catalog,plan:{intent:'explain',sources:[{label:'David Hume',role:'primary',bookIds:['35']}],
   parts:[{id:'P1',question:'What guides human life?',sourceBookIds:['35']}],queries:['Hume custom']},trace:true
 });
 assert.equal(ai.calls.length,2);
 assert.match(result.answer,/Custom is the great guide of human life\. \[S1\]/);
 assert.doesNotMatch(result.answer,/reason alone determines moral judgment/);
 assert.equal(result.evidenceMap[0].point,narrow);
 assert.equal(result.evidenceMap[0].quote,text);
 assert.ok(result.trace.reviewContract.reviewDecisions.some(item=>
  item.claimId==='P1-C1'&&item.supportedTextApplied===true&&item.acceptedText===narrow));
});

test('clause review narrows a partially supported causal claim and records each clause',async()=>{
 const broad='Custom leads us to infer one event from another, and reason alone establishes necessary connection.';
 const narrow='The mind is determined by custom to infer one from the other.';
 const ai=makeAI([answer(`PART P1\n${broad} [S1]`),(_model,{messages})=>{
  const payload=parsePayload(messages),claim=payload.claims[0];
  const spanId=claim.sourceEvidence[0].spanIds[0];
  return {response:JSON.stringify({
   parts:[{partId:'P1',status:'answered',answerStatus:'answered',repairable:false,
    directAnswerClaimIds:[claim.claimId],retainedContextClaimIds:[]}],
   claims:[{claimId:claim.claimId,status:'partial',supportedText:narrow,sources:[{
    sourceId:'S1',status:'answered',spanIds:[spanId],attributionStatus:'not_applicable',attributedSpeaker:''
   }],clauses:[
    {text:'Custom leads us to infer one event from another, and',status:'answered',issueCode:'none',
     sources:[{sourceId:'S1',status:'answered',spanIds:[spanId]}]},
    {text:'reason alone establishes necessary connection.',status:'partial',issueCode:'scope',
     sources:[{sourceId:'S1',status:'partial',spanIds:[]}]}
   ]}]
  })};
 }]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  catalog,plan:onePartPlan,trace:true
 });
 assert.equal(ai.calls.length,2,'clause review reuses the existing composition and review calls');
 assert.match(result.answer,/The mind is determined by custom to infer one from the other\. \[S1\]/);
 assert.doesNotMatch(result.answer,/reason alone establishes necessary connection/);
 const decision=result.trace.reviewContract.reviewDecisions.find(item=>item.clauseDecisions);
 assert.ok(decision);
 assert.deepEqual(decision.clauseDecisions.map(item=>({text:item.text,status:item.status,issueCode:item.issueCode})),[
  {text:'Custom leads us to infer one event from another, and',status:'answered',issueCode:'none'},
  {text:'reason alone establishes necessary connection.',status:'partial',issueCode:'scope'}
 ]);
 assert.ok(result.trace.reviewContract.reviewDecisions.some(item=>
  item.claimId==='P1-C1'&&item.supportedTextApplied===true));
});




test('an unsupported clause cannot pass on an answered claim-level verdict',async()=>{
 const broad='Custom leads us to infer one event from another, and reason alone establishes necessary connection.';
 const ai=makeAI([answer(`PART P1\n${broad} [S1]`),(_model,{messages})=>{
  const payload=parsePayload(messages),claim=payload.claims[0];
  const spanId=claim.sourceEvidence[0].spanIds[0];
  return {response:JSON.stringify({
   parts:[{partId:'P1',status:'answered',answerStatus:'answered',repairable:false,
    directAnswerClaimIds:[],retainedContextClaimIds:[]}],
   claims:[{claimId:claim.claimId,status:'answered',sources:[{
    sourceId:'S1',status:'answered',spanIds:[spanId],attributionStatus:'not_applicable',attributedSpeaker:''
   }],clauses:[
    {text:'Custom leads us to infer one event from another, and',status:'answered',issueCode:'none',
     sources:[{sourceId:'S1',status:'answered',spanIds:[spanId]}]},
    {text:'reason alone establishes necessary connection.',status:'unanswered',issueCode:'scope',sources:[]}
   ]}]
  })};
 }]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  catalog,plan:onePartPlan,trace:true
 });
 // Batch 24 (B24-1): the clause demotion leaves the part at zero
 // accepted claims, so the rescue re-review adds one call (its
 // verdicts cannot revive the claim: the clause gate still applies).
 assert.equal(ai.calls.length,3);
 assert.doesNotMatch(result.answer,/Custom leads us to infer|reason alone establishes/);
 assert.ok(result.trace.reviewContract.supportIssues.some(issue=>
  issue.reason==='claim-clause-not-supported'&&issue.issueCode==='scope'));
});

test('an unresolved invalid clause range demotes its source decision through full review',async()=>{
 const claim='Custom shapes the mind’s inference from one event to another, and reason alone establishes necessary connection.';
 const splitAt=claim.indexOf('Custom')+2;
 const malformedClause=claim.slice(splitAt,claim.indexOf(' inference')+5);
 const ai=makeAI([answer(`PART P1\n${claim} [S1]`),(_model,{messages})=>{
  const payload=parsePayload(messages),current=payload.claims[0];
  const spanId=current.sourceEvidence[0].spanIds[0];
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',answerStatus:'answered',
   directAnswerClaimIds:[current.claimId]}],claims:[{claimId:current.claimId,status:'answered',sources:[{
    sourceId:'S1',status:'answered',spanIds:[spanId],attributionStatus:'not_applicable',attributedSpeaker:''
   }],clauses:[{start:splitAt,end:claim.indexOf(' inference')+5,text:malformedClause,
    status:'answered',issueCode:'none',
    sources:[{sourceId:'S1',spanIds:[spanId]}]}]}]})};
 }]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  catalog,plan:onePartPlan,trace:true
 });
 const decision=result.trace.reviewContract.reviewDecisions.find(item=>item.sourceId==='S1');
 assert.ok(decision);
 assert.equal(decision.accepted,false);
 assert.equal(decision.sourceStatus,'partial');
 assert.ok(result.trace.reviewContract.supportIssues.some(issue=>
  issue.reason==='claim-clause-not-supported'));
 const fit=result.trace.claimSpanFit.clauses.find(issue=>issue.claimId===decision.claimId);
 assert.equal(fit.coverage.measurement,'measured');
 assert.ok(fit.coverage.requiredTerms.length>0);
 assert.ok(result.trace.claimSpanFit.measurableClauseCount>=1);
});

test('claim-level source review does not require optional clause segmentation',async()=>{
 const context='Outside the cited text, repeated experience can also shape ordinary expectations.';
 const ai=makeAI([answer('PART P1\nCustom shapes the mind’s inference from one event to another. [S1] '+context),
  (_model,{messages})=>{
   const payload=parsePayload(messages),claim=payload.claims[0];
   const contextClaim=payload.parts[0].contextClaims[0];
   return {response:JSON.stringify({parts:[{partId:'P1',status:'partial',answerStatus:'answered',
    repairable:false,directAnswerClaimIds:[contextClaim.claimId],
    retainedContextClaimIds:[contextClaim.claimId]}],claims:[{claimId:claim.claimId,status:'answered',
    sources:[{sourceId:'S1',status:'answered',spanIds:[claim.sourceEvidence[0].spanIds[0]],
     attributionStatus:'not_applicable',attributedSpeaker:''}]}]})};
  }],{decorateClauses:false});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  catalog,plan:onePartPlan,trace:true
 });
 assert.equal(ai.calls.length,2,'optional clause segmentation uses the existing review call');
 assert.match(result.answer,/Custom shapes the mind’s inference from one event to another\. \[S1\]/);
 assert.match(result.answer,/Outside the cited text, repeated experience/);
 assert.deepEqual(result.citations.map(source=>source.id),['S1']);
 assert.ok(!result.trace.reviewContract.supportIssues.some(issue=>
  issue.reason==='claim-clause-review-incomplete'));
});

test('reviewed clauses need not mechanically partition every connective in a cited claim',async()=>{
 const broad='Similar objects are constantly conjoined, and the mind is determined by custom to infer one from the other.';
 const ai=makeAI([answer(`PART P1\n${broad} [S1]`),(_model,{messages})=>{
  const payload=parsePayload(messages),claim=payload.claims[0],spanId=claim.sourceEvidence[0].spanIds[0];
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered'}],claims:[{
   claimId:claim.claimId,status:'answered',sources:[{sourceId:'S1',status:'answered',spanIds:[spanId],
    attributionStatus:'not_applicable',attributedSpeaker:''}],clauses:[
     {start:broad.indexOf('Similar'),end:broad.indexOf('conjoined')+'conjoined'.length,status:'answered',issueCode:'none',
      sources:[{sourceId:'S1',status:'answered',spanIds:[spanId]}]},
     {start:broad.indexOf('the mind'),end:broad.length,status:'answered',issueCode:'none',
      sources:[{sourceId:'S1',status:'answered',spanIds:[spanId]}]}
   ]}]})};
 }]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  catalog,plan:onePartPlan,trace:true
 });
 assert.match(result.answer,/Similar objects are constantly conjoined, and the mind is determined by custom/);
 assert.ok(!result.trace.reviewContract.warnings.some(item=>
  item.code==='clause-review-normalization'&&item.details.includes('clause-coverage-incomplete')));
 assert.ok(!result.trace.reviewContract.supportIssues.some(issue=>
  issue.reason==='claim-clause-review-incomplete'));
});

// The review prompt asks clause source decisions for only a cited source ID
// and its exact supporting span IDs — no per-source status. Live per-part
// reviews return exactly that shape, so a clause source carrying valid spans
// asserts support just as a claim-level source decision with no explicit
// status does. Regression coverage for the batch-3 live runs where whole
// parts lost every acceptance (acceptedDirectAnswerClaimIds=[]) whenever the
// reviewer segmented a claim into clauses.
function clauseShapeReview({withClauses,clauseTexts}){
 return (_model,{messages})=>{
  const payload=parsePayload(messages);
  const part=payload.parts[0],claim=payload.claims[0];
  const sourceId=claim.sourceIds[0];
  const spanId=claim.sourceEvidence.find(item=>item.sourceId===sourceId).spanIds[0];
  return {response:JSON.stringify({parts:[{partId:part.partId,status:'answered',
    answerStatus:'answered',repairable:false,directAnswerClaimIds:[claim.claimId],
    requirementCoverage:(part.requirements||[]).map(requirement=>({
     requirementId:requirement.id,status:'answered',answerClaimIds:[claim.claimId]}))}],
   claims:[{claimId:claim.claimId,status:'answered',
    sources:[{sourceId,status:'answered',spanIds:[spanId],
     attributionStatus:'not_applicable',attributedSpeaker:''}],
    ...(withClauses?{clauses:clauseTexts.map(text=>({text,status:'answered',
     issueCode:'none',sources:[{sourceId,spanIds:[spanId]}]}))}:{})}]})};
 };
}

test('clause sources carrying only span IDs keep the claim acceptance (single part)',async()=>{
 const question='How does Hume explain causal necessity, and what role does custom play?';
 const plan={...onePartPlan,parts:[{...onePartPlan.parts[0],question,
  requirements:[{id:'P1-R1',text:'Explain how repeated conjunction gives rise to the idea of necessity.'},
   {id:'P1-R2',text:'Explain how custom leads the mind to infer one event from another.'}]}]};
 const claimText='Custom leads the mind to infer one event from another, and repeated conjunction gives rise to the idea of necessity.';
 const ai=makeAI([answer(`PART P1\n${claimText} [S1]`),
  clauseShapeReview({withClauses:true,clauseTexts:[
   'Custom leads the mind to infer one event from another',
   'repeated conjunction gives rise to the idea of necessity.']})]);
 const result=await composeEvidenceAnswer(question,[hume],ai,[],{plan,catalog,trace:true});
 const decision=result.trace.reviewContract.partDecisions.find(item=>item.partId==='P1');
 assert.equal(result.outcome,'verified-source-draft');
 assert.deepEqual(decision.acceptedDirectAnswerClaimIds,['P1-C1'],
  'the direct claim accepted by the reviewer survives clause normalization');
 assert.deepEqual(decision.requirementCoverage.map(item=>[item.requirementId,item.status,item.answerClaimIds]),
  [['P1-R1','answered',['P1-C1']],['P1-R2','answered',['P1-C1']]]);
 assert.ok(!result.trace.reviewContract.supportIssues.some(issue=>
  issue.reason==='claim-clause-not-supported'||issue.reason==='claim-source-not-supported'),
  'no deterministic demotion is recorded for a prompt-conformant clause review');
 assert.match(result.answer,/Custom leads the mind to infer one event from another/);
 assert.match(result.answer,/\[S1\]/,'the final answer keeps its citation');
 assert.deepEqual(result.citations.map(source=>source.id),['S1']);
});

test('a clause-segmented later part loses nothing to a clause-free earlier part, and vice versa',async()=>{
 const plan={version:'reader-evidence-v2',intent:'compare',
  sources:[{label:'David Hume',role:'primary',bookIds:['35']},
   {label:'Immanuel Kant',role:'primary',bookIds:['40']}],
  parts:[
   {id:'P1',question:'How does Hume explain causal necessity?',sourceBookIds:['35'],
    searchQueries:['Hume necessity custom'],candidateSourceIds:['S1'],
    requirements:[{id:'P1-R1',text:'Explain how Hume accounts for causal necessity.'}]},
   {id:'P2',question:'How does Kant explain causal necessity?',sourceBookIds:['40'],
    searchQueries:['Kant causality a priori'],candidateSourceIds:['S2'],
    requirements:[{id:'P2-R1',text:'Explain how Kant accounts for causal necessity.'}]}
  ],queries:['Hume custom','Kant a priori']};
 const sources=[{...hume,candidatePartIds:['P1']},{...kant,candidatePartIds:['P2']}];
 const draft='PART P1\nCustom leads the mind to infer one event from another, and repeated conjunction gives rise to the idea of necessity. [S1]\n'+
  'PART P2\nCausality is a pure conception of the understanding, and as a category it is a priori. [S2]';
 const clauseTexts={
  P1:['Custom leads the mind to infer one event from another',
   'repeated conjunction gives rise to the idea of necessity.'],
  P2:['Causality is a pure conception of the understanding',
   'as a category it is a priori.']};
 for(const segmentedPart of ['P2','P1']){
  const reviewCall=(_model,request)=>{
   const payload=parsePayload(request.messages);
   const partId=payload.parts[0].partId;
   return clauseShapeReview({withClauses:partId===segmentedPart,
    clauseTexts:clauseTexts[partId]})(_model,request);
  };
  const ai=makeAI([answer(draft),reviewCall,reviewCall]);
  const result=await composeEvidenceAnswer('How do Hume and Kant explain causal necessity?',
   sources,ai,[],{plan,catalog,trace:true});
  assert.equal(result.outcome,'verified-source-draft',
   `segmented part ${segmentedPart}: both parts keep their reviewed answers`);
  for(const partId of ['P1','P2']){
   const decision=result.trace.reviewContract.partDecisions.find(item=>item.partId===partId);
   assert.deepEqual(decision.acceptedDirectAnswerClaimIds,[`${partId}-C1`],
    `${partId} keeps its direct claim when ${segmentedPart} is clause-segmented`);
   assert.deepEqual(decision.requirementCoverage.map(item=>[item.status,item.answerClaimIds]),
    [['answered',[`${partId}-C1`]]]);
  }
  assert.match(result.answer,/\[S1\]/);
  assert.match(result.answer,/\[S2\]/);
  assert.deepEqual(result.citations.map(source=>source.id),['S1','S2']);
 }
});

test('malformed supportedText is ignored and the partial cited claim remains fail-closed',async()=>{
 const text='Custom is the great guide of human life.';
 const source={...hume,id:'S1',bookId:'35',text,preview:text};
 const broad='Custom guides human life, and reason alone determines moral judgment.';
 const malformed='Custom guides human life. [S9] Reason alone determines moral judgment.';
 const ai=makeAI([answer(`PART P1\n${broad} [S1]`),(_model,{messages})=>{
  const payload=parsePayload(messages),claim=payload.claims[0];
  return {response:JSON.stringify({parts:[{partId:'P1',status:'partial',answerStatus:'partial',
   repairable:false,directAnswerClaimIds:[],retainedContextClaimIds:[]}],claims:[{
    claimId:claim.claimId,status:'partial',supportedText:malformed,sources:[{
     sourceId:'S1',status:'answered',spanIds:[claim.sourceEvidence[0].spanIds[0]],
     attributionStatus:'not_applicable',attributedSpeaker:''}]}]})};
 }]);
 const result=await composeEvidenceAnswer('What guides human life?',[source],ai,[],{
  catalog,plan:{intent:'explain',sources:[{label:'David Hume',role:'primary',bookIds:['35']}],
   parts:[{id:'P1',question:'What guides human life?',sourceBookIds:['35']}],queries:['Hume custom']},trace:true
 });
 assert.equal(ai.calls.length,2);
 assert.doesNotMatch(result.answer,/Custom guides human life/);
 assert.doesNotMatch(result.answer,/\[S9\]/);
 assert.deepEqual(result.evidenceMap,[]);
});

test('claim review rejects an author-wide theory inferred from one character line',async()=>{
 const text='They got on to everlasting questions, floated off into space.';
 const source={...hume,id:'S1',bookId:'52',title:'Crime and Punishment — Fyodor Dostoevsky',
  text,preview:text};
 const claim='Dostoevsky argues that nihilism destroys religious morality and leaves society without values.';
 const ai=makeAI([answer(`PART P1\n${claim} [S1]`),(_model,{messages})=>{
  assert.match(messages[0].content,/Do not infer an author-wide theory from a character's line, isolated example, or passing theme/);
  const payload=parsePayload(messages),current=payload.claims[0];
  return {response:JSON.stringify({parts:[{partId:'P1',status:'partial'}],claims:[{
   claimId:current.claimId,status:'partial',sources:[{sourceId:'S1',status:'partial',spanIds:[]}]}]})};
 }]);
 const result=await composeEvidenceAnswer('How does Dostoevsky treat nihilism?',[source],ai,[],{
  catalog:{...catalog,52:source.title},plan:{intent:'explain',
   sources:[{label:'Fyodor Dostoevsky',role:'primary',bookIds:['52']}],
   parts:[{id:'P1',question:'How does Dostoevsky treat nihilism?',sourceBookIds:['52']}]},trace:true
 });
 assert.equal(result.coverage,'none');
 assert.doesNotMatch(result.answer,/Dostoevsky argues that nihilism/);
 assert.deepEqual(result.evidenceMap,[]);
 assert.ok(result.trace.reviewContract.supportIssues.some(issue=>
  issue.claimId==='P1-C1'&&issue.reason==='claim-source-not-supported'));
});

test('a partially reviewed sentence is not promoted by dropping its unsupported citation',async()=>{
 const unrelated={...hume,id:'S1',bookId:'140',title:'Fear and Trembling — Søren Kierkegaard',page:17,
  text:'The knight of faith lives an ordinary life after making the movement of infinity.',
  preview:'The knight of faith lives an ordinary life after making the movement of infinity.'};
 const supporting={...unrelated,id:'S2',page:93,
  text:'The opposite of sin is faith.',preview:'The opposite of sin is faith.'};
 const plan={intent:'explain',sources:[{label:'Søren Kierkegaard',role:'primary',bookIds:['140']}],
  parts:[{id:'P1',question:'What is the Christian opposite of sin?',sourceBookIds:['140']}]};
 const ai=makeAI([answer('PART P1\nJohannes de Silentio states that the Christian opposite of sin is faith. [S2, S1]'),(_model,{messages})=>{
  const payload=parsePayload(messages),claim=payload.claims[0];
  const spanFor=sourceId=>claim.sourceEvidence.find(item=>item.sourceId===sourceId).spanIds[0];
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered'}],claims:[{
   claimId:claim.claimId,status:'partial',sources:[
    {sourceId:'S2',status:'answered',spanIds:[spanFor('S2')]},
    {sourceId:'S1',status:'unanswered',spanIds:[]}
   ]}]})};
 }]);
 const result=await composeEvidenceAnswer('What is the Christian opposite of sin?',[unrelated,supporting],ai,[],{
  catalog:{...catalog,140:unrelated.title},plan,trace:true
 });
 assert.equal(ai.calls.length,2,'partial source support without a repairability decision does not add a call');
 assert.equal(result.coverage,'none');
 assert.match(result.answer,/did not support a reliable answer/i);
 assert.equal(result.questionParts[0].status,'unsupported');
 assert.deepEqual(result.citations,[]);
 assert.deepEqual(result.evidenceMap,[]);
 assert.deepEqual(result.trace.reviewContract.recovered,[]);
 assert.ok(result.trace.reviewContract.supportIssues.some(issue=>
  issue.claimId==='P1-C1'&&issue.sourceId==='S1'&&issue.reason==='claim-source-not-supported'));
});

test('an all-books plan does not promote a partial claim after removing a failed source',async()=>{
 const unrelated={...hume,id:'S1',bookId:'140',title:'Fear and Trembling — Søren Kierkegaard',page:17,
  text:'The knight of faith lives an ordinary life after making the movement of infinity.',
  preview:'The knight of faith lives an ordinary life after making the movement of infinity.'};
 const supporting={...hume,id:'S2',bookId:'35',page:93,
  text:'Custom is the great guide of human life.',preview:'Custom is the great guide of human life.'};
 const plan={intent:'explain',sources:[
  {label:'David Hume',role:'primary',bookIds:['35']},
  {label:'Søren Kierkegaard',role:'primary',bookIds:['140']}
 ],parts:[{id:'P1',question:'What guides human life?',sourceBookIds:['35','140']}]};
 const ai=makeAI([answer('PART P1\nHume says custom is the great guide of human life. [S2, S1]'),(_model,{messages})=>{
  const payload=parsePayload(messages),claim=payload.claims[0];
  const spanFor=sourceId=>claim.sourceEvidence.find(item=>item.sourceId===sourceId).spanIds[0];
  return {response:JSON.stringify({parts:[{partId:'P1',status:'partial'}],claims:[{
   claimId:claim.claimId,status:'partial',sources:[
    {sourceId:'S2',status:'answered',spanIds:[spanFor('S2')]},
    {sourceId:'S1',status:'unanswered',spanIds:[]}
   ]}]})};
 }]);
 const result=await composeEvidenceAnswer('What guides human life?',[unrelated,supporting],ai,[],{
  catalog:{...catalog,140:'Fear and Trembling — Søren Kierkegaard'},plan,trace:true
 });
 assert.match(result.answer,/did not support a reliable answer/i);
 assert.equal(result.questionParts[0].status,'unsupported');
 assert.deepEqual(result.citations,[]);
 assert.deepEqual(result.evidenceMap,[]);
 assert.deepEqual(result.trace.reviewContract.recovered,[]);
});

test('the Sunyata review handoff omits a compound sentence when one of its cited pages fails review',async()=>{
 const supported={...hume,id:'S2',bookId:'178',page:88,
  text:'Dependent arising shows that things do not exist by themselves; emptiness is not absolute nonexistence.',
  preview:'Dependent arising shows that things do not exist by themselves; emptiness is not absolute nonexistence.'};
 const rejected={...hume,id:'S5',bookId:'185',page:18,
  text:'A commentary discusses avoiding dogmatism.',preview:'A commentary discusses avoiding dogmatism.'};
 const plan={intent:'explain',sources:[
  {label:'Nāgārjuna',role:'primary',bookIds:['178']},
  {label:'Commentary',role:'commentary',bookIds:['185']}
 ],parts:[{id:'P1',question:'What is sunyata?',sourceBookIds:['178','185']}]};
 const ai=makeAI([
  answer('PART P1\nEmptiness describes dependent arising and warns against dogmatism. [S2, S5] Emptiness is not absolute nonexistence. [S2]'),
  (_model,{messages})=>{
   const payload=parsePayload(messages);
   const [compound,definition]=payload.claims;
   const spanFor=(claim,sourceId)=>claim.sourceEvidence.find(item=>item.sourceId===sourceId).spanIds[0];
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered'}],claims:[
    {claimId:compound.claimId,status:'answered',sources:[
     {sourceId:'S2',status:'answered',spanIds:[spanFor(compound,'S2')]},
     {sourceId:'S5',status:'partial',spanIds:[]}
    ]},
    {claimId:definition.claimId,status:'answered',sources:[
     {sourceId:'S2',status:'answered',spanIds:[spanFor(definition,'S2')]}
    ]}
   ]})};
  }
 ]);
 const result=await composeEvidenceAnswer('What is sunyata?',[supported,rejected],ai,[],{
  catalog,plan,trace:true
 });
 assert.equal(result.coverage,'partial');
 assert.equal(result.questionParts[0].status,'partial');
 assert.doesNotMatch(result.answer,/warns against dogmatism/);
 assert.match(result.answer,/Emptiness is not absolute nonexistence/);
 assert.deepEqual(result.citations.map(source=>source.id),['S2']);
 assert.deepEqual(result.evidenceMap.map(item=>item.point),[
  'Emptiness is not absolute nonexistence.'
 ]);
 assert.deepEqual(result.trace.reviewContract.recovered,[]);
 assert.ok(result.trace.reviewContract.supportIssues.some(issue=>
  issue.claimId==='P1-C1'&&issue.sourceId==='S5'&&issue.reason==='claim-source-not-supported'));
});

test('a failed author-side premise cannot be pruned from a hypothetical inference citation',async()=>{
 const premiseReviewer=(_model,{messages})=>{
  const payload=parsePayload(messages);
  const claims=payload.claims.map(claim=>({claimId:claim.claimId,status:'answered',
   sources:claim.sourceIds.map(sourceId=>({sourceId,
    status:claim.partId==='P3'&&sourceId==='S2'?'unanswered':'answered',
    spanIds:claim.partId==='P3'&&sourceId==='S2'?[]:[sourceId+'-Q1']}))}));
  return {response:JSON.stringify({parts:payload.parts.map(part=>({partId:part.partId,status:'answered'})),claims})};
 };
 const ai=makeAI([hypotheticalDraft(
  'From these passages, one cautious inference is that Nietzsche might reject Kierkegaard’s account of faith. [S1, S2]'),
  premiseReviewer,premiseReviewer,premiseReviewer
 ]);
 const result=await composeEvidenceAnswer(hypotheticalQuestion,hypotheticalSources,ai,[],{
  plan:hypotheticalPlan,catalog:hypotheticalCatalog,trace:true
 });
 assert.equal(ai.calls.length,4,'an unsupported author-side premise is not repaired without reviewer approval');
 assert.equal(result.questionParts[2].status,'unsupported');
 assert.equal(result.coverage,'partial');
 assert.doesNotMatch(result.answer,/one cautious inference is that Nietzsche might reject/);
 assert.equal(result.trace.reviewContract.recovered.some(item=>item.partId==='P3'),false);
 assert.ok(result.trace.reviewContract.supportIssues.some(issue=>
  issue.partId==='P3'&&issue.sourceId==='S2'&&issue.reason==='claim-source-not-supported'));
});

test('claim review rejects a compound sentence when its quote supports only one factual clause',async()=>{
 const text='It seems that the church obstructs and hinders the progress of this poison.';
 const source={...hume,id:'S1',bookId:'239',title:'The Portable Nietzsche — Friedrich Nietzsche',text,preview:text};
 const ai=makeAI([
  answer('PART P1\nNietzsche called the church vulgar and said that it hindered the spread of these values. [S1]'),
  (_model,{messages})=>{
   const payload=parsePayload(messages),part=payload.parts[0],claim=payload.claims.find(claim=>claim.partId===part.partId);
   const span=part.evidence[0].spans[0];
   return {response:JSON.stringify({parts:[{partId:'P1',status:'partial'}],
    claims:[{claimId:claim.claimId,status:'partial',spanIds:[span.spanId]}]})};
  }
 ]);
 const result=await composeEvidenceAnswer('What did Nietzsche say about the church?',[source],ai,[],{
  catalog:{239:'The Portable Nietzsche — Friedrich Nietzsche'},
  plan:{intent:'explain',sources:[{label:'Friedrich Nietzsche',role:'primary',bookIds:['239']}],
   parts:[{id:'P1',question:'What did Nietzsche say about the church?',sourceBookIds:['239']}],
   queries:['Nietzsche church criticism']},trace:true
 });
 assert.equal(ai.calls.length,3,'a compound claim rejection without repairability adds no repair call (the third call is the batch 24 rescue re-review, which cannot revive a clause-demoted claim)');
 assert.equal(result.coverage,'none');
 assert.equal(result.outcome,'insufficient-evidence');
 assert.equal(result.evidenceMap.length,0);
 assert.doesNotMatch(result.answer,/vulgar|hinders/i);
});
const onePartPlan={version:'reader-evidence-v2',intent:'explain',
 sources:[{label:'David Hume',role:'primary',bookIds:['35']}],
 parts:[{id:'P1',question:'How does Hume explain causal necessity?',sourceBookIds:['35'],
   searchQueries:['Hume necessity custom'],candidateSourceIds:['S1']}],queries:['Hume necessity custom']};
const hamletMeaningQuestion='What is the meaning of “conscience makes cowards of us all” in Hamlet’s soliloquy?';
const hamletMeaningSource={id:'S1',bookId:'212',title:'The Complete Works of William Shakespeare — William Shakespeare',page:454,
 text:'Thus conscience does make cowards of us all, And thus the native hue of resolution Is sicklied o’er with the pale cast of thought, And enterprises of great pith and moment With this regard their currents turn awry And lose the name of action.',
 preview:'Thus conscience does make cowards of us all, and enterprises of great pith and moment lose the name of action.'};
const hamletMeaningPlan={version:'reader-evidence-v2',intent:'interpret',
 sources:[{label:'Hamlet',role:'primary',bookIds:['212']}],
 parts:[{id:'P1',question:hamletMeaningQuestion,sourceBookIds:['212'],candidateSourceIds:['S1']}]};
const duBoisInitialismQuestion='How does Du Bois define double consciousness?';
const duBoisInitialismSource={id:'S3',bookId:'454',title:'The Souls of Black Folk — W. E. B. Du Bois',page:131,
 url:'https://example.test/dubois#page=131',candidatePartIds:['P1'],
 text:'It is a peculiar sensation, this double-consciousness, this sense of always looking at one’s self through the eyes of others. One ever feels his twoness, an American, a Negro; two souls, two thoughts, two unreconciled strivings.',
 preview:'Double-consciousness is a sense of looking at oneself through others’ eyes.'};
const duBoisInitialismPlan={version:'reader-evidence-v2',intent:'explain',
 sources:[{label:'W. E. B. Du Bois',role:'primary',bookIds:['454']}],
 parts:[{id:'P1',question:duBoisInitialismQuestion,sourceBookIds:['454'],candidateSourceIds:['S3']}]};
function directAnswerReview(directAnswerClaimIds){
 return (_model,{messages})=>{
  const payload=parsePayload(messages);
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',directAnswerClaimIds}],
   claims:payload.claims.map(claim=>({claimId:claim.claimId,status:'answered',
    sources:claim.sourceIds.map(sourceId=>({sourceId,status:'answered',
     spanIds:claim.sourceEvidence.find(item=>item.sourceId===sourceId).spanIds.slice(0,1)}))}))})};
 };
}
const twoSidePlan={version:'reader-evidence-v2',resolvedQuestion:'How do Hume and Kant differ about causal necessity?',intent:'compare',
 sources:[{label:'David Hume',role:'primary',bookIds:['35']},{label:'Immanuel Kant',role:'primary',bookIds:['40']}],
 parts:[
  {id:'P1',question:'How does Hume explain causal necessity?',sourceBookIds:['35'],searchQueries:['Hume necessity custom']},
  {id:'P2',question:'How does Kant explain causal necessity?',sourceBookIds:['40'],searchQueries:['Kant causality a priori']},
  {id:'P3',question:'How do Hume and Kant differ?',sourceBookIds:['35','40'],searchQueries:['Hume custom','Kant a priori']}
 ],queries:['Hume custom','Kant a priori']};

test('a comparison drops an unrequested conditional author-to-author inference',async()=>{
 const inference='If Kant applied his view of causality to Hume’s account, he might suggest that Hume’s custom is a necessary transcendental principle. [S1, S2]';
 const ai=makeAI([answer('PART P1\nHume explains causal expectation through custom rather than reasoning. [S1]\n'+
  'PART P2\nKant identifies causality as an a priori category of relation. [S2]\n'+
  'PART P3\nHume ties causal expectation to custom, whereas Kant treats causality as an a priori category. [S1, S2]\n'+
  inference),review([['P1','answered'],['P2','answered'],['P3','answered']]),
  review([['P1','answered'],['P2','answered'],['P3','answered']]),
  review([['P1','answered'],['P2','answered'],['P3','answered']])]);
 const result=await composeEvidenceAnswer('How do Hume and Kant differ over causal necessity?',
  [{...hume,candidatePartIds:['P1','P3']},{...kant,candidatePartIds:['P2','P3']}],ai,[],
  {plan:twoSidePlan,catalog,trace:true});
 assert.equal(result.coverage,'full','supported direct comparison claims still answer every part');
 assert.doesNotMatch(result.answer,/cautious reader inference|necessary transcendental principle/);
 assert.ok(result.trace.rejected.some(item=>item.partId==='P3'&&
  item.reason==='unrequested-cross-author-inference'));
 assert.equal(ai.calls.length,4,'the scope guard reuses compose and the per-part reviews without an extra call');
});

test('comparison handoff preserves uncited context while dropping an unrequested author-transfer claim',async()=>{
 const inference='If Kant applied his view of causality to Hume’s account, he might suggest that custom is a necessary transcendental principle. [S1, S2]';
 const ai=makeAI([answer('PART P1\nHume explains causal expectation through custom rather than reasoning. [S1]\n'+
  'PART P2\nKant identifies causality as an a priori category of relation. [S2]\n'+
  'PART P3\nHume and Kant differ in their accounts of causal necessity.\n'+
  'Hume ties causal expectation to custom. [S1] Kant treats causality as an a priori category. [S2]\n'+inference),
  review([['P1','answered'],['P2','answered'],['P3','answered']]),
  review([['P1','answered'],['P2','answered'],['P3','answered']]),
  review([['P1','answered'],['P2','answered'],['P3','answered']]),
  // Batch 8 (B8-1): P3's opening claim is a retained frame claim with
  // no scaffolding decision, so the scaffolding repair round runs and
  // decides it is genuine context.
  {response:JSON.stringify({decisions:[{partId:'P3',claimId:'P3-C1',
   action:'context',supportClaimIds:[]}]})}]);
 const result=await composeEvidenceAnswer('How do Hume and Kant differ over causal necessity?',
  [{...hume,candidatePartIds:['P1','P3']},{...kant,candidatePartIds:['P2','P3']}],ai,[],
  {plan:twoSidePlan,catalog,trace:true});
 assert.ok(result.trace.rejected.some(item=>item.partId==='P3'&&item.reason==='unrequested-cross-author-inference'));
 assert.match(result.answer,/differ in their accounts/);
 assert.doesNotMatch(result.answer,/might suggest/);
 assert.equal(result.questionParts.find(part=>part.part.includes('differ')).status,'supported',
  'uncited context can introduce the supported source claims that follow it');
 const comparisonDecision=result.trace.reviewContract.partDecisions.find(item=>item.partId==='P3');
 assert.equal(comparisonDecision.finalStatus,'answered',
  'the trace preserves the reviewer-stage status after exact-span checks');
 assert.equal(comparisonDecision.outputStatus,'supported');
 assert.deepEqual(result.trace.reviewScaffolding.repairRound,{attempted:true,resolved:1});
 assert.equal(ai.calls.length,5,'one compose, one review call per part, and the batch-8 scaffolding decision round');
});

test('an unsupported counterfactual-only comparison exposes its bounded validation reason',async()=>{
 const inference='As a cautious reader inference, if Kant applied his view of causality to Hume’s account, he might argue that Hume’s custom is a necessary transcendental principle. [S1, S2]';
 const plan={...twoSidePlan,parts:[{...twoSidePlan.parts[2],id:'P1'}]};
 const ai=makeAI([answer('PART P1\n'+inference)]);
 const result=await composeEvidenceAnswer('How do Hume and Kant differ over causal necessity?',
  [{...hume,candidatePartIds:['P1']},{...kant,candidatePartIds:['P1']}],ai,[],
  {plan,catalog,trace:true});
 assert.equal(result.trace.final.failure.validationReasons[0],'unrequested-cross-author-inference');
 assert.doesNotMatch(result.answer,/necessary transcendental principle/);
 assert.equal(ai.calls.length,1,'no review call runs when every draft sentence is rejected');
});

test('a consequence-only sentence cannot pass a phrase-meaning part as a direct answer',async()=>{
 const ai=makeAI([answer('PART P1\nConsequently, important enterprises lose their momentum and fail to become actions. [S1]'),
  (_model,{messages})=>{
   const payload=parsePayload(messages),claim=payload.claims[0];
   const spanId=claim.sourceEvidence[0].spanIds[0];
   return {response:JSON.stringify({parts:[{partId:'P1',status:'partial'}],claims:[{
    claimId:claim.claimId,status:'answered',sources:[{sourceId:'S1',spanIds:[spanId]}]
   }]})};
  }],{decorateReview:false});
 const result=await composeEvidenceAnswer(hamletMeaningQuestion,[hamletMeaningSource],ai,[],{
  plan:hamletMeaningPlan,catalog:{212:hamletMeaningSource.title},trace:true});
 assert.equal(result.questionParts[0].status,'partial');
 assert.equal(result.coverage,'partial');
 assert.deepEqual(result.trace.reviewContract.partDecisions,[{
  partId:'P1',reviewerStatus:'partial',finalStatus:'partial',reviewerAnswerStatus:'partial',
  finalAnswerStatus:'partial',directAnswerClaimIds:[],acceptedDirectAnswerClaimIds:[],
  directAnswerCovered:false,outputStatus:'partial',outputAnswerStatus:'partial',
  outputAcceptedDirectAnswerClaimIds:[]
 }]);
 assert.equal(ai.calls.length,2,'the direct-answer check uses the existing compose and review calls');
});

test('a cited interpretation claim can satisfy a phrase-meaning part',async()=>{
 const ai=makeAI([answer('PART P1\nThe phrase means fear of death can make people hesitate to act. [S1]'),
  directAnswerReview(['P1-C1'])],{decorateReview:false});
 const result=await composeEvidenceAnswer(hamletMeaningQuestion,[hamletMeaningSource],ai,[],{
  plan:hamletMeaningPlan,catalog:{212:hamletMeaningSource.title},trace:true});
 assert.equal(result.questionParts[0].status,'supported');
 assert.equal(result.coverage,'full');
 assert.deepEqual(result.trace.reviewContract.partDecisions,[{
  partId:'P1',reviewerStatus:'answered',finalStatus:'answered',reviewerAnswerStatus:'answered',
  finalAnswerStatus:'answered',directAnswerClaimIds:['P1-C1'],
  acceptedDirectAnswerClaimIds:['P1-C1'],directAnswerCovered:true,outputStatus:'supported',
  outputAnswerStatus:'answered',outputAcceptedDirectAnswerClaimIds:['P1-C1']
 }]);
});

test('uncovered within-part requirements use the existing bounded answer repair and remain traceable',async()=>{
 const question='How does Hume explain causal necessity, and what role does custom play?';
 const plan={...onePartPlan,parts:[{...onePartPlan.parts[0],question,
  requirements:[
   {id:'P1-R1',text:'Explain how repeated conjunction gives rise to the idea of necessity.',
    questionAnchor:'How does Hume explain causal necessity'},
   {id:'P1-R2',text:'Explain how custom leads the mind to infer one event from another.',
    questionAnchor:'what role does custom play'}
  ]}]};
 let repairPayload;
 const reviewed=(payload,coverage)=>({response:JSON.stringify({
  parts:[{partId:'P1',status:'answered',answerStatus:'answered',repairable:true,
   directAnswerClaimIds:payload.claims.map(claim=>claim.claimId),
   requirementCoverage:coverage(payload)}],
  claims:payload.claims.map(claim=>({claimId:claim.claimId,status:'answered',
   sources:claim.sourceIds.map(sourceId=>({sourceId,status:'answered',
    spanIds:[claim.sourceEvidence.find(item=>item.sourceId===sourceId).spanIds[0]],
    evidenceRole:'work-assertion',
    supportBoundary:'The source explains its own account of necessity.'}))}))})});
 const ai=makeAI([answer('PART P1\nRepeated conjunction gives Hume the idea of necessity. [S1]'),
  (_model,{messages})=>{
   const payload=parsePayload(messages);
   assert.equal(payload.parts[0].requirements.length,2,'the existing reviewer receives all within-part requirements');
   return reviewed(payload,()=>[
    {requirementId:'P1-R1',status:'answered',answerClaimIds:[payload.claims[0].claimId]},
    {requirementId:'P1-R2',status:'unanswered',answerClaimIds:[]}
   ]);
  },
  (_model,{messages})=>{
   repairPayload=JSON.parse(messages[1].content);
   assert.deepEqual(repairPayload.parts[0].repair.missingRequirements,[{
    requirementId:'P1-R2',text:'Explain how custom leads the mind to infer one event from another.',
    questionAnchor:'what role does custom play'
   }]);
   assert.equal(repairPayload.parts[0].requirements[1].questionAnchor,
    'what role does custom play');
   assert.equal(repairPayload.parts[0].claims[0].initialReview[0].evidenceRole,'work-assertion');
   assert.match(repairPayload.parts[0].claims[0].initialReview[0].supportBoundary,/own account/);
   assert.equal(repairPayload.parts[0].repair.addCoverage,true);
   return {response:JSON.stringify({parts:[{partId:'P1',replacements:[],
    additions:['Custom trains the mind to infer one event after another from their repeated conjunction. [S1]']}]})};
  },
  (_model,{messages})=>{
   const payload=parsePayload(messages);
   return reviewed(payload,current=>[
    {requirementId:'P1-R1',status:'answered',answerClaimIds:[current.claims[0].claimId]},
    {requirementId:'P1-R2',status:'answered',answerClaimIds:[current.claims.at(-1).claimId]}
   ]);
  }]);
 const result=await composeEvidenceAnswer(question,[hume],ai,[],{
  plan,catalog,trace:true});
 assert.equal(ai.calls.length,4,'requirement tracking reuses the single bounded repair and re-review');
 assert.deepEqual(result.questionParts[0].requirementCoverage.map(item=>item.status),['answered','answered'],
  JSON.stringify({outcome:result.outcome,trace:result.trace,questionParts:result.questionParts}));
 assert.equal(result.questionParts[0].requirementsComplete,true);
 assert.ok(result.evidenceMap.some(item=>item.requirementIds?.includes('P1-R2')),
  'accepted evidence records which requirement the repaired claim satisfies');
 assert.match(result.answer,/Custom trains the mind/);
});

test('missing requirement decisions suppress a one-part answer without degrading source evidence review',async()=>{
 const question='How does Hume explain causal necessity, and what role does custom play?';
 const plan={...onePartPlan,parts:[{...onePartPlan.parts[0],question,
  requirements:[{id:'P1-R1',text:'Explain how repeated conjunction gives rise to the idea of necessity.'},
   {id:'P1-R2',text:'Explain how custom leads the mind to infer one event from another.'}]}]};
 const ai=makeAI([answer('PART P1\nRepeated conjunction gives Hume the idea of necessity. [S1]'),
  (_model,{messages})=>{
   const payload=parsePayload(messages),claim=payload.claims[0];
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',answerStatus:'answered',
    directAnswerClaimIds:[claim.claimId],requirementCoverage:[{
     requirementId:'P1-R1',status:'answered',answerClaimIds:[claim.claimId]
    }]}],claims:[{claimId:claim.claimId,status:'answered',
    sources:[{sourceId:'S1',status:'answered',spanIds:[claim.sourceEvidence[0].spanIds[0]]}]}]})};
  }]);
 const result=await composeEvidenceAnswer(question,[hume],ai,[],{plan,catalog,trace:true});
 assert.equal(result.outcome,'generation-failed');
 assert.equal(result.coverage,'none','an incomplete review cannot ship the one-part answer');
 assert.equal(result.questionParts[0].requirementsComplete,undefined);
 assert.deepEqual(result.trace.reviewCompletion,{totalParts:1,unvalidatedPartIds:['P1'],
  disposition:'suppressed-not-strict-minority'});
 assert.ok(result.trace.reviewContract.issues.some(issue=>issue.includes('missing-requirement-coverage')));
});

test('a retained direct synthesis remains complete when library evidence is partial',async()=>{
 const ai=makeAI([answer('PART P1\nCausal necessity can be understood as an expectation formed from regular experience, not a power directly observed in events.\n'+
  'Hume locates that expectation in repeated conjunction and custom, which lead the mind to infer one event from another. [S1]'),
  (_model,{messages})=>{
   const payload=parsePayload(messages);
   assert.equal(payload.parts[0].requiredAnswerClaimId,'P1-C1');
   const sourceClaim=payload.claims.find(claim=>claim.sourceIds.includes('S1'));
   const spanId=sourceClaim.sourceEvidence.find(item=>item.sourceId==='S1').spanIds[0];
   return {response:JSON.stringify({parts:[{partId:'P1',status:'partial',answerStatus:'answered',
    directAnswerClaimIds:['P1-C1'],retainedContextClaimIds:['P1-C1']}],claims:
    payload.claims.map(claim=>({claimId:claim.claimId,status:'answered',sources:
     claim.sourceIds.map(sourceId=>({sourceId,spanIds:[spanId]}))}))})};
  },
  // Batch 8 (B8-1): the synthesis opens the part uncited, so it is a
  // retained frame claim; the scaffolding repair round decides it is
  // genuine context (a direct synthesis, not a restatement of the one
  // cited claim), and it ships exactly as before.
  {response:JSON.stringify({decisions:[{partId:'P1',claimId:'P1-C1',
   action:'context',supportClaimIds:[]}]})}],{decorateReview:false});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true});
 assert.equal(result.questionParts[0].status,'partial','library support remains visibly partial');
 assert.equal(result.questionParts[0].answerStatus,'answered','the reviewer assessed completeness separately');
 assert.equal(result.coverage,'partial');
 assert.equal(result.answerCompleteness,'full');
 assert.match(result.answer,/Causal necessity can be understood as an expectation/);
 assert.match(result.answer,/Hume locates that expectation.*\[S1\]/);
 assert.deepEqual(result.trace.reviewScaffolding.repairRound,{attempted:true,resolved:1});
 assert.equal(ai.calls.length,3,'composition, review, and the batch-8 scaffolding decision round for the frame claim');
});

test('known cited claims misplaced in context-retention IDs warn without invalidating source review',async()=>{
 const ai=makeAI([answer('PART P1\nHume grounds causal necessity in repeated conjunction and custom. [S1]'),
  (_model,{messages})=>{
   const payload=parsePayload(messages);
   const claim=payload.claims.find(item=>item.sourceIds.includes('S1'));
   const spanId=claim.sourceEvidence.find(item=>item.sourceId==='S1').spanIds[0];
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',answerStatus:'answered',
    directAnswerClaimIds:[claim.claimId],retainedContextClaimIds:[claim.claimId]}],
    claims:payload.claims.map(item=>({claimId:item.claimId,status:'answered',sources:
     item.sourceIds.map(sourceId=>({sourceId,spanIds:[spanId]}))}))})};
  }],{decorateReview:false});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],
  {plan:onePartPlan,catalog,trace:true});
 assert.equal(result.trace.reviewContract.valid,true,
  'the cited claim still passes its independent exact-span review');
 assert.deepEqual(result.trace.reviewContract.issues,[]);
 assert.deepEqual(result.trace.reviewContract.warnings,[{
  partId:'P1',code:'source-claim-in-retained-context-list',claimIds:['P1-C1']
 }]);
 assert.equal(result.reviewStatus,'claim-review');
 assert.equal(result.questionParts[0].status,'supported');
 assert.equal(result.questionParts[0].answerStatus,'answered');
 assert.equal(result.answerCompleteness,'full');
 assert.equal(result.outcome,'verified-source-draft');
 assert.equal(ai.calls.length,2,'misplaced retention IDs are handled without another model call');
});

test('an unknown retained-context claim ID remains a blocking contract error',async()=>{
 const ai=makeAI([answer('PART P1\nHume grounds causal necessity in repeated conjunction and custom. [S1]'),
  (_model,{messages})=>{
   const payload=parsePayload(messages);
   const claim=payload.claims.find(item=>item.sourceIds.includes('S1'));
   const spanId=claim.sourceEvidence.find(item=>item.sourceId==='S1').spanIds[0];
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',answerStatus:'answered',
    directAnswerClaimIds:[claim.claimId],retainedContextClaimIds:['P1-C999']}],
    claims:payload.claims.map(item=>({claimId:item.claimId,status:'answered',sources:
     item.sourceIds.map(sourceId=>({sourceId,spanIds:[spanId]}))}))})};
  }],{decorateReview:false});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],
  {plan:onePartPlan,catalog,trace:true});
 assert.equal(result.trace.reviewContract.valid,false);
 assert.deepEqual(result.trace.reviewContract.issues,['invalid-retained-context-claim-id']);
 assert.equal(result.reviewStatus,'review-contract-incomplete');
 assert.equal(result.outcome,'generation-failed');
 assert.equal(result.coverage,'none');
 assert.equal(result.answer,'I could not complete a reliable answer this time. Please try again.');
});

test('review can select relevant exact evidence beyond the claim-ranked hint list',async()=>{
 const text=[
  'Herein lies my very strength; this is my unchanging sport. I turn my wheel that spins its circle fairly; I delight to make the lowest turn to the top, the highest to the bottom.',
  'Now would I argue with you by these few words which Fortune herself might use: and do you consider whether her demands are fair?',
  "Thus she proves her power; if in the selfsame hour one man is raised to happiness, and cast down in despair, 'tis thus she shows her might.",
  'The sea may charm with its smoothed surface, but no less justly it may soon bristle in storms with rough waves. Is the insatiate discontent of man to bind me to a constancy which belongs not to my ways?',
  'If Fortune should thus defend herself to you, you would have naught to utter on the other part.'
 ].join('\n\n\n');
 const source={id:'S1',bookId:'21',title:'The Consolation of Philosophy — Boethius',page:11,
  candidatePartIds:['P1'],text,preview:text};
 const plan={version:'reader-evidence-v2',intent:'explain',
  sources:[{label:'Boethius',role:'primary',bookIds:['21']}],
  parts:[{id:'P1',question:'How does Lady Philosophy explain the inherent instability of Fortune?',
   requirements:[{id:'P1-R1',text:'Explain why Fortune is unstable.',
    questionAnchor:'explain the instability of Fortune'}],
   sourceBookIds:['21'],candidateSourceIds:['S1']}]};
 const draft='PART P1\nLady Philosophy explains that Fortune is inherently unstable because her very nature is defined by inconstancy and changing lots. [S1]';
 const run=async(partStatus)=>{
  let reviewerPayload;
  const ai=makeAI([answer(draft),(_model,{messages})=>{
   reviewerPayload=parsePayload(messages);
   assert.equal(reviewerPayload.parts[0].requirements[0].questionAnchor,
    'explain the instability of Fortune');
   const claim=reviewerPayload.claims[0];
   const sourceEvidence=claim.sourceEvidence.find(item=>item.sourceId==='S1');
   const pageEvidence=reviewerPayload.parts[0].evidence.find(item=>item.id==='S1');
   const sourceReason=pageEvidence.spans.find(span=>/constancy which belongs not to my ways/i.test(span.text));
   assert.ok(sourceReason,'the relevant statement is present in the supplied part evidence');
   assert.ok(!sourceEvidence.spanIds.includes(sourceReason.spanId),
    'this fixture reproduces the run 14 miss: the exact span is outside the ranked claim hints');
   return {response:JSON.stringify({
    parts:[{partId:'P1',status:partStatus,directAnswerClaimIds:[claim.claimId],
     requirementCoverage:[{requirementId:'P1-R1',status:'answered',answerClaimIds:[claim.claimId]}]}],
    claims:[{claimId:claim.claimId,status:'answered',sources:[{
     sourceId:'S1',status:'answered',spanIds:[sourceReason.spanId],
     evidenceRole:'work-assertion',
     supportBoundary:'Lady Philosophy says Fortune is unstable by nature; this supports her account of instability.'}]}]
   })};
  }],{decorateReview:false});
  const result=await composeEvidenceAnswer('How does Lady Philosophy explain the instability of Fortune?',
   [source],ai,[],{plan,catalog:{21:source.title},trace:true});
  return {ai,result};
 };

 const answered=await run('answered');
 const decision=answered.result.trace.reviewContract.reviewDecisions[0];
 assert.equal(answered.result.questionParts[0].status,'supported');
 assert.equal(decision.candidateSpanIds.length,4);
 assert.ok(!decision.candidateSpanIds.includes('S1-Q4'),
  'the exact quote remains absent from the claim-ranked hint list');
 assert.equal(decision.reviewerSpanIds[0],'S1-Q4');
 assert.equal(decision.acceptedSpanIds[0],'S1-Q4');
 assert.match(decision.acceptedQuote,/constancy which belongs not to my ways/i);
 assert.equal(decision.evidenceRole,'work-assertion');
 assert.match(decision.supportBoundary,/unstable by nature/);
 assert.equal(answered.ai.calls.length,2,'using the same-source fallback adds no model call');

 const reviewerPartial=await run('partial');
 assert.equal(reviewerPartial.result.questionParts[0].status,'partial',
  'exact span validation does not override the reviewer’s explicit incomplete part status');
 assert.equal(reviewerPartial.result.trace.reviewContract.partDecisions[0].directAnswerCovered,true);
 assert.equal(reviewerPartial.ai.calls.length,2);
});

test('a why-answer using the source reason brings that exact span into review',async()=>{
 const text='The sea may charm with its smoothed surface, but no less justly it may soon bristle in storms with rough waves. '+
  'Is the insatiate discontent of man to bind me to a constancy which belongs not to my ways? '+
  'Herein lies my very strength; this is my unchanging sport. I turn my wheel that spins its circle fairly; '+
  'I delight to make the lowest turn to the top, the highest to the bottom.';
 const source={id:'S1',bookId:'21',title:'The Consolation of Philosophy — Boethius',page:11,
  candidatePartIds:['P1'],text,preview:text};
 const plan={version:'reader-evidence-v2',intent:'explain',
  sources:[{label:'Boethius',role:'primary',bookIds:['21']}],
  parts:[{id:'P1',question:'How does Lady Philosophy explain the instability of Fortune?',
   sourceBookIds:['21'],candidateSourceIds:['S1']}]};
 const ai=makeAI([answer('PART P1\nFortune says constancy does not belong to her ways; her unchanging sport is turning the wheel, raising the lowest and lowering the highest. [S1]'),
  (_model,{messages})=>{
   const payload=parsePayload(messages),claim=payload.claims[0];
   const spans=payload.parts[0].evidence[0].spans;
   const selected=spans.filter(span=>/constancy which belongs not to my ways|unchanging sport.*wheel/is.test(span.text));
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',directAnswerClaimIds:['P1-C1']}],
    claims:[{claimId:claim.claimId,status:'answered',sources:[{sourceId:'S1',status:'answered',
     spanIds:selected.map(span=>span.spanId)}]}]})};
  }],{decorateReview:false});
 const result=await composeEvidenceAnswer('How does Lady Philosophy explain the instability of Fortune?',
  [source],ai,[],{plan,catalog:{21:source.title},trace:true});
 const reviewPayload=parsePayload(ai.calls[1].request.messages);
 const offered=reviewPayload.parts[0].evidence[0].spans.map(span=>span.text);
 assert.ok(offered.some(span=>/constancy which belongs not to my ways/.test(span)),
  'the direct source reason must reach the reviewer, not only the wheel example');
 assert.ok(offered.some(span=>/unchanging sport.*wheel/is.test(span)));
 assert.equal(result.questionParts[0].status,'supported');
 assert.equal(result.coverage,'full');
 assert.equal(result.evidenceMap.length,2,'the reviewer can retain both complementary exact spans');
 assert.equal(ai.calls.length,2,'the source-specific explanation uses the existing two calls');
});

test('a rejected non-direct claim is omitted without downgrading a reviewed direct answer',async()=>{
 const ai=makeAI([answer('PART P1\nThe phrase means fear of death can make Hamlet hesitate to act. [S1]\n'+
  'This proves that every person is incapable of decisive action. [S1]'),
  (_model,{messages})=>{
   const payload=parsePayload(messages);
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
    directAnswerClaimIds:['P1-C1']}],claims:payload.claims.map(claim=>{
     const accepted=claim.claimId==='P1-C1';
     return {claimId:claim.claimId,status:accepted?'answered':'partial',
      sources:claim.sourceIds.map(sourceId=>({sourceId,status:accepted?'answered':'partial',
       spanIds:accepted?claim.sourceEvidence.find(item=>item.sourceId===sourceId).spanIds.slice(0,1):[]}))};
    })})};
  }],{decorateReview:false});
 const result=await composeEvidenceAnswer(hamletMeaningQuestion,[hamletMeaningSource],ai,[],{
  plan:hamletMeaningPlan,catalog:{212:hamletMeaningSource.title},trace:true});
 assert.equal(result.questionParts[0].status,'supported');
 assert.equal(result.coverage,'full');
 assert.match(result.answer,/fear of death can make Hamlet hesitate to act/);
 assert.doesNotMatch(result.answer,/every person is incapable/,
  'the unsupported non-direct claim is filtered before final rendering');
 assert.ok(result.trace.reviewContract.supportIssues.some(issue=>
  issue.partId==='P1'&&issue.reason==='claim-source-not-supported'));
 assert.equal(ai.calls.length,2,'pruning reuses the existing compose and review calls');
});

test('a rejected nominated direct-answer claim keeps the part partial despite an accepted related claim',async()=>{
 const ai=makeAI([answer('PART P1\nThe phrase means an awareness of consequences makes Hamlet hesitate. [S1]\n'+
  'Fear of death makes Hamlet hesitate to act. [S1]'),
  (_model,{messages})=>{
   const payload=parsePayload(messages);
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
    directAnswerClaimIds:['P1-C1']}],claims:payload.claims.map(claim=>{
     const accepted=claim.claimId==='P1-C2';
     return {claimId:claim.claimId,status:accepted?'answered':'partial',
      sources:claim.sourceIds.map(sourceId=>({sourceId,status:accepted?'answered':'partial',
       spanIds:accepted?claim.sourceEvidence.find(item=>item.sourceId===sourceId).spanIds.slice(0,1):[]}))};
    })})};
  }],{decorateReview:false});
 const result=await composeEvidenceAnswer(hamletMeaningQuestion,[hamletMeaningSource],ai,[],{
  plan:hamletMeaningPlan,catalog:{212:hamletMeaningSource.title},trace:true});
 assert.equal(result.questionParts[0].status,'partial');
 assert.equal(result.coverage,'partial');
 assert.ok(result.trace.reviewContract.supportIssues.some(issue=>
  issue.partId==='P1'&&issue.reason==='direct-answer-claim-not-supported'));
 assert.match(result.answer,/Fear of death makes Hamlet hesitate to act/);
});

test('an unsupported nominated answer is repaired once and independently re-reviewed against selected evidence',async()=>{
 const ai=makeAI([answer('PART P1\nHume says necessity is a directly observed power connecting causes to effects. [S1]'),
  (_model,{messages})=>{
   const payload=parsePayload(messages),claim=payload.claims[0];
   return {response:JSON.stringify({parts:[{partId:'P1',status:'partial',answerStatus:'partial',
    repairable:true,directAnswerClaimIds:[claim.claimId]}],claims:[{claimId:claim.claimId,status:'partial',
    sources:[{sourceId:'S1',status:'partial',spanIds:[]}]}]})};
  },
  // Batch 24 (B24-1): the zero-accept rescue runs before the answer
  // repair and rejects every pair, leaving the repair flow untouched.
  rescueRejection(),
  (_model,{messages})=>{
   const payload=parsePayload(messages),part=payload.parts[0];
   assert.deepEqual(part.repair.replaceClaimIds,['P1-C1']);
   assert.equal(part.claims[0].targeted,true);
   return {response:JSON.stringify({parts:[{partId:'P1',replacements:[{claimId:'P1-C1',text:
    'Hume says our idea of necessity arises from uniformity in nature, where similar objects are constantly conjoined, and custom leads the mind to infer one from the other. [S1]'}],additions:[]}]})};
  },
  (_model,{messages})=>{
   const payload=parsePayload(messages);
   const claims=payload.claims.map(claim=>({claimId:claim.claimId,status:'answered',
    sources:claim.sourceIds.map(sourceId=>({sourceId,status:'answered',
     spanIds:claim.sourceEvidence.find(item=>item.sourceId===sourceId).spanIds.slice(0,1)}))}));
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',answerStatus:'answered',
    directAnswerClaimIds:payload.claims.map(claim=>claim.claimId)}],claims})};
  }
 ],{decorateReview:false});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],
  {plan:onePartPlan,catalog,trace:true});
 assert.equal(result.questionParts[0].status,'supported');
 assert.equal(result.coverage,'full');
 assert.match(result.answer,/uniformity in nature.*custom leads the mind to infer/);
 assert.equal(result.evidenceMap.length,1);
 assert.equal(result.trace.answerRepair.applied,true);
 assert.deepEqual(result.trace.answerRepair.partIds,['P1']);
 assert.equal(result.trace.stages.filter(stage=>stage.stage==='answer-re-review').length,1);
 assert.equal(result.usage.calls,5,'repair adds one answer rewrite and one independent review, plus the batch 24 rescue call');
});

test('claim-scoped repair replaces only rejected claims and preserves accepted neighboring claims verbatim',async()=>{
 const preserved='Hume explains causal necessity through custom formed by repeated conjunction. [S1]';
 const ai=makeAI([
  answer('PART P1\nHume says necessity is a directly observed power connecting causes to effects. [S1]\n'+preserved),
  (_model,{messages})=>{
   const payload=parsePayload(messages);
   return {response:JSON.stringify({parts:[{partId:'P1',status:'partial',answerStatus:'partial',
    repairable:true,directAnswerClaimIds:['P1-C1']}],claims:payload.claims.map(claim=>{
     const accepted=claim.claimId==='P1-C2';
     const spanId=claim.sourceEvidence.find(item=>item.sourceId==='S1').spanIds[0];
     return {claimId:claim.claimId,status:accepted?'answered':'partial',
      sources:[{sourceId:'S1',status:accepted?'answered':'partial',spanIds:accepted?[spanId]:[]}]};
    })})};
  },
  (_model,{messages})=>{
   const payload=parsePayload(messages),part=payload.parts[0];
   assert.deepEqual(part.repair.replaceClaimIds,['P1-C1']);
   assert.equal(part.claims.find(claim=>claim.claimId==='P1-C1').targeted,true);
   assert.equal(part.claims.find(claim=>claim.claimId==='P1-C2').targeted,false);
   return {response:JSON.stringify({parts:[{partId:'P1',replacements:[{claimId:'P1-C1',text:
    'Hume explains necessity through repeated conjunction and the mind’s customary inference from it. [S1]'}],additions:[]}]})};
  },
  (_model,{messages})=>{
   const payload=parsePayload(messages);
   const claims=payload.claims.map(claim=>({claimId:claim.claimId,status:'answered',
    sources:claim.sourceIds.map(sourceId=>({sourceId,status:'answered',
     spanIds:claim.sourceEvidence.find(item=>item.sourceId===sourceId).spanIds.slice(0,1)}))}));
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',answerStatus:'answered',
    directAnswerClaimIds:payload.claims.map(claim=>claim.claimId)}],claims})};
  }
 ],{decorateReview:false});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true});
 assert.equal(result.trace.answerRepair.applied,true);
 assert.deepEqual(result.trace.answerRepair.targetClaimIds,[{partId:'P1',claimIds:['P1-C1'],addCoverage:true}]);
 assert.match(result.answer,/Hume explains causal necessity through custom formed by repeated conjunction\. \[S1\]/);
 assert.equal((result.answer.match(/Hume explains causal necessity through custom formed by repeated conjunction/g)||[]).length,1);
 assert.match(result.answer,/the mind’s customary inference/);
 assert.equal(result.usage.calls,4);
});

test('a partial answer-completeness review triggers the existing bounded repair even when its direct claim is supported',async()=>{
 const ai=makeAI([
  answer('PART P1\nHume explains necessity as a directly observed power connecting causes to effects. [S1]'),
  (_model,{messages})=>{
   const payload=parsePayload(messages),claim=payload.claims[0];
   const spanId=claim.sourceEvidence.find(item=>item.sourceId==='S1').spanIds[0];
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',answerStatus:'partial',repairable:true,
    directAnswerClaimIds:[claim.claimId]}],claims:[{claimId:claim.claimId,status:'answered',
    sources:[{sourceId:'S1',status:'answered',spanIds:[spanId]}]}]})};
  },
  (_model,{messages})=>{
   const payload=parsePayload(messages),part=payload.parts[0];
   assert.deepEqual(payload.directAnswerClaimIds,['P1-C1']);
   assert.match(messages[0].content,/Patch only the requested claims/);
   assert.deepEqual(part.repair.replaceClaimIds,[]);
   assert.equal(part.repair.addCoverage,true);
   return {response:JSON.stringify({parts:[{partId:'P1',replacements:[],additions:[
    'Hume says our idea of necessity arises from uniformity in nature, where similar objects are constantly conjoined, and custom leads the mind to infer one from the other. [S1]']}]})};
  },
  (_model,{messages})=>{
   const payload=parsePayload(messages);
   const claims=payload.claims.map(claim=>({claimId:claim.claimId,status:'answered',
    sources:claim.sourceIds.map(sourceId=>({sourceId,status:'answered',
     spanIds:claim.sourceEvidence.find(item=>item.sourceId===sourceId).spanIds.slice(0,1)}))}));
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',answerStatus:'answered',
    directAnswerClaimIds:payload.claims.map(claim=>claim.claimId)}],claims})};
  }
 ],{decorateReview:false});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true});
 assert.equal(ai.calls.length,4,'the repair is conditional and reuses one rewrite plus its existing independent re-review');
 assert.equal(result.trace.answerRepair.attempted,true);
 assert.equal(result.trace.answerRepair.applied,true);
 assert.deepEqual(result.trace.answerRepair.triggerReasons,[{partId:'P1',
  reasons:['repairable-answer-completeness-partial']}]);
 assert.equal(result.coverage,'full');
 assert.match(result.answer,/uniformity in nature.*custom leads the mind to infer/);
 assert.equal(result.trace.stages.filter(stage=>stage.stage==='answer-repair').length,1);
 assert.equal(result.trace.stages.filter(stage=>stage.stage==='answer-re-review').length,1);
});

test('an unsupported direct claim without an explicit repairable finding skips answer repair',async()=>{
 const ai=makeAI([answer('PART P1\nHume says necessity is a directly observed power connecting causes to effects. [S1]'),
  (_model,{messages})=>{
   const payload=parsePayload(messages),claim=payload.claims[0];
   return {response:JSON.stringify({parts:[{partId:'P1',status:'partial',answerStatus:'partial',
    repairable:false,directAnswerClaimIds:[claim.claimId]}],claims:[{claimId:claim.claimId,status:'partial',
    sources:[{sourceId:'S1',status:'partial',spanIds:[]}]}]})};
  }],{decorateReview:false});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true});
 assert.equal(ai.calls.length,3,'a repairability-negative review ends after compose, review, and the batch 24 rescue re-review');
 assert.equal(result.trace.answerRepair.attempted,false);
 assert.equal(result.trace.answerRepair.reason,'reviewer-did-not-mark-repairable');
 assert.equal(result.questionParts[0].status,'unsupported');
});

test('an answer repair that leaves text and citations unchanged skips independent re-review',async()=>{
 const original='Hume says necessity is a directly observed power connecting causes to effects. [S1]';
 const ai=makeAI([answer('PART P1\n'+original),
  (_model,{messages})=>{
   const payload=parsePayload(messages),claim=payload.claims[0];
   return {response:JSON.stringify({parts:[{partId:'P1',status:'partial',answerStatus:'partial',
    repairable:true,directAnswerClaimIds:[claim.claimId]}],claims:[{claimId:claim.claimId,status:'partial',
    sources:[{sourceId:'S1',status:'partial',spanIds:[]}]}]})};
  },
  rescueRejection(),
  (_model,{messages})=>{
   const payload=parsePayload(messages);
   return {response:JSON.stringify({parts:[{partId:'P1',replacements:[{
    claimId:payload.parts[0].repair.replaceClaimIds[0],text:original}],additions:[]}]})};
  }],{decorateReview:false});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true});
 assert.equal(ai.calls.length,4,'an unchanged patch avoids the second review inference (compose, review, rescue, repair)');
 assert.equal(result.trace.answerRepair.reason,'answer-repair-no-material-change');
 assert.equal(result.trace.stages.some(stage=>stage.stage==='answer-re-review'),false);
 assert.equal(result.questionParts[0].status,'unsupported');
});

test('a repairable incomplete part is repaired when the reviewer has not nominated a direct claim',async()=>{
 const ai=makeAI([
  answer('PART P1\nHume explains necessity as a directly observed power connecting causes to effects. [S1]'),
  (_model,{messages})=>{
   const payload=parsePayload(messages),claim=payload.claims[0];
   const spanId=claim.sourceEvidence.find(item=>item.sourceId==='S1').spanIds[0];
   return {response:JSON.stringify({parts:[{partId:'P1',status:'partial',answerStatus:'partial',
    repairable:true,directAnswerClaimIds:[]}],claims:[{claimId:claim.claimId,status:'answered',
    sources:[{sourceId:'S1',status:'answered',spanIds:[spanId]}]}]})};
  },
  (_model,{messages})=>{
   const payload=parsePayload(messages),part=payload.parts[0];
   assert.deepEqual(payload.directAnswerClaimIds,[]);
   assert.deepEqual(part.repair.replaceClaimIds,[]);
   assert.equal(part.repair.addCoverage,true);
   assert.match(messages[0].content,/addCoverage/);
   return {response:JSON.stringify({parts:[{partId:'P1',replacements:[],additions:[
    'Hume says our idea of necessity arises from uniformity in nature, where similar objects are constantly conjoined, and custom leads the mind to infer one from the other. [S1]']}]})};
  },
  (_model,{messages})=>{
   const payload=parsePayload(messages);
   const claims=payload.claims.map(claim=>({claimId:claim.claimId,status:'answered',
    sources:claim.sourceIds.map(sourceId=>({sourceId,status:'answered',
     spanIds:claim.sourceEvidence.find(item=>item.sourceId===sourceId).spanIds.slice(0,1)}))}));
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',answerStatus:'answered',
    directAnswerClaimIds:payload.claims.map(claim=>claim.claimId)}],claims})};
  }
 ],{decorateReview:false});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true});
 assert.equal(ai.calls.length,4,'uses one rewrite and one independent re-review within the existing bound');
 assert.equal(result.trace.answerRepair.applied,true);
 assert.deepEqual(result.trace.answerRepair.triggerReasons,[{partId:'P1',
  reasons:['direct-answer-not-identified','repairable-answer-completeness-partial']}]);
 assert.equal(result.questionParts[0].answerStatus,'answered');
 assert.equal(result.coverage,'full');
 assert.match(result.answer,/uniformity in nature.*custom leads the mind to infer/);
 assert.equal(result.trace.stages.filter(stage=>stage.stage==='answer-repair').length,1);
 assert.equal(result.trace.stages.filter(stage=>stage.stage==='answer-re-review').length,1);
});

test('malformed answer repair falls back to the original fail-closed review result',async()=>{
 const ai=makeAI([answer('PART P1\nHume says necessity is a directly observed power connecting causes to effects. [S1]'),
  (_model,{messages})=>{
   const payload=parsePayload(messages),claim=payload.claims[0];
   return {response:JSON.stringify({parts:[{partId:'P1',status:'partial',answerStatus:'partial',
    repairable:true,directAnswerClaimIds:[claim.claimId]}],claims:[{claimId:claim.claimId,status:'partial',
    sources:[{sourceId:'S1',status:'partial',spanIds:[]}]}]})};
  },rescueRejection(),answer('{not-json}')],{decorateReview:false});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],
  {plan:onePartPlan,catalog,trace:true});
 assert.equal(result.questionParts[0].status,'unsupported');
 assert.equal(result.evidenceMap.length,0);
 assert.doesNotMatch(result.answer,/directly observed power/);
 assert.equal(result.trace.answerRepair.applied,false);
 assert.equal(result.trace.answerRepair.reason,'model-output-invalid-format');
 assert.equal(result.usage.calls,4,'invalid repair does not proceed to re-review (the extra call is the batch 24 rescue)');
});

test('answer repair recovers unescaped quotation marks before the existing validation and re-review',async()=>{
 const ai=makeAI([answer('PART P1\nHume says necessity is a directly observed power connecting causes to effects. [S1]'),
  (_model,{messages})=>{
   const payload=parsePayload(messages),claim=payload.claims[0];
   return {response:JSON.stringify({parts:[{partId:'P1',status:'partial',answerStatus:'partial',
    repairable:true,directAnswerClaimIds:[claim.claimId]}],claims:[{claimId:claim.claimId,status:'partial',
    sources:[{sourceId:'S1',status:'partial',spanIds:[] }]}]})};
  },
  rescueRejection(),
  (_model,{messages})=>{
   const payload=JSON.parse(messages[1].content),claimId=payload.parts[0].repair.replaceClaimIds[0];
   return {response:`{"parts":[{"partId":"P1","replacements":[{"claimId":"${claimId}","text":"Hume links the idea of "necessity" to repeated conjunction and custom. [S1]"}],"additions":[]}]}`};
  },
  (_model,{messages})=>{
   const payload=parsePayload(messages);
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',answerStatus:'answered',
    directAnswerClaimIds:payload.claims.map(claim=>claim.claimId)}],claims:payload.claims.map(claim=>({
     claimId:claim.claimId,status:'answered',sources:claim.sourceIds.map(sourceId=>({sourceId,
      status:'answered',spanIds:claim.sourceEvidence.find(item=>item.sourceId===sourceId).spanIds.slice(0,1)}))}))})};
  }
 ],{decorateReview:false});
 const raw=`{"parts":[{"partId":"P1","replacements":[{"claimId":"P1-C1","text":"Hume describes an idea of "necessity" that arises through custom. [S1]"}],"additions":[]}]}`;
 const parsed=parseAnswerRepairJson({response:raw});
 assert.equal(parsed.parts[0].replacements[0].text,
  'Hume describes an idea of "necessity" that arises through custom. [S1]');
 assert.equal(parsed[Object.getOwnPropertySymbols(parsed)[0]].code,'unescaped-inner-quotes');
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true});
 assert.equal(result.trace.answerRepair.applied,true);
 assert.equal(result.trace.answerRepair.responseRecovery.code,'unescaped-inner-quotes');
 assert.match(result.answer,/idea of "necessity" to repeated conjunction and custom/);
 assert.equal(result.usage.calls,5,'syntax recovery uses the existing repair and re-review calls, plus the batch 24 rescue call');
 assert.equal(result.trace.stages.filter(stage=>stage.stage==='answer-re-review').length,1);
});

test('answer repair quote recovery leaves unrelated malformed JSON fail-closed',()=>{
 assert.throws(()=>parseAnswerRepairJson({response:'{"parts":[{"partId":"P1",}],}'}),
  /valid JSON/);
});

test('an answer repair that patches an unrequested claim fails closed without re-review',async()=>{
 const ai=makeAI([answer('PART P1\nHume says necessity is a directly observed power connecting causes to effects. [S1]'),
  (_model,{messages})=>{
   const payload=parsePayload(messages),claim=payload.claims[0];
   return {response:JSON.stringify({parts:[{partId:'P1',status:'partial',answerStatus:'partial',
    repairable:true,directAnswerClaimIds:[claim.claimId]}],claims:[{claimId:claim.claimId,status:'partial',
    sources:[{sourceId:'S1',status:'partial',spanIds:[]}]}]})};
  },
  rescueRejection(),
  ()=>({response:JSON.stringify({parts:[{partId:'P1',replacements:[{claimId:'P1-C99',
   text:'An unrequested claim is rewritten. [S1]'}],additions:[]}]})})],{decorateReview:false});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true});
 assert.equal(result.trace.answerRepair.applied,false);
 assert.equal(result.trace.answerRepair.reason,'answer-repair-invalid');
 assert.equal(result.questionParts[0].status,'unsupported');
 assert.equal(result.usage.calls,4);
 assert.equal(result.trace.stages.some(stage=>stage.stage==='answer-re-review'),false);
});

test('an overinclusive direct-answer set can retain a supported answer claim when the reviewer still judges the part complete',async()=>{
 const ai=makeAI([answer('PART P1\nHume explains causal necessity through custom formed by repeated conjunction. [S1]\n'+
  'He also connects the debate to a broad historical account of science. [S1]'),
  (_model,{messages})=>{
   const payload=parsePayload(messages);
   const directIds=payload.claims.filter(claim=>claim.sourceIds.includes('S1'))
    .slice(0,2).map(claim=>claim.claimId);
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',answerStatus:'answered',
    directAnswerClaimIds:directIds}],claims:payload.claims.map(claim=>{
     const essential=claim.claimId===directIds[0];
     const spanId=claim.sourceEvidence.find(item=>item.sourceId==='S1')?.spanIds[0];
     return {claimId:claim.claimId,status:essential?'answered':'partial',sources:
      claim.sourceIds.map(sourceId=>({sourceId,status:essential?'answered':'partial',
       spanIds:essential&&spanId?[spanId]:[]}))};
    })})};
  }],{decorateReview:false});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true});
 assert.equal(result.questionParts[0].status,'supported');
 assert.equal(result.questionParts[0].answerStatus,'answered');
 assert.match(result.answer,/custom formed by repeated conjunction/);
 assert.doesNotMatch(result.answer,/broad historical account/);
 assert.ok(result.trace.reviewContract.supportIssues.some(issue=>
  issue.reason==='claim-source-not-supported'));
});

test('answer coverage prompt requires every explicit element while allowing qualified general knowledge',()=>{
 assert.match(COMPOSER_PROMPT,/Address every explicit request within that part/i);
 assert.match(COMPOSER_PROMPT,/appropriately qualified answer from general knowledge/i);
});

test('Markdown cleanup drops only a bare unfinished bold list heading',()=>{
 const normalized=normalizeAnswerMarkdown('Supported point.\n\n* **Valid heading:** detail\n* **Unfinished heading');
 assert.match(normalized,/\*\*Valid heading:\*\*/);
 assert.match(normalized,/detail/);
 assert.doesNotMatch(normalized,/Unfinished heading/);
 assert.match(normalized,/Supported point/);
});

test('a cross-part direct-answer ID cannot satisfy this part',async()=>{
 const ai=makeAI([answer('PART P1\nThe phrase means fear of death can make people hesitate to act. [S1]'),
  directAnswerReview(['P2-C1'])],{decorateReview:false});
 const result=await composeEvidenceAnswer(hamletMeaningQuestion,[hamletMeaningSource],ai,[],{
  plan:hamletMeaningPlan,catalog:{212:hamletMeaningSource.title},trace:true});
 assert.equal(result.questionParts[0].status,'partial');
 assert.equal(result.trace.reviewContract.partDecisions[0].directAnswerClaimIds[0],'P2-C1');
 assert.equal(result.trace.reviewContract.partDecisions[0].directAnswerCovered,false);
 assert.ok(result.trace.reviewContract.supportIssues.some(issue=>
  issue.partId==='P1'&&issue.reason==='invalid-direct-answer-claim-id'));
});

test('a missing direct-answer nomination leaves an otherwise reviewed part partial',async()=>{
 const ai=makeAI([answer('PART P1\nThe phrase means fear of death can make people hesitate to act. [S1]'),
  (_model,{messages})=>{
   const payload=parsePayload(messages);
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered'}],
    claims:payload.claims.map(claim=>({claimId:claim.claimId,status:'answered',
     sources:claim.sourceIds.map(sourceId=>({sourceId,
      spanIds:claim.sourceEvidence.find(item=>item.sourceId===sourceId).spanIds.slice(0,1)}))}))})};
  }],{decorateReview:false});
 const result=await composeEvidenceAnswer(hamletMeaningQuestion,[hamletMeaningSource],ai,[],{
  plan:hamletMeaningPlan,catalog:{212:hamletMeaningSource.title},trace:true});
 assert.equal(result.questionParts[0].status,'partial');
 assert.equal(result.coverage,'partial');
 assert.deepEqual(result.trace.reviewContract.partDecisions[0].directAnswerClaimIds,[]);
 assert.equal(result.trace.reviewContract.partDecisions[0].directAnswerCovered,false);
 assert.match(REVIEW_PROMPT,/directAnswerClaimIds/);
 assert.match(REVIEW_PROMPT,/candidate, not a mandatory answer/);
 assert.doesNotMatch(REVIEW_PROMPT,/sourceId":"S1","status"/);
});

test('a surviving later claim can answer the part when the opening claim is rejected',async()=>{
 const ai=makeAI([answer('PART P1\nAwareness of consequences explains the phrase. [S1]\n'+
  'Fear of death makes Hamlet hesitate to act. [S1]'),
  (_model,{messages})=>{
   const payload=parsePayload(messages);
   const first=payload.claims.find(claim=>claim.claimId==='P1-C1');
   const direct=payload.claims.find(claim=>claim.claimId==='P1-C2');
   const firstSpan=first.sourceEvidence[0].spanIds[0];
   const directSpan=direct.sourceEvidence[0].spanIds[0];
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
    directAnswerClaimIds:['P1-C2']}],claims:payload.claims.map(claim=>({
    claimId:claim.claimId,status:claim.claimId==='P1-C2'?'answered':'partial',
    sources:claim.sourceIds.map(sourceId=>({sourceId,
     spanIds:claim.claimId==='P1-C2'?[directSpan]:[firstSpan]}))}))})};
  }],{decorateReview:false});
 const result=await composeEvidenceAnswer(hamletMeaningQuestion,[hamletMeaningSource],ai,[],{
  plan:hamletMeaningPlan,catalog:{212:hamletMeaningSource.title},trace:true});
 assert.equal(result.questionParts[0].status,'supported');
 assert.equal(result.coverage,'full');
 assert.doesNotMatch(result.answer,/Awareness of consequences explains the phrase/);
 assert.match(result.answer,/Fear of death makes Hamlet hesitate to act/);
 assert.deepEqual(result.trace.reviewContract.partDecisions[0].directAnswerClaimIds,['P1-C2']);
 assert.deepEqual(result.trace.reviewContract.partDecisions[0].acceptedDirectAnswerClaimIds,['P1-C2']);
 assert.equal(result.trace.reviewContract.partDecisions[0].directAnswerCovered,true);
});

test('the deterministic polarity guard rejects a reviewed positive claim that reverses an exact source negation',async()=>{
 const source={id:'S1',bookId:'140',title:'Fear and Trembling — Søren Kierkegaard',page:40,
  text:'I cannot plunge confidently into the absurd, for I who speak am not Abraham.',
  preview:'I cannot plunge confidently into the absurd.'};
 const ai=makeAI([answer('PART P1\nJohannes de Silentio can plunge confidently into the absurd. [S1].'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('What does Fear and Trembling say about plunging into the absurd?',
  [source],ai,[],{catalog:{140:'Fear and Trembling — Søren Kierkegaard'},
   plan:{intent:'explain',sources:[{label:'Søren Kierkegaard',role:'primary',bookIds:['140']}],
    parts:[{id:'P1',question:'What does the text say about the speaker’s ability?',sourceBookIds:['140']}]},trace:true});
 assert.equal(result.coverage,'none');
 assert.doesNotMatch(result.answer,/can plunge confidently/i);
 assert.ok(result.trace.reviewContract.supportIssues.some(issue=>
  issue.sourceId==='S1'&&issue.reason==='source-contradicts-claim-polarity'));
});

test('the deterministic polarity guard accepts the Consolation paraphrase and does not mix unrelated modal clauses',async()=>{
 const source={id:'S1',bookId:'21',title:'The Consolation of Philosophy — Boethius',page:77,
  text:'The happiness of a life cannot be fixed among the goods of fortune, because what can be snatched away is not the highest good.',
  preview:'What can be snatched away is not the highest good.'};
 const ai=makeAI([answer('PART P1\nBoethius argues that the highest good cannot be taken away. Other goods can be snatched away by fortune and circumstance. [S1]'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('What does Boethius say about the highest good and fortune?',
  [source],ai,[],{catalog:{21:source.title},
   plan:{intent:'explain',sources:[{label:'Boethius',role:'primary',bookIds:['21']}],
    parts:[{id:'P1',question:'What does Boethius say about the highest good and fortune?',sourceBookIds:['21']}]},trace:true});
 assert.equal(result.coverage,'full');
 assert.equal(result.questionParts[0].status,'supported');
 assert.equal(result.trace.reviewContract.supportIssues.some(issue=>
  issue.reason==='source-contradicts-claim-polarity'),false,
  'the source agrees that what fortune can take away is not the highest good');
});

test('the logical-scope guard distinguishes neither-or from not-both paraphrases',async()=>{
 const source={id:'S1',bookId:'72',title:'Case Review',page:18,
  text:'It is not right to state that a contract is valid nor invalid before the missing evidence is reviewed.',
  preview:'It is not right to state that a contract is valid nor invalid before the missing evidence is reviewed.'};
 const ai=makeAI([answer('PART P1\nIt is incorrect to say the contract is both valid and invalid before the evidence is reviewed. [S1]'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('What does the report say about the contract?',[source],ai,[],
  {plan:{intent:'explain',sources:[{label:'Case Review',role:'primary',bookIds:['72']}],
   parts:[{id:'P1',question:'What does the report say about the contract?',sourceBookIds:['72']}]},
   catalog:{'72':'Case Review'},trace:true});
 assert.equal(result.coverage,'none');
 assert.ok(result.trace.reviewContract.supportIssues.some(issue=>
  issue.sourceId==='S1'&&issue.reason==='source-negation-scope-mismatch'));
});

test('the answer contract allows useful general context while keeping cited claims traceable',()=>{
 assert.match(COMPOSER_PROMPT,/use your broader knowledge/);
 assert.match(COMPOSER_PROMPT,/use broader knowledge freely for relevant context, explanation, definitions, and synthesis/i);
 assert.match(COMPOSER_PROMPT,/Prefer concrete, question-specific details/);
 assert.match(COMPOSER_PROMPT,/Avoid generic statements that could fit many unrelated questions/);
 assert.match(COMPOSER_PROMPT,/When you promise examples, reasons, or several ways, provide them/);
 assert.match(COMPOSER_PROMPT,/In \"general-context\" mode, give a substantive direct answer from general knowledge/i);
 assert.match(COMPOSER_PROMPT,/Each part includes an answerMode/);
 assert.match(COMPOSER_PROMPT,/exact form: \[S1\] or \[S1, S2\]/);
 assert.match(COMPOSER_PROMPT,/a book title, author name, or parenthetical \(S1\) is not a citation/);
 assert.match(COMPOSER_PROMPT,/Keep each citation attached to the claim supported by that exact supplied page ID; never transfer one author’s or work’s citation label to a different source’s position/);
 assert.match(COMPOSER_PROMPT,/Do not cite every sentence just because it is factual/);
 assert.match(COMPOSER_PROMPT,/Start each part with a direct, calibrated answer to the exact question/);
 assert.match(COMPOSER_PROMPT,/For uncertain or disputed questions, distinguish what the evidence establishes from what remains possible/);
 assert.match(COMPOSER_PROMPT,/neither P nor Q.*not both P and Q/);
 assert.match(REVIEW_PROMPT,/logical relations.*neither P nor Q.*not both P and Q/);
 assert.match(REVIEW_PROMPT,/When a claim says how one thing affects or relates to another, the span must support that connection/);
 assert.match(REVIEW_PROMPT,/For a cited claim with multiple independently checkable source-derived clauses, also return clauses/);
 assert.match(REVIEW_PROMPT,/copying its text exactly as it appears in the supplied claim/);
 assert.match(REVIEW_PROMPT,/Uncited general-context claims are assessed at the part level and do not need clause spans or citations/);
 assert.match(REVIEW_PROMPT,/A passage that only announces, previews, or refers to a topic does not support substantive claims about what that topic means/);
 assert.match(COMPOSER_PROMPT,/Keep the opening focused on the reader rather than a preview of themes/);
 assert.match(COMPOSER_PROMPT,/If that opening sentence summarizes or combines positions from supplied passages, cite the page IDs that support those components in the sentence/);
 assert.match(COMPOSER_PROMPT,/Leave independent background or your own interpretation uncited when it does not present a supplied source's position/);
 assert.match(COMPOSER_PROMPT,/explain how they relate without treating them as proof/);
 assert.match(COMPOSER_PROMPT,/general background and your own synthesis do not need a library citation/i);
 assert.doesNotMatch(COMPOSER_PROMPT,/using only the supplied verified passage windows|Cite every factual sentence|rely on outside knowledge/);
 assert.match(COMPOSER_PROMPT,/Write focused connected prose/);
 assert.match(COMPOSER_PROMPT,/do not repeat the full explanation of each view/);
 assert.match(COMPOSER_PROMPT,/Avoid repeating the same point across parts/);
 assert.match(EXPANSION_PROMPT,/broader knowledge/);
 assert.doesNotMatch(EXPANSION_PROMPT,/rely on outside knowledge|only where the supplied verified passage windows/);
 assert.match(REVIEW_PROMPT,/Claims with an empty sourceIds array are uncited; do not assume from that alone that they are general context/);
 assert.match(REVIEW_PROMPT,/Require a source ID and exact span only when a claim attributes a position to a supplied work/);
 assert.match(REVIEW_PROMPT,/Merely mentioning a work or person in independent background does not require a citation/);
 assert.match(REVIEW_PROMPT,/independent background and synthesis may remain uncited/i);
 assert.match(REVIEW_PROMPT,/Judge each part against the exact question/);
 assert.match(REVIEW_PROMPT,/broad generalities that could fit unrelated topics are not a complete answer/);
 assert.match(REVIEW_PROMPT,/without demanding citations for independent background or every factual sentence/);
 assert.match(COMPOSER_PROMPT,/reviewer will assess which claim or claims directly answer the question/);
 assert.match(REVIEW_PROMPT,/describes the collection, not the answer to the reader/);
 assert.match(REVIEW_PROMPT,/complementary passages may support different components of a concise synthesis/);
 assert.match(REVIEW_PROMPT,/Do not mark a corpus-gap statement or merely adjacent source discussion as an answer/);
 assert.match(REVIEW_PROMPT,/only related background or ends with an unfinished thought/);
 assert.match(REVIEW_PROMPT,/the supplied passages cannot establish its truth, so do not treat their silence as disproof/);
 assert.match(REVIEW_PROMPT,/Return the supporting span IDs/);
 assert.match(REVIEW_PROMPT,/Return one valid JSON object only/);
 assert.match(REVIEW_PROMPT,/For a claim with sourceIds empty, return an empty sources array/);
 assert.match(REVIEW_PROMPT,/retainedContextClaimIds list may contain only IDs from that part's supplied contextClaims/);
});

test('evidence-free parts invite a direct general-context answer without adding a model call',async()=>{
 const question='How did Dostoevsky and Nietzsche approach nihilism?';
 const plan={...onePartPlan,parts:[{...onePartPlan.parts[0],question,candidateSourceIds:[]}]};
 const ai=makeAI([answer('PART P1\nDostoevsky explores nihilism through characters who confront the loss of religious and moral foundations. Nietzsche analyzes nihilism as the collapse of inherited values and asks how new values might be created.'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer(question,[],ai,[],{plan,catalog,trace:true});
 const composePayload=JSON.parse(ai.calls[0].request.messages[1].content);
 const reviewPayload=parsePayload(ai.calls[1].request.messages);
 assert.equal(composePayload.parts[0].answerMode,'general-context');
 assert.equal(reviewPayload.parts[0].answerMode,'general-context');
 assert.equal(ai.calls.length,2,'general context uses the existing compose and review calls');
 assert.equal(result.outcome,'general-context-answer');
 assert.equal(result.citations.length,0,'general context does not invent library citations');
 assert.match(result.answer,/Nietzsche analyzes nihilism/);
});

test('a multi-part source-and-context answer keeps direct general knowledge for an evidence gap',async()=>{
 const question='How does Hume explain causal necessity, and how does the Odyssey picture heroism?';
 const plan={...onePartPlan,parts:[
  {...onePartPlan.parts[0],id:'P1',question:'How does Hume explain causal necessity?',candidateSourceIds:['S1']},
  {id:'P2',question:'How does the Odyssey picture heroism?',sourceBookIds:[],
   searchQueries:[],candidateSourceIds:[]}
 ]};
 const gapReviewer=(_model,{messages})=>{
  const payload=parsePayload(messages);
  const response=review([['P1','answered'],['P2','partial']])(_model,{messages});
  const parsed=JSON.parse(response.response);
  const p2Decision=parsed.parts.find(part=>part.partId==='P2');
  if(p2Decision){
   const contextClaim=payload.parts.find(part=>part.partId==='P2')?.contextClaims?.[0]?.claimId;
   p2Decision.answerStatus='answered';
   p2Decision.directAnswerClaimIds=contextClaim?[contextClaim]:[];
   p2Decision.retainedContextClaimIds=contextClaim?[contextClaim]:[];
  }
  return {...response,response:JSON.stringify(parsed)};
 };
 // Batch 11 (B11-4): P2 is partial with the Hume page in its packet
 // (answerMode source-and-context below) and ships uncited, so the
 // widened citation gate now spends one repair attempt on it. The
 // repair below restores no citation, so the part keeps its general
 // knowledge answer and its answered answerStatus; only the call
 // count and the gate trace change.
 const uncitedGateRepair=(_model,{messages})=>{
  const payload=parsePayload(messages);
  return {response:JSON.stringify({parts:[{partId:'P2',
   replacements:payload.parts[0].repair.replaceClaimIds.map(claimId=>({claimId,
    text:'The Odyssey presents heroism through endurance, judgment, and the difficult return home.'})),
   additions:[]}]})};
 };
 const ai=makeAI([answer('PART P1\nHume links causal necessity to custom formed through repeated conjunction. [S1]\n\n'+
  'PART P2\nThe Odyssey presents heroism through endurance, judgment, and the difficult return home.'),
  gapReviewer,gapReviewer,uncitedGateRepair]);
 const result=await composeEvidenceAnswer(question,[hume],ai,[],{plan,catalog,trace:true});
 const composePayload=JSON.parse(ai.calls[0].request.messages[1].content);
 assert.equal(composePayload.parts.find(part=>part.partId==='P2').answerMode,'general-context');
 assert.equal(result.questionParts[1].answerStatus,'answered');
 assert.equal(result.answerCompleteness,'full');
 assert.match(result.answer,/The Odyssey presents heroism/);
 assert.match(result.answer,/Hume links causal necessity.*\[S1\]/);
 assert.equal(result.questionParts[1].sourceRequired,false,
  'an all-books candidate from an unrelated source group is not a source requirement for this part');
 assert.equal(result.trace.citationGate,undefined,
  'general-context answer parts retain the uncited allowance');
 assert.equal(ai.calls.length,3,'compose and one review per planned part; no citation repair is needed');
});

test('a reviewed direct general-context claim is retained without duplicating it in context IDs',async()=>{
 const question='How did Hume explain causal necessity?';
 const ai=makeAI([answer('PART P1\nHume explains causal necessity through learned expectation formed by repeated conjunctions.'),
  (_model,{messages})=>{
   const payload=parsePayload(messages);
   const directId=payload.parts[0].contextClaims[0].claimId;
   return {response:JSON.stringify({parts:[{partId:'P1',status:'partial',answerStatus:'answered',
    directAnswerClaimIds:[directId],retainedContextClaimIds:[]}],claims:[]})};
  }],{decorateReview:false});
 const result=await composeEvidenceAnswer(question,[],ai,[],{
  plan:{...onePartPlan,parts:[{...onePartPlan.parts[0],question,candidateSourceIds:[]}]},catalog,trace:true});
 assert.equal(result.answerCompleteness,'full');
 assert.equal(result.questionParts[0].answerStatus,'answered');
 assert.equal(result.questionParts[0].status,'partial','library coverage stays separate from answer completeness');
 assert.match(result.answer,/causal necessity/);
 assert.equal(result.citations.length,0);
 assert.equal(result.trace.reviewContract.partDecisions[0].directAnswerCovered,true);
 assert.equal(ai.calls.length,2);
});

test('multi-source part coverage stays partial even when planner intent is misclassified',async()=>{
 const question='How do Hume and Kant differ in explaining causality?';
 const humeSource={...hume,id:'S1',candidatePartIds:['P1']};
 const ai=makeAI([answer('PART P1\nHume explains causality through custom formed by repeated experience. [S1]'),
  review([['P1','answered']])]);
 const plan={version:'reader-evidence-v2',intent:'explain',
  sources:[{label:'David Hume',role:'primary',bookIds:['35']},
   {label:'Immanuel Kant',role:'primary',bookIds:['40']}],
  parts:[{id:'P1',question,sourceBookIds:['35','40'],candidateSourceIds:['S1']}],
  queries:['Hume causality custom','Kant causality a priori']};
 const result=await composeEvidenceAnswer(question,[humeSource],ai,[],{plan,catalog,trace:true});
 assert.equal(result.questionParts[0].status,'partial',
  'one author’s passage cannot establish library coverage for both named source groups');
 assert.equal(result.questionParts[0].answerStatus,'answered',
  'qualified general knowledge may still complete the answer');
 assert.equal(result.coverage,'partial');
 assert.equal(result.answerCompleteness,'full');
 assert.ok(result.trace.reviewContract.supportIssues.some(issue=>
  issue.reason==='comparison-support-missing-source-group'));
 assert.equal(ai.calls.length,2,'the completeness check uses the existing compose and review calls');
});

test('a direct general-context nomination is not enough when answerStatus is partial',async()=>{
 const question='How did Hume explain causal necessity?';
 const ai=makeAI([answer('PART P1\nHume explains causal necessity through learned expectation formed by repeated conjunctions.'),
  (_model,{messages})=>{
   const payload=parsePayload(messages);
   const directId=payload.parts[0].contextClaims[0].claimId;
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',answerStatus:'partial',
    directAnswerClaimIds:[directId],retainedContextClaimIds:[]}],claims:[]})};
  }],{decorateReview:false});
 const result=await composeEvidenceAnswer(question,[],ai,[],{
  plan:{...onePartPlan,parts:[{...onePartPlan.parts[0],question,candidateSourceIds:[]}]},catalog,trace:true});
 assert.equal(result.answerCompleteness,'none');
 assert.equal(result.trace.reviewContract.partDecisions[0].directAnswerCovered,false);
 assert.match(result.answer,/did not support a reliable answer/);
 assert.doesNotMatch(result.answer,/Hume explains causal necessity/);
});

test('an unheaded single-part source claim reaches review and is not treated as verified context',async()=>{
 const question='What does Hume say about causal necessity?';
 const ai=makeAI([answer('Hume argues that necessity arises from custom rather than from observing a necessary connection.'),
  (_model,{messages})=>{
   const payload=parsePayload(messages);
   assert.deepEqual(payload.claims,[],'uncited context is assessed from the explicit context list');
   assert.equal(payload.parts[0].contextClaims.length,1);
   return review([['P1','unanswered']])(_model,{messages});
  }]);
 const result=await composeEvidenceAnswer(question,[hume],ai,[],{
  plan:{...onePartPlan,parts:[{...onePartPlan.parts[0],question}]},catalog,trace:true
 });
 assert.equal(ai.calls.length,2,'the recovered one-part draft reaches the existing reviewer');
 assert.equal(result.coverage,'none');
 assert.equal(result.outcome,'insufficient-evidence');
 assert.equal(result.failureCode,undefined,'an omitted heading is recoverable for one planned part');
 assert.equal(result.trace.recovery.code,'missing-part-heading');
 assert.equal(result.citations.length,0);
});

test('an unrelated uncited explanation remains partial when the reviewer judges it indirect',async()=>{
 const question='Are we living in a simulation?';
 const ai=makeAI([answer('PART P1\nBaudrillard describes hyperreality as a condition where representations shape social life.'),
  review([['P1','partial']])]);
 const result=await composeEvidenceAnswer(question,[],ai,[],{
  plan:{...onePartPlan,parts:[{...onePartPlan.parts[0],question}]},catalog,trace:true
 });
 assert.equal(result.outcome,'insufficient-evidence');
 assert.equal(result.coverage,'none');
 assert.doesNotMatch(result.answer,/Baudrillard/);
 assert.equal(result.citations.length,0);
});

test('a collection-gap opening stays partial when the rest is only adjacent cited context',async()=>{
 const question='Are we living in a simulation?';
 const source={...hume,candidatePartIds:['P1']};
 const ai=makeAI([answer('PART P1\nThe library passages do not directly answer whether we live in a simulation.\n'+
   'Hume’s account of custom offers a related perspective on how people form beliefs. [S1]'),
  (_model,{messages})=>{
   const payload=parsePayload(messages);
   const cited=payload.claims.find(claim=>claim.sourceIds.includes('S1'));
   const spanId=cited.sourceEvidence.find(item=>item.sourceId==='S1').spanIds[0];
   return {response:JSON.stringify({parts:[{partId:'P1',status:'partial'}],claims:
    payload.claims.map(claim=>({claimId:claim.claimId,
     status:claim===cited?'answered':'partial',sources:claim.sourceIds.map(sourceId=>({sourceId,
      spanIds:sourceId==='S1'?[spanId]:[]}))}))})};
  }],{decorateReview:false});
 const result=await composeEvidenceAnswer(question,[source],ai,[],{
  plan:{...onePartPlan,parts:[{...onePartPlan.parts[0],question}]},catalog,trace:true
 });
 assert.equal(result.questionParts[0].status,'partial');
 assert.notEqual(result.coverage,'full');
 assert.equal(result.trace.reviewContract.partDecisions[0].directAnswerCovered,false,
  'a note about library coverage cannot satisfy the first-sentence answer gate');
 assert.match(result.answer,/Hume’s account of custom/,
  'related context can remain visible without being called an answer');
});

const hypotheticalQuestion='What would Nietzsche think about the thought of Kierkegaard?';
const hypotheticalCatalog={
 '140':'Fear and Trembling — Søren Kierkegaard',
 '239':'The Portable Nietzsche — Friedrich Nietzsche'
};
const hypotheticalPlan={intent:'compare',sources:[
 {label:'Friedrich Nietzsche',role:'primary',bookIds:['239']},
 {label:'Søren Kierkegaard',role:'primary',bookIds:['140']}
],parts:[
 {id:'P1',question:'What position does Nietzsche take on Christianity?',sourceBookIds:['239']},
 {id:'P2',question:'What does Kierkegaard say about religious inwardness?',sourceBookIds:['140']},
 {id:'P3',question:'What cautious inference follows about Nietzsche’s response to Kierkegaard?',sourceBookIds:['239','140']}
]};
const hypotheticalSources=[
 {id:'S1',bookId:'239',title:hypotheticalCatalog['239'],page:598,
  text:'Nietzsche describes Christian faith as metaphysical faith in God as truth and questions the will to truth behind it.',
  preview:'Nietzsche describes Christian faith as metaphysical faith in God as truth and questions the will to truth behind it.'},
 {id:'S2',bookId:'140',title:hypotheticalCatalog['140'],page:44,
  text:'Johannes de Silentio describes faith as belief by virtue of the absurd and as a relation to God.',
  preview:'Johannes de Silentio describes faith as belief by virtue of the absurd and as a relation to God.'}
];
function hypotheticalReview(){
 return (_model,{messages})=>{
  const payload=parsePayload(messages);
  const parts=payload.parts.map(part=>({partId:part.partId,
   status:payload.claims.some(claim=>claim.partId===part.partId)?'answered':'unanswered'}));
  const claims=payload.claims.map(claim=>({claimId:claim.claimId,status:'answered',
   spanIds:claim.sourceIds.map(sourceId=>payload.parts.find(part=>part.partId===claim.partId)
    .evidence.find(item=>item.id===sourceId).spans[0].spanId)}));
  return {response:JSON.stringify({parts,claims})};
 };
}
function hypotheticalDraft(inference){
 return answer([
  'PART P1',
  'Nietzsche describes Christian faith as metaphysical faith in God as truth. [S1]',
  'PART P2',
  'In Fear and Trembling, Johannes de Silentio describes faith as belief by virtue of the absurd and a relation to God. [S2]',
  'PART P3',
  inference
 ].join('\n'));
}

test('a qualified Nietzsche-on-Kierkegaard inference is retained only with both authors’ reviewed evidence',async()=>{
 let reviewPayload;
 const capturingReviewer=(_model,{messages})=>{reviewPayload=parsePayload(messages);
  return hypotheticalReview()(_model,{messages});};
 const ai=makeAI([hypotheticalDraft(
  'As a cautious reader inference, if Nietzsche applied his criticism of Christian faith to Johannes de Silentio’s account of faith, he might question whether that account establishes truth about God. [S1, S2]'),
  capturingReviewer,capturingReviewer,capturingReviewer
 ]);
 const result=await composeEvidenceAnswer(hypotheticalQuestion,hypotheticalSources,ai,[],{
  plan:hypotheticalPlan,catalog:hypotheticalCatalog,trace:true
 });
 assert.equal(ai.calls.length,4,'the fix must stay within the existing compose + per-part review budget');
 assert.equal(result.coverage,'full');
 assert.equal(result.questionParts[2].status,'supported');
 assert.match(result.answer,/cautious reader inference/i);
 assert.match(result.answer,/applied his criticism of Christian faith/);
 assert.match(result.answer,/Johannes de Silentio/);
 assert.match(result.answer,/establishes truth about God/);
 assert.match(result.answer,/\[S1, S2\]/);
 const p3Claim=reviewPayload.claims.find(claim=>claim.partId==='P3');
 assert.deepEqual(p3Claim.sourceEvidence.map(item=>reviewPayload.sourceCatalog[item.sourceId].sourceGroup),[
  {label:'Friedrich Nietzsche',role:'primary'},
  {label:'Søren Kierkegaard',role:'primary'}
 ]);
 assert.deepEqual(new Set(result.evidenceMap.filter(item=>item.claimId.startsWith('P3-'))
  .map(item=>item.id)),new Set(['S1','S2']));
 assert.equal(result.trace.reviewContract.valid,true);
 assert.deepEqual(result.trace.coverageGaps,[]);
});

test('a broad hypothetical conclusion stays partial even when both premise sources are supported',async()=>{
 const broadReviewer=(_model,{messages})=>{
  const payload=parsePayload(messages);
  const claims=payload.claims.map(claim=>({claimId:claim.claimId,
   status:claim.partId==='P3'?'partial':'answered',
   sources:claim.sourceIds.map(sourceId=>({sourceId,status:'answered',
    spanIds:[claim.sourceEvidence.find(item=>item.sourceId===sourceId).spanIds[0]]}))}));
  return {response:JSON.stringify({parts:payload.parts.map(part=>({partId:part.partId,
   status:part.partId==='P3'?'partial':'answered'})),claims})};
 };
 const ai=makeAI([hypotheticalDraft(
  'From these passages, one cautious inference is that Nietzsche would reject Kierkegaard’s entire philosophy as life-denying. [S1, S2]'),
  broadReviewer,broadReviewer,broadReviewer
 ]);
 const result=await composeEvidenceAnswer(hypotheticalQuestion,hypotheticalSources,ai,[],{
  plan:hypotheticalPlan,catalog:hypotheticalCatalog,trace:true
 });
 assert.equal(ai.calls.length,5,'broad unsupported synthesis remains partial without a repairability signal (the fifth call is the batch 24 rescue for the zero-accept synthesis part)');
 assert.equal(result.coverage,'partial');
 assert.equal(result.questionParts[0].status,'supported');
 assert.equal(result.questionParts[1].status,'supported');
 assert.equal(result.questionParts[2].status,'unsupported');
 assert.doesNotMatch(result.answer,/reject Kierkegaard’s entire philosophy/);
 assert.equal(result.trace.reviewContract.recovered.some(item=>item.partId==='P3'),false);
});

test('a hypothetical can cite one relevant page per author when more group pages are available',async()=>{
 const catalog={...hypotheticalCatalog,
  '54':'On the Genealogy of Morals — Friedrich Nietzsche',
  '144':'Beyond Good and Evil — Friedrich Nietzsche',
  '192':'Philosophical Fragments — Søren Kierkegaard',
  '253':'The Sickness Unto Death — Søren Kierkegaard',
  '436':'Kierkegaard’s Attack Upon “Christendom,” 1854–1855 — Søren Kierkegaard'
 };
 const sources=[
  {...hypotheticalSources[0],candidatePartIds:['P1','P3']},
  {...hypotheticalSources[1],candidatePartIds:['P2','P3']},
  ...[['S3','54'],['S4','144'],['S5','192'],['S6','253'],['S7','436']].map(([id,bookId])=>({
   id,bookId,title:catalog[bookId],page:20,text:'Related source text not used as a premise in this inference.',
   preview:'Related source text not used as a premise in this inference.',candidatePartIds:['P3']
  }))
 ];
 const plan={...hypotheticalPlan,
  sources:[{label:'Friedrich Nietzsche',role:'primary',bookIds:['239','54','144']},
   {label:'Søren Kierkegaard',role:'primary',bookIds:['140','192','253','436']}],
  parts:hypotheticalPlan.parts.map(part=>part.id==='P3'?
   {...part,sourceBookIds:['239','54','144','140','192','253','436']}:part)
 };
 let reviewPayload;
 const reviewer=(_model,{messages})=>{
  reviewPayload=parsePayload(messages);
  return hypotheticalReview()(_model,{messages});
 };
 const ai=makeAI([hypotheticalDraft(
  'From these passages, one cautious inference is that Nietzsche might have viewed Kierkegaard’s emphasis on religious inwardness as part of the Christian outlook he rejects. [S1, S2]'),
  reviewer,reviewer,reviewer
 ]);
 const result=await composeEvidenceAnswer(hypotheticalQuestion,sources,ai,[],{plan,catalog,trace:true});
 const inference=reviewPayload.claims.find(claim=>claim.partId==='P3');
 assert.deepEqual(inference.sourceIds,['S1','S2']);
 assert.equal(result.coverage,'full');
 assert.equal(ai.calls.length,4);
});

test('review sees a bounded per-source packet and cannot select an unsent full-source span',async()=>{
 const text=Array.from({length:24},(_,index)=>
  `This unrelated passage discusses ordinary philosophical subjects number ${index+1}.`).join('\n\n\n');
 const source={...hume,text,preview:text,candidatePartIds:['P1'],
  candidatePartSupport:[{partId:'P1',support:'context',excerpt:'A cue from the earlier selector.'},
   {partId:'P2',support:'direct',excerpt:'A cue belonging to a different planned part.'}]};
 const plan={...onePartPlan,parts:[{...onePartPlan.parts[0],candidateSourceIds:['S1']} ]};
 const draft='PART P1\nHume explains causal necessity through custom and habit in repeated experience. [S1]';
 const runWithSpan=async spanId=>{
  let payload;
  const ai=makeAI([answer(draft),(_model,{messages})=>{
   payload=parsePayload(messages);
   const claim=payload.claims[0];
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
    directAnswerClaimIds:[claim.claimId]}],claims:[{claimId:claim.claimId,status:'answered',
    sources:[{sourceId:'S1',status:'answered',spanIds:[spanId]}]}]})};
  }],{decorateReview:false});
  const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',
   [source],ai,[],{plan,catalog,trace:true});
  return {payload,result,ai};
 };
 const offered=await runWithSpan('S1-Q1');
 const spans=offered.payload.parts[0].evidence[0].spans;
 assert.deepEqual(offered.payload.parts[0].evidence[0].selectionSupport,
  [{relation:'context',excerpt:'A cue from the earlier selector.'}],
  'review receives only this part’s selector clue, clearly separated from exact review spans');
 assert.equal(spans.length,8,'the reviewer packet has a fixed per-source cap');
 assert.ok(offered.result.trace.reviewContract.valid);
 assert.equal(offered.ai.calls.length,2);
 const omitted=await runWithSpan('S1-Q9');
 assert.ok(omitted.result.trace.reviewContract.supportIssues.some(issue=>
  issue.partId==='P1'&&issue.reason==='missing-claim-source-span'));
 assert.equal(omitted.result.coverage,'none',
  'a valid full-source span cannot be selected when it was not sent to this part review');
 assert.equal(omitted.ai.calls.length,3,'a missing evidence packet cannot trigger repair (the third call is the batch 24 rescue, which has no valid span to flip)');
});

test('review deadline failure gets one in-place retry and stays fail-closed after both attempts',async()=>{
 const timeout=()=>Object.assign(new Error('Inference deadline exceeded'),{
  stage:'review',code:'inference-deadline-exceeded',startedAt:Date.now()-45000
 });
 const ai=makeAI([answer('PART P1\nHume links causal expectation to custom and regular conjunction. [S1]'),timeout(),timeout()]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true
 });
 assert.equal(ai.calls.length,3,'composition runs once; only the review call is retried');
 assert.deepEqual(result.trace.reviewRetry,{attempted:true,mode:'review-only',
  reason:'inference-deadline-exceeded',applied:false,outcome:'failed-again',
  parts:[{partId:'P1',reason:'inference-deadline-exceeded',applied:false,
   mode:'review-only',samePacket:true,outcome:'failed-again',retryFailureCode:'inference-deadline-exceeded'}]});
 assert.equal(result.outcome,'generation-failed');
 assert.equal(result.coverage,'none');
 assert.equal(result.trace.answerRetry,undefined,'review timeout does not trigger a whole-build retry');
 assert.equal(result.trace.final.reviewFailure.stage,'review');
 assert.equal(result.trace.final.reviewFailure.code,'inference-deadline-exceeded');
 assert.ok(result.trace.final.reviewFailure.elapsedMs>=45000);
 const failedStage=result.trace.stages.find(stage=>stage.stage==='review'&&stage.status==='failed');
 assert.equal(failedStage.failureCode,'inference-deadline-exceeded');
 assert.equal(failedStage.timeoutMs,60000);
 assert.ok(failedStage.elapsedMs>=0);
 assert.ok(failedStage.payloadMetrics.claimCount>0);
 assert.ok(failedStage.payloadMetrics.spanCount>0);
 assert.ok(failedStage.payloadMetrics.serializedCharacters>0);
 assert.ok(failedStage.payloadMetrics.systemPromptCharacters>0);
 assert.equal(failedStage.payloadMetrics.requestCharacters,
  failedStage.payloadMetrics.serializedCharacters+failedStage.payloadMetrics.systemPromptCharacters);
 assert.equal('messages' in failedStage,false,'failed traces record payload sizes, not a duplicate raw payload');
});

test('an evidence limitation stays visible but cannot complete the requested hypothetical inference',async()=>{
 const limitation='The supplied passages do not warrant a reliable inference about how Nietzsche would respond to Kierkegaard. [S1, S2]';
 const reviewer=(_model,{messages})=>{
  const result=JSON.parse(hypotheticalReview()(_model,{messages}).response);
  const p3=result.parts.find(part=>part.partId==='P3');
  if(p3)p3.status='partial';
  return {response:JSON.stringify(result)};
 };
 const ai=makeAI([hypotheticalDraft(limitation),reviewer,reviewer,reviewer]);
 const result=await composeEvidenceAnswer(hypotheticalQuestion,hypotheticalSources,ai,[],{
  plan:hypotheticalPlan,catalog:hypotheticalCatalog,trace:true
 });
 assert.equal(ai.calls.length,4);
 assert.equal(result.coverage,'partial');
 assert.equal(result.questionParts[2].status,'partial');
 assert.match(result.answer,/do not warrant a reliable inference/);
 assert.deepEqual(result.trace.coverageGaps,[{partId:'P3',reason:'hypothetical-inference-missing'}]);
});

test('the run-58 comparison limitation remains partial while a positive inference needs both voices',async()=>{
 const limitation='Because Nietzsche characterizes faith as a psychological misunderstanding or a tool of priestly mastery [S1] and Kierkegaard describes faith as a transcendent, absurd movement of the self toward God [S2], the passages support a comparison but not a reliable inference about Nietzsche’s specific response to Kierkegaard’s thought.';
 const reviewer=(_model,{messages})=>{
  const result=JSON.parse(hypotheticalReview()(_model,{messages}).response);
  const p3=result.parts.find(part=>part.partId==='P3');
  if(p3)p3.status='partial';
  return {response:JSON.stringify(result)};
 };
 const ai=makeAI([hypotheticalDraft(limitation),reviewer,reviewer,reviewer]);
 const result=await composeEvidenceAnswer(hypotheticalQuestion,hypotheticalSources,ai,[],{
  plan:hypotheticalPlan,catalog:hypotheticalCatalog,trace:true
 });
 assert.equal(ai.calls.length,4);
 assert.equal(result.coverage,'partial');
 assert.equal(result.questionParts[2].status,'partial');
 assert.match(result.answer,/support a comparison but not a reliable inference/);
 assert.deepEqual(result.trace.coverageGaps,[{partId:'P3',reason:'hypothetical-inference-missing'}]);
});

test('quoted-speaker conflicts are preserved as a source-attribution rejection',async()=>{
 const source={id:'S1',bookId:'80',title:'Buddha’s Teachings',page:44,
  text:'The cycle of births and deaths is like the turning seasons. (Y. Chambers, Buddha’s Teachings, vv. 729–730)',
  preview:'The cycle of births and deaths is like the turning seasons.'};
 const question='What did Buddha say about death?';
 const plan={...onePartPlan,intent:'explain',
  sources:[{label:'Buddha',role:'primary',bookIds:['80']}],
  parts:[{id:'P1',question,sourceBookIds:['80'],candidateSourceIds:['S1']}]};
 const ai=makeAI([answer('PART P1\nThe Buddha taught that birth and death recur in cycles. [S1]'),
  (_model,{messages})=>{
   const payload=parsePayload(messages),claim=payload.claims[0];
   const spanId=claim.sourceEvidence.find(item=>item.sourceId==='S1').spanIds[0];
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
    directAnswerClaimIds:[claim.claimId]}],claims:[{claimId:claim.claimId,status:'answered',
    sources:[{sourceId:'S1',status:'answered',spanIds:[spanId],
     attributionStatus:'conflict',attributedSpeaker:'Y. Chambers'}]}]})};
  }]);
 const result=await composeEvidenceAnswer(question,[source],ai,[],{
  plan,catalog:{80:'Buddha’s Teachings'},trace:true
 });
 assert.equal(ai.calls.length,3,'source-attribution conflicts are not repaired without an explicit repairability decision (the third call is the batch 24 rescue, which keeps the conflict demotion)');
 assert.equal(result.coverage,'none','the misattributed claim cannot survive review');
 assert.ok(result.trace.reviewContract.supportIssues.some(issue=>
  issue.sourceId==='S1'&&issue.reason==='source-attribution-conflict'));
 assert.equal(result.trace.reviewContract.reviewDecisions[0].attributedSpeaker,'Y. Chambers');
});

test('named-person action attribution rejects transfer, omission, and accepts the matching subject',async()=>{
 const question='What happened to the round table?';
 const run=async({claim,sourceText,subjectFields})=>{
  const source={...hume,id:'S1',bookId:'80',title:'Heart of Darkness — Joseph Conrad',
   text:sourceText,preview:sourceText};
  const plan={...onePartPlan,sources:[{label:'Joseph Conrad',role:'primary',bookIds:['80']}],
   parts:[{...onePartPlan.parts[0],question,sourceBookIds:['80'],candidateSourceIds:['S1']}]};
  const ai=makeAI([answer(`PART P1\n${claim} [S1]`),(_model,{messages})=>{
   const payload=parsePayload(messages),current=payload.claims[0];
   const spanId=current.sourceEvidence[0].spanIds[0];
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',answerStatus:'answered',
    directAnswerClaimIds:[current.claimId]}],claims:[{claimId:current.claimId,status:'answered',sources:[{
     sourceId:'S1',status:'answered',spanIds:[spanId],...subjectFields
    }]}]})};
  }],{decorateReview:false,decorateClauses:false,decorateSubject:false});
  return composeEvidenceAnswer(question,[source],ai,[],{
   catalog:{80:source.title},plan,trace:true
  });
 };
 const transferred=await run({claim:'Kurtz ordered the immense round table into the station.',
  sourceText:'Marlow ordered the men to carry the immense round table into the station.',
  subjectFields:{subjectAttributionStatus:'conflict',attributedSubject:'Marlow'}});
 const transferredDecision=transferred.trace.reviewContract.reviewDecisions[0];
 assert.equal(transferredDecision.accepted,false);
 assert.equal(transferredDecision.subjectAttributionStatus,'conflict');
 assert.equal(transferredDecision.attributedSubject,'Marlow');
 assert.ok(transferred.trace.reviewContract.supportIssues.some(issue=>
  issue.reason==='source-subject-attribution-conflict'));
 assert.equal(transferred.coverage,'none');

 const omitted=await run({claim:'Kurtz’s unalterable conviction shaped his command.',
  sourceText:'Marlow’s conviction shaped his command.',subjectFields:{}});
 const omittedDecision=omitted.trace.reviewContract.reviewDecisions[0];
 assert.equal(omittedDecision.accepted,false);
 assert.equal(omittedDecision.subjectAttributionStatus,'missing');
 assert.equal(omittedDecision.attributedSubject,'');
 assert.ok(omitted.trace.reviewContract.supportIssues.some(issue=>
  issue.reason==='source-subject-attribution-missing'));

 const matched=await run({claim:'Kurtz ordered the immense round table into the station.',
  sourceText:'Kurtz ordered the immense round table into the station.',
  subjectFields:{subjectAttributionStatus:'supported',attributedSubject:'Kurtz'}});
 const matchedDecision=matched.trace.reviewContract.reviewDecisions[0];
 assert.equal(matchedDecision.accepted,true);
 assert.equal(matchedDecision.subjectAttributionStatus,'supported');
 assert.equal(matched.coverage,'full');
});

test('a positive reviewer speaker label must be anchored in the supplied source',async()=>{
 const source={id:'S1',bookId:'81',title:'The Brothers Karamazov — Fyodor Dostoevsky',page:311,
  text:'Ivan wonders whether the suffering of innocent children can be justified. The problem remains unresolved.',
  preview:'Ivan wonders whether the suffering of innocent children can be justified.'};
 const question='What does Alyosha say about Ivan’s view?';
 const plan={...onePartPlan,intent:'explain',
  sources:[{label:'Fyodor Dostoevsky',role:'primary',bookIds:['81']}],
  parts:[{id:'P1',question,sourceBookIds:['81'],candidateSourceIds:['S1']}]};
 const ai=makeAI([answer('PART P1\nAlyosha says Ivan asks whether the suffering of innocent children can be justified. [S1]'),
  (_model,{messages})=>{
   const payload=parsePayload(messages),claim=payload.claims[0];
   const spanId=claim.sourceEvidence.find(item=>item.sourceId==='S1').spanIds[0];
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
    directAnswerClaimIds:[claim.claimId]}],claims:[{claimId:claim.claimId,status:'answered',
    sources:[{sourceId:'S1',status:'answered',spanIds:[spanId],
     attributionStatus:'supported',attributedSpeaker:'Alyosha'}]}]})};
  }]);
 const result=await composeEvidenceAnswer(question,[source],ai,[],{
  plan,catalog:{81:source.title},trace:true
 });
 assert.equal(ai.calls.length,2,'unanchored source attribution is not repaired without an explicit repairability decision');
 assert.equal(result.coverage,'none','an unanchored positive reviewer label cannot verify the claim');
 assert.ok(result.trace.reviewContract.supportIssues.some(issue=>
  issue.sourceId==='S1'&&issue.reason==='source-attribution-unanchored'));
});

test('known editorial and pseudonymous source voices must be named or mediated',async()=>{
 const run=async({source,title,bookId,question,draft,catalog,sourceLabel})=>{
  let composePayload,reviewPayload;
  const plan={...onePartPlan,sources:[{label:sourceLabel,role:'primary',bookIds:[bookId]}],
   parts:[{...onePartPlan.parts[0],question,sourceBookIds:[bookId],candidateSourceIds:['S1']}]};
  const ai=makeAI([(_model,{messages})=>{
   composePayload=parsePayload(messages);
   return answer('PART P1\n'+draft+' [S1]');
  },(_model,{messages})=>{
   reviewPayload=parsePayload(messages);
   const claim=reviewPayload.claims[0],evidence=claim.sourceEvidence[0];
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered'}],claims:[{
    claimId:claim.claimId,status:'answered',sources:[{sourceId:'S1',status:'answered',spanIds:[evidence.spanIds[0]]}]
   }]})};
  }]);
  const result=await composeEvidenceAnswer(question,[source],ai,[],{
   plan,catalog:{...catalog,[bookId]:title},trace:true
  });
  return {result,composePayload,reviewPayload};
 };
 const introTitle='Last Writings: Nothingness and the Religious Worldview — Kitarō Nishida';
 const introSource={...hume,id:'S1',bookId:'185',title:introTitle,page:18,
  text:'David A. Dilworth introduces Nishida’s discussion of religious nothingness.',
  preview:'David A. Dilworth introduces Nishida’s discussion of religious nothingness.'};
 const editorial=await run({source:introSource,title:introTitle,bookId:'185',
  question:'What is sunyata?',sourceLabel:'Kitarō Nishida',
  draft:'Sunyata is the central concept in this discussion'});
 assert.equal(editorial.result.coverage,'none');
 assert.ok(editorial.result.trace.reviewContract.supportIssues.some(issue=>
  issue.reason==='editorial-source-attribution-unqualified'));
 assert.match(editorial.composePayload.evidence[0].attributionRequirement,/David A\. Dilworth/);
 assert.match(editorial.reviewPayload.parts[0].evidence[0].attributionRequirement,/David A\. Dilworth/);
 const mediated=await run({source:introSource,title:introTitle,bookId:'185',
  question:'What is sunyata?',sourceLabel:'Kitarō Nishida',
  draft:'Dilworth’s introduction describes sunyata as the central concept in this discussion'});
 assert.equal(mediated.result.coverage,'full');

 const pseudonymTitle='Fear and Trembling — Søren Kierkegaard';
 const pseudonymSource={...hume,id:'S1',bookId:'140',title:pseudonymTitle,page:32,
  text:'Johannes de Silentio describes faith as a relation to God.',
  preview:'Johannes de Silentio describes faith as a relation to God.'};
 const unnamed=await run({source:pseudonymSource,title:pseudonymTitle,bookId:'140',
  question:'What does Fear and Trembling say about faith?',sourceLabel:'Søren Kierkegaard',
  draft:'Kierkegaard describes faith as a relation to God'});
 assert.equal(unnamed.result.coverage,'none');
 assert.ok(unnamed.result.trace.reviewContract.supportIssues.some(issue=>
  issue.reason==='pseudonymous-voice-unidentified'));
 assert.match(unnamed.composePayload.evidence[0].attributionRequirement,/Johannes de Silentio/);
 const named=await run({source:pseudonymSource,title:pseudonymTitle,bookId:'140',
  question:'What does Fear and Trembling say about faith?',sourceLabel:'Søren Kierkegaard',
  draft:'Johannes de Silentio describes faith as a relation to God'});
 assert.equal(named.result.coverage,'full');
});

test('prior speaker attribution carries across accepted claims without crossing to another pseudonymous voice',async()=>{
 const silentioTitle='Fear and Trembling — Søren Kierkegaard';
 const climacusTitle='Philosophical Fragments — Søren Kierkegaard';
 const sources=[
  {...hume,id:'S1',bookId:'140',title:silentioTitle,page:32,
   text:'Johannes de Silentio describes faith as a relation to God.',
   preview:'Johannes de Silentio describes faith as a relation to God.'},
  {...hume,id:'S2',bookId:'192',title:climacusTitle,page:24,
   text:'Johannes Climacus discusses a philosophical lesson about faith.',
   preview:'Johannes Climacus discusses a philosophical lesson about faith.'}
 ];
 const question='What does Kierkegaard say about faith?';
 const plan={...onePartPlan,
  sources:[{label:'Søren Kierkegaard',role:'primary',bookIds:['140','192']}],
  parts:[{...onePartPlan.parts[0],question,sourceBookIds:['140','192'],
   candidateSourceIds:['S1','S2']}]};
 const draft=[
  'Johannes de Silentio describes faith as a relation to God. [S1]',
  'He presents faith as an inward relation. [S1]',
  'He distinguishes faith from ordinary belief. [S1]',
  'He emphasizes the paradox of faith. [S1]',
  'He frames faith as requiring an absolute relation to God. [S1]',
  'Kierkegaard describes faith as a philosophical lesson. [S2]'
 ].join(' ');
 const ai=makeAI([answer('PART P1\n'+draft),(_model,{messages})=>{
  const payload=parsePayload(messages);
  const unqualifiedSecondVoice=payload.claims.some(claim=>claim.sourceIds.includes('S2')&&
   !/Johannes Climacus/.test(claim.text));
  return {response:JSON.stringify({parts:[{partId:'P1',status:unqualifiedSecondVoice?'partial':'answered'}],
   claims:payload.claims.map(claim=>({claimId:claim.claimId,status:'answered',
    sources:claim.sourceIds.map(sourceId=>({sourceId,status:'answered',
     spanIds:[claim.sourceEvidence.find(item=>item.sourceId===sourceId).spanIds[0]]}))}))})};
 }]);
 const result=await composeEvidenceAnswer(question,sources,ai,[],{
  plan,catalog:{...catalog,140:silentioTitle,192:climacusTitle},trace:true
 });
 assert.equal(ai.calls.length,2);
 assert.equal(result.coverage,'partial');
 assert.match(result.answer,/Johannes de Silentio describes faith/);
 assert.match(result.answer,/He frames faith as requiring an absolute relation to God/);
 assert.doesNotMatch(result.answer,/Kierkegaard describes faith as a philosophical lesson/);
 assert.ok(result.trace.reviewContract.supportIssues.some(issue=>
  issue.sourceId==='S2'&&issue.reason==='pseudonymous-voice-unidentified'));
});

test('flat reviewer input keeps per-part claims linked once and duplicate claims keys fail closed',async()=>{
 let reviewPayload;
 const draft=hypotheticalDraft(
  'From these passages, one cautious inference is that Nietzsche might have viewed Kierkegaard’s emphasis on religious inwardness as part of the Christian outlook he rejects. [S1, S2]');
 const duplicateKeyReviewer=(_model,{messages})=>{
  reviewPayload=parsePayload(messages);
  const partId=reviewPayload.parts[0].partId;
  assert.deepEqual(reviewPayload.parts.map(part=>part.partId),[partId],
   'each part review payload carries only its own part');
  assert.ok(reviewPayload.parts.every(part=>!('claims' in part)));
  assert.deepEqual(reviewPayload.claims.map(claim=>[claim.partId,claim.claimId]),
   [[partId,partId+'-C1']]);
  assert.equal(reviewPayload.parts[0].evidence[0].id,partId==='P2'?'S2':'S1');
  const decision={claimId:partId+'-C1',status:'answered',
   spanIds:reviewPayload.claims[0].sourceIds.map(sourceId=>sourceId+'-Q1')};
  // Duplicate top-level "claims" keys: JSON parsing keeps only the last
  // (empty) array, so the part's claim decision goes missing and the part
  // review must fail closed.
  return {response:'{"parts":[{"partId":"'+partId+'","status":"answered"}]'+
   ',"claims":['+JSON.stringify(decision)+'],"claims":[]}'};
 };
 const ai=makeAI([draft,duplicateKeyReviewer,duplicateKeyReviewer,duplicateKeyReviewer]);
 const result=await composeEvidenceAnswer(hypotheticalQuestion,hypotheticalSources,ai,[],{
  plan:hypotheticalPlan,catalog:hypotheticalCatalog,trace:true
 });
 assert.equal(ai.calls.length,4);
 assert.equal(result.outcome,'generation-failed');
 assert.equal(result.coverage,'none');
 assert.equal(result.reviewStatus,'review-contract-incomplete');
 assert.deepEqual(result.trace.reviewContract.issues,['missing-claim-decision']);
 assert.ok(result.trace.reviewContract.supportIssues.some(issue=>
  issue.partId==='P1'&&issue.claimId==='P1-C1'&&issue.reason==='missing-claim-decision'));
 assert.ok(result.trace.reviewContract.supportIssues.some(issue=>
  issue.partId==='P2'&&issue.claimId==='P2-C1'&&issue.reason==='missing-claim-decision'));
 assert.equal(result.evidenceMap.some(item=>item.partId==='P1'||item.partId==='P2'),false);
});

test('a reviewed comparison cannot satisfy a hypothetical synthesis part without an inference',async()=>{
 const ai=makeAI([hypotheticalDraft(
  'Nietzsche criticizes Christian morality, whereas Johannes de Silentio centers faith. [S1, S2]'),
  hypotheticalReview(),hypotheticalReview(),hypotheticalReview()
 ]);
 const result=await composeEvidenceAnswer(hypotheticalQuestion,hypotheticalSources,ai,[],{
  plan:hypotheticalPlan,catalog:hypotheticalCatalog,trace:true
 });
 assert.equal(ai.calls.length,4);
 assert.equal(result.outcome,'verified-source-draft');
 assert.equal(result.questionParts[0].status,'supported');
 assert.equal(result.questionParts[1].status,'supported');
 assert.equal(result.questionParts[2].status,'partial');
 assert.equal(result.coverage,'partial');
 assert.match(result.answer,/Nietzsche criticizes Christian morality, whereas Johannes de Silentio centers faith/);
 assert.deepEqual(result.trace.coverageGaps,[{partId:'P3',reason:'hypothetical-inference-missing'}]);
 assert.equal(result.trace.reviewContract.valid,true);
});

test('a one-sided hypothetical inference is rejected and the part remains visibly incomplete',async()=>{
 const ai=makeAI([hypotheticalDraft(
  'From these passages, one cautious inference is that Nietzsche might have viewed Kierkegaard’s emphasis on religious inwardness as part of the Christian outlook he rejects. [S1]'),
  hypotheticalReview(),hypotheticalReview(),hypotheticalReview()
 ]);
 const result=await composeEvidenceAnswer(hypotheticalQuestion,hypotheticalSources,ai,[],{
  plan:hypotheticalPlan,catalog:hypotheticalCatalog,trace:true
 });
 assert.equal(ai.calls.length,4);
 assert.equal(result.coverage,'partial');
 assert.equal(result.questionParts[2].status,'unsupported');
 assert.ok(result.trace.rejected.some(item=>item.partId==='P3'&&
  item.reason==='hypothetical-inference-missing-source-group-citation'));
 assert.doesNotMatch(result.answer,/one cautious inference/i);
 assert.match(result.missing,/what response can cautiously be inferred/i);
});

test('a neighboring comparison clause cannot lend its citation group to a hypothetical inference',async()=>{
 const ai=makeAI([hypotheticalDraft(
  'From these passages, one cautious inference is that Nietzsche might have viewed Kierkegaard’s emphasis on religious inwardness as part of the Christian outlook he rejects. [S1], whereas Kierkegaard’s own position is expressed by Johannes de Silentio. [S2]'),
  hypotheticalReview(),hypotheticalReview(),hypotheticalReview()
 ]);
 const result=await composeEvidenceAnswer(hypotheticalQuestion,hypotheticalSources,ai,[],{
  plan:hypotheticalPlan,catalog:hypotheticalCatalog,trace:true
 });
 assert.equal(result.coverage,'partial');
 assert.ok(result.trace.rejected.some(item=>item.partId==='P3'&&
  item.reason==='hypothetical-inference-missing-source-group-citation'));
 assert.doesNotMatch(result.answer,/one cautious inference/i);
 assert.equal(ai.calls.length,4);
});

test('an unqualified hypothetical author claim is rejected even when both source groups are cited',async()=>{
 const ai=makeAI([hypotheticalDraft(
  'Nietzsche would have regarded Kierkegaard’s emphasis on religious inwardness as a form of the decadent outlook he attacks. [S1, S2]'),
  hypotheticalReview(),hypotheticalReview(),hypotheticalReview()
 ]);
 const result=await composeEvidenceAnswer(hypotheticalQuestion,hypotheticalSources,ai,[],{
  plan:hypotheticalPlan,catalog:hypotheticalCatalog,trace:true
 });
 assert.equal(ai.calls.length,4);
 assert.equal(result.coverage,'partial');
 assert.ok(result.trace.rejected.some(item=>item.partId==='P3'&&
  item.reason==='hypothetical-inference-not-explicitly-qualified'));
 assert.doesNotMatch(result.answer,/Nietzsche would have regarded/);
});

test('author-wide questions retain the author works unless the reader names a distinctive work',()=>{
 const question='What did Kierkegaard have to say about faith?';
 const catalog={
  '140':'Fear and Trembling — Søren Kierkegaard',
  '192':'Philosophical Fragments — Søren Kierkegaard',
  '253':'The Sickness Unto Death — Søren Kierkegaard',
  '436':'Kierkegaard’s Attack Upon “Christendom,” 1854–1855 — Søren Kierkegaard'
 };
 const raw={intent:'explain',sources:[{label:'Søren Kierkegaard',role:'primary',bookIds:Object.keys(catalog)}],
  parts:["How does Kierkegaard describe faith?"],queries:['Kierkegaard faith movement']};
 const broad=normalizePlan(raw,question,catalog);
 assert.equal(broad.parts.length,1,'a broad author-topic question must not acquire optional model-generated coverage requirements');
 assert.equal(broad.parts[0].question,question);
 assert.deepEqual(broad.parts[0].sourceBookIds,['140','192','253','436']);
 const explicitFacets=normalizePlan({...raw,parts:['What does Kierkegaard say about faith?','How does he relate faith to the individual?']},
  'What did Kierkegaard say about faith, and how does he relate it to the individual?',catalog);
 assert.equal(explicitFacets.parts.length,2,'explicitly requested facets remain separate coverage parts');
 const scoped=normalizePlan(raw,'What did Kierkegaard say about faith in Fear and Trembling?',catalog);
 assert.deepEqual(scoped.parts[0].sourceBookIds,['140']);
});

test('three-author comparison keeps source coverage and synthesis while dropping a repeated wrapper',()=>{
 const question='How do Augustine, Aquinas, and Kant differ in their understanding of moral responsibility?';
 const catalog={
  '101':'Confessions — Augustine of Hippo',
  '102':'Summa Theologica — Thomas Aquinas',
  '103':'Critique of Practical Reason — Immanuel Kant'
 };
 const plan=normalizePlan({intent:'compare',sources:[
  {label:'Augustine of Hippo',role:'primary',bookIds:['101']},
  {label:'Thomas Aquinas',role:'primary',bookIds:['102']},
  {label:'Immanuel Kant',role:'primary',bookIds:['103']}
 ],parts:[
  'What does Augustine say about moral responsibility?',
  'What does Aquinas say about moral responsibility?',
  'What does Kant say about moral responsibility?',
  'How do the three views differ?',
  'How do the named sources compare in response to this question: '+question
 ],queries:[
  'Augustine Confessions moral responsibility',
  'Aquinas Summa moral responsibility',
  'Kant practical reason moral responsibility'
 ]},question,catalog);

 assert.equal(plan.parts.length,4,'each author remains independently reviewable, alongside one synthesis part');
 assert.deepEqual(plan.parts.map(part=>part.sourceBookIds),[
  ['101'],['102'],['103'],['101','102','103']
 ]);
 assert.ok(plan.parts[3].question.includes('differ'),
  'the comparison remains an explicit answer obligation');
 assert.ok(!plan.parts.some(part=>part.question.startsWith('How do the named sources compare in response')),
  'the generic wrapper does not duplicate the substantive comparison part');
 assert.deepEqual(plan.queries,[
  'Augustine Confessions moral responsibility',
  'Aquinas Summa moral responsibility',
  'Kant practical reason moral responsibility'
 ]);
});

test('multi-part plans link a focused global planner query to its matching answer part',()=>{
 const question='How does Elizabeth’s view of Darcy change, and what role do her first impressions play?';
 const catalog={'341':'Pride and Prejudice — Jane Austen'};
 const firstImpressionsQuery='influence of first impressions on Elizabeth Bennet’s judgment of Darcy';
 const plan=normalizePlan({intent:'explain',sources:[
  {label:'Jane Austen',role:'primary',bookIds:['341']}
 ],parts:[
  {question:'How does Elizabeth Bennet’s view of Darcy change?',
   searchQueries:['Elizabeth Bennet’s changing opinion of Darcy in Pride and Prejudice']},
  {question:'What role do Elizabeth’s first impressions of Darcy play in her changing view?',
   searchQueries:['Elizabeth Bennet’s changing opinion of Darcy in Pride and Prejudice']}
 ],queries:[
  'Elizabeth Bennet’s changing opinion of Darcy in Pride and Prejudice',
  firstImpressionsQuery,
  'Darcy’s character development through Elizabeth’s eyes'
 ]},question,catalog);

 const firstImpressionsPart=plan.parts.find(part=>/first impressions/i.test(part.question));
 assert.ok(firstImpressionsPart.searchQueries.includes(firstImpressionsQuery),
  'the strongest concept-level planner query must reach the matching part and its selector');
 assert.ok(firstImpressionsPart.searchQueries.length<=5,
  'global-query linkage remains inside the existing bounded part-facet contract');
 assert.equal(plan.parts.length,2,'linking a query does not create a new answer obligation');
});

test('comparison plus a separately requested outcome keeps the distinct part',()=>{
 const question='How do Augustine and Aquinas differ about responsibility, and what consequences does each view have?';
 const catalog={'101':'Confessions — Augustine of Hippo','102':'Summa Theologica — Thomas Aquinas'};
 const plan=normalizePlan({intent:'compare',sources:[
  {label:'Augustine of Hippo',role:'primary',bookIds:['101']},
  {label:'Thomas Aquinas',role:'primary',bookIds:['102']}
 ],parts:[
  'How do the two accounts of responsibility differ?',
  'What consequences does each view have?'
 ],queries:['Augustine responsibility','Aquinas responsibility']},question,catalog);

 assert.equal(plan.parts.length,2,'the separate consequence request remains independently reviewable');
 assert.deepEqual(plan.parts.map(part=>part.question),[
  'How do the two accounts of responsibility differ?',
  'What consequences does each view have?'
 ]);
});

test('simple definition questions stay one coverage part while explicit facets remain separate',()=>{
 const raw={intent:'explain',sources:[],queries:['definition of Sunyata and its operation',
  'how Sunyata functions in Buddhist doctrine'],parts:[
  'What is the definition and essential nature of sunyata?',
  'How does sunyata function or operate within Buddhist doctrine?']};
 const simple=normalizePlan(raw,'What is sunyata?',{});
 assert.equal(simple.parts.length,1);
 assert.equal(simple.parts[0].question,'What is sunyata?');
 const explicit=normalizePlan({...raw,parts:['What is sunyata?',
  'How does sunyata function within Buddhist doctrine?']},
  'What is sunyata and how does it function within Buddhist doctrine?',{});
 assert.equal(explicit.parts.length,2);
});

test('a quoted technical term is not mistaken for a source quotation, while multiword quotes stay exact',()=>{
 assert.equal(auditFinalAnswer('The account turns on “whatness.” [S1]',[hume]).ok,true);
 assert.equal(auditFinalAnswer('The source says “custom and habit.” [S1]',[hume]).ok,false);
 assert.equal(auditFinalAnswer('The source says “mind is determined by custom.” [S1]',[hume]).ok,true);
 const repaired=removeUnsupportedQuoteMarks('The source says “custom and habit.” [S1]',[hume]);
 assert.equal(repaired.text,'The source says custom and habit. [S1]');
 assert.equal(repaired.repairs[0].action,'removed-nonexact-quotation-marks');
});

test('a quote binds to the first following citation, not a later comparison citation',()=>{
 const nietzsche={id:'S4',text:'Nietzsche attacks the cause of this fictitious morality and religion.'};
 const kantSource={id:'S2',text:'Kant discusses appearances and things in themselves.'};
 const humeSource={id:'S3',text:'Hume describes custom and habit.'};
 const answer='A cautious reader might infer that Nietzsche rejects the “fictitious morality” [S4], whereas Kierkegaard takes a different view. [S2, S3]';
 assert.equal(auditFinalAnswer(answer,[nietzsche,kantSource,humeSource]).ok,true);
 assert.equal(auditFinalAnswer('The passage describes “double life” and painful self-consciousness. [S4]',[
  {...nietzsche,text:'The passage describes "double life" and painful self-consciousness.'}
 ]).ok,true,'a quote earlier in a sentence binds to its citation after the sentence-ending punctuation');
});

test('final audit of joined answer parts fails exactly when an individual part fails',()=>{
 const validOne='Hume connects necessity with custom and repeated experience. [S1]';
 const validTwo='The account distinguishes habit from demonstrative reasoning. [S1]';
 const invalidQuote='The account says “a claim absent from the source.” [S1]';
 for(const parts of [[validOne,validTwo],[invalidQuote,validTwo],
  [validOne,'A claim with an unknown source ID [S99].']]){
  const joined=auditFinalAnswer(parts.join('\n\n'),[hume]);
  const individual=parts.map(part=>auditFinalAnswer(part,[hume]));
  assert.equal(joined.ok,individual.every(result=>result.ok));
 }
});

test('part linking preserves evidence discovered by each side for a synthesis part',()=>{
 const plan={...twoSidePlan,parts:twoSidePlan.parts.map(part=>({...part,candidateSourceIds:[]}))};
 const linked=linkEvidenceToParts(plan,[{...hume,candidatePartIds:['P1']},{...kant,candidatePartIds:['P2']}]);
 assert.deepEqual(linked.parts.map(part=>part.candidateSourceIds),[['S1'],['S2'],['S1','S2']]);
});

test('a named Hamlet part admits the primary collected text and excludes unrelated commentary',()=>{
 const question='In Hamlet’s “To be, or not to be” soliloquy, what does he mean by conscience?';
 const catalog={212:'The Complete Works of William Shakespeare — William Shakespeare'};
 const plan=normalizePlan({intent:'interpret',sources:[
  {label:'William Shakespeare',role:'primary',bookIds:['212']}
 ],parts:['What does Hamlet mean by conscience in this soliloquy?']},question,catalog);
 const linked=linkEvidenceToParts(plan,[
  {id:'S1',bookId:'212',candidatePartIds:['P1']},
  {id:'S2',bookId:'230',candidatePartIds:['P1']},
 ]);
 assert.deepEqual(linked.parts[0].sourceBookIds,['212']);
 assert.deepEqual(linked.parts[0].candidateSourceIds,['S1'],
  'an editor or commentator may remain available elsewhere, but cannot replace the named play as this part’s evidence');
});

test('comparison evidence linking follows the planned source groups even when the part avoids comparison keywords',()=>{
 const plan={...twoSidePlan,parts:[
  {...twoSidePlan.parts[0],candidateSourceIds:[]},
  {...twoSidePlan.parts[1],candidateSourceIds:[]},
  {id:'P3',question:'What relationship do their accounts bear to one another?',sourceBookIds:['35','40']}
 ]};
 const linked=linkEvidenceToParts(plan,[{...hume,candidatePartIds:['P1']},{...kant,candidatePartIds:['P2']}]);
 assert.deepEqual(linked.parts[2].candidateSourceIds,['S1','S2']);
});

test('run 49 claim-specific source pointers expose each passage and retain the per-source review gate',async()=>{
 const source4={...hume,id:'S4',bookId:'239',title:'The Portable Nietzsche — Friedrich Nietzsche',page:502,
  text:'No to both the lowest and highest desires of life.',preview:'No to both the lowest and highest desires of life.'};
 const source5={...hume,id:'S5',bookId:'239',title:'The Portable Nietzsche — Friedrich Nietzsche',page:607,
  text:'Christian morality is a systematic degradation of the imagination.',
  preview:'Christian morality is a systematic degradation of the imagination.'};
 const sources=[source4,source5];
 const plan={...onePartPlan,sources:[{label:'Friedrich Nietzsche',role:'primary',bookIds:['239']}],
  parts:[{...onePartPlan.parts[0],question:'What did Nietzsche say about Christianity?',sourceBookIds:['239'],
   candidateSourceIds:['S4','S5']}]};
 const draft='PART P1\nThis moral system is described as a systematic degradation of imagination and a rejection of the highest and lowest desires of life. [S4, S5]';
 let reviewPayload;
 const missingSourceAI=makeAI([answer(draft),(_model,{messages})=>{
  reviewPayload=parsePayload(messages);
  const claim=reviewPayload.claims[0];
  const s5=claim.sourceEvidence.find(item=>item.sourceId==='S5').spanIds[0];
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered'}],
   claims:[{claimId:claim.claimId,status:'answered',spanIds:[s5]}]})};
 }]);
 const partial=await composeEvidenceAnswer('What did Nietzsche say about Christianity?',sources,missingSourceAI,[],
  {plan,catalog:{...catalog,239:'The Portable Nietzsche — Friedrich Nietzsche'},trace:true});
 const claim=reviewPayload.claims[0];
 assert.deepEqual(claim.sourceIds,['S4','S5']);
 assert.deepEqual(claim.sourceEvidence.map(item=>item.sourceId),['S4','S5']);
 for(const item of claim.sourceEvidence){
  const page=reviewPayload.parts[0].evidence.find(source=>source.id===item.sourceId);
  assert.ok(item.spanIds.length>0);
  assert.ok(item.spanIds.every(id=>page.spans.some(span=>span.spanId===id)));
 }
 assert.equal(partial.coverage,'none');
 assert.ok(partial.trace.reviewContract.supportIssues.some(issue=>
  issue.claimId==='P1-C1'&&issue.reason==='missing-claim-source-span'));
 assert.equal(missingSourceAI.calls.length,2,'a missing citation decision is not repaired without a repairability signal');

 const supportedAI=makeAI([answer(draft),(_model,{messages})=>{
  const payload=parsePayload(messages),claim=payload.claims[0];
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered'}],
   claims:[{claimId:claim.claimId,status:'answered',spanIds:claim.sourceEvidence.flatMap(item=>item.spanIds.slice(0,1))}]})};
 }]);
 const supported=await composeEvidenceAnswer('What did Nietzsche say about Christianity?',sources,supportedAI,[],
  {plan,catalog:{...catalog,239:'The Portable Nietzsche — Friedrich Nietzsche'},trace:true});
 assert.equal(supported.coverage,'full');
 assert.deepEqual([...new Set(supported.evidenceMap.map(item=>item.id))],['S4','S5']);
 assert.equal(supportedAI.calls.length,2);
});

test('validates cited sources against each part and preserves a complete cited answer in two calls',async()=>{
 const ai=makeAI([
  answer('PART P1\nHume says necessity arises from regular conjunction and the mind’s habitual inference. [S1]'),
  review([['P1','answered']])
 ]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],
  {plan:onePartPlan,catalog,trace:true});
 assert.equal(ai.calls.length,2);
 assert.equal(result.outcome,'verified-source-draft');
 assert.equal(result.coverage,'full');
 assert.equal(result.questionParts[0].status,'supported');
 assert.match(result.answer,/habitual inference\. \[S1\]/);
 assert.deepEqual(result.citations.map(source=>source.id),['S1']);
 assert.equal(result.evidenceMap[0].quoteVerified,true);
 assert.equal(result.evidenceMap[0].quote,hume.text);
 assert.equal(result.trace.stages.length,2);
 const composePayload=JSON.parse(ai.calls[0].request.messages[1].content);
 const reviewPayload=parsePayload(ai.calls[1].request.messages);
 assert.deepEqual(composePayload.parts[0].candidateSourceIds,['S1']);
 assert.equal('candidateSourceIds' in reviewPayload.parts[0],false);
 assert.deepEqual(Object.keys(reviewPayload.claims[0]).sort(),['claimId','partId','sourceEvidence','sourceIds','text']);
 assert.deepEqual(reviewPayload.parts[0].evidence.map(source=>source.id),['S1']);
});

test('unknown-only and cross-linked citation IDs fail closed without losing the part trace',async()=>{
 const ai=makeAI([
  answer('PART P1\nHume links necessity to custom. [S99]\n\nPART P2\nKant describes causality as a priori. [S1]'),
  review([['P1','answered'],['P2','answered']])
 ]);
 const result=await composeEvidenceAnswer('How do Hume and Kant explain necessity?',
  [{...hume,candidatePartIds:['P1']},{...kant,candidatePartIds:['P2']}],ai,[],
  {plan:{...twoSidePlan,intent:'explain',parts:twoSidePlan.parts.slice(0,2)},catalog,trace:true});
 assert.equal(result.outcome,'generation-failed');
 assert.equal(result.coverage,'none');
 assert.equal(result.failureCode,'answer-citation-validation-failed');
 assert.match(result.trace.rejected.map(item=>item.reason).join(' '),/unknown|citation/);
 assert.deepEqual(result.trace.final.failure.validationReasons,
  ['source-not-linked-to-question-part','unknown-source-id']);
 assert.equal('validationReasons' in result,false,'validation diagnostics stay inside the authenticated trace');
});

test('verified passage locator citations are normalized to their page source IDs',async()=>{
 const span=buildReviewSpans('S1',hume.text)[0];
 const ai=makeAI([answer('PART P1\nHume [cannot] directly observe causal necessity; he links causal expectation to custom after repeated conjunction. ['+span.spanId+']'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],
  {plan:onePartPlan,catalog,trace:true});
 assert.equal(result.coverage,'full');
 assert.equal(result.failureCode,undefined);
 assert.match(result.answer,/\[S1\]/);
 assert.match(result.answer,/\[cannot\]/,'ordinary bracketed prose must not be rewritten as a citation');
 assert.doesNotMatch(result.answer,/S1-Q/);
 assert.deepEqual(result.trace.citationRepairs,[{partId:'P1',claimId:'P1-C1',sentenceIndex:1,
  normalizedSpanIds:[span.spanId],retainedSourceIds:['S1']}]);
});

test('Boethius page-number collision drops only the unknown ID and reviews the exact source citation',async()=>{
 const title='The Consolation of Philosophy — Boethius';
 const cause={id:'S5',bookId:'21',title,page:12,candidatePartIds:['P1'],
  text:'The world itself is subject to change, for nothing which is born remains constant.',
  preview:'Nothing which is born remains constant.'};
 const example={id:'S1',bookId:'21',title,page:7,candidatePartIds:['P1'],
  text:'The speaker describes an earlier injustice and the pain it caused.',
  preview:'The speaker describes an earlier injustice.'};
 const plan={version:'reader-evidence-v2',intent:'explain',
  sources:[{label:'Boethius',role:'primary',bookIds:['21']}],
  parts:[{id:'P1',question:'Why is Fortune not constant?',sourceBookIds:['21'],
   candidateSourceIds:['S5','S1']}]};
 const ai=makeAI([
  answer('PART P1\nFortune changes because nothing born remains constant, so her instability follows the law of change. [S5, S12] The speaker also recalls an earlier injustice. [S1]'),
  review([['P1','answered']])
 ]);
 const result=await composeEvidenceAnswer('Why is Fortune not constant?',[cause,example],ai,[],
  {plan,catalog:{...catalog,21:title},trace:true});
 assert.equal(ai.calls.length,2,'the correction uses the existing compose and review calls');
 assert.equal(result.coverage,'full');
 assert.match(result.answer,/law of change\. \[S5\]/);
 assert.doesNotMatch(result.answer,/S12/);
 assert.deepEqual(result.trace.citationRepairs,[{partId:'P1',claimId:'P1-C1',sentenceIndex:1,
  removedSourceIds:['S12'],retainedSourceIds:['S5']}]);
 const reviewed=parsePayload(ai.calls[1].request.messages);
 assert.deepEqual(reviewed.claims[0].sourceIds,['S5']);
 assert.equal(reviewed.parts[0].requiredAnswerClaimId,'P1-C1');
});

test('unknown-only required answer citation stays rejected and cannot be replaced by a surviving example',async()=>{
 const title='The Consolation of Philosophy — Boethius';
 const source={id:'S1',bookId:'21',title,page:7,candidatePartIds:['P1'],
  text:'The speaker describes an earlier injustice and the pain it caused.',
  preview:'The speaker describes an earlier injustice.'};
 const plan={version:'reader-evidence-v2',intent:'explain',
  sources:[{label:'Boethius',role:'primary',bookIds:['21']}],
  parts:[{id:'P1',question:'Why is Fortune not constant?',sourceBookIds:['21'],candidateSourceIds:['S1']}]};
 const ai=makeAI([
  answer('PART P1\nFortune changes because nothing born remains constant. [S12] The speaker also recalls an earlier injustice. [S1]'),
  review([['P1','answered']],{directAnswerClaimIdsByPart:{P1:[]}})
 ]);
 const result=await composeEvidenceAnswer('Why is Fortune not constant?',[source],ai,[],
  {plan,catalog:{...catalog,21:title},trace:true});
 assert.equal(result.outcome,'verified-source-draft');
 assert.equal(result.coverage,'partial');
 assert.equal(result.questionParts[0].status,'partial');
 assert.match(result.answer,/earlier injustice\. \[S1\]/);
 assert.doesNotMatch(result.answer,/nothing born remains constant/);
 assert.deepEqual(result.trace.rejected,[{partId:'P1',reason:'unknown-source-id',sentenceIndex:1}]);
 assert.ok(result.trace.reviewContract.supportIssues.some(issue=>
  issue.partId==='P1'&&issue.reason==='direct-answer-claim-missing'));
 assert.deepEqual(result.trace.citationRepairs,[]);
});

test('author initials stay attached to the cited direct answer without merging later sentences',async()=>{
 let reviewPayload;
 const ai=makeAI([answer('PART P1\nW.E.B. Du Bois defines double consciousness as viewing oneself through other people’s eyes. [S3] '+
  'He describes the condition as a divided identity with conflicting strivings. [S3]'),
  (_model,{messages})=>{
   reviewPayload=parsePayload(messages);
   return review([['P1','answered']])(_model,{messages});
  }]);
 const result=await composeEvidenceAnswer(duBoisInitialismQuestion,[duBoisInitialismSource],ai,[],{
  plan:duBoisInitialismPlan,catalog:{454:duBoisInitialismSource.title},trace:true
 });
 assert.equal(result.coverage,'full');
 assert.equal(result.questionParts[0].status,'supported');
 assert.match(result.answer,/^W\.E\.B\. Du Bois defines double consciousness/);
 assert.deepEqual(result.trace.rejected,[]);
 assert.deepEqual(result.trace.coverageGaps,[]);
 assert.equal(reviewPayload.parts[0].requiredAnswerClaimId,'P1-C1',
  'the complete initialism-bearing first sentence remains the required answer');
 assert.deepEqual([...new Set(result.evidenceMap.map(item=>item.claimId))],['P1-C1','P1-C2'],
  'the following cited sentence stays a separate claim');
});

test('parenthetical source IDs normalize into the verified citation path and unknown IDs still fail closed',async()=>{
 const ai=makeAI([answer('PART P1\nHume links causal necessity to repeated conjunction and the mind’s learned expectation (s1).'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],
  {plan:onePartPlan,catalog,trace:true});
 assert.equal(result.outcome,'verified-source-draft');
 assert.equal(result.coverage,'full');
 assert.match(result.answer,/learned expectation \[S1\]/);
 assert.deepEqual(result.citations.map(source=>source.id),['S1']);
 assert.equal(result.evidenceMap[0].quoteVerified,true);
 assert.deepEqual(result.trace.citationFormatRepairs,[{partId:'P1',from:'(s1)',to:'[S1]'}]);
 assert.equal(ai.calls.length,2,'normalization uses the existing compose and review calls');

 const invalidAI=makeAI([answer('PART P1\nHume links causal necessity to repeated conjunction (S99).'),
  review([['P1','answered']])]);
 const invalid=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],invalidAI,[],
  {plan:onePartPlan,catalog,trace:true});
 assert.equal(invalid.outcome,'generation-failed');
 assert.deepEqual(invalid.trace.rejected,[{partId:'P1',reason:'unknown-source-id'}]);
 assert.doesNotMatch(invalid.answer,/\(S99\)|\[S99\]/);
 assert.deepEqual(invalid.citations,[]);
});

test('abbreviations stay inside cited sentences when source filtering rejects their citation',async()=>{
 const title='Pride and Prejudice — Jane Austen';
 const source={id:'S3',bookId:'901',title,page:128,candidatePartIds:[],
  text:'The "general prejudice against Mr. Darcy" is so strong that attempting to view him in an "amiable light" is a difficult task.',
  preview:'The general prejudice against Mr. Darcy makes it difficult to view him in an amiable light.'};
 const plan={...onePartPlan,sources:[{label:'Jane Austen',role:'primary',bookIds:['900']}],
  parts:[{...onePartPlan.parts[0],question:'How does Elizabeth’s view of Darcy change?',
   sourceBookIds:['900'],candidateSourceIds:[]}]};
 const ai=makeAI([answer('PART P1\nThe "general prejudice against Mr. Darcy" is so strong that attempting to view him in an "amiable light" is a difficult task [S3]. Her journey then changes her view.'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('How does Elizabeth’s view of Darcy change?',
  [source],ai,[],{plan,catalog:{900:title},trace:true});
 assert.equal(ai.calls.length,2);
 assert.deepEqual(result.trace.rejected,[{partId:'P1',reason:'source-not-linked-to-question-part',sentenceIndex:1}],
  'the whole abbreviation-bearing sentence is rejected as one unit');
 assert.doesNotMatch(result.answer,/general prejudice against Mr\.?\s*Her journey/,
  'rejecting an unlinked citation must not leave the abbreviation fragment in the final answer');
 assert.doesNotMatch(result.answer,/general prejudice against Mr\./);
});

test('complete Markdown-wrapped numeric part headings are normalized safely',async()=>{
 const ai=makeAI([answer('### PART 1\nHume explains causal necessity through custom formed by repeated conjunction. [S1]'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],
  {plan:onePartPlan,catalog,trace:true});
 assert.equal(ai.calls.length,2);
 assert.equal(result.coverage,'full');
 assert.match(result.answer,/custom formed by repeated conjunction/);
 assert.deepEqual(result.trace.formatRecoveries[0].headings,[{raw:'### PART 1',normalized:'### PART P1'}]);
});

test('Markdown numeric headings with a skipped part number remain malformed',async()=>{
 // Batch 6 (B6-4): an invalid heading sequence earns one compose retry;
 // when the retry is malformed the same way, the original failure stands.
 const malformed=answer('### PART 2\nThis cannot be safely assigned to P1. [S1]');
 const ai=makeAI([malformed,malformed]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],
  {plan:onePartPlan,catalog,trace:true});
 assert.equal(ai.calls.length,2,'the initial compose and its one retry');
 assert.deepEqual(result.trace.composeRetry,
  {attempted:true,reason:'model-output-invalid-format',applied:false});
 assert.equal(result.outcome,'generation-failed');
 assert.equal(result.failureCode,'model-output-invalid-format');
 assert.deepEqual(result.trace.formatRecoveries,[{stage:'compose',code:'invalid-numeric-part-heading-sequence',
  recovered:false,headings:['### PART 2']}]);
});

test('an invalid citation on an initialism-bearing direct answer still leaves the part partial',async()=>{
 const ai=makeAI([answer('PART P1\nW.E.B. Du Bois defines double consciousness as viewing oneself through other people’s eyes. [S99] '+
  'He describes the condition as a divided identity with conflicting strivings. [S3]'),
  review([['P1','answered']],{directAnswerClaimIdsByPart:{P1:[]}})]);
 const result=await composeEvidenceAnswer(duBoisInitialismQuestion,[duBoisInitialismSource],ai,[],{
  plan:duBoisInitialismPlan,catalog:{454:duBoisInitialismSource.title},trace:true
 });
 assert.equal(result.coverage,'partial');
 assert.equal(result.questionParts[0].status,'partial');
 assert.doesNotMatch(result.answer,/W\.E\.B\. Du Bois defines/);
 assert.match(result.answer,/divided identity with conflicting strivings\. \[S3\]/);
 assert.deepEqual(result.trace.rejected,[{partId:'P1',reason:'unknown-source-id',sentenceIndex:1}]);
 assert.ok(result.trace.reviewContract.supportIssues.some(issue=>
  issue.partId==='P1'&&issue.reason==='direct-answer-claim-missing'));
});

test('a citation linked to another question part is rejected even when its source ID exists',async()=>{
 const plan={...twoSidePlan,intent:'explain',parts:twoSidePlan.parts.slice(0,2)};
 const ai=makeAI([answer('PART P1\nKant says causality is a category. [S2]\nPART P2\nKant says causality is a category. [S2]'),
  review([['P1','answered'],['P2','answered']]),review([['P1','answered'],['P2','answered']])]);
 const result=await composeEvidenceAnswer('How do Hume and Kant explain necessity?',
  [{...hume,candidatePartIds:['P1']},{...kant,candidatePartIds:['P2']}],ai,[],{plan,catalog});
 assert.equal(result.questionParts[0].status,'unsupported');
 assert.equal(result.questionParts[1].status,'supported');
 assert.deepEqual(result.citations.map(source=>source.id),['S2']);
});

test('the composer receives only pages linked to at least one planned part while traces retain every candidate',async()=>{
 const hamlet={...hamletMeaningSource,candidatePartIds:['P1']};
 const tillich={...hamletMeaningSource,id:'S2',bookId:'230',title:'The Courage to Be — Paul Tillich',page:16,
  text:'Tillich discusses courage and anxiety.',candidatePartIds:[]};
 const huckFinn={...hamletMeaningSource,id:'S3',bookId:'321',title:'Adventures of Huckleberry Finn — Mark Twain',page:42,
  text:'Huck Finn describes a journey on the river.',candidatePartIds:[]};
 const sources=[hamlet,tillich,huckFinn];
 const plan={...hamletMeaningPlan,parts:[{...hamletMeaningPlan.parts[0],sourceBookIds:['212']}]};
 let composePayload;
 const ai=makeAI([(_model,{messages})=>{
  composePayload=parsePayload(messages);
  return answer('PART P1\nHamlet’s conscience weakens resolution and action. [S1]');
 },review([['P1','answered']])]);
 const result=await composeEvidenceAnswer(hamletMeaningQuestion,sources,ai,[],
  {plan,catalog:{212:hamletMeaningSource.title},trace:true});
 assert.deepEqual(composePayload.parts[0].candidateSourceIds,['S1']);
 assert.deepEqual(composePayload.evidence.map(source=>source.id),['S1']);
 assert.deepEqual(result.trace.evidence.map(source=>source.id),['S1','S2','S3'],
  'the authenticated trace keeps the complete retrieved candidate set for diagnosis');
 assert.equal(result.coverage,'full');
 assert.equal(ai.calls.length,2,'evidence filtering adds no model call');
});

test('comparison claims keep citations attached to the smallest supporting source set',async()=>{
 const humeP24={...hume,id:'S5',page:24,
  text:'Inferences from experience arise from custom, not reasoning.',preview:'Experience guides inference through custom.'};
 const kantP103={...kant,id:'S3',page:103,
  text:'Causality is a condition of objective cognition of appearances in temporal succession.',
  preview:'Causality is a condition of objective cognition.'};
 const humeP39={...hume,id:'S1',page:39,
  text:'Custom is the great guide of human life.',preview:'Custom guides human life.'};
 const kantP104={...kant,id:'S4',page:104,
  text:'The principle of causality is a condition of possible experience.',
  preview:'Causality is a condition of possible experience.'};
 const sources=[
  {...humeP39,candidatePartIds:['P1','P3']},
  {...kantP103,candidatePartIds:['P2','P3']},
  {...humeP24,candidatePartIds:['P1','P3']},
  {...kantP104,candidatePartIds:['P2','P3']}
 ];
 const ai=makeAI([answer('PART P1\nHume says causal inference comes from custom rather than reasoning. [S5]\n'+
  'PART P2\nKant treats causality as a condition of possible experience. [S4]\n'+
  'PART P3\nHume grounds inference in custom, while Kant makes causality a condition of objective experience. [S5, S3]'),
  review([['P1','answered'],['P2','answered'],['P3','answered']]),
  review([['P1','answered'],['P2','answered'],['P3','answered']]),
  review([['P1','answered'],['P2','answered'],['P3','answered']])]);
 const result=await composeEvidenceAnswer('How do Hume and Kant explain causal necessity?',sources,ai,[],
  {plan:twoSidePlan,catalog,trace:true});
 assert.equal(result.coverage,'full');
 assert.deepEqual([...new Set(result.evidenceMap.map(source=>source.id))].sort(),['S3','S4','S5']);
 assert.ok(result.answer.includes('[S5]'));
 assert.ok(result.answer.includes('[S4]'));
 assert.ok(result.answer.includes('[S5, S3]'));
 assert.ok(!result.answer.includes('[S1]'));
 assert.equal(ai.calls.length,4,'claim-specific citation guidance adds no model call beyond the per-part reviews');
});

test('a non-exact quotation is converted to a paraphrase and reviewed with neighboring claims',async()=>{
 const dubois1={id:'S5',bookId:'454',title:'The Souls of Black Folk — W. E. B. Du Bois',page:141,
  url:'https://example.test/dubois#page=141',
  text:'It is a peculiar sensation, this double-consciousness, this sense of always looking at one’s self through the eyes of others. One ever feels his two-ness,—an American, a Negro; two souls, two thoughts, two unreconciled strivings; two warring ideals in one dark body, whose dogged strength alone keeps it from being torn asunder. The history of the American Negro is the history of this strife,—this longing to attain self-conscious manhood, to merge his double self into a better and truer self. In this merging he wishes neither of the older selves to be lost. He would not Africanize America, for America has too much to teach the world and Africa. He would not bleach his Negro soul in a flood of white Americanism, for he knows that Negro blood has a message for the world. He simply wishes to make it possible for a man to be both a Negro and an American. The problem of the twentieth century is the problem of the color-line. It is a peculiar sensation, this double life, this sense of always looking at one’s self through the eyes of others.',
  preview:'The passage describes a double life and painful self-consciousness.'};
 const dubois2={id:'S3',bookId:'454',title:dubois1.title,page:131,url:'https://example.test/dubois#page=131',
  text:'The Negro is a sort of seventh son, born with a veil, and gifted with second-sight in this American world,—a world which yields him no true self-consciousness, but only lets him see himself through the revelation of the other world. It is a peculiar sensation, this double-consciousness, this sense of always looking at one’s self through the eyes of others. The history of the American Negro is the history of this strife.',
  preview:'Du Bois describes double-consciousness.'};
 const source={...dubois1,text:'The painful self-consciousness of the "double life" appears throughout this passage. '+dubois1.text};
 const plan={version:'reader-evidence-v2',intent:'explain',
  sources:[{label:'W. E. B. Du Bois',role:'primary',bookIds:['454']}],
  parts:[{id:'P1',question:'How does Du Bois describe the double life and its effects?',sourceBookIds:['454'],
   searchQueries:['Du Bois double life consciousness'],candidateSourceIds:['S5','S3']}],
  queries:['Du Bois double life consciousness']};
 const ai=makeAI([
  answer('PART P1\nDu Bois describes a “double life” and painful self-consciousness. [S5] This existence within “double consciousness” forces Black Americans to view themselves through others’ eyes. [S5] He frames double-consciousness as an ongoing historical strife. [S3]'),
  (_model,{messages})=>{
   const payload=parsePayload(messages),part=payload.parts[0];
   const claims=payload.claims.filter(claim=>claim.partId===part.partId).map(claim=>({claimId:claim.claimId,status:'answered',
    spanIds:claim.sourceIds.map(sourceId=>part.evidence.find(item=>item.id===sourceId).spans[0].spanId)}));
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered'}],claims})};
  }
 ]);
 const result=await composeEvidenceAnswer('How does Du Bois describe the double life and its effects?',
  [source,dubois2],ai,[],{plan,catalog:{454:'The Souls of Black Folk — W. E. B. Du Bois'},trace:true});
 assert.equal(ai.calls.length,2);
 assert.equal(result.outcome,'verified-source-draft');
 assert.equal(result.questionParts[0].status,'supported');
 assert.match(result.answer,/“double life” and painful self-consciousness\. \[S5\]/);
 assert.match(result.answer,/ongoing historical strife\. \[S3\]/);
 assert.match(result.answer,/within double consciousness forces Black Americans/);
 assert.doesNotMatch(result.answer,/“double consciousness”/);
 assert.equal(result.trace.rejected.length,0);
 assert.deepEqual(result.trace.quoteRepairs,[{partId:'P1',claimId:'P1-C2',sentenceIndex:2,
  quote:'double consciousness',sourceIds:['S5'],action:'removed-nonexact-quotation-marks',canonicalTextUpdated:true}]);
 assert.deepEqual(result.citations.map(item=>item.id),['S5','S3']);
});

test('missing question parts remain visible as partial coverage instead of invalidating the answer',async()=>{
 const ai=makeAI([
  answer('PART P1\nHume says causal necessity arises from custom and regular conjunction. [S1]'),
  review([['P1','answered'],['P2','answered'],['P3','partial']]),
  review([['P1','answered'],['P2','answered'],['P3','partial']]),
  review([['P1','answered'],['P2','answered'],['P3','partial']])
 ]);
 const result=await composeEvidenceAnswer('How do Hume and Kant differ over causal necessity?',
  [{...hume,candidatePartIds:['P1','P3']},{...kant,candidatePartIds:['P2','P3']}],ai,[],
  {plan:twoSidePlan,catalog});
 assert.equal(result.outcome,'verified-source-draft');
 assert.equal(result.coverage,'partial');
 assert.deepEqual(result.questionParts.map(part=>part.status),['supported','unsupported','unsupported']);
 assert.equal(ai.calls.length,4);
 assert.match(result.missing,/Kant|differ/i);
});

test('a reviewer partial decision stays incomplete without becoming a review contract failure',async()=>{
 const ai=makeAI([answer('PART P1\nKant lists causality among the categories of relation. [S2]'),
  review([['P1','partial']])]);
 const result=await composeEvidenceAnswer('How does Kant justify causal necessity?',
  [kant],ai,[],{plan:{...onePartPlan,intent:'explain',sources:[{label:'Immanuel Kant',role:'primary',bookIds:['40']}],
   parts:[{id:'P1',question:'How does Kant justify causal necessity?',sourceBookIds:['40'],searchQueries:['Kant causality'],candidateSourceIds:['S2']}]},catalog});
 assert.equal(result.coverage,'none');
 assert.equal(result.reviewStatus,'claim-review');
 assert.equal(result.outcome,'insufficient-evidence');
 assert.equal(result.questionParts[0].status,'unsupported');
});

test('an unclear reviewer claim is normalized to partial and remains fail-closed',async()=>{
 const ai=makeAI([answer('PART P1\nHume explains causal necessity through custom. [S1]'),
  (_model,{messages})=>{
   const payload=parsePayload(messages);
   return {response:JSON.stringify({parts:[{partId:'P1',status:'partial',answerStatus:'partial',
    directAnswerClaimIds:[payload.claims[0].claimId],retainedContextClaimIds:[]}],
    claims:payload.claims.map(claim=>({claimId:claim.claimId,status:'unclear',sources:
     claim.sourceIds.map(sourceId=>({sourceId,status:'unclear',spanIds:[]}))}))})};
  }]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true
 });
 assert.equal(ai.calls.length,3,'an unclear claim decision remains fail-closed without an explicit repairability decision (the third call is the batch 24 rescue)');
 assert.deepEqual(result.trace.reviewContract.issues,[],
  'a valid uncertainty label must not invalidate the review contract');
 assert.equal(result.trace.reviewContract.reviewDecisions[0].claimStatus,'partial');
 assert.equal(result.coverage,'none','uncertainty must not be upgraded into source support');
 assert.equal(result.outcome,'insufficient-evidence');
});

test('a reviewer cannot mark an answer supported without selecting a span from its cited page',async()=>{
 const ai=makeAI([answer('PART P1\nKant lists causality among the categories of relation. [S2]'),
  review([['P1','answered']],{includeEvidence:false})]);
 const result=await composeEvidenceAnswer('How does Kant justify causal necessity?',
  [kant],ai,[],{plan:{...onePartPlan,intent:'explain',
   sources:[{label:'Immanuel Kant',role:'primary',bookIds:['40']}],
   parts:[{id:'P1',question:'How does Kant justify causal necessity?',sourceBookIds:['40'],
    searchQueries:['Kant causality'],candidateSourceIds:['S2']}]},catalog,trace:true});
 assert.equal(result.coverage,'none');
 assert.equal(result.questionParts[0].status,'unsupported');
 assert.deepEqual(result.trace.reviewContract.supportIssues,[
  {partId:'P1',claimId:'P1-C1',sourceId:'S2',reason:'missing-claim-source-span'}]);
 assert.deepEqual(result.trace.reviewContract.reviewDecisions,[{
  partId:'P1',claimId:'P1-C1',sourceId:'S2',claimText:'Kant lists causality among the categories of relation.',
  claimStatus:'answered',sourceStatus:'partial',attributionStatus:'missing',attributedSpeaker:'',
  subjectAttributionStatus:'supported',attributedSubject:'Kant',
  candidateSpanIds:['S2-Q1'],reviewerSpanIds:[],acceptedSpanIds:[],acceptedQuote:'',acceptedQuotes:[],accepted:false,
  recoveredMissingDecision:false,
  validationReason:'missing-claim-source-span'
 }]);
 assert.equal(result.evidenceMap.length,0);
});

test('invented and cross-source span IDs cannot enter the reviewed evidence map',async()=>{
 const plan={...onePartPlan,parts:[{...onePartPlan.parts[0],candidateSourceIds:['S1']}]};
 const ai=makeAI([answer('PART P1\nHume grounds necessity in custom and regularity. [S1]'),
  (_model,{messages})=>{
   const payload=parsePayload(messages),claim=payload.claims[0];
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered'}],claims:[{claimId:claim.claimId,
    status:'answered',spanIds:['S2-Q1','S1-Q999','S99-Q1']}]})};
  }]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],
  {plan,catalog,trace:true});
 assert.equal(result.questionParts[0].status,'unsupported');
 assert.deepEqual(result.trace.reviewContract.supportIssues,[
  {partId:'P1',claimId:'P1-C1',sourceId:'S1',reason:'missing-claim-source-span'}]);
 assert.equal(result.evidenceMap.length,0);
 assert.equal(ai.calls.length,3,'invented span IDs do not trigger an unmarked repair (the third call is the batch 24 rescue, which has no valid span to flip)');
});

test('the active reviewer resolves a selected span to exact bounded source text',async()=>{
 const longText='A verified passage explains the form and matter relation in detail: '+
  'the soul is the first actuality of a natural body that has life potentially, and this relation is clarified by the comparison between the shape of wax and the wax itself. '.repeat(3);
 const source={...hume,text:longText,preview:longText};
 const spans=buildReviewSpans('S1',longText);
 const ai=makeAI([answer('PART P1\nAristotle treats soul as the actuality of a living body. [S1]'),
  review([['P1','answered']],{evidenceByPart:{P1:[{sourceId:'S1',spanIds:[spans[0].spanId]}]}})]);
 const result=await composeEvidenceAnswer('How does Aristotle relate soul and body?',[source],ai,[],
  {plan:onePartPlan,catalog,trace:true});
 assert.equal(result.coverage,'full');
 assert.ok(result.evidenceMap[0].quote.length<=320);
 assert.equal(result.evidenceMap[0].quote,spans[0].text);
 assert.ok(longText.includes(result.evidenceMap[0].quote));
 assert.equal(result.trace.reviewContract.supportIssues.length,0);
 assert.deepEqual(result.trace.reviewContract.reviewDecisions,[{
  partId:'P1',claimId:'P1-C1',sourceId:'S1',claimText:'Aristotle treats soul as the actuality of a living body.',
  claimStatus:'answered',sourceStatus:'answered',attributionStatus:'missing',attributedSpeaker:'',
  subjectAttributionStatus:'supported',attributedSubject:'Aristotle',
  candidateSpanIds:result.trace.reviewContract.reviewDecisions[0].candidateSpanIds,
  reviewerSpanIds:[spans[0].spanId],acceptedSpanIds:[spans[0].spanId],
  acceptedQuote:spans[0].text.slice(0,280),acceptedQuotes:[spans[0].text.slice(0,280)],
  accepted:true,recoveredMissingDecision:false,validationReason:null
 }]);
});

test('review sees one spare candidate while verified acceptance stays capped at three',async()=>{
 const text=[
  'A short introductory passage describes a topic without defining the requested doctrine.',
  'A second passage discusses historical context and the surrounding debate in detail.',
  'A third passage mentions related concepts but does not explain their central relation.',
  'The fourth passage directly explains the doctrine through its core operation and distinction.'
 ].join('\n\n\n');
 const source={...hume,text,preview:text};
 const spans=buildReviewSpans('S1',text);
 assert.equal(spans.length,4);
 let reviewPayload;
 const ai=makeAI([answer('PART P1\nThe doctrine works through its core operation and distinction. [S1]'),
  (_model,{messages})=>{
   reviewPayload=parsePayload(messages);
   const claim=reviewPayload.claims[0];
   const offered=claim.sourceEvidence.find(item=>item.sourceId==='S1').spanIds;
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered'}],claims:[{
    claimId:claim.claimId,status:'answered',sources:[{sourceId:'S1',status:'answered',spanIds:offered}]}]})};
  }]);
 const result=await composeEvidenceAnswer('How does the doctrine work?',[source],ai,[],
  {plan:onePartPlan,catalog,trace:true});
 const decision=result.trace.reviewContract.reviewDecisions[0];
 assert.equal(reviewPayload.claims[0].sourceEvidence[0].spanIds.length,4,
  'the reviewer receives the fourth-ranked candidate that the run 65 case omitted');
 assert.equal(decision.candidateSpanIds.length,4);
 assert.equal(decision.acceptedSpanIds.length,3,
  'the spare candidate does not raise the existing three-span acceptance limit');
 assert.equal(result.evidenceMap.length,3);
 assert.equal(ai.calls.length,2,'the wider candidate list adds no model call');
});

test('large claim reviews send one ranked span hint per citation while keeping the full bounded span packet',async()=>{
 const sourceText=['Custom guides human life.','Habit shapes inference.',
  'Repeated experience forms expectations.','One event follows another regularly.',
  'The mind learns from repeated conjunctions.','Custom directs ordinary expectations.',
  'Experience produces familiar associations.','Inference follows established habits.',
  'Repeated cases shape anticipation.'].join('\n\n');
 const source={...hume,id:'S1',text:sourceText,preview:sourceText};
 const answerText='PART P1\n'+Array.from({length:9},(_,index)=>
  ['Custom guides human life.','Habit shapes inference.','Repeated experience forms expectations.',
   'One event follows another regularly.','The mind learns from repeated conjunctions.',
   'Custom directs ordinary expectations.','Experience produces familiar associations.',
   'Inference follows established habits.','Repeated cases shape anticipation.'][index]+' [S1]')
  .join('\n\n');
 let reviewPayload,reviewSystem='';
 const ai=makeAI([answer(answerText),(_model,{messages})=>{
  reviewSystem=messages[0].content;
  reviewPayload=parsePayload(messages);
  const spanId=reviewPayload.parts[0].evidence[0].spans[0].spanId;
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
   directAnswerClaimIds:['P1-C1']}],claims:reviewPayload.claims.map(claim=>({
    claimId:claim.claimId,status:'answered',sources:[{sourceId:'S1',status:'answered',
     spanIds:[spanId]}]}))})};
 }]);
 await composeEvidenceAnswer('What guides human life?', [source],ai,[],{
  plan:onePartPlan,catalog,trace:true
 });
 assert.equal(reviewPayload.claims.length,9);
 assert.ok(reviewPayload.claims.every(claim=>claim.sourceEvidence[0].spanIds.length===1));
 assert.ok(reviewPayload.parts[0].evidence[0].spans.length>1,
  'the reviewer still receives the full bounded set of exact source spans');
 assert.match(reviewSystem,/One source cannot supply another source’s missing support/);
 assert.equal(ai.calls.length,2,'adaptive review packing adds no model call');
});

test('the reviewer can retain several exact spans from one source for one fully supported claim',async()=>{
 const source={...hume,
  text:'Repeated conjunctions are observed between similar events.\n\n\nThe mind is determined by custom to infer one event from another.\n\n\nThe idea of necessary connection arises from this transition of thought.',
  preview:'Repeated conjunctions are observed between similar events.\n\n\nThe mind is determined by custom to infer one event from another.\n\n\nThe idea of necessary connection arises from this transition of thought.'};
 const spans=buildReviewSpans('S1',source.text);
 assert.equal(spans.length,3);
 const ai=makeAI([answer('PART P1\nHume links repeated conjunctions, custom, and the mind’s inference to our idea of necessary connection. [S1]'),
  (_model,{messages})=>{
   const payload=parsePayload(messages),claim=payload.claims[0];
   const offered=claim.sourceEvidence.find(item=>item.sourceId==='S1').spanIds;
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered'}],claims:[{
    claimId:claim.claimId,status:'answered',sources:[{sourceId:'S1',status:'answered',spanIds:offered}]}]})};
  }]);
 const result=await composeEvidenceAnswer('How does Hume explain the idea of necessary connection?',[source],ai,[],
  {plan:onePartPlan,catalog,trace:true});
 assert.equal(result.coverage,'full');
 assert.equal(result.evidenceMap.length,3);
 assert.deepEqual(result.evidenceMap.map(item=>item.quote).sort(),spans.map(item=>item.text).sort());
 const decision=result.trace.reviewContract.reviewDecisions[0];
 assert.deepEqual(decision.acceptedSpanIds.sort(),spans.map(item=>item.spanId).sort());
 assert.deepEqual(decision.acceptedQuotes.sort(),spans.map(item=>item.text.slice(0,280)).sort());
 assert.equal(ai.calls.length,2,'multi-span handoff uses the existing compose and review calls');
});

test('the active reviewer returns OCR text verbatim from the selected source span',async()=>{
 const source={...hume,text:'James writes that faith is jusƟﬁed by works, and this is not an empty formula.',
  preview:'James writes that faith is jusƟﬁed by works, and this is not an empty formula.'};
 const ai=makeAI([answer('PART P1\nJames relates faith to works. [S1]'),
  review([['P1','answered']],{evidenceByPart:{P1:[{sourceId:'S1',spanIds:['S1-Q1']}]}})]);
 const result=await composeEvidenceAnswer('How does James relate faith and works?',[source],ai,[],
  {plan:onePartPlan,catalog,trace:true});
 assert.equal(result.coverage,'full');
 assert.match(result.evidenceMap[0].quote,/jusƟﬁed/);
 assert.equal(result.trace.reviewContract.supportIssues.length,0);
});

test('an answered claim must quote every source cited by that sentence',async()=>{
 const ai=makeAI([answer('PART P1\nHume and Kant give different accounts of causal necessity. [S1, S2]'),
  review([['P1','answered']],{evidenceByPart:{P1:[{sourceId:'S1',spanIds:['S1-Q1']}]}})]);
 const result=await composeEvidenceAnswer('How do Hume and Kant differ over causal necessity?',
  [{...hume,candidatePartIds:['P1']},{...kant,candidatePartIds:['P1']}],ai,[],
  {plan:{...onePartPlan,intent:'compare',sources:[
   {label:'David Hume',role:'primary',bookIds:['35']},
   {label:'Immanuel Kant',role:'primary',bookIds:['40']}],
   parts:[{id:'P1',question:'How do Hume and Kant differ over causal necessity?',
    sourceBookIds:['35','40'],searchQueries:['Hume and Kant causal necessity'],candidateSourceIds:['S1','S2']}]},catalog,trace:true});
 assert.equal(result.coverage,'none');
 assert.ok(result.trace.reviewContract.supportIssues.some(issue=>
  issue.reason==='missing-claim-source-span'));
});

test('the reviewer receives an explicit source checklist and missing synthesis evidence stays partial',async()=>{
 const sources=[
  {...hume,id:'S1',candidatePartIds:['P1','P3']},
  {...hume,id:'S2',page:34,text:'External objects reveal no idea of power or necessary connection in particular instances.',
   preview:'External objects reveal no idea of power.',candidatePartIds:['P1','P3']},
  {...kant,id:'S3',page:24,text:'A priori principles of connection require universality and necessity.',
   preview:'A priori principles require universality and necessity.',candidatePartIds:['P2','P3']},
  {...kant,id:'S6',page:54,text:'Causality belongs among the primitive categories of the pure understanding.',
   preview:'Causality is a category of the pure understanding.',candidatePartIds:['P2','P3']}
 ];
 const plan={...twoSidePlan,parts:[
  {...twoSidePlan.parts[0],candidateSourceIds:['S1','S2']},
  {...twoSidePlan.parts[1],candidateSourceIds:['S3','S6']},
  {...twoSidePlan.parts[2],candidateSourceIds:['S1','S2','S3','S6']}
 ]};
 const checklistReviewer=(_model,{messages})=>{
  const payload=parsePayload(messages);
  const supported={P1:['S1','S2'],P2:['S3','S6'],P3:['S1','S3','S6']};
  return {response:JSON.stringify({parts:payload.parts.map(part=>({partId:part.partId,status:'answered'})),
   claims:payload.claims.map(claim=>({claimId:claim.claimId,status:'answered',
    spanIds:claim.sourceIds.filter(id=>supported[claim.partId].includes(id)).map(sourceId=>sourceId+'-Q1')}))} )};
 };
 const ai=makeAI([
  answer('PART P1\nHume grounds necessity in custom and regular conjunction. [S1] External objects do not reveal power directly. [S2]\n'+
   'PART P2\nKant treats causal connection as a priori and necessary. [S3, S6]\n'+
   'PART P3\nHume explains necessity through custom, while Kant grounds causal connection in a priori categories. [S1, S2, S3, S6]'),
  checklistReviewer,checklistReviewer,checklistReviewer
 ]);
 const result=await composeEvidenceAnswer('How do Hume and Kant differ over causal necessity?',sources,ai,[],
  {plan,catalog,trace:true});
 const reviewPayload=parsePayload(result.trace.stages
  .find(stage=>stage.stage==='review'&&stage.partId==='P3').messages);
 const synthesisClaims=reviewPayload.claims.filter(claim=>claim.partId==='P3');
 assert.deepEqual([...new Set(synthesisClaims.flatMap(item=>item.sourceIds))],['S1','S2','S3','S6']);
 assert.equal(result.questionParts[2].status,'unsupported');
 assert.ok(result.trace.reviewContract.supportIssues.some(issue=>
  issue.partId==='P3'&&issue.reason==='missing-claim-source-span'));
 assert.equal(result.evidenceMap.some(item=>item.partId==='P3'&&item.id==='S2'),false);
 assert.equal(ai.calls.length,4,'missing synthesis evidence remains partial without an explicit repairability decision');
});

test('reviewer preserves a separate exact span from each cited source when each supports the claim',async()=>{
 const passage='Wollstonecraft explains how education and social position shape judgment and character. '.repeat(12);
 const sources=['S1','S4','S6'].map((id,index)=>({id,bookId:'87',title:'A Vindication of the Rights of Woman — Mary Wollstonecraft',
  page:48+index,url:`https://example.test/wollstonecraft#page=${48+index}`,text:passage,preview:passage}));
 const evidence=sources.map(source=>({sourceId:source.id,
  spanIds:buildReviewSpans(source.id,passage).slice(0,1).map(span=>span.spanId)}));
 const plan={version:'reader-evidence-v2',intent:'explain',
  sources:[{label:'Mary Wollstonecraft',role:'primary',bookIds:['87']}],
  parts:[{id:'P1',question:'How does Wollstonecraft describe social conditions?',sourceBookIds:['87'],
   searchQueries:['Wollstonecraft social conditions'],candidateSourceIds:sources.map(source=>source.id)}],
  queries:['Wollstonecraft social conditions']};
 const ai=makeAI([
  answer('PART P1\nWollstonecraft connects women’s development to education and social position. [S1, S4, S6]'),
  review([['P1','answered']],{evidenceByPart:{P1:evidence}})
 ]);
 const result=await composeEvidenceAnswer('How does Wollstonecraft describe social conditions?',sources,ai,[],
  {plan,catalog:{87:'A Vindication of the Rights of Woman — Mary Wollstonecraft'},trace:true});
 const mappedSourceIds=new Set(result.evidenceMap.filter(item=>item.partId==='P1').map(item=>item.id));
 const mappedSpans=result.evidenceMap.filter(item=>item.partId==='P1');
 assert.deepEqual([...mappedSourceIds].sort(),['S1','S4','S6']);
 assert.equal(mappedSpans.length,3);
 assert.deepEqual(Object.fromEntries([...mappedSourceIds].sort().map(sourceId=>[
  sourceId,mappedSpans.filter(item=>item.id===sourceId).length
 ])),{S1:1,S4:1,S6:1},'each of the three cited sources contributes exactly one reviewed span');
 assert.ok(mappedSpans.every(item=>sources.find(source=>source.id===item.id).text.includes(item.quote)));
 assert.deepEqual(result.questionParts[0].evidenceIds.sort(),['S1','S4','S6']);
 assert.match(result.answer,/\[S1, S4, S6\]/);
 assert.equal(result.coverage,'full');
 assert.equal(ai.calls.length,2);
});

test('a claim citing more sources than the span budget stays incomplete',async()=>{
 const sourceIds=['S1','S2','S3','S4','S5','S6','S7'];
 const sources=sourceIds.map(id=>({...hume,id,candidatePartIds:['P1']}));
 const plan={...onePartPlan,parts:[{...onePartPlan.parts[0],candidateSourceIds:sourceIds}]};
 const citations=sourceIds.join(', ');
 const ai=makeAI([answer(`PART P1\nThe claim is supported by these seven separate pages. [${citations}]`),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',sources,ai,[],
  {plan,catalog,trace:true});
 assert.equal(result.coverage,'none');
 assert.equal(result.evidenceMap.length,0);
 assert.ok(result.trace.reviewContract.supportIssues.some(issue=>
  issue.claimId==='P1-C1'&&issue.reason==='missing-claim-source-span'));
 assert.equal(ai.calls.length,2,'a claim exceeding the evidence-span budget is not retried as an answer repair');
});

test('reviewer contract errors suppress a one-part draft when review is incomplete',async()=>{
 const ai=makeAI([answer('PART P1\nHume links necessity to custom and regular conjunction. [S1]'),
  {response:JSON.stringify({parts:[],claims:[]})}]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],
  {plan:onePartPlan,catalog});
 assert.equal(result.outcome,'generation-failed');
 assert.equal(result.coverage,'none');
 assert.equal(result.reviewStatus,'review-contract-incomplete');
 assert.equal(result.answer,'I could not complete a reliable answer this time. Please try again.');
 assert.equal(ai.calls.length,2);
});

test('malformed reviewer JSON fails closed and suppresses the one-part draft',async()=>{
 const malformed={response:'{"parts":[{"partId":"P1","status":"answered","reason":"The phrase "denial of self" is supported.","claims":[]}]}' };
 const ai=makeAI([answer('PART P1\nHume links necessity to custom and regular conjunction. [S1]'),
  malformed,malformed]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],
  {plan:onePartPlan,catalog,trace:true});
 assert.equal(result.outcome,'generation-failed');
 assert.equal(result.coverage,'none');
 assert.equal(result.reviewStatus,'review-format-failed');
 assert.equal(result.answer,'I could not complete a reliable answer this time. Please try again.');
 assert.deepEqual(result.trace.reviewContract.issues,['model-output-invalid-format']);
 assert.deepEqual(result.trace.reviewRetry,{attempted:true,reason:'model-output-invalid-format',applied:false,
  parts:[{partId:'P1',reason:'model-output-invalid-format',applied:false}]});
 assert.equal(ai.calls.length,3,'a malformed review gets one compact retry and no further call');
});

test('the exact run 9 Wollstonecraft reviewer response parses after repeated unmatched closers are removed',()=>{
 const raw=['```json',
  '{"parts":[{"partId":"P1","status":"answered","directAnswerClaimIds":["P1-C1","P1-C2","P1-C3","P1-C4","P1-C5"]},{"partId":"P2","status":"answered","directAnswerClaimIds":["P2-C1","P2-C2","P2-C3","P2-C4","P2-C5"]}],"claims":[{"claimId":"P1-C1","status":"answered","sources":[{"sourceId":"S5","status":"answered","spanIds":["S5-Q8","S5-Q25"]}]]},{"claimId":"P1-C2","status":"answered","sources":[{"sourceId":"S5","status":"answered","spanIds":["S5-Q21"]}]]},{"claimId":"P1-C3","status":"answered","sources":[{"sourceId":"S4","status":"answered","spanIds":["S4-Q5"]}]]},{"claimId":"P1-C4","status":"answered","sources":[{"sourceId":"S2","status":"answered","spanIds":["S2-Q19"]}]]},{"claimId":"P1-C5","status":"answered","sources":[{"sourceId":"S5","status":"answered","spanIds":["S5-Q25"]}]]},{"claimId":"P2-C1","status":"answered","sources":[{"sourceId":"S4","status":"answered","spanIds":["S4-Q20","S4-Q22"]}]]},{"claimId":"P2-C2","status":"answered","sources":[{"sourceId":"S5","status":"answered","spanIds":["S5-Q6"]}]]},{"claimId":"P2-C3","status":"answered","sources":[{"sourceId":"S1","status":"answered","spanIds":["S1-Q21"]}]]},{"claimId":"P2-C4","status":"answered","sources":[{"sourceId":"S4","status":"answered","spanIds":["S4-Q20"]}]]},{"claimId":"P2-C5","status":"answered","sources":[{"sourceId":"S4","status":"answered","spanIds":["S4-Q22"]}]]}]}',
  '```'].join('\n');
 const review=parseReviewJson({response:raw});
 assert.equal(review.parts.length,2);
 assert.equal(review.claims.length,10);
 assert.deepEqual(review.parts.map(part=>part.directAnswerClaimIds.length),[5,5]);
});

test('run 9 repeated-unmatched-closer recovery still validates the full review and makes no extra call',async()=>{
 const sourceDecision={sourceId:'S1',status:'answered',subjectAttributionStatus:'supported',
  attributedSubject:'Hume',spanIds:['S1-Q1']};
 const valid=JSON.stringify({claims:[
  {claimId:'P1-C1',status:'answered',sources:[sourceDecision],clauses:[{
   text:'Hume links necessity to custom and regular conjunction.',status:'answered',issueCode:'none',
   sources:[sourceDecision]}]},
  {claimId:'P1-C2',status:'answered',sources:[sourceDecision],clauses:[{
   text:'Repeated conjunction guides inference.',status:'answered',issueCode:'none',
   sources:[sourceDecision]}]}
 ],parts:[{partId:'P1',status:'answered',
  directAnswerClaimIds:['P1-C1','P1-C2']}]});
 const malformed=valid.replaceAll('"spanIds":["S1-Q1"]}]}','"spanIds":["S1-Q1"]}]]}');
 assert.equal((malformed.match(/\]\]\}/gu)||[]).length,2,
  'fixture must preserve the repeated closing brackets seen across run 9 claim records');
 const ai=makeAI([answer('PART P1\nHume links necessity to custom and regular conjunction. [S1]\n'+
  'Repeated conjunction guides inference. [S1]'),
  {response:'```json\n'+malformed+'\n```'}],{decorateReview:false});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],
  {plan:onePartPlan,catalog,trace:true});
 assert.equal(result.outcome,'verified-source-draft');
 assert.equal(result.coverage,'full');
 assert.equal(result.questionParts[0].status,'supported');
 assert.deepEqual(result.trace.reviewContract.recovered,[{
  stage:'review',code:'repeated-unmatched-closer',count:2
 }]);
 assert.deepEqual(result.evidenceMap.map(item=>item.id),['S1','S1']);
 assert.equal(ai.calls.length,2,'syntax normalization must not trigger another model call');
});

test('run 48 reviewer typo fails closed and suppresses a one-part draft (B7-5b)',async()=>{
 const typo={response:'{"parts":[{"partId":"P1","status":"partial"}],"claims":[{"claimId":"P1-C1","status":"unanswered","spansBySource:{}}'};
 const ai=makeAI([answer('PART P1\nHume links necessity to custom and regular conjunction. [S1]'),
  typo,typo]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],
  {plan:onePartPlan,catalog,trace:true});
 assert.equal(result.outcome,'generation-failed');
 assert.equal(result.coverage,'none');
 assert.equal(result.reviewStatus,'review-format-failed');
 assert.equal(result.questionParts[0].status,'unsupported',
  'an unvalidated sole part is suppressed');
 // The review itself still failed. Batch 7 (B7-5b) holds the fallback
 // builder to the second look's union-coverage standard: this claim's
 // only span covers two of its six content terms (necessity, custom —
 // the span's "conjoined" is not the claim's "conjunction"), so no
 // span link is fabricated.
 // Batch 10 (B10-1) REVERSES the second half of the B7-5b pin — this
 // reversal is approved and intentional. B7-5b shipped the draft with
 // its citation marker intact; batch 9's evaluation then shipped 14
 // such markers with no mechanism behind them, visibly citing sources
 // nothing had validated. The claim is now untraced (fallback is the
 // only mechanism in a whole-review failure, and it withheld), so the
 // marker is stripped and the prose ships as what it honestly is: an
 // unverified draft sentence. The downgrade is unchanged.
 assert.equal(result.trace.fallbackEvidence,undefined);
 assert.equal(result.evidenceMap.length,0);
 assert.equal(result.answer,'I could not complete a reliable answer this time. Please try again.');
 assert.equal(result.trace.untracedCitedClaims,undefined,
  'the unvalidated part is removed before answer assembly');
 assert.equal(result.trace.reviewContract.issues[0],'model-output-invalid-format');
 assert.deepEqual(result.trace.reviewRetry,{attempted:true,reason:'model-output-invalid-format',applied:false,
  parts:[{partId:'P1',reason:'model-output-invalid-format',applied:false}]});
 assert.equal(ai.calls.length,3);
});

test('a truncated first review succeeds on one compact retry with a smaller span packet',async()=>{
 const sourceText=[
  'Causation is not perceived directly in the objects themselves, nor in any single impression that we receive from them.',
  'Custom operates quietly upon the imagination only after repeated instances of constant conjunction have been observed.',
  'Belief carries with it a peculiar feeling of vivacity that clearly distinguishes it from the loose reveries of fancy.',
  'Reason alone, as far as experience shows, never produces any action or gives rise to volition in human life itself.',
  'The idea of substance, when examined closely, has no corresponding impression from which it could be derived at all.',
  'Probability in matters of fact arises from an opposition of contrary causes and chances mixed together in experience.',
  'Sympathy is the principle by which we enter into the feelings of others and share their pleasures and their pains.',
  'Justice derives its whole origin from human conventions established by society to remedy selfishness and partiality.'
 ].join(' ');
 const source={...hume,text:sourceText,preview:'Causation is not perceived directly in the objects themselves.'};
 const truncated={choices:[{finish_reason:'length',message:{content:'{"parts":[{"partId":"P1"'}}],
  usage:{neurons:3,prompt_tokens:500,completion_tokens:1800}};
 const ai=makeAI([answer('PART P1\nCausation is not perceived directly in objects themselves. [S1]'),
  truncated,review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[source],ai,[],{
  plan:onePartPlan,catalog,trace:true});
 assert.equal(ai.calls.length,3,'compose, the truncated review, and exactly one retry');
 assert.deepEqual(result.trace.reviewRetry,{attempted:true,reason:'review-output-truncated',applied:true,
  parts:[{partId:'P1',reason:'review-output-truncated',applied:true}]});
 assert.equal(result.outcome,'verified-source-draft');
 assert.equal(result.coverage,'full');
 assert.equal(result.questionParts[0].status,'supported');
 assert.equal(result.evidenceMap.length,1);
 assert.equal(result.trace.fallbackEvidence,undefined,'a successful retry needs no fallback evidence');
 const firstPacket=JSON.parse(ai.calls[1].request.messages[1].content);
 const retryPacket=JSON.parse(ai.calls[2].request.messages[1].content);
 assert.equal(firstPacket.spanCatalog.length,8);
 assert.equal(retryPacket.spanCatalog.length,4,'the retry reviews a compact four-span packet');
});

test('a review that fails both attempts suppresses the sole unvalidated part',async()=>{
 const matching='A just decision applies a rule impartially, while a merciful response tempers the consequence with compassion.';
 const unrelated='Harvest festivals in the valley traditionally begin after the first frost and continue for nine days of feasting.';
 const source={id:'S1',bookId:'72',title:'Justice and Mercy',page:1,
  text:matching+' '+unrelated,preview:matching};
 const plan={...onePartPlan,sources:[{label:'Justice and Mercy',role:'primary',bookIds:['72']}],
  parts:[{...onePartPlan.parts[0],question:'How can justice and mercy come into conflict?',
   sourceBookIds:['72'],candidateSourceIds:['S1']}]};
 const invalid={response:'{invalid-json'};
 const ai=makeAI([answer('PART P1\nJustice applies a rule impartially, while mercy tempers consequences with compassion. [S1]'),
  invalid,invalid]);
 const result=await composeEvidenceAnswer('How can justice and mercy come into conflict?',[source],ai,[],
  {plan,catalog:{...catalog,72:'Justice and Mercy'},trace:true});
 assert.equal(ai.calls.length,3);
 assert.deepEqual(result.trace.reviewRetry,{attempted:true,reason:'model-output-invalid-format',applied:false,
  parts:[{partId:'P1',reason:'model-output-invalid-format',applied:false}]});
 assert.equal(result.reviewStatus,'review-format-failed');
 assert.equal(result.outcome,'generation-failed');
 assert.equal(result.coverage,'none');
 assert.equal(result.questionParts[0].status,'unsupported',
  'the sole unvalidated part is suppressed');
 assert.equal(result.evidenceMap.length,0);
});

test('per-part review calls run concurrently instead of summing every part',async()=>{
 const draft='PART P1\nHume explains causal expectation through custom rather than reasoning. [S1]\n'+
  'PART P2\nKant identifies causality as an a priori category of relation. [S2]\n'+
  'PART P3\nHume ties causal expectation to custom, whereas Kant treats causality as an a priori category. [S1, S2]';
 const partReviewer=(_model,{messages})=>{
  const payload=parsePayload(messages);
  const part=payload.parts[0];
  return {response:JSON.stringify({parts:[{partId:part.partId,status:'answered',
   directAnswerClaimIds:payload.claims.map(claim=>claim.claimId),retainedContextClaimIds:[]}],
   claims:payload.claims.map(claim=>({claimId:claim.claimId,status:'answered',
    sources:claim.sourceIds.map(sourceId=>({sourceId,status:'answered',
     spanIds:[claim.sourceEvidence.find(item=>item.sourceId===sourceId).spanIds[0]]}))}))})};
 };
 const baseAi=makeAI([answer(draft),partReviewer,partReviewer,partReviewer]);
 const ai={calls:baseAi.calls,run:async(model,request)=>{
  if(String(request?.messages?.[0]?.content||'').startsWith('Review the complete answer'))
   await new Promise(resolve=>setTimeout(resolve,150));
  return baseAi.run(model,request);}};
 const started=Date.now();
 const result=await composeEvidenceAnswer('How do Hume and Kant differ over causal necessity?',
  [{...hume,candidatePartIds:['P1','P3']},{...kant,candidatePartIds:['P2','P3']}],ai,[],
  {plan:twoSidePlan,catalog,trace:true});
 const elapsedMs=Date.now()-started;
 assert.equal(ai.calls.length,4,'one compose call and one review call per part');
 assert.deepEqual(result.trace.stages.filter(stage=>stage.stage==='review')
  .map(stage=>stage.partId),['P1','P2','P3'],
  'each review stage trace names the part it reviewed');
 assert.ok(elapsedMs<400,
  `three 150ms part reviews overlap rather than sum (took ${elapsedMs}ms; serial would exceed 450ms)`);
 assert.equal(result.coverage,'full');
 assert.deepEqual(result.questionParts.map(part=>part.status),
  ['supported','supported','supported']);
});

test('one failed review part is dropped when it is a strict minority',async()=>{
 const draft='PART P1\nHume explains causal expectation through custom rather than reasoning. [S1]\n'+
  'PART P2\nKant treats causality as a category of relation and a pure conception of the understanding. [S2]\n'+
  'PART P3\nHume ties causal expectation to custom, whereas Kant treats causality as an a priori category. [S1, S2]';
 const dispatchReviewer=(_model,{messages})=>{
  const payload=parsePayload(messages);
  if(payload.parts[0].partId==='P2'){
   const error=new Error('Review response was truncated');
   error.code='review-output-truncated';error.stage='review';
   throw error;
  }
  return review([['P1','answered'],['P2','answered'],['P3','answered']])(_model,{messages});
 };
 const ai=makeAI([answer(draft),dispatchReviewer,dispatchReviewer,dispatchReviewer,dispatchReviewer]);
 const result=await composeEvidenceAnswer('How do Hume and Kant differ over causal necessity?',
  [{...hume,candidatePartIds:['P1','P3']},{...kant,candidatePartIds:['P2','P3']}],ai,[],
  {plan:twoSidePlan,catalog,trace:true});
 assert.equal(ai.calls.length,5,'compose, one review per part, and one compact retry for the failed part');
 assert.deepEqual(result.questionParts.map(part=>part.status),
  ['supported','unsupported','supported'],
  'the strict-minority failed part is removed while the other parts keep their verdicts');
 assert.doesNotMatch(result.answer,/Kant treats causality as a category/);
 assert.equal(result.coverage,'partial');
 // Batch 8 (B8-5): P2 ships claims with no review coverage, so the
 // answer may no longer report itself as a verified draft — the gap
 // is named in the trace and the review status reports the contract
 // as incomplete. (Before batch 8 this asserted the old
 // 'verified-source-draft' outcome, the batch-7 Kierkegaard shape.)
 assert.equal(result.outcome,'unverified-source-draft');
 assert.equal(result.reviewStatus,'claim-review');
 assert.deepEqual(result.trace.reviewCompletion.unvalidatedPartIds,['P2']);
 assert.deepEqual(result.trace.reviewContract.failedParts,
  [{partId:'P2',code:'review-output-truncated'}]);
 assert.deepEqual(result.trace.reviewRetry,{attempted:true,reason:'review-output-truncated',
  applied:false,parts:[{partId:'P2',reason:'review-output-truncated',applied:false}]});
 assert.equal(result.evidenceMap.some(item=>item.partId==='P2'),false,
  'the unvalidated part contributes no evidence links');
 assert.doesNotMatch(result.answer,/Kant treats causality as a category of relation/);
});

test('a failed review part is dropped while reviewed sibling parts retain citations (Batch 21)',async()=>{
 // P2's review fails outright. Its first claim is one the
 // deterministic fallback covers (the shape of the sibling test
 // above); its second shares almost no content terms with Kant's
 // spans, so the fallback withholds — the batch-9 failed-contract
 // shape, where the draft marker shipped with nothing behind it.
 // Batch 10 strips that marker; the covered sibling is untouched.
 const draft='PART P1\nHume explains causal expectation through custom rather than reasoning. [S1]\n'+
  'PART P2\nKant treats causality as a category of relation and a pure conception of the understanding. [S2]\n'+
  'Kant argues that synthetic judgments extend knowledge beyond the boundaries of possible experience altogether. [S2]\n'+
  'PART P3\nHume ties causal expectation to custom, whereas Kant treats causality as an a priori category. [S1, S2]';
 const dispatchReviewer=(_model,{messages})=>{
  const payload=parsePayload(messages);
  if(payload.parts[0].partId==='P2'){
   const error=new Error('Review response was truncated');
   error.code='review-output-truncated';error.stage='review';
   throw error;
  }
  return review([['P1','answered'],['P2','answered'],['P3','answered']])(_model,{messages});
 };
 const ai=makeAI([answer(draft),dispatchReviewer,dispatchReviewer,dispatchReviewer,dispatchReviewer]);
 const result=await composeEvidenceAnswer('How do Hume and Kant differ over causal necessity?',
  [{...hume,candidatePartIds:['P1','P3']},{...kant,candidatePartIds:['P2','P3']}],ai,[],
  {plan:twoSidePlan,catalog,trace:true});
 assert.equal(ai.calls.length,5);
 assert.equal(result.outcome,'unverified-source-draft');
 assert.deepEqual(result.trace.reviewCompletion.unvalidatedPartIds,['P2']);
 assert.doesNotMatch(result.answer,/Kant argues that synthetic judgments/);
 assert.match(result.answer,/Hume ties causal expectation to custom/);
 assert.equal(result.evidenceMap.some(item=>item.partId==='P2'),false);
});

test('a throw at final assembly is salvaged into a downgraded answer (batch 11 B11-1)',async()=>{
 // The hook forces the deterministic region to throw after every
 // gate and invariant has run — the batch-10 502 shape. The build
 // must return the assembled state as an unverified draft instead
 // of letting the throw escape.
 const ai=makeAI([answer('PART P1\nHume links necessity to custom and regular conjunction. [S1]'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true,postReviewFault:'final-assembly'});
 assert.equal(result.outcome,'unverified-source-draft',
  'the salvaged answer is capped below verified');
 assert.match(result.answer,/Hume links necessity to custom/);
 assert.equal(result.trace.postReviewSalvage.salvaged,true);
 assert.equal(result.trace.postReviewSalvage.code,'injected-post-review-fault');
 assert.equal(result.trace.postReviewSalvage.stage,'post-review');
 assert.ok(result.trace.postReviewSalvage.frames.length>0,
  'the salvage record carries the throw’s source frames');
 assert.ok(result.trace.stages.some(entry=>entry.stage==='review'),
  'the trace stages up to the throw survive');
 for(const part of result.questionParts)
  for(const claimId of part.claimIds)
   assert.ok(result.evidenceMap.some(entry=>entry.claimId===claimId),
    'every shipped cited claim carries evidence entries');
});

test('final audit failures record their predicate and restore state in normal and salvage assembly',async()=>{
 for(const postReviewFault of [undefined,'containment']){
  const ai=makeAI([answer('PART P1\nHume links necessity to custom and regular conjunction. [S1]'),
   review([['P1','answered']])]);
  const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
   plan:onePartPlan,catalog,trace:true,postReviewFault,postReviewAuditPartId:'P1'});
  assert.equal(result.outcome,'generation-failed');
  assert.deepEqual(result.trace.final.auditFailures.unknownIds,[]);
  assert.equal(result.trace.final.auditFailures.quoteFailures[0].text,'deliberately unbound audit fixture');
  assert.equal(result.trace.postReviewSalvage.restore.branch,'reviewed');
  assert.equal(result.trace.postReviewSalvage.restore.verdict,'passed');
  assert.deepEqual(result.trace.postReviewSalvage.restore.residualUntraced,[]);
 }
});

test('final audit salvage drops one failing part from a two-part answer and names it missing',async()=>{
 const draft='PART P1\nHume explains causal expectation through custom rather than reasoning. [S1]\n'+
  'PART P2\nKant treats causality as an a priori category of relation. [S2]';
 const plan={...twoSidePlan,intent:'explain',parts:twoSidePlan.parts.slice(0,2)};
 const reviewBoth=review([['P1','answered'],['P2','answered']]);
 const ai=makeAI([answer(draft),reviewBoth,reviewBoth]);
 const result=await composeEvidenceAnswer(plan.resolvedQuestion,[hume,kant],ai,[],{
  plan,catalog,trace:true,postReviewAuditPartId:'P1'});
 assert.equal(result.outcome,'generation-failed','one failing part out of two is a tie, not a strict minority');
 assert.equal(result.answer,'I could not complete a reliable answer this time. Please try again.');
 assert.deepEqual(result.trace.final.auditSalvage,undefined);
 assert.deepEqual(result.trace.final.auditPartition.failingPartIds,['P1']);
 assert.deepEqual(result.trace.final.auditPartition.survivingPartIds,['P2']);
 assert.equal(result.trace.final.auditPartition.disposition,'suppressed');
});

test('final audit salvage still drops a localized failure from a larger answer',async()=>{
 const draft='PART P1\nHume explains causal expectation through custom rather than reasoning. [S1]\n'+
  'PART P2\nKant treats causality as an a priori category of relation. [S2]\n'+
  'PART P3\nThe accounts differ in the role they assign to experience. [S1, S2]';
 const reviewAll=review([['P1','answered'],['P2','answered'],['P3','answered']]);
 const ai=makeAI([answer(draft),reviewAll,reviewAll,reviewAll]);
 const result=await composeEvidenceAnswer(twoSidePlan.resolvedQuestion,[hume,kant],ai,[],{
  plan:twoSidePlan,catalog,trace:true,postReviewAuditPartId:'P1'});
 assert.equal(result.outcome,'unverified-source-draft');
 assert.deepEqual(result.trace.final.auditSalvage.droppedPartIds,['P1']);
 assert.deepEqual(result.trace.final.auditPartition.survivingPartIds,['P2','P3']);
 assert.equal(auditFinalAnswer(result.answer,[hume,kant]).ok,true);
});

test('final audit suppression remains when every included part fails',async()=>{
 const draft='PART P1\nHume explains causal expectation through custom rather than reasoning. [S1]\n'+
  'PART P2\nKant treats causality as an a priori category of relation. [S2]\n'+
  'PART P3\nHume ties causal expectation to custom, whereas Kant treats causality as an a priori category. [S1, S2]';
 const reviewAll=review([['P1','answered'],['P2','answered'],['P3','answered']]);
 const ai=makeAI([answer(draft),reviewAll,reviewAll,reviewAll]);
 const result=await composeEvidenceAnswer(twoSidePlan.resolvedQuestion,[hume,kant],ai,[],{
  plan:twoSidePlan,catalog,trace:true,postReviewAuditPartId:['P1','P2','P3']});
 assert.equal(result.outcome,'generation-failed');
 assert.equal(result.answer,'I could not complete a reliable answer this time. Please try again.');
 assert.equal(result.trace.final.auditSalvage,undefined);
 assert.deepEqual(result.trace.final.auditPartition.failingPartIds,['P1','P2','P3']);
 assert.deepEqual(result.trace.final.auditPartition.survivingPartIds,[]);
 assert.equal(result.trace.final.auditPartition.disposition,'suppressed');
 assert.ok(result.trace.final.auditFailures.quoteFailures.length>=3);
});

test('a throw during containment is salvaged the same way (batch 11 B11-1)',async()=>{
 const ai=makeAI([answer('PART P1\nHume links necessity to custom and regular conjunction. [S1]'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true,postReviewFault:'containment'});
 assert.equal(result.outcome,'unverified-source-draft');
 assert.match(result.answer,/Hume links necessity to custom/);
 assert.equal(result.trace.postReviewSalvage.salvaged,true);
 assert.equal(result.trace.postReviewSalvage.code,'injected-post-review-fault');
});

test('post-review salvage cannot restore an unvalidated strict-minority part (Batch 21)',async()=>{
 // The B10-1 failed-part shape, but the throw lands at containment —
 // before the invariant block would have run. P2's second claim is
 // traced by no mechanism (the fallback withholds), so the salvage
 // restore must strip its marker exactly as the invariant block
 // does; the fallback-covered sibling keeps its marker.
 const draft='PART P1\nHume explains causal expectation through custom rather than reasoning. [S1]\n'+
  'PART P2\nKant treats causality as a category of relation and a pure conception of the understanding. [S2]\n'+
  'Kant argues that synthetic judgments extend knowledge beyond the boundaries of possible experience altogether. [S2]\n'+
  'PART P3\nHume ties causal expectation to custom, whereas Kant treats causality as an a priori category. [S1, S2]';
 const dispatchReviewer=(_model,{messages})=>{
  const payload=parsePayload(messages);
  if(payload.parts[0].partId==='P2'){
   const error=new Error('Review response was truncated');
   error.code='review-output-truncated';error.stage='review';
   throw error;
  }
  return review([['P1','answered'],['P2','answered'],['P3','answered']])(_model,{messages});
 };
 const ai=makeAI([answer(draft),dispatchReviewer,dispatchReviewer,dispatchReviewer,dispatchReviewer]);
 const result=await composeEvidenceAnswer('How do Hume and Kant differ over causal necessity?',
  [{...hume,candidatePartIds:['P1','P3']},{...kant,candidatePartIds:['P2','P3']}],ai,[],
  {plan:twoSidePlan,catalog,trace:true,postReviewFault:'containment'});
 assert.equal(result.outcome,'unverified-source-draft');
 assert.doesNotMatch(result.answer,/Kant argues that synthetic judgments/);
 assert.match(result.answer,/Hume explains causal expectation/);
 assert.equal(result.trace.postReviewSalvage.salvaged,true);
 assert.deepEqual(result.trace.reviewCompletion.unvalidatedPartIds,['P2']);
 assert.doesNotMatch(result.answer,/Kant argues that synthetic judgments/);
 assert.match(result.answer,/Hume explains causal expectation/);
});

test('a throw before parts exist returns an honest labeled failure (batch 11 B11-1)',async()=>{
 const ai=makeAI([answer('PART P1\nHume links necessity to custom and regular conjunction. [S1]'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true,postReviewFault:'parts-assembly'});
 assert.equal(result.outcome,'generation-failed');
 assert.equal(result.answer,'I could not complete a reliable answer this time. Please try again.',
  'a failed build answers with the canned failure text');
 assert.equal(result.failureCode,'injected-post-review-fault',
  'the true code surfaces instead of a catch-all');
 assert.equal(result.failureStage,'post-review');
 assert.equal(result.trace.postReviewSalvage.salvaged,false);
 assert.equal(result.trace.postReviewSalvage.code,'injected-post-review-fault');
 assert.ok(result.trace.stages.some(entry=>entry.stage==='review'),
  'the trace stages up to the throw survive');
});

test('a review request failure is retried once per part like other review-output failures',async()=>{
 // The run #44 failure arrived as a provider error with no machine-readable
 // code; run() records it as review-request-failed, and the retry decision
 // uses the same normalization.
 const requestFailed=new Error('Review request failed');
 const ai=makeAI([answer('PART P1\nHume links necessity to custom and regular conjunction. [S1]'),
  requestFailed,review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true});
 assert.equal(ai.calls.length,3,'compose, the failed review request, and its compact retry');
 assert.deepEqual(result.trace.reviewRetry,{attempted:true,reason:'review-request-failed',
  applied:true,parts:[{partId:'P1',reason:'review-request-failed',applied:true}]});
 assert.equal(result.outcome,'verified-source-draft');
 assert.equal(result.coverage,'full');
 assert.equal(result.questionParts[0].status,'supported');
});

test('citation gate refusal contains a single uncited source-required part',async()=>{
 const uncitedReview={response:JSON.stringify({parts:[{partId:'P1',status:'answered',
  answerStatus:'answered',directAnswerClaimIds:['P1-C1'],retainedContextClaimIds:['P1-C1']}],claims:[]})};
 const uncitedRepair={response:JSON.stringify({parts:[{partId:'P1',
  replacements:[{claimId:'P1-C1',text:'Hume links necessity to custom and regular conjunction in experience.'}],
  additions:[]}]})};
 const ai=makeAI([answer('PART P1\nHume links necessity to custom and regular conjunction.'),
  uncitedReview,uncitedRepair],{decorateReview:false});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true});
 assert.equal(ai.calls.length,3,'compose, review, and exactly one targeted gate repair attempt');
 assert.equal(result.trace.citationGate[0].action,'repair-refused');
 assert.equal(result.trace.citationGate[0].repairFailure.failureStep,'citation-candidate-check');
 assert.deepEqual(result.trace.citationGate[0].repairFailure.candidateCheck,
  {linkedSourceCount:1,candidateCitationCount:0,missingLinkedSourceIds:['S1']});
 assert.equal(result.outcome,'generation-failed',
  'one source-required part is not a strict minority and cannot ship uncited');
 assert.equal(result.trace.sourceRequiredContainment.disposition,'suppressed-not-strict-minority');
 assert.doesNotMatch(result.answer,/custom and regular conjunction/);
});

test('citation gate keeps a source-based part supported when repair restores its citation',async()=>{
 const uncitedReview={response:JSON.stringify({parts:[{partId:'P1',status:'answered',
  answerStatus:'answered',directAnswerClaimIds:['P1-C1'],retainedContextClaimIds:['P1-C1']}],claims:[]})};
 const citedRepair={response:JSON.stringify({parts:[{partId:'P1',
  replacements:[{claimId:'P1-C1',text:'Hume links necessity to custom and regular conjunction. [S1]'}],
  additions:[]}]})};
 const citedReReview=(_model,{messages})=>{
  const payload=parsePayload(messages);
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
   directAnswerClaimIds:payload.claims.map(claim=>claim.claimId),retainedContextClaimIds:[]}],
   claims:payload.claims.map(claim=>({claimId:claim.claimId,status:'answered',
    sources:claim.sourceIds.map(sourceId=>({sourceId,status:'answered',
     spanIds:[claim.sourceEvidence.find(item=>item.sourceId===sourceId).spanIds[0]]}))}))})};
 };
 const ai=makeAI([answer('PART P1\nHume links necessity to custom and regular conjunction.'),
  uncitedReview,citedRepair,citedReReview],{decorateReview:false});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true});
 assert.equal(ai.calls.length,4,'compose, review, the gate repair, and its independent re-review');
 assert.deepEqual(result.trace.citationGate,
  [{partId:'P1',action:'repair-applied',preGateStatus:'answered'}]);
 assert.equal(result.questionParts[0].status,'supported');
 assert.equal(result.coverage,'full');
 assert.match(result.answer,/custom and regular conjunction\. \[S1\]/);
 assert.ok(result.evidenceMap.some(item=>item.partId==='P1'&&item.id==='S1'),
  'the restored citation carries reviewed evidence');
});

test('citation gate reaches a partial part whose citations review dropped (batch 11 B11-4)',async()=>{
 // The batch-10 field shape: the draft's cited claim is rejected at
 // review (claim-source-not-supported), the part's retained context
 // prose ships uncited, and the part is partial precisely because its
 // citations died. Before B11-4 the gate's answered-only trigger never
 // offered this part its repair.
 const rejectingReview={response:JSON.stringify({parts:[{partId:'P1',status:'partial',
  answerStatus:'partial',directAnswerClaimIds:['P1-C2'],retainedContextClaimIds:['P1-C2']}],
  claims:[{claimId:'P1-C1',status:'partial',
   sources:[{sourceId:'S1',status:'partial',spanIds:[]}],
   clauses:[{text:'Hume links necessity to custom and regular conjunction.',
    status:'partial',issueCode:'none',
    sources:[{sourceId:'S1',status:'partial',spanIds:[]}]}]}]})};
 const citedRepair=(_model,{messages})=>{
  const payload=parsePayload(messages);
  return {response:JSON.stringify({parts:[{partId:'P1',
   replacements:payload.parts[0].repair.replaceClaimIds.map(claimId=>({claimId,
    text:'Custom, for Hume, is the great guide of human life, since repeated conjunction determines the mind to infer one object from another. [S1]'})),
   additions:[]}]})};
 };
 const acceptingReReview=(_model,{messages})=>{
  const payload=parsePayload(messages);
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
   directAnswerClaimIds:payload.claims.map(claim=>claim.claimId),retainedContextClaimIds:[]}],
   claims:payload.claims.map(claim=>({claimId:claim.claimId,status:'answered',
    sources:claim.sourceIds.map(sourceId=>({sourceId,status:'answered',
     spanIds:[claim.sourceEvidence.find(item=>item.sourceId===sourceId).spanIds[0]]}))}))})};
 };
 const ai=makeAI([answer('PART P1\nHume links necessity to custom and regular conjunction. [S1]\n'+
   'Custom, for Hume, is the great guide of human life and the foundation of all reasoning about matters of fact.'),
  rejectingReview,rescueRejection(),citedRepair,acceptingReReview],{decorateReview:false});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true});
 assert.equal(ai.calls.length,5,'compose, review, the batch 24 rescue, the gate repair, and its independent re-review');
 assert.deepEqual(result.trace.citationGate,
  [{partId:'P1',action:'repair-applied',preGateStatus:'partial'}],
  'the widened trigger fires for the partial part and records its pre-gate status');
 assert.equal(result.questionParts[0].status,'supported');
 assert.match(result.answer,/great guide of human life.*\[S1\]/,
  'the repaired claim ships with its restored citation');
 assert.ok(result.evidenceMap.some(item=>item.partId==='P1'&&item.id==='S1'));
});

test('citation gate adopts a cited re-review part at partial status (batch 12 B12-4a)',async()=>{
 const uncitedReview={response:JSON.stringify({parts:[{partId:'P1',status:'partial',
  answerStatus:'partial',directAnswerClaimIds:['P1-C2'],retainedContextClaimIds:['P1-C2']}],
  claims:[{claimId:'P1-C1',status:'partial',sources:[{sourceId:'S1',status:'partial',spanIds:[]}],
   clauses:[{text:'Hume links causal expectation to custom.',status:'partial',issueCode:'none',
    sources:[{sourceId:'S1',status:'partial',spanIds:[]}]}]}]})};
 const citedRepair=(_model,{messages})=>{
  const payload=parsePayload(messages);
  return {response:JSON.stringify({parts:[{partId:'P1',
   replacements:payload.parts[0].repair.replaceClaimIds.map(claimId=>({claimId,
    text:'Hume links causal expectation to custom formed through repeated conjunction. [S1]'})),
   additions:[]}]})};
 };
 const partialAcceptingReReview=(_model,{messages})=>{
  const payload=parsePayload(messages);
  return {response:JSON.stringify({parts:[{partId:'P1',status:'partial',answerStatus:'partial',
   directAnswerClaimIds:payload.claims.map(claim=>claim.claimId),retainedContextClaimIds:[]}],
   claims:payload.claims.map(claim=>({claimId:claim.claimId,status:'answered',
    sources:claim.sourceIds.map(sourceId=>({sourceId,status:'answered',
     spanIds:[claim.sourceEvidence.find(item=>item.sourceId===sourceId).spanIds[0]]}))}))})};
 };
 const ai=makeAI([answer('PART P1\nHume links causal expectation to custom. [S1]\n'+
  'Repeated experience shapes expectation in ordinary reasoning.'),
  uncitedReview,rescueRejection(),citedRepair,partialAcceptingReReview],{decorateReview:false});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true});
 assert.equal(result.trace.citationGate[0].action,'repair-applied');
 assert.equal(result.trace.citationGate[0].refusal,undefined);
 assert.deepEqual(result.trace.citationGateSummary,{firings:1,adoptions:1,
  outcomes:{adopted:1,repairRefused:0,repairThrew:0,reReviewRefused:0}});
 assert.equal(result.questionParts[0].answerStatus,'partial');
 assert.equal(result.questionParts[0].status,'partial');
 assert.match(result.answer,/causal expectation.*\[S1\]/);
 assert.ok(result.evidenceMap.some(item=>item.partId==='P1'&&item.id==='S1'));
});

test('citation gate records a failed repair for a partial part and containment suppresses the uncited draft (batch 22)',async()=>{
 const rejectingReview={response:JSON.stringify({parts:[{partId:'P1',status:'partial',
  answerStatus:'partial',directAnswerClaimIds:['P1-C2'],retainedContextClaimIds:['P1-C2']}],
  claims:[{claimId:'P1-C1',status:'partial',
   sources:[{sourceId:'S1',status:'partial',spanIds:[]}],
   clauses:[{text:'Hume links necessity to custom and regular conjunction.',
    status:'partial',issueCode:'none',
    sources:[{sourceId:'S1',status:'partial',spanIds:[]}]}]}]})};
 const uncitedRepair=(_model,{messages})=>{
  const payload=parsePayload(messages);
  return {response:JSON.stringify({parts:[{partId:'P1',
   replacements:payload.parts[0].repair.replaceClaimIds.map(claimId=>({claimId,
    text:'Custom, for Hume, is the great guide of human life and the foundation of all reasoning about matters of fact.'})),
   additions:[]}]})};
 };
 const ai=makeAI([answer('PART P1\nHume links necessity to custom and regular conjunction. [S1]\n'+
   'Custom, for Hume, is the great guide of human life and the foundation of all reasoning about matters of fact.'),
  rejectingReview,rescueRejection(),uncitedRepair],{decorateReview:false});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true});
 assert.equal(ai.calls.length,4,'compose, review, the batch 24 rescue, and the one gate repair attempt');
 assert.equal(result.trace.citationGate[0].action,'repair-refused');
 assert.equal(result.trace.citationGate[0].preGateStatus,'partial');
 assert.equal(result.outcome,'generation-failed');
 assert.equal(result.trace.sourceRequiredContainment.uncitedPartIds[0],'P1');
 assert.doesNotMatch(result.answer,/great guide of human life/);
});

test('citation gate traces duplicate-key patch failure and containment prevents uncited shipment (batch 22)',async()=>{
 const uncitedReview={response:JSON.stringify({parts:[{partId:'P1',status:'answered',
  answerStatus:'answered',directAnswerClaimIds:['P1-C1'],retainedContextClaimIds:['P1-C1']}],claims:[]})};
 const duplicateKeyRepair={response:'{"parts":[{"partId":"P1","replacements":['+
  '{"claimId":"P1-C1","claimId":"P1-C9","text":"A repaired claim without source support."}],"additions":[]}]}'};
 const ai=makeAI([answer('PART P1\nHume links necessity to custom.'),uncitedReview,duplicateKeyRepair],
  {decorateReview:false});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true});
 assert.equal(result.outcome,'generation-failed',
  'one uncited source-required part cannot ship when it is not a strict minority');
 assert.equal(result.trace.citationGate[0].action,'repair-refused');
 assert.equal(result.trace.citationGate[0].repairFailure.failureStep,'patch-schema-validation');
 assert.equal(result.trace.citationGate[0].repairFailure.code,'answer-repair-invalid');
 assert.equal(result.trace.citationGate[0].repairFailure.responseShape.duplicateClaimIdKeyCount,1);
 assert.equal(result.trace.citationGate[0].repairFailure.responseShape.replacementCount,1);
 assert.deepEqual(result.trace.citationGateSummary.outcomes,
  {adopted:0,repairRefused:1,repairThrew:0,reReviewRefused:0});
 assert.deepEqual(result.trace.sourceRequiredContainment,
  {totalParts:1,sourceRequiredPartIds:['P1'],uncitedPartIds:['P1'],
   droppedPartIds:[],disposition:'suppressed-not-strict-minority'});
});

test('citation gate records a forbidden repair field as schema refusal rather than a blind throw (batch 22)',async()=>{
 const uncitedReview={response:JSON.stringify({parts:[{partId:'P1',status:'answered',
  answerStatus:'answered',directAnswerClaimIds:['P1-C1'],retainedContextClaimIds:['P1-C1']}],claims:[]})};
 const invalidField={response:JSON.stringify({parts:[{partId:'P1',
  replacements:[{claimId:'P1-C1',text:'Hume explains necessity through custom. [S1]'}],
  additions:[],citedSourceIds:['S1']}]})};
 const ai=makeAI([answer('PART P1\nHume explains necessity through custom.'),uncitedReview,invalidField],
  {decorateReview:false});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true});
 assert.equal(result.trace.citationGate[0].action,'repair-refused');
 assert.equal(result.trace.citationGate[0].repairFailure.failureStep,'patch-schema-validation');
 assert.equal(result.trace.citationGate[0].repairFailure.code,'answer-repair-invalid');
 assert.deepEqual(result.trace.citationGate[0].repairFailure.responseShape.unexpectedPartFields,
  ['citedSourceIds']);
 assert.equal(result.trace.citationGateSummary.outcomes.repairThrew,0);
 assert.equal(result.outcome,'generation-failed');
});

test('citation gate records unexpected provider throws separately from validation refusals (batch 22)',async()=>{
 const uncitedReview={response:JSON.stringify({parts:[{partId:'P1',status:'answered',
  answerStatus:'answered',directAnswerClaimIds:['P1-C1'],retainedContextClaimIds:['P1-C1']}],claims:[]})};
 const providerFailure=Object.assign(new TypeError('simulated repair adapter failure'),
  {code:'adapter-bug'});
 const ai=makeAI([answer('PART P1\nHume explains necessity through custom.'),
  uncitedReview,providerFailure],{decorateReview:false});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true});
 const repair=result.trace.citationGate[0];
 assert.equal(repair.action,'repair-threw');
 assert.equal(repair.repairFailure.failureStep,'provider-call');
 assert.equal(repair.repairFailure.errorClass,'TypeError');
 assert.equal(repair.repairFailure.code,'adapter-bug');
 assert.equal(repair.repairFailure.message,'simulated repair adapter failure');
 assert.equal(repair.repairFailure.inputShape.partId,'P1');
 assert.equal(repair.repairFailure.inputShape.targetCount,1);
 assert.equal(repair.repairFailure.inputShape.answerCount,1);
 assert.equal(repair.repairFailure.inputShape.linkedSourceCount,1);
 assert.ok(repair.repairFailure.inputShape.repairPayloadBytes>0);
 assert.equal(result.trace.citationGateSummary.outcomes.repairThrew,1);
 assert.equal(result.outcome,'generation-failed');
});

test('source-required containment drops one peripheral uncited part but suppresses an uncited majority (batch 22)',async()=>{
 const runFixture=async(uncitedPartIds)=>{
  const plan={...twoSidePlan};
  const parts=plan.parts;
  const prose={P1:'Hume connects necessity to custom through repeated experience. [S1]',
   P2:'Kant treats causality as an a priori category of relation. [S2]',
   P3:'Hume links necessity to custom, whereas Kant treats causality as an a priori category. [S1, S2]'};
  for(const partId of uncitedPartIds)prose[partId]=partId==='P2'?
   'Kant presents causal order through the structure of human understanding.':
   'Hume explains causal necessity through custom and repeated experience.';
  const draft=parts.map(part=>`PART ${part.id}\n${prose[part.id]}`).join('\n\n');
  const reviewAll=(_model,{messages})=>{
   const payload=parsePayload(messages);
   const reviewParts=payload.parts.map(part=>{
    const contextIds=(part.contextClaims||[]).map(claim=>claim.claimId);
    const claimIds=payload.claims.filter(claim=>claim.partId===part.partId).map(claim=>claim.claimId);
    return {partId:part.partId,status:'answered',answerStatus:'answered',
     directAnswerClaimIds:[...claimIds,...contextIds],retainedContextClaimIds:contextIds};
   });
   return {response:JSON.stringify({parts:reviewParts,claims:payload.claims.map(claim=>({
    claimId:claim.claimId,status:'answered',sources:claim.sourceIds.map(sourceId=>({
     sourceId,status:'answered',spanIds:[sourceId+'-Q1']}))}))})};
  };
  const refuseRepair=(_model,{messages})=>{
   const payload=parsePayload(messages);
   return {response:JSON.stringify({parts:[{partId:payload.parts[0].partId,
    replacements:payload.parts[0].repair.replaceClaimIds.map(claimId=>({claimId,
     text:'A changed but still uncited statement about Hume and custom.'})),additions:[]}]})};
  };
  const ai=makeAI([answer(draft),reviewAll,reviewAll,reviewAll,
   ...uncitedPartIds.map(()=>refuseRepair)],{decorateReview:false});
  return composeEvidenceAnswer('How do Hume and Kant differ about causal necessity?',
   [hume,kant],ai,[],{plan,catalog,trace:true});
 };
 const peripheral=await runFixture(['P2']);
 assert.equal(peripheral.outcome,'verified-source-draft');
 assert.deepEqual(peripheral.trace.sourceRequiredContainment.droppedPartIds,['P2']);
 assert.equal(peripheral.questionParts.find(part=>part.partId==='P2').answerStatus,'unanswered');
 assert.match(peripheral.missing,/How does Kant explain causal necessity/);
 assert.match(peripheral.answer,/Hume connects necessity to custom/);
 assert.match(peripheral.answer,/whereas Kant treats causality/);
 assert.doesNotMatch(peripheral.answer,/Kant treats causality as an a priori category of relation/);
 const majority=await runFixture(['P1','P2']);
 assert.equal(majority.outcome,'generation-failed');
 assert.equal(majority.trace.sourceRequiredContainment.disposition,'suppressed-not-strict-minority');
 assert.deepEqual(majority.trace.sourceRequiredContainment.uncitedPartIds,['P1','P2']);
 assert.doesNotMatch(majority.answer,/whereas Kant treats causality/,
  'a cited sibling does not make the uncited majority safe to ship');
});

test('review-only retry reuses composition and succeeds after a review deadline (batch 22)',async()=>{
 let reviews=0;
 const deadline=Object.assign(new Error('deadline'),{code:'inference-deadline-exceeded',stage:'review'});
 const retryReview=(_model,{messages})=>{
  reviews++;
  if(reviews===1)throw deadline;
  return review([['P1','answered']])(_model,{messages});
 };
 const ai=makeAI([answer('PART P1\nHume links necessity to custom and regular conjunction. [S1]'),
  retryReview,retryReview]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true});
 assert.equal(result.outcome,'verified-source-draft');
 assert.equal(ai.calls.length,3,'one composition, first review, and one review-only retry');
 assert.deepEqual(result.trace.reviewRetry,{attempted:true,mode:'review-only',
  reason:'inference-deadline-exceeded',applied:true,outcome:'recovered',
  parts:[{partId:'P1',reason:'inference-deadline-exceeded',applied:true,
   mode:'review-only',samePacket:true,outcome:'recovered'}]});
 assert.equal(result.trace.answerRetry,undefined,
  'a successful review-only retry does not rerun the whole build');
});

test('a part still uncited after the gate is dropped and named in the containment trace (batch 22)',async()=>{
 // Same batch-10 shape as the B11-4 non-adoption test: the gate's
 // repair restores no citation, so the part ships its retained
 // context prose uncited while S1 sits in its packet. Before B11-5
 // that failure was silent — the part read as ordinary context.
 const rejectingReview={response:JSON.stringify({parts:[{partId:'P1',status:'partial',
  answerStatus:'partial',directAnswerClaimIds:['P1-C2'],retainedContextClaimIds:['P1-C2']}],
  claims:[{claimId:'P1-C1',status:'partial',
   sources:[{sourceId:'S1',status:'partial',spanIds:[]}],
   clauses:[{text:'Hume links necessity to custom and regular conjunction.',
    status:'partial',issueCode:'none',
    sources:[{sourceId:'S1',status:'partial',spanIds:[]}]}]}]})};
 const uncitedRepair=(_model,{messages})=>{
  const payload=parsePayload(messages);
  return {response:JSON.stringify({parts:[{partId:'P1',
   replacements:payload.parts[0].repair.replaceClaimIds.map(claimId=>({claimId,
    text:'Custom, for Hume, is the great guide of human life and the foundation of all reasoning about matters of fact.'})),
   additions:[]}]})};
 };
 const ai=makeAI([answer('PART P1\nHume links necessity to custom and regular conjunction. [S1]\n'+
   'Custom, for Hume, is the great guide of human life and the foundation of all reasoning about matters of fact.'),
  rejectingReview,uncitedRepair],{decorateReview:false});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true});
 assert.deepEqual(result.trace.uncitedPartsWithPacket,['P1'],
  'the still-uncited part is recorded in the trace');
 assert.equal(result.outcome,'generation-failed');
 assert.deepEqual(result.trace.sourceRequiredContainment.uncitedPartIds,['P1']);
 assert.deepEqual(result.trace.sourceRequiredContainment.droppedPartIds,[]);
 assert.match(result.missing,/How does Hume explain causal necessity/);
});

test('citation gate leaves general-context parts untouched',async()=>{
 const contextReview={response:JSON.stringify({parts:[{partId:'P1',status:'answered',
  answerStatus:'answered',directAnswerClaimIds:['P1-C1'],retainedContextClaimIds:['P1-C1']}],claims:[]})};
 const ai=makeAI([answer('PART P1\nHume explains causal necessity through learned expectation formed by repeated conjunctions.'),
  contextReview],{decorateReview:false});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[],ai,[],{
  plan:{...onePartPlan,parts:[{...onePartPlan.parts[0],candidateSourceIds:[]}]},catalog,trace:true});
 assert.equal(ai.calls.length,2,'no gate repair call runs for a part with no linked sources');
 assert.equal(result.trace.citationGate,undefined);
 assert.equal(result.answerCompleteness,'full');
 assert.match(result.answer,/learned expectation/);
});

test('build-time budget refuses optional gate calls and traces the skip (batch 11 B11-3)',async()=>{
 const uncitedReview={response:JSON.stringify({parts:[{partId:'P1',status:'answered',
  answerStatus:'answered',directAnswerClaimIds:['P1-C1'],retainedContextClaimIds:['P1-C1']}],claims:[]})};
 const ai=makeAI([answer('PART P1\nHume links necessity to custom and regular conjunction.'),
  uncitedReview],{decorateReview:false});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true,buildOptionalStageBudgetMs:-1});
 assert.equal(ai.calls.length,2,
  'compose and review (core) still run; the refused gate repair never reaches the provider');
 assert.deepEqual(result.trace.buildTimeBudget,
  {budgetMs:-1,skips:[{stage:'answer-repair',partId:'P1'}]},
  'the refusal is recorded in the trace, distinct from a provider failure');
 assert.equal(result.trace.citationGate?.[0]?.action,'repair-refused',
  'the gate treats the refusal as a failed repair and downgrades as usual');
 assert.equal(result.questionParts[0].status,'unsupported');
 assert.equal(result.outcome,'generation-failed',
  'the optional citation repair was refused and the uncited source-required part is contained');
 assert.doesNotMatch(result.answer,/custom and regular conjunction/);
});

test('no build-time budget trace appears when optional calls run within budget (batch 11 B11-3)',async()=>{
 const ai=makeAI([answer('PART P1\nHume links necessity to custom and regular conjunction. [S1]'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true});
 assert.equal(result.outcome,'verified-source-draft');
 assert.equal(result.trace.buildTimeBudget,undefined);
});

test('review output budget scales past the old cap for a many-claim review',async()=>{
 const sentences=Array.from({length:25},(_,index)=>
  `Hume observation ${index+1} links necessity to custom and regular conjunction in experience. [S1]`);
 // Batch 24 (B24-3): a 25-claim part exceeds the split threshold, so
 // its review runs as two concurrent calls over claim halves. The
 // per-record budget formula is unchanged; it now applies per half.
 const reviewHandler=review([['P1','answered']]);
 const ai=makeAI([answer('PART P1\n'+sentences.join(' ')),reviewHandler,reviewHandler]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true});
 assert.equal(ai.calls.length,3,'compose plus the two split review halves');
 const reviewCalls=ai.calls.filter(call=>call.request.messages[0].content.startsWith('Review the complete answer'));
 assert.equal(reviewCalls.length,2,'the many-claim review is split into two calls');
 assert.deepEqual(reviewCalls.map(call=>call.request.max_completion_tokens).sort((a,b)=>b-a),
  [4060,3840],'each half budget is 1,200 plus 220 tokens per review record in that half (13 and 12 claims)');
 assert.equal(result.trace.reviewRetry,undefined,'a completed review is not retried');
});

test('a repeated top-level parts key suppresses the sole unvalidated part after JSON parsing drops its decision',async()=>{
 const duplicate='{"parts":[{"partId":"P1","status":"answered"}],"claims":[],'+
  '"status":"answered","parts":[{"partId":"P2","status":"answered"}]}';
 const ai=makeAI([answer('PART P1\nHume links necessity to custom and regular conjunction. [S1]'),
  {response:duplicate}]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],
  {plan:onePartPlan,catalog,trace:true});
 assert.equal(result.outcome,'generation-failed');
 assert.equal(result.coverage,'none');
 assert.equal(result.reviewStatus,'review-contract-incomplete');
 assert.equal(result.answer,'I could not complete a reliable answer this time. Please try again.');
 assert.ok(result.trace.reviewContract.issues.includes('unknown-part'));
 assert.ok(result.trace.reviewContract.issues.includes('missing-part-decision'));
 assert.equal(ai.calls.length,2);
});

test('flat reviewer decisions retain exact provenance and source-encoded spans',async()=>{
 const source={...hume,title:'An Enquiry Concerning Human Understanding — David Hume (edited by Walter Editor)',
  text:"EDITOR'S INTRODUCTION\n"+hume.text};
 let composePayload,reviewPayload;
 const ai={run:async(_model,{messages})=>{
  if(messages[0].content.startsWith('Answer the reader')){
   composePayload=parsePayload(messages);
   return answer('PART P1\nHume says necessity arises from custom after repeated conjunction. [S1]');
  }
  reviewPayload=parsePayload(messages);
  const claim=reviewPayload.claims[0];
  return {response:'```json\n'+JSON.stringify({parts:[{partId:'P1',status:'answered',directAnswerClaimIds:[claim.claimId]}],
   claims:[{claimId:claim.claimId,status:'answered',spanIds:['S1-Q1'],sources:[{
    sourceId:'S1',status:'answered',spanIds:['S1-Q1'],subjectAttributionStatus:'supported',
    attributedSubject:'Hume'}],clauses:[{
    text:claim.text,status:'answered',issueCode:'none',sources:[{sourceId:'S1',
     status:'answered',spanIds:['S1-Q1'],subjectAttributionStatus:'supported',
     attributedSubject:'Hume'}]}]}]})+'\n```'};
 }};
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[source],ai,[],{
  plan:{...onePartPlan,sources:[{label:'Hume commentary',role:'commentary',bookIds:['35']}]},catalog,trace:true});
 assert.equal(result.coverage,'full');
 assert.equal(reviewPayload.claims[0].claimId,'P1-C1');
 assert.equal(reviewPayload.claims[0].text,'Hume says necessity arises from custom after repeated conjunction.');
 assert.deepEqual(reviewPayload.claims[0].sourceIds,['S1']);
 assert.equal('answers' in reviewPayload.parts[0],false);
 assert.deepEqual(composePayload.evidence[0].provenance,{work:'An Enquiry Concerning Human Understanding',
  creditedAuthors:['David Hume'],creditedEditors:['Walter Editor'],creditedTranslators:[],plannerSourceRole:'commentary',
  pageSectionHint:'introduction',pageVoiceHint:'editor-authored section',
  roleMeaning:'The planner role describes intended source selection, not the voice or genre of this individual page.'});
 assert.deepEqual(reviewPayload.parts[0].evidence[0].provenance,composePayload.evidence[0].provenance);
 assert.deepEqual(result.trace.reviewContract.recovered,[]);
 assert.match(REVIEW_PROMPT,/A source citation is not proof by itself/i);
 assert.match(REVIEW_PROMPT,/do not transfer a statement or action from another or unidentified person/i);
 assert.match(REVIEW_PROMPT,/attributionStatus/);
 assert.match(REVIEW_PROMPT,/Check attribution/);
});

test('a fenced reviewer object with the observed stray closing tail parses but still requires every cited source span',async()=>{
 const sources=[{...hume,id:'S4',title:'Forgotten Truth — Huston Smith',text:'In Buddhism it is nirvana and sunyata (emptiness, a void).',
   preview:'In Buddhism it is nirvana and sunyata (emptiness, a void).'},
  {...hume,id:'S5',title:'Forgotten Truth — Huston Smith',text:'182 / INDEX\nvoid (sunyata), 66; Zen, 48; emptiness, 193',
   preview:'182 / INDEX\nvoid (sunyata), 66; Zen, 48; emptiness, 193'}];
 const ai=makeAI([answer('PART P1\nSunyata means emptiness or a void in Buddhism [S4, S5].'),
  (_model,{messages})=>{
   const payload=parsePayload(messages),part=payload.parts[0],claim=payload.claims[0];
   return {response:'```json\n'+JSON.stringify({parts:[{partId:'P1',status:'answered'}],
    claims:[{claimId:claim.claimId,status:'answered',spanIds:['S4-Q1']}]})+' ]}\n```'};
  }]);
 const plan={...onePartPlan,sources:[{label:'Huston Smith',role:'primary',bookIds:['35']}],parts:[
  {...onePartPlan.parts[0],question:'What is sunyata?',candidateSourceIds:['S4','S5']} ]};
 const result=await composeEvidenceAnswer('What is sunyata?',sources,ai,[],{plan,catalog,trace:true});
 assert.equal(result.outcome,'insufficient-evidence');
 assert.equal(result.reviewStatus,'claim-review');
 assert.equal(result.coverage,'none');
 assert.doesNotMatch(result.answer,/\[S4, S5\]/);
 assert.ok(result.trace.reviewContract.valid);
 assert.ok(result.trace.reviewContract.supportIssues.some(issue=>issue.reason==='missing-claim-source-span'));
 assert.equal(result.evidenceMap.some(item=>item.id==='S5'),false);
});

test('compose-only uses one call and never labels the unreviewed answer as fully verified',async()=>{
 const ai=makeAI([answer('PART P1\nHume links necessity to custom and regular conjunction. [S1]')]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],
  {plan:onePartPlan,catalog,review:false});
 assert.equal(ai.calls.length,1);
 assert.equal(result.outcome,'unverified-source-draft');
 assert.equal(result.reviewStatus,'answer-draft-unverified');
 assert.equal(result.coverage,'partial');
});

test('final citation records carry provenance for the browser and saved evaluator artifact',async()=>{
 const title='Fear and Trembling — Søren Kierkegaard';
 const source={...hume,bookId:'140',title,page:32};
 const plan={...onePartPlan,sources:[{label:'Kierkegaard',role:'primary',bookIds:['140']}]};
 const ai=makeAI([answer('PART P1\nThe passage presents a difficult account of faith. [S1]')]);
 const result=await composeEvidenceAnswer('What does Kierkegaard say about faith?',[source],ai,[],
  {plan,catalog:{...catalog,140:title},review:false});
 assert.equal(result.citations[0].provenance.workVoice.name,'Johannes de Silentio');
 assert.equal(result.citations[0].provenance.creditedAuthors[0],'Søren Kierkegaard');
 assert.equal('text' in result.citations[0],false,'full verified page text never enters public citation metadata');
});

test('comparison cannot receive full coverage unless both named source groups are cited',async()=>{
 const linkedSources=[{...hume,candidatePartIds:['P1']},{...kant,candidatePartIds:['P2']}];
 const ai=makeAI([answer('PART P1\nHume grounds necessity in custom after repeated conjunction. [S1]\n'+
  'PART P2\nKant treats causal order as a priori. [S2]\n'+
  'PART P3\nHume grounds necessity in custom after repeated conjunction, whereas Kant treats causal order as a priori. [S1]'),
  review([['P1','answered'],['P2','answered'],['P3','answered']]),
  review([['P1','answered'],['P2','answered'],['P3','answered']]),
  review([['P1','answered'],['P2','answered'],['P3','answered']])]);
 const result=await composeEvidenceAnswer('How do Hume and Kant differ?',linkedSources,ai,[],{plan:twoSidePlan,catalog});
 assert.equal(result.coverage,'partial');
 assert.equal(result.questionParts[2].status,'partial');
});

test('a comparison with cited evidence from both named source groups may be reviewed as complete',async()=>{
 const linkedSources=[{...hume,candidatePartIds:['P1']},{...kant,candidatePartIds:['P2']}];
 const ai=makeAI([answer('PART P1\nHume grounds necessity in custom after repeated conjunction. [S1]\n'+
  'PART P2\nKant treats causal order as a priori. [S2]\n'+
  'PART P3\nHume grounds necessity in custom after repeated conjunction, whereas Kant treats causal order as a priori. [S1, S2]'),
  review([['P1','answered'],['P2','answered'],['P3','answered']]),
  review([['P1','answered'],['P2','answered'],['P3','answered']]),
  review([['P1','answered'],['P2','answered'],['P3','answered']])]);
 const result=await composeEvidenceAnswer('How do Hume and Kant differ?',linkedSources,ai,[],{plan:twoSidePlan,catalog});
 assert.equal(result.coverage,'full');
 assert.equal(result.questionParts[0].status,'supported');
 const reviewPayload=ai.calls.map(call=>parsePayload(call.request.messages))
  .find(payload=>Array.isArray(payload.claims)&&payload.parts?.[0]?.partId==='P3');
 assert.deepEqual(reviewPayload.claims.find(claim=>claim.partId==='P3').sourceIds,['S1','S2']);
 assert.deepEqual([...new Set(result.evidenceMap.filter(item=>item.partId==='P3').map(item=>item.id))],['S1','S2']);
});

test('a one-part uncited answer without its heading is recovered and sent to review',async()=>{
 const ai=makeAI([answer('The answer omitted all planned part headings and citations.'),
  review([['P1','unanswered']])]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],
  {plan:onePartPlan,catalog,trace:true});
 assert.equal(ai.calls.length,2);
 assert.equal(result.outcome,'insufficient-evidence');
 assert.equal(result.coverage,'none');
 assert.equal(result.citations.length,0);
 assert.equal(result.failureCode,undefined);
 assert.equal(result.trace.recovery.code,'missing-part-heading');
});

test('a composer response truncated by the model is not reviewed or shown as complete',async()=>{
 // Batch 6 (B6-4): a truncated compose earns one retry; a second
 // truncation fails with the original code, exactly as the first did.
 const truncated={choices:[{finish_reason:'length',message:{content:
  'PART P1\nThe simulation hypothesis is a possibility because'}}]};
 const ai=makeAI([truncated,truncated]);
 const result=await composeEvidenceAnswer('Are we living in a simulation?',[],ai,[],{
  plan:{...onePartPlan,parts:[{...onePartPlan.parts[0],question:'Are we living in a simulation?'}]},catalog,trace:true
 });
 assert.equal(ai.calls.length,2,'the initial compose and its one retry');
 assert.deepEqual(result.trace.composeRetry,
  {attempted:true,reason:'answer-output-truncated',applied:false});
 assert.equal(result.outcome,'generation-failed');
 assert.equal(result.failureCode,'answer-output-truncated');
 assert.equal(result.answer,'I could not complete a reliable answer this time. Please try again.');
});

test('an answer ending with an unfinished lead-in is not presented as complete',async()=>{
 const ai=makeAI([answer('PART P1\nThe hypothesis is possible, but no evidence establishes it. A full answer would compare two possibilities:'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('Are we living in a simulation?',[],ai,[],{
  plan:{...onePartPlan,parts:[{...onePartPlan.parts[0],question:'Are we living in a simulation?'}]},catalog,trace:true
 });
 assert.equal(result.outcome,'generation-failed');
 assert.equal(result.failureCode,'answer-incomplete-ending');
 assert.equal(result.coverage,'none');
 assert.equal(result.citations.length,0);
 assert.equal(result.trace.final.failure.code,'answer-incomplete-ending');
});

test('an empty promised list is marked incomplete without adding a model call',async()=>{
 const question='How can justice and mercy come into conflict?';
 const title='Justice and Mercy';
 const source={id:'S1',bookId:'72',title,page:1,
  text:'A just decision applies a rule, while a merciful response may temper its consequence with compassion.',
  preview:'A just decision applies a rule, while a merciful response may temper its consequence with compassion.'};
 const plan={...onePartPlan,sources:[{label:title,role:'primary',bookIds:['72']}],
  parts:[{...onePartPlan.parts[0],question,sourceBookIds:['72'],candidateSourceIds:['S1']}]};
 const ai=makeAI([answer('PART P1\nJustice and mercy can conflict in several specific ways: [S1]\n\n'+
  'Even when both values matter, a strict consequence can leave little room for compassion.'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer(question,[source],ai,[],{plan,catalog:{...catalog,72:title},trace:true});
 assert.equal(ai.calls.length,2,'the final completeness guard reuses compose and review only');
 assert.equal(result.questionParts[0].answerStatus,'partial');
 assert.equal(result.answerCompleteness,'partial');
 assert.equal(result.trace.reviewContract.partDecisions[0].outputAnswerStatus,'partial');
});

test('a supplied list and ordinary explanatory colon are not treated as empty lists',async()=>{
 const question='How can justice and mercy come into conflict?';
 const title='Justice and Mercy';
 const source={id:'S1',bookId:'72',title,page:1,
  text:'A just decision applies a rule, while a merciful response may temper its consequence with compassion.',
  preview:'A just decision applies a rule, while a merciful response may temper its consequence with compassion.'};
 const plan={...onePartPlan,sources:[{label:title,role:'primary',bookIds:['72']}],
  parts:[{...onePartPlan.parts[0],question,sourceBookIds:['72'],candidateSourceIds:['S1']}]};
 for(const prose of [
  'Justice and mercy can conflict in several specific ways: [S1]\n- A strict consequence may leave little room for compassion. [S1]\n- Forgiveness may seem unfair to someone who was harmed.',
  'A helpful distinction is this: [S1]\n\nJustice applies a standard, while mercy responds to a person’s circumstances. [S1]'
 ]){
  const ai=makeAI([answer('PART P1\n'+prose),review([['P1','answered']])]);
  const result=await composeEvidenceAnswer(question,[source],ai,[],{plan,catalog:{...catalog,72:title},trace:true});
  assert.equal(result.answerCompleteness,'full',prose);
  assert.equal(ai.calls.length,2);
 }
});

test('explicit evidence refusals become structured insufficient evidence without a retry',async()=>{
 for(const refusal of [
  'The supplied passages do not address the question about whether reality is simulated.',
  'The provided text does not contain information regarding whether we are living in a simulation.',
  'The provided documents do not contain information regarding whether we are living in a simulation.'
 ]){
  const ai=makeAI([answer('PART P1\n\n'+refusal)]);
  const result=await composeEvidenceAnswer('Are we living in a simulation?',[],ai,[],{
   plan:{...onePartPlan,parts:[{...onePartPlan.parts[0],question:'Are we living in a simulation?'}]},
   catalog,trace:true
  });
  assert.equal(ai.calls.length,1);
  assert.equal(result.outcome,'insufficient-evidence');
  assert.equal(result.coverage,'none');
  assert.equal(result.failureCode,undefined);
  assert.ok(result.trace.coverageGaps.some(item=>
   item.reason==='model-reported-insufficient-evidence'));
 }
});
test('an explicitly empty planned answer is reported as insufficient evidence, not a format failure',async()=>{
 const ai=makeAI([answer('PART P1')]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[],ai,[],
  {plan:onePartPlan,catalog});
 assert.equal(result.outcome,'insufficient-evidence');
 assert.equal(result.coverage,'none');
 assert.equal(result.failureCode,undefined);
});

test('legacy claim and evidence markers can be reduced to a cited per-part answer without regeneration',async()=>{
 const ai=makeAI([answer('PART P1 answered\nCLAIM C1 | P1 | direct\n'+
  'Hume says necessity arises from regular conjunction and the mind’s habitual inference.\n'+
  'EVIDENCE S1 | P1 | direct\nA verified source span that is not included in the answer text.\n'+
  'END EVIDENCE\nEND CLAIM\nEND PART'),review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],
  {plan:onePartPlan,catalog,trace:true});
 assert.equal(ai.calls.length,2);
 assert.equal(result.coverage,'full');
 assert.match(result.answer,/habitual inference\. \[S1\]/);
 assert.equal(result.trace.recovery.code,'legacy-record-format');
});

test('sentence-level citations stay with their claims through quote validation and final assembly',async()=>{
 const ai=makeAI([answer('PART P1\nThe source says “mind is determined by custom” [S1]. Repetition shapes the inference. [S1]'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],
  {plan:onePartPlan,catalog,trace:true});
 assert.equal(result.outcome,'verified-source-draft');
 assert.equal(result.coverage,'full');
 assert.deepEqual(result.trace.rejected,[]);
 assert.match(result.answer,/“mind is determined by custom” \[S1\]\. Repetition shapes the inference\. \[S1\]$/);
 assert.equal((result.answer.match(/\[S1\]/g)||[]).length,2);
 assert.equal(auditFinalAnswer(result.answer,[hume]).ok,true);
});

test('repeated citation IDs remain valid when a later sentence uses the same source',async()=>{
 const ai=makeAI([answer('PART P1\nHume grounds necessity in habit [S1] after repeated conjunction. [S1]'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],
  {plan:onePartPlan,catalog,trace:true});
 assert.equal((result.answer.match(/\[S1\]/g)||[]).length,2);
 assert.equal(result.trace.stages[0].stage,'compose');
});

test('verse-restricted answers expose the requested verses as evidence and retain the rest only as context',async()=>{
 const source={...hume,scopeText:'Within the requested range, love is from God and believers should love one another.'};
 const plan={...onePartPlan,scope:'1 John 4:7-12'};
 const ai=makeAI([answer('PART P1\nThe passage grounds mutual love in love from God. [S1]'),
  review([['P1','answered']],{evidenceByPart:{P1:[{sourceId:'S1',
   spanIds:['S1-Q1']}]}})]);
 await composeEvidenceAnswer('According to 1 John 4:7-12, what does love mean?',[source],ai,[],
  {plan,catalog,trace:true});
 const composePayload=JSON.parse(ai.calls[0].request.messages[1].content);
 const reviewPayload=parsePayload(ai.calls[1].request.messages);
 assert.equal(composePayload.evidence[0].text,source.scopeText);
 assert.equal(composePayload.evidence[0].contextText,source.text);
 assert.equal(reviewPayload.parts[0].evidence[0].spans[0].text,source.scopeText);
 assert.equal(reviewPayload.parts[0].evidence[0].spans[0].spanId,'S1-Q1');
 assert.equal(reviewPayload.parts[0].evidence[0].contextText,source.text);
});

test('review source context stays bounded around scoped evidence while exact spans remain intact',async()=>{
 const scopeText='The selected passage states that love is from God and believers should love one another.';
 const source={...hume,text:'PAGE-HEADER '+('A'.repeat(1400))+'\n'+scopeText+'\n'+('B'.repeat(1400)),scopeText};
 let reviewPayload;
 const ai=makeAI([answer('PART P1\nThe passage grounds mutual love in love from God. [S1]'),
  (_model,{messages})=>{
   reviewPayload=parsePayload(messages);
   const claim=reviewPayload.claims[0],span=reviewPayload.spanCatalog[0];
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered'}],claims:[{
    claimId:claim.claimId,status:'answered',sources:[{sourceId:'S1',status:'answered',spanIds:[span.spanId]}]}]})};
  }]);
 await composeEvidenceAnswer('According to the selected passage, why should believers love one another?',
  [source],ai,[],{plan:onePartPlan,catalog,trace:true});
 const context=reviewPayload.sourceContexts[0].text;
 assert.ok(context.length<=800);
 assert.match(context,/PAGE-HEADER/,'page header attribution context is retained');
 assert.match(context,/A{100,}/);
 assert.match(context,/B{100,}/);
 assert.equal(reviewPayload.parts[0].evidence[0].spans[0].text,scopeText,
  'the exact selected passage remains available for support decisions');
});


test('review guidance checks the requested reasoning operation, not just a related principle',()=>{
 assert.match(REVIEW_PROMPT,/kind of response it requests/);
 assert.match(REVIEW_PROMPT,/reasoning or mechanism rather than merely stating a related rule or conclusion/);
 assert.match(REVIEW_PROMPT,/Check every explicit demand within the part; if any substantive demand is missing, mark answerStatus partial/);
 assert.match(REVIEW_PROMPT,/A blank heading, transition, or corpus-gap statement alone is not an answer/);
});

// --- Batch 4: claim-level citation check, assembly audit, author anchoring.
// All fixtures below are invented for these tests.

const batch4Catalog={501:'The Salt Meridian — Ines Vidal',502:'Wintering Geese — Aaron Feld'};
const vidalSalt={id:'S1',bookId:'501',title:batch4Catalog[501],page:12,
 url:'https://example.test/salt-meridian#page=12',
 text:'I crossed the salt flats in my nineteenth year, carrying my father’s survey chain and a tin of well water. I learned that a horizon can recede exactly as fast as a walker advances toward it.',
 preview:'I crossed the salt flats in my nineteenth year.'};
const feldGeese={id:'S2',bookId:'502',title:batch4Catalog[502],page:30,
 url:'https://example.test/wintering-geese#page=30',
 text:'Geese read the stars on clear nights and hold their course by the brightest patterns. A flock that loses the pattern circles until the sky clears.',
 preview:'Geese read the stars on clear nights.'};
const vidalPlan={version:'reader-evidence-v2',intent:'explain',
 sources:[{label:'Ines Vidal',role:'primary',bookIds:['501']}],
 parts:[{id:'P1',question:'What does Vidal describe learning from crossing the salt flats?',
   sourceBookIds:['501'],searchQueries:['salt flats horizon'],candidateSourceIds:['S1']}],
 queries:['salt flats horizon']};
const twoBookPlan={version:'reader-evidence-v2',intent:'explain',
 sources:[{label:'Ines Vidal',role:'primary',bookIds:['501']},
  {label:'Aaron Feld',role:'primary',bookIds:['502']}],
 parts:[{id:'P1',question:'What do Vidal and Feld each describe about finding direction?',
   sourceBookIds:['501','502'],searchQueries:['direction horizon stars'],
   candidateSourceIds:['S1','S2']}],queries:['direction horizon stars']};
function attributedReview(speaker,{sourceId='S1'}={}){
 return (_model,{messages})=>{
  const payload=parsePayload(messages),claim=payload.claims[0];
  const spanId=claim.sourceEvidence.find(item=>item.sourceId===sourceId).spanIds[0];
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
   directAnswerClaimIds:[claim.claimId]}],claims:[{claimId:claim.claimId,status:'answered',
   sources:[{sourceId,status:'answered',spanIds:[spanId],
    attributionStatus:'supported',attributedSpeaker:speaker}]}]})};
 };
}

test('author narration needs no speech cue when the speaker is the work’s own author',async()=>{
 const ai=makeAI([answer('PART P1\nInes Vidal describes learning that a horizon recedes exactly as fast as a walker advances toward it. [S1]'),
  attributedReview('Ines Vidal')]);
 const result=await composeEvidenceAnswer('What does Vidal describe learning from crossing the salt flats?',
  [vidalSalt],ai,[],{plan:vidalPlan,catalog:batch4Catalog,trace:true});
 assert.equal(ai.calls.length,2,'no gate or audit repair runs for a clean cited answer');
 assert.equal(result.coverage,'full');
 assert.equal(result.answerCompleteness,'full');
 assert.match(result.answer,/Ines Vidal describes learning/);
 assert.ok(!result.trace.reviewContract.supportIssues.some(issue=>
  issue.reason==='source-attribution-unanchored'),
  'the author’s own narration is anchored by the byline');
 assert.equal(result.trace.claimCitationGate,undefined);
 assert.deepEqual(result.trace.assemblyAudit,{violations:[],action:'none'});
});

test('a third-party speaker still needs a speech cue in the source',async()=>{
 const ai=makeAI([answer('PART P1\nPetra Lindqvist describes the crossing of the salt flats as a lesson in patience. [S1]'),
  attributedReview('Petra Lindqvist')]);
 const result=await composeEvidenceAnswer('What does Vidal describe learning from crossing the salt flats?',
  [vidalSalt],ai,[],{plan:vidalPlan,catalog:batch4Catalog,trace:true});
 assert.equal(ai.calls.length,3,'compose, review, and the batch 24 rescue (which cannot anchor the claim either)');
 assert.equal(result.coverage,'none','an unanchored third-party attribution cannot verify the claim');
 assert.ok(result.trace.reviewContract.supportIssues.some(issue=>
  issue.sourceId==='S1'&&issue.reason==='source-attribution-unanchored'));
 assert.doesNotMatch(result.answer,/Petra Lindqvist describes/);
});

test('matching a different work’s author does not anchor spans from another work',async()=>{
 const ai=makeAI([answer('PART P1\nInes Vidal describes how geese hold their course by the brightest star patterns. [S2]'),
  attributedReview('Ines Vidal',{sourceId:'S2'})]);
 const result=await composeEvidenceAnswer('What do Vidal and Feld each describe about finding direction?',
  [vidalSalt,feldGeese],ai,[],{plan:twoBookPlan,catalog:batch4Catalog,trace:true});
 assert.equal(ai.calls.length,3,'compose, review, and the batch 24 rescue (which cannot anchor the claim either)');
 assert.equal(result.coverage,'none',
  'the exemption is per source: Vidal does not author the geese passage');
 assert.ok(result.trace.reviewContract.supportIssues.some(issue=>
  issue.sourceId==='S2'&&issue.reason==='source-attribution-unanchored'));
});

test('author anchoring matches only the byline author of the same work',()=>{
 assert.equal(speakerIsWorkAuthor('Ines Vidal',{title:'The Salt Meridian — Ines Vidal'}),true);
 assert.equal(speakerIsWorkAuthor('Vidal',{title:'The Salt Meridian — Ines Vidal'}),true,
  'surname-only attribution matches the byline surname');
 assert.equal(speakerIsWorkAuthor('Petra Lindqvist',{title:'The Salt Meridian — Ines Vidal'}),false);
 assert.equal(speakerIsWorkAuthor('Ines Vidal',{title:'Wintering Geese — Aaron Feld'}),false,
  'the same name does not match a different work’s byline');
 assert.equal(speakerIsWorkAuthor('Tomas Vidal',{title:'The Salt Meridian — Ines Vidal'}),false,
  'two full names that merely share a surname do not match');
 assert.equal(speakerIsWorkAuthor('',{title:'The Salt Meridian — Ines Vidal'}),false);
});

test('removing uncited claims filters their evidence and downgrades only an emptied part',()=>{
 const item={answers:[{claimId:'P1-C1'},{claimId:'P1-C2'}],
  evidence:[{claimId:'P1-C1'},{claimId:'P1-C2'}],status:'answered',answerStatus:'answered'};
 assert.deepEqual(removeClaimsFromPart(item,['P1-C1']),{removedCount:1,downgraded:false});
 assert.deepEqual(item.answers.map(answer=>answer.claimId),['P1-C2']);
 assert.deepEqual(item.evidence.map(entry=>entry.claimId),['P1-C2']);
 assert.equal(item.status,'answered','a part with remaining claim text keeps its status');
 assert.deepEqual(removeClaimsFromPart(item,['P1-C2']),{removedCount:1,downgraded:true});
 assert.equal(item.status,'partial');
 assert.equal(item.answerStatus,'partial');
});

test('a general-context claim ships uncited and untouched beside a cited claim',async()=>{
 const ai=makeAI([answer('PART P1\nInes Vidal describes learning that a horizon recedes exactly as fast as a walker advances toward it. [S1]\n'+
   'Crossing open country on foot teaches patience in a way that maps never can.'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('What does Vidal describe learning from crossing the salt flats?',
  [vidalSalt],ai,[],{plan:vidalPlan,catalog:batch4Catalog,trace:true});
 assert.equal(ai.calls.length,2,'the claim-level check makes no calls for exempt claims');
 assert.equal(result.trace.claimCitationGate,undefined);
 assert.equal(result.trace.citationGate,undefined);
 assert.deepEqual(result.trace.assemblyAudit,{violations:[],action:'none'});
 assert.equal(result.answerCompleteness,'full');
 assert.match(result.answer,/teaches patience in a way that maps never can/);
 assert.match(result.answer,/\[S1\]/);
});

test('assembly ending check flags bare headings and unclosed list items only',()=>{
 assert.equal(hasAssemblyEndingViolation('The answer is complete.'),false);
 assert.equal(hasAssemblyEndingViolation(
  'Findings:\n\n- Geese hold their course by the brightest patterns.'),false,
  'a complete final list item is not an unclosed one');
 assert.equal(hasAssemblyEndingViolation('The answer ends here:\n\n**Origins**'),true,
  'a final line that is only a label promises content that never arrives');
 assert.equal(hasAssemblyEndingViolation('Points:\n- Geese read the stars\n- Geese hold'),true,
  'a short final list item with no terminal punctuation is unclosed');
 assert.equal(hasAssemblyEndingViolation('Points:\n- Navigation depends on'),true,
  'a final list item trailing off on a function word is unclosed');
 assert.equal(hasAssemblyEndingViolation('The routes differ in several ways, including'),true);
});

const droppedClaimDraft='PART P1\nInes Vidal describes learning that a horizon recedes exactly as fast as a walker advances toward it. [S1]\n\n'+
 '- **Field note: Feld writes that geese hold their course by the brightest star patterns [S2]';

test('assembly audit repairs an accepted claim that assembly silently dropped',async()=>{
 const restoreRepair={response:JSON.stringify({parts:[{partId:'P1',
  replacements:[{claimId:'P1-C2',text:'Feld writes that geese hold their course by the brightest star patterns. [S2]'}],
  additions:[]}]})};
 const ai=makeAI([answer(droppedClaimDraft),
  review([['P1','answered']],{directAnswerClaimIdsByPart:{P1:['P1-C1','P1-C2']}}),
  restoreRepair,review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('What do Vidal and Feld each describe about finding direction?',
  [vidalSalt,feldGeese],ai,[],{plan:twoBookPlan,catalog:batch4Catalog,trace:true});
 assert.equal(ai.calls.length,4,'compose, review, one audit repair, and its re-review');
 assert.deepEqual(result.trace.assemblyAudit.violations,
  [{partId:'P1',claimId:'P1-C2',type:'accepted-claim-not-represented'}]);
 assert.equal(result.trace.assemblyAudit.action,'repair-applied');
 assert.match(result.answer,/brightest star patterns\. \[S2\]/,
  'the dropped claim is restored with its citation');
 assert.equal(result.answerCompleteness,'full');
});

test('assembly audit downgrades when a dropped accepted claim cannot be repaired',async()=>{
 const ai=makeAI([answer(droppedClaimDraft),
  review([['P1','answered']],{directAnswerClaimIdsByPart:{P1:['P1-C1','P1-C2']}})]);
 const result=await composeEvidenceAnswer('What do Vidal and Feld each describe about finding direction?',
  [vidalSalt,feldGeese],ai,[],{plan:twoBookPlan,catalog:batch4Catalog,trace:true});
 assert.equal(ai.calls.length,3,'compose, review, and the single failed audit repair attempt');
 assert.equal(result.trace.assemblyAudit.action,'downgraded');
 assert.equal(result.trace.assemblyAudit.violations.length,1);
 assert.equal(result.answerCompleteness,'partial',
  'completeness is reported honestly instead of full over a known gap');
 assert.equal(result.questionParts[0].answerStatus,'partial');
 assert.match(result.answer,/horizon recedes/, 'the surviving claim still ships');
});

test('assembly audit downgrades an answer ending on a bare heading instead of shipping it as full',async()=>{
 const ai=makeAI([answer('PART P1\nInes Vidal describes learning that a horizon recedes exactly as fast as a walker advances toward it. [S1]\n\n**Crossing**'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('What does Vidal describe learning from crossing the salt flats?',
  [vidalSalt],ai,[],{plan:vidalPlan,catalog:batch4Catalog,trace:true});
 assert.equal(ai.calls.length,3,'compose, review, and the single failed audit repair attempt');
 assert.deepEqual(result.trace.assemblyAudit,
  {violations:[{partId:'P1',type:'unfinished-ending'}],action:'downgraded'});
 assert.notEqual(result.outcome,'generation-failed',
  'a heading-only ending is a completeness gap, not a total failure');
 assert.equal(result.answerCompleteness,'partial');
 assert.match(result.answer,/horizon recedes/);
});

test('assembly audit repair can complete an unfinished lead-in ending',async()=>{
 const completeRepair=(_model,{messages})=>{
  const payload=parsePayload(messages);
  const part=payload.parts[0];
  const replacements=part.repair.replaceClaimIds.map(claimId=>{
   const claim=part.claims.find(item=>item.claimId===claimId);
   const text=claim?.text.startsWith('A full answer')?
    'A full answer would compare two possibilities: a simulated world and a physical one.':
    'The hypothesis is possible, but no evidence establishes it, and a full answer would compare two possibilities: a simulated world and a physical one.';
   return {claimId,text};
  });
  return {response:JSON.stringify({parts:[{partId:'P1',replacements,additions:[]}]})};
 };
 const ai=makeAI([answer('PART P1\nThe hypothesis is possible, but no evidence establishes it. A full answer would compare two possibilities:'),
  review([['P1','answered']]),completeRepair,review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('Are we living in a simulation?',[],ai,[],{
  plan:{...onePartPlan,parts:[{...onePartPlan.parts[0],question:'Are we living in a simulation?'}]},
  catalog,trace:true});
 assert.equal(ai.calls.length,4,'compose, review, one audit repair, and its re-review');
 // Batch 6 (B6-5): the same colon ending is also a dangling list
 // introduction; the one repair resolves both violations.
 assert.deepEqual(result.trace.assemblyAudit,
  {violations:[{partId:'P1',type:'dangling-list-introduction'},
    {partId:'P1',type:'unfinished-ending'}],action:'repair-applied'});
 assert.notEqual(result.outcome,'generation-failed',
  'a repaired ending ships instead of being discarded by the legacy check');
 assert.equal(result.failureCode,undefined);
 assert.match(result.answer,/a simulated world and a physical one\./);
 // The part itself stays partial for a pre-existing contract reason that
 // predates the audit: an uncited claim can be retained context but never
 // a direct-answer claim, so this source-less part was already partial at
 // review time. The audit's win is the completed ending, not the status.
 assert.equal(result.questionParts[0].answerStatus,'partial');
});

// --- Batch 5: Q1 claim linkage, A1 second look, R1 synthesis review,
// C assembly seams + representation hardening, B speaker-cue scoping,
// D closing synthesis, L2/L3/L4/L6 latency-and-repair mechanics.
// Batch 6 updates in this section: B6-1 second-look coverage standard
// and furniture exclusion, B6-3 R1 removal, B6-4 compose retry,
// B6-5 seam taxonomy round 2.
// All fixtures below are invented for these tests.

test('batch 6 prompt state: R1 synthesis guidance removed, allowances and closing synthesis kept (B6-3)',()=>{
 assert.doesNotMatch(REVIEW_PROMPT,/synthesisCoverage/);
 assert.doesNotMatch(REVIEW_PROMPT,/contextClaimLinks/);
 assert.doesNotMatch(REVIEW_PROMPT,/linkedEvidence/);
 assert.match(REVIEW_PROMPT,/independent background and synthesis may remain uncited/,
  'the general-knowledge allowance language is unchanged');
 assert.match(COMPOSER_PROMPT,/Close each part with one sentence stating what the part established/);
 assert.match(COMPOSER_PROMPT,/make that closing sentence the decisive contrast/);
});

test('question parts report the shipped claim IDs for highlight linkage (Q1)',async()=>{
 const ai=makeAI([answer('PART P1\nInes Vidal describes learning that a horizon recedes exactly as fast as a walker advances toward it. [S1]'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('What does Vidal describe learning from crossing the salt flats?',
  [vidalSalt],ai,[],{plan:vidalPlan,catalog:batch4Catalog,trace:true});
 assert.equal(result.questionParts[0].partId,'P1');
 assert.deepEqual(result.questionParts[0].claimIds,['P1-C1']);
});

test('context-claim second look cites a retained claim that verifiably paraphrases a linked source (A1)',async()=>{
 const ai=makeAI([answer('PART P1\nInes Vidal describes learning that a horizon recedes exactly as fast as a walker advances toward it. [S1]\n'+
   'Vidal crossed the salt flats in her nineteenth year, carrying her father’s survey chain and a tin of well water.\n'+
   'Crossing open country on foot teaches patience in a way that maps never can.'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('What does Vidal describe learning from crossing the salt flats?',
  [vidalSalt],ai,[],{plan:vidalPlan,catalog:batch4Catalog,trace:true});
 assert.equal(ai.calls.length,2,'the second look is deterministic and makes no model call');
 assert.equal(result.trace.contextSecondLook.length,1);
 assert.equal(result.trace.contextSecondLook[0].partId,'P1');
 assert.equal(result.trace.contextSecondLook[0].claimId,'P1-C2');
 assert.deepEqual(result.trace.contextSecondLook[0].sourceIds,['S1']);
 assert.equal(result.trace.contextSecondLook[0].coverageRatio,0.917,
  'batch 6 (B6-1): the trace records the union coverage ratio per attachment');
 assert.match(result.answer,/survey chain and a tin of well water\. \[S1\]/,
  'the passing claim ships with its citation attached');
 assert.ok(result.evidenceMap.some(item=>item.claimId==='P1-C2'),
  'the second-look claim joins the evidence map');
 assert.ok(!result.evidenceMap.some(item=>item.claimId==='P1-C3'),
  'a claim that fails the overlap standard stays uncited');
 assert.doesNotMatch(result.answer,/maps never can\. \[S1\]/,
  'the general-knowledge allowance is intact for the failing claim');
});

test('second look no longer attaches a one-leg synthesis claim (B6-1)',async()=>{
 const ai=makeAI([answer('PART P1\nInes Vidal describes learning that a horizon recedes exactly as fast as a walker advances toward it. [S1]\n'+
   'Vidal crossed the salt flats, and the crossing shows that distant empires decline when luxury corrupts their citizens.'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('What do Vidal and Feld each describe about finding direction?',
  [vidalSalt,feldGeese],ai,[],{plan:twoBookPlan,catalog:batch4Catalog,trace:true});
 // The salt-flats span shares three content terms with the claim, which
 // passed the old per-span bar; the claim's other leg (empires, luxury,
 // decline) is in no span, so the union covers 3 of 11 terms — under
 // the batch-6 half-coverage bar the claim honestly stays context.
 assert.equal(result.trace.contextSecondLook,undefined);
 assert.ok(!result.evidenceMap.some(item=>item.claimId==='P1-C2'));
 assert.doesNotMatch(result.answer,/corrupts their citizens\. \[S/);
 assert.match(result.answer,/corrupts their citizens\./,
  'the claim still ships, uncited, as retained context');
});

test('second look attaches both sources when together they cover a synthesis claim (B6-1)',async()=>{
 const ai=makeAI([answer('PART P1\nInes Vidal describes learning that a horizon recedes exactly as fast as a walker advances toward it. [S1]\n'+
   'Vidal learned that a horizon can recede as she advances, while the geese hold their course by the brightest star patterns.'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('What do Vidal and Feld each describe about finding direction?',
  [vidalSalt,feldGeese],ai,[],{plan:twoBookPlan,catalog:batch4Catalog,trace:true});
 assert.equal(result.trace.contextSecondLook.length,1);
 assert.equal(result.trace.contextSecondLook[0].claimId,'P1-C2');
 assert.deepEqual(result.trace.contextSecondLook[0].sourceIds,['S1','S2'],
  'neither side alone covers half the claim; the union of both does');
 assert.equal(result.trace.contextSecondLook[0].coverageRatio,0.833);
 assert.match(result.answer,/brightest star patterns\. \[S1, S2\]/);
});

test('second look treats a thrice-repeated sentence as page furniture (B6-1)',async()=>{
 const headerSentence='The meridian survey party recorded the salt flats crossings in a leather ledger bound with brass corners and kept beside the survey chain.';
 const furnitureSource={id:'S1',bookId:'501',title:batch4Catalog[501],page:12,
  url:'https://example.test/salt-meridian#page=12',
  text:['I learned that a horizon can recede exactly as fast as a walker advances toward it.',
   headerSentence,
   'The cook fed the mules at dusk and mended the torn canvas of the largest tent before the wind rose over the flats that night.',
   headerSentence,
   'A cold rain began near midnight and the guides argued quietly about the northern route until the fire burned down to ash.',
   headerSentence].join(' '),
  preview:'I learned that a horizon can recede.'};
 const ai=makeAI([answer('PART P1\nThe narrator learned that a horizon can recede exactly as fast as a walker advances toward it. [S1]\n'+
   'The survey party recorded the salt flats crossings in a leather ledger kept beside the chain.'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('What does Vidal describe learning from crossing the salt flats?',
  [furnitureSource],ai,[],{plan:vidalPlan,catalog:batch4Catalog,trace:true});
 // The repeated sentence is the only span covering the claim, and it
 // would have passed the old bar; as furniture it is ineligible, so
 // the claim stays uncited instead of citing a running header.
 assert.equal(result.trace.contextSecondLook,undefined);
 assert.ok(!result.evidenceMap.some(item=>item.claimId==='P1-C2'));
 assert.doesNotMatch(result.answer,/kept beside the chain\. \[S1\]/);
});

test('second look ignores spans too short to state a proposition (B6-1)',async()=>{
 const shortSpanSource={id:'S1',bookId:'501',title:batch4Catalog[501],page:12,
  url:'https://example.test/salt-meridian#page=12',
  text:'The well at the third station held sweet water through the driest month of the year, and the guides rationed it carefully among the mules and the survey party, filling each tin slowly so that none of the precious store would spill on the stones beside the trough. The flats gleam white.',
  preview:'The well at the third station held sweet water.'};
 const ai=makeAI([answer('PART P1\nThe well at the third station held sweet water through the driest month of the year. [S1]\n'+
   'The flats gleam white.'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('What does Vidal describe learning from crossing the salt flats?',
  [shortSpanSource],ai,[],{plan:vidalPlan,catalog:batch4Catalog,trace:true});
 // The 22-character fragment is the claim's only lexical match; under
 // the old bar it attached. A fragment that short is ineligible now.
 assert.equal(result.trace.contextSecondLook,undefined);
 assert.ok(!result.evidenceMap.some(item=>item.claimId==='P1-C2'));
 assert.doesNotMatch(result.answer,/gleam white\. \[S1\]/);
});

test('a malformed first compose is retried once and the retried draft ships (B6-4)',async()=>{
 const ai=makeAI([{},
  answer('PART P1\nInes Vidal describes learning that a horizon recedes exactly as fast as a walker advances toward it. [S1]'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('What does Vidal describe learning from crossing the salt flats?',
  [vidalSalt],ai,[],{plan:vidalPlan,catalog:batch4Catalog,trace:true});
 assert.equal(ai.calls.length,3,'two compose attempts and the review');
 assert.deepEqual(result.trace.composeRetry,
  {attempted:true,reason:'model-output-invalid-format',applied:true});
 assert.notEqual(result.outcome,'generation-failed');
 assert.match(result.answer,/Ines Vidal describes learning/);
});

test('a compose call that hits the inference deadline is retried once and ships (B6-4)',async()=>{
 const deadline=Object.assign(new Error('Inference deadline exceeded'),
  {stage:'compose',code:'inference-deadline-exceeded'});
 const ai=makeAI([deadline,
  answer('PART P1\nInes Vidal describes learning that a horizon recedes exactly as fast as a walker advances toward it. [S1]'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('What does Vidal describe learning from crossing the salt flats?',
  [vidalSalt],ai,[],{plan:vidalPlan,catalog:batch4Catalog,trace:true});
 assert.equal(ai.calls.length,3,'two compose attempts and the review');
 assert.deepEqual(result.trace.composeRetry,
  {attempted:true,reason:'inference-deadline-exceeded',applied:true});
 assert.notEqual(result.outcome,'generation-failed');
 assert.match(result.answer,/Ines Vidal describes learning/);
});

test('a healthy compose is called exactly once with no retry recorded (B6-4)',async()=>{
 const ai=makeAI([answer('PART P1\nInes Vidal describes learning that a horizon recedes exactly as fast as a walker advances toward it. [S1]'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('What does Vidal describe learning from crossing the salt flats?',
  [vidalSalt],ai,[],{plan:vidalPlan,catalog:batch4Catalog,trace:true});
 assert.equal(ai.calls.length,2,'one compose call and one review call');
 assert.equal(result.trace.composeRetry,undefined);
});

test('an uncited claim in a multi-source part is linked only by the deterministic second look (B6-3/B6-1)',async()=>{
 let packetPart;
 const linkingReview=(_model,{messages})=>{
  const payload=parsePayload(messages);
  packetPart=payload.parts[0];
  const claim=payload.claims[0];
  // The reviewer still offers a contextClaimLinks entry, as it could
  // under batch 5's R1. Batch 6 removed that mechanism: the entry must
  // change nothing, and only the deterministic second look may attach
  // a citation to the uncited paraphrase.
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',answerStatus:'answered',
    directAnswerClaimIds:[claim.claimId],retainedContextClaimIds:['P1-C2','P1-C3'],
    contextClaimLinks:[{claimId:'P1-C2',sourceId:'S2',spanIds:['S2-Q1']}]}],
   claims:[{claimId:claim.claimId,status:'answered',
    sources:[{sourceId:'S1',status:'answered',spanIds:[claim.sourceEvidence[0].spanIds[0]]}]}]})};
 };
 const ai=makeAI([answer('PART P1\nInes Vidal describes learning that a horizon recedes exactly as fast as a walker advances toward it. [S1]\n'+
   'Geese read the stars on clear nights and hold their course by the brightest patterns.\n'+
   'Patience is a virtue that travel tends to teach slowly.'),
  linkingReview]);
 const result=await composeEvidenceAnswer('What do Vidal and Feld each describe about finding direction?',
  [vidalSalt,feldGeese],ai,[],{plan:twoBookPlan,catalog:batch4Catalog,trace:true});
 assert.equal(packetPart.synthesisCoverage,undefined,
  'the review packet no longer flags synthesis parts');
 assert.ok(packetPart.evidence.every(entry=>entry.linkedEvidence===undefined),
  'the packet no longer extends to linked-but-uncited sources');
 assert.ok(!result.trace.reviewContract.reviewDecisions
  .some(decision=>decision.contextClaimLink),
  'no review decision carries a reviewer-supplied link');
 assert.deepEqual(result.trace.contextSecondLook?.map(entry=>entry.claimId),['P1-C2'],
  'the paraphrase is attached by the deterministic second look instead');
 assert.match(result.answer,/brightest patterns\. \[S2\]/,
  'the second-look paraphrase ships with its citation');
 assert.ok(result.evidenceMap.some(item=>item.claimId==='P1-C2'));
 assert.ok(!result.evidenceMap.some(item=>item.claimId==='P1-C3'),
  'a genuinely general claim in the same part remains context');
 assert.match(result.answer,/Patience is a virtue/);
});

test('reviewer contextClaimLinks change nothing in a single-source part either (B6-3)',async()=>{
 let packetPart;
 const linkingReview=(_model,{messages})=>{
  const payload=parsePayload(messages);
  packetPart=payload.parts[0];
  const claim=payload.claims[0];
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',answerStatus:'answered',
    directAnswerClaimIds:[claim.claimId],retainedContextClaimIds:['P1-C2'],
    contextClaimLinks:[{claimId:'P1-C2',sourceId:'S1',spanIds:['S1-Q1']}]}],
   claims:[{claimId:claim.claimId,status:'answered',
    sources:[{sourceId:'S1',status:'answered',spanIds:[claim.sourceEvidence[0].spanIds[0]]}]}]})};
 };
 const ai=makeAI([answer('PART P1\nInes Vidal describes learning that a horizon recedes exactly as fast as a walker advances toward it. [S1]\n'+
   'Vidal crossed the salt flats in her nineteenth year, carrying her father’s survey chain and a tin of well water.'),
  linkingReview]);
 const result=await composeEvidenceAnswer('What does Vidal describe learning from crossing the salt flats?',
  [vidalSalt],ai,[],{plan:vidalPlan,catalog:batch4Catalog,trace:true});
 assert.equal(packetPart.synthesisCoverage,undefined,
  'a single-source expository part is not flagged');
 assert.ok(!result.trace.reviewContract.reviewDecisions
  .some(decision=>decision.claimId==='P1-C2'&&decision.contextClaimLink),
  'no decision carries a reviewer-link flag');
 assert.deepEqual(result.trace.contextSecondLook?.map(entry=>entry.claimId),['P1-C2'],
  'the claim is cited only because the deterministic second look attaches it');
});

test('claimTextAppears no longer passes absent claims (C)',()=>{
 assert.equal(claimTextAppears('A short claim',
  'the answer contains a short claim within it'),true,
  'a short claim that is present still passes');
 assert.equal(claimTextAppears('A short claim',
  'the answer contains other words entirely'),false,
  'short claims no longer pass vacuously');
 const longClaim='Vidal argues that the horizon recedes exactly as fast as a walker '+
  'advances toward it and therefore the crossing teaches a walker that distance '+
  'is measured by effort rather than by sight alone';
 assert.equal(claimTextAppears(longClaim,
  'vidal argues that the horizon recedes exactly as fast as a walker advances '+
  'toward it and therefore the crossing ends at the river'),false,
  'a shared head alone no longer represents an absent claim (the run-49 hole)');
 assert.equal(claimTextAppears(longClaim,
  'vidal argues that the horizon recedes exactly as fast as a walker advances '+
  'toward it and (as the narrative shows) therefore the crossing teaches a '+
  'walker that distance is measured by effort rather than by sight alone'),true,
  'head and tail anchors both present despite a mid-text insertion');
});

test('assembly audit flags an unbalanced bold seam in prose (C)',async()=>{
 const ai=makeAI([answer('PART P1\nInes Vidal describes learning that a **horizon recedes exactly as fast as a walker advances toward it. [S1]'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('What does Vidal describe learning from crossing the salt flats?',
  [vidalSalt],ai,[],{plan:vidalPlan,catalog:batch4Catalog,trace:true});
 assert.equal(ai.calls.length,3,'compose, review, and the single failed audit repair attempt');
 assert.deepEqual(result.trace.assemblyAudit.violations,
  [{partId:'P1',type:'unbalanced-bold'}]);
 assert.equal(result.trace.assemblyAudit.action,'downgraded');
 assert.equal(result.questionParts[0].answerStatus,'partial');
});


test('assembly audit flags list markers spliced into a prose paragraph (B6-5)',async()=>{
 const ai=makeAI([answer('PART P1\nInes Vidal describes learning that a horizon recedes exactly as fast as a walker advances toward it. [S1]\n'+
   'The crossing teaches patience. * Patience under a wide sky. * Humility before distance.'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('What does Vidal describe learning from crossing the salt flats?',
  [vidalSalt],ai,[],{plan:vidalPlan,catalog:batch4Catalog,trace:true});
 assert.equal(ai.calls.length,3,'compose, review, and the single failed audit repair attempt');
 assert.deepEqual(result.trace.assemblyAudit.violations,
  [{partId:'P1',type:'inline-list-marker-splice'}]);
 assert.equal(result.trace.assemblyAudit.action,'downgraded');
 assert.equal(result.questionParts[0].answerStatus,'partial');
});

test('assembly audit flags a part ending on a list introduction with no list (B6-5)',async()=>{
 const twoPartPlan={version:'reader-evidence-v2',intent:'explain',
  sources:[{label:'Ines Vidal',role:'primary',bookIds:['501']},
   {label:'Aaron Feld',role:'primary',bookIds:['502']}],
  parts:[{id:'P1',question:'What does Vidal describe learning from crossing the salt flats?',
    sourceBookIds:['501'],searchQueries:['salt flats horizon'],candidateSourceIds:['S1']},
   {id:'P2',question:'What does Feld describe about geese finding direction?',
    sourceBookIds:['502'],searchQueries:['geese stars'],candidateSourceIds:['S2']}],
  queries:['salt flats horizon','geese stars']};
 const perPartReview=review([['P1','answered'],['P2','answered']]);
 const ai=makeAI([answer('PART P1\nInes Vidal describes learning that a horizon recedes exactly as fast as a walker advances toward it. [S1]\n'+
   'The primary shifts include:\n'+
   'PART P2\nGeese read the stars on clear nights and hold their course by the brightest patterns. [S2]'),
  perPartReview,perPartReview]);
 const result=await composeEvidenceAnswer('What do Vidal and Feld each describe about finding direction?',
  [vidalSalt,feldGeese],ai,[],{plan:twoPartPlan,catalog:batch4Catalog,trace:true});
 assert.equal(ai.calls.length,4,'compose, two per-part reviews, and the failed audit repair attempt');
 assert.deepEqual(result.trace.assemblyAudit.violations,
  [{partId:'P1',type:'dangling-list-introduction'}]);
 assert.equal(result.trace.assemblyAudit.action,'downgraded');
 assert.equal(result.questionParts[0].answerStatus,'partial');
 assert.equal(result.questionParts[1].answerStatus,'answered',
  'the clean part is untouched by the other part’s seam');
});

test('assembly audit flags a part opening on a lowercase fragment (B6-5)',async()=>{
 const ai=makeAI([answer('PART P1\nthe horizon recedes exactly as fast as a walker advances toward it, and the crossing teaches patience. [S1]'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('What does Vidal describe learning from crossing the salt flats?',
  [vidalSalt],ai,[],{plan:vidalPlan,catalog:batch4Catalog,trace:true});
 assert.equal(ai.calls.length,3,'compose, review, and the single failed audit repair attempt');
 assert.deepEqual(result.trace.assemblyAudit.violations,
  [{partId:'P1',type:'lowercase-segment-opening'}]);
 assert.equal(result.trace.assemblyAudit.action,'downgraded');
 assert.equal(result.questionParts[0].answerStatus,'partial');
});

test('legitimate lists, bold lead-ins, and mid-part colons stay seam-free (B6-5)',async()=>{
 const ai=makeAI([answer('PART P1\n**Field summary:** Ines Vidal describes learning that a horizon recedes exactly as fast as a walker advances toward it. [S1]\n'+
   'The lessons are plain:\n- Cross slowly\n- Watch the horizon\n'+
   'Vidal crossed the salt flats in her nineteenth year, carrying her father’s survey chain and a tin of well water.'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('What does Vidal describe learning from crossing the salt flats?',
  [vidalSalt],ai,[],{plan:vidalPlan,catalog:batch4Catalog,trace:true});
 assert.equal(ai.calls.length,2,'no audit repair runs for a seam-free answer');
 assert.deepEqual(result.trace.assemblyAudit,{violations:[],action:'none'});
});

test('person name matching tolerates middle initials but not different people (B)',()=>{
 assert.equal(personNamesMatch('Viktor Frankl','Viktor E. Frankl'),true,
  'a byline middle initial does not make a different person');
 assert.equal(personNamesMatch('Frankl','Viktor E. Frankl'),true,
  'surname-only attribution still matches');
 assert.equal(personNamesMatch('Tomas Vidal','Ines Vidal'),false,
  'two full names that merely share a surname do not match');
 assert.equal(personNamesMatch('Ines Vidal','Aaron Feld'),false);
 assert.equal(speakerIsWorkAuthor('Viktor Frankl',
  {title:'Man’s Search for Meaning — Viktor E. Frankl'}),true);
 assert.equal(namedSpeakerAttribution('Viktor Frankl argues that people choose.'),'Viktor Frankl');
 assert.equal(namedSpeakerAttribution('Geese read the stars on clear nights.'),'');
});

test('author narration with a middle-initial byline is anchored (B, run-50 Frankl shape)',async()=>{
 const franklCatalog={601:'Man’s Search for Meaning — Viktor E. Frankl'};
 const franklSource={id:'S1',bookId:'601',title:franklCatalog[601],page:33,
  url:'https://example.test/frankl#page=33',
  text:'Even when everything is taken away, a person retains the freedom to choose an attitude toward suffering. I found that life expects something from each of us, and each of us must answer for his own life.',
  preview:'Even when everything is taken away, a person retains the freedom to choose.'};
 const franklPlan={version:'reader-evidence-v2',intent:'explain',
  sources:[{label:'Viktor Frankl',role:'primary',bookIds:['601']}],
  parts:[{id:'P1',question:'What does Frankl argue a person retains even when everything is taken away?',
    sourceBookIds:['601'],searchQueries:['freedom choose attitude suffering'],
    candidateSourceIds:['S1']}],queries:['freedom choose attitude suffering']};
 const ai=makeAI([answer('PART P1\nViktor Frankl argues that a person retains the freedom to choose an attitude toward suffering even when everything is taken away. [S1]'),
  attributedReview('Viktor Frankl')]);
 const result=await composeEvidenceAnswer('What does Frankl argue a person retains even when everything is taken away?',
  [franklSource],ai,[],{plan:franklPlan,catalog:franklCatalog,trace:true});
 assert.equal(result.coverage,'full',
  'the author exemption reaches the middle-initial byline, so first-person narration needs no separate cue');
 assert.ok(!result.trace.reviewContract.supportIssues.some(issue=>
  issue.reason==='source-attribution-unanchored'));
 assert.match(result.answer,/Viktor Frankl argues/);
});

test('a character named with speech verbs elsewhere on the page no longer anchors an attribution (B, Austen shape)',async()=>{
 const ellisonPage={id:'S1',bookId:'501',title:batch4Catalog[501],page:12,
  url:'https://example.test/salt-meridian#page=12',
  text:'Mara Ellison said the crossing would take three days. Mara Ellison argued that the wells would surely hold. The guides counted the tins of water twice and checked the survey chain link by link. Dust settled over the camp as the evening wind dropped. I learned that a horizon can recede exactly as fast as a walker advances toward it.',
  preview:'Mara Ellison said the crossing would take three days.'};
 const ai=makeAI([answer('PART P1\nMara Ellison argues that a horizon can recede exactly as fast as a walker advances toward it. [S1]'),
  attributedReview('Mara Ellison')]);
 const result=await composeEvidenceAnswer('What does Vidal describe learning from crossing the salt flats?',
  [ellisonPage],ai,[],{plan:vidalPlan,catalog:batch4Catalog,trace:true});
 assert.equal(result.coverage,'none',
  'the cue search is scoped to the accepted span’s neighbourhood, not the whole page');
 assert.ok(result.trace.reviewContract.supportIssues.some(issue=>
  issue.sourceId==='S1'&&issue.reason==='source-attribution-unanchored'));
});

test('a claim naming a different speaker than the reviewer demotes as a speaker mismatch (B)',async()=>{
 const ai=makeAI([answer('PART P1\nInes Vidal describes learning that a horizon recedes exactly as fast as a walker advances toward it. [S1]'),
  attributedReview('Aaron Feld')]);
 const result=await composeEvidenceAnswer('What does Vidal describe learning from crossing the salt flats?',
  [vidalSalt],ai,[],{plan:vidalPlan,catalog:batch4Catalog,trace:true});
 assert.ok(result.trace.reviewContract.supportIssues.some(issue=>
  issue.sourceId==='S1'&&issue.reason==='source-attribution-speaker-mismatch'),
  'the claim’s own named speaker is compared against the attributed speaker');
});

test('a part repaired by an earlier gate gets no second repair cycle in the assembly audit (L3)',async()=>{
 // Both cited claims sit in list lines that markdown normalization drops,
 // so the shipped segment cites nothing (the citation gate fires and
 // consumes the part's one repair cycle) while both accepted claims are
 // unrepresented (the assembly audit would normally repair them too).
 const droppedDraft='PART P1\nCrossing open country on foot teaches patience in a way that maps never can.\n\n'+
  '- **Field note: Vidal describes learning that a horizon recedes exactly as fast as a walker advances toward it [S1]\n\n'+
  '- **Field note: Feld writes that geese hold their course by the brightest star patterns [S2]';
 const ai=makeAI([answer(droppedDraft),
  review([['P1','answered']],{directAnswerClaimIdsByPart:{P1:['P1-C2','P1-C3']}})]);
 const result=await composeEvidenceAnswer('What do Vidal and Feld each describe about finding direction?',
  [vidalSalt,feldGeese],ai,[],{plan:twoBookPlan,catalog:batch4Catalog,trace:true});
 assert.equal(ai.calls.length,3,
  'compose, review, and the citation gate’s repair attempt — the assembly audit adds no cycle');
 assert.deepEqual(result.trace.gateRepairCycles,[{partId:'P1',gate:'citation-presence'}]);
 assert.deepEqual(result.trace.assemblyAudit.repairSkippedPartIds,['P1']);
 assert.equal(result.trace.assemblyAudit.action,'downgraded');
});

test('answer repair adoption is per part (L4)',async()=>{
 const repairPlan={version:'reader-evidence-v2',intent:'explain',
  sources:[{label:'David Hume',role:'primary',bookIds:['35']},
   {label:'Immanuel Kant',role:'primary',bookIds:['40']}],
  parts:[{id:'P1',question:'How does Hume explain causal necessity?',sourceBookIds:['35'],
    searchQueries:['Hume necessity'],candidateSourceIds:['S1'],
    requirements:[{id:'P1-R1',text:'Explain the role of custom in causal inference.'}]},
   {id:'P2',question:'How does Kant explain causality?',sourceBookIds:['40'],
    searchQueries:['Kant causality'],candidateSourceIds:['S2'],
    requirements:[{id:'P2-R1',text:'Explain why causality is a priori.'}]}],
  queries:['Hume necessity','Kant causality']};
 const initialReview=(_model,{messages})=>{
  const payload=parsePayload(messages);
  return {response:JSON.stringify({
   parts:payload.parts.map(part=>({partId:part.partId,status:'answered',answerStatus:'partial',
     repairable:true,
     directAnswerClaimIds:payload.claims.filter(claim=>claim.partId===part.partId)
      .map(claim=>claim.claimId),
     requirementCoverage:part.requirements.map(requirement=>({requirementId:requirement.id,
       status:'unanswered',answerClaimIds:[]}))})),
   claims:payload.claims.map(claim=>({claimId:claim.claimId,status:'answered',
     sources:claim.sourceIds.map(sourceId=>({sourceId,status:'answered',
       spanIds:[claim.sourceEvidence.find(item=>item.sourceId===sourceId).spanIds[0]]}))}))})};
 };
 const repair=()=>({response:JSON.stringify({parts:[
  {partId:'P1',replacements:[],additions:['Custom trains the mind to infer one event after another. [S1]']},
  {partId:'P2',replacements:[],additions:['Causality is known a priori because it is a category. [S2]']}]})});
 const reReview=(succeeds,requirementId)=>(_model,{messages})=>{
  const payload=parsePayload(messages);
  return {response:JSON.stringify({
   parts:payload.parts.map(part=>({partId:part.partId,status:'answered',
     answerStatus:succeeds?'answered':'partial',
     directAnswerClaimIds:succeeds?payload.claims.map(claim=>claim.claimId):[],
     requirementCoverage:part.requirements.map(requirement=>({requirementId:requirement.id,
       status:succeeds?'answered':'unanswered',
       answerClaimIds:succeeds?[payload.claims.at(-1).claimId]:[]}))})),
   claims:payload.claims.map(claim=>({claimId:claim.claimId,status:'answered',
     sources:claim.sourceIds.map(sourceId=>({sourceId,status:'answered',
       spanIds:[claim.sourceEvidence.find(item=>item.sourceId===sourceId).spanIds[0]]}))}))})};
 };
 const ai=makeAI([answer('PART P1\nRepeated conjunction gives Hume the idea of necessity. [S1]\n'+
   'PART P2\nCausality is a category of the understanding. [S2]'),
  initialReview,initialReview,repair,reReview(true,'P1-R1'),reReview(false,'P2-R1')]);
 const result=await composeEvidenceAnswer('How do Hume and Kant each explain causality?',
  [hume,kant],ai,[],{plan:repairPlan,catalog,trace:true});
 assert.equal(ai.calls.length,6,'compose, two per-part reviews, one shared repair, two per-part re-reviews');
 assert.equal(result.trace.answerRepair.applied,true);
 assert.deepEqual(result.trace.answerRepair.adoptedPartIds,['P1']);
 assert.deepEqual(result.trace.answerRepair.rejectedParts,
  [{partId:'P2',reason:'answer-re-review-unsupported'}]);
 assert.match(result.answer,/Custom trains the mind/,
  'the part whose repair passed re-review ships its repair');
 assert.doesNotMatch(result.answer,/known a priori because/,
  'the part whose repair failed keeps its original text');
});

test('the synthesis-deficit repair pattern is skipped as futile (L4)',async()=>{
 const question='How does Hume explain causal necessity, and what role does custom play?';
 const plan={...onePartPlan,parts:[{...onePartPlan.parts[0],question,
  requirements:[
   {id:'P1-R1',text:'Explain how repeated conjunction gives rise to the idea of necessity.'},
   {id:'P1-R2',text:'Explain how custom leads the mind to infer one event from another.'}]}]};
 const ai=makeAI([answer('PART P1\nRepeated conjunction gives Hume the idea of necessity. [S1]'),
  (_model,{messages})=>{
   const payload=parsePayload(messages),claim=payload.claims[0];
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',answerStatus:'answered',
     repairable:true,directAnswerClaimIds:[claim.claimId],
     requirementCoverage:[
      {requirementId:'P1-R1',status:'answered',answerClaimIds:[claim.claimId]},
      {requirementId:'P1-R2',status:'partial',answerClaimIds:[claim.claimId]}]}],
    claims:[{claimId:claim.claimId,status:'answered',
     sources:[{sourceId:'S1',status:'answered',spanIds:[claim.sourceEvidence[0].spanIds[0]]}]}]})};
  }]);
 const result=await composeEvidenceAnswer(question,[hume],ai,[],{plan,catalog,trace:true});
 assert.equal(ai.calls.length,2,'no repair call is spent on the futile pattern');
 assert.equal(result.trace.answerRepair.attempted,false);
 assert.equal(result.trace.answerRepair.reason,'synthesis-deficit-repair-skipped');
});

test('structured calls run at temperature 0 and re-review failures record the review timeout (L2/L6)',async()=>{
 const clean=makeAI([answer('PART P1\nInes Vidal describes learning that a horizon recedes exactly as fast as a walker advances toward it. [S1]'),
  review([['P1','answered']])]);
 await composeEvidenceAnswer('What does Vidal describe learning from crossing the salt flats?',
  [vidalSalt],clean,[],{plan:vidalPlan,catalog:batch4Catalog,trace:true});
 assert.equal(clean.calls[0].request.temperature,undefined,
  'compose keeps the provider default — no temperature parameter');
 assert.equal(clean.calls[1].request.temperature,0,'review runs at temperature 0');

 const question='How does Hume explain causal necessity, and what role does custom play?';
 const plan={...onePartPlan,parts:[{...onePartPlan.parts[0],question,
  requirements:[
   {id:'P1-R1',text:'Explain how repeated conjunction gives rise to the idea of necessity.'},
   {id:'P1-R2',text:'Explain how custom leads the mind to infer one event from another.'}]}]};
 const providerDown=Object.assign(new Error('provider unavailable'),{code:'provider-down'});
 const ai=makeAI([answer('PART P1\nRepeated conjunction gives Hume the idea of necessity. [S1]'),
  (_model,{messages})=>{
   const payload=parsePayload(messages),claim=payload.claims[0];
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',answerStatus:'answered',
     repairable:true,directAnswerClaimIds:[claim.claimId],
     requirementCoverage:[
      {requirementId:'P1-R1',status:'answered',answerClaimIds:[claim.claimId]},
      {requirementId:'P1-R2',status:'unanswered',answerClaimIds:[]}]}],
    claims:[{claimId:claim.claimId,status:'answered',
     sources:[{sourceId:'S1',status:'answered',spanIds:[claim.sourceEvidence[0].spanIds[0]]}]}]})};
  },
  {response:JSON.stringify({parts:[{partId:'P1',replacements:[],
   additions:['Custom trains the mind to infer one event after another from their repeated conjunction. [S1]']}]})},
  providerDown]);
 const result=await composeEvidenceAnswer(question,[hume],ai,[],{plan,catalog,trace:true});
 const failedReReview=result.trace.stages.find(stage=>
  stage.stage==='answer-re-review'&&stage.status==='failed');
 assert.ok(failedReReview,'the failed re-review is traced');
 assert.equal(failedReReview.timeoutMs,60000,
  'answer-re-review gets the review timeout, not the 45 s compose-class timeout');
 assert.equal(failedReReview.temperature,0);
});

// --- Batch 7: B7-1 scaffolding citations (prompt), B7-2 rejection
// containment, B7-3 claim-to-claim inheritance, B7-5b fallback union
// coverage, B7-6.1 mid-segment dangling list introduction.
// All fixtures below are invented for these tests.

// A reviewer that answers every cited claim except those whose text
// matches rejectPattern (marked partial with no spans, so review drops
// them), retains every uncited claim as context, and optionally reports
// an attributed speaker for accepted claims.
function selectiveReview({rejectPattern=null,attributedSpeaker=''}={}){
 return (_model,{messages})=>{
  const payload=parsePayload(messages);
  const claims=payload.claims.filter(claim=>claim.sourceIds.length).map(claim=>{
   const rejected=rejectPattern&&rejectPattern.test(claim.text);
   return {claimId:claim.claimId,status:rejected?'partial':'answered',
    sources:claim.sourceIds.map(sourceId=>({sourceId,
     status:rejected?'partial':'answered',
     spanIds:rejected?[]:[claim.sourceEvidence
      .find(item=>item.sourceId===sourceId).spanIds[0]],
     ...(attributedSpeaker?{attributionStatus:'supported',attributedSpeaker}:{})}))};
  });
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',answerStatus:'answered',
    directAnswerClaimIds:[payload.claims[0].claimId],
    retainedContextClaimIds:(payload.parts[0].contextClaims||[])
     .map(claim=>claim.claimId)}],
   claims})};
 };
}

test('batch 7 prompt state: scaffolding citation rule added, allowances verbatim (B7-1)',()=>{
 assert.match(COMPOSER_PROMPT,/when an opening thesis, a section thesis, or a closing sentence restates or combines positions that cited claims in the same part established, attach the page IDs those claims rest on/);
 assert.match(COMPOSER_PROMPT,/A closing sentence may only state what the part established/);
 assert.match(COMPOSER_PROMPT,/a position the part did not establish belongs in the body of the part with its own support, or is not written at all/);
 // The general-knowledge allowances the addition must not weaken.
 assert.match(COMPOSER_PROMPT,/general background and your own synthesis do not need a library citation/);
 assert.match(COMPOSER_PROMPT,/not every factual sentence needs a citation/);
 assert.match(COMPOSER_PROMPT,/Leave independent background or your own interpretation uncited when it does not present a supplied source's position/);
 // The pre-existing opening-sentence and closing-sentence rules stand.
 assert.match(COMPOSER_PROMPT,/If that opening sentence summarizes or combines positions from supplied passages, cite the page IDs/);
 assert.match(COMPOSER_PROMPT,/Close each part with one sentence stating what the part established/);
});

test('a closing synthesis that restates cited claims ships with their citations (B7-1)',async()=>{
 const ai=makeAI([answer('PART P1\nInes Vidal describes learning that a horizon recedes exactly as fast as a walker advances toward it. [S1]\n'+
   'Geese read the stars on clear nights and hold their course by the brightest patterns. [S2]\n'+
   'Ines Vidal learned that a horizon recedes exactly as fast as a walker advances toward it, while the geese hold their course by the brightest star patterns. [S1, S2]'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('What do Vidal and Feld each describe about finding direction?',
  [vidalSalt,feldGeese],ai,[],{plan:twoBookPlan,catalog:batch4Catalog,trace:true});
 assert.deepEqual(result.questionParts[0].claimIds,['P1-C1','P1-C2','P1-C3']);
 assert.match(result.answer,/brightest star patterns\. \[S1, S2\]/,
  'the closing synthesis carries the page IDs of the claims it restates');
});

test('an unevidenced closing position is rejected by review and never ships cited (B7-1)',async()=>{
 const ai=makeAI([answer('PART P1\nInes Vidal describes learning that a horizon recedes exactly as fast as a walker advances toward it. [S1]\n'+
   'The crossing therefore proves that every distant journey ends in self-knowledge. [S1]'),
  selectiveReview({rejectPattern:/self-knowledge/})]);
 const result=await composeEvidenceAnswer('What does Vidal describe learning from crossing the salt flats?',
  [vidalSalt],ai,[],{plan:vidalPlan,catalog:batch4Catalog,trace:true});
 assert.equal(ai.calls.length,2,'compose and review only; no repair is spent');
 assert.deepEqual(result.questionParts[0].claimIds,['P1-C1']);
 assert.doesNotMatch(result.answer,/self-knowledge/,
  'a closing position the part did not establish is dropped, not shipped with a citation');
});

test('rejection containment drops a softened rewrite of a rejected claim (B7-2)',async()=>{
 const ai=makeAI([answer('PART P1\nInes Vidal describes learning that a horizon recedes exactly as fast as a walker advances toward it. [S1]\n'+
   'Vidal argues that the salt flats crossing proves distant empires decline when luxury corrupts their citizens. [S1]\n'+
   'The crossing suggests that empires decline as luxury corrupts citizens.'),
  selectiveReview({rejectPattern:/empires decline/})]);
 const result=await composeEvidenceAnswer('What does Vidal describe learning from crossing the salt flats?',
  [vidalSalt],ai,[],{plan:vidalPlan,catalog:batch4Catalog,trace:true});
 assert.equal(ai.calls.length,2,'containment is deterministic and makes no model call');
 // Batch 10 (B10-3): the recorded measure is the overlap coefficient —
 // the rewrite's 6 shared terms over the smaller term set (its own 7),
 // not the one-sided 6/12 = 0.5 this fixture recorded before.
 assert.deepEqual(result.trace.rejectionContainment,
  [{partId:'P1',claimId:'P1-C3',matchedRejectedClaimId:'P1-C2',containment:0.857}],
  'the uncited rewrite covers most of its own terms from the rejected claim');
 assert.doesNotMatch(result.answer,/empires decline as luxury corrupts citizens/,
  'the post-rejection rewrite does not ship');
 assert.deepEqual(result.questionParts[0].claimIds,['P1-C1'],
  'the accepted claim is untouched');
 assert.match(result.answer,/Ines Vidal describes learning/);
});

test('rejection containment spares a heading whose terms live inside a rejected claim (batch 11 B11-6)',async()=>{
 // The batch-10 Hobbes shape: a bold section heading whose entire
 // term set is contained in a rejected claim measures containment
 // 1.0 under the overlap coefficient and was dropped as if it were
 // a rewrite of the rejected proposition. A heading is furniture,
 // not a restatement — it asserts no proposition and must survive.
 const ai=makeAI([answer('PART P1\n**Empires Decline When Luxury Corrupts Citizens**\n'+
   'Ines Vidal describes learning that a horizon recedes exactly as fast as a walker advances toward it. [S1]\n'+
   'Vidal argues that the salt flats crossing proves distant empires decline when luxury corrupts their citizens. [S1]'),
  selectiveReview({rejectPattern:/empires decline/})]);
 const result=await composeEvidenceAnswer('What does Vidal describe learning from crossing the salt flats?',
  [vidalSalt],ai,[],{plan:vidalPlan,catalog:batch4Catalog,trace:true});
 assert.equal(ai.calls.length,2,'containment stays deterministic');
 assert.equal(result.trace.rejectionContainment,undefined,
  'no claim is dropped: the heading is exempt and nothing else restates the rejection');
 assert.match(result.answer,/Empires Decline When Luxury Corrupts Citizens/,
  'the heading still ships');
 assert.doesNotMatch(result.answer,/salt flats crossing proves/,
  'the rejected cited claim itself still does not ship');
});

test('rejection containment leaves an unrelated context claim untouched (B7-2)',async()=>{
 const ai=makeAI([answer('PART P1\nInes Vidal describes learning that a horizon recedes exactly as fast as a walker advances toward it. [S1]\n'+
   'Vidal argues that the salt flats crossing proves distant empires decline when luxury corrupts their citizens. [S1]\n'+
   'Crossing open country on foot teaches patience in a way that maps never can.'),
  selectiveReview({rejectPattern:/empires decline/})]);
 const result=await composeEvidenceAnswer('What does Vidal describe learning from crossing the salt flats?',
  [vidalSalt],ai,[],{plan:vidalPlan,catalog:batch4Catalog,trace:true});
 assert.equal(result.trace.rejectionContainment,undefined,
  'a general claim sharing one term with the rejected claim is not a rewrite');
 assert.equal(result.trace.claimInheritance,undefined);
 assert.equal(result.trace.contextSecondLook,undefined);
 assert.match(result.answer,/maps never can\./,
  'the unrelated context claim still ships, uncited');
 assert.doesNotMatch(result.answer,/maps never can\. \[S/);
 assert.deepEqual(result.questionParts[0].claimIds,['P1-C1','P1-C3']);
});

test('rejection containment spares a restatement of an accepted sibling (B7-2)',async()=>{
 const ai=makeAI([answer('PART P1\nInes Vidal describes learning that a horizon recedes exactly as fast as a walker advances toward it. [S1]\n'+
   'Vidal argues that a horizon recedes exactly as fast as any walker advances toward it, and that the flats prove walkers never reach the far side. [S1]\n'+
   'Vidal learned that a horizon recedes exactly as fast as a walker advances toward it.'),
  selectiveReview({rejectPattern:/flats prove/})]);
 const result=await composeEvidenceAnswer('What does Vidal describe learning from crossing the salt flats?',
  [vidalSalt],ai,[],{plan:vidalPlan,catalog:batch4Catalog,trace:true});
 // The uncited claim shares 8 terms with the rejected claim and 9 with
 // the accepted sibling. Under batch 10's overlap coefficient (B10-3)
 // those measure 8/9 = 0.889 against the rejected claim but 9/9 = 1.0
 // against the sibling: it is a restatement of what the part
 // established, not a rewrite of what review refused, so the dominance
 // exemption still spares it.
 assert.equal(result.trace.rejectionContainment,undefined);
 assert.match(result.answer,/Vidal learned that a horizon recedes exactly as fast as a walker advances toward it\./);
 assert.ok(result.questionParts[0].claimIds.includes('P1-C3'),
  'the restatement of the accepted claim still ships');
});

test('rejection containment drops a softened rewrite whose terms mostly live inside a long rejected claim (batch 10 B10-3)',async()=>{
 // The batch-9 Plato shape: the rejected claim is long (21 content
 // terms) and the uncited rewrite is short, drawing 6 of its 7 terms
 // from it. The one-sided ratio measured 6/21 = 0.286 — softening the
 // claim defeated the measure mechanically — while the overlap
 // coefficient measures 6/7 = 0.857. The part's accepted sibling is on
 // the same broad topic (the crossing, the caravans) but overlaps the
 // rewrite by a single term (coefficient 0.143), so the dominance
 // exemption does not save the rewrite.
 const ai=makeAI([answer('PART P1\nInes Vidal describes the caravan staging posts where guides water the camels before the crossing. [S1]\n'+
   'Vidal argues that the salt flats crossing proves distant empires decline when luxury corrupts their citizens, that caravans abandon the roads, and that tribute burdens empty the treasury of every province. [S1]\n'+
   'The crossing suggests that empires decline as luxury corrupts citizens.'),
  selectiveReview({rejectPattern:/distant empires decline/})]);
 const result=await composeEvidenceAnswer('What does Vidal describe learning from crossing the salt flats?',
  [vidalSalt],ai,[],{plan:vidalPlan,catalog:batch4Catalog,trace:true});
 assert.equal(ai.calls.length,2,'containment is deterministic and makes no model call');
 assert.deepEqual(result.trace.rejectionContainment,
  [{partId:'P1',claimId:'P1-C3',matchedRejectedClaimId:'P1-C2',containment:0.857}],
  'the softened rewrite is measured against the smaller term set and drops');
 assert.doesNotMatch(result.answer,/empires decline as luxury corrupts citizens/,
  'the softened post-rejection rewrite does not ship');
 assert.deepEqual(result.questionParts[0].claimIds,['P1-C1'],
  'the accepted sibling is untouched');
 assert.match(result.answer,/caravan staging posts/);
});

test('a thesis covered only jointly across two books is not inherited (B8-6b); the span second look still cites it',async()=>{
 // Batch 7's B7-3 fixture: the closing thesis restates one claim from
 // each of two books, and neither sibling alone covers half of its 25
 // terms (together they cover 16). Batch 7's inheritance attached both
 // books' entries. Batch 8 (B8-6b) deliberately ends that: cross-book
 // coverage that exists only jointly attaches nothing through
 // inheritance — the discipline that keeps one book's theses from
 // inheriting another book's spans. The thesis is still cited in the
 // shipped answer, but by the span-level second look, whose verbatim
 // spans from both pages verifiably cover it — a different evidence
 // standard, and the reason the answer text is unchanged.
 const ai=makeAI([answer('PART P1\nInes Vidal describes learning that a horizon recedes exactly as fast as a walker advances toward it. [S1]\n'+
   'Geese read the stars on clear nights and hold their course by the brightest patterns. [S2]\n'+
   'Ines Vidal learned that a horizon recedes exactly as fast as a walker advances toward it, while the geese hold their course by the brightest star patterns, and both accounts suggest direction is found by attending to distant markers.'),
  review([['P1','answered']]),
  // Batch 8 (B8-1): the thesis closes the part uncited, so it is a
  // retained frame claim and the scaffolding repair round runs first;
  // it decides the thesis is context.
  {response:JSON.stringify({decisions:[{partId:'P1',claimId:'P1-C3',
   action:'context',supportClaimIds:[]}]})}]);
 const result=await composeEvidenceAnswer('What do Vidal and Feld each describe about finding direction?',
  [vidalSalt,feldGeese],ai,[],{plan:twoBookPlan,catalog:batch4Catalog,trace:true});
 assert.deepEqual(result.trace.reviewScaffolding.repairRound,{attempted:true,resolved:1});
 assert.equal(ai.calls.length,3,'compose, review, and the batch-8 scaffolding decision round');
 assert.equal(result.trace.claimInheritance,undefined,
  'neither book alone covers half the thesis, so inheritance attaches nothing under B8-6b');
 assert.deepEqual(result.trace.contextSecondLook,
  [{partId:'P1',claimId:'P1-C3',sourceIds:['S1','S2'],spanIds:['S1-Q1','S2-Q1'],coverageRatio:0.52}],
  'the span-level second look cites the thesis from verbatim spans of both pages');
 assert.match(result.answer,/attending to distant markers\. \[S1, S2\]/,
  'the thesis still ships with both citations appended');
 assert.deepEqual(result.evidenceMap.filter(item=>item.claimId==='P1-C3')
  .map(item=>item.id),['S1','S2'],
  'the thesis carries evidence entries from both sources');
});

test('claim-to-claim inheritance leaves a paraphrase-heavy synthesis uncited (B7-3)',async()=>{
 const ai=makeAI([answer('PART P1\nInes Vidal describes learning that a horizon recedes exactly as fast as a walker advances toward it. [S1]\n'+
   'Geese read the stars on clear nights and hold their course by the brightest patterns. [S2]\n'+
   'Together, the two accounts suggest that patience and attention matter more than instruments when crossing unfamiliar country.'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('What do Vidal and Feld each describe about finding direction?',
  [vidalSalt,feldGeese],ai,[],{plan:twoBookPlan,catalog:batch4Catalog,trace:true});
 assert.equal(result.trace.claimInheritance,undefined,
  'a synthesis sharing almost no terms with the cited claims earns no citation');
 assert.equal(result.trace.contextSecondLook,undefined);
 assert.match(result.answer,/crossing unfamiliar country\./,
  'the synthesis still ships as the part’s own context');
 assert.doesNotMatch(result.answer,/unfamiliar country\. \[S/);
});

test('claim-to-claim inheritance does not transfer a citation across speakers (B7-3)',async()=>{
 const ai=makeAI([answer('PART P1\nInes Vidal describes learning that a horizon recedes exactly as fast as a walker advances toward it, a lesson she carried into every later survey of the meridian. [S1]\n'+
   'Aaron Feld argues that the meridian surveys taught Vidal’s lesson: a horizon recedes exactly as fast as a walker advances toward it.'),
  selectiveReview({attributedSpeaker:'Ines Vidal'})]);
 const result=await composeEvidenceAnswer('What does Vidal describe learning from crossing the salt flats?',
  [vidalSalt],ai,[],{plan:vidalPlan,catalog:batch4Catalog,trace:true});
 // The uncited claim covers the cited sibling's terms well past the
 // inheritance bar, but it attributes the point to Aaron Feld while the
 // sibling's speaker is Ines Vidal, so no citation may transfer.
 assert.equal(result.trace.claimInheritance,undefined);
 assert.equal(result.trace.contextSecondLook,undefined,
  'the span-level second look also fails this claim (7 of 15 terms), so nothing attaches');
 assert.match(result.answer,/Aaron Feld argues that the meridian surveys taught Vidal’s lesson/);
 assert.ok(!result.evidenceMap.some(item=>item.claimId==='P1-C2'),
  'the speaker-mismatched claim carries no evidence link');
});

test('fallback evidence attaches nothing when the only span fails coverage, and the sole unvalidated part is suppressed (B7-5b)',async()=>{
 const span='The empire was shaken when invading horsemen crossed the frontier, and the trade roads emptied of caravans in a single season.';
 const source={id:'S1',bookId:'73',title:'The Fall of the Empire',page:1,
  text:span,preview:span};
 const plan={...onePartPlan,sources:[{label:'The Fall of the Empire',role:'primary',bookIds:['73']}],
  parts:[{...onePartPlan.parts[0],question:'Why did the empire decline?',
   sourceBookIds:['73'],candidateSourceIds:['S1']}]};
 const invalid={response:'{invalid-json'};
 const ai=makeAI([answer('PART P1\nThe empire gradually declined as trade withered and the treasury emptied. [S1]'),
  invalid,invalid]);
 const result=await composeEvidenceAnswer('Why did the empire decline?',[source],ai,[],
  {plan,catalog:{...catalog,73:'The Fall of the Empire'},trace:true});
 // The span shares three of the claim's seven content terms (empire,
 // trade, emptied) — enough for batch 2's per-span bar, but under the
 // half-coverage union standard the batch-6 second look set, so the
 // fallback no longer fabricates the link (the phase-2 empires shape).
 assert.equal(result.outcome,'generation-failed');
 assert.equal(result.reviewStatus,'review-format-failed');
 assert.equal(result.questionParts[0].status,'unsupported');
 assert.equal(result.answer,'I could not complete a reliable answer this time. Please try again.');
 assert.equal(result.trace.fallbackEvidence,undefined);
 assert.equal(result.evidenceMap.length,0);
 assert.deepEqual(result.trace.reviewCompletion.unvalidatedPartIds,['P1']);
});

test('assembly audit flags a list introduction stranded mid-segment (B7-6.1)',async()=>{
 const ai=makeAI([answer('PART P1\nInes Vidal describes learning that a horizon recedes exactly as fast as a walker advances toward it. [S1]\n\n'+
   'The primary shifts include:\n\n'+
   'Crossing open country on foot teaches patience in a way that maps never can.'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('What does Vidal describe learning from crossing the salt flats?',
  [vidalSalt],ai,[],{plan:vidalPlan,catalog:batch4Catalog,trace:true});
 assert.equal(ai.calls.length,3,'compose, review, and the single failed audit repair attempt');
 assert.deepEqual(result.trace.assemblyAudit.violations,
  [{partId:'P1',type:'dangling-list-introduction'}],
  'batch 6 caught only a colon line at the segment’s end; the mid-segment shape is flagged now');
 assert.equal(result.trace.assemblyAudit.action,'downgraded');
 assert.equal(result.questionParts[0].answerStatus,'partial');
});

// ---------------------------------------------------------------------------
// Batch 8: review-side scaffolding decisions (B8-1), the rejection archive
// (B8-2), disclosure-claim protection (B8-3), heading-only spans (B8-4),
// per-part review-coverage honesty (B8-5), inheritance smalls (B8-6), and
// the answer-stage transient retry (B8-7). Fixtures are invented; no
// evaluation questions or authors are used.
// ---------------------------------------------------------------------------

test('batch 8 prompt additions: scaffolding links, prior-rejection shadow, disclosure claims (B8-1/B8-2/B8-3)',()=>{
 // B8-1: the scaffolding disposition and its guardrails.
 assert.match(REVIEW_PROMPT,/scaffoldingLinks/);
 assert.match(REVIEW_PROMPT,/restate or combine positions that cited claims in the same part establish/);
 assert.match(REVIEW_PROMPT,/never return a one-sided link for a claim that combines two positions/);
 assert.match(REVIEW_PROMPT,/When no cited claim in the part establishes the restated position, do not link the claim/);
 assert.match(REVIEW_PROMPT,/frame set to true/);
 // B8-2: the prior-rejection shadow.
 assert.match(REVIEW_PROMPT,/priorRejections/);
 assert.match(REVIEW_PROMPT,/Do not retain as context, and do not accept, a claim that restates the substance of a prior rejection/);
 assert.match(REVIEW_PROMPT,/does not become acceptable by returning without its citations or with softer wording/);
 // B8-3: statements about the evidence itself.
 assert.match(REVIEW_PROMPT,/Some claims describe the evidence itself rather than a position in it/);
 assert.match(REVIEW_PROMPT,/no span can state an absence/);
 assert.match(REVIEW_PROMPT,/treat its source decision as not applicable and judge the claim as context/);
 // The pre-existing general-knowledge allowances are untouched.
 assert.match(REVIEW_PROMPT,/independent background and synthesis may remain uncited/);
 assert.match(REVIEW_PROMPT,/Genuine background, transitions, and interpretation are not restatements/);
 assert.match(REVIEW_PROMPT,/Judge uncited context for relevance, plausibility, usefulness, clear attribution, and directness/);
});

test('heading-only span predicate classifies headings and spares sentences (B8-4)',()=>{
 for(const heading of ['Relation of the Baptist to Elijah.',
   'Chapter V. The Grand Inquisitor 325','18.4.1.1.4 ITALY',
   'Chap. XXVII.—How little the precepts of philosophers contribute to true…',
   '**Internal Decay**'])
  assert.equal(isHeadingOnlySpan(heading),true,heading);
 for(const sentence of ['God is dead.',
   'Causality is one of the categories of relation.',
   'Custom is the great guide of human life.',
   hume.text,kant.text])
  assert.equal(isHeadingOnlySpan(sentence),false,sentence.slice(0,40));
});

test('heading-only span predicate covers multi-line heading blocks (batch 9 B9-7b)',()=>{
 // The batch-8 scorer-note shapes: a running title with page number, a
 // bare chapter marker line, and the repeated title — three heading
 // lines and nothing else.
 assert.equal(isHeadingOnlySpan(
  'THE VENERABLE, 27\r\n\r\nCHAPTER VII.\r\nTHE VENERABLE (ARHAT).'),true,
  'a multi-line block of heading lines is heading-only');
 assert.equal(isHeadingOnlySpan(
  'CHAPTER VII.\nTHE VENERABLE (ARHAT).'),true,
  'a doubled chapter heading across two lines is heading-only');
 assert.equal(isHeadingOnlySpan('CHAPTER VII.'),true,
  'a bare structural marker line is a heading on its own');
 // One substantive line keeps the whole span body text: a heading line
 // glued onto a real sentence is a prefix problem (handled at display),
 // not a heading-only span.
 assert.equal(isHeadingOnlySpan(
  'CHAPTER VII.\nThere is no suffering for him who has finished his journey and abandoned grief.'),false,
  'a heading line plus a substantive sentence is not heading-only');
 assert.equal(isHeadingOnlySpan(
  'The venerable teacher then left the village.\nHe walked north for three days before resting.'),false,
  'ordinary multi-line prose stays body text');
});

test('the review packet offers no heading-only span while body spans remain (B8-4)',async()=>{
 const body='The narrative then turns to the ministry by the river, where crowds gathered each morning to hear the preaching, to ask what they should do in the days ahead, and to wonder aloud whether the long expected teacher had finally come among them in their own generation after so many years of waiting and watching for a sign from heaven.';
 const source={id:'S1',bookId:'88',title:'The River Ministry — A. Chronicler',page:9,
  text:'Relation of the Baptist to Elijah.\n'+body,preview:body};
 assert.ok(buildReviewSpans('S1',source.text)
  .some(span=>span.text==='Relation of the Baptist to Elijah.'),
  'the fixture page really does yield the heading as its own span');
 let captured;
 const ai=makeAI([answer('PART P1\nThe narrative turns to the ministry by the river, where crowds gathered each morning. [S1]'),
  (_model,{messages})=>{
   const payload=parsePayload(messages);captured=payload;
   const claim=payload.claims[0];
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
     directAnswerClaimIds:[claim.claimId]}],
    claims:[{claimId:claim.claimId,status:'answered',sources:[{sourceId:'S1',
     status:'answered',spanIds:[claim.sourceEvidence[0].spanIds[0]]}]}]})};
  }]);
 const plan={...onePartPlan,sources:[{label:'A. Chronicler',role:'primary',bookIds:['88']}],
  parts:[{...onePartPlan.parts[0],question:'What does the narrative describe by the river?',
   sourceBookIds:['88'],candidateSourceIds:['S1']}]};
 const result=await composeEvidenceAnswer('What does the narrative describe by the river?',
  [source],ai,[],{plan,catalog:{88:source.title},trace:true});
 assert.ok(captured.spanCatalog.length>0,'body spans are still offered');
 assert.ok(captured.spanCatalog.every(span=>!isHeadingOnlySpan(span.text)),
  'no heading-only span reaches the reviewer-selectable catalog');
 assert.ok(!captured.spanCatalog.some(span=>span.text.includes('Relation of the Baptist')),
  'the heading text itself is absent from the catalog');
 assert.equal(result.outcome,'verified-source-draft');
});

test('attachScaffoldingToPart copies accepted evidence flagged reviewLinked (B8-1)',()=>{
 const part={answers:[
   {claimId:'P1-C1',text:'First established position.',sourceIds:['S1'],
    renderedText:'First established position. [S1]'},
   {claimId:'P1-C2',text:'A framing restatement.',sourceIds:[],
    renderedText:'A framing restatement.'}],
  evidence:[{sourceId:'S1',claimId:'P1-C1',point:'First established position.',
   quote:'Verbatim span text.',anchorQuote:'Verbatim span text.',start:0,end:18,
   requirementIds:['P1-R1']}]};
 const {attached,invalidLinks}=attachScaffoldingToPart(part,
  [{claimId:'P1-C2',supportClaimIds:['P1-C1']}],{citedIds:new Set(['P1-C1'])});
 assert.equal(invalidLinks,0);
 assert.deepEqual(attached,[{claimId:'P1-C2',supportClaimIds:['P1-C1'],sourceIds:['S1']}]);
 const copy=part.evidence.find(entry=>entry.claimId==='P1-C2');
 assert.equal(copy.reviewLinked,true,'attached copies are flagged as review-linked');
 assert.equal('requirementIds' in copy,false,'requirement IDs are stripped, as inheritance strips them');
 assert.deepEqual(part.answers[1].sourceIds,['S1']);
 assert.equal(part.answers[1].renderedText,'A framing restatement. [S1]');
 // A support the draft never cited is invalid and attaches nothing.
 const fresh={answers:[
   {claimId:'P1-C1',text:'Retained context.',sourceIds:[],renderedText:'Retained context.'},
   {claimId:'P1-C2',text:'Another framing restatement.',sourceIds:[],
    renderedText:'Another framing restatement.'}],evidence:[]};
 const rejected=attachScaffoldingToPart(fresh,
  [{claimId:'P1-C2',supportClaimIds:['P1-C1']}],{citedIds:new Set(['P1-C9'])});
 assert.equal(rejected.invalidLinks,1);
 assert.deepEqual(fresh.answers[1].sourceIds,[]);
});

const scaffoldingPlan={version:'reader-evidence-v2',intent:'compare',
 sources:[{label:'David Hume',role:'primary',bookIds:['35']},
  {label:'Immanuel Kant',role:'primary',bookIds:['40']}],
 parts:[{id:'P1',question:'How do Hume and Kant each explain causal necessity?',
  sourceBookIds:['35','40'],candidateSourceIds:['S1','S2']}],queries:[]};
const scaffoldingDraft='PART P1\nHume explains causal expectation through custom rather than reasoning. [S1]\n'+
 'Kant treats causality as a category supplied by the understanding itself. [S2]\n'+
 'Together, the two accounts treat causal connection as something the mind contributes rather than a power read off from events.';
function scaffoldingReview({links=null,retain=[]}={}){
 return (_model,{messages})=>{
  const payload=parsePayload(messages);
  scaffoldingReview.captured=payload;
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',answerStatus:'answered',
    directAnswerClaimIds:['P1-C1'],retainedContextClaimIds:retain,
    ...(links?{scaffoldingLinks:links}:{})}],
   claims:payload.claims.map(claim=>({claimId:claim.claimId,status:'answered',
    sources:claim.sourceIds.map(sourceId=>({sourceId,status:'answered',
     spanIds:[claim.sourceEvidence.find(item=>item.sourceId===sourceId).spanIds[0]]}))}))})};
 };
}

test('a reviewer scaffolding link cites a framing claim from both accepted siblings (B8-1)',async()=>{
 const ai=makeAI([answer(scaffoldingDraft),
  scaffoldingReview({links:[{claimId:'P1-C3',supportClaimIds:['P1-C1','P1-C2']}]})]);
 const result=await composeEvidenceAnswer('How do Hume and Kant each explain causal necessity?',
  [{...hume,candidatePartIds:['P1']},{...kant,candidatePartIds:['P1']}],ai,[],
  {plan:scaffoldingPlan,catalog,trace:true});
 assert.deepEqual(scaffoldingReview.captured.parts[0].contextClaims,
  [{claimId:'P1-C3',text:'Together, the two accounts treat causal connection as something the mind contributes rather than a power read off from events.',frame:true}],
  'the packet marks the closing uncited claim as a frame claim');
 assert.deepEqual(result.trace.reviewScaffolding.attached,
  [{partId:'P1',claimId:'P1-C3',supportClaimIds:['P1-C1','P1-C2'],sourceIds:['S1','S2']}]);
 assert.equal(result.trace.reviewScaffolding.invalidLinks,0);
 assert.deepEqual(result.trace.reviewScaffolding.repairRound,{attempted:false,resolved:0},
  'a decided frame claim needs no repair round');
 assert.match(result.answer,/mind contributes rather than a power read off from events\. \[S1, S2\]/);
 assert.deepEqual(result.evidenceMap.filter(item=>item.claimId==='P1-C3')
  .map(item=>item.id),['S1','S2'],'both supports’ evidence entries ride on the framing claim');
 assert.equal(result.trace.claimInheritance,undefined,
  'inheritance never double-attaches a claim the reviewer already linked');
 assert.equal(ai.calls.length,2);
});

test('a scaffolding link naming a rejected support is invalid and attaches nothing (B8-1)',async()=>{
 const rejectingReview=(_model,{messages})=>{
  const payload=parsePayload(messages);
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',answerStatus:'answered',
    directAnswerClaimIds:['P1-C1'],retainedContextClaimIds:['P1-C3'],
    scaffoldingLinks:[{claimId:'P1-C3',supportClaimIds:['P1-C2']}]}],
   claims:payload.claims.map(claim=>{
    const rejected=claim.claimId==='P1-C2';
    return {claimId:claim.claimId,status:rejected?'partial':'answered',
     sources:claim.sourceIds.map(sourceId=>({sourceId,
      status:rejected?'partial':'answered',
      spanIds:rejected?[]:[claim.sourceEvidence
       .find(item=>item.sourceId===sourceId).spanIds[0]]}))};
   })})};
 };
 // Batch 10 (B10-3) note: the framing claim below used to restate the
 // rejected Kant claim ("a category the understanding supplies…"),
 // sharing 5 of its 10 content terms with it — an overlap coefficient
 // of exactly 0.5 — so rejection containment now drops it as a
 // softened rewrite, independently of the link question this fixture
 // pins. The frame is worded as a non-restating comparison so the two
 // mechanisms' fixtures stay independent: this test is about the
 // invalid link, and the claim it targets is not a rewrite of the
 // rejected claim.
 const ai=makeAI([answer('PART P1\nHume explains causal expectation through custom rather than reasoning. [S1]\n'+
   'Kant treats causality as an a priori category that the understanding supplies to experience when it organizes the manifold of intuition into objective judgments. [S2]\n'+
   'So the two accounts part company over where causal connection is located.'),
  rejectingReview]);
 const result=await composeEvidenceAnswer('How do Hume and Kant each explain causal necessity?',
  [{...hume,candidatePartIds:['P1']},{...kant,candidatePartIds:['P1']}],ai,[],
  {plan:scaffoldingPlan,catalog,trace:true});
 assert.deepEqual(result.trace.reviewScaffolding.attached,[]);
 assert.equal(result.trace.reviewScaffolding.invalidLinks,1,
  'the rejected claim cannot support a link; the invalid link is counted, not fatal');
 assert.deepEqual(result.trace.reviewScaffolding.repairRound,{attempted:false,resolved:0});
 assert.match(result.answer,/the two accounts part company over where causal connection is located\./,
  'the framing claim still ships, as plain context');
 assert.doesNotMatch(result.answer,/causal connection is located\. \[S/);
 assert.equal(ai.calls.length,2,'no repair round fires: the claim shares too little with the accepted sibling to be a plausible restatement');
});

test('a retained frame claim with no decision gets one scaffolding repair round (B8-1)',async()=>{
 const ai=makeAI([answer(scaffoldingDraft),
  scaffoldingReview({retain:['P1-C3']}),
  {response:JSON.stringify({decisions:[{partId:'P1',claimId:'P1-C3',action:'link',
   supportClaimIds:['P1-C1','P1-C2']}]})}]);
 const result=await composeEvidenceAnswer('How do Hume and Kant each explain causal necessity?',
  [{...hume,candidatePartIds:['P1']},{...kant,candidatePartIds:['P1']}],ai,[],
  {plan:scaffoldingPlan,catalog,trace:true});
 assert.deepEqual(result.trace.reviewScaffolding.repairRound,{attempted:true,resolved:1});
 assert.deepEqual(result.trace.reviewScaffolding.attached,
  [{partId:'P1',claimId:'P1-C3',supportClaimIds:['P1-C1','P1-C2'],sourceIds:['S1','S2']}],
  'the repair round’s link is applied through the same validation path');
 assert.match(result.answer,/mind contributes rather than a power read off from events\. \[S1, S2\]/);
 assert.equal(ai.calls.length,3,'compose, review, and exactly one scaffolding repair round');
});

test('a non-frame context claim ships unchanged and triggers no repair round (B8-1)',async()=>{
 let captured;
 const retainingReview=(_model,{messages})=>{
  const payload=parsePayload(messages);captured=payload;
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',answerStatus:'answered',
    directAnswerClaimIds:['P1-C1'],retainedContextClaimIds:['P1-C2']}],
   claims:payload.claims.map(claim=>({claimId:claim.claimId,status:'answered',
    sources:claim.sourceIds.map(sourceId=>({sourceId,status:'answered',
     spanIds:[claim.sourceEvidence.find(item=>item.sourceId===sourceId).spanIds[0]]}))}))})};
 };
 // Batch 9 (B9-4): the part carries four claims so the context claim
 // stays genuinely mid-part — in a three-claim part the middle claim
 // is the penultimate claim and is frame under the extended marking.
 const ai=makeAI([answer('PART P1\nHume explains causal expectation through custom rather than reasoning. [S1]\n'+
   'This distinction frames the disagreement that follows.\n'+
   'Hume grounds the idea of necessity in repeated conjunction and custom. [S1]\n'+
   'Hume treats the inference from cause to effect as an effect of custom rather than reasoning. [S1]'),
  retainingReview]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],
  {plan:onePartPlan,catalog,trace:true});
 assert.deepEqual(captured.parts[0].contextClaims,
  [{claimId:'P1-C2',text:'This distinction frames the disagreement that follows.'}],
  'a mid-part uncited claim carries no frame mark');
 assert.match(result.answer,/This distinction frames the disagreement that follows\./);
 assert.doesNotMatch(result.answer,/disagreement that follows\. \[S1\]/);
 assert.deepEqual(result.trace.reviewScaffolding,
  {attached:[],invalidLinks:0,repairRound:{attempted:false,resolved:0}});
 assert.equal(ai.calls.length,2,'no extra call of any kind');
});

// B8-2 fixtures in the Smith shape: round 1 rejects claim C2's citations;
// an answer repair is adopted; what the repair ships decides whether the
// archive matters.
const archiveDraft='PART P1\nHume grounds causal necessity in repeated conjunction and custom. [S1]\n'+
 'Hume insists that necessity is a power perceived directly in the objects themselves. [S1]\n'+
 'The account rests on observed regularities.';
function archiveFirstReview(_model,{messages}){
 const payload=parsePayload(messages);
 return {response:JSON.stringify({parts:[{partId:'P1',status:'partial',answerStatus:'partial',
   repairable:true,directAnswerClaimIds:['P1-C1'],retainedContextClaimIds:['P1-C3']}],
  claims:payload.claims.map(claim=>{
   const rejected=claim.claimId==='P1-C2';
   return {claimId:claim.claimId,status:rejected?'partial':'answered',
    sources:claim.sourceIds.map(sourceId=>({sourceId,
     status:rejected?'partial':'answered',
     spanIds:rejected?[]:[claim.sourceEvidence
      .find(item=>item.sourceId===sourceId).spanIds[0]]}))};
  })})};
}
function archiveReReview(acceptRestated){
 const fn=(_model,{messages})=>{
  const payload=parsePayload(messages);
  fn.captured=payload;
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',answerStatus:'answered',
    directAnswerClaimIds:['P1-C1'],retainedContextClaimIds:['P1-C3',
     ...(acceptRestated?[]:['P1-C2'])]}],
   claims:payload.claims.map(claim=>({claimId:claim.claimId,status:'answered',
    sources:claim.sourceIds.map(sourceId=>({sourceId,status:'answered',
     spanIds:[claim.sourceEvidence.find(item=>item.sourceId===sourceId).spanIds[0]]}))}))})};
 };
 return fn;
}

test('containment reaches across rounds through the rejection archive (B8-2)',async()=>{
 const reReview=archiveReReview(false);
 const ai=makeAI([answer(archiveDraft),archiveFirstReview,
  {response:JSON.stringify({parts:[{partId:'P1',
   replacements:[{claimId:'P1-C2',
    text:'Necessity is a power perceived directly in the objects themselves.'}],
   additions:[]}]})},
  reReview]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],
  {plan:onePartPlan,catalog,trace:true});
 assert.equal(ai.calls.length,4,'compose, first review, answer repair, re-review');
 assert.deepEqual(reReview.captured.parts[0].priorRejections,
  ['Hume insists that necessity is a power perceived directly in the objects themselves.'],
  'the re-review packet carries the first round’s rejected claim text');
 assert.deepEqual(result.trace.rejectionArchive,{count:1,partIds:['P1']});
 // Batch 10 (B10-3): the recorded measure is the overlap coefficient —
 // all 6 of the restatement's terms live inside the rejected claim's 8,
 // so it records 1, not the one-sided 6/8 = 0.75. The catch itself is
 // unchanged.
 assert.deepEqual(result.trace.rejectionContainment,
  [{partId:'P1',claimId:'P1-C2',matchedRejectedClaimId:'P1-C2',containment:1,viaArchive:true}],
  'the adopted repair re-shipped the rejected proposition as uncited context; the archive still catches it');
 assert.doesNotMatch(result.answer,/power perceived directly/,
  'the laundered restatement is dropped from the shipped answer');
 assert.match(result.answer,/grounds causal necessity in repeated conjunction and custom\. \[S1\]/);
 assert.match(result.answer,/The account rests on observed regularities\./,
  'unrelated retained context is untouched');
});

test('a repair that genuinely fixes support ships the claim cited (B8-2 control)',async()=>{
 const reReview=archiveReReview(true);
 const ai=makeAI([answer(archiveDraft),archiveFirstReview,
  {response:JSON.stringify({parts:[{partId:'P1',
   replacements:[{claimId:'P1-C2',
    text:'Hume presents necessity as a power perceived directly in the objects themselves. [S1]'}],
   additions:[]}]})},
  reReview]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],
  {plan:onePartPlan,catalog,trace:true});
 assert.deepEqual(result.trace.rejectionArchive,{count:1,partIds:['P1']},
  'the first round’s rejection is still archived');
 assert.equal(result.trace.rejectionContainment,undefined,
  'nothing is contained: the repaired claim ships cited and accepted');
 assert.match(result.answer,/power perceived directly in the objects themselves\. \[S1\]/);
});

test('more than six missing source decisions degrade to a round-robin repair subset (batch 10 B10-2)',async()=>{
 // Both parts' reviewers decide S1 for every claim and omit S2
 // entirely: 8 missing claim-source decisions, 4 per part. Before
 // batch 10 the count alone blocked the repair (limit 6) and nothing
 // was attempted. Now six are attempted, split 3/3 across the parts
 // by the round-robin selection — a prefix slice would have taken
 // P1's four and only two of P2's — and the two unrepaired decisions
 // keep their fail-closed recovered treatment.
 const s1OnlyReview=(_model,{messages})=>{
  const payload=parsePayload(messages);
  const partIds=[...new Set(payload.claims.map(claim=>claim.partId))];
  return {response:JSON.stringify({parts:partIds.map(partId=>({partId,
     status:'answered',answerStatus:'answered',
     directAnswerClaimIds:[payload.claims.find(claim=>claim.partId===partId).claimId],
     retainedContextClaimIds:[]})),
   claims:payload.claims.map(claim=>({claimId:claim.claimId,status:'answered',
    sources:[{sourceId:'S1',status:'answered',
     spanIds:[claim.sourceEvidence.find(item=>item.sourceId==='S1').spanIds[0]],
     subjectAttributionStatus:'supported',attributedSubject:'Hume'}]}))})};
 };
 const repairCall={captured:null};
 const repairDecisions=(_model,{messages})=>{
  const payload=JSON.parse(messages[1].content);
  repairCall.captured=payload;
  return {response:JSON.stringify({decisions:payload.decisions.map(decision=>({
   claimId:decision.claimId,sourceId:decision.sourceId,status:'answered',
   spanIds:decision.spanIds.slice(0,1),attributionStatus:'not_applicable',
   attributedSpeaker:'',subjectAttributionStatus:'supported',
   attributedSubject:decision.sourceId==='S1'?'Hume':'Kant'}))})};
 };
 const dualPlan={version:'reader-evidence-v2',intent:'compare',
  sources:[{label:'David Hume',role:'primary',bookIds:['35']},
   {label:'Immanuel Kant',role:'primary',bookIds:['40']}],
  parts:[
   {id:'P1',question:'How do Hume and Kant each explain causal necessity?',
    sourceBookIds:['35','40'],candidateSourceIds:['S1','S2']},
   {id:'P2',question:'How do Hume and Kant differ on causal necessity?',
    sourceBookIds:['35','40'],candidateSourceIds:['S1','S2']}],
  queries:[]};
 const ai=makeAI([answer('PART P1\n'+
   'Hume explains causal expectation through custom rather than reasoning, while Kant treats causality as an a priori category. [S1, S2]\n'+
   'For Hume necessity arises from repeated conjunction, while for Kant the understanding supplies the category itself. [S1, S2]\n'+
   'Hume grounds inference in habit formed by experience, while Kant grounds it in the structure of the understanding. [S1, S2]\n'+
   'Hume denies that reason perceives necessary connection, while Kant locates the connection in a category of relation. [S1, S2]\n'+
   'PART P2\n'+
   'The contrast begins with custom on one side and an a priori category on the other. [S1, S2]\n'+
   'Necessity and causation arise for Hume from constant conjunction, while the categories are for Kant pure conceptions of the understanding. [S1, S2]\n'+
   'Necessity for Hume is a determination of the mind, while for Kant it is a condition of objective judgment. [S1, S2]\n'+
   'The two accounts divide over whether causal connection is found in objects or contributed by the understanding. [S1, S2]'),
  s1OnlyReview,s1OnlyReview,repairDecisions]);
 const result=await composeEvidenceAnswer('How do Hume and Kant differ about causal necessity?',
  [{...hume,candidatePartIds:['P1','P2']},{...kant,candidatePartIds:['P1','P2']}],ai,[],
  {plan:dualPlan,catalog,trace:true});
 assert.deepEqual(result.trace.reviewRepair,
  {attempted:true,requestedCount:8,attemptedCount:6,applied:true,reason:'complete'},
  'the repair runs on a subset instead of not running at all');
 assert.deepEqual(repairCall.captured.decisions.map(decision=>decision.claimId),
  ['P1-C1','P2-C1','P1-C2','P2-C2','P1-C3','P2-C3'],
  'the subset alternates across parts instead of exhausting the first part');
 assert.equal(ai.calls.length,4,'compose, two reviews, one repair call');
 assert.match(result.answer,/an a priori category\. \[S1, S2\]/,
  'a repaired claim ships with both citations');
 assert.deepEqual(result.questionParts.map(part=>part.claimIds),
  [['P1-C1','P1-C2','P1-C3'],['P2-C1','P2-C2','P2-C3']],
  'the six repaired claims ship; the two unrepaired ones keep the '+
  'fail-closed treatment — a claim citing two book groups with only '+
  'one group’s support decided is omitted, not shipped narrowed');
 assert.doesNotMatch(result.answer,/a category of relation\./);
});

test('a part missing from the review contract suppresses a tied two-part answer (B8-5)',async()=>{
 const dispatcher=(_model,{messages})=>{
  const system=String(messages[0].content||'');
  if(system.includes('missing source decisions'))return {response:'{}'};
  const payload=parsePayload(messages);
  if(payload.parts[0].partId==='P1'){
   // The reviewer decides only the first of P1's two cited claims: the
   // part contract is incomplete and the part is excluded.
   const claim=payload.claims[0];
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',answerStatus:'answered',
     directAnswerClaimIds:[claim.claimId],retainedContextClaimIds:[]}],
    claims:[{claimId:claim.claimId,status:'answered',sources:[{sourceId:'S1',
     status:'answered',spanIds:[claim.sourceEvidence[0].spanIds[0]]}]}]})};
  }
  return review([['P2','answered']])(_model,{messages});
 };
 const ai=makeAI([answer('PART P1\nHume explains causal expectation through custom rather than reasoning. [S1]\n'+
   'Hume grounds the idea of necessity in repeated conjunction and custom. [S1]\n'+
   'PART P2\nKant treats causality as a category of relation. [S2]'),
  dispatcher,dispatcher,dispatcher,dispatcher]);
 const plan={...twoSidePlan,parts:twoSidePlan.parts.slice(0,2)};
 const result=await composeEvidenceAnswer('Summarize Hume on causal necessity and Kant on causality.',
  [{...hume,candidatePartIds:['P1']},{...kant,candidatePartIds:['P2']}],ai,[],
  {plan:{...plan,intent:'explain'},catalog,trace:true});
 assert.deepEqual(result.trace.reviewCompletion.unvalidatedPartIds,['P1']);
 assert.equal(result.reviewStatus,'pipeline-failed',
  'the answer reports the review-contract failure that caused suppression');
 assert.equal(result.outcome,'generation-failed',
  'one unvalidated part out of two is a tie and suppresses the answer');
 assert.equal(result.answer,'I could not complete a reliable answer this time. Please try again.');
 assert.ok(result.questionParts.every(part=>part.answerStatus==='unanswered'));
});

test('inheritance never attaches to a heading-only claim (B8-6a)',async()=>{
 const source={id:'S1',bookId:'73',title:'The Fall of the Empire — A. Chronicler',page:4,
  text:'The chronicle attributes the decline to internal decay within the court, where faction consumed the treasury and the roads went unrepaired for a generation.',
  preview:'The chronicle attributes the decline to internal decay within the court.'};
 const plan={...onePartPlan,sources:[{label:'A. Chronicler',role:'primary',bookIds:['73']}],
  parts:[{...onePartPlan.parts[0],question:'Why did the empire decline?',
   sourceBookIds:['73'],candidateSourceIds:['S1']}]};
 const ai=makeAI([answer('PART P1\nThe chronicle attributes the decline to internal decay within the court. [S1]\n'+
   '**Internal Decay**'),
  review([['P1','answered']]),
  {response:JSON.stringify({decisions:[{partId:'P1',claimId:'P1-C2',
   action:'context',supportClaimIds:[]}]})}]);
 const result=await composeEvidenceAnswer('Why did the empire decline?',[source],ai,[],
  {plan,catalog:{73:source.title},trace:true});
 assert.equal(result.trace.claimInheritance,undefined,
  'batch 7 attached the sibling’s spans to this heading at full coverage; B8-6a forbids it');
 assert.match(result.answer,/\*\*Internal Decay\*\*/,'the heading still ships as context');
 assert.doesNotMatch(result.answer,/\*\*Internal Decay\*\* \[S1\]/);
 assert.ok(!result.evidenceMap.some(item=>item.claimId==='P1-C2'));
});

test('list lead-in detection reads the shipped segment (B8-6a)',()=>{
 const answers=[
  {claimId:'P1-C1',text:'The harbor towns grew rich on steady trade winds.',
   renderedText:'The harbor towns grew rich on steady trade winds. [S1]',
   sourceIds:['S1'],paragraphIndex:0},
  {claimId:'P1-C2',text:'The strategy rests on two supports:',
   renderedText:'The strategy rests on two supports:',sourceIds:[],paragraphIndex:1},
  {claimId:'P1-C3',text:'Patient capital and careful maintenance.',
   renderedText:'- Patient capital\n- Careful maintenance',sourceIds:[],paragraphIndex:1}];
 assert.equal(isListLeadInAnswer(answers,answers[1]),true,
  'a colon claim whose segment continues with list lines is a lead-in');
 assert.equal(isListLeadInAnswer(answers,answers[0]),false,
  'a claim without a trailing colon is never a lead-in');
 const prose=[...answers.slice(0,2),
  {claimId:'P1-C3',text:'Patient capital mattered most of all.',
   renderedText:'Patient capital mattered most of all.',sourceIds:[],paragraphIndex:1}];
 assert.equal(isListLeadInAnswer(prose,prose[1]),false,
  'a colon claim followed by prose is not a lead-in');
});

// B8-6b fixtures: two invented books. Book A (S1, the Northern League
// annals) and book B (S2, the Coastal Watch log).
const leagueSourceA={id:'S1',bookId:'601',title:'Annals of the Northern League — R. Calloway',page:11,
 text:'The harbors and guilds set the tolls that kept channels open to the tides and beacons. Pilots read the currents and marked their charts each night.',
 preview:'The harbors and guilds set the tolls that kept channels open.'};
const leagueSourceB={id:'S2',bookId:'602',title:'Log of the Coastal Watch — M. Ferreira',page:23,
 text:'The guilds recorded tolls in ledgers and watched for storms along the coast.',
 preview:'The guilds recorded tolls in ledgers.'};
const leaguePlan={version:'reader-evidence-v2',intent:'explain',
 sources:[{label:'R. Calloway',role:'primary',bookIds:['601']},
  {label:'M. Ferreira',role:'primary',bookIds:['602']}],
 parts:[{id:'P1',question:'What held the league together?',
  sourceBookIds:['601','602'],candidateSourceIds:['S1','S2']}],queries:[]};
const leagueCatalog={601:leagueSourceA.title,602:leagueSourceB.title};

test('inheritance draws only on the anchor book when the second book cannot qualify alone (B8-6b)',async()=>{
 // The thesis has 13 content terms (bar 7). Book A's claims cover 8 of
 // them together (5 + 3 disjoint); book B's claim covers 4 and cannot
 // qualify alone. Batch 7's greedy accumulation reached the bar
 // through A1 + B1 first and attached both books; the pool discipline
 // attaches book A only.
 const ai=makeAI([answer('PART P1\nThe harbors and guilds set the tolls that kept channels open to the tides and beacons. [S1]\n'+
   'The guilds recorded tolls in ledgers and watched for storms along the coast. [S2]\n'+
   'Pilots read the currents and marked their charts each night. [S1]\n'+
   'The league rested on harbors, guilds, tolls, channels, tides, charts, storms, pilots, ledgers, beacons, currents, and markets.'),
  review([['P1','answered']]),
  {response:JSON.stringify({decisions:[{partId:'P1',claimId:'P1-C4',
   action:'context',supportClaimIds:[]}]})}]);
 const result=await composeEvidenceAnswer('What held the league together?',
  [leagueSourceA,leagueSourceB],ai,[],{plan:leaguePlan,catalog:leagueCatalog,trace:true});
 assert.deepEqual(result.trace.claimInheritance,
  [{partId:'P1',claimId:'P1-C4',sourceIds:['S1'],coverageRatio:0.615}],
  'only the anchor book’s claims contribute');
 assert.match(result.answer,/currents, and markets\. \[S1\]/);
 assert.doesNotMatch(result.answer,/markets\. \[S1, S2\]/);
});

test('inheritance draws on both books when each qualifies alone (B8-6b)',async()=>{
 // The thesis has 10 content terms (bar 5); book A's claim covers 5
 // and book B's claim covers the other 5 — each side independently
 // established, so both books may contribute.
 const sourceA={...leagueSourceA,text:'The guilds pooled tolls for the harbor works each year, and the annals record the levy in full.',
  preview:'The guilds pooled tolls for the harbor works each year.'};
 const sourceB={...leagueSourceB,text:'The councils bound the passes with watchtowers and signal fires.',
  preview:'The councils bound the passes with watchtowers and signal fires.'};
 const ai=makeAI([answer('PART P1\nThe guilds pooled tolls for the harbor works each year. [S1]\n'+
   'The councils bound the passes with watchtowers and signal fires. [S2]\n'+
   'The guilds pooled tolls for the harbor works, and the councils bound the passes with watchtowers and signal fires.'),
  review([['P1','answered']]),
  {response:JSON.stringify({decisions:[{partId:'P1',claimId:'P1-C3',
   action:'context',supportClaimIds:[]}]})}]);
 const result=await composeEvidenceAnswer('What held the league together?',
  [sourceA,sourceB],ai,[],{plan:leaguePlan,catalog:leagueCatalog,trace:true});
 assert.deepEqual(result.trace.claimInheritance,
  [{partId:'P1',claimId:'P1-C3',sourceIds:['S1','S2'],coverageRatio:1}],
  'a genuine two-sided restatement inherits from both books');
 assert.match(result.answer,/watchtowers and signal fires\. \[S1, S2\]/);
});

test('a transient answer-stage failure is retried once and recovers (B8-7)',async()=>{
 const ai=makeAI([new Error('Provider returned 502'),new Error('Provider returned 502'),
  answer('PART P1\nHume links necessity to custom and regular conjunction. [S1]'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],
  {plan:onePartPlan,catalog,trace:true});
 assert.equal(result.outcome,'verified-source-draft',
  'the retried build ships its answer');
 assert.deepEqual(result.trace.answerRetry,
  {code:'answer-request-failed',outcome:'recovered'});
 assert.equal(ai.calls.length,4,
  'two failed compose attempts in the first build, compose + review in the retry');
});

test('transport diagnostics retain both whole-build attempts after a transient retry',async()=>{
 const ai=makeAI([new Error('Provider unavailable'),new Error('Provider unavailable'),
  new Error('Provider unavailable'),new Error('Provider unavailable')]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],
  {plan:onePartPlan,catalog,trace:true,transportDiagnostics:true});
 assert.equal(result.outcome,'generation-failed');
 assert.equal(result.trace.answerRetry.outcome,'failed-again');
 assert.equal(result.trace.answerRetry.attemptCount,2);
 const attempts=result.trace.answerRetry.attempts;
 assert.deepEqual(attempts.map(item=>item.attempt),[1,2]);
 assert.deepEqual(attempts.map(item=>item.stageTimings.map(stage=>stage.stage)),
  [['compose','compose'],['compose','compose']]);
 assert.ok(attempts.every(item=>Number.isFinite(item.timingSummary?.buildWallMs)));
 assert.equal(result.trace.timingSummary.totalBuildWallMs,
  attempts.reduce((sum,item)=>sum+item.timingSummary.buildWallMs,0));
 assert.equal(result.trace.timingSummary.totalReviewWallMs,
  attempts.reduce((sum,item)=>sum+item.timingSummary.reviewWallMs,0));
 assert.ok(result.trace.timingSummary.totalElapsedMs>=result.trace.timingSummary.totalBuildWallMs-2);
 assert.equal(result.trace.stageTimings.length,2,
  'legacy stageTimings continues to describe the returned attempt; answerRetry holds both attempts');
});

test('streaming whole-build deadline failure gets the registered one retry (Batch 21 F2)',async()=>{
 const timeout=Object.assign(new Error('Inference deadline exceeded'),{
  code:'inference-deadline-exceeded',stage:'compose'});
 const answerText='PART P1\nHume links necessity to custom and regular conjunction. [S1]';
 const reviewCall=reviewWithSubjects([['P1','answered']]);
 const wire=value=>'data: '+JSON.stringify({response:value})+'\n\ndata: [DONE]\n\n';
 const asStream=value=>new ReadableStream({start(controller){
  controller.enqueue(new TextEncoder().encode(wire(value)));controller.close();
 }});
 let calls=0;
 const ai={run:async(_model,request)=>{
  calls++;
  if(calls===1)throw timeout;
  if(calls===2)return asStream(answerText);
  const reviewed=reviewCall(_model,{messages:request.messages});
  return asStream(reviewed.response);
 }};
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],
  {plan:onePartPlan,catalog,trace:true,inferenceTransport:'streaming',transportDiagnostics:true});
 assert.equal(result.outcome,'verified-source-draft');
 assert.equal(result.trace.answerRetry.code,'inference-deadline-exceeded');
 assert.equal(result.trace.answerRetry.outcome,'recovered');
 assert.equal(result.trace.answerRetry.attemptCount,2);
 assert.equal(calls,3,'the first deadline failure is followed by one whole build: compose plus review');
});

test('a complete buffered review survives a missing stream terminal event after contract validation',async()=>{
 const timeout=Object.assign(new Error('Inference deadline exceeded'),{
  code:'inference-deadline-exceeded',stage:'review',
  partialResponse:JSON.stringify({parts:[{partId:'P1',status:'answered',
   answerStatus:'answered',directAnswerClaimIds:['P1-C1'],retainedContextClaimIds:[]}],
   claims:[{claimId:'P1-C1',status:'answered',sources:[{sourceId:'S1',
   status:'answered',spanIds:['S1-Q1'],attributionStatus:'not_applicable',
    subjectAttributionStatus:'supported',attributedSubject:'Hume',
    evidenceRole:'work-assertion',supportBoundary:'The span supports the claim.'}]}]})
 });
 const ai={calls:[],run:async(model,request)=>{
  ai.calls.push({model,request});
  if(ai.calls.length===1){
   const response='PART P1\nHume links necessity to custom and regular conjunction. [S1]';
   const wire='data: '+JSON.stringify({response})+'\n\ndata: [DONE]\n\n';
   const bytes=new TextEncoder().encode(wire);
   return new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}});
  }
  throw timeout;
 }};
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],
  {plan:onePartPlan,catalog,trace:true,inferenceTransport:'streaming'});
 assert.equal(result.outcome,'verified-source-draft');
 assert.equal(result.questionParts[0].answerStatus,'answered');
 assert.deepEqual(result.trace.partialReviewResponseRecovery,{
  recoveredPartIds:['P1'],contractValidated:true,providerInferenceCancellation:'unconfirmed'});
 assert.equal(result.trace.reviewRetry,undefined,'the timed-out request is never replayed');
 assert.equal(ai.calls.length,2);
});

test('a timed-out part in a two-part answer suppresses the tie (Batch 21)',async()=>{
 const draft='PART P1\nHume explains causal expectation through custom. [S1]\n'+
  'PART P2\nKant says “a priori” knowledge guarantees both certainty and moral liberty. [S2]';
 const timeout=Object.assign(new Error('Review response was truncated'),{
  code:'review-output-truncated',stage:'review'});
 const dispatcher=(_model,{messages})=>parsePayload(messages).parts[0].partId==='P2'?
  (()=>{throw timeout;})():review([['P1','answered']])(_model,{messages});
 const ai=makeAI([answer(draft),dispatcher,dispatcher]);
 const result=await composeEvidenceAnswer('How do Hume and Kant explain causality?',
  [hume,kant],ai,[],{plan:{...twoSidePlan,intent:'explain',parts:twoSidePlan.parts.slice(0,2)},
   catalog,trace:true});
 const second=result.questionParts.find(part=>part.partId==='P2');
 assert.equal(result.answer,'I could not complete a reliable answer this time. Please try again.');
 assert.equal(second.answerStatus,'unanswered');
 assert.equal(second.status,'unsupported');
 assert.equal(result.outcome,'generation-failed');
 assert.equal(result.trace.reviewCompletion.disposition,'suppressed-not-strict-minority');
});

test('a citation-validation failure is never retried (B8-7)',async()=>{
 const ai=makeAI([
  answer('PART P1\nHume links necessity to custom. [S99]\n\nPART P2\nKant describes causality as a priori. [S1]'),
  review([['P1','answered'],['P2','answered']])]);
 const result=await composeEvidenceAnswer('How do Hume and Kant explain necessity?',
  [{...hume,candidatePartIds:['P1']},{...kant,candidatePartIds:['P2']}],ai,[],
  {plan:{...twoSidePlan,intent:'explain',parts:twoSidePlan.parts.slice(0,2)},catalog,trace:true});
 assert.equal(result.outcome,'generation-failed');
 assert.equal(result.failureCode,'answer-citation-validation-failed');
 assert.equal(result.trace.answerRetry,undefined,
  'validation failures are logic outcomes, not provider transients');
 assert.equal(ai.calls.length,1,'exactly one build was attempted');
});

// ---------------------------------------------------------------------------
// Batch 9 (B9-8): whole-paragraph bold unwrap. The live defect: a part's
// opening paragraph ships fully wrapped in one balanced **…** pair with
// the section title as its first words — the seam scan only looks for
// UNBALANCED bold, so it shipped, and the client rendered the whole
// paragraph bold with the title inline.
// ---------------------------------------------------------------------------
test('bold unwrap strips a whole-paragraph wrap and spares labels, titles, and short bold lines (batch 9 B9-8)',()=>{
 const wrapped='**Faith as a Paradoxical Encounter In Philosophical Fragments, the pseudonymous speaker describes faith as the result of an encounter between Reason and the Paradox [S1]. This encounter occurs in a Moment where Reason sets itself aside to allow the Paradox to bestow itself upon the learner [S1].**';
 const unwrapped=unwrapBoldWrappedParagraphs(wrapped);
 assert.equal(unwrapped.count,1);
 assert.equal(unwrapped.text,wrapped.slice(2,-2),
  'only the outer marker pair is removed; text and citations are byte-identical');
 // (b) a short fully-bold single-sentence paragraph is under the threshold.
 const short='**The individual stands higher than the universal.**';
 assert.deepEqual(unwrapBoldWrappedParagraphs(short),{text:short,count:0});
 // (c) a bold lead-in label followed by prose is not a wrap.
 const leadIn='**Non-Rationality:** The leap is not a conclusion of reason but a movement of the whole person toward what reason cannot settle.';
 assert.deepEqual(unwrapBoldWrappedParagraphs(leadIn),{text:leadIn,count:0});
 // (d) a standalone bold title line is the client heading case.
 const title='**Section Title**';
 assert.deepEqual(unwrapBoldWrappedParagraphs(title),{text:title,count:0});
 // Two separate bold spans in one block are not one wrap.
 const twoSpans='**Alpha is the first point.** **Beta is the second point, stated just as plainly.**';
 assert.deepEqual(unwrapBoldWrappedParagraphs(twoSpans),{text:twoSpans,count:0});
 // The underscore form unwraps on length alone (one long sentence).
 const underscore='__A single wrapped sentence that keeps developing its one long point with clause after clause, adding circumstance and qualification and example, until the sentence itself runs well past two hundred characters of continuous prose in total.__';
 const unUnderscored=unwrapBoldWrappedParagraphs(underscore);
 assert.equal(unUnderscored.count,1);
 assert.equal(unUnderscored.text,underscore.slice(2,-2));
 // Paragraphs around a wrapped one are untouched.
 const mixed='Opening prose stays as it is.\n\n'+wrapped+'\n\nClosing prose stays as it is.';
 const mixedResult=unwrapBoldWrappedParagraphs(mixed);
 assert.equal(mixedResult.count,1);
 assert.equal(mixedResult.text,'Opening prose stays as it is.\n\n'+wrapped.slice(2,-2)+'\n\nClosing prose stays as it is.');
 // The orphaned opener: claim validation strips a paragraph-final
 // marker, so the shipped segment often carries only the opening **.
 const orphaned='**Necessity and Custom Hume explains that our idea of necessity arises from the uniformity observable in nature [S1]. The mind is then determined by custom to infer one event from the other [S1].';
 const orphanResult=unwrapBoldWrappedParagraphs(orphaned);
 assert.equal(orphanResult.count,1);
 assert.equal(orphanResult.text,orphaned.slice(2));
 // A short orphaned opener stays — it is a fragment, not a paragraph.
 const shortOrphan='**A stray label fragment';
 assert.deepEqual(unwrapBoldWrappedParagraphs(shortOrphan),{text:shortOrphan,count:0});
});

test('composer prompt keeps titles on their own line and paragraphs out of bold (batch 9 B9-8)',()=>{
 assert.match(COMPOSER_PROMPT,/Keep each section title on its own line, and never wrap a paragraph in bold/);
 assert.match(COMPOSER_PROMPT,/bold is for a short label or lead-in phrase only/);
});

test('Batch 16 prompts preserve verbatim question anchors and explicit evidence scope',()=>{
 assert.match(COMPOSER_PROMPT,/questionAnchor is a verbatim excerpt from the reader.s current question/i);
 assert.match(COMPOSER_PROMPT,/treat the anchor as a guide, not a lexical completion test or evidence/i);
 assert.match(COMPOSER_PROMPT,/work.s own position, a view it reports, narrative voice, and editorial context/i);
 assert.match(REVIEW_PROMPT,/evidenceRole.*supportBoundary/);
 assert.match(REVIEW_PROMPT,/work-assertion\|reported-position\|character-or-narrator\|editorial-context\|unclear/);
 assert.match(REVIEW_PROMPT,/what the accepted span establishes and the relevant limit/i);
});

test('final assembly unwraps every part opener wrapped in bold (batch 9 B9-8)',async()=>{
 const sage={id:'S3',bookId:'99',title:'Groundwork Sketches — C. Sage',page:12,
  text:'Custom in reasoning is a settled readiness to pass from one idea to another without fresh proof each time. The readiness grows through repetition and quietly shapes what a person expects to find.',
  preview:'Custom in reasoning is a settled readiness to pass from one idea to another.'};
 const plan={version:'reader-evidence-v2',intent:'explain',
  sources:[{label:'David Hume',role:'primary',bookIds:['35']},
   {label:'Immanuel Kant',role:'primary',bookIds:['40']},
   {label:'C. Sage',role:'primary',bookIds:['99']}],
  parts:[
   {id:'P1',question:'How does Hume explain causal necessity?',sourceBookIds:['35'],candidateSourceIds:['S1']},
   {id:'P2',question:'How does Kant explain causality?',sourceBookIds:['40'],candidateSourceIds:['S2']},
   {id:'P3',question:'How does Sage describe custom in reasoning?',sourceBookIds:['99'],candidateSourceIds:['S3']}]};
 const opener=(title,first,second)=>'**'+title+' '+first+' '+second+'**';
 const draft=[
  'PART P1\n'+opener('Necessity and Custom',
   'Hume explains that our idea of necessity arises from the uniformity observable in nature, where similar objects are constantly conjoined [S1].',
   'The mind is then determined by custom to infer one event from the other whenever the first appears [S1].'),
  'PART P2\n'+opener('Causality as a Category',
   'Kant explains that causality is one of the categories of relation, a pure conception of the understanding [S2].',
   'The categories are a priori, so the causal relation is contributed by the mind rather than copied from impressions [S2].'),
  'PART P3\n'+opener('Custom as Readiness',
   'Sage describes custom in reasoning as a settled readiness to pass from one idea to another without fresh proof [S3].',
   'The readiness grows through repetition and quietly shapes what a person expects to find in new cases [S3].')
 ].join('\n');
 const reviewAll=review([['P1','answered'],['P2','answered'],['P3','answered']]);
 const ai=makeAI([answer(draft),reviewAll,reviewAll,reviewAll]);
 const result=await composeEvidenceAnswer(
  'How do Hume, Kant, and Sage each explain the grounds of causal inference?',
  [hume,kant,sage],ai,[],{plan,catalog:{...catalog,99:'Groundwork Sketches — C. Sage'},trace:true});
 // The accepted review supports the answer; final rendering unwraps each
 // full-paragraph bold wrapper while preserving the sentence text.
 assert.equal(result.outcome,'verified-source-draft');
 assert.deepEqual(result.trace.formattingNormalizations,
  {boldParagraphsUnwrapped:3,partIds:['P1','P2','P3']},
  'all three wrapped part openers are unwrapped and traced');
 assert.ok(!result.answer.includes('**'),
  'no bold markers survive in the shipped answer');
 assert.match(result.answer,/Necessity and Custom Hume explains that our idea of necessity arises/);
 assert.match(result.answer,/Causality as a Category Kant explains that causality is one of the categories/);
 assert.match(result.answer,/Custom as Readiness Sage describes custom in reasoning as a settled readiness/);
 assert.deepEqual(result.citations.map(source=>source.id),['S1','S2','S3'],
  'citation mapping is untouched by the marker-level unwrap');
 assert.equal(result.evidenceMap.filter(item=>item.quoteVerified).length>=3,true,
  'evidence links are untouched');
});

test('review packet marks the first and last two claims of a part as frame (batch 9 B9-4)',async()=>{
 let captured;
 const capture=(_model,{messages})=>{
  captured=parsePayload(messages);
  return review([['P1','partial']])(_model,{messages});
 };
 const ai=makeAI([answer('PART P1\nAn opening framing sentence about the topic. '+
   'Hume explains that necessity arises from uniformity observable in nature [S1]. '+
   'A middle framing sentence develops the theme further. '+
   'A closing framing sentence draws the threads together.'),capture]);
 await composeEvidenceAnswer('How does Hume explain causal necessity?',
  [hume],ai,[],{plan:onePartPlan,catalog,trace:true});
 const context=captured.parts[0].contextClaims;
 assert.deepEqual(context.map(claim=>claim.claimId),['P1-C1','P1-C3','P1-C4'],
  'only the uncited claims ride in contextClaims');
 assert.deepEqual(context.map(claim=>claim.frame===true),[true,true,true],
  'the opener and BOTH closing claims are marked frame');
});

test('review packet marks both claims of a two-claim part as frame, once each (batch 9 B9-4)',async()=>{
 let captured;
 const capture=(_model,{messages})=>{
  captured=parsePayload(messages);
  return review([['P1','partial']])(_model,{messages});
 };
 const ai=makeAI([answer('PART P1\nAn opening framing sentence about the topic.\n\n'+
   'A closing framing sentence draws the threads together.'),capture]);
 await composeEvidenceAnswer('How does Hume explain causal necessity?',
  [hume],ai,[],{plan:onePartPlan,catalog,trace:true});
 const context=captured.parts[0].contextClaims;
 assert.equal(context.length,2,'no duplicate entries for the overlapping marks');
 assert.deepEqual(context.map(claim=>claim.frame===true),[true,true]);
});

// ---------------------------------------------------------------------------
// Batch 9 (B9-3): archive-vs-link validation. Batch 8 shipped a bypass —
// a claim whose citations the reviewer rejected re-entered the answer
// as an uncited paraphrase and received a scaffolding link from the
// very source whose spans had failed it. The link must now refuse.
// ---------------------------------------------------------------------------
test('attachScaffoldingToPart refuses a link onto the pool that failed the rejected original (batch 9 B9-3)',()=>{
 const part={answers:[
   {claimId:'P1-C1',text:'First established position.',sourceIds:['S1'],
    renderedText:'First established position. [S1]'},
   {claimId:'P1-C3',text:'Necessity is a power perceived directly in the objects themselves.',sourceIds:[],
    renderedText:'Necessity is a power perceived directly in the objects themselves.'}],
  evidence:[{sourceId:'S1',claimId:'P1-C1',point:'First established position.',
   quote:'Verbatim span text.',anchorQuote:'Verbatim span text.',start:0,end:18}]};
 const rejectedClaims=[{claimId:'P1-C2',
  claimText:'Hume insists that necessity is a power perceived directly in the objects themselves.',
  sourceIds:['S1']}];
 const refused=attachScaffoldingToPart(part,
  [{claimId:'P1-C3',supportClaimIds:['P1-C1']}],
  {citedIds:new Set(['P1-C1']),rejectedClaims});
 assert.equal(refused.attached.length,0,'nothing attaches through the archive hit');
 assert.equal(refused.invalidLinks,1);
 assert.equal(refused.invalidLinkDetails.length,1);
 assert.equal(refused.invalidLinkDetails[0].claimId,'P1-C3');
 assert.equal(refused.invalidLinkDetails[0].reason,'archived-rejection');
 assert.equal(refused.invalidLinkDetails[0].matchedRejectedClaimId,'P1-C2');
 assert.ok(refused.invalidLinkDetails[0].containment>=0.5);
 assert.deepEqual(part.answers[1].sourceIds,[],'the target stays uncited');
 assert.equal(part.evidence.filter(entry=>entry.claimId==='P1-C3').length,0);
 // Control: the same link attaches when the rejected claim failed on a
 // DIFFERENT source — the pool on offer is not the pool that failed it.
 const control={answers:structuredClone(part.answers),evidence:structuredClone(part.evidence)};
 const attached=attachScaffoldingToPart(control,
  [{claimId:'P1-C3',supportClaimIds:['P1-C1']}],
  {citedIds:new Set(['P1-C1']),
   rejectedClaims:[{...rejectedClaims[0],sourceIds:['S2']}]});
 assert.equal(attached.invalidLinks,0);
 assert.equal(attached.attached.length,1,'a link with no archive match on its pool attaches normally');
 // Control: a target that does not restate the rejection attaches.
 const unrelated={answers:[
   {claimId:'P1-C1',text:'First established position.',sourceIds:['S1'],
    renderedText:'First established position. [S1]'},
   {claimId:'P1-C3',text:'A framing remark about how the chapter is organized and what it sets aside.',sourceIds:[],
    renderedText:'A framing remark about how the chapter is organized and what it sets aside.'}],
  evidence:structuredClone(part.evidence)};
 const attachedUnrelated=attachScaffoldingToPart(unrelated,
  [{claimId:'P1-C3',supportClaimIds:['P1-C1']}],
  {citedIds:new Set(['P1-C1']),rejectedClaims});
 assert.equal(attachedUnrelated.attached.length,1,
  'a target with no substantial text match to the rejection attaches normally');
});

test('subtitle attachment is refused before the archive check while prose containment remains enforced (batch 15)',()=>{
 // The batch-10 Hobbes shape at the link site: the heading's whole
 // term set lives inside the rejected claim, so the archive check
 // measured containment 1.0 and refused the link. A heading is
 // furniture, not a restatement. Batch 15 refuses citation attachment
 // to that furniture outright; the prose archive control stays intact.
 const part={answers:[
   {claimId:'P1-C1',text:'First established position.',sourceIds:['S1'],
    renderedText:'First established position. [S1]'},
   {claimId:'P1-C3',text:'**Hobbes’s Model of Political Authority**',sourceIds:[],
    renderedText:'**Hobbes’s Model of Political Authority**'}],
  evidence:[{sourceId:'S1',claimId:'P1-C1',point:'First established position.',
   quote:'Verbatim span text.',anchorQuote:'Verbatim span text.',start:0,end:18}]};
 const rejectedClaims=[{claimId:'P1-C2',
  claimText:'Because Hobbes views the state of nature as a state of perpetual war where no security can be guaranteed, his model of political authority is centered on the establishment of a common power to enforce law.',
  sourceIds:['S1']}];
 const attached=attachScaffoldingToPart(part,
  [{claimId:'P1-C3',supportClaimIds:['P1-C1']}],
  {citedIds:new Set(['P1-C1']),rejectedClaims});
 assert.equal(attached.invalidLinks,1);
 assert.equal(attached.invalidLinkDetails[0].reason,'target-heading');
 assert.equal(attached.attached.length,0,'headings never acquire a scaffolding citation');
 assert.deepEqual(part.answers[1].sourceIds,[]);
 // Control: a prose target restating the same rejection on the same
 // pool is still refused.
 const prose={answers:[
   {claimId:'P1-C1',text:'First established position.',sourceIds:['S1'],
    renderedText:'First established position. [S1]'},
   {claimId:'P1-C3',text:'Hobbes centers political authority on a common power that enforces law amid perpetual war.',sourceIds:[],
    renderedText:'Hobbes centers political authority on a common power that enforces law amid perpetual war.'}],
  evidence:structuredClone(part.evidence)};
 const refused=attachScaffoldingToPart(prose,
  [{claimId:'P1-C3',supportClaimIds:['P1-C1']}],
  {citedIds:new Set(['P1-C1']),rejectedClaims});
 assert.equal(refused.attached.length,0);
 assert.equal(refused.invalidLinks,1);
 assert.equal(refused.invalidLinkDetails[0].reason,'archived-rejection',
  'the prose restatement is still refused by the archive check');
});

test('attachScaffoldingToPart records a reason for every refused or skipped link (batch 10 B10-5)',()=>{
 const part={answers:[
   {claimId:'P1-C1',text:'First established position.',sourceIds:['S1'],
    renderedText:'First established position. [S1]'},
   {claimId:'P1-C2',text:'A framing restatement.',sourceIds:[],
    renderedText:'A framing restatement.'},
   {claimId:'P1-C3',text:'A second framing restatement.',sourceIds:[],
    renderedText:'A second framing restatement.'},
   {claimId:'P1-C4',text:'An uncited sibling offered as a support.',sourceIds:[],
    renderedText:'An uncited sibling offered as a support.'},
   {claimId:'P1-C5',text:'A cited claim the draft citations never named.',sourceIds:['S2'],
    renderedText:'A cited claim the draft citations never named. [S2]'},
   {claimId:'P1-C6',text:'A cited claim with no evidence entries.',sourceIds:['S3'],
    renderedText:'A cited claim with no evidence entries. [S3]'}],
  evidence:[{sourceId:'S1',claimId:'P1-C1',point:'First established position.',
   quote:'Verbatim span text.',anchorQuote:'Verbatim span text.',start:0,end:18}]};
 const result=attachScaffoldingToPart(part,[
  {claimId:'P1-C9',supportClaimIds:['P1-C1']},
  {claimId:'P1-C1',supportClaimIds:['P1-C1']},
  {claimId:'P1-C2',supportClaimIds:['P1-C9']},
  {claimId:'P1-C2',supportClaimIds:['P1-C4']},
  {claimId:'P1-C2',supportClaimIds:['P1-C5']},
  {claimId:'P1-C2',supportClaimIds:['P1-C6']},
  {claimId:'P1-C2',supportClaimIds:[]},
  {claimId:'P1-C2',supportClaimIds:['P1-C1']},
  {claimId:'P1-C3',supportClaimIds:['P1-C1']}],
  {citedIds:new Set(['P1-C1','P1-C6'])});
 assert.equal(result.invalidLinks,5,'only the five support refusals count');
 assert.deepEqual(result.attached.map(item=>item.claimId),['P1-C2','P1-C3']);
 assert.deepEqual(result.invalidLinkDetails,[
  {claimId:'P1-C9',reason:'target-missing'},
  {claimId:'P1-C1',reason:'target-already-cited'},
  {claimId:'P1-C2',reason:'invalid-support',supportClaimIds:['P1-C9'],
   failedSupportId:'P1-C9',condition:'support-not-found'},
  {claimId:'P1-C2',reason:'invalid-support',supportClaimIds:['P1-C4'],
   failedSupportId:'P1-C4',condition:'support-uncited'},
  {claimId:'P1-C2',reason:'invalid-support',supportClaimIds:['P1-C5'],
   failedSupportId:'P1-C5',condition:'support-not-draft-cited'},
  {claimId:'P1-C2',reason:'invalid-support',supportClaimIds:['P1-C6'],
   failedSupportId:'P1-C6',condition:'support-no-evidence'},
  {claimId:'P1-C2',reason:'invalid-support',supportClaimIds:[],
   condition:'support-list-empty'}],
  'every non-attaching link is explained, in proposal order');
 const counted=result.invalidLinkDetails.filter(detail=>
  !['target-missing','target-already-cited'].includes(detail.reason));
 assert.equal(counted.length,result.invalidLinks,
  'counted reasons sum to the invalidLinks counter');
});

test('every counted scaffolding refusal in a build carries a detail (batch 10 B10-5)',async()=>{
 // One part whose reviewer proposes five links: one attaches, one is a
 // duplicate, one targets a cited claim, one has an empty support
 // list, and one names a claim this same review rejects as its
 // support. The trace must explain all four refusals and the counted
 // reasons must sum to invalidLinks.
 const mixedReview=(_model,{messages})=>{
  const payload=parsePayload(messages);
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',answerStatus:'answered',
    directAnswerClaimIds:['P1-C1'],retainedContextClaimIds:['P1-C3','P1-C4'],
    scaffoldingLinks:[
     {claimId:'P1-C3',supportClaimIds:['P1-C1']},
     {claimId:'P1-C3',supportClaimIds:['P1-C1']},
     {claimId:'P1-C1',supportClaimIds:['P1-C1']},
     {claimId:'P1-C3',supportClaimIds:[]},
     {claimId:'P1-C4',supportClaimIds:['P1-C2']}]}],
   claims:payload.claims.map(claim=>{
    const rejected=claim.claimId==='P1-C2';
    return {claimId:claim.claimId,status:rejected?'partial':'answered',
     sources:claim.sourceIds.map(sourceId=>({sourceId,
      status:rejected?'partial':'answered',
      spanIds:rejected?[]:[claim.sourceEvidence
       .find(item=>item.sourceId===sourceId).spanIds[0]]}))};
   })})};
 };
 const ai=makeAI([answer('PART P1\nHume explains causal expectation through custom rather than reasoning. [S1]\n'+
   'Kant treats causality as a category supplied by the understanding itself. [S2]\n'+
   'Together, the two accounts treat causal connection as something the mind contributes rather than a power read off from events.\n'+
   'The contrast between the two positions frames the question of causal necessity.'),
  mixedReview]);
 const result=await composeEvidenceAnswer('How do Hume and Kant each explain causal necessity?',
  [{...hume,candidatePartIds:['P1']},{...kant,candidatePartIds:['P1']}],ai,[],
  {plan:scaffoldingPlan,catalog,trace:true});
 const scaffolding=result.trace.reviewScaffolding;
 assert.equal(scaffolding.invalidLinks,4);
 assert.ok(Array.isArray(scaffolding.invalidLinkDetails),
  'invalidLinkDetails is present whenever invalidLinks > 0');
 const counted=scaffolding.invalidLinkDetails.filter(detail=>
  !['target-missing','target-already-cited'].includes(detail.reason));
 assert.equal(counted.length,scaffolding.invalidLinks,
  'the counted refusal reasons sum to the invalidLinks counter');
 assert.deepEqual(new Set(counted.map(detail=>detail.reason)),
  new Set(['duplicate-link','target-not-uncited','support-list-invalid','invalid-support']),
  'parse-level and attach-level refusals are both explained');
 assert.deepEqual(scaffolding.attached,
  [{partId:'P1',claimId:'P1-C3',supportClaimIds:['P1-C1'],sourceIds:['S1']}],
  'the one well-formed link still attaches');
});

test('review prompt forbids linking a restatement of a claim being rejected (batch 9 B9-3)',()=>{
 assert.match(REVIEW_PROMPT,/Do not link an uncited claim that restates, in different words, a claim whose citations you are rejecting in this review/);
});

test('a scaffolding link cannot resurrect a rejected claim as its uncited paraphrase (batch 9 B9-3)',async()=>{
 const launderingReview=(_model,{messages})=>{
  const payload=parsePayload(messages);
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',answerStatus:'answered',
    directAnswerClaimIds:['P1-C1'],retainedContextClaimIds:[],
    scaffoldingLinks:[{claimId:'P1-C3',supportClaimIds:['P1-C1']}]}],
   claims:payload.claims.map(claim=>{
    const rejected=claim.claimId==='P1-C2';
    return {claimId:claim.claimId,status:rejected?'partial':'answered',
     sources:claim.sourceIds.map(sourceId=>({sourceId,
      status:rejected?'partial':'answered',
      spanIds:rejected?[]:[claim.sourceEvidence
       .find(item=>item.sourceId===sourceId).spanIds[0]]}))};
   })})};
 };
 const ai=makeAI([answer('PART P1\nHume explains causal expectation through custom rather than reasoning. [S1]\n'+
   'Hume insists that necessity is a power perceived directly in the objects themselves. [S1]\n'+
   'Necessity, on this account, is a power perceived directly in the objects themselves.'),
  launderingReview]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',
  [hume],ai,[],{plan:onePartPlan,catalog,trace:true});
 assert.deepEqual(result.trace.reviewScaffolding.attached,[],
  'the paraphrase receives no link from the failed source pool');
 assert.equal(result.trace.reviewScaffolding.invalidLinks,1);
 const details=result.trace.reviewScaffolding.invalidLinkDetails||[];
 assert.equal(details.length,1,'the archive hit is recorded in the trace');
 assert.equal(details[0].partId,'P1');
 assert.equal(details[0].claimId,'P1-C3');
 assert.equal(details[0].reason,'archived-rejection');
 assert.equal(details[0].matchedRejectedClaimId,'P1-C2');
 assert.equal(result.evidenceMap.filter(item=>item.claimId==='P1-C3').length,0,
  'no evidence entries ride on the refused claim');
 assert.equal(ai.calls.length,2,'the refused link was decided in the review; no repair round follows');
});

// ---------------------------------------------------------------------------
// Batch 9 (B9-5): traceability invariant. Batch 8 shipped a cited claim
// (idea-of-progress P4-C6) with zero review decisions and no attachment
// trace under a verified outcome: gate repairs adopt re-reviewed parts
// whose claim IDs were reassigned at revalidation, and the adoption
// discarded the re-review's decisions — the only record that the
// shipped claims were ever reviewed.
// ---------------------------------------------------------------------------
test('findUntracedCitedClaims lists cited claims no mechanism covers (batch 9 B9-5)',()=>{
 const parts=[{partId:'P1',answers:[
  {claimId:'P1-C1',sourceIds:['S1']},
  {claimId:'P1-C2',sourceIds:['S1']},
  {claimId:'P1-C3',sourceIds:[]},
  {claimId:'P1-C4',sourceIds:['S2']}]},
  {partId:'P2',answers:[{claimId:'P2-C1',sourceIds:['S1']}]}];
 const untraced=findUntracedCitedClaims(parts,{
  accepted:new Set(['P1|P1-C1']),
  reviewLinked:new Set(['P1|P1-C4']),
  inherited:new Set(),
  secondLook:new Set(['P2|P2-C1']),
  fallback:new Set()});
 assert.deepEqual(untraced,[{partId:'P1',claimId:'P1-C2'}],
  'only the cited claim covered by no mechanism is listed; uncited claims are ignored');
 assert.deepEqual(findUntracedCitedClaims(parts,{
  accepted:new Set(['P1|P1-C1','P1|P1-C2']),
  reviewLinked:new Set(['P1|P1-C4']),
  secondLook:new Set(['P2|P2-C1'])}),[],
  'a fully mechanized answer has an empty untraced list');
});

test('stripUntracedCitedClaims demotes claims to the context shape, prose intact (batch 10 B10-1)',()=>{
 const parts=[{partId:'P1',answers:[
   {claimId:'P1-C1',text:'A validated claim.',sourceIds:['S1'],
    renderedText:'A validated claim. [S1]'},
   {claimId:'P1-C2',text:'An untraced claim.',sourceIds:['S1'],
    renderedText:'An untraced claim. [S1]'}]},
  {partId:'P2',answers:[
   {claimId:'P2-C1',text:'An untouched claim.',sourceIds:['S2'],
    renderedText:'An untouched claim. [S2]'}]}];
 const stripped=stripUntracedCitedClaims(parts,[{partId:'P1',claimId:'P1-C2'}]);
 assert.deepEqual(stripped,{claimIds:['P1-C2'],partIds:['P1']});
 assert.deepEqual(parts[0].answers[1].sourceIds,[]);
 assert.equal(parts[0].answers[1].renderedText,'An untraced claim.',
  'renderedText becomes the bare prose — the retained-context shape');
 assert.equal(parts[0].answers[1].text,'An untraced claim.','the prose itself is unchanged');
 assert.deepEqual(parts[0].answers[0].sourceIds,['S1'],'siblings are untouched');
 assert.deepEqual(parts[1].answers[0].sourceIds,['S2'],'other parts are untouched');
});

test('untraced quoted claims keep their prose without leaking unverifiable quote marks',()=>{
 const source={id:'S1',text:'The passage describes an unsettling arrival at the station.'};
 const parts=[{partId:'P2',answers:[{claimId:'P2-C1',
  text:'Marlow calls the encounter “moral shock”.',sourceIds:['S1'],
  renderedText:'Marlow calls the encounter “moral shock” [S1].'}],evidence:[]}];
 const stripped=stripUntracedCitedClaimsToFixpoint(parts,
  [{partId:'P2',claimId:'P2-C1'}],{sources:[source]});
 assert.deepEqual(stripped,{claimIds:['P2-C1'],partIds:['P2'],passes:1});
 assert.deepEqual(parts[0].answers[0].sourceIds,[]);
 assert.equal(parts[0].answers[0].text,'Marlow calls the encounter moral shock.');
 assert.equal(parts[0].answers[0].renderedText,parts[0].answers[0].text);
});

test('reader-facing answer cleanup removes internal IDs and keeps source citation IDs',()=>{
 assert.equal(sanitizeInternalAnswerIds(
  'A claim (P1-C4). Another point (P1-C18, P1-C20) [S1].'),
  'A claim. Another point [S1].');
 assert.equal(sanitizeInternalAnswerIds('Requirement P2-R1 is covered [S2].'),
  'Requirement is covered [S2].');
});

test('the strip runs to a fixpoint: a sibling whose entries rode on the stripped source is stripped in pass 2 (batch 10 B10-1)',()=>{
 // The coupling shape: C2 carries an S1 evidence entry, but its own
 // rendered text carries no marker — the part's only S1 citation in
 // the rendered text is C1's. No current mechanism produces this
 // desync (every attach path sets a claim's entries and its marker
 // together), so the cascade is pinned here at the driver level, on
 // the same function the build calls: when C1 is stripped, S1 leaves
 // the part's cited sources, C2's entry loses the eligibility that
 // made it shippable, and C2 is stripped in the second pass. C3,
 // cited on its own source with its own marker, is untouched.
 const parts=[{partId:'P1',answers:[
   {claimId:'P1-C1',text:'The claim review never validated.',sourceIds:['S1'],
    renderedText:'The claim review never validated. [S1]'},
   {claimId:'P1-C2',text:'A claim whose entry rode on the shared source.',sourceIds:['S1'],
    renderedText:'A claim whose entry rode on the shared source.'},
   {claimId:'P1-C3',text:'A claim cited on its own source.',sourceIds:['S2'],
    renderedText:'A claim cited on its own source. [S2]'}],
  evidence:[
   {claimId:'P1-C2',sourceId:'S1',quote:'Shared source span.'},
   {claimId:'P1-C3',sourceId:'S2',quote:'Own source span.'}]}];
 const result=stripUntracedCitedClaimsToFixpoint(parts,
  [{partId:'P1',claimId:'P1-C1'}]);
 assert.deepEqual(result,{claimIds:['P1-C1','P1-C2'],partIds:['P1'],passes:2});
 assert.deepEqual(parts[0].answers[1].sourceIds,[],'the coupled sibling is demoted in pass 2');
 assert.equal(parts[0].answers[1].renderedText,
  'A claim whose entry rode on the shared source.');
 assert.deepEqual(parts[0].answers[2].sourceIds,['S2'],'the self-cited claim is untouched');
 assert.equal(parts[0].answers[2].renderedText,'A claim cited on its own source. [S2]');
});

test('introducesDuplicatedParagraph counts paragraph repetition against the original (batch 11 B11-8)',()=>{
 const para=(text,paragraphIndex)=>({text,renderedText:text,sourceIds:[],paragraphIndex});
 const longA='The underground man insists that consciousness itself is a disease and that suffering is the price of awareness.';
 const longB='He writes that even now he is lying, and that he has been lying for twenty years about his own motives.';
 const original=[para(longA,0),para(longB,1)];
 // A candidate that repeats an original paragraph ships it twice.
 assert.equal(introducesDuplicatedParagraph(original,
  [para(longA,0),para(longB,1),para(longA,2)]),true);
 // A candidate that repeats a brand-new paragraph within itself.
 assert.equal(introducesDuplicatedParagraph(original,
  [para(longA,0),para(longB,1),
   para('A wholly new paragraph develops the point with fresh evidence and a further consequence.',2),
   para('A wholly new paragraph develops the point with fresh evidence and a further consequence.',3)]),true);
 // Keeping each original paragraph once and adding new prose is not duplication.
 assert.equal(introducesDuplicatedParagraph(original,
  [para(longA,0),para(longB,1),
   para('A wholly new paragraph develops the point with fresh evidence and a further consequence.',2)]),false);
 // Repetition the original already had, at the same count, is not introduced.
 assert.equal(introducesDuplicatedParagraph(
  [para(longA,0),para(longA,1)],[para(longA,0),para(longA,1)]),false);
 // Short furniture paragraphs never count, however often they repeat.
 assert.equal(introducesDuplicatedParagraph(original,
  [para('**Section Heading**',0),para('**Section Heading**',1),para('**Section Heading**',2)]),false);
});

test('a gate-repair adoption records its re-review decisions and keeps verified status (batch 9 B9-5)',async()=>{
 const uncitedReview={response:JSON.stringify({parts:[{partId:'P1',status:'answered',
  answerStatus:'answered',directAnswerClaimIds:['P1-C1'],retainedContextClaimIds:['P1-C1']}],claims:[]})};
 const citedRepair={response:JSON.stringify({parts:[{partId:'P1',
  replacements:[{claimId:'P1-C1',text:'Hume links necessity to custom and regular conjunction. [S1]'}],
  additions:[]}]})};
 const citedReReview=(_model,{messages})=>{
  const payload=parsePayload(messages);
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
   directAnswerClaimIds:payload.claims.map(claim=>claim.claimId),retainedContextClaimIds:[]}],
   claims:payload.claims.map(claim=>({claimId:claim.claimId,status:'answered',
    sources:claim.sourceIds.map(sourceId=>({sourceId,status:'answered',
     spanIds:[claim.sourceEvidence.find(item=>item.sourceId===sourceId).spanIds[0]]}))}))})};
 };
 const ai=makeAI([answer('PART P1\nHume links necessity to custom and regular conjunction.'),
  uncitedReview,citedRepair,citedReReview],{decorateReview:false});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true});
 assert.deepEqual(result.trace.citationGate,
  [{partId:'P1',action:'repair-applied',preGateStatus:'answered'}]);
 assert.equal(result.outcome,'verified-source-draft',
  'the adopted claim is traced, so verified status stands');
 assert.equal(result.trace.untracedCitedClaims,undefined,
  'no shipped cited claim lacks a mechanism');
 const shippedClaimIds=result.questionParts[0].claimIds;
 assert.ok(shippedClaimIds.length>=1);
 const acceptedKeys=new Set((result.trace.reReviewDecisions||[])
  .filter(decision=>decision.accepted===true&&decision.sourceId)
  .map(decision=>decision.partId+'|'+decision.claimId));
 assert.ok(shippedClaimIds.every(claimId=>acceptedKeys.has('P1|'+claimId)),
  'every shipped claim of the adopted part is accepted in the recorded re-review decisions');
 assert.ok((result.trace.reReviewDecisions||[])
  .some(decision=>decision.sourceId==='S1'&&decision.accepted===true),
  'the re-review acceptance for the restored citation is in the trace');
});

// Batch 24 (B24-1): a zero-accept part gets one rescue re-review
// before the citation gate and containment. The router below keys
// each mock response to the system prompt of the stage that asks for
// it, so the rescue (and, in the rejection case, the gate repair) is
// exercised through the real call sequence.
function batch24RouterAI({reviewClaims,rescueVerdict}){
 const calls=[];
 const draft='PART P1\nHume links necessity to custom and regular conjunction. [S1]\n'+
  'Custom is the great guide of human life.';
 const ai={calls,run:async(model,request)=>{
  calls.push({model,request});
  const system=String(request?.messages?.[0]?.content||'');
  if(system.startsWith('Answer the reader'))return answer(draft);
  if(system.startsWith('Review the complete answer')){
   return {response:JSON.stringify({parts:[{partId:'P1',status:'partial',
    answerStatus:'partial',directAnswerClaimIds:['P1-C1'],
    retainedContextClaimIds:['P1-C2']}],
    claims:reviewClaims})};
  }
  if(system.startsWith('Judge only the listed claim')){
   const payload=JSON.parse(request.messages[1].content);
   return {response:JSON.stringify({decisions:payload.decisions.map(item=>({
    claimId:item.claimId,sourceId:item.sourceId,verdict:rescueVerdict,
    fragment:item.spans[0].text,
    // Batch 25 (B25-Q2): a supported verdict must carry the
    // element-by-element check or the parser downgrades it.
    ...(rescueVerdict==='supported'?{elements:[{element:item.claimText,stated:true}]}:{})}))})};
  }
  if(system.startsWith('Patch only the requested claims')){
   const payload=JSON.parse(request.messages[1].content);
   return {response:JSON.stringify({parts:[{partId:'P1',
    replacements:payload.parts[0].repair.replaceClaimIds.map(claimId=>({claimId,
     text:'Custom is the great guide of human life.'})),additions:[]}]})};
  }
  throw new Error('unexpected stage in batch 24 fixture: '+system.slice(0,40));
 }};
 return ai;
}
const batch24RejectingClaims=[{claimId:'P1-C1',status:'partial',
 sources:[{sourceId:'S1',status:'partial',spanIds:[],
  attributionStatus:'not_applicable',attributedSpeaker:'',
  subjectAttributionStatus:'supported',attributedSubject:'Hume',
  evidenceRole:'work-assertion',
  supportBoundary:'The span states the custom account but the claim was demoted.'}]}];

test('batch 24 rescue re-review flips a zero-accept part so it ships cited and escapes containment',async()=>{
 const ai=batch24RouterAI({reviewClaims:batch24RejectingClaims,rescueVerdict:'supported'});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true});
 assert.equal(result.outcome,'verified-source-draft');
 assert.match(result.answer,/Hume links necessity to custom and regular conjunction\. \[S1\]/);
 assert.equal(result.evidenceMap.length,1);
 assert.equal(result.trace.sourceRequiredContainment.disposition,'all-shipped-source-parts-cited');
 const rescue=result.trace.rescueReview;
 assert.ok(rescue,'the rescue outcome is recorded in the trace');
 assert.equal(rescue.parts.length,1);
 assert.equal(rescue.parts[0].partId,'P1');
 assert.equal(rescue.parts[0].outcome,'completed');
 assert.equal(rescue.parts[0].flipped,1);
 assert.deepEqual(rescue.parts[0].claims.map(claim=>[claim.claimId,claim.sourceId,claim.verdict]),
  [['P1-C1','S1','supported']]);
 assert.ok(rescue.parts[0].claims[0].fragment.length>0,'the decisive fragment is recorded');
 assert.ok(result.trace.reviewContract.reviewDecisions.some(decision=>
  decision.claimId==='P1-C1'&&decision.accepted===true&&decision.rescueAccepted===true),
  'the flipped decision is marked rescueAccepted in the review decisions');
});

test('batch 24 rescue re-review that rejects everything leaves the part to containment',async()=>{
 const ai=batch24RouterAI({reviewClaims:batch24RejectingClaims,rescueVerdict:'not-supported'});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true});
 assert.equal(result.trace.rescueReview.parts[0].outcome,'completed');
 assert.equal(result.trace.rescueReview.parts[0].flipped,0);
 assert.equal(result.trace.rescueReview.parts[0].claims[0].verdict,'not-supported');
 assert.equal(result.outcome,'generation-failed');
 assert.equal(result.failureStage,'source-required-containment');
 assert.deepEqual(result.trace.sourceRequiredContainment.uncitedPartIds,['P1']);
 assert.doesNotMatch(result.answer,/great guide of human life/);
});

test('batch 24 rescue never fires for a part with an accepted claim',async()=>{
 const ai=makeAI([answer('PART P1\nHume links necessity to custom and regular conjunction. [S1]\n'+
   'Hume treats causation as a directly observed power. [S1]'),
  (_model,{messages})=>{
   const payload=parsePayload(messages);
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
    answerStatus:'answered',directAnswerClaimIds:['P1-C1'],
    retainedContextClaimIds:[]}],
    claims:payload.claims.map(claim=>{
     const accepted=claim.claimId==='P1-C1';
     const spanId=claim.sourceEvidence.find(item=>item.sourceId==='S1').spanIds[0];
     return {claimId:claim.claimId,status:accepted?'answered':'partial',
      sources:[{sourceId:'S1',status:accepted?'answered':'partial',
       spanIds:accepted?[spanId]:[],
       subjectAttributionStatus:'supported',attributedSubject:'Hume'}]};
    })})};
  }],{decorateReview:false,decorateClauses:false,decorateSubject:false});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true});
 assert.equal(result.trace.rescueReview,undefined,'no zero-accept part, no rescue');
 assert.equal(ai.calls.length,2,'compose and review only');
 assert.equal(result.outcome,'verified-source-draft');
});

test('batch 24 split review covers all claims of a part with more than ten source-linked claims',async()=>{
 const sentences=Array.from({length:12},(_,index)=>
  `Hume point ${index+1} links necessity to custom and regular conjunction. [S1]`);
 const calls=[];
 const ai={calls,run:async(model,request)=>{
  calls.push({model,request});
  const system=String(request?.messages?.[0]?.content||'');
  if(system.startsWith('Answer the reader'))
   return answer('PART P1\n'+sentences.join(' '));
  if(system.startsWith('Review the complete answer')){
   const payload=parsePayload(request.messages);
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
    answerStatus:'answered',
    directAnswerClaimIds:[payload.claims[0].claimId],retainedContextClaimIds:[]}],
    claims:payload.claims.map(claim=>({claimId:claim.claimId,status:'answered',
     sources:claim.sourceIds.map(sourceId=>({sourceId,status:'answered',
      spanIds:[claim.sourceEvidence.find(item=>item.sourceId===sourceId).spanIds[0]],
      subjectAttributionStatus:'supported',attributedSubject:'Hume'}))}))})};
  }
  throw new Error('unexpected stage in split-review fixture: '+system.slice(0,40));
 }};
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true});
 const reviewCalls=calls.filter(call=>
  String(call.request.messages[0].content).startsWith('Review the complete answer'));
 assert.equal(reviewCalls.length,2,'a 12-claim part is reviewed in two concurrent calls');
 const halfSizes=reviewCalls.map(call=>JSON.parse(call.request.messages[1].content).claims.length)
  .sort((a,b)=>a-b);
 assert.deepEqual(halfSizes,[6,6],'the halves partition the claims');
 const accepted=result.trace.reviewContract.reviewDecisions
  .filter(decision=>decision.accepted===true);
 assert.equal(accepted.length,12,'merged decisions cover every claim');
 assert.equal(result.evidenceMap.length,12);
 assert.equal(result.coverage,'full');
 assert.equal(result.trace.rescueReview,undefined,'no zero-accept part, no rescue');
});

test('batch 24 review-stage failure after the in-build review retry does not whole-build retry',async()=>{
 const requestFailed=()=>new Error('Review request failed');
 const ai=makeAI([answer('PART P1\nHume links necessity to custom and regular conjunction. [S1]'),
  requestFailed(),requestFailed(),
  answer('PART P1\nHume links necessity to custom and regular conjunction. [S1]'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true});
 assert.equal(result.outcome,'generation-failed');
 assert.equal(result.failureStage,'review');
 assert.equal(result.failureCode,'review-request-failed');
 assert.equal(result.trace.reviewRetry.attempted,true,
  'the in-build review retry ran before the failure');
 assert.equal(result.trace.answerRetry,undefined,
  'batch 24 (B24-4): no whole-build retry follows an attempted review retry');
 assert.equal(ai.calls.length,3,'compose, the failed review, and its compact retry — no second build');
});

test('batch 24 compose-stage transient failure still whole-build retries',async()=>{
 const requestFailed=()=>Object.assign(new Error('Compose request failed'),
  {code:'answer-request-failed'});
 const ai=makeAI([requestFailed(),requestFailed(),
  answer('PART P1\nHume links necessity to custom and regular conjunction. [S1]'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true});
 assert.equal(result.outcome,'verified-source-draft');
 assert.deepEqual(result.trace.answerRetry,
  {code:'answer-request-failed',outcome:'recovered'},
  'a non-review transient failure keeps the whole-build retry');
 assert.equal(ai.calls.length,4,'two failed compose attempts, then the retried build');
});

test('batch 24 pseudonymous-voice guard: a span naming the speaker identifies the voice',async()=>{
 const pseudonymSource={...hume,id:'S1',bookId:'140',
  title:'Fear and Trembling — Søren Kierkegaard',page:32,
  text:'Johannes de Silentio describes faith as a relation to God.',
  preview:'Johannes de Silentio describes faith as a relation to God.'};
 const plan={...onePartPlan,sources:[{label:'Søren Kierkegaard',role:'primary',bookIds:['140']}],
  parts:[{...onePartPlan.parts[0],question:'What does Fear and Trembling say about faith?',
   sourceBookIds:['140'],candidateSourceIds:['S1']}]};
 const ai=makeAI([answer('PART P1\nThe speaker describes faith as a relation to God. [S1]'),
  (_model,{messages})=>{
   const payload=parsePayload(messages),claim=payload.claims[0];
   const evidence=claim.sourceEvidence[0];
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered'}],claims:[{
    claimId:claim.claimId,status:'answered',sources:[{sourceId:'S1',status:'answered',
     spanIds:[evidence.spanIds[0]]}]}]})};
  }]);
 const result=await composeEvidenceAnswer('What does Fear and Trembling say about faith?',
  [pseudonymSource],ai,[],{plan,
   catalog:{...catalog,140:'Fear and Trembling — Søren Kierkegaard'},trace:true});
 assert.equal(result.coverage,'full',
  'the bound span names Johannes de Silentio, so the voice is identified by the evidence');
 assert.ok(!result.trace.reviewContract.supportIssues.some(issue=>
  issue.reason==='pseudonymous-voice-unidentified'));
});

// ---------------------------------------------------------------------------
// Batch 25 (B25-Q1/Q2/Q3/Q4/L1/L2)
// ---------------------------------------------------------------------------

// Stage-keyed router for the batch-25 fixtures: composer, initial
// review (and any re-review, via reviewResponder), rescue, and repair
// responders are supplied per test.
function batch25RouterAI({reviewResponder,rescueResponder,repairResponder,
  draftText='PART P1\nHume says custom operates on the imagination. [S1]'}={}){
 const calls=[];
 const ai={calls,run:async(_model,request)=>{
  calls.push(request);
  const system=String(request?.messages?.[0]?.content||'');
  if(system.startsWith('Answer the reader'))return {response:draftText};
  if(system.startsWith('Judge only the listed claim')){
   if(!rescueResponder)throw new Error('unexpected rescue call');
   return rescueResponder(request);
  }
  if(system.startsWith('Patch only the requested claims')){
   if(!repairResponder)throw new Error('unexpected repair call');
   return repairResponder(request);
  }
  if(system.startsWith('Review the complete answer'))return reviewResponder(request);
  throw new Error('unexpected AI call: '+system.slice(0,60));
 }};
 return ai;
}
const rescueSupportedResponder=({messages})=>{
 const payload=JSON.parse(messages[1].content);
 return {response:JSON.stringify({decisions:payload.decisions.map(item=>({
  claimId:item.claimId,sourceId:item.sourceId,verdict:'supported',
  fragment:item.spans[0].text,
  elements:[{element:item.claimText,stated:true}]}))})};
};
const planWithRequirement={...onePartPlan,parts:[{...onePartPlan.parts[0],
 requirements:[{id:'P1-R1',text:'Explain the role of custom in causal inference.'}]}]};

test('batch 25 Q1: rescue flips propagate into the part contract so the rescued part ships',async()=>{
 // Production shape (Kierkegaard sel-p1, batch 24): the reviewer's
 // requirement coverage maps NO claims (answerClaimIds []) and every
 // claim is rejected, so the part contract reads unanswered even
 // after the rescue flips its direct-answer claim.
 const reviewResponder=()=>({response:JSON.stringify({parts:[{partId:'P1',
   status:'partial',answerStatus:'partial',directAnswerClaimIds:['P1-C1'],
   retainedContextClaimIds:[],
   requirementCoverage:[{requirementId:'P1-R1',status:'partial',answerClaimIds:[]}]}],
  claims:[{claimId:'P1-C1',status:'partial',
   sources:[{sourceId:'S1',status:'partial',spanIds:['S1-Q1'],
    subjectAttributionStatus:'supported',attributedSubject:'Hume'}]}]})});
 const ai=batch25RouterAI({reviewResponder,rescueResponder:rescueSupportedResponder});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',
  [hume],ai,[],{plan:planWithRequirement,catalog,trace:true});
 assert.equal(result.trace.rescueReview.parts[0].flipped,1);
 assert.match(result.answer,/custom operates on the imagination/,
  'the rescued part ships its prose');
 assert.match(result.answer,/\[S1\]/,'the rescued part ships cited');
 const recompute=result.trace.contractRecompute;
 assert.ok(recompute,'the contract recompute is recorded');
 assert.equal(recompute.parts[0].partId,'P1');
 assert.equal(recompute.parts[0].before.requirements['P1-R1'],'partial');
 assert.equal(recompute.parts[0].after.requirements['P1-R1'],'answered',
  'the empty requirement mapping is recomputed from the now-accepted direct-answer claim');
 assert.notEqual(recompute.parts[0].after.finalStatus,'unanswered');
 const decision=result.trace.reviewContract.partDecisions.find(item=>item.partId==='P1');
 assert.deepEqual(decision.requirementCoverage[0].answerClaimIds,['P1-C1']);
 assert.equal(decision.requirementCoverage[0].status,'answered');
 assert.notEqual(decision.finalStatus,'unanswered',
  'the shipped part decision no longer reads unanswered');
});

test('batch 25 Q2: a part with accepted claims but incomplete coverage gets a rescue pass',async()=>{
 const draftText='PART P1\nHume says custom operates on the imagination. [S1]\n'+
  'Hume says the mind is determined by custom to infer one object from another. [S1]';
 const reviewResponder=()=>({response:JSON.stringify({parts:[{partId:'P1',
   status:'partial',answerStatus:'partial',directAnswerClaimIds:['P1-C1'],
   retainedContextClaimIds:[],
   requirementCoverage:[{requirementId:'P1-R1',status:'partial',answerClaimIds:['P1-C1']}]}],
  claims:[{claimId:'P1-C1',status:'answered',
    sources:[{sourceId:'S1',status:'answered',spanIds:['S1-Q1'],
     subjectAttributionStatus:'supported',attributedSubject:'Hume'}]},
   {claimId:'P1-C2',status:'partial',
    sources:[{sourceId:'S1',status:'partial',spanIds:['S1-Q1'],
     subjectAttributionStatus:'supported',attributedSubject:'Hume'}]}]})});
 const ai=batch25RouterAI({reviewResponder,rescueResponder:rescueSupportedResponder,
  draftText});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',
  [hume],ai,[],{plan:planWithRequirement,catalog,trace:true});
 const rescue=result.trace.rescueReview;
 assert.ok(rescue,'rescue fired although one claim was already accepted');
 assert.equal(rescue.parts[0].trigger,'coverage-incomplete');
 assert.equal(rescue.parts[0].flipped,1);
 assert.deepEqual(rescue.parts[0].claims.map(claim=>claim.claimId),['P1-C2'],
  'only the rejected pair was re-judged');
 assert.match(result.answer,/determined by custom to infer one object from another/,
  'the rescued claim ships beside the already-accepted one');
});

test('batch 25 Q2: a supported verdict with an unstated element does not flip',async()=>{
 const reviewResponder=()=>({response:JSON.stringify({parts:[{partId:'P1',
   status:'partial',answerStatus:'partial',directAnswerClaimIds:['P1-C1'],
   retainedContextClaimIds:[]}],
  claims:[{claimId:'P1-C1',status:'partial',
   sources:[{sourceId:'S1',status:'partial',spanIds:['S1-Q1'],
    subjectAttributionStatus:'supported',attributedSubject:'Hume'}]}]})});
 const rescueResponder=({messages})=>{
  const payload=JSON.parse(messages[1].content);
  return {response:JSON.stringify({decisions:payload.decisions.map(item=>({
   claimId:item.claimId,sourceId:item.sourceId,verdict:'supported',
   fragment:item.spans[0].text,
   elements:[{element:'custom operates on the imagination',stated:true},
    {element:'custom is the sole guide of human life',stated:false}]}))})};
 };
 const ai=batch25RouterAI({reviewResponder,rescueResponder});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',
  [hume],ai,[],{plan:onePartPlan,catalog,trace:true});
 const rescue=result.trace.rescueReview;
 assert.equal(rescue.parts[0].flipped,0,
  'the multi-element claim is not flipped while one element is unstated');
 assert.equal(rescue.parts[0].claims[0].verdict,'not-supported');
 assert.equal(rescue.parts[0].claims[0].elementDowngrade,true);
 assert.equal(rescue.parts[0].claims[0].elements.length,2,
  'the element check is recorded in the trace');
 assert.doesNotMatch(result.answer,/custom operates on the imagination/);
});

test('batch 25 Q3 + batch 27 B27-5: an invalid rescue response gets one failed-pairs full-span retry and the flips apply',async()=>{
 const reviewResponder=()=>({response:JSON.stringify({parts:[{partId:'P1',
   status:'partial',answerStatus:'partial',directAnswerClaimIds:['P1-C1'],
   retainedContextClaimIds:[]}],
  claims:[{claimId:'P1-C1',status:'partial',
   sources:[{sourceId:'S1',status:'partial',spanIds:['S1-Q1'],
    subjectAttributionStatus:'supported',attributedSubject:'Hume'}]}]})});
 let rescueCalls=0;
 const rescueResponder=request=>{
  rescueCalls++;
  if(rescueCalls===1){
   const payload=JSON.parse(request.messages[1].content);
   return {response:JSON.stringify({decisions:payload.decisions.map(item=>({
    claimId:item.claimId,sourceId:item.sourceId,verdict:'supported',
    fragment:'a fragment that appears in no supplied span',
    elements:[{element:item.claimText,stated:true}]}))})};
  }
  return rescueSupportedResponder(request);
 };
 const ai=batch25RouterAI({reviewResponder,rescueResponder});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',
  [hume],ai,[],{plan:onePartPlan,catalog,trace:true});
 const rescue=result.trace.rescueReview;
 assert.equal(rescueCalls,2,'the rescue was retried exactly once');
 assert.equal(rescue.parts[0].outcome,'completed-after-retry');
 assert.equal(rescue.parts[0].attempts.length,2);
 assert.equal(rescue.parts[0].attempts[0].outcome,'invalid-response');
 // Batch 27 (B27-5): the retry no longer compacts the evidence. It
 // re-asks only the pair whose verdict failed validation, with its
 // full span set, under the compact retry instruction.
 assert.equal(rescue.parts[0].attempts[1].outcome,'completed');
 assert.equal(rescue.parts[0].attempts[1].retryScope,'failed-pairs');
 assert.equal(rescue.parts[0].attempts[1].retriedPairCount,1);
 assert.equal(rescue.parts[0].attempts[1].fullSpans,true);
 assert.equal(rescue.parts[0].flipped,1);
 assert.match(result.answer,/custom operates on the imagination/,
  'the retried rescue flips the claim and the part ships');
});

test('batch 25 Q4: a gate repair citing one of several linked sources is adopted',async()=>{
 const twoSourcePlan={...onePartPlan,parts:[{...onePartPlan.parts[0],
  candidateSourceIds:['S1','S2'],sourceBookIds:['35','40']}]};
 const uncitedReview={response:JSON.stringify({parts:[{partId:'P1',status:'answered',
  answerStatus:'answered',directAnswerClaimIds:['P1-C1'],retainedContextClaimIds:['P1-C1']}],claims:[]})};
 const citedRepair={response:JSON.stringify({parts:[{partId:'P1',
  replacements:[{claimId:'P1-C1',text:'Hume links necessity to custom and regular conjunction. [S1]'}],
  additions:[]}]})};
 const citedReReview=(_model,{messages})=>{
  const payload=parsePayload(messages);
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
   directAnswerClaimIds:payload.claims.map(claim=>claim.claimId),retainedContextClaimIds:[]}],
   claims:payload.claims.map(claim=>({claimId:claim.claimId,status:'answered',
    sources:claim.sourceIds.map(sourceId=>({sourceId,status:'answered',
     spanIds:[claim.sourceEvidence.find(item=>item.sourceId===sourceId).spanIds[0]]}))}))})};
 };
 const ai=makeAI([answer('PART P1\nHume links necessity to custom and regular conjunction.'),
  uncitedReview,citedRepair,citedReReview],{decorateReview:false});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',
  [hume,kant],ai,[],{plan:twoSourcePlan,catalog,trace:true});
 assert.equal(ai.calls.length,4,'compose, review, the gate repair, and its re-review');
 assert.deepEqual(result.trace.citationGate,
  [{partId:'P1',action:'repair-applied',preGateStatus:'answered'}],
  'citing one of the two linked sources now satisfies the candidate check');
 assert.match(result.answer,/regular conjunction\. \[S1\]/);
 assert.equal(result.questionParts[0].status,'supported');
 assert.deepEqual(result.trace.repairCycleLedger,
  {P1:[{phase:'citation-presence',outcomeChanged:true}]},
  'the adopted gate cycle is recorded in the cross-phase ledger');
});

test('batch 25 Q4: a gate repair citing a foreign source is still refused',async()=>{
 const uncitedReview={response:JSON.stringify({parts:[{partId:'P1',status:'answered',
  answerStatus:'answered',directAnswerClaimIds:['P1-C1'],retainedContextClaimIds:['P1-C1','P1-C2']}],claims:[]})};
 const foreignRepair={response:JSON.stringify({parts:[{partId:'P1',
  replacements:[
   {claimId:'P1-C1',text:'Hume links necessity to custom and regular conjunction in experience. [S2]'},
   {claimId:'P1-C2',text:'Custom, for Hume, guides the inference from one object to another.'}],
  additions:[]}]})};
 const ai=makeAI([answer('PART P1\nHume links necessity to custom and regular conjunction.\n\n'+
   'Custom, for Hume, guides causal inference.'),
  uncitedReview,foreignRepair],{decorateReview:false});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',
  [hume,kant],ai,[],{plan:onePartPlan,catalog,trace:true});
 assert.equal(result.trace.citationGate[0].action,'repair-refused');
 assert.equal(result.trace.citationGate[0].repairFailure.failureStep,'citation-candidate-check',
  'a citation outside the part’s linked sources does not satisfy the gate');
 assert.equal(result.trace.citationGate[0].repairFailure.candidateCheck.linkedSourceCount,1);
 assert.doesNotMatch(result.answer,/regular conjunction in experience/);
});

test('batch 25 L1: a one-claim repair re-reviews only that claim and carries the rest',async()=>{
 const claimTexts=[
  'Hume links necessity to custom and regular conjunction.',
  'Custom determines the mind to infer one object from another.',
  'Constant conjunction is observed throughout nature.',
  'The idea of necessity arises from an impression of reflection.'];
 const draft='PART P1\n'+claimTexts.join('\n\n');
 const uncitedReview={response:JSON.stringify({parts:[{partId:'P1',status:'answered',
  answerStatus:'answered',directAnswerClaimIds:['P1-C1'],
  retainedContextClaimIds:['P1-C1','P1-C2','P1-C3','P1-C4']}],claims:[]})};
 const citedRepair={response:JSON.stringify({parts:[{partId:'P1',
  replacements:claimTexts.map((text,index)=>({claimId:'P1-C'+(index+1),
   text:index===0?text+' [S1]':text})),
  additions:[]}]})};
 let reReviewPayload=null;
 const deltaReReview=(_model,{messages})=>{
  reReviewPayload=parsePayload(messages);
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
   directAnswerClaimIds:reReviewPayload.claims.map(claim=>claim.claimId),
   retainedContextClaimIds:[]}],
   claims:reReviewPayload.claims.map(claim=>({claimId:claim.claimId,status:'answered',
    sources:claim.sourceIds.map(sourceId=>({sourceId,status:'answered',
     spanIds:[claim.sourceEvidence.find(item=>item.sourceId===sourceId).spanIds[0]]}))}))})};
 };
 const ai=makeAI([answer(draft),uncitedReview,citedRepair,deltaReReview],
  {decorateReview:false});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',
  [hume],ai,[],{plan:onePartPlan,catalog,trace:true});
 assert.equal(ai.calls.length,4,'compose, review, the gate repair, and its re-review');
 assert.deepEqual(reReviewPayload.claims.map(claim=>claim.claimId),['P1-C1'],
  'the re-review packet contains only the claim whose citation set changed');
 assert.deepEqual(result.trace.deltaReReview,
  [{partId:'P1',deltaClaimIds:['P1-C1'],carriedClaimIds:['P1-C2','P1-C3','P1-C4'],
   claimMapping:[{candidateClaimId:'P1-C1',priorClaimId:'P1-C1'},
    {candidateClaimId:'P1-C2',priorClaimId:'P1-C2'},
    {candidateClaimId:'P1-C3',priorClaimId:'P1-C3'},
    {candidateClaimId:'P1-C4',priorClaimId:'P1-C4'}],
   newClaimIds:[],removedClaimIds:[]}]);
 assert.equal(result.trace.citationGate[0].action,'repair-applied');
 for(const text of claimTexts)
  assert.ok(result.answer.includes(text),
   'carried claims keep their verdicts and ship: '+text.slice(0,40));
 assert.match(result.answer,/regular conjunction\. \[S1\]/);
});

test('batch 25 L1: a repair changing every claim falls back to a full re-review',async()=>{
 const claimTexts=[
  'Hume links necessity to custom and regular conjunction.',
  'Custom determines the mind to infer one object from another.'];
 const draft='PART P1\n'+claimTexts.join('\n\n');
 const uncitedReview={response:JSON.stringify({parts:[{partId:'P1',status:'answered',
  answerStatus:'answered',directAnswerClaimIds:['P1-C1'],
  retainedContextClaimIds:['P1-C1','P1-C2']}],claims:[]})};
 const citedRepair={response:JSON.stringify({parts:[{partId:'P1',
  replacements:claimTexts.map((text,index)=>({claimId:'P1-C'+(index+1),
   text:text+' [S1]'})),
  additions:[]}]})};
 let reReviewPayload=null;
 const fullReReview=(_model,{messages})=>{
  reReviewPayload=parsePayload(messages);
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
   directAnswerClaimIds:reReviewPayload.claims.map(claim=>claim.claimId),
   retainedContextClaimIds:[]}],
   claims:reReviewPayload.claims.map(claim=>({claimId:claim.claimId,status:'answered',
    sources:claim.sourceIds.map(sourceId=>({sourceId,status:'answered',
     spanIds:[claim.sourceEvidence.find(item=>item.sourceId===sourceId).spanIds[0]]}))}))})};
 };
 const ai=makeAI([answer(draft),uncitedReview,citedRepair,fullReReview],
  {decorateReview:false});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',
  [hume],ai,[],{plan:onePartPlan,catalog,trace:true});
 assert.equal(ai.calls.length,4);
 assert.deepEqual(reReviewPayload.claims.map(claim=>claim.claimId),['P1-C1','P1-C2'],
  'every claim changed, so the re-review packet is the whole part');
 assert.deepEqual(result.trace.deltaReReview,
  [{partId:'P1',deltaClaimIds:['P1-C1','P1-C2'],carriedClaimIds:[],
   claimMapping:[{candidateClaimId:'P1-C1',priorClaimId:'P1-C1'},
    {candidateClaimId:'P1-C2',priorClaimId:'P1-C2'}],
   newClaimIds:[],removedClaimIds:[]}]);
 assert.equal(result.trace.citationGate[0].action,'repair-applied');
});

test('batch 25 L2: cycles are ledgered across phases and a changed first cycle allows a second',async()=>{
 // Phase 1 (answer repair): the reviewer marks the part repairable
 // with its direct answer unsupported; the repair is adopted (the
 // outcome class changes) but the adopted text still ships uncited,
 // so the citation gate runs phase 2 and its repair is adopted too.
 const initialReview={response:JSON.stringify({parts:[{partId:'P1',status:'partial',
   answerStatus:'partial',repairable:true,directAnswerClaimIds:['P1-C1'],
   retainedContextClaimIds:[]}],
  claims:[{claimId:'P1-C1',status:'partial',
   sources:[{sourceId:'S1',status:'partial',spanIds:[]}],
   clauses:[{text:'Hume links necessity to custom.',status:'partial',issueCode:'none',
    sources:[{sourceId:'S1',status:'partial',spanIds:[]}]}]}]})};
 const repairOnce=(_model,{messages})=>{
  const payload=parsePayload(messages);
  return {response:JSON.stringify({parts:[{partId:'P1',
   replacements:payload.parts[0].repair.replaceClaimIds.map(claimId=>({claimId,
    text:'Hume links necessity to custom and regular conjunction.'})),
   additions:[]}]})};
 };
 const acceptCited=(_model,{messages})=>{
  const payload=parsePayload(messages);
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
   directAnswerClaimIds:payload.claims.map(claim=>claim.claimId),retainedContextClaimIds:[]}],
   claims:payload.claims.map(claim=>({claimId:claim.claimId,status:'answered',
    sources:claim.sourceIds.map(sourceId=>({sourceId,status:'answered',
     spanIds:[claim.sourceEvidence.find(item=>item.sourceId===sourceId).spanIds[0]]}))}))})};
 };
 const acceptContext=()=>({response:JSON.stringify({parts:[{partId:'P1',status:'answered',
   answerStatus:'answered',directAnswerClaimIds:['P1-C1'],
   retainedContextClaimIds:['P1-C1']}],claims:[]})});
 const gateRepair={response:JSON.stringify({parts:[{partId:'P1',
  replacements:[{claimId:'P1-C1',text:'Hume links necessity to custom and regular conjunction. [S1]'}],
  additions:[]}]})};
 const ai=makeAI([answer('PART P1\nHume links necessity to custom. [S1]'),
  initialReview,rescueRejection(),repairOnce,acceptContext,gateRepair,acceptCited],
  {decorateReview:false});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',
  [hume],ai,[],{plan:onePartPlan,catalog,trace:true});
 assert.equal(result.trace.answerRepair.applied,true,
  'the answer-repair cycle adopted its candidate');
 assert.equal(result.trace.citationGate[0].action,'repair-applied',
  'the gate cycle still ran after the changed first cycle');
 assert.deepEqual(result.trace.repairCycleLedger,
  {P1:[{phase:'answer-repair',outcomeChanged:true},
    {phase:'citation-presence',outcomeChanged:true}]});
});

test('batch 25 L2: two no-change cycles are ledgered and no third repair is attempted',async()=>{
 // Phase 1 (answer repair): repairable part, repair runs, its
 // re-review rejects it — no change. Phase 2 (citation gate): the
 // part still ships uncited; the gate repair produces a candidate
 // whose re-review also refuses — no change. Later phases must not
 // run another repair for the part.
 const initialReview={response:JSON.stringify({parts:[{partId:'P1',status:'partial',
   answerStatus:'partial',repairable:true,directAnswerClaimIds:['P1-C1'],
   retainedContextClaimIds:['P1-C2']}],
  claims:[{claimId:'P1-C1',status:'partial',
   sources:[{sourceId:'S1',status:'partial',spanIds:[]}],
   clauses:[{text:'Hume links necessity to custom.',status:'partial',issueCode:'none',
    sources:[{sourceId:'S1',status:'partial',spanIds:[]}]}]}]})};
 const repairOnce=(_model,{messages})=>{
  const payload=parsePayload(messages);
  return {response:JSON.stringify({parts:[{partId:'P1',
   replacements:payload.parts[0].repair.replaceClaimIds.map(claimId=>({claimId,
    text:'Hume links necessity to custom and regular conjunction. [S1]'})),
   additions:[]}]})};
 };
 const rejectingReReview=(_model,{messages})=>{
  const payload=parsePayload(messages);
  return {response:JSON.stringify({parts:[{partId:'P1',status:'partial',
   answerStatus:'partial',directAnswerClaimIds:payload.claims.map(claim=>claim.claimId),
   retainedContextClaimIds:[]}],
   claims:payload.claims.map(claim=>({claimId:claim.claimId,status:'partial',
    sources:claim.sourceIds.map(sourceId=>({sourceId,status:'partial',spanIds:[]}))}))})};
 };
 const gateRepair=(_model,{messages})=>{
  const payload=parsePayload(messages);
  return {response:JSON.stringify({parts:[{partId:'P1',
   replacements:payload.parts[0].repair.replaceClaimIds.map(claimId=>({claimId,
    text:'Custom is the great guide of human life. [S1]'})),
   additions:[]}]})};
 };
 const ai=makeAI([answer('PART P1\nHume links necessity to custom. [S1]\n'+
   'Custom is the great guide of human life.'),
  initialReview,rescueRejection(),repairOnce,rejectingReReview,
  gateRepair,rejectingReReview],{decorateReview:false});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',
  [hume],ai,[],{plan:onePartPlan,catalog,trace:true});
 assert.equal(ai.calls.length,7,
  'compose, review, rescue, answer repair + re-review, gate repair + re-review — and nothing further');
 assert.equal(result.trace.answerRepair.applied,false);
 assert.deepEqual(result.trace.repairCycleLedger,
  {P1:[{phase:'answer-repair',outcomeChanged:false},
    {phase:'citation-presence',outcomeChanged:false}]},
  'both cross-phase cycles are recorded as no-change');
});

// Batch 26. The addendum to the shipment-leak diagnosis measured the
// batch-25 rescue end to end: 55 flips, ZERO accepted — 42 vetoed by
// clause demotion and 13 by attribution vetoes in re-normalization,
// because rescue flipped the pair's status without ever addressing the
// layers that demote it; and re-review verdicts were merged by
// positional claim ID across repair re-segmentation, so verdicts
// landed on the wrong texts. The tests below cross the pilot route
// (composeEvidenceAnswer) for each item: B26-1 clause clearances,
// B26-2 attribution anchors, B26-3 text-identity claim mapping,
// B26-4 flip-veto and rendered-text shipment records.
const batch26RouterAI=({review, rescue, draft})=>{
 const ai={calls:[], async run(model,request){
  const messages=request.messages;
  ai.calls.push(messages);
  const system=messages[0].content;
  if(system.startsWith('Answer the reader'))return {response:draft};
  if(system.startsWith('Review the complete answer'))return {response:JSON.stringify(review)};
  if(system.startsWith('Judge only the listed claim'))return rescue(parsePayload(messages));
  if(system.startsWith('Patch only the requested claims')){
   const payload=parsePayload(messages);
   return {response:JSON.stringify({parts:[{partId:'P1',
    replacements:(payload.parts[0].repair||payload.parts[0]).replaceClaimIds
     .map(claimId=>({claimId,text:'Custom is the great guide of human life. [S1]'})),
    additions:[]}]})};
  }
  throw new Error('unexpected stage: '+system.slice(0,60));
 }};
 return ai;
};
const clausePartialReview={parts:[{partId:'P1',status:'partial',answerStatus:'partial',
  directAnswerClaimIds:['P1-C1'],retainedContextClaimIds:['P1-C2'],
  directAnswerRequirementIds:[],requirements:[]}],
 claims:[{claimId:'P1-C1',status:'partial',
  sources:[{sourceId:'S1',status:'partial',spanIds:['S1-Q1'],
   attributionStatus:'not_applicable',attributedSpeaker:'',
   subjectAttributionStatus:'supported',attributedSubject:'Hume',
   evidenceRole:'work-assertion',supportBoundary:'Supports the full sentence.'}],
  clauses:[
   {text:'Hume links necessity to custom',status:'answered',issueCode:'none',
    sources:[{sourceId:'S1',status:'answered',spanIds:['S1-Q1']}]},
   {text:'treats constant conjunction as its basis',status:'partial',issueCode:'compound',
    sources:[{sourceId:'S1',status:'partial',spanIds:['S1-Q1']}]},
   {text:'the mind is determined to infer one object from another',status:'answered',
    issueCode:'none',sources:[{sourceId:'S1',status:'answered',spanIds:['S1-Q1']}]}]}]};

test('batch 26 B26-1: a rescue clearance of the outstanding clause lets the flip ship the claim',async()=>{
 let rescuePayload;
 const ai=batch26RouterAI({
  draft:'PART P1\nHume links necessity to custom, treats constant conjunction as its basis, and holds that the mind is determined to infer one object from another. [S1]\nCustom is the great guide of human life.',
  review:clausePartialReview,
  rescue:payload=>{
   rescuePayload=payload;
   const item=payload.decisions[0];
   return {response:JSON.stringify({decisions:[{claimId:item.claimId,sourceId:item.sourceId,
    verdict:'supported',fragment:item.spans[0].text,
    elements:[{element:item.claimText,stated:true}],
    clauses:[{text:'treats constant conjunction as its basis',stated:true,
     fragment:'similar objects are constantly conjoined'}]}]})};
  }});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',
  [hume],ai,[],{plan:onePartPlan,catalog,trace:true});
 assert.deepEqual(rescuePayload.decisions[0].outstandingClauses,
  [{text:'treats constant conjunction as its basis'}],
  'the rescue request carries exactly the outstanding clause');
 assert.equal(result.outcome,'verified-source-draft');
 assert.ok(result.answer.includes('Hume links necessity to custom, treats constant conjunction as its basis, and holds that the mind is determined to infer one object from another. [S1]'),
  'the flipped claim sentence ships in the final answer');
 const decision=result.trace.reviewContract.reviewDecisions
  .find(entry=>entry.claimId==='P1-C1'&&entry.sourceId==='S1');
 assert.equal(decision.accepted,true);
 assert.equal(decision.rescueAccepted,true);
 const rescueClaim=result.trace.rescueReview.parts[0].claims[0];
 assert.deepEqual(rescueClaim.clearedClauses,
  [{text:'treats constant conjunction as its basis',
   fragment:'similar objects are constantly conjoined'}]);
 assert.equal(rescueClaim.flipOutcome,'accepted');
 assert.equal(rescueClaim.flipVeto,undefined);
 const reconciliation=result.trace.finalCoverageReconciliation
  .find(entry=>entry.partId==='P1');
 assert.ok(reconciliation.shippedClaimIds.includes('P1-C1'));
 assert.equal(reconciliation.textAbsentClaimIds,undefined,
  'B26-4: rendered-text verification ran and found the shipped claim present');
});

test('batch 26 B26-1 + batch 27 B27-4: a supported verdict omitting its clause entries never flips',async()=>{
 const ai=batch26RouterAI({
  draft:'PART P1\nHume links necessity to custom, treats constant conjunction as its basis, and holds that the mind is determined to infer one object from another. [S1]\nCustom is the great guide of human life.',
  review:clausePartialReview,
  rescue:payload=>{
   const item=payload.decisions[0];
   return {response:JSON.stringify({decisions:[{claimId:item.claimId,sourceId:item.sourceId,
    verdict:'supported',fragment:item.spans[0].text,
    elements:[{element:item.claimText,stated:true}]}]})};
  }});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',
  [hume],ai,[],{plan:onePartPlan,catalog,trace:true});
 const rescueEntry=result.trace.rescueReview.parts[0];
 // Batch 27 (B27-4): clause entries are enforced like element
 // entries. The supported verdict returns no clauses entry for the
 // listed outstanding clause on either attempt, so it is invalid,
 // retried once, and then recorded not-supported with reason
 // clause-verdicts-missing — it never flips, so the clause demotion
 // the flip would have faced never even engages.
 assert.equal(rescueEntry.flipped,0,
  'a verdict that omits its listed clause entries never flips');
 assert.equal(rescueEntry.outcome,'completed-after-retry');
 assert.deepEqual(rescueEntry.attempts.map(attempt=>attempt.outcome),
  ['invalid-response','clause-verdicts-missing']);
 const rescueClaim=rescueEntry.claims[0];
 assert.equal(rescueClaim.verdict,'not-supported');
 assert.equal(rescueClaim.clauseVerdictsMissing,true);
 assert.equal(rescueClaim.reason,'clause-verdicts-missing');
 const decision=result.trace.reviewContract.reviewDecisions
  .find(entry=>entry.claimId==='P1-C1'&&entry.sourceId==='S1');
 assert.equal(decision.accepted,false,'the claim stays unaccepted (fail-closed)');
 assert.notEqual(result.outcome,'verified-source-draft');
 assert.ok(!result.answer.includes('treats constant conjunction as its basis'));
});

const subjectMismatchReview={parts:[{partId:'P1',status:'partial',answerStatus:'partial',
  directAnswerClaimIds:['P1-C1'],retainedContextClaimIds:['P1-C2'],
  directAnswerRequirementIds:[],requirements:[]}],
 claims:[{claimId:'P1-C1',status:'answered',
  sources:[{sourceId:'S1',status:'answered',spanIds:['S1-Q1'],
   attributionStatus:'not_applicable',attributedSpeaker:'',
   subjectAttributionStatus:'supported',attributedSubject:'Kant',
   evidenceRole:'work-assertion',supportBoundary:'Supports the full sentence.'}]}]};

test('batch 26 B26-2: a rescue flip anchored to the work author clears a subject mismatch',async()=>{
 let rescuePayload;
 const ai=batch26RouterAI({
  draft:'PART P1\nHume links necessity to custom and regular conjunction. [S1]\nCustom is the great guide of human life.',
  review:subjectMismatchReview,
  rescue:payload=>{
   rescuePayload=payload;
   const item=payload.decisions[0];
   return {response:JSON.stringify({decisions:[{claimId:item.claimId,sourceId:item.sourceId,
    verdict:'supported',fragment:item.spans[0].text,anchor:'Hume',
    elements:[{element:item.claimText,stated:true}]}]})};
  }});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',
  [hume],ai,[],{plan:onePartPlan,catalog,trace:true});
 assert.deepEqual(rescuePayload.decisions[0].attributionFinding,
  {reason:'source-subject-attribution-mismatch'},
  'the rescue request carries the attribution finding to answer');
 assert.equal(result.outcome,'verified-source-draft');
 assert.ok(result.answer.includes('Hume links necessity to custom and regular conjunction. [S1]'),
  'the anchored flip ships the claim');
 const decision=result.trace.reviewContract.reviewDecisions
  .find(entry=>entry.claimId==='P1-C1'&&entry.sourceId==='S1');
 assert.equal(decision.accepted,true);
 assert.equal(decision.rescueAccepted,true);
 const rescueClaim=result.trace.rescueReview.parts[0].claims[0];
 assert.equal(rescueClaim.anchor,'Hume');
 assert.equal(rescueClaim.flipOutcome,'accepted');
 assert.equal(rescueClaim.flipVeto,undefined);
});

test('batch 26 B26-2: an anchor that matches no candidate holds the flip and records the veto',async()=>{
 const ai=batch26RouterAI({
  draft:'PART P1\nHume links necessity to custom and regular conjunction. [S1]\nCustom is the great guide of human life.',
  review:subjectMismatchReview,
  rescue:payload=>{
   const item=payload.decisions[0];
   return {response:JSON.stringify({decisions:[{claimId:item.claimId,sourceId:item.sourceId,
    verdict:'supported',fragment:item.spans[0].text,anchor:'Kant',
    elements:[{element:item.claimText,stated:true}]}]})};
  }});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',
  [hume],ai,[],{plan:onePartPlan,catalog,trace:true});
 const rescueEntry=result.trace.rescueReview.parts[0];
 assert.equal(rescueEntry.flipped,0,'no flip is applied without a valid anchor');
 const rescueClaim=rescueEntry.claims[0];
 assert.equal(rescueClaim.attributionHeld,true);
 assert.equal(rescueClaim.verdict,'not-supported');
 assert.deepEqual(rescueClaim.flipVeto,
  {layer:'attribution',held:true,reason:'source-subject-attribution-mismatch'});
 const decision=result.trace.reviewContract.reviewDecisions
  .find(entry=>entry.claimId==='P1-C1'&&entry.sourceId==='S1');
 assert.equal(decision.accepted,false);
 assert.equal(result.outcome,'generation-failed');
});

test('batch 26 B26-3: a repair that splits a claim keeps verdicts on their own texts through delta re-review',async()=>{
 // The Wealth shape, through the citation gate: the part ships
 // only uncited context claims (its one cited claim was rejected),
 // and the gate repair rewrites one context claim into two
 // sentences while citing another. Re-segmentation of the repaired
 // paragraph — now cited — splits the two sentences into separate
 // claims, minting a new claim in the middle of the part and
 // shifting every later claim's position by one.
 const splitReview={parts:[{partId:'P1',status:'partial',answerStatus:'partial',
   directAnswerClaimIds:['P1-C1'],retainedContextClaimIds:['P1-C2','P1-C3','P1-C4'],
   directAnswerRequirementIds:[],requirements:[]}],
  claims:[{claimId:'P1-C1',status:'partial',
   sources:[{sourceId:'S1',status:'partial',spanIds:[],
    attributionStatus:'not_applicable',attributedSpeaker:'',
    subjectAttributionStatus:'supported',attributedSubject:'Hume',
    evidenceRole:'work-assertion',supportBoundary:'No span was supplied.'}]}]};
 let reReviewPayload;
 const gateRepair=(_model,{messages})=>{
  const payload=parsePayload(messages);
  const texts={'P1-C2':'Constant conjunction is observed throughout nature. It is observed in every case of resembling objects.',
   'P1-C3':'Custom is the great guide of human life. [S1]',
   'P1-C4':'The idea of necessity arises from an impression of reflection.'};
  return {response:JSON.stringify({parts:[{partId:'P1',
   replacements:payload.parts[0].repair.replaceClaimIds
    .map(claimId=>({claimId,text:texts[claimId]})),additions:[]}]})};
 };
 const deltaReReview=(_model,{messages})=>{
  reReviewPayload=parsePayload(messages);
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
    answerStatus:'answered',directAnswerClaimIds:['P1-C3'],
    retainedContextClaimIds:reReviewPayload.parts[0].contextClaims.map(claim=>claim.claimId),
    directAnswerRequirementIds:[],requirements:[]}],
   claims:reReviewPayload.claims.map(claim=>({claimId:claim.claimId,status:'answered',
    sources:claim.sourceIds.map(sourceId=>({sourceId,status:'answered',
     spanIds:[claim.sourceEvidence.find(entry=>entry.sourceId===sourceId).spanIds[0]],
     attributionStatus:'not_applicable',attributedSpeaker:'',
     subjectAttributionStatus:'supported',attributedSubject:'Hume',
     evidenceRole:'work-assertion'}))}))})};
 };
 const ai=makeAI([answer('PART P1\nHume links necessity to custom and regular conjunction. [S1] Constant conjunction is observed throughout nature. Custom is the great guide of human life.\n\n'+
   'The idea of necessity arises from an impression of reflection.'),
  {response:JSON.stringify(splitReview)},rescueRejection(),gateRepair,deltaReReview],
  {decorateReview:false});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',
  [hume],ai,[],{plan:onePartPlan,catalog,trace:true});
 assert.equal(ai.calls.length,5,'compose, review, rescue, gate repair, one delta re-review');
 assert.equal(result.trace.citationGate[0].action,'repair-applied');
 assert.deepEqual(reReviewPayload.claims.map(claim=>claim.claimId),['P1-C3'],
  'only the changed cited claim is sent for a source decision');
 assert.deepEqual(reReviewPayload.parts[0].contextClaims.map(claim=>claim.claimId),
  ['P1-C1','P1-C2'],
  'the split halves are delta context claims; the carried claim is not re-reviewed');
 assert.deepEqual(result.trace.deltaReReview,
  [{partId:'P1',deltaClaimIds:['P1-C1','P1-C2','P1-C3'],
   carriedClaimIds:['P1-C4'],
   claimMapping:[{candidateClaimId:'P1-C1',priorClaimId:'P1-C2'},
    {candidateClaimId:'P1-C2',priorClaimId:null},
    {candidateClaimId:'P1-C3',priorClaimId:'P1-C3'},
    {candidateClaimId:'P1-C4',priorClaimId:'P1-C4'}],
   newClaimIds:['P1-C2'],removedClaimIds:[]}],
  'identity mapping is recorded: the first candidate claim is the old second claim, the split-off sentence is new');
 for(const fragment of ['Constant conjunction is observed throughout nature.',
   'It is observed in every case of resembling objects.',
   'Custom is the great guide of human life. [S1]',
   'The idea of necessity arises from an impression of reflection.'])
  assert.ok(result.answer.includes(fragment),'answer ships: '+fragment);
 const carriedDecision=result.trace.reReviewDecisions
  .find(entry=>entry.claimId==='P1-C4');
 assert.ok(carriedDecision.claimText.startsWith('The idea of necessity'),
  'the carried verdict for P1-C4 belongs to the idea text, not a shifted neighbour');
});

test('batch 26 B26-3: an ambiguous text mapping falls back to a whole-part re-review',async()=>{
 // Two identical context claims make the candidate-to-prior mapping
 // ambiguous (each duplicate matches both originals), so the delta
 // path must refuse to carry anything and re-review the whole part.
 const duplicateReview={parts:[{partId:'P1',status:'partial',answerStatus:'partial',
   directAnswerClaimIds:['P1-C1'],
   retainedContextClaimIds:['P1-C2','P1-C3','P1-C4'],
   directAnswerRequirementIds:[],requirements:[]}],
  claims:[{claimId:'P1-C1',status:'partial',
   sources:[{sourceId:'S1',status:'partial',spanIds:[],
    attributionStatus:'not_applicable',attributedSpeaker:'',
    subjectAttributionStatus:'supported',attributedSubject:'Hume',
    evidenceRole:'work-assertion',supportBoundary:'No span was supplied.'}]}]};
 let reReviewPayload;
 const gateRepair=(_model,{messages})=>{
  const payload=parsePayload(messages);
  const texts={'P1-C2':'Constant conjunction is observed throughout nature. [S1]',
   'P1-C3':'Custom is the great guide of human life.',
   'P1-C4':'Custom is the great guide of human life.'};
  return {response:JSON.stringify({parts:[{partId:'P1',
   replacements:payload.parts[0].repair.replaceClaimIds
    .map(claimId=>({claimId,text:texts[claimId]})),additions:[]}]})};
 };
 const fullReReview=(_model,{messages})=>{
  reReviewPayload=parsePayload(messages);
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
    answerStatus:'answered',directAnswerClaimIds:['P1-C1'],
    retainedContextClaimIds:reReviewPayload.parts[0].contextClaims.map(claim=>claim.claimId),
    directAnswerRequirementIds:[],requirements:[]}],
   claims:reReviewPayload.claims.map(claim=>({claimId:claim.claimId,status:'answered',
    sources:claim.sourceIds.map(sourceId=>({sourceId,status:'answered',
     spanIds:[claim.sourceEvidence.find(entry=>entry.sourceId===sourceId).spanIds[0]],
     attributionStatus:'not_applicable',attributedSpeaker:'',
     subjectAttributionStatus:'supported',attributedSubject:'Hume',
     evidenceRole:'work-assertion'}))}))})};
 };
 const ai=makeAI([answer('PART P1\nHume links necessity to custom and regular conjunction. [S1] Constant conjunction is observed throughout nature.\n\n'+
   'Custom is the great guide of human life.\n\n'+
   'Custom is the great guide of human life.'),
  {response:JSON.stringify(duplicateReview)},rescueRejection(),gateRepair,fullReReview],
  {decorateReview:false});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',
  [hume],ai,[],{plan:onePartPlan,catalog,trace:true});
 assert.equal(ai.calls.length,5,'compose, review, rescue, gate repair, whole-part re-review');
 assert.deepEqual(reReviewPayload.claims.map(claim=>claim.claimId),['P1-C1'],
  'the whole candidate is re-reviewed: its cited claim is in the packet');
 assert.deepEqual(reReviewPayload.parts[0].contextClaims.map(claim=>claim.claimId),
  ['P1-C2','P1-C3'],
  'and both duplicated context claims are in the packet too — nothing was carried');
 assert.equal(result.trace.deltaReReview[0].mappingFallback,'ambiguous-claim-mapping');
 assert.deepEqual(result.trace.deltaReReview[0].carriedClaimIds,[]);
 assert.equal(result.trace.citationGate[0].action,'repair-applied');
});

test('batch 26 B26-4: rendered-text verification records a shipped claim whose text is absent',async()=>{
 const parts=[{part:{id:'P1',sourceRequired:true},answers:[
  {claimId:'P1-C1',text:'Hume links necessity to custom.',sourceIds:['S1']},
  {claimId:'P1-C2',text:'Custom is the great guide of human life.',sourceIds:['S1']}]}];
 const reconciliation=reconcileFinalPartCoverage(parts,new Set(['P1']));
 assert.deepEqual(reconciliation[0].shippedClaimIds,['P1-C1','P1-C2'],
  'ID bookkeeping alone reports both claims shipped');
 const absent=findTextAbsentShippedClaims(reconciliation[0].shippedClaimIds,
  parts[0].answers,'Hume links necessity to custom. [S1]');
 assert.deepEqual(absent,['P1-C2'],
  'the text check catches the claim the bookkeeping cannot see is missing');
});

// ---------------------------------------------------------------------------
// Batch 27 (B27-1..B27-6)
// ---------------------------------------------------------------------------

test('batch 27 B27-1: subject extraction sees narrative prose',()=>{
 // The three verified batch-26 failures: an irregular past-tense
 // predicate, a subordinate clause after "how", and a possessive
 // state noun outside the old list.
 assert.deepEqual(claimPersonSubjects('Kurtz sat at the head of an immense round table.'),
  ['Kurtz']);
 assert.deepEqual(claimPersonSubjects(
  'He observes the physical manifestation of Kurtz\'s authority, noting how Kurtz sat at the head of an immense round table in the station\'s mess-room, a position that felt like an "unalterable conviction".'),
  ['Kurtz']);
 assert.deepEqual(claimPersonSubjects("Kurtz's authority shaped his command."),['Kurtz']);
 assert.deepEqual(claimPersonSubjects('Marlow notes how Kurtz sat at the head of the table.'),
  ['Marlow','Kurtz']);
 // Negative controls: abstractions, determiners, and places stay empty.
 assert.deepEqual(claimPersonSubjects('Necessity arises from constant conjunction.'),[]);
 assert.deepEqual(claimPersonSubjects('Other goods can be snatched away by fortune and circumstance.'),[]);
 assert.deepEqual(claimPersonSubjects('The city stands where the river bends, and its people trade with the valley towns.'),[]);
 assert.equal(personNamesMatch('Du Bois','W. E. B. Du Bois'),true,
  'particle surnames match initialism bylines (the work-author exception depends on it)');
 assert.equal(personNamesMatch('De Silentio','Johannes de Silentio'),true);
});

// Batch 27 (B27-2): the Conrad shape through the pilot route. The
// span's actor is the pronoun "he" (the Outer Station manager); the
// reviewer resolves the pronoun to Kurtz in both its boundary and its
// attributedSubject. Before batch 27 every layer compared those
// model strings against each other and the claim shipped.
const conradPlan={version:'reader-evidence-v2',intent:'explain',
 sources:[{label:'Joseph Conrad',role:'primary',bookIds:['77']}],
 parts:[{id:'P1',question:'In Heart of Darkness, who sat at the head of the round table in the station mess-room?',
   sourceBookIds:['77'],searchQueries:['Conrad round table mess-room'],
   candidateSourceIds:['S1']}],queries:['Conrad round table mess-room']};
const conradPronounText='The manager of the Outer Station was a commonplace man who inspired neither love nor fear. '+
 'When annoyed at meal-times by the constant quarrels of the white men about precedence, he ordered an immense round table to be made, for which a special house had to be built. '+
 'This was the station\'s mess-room. The men sat down to their meals under his eye, and the quarrels about precedence ended.';
const conradSource={id:'S1',bookId:'77',title:'Heart of Darkness — Joseph Conrad',page:88,
 text:conradPronounText,preview:'He ordered an immense round table to be made.'};
const conradReview=spanIds=>({parts:[{partId:'P1',status:'answered',answerStatus:'answered',
  directAnswerClaimIds:['P1-C1'],retainedContextClaimIds:[]}],
 claims:[{claimId:'P1-C1',status:'answered',sources:[{sourceId:'S1',status:'answered',
  spanIds,attributionStatus:'not_applicable',attributedSpeaker:'',
  subjectAttributionStatus:'supported',attributedSubject:'Kurtz',
  evidenceRole:'character-or-narrator',
  supportBoundary:'establishes that Kurtz ordered an immense round table for the station\'s mess-room.'}]}]});
const rescueNotSupported=payload=>({response:JSON.stringify({decisions:
 (payload.decisions||[]).map(item=>({claimId:item.claimId,sourceId:item.sourceId,
  verdict:'not-supported',fragment:item.spans?.[0]?.text||'no support'}))})});

test('batch 27 B27-2: a pronoun-actor span cannot corroborate the reviewer-resolved name',async()=>{
 const spans=buildReviewSpans('S1',conradPronounText);
 const pronounSpan=spans.find(span=>span.text.includes('he ordered an immense round table'));
 assert.ok(pronounSpan,'the fixture span carries the pronoun actor');
 const ai=batch26RouterAI({
  draft:'PART P1\nKurtz sat at the head of an immense round table in the station\'s mess-room. [S1]',
  review:conradReview([pronounSpan.spanId]),
  rescue:rescueNotSupported});
 const result=await composeEvidenceAnswer('In Heart of Darkness, who sat at the head of the round table in the station mess-room?',
  [conradSource],ai,[],{plan:conradPlan,
   catalog:{77:'Heart of Darkness — Joseph Conrad'},trace:true});
 const decision=result.trace.reviewContract.reviewDecisions
  .find(entry=>entry.claimId==='P1-C1'&&entry.sourceId==='S1');
 assert.equal(decision.accepted,false,
  'reviewer and claim agreeing on a name no span states no longer ships');
 assert.equal(decision.validationReason,'subject-not-named-in-span');
 assert.ok(result.trace.reviewContract.supportIssues.some(issue=>
  issue.claimId==='P1-C1'&&issue.sourceId==='S1'&&
  issue.reason==='subject-not-named-in-span'));
 assert.doesNotMatch(result.answer,/Kurtz sat at the head/);
 // The demotion is an attribution finding the rescue can answer:
 // the requested pair carried the finding (B27-3 trace shape).
 const requested=result.trace.rescueReview.parts[0].requestedPairs[0];
 assert.equal(requested.attributionFindingSent,true);
});

test('batch 27 B27-2: a co-accepted span naming the person ships the same claim',async()=>{
 const namingSentence='Kurtz sat at the head of the immense round table whenever he came down to the station.';
 const sourceText=conradPronounText+' '+namingSentence;
 const spans=buildReviewSpans('S1',sourceText);
 const pronounSpan=spans.find(span=>span.text.includes('he ordered an immense round table'));
 const namingSpan=spans.find(span=>span.text.includes('Kurtz sat at the head'));
 assert.ok(pronounSpan&&namingSpan);
 const source={...conradSource,text:sourceText};
 const ai=batch26RouterAI({
  draft:'PART P1\nKurtz sat at the head of an immense round table in the station\'s mess-room. [S1]',
  review:conradReview([pronounSpan.spanId,namingSpan.spanId]),
  rescue:rescueNotSupported});
 const result=await composeEvidenceAnswer('In Heart of Darkness, who sat at the head of the round table in the station mess-room?',
  [source],ai,[],{plan:conradPlan,
   catalog:{77:'Heart of Darkness — Joseph Conrad'},trace:true});
 const decision=result.trace.reviewContract.reviewDecisions
  .find(entry=>entry.claimId==='P1-C1'&&entry.sourceId==='S1');
 assert.equal(decision.accepted,true,
  'an accepted span naming the subject corroborates the name');
 assert.equal(decision.validationReason,null);
 assert.match(result.answer,/Kurtz sat at the head of an immense round table/);
 assert.equal(result.questionParts[0].status,'supported');
});

test('batch 27 B27-1: extraction blind spots are counted in the review contract',async()=>{
 const spans=buildReviewSpans('S1',conradPronounText);
 const ai=batch26RouterAI({
  draft:'PART P1\nKurtz at the station commanded attention. [S1]',
  review:{parts:[{partId:'P1',status:'answered',answerStatus:'answered',
    directAnswerClaimIds:['P1-C1'],retainedContextClaimIds:[]}],
   claims:[{claimId:'P1-C1',status:'answered',sources:[{sourceId:'S1',status:'answered',
    spanIds:[spans[0].spanId],attributionStatus:'not_applicable',attributedSpeaker:'',
    evidenceRole:'work-assertion'}]}]},
  rescue:rescueNotSupported});
 const result=await composeEvidenceAnswer('Who commanded attention at the station?',
  [conradSource],ai,[],{plan:conradPlan,
   catalog:{77:'Heart of Darkness — Joseph Conrad'},trace:true});
 const decision=result.trace.reviewContract.reviewDecisions
  .find(entry=>entry.claimId==='P1-C1'&&entry.sourceId==='S1');
 assert.equal(decision.subjectAttributionStatus,undefined,
  'no subject was extracted, so the decision carries no subject fields (the silent shape)');
 assert.equal(result.trace.reviewContract.subjectExtractionBlindSpots,1,
  'the claim carries a capitalized name candidate, so the blind spot is counted');
});

test('batch 27 B27-3/B27-4: the rescue request is traced and its clauses come from the first normalization',async()=>{
 let rescuePayload;
 const ai=batch26RouterAI({
  draft:'PART P1\nHume links necessity to custom, treats constant conjunction as its basis, and holds that the mind is determined to infer one object from another. [S1]\nCustom is the great guide of human life.',
  review:clausePartialReview,
  rescue:payload=>{
   rescuePayload=payload;
   const item=payload.decisions[0];
   return {response:JSON.stringify({decisions:[{claimId:item.claimId,sourceId:item.sourceId,
    verdict:'supported',fragment:item.spans[0].text,
    elements:[{element:item.claimText,stated:true}],
    clauses:[{text:'treats constant conjunction as its basis',stated:true,
     fragment:'similar objects are constantly conjoined'}]}]})};
  }});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',
  [hume],ai,[],{plan:onePartPlan,catalog,trace:true});
 // The packet's outstanding list equals the first normalization's own
 // clause findings for the pair — the not-answered clause decisions
 // recorded on the pair's review decision — not a recomputation.
 const decision=result.trace.reviewContract.reviewDecisions
  .find(entry=>entry.claimId==='P1-C1'&&entry.sourceId==='S1');
 const expectedOutstanding=(decision.clauseDecisions||[])
  .filter(clause=>clause.status!=='answered').map(clause=>clause.text);
 assert.deepEqual(expectedOutstanding,['treats constant conjunction as its basis']);
 assert.deepEqual(rescuePayload.decisions[0].outstandingClauses,
  expectedOutstanding.map(text=>({text})));
 // B27-3 trace shape: the request itself is recorded per pair.
 assert.deepEqual(result.trace.rescueReview.parts[0].requestedPairs,
  [{claimId:'P1-C1',sourceId:'S1',outstandingClauseCount:1,
   outstandingClauses:['treats constant conjunction as its basis'],
   attributionFindingSent:false,
   spanCount:rescuePayload.decisions[0].spans.length}]);
});

test('batch 27 B27-4: a supported verdict omitting one listed clause is retried and then flips',async()=>{
 const twoClauseReview={parts:[{partId:'P1',status:'partial',answerStatus:'partial',
   directAnswerClaimIds:['P1-C1'],retainedContextClaimIds:['P1-C2']}],
  claims:[{claimId:'P1-C1',status:'partial',
   sources:[{sourceId:'S1',status:'partial',spanIds:['S1-Q1'],
    attributionStatus:'not_applicable',attributedSpeaker:'',
    subjectAttributionStatus:'supported',attributedSubject:'Hume',
    evidenceRole:'work-assertion',supportBoundary:'Supports the full sentence.'}],
   clauses:[
    {text:'Hume links necessity to custom',status:'answered',issueCode:'none',
     sources:[{sourceId:'S1',status:'answered',spanIds:['S1-Q1']}]},
    {text:'treats constant conjunction as its basis',status:'partial',issueCode:'compound',
     sources:[{sourceId:'S1',status:'partial',spanIds:['S1-Q1']}]},
    {text:'the mind is determined to infer one object from another',status:'partial',
     issueCode:'scope',sources:[{sourceId:'S1',status:'partial',spanIds:['S1-Q1']}]}]}]};
 let rescueCalls=0;
 const ai=batch26RouterAI({
  draft:'PART P1\nHume links necessity to custom, treats constant conjunction as its basis, and holds that the mind is determined to infer one object from another. [S1]\nCustom is the great guide of human life.',
  review:twoClauseReview,
  rescue:payload=>{
   rescueCalls++;
   const item=payload.decisions[0];
   assert.deepEqual(item.outstandingClauses.map(clause=>clause.text),
    ['treats constant conjunction as its basis',
     'the mind is determined to infer one object from another'],
    'both outstanding clauses from the first normalization ride in the packet');
   const clauses=rescueCalls===1?
    [{text:'treats constant conjunction as its basis',stated:true,
      fragment:'similar objects are constantly conjoined'}]:
    [{text:'treats constant conjunction as its basis',stated:true,
      fragment:'similar objects are constantly conjoined'},
     {text:'the mind is determined to infer one object from another',stated:true,
      fragment:'the mind is determined by custom to infer one from the other'}];
   return {response:JSON.stringify({decisions:[{claimId:item.claimId,sourceId:item.sourceId,
    verdict:'supported',fragment:item.spans[0].text,
    elements:[{element:item.claimText,stated:true}],clauses}]})};
  }});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',
  [hume],ai,[],{plan:onePartPlan,catalog,trace:true});
 assert.equal(rescueCalls,2,'the clause-incomplete verdict was re-asked exactly once');
 const rescueEntry=result.trace.rescueReview.parts[0];
 assert.deepEqual(rescueEntry.attempts.map(attempt=>attempt.outcome),
  ['invalid-response','completed']);
 assert.equal(rescueEntry.attempts[0].reason,'clause-verdicts-missing');
 assert.equal(rescueEntry.flipped,1,
  'the completed clause verdicts let the flip apply');
 const decision=result.trace.reviewContract.reviewDecisions
  .find(entry=>entry.claimId==='P1-C1'&&entry.sourceId==='S1');
 assert.equal(decision.accepted,true);
 assert.match(result.answer,/treats constant conjunction as its basis/);
});

test('batch 27 B27-5: the retry re-asks only the failed pair, with its full span set',async()=>{
 const spanTexts=[
  'Custom is the great guide of human life, and it is to custom alone that we must look for the explanation of causal inference in every case.',
  'Constant conjunction is observed throughout nature, where similar objects are constantly conjoined in every instance that experience offers us.',
  'Repetition shapes the inference by determining the mind, through repeated conjunction, to expect the same train of events as before.'];
 const sourceText=spanTexts.join(' ');
 const spans=buildReviewSpans('S1',sourceText);
 assert.equal(spans.length,3,'the fixture source yields three distinct spans');
 const source={id:'S1',bookId:'35',title:catalog[35],page:42,text:sourceText,
  preview:'Custom is the great guide of human life.'};
 const review={parts:[{partId:'P1',status:'partial',answerStatus:'partial',
   directAnswerClaimIds:['P1-C1'],retainedContextClaimIds:[]}],
  claims:[
   {claimId:'P1-C1',status:'partial',sources:[{sourceId:'S1',status:'partial',
     spanIds:[spans[0].spanId],attributionStatus:'not_applicable',attributedSpeaker:'',
     subjectAttributionStatus:'supported',attributedSubject:'Hume',
     evidenceRole:'work-assertion'}]},
   {claimId:'P1-C2',status:'partial',sources:[{sourceId:'S1',status:'partial',
     spanIds:[spans[2].spanId],attributionStatus:'not_applicable',attributedSpeaker:'',
     subjectAttributionStatus:'supported',attributedSubject:'Repetition',
     evidenceRole:'work-assertion'}]}]};
 let rescueCalls=0;let retryPayload=null;
 const ai=batch26RouterAI({
  draft:'PART P1\nCustom guides human life and causal inference. [S1]\n\nRepetition shapes the inference through repeated conjunction. [S1]',
  review,
  rescue:payload=>{
   rescueCalls++;
   if(rescueCalls===1)return {response:JSON.stringify({decisions:[
    {claimId:'P1-C1',sourceId:'S1',verdict:'not-supported',
     fragment:payload.decisions[0].spans[0].text},
    {claimId:'P1-C2',sourceId:'S1',verdict:'supported',
     fragment:'a fragment that appears in no supplied span',
     elements:[{element:'Repetition shapes the inference',stated:true}]}]})};
   retryPayload=payload;
   const item=payload.decisions[0];
   return {response:JSON.stringify({decisions:[{claimId:item.claimId,sourceId:item.sourceId,
    verdict:'supported',
    fragment:item.spans.find(span=>span.text.includes('Repetition shapes')).text,
    elements:[{element:item.claimText,stated:true}]}]})};
  }});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',
  [source],ai,[],{plan:onePartPlan,catalog,trace:true});
 assert.equal(rescueCalls,2);
 assert.equal(retryPayload.decisions.length,1,
  'only the pair whose verdict failed validation is re-asked');
 assert.equal(retryPayload.decisions[0].claimId,'P1-C2');
 assert.equal(retryPayload.decisions[0].spans.length,3,
  'the retry carries the pair\'s FULL span set — under the batch-25 two-span cap, the validating fragment (span three) could never be quoted');
 const rescueEntry=result.trace.rescueReview.parts[0];
 assert.equal(rescueEntry.attempts[1].retryScope,'failed-pairs');
 assert.equal(rescueEntry.attempts[1].fullSpans,true);
 assert.equal(rescueEntry.flipped,1,'the retried pair flips on its third span');
 assert.match(result.answer,/Repetition shapes the inference/);
});

test('batch 27 B27-6: rendered-text verification tolerates furniture and quote normalization',()=>{
 const answers=[
  {claimId:'P1-C1',text:'**Practice vs. Reason:** Custom guides expectation.',
   renderedText:'**Practice vs. Reason:** Custom guides expectation. [S1]'},
  {claimId:'P1-C2',text:'He calls it "a settled readiness" in reasoning.',
   renderedText:'He calls it "a settled readiness" in reasoning. [S1]'},
  {claimId:'P1-C3',text:'Custom guides expectation. Repetition shapes inference.',
   renderedText:'Custom guides expectation. Repetition shapes inference. [S1]'}];
 const answerText='Practice vs. Reason: Custom guides expectation. [S1]\n\n'+
  'He calls it “a settled readiness” in reasoning. [S1]\n\n'+
  '- Custom guides expectation.\n- Repetition shapes inference.';
 assert.deepEqual(findTextAbsentShippedClaims(['P1-C1','P1-C2','P1-C3'],
  answers,answerText),[],
  'bold furniture, curly quotes, and list re-paragraphing no longer read as absence');
});

test('batch 27 B27-6: rendered-text verification still flags genuinely absent claims',()=>{
 const answers=[
  {claimId:'P1-C1',text:'Custom guides expectation.',sourceIds:['S1']},
  {claimId:'P1-C2',text:'Fortune turns her wheel without pause.',sourceIds:['S1']}];
 assert.deepEqual(findTextAbsentShippedClaims(['P1-C1','P1-C2'],answers,
  'Custom guides expectation. [S1]'),['P1-C2']);
});

// ---------------------------------------------------------------------------
// Batch 28 (B28-1..B28-3)
// ---------------------------------------------------------------------------

test('batch 28 B28-1: a clause answered via one source is listed in the other source\'s rescue packet',async()=>{
 // The clause is answered overall — Hume's spans establish it —
 // but Kant's own clause decision is open (no spans). Under the
 // batch-27 recording (overall status replicated to every cited
 // source) the S2 pair's packet listed zero outstanding clauses, so
 // the veto population and the packet population could never agree.
 const clauseText='Custom leads the mind to infer one object from another';
 const claimText=clauseText+', and causality is a pure conception of the understanding.';
 const twoSourcePlan={version:'reader-evidence-v2',intent:'compare',
  sources:[{label:'David Hume',role:'primary',bookIds:['35']},
   {label:'Immanuel Kant',role:'primary',bookIds:['40']}],
  parts:[{id:'P1',question:'How do Hume and Kant each ground causal necessity?',
   sourceBookIds:['35','40'],searchQueries:['Hume Kant causality'],
   candidateSourceIds:['S1','S2'],
   requirements:[{id:'P1-R1',text:'Explain how custom grounds the inference to causal necessity.'}]}],
  queries:['Hume Kant causality']};
 const review={parts:[{partId:'P1',status:'partial',answerStatus:'partial',
   directAnswerClaimIds:['P1-C1'],retainedContextClaimIds:[],
   requirementCoverage:[{requirementId:'P1-R1',status:'partial',
    answerClaimIds:['P1-C1']}]}],
  claims:[{claimId:'P1-C1',status:'partial',
   sources:[{sourceId:'S1',status:'answered',spanIds:['S1-Q1'],
     attributionStatus:'not_applicable',attributedSpeaker:'',evidenceRole:'work-assertion'},
    {sourceId:'S2',status:'partial',spanIds:[],
     attributionStatus:'not_applicable',attributedSpeaker:'',evidenceRole:'work-assertion'}],
   clauses:[{text:clauseText,status:'answered',issueCode:'none',
    sources:[{sourceId:'S1',spanIds:['S1-Q1']},{sourceId:'S2',spanIds:[]}]}]}]};
 const ai=batch26RouterAI({
  draft:`PART P1\n${claimText} [S1, S2]`,
  review,
  rescue:payload=>{
   const item=payload.decisions[0];
   assert.equal(item.sourceId,'S2','only the open pair is rescue-asked');
   return {response:JSON.stringify({decisions:[{claimId:item.claimId,sourceId:item.sourceId,
    verdict:'supported',fragment:item.spans[0].text,
    elements:[{element:item.claimText,stated:true}],
    clauses:[{text:clauseText,stated:true,
     fragment:'Causality is one of the categories of relation'}]}]})};
  }});
 const result=await composeEvidenceAnswer('How do Hume and Kant each ground causal necessity?',
  [hume,kant],ai,[],{plan:twoSourcePlan,catalog,trace:true});
 const pair=result.trace.rescueReview.parts[0].requestedPairs
  .find(entry=>entry.sourceId==='S2');
 assert.equal(pair.outstandingClauseCount,1,
  'the per-source recording lists the clause for the pair it is open for');
 assert.deepEqual(pair.outstandingClauses,[clauseText]);
 assert.equal(result.trace.rescueReview.parts[0].flipped,1,
  'the clearing clause verdict lets the flip apply');
 const decision=result.trace.reviewContract.reviewDecisions
  .find(entry=>entry.claimId==='P1-C1'&&entry.sourceId==='S2');
 assert.equal(decision.accepted,true);
 assert.match(result.answer,/causality is a pure conception of the understanding/,
  'the flipped claim text ships');
 assert.equal(result.outcome,'verified-source-draft');
});

test('batch 28 B28-2: accepted requirement answers derive the direct-answer set the reviewer omitted',async()=>{
 // The batch-27 Orwell shape: every claim accepted, the requirement
 // answered by an accepted claim, but the reviewer's part verdict
 // says answerStatus 'unanswered' with an empty directAnswerClaimIds
 // — the omission that stranded 27 of 27 accepted claims.
 const ai=batch26RouterAI({
  draft:'PART P1\nCustom operates on the imagination and guides causal inference. [S1]',
  review:{parts:[{partId:'P1',status:'answered',answerStatus:'unanswered',
    directAnswerClaimIds:[],retainedContextClaimIds:[],
    requirementCoverage:[{requirementId:'P1-R1',status:'answered',
     answerClaimIds:['P1-C1']}]}],
   claims:[{claimId:'P1-C1',status:'answered',
    sources:[{sourceId:'S1',status:'answered',spanIds:['S1-Q1'],
     attributionStatus:'not_applicable',attributedSpeaker:'',
     evidenceRole:'work-assertion'}]}]},
  rescue:rescueNotSupported});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',
  [hume],ai,[],{plan:planWithRequirement,catalog,trace:true});
 const decision=result.trace.reviewContract.partDecisions.find(item=>item.partId==='P1');
 assert.equal(decision.directAnswerDerived,true,
  'the derivation is recorded on the part decision');
 assert.deepEqual(decision.directAnswerClaimIds,['P1-C1']);
 assert.equal(decision.directAnswerCovered,true);
 assert.equal(result.questionParts[0].answerStatus,'answered');
 assert.match(result.answer,/operates on the imagination/,
  'the accepted answer ships instead of stranding at assembly');
 assert.equal(result.outcome,'verified-source-draft');
});

test('batch 28 B28-2: reviewer nominations present leave the derivation and the verdict untouched',async()=>{
 // Same shape as the Orwell test, but the reviewer DID nominate the
 // direct-answer claim while still marking the part unanswered. The
 // derivation engages only on the empty case, and a reviewer
 // verdict is never overridden by it.
 const ai=batch26RouterAI({
  draft:'PART P1\nCustom operates on the imagination and guides causal inference. [S1]',
  review:{parts:[{partId:'P1',status:'answered',answerStatus:'unanswered',
    directAnswerClaimIds:['P1-C1'],retainedContextClaimIds:[],
    requirementCoverage:[{requirementId:'P1-R1',status:'answered',
     answerClaimIds:['P1-C1']}]}],
   claims:[{claimId:'P1-C1',status:'answered',
    sources:[{sourceId:'S1',status:'answered',spanIds:['S1-Q1'],
     attributionStatus:'not_applicable',attributedSpeaker:'',
     evidenceRole:'work-assertion'}]}]},
  rescue:rescueNotSupported});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',
  [hume],ai,[],{plan:planWithRequirement,catalog,trace:true});
 const decision=result.trace.reviewContract.partDecisions.find(item=>item.partId==='P1');
 assert.equal(decision.directAnswerDerived,undefined,
  'no derivation is recorded when the reviewer nominated claims');
 assert.equal(result.questionParts[0].answerStatus,'unanswered',
  'behavior is exactly the pre-batch-28 behavior for this shape');
 assert.doesNotMatch(result.answer,/operates on the imagination/);
});

test('batch 28 B28-2: one part\'s re-review deadline cannot abort a sibling part\'s repair',async()=>{
 const twoPartPlan={version:'reader-evidence-v2',intent:'compare',
  sources:[{label:'David Hume',role:'primary',bookIds:['35']},
   {label:'Immanuel Kant',role:'primary',bookIds:['40']}],
  parts:[
   {id:'P1',question:'How does Hume explain causal necessity?',sourceBookIds:['35'],
    searchQueries:['Hume necessity custom'],candidateSourceIds:['S1']},
   {id:'P2',question:'How does Kant explain causal necessity?',sourceBookIds:['40'],
    searchQueries:['Kant causality a priori'],candidateSourceIds:['S2']}],
  queries:['Hume custom','Kant a priori']};
 const repairedTexts={
  P1:'Hume explains necessity through custom and repeated conjunction, repaired. [S1]',
  P2:'Kant explains causality as an a priori category of the understanding, repaired. [S2]'};
 const ai={calls:[],async run(model,request){
  const messages=request.messages;
  ai.calls.push(messages);
  const system=messages[0].content;
  if(system.startsWith('Answer the reader'))
   return {response:'PART P1\nHume says necessity is a directly observed power. [S1]\n'+
    'PART P2\nKant says causality is directly observed in experience. [S2]'};
  if(system.startsWith('Judge only the listed claim')){
   const payload=JSON.parse(messages[1].content);
   return {response:JSON.stringify({decisions:(payload.decisions||[]).map(item=>({
    claimId:item.claimId,sourceId:item.sourceId,verdict:'not-supported',
    fragment:item.spans?.[0]?.text||'no support'}))})};
  }
  if(system.startsWith('Patch only the requested claims')){
   const payload=parsePayload(messages);
   return {response:JSON.stringify({parts:payload.parts.map(part=>({partId:part.partId,
    replacements:(part.repair?.replaceClaimIds||[])
     .map(claimId=>({claimId,text:repairedTexts[part.partId]})),additions:[]}))})};
  }
  if(system.startsWith('Review the complete answer')){
   const payload=parsePayload(messages);
   const part=payload.parts[0],claim=payload.claims[0];
   if(claim.text.includes('repaired')){
    if(part.partId==='P2'){
     const error=new Error('Inference deadline exceeded');
     error.code='inference-deadline-exceeded';error.stage='answer-re-review';
     throw error;
    }
    const spanId=claim.sourceEvidence
     .find(item=>item.sourceId===claim.sourceIds[0]).spanIds[0];
    return {response:JSON.stringify({parts:[{partId:part.partId,status:'answered',
      answerStatus:'answered',directAnswerClaimIds:[claim.claimId]}],
     claims:[{claimId:claim.claimId,status:'answered',
      sources:[{sourceId:claim.sourceIds[0],status:'answered',spanIds:[spanId],
       attributionStatus:'not_applicable',attributedSpeaker:'',
       subjectAttributionStatus:'supported',
       attributedSubject:part.partId==='P1'?'Hume':'Kant',
       evidenceRole:'work-assertion'}]}]})};
   }
   return {response:JSON.stringify({parts:[{partId:part.partId,status:'partial',
     answerStatus:'partial',repairable:true,directAnswerClaimIds:[claim.claimId]}],
    claims:[{claimId:claim.claimId,status:'partial',
     sources:[{sourceId:claim.sourceIds[0],status:'partial',spanIds:[]}]}]})};
  }
  throw new Error('unexpected stage: '+system.slice(0,60));
 }};
 const result=await composeEvidenceAnswer('How do Hume and Kant explain causal necessity?',
  [{...hume,candidatePartIds:['P1']},{...kant,candidatePartIds:['P2']}],ai,[],
  {plan:twoPartPlan,catalog,trace:true});
 assert.equal(result.trace.answerRepair.applied,true,
  'the surviving part\'s repair still applies');
 assert.deepEqual(result.trace.answerRepair.adoptedPartIds,['P1']);
 assert.deepEqual(result.trace.answerRepair.reReviewFailures,
  [{partId:'P2',reason:'inference-deadline-exceeded'}],
  'the failed part records its own re-review failure');
 assert.match(result.answer,/repeated conjunction, repaired/,
  'the adopted repair ships');
 assert.doesNotMatch(result.answer,/a priori category of the understanding, repaired/,
  'the timed-out part\'s repair does not ship');
});

test('batch 28 B28-3: a strict-minority drop names unvalidatedPartsDropped on the result, label unchanged',async()=>{
 // The batch-27 Plato shape: one part of three fails review twice
 // and is dropped as a strict minority; every shipped sentence was
 // reviewed. The outcome label stays 'unverified-source-draft' —
 // but the result now says WHY it was downgraded.
 const draft='PART P1\nHume explains causal expectation through custom rather than reasoning. [S1]\n'+
  'PART P2\nKant treats causality as a category of relation and a pure conception of the understanding. [S2]\n'+
  'PART P3\nHume ties causal expectation to custom, whereas Kant treats causality as an a priori category. [S1, S2]';
 const dispatchReviewer=(_model,{messages})=>{
  const payload=parsePayload(messages);
  if(payload.parts[0].partId==='P2'){
   const error=new Error('Review response was truncated');
   error.code='review-output-truncated';error.stage='review';
   throw error;
  }
  return review([['P1','answered'],['P2','answered'],['P3','answered']])(_model,{messages});
 };
 const ai=makeAI([answer(draft),dispatchReviewer,dispatchReviewer,dispatchReviewer,dispatchReviewer]);
 const result=await composeEvidenceAnswer('How do Hume and Kant differ over causal necessity?',
  [{...hume,candidatePartIds:['P1','P3']},{...kant,candidatePartIds:['P2','P3']}],ai,[],
  {plan:twoSidePlan,catalog,trace:true});
 assert.equal(result.outcome,'unverified-source-draft',
  'the outcome label string is unchanged');
 assert.deepEqual(result.trace.reviewCompletion.unvalidatedPartIds,['P2']);
 assert.ok(Array.isArray(result.downgradeReasons),
  'the result carries its downgrade reasons');
 assert.ok(result.downgradeReasons.includes('unvalidatedPartsDropped'),
  'the dropped part is named as the downgrade cause');
 assert.deepEqual(result.trace.final.downgradeReasons,result.downgradeReasons,
  'the trace carries the same record');
});

test('batch 28 B28-3: a case lost to a stage failure carries the failure code on the result',async()=>{
 // The repair is written, but its independent re-review dies on the
 // provider deadline and nothing else ships. Before batch 28 the
 // result carried no failureCode at all — the deadline existed only
 // inside the trace's answer-repair record.
 const deadlineError=Object.assign(new Error('Inference deadline exceeded'),
  {code:'inference-deadline-exceeded',stage:'answer-re-review'});
 const ai=makeAI([
  answer('PART P1\nHume says necessity is a directly observed power connecting causes to effects. [S1]'),
  (_model,{messages})=>{
   const payload=parsePayload(messages),claim=payload.claims[0];
   return {response:JSON.stringify({parts:[{partId:'P1',status:'partial',answerStatus:'partial',
    repairable:true,directAnswerClaimIds:[claim.claimId]}],claims:[{claimId:claim.claimId,status:'partial',
    sources:[{sourceId:'S1',status:'partial',spanIds:[]}]}]})};
  },
  rescueRejection(),
  (_model,{messages})=>{
   return {response:JSON.stringify({parts:[{partId:'P1',replacements:[{claimId:'P1-C1',text:
    'Hume says our idea of necessity arises from uniformity in nature, where similar objects are constantly conjoined, and custom leads the mind to infer one from the other. [S1]'}],additions:[]}]})};
  },
  deadlineError
 ],{decorateReview:false});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],
  {plan:onePartPlan,catalog,trace:true});
 assert.equal(result.outcome,'insufficient-evidence');
 assert.equal(result.trace.answerRepair.reason,'inference-deadline-exceeded');
 assert.equal(result.failureCode,'inference-deadline-exceeded',
  'the causing stage failure is surfaced on the result');
 assert.equal(result.failureStage,'answer-repair');
 assert.equal(result.downgradeReasons,undefined,
  'no downgrade flag fired, so no downgradeReasons field appears');
});


// ---------------------------------------------------------------------------
// Batch 29 (B29-1): clause identity is the returned TEXT; offsets are
// advisory. Unit coverage for the normalizer, then pilot coverage.
// ---------------------------------------------------------------------------
const b29ClauseMaps=new Map([['S1',new Map([['S1-Q1',{}]])]]);
const b29Claim='Hume links necessity to custom, treats constant conjunction as its basis, and holds that the mind is determined to infer one object from another.';
test('batch 29 B29-1 (i): correct clause text resolves despite deliberately wrong offsets',()=>{
 const result=normalizeClaimClauseDecisions([
  {text:'Hume links necessity to custom',start:400,end:460,status:'answered',
   issueCode:'none',sources:[{sourceId:'S1',status:'answered',spanIds:['S1-Q1']}]},
  {text:'treats constant conjunction as its basis',start:0,end:5,status:'answered',
   issueCode:'none',sources:[{sourceId:'S1',status:'answered',spanIds:['S1-Q1']}]}],
  b29Claim,new Set(['S1']),b29ClauseMaps);
 assert.equal(result.decisions.length,2);
 assert.equal(result.decisions[0].status,'answered');
 assert.equal(result.decisions[0].unresolved,undefined,
  'no verdict depends on the model counting UTF-16 offsets');
 assert.deepEqual([result.decisions[0].start,result.decisions[0].end],[0,30],
  'the range is derived from the located text, not the advisory offsets');
 assert.equal(result.decisions[1].status,'answered');
 assert.ok(!result.warnings.includes('clause-range-invalid'));
});
test('batch 29 B29-1 (ii): correct text with correct offsets behaves as before',()=>{
 const clauseText='treats constant conjunction as its basis';
 const start=b29Claim.indexOf(clauseText);
 const result=normalizeClaimClauseDecisions([
  {text:clauseText,start,end:start+clauseText.length,
   status:'answered',issueCode:'none',
   sources:[{sourceId:'S1',status:'answered',spanIds:['S1-Q1']}]}],
  b29Claim,new Set(['S1']),b29ClauseMaps);
 assert.equal(result.decisions[0].status,'answered');
 assert.deepEqual([result.decisions[0].start,result.decisions[0].end],
  [start,start+clauseText.length]);
});
test('batch 29 B29-1: repeated clause text resolves to the occurrence nearest the advisory offsets',()=>{
 const claim='He holds that custom produces necessity, and that custom produces necessity in every inference.';
 const first=claim.indexOf('custom produces necessity');
 const second=claim.indexOf('custom produces necessity',first+1);
 assert.ok(first>=0&&second>first,'the fixture clause text occurs twice');
 const result=normalizeClaimClauseDecisions([
  {text:'custom produces necessity',start:second,end:second+5,status:'answered',
   issueCode:'none',sources:[{sourceId:'S1',status:'answered',spanIds:['S1-Q1']}]}],
  claim,new Set(['S1']),b29ClauseMaps);
 assert.equal(result.decisions[0].status,'answered');
 assert.equal(result.decisions[0].start,second,
  'the advisory offsets pick the nearest occurrence (the absorbed #414 function)');
});
test('batch 29 B29-1 (iv): no clause text with invalid offsets keeps the textless behavior',()=>{
 const result=normalizeClaimClauseDecisions([
  {start:500,end:600,status:'answered',issueCode:'none',
   sources:[{sourceId:'S1',status:'answered',spanIds:['S1-Q1']}]}],
  b29Claim,new Set(['S1']),b29ClauseMaps);
 assert.equal(result.decisions.length,1);
 assert.equal(result.decisions[0].text,'');
 assert.equal(result.decisions[0].status,'partial');
 assert.equal(result.decisions[0].unresolved,true);
 assert.ok(result.warnings.includes('clause-range-invalid'));
});
test('batch 29 B29-1 (i) pilot: a duplicated clause text with bogus offsets still clears at rescue and ships',async()=>{
 const review={parts:[{partId:'P1',status:'partial',answerStatus:'partial',
   directAnswerClaimIds:['P1-C1'],retainedContextClaimIds:['P1-C2'],
   directAnswerRequirementIds:[],requirements:[]}],
  claims:[{claimId:'P1-C1',status:'partial',
   sources:[{sourceId:'S1',status:'partial',spanIds:['S1-Q1'],
    attributionStatus:'not_applicable',attributedSpeaker:'',
    subjectAttributionStatus:'supported',attributedSubject:'Hume',
    evidenceRole:'work-assertion',supportBoundary:'Supports the full sentence.'}],
   clauses:[{text:'custom produces necessity',start:3,end:11,status:'partial',
    issueCode:'compound',
    sources:[{sourceId:'S1',status:'partial',spanIds:['S1-Q1']}]}]}]};
 const ai=batch26RouterAI({
  draft:'PART P1\nHe holds that custom produces necessity, and that custom produces necessity in every inference from experience. [S1]\nCustom is the great guide of human life.',
  review,
  rescue:payload=>{
   const item=payload.decisions[0];
   return {response:JSON.stringify({decisions:[{claimId:item.claimId,sourceId:item.sourceId,
    verdict:'supported',fragment:item.spans[0].text,
    elements:[{element:item.claimText,stated:true}],
    clauses:[{text:'custom produces necessity',stated:true,
     fragment:'similar objects are constantly conjoined'}]}]})};
  }});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',
  [hume],ai,[],{plan:onePartPlan,catalog,trace:true});
 assert.equal(result.outcome,'verified-source-draft');
 assert.ok(result.answer.includes('custom produces necessity in every inference from experience. [S1]'),
  'the flipped claim ships: the clause was located by text, not stranded by offsets');
 const rescueClaim=result.trace.rescueReview.parts[0].claims[0];
 assert.equal(rescueClaim.flipOutcome,'accepted');
 assert.equal(rescueClaim.flipVeto,undefined);
});
test('batch 29 B29-1 (iii) pilot: an unlocatable clause text is recorded, packeted, and clearable',async()=>{
 const review={parts:[{partId:'P1',status:'partial',answerStatus:'partial',
   directAnswerClaimIds:['P1-C1'],retainedContextClaimIds:['P1-C2'],
   directAnswerRequirementIds:[],requirements:[]}],
  claims:[{claimId:'P1-C1',status:'partial',
   sources:[{sourceId:'S1',status:'partial',spanIds:['S1-Q1'],
    attributionStatus:'not_applicable',attributedSpeaker:'',
    subjectAttributionStatus:'supported',attributedSubject:'Hume',
    evidenceRole:'work-assertion',supportBoundary:'Supports the full sentence.'}],
   clauses:[
    {text:'Hume links necessity to custom',status:'answered',issueCode:'none',
     sources:[{sourceId:'S1',status:'answered',spanIds:['S1-Q1']}]},
    {text:'the will is determined by motives',status:'partial',issueCode:'scope',
     sources:[{sourceId:'S1',status:'partial',spanIds:['S1-Q1']}]},
    {text:'the mind is determined to infer one object from another',status:'answered',
     issueCode:'none',sources:[{sourceId:'S1',status:'answered',spanIds:['S1-Q1']}]}]}]};
 let rescuePayload;
 const ai=batch26RouterAI({
  draft:'PART P1\nHume links necessity to custom, treats constant conjunction as its basis, and holds that the mind is determined to infer one object from another. [S1]\nCustom is the great guide of human life.',
  review,
  rescue:payload=>{
   rescuePayload=payload;
   const item=payload.decisions[0];
   return {response:JSON.stringify({decisions:[{claimId:item.claimId,sourceId:item.sourceId,
    verdict:'supported',fragment:item.spans[0].text,
    elements:[{element:item.claimText,stated:true}],
    clauses:[{text:'the will is determined by motives',stated:true,
     fragment:'similar objects are constantly conjoined'}]}]})};
  }});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',
  [hume],ai,[],{plan:onePartPlan,catalog,trace:true});
 assert.deepEqual(rescuePayload.decisions[0].outstandingClauses,
  [{text:'the will is determined by motives'}],
  'the unlocatable clause is recorded with its text and listed in the packet');
 assert.equal(result.outcome,'verified-source-draft');
 assert.ok(result.answer.includes('treats constant conjunction as its basis'),
  'the clearing verdict accepts the flip and the claim text ships');
 const rescueClaim=result.trace.rescueReview.parts[0].claims[0];
 assert.equal(rescueClaim.flipOutcome,'accepted');
 assert.deepEqual(rescueClaim.clearedClauses,
  [{text:'the will is determined by motives',
   fragment:'similar objects are constantly conjoined'}]);
});

// ---------------------------------------------------------------------------
// Batch 29 (B29-2): clearance alignment — present-but-non-clearing clause
// entries invalidate the verdict (clause-not-cleared), never flip-then-veto.
// ---------------------------------------------------------------------------
test('batch 29 B29-2 (i): a stated:false clause entry is re-asked, then the clearing retry flips',async()=>{
 let rescueCalls=0;
 const ai=batch26RouterAI({
  draft:'PART P1\nHume links necessity to custom, treats constant conjunction as its basis, and holds that the mind is determined to infer one object from another. [S1]\nCustom is the great guide of human life.',
  review:clausePartialReview,
  rescue:payload=>{
   rescueCalls++;
   const item=payload.decisions[0];
   return {response:JSON.stringify({decisions:[{claimId:item.claimId,sourceId:item.sourceId,
    verdict:'supported',fragment:item.spans[0].text,
    elements:[{element:item.claimText,stated:true}],
    clauses:[{text:'treats constant conjunction as its basis',
     stated:rescueCalls>1,fragment:'similar objects are constantly conjoined'}]}]})};
  }});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',
  [hume],ai,[],{plan:onePartPlan,catalog,trace:true});
 const rescueEntry=result.trace.rescueReview.parts[0];
 assert.deepEqual(rescueEntry.attempts[0],
  {outcome:'invalid-response',reason:'clause-not-cleared',
   callLatencyMs:rescueEntry.attempts[0].callLatencyMs},
  'presence without clearance fails validation on the first attempt');
 assert.equal(rescueEntry.outcome,'completed-after-retry');
 assert.equal(rescueEntry.flipped,1);
 assert.equal(result.outcome,'verified-source-draft');
 assert.ok(result.answer.includes('treats constant conjunction as its basis'));
 const rescueClaim=rescueEntry.claims[0];
 assert.deepEqual(rescueClaim.clauseOutcomes,
  [{text:'treats constant conjunction as its basis',stated:true,
   fragmentInSpan:true,cleared:true}],
  'the trace records the per-clause outcome of the applying verdict');
 assert.equal(rescueClaim.flipOutcome,'accepted');
 assert.equal(rescueClaim.flipVeto,undefined);
});
test('batch 29 B29-2 (ii): still non-clearing after the retry records not-supported, never a veto',async()=>{
 const ai=batch26RouterAI({
  draft:'PART P1\nHume links necessity to custom, treats constant conjunction as its basis, and holds that the mind is determined to infer one object from another. [S1]\nCustom is the great guide of human life.',
  review:clausePartialReview,
  rescue:payload=>{
   const item=payload.decisions[0];
   return {response:JSON.stringify({decisions:[{claimId:item.claimId,sourceId:item.sourceId,
    verdict:'supported',fragment:item.spans[0].text,
    elements:[{element:item.claimText,stated:true}],
    clauses:[{text:'treats constant conjunction as its basis',stated:false,
     fragment:'similar objects are constantly conjoined'}]}]})};
  }});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',
  [hume],ai,[],{plan:onePartPlan,catalog,trace:true});
 const rescueEntry=result.trace.rescueReview.parts[0];
 assert.equal(rescueEntry.outcome,'completed-after-retry');
 assert.deepEqual(rescueEntry.attempts.map(attempt=>attempt.outcome),
  ['invalid-response','clause-not-cleared']);
 assert.equal(rescueEntry.flipped,0);
 const rescueClaim=rescueEntry.claims[0];
 assert.equal(rescueClaim.verdict,'not-supported');
 assert.equal(rescueClaim.clauseNotCleared,true);
 assert.equal(rescueClaim.reason,'clause-not-cleared');
 assert.equal(rescueClaim.flipOutcome,undefined,
  'the pair was never flipped, so no flip outcome exists');
 assert.ok(!JSON.stringify(result.trace.rescueReview).includes('flipVeto'),
  'no flip veto appears anywhere in the rescue trace');
 const decision=result.trace.reviewContract.reviewDecisions
  .find(entry=>entry.claimId==='P1-C1'&&entry.sourceId==='S1');
 assert.equal(decision.accepted,false,'the original decision stands');
 assert.ok(!result.answer.includes('treats constant conjunction as its basis'));
});
test('batch 29 B29-2 (iii): a fragment failure cannot discard an earlier pair’s clause-omission flag',async()=>{
 const twoSourcePlan={version:'reader-evidence-v2',intent:'compare',
  sources:[{label:'David Hume',role:'primary',bookIds:['35']},
   {label:'Immanuel Kant',role:'primary',bookIds:['40']}],
  parts:[{id:'P1',question:'How do Hume and Kant each ground causal necessity?',
   sourceBookIds:['35','40'],searchQueries:['Hume Kant causality'],
   candidateSourceIds:['S1','S2'],
   requirements:[{id:'P1-R1',text:'Explain how custom grounds the inference to causal necessity.'}]}],
  queries:['Hume Kant causality']};
 const review={parts:[{partId:'P1',status:'partial',answerStatus:'partial',
   directAnswerClaimIds:['P1-C1'],retainedContextClaimIds:[],
   requirementCoverage:[{requirementId:'P1-R1',status:'partial',
    answerClaimIds:['P1-C1']}]}],
  claims:[{claimId:'P1-C1',status:'partial',sources:[
   {sourceId:'S1',status:'partial',spanIds:['S1-Q1'],
    attributionStatus:'not_applicable',attributedSpeaker:'',
    subjectAttributionStatus:'supported',attributedSubject:'Hume',
    evidenceRole:'work-assertion',supportBoundary:'Supports part of the sentence.'},
   {sourceId:'S2',status:'partial',spanIds:['S2-Q1'],
    attributionStatus:'not_applicable',attributedSpeaker:'',
    subjectAttributionStatus:'supported',attributedSubject:'Hume',
    evidenceRole:'work-assertion',supportBoundary:'Supports part of the sentence.'}],
   clauses:[
    {text:'Hume links necessity to custom',status:'partial',issueCode:'compound',
     sources:[{sourceId:'S1',status:'partial',spanIds:['S1-Q1']},
      {sourceId:'S2',status:'partial',spanIds:['S2-Q1']}]},
    {text:'and regular conjunction',status:'partial',issueCode:'compound',
     sources:[{sourceId:'S1',status:'partial',spanIds:['S1-Q1']},
      {sourceId:'S2',status:'partial',spanIds:['S2-Q1']}]}]}]};
 let rescueCalls=0,retryPayload;
 const ai=batch26RouterAI({
  draft:'PART P1\nHume links necessity to custom and regular conjunction. [S1, S2]',
  review,
  rescue:payload=>{
   rescueCalls++;
   if(rescueCalls>1)retryPayload=payload;
   const bySource=new Map(payload.decisions.map(item=>[item.sourceId,item]));
   if(rescueCalls===1){
    // Pair A omits its clause entries entirely; pair B (later in the
    // response) fails on a fragment no span contains. Before B29-2,
    // the fragment failure returned early and discarded A's omission
    // record, so the retry never re-asked A.
    const a=bySource.get('S1'),b=bySource.get('S2');
    return {response:JSON.stringify({decisions:[
     {claimId:a.claimId,sourceId:'S1',verdict:'supported',
      fragment:a.spans[0].text,elements:[{element:a.claimText,stated:true}]},
     {claimId:b.claimId,sourceId:'S2',verdict:'supported',
      fragment:'a fragment that appears in no supplied span',
      elements:[{element:b.claimText,stated:true}],
      clauses:(b.outstandingClauses||[]).map(clause=>({text:clause.text,
       stated:true,fragment:b.spans[0].text}))}]})};
   }
   // The retry re-asks both pairs; A omits its clauses again, B clears.
   const a=bySource.get('S1'),b=bySource.get('S2');
   const retryDecisions=[];
   if(a)retryDecisions.push({claimId:a.claimId,sourceId:'S1',verdict:'supported',
    fragment:a.spans[0].text,elements:[{element:a.claimText,stated:true}]});
   if(b)retryDecisions.push({claimId:b.claimId,sourceId:'S2',verdict:'supported',
    fragment:b.spans[0].text,elements:[{element:b.claimText,stated:true}],
    clauses:(b.outstandingClauses||[]).map(clause=>({text:clause.text,
     stated:true,fragment:b.spans[0].text}))});
   return {response:JSON.stringify({decisions:retryDecisions})};
  }});
 const result=await composeEvidenceAnswer('How do Hume and Kant each ground causal necessity?',
  [hume,kant],ai,[],{plan:twoSourcePlan,catalog,trace:true});
 assert.ok(retryPayload,'the rescue was retried');
 assert.deepEqual(retryPayload.decisions.map(item=>item.sourceId).sort(),
  ['S1','S2'],'the omission-flagged pair survives into the retry scope');
 const rescueEntry=result.trace.rescueReview.parts[0];
 assert.deepEqual(rescueEntry.attempts.map(attempt=>attempt.outcome),
  ['invalid-response','clause-verdicts-missing']);
 const claimA=rescueEntry.claims.find(claim=>claim.sourceId==='S1');
 assert.equal(claimA.verdict,'not-supported');
 assert.equal(claimA.clauseVerdictsMissing,true,
  'A’s omission record survived the fragment failure and was recorded');
 const claimB=rescueEntry.claims.find(claim=>claim.sourceId==='S2');
 assert.equal(claimB.verdict,'supported');
});

// ---------------------------------------------------------------------------
// Batch 29 (B29-3): possessive trait attribution. The batch-27 B27-2
// pilot above (pronoun-actor span, round-table claim) covers design
// case (ii) unchanged. The unnamed-claim shape (batch-28 P1-C6) is a
// documented non-goal: no mechanism is added for it here.
// ---------------------------------------------------------------------------
const b29ConradPlan={...conradPlan,parts:[{...conradPlan.parts[0],
 question:'What does the narrator observe about Kurtz in Heart of Darkness?'}]};
test('batch 29 B29-3 (i): a possessive-only claim over a possessive-pronoun span demotes',async()=>{
 const c5='He observes the glamour that seems to envelop Kurtz\'s destitution and loneliness.';
 assert.deepEqual(claimPersonSubjects(c5),['Kurtz']);
 assert.deepEqual(claimPossessiveOnlySubjects(c5),['Kurtz'],
  'the claim links Kurtz only through the possessive attribution');
 assert.deepEqual(claimPersonSubjects('Hamlet\'s conscience weakens resolution and action.'),[],
  'narrowing: a claim-initial possessive subject stays with the lead patterns');
 const sourceText='The Russian travelled up the river in a dilapidated steamboat with patched sails. '+
  'His need was to exist, and to move onwards at the greatest possible risk, and with a maximum of privation. '+
  'If the absolutely pure, uncalculating spirit of adventure had ever ruled a human being, it ruled this be-patched youth.';
 const spans=buildReviewSpans('S1',sourceText);
 const possessiveSpan=spans.find(span=>span.text.includes('His need was to exist'));
 assert.ok(possessiveSpan,'the fixture span presents the bearer under a possessive pronoun only');
 const source={...conradSource,text:sourceText};
 const ai=batch26RouterAI({
  draft:'PART P1\n'+c5+' [S1]',
  review:conradReview([possessiveSpan.spanId]),
  rescue:rescueNotSupported});
 const result=await composeEvidenceAnswer(
  'What does the narrator observe about Kurtz in Heart of Darkness?',
  [source],ai,[],{plan:b29ConradPlan,
   catalog:{77:'Heart of Darkness — Joseph Conrad'},trace:true});
 const decision=result.trace.reviewContract.reviewDecisions
  .find(entry=>entry.claimId==='P1-C1'&&entry.sourceId==='S1');
 assert.equal(decision.accepted,false,
  'the batch-28 Conrad shape no longer ships on reviewer resolution alone');
 assert.equal(decision.validationReason,'subject-not-named-in-span');
 assert.doesNotMatch(result.answer,/envelop Kurtz/);
});
test('batch 29 B29-3 (iii): a possessive claim whose accepted span names the person ships',async()=>{
 const sourceText='Kurtz\'s destitution and loneliness were plain for every visitor to see at the station. '+
  'His need was to exist, and to move onwards at the greatest possible risk.';
 const spans=buildReviewSpans('S1',sourceText);
 const namingSpan=spans.find(span=>span.text.includes('Kurtz\'s destitution'));
 assert.ok(namingSpan);
 const source={...conradSource,text:sourceText};
 const ai=batch26RouterAI({
  draft:'PART P1\nThe narrative dwells on Kurtz\'s destitution and loneliness. [S1]',
  review:conradReview([namingSpan.spanId]),
  rescue:rescueNotSupported});
 const result=await composeEvidenceAnswer(
  'What does the narrator observe about Kurtz in Heart of Darkness?',
  [source],ai,[],{plan:b29ConradPlan,
   catalog:{77:'Heart of Darkness — Joseph Conrad'},trace:true});
 const decision=result.trace.reviewContract.reviewDecisions
  .find(entry=>entry.claimId==='P1-C1'&&entry.sourceId==='S1');
 assert.equal(decision.accepted,true,
  'a span naming the person corroborates the possessive attribution');
 assert.match(result.answer,/dwell(s)? on Kurtz's destitution/);
});
test('batch 29 B29-3 (iv): a second accepted span naming the person also ships',async()=>{
 const sourceText='His need was to exist, and to move onwards at the greatest possible risk, and with a maximum of privation. '+
  'Kurtz was expected back at the station before the rains came.';
 const spans=buildReviewSpans('S1',sourceText);
 const possessiveSpan=spans.find(span=>span.text.includes('His need was to exist'));
 const namingSpan=spans.find(span=>span.text.includes('Kurtz was expected'));
 assert.ok(possessiveSpan&&namingSpan);
 const source={...conradSource,text:sourceText};
 const ai=batch26RouterAI({
  draft:'PART P1\nThe narrative dwells on Kurtz\'s destitution and loneliness. [S1]',
  review:conradReview([possessiveSpan.spanId,namingSpan.spanId]),
  rescue:rescueNotSupported});
 const result=await composeEvidenceAnswer(
  'What does the narrator observe about Kurtz in Heart of Darkness?',
  [source],ai,[],{plan:b29ConradPlan,
   catalog:{77:'Heart of Darkness — Joseph Conrad'},trace:true});
 const decision=result.trace.reviewContract.reviewDecisions
  .find(entry=>entry.claimId==='P1-C1'&&entry.sourceId==='S1');
 assert.equal(decision.accepted,true,
  'any accepted span naming the person satisfies the gate');
 assert.match(result.answer,/dwell(s)? on Kurtz's destitution/);
});

// ---------------------------------------------------------------------------
// Batch 29 (B29-4): the stream-deadline retry suppression is observable.
// ---------------------------------------------------------------------------
test('batch 29 B29-4: a streaming compose deadline suppression is counted on the trace',async()=>{
 const timeout=Object.assign(new Error('Inference deadline exceeded'),{
  code:'inference-deadline-exceeded',stage:'compose'});
 let calls=0;
 const ai={run:async()=>{calls++;throw timeout;}};
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',
  [hume],ai,[],{plan:onePartPlan,catalog,trace:true,inferenceTransport:'streaming'});
 assert.equal(result.outcome,'generation-failed');
 assert.deepEqual(result.trace.streamDeadlineSuppressions,{compose:1,review:0},
  'the #406 suppression decided the skipped compose retry and is now recorded');
 assert.equal(result.trace.composeRetry,undefined,
  'the suppression itself is unchanged: no in-build compose retry ran');
 assert.equal(calls,2,'one compose call per whole-build attempt, no in-build retry');
});
