import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import gateway,{handleRequest,validRequest,trustedSources,trustedPacketSources,verifiedFingerprintSources,parseReview,composeVerifiedAnswer,sourceExcerpt,turnstileRejection,inferenceFailureDiagnostics,answerPipelineFailureDiagnostics,workerVersionDiagnostics,PILOT_BOOKS,PILOT_BOOK_IDS,planSearchQueries} from './public-gateway.mjs';

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
 assert.equal(quotaError.providerClass,'quota-or-credit-limit');
 assert.equal(JSON.stringify(quotaError).includes('10,000 Neurons'),false);
 const quotaCode=inferenceFailureDiagnostics({name:'AIError',code:3036,message:'request failed'});
 assert.equal(quotaCode.providerClass,'quota-or-credit-limit');
 assert.equal(quotaCode.providerCode,'3036');
 const capacityError=inferenceFailureDiagnostics({name:'Error',status:429,code:3040,
  message:'Capacity temporarily exceeded, please try again.'});
 assert.equal(capacityError.providerClass,'capacity-unavailable');
 assert.equal(capacityError.providerCode,'3040');
});

test('unexpected answer-pipeline errors retain a safe stage and failure class',()=>{
 const error=new Error('private provider body and passage text');
 const details=answerPipelineFailureDiagnostics(error);
 assert.equal(details.stage,'answer-pipeline');
 assert.equal(details.providerClass,'unknown');
 assert.equal(details.providerErrorName,'Error');
 assert.equal(JSON.stringify(details).includes('private provider body'),false);
 assert.equal(JSON.stringify(details).includes('passage text'),false);
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
 assert.match(inputs[1].messages[0].content,/Do not treat a commentary excerpt as the primary text/);
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
   preview:'1 JOHN 4\n18 Little children, let us love, not in word or speech, but in truth and action.\n 7 Beloved, let us love one another, because love is from God.\n19 And by this we will know that we are from the truth and will reassure our hearts before him.\n 8 Whoever does not love does not know God, for God is love.\n20 Whenever our hearts condemn us; for God is greater than our hearts.'}
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
   'In 1 John 4:7–12, love comes from God: those who love are born of God and know God, while the one who does not love does not know God [S1]. The passage shows God’s love in sending the Son so that we may live through him, and says that God loved us first [S1]. Because God loved us in this way, we ought to love one another; when we do, God abides in us and His love is perfected in us [S1].'}}]};
 }};
 const result=await composeVerifiedAnswer(question,sources,ai);
 assert.equal(call,2);
 assert.equal(result.coverage,'full');
 assert.deepEqual(result.citations.map(source=>source.id),['S1']);
 assert.match(inputs[0].messages[1].content,/7 Beloved, let us love one another/);
 assert.match(inputs[0].messages[1].content,/12 No one has seen God/);
 assert.match(inputs[0].messages[1].content,/10 In this is love/);
 assert.match(inputs[0].messages[1].content,/atoning sacrifice for our sins/);
 assert.doesNotMatch(inputs[0].messages[1].content,/Christians are reminded that their obligation/);
 assert.doesNotMatch(inputs[0].messages[1].content,/truth and action/);
 assert.doesNotMatch(inputs[0].messages[1].content,/will reassure our hearts before him/);
 assert.doesNotMatch(inputs[0].messages[1].content,/13 By this we know/);
 assert.doesNotMatch(inputs[0].messages[1].content,/16 And we have known/);
 assert.doesNotMatch(inputs[0].messages[1].content,/21 And this commandment/);
 assert.doesNotMatch(inputs[0].messages[1].content,/brotherly love itself/);
 assert.doesNotMatch(result.answer,/brother must love|abides in God/);
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
  return {choices:[{finish_reason:'stop',message:{content:
   'Darwin describes natural selection as preserving favorable variations across generations [S1].'}}],usage:{neurons:3}};
 }};
 const result=await composeVerifiedAnswer(question,sources,ai);
 assert.equal(result.outcome,'verified-source-draft');
 assert.equal(result.evidenceMap[0].quoteVerified,false);
 assert.match(inputs[0].messages[0].content,/Do not mark coverage none solely because an exact quote or qualifier is unavailable/);
 assert.match(inputs[1].messages[0].content,/An evidence point without an exact verified passage anchor/);
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
 assert.match(inputs[1].messages[0].content,/use the questionParts checklist to make sure/);
 assert.match(inputs[1].messages[0].content,/For a distinction directly stated in an excerpt/);
 assert.match(inputs[1].messages[0].content,/normally have three to five complete sentences/);
 assert.match(inputs[1].messages[0].content,/When exactly two distinct question parts are supported/);
 assert.match(inputs[1].messages[0].content,/aim for about 150–220 words overall when the passages support that depth, but continue when distinct evidence-supported qualifications, examples, or implications add value/);
 assert.match(inputs[1].messages[0].content,/when at least three support the answer, aim for about 150–220 words, even for a narrowly framed question/);
 assert.doesNotMatch(inputs[1].messages[0].content,/For a narrow factual question, stay brief/);
 assert.match(inputs[1].messages[0].content,/exactly three developed, connected paragraphs/);
 assert.match(inputs[1].messages[0].content,/180–260 words overall/);
 assert.match(inputs[1].messages[0].content,/usually about 150–220 words/);
 assert.match(inputs[1].messages[0].content,/Open with a direct answer calibrated to the evidence/);
 assert.match(inputs[1].messages[0].content,/You may also use reliable general knowledge/);
 assert.match(inputs[1].messages[0].content,/Clearly mark this material with wording such as/);
 assert.match(inputs[1].messages[0].content,/never attach a book citation to outside context/);
 assert.match(inputs[1].messages[0].content,/When at least three distinct relevant evidence-map points support the answer, develop them in about 120–200 words, even if the question is narrowly framed/);
 assert.match(inputs[1].messages[0].content,/Complementary passages may support separate sides of a comparison or causal account/);
 assert.match(inputs[1].messages[0].content,/do not present two passages from one author as two independent perspectives/);
 assert.match(inputs[1].messages[0].content,/Avoid repetition, padding, and adjacent topics/);
 assert.match(inputs[1].messages[0].content,/should explain the point, its reason or distinction/);
 assert.match(inputs[1].messages[0].content,/do not force a one-item-per-paragraph outline/);
 assert.match(inputs[1].messages[0].content,/comparison between theoretical wisdom and practical wisdom/);
 assert.match(inputs[1].messages[0].content,/When distinct selected passages support different points, use up to six/);
 assert.equal(inputs[1].max_completion_tokens,1100);
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
  assert.match(input.messages[0].content,/including excerpts not selected by the first review/);
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
  if(inputs.length===1)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
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
  if(inputs.length===2){
   assert.match(input.messages[0].content,/Preserve the passage’s rhetorical force: a question, conjecture, hypothetical, accusation, reported opinion, or character’s theory is not automatically an asserted fact/);
   return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   answer:'Raskolnikov has a perfect right to murder because extraordinary people can break the law [S1]. The novel demonstrates that he no longer believes his theory [S2]. His poverty and repentance explain the murder and confession [S3].',
   partChecks:[
    {part:labels[0],status:'partial',evidenceIds:['S1']},
    {part:labels[1],status:'partial',evidenceIds:['S2','S3']}
   ]
  })}}]};
  }
  assert.equal(inputs.length,3);
  assert.match(input.messages[0].content,/attribute that description to the reporting speaker/);
  assert.match(input.messages[0].content,/do not merge that summary with the other person’s reply or qualification into a stronger, unqualified claim/);
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
  assert.match(input.messages[0].content,/prefer that author’s own submitted work/);
  assert.match(input.messages[1].content,/Philosophical Fragments — Søren Kierkegaard/);
  assert.match(input.messages[1].content,/Athens and Jerusalem — Lev Shestov, physical PDF page 55/);
  return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   answer:'Kierkegaard’s Philosophical Fragments warns that consequences founded on a paradox lose their value if later generations treat them as an inherited settled estate [S1]. The passage says their meaning depends on keeping the paradox visible, like a city whose foundations would be forgotten at one’s peril. It therefore presents thought as returning to the original paradox rather than accepting inherited consequences uncritically. This shows one feature of Kierkegaard’s account in this text, though the excerpt does not define his whole philosophy [S1].\n\nShestov, by contrast, argues that human beings fear freedom and try to bind even God to eternal principles [S3]. He contrasts divine creative power with the human tendency to imitate and to accept rational limits. In the same passage he criticizes the idea that necessity makes some possibilities impossible even for God [S3]. The difference in emphasis is that Kierkegaard’s excerpt focuses on preserving the paradox, while Shestov challenges the rational necessity that would restrict creative freedom. This is a synthesis of these passages, not a direct exchange between the authors [S1, S3].',
   partChecks:[
    {part:"Kierkegaard's thought",status:'supported',evidenceIds:['S1']},
    {part:"Shestov's thought",status:'supported',evidenceIds:['S3']}
   ]
  })}}],usage:{neurons:4}};
 }};
 const result=await composeVerifiedAnswer(question,sources,ai);
 assert.equal(calls.length,3);
 assert.equal(result.coverage,'full');
 assert.deepEqual(result.questionParts.map(part=>part.status),['supported','supported']);
 assert.deepEqual(result.citations.map(source=>source.id),['S1','S3']);
 assert.match(result.answer,/Shestov, by contrast, argues that human beings fear freedom/);
});
test('separately supported accounts can support a cross-work synthesis',async()=>{
 const question="How does Aristotle's Nicomachean Ethics differ from Hobbes's Leviathan on what secures political order?";
 const sources=[
  {id:'S1',bookId:'7',title:'Nicomachean Ethics — Aristotle',page:2,
   preview:'Political science aims at the human good and happiness, and studies virtue of the soul.'},
  {id:'S2',bookId:'163',title:'Leviathan — Thomas Hobbes',page:90,
   preview:'A common power is necessary to keep people in awe and secure observance of justice and the laws of nature.'}
 ];
 const calls=[];
 const ai={run:async(_model,input)=>{
   calls.push(input);
   if(calls.length===1)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
     coverage:'full',missing:'',
     questionParts:[
       {part:"Compare how Aristotle's and Hobbes's accounts secure political order",status:'partial',evidenceIds:['S1','S2']}
     ],
     evidence:[
       {id:'S1',point:'Aristotle connects political science with human good, happiness, and virtue.'},
       {id:'S2',point:'Hobbes says common power secures justice and observance of law.'}
     ]
   })}}]};
   return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
     answer:"Aristotle connects political order to the human good and the cultivation of virtue, framing politics around the kind of life and character a community should support [S1]. This account makes the ethical end of civic life central to political inquiry.\n\nHobbes instead emphasizes the institution of a common power, which keeps people in awe and makes justice and the laws of nature more reliably observed [S2]. The contrast is a synthesis of these passages: Aristotle foregrounds the end politics serves, while Hobbes foregrounds the authority needed to secure order. The passages support those distinct emphases, though neither excerpt directly compares the two thinkers.",
     partChecks:[
       {part:"Compare how Aristotle's and Hobbes's accounts secure political order",status:'partial',evidenceIds:['S1','S2']}
     ]
   })}}]};
 }};
 const result=await composeVerifiedAnswer(question,sources,ai);
 assert.equal(calls.length,2);
 assert.match(calls[0].messages[0].content,/A passage can support its own side without explicitly comparing it/);
 assert.match(calls[1].messages[0].content,/reader synthesis/);
 assert.equal(result.coverage,'full');
 assert.equal(result.questionParts.length,1);
 assert.equal(result.questionParts[0].status,'supported');
 assert.deepEqual(result.citations.map(source=>source.id),['S1','S2']);
});

test('single named work keeps existing evidence-review coverage behavior',()=>{
 const sources=[{id:'S1',bookId:'7',title:'Nicomachean Ethics — Aristotle',preview:'Virtue develops through habit.'}];
 const result=parseReview(JSON.stringify({coverage:'full',missing:'',evidence:[{id:'S1',point:'Relevant supported passage point.'}]}),sources,
   'How does Aristotle explain becoming virtuous through repeated actions?');
 assert.equal(result.coverage,'full');
 assert.equal(result.missing,'');
});
test('evidence review follow-ups are short, specific, and grounded in selected passages',()=>{
 const question='How does Darwin explain variation?';
 const sources=[
  {id:'S1',title:'On the Origin of Species — Charles Darwin',
   preview:'A variation is inherited; a change has an effect, and the text connects a change with its effect.'},
  {id:'S2',title:'Augustine on miracles',preview:'Augustine discusses miracles in a separate work.'}
 ];
 const review=parseReview(JSON.stringify({coverage:'full',missing:'',evidence:[{id:'S1',point:'Relevant supported passage point.'}],
   followUpQuestions:[
    'What changes when a variation is inherited?',
    'What changes when a variation is inherited?',
    'How does the text connect a change with its effect?',
    'How does Augustine discuss miracles in his work?',
    'This prompt is too short?'
   ]}),sources,question);
 assert.deepEqual(review.followUpQuestions,[
   'What changes when a variation is inherited?',
   'How does the text connect a change with its effect?']);
 const none=parseReview(JSON.stringify({coverage:'none',missing:'',evidence:[],
   followUpQuestions:['What does the evidence say about this?']}),sources,question);
 assert.deepEqual(none.followUpQuestions,[]);
});

test('source selection is bound to ID from server-fetched content',()=>{
 const sources=[{id:'S1',preview:'verified from trusted book'}];
 const review=parseReview(JSON.stringify({coverage:'full',missing:'',evidence:[{id:'S5',point:'Relevant supported passage point.'},{id:'S1',point:'Relevant supported passage point.'}]}),sources);
 assert.deepEqual(review.selected,sources);
});

test('an ID without a reviewed support point cannot authorize answer composition',()=>{
 const sources=[{id:'S1',preview:'verified from trusted book'}];
 const review=parseReview(JSON.stringify({coverage:'full',missing:'',evidence:[{id:'S1'}]}),sources);
 assert.equal(review.coverage,'none');
 assert.deepEqual(review.selected,[]);
 assert.deepEqual(review.evidenceMap,[]);
 assert.match(review.missing,/did not identify a supported point/);
});
test('multipart question coverage is derived from each explicitly tracked part',()=>{
 const question='According to Aristotle, what is practical wisdom, and how does it differ from scientific knowledge and skill?';
 const sources=[
  {id:'S1',bookId:'7',title:'Nicomachean Ethics — Aristotle',page:66,preview:'Practical wisdom is not science or art.'},
  {id:'S2',bookId:'7',title:'Nicomachean Ethics — Aristotle',page:67,preview:'Practical wisdom concerns variable matters.'}
 ];
 const review=parseReview(JSON.stringify({
  coverage:'full',missing:'',
  questionParts:[
   {part:'define practical wisdom',status:'supported',evidenceIds:['S1']},
   {part:'contrast practical wisdom with scientific knowledge',status:'supported',evidenceIds:['S1']},
   {part:'contrast practical wisdom with skill',status:'unsupported',evidenceIds:[]}
  ],
  evidence:[
   {id:'S1',point:'Practical wisdom is distinct from science and art.'},
   {id:'S2',point:'Practical wisdom concerns variable matters.'}
  ]
 }),sources,question);
 assert.equal(review.coverage,'partial');
 assert.match(review.missing,/contrast practical wisdom with skill/);
 assert.equal(review.questionParts.length,3);
 assert.equal(review.questionParts[2].status,'unsupported');
});
test('authentic sources flow through two calls and yield the canonical URL',async()=>{
 let runs=0;
 const e=env({AI:{run:async(_model,input)=>{
 runs++;
 return {choices:[{finish_reason:'stop',message:{content:
  input.max_completion_tokens===280 ?
  '{"coverage":"full","missing":"","evidence":[{"id":"S1","point":"Relevant supported passage point."}]}' :
  'The dispute and growth of power both matter [S1].'}}],usage:{neurons:6}};
 }}});
 const response=await handleRequest(request(),e,fetcher);
 assert.equal(response.status,200);
 const data=await response.json();
 assert.equal(runs,2);
 assert.equal(data.coverage,'full');
 assert.equal(data.citations[0].page,38);
 assert.equal(data.citations[0].globalPageId,0);
 assert.equal(data.usage.neurons,12);
 assert.equal(data.reviewStatus,'claim_support_not_independently_verified');
});
test('truncated retrieved passage retains causal sentence rather than a short keyword hit',()=>{
 const text='Historical context before the conflict. '.repeat(10)+
 'The first dispute was widely discussed. Yet the deeper explanation concerned fear of growing strength.';
 const preview=sourceExcerpt(text,'What were the disputes and deeper explanations?',1080);
 assert(preview.includes('deeper explanation'));
});

test('long source excerpts keep complete relevant sentences and their nearby context',()=>{
 const context='Earlier background that does not answer the question. '.repeat(35);
 const passage='The immediate dispute concerned a broken agreement. The underlying cause was fear of the rival city’s growing power. This fear shaped how leaders interpreted later events.';
 const preview=sourceExcerpt(context+passage,
   'What were the immediate dispute and underlying cause?',1080);
 assert(preview.startsWith('…'));
 assert(preview.includes('The immediate dispute concerned a broken agreement.'));
 assert(preview.includes('The underlying cause was fear of the rival city’s growing power.'));
 assert(preview.includes('This fear shaped how leaders interpreted later events.'));
 assert(preview.length<=1080);
});

test('long source excerpts prioritize rare requested details beyond an earlier topic cluster',()=>{
 const question='How does Darwin explain natural selection preserving favorable variations, and how does Hawking use astronomical observations to explain black-hole phenomena in A Brief History of Time?';
 const early=('The discussion of black holes and their history explains how a black hole may lose mass over time. ').repeat(12);
 const later='We do observe a background of gamma rays, and its intensity differs across frequencies. These observations do not provide positive evidence for primordial black holes, but they constrain how many can exist.';
 const preview=sourceExcerpt('A Brief History of Time. Stephen Hawking. '+early+later,question,1080);
 assert.match(preview,/observations do not provide positive evidence for primordial black holes/i);
 assert.match(preview,/constrain how many can exist/i);
 assert(preview.length<=1080);
});

test('long excerpts retain complementary requested details and their nearby qualifications',()=>{
 const question='How does Hobbes describe the role of common power in preventing conflict, and what happens without it?';
 const opening='A discussion of people and their interests sets the scene. '.repeat(15);
 const passage='Hobbes argues that without a common power to keep them all in awe, people cannot rely on justice and the laws of nature alone. They hinder one another through disagreement and may make war on each other when there is no common enemy. A common power provides protection by directing their strength toward peace, rather than leaving each person to act on private judgment.';
 const closing='The chapter then turns to a separate example. '.repeat(15);
 const preview=sourceExcerpt(opening+passage+closing,question,1080);
 assert.match(preview,/without a common power to keep them all in awe/i);
 assert.match(preview,/may make war on each other when there is no common enemy/i);
 assert.match(preview,/private judgment/i);
 assert(preview.length<=1080);
});

test('excerpt selection follows a question’s causal explanation after its topic is introduced',()=>{
 const question='How do inherited variations, struggle for existence, and natural selection relate?';
 const earlier='The first chapter describes variation under domestication and the power of selection. '.repeat(9);
 const explanation='In the next chapter the struggle for existence follows because many more individuals are born than can possibly survive. Any being that varies in a profitable way has a better chance of surviving and is naturally selected. From the strong principle of inheritance, any selected variety tends to propagate its new and modified form.';
 const later='The next chapter will consider extinction and divergence of character. '.repeat(8);
 const preview=sourceExcerpt(earlier+explanation+later,question,1080);
 assert.match(preview,/many more individuals are born than can possibly survive/i);
 assert.match(preview,/has a better chance of surviving and is naturally selected/i);
 assert.match(preview,/strong principle of inheritance/i);
 assert(preview.length<=1080);
});

test('long dialogue excerpts keep the reporting speaker and the reply qualification together',()=>{
 const question='How does Raskolnikov explain extraordinary people and what qualification does he make?';
 const opening='The conversation begins with a question about an earlier article. '.repeat(12);
 const dialogue='Porfiry says that Raskolnikov’s idea gives extraordinary people a right to transgress the law. Raskolnikov replies, “That wasn’t quite my contention,” and clarifies that he does not claim extraordinary people are always bound to commit breaches of morality. He says the only difference is that he doubts such an argument could be published.';
 const preview=sourceExcerpt(opening+dialogue,question,1080);
 assert.match(preview,/Porfiry says that Raskolnikov/i);
 assert.match(preview,/Raskolnikov replies/i);
 assert.match(preview,/does not claim extraordinary people are always bound/i);
 assert(preview.length<=1080);
});

test('evidence anchors preserve the speaker and conditional qualifier from the same verified excerpt',()=>{
 const preview='Bees and ants can live sociably without a sovereign. '+
  'Additional background about political animals and shared interests. '.repeat(4)+
  'If a great multitude could observe justice without a common power to keep them in awe, there would be peace without subjection and no need for civil government.';
 const sentence='If a great multitude could observe justice without a common power to keep them in awe, there would be peace without subjection and no need for civil government.';
 const quote='without a common power to keep them in awe, there would be peace without subjection';
 const review=parseReview(JSON.stringify({coverage:'full',missing:'',evidence:[{
  id:'S1',point:'Hobbes treats common power as necessary because people will not reliably keep peace unaided.',
  quote,speaker:'Hobbes',qualifier:'If a great multitude could observe justice without a common power'}
 ]}),[{id:'S1',preview}]);
 assert.deepEqual(review.evidenceMap,[{id:'S1',
  point:'Hobbes treats common power as necessary because people will not reliably keep peace unaided.',
  quoteVerified:true,anchorQuote:sentence,speaker:'Hobbes',
  qualifier:'If a great multitude could observe justice without a common power'}]);
 const bad=parseReview(JSON.stringify({coverage:'full',missing:'',evidence:[{
  id:'S1',point:'Hobbes treats common power as necessary.',quote:'People always need a king.',
  speaker:'Hobbes',qualifier:'unless the moon is full'
 }]}),[{id:'S1',preview}]);
 assert.equal(bad.evidenceMap[0].quoteVerified,false);
 assert.equal('anchorQuote' in bad.evidenceMap[0],false);
 assert.equal('qualifier' in bad.evidenceMap[0],false);
});

test('evidence-focused highlights choose the cited point instead of a topical opening',()=>{
 const text='Bees and ants live sociably one with another. '+
  'Background about their appetites and natural agreement. '.repeat(5)+
  'If a great multitude could observe justice without a common power to keep them in awe, there would be peace without subjection and no need for civil government.';
 const evidence='Without a common power to keep them in awe, Hobbes says people live in conflict; peace without subjection is only the hypothetical condition in which they could all observe justice.';
 const quote=sourceExcerpt(text,evidence,320);
 assert.match(quote,/common power to keep them in awe/i);
 assert.match(quote,/If a great multitude could observe justice/i);
 assert.doesNotMatch(quote,/Bees and ants/);
});

test('long source excerpts without searchable question terms end on sentence boundaries',()=>{
 const text='A complete sentence gives background. '.repeat(8);
 const preview=sourceExcerpt(text,'the and for',82);
 assert(preview.length<=82);
 assert.match(preview.replace(/…$/,''),/\.$/);
});

test('source probe fails closed when token binding is missing',async()=>{
 let fetched=0,models=0;
 const e=env({PUBLIC_ENABLED:'false',AI:{run:async()=>{models++;}}});
 const response=await handleRequest(
   new Request(HOST+'/internal/source-probe',{method:'POST'}),
   e,()=>{fetched++;return fetcher(...arguments);}
 );
 assert.equal(response.status,503);
 assert.equal(fetched,0);
 assert.equal(models,0);
});
test('source probe rejects incorrect credentials before any corpus fetch',async()=>{
 let fetched=0;
 const e=env({PUBLIC_ENABLED:'false',SOURCE_PROBE_TOKEN:'x'.repeat(40)});
 const response=await handleRequest(
   new Request(HOST+'/internal/source-probe',{method:'POST',headers:{Authorization:'Bearer wrong'}}),
   e,()=>{fetched++;throw Error('No fetch should be made');}
 );
 assert.equal(response.status,401);
 assert.equal(fetched,0);
});
test('source probe uses actual trustedSources under disabled public mode with no AI',async()=>{
 let runs=0;
 const token='protected-test-token-not-for-production-123456';
 const e=env({PUBLIC_ENABLED:'false',SOURCE_PROBE_TOKEN:token,
  AI:{run:async()=>{runs++;throw Error('No AI should run');}}});
 const response=await handleRequest(
   new Request(HOST+'/internal/source-probe',{method:'POST',
     headers:{Authorization:'Bearer '+token}}),
   e,fetcher
 );
 assert.equal(response.status,200);
 const result=await response.json();
 assert.equal(result.status,'retrieved');
 assert.equal(result.bookId,'152');
 assert.equal(result.page,38);
 assert.equal(result.globalPageId,0);
 assert.equal(result.cpuTimeMs,null);
 assert(result.sourceUrl.includes(PDF));
 assert(result.excerptLength>30);
 assert.equal(runs,0);
});

test('Cloudflare fetch(request,env,ctx) does not mistake ctx for a network fetcher',async()=>{
 const saved=globalThis.fetch;
 const token='protected-test-token-not-for-production-123456';
 let fetched=0;
 globalThis.fetch=(url,options)=>{
   assert.equal(typeof url,'string');
   fetched++;
   return fetcher(url,options);
 };
 try{
   const result=await gateway.fetch(
     new Request(HOST+'/internal/source-probe',{method:'POST',headers:{
       Authorization:'Bearer '+token
     }}),
     env({PUBLIC_ENABLED:'false',SOURCE_PROBE_TOKEN:token}),
     {waitUntil:()=>{},passThroughOnException:()=>{}}
   );
   assert.equal(result.status,200);
   assert.equal((await result.json()).page,38);
   assert.equal(fetched,2);
 }finally{
   globalThis.fetch=saved;
 }
});

test('authenticated static packet is bound to canonical cited source metadata',async()=>{
 const saved=globalThis.fetch;
 const packet={
  schema:'antilogicalism-reader-packet-v1',libraryVersion:47,
  bookId:'152',title:'History of the Peloponnesian War — Thucydides',
  pdfDriveId:PDF,chunk:1,firstPage:33,lastPage:64,
  pages:[{page:38,globalPageId:34403,
    text:'The real cause of the conflict was increasing strength in one city and fear among the rival city leaders. The immediate disputes were different.'}]
 };
 const fetchPacket=async url=>{
  assert.equal(url,'https://jsynon.github.io/antilogicalism-library-data/reader-packets-v1/books/152/1.json');
  return new Response(JSON.stringify(packet),{status:200,headers:{'Content-Type':'application/json'}});
 };
 const loaded=await trustedPacketSources(question,[{bookId:'152',page:38}],fetchPacket);
 assert.equal(loaded[0].page,38);
 assert.equal(loaded[0].globalPageId,34403);
 assert(loaded[0].preview.includes('real cause'));
 assert(loaded[0].url.includes(PDF));
 const token='protected-test-token-not-for-production-123456';
 const response=await handleRequest(new Request(HOST+'/internal/packet-probe',
   {method:'POST',headers:{Authorization:'Bearer '+token}}),
   env({PUBLIC_ENABLED:'false',SOURCE_PROBE_TOKEN:token,
     AI:{run:async()=>{throw Error('No AI allowed');}}}),fetchPacket);
 assert.equal(response.status,200);
 assert.equal((await response.json()).format,'static-packet-v1');
});
test('packet probe fails closed before any network traffic when token absent',async()=>{
 let fetchCount=0;
 const e=env({PUBLIC_ENABLED:'false'});
 const response=await handleRequest(new Request(HOST+'/internal/packet-probe',
  {method:'POST'}),e,async()=>{fetchCount++;throw Error('Must not fetch');});
 assert.equal(response.status,503);assert.equal(fetchCount,0);
});
test('forged packet metadata and duplicate claimed physical pages fail closed',async()=>{
 const original={
  schema:'antilogicalism-reader-packet-v1',libraryVersion:47,
  bookId:'152',title:'A Book',pdfDriveId:PDF,
  chunk:1,firstPage:33,lastPage:64,pages:[
   {page:38,globalPageId:34403,text:'This is the original indexed text copied into the packet. It contains historical sources.'}
  ]
 };
 const mock=packet=>async()=>Response.json(packet);
 await assert.rejects(trustedPacketSources(question,[{bookId:'152',page:38}],
  mock({...original,pdfDriveId:'file/abc'})),/Invalid trusted packet format/);
 await assert.rejects(trustedPacketSources(question,[{bookId:'152',page:38}],
  mock({...original,pages:[...original.pages,...original.pages]})),/Requested page not found/);
});


test('native SHA-256 accepts exact UTF-8 and binds original PDF metadata',async()=>{
 const content='The real cause of this historical conflict was increased strength and fear among rival cities. The truce disagreements were immediate disputes.';
 const raw=new TextEncoder().encode(content);
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)),x=>x.toString(16).padStart(2,'0')).join('');
 const canonical={
   schema:'antilogicalism-reader-fingerprints-v1',hashAlgorithm:'SHA-256-utf8-exact',
   libraryVersion:47,bookId:'152',chunk:1,firstPage:33,lastPage:64,
   title:'Canonical History — Thucydides',pdfDriveId:PDF,
   pages:[{page:38,globalPageId:34403,utf8Bytes:raw.byteLength,sha256:hash}]
 };
 const fetcher=async(url)=>{
   assert.equal(url,'https://jsynon.github.io/antilogicalism-library-data/reader-fingerprints-v1/books/152/1.json');
   return Response.json(canonical);
 };
 const sources=await verifiedFingerprintSources(question,[{bookId:'152',page:38,text:content,
    title:'Forged Title',url:'https://attacker.example/forged.pdf'}],fetcher);
 assert.equal(sources.length,1);
 assert.equal(sources[0].title,canonical.title);
 assert.equal(sources[0].globalPageId,34403);
 assert(sources[0].url.includes(PDF));
 assert(!sources[0].url.includes('attacker'));
 assert(sources[0].preview.includes('real cause'));
 await assert.rejects(verifiedFingerprintSources(question,[{
   bookId:'152',page:38,text:content.replace('real','fake')
 }],fetcher),/SHA-256 mismatch/);
 await assert.rejects(verifiedFingerprintSources(question,[{
   bookId:'152',page:38,text:content+' '
 }],fetcher),/length mismatch/);
});
test('one-byte tamper is rejected before AI even when request is authenticated',async()=>{
 const content='The original source passage is entirely different from text invented by the visitor. Its claim is grounded in this book page.';
 const textBytes=new TextEncoder().encode(content);
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',textBytes)),b=>b.toString(16).padStart(2,'0')).join('');
 const meta={schema:'antilogicalism-reader-fingerprints-v1',hashAlgorithm:'SHA-256-utf8-exact',
    libraryVersion:47,bookId:'152',title:'A Trusted Book',pdfDriveId:PDF,chunk:1,firstPage:33,lastPage:64,
    pages:[{page:38,globalPageId:34403,utf8Bytes:textBytes.length,sha256:digest}]};
 const url=HOST+'/internal/fingerprint-probe',secret='valid-long-local-fingerprint-test-secret-123';
 let aiCalls=0,remoteFetches=0;
 const environment=env({PUBLIC_ENABLED:'false',SOURCE_PROBE_TOKEN:secret,AI:{run:async()=>{aiCalls++;}}});
 const fetcher=async()=>{remoteFetches++;return Response.json(meta);};
 const original=new Request(url,{method:'POST',headers:{
    Origin:'http://127.0.0.1:8766',Authorization:'Bearer '+secret,
    'Content-Type':'application/json'},
    body:JSON.stringify({question,sources:[{bookId:'152',page:38,text:content}]})});
 const accepted=await handleRequest(original,environment,fetcher);
 assert.equal(accepted.status,200);
 const acceptedData=await accepted.json();
 assert.equal(acceptedData.status,'verified');
 assert.equal(acceptedData.sources[0].globalPageId,34403);
 assert.equal(accepted.headers.get('Access-Control-Allow-Origin'),'http://127.0.0.1:8766');
 const tampered=new Request(url,{method:'POST',headers:{
    Origin:'http://127.0.0.1:8766',Authorization:'Bearer '+secret,
    'Content-Type':'application/json'},
    body:JSON.stringify({question,sources:[{bookId:'152',page:38,text:content.replace('original','altered ')}]})});
 const rejected=await handleRequest(tampered,environment,fetcher);
 assert.equal(rejected.status,422);
 assert.equal(aiCalls,0);
 assert.equal(remoteFetches,2);
});
test('fingerprint route denies missing token and forbidden origins before fetching',async()=>{
 let fetched=0;
 const url=HOST+'/internal/fingerprint-probe';
 const sent={question,sources:[{bookId:'152',page:38,text:'Original historical passage describes causes and consequences of conflict between cities.'}]};
 const fetcher=async()=>{fetched++;throw Error('Must not fetch');};
 const response=await handleRequest(new Request(url,{method:'POST',headers:{
    Origin:'https://untrusted.invalid',Authorization:'Bearer test'},
    body:JSON.stringify(sent)}),env(),fetcher);
 assert.equal(response.status,403);
 const absent=await handleRequest(new Request(url,{method:'POST',body:JSON.stringify(sent)}),env(),fetcher);
 assert.equal(absent.status,503);
 assert.equal(fetched,0);
 const token='valid-long-local-fingerprint-test-secret-123';
 const wrong=await handleRequest(new Request(url,{method:'POST',
   headers:{Authorization:'Bearer not-the-secret'},body:JSON.stringify(sent)}),
   env({SOURCE_PROBE_TOKEN:token}),fetcher);
 assert.equal(wrong.status,401);
 assert.equal(fetched,0);
});
test('fingerprint route supports local CORS preflight without touching AI',async()=>{
 const response=await handleRequest(new Request(HOST+'/internal/fingerprint-probe',
 {method:'OPTIONS',headers:{Origin:'http://127.0.0.1:8766'}}),
 env({PUBLIC_ENABLED:'false'}),async()=>{throw Error('No network');});
 assert.equal(response.status,204);
 assert.equal(response.headers.get('Access-Control-Allow-Origin'),'http://127.0.0.1:8766');
});


async function fingerprintTestFixture() {
 const text='The public disputes were over a breached agreement, whereas growing power created fear among competing cities. The deeper cause of the war was stated to be anxiety over political change.';
 const bytes=new TextEncoder().encode(text);
 const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),
    b=>b.toString(16).padStart(2,'0')).join('');
 const fingerprint={schema:'antilogicalism-reader-fingerprints-v1',
    hashAlgorithm:'SHA-256-utf8-exact',libraryVersion:47,
    bookId:'152',title:'History of the Peloponnesian War — Thucydides',
    pdfDriveId:PDF,chunk:1,firstPage:33,lastPage:64,
    pages:[38,39,40,41,42,43].map((page,index)=>({page,globalPageId:34403+index,
      utf8Bytes:bytes.byteLength,sha256}))};
 const url=HOST+'/internal/verified-answer',
    secret='valid-private-token-for-the-verified-pilot-456';
 const body={question:'What caused the Peloponnesian War?',
    sources:[{bookId:'152',page:38,text}]};
 let fetchCount=0,aiCount=0;
 const fetcher=async requestUrl=>{
    fetchCount++;
    assert.equal(requestUrl,
      'https://jsynon.github.io/antilogicalism-library-data/reader-fingerprints-v1/books/152/1.json');
    return Response.json(fingerprint);
 };
 const run=async(_model,input)=>{
    aiCount++;
    const content=input.max_completion_tokens===520?
       JSON.stringify({coverage:'partial',missing:'More history is not in this page',
          evidence:[{id:'S1',point:'Relevant supported passage point.'}],followUpQuestions:[
            'Which disputes does Thucydides identify as immediate causes?',
            'How did Athens’ growing power affect Spartan fears?']})
       :'The passage distinguishes an immediate dispute from fear caused by growing power [S1].';
    return {choices:[{finish_reason:'stop',message:{content}}],
       usage:{neurons:9}};
 };
 const response=async({overrideBody=body,overrideToken=secret,
    origin='http://127.0.0.1:8766',aiRun=run,method='POST',overrideAI}={})=>{
     const request=new Request(url,{method,headers:{
       Origin:origin,Authorization:'Bearer '+overrideToken,
       'Content-Type':'application/json'},
       ...(method==='POST'?{body:JSON.stringify(overrideBody)}:{})});
     const environment=env({PUBLIC_ENABLED:'false',SOURCE_PROBE_TOKEN:secret,
       AI:overrideAI===undefined?{run:aiRun}:overrideAI});
     return handleRequest(request,environment,fetcher);
 };
 return {body,secret,response,fetcher,stats:()=>({aiCount,fetchCount}),run};
}
test('v1.9.4 exact v47 source generates two bounded AI stages with canonical citation',async()=>{
 const fixture=await fingerprintTestFixture();
 const result=await fixture.response();
 assert.equal(result.status,200);
 const data=await result.json();
 assert.equal(data.outcome,'verified-source-draft');
 assert.equal(data.verifiedPages,1);
 assert.equal(data.citations.length,1);
 assert.equal(data.citations[0].globalPageId,34403);
 assert.equal(data.citations[0].page,38);
 assert(data.citations[0].url.includes(PDF));
 assert.equal(data.coverage,'partial');
 assert.equal(data.reviewStatus,'claim_support_not_independently_verified');
 assert.equal(data.usage.neurons,18);
 assert.equal(fixture.stats().aiCount,2);
 assert.equal(fixture.stats().fetchCount,1);
 assert.equal(result.headers.get('Access-Control-Allow-Origin'),
    'http://127.0.0.1:8766');
});
test('v1.9.4 rejects modified same-length text before any inference',async()=>{
 const fixture=await fingerprintTestFixture();
 const forged={...fixture.body,sources:fixture.body.sources.map(s=>({
   ...s,text:s.text.replace('power','xxxxx')}))};
 const result=await fixture.response({overrideBody:forged});
 assert.equal(result.status,422);
 assert.equal((await result.json()).stage,'source-verification');
 assert.equal(fixture.stats().aiCount,0);
});
test('v1.9.4 denies unauthorized and unapproved-origin requests before fetching or AI',async()=>{
 const fixture=await fingerprintTestFixture();
 assert.equal((await fixture.response({overrideToken:'wrong'})).status,401);
 assert.equal((await fixture.response({origin:'https://evil.example'})).status,403);
 assert.equal(fixture.stats().aiCount,0);
 assert.equal(fixture.stats().fetchCount,0);
});
test('v1.9.4 fails closed without AI binding, never accidentally opening public endpoint',async()=>{
 const fixture=await fingerprintTestFixture();
 assert.equal((await fixture.response({overrideAI:null})).status,503);
 assert.equal(fixture.stats().fetchCount,0);
 const publicDisabled=await handleRequest(request(payload),
   env({PUBLIC_ENABLED:'false',SOURCE_PROBE_TOKEN:fixture.secret}),
   async()=>{throw Error('No public source reads');});
 assert.equal(publicDisabled.status,503);
});
test('an empty evidence review uses the existing composition call and still fails closed without support',async()=>{
 const fixture=await fingerprintTestFixture();
 let calls=0;
 const prompts=[];
 const result=await fixture.response({aiRun:async(_model,input)=>{
   prompts.push(input.messages);
   calls++;
   if(calls===1)return {choices:[{finish_reason:'stop',
     message:{content:JSON.stringify({coverage:'none',missing:'Unsupported topic',
       evidence:[]})}}],usage:{neurons:4}};
   return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
     answer:'The retrieved passages do not address the question.',
     partChecks:[{part:'What were the immediate and underlying causes of war?',
       status:'unsupported',evidenceIds:[]}]
   })}}],usage:{neurons:3}};
 }});
 assert.equal(result.status,200);
 const data=await result.json();
 assert.equal(data.outcome,'insufficient-evidence');
 assert.equal(data.citations.length,0);
 assert.equal(data.coverage,'none');
 assert.equal(calls,2);
 assert.match(prompts[1][1].content,/initial evidence-selection pass selected no passages/);
 assert.match(prompts[1][1].content,/Independently reassess every verified excerpt/);
 assert.doesNotMatch(prompts[1][1].content,/Coverage: none/);
 assert.doesNotMatch(prompts[1][1].content,/Missing: Unsupported topic/);
});
test('composition recovers relevant submitted passages after a false-negative evidence review',async()=>{
 const question='According to Thucydides, what were the underlying causes of the Peloponnesian War, and how did they differ from the immediate disputes that preceded it?';
 const sources=[
  {id:'S1',bookId:'152',title:'History of the Peloponnesian War — Thucydides',page:38,
   preview:'The real cause I consider to be the one which was formally most kept out of sight: the growth of the power of Athens, and the alarm which this inspired in Lacedaemon, made war inevitable.'},
  {id:'S2',bookId:'152',title:'History of the Peloponnesian War — Thucydides',page:59,
   preview:'The Potidaeans, who inhabit the isthmus of Pallene, being a Corinthian colony, but tributary allies of Athens, were ordered to raze the wall looking towards Pallene, to give hostages, to dismiss the Corinthian magistrates, and in future not to receive the persons sent from Corinth annually to succeed them.'}
 ];
 const calls=[];
 const ai={run:async(_model,input)=>{
  calls.push(input);
  if(calls.length===1)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   coverage:'none',missing:'No selected passage was found.',
   questionParts:[
    {part:'underlying cause of the war',status:'unsupported',evidenceIds:[]},
    {part:'immediate disputes and how they differ from the underlying cause',status:'unsupported',evidenceIds:[]}
   ],evidence:[]
  })}}],usage:{neurons:2}};
  assert.match(input.messages[1].content,/growth of the power of Athens/);
  assert.match(input.messages[1].content,/Potidaeans/);
  assert.match(input.messages[1].content,/initial evidence-selection pass selected no passages/);
  assert.doesNotMatch(input.messages[1].content,/Coverage: none/);
  assert.doesNotMatch(input.messages[1].content,/Evidence map \(reviewed points\):/);
  assert.match(input.messages[0].content,/derive one to four concise requested parts/);
  assert.match(input.messages[0].content,/first evidence reviewer selected no passages/);
  assert.doesNotMatch(input.messages[0].content,/questionParts checklist/);
  assert.doesNotMatch(input.messages[0].content,/organize the answer around the evidence map/);
  return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   answer:'Thucydides identifies the hidden underlying cause as “the growth of the power of Athens” and the alarm this caused in Lacedaemon [S1]. He presents that growth and fear as making war inevitable, distinguishing them from the complaints that appeared closer to the outbreak [S1]. The underlying cause is therefore the continuing shift in power and the fear it generated, rather than one isolated grievance [S1].\n\nThe immediate disputes included Athens’ orders to Potidaea, a Corinthian colony and Athenian tributary, to raze its walls, provide hostages, and dismiss Corinthian magistrates [S2]. Thucydides also notes that Athens ordered Potidaea not to receive the persons sent from Corinth annually to succeed those magistrates [S2]. These were concrete disputes preceding the war; the deeper cause was the growth of Athenian power and the alarm it inspired in Lacedaemon [S1, S2].',
   partChecks:[
    {part:'underlying cause of the war',status:'supported',evidenceIds:['S1']},
    {part:'immediate disputes and how they differ from the underlying cause',status:'supported',evidenceIds:['S1','S2']}
   ]
  })}}],usage:{neurons:3}};
 }};
 const result=await composeVerifiedAnswer(question,sources,ai);
 assert.equal(calls.length,2);
 assert.equal(result.outcome,'verified-source-draft');
 assert.equal(result.coverage,'full');
 assert.deepEqual(result.citations.map(source=>source.id),['S1','S2']);
 assert.deepEqual(result.questionParts.map(part=>part.status),['supported','supported']);
 assert.match(result.answer,/growth of Athenian power/);
});
test('empty-review recovery uses the primary parallel-edition passage for a scoped Bible question',async()=>{
 const question='According to 1 John 4:7–12, what does “God is love” mean, and how does the passage connect God’s love with loving one another? Also, what does the Oxford Annotated Bible commentary say about this passage?';
 const sources=[
  {id:'S1',bookId:'335',title:'New King James Version Bible — Various authors',page:5546,
   preview:'1 JOHN 4 7 Beloved, let us love one another, for love is of God; and everyone who loves is born of God and knows God. 8 He who does not love does not know God, for God is love. 9 In this the love of God was manifested toward us, that God has sent His only begotten Son into the world, that we might live through Him. 10 In this is love, not that we loved God, but that He loved us and sent His Son for our sins. 11 Beloved, if God so loved us, we also ought to love one another. 12 If we love one another, God abides in us, and His love has been perfected in us.'},
  {id:'S2',bookId:'638',title:'The New Oxford Annotated Bible — commentary',page:1821,
   preview:'4. 7–21: God’s love as the basis of salvation. 7–9: Believers are to imitate the love God has shown in sending the Son to give life. 10–12: God’s love has been shown in the death of Jesus. It is the basis of the love command.'}
 ];
 const prompts=[];let call=0;
 const ai={run:async(_model,input)=>{
  prompts.push(input);call++;
  if(call===1)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   coverage:'none',missing:'No evidence selected',questionParts:[
    {part:'meaning of God is love',status:'unsupported',evidenceIds:[]},
    {part:'connection between God’s love and loving one another',status:'unsupported',evidenceIds:[]}
   ],evidence:[]
  })}}]};
  return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   answer:'The passage describes God’s love as shown in sending the Son so that people might live through him [S1]. It says love originates in God and that one who loves is born of God and knows God [S1]. The passage connects this prior love to the command that believers should love one another; it also describes God as abiding in those who do so [S1]. The Oxford note summarizes the same connection as God’s love being the basis of the love command [S2].',
   partChecks:[
    {part:'meaning of God is love',status:'supported',evidenceIds:['S1']},
    {part:'connection between God’s love and loving one another',status:'supported',evidenceIds:['S1','S2']}
   ],
   evidence:[
    {id:'S1',point:'The passage says love is of God and describes God sending the Son so people might live through him.',quote:'love is of God; and everyone who loves is born of God',speaker:'The letter',qualifier:''},
    {id:'S2',point:'The Oxford Annotated note identifies God’s love as the basis of the love command.',speaker:'1 John 4:9',qualifier:''},
    {id:'S9',point:'This unknown ID must not enter the recovered evidence map.'}
   ]
  })}}]};
 }};
 const result=await composeVerifiedAnswer(question,sources,ai);
 assert.equal(call,2);
 assert.equal(result.outcome,'verified-source-draft');
 assert.equal(result.coverage,'full');
 assert.deepEqual(result.citations.map(source=>source.id),['S1','S2']);
 assert.deepEqual(result.evidenceMap.map(item=>item.id),['S1','S2']);
 assert.deepEqual(result.evidenceMap.map(item=>[item.id,item.quoteVerified]),[['S1',true],['S2',false]]);
 assert.equal('speaker' in result.evidenceMap[1],false);
 assert.match(prompts[1].messages[0].content,/first evidence reviewer selected no passages/);
 assert.match(prompts[1].messages[0].content,/identify an editorial note explicitly/);
 assert.match(prompts[1].messages[0].content,/evidence array/);
 assert.doesNotMatch(prompts[1].messages[0].content,/questionParts checklist/);
});
test('v1.9.4 bad or absent model citations never leave the server as an answer',async()=>{
 for(const fabricated of ['The answer is clear [S9].',
   'The answer is clear [S1, S9] [S1].',
   'An unsupported claim without a source.']){
   const fixture=await fingerprintTestFixture();
   let calls=0;
   const result=await fixture.response({aiRun:async()=>{
      calls++;return {choices:[{finish_reason:'stop',message:{content:calls===1?
         JSON.stringify({coverage:'full',missing:'',evidence:[{id:'S1',point:'Relevant supported passage point.'}]}):fabricated}}],
         usage:{neurons:4}};
   }});
   assert.equal(result.status,502);
   const data=await result.json();
   assert.equal(data.stage,'ai-answer');
   assert.equal(data.answer,undefined);
   assert.equal(calls,2);
 }
});
test('v1.14 rejects an unsupported quotation after one bounded repair attempt',async()=>{
 const fixture=await fingerprintTestFixture();
 let calls=0;
 const result=await fixture.response({aiRun:async()=>{
   calls++;
   const content=calls===1?
     JSON.stringify({coverage:'full',missing:'',evidence:[{id:'S1',point:'Relevant supported passage point.'}]}):
     'The passage calls it “the atoning sacrifice because we obey his commandments and do for my sins” [S1].';
   return {choices:[{finish_reason:'stop',message:{content}}],usage:{neurons:4}};
 }});
 assert.equal(result.status,502);
 const data=await result.json();
 assert.equal(data.stage,'ai-answer');
 assert.equal(data.answer,undefined);
 assert.equal(calls,3);
});
test('v1.14 repairs an unsupported quotation with a source-grounded paraphrase',async()=>{
 const fixture=await fingerprintTestFixture();
 let calls=0;
 const prompts=[];
 const result=await fixture.response({aiRun:async(_model,input)=>{
   calls++;prompts.push(input.messages);
   const content=calls===1?
     JSON.stringify({coverage:'full',missing:'',evidence:[{id:'S1',point:'Relevant supported passage point.'}]}):
     calls===2?
       'The passage calls it “the atoning sacrifice because we obey his commandments and do for my sins” [S1].':
       'The passage describes a truce dispute and concern about growing power [S1].';
   return {choices:[{finish_reason:'stop',message:{content}}],usage:{neurons:4}};
 }});
 assert.equal(result.status,200);
 const data=await result.json();
 assert.equal(data.outcome,'verified-source-draft');
 assert.equal(data.answer,'The passage describes a truce dispute and concern about growing power [S1].');
 assert.equal(calls,3);
 assert.match(prompts[2][0].content,/use no quotation marks anywhere/i);
});
test('v1.12 accepts a source-verbatim quotation with normalized punctuation',async()=>{
 const fixture=await fingerprintTestFixture();
 let calls=0;
 const result=await fixture.response({aiRun:async()=>{
   calls++;
   const content=calls===1?
     JSON.stringify({coverage:'full',missing:'',evidence:[{id:'S1',point:'Relevant supported passage point.'}]}):
     'The excerpt says “growing power created fear among competing cities.” [S1].';
   return {choices:[{finish_reason:'stop',message:{content}}],usage:{neurons:4}};
 }});
 assert.equal(result.status,200);
 const data=await result.json();
 assert.equal(data.outcome,'verified-source-draft');
 assert.match(data.answer,/growing power created fear/);
 assert.equal(calls,2);
});
test('v1.13 carries an explicit verse-range scope into review and composition prompts',async()=>{
 const fixture=await fingerprintTestFixture();
 const question='According to 1 John 4:7–12, what does “God is love” mean?';
 const prompts=[];
 const result=await fixture.response({
   overrideBody:{...fixture.body,question},
   aiRun:async(_model,input)=>{
     prompts.push(input.messages);
     const content=input.max_completion_tokens===520?
       JSON.stringify({coverage:'full',missing:'',evidence:[{id:'S1',point:'Relevant supported passage point.'}]}):
       'The verified passage connects divine love with loving one another [S1].';
     return {choices:[{finish_reason:'stop',message:{content}}],usage:{neurons:4}};
   }
 });
 assert.equal(result.status,200);
 assert.equal(prompts.length,2);
 const reviewSystem=prompts[0][0].content.toLowerCase();
 const answerSystem=prompts[1][0].content.toLowerCase();
 assert.match(reviewSystem,/explicit textual scope/);
 assert.match(reviewSystem,/a parallel edition of the same work and passage is in scope/);
 assert.match(reviewSystem,/verse range/);
 assert.match(answerSystem,/honor any explicit work, chapter, verse, section, or page range/);
 assert.match(answerSystem,/adjacent chapter/);
 assert(prompts[0][1].content.includes(question));
 assert(prompts[1][1].content.includes(question));
});
test('v1.9.4 local CORS preflight requires no AI call or token',async()=>{
 const fixture=await fingerprintTestFixture();
 const response=await fixture.response({method:'OPTIONS'});
 assert.equal(response.status,204);
 assert.equal(response.headers.get('Access-Control-Allow-Origin'),
   'http://127.0.0.1:8766');
 assert.equal(fixture.stats().aiCount,0);
});


const pilotBaseEnv={
 PUBLIC_ENABLED:'false',PUBLIC_PILOT_ENABLED:'true',
 TURNSTILE_SITE_KEY:'0x4AAAAAA-test-public-pilot',
 TURNSTILE_SECRET:'a-long-private-turnstile-test-secret',
 AI_RATE_LIMITER:{limit:async()=>({success:true})},
 GLOBAL_RATE_LIMITER:{limit:async()=>({success:true})},
};
async function pilotScenario({config={},model,turnstileValid=true}={}) {
 const fixture=await fingerprintTestFixture();
 let calls=0,verifyCalls=0,limitCalls=0;
 const visitorKeys=[],globalKeys=[];
 const validFetcher=async(url,init)=>{
   if(String(url).includes('siteverify')){
      verifyCalls++;
      const params=new URLSearchParams(init.body);
      return Response.json({success:turnstileValid&&params.get('response')==='one-time-challenge',
          hostname:'jsynon.github.io',action:'companion_ask'});
   }
   return fixture.fetcher(url,init);
 };
 const ai={run:async(...args)=>{calls++;return (model||fixture.run)(...args);}};
 const environment=env({...pilotBaseEnv, ...config,
   AI:ai,
   AI_RATE_LIMITER:{limit:async({key})=>{limitCalls++;visitorKeys.push(key);return {success:true}}},
   GLOBAL_RATE_LIMITER:{limit:async({key})=>{limitCalls++;globalKeys.push(key);return {success:true}}},
 });
 const post=async({body={},origin='https://jsynon.github.io',ip='198.51.100.42',headers={}}={})=>{
   const merged={...fixture.body,turnstileToken:'one-time-challenge',...body};
   const request=new Request(HOST+'/api/pilot-answer',{method:'POST',
      headers:{Origin:origin,'Content-Type':'application/json',
        'CF-Connecting-IP':ip,...headers},
      body:JSON.stringify(merged)});
   return handleRequest(request,environment,validFetcher);
 };
 const plan=async({question='What causes this event?',origin='https://jsynon.github.io',ip='198.51.100.42',headers={}}={})=>{
   const request=new Request(HOST+'/api/pilot-plan',{method:'POST',
     headers:{Origin:origin,'Content-Type':'application/json','CF-Connecting-IP':ip,...headers},
     body:JSON.stringify({question,bookId:'',turnstileToken:'one-time-challenge'})});
   return handleRequest(request,environment,validFetcher);
 };
 return {post,plan,environment,fixture,fetcher:validFetcher,
   stats:()=>({calls,verifyCalls,limitCalls,visitorKeys:[...visitorKeys],globalKeys:[...globalKeys]})};
}
test('v1.9.5 pilot status never reveals Turnstile secret or enables unless every guard exists',async()=>{
 const off=await handleRequest(new Request(HOST+'/api/pilot-status',{
   headers:{Origin:'https://jsynon.github.io'}
 }),env({PUBLIC_ENABLED:'false',PUBLIC_PILOT_ENABLED:'false'}));
 assert.equal(off.status,200);
 assert.equal((await off.json()).enabled,false);
 const on=await pilotScenario();
 const good=await handleRequest(new Request(HOST+'/api/pilot-status',{
   headers:{Origin:'https://jsynon.github.io'}
 }),on.environment);
 const details=await good.json();
 assert.equal(details.enabled,true);
 assert.equal(details.bookId,'152');
 assert.equal(details.firstPage,33);
 assert.equal(details.lastPage,64);
 assert.equal(PILOT_BOOK_IDS.length,642);
 assert(!PILOT_BOOK_IDS.includes('1'));
 assert(!PILOT_BOOK_IDS.includes('628'));
 assert.equal(PILOT_BOOKS['2'],'Fragments — Anaxagoras');
 assert.equal(details.scope,'full-public-catalog');
 assert.deepEqual(details.pilotBookIds,PILOT_BOOK_IDS);
 assert(['7','114','152','529','102'].every(id=>PILOT_BOOK_IDS.includes(id)));
 assert.equal(PILOT_BOOKS['102'],'A Brief History of Time — Stephen Hawking');
 assert.equal(details.turnstileSiteKey,pilotBaseEnv.TURNSTILE_SITE_KEY);
 assert.equal(JSON.stringify(details).includes(pilotBaseEnv.TURNSTILE_SECRET),false);
});
test('version diagnostics expose the Cloudflare Worker version on planner and answer responses',async()=>{
 const metadata={id:'version-0123456789abcdef',tag:'quality-pilot',timestamp:'2026-10-21T00:00:00.000Z'};
 assert.deepEqual(workerVersionDiagnostics({CF_VERSION_METADATA:metadata}),{
  workerSourceBuild:'public-gateway-evidence-selection-v3',
  workerVersionId:metadata.id,workerVersionTag:metadata.tag,
  workerVersionTimestamp:metadata.timestamp
 });
 assert.equal(workerVersionDiagnostics({}).workerVersionId,null);
 const plannerPilot=await pilotScenario({config:{CF_VERSION_METADATA:metadata},
  model:async()=>({choices:[{finish_reason:'stop',message:{content:
   '{"queries":["specific first event cause","distinct second event cause"]}'}}]})});
 const planned=await plannerPilot.plan();
 const planData=await planned.json();
 assert.equal(planned.status,200);
 assert.equal(planData.workerVersionId,metadata.id);
 assert.equal(planData.workerVersionTag,metadata.tag);
 assert.equal(planData.workerSourceBuild,'public-gateway-evidence-selection-v3');
 const answerPilot=await pilotScenario({config:{CF_VERSION_METADATA:metadata}});
 const answered=await answerPilot.post();
 const answerData=await answered.json();
 assert.equal(answered.status,200);
 assert.equal(answerData.workerVersionId,metadata.id);
 assert.equal(answerData.workerVersionTimestamp,metadata.timestamp);
});
test('v1.9.5 public pilot verifies hash, Turnstile and rate limits before bounded AI',async()=>{
 const pilot=await pilotScenario();
 const result=await pilot.post();
 assert.equal(result.status,200);
 const data=await result.json();
 assert.equal(data.outcome,'verified-source-draft');
 assert.equal(data.pilot,true);
 assert.equal(data.evidenceHighlights.length,1);
 assert.equal(data.evidenceHighlights[0].source_id,'S1');
 assert(data.evidenceHighlights[0].quote.includes('growing power'));
 // The selected page does not name Thucydides' immediate-dispute list or
 // Athens/Sparta specifically, so the reviewer must not surface those prompts.
 assert.deepEqual(data.followUpQuestions,[]);
 assert.equal(data.verifiedPages,1);
 assert.equal(data.citations[0].page,38);
 assert.equal(data.citations[0].globalPageId,34403);
 assert.equal(pilot.stats().limitCalls,2);
 assert.equal(pilot.stats().verifyCalls,1);
 assert.equal(pilot.stats().calls,2);
});
test('public evidence highlights follow a source-verified claim anchor',async()=>{
 const anchor='The deeper cause of the war was stated to be anxiety over political change.';
 const prompts=[];
 const pilot=await pilotScenario({model:async(_model,input)=>{
   prompts.push(input.messages);
   if(input.max_completion_tokens===520)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
     coverage:'full',missing:'',evidence:[{id:'S1',
       point:'The underlying cause was anxiety over political change.',quote:anchor,
       speaker:'Thucydides',qualifier:'was stated to be'}]
   })}}]};
   return {choices:[{finish_reason:'stop',message:{content:
     'Thucydides identifies anxiety over political change as the deeper cause [S1].'}}]};
 }});
 const response=await pilot.post();
 assert.equal(response.status,200);
 const data=await response.json();
 assert.equal(data.evidenceMap[0].quoteVerified,true);
 assert.equal(data.evidenceMap[0].anchorQuote,anchor);
 assert.equal(data.evidenceHighlights[0].quote,anchor);
 assert.match(prompts[1][1].content,/speaker: Thucydides/);
 assert.match(prompts[1][1].content,/qualifier: was stated to be/);
 assert.match(prompts[1][1].content,/verified quote and sentence context/);
});
test('public pilot verifies and submits six source candidates to the bounded answer stage',async()=>{
 const pilot=await pilotScenario({model:async(_model,input)=>{
   if(input.max_completion_tokens===520){
     const submitted=input.messages.at(-1).content;
     assert.match(submitted,/\[S6\].*physical PDF page 43/);
     return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
       coverage:'full',missing:'',evidence:[{id:'S6',point:'Relevant supported passage point.'}]})}}]};
   }
   return {choices:[{finish_reason:'stop',message:{content:
     'The verified passage supports this explanation [S6].'}}]};
 }});
 const six=pilot.fixture.body.sources[0];
 const result=await pilot.post({body:{sources:[38,39,40,41,42,43].map(page=>({...six,page}))}});
 assert.equal(result.status,200);
 const data=await result.json();
 assert.equal(data.verifiedPages,6);
 assert.equal(data.outcome,'verified-source-draft');
 assert.deepEqual(data.citations.map(source=>({id:source.id,page:source.page,
   globalPageId:source.globalPageId})),[{id:'S6',page:43,globalPageId:34408}]);
 assert.equal(data.citations[0].url,'https://drive.google.com/file/d/'+PDF+'/view?usp=sharing#page=43');
 assert.equal(pilot.stats().verifyCalls,1);
 assert.equal(pilot.stats().calls,2);
});
test('public pilot selects and synthesizes six complementary pages from one book',async()=>{
 const pilot=await pilotScenario({model:async(_model,input)=>{
   if(input.max_completion_tokens===520){
     const submitted=input.messages.at(-1).content;
     for(let i=1;i<=6;i++)assert.match(submitted,new RegExp('\\[S'+i+'\\].*physical PDF page '+(37+i)));
     return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
       coverage:'full',missing:'',evidence:[
        {id:'S1',point:'First distinct supported point.'},{id:'S2',point:'Second distinct supported point.'},
        {id:'S3',point:'Third distinct supported point.'},{id:'S4',point:'Fourth distinct supported point.'},
        {id:'S5',point:'Fifth distinct supported point.'},{id:'S6',point:'Sixth distinct supported point.'}
       ]
     })}}]};
   }
   assert.equal(input.max_completion_tokens,1100);
   const answer=input.messages.at(-1).content;
   for(let i=1;i<=6;i++)assert(answer.includes('[S'+i+']'));
   return {choices:[{finish_reason:'stop',message:{content:
     'The six passages provide distinct parts of the explanation [S1] [S2] [S3] [S4] [S5] [S6].'}}]};
 }});
 const source=pilot.fixture.body.sources[0];
 const response=await pilot.post({body:{sources:[38,39,40,41,42,43].map(page=>({...source,page}))}});
 assert.equal(response.status,200);
 const result=await response.json();
 assert.equal(result.verifiedPages,6);
 assert.deepEqual(result.citations.map(item=>item.id),['S1','S2','S3','S4','S5','S6']);
 assert.deepEqual(result.citations.map(item=>item.page),[38,39,40,41,42,43]);
});
test('public pilot resolves grouped citation IDs and rejects unknown IDs in a group',async()=>{
 const pilot=await pilotScenario({model:async(_model,input)=>{
   if(input.max_completion_tokens===520)
     return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
       coverage:'full',missing:'',evidence:[{id:'S1',point:'Relevant supported passage point.'},{id:'S3',point:'Relevant supported passage point.'}]})}}]};
   return {choices:[{finish_reason:'stop',message:{content:
     'The passages support this claim [S1, S3].'}}]};
 }});
 const source=pilot.fixture.body.sources[0];
 const result=await pilot.post({body:{sources:[38,39,40].map(page=>({...source,page}))}});
 assert.equal(result.status,200);
 const data=await result.json();
 assert.deepEqual(data.citations.map(item=>item.id),['S1','S3']);
 assert.deepEqual(data.evidenceHighlights.map(item=>item.source_id),['S1','S3']);

 const invalid=await pilotScenario({model:async(_model,input)=>{
   if(input.max_completion_tokens===520)
     return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
       coverage:'full',missing:'',evidence:[{id:'S1',point:'Relevant supported passage point.'}]})}}]};
   return {choices:[{finish_reason:'stop',message:{content:
     'The passages support this claim [S1, S9] [S1].'}}]};
 }});
 const rejected=await invalid.post();
 assert.equal(rejected.status,502);
 assert.equal((await rejected.json()).failureCode,'answer-citations-invalid');
});
test('v1.9.5 public pilot rejects unknown book/page, tampered text, and bad Turnstile',async()=>{
 const pilot=await pilotScenario();
 const source=pilot.fixture.body.sources[0];
 const unsupported=await pilot.post({body:{sources:[{...source,bookId:'800'}]}});
 assert.equal(unsupported.status,400);
 assert.equal(pilot.stats().calls,0);
 const corrupted=await pilot.post({body:{sources:[{...source,text:source.text.replace('power','xxxxx')}] }});
 assert.equal(corrupted.status,422);
 assert.equal(pilot.stats().calls,0);
 const invalid=await pilotScenario({turnstileValid:false});
 assert.equal((await invalid.post()).status,403);
 assert.equal(invalid.stats().calls,0);
 assert.equal(invalid.fixture.stats().fetchCount,0);
});
test('v1.9.5 refuses public AI without configuration, approved Origin, limits or AI',async()=>{
 const off=await pilotScenario({config:{PUBLIC_PILOT_ENABLED:'false'}});
 assert.equal((await off.post()).status,503);
 assert.equal(off.stats().calls,0);
 const badOrigin=await pilotScenario();
 assert.equal((await badOrigin.post({origin:'https://evil.invalid'})).status,403);
 assert.equal(badOrigin.stats().calls,0);
 const noLimit=await pilotScenario({config:{}});
 noLimit.environment.AI_RATE_LIMITER=null;
 assert.equal((await noLimit.post()).status,503);
 assert.equal(noLimit.stats().calls,0);
 const publicRoute=await handleRequest(request(payload),env({
   PUBLIC_ENABLED:'false',PUBLIC_PILOT_ENABLED:'true',
 }),async()=>{throw Error('No public legacy source fetch')});
 assert.equal(publicRoute.status,503);
});
test('v1.9.5 blocks requests before model when pilot rate limiter rejects',async()=>{
 const pilot=await pilotScenario();
 pilot.environment.AI_RATE_LIMITER={limit:async()=>({success:false})};
 const response=await pilot.post();
 assert.equal(response.status,429);
 assert.equal((await response.json()).failureCode,'rate-limited');
 assert.equal(pilot.stats().calls,0);
 assert.equal(pilot.stats().verifyCalls,0);
 assert.equal(pilot.fixture.stats().fetchCount,0);
});
test('opt-in evaluation bearer reaches real pilot endpoints without bypassing rate limits',async()=>{
 const token='evaluation-only-secret-'.repeat(3);
 const model=async(_model,input)=>({choices:[{finish_reason:'stop',message:{content:
   input.max_completion_tokens===210?' {"queries":["specific war causes and diplomatic disputes","underlying power growth and rival fear"]}':
   input.max_completion_tokens===520?JSON.stringify({coverage:'partial',missing:'',evidence:[{id:'S1',point:'Relevant supported passage point.'}]}):
   'The passage identifies the deeper cause as fear of growing power [S1].'}}],usage:{neurons:1}});
 const pilot=await pilotScenario({config:{PILOT_EVALUATION_ENABLED:'true',
   PILOT_EVALUATION_TOKEN:token},model});
 const headers={Authorization:'Bearer '+token};
 const planned=await pilot.plan({headers});
 assert.equal(planned.status,200);
 const answered=await pilot.post({headers});
 assert.equal(answered.status,200);
 assert.equal(pilot.stats().verifyCalls,0);
 assert(pilot.stats().calls>=3);

 const blocked=await pilotScenario({config:{PILOT_EVALUATION_ENABLED:'true',
   PILOT_EVALUATION_TOKEN:token},turnstileValid:false});
 assert.equal((await blocked.post({headers:{Authorization:'Bearer wrong'}})).status,403);
 assert.equal(blocked.stats().verifyCalls,1);

 const disabled=await pilotScenario({config:{PILOT_EVALUATION_ENABLED:'false',
   PILOT_EVALUATION_TOKEN:token},turnstileValid:false});
 assert.equal((await disabled.post({headers})).status,403);
 assert.equal(disabled.stats().verifyCalls,1);

 pilot.environment.AI_RATE_LIMITER={limit:async()=>({success:false})};
 assert.equal((await pilot.post({headers})).status,429);
 assert.equal(pilot.stats().verifyCalls,0);
});
test('planner and answer have separate visitor budgets and share the global budget',async()=>{
 const pilot=await pilotScenario({model:async(_model,input)=>{
   if(input.max_completion_tokens===210)return {choices:[{finish_reason:'stop',message:{content:
     '{"queries":["specific original event causes","political motives and context"]}'}}]};
   if(input.max_completion_tokens===520)return {choices:[{finish_reason:'stop',message:{content:
     '{"coverage":"full","missing":"","evidence":[{"id":"S1","point":"Relevant supported passage point."}]}'}}]};
   return {choices:[{finish_reason:'stop',message:{content:'The passage explains the cause [S1].'}}]};
 }});
 assert.equal((await pilot.plan()).status,200);
 assert.equal((await pilot.post()).status,200);
 const stats=pilot.stats();
 assert.deepEqual(stats.visitorKeys,[
   'reading-pilot:visitor:198.51.100.42:planner',
   'reading-pilot:visitor:198.51.100.42:answer'
 ]);
 assert.deepEqual(stats.globalKeys,['reading-pilot:global','reading-pilot:global']);
});
test('answer failures expose a safe reason code but not provider error text',async()=>{
 const pilot=await pilotScenario({model:async()=>{throw new Error('PRIVATE provider response token');}});
 const response=await pilot.post();
 assert.equal(response.status,502);
 const body=await response.json();
 assert.equal(body.failureCode,'evidence-review-request-failed');
 assert.equal(JSON.stringify(body).includes('PRIVATE'),false);
});
test('public pilot preserves safe answer-validation failure codes',async()=>{
 const pilot=await pilotScenario({model:async(_model,input)=>{
   if(input.max_completion_tokens===520)
     return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
       coverage:'partial',missing:'The excerpt does not establish the complete definition.',
       evidence:[{id:'S1',point:'Relevant supported passage point.'}]})}}]};
   return {choices:[{finish_reason:'stop',message:{content:
     'The text says that faith must not be [S1].'}}]};
 }});
 const response=await pilot.post();
 assert.equal(response.status,200);
 const result=await response.json();
 assert.equal(result.coverage,'partial');
 assert.match(result.answer,/generated sentence was incomplete/i);
 assert.doesNotMatch(result.answer,/must not be/);
});
test('Worker reports quota and capacity failures with safe public codes',async()=>{
 const quota=await pilotScenario({model:async()=>{throw {name:'Error',message:
  'You have used up your daily free allocation of 10,000 Neurons.'};}});
 const quotaResponse=await quota.post();
 assert.equal(quotaResponse.status,502);
 assert.equal((await quotaResponse.json()).failureCode,'ai-daily-limit-reached');
 const capacity=await pilotScenario({model:async()=>{throw {name:'Error',status:429,code:3040,
  message:'Capacity temporarily exceeded, please try again.'};}});
 const capacityResponse=await capacity.post();
 assert.equal(capacityResponse.status,502);
 assert.equal((await capacityResponse.json()).failureCode,'ai-capacity-unavailable');
});
test('v1.9.5 exposes only safe CORS preflight on public endpoint',async()=>{
 const pilot=await pilotScenario();
 const good=await handleRequest(new Request(HOST+'/api/pilot-answer',{
   method:'OPTIONS',headers:{Origin:'https://jsynon.github.io'}
 }),pilot.environment,pilot.fetcher);
 assert.equal(good.status,204);
 assert.equal(good.headers.get('Access-Control-Allow-Origin'),'https://jsynon.github.io');
 const bad=await handleRequest(new Request(HOST+'/api/pilot-answer',{
   method:'OPTIONS',headers:{Origin:'https://other.example'}
 }),pilot.environment,pilot.fetcher);
 assert.equal(bad.status,403);
});

test('Turnstile diagnostic identifies invalid secret without logging any credentials',()=>{
 const provided={success:false,'error-codes':['invalid-input-secret','bad-token\nSECRET-DO-NOT-LOG'],
    hostname:'attacker.example',action:'unknown',
    token:'sensitive-visitor-token',secret:'sensitive-private-secret'};
 assert.deepEqual(turnstileRejection(provided),
    {reason:'siteverify-rejected',codes:['invalid-input-secret']});
 const diagnostic=JSON.stringify(turnstileRejection(provided));
 assert(!diagnostic.includes('sensitive-'));
 assert(!diagnostic.includes('attacker.example'));
 assert(!diagnostic.includes('DO-NOT-LOG'));
});
test('Turnstile diagnostic distinguishes hostname and action mismatches',()=>{
 assert.deepEqual(turnstileRejection({success:true,hostname:'different.example',action:'companion_ask'}),
    {reason:'hostname-mismatch'});
 assert.deepEqual(turnstileRejection({success:true,hostname:'jsynon.github.io',action:'different_action'}),
    {reason:'action-mismatch'});
 assert.equal(turnstileRejection({success:true,hostname:'jsynon.github.io',action:'companion_ask'}),null);
});


test('siteverify HTTP 400 reports only known rejection code and still blocks AI',async()=>{
 const fixture=await fingerprintTestFixture();
 const denied=Response.json({success:false,
   'error-codes':['invalid-input-secret','not-an-authorized-code'],
   secret:'must-not-appear-in-log',response:'must-not-appear-in-log',
   hostname:'must-not-appear-in-log'}, {status:400});
 let aiCalls=0,fingerprintFetches=0;
 const environment=env({...pilotBaseEnv,
   AI:{run:async()=>{aiCalls++;throw Error('AI must not run');}}});
 const data={...fixture.body,turnstileToken:'one-time-challenge'};
 const req=new Request(HOST+'/api/pilot-answer',{method:'POST',headers:{
   Origin:'https://jsynon.github.io',
   'CF-Connecting-IP':'198.51.100.42',
   'Content-Type':'application/json'},body:JSON.stringify(data)});
 const realWarn=console.warn, warnings=[];
 try{
   console.warn=(...args)=>warnings.push(args);
   const result=await handleRequest(req,environment,async url=>{
     if(String(url).includes('/siteverify'))return denied;
     fingerprintFetches++;throw Error('Must never fetch source');
   });
   assert.equal(result.status,403);
   assert.equal((await result.json()).error,
     'Visitor verification failed; please retry the challenge');
 } finally{console.warn=realWarn;}
 assert.equal(aiCalls,0);
 assert.equal(fingerprintFetches,0);
 assert.equal(warnings.length,1);
 assert.equal(warnings[0][0],'Reading Companion Turnstile verification failed');
 assert.deepEqual(warnings[0][1],{
   reason:'siteverify-http-failure',httpStatus:400,codes:['invalid-input-secret']});
 assert.equal(JSON.stringify(warnings).includes('must-not-appear'),false);
});


test('v1.10 allows any fingerprint-verified page from additional approved books',async()=>{
 const fixture=await fingerprintTestFixture();
 const source=fixture.body.sources[0];
 const alt={...source,bookId:'7',page:4};
 const original=fixture.fetcher;
 let fetches=0,calls=0;
 const fetched=await original('https://jsynon.github.io/antilogicalism-library-data/reader-fingerprints-v1/books/152/1.json');
 const fp=await fetched.json();
 fp.bookId='7';fp.chunk=0;fp.firstPage=1;fp.lastPage=32;fp.pages[0].page=4;
 const environment=env({...pilotBaseEnv,AI:{run:async(_m,input)=>{
   calls++;return {choices:[{finish_reason:'stop',message:{content:input.max_completion_tokens===520?
     JSON.stringify({coverage:'full',missing:'',evidence:[{id:'S1',point:'Relevant supported passage point.'}]})
     :'The cited source passage explains its subject [S1].'}}],usage:{neurons:4}};
 }}});
 const request=new Request(HOST+'/api/pilot-answer',{method:'POST',
  headers:{Origin:'https://jsynon.github.io',
     'CF-Connecting-IP':'198.51.100.22','Content-Type':'application/json'},
  body:JSON.stringify({...fixture.body,turnstileToken:'one-time-challenge',sources:[alt]})});
 const result=await handleRequest(request,environment,async url=>{
   fetches++;
   if(String(url).endsWith('siteverify'))return Response.json({success:true,
       hostname:'jsynon.github.io',action:'companion_ask'});
   assert(String(url).endsWith('/books/7/0.json'));
   return Response.json(fp);
 });
 assert.equal(result.status,200);
 const answer=await result.json();
 assert.equal(answer.citations[0].bookId,'7');
 assert.equal(answer.citations[0].page,4);
 assert.equal(calls,2);
 assert.equal(fetches,2);
});
test('evidence review retries one truncated response with a compact bounded request',async()=>{
 const fixture=await fingerprintTestFixture();
 let calls=0;
 const ai={run:async(_model,input)=>{
   calls++;
   if(calls===1){
     assert.equal(input.max_completion_tokens,520);
     return {choices:[{finish_reason:'length',message:{content:''}}],usage:{neurons:3}};
   }
   if(calls===2){
     assert.equal(input.max_completion_tokens,760);
     assert(input.messages[0].content.includes('compact valid JSON'));
     return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
       coverage:'partial',missing:'The excerpt does not cover the entire question.',
       evidence:[{id:'S1',point:'Relevant supported passage point.'}],followUpQuestions:['Which disputes preceded the war?']
     })}}],usage:{neurons:4}};
   }
   return {choices:[{finish_reason:'stop',message:{content:
     'The passage distinguishes immediate disputes from a deeper fear of growing power [S1].'}}],
     usage:{neurons:5}};
 }};
 const response=await fixture.response({overrideAI:ai});
 assert.equal(response.status,200);
 const data=await response.json();
 assert.equal(data.outcome,'verified-source-draft');
 assert.equal(data.usage.neurons,12);
 assert.equal(calls,3);
});
test('evidence review retries one invalid structured response with a compact request',async()=>{
 const fixture=await fingerprintTestFixture();
 let calls=0;
 const ai={run:async(_model,input)=>{
  calls++;
  if(calls===1){
   assert.equal(input.max_completion_tokens,520);
   return {choices:[{finish_reason:'stop',message:{content:'review output was not JSON'}}],usage:{neurons:2}};
  }
  if(calls===2){
   assert.equal(input.max_completion_tokens,760);
   assert.match(input.messages[0].content,/compact valid JSON/);
   return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
    coverage:'partial',missing:'The excerpt only gives part of the requested account.',
    evidence:[{id:'S1',point:'Relevant supported passage point.'}],followUpQuestions:[]
   })}}],usage:{neurons:3}};
  }
  return {choices:[{finish_reason:'stop',message:{content:
   'The passage supports this limited account [S1].'}}],usage:{neurons:4}};
 }};
 const response=await fixture.response({overrideAI:ai});
 assert.equal(response.status,200);
 const data=await response.json();
 assert.equal(data.outcome,'verified-source-draft');
 assert.equal(data.usage.neurons,9);
 assert.equal(calls,3);
});
test('second invalid evidence-review response reports only its safe failure class',async()=>{
 const pilot=await pilotScenario({model:async(_model,input)=>({
  choices:[{finish_reason:'stop',message:{content:input.max_completion_tokens===520?
   'private first malformed output':'private second malformed output'}}],usage:{neurons:1}
 })});
 const response=await pilot.post();
 assert.equal(response.status,502);
 const body=await response.json();
 assert.equal(body.failureCode,'evidence-review-invalid-response');
 assert.equal(body.failureDetail,'retry_invalid_json');
 assert.doesNotMatch(JSON.stringify(body),/private|malformed output/i);
});
test('a second evidence-review truncation returns a safe stage diagnostic in Worker logs',async()=>{
 const calls=[];
 const prompts=[];
 const original=console.error;let logged=[];
 console.error=(...args)=>logged.push(args);
 try{
   const pilot=await pilotScenario({model:async(_model,input)=>{
     calls.push(input.max_completion_tokens);
     prompts.push(input.messages[0].content);
     return {choices:[{finish_reason:'length',message:{content:''}},],usage:{neurons:1}};
   }});
   const response=await pilot.post();
   assert.equal(response.status,502);
   assert.equal((await response.json()).failureCode,'evidence-review-truncated');
   assert.deepEqual(calls,[520,760]);
   assert.match(prompts[1],/For broad questions about what a person or work says/);
 }finally{console.error=original;}
 const failure=logged.find(entry=>entry[0]==='Reader pilot answer failed')?.[1];
 assert.deepEqual(failure,{
   failureCode:'evidence-review-truncated',stage:'evidence-review',
   finishReason:'length',retryFinishReason:'length',
   outputTokenLimit:760,sourceCount:1,retried:true,reviewFailureReason:'unknown'
 });
});

test('partial answer preserves a qualifying phrase and gets one conditional correction',async()=>{
 const question='How does Darwin describe the timing of struggle for existence and natural selection?';
 const sources=[{id:'S1',bookId:'529',title:'On the Origin of Species — Charles Darwin',page:140,
   preview:'It is an error to suppose that there would be no struggle for existence, and, consequently, no natural selection, until many forms had been produced.'}];
 const calls=[];
 const ai={run:async(_model,input)=>{
   calls.push(input);
   if(calls.length===1)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
     coverage:'partial',missing:'The excerpt only addresses the timing of struggle and selection.',
     questionParts:[{part:'explain when struggle and natural selection occur',status:'partial',evidenceIds:['S1']}],
     evidence:[{id:'S1',point:'Darwin rejects the idea that struggle and selection only arise after many forms exist.'}]
   })}}]};
   if(calls.length===2)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
     answer:'Darwin says natural selection would occur without any struggle for existence [S1].',
     partChecks:[{part:'explain when struggle and natural selection occur',status:'partial',evidenceIds:['S1']}]
   })}}]};
   assert.match(input.messages[0].content,/Preserve logical qualifiers such as “until,” “unless,” “only,” and “except”/);
   assert.match(input.messages[0].content,/omitting a qualifier can reverse or overstate the source claim/);
   return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
     answer:'Darwin calls it an error to suppose that struggle and natural selection are absent until many forms have developed [S1]. The excerpt addresses when these processes appear; it does not establish that selection occurs without struggle.',
     partChecks:[{part:'explain when struggle and natural selection occur',status:'partial',evidenceIds:['S1']}]
   })}}]};
 }};
 const result=await composeVerifiedAnswer(question,sources,ai);
 assert.equal(calls.length,3);
 assert.equal(result.coverage,'partial');
 assert.match(result.answer,/absent until many forms have developed/);
 assert.doesNotMatch(result.answer,/would occur without any struggle/);
});

test('composition checks every question part against all verified excerpts and repairs a missed source',async()=>{
 const question='According to Darwin, how does natural selection operate, and what roles do inherited variation and struggle for existence play?';
 const sources=[
  {id:'S1',bookId:'529',title:'On the Origin of Species — Charles Darwin',page:96,
   preview:'Natural selection preserves favorable individual differences and variations. It does not induce variability; it preserves variations that arise and prove beneficial.'},
  {id:'S2',bookId:'529',title:'On the Origin of Species — Charles Darwin',page:140,
   preview:'It is an error to suppose that there would be no struggle for existence, and, consequently, no natural selection, until many forms had been produced.'}
 ];
 const calls=[];
 const ai={run:async(_model,input)=>{
  calls.push(input);
  if(calls.length===1)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   coverage:'partial',missing:'The role of struggle for existence is not addressed.',
   questionParts:[
    {part:'explain how natural selection operates, including inherited variation',status:'supported',evidenceIds:['S1']},
    {part:'explain the role of struggle for existence',status:'unsupported',evidenceIds:[]}
   ],
   evidence:[{id:'S1',point:'Natural selection preserves favorable variations.'}]
  })}}],usage:{neurons:2}};
  if(calls.length===2){
   assert.match(input.messages[1].content,/all submitted passages, including those not selected/i);
   assert.match(input.messages[1].content,/struggle for existence, and, consequently, no natural selection/);
   return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
    answer:'Natural selection preserves favorable variations and does not create them [S1]. The struggle for existence is part of the account: Darwin rejects the idea that it begins only after many forms have appeared, connecting struggle with natural selection [S2].',
    partChecks:[
     {part:'explain how natural selection operates, including inherited variation',status:'supported',evidenceIds:['S1']},
     {part:'explain the role of struggle for existence',status:'unsupported',evidenceIds:[]}
    ]
   })}}],usage:{neurons:3}};
  }
  assert.match(input.messages[0].content,/coverage check found missing or underexplained/);
  assert.match(input.messages[1].content,/page 140/);
  return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   answer:'Natural selection preserves favorable variations rather than creating them [S1]. The struggle for existence is also part of the process: Darwin rejects the assumption that it, and natural selection, begin only after many forms have appeared [S2]. The excerpt supports that connection, though this passage alone does not spell out every consequence of the struggle.',
   partChecks:[
    {part:'explain how natural selection operates, including inherited variation',status:'supported',evidenceIds:['S1']},
    {part:'explain the role of struggle for existence',status:'supported',evidenceIds:['S2']}
   ]
  })}}],usage:{neurons:4}};
 }};
 const result=await composeVerifiedAnswer(question,sources,ai);
 assert.equal(calls.length,3);
 assert.equal(result.coverage,'full');
 assert.equal(result.questionParts[1].status,'supported');
 assert.match(result.answer,/struggle for existence is also part of the process/);
 assert.doesNotMatch(result.answer,/do not fully address/i);
 assert.deepEqual(result.citations.map(source=>source.id),['S1','S2']);
});

test('named-author comparison repairs an omitted side from a submitted source and develops the answer',async()=>{
 const question="what's the difference between the thought of kierkegaard and shestov?";
 const sources=[
  {id:'S1',bookId:'96',title:'Athens and Jerusalem — Lev Shestov',page:75,
   preview:'To tear oneself away from Necessity, it is necessary to dare everything. Beyond reason and knowledge, the enchained Parmenides will regain his primordial freedom.'},
  {id:'S2',bookId:'140',title:'Fear and Trembling — Søren Kierkegaard',page:39,
   preview:'If there is such a concealment, we are in the presence of the paradox that the individual as the individual is higher than the universal.'}
 ];
 const calls=[];
 const ai={run:async(_model,input)=>{
  calls.push(input);
  if(calls.length===1)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   coverage:'partial',missing:'Shestov’s thought is not addressed.',
   questionParts:[
    {part:"Kierkegaard's thought",status:'supported',evidenceIds:['S2']},
    {part:"Shestov's thought",status:'unsupported',evidenceIds:[]}
   ],evidence:[{id:'S2',point:'Kierkegaard places the individual above the universal in faith.'}]
  })}}],usage:{neurons:2}};
  if(calls.length===2)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   answer:'Kierkegaard presents faith as a paradox in which the individual may stand above the ethical universal [S2]. Shestov’s page discusses Kierkegaard, but the answer cannot establish Shestov’s own thought from it [S1].',
   partChecks:[
    {part:"Kierkegaard's thought",status:'supported',evidenceIds:['S2']},
    {part:"Shestov's thought",status:'unsupported',evidenceIds:[]}
   ]
  })}}],usage:{neurons:3}};
  if(calls.length===3){
   assert.match(input.messages[0].content,/prefer that author’s own submitted work/);
   assert.match(input.messages[1].content,/Beyond reason and knowledge/);
   return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
    answer:'Kierkegaard’s passage presents faith as a paradox in which the individual can stand in an absolute relation to God beyond the ethical universal [S2]. Shestov argues that universal necessity and rational knowledge constrain human freedom, and he calls for a struggle to break their power [S1]. Read together, the passages suggest a difference in emphasis: Kierkegaard focuses on the individual’s paradoxical relation to God, while Shestov attacks the rule of necessary truths and stresses freedom beyond reason. This is a comparison of the supplied passages, not a claim that either author directly compared them.',
    partChecks:[
     {part:"Kierkegaard's thought",status:'supported',evidenceIds:['S2']},
     {part:"Shestov's thought",status:'supported',evidenceIds:['S1']}
    ]
   })}}],usage:{neurons:4}};
  }
  assert.match(input.messages[0].content,/exactly two developed paragraphs/);
  assert.match(input.messages[0].content,/120–180 words/);
  return {choices:[{finish_reason:'stop',message:{content:
   'Kierkegaard describes faith through the paradox of the individual’s absolute relation to God. The individual may stand above the ethical universal, though Kierkegaard treats this as a terrifying exception rather than a general license to disregard ethics. His focus is the believer’s inward responsibility before God, which cannot be reduced to a public rule or explained away by a rational system [S2].\n\nShestov attacks the authority of universal and necessary truths, arguing that reason can make human beings accept constraint as inevitable. He calls for a struggle against Necessity so that freedom may be recovered beyond reason and knowledge [S1]. The difference in these passages is one of emphasis: Kierkegaard centers faith’s paradoxical relation between the individual and God, while Shestov emphasizes revolt against reason’s claim to define what is possible. This comparison synthesizes the two texts; neither passage presents a direct debate between the authors [S1, S2].'}}],usage:{neurons:5}};
 }};
 const result=await composeVerifiedAnswer(question,sources,ai);
 assert.equal(calls.length,4);
 assert.equal(result.coverage,'full');
 assert.deepEqual(result.questionParts.map(part=>part.status),['supported','supported']);
 assert.equal(result.answer.split(/\n\s*\n/).length,2);
 assert.match(result.answer,/Shestov attacks the authority/);
 assert.deepEqual(result.citations.map(source=>source.id),['S1','S2']);
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
  assert.match(input.messages[0].content,/Use an excerpt if it directly supports the missing part/);
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
  assert.match(input.messages[0].content,/synthesize a concise contrast only when separately supported parts establish every requested side/i);
  return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   answer:'Aristotle presents political order as aiming at human good and at making citizens good and obedient to laws [S1]. The passage ties political judgment to a shared human end, and it treats citizens’ character and their relation to law as part of that end. The account therefore describes political order through the good it should pursue and the kind of citizen it should form. These points come from Aristotle’s passage, which speaks about political science and civic virtue [S1].\n\nHobbes presents political order through the institution of a common power. That power keeps people in awe and enables them to consent to justice and the laws of nature [S2]. In the excerpt, the role of authority is practical: it secures conditions under which those rules can be observed. Hobbes’s passage thus emphasizes the need for an effective power to sustain order among people [S2].\n\nRead together, the accounts place emphasis on different supports for political order. Aristotle connects it to human good and the formation of citizens, while Hobbes connects it to a common power that secures justice and obedience. This comparison is a synthesis of the two supplied passages; neither cited excerpt directly compares Aristotle with Hobbes. The distinction follows from the separate roles each passage assigns to political order [S1, S2].',
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

test('recognizes a cited reader synthesis when coverage calls the comparison unsupported',async()=>{
 const question='How does Aristotle describe political science in Nicomachean Ethics, how does Hobbes describe common power in Leviathan, and how do the accounts differ?';
 const sources=[
  {id:'S1',bookId:'7',title:'Nicomachean Ethics — Aristotle',page:12,
   preview:'The aim of political science is the human good and happiness; it makes citizens good and obedient to laws.'},
  {id:'S2',bookId:'163',title:'Leviathan — Thomas Hobbes',page:104,
   preview:'Common power keeps people in awe so they may observe justice and the laws of nature.'}
 ];
 let calls=0;
 const answer='Aristotle describes political science as pursuing human good and happiness [S1]. The same passage connects that study with virtue of the soul and with making citizens good and obedient to laws [S1]. This presents political inquiry through the end it should serve and the kind of civic character it should cultivate [S1]. The passage gives human flourishing a central place in describing the aim of political science [S1].\n\nHobbes gives common power a different role: it keeps people in awe so that justice and the laws of nature can be observed [S2]. In this account, public authority supplies the condition that helps people follow those rules in practice [S2]. The passage says that without common power, justice and natural law would not be reliably observed [S2]. Hobbes therefore explains political order through the force that sustains public obedience [S2].\n\nThe accounts differ in what they emphasize: Aristotle connects political order with human good and civic formation, whereas Hobbes emphasizes common power as the condition that sustains justice [S1, S2]. This is a reader-level comparison of the two supplied passages, not a claim that either author directly compared his view with the other [S1, S2]. Their respective passages support the contrast between a human good that guides political inquiry and an authority that maintains order [S1, S2]. The comparison follows from those distinct emphases and remains limited to the excerpts supplied here [S1, S2].';
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
  assert.match(input.messages[0].content,/Mark the comparison supported when both requested sides are explicitly explained/);
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
  assert.match(input.messages[0].content,/Revise the answer to address each requested question part/);
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
 assert.match(inputs[1].messages[0].content,/A book record naming an author does not prove/);
 assert.match(inputs[1].messages[0].content,/Never complete a dangling clause/);
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
 assert.match(calls[1].messages[0].content,/use the questionParts checklist to make sure/);
 assert.match(calls[1].messages[0].content,/every supported part is answered/);
 assert.match(calls[1].messages[1].content,/contrast with skill — unsupported \[evidence: none\]/);
});
test('answer composition explicitly requests plain text instead of Markdown artifacts',async()=>{
 const {readFileSync}=await import('node:fs');
 const source=readFileSync(new URL('./public-gateway.mjs',import.meta.url),'utf8');
 assert.match(source,/Use plain text only: no Markdown, headings, asterisks, or bullet markers/);
 assert.doesNotMatch(source,/brief bullets/);
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
 assert.match(calls[0].messages[0].content,/Keep each point atomic: one claim per point/);
 assert.match(calls[0].messages[0].content,/make the evidence map include the definition and the passage’s stated reason, operation, or criterion for each requested distinction/);
 assert.match(calls[0].messages[0].content,/For broad questions asking what a person or work says about a topic/);
 assert.match(calls[0].messages[0].content,/Prioritize direct explanation of the concept/);
 assert.match(calls[0].messages[0].content,/remarks that a term needs definition as context/);
 assert.match(calls[0].messages[0].content,/IDs may repeat only when the same passage supports a different point/);
 assert.match(calls[0].messages[0].content,/Treat footnotes, translator or editor notes, and introductions as separate speakers/);
 assert.match(calls[0].messages[0].content,/do not treat a translation note as Kierkegaard’s own distinction/);
 assert.match(calls[0].messages[0].content,/exact quote copied from that same excerpt/);
 assert.match(calls[0].messages[0].content,/record that reply as a separate evidence point/);
 assert.match(calls[1].messages[0].content,/complete verified quote and sentence context together/);
 assert.match(calls[0].messages[0].content,/keep the condition and its consequence together/);
 assert.match(calls[0].messages[0].content,/actual differentiating criterion/);
 assert.match(calls[1].messages[0].content,/never detach a consequence from its “if,” “unless,” “only if,” or equivalent condition/);
 assert.match(calls[1].messages[0].content,/The evidence map is authoritative about this distinction/);
 assert.match(calls[1].messages[0].content,/do not turn a translator’s lexical gloss or capitalization convention into a claim about Kierkegaard’s theory/);
 assert.match(calls[1].messages[0].content,/State the central account once/);
 assert.match(calls[1].messages[0].content,/Do not restate the same claim with expanded synonyms/);
 assert.match(calls[1].messages[0].content,/Omit adjacent topics that do not answer a listed part/);
 assert.match(calls[1].messages[0].content,/Preserve stated relations precisely/);
 assert.match(calls[1].messages[0].content,/Do not combine two reviewed points into a definition/);
 assert.match(calls[1].messages[0].content,/EXCEPTION: when the question explicitly asks for a comparison across separately named works/);
 assert.match(calls[1].messages[0].content,/For a single-part question, organize the answer around the evidence map/);
 assert.match(calls[1].messages[0].content,/Avoid a book-by-book/);
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
   const answer=('The source passage explains a supported cause [S1]. ').repeat(70);
   return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
     answer,partChecks:[{part:'causes',status:'supported',evidenceIds:['S1']}]
   })}}]};
 }});
 const response=await pilot.post({body:{question:'What causes this event?'}});
 assert.equal(response.status,502);
 const failure=await response.json();
 assert.equal(failure.failureCode,'answer-initial-composition-too-long');
 assert.equal(failure.failureStage,'initial-composition');
 assert(failure.failureAnswerCharacters>2400);
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

