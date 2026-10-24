import {test} from 'node:test';
import assert from 'node:assert/strict';
import {auditFinalAnswer,normalizePlan} from './reader-contract.mjs';
import {composeEvidenceAnswer,validateClaims} from './evidence-answer.mjs';
import {handleRequest,verifiedFingerprintSources} from './public-gateway.mjs';

const quote='By doing just acts we become just';
const source={id:'S1',bookId:'4',title:'Nicomachean Ethics — Aristotle',page:17,
  text:'Moral virtue comes about as a result of habit. By doing just acts we become just, and by doing temperate acts we become temperate.',
  sha256:'a'.repeat(64),preview:'A short UI preview.'};
const rawPlan={resolvedQuestion:'How does practice form virtue?',intent:'explain',
  sources:[{label:'Nicomachean Ethics',role:'primary',bookIds:['4']}],
  parts:['How does practice form virtue?'],scope:'',queries:['habituation moral virtue']};
const catalog={'4':'Nicomachean Ethics — Aristotle'};
function modelAnswer(claimOverrides={}){
 return {claims:[{id:'C1',partIds:['P1'],kind:'direct',
   text:'Aristotle says repeated just action forms a just character.',
   evidence:[{sourceId:'S1',quote}],...claimOverrides}],gaps:[]};
}
function response(value){return {choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}],
  usage:{neurons:7,prompt_tokens:120,completion_tokens:60}};}

test('grouped citations reject unknown source IDs and bind quotations to their cited source',()=>{
 const sources=[{id:'S1',text:'The first source says something entirely different.'},
  {id:'S2',text:'The second source says “precise quoted wording appears here”.'}];
 assert.equal(auditFinalAnswer('A claim [S1, S99].',sources).ok,false);
 assert.equal(auditFinalAnswer('The source says “precise quoted wording appears here” [S1].',sources).ok,false);
 assert.equal(auditFinalAnswer('The source says “precise quoted wording appears here” [S2].',sources).ok,true);
});

test('plan normalization bounds and canonicalizes requested parts and book scope',()=>{
 const plan=normalizePlan(rawPlan,'fallback question',catalog);
 assert.equal(plan.version,'reader-evidence-v2');
 assert.equal(plan.intent,'explain');
 assert.deepEqual(plan.parts,[{id:'P1',question:'How does practice form virtue?'}]);
 assert.deepEqual(plan.sources[0].bookIds,['4']);
 const scoped=normalizePlan(rawPlan,'question',catalog,'4');
 assert.deepEqual(scoped.sources,[{label:catalog['4'],role:'primary',bookIds:['4']}]);
});

test('claim validation rejects a quote taken from a different source than its citation',()=>{
 const second={...source,id:'S2',text:'A different passage about another subject entirely.'};
 const plan=normalizePlan(rawPlan,'question',catalog);
 const result=validateClaims(modelAnswer({evidence:[{sourceId:'S2',quote}]}),[source,second],plan);
 assert.equal(result.claims.length,0);
 assert.equal(result.rejected[0].reason,'evidence-not-found');
});

test('explicit section scope limits support while preserving the complete page as context',()=>{
 const full={...source,text:'Outside the requested range, Aristotle discusses pleasure at length. '+quote+'.'};
 const scoped={...full,scopeText:'By doing just acts we become just.'};
 const plan=normalizePlan(rawPlan,'question',catalog);
 const outside=validateClaims(modelAnswer({evidence:[{sourceId:'S1',quote:'Outside the requested range, Aristotle discusses pleasure at length.'}]}),[scoped],plan);
 assert.equal(outside.claims.length,0);
 assert.equal(outside.rejected[0].reason,'evidence-outside-requested-scope');
 let composedPages;
 const ai={run:async(_model,input)=>{
  composedPages=JSON.parse(input.messages[1].content).evidence;
  return response(modelAnswer({evidence:[{sourceId:'S1',quote:'By doing just acts we become just.'}]}));
 }};
 return composeEvidenceAnswer('How does practice form virtue?', [scoped], ai, [], {plan:rawPlan,catalog,review:false,trace:true})
  .then(result=>{
   assert.equal(composedPages[0].text,full.text);
   assert.equal(composedPages[0].scopeText,scoped.scopeText);
   assert.equal(result.outcome,'unverified-source-draft');
   assert.equal(result.citations[0].scopeText,undefined);
  });
});

test('claim pipeline makes two bounded calls, preserves full pages, and validates the final rendering',async()=>{
 const observed=[];
 let calls=0;
 const ai={run:async(_model,input)=>{
  calls++;observed.push(input);
  const body=JSON.parse(input.messages[1].content);
  if(input.messages[0].content.includes('Assess each claim')){
   assert.equal(body.claims.length,1);
   return response({decisions:[{claimId:'C1',verdict:'supported',reason:'Directly stated.'}],
    parts:[{partId:'P1',status:'answered',claimIds:['C1'],reason:'Explained.'}]});
  }
  assert.equal(body.evidence[0].text,source.text);
  return response(modelAnswer());
 }};
 const result=await composeEvidenceAnswer('How does practice form virtue?',
  [{...source,text:source.text}],ai,[],{plan:rawPlan,catalog,trace:true});
 assert.equal(calls,2);
 assert.equal(result.usage.calls,2);
 assert.equal(result.usage.neurons,14);
 assert.equal(result.coverage,'full');
 assert.match(result.answer, /\[S1\]/);
 assert.equal(result.citations.length,1);
 assert.equal(result.trace.evidence[0].text,source.text);
 assert.equal(result.trace.final.answer,result.answer);
});

test('rejected claim cannot reappear through a later rewrite or citation repair',async()=>{
 let calls=0;
 const ai={run:async()=>{calls++;return response(modelAnswer({evidence:[{sourceId:'S1',quote:'This exact wording is absent from the verified page.'}]}));}};
 const result=await composeEvidenceAnswer('How does practice form virtue?',
  [source],ai,[],{plan:rawPlan,catalog});
 assert.equal(calls,1);
 assert.equal(result.outcome,'insufficient-evidence');
 assert.equal(result.answer,'The retrieved passages did not support a reliable answer to this question. Try a more specific passage or work.');
 assert.deepEqual(result.citations,[]);
 assert.equal(result.trace,undefined);
});

test('fingerprint verification retains original complete text and digest separately from UI preview',async()=>{
 const text='A complete source page begins here. '+quote+'. The rest of the argument continues beyond the compact preview. '+('Additional context extends this physical page. '.repeat(40));
 const bytes=new TextEncoder().encode(text);
 const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 const metadata={schema:'antilogicalism-reader-fingerprints-v1',hashAlgorithm:'SHA-256-utf8-exact',
  libraryVersion:47,bookId:'4',chunk:0,firstPage:1,lastPage:32,title:catalog['4'],
  pdfDriveId:'LegitimatePdfIdentifier0123456789',
  pages:[{page:17,globalPageId:16,utf8Bytes:bytes.byteLength,sha256}]};
 const verified=await verifiedFingerprintSources('How does practice form virtue?',
  [{bookId:'4',page:17,text}],async()=>Response.json(metadata));
 assert.equal(verified[0].text,text);
 assert.equal(verified[0].sha256,sha256);
 assert.ok(verified[0].preview.length<text.length);
});

test('public experimental route returns audited claim output only when server flag enables it',async()=>{
 const text='A complete source page begins here. '+quote+'. The rest of the argument continues.';
 const bytes=new TextEncoder().encode(text);
 const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 const metadata={schema:'antilogicalism-reader-fingerprints-v1',hashAlgorithm:'SHA-256-utf8-exact',
  libraryVersion:47,bookId:'4',chunk:0,firstPage:1,lastPage:32,title:catalog['4'],
  pdfDriveId:'LegitimatePdfIdentifier0123456789',
  pages:[{page:17,globalPageId:16,utf8Bytes:bytes.byteLength,sha256}]};
 let aiCalls=0;
 const env={PUBLIC_ENABLED:'false',PUBLIC_PILOT_ENABLED:'true',
  TURNSTILE_SITE_KEY:'0x4AAAAAAABC1234567890',TURNSTILE_SECRET:'not-a-real-secret-123456789',
  READER_PIPELINE:'evidence-v2',
  AI_RATE_LIMITER:{limit:async()=>({success:true})},GLOBAL_RATE_LIMITER:{limit:async()=>({success:true})},
  AI:{run:async(_model,input)=>{
   aiCalls++;
   return input.messages[0].content.includes('Assess each claim')?
    response({decisions:[{claimId:'C1',verdict:'supported',reason:'Supported.'}],
      parts:[{partId:'P1',status:'answered',claimIds:['C1'],reason:'Answered.'}]}):response(modelAnswer());
  }}};
 const fetcher=async(url)=>String(url).includes('siteverify')?
  Response.json({success:true,hostname:'jsynon.github.io',action:'companion_ask'}):Response.json(metadata);
 const req=new Request('https://worker.example/api/pilot-answer',{method:'POST',
  headers:{Origin:'https://jsynon.github.io','CF-Connecting-IP':'198.51.100.30','Content-Type':'application/json'},
  body:JSON.stringify({question:'How does practice form virtue?',bookId:'4',turnstileToken:'valid-test-token',
   plan:rawPlan,sources:[{bookId:'4',page:17,text}]})});
 const httpResponse=await handleRequest(req,env,fetcher);
 const body=await httpResponse.json();
 assert.equal(httpResponse.status,200);
 assert.equal(body.pipeline,'reader-evidence-v2');
 assert.equal(body.usage.calls,2,JSON.stringify(body));
 assert.equal(aiCalls,2);
 assert.match(body.answer,/\[S1\]/);
 assert.equal(body.citations[0].title,catalog['4']);
 assert.equal(body.trace,undefined,'ordinary visitors must not receive model prompts or full evidence');
 // The holdout runner must exercise the evidence pipeline even when the
 // public deployment-wide feature flag is unset.
 delete env.READER_PIPELINE;
 env.PILOT_EVALUATION_ENABLED='true';env.PILOT_EVALUATION_TOKEN='evaluation-token-'.padEnd(40,'x');
 const evalReq=new Request('https://worker.example/api/pilot-answer',{method:'POST',
  headers:{Origin:'https://jsynon.github.io','CF-Connecting-IP':'198.51.100.30',
   'Content-Type':'application/json',Authorization:'Bearer '+env.PILOT_EVALUATION_TOKEN},
  body:JSON.stringify({question:'How does practice form virtue?',bookId:'4',turnstileToken:'evaluation-token',
   plan:rawPlan,sources:[{bookId:'4',page:17,text}]})});
 const evalResponse=await handleRequest(evalReq,env,fetcher);
 const evalBody=await evalResponse.json();
 assert.equal(evalResponse.status,200);
 assert.equal(evalBody.pipeline,'reader-evidence-v2');
 assert.equal(evalBody.trace.evidence[0].text,text);
 assert.equal(evalBody.trace.stages.length,2);
});
