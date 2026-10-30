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

test('selector prompt demonstrates one valid coverage value and accepts a valid decision',async()=>{
 let systemPrompt='';
 const request={question:'What does this source argue?',parts:[{partId:'P1',question:'What is the argument?'}],
  candidates:[{id:'C1',title:'A source',page:1,excerpt:'A sufficiently long source excerpt for testing.'}],
  ai:{run:async(_model,{messages})=>{
   systemPrompt=messages.find(message=>message.role==='system')?.content||'';
   return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({parts:[{
    partId:'P1',candidateIds:['C1'],coverage:'supported'}]})}}]};
  }}};
 const result=await selectEvidenceCandidates(request);
 assert.match(systemPrompt,/"coverage":"supported"/);
 assert.match(systemPrompt,/exactly one of "supported", "partial", or "none"/);
 assert.doesNotMatch(systemPrompt,/"coverage":"supported\|partial\|none"/);
 assert.deepEqual(result.selectedCandidateIds,['C1']);
 assert.equal(result.parts[0].coverage,'supported');
});

test('selector invalid-response subtype is safe and distinguishes malformed decisions',async()=>{
 const request={question:'What does this source argue?',parts:[{partId:'P1',question:'What is the argument?'}],
  candidates:[{id:'C1',title:'A source',page:1,excerpt:'A sufficiently long source excerpt for testing.'}],
  ai:{run:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({parts:[{
   partId:'P1',candidateIds:['C99'],coverage:'supported'}]})}}]})}};
 await assert.rejects(selectEvidenceCandidates(request),error=>{
  assert.equal(error.failureCode,'selector-invalid-response');
  assert.equal(error.failureReason,'unknown-candidate-id');
  return true;
 });
});

test('selector reports a coverage-selection mismatch without retaining model text',async()=>{
 const request={question:'What does this source argue?',parts:[{partId:'P1',question:'What is the argument?'}],
  candidates:[{id:'C1',title:'A source',page:1,excerpt:'A sufficiently long source excerpt for testing.'}],
  ai:{run:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({parts:[{
   partId:'P1',candidateIds:['C1'],coverage:'none'}]})}}]})}};
 await assert.rejects(selectEvidenceCandidates(request),error=>{
  assert.equal(error.failureReason,'coverage-selection-mismatch');
  assert.equal(error.message.includes('C1'),false);
  return true;
 });
});
