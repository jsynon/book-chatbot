Warning: truncated output (original token count: 62433)
Total output lines: 3596

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import gateway,{handleRequest,validRequest,trustedSources,trustedPacketSources,verifiedFingerprintSources,parseReview,composeVerifiedAnswer,removeConflictingSpeakerAttributions,removeUnqualifiedCorrectedClaims,removeUncitedAuthorClaims,removeUnsupportedCrossWorkComparisonClaims,sourceExcerpt,turnstileRejection,inferenceFailureDiagnostics,answerPipelineFailureDiagnostics,workerVersionDiagnostics,PILOT_BOOKS,PILOT_BOOK_IDS,planSearchQueries} from './public-gateway.mjs';

const HOST='https://antilogicalism-companion-public.example.workers.dev';
const PDF='LegitimatePdfIdentifier0123456789';
const manifest={version:47,books:{152:{title:'History of the Peloponnesian War — Thucydides',
  drive_url:'https://drive.google.com/file/d/'+PDF+'/view'}},
  page_books:[152,152]};
const pages={pages:[
  {id:0,page:38,text:'The immediate disputes involved the dissolution of the truce. The real cause was a growth of power and alarm among rival cities. This was considered inevitable.'},
  {id:1,page:39,text:'Corcyra and Epidamnus were mentioned in the immediate controversy, and ambassadors gave conflicting accounts. The disputing sides appealed to allies.'}
]};
const question='What were the immediate and underlying causes of war?';
const payload={question,turnstileToken:'one-time-challenge',sources:[{bookId:'152',page:38}]};
function fetcher(url,init={}){
 if(String(url).endsWith('siteverify')){
   const params=new URLSearchParams(init.body);
   return Promise.resolve(Response.json({
     success:params.get('response')==='one-time-challenge',
     hostname:'jsynon.github.io',action:'companion_ask',
   }));
 }
 const file=String(url).split('/').pop();
 const map={'manifest.json.gz':manifest,'book-152.json.gz':pages};
 if(!map[file])return Promise.resolve(new Response('missing',{status:404}));
 return Promise.resolve(new Response(gzipSync(JSON.stringify(map[file])),{status:200}));
}
function request(data=payload,origin='https://jsynon.github.io',headers={}){
 return new Request(HOST+'/api/answer',{method:'POST',
  headers:{Origin:origin,'CF-Connecting-IP':'198.51.100.42',
    'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
}
function env(overrides={}){
 let calls=0;
 return {PUBLIC_ENABLED:'true',TURNSTILE_SECRET:'not-a-real-secret',
  AI_RATE_LIMITER:{limit:async()=>({success:true})},
  GLOBAL_RATE_LIMITER:{limit:async()=>({success:true})},
  AI:{run:async(_model,input)=>{
    calls++;
    const msg=input.max_completion_tokens===280?
      JSON.stringify({coverage:'partial',missing:'Another account would help',evidence:[{id:'S1',point:'Relevant supported passage point.'}]})
      :'The source explains a truce dispute and concern about growing power [S1].';
    return {choices:[{finish_reason:'stop',message:{content:msg}}],usage:{neurons:6}};
  }},...overrides};
}
test('inference failure diagnostics classify provider errors without exposing raw exception text',()=>{
 const error=new Error('rate limit for token=private-token; prompt=private question');
 error.status=429;
 error.code='rate_limit';
 const details=inferenceFailureDiagnostics(error);
 assert.deepEqual(details,{
  providerClass:'rate-limited',providerErrorType:'object',providerErrorName:'Error',
  providerErrorFields:['name','message','status','code'],
  providerStatus:429,providerCode:'rate_limit',
 });
 assert.equal(JSON.stringify(details).includes('private-token'),false);
 assert.equal(JSON.stringify(details).includes('private question'),false);
 const unknown=inferenceFailureDiagnostics(new Error('private provider response body'));
 assert.deepEqual(unknown,{
  providerClass:'unknown',providerErrorType:'object',providerErrorName:'Error',
  providerErrorFields:['name','message'],
 });
 assert.equal(JSON.stringify(unknown).includes('private provider response body'),false);
 const nested=new Error('request failed',{cause:Object.assign(new Error('deadline exceeded'),{status:408})});
 const nestedDetails=inferenceFailureDiagnostics(nested);
 assert.equal(nestedDetails.providerClass,'timeout');
 assert.equal(nestedDetails.providerStatus,408);
 assert.equal(nestedDetails.providerErrorFields.includes('cause.status'),true);
 assert.equal(JSON.stringify(nestedDetails).includes('deadline exceeded'),false);
 const gatewayError=inferenceFailureDiagnostics(
  new Error('upstream returned 502 Bad Gateway; token=private-token; prompt=private question'));
 assert.equal(gatewayError.providerClass,'provider-server-error');
 assert.equal(JSON.stringify(gatewayError).includes('private-token'),false);
 assert.equal(JSON.stringify(gatewayError).includes('private question'),false);
 const networkError=inferenceFailureDiagnostics(new Error('fetch failed: ECONNRESET'));
 assert.equal(networkError.providerClass,'network-error');
 const quotaError=inferenceFailureDiagnostics({name:'Error',message:
  'You have used up your daily free allocation of 10,000 Neurons.'});
 assert.equal(quotaError.providerClass,'daily-free-allocation');
 assert.equal(JSON.stringify(quotaError).includes('10,000 Neurons'),false);
 const quotaCode=inferenceFailureDiagnostics({name:'AIError',code:3036,message:'request failed'});
 assert.equal(quotaCode.providerClass,'daily-free-allocation');
 assert.equal(quotaCode.providerCode,'3036');
 assert.equal(inferenceFailureDiagnostics({name:'Error',message:'request quota exceeded'}).providerClass,
  'provider-usage-limit');
 assert.equal(inferenceFailureDiagnostics({name:'Error',message:'credits exhausted'}).providerClass,
  'credit-limit');
 assert.equal(inferenceFailureDiagnostics({name:'Error',status:429,
  message:'daily AI usage limit reached'}).providerClass,'provider-usage-limit');
 const capacityError=inferenceFailureDiagnostics({name:'Error',status:429,code:3040,
  message:'Capacity temporarily exceeded, please try again.'});
 assert.equal(capacityError.providerClass,'capacity-unavailable');
 assert.equal(capacityError.providerCode,'3040');
});

test('unexpected answer-pipeline errors retain a safe stage and failure class',()=>{
 const error=new TypeError('private provider body and passage text');
 error.stack='TypeError: private provider body and passage text\n'+
  '    at compose (public-gateway.mjs:123:45)\n'+
  '    at fetch (https://private.example/worker.js:9:11)';
 const details=answerPipelineFailureDiagnostics(error);
 assert.equal(details.stage,'answer-pipeline');
 assert.equal(details.providerClass,'unknown');
 assert.equal(details.providerErrorName,'TypeError');
 assert.deepEqual(details.errorFrameLocations,['public-gateway.mjs:123:45','worker.js:9:11']);
 assert.equal(JSON.stringify(details).includes('private provider body'),false);
 assert.equal(JSON.stringify(details).includes('passage text'),false);
 assert.equal(JSON.stringify(details).includes('private.example'),false);
 const known=new Error('answer-depth-repair-request-failed');
 known.diagnostics={stage:'answer-depth-repair',providerClass:'timeout',providerStatus:408};
 const knownDetails=answerPipelineFailureDiagnostics(known);
 assert.equal(knownDetails.stage,'answer-depth-repair');
 assert.equal(knownDetails.providerClass,'timeout');
 assert.equal(knownDetails.providerStatus,408);
});

test('public endpoint fails closed by default and does not call AI',async()=>{
 let touched=0;
 const e=env({PUBLIC_ENABLED:'false',AI:{run:async()=>{touched++;}}});
 const response=await handleRequest(request(),e,fetcher);
 assert.equal(response.status,503);assert.equal(touched,0);
});
test('rejects missing rate limiter even when PUBLIC_ENABLED=true',async()=>{
 const response=await handleRequest(request(),env({GLOBAL_RATE_LIMITER:undefined}),fetcher);
 assert.equal(response.status,503);
});
test('strict browser origin and missing connecting identity rejected',async()=>{
 assert.equal((await handleRequest(request(payload,'https://malicious.invalid'),env(),fetcher)).status,403);
 assert.equal((await handleRequest(request(payload,'https://jsynon.github.io',{'CF-Connecting-IP':''}),env(),fetcher)).status,403);
});
test('rate limiter rejects requests before Turnstile or AI is called',async()=>{
 let external=0;
 const response=await handleRequest(request(),env({
 AI_RATE_LIMITER:{limit:async()=>({success:false})}
 }),()=>{external++;throw Error('Must not fetch');});
 assert.equal(response.status,429);assert.equal(external,0);
});
test('request format contains only locators, not client-supplied evidence',()=>{
 assert.equal(validRequest(payload),true);
 assert.equal(validRequest({...payload,sources:[{bookId:'../../152',page:38}]}),false);
 assert.equal(validRequest({...payload,sources:[{bookId:'152',page:38},{bookId:'152',page:38}]}),false);
 assert.equal(validRequest({...payload,sources:[{bookId:'152',page:38},{bookId:'7',page:2},{bookId:'9',page:8}]}),false);
});
test('Turnstile denial prevents any trusted corpus retrieval and AI',async()=>{
 let corpus=0;
 const bad={...payload,turnstileToken:'invalid'};
 const result=await handleRequest(request(bad),env(),(url,opts)=>{if(String(url).includes('data-v47'))corpus++;return fetcher(url,opts);});
 assert.equal(result.status,403);assert.equal(corpus,0);
});
test('trusted corpus provides the page content and PDF link, not untrusted client fields',async()=>{
 const sources=await trustedSources(question,payload.sources,fetcher);
 assert.equal(sources.length,1);assert.equal(sources[0].page,38);
 assert(sources[0].preview.includes('real cause'));
 assert(sources[0].url.endsWith('#page=38'));
 assert(sources[0].url.includes(PDF));
});
test('refuses forged PDF page/book locators not supported by official manifest',async()=>{
 await assert.rejects(trustedSources(question,[{bookId:'152',page:900}],fetcher),/Page not found/);
 await assert.rejects(trustedSources(question,[{bookId:'44',page:38}],fetcher),/Unknown cited book/);
});
test('truncated evidence-gap notes end at a complete sentence',()=>{
 const source=[{id:'S1'}];
 const complete='The passages do not define the event horizon.';
 const clipped=complete+' An unfinished explanation '.repeat(20);
 const review=parseReview(JSON.stringify({coverage:'partial',missing:clipped,evidence:[{id:'S1',point:'Relevant supported passage point.'}]}),source);
 assert.equal(review.missing,complete);
 const noSentence=parseReview(JSON.stringify({coverage:'partial',missing:'unfinished clause only',evidence:[{id:'S1',point:'Relevant supported passage point.'}]}),source);
 assert.equal(noSentence.missing,'');
});

test('multi-source evidence review calls out each named group in normal and retry prompts',async()=>{
 const question='How do Darwin in On the Origin of Species and Hawking in A Brief History of Time distinguish evidence?';
 const sources=[
  {id:'S1',bookId:'529',title:'The Harvard Classics, Volume 11: On the Origin of Species — Charles Darwin',page:96,preview:'Darwin describes the variation of species.'},
  {id:'S2',bookId:'102',title:'A Brief History of Time — Stephen Hawking',page:48,preview:'Hawking distinguishes models from observations.'}
 ];
 const prompts=[];
 let call=0;
 const ai={run:async(_model,input)=>{
   prompts.push(input.messages[0].content);
   call++;
   if(call===1)return {choices:[{finish_reason:'length',message:{content:''}}]};
   if(call===2)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
     coverage:'full',missing:'',evidence:[{id:'S1',point:'Relevant supported passage point.'},{id:'S2',point:'Relevant supported passage point.'}]
   })}}]};
   throw new Error('stop after capturing the review prompts');
 }};
 await assert.rejects(composeVerifiedAnswer(question,sources,ai),error=>
   error?.failureCode==='answer-composition-request-failed');
 assert.equal(prompts.length,3);
 for(const prompt of prompts.slice(0,2)){
   assert.match(prompt,/directly relevant evidence for a group/);
   assert.match(prompt,/complementary passages/);
   assert(prompt.includes('On the Origin of Species [S1]'));
   assert(prompt.includes('A Brief History of Time [S2]'));
   assert.match(prompt,/synthesize their difference while attributing each claim to its source/);
 }
 assert.match(prompts[0],/For each side, the passage must address the exact issue asked about/);
 assert.match(prompts[0],/reports, quotes, or criticizes the other thinker/);
});
test('causal comparison can draw on complementary passages from the same work',async()=>{
 const question='According to Thucydides, what were the underlying causes of the Peloponnesian War, and how did they differ from the immediate disputes that preceded it?';
 const sources=[
  {id:'S1',bookId:'152',title:'History of the Peloponnesian War — Thucydides',page:38,
   preview:'The real cause was the growth of the power of Athens and the alarm which this inspired in Lacedaemon. The grounds alleged by either side led to the breaking out of the war.'},
  {id:'S2',bookId:'152',title:'History of the Peloponnesian War — Thucydides',page:59,
   preview:'Corcyra and Corinth fought; Athens aided the Corcyraeans. Soon afterward, Athens ordered Potidaea to raze its wall and dismiss its Corinthian magistrates.'}
 ];
 const inputs=[];let call=0;
 const ai={run:async(_model,input)=>{
  inputs.push(input);call++;
  if(call===1)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   coverage:'full',missing:'',
   questionParts:[
    {part:'underlying causes',status:'supported',evidenceIds:['S1']},
    {part:'immediate disputes',status:'supported',evidenceIds:['S2']}
   ],
   evidence:[
    {id:'S1',point:'Thucydides distinguishes the underlying cause from the grounds alleged by either side.',quote:'The real cause was the growth of the power of Athens',speaker:'Thucydides',qualifier:''},
    {id:'S2',point:'The Corcyra and Potidaea disputes were immediate disputes preceding the war.',quote:'Athens ordered Potidaea to raze its wall',speaker:'Thucydides',qualifier:''}
   ]
  })}}]};
  return {choices:[{finish_reason:'stop',message:{content:
   'Thucydides identifies the growth of Athenian power and the fear it caused in Sparta as the underlying cause, while treating the stated grievances as the immediate grounds for war [S1]. The Corcyra and Potidaea disputes were among those immediate conflicts [S2].'}}]};
 }};
 const result=await composeVerifiedAnswer(question,sources,ai);
 assert.equal(result.outcome,'verified-source-draft');
 assert.deepEqual(result.citations.map(source=>source.id),['S1','S2']);
 assert.match(inputs[0].messages[0].content,/do not require one passage to establish the whole relation/);
 assert.match(inputs[1].messages[0].content,/Complementary passages may support separate sides of a comparison or causal account/);
});
test('an unspecified Bible edition can support the requested verse range alongside commentary',async()=>{
 const question='According to 1 John 4:7–12, what does “God is love” mean, and how does the passage connect God’s love with loving one another? Also, what does the Oxford Annotated Bible commentary say about this passage?';
 const sources=[
  {id:'S1',bookId:'335',title:'New King James Version Bible — Various authors',page:5546,
   preview:'1 JOHN 4 7 Beloved, let us love one another, for love is of God; and everyone who loves is born of God and knows God. 8 He who does not love does not know God, for God is love. 9 In this the love of God was manifested toward us, that God has sent His only begotten Son into the world, that we might live through Him. 10 In this is love, not that we loved God, but that He loved us and sent His Son for our sins. 11 Beloved, if God so loved us, we also ought to love one another. 12 If we love one another, God abides in us, and His love has been perfected in us.'},
  {id:'S2',bookId:'638',title:'The New Oxford Annotated Bible, Fully Revised Fifth Edition — edited by Michael D. Coogan',page:1821,
   preview:'4. 7–21: God’s love as the basis of salvation. 7–9: Believers are to imitate the love God has shown in sending the Son to give life. 10–12: God’s love is the basis of the love command.'}
 ];
 const inputs=[];let call=0;
 const ai={run:async(_model,input)=>{
  inputs.push(input);call++;
  if(call===1)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   coverage:'full',missing:'',
   questionParts:[
    {part:'meaning of God is love',status:'supported',evidenceIds:['S1','S2']},
    {part:'connection to loving one another',status:'supported',evidenceIds:['S1','S2']}
   ],
   evidence:[
    {id:'S1',point:'The passage grounds love in God’s prior love shown by sending the Son and commands believers to love one another.',quote:'for God is love',speaker:'The letter',qualifier:''},
    {id:'S2',point:'The Oxford notes say God’s love is the basis of the love command.',quote:'God’s love is the basis of the love command',speaker:'Oxford Annotated Bible note',qualifier:''}
   ]
  })}}]};
  return {choices:[{finish_reason:'stop',message:{content:
   'In 1 John 4:7–12, “God is love” means that love is grounded in God’s own nature and shown in sending the Son so that people may live [S1]. The passage then makes that prior divine love the basis of an obligation: believers ought to love one another, and their mutual love is described as God abiding in them [S1]. The Oxford note summarizes the same link as God’s love being the basis of the love command [S2].'}}]};
 }};
 const result=await composeVerifiedAnswer(question,sources,ai);
 assert.equal(result.outcome,'verified-source-draft');
 assert.deepEqual(result.citations.map(source=>source.id),['S1','S2']);
 assert.match(inputs[0].messages[0].content,/a parallel edition of the same work and passage is in scope/);
 assert.match(inputs[1].messages[0].content,/a parallel edition of the same work and passage is in scope/);
 assert.match(inputs[1].messages[0].content,/Keep commentary separate from primary text/);
});
test('a scoped Bible answer is composed only from the requested verses',async()=>{
 const question='According to 1 John 4:7–12, what does “God is love” mean, and how does the passage connect God’s love with loving one another?';
 const sources=[
  {id:'S1',bookId:'335',title:'New King James Version Bible — Various authors',page:5546,
   preview:'1 JOHN 4           13\n 7 Beloved, let us love one another, for love is of God; and everyone who loves is born of God and knows God.\n 8 He who does not love does not know God, for God is love.\n 9 In this the love of God was manifested toward us, that God has sent His only begotten Son into the world, that we might live through Him.\n 10 In this is love, not that we loved God, but that He loved us and sent His Son to be the propitiation for our sins.\n 11 Beloved, if God so loved us, we also ought to love one another.\n 12 No one has seen God at any time. If we love one another, God abides in us, and His love has been perfected in us.\n 13 By this we know that we abide in Him, and He in us, because He has given us of His Spirit.'},
  {id:'S2',bookId:'335',title:'New King James Version Bible — Various authors',page:5547,
   preview:'1 JOHN 4           14\n 14 And we have seen and testify that the Father has sent the Son as Savior of the world.\n 15 Whoever confesses that Jesus is the Son of God, God abides in him, and he in God.\n 16 And we have known and believed the love that God has for us. God is love, and he who abides in love abides in God, and God in him.'},
  {id:'S3',bookId:'335',title:'New King James Version Bible — Various authors',page:5548,
   preview:'1 JOHN 4–5         15\n 21 And this commandment we have from Him: that he who loves God must love his brother also.'},
  {id:'S4',bookId:'367',title:'Nicene and Post-Nicene Fathers, First Series, Volume III — Edited by Philip Schaff',page:288,
   preview:'And yet he seems to have passed by the love of God in silence; which he never would have done, unless because he intends God to be understood in brotherly love itself.'},
  {id:'S5',bookId:'638',title:'The New Oxford Annotated Bible, Fully Revised Fifth Edition — edited by Michael D. Coogan',page:1817,
   preview:'Christians are reminded that their obligation to love one another is grounded in God’s nature as love (4.7–12).'},
  {id:'S6',bookId:'638',title:'The New Oxford Annotated Bible, Fully Revised Fifth Edition — edited by Michael D. Coogan',page:1821,
   preview:'…10 In this is love, not that we loved God, but that he loved us and sent his Son to be the atoning sacrifice for our sins. 11 Beloved, since God loved us, we also ought to love one another.'},
  {id:'S7',bookId:'638',title:'The New Oxford Annotated Bible, Fully Revised Fifth Edition — edited by Michael D. Coogan',page:1821,
   preview:'1 JOHN 4\n18 Little children, let us love, not in word or speech, but in truth and action.\n 7 Beloved, let us love one another, because love is from God.\n19 And by this we will know that we are from the truth and will reassure our hearts before him.\n 8 Whoever does not love does not know God, for God is love.\n20 Whenever our hearts condemn us; for God is greater than our hearts.'},
  {id:'S8',bookId:'335',title:'New King James Version Bible — Various authors',page:5542,
   preview:'1 JOHN 3 9 7 Little children, let no one deceive you. He who does not love his brother is not of God.'},
  {id:'S9',bookId:'335',title:'New King James Version Bible — Various authors',page:5543,
   preview:'7 Beloved, let us love one another, for love is of God; and everyone who loves is born of God.'}
 ];
 const inputs=[];let call=0;
 const ai={run:async(_model,input)=>{
  inputs.push(input);call++;
  if(call===1)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   coverage:'full',missing:'',
   questionParts:[
    {part:'meaning of God is love',status:'supported',evidenceIds:['S1']},
    {part:'connection with loving one another',status:'supported',evidenceIds:['S1']}
   ],
   evidence:[
    {id:'S1',point:'Love comes from God, and those who love are born of God and know God.',quote:'and everyone who loves is born of God and knows God',speaker:'unknown',qualifier:''},
    {id:'S1',point:'God loved us by sending the Son, so believers ought to love one another.',quote:'if God so loved us, we also ought to love one another',speaker:'unknown',qualifier:''},
    {id:'S1',point:'When believers love one another, God abides in them and His love is perfected.',quote:'If we love one another, God abides in us, and His love has been perfected in us.',speaker:'unknown',qualifier:''}
   ]
  })}}]};
  return {choices:[{finish_reason:'stop',message:{content:
   'In 1 John 4:7–12, “God is love” is linked to the claim that love comes from God: those who love are born of God and know God, while the one who does not love does not know God [S1]. The passage illustrates this claim through God’s act of sending the Son so that people might live through him [S1]. It adds that love began with God’s action toward humanity, not with humanity loving God first [S1]. This makes the phrase more than an abstract description: the passage explains it through what God does and the life that action makes possible [S1].\n\nThat prior act grounds the obligation to love one another: “if God so loved us,” believers “also ought to love one another” [S1]. The passage then describes a consequence of mutual love: God abides in those who love one another [S1]. It concludes that God’s love is perfected in them, connecting their conduct with the continuing presence of divine love [S1]. In this way, the passage moves from God’s initiating love, to the community’s response, to the sign of God’s presence among them [S1].'}}]};
 }};
 const result=await composeVerifiedAnswer(question,sources,ai);
 assert.equal(call,2);
 assert.equal(result.coverage,'full');
 assert.deepEqual(result.citations.map(source=>source.id),['S1']);
 assert.match(inputs[0].messages[1].content,/7 Beloved, let us love one another/);
 assert.match(inputs[0].messages[1].content,/12 No one has seen God/);
 assert.match(inputs[0].messages[1].content,/10 In this is love/);
 assert.match(inputs[0].messages[1].content,/propitiation for our sins/);
 assert.match(inputs[1].messages[0].content,/Answer each requested part directly/);
 assert.match(inputs[1].messages[0].content,/Develop the explanation with relevant reasons/);
 assert.match(inputs[1].messages[0].content,/let answer length follow the evidence/);
 assert.doesNotMatch(inputs[0].messages[1].content,/Christians are reminded that their obligation/);
 assert.doesNotMatch(inputs[0].messages[1].content,/truth and action/);
 assert.doesNotMatch(inputs[0].messages[1].content,/will reassure our hearts before him/);
 assert.doesNotMatch(inputs[0].messages[1].content,/13 By this we know/);
 assert.doesNotMatch(inputs[0].messages[1].content,/16 And we have known/);
 assert.doesNotMatch(inputs[0].messages[1].content,/21 And this commandment/);
 assert.doesNotMatch(inputs[0].messages[1].content,/1 JOHN 3 9 7 Little children/);
 assert.doesNotMatch(inputs[0].messages[1].content,/\[S9\]/);
 assert.doesNotMatch(inputs[0].messages[1].content,/brotherly love itself/);
 assert.doesNotMatch(result.answer,/brother must love|abides in God/);
 assert.equal(result.answer.split('\n\n').length,2);
 assert(result.answer.split('\n\n').every(paragraph=>(paragraph.match(/[.!?](?:\s|$)/g)||[]).length>=3));
});
test('evidence review can select a supported point when it cannot safely copy an exact quote',async()=>{
 const question='How does Darwin explain natural selection?';
 const sources=[{id:'S1',bookId:'529',title:'On the Origin of Species — Charles Darwin',page:96,
  preview:'Natural selection preserves favorable variations across generations.'}];
 const inputs=[];let call=0;
 const ai={run:async(_model,input)=>{
  inputs.push(input);call++;
  if(call===1)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   coverage:'full',missing:'',questionParts:[{part:'explain natural selection',status:'supported',evidenceIds:['S1']}],
   evidence:[{id:'S1',point:'Natural selection preserves favorable variations across generations.',quote:'',speaker:'unknown',qualifier:''}]
  })}}],usage:{neurons:2}};
  assert.match(input.messages[0].content,/verify each point against the full excerpt/);
  return {choices:[{finish_reason:'stop',message:{content:
   'Darwin describes natural selection as preserving favorable variations across generations [S1].'}}],usage:{neurons:3}};
 }};
 const result=await composeVerifiedAnswer(question,sources,ai);
 assert.equal(result.outcome,'verified-source-draft');
 assert.equal(result.evidenceMap[0].quoteVerified,false);
 assert.match(inputs[0].messages[0].content,/Do not mark coverage none solely because an exact quote or qualifier is unavailable/);
 assert.match(inputs[1].messages[0].content,/Use the evidence map as a guide/);
});
test('same-book answers select complementary passages and synthesize every question part',async()=>{
 const question='How does Aristotle explain habituation, and how do repeated actions shape character?';
 const sources=[
  {id:'S1',bookId:'7',title:'Nicomachean Ethics — Aristotle',page:14,
   preview:'We become just by doing just acts, temperate by doing temperate acts, and brave by doing brave acts.'},
  {id:'S2',bookId:'7',title:'Nicomachean Ethics — Aristotle',page:13,
   preview:'The virtues arise in us neither by nature nor against nature; we are adapted by nature to receive them and are made perfect by habit.'}
 ];
 const inputs=[];let call=0;
 const ai={run:async(_model,input)=>{
   inputs.push(input);call++;
   if(call===1)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
     coverage:'full',missing:'',questionParts:[
       {part:'explain habituation',status:'supported',evidenceIds:['S2']},
       {part:'explain how repeated actions shape character',status:'supported',evidenceIds:['S1']}
      ],evidence:[{id:'S1',point:'Relevant supported passage point.'},{id:'S2',point:'Relevant supported passage point.'}]
   })}}],usage:{neurons:3}};
   return {choices:[{finish_reason:'stop',message:{content:
     'Aristotle says character is formed through habituation: people become just or brave by repeatedly doing the relevant kinds of acts [S1]. This process depends on practice rather than being born with a completed virtue. We have a natural capacity to receive virtues, but habit brings that capacity to completion [S2]. Together, the passages show how repeated conduct shapes a settled character.'}}],usage:{neurons:4}};
 }};
 const result=await composeVerifiedAnswer(question,sources,ai);
 assert.equal(inputs.length,2);
 assert.match(inputs[0].messages[0].content,/up to six distinct passages, including passages from the same book/);
 assert.match(inputs[1].messages[0].content,/Answer each requested part directly/);
 assert.match(inputs[1].messages[0].content,/Answer each requested part directly/);
 assert.match(inputs[1].messages[0].content,/Develop the explanation/);
 assert.match(inputs[1].messages[0].content,/Answer each requested part directly/);
 assert.match(inputs[1].messages[0].content,/let answer length follow the evidence/);
 assert.match(inputs[1].messages[0].content,/Answer each requested part directly/);
 assert.match(inputs[1].messages[0].content,/let answer length follow the evidence/);
 assert.match(inputs[1].messages[0].content,/Develop the explanation/);
 assert.match(inputs[1].messages[0].content,/let answer length follow the evidence/);
 assert.match(inputs[1].messages[0].content,/let answer length follow the evidence/);
 assert.match(inputs[1].messages[0].content,/Open with the direct answer/);
 assert.match(inputs[1].messages[0].content,/brief reliable general context/);
 assert.match(inputs[1].messages[0].content,/Label reader synthesis or reliable broader context clearly/);
 assert.match(inputs[1].messages[0].content,/cite each source-based sentence/);
 assert.match(inputs[1].messages[0].content,/Develop the explanation with relevant reasons/);
 assert.match(inputs[1].messages[0].content,/Complementary passages may support separate sides of a comparison or causal account/);
 assert.match(inputs[1].messages[0].content,/Do not treat two passages from one author as independent perspectives/);
 assert.match(inputs[1].messages[0].content,/do not pad or repeat/);
 assert.match(inputs[1].messages[0].content,/relevant reasons, distinctions/);
 assert.match(inputs[1].messages[0].content,/let answer length follow the evidence/);
 assert.match(inputs[1].messages[0].content,/Complementary passages may support separate sides/);
 assert.match(inputs[1].messages[0].content,/Answer each requested part directly/);
 assert.match(inputs[1].messages[0].content,/using the passage that most directly answers it/);
 assert.match(inputs[1].messages[0].content,/do not substitute related background, motives, or consequences/);
 assert.equal(inputs[1].max_completion_tokens,1600);
 assert.equal(result.coverage,'full');
 assert.deepEqual(result.citations.map(source=>source.id),['S1','S2']);
});
test('all-books planner assigns a named-work query to each side of a cross-work question',async()=>{
 const question="How does Darwin explain natural selection preserving favorable variations in On the Origin of Species, and how does Hawking use astronomical observations to support an explanation of black-hole phenomena in A Brief History of Time?";
 let prompt='';
 const ai={run:async(_model,input)=>{
   prompt=input.messages[0].content;
   return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
     queries:[
       'Darwin natural selection inherited variation survival',
       'Darwin origin species variation struggle for existence'
     ]
   })}}]};
 }};
 const result=await planSearchQueries(question,'',ai);
 assert.match(prompt,/assign one query to each named source group/);
 assert.match(prompt,/concrete observable signal, measurement, motion, or named example/);
 assert.match(prompt,/Do not substitute a general statement that models can be compared with observations/);
 assert.match(result.queries[0],/On the Origin of Species/i);
 assert.match(result.queries[0],/natural selection|favorable variations/i);
 assert.match(result.queries[1],/A Brief History of Time/i);
 assert.doesNotMatch(result.queries[1],/On the Origin of Species/i);
 assert.match(result.queries[1],/astronomical observations|black-hole phenomena/i);
});

test('all-books author comparison preserves useful expanded facets when both names are assigned',async()=>{
 const question="what's the difference between the thought of kierkegaard and shestov?";
 const expected=[
  'Kierkegaard faith paradox individual relation to God',
  'Shestov rational necessity freedom creative thought'
 ];
 const ai={run:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({queries:expected})}}]})};
 const result=await planSearchQueries(question,'',ai);
 assert.deepEqual(result.queries,expected);
});

test('selected-book planner preserves its own scope and model queries',async()=>{
 const question="How does Aristotle's Nicomachean Ethics explain virtue, and how does Hobbes's Leviathan explain political order?";
 const expected=['Nicomachean Ethics virtue habit','Nicomachean Ethics political science human good'];
 const ai={run:async(_model,input)=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({queries:expected})}}]})};
 const result=await planSearchQueries(question,'Nicomachean Ethics — Aristotle',ai);
 assert.deepEqual(result.queries,expected);
});

test('planner preserves an explicit verse range in both complementary searches',async()=>{
 const question='According to 1 John 4:7–12, what does “God is love” mean, and how does the passage connect God’s love with loving one another?';
 let plannerPrompt='';
 const ai={run:async(_model,input)=>{
  plannerPrompt=input.messages[0].content;
  return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({queries:[
   'definition of God is love in 1 John 4:7-12',
   'how Gods love necessitates loving one another 1 John 4'
  ]})}}]};
 }};
 const result=await planSearchQueries(question,'New King James Version Bible — Various authors',ai);
 assert.match(plannerPrompt,/keep the full book, chapter, and verse range in BOTH queries/);
 assert.match(result.queries[0],/1 John 4:7-12/);
 assert.match(result.queries[1],/1 John 4:7-12/);
 assert.match(result.queries[1],/necessitates loving one another/);
});

test('all-books scripture references keep Bible search context and the exact verse range',async()=>{
 const question='According to James 2:14–26, how does James relate faith to works, and what do Abraham and Rahab illustrate?';
 const ai={run:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({queries:[
  'James 2:14-26 faith without works dead',
  'James 2:14-26 Abraham Rahab examples'
 ]})}}]})};
 const result=await planSearchQueries(question,'',ai);
 assert.equal(result.queries.length,2);
 for(const query of result.queries){
  assert.match(query,/James 2:14-26/i);
  assert.match(query,/\bBible\b/i);
 }
 assert.match(result.queries[0],/faith without works dead/i);
 assert.match(result.queries[1],/Abraham Rahab examples/i);
});

test('all-books planner does not label non-scriptural chapter-and-verse references as Bible searches',async()=>{
 const question='According to Hamlet 3:1, how does the speaker describe the choice before him?';
 const ai={run:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({queries:[
  'Hamlet 3:1 choice before him',
  'Hamlet 3:1 speaker describes alternatives'
 ]})}}]})};
 const result=await planSearchQueries(question,'',ai);
 assert.ok(result.queries.every(query=>! /\bBible\b/i.test(query)));
});

test('planner keeps three distinct requested components as three targeted searches',async()=>{
 const question="According to Darwin's On the Origin of Species, how does natural selection operate, and what roles do inherited variation and the struggle for existence play?";
 const expected=[
  'On the Origin of Species natural selection preserves advantageous variation',
  'On the Origin of Species offspring inherit favorable variations',
  'On the Origin of Species struggle for existence more offspring than survive'
 ];
 let prompt='';
 const ai={run:async(_model,input)=>{
  prompt=input.messages[0].content;
  return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({queries:expected})}}]};
 }};
 const result=await planSearchQueries(question,'',ai);
 assert.match(prompt,/two to four different, concise search phrases/);
 assert.match(prompt,/Use one query per distinct component/);
 assert.deepEqual(result.queries,expected);
});

test('planner rejects more than four facets and duplicate facets',async()=>{
 const question='Explain the causes, events, results, and legacy of this conflict.';
 for(const queries of [
  ['facet one conflict cause','facet two conflict events','facet three conflict results','facet four conflict legacy','facet five conflict details'],
  ['same conflict facet phrase','same conflict facet phrase']
 ]){
  const ai={run:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({queries})}}]})};
  await assert.rejects(()=>planSearchQueries(question,'',ai),/Invalid search plan|Duplicate search queries/);
 }
});

test('multi-work full coverage requires selected evidence from every named work group',()=>{
 const question='How do Darwin in On the Origin of Species and Hawking in A Brief History of Time explain change?';
 const sources=[
  {id:'S1',bookId:'529',title:'The Harvard Classics, Volume 11: On the Origin of Species — Charles Darwin',preview:'Natural selection preserves useful variation.'},
  {id:'S2',bookId:'102',title:'A Brief History of Time — Stephen Hawking',preview:'Black holes have an event horizon.'}
 ];
 const hawkingOnly=parseReview(JSON.stringify({coverage:'full',missing:'',evidence:[{id:'S2',point:'Relevant supported passage point.'}]}),sources,question);
 assert.equal(hawkingOnly.coverage,'partial');
 assert.match(hawkingOnly.missing,/Origin of Species/);
 const both=parseReview(JSON.stringify({coverage:'full',missing:'',evidence:[{id:'S1',point:'Relevant supported passage point.'},{id:'S2',point:'Relevant supported passage point.'}]}),sources,question);
 assert.equal(both.coverage,'full');
 assert.equal(both.missing,'');
});
test('repairs an omitted but retrieved named-work passage before claiming it has no information',async()=>{
 const question='How does Darwin explain natural selection preserving favorable variations in On the Origin of Species, and how does Hawking use astronomical observations to explain black-hole phenomena in A Brief History of Time?';
 const sources=[
  {id:'S1',bookId:'529',title:'The Harvard Classics, Volume 11: On the Origin of Species — Charles Darwin',page:96,
   preview:'Darwin explains that natural selection preserves favorable individual variations.'},
  {id:'S2',bookId:'102',title:'A Brief History of Time — Stephen Hawking',page:58,
   preview:'Hawking notes an observed gamma-ray background and compares its intensity at different frequencies while discussing radiation from primordial black holes.'}
 ];
 const labels=[
  "Darwin's explanation of natural selection preserving favorable variations",
  "Hawking's use of astronomical observations to explain black-hole phenomena"
 ];
 const inputs=[];
 const ai={run:async(_model,input)=>{
  inputs.push(input);
  if(inputs.length===1)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   coverage:'partial',missing:'Hawking evidence was not selected.',
   questionParts:[
    {part:labels[0],status:'supported',evidenceIds:['S1']},
    {part:labels[1],status:'unsupported',evidenceIds:[]}
   ],
   evidence:[{id:'S1',point:'Darwin describes natural selection preserving favorable variation.'}]
  })}}]};
  if(inputs.length===2)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   answer:'Darwin says natural selection preserves favorable variations [S1]. The provided text contains no information about Hawking or astronomical observations.',
   partChecks:[
    {part:labels[0],status:'supported',evidenceIds:['S1']},
    {part:labels[1],status:'unsupported',evidenceIds:[]}
   ]
  })}}]};
  assert.equal(inputs.length,3);
  assert.match(input.messages[0].content,/Re-read all verified excerpts/);
  assert.match(input.messages[1].content,/page 58/);
  return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   answer:'Darwin explains that natural selection preserves favorable variations [S1]. Hawking discusses whether primordial black holes could be observed through their radiation. He points to an observed gamma-ray background and compares its intensity across frequencies, using that observation to assess the proposed black-hole explanation [S2].',
   partChecks:[
    {part:labels[0],status:'supported',evidenceIds:['S1']},
    {part:labels[1],status:'supported',evidenceIds:['S2']}
   ]
  })}}]};
 }};
 const result=await composeVerifiedAnswer(question,sources,ai);
 assert.equal(inputs.length,3);
 assert.equal(result.coverage,'full');
 assert.deepEqual(result.questionParts.map(part=>part.status),['supported','supported']);
 assert.deepEqual(result.citations.map(source=>source.id),['S1','S2']);
 assert.match(result.answer,/observed gamma-ray background/);
 assert.doesNotMatch(result.answer,/contains no information about Hawking/i);
});
test('still repairs an omitted retrieved work when the first answer lacks structured part checks',async()=>{
 const question='How does Darwin explain natural selection in On the Origin of Species, and how does Hawking use observations in A Brief History of Time?';
 const sources=[
  {id:'S1',bookId:'529',title:'On the Origin of Species — Charles Darwin',page:96,
   preview:'Darwin explains that natural selection preserves favorable individual variations.'},
  {id:'S2',bookId:'102',title:'A Brief History of Time — Stephen Hawking',page:58,
   preview:'Hawking compares the observed gamma-ray background with radiation expected from primordial black holes.'}
 ];
 const labels=['Darwin’s explanation of natural selection','Hawking’s use of observations'];
 const inputs=[];
 const ai={run:async(_model,input)=>{
  inputs.push(input);
  if(inputs.length===1)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   coverage:'partial',missing:'Hawking is not covered.',questionParts:[
    {part:labels[0],status:'supported',evidenceIds:['S1']},
    {part:labels[1],status:'unsupported',evidenceIds:[]}
   ],evidence:[{id:'S1',point:'Natural selection preserves favorable variation.'}]
  })}}]};
  if(inputs.length===2)return {choices:[{finish_reason:'stop',message:{content:
   'Darwin says natural selection preserves favorable variations [S1]. The provided passages contain no information about Hawking.'}}]};
  assert.equal(inputs.length,3);
  assert.match(input.messages[1].content,/provided passages contain no information about Hawking/);
  assert.match(input.messages[1].content,/page 58/);
  return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   answer:'Darwin explains that natural selection preserves favorable variations [S1]. Hawking compares observed gamma rays with radiation expected from primordial black holes [S2].',
   partChecks:[
    {part:labels[0],status:'supported',evidenceIds:['S1']},
    {part:labels[1],status:'supported',evidenceIds:['S2']}
   ]
  })}}]};
 }};
 const result=await composeVerifiedAnswer(question,sources,ai);
 assert.equal(inputs.length,3);
 assert.equal(result.coverage,'full');
 assert.deepEqual(result.questionParts.map(part=>part.status),['supported','supported']);
 assert.deepEqual(result.citations.map(source=>source.id),['S1','S2']);
 assert.match(result.answer,/compares observed gamma rays/);
});
test('repairs literary summaries that blur a character theory with another speaker’s account',async()=>{
 const question='In Crime and Punishment, how does Raskolnikov try to justify murder, and how does the novel test or undermine his reasoning?';
 const sources=[
  {id:'S1',bookId:'114',title:'Crime and Punishment — Fyodor Dostoevsky',page:465,
   preview:'Porfiry summarizes Raskolnikov’s extraordinary-person theory. Raskolnikov replies that this is not quite his contention: an extraordinary person has an inner right to cross certain limits only when essential to realizing an idea, perhaps for humanity’s benefit.'},
  {id:'S2',bookId:'114',title:'Crime and Punishment — Fyodor Dostoevsky',page:814,
   preview:'Porfiry tells Raskolnikov that he has ceased to believe in his theory and predicts that he will eventually choose to confess and accept suffering.'},
  {id:'S3',bookId:'114',title:'Crime and Punishment — Fyodor Dostoevsky',page:941,
   preview:'The epilogue reports Raskolnikov’s stated motives as poverty, helplessness, and the wish to get money for his first steps in life; he says heartfelt repentance led him to confess.'}
 ];
 const labels=['how Raskolnikov tries to justify murder','how the novel tests or undermines his reasoning'];
 const inputs=[];
 const ai={run:async(_model,input)=>{
  inputs.push(input);
  if(inputs.length===1){
   assert.match(input.messages[0].content,/For questions about how a work tests or undermines a theory/);
   return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   coverage:'partial',missing:'The account and its challenge need fuller explanation.',
   questionParts:[
    {part:labels[0],status:'partial',evidenceIds:['S1']},
    {part:labels[1],status:'partial',evidenceIds:['S2','S3']}
   ],
   evidence:[
    {id:'S1',point:'Raskolnikov qualifies Porfiry’s description of his theory.'},
    {id:'S2',point:'Porfiry says Raskolnikov has ceased to believe the theory.'},
    {id:'S3',point:'The epilogue gives poverty and helplessness as stated motives.'}
   ]
  })}}]};
  }
  if(inputs.length===2){
   assert.match(input.messages[0].content,/Keep an author’s account distinct from a narrator, character, reported view/);
   return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   answer:'Raskolnikov has a perfect right to murder because extraordinary people can break the law [S1]. The novel demonstrates that he no longer believes his theory [S2]. His poverty and repentance explain the murder and confession [S3].',
   partChecks:[
    {part:labels[0],status:'partial',evidenceIds:['S1']},
    {part:labels[1],status:'partial',evidenceIds:['S2','S3']}
   ]
  })}}]};
  }
  assert.equal(inputs.length,3);
  assert.match(input.messages[0].content,/reported views, replies, hypotheticals, questions, and editorial notes distinct/);
  return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   answer:'Porfiry first summarizes the theory as giving extraordinary people license to transgress, but Raskolnikov qualifies that account: he claims an inner right to cross certain limits only when doing so is essential to realizing an idea, perhaps one that benefits humanity [S1]. The qualification matters; the passage does not say that extraordinary people must commit crimes or have an unrestricted right to do so.\n\nLater, Porfiry argues that Raskolnikov has stopped believing his theory and predicts that he will confess [S2]. That is Porfiry’s interpretation at this point. The epilogue later reports Raskolnikov’s stated motives as poverty and helplessness, and says he attributed his confession to repentance [S3]. Those motives complicate the extraordinary-person rationale by connecting the crime to personal desperation and remorse.',
   partChecks:[
    {part:labels[0],status:'supported',evidenceIds:['S1']},
    {part:labels[1],status:'supported',evidenceIds:['S2','S3']}
   ]
  })}}]};
 }};
 const result=await composeVerifiedAnswer(question,sources,ai);
 assert.equal(inputs.length,3);
 assert.equal(result.coverage,'full');
 assert.deepEqual(result.questionParts.map(part=>part.status),['supported','supported']);
 assert.match(result.answer,/Porfiry first summarizes/);
 assert.match(result.answer,/Raskolnikov qualifies that account/);
 assert.match(result.answer,/only when doing so is essential/);
 assert.match(result.answer,/That is Porfiry’s interpretation/);
 assert.doesNotMatch(result.answer,/Raskolnikov has a perfect right to murder/i);
});
test('omits an explicitly attributed claim that cites a conflicting verified speaker',()=>{
 const answer='According to Raskolnikov, ordinary people have no right to transgress the law, while extraordinary people have a perfect right to commit crimes [S1, S4]. Porfiry separately reports that the article gives certain people a perfect right to commit crimes [S4]. Raskolnikov’s own quoted line says extraordinary men have a right to transgress [S1].';
 const evidenceMap=[
  {id:'S1',point:'Raskolnikov states that extraordinary men may transgress.',
   quoteVerified:true,speaker:'Raskolnikov'},
  {id:'S4',point:'Porfiry reports his interpretation of Raskolnikov’s article.',
   quoteVerified:true,speaker:'Porfiry'}
 ];
 const result=removeConflictingSpeakerAttributions(answer,evidenceMap);
 assert.equal(result.conflicts.length,1);
 assert.deepEqual(result.conflicts[0].sourceIds,['S4']);
 assert.doesNotMatch(result.answer,/ordinary people have no right/i);
 assert.match(result.answer,/Porfiry separately reports/);
 assert.match(result.answer,/Raskolnikov’s own quoted line/);
});
test('carries a clear speaker into a pronoun-led claim and rejects a second speaker citation',()=>{
 const answer='Raskolnikov justifies his actions through a theory that distinguishes ordinary and extraordinary people [S1]. He posits that extraordinary men have an unrestricted right to commit crimes [S1, S4]. According to Porfiry, that was an exaggerated summary of the article [S4].';
 const evidenceMap=[
  {id:'S1',point:'Raskolnikov qualifies the theory and describes a limited inner right.',
   quoteVerified:true,speaker:'Raskolnikov'},
  {id:'S4',point:'Porfiry says his earlier summary exaggerated the theory.',
   quoteVerified:true,speaker:'Porfiry'}
 ];
 const result=removeConflictingSpeakerAttributions(answer,evidenceMap);
 assert.equal(result.conflicts.length,1);
 assert.equal(result.conflicts[0].speaker,'Raskolnikov');
 assert.deepEqual(result.conflicts[0].sourceIds,['S4']);
 assert.doesNotMatch(result.answer,/unrestricted right/i);
 assert.match(result.answer,/According to Porfiry/);
});
test('keeps a sentence that explicitly distinguishes both cited speakers',()=>{
 const answer='Raskolnikov qualifies the idea, while Porfiry acknowledges that his summary exaggerated it [S1, S4].';
 const evidenceMap=[
  {id:'S1',point:'Raskolnikov qualifies the theory.',quoteVerified:true,speaker:'Raskolnikov'},
  {id:'S4',point:'Porfiry acknowledges his summary was exaggerated.',quoteVerified:true,speaker:'Porfiry'}
 ];
 const result=removeConflictingSpeakerAttributions(answer,evidenceMap);
 assert.deepEqual(result.conflicts,[]);
 assert.equal(result.answer,answer);
});
test('speaker attribution guard downgrades the affected answer part without another model call',async()=>{
 const question='How does Mara describe the proposal, and what does Elias say about her account?';
 const sources=[
  {id:'S1',bookId:'114',title:'Test dialogue',page:10,
   preview:'Mara says the proposal allows only a limited exception. The excerpt identifies Mara as the speaker.'},
  {id:'S2',bookId:'114',title:'Test dialogue',page:11,
   preview:'Elias says Mara’s account is broader than the written proposal. The excerpt identifies Elias as the speaker.'}
 ];
 let calls=0;
 const ai={run:async()=>{
  calls++;
  if(calls===1)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   coverage:'full',missing:'',questionParts:[
    {part:'Mara’s description',status:'supported',evidenceIds:['S1']},
    {part:'Elias’s account',status:'supported',evidenceIds:['S2']}
   ],evidence:[
    {id:'S1',point:'Mara says the proposal allows a limited exception.',quote:'Mara says the proposal allows only a limited exception.',speaker:'Mara'},
    {id:'S2',point:'Elias says Mara’s account is broader than the proposal.',quote:'Elias says Mara’s account is broader than the written proposal.',speaker:'Elias'}
   ]
  })}}]};
  return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   answer:'According to Mara, Elias says the proposal allows an unlimited exception [S1, S2]. Mara’s own statement describes only a limited exception [S1]. Elias separately says Mara’s account is broader than the written proposal [S2]. These descriptions differ, so the answer should keep each speaker’s account distinct [S1, S2].',
   partChecks:[
    {part:'Mara’s description',status:'supported',evidenceIds:['S1','S2']},
    {part:'Elias’s account',status:'supported',evidenceIds:['S2']}
   ]
  })}}]};
 }};
 const result=await composeVerifiedAnswer(question,sources,ai);
 assert.equal(calls,2);
 assert.equal(result.questionParts[0].status,'partial');
 assert.equal(result.questionParts[1].status,'supported');
 assert.doesNotMatch(result.answer,/unlimited exception/i);
 assert.match(result.answer,/Mara’s own statement/);
 assert.match(result.answer,/Elias separately says/);
});
test('multi-author full coverage is downgraded when one requested author group is absent',()=>{
 const question='How do Aristotle and Darwin explain change?';
 const sources=[
  {id:'S1',bookId:'7',title:'Nicomachean Ethics — Aristotle',preview:'Virtue develops through habit.'},
  {id:'S2',bookId:'529',title:'On the Origin of Species — Charles Darwin',preview:'Natural selection preserves variations.'}
 ];
 const aristotleOnly=parseReview(JSON.stringify({coverage:'full',missing:'',evidence:[{id:'S1',point:'Relevant supported passage point.'}]}),sources,question);
 assert.equal(aristotleOnly.coverage,'partial');
 assert.match(aristotleOnly.missing,/Darwin/);
 const both=parseReview(JSON.stringify({coverage:'full',missing:'',evidence:[{id:'S1',point:'Relevant supported passage point.'},{id:'S2',point:'Relevant supported passage point.'}]}),sources,question);
 assert.equal(both.coverage,'full');
});
test('lowercase author surnames activate per-author evidence review for comparisons',async()=>{
 const question="what's the difference between the thought of kierkegaard and shestov?";
 const sources=[
  {id:'S1',bookId:'96',title:'Athens and Jerusalem — Lev Shestov',page:70,
   preview:'Shestov argues that rational necessity limits human freedom and that philosophy must struggle against it.'},
  {id:'S2',bookId:'140',title:'Fear and Trembling — Søren Kierkegaard',page:12,
   preview:'Kierkegaard describes faith as a paradox in which the individual stands in an absolute relation to God.'}
 ];
 const calls=[];
 const ai={run:async(_model,input)=>{
  calls.push(input);
  if(calls.length===1)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   coverage:'full',missing:'',
   questionParts:[
    {part:"Kierkegaard's thought",status:'supported',evidenceIds:['S2']},
    {part:"Shestov's thought",status:'supported',evidenceIds:['S1']}
   ],
   evidence:[
    {id:'S1',point:'Shestov criticizes rational necessity as a constraint on freedom.'},
    {id:'S2',point:'Kierkegaard presents faith as the individual’s paradoxical relation to God.'}
   ]
  })}}],usage:{neurons:2}};
  return {choices:[{finish_reason:'stop',message:{content:
   'Kierkegaard presents faith as the individual’s paradoxical relation to God [S2]. His passage centers on the believer’s religious commitment and the individual’s relation to God. It frames his thought here through faith and the single person. The excerpt therefore offers a religious account tied to the individual’s relation with God, rather than an abstract definition of faith [S2].\n\nShestov attacks the authority of rational necessity [S1]. He treats necessary truths as limits on human freedom and calls for a struggle against that constraint. The difference in these excerpts is one of emphasis: Kierkegaard focuses on the individual’s relation to God through faith, while Shestov challenges reason’s claim that necessity sets the limits of possibility. This comparison synthesizes the two passages, rather than presenting a direct debate between the authors [S1, S2].'}}],usage:{neurons:3}};
 }};
 const result=await composeVerifiedAnswer(question,sources,ai);
 assert.equal(calls.length,2);
 assert.match(calls[0].messages[0].content,/Lev Shestov \[S1\]/);
 assert.match(calls[0].messages[0].content,/Søren Kierkegaard \[S2\]/);
 assert.match(calls[0].messages[0].content,/select at least one relevant passage from that group/);
 assert.equal(result.coverage,'full');
 assert.deepEqual(result.questionParts.map(part=>part.status),['supported','supported']);
});
test('a report in one author’s book cannot stand as the other author’s primary evidence',()=>{
 const question="what's the difference between the thought of kierkegaard and shestov?";
 const sources=[
  {id:'S1',bookId:'96',title:'Athens and Jerusalem — Lev Shestov',page:196,
   preview:'Kierkegaard declared that Greek philosophy begins in wonder and Christian philosophy in despair.'},
  {id:'S2',bookId:'192',title:'Philosophical Fragments — Søren Kierkegaard',page:57,
   preview:'Consequences founded on a paradox are built over a yawning chasm.'}
 ];
 const review=parseReview(JSON.stringify({coverage:'full',missing:'',
  questionParts:[
   {part:"Kierkegaard's thought",status:'supported',evidenceIds:['S1']},
   {part:"Shestov's thought",status:'unsupported',evidenceIds:[]}
  ],
  evidence:[{id:'S1',point:'Shestov reports Kierkegaard’s distinction between Greek wonder and Christian despair.'}]
 }),sources,question);
 assert.equal(review.questionParts[0].status,'partial');
 assert.deepEqual(review.questionParts[0].evidenceIds,['S1']);
 assert.equal(review.questionParts[1].status,'unsupported');
});
test('author comparison repair replaces a secondary report with both authors’ own passages',async()=>{
 const question="what's the difference between the thought of kierkegaard and shestov?";
 const sources=[
  {id:'S1',bookId:'192',title:'Philosophical Fragments — Søren Kierkegaard',page:57,
   preview:'Consequences founded on a paradox are not to be appropriated as a settled estate, for their value rests upon the paradox.'},
  {id:'S2',bookId:'96',title:'Athens and Jerusalem — Lev Shestov',page:196,
   preview:'Kierkegaard declared that Greek philosophy begins in wonder and Christian philosophy in despair.'},
  {id:'S3',bookId:'96',title:'Athens and Jerusalem — Lev Shestov',page:55,
   preview:'The fear of freedom is a basic characteristic of human nature; people try to limit God by eternal principles, although divine thought is creative power.'}
 ];
 const calls=[];
 const ai={run:async(_model,input)=>{
  calls.push(input);
  if(calls.length===1)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   coverage:'full',missing:'',
   questionParts:[
    {part:"Kierkegaard's thought",status:'supported',evidenceIds:['S2']},
    {part:"Shestov's thought",status:'unsupported',evidenceIds:[]}
   ],
   evidence:[{id:'S2',point:'Shestov reports Kierkegaard’s distinction between Greek wonder and Christian despair.'}]
  })}}],usage:{neurons:2}};
  if(calls.length===2)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   answer:'Shestov reports Kierkegaard’s contrast between Greek wonder and Christian despair [S2]. The submitted excerpts do not establish Shestov’s own position.',
   partChecks:[
    {part:"Kierkegaard's thought",status:'supported',evidenceIds:['S2']},
    {part:"Shestov's thought",status:'unsupported',evidenceIds:[]}
   ]
  })}}],usage:{neurons:2}};
  assert.match(input.messages[0].content,/When asked for a named author…32433 tokens truncated…assert.equal(result.questionParts[2].status,'supported');
 assert.match(result.answer,/contrast an account framed by its public end with one framed by the power/);
 assert.deepEqual(result.citations.map(source=>source.id),['S1','S2']);
});

test('a partial cross-work comparison cannot substitute an author attack for the missing position',()=>{
 const sources=[
  {id:'S1',bookId:'7',title:'Nicomachean Ethics — Aristotle'},
  {id:'S2',bookId:'163',title:'Leviathan — Thomas Hobbes'}
 ];
 const groups=[
  {label:'Nicomachean Ethics — Aristotle',bookIds:new Set(['7'])},
  {label:'Leviathan — Thomas Hobbes',bookIds:new Set(['163'])}
 ];
 const parts=[
  {part:'Aristotle’s political aim',status:'supported',evidenceIds:['S1']},
  {part:'Hobbes’s role for common power',status:'unsupported',evidenceIds:[]},
  {part:'How the accounts differ',status:'partial',evidenceIds:['S1','S2']}
 ];
 const draft='Aristotle presents political science as aiming at happiness [S1].\n\n'+
  'While Aristotle frames politics through the human good, Hobbes rejects this framework in Leviathan [S1, S2].\n\n'+
  'The supplied passages do not establish Hobbes’s specific account of common power.';
 const result=removeUnsupportedCrossWorkComparisonClaims(draft,parts,groups,sources);
 assert.equal(result.removed.length,1);
 assert.match(result.answer,/aiming at happiness/);
 assert.match(result.answer,/do not establish Hobbes’s specific account/);
 assert.doesNotMatch(result.answer,/Hobbes rejects this framework/);
});

test('the comparison guard catches a reader-synthesis contrast stated as a noun',()=>{
 const sources=[
  {id:'S2',bookId:'34',title:'An Enquiry Concerning Human Understanding — David Hume'},
  {id:'S5',bookId:'35',title:'Critique of Pure Reason — Immanuel Kant'}
 ];
 const groups=[
  {label:'Hume',bookIds:new Set(['34'])},
  {label:'Kant',bookIds:new Set(['35'])}
 ];
 const draft='Hume argues that causal power is not discoverable through sensible qualities [S2].\n\n'+
  'Kant describes reason as seeking unity through general principles [S5].\n\n'+
  'A reader synthesis of these positions suggests a contrast between Hume’s view of causality as lacking discoverable sensible grounds and Kant’s view of reason as a system seeking unity [S2, S5].\n\n'+
  'The supplied passages do not establish their difference about causal necessity.';
 const result=removeUnsupportedCrossWorkComparisonClaims(draft,[
  {part:'Hume’s view of causal necessity',status:'partial',evidenceIds:['S2']},
  {part:'Kant’s view of causal necessity',status:'partial',evidenceIds:['S5']},
  {part:'Difference between Hume and Kant on causal necessity',status:'unsupported',evidenceIds:[]}
 ],groups,sources);
 assert.equal(result.removed.length,1);
 assert.match(result.answer,/Hume argues that causal power/);
 assert.match(result.answer,/Kant describes reason/);
 assert.match(result.answer,/do not establish their difference about causal necessity/);
 assert.doesNotMatch(result.answer,/suggests a contrast between Hume/);
});

test('a fully supported comparison is not altered by the comparison-claim guard',()=>{
 const sources=[{id:'S1',bookId:'7'},{id:'S2',bookId:'163'}];
 const groups=[{bookIds:new Set(['7'])},{bookIds:new Set(['163'])}];
 const answer='Aristotle emphasizes the human good, whereas Hobbes emphasizes common power [S1, S2].';
 const result=removeUnsupportedCrossWorkComparisonClaims(answer,[
  {part:'How the accounts differ',status:'supported',evidenceIds:['S1','S2']}
 ],groups,sources);
 assert.equal(result.answer,answer);
 assert.deepEqual(result.removed,[]);
});

test('repairs an unsupported part when review evidence was left unmapped',async()=>{
 const question='How is the protagonist’s view tested later in the novel?';
 const sources=[{id:'S2',bookId:'529',title:'Crime and Punishment — Fyodor Dostoevsky',page:814,
  preview:'Porfiry predicts that Raskolnikov will choose to confess and take on suffering.'}];
 const calls=[];
 const ai={run:async(_model,input)=>{
  calls.push(input);
  if(calls.length===1)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   coverage:'partial',missing:'The later test of his view is not addressed.',
   questionParts:[{part:'How the protagonist’s view is tested later',status:'unsupported',evidenceIds:[]}],
   evidence:[{id:'S2',point:'Porfiry predicts that Raskolnikov will choose confession and suffering.'}]
  })}}],usage:{neurons:2}};
  if(calls.length===2)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   answer:'The excerpts do not explain how the protagonist’s view is tested later.',
   partChecks:[{part:'How the protagonist’s view is tested later',status:'unsupported',evidenceIds:[]}]
  })}}],usage:{neurons:3}};
  assert.match(input.messages[0].content,/use the evidence map to find the central supported point/);
  return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   answer:'The later exchange puts the protagonist’s position under pressure: Porfiry predicts that Raskolnikov will choose confession and take on suffering [S2]. This presents confession and suffering as consequences he must confront, though the excerpt does not explain the full development of his reasoning.',
   partChecks:[{part:'How the protagonist’s view is tested later',status:'partial',evidenceIds:['S2']}]
  })}}],usage:{neurons:4}};
 }};
 const result=await composeVerifiedAnswer(question,sources,ai);
 assert.equal(calls.length,3);
 assert.equal(result.coverage,'partial');
 assert.equal(result.questionParts[0].status,'partial');
 assert.match(result.answer,/Porfiry predicts/);
});

test('repairs a missing comparison when each named work has a supported side',async()=>{
 const question='Compare Aristotle’s and Hobbes’s accounts of political order.';
 const sources=[
  {id:'S1',bookId:'7',title:'Nicomachean Ethics — Aristotle',page:1,
   preview:'Politics aims at the human good and at making citizens good and obedient to laws.'},
  {id:'S2',bookId:'163',title:'Leviathan — Thomas Hobbes',page:1,
   preview:'A common power keeps men in awe and enables justice and obedience to laws.'}
 ];
 const calls=[];
 const ai={run:async(_model,input)=>{
  calls.push(input);
  if(calls.length===1)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   coverage:'partial',missing:'Comparison of the two accounts is not provided.',
   questionParts:[
    {part:'Aristotle’s account',status:'supported',evidenceIds:['S1']},
    {part:'Hobbes’s account',status:'supported',evidenceIds:['S2']},
    {part:'Comparison of the two accounts',status:'unsupported',evidenceIds:[]}
   ],
   evidence:[{id:'S1',point:'Aristotle connects political order with human good and good citizens.'},
    {id:'S2',point:'Hobbes connects political order with a common power that secures justice.'}]
  })}}],usage:{neurons:2}};
  if(calls.length===2)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   answer:'Aristotle connects political order with human good and virtuous citizens [S1]. Hobbes says common power secures justice and obedience [S2]. The excerpts do not directly compare their accounts.',
   partChecks:[
    {part:'Aristotle’s account',status:'supported',evidenceIds:['S1']},
    {part:'Hobbes’s account',status:'supported',evidenceIds:['S2']},
    {part:'Comparison of the two accounts',status:'unsupported',evidenceIds:[]}
   ]
  })}}],usage:{neurons:3}};
  assert.match(input.messages[0].content,/Repair only the requested parts/);
  return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   answer:'Aristotle presents political order as aiming at human good and at making citizens good and obedient to laws [S1]. The passage ties political judgment to a shared human end, and it treats citizens’ character and their relation to law as part of that end. The account therefore describes political order through the good it should pursue and the kind of citizen it should form. These points come from Aristotle’s passage, which speaks about political science and civic virtue [S1].\n\nHobbes presents political order through the institution of a common power. That power keeps people in awe and enables them to consent to justice and the laws of nature [S2]. In the excerpt, the role of authority is practical: it secures conditions under which those rules can be observed. Hobbes’s passage thus emphasizes the need for an effective power to sustain order among people [S2].\n\nRead together, the accounts place emphasis on different supports for political order [S1, S2]. Aristotle connects it to human good and the formation of citizens, while Hobbes connects it to a common power that secures justice and obedience [S1, S2]. This comparison is a synthesis of the two supplied passages; neither cited excerpt directly compares Aristotle with Hobbes [S1, S2]. The distinction follows from the separate roles each passage assigns to political order [S1, S2].',
   partChecks:[
    {part:'Aristotle’s account',status:'supported',evidenceIds:['S1']},
    {part:'Hobbes’s account',status:'supported',evidenceIds:['S2']},
    {part:'Comparison of the two accounts',status:'supported',evidenceIds:['S1','S2']}
   ]
  })}}],usage:{neurons:4}};
 }};
 const result=await composeVerifiedAnswer(question,sources,ai);
 assert.equal(calls.length,3);
 assert.equal(result.coverage,'full');
 assert.match(result.answer,/synthesis of the two supplied passages/);
 assert.deepEqual(result.questionParts[2].evidenceIds,['S1','S2']);
});

test('repairs a requested part when its reviewed evidence is absent from the draft citations',async()=>{
 const question='In Crime and Punishment, how does Raskolnikov justify the murder, and how does the novel test his reasoning?';
 const sources=[
  {id:'S1',bookId:'529',title:'Crime and Punishment — Fyodor Dostoevsky',page:464,
   preview:'Extraordinary men have a right to commit any crime and to transgress the law in any way, just because they are extraordinary.'},
  {id:'S2',bookId:'529',title:'Crime and Punishment — Fyodor Dostoevsky',page:941,
   preview:'The cause was his miserable position, his poverty and helplessness, and his desire to provide for his first steps in life.'}
 ];
 const calls=[];
 const draft='The novel presents Raskolnikov as a troubled young man whose circumstances shape his choices [S2]. The account links his actions to hardship and uncertainty about his future. It also shows that his situation affects how he understands the consequences of what he has done. His reasoning is placed in a wider moral setting through the events that follow.\n\nThe later consequences make his position difficult to sustain [S2]. His conduct and emotional state remain important to how the reader understands the crime. The text presents these details as part of the broader narrative rather than as a simple legal account. Together, they show that his situation and the aftermath matter to the novel’s treatment of the murder.';
 const repaired='Raskolnikov tries to justify the murder through a theory that “extraordinary” people have a right to transgress ordinary moral and legal limits [S1]. The claim gives exceptional status as the reason such a person may commit a crime. The passage presents this as the theory being discussed, not as a moral rule the novel endorses.\n\nThe novel tests that reasoning against the circumstances and consequences of the crime. A later explanation points to Raskolnikov’s poverty, helplessness, and desire to take his first steps in life as motives [S2]. This challenges the idea that the murder followed simply from a detached theory of exceptional status: the account also connects it with material desperation. The cited passages support that tension, though they do not by themselves settle every motive in the novel.';
 const ai={run:async(_model,input)=>{
  calls.push(input);
  if(calls.length===1)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   coverage:'partial',missing:'The theory used to justify the murder is not explained.',
   questionParts:[
    {part:'how Raskolnikov justifies the murder',status:'partial',evidenceIds:['S1']},
    {part:'how the novel tests his reasoning',status:'partial',evidenceIds:['S2']}
   ],evidence:[
    {id:'S1',point:'The reported theory grants extraordinary people a right to transgress the law.',
     quote:'Extraordinary men have a right to commit any crime and to transgress the law in any way, just because they are extraordinary.'},
    {id:'S2',point:'A later account names poverty and helplessness as motives.',
     quote:'The cause was his miserable position, his poverty and helplessness, and his desire to provide for his first steps in life.'}
   ]})}}],usage:{neurons:2}};
  if(calls.length===2)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({answer:draft,partChecks:[
   {part:'how Raskolnikov justifies the murder',status:'partial',evidenceIds:['S1']},
   {part:'how the novel tests his reasoning',status:'partial',evidenceIds:['S2']}
  ]})}}],usage:{neurons:2}};
  assert.match(input.messages[0].content,/Repair only the requested parts/);
  assert.match(input.messages[0].content,/Put direct definitions, theories, and roles before related motives/);
  assert.match(input.messages[1].content,/how Raskolnikov justifies the murder — partial/);
  assert.match(input.messages[1].content,/Evidence map/);
  assert.match(input.messages[1].content,/Direct mapped points for incomplete parts that are not cited in the current draft/);
  assert.match(input.messages[1].content,/Raskolnikov justifies the murder:.*reported theory grants extraordinary people a right to transgress the law/);
  return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({answer:repaired,partChecks:[
   {part:'how Raskolnikov justifies the murder',status:'supported',evidenceIds:['S1']},
   {part:'how the novel tests his reasoning',status:'supported',evidenceIds:['S2']}
  ]})}}],usage:{neurons:3}};
 }};
 const result=await composeVerifiedAnswer(question,sources,ai);
 assert.equal(calls.length,3);
 assert.match(result.answer,/extraordinary.*right to transgress/i);
 assert.deepEqual(result.citations.map(source=>source.id),['S1','S2']);
});

test('repairs a supported part that cites related evidence but omits its primary mapped passage',async()=>{
 const question='What theory does Raskolnikov use to justify the murder, and what motive is later given?';
 const sources=[
  {id:'S1',bookId:'529',title:'Crime and Punishment — Fyodor Dostoevsky',page:464,
   preview:'Extraordinary men have a right to commit any crime and to transgress the law in any way, just because they are extraordinary.'},
  {id:'S2',bookId:'529',title:'Crime and Punishment — Fyodor Dostoevsky',page:941,
   preview:'The cause was his miserable position, his poverty and helplessness, and his desire to provide for his first steps in life.'}
 ];
 const calls=[];
 const ai={run:async(_model,input)=>{
  calls.push(input);
  if(calls.length===1)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   coverage:'full',missing:'',
   questionParts:[
    {part:'the theory used to justify the murder',status:'supported',evidenceIds:['S1','S2']},
    {part:'the later motive given',status:'supported',evidenceIds:['S2']}
   ],evidence:[
    {id:'S1',point:'The reported theory gives extraordinary people a right to transgress the law.',
     quote:'Extraordinary men have a right to commit any crime and to transgress the law in any way, just because they are extraordinary.'},
    {id:'S2',point:'A later account cites poverty and helplessness as motives.',
     quote:'The cause was his miserable position, his poverty and helplessness, and his desire to provide for his first steps in life.'}
   ]})}}],usage:{neurons:2}};
  if(calls.length===2)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   answer:'The account connects Raskolnikov’s decision with his poverty and helplessness [S2]. The later explanation also presents his desire to provide for his first steps in life as a motive [S2].',
   partChecks:[
    {part:'the theory used to justify the murder',status:'supported',evidenceIds:['S2']},
    {part:'the later motive given',status:'supported',evidenceIds:['S2']}
   ]
  })}}],usage:{neurons:2}};
  assert.match(input.messages[0].content,/Put direct definitions, theories, and roles before related motives/);
  assert.match(input.messages[1].content,/Direct mapped points for incomplete parts/);
  assert.match(input.messages[1].content,/the theory used to justify the murder: \[S1\] The reported theory gives extraordinary people a right to transgress the law/);
  return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   answer:'Raskolnikov’s theory is that “extraordinary” people may transgress the law because of their exceptional status [S1]. The passage presents this as the theory attributed to him, not as a rule endorsed by the novel. A later explanation also identifies poverty, helplessness, and the desire to provide for his first steps in life as motives [S2]. The two passages distinguish his stated justification from the material circumstances later named as motives.',
   partChecks:[
    {part:'the theory used to justify the murder',status:'supported',evidenceIds:['S1']},
    {part:'the later motive given',status:'supported',evidenceIds:['S2']}
   ]
  })}}],usage:{neurons:3}};
 }};
 const result=await composeVerifiedAnswer(question,sources,ai);
 assert.equal(calls.length,3);
 assert.match(result.answer,/extraordinary.*may transgress the law/i);
 assert.deepEqual(result.citations.map(source=>source.id),['S1','S2']);
 assert.equal(result.coverage,'full');
});

test('repairs a partial comparison when supported source positions are only summarized separately',async()=>{
 const question='How does Aristotle describe the aim of political science in the Nicomachean Ethics, and what role does Hobbes give common power in Leviathan? How do these accounts differ?';
 const sources=[
  {id:'S1',bookId:'7',title:'Nicomachean Ethics — Aristotle',page:2,
   preview:'Political science aims at the highest of all goods achievable by action, generally identified as happiness.'},
  {id:'S2',bookId:'163',title:'Leviathan — Thomas Hobbes',page:104,
   preview:'Without a common power to keep them all in awe, people would not reliably observe justice and the laws of nature.'}
 ];
 const calls=[];
 const separate='Aristotle frames political science around the highest good achievable through action, which the passage identifies with happiness [S1]. The passage treats this as the end of political inquiry. Its focus is therefore on the good political activity seeks to achieve.\n\nHobbes describes common power as necessary to keep people in awe so they can observe justice and the laws of nature [S2]. The passage presents authority as a condition for those rules to be followed. Its focus is on what sustains public order among people.';
 const synthesis='Aristotle frames political science around the highest good achievable through action, which the passage identifies with happiness [S1]. The account describes political inquiry through the human good it seeks to achieve. Its emphasis is on the end that political activity should serve.\n\nHobbes describes common power as necessary to keep people in awe so they can observe justice and the laws of nature [S2]. The passage presents authority as a condition for those rules to be followed. Its emphasis is on what sustains public order among people. As a reader-level comparison, Aristotle emphasizes the good political life should pursue, whereas Hobbes emphasizes the power needed to maintain justice and order [S1, S2]. This contrast synthesizes the separate passages; neither excerpt directly compares the two thinkers.';
 const ai={run:async(_model,input)=>{
  calls.push(input);
  if(calls.length===1)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   coverage:'partial',missing:'The contrast between the positions is not stated.',
   questionParts:[
    {part:'the aim of political science in the Nicomachean Ethics',status:'supported',evidenceIds:['S1']},
    {part:'the role of common power in Leviathan',status:'supported',evidenceIds:['S2']},
    {part:'how these accounts differ',status:'partial',evidenceIds:['S1','S2']}
   ],evidence:[
    {id:'S1',point:'Aristotle presents political science as aiming at the highest achievable good, identified as happiness.',
     quote:'Political science aims at the highest of all goods achievable by action, generally identified as happiness.'},
    {id:'S2',point:'Hobbes presents common power as necessary for justice and natural law to be observed.',
     quote:'Without a common power to keep them all in awe, people would not reliably observe justice and the laws of nature.'}
   ]})}}],usage:{neurons:2}};
  if(calls.length===2)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({answer:separate,partChecks:[
   {part:'the aim of political science in the Nicomachean Ethics',status:'supported',evidenceIds:['S1']},
   {part:'the role of common power in Leviathan',status:'supported',evidenceIds:['S2']},
   {part:'how these accounts differ',status:'partial',evidenceIds:['S1','S2']}
  ]})}}],usage:{neurons:2}};
  assert.match(input.messages[0].content,/For comparisons, state the contrast only when evidence supports each side/);
  return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({answer:synthesis,partChecks:[
   {part:'the aim of political science in the Nicomachean Ethics',status:'supported',evidenceIds:['S1']},
   {part:'the role of common power in Leviathan',status:'supported',evidenceIds:['S2']},
   {part:'how these accounts differ',status:'supported',evidenceIds:['S1','S2']}
  ]})}}],usage:{neurons:3}};
 }};
 const result=await composeVerifiedAnswer(question,sources,ai);
 assert.equal(calls.length,3);
 assert.match(result.answer,/whereas Hobbes emphasizes the power needed/);
 assert.equal(result.coverage,'full');
});

test('recognizes a cited reader synthesis when coverage calls the comparison unsupported',async()=>{
 const question='How does Aristotle describe political science in Nicomachean Ethics, how does Hobbes describe common power in Leviathan, and how do the accounts differ?';
 const sources=[
  {id:'S1',bookId:'7',title:'Nicomachean Ethics — Aristotle',page:12,
   preview:'The aim of political science is the human good and happiness; it makes citizens good and obedient to laws.'},
  {id:'S2',bookId:'163',title:'Leviathan — Thomas Hobbes',page:104,
   preview:'Common power keeps people in awe so they may observe justice and the laws of nature.'}
 ];
 let calls=0;
 const answer='Aristotle describes political science as pursuing human good and happiness [S1]. The same passage connects that study with virtue of the soul and with making citizens good and obedient to laws [S1]. This presents political inquiry through the end it should serve and the kind of civic character it should cultivate [S1]. The passage gives human flourishing a central place in describing the aim of political science [S1].\n\nHobbes gives common power a different role: it keeps people in awe so that justice and the laws of nature can be observed [S2]. In this account, public authority supplies the condition that helps people follow those rules in practice [S2]. The passage says that without common power, justice and natural law would not be reliably observed [S2]. Hobbes therefore explains political order through the force that sustains public obedience [S2].\n\nThe accounts differ in what they emphasize: Aristotle connects political order with human good and civic formation, whereas Hobbes emphasizes common power as the condition that sustains justice [S1, S2]. This is a reader-level comparison of the two supplied passages, not a claim that either author directly compared his view with the other [S1, S2]. Their respective passages support the contrast between a human good that guides political inquiry and an authority that maintains order [S1, S2]. The comparison follows from those distinct emphases and remains limited to the excerpts supplied here [S1, S2].\n\nThe available passages do not fully address: How the accounts differ (partially supported).';
 const ai={run:async(_model,input)=>{
  calls++;
  if(input.max_completion_tokens===520)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   coverage:'partial',missing:'The comparison is not directly stated in either excerpt.',
   questionParts:[
    {part:'Aristotle’s account of political science',status:'supported',evidenceIds:['S1']},
    {part:'Hobbes’s account of common power',status:'supported',evidenceIds:['S2']},
    {part:'How the accounts differ',status:'unsupported',evidenceIds:[]}
   ],evidence:[
    {id:'S1',point:'Aristotle connects political science with human good and civic formation.'},
    {id:'S2',point:'Hobbes connects common power with maintaining justice.'}
   ]})}}],usage:{neurons:2}};
  assert.match(input.messages[0].content,/Complementary passages may support separate sides/);
  return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({answer,partChecks:[
   {part:'Aristotle’s account of political science',status:'supported',evidenceIds:['S1']},
   {part:'Hobbes’s account of common power',status:'supported',evidenceIds:['S2']},
   {part:'How the accounts differ',status:'unsupported',evidenceIds:[]}
  ]})}}],usage:{neurons:3}};
 }};
 const result=await composeVerifiedAnswer(question,sources,ai);
 assert.equal(calls,2);
 assert.equal(result.coverage,'full');
 assert.equal(result.questionParts[2].status,'supported');
 assert.deepEqual(result.questionParts[2].evidenceIds,['S1','S2']);
 assert.doesNotMatch(result.answer,/do not fully address/i);
});

test('final relation audit preserves a cited cross-work synthesis when both sides are supported',async()=>{
 const question='Compare the Nicomachean Ethics and Leviathan: what is the relationship between Aristotle’s political aim and Hobbes’s common power, and how do their accounts differ?';
 const sources=[
  {id:'S1',bookId:'7',title:'Nicomachean Ethics — Aristotle',page:2,
   preview:'Political science aims at the highest of all goods achievable by action, which is generally identified as happiness.'},
  {id:'S2',bookId:'163',title:'Leviathan — Thomas Hobbes',page:104,
   preview:'Without a common power to keep them all in awe, people would not reliably observe justice and the laws of nature.'}
 ];
 const parts=[
  {part:'Aristotle’s political aim',status:'supported',evidenceIds:['S1']},
  {part:'Hobbes’s role for common power',status:'supported',evidenceIds:['S2']},
  {part:'How the accounts differ',status:'partial',evidenceIds:['S1','S2']}
 ];
 const answer='Aristotle frames political inquiry around an end: the highest good achievable through action, which the passage identifies with happiness [S1]. It presents political science by reference to the good its practical activity seeks. The cited passage explains this aim without directly comparing it with Hobbes’s account.\n\nHobbes gives common power a different role: it keeps people in awe so that justice and the laws of nature can be observed [S2]. His passage emphasizes the authority needed to sustain those rules in practice. Without common power, Hobbes says, people would not reliably observe justice or the laws of nature [S2].\n\nRead together, Aristotle emphasizes the end political inquiry should pursue, whereas Hobbes emphasizes the power needed to maintain order [S1, S2]. The contrast is between a purpose that guides political inquiry and an authority that secures public order. This is a reader-level comparison of the supplied passages, not a comparison made by either author [S1, S2]. The distinction follows from the different roles described in the two excerpts. In this synthesis, one passage concerns what political activity should aim at, while the other concerns the condition that makes civic rules effective.';
 let calls=0;
 const ai={run:async(_model,input)=>{
  calls++;
  if(calls===1)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   coverage:'partial',missing:'The excerpts do not directly compare the accounts.',
   questionParts:parts,
   evidence:[
    {id:'S1',point:'Aristotle identifies happiness as the highest good pursued by political science.',quote:'political science aims at and what is the highest of all goods achievable by action',speaker:'Aristotle'},
    {id:'S2',point:'Hobbes says common power keeps people in awe so justice can be observed.',quote:'without a common power to keep them all in awe',speaker:'Thomas Hobbes'}
   ]
  })}}],usage:{neurons:1}};
  if(calls===2)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({answer,partChecks:parts})}}],usage:{neurons:1}};
  assert.match(input.messages[0].content,/Audit and correct the finished answer against the supplied excerpts/);
  return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({answer,partChecks:parts})}}],usage:{neurons:1}};
 }};
 const result=await composeVerifiedAnswer(question,sources,ai);
 assert.equal(calls,3);
 assert.equal(result.coverage,'full');
 assert.equal(result.questionParts[2].status,'supported');
 assert.deepEqual(result.questionParts[2].evidenceIds,['S1','S2']);
 assert.doesNotMatch(result.answer,/do not fully address/i);
});

test('repairs prose that denies a comparison while coverage marks it supported',async()=>{
 const question='How do Aristotle and Hobbes explain political order, and how do their accounts differ?';
 const sources=[
  {id:'S1',bookId:'7',title:'Nicomachean Ethics — Aristotle',page:12,
   preview:'Political science aims at the human good and makes citizens good and obedient to laws.'},
  {id:'S2',bookId:'163',title:'Leviathan — Thomas Hobbes',page:104,
   preview:'Common power keeps people in awe so they may observe justice and the laws of nature.'}
 ];
 const calls=[];
 const parts=[
  {part:'Aristotle’s account of political order',status:'supported',evidenceIds:['S1']},
  {part:'Hobbes’s account of political order',status:'supported',evidenceIds:['S2']},
  {part:'How the accounts differ',status:'supported',evidenceIds:['S1','S2']}
 ];
 const refusal='Aristotle describes political order in terms of human good and citizens obeying laws [S1]. Hobbes describes common power as keeping people in awe so justice and natural law can be observed [S2]. The texts do not offer a direct comparison, and the evidence cannot establish a difference between their accounts [S1, S2].';
 const repaired='Aristotle connects political order with the human good and with forming citizens who obey the laws [S1]. This frames civic order through the purpose political life should serve and the character citizens should develop. The passage therefore presents the good of the community as central to political inquiry, rather than describing authority only as a means of control.\n\nHobbes gives common power a different role: it keeps people in awe so that justice and the laws of nature can be observed [S2]. Political order here depends on an authority capable of securing obedience. The passage emphasizes the power needed to make shared rules effective, linking public order to the conditions for following them.\n\nThe accounts differ in their emphasis. Aristotle links political order to human good and civic formation, whereas Hobbes stresses common power as the means that sustains justice and obedience [S1, S2]. This contrast is a synthesis of the two supplied passages, each of which supports its own side. Together they point to a difference between the end political life should pursue and the authority that helps maintain order. The comparison stays within the emphasis visible in these excerpts.';
 const ai={run:async(_model,input)=>{
  calls.push(input);
  if(calls.length===1)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   coverage:'full',missing:'',questionParts:parts,
   evidence:[{id:'S1',point:'Aristotle connects political order with the human good and citizens.'},
    {id:'S2',point:'Hobbes connects common power with justice and obedience.'}]
  })}}],usage:{neurons:2}};
  if(calls.length===2)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({answer:refusal,partChecks:parts})}}],usage:{neurons:2}};
  assert.match(input.messages[0].content,/Repair only the requested parts/);
  assert.match(calls[1].messages[0].content,/Complementary passages may support separate sides/);
  assert.match(input.messages[1].content,/Initial answer and coverage check/);
  return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({answer:repaired,partChecks:parts})}}],usage:{neurons:3}};
 }};
 const result=await composeVerifiedAnswer(question,sources,ai);
 assert.equal(calls.length,3);
 assert.equal(result.coverage,'full');
 assert.equal(result.questionParts[2].status,'supported');
 assert.match(result.answer,/whereas Hobbes stresses common power/);
 assert.doesNotMatch(result.answer,/evidence cannot establish a difference/);
});

test('repairs a 120-plus-word single paragraph when three parts are supported',async()=>{
 const question='According to Aristotle, what is practical wisdom, and how does it differ from science and art?';
 const sources=[
  {id:'S1',bookId:'7',title:'Nicomachean Ethics — Aristotle',page:66,
   preview:'Practical wisdom is a true and reasoned state of capacity to act about things good or bad for humans. It deals with things that can be otherwise and requires deliberation. It cannot be science because action is variable.'},
  {id:'S2',bookId:'7',title:'Nicomachean Ethics — Aristotle',page:73,
   preview:'Virtue implies practical wisdom, which serves as a right rule concerning virtue.'},
  {id:'S3',bookId:'7',title:'Nicomachean Ethics — Aristotle',page:66,
   preview:'Practical wisdom is not art because action and making are different kinds of things.'}
 ];
 const calls=[];
 let draft='';
 const ai={run:async(_model,input)=>{
  calls.push(input);
  if(calls.length===1)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   coverage:'full',missing:'',
   questionParts:[
    {part:'define practical wisdom',status:'supported',evidenceIds:['S1','S2']},
    {part:'distinguish it from science',status:'supported',evidenceIds:['S1']},
    {part:'distinguish it from art',status:'supported',evidenceIds:['S3']}
   ],
   evidence:[
    {id:'S1',point:'Practical wisdom is a reasoned capacity for action about human goods, concerning variable matters that require deliberation.'},
    {id:'S2',point:'Practical wisdom is a right rule concerning virtue.'},
    {id:'S3',point:'Practical wisdom differs from art because action and making differ.'}
   ]
  })}}],usage:{neurons:2}};
  if(calls.length===2){
   draft='Practical wisdom is a true and reasoned state of capacity to act regarding things that are good or bad for humans [S1]. This capacity functions as a right rule regarding such matters [S2]. Practical wisdom differs from scientific knowledge because scientific knowledge involves demonstration, whereas practical wisdom involves deliberation about things that are variable and can be otherwise [S1]. While wisdom involves knowing things that are always the same, such as being white or straight, practical wisdom concerns matters that vary for different beings [S1]. Finally, practical wisdom is not art because action and making are different kinds of things [S1]. This distinction exists because the objects of practical wisdom are things capable of being otherwise, which separates them from the processes of making [S1].';
   assert(draft.trim().split(/\s+/).length>=120&&draft.trim().split(/\s+/).length<180);
   return {choices:[{finish_reason:'stop',message:{content:draft}}],usage:{neurons:2}};
  }
  if(calls.length===3){
   assert.match(input.messages[0].content,/exactly three developed paragraphs/);
   assert.match(input.messages[0].content,/at least three complete sentences in each paragraph/);
   assert.match(input.messages[0].content,/Aim for 180–260 words overall/);
   assert.match(input.messages[1].content,/Reviewed evidence points/);
   return {choices:[{finish_reason:'stop',message:{content:draft}}],usage:{neurons:3}};
  }
  assert.match(input.messages[0].content,/previous revision is still underdeveloped/);
  assert.match(input.messages[1].content,/Paragraph sentence counts: \d+/);
  return {choices:[{finish_reason:'stop',message:{content:
   'Practical wisdom is a true and reasoned capacity for acting about things good or bad for human beings [S1]. It concerns judgment about what to do in human affairs, and Aristotle connects it with deliberation because these matters can turn out otherwise. He also calls it a right rule concerning virtue, indicating that it guides virtuous action rather than merely describing it [S1, S2].\n\nThis makes it different from scientific knowledge. Science proceeds by demonstration from principles that are necessary and invariable; practical questions concern possible actions and changing circumstances [S1]. Since people deliberate about alternatives where more than one outcome is possible, practical wisdom cannot be scientific demonstration. Its reasoning guides choice in contingent situations instead of proving conclusions that must always hold [S1].\n\nPractical wisdom is also different from skill or art because Aristotle distinguishes action from making [S3]. The two are different kinds of activity, so skill at producing something does not by itself amount to sound judgment about how to act. The excerpt supports that basic distinction, though it does not provide a detailed account of particular crafts. The comparison marks the scope of practical wisdom without making unsupported claims about specific skills [S1, S3].'}}],usage:{neurons:4}};
 }};
 const result=await composeVerifiedAnswer(question,sources,ai);
 assert.equal(calls.length,4);
 assert.equal(result.coverage,'full');
 assert.match(result.answer,/deliberation because these matters can turn out otherwise/);
 assert.match(result.answer,/principles that are necessary and invariable/);
 assert.match(result.answer,/action from making/);
 assert(result.answer.trim().split(/\s+/).length>=180);
 const paragraphs=result.answer.trim().split(/\r?\n\s*\r?\n/).filter(Boolean);
 assert.equal(paragraphs.length,3);
 assert(paragraphs.every(paragraph=>(paragraph.match(/[.!?](?=\s|$)/g)||[]).length>=3));
 assert.deepEqual(result.citations.map(source=>source.id),['S1','S2','S3']);
});

test('fragmentary passages cannot be completed or attributed to the catalog author',async()=>{
 const question='What did Kierkegaard have to say about faith?';
 const sources=[
  {id:'S1',bookId:'436',title:'Kierkegaard’s Attack Upon “Christendom,” 1854–1855 — Søren Kierkegaard',page:21,
   preview:'There is another respect in which S. K. was more evidently a Catholic; in the Instant he has nothing to say about faith, except…'},
  {id:'S2',bookId:'140',title:'Fear and Trembling — Søren Kierkegaard',page:32,
   preview:'If there is no incommensurability in human life, then Hegel is right; but he is not right in talking about faith.'}
 ];
 const inputs=[];let call=0;
 const ai={run:async(_model,input)=>{
  inputs.push(input);call++;
  const content=call===1?
   JSON.stringify({coverage:'partial',missing:'The excerpt on The Instant ends before its point is complete.',evidence:[{id:'S2',point:'Relevant supported passage point.'}]}):
   'In Fear and Trembling, Kierkegaard challenges Hegel’s account of faith, while this passage alone does not give a complete definition of faith [S2].';
  return {choices:[{finish_reason:'stop',message:{content}}],usage:{neurons:3}};
 }};
 const result=await composeVerifiedAnswer(question,sources,ai);
 assert.equal(inputs.length,2);
 assert.match(inputs[0].messages[0].content,/Never turn a statement that the text does not discuss a subject/);
 assert.match(inputs[0].messages[0].content,/ellipsis, an unfinished clause/);
 assert.match(inputs[1].messages[0].content,/a catalog author is not automatically the speaker/);
 assert.match(inputs[1].messages[0].content,/do not complete a cut-off sentence/);
 assert.equal(result.coverage,'partial');
 assert.deepEqual(result.citations.map(source=>source.id),['S2']);
});

test('repairs an incomplete cited answer sentence from verified excerpts',async()=>{
 const sources=[{id:'S1',bookId:'436',
  title:'Kierkegaard’s Attack Upon “Christendom,” 1854–1855 — Søren Kierkegaard',
  page:21,preview:'In the Instant he has nothing to say about faith, except…'}];
 let call=0;
 const ai={run:async(_model,input)=>{
  call++;
  if(call===1)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   coverage:'partial',missing:'The sentence on faith is incomplete.',
   evidence:[{id:'S1',point:'The excerpt does not complete its statement about faith.'}]
  })}}],usage:{neurons:2}};
  if(call===2)return {choices:[{finish_reason:'stop',message:{content:
   'The text says that faith must not be [S1].'}}],usage:{neurons:2}};
  assert.match(input.messages[0].content,/Rewrite only the incomplete sentence or clause/);
  assert.match(input.messages[1].content,/Draft to repair/);
  return {choices:[{finish_reason:'stop',message:{content:
   'The excerpt ends before completing its statement about faith [S1].'}}],usage:{neurons:3}};
 }};
 const result=await composeVerifiedAnswer(
  'What did Kierkegaard have to say about faith?',sources,ai
 );
 assert.equal(result.coverage,'partial');
 assert.equal(result.answer,
  'The excerpt ends before completing its statement about faith [S1].');
 assert.equal(call,3);
});

test('removes a malformed cited fragment and returns a limitation instead of a 502',async()=>{
 const sources=[{id:'S1',bookId:'436',
  title:'Kierkegaard’s Attack Upon “Christendom,” 1854–1855 — Søren Kierkegaard',
  page:21,preview:'In the Instant he has nothing to say about faith, except…'}];
 let call=0;
 const ai={run:async()=>{
  call++;
  const content=call===1?
   JSON.stringify({coverage:'partial',missing:'The sentence on faith is incomplete.',evidence:[{id:'S1',point:'Relevant supported passage point.'}]}):
   'The text says that faith must not be [S1].';
  return {choices:[{finish_reason:'stop',message:{content}}],usage:{neurons:2}};
 }};
 const result=await composeVerifiedAnswer(
  'What did Kierkegaard have to say about faith?',sources,ai
 );
 assert.equal(call,3);
 assert.equal(result.coverage,'partial');
 assert.match(result.answer,/generated sentence was incomplete/i);
 assert.doesNotMatch(result.answer,/must not be/);
 assert.deepEqual(result.citations.map(source=>source.id),['S1']);
});


test('answer output explicitly discloses an unsupported requested part',async()=>{
 const question='According to Aristotle, what is practical wisdom, and how does it differ from scientific knowledge and skill?';
 const sources=[{id:'S1',bookId:'7',title:'Nicomachean Ethics — Aristotle',page:66,
  preview:'Practical wisdom is not science or art; action and making are different.'}];
 const calls=[];
 const ai={run:async(_model,input)=>{
  calls.push(input);
  if(calls.length===1)return {usage:{neurons:2},choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   coverage:'full',missing:'',
   questionParts:[
    {part:'define practical wisdom',status:'supported',evidenceIds:['S1']},
    {part:'contrast with scientific knowledge',status:'supported',evidenceIds:['S1']},
    {part:'contrast with skill',status:'unsupported',evidenceIds:[]}
   ],
   evidence:[{id:'S1',point:'Practical wisdom is distinct from science and art.'}]
  })}}]};
  return {usage:{neurons:3},choices:[{finish_reason:'stop',message:{content:'Practical wisdom concerns action on matters that can vary [S1]. It is not scientific knowledge because such matters can be otherwise [S1].'}}]};
 }};
 const result=await composeVerifiedAnswer(question,sources,ai);
 assert.equal(result.coverage,'partial');
 assert.match(result.missing,/contrast with skill/);
 assert.match(result.answer,/do not fully address: contrast with skill/i);
 assert.equal(result.questionParts[2].status,'unsupported');
 assert.match(calls[1].messages[1].content,/contrast with skill — unsupported/);
 assert.match(calls[1].messages[0].content,/Answer each requested part directly/);
 assert.match(calls[1].messages[0].content,/Answer each requested part directly/);
 assert.match(calls[1].messages[1].content,/contrast with skill — unsupported \[evidence: none\]/);
});
test('answer composition explicitly requests plain text instead of Markdown artifacts',async()=>{
 const {readFileSync}=await import('node:fs');
 const source=readFileSync(new URL('./public-gateway.mjs',import.meta.url),'utf8');
 assert.match(source,/Use plain text without headings or bullets/);
 assert.match(source,/Answer each requested part directly/);
 assert.match(source,/Develop the explanation/);
 assert.match(source,/let answer length follow the evidence/);
 assert.match(source,/when the excerpts support them/);
 assert.match(source,/cite each source-based sentence/);
 assert.match(source,/cite each work/);
 assert.match(source,/including an opening summary/);
 assert.match(source,/state its central answer first/);
 assert.match(source,/reports another thinker’s view supports only the reported view/);
 assert.match(source,/the passage must address the exact issue asked about/);
});


test('review keeps concise source-linked points for answer synthesis',()=>{
 const sources=[
  {id:'S1',bookId:'140',title:'Fear and Trembling',page:32,preview:'Faith and Hegel.'},
  {id:'S2',bookId:'253',title:'The Sickness Unto Death',page:93,preview:'Faith is the opposite of sin.'}
 ];
 const review=parseReview(JSON.stringify({coverage:'partial',missing:'A broader account is not established.',
  evidence:[{id:'S1',point:'Kierkegaard challenges Hegel’s account of faith.',speaker:'Kierkegaard'},
   {id:'S2',point:'Christianity makes faith the opposite of sin, not virtue.'},
   {id:'S2',point:'The passage connects faith with the possibility of offense.'}]}),sources);
 assert.deepEqual(review.selected.map(source=>source.id),['S1','S2']);
 assert.deepEqual(review.evidenceMap,[
  {id:'S1',point:'Kierkegaard challenges Hegel’s account of faith.',quoteVerified:false},
  {id:'S2',point:'Christianity makes faith the opposite of sin, not virtue.',quoteVerified:false},
  {id:'S2',point:'The passage connects faith with the possibility of offense.',quoteVerified:false}
 ]);
});

test('answer composition receives the reviewed evidence map as its outline',async()=>{
 const sources=[{id:'S1',bookId:'253',title:'The Sickness Unto Death',page:93,
  preview:'For the whole of Christianity the opposite of sin is not virtue but faith.'}];
 const calls=[];
 const ai={run:async(_model,input)=>{
  calls.push(input);
  if(calls.length===1)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   coverage:'partial',missing:'These passages give a limited account.',
   evidence:[{id:'S1',point:'Christianity makes faith the opposite of sin, not virtue.',speaker:'Kierkegaard'}]
  })}}],usage:{neurons:2}};
  return {choices:[{finish_reason:'stop',message:{content:
   'In this passage, faith stands opposite sin rather than virtue [S1].'}}],usage:{neurons:3}};
 }};
 const result=await composeVerifiedAnswer('What does Kierkegaard say about faith?',sources,ai);
 assert.equal(calls.length,2);
 assert.deepEqual(result.evidenceMap,[{id:'S1',point:'Christianity makes faith the opposite of sin, not virtue.',quoteVerified:false}]);
 assert.match(calls[1].messages[1].content,/Evidence map \(reviewed points\):/);
 assert.match(calls[1].messages[1].content,/Christianity makes faith the opposite of sin, not virtue/);
 assert.doesNotMatch(calls[1].messages[1].content,/speaker: Kierkegaard/);
 assert.ok(calls[1].messages[0].content.length<3500,'composition guidance should stay compact');
 assert.match(calls[1].messages[0].content,/Answer each requested part directly/);
 assert.match(calls[1].messages[0].content,/Attribute claims to the visible speaker/);
 assert.match(calls[1].messages[0].content,/Preserve meaningful qualifications/);
 assert.match(calls[1].messages[0].content,/cite each source-based sentence/);
 assert.match(calls[1].messages[0].content,/Use prior conversation only to resolve references/);
 assert.match(calls[1].messages[0].content,/Cross-check answer and partChecks/);
});

test('a final relation audit removes claims that a verified quote does not establish',async()=>{
 const question='Is there a conflict between science and religion?';
 const sources=[
  {id:'S1',bookId:'38',title:'The Varieties of Religious Experience — William James',page:258,
   preview:'Not only are the other sciences and the philosophy still far from being completed, but in their present state we find them full of conflicts.'},
  {id:'S2',bookId:'317',title:'History of the Conflict Between Religion and Science — John William Draper',page:317,
   preview:'Had that intention been accomplished, there would have been at this day no conflict between science and religion.'}
 ];
 const calls=[];
 const ai={run:async(_model,input)=>{
  calls.push(input);
  if(calls.length===1)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   coverage:'partial',missing:'The passages do not settle the general relationship.',
   evidence:[
    {id:'S1',point:'James describes conflicts between sciences and philosophy.',
     quote:'in their present state we find them full of conflicts.'},
    {id:'S2',point:'Draper describes a counterfactual absence of conflict.',
     quote:'Had that intention been accomplished, there would have been at this day no conflict between science and religion.'}
   ]
  })}}],usage:{neurons:2}};
  if(calls.length===2)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   answer:'James says science and religion conflict over spiritual presences [S1]. Draper says this conflict could have been avoided [S2].',
   partChecks:[]
  })}}],usage:{neurons:2}};
  assert.match(input.messages[0].content,/A literal quote match does not verify a stronger paraphrase/);
  assert.match(input.messages[0].content,/a different conflict does not establish the requested relation/);
  assert.match(input.messages[1].content,/All verified source excerpts/);
  return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   answer:'James describes conflicts between the sciences and philosophy, which does not by itself establish a conflict between science and religion [S1]. Draper imagines a counterfactual in which a religious council would have prevented such a conflict; that hypothetical does not settle whether a conflict exists [S2].',
   partChecks:[]
  })}}],usage:{neurons:3}};
 }};
 const result=await composeVerifiedAnswer(question,sources,ai);
 assert.equal(calls.length,3);
 assert.equal(result.coverage,'partial');
 assert.equal(result.reviewStatus,'claim_support_not_independently_verified');
 assert.match(result.notice,/Exact indexed page text verified.*Individual AI claims still require assessment/);
 assert.match(result.answer,/does not by itself establish a conflict between science and religion/);
 assert.match(result.answer,/that hypothetical does not settle whether a conflict exists/);
 assert.doesNotMatch(result.answer,/conflict over spiritual presences/);
 assert.deepEqual(result.citations.map(source=>source.id),['S1','S2']);
});

test('public pilot preserves relation-audit failure codes for diagnostics',async()=>{
 let calls=0;
 const pilot=await pilotScenario({model:async(_model,input)=>{
   calls++;
   if(input.max_completion_tokens===520)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
     coverage:'partial',missing:'The excerpt does not address this relation.',
     evidence:[{id:'S1',point:'The source passage is unrelated context.'}]
   })}}]};
   if(calls===2)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
     answer:'The historical dispute involved causes of war [S1].',partChecks:[]
   })}}]};
   return {choices:[{finish_reason:'stop',message:{content:'audit response was not JSON'}}]};
 }});
 const response=await pilot.post({body:{question:'Is there a conflict between science and religion?'}});
 assert.equal(response.status,502);
 assert.equal((await response.json()).failureCode,'relation-claim-audit-retry-invalid');
});

test('public pilot identifies and measures an oversized initial composition safely',async()=>{
 const pilot=await pilotScenario({model:async(_model,input)=>{
   if(input.max_completion_tokens===520)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
     coverage:'full',missing:'',
     questionParts:[{part:'causes',status:'supported',evidenceIds:['S1']}],
     evidence:[{id:'S1',point:'The source passage gives a cause.'}]
   })}}]};
   const answer=('The source passage explains a supported cause [S1]. ').repeat(110);
   return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
     answer,partChecks:[{part:'causes',status:'supported',evidenceIds:['S1']}]
   })}}]};
 }});
 const response=await pilot.post({body:{question:'What causes this event?'}});
 assert.equal(response.status,502);
 const failure=await response.json();
 assert.equal(failure.failureCode,'answer-initial-composition-too-long');
 assert.equal(failure.failureStage,'initial-composition');
 assert(failure.failureAnswerCharacters>4800);
 assert.equal(pilot.stats().calls,2);
});

test('public pilot returns detailed cited answers above the former character ceiling',async()=>{
 const pilot=await pilotScenario({model:async(_model,input)=>{
   if(input.max_completion_tokens===520)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
     coverage:'full',missing:'',
     questionParts:[{part:'causes',status:'supported',evidenceIds:['S1']}],
     evidence:[{id:'S1',point:'The source passage gives a cause.'}]
   })}}]};
   const answer=('The source passage explains a supported cause and gives its reason [S1]. ').repeat(45);
   return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
     answer,partChecks:[{part:'causes',status:'supported',evidenceIds:['S1']}]
   })}}]};
 }});
 const response=await pilot.post({body:{question:'What causes this event?'}});
 assert.equal(response.status,200);
 const result=await response.json();
 assert.equal(result.outcome,'verified-source-draft');
 assert(result.answer.length>2400&&result.answer.length<=4800);
 assert.deepEqual(result.citations.map(source=>source.id),['S1']);
 assert.equal(pilot.stats().calls,2);
});
test('public pilot labels unexpected answer-pipeline failures without exposing messages',async()=>{
 let calls=0;
 const pilot=await pilotScenario({model:async(_model,input)=>{
   calls++;
   if(input.max_completion_tokens===520)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
     coverage:'partial',missing:'The excerpt supports only part of the question.',
     evidence:[{id:'S1',point:'The source contains a relevant point.'}]
   })}}],usage:{neurons:1}};
   const result={choices:[{finish_reason:'stop',message:{content:JSON.stringify({
     answer:'The passage makes a limited claim [S1].',partChecks:[]
   })}}]};
   Object.defineProperty(result,'usage',{get(){
     throw new Error('private provider response body and passage text');
   }});
   return result;
 }});
 const response=await pilot.post({body:{question:'What does this passage say?'}});
 assert.equal(response.status,502);
 const failure=await response.json();
 assert.equal(failure.failureCode,'answer-generation-or-citation-failed');
 assert.equal(failure.failureStage,'answer-pipeline');
 assert.equal(failure.failureProviderClass,undefined);
 assert.equal(JSON.stringify(failure).includes('private provider response body'),false);
 assert.equal(JSON.stringify(failure).includes('passage text'),false);
 assert.equal(pilot.stats().calls,2);
});

test('public pilot retries a malformed relation audit response once',async()=>{
 let calls=0;
 const pilot=await pilotScenario({model:async(_model,input)=>{
   calls++;
   if(input.max_completion_tokens===520)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
     coverage:'partial',missing:'The source does not address this relation.',
     evidence:[{id:'S1',point:'The source passage is unrelated context.'}]
   })}}]};
   if(calls===2)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
     answer:'The passage explains causes of the Peloponnesian War [S1].',partChecks:[]
   })}}]};
   if(calls===3)return {choices:[{finish_reason:'stop',message:{content:'malformed first audit response'}}]};
   assert.match(input.messages[0].content,/Required shape/);
   return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
     answer:'The supplied excerpt concerns causes of the Peloponnesian War, not science or religion [S1]. It cannot establish whether science and religion conflict.',
     partChecks:[]
   })}}],usage:{neurons:1}};
 }});
 const response=await pilot.post({body:{question:'Is there a conflict between science and religion?'}});
 assert.equal(response.status,200);
 const result=await response.json();
 assert.equal(calls,4);
 assert.match(result.answer,/cannot establish whether science and religion conflict/);
});



test('a mapped point with an unverified quote still triggers the existing evidence repair',async()=>{
 const question='In Hamlet’s soliloquy, how does uncertainty about death affect his reasoning?';
 const source={id:'S1',bookId:'212',title:'Hamlet — William Shakespeare',page:140,
  preview:'To die, to sleep; perchance to dream: ay, there is the rub; for in that sleep of death what dreams may come must give us pause.'};
 const calls=[];
 const ai={run:async(_model,input)=>{
  calls.push(input);
  if(calls.length===1)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   coverage:'partial',missing:'The uncertainty is only partly explained.',
   questionParts:[{part:'effect of uncertainty about death',status:'partial',evidenceIds:['S1']}],
   evidence:[{id:'S1',point:'The possibility of dreams after death makes Hamlet pause.',
    quote:'perchance to dream of the unknown afterlife'}]
  })}}]};
  if(calls.length===2)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   answer:'Hamlet considers whether the possibility of dreams in death should make him hesitate [S1].',
   partChecks:[{part:'effect of uncertainty about death',status:'partial',evidenceIds:['S1']}]
  })}}]};
  assert.match(input.messages[0].content,/Repair only the requested parts/);
  assert.match(input.messages[1].content,/proposed quote not verified; recheck the point against the full excerpt/);
  assert.match(calls[1].messages[0].content,/quote-unverified means only that its proposed quotation could not be matched exactly/);
  return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   answer:'Hamlet weighs ending suffering through death against enduring life, but the unknown possibility of dreams after death makes him pause [S1]. The passage presents that uncertainty as a reason he hesitates before choosing death.',
   partChecks:[{part:'effect of uncertainty about death',status:'supported',evidenceIds:['S1']}]
  })}}]};
 }};
 const result=await composeVerifiedAnswer(question,[source],ai);
 assert.equal(calls.length,3,'reuse the existing conditional part-repair request');
 assert.equal(result.coverage,'full');
 assert.equal(result.questionParts[0].status,'supported');
 assert.match(result.answer,/unknown possibility of dreams after death makes him pause/);
});
