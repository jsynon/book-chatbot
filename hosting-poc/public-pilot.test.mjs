import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as support from './public-gateway.test-support.mjs';
const {gzipSync,gateway,handleRequest,validRequest,trustedSources,trustedPacketSources,verifiedFingerprintSources,parseReview,composeVerifiedAnswer,removeConflictingSpeakerAttributions,removeUnqualifiedCorrectedClaims,removeUncitedAuthorClaims,removeUnsupportedCrossWorkComparisonClaims,appendUncitedSourceGroupDisclosure,applyExplicitWorkScope,sourceExcerpt,turnstileRejection,inferenceFailureDiagnostics,answerPipelineFailureDiagnostics,workerVersionDiagnostics,PILOT_BOOKS,PILOT_BOOK_IDS,planSearchQueries,stripWebCaptureFooters,selectPublicEvidenceHighlights,HOST,PDF,manifest,pages,question,payload,fetcher,request,env,fingerprintTestFixture,pilotBaseEnv,pilotScenario}=support;

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
 assert.equal(PILOT_BOOK_IDS.length,644);
 assert.equal(PILOT_BOOKS['653'],'A History of Philosophy, Volume I: Greece and Rome — Frederick Copleston');
 assert.equal(PILOT_BOOKS['654'],'A History of Philosophy, Volume II: Medieval Philosophy — Frederick Copleston');
 assert(PILOT_BOOK_IDS.includes('653'));
 assert(PILOT_BOOK_IDS.includes('654'));
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
 const revision='abcdef0123456789abcdef0123456789abcdef01';
 const metadata={id:'version-0123456789abcdef',tag:revision,timestamp:'2026-10-21T00:00:00.000Z'};
 assert.deepEqual(workerVersionDiagnostics({CF_VERSION_METADATA:metadata}),{
  workerSourceBuild:'public-gateway-verified-candidate-selection-v4',
  workerVersionId:metadata.id,workerVersionTag:metadata.tag,
  workerSourceRevision:revision,
  workerVersionTimestamp:metadata.timestamp
 });
 assert.equal(workerVersionDiagnostics({}).workerVersionId,null);
 assert.equal(workerVersionDiagnostics({CF_VERSION_METADATA:{tag:'quality-pilot'}}).workerSourceRevision,null);
 const plannerPilot=await pilotScenario({config:{CF_VERSION_METADATA:metadata},
  model:async()=>({choices:[{finish_reason:'stop',message:{content:
   '{"queries":["specific first event cause","distinct second event cause"]}'}}]})});
 const planned=await plannerPilot.plan();
 const planData=await planned.json();
 assert.equal(planned.status,200);
 assert.equal(planData.workerVersionId,metadata.id);
 assert.equal(planData.workerVersionTag,metadata.tag);
 assert.equal(planData.workerSourceRevision,revision);
 assert.equal(planData.workerSourceBuild,'public-gateway-verified-candidate-selection-v4');
 const answerPilot=await pilotScenario({config:{CF_VERSION_METADATA:metadata}});
 const answered=await answerPilot.post();
 const answerData=await answered.json();
 assert.equal(answered.status,200);
 assert.equal(answerData.workerVersionId,metadata.id);
 assert.equal(answerData.workerVersionTimestamp,metadata.timestamp);
 assert.equal(answerData.workerSourceRevision,revision);
});
test('public highlights follow inline citation order and include only verified source spans',()=>{
 const citations=['S1','S2','S3','S4','S5','S6'].map(id=>({id,title:id,page:Number(id.slice(1)),url:'https://example.test/'+id}));
 const evidenceMap=citations.map(source=>({id:source.id,quoteVerified:true,
  quote:`This verified passage states a complete readable claim for source ${source.id}.`}));
 const answer='The definition appears first [S4]. Then context [S1], comparison [S2], detail [S3], source five [S5], source six [S6].';
 const highlights=selectPublicEvidenceHighlights(answer,citations,evidenceMap,3);
 assert.deepEqual(highlights.map(item=>item.source_id),['S4','S1','S2']);
 assert.deepEqual(highlights.map(item=>item.quote),[
  'This verified passage states a complete readable claim for source S4.',
  'This verified passage states a complete readable claim for source S1.',
  'This verified passage states a complete readable claim for source S2.']);
 const allCited=selectPublicEvidenceHighlights(answer,citations,evidenceMap);
 assert.deepEqual(allCited.map(item=>item.source_id),['S4','S1','S2','S3','S5','S6']);
 assert.equal(allCited.length,6,'the public default exposes verified anchors up to the existing six-page packet limit');
 assert.deepEqual(selectPublicEvidenceHighlights('Claim [S1].',citations,[
  {id:'S1',quoteVerified:false,quote:'unverified excerpt'}]),[]);
 assert.deepEqual(selectPublicEvidenceHighlights('Claim [S1].',citations,[]),[],
  'a missing reviewed anchor does not fall back to a generic preview');
});
test('public highlights omit short fragments and remove only exact OCR running-header prefixes',()=>{
 const citations=[{id:'S6',title:'The Portable Nietzsche',page:66,url:'https://example.test/portable#page=66'}];
 const short={id:'S6',point:'Faith breaks forth.',quote:'faith can break forth.',quoteVerified:true};
 const header={id:'S6',point:'Nietzsche applies his own standards.',
  quote:'54 THE PORTABLE NIETZSCHE The standards they themselves applied.',quoteVerified:true};
 assert.deepEqual(selectPublicEvidenceHighlights('Faith [S6].',citations,[short]),[]);
 assert.deepEqual(selectPublicEvidenceHighlights('Nietzsche [S6].',citations,[short,header]),[]);
 const useful={id:'S6',point:'Nietzsche applies his own standards.',
  quote:'Nietzsche insists that the standards they themselves applied should govern the judgment.',quoteVerified:true};
 assert.deepEqual(selectPublicEvidenceHighlights('Nietzsche [S6].',citations,[short,header,useful])
  .map(item=>item.quote),[useful.quote]);
});
test('public highlights retain readable line-wrapped verified passages and trim a source-exact running header',()=>{
 const citations=['S2','S5','S4'].map((id,index)=>({id,title:'Verified source '+id,page:index+40,url:'https://example.test/'+id}));
 const faithS2='Faith believes what it does not see; it does not believe that the star is there, for\nthat it sees, but it believes that the star has come into existence. The same holds true of an\nevent.';
 const faithS5='The Christianity of the New Testament is to love God in opposition\n to men, to suffer at the hands of men for one’s faith, for the sake of the\n doctrine to suffer at the hands of men.';
 const sunyata='THE LEVELS OF REALITY   /  55\n\nthe Infinite is nir-guna, without any attribute, and yet is the ground of all attributes.';
 const evidenceMap=[faithS2,faithS5,sunyata].map((quote,index)=>({id:citations[index].id,
  point:'The passage directly explains the concept asked about.',quote,quoteVerified:true}));
 const result=selectPublicEvidenceHighlights('Faith [S2]. Further context [S5]. Sunyata [S4].',citations,evidenceMap);
 assert.deepEqual(result.map(item=>item.source_id),['S2','S5','S4']);
 assert.deepEqual(result.map(item=>item.quote),[
  faithS2,faithS5,'the Infinite is nir-guna, without any attribute, and yet is the ground of all attributes.'
 ]);
 assert.ok(result.every(item=>evidenceMap.some(source=>source.id===item.source_id&&source.quote.includes(item.quote))),
  'every displayed excerpt must remain an exact substring of its reviewer-verified quote');
});
test('public highlights prefer the reviewed span most relevant to its linked claim',()=>{
 const citations=[
  {id:'S3',title:'On the Genealogy of Morals — Friedrich Nietzsche',page:10,url:'https://example.test/nietzsche#page=10'},
  {id:'S2',title:'Last Writings — Kitarō Nishida',page:18,url:'https://example.test/nishida#page=18'}
 ];
 const resentment='The slave revolt in morality begins when resentment itself becomes creative and gives birth to values.';
 const irrelevant='Does the church today still have necessary work to do, or could we dispense with it?';
 const sokuHi='Soku hi exhibits the dynamic tension of affirmation and negation without synthesis.';
 const editorial='Introduction: sunyata is correlated with dependent co-arising in Nagarjuna.';
 const evidenceMap=[
  {id:'S3',point:'Christianity is a destructive, life-hostile principle that emerged from resentment.',quote:irrelevant,quoteVerified:true},
  {id:'S3',point:'Christianity is a destructive, life-hostile principle that emerged from resentment.',quote:resentment,quoteVerified:true},
  {id:'S2',point:'Sunyata is expressed through the paradoxical logic soku hi, sustaining a dynamic tension of affirmation and negation.',quote:editorial,quoteVerified:true},
  {id:'S2',point:'Sunyata is expressed through the paradoxical logic soku hi, sustaining a dynamic tension of affirmation and negation.',quote:sokuHi,quoteVerified:true}
 ];
 const result=selectPublicEvidenceHighlights('Nietzsche on Christianity [S3]. Sunyata [S2].',citations,evidenceMap,2);
 assert.deepEqual(result.map(item=>item.quote),[resentment,sokuHi]);
 assert.deepEqual(result.map(item=>item.quotes.map(quote=>quote.quote)),[
  [resentment,irrelevant],[sokuHi,editorial]
 ]);
 assert.equal(result[0].quotes[0].point,
  'Christianity is a destructive, life-hostile principle that emerged from resentment.');
});

test('repeated claim links do not crowd a distinct verified highlight off a source page',()=>{
 const citation={id:'S5',title:'An Enquiry Concerning Human Understanding — David Hume',
  page:24,url:'https://example.test/hume#page=24'};
 const custom='All inferences from experience, therefore, are effects of custom, not of reasoning. Custom, then, is the great guide of human life.';
 const heat='After the constant conjunction of two objects—heat and flame—we are determined by custom alone to expect the one from the appearance of the other.';
 const inferencePoint='Hume explains that inference from cause to effect comes from custom rather than reasoning.';
 const heatPoint='Hume explains how constant conjunction, such as heat and flame, leads us to expect one event from another.';
 const highlights=selectPublicEvidenceHighlights(
  inferencePoint+' '+heatPoint+' [S5]', [citation],[
   {id:'S5',claimId:'P1-C1',partId:'P1',point:inferencePoint,quote:custom,quoteVerified:true},
   {id:'S5',claimId:'P1-C3',partId:'P1',point:inferencePoint,quote:custom,quoteVerified:true},
   {id:'S5',claimId:'P2-C1',partId:'P2',point:inferencePoint,quote:custom,quoteVerified:true},
   {id:'S5',claimId:'P1-C2',partId:'P1',point:heatPoint,quote:heat,quoteVerified:true}
  ],1);
 const quotes=highlights[0].quotes.map(item=>item.quote);
 assert.equal(quotes.filter(quote=>quote===custom).length,1,
  'the same source sentence keeps only its best-ranked claim association');
 assert.ok(quotes.includes(heat),
  'a distinct approved example is available among the page excerpts');
 assert.equal(highlights[0].quotes.find(item=>item.quote===custom).point,inferencePoint);
});
test('public primary highlight favors a phrase named in the question over nearby context',()=>{
 const question='In Hamlet’s “To be, or not to be” soliloquy, what does he mean when he says that conscience makes cowards of us all?';
 const source={id:'S3',title:'The Complete Works of William Shakespeare — William Shakespeare',
  page:454,url:'https://example.test/shakespeare#page=454'};
 const point='This uncertainty makes individuals choose to endure known suffering rather than flee to the unknown.';
 const nearby='Those ills we have Than fly to others that we know not of.';
 const direct='Thus conscience does make cowards of us all, And thus the native hue of resolution Is sicklied o’er with the pale cast of thought.';
 const highlights=selectPublicEvidenceHighlights(
  point+' [S3].',
  [source],[
   {id:'S3',claimId:'P1-C1',partId:'P1',point,quote:nearby,quoteVerified:true},
   {id:'S3',claimId:'P1-C1',partId:'P1',point,quote:direct,quoteVerified:true}
  ],6,question);
 assert.equal(highlights[0].quote,direct,
  'the exact phrase asked about should lead the source highlights for this question');
 assert.deepEqual(highlights[0].quotes.map(item=>item.quote),[direct,nearby],
  'the neighboring context remains available as an alternate approved excerpt');
});

test('v1.9.5 public pilot verifies hash, Turnstile and rate limits before bounded AI',async()=>{
 const pilot=await pilotScenario();
 const result=await pilot.post();
 assert.equal(result.status,200);
 const data=await result.json();
 assert.equal(data.outcome,'verified-source-draft');
 assert.equal(data.pilot,true);
 assert.deepEqual(data.evidenceHighlights,[],
  'a citation without a reviewer-verified quote anchor is not replaced by its generic preview');
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
test('public highlight selection uses the reader question to rank approved spans',async()=>{
 const context='The public disputes were over a breached agreement, whereas growing power created fear among competing cities.';
 const direct='The deeper cause of the war was stated to be anxiety over political change.';
 const pilot=await pilotScenario({model:async(_model,input)=>{
   if(input.max_completion_tokens===520)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
     coverage:'full',missing:'',evidence:[
       {id:'S1',point:'This passage is relevant context for the answer.',quote:context},
       {id:'S1',point:'This passage is relevant context for the answer.',quote:direct}
     ]
   })}}]};
   return {choices:[{finish_reason:'stop',message:{content:
     'The deeper cause was anxiety over political change [S1].'}}]};
 }});
 const response=await pilot.post({body:{question:'What was the deeper cause of the war?'}});
 assert.equal(response.status,200);
 const data=await response.json();
 assert.equal(data.evidenceHighlights[0].quote,direct,
  'the request question must reach ranking without replacing exact reviewed spans');
 assert.deepEqual(data.evidenceHighlights[0].quotes.map(item=>item.quote),[direct,context]);
 assert.equal(pilot.stats().calls,2,'question-aware ranking adds no model call');
});
test('public highlights show multiple distinct verified passages from one cited page',async()=>{
 const first='The public disputes were over a breached agreement, whereas growing power created fear among competing cities.';
 const second='The deeper cause of the war was stated to be anxiety over political change.';
 const pilot=await pilotScenario({model:async(_model,input)=>{
   if(input.max_completion_tokens===520)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
     coverage:'full',missing:'',evidence:[
       {id:'S1',point:'The public disputes involved an agreement and fear.',quote:first},
       {id:'S1',point:'The deeper cause was anxiety over political change.',quote:second}
     ]
   })}}]};
   return {choices:[{finish_reason:'stop',message:{content:
     'The page distinguishes immediate disputes from the deeper cause [S1].'}}]};
 }});
 const response=await pilot.post();
 assert.equal(response.status,200);
 const data=await response.json();
 assert.equal(data.citations.length,1);
 assert.equal(data.evidenceMap.filter(item=>item.quoteVerified).length,2);
 assert.equal(data.evidenceHighlights.length,1,
  'the public six-item ceiling applies to distinct source pages');
 assert.deepEqual(data.evidenceHighlights[0].quotes.map(item=>item.quote),[second,first],
  'the most claim-relevant reviewed passage leads a page group while both approved spans survive');
 assert.deepEqual(data.evidenceHighlights[0].quotes.map(item=>item.point),[
  'The deeper cause was anxiety over political change.',
  'The public disputes involved an agreement and fear.']);
 assert.equal(data.evidenceHighlights.every(item=>item.source_id==='S1'&&item.page===38),true);
 assert.equal(pilot.stats().calls,2);
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
   assert.equal(input.max_completion_tokens,1600);
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
 assert.deepEqual(data.evidenceHighlights,[],
  'point-only review evidence does not become a visible quote highlight');

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
 const model=async(_model,input)=>{
   const system=input.messages?.[0]?.content||'';
   let content;
   if(system.startsWith('Review the complete answer parts and claims')){
     const payload=JSON.parse(input.messages[1].content);
     content=JSON.stringify({parts:payload.parts.map(part=>({partId:part.partId,status:'answered',
       answerStatus:'answered',
       directAnswerClaimIds:payload.claims.filter(claim=>claim.partId===part.partId)
        .slice(0,1).map(claim=>claim.claimId),
       retainedContextClaimIds:(part.contextClaims||[]).map(claim=>claim.claimId)})),
       claims:payload.claims.map(answer=>({claimId:answer.claimId,status:'answered',
        spanIds:answer.sourceIds.map(sourceId=>sourceId+'-Q1')}))});
   }else if(system.startsWith('Answer the reader\'s exact question')){
     const payload=JSON.parse(input.messages[1].content);
     content=payload.parts.map(part=>'PART '+part.partId+'\nThe passage identifies the deeper cause as fear of growing power. [S1]').join('\n\n');
   }else content='{"queries":["specific war causes and diplomatic disputes","underlying power growth and rival fear"]}';
   return {choices:[{finish_reason:'stop',message:{content}}],usage:{neurons:1}};
 };
 const pilot=await pilotScenario({config:{PILOT_EVALUATION_ENABLED:'true',
   PILOT_EVALUATION_TOKEN:token},model});
 const headers={Authorization:'Bearer '+token};
 const planned=await pilot.plan({headers});
 assert.equal(planned.status,200);
 const answered=await pilot.post({headers});
 assert.equal(answered.status,200);
 const answerData=await answered.clone().json();
 assert.equal(answerData.pipeline,'reader-evidence-v2');
 assert.equal(answerData.coverage,'full');
 assert.ok(answerData.evidenceMap[0].quote.length>12);
 assert.ok(pilot.fixture.body.sources[0].text.includes(answerData.evidenceMap[0].quote));
 assert.equal(answerData.evidenceHighlights[0].quote,answerData.evidenceMap[0].quote,
  'evidence-v2 highlights must use the exact reviewer-approved span from evidenceMap');
 assert.equal(pilot.stats().verifyCalls,0);
 assert(pilot.stats().calls>=2);

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
test('evidence-v2 public route returns six reviewed highlights for six cited pages',async()=>{
 const token='six-reviewed-highlight-test-token';
 const model=async(_model,input)=>{
  const system=input.messages?.[0]?.content||'';
  const payload=JSON.parse(input.messages[1].content);
  if(system.startsWith('Review the complete answer parts and claims')){
   return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
    parts:payload.parts.map(part=>({partId:part.partId,status:'answered'})),
    claims:payload.claims.map(claim=>({claimId:claim.claimId,status:'answered',
     spanIds:claim.sourceIds.map(sourceId=>payload.parts.find(part=>part.partId===claim.partId)
      .evidence.find(item=>item.id===sourceId).spans[0].spanId)}))
   })}}]};
  }
  const sourceIds=payload.evidence.map(source=>source.id);
  return {choices:[{finish_reason:'stop',message:{content:
   'PART P1\nThe verified pages support this explanation across all six cited passages ['+sourceIds.join(', ')+'].'
  }}]};
 };
 const pilot=await pilotScenario({config:{PILOT_EVALUATION_ENABLED:'true',
  PILOT_EVALUATION_TOKEN:token,READER_PIPELINE:'evidence-v2'},model});
 const page38=pilot.fixture.body.sources[0];
 const response=await pilot.post({headers:{Authorization:'Bearer '+token},body:{
  question:'What do these passages establish?',answerVariant:'with-review',
  sources:[38,39,40,41,42,43].map(page=>({...page38,page})),
  plan:{intent:'explain',sources:[],parts:[{question:'What do these passages establish?'}]}
 }});
 assert.equal(response.status,200);
 const result=await response.json();
 assert.equal(result.citations.length,6);
 assert.equal(result.evidenceHighlights.length,6);
 assert.deepEqual(result.evidenceHighlights.map(item=>item.source_id),
  ['S1','S2','S3','S4','S5','S6']);
 assert.ok(result.evidenceHighlights.every(item=>item.quoteLocated===undefined));
 assert.equal(pilot.stats().calls,3,'Worker evidence selection precedes the existing compose/review pair');
});
test('a valid empty evidence selection can review a useful single-part answer without a heading',async()=>{
 const token='selector-empty-evidence-test-token';
 const pilot=await pilotScenario({config:{PILOT_EVALUATION_ENABLED:'true',
   PILOT_EVALUATION_TOKEN:token,READER_PIPELINE:'evidence-v2'},
  selector:async(_model,input)=>{
   const selection=JSON.parse(input.messages[1].content);
   return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({parts:
    selection.parts.map(part=>({partId:part.partId,evidence:[]}))})}}],
    usage:{neurons:2,prompt_tokens:14,completion_tokens:8}};
  },
  model:async(_model,input)=>{
   const payload=JSON.parse(input.messages[1].content);
   if(Array.isArray(payload.claims))return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
    claims:payload.claims.map(claim=>({claimId:claim.claimId,status:'answered',sources:[]})),
    parts:payload.parts.map(part=>({partId:part.partId,status:'answered',answerStatus:'answered',
     directAnswerClaimIds:(part.contextClaims||[]).slice(0,1).map(claim=>claim.claimId),
     retainedContextClaimIds:(part.contextClaims||[]).map(claim=>claim.claimId)}))})}}]};
   return {choices:[{finish_reason:'stop',message:{content:
    'There is no established evidence that we are living in a computer simulation. The idea remains a philosophical possibility, but imagining it or reasoning about simulated observers does not show that it is true.\n\nA serious version of the hypothesis would need observable predictions that distinguish a simulated universe from an ordinary physical one. At present, no confirmed observation settles that question, so the careful answer is that we do not know. Related ideas about virtual or socially shaped experience can offer context, but they do not establish a literal simulation.'}}]};
  }
 });
 const response=await pilot.post({headers:{Authorization:'Bearer '+token},body:{question:'Are we living in a simulation?'}});
 const result=await response.json();
 assert.equal(response.status,200);
 assert.equal(result.outcome,'general-context-answer');
 assert.equal(result.coverage,'full');
 assert.match(result.answer,/no established evidence/);
 assert.match(result.answer,/Related ideas.*do not establish a literal simulation/);
 assert.deepEqual(result.citations,[]);
 assert.deepEqual(result.sourceSelection.pages,[]);
 assert.equal(result.sourceSelection.status,'no-relevant-evidence');
 assert.equal(result.sourceSelectionStatus,'no-relevant-evidence');
 assert.equal(result.sourceSelection.usage.neurons,2);
 assert.match(result.notice,/no library citations/i);
 assert.equal(result.reviewStatus,'general-context-review');
 assert.equal(result.trace.recovery.code,'missing-part-heading',
  'a one-part answer can be assigned and reviewed when its redundant heading is omitted');
 assert.equal(result.usage.calls,3,'the selector, composer, and reviewer calls are retained in usage');
 assert.equal(pilot.stats().calls,3,'an empty evidence selection still reaches composition and review');
 assert.equal(result.trace.stages[0].status,'no-relevant-evidence');
 assert.deepEqual(result.trace.stages[0].decision.selectedCandidateIds,[]);
});
test('selector provider errors retain a safe reason while the bounded fallback remains reviewable',async()=>{
 const token='selector-fallback-error-test-token';
 const pilot=await pilotScenario({config:{PILOT_EVALUATION_ENABLED:'true',
   PILOT_EVALUATION_TOKEN:token,READER_PIPELINE:'evidence-v2'},
  selector:async()=>{throw Object.assign(new Error('PRIVATE provider body'),{status:503});}
 });
 const response=await pilot.post({headers:{Authorization:'Bearer '+token}});
 const result=await response.json();
 assert.equal(response.status,200);
 assert.equal(result.sourceSelection.status,'deterministic-fallback');
 assert.equal(result.trace.stages[0].failureCode,'selector-provider-error');
 assert.ok(result.sourceSelection.pages.length>0);
 assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
});
test('repeated selector candidate IDs are normalized without retrieval-order fallback',async()=>{
 const token='selector-duplicate-evidence-test-token';
 const pilot=await pilotScenario({config:{PILOT_EVALUATION_ENABLED:'true',
   PILOT_EVALUATION_TOKEN:token,READER_PIPELINE:'evidence-v2'},
  selector:async(_model,input)=>{
   const payload=JSON.parse(input.messages[1].content);
   const candidate=payload.candidates[0];
   const cue={candidateId:candidate.id,support:'direct',excerpt:candidate.excerpt.slice(0,120)};
   return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({parts:
    payload.parts.map(part=>({partId:part.partId,evidence:[cue,{...cue}]}))})}}]};
  }
 });
 const response=await pilot.post({headers:{Authorization:'Bearer '+token}});
 const result=await response.json();
 assert.equal(response.status,200);
 assert.equal(result.trace.stages[0].status,'selected');
 assert.equal(result.sourceSelection.status,'selected');
 assert.equal(result.trace.stages[0].decision.duplicateEvidenceEntriesRemoved,1);
 assert.notEqual(result.sourceSelection.status,'deterministic-fallback');
});
test('selector fallback trace retains only an approved invalid-response subtype',async()=>{
 const token='selector-invalid-subtype-test-token';
 const pilot=await pilotScenario({config:{PILOT_EVALUATION_ENABLED:'true',
   PILOT_EVALUATION_TOKEN:token,READER_PIPELINE:'evidence-v2'},
  selector:async()=>({choices:[{finish_reason:'stop',message:{content:
   '{"parts":[{"partId":"P1","evidence":[{"candidateId":"C99","support":"direct","excerpt":"a verbatim source excerpt long enough"}]}]}'}}]})
 });
 const response=await pilot.post({headers:{Authorization:'Bearer '+token}});
 const result=await response.json();
 assert.equal(response.status,200);
 assert.equal(result.trace.stages[0].failureCode,'selector-invalid-response');
 assert.equal(result.trace.stages[0].failureReason,'unknown-candidate-id');
 assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
});
test('selector trace exposes the specific coverage-shape failure without model text',async()=>{
 const token='selector-coverage-shape-test-token';
 const pilot=await pilotScenario({config:{PILOT_EVALUATION_ENABLED:'true',
   PILOT_EVALUATION_TOKEN:token,READER_PIPELINE:'evidence-v2'},
  selector:async()=>({choices:[{finish_reason:'stop',message:{content:
   '{"parts":[{"partId":"P1","evidence":[{"candidateId":"C1","support":"supported|partial|none","excerpt":"a verbatim source excerpt long enough"}]}],"privatePayload":"PRIVATE SELECTOR TEXT"}'}}]})
 });
 const response=await pilot.post({headers:{Authorization:'Bearer '+token}});
 const result=await response.json();
 assert.equal(response.status,200);
 assert.equal(result.trace.stages[0].failureCode,'selector-invalid-response');
 assert.equal(result.trace.stages[0].failureReason,'invalid-evidence-support');
 assert.equal(JSON.stringify(result).includes('PRIVATE SELECTOR TEXT'),false);
});
test('planner and answer have separate visitor budgets and share the global budget',async()=>{
 const pilot=await pilotScenario({model:async(_model,input)=>{
   if(input.max_completion_tokens===720)return {choices:[{finish_reason:'stop',message:{content:
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
test('Worker distinguishes provider allocation, usage and capacity errors without claiming an app daily cap',async()=>{
 const quota=await pilotScenario({model:async()=>{throw {name:'Error',message:
  'You have used up your daily free allocation of 10,000 Neurons.'};}});
 const quotaResponse=await quota.post();
 assert.equal(quotaResponse.status,502);
 const quotaData=await quotaResponse.json();
 assert.equal(quotaData.failureCode,'ai-daily-free-allocation');
 assert.equal(quotaData.failureProviderClass,'daily-free-allocation');
 assert.equal(quotaData.failureProviderCode,undefined);
 const exactQuota=await pilotScenario({model:async()=>{throw {name:'AIError',status:429,
  code:3036,message:'daily free allocation reached'};}});
 const exactQuotaData=await (await exactQuota.post()).json();
 assert.equal(exactQuotaData.failureCode,'ai-daily-free-allocation');
 assert.equal(exactQuotaData.failureProviderCode,'3036');
 const usage=await pilotScenario({model:async()=>{throw {name:'Error',message:'provider quota exceeded'};}});
 const usageData=await (await usage.post()).json();
 assert.equal(usageData.failureCode,'ai-provider-usage-limit');
 assert.equal(usageData.failureProviderClass,'provider-usage-limit');
 const credit=await pilotScenario({model:async()=>{throw {name:'Error',message:'credits exhausted'};}});
 const creditData=await (await credit.post()).json();
 assert.equal(creditData.failureCode,'ai-credit-limit');
 assert.equal(creditData.failureProviderClass,'credit-limit');
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
 const fetched=await original('https://jsynon.github.io/antilogicalism-library-data/reader-fingerprints-v2/books/152/1.json');
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
     assert.equal(input.max_completion_tokens,1200);
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
   assert.equal(input.max_completion_tokens,1200);
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
test('malformed question-part review falls back to the existing composer with a provisional notice',async()=>{
 const question='What account do the priests give, and how do they say they learned it?';
 const sources=[{id:'S1',bookId:'149',title:'The Histories — Herodotus',page:145,
   preview:'The Egyptian priests related the account, saying that Menelaus had himself informed them.'}];
 const invalidParts=Array.from({length:5},(_,i)=>({
   part:'Requested component '+(i+1),status:'supported',evidenceIds:['S1']
 }));
 const calls=[];
 const ai={run:async(_model,input)=>{
   calls.push(input);
   if(calls.length<=2)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
     coverage:'full',missing:'',evidence:[{id:'S1',point:'The priests say Menelaus supplied the account.',
       quote:'Menelaus had himself informed them.'}],questionParts:invalidParts,
     followUpQuestions:[]
   })}}],usage:{neurons:2}};
   assert.equal(input.max_completion_tokens,1600);
   assert.match(input.messages[0].content,/reported-source intermediaries/);
   return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
     answer:'Herodotus says the Egyptian priests told him that Menelaus had informed them [S1].',
     partChecks:[
       {part:'What account do the priests give?',status:'partial',evidenceIds:['S1']},
       {part:'How do they say they learned it?',status:'supported',evidenceIds:['S1']}
     ],
     evidence:[{id:'S1',point:'The priests identify Menelaus as their source for the account.',
       quote:'Menelaus had himself informed them.',speaker:'the Egyptian priests',
       qualifier:'they declared that'}]
   })}}],usage:{neurons:4}};
 }};
 const result=await composeVerifiedAnswer(question,sources,ai);
 assert.equal(calls.length,3,'the existing answer-composition call should proceed after review retry failure');
 assert.equal(result.outcome,'verified-source-draft');
 assert.match(result.answer,/priests told him that Menelaus had informed them/);
 assert.equal(result.reviewStatus,'claim_support_not_independently_verified');
 assert.match(result.notice,/invalid question-part data after retry; treat this synthesis as provisional/);
 assert.equal(result.citations.length,1);
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
   assert.deepEqual(calls,[520,1200]);
   assert.match(prompts[1],/For broad questions about what a person or work says/);
 }finally{console.error=original;}
 const failure=logged.find(entry=>entry[0]==='Reader pilot answer failed')?.[1];
 assert.deepEqual(failure,{
   failureCode:'evidence-review-truncated',stage:'evidence-review',
   finishReason:'length',retryFinishReason:'length',
   outputTokenLimit:1200,sourceCount:1,retried:true,reviewFailureReason:'unknown'
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
   if(calls.length===2){
    assert.match(input.messages[0].content,/Preserve meaningful qualifications, conditions, uncertainty/);
    return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
     answer:'Darwin says natural selection would occur without any struggle for existence [S1].',
     partChecks:[{part:'explain when struggle and natural selection occur',status:'partial',evidenceIds:['S1']}]
    })}}]};
   }
   assert.match(input.messages[0].content,/Preserve conditions, uncertainty, and requested textual scope/);
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
  assert.match(input.messages[0].content,/Repair only the requested parts/);
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
   assert.match(input.messages[0].content,/When asked for a named author’s own view, prefer that author’s relevant supplied work/);
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

test('a partial comparison with both sides supported uses the existing comparison expansion',async()=>{
 const question='How does Aristotle describe political science, how does Hobbes describe common power, and how do their accounts differ?';
 const sources=[
  {id:'S1',bookId:'7',title:'Nicomachean Ethics — Aristotle',page:2,
   preview:'Political science aims at the highest of all goods achievable by action, which is generally identified as happiness.'},
  {id:'S2',bookId:'163',title:'Leviathan — Thomas Hobbes',page:106,
   preview:'The sovereign acts on behalf of the subjects in matters concerning common peace and safety.'}
 ];
 const parts=[
  {part:'Aristotle’s account of political science',status:'supported',evidenceIds:['S1']},
  {part:'Hobbes’s account of common power',status:'supported',evidenceIds:['S2']},
  {part:'How their accounts differ',status:'partial',evidenceIds:['S1','S2']}
 ];
 const calls=[];
 const draft='Aristotle describes political science as pursuing the highest good achievable by action, generally understood as happiness [S1]. This gives political inquiry a stated end.\n\nHobbes describes the sovereign as acting for common peace and safety [S2]. This identifies what public power is to secure.\n\nThe accounts differ in emphasis.';
 const expanded='Aristotle describes political science as aiming at the highest good achievable by action, generally understood as happiness [S1]. The passage presents political inquiry through the end it should serve. That purpose gives the account its central criterion for judging civic institutions and action. It grounds the account in a purpose rather than in a specific enforcement mechanism.\n\nHobbes describes the sovereign as acting for common peace and safety [S2]. His passage focuses on the authority responsible for securing those conditions. Read together, the excerpts contrast an account framed by its public end with one framed by the power that maintains peace and safety [S1, S2]. This is a reader-level comparison of the supplied passages, whose claims remain distinct and are not presented as a direct exchange between the authors.';
 const ai={run:async(_model,input)=>{
  calls.push(input);
  if(calls.length===1)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   coverage:'partial',missing:'The comparison is only partly explained.',questionParts:parts,
   evidence:[
    {id:'S1',point:'Aristotle identifies happiness as the highest good pursued by political science.',quote:'the highest of all goods achievable by action',speaker:'Aristotle'},
    {id:'S2',point:'Hobbes assigns the sovereign responsibility for common peace and safety.',quote:'common peace and safety',speaker:'Thomas Hobbes'}
   ]
  })}}],usage:{neurons:1}};
  if(calls.length===2)return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
   answer:draft,partChecks:parts
  })}}],usage:{neurons:1}};
  assert.match(input.messages[0].content,/partial but both source-specific positions are supported/);
  assert.match(input.messages[0].content,/concrete reader-level contrast/);
  return {choices:[{finish_reason:'stop',message:{content:expanded}}],usage:{neurons:1}};
 }};
 const result=await composeVerifiedAnswer(question,sources,ai);
 assert.equal(calls.length,3);
 assert.equal(result.coverage,'full');
 assert.equal(result.questionParts[2].status,'supported');
 assert.match(result.answer,/contrast an account framed by its public end with one framed by the power/);
 assert.deepEqual(result.citations.map(source=>source.id),['S1','S2']);
});

test('discloses a retrieved comparison source omitted from final citations',()=>{
 const groups=[
  {label:'Hume’s Enquiry',bookIds:new Set(['35'])},
  {label:'Kant’s Critique',bookIds:new Set(['40'])}
 ];
 const sources=[
  {id:'S1',bookId:'35',title:'An Enquiry Concerning Human Understanding — David Hume'},
  {id:'S2',bookId:'40',title:'Critique of Pure Reason — Immanuel Kant'}
 ];
 const answer='Kant reports that Hume rejects a priori causal knowledge [S2].';
 const result=appendUncitedSourceGroupDisclosure(answer,groups,sources);
 assert.equal(result.missingGroups.length,1);
 assert.equal(result.missingGroups[0].label,'Hume’s Enquiry');
 assert.match(result.answer,/No passage from Hume’s Enquiry appears in the answer’s citations/);
 assert.match(result.answer,/not directly established/);
 const complete=appendUncitedSourceGroupDisclosure(
  answer+' Hume’s Enquiry treats causal inference as grounded in experience [S1].',groups,sources);
 assert.deepEqual(complete.missingGroups,[]);
 assert.equal(complete.answer,answer+' Hume’s Enquiry treats causal inference as grounded in experience [S1].');
});

test('keeps both requested works when one is named by a shortened author reference',()=>{
 const question='How do Hume’s Enquiry and Kant’s Critique of Pure Reason differ over causal necessity?';
 const sources=[
  {id:'S1',bookId:'35',title:'An Enquiry Concerning Human Understanding — David Hume'},
  {id:'S2',bookId:'40',title:'Critique of Pure Reason — Immanuel Kant'},
  {id:'S3',bookId:'245',title:'The Social Contract — Jean-Jacques Rousseau'}
 ];
 const scoped=applyExplicitWorkScope(question,sources);
 assert.deepEqual(scoped.map(source=>source.id),['S1','S2']);
});

test('an unlisted play title does not create a curated source alias',()=>{
 const question='In Hamlet’s “To be, or not to be” soliloquy, what does he mean by conscience?';
 const sources=[
  {id:'S1',bookId:'212',title:PILOT_BOOKS['212']},
  {id:'S2',bookId:'230',title:'The Courage to Be — Paul Tillich'}
 ];
 const scoped=applyExplicitWorkScope(question,sources);
 assert.deepEqual(scoped.map(source=>source.id),['S1','S2']);
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
 assert.match(inputs[1].messages[0].content,/do not complete cut-off text/);
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
 assert.match(source,/A report of another thinker’s view supports only the reported view/);
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
 assert.match(calls[0].messages[0].content,/one exact, contiguous quote of at most 220 characters/);
 assert.match(calls[0].messages[0].content,/Never join distant text with ellipses/);
 assert.match(calls[0].messages[0].content,/attribute text from another source/);
 assert.deepEqual(result.evidenceMap,[{id:'S1',point:'Christianity makes faith the opposite of sin, not virtue.',quoteVerified:false}]);
 assert.match(calls[1].messages[1].content,/Evidence map \(reviewed points\):/);
 assert.match(calls[1].messages[1].content,/Christianity makes faith the opposite of sin, not virtue/);
 assert.doesNotMatch(calls[1].messages[1].content,/speaker: Kierkegaard/);
 assert.ok(calls[1].messages[0].content.length<3700,'composition guidance should stay compact');
 assert.match(calls[1].messages[0].content,/Answer each requested part directly/);
 assert.match(calls[1].messages[0].content,/Attribute claims to the visible speaker/);
 assert.match(calls[1].messages[0].content,/Preserve meaningful qualifications/);
 assert.match(calls[1].messages[0].content,/cite each source-based sentence/);
 assert.match(calls[1].messages[0].content,/Use prior conversation only to resolve references/);
 assert.match(calls[1].messages[0].content,/Cross-check answer and partChecks/);
 assert.match(calls[1].messages[0].content,/For a narrative account, explain what happened and how it ended/);
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
  assert.match(calls[1].messages[0].content,/A quote-unverified point may still be supported/);
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
