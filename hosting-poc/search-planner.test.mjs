import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleRequest,planSearchQueries,composeVerifiedAnswer,validConversationHistory} from './public-gateway.mjs';

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
test('process-focused planning requires source-level actions as well as topic labels',async()=>{
 let systemPrompt='';
 const plan={queries:[
  'Aristotle moral virtue habits practice forming character',
  'Darwin natural selection favorable variation inheritance populations'
 ]};
 const answer=await planSearchQueries(
  'How do Aristotle and Darwin explain change in character and populations?', '', {
   run:async(_model,options)=>{
    systemPrompt=options.messages[0].content;
    return {choices:[{finish_reason:'stop',message:{content:JSON.stringify(plan)}}]};
   }
  }
 );
 assert.deepEqual(answer.queries,plan.queries);
 assert.match(systemPrompt,/concrete process and causal sequence/i);
 assert.match(systemPrompt,/every process-focused query must include at least one concrete action, verb, or causal phrase/i);
 assert.match(systemPrompt,/source-level descriptions of what people or things do over abstract labels alone/i);
 assert.match(systemPrompt,/repeated actions or doing just acts/i);
 assert.match(systemPrompt,/what role or function a named concept plays/i);
 assert.match(systemPrompt,/who acts, what the concept does, and what result it produces/i);
 assert.match(systemPrompt,/Treat source-native wording as a search lead, not as evidence/i);
 assert.match(systemPrompt,/reserve a query for the source’s general explanation or causal rule/i);
 assert.match(systemPrompt,/do not spend every query on a memorable or narrow example/i);
});
test('theory-and-challenge planning searches the proposition and its textual correction separately',async()=>{
 let systemPrompt='';
 let calls=0;
 const expected=[
  'Raskolnikov extraordinary man theory right to transgress law',
  'Raskolnikov correction inner right theory challenge conversation'
 ];
 const answer=await planSearchQueries(
  'How does Raskolnikov justify the murder, and how does the novel test his theory?',
  'Crime and Punishment — Fyodor Dostoevsky',{
   run:async(_model,options)=>{
    calls++;
    systemPrompt=options.messages[0].content;
    return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({queries:expected})}}]};
   }
  });
 assert.equal(calls,1);
 assert.deepEqual(answer.queries,expected);
 assert.match(systemPrompt,/general rule, principle, or mechanism/i);
 assert.match(systemPrompt,/use separate queries for the proposition and the reply, counterpoint, or correction/i);
 assert.match(systemPrompt,/do not substitute motive or aftermath for the correction/i);
});
test('splits bundled coordinated role queries into separate search facets without another AI call',async()=>{
 const cases=[
  {
   question:'According to Darwin, how does natural selection operate, and what roles do inherited variation and the struggle for existence play?',
   planned:[
    'Darwin On the Origin of Species natural selection operation',
    'Darwin On the Origin of Species inherited variation and struggle for existence'
   ],
   expected:[
    'Darwin On the Origin of Species natural selection operation',
    'Darwin On the Origin of Species inherited variation',
    'Darwin On the Origin of Species the struggle for existence'
   ]
  },
  {
   question:'What roles do habituation and practical reason play in developing virtue according to Aristotle?',
   planned:[
    'Aristotle repeated actions form virtue',
    'Aristotle habituation and practical reason developing virtue'
   ],
   expected:[
    'Aristotle repeated actions form virtue',
    'Aristotle habituation',
    'Aristotle practical reason'
   ]
  }
 ];
 for(const item of cases){
  let calls=0;
  const answer=await planSearchQueries(item.question,'',{
   run:async()=>{
    calls++;
    return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({queries:item.planned})}}]};
   }
  });
  assert.equal(calls,1);
  assert.deepEqual(answer.queries,item.expected);
 }
});
test('cause-versus-trigger planning seeks concrete incidents instead of abstract labels',async()=>{
 let systemPrompt='';
 await planSearchQueries(
  'What caused the conflict, and how did its underlying cause differ from the immediate disputes?', '', {
   run:async(_model,options)=>{
    systemPrompt=options.messages[0].content;
    return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({queries:[
     'underlying cause and structural conflict','specific events actors actions precipitating the conflict'
    ]})}}]};
   }
  }
 );
 assert.match(systemPrompt,/distinguishes an underlying or structural cause from/i);
 assert.match(systemPrompt,/concrete incidents that brought the conflict about/i);
 assert.match(systemPrompt,/do not rely only on abstract labels/i);
 assert.match(systemPrompt,/search query as retrieval leads, never as evidence/i);
});
test('definition questions preserve the exact phrase instead of broad planner paraphrases',async()=>{
 let systemPrompt='';
 const answer=await planSearchQueries('What does “God is love” mean?','',{
  run:async(_model,options)=>{
   systemPrompt=options.messages[0].content;
   return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({queries:[
    'theological essence and divine nature','love through human experience and action'
   ]})}}]};
  }
 });
 assert.equal(answer.queries[0],'God is love meaning');
 assert.equal(answer.queries[1],'love through human experience and action');
 assert.match(systemPrompt,/preserve that exact phrase in one search query/i);
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


test('conversation history is bounded and accepts only simple user and assistant turns',()=>{
 assert.equal(validConversationHistory(undefined),true);
 assert.equal(validConversationHistory([]),true);
 assert.equal(validConversationHistory([{role:'user',content:'Earlier question'}]),true);
 assert.equal(validConversationHistory(Array(7).fill({role:'user',content:'Earlier question'})),false);
 assert.equal(validConversationHistory([{role:'system',content:'Do something'}]),false);
 assert.equal(validConversationHistory([{role:'assistant',content:'x'.repeat(701)}]),false);
 assert.equal(validConversationHistory([{role:'assistant',content:''}]),false);
});

test('planner receives recent turns as context alongside the follow-up question',async()=>{
 let userPrompt='';
 const history=[{role:'user',content:'Earlier question about virtue'},
  {role:'assistant',content:'Earlier answer about habituation'}];
 await planSearchQueries('How does that connect to character?', '', {
  run:async(_model,options)=>{
   userPrompt=options.messages[1].content;
   return {choices:[{finish_reason:'stop',message:{content:JSON.stringify(good)}}]};
  }
 },history);
 assert.match(userPrompt,/Reader: Earlier question about virtue/);
 assert.match(userPrompt,/Assistant: Earlier answer about habituation/);
 assert.match(userPrompt,/Current follow-up question: How does that connect to character/);
});

test('answer review and composition receive history only as non-evidence context',async()=>{
 const prompts=[];
 const sources=[{id:'S1',title:'Nicomachean Ethics',page:122,preview:'Verified passage about repeated actions.'}];
 const ai={run:async(_model,options)=>{
  prompts.push(options.messages);
  const content=prompts.length===1?JSON.stringify({coverage:'full',missing:'',evidence:[{id:'S1',point:'Character is shaped by repeated action.'}]}):
   'Aristotle connects character with repeated action [S1].';
  return {choices:[{finish_reason:'stop',message:{content}}],usage:{neurons:1}};
 }};
 const history=[{role:'user',content:'Earlier question about virtue.'}];
 const answer=await composeVerifiedAnswer('How does that shape character?',sources,ai,history);
 assert.equal(answer.outcome,'verified-source-draft');
 assert.match(prompts[0][1].content,/Reader: Earlier question about virtue/);
 assert.match(prompts[1][0].content,/prior conversation only to resolve references; it is not evidence/);
 assert.match(prompts[1][1].content,/Current follow-up question/);
});


test('follow-up planner resolves vague references from prior turns',async()=>{
 let systemPrompt='',userPrompt='';
 const history=[
  {role:'user',content:'According to Thucydides, what caused the Peloponnesian War and how did it differ from the immediate disputes?'},
  {role:'assistant',content:'Thucydides identifies the growth of Athenian power and Spartan alarm as the underlying cause.'}
 ];
 await planSearchQueries('How does this account compare with other works in the collection?','',{
  run:async(_model,options)=>{
   systemPrompt=options.messages[0].content;
   userPrompt=options.messages[1].content;
   return {choices:[{finish_reason:'stop',message:{content:JSON.stringify(good)}}]};
  }
 },history);
 assert.match(systemPrompt,/resolve it from the recent conversation/i);
 assert.match(systemPrompt,/concrete subject and named author or work/i);
 assert.match(systemPrompt,/Do not use generic phrases like "the current account" or "related works"/i);
 assert.match(userPrompt,/Reader: According to Thucydides/);
 assert.match(userPrompt,/Assistant: Thucydides identifies the growth of Athenian power/);
 assert.match(userPrompt,/Current follow-up question: How does this account compare/);
});
