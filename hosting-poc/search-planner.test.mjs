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
test('planner returns a bounded structured plan with canonical source IDs and question parts',async()=>{
 const question='How do Hume’s Enquiry and Kant’s Critique of Pure Reason differ over causal necessity?';
 const planned={resolvedQuestion:question,intent:'compare',
  sources:[{label:'Hume',role:'primary'},{label:'Kant',role:'primary'}],
  parts:['How does Hume explain causal necessity?','How does Kant explain causal necessity?'],
  scope:'Both named works',queries:['Hume Enquiry necessary connection habit','Kant Critique causality a priori category']};
 const result=await planSearchQueries(question,'',{
  run:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(planned)}}],
   usage:{neurons:5}})});
 assert.equal(result.plan.intent,'compare');
 assert.deepEqual(result.plan.parts.map(part=>part.sourceBookIds),[
  ['34','35','268','276','555'],['40'],['34','35','268','276','555','40']]);
 assert.match(result.plan.parts[2].question,/compare in response to this question/i);
 assert.ok(result.plan.parts[0].searchQueries.some(query=>/Hume/i.test(query)));
 assert.ok(result.plan.parts[1].searchQueries.some(query=>/Kant/i.test(query)));
 assert.ok(result.plan.parts[2].searchQueries.some(query=>/Hume/i.test(query)));
 assert.ok(result.plan.parts[2].searchQueries.some(query=>/Kant/i.test(query)));
 assert.ok(result.plan.sources[0].bookIds.includes('35'));
 assert.ok(result.plan.sources[1].bookIds.includes('40'));
 assert.deepEqual(result.plan.sources.map(source=>source.role),['primary','primary']);
 assert.equal(result.plan.queries.length,2);
 assert.match(result.queries[0],/causal necessity|necessary connection/i);
 assert.match(result.queries[1],/causal necessity|causality/i);
});
test('hypothetical thinker questions keep both authors and each part scoped to both works',async()=>{
 const question='What would Nietzsche think about the thought of Kierkegaard?';
 const planned={resolvedQuestion:question,intent:'compare',sources:[],
  parts:[
   "How does Nietzsche evaluate Kierkegaard's account of faith and the individual?",
   "What is Kierkegaard's account of faith and the individual?"
  ],scope:'',queries:[
   'Nietzsche critique of Kierkegaard religious individual and leap of faith',
   'Nietzsche views on Kierkegaard Christian morality and asceticism'
  ]};
 let systemPrompt='';
 const result=await planSearchQueries(question,'',{
  run:async(_model,options)=>{
   systemPrompt=options.messages[0].content;
   return {choices:[{finish_reason:'stop',message:{content:JSON.stringify(planned)}}]};
  }
 });
 const nietzsche=result.plan.sources.find(source=>/Nietzsche/.test(source.label));
 const kierkegaard=result.plan.sources.find(source=>/Kierkegaard/.test(source.label));
 assert.ok(nietzsche?.bookIds.includes('239'));
 assert.ok(kierkegaard?.bookIds.includes('140'));
 assert.deepEqual(result.plan.sources.map(source=>source.role),['primary','primary']);
 assert.equal(result.plan.intent,'compare');
 const twoSourceParts=result.plan.parts.filter(part=>part.sourceBookIds?.includes('239')&&
  part.sourceBookIds?.includes('140'));
 assert.ok(twoSourceParts.length>=1);
 assert.match(twoSourceParts.at(-1).question,/compare in response to this question/i);
 assert.ok(result.plan.parts.some(part=>part.sourceBookIds?.includes('140')&&
  !part.sourceBookIds.includes('239')));
 assert.deepEqual(result.queries,planned.queries);
 assert.match(systemPrompt,/hypothetical question about what author A would think of author B/i);
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
test('epistemic comparison planning searches for the argument behind a principle',async()=>{
 let systemPrompt='';
 await planSearchQueries(
  'How do Hume and Kant differ over how we can know causal necessity?', '', {
   run:async(_model,options)=>{
    systemPrompt=options.messages[0].content;
    return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
     queries:['Hume causal necessity experience custom habit',
      'Kant causal necessity argument grounds experience rule']
    })}}]};
   }
  });
 assert.match(systemPrompt,/how a claim, principle, or necessity can be known/i);
 assert.match(systemPrompt,/preserve that epistemic relation and the exact phenomenon/i);
 assert.match(systemPrompt,/argument, grounds, or conditions of validity/i);
 assert.match(systemPrompt,/without replacing the terms the reader used/i);
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
test('comparative planning keeps each source on the exact disputed concept',async()=>{
 let systemPrompt='';
 const queries=[
  'Hume Enquiry causal necessity custom habit repeated experience',
  'Kant Critique causal necessity a priori category cause effect'
 ];
 const result=await planSearchQueries(
  'How do Hume’s Enquiry and Kant’s Critique of Pure Reason differ over how we can know causal necessity?',
  'Critique of Pure Reason — Immanuel Kant', {
   run:async(_model,options)=>{
    systemPrompt=options.messages[0].content;
    return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({queries})}}]};
   }
  }
 );
 assert.deepEqual(result.queries,queries);
 assert.match(systemPrompt,/specific disputed concept/i);
 assert.match(systemPrompt,/Kant on causal necessity, search the Second Analogy/i);
 assert.match(systemPrompt,/regulative or absolute necessity alone is not a direct answer/i);
 assert.match(systemPrompt,/that source’s own definition, criterion, or explanation/i);
 assert.match(systemPrompt,/merely reports the other thinker’s position/i);
});
test('dependent part questions retain the parent subject and quoted passage in retrieval queries',async()=>{
 const question='In Hamlet’s “To be, or not to be” soliloquy, what alternatives does he weigh, and how does uncertainty about what follows death affect his reasoning?';
 const planned={resolvedQuestion:question,intent:'explain',sources:[],
  parts:['What alternatives does Hamlet weigh in his “To be, or not to be” soliloquy?',
   'How does uncertainty about the afterlife affect his reasoning in this soliloquy?'],
  scope:'',queries:['Hamlet Shakespeare To be or not to be alternatives suffering',
   'Hamlet Shakespeare To be or not to be death uncertainty afterlife']};
 const result=await planSearchQueries(question,'',{
  run:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(planned)}}]})
 });
 const p2=result.plan.parts[1];
 assert.ok(p2.searchQueries.some(query=>/Hamlet/i.test(query)&&/To be, or not to be/i.test(query)&&/afterlife/i.test(query)));
 assert.ok(p2.searchQueries.every(query=>query.length<=400));
});

test('literary passage planning prefers the canonical primary work',async()=>{
 let systemPrompt='';
 const queries=[
  'Shakespeare Hamlet To be or not to be alternatives fortune death',
  'Shakespeare Hamlet perchance to dream must give us pause uncertainty'
 ];
 const result=await planSearchQueries(
  'In Hamlet’s “To be, or not to be” soliloquy, what alternatives does he weigh, and how does uncertainty about what follows death affect his reasoning?', '', {
   run:async(_model,options)=>{
    systemPrompt=options.messages[0].content;
    return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({queries})}}]};
   }
  }
 );
 assert.deepEqual(result.queries,queries);
 assert.match(systemPrompt,/For a literary scene or quoted line/i);
 assert.match(systemPrompt,/canonical work or author/i);
 assert.match(systemPrompt,/inside collected works, include its canonical author even if the reader names only the scene/i);
 assert.match(systemPrompt,/search Hamlet with William Shakespeare/i);
 assert.match(systemPrompt,/primary text over commentary or anthologies/i);
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
 assert.equal(data.guidance,'Structured search plan; source pages and citations are independently verified');
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
