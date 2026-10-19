/* Antilogicalism Reading Companion — v1.9.0 public-hosting foundation.
 *
 * NOT the live website Worker. Deploy only after the free-plan checks,
 * Turnstile secret and Wrangler rate-limit bindings are configured.
 * PUBLIC_ENABLED defaults OFF and every missing control fails closed.
 *
 * Public clients submit a question, a fresh Turnstile token, and numeric
 * book/page locators — NEVER their own passage text, title or PDF URL.
 * The Worker fetches trusted v47 source shards, binds PDF citations to
 * manifest metadata, then runs a bounded two-call AI answer.
 *
 * Important: authentic source text != a factually supported AI answer.
 * This gateway does not provide claim-level entailment verification.
 * The Free Workers CPU limit (10ms) requires real deployment measurement.
 */
export const INDEX_ROOT = 'https://jsynon.github.io/antilogicalism-library-data/data-v47/';
const FRONTEND_ORIGIN = 'https://jsynon.github.io';
const EXPECTED_TURNSTILE_HOST = 'jsynon.github.io';
const TURNSTILE_ACTION = 'companion_ask';
// v1.11 staged 128-book alpha; each answer page must still match an
// owner-published v47 fingerprint before it reaches the model.
export const PILOT_BOOKS = Object.freeze({
  "7": "Nicomachean Ethics — Aristotle",
  "529": "The Harvard Classics, Volume 11: On the Origin of Species — Charles Darwin",
  "152": "History of the Peloponnesian War — Thucydides",
  "114": "Crime and Punishment — Fyodor Dostoevsky",
  "102": "A Brief History of Time — Stephen Hawking",
  "149": "The Histories — Herodotus",
  "89": "1984 — George Orwell",
  "54": "Thus Spake Zarathustra — Friedrich Nietzsche",
  "144": "On the Genealogy of Morals — Friedrich Nietzsche",
  "239": "The Portable Nietzsche — Friedrich Nietzsche (edited by Walter Kaufmann)",
  "140": "Fear and Trembling — Søren Kierkegaard",
  "192": "Philosophical Fragments — Søren Kierkegaard",
  "253": "The Sickness Unto Death — Søren Kierkegaard",
  "436": "Kierkegaard’s Attack Upon “Christendom,” 1854–1855 — Søren Kierkegaard",
  "211": "The Science of Knowledge — Johann Gottlieb Fichte",
  "353": "The Sound and the Fury — William Faulkner",
  "473": "Sacred Books of the East, Volume 6 — Various authors (edited by F. Max Müller)",
  "245": "The Social Contract — Jean-Jacques Rousseau",
  "38": "The Varieties of Religious Experience — William James",
  "188": "The Oresteia — Aeschylus",
  "129": "Essays — Michel de Montaigne",
  "600": "Collected Works, Volume II: Publications 1938–1974 — Kurt Gödel",
  "136": "The History of the Decline and Fall of the Roman Empire, Volume IV — Edward Gibbon",
  "464": "Tragic Sense of Life — Miguel de Unamuno",
  "494": "Sacred Books of the East, Volume 27 — Various authors (edited by F. Max Müller)",
  "26": "Democracy and Education — John Dewey",
  "640": "Do Androids Dream of Electric Sheep? — Philip K. Dick",
  "13": "Posterior Analytics — Aristotle",
  "262": "What Is Metaphysics? — Martin Heidegger",
  "456": "A Study of History: Abridgement of Volumes I–VI — Arnold J. Toynbee (abridged by D. C. Somervell)",
  "605": "The Time Machine — H. G. Wells",
  "478": "Sacred Books of the East, Volume 11 — Various authors (edited by F. Max Müller)",
  "650": "Selections from the Prison Notebooks — Antonio Gramsci",
  "172": "Man's Search for Meaning — Viktor E. Frankl",
  "75": "Sophist — Plato",
  "326": "Practical Philosophy — Immanuel Kant",
  "202": "The Principles of Quantum Mechanics — P. A. M. Dirac",
  "271": "A Little History of the World — E. H. Gombrich",
  "123": "The Divine Comedy — Dante Alighieri",
  "281": "Against Heresies, Book V — Irenaeus",
  "457": "The Wretched of the Earth — Frantz Fanon",
  "350": "The Sane Society — Erich Fromm",
  "73": "Protagoras — Plato",
  "336": "Of Grammatology — Jacques Derrida",
  "309": "The Feynman Lectures on Physics — Richard P. Feynman",
  "305": "The Education of Henry Adams — Henry Adams",
  "609": "Fahrenheit 451 — Ray Bradbury",
  "476": "Sacred Books of the East, Volume IX: The Qur'ân",
  "619": "A History of Philosophy, Volume IX: From the French Revolution to Sartre, Camus, and Levi-Strauss — Frederick Copleston",
  "143": "Complete Works — Sigmund Freud",
  "70": "Phaedo — Plato",
  "19": "Three Dialogues Between Hylas and Philonous — George Berkeley",
  "615": "A History of Philosophy, Volume V: The British Philosophers, From Hobbes to Hume — Frederick Copleston",
  "139": "Faust, Parts I and II — Johann Wolfgang von Goethe",
  "479": "Sacred Books of the East, Volume 12 — Various authors (edited by F. Max Müller)",
  "113": "On the Revolutions of the Heavenly Spheres — Nicolaus Copernicus",
  "588": "God and Other Minds: A Study of the Rational Justification of Belief in God — Alvin Plantinga",
  "303": "Lives of the Eminent Philosophers — Diogenes Laertius",
  "67": "Laws — Plato",
  "547": "The Voyage of the Beagle (Harvard Classics, Vol. 29) — Charles Darwin",
  "115": "The Decline of the West — Oswald Spengler",
  "315": "Heart of Darkness — Joseph Conrad",
  "16": "The City of God — Augustine of Hippo",
  "109": "Anti-Oedipus: Capitalism and Schizophrenia — Gilles Deleuze and Félix Guattari",
  "32": "Philosophy of Mind (Part Three of the Encyclopaedia of the Philosophical Sciences) — G. W. F. Hegel",
  "27": "Discourses — Epictetus",
  "228": "The Assayer — Galileo Galilei",
  "596": "The Rise and Fall of the Third Reich: A History of Nazi Germany — William L. Shirer",
  "638": "The New Oxford Annotated Bible, Fully Revised Fifth Edition — edited by Michael D. Coogan",
  "577": "Eros and Civilization: A Philosophical Inquiry into Freud — Herbert Marcuse",
  "606": "The Denial of Death — Ernest Becker",
  "74": "The Republic — Plato",
  "12": "Politics — Aristotle",
  "272": "The Logic of Scientific Discovery — Karl Popper",
  "275": "A Short History of the World — H. G. Wells",
  "560": "English Poetry, Vol. III: From Tennyson to Whitman (Harvard Classics, Vol. 42) — Various Poets",
  "304": "Ecclesiastical History — Eusebius of Caesarea",
  "622": "The Jefferson Bible — Thomas Jefferson",
  "407": "D'Alembert's Dream — Denis Diderot",
  "79": "Timaeus — Plato",
  "29": "Letter to Menoeceus — Epicurus",
  "157": "An Introduction to Metaphysics — Henri Bergson",
  "398": "Vestiges of the Natural History of Creation — Robert Chambers",
  "273": "No Exit and Three Other Plays — Jean-Paul Sartre",
  "563": "Sacred Writings, Vol. II: Christian, Buddhist, Hindu, and Mohammedan (Harvard Classics, Vol. 45) — Various Authors",
  "161": "Writings of Leon Trotsky (1932) — Leon Trotsky",
  "206": "Religions, Values, and Peak Experiences — Abraham H. Maslow",
  "540": "The Harvard Classics, Volume 22: The Odyssey — Homer",
  "10": "Physics — Aristotle",
  "629": "The Natural History of Pliny, Volume IV — Pliny the Elder",
  "649": "A Theology of Liberation: History, Politics, and Salvation — Gustavo Gutiérrez",
  "153": "The Iliad — Homer",
  "278": "Against Heresies, Book II — Irenaeus",
  "338": "The Open Society and Its Enemies, Volume I — Karl Popper",
  "308": "The Fear of Freedom — Erich Fromm",
  "236": "The Myth of Sisyphus and Other Essays — Albert Camus",
  "598": "Essays on the Theory of Numbers — Richard Dedekind",
  "101": "Brave New World — Aldous Huxley",
  "22": "The Dhammapada",
  "569": "One-Dimensional Man: Studies in the Ideology of Advanced Industrial Society — Herbert Marcuse",
  "201": "The Principles of Psychology, Volume II — William James",
  "18": "Meditations — Marcus Aurelius",
  "300": "The Courage to Be — Paul Tillich",
  "319": "A History of the Warfare of Science with Theology in Christendom, Volume II — Andrew Dickson White",
  "318": "A History of the Warfare of Science with Theology in Christendom, Volume I — Andrew Dickson White",
  "294": "The Catcher in the Rye — J. D. Salinger",
  "624": "The Existence of God — Richard Swinburne",
  "637": "A Theologico-Political Treatise — Benedict de Spinoza",
  "408": "The Divided Self: An Existential Study in Sanity and Madness — R. D. Laing",
  "15": "Rhetoric — Aristotle",
  "618": "A History of Philosophy, Volume VIII: Bentham to Russell — Frederick Copleston",
  "41": "Fundamental Principles of the Metaphysics of Morals — Immanuel Kant",
  "595": "The Rise and Fall of the Great Powers: Economic Change and Military Conflict from 1500 to 2000 — Paul Kennedy",
  "646": "The New Oxford Annotated Bible, Fourth Edition, with the Apocrypha — edited by Michael D. Coogan",
  "258": "War and Peace — Leo Tolstoy",
  "422": "Principles of Behavior: An Introduction to Behavior Theory — Clark L. Hull",
  "64": "Gorgias — Plato",
  "112": "Contingency, Irony, and Solidarity — Richard Rorty",
  "631": "The Natural History of Pliny, Volume VI — Pliny the Elder",
  "134": "The History of the Decline and Fall of the Roman Empire, Volume II — Edward Gibbon",
  "92": "Animal Farm — George Orwell",
  "471": "Sacred Books of the East, Volume 4 — Various authors (edited by F. Max Müller)",
  "424": "Social Ecology and Communalism — Murray Bookchin",
  "170": "Man and His Symbols — Carl Gustav Jung (editor)",
  "6": "On Dreams — Aristotle",
  "72": "Philebus — Plato",
  "604": "Evolution and Ethics and Other Essays — Thomas H. Huxley",
  "613": "A History of Philosophy, Volume III: Ockham to Suarez — Frederick Copleston"
});
export const PILOT_BOOK_IDS = Object.freeze(Object.keys(PILOT_BOOKS));
const PILOT_BOOK_SET = new Set(PILOT_BOOK_IDS);
const MODEL = '@cf/google/gemma-4-26b-a4b-it';
const PDF = /^https:\/\/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]{10,})\/(?:view|preview)/;
const STOP = new Set('a an and are as at be by can do does for from how i in is it of on or our the their these this to was were what when where who why with would'.split(' '));

function headers(origin) {
  return {
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff',
    ...(origin === FRONTEND_ORIGIN ? {
      'Access-Control-Allow-Origin':FRONTEND_ORIGIN,
      'Access-Control-Allow-Methods':'POST, OPTIONS',
      'Access-Control-Allow-Headers':'Content-Type',
      'Vary':'Origin',
    }:{}),
  };
}
function json(body,status=200,origin='') {
  return Response.json(body,{status,headers:headers(origin)});
}
export function validRequest(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
      typeof data.question !== 'string' || data.question.trim().length < 5 ||
      data.question.length > 400 ||
      typeof data.turnstileToken !== 'string' ||
      data.turnstileToken.length < 1 || data.turnstileToken.length > 2048 ||
      !Array.isArray(data.sources) || data.sources.length < 1 ||
      data.sources.length > 3) return false;
  const seen = new Set(), books = new Set();
  for (const source of data.sources) {
    if (!source || typeof source !== 'object' || Array.isArray(source) ||
        !/^[1-9]\d{0,3}$/.test(String(source.bookId)) ||
        !Number.isSafeInteger(source.page) || source.page < 1 ||
        source.page > 10000) return false;
    const key = source.bookId + ':' + source.page;
    if (seen.has(key)) return false;
    seen.add(key);books.add(String(source.bookId));
  }
  return books.size <= 2;
}
async function corpusJson(filename,fetcher) {
  if (!/^(?:manifest\.json|book-[1-9]\d{0,3}\.json)$/.test(filename)) {
    throw new Error('Unexpected source filename');
  }
  const response = await fetcher(INDEX_ROOT+filename+'.gz',{cache:'no-store'});
  if (!response.ok) throw new Error('Library source unavailable');
  const bytes = new Uint8Array(await response.arrayBuffer());
  let text;
  if (bytes[0]===0x1f && bytes[1]===0x8b) {
    text = await new Response(new Blob([bytes]).stream()
      .pipeThrough(new DecompressionStream('gzip'))).text();
  } else {
    text = new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  }
  return JSON.parse(text);
}
function queryWords(question) {
  return [...new Set((question.toLowerCase().match(/[a-z0-9]+/g)||[])
    .filter(w=>w.length>=3 && !STOP.has(w)))].slice(0,8);
}
export function sourceExcerpt(text,question,max=1080) {
  const content=String(text||'').replace(/\s+/g,' ').trim();
  if(content.length<=max)return content;
  const words=queryWords(question);
  if(!words.length)return content.slice(0,max).replace(/\s+\S*$/,'')+'…';
  let bestStart=0,bestScore=-1;
  // Bounded, predictable retrieval from an already selected source page.
  for(let i=0;i<content.length;i+=135) {
    const slice=content.slice(i,i+max).toLowerCase();
    const score=words.reduce((sum,w)=>sum+(slice.includes(w)?1:0),0);
    if(score>bestScore){bestStart=i;bestScore=score;}
  }
  // Retain explanatory prose after the match; no special historical rules.
  const start=bestStart>0 ? Math.max(0,content.lastIndexOf(' ',bestStart)):0;
  const end=Math.min(content.length,start+max);
  const last=end<content.length?content.lastIndexOf(' ',end):end;
  const clipped=content.slice(start, last>start+max/2?last:end).trim();
  return (start?'…':'')+clipped+(end<content.length?'…':'');
}
export async function trustedSources(question,locators,fetcher=(url,opt)=>globalThis.fetch(url,opt)) {
  const manifest=await corpusJson('manifest.json',fetcher);
  if (manifest.version!==47 || !manifest.books ||
      !Array.isArray(manifest.page_books)) throw new Error('Unexpected library manifest');
  const bookIds=[...new Set(locators.map(s=>String(s.bookId)))];
  const data=new Map();
  for (const bookId of bookIds) {
    const meta=manifest.books[bookId];
    const match=PDF.exec(meta?.drive_url||'');
    if (!match || typeof meta.title!=='string' || !meta.title.trim()) {
      throw new Error('Unknown cited book');
    }
    const shard=await corpusJson('book-'+bookId+'.json',fetcher);
    if (!Array.isArray(shard.pages)) throw new Error('Unexpected book source');
    data.set(bookId,{meta,driveId:match[1],pages:shard.pages});
  }
  const selected=[];
  for(const locator of locators) {
    const bookId=String(locator.bookId),page=locator.page;
    const book=data.get(bookId);
    const original=book.pages.find(p =>
      p.page===page && Number.isSafeInteger(p.id) &&
      String(manifest.page_books[p.id])===bookId &&
      typeof p.text==='string' && p.text.trim().length>=25);
    if(!original)throw new Error('Page not found in trusted corpus');
    const excerpt=sourceExcerpt(original.text,question);
    if(excerpt.length<25)throw new Error('Source page has insufficient text');
    const url='https://drive.google.com/file/d/'+book.driveId+'/view?usp=sharing#page='+page;
    selected.push({id:'S'+(selected.length+1),bookId,title:book.meta.title,
      page,url,preview:excerpt,globalPageId:original.id});
  }
  return selected;
}
// v1.9.2: Consume a small precomputed static packet instead of unpacking
// the full v47 global manifest and all pages of a book. These packets are
// built offline from the canonical data repository and hosted on GitHub Pages.
// This is a CPU experiment, not automatic public enablement.
export const PACKET_ROOT='https://jsynon.github.io/antilogicalism-library-data/reader-packets-v1/';
export async function trustedPacketSources(question,locators,fetcher=(url,options)=>globalThis.fetch(url,options)) {
  const loaded=new Map();
  const sources=[];
  for(const item of locators) {
    const id=String(item.bookId),page=item.page;
    if(!/^[1-9]\d{0,3}$/.test(id) || !Number.isSafeInteger(page) ||
        page<1||page>10000)throw new Error('Invalid source locator');
    const chunk=Math.floor((page-1)/32);
    const key=id+'/'+chunk;
    if(!loaded.has(key)){
      const response=await fetcher(PACKET_ROOT+'books/'+id+'/'+chunk+'.json',{cache:'no-store'});
      if(!response.ok)throw new Error('Trusted packet unavailable');
      const length=Number(response.headers.get('Content-Length'));
      if(length>400000)throw new Error('Trusted packet too large');
      const bytes=new Uint8Array(await response.arrayBuffer());
      if(bytes.byteLength>400000)throw new Error('Trusted packet too large');
      const decoded=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
      loaded.set(key,{packet:JSON.parse(decoded),byteLength:bytes.byteLength});
    }
    const {packet,byteLength}=loaded.get(key);
    if(packet.schema!=='antilogicalism-reader-packet-v1'||
        packet.libraryVersion!==47||packet.bookId!==id||
        packet.chunk!==chunk||packet.firstPage!==chunk*32+1||
        packet.lastPage!==chunk*32+32||
        typeof packet.title!=='string'||!packet.title.trim()||
        typeof packet.pdfDriveId!=='string'||
        !/^[A-Za-z0-9_-]{10,}$/.test(packet.pdfDriveId)||
        !Array.isArray(packet.pages)||packet.pages.length>32) {
      throw new Error('Invalid trusted packet format');
    }
    const matches=packet.pages.filter(p=>p.page===page);
    if(matches.length!==1)throw new Error('Requested page not found in trusted packet');
    const p=matches[0];
    if(!Number.isSafeInteger(p.globalPageId)||p.globalPageId<0||
        typeof p.text!=='string'||p.text.trim().length<25)
      throw new Error('Trusted packet page is invalid');
    const excerpt=sourceExcerpt(p.text,question);
    sources.push({id:'S'+(sources.length+1),bookId:id,title:packet.title,
      page,globalPageId:p.globalPageId,
      url:'https://drive.google.com/file/d/'+packet.pdfDriveId+
        '/view?usp=sharing#page='+page,
      preview:excerpt,packetBytes:byteLength});
  }
  return sources;
}

// v1.9.3 private pilot: verify the *exact* UTF-8 source page text supplied
// by the browser against a small, owner-published v47 fingerprint packet.
// The SHA-256 is calculated in the Worker using native WebCrypto; no mutable
// browser-provided title, excerpt, page ID or PDF link is trusted.
export const FINGERPRINT_ROOT='https://jsynon.github.io/antilogicalism-library-data/reader-fingerprints-v1/';
export async function verifiedFingerprintSources(question,items,fetcher=(url,opts)=>globalThis.fetch(url,opts)) {
  if(!Array.isArray(items)||!items.length||items.length>4)
    throw new Error('Invalid source count');
  const packets=new Map(),seen=new Set(),sources=[];
  let totalBytes=0;
  for(const item of items){
    if(!item || typeof item!=='object' ||
       !/^[1-9]\d{0,3}$/.test(String(item.bookId))||
       !Number.isSafeInteger(item.page)||item.page<1||item.page>10000||
       typeof item.text!=='string')throw new Error('Invalid source claim');
    const bookId=String(it…14155 tokens truncated…ashAlgorithm:'SHA-256-utf8-exact',libraryVersion:47,
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
    const content=input.max_completion_tokens===320?
       JSON.stringify({coverage:'partial',missing:'More history is not in this page',
          evidence:[{id:'S1'}]})
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
 for(const fabricated of ['The answer is clear [S9].','An unsupported claim without a source.']){
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
 const post=async({body={},origin='https://jsynon.github.io',ip='198.51.100.42'}={})=>{
   const merged={...fixture.body,turnstileToken:'one-time-challenge',...body};
   const request=new Request(HOST+'/api/pilot-answer',{method:'POST',
      headers:{Origin:origin,'Content-Type':'application/json',
        'CF-Connecting-IP':ip},
      body:JSON.stringify(merged)});
   return handleRequest(request,environment,validFetcher);
 };
 const plan=async({question='What causes this event?',origin='https://jsynon.github.io',ip='198.51.100.42'}={})=>{
   const request=new Request(HOST+'/api/pilot-plan',{method:'POST',
     headers:{Origin:origin,'Content-Type':'application/json','CF-Connecting-IP':ip},
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
 assert.equal(PILOT_BOOK_IDS.length,128);
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
 assert.equal(data.followUpQuestions.length,2);
 assert(data.followUpQuestions.every(q=>q.endsWith('?')));
 assert.equal(data.verifiedPages,1);
 assert.equal(data.citations[0].page,38);
 assert.equal(data.citations[0].globalPageId,34403);
 assert.equal(pilot.stats().limitCalls,2);
 assert.equal(pilot.stats().verifyCalls,1);
 assert.equal(pilot.stats().calls,2);
});
test('public pilot verifies and submits four source candidates to the bounded answer stage',async()=>{
 const pilot=await pilotScenario({model:async(_model,input)=>{
   if(input.max_completion_tokens===320){
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
test('planner and answer have separate visitor budgets and share the global budget',async()=>{
 const pilot=await pilotScenario({model:async(_model,input)=>{
   if(input.max_completion_tokens===210)return {choices:[{finish_reason:'stop',message:{content:
     '{"queries":["specific original event causes","political motives and context"]}'}}]};
   if(input.max_completion_tokens===320)return {choices:[{finish_reason:'stop',message:{content:
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
   calls++;return {choices:[{finish_reason:'stop',message:{content:input.max_completion_tokens===320?
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
