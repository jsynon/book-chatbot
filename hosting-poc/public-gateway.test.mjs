import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import gateway,{handleRequest,validRequest,trustedSources,trustedPacketSources,verifiedFingerprintSources,parseReview,sourceExcerpt,turnstileRejection,PILOT_BOOKS,PILOT_BOOK_IDS} from './public-gateway.mjs';

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
      JSON.stringify({coverage:'partial',missing:'Another account would help',evidence:[{id:'S1'}]})
      :'The source explains a truce dispute and concern about growing power [S1].';
    return {choices:[{finish_reason:'stop',message:{content:msg}}],usage:{neurons:6}};
  }},...overrides};
}
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
 const review=parseReview(JSON.stringify({coverage:'partial',missing:clipped,evidence:[{id:'S1'}]}),source);
 assert.equal(review.missing,complete);
 const noSentence=parseReview(JSON.stringify({coverage:'partial',missing:'unfinished clause only',evidence:[{id:'S1'}]}),source);
 assert.equal(noSentence.missing,'');
});

test('evidence review follow-ups are short, specific question strings with no duplicates',()=>{
 const sources=[{id:'S1',preview:'verified'}];
 const review=parseReview(JSON.stringify({coverage:'full',missing:'',evidence:[{id:'S1'}],
   followUpQuestions:[
    'What changes when a variation is inherited?',
    'What changes when a variation is inherited?',
    'How does the text connect a change with its effect?',
    'This prompt is too short?'
   ]}),sources);
 assert.deepEqual(review.followUpQuestions,[
   'What changes when a variation is inherited?',
   'How does the text connect a change with its effect?']);
 const none=parseReview(JSON.stringify({coverage:'none',missing:'',evidence:[],
   followUpQuestions:['What does the evidence say about this?']}),sources);
 assert.deepEqual(none.followUpQuestions,[]);
});

test('source selection is bound to ID from server-fetched content',()=>{
 const sources=[{id:'S1',preview:'verified from trusted book'}];
 const review=parseReview(JSON.stringify({coverage:'full',missing:'',evidence:[{id:'S5'},{id:'S1'}]}),sources);
 assert.deepEqual(review.selected,sources);
});
test('authentic sources flow through two calls and yield the canonical URL',async()=>{
 let runs=0;
 const e=env({AI:{run:async(_model,input)=>{
 runs++;
 return {choices:[{finish_reason:'stop',message:{content:
  input.max_completion_tokens===280 ?
  '{"coverage":"full","missing":"","evidence":[{"id":"S1"}]}' :
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
    const content=input.max_completion_tokens===420?
       JSON.stringify({coverage:'partial',missing:'More history is not in this page',
          evidence:[{id:'S1'}],followUpQuestions:[
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
         JSON.stringify({coverage:'full',missing:'',evidence:[{id:'S1'}]}):fabricated}}],
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
     JSON.stringify({coverage:'full',missing:'',evidence:[{id:'S1'}]}):
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
     JSON.stringify({coverage:'full',missing:'',evidence:[{id:'S1'}]}):
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
     JSON.stringify({coverage:'full',missing:'',evidence:[{id:'S1'}]}):
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
     const content=input.max_completion_tokens===420?
       JSON.stringify({coverage:'full',missing:'',evidence:[{id:'S1'}]}):
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
 assert.deepEqual(data.followUpQuestions,[
   'Which disputes does Thucydides identify as immediate causes?',
   'How did Athens’ growing power affect Spartan fears?']);
 assert.equal(data.verifiedPages,1);
 assert.equal(data.citations[0].page,38);
 assert.equal(data.citations[0].globalPageId,34403);
 assert.equal(pilot.stats().limitCalls,2);
 assert.equal(pilot.stats().verifyCalls,1);
 assert.equal(pilot.stats().calls,2);
});
test('public pilot verifies and submits four source candidates to the bounded answer stage',async()=>{
 const pilot=await pilotScenario({model:async(_model,input)=>{
   if(input.max_completion_tokens===420){
     const submitted=input.messages.at(-1).content;
     assert.match(submitted,/\[S4\].*physical PDF page 41/);
     return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
       coverage:'full',missing:'',evidence:[{id:'S4'}]})}}]};
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
test('public pilot resolves grouped citation IDs and rejects unknown IDs in a group',async()=>{
 const pilot=await pilotScenario({model:async(_model,input)=>{
   if(input.max_completion_tokens===420)
     return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
       coverage:'full',missing:'',evidence:[{id:'S1'},{id:'S3'}]})}}]};
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
   if(input.max_completion_tokens===420)
     return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
       coverage:'full',missing:'',evidence:[{id:'S1'}]})}}]};
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
   input.max_completion_tokens===420?JSON.stringify({coverage:'partial',missing:'',evidence:[{id:'S1'}]}):
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
   if(input.max_completion_tokens===420)return {choices:[{finish_reason:'stop',message:{content:
     '{"coverage":"full","missing":"","evidence":[{"id":"S1"}]}'}}]};
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
   calls++;return {choices:[{finish_reason:'stop',message:{content:input.max_completion_tokens===420?
     JSON.stringify({coverage:'full',missing:'',evidence:[{id:'S1'}]})
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
