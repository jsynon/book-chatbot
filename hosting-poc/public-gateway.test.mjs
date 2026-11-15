import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as support from './public-gateway.test-support.mjs';
import {deduplicateRetrievedEvidenceCandidates} from './public-gateway.mjs';
const {gzipSync,gateway,handleRequest,trustedSources,trustedPacketSources,verifiedFingerprintSources,prepareCandidatePages,sourceExcerpt,turnstileRejection,inferenceFailureDiagnostics,answerPipelineFailureDiagnostics,workerVersionDiagnostics,PILOT_BOOKS,PILOT_BOOK_IDS,planSearchQueries,planSearchGapQueries,stripWebCaptureFooters,selectPublicEvidenceHighlights,HOST,PDF,manifest,pages,question,payload,fetcher,env,fingerprintTestFixture,pilotBaseEnv,pilotScenario}=support;

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
 // Audit fix (2026-11-15): a missing Origin is itself forbidden —
 // the probe's local gate no longer lets origin-less requests
 // through to the token and configuration checks.
 const absent=await handleRequest(new Request(url,{method:'POST',body:JSON.stringify(sent)}),env(),fetcher);
 assert.equal(absent.status,403);
 assert.equal(fetched,0);
 const token='valid-long-local-fingerprint-test-secret-123';
 const wrong=await handleRequest(new Request(url,{method:'POST',
   headers:{Origin:'http://127.0.0.1:8766',Authorization:'Bearer not-the-secret'},body:JSON.stringify(sent)}),
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


test('retrieval candidates suppress duplicate copies before selector while preserving requested edition comparisons',()=>{
 const text='A sufficiently long and distinctive passage is repeated word for word across two catalog copies, preserving the same source content for the reader. This additional sentence ensures the example exceeds the minimum passage size used for conservative duplicate detection, with several more exact words here.';
 const candidates=[
  {id:'A',title:'On Liberty — John Stuart Mill',provenance:{work:'On Liberty'},page:6,text,score:98},
  {id:'B',title:'Essays: English and American — Various Authors',provenance:{work:'On Liberty'},page:211,text,score:94}
 ];
 const deduped=deduplicateRetrievedEvidenceCandidates(candidates,'What does Mill say about liberty?');
 assert.deepEqual(deduped.candidates.map(item=>item.id),['A']);
 assert.deepEqual(deduped.suppressed.map(item=>[item.candidateId,item.duplicateOf,item.reason]),
  [['B','A','same-work-text']]);
 assert.equal(deduplicateRetrievedEvidenceCandidates(candidates,
  'Compare the wording of the two editions of On Liberty.').candidates.length,2,
  'an explicit edition-comparison request keeps both copies for selection');
});

test('public highlights join only adjacent verified spans for the same claim',()=>{
 const source={id:'S1',title:'On Liberty — John Stuart Mill',page:6};
 const first='The first complete sentence explains the principle.';
 const second='The second sentence immediately continues its explanation.';
 const text=first+' '+second+' A distant sentence remains separate.';
 const start2=first.length+1;
 const highlights=selectPublicEvidenceHighlights('Mill explains the principle [S1].',[source],[
  {id:'S1',claimId:'P1-C1',partId:'P1',point:'Mill explains the principle.',quote:first,quoteVerified:true,start:0,end:first.length},
  {id:'S1',claimId:'P1-C1',partId:'P1',point:'Mill explains the principle.',quote:second,quoteVerified:true,start:start2,end:start2+second.length}
 ],3,'Mill principle',{S1:text});
 assert.equal(highlights.length,1);
 assert.equal(highlights[0].quote,first+' '+second);
 assert.deepEqual(highlights[0].quotes.map(item=>item.quote),[first+' '+second]);
});
test('public highlights retain sanitized requirement links on accepted claims',()=>{
 const source={id:'S1',title:'An Enquiry Concerning Human Understanding — David Hume',page:42};
 const point='Custom leads the mind to infer one event from another.';
 const quote='The mind is determined by custom to infer one from the other.';
 const highlights=selectPublicEvidenceHighlights(point+' [S1].',[source],[
  {id:'S1',claimId:'P1-C2',partId:'P1',point,quote,quoteVerified:true,
   requirementIds:['P1-R2','malformed','P1-R2','P2-R1']}
 ],6,'What role does custom play?',{});
 assert.deepEqual(highlights[0].requirement_ids,['P1-R2']);
 assert.deepEqual(highlights[0].quotes[0].requirement_ids,['P1-R2']);
});
test('public highlights prefer the accepted span that matches its requirement',()=>{
 const source={id:'S1',title:'An Enquiry Concerning Human Understanding — David Hume',page:42};
 const point='Hume says causal necessity is an idea formed by custom.';
 const generic='Necessity is an idea formed in the mind, not an observable quality of objects.';
 const mechanism='Repeated experience makes the mind expect one event to follow another.';
 const evidence=[
  {id:'S1',claimId:'P1-C1',partId:'P1',point,quote:generic,quoteVerified:true,
   requirementIds:['P1-R1']},
  {id:'S1',claimId:'P1-C1',partId:'P1',point,quote:mechanism,quoteVerified:true,
   requirementIds:['P1-R1']}
 ];
 const requirementTextById={'P1-R1':'Explain how repeated experience creates an expectation that one event follows another.'};
 const answer=point+' [S1].';
 const highlights=selectPublicEvidenceHighlights(answer,[source],evidence,6,
  'What does Hume say about causal necessity?',{},null,requirementTextById);
 assert.equal(highlights[0].quote,mechanism,
  'the requirement-matched reviewed span wins within the same claim');
 const legacy=selectPublicEvidenceHighlights(answer,[source],evidence,6,
  'What does Hume say about causal necessity?',{});
 assert.equal(legacy[0].quote,generic,
  'without requirement text, the existing question and claim ranking remains in force');
});
test('public highlights keep fallback evidence whose point is the answer claim',()=>{
 const source={id:'S1',title:'An Enquiry Concerning Human Understanding — David Hume',page:42};
 const point='Hume links necessity to custom and regular conjunction.';
 const quote='Necessity is something that exists in the mind, not in objects, through the uniformity observable in nature.';
 const map=pointValue=>[{id:'S1',claimId:'P1-C1',partId:'P1',point:pointValue,quote,quoteVerified:true}];
 const kept=selectPublicEvidenceHighlights(point+' [S1]',[source],map(point),6,
  'How does Hume explain causal necessity?',{});
 assert.equal(kept.length,1,
  'a fallback entry whose point is the answer claim survives the verbatim highlight filter');
 const dropped=selectPublicEvidenceHighlights(point+' [S1]',[source],map('How does Hume explain causal necessity?'),6,
  'How does Hume explain causal necessity?',{});
 assert.equal(dropped.length,0,
  'the pre-fix fallback shape (point = the part question) is filtered out');
});
test('public highlights keep the strongest claim-specific excerpt without unrelated filler',()=>{
 const source={id:'S1',title:'The Odyssey — Homer',page:212};
 const point='Odysseus turns toward the sun, anxious for it to set, yearning to be home.';
 const unrelated='The king’s instructions met with warm applause and home they went to sleep, each in his own house.';
 const relevant='Time and again Odysseus turned his face toward the radiant sun, anxious for it to set, yearning now to be gone and home once more.';
 const text=unrelated+' A long passage separates these lines. '+relevant;
 const relevantStart=text.indexOf(relevant);
 const highlights=selectPublicEvidenceHighlights(point+' [S1].',[source],[
  {id:'S1',claimId:'P1-C1',partId:'P1',point,quote:unrelated,quoteVerified:true,
   start:0,end:unrelated.length},
  {id:'S1',claimId:'P1-C1',partId:'P1',point,quote:relevant,quoteVerified:true,
   start:relevantStart,end:relevantStart+relevant.length}
 ],3,'How does Odysseus’s desire to return home shape his choices?',{S1:text});
 assert.equal(highlights.length,1);
 assert.equal(highlights[0].quote,relevant);
 assert.deepEqual(highlights[0].quotes.map(item=>item.quote),[relevant]);
});
test('public highlights omit returned source pages that the final answer does not cite',()=>{
 const cited={id:'S1',title:'On Liberty — John Stuart Mill',page:6};
 const unused={id:'S2',title:'The Odyssey — Homer',page:212};
 const quote='The principle requires a clear and complete explanation.';
 const highlights=selectPublicEvidenceHighlights('Mill explains the principle [S1].',
  [cited,unused],[
   {id:'S1',claimId:'P1-C1',partId:'P1',point:'Mill explains the principle.',quote,quoteVerified:true},
   {id:'S2',claimId:'P2-C1',partId:'P2',point:'Odysseus returns home.',
    quote:'Odysseus longed for home throughout his journey.',quoteVerified:true}
  ],6,'How does the principle work?',{});
 assert.deepEqual(highlights.map(item=>item.source_id),['S1']);
});
test('public highlights keep only accepted claim links represented in the final answer',()=>{
 const source={id:'S1',title:'On Liberty — John Stuart Mill',page:6};
 const supported='The principle requires each person to have a protected sphere of liberty.';
 const tangent='Utility also matters to Mill’s account of justice and mercy.';
 const highlights=selectPublicEvidenceHighlights(supported+' [S1]',[source],[
  {id:'S1',claimId:'P1-C1',partId:'P1',point:supported,quote:supported,quoteVerified:true},
  {id:'S1',claimId:'P1-C2',partId:'P1',point:tangent,quote:tangent,quoteVerified:true}
 ],6,'How does Mill define liberty?',{});
 assert.deepEqual(highlights.map(item=>item.quote),[supported]);
 assert.deepEqual(highlights[0].quotes.map(item=>item.claim_id),['P1-C1']);
});

test('public highlights link from the shipped-claim set when a citation sits mid-sentence (batch 5 Q1)',()=>{
 const source={id:'S1',title:'On Liberty — John Stuart Mill',page:6};
 const point='Mill explains the principle and its limits for individual liberty.';
 const quote='The principle requires each person to have a protected sphere of liberty.';
 const answer='Mill explains the principle [S1] and its limits for individual liberty.';
 const map=[{id:'S1',claimId:'P1-C1',partId:'P1',point,quote,quoteVerified:true}];
 const dropped=selectPublicEvidenceHighlights(answer,[source],map,6,
  'How does Mill define liberty?',{});
 assert.equal(dropped.length,0,
  'the legacy verbatim point test drops a claim whose citation marker sits mid-sentence');
 const kept=selectPublicEvidenceHighlights(answer,[source],map,6,
  'How does Mill define liberty?',{},new Set(['P1-C1']));
 assert.equal(kept.length,1,'contract linkage keeps the accepted span for a shipped claim');
 assert.equal(kept[0].quote,quote);
 const unshipped=selectPublicEvidenceHighlights(answer,[source],map,6,
  'How does Mill define liberty?',{},new Set(['P1-C9']));
 assert.equal(unshipped.length,0,'a claim outside the shipped set stays unlinked');
});
test('public highlights surface up to six distinct claims from one source (batch 5 Q1)',()=>{
 const source={id:'S1',title:'On Liberty — John Stuart Mill',page:6};
 const claims=[1,2,3,4].map(n=>({id:'S1',claimId:'P1-C'+n,partId:'P1',
  point:'Point number '+n+' about liberty and society.',
  quote:'Passage number '+n+' explains a distinct aspect of liberty and its social limits in detail.',
  quoteVerified:true}));
 const highlights=selectPublicEvidenceHighlights('Mill explains liberty [S1].',[source],claims,6,
  'How does Mill define liberty?',{},new Set(['P1-C1','P1-C2','P1-C3','P1-C4']));
 assert.equal(highlights.length,1);
 assert.equal(highlights[0].quotes.length,4,
  'the old per-source cap of three claims would have dropped the fourth');
});
test('public highlights link every distinct claim that shares one accepted span (batch 6 B6-2)',()=>{
 const source={id:'S1',title:'An Enquiry Concerning Human Understanding — David Hume',page:42};
 const quote='All inferences from experience, therefore, are effects of custom, not of reasoning. Custom, then, is the great guide of human life.';
 const firstPoint='Hume explains that inference from cause to effect comes from custom rather than reasoning.';
 const secondPoint='Hume calls custom the great guide of human life.';
 const answer=firstPoint+' '+secondPoint+' [S1]';
 const highlights=selectPublicEvidenceHighlights(answer,[source],[
  {id:'S1',claimId:'P1-C1',partId:'P1',point:firstPoint,quote,quoteVerified:true},
  {id:'S1',claimId:'P1-C2',partId:'P1',point:secondPoint,quote,quoteVerified:true}
 ],6,'How does Hume explain inference?',{},new Set(['P1-C1','P1-C2']));
 assert.equal(highlights.length,1);
 assert.deepEqual(highlights[0].quotes.map(item=>item.claim_id).sort(),['P1-C1','P1-C2'],
  'the shared span keeps a highlight link for each distinct claim, not just the first');
 assert.ok(highlights[0].quotes.every(item=>item.quote===quote));
});
test('public highlights key shared quotes under every claim without a claim-count cap (batch 9 B9-6)',()=>{
 const source={id:'S1',title:'An Enquiry Concerning Human Understanding — David Hume',page:42};
 const quoteA='All inferences from experience, therefore, are effects of custom, not of reasoning.';
 const quoteB='Custom, then, is the great guide of human life and conduct in every circumstance.';
 // Eight cited claims over two distinct passages — the batch-8
 // single-source shape (13 claims, ~5 quotes, only 6 linked). The old
 // budget counted claims and stopped at six; the box budget counts
 // distinct passages, so every claim links.
 const claims=[];
 for(let n=1;n<=8;n++)claims.push({id:'S1',claimId:'P1-C'+n,partId:'P1',
  point:'Hume point number '+n+' about custom and inference from experience.',
  quote:n<=4?quoteA:quoteB,quoteVerified:true});
 const highlights=selectPublicEvidenceHighlights('Hume explains inference [S1].',[source],claims,6,
  'How does Hume explain inference?',{},
  new Set(claims.map(item=>item.claimId)));
 assert.equal(highlights.length,1);
 assert.equal(highlights[0].quotes.length,8,
  'all eight claims carry a recorded highlight link, not just the first six');
 const boxIndexes=new Set(highlights[0].quotes.map(item=>item.box));
 assert.deepEqual([...boxIndexes].sort(),[0,1],
  'the eight links render as two display boxes, one per distinct passage');
 for(const item of highlights[0].quotes){
  assert.deepEqual([...item.claim_ids].sort(),
   claims.filter(claim=>claim.quote===item.quote).map(claim=>claim.claimId).sort(),
   'each entry names the full claim set sharing its box');
 }
});
test('public highlights merge adjacent fragments recorded under different claims into one box (batch 9 B9-2)',()=>{
 const source={id:'S1',title:'On Liberty — John Stuart Mill',page:6};
 const first='The first complete sentence explains the principle.';
 const second='The second sentence immediately continues its explanation.';
 const text=first+' '+second+' A distant sentence remains separate.';
 const start2=first.length+1;
 const highlights=selectPublicEvidenceHighlights('Mill explains the principle [S1].',[source],[
  {id:'S1',claimId:'P1-C1',partId:'P1',point:'Mill explains the principle.',quote:first,quoteVerified:true,start:0,end:first.length},
  {id:'S1',claimId:'P1-C2',partId:'P1',point:'Mill continues the explanation.',quote:second,quoteVerified:true,start:start2,end:start2+second.length}
 ],3,'Mill principle',{S1:text},new Set(['P1-C1','P1-C2']));
 assert.equal(highlights.length,1);
 assert.equal(highlights[0].quote,first+' '+second,
  'contiguous fragments of one passage join verbatim into a single display quote');
 assert.deepEqual(highlights[0].quotes.map(item=>item.claim_id).sort(),['P1-C1','P1-C2'],
  'both claims keep their recorded link on the merged box');
 assert.ok(highlights[0].quotes.every(item=>item.box===0&&item.quote===first+' '+second),
  'the display box count for the source stays one');
});
test('public highlights prefer the longer covering span for a claim (batch 9 B9-7a)',()=>{
 const source={id:'S1',title:'On Liberty — John Stuart Mill',page:6};
 const longer='The principle requires each person to have a protected sphere of liberty and thought.';
 const shorter='each person to have a protected sphere of liberty';
 const text='An opening sentence sets the scene. '+longer+' A closing sentence follows.';
 const longStart=text.indexOf(longer),shortStart=text.indexOf(shorter);
 const highlights=selectPublicEvidenceHighlights('Mill explains liberty [S1].',[source],[
  {id:'S1',claimId:'P1-C1',partId:'P1',point:'Mill protects a sphere of liberty.',quote:shorter,quoteVerified:true,start:shortStart,end:shortStart+shorter.length},
  {id:'S1',claimId:'P1-C1',partId:'P1',point:'Mill protects a sphere of liberty.',quote:longer,quoteVerified:true,start:longStart,end:longStart+longer.length}
 ],3,'Mill liberty',{S1:text},new Set(['P1-C1']));
 assert.equal(highlights.length,1);
 assert.equal(highlights[0].quote,longer,
  'the covering span, not the fragment it contains, is the claim highlight');
 assert.deepEqual(highlights[0].quotes.map(item=>item.quote),[longer]);
});
test('public highlights strip glued heading lines from a body quote (batch 9 B9-7b)',()=>{
 const source={id:'S1',title:'The Dhammapada — Traditional',page:27};
 const body='There is no suffering for him who has finished his journey and abandoned all grief for the world.';
 const glued='CHAPTER VII.\r\nTHE VENERABLE (ARHAT).\r\n'+body;
 const highlights=selectPublicEvidenceHighlights('The teaching explains suffering [S1].',[source],[
  {id:'S1',claimId:'P1-C1',partId:'P1',point:'The teaching explains the end of suffering.',quote:glued,quoteVerified:true}
 ],3,'suffering journey',{S1:glued},new Set(['P1-C1']));
 assert.equal(highlights.length,1);
 assert.equal(highlights[0].quote,body,
  'heading lines glued onto the quote are stripped to the exact body suffix');
});
test('public highlights leave line-wrapped prose quotes untouched (batch 9 B9-7b)',()=>{
 const source={id:'S1',title:'Early Meditations — A. Writer',page:11};
 const wrapped='the writer argues that faith is trust\nbuilt up slowly through repeated experience of fidelity.';
 const highlights=selectPublicEvidenceHighlights('The writer explains faith [S1].',[source],[
  {id:'S1',claimId:'P1-C1',partId:'P1',point:'The writer explains faith as trust.',quote:wrapped,quoteVerified:true}
 ],3,'faith trust',{S1:wrapped},new Set(['P1-C1']));
 assert.equal(highlights.length,1);
 assert.equal(highlights[0].quote,wrapped.trim(),
  'a lowercase prose first line is not a heading line and nothing is stripped');
});
test('public highlights link claims on sources beyond the old six-page cap at the raised limit (batch 6 B6-2)',()=>{
 const citations=[],map=[],claimIds=[],answerParts=[];
 for(let n=1;n<=8;n++){
  citations.push({id:'S'+n,title:'Work '+n+' — Author '+n,page:n});
  const point='Claim number '+n+' states a distinct verified point about its subject.';
  const quote='Passage number '+n+' gives the exact verified wording for its own distinct claim in full.';
  map.push({id:'S'+n,claimId:'P1-C'+n,partId:'P1',point,quote,quoteVerified:true});
  claimIds.push('P1-C'+n);
  answerParts.push(point+' [S'+n+']');
 }
 const answer=answerParts.join(' ');
 const highlights=selectPublicEvidenceHighlights(answer,citations,map,10,
  'What do the sources say?',{},new Set(claimIds));
 assert.equal(highlights.length,8,'all eight cited pages carry highlights at the raised cap');
 assert.deepEqual(highlights.flatMap(item=>item.quotes.map(quote=>quote.claim_id)).sort(),
  [...claimIds].sort(),'claims on pages seven and eight are linked, not capped away');
 const capped=selectPublicEvidenceHighlights(answer,citations,map,6,
  'What do the sources say?',{},new Set(claimIds));
 assert.equal(capped.length,6,'the limit parameter still bounds the page count when set lower');
});
test('public highlights strip a mixed-case running header to the exact suffix (batch 6 B6-2)',()=>{
 const source={id:'S1',title:'The Salt Meridian — Ines Vidal',page:12};
 const point='Vidal describes a horizon receding as the walker advances.';
 const remainder='the horizon recedes exactly as fast as a walker advances toward it and keeps receding beyond each ridge line.';
 const quote='The Salt Meridian 12 Ines Vidal '+remainder;
 const highlights=selectPublicEvidenceHighlights(point+' [S1].',[source],[
  {id:'S1',claimId:'P1-C1',partId:'P1',point,quote,quoteVerified:true}
 ],6,'What does Vidal describe?',{},new Set(['P1-C1']));
 assert.equal(highlights.length,1);
 assert.equal(highlights[0].quote,remainder,
  'the title, page number, and author name prefix is stripped, leaving the exact suffix');
});
test('public highlights leave an ordinary prose opening untouched (batch 6 B6-2)',()=>{
 const source={id:'S1',title:'Collected Essays — A. Essayist',page:3};
 const point='The essayist dates the pamphlet to the revolutionary year.';
 const quote='In 1848 Marx published a pamphlet arguing that history moves through class struggle and material change over time.';
 const highlights=selectPublicEvidenceHighlights(point+' [S1].',[source],[
  {id:'S1',claimId:'P1-C1',partId:'P1',point,quote,quoteVerified:true}
 ],6,'When was the pamphlet published?',{},new Set(['P1-C1']));
 assert.equal(highlights.length,1);
 assert.equal(highlights[0].quote,quote,'a prose opening is not mistaken for a running header');
});
test('public highlights demote repeated page furniture and drop a claim whose only quote is furniture (batch 7 B7-5a)',()=>{
 const source={id:'S1',title:'The Salt Meridian — Ines Vidal',page:12};
 const heading='Chapter Nine. Relation of the Baptist to Elijah and the Theory of Transmigration Considered.';
 const genuine='I learned that a horizon can recede exactly as fast as a walker advances toward it.';
 const text=[genuine,heading,
  'The cook fed the mules at dusk and mended the torn canvas of the largest tent.',heading,
  'A cold rain began near midnight and the guides argued quietly about the northern route.',heading].join(' ');
 const firstPoint='Vidal describes learning that a horizon recedes as a walker advances.';
 const secondPoint='Vidal describes the chapter heading about the Baptist and Elijah.';
 const answer=firstPoint+' '+secondPoint+' [S1]';
 const highlights=selectPublicEvidenceHighlights(answer,[source],[
  {id:'S1',claimId:'P1-C1',partId:'P1',point:firstPoint,quote:heading,quoteVerified:true},
  {id:'S1',claimId:'P1-C1',partId:'P1',point:firstPoint,quote:genuine,quoteVerified:true},
  {id:'S1',claimId:'P1-C2',partId:'P1',point:secondPoint,quote:heading,quoteVerified:true}
 ],6,'What does Vidal describe?',{S1:text},new Set(['P1-C1','P1-C2']));
 assert.equal(highlights.length,1);
 assert.equal(highlights[0].quote,genuine,
  'the genuine quote outranks the thrice-repeated heading fragment for the claim that has both');
 assert.deepEqual(highlights[0].quotes.map(item=>item.claim_id),['P1-C1'],
  'the claim whose only candidate is furniture loses its highlight entirely');
 const furnitureOnly=selectPublicEvidenceHighlights(answer,[source],[
  {id:'S1',claimId:'P1-C2',partId:'P1',point:secondPoint,quote:heading,quoteVerified:true}
 ],6,'What does Vidal describe?',{S1:text},new Set(['P1-C2']));
 assert.deepEqual(furnitureOnly,[],
  'a source whose only candidate is furniture produces no highlight block at all');
});
test('public highlights strip a lecture header prefix to the exact suffix (batch 7 B7-5a)',()=>{
 const source={id:'S1',title:'Collected Lectures — A. Essayist',page:449};
 const point='The essayist warns about the climate and the limits of growth.';
 const suffix='was first delivered as a warning about the climate and the limits of growth.';
 const quote='449 Spring 2002 / End of Nature '+suffix;
 const highlights=selectPublicEvidenceHighlights(point+' [S1].',[source],[
  {id:'S1',claimId:'P1-C1',partId:'P1',point,quote,quoteVerified:true}
 ],6,'What does the essayist warn about?',{},new Set(['P1-C1']));
 assert.equal(highlights.length,1);
 assert.equal(highlights[0].quote,suffix,
  'the page number, term, year, and title header are stripped, leaving the exact suffix');
});
test('public highlights do not treat a year-and-slash prose opening as a lecture header (batch 7 B7-5a)',()=>{
 const source={id:'S1',title:'Collected Minutes — A. Secretary',page:3};
 const point='The society recorded a long debate in its minutes.';
 const quote='Spring 2002 / minutes of the society record a long debate about the nature of historical change and progress.';
 const highlights=selectPublicEvidenceHighlights(point+' [S1].',[source],[
  {id:'S1',claimId:'P1-C1',partId:'P1',point,quote,quoteVerified:true}
 ],6,'What do the minutes record?',{},new Set(['P1-C1']));
 assert.equal(highlights.length,1);
 assert.equal(highlights[0].quote,quote,
  'a lowercase continuation after the slash is prose, not a title-case header');
});
test('fingerprint packets are served from cache on repeat verification (batch 5 verification diet)',async()=>{
 const content='The real cause of this historical conflict was increased strength and fear among rival cities. The truce disagreements were immediate disputes.';
 const raw=new TextEncoder().encode(content);
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)),x=>x.toString(16).padStart(2,'0')).join('');
 const canonical={schema:'antilogicalism-reader-fingerprints-v2',hashAlgorithm:'SHA-256-utf8-exact',
  libraryVersion:48,bookId:'152',chunk:1,firstPage:33,lastPage:64,
  title:'Canonical History — Thucydides',pdfDriveId:PDF,
  pages:[{page:38,globalPageId:34403,utf8Bytes:raw.byteLength,sha256:hash}]};
 let fetches=0;
 const fetcher=async()=>{fetches++;return Response.json(canonical);};
 const store=new Map();
 const cache={match:async url=>store.get(url),
  put:async(url,response)=>{store.set(url,response);}};
 const first={packetsFetched:0,packetCacheHits:0,pagesVerified:0};
 await verifiedFingerprintSources(question,[{bookId:'152',page:38,text:content}],fetcher,
  {cache,stats:first});
 assert.equal(fetches,1);
 assert.deepEqual(first,{packetsFetched:1,packetCacheHits:0,pagesVerified:1});
 const second={packetsFetched:0,packetCacheHits:0,pagesVerified:0};
 const sources=await verifiedFingerprintSources(question,[{bookId:'152',page:38,text:content}],
  fetcher,{cache,stats:second});
 assert.equal(sources.length,1,'the cached packet still fully verifies the page');
 assert.equal(sources[0].title,'Canonical History — Thucydides');
 assert.equal(fetches,1,'a second verification of the same packet does not re-fetch');
 assert.deepEqual(second,{packetsFetched:0,packetCacheHits:1,pagesVerified:1});
});
test('provisional candidates mirror verification entry validation (batch 5 verification diet)',()=>{
 const text='The public disputes were over a breached agreement, whereas growing power created fear.';
 const candidates=prepareCandidatePages(question,[{bookId:'152',page:38,text,
  candidatePartIds:['P1']}]);
 assert.equal(candidates.length,1);
 assert.equal(candidates[0].title,PILOT_BOOKS['152']);
 assert.equal(candidates[0].text,text);
 assert.deepEqual(candidates[0].candidatePartIds,['P1']);
 assert.throws(()=>prepareCandidatePages(question,
  [{bookId:'152',page:38,text},{bookId:'152',page:38,text}]),/Duplicate source claim/);
 assert.throws(()=>prepareCandidatePages(question,
  [{bookId:'152',page:38,text:'too short'}]),/Unacceptable page text size/);
});
test('provisional candidates preserve validated facet ranks for the selector (batch 34 B34-4)',()=>{
 const text='The public disputes were over a breached agreement, whereas growing power created fear.';
 const candidates=prepareCandidatePages(question,[{bookId:'152',page:38,text,
  candidatePartIds:['P1'],facetRanks:[{facet:0,rank:1},{facet:4,rank:3}]}]);
 assert.deepEqual(candidates[0].facetRanks,[{facet:0,rank:1},{facet:4,rank:3}],
  'facet ranks survive intake so the Worker diversity pass can act on them');
 const unrated=prepareCandidatePages(question,[{bookId:'152',page:38,text}]);
 assert.equal('facetRanks' in unrated[0],false,'absent ranks stay absent');
 assert.throws(()=>prepareCandidatePages(question,
  [{bookId:'152',page:38,text,facetRanks:[{facet:0,rank:0}]}]),/Invalid source facet ranks/);
 assert.throws(()=>prepareCandidatePages(question,
  [{bookId:'152',page:38,text,facetRanks:[{facet:-1,rank:1}]}]),/Invalid source facet ranks/);
 assert.throws(()=>prepareCandidatePages(question,
  [{bookId:'152',page:38,text,facetRanks:'none'}]),/Invalid source facet ranks/);
});
test('search planning runs at temperature 0 and fails at its 30 s deadline (batch 5 L2/L6)',async(t)=>{
 let seen;
 const ai={run:async(_model,input)=>{seen=input;
  return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   resolvedQuestion:'What caused the war between Athens and Sparta?',intent:'explain',sources:[],
   parts:[{question:'What caused the war between Athens and Sparta?'}],scope:'',
   queries:['athens sparta war causes','growing power fear rivals']})}}],usage:{neurons:1}};}};
 await planSearchQueries('What caused the war between Athens and Sparta?','',ai);
 assert.equal(seen.temperature,0);
 t.mock.timers.enable({apis:['setTimeout']});
 try{
  const hanging={run:()=>new Promise(()=>{})};
  const pending=planSearchQueries('What caused the war between Athens and Sparta?','',hanging);
  const rejection=assert.rejects(pending,/Search plan deadline exceeded/);
  t.mock.timers.tick(30000);
  await rejection;
 }finally{t.mock.timers.reset();}
});
test('retrieval gap planning fails at its 20 s deadline instead of hanging (batch 5 L2)',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});
 try{
  const hanging={run:()=>new Promise(()=>{})};
  const pending=planSearchGapQueries('What caused the war?','',
   {weakParts:[],originalQueries:[],candidates:[]},hanging);
  const rejection=assert.rejects(pending,/Retrieval gap plan deadline exceeded/);
  t.mock.timers.tick(20000);
  await rejection;
 }finally{t.mock.timers.reset();}
});

// ---------------------------------------------------------------------------
// Batch 9 (B9-1c): the depth-repair gate gains a per-part underdevelopment
// condition and a recorded trace. Before the fix, the gate measured only
// whole-answer bulk (words / paragraphs / paragraph sentence counts) and
// required supportedPartCount >= 3, so a part that shipped as a single
// sentence inside an adequate-length answer was never developed.
// ---------------------------------------------------------------------------
const depthSources=[
 {id:'S1',bookId:'901',title:'Early Meditations — A. Writer',page:11,
  preview:'In the early work the writer argues that faith is trust built up slowly through repeated experience of fidelity in ordinary life, and he returns to this account whenever he describes how belief steadies conduct.'},
 {id:'S2',bookId:'902',title:'Middle Meditations — A. Writer',page:23,
  preview:'In the middle work the writer argues that faith ventures without assurance, since the outcome cannot be known in advance and the venture is precisely what gives the belief its weight.'},
 {id:'S3',bookId:'903',title:'Late Meditations — A. Writer',page:37,
  preview:'The late work turns to other questions and does not develop an account of faith at any length in these pages.'}
];
const depthReview={coverage:'partial',missing:'The late work part is not established by the excerpts.',
 questionParts:[
  {part:'faith in the early work',status:'supported',evidenceIds:['S1']},
  {part:'faith in the middle work',status:'partial',evidenceIds:['S2']},
  {part:'hope in the late work',status:'unsupported',evidenceIds:[]}],
 evidence:[
  {id:'S1',point:'The early work treats faith as trust grounded in repeated experience of fidelity.',quote:'faith is trust built up slowly',speaker:'A. Writer',qualifier:''},
  {id:'S2',point:'The middle work treats faith as a venture taken without assurance.',quote:'faith ventures without assurance',speaker:'A. Writer',qualifier:''}]};
const thinPartAnswer=[
 'The early work presents faith as trust that is built up slowly through repeated experience of fidelity in ordinary life [S1]. Because the trust rests on what has already been experienced, the writer treats it as steadier than a sudden conviction adopted all at once [S1]. He returns to this account whenever he describes how belief steadies conduct under pressure [S1]. On this view, faith is less a leap than a habit of reliance formed over time [S1].',
 'The late work turns mostly to other questions in these pages and gives faith little direct attention. Its pages are occupied with the ordering of a life, the discipline of attention, and the conduct owed to neighbours. Readers looking there for a developed account will find remarks scattered among other topics rather than a sustained treatment. The middle work stands apart: faith ventures without assurance there [S2].',
 'Taken together, the early account gives the reader the fullest picture of what the writer means by faith in these writings [S1]. It explains both where the trust comes from and why it endures when circumstances press against it [S1]. The other writings add emphasis rather than a rival account of the matter [S1].'
].join('\n\n');
const developedPartAnswer=[
 'The early work presents faith as trust that is built up slowly through repeated experience of fidelity in ordinary life [S1]. Because the trust rests on what has already been experienced, the writer treats it as steadier than a sudden conviction adopted all at once [S1]. He returns to this account whenever he describes how belief steadies conduct under pressure [S1]. On this view, faith is less a leap than a habit of reliance formed over time [S1].',
 'The middle work gives faith a distinct centre of gravity: faith ventures without assurance, since the outcome cannot be known in advance [S2]. The venture is not a defect of the belief but precisely what gives it weight, because nothing compels the step and no evidence removes the risk [S2]. Where the early work builds trust from what has already happened, this account begins exactly where experience runs out [S2]. The late work turns mostly to other questions in these pages and gives faith little direct attention.',
 'Taken together, the early account gives the reader the fullest picture of what the writer means by faith in these writings [S1]. It explains both where the trust comes from and why it endures when circumstances press against it [S1]. The other writings add emphasis rather than a rival account of the matter [S1].'
].join('\n\n');


// The thin part below is its own paragraph (sentence counts [4, 3, 1]),
// so the whole-answer sentence-count measure fails on the thin part's
// own shape: gating the per-part check on full bulk adequacy skipped
// it, and with supportedPartCount at 2 the legacy gate refused too.
// The per-part check now runs on the word-count floor alone (246 words
// here, above the 180 floor), so this live shape must trigger.
const ownParagraphThinPartAnswer=[
 'The early work presents faith as trust that is built up slowly through repeated experience of fidelity in ordinary life, where each kept promise and each return of loyalty adds another layer to the reliance the believer places in what cannot yet be seen [S1]. Because the trust rests on what has already been experienced, the writer treats it as steadier and more durable than a sudden conviction adopted all at once in a single moment of enthusiasm [S1]. He returns to this account whenever he describes how belief steadies conduct under pressure, and he treats the steadiness itself as evidence that the trust has been properly formed [S1]. On this view, faith is less a leap than a habit of reliance formed over time, tested in small things long before it is asked to bear great ones [S1].',
 'Taken together, the early account gives the reader the fullest picture of what the writer means by faith in these writings, because it explains both where the trust comes from and why it endures when circumstances press against it [S1]. The other writings add emphasis rather than a rival account of the matter, and their remarks on faith are best read as variations on this central theme rather than as replacements for it [S1]. Any judgement about the writer’s considered view should therefore begin from the early work’s patient, experience-tested account of trust [S1].',
 'The middle work stands apart from both: faith ventures without assurance there [S2].'
].join('\n\n');
const briefThinPartAnswer=[
 'The early work presents faith as trust built up slowly through repeated experience of fidelity in ordinary life [S1]. The writer treats that trust as steadier than a sudden conviction adopted all at once [S1].',
 'The middle work stands apart: faith ventures without assurance there [S2].',
 'The late work turns mostly to other questions in these pages.'
].join('\n\n');


import {verifySubmittedBookDiversityFinal} from './public-gateway.mjs';
test('batch 35 B35-7: final-list diversity verification repairs a duplicate on the packed list and records it',()=>{
 const text=(n)=>('Passage '+n+' discusses ambition, courts, and the slow machinery of '+
  'provincial government in terms no other page repeats here.').slice(0,140);
 const pool=[{bookId:'A',page:1,text:text(1)},{bookId:'A',page:2,text:text(2)},
  {bookId:'B',page:3,text:text(3)},{bookId:'C',page:4,text:text(4)}];
 const submitted=[{...pool[0],id:'S1',candidateId:'C1'},{...pool[1],id:'S2',candidateId:'C2'},
  {...pool[2],id:'S3',candidateId:'C3'}];
 const plan={parts:[{id:'P1',question:'q'}]};
 const {record,sources}=verifySubmittedBookDiversityFinal(submitted,{pool,plan,question:'q'});
 assert.equal(record.status,'repaired');
 assert.equal(record.swaps.length,1);
 assert.equal(record.swaps[0].removedBookId,'A');
 assert.equal(record.swaps[0].addedBookId,'C');
 assert.deepEqual(sources.map(s=>s.bookId),['A','B','C'],
  'the later duplicate is swapped for the unpacked distinct book');
 assert.deepEqual(sources.map(s=>s.id),['S1','S2','S3'],'source ids renumber cleanly');
});
test('batch 35 B35-7: final-list diversity verification records verified, exhausted, record-only, and not-run outcomes',()=>{
 const text=(n)=>('Passage '+n+' treats of harbours, tariffs, and the customs houses '+
  'of northern ports in its own vocabulary entirely.').slice(0,140);
 const pool=[{bookId:'A',page:1,text:text(1)},{bookId:'B',page:2,text:text(2)}];
 const plan={parts:[{id:'P1',question:'q'}]};
 const clean=verifySubmittedBookDiversityFinal(
  [{...pool[0],id:'S1',candidateId:'C1'},{...pool[1],id:'S2',candidateId:'C2'}],{pool,plan});
 assert.equal(clean.record.status,'verified');
 const stuck=verifySubmittedBookDiversityFinal(
  [{...pool[0],id:'S1',candidateId:'C1'},{...pool[0],page:9,id:'S2',candidateId:'C9',text:text(9)},
   {...pool[1],id:'S3',candidateId:'C2'}],{pool,plan});
 assert.equal(stuck.record.status,'exhausted',
  'a duplicate with every pool book already submitted is recorded, not silent');
 assert.deepEqual(stuck.record.remainingDuplicateBookIds,['A']);
 const snapshot=verifySubmittedBookDiversityFinal(
  [{...pool[0],id:'S1',candidateId:'C1'},{...pool[0],page:9,id:'S2',candidateId:'C9',text:text(9)}],
  {pool,plan,repair:false});
 assert.equal(snapshot.record.status,'not-run');
 assert.equal(snapshot.record.reason,'record-only-path');
 assert.equal(snapshot.sources.length,2,'the record-only path never mutates the list');
 const single=verifySubmittedBookDiversityFinal(
  [{...pool[0],id:'S1',candidateId:'C1'},{...pool[0],page:9,id:'S2',candidateId:'C9',text:text(9)}],
  {pool:[pool[0]],plan});
 assert.deepEqual(single.record,{status:'not-run',reason:'single-book-pool'});
 const one=verifySubmittedBookDiversityFinal([{...pool[0],id:'S1',candidateId:'C1'}],{pool,plan});
 assert.deepEqual(one.record,{status:'not-run',reason:'fewer-than-two-submitted'});
});
test('audit fix W5: final diversity repair never swaps out a sole part link, a direct-classified page, or a facet-top page',()=>{
 const text=(n)=>('Passage '+n+' examines treaties, harvests, and the price of '+
  'grain in river towns with its own examples throughout.').slice(0,140);
 const plan={parts:[{id:'P1',question:'q'},{id:'P2',question:'q2'}]};
 // Sole part link: A2 is P2's only packed page; the swap must take
 // A1 (P1 is also linked by B3) even though A2 is the later duplicate.
 const poolA=[{bookId:'A',page:1,text:text(1)},{bookId:'A',page:2,text:text(2)},
  {bookId:'B',page:3,text:text(3)},{bookId:'C',page:4,text:text(4)}];
 const sole=verifySubmittedBookDiversityFinal([
  {...poolA[0],id:'S1',candidateId:'C1',candidatePartIds:['P1']},
  {...poolA[1],id:'S2',candidateId:'C2',candidatePartIds:['P2']},
  {...poolA[2],id:'S3',candidateId:'C3',candidatePartIds:['P1']}],{pool:poolA,plan,question:'q'});
 assert.equal(sole.record.status,'repaired');
 assert.equal(sole.record.swaps[0].removedCandidateId,'C1',
  'the sole P2 link survives; the expendable duplicate goes');
 assert.deepEqual(sole.sources.map(x=>x.candidateId),['C2','C3','C4']);
 // Direct-classified: A2 carries a direct support entry; A1 goes.
 const direct=verifySubmittedBookDiversityFinal([
  {...poolA[0],id:'S1',candidateId:'C1',candidatePartIds:['P1']},
  {...poolA[1],id:'S2',candidateId:'C2',candidatePartIds:['P1'],
   candidatePartSupport:[{partId:'P1',support:'direct'}]},
  {...poolA[2],id:'S3',candidateId:'C3',candidatePartIds:['P1']}],{pool:poolA,plan,question:'q'});
 assert.equal(direct.record.swaps[0].removedCandidateId,'C1');
 assert(direct.sources.some(x=>x.candidateId==='C2'),'the direct page stays packed');
 // Facet-top: A2 tops facet 0 in the pool; A1 goes instead.
 const poolF=[{bookId:'A',page:1,text:text(1),facetRanks:[{facet:0,rank:2}]},
  {bookId:'A',page:2,text:text(2),facetRanks:[{facet:0,rank:1}]},
  {bookId:'B',page:3,text:text(3)},{bookId:'C',page:4,text:text(4)}];
 const facet=verifySubmittedBookDiversityFinal([
  {...poolF[0],id:'S1',candidateId:'C1'},{...poolF[1],id:'S2',candidateId:'C2'},
  {...poolF[2],id:'S3',candidateId:'C3'}],{pool:poolF,plan,question:'q'});
 assert.equal(facet.record.swaps[0].removedCandidateId,'C1');
 assert(facet.sources.some(x=>x.candidateId==='C2'),'the facet-top page stays packed');
 // All duplicates protected: no swap, recorded as exhausted with the
 // protection reasons named.
 const stuck=verifySubmittedBookDiversityFinal([
  {...poolA[0],id:'S1',candidateId:'C1',candidatePartIds:['P1']},
  {...poolA[1],id:'S2',candidateId:'C2',candidatePartIds:['P2']},
  {...poolA[2],id:'S3',candidateId:'C3'}],{pool:poolA,plan,question:'q'});
 assert.equal(stuck.record.status,'exhausted');
 assert.deepEqual(stuck.record.remainingDuplicateBookIds,['A']);
 assert.equal(stuck.record.protectedSkips[0].bookId,'A');
 assert(stuck.record.protectedSkips[0].reasons.includes('sole-part-link'));
 assert.equal(stuck.sources.length,3,'nothing was swapped out');
});
test('audit fix W5: a swapped-in page keeps its own part links and support, and a linked duplicate yields only to a linked fill book',()=>{
 const text=(n)=>('Passage '+n+' examines treaties, harvests, and the price of '+
  'grain in river towns with its own examples throughout.').slice(0,140);
 const plan={parts:[{id:'P1',question:'q'},{id:'P2',question:'q2'}]};
 const pool=[{bookId:'A',page:1,text:text(1)},{bookId:'A',page:2,text:text(2)},
  {bookId:'B',page:3,text:text(3)},
  {bookId:'C',page:4,text:text(4),candidatePartIds:['P2'],
   candidatePartSupport:[{partId:'P2',support:'context'}]}];
 const {sources}=verifySubmittedBookDiversityFinal([
  {...pool[0],id:'S1',candidateId:'C1'},{...pool[1],id:'S2',candidateId:'C2'},
  {...pool[2],id:'S3',candidateId:'C3'}],{pool,plan,question:'q'});
 const added=sources.find(x=>x.bookId==='C');
 assert.deepEqual(added.candidatePartIds,['P2'],
  'the fill enters with its own part link, not a scope-only guess');
 assert.deepEqual(added.candidatePartSupport,[{partId:'P2',support:'context'}],
  'the fill keeps its selection support signal');
 // Fill precedence: book A is part-linked, so the unlinked book C
 // (earlier in the pool) does not displace it; linked book D does.
 const pool2=[{bookId:'A',page:1,text:text(1)},{bookId:'A',page:2,text:text(2)},
  {bookId:'B',page:3,text:text(3)},{bookId:'C',page:4,text:text(4)},
  {bookId:'D',page:5,text:text(5),candidatePartIds:['P1']}];
 const linked=verifySubmittedBookDiversityFinal([
  {...pool2[0],id:'S1',candidateId:'C1',candidatePartIds:['P1']},
  {...pool2[1],id:'S2',candidateId:'C2',candidatePartIds:['P1']},
  {...pool2[2],id:'S3',candidateId:'C3',candidatePartIds:['P1']}],{pool:pool2,plan,question:'q'});
 assert.equal(linked.record.swaps[0].addedBookId,'D');
});
