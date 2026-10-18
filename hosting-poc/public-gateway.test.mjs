import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import gateway,{handleRequest,validRequest,trustedSources,parseReview,sourceExcerpt} from './public-gateway.mjs';

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
