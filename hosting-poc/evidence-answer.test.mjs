import test from 'node:test';
import assert from 'node:assert/strict';
import {composeEvidenceAnswer,linkEvidenceToParts,COMPOSER_PROMPT,REVIEW_PROMPT,parseReviewJson} from './evidence-answer.mjs';
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
function makeAI(responses,{decorateReview=true}={}){
 const calls=[];
 return {calls,run:async(model,request)=>{calls.push({model,request});const next=responses.shift();
   if(next instanceof Error)throw next;
   const result=typeof next==='function'?next(model,request):next;
   // Most fixtures predate the direct-answer field and test other review rules.
   // Give those valid mock reviews one claim per part; focused contract tests opt out.
   const systemText=String(request?.messages?.[0]?.content||'');
   if(decorateReview&&systemText.includes('directAnswerClaimIds')&&typeof result?.response==='string'){
    try{
     const reviewObject=JSON.parse(result.response);
     const payload=JSON.parse(request.messages[1].content);
     if(Array.isArray(reviewObject.parts)&&Array.isArray(reviewObject.claims)){
      for(const part of reviewObject.parts){
       if(Array.isArray(part.directAnswerClaimIds))continue;
       part.directAnswerClaimIds=payload.claims
        .filter(claim=>claim.partId===part.partId).slice(0,1).map(claim=>claim.claimId);
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
 assert.equal(ai.calls.length,2,'the reconstructed plan uses the existing composition and review calls only');
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
  reviewPayload=JSON.parse(messages[1].content);
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
   reviewPayload=JSON.parse(messages[1].content);
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
  reviewPayload=JSON.parse(messages[1].content);
  const claim=reviewPayload.claims[0],span=reviewPayload.parts[0].evidence[0].spans[0];
  assert.equal(max_completion_tokens,1800);
  return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',directAnswerClaimIds:[claim.claimId]}],
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
   const payload=JSON.parse(messages[1].content),claim=payload.claims[0];
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
    const payload=JSON.parse(messages[1].content),claim=payload.claims[0];
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
   const payload=JSON.parse(messages[1].content),claim=payload.claims[0];
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
  const payload=JSON.parse(messages[1].content);
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
  inference),review([['P1','answered'],['P2','answered'],['P3','answered']])]);
 const result=await composeEvidenceAnswer('How do Hume and Kant differ over causal necessity?',
  [{...hume,candidatePartIds:['P1','P3']},{...kant,candidatePartIds:['P2','P3']}],ai,[],
  {plan:twoSidePlan,catalog,trace:true});
 assert.equal(result.coverage,'full','supported direct comparison claims still answer every part');
 assert.doesNotMatch(result.answer,/cautious reader inference|necessary transcendental principle/);
 assert.ok(result.trace.rejected.some(item=>item.partId==='P3'&&
  item.reason==='unrequested-cross-author-inference'));
 assert.equal(ai.calls.length,2,'the scope guard reuses compose and review without an extra call');
});

test('comparison handoff rejects the uncited opening and unrequested might-suggest bridge',async()=>{
 const inference='If Kant applied his view of causality to Hume’s account, he might suggest that custom is a necessary transcendental principle. [S1, S2]';
 const ai=makeAI([answer('PART P1\nHume explains causal expectation through custom rather than reasoning. [S1]\n'+
  'PART P2\nKant identifies causality as an a priori category of relation. [S2]\n'+
  'PART P3\nHume and Kant differ in their accounts of causal necessity.\n'+
  'Hume ties causal expectation to custom. [S1] Kant treats causality as an a priori category. [S2]\n'+inference),
  review([['P1','answered'],['P2','answered'],['P3','answered']])]);
 const result=await composeEvidenceAnswer('How do Hume and Kant differ over causal necessity?',
  [{...hume,candidatePartIds:['P1','P3']},{...kant,candidatePartIds:['P2','P3']}],ai,[],
  {plan:twoSidePlan,catalog,trace:true});
 assert.ok(result.trace.rejected.some(item=>item.partId==='P3'&&item.reason==='sentence-missing-citation'));
 assert.ok(result.trace.rejected.some(item=>item.partId==='P3'&&item.reason==='unrequested-cross-author-inference'));
 assert.doesNotMatch(result.answer,/differ in their accounts|might suggest/);
 assert.equal(result.questionParts.find(part=>part.part.includes('differ')).status,'partial',
  'later cited propositions cannot silently replace the rejected required opening sentence');
 const comparisonDecision=result.trace.reviewContract.partDecisions.find(item=>item.partId==='P3');
 assert.equal(comparisonDecision.finalStatus,'answered',
  'the trace preserves the reviewer-stage status after exact-span checks');
 assert.equal(comparisonDecision.outputStatus,'partial',
  'the trace also records the incomplete status actually returned after the uncited required sentence was removed');
 assert.ok(result.trace.coverageGaps.some(item=>item.partId==='P3'&&
  item.reason==='required-direct-answer-rejected'));
 assert.equal(ai.calls.length,2,'the handoff stays within one compose and one review call');
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
  directAnswerReview([])],{decorateReview:false});
 const result=await composeEvidenceAnswer(hamletMeaningQuestion,[hamletMeaningSource],ai,[],{
  plan:hamletMeaningPlan,catalog:{212:hamletMeaningSource.title},trace:true});
 assert.equal(result.questionParts[0].status,'partial');
 assert.equal(result.coverage,'partial');
 assert.ok(result.trace.reviewContract.supportIssues.some(issue=>
  issue.partId==='P1'&&issue.reason==='direct-answer-claim-missing'));
 assert.deepEqual(result.trace.reviewContract.partDecisions,[{
  partId:'P1',reviewerStatus:'answered',finalStatus:'partial',directAnswerClaimIds:[],
  acceptedDirectAnswerClaimIds:[],directAnswerCovered:false,outputStatus:'partial'
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
  partId:'P1',reviewerStatus:'answered',finalStatus:'answered',directAnswerClaimIds:['P1-C1'],
  acceptedDirectAnswerClaimIds:['P1-C1'],directAnswerCovered:true,outputStatus:'supported'
 }]);
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
   sourceBookIds:['21'],candidateSourceIds:['S1']}]};
 const draft='PART P1\nLady Philosophy explains that Fortune is inherently unstable because her very nature is defined by inconstancy and changing lots. [S1]';
 const run=async(partStatus)=>{
  let reviewerPayload;
  const ai=makeAI([answer(draft),(_model,{messages})=>{
   reviewerPayload=JSON.parse(messages[1].content);
   const claim=reviewerPayload.claims[0];
   const sourceEvidence=claim.sourceEvidence.find(item=>item.sourceId==='S1');
   const pageEvidence=reviewerPayload.parts[0].evidence.find(item=>item.id==='S1');
   const sourceReason=pageEvidence.spans.find(span=>/constancy which belongs not to my ways/i.test(span.text));
   assert.ok(sourceReason,'the relevant statement is present in the supplied part evidence');
   assert.ok(!sourceEvidence.spanIds.includes(sourceReason.spanId),
    'this fixture reproduces the run 14 miss: the exact span is outside the ranked claim hints');
   return {response:JSON.stringify({
    parts:[{partId:'P1',status:partStatus,directAnswerClaimIds:[claim.claimId]}],
    claims:[{claimId:claim.claimId,status:'answered',sources:[{
     sourceId:'S1',status:'answered',spanIds:[sourceReason.spanId]}]}]
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
   const payload=JSON.parse(messages[1].content),claim=payload.claims[0];
   const spans=payload.parts[0].evidence[0].spans;
   const selected=spans.filter(span=>/constancy which belongs not to my ways|unchanging sport.*wheel/is.test(span.text));
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',directAnswerClaimIds:['P1-C1']}],
    claims:[{claimId:claim.claimId,status:'answered',sources:[{sourceId:'S1',status:'answered',
     spanIds:selected.map(span=>span.spanId)}]}]})};
  }],{decorateReview:false});
 const result=await composeEvidenceAnswer('How does Lady Philosophy explain the instability of Fortune?',
  [source],ai,[],{plan,catalog:{21:source.title},trace:true});
 const reviewPayload=JSON.parse(ai.calls[1].request.messages[1].content);
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
   const payload=JSON.parse(messages[1].content);
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
   const payload=JSON.parse(messages[1].content);
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

test('a direct-answer claim ID from another part cannot mark this part supported',async()=>{
 const ai=makeAI([answer('PART P1\nThe phrase means fear of death can make people hesitate to act. [S1]'),
  directAnswerReview(['P2-C1'])],{decorateReview:false});
 const result=await composeEvidenceAnswer(hamletMeaningQuestion,[hamletMeaningSource],ai,[],{
  plan:hamletMeaningPlan,catalog:{212:hamletMeaningSource.title},trace:true});
 assert.equal(result.questionParts[0].status,'partial');
 assert.ok(result.trace.reviewContract.supportIssues.some(issue=>
  issue.partId==='P1'&&issue.reason==='direct-answer-claim-id-invalid'));
});

test('a reviewer that omits direct-answer IDs leaves the part partial',async()=>{
 const ai=makeAI([answer('PART P1\nThe phrase means fear of death can make people hesitate to act. [S1]'),
  (_model,{messages})=>{
   const payload=JSON.parse(messages[1].content);
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered'}],
    claims:payload.claims.map(claim=>({claimId:claim.claimId,status:'answered',
     sources:claim.sourceIds.map(sourceId=>({sourceId,status:'answered',
      spanIds:claim.sourceEvidence.find(item=>item.sourceId===sourceId).spanIds.slice(0,1)}))}))})};
  }],{decorateReview:false});
 const result=await composeEvidenceAnswer(hamletMeaningQuestion,[hamletMeaningSource],ai,[],{
  plan:hamletMeaningPlan,catalog:{212:hamletMeaningSource.title},trace:true});
 assert.equal(result.questionParts[0].status,'partial');
 assert.ok(result.trace.reviewContract.supportIssues.some(issue=>
  issue.partId==='P1'&&issue.reason==='direct-answer-claims-missing'));
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

test('the composer uses a short per-part answer contract and the reviewer links exact quotes to claims',()=>{
 assert.match(COMPOSER_PROMPT,/one heading and a concise answer for each supplied part/);
 assert.match(COMPOSER_PROMPT,/A part may use up to three short paragraphs when distinct evidence needs separate explanation/);
 assert.match(COMPOSER_PROMPT,/two or three short paragraphs/);
 assert.match(COMPOSER_PROMPT,/whether from one work or several/);
 assert.match(COMPOSER_PROMPT,/roughly 160–260 words as a guide, not a quota/);
 assert.match(COMPOSER_PROMPT,/If one source directly answers or the evidence is thin, stay concise/);
 assert.match(COMPOSER_PROMPT,/Do not pad, repeat, or add a source just to lengthen the response/);
 assert.doesNotMatch(COMPOSER_PROMPT,/80–140 words/);
 assert.match(COMPOSER_PROMPT,/planner's search queries are retrieval leads, not a list of topics/);
 assert.match(COMPOSER_PROMPT,/one main claim/);
 assert.match(COMPOSER_PROMPT,/Answer each supplied question part directly in its first sentence/);
 assert.match(COMPOSER_PROMPT,/When a part asks why something happens, state the page’s own reason in its terms/);
 assert.match(COMPOSER_PROMPT,/When the question asks only for a comparison, do not append a counterfactual/);
 assert.match(COMPOSER_PROMPT,/interpret it in plain language before describing consequences/);
 assert.match(COMPOSER_PROMPT,/When the supplied pages state the reason or premise that leads to the phrase's meaning, explain that causal step as well as the consequence/);
 assert.match(COMPOSER_PROMPT,/When a later source reports a historical figure's teaching, attribute it as that source's account or attribution/);
 assert.match(COMPOSER_PROMPT,/make the reporting source the grammatical subject/);
 assert.match(COMPOSER_PROMPT,/Do not add a preface, status labels, bullets, inline list markers/);
 assert.match(REVIEW_PROMPT,/For a later source reporting a historical figure, distinguish the source's report or attribution from a directly verified statement/);
 assert.match(REVIEW_PROMPT,/explicitly framed as the reporting source's account/);
 assert.match(COMPOSER_PROMPT,/each author’s position in a separate cited clause of the opening sentence/);
 assert.match(COMPOSER_PROMPT,/The first sentence of a comparison part must itself be a sourced comparison, with evidence for each side cited in that sentence/);
 assert.match(COMPOSER_PROMPT,/do not bundle distinct speaker claims under one shared citation group/);
 assert.match(COMPOSER_PROMPT,/use the smallest set of pages that directly supports that claim/);
 assert.match(COMPOSER_PROMPT,/Do not add a page just because it was retrieved or belongs to the same author/);
 assert.match(COMPOSER_PROMPT,/If distinct claims rely on different passages, write separate sentences/);
 assert.match(COMPOSER_PROMPT,/Never convert a printed page number into a source ID/);
 assert.match(COMPOSER_PROMPT,/When one sentence links a reason from one page to an outcome established on another, cite both pages/);
 assert.match(COMPOSER_PROMPT,/include each passage that supports a material clause/);
 assert.match(REVIEW_PROMPT,/sourceEvidence list of the highest-ranked same-source span IDs/);
 assert.match(REVIEW_PROMPT,/one flat top-level claims array/);
 assert.match(REVIEW_PROMPT,/only one top-level claims property/);
 assert.match(REVIEW_PROMPT,/one source decision for every source cited by every claim/);
 assert.match(REVIEW_PROMPT,/smallest set of up to 3 distinct relevant spans/);
 assert.match(REVIEW_PROMPT,/support every material clause or premise/);
 assert.doesNotMatch(REVIEW_PROMPT,/Return exactly one best matching span ID/);
 assert.match(COMPOSER_PROMPT,/attribute claims about that page to the commentator or the commentary/);
 assert.match(COMPOSER_PROMPT,/Cite every factual sentence/);
 assert.doesNotMatch(COMPOSER_PROMPT,/END EVIDENCE|unique ID|exact contiguous span/);
 assert.match(REVIEW_PROMPT,/\"claims\":\[\{/);
 assert.match(REVIEW_PROMPT,/\"parts\":\[\{/);
 assert.ok(REVIEW_PROMPT.indexOf('\"claims\":[')<REVIEW_PROMPT.indexOf('\"parts\":['),
  'the reviewer must emit claim/source decisions before selecting part coverage');
 assert.match(REVIEW_PROMPT,/Review every answer sentence separately/);
 assert.match(REVIEW_PROMPT,/stable claimId/);
 assert.match(REVIEW_PROMPT,/ranked hints, not an allowlist/);
 assert.match(REVIEW_PROMPT,/select another span only if it directly supports the claim/);
 assert.match(REVIEW_PROMPT,/same source's evidence list for the claim's part/);
 assert.doesNotMatch(REVIEW_PROMPT,/Use only supplied span IDs from that source's sourceEvidence list/);
 assert.match(REVIEW_PROMPT,/citation attached to a neighboring clause does not support it/);
 assert.match(REVIEW_PROMPT,/Select span IDs only/);
 assert.match(REVIEW_PROMPT,/"sources":\[\{"sourceId":"S1"/);
 assert.doesNotMatch(REVIEW_PROMPT,/spansBySource/);
 assert.match(REVIEW_PROMPT,/A neighboring doctrine, shared keyword, or citation alone is not support/);
 assert.match(REVIEW_PROMPT,/A reversed negation or attribution is a material contradiction/);
 assert.match(REVIEW_PROMPT,/review every cited source ID separately/);
 assert.match(REVIEW_PROMPT,/material clause or premise/i);
 assert.match(REVIEW_PROMPT,/require an explicit plain-language interpretation/);
 assert.match(REVIEW_PROMPT,/preserves that essential causal step as well as the outcome/);
 assert.match(REVIEW_PROMPT,/directAnswerClaimIds/);
 assert.match(REVIEW_PROMPT,/A consequence, example, or related fact alone is not a direct answer/);
 assert.match(REVIEW_PROMPT,/smallest sufficient set of claims/);
 assert.match(REVIEW_PROMPT,/First finish the claim and source decisions/);
 assert.match(REVIEW_PROMPT,/requiredAnswerClaimId/);
 assert.match(REVIEW_PROMPT,/even if an example or consequence remains/);
 assert.match(REVIEW_PROMPT,/Do not nominate a claim you marked partial or unanswered/);
 assert.match(REVIEW_PROMPT,/Do not list every claim by default/);
 assert.match(REVIEW_PROMPT,/unsupported non-direct claim can be omitted without downgrading/);
 assert.match(REVIEW_PROMPT,/assess each author’s premise only against that author’s evidence/);
 assert.match(REVIEW_PROMPT,/synthesis is answered only when the cited evidence supports the specific relationship/);
 assert.match(REVIEW_PROMPT,/Do not copy source wording into the response/);
 assert.match(REVIEW_PROMPT,/Return one valid JSON object only/);
 assert.match(COMPOSER_PROMPT,/For a hypothetical question about what one author would think of another/);
 assert.match(COMPOSER_PROMPT,/When both authors' passages establish the same specific concept/);
 assert.match(COMPOSER_PROMPT,/End the inference sentence with one citation group containing the smallest relevant evidence from each author's source group/);
 assert.match(COMPOSER_PROMPT,/smallest relevant evidence from each author's source group/);
 assert.match(COMPOSER_PROMPT,/do not attach every retrieved page or every page from an author group/);
 assert.match(COMPOSER_PROMPT,/A comparison alone does not answer the hypothetical part/);
 assert.match(COMPOSER_PROMPT,/a narrow conditional reader inference applying one author's documented view of that concept/);
 assert.match(REVIEW_PROMPT,/does not complete a part that asks what one author would think/);
 assert.match(REVIEW_PROMPT,/inference claim must include relevant evidence from every author source group/);
 assert.match(REVIEW_PROMPT,/do not demand that a source record the hypothetical response itself/);
 assert.match(REVIEW_PROMPT,/If a needed premise or shared point is missing, mark it partial or unanswered/);
 assert.match(REVIEW_PROMPT,/premises must establish the same specific point of contact/);
 assert.match(REVIEW_PROMPT,/The inference claim must include relevant evidence from every author source group/);
 assert.match(COMPOSER_PROMPT,/If provenance names a pseudonymous work voice, identify that voice/);
 assert.match(REVIEW_PROMPT,/Name a known pseudonymous voice in the first answer claim using that work/);
 assert.match(REVIEW_PROMPT,/First-person inability or experience does not establish a general rule/);
 assert.match(REVIEW_PROMPT,/Do not turn a work-specific claim into the author's general doctrine without evidence for that scope/);
 assert.match(REVIEW_PROMPT,/a broad comparison, unrelated quotation, one-sided citation/);
 assert.match(COMPOSER_PROMPT,/Do not narrate the retrieval process, inventory unrelated passages/);
 assert.match(REVIEW_PROMPT,/sourceGroup identifies the planner's author\/source group/);
 assert.match(REVIEW_PROMPT,/Keep broad author answers focused on the requested view/);
 assert.match(REVIEW_PROMPT,/Assess each cited author source against its own premise/);
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
  const payload=JSON.parse(messages[1].content);
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
 const ai=makeAI([hypotheticalDraft(
  'As a cautious reader inference, if Nietzsche applied his criticism of Christian faith to Johannes de Silentio’s account of faith, he might question whether that account establishes truth about God. [S1, S2]'),
  (_model,{messages})=>{reviewPayload=JSON.parse(messages[1].content);return hypotheticalReview()(_model,{messages});}
 ]);
 const result=await composeEvidenceAnswer(hypotheticalQuestion,hypotheticalSources,ai,[],{
  plan:hypotheticalPlan,catalog:hypotheticalCatalog,trace:true
 });
 assert.equal(ai.calls.length,2,'the fix must stay within the existing compose + review budget');
 assert.equal(result.coverage,'full');
 assert.equal(result.questionParts[2].status,'supported');
 assert.match(result.answer,/cautious reader inference/i);
 assert.match(result.answer,/applied his criticism of Christian faith/);
 assert.match(result.answer,/Johannes de Silentio/);
 assert.match(result.answer,/establishes truth about God/);
 assert.match(result.answer,/\[S1, S2\]/);
 assert.deepEqual(reviewPayload.claims.find(claim=>claim.partId==='P3').sourceEvidence.map(item=>item.sourceGroup),[
  {label:'Friedrich Nietzsche',role:'primary'},
  {label:'Søren Kierkegaard',role:'primary'}
 ]);
 assert.deepEqual(new Set(result.evidenceMap.filter(item=>item.claimId.startsWith('P3-'))
  .map(item=>item.id)),new Set(['S1','S2']));
 assert.equal(result.trace.reviewContract.valid,true);
 assert.deepEqual(result.trace.coverageGaps,[]);
});

test('a broad hypothetical conclusion stays partial even when both premise sources are supported',async()=>{
 const ai=makeAI([hypotheticalDraft(
  'From these passages, one cautious inference is that Nietzsche would reject Kierkegaard’s entire philosophy as life-denying. [S1, S2]'),
  (_model,{messages})=>{
   const payload=JSON.parse(messages[1].content);
   const claims=payload.claims.map(claim=>({claimId:claim.claimId,
    status:claim.partId==='P3'?'partial':'answered',
    sources:claim.sourceIds.map(sourceId=>({sourceId,status:'answered',
     spanIds:[claim.sourceEvidence.find(item=>item.sourceId===sourceId).spanIds[0]]}))}));
   return {response:JSON.stringify({parts:payload.parts.map(part=>({partId:part.partId,
    status:part.partId==='P3'?'partial':'answered'})),claims})};
  }
 ]);
 const result=await composeEvidenceAnswer(hypotheticalQuestion,hypotheticalSources,ai,[],{
  plan:hypotheticalPlan,catalog:hypotheticalCatalog,trace:true
 });
 assert.equal(ai.calls.length,2);
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
  reviewPayload=JSON.parse(messages[1].content);
  return hypotheticalReview()(_model,{messages});
 };
 const ai=makeAI([hypotheticalDraft(
  'From these passages, one cautious inference is that Nietzsche might have viewed Kierkegaard’s emphasis on religious inwardness as part of the Christian outlook he rejects. [S1, S2]'),
  reviewer
 ]);
 const result=await composeEvidenceAnswer(hypotheticalQuestion,sources,ai,[],{plan,catalog,trace:true});
 const inference=reviewPayload.claims.find(claim=>claim.partId==='P3');
 assert.deepEqual(inference.sourceIds,['S1','S2']);
 assert.equal(result.coverage,'full');
 assert.equal(ai.calls.length,2);
});

test('review sees a bounded per-source packet and cannot select an unsent full-source span',async()=>{
 const text=Array.from({length:24},(_,index)=>
  `This unrelated passage discusses ordinary philosophical subjects number ${index+1}.`).join('\n\n\n');
 const source={...hume,text,preview:text,candidatePartIds:['P1']};
 const plan={...onePartPlan,parts:[{...onePartPlan.parts[0],candidateSourceIds:['S1']} ]};
 const draft='PART P1\nHume explains causal necessity through custom and habit in repeated experience. [S1]';
 const runWithSpan=async spanId=>{
  let payload;
  const ai=makeAI([answer(draft),(_model,{messages})=>{
   payload=JSON.parse(messages[1].content);
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
 assert.equal(spans.length,8,'the reviewer packet has a fixed per-source cap');
 assert.ok(offered.result.trace.reviewContract.valid);
 assert.equal(offered.ai.calls.length,2);
 const omitted=await runWithSpan('S1-Q9');
 assert.ok(omitted.result.trace.reviewContract.supportIssues.some(issue=>
  issue.partId==='P1'&&issue.reason==='missing-claim-source-span'));
 assert.equal(omitted.result.coverage,'none',
  'a valid full-source span cannot be selected when it was not sent to this part review');
 assert.equal(omitted.ai.calls.length,2);
});

test('review deadline failure stays fail-closed and records the failed stage without retry',async()=>{
 const timeout=Object.assign(new Error('Inference deadline exceeded'),{
  stage:'review',code:'inference-deadline-exceeded',startedAt:Date.now()-45000
 });
 const ai=makeAI([answer('PART P1\nHume links causal expectation to custom and regular conjunction. [S1]'),timeout]);
 const result=await composeEvidenceAnswer('How does Hume explain causal necessity?',[hume],ai,[],{
  plan:onePartPlan,catalog,trace:true
 });
 assert.equal(ai.calls.length,2,'a failed review is not retried or repaired with another model call');
 assert.equal(result.outcome,'unverified-source-draft');
 assert.equal(result.coverage,'partial');
 assert.equal(result.trace.final.reviewFailure.stage,'review');
 assert.equal(result.trace.final.reviewFailure.code,'inference-deadline-exceeded');
 assert.ok(result.trace.final.reviewFailure.elapsedMs>=45000);
 assert.equal(result.evidenceHighlights.length,0,'unreviewed draft evidence does not become verified highlights');
});

test('an evidence limitation stays visible but cannot complete the requested hypothetical inference',async()=>{
 const limitation='The supplied passages do not warrant a reliable inference about how Nietzsche would respond to Kierkegaard. [S1, S2]';
 const reviewer=(_model,{messages})=>{
  const result=JSON.parse(hypotheticalReview()(_model,{messages}).response);
  result.parts.find(part=>part.partId==='P3').status='partial';
  return {response:JSON.stringify(result)};
 };
 const ai=makeAI([hypotheticalDraft(limitation),reviewer]);
 const result=await composeEvidenceAnswer(hypotheticalQuestion,hypotheticalSources,ai,[],{
  plan:hypotheticalPlan,catalog:hypotheticalCatalog,trace:true
 });
 assert.equal(ai.calls.length,2);
 assert.equal(result.coverage,'partial');
 assert.equal(result.questionParts[2].status,'partial');
 assert.match(result.answer,/do not warrant a reliable inference/);
 assert.deepEqual(result.trace.coverageGaps,[{partId:'P3',reason:'hypothetical-inference-missing'}]);
});

test('the run-58 comparison limitation remains partial while a positive inference needs both voices',async()=>{
 const limitation='Because Nietzsche characterizes faith as a psychological misunderstanding or a tool of priestly mastery [S1] and Kierkegaard describes faith as a transcendent, absurd movement of the self toward God [S2], the passages support a comparison but not a reliable inference about Nietzsche’s specific response to Kierkegaard’s thought.';
 const reviewer=(_model,{messages})=>{
  const result=JSON.parse(hypotheticalReview()(_model,{messages}).response);
  result.parts.find(part=>part.partId==='P3').status='partial';
  return {response:JSON.stringify(result)};
 };
 const ai=makeAI([hypotheticalDraft(limitation),reviewer]);
 const result=await composeEvidenceAnswer(hypotheticalQuestion,hypotheticalSources,ai,[],{
  plan:hypotheticalPlan,catalog:hypotheticalCatalog,trace:true
 });
 assert.equal(ai.calls.length,2);
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
   const payload=JSON.parse(messages[1].content),claim=payload.claims[0];
   const spanId=claim.sourceEvidence.find(item=>item.sourceId==='S1').spanIds[0];
   return {response:JSON.stringify({parts:[{partId:'P1',status:'answered',
    directAnswerClaimIds:[claim.claimId]}],claims:[{claimId:claim.claimId,status:'answered',
    sources:[{sourceId:'S1',status:'answered',spanIds:[spanId],
     attributionStatus:'conflict',attributedSpeaker:'Y. Chambers'}]}]})};
  }]);
 const result=await composeEvidenceAnswer(question,[source],ai,[],{
  plan,catalog:{80:'Buddha’s Teachings'},trace:true
 });
 assert.equal(ai.calls.length,2,'attribution is checked in the existing review call');
 assert.equal(result.coverage,'none','the misattributed claim cannot survive review');
 assert.ok(result.trace.reviewContract.supportIssues.some(issue=>
  issue.sourceId==='S1'&&issue.reason==='source-attribution-conflict'));
 assert.equal(result.trace.reviewContract.reviewDecisions[0].attributedSpeaker,'Y. Chambers');
});

test('known editorial and pseudonymous source voices must be named or mediated',async()=>{
 const run=async({source,title,bookId,question,draft,catalog,sourceLabel})=>{
  let composePayload,reviewPayload;
  const plan={...onePartPlan,sources:[{label:sourceLabel,role:'primary',bookIds:[bookId]}],
   parts:[{...onePartPlan.parts[0],question,sourceBookIds:[bookId],candidateSourceIds:['S1']}]};
  const ai=makeAI([(_model,{messages})=>{
   composePayload=JSON.parse(messages[1].content);
   return answer('PART P1\n'+draft+' [S1]');
  },(_model,{messages})=>{
   reviewPayload=JSON.parse(messages[1].content);
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
  const payload=JSON.parse(messages[1].content);
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

test('flat reviewer input keeps multi-part claims linked once and duplicate claims keys fail closed',async()=>{
 let reviewPayload;
 const draft=hypotheticalDraft(
  'From these passages, one cautious inference is that Nietzsche might have viewed Kierkegaard’s emphasis on religious inwardness as part of the Christian outlook he rejects. [S1, S2]');
 const ai=makeAI([draft,(_model,{messages})=>{
  reviewPayload=JSON.parse(messages[1].content);
  assert.deepEqual(reviewPayload.parts.map(part=>part.partId),['P1','P2','P3']);
  assert.ok(reviewPayload.parts.every(part=>!('claims' in part)));
  assert.deepEqual(reviewPayload.claims.map(claim=>[claim.partId,claim.claimId]),[
   ['P1','P1-C1'],['P2','P2-C1'],['P3','P3-C1']
  ]);
  assert.equal(reviewPayload.parts[0].evidence[0].id,'S1');
  assert.equal(reviewPayload.parts[1].evidence[0].id,'S2');
  const decisions=reviewPayload.claims.map(claim=>({claimId:claim.claimId,status:'answered',
   spanIds:claim.sourceIds.map(sourceId=>sourceId+'-Q1')}));
  const parts=reviewPayload.parts.map(part=>({partId:part.partId,status:'answered'}));
  return {response:'{"parts":'+JSON.stringify(parts)+
   ',"claims":['+JSON.stringify(decisions[0])+']'+
   ',"claims":['+JSON.stringify(decisions[1])+']'+
   ',"claims":['+JSON.stringify(decisions[2])+']}'};
 }]);
 const result=await composeEvidenceAnswer(hypotheticalQuestion,hypotheticalSources,ai,[],{
  plan:hypotheticalPlan,catalog:hypotheticalCatalog,trace:true
 });
 assert.equal(ai.calls.length,2);
 assert.equal(result.outcome,'unverified-source-draft');
 assert.equal(result.coverage,'partial');
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
  hypotheticalReview()
 ]);
 const result=await composeEvidenceAnswer(hypotheticalQuestion,hypotheticalSources,ai,[],{
  plan:hypotheticalPlan,catalog:hypotheticalCatalog,trace:true
 });
 assert.equal(ai.calls.length,2);
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

test('a neighboring comparison clause cannot lend its citation group to a hypothetical inference',async()=>{
 const ai=makeAI([hypotheticalDraft(
  'From these passages, one cautious inference is that Nietzsche might have viewed Kierkegaard’s emphasis on religious inwardness as part of the Christian outlook he rejects. [S1], whereas Kierkegaard’s own position is expressed by Johannes de Silentio. [S2]'),
  hypotheticalReview()
 ]);
 const result=await composeEvidenceAnswer(hypotheticalQuestion,hypotheticalSources,ai,[],{
  plan:hypotheticalPlan,catalog:hypotheticalCatalog,trace:true
 });
 assert.equal(result.coverage,'partial');
 assert.ok(result.trace.rejected.some(item=>item.partId==='P3'&&
  item.reason==='hypothetical-inference-missing-source-group-citation'));
 assert.doesNotMatch(result.answer,/one cautious inference/i);
 assert.equal(ai.calls.length,2);
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
  'What did Kierkegaard say about faith, and how does he relate it to the individual?',catalog);
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

test('part linking preserves evidence discovered by each side for a synthesis part',()=>{
 const plan={...twoSidePlan,parts:twoSidePlan.parts.map(part=>({...part,candidateSourceIds:[]}))};
 const linked=linkEvidenceToParts(plan,[{...hume,candidatePartIds:['P1']},{...kant,candidatePartIds:['P2']}]);
 assert.deepEqual(linked.parts.map(part=>part.candidateSourceIds),[['S1'],['S2'],['S1','S2']]);
});

test('a named Hamlet part admits the primary collected text and excludes unrelated commentary',()=>{
 const question='In Hamlet’s “To be, or not to be” soliloquy, what does he mean by conscience?';
 const catalog={212:'The Complete Works of William Shakespeare — William Shakespeare'};
 const plan=normalizePlan({intent:'interpret',sources:[
  {label:'Hamlet',role:'primary',bookIds:['212']}
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
  reviewPayload=JSON.parse(messages[1].content);
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
 assert.equal(missingSourceAI.calls.length,2);

 const supportedAI=makeAI([answer(draft),(_model,{messages})=>{
  const payload=JSON.parse(messages[1].content),claim=payload.claims[0];
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
 const reviewPayload=JSON.parse(ai.calls[1].request.messages[1].content);
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
 const reviewed=JSON.parse(ai.calls[1].request.messages[1].content);
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
  review([['P1','answered']])
 ]);
 const result=await composeEvidenceAnswer('Why is Fortune not constant?',[source],ai,[],
  {plan,catalog:{...catalog,21:title},trace:true});
 assert.equal(result.outcome,'verified-source-draft');
 assert.equal(result.coverage,'partial');
 assert.equal(result.questionParts[0].status,'partial');
 assert.match(result.answer,/earlier injustice\. \[S1\]/);
 assert.doesNotMatch(result.answer,/nothing born remains constant/);
 assert.deepEqual(result.trace.rejected,[{partId:'P1',reason:'unknown-source-id',sentenceIndex:1}]);
 assert.deepEqual(result.trace.coverageGaps,[{partId:'P1',reason:'required-direct-answer-rejected'}]);
 assert.deepEqual(result.trace.citationRepairs,[]);
});

test('author initials stay attached to the cited direct answer without merging later sentences',async()=>{
 let reviewPayload;
 const ai=makeAI([answer('PART P1\nW.E.B. Du Bois defines double consciousness as viewing oneself through other people’s eyes. [S3] '+
  'He describes the condition as a divided identity with conflicting strivings. [S3]'),
  (_model,{messages})=>{
   reviewPayload=JSON.parse(messages[1].content);
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

test('an invalid citation on an initialism-bearing direct answer still leaves the part partial',async()=>{
 const ai=makeAI([answer('PART P1\nW.E.B. Du Bois defines double consciousness as viewing oneself through other people’s eyes. [S99] '+
  'He describes the condition as a divided identity with conflicting strivings. [S3]'),
  review([['P1','answered']])]);
 const result=await composeEvidenceAnswer(duBoisInitialismQuestion,[duBoisInitialismSource],ai,[],{
  plan:duBoisInitialismPlan,catalog:{454:duBoisInitialismSource.title},trace:true
 });
 assert.equal(result.coverage,'partial');
 assert.equal(result.questionParts[0].status,'partial');
 assert.doesNotMatch(result.answer,/W\.E\.B\. Du Bois defines/);
 assert.match(result.answer,/divided identity with conflicting strivings\. \[S3\]/);
 assert.deepEqual(result.trace.rejected,[{partId:'P1',reason:'unknown-source-id',sentenceIndex:1}]);
 assert.deepEqual(result.trace.coverageGaps,[{partId:'P1',reason:'required-direct-answer-rejected'}]);
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
  composePayload=JSON.parse(messages[1].content);
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
  review([['P1','answered'],['P2','answered'],['P3','answered']])]);
 const result=await composeEvidenceAnswer('How do Hume and Kant explain causal necessity?',sources,ai,[],
  {plan:twoSidePlan,catalog,trace:true});
 assert.equal(result.coverage,'full');
 assert.deepEqual([...new Set(result.evidenceMap.map(source=>source.id))].sort(),['S3','S4','S5']);
 assert.ok(result.answer.includes('[S5]'));
 assert.ok(result.answer.includes('[S4]'));
 assert.ok(result.answer.includes('[S5, S3]'));
 assert.ok(!result.answer.includes('[S1]'));
 assert.equal(ai.calls.length,2,'claim-specific citation guidance adds no model call');
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
  claimStatus:'answered',sourceStatus:'partial',attributionStatus:'missing',attributedSpeaker:'',
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
  claimStatus:'answered',sourceStatus:'answered',attributionStatus:'missing',attributedSpeaker:'',
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
 const sourceDecision={sourceId:'S1',status:'answered',spanIds:['S1-Q1']};
 const valid=JSON.stringify({claims:['P1-C1','P1-C2'].map(claimId=>({claimId,status:'answered',
  sources:[sourceDecision]})),parts:[{partId:'P1',status:'answered',
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
  return {response:'```json\n'+JSON.stringify({parts:[{partId:'P1',status:'answered',directAnswerClaimIds:[claim.claimId]}],
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
 assert.match(REVIEW_PROMPT,/Metadata about credited authors.*is context, not proof/i);
 assert.match(REVIEW_PROMPT,/attributionStatus/);
 assert.match(REVIEW_PROMPT,/nearby footnote and source-credit text/);
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

test('explicit evidence refusals become structured insufficient evidence without a retry',async()=>{
 for(const refusal of [
  'The supplied passages do not address the question about whether reality is simulated.',
  'The provided text does not contain information regarding whether we are living in a simulation.'
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
 const reviewPayload=JSON.parse(ai.calls[1].request.messages[1].content);
 assert.equal(composePayload.evidence[0].text,source.scopeText);
 assert.equal(composePayload.evidence[0].contextText,source.text);
 assert.equal(reviewPayload.parts[0].evidence[0].spans[0].text,source.scopeText);
 assert.equal(reviewPayload.parts[0].evidence[0].spans[0].spanId,'S1-Q1');
 assert.equal(reviewPayload.parts[0].evidence[0].contextText,source.text);
});
