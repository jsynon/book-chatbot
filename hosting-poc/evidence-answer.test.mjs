import test from 'node:test';
import assert from 'node:assert/strict';
import {composeEvidenceAnswer,linkEvidenceToParts,COMPOSER_PROMPT,REVIEW_PROMPT} from './evidence-answer.mjs';
import {auditFinalAnswer} from './reader-contract.mjs';

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
 assert.match(COMPOSER_PROMPT,/Cite every factual sentence/);
 assert.doesNotMatch(COMPOSER_PROMPT,/END EVIDENCE|unique ID|exact contiguous span/);
 assert.match(REVIEW_PROMPT,/\"parts\":\[\{/);
 assert.doesNotMatch(REVIEW_PROMPT,/claimIds|verdict/);
 assert.match(REVIEW_PROMPT,/12–2000 character/);
 assert.match(REVIEW_PROMPT,/neighboring doctrine or a shared keyword is not support/);
 assert.match(REVIEW_PROMPT,/reversed negation or attribution as a material contradiction/);
 assert.match(REVIEW_PROMPT,/exact supporting evidence from every cited source ID/);
});

test('a quoted technical term is not mistaken for a source quotation, while multiword quotes stay exact',()=>{
 assert.equal(auditFinalAnswer('The account turns on “whatness.” [S1]',[hume]).ok,true);
 assert.equal(auditFinalAnswer('The source says “custom and habit.” [S1]',[hume]).ok,false);
 assert.equal(auditFinalAnswer('The source says “mind is determined by custom.” [S1]',[hume]).ok,true);
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

test('a bad quoted sentence is removed without discarding neighboring verified sentences',async()=>{
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
  {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
   reason:'The retained claims describe the experience and its place in Du Bois’s account.',
   evidence:[{sourceId:'S5',quote:'It is a peculiar sensation, this double life, this sense of always looking at one’s self through the eyes of others.'},
    {sourceId:'S3',quote:'The Negro is a sort of seventh son, born with a veil, and gifted with second-sight in this American world.'}]}]})}
 ]);
 const result=await composeEvidenceAnswer('How does Du Bois describe the double life and its effects?',
  [source,dubois2],ai,[],{plan,catalog:{454:'The Souls of Black Folk — W. E. B. Du Bois'},trace:true});
 assert.equal(ai.calls.length,2);
 assert.equal(result.outcome,'verified-source-draft');
 assert.equal(result.questionParts[0].status,'supported');
 assert.match(result.answer,/“double life” and painful self-consciousness\. \[S5\]/);
 assert.match(result.answer,/ongoing historical strife\. \[S3\]/);
 assert.doesNotMatch(result.answer,/double consciousness/);
 assert.deepEqual(result.trace.rejected,[{partId:'P1',reason:'quotation-citation-mismatch',sentenceIndex:2}]);
 assert.deepEqual(result.citations.map(item=>item.id),['S5','S3']);
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

test('the active evidence-v2 reviewer verifies a long exact quote before storing a bounded source anchor',async()=>{
 const longText='A verified passage explains the form and matter relation in detail: '+
  'the soul is the first actuality of a natural body that has life potentially, and this relation is clarified by the comparison between the shape of wax and the wax itself. '.repeat(3);
 const source={...hume,text:longText,preview:longText};
 const exactQuote=longText.slice(0,462);
 const ai=makeAI([answer('PART P1\nAristotle treats soul as the actuality of a living body. [S1]'),
  review([['P1','answered']],{evidenceByPart:{P1:[{sourceId:'S1',quote:exactQuote}]}})]);
 const result=await composeEvidenceAnswer('How does Aristotle relate soul and body?',[source],ai,[],
  {plan:onePartPlan,catalog,trace:true});
 assert.equal(result.coverage,'full');
 assert.ok(result.evidenceMap[0].quote.length<=320);
 assert.ok(longText.includes(result.evidenceMap[0].quote));
 assert.equal(result.trace.reviewContract.supportIssues.length,0);
});

test('the active reviewer accepts OCR-normalized exact evidence and anchors to original source text',async()=>{
 const source={...hume,text:'James writes that faith is jusƟﬁed by works, and this is not an empty formula.',
  preview:'James writes that faith is jusƟﬁed by works, and this is not an empty formula.'};
 const ai=makeAI([answer('PART P1\nJames relates faith to works. [S1]'),
  review([['P1','answered']],{evidenceByPart:{P1:[{sourceId:'S1',
   quote:'James writes that faith is justified by works, and this is not an empty formula.'}]}})]);
 const result=await composeEvidenceAnswer('How does James relate faith and works?',[source],ai,[],
  {plan:onePartPlan,catalog,trace:true});
 assert.equal(result.coverage,'full');
 assert.match(result.evidenceMap[0].quote,/jusƟﬁed/);
 assert.equal(result.trace.reviewContract.supportIssues.length,0);
});

test('an answered review must quote every source cited by that part',async()=>{
 const ai=makeAI([answer('PART P1\nHume and Kant give different accounts of causal necessity. [S1, S2]'),
  review([['P1','answered']],{evidenceByPart:{P1:[{sourceId:'S1',quote:hume.text}]}})]);
 const result=await composeEvidenceAnswer('How do Hume and Kant differ over causal necessity?',
  [{...hume,candidatePartIds:['P1']},{...kant,candidatePartIds:['P1']}],ai,[],
  {plan:{...onePartPlan,intent:'compare',sources:[
   {label:'David Hume',role:'primary',bookIds:['35']},
   {label:'Immanuel Kant',role:'primary',bookIds:['40']}],
   parts:[{id:'P1',question:'How do Hume and Kant differ over causal necessity?',
    sourceBookIds:['35','40'],searchQueries:['Hume and Kant causal necessity'],candidateSourceIds:['S1','S2']}]},catalog,trace:true});
 assert.equal(result.coverage,'partial');
 assert.ok(result.trace.reviewContract.supportIssues.some(issue=>
  issue.reason==='missing-cited-source-support-quote'));
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
   quote:'Within the requested range, love is from God and believers should love one another.'}]}})]);
 await composeEvidenceAnswer('According to 1 John 4:7-12, what does love mean?',[source],ai,[],
  {plan,catalog,trace:true});
 const composePayload=JSON.parse(ai.calls[0].request.messages[1].content);
 const reviewPayload=JSON.parse(ai.calls[1].request.messages[1].content);
 assert.equal(composePayload.evidence[0].text,source.scopeText);
 assert.equal(composePayload.evidence[0].contextText,source.text);
 assert.equal(reviewPayload.parts[0].evidence[0].text,source.scopeText);
});
