/* v1.8.1: Read-only browser proof of concept for the published v47 corpus.
 * This does not call an LLM or replace Python's evidence pipeline.
 * Original shard IDs, physical PDF pages and manifest PDF URLs are preserved.
 */
export const DEFAULT_INDEX_ROOT = 'https://jsynon.github.io/antilogicalism-library-data/data-v47/';
const STOP = new Set('a an and are as at be by can do does for from how i in is it of on or our the their these this to was were what when where who why with would'.split(' '));
const PDF = /^https:\/\/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]{10,})\/(?:view|preview)/;
export function queryTerms(question) {
  return [...new Set(String(question || '').toLowerCase().match(/[a-z0-9]+/g) || [])]
    .filter(t => t.length >= 3 && !STOP.has(t)).slice(0, 8);
}
export function decodeDeltas(deltas, total) {
  if (!Array.isArray(deltas)) throw new Error('Invalid term postings.');
  const ids = []; let current = 0;
  for (const delta of deltas) {
    if (!Number.isSafeInteger(delta) || delta < 0) throw new Error('Corrupt term posting.');
    current += delta;
    if (current >= total) throw new Error('Term posting exceeds manifest pages.');
    ids.push(current);
  }
  return ids;
}
export function previewAtWordBoundary(text, max = 550) {
  const compact = String(text || '').replace(/\s+/g, ' ').trim();
  if (compact.length <= max) return compact;
  const before = compact.slice(0, max);
  const lastSpace = before.lastIndexOf(' ');
  return (lastSpace > max / 2 ? before.slice(0, lastSpace) : before) + '…';
}
// This is only a source-form check, not a test of historical truth.
// A long alphabetical index has many page locators but few real sentences.
export function isNavigationPage(text) {
  const raw = String(text || '').trim();
  if (/^(?:(?:\d{1,4}|[ivxlc]+)\s+)?(?:index|table of contents|contents)\b/i.test(raw)) return true;
  const words = raw.match(/[a-z]+/gi) || [];
  const refs = raw.match(/\b\d{1,4}(?:[-–]\d{1,4})?\b/g) || [];
  const sentences = (raw.match(/[.!?]["')\]]?\s+(?=[A-Z])/g) || []).length;
  return words.length >= 20 && refs.length >= 10 &&
    refs.length / words.length >= 0.12 &&
    (raw.split(',').length >= 16 || raw.split(';').length >= 4) &&
    sentences <= 2;
}
function pageProseScore(text, terms) {
  if (isNavigationPage(text)) return -Infinity;
  const words = new Set(String(text || '').toLowerCase().match(/[a-z0-9]+/g) || []);
  const matched = terms.filter(term => words.has(term)).length;
  if (!matched) return -Infinity;
  const sentenceBoundaries = (text.match(/[.!?]["')\]]?\s+(?=[A-Z])/g) || []).length;
  // A genuine multi-sentence explanation is preferable to a list, header
  // or isolated quoted name. Never fabricate an answer from raw page hits.
  return 4 * matched + Math.min(4, sentenceBoundaries) +
    (words.size >= 40 ? 1 : 0);
}

export class RemoteLibrary {
  // Call window.fetch through its owning global object. Storing the bare
  // browser method and later invoking it as this.fetcher() can throw
  // "Illegal invocation" because its receiver is the RemoteLibrary object.
  constructor(root = DEFAULT_INDEX_ROOT, fetcher = (url, options) => globalThis.fetch(url, options)) {
    this.root = String(root).replace(/\/?$/, '/');
    this.fetcher = fetcher;
    this.manifestPromise = null;
    this.partitions = new Map();
  }
  async jsonGzip(filename) {
    if (!/^(?:manifest|terms-[a-z0-9]{2}|book-[0-9]+)\.json$/.test(filename)) {
      throw new Error('Unexpected corpus filename.');
    }
    const response = await this.fetcher(this.root + filename + '.gz', {cache:'no-store'});
    if (!response.ok) throw new Error('Corpus request returned HTTP ' + response.status + '.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    // GitHub Pages may transmit the compressed bytes or already decode them.
    let raw;
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      if (typeof DecompressionStream === 'undefined') throw new Error('A modern browser with gzip support is required.');
      raw = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    } else {
      raw = new TextDecoder('utf-8', {fatal:true}).decode(bytes);
    }
    return JSON.parse(raw);
  }
  async manifest() {
    if (!this.manifestPromise) {
      this.manifestPromise = this.jsonGzip('manifest.json').then(value => {
        if (value.version !== 47 || value.postings_encoding !== 'delta-json-v1' ||
            value.prefix_length !== 2 || !Array.isArray(value.page_books) ||
            value.page_books.length !== value.pages ||
            !Array.isArray(value.partitions) || typeof value.books !== 'object') {
          throw new Error('Incompatible v47 manifest.');
        }
        return value;
      }).catch(error => { this.manifestPromise = null; throw error; });
    }
    return this.manifestPromise;
  }
  async partition(prefix) {
    if (!/^[a-z0-9]{2}$/.test(prefix)) throw new Error('Invalid term prefix.');
    if (!this.partitions.has(prefix)) {
      this.partitions.set(prefix, this.jsonGzip('terms-' + prefix + '.json').catch(error => {
        this.partitions.delete(prefix); throw error;
      }));
      // Keep only a few decompressed index partitions in browser memory.
      if (this.partitions.size > 8) this.partitions.delete(this.partitions.keys().next().value);
    }
    return this.partitions.get(prefix);
  }
  async search(question, {bookId = '', maxBooks = 2, pagesPerBook = 2} = {}) {
    const started = performance.now();
    const manifest = await this.manifest();
    const terms = queryTerms(question).filter(t => manifest.partitions.includes(t.slice(0, 2)));
    if (!terms.length) return {terms:[], sources:[], elapsedMs:Math.round(performance.now() - started)};
    const prefixes = [...new Set(terms.map(t => t.slice(0,2)))];
    const data = new Map(await Promise.all(prefixes.map(async p => [p, await this.partition(p)])));
    const scores = new Map();
    let anchorTerm = '', anchorCount = Infinity, anchorPages = [];
    for (const term of terms) {
      const list = decodeDeltas(data.get(term.slice(0, 2))[term] || [], manifest.page_books.length);
      if (!list.length) continue;
      // Most distinctive actually indexed query term, not general "war"
      // or "life". Prefer the longer term for equally frequent postings.
      if (list.length < anchorCount || (list.length === anchorCount && term.length > anchorTerm.length)) {
        anchorCount = list.length;
        anchorTerm = term;
        anchorPages = list;
      }
      const idf = Math.log1p(manifest.page_books.length / (list.length + 1));
      for (const id of list) {
        const record = scores.get(id) || {score:0, matched:0};
        record.score += idf;
        record.matched++;
        scores.set(id, record);
      }
    }
    const anchorSet = new Set(anchorPages);
    const ranked = new Map();
    for (const [pageId, score] of scores) {
      // Do not fill scarce book slots with works that only happen to
      // mention generic companion terms while omitting the topic anchor.
      if (anchorTerm && !anchorSet.has(pageId)) continue;
      const id = String(manifest.page_books[pageId]);
      if (bookId && id !== String(bookId)) continue;
      if (!manifest.books[id] || !PDF.test(manifest.books[id].drive_url || '')) continue;
      if (!ranked.has(id)) ranked.set(id, []);
      ranked.get(id).push({id:pageId, ...score});
    }
    let books = [...ranked].map(([id, hits]) => {
      hits.sort((a,b) => b.matched - a.matched || b.score - a.score || a.id - b.id);
      const titleTokens = new Set(String(manifest.books[id].title || '').toLowerCase().match(/[a-z0-9]+/g) || []);
      const overlap = terms.filter(term => titleTokens.has(term)).length;
      return {id, hits, score:hits[0].score + 3 * hits[0].matched +
        Math.log1p(hits.length) + 10 * overlap};
    });
    // If some books have joint topic terms, don't force single-term
    // incidental mentions into the limited set of cited books.
    if (books.some(book => book.hits[0].matched >= 2)) {
      books = books.filter(book => book.hits[0].matched >= 2);
    }
    books.sort((a,b) => b.score - a.score || Number(a.id) - Number(b.id));
    const sources = [];
    let booksScanned = 0, discardedNavigation = 0;
    const bookLimit = Math.max(1, Math.min(maxBooks, 3));
    const pageLimit = Math.max(1, Math.min(pagesPerBook, 3));
    // A small reserve of candidate works allows replacement of an index-
    // only book, without downloading all 644 book shards.
    for (const book of books.slice(0, Math.max(bookLimit, Math.min(6, books.length)))) {
      if (new Set(sources.map(source => source.bookId)).size >= bookLimit) break;
      const meta = manifest.books[book.id];
      const pdfId = PDF.exec(meta.drive_url)[1];
      const shard = await this.jsonGzip('book-' + book.id + '.json');
      booksScanned++;
      if (!Array.isArray(shard.pages)) throw new Error('Invalid source shard for ' + book.id);
      // Inspect multiple ranked hits; index pages must not exhaust the two
      // visible slots before we have considered the actual main text.
      const relevant = new Map(book.hits.slice(0, 60).map(hit => [hit.id, hit]));
      const candidates = [];
      for (const item of shard.pages) {
        const hit = relevant.get(item.id);
        if (!hit || !Number.isSafeInteger(item.page) || item.page <= 0 ||
            typeof item.text !== 'string' || !item.text.trim()) continue;
        const prose = pageProseScore(item.text, terms);
        if (!Number.isFinite(prose)) { discardedNavigation++; continue; }
        candidates.push({item, rank:prose + hit.score + 2 * hit.matched});
      }
      candidates.sort((a,b) => b.rank - a.rank || a.item.page - b.item.page);
      for (const {item} of candidates.slice(0, pageLimit)) {
        const url = 'https://drive.google.com/file/d/' + pdfId + '/view?usp=sharing#page=' + item.page;
        sources.push({bookId:book.id, title:meta.title, page:item.page, globalPageId:item.id,
          url, preview:previewAtWordBoundary(item.text), textLength:item.text.length});
      }
    }
    return {terms, anchorTerm, sources:sources.map((item,i) => ({id:'S'+(i+1),...item})),
      booksScanned, discardedNavigation, elapsedMs:Math.round(performance.now() - started)};
  }
}
