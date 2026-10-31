import assert from 'node:assert/strict';
import {test} from 'node:test';
import {orderFallbackCandidates,selectEvidenceCandidates} from './evidence-selector.mjs';

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

test('selector requires a verbatim excerpt and derives direct coverage from it',async()=>{
 let systemPrompt='';
 const request=requestWith([{partId:'P1',evidence:[{candidateId:'C1',support:'direct',
  excerpt:'doubt itself proves the thinker exists'}]}]);
 const original=request.ai.run;
 request.ai.run=async(model,input)=>{systemPrompt=input.messages.find(message=>message.role==='system')?.content||'';
  assert.equal(input.max_completion_tokens,960);return original(model,input);};
 const result=await selectEvidenceCandidates(request);
 assert.match(systemPrompt,/"support":"direct"/);
 assert.match(systemPrompt,/exact, contiguous excerpt/);
 assert.deepEqual(result.selectedCandidateIds,['C1']);
 assert.deepEqual(result.parts[0].candidateIds,['C1']);
 assert.equal(result.parts[0].coverage,'supported');
 assert.equal(result.parts[0].evidence[0].excerptMatched,true);
});

test('a part with only contextual evidence stays partial even if its retrieval hint was linked',async()=>{
 const request=requestWith([{partId:'P1',evidence:[{candidateId:'C1',support:'context',
  excerpt:'doubt itself proves the thinker exists'}]}]);
 request.candidates[0].retrievedPartHints=['P1'];
 const result=await selectEvidenceCandidates(request);
 assert.equal(result.parts[0].coverage,'partial');
 assert.equal(result.parts[0].evidence[0].support,'context');
});

test('a model paraphrase cannot be recorded as a direct supporting excerpt',async()=>{
 const request=requestWith([{partId:'P1',evidence:[{candidateId:'C1',support:'direct',
  excerpt:'thinking proves that a person exists'}]}]);
 const result=await selectEvidenceCandidates(request);
 assert.equal(result.parts[0].coverage,'partial');
 assert.equal(result.parts[0].evidence[0].support,'context');
 assert.equal(result.parts[0].evidence[0].excerpt,'');
 assert.equal(result.parts[0].evidence[0].excerptMatched,false);
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
  {failureReason:'invalid-evidence-excerpt',parts:[{partId:'P1',evidence:[{candidateId:'C1',support:'direct',excerpt:'short'}]}]}
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
 assert.deepEqual(result.parts[0].evidence,[{candidateId:'C1',support:'context',excerpt:'',excerptMatched:false}]);
});

test('valid no-evidence selection remains an explicit empty result',async()=>{
 const result=await selectEvidenceCandidates(requestWith([{partId:'P1',evidence:[]}]));
 assert.deepEqual(result.selectedCandidateIds,[]);
 assert.deepEqual(result.parts[0].candidateIds,[]);
 assert.equal(result.parts[0].coverage,'none');
});
