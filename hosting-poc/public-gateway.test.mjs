import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as support from './public-gateway.test-support.mjs';
const {gzipSync,gateway,handleRequest,validRequest,trustedSources,trustedPacketSources,verifiedFingerprintSources,parseReview,composeVerifiedAnswer,removeConflictingSpeakerAttributions,removeUnqualifiedCorrectedClaims,removeUncitedAuthorClaims,removeUnsupportedCrossWorkComparisonClaims,appendUncitedSourceGroupDisclosure,applyExplicitWorkScope,sourceExcerpt,turnstileRejection,inferenceFailureDiagnostics,answerPipelineFailureDiagnostics,workerVersionDiagnostics,PILOT_BOOKS,PILOT_BOOK_IDS,planSearchQueries,stripWebCaptureFooters,selectPublicEvidenceHighlights,HOST,PDF,manifest,pages,question,payload,fetcher,request,env,fingerprintTestFixture,pilotBaseEnv,pilotScenario}=support;

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
 const result=await handleRequest(request(bad),env(),(url,opts)=>{if(String(url).includes('data-v48'))corpus++;return fetcher(url,opts);});
 assert.equal(result.status,403);assert.equal(corpus,0);
});
test('trusted corpus provides the page content and PDF link, not untrusted client fields',async()=>{
 const sources=await trustedSources(question,[{...payload.sources[0],title:'Forged title',
   url:'https://attacker.example/forged.pdf#page=900',preview:'Forged preview',
   text:'Forged source text',sha256:'0'.repeat(64)}],fetcher);
 assert.equal(sources.length,1);assert.equal(sources[0].page,38);
 assert.equal(sources[0].preview,sourceExcerpt(pages.pages[0].text,question));
 assert.equal(sources[0].title,manifest.books['152'].title);
 assert.equal('text' in sources[0],false,'legacy source previews do not expose raw page text');
 assert.equal('sha256' in sources[0],false,'exact text fingerprints belong to the verified fingerprint pipeline');
 assert.equal(stripWebCaptureFooters('Read https://example.org/path (not a captured footer).'),'Read https://example.org/path (not a captured footer).');
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
 assert.match(prompts[0],/when the named primary work and a secondary quotation are both supplied, prefer the primary passage/);
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
  assert.match(input.messages[0].content,/Check evidence points against the full excerpt/);
  return {choices:[{finish_reason:'stop',message:{content:
   'Darwin describes natural selection as preserving favorable variations across generations [S1].'}}],usage:{neurons:3}};
 }};
 const result=await composeVerifiedAnswer(question,sources,ai);
 assert.equal(result.outcome,'verified-source-draft');
 assert.equal(result.evidenceMap[0].quoteVerified,false);
 assert.match(inputs[0].messages[0].content,/Do not mark coverage none solely because an exact quote or qualifier is unavailable/);
 assert.match(inputs[1].messages[0].content,/Check evidence points against the full excerpt/);
});
test('quote matching normalizes the common OCR glyph Ɵ without changing displayed source text',()=>{
 const source={id:'S1',bookId:'335',title:'New King James Version Bible — Various authors',
  page:5546,preview:'James says a person is justified by works rather than by faith alone.'
   .replace('justified','jusƟﬁed')};
 const review=parseReview(JSON.stringify({coverage:'full',missing:'',
  questionParts:[{part:'How does James relate faith to works?',status:'supported',evidenceIds:['S1']}],
  evidence:[{id:'S1',point:'James says works accompany faith.',
   quote:'justified by works rather than by faith alone',speaker:'James',qualifier:''}]
 }),[source],'According to James 2:14–26, how does James relate faith to works?');
 assert.equal(review.evidenceMap[0].quoteVerified,true);
 assert.match(review.evidenceMap[0].anchorQuote,/jusƟﬁed/);
});
test('an exact long review quote is reduced to a bounded source anchor without trusting altered or joined text',()=>{
 const first='The will of the people is the foundation of political authority, and each citizen must take part in forming that common will. ';
 const second='When a person obeys a law made by the community, that person remains free because the law expresses the general will. ';
 const third='This account distinguishes the shared public interest from the private wishes of any one person.';
 const preview=first+second+third;
 const exact=preview;
 assert.ok(exact.length>220);
 const review=parseReview(JSON.stringify({coverage:'full',missing:'',evidence:[{
  id:'S1',point:'Rousseau grounds political authority in the common will.',quote:exact
 }]}),[{id:'S1',preview}]);
 assert.equal(review.evidenceMap[0].quoteVerified,true);
 assert.ok(review.evidenceMap[0].anchorQuote.length<=220);
 assert.ok(preview.includes(review.evidenceMap[0].anchorQuote));
 const altered=parseReview(JSON.stringify({coverage:'full',missing:'',evidence:[{
  id:'S1',point:'A claim with an invalid source quote.',quote:exact.replace('foundation','secret foundation')
 }]}),[{id:'S1',preview}]);
 assert.equal(altered.evidenceMap[0].quoteVerified,false);
 const joined=parseReview(JSON.stringify({coverage:'full',missing:'',evidence:[{
  id:'S1',point:'A claim joined from distant text.',quote:first.slice(0,42)+' … '+third.slice(-42)
 }]}),[{id:'S1',preview}]);
 assert.equal(joined.evidenceMap[0].quoteVerified,false);
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
 assert.match(inputs[1].messages[0].content,/two passages by one author as independent perspectives/);
 assert.match(inputs[1].messages[0].content,/do not pad or repeat/);
 assert.match(inputs[1].messages[0].content,/relevant reasons, distinctions/);
 assert.match(inputs[1].messages[0].content,/let answer length follow the evidence/);
 assert.match(inputs[1].messages[0].content,/Complementary passages may support separate sides/);
 assert.match(inputs[1].messages[0].content,/Answer each requested part directly/);
 assert.match(inputs[1].messages[0].content,/Use the passage that most directly answers it/);
 assert.match(inputs[1].messages[0].content,/not related background, motives, or consequences/);
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
 assert.match(prompt,/For named-source comparisons or hypotheticals, search each source for its own relevant position on the same subject/);
 assert.match(prompt,/Preserve the subject, named sources, exact requested concept, and textual scope/);
 assert.doesNotMatch(prompt,/Darwin|Hawking|astronomical observations|education, law, custom/,
  'the shared planner guidance must not contain topic-specific search routes');
 assert.match(result.queries[0],/On the Origin of Species/i);
 assert.match(result.queries[0],/natural selection|favorable variations/i);
 assert.match(result.queries[1],/(?:A )?Brief History of Time/i);
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
 assert.match(plannerPrompt,/textual scope in the queries that need them/);
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
 assert.match(prompt,/Return two to four distinct concise search phrases/);
 assert.match(prompt,/Use remaining queries for its distinct requested facets/);
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
   assert.match(input.messages[0].content,/For theory questions/);
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
   assert.match(input.messages[0].content,/Distinguish author, narrator, character, report/);
   return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   answer:'Raskolnikov has a perfect right to murder because extraordinary people can break the law [S1]. The novel demonstrates that he no longer believes his theory [S2]. His poverty and repentance explain the murder and confession [S3].',
   partChecks:[
    {part:labels[0],status:'partial',evidenceIds:['S1']},
    {part:labels[1],status:'partial',evidenceIds:['S2','S3']}
   ]
  })}}]};
  }
  assert.equal(inputs.length,3);
  assert.match(input.messages[0].content,/keep reported views, replies, hypotheticals, questions, and editorial notes distinct from an author’s own assertion/);
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
  assert.match(input.messages[0].content,/When asked for a named author’s own view, prefer that author’s relevant supplied work/);
  assert.match(input.messages[1].content,/Philosophical Fragments — Søren Kierkegaard/);
  assert.match(input.messages[1].content,/Athens and Jerusalem — Lev Shestov, physical PDF page 55/);
  return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   answer:'Kierkegaard’s Philosophical Fragments warns that consequences founded on a paradox lose their value if later generations treat them as an inherited settled estate [S1]. The passage says their meaning depends on keeping the paradox visible, like a city whose foundations would be forgotten at one’s peril. It therefore presents thought as returning to the original paradox rather than accepting inherited consequences uncritically. This shows one feature of Kierkegaard’s account in this text, though the excerpt does not define his whole philosophy [S1].\n\nShestov, by contrast, argues that human beings fear freedom and try to bind even God to eternal principles [S3]. He contrasts divine creative power with the human tendency to imitate and to accept rational limits. In the same passage he criticizes the idea that necessity makes some possibilities impossible even for God [S3]. The difference in emphasis is that Kierkegaard’s excerpt focuses on preserving the paradox, while Shestov challenges the rational necessity that would restrict creative freedom [S1, S3]. This is a synthesis of these passages, not a direct exchange between the authors [S1, S3].',
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
     answer:"Aristotle connects political order to the human good and the cultivation of virtue, framing politics around the kind of life and character a community should support [S1]. This account makes the ethical end of civic life central to political inquiry.\n\nHobbes instead emphasizes the institution of a common power, which keeps people in awe and makes justice and the laws of nature more reliably observed [S2]. The contrast is a synthesis of these passages: Aristotle foregrounds the end politics serves, while Hobbes foregrounds the authority needed to secure order [S1, S2]. The passages support those distinct emphases, though neither excerpt directly compares the two thinkers.",
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

test('a specifically named work excludes the same author’s other books from answer citations',async()=>{
 const question='According to Aristotle’s De Anima, how is the soul related to a living body?';
 const sources=[
  {id:'S1',bookId:'4',title:'On the Soul (De Anima) — Aristotle',page:15,
   preview:'The body is matter and the soul is the form of a natural body having life potentially.'},
  {id:'S2',bookId:'9',title:'Metaphysics — Aristotle',page:92,
   preview:'Sensible substance is matter, form, or the composite of both.'}
 ];
 const calls=[];
 const ai={run:async(_model,input)=>{
  calls.push(input);
  if(calls.length===1)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   coverage:'full',missing:'',
   questionParts:[{part:'how the soul is related to a living body',status:'supported',evidenceIds:['S1']}],
   evidence:[{id:'S1',point:'The soul is the form and actuality of a natural living body.'}]
  })}}]};
  return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   answer:'Aristotle describes the soul as the form and actuality of a natural body with life potentially [S1].',
   partChecks:[{part:'how the soul is related to a living body',status:'supported',evidenceIds:['S1']}]
  })}}]};
 }};
 const result=await composeVerifiedAnswer(question,sources,ai);
 assert.equal(calls.length,2);
 assert.match(calls[0].messages[1].content,/On the Soul \(De Anima\)/);
 assert.doesNotMatch(calls[0].messages[1].content,/Metaphysics/);
 assert.deepEqual(result.citations.map(source=>source.id),['S1']);
});

test('an author mentioned as the subject of a view is not treated as a second source',async()=>{
 const question='What did Nietzsche think about Plato?';
 const sources=[
  {id:'S1',bookId:'54',title:'Thus Spake Zarathustra — Friedrich Nietzsche',page:31,
   preview:'Nietzsche’s thinking about Plato is critical of the philosopher’s ideal world.'},
  {id:'S2',bookId:'74',title:'The Republic — Plato',page:110,
   preview:'Plato describes justice as an order among the parts of the soul.'}
 ];
 const calls=[];
 const ai={run:async(_model,input)=>{
  calls.push(input);
  if(calls.length===1)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   coverage:'full',missing:'',
   questionParts:[{part:'Nietzsche’s view of Plato',status:'supported',evidenceIds:['S1']}],
   evidence:[{id:'S1',point:'Nietzsche criticizes Plato’s ideal world.'}]
  })}}]};
  return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   answer:'Nietzsche criticizes Plato’s ideal world [S1].',
   partChecks:[{part:'Nietzsche’s view of Plato',status:'supported',evidenceIds:['S1']}]
  })}}]};
 }};
 const result=await composeVerifiedAnswer(question,sources,ai);
 assert.equal(calls.length,2);
 assert.match(calls[0].messages[1].content,/Nietzsche/);
 assert.doesNotMatch(calls[0].messages[1].content,/Plato describes justice/);
 assert.deepEqual(result.citations.map(source=>source.id),['S1']);
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
test('an exact dialogue quote does not verify a model-supplied speaker without a speech anchor',()=>{
 const quote='But extraordinary men have a right to commit any crime and to transgress the law in any way, just because they are extraordinary.';
 const preview='But extraordinary men have a right to commit any crime and to transgress the law in any way, just because they are extraordinary. That was your idea, if I am not mistaken?’ ‘What do you mean? That can’t be right?’ Razumihin muttered in bewilderment. Raskolnikov smiled again. He decided to take up the challenge. ‘That wasn’t quite my contention,’ he began simply and modestly.';
 const review=parseReview(JSON.stringify({coverage:'full',missing:'',evidence:[{
  id:'S1',point:'Raskolnikov states the theory.',quote,speaker:'Raskolnikov'
 }]}),[{id:'S1',preview}]);
 assert.equal(review.evidenceMap[0].quoteVerified,true);
 assert.equal(review.evidenceMap[0].speaker,undefined);
 assert.equal(review.evidenceMap[0].speakerUnverified,true);
 const explicitlyAttributed=parseReview(JSON.stringify({coverage:'full',missing:'',evidence:[{
  id:'S1',point:'Raskolnikov states the line.',quote:'That is true',speaker:'Raskolnikov'
 }]}),[{id:'S1',preview:'“That is true,” said Raskolnikov.'}]);
 assert.equal(explicitlyAttributed.evidenceMap[0].speaker,'Raskolnikov');
 assert.equal(explicitlyAttributed.evidenceMap[0].speakerUnverified,undefined);
});
test('omits speaker-attributed claims that cite dialogue without a verified speaker anchor',()=>{
 const answer='Raskolnikov says extraordinary men may do anything they wish [S1]. He argues that the theory gives him an unrestricted right to kill [S1].';
 const evidenceMap=[
  {id:'S1',point:'A dialogue passage with several speakers.',quoteVerified:true,
   anchorQuote:'But extraordinary men have a right to commit any crime.',speakerUnverified:true},
  {id:'S2',point:'Raskolnikov later explains the theory.',quoteVerified:true,
   anchorQuote:'I had a right to transgress.',speaker:'Raskolnikov'}
 ];
 const result=removeConflictingSpeakerAttributions(answer,evidenceMap);
 assert.equal(result.conflicts.length,2);
 assert(result.conflicts.every(item=>item.reason==='unverified-dialogue-speaker'));
 assert.equal(result.answer,'');
});
test('a dialogue claim marked unverified cannot survive as unqualified when the excerpt corrects it',()=>{
 const source={id:'S1',preview:'A speaker summarizes Mara’s view. Mara says, “That is not quite my contention.” The narrator calls the summary an exaggerated distortion of her position.'};
 const evidence=[{id:'S1',point:'The excerpt contains a disputed summary of Mara’s position.',
  quoteVerified:true,speakerUnverified:true}];
 const unsafe='Mara believes the rule grants an unrestricted right to ignore it [S1].';
 const result=removeUnqualifiedCorrectedClaims(unsafe,evidence,[source]);
 assert.equal(result.conflicts.length,1);
 assert.doesNotMatch(result.answer,/Mara believes the rule grants an unrestricted right/i);
 assert.match(result.answer,/marks this reported account as distorted or corrected/i);
 assert.match(result.answer,/\[S1\]/);

 const carefullyFramed='The excerpt calls the summary an exaggerated distortion and records Mara’s correction [S1].';
 const retained=removeUnqualifiedCorrectedClaims(carefullyFramed,evidence,[source]);
 assert.equal(retained.conflicts.length,0);
 assert.equal(retained.answer,carefullyFramed);
});

test('recognizes the Dostoevsky excerpt correction written as “wasn’t quite my contention”',()=>{
 const source={id:'S1',preview:'Crime and Punishment have no right to transgress the law, because, don’t you see, they are ordinary. But extraordinary men have a right to commit any crime and to transgress the law in any way, just because they are extraordinary. That was your idea, if I am not mistaken? What do you mean? That can’t be right? Razumihin muttered in bewilderment. Raskolnikov smiled again. He saw the point at once, and knew where they wanted to drive him. He decided to take up the challenge. That wasn’t quite my contention, he began simply and modestly. Yet I admit that you have stated it almost correctly; perhaps, if you like, perfectly so. The only difference is that I don’t contend that extraordinary people are always bound to commit breaches of morals, as you call it. I simply hinted that an extraordinary man has the right—not an official right, but an inner right to decide in his own conscience to overstep certain obstacles, and only in case it is…'};
 const evidence=[{id:'S1',point:'A dialogue passage presents Raskolnikov’s theory through another speaker, then records his correction.',
  quoteVerified:true,speakerUnverified:true}];
 const unsafe='According to this idea, ordinary people have no right to transgress the law [S1]. In contrast, extraordinary men possess a right to commit any crime and violate the law in any way simply because of their extraordinary nature [S1].';
 const result=removeUnqualifiedCorrectedClaims(unsafe,evidence,[source]);
 assert.equal(result.conflicts.length,2);
 assert.doesNotMatch(result.answer,/ordinary people have no right/i);
 assert.doesNotMatch(result.answer,/extraordinary men possess a right to commit any crime/i);
 assert.match(result.answer,/marks this reported account as distorted or corrected/i);

 const bounded='Raskolnikov acknowledges that the restatement is nearly correct, but clarifies that he means an inner right of conscience rather than an official right [S1].';
 const retained=removeUnqualifiedCorrectedClaims(bounded,evidence,[source]);
 assert.equal(retained.conflicts.length,0);
 assert.equal(retained.answer,bounded);
});

test('preserves a reported dialogue view when the same passage explicitly qualifies it',()=>{
 const source={id:'S1',bookId:'114',page:465,preview:'But extraordinary men have a right to commit any crime and to transgress the law in any way, just because they are extraordinary. That was your idea, if I am not mistaken? Raskolnikov smiled again. He decided to take up the challenge. “That wasn’t quite my contention,” he began simply and modestly. “Yet I admit that you have stated it almost correctly; perhaps, if you like, perfectly so.” The only difference is that I don’t contend that extraordinary people are always bound to commit breaches of morals. I simply hinted that an extraordinary man has the right—not an official right, but an inner right to decide in his own conscience to overstep certain obstacles.'};
 const evidence=[{id:'S1',point:'The passage reports Raskolnikov’s theory and records his qualification.',
  quoteVerified:true,speakerUnverified:true}];
 const answer='Razumihin’s summary presents Raskolnikov’s theory as allowing extraordinary people to transgress the law; Raskolnikov accepts the account as almost correct, but qualifies it as an inner right of conscience to decide whether to cross certain barriers [S1].';
 const guarded=removeConflictingSpeakerAttributions(answer,evidence,[source]);
 assert.equal(guarded.conflicts.length,0);
 assert.equal(guarded.answer,answer);
 const corrected=removeUnqualifiedCorrectedClaims(guarded.answer,evidence,[source]);
 assert.equal(corrected.conflicts.length,0);
 assert.equal(corrected.answer,answer);
});

test('removes uncited author-specific claims and preserves cited statements',()=>{
 const sources=[
  {id:'S1',title:'Nicomachean Ethics — Aristotle',preview:'Aristotle connects political inquiry with the human good.'},
  {id:'S2',title:'Leviathan — Thomas Hobbes',preview:'Hobbes explains the role of common power.'}
 ];
 const answer='Aristotle connects political inquiry with a human good [S1]. Hobbes identifies common power as protection against enemies [S2]. While Aristotle seeks the highest good, Hobbes expresses significant disdain for the Aristotelian tradition.';
 const result=removeUncitedAuthorClaims(answer,sources);
 assert.deepEqual(result.removed,[
  'While Aristotle seeks the highest good, Hobbes expresses significant disdain for the Aristotelian tradition.'
 ]);
 assert.equal(result.answer,'Aristotle connects political inquiry with a human good [S1]. Hobbes identifies common power as protection against enemies [S2].');
});

test('carries a dialogue correction across adjacent cited pages in the same book',()=>{
 const sources=[
  {id:'S1',bookId:'114',page:465,preview:'Porfiry says extraordinary men have a right to commit any crime because they are extraordinary. Raskolnikov replies that this is not quite his contention.'},
  {id:'S2',bookId:'114',page:464,preview:'Porfiry says the account is an exaggerated and intentional distortion of Raskolnikov’s idea.'}
 ];
 const evidence=[
  {id:'S1',point:'A dialogue passage gives Porfiry’s reported summary.',speakerUnverified:true},
  {id:'S2',point:'The surrounding dialogue identifies Porfiry’s summary as distorted.',speakerUnverified:true}
 ];
 const answer='Extraordinary people have a right to commit any crime simply because they are extraordinary [S1]. The excerpt marks this reported account as an exaggerated distortion [S2].';
 const result=removeUnqualifiedCorrectedClaims(answer,evidence,sources);
 assert.equal(result.conflicts.length,1);
 assert.match(result.conflicts[0].sourceIds.join(','),/S1/);
 assert.doesNotMatch(result.answer,/Extraordinary people have a right to commit any crime/);
 assert.match(result.answer,/marks this reported account as distorted or corrected/i);
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

test('evidence highlights crop a long relevant sentence instead of choosing a weaker sentence',()=>{
 const text='Background about species and prior observations. '+
  'It is, however, an error to suppose that there would be no struggle for existence, and, consequently, no natural selection, until many forms had been produced: variations in a single species inhabiting an isolated station might be beneficial, and thus the whole mass of individuals might be modified, or two distinct forms might arise. '+
  'But no one ought to feel surprise at much remaining unexplained, given our profound ignorance about the mutual relations of inhabitants across past ages.';
 const quote=sourceExcerpt(text,
  'Darwin says struggle for existence and natural selection occur before many forms, through beneficial variations in an isolated station.',320);
 assert.match(quote,/no struggle for existence/);
 assert.match(quote,/isolated station/);
 assert.doesNotMatch(quote,/profound ignorance/);
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
  schema:'antilogicalism-reader-packet-v2',libraryVersion:48,
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
  schema:'antilogicalism-reader-packet-v2',libraryVersion:48,
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
 const content='The real cause of this historical conflict was increased strength and fear among rival cities. The truce disagreements were immediate disputes. See https://example.org/history for context.\nfile:///C|/WINDOWS/Desktop/blahh/i.html (4 of 5) [2/20/2001 3:15:45 AM]';
 const raw=new TextEncoder().encode(content);
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)),x=>x.toString(16).padStart(2,'0')).join('');
 const canonical={
   schema:'antilogicalism-reader-fingerprints-v2',hashAlgorithm:'SHA-256-utf8-exact',
   libraryVersion:48,bookId:'152',chunk:1,firstPage:33,lastPage:64,
   title:'Canonical History — Thucydides',pdfDriveId:PDF,
   pages:[{page:38,globalPageId:34403,utf8Bytes:raw.byteLength,sha256:hash}]
 };
 const fetcher=async(url)=>{
   assert.equal(url,'https://jsynon.github.io/antilogicalism-library-data/reader-fingerprints-v2/books/152/1.json');
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
 const meta={schema:'antilogicalism-reader-fingerprints-v2',hashAlgorithm:'SHA-256-utf8-exact',
    libraryVersion:48,bookId:'152',title:'A Trusted Book',pdfDriveId:PDF,chunk:1,firstPage:33,lastPage:64,
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


test('v1.9.4 exact v48 source generates two bounded AI stages with canonical citation',async()=>{
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
test('v1.9.5 exact v49 source generates two bounded AI stages with v3 fingerprints',async()=>{
 const fixture=await fingerprintTestFixture({libraryVersion:49});
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
 assert.equal(fixture.stats().aiCount,2);
 assert.equal(fixture.stats().fetchCount,1);
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
test('an empty evidence review shows a relevant verified passage without another model call',async()=>{
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
 assert.equal(data.reviewStatus,'retrieved_passages_only');
 assert.deepEqual(data.citations.map(source=>source.id),['S1']);
 assert.match(data.answer,/growing power created fear among competing cities/);
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
  assert.match(input.messages[0].content,/The first evidence review selected no passages/);
  assert.match(input.messages[0].content,/Inspect every excerpt and answer any part it supports/);
  assert.match(input.messages[0].content,/cite each source-based sentence/);
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
test('empty-review recovery handles a plain-text composition without throwing',async()=>{
 const question='According to 1 John 4:7–12, what does “God is love” mean, and how does the passage connect God’s love with loving one another?';
 const source={id:'S1',bookId:'335',title:'New King James Version Bible — Various authors',page:5546,
  preview:'1 JOHN 4 7 Beloved, let us love one another, for love is of God; and everyone who loves is born of God and knows God. 8 He who does not love does not know God, for God is love. 9 In this the love of God was manifested toward us, that God has sent His only begotten Son into the world, that we might live through Him. 10 In this is love, not that we loved God, but that He loved us and sent His Son for our sins. 11 Beloved, if God so loved us, we also ought to love one another. 12 If we love one another, God abides in us, and His love has been perfected in us.'};
 let calls=0;const inputs=[];
 const ai={run:async(_model,input)=>{
  calls++;
  inputs.push(input);
  if(calls===1)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   coverage:'none',missing:'No requested part was supported.',questionParts:[
    {part:'What does “God is love” mean?',status:'unsupported',evidenceIds:[]},
    {part:'How does the passage connect God’s love with loving one another?',status:'unsupported',evidenceIds:[]}
   ],evidence:[]
  })}}]};
  // A provider can return usable prose while ignoring the requested JSON
  // schema. It must not crash while the empty-review path inspects metadata.
  return {choices:[{finish_reason:'stop',message:{content:
   'The passage says God is love and describes God sending the Son so people might live [S1].'}}]};
 }};
 const result=await composeVerifiedAnswer(question,[source],ai);
 assert.equal(calls,2);
 assert.match(inputs[1].messages[0].content,/Answer each requested part directly/);
 assert.match(inputs[1].messages[0].content,/Develop the explanation with relevant reasons/);
 assert.equal(result.outcome,'unverified-source-draft');
 assert.equal(result.coverage,'none');
 assert.equal(result.reviewStatus,'answer-draft-unverified');
 assert.deepEqual(result.citations.map(item=>item.id),['S1']);
 assert.match(result.answer,/describes God sending the Son/);
 assert.doesNotMatch(result.answer,/available passages do not fully address/i);
 assert.match(result.missing,/provisional/);
});
test('empty-review recovery exposes a cited lexical draft only as partial and unverified',async()=>{
 const question='According to 1 John 4:7–12, what does “God is love” mean, and how does the passage connect God’s love with loving one another?';
 const parts=['What does “God is love” mean?',
  'How does the passage connect God’s love with loving one another?'];
 const source={id:'S1',bookId:'335',title:'New King James Version Bible — Various authors',page:5546,
  preview:'1 JOHN 4 7 Beloved, let us love one another, for love is of God; and everyone who loves is born of God and knows God. 8 He who does not love does not know God, for God is love. 9 In this the love of God was manifested toward us, that God has sent His only begotten Son into the world, that we might live through Him. 10 In this is love, not that we loved God, but that He loved us and sent His Son to be the propitiation for our sins. 11 Beloved, if God so loved us, we also ought to love one another. 12 If we love one another, God abides in us, and His love has been perfected in us.'};
 let calls=0;
 const ai={run:async()=>{
  calls++;
  if(calls===1)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   coverage:'none',missing:'No requested part was supported.',
   questionParts:parts.map(part=>({part,status:'unsupported',evidenceIds:[]})),evidence:[]
  })}}]};
  return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   answer:'In 1 John 4:7–12, the statement that God is love is evidenced by the fact that God demonstrated His love by sending His only begotten Son into the world to serve as the propitiation for sins so that humanity might live through Him [S1]. Because God showed this type of love toward humanity, believers have an obligation to love one another [S1]. Additionally, the passage indicates that when people love one another, God abides in them and His love is perfected in them [S1].',
   partChecks:parts.map(part=>({part,status:'unsupported',evidenceIds:[]})),evidence:[]
  })}}]};
 }};
 const result=await composeVerifiedAnswer(question,[source],ai);
 assert.equal(calls,2);
 assert.equal(result.outcome,'unverified-source-draft');
 assert.equal(result.coverage,'partial');
 assert.equal(result.reviewStatus,'answer-draft-lexical-match');
 assert.deepEqual(result.citations.map(item=>item.id),['S1']);
 assert.deepEqual(result.questionParts.map(part=>part.status),['partial','partial']);
 assert.ok(result.evidenceMap.every(item=>item.lexicalMatchOnly&&item.quoteVerified===false));
 assert.match(result.missing,/did not verify the claims/);
 assert.match(result.notice,/not semantic claim verification/);
});
test('empty-review lexical recovery rejects a draft with only broad topic-word overlap',async()=>{
 const question='According to Darwin, how does natural selection preserve inherited variation?';
 const parts=['how natural selection preserves inherited variation'];
 const source={id:'S1',bookId:'529',title:'On the Origin of Species — Charles Darwin',page:101,
  preview:'If it profit a plant to have its seeds more and more widely disseminated by the wind, I can see no greater difficulty in this being effected through natural selection, than in the cotton planter increasing and improving by selection the down in the pods on his cotton trees.'};
 let calls=0;
 const ai={run:async()=>{
  calls++;
  if(calls===1)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   coverage:'none',missing:'No requested part was supported.',
   questionParts:parts.map(part=>({part,status:'unsupported',evidenceIds:[]})),evidence:[]
  })}}]};
  return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   answer:'Natural selection preserves inherited variations that help a species survive and reproduce [S1].',
   partChecks:parts.map(part=>({part,status:'unsupported',evidenceIds:[]})),evidence:[]
  })}}]};
 }};
 const result=await composeVerifiedAnswer(question,[source],ai);
 assert.equal(calls,2);
 assert.equal(result.outcome,'unverified-source-draft');
 assert.equal(result.coverage,'none');
 assert.equal(result.reviewStatus,'answer-draft-unverified');
 assert.deepEqual(result.questionParts.map(part=>part.status),['unsupported']);
 assert.deepEqual(result.evidenceMap,[]);
});
test('empty-review fallback surfaces only query-matched verified passages without another AI call',async()=>{
 const cases=[
  {
   question:'According to Thucydides, what were the underlying causes of the Peloponnesian War, and how did they differ from the immediate disputes that preceded it?',
   parts:['underlying causes of the Peloponnesian War','how they differed from the immediate disputes'],
   sources:[
    {id:'S1',bookId:'152',title:'History of the Peloponnesian War — Thucydides',page:38,
     preview:'To the question why they broke I answer by placing first an account of their grounds of complaint and points of difference, that no one may ever have to ask the immediate cause which plunged the Hellenes into a war of such magnitude. The real cause I consider to be the one which was formally most kept out of sight: the growth of the power of Athens, and the alarm which this inspired in Lacedaemon, made war inevitable.'},
    {id:'S2',bookId:'999',title:'An unrelated book',page:12,
     preview:'The author considers the causes of sleep and the immediate needs of a child.'}
   ],expected:'growth of the power of Athens'
  },
  {
   question:'According to 1 John 4:7–12, what does “God is love” mean, and how does the passage connect God’s love with loving one another?',
   parts:['What does “God is love” mean?','How does the passage connect God’s love with loving one another?'],
   sources:[
    {id:'S1',bookId:'335',title:'New King James Version Bible — Various authors',page:5546,
     preview:'1 JOHN 4 7 Beloved, let us love one another, for love is of God; and everyone who loves is born of God and knows God. 8 He who does not love does not know God, for God is love. 9 In this the love of God was manifested toward us, that God has sent His only begotten Son into the world, that we might live through Him. 10 In this is love, not that we loved God, but that He loved us and sent His Son to be the propitiation for our sins. 11 Beloved, if God so loved us, we also ought to love one another. 12 No one has seen God at any time. If we love one another, God abides in us, and His love has been perfected in us.'},
    {id:'S2',bookId:'638',title:'A commentary on an unrelated passage',page:88,
     preview:'The note discusses the history of a manuscript and several editorial choices.'}
   ],expected:'God is love'
  }
 ];
 for(const item of cases){
  const calls=[];
  const ai={run:async(_model,input)=>{
   calls.push(input);
   if(calls.length===1)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
    coverage:'none',missing:'No passages selected.',
    questionParts:item.parts.map(part=>({part,status:'unsupported',evidenceIds:[]})),evidence:[]
   })}}]};
   return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
    answer:'The verified passages do not provide enough evidence to answer this question reliably.',
    partChecks:item.parts.map(part=>({part,status:'unsupported',evidenceIds:[]})),evidence:[]
   })}}]};
  }};
  const result=await composeVerifiedAnswer(item.question,item.sources,ai);
  assert.equal(calls.length,2);
  assert.equal(result.outcome,'insufficient-evidence');
  assert.equal(result.coverage,'none');
  assert.equal(result.reviewStatus,'retrieved_passages_only');
  assert.match(result.answer,/did not produce a reliable synthesis/);
  assert.match(result.answer,new RegExp(item.expected));
  assert.deepEqual(result.citations.map(source=>source.id),['S1']);
  assert.deepEqual(result.evidenceMap,[]);
 }
});
test('source-linked evidence prevents a none review from entering empty-review recovery',async()=>{
 const question='According to 1 John 4:7–12, what does “God is love” mean, and how does the passage connect God’s love with loving one another?';
 const source={id:'S1',bookId:'335',title:'New King James Version Bible — Various authors',page:5546,
  preview:'1 JOHN 4 7 Beloved, let us love one another, for love is of God; and everyone who loves is born of God and knows God. 8 He who does not love does not know God, for God is love. 9 In this the love of God was manifested toward us, that God has sent His only begotten Son into the world, that we might live through Him. 10 In this is love, not that we loved God, but that He loved us and sent His Son for our sins. 11 Beloved, if God so loved us, we also ought to love one another. 12 If we love one another, God abides in us, and His love has been perfected in us.'};
 const calls=[];
 const ai={run:async(_model,input)=>{
  calls.push(input);
  if(calls.length===1)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   coverage:'none',missing:'No requested part is supported.',
   questionParts:[
    {part:'What does “God is love” mean?',status:'unsupported',evidenceIds:[]},
    {part:'How does the passage connect God’s love with loving one another?',status:'unsupported',evidenceIds:[]}
   ],
   evidence:[
    {id:'S1',point:'Love originates in God, and those who love are born of God and know God.',quote:'love is of God; and everyone who loves is born of God and knows God.'},
    {id:'S1',point:'God manifested love by sending the Son so people might live through him.',quote:'God has sent His only begotten Son into the world, that we might live through Him.'},
    {id:'S1',point:'God loved humanity first and sent the Son for sins.',quote:'not that we loved God, but that He loved us and sent His Son for our sins.'},
    {id:'S1',point:'Because God loved humanity, believers ought to love one another.',quote:'Beloved, if God so loved us, we also ought to love one another.'},
    {id:'S1',point:'When believers love one another, God abides in them and love is perfected.',quote:'If we love one another, God abides in us, and His love has been perfected in us.'}
   ]
  })}}]};
  assert.match(input.messages[1].content,/Evidence map \(reviewed points\):/);
  assert.match(input.messages[1].content,/Coverage: partial/);
  assert.doesNotMatch(input.messages[1].content,/initial evidence-selection pass selected no passages/);
  return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   answer:'The passage says love originates in God, so those who love are born of God and know God [S1]. It explains “God is love” through God’s action: sending the Son so people might live, and sending him for their sins [S1]. It then connects God’s prior love with the obligation to love one another [S1]. The passage adds that when believers love one another, God abides in them and divine love is perfected in them [S1].',
   partChecks:[
    {part:'What does “God is love” mean?',status:'supported',evidenceIds:['S1']},
    {part:'How does the passage connect God’s love with loving one another?',status:'supported',evidenceIds:['S1']}
   ],
   evidence:[{id:'S1',point:'The passage grounds the command to love one another in God’s prior love.',quote:'if God so loved us, we also ought to love one another.'}]
  })}}]};
 }};
 const result=await composeVerifiedAnswer(question,[source],ai);
 assert.equal(calls.length,2);
 assert.equal(result.outcome,'verified-source-draft');
 assert.equal(result.coverage,'full');
 assert.equal(result.reviewStatus,'claim_support_not_independently_verified');
 assert.deepEqual(result.citations.map(item=>item.id),['S1']);
 assert.deepEqual(result.questionParts.map(item=>item.status),['supported','supported']);
 assert.equal(result.evidenceMap.length,5);
});

test('empty-review recovery aligns quote-verified evidence with a cited answer',async()=>{
 const question='According to 1 John 4:7–12, what does “God is love” mean, and how does the passage connect God’s love with loving one another?';
 const source={id:'S1',bookId:'335',title:'New King James Version Bible — Various authors',page:5546,
  preview:'1 JOHN 4 7 Beloved, let us love one another, for love is of God; and everyone who loves is born of God and knows God. 8 He who does not love does not know God, for God is love. 9 In this the love of God was manifested toward us, that God has sent His only begotten Son into the world, that we might live through Him. 10 In this is love, not that we loved God, but that He loved us and sent His Son for our sins. 11 Beloved, if God so loved us, we also ought to love one another. 12 If we love one another, God abides in us, and His love has been perfected in us.'};
 let call=0;const prompts=[];
 const ai={run:async(_model,input)=>{
  call++;
  prompts.push(input);
  if(call===1)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   coverage:'none',missing:'No requested part is supported.',questionParts:[
    {part:'What does “God is love” mean?',status:'unsupported',evidenceIds:[]},
    {part:'How does the passage connect God’s love with loving one another?',status:'unsupported',evidenceIds:[]}
   ],evidence:[]
  })}}]};
  return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   answer:'Love comes from God; those who love are born of God and know God, and the passage says that God is love [S1]. God manifests this love by sending His Son so people may live, and the passage says that God loved humanity first [S1]. Because of this prior love, believers ought to love one another [S1]. When they do, God abides in them and His love is perfected in them [S1].',
   partChecks:[
    {part:'What does “God is love” mean?',status:'supported',evidenceIds:['S1']},
    {part:'How does the passage connect God’s love with loving one another?',status:'supported',evidenceIds:['S1']}
   ],evidence:[
    {id:'S1',point:'Love comes from God, and those who love are born of God and know God.',quote:'love is of God; and everyone who loves is born of God and knows God.'},
    {id:'S1',point:'God is love, and those who do not love do not know God.',quote:'He who does not love does not know God, for God is love.'},
    {id:'S1',point:'God manifested love by sending the Son so people might live through him.',quote:'God has sent His only begotten Son into the world, that we might live through Him.'},
    {id:'S1',point:'God loved humanity first and sent the Son for sins.',quote:'not that we loved God, but that He loved us and sent His Son for our sins.'},
    {id:'S1',point:'Because God loved the community, believers ought to love one another.',quote:'Beloved, if God so loved us, we also ought to love one another.'},
    {id:'S1',point:'Mutual love is associated with God abiding in believers and divine love being perfected in them.',quote:'If we love one another, God abides in us, and His love has been perfected in us.'}
   ]
  })}}]};
 }};
 const result=await composeVerifiedAnswer(question,[source],ai);
 assert.equal(call,2);
 assert.match(prompts[1].messages[0].content,/Cross-check answer and partChecks for consistency/);
 assert.match(prompts[1].messages[0].content,/Complementary passages may support separate sides/);
 assert.match(prompts[1].messages[0].content,/Preserve meaningful qualifications/);
 assert.match(prompts[1].messages[0].content,/Mark a part supported only if the answer explains it with cited evidence/);
 assert.match(prompts[1].messages[0].content,/add an exact short quote only when it can be copied confidently/);
 assert.match(prompts[1].messages[0].content,/answer any part it supports/);
 assert.match(prompts[1].messages[0].content,/cite each source-based sentence inline \[S1\]/);
 assert.match(prompts[1].messages[0].content,/partChecks\/evidence IDs are not citations/);
 assert.match(prompts[1].messages[0].content,/synthesize them in direct prose instead of returning only excerpts/);
 assert.match(prompts[1].messages[0].content,/Prefer a relevant direct passage from the named primary work over a secondary quotation/);
 assert.equal(result.outcome,'verified-source-draft');
 assert.equal(result.coverage,'full');
 assert.equal(result.reviewStatus,'claim_support_not_independently_verified');
 assert.deepEqual(result.citations.map(item=>item.id),['S1']);
 assert.deepEqual(result.questionParts.map(item=>item.status),['supported','supported']);
 assert.ok(result.questionParts.every(part=>part.evidenceIds.includes('S1')));
 assert.equal(result.evidenceMap.length,6);
});
test('all-books empty-review recovery anchors claims to exact quotes from the right parallel-edition pages',async()=>{
 const question='According to 1 John 4:7–12, what does “God is love” mean, and how does the passage connect God’s love with loving one another?';
 const sources=[
  {id:'S1',bookId:'335',title:'New King James Version Bible — Various authors',page:5546,
   preview:'1 JOHN 4 7 Beloved, let us love one another, for love is of God; and everyone who loves is born of God and knows God. 8 He who does not love does not know God, for God is love. 9 In this the love of God was manifested toward us, that God has sent His only begotten Son into the world, that we might live through Him. 10 In this is love, not that we loved God, but that He loved us and sent His Son to be the propitiation for our sins.'},
  {id:'S2',bookId:'335',title:'New King James Version Bible — Various authors',page:5547,
   preview:'11 Beloved, if God so loved us, we also ought to love one another. 12 No one has seen God at any time. If we love one another, God abides in us, and His love has been perfected in us.'},
  {id:'S3',bookId:'638',title:'The New Oxford Annotated Bible, Fully Revised Fifth Edition — edited by Michael D. Coogan',page:1821,
   preview:'Christians are reminded that their obligation to love one another is grounded not only in God’s command but in God’s nature as love (4.7–12).'}
 ];
 const calls=[];
 const ai={run:async(_model,input)=>{
  calls.push(input);
  if(calls.length===1)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   coverage:'none',missing:'No passages selected.',
   questionParts:[
    {part:'What does “God is love” mean?',status:'unsupported',evidenceIds:[]},
    {part:'How does the passage connect God’s love with loving one another?',status:'unsupported',evidenceIds:[]}
   ],evidence:[]
  })}}]};
  assert.match(input.messages[1].content,/page 5546/);
  assert.match(input.messages[1].content,/page 5547/);
  assert.match(input.messages[0].content,/add an exact short quote only when it can be copied confidently/);
  return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   answer:'The passage identifies love as originating in God and says that God is love; it illustrates this by describing God sending the Son so people might live [S1]. It also defines love through God’s initiative: God loved people and sent the Son for their sins [S1]. The passage then connects that prior love to believers’ obligation to love one another [S2]. It adds that when they do, God abides in them and divine love is perfected in them [S2].',
   partChecks:[
    {part:'What does “God is love” mean?',status:'supported',evidenceIds:['S1']},
    {part:'How does the passage connect God’s love with loving one another?',status:'supported',evidenceIds:['S1','S2']}
   ],evidence:[
    {id:'S1',point:'The passage says love originates in God and calls God love.',quote:'love is of God; and everyone who loves is born of God and knows God. 8 He who does not love does not know God, for God is love.'},
    {id:'S1',point:'God’s love is manifested by sending the Son so people might live.',quote:'God has sent His only begotten Son into the world, that we might live through Him.'},
    {id:'S1',point:'Love is described as God’s initiative toward humanity.',quote:'not that we loved God, but that He loved us and sent His Son to be the propitiation for our sins.'},
    {id:'S2',point:'God’s prior love grounds the obligation for believers to love one another.',quote:'Beloved, if God so loved us, we also ought to love one another.'},
    {id:'S2',point:'The passage connects mutual love with God abiding in believers and love being perfected.',quote:'If we love one another, God abides in us, and His love has been perfected in us.'}
   ]
  })}}],usage:{neurons:3}};
 }};
 const result=await composeVerifiedAnswer(question,sources,ai);
 assert.equal(calls.length,2);
 assert.equal(result.outcome,'verified-source-draft');
 assert.equal(result.coverage,'full');
 assert.deepEqual(result.citations.map(source=>source.id),['S1','S2']);
 assert.deepEqual(result.questionParts.map(part=>part.status),['supported','supported']);
 assert.deepEqual(result.evidenceMap.map(item=>[item.id,item.quoteVerified]),[
  ['S1',true],['S1',true],['S1',true],['S2',true],['S2',true]
 ]);
});

test('empty-review recovery keeps cited partial answer when exact quote anchors are unavailable',async()=>{
 const question='According to 1 John 4:7–12, what does “God is love” mean, and how does the passage connect God’s love with loving one another?';
 const source={id:'S1',bookId:'335',title:'New King James Version Bible — Various authors',page:5546,
  preview:'1 JOHN 4 7 Beloved, let us love one another, for love is of God; and everyone who loves is born of God and knows God. 8 He who does not love does not know God, for God is love. 9 In this the love of God was manifested toward us, that God has sent His only begotten Son into the world, that we might live through Him. 10 In this is love, not that we loved God, but that He loved us and sent His Son for our sins. 11 Beloved, if God so loved us, we also ought to love one another. 12 If we love one another, God abides in us, and His love has been perfected in us.'};
 let calls=0;
 const ai={run:async()=>{
  calls++;
  if(calls===1)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   coverage:'none',missing:'No requested part was supported.',questionParts:[
    {part:'What does “God is love” mean?',status:'unsupported',evidenceIds:[]},
    {part:'How does the passage connect God’s love with loving one another?',status:'unsupported',evidenceIds:[]}
   ],evidence:[]
  })}}]};
  return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   answer:'The passage calls God love and describes love as shown through God sending the Son so people might live [S1]. It connects God’s prior love with the obligation to love one another [S1].',
   partChecks:[
    {part:'What does “God is love” mean?',status:'unsupported',evidenceIds:['S1']},
    {part:'How does the passage connect God’s love with loving one another?',status:'unsupported',evidenceIds:['S1']}
   ],evidence:[
    {id:'S1',point:'God is called love, and the passage describes love through God sending the Son.'},
    {id:'S1',point:'The passage grounds the obligation to love one another in God’s prior love.'}
   ]
  })}}]};
 }};
 const result=await composeVerifiedAnswer(question,[source],ai);
 assert.equal(calls,2);
 assert.equal(result.outcome,'verified-source-draft');
 assert.equal(result.coverage,'partial');
 assert.deepEqual(result.citations.map(item=>item.id),['S1']);
 assert.deepEqual(result.questionParts.map(item=>item.status),['partial','partial']);
 assert.ok(result.evidenceMap.every(item=>item.quoteVerified===false));
 assert.doesNotMatch(result.answer,/available passages do not fully address|partially supported/i);
 assert.match(result.missing,/provisional|partially supported/i);
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
 assert.match(prompts[1].messages[0].content,/first evidence review selected no passages/);
 assert.match(prompts[1].messages[0].content,/Keep commentary separate from primary text/);
 assert.match(prompts[1].messages[0].content,/evidence array/);
 assert.doesNotMatch(prompts[1].messages[0].content,/questionParts checklist/);
});
test('v1.9.4 fabricated citations fail closed and missing citations return source passages safely',async()=>{
 for(const fabricated of ['The answer is clear [S9].',
   'The answer is clear [S1, S9] [S1].']){
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
 const fixture=await fingerprintTestFixture();
 let calls=0;
 const result=await fixture.response({aiRun:async()=>{
   calls++;return {choices:[{finish_reason:'stop',message:{content:calls===1?
    JSON.stringify({coverage:'full',missing:'',evidence:[{id:'S1',point:'Relevant supported passage point.'}]}):
    'An unsupported claim without a source.'}}],usage:{neurons:4}};
 }});
 assert.equal(result.status,200);
 const data=await result.json();
 assert.equal(data.outcome,'insufficient-evidence');
 assert.equal(data.reviewStatus,'retrieved_passages_only');
 assert.match(data.answer,/did not contain usable citations/);
 assert.deepEqual(data.citations.map(source=>source.id),['S1']);
 assert.equal(calls,2);
});
test('v1.14 keeps safe sentences when quotation repair fails and removes the mismatched sentence',async()=>{
 for(const repair of ['mismatch','provider-error','all-invalid']){
  const fixture=await fingerprintTestFixture();
  let calls=0;
  const result=await fixture.response({aiRun:async()=>{
    calls++;
    if(calls===3&&repair==='provider-error')throw new Error('provider unavailable');
    const content=calls===1?
      JSON.stringify({coverage:'full',missing:'',evidence:[{id:'S1',point:'Relevant supported passage point.'}]}):
      repair==='all-invalid'?
       'The passage calls this “the atoning sacrifice because we obey his commandments and do for my sins” [S1].':
       'The passage distinguishes an immediate dispute from fear caused by growing power [S1]. The passage calls this “the atoning sacrifice because we obey his commandments and do for my sins” [S1].';
    return {choices:[{finish_reason:'stop',message:{content}}],usage:{neurons:4}};
  }});
  assert.equal(result.status,200);
  const data=await result.json();
  assert.equal(data.quotationRepairFallback,true);
  if(repair==='all-invalid'){
   assert.equal(data.outcome,'insufficient-evidence');
   assert.equal(data.reviewStatus,'retrieved_passages_only');
   assert.match(data.notice,/answer draft contained an unverified quotation/);
  }else{
   assert.equal(data.outcome,'verified-source-draft');
   assert.equal(data.answer,'The passage distinguishes an immediate dispute from fear caused by growing power [S1].');
   assert.match(data.notice,/sentences containing unverified quotations were removed/);
  }
  assert.equal(calls,3);
 }
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
 assert.match(answerSystem,/honor explicit work, chapter, verse, section, or page limits/);
 assert.match(answerSystem,/requested work or passage scope/);
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
