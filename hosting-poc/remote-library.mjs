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
export class RemoteLibrary {
  constructor(root = DEFAULT_INDEX_ROOT, fetcher = fetch) {
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
    for (const term of terms) {
      const list = decodeDeltas(data.get(term.slice(0, 2))[term] || [], manifest.page_books.length);
      const idf = Math.log1p(manifest.page_books.length / (list.length + 1));
      for (const id of list) {
        const record = scores.get(id) || {score:0, matched:0};
        record.score += idf;
        record.matched++;
        scores.set(id, record);
      }
    }
    const ranked = new Map();
    for (const [pageId, score] of scores) {
      const id = String(manifest.page_books[pageId]);
      if (bookId && id !== String(bookId)) continue;
      if (!manifest.books[id] || !PDF.test(manifest.books[id].drive_url || '')) continue;
      if (!ranked.has(id)) ranked.set(id, []);
      ranked.get(id).push({id:pageId, ...score});
    }
    const books = [...ranked].map(([id, hits]) => {
      hits.sort((a,b) => b.matched - a.matched || b.score - a.score || a.id - b.id);
      return {id, hits, score:hits[0].score + 3 * hits[0].matched + Math.log1p(hits.length)};
    }).sort((a,b) => b.score - a.score || Number(a.id) - Number(b.id));
    const sources = [];
    for (const book of books.slice(0, Math.min(maxBooks, 3))) {
      const meta = manifest.books[book.id];
      const pdfId = PDF.exec(meta.drive_url)[1];
      const shard = await this.jsonGzip('book-' + book.id + '.json');
      if (!Array.isArray(shard.pages)) throw new Error('Invalid source shard for ' + book.id);
      const sought = new Set(book.hits.slice(0, Math.min(pagesPerBook, 3)).map(hit => hit.id));
      for (const item of shard.pages) {
        if (!sought.has(item.id) || !Number.isSafeInteger(item.page) || item.page <= 0 ||
            typeof item.text !== 'string' || !item.text.trim()) continue;
        const url = 'https://drive.google.com/file/d/' + pdfId + '/view?usp=sharing#page=' + item.page;
        sources.push({bookId:book.id, title:meta.title, page:item.page, globalPageId:item.id,
          url, preview:previewAtWordBoundary(item.text), textLength:item.text.length});
        if (sources.length >= Math.min(maxBooks, 3) * Math.min(pagesPerBook, 3)) break;
      }
    }
    return {terms, sources:sources.map((item,i) => ({id:'S'+(i+1),...item})),
      booksScanned:books.length, elapsedMs:Math.round(performance.now() - started)};
  }
}
