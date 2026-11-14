import test from 'node:test';
import assert from 'node:assert/strict';
import {composeEvidenceAnswer,linkEvidenceToParts,derivePartContract,COMPOSER_PROMPT,EXPANSION_PROMPT,REVIEW_PROMPT,parseReviewJson,parseAnswerRepairJson,normalizeAnswerMarkdown,sanitizeInternalAnswerIds,unwrapBoldWrappedParagraphs,findUntracedCitedClaims,stripUntracedCitedClaims,stripUntracedCitedClaimsToFixpoint,removeClaimsFromPart,hasAssemblyEndingViolation,speakerIsWorkAuthor,personNamesMatch,namedSpeakerAttribution,claimPersonSubjects,claimTextAppears,attachScaffoldingToPart,isListLeadInAnswer,introducesDuplicatedParagraph,composerPassageWindows,normalizeClaimClauseDecisions,claimPossessiveOnlySubjects} from './evidence-answer.mjs';
import {auditFinalAnswer,normalizePlan,sourceProvenance,removeUnsupportedQuoteMarks} from './reader-contract.mjs';
import {buildReviewSpans,rankReviewSpans,selectReviewPacketSpans,selectRequirementReviewSpans,isHeadingOnlySpan} from './review-spans.mjs';
import {splitCitedSentenceUnits,reconcileFinalPartCoverage,findTextAbsentShippedClaims,applyAssemblyAntecedentGuard,reconcileAssemblyLoss,classifySpanRegion,finalizeVetoCensus,subjectNamesEquivalent,BATCH35_FIRING_FIELDS} from './evidence-answer.mjs';
test('batch 34 (B34-5) retired B33-9 scaling: an oversized review packet gets the flat 60000 deadline',async()=>{
 // The packet below carries ~96,000 span characters (~16,000 packet
 // words): under B33-9's retired scaling its initial review call
 // recorded timeoutMs 75000. Batch 34 retired the scaling on the
 // measured batch-33 distribution (105 initial-review calls, p50
 // 27.8 s, no 60–90 s completion cluster; the 3 timeouts were stalls
 // whose identical work finished in ~half the time on retry), so the
 // flat pre-batch-33 deadline must hold at any packet size.
 const sentence=(i,j)=>`Hume passage ${i} section ${j} explains that necessity and causation arise from the uniformity observable in nature, where similar objects are constantly conjoined together and the mind is determined by custom to infer one from the other in every single observed instance of their regular conjunction across experience and habit.`;
 const sources=Array.from({length:40},(_,i)=>({id:'S'+(i+1),bookId:'35',
  title:catalog[35],page:100+i,url:`https://example.test/hume#page=${100+i}`,
  text:Array.from({length:12},(_,j)=>sentence(i+1,j+1)).join(' '),
  preview:'Hume on necessity and custom.'}));
 const plan={version:'reader-evidence-v2',intent:'explain',
  sources:[{label:'David Hume',role:'primary',bookIds:['35']}],
  parts:[{id:'P1',question:'How does Hume explain causal necessity?',sourceBookIds:['35'],
   searchQueries:['Hume necessity custom'],candidateSourceIds:sources.map(s=>s.id),
   requirements:[{id:'P1-R1',text:'Explain the role of custom in causal inference.'}]}],
  queries:['Hume necessity custom']};
 const draft='PART P1\n'+Array.from({length:8},(_,g)=>
  `Hume links necessity to custom and regular conjunction in group ${g+1}. `+
  sources.slice(g*5,g*5+5).map(s=>`[${s.id}]`).join(' ')).join(' ');
 const ai={calls:[],run:async(model,request)=>{
  ai.calls.push({model,request});
  const system=String(request?.messages?.[0]?.content||'');
  if(system.startsWith('Answer the reader'))return answer(draft);
  if(system.startsWith('Review the complete answer')){
   const payload=parsePayload(request.messages);
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
    answerStatus:'answered',
    directAnswerClaimIds:payload.claims.map(claim=>claim.claimId),
    retainedContextClaimIds:[],
    requirementCoverage:[{requirementId:'P1-R1',status:'answered',
     answerClaimIds:payload.claims.map(claim=>claim.claimId)}]}],
    claims:payload.claims.map(claim=>({claimId:claim.claimId,status:'answered',
     sources:claim.sourceIds.map(sourceId=>({sourceId,status:'answered',
      spanIds:[claim.sourceEvidence.find(item=>item.sourceId===sourceId).spanIds[0]],
      subjectAttributionStatus:'supported',attributedSubject:'Hume'}))}))})};
  }
  throw new Error('unexpected stage in B34-5 fixture: '+system.slice(0,40));
 }};
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',
  sources,ai,[],{plan,catalog,trace:true,transportDiagnostics:true});
 const reviewCalls=result.trace.inferenceCalls.filter(call=>call.stage==='review');
 assert.ok(reviewCalls.length>=1,'the pilot route made a review call');
 for(const call of reviewCalls)
  assert.equal(call.timeoutMs,60000,
   'review deadline is the flat 60000 even for a packet B33-9 would have scaled');
});

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
function makeAI(responses,{decorateReview=true,decorateSubject=true}={}){
 const calls=[];
 return {calls,run:async(model,request)=>{calls.push({model,request});const next=responses.shift();
   if(next instanceof Error)throw next;
   const result=typeof next==='function'?next(model,request):next;
   // Most fixtures predate the explicit answer/context decisions. Give legacy
   // fixtures realistic reviewer selections; focused contract tests opt out.
   const systemText=String(request?.messages?.[0]?.content||'');
   if((decorateReview||decorateSubject)&&systemText.includes('directAnswerClaimIds')&&
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
   claims:[{claimId:claim.claimId,status:'answered',spanIds:[selected.spanId]}]})};
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
    spanIds:[span.spanId,...reviewPayload.parts[0].evidence[0].spans.slice(1,2).map(item=>item.spanId)]}]}]})};
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
test('review truncation gets two compact retries in a single-part answer (Stage B.2), then suppresses when the only part remains unvalidated',async()=>{
 const truncated={choices:[{finish_reason:'length',message:{content:'{"parts":[{"partId":"P1"'}}],
   usage:{neurons:3,prompt_tokens:500,completion_tokens:1800}};
 const ai=makeAI([answer('PART P1\nHume links necessity to custom and regular conjunction. [S1]'),
  truncated,truncated,truncated]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true
 });
 assert.equal(ai.calls.length,4,'the truncated review is retried twice (B.2 single-part) and no further call is made');
 assert.deepEqual(result.trace.reviewRetry,{attempted:true,reason:'review-output-truncated',applied:false,
  parts:[{partId:'P1',reason:'review-output-truncated',applied:false,attempts:2,retryFailureCode:'review-output-truncated'}]});
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
test('review JSON salvage recovers exactly the complete claim prefix of a truncated payload (Stage B.4)',()=>{
 const payload=JSON.stringify({claims:[
  {claimId:'P1-C1',status:'answered',sources:[{sourceId:'S1',spanIds:['S1-Q1']}]},
  {claimId:'P1-C2',status:'partial',sources:[{sourceId:'S1',spanIds:[]}]},
  {claimId:'P1-C3',status:'answered',sources:[]}],
  parts:[{partId:'P1',status:'partial'}]});
 // A cut inside the third claim recovers the first two, whole.
 const cutInsideC3=payload.slice(0,payload.indexOf('P1-C3')+10);
 const salvaged=parseReviewJson({response:cutInsideC3});
 assert.deepEqual(salvaged.claims.map(claim=>claim.claimId),['P1-C1','P1-C2']);
 assert.equal(salvaged.parts,undefined,'the cut part entry is absent, not reconstructed');
 // A cut inside the parts entry still recovers every claim.
 const cutInsideParts=payload.slice(0,payload.indexOf('"partId":"P1"')+16);
 assert.equal(parseReviewJson({response:cutInsideParts}).claims.length,3);
 // A cut inside the first claim recovers nothing and fails as before.
 assert.throws(()=>parseReviewJson({response:payload.slice(0,40)}),
  error=>error.code==='model-output-invalid-format');
 // An untruncated payload parses untouched, with no recovery marker.
 const whole=parseReviewJson({response:payload});
 assert.equal(whole.claims.length,3);
 assert.equal(whole.parts.length,1);
});
test('a truncated review with a salvageable prefix is used, not retried: recovered claims ship and cut claims drop (Stage B.4)',async()=>{
 const reviewer=(_model,{messages})=>{
  const payload=parsePayload(messages);
  const decisions=payload.claims.map(claim=>({claimId:claim.claimId,status:'answered',
   sources:claim.sourceIds.map(sourceId=>({sourceId,status:'answered',
    subjectAttributionStatus:'supported',
    attributedSubject:claimPersonSubjects(claim.text)[0]||'',
    spanIds:[claim.sourceEvidence.find(item=>item.sourceId===sourceId).spanIds[0]]}))}));
  const full=JSON.stringify({claims:decisions,
   parts:[{partId:'P1',status:'answered',answerStatus:'answered',
    directAnswerClaimIds:decisions.map(decision=>decision.claimId),
    retainedContextClaimIds:[],requirementCoverage:[]}]});
  const cut=full.slice(0,full.indexOf(payload.claims[1].claimId)+14);
  return {choices:[{finish_reason:'length',message:{content:cut}}],
   usage:{neurons:3,prompt_tokens:500,completion_tokens:1800}};
 };
 const ai=makeAI([answer('PART P1\nHume links necessity to custom and regular conjunction. [S1]\n\nHume also treats custom as the guide of human life. [S1]'),
  reviewer]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true});
 assert.equal(ai.calls.length,2,'the salvaged review needs no retry call');
 assert.deepEqual(result.trace.reviewSalvage,
  [{partId:'P1',recoveredClaims:1,droppedClaimIds:['P1-C2']}]);
 assert.equal(result.trace.reviewCompletion,undefined,
  'a salvaged part is validated, so no completion disposition is recorded');
 assert.ok(result.answer.includes('Hume links necessity to custom'));
 assert.ok(!result.answer.includes('guide of human life'),
  'the claim the cut dropped does not ship');
 assert.equal(result.questionParts[0].status,'partial',
  'a salvaged part is partial: claims were lost to the cut');
 assert.notEqual(result.coverage,'full');
});
test('the Stage B.4 fallback drops dialogue-attribution and uncited claims, and suppression stands when nothing survives',async()=>{
 const dialogue={id:'S1',bookId:'35',title:'An Enquiry Concerning Human Understanding — David Hume',
  page:25,candidatePartIds:['P1'],
  text:'"I cannot accept this," said Hume, shaking his head at the argument. Custom governs our inferences from experience, and reason alone cannot produce the idea of necessary connection.',
  preview:'Custom governs our inferences from experience.'};
 const invalid={response:'{invalid-json'};
 const ai=makeAI([answer('PART P1\nHume said that custom governs our inferences from experience. [S1]'),
  invalid,invalid,invalid]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[dialogue],ai,[],{
  plan:onePartPlan,catalog,trace:true});
 assert.equal(result.outcome,'generation-failed',
  'a fallback part reduced to zero claims does not manufacture an answer');
 assert.deepEqual(result.trace.reviewCompletion,{totalParts:1,unvalidatedPartIds:['P1'],
  disposition:'suppressed-not-strict-minority'});
 assert.equal(result.trace.reviewFallback,undefined);
});
test('the Stage B.4 fallback records why each non-surviving claim dropped',async()=>{
 const invalid={response:'{invalid-json'};
 const ai=makeAI([answer('PART P1\nNecessity and causation arise from the uniformity observable in nature, where similar objects are constantly conjoined, and the mind is determined by custom to infer one from the other. [S1]\nBackground framing helps the reader here.'),
  invalid,invalid,invalid]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true});
 assert.deepEqual(result.trace.reviewCompletion,{totalParts:1,unvalidatedPartIds:['P1'],
  disposition:'fallback-unreviewed'});
 assert.deepEqual(result.trace.reviewFallback,
  [{partId:'P1',keptClaimIds:['P1-C1'],
    dropped:[{claimId:'P1-C2',reason:'uncited-claim'}]}]);
 assert.ok(result.answer.includes('Necessity and causation arise from the uniformity'));
 assert.ok(!result.answer.includes('Background framing'),
  'an uncited claim never ships from a fallback part');
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
 assert.deepEqual(result.trace.reviewScaffolding.repairRound,{attempted:false,resolved:0},
  'redesign Stage A: no scaffolding repair round runs');
 assert.equal(ai.calls.length,4,'one compose and one review call per part (redesign Stage A: no scaffolding decision round)');
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
  // Batch 8 (B8-1) shape, redesign Stage A form: the synthesis opens
  // the part uncited, so it is a retained frame claim; the reviewer's
  // own retention decision (retainedContextClaimIds above) keeps it as
  // genuine context and it ships exactly as before — no scaffolding
  // repair round runs.
  ],{decorateReview:false});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true});
 assert.equal(result.questionParts[0].status,'partial','library support remains visibly partial');
 assert.equal(result.questionParts[0].answerStatus,'answered','the reviewer assessed completeness separately');
 assert.equal(result.coverage,'partial');
 assert.equal(result.answerCompleteness,'full');
 assert.match(result.answer,/Causal necessity can be understood as an expectation/);
 assert.match(result.answer,/Hume locates that expectation.*\[S1\]/);
 assert.deepEqual(result.trace.reviewScaffolding.repairRound,{attempted:false,resolved:0},
  'redesign Stage A: no scaffolding repair round runs; the reviewer retention decision alone keeps the frame claim');
 assert.equal(ai.calls.length,2,'composition and the single review; the retained frame claim needs no further call');
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









test('answer repair quote recovery leaves unrelated malformed JSON fail-closed',()=>{
 assert.throws(()=>parseAnswerRepairJson({response:'{"parts":[{"partId":"P1",}],}'}),
  /valid JSON/);
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
 assert.doesNotMatch(REVIEW_PROMPT,/also return clauses/);
 assert.match(REVIEW_PROMPT,/When the payload carries reviewClaimIds, return claim entries only for those claim IDs/);
 assert.match(REVIEW_PROMPT,/Uncited general-context claims are assessed at the part level and do not need citations/);
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
 assert.match(REVIEW_PROMPT,/do not treat it as a direct answer unless the reader asked/);
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
 assert.equal(ai.calls.length,4,'broad unsupported synthesis remains partial on the reviewer verdict alone (redesign Stage A: no rescue call follows a zero-accept part)');
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
 assert.equal(omitted.ai.calls.length,2,'a missing evidence packet fails closed in the single audit and triggers no further call (redesign Stage A)');
});

test('review deadline failure in a single-part answer gets two in-place retries (Stage B.2) and stays fail-closed after all attempts',async()=>{
 // Stage B.2 supersedes the one-retry contract for single-part
 // answers: with no sibling part to degrade to, the review gets
 // a second retry before the answer is lost. Latency tranche:
 // the retries are chunked review rounds in split-retry form (a
 // one-claim part cannot split, so each round is one call), and
 // multi-part parts get the timeout-split inside their first
 // review instead of an extra round.
 const timeout=()=>Object.assign(new Error('Inference deadline exceeded'),{
  stage:'review',code:'inference-deadline-exceeded',startedAt:Date.now()-45000
 });
 const ai=makeAI([answer('PART P1\nHume links causal expectation to custom and regular conjunction. [S1]'),timeout(),timeout(),timeout()]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true
 });
 assert.equal(ai.calls.length,4,'composition runs once; the review call is retried twice');
 assert.deepEqual(result.trace.reviewRetry,{attempted:true,
  reason:'inference-deadline-exceeded',applied:false,
  parts:[{partId:'P1',reason:'inference-deadline-exceeded',applied:false,
   mode:'split-retry',outcome:'failed-again',attempts:2,retryFailureCode:'inference-deadline-exceeded'}]});
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
 assert.equal(ai.calls.length,2,'a reviewer source-attribution conflict removes the claim in the single audit and triggers no further call (redesign Stage A)');
 assert.equal(result.coverage,'none','the misattributed claim cannot survive review');
 assert.ok(result.trace.reviewContract.supportIssues.some(issue=>
  issue.sourceId==='S1'&&issue.reason==='source-attribution-conflict'));
 assert.equal(result.trace.reviewContract.reviewDecisions[0].attributedSpeaker,'Y. Chambers');
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
 // Stage B.4: the review contract still fails closed (below), but the
 // answer no longer suppresses with it — the two position claims pass
 // the deterministic fallback filter and ship labeled, while the
 // synthesis part's inference claim fails span coverage and drops.
 assert.equal(result.outcome,'unverified-source-draft');
 assert.equal(result.coverage,'partial');
 assert.equal(result.reviewStatus,'review-contract-incomplete');
 assert.deepEqual(result.trace.reviewContract.issues,['missing-claim-decision']);
 assert.ok(result.trace.reviewContract.supportIssues.some(issue=>
  issue.partId==='P1'&&issue.claimId==='P1-C1'&&issue.reason==='missing-claim-decision'));
 assert.ok(result.trace.reviewContract.supportIssues.some(issue=>
  issue.partId==='P2'&&issue.claimId==='P2-C1'&&issue.reason==='missing-claim-decision'));
 assert.deepEqual(result.trace.reviewCompletion,{totalParts:3,
  unvalidatedPartIds:['P1','P2','P3'],disposition:'fallback-unreviewed'});
 assert.deepEqual(result.trace.reviewFallback.map(record=>
  [record.partId,record.keptClaimIds]),[['P1',['P1-C1']],['P2',['P2-C1']],['P3',[]]]);
 assert.deepEqual(result.trace.reviewFallback[2].dropped,
  [{claimId:'P3-C1',reason:'span-coverage'}]);
 assert.deepEqual(result.evidenceMap.map(item=>item.partId),['P1','P2']);
 assert.ok(result.trace.final.disclosureLabels.some(label=>
  label.partId==='P1'&&label.kind==='unreviewed-fallback'));
 assert.ok(result.trace.final.disclosureLabels.some(label=>
  label.partId==='P2'&&label.kind==='unreviewed-fallback'));
 assert.ok(!result.answer.includes('one cautious inference'),
  'the unreviewed inference claim does not ship');
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

test('a collective byline source stays a lead and never hard-scopes a part (B.3)',()=>{
 const catalog={};
 for(let i=1;i<=30;i++)catalog[String(100+i)]='Anthology Volume '+i+' — Various authors';
 catalog['163']='Leviathan — Thomas Hobbes';
 const question='What do various authors argue about wealth and luxury?';
 const plan=normalizePlan({intent:'explain',sources:[
  {label:'Various authors',role:'primary',bookIds:Object.keys(catalog).filter(id=>id!=='163')}],
  parts:['What do various authors argue about wealth and luxury?'],
  queries:['wealth luxury trade']},question,catalog);
 assert.deepEqual(plan.collectiveSources,[{label:'Various authors',bookCount:30}]);
 assert.equal(plan.parts[0].sourceBookIds,null,
  'a part matched only by a collective source must stay unscoped');
 const mixed=normalizePlan({intent:'explain',sources:[
  {label:'Various authors',role:'primary',bookIds:Object.keys(catalog).filter(id=>id!=='163')},
  {label:'Thomas Hobbes',role:'primary',bookIds:['163']}],
  parts:['What does Thomas Hobbes argue about power?'],queries:['Hobbes power']},
  'What do various authors and Thomas Hobbes argue about wealth and power?',catalog);
 assert.deepEqual(mixed.parts[0].sourceBookIds,['163'],
  'a genuine author source keeps its scope alongside a collective lead');
 const platoCatalog={};
 for(let i=1;i<=22;i++)platoCatalog[String(200+i)]='Dialogue '+i+' — Plato';
 const plato=normalizePlan({intent:'explain',sources:[
  {label:'Plato',role:'primary',bookIds:Object.keys(platoCatalog)}],
  parts:['What does Plato argue about justice?'],queries:['Plato justice']},
  'What does Plato argue about justice?',platoCatalog);
 assert.equal(plato.collectiveSources,undefined);
 assert.equal(plato.parts[0].sourceBookIds.length,22,
  'the widest genuine author byline in the catalog still scopes');
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
 // Stage B (B5): the rejection record carries the rejected sentence
 // text and the specific failing element (the unknown ID itself).
 assert.deepEqual(result.trace.rejected,[{partId:'P1',reason:'unknown-source-id',
  text:'Fortune changes because nothing born remains constant. [S12]',
  failingElement:{unknownIds:['S12']},sentenceIndex:1}]);
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
 assert.deepEqual(invalid.trace.rejected,[{partId:'P1',reason:'unknown-source-id',
  text:'Hume links causal necessity to repeated conjunction [S99].',
  failingElement:{unknownIds:['S99']}}]);
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
 assert.deepEqual(result.trace.rejected,[{partId:'P1',reason:'source-not-linked-to-question-part',
  text:'The "general prejudice against Mr. Darcy" is so strong that attempting to view him in an "amiable light" is a difficult task [S3].',
  failingElement:{unlinkedIds:['S3']},sentenceIndex:1}],
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
 assert.deepEqual(result.trace.rejected,[{partId:'P1',reason:'unknown-source-id',
  text:'W.E.B. Du Bois defines double consciousness as viewing oneself through other people’s eyes. [S99]',
  failingElement:{unknownIds:['S99']},sentenceIndex:1}]);
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
 assert.equal(ai.calls.length,2,'an unclear claim decision remains fail-closed on the reviewer verdict alone (redesign Stage A: no rescue call follows)');
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
 assert.equal(ai.calls.length,2,'invented span IDs are rejected by the single audit and trigger no further call (redesign Stage A: no rescue or repair follows)');
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
 let reviewPayload,reviewSystem='';const reviewPayloads=[];
 const reviewFn=(_model,{messages})=>{
  reviewSystem=messages[0].content;
  reviewPayload=parsePayload(messages);
  reviewPayloads.push(reviewPayload);
  const spanId=reviewPayload.parts[0].evidence[0].spans[0].spanId;
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
   directAnswerClaimIds:['P1-C1']}],claims:reviewPayload.claims.map(claim=>({
    claimId:claim.claimId,status:'answered',sources:[{sourceId:'S1',status:'answered',
     spanIds:[spanId]}]}))})};
 };
 const ai=makeAI([answer(answerText),reviewFn,reviewFn]);
 await composeEvidenceAnswer('What guides human life?', [source],ai,[],{
  plan:onePartPlan,catalog,trace:true
 });
 assert.equal(reviewPayload.claims.length,9);
 assert.ok(reviewPayload.claims.every(claim=>claim.sourceEvidence[0].spanIds.length===1));
 assert.ok(reviewPayload.parts[0].evidence[0].spans.length>1,
  'the reviewer still receives the full bounded set of exact source spans');
 assert.match(reviewSystem,/One source cannot supply another source’s missing support/);
 assert.deepEqual(reviewPayloads.map(payload=>payload.reviewClaimIds.length),[5,4],
  'the 9-claim review is chunked at five claims per scoped call');
 assert.equal(ai.calls.length,3,'adaptive review packing adds no model call beyond the two chunks');
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
  malformed,malformed,malformed]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],
  {plan:onePartPlan,catalog,trace:true});
 assert.equal(result.outcome,'generation-failed');
 assert.equal(result.coverage,'none');
 assert.equal(result.reviewStatus,'review-format-failed');
 assert.equal(result.answer,'I could not complete a reliable answer this time. Please try again.');
 assert.deepEqual(result.trace.reviewContract.issues,['model-output-invalid-format']);
 assert.deepEqual(result.trace.reviewRetry,{attempted:true,reason:'model-output-invalid-format',applied:false,
  parts:[{partId:'P1',reason:'model-output-invalid-format',applied:false,attempts:2,retryFailureCode:'model-output-invalid-format'}]});
 assert.equal(ai.calls.length,4,'a malformed review gets two compact retries (B.2 single-part) and no further call');
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
  typo,typo,typo]);
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
  parts:[{partId:'P1',reason:'model-output-invalid-format',applied:false,attempts:2,retryFailureCode:'model-output-invalid-format'}]});
 assert.equal(ai.calls.length,4);
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

test('a review that fails every attempt ships the mechanically covered claim under the Stage B.4 fallback (B.2: three attempts for a single part)',async()=>{
 const matching='A just decision applies a rule impartially, while a merciful response tempers the consequence with compassion.';
 const unrelated='Harvest festivals in the valley traditionally begin after the first frost and continue for nine days of feasting.';
 const source={id:'S1',bookId:'72',title:'Justice and Mercy',page:1,
  text:matching+' '+unrelated,preview:matching};
 const plan={...onePartPlan,sources:[{label:'Justice and Mercy',role:'primary',bookIds:['72']}],
  parts:[{...onePartPlan.parts[0],question:'How can justice and mercy come into conflict?',
   sourceBookIds:['72'],candidateSourceIds:['S1']}]};
 const invalid={response:'{invalid-json'};
 const ai=makeAI([answer('PART P1\nJustice applies a rule impartially, while mercy tempers consequences with compassion. [S1]'),
  invalid,invalid,invalid]);
 const result=await composeEvidenceAnswer('How can justice and mercy come into conflict?',[source],ai,[],
  {plan,catalog:{...catalog,72:'Justice and Mercy'},trace:true});
 assert.equal(ai.calls.length,4);
 assert.deepEqual(result.trace.reviewRetry,{attempted:true,reason:'model-output-invalid-format',applied:false,
  parts:[{partId:'P1',reason:'model-output-invalid-format',applied:false,attempts:2,retryFailureCode:'model-output-invalid-format'}]});
 assert.equal(result.reviewStatus,'review-format-failed');
 // Stage B.4: suppression is no longer the outcome when the composed
 // claim passes every deterministic check — it ships under the
 // fallback, labeled as unreviewed, at partial coverage.
 assert.equal(result.outcome,'unverified-source-draft');
 assert.equal(result.coverage,'partial');
 assert.equal(result.questionParts[0].status,'partial',
  'the sole unvalidated part ships under the fallback');
 assert.deepEqual(result.trace.reviewCompletion,{totalParts:1,unvalidatedPartIds:['P1'],
  disposition:'fallback-unreviewed'});
 assert.deepEqual(result.trace.reviewFallback,
  [{partId:'P1',keptClaimIds:['P1-C1'],dropped:[]}]);
 assert.equal(result.evidenceMap.length,1);
 assert.ok(result.answer.includes('This part is presented without a completed source review'),
  'the fallback label is in the shipped answer text');
 assert.ok(result.trace.final.disclosureLabels.some(label=>
  label.partId==='P1'&&label.kind==='unreviewed-fallback'));
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
 // Batch 33 (B33-2/B33-3): this fixture pinned the strict-minority
 // cliff through batch 32 — one failing part of two suppressed the
 // whole answer even with the survivor audit passing (the phase-3
 // Gatsby SP1 shape). The salvage now requires exactly a surviving
 // part and a passing survivor re-audit; the dropped part is traced
 // and disclosed to the reader by the B33-3 absent-part label.
 const draft='PART P1\nHume explains causal expectation through custom rather than reasoning. [S1]\n'+
  'PART P2\nKant treats causality as an a priori category of relation. [S2]';
 const plan={...twoSidePlan,intent:'explain',parts:twoSidePlan.parts.slice(0,2)};
 const reviewBoth=review([['P1','answered'],['P2','answered']]);
 const ai=makeAI([answer(draft),reviewBoth,reviewBoth]);
 const result=await composeEvidenceAnswer(plan.resolvedQuestion,[hume,kant],ai,[],{
  plan,catalog,trace:true,postReviewAuditPartId:'P1'});
 assert.equal(result.outcome,'unverified-source-draft',
  'the clean survivor of a 1-of-2 partition ships, capped below verified');
 assert.match(result.answer,/Kant treats causality as an a priori category/);
 assert.match(result.answer,/This part of the question could not be answered from the library: How does Hume explain causal necessity\?/,
  'the dropped part is disclosed in the answer text (B33-3)');
 assert.deepEqual(result.trace.final.auditSalvage.droppedPartIds,['P1']);
 assert.deepEqual(result.trace.final.auditPartition.failingPartIds,['P1']);
 assert.deepEqual(result.trace.final.auditPartition.survivingPartIds,['P2']);
 assert.equal(result.trace.final.auditPartition.disposition,'salvaged');
 assert.deepEqual(result.trace.final.absentPartLabelsInAnswer,['P1']);
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









test('source-required containment ships uncited parts labeled beside cited siblings; only a zero-cited answer suppresses (batch 22 shape, Stage B B0 rule)',async()=>{
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
 // Stage B (B0): containment disposes per part. The batch-22 rule
 // dropped the peripheral part and suppressed the whole answer at
 // an uncited majority; validation showed that rule destroying
 // good answers (phase-2 Hobbes, phase-3 solitude), so an uncited
 // source-required part now keeps its reviewed answers and ships
 // labeled whenever any sibling part is cited — and even an
 // uncited MAJORITY ships on one cited part. Suppression remains
 // only at zero cited parts (the third fixture).
 const peripheral=await runFixture(['P2']);
 assert.equal(peripheral.outcome,'verified-source-draft');
 assert.deepEqual(peripheral.trace.sourceRequiredContainment.droppedPartIds,[]);
 assert.equal(peripheral.trace.sourceRequiredContainment.disposition,
  'answer-level-shipped-with-uncited-parts');
 assert.deepEqual(peripheral.trace.sourceRequiredContainment.citedPartIds,['P1','P3']);
 assert.equal(peripheral.trace.sourceRequiredContainment.uncitedFraction,1/3);
 assert.deepEqual(peripheral.trace.sourceRequiredContainment.partDispositions
  .find(entry=>entry.partId==='P2'),
  {partId:'P2',sourceRequired:true,cited:false,disposition:'shipped-labeled'});
 assert.notEqual(peripheral.questionParts.find(part=>part.partId==='P2').answerStatus,'unanswered',
  'the uncited part is disposed of on its own — it ships, labeled');
 assert.match(peripheral.missing,/How does Kant explain causal necessity/);
 assert.match(peripheral.answer,/Hume connects necessity to custom/);
 assert.match(peripheral.answer,/whereas Kant treats causality/);
 assert.match(peripheral.answer,/Kant presents causal order through the structure of human understanding/,
  'the uncited part keeps its reviewed answers under the label');
 assert.match(peripheral.answer,
  /Retrieved passages could not be verified as supporting this part of the question/);
 const majority=await runFixture(['P1','P2']);
 assert.equal(majority.outcome,'verified-source-draft');
 assert.equal(majority.trace.sourceRequiredContainment.disposition,
  'answer-level-shipped-with-uncited-parts');
 assert.deepEqual(majority.trace.sourceRequiredContainment.uncitedPartIds,['P1','P2']);
 assert.equal(majority.trace.sourceRequiredContainment.uncitedFraction,2/3);
 assert.match(majority.answer,/whereas Kant treats causality/,
  'one cited part carries the answer; the uncited majority ships labeled, not suppressed');
 const zeroCited=await runFixture(['P1','P2','P3']);
 assert.equal(zeroCited.outcome,'generation-failed');
 assert.equal(zeroCited.trace.sourceRequiredContainment.disposition,'suppressed-no-cited-parts');
 assert.deepEqual(zeroCited.trace.sourceRequiredContainment.citedPartIds,[]);
 assert.equal(zeroCited.failureCode,'source-required-no-cited-parts');
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
 assert.equal(ai.calls.length,3,'one composition, first review, and one split-retry round');
 assert.deepEqual(result.trace.reviewRetry,{attempted:true,
  reason:'inference-deadline-exceeded',applied:true,
  parts:[{partId:'P1',reason:'inference-deadline-exceeded',applied:true,
   mode:'split-retry',outcome:'recovered'}]});
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
   sources:[{sourceId:'S1',status:'partial',spanIds:[]}]}]})};
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
 // Latency tranche: a 25-claim part is audited by five chunk calls
 // of five claims each; every chunk carries the full part payload,
 // so the per-record budget formula still applies to the whole
 // record set at once on every call.
 const reviewHandler=review([['P1','answered']]);
 const ai=makeAI([answer('PART P1\n'+sentences.join(' ')),reviewHandler,reviewHandler,
  reviewHandler,reviewHandler,reviewHandler]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true});
 assert.equal(ai.calls.length,6,'compose plus the five chunk calls of the many-claim review');
 const reviewCalls=ai.calls.filter(call=>call.request.messages[0].content.startsWith('Review the complete answer'));
 assert.equal(reviewCalls.length,5,'the many-claim review runs as five chunk calls');
 assert.deepEqual(reviewCalls.map(call=>call.request.max_completion_tokens).sort((a,b)=>b-a),
  [6700,6700,6700,6700,6700],'the budget is 1,200 plus 220 tokens per review record (25 claims) on every chunk');
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
    attributedSubject:'Hume'}]}]})+'\n```'};
 }};
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[source],ai,[],{
  plan:{...onePartPlan,sources:[{label:'Hume commentary',role:'commentary',bookIds:['35']}]},catalog,trace:true});
 // Stage B (B2): this fixture's page IS an editor's introduction
 // (its provenance assertions below say so), and the claim rests
 // entirely on it while presenting the content as Hume's own
 // position. Apparatus spans never count as substantive support,
 // so the part is uncited for containment; with no other part the
 // answer suppresses. The provenance behavior this test exists
 // for is unchanged and still asserted below.
 assert.equal(result.coverage,'none');
 assert.deepEqual(result.trace.sourceRequiredContainment.apparatusExcludedSourceIds,['S1']);
 assert.equal(result.trace.sourceRequiredContainment.disposition,'suppressed-no-cited-parts');
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
 assert.equal(result.trace.assemblyAudit,undefined,
  'redesign Stage A: the assembly audit no longer runs or records');
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






test('legitimate lists, bold lead-ins, and mid-part colons stay seam-free (B6-5)',async()=>{
 const ai=makeAI([answer('PART P1\n**Field summary:** Ines Vidal describes learning that a horizon recedes exactly as fast as a walker advances toward it. [S1]\n'+
   'The lessons are plain:\n- Cross slowly\n- Watch the horizon\n'+
   'Vidal crossed the salt flats in her nineteenth year, carrying her father’s survey chain and a tin of well water.'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('What does Vidal describe learning from crossing the salt flats?',
  [vidalSalt],ai,[],{plan:vidalPlan,catalog:batch4Catalog,trace:true});
 assert.equal(ai.calls.length,2,'no audit repair runs for a seam-free answer');
 assert.equal(result.trace.assemblyAudit,undefined,
  'redesign Stage A: the assembly audit no longer runs or records; the seam-free text ships as composed');
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
  [{partId:'P1',claimId:'P1-C3',
   claimText:'The crossing suggests that empires decline as luxury corrupts citizens.',
   matchedRejectedClaimId:'P1-C2',containment:0.857}],
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
  [{partId:'P1',claimId:'P1-C3',
   claimText:'The crossing suggests that empires decline as luxury corrupts citizens.',
   matchedRejectedClaimId:'P1-C2',containment:0.857}],
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
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('What do Vidal and Feld each describe about finding direction?',
  [vidalSalt,feldGeese],ai,[],{plan:twoBookPlan,catalog:batch4Catalog,trace:true});
 assert.deepEqual(result.trace.reviewScaffolding.repairRound,{attempted:false,resolved:0},
  'redesign Stage A: no scaffolding repair round runs; the thesis is retained on the reviewer verdict');
 assert.equal(ai.calls.length,2,'compose and the single review (redesign Stage A: no scaffolding decision round)');
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

test('a timed-out part in a two-part answer degrades instead of suppressing the tie (Stage B.1, supersedes Batch 21)',async()=>{
 // Batch 21's rule suppressed the whole answer when one of two
 // parts' reviews failed at the call level. Stage B.1 reverses it
 // for call-level failures (this fixture's shape, and the Stage B
 // validation's suffering/wealth/Kierkegaard losses): no review
 // exists for the failed part at all, so the part is unverified in
 // exactly B0's sense — it ships nothing and is disclosed, while
 // the validated part ships. Suppression still stands when no part
 // validated, and for partially fulfilled contracts (B8-5).
 const draft='PART P1\nHume explains causal expectation through custom. [S1]\n'+
  'PART P2\nKant says “a priori” knowledge guarantees both certainty and moral liberty. [S2]';
 const timeout=Object.assign(new Error('Review response was truncated'),{
  code:'review-output-truncated',stage:'review'});
 const dispatcher=(_model,{messages})=>parsePayload(messages).parts[0].partId==='P2'?
  (()=>{throw timeout;})():review([['P1','answered']])(_model,{messages});
 const ai=makeAI([answer(draft),dispatcher,dispatcher,dispatcher]);
 const result=await composeEvidenceAnswer('How do Hume and Kant explain causality?',
  [hume,kant],ai,[],{plan:{...twoSidePlan,intent:'explain',parts:twoSidePlan.parts.slice(0,2)},
   catalog,trace:true});
 const second=result.questionParts.find(part=>part.partId==='P2');
 assert.equal(result.outcome,'verified-source-draft',
  'the build ships on the reviewed part');
 assert.match(result.answer,/Hume explains causal expectation through custom/,
  'the reviewed part\u2019s cited text ships');
 assert.doesNotMatch(result.answer,/Kant says/,
  'no claims ship from the unreviewed part');
 assert.equal(second.answerStatus,'unanswered');
 assert.deepEqual(result.trace.reviewContractDegradedParts,['P2']);
 assert.deepEqual(result.trace.reviewCompletion,
  {totalParts:2,unvalidatedPartIds:['P2'],disposition:'degraded-parts',
   degradedPartCauses:{P2:'review-output-truncated'}});
 assert.match(result.missing,/Kant/,
  'the degraded part is named in the missing segments');
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


test('batch 24 review-stage failure after the in-build review retry does not whole-build retry',async()=>{
 const requestFailed=()=>new Error('Review request failed');
 const ai=makeAI([answer('PART P1\nHume links necessity to custom and regular conjunction. [S1]'),
  requestFailed(),requestFailed(),requestFailed(),
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
 assert.equal(ai.calls.length,4,'compose, the failed review, and its two compact retries (B.2 single-part) — no second build');
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



const subjectMismatchReview={parts:[{partId:'P1',status:'partial',answerStatus:'partial',
  directAnswerClaimIds:['P1-C1'],retainedContextClaimIds:['P1-C2'],
  directAnswerRequirementIds:[],requirements:[]}],
 claims:[{claimId:'P1-C1',status:'answered',
  sources:[{sourceId:'S1',status:'answered',spanIds:['S1-Q1'],
   attributionStatus:'not_applicable',attributedSpeaker:'',
   subjectAttributionStatus:'supported',attributedSubject:'Kant',
   evidenceRole:'work-assertion',supportBoundary:'Supports the full sentence.'}]}]};





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

// ---------------------------------------------------------------------------
// Batch 29 (B29-2): clearance alignment — present-but-non-clearing clause
// entries invalidate the verdict (clause-not-cleared), never flip-then-veto.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Batch 29 (B29-3): possessive trait attribution. The batch-27 B27-2
// pilot above (pronoun-actor span, round-table claim) covers design
// case (ii) unchanged. The unnamed-claim shape (batch-28 P1-C6) is a
// documented non-goal: no mechanism is added for it here.
// ---------------------------------------------------------------------------
const b29ConradPlan={...conradPlan,parts:[{...conradPlan.parts[0],
 question:'What does the narrator observe about Kurtz in Heart of Darkness?'}]};
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



test('batch 30 inference call records carry kind and claimCount',async()=>{
 const ai=makeAI([answer('PART P1\nHume links necessity to custom and regular conjunction. [S1]'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true,transportDiagnostics:true});
 assert.equal(result.outcome,'verified-source-draft');
 assert.ok(Array.isArray(result.trace.inferenceCalls)&&result.trace.inferenceCalls.length>=2);
 for(const call of result.trace.inferenceCalls){
  assert.ok('kind' in call,'every call record names its kind');
  assert.ok('claimCount' in call,'every call record carries a claimCount field');
 }
 const composeCall=result.trace.inferenceCalls.find(call=>call.stage==='compose');
 assert.equal(composeCall.kind,'initial');
 assert.equal(composeCall.claimCount,null,'composition judges no claim list');
 const reviewCall=result.trace.inferenceCalls.find(call=>call.stage==='review');
 assert.equal(reviewCall.kind,'initial');
 assert.equal(reviewCall.claimCount,1,'the review record counts the claims it judged');
});


test('batch 30 B30-2: derivePartContract composes coverage and status derivation',()=>{
 const answered=derivePartContract({reviewerStatus:'answered',
  reviewerAnswerStatus:'answered',directAnswerIds:['P1-C1'],
  invalidDirectAnswerClaimIds:[],acceptedClaimIds:['P1-C1','P1-C2'],
  acceptedCount:2,requirementCoverage:[{requirementId:'P1-R1',
   status:'answered',answerClaimIds:['P1-C1']}],comparisonComplete:true});
 assert.equal(answered.directAnswerCovered,true);
 assert.deepEqual(answered.acceptedDirectAnswerIds,['P1-C1']);
 assert.equal(answered.requirementsComplete,true);
 assert.equal(answered.status,'answered');
 assert.equal(answered.answerStatus,'answered');
 const stranded=derivePartContract({reviewerStatus:'answered',
  reviewerAnswerStatus:'answered',directAnswerIds:['P1-C1'],
  invalidDirectAnswerClaimIds:[],acceptedClaimIds:['P1-C2'],
  acceptedCount:1,requirementCoverage:[{requirementId:'P1-R1',
   status:'partial',answerClaimIds:[]}],comparisonComplete:true});
 assert.equal(stranded.directAnswerCovered,false,
  'a direct-answer claim that did not survive is not covered');
 assert.equal(stranded.status,'partial');
 assert.equal(stranded.answerStatus,'partial');
 const noRequirements=derivePartContract({reviewerStatus:'answered',
  reviewerAnswerStatus:'answered',directAnswerIds:['P1-C1'],
  invalidDirectAnswerClaimIds:[],acceptedClaimIds:['P1-C1'],acceptedCount:1});
 assert.equal(noRequirements.requirementsComplete,undefined,
  'no coverage supplied, no completeness verdict recorded');
 assert.equal(noRequirements.status,'answered',
  'absent requirements never demote the part');
});

test('batch 30 B30-3: nested attribution registers both the reporter and the reported subject',()=>{
 // The two exact batch-29 Ambition claims whose F3 vetoes were false.
 assert.deepEqual(claimPersonSubjects(
  'For example, Emerson observes that the writer Bulwer is an industrious author whose romances "tend to fan" the "worldly ambition of the student" by treating intellect as a mere tool for temporal success.'),
  ['Emerson','Bulwer']);
 assert.deepEqual(claimPersonSubjects(
  'Emerson points out that in some literary universes, such as those explored by Thackeray, there is no "allowance" for ideals; instead, characters and readers must "renounce ideals, and accept London".'),
  ['Emerson','Thackeray']);
 // Other reporting-frame shapes: subordinate subject behind a verb of
 // saying, a possessive report noun, and an according-to frame.
 assert.deepEqual(claimPersonSubjects(
  'Emerson describes how the writer Carlyle sees history as the biography of great men.'),
  ['Emerson','Carlyle']);
 assert.deepEqual(claimPersonSubjects(
  'Emerson\u2019s account of Bulwer presents the novelist as a warning about worldly ambition.'),
  ['Emerson','Bulwer']);
 assert.deepEqual(claimPersonSubjects(
  'According to Emerson, Bulwer treats intellect as a tool for temporal success.'),
  ['Bulwer','Emerson']);
 // No reporting link, no registration: the second name is a plain
 // object of the first name's action and stays unregistered, exactly
 // as before this batch.
 assert.deepEqual(claimPersonSubjects('Marlow met Kurtz at the outer station and spoke with him.'),
  ['Marlow']);
 assert.deepEqual(claimPersonSubjects('Emerson wrote essays about nature and the conduct of life.'),
  ['Emerson']);
 // Batch-27/29 baselines are unchanged.
 assert.deepEqual(claimPersonSubjects('Kurtz sat at the head of an immense round table.'),
  ['Kurtz']);
 assert.deepEqual(claimPossessiveOnlySubjects(
  'The glamour of his approach seems to envelop Kurtz\u2019s destitution and loneliness.'),
  ['Kurtz']);
 assert.deepEqual(claimPersonSubjects(
  'Hamlet\u2019s conscience weakens resolution and turns enterprise sickly.'),[]);
});

test('batch 30 B30-3: a claim attributed by the reviewer to the reported subject is accepted',async()=>{
 const emerson={id:'S1',bookId:'77',title:'Essays — Ralph Waldo Emerson',page:12,
  url:'https://example.test/emerson#page=12',
  text:'The writer Bulwer is an industrious author whose romances tend to fan the worldly ambition of the student, treating intellect as a mere tool for temporal success.',
  preview:'The writer Bulwer is an industrious author whose romances tend to fan worldly ambition.'};
 const plan={version:'reader-evidence-v2',intent:'explain',
  sources:[{label:'Ralph Waldo Emerson',role:'primary',bookIds:['77']}],
  parts:[{id:'P1',question:'How is ambition portrayed in the library\u2019s novels?',
   sourceBookIds:['77'],searchQueries:['ambition novels portrayal'],candidateSourceIds:['S1']}],
  queries:['ambition novels portrayal']};
 const claimText='For example, Emerson observes that the writer Bulwer is an industrious author whose romances "tend to fan" the "worldly ambition of the student" by treating intellect as a mere tool for temporal success.';
 const ai={calls:[],run:async(_model,{messages})=>{
  const system=String(messages[0].content);
  if(system.startsWith('Answer the reader'))
   return answer('PART P1\n'+claimText+' [S1]');
  if(system.startsWith('Review the complete answer')){
   const payload=parsePayload(messages);
   const claim=payload.claims[0];
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
    answerStatus:'answered',directAnswerClaimIds:[claim.claimId],
    retainedContextClaimIds:[]}],
    claims:[{claimId:claim.claimId,status:'answered',
     sources:[{sourceId:'S1',status:'answered',spanIds:['S1-Q1'],
      subjectAttributionStatus:'supported',attributedSubject:'Bulwer',
      attributionStatus:'supported',attributedSpeaker:'Emerson'}]}]})};
  }
  throw new Error('unexpected stage in nested-attribution fixture');
 }};
 const result=await composeEvidenceAnswer(
  'How is ambition portrayed in the library\u2019s novels?',[emerson],ai,[],
  {plan,catalog:{'77':'Essays — Ralph Waldo Emerson'},trace:true});
 assert.ok(!result.trace.reviewContract.supportIssues.some(issue=>
  issue.reason==='source-subject-attribution-mismatch'),
  'no F3 mismatch: the reported subject is now a registered claim target');
 const decision=result.trace.reviewContract.reviewDecisions
  .find(item=>item.claimId==='P1-C1'&&item.sourceId==='S1');
 assert.equal(decision.accepted,true);
 assert.equal(result.outcome,'verified-source-draft');
 assert.match(result.answer,/Bulwer is an industrious author/);
});

// ---------------------------------------------------------------------------
// Batch 30 (B30-4): two-key restoration at re-normalization.
// ---------------------------------------------------------------------------

const b30ConradPlan={version:'reader-evidence-v2',intent:'explain',
 sources:[{label:'Joseph Conrad',role:'primary',bookIds:['315']}],
 parts:[{id:'P1',question:'In Heart of Darkness, what does Marlow do as the steamer approaches the shore?',
  sourceBookIds:['315'],searchQueries:['Marlow steamer shore'],candidateSourceIds:['S1']}],
 queries:['Marlow steamer shore']};
const b30ConradCatalog={...catalog,'315':'Heart of Darkness — Joseph Conrad'};

function b30ReviewResponder({attributedSubject,spanId}) {
 return ({messages})=>{
  const payload=parsePayload(messages);
  const claim=payload.claims[0];
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
   answerStatus:'answered',directAnswerClaimIds:[claim.claimId],
   retainedContextClaimIds:[]}],
   claims:[{claimId:claim.claimId,status:'answered',
    sources:[{sourceId:'S1',status:'answered',spanIds:[spanId],
     subjectAttributionStatus:'supported',attributedSubject}]}]})};
 };
}
function b30RescueResponder(anchor){
 return ({messages})=>{
  const payload=JSON.parse(messages[1].content);
  return {response:JSON.stringify({decisions:payload.decisions.map(item=>({
   claimId:item.claimId,sourceId:item.sourceId,verdict:'supported',
   fragment:item.spans[0].text,
   elements:[{element:item.claimText,stated:true}],anchor}))})};
 };
}





// ---------------------------------------------------------------------------
// Batch 30 (B30-5): source-required requires per-part selected linkage.
// ---------------------------------------------------------------------------

test('batch 30 B30-5: a plan-level candidate list alone does not make a part source-required when selection is recorded',()=>{
 const plan={version:'reader-evidence-v2',intent:'explain',
  sources:[{label:'Adam Smith',role:'primary',bookIds:['260']}],
  parts:[{id:'P1',question:'How does the division of labour increase productivity?',
   sourceBookIds:null,searchQueries:['division of labour productivity']},
   {id:'P2',question:'How does the division of labour affect the workers who perform it?',
   sourceBookIds:null,searchQueries:['division of labour workers']}],
  queries:['division of labour']};
 const sourceWith=support=>({id:'S1',bookId:'260',
  title:'The Wealth of Nations — Adam Smith',
  candidatePartIds:['P1','P2'],
  ...(support?{candidatePartSupport:support}:{})});
 // Selection recorded, direct support only for P1: P2's only linkage
 // is the plan-level candidate list, which no longer confers
 // source-required status.
 let linked=linkEvidenceToParts(plan,[sourceWith([{partId:'P1',support:'direct'}])]);
 assert.equal(linked.parts[0].sourceRequired,true);
 assert.equal(linked.parts[1].sourceRequired,false);
 assert.equal(linked.parts[1].answerMode,'general-context');
 // Context-only support for P2 does not confer it either.
 linked=linkEvidenceToParts(plan,[sourceWith([{partId:'P2',support:'context'}])]);
 assert.equal(linked.parts[1].sourceRequired,false);
 // No selection signal anywhere (fallback builds, older packets):
 // the candidate list counts exactly as it did before this batch.
 linked=linkEvidenceToParts(plan,[sourceWith(null)]);
 assert.equal(linked.parts[0].sourceRequired,true);
 assert.equal(linked.parts[1].sourceRequired,true);
 // Per-part book scoping still confers it when the signal is present:
 // scoping is the plan's own per-part statement, not the candidate
 // list.
 const scopedPlan={...plan,parts:plan.parts.map(part=>({...part,sourceBookIds:['260']}))};
 linked=linkEvidenceToParts(scopedPlan,[sourceWith([{partId:'P1',support:'direct'}])]);
 assert.equal(linked.parts[1].sourceRequired,true);
});

const b30SmithSources=supportBySource=>[
 {id:'S1',bookId:'260',title:'The Wealth of Nations — Adam Smith',page:18,
  url:'https://example.test/smith#page=18',
  text:'The division of labour increases productivity because each worker gains dexterity, time is saved in passing between tasks, and machinery is more readily invented.',
  preview:'The division of labour increases productivity through dexterity and machinery.',
  candidatePartIds:['P1','P2'],candidatePartSupport:supportBySource.S1},
 {id:'S2',bookId:'260',title:'The Wealth of Nations — Adam Smith',page:781,
  url:'https://example.test/smith#page=781',
  text:'In the progress of the division of labour, the employment of the far greater part of those who live by labour is confined to a few very simple operations.',
  preview:'The employment of the far greater part of those who live by labour is confined to a few simple operations.',
  candidatePartIds:['P1','P2'],candidatePartSupport:supportBySource.S2}];
const b30SmithPlan={version:'reader-evidence-v2',intent:'explain',
 sources:[{label:'Adam Smith',role:'primary',bookIds:['260']}],
 parts:[{id:'P1',question:'How does the division of labour increase productivity?',
  sourceBookIds:['260'],searchQueries:['division of labour productivity'],
  candidateSourceIds:['S1','S2']},
  {id:'P2',question:'How does the division of labour affect the workers who perform it?',
  sourceBookIds:['260'],searchQueries:['division of labour workers'],
  candidateSourceIds:['S1','S2']}],
 queries:['division of labour productivity','division of labour workers']};
const b30SmithDraft='PART P1\nThe division of labour increases productivity by dexterity, saving transition time, and encouraging machinery. [S1]\n\n'+
 'PART P2\nA worker who spends his whole life performing a few simple operations has no occasion to exert his understanding and becomes as stupid and ignorant as it is possible for a human creature to become.';
function b30SmithReviewResponder({messages}){
 const payload=parsePayload(messages);
 const parts=payload.parts.map(part=>{
  const contextIds=(part.contextClaims||[]).map(claim=>claim.claimId);
  const claimIds=payload.claims.filter(claim=>claim.partId===part.partId)
   .map(claim=>claim.claimId);
  return {partId:part.partId,status:'answered',answerStatus:'answered',
   directAnswerClaimIds:[...claimIds,...contextIds],
   retainedContextClaimIds:contextIds};
 });
 return {response:JSON.stringify({parts,claims:payload.claims.map(claim=>({
  claimId:claim.claimId,status:'answered',
  sources:claim.sourceIds.map(sourceId=>({sourceId,status:'answered',
   spanIds:[claim.sourceEvidence.find(item=>item.sourceId===sourceId).spanIds[0]]}))}))})};
}

test('batch 30 B30-5: the Smith shape ships — an unselected part stays general-context instead of containing the answer',async()=>{
 // Batch-29 Smith SP1's linkage shape, with the selection signal
 // present: every source lists both parts as candidates, but
 // selection recorded direct support only for P1. P2's draft claim
 // is uncited; before this batch P2 was source-required on the
 // candidate list alone and its uncited state contained the whole
 // answer at the 2-part cliff.
 const ai=batch25RouterAI({reviewResponder:b30SmithReviewResponder,
  draftText:b30SmithDraft});
 const result=await composeEvidenceAnswer(
  'How does the division of labour affect productivity and the workers who perform it?',
  b30SmithSources({S1:[{partId:'P1',support:'direct'}],
   S2:[{partId:'P1',support:'direct'}]}),
  ai,[],{plan:b30SmithPlan,
   catalog:{...catalog,'260':'The Wealth of Nations — Adam Smith'},trace:true});
 assert.equal(result.outcome,'verified-source-draft');
 assert.match(result.answer,/increases productivity by dexterity/);
 assert.match(result.answer,/as stupid and ignorant as it is possible/,
  'the unselected part ships through the general-context channel');
 assert.ok(!(result.trace.sourceRequiredContainment?.uncitedPartIds||[]).length,
  'no source-required part is uncited, so containment never engages');
 const p2=result.questionParts.find(part=>part.partId==='P2');
 assert.notEqual(p2.status,'unsupported');
});

test('batch 30 B30-5 converse, Stage B B0 rule: a source-required uncited part ships labeled beside its cited sibling',async()=>{
 // Converse: selection recorded direct support for P2 as well, so
 // P2 IS source-required and its claim stays uncited. Under the
 // batch-30/31 rules this 2-part shape suppressed the whole answer
 // (P2 was not a strict minority, and the plan is not book-scoped
 // here). Stage B (B0) disposes per part instead: P1 is cited, so
 // the answer ships and P2 ships labeled — the suppression this
 // fixture used to assert is exactly the phase-3 solitude loss.
 const refuseRepair=({messages})=>{
  const payload=parsePayload(messages);
  return {response:JSON.stringify({parts:[{partId:payload.parts[0].partId,
   replacements:payload.parts[0].repair.replaceClaimIds.map(claimId=>({claimId,
    text:'A changed but still uncited statement about the worker and his understanding.'})),
   additions:[]}]})};
 };
 const ai=batch25RouterAI({reviewResponder:b30SmithReviewResponder,
  repairResponder:refuseRepair,draftText:b30SmithDraft});
 const result=await composeEvidenceAnswer(
  'How does the division of labour affect productivity and the workers who perform it?',
  b30SmithSources({S1:[{partId:'P1',support:'direct'}],
   S2:[{partId:'P2',support:'direct'}]}),
  ai,[],{plan:b30SmithPlan,
   catalog:{...catalog,'260':'The Wealth of Nations — Adam Smith'},trace:true});
 assert.equal(result.trace.sourceRequiredContainment.disposition,
  'answer-level-shipped-with-uncited-parts');
 assert.deepEqual(result.trace.sourceRequiredContainment.uncitedPartIds,['P2']);
 assert.deepEqual(result.trace.sourceRequiredContainment.citedPartIds,['P1']);
 assert.equal(result.trace.sourceRequiredContainment.uncitedFraction,1/2);
 assert.equal(result.outcome,'verified-source-draft');
 assert.match(result.answer,/increases productivity by dexterity/,
  'the cited part ships; the uncited source-required part no longer contains it');
 assert.match(result.answer,
  /Retrieved passages could not be verified as supporting this part of the question/);
});

// ---------------------------------------------------------------------------
// Batch 31 (B31-1): answer-level containment for book-scoped plans.
// ---------------------------------------------------------------------------

test('batch 31 B31-1: the Smith shape ships — a book-scoped answer with one cited part carries its uncited part, labeled',async()=>{
 // The batch-30 Smith SP2 shape under the new rule: both parts are
 // source-required (selection recorded direct support for each),
 // P2's claim is uncited and the citation-gate repair stays
 // uncited. Before this batch the 2-part cliff suppressed the whole
 // answer (the B30-5 converse test above asserts that history);
 // the plan is book-scoped, so containment now evaluates at
 // answer level: P1 is cited, the answer ships, and P2 ships with
 // the B11-5 uncited-with-packet label rather than a parallel
 // invention. The fixture carries the production selected-route
 // signal — options.selectedBookId, which the public gateway
 // passes on every selected-book build — and normalization scopes
 // every part to that book; the raw plan's own sourceBookIds
 // alone would NOT survive normalization (part scope there is
 // re-derived from question phrasing), which is why the B30-5
 // converse fixture above, carrying no selectedBookId, still
 // suppresses under the per-part rule.
 const refuseRepair=({messages})=>{
  const payload=parsePayload(messages);
  return {response:JSON.stringify({parts:[{partId:payload.parts[0].partId,
   replacements:payload.parts[0].repair.replaceClaimIds.map(claimId=>({claimId,
    text:'A changed but still uncited statement about the worker and his understanding.'})),
   additions:[]}]})};
 };
 const ai=batch25RouterAI({reviewResponder:b30SmithReviewResponder,
  repairResponder:refuseRepair,draftText:b30SmithDraft});
 const result=await composeEvidenceAnswer(
  'How does the division of labour affect productivity and the workers who perform it?',
  b30SmithSources({S1:[{partId:'P1',support:'direct'}],
   S2:[{partId:'P2',support:'direct'}]}),
  ai,[],{plan:b30SmithPlan,
   catalog:{...catalog,'260':'The Wealth of Nations — Adam Smith'},selectedBookId:'260',trace:true});
 assert.equal(result.outcome,'verified-source-draft');
 assert.match(result.answer,/increases productivity by dexterity/,
  'the cited part ships');
 assert.match(result.answer,/A worker who spends his whole life performing a few simple operations/,
  'the uncited part ships with its reviewed draft text intact');
 const containment=result.trace.sourceRequiredContainment;
 assert.equal(containment.level,'answer');
 assert.equal(containment.disposition,'answer-level-shipped-with-uncited-parts');
 assert.deepEqual(containment.uncitedPartIds,['P2']);
 assert.deepEqual(containment.uncitedBookScopedPartIds,['P2'],
  'the shipped-labeled census names the uncited book-scoped part');
 assert.deepEqual(containment.droppedPartIds,[]);
 assert.deepEqual(result.trace.uncitedPartsWithPacket,['P2']);
 assert.match(result.missing,
  /Retrieved passages could not be verified as supporting this part of the question: How does the division of labour affect the workers who perform it\?/,
  'the uncited part carries the existing B11-5 label in the missing segment');
});

test('batch 31 B31-1: a book-scoped plan with zero cited parts still suppresses',async()=>{
 // The answer-level floor (unchanged by Stage B's B0, which makes
 // the answer-level rule universal): WHICH parts must be cited is
 // relaxed, not WHETHER any must. With zero cited parts anywhere
 // the suppression applies exactly as before.
 const refuseRepair=({messages})=>{
  const payload=parsePayload(messages);
  return {response:JSON.stringify({parts:[{partId:payload.parts[0].partId,
   replacements:payload.parts[0].repair.replaceClaimIds.map(claimId=>({claimId,
    text:'A changed but still uncited statement.'})),additions:[]}]})};
 };
 const draft='PART P1\nThe division of labour increases productivity by dexterity, saving transition time, and encouraging machinery.\n\n'+
  'PART P2\nA worker who spends his whole life performing a few simple operations has no occasion to exert his understanding.';
 const ai=batch25RouterAI({reviewResponder:b30SmithReviewResponder,
  repairResponder:refuseRepair,draftText:draft});
 const result=await composeEvidenceAnswer(
  'How does the division of labour affect productivity and the workers who perform it?',
  b30SmithSources({S1:[{partId:'P1',support:'direct'}],
   S2:[{partId:'P2',support:'direct'}]}),
  ai,[],{plan:b30SmithPlan,
   catalog:{...catalog,'260':'The Wealth of Nations — Adam Smith'},selectedBookId:'260',trace:true});
 assert.equal(result.outcome,'generation-failed');
 const containment=result.trace.sourceRequiredContainment;
 // Stage B (B0): the suppression disposition names its actual
 // trigger — zero cited parts — and containment now evaluates at
 // answer level for every plan, book-scoped or not.
 assert.equal(containment.disposition,'suppressed-no-cited-parts');
 assert.equal(containment.level,'answer');
 assert.deepEqual(containment.citedPartIds,[]);
 assert.equal(containment.uncitedFraction,1);
 assert.deepEqual(containment.uncitedBookScopedPartIds,['P1','P2'],
  'book-scope provenance is recorded even on the suppression path');
 assert.equal(result.failureCode,'source-required-no-cited-parts');
 assert.doesNotMatch(result.answer,/increases productivity by dexterity/);
});

test('batch 31 B31-1 pilot (iii), Stage B B0 rule: an all-books two-part plan ships its cited part and labels the uncited one',async()=>{
 // Pilot (iii): the two parts are scoped to DIFFERENT books, so
 // the plan is not book-scoped; under B31-1 one uncited
 // source-required part of two was not a strict minority and the
 // whole answer was contained. Stage B (B0) removes the
 // book-scope distinction: containment is answer-level for every
 // plan, so the cited part ships and the uncited part ships
 // labeled. (A two-book explain plan: normalization adds no
 // synthetic comparison part, so the plan that reaches containment
 // is exactly these two parts.)
 const plan={version:'reader-evidence-v2',intent:'explain',
  sources:[{label:'David Hume',role:'primary',bookIds:['35']},
   {label:'Immanuel Kant',role:'primary',bookIds:['40']}],
  parts:[{id:'P1',question:'How does Hume explain causal necessity?',
   sourceBookIds:['35'],searchQueries:['Hume necessity custom'],
   candidateSourceIds:['S1']},
   {id:'P2',question:'How does Kant explain causal necessity?',
   sourceBookIds:['40'],searchQueries:['Kant causality a priori'],
   candidateSourceIds:['S2']}],
  queries:['Hume necessity custom','Kant causality a priori']};
 const reviewAll=({messages})=>{
  const payload=parsePayload(messages);
  const reviewParts=payload.parts.map(part=>{
   const contextIds=(part.contextClaims||[]).map(claim=>claim.claimId);
   const claimIds=payload.claims.filter(claim=>claim.partId===part.partId)
    .map(claim=>claim.claimId);
   return {partId:part.partId,status:'answered',answerStatus:'answered',
    directAnswerClaimIds:[...claimIds,...contextIds],
    retainedContextClaimIds:contextIds};
  });
  return {response:JSON.stringify({parts:reviewParts,
   claims:payload.claims.map(claim=>({claimId:claim.claimId,status:'answered',
    sources:claim.sourceIds.map(sourceId=>({sourceId,status:'answered',
     spanIds:[sourceId+'-Q1']}))}))})};
 };
 const refuseRepair=({messages})=>{
  const payload=parsePayload(messages);
  return {response:JSON.stringify({parts:[{partId:payload.parts[0].partId,
   replacements:payload.parts[0].repair.replaceClaimIds.map(claimId=>({claimId,
    text:'A changed but still uncited statement about Kant and causality.'})),
   additions:[]}]})};
 };
 const ai=batch25RouterAI({reviewResponder:reviewAll,
  repairResponder:refuseRepair,
  draftText:'PART P1\nHume connects necessity to custom through repeated experience. [S1]\n\n'+
   'PART P2\nKant presents causal order through the structure of human understanding.'});
 const result=await composeEvidenceAnswer(
  'How does Hume explain causal necessity and how does Kant explain it?',
  [{...hume,candidatePartIds:['P1']},{...kant,candidatePartIds:['P2']}],
  ai,[],{plan,catalog,trace:true});
 assert.equal(result.outcome,'verified-source-draft');
 const containment=result.trace.sourceRequiredContainment;
 assert.equal(containment.level,'answer');
 assert.equal(containment.disposition,'answer-level-shipped-with-uncited-parts');
 assert.deepEqual(containment.uncitedPartIds,['P2']);
 assert.deepEqual(containment.uncitedBookScopedPartIds,[],
  'book-scope provenance is still recorded — this plan is not book-scoped');
 assert.match(result.answer,/Hume connects necessity to custom/,
  'the cited sibling ships; it is no longer contained with the uncited part');
 assert.match(result.answer,
  /Retrieved passages could not be verified as supporting this part of the question: How does Kant explain causal necessity\?/);
});

test('batch 31 B31-1: a book-scoped three-part plan ships with two uncited parts labeled (no minority arithmetic at answer level)',async()=>{
 // Pilot (iv): beyond the ≥1-cited floor there is no minority
 // arithmetic at answer level — two of three parts uncited still
 // ship, each labeled.
 const sources=[
  {id:'S1',bookId:'260',title:'The Wealth of Nations — Adam Smith',page:18,
   url:'https://example.test/smith#page=18',
   text:'The division of labour increases productivity because each worker gains dexterity, time is saved in passing between tasks, and machinery is more readily invented.',
   preview:'The division of labour increases productivity through dexterity and machinery.',
   candidatePartIds:['P1','P2','P3'],
   candidatePartSupport:[{partId:'P1',support:'direct'},
    {partId:'P2',support:'direct'},{partId:'P3',support:'direct'}]},
  {id:'S2',bookId:'260',title:'The Wealth of Nations — Adam Smith',page:781,
   url:'https://example.test/smith#page=781',
   text:'In the progress of the division of labour, the employment of the far greater part of those who live by labour is confined to a few very simple operations.',
   preview:'The employment of the far greater part of those who live by labour is confined to a few simple operations.',
   candidatePartIds:['P1','P2','P3'],
   candidatePartSupport:[{partId:'P1',support:'direct'},
    {partId:'P2',support:'direct'},{partId:'P3',support:'direct'}]}];
 const plan={version:'reader-evidence-v2',intent:'explain',
  sources:[{label:'Adam Smith',role:'primary',bookIds:['260']}],
  parts:[{id:'P1',question:'How does the division of labour increase productivity?',
   sourceBookIds:['260'],searchQueries:['division of labour productivity'],
   candidateSourceIds:['S1','S2']},
   {id:'P2',question:'How does the division of labour affect the workers who perform it?',
   sourceBookIds:['260'],searchQueries:['division of labour workers'],
   candidateSourceIds:['S1','S2']},
   {id:'P3',question:'How does the division of labour affect invention?',
   sourceBookIds:['260'],searchQueries:['division of labour invention'],
   candidateSourceIds:['S1','S2']}],
  queries:['division of labour productivity','division of labour workers',
   'division of labour invention']};
 const draft='PART P1\nThe division of labour increases productivity by dexterity, saving transition time, and encouraging machinery. [S1]\n\n'+
  'PART P2\nA worker who spends his whole life performing a few simple operations has no occasion to exert his understanding.\n\n'+
  'PART P3\nInvention is encouraged when a worker\u2019s attention is fixed on a single simple operation.';
 const refuseRepair=({messages})=>{
  const payload=parsePayload(messages);
  return {response:JSON.stringify({parts:[{partId:payload.parts[0].partId,
   replacements:payload.parts[0].repair.replaceClaimIds.map(claimId=>({claimId,
    text:'A changed but still uncited statement.'})),additions:[]}]})};
 };
 const ai=batch25RouterAI({reviewResponder:b30SmithReviewResponder,
  repairResponder:refuseRepair,draftText:draft});
 const result=await composeEvidenceAnswer(
  'How does the division of labour affect productivity, workers, and invention?',
  sources,ai,[],{plan,
   catalog:{...catalog,'260':'The Wealth of Nations — Adam Smith'},selectedBookId:'260',trace:true});
 assert.equal(result.outcome,'verified-source-draft');
 assert.match(result.answer,/increases productivity by dexterity/);
 const containment=result.trace.sourceRequiredContainment;
 assert.equal(containment.level,'answer');
 assert.deepEqual(containment.uncitedBookScopedPartIds,['P2','P3']);
 assert.deepEqual(result.trace.uncitedPartsWithPacket,['P2','P3']);
 const labels=result.missing.match(
  /Retrieved passages could not be verified as supporting this part of the question:/g)||[];
 assert.equal(labels.length,2,'both uncited parts carry the label');
});

// ---------------------------------------------------------------------------
// Batch 31 (B31-2): gate-time antecedent suppression — remaining pilots.
// (Pilot (i), the Conrad false-positive shape, is the rewritten
// B30-4 antecedent test above; the possessive-only backstop test
// sits beside it.)
// ---------------------------------------------------------------------------





const b33HeadFillers=[
 'The helmsman kept the steamer steady as the shore came into view, holding the vessel against the current that pressed her toward the bank and the shallows beyond.',
 'An order from the bridge sent the steamer closer to the shore before dusk, and the leadsman began to call the depths as the water shoaled along the bank.',
 'The helmsman watched the shore while the steamer slowed in the current, and the mate stood ready with the anchor as the light began to fail over the water.',
 'The steamer approached the shore with her engines slowed, and the helmsman kept her head against the current while the crew watched the bank in silence.',
 'Orders passed along the deck as the steamer neared the shore, and the helmsman answered each one with a turn of the wheel and a glance toward the bank.',
 'The shore rose dark against the evening light as the steamer approached, and the helmsman steered by the marks the leadsman called from the bow.',
 'When the steamer came near the shore the helmsman held her steady in the current, and the crew stood ready at their stations along the rail to land.',
 'The captain’s orders reached the helmsman as the steamer approached the shore, and the vessel answered slowly, her wheel hard over against the pressing current.'];
const b33ActorSentence='He ordered the helmsman to steer the steamer toward the shore, and the crew, who had been waiting in silence for the signal, moved at once to their stations along the rail.';
function b33HeadPage(namingSentence){
 // Eight high-relevance filler sentences push the naming sentence
 // out of the 8-span review packet; the naming sentence survives
 // only as the actor span's head.
 return {id:'S1',bookId:'315',title:'Heart of Darkness — Joseph Conrad',
  page:44,url:'https://example.test/conrad#page=44',
  text:[...b33HeadFillers,namingSentence,b33ActorSentence].join(' '),
  preview:'He ordered the helmsman to steer the steamer toward the shore.'};
}
function b33HeadReviewResponder(captured){
 return ({messages})=>{
  const payload=parsePayload(messages);
  const claim=payload.claims[0];
  const actor=payload.spanCatalog.find(entry=>
   entry.text.includes('He ordered the helmsman'));
  const naming=payload.spanCatalog.find(entry=>
   entry.text.includes('taken command')||entry.text.includes('reputation'));
  captured.actorId=actor?.spanId;captured.actorHead=actor?.head;
  captured.namingId=naming?.spanId;
  captured.packetSpanIds=payload.parts[0].evidence[0].spanIds;
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
   answerStatus:'answered',directAnswerClaimIds:[claim.claimId],
   retainedContextClaimIds:[]}],
   claims:[{claimId:claim.claimId,status:'answered',
    sources:[{sourceId:'S1',status:'answered',spanIds:[actor.spanId],
     subjectAttributionStatus:'supported',attributedSubject:'Marlow'}]}]})};
 };
}




const b33PPPage=[
 'The whole of what Elizabeth had already heard, his claims on Mr. Darcy, was now openly acknowledged by Wickham to the whole party.',
 'Elizabeth Bennet had listened to the tale in silence, though she said nothing in reply to the company assembled there that evening.',
 'Jane Bennet, who had arrived later in the evening, heard the same account with her usual composure and gentleness of temper.',
 'Miss Bennet was the only creature who could suppose there might be any extenuating circumstances in the case, unknown to the society of Hertfordshire; her mild and steady candour always pleaded for allowances, and urged the possibility of mistakes—but by everybody else Mr. Darcy was condemned as the worst of men.'].join(' ');
const b33PPSource={id:'S1',bookId:'341',title:'Pride and Prejudice — Jane Austen',
 page:83,url:'https://example.test/pp#page=83',text:b33PPPage,
 preview:'Miss Bennet was the only creature who could suppose there might be any extenuating circumstances in the case.'};
const b33PPPlan={version:'reader-evidence-v2',intent:'explain',
 sources:[{label:'Jane Austen',role:'primary',bookIds:['341']}],
 parts:[{id:'P1',question:'In Pride and Prejudice, how do Elizabeth and Jane respond to the case against Darcy?',
  sourceBookIds:['341'],searchQueries:['Bennet Darcy extenuating circumstances'],
  candidateSourceIds:['S1']}],queries:['Bennet Darcy extenuating circumstances']};
const b33PPCatalog={'341':'Pride and Prejudice — Jane Austen'};


test('batch 33 B33-4: a head naming the person in full disambiguates the shared form',async()=>{
 // The span still names only "Miss Bennet", but the span's head
 // (B33-1) names Jane Bennet in full as the actor of the pleading
 // — the attribution is anchored and the claim ships.
 const page=[
  'The company had talked of little else all evening, and the case against Mr. Darcy was rehearsed again in every corner of the room before the tea was served.',
  'Jane Bennet argued, whenever the case was mentioned in company, that allowances ought to be made for mistakes before any man was condemned outright.',
  'Miss Bennet was the only creature who could suppose there might be any extenuating circumstances in the case, unknown to the society of Hertfordshire; her mild and steady candour always pleaded for allowances, and urged the possibility of mistakes—but by everybody else Mr. Darcy was condemned as the worst of men.',
  'Elizabeth Bennet, who had listened to the whole account in silence, walked home with her sister under a sky full of stars that night.'].join(' ');
 const source={...b33PPSource,text:page};
 const draft='PART P1\n'+
  'Jane searches for "extenuating circumstances" while Mr. Darcy is condemned as the worst of men. [S1]';
 const reviewResponder=({messages})=>{
  const payload=JSON.parse(messages[1].content);
  const target=payload.spanCatalog.find(entry=>
   entry.text.includes('extenuating circumstances'));
  const claim=payload.claims[0];
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
   answerStatus:'answered',directAnswerClaimIds:[claim.claimId],
   retainedContextClaimIds:[]}],claims:[{claimId:claim.claimId,
   status:'answered',sources:[{sourceId:'S1',status:'answered',
   spanIds:[target.spanId],subjectAttributionStatus:'supported',
   attributedSubject:'Jane Bennet'}]}]})};
 };
 const ai=batch25RouterAI({reviewResponder,draftText:draft});
 const result=await composeEvidenceAnswer(
  'In Pride and Prejudice, how do Elizabeth and Jane respond to the case against Darcy?',
  [source],ai,[],{plan:b33PPPlan,catalog:b33PPCatalog,trace:true});
 const decision=result.trace.reviewContract.reviewDecisions
  .find(item=>item.sourceId==='S1');
 assert.equal(decision.accepted,true,
  'the head disambiguates the shared form and the claim ships');
 assert.equal(result.trace.reviewContract.supportIssues.some(item=>
  item.familyNameAmbiguity),false);
 assert.match(result.answer,/extenuating circumstances/);
});

// ---------------------------------------------------------------------------
// Batch 33 (B33-5): gate economy II pilots.
// ---------------------------------------------------------------------------







// ---------------------------------------------------------------------------
// Batch 32 (B32-6): the three batch-31 B31-3 pilots that stood here
// (the Dostoevsky compound quote-speaker catch and its two controls)
// are REMOVED with the guard they piloted. Retirement rationale,
// recorded per the batch-32 design: across 64 production cases
// (batch-31 validation + phase-3 baseline) the guard produced 0 true
// positives and 2 false positives — its only firings beyond these
// pilots matched a single shared verb ("endure") and a wrong-page
// pairing, demoting sound pairs, while the batch-30 misattribution
// shape it was built for re-entered through the context-claim
// channel instead. That channel is closed by B32-5's demotion
// inheritance (pilots below), and the sourced shape remains covered
// by the ordinary attribution-mismatch gate. The Karamazov fixture
// constants (b31KaramazovText/Source/Plan/Catalog,
// b31KaramazovReview, b31RescueNotSupported) were used only by the
// retired pilots and are removed with them.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Batch 32 (B32-7): the uncited-part label must reach the answer text.
// ---------------------------------------------------------------------------

test('batch 32 B32-7: the uncited-part label appears in the final answer text of an answer-level ship',async()=>{
 // The batch-31 Smith shape: the build shipped, the B11-5 label was
 // computed, and it landed only in the result's `missing` field —
 // the reader of the answer itself never saw it (batch-31 verdict
 // and phase-3 baseline both traced the label in
 // uncitedPartsWithPacket while the answer text carried no such
 // notice, twice in a row). This pilot asserts the label string
 // inside the FINAL ANSWER TEXT, positioned with the uncited part.
 const refuseRepair=({messages})=>{
  const payload=parsePayload(messages);
  return {response:JSON.stringify({parts:[{partId:payload.parts[0].partId,
   replacements:payload.parts[0].repair.replaceClaimIds.map(claimId=>({claimId,
    text:'A changed but still uncited statement about the worker and his understanding.'})),
   additions:[]}]})};
 };
 const ai=batch25RouterAI({reviewResponder:b30SmithReviewResponder,
  repairResponder:refuseRepair,draftText:b30SmithDraft});
 const result=await composeEvidenceAnswer(
  'How does the division of labour affect productivity and the workers who perform it?',
  b30SmithSources({S1:[{partId:'P1',support:'direct'}],
   S2:[{partId:'P2',support:'direct'}]}),
  ai,[],{plan:b30SmithPlan,
   catalog:{...catalog,'260':'The Wealth of Nations — Adam Smith'},selectedBookId:'260',trace:true});
 assert.equal(result.outcome,'verified-source-draft');
 assert.match(result.answer,
  /Retrieved passages could not be verified as supporting this part of the question: How does the division of labour affect the workers who perform it\?/,
  'the label string is inside the final answer text, not only in missing');
 assert.deepEqual(result.trace.final.uncitedPartLabelsInAnswer,['P2'],
  'the label delivery is traced per part');
 // The label rides with the uncited part's own text: it appears
 // after P2's shipped sentence, not appended to the cited part.
 const p2TextAt=result.answer.indexOf('A worker who spends his whole life');
 const labelAt=result.answer.indexOf('Retrieved passages could not be verified');
 assert.ok(p2TextAt>=0&&labelAt>p2TextAt,
  'the label follows the uncited part it names');
 assert.match(result.missing,
  /Retrieved passages could not be verified as supporting this part of the question/,
  'the B11-5 missing-segment record is preserved alongside');
});

// ---------------------------------------------------------------------------
// Batch 32 (B32-8): gate/veto calibration bundle.
// ---------------------------------------------------------------------------

test('batch 32 B32-8 (iii): a sentence-initial function word is not a claim subject (the "From" extraction)',async()=>{
 // Phase-3 Death AP2, P1-C9: the claim opens "From this view, …"
 // and the subject extractor registered the preposition 'From' as
 // the claim's subject. Everything downstream inherited the error:
 // the gate demoted the pair for a subject-attribution mismatch
 // against a name nobody claimed, and the rescue's anchor —
 // extracted from the same candidates — was 'From', grounding an
 // attribution hold on a function word. Function words are not
 // person references, at extraction or at the anchor.
 assert.deepEqual(claimPersonSubjects(
  'From this view, death is akin to sleep and a release from the cares of life.'),[],
  'the preposition no longer registers as a subject');
 assert.deepEqual(claimPersonSubjects(
  'By this reading, the authorship\u2019s writings are presented as upbuilding discourses.'),[],
  'the batch-31 Kierkegaard false target is gone too');
 const source={id:'S1',bookId:'18',title:'Meditations — Marcus Aurelius',
  page:64,url:'https://example.test/aurelius#page=64',
  text:'From this view, death is akin to sleep and a release from the cares of life, for what is dissolved into the elements suffers nothing and fears nothing.',
  preview:'From this view, death is akin to sleep.'};
 const plan={version:'reader-evidence-v2',intent:'explain',
  sources:[{label:'Marcus Aurelius',role:'primary',bookIds:['18']}],
  parts:[{id:'P1',question:'How does Marcus Aurelius present death?',
   sourceBookIds:['18'],searchQueries:['Aurelius death sleep'],
   candidateSourceIds:['S1']}],queries:['Aurelius death sleep']};
 const reviewResponder=({messages})=>{
  const payload=parsePayload(messages);
  const claim=payload.claims[0];
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
   answerStatus:'answered',directAnswerClaimIds:[claim.claimId],
   retainedContextClaimIds:[]}],
   claims:[{claimId:claim.claimId,status:'answered',
    sources:[{sourceId:'S1',status:'answered',spanIds:['S1-Q1'],
     attributionStatus:'supported',
     subjectAttributionStatus:'supported',attributedSubject:'true inner being'}]}]})};
 };
 const ai=batch25RouterAI({reviewResponder,
  draftText:'PART P1\nFrom this view, death is akin to sleep and a release from the cares of life. [S1]'});
 const result=await composeEvidenceAnswer('How does Marcus Aurelius present death?',
  [source],ai,[],{plan,catalog:{...catalog,'18':'Meditations — Marcus Aurelius'},trace:true});
 const decision=result.trace.reviewContract.reviewDecisions
  .find(item=>item.claimId==='P1-C1'&&item.sourceId==='S1');
 assert.equal(decision.accepted,true,
  'no subject ground is manufactured from a function word');
 assert.equal(result.trace.rescueReview,undefined,
  'the pair never reaches the rescue on a vacuous finding');
 assert.match(result.answer,/death is akin to sleep/);
});






// ---------------------------------------------------------------------------
// Batch 32 (B32-5): context-claim demotion inheritance.
// ---------------------------------------------------------------------------

const b32KaramazovSource={id:'S4',bookId:'103',
 title:'The Brothers Karamazov — Fyodor Dostoevsky',page:311,
 url:'https://example.test/karamazov#page=311',
 text:'The old Inquisitor told him that the Church had corrected the work, that they were keepers of the mystery who had taken some curse upon themselves for the happiness of mankind, and that freedom had been replaced by bread and authority. "It is nothing but a lust of power, of filthy earthly gain, of domination," he said, "and the weak will bless us, for we alone can feed them and still their consciences for ever."',
 preview:'The old Inquisitor told him that the Church had corrected the work.'};
const b32KaramazovPlan={version:'reader-evidence-v2',intent:'explain',
 sources:[{label:'Fyodor Dostoevsky',role:'primary',bookIds:['103']}],
 parts:[{id:'P1',question:'In The Brothers Karamazov, how does the Grand Inquisitor episode challenge Alyosha\u2019s faith?',
  sourceBookIds:['103'],searchQueries:['Grand Inquisitor challenge faith'],
  candidateSourceIds:['S4']}],queries:['Grand Inquisitor challenge faith']};
const b32KaramazovCatalog={...catalog,
 '103':'The Brothers Karamazov — Fyodor Dostoevsky'};
// The exact production claim texts (batch-31 Dostoevsky SP2, P1):
const b32C9Text='While Alyosha might view religious figures as conduits of grace, the Inquisitor represents a version of the Church that has taken some curse upon themselves for the happiness of mankind by replacing divine freedom with earthly domination.';
const b32C10Text='This poses a challenge to Alyosha\u2019s monastic identity by suggesting that the institutions of faith may operate on principles of control and "lust of power" rather than pure spiritual communion.';
// The production C5 is three sentences; the harness's draft
// segmentation splits multi-sentence context claims per sentence,
// and per-sentence fragments are already B7-2 rejection
// containment's domain (its 0.5 overlap coefficient catches them —
// verified in this fixture). The production escape was the FUSED
// claim: one claim restating two demoted claims plus framing,
// measuring 0.364/0.235 per-claim — under B7-2's bar. The fixture
// therefore joins the same content into a single sentence, which
// reproduces the production claim configuration and its measured
// coverage (0.36 against C9).
const b32C5Text='The challenge also touches upon the nature of those who guard the faith: Ivan questions whether the Inquisitors are keepers of the mystery who have taken a curse upon themselves for the happiness of mankind, and he asks if the Inquisitors stand for nothing more than a lust of power, of filthy earthly gain, of domination.';
const b32C4Text='The philosophical challenge is centered on the tension between spiritual freedom and human security. The narrative suggests that because man has ceased to see signs from heaven, there is nothing left but faith in what the heart doth say.';
function b32DostoevskyReview({acceptedCitedMarker,demotedMarkers}){
 return ({messages})=>{
  const payload=parsePayload(messages);
  const byText=marker=>payload.claims.find(claim=>claim.text.includes(marker));
  const accepted=byText(acceptedCitedMarker);
  const contextIds=(payload.parts[0].contextClaims||[]).map(claim=>claim.claimId);
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
   answerStatus:'answered',directAnswerClaimIds:[accepted.claimId],
   retainedContextClaimIds:contextIds}],
   claims:payload.claims.map(claim=>demotedMarkers.some(marker=>
     claim.text.includes(marker))?
    {claimId:claim.claimId,status:'partial',
     sources:[{sourceId:'S4',status:'partial',spanIds:['S4-Q1']}]}:
    {claimId:claim.claimId,status:'answered',
     sources:[{sourceId:'S4',status:'answered',spanIds:['S4-Q1'],
      subjectAttributionStatus:'supported',attributedSubject:'Ivan'}]})})};
 };
}

test('batch 32 B32-5: a context claim restating gate-demoted content inherits the demotion (the batch-31 Dostoevsky shape)',async()=>{
 // The gate demotes the sourced claims C9/C10; the context claim
 // C5 — retained without pair audit — restates exactly their
 // content (the keepers-of-the-mystery curse, the lust of power)
 // and shipped it in batch 31, laundering a verified
 // misattribution into the answer. Inheritance drops it. The two
 // controls are the same part's other context claims: C4 (topical
 // neighbor, measured coverage 0.045–0.176 of the demoted claims)
 // and a restatement of the ACCEPTED claim — both ship.
 const draft='PART P1\n'+
  'Ivan\u2019s narrative posits that for fifteen centuries, humanity has lived without "signs from heaven," leaving nothing but faith in what the heart says. [S4]\n'+
  b32C9Text+' [S4]\n'+b32C10Text+' [S4]\n'+b32C5Text+'\n'+b32C4Text+'\n'+
  'Ivan\u2019s narrative adds that humanity has lived for fifteen centuries without signs from heaven, sustained only by faith in what the heart says.';
 const ai=batch25RouterAI({
  reviewResponder:b32DostoevskyReview({acceptedCitedMarker:'fifteen centuries, humanity has lived',
   demotedMarkers:['conduits of grace','monastic identity']}),
  draftText:draft});
 const result=await composeEvidenceAnswer(
  'In The Brothers Karamazov, how does the Grand Inquisitor episode challenge Alyosha\u2019s faith?',
  [b32KaramazovSource],ai,[],{plan:b32KaramazovPlan,
   catalog:b32KaramazovCatalog,trace:true});
 assert.match(result.answer,/fifteen centuries/,
  'the accepted cited claim ships');
 assert.doesNotMatch(result.answer,/keepers of the mystery/,
  'the laundering context claim is dropped with its demoted content');
 assert.match(result.answer,/ceased to see signs from heaven/,
  'control: the low-overlap context claim ships');
 assert.match(result.answer,/adds that humanity has lived/,
  'control: the context claim overlapping an ACCEPTED claim ships');
 const inherited=result.trace.contextClaimInheritsDemotion||[];
 assert.equal(inherited.length,1);
 assert.equal(inherited[0].partId,'P1');
 assert.ok(inherited[0].similarity>=0.3,
  'the recorded similarity is the C9 coverage (production: 0.364)');
 const contextIds=result.trace.reviewContract.reviewDecisions
  .filter(d=>d.contextOnly).map(d=>d.claimId);
 assert.ok(contextIds.includes(inherited[0].contextClaimId),
  'the dropped claim is the shipped context claim');
});

test('batch 32 B32-5: the coverage exception — demoted content independently covered by an accepted sourced claim keeps the context claim',async()=>{
 // Same laundering overlap (C5 covers 0.235 of the demoted C10),
 // but here an ACCEPTED sourced claim independently states the
 // demoted content (the institutions-of-faith passage, cited and
 // pair-audited): the substance ships cited, so the context
 // restatement is redundant rather than laundering, and it stays.
 const draft='PART P1\n'+
  'The institutions of faith may operate on principles of control and a lust of power rather than pure spiritual communion, whatever their keepers profess. [S4]\n'+
  b32C10Text+' [S4]\n'+b32C5Text;
 const ai=batch25RouterAI({
  reviewResponder:b32DostoevskyReview({acceptedCitedMarker:'whatever their keepers profess',
   demotedMarkers:['monastic identity']}),
  draftText:draft});
 const result=await composeEvidenceAnswer(
  'In The Brothers Karamazov, how does the Grand Inquisitor episode challenge Alyosha\u2019s faith?',
  [b32KaramazovSource],ai,[],{plan:b32KaramazovPlan,
   catalog:b32KaramazovCatalog,trace:true});
 assert.match(result.answer,/keepers of the mystery/,
  'the context claim ships under the coverage exception');
 assert.equal(result.trace.contextClaimInheritsDemotion,undefined,
  'no inheritance is recorded when the exception applies');
});

// ---------------------------------------------------------------------------
// Batch 33 (B33-6): B32-5 predicate-sharing recalibration, calibrated
// on the two batch-32 production pairs.
// ---------------------------------------------------------------------------

const b33HobbesContextText='Hobbes and Rousseau offer fundamentally opposing views on the nature of human beings in their respective state of nature descriptions, differing on whether humans are driven by competitive passions or by a peaceful, self-sufficient existence.';
const b33HobbesDemotedText='Unlike Hobbes\'s view of humans as inherently competitive and driven by socialized passions, Rousseau portrays the natural human as a robust, self-sufficient being whose primary drive is simple survival and whose character is not yet corrupted by the sense of honor or egoism found in civilized life.';
const b33NarratorsContextText='Marlow shapes the narrative in *Heart of Darkness* through a framed, observational lens, presenting his story as a recounted experience shared with a group of listeners.';
const b33NarratorsDemotedText='This admission suggests that while the listeners (and by extension, the readers) are observing the story from a position of hindsight or outside the immediate psychological pressure of the journey, Marlow remains a limited vessel, constrained by his own perceptions and the "darkness" of the experience.';
function b33InheritanceReview({demotedMarker,spanId}){
 return ({messages})=>{
  const payload=parsePayload(messages);
  const accepted=payload.claims.find(claim=>claim.text.includes('tale told aboard'));
  const contextIds=(payload.parts[0].contextClaims||[]).map(claim=>claim.claimId);
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
   answerStatus:'answered',directAnswerClaimIds:[accepted.claimId],
   retainedContextClaimIds:contextIds}],
   claims:payload.claims.map(claim=>claim.text.includes(demotedMarker)?
    {claimId:claim.claimId,status:'partial',
     sources:[{sourceId:'S1',status:'partial',spanIds:[spanId]}]}:
    {claimId:claim.claimId,status:'answered',
     sources:[{sourceId:'S1',status:'answered',
      spanIds:[spanId],subjectAttributionStatus:'supported',
      attributedSubject:'The narrator'}]})})};
 };
}

test('batch 33 B33-6: the Hobbes production pair still inherits — shared predicate content restates the demoted claim',async()=>{
 // Batch-32 phase-2 all-pass1, P1-C1 (context) vs P1-C14
 // (gate-demoted): similarity 0.258, and the overlap is
 // predicative — shared verb-form token "driven", shared content
 // bigram "self sufficient". The recalibrated rule still drops
 // the context claim.
 const draft='PART P1\n'+
  'The narrative is framed as a tale told aboard a yacht at anchor on the river. [S1]\n'+
  b33HobbesDemotedText+' [S1]\n'+b33HobbesContextText;
 const plan={version:'reader-evidence-v2',intent:'explain',
  sources:[{label:'Hobbes and Rousseau',role:'primary',bookIds:['35']}],
  parts:[{id:'P1',question:'How do Hobbes and Rousseau describe the state of nature?',
   sourceBookIds:['35'],searchQueries:['Hobbes Rousseau state of nature'],
   candidateSourceIds:['S1']}],queries:['Hobbes Rousseau state of nature']};
 const ai=batch25RouterAI({
  reviewResponder:b33InheritanceReview({demotedMarker:'socialized passions',spanId:'S1-Q1'}),
  draftText:draft});
 const result=await composeEvidenceAnswer(
  'How do Hobbes and Rousseau describe the state of nature?',
  [hume],ai,[],{plan,catalog,trace:true});
 const inherited=result.trace.contextClaimInheritsDemotion||[];
 assert.equal(inherited.length,1,
  'the Hobbes context claim inherits the demotion');
 assert.ok(Math.abs(inherited[0].similarity-0.258)<0.01,
  'the recorded similarity is the production measurement (0.258)');
 assert.doesNotMatch(result.answer,/fundamentally opposing views/,
  'the restating context claim is dropped');
});

test('batch 33 B33-6: the Narrators production pair no longer inherits — entity overlap alone is topical kinship',async()=>{
 // Batch-32 phase-2 all-pass2, P2-C1 (context) vs P2-C6
 // (gate-demoted): similarity 0.217 — above B32-5's threshold —
 // but the shared tokens are entity/topic nouns only (marlow,
 // listeners, story, darkness, experience): no shared verb-form
 // token, no shared content bigram. The false drop is corrected;
 // the context claim ships.
 const draft='PART P1\n'+
  'The narrative is framed as a tale told aboard a steamer at anchor on the river. [S1]\n'+
  b33NarratorsDemotedText+' [S1]\n'+b33NarratorsContextText;
 const ai=batch25RouterAI({
  reviewResponder:b33InheritanceReview({demotedMarker:'limited vessel',spanId:'S1-Q1'}),
  draftText:draft});
 const source={id:'S1',bookId:'315',title:'Heart of Darkness — Joseph Conrad',
  page:44,url:'https://example.test/conrad#page=44',
  text:'He ordered the helmsman to steer the steamer toward the shore, and the crew, who had been waiting in silence for the signal, moved at once to their stations along the rail.',
  preview:'He ordered the helmsman to steer the steamer toward the shore.'};
 const result=await composeEvidenceAnswer(
  'In Heart of Darkness, what does Marlow do as the steamer approaches the shore?',
  [source],ai,[],{plan:b30ConradPlan,catalog:b30ConradCatalog,trace:true});
 assert.equal(result.trace.contextClaimInheritsDemotion,undefined,
  'no inheritance is recorded for the entity-only overlap');
 assert.match(result.answer,/shapes the narrative/,
  'the context claim ships');
});

// ---------------------------------------------------------------------------
// Batch 33 (B33-3): absent-part disclosure pilots (the partition-drop
// shape is piloted with B33-2 above, on the rewritten salvage test).
// ---------------------------------------------------------------------------

test('batch 33 B33-3: a part emptied at review (context-drop shape) is disclosed in the answer text',async()=>{
 // P2's cited claim is demoted at review and its context claim is
 // not retained: the part ships nothing without any final-audit
 // involvement. Before B33-3 the answer silently omitted the part
 // (the C&P SP2 P3 shape). The disclosure segment names the part's
 // question in the answer text itself.
 const draft='PART P1\n'+
  'Hume explains causal expectation through custom rather than reasoning. [S1]\n'+
  'PART P2\n'+
  'Kant treats causality as an a priori category of the understanding. [S2]\n'+
  'This category is one of the pure concepts that make experience possible.';
 const reviewResponder=({messages})=>{
  const payload=JSON.parse(messages[1].content);
  const partId=payload.parts[0].partId;
  if(partId==='P1'){
   const humeClaim=payload.claims.find(claim=>
    claim.text.includes('causal expectation'));
   return {response:JSON.stringify({parts:[
    {partId:'P1',status:'answered',answerStatus:'answered',
     directAnswerClaimIds:[humeClaim.claimId],retainedContextClaimIds:[]}],
    claims:[
     {claimId:humeClaim.claimId,status:'answered',
      sources:[{sourceId:'S1',status:'answered',spanIds:['S1-Q1'],
       subjectAttributionStatus:'supported',attributedSubject:'Hume'}]}]})};
  }
  const kantClaim=payload.claims.find(claim=>
   claim.text.includes('a priori category'));
  return {response:JSON.stringify({parts:[
   {partId:'P2',status:'partial',answerStatus:'partial',
    directAnswerClaimIds:[],retainedContextClaimIds:[]}],
   claims:[
    {claimId:kantClaim.claimId,status:'partial',
     sources:[{sourceId:'S2',status:'partial',spanIds:['S2-Q1']}]}]})};
 };
 const rescueResponder=({messages})=>{
  const payload=JSON.parse(messages[1].content);
  return {response:JSON.stringify({decisions:payload.decisions.map(item=>({
   claimId:item.claimId,sourceId:item.sourceId,verdict:'not-supported',
   fragment:'',elements:[{element:item.claimText,stated:false}],anchor:''}))})};
 };
 const ai=batch25RouterAI({reviewResponder,rescueResponder,draftText:draft});
 const result=await composeEvidenceAnswer('How do Hume and Kant explain causality?',
  [{...hume,candidatePartIds:['P1','P3']},{...kant,candidatePartIds:['P2','P3']}],ai,[],
  {plan:{...twoSidePlan,intent:'explain',parts:twoSidePlan.parts.slice(0,2)},
   catalog,trace:true});
 assert.match(result.answer,/causal expectation through custom/,
  'the surviving part ships');
 assert.ok(result.answer.includes(
  'This part of the question could not be answered from the library: '+
  'How does Kant explain causal necessity?'),
  'the emptied part is disclosed in the answer text');
 assert.deepEqual(result.trace.final.absentPartLabelsInAnswer,['P2']);
});

test('batch 33 B33-3: a fully shipped answer carries no absent-part disclosure',async()=>{
 const draft='PART P1\nHume explains causal expectation through custom rather than reasoning. [S1]';
 const reviewResponder=({messages})=>{
  const payload=JSON.parse(messages[1].content);
  const claim=payload.claims[0];
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
   answerStatus:'answered',directAnswerClaimIds:[claim.claimId],
   retainedContextClaimIds:[]}],claims:[{claimId:claim.claimId,
   status:'answered',sources:[{sourceId:'S1',status:'answered',
   spanIds:['S1-Q1'],subjectAttributionStatus:'supported',
   attributedSubject:'Hume'}]}]})};
 };
 const ai=batch25RouterAI({reviewResponder,draftText:draft});
 const result=await composeEvidenceAnswer('How does Hume explain causality?',
  [hume],ai,[],{plan:onePartPlan,catalog,trace:true});
 assert.match(result.answer,/causal expectation through custom/);
 assert.equal(result.trace.final.absentPartLabelsInAnswer,undefined);
 assert.doesNotMatch(result.answer,/could not be answered from the library/);
});

// ---------------------------------------------------------------------------
// Batch 33 (B33-8): empty-measurement guard + review-packet plumbing.
// ---------------------------------------------------------------------------

const b33SmithSource={id:'S1',bookId:'260',title:'The Wealth of Nations — Adam Smith',
 page:12,url:'https://example.test/won#page=12',candidatePartIds:['P1'],
 text:'The division of labour improves the dexterity of the workman by reducing his activity to one simple operation. It increases the productive powers of labour by saving the time commonly lost in passing from one species of work to another. The improvement in dexterity also makes the invention of machinery more likely, since the attention is fixed on a single object.',
 preview:'The division of labour improves the dexterity of the workman.'};
const b33SmithPlan={version:'reader-evidence-v2',intent:'explain',
 sources:[{label:'Adam Smith',role:'primary',bookIds:['260']}],
 parts:[{id:'P1',question:'In The Wealth of Nations, how does the division of labour affect the workman?',
  sourceBookIds:['260'],searchQueries:['division of labour dexterity'],
  candidateSourceIds:['S1']}],queries:['division of labour dexterity']};
const b33SmithCatalog={'260':'The Wealth of Nations — Adam Smith'};

test('batch 33 B33-8: an all-uncited part still gets a review packet — the candidate fallback (the Smith SP2 shape)',async()=>{
 // Production shape: the draft's citation groups failed draft
 // validation (rejected sentences) or were never written, so every
 // surviving claim is uncited. Before the fix the review packet
 // for such a part carried zero sources and zero spans (batch 6's
 // cited-only wiring), the reviewer judged an empty view, and the
 // part refused wholesale. The packet now falls back to the part's
 // candidate sources; a reviewer that can see the evidence retains
 // the context claims and the answer ships.
 const draft='PART P1\n'+
  'The division of labour improves the dexterity of the workman by reducing his activity to a single simple operation. [S0]\n'+
  'It increases the productive powers of labour by saving the time commonly lost in passing from one species of work to another.\n'+
  'The improvement in dexterity also makes the invention of machinery more likely, since attention is fixed on a single object.';
 let packetEvidenceCount=-1,packetSpanCount=-1;
 const reviewResponder=({messages})=>{
  const payload=JSON.parse(messages[1].content);
  packetEvidenceCount=payload.parts[0].evidence.length;
  packetSpanCount=payload.parts[0].evidence
   .reduce((total,entry)=>total+entry.spanIds.length,0);
  const contextIds=(payload.parts[0].contextClaims||[]).map(claim=>claim.claimId);
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
   answerStatus:'answered',directAnswerClaimIds:[],
   retainedContextClaimIds:contextIds}],claims:[]})};
 };
 const ai=batch25RouterAI({reviewResponder,draftText:draft});
 const result=await composeEvidenceAnswer(
  'In The Wealth of Nations, how does the division of labour affect the workman?',
  [b33SmithSource],ai,[],{plan:b33SmithPlan,catalog:b33SmithCatalog,trace:true});
 assert.ok(packetEvidenceCount>=1,
  'the review packet carries the candidate source for the all-uncited part');
 assert.ok(packetSpanCount>=1,
  'the review packet carries spans the reviewer can judge against');
 const decisions=result.trace.reviewContract.reviewDecisions;
 assert.ok(decisions.length>=1&&decisions.every(item=>item.accepted),
  'the reviewer judged the claims against real evidence and retained them — no empty-view kills');
 assert.equal(result.trace.reviewContract.supportIssues.some(item=>
  item.reason==='part-level-context-not-supported'),false,
  'no part-level-context-not-supported kills remain for the part');
 // Shipment of this exact shape is then governed by the
 // zero-cited containment rule (an answer with no verified
 // citation still suppresses; B31-1's floor, universal since
 // Stage B's B0) — a separate approved policy, outside B33-8's
 // scope. What B33-8 changes is that the refusal no longer rests
 // on an unmeasured review.
 assert.equal(result.trace.sourceRequiredContainment.disposition,
  'suppressed-no-cited-parts');
});



// ---------------------------------------------------------------------------
// Batch 32 (B32-9): review-contract degradation.
// ---------------------------------------------------------------------------

test('batch 32 B32-9: a contract-incomplete part degrades instead of suppressing the whole answer (the Solitude AP1 shape)',async()=>{
 // Phase-3 baseline, Solitude AP1: two parts; P2's review returned
 // but its contract was incomplete (invalid-status +
 // missing-part-decision in the production trace), and the whole
 // build — including P1's sound, fully reviewed draft — was
 // suppressed ('suppressed-not-strict-minority'). The degraded
 // part now ships nothing and is named; the reviewed part ships.
 const draft='PART P1\nHume explains causal expectation through custom rather than reasoning. [S1]\n'+
  'PART P2\nKant treats causality as a category of relation and a pure conception of the understanding. [S2]';
 const dispatchReviewer=(_model,{messages})=>{
  const payload=parsePayload(messages);
  if(payload.parts[0].partId==='P2')
   // The production defect verbatim in shape: P2's entry is
   // SUPPLIED but its status is not a recognized one ('answers'),
   // so normalizeReview records 'invalid-status' and the part's
   // contract never engages. (B8-5's different shape — a valid
   // entry with SOME claim decisions supplied, a partially
   // fulfilled contract — is deliberately NOT degraded; in a tie
   // it keeps the batch-8 suppression.)
   return {response:JSON.stringify({parts:[{partId:'P2',status:'answers',
    answerStatus:'answered',directAnswerClaimIds:[],retainedContextClaimIds:[]}],
    claims:[]})};
  return review([['P1','answered'],['P2','answered']])(_model,{messages});
 };
 const ai=makeAI([answer(draft),dispatchReviewer,dispatchReviewer]);
 const result=await composeEvidenceAnswer('How do Hume and Kant explain causality?',
  [{...hume,candidatePartIds:['P1','P3']},{...kant,candidatePartIds:['P2','P3']}],ai,[],
  {plan:{...twoSidePlan,intent:'explain',parts:twoSidePlan.parts.slice(0,2)},
   catalog,trace:true});
 assert.notEqual(result.outcome,'generation-failed',
  'the build ships on the reviewed part');
 assert.match(result.answer,/Hume explains causal expectation through custom/,
  'the reviewed part\u2019s cited text ships');
 assert.doesNotMatch(result.answer,/Kant treats causality as a category/,
  'no claims ship from the degraded part');
 assert.deepEqual(result.trace.reviewContractDegradedParts,['P2'],
  'the degradation is traced');
 assert.deepEqual(result.trace.reviewCompletion,
  {totalParts:2,unvalidatedPartIds:['P2'],disposition:'degraded-parts',
   degradedPartCauses:{P2:'review-contract-incomplete'}});
 assert.deepEqual(result.trace.reviewContract.failedParts,
  [{partId:'P2',code:'review-contract-incomplete'}]);
 assert.match(result.missing,/Kant/,
  'the degraded part is named in the missing segments');
 const kantPart=result.questionParts.find(part=>part.partId==='P2');
 assert.equal(kantPart.answerStatus,'unanswered');
 assert.deepEqual(kantPart.claimIds,[]);
});

test('batch 32 B32-9 + Stage B.4: when every part\u2019s contract is incomplete, the fallback ships only the mechanically covered claim',async()=>{
 // B32-9's rule was that degradation never manufactures an answer
 // from nothing reviewed. Stage B.4 supersedes it for exactly this
 // shape: with no validated part, an unvalidated part may still ship
 // the claims that pass the deterministic fallback filter — here the
 // near-verbatim Kant claim — labeled as unreviewed, while the
 // loosely paraphrased Hume claim drops on span coverage and its
 // part renders as unanswered. When NO claim survives, suppression
 // still stands (see the Stage B.4 dialogue test).
 const draft='PART P1\nHume explains causal expectation through custom rather than reasoning. [S1]\n'+
  'PART P2\nKant treats causality as a category of relation and a pure conception of the understanding. [S2]';
 const dispatchReviewer=(_model,{messages})=>{
  const payload=parsePayload(messages);
  const partId=payload.parts[0].partId;
  return {response:JSON.stringify({parts:[{partId,status:'answered',
   answerStatus:'answered',directAnswerClaimIds:[],retainedContextClaimIds:[]}],
   claims:[]})};
 };
 const ai=makeAI([answer(draft),dispatchReviewer,dispatchReviewer]);
 const result=await composeEvidenceAnswer('How do Hume and Kant explain causality?',
  [{...hume,candidatePartIds:['P1','P3']},{...kant,candidatePartIds:['P2','P3']}],ai,[],
  {plan:{...twoSidePlan,intent:'explain',parts:twoSidePlan.parts.slice(0,2)},
   catalog,trace:true});
 assert.equal(result.outcome,'unverified-source-draft');
 assert.deepEqual(result.trace.reviewCompletion,{totalParts:2,
  unvalidatedPartIds:['P1','P2'],disposition:'fallback-unreviewed'});
 assert.deepEqual(result.trace.reviewFallback,[
  {partId:'P1',keptClaimIds:[],dropped:[{claimId:'P1-C1',reason:'span-coverage'}]},
  {partId:'P2',keptClaimIds:['P2-C1'],dropped:[]}]);
 assert.equal(result.trace.reviewContractDegradedParts,undefined,
  'no degradation is recorded when nothing validated');
 assert.ok(result.answer.includes('Kant treats causality as a category of relation'));
 assert.ok(result.answer.includes('This part is presented without a completed source review'));
 assert.ok(!result.answer.includes('Hume explains causal expectation'),
  'the claim that failed the deterministic filter does not ship');
});

// ---------------------------------------------------------------------------
// Batch 32 (B32-10): letter-byline direction + quote rebind.
// ---------------------------------------------------------------------------

const b32LetterSource={id:'S5',bookId:'45',
 title:'Letters — Marcus Tullius Cicero',page:112,
 url:'https://example.test/cicero#page=112',
 text:'Servius Sulpicius To Cicero (At Astura, 5 March). My dear Cicero, I was as much grieved as you could be at the death of Tullia, and I write to urge that the magnitude of a loss should be measured by what it deprives someone of, not merely by its objective importance, for time itself consoles what reason cannot.',
 preview:'Servius Sulpicius To Cicero (At Astura, 5 March).'};
const b32LetterPlan={version:'reader-evidence-v2',intent:'explain',
 sources:[{label:'Marcus Tullius Cicero',role:'primary',bookIds:['45']}],
 parts:[{id:'P1',question:'How is the magnitude of a loss presented in the letter?',
  sourceBookIds:['45'],searchQueries:['letter magnitude of a loss'],
  candidateSourceIds:['S5']}],queries:['letter magnitude of a loss']};
function b32LetterReview(attributedSubject){
 return ({messages})=>{
  const payload=parsePayload(messages);
  const claim=payload.claims[0];
  const spans=buildReviewSpans('S5',b32LetterSource.text);
  const spanId=spans.find(span=>span.text.includes('magnitude of a loss')).spanId;
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
   answerStatus:'answered',directAnswerClaimIds:[claim.claimId],
   retainedContextClaimIds:[]}],
   claims:[{claimId:claim.claimId,status:'answered',
    sources:[{sourceId:'S5',status:'answered',spanIds:[spanId],
     attributionStatus:'supported',
     subjectAttributionStatus:'supported',attributedSubject}]}]})};
 };
}
const b32RescueNotSupported=({messages})=>{
 const payload=JSON.parse(messages[1].content);
 return {response:JSON.stringify({decisions:payload.decisions.map(item=>({
  claimId:item.claimId,sourceId:item.sourceId,verdict:'not-supported',
  fragment:item.spans?.[0]?.text||'no support',
  elements:[{element:item.claimText,stated:false}]}))})};
};


test('batch 32 B32-10 (a) control: a claim crediting the letter\u2019s sender ships',async()=>{
 const claim='Servius Sulpicius, writing to Cicero, suggests that the magnitude of a loss should be measured by what it deprives someone of, not merely by its objective importance.';
 const ai=batch25RouterAI({
  reviewResponder:b32LetterReview('Servius Sulpicius'),
  draftText:'PART P1\n'+claim+' [S5]'});
 const result=await composeEvidenceAnswer(
  'How is the magnitude of a loss presented in the letter?',
  [b32LetterSource],ai,[],{plan:b32LetterPlan,
   catalog:{...catalog,'45':'Letters — Marcus Tullius Cicero'},trace:true});
 const decision=result.trace.reviewContract.reviewDecisions
  .find(item=>item.claimId==='P1-C1'&&item.sourceId==='S5');
 assert.equal(decision.accepted,true,
  'crediting the sender is the letter\u2019s true direction');
 assert.match(result.answer,/magnitude of a loss should be measured/);
});

test('batch 32 B32-10 (b): a quote bound to the wrong source is rebound to the source that holds it verbatim (the "evils and vices" shape)',async()=>{
 // Batch-31 Suffering AP1 died whole (answer-final-integrity-
 // failed) over this configuration: the claim quotes "evils and
 // vices" and cites S3, whose text does not contain the phrase;
 // S1 — an accepted source of the same part — holds it verbatim.
 // The rebind moves the citation group to the holding source and
 // the answer ships instead of suppressing.
 const s1={id:'S1',bookId:'50',title:'On the Shortness of Life — Seneca',
  page:9,url:'https://example.test/seneca#page=9',
  text:'The soul\u2019s proper dignity is diminished by the evils and vices that corrupt it, and a man who guards his time keeps that dignity whole against the theft of empty business.',
  preview:'The soul\u2019s proper dignity is diminished by the evils and vices.'};
 const s3={id:'S3',bookId:'51',title:'Letters — Seneca',
  page:31,url:'https://example.test/seneca-letters#page=31',
  text:'A man who guards his time keeps his dignity whole, and the theft of empty business is the basest of all thefts, for it takes what can never be restored to him.',
  preview:'A man who guards his time keeps his dignity whole.'};
 const plan={version:'reader-evidence-v2',intent:'explain',
  sources:[{label:'Seneca',role:'primary',bookIds:['50','51']}],
  parts:[{id:'P1',question:'How does Seneca describe what corrupts the soul?',
   sourceBookIds:['50','51'],searchQueries:['Seneca evils vices soul'],
   candidateSourceIds:['S1','S3']}],queries:['Seneca evils vices soul']};
 // The production configuration: the DRAFT cites both sources
 // (the check-stage audit passes — S1 holds the quote), and the
 // review accepts only S3's pair, so the rendered citation group
 // narrows to [S3] and the final audit is the first layer to see
 // the mis-binding.
 const reviewResponder=({messages})=>{
  const payload=parsePayload(messages);
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
   answerStatus:'answered',
   directAnswerClaimIds:payload.claims.map(claim=>claim.claimId),
   retainedContextClaimIds:[]}],
   claims:payload.claims.map(claim=>({claimId:claim.claimId,status:'answered',
    sources:claim.sourceIds.map(sourceId=>{
     if(claim.text.includes('evils and vices')&&sourceId==='S1')
      return {sourceId,status:'partial',spanIds:['S1-Q1']};
     return {sourceId,status:'answered',spanIds:[sourceId+'-Q1'],
      subjectAttributionStatus:'supported',attributedSubject:'Seneca'};
    })}))})};
 };
 const draft='PART P1\nSeneca describes the soul\u2019s proper dignity at length. [S1]\n'+
  'The passage calls them "evils and vices" that corrupt the soul. [S1, S3]';
 const ai=batch25RouterAI({reviewResponder,draftText:draft});
 const result=await composeEvidenceAnswer(
  'How does Seneca describe what corrupts the soul?',
  [s1,s3],ai,[],{plan,catalog:{...catalog,'50':'On the Shortness of Life — Seneca',
   '51':'Letters — Seneca'},trace:true});
 assert.notEqual(result.outcome,'generation-failed',
  'the answer ships after the rebind instead of suppressing whole');
 assert.match(result.answer,/"evils and vices" that corrupt the soul\. \[S1\]/,
  'the quote\u2019s citation group now names the holding source');
 const rebinds=result.trace.final.quoteRebinds||[];
 assert.equal(rebinds.length,1);
 assert.equal(rebinds[0].toSourceId,'S1');
 assert.deepEqual(rebinds[0].fromSourceIds,['S3']);
 assert.equal(rebinds[0].mode,'replace');
});

// ---------------------------------------------------------------------------
// Batch 34 (B34-1): context-support redesign (layer 1) + assembly
// antecedent guard (layer 2). Fixtures carry the production claim
// texts from the batch-33 artifacts (phase-2 Narrators AP2 P3,
// phase-3 Solitude P1, phase-2 Science AP1 P1, batch-31 Dostoevsky
// SP2 via the B32-5 fixture); demoted context-claim texts are the
// audit records' claimText values verbatim.
// ---------------------------------------------------------------------------

const b34UmSource={id:'S1',bookId:'184',
 title:'Notes from the Underground — Fyodor Dostoevsky',page:22,
 url:'https://example.test/underground#page=22',
 text:'I am a sick man. I am a spiteful man. I am an unattractive man. To be excessively conscious is an illness, a real, thorough illness; for ordinary human life even half that consciousness would be more than enough. I have lived in my corner, suffering mockery and humiliation in my own soul, and I have intentionally turned every feeling into its opposite, taking refuge in irony and spite, in the inertia of a man who cannot become even an insect.',
 preview:'I am a sick man. I am a spiteful man.'};
const b34MarlowSource={id:'S2',bookId:'315',
 title:'Heart of Darkness — Joseph Conrad',page:43,
 url:'https://example.test/conrad#page=43',
 text:'It seems to me that I am trying to tell you a dream, making a vain attempt, because no relation of a dream can convey the dream-sensation, that commingling of absurdity, surprise, and bewilderment which is of the very essence of dreams. It is impossible to convey the life-sensation of any given epoch of one\u2019s existence; what makes its truth, its meaning, its subtle and penetrating essence is impossible. We live, as we dream, alone.',
 preview:'It seems to me that I am trying to tell you a dream.'};
const b34NarratorsPlan={version:'reader-evidence-v2',intent:'explain',
 sources:[{label:'Fyodor Dostoevsky',role:'primary',bookIds:['184']},
  {label:'Joseph Conrad',role:'primary',bookIds:['315']}],
 parts:[{id:'P1',question:'How does the Underground Man shape and limit what the reader can conclude?',
   sourceBookIds:['184'],searchQueries:['Underground Man consciousness'],
   candidateSourceIds:['S1']},
  {id:'P2',question:'How does Marlow shape and limit what the reader can conclude?',
   sourceBookIds:['315'],searchQueries:['Marlow dream sensation'],
   candidateSourceIds:['S2']},
  {id:'P3',question:'How do the Underground Man and Marlow contrast as narrators?',
   sourceBookIds:['184','315'],searchQueries:['narrator contrast unreliability'],
   candidateSourceIds:['S1','S2']}],queries:['narrators']};
const b34NarratorsCatalog={...catalog,
 '184':'Notes from the Underground — Fyodor Dostoevsky',
 '315':'Heart of Darkness — Joseph Conrad'};
// Production P3 claim texts (phase-2 batch-33 Narrators AP2).
const b34P3C1='The relationship between the Underground Man and Marlow is one of contrast in the source of their narrative unreliability: Dostoevsky utilizes psychological unreliability, whereas Conrad utilizes observational and structural mediation.';
const b34P3C2='The Underground Man\u2019s unreliability is internal and volitional.';
const b34P3C3='He shapes the narrative by intentionally distorting his own psyche, using his "consciousness" to create complexity and doubt where others seek simplicity.';
const b34P3C4='He limits the reader by being an unreliable witness to his own soul, making it impossible to distinguish between his true suffering and his "mockery".';
const b34P3C5='His mechanism is one of active, self-conscious subversion of meaning.';
const b34P3C6='In contrast, Marlow\u2019s unreliability is external and epistemological.';
const b34P3C7='He shapes the narrative by filtering reality through the lens of a "dream-sensation," prioritizing the "feeling" of an event over its literal mechanics.';
const b34P3C8='He limits the reader not through self-deception, but through the admitted inadequacy of language and the overwhelming "darkness" of the truths he encounters.';
const b34P3C9='While the Underground Man limits the reader by being too deeply embedded in his own distorted ego, Marlow limits the reader by standing at the edge of an experience that he finds fundamentally unutterable.';
const b34P3C10='Ultimately, the Underground Man limits the reader through the chaotic instability of the self, while Marlow limits the reader through the impenetrable nature of the external world.';
function b34NarratorsDraft(p3C9){
 // Each claim is its own paragraph (blank-line separated), as in
 // the production draft: the orphan claims shipped as standalone
 // bare-"He" paragraphs.
 return 'PART P1\n'+
  'The Underground Man introduces himself as a sick and spiteful man whose excessive consciousness distorts everything he reports. [S1]\n\n'+
  'PART P2\n'+
  'Marlow shapes his tale as a dream he cannot fully convey, warning his listeners that the sensation of the events escapes language. [S2]\n\n'+
  'PART P3\n'+
  [b34P3C1,b34P3C2,b34P3C3+' [S1]',b34P3C4+' [S1]',b34P3C5,b34P3C6,
   b34P3C7+' [S2]',b34P3C8+' [S2]',p3C9,b34P3C10].join('\n\n');
}
function b34NarratorsReview({messages}){
 const payload=parsePayload(messages);
 const spanByFragment=fragment=>payload.spanCatalog
  .find(entry=>entry.text.includes(fragment))?.spanId;
 const rules=[
  {marker:'sick and spiteful man whose excessive',sourceId:'S1',
   fragment:'excessively conscious',subject:'Underground Man'},
  {marker:'dream he cannot fully convey',sourceId:'S2',
   fragment:'dream-sensation',subject:'Marlow'},
  {marker:'intentionally distorting his own psyche',sourceId:'S1',
   fragment:'excessively conscious',subject:'Underground Man'},
  {marker:'unreliable witness to his own soul',sourceId:'S1',
   fragment:'mockery',subject:'Underground Man'},
  {marker:'filtering reality through the lens',sourceId:'S2',
   fragment:'dream-sensation',subject:'Marlow'},
  {marker:'admitted inadequacy of language',sourceId:'S2',
   fragment:'impossible to convey',subject:'Marlow'}];
 const claims=payload.claims.map(claim=>{
  const rule=rules.find(item=>claim.text.includes(item.marker));
  if(!rule)throw new Error('unmapped claim in B34 fixture: '+claim.text.slice(0,60));
  return {claimId:claim.claimId,status:'answered',
   sources:[{sourceId:rule.sourceId,status:'answered',
    spanIds:[spanByFragment(rule.fragment)],
    subjectAttributionStatus:'supported',attributedSubject:rule.subject,
    attributedSpeaker:rule.subject}]};
 });
 const parts=payload.parts.map(part=>({partId:part.partId,status:'answered',
  answerStatus:'answered',
  directAnswerClaimIds:payload.claims
   .filter(claim=>claim.claimId.startsWith(part.partId+'-'))
   .map(claim=>claim.claimId),
  retainedContextClaimIds:[]}));
 return {response:JSON.stringify({parts,claims})};
}
const b34RescueRefused=({messages})=>{
 const payload=JSON.parse(messages[1].content);
 return {response:JSON.stringify({decisions:payload.decisions.map(item=>({
  claimId:item.claimId,sourceId:item.sourceId,verdict:'not-supported',
  fragment:item.spans[0].text,
  elements:[{element:item.claimText,stated:false}]}))})};
};
function b34ClaimIdByText(result,prefix){
 const decision=result.trace.reviewContract.reviewDecisions
  .find(item=>(item.claimText||'').startsWith(prefix));
 return decision?.claimId;
}






test('batch 34 B34-1 pilot (e): a framing-shaped claim smuggling a new actor, date, and quotation still demotes',async()=>{
 const draft='PART P1\n'+
  'In 1849, Kurtz wrote that "the horror alone" explained the darkness waiting upriver.\n'+
  'Marlow shapes his tale as a dream he cannot fully convey, warning his listeners that the sensation of the events escapes language. [S1]\n'+
  'He limits the reader by admitting that the life-sensation of an epoch cannot be conveyed at all. [S1]';
 const source={...b34MarlowSource,id:'S1'};
 const plan={version:'reader-evidence-v2',intent:'explain',
  sources:[{label:'Joseph Conrad',role:'primary',bookIds:['315']}],
  parts:[{id:'P1',question:'How does Marlow shape and limit what the reader can conclude?',
   sourceBookIds:['315'],searchQueries:['Marlow dream sensation'],
   candidateSourceIds:['S1']}],queries:['marlow']};
 const reviewResponder=({messages})=>{
  const payload=parsePayload(messages);
  const span=payload.spanCatalog[0];
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
   answerStatus:'answered',
   directAnswerClaimIds:payload.claims.map(claim=>claim.claimId),
   retainedContextClaimIds:[]}],
   claims:payload.claims.map(claim=>({claimId:claim.claimId,status:'answered',
    sources:[{sourceId:'S1',status:'answered',spanIds:[span.spanId],
     subjectAttributionStatus:'supported',attributedSubject:'Marlow'}]}))})};
 };
 const ai=batch25RouterAI({reviewResponder,rescueResponder:b34RescueRefused,
  draftText:draft});
 const result=await composeEvidenceAnswer(
  'How does Marlow shape and limit what the reader can conclude?',
  [source],ai,[],{plan,catalog:b34NarratorsCatalog,trace:true});
 assert.doesNotMatch(result.answer,/1849/);
 assert.doesNotMatch(result.answer,/the horror alone/);
 const smuggledId=b34ClaimIdByText(result,'In 1849, Kurtz wrote');
 assert.ok(!(result.trace.reviewContract.framingRescues||[])
  .some(entry=>entry.claimId===smuggledId));
 assert.match(result.answer,/Marlow shapes his tale as a dream/);
});

test('batch 34 B34-1 pilot (f) control: a pronoun genuinely continuing the previous subject ships byte-unchanged',async()=>{
 const draft='PART P1\n'+
  'Marlow shapes his tale as a dream he cannot fully convey, warning his listeners that the sensation of the events escapes language. [S1]\n'+
  'He limits the reader by admitting that the life-sensation of an epoch cannot be conveyed at all. [S1]';
 const source={...b34MarlowSource,id:'S1'};
 const plan={version:'reader-evidence-v2',intent:'explain',
  sources:[{label:'Joseph Conrad',role:'primary',bookIds:['315']}],
  parts:[{id:'P1',question:'How does Marlow shape and limit what the reader can conclude?',
   sourceBookIds:['315'],searchQueries:['Marlow dream sensation'],
   candidateSourceIds:['S1']}],queries:['marlow']};
 const reviewResponder=({messages})=>{
  const payload=parsePayload(messages);
  const span=payload.spanCatalog[0];
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
   answerStatus:'answered',
   directAnswerClaimIds:payload.claims.map(claim=>claim.claimId),
   retainedContextClaimIds:[]}],
   claims:payload.claims.map(claim=>({claimId:claim.claimId,status:'answered',
    sources:[{sourceId:'S1',status:'answered',spanIds:[span.spanId],
     subjectAttributionStatus:'supported',attributedSubject:'Marlow'}]}))})};
 };
 const ai=batch25RouterAI({reviewResponder,rescueResponder:b34RescueRefused,
  draftText:draft});
 const result=await composeEvidenceAnswer(
  'How does Marlow shape and limit what the reader can conclude?',
  [source],ai,[],{plan,catalog:b34NarratorsCatalog,trace:true});
 assert.match(result.answer,
  /He limits the reader by admitting that the life-sensation of an epoch cannot be conveyed at all\./,
  'the continuing pronoun ships exactly as composed');
 assert.equal(result.trace.assemblyAntecedentGuard,undefined,
  'the guard does not fire on a genuine continuation');
});


test('batch 34 B34-2 (ii): a source-required claim shipping uncited inside a cited part labels the part',async()=>{
 // The Faust shape: the part renders a citation, so B33-3's
 // part-level test stays silent, while the wager CONDITION — a
 // direct-answer and requirement claim — ships with no citation
 // at all. The claim-level test labels the part; the allowance
 // context claim in the same part (neither direct-answer nor
 // requirement) ships unlabeled and is not named.
 const faust={id:'S1',bookId:'888',title:'Faust — Johann Wolfgang von Goethe',page:44,
  url:'https://example.test/faust#page=44',
  text:'Faust speaks in the study: first let us agree the pact itself, '+
   'Mephistopheles, and strike the bargain here, and let the terms be set '+
   'down before any condition is named between us.',
  preview:'Faust speaks in the study: first let us agree the pact itself.'};
 const b34Plan={version:'reader-evidence-v2',intent:'explain',
  sources:[{label:'Johann Wolfgang von Goethe',role:'primary',bookIds:['888']}],
  parts:[{id:'P1',question:'What is the condition of the wager Faust makes?',
   sourceBookIds:['888'],searchQueries:['Faust wager condition'],candidateSourceIds:['S1'],
   sourceRequired:true,
   requirements:[{id:'P1-R1',text:'State the condition on which Faust forfeits his soul.'}]}],
  queries:['Faust wager condition']};
 const draft='PART P1\n'+
  'In the study, Faust proposes the pact to Mephistopheles and agrees to strike the bargain there. [S1]\n\n'+
  'The wager\u2019s condition is that if Faust ever bids the passing moment stay, saying it is fair, that moment will be his last and his soul forfeit.\n\n'+
  'Goethe reworked the older Faust chapbooks, whose hero was damned outright, into this drama of striving.';
 const reviewResponder=({messages})=>{
  const payload=parsePayload(messages);
  const span=payload.spanCatalog.find(entry=>entry.text.includes('strike the bargain'));
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
    answerStatus:'answered',directAnswerClaimIds:['P1-C1','P1-C2'],
    retainedContextClaimIds:['P1-C2','P1-C3'],
    requirementCoverage:[{requirementId:'P1-R1',status:'answered',
     answerClaimIds:['P1-C1','P1-C2']}]}],
   claims:[{claimId:'P1-C1',status:'answered',
    attributedSubject:'Faust',attributedSpeaker:'Faust',
    sources:[{sourceId:'S1',status:'answered',spanIds:[span.spanId]}]}]})};
 };
 const ai=batch25RouterAI({reviewResponder,rescueResponder:b34RescueRefused,
  repairResponder:({messages})=>({response:JSON.stringify({parts:[]})}),
  draftText:draft});
 const result=await composeEvidenceAnswer(
  'What is the condition of the wager Faust makes?',[faust],ai,[],{
  plan:b34Plan,trace:true,catalog:{888:'Faust — Johann Wolfgang von Goethe'}});
 assert.match(result.answer,/wager\u2019s condition is that if Faust ever bids the passing moment stay/,
  'the uncited condition claim still ships — labeled, not deleted');
 assert.match(result.answer,/Retrieved passages could not be verified as supporting this part of the question: What is the condition of the wager Faust makes\?/,
  'the part carries the claim-level disclosure label');
 assert.deepEqual(result.trace.final?.claimLevelUncitedLabels,
  [{partId:'P1',claimIds:['P1-C2']}],
  'only the source-required claim is named — the allowance claim is not');
 assert.match(result.answer,/drama of striving/,
  'the general-knowledge allowance claim ships unlabeled in the same part');
 assert.doesNotMatch(result.answer,/could not be answered from the library/,
  'no absent-part label: the part did ship');
 assert.deepEqual(result.trace.assemblyDisclosureDropped,[]);
});

test('batch 34 B34-1 layer 2 unit: a rescued framing claim from an earlier draft position is restored before its orphan; a later one is not pulled forward',()=>{
 const parts=[{part:{id:'P3'},status:'partial',answerStatus:'partial',
  evidence:[],
  answers:[
   {claimId:'P3-C1',text:'Marlow shapes the narrative through the dream-sensation of his voyage.',
    renderedText:'Marlow shapes the narrative through the dream-sensation of his voyage.',
    sourceIds:['S3'],paragraphIndex:0},
   {claimId:'P3-C3',text:'He shapes the narrative by intentionally distorting his own psyche.',
    renderedText:'He shapes the narrative by intentionally distorting his own psyche.',
    sourceIds:['S6'],paragraphIndex:1}]}];
 const decisions=[{partId:'P3',claimId:'P3-C3',sourceId:'S6',
  attributedSubject:'Underground Man'}];
 const framing={claimId:'P3-C2',
  text:'The Underground Man\u2019s unreliability is internal and volitional.',
  renderedText:'The Underground Man\u2019s unreliability is internal and volitional.',
  sourceIds:[],paragraphIndex:0};
 const actions=applyAssemblyAntecedentGuard(parts,{reviewDecisions:decisions,
  restorable:[{partId:'P3',claimId:'P3-C2',answer:framing}]});
 assert.deepEqual(actions.restored,[{partId:'P3',claimId:'P3-C2',
  forClaimId:'P3-C3'}]);
 assert.deepEqual(parts[0].answers.map(answer=>answer.claimId),
  ['P3-C1','P3-C2','P3-C3'],
  'the framing claim is restored directly before the orphan, in its own part');
 assert.equal(parts[0].answers[1].paragraphIndex,1,
  'the restored claim joins the orphan\u2019s paragraph');
 // Position discipline: the same framing claim numbered AFTER the
 // orphan (a closing synthesis) is never pulled forward — the
 // orphan falls to the deterministic rewrite instead.
 const parts2=[{part:{id:'P3'},status:'partial',answerStatus:'partial',
  evidence:[],
  answers:[
   {claimId:'P3-C1',text:'Marlow shapes the narrative through the dream-sensation of his voyage.',
    renderedText:'Marlow shapes the narrative through the dream-sensation of his voyage.',
    sourceIds:['S3'],paragraphIndex:0},
   {claimId:'P3-C3',text:'He shapes the narrative by intentionally distorting his own psyche.',
    renderedText:'He shapes the narrative by intentionally distorting his own psyche.',
    sourceIds:['S6'],paragraphIndex:1}]}];
 const actions2=applyAssemblyAntecedentGuard(parts2,{reviewDecisions:decisions,
  restorable:[{partId:'P3',claimId:'P3-C9',answer:{...framing,claimId:'P3-C9'}}]});
 assert.deepEqual(actions2.restored,[]);
 assert.deepEqual(actions2.rewritten,[{partId:'P3',claimId:'P3-C3',
  subject:'Underground Man'}]);
 assert.match(parts2[0].answers[1].text,/^Underground Man shapes the narrative/);
});

const b34GatsbySource={id:'S1',bookId:'301',
 title:'The Great Gatsby — F. Scott Fitzgerald',page:112,
 url:'https://example.test/gatsby#page=112',
 text:'Gatsby took out a pile of shirts and began throwing them, one by one, before us, shirts of sheer linen and thick silk and fine flannel, which lost their folds as they fell and covered the table in many-colored disarray. Daisy bent her head into the shirts and began to cry, “It makes me sad because I’ve never seen such — such beautiful shirts before.”',
 preview:'Gatsby took out a pile of shirts and began throwing them.'};
const b34GatsbyBoundary='The span describes Daisy crying over the beautiful shirts, which is part of the witnessed scene.';
const b34GatsbyPlan={version:'reader-evidence-v2',intent:'explain',
 sources:[{label:'F. Scott Fitzgerald',role:'primary',bookIds:['301']}],
 parts:[{id:'P1',question:'In The Great Gatsby, how does Daisy react to the display of wealth?',
  sourceBookIds:['301'],searchQueries:['Gatsby shirts Daisy'],candidateSourceIds:['S1']}],
 queries:['Gatsby shirts']};
const b34GatsbyCatalog={301:'The Great Gatsby — F. Scott Fitzgerald'};
function b34GatsbyReview({c2Subject='Gatsby',c2Boundary=b34GatsbyBoundary}={}){
 return ({messages})=>{
  const payload=parsePayload(messages);
  const spanByFragment=fragment=>payload.spanCatalog
   .find(entry=>entry.text.includes(fragment))?.spanId;
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
    answerStatus:'answered',
    directAnswerClaimIds:payload.claims.map(claim=>claim.claimId),
    retainedContextClaimIds:[]}],
   claims:payload.claims.map(claim=>{
    if(claim.text.includes('shirt after shirt'))return {claimId:claim.claimId,
     status:'answered',attributedSubject:'Gatsby',attributedSpeaker:'',
     sources:[{sourceId:'S1',status:'answered',
      spanIds:[spanByFragment('pile of shirts')],
      subjectAttributionStatus:'supported',attributedSubject:'Gatsby',
      attributedSpeaker:'',supportBoundary:'The span shows Gatsby throwing the shirts before his guests.'}]};
    return {claimId:claim.claimId,status:'answered',
     attributedSubject:c2Subject,attributedSpeaker:'',
     sources:[{sourceId:'S1',status:'answered',
      spanIds:[spanByFragment('never seen such')],
      subjectAttributionStatus:'supported',attributedSubject:c2Subject,
      attributedSpeaker:'',supportBoundary:c2Boundary}]};
   })})};
 };
}





test('batch 34 B34-3 controls: correct subject, different action, and silent boundary all ship unchanged',async()=>{
 // (a) The same span and boundary with the claim correctly naming
 // Daisy: the boundary names the claim's own subject — no swap.
 const draftA='PART P1\n'+
  'Gatsby throws shirt after shirt before his guests, shirts of sheer linen and thick silk and fine flannel. [S1]\n\n'+
  'He also witnesses the overwhelming impact of Gatsby’s luxury, such as the “beautiful shirts” that move Daisy to tears. [S1]';
 const aiA=batch25RouterAI({reviewResponder:b34GatsbyReview({c2Subject:'Daisy'}),
  rescueResponder:b34RescueRefused,
  repairResponder:({messages})=>({response:JSON.stringify({parts:[]})}),
  assemblyAuditResponder:({messages})=>({response:JSON.stringify({
   parts:parsePayload(messages).parts.map(part=>({partId:part.partId,action:'none'}))})}),
  draftText:draftA});
 const resultA=await composeEvidenceAnswer(
  'In The Great Gatsby, how does Daisy react to the display of wealth?',
  [b34GatsbySource],aiA,[],{plan:b34GatsbyPlan,catalog:b34GatsbyCatalog,trace:true});
 assert.match(resultA.answer,/move Daisy to tears/,
  'control (a): the correctly-attributed claim ships');
 assert.deepEqual(resultA.trace.reviewContract?.boundarySubjectChecks||[],[],
  'control (a): no swap recorded');
 // (b) A claim about a different action in the same span: Gatsby
 // displaying the shirts. The boundary's Daisy/crying association
 // does not match the claim's action — no swap.
 const draftB='PART P1\n'+
  'Gatsby displays the beautiful shirts from his wardrobe for his guests. [S1]';
 const reviewB=({messages})=>{
  const payload=parsePayload(messages);
  const span=payload.spanCatalog.find(entry=>entry.text.includes('pile of shirts'));
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
    answerStatus:'answered',directAnswerClaimIds:['P1-C1'],
    retainedContextClaimIds:[]}],
   claims:[{claimId:'P1-C1',status:'answered',attributedSubject:'Gatsby',
    attributedSpeaker:'',
    sources:[{sourceId:'S1',status:'answered',spanIds:[span.spanId],
     subjectAttributionStatus:'supported',attributedSubject:'Gatsby',
     attributedSpeaker:'',supportBoundary:b34GatsbyBoundary}]}]})};
 };
 const aiB=batch25RouterAI({reviewResponder:reviewB,
  rescueResponder:b34RescueRefused,
  repairResponder:({messages})=>({response:JSON.stringify({parts:[]})}),
  assemblyAuditResponder:({messages})=>({response:JSON.stringify({
   parts:parsePayload(messages).parts.map(part=>({partId:part.partId,action:'none'}))})}),
  draftText:draftB});
 const resultB=await composeEvidenceAnswer(
  'In The Great Gatsby, how does Daisy react to the display of wealth?',
  [b34GatsbySource],aiB,[],{plan:b34GatsbyPlan,catalog:b34GatsbyCatalog,trace:true});
 assert.match(resultB.answer,/Gatsby displays the beautiful shirts/,
  'control (b): the different-action claim ships');
 assert.deepEqual(resultB.trace.reviewContract?.boundarySubjectChecks||[],[],
  'control (b): no swap recorded');
 // (c) The pilot-1 swap claim with a boundary that records no
 // subject: record-dependence — behavior is unchanged and the
 // claim ships exactly as it did before this batch.
 const draftC='PART P1\n'+
  'Gatsby throws shirt after shirt before his guests, shirts of sheer linen and thick silk and fine flannel. [S1]\n\n'+
  'He also witnesses the overwhelming impact of Gatsby’s luxury, such as the “beautiful shirts” that move Gatsby to tears. [S1]';
 const aiC=batch25RouterAI({reviewResponder:b34GatsbyReview({
   c2Boundary:'The span covers the wardrobe scene during the mansion tour in detail.'}),
  rescueResponder:b34RescueRefused,
  repairResponder:({messages})=>({response:JSON.stringify({parts:[]})}),
  assemblyAuditResponder:({messages})=>({response:JSON.stringify({
   parts:parsePayload(messages).parts.map(part=>({partId:part.partId,action:'none'}))})}),
  draftText:draftC});
 const resultC=await composeEvidenceAnswer(
  'In The Great Gatsby, how does Daisy react to the display of wealth?',
  [b34GatsbySource],aiC,[],{plan:b34GatsbyPlan,catalog:b34GatsbyCatalog,trace:true});
 assert.match(resultC.answer,/move Gatsby to tears/,
  'control (c): with no subject in the record, the claim ships as before');
 assert.deepEqual(resultC.trace.reviewContract?.boundarySubjectChecks||[],[],
  'control (c): no swap recorded');
});

test('batch 34 B34-6 pilot (Wuthering): accepted claims lost to containment and the partial gate are reconciled, and a containment-dropped disclosure is not restored',async()=>{
 // Production shape, verbatim in structure: the split retry recovered
 // and judged every cited claim; the loss is downstream. C5/C9/C10 are
 // accepted UNCITED context claims restating rejected draft claims
 // (C11/C12/C13, archived by the initial review) at overlap >= 0.5,
 // so rejection containment drops them; C6 is cited, its source
 // accepted, but the reviewer judged it 'partial' with no narrowing,
 // so normalizeReview never puts it in the part's answers while the
 // contract still records accepted:true. C10 is also an absence
 // disclosure: B34-2 must NOT restore it (it restates a rejection).
 const wuthering={id:'S1',bookId:'123',title:'Wuthering Heights — Emily Brontë',
  page:100,url:'https://example.test/wuthering#page=100',
  text:'Catherine accused Nelly of being her hidden enemy and a traitor before the whole household. During a moment of intense distress, Catherine claimed that Nelly played traitor by encouraging Mr. Linton to harass her. Nelly presented herself as a neutral observer while managing the household affairs and maintaining personal relationships with the various masters and mistresses. Nelly defended her actions as those of a faithful servant in response to the accusations. Nelly spoke at length about the household routines and the daily management of the estate. The household accounts record the visitors who called during that winter. Lockwood noted the arrangement of the rooms when he first arrived.',
  preview:'Catherine accused Nelly of being her hidden enemy.'};
 const plan={version:'reader-evidence-v2',intent:'explain',
  sources:[{label:'Emily Brontë',role:'primary',bookIds:['123']}],
  parts:[{id:'P1',question:'Where does Wuthering Heights give the reader reason to doubt Nelly\'s version of events?',
   sourceBookIds:['123'],searchQueries:['Nelly reliability doubt'],
   candidateSourceIds:['S1'],
   requirements:[{id:'P1-R1',text:'Identify textual evidence or narrative inconsistencies that undermine Nelly Dean\'s reliability'}]}],
  queries:['Nelly reliability']};
 const draft='PART P1\n'+
  'The novel gives the reader several reasons to doubt Nelly Dean, suggesting that her version of events may be colored by personal bias.\n\n'+
  'The most explicit reason to doubt Nelly is provided by Catherine herself, who accuses her of being a "hidden enemy" and a "traitor". [S1]\n\n'+
  'During a moment of intense distress, Catherine claims that Nelly played traitor by encouraging Mr. Linton to harass her. [S1]\n\n'+
  'These accusations frame the deeper inconsistencies in Nelly\'s account.\n\n'+
  '**Narrative Subjectivity and Omission** Nelly\'s reliability is further undermined by her tendency to judge the characters she describes. Nelly openly mocks Catherine\'s grief and calls Heathcliff a brute in her narration.\n\n'+
  '**Inconsistencies in Perspective** While Nelly presents herself as a neutral observer, her involvement in the household\'s management and her personal relationships with the various masters and mistresses place her in a position of conflict of interest. [S1]\n\n'+
  'Her desire to be seen as a "faithful servant" may lead her to sanitize her own role in the unfolding tragedies. [S1]\n\n'+
  'The novel undermines Nelly\'s reliability through Catherine\'s direct accusations of betrayal and through Nelly\'s own admitted practice of selectively sharing information.\n\n'+
  'The reader may also doubt Nelly\'s reliability because she admits to withholding or filtering information. Nelly hides Catherine\'s letters from Edgar and burns Heathcliff\'s notes.\n\n'+
  'The passages do not describe Nelly filtering the information she passed to Heathcliff. Nelly invents whole conversations between Catherine and Heathcliff.\n\n'+
  'Nelly openly mocks Catherine\'s grief and calls Heathcliff a brute in her narration. [S1]\n\n'+
  'Nelly hides Catherine\'s letters from Edgar and burns Heathcliff\'s notes. [S1]\n\n'+
  'Nelly invents whole conversations between Catherine and Heathcliff. [S1]';
 const reviewResponder=({messages})=>{
  const payload=parsePayload(messages);
  const spanByFragment=fragment=>payload.spanCatalog
   .find(entry=>entry.text.includes(fragment))?.spanId;
  const entryFor=claim=>{
   const text=claim.text;
   const source={sourceId:'S1',status:'answered',attributionStatus:'supported',
    attributedSubject:'',attributedSpeaker:''};
   if(text.includes('hidden enemy'))return {claimId:claim.claimId,status:'answered',
    attributedSubject:'',attributedSpeaker:'',
    sources:[{...source,spanIds:[spanByFragment('hidden enemy')],
     supportBoundary:'The spans show Catherine accusing Nelly of being a hidden enemy and a traitor.'}]};
   if(text.includes('intense distress'))return {claimId:claim.claimId,status:'answered',
    attributedSubject:'',attributedSpeaker:'',
    sources:[{...source,spanIds:[spanByFragment('intense distress')],
     supportBoundary:'The spans show Catherine claiming Nelly played traitor during a moment of distress.'}]};
   if(text.includes('neutral observer'))return {claimId:claim.claimId,status:'partial',
    attributedSubject:'',attributedSpeaker:'',
    sources:[{...source,spanIds:[spanByFragment('neutral observer')],
     supportBoundary:'The spans show Nelly\'s active role in managing affairs and her interactions with various characters, but do not explicitly state a \'conflict of interest\'.'}]};
   // The rejected claims' propositions appear in NO span of the
   // packet (that is what makes them rejected rather than
   // companion-restored): give them a valid but unrelated span.
   const rejected={claimId:claim.claimId,status:'unanswered',
    attributedSubject:'',attributedSpeaker:'',
    sources:[{sourceId:'S1',status:'unanswered',
     spanIds:[spanByFragment('neutral observer')],
     attributionStatus:'unsupported',subjectAttributionStatus:'unsupported',
     attributedSubject:'',attributedSpeaker:'',
     supportBoundary:'The spans do not support this claim.'}]};
   return rejected;
  };
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
    answerStatus:'answered',directAnswerClaimIds:['P1-C2','P1-C3'],
    retainedContextClaimIds:['P1-C1','P1-C4','P1-C5','P1-C8','P1-C9','P1-C10'],
    requirementCoverage:[{requirementId:'P1-R1',status:'answered',
     answerClaimIds:['P1-C2','P1-C3']}]}],
   claims:payload.claims.map(entryFor)})};
 };
 const ai=batch25RouterAI({reviewResponder,rescueResponder:b34RescueRefused,
  repairResponder:({messages})=>({response:JSON.stringify({parts:[]})}),
  assemblyAuditResponder:({messages})=>({response:JSON.stringify({
   parts:parsePayload(messages).parts.map(part=>({partId:part.partId,action:'none'}))})}),
  draftText:draft});
 const result=await composeEvidenceAnswer(
  'Where does Wuthering Heights give the reader reason to doubt Nelly\'s version of events?',
  [wuthering],ai,[],{plan,catalog:{123:'Wuthering Heights — Emily Brontë'},trace:true});
 assert.match(result.answer,/several reasons to doubt Nelly Dean/,
  'the retained intro still ships');
 assert.match(result.answer,/hidden enemy/,
  'the direct-answer treachery claim still ships');
 assert.match(result.answer,/intense distress/,
  'the direct-answer distress claim still ships');
 assert.match(result.answer,/deeper inconsistencies/,
  'the retained bridge still ships');
 assert.match(result.answer,/direct accusations of betrayal/,
  'the retained conclusion still ships');
 assert.doesNotMatch(result.answer,/Subjectivity/,
  'the containment-dropped section does not ship');
 assert.doesNotMatch(result.answer,/neutral observer/,
  'the partial-gated section does not ship');
 assert.doesNotMatch(result.answer,/hides Catherine's letters/,
  'the containment-dropped withholding evidence does not ship');
 assert.doesNotMatch(result.answer,/do not describe Nelly filtering/,
  'the containment-dropped disclosure does not ship');
 const containment=result.trace.rejectionContainment||[];
 assert.equal(containment.filter(entry=>entry.claimId==='P1-C5').length,1,
  'containment recorded the Subjectivity drop');
 assert.equal(containment.filter(entry=>entry.claimId==='P1-C9').length,1,
  'containment recorded the withholding drop');
 assert.equal(containment.filter(entry=>entry.claimId==='P1-C10').length,1,
  'containment recorded the disclosure drop');
 const losses=result.trace.assemblyLoss||[];
 const lossFor=claimId=>losses.find(entry=>entry.claimId===claimId);
 assert.equal(losses.length,4,'four accepted claims are unshipped');
 assert.deepEqual(lossFor('P1-C5'),
  {partId:'P1',claimId:'P1-C5',reason:'rejection-containment',disposition:'traced'},
  'the Subjectivity loss is reconciled as containment');
 assert.deepEqual(lossFor('P1-C9'),
  {partId:'P1',claimId:'P1-C9',reason:'rejection-containment',disposition:'traced'},
  'the withholding loss is reconciled as containment');
 assert.deepEqual(lossFor('P1-C10'),
  {partId:'P1',claimId:'P1-C10',reason:'rejection-containment',disposition:'traced'},
  'the disclosure loss is reconciled as containment');
 assert.deepEqual(lossFor('P1-C6'),
  {partId:'P1',claimId:'P1-C6',reason:'claim-partial-not-shipped',disposition:'traced'},
  'the partial-gated loss is reconciled as the ship-gate, not unexplained; '+
  'this fixture is the ambiguous case a verdict gate must not act on (the '+
  'source decision accepted while the reviewer boundary denies the claim’s '+
  '‘conflict of interest’ framing)');
 assert.equal((result.trace.assemblyDisclosureRestored||[])
  .some(entry=>entry.claimId==='P1-C10'),false,
  'B34-2 does not restore a containment-dropped disclosure');
 assert.deepEqual(result.trace.assemblyDisclosureDropped||[],[],
  'no disclosure claim is silently dropped');
});

test('batch 34 B34-6 reconcileAssemblyLoss: unexplained losses restore when clean, withhold on rejection overlap, and cap the part when unrestorable',async()=>{
 const baseParts=()=>[{part:{id:'P1'},
  answers:[{claimId:'P1-C1',text:'The opening claim about Nelly Dean.',
   renderedText:'The opening claim about Nelly Dean.',sourceIds:['S1'],paragraphIndex:0}],
  answerStatus:'answered'}];
 const cleanDecision={partId:'P1',claimId:'P1-C2',accepted:true,claimStatus:'answered'};
 const validated=[{partId:'P1',answers:[{claimId:'P1-C2',
  text:'The second claim about Nelly Dean and her narration.',
  renderedText:'The second claim about Nelly Dean and her narration. [S1]',
  sourceIds:['S1'],paragraphIndex:1}]}];
 // (a) Clean unexplained loss with validated text: restored.
 let parts=baseParts();
 let losses=reconcileAssemblyLoss({parts,reviewDecisions:[cleanDecision],
  validatedAnswers:validated,rejectionArchive:[],trace:{}});
 assert.deepEqual(losses,[{partId:'P1',claimId:'P1-C2',reason:'unexplained',
  disposition:'restored'}],'a clean unexplained loss restores from the validated draft');
 assert.equal(parts[0].answers.some(answer=>answer.claimId==='P1-C2'),true,
  'the restored claim joins the shipped answers');
 assert.equal(parts[0].answerStatus,'answered','a restore leaves the part answered');
 // (b) Same loss, but the validated text restates an archived rejection: withheld.
 parts=baseParts();
 losses=reconcileAssemblyLoss({parts,reviewDecisions:[cleanDecision],
  validatedAnswers:validated,
  rejectionArchive:[{partId:'P1',claimId:'P1-C9',
   claimText:'The second claim about Nelly Dean and her narration.'}],trace:{}});
 assert.deepEqual(losses,[{partId:'P1',claimId:'P1-C2',reason:'unexplained',
  disposition:'withheld-rejection-overlap'}],
  'a clean loss whose text restates a rejection is withheld, not restored');
 assert.equal(parts[0].answers.some(answer=>answer.claimId==='P1-C2'),false,
  'the withheld claim stays unshipped');
 // (c) Clean unexplained loss with no validated text: the part is capped partial.
 parts=baseParts();
 losses=reconcileAssemblyLoss({parts,reviewDecisions:[cleanDecision],
  validatedAnswers:[],rejectionArchive:[],trace:{}});
 assert.deepEqual(losses,[{partId:'P1',claimId:'P1-C2',reason:'unexplained',
  disposition:'unexplained-partial'}],
  'an unrestorable unexplained loss is recorded, not silently shipped past');
 assert.equal(parts[0].answerStatus,'partial',
  'the part is capped at partial so the loss is reader-visible');
 // (d) The ID hazard: the substance already ships under another ID.
 parts=baseParts();
 parts[0].answers.push({claimId:'P1-C9',
  text:'The second claim about Nelly Dean and her narration.',
  renderedText:'The second claim about Nelly Dean and her narration. [S1]',
  sourceIds:['S1'],paragraphIndex:1});
 losses=reconcileAssemblyLoss({parts,reviewDecisions:[cleanDecision],
  validatedAnswers:validated,rejectionArchive:[],trace:{}});
 assert.deepEqual(losses,[{partId:'P1',claimId:'P1-C2',
  reason:'renumbered-substance-shipped',disposition:'traced'}],
  'a renumbered claim whose substance ships is explained, not restored twice');
 assert.equal(parts[0].answers.length,2,'no duplicate claim is added');
 assert.equal(parts[0].answerStatus,'answered','no partial cap for a shipped substance');
 // (e) Control: a fully shipped accepted set reconciles trivially.
 parts=baseParts();
 losses=reconcileAssemblyLoss({parts,
  reviewDecisions:[{partId:'P1',claimId:'P1-C1',accepted:true,claimStatus:'answered'}],
  validatedAnswers:validated,rejectionArchive:[],trace:{}});
 assert.deepEqual(losses,[],'a clean run has no assembly loss');
});

test('batch 34 B34-7 classifySpanRegion: production page records classify apparatus vs text',()=>{
 const longPage={page:118,text:'CHAPTER I | WHICH TREATS OF THE CHARACTER AND PURSUITS OF THE FAMOUS GENTLEMAN DON QUIXOTE OF LA MANCHA | IN a village of La Mancha, the name of which I have no desire to call to mind, there lived not long since one of those gentlemen that keep a lance in the lance-rack, an old buckler, a lean hack, and a greyhound for coursing. An olla of rather more beef than mutton, a salad on most nights, scraps on Saturdays, lentils on Fridays, and a pigeon or so extra on Sundays, made away with three-quarters of his income.'};
 assert.equal(classifySpanRegion({text:'IT WAS with considerable reluctance that I abandoned in favour of the present undertaking what had long been my intention.',
  head:'TRANSLATOR’S PREFACE | | I: ABOUT THIS TRANSLATION | '},longPage),'apparatus',
  'a preface span is apparatus by its head');
 assert.equal(classifySpanRegion({text:'TRANSLATOR’S PREFACE . . . . . . . . 38 | I: ABOUT THIS TRANSLATION . . . . . . 38',
  head:'TABLE OF CONTENTS | '},longPage),'apparatus',
  'a table-of-contents span is apparatus by its dotted leaders');
 assert.equal(classifySpanRegion({text:'DON QUIXOTE',head:''},
  {page:1,text:'1615\n\nDON QUIXOTE\n  Miguel de Cervantes\nTranslated by John Ormsby'}),'apparatus',
  'a title-page span is apparatus by the short page');
 assert.equal(classifySpanRegion({text:'IN a village of La Mancha, the name of which I have no desire to call to mind, there lived not long since one of those gentlemen that keep a lance in the lance-rack, an old buckler, a lean hack, and a greyhound for coursing.',
  head:'CHAPTER I | WHICH TREATS OF THE CHARACTER AND PURSUITS OF THE FAMOUS GENTLEMAN DON QUIXOTE OF LA MANCHA | '},longPage),'text',
  'the novel’s own opening chapter is text, not apparatus');
 assert.equal(classifySpanRegion({text:'6.5–8.19: The great flood. This story describes God’s un-creation and re-creation of the world.',
  head:'5 The Lord saw that the wickedness of humankind was great in the earth, and that every inclination of the thoughts of their hearts was only evil continually.'},longPage),'apparatus',
  'a study note is apparatus by its verse-range key');
 assert.equal(classifySpanRegion({text:'The version preserved here is an interweaving of parallel accounts, one of which links with the Priestly traditions of 1.1–2.3 and 5.1–32.',
  head:'6.5–8.19: The great flood. This story describes God’s un-creation and re-creation of the world.'},longPage),'apparatus',
  'note prose is apparatus by the verse-range references it cites');
 assert.equal(classifySpanRegion({text:'a Meaning of Heb uncertain | b Or window',
  head:'5 And Noah did all that the Lord had commanded him.'},longPage),'apparatus',
  'a gloss-key span is apparatus');
 assert.equal(classifySpanRegion({text:'18: Covenant, see 9.8–17n.',
  head:'6.5–8.19: The great flood.'},longPage),'apparatus',
  'an n-suffixed cross-reference is apparatus');
 assert.equal(classifySpanRegion({text:'5 The Lord saw that the wickedness of humankind was great in the earth, and that every inclination of the thoughts of their hearts was only evil continually.',
  head:'genesis 7 | '},longPage),'text',
  'verse text is text: a bare verse number without a colon is not a note key');
});



test('batch 34 B34-8 finalizeVetoCensus: every disposition from the shipped set and the shipped text',()=>{
 // The census entries below cover all four (vote, shipped) cells
 // plus the renumbering shape: P1-C2's substance ships as P1-C9,
 // so its demotion did not take effect even though its own ID
 // never ships.
 const fleetText='The building of a great fleet of warships gave the empire command of every sea and harbor along the coast.';
 const parts=[{part:{id:'P1'},answerStatus:'answered',
  answers:[{claimId:'P1-C1',text:'The opening of new sea routes diverted the trade of the region.',renderedText:'The opening of new sea routes diverted the trade of the region. [S1]'},
   {claimId:'P1-C3',text:'The plague thinned the towns year after year.',renderedText:'The plague thinned the towns year after year. [S1]'},
   {claimId:'P1-C9',text:fleetText,renderedText:fleetText+' [S1]'}]},
  {part:{id:'P2'},answerStatus:'unanswered',answers:[]}];
 const answerText=parts[0].answers.map(answer=>answer.renderedText).join(' ');
 const reviewDecisions=[
  {partId:'P1',claimId:'P1-C1',claimText:'The opening of new sea routes diverted the trade of the region.'},
  {partId:'P1',claimId:'P1-C2',claimText:fleetText},
  {partId:'P1',claimId:'P1-C3',claimText:'The plague thinned the towns year after year.'},
  {partId:'P1',claimId:'P1-C4',claimText:'The province could no longer defend itself against its enemies.'}];
 const census=[
  {partId:'P1',claimId:'P1-C1',sourceId:'S1',layer:'gate',ground:'bullet-label',outcome:'suppressed',kind:'bullet-label'},
  {partId:'P1',claimId:'P1-C2',sourceId:'S1',layer:'gate',ground:'framing-claim-apparatus-only',outcome:'demoted',kind:'apparatus-framing'},
  {partId:'P1',claimId:'P1-C3',sourceId:'S1',layer:'gate',ground:'source-subject-attribution-mismatch',outcome:'restored',kind:'boundary-subject'},
  {partId:'P1',claimId:'P1-C4',sourceId:'S1',layer:'other',ground:'claim-clause-not-supported',outcome:'vetoed'},
  {partId:'P1',claimId:'P1-C5',sourceId:'S1',layer:'gate',ground:'source-subject-attribution-mismatch',outcome:'restored',kind:'boundary-subject'}];
 const returned=finalizeVetoCensus(census,{parts,answerText,reviewDecisions});
 assert.equal(returned,census,'entries are annotated in place, so the trace mirrors see the disposition');
 assert.equal(census[0].finalDisposition,'suppressed-and-shipped',
  'a suppression vote on a claim that ships is recorded as shipped');
 assert.equal(census[1].finalDisposition,'suppressed-and-shipped',
  'the substance ships under another ID, so the demotion did not take effect');
 assert.equal(census[2].finalDisposition,'stood',
  'a restoration whose claim ships stood');
 assert.equal(census[3].finalDisposition,'suppressed-and-dropped',
  'a veto on a claim that never ships is recorded as dropped');
 assert.equal(census[4].finalDisposition,'suppressed-and-dropped',
  'a restoration whose claim never ships ends dropped');
});


test('batch 35 B35-1: subjectNamesEquivalent — containment and spelling variants match, distinct surnames do not',()=>{
 assert.equal(subjectNamesEquivalent('Gibbon','Edward Gibbon'),true,
  'containment: the short form is the long form’s surname');
 assert.equal(subjectNamesEquivalent('Prince Andrew','Prince Andrei'),true,
  'variant: Andrew/Andrei share the five-character stem');
 assert.equal(subjectNamesEquivalent('Prince Andrei','Prince Andrew'),true,
  'the variant rule is symmetric');
 assert.equal(subjectNamesEquivalent('Andrew','Andrei'),true,
  'single-token variants of sufficient length match');
 assert.equal(subjectNamesEquivalent('John Smith','John Smyth'),false,
  'a short shared prefix is not a variant');
 assert.equal(subjectNamesEquivalent('Elizabeth Bennet','Jane Bennet'),false,
  'a shared surname alone never makes two full names equivalent');
 assert.equal(subjectNamesEquivalent('Marlow','Kurtz'),false);
});

test('batch 35 B35-1 pilot: a boundary-only swap finding is recorded with audit detail and the claim ships',async()=>{
 // The reviewer ratifies the claim (Bernard weeps) while its own
 // boundary records Alice weeping. The span attests Alice's name
 // (she is mentioned) but never assigns the weeping to her: the
 // sentence that carries the action opens on a pronoun. Batch 34
 // demoted on the boundary's word alone; batch 35 records the
 // finding — span IDs, both subjects, the verdict it would have
 // produced — and the claim ships, because a boundary-only reading
 // is measurement, not a gate.
 const source={id:'S1',bookId:'77',title:'Letters — Alice Marchmain',
  page:12,url:'https://example.test/letters#page=12',
  text:'Alice kept a photograph of Bernard beside her desk for many years. She wept openly at the news of his leaving, and the letter shook in her hand as she read it again.',
  preview:'Alice kept a photograph of Bernard beside her desk.'};
 const plan={version:'reader-evidence-v2',intent:'explain',
  sources:[{label:'Alice Marchmain',role:'primary',bookIds:['77']}],
  parts:[{id:'P1',question:'How does Bernard react to the news of the leaving?',
   sourceBookIds:['77'],searchQueries:['Bernard news leaving'],
   candidateSourceIds:['S1']}],queries:['Bernard leaving']};
 const reviewResponder=({messages})=>{
  const payload=parsePayload(messages);
  const span=payload.spanCatalog[0];
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
    answerStatus:'answered',
    directAnswerClaimIds:payload.claims.map(claim=>claim.claimId),
    retainedContextClaimIds:[]}],
   claims:payload.claims.map(claim=>({claimId:claim.claimId,status:'answered',
    attributedSubject:'Bernard',
    sources:[{sourceId:'S1',status:'answered',spanIds:[span.spanId],
     subjectAttributionStatus:'supported',attributedSubject:'Bernard',
     supportBoundary:'The span describes Alice crying openly at the news.'}]}))})};
 };
 const ai=batch25RouterAI({reviewResponder,rescueResponder:b34RescueRefused,
  repairResponder:({messages})=>({response:JSON.stringify({parts:[]})}),
  assemblyAuditResponder:({messages})=>({response:JSON.stringify({
   parts:parsePayload(messages).parts.map(part=>({partId:part.partId,action:'none'}))})}),
  draftText:'PART P1\nBernard weeps openly at the news of his leaving. [S1]'});
 const result=await composeEvidenceAnswer(
  'How does Bernard react to the news of the leaving?',
  [source],ai,[],{plan,catalog:{77:'Letters — Alice Marchmain'},trace:true});
 assert.match(result.answer,/Bernard weeps openly/,
  'the claim ships: a boundary-only finding no longer demotes');
 const records=result.trace.reviewContract?.boundarySubjectChecks||[];
 assert.equal(records.length,1);
 assert.equal(records[0].outcome,'recorded');
 assert.equal(records[0].wouldBeOutcome,'demoted');
 assert.equal(records[0].wouldBeGround,'source-subject-attribution-mismatch');
 assert.equal(records[0].boundarySubject,'Alice');
 assert.equal(records[0].claimSubject,'Bernard');
 assert.ok(records[0].spanIds.length>=1,
  'the record carries the cited span IDs for the precision audit');
 assert.ok(!(result.trace.vetoCensus||[]).some(entry=>
   entry.claimId===records[0].claimId&&entry.kind==='boundary-subject'),
  'a recorded finding never enters the veto census as a demotion');
});

test('batch 35 B35-1 pilot: an extracted subject absent from the evidence is silence, not a finding',async()=>{
 // The Gatsby pilot-1 claim with a boundary naming Nick — a person
 // the span never mentions. Batch 34 harvested the name from the
 // boundary prose and demoted; batch 35’s attestation rule treats
 // an unevidenced extraction as no subject recorded: the check
 // stays silent and the claim ships exactly as a silent boundary
 // leaves it.
 const ai=batch25RouterAI({reviewResponder:b34GatsbyReview({
   c2Boundary:'The span describes Nick crying over the beautiful shirts, which is part of the witnessed scene.'}),
  rescueResponder:b34RescueRefused,
  repairResponder:({messages})=>({response:JSON.stringify({parts:[]})}),
  assemblyAuditResponder:({messages})=>({response:JSON.stringify({
   parts:parsePayload(messages).parts.map(part=>({partId:part.partId,action:'none'}))})}),
  draftText:'PART P1\n'+
   'Gatsby throws shirt after shirt before his guests, shirts of sheer linen and thick silk and fine flannel. [S1]\n\n'+
   'He also witnesses the overwhelming impact of Gatsby’s luxury, such as the “beautiful shirts” that move Gatsby to tears. [S1]'});
 const result=await composeEvidenceAnswer(
  'In The Great Gatsby, how does Daisy react to the display of wealth?',
  [b34GatsbySource],ai,[],{plan:b34GatsbyPlan,catalog:b34GatsbyCatalog,trace:true});
 assert.match(result.answer,/move Gatsby to tears/,
  'the claim ships: the unevidenced extraction demotes nothing');
 assert.deepEqual(result.trace.reviewContract?.boundarySubjectChecks||[],[],
  'no finding is recorded for an unattested subject');
});

test('batch 35 B35-1 pilot: a spelling variant of the claim’s subject is a match, not a mismatch (W&P shape)',async()=>{
 // Production shape: the span (and the reviewer’s boundary) name
 // “Prince Andrew”; the claim names “Prince Andrei”. Batch 34’s
 // strict matching read the variant as an alias miss and demoted.
 // Under the maintained equivalence rule the boundary records the
 // claim’s own subject — parity — and the claim ships.
 const source={id:'S1',bookId:'258',title:'War and Peace — Leo Tolstoy',
  page:311,url:'https://example.test/warpeace#page=311',
  text:'Prince Andrew had long ceased to believe in the plans drawn up by the staff at headquarters. He despairs of the council’s plan and of every disposition made far from the smoke of the field.',
  preview:'Prince Andrew had long ceased to believe in the plans.'};
 const plan={version:'reader-evidence-v2',intent:'explain',
  sources:[{label:'Leo Tolstoy',role:'primary',bookIds:['258']}],
  parts:[{id:'P1',question:'How does Prince Andrei judge the council’s plan?',
   sourceBookIds:['258'],searchQueries:['Andrei council plan'],
   candidateSourceIds:['S1']}],queries:['Andrei plan']};
 const reviewResponder=({messages})=>{
  const payload=parsePayload(messages);
  const span=payload.spanCatalog.find(entry=>entry.text.includes('despairs'));
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
    answerStatus:'answered',
    directAnswerClaimIds:payload.claims.map(claim=>claim.claimId),
    retainedContextClaimIds:[]}],
   claims:payload.claims.map(claim=>({claimId:claim.claimId,status:'answered',
    attributedSubject:'Prince Andrei',
    sources:[{sourceId:'S1',status:'answered',spanIds:[span.spanId],
     subjectAttributionStatus:'supported',attributedSubject:'Prince Andrei',
     supportBoundary:'The span describes Prince Andrew despairing of the council’s plan.'}]}))})};
 };
 const ai=batch25RouterAI({reviewResponder,rescueResponder:b34RescueRefused,
  repairResponder:({messages})=>({response:JSON.stringify({parts:[]})}),
  assemblyAuditResponder:({messages})=>({response:JSON.stringify({
   parts:parsePayload(messages).parts.map(part=>({partId:part.partId,action:'none'}))})}),
  draftText:'PART P1\nPrince Andrei despairs of the council’s plan. [S1]'});
 const result=await composeEvidenceAnswer(
  'How does Prince Andrei judge the council’s plan?',
  [source],ai,[],{plan,catalog:{258:'War and Peace — Leo Tolstoy'},trace:true});
 assert.match(result.answer,/Prince Andrei despairs/,
  'the claim ships: the variant is the same person');
 assert.deepEqual(result.trace.reviewContract?.boundarySubjectChecks||[],[],
  'no swap is recorded against a variant-matched subject');
});




test('batch 35 B35-2 pilot (Kierkegaard): an impersonal “It matters…” opener is never rewritten into a person',async()=>{
 // Production shape (phase-2 Kierkegaard SP2): batch 34’s guard
 // rewrote a non-referential “It” into a recorded subject from
 // another part, manufacturing a person-shaped claim. The
 // impersonal exemption leaves the opener byte-unchanged.
 const sourceA={id:'S1',bookId:'140',title:'Concluding Unscientific Postscript — Søren Kierkegaard',
  page:201,url:'https://example.test/postscript#page=201',
  text:'Kierkegaard argues that truth for an existing individual is subjectivity: the passion of inwardness with which a person holds fast to an objective uncertainty is the highest truth attainable for such a person.',
  preview:'Kierkegaard argues that truth for an existing individual is subjectivity.'};
 const sourceB={id:'S2',bookId:'140',title:'Concluding Unscientific Postscript — Søren Kierkegaard',
  page:244,url:'https://example.test/postscript#page=244',
  text:'Under the name Johannes Climacus, the book insists that what counts is the individual’s own appropriation: the reader must exist in the truth rather than merely assent to a result, and no system can exist on the reader’s behalf.',
  preview:'Under the name Johannes Climacus, the book insists that what counts is appropriation.'};
 const plan={version:'reader-evidence-v2',intent:'explain',
  sources:[{label:'Søren Kierkegaard',role:'primary',bookIds:['140']}],
  parts:[{id:'P1',question:'What does Kierkegaard claim truth is for an existing individual?',
   sourceBookIds:['140'],searchQueries:['Kierkegaard truth subjectivity'],
   candidateSourceIds:['S1']},
   {id:'P2',question:'What does Climacus require of the reader?',
   sourceBookIds:['140'],searchQueries:['Climacus reader appropriation'],
   candidateSourceIds:['S2']}],queries:['Kierkegaard Climacus']};
 const draft='PART P1\n'+
  'Kierkegaard argues that truth for an existing individual is subjectivity, held fast with the passion of inwardness. [S1]\n\n'+
  'PART P2\n'+
  'It matters, as Climacus insists, that the single individual appropriate the truth himself rather than assent to a finished system. [S2]';
 const reviewResponder=({messages})=>{
  const payload=parsePayload(messages);
  const subjects={'P1-C1':'Kierkegaard','P2-C1':'Johannes Climacus'};
  return {response:JSON.stringify({parts:payload.parts.map(part=>({
    partId:part.partId,status:'answered',answerStatus:'answered',
    directAnswerClaimIds:payload.claims
     .filter(claim=>claim.claimId.startsWith(part.partId+'-'))
     .map(claim=>claim.claimId),retainedContextClaimIds:[]})),
   claims:payload.claims.map(claim=>{const span=payload.spanCatalog
     .find(entry=>entry.sourceId===(claim.claimId==='P1-C1'?'S1':'S2'))||
     payload.spanCatalog[0];
    return {claimId:claim.claimId,status:'answered',
     attributedSubject:subjects[claim.claimId],
     sources:[{sourceId:claim.claimId==='P1-C1'?'S1':'S2',status:'answered',
      spanIds:[span.spanId],subjectAttributionStatus:'supported',
      attributedSubject:subjects[claim.claimId]}]};})})};
 };
 const ai=batch25RouterAI({reviewResponder,rescueResponder:b34RescueRefused,
  repairResponder:({messages})=>({response:JSON.stringify({parts:[]})}),
  assemblyAuditResponder:({messages})=>({response:JSON.stringify({
   parts:parsePayload(messages).parts.map(part=>({partId:part.partId,action:'none'}))})}),
  draftText:draft});
 const result=await composeEvidenceAnswer(
  'What do Kierkegaard and his pseudonym Climacus each require of the reader?',
  [sourceA,sourceB],ai,[],{plan,
   catalog:{140:'Concluding Unscientific Postscript — Søren Kierkegaard'},trace:true});
 assert.match(result.answer,/It matters, as Climacus insists, that the single individual appropriate the truth himself/,
  'the impersonal opener ships unchanged');
 assert.doesNotMatch(result.answer,/Johannes Climacus matters/,
  'no person is manufactured out of the impersonal pronoun');
 assert.equal(result.trace.assemblyAntecedentGuard,undefined,
  'the guard does not fire at all on this answer');
});



test('batch 35 B35-4: the region census lands in the trace for every packet span, gate trip or not',async()=>{
 // Batch 34 shipped B34-7's classifier with records only on
 // demotion: all 64 production traces carried zero region keys
 // and the mechanism read as inert. Batch 35 records a
 // classification for every packet span of every reviewed part.
 const preface={id:'S1',bookId:'124',title:'Don Quixote — Miguel de Cervantes',
  page:38,url:'https://example.test/quixote#page=38',
  text:'TRANSLATOR’S PREFACE | | I: ABOUT THIS TRANSLATION | IT WAS with considerable reluctance that I abandoned in favour of the present undertaking what had long been my intention. The work had occupied my thoughts for many years before I resolved to attempt it.',
  preview:'TRANSLATOR’S PREFACE'};
 const novel={id:'S2',bookId:'124',title:'Don Quixote — Miguel de Cervantes',
  page:118,url:'https://example.test/quixote#page=118',
  text:'CHAPTER I | WHICH TREATS OF THE CHARACTER AND PURSUITS OF THE FAMOUS GENTLEMAN DON QUIXOTE OF LA MANCHA | IN a village of La Mancha, the name of which I have no desire to call to mind, there lived not long since one of those gentlemen that keep a lance in the lance-rack, an old buckler, a lean hack, and a greyhound for coursing. An olla of rather more beef than mutton, a salad on most nights, scraps on Saturdays, lentils on Fridays, and a pigeon or so extra on Sundays, made away with three-quarters of his income.',
  preview:'CHAPTER I'};
 const plan={version:'reader-evidence-v2',intent:'explain',
  sources:[{label:'Miguel de Cervantes',role:'primary',bookIds:['124']}],
  parts:[{id:'P1',question:'How does the opening of Don Quixote present its hero?',
   sourceBookIds:['124'],searchQueries:['Don Quixote opening hero'],
   candidateSourceIds:['S1','S2']}],queries:['Don Quixote opening']};
 const draft='PART P1\n'+
  '**The Translator’s Preface:** the translator opens by explaining his reluctance to abandon his earlier undertaking for the present one. [S1]\n\n'+
  'In a village of La Mancha, a country gentleman lives keeping a lance in the lance-rack and a greyhound for coursing. [S2]\n\n'+
  'The novel opens by introducing its hero as a gentleman of La Mancha whose name the narrator declines to call to mind. [S2]';
 let packetSpanIds=[];
 const reviewResponder=({messages})=>{
  const payload=parsePayload(messages);
  packetSpanIds=payload.spanCatalog.map(entry=>entry.spanId);
  const spanByFragment=fragment=>payload.spanCatalog
   .find(entry=>entry.text.includes(fragment))?.spanId;
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
    answerStatus:'answered',
    directAnswerClaimIds:payload.claims.map(claim=>claim.claimId),
    retainedContextClaimIds:[]}],
   claims:payload.claims.map(claim=>{
    if(claim.text.includes('reluctance'))return {claimId:claim.claimId,
     status:'answered',
     sources:[{sourceId:'S1',status:'answered',
      spanIds:[spanByFragment('reluctance')],
      subjectAttributionStatus:'supported'}]};
    return {claimId:claim.claimId,status:'answered',
     sources:[{sourceId:'S2',status:'answered',
      spanIds:[spanByFragment(claim.text.includes('village')?
       'village of La Mancha':'call to mind')],
      subjectAttributionStatus:'supported'}]};})})};
 };
 const ai=batch25RouterAI({reviewResponder,rescueResponder:b34RescueRefused,
  repairResponder:({messages})=>({response:JSON.stringify({parts:[]})}),
  assemblyAuditResponder:({messages})=>({response:JSON.stringify({
   parts:parsePayload(messages).parts.map(part=>({partId:part.partId,action:'none'}))})}),
  draftText:draft});
 const result=await composeEvidenceAnswer(
  'How does the opening of Don Quixote present its hero?',
  [preface,novel],ai,[],{plan,
   catalog:{124:'Don Quixote — Miguel de Cervantes'},trace:true});
 const census=result.trace.reviewContract?.spanRegionClassifications;
 assert.ok(Array.isArray(census)&&census.length>=packetSpanIds.length,
  'the census covers the packet spans');
 for(const spanId of packetSpanIds)
  assert.ok(census.some(entry=>entry.spanId===spanId&&entry.partId==='P1'),
   'a classification record exists for packet span '+spanId);
 assert.ok(census.some(entry=>entry.sourceId==='S1'&&entry.region==='apparatus'),
  'the preface spans classify as apparatus');
 assert.ok(census.some(entry=>entry.sourceId==='S2'&&entry.region==='text'),
  'the chapter spans classify as text');
 assert.ok(BATCH35_FIRING_FIELDS.includes('reviewContract.spanRegionClassifications'),
  'the registry names the census field for the harness roll-up');
});

test('batch 35 B35-6 pilot (disclosure generation): a requirement ending unanswered in the final reconciliation labels its part and coverage stops reporting full',async()=>{
 // The W&P SP1 production shape, in both phase-3 passes: the
 // reconciliation recomputed P2-R1 partial → unanswered (its
 // claims never shipped), yet no disclosure was generated and
 // coverage reported "full". Batch 35 generates the disclosure
 // from the reconciled record and makes "full" require complete
 // requirements.
 const source={id:'S1',bookId:'258',title:'War and Peace — Leo Tolstoy',
  page:901,url:'https://example.test/warpeace#page=901',
  text:'The movement of nations is the aggregate of individual lives; an army moves as a mass, and a regiment is one small part of a vast collective motion across the field, no single will directing the whole. What a commander orders and what the soldiers do are separated by the whole machinery of the army.',
  preview:'The movement of nations is the aggregate of individual lives.'};
 const plan={version:'reader-evidence-v2',intent:'explain',
  sources:[{label:'Leo Tolstoy',role:'primary',bookIds:['258']}],
  parts:[{id:'P1',question:'What do Tolstoy’s passages describe of Prince Andrei’s battlefield experiences in the war?',
   sourceBookIds:['258'],searchQueries:['Andrei battlefield experiences'],
   candidateSourceIds:['S1'],sourceRequired:true,
   requirements:[{id:'P1-R1',text:'Describe Prince Andrei’s battlefield experiences.'}]}],
  queries:['Andrei battlefield']};
 const draft='PART P1\n'+
  'The movement of armies in the passages is the aggregate of innumerable individual acts rather than the expression of any single will. [S1]\n\n'+
  'Andrei’s regiment moves with the army as one small part of a vast collective motion across the field. [S1]';
 const reviewResponder=({messages})=>{
  const payload=parsePayload(messages);
  const span=payload.spanCatalog[0];
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
    answerStatus:'answered',directAnswerClaimIds:['P1-C1'],
    retainedContextClaimIds:[],
    requirementCoverage:[{requirementId:'P1-R1',status:'answered',
     answerClaimIds:['P1-C2']}]}],
   claims:payload.claims.map(claim=>claim.claimId==='P1-C1'?
    {claimId:claim.claimId,status:'answered',
     sources:[{sourceId:'S1',status:'answered',spanIds:[span.spanId],
      subjectAttributionStatus:'supported'}]}:
    {claimId:claim.claimId,status:'unsupported',
     sources:[{sourceId:'S1',status:'unsupported',spanIds:[span.spanId],
      subjectAttributionStatus:'supported'}]})})};
 };
 const ai=batch25RouterAI({reviewResponder,rescueResponder:b34RescueRefused,
  repairResponder:({messages})=>({response:JSON.stringify({parts:[]})}),
  assemblyAuditResponder:({messages})=>({response:JSON.stringify({
   parts:parsePayload(messages).parts.map(part=>({partId:part.partId,action:'none'}))})}),
  draftText:draft});
 const result=await composeEvidenceAnswer(
  'What do Tolstoy’s passages describe of Prince Andrei’s battlefield experiences in the war?',
  [source],ai,[],{plan,catalog:{258:'War and Peace — Leo Tolstoy'},trace:true});
 assert.match(result.answer,/aggregate of innumerable individual acts/,
  'the supported claim still ships');
 // Stage B (B4): the label's subject is the unmet REQUIREMENT,
 // not the whole part question — the part DID ship verified
 // content, and the old whole-question wording claimed it hadn't.
 assert.match(result.answer,/Retrieved passages could not be verified as supporting this part of the question: Describe Prince Andrei’s battlefield experiences\./,
  'the unanswered requirement generates the part’s disclosure label, scoped to the requirement');
 assert.doesNotMatch(result.answer,/could not be verified as supporting this part of the question: What do Tolstoy/);
 assert.deepEqual(result.trace.final?.disclosureLabels,
  [{partId:'P1',kind:'unanswered-requirement',
   text:'Retrieved passages could not be verified as supporting this part of the question: Describe Prince Andrei’s battlefield experiences.'}],
  'the exact label text is recorded for verbatim verification');
 assert.deepEqual(result.trace.final?.unansweredRequirementLabels,
  [{partId:'P1',requirementIds:['P1-R1']}],
  'the generated disclosure is on the trace');
 assert.notEqual(result.coverage,'full',
  'coverage may not report full over an unanswered requirement');
 assert.equal(result.coverage,'partial');
});

test('batch 35 B35-6 pilot (unit-side claim labels): the measurement reads shipped units — cited units and allowance context stay unlabeled',async()=>{
 // The unit-side measurement (B35-6): the label population is
 // the contract lists UNION the claims holding an accepted,
 // source-carrying review decision, filtered to shipped units
 // carrying no citation marker. This pilot pins the precision
 // side on the W&P bullet geometry: the bullet-label claim is
 // accepted against the source and ships WITH its marker (the
 // invariant the measurement relies on — an accepted claim's
 // unit carries its citation), and the retained context claim
 // beside it is the standing allowance. Neither may be labeled.
 // (The positive path — a contract-list claim shipping uncited —
 // is the batch-34 Faust pilot above; the disclosure-generation
 // pilot covers the reconciliation side. The context-classified
 // breach class of phase 2 has no deterministic linkage: the
 // reviewer's context classification is the only record and it
 // asserts allowance, and scaffolding-linked restatements ship
 // with evidence attached by design — see the checkpoint's
 // determinism conclusion.)
 const source={id:'S1',bookId:'258',title:'War and Peace — Leo Tolstoy',
  page:955,url:'https://example.test/warpeace#page=955',
  text:'Tolstoy posits that the life of nations is not contained within the lives of a few individuals, and he dismisses the theory that historical personages represent a transference of the collective will of the masses, calling it a hypothesis unconfirmed by experience, since a leader may always be said to have taken charge simply because events required one.',
  preview:'Tolstoy posits that the life of nations is not contained within the lives of a few individuals.'};
 const plan={version:'reader-evidence-v2',intent:'explain',
  sources:[{label:'Leo Tolstoy',role:'primary',bookIds:['258']}],
  parts:[{id:'P1',question:'How does Tolstoy explain the movement of nations?',
   sourceBookIds:['258'],searchQueries:['Tolstoy movement nations will'],
   candidateSourceIds:['S1'],sourceRequired:true}],
  queries:['Tolstoy nations']};
 const draft='PART P1\n'+
  'Tolstoy posits that the life of nations is not contained within the lives of a few individuals. [S1]\n\n'+
  '* **Transference of Collective Will:** Another theory suggests that historical personages represent a transference of the collective will of the masses to the leader. [S1]\n\n'+
  'Tolstoy wrote these chapters as a second epilogue, part treatise and part history.';
 const reviewResponder=({messages})=>{
  const payload=parsePayload(messages);
  const span=payload.spanCatalog[0];
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
    answerStatus:'answered',directAnswerClaimIds:['P1-C1'],
    retainedContextClaimIds:['P1-C3']}],
   claims:payload.claims.map(claim=>({claimId:claim.claimId,status:'answered',
    sources:[{sourceId:'S1',status:'answered',spanIds:[span.spanId],
     subjectAttributionStatus:'supported'}]}))})};
 };
 const ai=batch25RouterAI({reviewResponder,rescueResponder:b34RescueRefused,
  repairResponder:({messages})=>({response:JSON.stringify({parts:[]})}),
  assemblyAuditResponder:({messages})=>({response:JSON.stringify({
   parts:parsePayload(messages).parts.map(part=>({partId:part.partId,action:'none'}))})}),
  draftText:draft});
 const result=await composeEvidenceAnswer(
  'How does Tolstoy explain the movement of nations?',
  [source],ai,[],{plan,catalog:{258:'War and Peace — Leo Tolstoy'},trace:true});
 assert.match(result.answer,/life of nations is not contained/,
  'the cited claim ships');
 assert.match(result.answer,/Transference of Collective Will:[\s\S]*to the leader\. \[S1\]/,
  'the accepted bullet claim ships WITH its citation marker');
 assert.match(result.answer,/second epilogue/,
  'the allowance context claim ships');
 assert.equal(result.trace.final?.claimLevelUncitedLabels,undefined,
  'no claim-level label: every sourced unit is cited, the rest is allowance');
 assert.doesNotMatch(result.answer,/Retrieved passages could not be verified/,
  'no label text enters the answer');
});

function b35SynthesisAI({draft,partialClaimId,synthesisId,supportId}){
 return {run:async(_m,request)=>{
  const system=String(request?.messages?.[0]?.content||'');
  if(system.startsWith('Answer the reader'))return {response:draft};
  if(system.startsWith('Review the complete answer')){
   const payload=parsePayload(request.messages);
   const span=payload.spanCatalog[0];
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
     answerStatus:'answered',directAnswerClaimIds:['P1-C1'],
     retainedContextClaimIds:[synthesisId],
     scaffoldingLinks:[{claimId:synthesisId,supportClaimIds:[supportId]}]}],
    claims:payload.claims.filter(c=>c.sourceIds.length).map(claim=>({
     claimId:claim.claimId,
     status:claim.claimId===partialClaimId?'partial':'answered',
     sources:[{sourceId:'S1',status:'answered',spanIds:[span.spanId],
      subjectAttributionStatus:'supported',
      attributedSubject:claim.claimId==='P1-C1'?'Darcy':'Elizabeth'}]}))})};
  }
  if(system.startsWith('Judge only the listed claim'))return b34RescueRefused(request);
  if(system.startsWith('Patch only the requested claims'))
   return {response:JSON.stringify({parts:[]})};
  if(system.startsWith('Audit the assembled')){
   const payload=parsePayload(request.messages);
   return {response:JSON.stringify({parts:payload.parts.map(p=>({partId:p.partId,action:'none'}))})};
  }
  throw new Error('unexpected system: '+system.slice(0,60));
 }};
}
const b35SynthesisSource={id:'S1',bookId:'341',title:'Pride and Prejudice — Jane Austen',
 page:120,url:'https://example.test/pp#page=120',
 text:'At the ball, Darcy offends Elizabeth with his proud manners and refuses to dance with her. Wickham later tells Elizabeth that Darcy treated him scandalously, cheating him of the living their fathers intended for him, and Elizabeth, already prejudiced against Darcy, believes the account readily.',
 preview:'At the ball, Darcy offends Elizabeth with his proud manners.'};
const b35SynthesisPlan={version:'reader-evidence-v2',intent:'explain',
 sources:[{label:'Jane Austen',role:'primary',bookIds:['341']}],
 parts:[{id:'P1',question:'How does Elizabeth\u2019s view of Darcy evolve?',
  sourceBookIds:['341'],searchQueries:['Elizabeth Darcy view'],
  candidateSourceIds:['S1'],sourceRequired:true}],queries:['Elizabeth Darcy']};



test('batch 35 B35-8 pilot (rebind-before-partition): a quote living in an unaccepted packet source is rebound there and the part survives with the rebound binding',async()=>{
 // The C&P SP1 shape: the draft cites [S1, S2]; review accepts
 // only the S1 pair, so the rendered group narrows to [S1] while
 // the quoted words live verbatim in S2 — a packet source no
 // part's evidence accepted. Through batch 34 the rebind searched
 // only accepted sources (S2 unreachable) and repaired only the
 // joined string, so the part died at partition on its own stale
 // binding. Now the search covers the whole packet and the repair
 // is mirrored into the owning answer.
 const s1={id:'S1',bookId:'114',title:'Crime and Punishment — Fyodor Dostoevsky',
  page:200,url:'https://example.test/cp#page=200',
  text:'Raskolnikov comes to Sonya\u2019s room and lays his theory before her: that extraordinary men may step over certain obstacles when an idea requires it, and that he himself wished to prove he was not a trembling creature but a man with a right to act.',
  preview:'Raskolnikov comes to Sonya\u2019s room and lays his theory before her.'};
 const s2={id:'S2',bookId:'114',title:'Crime and Punishment — Fyodor Dostoevsky',
  page:310,url:'https://example.test/cp#page=310',
  text:'Sonya listens in silence, then answers him quietly: "You have suffered already; bow down and accept suffering, and you will live again." Raskolnikov stared at her, astonished by the simplicity of her faith and the firmness of her quiet voice.',
  preview:'Sonya listens in silence, then answers him quietly.'};
 const s3={id:'S3',bookId:'114',title:'Crime and Punishment — Fyodor Dostoevsky',
  page:150,url:'https://example.test/cp#page=150',
  text:'In his article Raskolnikov divides humanity into two categories: the ordinary, who must live in obedience and have no right to transgress the law, and the extraordinary, who may permit their conscience to step over certain obstacles.',
  preview:'In his article Raskolnikov divides humanity into two categories.'};
 const plan={version:'reader-evidence-v2',intent:'explain',
  sources:[{label:'Fyodor Dostoevsky',role:'primary',bookIds:['114']}],
  parts:[{id:'P1',question:'What is Raskolnikov\u2019s theory of extraordinary men?',
    sourceBookIds:['114'],searchQueries:['Raskolnikov theory extraordinary'],
    candidateSourceIds:['S3'],sourceRequired:true},
   {id:'P2',question:'How does Sonya answer Raskolnikov\u2019s theory?',
    sourceBookIds:['114'],searchQueries:['Sonya answer suffering'],
    candidateSourceIds:['S1','S2'],sourceRequired:true}],
  queries:['Raskolnikov Sonya']};
 const draft='PART P1\n'+
  'Raskolnikov divides humanity into ordinary and extraordinary men. [S3]\n\n'+
  'PART P2\n'+
  'Raskolnikov lays his theory before Sonya in her room. [S1]\n'+
  'Sonya answers him, "bow down and accept suffering," urging him toward redemption. [S1, S2]';
 const reviewResponder=({messages})=>{
  const payload=parsePayload(messages);
  return {response:JSON.stringify({
   parts:payload.parts.map(part=>({partId:part.partId,status:'answered',
    answerStatus:'answered',
    directAnswerClaimIds:payload.claims.filter(c=>c.partId===part.partId)
     .map(c=>c.claimId),retainedContextClaimIds:[]})),
   claims:payload.claims.map(claim=>({claimId:claim.claimId,status:'answered',
    sources:claim.sourceIds.map(sourceId=>{
     if(claim.claimId==='P2-C2'&&sourceId==='S2')
      return {sourceId,status:'partial',spanIds:[]};
     return {sourceId,status:'answered',
      spanIds:[claim.sourceEvidence.find(item=>item.sourceId===sourceId).spanIds[0]],
      subjectAttributionStatus:'supported',
      attributedSubject:claim.claimId==='P2-C2'?'Sonya':'Raskolnikov'};
    })}))})};
 };
 const ai=batch25RouterAI({reviewResponder,
  rescueResponder:b34RescueRefused,draftText:draft});
 const result=await composeEvidenceAnswer(
  'What is Raskolnikov\u2019s theory, and how does Sonya answer it?',
  [s1,s2,s3],ai,[],{plan,catalog:{114:'Crime and Punishment — Fyodor Dostoevsky'},trace:true});
 assert.notEqual(result.outcome,'generation-failed','the answer ships');
 assert.match(result.answer,/"bow down and accept suffering," urging him toward redemption\. \[S2\]/,
  'the quote\u2019s group is rebound to the packet source that holds it verbatim');
 const rebinds=result.trace.final.quoteRebinds||[];
 assert.equal(rebinds.length,1);
 assert.deepEqual(rebinds[0].fromSourceIds,['S1']);
 assert.equal(rebinds[0].toSourceId,'S2');
 assert.equal(rebinds[0].mode,'replace');
 const p2=result.trace.final.questionParts.find(part=>part.partId==='P2');
 assert.ok(p2.claimIds.includes('P2-C2'),'the rebound claim ships in its part');
 assert.ok(p2.evidenceIds.includes('S2'),
  'the part\u2019s own record carries the rebound binding (the mirror), not the stale S1 binding');
 assert.equal(result.trace.final.auditPartition,undefined,
  'no partition was needed: the rebind settled the audit before partition');
});

test('batch 35 B35-8 pilot (review retry deadline): a deadline retry records a 120000 ms deadline while the initial call keeps 60000',async()=>{
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
  plan:onePartPlan,catalog,trace:true,transportDiagnostics:true});
 assert.equal(result.outcome,'verified-source-draft');
 const reviewCalls=result.trace.inferenceCalls.filter(call=>call.stage==='review');
 assert.equal(reviewCalls.length,2,'the initial review and its retry are both recorded');
 assert.equal(reviewCalls[0].kind,'initial');
 assert.equal(reviewCalls[0].timeoutMs,60000,
  'the initial review call keeps the flat 60000 deadline (B34-5 contract intact)');
 assert.equal(reviewCalls[1].kind,'retry');
 assert.equal(reviewCalls[1].timeoutMs,120000,
  'the retry after the deadline death gets the raised deadline instead of a fresh flat 60 s');
});

// ---------------------------------------------------------------------------
// Redesign Stage A: the audit is the reviewer's single judgment.
// ---------------------------------------------------------------------------

test('redesign Stage A: no boundary, context-purge, or veto demotion can fire on the pilot route',async()=>{
 // The Marchmain shape that batch 34 demoted and batch 35 learned
 // to record: the span's boundary subject (Alice) differs from the
 // claim's reviewer-resolved subject (Bernard). Stage A records
 // the finding and ships the claim on the reviewer's verdict.
 const source={id:'S1',bookId:'77',title:'Letters — Alice Marchmain',
  page:12,url:'https://example.test/letters#page=12',
  text:'Alice kept a photograph of Bernard beside her desk for many years. She wept openly at the news of his leaving, and the letter shook in her hand as she read it again.',
  preview:'Alice kept a photograph of Bernard beside her desk.'};
 const plan={version:'reader-evidence-v2',intent:'explain',
  sources:[{label:'Alice Marchmain',role:'primary',bookIds:['77']}],
  parts:[{id:'P1',question:'How does Bernard react to the news of the leaving?',
   sourceBookIds:['77'],searchQueries:['Bernard news leaving'],
   candidateSourceIds:['S1']}],queries:['Bernard leaving']};
 const ai=makeAI([
  answer('PART P1\nBernard weeps openly at the news of his leaving. [S1]\n'+
   'The letter plainly shook everyone who read it.'),
  (_model,{messages})=>{
   const payload=parsePayload(messages);
   const span=payload.spanCatalog[0];
   const cited=payload.claims.find(claim=>claim.sourceIds.includes('S1'));
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
     answerStatus:'answered',directAnswerClaimIds:[cited.claimId],
     retainedContextClaimIds:(payload.parts[0].contextClaims||[])
      .map(claim=>claim.claimId)}],
    claims:payload.claims.map(claim=>claim.claimId===cited.claimId?
     {claimId:claim.claimId,status:'answered',
      sources:[{sourceId:'S1',status:'answered',spanIds:[span.spanId],
       subjectAttributionStatus:'supported',attributedSubject:'Bernard',
       supportBoundary:'The span describes Alice crying openly at the news.'}]}:
     {claimId:claim.claimId,status:'answered',sources:[]})})};
  }],{decorateReview:false});
 const result=await composeEvidenceAnswer(
  'How does Bernard react to the news of the leaving?',
  [source],ai,[],{plan,catalog:{77:'Letters — Alice Marchmain'},trace:true});
 assert.match(result.answer,/Bernard weeps openly/,
  'the cited claim ships on the reviewer verdict despite the boundary finding');
 assert.match(result.answer,/The letter plainly shook everyone who read it/,
  'the uncited reviewer-answered claim ships: the context purge is gone');
 const records=result.trace.reviewContract?.boundarySubjectChecks||[];
 assert.equal(records.length,1,'the boundary finding is still recorded as telemetry');
 assert.equal(records[0].outcome,'recorded');
 assert.equal(result.trace.vetoCensus,undefined,
  'no veto census exists on the pilot route');
 assert.ok(!(result.trace.reviewContract?.gateDemotionsSuppressed||[]).length,
  'no gate demotion is recorded as having fired');
 assert.equal(ai.calls.length,2,'compose plus the single audit call; nothing follows the audit');
});

test('redesign Stage A: a reviewer-misattributed claim is removed whole by the audit, recorded, and disclosed',async()=>{
 const plan={version:'reader-evidence-v2',intent:'compare',
  sources:[{label:'David Hume',role:'primary',bookIds:['35']},
   {label:'Immanuel Kant',role:'primary',bookIds:['40']}],
  parts:[{id:'P1',question:'How does Hume explain causal necessity?',
    sourceBookIds:['35'],candidateSourceIds:['S1']},
   {id:'P2',question:'How does Kant explain causal necessity?',
    sourceBookIds:['40'],candidateSourceIds:['S2']}],queries:['Hume Kant causality']};
 const reviewPart=(_model,{messages})=>{
  const payload=parsePayload(messages);
  const part=payload.parts[0];
  const claim=payload.claims[0];
  const spanId=claim.sourceEvidence[0].spanIds[0];
  const conflict=part.partId==='P2';
  return {response:JSON.stringify({parts:[{partId:part.partId,status:'answered',
    answerStatus:'answered',directAnswerClaimIds:[claim.claimId]}],
   claims:[{claimId:claim.claimId,status:'answered',
    sources:[{sourceId:claim.sourceIds[0],status:'answered',spanIds:[spanId],
     ...(conflict?{attributionStatus:'conflict',attributedSpeaker:'David Hume'}:
      {attributionStatus:'supported',attributedSpeaker:'David Hume'})}]}]})};
 };
 const ai=makeAI([
  answer('PART P1\nHume says necessity arises from regular conjunction and the mind’s habitual inference. [S1]\n'+
   'PART P2\nKant says necessity arises from regular conjunction and the mind’s habitual inference. [S2]'),
  reviewPart,reviewPart],{decorateReview:false});
 const result=await composeEvidenceAnswer(
  'How do Hume and Kant each explain causal necessity?',
  [hume,kant],ai,[],{plan,catalog,trace:true});
 assert.match(result.answer,/Hume says necessity arises/);
 assert.doesNotMatch(result.answer,/Kant says necessity arises/,
  'the misattributed claim is removed whole, not relabeled or rewritten');
 assert.ok(result.trace.reviewContract.supportIssues.some(issue=>
   issue.claimId==='P2-C1'&&issue.reason==='source-attribution-conflict'),
  'the removal is recorded with its reason');
 const kantPart=result.questionParts.find(part=>part.partId==='P2');
 assert.deepEqual(kantPart.claimIds,[],'no claim ships for the misattributed part');
 assert.match(result.answer,/This part of the question could not be answered from the library:/,
  'the loss is disclosed to the reader in the answer text');
 assert.ok((result.trace.final.absentPartLabelsInAnswer||[]).includes('P2'));
 assert.deepEqual(result.trace.final.disclosureLabelVerification.missing,[],
  'every recorded disclosure label is present verbatim in the shipped text');
 assert.ok(result.trace.final.disclosureLabelVerification.checked>=1);
 assert.equal(ai.calls.length,3,'compose plus one audit call per part; nothing follows the audit');
});

test('stage B.2 gate: a claim crediting a letter to its recipient is removed, and the removal is recorded',async()=>{
 // The phase-3 Death shape as a fixture: Sulpicius writes TO
 // Cicero; the draft credits Cicero with the letter's content.
 // The reviewer is the judge and accepts the claim. Stage A only
 // recorded the direction flag; the flag then measured 3/3
 // precision in the Stage B.1 validation, so B.2 gives it a
 // narrow gate: recipient- and volume-author-role credits are
 // removed whole. This fixture's only claim is gated, so the
 // whole answer is suppressed and the removal is recorded.
 const source={id:'S1',bookId:'80',title:'Letters — Marcus Tullius Cicero',
  page:9,url:'https://example.test/letters#page=9',
  text:'Servius Sulpicius To Cicero, greetings. I have received your letter, and I urge you to let reason restrain your grief, for excessive sorrow profits nothing.',
  preview:'Servius Sulpicius To Cicero, greetings.'};
 const plan={version:'reader-evidence-v2',intent:'explain',
  sources:[{label:'Marcus Tullius Cicero',role:'primary',bookIds:['80']}],
  parts:[{id:'P1',question:'What counsel does the letter offer about grief?',
   sourceBookIds:['80'],searchQueries:['grief reason restrain'],
   candidateSourceIds:['S1']}],queries:['grief counsel']};
 const ai=makeAI([
  answer('PART P1\nCicero argues that reason should restrain grief, since excessive sorrow profits nothing. [S1]'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer(
  'What counsel does the letter offer about grief?',
  [source],ai,[],{plan,catalog:{80:'Letters — Marcus Tullius Cicero'},trace:true});
 assert.doesNotMatch(result.answer,/Cicero argues that reason should restrain grief/,
  'the gated claim does not ship');
 assert.deepEqual(result.trace.final.bylineDirectionFlags,
  [{partId:'P1',claimId:'P1-C1',sourceId:'S1',
    creditedName:'Cicero',bylineAuthor:'Servius Sulpicius',
    creditedRole:'recipient'}],
  'the flag itself is still recorded');
 assert.deepEqual(result.trace.final.bylineGateRemovals,
  [{partId:'P1',claimId:'P1-C1',sourceId:'S1',
    creditedName:'Cicero',bylineAuthor:'Servius Sulpicius',
    creditedRole:'recipient'}],
  'the removal is recorded with the flag that caused it');
});

test('stage B.4 gate shadow: unflagged siblings restating a gated letter are removed; correct credits and low-coverage claims survive',async()=>{
 // The phase-3 death shape, extended past the B.2 gate fixture.
 // The gate sees only claims that cite the letter AND raise a
 // direction flag. Two siblings restate the same letter under the
 // same wrong name without ever being flagged: one names the
 // recipient but cites the recipient's OWN letter (its flag scan
 // sees a correct credit), and one is a pronoun claim citing the
 // letter itself (no extracted subject to flag). The shadow
 // removes both. Controls: a claim
 // crediting the letter's real author survives at full coverage,
 // a low-coverage claim citing the letter survives, and a claim
 // naming the same man in an UNGATED part (his own letter)
 // survives untouched.
 const letter={id:'S1',bookId:'80',title:'Letters — Marcus Tullius Cicero',
  page:9,url:'https://example.test/letters#page=9',
  text:'Servius Sulpicius To Cicero (At Astura, 5 March). My dear Cicero, I was as much grieved as you could be at the death of Tullia, and I write to urge that the magnitude of a loss should be measured by what it deprives someone of, not merely by its objective importance, for time itself consoles what reason cannot. I urge you to let reason restrain your grief, for excessive sorrow profits nothing.',
  preview:'Servius Sulpicius To Cicero (At Astura, 5 March).'};
 const ownLetter={id:'S2',bookId:'81',title:'Letters — Marcus Tullius Cicero',
  page:12,url:'https://example.test/letters#page=12',
  text:'Marcus Tullius Cicero To Atticus, greetings. Reflect that fortune has snatched from us country, honour, rank, every political distinction, and I set down my own thoughts on grief.',
  preview:'Marcus Tullius Cicero To Atticus, greetings.'};
 const plan={version:'reader-evidence-v2',intent:'explain',
  sources:[{label:'Marcus Tullius Cicero',role:'primary',bookIds:['80','81']}],
  parts:[{id:'P1',question:'What counsel does the letter offer about grief and loss?',
   sourceBookIds:['80'],searchQueries:['grief magnitude of a loss'],
   candidateSourceIds:['S1']},
   {id:'P2',question:'What does Cicero himself write about fortune?',
   sourceBookIds:['81'],searchQueries:['fortune country honour rank'],
   candidateSourceIds:['S2']}],queries:['grief counsel']};
 const draft='PART P1\n'+
  'Cicero argues that reason should restrain grief, since excessive sorrow profits nothing. [S1]\n'+
  'Cicero attempts to offer consolation to a grieving friend, urging that the magnitude of a loss be measured by what it deprives someone of and that reason restrain grief. [S2]\n'+
  'Sulpicius writes that time itself consoles what reason cannot. [S1]\n'+
  'He also discusses the household accounts at length. [S1]\n'+
  'He urges that a loss be measured by what it deprives someone of, and adds that its objective importance matters less. [S1]\n'+
  'PART P2\n'+
  'Cicero writes that fortune has snatched from us country, honour, and rank. [S2]';
 // A bespoke reviewer: each claim is accepted against its own
 // cited source with a span that exists in that part's packet.
 const reviewer=(_model,{messages})=>{
  const payload=parsePayload(messages);
  const parts=payload.parts.map(part=>({partId:part.partId,status:'answered',
   answerStatus:'answered',
   directAnswerClaimIds:payload.claims
    .filter(claim=>claim.partId===part.partId).slice(0,1)
    .map(claim=>claim.claimId),
   retainedContextClaimIds:[]}));
  const claims=payload.claims.map(claim=>{
   const people=claimPersonSubjects(claim.text);
   return {claimId:claim.claimId,status:'answered',
    sources:claim.sourceIds.map(sourceId=>({sourceId,status:'answered',
     spanIds:[sourceId==='S1'?'S1-Q2':'S2-Q1'],
     ...(people.length?{subjectAttributionStatus:'supported',
      attributedSubject:people[0]}:{})}))};
  });
  return {response:JSON.stringify({parts,claims})};
 };
 const ai=makeAI([answer(draft),reviewer,reviewer]);
 const result=await composeEvidenceAnswer(
  'What counsel does the letter offer about grief and loss?',
  [letter,ownLetter],ai,[],{plan,
   catalog:{80:'Letters — Marcus Tullius Cicero',81:'Letters — Marcus Tullius Cicero'},
   trace:true});
 assert.deepEqual(result.trace.final.bylineGateRemovals.map(r=>r.claimId),
  ['P1-C1'],'the gate itself removes only the flagged claim');
 assert.deepEqual(result.trace.final.frameGateShadowRemovals,
  [{partId:'P1',claimId:'P1-C2',sourceId:'S1',creditedName:'Cicero',
    bylineAuthor:'Servius Sulpicius',via:'names-credited',
    coverageRatio:0.692},
   {partId:'P1',claimId:'P1-C5',sourceId:'S1',creditedName:'Cicero',
    bylineAuthor:'Servius Sulpicius',via:'cites-gated-source',
    coverageRatio:0.833}],
  'the shadow removes the cross-cited sibling and the covered pronoun sibling');
 assert.doesNotMatch(result.answer,/attempts to offer consolation/,
  'the cross-cited sibling does not ship');
 assert.doesNotMatch(result.answer,/objective importance matters less/,
  'the covered pronoun sibling does not ship');
 assert.match(result.answer,/Sulpicius writes that time itself consoles/,
  'the claim crediting the real author survives');
 assert.match(result.answer,/household accounts/,
  'the low-coverage claim citing the letter survives');
 assert.match(result.answer,/fortune has snatched from us country, honour, and rank/,
  'the same name in an ungated part is untouched');
});


test('redesign Stage A: the pronoun-orphan flag is recorded and never acted on',async()=>{
 const source={id:'S1',bookId:'35',title:catalog[35],page:7,
  url:'https://example.test/plato#page=7',
  text:'The soul, Socrates argues, survives the body and is not dissolved by death, since it is simple and uncompounded in nature.',
  preview:'The soul survives the body.'};
 const plan={version:'reader-evidence-v2',intent:'explain',
  sources:[{label:'David Hume',role:'primary',bookIds:['35']}],
  parts:[{id:'P1',question:'What is argued about the soul and death?',
   sourceBookIds:['35'],searchQueries:['soul survives body'],
   candidateSourceIds:['S1']}],queries:['soul death']};
 const ai=makeAI([
  answer('PART P1\nHe argues that the soul survives the body and is not dissolved by death. [S1]'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer(
  'What is argued about the soul and death?',
  [source],ai,[],{plan,catalog,trace:true});
 assert.match(result.answer,/He argues that the soul survives the body/,
  'the claim ships: the flag is record-only and removes nothing');
 assert.deepEqual(result.trace.final.pronounOrphanFlags,
  [{partId:'P1',paragraphIndex:0,pronoun:'He'}]);
});

// ---------------------------------------------------------------------------
// Stage B tranche 1 (B0 solitude shape, B2, B5, B6): pilot-route tests.
// ---------------------------------------------------------------------------

test('stage B B0: the solitude shape ships — a cited part carries the answer while the uncited source-required part is labeled, not containing',async()=>{
 // Phase-3 solitude AP1: one part's evidence honestly did not
 // support it, and the old strict-minority rule suppressed the
 // whole build including the other part's fully supported draft.
 // Here P1 ships cited; P2 is source-required and its claim
 // stays uncited — under B0 it ships labeled instead of vetoing.
 const p1Source={...hume,candidatePartIds:['P1'],
  candidatePartSupport:[{partId:'P1',support:'context'}]};
 const p2Source={...kant,candidatePartIds:['P2'],
  candidatePartSupport:[{partId:'P2',support:'direct'}]};
 const plan={version:'reader-evidence-v2',intent:'explain',
  sources:[{label:'David Hume',role:'primary',bookIds:['35']},
   {label:'Immanuel Kant',role:'primary',bookIds:['40']}],
  parts:[{id:'P1',question:'How does Hume explain causal necessity?',
   sourceBookIds:[],searchQueries:['Hume necessity custom'],
   candidateSourceIds:['S1']},
   {id:'P2',question:'How does Kant explain causal necessity?',
   sourceBookIds:['40'],searchQueries:['Kant causality a priori'],
   candidateSourceIds:['S2']}],
  queries:['Hume necessity custom','Kant causality a priori']};
 const reviewAll=(_model,{messages})=>{
  const payload=parsePayload(messages);
  const reviewParts=payload.parts.map(part=>{
   const contextIds=(part.contextClaims||[]).map(claim=>claim.claimId);
   const claimIds=payload.claims.filter(claim=>claim.partId===part.partId)
    .map(claim=>claim.claimId);
   return {partId:part.partId,status:'answered',answerStatus:'answered',
    directAnswerClaimIds:[...claimIds,...contextIds],
    retainedContextClaimIds:contextIds};
  });
  return {response:JSON.stringify({parts:reviewParts,
   claims:payload.claims.map(claim=>({claimId:claim.claimId,status:'answered',
    sources:claim.sourceIds.map(sourceId=>({sourceId,status:'answered',
     spanIds:[claim.sourceEvidence.find(item=>item.sourceId===sourceId).spanIds[0]]}))}))})};
 };
 const draft='PART P1\nHume links necessity to custom and regular conjunction. [S1]\n\n'+
  'PART P2\nKant presents causal order through the structure of human understanding.';
 const ai=makeAI([answer(draft),reviewAll,answer(draft),reviewAll],
  {decorateReview:false});
 const result=await composeEvidenceAnswer(
  'How does Hume explain causal necessity and how does Kant explain it?',
  [p1Source,p2Source],ai,[],{plan,catalog,trace:true});
 assert.equal(result.outcome,'verified-source-draft');
 const containment=result.trace.sourceRequiredContainment;
 assert.equal(containment.disposition,'answer-level-shipped-with-uncited-parts');
 assert.deepEqual(containment.partDispositions.find(entry=>entry.partId==='P1'),
  {partId:'P1',sourceRequired:true,cited:true,disposition:'shipped-cited'});
 assert.deepEqual(containment.partDispositions.find(entry=>entry.partId==='P2'),
  {partId:'P2',sourceRequired:true,cited:false,disposition:'shipped-labeled'});
 assert.equal(containment.uncitedFraction,1/2);
 assert.match(result.answer,/Hume links necessity to custom/);
 assert.match(result.answer,/Kant presents causal order/,
  'the uncited source-required part ships its reviewed prose');
 // Stage B (B4): the uncited source-required part opens with the
 // general-context framing line, ahead of its prose.
 assert.match(result.answer,
  /No library passages could be verified for this part of the question; what follows is general knowledge\.\nKant presents causal order/);
 assert.deepEqual(result.trace.final.generalContextFraming,
  [{scope:'part',partId:'P2'}]);
 assert.match(result.answer,
  /Retrieved passages could not be verified as supporting this part of the question: How does Kant explain causal necessity\?/);
});

test('stage B B5: an invalid-citation-format rejection records the sentence text and the failing token',async()=>{
 const ai=makeAI([answer('PART P1\nHume links necessity to custom and regular conjunction. [S1, S2a]\n'+
   'Hume also treats custom as the great guide of human life. [S1]'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true});
 assert.equal(result.outcome,'verified-source-draft');
 const record=result.trace.rejected.find(item=>item.reason==='invalid-citation-format');
 assert.ok(record,'the malformed citation group is rejected at validation');
 assert.match(record.text,/Hume links necessity to custom and regular conjunction/);
 assert.deepEqual(record.failingElement.invalidIds,['S2a'],
  'the record names the exact token that failed the format check');
 assert.deepEqual(record.failingElement.groups,['[S1, S2a]']);
 assert.match(result.answer,/great guide of human life/,
  'the well-formed sentence is untouched');
});

test('stage B.1: a citation group carrying a printed page element is repaired, not rejected (the narrators shape)',async()=>{
 // Stage B validation, narrators in BOTH passes: the packet was
 // strong and the draft complete, but the composer cited
 // [S2, 50] — span plus printed page in one bracket — and every
 // sentence was rejected as invalid-citation-format, collapsing
 // the case into an insufficient-evidence refusal. (The same
 // shape killed phase-3 guilt AP1 under Stage A.) A bare page
 // element beside a well-formed source ID is unambiguous: strip
 // the page element, keep the citation, record the repair.
 const ai=makeAI([answer('PART P1\nHume links necessity to custom and regular conjunction. [S1, 12]\n'+
   'Hume also treats custom as the great guide of human life. [S1, p. 12]'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true});
 assert.equal(result.outcome,'verified-source-draft');
 assert.match(result.answer,/Hume links necessity to custom/);
 assert.match(result.answer,/great guide of human life/);
 const repairs=(result.trace.citationFormatRepairs||[])
  .filter(repair=>repair.kind==='page-element-stripped');
 assert.deepEqual(repairs.map(repair=>repair.from),['[S1, 12]','[S1, p. 12]'],
  'both page-element shapes are repaired and recorded');
 assert.ok(repairs.every(repair=>repair.to==='[S1]'));
 assert.ok(!(result.trace.rejected||[])
  .some(item=>item.reason==='invalid-citation-format'),
  'no sentence is rejected for the repaired format');
});

test('stage B.1: a compose call cancelled unconfirmed is retried once (the Conrad SP2 shape)',async()=>{
 const cancel=Object.assign(new Error('Inference call cancelled before confirmation'),{
  code:'inference-cancel-unconfirmed',stage:'compose'});
 const ai=makeAI([cancel,
  answer('PART P1\nHume links necessity to custom and regular conjunction. [S1]'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true});
 assert.equal(ai.calls.length,3,'compose, its retry, then the review');
 assert.deepEqual(result.trace.composeRetry,
  {attempted:true,reason:'inference-cancel-unconfirmed',applied:true});
 assert.equal(result.outcome,'verified-source-draft');
 assert.match(result.answer,/custom and regular conjunction/);
});

test('stage B.1 B4 scoping: an assembly loss that touches no requirement is labeled as a lost supporting point, not a partially answered part',async()=>{
 // Stage B progress AP1: every requirement of the part was
 // answered by shipped cited claims, one further claim was lost
 // at assembly, and the label still announced the whole part as
 // only partially answered — contradicting the case's own full
 // coverage record. When the lost claims served no recorded
 // requirement and coverage is complete, the label scopes to the
 // lost point. (The B3 fixture above is the counter-case: its
 // lost claim served the part's requirement, and the part-level
 // wording stands there.)
 const plan={version:'reader-evidence-v2',intent:'explain',
  sources:[{label:'Immanuel Kant',role:'primary',bookIds:['40']}],
  parts:[{id:'P1',question:'How do the categories structure experience?',
   sourceBookIds:['40'],searchQueries:['Kant categories experience'],
   candidateSourceIds:['S2'],
   requirements:[{id:'P1-R1',text:'Explain causality as a category of the understanding.'},
    {id:'P1-R2',text:'Explain how the categories structure experience.'}]}],
  queries:['Kant categories experience']};
 const draft='PART P1\nCausality is a pure conception of the understanding and a category of relation. [S2]\n'+
  'The categories structure experience by unifying the manifold of intuition. [S2]\n'+
  'The categories guarantee the synthetic unity of every possible perception. [S2]';
 const reviewResponder=(_model,{messages})=>{
  const payload=parsePayload(messages);
  const spanFor=claim=>claim.sourceEvidence[0].spanIds[0];
  const claims=payload.claims.map(claim=>{
   const partial=claim.text.includes('synthetic unity of every possible perception');
   return {claimId:claim.claimId,status:partial?'partial':'answered',
    sources:claim.sourceIds.map(sourceId=>({sourceId,status:'answered',
     spanIds:[spanFor(claim)]}))};
  });
  const parts=payload.parts.map(part=>({partId:part.partId,status:'answered',
   answerStatus:'answered',
   directAnswerClaimIds:payload.claims.map(claim=>claim.claimId),
   retainedContextClaimIds:[],
   requirementCoverage:[
    {requirementId:'P1-R1',status:'answered',answerClaimIds:[payload.claims[0].claimId]},
    {requirementId:'P1-R2',status:'answered',answerClaimIds:[payload.claims[1].claimId]}]}));
  return {response:JSON.stringify({parts,claims})};
 };
 const ai=makeAI([answer(draft),reviewResponder,answer(draft),reviewResponder],
  {decorateReview:false});
 const result=await composeEvidenceAnswer(
  'How do the categories structure experience?',[kant],ai,[],{plan,catalog,trace:true});
 assert.equal(result.outcome,'verified-source-draft');
 assert.match(result.answer,/category of relation/);
 assert.match(result.answer,/unifying the manifold of intuition/);
 assert.doesNotMatch(result.answer,/synthetic unity of every possible perception/,
  'the partial-gated claim still does not ship');
 assert.equal(result.trace.assemblyLossSummary.total,1);
 assert.match(result.answer,
  /A supporting point in this part of the question could not be included: /,
  'the label scopes to the lost point when coverage is complete');
 assert.doesNotMatch(result.answer,/could only be partially answered/);
 const labelRecord=(result.trace.final.disclosureLabels||[])
  .find(entry=>entry.partId==='P1');
 assert.equal(labelRecord?.kind,'assembly-loss');
 assert.equal(labelRecord?.scope,'claim',
  'the disclosure record carries the label scope');
});

test('stage B B2: a contents-page citation does not count as substantive support for containment',async()=>{
 // The phase-2 Hobbes shape in miniature: the part's only cited
 // source is a table-of-contents page. The reviewer accepts the
 // claim, but contents leaders are apparatus — the source is
 // excluded from the part's support, the part counts uncited,
 // and (a sibling being cited) it ships labeled under B0.
 const toc={id:'S3',bookId:'40',title:catalog[40],page:7,url:'https://example.test/kant#page=7',
  text:'Contents\nChapter One: The Categories of Relation . . . 12\nChapter Two: The Deductions of the Understanding . . . 27\nChapter Three: The Schematism of the Concepts . . . 41',
  preview:'Contents of the work.',candidatePartIds:['P2']};
 const plan={version:'reader-evidence-v2',intent:'explain',
  sources:[{label:'David Hume',role:'primary',bookIds:['35']},
   {label:'Immanuel Kant',role:'primary',bookIds:['40']}],
  parts:[{id:'P1',question:'How does Hume explain causal necessity?',
   sourceBookIds:['35'],searchQueries:['Hume necessity custom'],
   candidateSourceIds:['S1']},
   {id:'P2',question:'How is Kant’s work organized?',
   sourceBookIds:['40'],searchQueries:['Kant categories deductions'],
   candidateSourceIds:['S3']}],
  queries:['Hume necessity custom','Kant categories deductions']};
 const reviewAll=(_model,{messages})=>{
  const payload=parsePayload(messages);
  const reviewParts=payload.parts.map(part=>({partId:part.partId,
   status:'answered',answerStatus:'answered',
   directAnswerClaimIds:payload.claims.filter(claim=>claim.partId===part.partId)
    .map(claim=>claim.claimId),retainedContextClaimIds:[]}));
  return {response:JSON.stringify({parts:reviewParts,
   claims:payload.claims.map(claim=>({claimId:claim.claimId,status:'answered',
    sources:claim.sourceIds.map(sourceId=>({sourceId,status:'answered',
     spanIds:[claim.sourceEvidence.find(item=>item.sourceId===sourceId).spanIds[0]]}))}))})};
 };
 const draft='PART P1\nHume links necessity to custom and regular conjunction. [S1]\n\n'+
  'PART P2\nKant organizes the work around the categories of relation and the deductions that follow. [S3]';
 const ai=makeAI([answer(draft),reviewAll,answer(draft),reviewAll],
  {decorateReview:false});
 const result=await composeEvidenceAnswer(
  'How does Hume explain causal necessity, and how is Kant’s work organized?',
  [hume,toc],ai,[],{plan,catalog,trace:true});
 assert.equal(result.outcome,'verified-source-draft');
 const containment=result.trace.sourceRequiredContainment;
 assert.deepEqual(containment.apparatusExcludedSourceIds,['S3']);
 assert.deepEqual(containment.uncitedPartIds,['P2'],
  'the contents-cited part counts uncited for containment');
 const p2Disposition=containment.partDispositions.find(entry=>entry.partId==='P2');
 assert.deepEqual(p2Disposition.apparatusExcludedSourceIds,['S3']);
 assert.equal(p2Disposition.disposition,'shipped-labeled');
 assert.match(result.answer,/Retrieved passages could not be verified as supporting this part of the question/);
});

test('stage B B2: shipped apparatus citations are recorded with their framing, and the packet marks apparatus spans',async()=>{
 // The edition's introduction occupies its own page; the work's
 // text begins on the next. Claims resting on the introduction
 // page's span are recorded as apparatus citations — one framed
 // as the edition's introduction (framed:true), one presenting
 // the editor's survey as the author's own act (framed:false).
 // The introduction source is apparatus-only, so containment
 // excludes it; the part still counts cited through the text
 // page, the answer ships, and nothing is removed: the record
 // is the measurement, per the standing record-only rule.
 const introPage={id:'S4',bookId:'99',title:'Essays on Causation — David Hume',page:11,
  url:'https://example.test/essays#page=11',
  text:'Editor’s Introduction\nThe editor presents the author’s argument as a defence of custom against rationalist accounts of causation, surveying the essays in the order of their composition and noting where the author revised his views for the second edition.',
  preview:'The edition’s introduction.',candidatePartIds:['P1']};
 const textPage={id:'S5',bookId:'99',title:'Essays on Causation — David Hume',page:12,
  url:'https://example.test/essays#page=12',
  text:'Our idea of necessity and causation arises entirely from the uniformity observable in nature, where similar objects are constantly conjoined together, and the mind is determined by custom to infer one from the other, so that causal reasoning rests on experienced conjunction rather than on any impression of necessary connection in the objects themselves.',
  preview:'The work’s opening text.',candidatePartIds:['P1']};
 const plan={version:'reader-evidence-v2',intent:'explain',
  sources:[{label:'David Hume',role:'primary',bookIds:['99']}],
  parts:[{id:'P1',question:'How does Hume explain causal necessity?',
   sourceBookIds:['99'],searchQueries:['Hume necessity custom'],
   candidateSourceIds:['S4','S5']}],
  queries:['Hume necessity custom']};
 let reviewPayload;
 const reviewMixed=(_model,{messages})=>{
  reviewPayload=parsePayload(messages);
  const spanByMarker=marker=>reviewPayload.spanCatalog
   .find(span=>span.text.includes(marker));
  const spanForClaim={
   'P1-C1':spanByMarker('editor presents'),
   'P1-C2':spanByMarker('editor presents'),
   'P1-C3':spanByMarker('uniformity observable')};
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
    answerStatus:'answered',directAnswerClaimIds:['P1-C3'],
    retainedContextClaimIds:[]}],
   claims:reviewPayload.claims.map(claim=>{const sourceId=claim.sourceIds[0];
    return {claimId:claim.claimId,status:'answered',
     sources:[{sourceId,status:'answered',
      spanIds:[spanForClaim[claim.claimId].spanId]}]};})})};
 };
 const ai=makeAI([answer('PART P1\nThe edition’s introduction presents the argument as a defence of custom against rationalist accounts. [S4]\n'+
   'The author surveys the essays in the order of their composition. [S4]\n'+
   'Hume holds that our idea of necessity arises from the uniformity observable in nature and the mind’s determination by custom. [S5]'),
  reviewMixed],{decorateReview:false});
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',
  [introPage,textPage],ai,[],{plan,catalog:{...catalog,99:introPage.title},trace:true});
 assert.equal(result.outcome,'verified-source-draft');
 const introSpan=reviewPayload.spanCatalog.find(span=>span.text.includes('editor presents'));
 const bodySpan=reviewPayload.spanCatalog.find(span=>span.text.includes('uniformity observable'));
 assert.equal(introSpan.region,'apparatus',
  'the packet catalog marks the introduction span as apparatus for the audit');
 assert.equal(bodySpan.region,undefined,
  'the work’s own prose carries no apparatus marker');
 assert.deepEqual(result.trace.final.apparatusCitations,[
  {partId:'P1',claimId:'P1-C1',sourceId:'S4',framed:true},
  {partId:'P1',claimId:'P1-C2',sourceId:'S4',framed:false}],
  'both introduction-resting claims are recorded; the body claim is not');
 assert.deepEqual(result.trace.sourceRequiredContainment.apparatusExcludedSourceIds,['S4'],
  'the apparatus-only introduction source is excluded from the support count');
 assert.deepEqual(result.trace.sourceRequiredContainment.citedPartIds,['P1'],
  'the part still counts cited through its text-page source');
});

const b6TolstoySource={id:'S1',bookId:'258',title:'War and Peace — Leo Tolstoy',
 page:901,url:'https://example.test/warpeace#page=901',
 text:'The life of nations is not contained in the lives of a few men, for the connection between those men and the nations has not been found. What moves nations is not the will of heroes but the sum of innumerable individual acts, each too small to direct the whole.',
 preview:'The life of nations is not contained in the lives of a few men.'};
const b6TolstoyPlan={version:'reader-evidence-v2',intent:'explain',
 sources:[{label:'Leo Tolstoy',role:'primary',bookIds:['258']}],
 parts:[{id:'P1',question:'How does Tolstoy explain historical movement?',
  sourceBookIds:['258'],searchQueries:['Tolstoy nations movement'],
  candidateSourceIds:['S1']}],
 queries:['Tolstoy nations movement']};
const b6ReviewAcceptingCitedOnly=(_model,{messages})=>{
 const payload=parsePayload(messages);
 const cited=payload.claims.filter(claim=>(claim.sourceIds||[]).length);
 return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
   answerStatus:'answered',
   directAnswerClaimIds:cited.map(claim=>claim.claimId),
   retainedContextClaimIds:[]}],
  claims:cited.map(claim=>({claimId:claim.claimId,status:'answered',
   sources:claim.sourceIds.map(sourceId=>({sourceId,status:'answered',
    spanIds:[claim.sourceEvidence.find(item=>item.sourceId===sourceId).spanIds[0]]}))}))})};
};

test('stage B B6: the Tolstoy shape — a naming sentence removed as context is retained when the part opens on a pronoun',async()=>{
 const ai=makeAI([answer('PART P1\nTolstoy frames historical movement as the aggregate of innumerable individual acts rather than the will of heroes.\n'+
   'He contends that the life of nations is not contained within the lives of a few prominent men. [S1]'),
  b6ReviewAcceptingCitedOnly],{decorateReview:false});
 const result=await composeEvidenceAnswer('How does Tolstoy explain historical movement?',
  [b6TolstoySource],ai,[],{plan:b6TolstoyPlan,
   catalog:{258:'War and Peace — Leo Tolstoy'},trace:true});
 assert.equal(result.outcome,'verified-source-draft');
 assert.deepEqual(result.trace.final.namingSentenceRetentions,
  [{partId:'P1',claimId:'P1-C1',name:'Tolstoy',
   sentence:'Tolstoy frames historical movement as the aggregate of innumerable individual acts rather than the will of heroes.'}]);
 assert.match(result.answer,/^Tolstoy frames historical movement/,
  'the retained naming sentence heads the part');
 assert.match(result.answer,/He contends that the life of nations/,
  'the cited claim still ships after it');
 assert.deepEqual(result.trace.final.pronounOrphanFlags,[],
  'no orphan ships: the flag’s own shape is cured by the retention');
});

test('stage B B6: the Aurelius shape — a bigram naming sentence removed as context is retained',async()=>{
 const source={id:'S1',bookId:'18',title:'Meditations — Marcus Aurelius',
  page:64,url:'https://example.test/meditations#page=64',
  text:'Each impression that arrives should be tested before it is accepted, for the mind adds judgments to events and then suffers from its own additions more than from the events themselves.',
  preview:'Each impression should be tested before it is accepted.'};
 const plan={version:'reader-evidence-v2',intent:'explain',
  sources:[{label:'Marcus Aurelius',role:'primary',bookIds:['18']}],
  parts:[{id:'P1',question:'How does Marcus Aurelius counsel treating impressions?',
   sourceBookIds:['18'],searchQueries:['Aurelius impressions judgment'],
   candidateSourceIds:['S1']}],
  queries:['Aurelius impressions judgment']};
 const ai=makeAI([answer('PART P1\nMarcus Aurelius writes his meditations as exercises addressed to himself, testing each impression before assent.\n'+
   'He treats each impression as material for judgment rather than as a command. [S1]'),
  b6ReviewAcceptingCitedOnly],{decorateReview:false});
 const result=await composeEvidenceAnswer('How does Marcus Aurelius counsel treating impressions?',
  [source],ai,[],{plan,catalog:{18:'Meditations — Marcus Aurelius'},trace:true});
 assert.equal(result.outcome,'verified-source-draft');
 assert.deepEqual(result.trace.final.namingSentenceRetentions,
  [{partId:'P1',claimId:'P1-C1',name:'Marcus Aurelius',
   sentence:'Marcus Aurelius writes his meditations as exercises addressed to himself, testing each impression before assent.'}]);
 assert.match(result.answer,/^Marcus Aurelius writes his meditations/);
});

test('stage B B6 negative control: a naming claim removed as an unsupported CITED claim is never retained',async()=>{
 const reviewRejectingC1=(_model,{messages})=>{
  const payload=parsePayload(messages);
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
    answerStatus:'answered',directAnswerClaimIds:['P1-C2'],
    retainedContextClaimIds:[]}],
   claims:[{claimId:'P1-C1',status:'unsupported',
     sources:[{sourceId:'S1',status:'unsupported',spanIds:[]}]},
    {claimId:'P1-C2',status:'answered',
     sources:[{sourceId:'S1',status:'answered',
      spanIds:[payload.claims.find(claim=>claim.claimId==='P1-C2')
       .sourceEvidence[0].spanIds[0]]}]}]})};
 };
 const ai=makeAI([answer('PART P1\nTolstoy frames historical movement as the aggregate of innumerable individual acts. [S1]\n'+
   'He contends that the life of nations is not contained within the lives of a few prominent men. [S1]'),
  reviewRejectingC1],{decorateReview:false});
 const result=await composeEvidenceAnswer('How does Tolstoy explain historical movement?',
  [b6TolstoySource],ai,[],{plan:b6TolstoyPlan,
   catalog:{258:'War and Peace — Leo Tolstoy'},trace:true});
 assert.equal(result.trace.final.namingSentenceRetentions,undefined,
  'retention is for context removals only — an unsupported removal stays removed');
 assert.match(result.answer,/^He contends that the life of nations/,
  'the pronoun opening ships as-is (the record-only flag’s domain)');
});

test('stage B B6 negative control: no pronoun opening, no retention — and a name established by an earlier part blocks retention',async()=>{
 const ai=makeAI([answer('PART P1\nTolstoy frames historical movement as the aggregate of innumerable individual acts.\n'+
   'Tolstoy contends that the life of nations is not contained within the lives of a few prominent men. [S1]'),
  b6ReviewAcceptingCitedOnly],{decorateReview:false});
 const result=await composeEvidenceAnswer('How does Tolstoy explain historical movement?',
  [b6TolstoySource],ai,[],{plan:b6TolstoyPlan,
   catalog:{258:'War and Peace — Leo Tolstoy'},trace:true});
 assert.equal(result.trace.final.namingSentenceRetentions,undefined,
  'the part opens by naming its subject — nothing is orphaned, nothing retained');
 assert.match(result.answer,/^Tolstoy contends that the life of nations/);
});

// ---------------------------------------------------------------------------
// Stage B tranche 2 (B3): pilot-route tests.
// ---------------------------------------------------------------------------

test('stage B B3: a partial-gated loss is disclosed in requirement terms, counted as a first-class trace number, and flagged for unanimity',async()=>{
 // The phase-3 assembly-loss shape in miniature: P2's second
 // claim is judged 'partial' at claim level although its only
 // source decision accepts with a span — the dominant loss class
 // of the phase-3 census (24 of 25). The gate does not move (the
 // claim-level verdict is the audit's to give), but the loss is
 // no longer silent: the part carries a partially-answered label
 // naming the affected requirement, the disclosure is recorded,
 // the loss count is a first-class trace number, and the loss
 // record carries the record-only unanimity flag.
 const plan={version:'reader-evidence-v2',intent:'explain',
  sources:[{label:'David Hume',role:'primary',bookIds:['35']},
   {label:'Immanuel Kant',role:'primary',bookIds:['40']}],
  parts:[{id:'P1',question:'How does Hume explain causal necessity?',
   sourceBookIds:['35'],searchQueries:['Hume necessity custom'],
   candidateSourceIds:['S1']},
   {id:'P2',question:'How do the categories structure experience?',
   sourceBookIds:['40'],searchQueries:['Kant categories experience'],
   candidateSourceIds:['S2'],
   requirements:[{id:'P2-R1',text:'Explain how the categories structure experience.'}]}],
  queries:['Hume necessity custom','Kant categories experience']};
 const draft='PART P1\nHume links necessity to custom and regular conjunction. [S1]\n\n'+
  'PART P2\nThe categories are pure conceptions of the understanding and are a priori. [S2]\n'+
  'The categories guarantee the synthetic unity of experience across all appearances. [S2]';
 const reviewResponder=(_model,{messages})=>{
  const payload=parsePayload(messages);
  const spanFor=claim=>claim.sourceEvidence[0].spanIds[0];
  const claims=payload.claims.map(claim=>{
   const partial=claim.text.includes('synthetic unity');
   return {claimId:claim.claimId,status:partial?'partial':'answered',
    sources:claim.sourceIds.map(sourceId=>({sourceId,status:'answered',
     spanIds:[spanFor(claim)]}))};
  });
  const parts=payload.parts.map(part=>{
   const cited=payload.claims.filter(claim=>claim.partId===part.partId);
   return {partId:part.partId,status:'answered',answerStatus:'answered',
    directAnswerClaimIds:cited.map(claim=>claim.claimId),
    retainedContextClaimIds:(part.contextClaims||[]).map(claim=>claim.claimId),
    ...(part.partId==='P2'?{requirementCoverage:[{requirementId:'P2-R1',
      status:'answered',answerClaimIds:cited.map(claim=>claim.claimId)}]}:{})};
  });
  return {response:JSON.stringify({parts,claims})};
 };
 const ai=makeAI([answer(draft),reviewResponder,answer(draft),reviewResponder],
  {decorateReview:false});
 const result=await composeEvidenceAnswer(
  'How does Hume explain causal necessity, and how do the categories structure experience?',
  [hume,kant],ai,[],{plan,catalog,trace:true});
 assert.equal(result.outcome,'verified-source-draft');
 assert.match(result.answer,/pure conceptions of the understanding/,
  'the answered claim ships');
 assert.doesNotMatch(result.answer,/synthetic unity/,
  'the partial-gated claim still does not ship — the audit gate is unmoved');
 const losses=result.trace.assemblyLoss||[];
 assert.equal(losses.length,1,'exactly one loss is recorded');
 assert.deepEqual(losses[0],{partId:'P2',claimId:'P2-C2',
  reason:'claim-partial-not-shipped',disposition:'traced'},
  'the loss record names the gate that withheld the claim');
 assert.deepEqual(result.trace.assemblyLossSummary,
  {total:1,restored:0,byReason:{'claim-partial-not-shipped':1},byPart:{P2:1}},
  'the loss count is a first-class trace number');
 assert.deepEqual(result.trace.final.assemblyLossDisclosures,
  [{partId:'P2',claimId:'P2-C2'}],
  'the explained loss is disclosed, not only the unexplained class');
 assert.match(result.answer,
  /This part of the question could only be partially answered: Explain how the categories structure experience\./,
  'the label names the affected requirement and does not blame retrieval');
 const labelRecord=(result.trace.final.disclosureLabels||[])
  .find(entry=>entry.partId==='P2');
 assert.equal(labelRecord?.kind,'assembly-loss');
 assert.match(labelRecord?.text||'',/partially answered/);
});

test('stage B B3: a build with no assembly losses still reports the zero count',async()=>{
 const ai=makeAI([answer('PART P1\nHume links necessity to custom and regular conjunction. [S1]'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true});
 assert.equal(result.outcome,'verified-source-draft');
 assert.deepEqual(result.trace.assemblyLossSummary,
  {total:0,restored:0,byReason:{},byPart:{}},
  'the summary is emitted even when nothing was lost');
 assert.equal(result.trace.final.assemblyLossDisclosures,undefined,
  'no loss, no disclosure');
});

// ---------------------------------------------------------------------------
// Stage C bundle, as amended by Stage B.2: the passage-window,
// cross-work, and widened-orphan scans were deleted (two
// validations at ~0 precision; their tests went with them). What
// survives is the byline-trigger widening — and under B.2 the
// byline check has a narrow gate, so the Trajan test below now
// asserts removal, not just the flag.
// ---------------------------------------------------------------------------


test('stage C item 3 + B.2 gate: the Trajan shape — furniture ahead of the byline, the credited name is the volume author, and the claim is removed',async()=>{
 // Production shape (phase 3): the span head carries site
 // furniture (banner repeating the volume title, a bracketed
 // contents link, a roman-numeral letter number) ahead of
 // "Trajan To Pliny", inside a volume titled for Cicero; the
 // shipped claim credited Cicero with Trajan's letter.
 const source={id:'S1',bookId:'81',title:'Letters of Marcus Tullius Cicero',
  page:212,url:'https://example.test/cicero-letters#page=212',
  text:'Online Library of Liberty: Letters of Marcus Tullius Cicero   [Back to Table of Contents]  LXXII  Trajan To Pliny  The question concerning children who were exposed by their parents, and afterwards preserved by others, and educated in a state of servitude, though born free, has been frequently discussed; I am of opinion that the claims of those who assert their right of freedom should be allowed.',
  preview:'Trajan to Pliny, on children exposed by their parents.'};
 const plan={version:'reader-evidence-v2',intent:'explain',
  sources:[{label:'Marcus Tullius Cicero',role:'primary',bookIds:['81']}],
  parts:[{id:'P1',question:'What ruling does the letter give on children exposed by their parents?',
   sourceBookIds:['81'],searchQueries:['exposed children freedom servitude'],
   candidateSourceIds:['S1']}],queries:['exposed children ruling']};
 const ai=makeAI([
  answer('PART P1\nCicero discusses the legal rights of children who were exposed by their parents, arguing for their right to freedom regardless of their upbringing in servitude. [S1]'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer(
  'What ruling does the letter give on children exposed by their parents?',
  [source],ai,[],{plan,catalog:{81:'Letters of Marcus Tullius Cicero'},trace:true});
 assert.doesNotMatch(result.answer,/Cicero discusses the legal rights/,
  'the gated claim does not ship (volume-author role)');
 assert.deepEqual(result.trace.final.bylineDirectionFlags,
  [{partId:'P1',claimId:'P1-C1',sourceId:'S1',
    creditedName:'Cicero',bylineAuthor:'Trajan',
    creditedRole:'volume-author'}],
  'the widened flag is still recorded');
 assert.deepEqual(result.trace.final.bylineGateRemovals,
  [{partId:'P1',claimId:'P1-C1',sourceId:'S1',
    creditedName:'Cicero',bylineAuthor:'Trajan',
    creditedRole:'volume-author'}]);
});



// ---------------------------------------------------------------------------
// Stage B.2: byline gate (partial removal + record-only roles),
// the single-part extra review attempt, and coverage honesty.
// ---------------------------------------------------------------------------

test('stage B.2 gate: only the misdirected claim is removed — a correctly credited sibling claim ships',async()=>{
 const source={id:'S1',bookId:'80',title:'Letters — Marcus Tullius Cicero',
  page:9,url:'https://example.test/letters#page=9',
  text:'Servius Sulpicius To Cicero, greetings. I have received your letter, and I urge you to let reason restrain your grief, for excessive sorrow profits nothing.',
  preview:'Servius Sulpicius To Cicero, greetings.'};
 const plan={version:'reader-evidence-v2',intent:'explain',
  sources:[{label:'Marcus Tullius Cicero',role:'primary',bookIds:['80']}],
  parts:[{id:'P1',question:'What counsel does the letter offer about grief?',
   sourceBookIds:['80'],searchQueries:['grief reason restrain'],
   candidateSourceIds:['S1']}],queries:['grief counsel']};
 const ai=makeAI([
  answer('PART P1\nCicero argues that reason should restrain grief, since excessive sorrow profits nothing. [S1]\nSulpicius urges that reason should restrain grief, since excessive sorrow profits nothing. [S1]'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer(
  'What counsel does the letter offer about grief?',
  [source],ai,[],{plan,catalog:{80:'Letters — Marcus Tullius Cicero'},trace:true});
 assert.equal(result.outcome,'verified-source-draft');
 assert.doesNotMatch(result.answer,/Cicero argues that reason should restrain grief/,
  'the recipient-credit claim is removed');
 assert.match(result.answer,/Sulpicius urges that reason should restrain grief/,
  'the correctly credited claim ships');
 assert.equal(result.trace.final.bylineGateRemovals.length,1);
 assert.equal(result.trace.final.bylineGateRemovals[0].claimId,'P1-C1');
});

test('stage B.2 gate: an other-role byline flag stays record-only and the claim ships',async()=>{
 const source={id:'S1',bookId:'80',title:'Letters — Marcus Tullius Cicero',
  page:9,url:'https://example.test/letters#page=9',
  text:'Servius Sulpicius To Cicero, greetings. I have received your letter, and I urge you to let reason restrain your grief, for excessive sorrow profits nothing.',
  preview:'Servius Sulpicius To Cicero, greetings.'};
 const plan={version:'reader-evidence-v2',intent:'explain',
  sources:[{label:'Marcus Tullius Cicero',role:'primary',bookIds:['80']}],
  parts:[{id:'P1',question:'What counsel does the letter offer about grief?',
   sourceBookIds:['80'],searchQueries:['grief reason restrain'],
   candidateSourceIds:['S1']}],queries:['grief counsel']};
 const ai=makeAI([
  answer('PART P1\nAtticus argues that reason should restrain grief, since excessive sorrow profits nothing. [S1]'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer(
  'What counsel does the letter offer about grief?',
  [source],ai,[],{plan,catalog:{80:'Letters — Marcus Tullius Cicero'},trace:true});
 assert.match(result.answer,/Atticus argues that reason should restrain grief/,
  'an other-role credit is not gated — the gate is deliberately narrow');
 assert.deepEqual(result.trace.final.bylineDirectionFlags,
  [{partId:'P1',claimId:'P1-C1',sourceId:'S1',
    creditedName:'Atticus',bylineAuthor:'Servius Sulpicius',
    creditedRole:'other'}]);
 assert.deepEqual(result.trace.final.bylineGateRemovals,[]);
});

test('stage B.2: a single-part review that times out, then returns invalid JSON, recovers on the extra attempt (the progress AP2 shape)',async()=>{
 const timeout=()=>Object.assign(new Error('Inference deadline exceeded'),{
  stage:'review',code:'inference-deadline-exceeded',startedAt:Date.now()-45000
 });
 const ai=makeAI([answer('PART P1\nHume links causal expectation to custom and regular conjunction. [S1]'),
  timeout(),{response:'this is not a review'},review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true
 });
 assert.equal(ai.calls.length,4,'compose + initial review + two retries');
 assert.equal(result.outcome,'verified-source-draft',
  'the extra attempt recovers the answer instead of suppressing it');
 assert.equal(result.trace.reviewRetry.applied,true);
 assert.equal(result.trace.reviewRetry.parts[0].attempts,2);
 assert.equal(result.trace.reviewRetry.parts[0].outcome,'recovered');
 assert.equal(result.trace.reviewRetry.parts[0].retryFailureCode,'model-output-invalid-format',
  'the failed retry in the middle is still the recorded one');
});
test('stage B.2: coverage cannot read full over a claim-level uncited ship',async()=>{
 // The B34-2(ii) Faust shape (see its own test for the label
 // assertions): the wager condition — a direct-answer and
 // requirement claim — ships with no citation and is named in
 // claimLevelUncitedLabels, while the part otherwise answers
 // fully. Before B.2 this build reported coverage 'full'; the
 // uncited ledger now downgrades it. (A claim-scoped assembly
 // loss with all requirements answered does NOT downgrade —
 // that is a disclosed footnote, per the B.1 label semantics,
 // and the hamlet fixture above keeps its 'full'.)
 const faust={id:'S1',bookId:'888',title:'Faust — Johann Wolfgang von Goethe',page:44,
  url:'https://example.test/faust#page=44',
  text:'Faust speaks in the study: first let us agree the pact itself, '+
   'Mephistopheles, and strike the bargain here, and let the terms be set '+
   'down before any condition is named between us.',
  preview:'Faust speaks in the study: first let us agree the pact itself.'};
 const plan={version:'reader-evidence-v2',intent:'explain',
  sources:[{label:'Johann Wolfgang von Goethe',role:'primary',bookIds:['888']}],
  parts:[{id:'P1',question:'What is the condition of the wager Faust makes?',
   sourceBookIds:['888'],searchQueries:['Faust wager condition'],candidateSourceIds:['S1'],
   sourceRequired:true,
   requirements:[{id:'P1-R1',text:'State the condition on which Faust forfeits his soul.'}]}],
  queries:['Faust wager condition']};
 const draft='PART P1\n'+
  'In the study, Faust proposes the pact to Mephistopheles and agrees to strike the bargain there. [S1]\n\n'+
  'The wager\u2019s condition is that if Faust ever bids the passing moment stay, saying it is fair, that moment will be his last and his soul forfeit.\n\n'+
  'Goethe reworked the older Faust chapbooks, whose hero was damned outright, into this drama of striving.';
 const reviewResponder=({messages})=>{
  const payload=parsePayload(messages);
  const span=payload.spanCatalog.find(entry=>entry.text.includes('strike the bargain'));
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
    answerStatus:'answered',directAnswerClaimIds:['P1-C1','P1-C2'],
    retainedContextClaimIds:['P1-C2','P1-C3'],
    requirementCoverage:[{requirementId:'P1-R1',status:'answered',
     answerClaimIds:['P1-C1','P1-C2']}]}],
   claims:[{claimId:'P1-C1',status:'answered',
    attributedSubject:'Faust',attributedSpeaker:'Faust',
    sources:[{sourceId:'S1',status:'answered',spanIds:[span.spanId]}]}]})};
 };
 const ai=batch25RouterAI({reviewResponder,rescueResponder:b34RescueRefused,
  repairResponder:({messages})=>({response:JSON.stringify({parts:[]})}),
  draftText:draft});
 const result=await composeEvidenceAnswer(
  'What is the condition of the wager Faust makes?',[faust],ai,[],
  {plan,trace:true,catalog:{888:'Faust — Johann Wolfgang von Goethe'}});
 assert.deepEqual(result.trace.final?.claimLevelUncitedLabels,
  [{partId:'P1',claimIds:['P1-C2']}],
  'the uncited requirement claim is named in the ledger');
 assert.equal(result.coverage,'partial',
  'a claim-level uncited ship downgrades coverage from full');
});

test('stage B.5 ledger: a packed page linked to no part is recorded on the selection ledger at compose',async()=>{
 const selectionTrace={stage:'evidence-selection',status:'selected',
  excluded:[{id:'C7',reason:'six-page-packet-limit'}]};
 const ai=makeAI([answer('PART P1\nHume links necessity to custom and regular conjunction. [S1]'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',
  [hume,{...kant,candidateId:'C9',candidatePartIds:[]}],ai,[],
  {plan:onePartPlan,catalog,trace:true,selectionTrace});
 assert.equal(result.trace.stages[0],selectionTrace,
  'the gateway selection trace rides into the answer trace by reference');
 assert.deepEqual(selectionTrace.excluded,[
  {id:'C7',reason:'six-page-packet-limit'},
  {id:'C9',reason:'no-part-link',stage:'compose'}],
  'the Kant page packed under candidate C9 belongs to no part, so the composer drop is ledgered instead of silent');
});

// ---------------------------------------------------------------------
// Latency tranche fixtures: compact verdict format (item 1),
// claim-chunked reviews (item 2), timeout-split retry (item 4).

test('a nine-claim part reviews as two scoped chunk calls and merges before the audit (latency tranche)',async()=>{
 const sentences=['Custom guides human life.','Habit shapes inference.',
  'Repeated experience forms expectations.','One event follows another regularly.',
  'The mind learns from repeated conjunctions.','Custom directs ordinary expectations.',
  'Experience produces familiar associations.','Inference follows established habits.',
  'Repeated cases shape anticipation.'];
 const sourceText=sentences.join('\n\n');
 const source={...hume,id:'S1',text:sourceText,preview:sourceText};
 const scopes=[];
 const reviewFn=(_model,{messages})=>{
  const payload=parsePayload(messages);
  scopes.push(payload.reviewClaimIds);
  const spanId=payload.parts[0].evidence[0].spans[0].spanId;
  const claims=payload.reviewClaimIds.map(claimId=>({claimId,status:'answered',
   sources:[{sourceId:'S1',status:'answered',spanIds:[spanId]}]}));
  // The second chunk also returns a verdict for a claim outside its
  // scope; the merge must drop it, not duplicate or overwrite.
  if(payload.reviewClaimIds.length===4)
   claims.push({claimId:'P1-C1',status:'unanswered',sources:[]});
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
   directAnswerClaimIds:['P1-C1']}],claims})};
 };
 const ai=makeAI([answer('PART P1\n'+sentences.map(s=>s+' [S1]').join('\n\n')),
  reviewFn,reviewFn]);
 const result=await composeEvidenceAnswer('What guides human life?',[source],ai,[],{
  plan:onePartPlan,catalog,trace:true,transportDiagnostics:true});
 assert.equal(ai.calls.length,3,'compose plus two chunk calls');
 assert.deepEqual(scopes.map(scope=>scope.length),[5,4],
  'the part chunks at five claims per call');
 assert.deepEqual(scopes.flat(),['P1-C1','P1-C2','P1-C3','P1-C4','P1-C5',
  'P1-C6','P1-C7','P1-C8','P1-C9'],'the scopes partition the part’s claims in order');
 assert.equal(result.outcome,'verified-source-draft');
 assert.equal(result.coverage,'full');
 assert.ok(result.trace.reviewContract.valid);
 const reviewCalls=result.trace.inferenceCalls.filter(call=>call.stage==='review');
 assert.deepEqual(reviewCalls.map(call=>call.claimCount),[5,4],
  'each chunk call records the claims it judged');
 assert.ok(result.answer.includes('Repeated cases shape anticipation'),
  'claims from the second chunk ship');
});

test('a review chunk that hits its deadline retries as two half-size split calls (latency tranche)',async()=>{
 const sentences=['Custom guides human life.','Habit shapes inference.',
  'Repeated experience forms expectations.','One event follows another regularly.',
  'The mind learns from repeated conjunctions.','Custom directs ordinary expectations.',
  'Experience produces familiar associations.','Inference follows established habits.',
  'Repeated cases shape anticipation.'];
 const sourceText=sentences.join('\n\n');
 const source={...hume,id:'S1',text:sourceText,preview:sourceText};
 const timeout=()=>Object.assign(new Error('Inference deadline exceeded'),
  {stage:'review',code:'inference-deadline-exceeded'});
 const scopedReview=(_model,{messages})=>{
  const payload=parsePayload(messages);
  const ids=payload.reviewClaimIds||payload.claims.map(claim=>claim.claimId);
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
   directAnswerClaimIds:['P1-C1']}],claims:ids.map(claimId=>{
    const claim=payload.claims.find(item=>item.claimId===claimId);
    return {claimId,status:'answered',sources:[{sourceId:'S1',status:'answered',
     spanIds:[claim.sourceEvidence[0].spanIds[0]]}]};})})};
 };
 const ai=makeAI([answer('PART P1\n'+sentences.map(s=>s+' [S1]').join('\n\n')),
  timeout(),scopedReview,scopedReview,scopedReview]);
 const result=await composeEvidenceAnswer('What guides human life?',[source],ai,[],{
  plan:onePartPlan,catalog,trace:true,transportDiagnostics:true});
 assert.equal(result.outcome,'verified-source-draft');
 assert.equal(ai.calls.length,5,'compose, the timed-out chunk, the second chunk, and two split halves');
 assert.deepEqual(result.trace.reviewRetrySplit,[{partId:'P1',
  claimIds:['P1-C1','P1-C2','P1-C3','P1-C4','P1-C5'],
  halves:[['P1-C1','P1-C2','P1-C3'],['P1-C4','P1-C5']],outcome:'recovered'}],
  'the split is recorded with the part, its claims, and its halves');
 assert.equal(result.trace.reviewRetry,undefined,
  'a recovered split needs no part-level retry entry');
 const reviewCalls=result.trace.inferenceCalls.filter(call=>call.stage==='review');
 assert.deepEqual(reviewCalls.map(call=>call.kind),
  ['initial','initial','split-retry','split-retry']);
 assert.ok(reviewCalls.every(call=>call.timeoutMs===60000),
  'split halves run at the flat 60 s deadline, not the 120 s retry raise');
 assert.deepEqual(reviewCalls.map(call=>call.claimCount),[5,4,3,2]);
});

test('a truncated compact-format review still salvages its complete claim prefix (latency tranche)',async()=>{
 let cutText='';
 const reviewer=(_model,{messages})=>{
  const payload=parsePayload(messages);
  const decisions=payload.claims.map(claim=>{
   const subject=claimPersonSubjects(claim.text)[0]||'';
   return {claimId:claim.claimId,status:'answered',
    sources:claim.sourceIds.map(sourceId=>({sourceId,
     spanIds:[claim.sourceEvidence.find(item=>item.sourceId===sourceId).spanIds[0]],
     attributionStatus:'not_applicable',
     subjectAttributionStatus:'supported',
     ...(subject?{attributedSubject:subject}:{}),
     evidenceRole:'work-assertion',
     supportBoundary:'The cited span states the claim as written.'}))};
  });
  const full=JSON.stringify({claims:decisions,
   parts:[{partId:'P1',status:'answered',answerStatus:'answered',
    directAnswerClaimIds:decisions.map(decision=>decision.claimId),
    retainedContextClaimIds:[],requirementCoverage:[]}]});
  cutText=full.slice(0,full.indexOf(payload.claims[1].claimId)+14);
  return {choices:[{finish_reason:'length',message:{content:cutText}}],
   usage:{neurons:3,prompt_tokens:500,completion_tokens:1800}};
 };
 const ai=makeAI([answer('PART P1\nHume links necessity to custom and regular conjunction. [S1]\n\nHume also treats custom as the guide of human life. [S1]'),
  reviewer]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true});
 assert.equal(ai.calls.length,2,'the salvaged review needs no retry call');
 assert.deepEqual(result.trace.reviewSalvage,
  [{partId:'P1',recoveredClaims:1,droppedClaimIds:['P1-C2']}]);
 assert.ok(result.answer.includes('Hume links necessity to custom'));
 assert.ok(!result.answer.includes('guide of human life'),
  'the claim the cut dropped does not ship');
 // Parse level: the salvaged claim keeps its compact source decision
 // whole, and the empty speaker field is absent, not blank.
 const salvaged=parseReviewJson({response:cutText});
 assert.equal(salvaged.claims.length,1);
 assert.equal(salvaged.claims[0].sources[0].supportBoundary,
  'The cited span states the claim as written.');
 assert.equal(salvaged.claims[0].sources[0].attributedSpeaker,undefined,
  'compact verdicts omit empty name fields');
 assert.equal(salvaged.claims[0].clauses,undefined,
  'compact verdicts carry no clause copies');
});

test('compact verdict format: per-claim response size falls by at least 40% (latency tranche)',()=>{
 // The same verdicts in the pre-tranche schema (verbatim clause
 // copies with per-clause source decisions) and in the compact
 // schema (no clauses; empty name fields omitted). Shapes mirror
 // the review census profile: compound claims with supportedText
 // and a full source decision run near 1,000 chars per claim.
 const boundary='The span states that Hume links necessity to custom and regular conjunction; it does not by itself establish the claim about rational insight.';
 const oldSource={sourceId:'S1',status:'answered',spanIds:['S1-Q1'],
  attributionStatus:'supported',attributedSpeaker:'',
  subjectAttributionStatus:'supported',attributedSubject:'Hume',
  evidenceRole:'work-assertion',supportBoundary:boundary};
 const newSource={sourceId:'S1',status:'answered',spanIds:['S1-Q1'],
  attributionStatus:'supported',
  subjectAttributionStatus:'supported',attributedSubject:'Hume',
  evidenceRole:'work-assertion',supportBoundary:boundary};
 const text1='Hume links necessity to custom and regular conjunction, and he treats the expectation that follows as a determination of the mind rather than rational insight.';
 const oldClaims=[
  {claimId:'P1-C1',status:'partial',supportedText:text1,sources:[oldSource],
   clauses:[
    {text:'Hume links necessity to custom and regular conjunction',start:0,end:54,
     status:'answered',issueCode:'none',sources:[{sourceId:'S1',spanIds:['S1-Q1']}]},
    {text:'he treats the expectation that follows as a determination of the mind',start:59,end:128,
     status:'answered',issueCode:'none',sources:[{sourceId:'S1',spanIds:['S1-Q1']}]},
    {text:'rather than rational insight',start:129,end:157,
     status:'partial',issueCode:'scope',sources:[{sourceId:'S1',spanIds:['S1-Q1']}]}]},
  {claimId:'P1-C2',status:'partial',supportedText:'Hume treats custom as the guide of life.',
   sources:[oldSource,{...oldSource,sourceId:'S2',spanIds:['S2-Q4']}],
   clauses:[
    {text:'Hume treats custom as the guide of life',start:0,end:38,
     status:'answered',issueCode:'none',sources:[{sourceId:'S1',spanIds:['S1-Q1']}]},
    {text:'and the basis of inference from experience',start:39,end:81,
     status:'answered',issueCode:'none',sources:[{sourceId:'S2',spanIds:['S2-Q4']}]}]}];
 const newClaims=[
  {claimId:'P1-C1',status:'partial',supportedText:text1,sources:[newSource]},
  {claimId:'P1-C2',status:'partial',supportedText:'Hume treats custom as the guide of life.',
   sources:[newSource,{...newSource,sourceId:'S2',spanIds:['S2-Q4']}]}];
 const oldChars=JSON.stringify(oldClaims).length;
 const newChars=JSON.stringify(newClaims).length;
 assert.ok(newChars<=oldChars*0.6,
  `compact format must cut per-claim response size by at least 40%: ${oldChars} -> ${newChars} chars over 2 claims`);
 // The compact response still parses through the ordinary review parser.
 const parsed=parseReviewJson({response:JSON.stringify({claims:newClaims,parts:[]})});
 assert.equal(parsed.claims.length,2);
 assert.equal(parsed.claims[0].sources[0].attributedSubject,'Hume');
});
