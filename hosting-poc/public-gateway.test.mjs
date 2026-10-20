import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import gateway,{handleRequest,validRequest,trustedSources,trustedPacketSources,verifiedFingerprintSources,parseReview,composeVerifiedAnswer,sourceExcerpt,turnstileRejection,inferenceFailureDiagnostics,PILOT_BOOKS,PILOT_BOOK_IDS} from './public-gateway.mjs';

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
   assert(prompt.includes('On the Origin of Species [S1]'));
   assert(prompt.includes('A Brief History of Time [S2]'));
 }
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
 assert.match(inputs[0].messages[0].content,/up to four distinct passages, including passages from the same book/);
 assert.match(inputs[1].messages[0].content,/use the questionParts checklist to make sure/);
 assert.match(inputs[1].messages[0].content,/normally have three to five complete sentences/);
 assert.match(inputs[1].messages[0].content,/exactly three developed, connected paragraphs/);
 assert.match(inputs[1].messages[0].content,/180–260 words overall/);
 assert.match(inputs[1].messages[0].content,/avoid repetition, padding, and adjacent topics/);
 assert.match(inputs[1].messages[0].content,/should explain the point, its reason or distinction/);
 assert.match(inputs[1].messages[0].content,/do not force a one-item-per-paragraph outline/);
 assert.match(inputs[1].messages[0].content,/comparison between theoretical wisdom and practical wisdom/);
 assert.match(inputs[1].messages[0].content,/When distinct selected passages support different points, use up to four/);
 assert.equal(inputs[1].max_completion_tokens,800);
 assert.equal(result.coverage,'full');
 assert.deepEqual(result.citations.map(source=>source.id),['S1','S2']);
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
 assert.equal(data.reviewStatus,'citations_not_claim_verified');
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
    pages:[38,39,40,41].map((page,index)=>({page,globalPageId:34403+index,
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
 assert.equal(data.reviewStatus,'citations_not_claim_verified');
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
test('v1.9.4 absence of useful evidence skips composition',async()=>{
 const fixture=await fingerprintTestFixture();
 let calls=0;
 const result=await fixture.response({aiRun:async()=>{
   calls++;return {choices:[{finish_reason:'stop',
     message:{content:JSON.stringify({coverage:'none',missing:'Unsupported topic',
       evidence:[]})}}],usage:{neurons:4}};
 }});
 assert.equal(result.status,200);
 const data=await result.json();
 assert.equal(data.outcome,'insufficient-evidence');
 assert.equal(data.citations.length,0);
 assert.equal(calls,1);
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
 assert.match(reviewSystem,/parallel edition/);
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
test('public pilot verifies and submits four source candidates to the bounded answer stage',async()=>{
 const pilot=await pilotScenario({model:async(_model,input)=>{
   if(input.max_completion_tokens===520){
     const submitted=input.messages.at(-1).content;
     assert.match(submitted,/\[S4\].*physical PDF page 41/);
     return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
       coverage:'full',missing:'',evidence:[{id:'S4',point:'Relevant supported passage point.'}]})}}]};
   }
   return {choices:[{finish_reason:'stop',message:{content:
     'The verified passage supports this explanation [S4].'}}]};
 }});
 const four=pilot.fixture.body.sources[0];
 const result=await pilot.post({body:{sources:[38,39,40,41].map(page=>({...four,page}))}});
 assert.equal(result.status,200);
 const data=await result.json();
 assert.equal(data.verifiedPages,4);
 assert.equal(data.outcome,'verified-source-draft');
 assert.deepEqual(data.citations.map(source=>({id:source.id,page:source.page,
   globalPageId:source.globalPageId})),[{id:'S4',page:41,globalPageId:34406}]);
 assert.equal(data.citations[0].url,'https://drive.google.com/file/d/'+PDF+'/view?usp=sharing#page=41');
 assert.equal(pilot.stats().verifyCalls,1);
 assert.equal(pilot.stats().calls,2);
});
test('public pilot selects and synthesizes four complementary pages from one book',async()=>{
 const pilot=await pilotScenario({model:async(_model,input)=>{
   if(input.max_completion_tokens===520){
     const submitted=input.messages.at(-1).content;
     for(let i=1;i<=4;i++)assert.match(submitted,new RegExp('\\[S'+i+'\\].*physical PDF page '+(37+i)));
     return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
       coverage:'full',missing:'',evidence:[{id:'S1',point:'Relevant supported passage point.'},{id:'S2',point:'Relevant supported passage point.'},{id:'S3',point:'Relevant supported passage point.'},{id:'S4',point:'Relevant supported passage point.'}]
     })}}]};
   }
   assert.equal(input.max_completion_tokens,800);
   const answer=input.messages.at(-1).content;
   for(let i=1;i<=4;i++)assert(answer.includes('[S'+i+']'));
   return {choices:[{finish_reason:'stop',message:{content:
     'The four passages provide distinct parts of the explanation [S1] [S2] [S3] [S4].'}}]};
 }});
 const source=pilot.fixture.body.sources[0];
 const response=await pilot.post({body:{sources:[38,39,40,41].map(page=>({...source,page}))}});
 assert.equal(response.status,200);
 const result=await response.json();
 assert.equal(result.verifiedPages,4);
 assert.deepEqual(result.citations.map(item=>item.id),['S1','S2','S3','S4']);
 assert.deepEqual(result.citations.map(item=>item.page),[38,39,40,41]);
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
 assert.equal(response.status,502);
 assert.equal((await response.json()).failureCode,'answer-incomplete-cited-claim');
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
   outputTokenLimit:760,sourceCount:1,retried:true
 });
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
  assert.match(input.messages[1].content,/Paragraph sentence counts: \\d+/);
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

test('rejects an incomplete cited answer that remains unfinished after repair',async()=>{
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
 await assert.rejects(composeVerifiedAnswer(
  'What did Kierkegaard have to say about faith?',sources,ai
 ),error=>error?.failureCode==='answer-incomplete-cited-claim');
 assert.equal(call,3);
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
  evidence:[{id:'S1',point:'Kierkegaard challenges Hegel’s account of faith.'},
   {id:'S2',point:'Christianity makes faith the opposite of sin, not virtue.'},
   {id:'S2',point:'The passage connects faith with the possibility of offense.'}]}),sources);
 assert.deepEqual(review.selected.map(source=>source.id),['S1','S2']);
 assert.deepEqual(review.evidenceMap,[
  {id:'S1',point:'Kierkegaard challenges Hegel’s account of faith.'},
  {id:'S2',point:'Christianity makes faith the opposite of sin, not virtue.'},
  {id:'S2',point:'The passage connects faith with the possibility of offense.'}
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
   evidence:[{id:'S1',point:'Christianity makes faith the opposite of sin, not virtue.'}]
  })}}],usage:{neurons:2}};
  return {choices:[{finish_reason:'stop',message:{content:
   'In this passage, faith stands opposite sin rather than virtue [S1].'}}],usage:{neurons:3}};
 }};
 const result=await composeVerifiedAnswer('What does Kierkegaard say about faith?',sources,ai);
 assert.equal(calls.length,2);
 assert.deepEqual(result.evidenceMap,[{id:'S1',point:'Christianity makes faith the opposite of sin, not virtue.'}]);
 assert.match(calls[1].messages[1].content,/Evidence map \(reviewed points\):/);
 assert.match(calls[1].messages[1].content,/Christianity makes faith the opposite of sin, not virtue/);
 assert.match(calls[0].messages[0].content,/Keep each point atomic: one claim per point/);
 assert.match(calls[0].messages[0].content,/make the evidence map include the definition and the passage’s stated reason, operation, or criterion for each requested distinction/);
 assert.match(calls[0].messages[0].content,/For broad questions asking what a person or work says about a topic/);
 assert.match(calls[0].messages[0].content,/Prioritize direct explanation of the concept/);
 assert.match(calls[0].messages[0].content,/remarks that a term needs definition as context/);
 assert.match(calls[0].messages[0].content,/IDs may repeat only when the same passage supports a different point/);
 assert.match(calls[0].messages[0].content,/Treat footnotes, translator or editor notes, and introductions as separate speakers/);
 assert.match(calls[0].messages[0].content,/do not treat a translation note as Kierkegaard’s own distinction/);
 assert.match(calls[1].messages[0].content,/The evidence map is authoritative about this distinction/);
 assert.match(calls[1].messages[0].content,/do not turn a translator’s lexical gloss or capitalization convention into a claim about Kierkegaard’s theory/);
 assert.match(calls[1].messages[0].content,/State the central account once/);
 assert.match(calls[1].messages[0].content,/Do not restate the same claim with expanded synonyms/);
 assert.match(calls[1].messages[0].content,/Omit adjacent topics that do not answer a listed part/);
 assert.match(calls[1].messages[0].content,/Preserve stated relations precisely/);
 assert.match(calls[1].messages[0].content,/do not combine two reviewed points into a single definition/);
 assert.match(calls[1].messages[0].content,/For a single-part question, organize the answer around the evidence map and keep it concise/);
 assert.match(calls[1].messages[0].content,/Avoid a book-by-book/);
});
