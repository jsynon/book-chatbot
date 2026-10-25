import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {RemoteLibrary,decodeDeltas,previewAtWordBoundary,queryTerms,isNavigationPage} from './remote-library.mjs';
const pdfId='SomeRealFormatPdfId1234567';
const manifest={version:47,postings_encoding:'delta-json-v1',prefix_length:2,pages:5,page_books:[7,7,152,152,152],partitions:['pe','wa','ca'],books:{
  7:{title:'Ethics — Aristotle',drive_url:`https://drive.google.com/file/d/${pdfId}/view`},
  152:{title:'History — Thucydides',drive_url:`https://drive.google.com/file/d/${pdfId}/view`}
}};
const files={'manifest.json':manifest,'terms-pe.json':{peloponnesian:[2,1]},'terms-wa.json':{war:[2,1]},'terms-ca.json':{caused:[2,1]},
  'book-152.json':{pages:[{id:2,page:27,text:'Thucydides discusses what caused the Peloponnesian War and its underlying historical circumstances.'},{id:3,page:28,text:'Both cities exchanged demands and the tensions caused the Peloponnesian War.'}]},
  'book-7.json':{pages:[{id:0,page:1,text:'Another argument unrelated to this historical question.'}]}};
function fakeFetch(url){const file=String(url).split('/').pop().replace(/\.gz$/,'');if(!(file in files))return Promise.resolve(new Response('missing',{status:404}));return Promise.resolve(new Response(gzipSync(JSON.stringify(files[file])),{status:200}));}
test('query terms exclude framing without hardcoding an answer',()=>{assert.deepEqual(queryTerms('What caused the Peloponnesian War?'),['caused','peloponnesian','war']);});
test('delta decoding checks page bounds and corruption',()=>{assert.deepEqual(decodeDeltas([1,2,1],5),[1,3,4]);assert.throws(()=>decodeDeltas([8],5),/exceeds/);assert.throws(()=>decodeDeltas([-1],5),/Corrupt/);});
test('clip is not misrepresented as a whole page and avoids midword truncation',()=>{const t=previewAtWordBoundary('The long words support a claim involving historical causes and consequences.',28);assert.equal(t,'The long words support a…');});
test('retrieves exact physical pages and manifest-matched book PDF from public corpus schema', async()=>{
 const retriever=new RemoteLibrary('https://example.test/data-v47/',fakeFetch);
 const out=await retriever.search('What caused the Peloponnesian War?',{maxBooks:2});
 assert.equal(out.sources.length,2);assert.deepEqual(out.terms,['caused','peloponnesian','war']);
 assert.deepEqual(out.sources.map(x=>x.page),[27,28]);
 assert.deepEqual(out.sources.map(x=>x.globalPageId),[2,3]);
 assert(out.sources[0].url.endsWith('/view?usp=sharing#page=27'));
 assert.equal(out.sources[0].bookId,'152');
});
test('optional book selection and no random nonmatching book retention',async()=>{
 const library=new RemoteLibrary('https://example.test/data-v47/',fakeFetch);
 const out=await library.search('What caused the Peloponnesian War?',{bookId:'7'});
 assert.equal(out.sources.length,0);
});
test('default browser fetch preserves its global receiver',async()=>{
 const original=globalThis.fetch;
 const calls=[];
 globalThis.fetch=function(url,options){
   assert.equal(this,globalThis);
   calls.push(url);
   return fakeFetch(url,options);
 };
 try{
   const retriever=new RemoteLibrary('https://example.test/data-v47/');
   const result=await retriever.search('What caused the Peloponnesian War?');
   assert.equal(result.sources.length,2);
   assert(calls.some(url=>url.endsWith('/manifest.json.gz')));
 }finally{globalThis.fetch=original;}
});

test('detects index locator entries without rejecting historical prose', () => {
 const index='638 INDEX - Athenian 221, Peithias, leader, 338; 191 at Mytilene, 222 at 252; Peloponnesians, their colonies, 594; Athens, 439, 440; allies 493, 494; assembly 503, 504; position 105, 106; ships 290, 291; book 110, 111; war 455, 456';
 assert.equal(isNavigationPage(index),true);
 assert.equal(isNavigationPage('The city feared the growing power of its opponent. The chronicler distinguishes immediate disputes from the deeper cause of the war.'),false);
});

test('detects an OCR index when the folio and INDEX heading occur after the first entries',()=>{
 const index='intrinsic, 14f Vedanta, 55, 170: advaita, 58n Vedas, 105; Vedic, 147, 168 Virgin Mother, 148; virtue: as synonym for quality or being, 2nf 182 / INDEX traditio, 146 Transformist Illusion, 111 transpersonal: journal of Psychology, 156n; Trauma of Birth, 162, 165; trikaya, 58n; Tristes Tropiques, 126; truth: as not needing us, 58; objective, 7, 10; subjective, 7';
 assert.equal(isNavigationPage(index),true);
 assert.equal(isNavigationPage('An index of the evidence can be useful. The author then explains how the argument depends on experience and judgment.'),false);
});
test('does not rank unrelated single-word matches over a multi-term history book', async () => {
 const data = structuredClone(files);
 data['manifest.json'].pages=7;
 data['manifest.json'].page_books=[7,7,152,152,152,89,89];
 data['manifest.json'].books['89']={title:'An Epic — Homer',drive_url:`https://drive.google.com/file/d/${pdfId}/view`};
 data['terms-pe.json'].peloponnesian=[2,1];
 data['terms-wa.json'].war=[2,1,2];
 data['terms-ca.json'].caused=[2,1];
 data['book-152.json'].pages=[
  {id:2,page:656,text:'638 INDEX - Athenian 221, Peithias, leader, 338; 191 at Mytilene, 222 at 252; Peloponnesians, their colonies, 594; Athens, 439, 440; allies 493, 494; assembly 503, 504; position 105, 106; ships 290, 291; book 110, 111; war 455, 456'},
  {id:3,page:27,text:'The disputes caused the Peloponnesian War between two city alliances. The historian distinguishes immediate causes from deeper fears. The conflict developed over several negotiations.'},
  {id:4,page:28,text:'These disputes caused the Peloponnesian War as tensions grew between the city powers. Their alliances clashed and the war continued.'}
 ];
 data['book-89.json']={pages:[{id:5,page:12,text:'The warriors gathered for war. Ancient heroes exchanged words and fought their enemies.'}]};
 const fetcher=url=>{const filename=String(url).split('/').pop().replace(/\.gz$/,'');return Promise.resolve(filename in data ? new Response(gzipSync(JSON.stringify(data[filename])),{status:200}) : new Response('',{status:404}));};
 const result=await new RemoteLibrary('https://example.test/v47/',fetcher).search('What caused the Peloponnesian War?');
 assert(result.sources.length>0);
 assert(result.sources.every(source=>source.bookId==='152'));
 assert(result.sources.every(source=>source.page!==656));
});

test('publication metadata and index pages are not offered as evidence', async()=>{
 const {isPublicationPage,substantivePageEvidence} = await import('./remote-library.mjs');
 const copyright='This book is protected by International Copyright. It may not be reproduced in whole or in part without written permission. All rights reserved. New introduction for Peloponnesian War.';
 assert.equal(isPublicationPage(copyright),true);
 assert.equal(substantivePageEvidence(copyright,['peloponnesian','war']),null);
 const prose='The war was caused by a growing rivalry between two powers. Their alliances suffered mutual suspicion and the disputes led toward violence. The historian attributes the deepest cause to fear of increasing power.';
 assert(substantivePageEvidence(prose,['caused','war']));
});

test('long excerpts retain causal explanation following an introductory mention',async()=>{
 const {excerptAroundEvidence}=await import('./remote-library.mjs');
 const page='Before the question came up, the cities discussed their reasons for conflict. '.repeat(8)+
 'The disputes were the immediately apparent reason for the war. '+
 'Yet this account distinguishes the much deeper cause from the disputes: mounting power and the fear it created among the rival city leaders. '+
 'The surrounding details help clarify the author\'s point.';
 const clip=excerptAroundEvidence(page,['disputes','war'],1080);
 assert(clip.includes('much deeper cause'));
 assert(clip.length<=1090);
});
test('third evidence slot preserves adjacent-page narrative over a distant scattered hit',async()=>{
 const data=structuredClone(files);
 data['manifest.json'].pages=6;
 data['manifest.json'].page_books=[7,7,152,152,152,152];
 data['terms-pe.json'].peloponnesian=[2,1,1];
 data['terms-wa.json'].war=[2,1,1];
 data['terms-ca.json'].caused=[2,1,1];
 data['book-152.json'].pages=[
 {id:2,page:38,text:'The Peloponnesian War was caused in part by an immediate dispute between the allied cities. This account describes reasons and their historical background.'},
 {id:3,page:39,text:'The deeper explanation is increasing power in one city and the corresponding fear in the other. The historian distinguishes this from more visible grievances.'},
 {id:4,page:621,text:'The Peloponnesian War was caused by disagreements during the long conflict. A fleet took a defensive position near another island.'},
 {id:5,page:622,text:'The Peloponnesian War was caused by the escalation of local warfare in several territories. Ships gathered near the coast.'}
 ];
 const fetcher=url=>{const file=String(url).split('/').pop().replace(/\.gz$/,'');return Promise.resolve(file in data ? new Response(gzipSync(JSON.stringify(data[file])),{status:200}) : new Response('',{status:404}));};
 const result=await new RemoteLibrary('https://example.test/v47/',fetcher).search('What caused the Peloponnesian War?',{maxBooks:1,pagesPerBook:3});
 assert.equal(result.sources.length,3);
 // This asserts that contiguous page 39 is reserved when page 38 is a top hit.
 // Exact ordering can depend on scoring, so sort the physical pages to verify.
 assert(result.sources.some(source=>source.page===39));
});


test('v1.10 search only returns sources from fingerprint-ready book allowlist',async()=>{
 const result=await new RemoteLibrary('https://example.test/v47/',fakeFetch)
   .search('What caused the Peloponnesian War?',{
      allowedBookIds:new Set(['7']),maxBooks:2,pagesPerBook:1});
 assert.equal(result.sources.length,0);
 const accepted=await new RemoteLibrary('https://example.test/v47/',fakeFetch)
   .search('What caused the Peloponnesian War?',{
      allowedBookIds:new Set(['152']),maxBooks:2,pagesPerBook:1});
 assert(accepted.sources.length>0);
 assert(accepted.sources.every(s=>s.bookId==='152'));
});
