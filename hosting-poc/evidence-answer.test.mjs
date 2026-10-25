import test from 'node:test';
import assert from 'node:assert/strict';
import {composeEvidenceAnswer,linkEvidenceToParts,COMPOSER_PROMPT,REVIEW_PROMPT} from './evidence-answer.mjs';
import {auditFinalAnswer,normalizePlan,sourceProvenance} from './reader-contract.mjs';
import {buildReviewSpans,rankReviewSpans} from './review-spans.mjs';

const catalog={35:'An Enquiry Concerning Human Understanding — David Hume',40:'Critique of Pure Reason — Immanuel Kant'};
const hume={id:'S1',bookId:'35',title:catalog[35],page:42,url:'https://example.test/hume#page=42',
 text:'Our idea of necessity and causation arises from the uniformity observable in nature, where similar objects are constantly conjoined, and the mind is determined by custom to infer one from the other.',
 preview:'Our idea of necessity and causation arises from uniformity and custom.'};
const kant={id:'S2',bookId:'40',title:catalog[40],page:53,url:'https://example.test/kant#page=53',
 text:'Causality is one of the categories of relation. The categories are pure conceptions of the understanding and are a priori.',
 preview:'Causality is one of the categories of relation.'};
function answer(text){return {response:text,usage:{neurons:8,prompt_tokens:100,completion_tokens:60}};}
function review(statuses,{evidenceByPart={},includeEvidence=true}={}){
 return (_model,{messages})=>{
  const payload=JSON.parse(messages[1].content);
  const statusByPart=new Map(statuses);
  const parts=payload.parts.map(part=>{
   const status=statusByPart.get(part.partId)||'partial';
   const claims=part.claims.map(claim=>{
    const defaultEvidence=claim.sourceIds.map(sourceId=>({sourceId,spanIds:[sourceId+'-Q1']}));
    const evidence=!includeEvidence||status==='unanswered'?[]:
     (evidenceByPart[part.partId]||defaultEvidence).filter(item=>claim.sourceIds.includes(item.sourceId));
    return {claimId:claim.claimId,status,reason:includeEvidence?'This exact sentence is supported by its cited passage.':'',evidence};
   });
   return {partId:part.partId,status,reason:includeEvidence?'The cited passage directly supports this part.':'',claims};
  });
  return {response:JSON.stringify({parts})};
 };
}
function makeAI(responses){
 const calls=[];
 return {calls,run:async(model,request)=>{calls.push({model,request});const next=responses.shift();
   if(next instanceof Error)throw next;return typeof next==='function'?next(model,request):next;}};
}

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
 const portableTitle='The Portable Nietzsche — Friedrich Nietzsche (edited by Walter Kaufmann)';
 const portablePage=sourceProvenance({bookId:'239',title:portableTitle,page:578},
  {sources:[{role:'primary',bookIds:['239']}]});
 assert.deepEqual(portablePage.pageVoice,{kind:'editorial-commentary',name:'Walter Kaufmann',creditedAuthor:'Friedrich Nietzsche'});
 assert.equal(sourceProvenance({bookId:'239',title:portableTitle,page:547},
  {sources:[{role:'primary',bookIds:['239']}] }).pageVoice,undefined,
  'direct Nietzsche text elsewhere in the volume does not inherit the page-578 editorial label');
});

test('review span IDs map only to exact contiguous source slices and stay within the prompt bound',()=>{
 const text='A first short sentence. '+('A long sentence contains a precise claim and supporting qualification. '.repeat(8))+
  'A final sentence.';
 const spans=buildReviewSpans('S7',text);
 assert.ok(spans.length>2);
 assert.equal(new Set(spans.map(span=>span.spanId)).size,spans.length);
 for(const span of spans){
  assert.ok(span.text.length>=12&&span.text.length<=220);
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
test('review request orders the cited page by the answer sentence while preserving span IDs',async()=>{
 const text='A historical introduction recounts debates about institutions, books, readers, editions, publication, libraries, translations, commentaries, editors, authors, scholars, chronology, archives, and the long development of literary criticism across several generations. No immediate transition from a proof of probability to faith is possible. The author then considers another example.';
 const source={...hume,text,preview:text};
 let reviewPayload;
 const ai={run:async(_model,{messages})=>{
  const system=messages[0].content;
  if(system.startsWith('Answer the reader'))return answer('PART P1\nNo transition from proof of probability to faith is possible. [S1]');
  reviewPayload=JSON.parse(messages[1].content);
  const selected=reviewPayload.parts[0].evidence[0].spans[0];
  const claim=reviewPayload.parts[0].claims[0];
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
    reason:'The cited passage directly states this relation and qualification.',
    claims:[{claimId:claim.claimId,status:'answered',reason:'This passage directly states the faith relation.',
     evidence:[{sourceId:'S1',spanIds:[selected.spanId]}]}]}]})};
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
test('compact review decisions validate exact spans without rationale text or repeated payload fields',async()=>{
 let reviewPayload;
 const ai={run:async(_model,{messages,max_completion_tokens})=>{
  if(messages[0].content.startsWith('Answer the reader'))return answer('PART P1\nHume links necessity to custom and regular conjunction. [S1]');
  reviewPayload=JSON.parse(messages[1].content);
  const claim=reviewPayload.parts[0].claims[0],span=reviewPayload.parts[0].evidence[0].spans[0];
  assert.equal(max_completion_tokens,1200);
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',claims:[{
   claimId:claim.claimId,status:'answered',spansBySource:{S1:[span.spanId]}
  }]}]})};
 }};
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true
 });
 assert.equal(result.outcome,'verified-source-draft');
 assert.equal(result.coverage,'full');
 assert.equal(result.failureCode,undefined);
 assert.deepEqual(result.evidenceMap.map(item=>item.quote),[reviewPayload.parts[0].evidence[0].spans[0].text]);
 assert.deepEqual(Object.keys(reviewPayload.parts[0].claims[0]).sort(),['claimId','sourceIds','text']);
 assert.equal('candidateSourceIds' in reviewPayload.parts[0],false);
 assert.equal('sha256' in reviewPayload.parts[0].evidence[0],false);
});
test('compact review cannot verify a sentence unless every cited source has a selected span',async()=>{
 const ai=makeAI([answer('PART P1\nHume grounds necessity in custom, while Kant treats causality as a priori. [S1, S2]'),
  (_model,{messages})=>{
   const payload=JSON.parse(messages[1].content),part=payload.parts[0],claim=part.claims[0];
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',claims:[{
    claimId:claim.claimId,status:'answered',spansBySource:{S1:['S1-Q1']}
   }]}]})};
  }]);
 const plan={...twoSidePlan,parts:[{id:'P1',question:'How do Hume and Kant differ?',sourceBookIds:['35','40'],
  candidateSourceIds:['S1','S2']}]};
 const result=await composeEvidenceAnswer('How do Hume and Kant differ?',
  [{...hume,candidatePartIds:['P1']},{...kant,candidatePartIds:['P1']}],ai,[],{plan,catalog,trace:true});
 assert.equal(result.outcome,'insufficient-evidence');
 assert.equal(result.questionParts[0].status,'unsupported');
 assert.ok(result.trace.reviewContract.supportIssues.some(item=>item.reason==='missing-claim-source-span'));
 assert.equal(result.evidenceMap.length,0);
 assert.equal(ai.calls.length,2);
});
test('review truncation remains fail-closed and exposes a stage-specific reason without another call',async()=>{
 const ai=makeAI([answer('PART P1\nHume links necessity to custom and regular conjunction. [S1]'),
  {choices:[{finish_reason:'length',message:{content:'{"parts":[{"partId":"P1"'}}],
   usage:{neurons:3,prompt_tokens:500,completion_tokens:1200}}]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true
 });
 assert.equal(ai.calls.length,2);
 assert.equal(result.outcome,'unverified-source-draft');
 assert.equal(result.reviewStatus,'review-format-failed');
 assert.equal(result.failureCode,'review-output-truncated');
 assert.equal(result.failureStage,'review');
 assert.deepEqual(result.trace.reviewContract.issues,['review-output-truncated']);
 assert.equal(result.trace.stages[1].finishReason,'length');
 assert.equal(result.trace.final.reviewFailure.code,'review-output-truncated');
 assert.match(result.answer,/custom and regular conjunction/);
 assert.equal(result.evidenceMap.length,0);
});
test('claim-level review removes a sentence when its cited quote supports only a neighboring claim',async()=>{
 const text='The movement of infinity is the last stage preceding faith, so that he who has not made the movement of infinity cannot have faith.';
 const source={...hume,id:'S5',bookId:'140',title:'Fear and Trembling — Søren Kierkegaard',text,preview:text};
 const ai=makeAI([
  answer('PART P1\nFaith follows the movement of infinity and the absurd. [S5] Faith is inwardness higher than outwardness. [S5]'),
  (_model,{messages})=>{
   const payload=JSON.parse(messages[1].content),part=payload.parts[0],quote=part.evidence[0].spans[0].spanId;
   return {response:JSON.stringify({parts:[{partId:'P1',status:'partial',
    reason:'The first sentence is supported, but the second claim is absent from the cited passage.',
    claims:[
     {claimId:part.claims[0].claimId,status:'answered',reason:'The passage directly describes the movement preceding faith.',
      evidence:[{sourceId:'S5',spanIds:[quote]}]},
     {claimId:part.claims[1].claimId,status:'partial',reason:'The cited passage does not establish inwardness over outwardness.',evidence:[]}
    ]}]})};
  }
 ]);
 const result=await composeEvidenceAnswer('What does Kierkegaard say about faith?',[source],ai,[],{
  catalog,plan:{intent:'explain',sources:[{label:'Søren Kierkegaard',role:'primary',bookIds:['140']}],
   parts:[{id:'P1',question:'What does Kierkegaard say about faith?',sourceBookIds:['140']}],queries:['Kierkegaard faith']},trace:true
 });
 assert.equal(result.coverage,'partial');
 assert.match(result.answer,/movement of infinity and the absurd/);
 assert.doesNotMatch(result.answer,/inwardness higher than outwardness/);
 assert.deepEqual(result.evidenceMap.map(item=>({claimId:item.claimId,point:item.point})),[
  {claimId:'P1-C1',point:'Faith follows the movement of infinity and the absurd.'}
 ]);
 assert.equal(result.evidenceMap[0].quote,text);
});

test('claim review rejects a compound sentence when its quote supports only one factual clause',async()=>{
 const text='It seems that the church obstructs and hinders the progress of this poison.';
 const source={...hume,id:'S1',bookId:'239',title:'The Portable Nietzsche — Friedrich Nietzsche',text,preview:text};
 const ai=makeAI([
  answer('PART P1\nNietzsche called the church vulgar and said that it hindered the spread of these values. [S1]'),
  (_model,{messages})=>{
   const payload=JSON.parse(messages[1].content),part=payload.parts[0],claim=part.claims[0];
   const span=part.evidence[0].spans[0];
   return {response:JSON.stringify({parts:[{partId:'P1',status:'partial',
    reason:'The selected passage establishes only that the church hinders the spread; it says nothing about the church being vulgar.',
    claims:[{claimId:claim.claimId,status:'partial',
     reason:'The quote supports the second clause but not the description of the church as vulgar.',
     evidence:[{sourceId:'S1',spanIds:[span.spanId]}]}]}]})};
  }
 ]);
 const result=await composeEvidenceAnswer('What did Nietzsche say about the church?',[source],ai,[],{
  catalog:{239:'The Portable Nietzsche — Friedrich Nietzsche'},
  plan:{intent:'explain',sources:[{label:'Friedrich Nietzsche',role:'primary',bookIds:['239']}],
   parts:[{id:'P1',question:'What did Nietzsche say about the church?',sourceBookIds:['239']}],
   queries:['Nietzsche church criticism']},trace:true
 });
 assert.equal(ai.calls.length,2);
 assert.equal(result.coverage,'none');
 assert.equal(result.outcome,'insufficient-evidence');
 assert.equal(result.evidenceMap.length,0);
 assert.doesNotMatch(result.answer,/vulgar|hinders/i);
});
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

test('the composer uses a short per-part answer contract and the reviewer links exact quotes to claims',()=>{
 assert.match(COMPOSER_PROMPT,/one heading and one short answer paragraph for each supplied part/);
 assert.match(COMPOSER_PROMPT,/three to five concise sentences/);
 assert.match(COMPOSER_PROMPT,/planner's search queries are retrieval leads, not a list of topics/);
 assert.match(COMPOSER_PROMPT,/one main claim/);
 assert.match(COMPOSER_PROMPT,/Cite every factual sentence/);
 assert.doesNotMatch(COMPOSER_PROMPT,/END EVIDENCE|unique ID|exact contiguous span/);
 assert.match(REVIEW_PROMPT,/\"parts\":\[\{/);
 assert.match(REVIEW_PROMPT,/Review every answer sentence separately/);
 assert.match(REVIEW_PROMPT,/stable claimId/);
 assert.match(REVIEW_PROMPT,/Do not attach evidence to a different sentence/);
 assert.match(REVIEW_PROMPT,/Select span IDs only/);
 assert.match(REVIEW_PROMPT,/"spansBySource":\{"S1":\["S1-Q2"\]\}/);
 assert.match(REVIEW_PROMPT,/neighboring doctrine or a shared keyword is not support/);
 assert.match(REVIEW_PROMPT,/reversed negation or attribution as a material contradiction/);
 assert.match(REVIEW_PROMPT,/at least one relevant span from every source cited by that sentence/);
 assert.match(REVIEW_PROMPT,/one supported clause does not make an unsupported clause true/i);
 assert.match(REVIEW_PROMPT,/Do not copy source wording into the response/);
 assert.match(REVIEW_PROMPT,/Return one valid JSON object only/);
 assert.match(COMPOSER_PROMPT,/For a hypothetical question about what one author would think of another/);
 assert.match(COMPOSER_PROMPT,/Cite that inference sentence with relevant evidence from each author’s source group/);
 assert.match(REVIEW_PROMPT,/do not demand a passage documenting the hypothetical response itself/);
 assert.match(REVIEW_PROMPT,/a missing premise, one-sided citation, or conclusion stronger than the premises is partial or unanswered/);
 assert.match(COMPOSER_PROMPT,/If provenance names a pseudonymous work voice, identify that voice/);
 assert.match(REVIEW_PROMPT,/When provenance identifies a pseudonymous work voice/);
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
  text:'Nietzsche criticizes Christian morality as a decadent rejection of earthly life.',
  preview:'Nietzsche criticizes Christian morality as a decadent rejection of earthly life.'},
 {id:'S2',bookId:'140',title:hypotheticalCatalog['140'],page:44,
  text:'Johannes de Silentio says poetry should attend to the religious inwardness of personalities.',
  preview:'Johannes de Silentio says poetry should attend to the religious inwardness of personalities.'}
];
function hypotheticalReview(){
 return (_model,{messages})=>{
  const payload=JSON.parse(messages[1].content);
  const parts=payload.parts.map(part=>({partId:part.partId,
   status:part.claims.length?'answered':'unanswered',reason:'',
   claims:part.claims.map(claim=>({claimId:claim.claimId,status:'answered',reason:'',
    spansBySource:Object.fromEntries(claim.sourceIds.map(sourceId=>{
     const page=part.evidence.find(item=>item.id===sourceId);
     return [sourceId,[page.spans[0].spanId]];
    }))}))
  }));
  return {response:JSON.stringify({parts})};
 };
}
function hypotheticalDraft(inference){
 return answer([
  'PART P1',
  'Nietzsche criticizes Christian morality as a decadent rejection of earthly life. [S1]',
  'PART P2',
  'In Fear and Trembling, Johannes de Silentio presents religious inwardness as an important theme. [S2]',
  'PART P3',
  inference
 ].join('\n'));
}

test('a qualified Nietzsche-on-Kierkegaard inference is retained only with both authors’ reviewed evidence',async()=>{
 const ai=makeAI([hypotheticalDraft(
  'From these passages, one cautious inference is that Nietzsche might have viewed Kierkegaard’s emphasis on religious inwardness as part of the Christian outlook he rejects. [S1, S2]'),
  hypotheticalReview()
 ]);
 const result=await composeEvidenceAnswer(hypotheticalQuestion,hypotheticalSources,ai,[],{
  plan:hypotheticalPlan,catalog:hypotheticalCatalog,trace:true
 });
 assert.equal(ai.calls.length,2,'the fix must stay within the existing compose + review budget');
 assert.equal(result.coverage,'full');
 assert.equal(result.questionParts[2].status,'supported');
 assert.match(result.answer,/one cautious inference/i);
 assert.match(result.answer,/\[S1, S2\]/);
 assert.deepEqual(new Set(result.evidenceMap.filter(item=>item.claimId.startsWith('P3-'))
  .map(item=>item.id)),new Set(['S1','S2']));
 assert.equal(result.trace.reviewContract.valid,true);
});

test('a one-sided hypothetical inference is rejected and the part remains visibly incomplete',async()=>{
 const ai=makeAI([hypotheticalDraft(
  'From these passages, one cautious inference is that Nietzsche might have viewed Kierkegaard’s emphasis on religious inwardness as part of the Christian outlook he rejects. [S1]'),
  hypotheticalReview()
 ]);
 const result=await composeEvidenceAnswer(hypotheticalQuestion,hypotheticalSources,ai,[],{
  plan:hypotheticalPlan,catalog:hypotheticalCatalog,trace:true
 });
 assert.equal(ai.calls.length,2);
 assert.equal(result.coverage,'partial');
 assert.equal(result.questionParts[2].status,'unsupported');
 assert.ok(result.trace.rejected.some(item=>item.partId==='P3'&&
  item.reason==='hypothetical-inference-missing-source-group-citation'));
 assert.doesNotMatch(result.answer,/one cautious inference/i);
 assert.match(result.missing,/what response can cautiously be inferred/i);
});

test('an unqualified hypothetical author claim is rejected even when both source groups are cited',async()=>{
 const ai=makeAI([hypotheticalDraft(
  'Nietzsche would have regarded Kierkegaard’s emphasis on religious inwardness as a form of the decadent outlook he attacks. [S1, S2]'),
  hypotheticalReview()
 ]);
 const result=await composeEvidenceAnswer(hypotheticalQuestion,hypotheticalSources,ai,[],{
  plan:hypotheticalPlan,catalog:hypotheticalCatalog,trace:true
 });
 assert.equal(ai.calls.length,2);
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
  'What did Kierkegaard say about faith and the individual?',catalog);
 assert.equal(explicitFacets.parts.length,2,'explicitly requested facets remain separate coverage parts');
 const scoped=normalizePlan(raw,'What did Kierkegaard say about faith in Fear and Trembling?',catalog);
 assert.deepEqual(scoped.parts[0].sourceBookIds,['140']);
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
 assert.equal('candidateSourceIds' in reviewPayload.parts[0],false);
 assert.deepEqual(Object.keys(reviewPayload.parts[0].claims[0]).sort(),['claimId','sourceIds','text']);
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
  (_model,{messages})=>{
   const payload=JSON.parse(messages[1].content),part=payload.parts[0];
   const claims=part.claims.map(claim=>({claimId:claim.claimId,status:'answered',
    spansBySource:Object.fromEntries(claim.sourceIds.map(sourceId=>{
     const page=part.evidence.find(item=>item.id===sourceId);
     return [sourceId,[page.spans[0].spanId]];
    }))}));
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',claims}]})};
  }
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
  {partId:'P1',claimId:'P1-C1',reason:'missing-claim-source-span'}]);
 assert.equal(result.evidenceMap.length,0);
});

test('invented and cross-source span IDs cannot enter the reviewed evidence map',async()=>{
 const plan={...onePartPlan,parts:[{...onePartPlan.parts[0],candidateSourceIds:['S1']}]};
 const ai=makeAI([answer('PART P1\nHume grounds necessity in custom and regularity. [S1]'),
  (_model,{messages})=>{
   const payload=JSON.parse(messages[1].content),claim=payload.parts[0].claims[0];
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
    reason:'The source explains the custom based inference clearly.',claims:[{claimId:claim.claimId,
     status:'answered',reason:'This source explains the custom based inference.',evidence:[
      {sourceId:'S1',spanIds:['S2-Q1','S1-Q999']},{sourceId:'S99',spanIds:['S99-Q1']}]}]}]})};
  }]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],
  {plan,catalog,trace:true});
 assert.equal(result.questionParts[0].status,'unsupported');
 assert.deepEqual(result.trace.reviewContract.supportIssues,[
  {partId:'P1',claimId:'P1-C1',reason:'missing-claim-source-span'}]);
 assert.equal(result.evidenceMap.length,0);
 assert.equal(ai.calls.length,2);
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
 const ai=makeAI([
  answer('PART P1\nHume grounds necessity in custom and regular conjunction. [S1] External objects do not reveal power directly. [S2]\n'+
   'PART P2\nKant treats causal connection as a priori and necessary. [S3, S6]\n'+
   'PART P3\nHume explains necessity through custom, while Kant grounds causal connection in a priori categories. [S1, S2, S3, S6]'),
  (_model,{messages})=>{
   const payload=JSON.parse(messages[1].content);
   const supported={P1:['S1','S2'],P2:['S3','S6'],P3:['S1','S3','S6']};
   return {response:JSON.stringify({parts:payload.parts.map(part=>({partId:part.partId,status:'answered',
    reason:'The cited passages establish the requested claims.',claims:part.claims.map(claim=>({
     claimId:claim.claimId,status:'answered',reason:'These spans support this exact answer sentence.',
     evidence:claim.sourceIds.filter(id=>supported[part.partId].includes(id)).map(sourceId=>({sourceId,
      spanIds:[sourceId+'-Q1']}))}))}))})};
  }
 ]);
 const result=await composeEvidenceAnswer('How do Hume and Kant differ over causal necessity?',sources,ai,[],
  {plan,catalog,trace:true});
 const reviewPayload=JSON.parse(ai.calls[1].request.messages[1].content);
 const synthesis=reviewPayload.parts.find(part=>part.partId==='P3');
 assert.deepEqual([...new Set(synthesis.claims.flatMap(item=>item.sourceIds))],['S1','S2','S3','S6']);
 assert.equal(result.questionParts[2].status,'unsupported');
 assert.ok(result.trace.reviewContract.supportIssues.some(issue=>
  issue.partId==='P3'&&issue.reason==='missing-claim-source-span'));
 assert.equal(result.evidenceMap.some(item=>item.partId==='P3'&&item.id==='S2'),false);
 assert.equal(ai.calls.length,2);
});

test('reviewed evidence keeps a selected span from every cited source within the six-span map budget',async()=>{
 const passage='Wollstonecraft explains how education and social position shape judgment and character. '.repeat(12);
 const sources=['S1','S4','S6'].map((id,index)=>({id,bookId:'87',title:'A Vindication of the Rights of Woman — Mary Wollstonecraft',
  page:48+index,url:`https://example.test/wollstonecraft#page=${48+index}`,text:passage,preview:passage}));
 const evidence=sources.map(source=>({sourceId:source.id,
  spanIds:buildReviewSpans(source.id,passage).slice(0,3).map(span=>span.spanId)}));
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
 assert.equal(mappedSpans.length,6);
 assert.ok(mappedSpans.every(item=>sources.find(source=>source.id===item.id).text.includes(item.quote)));
 assert.deepEqual(new Set(result.evidenceHighlights.map(item=>item.source_id)),mappedSourceIds);
 assert.equal(result.coverage,'full');
 assert.equal(ai.calls.length,2);
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

test('malformed reviewer JSON with unescaped quotation marks fails closed and preserves the cited draft as unverified',async()=>{
 const ai=makeAI([answer('PART P1\nHume links necessity to custom and regular conjunction. [S1]'),
  {response:'{"parts":[{"partId":"P1","status":"answered","reason":"The phrase "denial of self" is supported.","claims":[]}]}' }]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],
  {plan:onePartPlan,catalog,trace:true});
 assert.equal(result.outcome,'unverified-source-draft');
 assert.equal(result.coverage,'partial');
 assert.equal(result.reviewStatus,'review-format-failed');
 assert.match(result.answer,/custom and regular conjunction/);
 assert.deepEqual(result.trace.reviewContract.issues,['model-output-invalid-format']);
 assert.equal(ai.calls.length,2,'format handling must not make an additional model call');
});

test('a repeated top-level parts key cannot produce a verified draft after JSON parsing drops a part decision',async()=>{
 const duplicate='{"parts":[{"partId":"P1","status":"answered","reason":"supported","claims":[]}],'+
  '"status":"answered","parts":[{"partId":"P2","status":"answered","reason":"supported","claims":[]}]}';
 const ai=makeAI([answer('PART P1\nHume links necessity to custom and regular conjunction. [S1]'),
  {response:duplicate}]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],
  {plan:onePartPlan,catalog,trace:true});
 assert.equal(result.outcome,'unverified-source-draft');
 assert.equal(result.coverage,'partial');
 assert.equal(result.reviewStatus,'review-contract-incomplete');
 assert.match(result.answer,/custom and regular conjunction/);
 assert.ok(result.trace.reviewContract.issues.includes('unknown-part'));
 assert.ok(result.trace.reviewContract.issues.includes('missing-part-decision'));
 assert.equal(ai.calls.length,2);
});

test('review schema aliases and an omitted part status recover only from complete claim decisions',async()=>{
 const source={...hume,title:'An Enquiry Concerning Human Understanding — David Hume (edited by Walter Editor)',
  text:"EDITOR'S INTRODUCTION\n"+hume.text};
 let composePayload,reviewPayload;
 const ai={run:async(_model,{messages})=>{
  if(messages[0].content.startsWith('Answer the reader')){
   composePayload=JSON.parse(messages[1].content);
   return answer('PART P1\nHume says necessity arises from custom after repeated conjunction. [S1]');
  }
  reviewPayload=JSON.parse(messages[1].content);
  const claim=reviewPayload.parts[0].claims[0];
  return {response:'```json\n'+JSON.stringify({parts:[{partId:'P1',reason:'The evidence directly supports this claim.',
   answers:[{claimId:claim.claimId,status:'answered',reason:'The selected span states this relation.',
    evidence:[{sourceId:'S1',spanIds:['S1-Q1']}]}]}]})+'\n```'};
 }};
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[source],ai,[],{
  plan:{...onePartPlan,sources:[{label:'Hume commentary',role:'commentary',bookIds:['35']}]},catalog,trace:true});
 assert.equal(result.coverage,'full');
 assert.equal(reviewPayload.parts[0].claims[0].claimId,'P1-C1');
 assert.equal(reviewPayload.parts[0].claims[0].text,'Hume says necessity arises from custom after repeated conjunction.');
 assert.deepEqual(reviewPayload.parts[0].claims[0].sourceIds,['S1']);
 assert.equal('answers' in reviewPayload.parts[0],false);
 assert.deepEqual(composePayload.evidence[0].provenance,{work:'An Enquiry Concerning Human Understanding',
  creditedAuthors:['David Hume'],creditedEditors:['Walter Editor'],creditedTranslators:[],plannerSourceRole:'commentary',
  pageSectionHint:'introduction',pageVoiceHint:'editor-authored section',
  roleMeaning:'The planner role describes intended source selection, not the voice or genre of this individual page.'});
 assert.deepEqual(reviewPayload.parts[0].evidence[0].provenance,composePayload.evidence[0].provenance);
 assert.deepEqual(result.trace.reviewContract.recovered,['P1:answers-alias','P1:part-status-derived']);
 assert.match(REVIEW_PROMPT,/credited author is not automatically/i);
});

test('a fenced reviewer object with the observed stray closing tail parses but still requires every cited source span',async()=>{
 const sources=[{...hume,id:'S4',title:'Forgotten Truth — Huston Smith',text:'In Buddhism it is nirvana and sunyata (emptiness, a void).',
   preview:'In Buddhism it is nirvana and sunyata (emptiness, a void).'},
  {...hume,id:'S5',title:'Forgotten Truth — Huston Smith',text:'182 / INDEX\nvoid (sunyata), 66; Zen, 48; emptiness, 193',
   preview:'182 / INDEX\nvoid (sunyata), 66; Zen, 48; emptiness, 193'}];
 const ai=makeAI([answer('PART P1\nSunyata means emptiness or a void in Buddhism [S4, S5].'),
  (_model,{messages})=>{
   const part=JSON.parse(messages[1].content).parts[0],claim=part.claims[0];
   return {response:'```json\n'+JSON.stringify({parts:[{partId:'P1',status:'answered',
    reason:'The available passage gives the definition.',claims:[{claimId:claim.claimId,status:'answered',
     reason:'The span on S4 states the definition.',evidence:[{sourceId:'S4',spanIds:['S4-Q1']}]}]}]})+' ]}\n```'};
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
 const reviewPayload=JSON.parse(ai.calls[1].request.messages[1].content);
 assert.deepEqual(reviewPayload.parts.find(part=>part.partId==='P3').claims[0].sourceIds,['S1','S2']);
 assert.deepEqual([...new Set(result.evidenceMap.filter(item=>item.partId==='P3').map(item=>item.id))],['S1','S2']);
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
   spanIds:['S1-Q1']}]}})]);
 await composeEvidenceAnswer('According to 1 John 4:7-12, what does love mean?',[source],ai,[],
  {plan,catalog,trace:true});
 const composePayload=JSON.parse(ai.calls[0].request.messages[1].content);
 const reviewPayload=JSON.parse(ai.calls[1].request.messages[1].content);
 assert.equal(composePayload.evidence[0].text,source.scopeText);
 assert.equal(composePayload.evidence[0].contextText,source.text);
 assert.equal(reviewPayload.parts[0].evidence[0].spans[0].text,source.scopeText);
 assert.equal(reviewPayload.parts[0].evidence[0].spans[0].spanId,'S1-Q1');
 assert.equal(reviewPayload.parts[0].evidence[0].contextText,source.text);
});
