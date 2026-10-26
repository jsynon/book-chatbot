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
 