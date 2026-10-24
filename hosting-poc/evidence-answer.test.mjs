import {test} from 'node:test';
import assert from 'node:assert/strict';
import {auditFinalAnswer,normalizePlan} from './reader-contract.mjs';
import {composeEvidenceAnswer,validateClaims,linkEvidenceToParts,COMPOSER_PROMPT,REVIEW_PROMPT} from './evidence-answer.mjs';
import {handleRequest,verifiedFingerprintSources} from './public-gateway.mjs';

const quote='By doing just acts we become just';
const source={id:'S1',bookId:'4',title:'Nicomachean Ethics — Aristotle',page:17,
  text:'Moral virtue comes about as a result of habit. By doing just acts we become just, and by doing temperate acts we become temperate.',
  sha256:'a'.repeat(64),preview:'A short UI preview.'};
const rawPlan={resolvedQuestion:'How does practice form virtue?',intent:'explain',
  sources:[{label:'Nicomachean Ethics',role:'primary',bookIds:['4']}],
  parts:['How does practice form virtue?'],scope:'',queries:['habituation moral virtue']};
const catalog={'4':'Nicomachean Ethics — Aristotle'};
function modelAnswer(claimOverrides={}){
 return {claims:[{id:'C1',partIds:['P1'],kind:'direct',
   text:'Aristotle says repeated just action forms a just character.',
   evidence:[{sourceId:'S1',quote}],...claimOverrides}],
  parts:[{partId:'P1',status:'answered',gap:''}]};
}
function composerRecords(draft){
 const emitted=new Set(),lines=[];
 for(const part of draft.parts){
  lines.push(`PART ${part.partId} ${part.status}`);
  for(const claim of draft.claims.filter(value=>value.partIds.includes(part.partId)&&!emitted.has(value.id))){
   emitted.add(claim.id);
   lines.push(`CLAIM ${claim.id} | ${claim.partIds.join(',')} | ${claim.kind}`,'TEXT',claim.text);
   for(const evidence of claim.evidence){
    lines.push(`EVIDENCE ${evidence.sourceId}`,evidence.quote,'END EVIDENCE');
   }
   lines.push('END CLAIM');
  }
  if(part.gap)lines.push('GAP',part.gap,'END GAP');
  lines.push('END PART');
 }
 return lines.join('\n');
}
function response(value){return {choices:[{finish_reason:'stop',message:{content:
  value&&Array.isArray(value.claims)&&Array.isArray(value.parts)?composerRecords(value):
   typeof value==='string'?value:JSON.stringify(value)}}],
  usage:{neurons:7,prompt_tokens:120,completion_tokens:60}};}

test('epistemic answers require grounds beyond naming a category',()=>{
 assert.match(COMPOSER_PROMPT,/When asked how a claim or principle can be known, justified, or necessary/i);
 assert.match(COMPOSER_PROMPT,/grounds, argument, or conditions of validity/i);
 assert.match(REVIEW_PROMPT,/a category name alone is not a complete explanation/i);
 assert.match(REVIEW_PROMPT,/Mark the part partial when those are absent/i);
});

test('grouped citations reject unknown source IDs and bind quotations to their cited source',()=>{
 const sources=[{id:'S1',text:'The first source says something entirely different.'},
  {id:'S2',text:'The second source says “precise quoted wording appears here”.'}];
 assert.equal(auditFinalAnswer('A claim [S1, S99].',sources).ok,false);
 assert.equal(auditFinalAnswer('The source says “precise quoted wording appears here” [S1].',sources).ok,false);
 assert.equal(auditFinalAnswer('The source says “precise quoted wording appears here” [S2].',sources).ok,true);
});

test('plan normalization bounds and canonicalizes requested parts and book scope',()=>{
 const plan=normalizePlan(rawPlan,'fallback question',catalog);
 assert.equal(plan.version,'reader-evidence-v2');
 assert.equal(plan.intent,'explain');
 assert.deepEqual(plan.parts,[{id:'P1',question:'How does practice form virtue?',sourceBookIds:['4'],
  searchQueries:['habituation moral virtue','How does practice form virtue?']}]);
 assert.deepEqual(plan.sources[0].bookIds,['4']);
 const scoped=normalizePlan(rawPlan,'question',catalog,'4');
 assert.deepEqual(scoped.sources,[{label:catalog['4'],role:'primary',bookIds:['4']}]);
});

test('plan binds each named comparison part to the matching source books',()=>{
 const catalog={'74':'The Republic — Plato','245':'The Social Contract — Jean-Jacques Rousseau'};
 const plan=normalizePlan({intent:'compare',sources:[
  {label:'Republic',role:'primary',bookIds:['74']},
  {label:'Social Contract',role:'subject',bookIds:['245']}],parts:[
   {question:'How does Plato’s Republic explain political legitimacy?'},
   {question:'How does Rousseau’s Social Contract connect it to the common good?'}]},
  'Compare Plato and Rousseau.',catalog);
 assert.deepEqual(plan.parts.map(part=>part.sourceBookIds),[['74'],['245'],['74','245']]);
});

test('explicit comparisons gain a required synthesis part and keep source queries linked to their parts',()=>{
 const catalog={'35':'An Enquiry Concerning Human Understanding — David Hume',
  '40':'Critique of Pure Reason — Immanuel Kant'};
 const question='How do Hume’s Enquiry and Kant’s Critique of Pure Reason differ over how we can know causal necessity?';
 const plan=normalizePlan({intent:'compare',resolvedQuestion:question,sources:[
  {label:'David Hume',role:'primary',bookIds:['35']},
  {label:'Critique of Pure Reason',role:'primary',bookIds:['40']}],parts:[
   'How does Hume explain the origin and justification of causal necessity?',
   'How does Kant explain the origin and justification of causal necessity?'],
  queries:['Hume Enquiry causal necessity custom habit association of ideas',
   'Kant Critique of Pure Reason causality categories a priori synthetic']},question,catalog);
 assert.equal(plan.parts.length,3);
 assert.match(plan.parts[2].question,/compare in response to this question/i);
 assert.deepEqual(plan.parts.map(part=>part.sourceBookIds),[['35'],['40'],['35','40']]);
 assert.deepEqual(plan.parts[0].searchQueries,[
  'Hume Enquiry causal necessity custom habit association of ideas',
  'How does Hume explain the origin and justification of causal necessity?']);
 assert.deepEqual(plan.parts[1].searchQueries,[
  'Kant Critique of Pure Reason causality categories a priori synthetic',
  'How does Kant explain the origin and justification of causal necessity?']);
 assert.ok(plan.parts[2].searchQueries.includes(plan.queries[0]));
 assert.ok(plan.parts[2].searchQueries.includes(plan.queries[1]));
});

test('each planned part receives page IDs from its own named source before composition',()=>{
 const catalog={'74':'The Republic — Plato','245':'The Social Contract — Jean-Jacques Rousseau'};
 const plan=normalizePlan({intent:'compare',sources:[
  {label:'Republic',role:'primary',bookIds:['74']},
  {label:'Social Contract',role:'subject',bookIds:['245']}],parts:[
   {question:'How does Plato’s Republic explain political legitimacy?'},
   {question:'How does Rousseau’s Social Contract explain political legitimacy?'}]},
  'Compare Plato and Rousseau.',catalog);
 const linked=linkEvidenceToParts(plan,[
  {...source,id:'S1',bookId:'74'},{...source,id:'S2',bookId:'245'}]);
 assert.deepEqual(linked.parts.map(part=>part.candidateSourceIds),[['S1'],['S2'],['S1','S2']]);
});

test('a comparison part inherits only evidence already linked to its source-side parts',()=>{
 const plan={intent:'compare',sources:[
  {label:'Hume',role:'primary',bookIds:['35']},
  {label:'Kant',role:'primary',bookIds:['40']}],parts:[
  {id:'P1',question:'Hume’s account',sourceBookIds:['35']},
  {id:'P2',question:'Kant’s account',sourceBookIds:['40']},
  {id:'P3',question:'How do the accounts differ?',sourceBookIds:['35','40']}]};
 const linked=linkEvidenceToParts(plan,[
  {...source,id:'S1',bookId:'35',candidatePartIds:['P1']},
  {...source,id:'S2',bookId:'40',candidatePartIds:['P2']},
  {...source,id:'S3',bookId:'40',candidatePartIds:['P3']},
  {...source,id:'S4',bookId:'40',candidatePartIds:[]}
 ]);
 assert.deepEqual(linked.parts.map(part=>part.candidateSourceIds),[
  ['S1'],['S2'],['S1','S2','S3']
 ]);
});

test('already-planned comparison part is not duplicated',()=>{
 const catalog={'74':'The Republic — Plato','245':'The Social Contract — Jean-Jacques Rousseau'};
 const plan=normalizePlan({intent:'compare',sources:[
  {label:'Plato',role:'primary',bookIds:['74']},{label:'Rousseau',role:'primary',bookIds:['245']}],parts:[
   'How does Plato describe justice?', 'How does Rousseau describe the common good?',
   'How do Plato and Rousseau differ on political legitimacy?']},
  'How do Plato and Rousseau differ on political legitimacy?',catalog);
 assert.equal(plan.parts.length,3);
 assert.deepEqual(plan.parts[2].sourceBookIds,['74','245']);
});

test('part evidence mapping narrows two subquestions within the same book',()=>{
 const plan=normalizePlan({intent:'explain',sources:[
  {label:'The Republic',role:'primary',bookIds:['74']}],parts:[
   {question:'How does Plato explain political legitimacy?'},
   {question:'How does Plato connect political legitimacy to the common good?'}]},
  'How does Plato explain political order?',{'74':'The Republic — Plato'});
 const linked=linkEvidenceToParts(plan,[
  {...source,id:'S1',bookId:'74',candidatePartIds:['P1']},
  {...source,id:'S2',bookId:'74',candidatePartIds:['P2']}]);
 assert.deepEqual(linked.parts.map(part=>part.candidateSourceIds),[['S1'],['S2']]);
});

test('claim validation rejects a quote taken from a different source than its citation',()=>{
 const second={...source,id:'S2',text:'A different passage about another subject entirely.'};
 const plan=linkEvidenceToParts(normalizePlan(rawPlan,'question',catalog),[source,second]);
 const result=validateClaims(modelAnswer({evidence:[{sourceId:'S2',quote}]}),[source,second],plan);
 assert.equal(result.claims.length,0);
 assert.equal(result.rejected[0].reason,'evidence-not-found');
});

test('claim validation rejects evidence assigned to the wrong named-work part',()=>{
 const catalog={'74':'The Republic — Plato','245':'The Social Contract — Jean-Jacques Rousseau'};
 const plan=normalizePlan({intent:'compare',sources:[
  {label:'Republic',role:'primary',bookIds:['74']},
  {label:'Social Contract',role:'subject',bookIds:['245']}],parts:[
   {question:'How does Plato’s Republic explain political legitimacy?'},
   {question:'How does Rousseau’s Social Contract explain political legitimacy?'}]},
  'Compare Plato and Rousseau.',catalog);
 const rousseau={...source,id:'S2',bookId:'245',title:catalog['245'],
  text:'An act is legitimate because it is based on the social contract, and useful because it serves the general good.'};
 const draft={claims:[{id:'C1',partIds:['P1'],kind:'direct',
  text:'Rousseau grounds legitimate order in the social contract.',
  evidence:[{sourceId:'S2',quote:'legitimate because it is based on the social contract'}]}],
  parts:[{partId:'P1',status:'answered',gap:''},{partId:'P2',status:'unanswered',gap:'No cited evidence.'},
   {partId:'P3',status:'unanswered',gap:'No cited comparison evidence.'}]};
 const linked=linkEvidenceToParts(plan,[source,rousseau]);
 const result=validateClaims(draft,[source,rousseau],linked);
 assert.equal(result.claims.length,0);
 assert.equal(result.rejected[0].reason,'evidence-not-linked-to-question-part');
});

test('explicit section scope limits support while preserving the complete page as context',()=>{
 const full={...source,text:'Outside the requested range, Aristotle discusses pleasure at length. '+quote+'.'};
 const scoped={...full,scopeText:'By doing just acts we become just.'};
 const plan=linkEvidenceToParts(normalizePlan(rawPlan,'question',catalog),[scoped]);
 const outside=validateClaims(modelAnswer({evidence:[{sourceId:'S1',quote:'Outside the requested range, Aristotle discusses pleasure at length.'}]}),[scoped],plan);
 assert.equal(outside.claims.length,0);
 assert.equal(outside.rejected[0].reason,'evidence-outside-requested-scope');
 let composedPages;
 const ai={run:async(_model,input)=>{
  composedPages=JSON.parse(input.messages[1].content).evidence;
  return response(modelAnswer({evidence:[{sourceId:'S1',quote:'By doing just acts we become just.'}]}));
 }};
 return composeEvidenceAnswer('How does practice form virtue?', [scoped], ai, [], {plan:rawPlan,catalog,review:false,trace:true})
  .then(result=>{
   assert.equal(composedPages[0].text,full.text);
   assert.equal(composedPages[0].scopeText,scoped.scopeText);
   assert.equal(result.outcome,'unverified-source-draft');
   assert.equal(result.citations[0].scopeText,undefined);
  });
});

test('claim pipeline makes two bounded calls, preserves full pages, and validates the final rendering',async()=>{
 const observed=[];
 let calls=0;
 const ai={run:async(_model,input)=>{
  calls++;observed.push(input);
  const body=JSON.parse(input.messages[1].content);
  if(input.messages[0].content.includes('Assess each claim')){
   assert.equal(body.claims.length,1);
   assert.deepEqual(body.draftParts,[{partId:'P1',status:'answered',gap:''}],
    'review sees the composer status and any stated gap for every question part');
   return response({decisions:[{claimId:'C1',verdict:'supported',reason:'Directly stated.'}],
    parts:[{partId:'P1',status:'answered',claimIds:['C1'],reason:'Explained.'}]});
  }
  assert.equal(body.evidence[0].text,source.text);
  assert.deepEqual(body.partEvidence,[{partId:'P1',question:'How does practice form virtue?',candidateSourceIds:['S1']}]);
  return response(modelAnswer());
 }};
 const result=await composeEvidenceAnswer('How does practice form virtue?',
  [{...source,text:source.text}],ai,[],{plan:rawPlan,catalog,trace:true});
 assert.equal(calls,2);
 assert.equal(result.usage.calls,2);
 assert.equal(result.usage.neurons,14);
 assert.equal(result.coverage,'full');
 assert.match(result.answer, /\[S1\]/);
 assert.equal(result.citations.length,1);
 assert.equal(result.trace.evidence[0].text,source.text);
 assert.equal(result.trace.final.answer,result.answer);
});

test('the composer receives page IDs attached to each question part before it drafts claims',async()=>{
 const catalog={'74':'The Republic — Plato'};
 const plan={intent:'explain',sources:[{label:'The Republic',role:'primary',bookIds:['74']}],parts:[
  {question:'How does Plato explain political legitimacy?'},
  {question:'How does Plato connect political legitimacy to the common good?'}]};
 const first={...source,id:'S1',bookId:'74',title:catalog['74'],candidatePartIds:['P1'],
  text:'The first passage directly explains political legitimacy through justice.'};
 const second={...source,id:'S2',bookId:'74',title:catalog['74'],candidatePartIds:['P2'],
  text:'The second passage directly connects the city to the common good.'};
 const draft={claims:[
  {id:'C1',partIds:['P1'],kind:'direct',text:'Plato grounds political legitimacy in justice.',
   evidence:[{sourceId:'S1',quote:'directly explains political legitimacy through justice'}]},
  {id:'C2',partIds:['P2'],kind:'direct',text:'Plato connects political order to the common good.',
   evidence:[{sourceId:'S2',quote:'directly connects the city to the common good'}]}],
  parts:[{partId:'P1',status:'answered',gap:''},{partId:'P2',status:'answered',gap:''}]};
 const ai={run:async(_model,input)=>{
  const body=JSON.parse(input.messages[1].content);
  if(input.messages[0].content.includes('Assess each claim'))
   return response({decisions:[{claimId:'C1',verdict:'supported',reason:'Matches.'},
      {claimId:'C2',verdict:'supported',reason:'Matches.'}],
    parts:[{partId:'P1',status:'answered',claimIds:['C1'],reason:'Covered.'},
      {partId:'P2',status:'answered',claimIds:['C2'],reason:'Covered.'}]});
  assert.deepEqual(body.partEvidence.map(part=>[part.partId,part.candidateSourceIds]),[
   ['P1',['S1']],['P2',['S2']]]);
  return response(draft);
 }};
 const result=await composeEvidenceAnswer('How does Plato explain political order?',
  [first,second],ai,[],{plan,catalog});
 assert.equal(result.coverage,'full');
 assert.deepEqual(result.questionParts.map(part=>part.evidenceIds),[['S1'],['S2']]);
});

test('one malformed composer response gets one bounded regeneration before final review',async()=>{
 const stages=[];let calls=0;
 const ai={run:async(_model,input)=>{
  calls++;
  const system=input.messages[0].content;
  if(system.includes('Assess each claim')){
   stages.push('review');
   return response({decisions:[{claimId:'C1',verdict:'supported',reason:'Supported.'}],
    parts:[{partId:'P1',status:'answered',claimIds:['C1'],reason:'Answered.'}]});
  }
  if(system.includes('Your previous response did not follow the required record format')){
   stages.push('compose-format-retry');return response(modelAnswer());
  }
  stages.push('compose');
  return {choices:[{finish_reason:'stop',message:{content:'```json\n{"claims":[{"text":"a malformed response"}]\n```'}}]};
 }};
 const result=await composeEvidenceAnswer('How does practice form virtue?',
  [source],ai,[],{plan:rawPlan,catalog,trace:true});
 assert.equal(calls,3);
 assert.deepEqual(stages,['compose','compose-format-retry','review']);
 assert.equal(result.usage.calls,3);
 assert.equal(result.outcome,'verified-source-draft');
 assert.equal(result.coverage,'full');
 assert.equal(result.trace.stages[0].stage,'compose');
 assert.equal(result.trace.stages[1].stage,'compose-format-retry');
});

test('a second malformed composer response is a format failure, not an evidence gap',async()=>{
 let calls=0;
 const ai={run:async()=>{calls++;return {choices:[{finish_reason:'stop',message:{content:'not json'}}]};}};
 const result=await composeEvidenceAnswer('How does practice form virtue?',
  [source],ai,[],{plan:rawPlan,catalog,trace:true});
 assert.equal(calls,2);
 assert.equal(result.outcome,'generation-failed');
 assert.equal(result.reviewStatus,'generation-format-failed');
 assert.equal(result.failureCode,'model-output-invalid-format');
 assert.equal(result.failureStage,'compose-format-retry');
 assert.match(result.answer,/properly formatted, verified answer/);
 assert.doesNotMatch(result.answer,/retrieved passages did not support/);
 assert.equal(result.trace.final.failure.stage,'compose-format-retry');
});

test('composer accepts omitted TEXT markers and empty duplicate headers while requiring every planned comparison part',async()=>{
 const question='How do Hume and Kant differ over causal necessity?';
 const comparePlan={intent:'compare',resolvedQuestion:question,sources:[
  {label:'Hume',role:'primary',bookIds:['35']},{label:'Kant',role:'primary',bookIds:['40']}],
  parts:['How does Hume explain causal necessity?','How does Kant explain causal necessity?'],
  queries:['Hume causal necessity custom habit','Kant causality category a priori']};
 const hume={id:'S1',bookId:'35',title:'An Enquiry Concerning Human Understanding — David Hume',page:41,
  candidatePartIds:['P1','P3'],text:'Hume explains causal necessity through repeated experience and the mind’s resulting habit.'};
 const kant={id:'S2',bookId:'40',title:'Critique of Pure Reason — Immanuel Kant',page:54,
  candidatePartIds:['P2','P3'],text:'Kant treats causality as a category of the understanding that structures experience.'};
 const raw=`PART P1 answered\nCLAIM C1 | P1 | direct\nTEXT\nHume connects causal necessity with repeated experience.\nEVIDENCE S1\n${hume.text}\nEND EVIDENCE\nEND CLAIM\nEND PART\n`+
  `PART P2 answered\nCLAIM C1 | P2 | direct\nCLAIM C2 | P2 | direct\nKant treats causality as a condition for experience.\nEVIDENCE S2\n${kant.text}\nEND EVIDENCE\nEND CLAIM\nEND PART\n`+
  'PART P3 unanswered\nGAP\nThe passages do not establish the comparison between the accounts.\nEND GAP\nEND PART';
 const ai={run:async()=>response(raw)};
 const result=await composeEvidenceAnswer(question,[hume,kant],ai,[],{
  plan:comparePlan,catalog:{'35':hume.title,'40':kant.title},review:false,trace:true});
 assert.equal(result.usage.calls,1);
 assert.equal(result.outcome,'unverified-source-draft');
 assert.deepEqual(result.questionParts.map(part=>part.status),['partial','partial','unsupported']);
 assert.deepEqual(result.questionParts.map(part=>part.evidenceIds),[['S1'],['S2'],[]]);
 assert.equal(result.trace.final.failure,null);
 assert.deepEqual(result.trace.final.draftParts.map(part=>part.partId),['P1','P2','P3']);
});

test('composer recovers annotated evidence markers and a missing separator without accepting inexact spans',async()=>{
 const text='The mind observes repeated events. An omitted middle sentence is not quoted. A second exact sentence completes the source evidence.';
 const first='The mind observes repeated events.';
 const second='A second exact sentence completes the source evidence.';
 const one='The mind observes repeated events. An omitted middle sentence is not quoted. A second exact sentence completes the source evidence.';
 const plan={intent:'explain',sources:[{label:'Hume',role:'primary',bookIds:['35']}],parts:[
  {question:'How does Hume explain the idea?',sourceBookIds:['35']} ]};
 const hume={id:'S1',bookId:'35',title:'An Enquiry Concerning Human Understanding — David Hume',page:38,
  candidatePartIds:['P1'],text};
 const raw=`PART P1 answered\nCLAIM C8 | P1 | direct\nHabit links repeated events in expectation.\n`+
  `EVIDENCE S1 | P1 | direct\n${first} [...] ${second}\n`+
  `EVIDENCE S1 | P1 | direct\n${one}\nEND EVIDENCE\nEND CLAIM\nEND PART`;
 const ai={run:async()=>response(raw)};
 const result=await composeEvidenceAnswer('How does Hume explain the idea?',
  [hume],ai,[],{plan,catalog:{'35':hume.title},review:false,trace:true});
 assert.equal(result.outcome,'unverified-source-draft');
 assert.equal(result.trace.rejected.length,0);
 assert.deepEqual(result.evidenceMap.map(item=>item.quote),[first,second,one]);
 assert.equal(result.usage.calls,1);
});

test('evidence marker annotations must agree with the enclosing claim and part',async()=>{
 const wrong=`PART P1 answered\nCLAIM C1 | P1 | direct\nA supported claim.\n`+
  `EVIDENCE S1 | P2 | direct\n${quote}\nEND EVIDENCE\nEND CLAIM\nEND PART`;
 const ai={run:async()=>response(wrong)};
 const result=await composeEvidenceAnswer('How does practice form virtue?',
  [source],ai,[],{plan:rawPlan,catalog,review:false,trace:true});
 assert.equal(result.outcome,'generation-failed');
 assert.equal(result.failureStage,'compose-format-retry');
 assert.equal(result.usage.calls,2);
});

test('composition fails closed when a requested part is omitted from the record',async()=>{
 let calls=0;
 const ai={run:async()=>{calls++;return response('PART P1 answered\nEND PART');}};
 const result=await composeEvidenceAnswer('How does practice form virtue?',
  [source],ai,[],{plan:rawPlan,catalog,trace:true});
 assert.equal(calls,2,'one bounded format regeneration is allowed');
 assert.equal(result.outcome,'generation-failed');
 assert.equal(result.failureCode,'model-output-invalid-format');
 assert.equal(result.failureStage,'compose-format-retry');
 assert.equal(result.questionParts[0].status,'unsupported');
});

test('invalid evidence gets one bounded regeneration and remains rejected if it fails again',async()=>{
 let calls=0;
 const ai={run:async()=>{calls++;return response(modelAnswer({evidence:[{sourceId:'S1',quote:'This exact wording is absent from the verified page.'}]}));}};
 const result=await composeEvidenceAnswer('How does practice form virtue?',
  [source],ai,[],{plan:rawPlan,catalog,trace:true});
 assert.equal(calls,2,'one citation repair is allowed, without an unbounded loop');
 assert.equal(result.outcome,'insufficient-evidence');
 assert.equal(result.answer,'The retrieved passages did not support a reliable answer to this question. Try a more specific passage or work.');
 assert.deepEqual(result.citations,[]);
 assert.equal(result.usage.calls,2);
 assert.equal(result.trace.stages[1].stage,'compose-evidence-retry');
 assert.equal(result.trace.rejected[0].reason,'evidence-not-found');
});

test('one evidence retry can correct an inexact composer quotation within the call budget',async()=>{
 let calls=0;
 const ai={run:async(_model,input)=>{
  calls++;
  if(calls===1)return response(modelAnswer({evidence:[{sourceId:'S1',quote:'This exact wording is absent from the verified page.'}]}));
  assert.match(input.messages[0].content,/failed evidence validation/);
  const payload=JSON.parse(input.messages[1].content);
  assert.deepEqual(payload.validationFeedback,[{claimId:'C1',reason:'evidence-not-found'}]);
  return response(modelAnswer());
 }};
 const result=await composeEvidenceAnswer('How does practice form virtue?',
  [source],ai,[],{plan:rawPlan,catalog,review:false,trace:true});
 assert.equal(calls,2);
 assert.equal(result.outcome,'unverified-source-draft');
 assert.equal(result.coverage,'partial');
 assert.equal(result.trace.final.failure,null);
 assert.equal(result.trace.rejected.length,0);
});

test('an evidence retry preserves earlier claims that already passed validation',async()=>{
 const valid=modelAnswer().claims[0];
 const invalid={...valid,id:'C2',text:'An unsupported second claim.',
  evidence:[{sourceId:'S1',quote:'This exact wording is absent from the verified page.'}]};
 let calls=0;
 const ai={run:async()=>{
  calls++;
  return calls===1?response({claims:[valid,invalid],parts:[{partId:'P1',status:'answered',gap:''}]}):
   response({claims:[],parts:[{partId:'P1',status:'unanswered',gap:'The retry could not verify another claim.'}]});
 }};
 const result=await composeEvidenceAnswer('How does practice form virtue?',
  [source],ai,[],{plan:rawPlan,catalog,review:false,trace:true});
 assert.equal(calls,2);
 assert.equal(result.outcome,'unverified-source-draft');
 assert.match(result.answer,/repeated just action forms a just character/);
 assert.deepEqual(result.citations.map(item=>item.id),['S1']);
 assert.equal(result.trace.rejected.length,0);
});

test('fingerprint verification retains original complete text and digest separately from UI preview',async()=>{
 const text='A complete source page begins here. '+quote+'. The rest of the argument continues beyond the compact preview. '+('Additional context extends this physical page. '.repeat(40));
 const bytes=new TextEncoder().encode(text);
 const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 const metadata={schema:'antilogicalism-reader-fingerprints-v1',hashAlgorithm:'SHA-256-utf8-exact',
  libraryVersion:47,bookId:'4',chunk:0,firstPage:1,lastPage:32,title:catalog['4'],
  pdfDriveId:'LegitimatePdfIdentifier0123456789',
  pages:[{page:17,globalPageId:16,utf8Bytes:bytes.byteLength,sha256}]};
 const verified=await verifiedFingerprintSources('How does practice form virtue?',
  [{bookId:'4',page:17,text,candidatePartIds:['P1']}],async()=>Response.json(metadata));
 assert.equal(verified[0].text,text);
 assert.equal(verified[0].sha256,sha256);
 assert.deepEqual(verified[0].candidatePartIds,['P1']);
 assert.ok(verified[0].preview.length<text.length);
});

test('public pilot defaults to audited claim output while evaluation remains explicitly authorized',async()=>{
 const text='A complete source page begins here. '+quote+'. The rest of the argument continues.';
 const bytes=new TextEncoder().encode(text);
 const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 const metadata={schema:'antilogicalism-reader-fingerprints-v1',hashAlgorithm:'SHA-256-utf8-exact',
  libraryVersion:47,bookId:'4',chunk:0,firstPage:1,lastPage:32,title:catalog['4'],
  pdfDriveId:'LegitimatePdfIdentifier0123456789',
  pages:[{page:17,globalPageId:16,utf8Bytes:bytes.byteLength,sha256}]};
 let aiCalls=0;
 const env={PUBLIC_ENABLED:'false',PUBLIC_PILOT_ENABLED:'true',
  TURNSTILE_SITE_KEY:'0x4AAAAAAABC1234567890',TURNSTILE_SECRET:'not-a-real-secret-123456789',
  AI_RATE_LIMITER:{limit:async()=>({success:true})},GLOBAL_RATE_LIMITER:{limit:async()=>({success:true})},
  AI:{run:async(_model,input)=>{
   aiCalls++;
   return input.messages[0].content.includes('Assess each claim')?
    response({decisions:[{claimId:'C1',verdict:'supported',reason:'Supported.'}],
      parts:[{partId:'P1',status:'answered',claimIds:['C1'],reason:'Answered.'}]}):response(modelAnswer());
  }}};
 const fetcher=async(url)=>String(url).includes('siteverify')?
  Response.json({success:true,hostname:'jsynon.github.io',action:'companion_ask'}):Response.json(metadata);
 const req=new Request('https://worker.example/api/pilot-answer',{method:'POST',
  headers:{Origin:'https://jsynon.github.io','CF-Connecting-IP':'198.51.100.30','Content-Type':'application/json'},
  body:JSON.stringify({question:'How does practice form virtue?',bookId:'4',turnstileToken:'valid-test-token',
   answerVariant:'compose-only',plan:rawPlan,sources:[{bookId:'4',page:17,text}]})});
 const httpResponse=await handleRequest(req,env,fetcher);
 const body=await httpResponse.json();
 assert.equal(httpResponse.status,200);
 assert.equal(body.pipeline,'reader-evidence-v2');
 assert.equal(body.answerVariant,'with-review','public callers cannot disable the final review');
 assert.equal(body.usage.calls,2,JSON.stringify(body));
 assert.equal(aiCalls,2);
 assert.match(body.answer,/\[S1\]/);
 assert.equal(body.citations[0].title,catalog['4']);
 assert.equal(body.trace,undefined,'ordinary visitors must not receive model prompts or full evidence');
 // The holdout runner must exercise the evidence pipeline even when the
 // public deployment-wide feature flag is unset.
 delete env.READER_PIPELINE;
 env.PILOT_EVALUATION_ENABLED='true';env.PILOT_EVALUATION_TOKEN='evaluation-token-'.padEnd(40,'x');
 const evalReq=new Request('https://worker.example/api/pilot-answer',{method:'POST',
  headers:{Origin:'https://jsynon.github.io','CF-Connecting-IP':'198.51.100.30',
   'Content-Type':'application/json',Authorization:'Bearer '+env.PILOT_EVALUATION_TOKEN},
  body:JSON.stringify({question:'How does practice form virtue?',bookId:'4',turnstileToken:'evaluation-token',
   answerVariant:'compose-only',plan:rawPlan,sources:[{bookId:'4',page:17,text}]})});
 const evalResponse=await handleRequest(evalReq,env,fetcher);
 const evalBody=await evalResponse.json();
 assert.equal(evalResponse.status,200);
 assert.equal(evalBody.pipeline,'reader-evidence-v2');
 assert.equal(evalBody.answerVariant,'compose-only');
 assert.equal(evalBody.usage.calls,1);
 assert.equal(evalBody.trace.evidence[0].text,text);
 assert.equal(evalBody.trace.stages.length,1);
});
