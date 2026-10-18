import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {RemoteLibrary,decodeDeltas,previewAtWordBoundary,queryTerms} from './remote-library.mjs';
const pdfId='SomeRealFormatPdfId1234567';
const manifest={version:47,postings_encoding:'delta-json-v1',prefix_length:2,pages:5,page_books:[7,7,152,152,152],partitions:['pe','wa','ca'],books:{
  7:{title:'Ethics — Aristotle',drive_url:`https://drive.google.com/file/d/${pdfId}/view`},
  152:{title:'History — Thucydides',drive_url:`https://drive.google.com/file/d/${pdfId}/view`}
}};
const files={'manifest.json':manifest,'terms-pe.json':{peloponnesian:[2,1]},'terms-wa.json':{war:[2,1]},'terms-ca.json':{caused:[2]},
  'book-152.json':{pages:[{id:2,page:27,text:'Thucydides discusses the causes of the conflict and its underlying historical circumstances.'},{id:3,page:28,text:'Both cities exchanged demands and threatened to go to war.'}]},
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
