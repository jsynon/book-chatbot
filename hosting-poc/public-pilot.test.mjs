import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as support from './public-gateway.test-support.mjs';
import {claimPersonSubjects} from './evidence-answer.mjs';
const {gzipSync,gateway,handleRequest,trustedSources,trustedPacketSources,verifiedFingerprintSources,prepareCandidatePages,sourceExcerpt,turnstileRejection,inferenceFailureDiagnostics,answerPipelineFailureDiagnostics,workerVersionDiagnostics,PILOT_BOOKS,PILOT_BOOK_IDS,planSearchQueries,planSearchGapQueries,stripWebCaptureFooters,selectPublicEvidenceHighlights,HOST,PDF,manifest,pages,question,payload,fetcher,env,fingerprintTestFixture,pilotBaseEnv,pilotScenario,v2DefaultModel}=support;

test('batch 15 pilot route preserves subtitles and canonical quotation repair through scaffolding',async()=>{
 const token='batch15-quotation-heading-route-fixture-token';let composeCalls=0,reviewCalls=0;
 const model=async(_model,input)=>{
  const system=input.messages[0].content;
  if(system.startsWith('Answer the reader\'s exact question')){
   composeCalls++;
   return {response:'PART P1\n**Growth vs. Fear:** The growth of Athenian power inspired fear in Sparta. [S1]\n\nThis explains "rising tension".'};
  }
  if(system.startsWith('Review the complete answer parts and claims')){
   reviewCalls++;const payload=JSON.parse(input.messages[1].content);
   const result=depthReview(payload);const body=JSON.parse(result.choices[0].message.content);
   body.parts[0].scaffoldingLinks=[{claimId:'P1-C2',supportClaimIds:['P1-C1']}];
   return {response:JSON.stringify(body)};
  }
  return {response:'{}'};
 };
 const pilot=await pilotScenario({config:{PILOT_EVALUATION_ENABLED:'true',
  PILOT_EVALUATION_TOKEN:token,READER_PIPELINE:'evidence-v2'},model});
 const response=await pilot.post({headers:{Authorization:'Bearer '+token},body:{
  question:'What caused the Peloponnesian War?',answerVariant:'with-review',trace:true,
  sources:[pilot.fixture.body.sources[0]],
  plan:{intent:'explain',sources:[{label:'Thucydides',role:'primary',bookIds:['152']}],
   parts:[{id:'P1',question:'What caused the Peloponnesian War?',sourceBookIds:['152']}]}}});
 assert.equal(response.status,200);const result=await response.json();
 assert.match(result.answer,/\*\*Growth vs\. Fear:\*\*/);
 assert.doesNotMatch(result.answer,/\*\*[^*]*\[S\d+\][^*]*\*\*/);
 assert.match(result.answer,/This explains rising tension\. \[S1\]/);
 assert.equal(composeCalls,1);assert.equal(reviewCalls,1);
 const shipped=new Set(result.questionParts.flatMap(p=>p.claimIds));
 assert.ok(result.evidenceMap.every(e=>shipped.has(e.claimId)));
 assert.ok(result.trace.finalCoverageReconciliation.length);
});


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
test('public highlights omit nonadjacent secondary quotes for the same claim',()=>{
 const citations=[
  {id:'S3',title:'On the Genealogy of Morals — Friedrich Nietzsche',page:10,url:'https://example.test/nietzsche#page=10'},
  {id:'S2',title:'Last Writings — Kitarō Nishida',page:18,url:'https://example.test/nishida#page=18'}
 ];
 const resentment='The slave revolt in morality begins when resentment itself becomes creative and gives birth to values.';
 const irrelevant='Does the church today still have necessary work to do, or could we dispense with it?';
 const sokuHi='Soku hi exhibits the dynamic tension of affirmation and negation without synthesis.';
 const editorial='Introduction: sunyata is correlated with dependent co-arising in Nagarjuna.';
 const evidenceMap=[
  {id:'S3',claimId:'P1-C1',partId:'P1',point:'Christianity is a destructive, life-hostile principle that emerged from resentment.',quote:irrelevant,quoteVerified:true},
  {id:'S3',claimId:'P1-C1',partId:'P1',point:'Christianity is a destructive, life-hostile principle that emerged from resentment.',quote:resentment,quoteVerified:true},
  {id:'S2',claimId:'P2-C1',partId:'P2',point:'Sunyata is expressed through the paradoxical logic soku hi, sustaining a dynamic tension of affirmation and negation.',quote:editorial,quoteVerified:true},
  {id:'S2',claimId:'P2-C1',partId:'P2',point:'Sunyata is expressed through the paradoxical logic soku hi, sustaining a dynamic tension of affirmation and negation.',quote:sokuHi,quoteVerified:true}
 ];
 const result=selectPublicEvidenceHighlights(
  'Christianity is a destructive, life-hostile principle that emerged from resentment [S3]. '+
  'Sunyata is expressed through the paradoxical logic soku hi, sustaining a dynamic tension of affirmation and negation [S2].',
  citations,evidenceMap,2);
 assert.deepEqual(result.map(item=>item.quote),[resentment,sokuHi]);
 assert.deepEqual(result.map(item=>item.quotes.map(quote=>quote.quote)),[
  [resentment],[sokuHi]
 ]);
 assert.equal(result[0].quotes[0].point,
  'Christianity is a destructive, life-hostile principle that emerged from resentment.');
});

test('a shared span keeps a link per distinct claim without crowding out a distinct highlight (B6-2)',()=>{
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
 // Pre-batch-6 this fixture pinned the opposite contract (the shared
 // quote kept only its best-ranked claim association). B6-2 scopes the
 // dedupe per claim so every distinct claim sharing the span keeps its
 // link; the client dedupes the repeated text at display time.
 const sharedLinks=highlights[0].quotes.filter(item=>item.quote===custom);
 assert.deepEqual(sharedLinks.map(item=>item.claim_id).sort(),
  ['P1-C1','P1-C3','P2-C1'],
  'each distinct claim sharing the span keeps its own highlight link');
 assert.ok(quotes.includes(heat),
  'a distinct approved example is available among the page excerpts');
 assert.equal(highlights[0].quotes.find(item=>item.quote===custom).point,inferencePoint);
});
test('public primary highlight favors the reader-named phrase over nonadjacent context',()=>{
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
 assert.deepEqual(highlights[0].quotes.map(item=>item.quote),[direct],
  'a nonadjacent secondary excerpt does not dilute the direct highlight for the same claim');
});

test('v1.9.5 public pilot verifies hash, Turnstile and rate limits before bounded AI',async()=>{
 const pilot=await pilotScenario();
 const result=await pilot.post();
 assert.equal(result.status,200);
 const data=await result.json();
 assert.equal(data.outcome,'verified-source-draft');
 assert.equal(data.pilot,true);
 // v2 contract: highlights are built only from reviewer-verified spans;
 // the approving review anchored the claim to a real span of page 38, so
 // exactly that verified quote is highlighted (never a generic preview).
 assert.equal(data.evidenceHighlights.length,1);
 assert.equal(data.evidenceHighlights[0].source_id,'S1');
 assert.equal(data.evidenceHighlights[0].page,38);
 assert.match(data.evidenceHighlights[0].quote,/public disputes/);
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
test('public pilot verifies and submits six source candidates to the bounded answer stage',async()=>{
 const pilot=await pilotScenario({model:async(_model,input)=>{
   const system=input.messages?.[0]?.content||'';
   if(system.startsWith('Review the complete answer parts and claims'))
     return v2DefaultModel(_model,input);
   const payload=JSON.parse(input.messages[1].content);
   const s6=payload.evidence.find(item=>item.id==='S6');
   assert(s6&&s6.page===43,'the compose packet carries S6 at physical PDF page 43');
   return {choices:[{finish_reason:'stop',message:{content:
     'PART P1\nThe verified passage supports this explanation [S6].'}}],usage:{neurons:1}};
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
   const system=input.messages?.[0]?.content||'';
   if(system.startsWith('Review the complete answer parts and claims'))
     return v2DefaultModel(_model,input);
   const payload=JSON.parse(input.messages[1].content);
   assert.deepEqual(payload.evidence.map(item=>item.id),
     ['S1','S2','S3','S4','S5','S6'],
     'the compose packet carries all six complementary pages');
   return {choices:[{finish_reason:'stop',message:{content:
     'PART P1\nThe six passages provide distinct parts of the explanation [S1] [S2] [S3] [S4] [S5] [S6].'}}],usage:{neurons:1}};
 }});
 const source=pilot.fixture.body.sources[0];
 const response=await pilot.post({body:{sources:[38,39,40,41,42,43].map(page=>({...source,page}))}});
 assert.equal(response.status,200);
 const result=await response.json();
 assert.equal(result.verifiedPages,6);
 assert.deepEqual(result.citations.map(item=>item.id),['S1','S2','S3','S4','S5','S6']);
 assert.deepEqual(result.citations.map(item=>item.page),[38,39,40,41,42,43]);
});
test('public pilot resolves grouped citation IDs and drops unknown IDs in a group',async()=>{
 const pilot=await pilotScenario({model:async(_model,input)=>{
   const system=input.messages?.[0]?.content||'';
   if(system.startsWith('Review the complete answer parts and claims'))
     return v2DefaultModel(_model,input);
   return {choices:[{finish_reason:'stop',message:{content:
     'PART P1\nThe passages support this claim [S1, S3].'}}],usage:{neurons:1}};
 }});
 const source=pilot.fixture.body.sources[0];
 const result=await pilot.post({body:{sources:[38,39,40].map(page=>({...source,page}))}});
 assert.equal(result.status,200);
 const data=await result.json();
 assert.deepEqual(data.citations.map(item=>item.id),['S1','S3']);
 assert.equal(data.evidenceHighlights.length,2,
  'highlights follow the reviewer-verified spans of both grouped citations');

 const invalid=await pilotScenario({model:async(_model,input)=>{
   const system=input.messages?.[0]?.content||'';
   if(system.startsWith('Review the complete answer parts and claims'))
     return v2DefaultModel(_model,input);
   return {choices:[{finish_reason:'stop',message:{content:
     'PART P1\nThe passages support this claim [S1, S9] [S1].'}}],usage:{neurons:1}};
 }});
 const dropped=await invalid.post();
 // v2 contract: an unknown citation ID is dropped during claim
 // normalization, not fatal to the answer (the legacy route 502'd).
 assert.equal(dropped.status,200);
 const droppedData=await dropped.json();
 assert.equal(droppedData.outcome,'verified-source-draft');
 assert.deepEqual(droppedData.citations.map(item=>item.id),['S1']);
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
       claims:payload.claims.map(answer=>{
        const sources=answer.sourceIds.map(sourceId=>({sourceId,status:'answered',
         spanIds:[sourceId+'-Q1']}));
        return {claimId:answer.claimId,status:'answered',sources,
         clauses:[{text:answer.text,status:'answered',issueCode:'none',sources}]};
       })});
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
test('stream transport is evaluation-authorized and records transport diagnostics',async()=>{
 const token='batch17-streaming-evaluation-secret-'.repeat(2);
 const seen=[];
 const model=async(_model,input)=>{
  seen.push(input.stream===true);
  const response='PART P1\nThucydides distinguishes an immediate dispute from fear of growing power. [S1]';
  if(input.stream){
   const bytes=new TextEncoder().encode('data: '+JSON.stringify({response})+'\n\ndata: [DONE]\n\n');
   return new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}});
  }
  return {response,usage:{neurons:1,prompt_tokens:2,completion_tokens:3}};
 };
 const pilot=await pilotScenario({config:{PILOT_EVALUATION_ENABLED:'true',
  PILOT_EVALUATION_TOKEN:token,READER_PIPELINE:'evidence-v2',
  READER_INFERENCE_TRANSPORT:undefined},model});
 const response=await pilot.post({headers:{Authorization:'Bearer '+token},body:{
  question:'What caused the Peloponnesian War?',answerVariant:'compose-only',
  trace:true
 }});
 assert.equal(response.status,200);
 const data=await response.json();
 assert.equal(data.inferenceTransport,'streaming');
 assert.ok(data.trace.inferenceCalls.length>0);
 assert.ok(data.trace.inferenceCalls.every(call=>call.transport==='streaming-buffered'));
 assert.ok(seen.some(value=>value),'streaming is the default when no rollback value is configured');

 const rollbackPilot=await pilotScenario({config:{PILOT_EVALUATION_ENABLED:'true',
  PILOT_EVALUATION_TOKEN:token,READER_PIPELINE:'evidence-v2',
  READER_INFERENCE_TRANSPORT:'default'},model});
 const rollbackResponse=await rollbackPilot.post({headers:{Authorization:'Bearer '+token},body:{
  question:'What caused the Peloponnesian War?',answerVariant:'compose-only',trace:true
 }});
 assert.equal(rollbackResponse.status,200);
 assert.equal((await rollbackResponse.json()).inferenceTransport,'default');
 assert.equal(seen.at(-1),false,'rollback must omit stream:true from provider requests');

 const publicOnly=await pilotScenario({config:{READER_PIPELINE:'evidence-v2'},model});
 const ordinary=await publicOnly.post({body:{inferenceTransport:'streaming',selectionOnly:true}});
 assert.equal(ordinary.status,200);
 const ordinaryData=await ordinary.json();
 assert.equal(ordinaryData.inferenceTransport,undefined);
 assert.equal(ordinaryData.selectionOnly,undefined);
 assert.equal(ordinaryData.trace,undefined);
 assert.equal(seen.filter(value=>value).length,1,
  'an unauthenticated client cannot enable the streaming evaluation transport');
});
test('evaluation-only selection preparation returns a verified reusable snapshot without composing an answer',async()=>{
 const token='batch17-shared-selection-secret-'.repeat(2);
 const model=async()=>{
  // Redesign Stage A: selection is deterministic, so a
  // selection-only request must not call the model at all.
  throw new Error('selection-only request unexpectedly called the model');
 };
 const pilot=await pilotScenario({config:{PILOT_EVALUATION_ENABLED:'true',
  PILOT_EVALUATION_TOKEN:token,READER_PIPELINE:'evidence-v2'},model});
 const source=pilot.fixture.body.sources[0];
 const response=await pilot.post({headers:{Authorization:'Bearer '+token},body:{
  question:'What does this verified passage say?',selectionOnly:true,
  plan:{intent:'explain',sources:[],parts:[{question:'What does this verified passage say?'}]},sources:[source]
 }});
 assert.equal(response.status,200);
 const result=await response.json();
 assert.equal(result.selectionOnly,true);
 assert.equal(result.selectionSnapshot.length,1);
 assert.equal(result.selectionSnapshot[0].bookId,source.bookId);
 assert.equal(result.selectionSnapshot[0].page,source.page);
 assert.equal(result.sourceSelection.pages.length,1);
 assert.equal(pilot.stats().calls,0,'redesign Stage A: deterministic evidence selection runs without any model call, and composition is skipped');
});
test('evidence-v2 public route returns six reviewed highlights for six cited pages',async()=>{
 const token='six-reviewed-highlight-test-token';
 const model=async(_model,input)=>{
  const system=input.messages?.[0]?.content||'';
  const payload=JSON.parse(input.messages[1].content);
  if(system.startsWith('Review the complete answer parts and claims')){
   return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
    parts:payload.parts.map(part=>({partId:part.partId,status:'answered'})),
    claims:payload.claims.map(claim=>{
     const sources=claim.sourceIds.map(sourceId=>({sourceId,status:'answered',
      spanIds:[payload.parts.find(part=>part.partId===claim.partId)
       .evidence.find(item=>item.id===sourceId).spanIds[0]]}));
     return {claimId:claim.claimId,status:'answered',sources,
      clauses:[{text:claim.text,status:'answered',issueCode:'none',sources}]};
    })
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
 assert.equal(pilot.stats().calls,2,'redesign Stage A: Worker evidence selection is deterministic and makes no model call; only the compose/review pair runs');
});
test('a valid empty evidence selection can review a useful single-part answer without a heading',async()=>{
 const token='selector-empty-evidence-test-token';
 // Redesign Stage A: there is no selector call to abstain; the
 // empty selection is an empty submitted pool.
 const pilot=await pilotScenario({config:{PILOT_EVALUATION_ENABLED:'true',
   PILOT_EVALUATION_TOKEN:token,READER_PIPELINE:'evidence-v2'},
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
 // Redesign Stage A: the empty selection is a pool no part can
 // claim — the question names Thucydides (so the part's scope is
 // his book), while the one submitted page belongs to another
 // book entirely, so the deterministic path abstains.
 const response=await pilot.post({headers:{Authorization:'Bearer '+token},body:{
  question:'What does Thucydides say about whether we are living in a simulation?',
  sources:[{...pilot.fixture.body.sources[0],bookId:'114',title:PILOT_BOOKS['114']}],
  plan:{intent:'explain',sources:[{label:'Thucydides',role:'primary',bookIds:['152']}],
   parts:[{id:'P1',question:'What does Thucydides say about whether we are living in a simulation?',
    sourceBookIds:['152']}]}}});
 const result=await response.json();
 assert.equal(response.status,200);
 assert.equal(result.outcome,'general-context-answer');
 // Stage B (B4): coverage is computed from cited-claim reality —
 // a zero-citation answer may not report 'full' (the phase-3 war
 // AP2 shape), and the general-context disposition opens with the
 // up-front framing line instead of disclosing only in a notice.
 assert.equal(result.coverage,'partial');
 assert.match(result.answer,/^No library passages could be verified for this question; what follows is general knowledge\./,
  'the general-context answer opens with the framing line');
 assert.match(result.answer,/no established evidence/);
 assert.match(result.answer,/Related ideas.*do not establish a literal simulation/);
 assert.deepEqual(result.citations,[]);
 assert.deepEqual(result.sourceSelection.pages,[]);
 assert.equal(result.sourceSelection.status,'no-relevant-evidence');
 assert.equal(result.sourceSelectionStatus,'no-relevant-evidence');
 assert.equal(result.sourceSelection.usage.neurons,0,'redesign Stage A: deterministic selection spends no neurons');
 assert.match(result.notice,/no library citations/i);
 assert.equal(result.reviewStatus,'general-context-review');
 assert.equal(result.trace.recovery.code,'missing-part-heading',
  'a one-part answer can be assigned and reviewed when its redundant heading is omitted');
 assert.equal(result.usage.calls,2,'the composer and reviewer calls are retained in usage (selection is deterministic)');
 assert.equal(pilot.stats().calls,2,'an empty evidence selection still reaches composition and review');
 assert.equal(result.trace.stages[0].status,'no-relevant-evidence');
 assert.deepEqual(result.trace.stages[0].decision.selectedCandidateIds,[]);
});
test('an unmentioned catalog-valid planner source does not scope empty selection or block general knowledge',async()=>{
 const token='unmentioned-planner-source-pilot-test-token';
 const question='How have writers described the effects of technological change on daily life?';
 const answerText='Technological change can reshape daily life by changing how people communicate, work, and coordinate with one another. A useful answer should connect those changes to concrete examples from the period and writers being discussed.';
 const pilot=await pilotScenario({config:{PILOT_EVALUATION_ENABLED:'true',
   PILOT_EVALUATION_TOKEN:token,READER_PIPELINE:'evidence-v2'},
  selector:async()=>({choices:[{finish_reason:'stop',message:{content:'{"parts":[{"partId":"P1","evidence":[]}]}'}}]}),
  model:async(_model,input)=>{
   const payload=JSON.parse(input.messages[1].content);
   if(Array.isArray(payload.claims))return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
    claims:payload.claims.map(claim=>({claimId:claim.claimId,status:'answered',sources:[]})),
    parts:payload.parts.map(part=>({partId:part.partId,status:'answered',answerStatus:'answered',
     directAnswerClaimIds:(part.contextClaims||[]).slice(0,1).map(claim=>claim.claimId),
     retainedContextClaimIds:(part.contextClaims||[]).map(claim=>claim.claimId)}))})}}]};
   return {choices:[{finish_reason:'stop',message:{content:answerText}}]};
  }
 });
 const response=await pilot.post({headers:{Authorization:'Bearer '+token},body:{question,
  plan:{intent:'explain',sources:[{label:'United Nations Framework Convention on Climate Change',
    role:'primary',bookIds:['400']}],
   parts:[{id:'P1',question:'What does the United Nations Framework Convention on Climate Change say about technology?',
    sourceBookIds:['400']}]}
 }});
 assert.equal(response.status,200);
 const result=await response.json();
 assert.equal(result.trace.plan.parts[0].sourceBookIds,null);
 assert.equal(result.outcome,'general-context-answer');
 assert.equal(result.answerCompleteness,'full');
 assert.deepEqual(result.citations,[]);
 assert.deepEqual(result.evidenceHighlights,[]);
 // Redesign Stage A: normalizePlan dropped the unmentioned book's
 // scope, so the part is unscoped and the deterministic path packs
 // the submitted pages as context (status 'selected'); the answer
 // still lands general-context because nothing citable supports
 // the part — the planner source neither scopes the packet nor
 // blocks general knowledge.
 assert.equal(result.sourceSelection.status,'selected');
 assert.equal(pilot.stats().calls,2,'the composer and review calls remain the only calls (selection is deterministic)');
});
test('planner and answer have separate visitor budgets and share the global budget',async()=>{
 const pilot=await pilotScenario({model:async(_model,input)=>{
   if(input.max_completion_tokens===1100)return {choices:[{finish_reason:'stop',message:{content:
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
 // v2 contract: a failed build surfaces as a coded generation failure
 // (200, safe canned answer), never as a raw provider error.
 assert.equal(response.status,200);
 const body=await response.json();
 assert.equal(body.outcome,'generation-failed');
 assert.equal(body.failureCode,'answer-pipeline-failed');
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
 const fetched=await original('https://jsynon.github.io/antilogicalism-library-data/reader-fingerprints-v2/books/152/1.json');
 const fp=await fetched.json();
 fp.bookId='7';fp.chunk=0;fp.firstPage=1;fp.lastPage=32;fp.pages[0].page=4;
 const environment=env({...pilotBaseEnv,AI:{run:async(...args)=>{
   calls++;return v2DefaultModel(...args);
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


test('public pilot labels unexpected answer-pipeline failures without exposing messages',async()=>{
 const pilot=await pilotScenario({model:async(_model,input)=>{
   const system=input.messages?.[0]?.content||'';
   if(system.startsWith('Review the complete answer parts and claims'))
     return v2DefaultModel(_model,input);
   const result={choices:[{finish_reason:'stop',message:{content:
     'PART P1\nThe passage makes a limited claim [S1].'}}]};
   Object.defineProperty(result,'usage',{get(){
     throw new Error('private provider response body and passage text');
   }});
   return result;
 }});
 const response=await pilot.post({body:{question:'What does this passage say?'}});
 // v2 contract: the unexpected failure is labeled with the pipeline's
 // safe code and stage; the raw message never surfaces.
 assert.equal(response.status,200);
 const failure=await response.json();
 assert.equal(failure.outcome,'generation-failed');
 assert.equal(failure.failureCode,'answer-pipeline-failed');
 assert.equal(failure.failureStage,'compose');
 assert.equal(failure.failureProviderClass,undefined);
 assert.equal(JSON.stringify(failure).includes('private provider response body'),false);
 assert.equal(JSON.stringify(failure).includes('passage text'),false);
 // The failed compose call is retried by the transport before the
 // build gives up: 4 attempts, all hitting the same throwing getter.
 assert.equal(pilot.stats().calls,4);
});


// ---------------------------------------------------------------------------
// Batch 10 (B10-4): depth repair in the v2 pipeline, exercised through
// the pilot route — the batch-9 lesson was a mechanism verified only
// in the legacy pipeline it never served, so these tests cross the
// route into evidence-v2 and read depthRepair from the response.
// ---------------------------------------------------------------------------
const depthThickPart=[
 'Thucydides argues that the deepest cause of the war was the growth of Athenian power and the fear that this growth inspired in Sparta and its allies across Greece. [S1]',
 'He distinguishes that underlying cause from the immediate disputes and complaints that the two sides exchanged in the years before the fighting finally began in earnest. [S1]',
 'The fear operated quietly for years, shaping alliances and embassies long before any army marched, because each city interpreted the other side’s defensive measures as preparation for domination. [S1]',
 'Athens kept adding to its empire and its revenues, and every addition made the Spartan fear more reasonable in Spartan eyes, even when Athens described its own actions as defensive. [S1]',
 'The allies of Sparta pressed for a confrontation while they still believed the balance could be corrected, arguing that delay would only leave Athens stronger and their own position weaker. [S1]',
 'In this account the war became inevitable not because either side wanted destruction for its own sake, but because fear made compromise look like surrender to both camps. [S1]'].join(' ');
const depthThinSentence='The war lasted so long because fear kept both alliances committed long after the original disputes had faded from memory. [S1]';
function depthReview(payload,{fail=false}={}){
 if(fail)return {choices:[{finish_reason:'stop',message:{content:'not a review'}}]};
 return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({
  parts:payload.parts.map(part=>({partId:part.partId,status:'answered',answerStatus:'answered',
   directAnswerClaimIds:payload.claims.filter(claim=>claim.partId===part.partId)
    .slice(0,1).map(claim=>claim.claimId),
   retainedContextClaimIds:[]})),
  claims:payload.claims.map(claim=>{
   const personSubjects=claimPersonSubjects(claim.text);
   const subjectIsThucydides=personSubjects.some(name=>/^Thucydides$/iu.test(name));
   const sources=claim.sourceIds.map(sourceId=>({sourceId,status:'answered',
    spanIds:claim.sourceEvidence.find(item=>item.sourceId===sourceId).spanIds.slice(0,1),
    attributionStatus:'supported',attributedSpeaker:'Thucydides',
    ...(personSubjects.length?{subjectAttributionStatus:subjectIsThucydides?'supported':'not_applicable',
     attributedSubject:subjectIsThucydides?'Thucydides':''}:{})}));
   return {claimId:claim.claimId,status:'answered',sources,
    clauses:[{text:claim.text,status:'answered',issueCode:'none',
     sources:sources.map(({sourceId,spanIds})=>({sourceId,status:'answered',spanIds}))}]};
  })
 })}}]};
}
function depthScenarioModel({p2Text,developed=true,failReReview=false}={}){
 const state={repairCalls:0,repairSeen:false};
 const model=async(_model,input)=>{
  const system=input.messages?.[0]?.content||'';
  const payload=JSON.parse(input.messages[1].content);
  if(system.startsWith('Review the complete answer parts and claims'))
   return depthReview(payload,{fail:failReReview&&state.repairSeen});
  if(system.startsWith('Patch only the requested claims')){
   state.repairCalls++;state.repairSeen=true;
   const part=payload.parts[0];
   return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({parts:[{
    partId:part.partId,
    replacements:part.repair.replaceClaimIds.map(claimId=>({claimId,
     text:'The war lasted for decades because the fear that had caused it did not end with the first campaigns: each side’s allies dragged their patrons back into fighting whenever a local quarrel reopened the larger question of Athenian power. [S1]'})),
    additions:developed?[
     'Thucydides stresses that the length of the war multiplied its suffering, as plague, civil conflict, and repeated invasions turned a dispute between two cities into a calamity for the whole Greek world. [S1]',
     'Because neither Athens nor Sparta could accept a settlement that left the other’s power intact, every truce became only an interval in which both sides rebuilt their strength for the next round. [S1]']:[]}]})}}]};
  }
  if(system.startsWith('Answer the reader\'s exact question')){
   return {choices:[{finish_reason:'stop',message:{content:
    'PART P1\n'+depthThickPart+'\n\nPART P2\n'+p2Text}}]};
  }
  return {choices:[{finish_reason:'stop',message:{content:'{}'}}]};
 };
 return {model,state};
}
async function depthPost(pilot,token,{trace=false}={}){
 const page38=pilot.fixture.body.sources[0];
 // The resolved question is explicitly two-part (", and why…"), which
 // is what keeps normalizePlan from collapsing the plan to one part.
 return pilot.post({headers:{Authorization:'Bearer '+token},body:{
  question:'What caused the Peloponnesian War, and why did it last so long?',
  answerVariant:'with-review',
  ...(trace?{trace:true}:{}),
  sources:[{...page38}],
  plan:{intent:'explain',sources:[{label:'Thucydides',role:'primary',bookIds:['152']}],
   parts:[{id:'P1',question:'What caused the Peloponnesian War?',sourceBookIds:['152']},
    {id:'P2',question:'Why did the war last so long?',sourceBookIds:['152']}]}
 }});
}

test('evidence-v2 diagnostics separate provider wait, parsing, composition and concurrent review wall time',async()=>{
 const token='batch17-stage-timing-profile-test-token';
 const base=depthScenarioModel({p2Text:depthThinSentence});
 let activeReviews=0,maxConcurrentReviews=0;
 const model=async(modelName,input)=>{
  const system=input.messages?.[0]?.content||'';
  if(system.startsWith('Review the complete answer parts and claims')){
   activeReviews++;
   maxConcurrentReviews=Math.max(maxConcurrentReviews,activeReviews);
   await new Promise(resolve=>setTimeout(resolve,45));
   try{return await base.model(modelName,input);}finally{activeReviews--;}
  }
  return base.model(modelName,input);
 };
 const pilot=await pilotScenario({config:{PILOT_EVALUATION_ENABLED:'true',
  PILOT_EVALUATION_TOKEN:token,READER_PIPELINE:'evidence-v2'},model});
 const response=await depthPost(pilot,token,{trace:true});
 assert.equal(response.status,200);
 const result=await response.json();
 const timings=result.trace.stageTimings;
 assert.ok(Array.isArray(timings)&&timings.length>0);
 assert.ok(timings.every(item=>Number.isFinite(item.startOffsetMs)&&
  Number.isFinite(item.endOffsetMs)&&Number.isFinite(item.providerWaitMs)&&
  Number.isFinite(item.parseMs)&&item.stageWallMs>=item.providerWaitMs),
  JSON.stringify(timings));
 const review=timings.filter(item=>item.stage==='review');
 assert.equal(review.length,3,'each planned part receives its review calls (P1\u2019s six cited claims chunk into two calls, P2 one)');
 assert.equal(maxConcurrentReviews,3,'the test confirms the part and chunk review calls overlap');
 const summedReviewWall=review.reduce((sum,item)=>sum+item.stageWallMs,0);
 assert.ok(result.trace.timingSummary.reviewWallMs<=summedReviewWall,
  'review wall time never exceeds the sum of its individual intervals');
 assert.equal(result.trace.timingSummary.providerWaitByPhaseMs.review,
  timings.filter(item=>item.stage.startsWith('review')||item.stage==='answer-re-review')
   .reduce((sum,item)=>sum+item.providerWaitMs,0));
 assert.ok(result.trace.timingSummary.buildWallMs>=result.trace.timingSummary.reviewWallMs);
});


test('evidence-v2 route: a part thick by the floor never triggers depth repair (batch 10 B10-4)',async()=>{
 const token='depth-repair-thick-route-test-token';
 const thickP2=[
  'The war lasted for decades because the fear that caused it did not end with the first campaigns or the first settlements between the two alliances. [S1]',
  'Plague, civil conflict, and repeated invasions multiplied the suffering of the Greek world far beyond what either side had expected when the fighting began. [S1]',
  'Neither Athens nor Sparta could accept a settlement that left the other’s power intact, so every truce became an interval for rebuilding strength. [S1]'].join(' ');
 const {model,state}=depthScenarioModel({p2Text:thickP2});
 const pilot=await pilotScenario({config:{PILOT_EVALUATION_ENABLED:'true',
  PILOT_EVALUATION_TOKEN:token,READER_PIPELINE:'evidence-v2'},model});
 const response=await depthPost(pilot,token);
 assert.equal(response.status,200);
 const result=await response.json();
 assert.deepEqual(result.depthRepair,
  {triggered:false,reasons:[],applied:false,partIds:[]},
  'depthRepair is present and quiet when nothing is thin');
 assert.equal(state.repairCalls,0,'no repair call is made');
});


test('evidence-v2 route: a build that returns a coded generation failure surfaces as 200 with the real code (batch 11 B11-1)',async()=>{
 // The route-level half of the salvage contract: when the build
 // RETURNS a failure (its normal path after B11-1), the gateway
 // answers 200 with the build's true failure code — the 502
 // catch-all is reserved for errors that still escape.
 const token='salvage-route-failure-token';
 const model=async(_model,input)=>{
  const system=input.messages?.[0]?.content||'';
  if(system.startsWith('Answer the reader\'s exact question')){
   const error=new Error('Inference deadline exceeded');
   error.code='inference-deadline-exceeded';error.stage='compose';
   throw error;
  }
  return {choices:[{finish_reason:'stop',message:{content:'{}'}}]};
 };
 const pilot=await pilotScenario({config:{PILOT_EVALUATION_ENABLED:'true',
  PILOT_EVALUATION_TOKEN:token,READER_PIPELINE:'evidence-v2'},model});
 const response=await depthPost(pilot,token);
 assert.equal(response.status,200,
  'a returned build failure is answered, not a 502');
 const result=await response.json();
 assert.equal(result.outcome,'generation-failed');
 assert.equal(result.failureCode,'inference-deadline-exceeded',
  'the body carries the true provider code');
 assert.doesNotMatch(JSON.stringify(result),
  /answer-generation-or-citation-failed/,
  'and never the gateway catch-all');
});


test('batch 35 B35-7 pilot: the selection trace carries a diversityFinal record on the deterministic path instead of silence',async()=>{
 const token='0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
 const model=async(_model,input)=>{
  const system=input.messages[0].content;
  if(system.startsWith('Answer the reader\'s exact question')){
   return {response:'PART P1\nThe growth of Athenian power inspired fear in Sparta. [S1]'};
  }
  if(system.startsWith('Review the complete answer parts and claims')){
   return depthReview(JSON.parse(input.messages[1].content));
  }
  return {response:'{}'};
 };
 // Redesign Stage A: the deterministic path is the only selection
 // path — the route batch 34 knew as the silent fallback. The
 // diversity verification must still record on it.
 const pilot=await pilotScenario({config:{PILOT_EVALUATION_ENABLED:'true',
  PILOT_EVALUATION_TOKEN: token},model});
 const first=pilot.fixture.body.sources[0];
 const response=await pilot.post({headers:{Authorization:'Bearer '+token},body:{
  question:'What caused the Peloponnesian War?',answerVariant:'with-review',trace:true,
  sources:[{...first,page:38},{...first,page:39}],
  plan:{intent:'explain',sources:[{label:'Thucydides',role:'primary',bookIds:['152']}],
   parts:[{id:'P1',question:'What caused the Peloponnesian War?',sourceBookIds:['152']}]}}});
 assert.equal(response.status,200);const result=await response.json();
 const selectionStage=(result.trace.stages||[]).find(stage=>stage.stage==='evidence-selection');
 assert.ok(selectionStage,'the selection stage is traced');
 assert.equal(selectionStage.status,'selected');
 assert.equal(selectionStage.packingProvenance,'deterministic');
 assert.deepEqual(selectionStage.diversityFinal,{status:'not-run',reason:'single-book-pool'},
  'the deterministic path records why the bar did not run instead of staying silent');
});

test('redesign Stage A: pilot selection makes zero model calls',async()=>{
 const token='stagea-deterministic-selection-test-token';
 const selectorCalls=[];
 const model=async(_model,input)=>{
  const system=input.messages[0].content;
  if(system.startsWith('Answer the reader\'s exact question')){
   return {response:'PART P1\nThe growth of Athenian power inspired fear in Sparta. [S1]'};
  }
  if(system.startsWith('Review the complete answer parts and claims')){
   return depthReview(JSON.parse(input.messages[1].content));
  }
  return {response:'{}'};
 };
 const pilot=await pilotScenario({config:{PILOT_EVALUATION_ENABLED:'true',
  PILOT_EVALUATION_TOKEN:token,READER_PIPELINE:'evidence-v2'},model,
  selector:async()=>{selectorCalls.push(1);
   throw new Error('the model selector must not be called');}});
 const response=await pilot.post({headers:{Authorization:'Bearer '+token},body:{
  question:'What caused the Peloponnesian War?',answerVariant:'with-review',trace:true,
  sources:[pilot.fixture.body.sources[0]],
  plan:{intent:'explain',sources:[{label:'Thucydides',role:'primary',bookIds:['152']}],
   parts:[{id:'P1',question:'What caused the Peloponnesian War?',sourceBookIds:['152']}]}}});
 assert.equal(response.status,200);
 const result=await response.json();
 assert.equal(selectorCalls.length,0,'the model selector never runs on the pilot route');
 assert.equal(pilot.stats().calls,2,'only the compose and review calls run');
 const selectionStage=(result.trace.stages||[]).find(stage=>stage.stage==='evidence-selection');
 assert.equal(selectionStage.packingProvenance,'deterministic');
 assert.equal(selectionStage.decision.usage.calls,0);
 assert.equal(result.sourceSelection.usage.calls,0);
 assert.match(result.answer,/growth of Athenian power/);
});

test('stage B B1a pilot: facet-anchor pages are seeded before the round-robin fill and traced on the selection trace',async()=>{
 const token='stage-b-tranche2-evaluation-token-0123456789';
 const model=async(_model,input)=>{
  const system=input.messages[0].content;
  if(system.startsWith('Answer the reader\'s exact question')){
   return {response:'PART P1\nThe growth of Athenian power inspired fear in Sparta. [S1]'};
  }
  if(system.startsWith('Review the complete answer parts and claims')){
   return depthReview(JSON.parse(input.messages[1].content));
  }
  return {response:'{}'};
 };
 const pilot=await pilotScenario({config:{PILOT_EVALUATION_ENABLED:'true',
  PILOT_EVALUATION_TOKEN:token},model});
 const first=pilot.fixture.body.sources[0];
 const mk=(page,facetRanks)=>({...first,page,candidatePartIds:['P1'],
  ...(facetRanks?{facetRanks}:{})});
 const post=async sources=>{
  const response=await pilot.post({headers:{Authorization:'Bearer '+token},body:{
   question:'What caused the Peloponnesian War?',answerVariant:'with-review',trace:true,
   sources,
   plan:{intent:'explain',sources:[{label:'Thucydides',role:'primary',bookIds:['152']}],
    parts:[{id:'P1',question:'What caused the Peloponnesian War?',sourceBookIds:['152']}]}}});
  assert.equal(response.status,200);
  return response.json();
 };
 // Facet 0's rank-1 page is the pool's LAST row (page 43); facet 1's
 // rank-1 page is the first row (page 38). Without the reservation
 // the fill reaches page 43 last; with it, the anchors lead the
 // decision's selected set.
 const result=await post([mk(38,[{facet:0,rank:2},{facet:1,rank:1}]),
  mk(39,[{facet:1,rank:2}]),mk(40),mk(41),mk(42),mk(43,[{facet:0,rank:1}])]);
 const selectionStage=(result.trace.stages||[]).find(stage=>stage.stage==='evidence-selection');
 assert.ok(selectionStage,'the selection stage is traced');
 assert.equal(selectionStage.packingProvenance,'deterministic');
 const anchors=selectionStage.facetAnchorReservations;
 assert.equal(anchors.status,'reserved');
 assert.deepEqual(anchors.seededCandidateIds,['C6','C1'],
  'facet tops seed in facet order: facet 0’s anchor (C6) before facet 1’s (C1)');
 assert.deepEqual(anchors.reservations.find(entry=>entry.facet===0),
  {facet:0,candidateId:'C6',partIds:['P1'],status:'reserved',submitted:true});
 assert.deepEqual(anchors.reservations.find(entry=>entry.facet===1),
  {facet:1,candidateId:'C1',partIds:['P1'],status:'reserved',submitted:true});
 assert.equal(selectionStage.decision.selectedCandidateIds[0],'C6',
  'the seeded anchor leads the selected set, ahead of the round-robin fill');
 // The same pool without facet ranks: the reservation records
 // honestly that it had nothing to reserve from.
 const bare=await post([mk(38),mk(39),mk(40)]);
 const bareStage=(bare.trace.stages||[]).find(stage=>stage.stage==='evidence-selection');
 assert.equal(bareStage.facetAnchorReservations.status,'no-facet-ranks',
  'the current harness submissions carry no facet ranks — the record says so');
 assert.deepEqual(bareStage.facetAnchorReservations.seededCandidateIds,[]);
 assert.deepEqual(bareStage.facetAnchorReservations.reservations,[]);
});

test('stage B.5 adoption: a starved part adopts the pool\'s unlinked page and the page reaches composition',async()=>{
 const token='stage-b5-adoption-pilot-test-token-0123456';
 const model=async(_model,input)=>{
  const system=input.messages[0].content;
  if(system.startsWith('Answer the reader\'s exact question')){
   return {response:'PART P1\nThe growth of Athenian power inspired fear in Sparta. [S1]\n\nPART P2\nThe growth of Athenian power inspired fear in Sparta. [S1]'};
  }
  if(system.startsWith('Review the complete answer parts and claims')){
   return depthReview(JSON.parse(input.messages[1].content));
  }
  return {response:'{}'};
 };
 const pilot=await pilotScenario({config:{PILOT_EVALUATION_ENABLED:'true',
  PILOT_EVALUATION_TOKEN:token,READER_PIPELINE:'evidence-v2'},model});
 const first=pilot.fixture.body.sources[0];
 const response=await pilot.post({headers:{Authorization:'Bearer '+token},body:{
  question:'What caused the Peloponnesian War, and why did it last so long?',
  answerVariant:'with-review',trace:true,
  sources:[{...first,page:38,candidatePartIds:['P1','P2']},
   {...first,page:39,candidatePartIds:['P1','P2']},
   {...first,page:40,candidatePartIds:[]},
   {...first,page:41,candidatePartIds:['P1','P2']}],
  plan:{intent:'explain',sources:[{label:'Thucydides',role:'primary',bookIds:['152']}],
   parts:[{id:'P1',question:'What caused the Peloponnesian War?',sourceBookIds:['152']},
    {id:'P2',question:'Why did the war last so long?',sourceBookIds:['152']}]}}});
 assert.equal(response.status,200);const result=await response.json();
 const stage=(result.trace.stages||[]).find(item=>item.stage==='evidence-selection');
 assert.ok(stage,'the selection stage is traced');
 // P2's retrieval links are all context rows, so the starved part
 // adopts the pool's one unlinked page (C3, page 40) as a context row.
 const adoption=(stage.adoptions||[]).find(entry=>entry.partId==='P2');
 assert.ok(adoption,'P2 records an adoption');
 assert.equal(adoption.candidateId,'C3');
 assert.ok(adoption.fit>=1,'the adopted page lexically fits the part question');
 const p2Decision=stage.decision.parts.find(part=>part.partId==='P2');
 assert.deepEqual(p2Decision.evidence.find(entry=>entry.candidateId==='C3'),
  {candidateId:'C3',support:'context',provenance:'adopted'});
 // The adopted page packs, carries the P2 link, and is in the part's
 // composer source set — compose-visible, not just traced.
 const packed=stage.selected.find(entry=>entry.candidateId==='C3');
 assert.ok(packed,'the adopted page is packed');
 assert.ok(packed.candidatePartIds.includes('P2'));
 const p2Plan=result.trace.plan.parts.find(part=>part.id==='P2');
 assert.ok(p2Plan.candidateSourceIds.includes(packed.id),
  'the adopted page is in the part\'s composer source set');
});

test('stage B.5 ledger: a pooled page no part links and no starved part can use is excluded as no-part-link',async()=>{
 const token='stage-b5-ledger-nolink-pilot-test-token-01';
 const model=async(_model,input)=>{
  const system=input.messages[0].content;
  if(system.startsWith('Answer the reader\'s exact question')){
   return {response:'PART P1\nThe growth of Athenian power inspired fear in Sparta. [S1]'};
  }
  if(system.startsWith('Review the complete answer parts and claims')){
   return depthReview(JSON.parse(input.messages[1].content));
  }
  return {response:'{}'};
 };
 const pilot=await pilotScenario({config:{PILOT_EVALUATION_ENABLED:'true',
  PILOT_EVALUATION_TOKEN:token,READER_PIPELINE:'evidence-v2'},model});
 const first=pilot.fixture.body.sources[0];
 const response=await pilot.post({headers:{Authorization:'Bearer '+token},body:{
  question:'What caused the Peloponnesian War?',answerVariant:'with-review',trace:true,
  sources:[{...first,page:38,candidatePartIds:['P1']},
   {...first,page:39,candidatePartIds:['P1']},
   // The orphan's text shares no stemmed term with the part's
   // question, so adoption cannot claim it either; it must be
   // ledgered, not silently dropped.
   {...first,page:40,candidatePartIds:[],
    text:'A sourdough starter, fed with rye flour and warm water, bubbles gently on the kitchen counter through the night.'}],
  plan:{intent:'explain',sources:[{label:'Thucydides',role:'primary',bookIds:['152']}],
   parts:[{id:'P1',question:'What caused the Peloponnesian War?',sourceBookIds:['152']}]}}});
 assert.equal(response.status,200);const result=await response.json();
 const stage=(result.trace.stages||[]).find(item=>item.stage==='evidence-selection');
 assert.ok(stage,'the selection stage is traced');
 assert.equal(stage.selected.length,2,'only the two linked pages pack');
 assert.deepEqual(stage.excluded,[{id:'C3',reason:'no-part-link'}]);
 assert.deepEqual(stage.decision.droppedCandidateIds,[]);
});

test('stage B.5 ledger: the six-page packet cap names its overflow on the decision and the ledger',async()=>{
 const token='stage-b5-ledger-overflow-pilot-test-token';
 const model=async(_model,input)=>{
  const system=input.messages[0].content;
  if(system.startsWith('Answer the reader\'s exact question')){
   return {response:'PART P1\nThe growth of Athenian power inspired fear in Sparta. [S1]'};
  }
  if(system.startsWith('Review the complete answer parts and claims')){
   return depthReview(JSON.parse(input.messages[1].content));
  }
  return {response:'{}'};
 };
 const pilot=await pilotScenario({config:{PILOT_EVALUATION_ENABLED:'true',
  PILOT_EVALUATION_TOKEN:token,READER_PIPELINE:'evidence-v2'},model});
 const first=pilot.fixture.body.sources[0];
 const sources=[38,39,40,41,42,43,44,45].map(page=>({...first,page,
  candidatePartIds:['P1']}));
 const response=await pilot.post({headers:{Authorization:'Bearer '+token},body:{
  question:'What caused the Peloponnesian War?',answerVariant:'with-review',trace:true,
  sources,
  plan:{intent:'explain',sources:[{label:'Thucydides',role:'primary',bookIds:['152']}],
   parts:[{id:'P1',question:'What caused the Peloponnesian War?',sourceBookIds:['152']}]}}});
 assert.equal(response.status,200);const result=await response.json();
 const stage=(result.trace.stages||[]).find(item=>item.stage==='evidence-selection');
 assert.ok(stage,'the selection stage is traced');
 assert.equal(stage.selected.length,6,'the packet holds six pages');
 assert.deepEqual(stage.decision.droppedCandidateIds,[
  {candidateId:'C7',reason:'six-page-packet-limit'},
  {candidateId:'C8',reason:'six-page-packet-limit'}],
  'the slice overflow is named on the decision instead of vanishing');
 assert.deepEqual(stage.excluded,[
  {id:'C7',reason:'six-page-packet-limit'},
  {id:'C8',reason:'six-page-packet-limit'}],
  'and the ledger repeats it in pool order');
});

test('selection tranche item 1: the fill is ordered by facet signal, so a rank-2 page late in pool order survives the slice',async()=>{
 const token='selection-tranche-ordering-pilot-test-token';
 const model=async(_model,input)=>{
  const system=input.messages[0].content;
  if(system.startsWith('Answer the reader\'s exact question')){
   return {response:'PART P1\nThe growth of Athenian power inspired fear in Sparta. [S1]'};
  }
  if(system.startsWith('Review the complete answer parts and claims')){
   return depthReview(JSON.parse(input.messages[1].content));
  }
  return {response:'{}'};
 };
 const pilot=await pilotScenario({config:{PILOT_EVALUATION_ENABLED:'true',
  PILOT_EVALUATION_TOKEN:token,READER_PIPELINE:'evidence-v2'},model});
 const first=pilot.fixture.body.sources[0];
 const mk=(page,facetRanks)=>({...first,page,candidatePartIds:['P1'],
  ...(facetRanks?{facetRanks}:{})});
 // Pool order is submission order (C1..C8 = pages 44,45,39,40,41,42,38,43).
 // Facet tops seed first (C4 for facet 0, C3 for facet 1). Under the old
 // pool-order fill the slice took C4,C3,C1,C2,C5,C6 and the facet-1
 // rank-2 page (C8, last in the pool) was named in the overflow; the
 // signal-ordered fill promotes it ahead of every rank-9 and unranked
 // row, so the overflow names the two unranked pages instead.
 const response=await pilot.post({headers:{Authorization:'Bearer '+token},body:{
  question:'What caused the Peloponnesian War?',answerVariant:'with-review',trace:true,
  sources:[mk(44),mk(45),mk(39,[{facet:1,rank:1}]),mk(40,[{facet:0,rank:1}]),
   mk(41,[{facet:1,rank:9}]),mk(42,[{facet:1,rank:9}]),mk(38,[{facet:1,rank:9}]),
   mk(43,[{facet:1,rank:2},{facet:0,rank:2}])],
  plan:{intent:'explain',sources:[{label:'Thucydides',role:'primary',bookIds:['152']}],
   parts:[{id:'P1',question:'What caused the Peloponnesian War?',sourceBookIds:['152']}]}}});
 assert.equal(response.status,200);const result=await response.json();
 const stage=(result.trace.stages||[]).find(item=>item.stage==='evidence-selection');
 assert.ok(stage,'the selection stage is traced');
 assert.deepEqual(stage.facetAnchorReservations.seededCandidateIds,['C4','C3'],
  'the facet anchors still seed first, in facet order');
 assert.deepEqual(stage.decision.selectedCandidateIds,
  ['C4','C3','C8','C5','C6','C7'],
  'anchors lead, then the rank-2 page, then the rank-9 rows in pool order');
 assert.deepEqual(stage.decision.droppedCandidateIds,[
  {candidateId:'C1',reason:'six-page-packet-limit'},
  {candidateId:'C2',reason:'six-page-packet-limit'}],
  'the unranked rows are the slice overflow now');
 assert.equal(stage.candidates[7].page,43,
  'C-ids still name pool positions — the sort moved IDs, never renumbered them');
 const packedC8=stage.selected.find(entry=>entry.candidateId==='C8');
 assert.equal(packedC8.page,43,'the rescued rank-2 page is packed');
 // The part's own evidence list follows the same key: both rank-1
 // anchors, then the rank-2 page, then rank 9s, then the unranked rows.
 assert.deepEqual(stage.decision.parts[0].candidateIds,
  ['C3','C4','C8','C5','C6','C7','C1','C2']);
});

test('selection tranche item 2: distinctive-term evidence classifies direct; scope-fallback rows never do',async()=>{
 const token='selection-tranche-classify-pilot-test-token';
 const model=async(_model,input)=>{
  const system=input.messages[0].content;
  if(system.startsWith('Answer the reader\'s exact question')){
   return {response:'PART P1\nThe growth of Athenian power inspired fear in Sparta. [S1]\n\nPART P2\nThe growth of Athenian power inspired fear in Sparta. [S1]\n\nPART P3\nThe growth of Athenian power inspired fear in Sparta. [S1]'};
  }
  if(system.startsWith('Review the complete answer parts and claims')){
   return depthReview(JSON.parse(input.messages[1].content));
  }
  return {response:'{}'};
 };
 const pilot=await pilotScenario({config:{PILOT_EVALUATION_ENABLED:'true',
  PILOT_EVALUATION_TOKEN:token,READER_PIPELINE:'evidence-v2'},model});
 const first=pilot.fixture.body.sources[0];
 // Repaired-signal terms — P1's: fear, grow, power, caus, war (the
 // fixture text carries all five, so the six identical pages are
 // direct for P1 in the packet). P2's: sparta, fear, athenian, power
 // (the text carries fear and power: direct). C7 carries no P1 or P2
 // term (context for both); C8 carries exactly one P1 term (never
 // enough); C9 carries three P3 terms but no part hints it to P3, so
 // P3 meets it only through the scope fallback, which is context by
 // construction. The custom pages sit past the slice, so none is
 // ever packed.
 const response=await pilot.post({headers:{Authorization:'Bearer '+token},body:{
  question:'How did the fear of growing power cause the war, why did Sparta fear Athenian power, and when did the plague strike Athens?',
  answerVariant:'with-review',trace:true,
  sources:[...[38,39,40,41,42,43].map(page=>({...first,page,candidatePartIds:['P1','P2']})),
   {...first,page:44,candidatePartIds:['P1','P2'],
    text:'The naval tribute records list payments from the island cities each spring.'},
   {...first,page:45,candidatePartIds:['P1'],
    text:'The fleet returned home after the war had ended.'},
   {...first,page:46,candidatePartIds:['P1'],
    text:'The plague strikes Athens in the second summer of the war.'}],
  plan:{intent:'explain',sources:[{label:'Thucydides',role:'primary',bookIds:['152']}],
   parts:[{id:'P1',question:'How did the fear of growing power cause the war?',sourceBookIds:['152']},
    {id:'P2',question:'Why did Sparta fear the growth of Athenian power?',sourceBookIds:['152']},
    {id:'P3',question:'When did the plague strike Athens?',sourceBookIds:['152']}]}}});
 assert.equal(response.status,200);const result=await response.json();
 const stage=(result.trace.stages||[]).find(item=>item.stage==='evidence-selection');
 assert.ok(stage,'the selection stage is traced');
 const supportOf=(partId,candidateId)=>stage.decision.parts
  .find(part=>part.partId===partId).evidence
  .find(entry=>entry.candidateId===candidateId)?.support;
 assert.equal(supportOf('P1','C7'),'context',
  'the naval page holds no P1 term under the repaired signal');
 assert.equal(supportOf('P2','C7'),'context',
  'the same page holds no P2-distinctive term');
 assert.equal(supportOf('P1','C8'),'context',
  'a single distinctive term does not classify');
 assert.equal(supportOf('P2','C1'),'direct',
  'the fixture text carries fear and power for P2');
 assert.equal(supportOf('P1','C1'),'direct',
  'the fixture text carries fear, power, cause and war for P1');
 const p3=stage.decision.parts.find(part=>part.partId==='P3');
 assert.equal(p3.evidence.length,9,'the scope fallback links every pooled page to P3');
 assert.ok(p3.evidence.every(entry=>entry.support==='context'),
  'scope-fallback rows stay context even when the text matches the part');
 assert.equal(supportOf('P3','C9'),'context',
  'the plague page is context for P3 despite three distinctive terms');
 assert.equal(stage.decision.parts.find(part=>part.partId==='P1').coverage,'supported');
 assert.equal(p3.coverage,'partial');
 assert.deepEqual(stage.directClassification,
  {rowsClassified:25,directRows:12,partsWithDirect:2,partsTotal:3},
  'the trace census counts the classification');
});

test('selection tranche item 2: an adopted row stays context even when its text carries the part’s distinctive terms',async()=>{
 const token='selection-tranche-adopted-pilot-test-token';
 const model=async(_model,input)=>{
  const system=input.messages[0].content;
  if(system.startsWith('Answer the reader\'s exact question')){
   return {response:'PART P1\nThe growth of Athenian power inspired fear in Sparta. [S1]\n\nPART P2\nThe growth of Athenian power inspired fear in Sparta. [S1]'};
  }
  if(system.startsWith('Review the complete answer parts and claims')){
   return depthReview(JSON.parse(input.messages[1].content));
  }
  return {response:'{}'};
 };
 const pilot=await pilotScenario({config:{PILOT_EVALUATION_ENABLED:'true',
  PILOT_EVALUATION_TOKEN:token,READER_PIPELINE:'evidence-v2'},model});
 const first=pilot.fixture.body.sources[0];
 // P1 (caused / Peloponnesian / war) has direct fixture rows. P2
 // (naval tribute / Athenian fleet) has none — the fixture text holds
 // none of its distinctive terms — so P2 is starved and adopts the
 // unlinked C7, whose text is full of P2's terms. Adoption provenance
 // keeps the row context: the classifier never sees adopted rows.
 // C7 sits past the slice, so it is adopted and traced, never packed.
 const response=await pilot.post({headers:{Authorization:'Bearer '+token},body:{
  question:'What caused the Peloponnesian War, and how did naval tribute fund the Athenian fleet?',
  answerVariant:'with-review',trace:true,
  sources:[...[38,39,40,41,42,43].map(page=>({...first,page,candidatePartIds:['P1','P2']})),
   {...first,page:44,candidatePartIds:[],
    text:'The naval tribute lists record how island allies paid for the fleet.'}],
  plan:{intent:'explain',sources:[{label:'Thucydides',role:'primary',bookIds:['152']}],
   parts:[{id:'P1',question:'What caused the Peloponnesian War?',sourceBookIds:['152']},
    {id:'P2',question:'How did naval tribute fund the Athenian fleet?',sourceBookIds:['152']}]}}});
 assert.equal(response.status,200);const result=await response.json();
 const stage=(result.trace.stages||[]).find(item=>item.stage==='evidence-selection');
 assert.ok(stage,'the selection stage is traced');
 const adoption=(stage.adoptions||[]).find(entry=>entry.partId==='P2');
 assert.ok(adoption,'P2 still adopts — it has no direct row');
 assert.equal(adoption.candidateId,'C7');
 const p2=stage.decision.parts.find(part=>part.partId==='P2');
 assert.deepEqual(p2.evidence.find(entry=>entry.candidateId==='C7'),
  {candidateId:'C7',support:'context',provenance:'adopted'},
  'the adopted row is context despite carrying P2’s distinctive terms');
 const p1=stage.decision.parts.find(part=>part.partId==='P1');
 assert.ok(p1.evidence.every(entry=>entry.support==='direct'),
  'P1’s fixture rows are direct (cause and war in the text)');
 assert.deepEqual(stage.directClassification,
  {rowsClassified:13,directRows:6,partsWithDirect:1,partsTotal:2});
});

