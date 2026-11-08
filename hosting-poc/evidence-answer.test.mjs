import test from 'node:test';
import assert from 'node:assert/strict';
import {composeEvidenceAnswer,linkEvidenceToParts,COMPOSER_PROMPT,EXPANSION_PROMPT,REVIEW_PROMPT,parseReviewJson,parseAnswerRepairJson,normalizeAnswerMarkdown,sanitizeInternalAnswerIds,unwrapBoldWrappedParagraphs,findUntracedCitedClaims,stripUntracedCitedClaims,stripUntracedCitedClaimsToFixpoint,findClaimCitationOffenses,removeClaimsFromPart,hasAssemblyEndingViolation,speakerIsWorkAuthor,personNamesMatch,namedSpeakerAttribution,claimTextAppears,attachScaffoldingToPart,isListLeadInAnswer,introducesDuplicatedParagraph} from './evidence-answer.mjs';
import {auditFinalAnswer,normalizePlan,sourceProvenance,removeUnsupportedQuoteMarks} from './reader-contract.mjs';
import {buildReviewSpans,rankReviewSpans,isHeadingOnlySpan} from './review-spans.mjs';
import {splitCitedSentenceUnits,reconcileFinalPartCoverage} from './evidence-answer.mjs';

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
 const ai=makeAI([answer(draft),review([['P1','answered'],['P2','answered'],['P3','answered']])]);
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
function makeAI(responses,{decorateReview=true,decorateClauses=true}={}){
 const calls=[];
 return {calls,run:async(model,request)=>{calls.push({model,request});const next=responses.shift();
   if(next instanceof Error)throw next;
   const result=typeof next==='function'?next(model,request):next;
   // Most fixtures predate the explicit answer/context decisions. Give legacy
   // fixtures realistic reviewer selections; focused contract tests opt out.
   const systemText=String(request?.messages?.[0]?.content||'');
   if((decorateReview||decorateClauses)&&systemText.includes('directAnswerClaimIds')&&
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
 const intro17=sourceProvenance({bookId:'185',title:'Last Writings: Nothingness and the Religious Worldview — Kitarō Nishida'