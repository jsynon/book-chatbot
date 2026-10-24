import test from 'node:test';
import assert from 'node:assert/strict';
import {composeEvidenceAnswer,linkEvidenceToParts,COMPOSER_PROMPT,REVIEW_PROMPT} from './evidence-answer.mjs';

const catalog={35:'An Enquiry Concerning Human Understanding — David Hume',40:'Critique of Pure Reason — Immanuel Kant'};
const hume={id:'S1',bookId:'35',title:catalog[35],page:42,url:'https://example.test/hume#page=42',
 text:'Our idea of necessity and causation arises from the uniformity observable in nature, where similar objects are constantly conjoined, and the mind is determined by custom to infer one from the other.',
 preview:'Our idea of necessity and causation arises from uniformity and custom.'};
const kant={id:'S2',bookId:'40',title:catalog[40],page:53,url:'https://example.test/kant#page=53',
 text:'Causality is one of the categories of relation. The categories are pure conceptions of the understanding and are a priori.',
 preview:'Causality is one of the categories of relation.'};
function answer(text){return {response:text,usage:{neurons:8,prompt_tokens:100,completion_tokens:60}};}
function review(statuses,{evidenceByPart={},includeEvidence=true}={}){
 return {response:JSON.stringify({parts:statuses.map(([partId,status])=>({partId,status,
  reason:includeEvidence?'The cited passage directly supports this part.':'',
  evidence:!includeEvidence||status==='unanswered'?[]:evidenceByPart[partId]||
   (partId==='P3'?[{sourceId:'S1',quote:hume.text},{sourceId:'S2',quote:kant.text}]:
    [{sourceId:partId==='P2'?'S2':'S1',quote:partId==='P2'?kant.text:hume.text}])}))})};
}
function makeAI(responses){
 const calls=[];
 return {calls,run:async(model,request)=>{calls.push({model,request});const next=responses.shift();
   if(next instanceof Error)throw next;return typeof next==='function'?next(model,request):next;}};
}
const onePartPlan={version:'reader-evidence-v2',intent:'explain',
 sources:[{label:'David Hume',role:'primary',bookIds:['35']}],
 parts:[{id:'P1',question:'How does Hume explain causal necessity?',sourceBookIds:['35'],
   searchQueries:['Hume necessity custom'],candidateSourceIds:['S1']}],queries:['Hume necessity custom']};
const twoSidePlan={version:'reader-evidence-v2',resolvedQuestion:'How do Hume and Kant differ about causal necessity?',intent:'compare',
 sources:[{label:'David Hume',role:'primary',bookIds:['35']},{label:'Immanuel Kant',role:'primary',bookIds:['40']}],
 parts:[
  {id:'P1',question:'How does Hume explain causal necessity?',sourceBookIds:['35'],searchQueries:['Hume necessity custom']},
  {id:'P2',question:'How does Kant explain causal necessity?',sourceBookIds:['40'],searchQueries:['Kant causality a priori']},
  {id:'P3',question:'How do Hume and Kant differ?',sourceBookIds:['35','40'],searchQueries:['Hume custom','Kant a priori']}
 ],queries:['Hume custom','Kant a priori']};

test('the composer uses a short per-part answer contract without claim IDs or quote extraction',()=>{
 assert.match(COMPOSER_PROMPT,/one heading and one short answer paragraph for each supplied part/);
 assert.match(COMPOSER_PROMPT,/Cite every answer paragraph/);
 assert.doesNotMatch(COMPOSER_PROMPT,/END EVIDENCE|unique ID|exact contiguous span/);
 assert.match(REVIEW_PROMPT,/\"parts\":\[\{/);
 assert.doesNotMatch(REVIEW_PROMPT,/claimIds|verdict/);
});

test('part linking preserves evidence discovered by each side for a synthesis part',()=>{
 const plan={...twoSidePlan,parts:twoSidePlan.parts.map(part=>({...part,candidateSourceIds:[]}))};
 const linked=linkEvidenceToParts(plan,[{...hume,candidatePartIds:['P1']},{...kant,candidatePartIds:['P2']}]);
 assert.deepEqual(linked.parts.map(part=>part.candidateSourceIds),[['S1'],['S2'],['S1','S2']]);
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
 const reviewPayload=JSON.parse(ai.calls[1].request.messages[1].content);
 assert.deepEqual(composePayload.parts[0].candidateSourceIds,['S1']);
 assert.deepEqual(reviewPayload.parts[0].candidateSourceIds,['S1']);
 assert.deepEqual(reviewPayload.parts[0].evidence.map(source=>source.id),['S1']);
});

test('per-part citation checking rejects unknown, malformed, and cross-linked IDs without losing other parts',async()=>{
 const ai=makeAI([
  answer('PART P1\nHume links necessity to custom. [S1, S99]\n\nPART P2\nKant describes causality as a priori. [S1]'),
  review([['P1','answered'],['P2','answered']])
 ]);
 const result=await composeEvidenceAnswer('How do Hume and Kant explain necessity?',
  [{...hume,candidatePartIds:['P1']},{...kant,candidatePartIds:['P2']}],ai,[],
  {plan:{...twoSidePlan,intent:'explain',parts:twoSidePlan.parts.slice(0,2)},catalog,trace:true});
 assert.equal(result.outcome,'generation-failed');
 assert.equal(result.coverage,'none');
 assert.equal(result.failureCode,'answer-citation-validation-failed');
 assert.match(result.trace.rejected.map(item=>item.reason).join(' '),/unknown|citation/);
});

test('a citation linked to another question part is rejected even when its source ID exists',async()=>{
 const plan={...twoSidePlan,intent:'explain',parts:twoSidePlan.parts.slice(0,2)};
 const ai=makeAI([answer('PART P1\nKant says causality is a category. [S2]\nPART P2\nKant says causality is a category. [S2]'),
  review([['P1','answered'],['P2','answered']])]);
 const result=await composeEvidenceAnswer('How do Hume and Kant explain necessity?',
  [{...hume,candidatePartIds:['P1']},{...kant,candidatePartIds:['P2']}],ai,[],{plan,catalog});
 assert.equal(result.questionParts[0].status,'unsupported');
 assert.equal(result.questionParts[1].status,'supported');
 assert.deepEqual(result.citations.map(source=>source.id),['S2']);
});

test('missing question parts remain visible as partial coverage instead of invalidating the answer',async()=>{
 const ai=makeAI([
  answer('PART P1\nHume says causal necessity arises from custom and regular conjunction. [S1]'),
  review([['P1','answered'],['P2','answered'],['P3','partial']])
 ]);
 const result=await composeEvidenceAnswer('How do Hume and Kant differ over causal necessity?',
  [{...hume,candidatePartIds:['P1','P3']},{...kant,candidatePartIds:['P2','P3']}],ai,[],
  {plan:twoSidePlan,catalog});
 assert.equal(result.outcome,'verified-source-draft');
 assert.equal(result.coverage,'partial');
 assert.deepEqual(result.questionParts.map(part=>part.status),['supported','unsupported','unsupported']);
 assert.equal(ai.calls.length,2);
 assert.match(result.missing,/Kant|differ/i);
});

test('a reviewer partial decision is a valid result, not a contract failure',async()=>{
 const ai=makeAI([answer('PART P1\nKant lists causality among the categories of relation. [S2]'),
  review([['P1','partial']])]);
 const result=await composeEvidenceAnswer('How does Kant justify causal necessity?',
  [kant],ai,[],{plan:{...onePartPlan,intent:'explain',sources:[{label:'Immanuel Kant',role:'primary',bookIds:['40']}],
   parts:[{id:'P1',question:'How does Kant justify causal necessity?',sourceBookIds:['40'],searchQueries:['Kant causality'],candidateSourceIds:['S2']}]},catalog});
 assert.equal(result.coverage,'partial');
 assert.equal(result.reviewStatus,'claim-review');
 assert.equal(result.outcome,'verified-source-draft');
 assert.equal(result.questionParts[0].status,'partial');
});

test('a reviewer cannot mark an answer supported without an exact quote from a cited page',async()=>{
 const ai=makeAI([answer('PART P1\nKant lists causality among the categories of relation. [S2]'),
  review([['P1','answered']],{includeEvidence:false})]);
 const result=await composeEvidenceAnswer('How does Kant justify causal necessity?',
  [kant],ai,[],{plan:{...onePartPlan,intent:'explain',
   sources:[{label:'Immanuel Kant',role:'primary',bookIds:['40']}],
   parts:[{id:'P1',question:'How does Kant justify causal necessity?',sourceBookIds:['40'],
    searchQueries:['Kant causality'],candidateSourceIds:['S2']}]},catalog,trace:true});
 assert.equal(result.coverage,'partial');
 assert.equal(result.questionParts[0].status,'partial');
 assert.deepEqual(result.trace.reviewContract.supportIssues,[
  {partId:'P1',reason:'no-cited-exact-support-quote'},
  {partId:'P1',reason:'missing-support-rationale'}]);
 assert.equal(result.evidenceMap.length,0);
});

test('reviewer contract errors preserve citation-checked text as an explicitly unverified partial draft',async()=>{
 const ai=makeAI([answer('PART P1\nHume links necessity to custom and regular conjunction. [S1]'),
  {response:JSON.stringify({parts:[]})}]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],
  {plan:onePartPlan,catalog});
 assert.equal(result.outcome,'unverified-source-draft');
 assert.equal(result.coverage,'partial');
 assert.equal(result.reviewStatus,'review-contract-incomplete');
 assert.match(result.answer,/custom and regular conjunction/);
 assert.equal(ai.calls.length,2);
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

test('comparison cannot receive full coverage unless both named source groups are cited',async()=>{
 const linkedSources=[{...hume,candidatePartIds:['P1']},{...kant,candidatePartIds:['P2']}];
 const ai=makeAI([answer('PART P1\nHume grounds necessity in custom after repeated conjunction. [S1]\n'+
  'PART P2\nKant treats causal order as a priori. [S2]\n'+
  'PART P3\nHume grounds necessity in custom after repeated conjunction, whereas Kant treats causal order as a priori. [S1]'),
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
  review([['P1','answered'],['P2','answered'],['P3','answered']])]);
 const result=await composeEvidenceAnswer('How do Hume and Kant differ?',linkedSources,ai,[],{plan:twoSidePlan,catalog});
 assert.equal(result.coverage,'full');
 assert.equal(result.questionParts[0].status,'supported');
});

test('malformed composition is reported as generation failure without retrying or calling review',async()=>{
 const ai=makeAI([answer('The answer omitted all planned part headings and citations.')]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],
  {plan:onePartPlan,catalog});
 assert.equal(ai.calls.length,1);
 assert.equal(result.outcome,'generation-failed');
 assert.equal(result.coverage,'none');
 assert.equal(result.citations.length,0);
 assert.equal(result.failureCode,'model-output-invalid-format');
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

test('comparison answers preserve citations in canonical form and remove model citation placement noise',async()=>{
 const ai=makeAI([answer('PART P1\nHume grounds necessity in habit [S1] after repeated conjunction. [S1]'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],
  {plan:onePartPlan,catalog,trace:true});
 assert.equal((result.answer.match(/\[S1\]/g)||[]).length,1);
 assert.equal(result.trace.stages[0].stage,'compose');
});

test('verse-restricted answers expose the requested verses as evidence and retain the rest only as context',async()=>{
 const source={...hume,scopeText:'Within the requested range, love is from God and believers should love one another.'};
 const plan={...onePartPlan,scope:'1 John 4:7-12'};
 const ai=makeAI([answer('PART P1\nThe passage grounds mutual love in love from God. [S1]'),
  review([['P1','answered']],{evidenceByPart:{P1:[{sourceId:'S1',
   quote:'Within the requested range, love is from God and believers should love one another.'}]}})]);
 await composeEvidenceAnswer('According to 1 John 4:7-12, what does love mean?',[source],ai,[],
  {plan,catalog,trace:true});
 const composePayload=JSON.parse(ai.calls[0].request.messages[1].content);
 const reviewPayload=JSON.parse(ai.calls[1].request.messages[1].content);
 assert.equal(composePayload.evidence[0].text,source.scopeText);
 assert.equal(composePayload.evidence[0].contextText,source.text);
 assert.equal(reviewPayload.parts[0].evidence[0].text,source.scopeText);
});
