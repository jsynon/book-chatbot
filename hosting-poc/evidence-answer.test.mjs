Warning: truncated output (original token count: 26544)
Total output lines: 1616

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
  const parts=payload.parts.map(part=>({partId:part.partId,
   status:statusByPart.get(part.partId)||'partial'}));
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
   const payload=JSON.parse(messages[1].content),claim=payload.claims[0],sourceDecision=claim.sourceEvidence[0];
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
   const payload=JSON.parse(messages[1].content),claim=payload.claims[0];
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
    const payload=JSON.parse(messages[1].content);
    return {response:JSON.stringify({parts:[{partId:'P1',status:'answered'}],
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
  const claim=reviewPayload.claims[0];
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered'}],
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
test('compact review decisions validate exact spans without rationale text or repeated payload fields',async()=>{
 let reviewPayload;
 const ai={run:async(_model,{messages,max_completion_tokens})=>{
  if(messages[0].content.startsWith('Answer the reader'))return answer('PART P1\nHume links necessity to custom and regular conjunction. [S1]');
  reviewPayload=JSON.parse(messages[1].content);
  const claim=reviewPayload.claims[0],span=reviewPayload.parts[0].evidence[0].spans[0];
  assert.equal(max_completion_tokens,1800);
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered'}],
   claims:[{claimId:claim.claimId,status:'answered',sources:[{sourceId:'S1',status:'answered',
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
 assert.deepEqual(reviewPayload.claims[0].sourceEvidence[0].sourceGroup,{label:'David Hume',role:'primary'});
 assert.equal('candidateSourceIds' in reviewPayload.parts[0],false);
 assert.equal('sha256' in reviewPayload.parts[0].evidence[0],false);
});

test('source-grouped review makes each cited source decision explicit and keeps a missing side partial',async()=>{
 const plan={...twoSidePlan,parts:[{id:'P1',question:'How do Hume and Kant differ?',sourceBookIds:['35','40'],
  candidateSourceIds:['S1','S2']}]};
 const ai=makeAI([answer('PART P1\nHume grounds necessity in custom, while Kant treats causality as a priori. [S1, S2]'),
  (_model,{messages})=>{
   const payload=JSON.parse(messages[1].content),claim=payload.claims[0];
   const sourceDecision=(sourceId,status)=>({sourceId,status,spanIds:status==='answered'?
    [claim.sourceEvidence.find(item=>item.sourceId===sourceId).spanIds[0]]:[]});
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered'}],claims:[{
    claimId:claim.claimId,status:'answered',sources:[sourceDecision('S1','answered'),sourceDecision('S2','partial')]}]})};
  }]);
 const result=await composeEvidenceAnswer('How do Hume and Kant differ over causal necessity?',
  [{...hume,candidatePartIds:['P1']},{...kant,candidatePartIds:['P1']}],ai,[],{plan,catalog,trace:true});
 const payload=JSON.parse(ai.calls[1].request.messages[1].content);
 assert.deepEqual(payload.claims[0].sourceIds,['S1','S2']);
 assert.deepEqual(payload.claims[0].sourceEvidence.map(item=>item.sourceId),['S1','S2']);
 assert.equal(result.coverage,'none');
 assert.ok(result.trace.reviewContract.supportIssues.some(issue=>
  issue.sourceId==='S2'&&issue.reason==='claim-source-not-supported'));
 assert.equal(result.evidenceMap.length,0);
 assert.equal(ai.calls.length,2);
});
test('compact review cannot verify a sentence unless every cited source has a selected span',async()=>{
 const ai=makeAI([answer('PART P1\nHume grounds necessity in custom, while Kant treats causality as a priori. [S1, S2]'),
  (_model,{messages})=>{
   const payload=JSON.parse(messages[1].content),part=payload.parts[0],claim=payload.claims.find(claim=>claim.partId===part.partId);
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
 assert.equal(ai.calls.length,2);
});
test('review truncation remains fail-closed and exposes a stage-specific reason without another call',async()=>{
 const ai=makeAI([answer('PART P1\nHume links necessity to custom and regular conjunction. [S1]'),
  {choices:[{finish_reason:'length',message:{content:'{"parts":[{"partId":"P1"'}}],
   usage:{neurons:3,prompt_tokens:500,completion_tokens:1800}}]);
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
  answer('PART P1\nJohannes de Silentio presents faith as following the movement of infinity. [S5] Faith is inwardness higher than outwardness. [S5]'),
  (_model,{messages})=>{
   const payload=JSON.parse(messages[1].content),part=payload.parts[0],partClaims=payload.claims.filter(claim=>claim.partId===part.partId),quote=part.evidence[0].spans[0].spanId;
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

test('a partially reviewed sentence is not promoted by dropping its unsupported citation',async()=>{
 const unrelated={...hume,id:'S1',bookId:'140',title:'Fear and Trembling — Søren Kierkegaard',page:17,
  text:'The knight of faith lives an ordinary life after making the movement of infinity.',
  preview:'The knight of faith lives an ordinary life after making the movement of infinity.'};
 const supporting={...unrelated,id:'S2',page:93,
  text:'The opposite of sin is faith.',preview:'The opposite of sin is faith.'};
 const plan={intent:'explain',sources:[{label:'Søren Kierkegaard',role:'primary',bookIds:['140']}],
  parts:[{id:'P1',question:'What is the Christian opposite of sin?',sourceBookIds:['140']}]};
 const ai=makeAI([answer('PART P1\nJohannes de Silentio states that the Christian opposite of sin is faith. [S2, S1]'),(_model,{messages})=>{
  const payload=JSON.parse(messages[1].content),claim=payload.claims[0];
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
 assert.equal(ai.calls.length,2);
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
  const payload=JSON.parse(messages[1].content),claim=payload.claims[0];
  const spanFor=sourceId=>claim.sourceEvidence.find(item=>item.sourceId===sourceId).spanIds[0];
  return {response:JSON.stringify({parts:[{partId:'P1',status:'partial'}],claims:[{
   claimId:claim.claimId,status:'partial',sources:[
    {sourceId:'S2',status:'answered',spanIds:[spanFor('S2')]},
    {sourceId:'S1',status:'unanswered',spanIds:[]}
   ]}]})};
 }]);
 const result=await composeEvidenceAnswer('What guides human life?',[unrelated,supporting],ai,[],{
  catalog,plan,trace:true
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
   const payload=JSON.parse(messages[1].content);
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
 const ai=makeAI([hypotheticalDraft(
  'From these passages, one cautious inference is that Nietzsche might reject Kierkegaard’s account of faith. [S1, S2]'),
  (_model,{messages})=>{
   const payload=JSON.parse(messages[1].content);
   const claims=payload.claims.map(claim=>({claimId:claim.claimId,status:'answered',
    sources:claim.sourceIds.map(sourceId=>({sourceId,
     status:claim.partId==='P3'&&sourceId==='S2'?'unanswered':'answered',
     spanIds:claim.partId==='P3'&&sourceId==='S2'?[]:[sourceId+'-Q1']}))}));
   return {response:JSON.stringify({parts:payload.parts.map(part=>({partId:part.partId,status:'answered'})),claims})};
  }
 ]);
 const result=await composeEvidenceAnswer(hypotheticalQuestion,hypotheticalSources,ai,[],{
  plan:hypotheticalPlan,catalog:hypotheticalCatalog,trace:true
 });
 assert.equal(ai.calls.length,2);
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
   const payload=JSON.parse(messages[1].content),part=payload.parts[0],claim=payload.claims.find(claim=>claim.partId===part.partId);
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
 assert.equal(ai.calls.length,2);
 assert.equal(result.coverage,'none');
 assert.equal(result.outcome,'insufficient-evidence');
 assert.equal(result.evidenceMap.length,0);
 assert.doesNotMatch(result.answer,/vulgar|hinders/i);
});
const onePartPlan={version:'reader-evidence-v2',intent:'explain',
 sources:[{label:'David Hume',role:'primary',bookIds:['35']}],
 parts:[{id:'P1',question:'How does Hume explain causal necessity?',sourceBookId…10544 tokens truncated…gify({parts:[{partId:'P1',status:'answered'}],claims})};
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
  {partId:'P1',claimId:'P1-C1',sourceId:'S2',reason:'missing-claim-source-span'}]);
 assert.deepEqual(result.trace.reviewContract.reviewDecisions,[{
  partId:'P1',claimId:'P1-C1',sourceId:'S2',claimText:'Kant lists causality among the categories of relation.',
  claimStatus:'answered',sourceStatus:'partial',
  candidateSpanIds:['S2-Q1'],reviewerSpanIds:[],acceptedSpanIds:[],acceptedQuote:'',acceptedQuotes:[],accepted:false,
  validationReason:'missing-claim-source-span'
 }]);
 assert.equal(result.evidenceMap.length,0);
});

test('invented and cross-source span IDs cannot enter the reviewed evidence map',async()=>{
 const plan={...onePartPlan,parts:[{...onePartPlan.parts[0],candidateSourceIds:['S1']}]};
 const ai=makeAI([answer('PART P1\nHume grounds necessity in custom and regularity. [S1]'),
  (_model,{messages})=>{
   const payload=JSON.parse(messages[1].content),claim=payload.claims[0];
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered'}],claims:[{claimId:claim.claimId,
    status:'answered',spanIds:['S2-Q1','S1-Q999','S99-Q1']}]})};
  }]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],
  {plan,catalog,trace:true});
 assert.equal(result.questionParts[0].status,'unsupported');
 assert.deepEqual(result.trace.reviewContract.supportIssues,[
  {partId:'P1',claimId:'P1-C1',sourceId:'S1',reason:'missing-claim-source-span'}]);
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
 assert.deepEqual(result.trace.reviewContract.reviewDecisions,[{
  partId:'P1',claimId:'P1-C1',sourceId:'S1',claimText:'Aristotle treats soul as the actuality of a living body.',
  claimStatus:'answered',sourceStatus:'answered',
  candidateSpanIds:result.trace.reviewContract.reviewDecisions[0].candidateSpanIds,
  reviewerSpanIds:[spans[0].spanId],acceptedSpanIds:[spans[0].spanId],
  acceptedQuote:spans[0].text.slice(0,280),acceptedQuotes:[spans[0].text.slice(0,280)],
  accepted:true,validationReason:null
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
   reviewPayload=JSON.parse(messages[1].content);
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

test('the reviewer can retain several exact spans from one source for one fully supported claim',async()=>{
 const source={...hume,
  text:'Repeated conjunctions are observed between similar events.\n\n\nThe mind is determined by custom to infer one event from another.\n\n\nThe idea of necessary connection arises from this transition of thought.',
  preview:'Repeated conjunctions are observed between similar events.\n\n\nThe mind is determined by custom to infer one event from another.\n\n\nThe idea of necessary connection arises from this transition of thought.'};
 const spans=buildReviewSpans('S1',source.text);
 assert.equal(spans.length,3);
 const ai=makeAI([answer('PART P1\nHume links repeated conjunctions, custom, and the mind’s inference to our idea of necessary connection. [S1]'),
  (_model,{messages})=>{
   const payload=JSON.parse(messages[1].content),claim=payload.claims[0];
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
 const ai=makeAI([
  answer('PART P1\nHume grounds necessity in custom and regular conjunction. [S1] External objects do not reveal power directly. [S2]\n'+
   'PART P2\nKant treats causal connection as a priori and necessary. [S3, S6]\n'+
   'PART P3\nHume explains necessity through custom, while Kant grounds causal connection in a priori categories. [S1, S2, S3, S6]'),
  (_model,{messages})=>{
   const payload=JSON.parse(messages[1].content);
   const supported={P1:['S1','S2'],P2:['S3','S6'],P3:['S1','S3','S6']};
   return {response:JSON.stringify({parts:payload.parts.map(part=>({partId:part.partId,status:'answered'})),
    claims:payload.claims.map(claim=>({claimId:claim.claimId,status:'answered',
     spanIds:claim.sourceIds.filter(id=>supported[claim.partId].includes(id)).map(sourceId=>sourceId+'-Q1')}))} )};
  }
 ]);
 const result=await composeEvidenceAnswer('How do Hume and Kant differ over causal necessity?',sources,ai,[],
  {plan,catalog,trace:true});
 const reviewPayload=JSON.parse(ai.calls[1].request.messages[1].content);
 const synthesisClaims=reviewPayload.claims.filter(claim=>claim.partId==='P3');
 assert.deepEqual([...new Set(synthesisClaims.flatMap(item=>item.sourceIds))],['S1','S2','S3','S6']);
 assert.equal(result.questionParts[2].status,'unsupported');
 assert.ok(result.trace.reviewContract.supportIssues.some(issue=>
  issue.partId==='P3'&&issue.reason==='missing-claim-source-span'));
 assert.equal(result.evidenceMap.some(item=>item.partId==='P3'&&item.id==='S2'),false);
 assert.equal(ai.calls.length,2);
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
 assert.deepEqual(new Set(result.evidenceHighlights.map(item=>item.source_id)),mappedSourceIds);
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
 assert.equal(ai.calls.length,2);
});

test('reviewer contract errors preserve citation-checked text as an explicitly unverified partial draft',async()=>{
 const ai=makeAI([answer('PART P1\nHume links necessity to custom and regular conjunction. [S1]'),
  {response:JSON.stringify({parts:[],claims:[]})}]);
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

test('run 48 reviewer typo fails closed without exposing unreviewed evidence',async()=>{
 const ai=makeAI([answer('PART P1\nHume links necessity to custom and regular conjunction. [S1]'),
  {response:'{"parts":[{"partId":"P1","status":"partial"}],"claims":[{"claimId":"P1-C1","status":"unanswered","spansBySource:{}}'}]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],
  {plan:onePartPlan,catalog,trace:true});
 assert.equal(result.outcome,'unverified-source-draft');
 assert.equal(result.coverage,'partial');
 assert.equal(result.reviewStatus,'review-format-failed');
 assert.deepEqual(result.evidenceMap,[]);
 assert.deepEqual(result.evidenceHighlights,[]);
 assert.equal(result.trace.reviewContract.issues[0],'model-output-invalid-format');
 assert.equal(ai.calls.length,2);
});

test('a repeated top-level parts key cannot produce a verified draft after JSON parsing drops a part decision',async()=>{
 const duplicate='{"parts":[{"partId":"P1","status":"answered"}],"claims":[],'+
  '"status":"answered","parts":[{"partId":"P2","status":"answered"}]}';
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

test('flat reviewer decisions retain exact provenance and source-encoded spans',async()=>{
 const source={...hume,title:'An Enquiry Concerning Human Understanding — David Hume (edited by Walter Editor)',
  text:"EDITOR'S INTRODUCTION\n"+hume.text};
 let composePayload,reviewPayload;
 const ai={run:async(_model,{messages})=>{
  if(messages[0].content.startsWith('Answer the reader')){
   composePayload=JSON.parse(messages[1].content);
   return answer('PART P1\nHume says necessity arises from custom after repeated conjunction. [S1]');
  }
  reviewPayload=JSON.parse(messages[1].content);
  const claim=reviewPayload.claims[0];
  return {response:'```json\n'+JSON.stringify({parts:[{partId:'P1',status:'answered'}],
   claims:[{claimId:claim.claimId,status:'answered',spanIds:['S1-Q1']}]})+'\n```'};
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
 assert.match(REVIEW_PROMPT,/metadata .*context, not proof of who speaks/i);
});

test('a fenced reviewer object with the observed stray closing tail parses but still requires every cited source span',async()=>{
 const sources=[{...hume,id:'S4',title:'Forgotten Truth — Huston Smith',text:'In Buddhism it is nirvana and sunyata (emptiness, a void).',
   preview:'In Buddhism it is nirvana and sunyata (emptiness, a void).'},
  {...hume,id:'S5',title:'Forgotten Truth — Huston Smith',text:'182 / INDEX\nvoid (sunyata), 66; Zen, 48; emptiness, 193',
   preview:'182 / INDEX\nvoid (sunyata), 66; Zen, 48; emptiness, 193'}];
 const ai=makeAI([answer('PART P1\nSunyata means emptiness or a void in Buddhism [S4, S5].'),
  (_model,{messages})=>{
   const payload=JSON.parse(messages[1].content),part=payload.parts[0],claim=payload.claims[0];
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
 assert.deepEqual(reviewPayload.claims.find(claim=>claim.partId==='P3').sourceIds,['S1','S2']);
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
