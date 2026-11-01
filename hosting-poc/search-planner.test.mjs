import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleRequest,planSearchQueries,planSearchGapQueries,composeVerifiedAnswer,validConversationHistory} from './public-gateway.mjs';
import {normalizePlan} from './reader-contract.mjs';

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

test('planner separates distinct outcomes and keeps one causal request together',async()=>{
 const cases=[
  {question:"How does migration affect a city's economy and its family life?",
   parts:["How does migration affect a city's economy?","How does migration affect a city's family life?"]},
  {question:"How does a change in income affect a family's housing choices?",
   parts:["How does a change in income affect a family's housing choices?"]}
 ];
 for(const item of cases){
  const planned={resolvedQuestion:item.question,intent:'explain',sources:[],parts:item.parts,
   scope:'',queries:['migration and the city','migration and family life']};
  const result=await planSearchQueries(item.question,'',{
   run:async(_model,options)=>{
    const prompt=options.messages[0].content;
    assert.match(prompt,/two distinct targets/i);
    assert.match(prompt,/each cause and its consequence together/i);
    assert.match(prompt,/single relationship between two ideas together/i);
    assert.match(prompt,/do not split examples, lists/i);
    return {choices:[{finish_reason:'stop',message:{content:JSON.stringify(planned)}}]};
   }});
  assert.deepEqual(result.plan.parts.map(part=>part.question),item.parts);
 }
});

test('bounded search planner produces distinct, well-formed corpus search queries',async()=>{
 const answer=await planSearchQueries(question,'Crime and Punishment — Dostoevsky',mockAI);
 assert.deepEqual(answer.queries,good.queries);
 assert.equal(answer.usage.neurons,3);
});
test('conditional gap planner returns optional distinct search terms and sees bounded retrieval evidence',async()=>{
 const response=await planSearchGapQueries('How do we know reality exists?','',{
  weakParts:[{partId:'P1',part:'How do we know reality exists?',overlap:0,
   matchedTerms:['simulation'],coverageReason:'index-like-candidates-not-counted',
   sourceBookIds:['16','17','999999'],
   coverageSource:{bookId:'114',page:1264,globalPageId:'114:1264'}}],
  originalQueries:['reality existence knowledge'],
  candidates:[{title:'A source',excerpt:'A bounded passage excerpt.'}]
 },{run:async(_model,options)=>{
  const prompt=options.messages.map(message=>message.content).join('\n');
  assert.match(prompt,/optional retrieval leads/i);
  assert.match(prompt,/coverageReason.*index-like-candidates-not-counted/);
  assert.match(prompt,/coverageSource.*1264/);
  assert.match(prompt,/index-like page is not evidence/i);
  assert.match(prompt,/underlying concepts, assumptions, or kinds of reasoning/i);
  assert.match(prompt,/distinct from direct evidence for the contemporary claim/i);
  assert.match(prompt,/preserve a relevant author or work name/i);
  assert.match(prompt,/Augustine of Hippo/);
  assert.doesNotMatch(prompt,/999999/);
  assert.match(prompt,/A bounded passage excerpt/);
  return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({queries:[
   {partId:'P1',query:'empirical knowledge of external world'},
   {partId:'P1',query:'reality existence perception'}]})}}],usage:{neurons:2}};
 }});
 assert.deepEqual(response.queries,['empirical knowledge of external world','reality existence perception']);
 assert.deepEqual(response.queryPartLinks,[{query:'empirical knowledge of external world',partIds:['P1']},
  {query:'reality existence perception',partIds:['P1']}]);
 assert.equal(response.usage.neurons,2);
});
test('conditional gap planner rejects malformed and repeated original queries',async()=>{
 const result=await planSearchGapQueries('What is knowledge?','',{
  weakParts:[{part:'What is knowledge?',overlap:0}],originalQueries:['empirical knowledge of external world'],candidates:[]
 },{run:async()=>({choices:[{finish_reason:'stop',message:{content:
  '{"queries":["empirical knowledge of external world","alternate theory of knowledge"]}'}}]})});
 assert.deepEqual(result.queries,['alternate theory of knowledge']);
 await assert.rejects(planSearchGapQueries('What is knowledge?','',{
  weakParts:[],originalQueries:[],candidates:[]
 },{run:async()=>({choices:[{finish_reason:'stop',message:{content:'{"queries":["x"]}'}}]})}),/Invalid retrieval gap queries/);
});
test('pilot planner route keeps conditional gap output separate from the answer plan',async()=>{
 let calls=0,verificationCalls=0;
 const environment=env({AI:{run:async(_model,options)=>{
  calls++;assert.match(options.messages[0].content,/optional retrieval leads/i);
  return {choices:[{finish_reason:'stop',message:{content:'{"queries":["experience and perception","external world knowledge"]}'}}]};
 }}});
 const response=await handleRequest(request({...body,retrievalGap:{
  weakParts:[{partId:'P1',part:'How do we know reality?',overlap:0}],originalQueries:['reality existence knowledge'],
  candidates:[{title:'A source',excerpt:'A bounded passage excerpt.'}]
 }}),environment,async(...args)=>{verificationCalls++;return verify(...args);});
 assert.equal(response.status,200);
 const result=await response.json();
 assert.deepEqual(result.queries,['experience and perception','external world knowledge']);
 assert.equal(result.plan,undefined);
 assert.equal(calls,1);assert.equal(verificationCalls,1);
});
test('planner returns a bounded plan scoped to the explicitly named Hume and Kant works',async()=>{
 const question='In Hume’s An Enquiry Concerning Human Understanding, how does he explain causal necessity, and how does Kant’s Critique of Pure Reason differ?';
 const planned={resolvedQuestion:question,intent:'compare',
  sources:[{label:'Hume',role:'primary'},{label:'Kant',role:'primary'}],
  parts:['How does Hume explain causal necessity?','How does Kant explain causal necessity?'],
  scope:'Both named works',queries:['Hume Enquiry necessary connection habit','Kant Critique causality a priori category']};
 const result=await planSearchQueries(question,'',{
  run:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(planned)}}],
   usage:{neurons:5}})});
 assert.equal(result.plan.intent,'compare');
 assert.deepEqual(result.plan.parts.map(part=>part.sourceBookIds),[['35'],['40'],['35','40']]);
 assert.match(result.plan.parts[2].question,/compare in response to this question/i);
 assert.ok(result.plan.parts[0].searchQueries.some(query=>/Hume/i.test(query)));
 assert.ok(result.plan.parts[1].searchQueries.some(query=>/Kant/i.test(query)));
 assert.ok(result.plan.parts[2].searchQueries.some(query=>/Hume/i.test(query)));
 assert.ok(result.plan.parts[2].searchQueries.some(query=>/Kant/i.test(query)));
 assert.deepEqual(result.plan.sources.map(source=>source.bookIds),[['35'],['40']]);
 assert.deepEqual(result.plan.sources.map(source=>source.role),['primary','primary']);
 assert.equal(result.plan.queries.length,2);
 assert.match(result.queries[0],/causal necessity|necessary connection/i);
 assert.match(result.queries[1],/causal necessity|causality/i);
});
test('hypothetical thinker questions bind side searches to each author and reserve a two-source inference part',async()=>{
 const question='What would Nietzsche think about the thought of Kierkegaard?';
 const planned={resolvedQuestion:question,intent:'compare',sources:[],
  parts:[
   "How does Nietzsche evaluate Kierkegaard's account of faith and the individual?",
   "What is Kierkegaard's account of faith and the individual?"
  ],scope:'',queries:[
   'Friedrich Nietzsche s critique or assessment of s religious existentialism',
   'Søren Kierkegaard s definition of faith and the individual s relationship to God'
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
 const stanceIds=result.plan.sources.find(source=>/Nietzsche/.test(source.label)).bookIds;
 const objectIds=result.plan.sources.find(source=>/Kierkegaard/.test(source.label)).bookIds;
 assert.deepEqual(result.plan.parts.map(part=>part.sourceBookIds),
  [stanceIds,objectIds,[...stanceIds,...objectIds]]);
 assert.match(result.plan.parts[2].question,/positions compare.*cautiously be inferred/i);
 assert.match(result.queries[0],/Nietzsche/i);
 assert.doesNotMatch(result.queries[0],/Kierkegaard/i);
 assert.match(result.queries[1],/Kierkegaard/i);
 assert.doesNotMatch(result.queries[1],/Nietzsche/i);
 assert.doesNotMatch(result.queries.join(' '),/(?:^|\s)s(?:$|\s)/i,
  'detached possessive suffixes must not survive author-scoped query cleanup');
 assert.match(result.queries[0],/critique or assessment of religious existentialism/i);
 assert.match(result.queries[1],/definition of faith and the individual relationship to God/i);
 assert.ok(result.plan.parts[0].searchQueries.length>0);
 assert.ok(result.plan.parts[0].searchQueries.every(query=>/Nietzsche/i.test(query)&&!/Kierkegaard/i.test(query)));
 assert.ok(result.plan.parts[1].searchQueries.length>0);
 assert.ok(result.plan.parts[1].searchQueries.every(query=>/Kierkegaard/i.test(query)&&!/Nietzsche/i.test(query)));
 assert.deepEqual(result.plan.parts[2].searchQueries,result.queries,
  'the synthesis reuses the two source-side queries instead of creating an unscoped third facet');
 assert.match(systemPrompt,/named-source comparisons or hypotheticals/i);
});
test('search planner retains explicitly named authors and works for source scoping',async()=>{
 let systemPrompt='';
 await planSearchQueries('How do Aristotle and Darwin explain change?', '', {
  run:async(_model,options)=>{
   systemPrompt=options.messages[0].content;
   return {choices:[{finish_reason:'stop',message:{content:JSON.stringify(good)}}]};
  }
 });
 assert.match(systemPrompt,/explicitly requested authors or works/i);
 assert.match(systemPrompt,/Do not invent authors, works, answers, or citations/i);
});
test('catalog source matching resolves a uniquely named author token',async()=>{
 const question='How do Augustine, Aquinas, and Kant differ in their understanding of moral responsibility?';
 const result=await planSearchQueries(question,'',{
  run:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   intent:'compare',parts:['How does Augustine understand responsibility?',
    'How does Aquinas understand responsibility?','How does Kant understand responsibility?'],
   queries:['Augustine responsibility grace will','Aquinas responsibility reason free will',
    'Kant responsibility autonomy duty']
  })}}]})
 });
 const augustine=result.plan.sources.find(source=>/Augustine/i.test(source.label));
 assert.ok(augustine?.bookIds.length,'the catalog name "Augustine of Hippo" resolves from the uniquely named token');
 assert.deepEqual(result.plan.sources.map(source=>source.label).filter(label=>/Augustine|Aquinas|Kant/i.test(label)).length,3);
});
test('normalization rejects a planner identity mapped to another catalog author',()=>{
 const catalog={
  '34':'A Treatise of Human Nature — David Hume',
  '40':'Critique of Pure Reason — Immanuel Kant'
 };
 const plan=normalizePlan({intent:'compare',sources:[
  {label:'Kant',role:'primary',bookIds:['34','40']}
 ],parts:['How does Kant understand causality?'],queries:[]},
 'How does Kant understand causality?',catalog);
 assert.deepEqual(plan.sources.map(source=>source.bookIds),[['40']]);
});
test('normalization rejects an ambiguous author token as a catalog identity',()=>{
 const catalog={
  '901':'Computing Machinery and Intelligence — Alan Turing',
  '902':'The Principles of Mathematical Logic — Raymond Turing',
  '40':'Critique of Pure Reason — Immanuel Kant'
 };
 const plan=normalizePlan({intent:'compare',sources:[
  {label:'Turing',role:'primary',bookIds:['901','902']},
  {label:'Kant',role:'primary',bookIds:['40']}
 ],parts:['How do Turing and Kant differ?'],queries:[]},
 'How do Turing and Kant differ?',catalog);
 assert.deepEqual(plan.sources.map(source=>source.bookIds),[['40']],
  'a shared surname token must not authorize either distinct catalog author');
});
test('normalization removes a repeated comparison wrapper while preserving source parts',()=>{
 const catalog={
  '4':'Metaphysics — Aristotle','529':'On the Origin of Species — Charles Darwin',
  '9':'Physics — Aristotle','530':'The Descent of Man — Charles Darwin'
 };
 const question='How do Aristotle and Darwin differ in explaining change?';
 const plan=normalizePlan({intent:'compare',sources:[
  {label:'Aristotle',role:'primary',bookIds:['4','9']},
  {label:'Charles Darwin',role:'primary',bookIds:['529','530']}
 ],parts:[
  "How does Aristotle explain change?",
  "How does Darwin explain change?",
  "What are the differences between Aristotle's and Darwin's accounts of change?",
  'How do the named sources compare in response to this question: '+question
 ],queries:['Aristotle change','Darwin change']},question,catalog);
 assert.deepEqual(plan.parts.map(part=>part.id),['P1','P2','P3']);
 assert.match(plan.parts[2].question,/differences between/i);
 assert.deepEqual(plan.parts.map(part=>part.sourceBookIds),[['4','9'],['529','530'],['4','9','529','530']]);
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
 assert.match(systemPrompt,/Preserve the subject, named sources, exact requested concept, and textual scope/i);
});
test('a one-part plan links conceptual planner queries without adding answer obligations',async()=>{
 const queries=['simulation hypothesis arguments','appearance reality external world knowledge'];
 const result=await planSearchQueries('Could reality be simulated?','',{
  run:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   resolvedQuestion:'Could reality be simulated?',intent:'explain',sources:[],
   parts:['Could reality be simulated?'],scope:'',queries
  })}}]})
 });
 assert.ok(queries.every(query=>result.plan.parts[0].searchQueries.includes(query)));
 assert.equal(result.plan.parts.length,1);
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
 assert.match(systemPrompt,/Use remaining queries for its distinct requested facets/i);
 assert.match(systemPrompt,/Treat every query as a retrieval lead, never as evidence/i);
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
 assert.match(systemPrompt,/requested definition, reason, evidence, or relation itself/i);
});
test('keeps planner query facets as returned without question-specific rewriting',async()=>{
 const cases=[
  {
   question:'According to Darwin, how does natural selection operate, and what roles do inherited variation and the struggle for existence play?',
   planned:[
    'Darwin On the Origin of Species natural selection operation',
    'Darwin On the Origin of Species inherited variation and struggle for existence'
   ]
  },
  {
   question:'What roles do habituation and practical reason play in developing virtue according to Aristotle?',
   planned:[
    'Aristotle repeated actions form virtue',
    'Aristotle habituation and practical reason developing virtue'
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
  assert.deepEqual(answer.queries,item.planned);
 }
});
test('cause-oriented planning keeps query design inside the planner response',async()=>{
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
 assert.match(systemPrompt,/Treat every query as a retrieval lead, never as evidence/i);
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
 assert.match(systemPrompt,/requested concept/i);
 assert.doesNotMatch(systemPrompt,/Kant on causal necessity|Second Analogy/i);
 assert.match(systemPrompt,/Search for the requested definition, reason, evidence, or relation itself/i);
 assert.match(systemPrompt,/each source for its own relevant position/i);
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
 assert.doesNotMatch(systemPrompt,/Hamlet with William Shakespeare/i);
 assert.match(systemPrompt,/distinguish their own text from commentary/i);
});

test('a play title absent from the catalog does not create a curated source alias',async()=>{
 const question='In Hamlet’s “To be, or not to be” soliloquy, what does he mean by “conscience makes cowards of us all”?';
 const planned={resolvedQuestion:question,intent:'interpret',sources:[],
  parts:['What does Hamlet mean by “conscience makes cowards of us all”?'],scope:'',
  queries:['Hamlet conscience makes cowards of us all thought fear action',
   'Hamlet soliloquy native hue resolution pale cast of thought']};
 const result=await planSearchQueries(question,'',{
  run:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(planned)}}]})
 });
 assert.deepEqual(result.plan.sources,[],
  'a play absent from standalone catalog titles should use generic retrieval');
 assert.equal(result.plan.parts[0].sourceBookIds,null,
  'no catalog source boundary should be added for the unlisted play');
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
 assert.match(systemPrompt,/Preserve the subject, named sources, exact requested concept, and textual scope/i);
});
test('technical concept definitions preserve the reader term and add source-native search vocabulary',async()=>{
 const question='What is sunyata?';
 const expected=['definition of sunyata in Buddhist philosophy',
  'Nagarjuna dependent arising emptiness'];
 let systemPrompt='';
 const result=await planSearchQueries(question,'',{
  run:async(_model,{messages})=>{
   systemPrompt=messages[0].content;
   return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
    resolvedQuestion:question,intent:'explain',parts:['What is sunyata?'],queries:expected
   })}}]};
  }
 });
 assert.match(systemPrompt,/Where the reader uses modern or abstract wording, add likely source wording/i);
 assert.deepEqual(result.queries,expected);
 assert.equal(result.plan.parts.length,1,
  'source-native search vocabulary must not become extra requested answer parts');
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
 assert.match(systemPrompt,/Resolve follow-up references only when conversation history makes them clear/i);
 assert.match(userPrompt,/Reader: According to Thucydides/);
 assert.match(userPrompt,/Assistant: Thucydides identifies the growth of Athenian power/);
 assert.match(userPrompt,/Current follow-up question: How does this account compare/);
});


test('broad philosophical planning keeps one direct question and permits relevant context',async()=>{
 let systemPrompt='',calls=0;
 const question='Are we living in a simulation?';
 const plan={
  resolvedQuestion:question,intent:'explain',
  sources:[{label:'René Descartes',role:'primary'},{label:'David Hume',role:'primary'}],
  parts:['What can be established about whether reality is computationally simulated?'],
  scope:'',queries:[
   'whether reality is a computational simulation',
   'Descartes dream argument external world skeptical doubt',
   'Hume external objects perception belief experience'
  ]
 };
 const result=await planSearchQueries(question,'',{
  run:async(_model,options)=>{
   calls++;
   systemPrompt=options.messages[0].content;
   return {choices:[{finish_reason:'stop',message:{content:JSON.stringify(plan)}}]};
  }
 });
 assert.equal(calls,1,'context discovery stays in the existing planner call');
 assert.equal(result.plan.parts.length,1,'context does not become extra required coverage');
 assert.equal(result.plan.parts[0].question,question,'a direct question remains the single required coverage goal');
 assert.equal(result.queries.length,3);
 assert.match(result.queries[0],/simulation/i,'retain a direct search for the actual question');
 assert.match(result.queries[1],/Descartes/i);
 assert.match(result.queries[2],/Hume/i);
 assert.match(systemPrompt,/Keep a single direct question as one part/i);
 assert.match(systemPrompt,/context is optional retrieval guidance/i);
 assert.match(systemPrompt,/do not spend every query on synonyms of that label/i);
 assert.match(systemPrompt,/underlying concepts, assumptions, or kinds of reasoning/i);
 assert.match(systemPrompt,/distinct from direct evidence for the contemporary claim/i);
 assert.doesNotMatch(systemPrompt,/Descartes|Berkeley|Hume/i);
});
test('the planner does not append a topic-specific query when its plan omits one',async()=>{
 const question='Are we living in a simulation?';
 const planned={resolvedQuestion:question,intent:'explain',
  parts:[question],queries:['are we living in a computational simulation',
   'computer simulation probability argument']};
 const result=await planSearchQueries(question,'',{
  run:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(planned)}}]})
 });
 assert.equal(result.queries.length,2);
 assert.match(result.queries[0],/simulation/i,'keep a direct search for the central question');
 assert.equal(result.queries[1],'computer simulation probability argument');
 assert.equal(result.plan.parts.length,1,'context stays a search lead, not a new answer obligation');
});

test('contextual-source guidance is general and does not hardcode simulation thinkers',async()=>{
 let systemPrompt='';
 await planSearchQueries('What is personal identity?', '', {
  run:async(_model,options)=>{
   systemPrompt=options.messages[0].content;
   return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({queries:[
    'personal identity continuity of consciousness memory',
   'personal identity self relation through time'
   ]})}}]};
  }
 });
 assert.match(systemPrompt,/add context sources only when they clearly help explain the central question/i);
 assert.match(systemPrompt,/do not spend every query on synonyms of that label/i);
 assert.match(systemPrompt,/underlying concepts, assumptions, or kinds of reasoning/i);
 assert.doesNotMatch(systemPrompt,/Descartes.*Berkeley.*Hume/i);
});
