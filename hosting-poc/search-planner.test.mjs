import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleRequest,planSearchQueries} from './public-gateway.mjs';

const HOST='https://antilogicalism-companion-public.jsynon.workers.dev';
const question='How does Raskolnikov attempt to justify murder and how does the novel challenge his reasoning?';
const good={queries:[
 'Raskolnikov extraordinary man theory Napoleon morality murder',
 'Raskolnikov conscience guilt Sonia suffering confession'
]};
const mockAI={run:async(_model,options)=>({
 choices:[{finish_reason:'stop',message:{content:JSON.stringify(good)}}],
 usage:{neurons:3}})};
function env(overrides={}){
 return {
 PUBLIC_ENABLED:'false',PUBLIC_PILOT_ENABLED:'true',
 TURNSTILE_SITE_KEY:'0x4AAAAAAABC1234567890',
 TURNSTILE_SECRET:'a-sample-not-a-real-private-secret-123',
 AI_RATE_LIMITER:{limit:async()=>({success:true})},
 GLOBAL_RATE_LIMITER:{limit:async()=>({success:true})},
 AI:mockAI,...overrides};
}
function request(data,origin='https://jsynon.github.io'){
 return new Request(HOST+'/api/pilot-plan',{method:'POST',
  headers:{Origin:origin,'CF-Connecting-IP':'198.51.100.12',
   'Content-Type':'application/json'},
  body:JSON.stringify(data)});
}
const body={question,bookId:'114',turnstileToken:'real-mocked-one-use-token'};
const verify=async url=>{
 assert.equal(url,'https://challenges.cloudflare.com/turnstile/v0/siteverify');
 return Response.json({success:true,hostname:'jsynon.github.io',action:'companion_ask'});
};

test('bounded search planner produces distinct, well-formed corpus search queries',async()=>{
 const answer=await planSearchQueries(question,'Crime and Punishment — Dostoevsky',mockAI);
 assert.deepEqual(answer.queries,good.queries);
 assert.equal(answer.usage.neurons,3);
});
test('search planner retains explicitly named authors and works for source scoping',async()=>{
 let systemPrompt='';
 await planSearchQueries('How do Aristotle and Darwin explain change?', '', {
  run:async(_model,options)=>{
   systemPrompt=options.messages[0].content;
   return {choices:[{finish_reason:'stop',message:{content:JSON.stringify(good)}}]};
  }
 });
 assert.match(systemPrompt,/retain the relevant name in its corresponding query/i);
 assert.match(systemPrompt,/Do not invent authors or works/i);
});
test('malformed, duplicate or truncated AI planning fails without invented sources',async()=>{
 for(const raw of ['I cannot help','{"queries":["the same phrase","the same phrase"]}',
   '{"queries":["one","another"]}','{"queries":[{"page":466}, "another phrase"]}']){
  await assert.rejects(planSearchQueries(question,'',{
   run:async()=>({choices:[{message:{content:raw}}]})
  }));
 }
 await assert.rejects(planSearchQueries(question,'',{
   run:async()=>({choices:[{finish_reason:'length',message:{content:JSON.stringify(good)}}]})
 }));
});
test('valid Turnstile and rate-limits gate AI query planning',async()=>{
 let inferenceCalls=0,verifyCalls=0,limits=0;
 const e=env({AI:{run:async()=>{inferenceCalls++;return mockAI.run();}},
   AI_RATE_LIMITER:{limit:async()=>{limits++;return {success:true}}},
   GLOBAL_RATE_LIMITER:{limit:async()=>{limits++;return {success:true}}}});
 const response=await handleRequest(request(body),e,async(...args)=>{
  verifyCalls++;return verify(...args);
 });
 assert.equal(response.status,200);
 const data=await response.json();
 assert.deepEqual(data.queries,good.queries);
 assert.equal(data.guidance,'Search terms only; citations must pass SHA-256 verification');
 assert.equal(inferenceCalls,1);
 assert.equal(verifyCalls,1);
 assert.equal(limits,2);
 assert(!JSON.stringify(data).includes(e.TURNSTILE_SECRET));
});
test('search planning rejected before inference for wrong scope, origin, rates and token',async()=>{
 let inferences=0,network=0;
 const ai={run:async()=>{inferences++;return mockAI.run();}};
 const never=async()=>{network++;throw Error('Forbidden');};
 assert.equal((await handleRequest(request(body,'https://example.invalid'),env({AI:ai}),never)).status,403);
 assert.equal((await handleRequest(request({...body,bookId:'999'}),env({AI:ai}),never)).status,400);
 assert.equal((await handleRequest(request(body),env({AI:ai,AI_RATE_LIMITER:{
  limit:async()=>({success:false})}}),never)).status,429);
 assert.equal((await handleRequest(request(body),env({AI:ai}),async()=>Response.json({
  success:false,'error-codes':['invalid-input-response']
 }))).status,403);
 assert.equal(inferences,0);
 assert.equal(network,0);
});
test('plan endpoint disabled when not opted in and does not reach hosted model',async()=>{
 let invoked=0;
 const reply=await handleRequest(request(body),env({
   PUBLIC_PILOT_ENABLED:'false',AI:{run:async()=>{invoked++;}}
 }),verify);
 assert.equal(reply.status,503);assert.equal(invoked,0);
});
