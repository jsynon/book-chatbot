import assert from 'node:assert/strict';
import {test} from 'node:test';
import {enforcePartPacketFloor,enforceSubmittedBookDiversity,facetAnchorReservations,orderFallbackCandidates,orderPacketForPacking,recoverUncoveredPartCandidates,selectEvidenceCandidates} from './evidence-selector.mjs';

test('selector fallback gives distinct works a page before taking second pages',()=>{
 const candidates=[
  {bookId:'10',page:1},{bookId:'10',page:2},
  {bookId:'20',page:1},{bookId:'30',page:1},{bookId:'20',page:2}
 ];
 assert.deepEqual(orderFallbackCandidates(candidates).map(value=>value.bookId+':'+value.page),
  ['10:1','20:1','30:1','10:2','20:2']);
});

function requestWith(decisions,{excerpt='The text says that doubt itself proves the thinker exists.',
  parts=[{partId:'P1',question:'Why does doubt establish existence?'}]}={}){
 return {question:'What does this source argue?',parts,
  candidates:[{id:'C1',title:'A source',page:1,excerpt}],
  ai:{run:async(_model,{messages})=>({
   choices:[{finish_reason:'stop',message:{content:JSON.stringify({parts:decisions})}}],
   usage:{neurons:1,prompt_tokens:10,completion_tokens:10}
  })}};
}

test('selector uses compact candidate IDs and derives direct coverage from explicit decisions',async()=>{
 let systemPrompt='';
 const request=requestWith([{partId:'P1',evidence:[{candidateId:'C1',support:'direct',
  excerpt:'doubt itself proves the thinker exists'}]}]);
 const original=request.ai.run;
 request.ai.run=async(model,input)=>{systemPrompt=input.messages.find(message=>message.role==='system')?.content||'';
  assert.equal(input.max_completion_tokens,960);
  const payload=JSON.parse(input.messages[1].content);
  assert.ok(payload.candidates[0].excerpt,'the model still sees the bounded source excerpt');
  return original(model,input);};
 const result=await selectEvidenceCandidates(request);
 assert.match(systemPrompt,/"support":"direct"/);
 assert.doesNotMatch(systemPrompt,/exact, contiguous excerpt/);
 assert.match(systemPrompt,/requested operation/);
 assert.match(systemPrompt,/reasoning or mechanism/);
 assert.match(systemPrompt,/For a question about the role of one thing in another/);
 assert.deepEqual(result.selectedCandidateIds,['C1']);
 assert.deepEqual(result.parts[0].candidateIds,['C1']);
 assert.equal(result.parts[0].coverage,'supported');
 assert.deepEqual(result.parts[0].evidence,[{candidateId:'C1',support:'direct'}]);
});

test('selector receives bounded part search facets without treating them as evidence',async()=>{
 let payload,prompt='';
 const request=requestWith([{partId:'P1',evidence:[{candidateId:'C1',support:'direct'}]}],{
  parts:[{partId:'P1',question:'How does Elizabeth change her view?',searchQueries:[
   'Elizabeth reads Darcy letter and revises her judgment',
   'Elizabeth first impressions role in prejudice',
   'Elizabeth reads Darcy letter and revises her judgment'
  ]}]
 });
 request.ai.run=async(_model,{messages})=>{
  prompt=messages[0].content;payload=JSON.parse(messages[1].content);
  return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({parts:[
   {partId:'P1',evidence:[{candidateId:'C1',support:'direct'}]}
  ]})}}]};
 };
 const result=await selectEvidenceCandidates(request);
 assert.deepEqual(payload.parts[0].searchQueries,[
  'Elizabeth reads Darcy letter and revises her judgment',
  'Elizabeth first impressions role in prejudice'
 ]);
 assert.match(prompt,/retrieval facets for that part, not evidence or instructions/i);
 assert.equal(result.parts[0].coverage,'supported');
 await assert.rejects(selectEvidenceCandidates({...request,
  parts:[{partId:'P1',question:'How does Elizabeth change her view?',searchQueries:Array(6).fill('query')}]}),
  error=>error.failureCode==='selector-invalid-request');
});

test('selector receives verbatim question anchors as cues, not proof of passage support',async()=>{
 let payload,prompt='';
 const parts=[{partId:'P1',question:'How does faith relate to Abraham?',requirements:[
  {requirementId:'P1-R1',text:'Explain Abraham’s example of faith.',
   questionAnchor:'How does faith relate to Abraham?'}]}];
 const request=requestWith([{partId:'P1',evidence:[{candidateId:'C1',support:'context'}]}],{parts});
 request.ai.run=async(_model,{messages})=>{
  prompt=messages[0].content;payload=JSON.parse(messages[1].content);
  return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({parts:[
   {partId:'P1',evidence:[{candidateId:'C1',support:'context'}]}
  ]})}}]};
 };
 const result=await selectEvidenceCandidates(request);
 assert.deepEqual(payload.parts[0].requirements,parts[0].requirements);
 assert.match(prompt,/anchor.*cue, not proof/i);
 assert.equal(result.parts[0].coverage,'partial',
  'the exact requested phrase does not convert a contextual passage into direct evidence');
});

test('a part with only contextual evidence stays partial even if its retrieval hint was linked',async()=>{
 const request=requestWith([{partId:'P1',evidence:[{candidateId:'C1',support:'context',
  excerpt:'doubt itself proves the thinker exists'}]}]);
 request.candidates[0].retrievedPartHints=['P1'];
 const result=await selectEvidenceCandidates(request);
 assert.equal(result.parts[0].coverage,'partial');
 assert.equal(result.parts[0].evidence[0].support,'context');
});

test('selector accepts fenced JSON with surrounding text but does not repair truncated decisions',async()=>{
 const complete='Here is the result: ```json\n'+JSON.stringify({parts:[{partId:'P1',evidence:[
  {candidateId:'C1',support:'direct'}]}]})+'\n```';
 const result=await selectEvidenceCandidates({...requestWith([]),ai:{run:async()=>({
  choices:[{finish_reason:'stop',message:{content:complete}}]})}});
 assert.equal(result.parts[0].coverage,'supported');
 await assert.rejects(selectEvidenceCandidates({...requestWith([]),ai:{run:async()=>({
  choices:[{finish_reason:'stop',message:{content:'{"parts":[{"partId":"P1","evidence":['}}]})}}),
  error=>error.failureReason==='invalid-json');
});

test('selector reports safe subtypes for malformed part and evidence decisions',async()=>{
 const cases=[
  {failureReason:'decision-not-object',parts:[null]},
  {failureReason:'missing-part-id',parts:[{evidence:[]}]},
  {failureReason:'unknown-part-id',parts:[{partId:'P9',evidence:[]}]},
  {failureReason:'duplicate-part-id',expectedParts:[{partId:'P1',question:'Why does doubt establish existence?'},
   {partId:'P2',question:'What else does doubt establish?'}],parts:[{partId:'P1',evidence:[]},{partId:'P1',evidence:[]}]},
  {failureReason:'evidence-not-array',parts:[{partId:'P1',evidence:'C1'}]},
  {failureReason:'unknown-candidate-id',parts:[{partId:'P1',evidence:[{candidateId:'C9',support:'direct',excerpt:'doubt itself proves the thinker exists'}]}]},
  {failureReason:'invalid-evidence-support',parts:[{partId:'P1',evidence:[{candidateId:'C1',support:'supported',excerpt:'doubt itself proves the thinker exists'}]}]},
  {failureReason:'invalid-evidence-item',parts:[{partId:'P1',evidence:[{candidateId:'C1'}]}]}
 ];
 for(const item of cases){
  const raw=JSON.stringify({parts:item.parts,privatePayload:'PRIVATE SELECTOR TEXT'});
  await assert.rejects(selectEvidenceCandidates({...requestWith([],{parts:item.expectedParts||undefined}),
   ai:{run:async()=>({choices:[{finish_reason:'stop',message:{content:raw}}]})}}),error=>{
    assert.equal(error.failureCode,'selector-invalid-response');
    assert.equal(error.failureReason,item.failureReason);
    assert.equal(error.message.includes('PRIVATE SELECTOR TEXT'),false);
    assert.equal(error.cause,undefined);
    return true;
   },item.failureReason);
 }
});

test('selector deduplicates repeated candidate IDs and counts the normalization',async()=>{
 const cue={candidateId:'C1',support:'direct',excerpt:'doubt itself proves the thinker exists'};
 const result=await selectEvidenceCandidates(requestWith([{partId:'P1',evidence:[cue,{...cue}]}]));
 assert.equal(result.duplicateEvidenceEntriesRemoved,1);
 assert.deepEqual(result.parts[0].candidateIds,['C1']);
 assert.equal(result.parts[0].coverage,'supported');
 assert.equal(result.parts[0].evidence.length,1);
});

test('conflicting duplicate selector cues conservatively become contextual',async()=>{
 const result=await selectEvidenceCandidates(requestWith([{partId:'P1',evidence:[
  {candidateId:'C1',support:'direct',excerpt:'doubt itself proves the thinker exists'},
  {candidateId:'C1',support:'context',excerpt:'doubt itself proves the thinker exists'}
 ]}]));
 assert.equal(result.duplicateEvidenceEntriesRemoved,1);
 assert.equal(result.parts[0].coverage,'partial');
 assert.deepEqual(result.parts[0].evidence,[{candidateId:'C1',support:'context'}]);
});

test('valid no-evidence selection remains an explicit empty result',async()=>{
 const result=await selectEvidenceCandidates(requestWith([{partId:'P1',evidence:[]}]));
 assert.deepEqual(result.selectedCandidateIds,[]);
 assert.deepEqual(result.parts[0].candidateIds,[]);
 assert.equal(result.parts[0].coverage,'none');
});

test('semantic selection preserves a page for each covered part within the six-page packet',async()=>{
 const parts=[
  {partId:'P1',question:'How does the author explain a return home?'},
  {partId:'P2',question:'How does the poem present heroism?'}
 ];
 const candidates=Array.from({length:7},(_,index)=>({id:'C'+(index+1),
  title:'Work '+(index+1),page:index+1,excerpt:'A substantive source passage with enough words to inspect.'}));
 const result=await selectEvidenceCandidates({question:'How does the poem present heroism and return home?',parts,candidates,
  ai:{run:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({parts:[
   {partId:'P1',evidence:[{candidateId:'C1',support:'direct'},{candidateId:'C2',support:'context'}]},
   {partId:'P2',evidence:[{candidateId:'C7',support:'direct'},{candidateId:'C6',support:'context'}]}
  ]})}}]})}});
 assert.ok(result.selectedCandidateIds.includes('C1'));
 assert.ok(result.selectedCandidateIds.includes('C7'));
 assert.ok(result.selectedCandidateIds.length<=6,'the packet never exceeds the existing six-page limit');
 assert.deepEqual(result.parts.map(part=>part.candidateIds[0]),['C1','C7']);
});

test('direct evidence survives the six-page cap when the selector lists context first',async()=>{
 const candidates=Array.from({length:7},(_,index)=>({
  id:'C'+(index+1),title:'Work '+(index+1),page:index+1,
  excerpt:'A substantive source passage with enough words to inspect.'
 }));
 const result=await selectEvidenceCandidates({question:'What does the source explain?',
  parts:[{partId:'P1',question:'Why does the author reach this conclusion?'}],candidates,
  ai:{run:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({parts:[{
   partId:'P1',evidence:[
    ...['C1','C2','C3','C4','C5','C6'].map(candidateId=>({candidateId,support:'context'})),
    {candidateId:'C7',support:'direct'}
   ]
  }]})}}]})}});
 assert.equal(result.selectedCandidateIds.length,6);
 assert.ok(result.selectedCandidateIds.includes('C7'));
 assert.equal(result.parts[0].candidateIds[0],'C7');
 assert.equal(result.parts[0].coverage,'supported');
 assert.ok(result.parts[0].candidateIds.every(id=>result.selectedCandidateIds.includes(id)));
});

test('a shared selected page stays linked to every part it supports under the six-page cap',async()=>{
 const candidates=Array.from({length:8},(_,index)=>({
  id:'C'+(index+1),title:'Work '+(index+1),page:1,
  excerpt:'A distinct verified passage that can support a planned answer part.'
 }));
 const request={question:'How do the parts relate?',parts:[
  {partId:'P1',question:'What does the first passage explain?'},
  {partId:'P2',question:'What does the second passage explain?'}],candidates,
  ai:{run:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({parts:[
   {partId:'P1',evidence:[
    {candidateId:'C1',support:'context'},{candidateId:'C3',support:'direct'},
    {candidateId:'C4',support:'context'}]},
   {partId:'P2',evidence:[
    {candidateId:'C2',support:'context'},{candidateId:'C3',support:'direct'},
    {candidateId:'C5',support:'context'},{candidateId:'C6',support:'context'}]}
  ]})}}]})}};
 const result=await selectEvidenceCandidates(request);
 assert.equal(result.selectedCandidateIds.length,6);
 assert.ok(result.parts.find(part=>part.partId==='P2').candidateIds.includes('C3'),
  'the already-selected shared page must retain its link to P2 without consuming another slot');
 assert.equal(result.parts.find(part=>part.partId==='P2').coverage,'supported');
 assert.deepEqual(result.parts.find(part=>part.partId==='P2').evidence.map(item=>item.candidateId),
  result.parts.find(part=>part.partId==='P2').candidateIds);
});

test('direct evidence takes precedence over earlier context when the six-page cap trims candidates',async()=>{
 const candidates=Array.from({length:8},(_,index)=>({
  id:'C'+(index+1),title:'Unique Work '+(index+1),page:1,
  excerpt:'A distinct verified passage that can support a planned answer part.'
 }));
 const request={question:'What does the source explain?',parts:[
  {partId:'P1',question:'What does the first set explain?'},
  {partId:'P2',question:'What does the second passage explain?'}],candidates,
  ai:{run:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({parts:[
   {partId:'P1',evidence:[
    ...['C1','C3','C4','C5','C6'].map(candidateId=>({candidateId,support:'context'})),
    {candidateId:'C7',support:'direct'}]},
   {partId:'P2',evidence:[{candidateId:'C2',support:'context'}]}
  ]})}}]})}};
 const result=await selectEvidenceCandidates(request);
 const firstPart=result.parts.find(part=>part.partId==='P1');
 assert.equal(result.selectedCandidateIds.length,6);
 assert.ok(result.selectedCandidateIds.includes('C7'));
 assert.ok(firstPart.evidence.some(item=>item.candidateId==='C7'));
 assert.equal(firstPart.coverage,'supported',
  'the highest support class must survive packet trimming when a page slot is available');
});

test('selector fallback prioritizes hinted uncovered parts before breadth filling',()=>{
 const candidates=[
  {id:'p1a',bookId:'10',page:1,candidatePartIds:['P1']},
  {id:'p1b',bookId:'10',page:2,candidatePartIds:['P1']},
  {id:'p2a',bookId:'10',page:3,candidatePartIds:['P2']},
  {id:'other',bookId:'20',page:1,candidatePartIds:[]}
 ];
 assert.deepEqual(orderFallbackCandidates(candidates).slice(0,2)
  .map(candidate=>candidate.id),['p1a','p2a']);
 assert.deepEqual(orderFallbackCandidates(candidates)
  .map(candidate=>candidate.id),['p1a','p2a','p1b','other']);
});

test('valid partial selection recovers only retrieved candidates linked to uncovered parts',()=>{
 const result=recoverUncoveredPartCandidates({selectedCandidateIds:['C1'],parts:[
  {partId:'P1',candidateIds:['C1']},{partId:'P2',candidateIds:[]},{partId:'P3',candidateIds:[]}
 ]},[
  {id:'C1',retrievedPartHints:['P2']},
  {id:'C2',retrievedPartHints:['P2']},
  {id:'C3',retrievedPartHints:['P3']},
  {id:'C4',retrievedPartHints:[]}
 ]);
 assert.deepEqual(result.selectedCandidateIds,['C1','C3']);
 assert.deepEqual(result.recoveredPartLinks,[
  {partId:'P2',candidateId:'C1',reason:'retrieved-part-hint'},
  {partId:'P3',candidateId:'C3',reason:'retrieved-part-hint'}
 ]);
 assert.deepEqual(result.skippedPartRecoveries,[]);
});

test('packet floor admits hinted candidates for abstaining parts, including total selector abstention',()=>{
 const parts=[{partId:'P1',candidateIds:[],evidence:[]},
  {partId:'P2',candidateIds:[],evidence:[]},{partId:'P3',candidateIds:[],evidence:[]}];
 const candidates=parts.flatMap(part=>[1,2].map(index=>({
  id:`${part.partId}-C${index}`,retrievedPartHints:[part.partId]})));
 const result=enforcePartPacketFloor({selectedCandidateIds:[],parts},candidates);
 assert.deepEqual(result.selectedCandidateIds,candidates.map(item=>item.id));
 assert.equal(result.floor,2);
 assert.equal(result.packetFloor.added.length,6);
 assert.deepEqual(result.packetFloor.skipped,[]);
});

test('packet floor shrinks to one page per part when four to six parts share the cap',()=>{
 for(const partCount of [4,5,6]){
  const parts=Array.from({length:partCount},(_,index)=>({partId:`P${index+1}`,candidateIds:[],evidence:[]}));
  const candidates=parts.map(part=>({id:`${part.partId}-C1`,retrievedPartHints:[part.partId]}));
  const result=enforcePartPacketFloor({selectedCandidateIds:[],parts},candidates);
  assert.equal(result.floor,1);
  assert.equal(result.selectedCandidateIds.length,partCount);
  assert.equal(result.packetFloor.added.length,partCount);
 }
});

test('packet floor preserves reserved and direct pages and displaces only fill additions',()=>{
 const selected=['C1','C2','C3','C4','C5','C6'];
 const result=enforcePartPacketFloor({selectedCandidateIds:selected,parts:[
  {partId:'P1',candidateIds:['C1'],evidence:[{candidateId:'C1',support:'direct'}]},
  {partId:'P2',candidateIds:[],evidence:[]}
 ]},[
  {id:'C1',retrievedPartHints:['P1']},
  ...selected.slice(1).map(id=>({id,retrievedPartHints:[]})),
  {id:'C7',retrievedPartHints:['P2']},{id:'C8',retrievedPartHints:['P2']}
 ]);
 assert.equal(result.floor,2);
 assert.equal(result.selectedCandidateIds.length,6);
 assert.ok(result.selectedCandidateIds.includes('C1'));
 assert.ok(result.selectedCandidateIds.includes('C7'));
 assert.ok(result.selectedCandidateIds.includes('C8'));
 assert.deepEqual(result.packetFloor.added.map(item=>item.displacedCandidateId),['C2','C3']);
});

test('packet floor records a skip when the cap has no displaceable fill page',()=>{
 const selected=['C1','C2','C3','C4','C5','C6'];
 const result=enforcePartPacketFloor({selectedCandidateIds:selected,parts:[
  {partId:'P1',candidateIds:['C1'],evidence:[{candidateId:'C1',support:'direct'}]},
  {partId:'P2',candidateIds:selected.slice(1),evidence:selected.slice(1).map(candidateId=>({candidateId,support:'direct'}))}
 ]},[...selected.map(id=>({id,retrievedPartHints:[id==='C1'?'P1':'P2']})),
  {id:'C7',retrievedPartHints:['P1']},{id:'C8',retrievedPartHints:['P1']}]);
 assert.equal(result.selectedCandidateIds.length,6);
 assert.ok(result.packetFloor.skipped.every(item=>item.reason==='no-displaceable-fill'));
});

test('floored pages pack after reserved and direct evidence but before fill candidates',()=>{
 const order=orderPacketForPacking(['C1','C2','C3','C4'],[
  {candidateIds:['C1'],evidence:[{candidateId:'C3',support:'direct'}]},
  {candidateIds:['C5'],evidence:[]}
 ],[{candidateId:'C4',partId:'P2'}]);
 assert.deepEqual(order,['C1','C3','C4','C2']);
});

test('partial-selection recovery reuses selected candidates and does not exceed six pages',()=>{
 const six=Array.from({length:6},(_,index)=>'C'+(index+1));
 const result=recoverUncoveredPartCandidates({selectedCandidateIds:six,parts:[
  {partId:'P1',candidateIds:six},{partId:'P2',candidateIds:[]}
 ]},[
  {id:'C7',retrievedPartHints:['P2']},
  {id:'C2',retrievedPartHints:['P2']}
 ]);
 assert.deepEqual(result.selectedCandidateIds,six);
 assert.deepEqual(result.recoveredPartLinks,[
  {partId:'P2',candidateId:'C2',reason:'retrieved-part-hint'}
 ]);
 assert.deepEqual(result.skippedPartRecoveries,[]);
 const bounded=recoverUncoveredPartCandidates({selectedCandidateIds:six,parts:[
  {partId:'P1',candidateIds:six},{partId:'P2',candidateIds:[]}
 ]},[{id:'C7',retrievedPartHints:['P2']}]);
 assert.deepEqual(bounded.selectedCandidateIds,six);
 assert.deepEqual(bounded.recoveredPartLinks,[]);
 assert.deepEqual(bounded.skippedPartRecoveries,[{partId:'P2',reason:'six-page-packet-limit'}]);

 const rejected=recoverUncoveredPartCandidates({selectedCandidateIds:['C1'],parts:[
  {partId:'P1',candidateIds:['C1']},{partId:'P2',candidateIds:[]}
 ]},[{id:'C1',retrievedPartHints:['P2']}]);
 assert.deepEqual(rejected.selectedCandidateIds,['C1']);
 assert.deepEqual(rejected.recoveredPartLinks,[
  {partId:'P2',candidateId:'C1',reason:'retrieved-part-hint'}
 ]);
 assert.deepEqual(rejected.skippedPartRecoveries,[]);
});

test('context-only part gets one bounded retrieval-linked recovery candidate, while direct support is left alone',()=>{
 const result=recoverUncoveredPartCandidates({selectedCandidateIds:['C1','C2'],parts:[
  {partId:'P1',candidateIds:['C1'],evidence:[{candidateId:'C1',support:'direct'}]},
  {partId:'P2',candidateIds:['C2'],evidence:[{candidateId:'C2',support:'context'}]}
 ]},[
  {id:'C1',retrievedPartHints:['P1']},
  {id:'C2',retrievedPartHints:['P2']},
  {id:'C3',retrievedPartHints:['P2']},
  {id:'C4',retrievedPartHints:['P2']}
 ]);
 assert.deepEqual(result.selectedCandidateIds,['C1','C2']);
 assert.deepEqual(result.recoveredPartLinks,[
  {partId:'P2',candidateId:'C2',reason:'retrieved-part-hint'}
 ]);
 assert.deepEqual(result.skippedPartRecoveries,[]);
});

test('context-only recovery still respects the six-page packet limit',()=>{
 const six=Array.from({length:6},(_,index)=>'C'+(index+1));
 const result=recoverUncoveredPartCandidates({selectedCandidateIds:six,parts:[
  {partId:'P1',candidateIds:['C1'],evidence:[{candidateId:'C1',support:'context'}]}
 ]},[{id:'C7',retrievedPartHints:['P1']}]);
 assert.deepEqual(result.selectedCandidateIds,six);
 assert.deepEqual(result.recoveredPartLinks,[]);
 assert.deepEqual(result.skippedPartRecoveries,[{partId:'P1',reason:'six-page-packet-limit'}]);
});

test('one retrieved candidate may provide a recovery link to multiple uncovered parts',()=>{
 const result=recoverUncoveredPartCandidates({selectedCandidateIds:['C1'],parts:[
  {partId:'P1',candidateIds:['C1']},{partId:'P2',candidateIds:[]},{partId:'P3',candidateIds:[]}
 ]},[{id:'C2',retrievedPartHints:['P2','P3']}]);
 assert.deepEqual(result.selectedCandidateIds,['C1','C2']);
 assert.deepEqual(result.recoveredPartLinks.map(link=>[link.partId,link.candidateId]),[
  ['P2','C2'],['P3','C2']
 ]);
});

test('selector runs at temperature 0 (batch 5 L6)',async()=>{
 let seen;
 const request=requestWith([{partId:'P1',evidence:[{candidateId:'C1',support:'direct'}]}]);
 const original=request.ai.run;
 request.ai.run=async(model,input)=>{seen=input;return original(model,input);};
 await selectEvidenceCandidates(request);
 assert.equal(seen.temperature,0);
 assert.equal(seen.max_completion_tokens,960);
});

test('selector times out at 25 s with the call-timeout reason (batch 5 L2)',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});
 try{
  const request=requestWith([]);
  request.ai.run=()=>new Promise(()=>{});
  const pending=selectEvidenceCandidates(request);
  const rejection=assert.rejects(pending,error=>
   error?.failureCode==='selector-provider-error'&&error?.failureReason==='call-timeout');
  t.mock.timers.tick(25000);
  await rejection;
 }finally{t.mock.timers.reset();}
});

// ---------------------------------------------------------------------------
// Batch 34 (B34-4): duplicate-bookId bar + facet representation at the
// Worker selector. The replay fixtures carry the production pools'
// bookId/page/part-links/facetRanks verbatim (batch-33 artifacts); the
// selected sets are the model's submitted pages as C-ids in pool order.
// ---------------------------------------------------------------------------

const b34Row=(index,bookId,page,parts,ranks)=>({id:'C'+index,bookId,page,
 candidatePartIds:parts,
 ...(ranks?{facetRanks:ranks.map(([facet,rank])=>({facet,rank}))}:{})});

test('batch 34 B34-4 replay (Ambition pass 2): the duplicate 593 slot yields to a facet-top book; 593 submits once',()=>{
 // Production: OpenStax U.S. History (593) occupied two of six slots
 // in BOTH Ambition passes while facet-top books went unsubmitted.
 const pool=[
  b34Row(1,'593',526,['P1'],[[0,3],[6,1]]),b34Row(2,'236',66,['P2'],[[1,1]]),
  b34Row(3,'595',133,['P2'],[[1,3],[5,1]]),b34Row(4,'523',447,['P2'],[[3,1],[7,1]]),
  b34Row(5,'646',2254,['P1'],[[4,1]]),b34Row(6,'603',192,[],[[0,6]]),
  b34Row(7,'259',119,[],[[2,1]]),b34Row(8,'612',162,['P1'],[[8,1]]),
  b34Row(9,'595',243,['P2'],[[9,1]]),b34Row(10,'630',569,['P1'],[[6,3]]),
  b34Row(11,'439',293,['P2'],[[3,2],[7,2]]),b34Row(12,'638',1910,['P1'],[[4,2]]),
  b34Row(13,'414',2509,['P2'],[[5,3]]),b34Row(14,'594',290,['P2'],[[1,5]]),
  b34Row(15,'379',66,['P2','P1'],[[3,5],[4,11],[7,5]]),b34Row(16,'550',112,['P1'],[[4,12]]),
  b34Row(17,'458',14,['P1'],[[6,5]]),b34Row(18,'267',77,['P2'],[[1,13]]),
  b34Row(19,'255',98,[],[[2,2]]),b34Row(20,'650',265,['P1'],[[8,2]]),
  b34Row(21,'115',45,[],[[2,7]]),b34Row(22,'593',527,['P1'],[[0,1],[6,2]]),
  b34Row(23,'595',136,['P2'],[[1,4],[5,2]]),b34Row(24,'236',65,['P2'],[[1,2]]),
  b34Row(25,'593',528,[],[[0,2]]),b34Row(26,'439',292,['P2'],[[3,3],[7,3]]),
  b34Row(27,'638',809,['P1'],[[8,3]]),b34Row(28,'255',97,[],[[2,3]]),
  b34Row(29,'523',256,['P2'],[[3,4],[7,4]]),b34Row(30,'603',155,[],[[0,7],[2,9]]),
  b34Row(31,'638',481,['P1'],[[4,4]])];
 const selected=['C1','C22','C4','C11','C7','C23'];
 const result=enforceSubmittedBookDiversity(selected,pool,{partIds:['P1','P2']});
 assert.equal(result.selectedCandidateIds.length,6);
 const books=result.selectedCandidateIds.map(id=>pool.find(row=>row.id===id).bookId);
 assert.equal(books.filter(book=>book==='593').length,1,
  'book 593 occupies exactly one submitted slot');
 assert.deepEqual(result.diversityInserted,[{candidateId:'C2',bookId:'236',
  displacedCandidateId:'C22',reason:'duplicate-book-slot'}],
  'the deferred 593 page yields its slot to facet 1\'s top book (236)');
 // Proust (414) tops no facet (its best rank is 3), so the guarantee —
 // which covers facet-top books, exactly as B33-7(b)'s did — does not
 // reach it; it is not inserted ahead of higher-priority fills.
 assert.ok(!result.selectedCandidateIds.includes('C13'),
  'Proust is not force-inserted: it holds no facet-top position');
 assert.ok(result.selectionDroppedFacets.some(entry=>
  entry.facet===4&&entry.bookId==='646'&&
  entry.reason==='packet-filled-with-distinct-books'));
 assert.ok(result.selectionDroppedFacets.some(entry=>
  entry.facet===8&&entry.bookId==='612'&&
  entry.reason==='packet-filled-with-distinct-books'));
});

test('batch 34 B34-4 replay (C&P SP2): the facet-top page the selector passed over (Sonya, p. 436) displaces a rank-2-only page',()=>{
 // Production: p. 436 was facet-rank 1 in three facets (f4/f6/f13 —
 // f6/f13 are P3's own facets) and the pool's highest score, yet SP2
 // submitted neither Sonya page; all six slots went to pages whose
 // best facet rank was 1 only via other parts' facets or rank 2.
 // Part links cannot discriminate here (scoped pool: every page
 // links every part) — facetRanks are the signal.
 const pool=[
  b34Row(1,'114',464,['P1','P2','P3'],[[0,5],[3,1],[4,2],[5,1],[7,1],[9,4]]),
  b34Row(2,'114',603,['P2','P1','P3'],[[1,2],[3,3],[4,6],[5,2],[10,1]]),
  b34Row(3,'114',475,['P1','P2','P3'],[[0,1],[3,4],[5,3]]),
  b34Row(4,'114',465,['P1','P2','P3'],[[0,3],[3,2],[7,2],[9,1]]),
  b34Row(5,'114',703,['P3','P1','P2'],[[6,2],[13,2]]),
  b34Row(6,'114',597,['P2','P1','P3'],[[10,2]]),
  b34Row(7,'114',868,['P3','P1','P2'],[[11,2]]),
  b34Row(8,'114',467,['P1','P2','P3'],[[9,3]]),
  b34Row(9,'114',749,['P3','P1','P2'],[[6,5]]),
  b34Row(10,'114',136,['P1','P2','P3'],[[3,5]]),
  b34Row(11,'114',436,['P3','P1','P2'],[[4,1],[6,1],[13,1]]),
  b34Row(12,'114',446,['P1','P2','P3'],[[4,3],[5,6],[7,3]]),
  b34Row(13,'114',619,['P2','P1','P3'],[[1,1],[5,4],[10,4]]),
  b34Row(14,'114',789,['P2','P1','P3'],[[4,4],[8,1]]),
  b34Row(15,'114',856,['P1','P3','P2'],[[0,4],[11,1]]),
  b34Row(16,'114',279,['P1','P2','P3'],[[0,2]]),
  b34Row(17,'114',855,['P1','P3','P2'],[[9,2],[11,3]]),
  b34Row(18,'114',427,['P3','P1','P2'],[[6,3],[13,3]]),
  b34Row(19,'114',438,['P3','P1','P2'],[[6,4],[13,4]]),
  b34Row(20,'114',614,['P2','P1','P3'],[[10,3]]),
  b34Row(21,'114',296,['P1','P2','P3'],[[7,4]]),
  b34Row(22,'114',86,['P3','P1','P2'],[[11,4]]),
  b34Row(23,'114',52,['P1','P2','P3'],[[4,5]]),
  b34Row(24,'114',454,['P2','P1','P3'],[[5,5]]),
  b34Row(25,'114',958,['P1','P2','P3'],[[7,5]]),
  b34Row(26,'114',471,['P1','P2','P3'],[[0,6]]),
  b34Row(27,'114',529,['P1','P2','P3'],[[7,6]]),
  b34Row(28,'114',87,['P3','P1','P2'],[[6,6]]),
  b34Row(29,'114',809,['P1','P2','P3'],[[3,6]])];
 const selected=['C1','C2','C3','C4','C5','C6'];
 const result=enforceSubmittedBookDiversity(selected,pool,{partIds:['P1','P2','P3']});
 assert.equal(result.selectedCandidateIds.length,6);
 assert.ok(result.selectedCandidateIds.includes('C11'),
  'p. 436 (facet-top of f4/f6/f13) is submitted');
 assert.ok(!result.selectedCandidateIds.includes('C5')&&
  !result.selectedCandidateIds.includes('C6'),
  'the displaced pages are the two selected pages topping no facet (703, 597)');
 for(const id of ['C1','C2','C3','C4'])
  assert.ok(result.selectedCandidateIds.includes(id),
   'selected facet-top pages are never displaced');
 const sonya=result.diversityInserted.find(entry=>entry.candidateId==='C11');
 assert.equal(sonya.reason,'facet-top-page');
 assert.deepEqual(sonya.facets,[4,6,13]);
 assert.ok(result.selectionDroppedFacets.some(entry=>
  entry.facet===8&&entry.page===789&&
  entry.reason==='packet-filled-with-facet-tops'));
 assert.ok(result.selectionDroppedFacets.some(entry=>
  entry.facet===11&&entry.page===856&&
  entry.reason==='packet-filled-with-facet-tops'));
});

test('batch 34 B34-4 replay (Solitude): the second Hersey slot yields and facet 0\'s #2 book (Goffman) enters',()=>{
 // Production: Hersey (580) took two slots while Goffman (579) —
 // facet 0 ranks 2/3/6 — and Bookchin (424) went unsubmitted. Every
 // facet-top book was already represented, so the duplicate yields
 // to the next distinct book in pool order: Goffman.
 const pool=[
  b34Row(1,'580',109,['P2'],[[9,1],[11,1]]),b34Row(2,'136',391,['P1'],[[4,12]]),
  b34Row(3,'332',477,['P1'],[[0,1]]),b34Row(4,'414',2571,['P1'],[[8,1]]),
  b34Row(5,'580',103,['P2'],[[6,1]]),b34Row(6,'151',18,[],[[1,1]]),
  b34Row(7,'579',7,['P1'],[[0,2]]),b34Row(8,'611',2,['P1'],[[8,2]]),
  b34Row(9,'550',398,['P1'],[[0,4]]),b34Row(10,'618',60,[],[[4,3]]),
  b34Row(11,'257',108,['P1'],[[8,5]]),b34Row(12,'424',98,['P1'],[[0,5]]),
  b34Row(13,'612',155,[],[[1,3]]),b34Row(14,'519',157,[],[[4,5]]),
  b34Row(15,'576',210,[],[[1,6]]),b34Row(16,'282',24,[],[[4,13]]),
  b34Row(17,'136',275,[],[[4,1]]),b34Row(18,'136',274,[],[[4,2]]),
  b34Row(19,'151',17,[],[[1,2]]),b34Row(20,'414',2417,['P1'],[[8,3]]),
  b34Row(21,'579',163,['P1'],[[0,3]]),b34Row(22,'618',124,['P1'],[[4,4]]),
  b34Row(23,'618',155,[],[[1,4]]),b34Row(24,'611',7,['P1'],[[8,4]]),
  b34Row(25,'618',275,[],[[1,5]]),b34Row(26,'519',158,[],[[4,6]]),
  b34Row(27,'611',17,['P1'],[[8,6]]),b34Row(28,'579',165,['P1'],[[0,6]]),
  b34Row(29,'618',264,[],[[4,7]]),b34Row(30,'151',677,['P1'],[[1,7]]),
  b34Row(31,'414',531,['P1'],[[8,7]]),b34Row(32,'424',102,['P1'],[[0,7]])];
 const selected=['C1','C2','C3','C4','C5','C6'];
 const result=enforceSubmittedBookDiversity(selected,pool,{partIds:['P1','P2']});
 const books=result.selectedCandidateIds.map(id=>pool.find(row=>row.id===id).bookId);
 assert.equal(books.filter(book=>book==='580').length,1,
  'book 580 occupies exactly one submitted slot');
 assert.deepEqual(result.diversityInserted,[{candidateId:'C7',bookId:'579',
  displacedCandidateId:'C5',reason:'duplicate-book-slot'}]);
 assert.deepEqual(result.diversityDeferred,['C5']);
 assert.equal(result.selectedCandidateIds.length,6);
});

test('batch 34 B34-4: a part-linked duplicate does NOT yield to an unlinked facet-top book (the Proust pass-1 narrowing)',()=>{
 // Production shape (Ambition pass 1): Proust's only candidate had
 // NO part links. B33-7(b)'s disclosed narrowing, re-homed: a
 // part-linked duplicate does not yield to a book with no part
 // linkage at all — the duplicate ships, and the unlinked facet-top
 // book is traced as dropped over a duplicate slot.
 const pool=[
  b34Row(1,'100',10,['P1'],[[1,1]]),b34Row(2,'100',20,['P1'],[]),
  b34Row(3,'200',30,['P2'],[[2,1]]),b34Row(4,'300',40,[],[[0,1]]),
  b34Row(5,'400',50,['P1'],[]),b34Row(6,'500',60,['P2'],[]),
  b34Row(7,'600',70,['P1'],[])];
 const selected=['C1','C2','C3','C5','C6','C7'];
 const result=enforceSubmittedBookDiversity(selected,pool,{partIds:['P1','P2']});
 assert.deepEqual(result.selectedCandidateIds,selected,
  'the duplicate ships: the only unsubmitted distinct book is unlinked');
 assert.equal(result.diversityInserted,undefined);
 assert.deepEqual(result.selectionDroppedFacets,[{facet:0,bookId:'300',
  reason:'duplicate-book-slot-used'}]);
});

test('batch 34 B34-4: without facetRanks, part-top books are the representation targets',()=>{
 const pool=[
  b34Row(1,'100',1,['P1']),b34Row(2,'100',2,['P1']),
  b34Row(3,'200',1,['P1']),b34Row(4,'300',1,['P2']),
  b34Row(5,'400',1,['P1']),b34Row(6,'500',1,['P1']),
  b34Row(7,'600',1,['P2'])];
 const selected=['C1','C2','C3','C5','C6','C7'];
 const result=enforceSubmittedBookDiversity(selected,pool,{partIds:['P1','P2']});
 assert.deepEqual(result.diversityInserted,[{candidateId:'C4',bookId:'300',
  displacedCandidateId:'C2',reason:'duplicate-book-slot'}],
  'P2\'s top book (300) takes the duplicate slot');
 assert.deepEqual(result.selectionDroppedFacets,[]);
 assert.equal(result.selectedCandidateIds.length,6);
});

test('batch 34 B34-4 control: a dominant book with no facet rivals submits exactly as today',()=>{
 // Single-book pool, no facet data: neither sub-pass can fire.
 const singleBook=Array.from({length:8},(_,index)=>
  b34Row(index+1,'114',100+index,['P1','P2','P3']));
 const selected=['C1','C2','C3','C4','C5','C6'];
 const result=enforceSubmittedBookDiversity(selected,singleBook,
  {partIds:['P1','P2','P3']});
 assert.deepEqual(result.selectedCandidateIds,selected);
 assert.equal(result.diversityInserted,undefined);
 // Distinct books, every facet-top already selected: unchanged.
 const distinct=[
  b34Row(1,'10',1,['P1'],[[0,1]]),b34Row(2,'20',1,['P1'],[[1,1]]),
  b34Row(3,'30',1,['P2'],[[2,1]]),b34Row(4,'40',1,['P2'],[[3,1]]),
  b34Row(5,'50',1,['P1'],[[4,1]]),b34Row(6,'60',1,['P2'],[[0,2]]),
  b34Row(7,'70',1,['P1'],[[1,2]])];
 const chosen=['C1','C2','C3','C4','C5','C6'];
 const result2=enforceSubmittedBookDiversity(chosen,distinct,{partIds:['P1','P2']});
 assert.deepEqual(result2.selectedCandidateIds,chosen);
 assert.equal(result2.diversityInserted,undefined);
});

// Stage B (B1a): facet-anchor reservation — the deterministic
// packing seeds each facet's rank-1 page before round-robin
// filling, ordered by facet multiplicity, then facet, then pool.
test('stage B B1a facetAnchorReservations: facet tops seed in consensus order',()=>{
 const rows=[
  {id:'C1',candidatePartIds:['P1'],facetRanks:[{facet:0,rank:2},{facet:1,rank:1}]},
  {id:'C2',candidatePartIds:['P1'],facetRanks:[{facet:0,rank:3}]},
  {id:'C3',candidatePartIds:['P2'],facetRanks:[{facet:0,rank:1},{facet:2,rank:1}]},
  {id:'C4',candidatePartIds:['P2'],facetRanks:[{facet:2,rank:2}]},
  {id:'C5',candidatePartIds:['P1']}];
 const result=facetAnchorReservations(rows);
 assert.equal(result.hasFacetRanks,true);
 // C3 tops two facets (consensus strongest) and seeds first;
 // C1 tops facet 1 and seeds second. Facet 0's top is C3.
 assert.deepEqual(result.seedCandidateIds,['C3','C1']);
 assert.deepEqual(result.reservations,[
  {facet:0,candidateId:'C3',partIds:['P2'],status:'reserved'},
  {facet:1,candidateId:'C1',partIds:['P1'],status:'reserved'},
  {facet:2,candidateId:'C3',partIds:['P2'],status:'reserved'}]);
});

test('stage B B1a facetAnchorReservations: the cap defers later anchors instead of displacing seeds',()=>{
 const rows=[
  {id:'C1',facetRanks:[{facet:0,rank:1}]},
  {id:'C2',facetRanks:[{facet:1,rank:1}]},
  {id:'C3',facetRanks:[{facet:2,rank:1}]}];
 const result=facetAnchorReservations(rows,{limit:2});
 assert.deepEqual(result.seedCandidateIds,['C1','C2']);
 assert.deepEqual(result.reservations.map(entry=>entry.status),
  ['reserved','reserved','cap-deferred']);
});

test('stage B B1a facetAnchorReservations: no facet ranks in the pool, no reservation — and it says so',()=>{
 const result=facetAnchorReservations([
  {id:'C1',candidatePartIds:['P1']},{id:'C2',candidatePartIds:['P1']}]);
 assert.deepEqual(result,{hasFacetRanks:false,seedCandidateIds:[],reservations:[]});
});
