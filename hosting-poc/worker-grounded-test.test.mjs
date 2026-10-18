import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker-grounded-test.mjs';
const base='https://antilogicalism-companion-test.example.workers.dev';
const excerpt={id:'S1',bookId:'152',title:'A Historical Work',page:38,url:'https://drive.google.com/file/d/AnExampleDocumentId1234567/view#page=38',preview:'A historical account examines causes of conflict and differences between two cities.'};
const env={TEST_TOKEN:'private-test-value',AI:{run:async()=>({choices:[{finish_reason:'stop',message:{content:'The passage discusses disagreements as possible causes [S1].'}}],usage:{neurons:1}})}};
function req(path,method='POST',body,token='private-test-value'){return new Request(base+path,{method,headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json','Origin':'http://127.0.0.1:8766'},body:body===undefined?undefined:JSON.stringify(body)});}
test('status never invokes inference',async()=>{const response=await worker.fetch(new Request(base+'/'),env);assert.equal(response.status,200);assert.equal((await response.json()).aiConnected,true);});
test('test endpoint requires authorization',async()=>{assert.equal((await worker.fetch(req('/grounded','POST',{question:'What caused the conflict?',sources:[excerpt]},'incorrect'),env)).status,401);});
test('rejects malformed evidence before inference',async()=>{assert.equal((await worker.fetch(req('/grounded','POST',{question:'What caused the conflict?',sources:[{...excerpt,page:-1}]}),env)).status,400);});
test('sends bounded evidence and returns linked references',async()=>{const response=await worker.fetch(req('/grounded','POST',{question:'What caused the conflict?',sources:[excerpt]}),env);assert.equal(response.status,200);const json=await response.json();assert.equal(json.citations.length,1);assert.equal(json.citations[0].page,38);assert.equal(json.citationReview,'check_claims_against_excerpts');});
test('rejects unapproved browser origin',async()=>{const response=await worker.fetch(new Request(base+'/grounded',{method:'POST',headers:{Origin:'https://untrusted.example'}}),env);assert.equal(response.status,403);});