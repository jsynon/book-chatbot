import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import gateway,{handleRequest,validRequest,trustedSources,trustedPacketSources,verifiedFingerprintSources,parseReview,composeVerifiedAnswer,removeConflictingSpeakerAttributions,removeUnqualifiedCorrectedClaims,removeUncitedAuthorClaims,removeUnsupportedCrossWorkComparisonClaims,appendUncitedSourceGroupDisclosure,applyExplicitWorkScope,sourceExcerpt,turnstileRejection,inferenceFailureDiagnostics,answerPipelineFailureDiagnostics,workerVersionDiagnostics,PILOT_BOOKS,PILOT_BOOK_IDS,planSearchQueries,stripWebCaptureFooters,selectPublicEvidenceHighlights} from './public-gateway.mjs';
export {gzipSync,gateway,handleRequest,validRequest,trustedSources,trustedPacketSources,verifiedFingerprintSources,parseReview,composeVerifiedAnswer,removeConflictingSpeakerAttributions,removeUnqualifiedCorrectedClaims,removeUncitedAuthorClaims,removeUnsupportedCrossWorkComparisonClaims,appendUncitedSourceGroupDisclosure,applyExplicitWorkScope,sourceExcerpt,turnstileRejection,inferenceFailureDiagnostics,answerPipelineFailureDiagnostics,workerVersionDiagnostics,PILOT_BOOKS,PILOT_BOOK_IDS,planSearchQueries,stripWebCaptureFooters,selectPublicEvidenceHighlights};

export const HOST='https://antilogicalism-companion-public.example.workers.dev';
export const PDF='LegitimatePdfIdentifier0123456789';
export const manifest={version:48,books:{152:{title:'History of the Peloponnesian War — Thucydides',
  drive_url:'https://drive.google.com/file/d/'+PDF+'/view'}},
  page_books:[152,152]};
export const pages={pages:[
  {id:0,page:38,text:'The immediate disputes involved the dissolution of the truce. The real cause was a growth of power and alarm among rival cities. This was considered inevitable.'},
  {id:1,page:39,text:'Corcyra and Epidamnus were mentioned in the immediate controversy, and ambassadors gave conflicting accounts. The disputing sides appealed to allies.'}
]};
export const question='What were the immediate and underlying causes of war?';
export const payload={question,turnstileToken:'one-time-challenge',sources:[{bookId:'152',page:38}]};
export function fetcher(url,init={}){
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
export function request(data=payload,origin='https://jsynon.github.io',headers={}){
 return new Request(HOST+'/api/answer',{method:'POST',
  headers:{Origin:origin,'CF-Connecting-IP':'198.51.100.42',
    'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
}
export function env(overrides={}){
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

export async function fingerprintTestFixture({libraryVersion=48}={}) {
 const text='The public disputes were over a breached agreement, whereas growing power created fear among competing cities. The deeper cause of the war was stated to be anxiety over political change.';
 const bytes=new TextEncoder().encode(text);
 const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),
    b=>b.toString(16).padStart(2,'0')).join('');
 const fingerprint={schema:'antilogicalism-reader-fingerprints-v'+(libraryVersion===48?2:3),
    hashAlgorithm:'SHA-256-utf8-exact',libraryVersion,
    bookId:'152',title:'History of the Peloponnesian War — Thucydides',
    pdfDriveId:PDF,chunk:1,firstPage:33,lastPage:64,
    pages:[38,39,40,41,42,43].map((page,index)=>({page,globalPageId:34403+index,
      utf8Bytes:bytes.byteLength,sha256}))};
 const url=HOST+'/internal/verified-answer',
    secret='valid-private-token-for-the-verified-pilot-456';
 const body={question:'What caused the Peloponnesian War?',
    sources:[{bookId:'152',page:38,text,...(libraryVersion===48?{}:{libraryVersion})}]};
 let fetchCount=0,aiCount=0;
 const fetcher=async requestUrl=>{
    fetchCount++;
    assert.equal(requestUrl,
      'https://jsynon.github.io/antilogicalism-library-data/reader-fingerprints-v'+(libraryVersion===48?2:3)+'/books/152/1.json');
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

export const pilotBaseEnv={
 PUBLIC_ENABLED:'false',PUBLIC_PILOT_ENABLED:'true',
 // Keep legacy-route regression fixtures explicit; v2-by-default behavior is
 // exercised in evidence-answer.test.mjs without this setting.
 READER_PIPELINE:'legacy',
 TURNSTILE_SITE_KEY:'0x4AAAAAA-test-public-pilot',
 TURNSTILE_SECRET:'a-long-private-turnstile-test-secret',
 AI_RATE_LIMITER:{limit:async()=>({success:true})},
 GLOBAL_RATE_LIMITER:{limit:async()=>({success:true})},
};
export async function pilotScenario({config={},model,selector,turnstileValid=true}={}) {
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
 const ai={run:async(...args)=>{
   calls++;
   const input=args[1];
   if(input?.max_completion_tokens===960){
     if(selector)return selector(...args);
     const selection=JSON.parse(input.messages[1].content);
     const candidateIds=selection.candidates.slice(0,6).map(candidate=>candidate.id);
     return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({parts:
       selection.parts.map(part=>({partId:part.partId,evidence:candidateIds.map(candidateId=>({
         candidateId,support:'direct',excerpt:selection.candidates.find(candidate=>candidate.id===candidateId).excerpt.slice(0,200)}))}))})}}],
       usage:{neurons:1,prompt_tokens:10,completion_tokens:10}};
   }
   return (model||fixture.run)(...args);
 }};
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
