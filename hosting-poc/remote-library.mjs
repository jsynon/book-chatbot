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
// Edition metadata can contain topical keywords, but it is not evidence
// about the work's subject. Preserve the page and link in the corpus; just
// exclude it from a substantive-evidence preview.
export function isPublicationPage(text) {
  const head = String(text || '').slice(0, 1500);
  return /\b(?:copyright|all rights reserved|may not be reproduced)\b/i.test(head) &&
    /\b(?:copyright|all rights reserved|protected by international copyright|may not be reproduced)\b/i.test(head);
}
// Limited morphology, not a semantic thesaurus: e.g. cause/causes/caused.
// Preserve proper-name stems; no question- or book-specific exception lists.
function wordStem(word) {
  let w = String(word || '').toLowerCase();
  if (w.length < 5) return w;
  if (w.length > 5 && /(ing|ed|es)$/.test(w)) {
    w = w.replace(/(ing|ed|es)$/, '');
  } else if (w.length > 5 && w.endsWith('s')) {
    w = w.slice(0, -1);
  }
  if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
}
export function substantivePageEvidence(text, terms) {
  if (isNavigationPage(text) || isPublicationPage(text)) return null;
  const words = String(text || '').toLowerCase().match(/[a-z0-9]+/g) || [];
  if (words.length < 10) return null;
  const roots = [...new Set(terms.map(wordStem))];
  const wanted = new Set(roots);
  let hits = 0, best = {score:0, center:0}, unique = new Set();
  const normalized = words.map(wordStem);
  for (let i = 0; i < normalized.length; i++) {
    if (wanted.has(normalized[i])) { unique.add(normalized[i]); hits++; }
  }
  if (!hits) return null;
  // Find the most locally concentrated part of the actual page. An isolated
  // occurrence in a page heading should not dominate a full prose argument.
  // The small number of query terms keeps this inexpensive on large books.
  for (let i = 0; i < normalized.length; i += 30) {
    const window = normalized.slice(i, i + 110);
    const present = new Set(window.filter(word => wanted.has(word)));
    const matched = window.filter(word => wanted.has(word)).length;
    const score = 9 * present.size + Math.min(8, matched);
    if (score > best.score) best = {score, center:Math.min(words.length-1, i+55)};
  }
  let score = best.score + 6 * unique.size + Math.min(5, Math.log1p(hits));
  const opening = String(text).trim().slice(0, 180);
  if (/^(?:(?:\d+|[ivxlc]+)\s+)?(?:introduction|preface|foreword|acknowledg(?:e)?ments)\b/i.test(opening)) {
    score -= 12; // A preference, not a ban; introductions can contain arguments.
  }
  return {score, unique:unique.size, center:best.center};
}
export function excerptAroundEvidence(text, terms, max = 1080) {
  const compact = String(text || '').replace(/\s+/g, ' ').trim();
  if (compact.length <= max) return compact;
  const roots = new Set(terms.map(wordStem));
  const matches = [...compact.matchAll(/[a-z0-9]+/gi)];
  let bestStart=0, bestScore=-1;
  // Keep enough continuous prose after a question-matching passage for the
  // author's explanation to finish. A short keyword-window can cut off the
  // very next sentence (the reason for a claim) before the model sees it.
  for (let i=0;i<matches.length;i+=12) {
    const start = matches[i].index;
    const end = Math.min(compact.length, start+max);
    const snippet = compact.slice(start,end);
    const present = new Set((snippet.toLowerCase().match(/[a-z0-9]+/g)||[])
      .map(wordStem).filter(word=>roots.has(word)));
    const score = 5 * present.size + (snippet.match(/[.!?]\s/g)||[]).length;
    if (score>bestScore) {bestScore=score;bestStart=start;}
  }
  if (!bestStart) return previewAtWordBoundary(compact,max);
  let end=Math.min(compact.length,bestStart+max);
  const lastSpace=compact.lastIndexOf(' ',end);
  if(lastSpace>bestStart+max/2)end=lastSpace;
  return '…'+compact.slice(bestStart,end).trim()+(end<compact.length?'…':'');
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
  async search(question, {bookId = '', allowedBookIds = null, maxBooks = 2, pagesPerBook = 2} = {}) {
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
      if (allowedBookIds && !allowedBookIds.has(id)) continue;
      if (!manifest.books[id] || !PDF.test(manifest.books[id].drive_url || '')) continue;
      if (!ranked.has(id)) ranked.set(id, []);
      ranked.get(id).push({id:pageId, ...score});
    }
    let books = [...ranked].map(([id, hits]) => {
      hits.sort((a,b) => b.matched - a.matched || b.score - a.score || a.id - b.id);
      const titleTokens = new Set(String(manifest.books[id].title || '').toLowerCase().match(/[a-z0-9]+/g) || []);
      const overlap = terms.filter(term => titleTokens.has(term)).length;
      return {id, hits, titleOverlap:overlap, score:hits[0].score + 3 * hits[0].matched +
        Math.log1p(hits.length) + 12 * overlap};
    });
    // If some books have joint topic terms, don't force single-term
    // incidental mentions into the limited set of cited books.
    if (books.some(book => book.hits[0].matched >= 2)) {
      books = books.filter(book => book.hits[0].matched >= 2);
    }
    books.sort((a,b) => b.score - a.score || Number(a.id) - Number(b.id));
    // A query that strongly matches a work's own title should not spend
    // its small evidence budget on a tangential survey, unless readers are
    // explicitly asking for a comparison across authors or works.
    const comparison = /\b(?:compare|contrast|versus|vs\.?|between)\b/i.test(question);
    const directWorks = books.filter(book => book.titleOverlap >= 2);
    if (!bookId && !comparison && directWorks.length && directWorks.length <= Math.max(1,Math.min(maxBooks,3))) {
      books = directWorks;
    }
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
      // The book shard is already downloaded. Inspect its entire indexed
      // main text, not just the first sixty lexical hits; morphological
      // variants and contextual discussion may lie outside that shortlist.
      const relevant = new Map(book.hits.map(hit => [hit.id, hit]));
      const candidates = [], proseByPage = new Map();
      for (const item of shard.pages) {
        if (!Number.isSafeInteger(item.id) || String(manifest.page_books[item.id]) !== book.id ||
            !Number.isSafeInteger(item.page) || item.page <= 0 ||
            typeof item.text !== 'string' || !item.text.trim()) continue;
        if (isNavigationPage(item.text) || isPublicationPage(item.text)) {
          discardedNavigation++; continue;
        }
        if ((item.text.match(/[a-z]+/gi) || []).length >= 10 &&
            !proseByPage.has(item.page)) proseByPage.set(item.page, item);
        const evidence = substantivePageEvidence(item.text, terms);
        if (!evidence) continue;
        const hit = relevant.get(item.id);
        candidates.push({item, rank:evidence.score + (hit ? Math.min(8,hit.score) : 0)});
      }
      candidates.sort((a,b) => b.rank - a.rank || a.item.page - b.item.page);
      // When given a third page of budget, prefer the continuation of the
      // strongest match to an unrelated distant keyword hit. This is generic
      // paragraph continuity, not a book- or question-specific rule. Preserve
      // the two best direct matches for relevance and source diversity.
      const selected = candidates.slice(0, Math.min(pageLimit, 2));
      if (pageLimit >= 3 && selected.length) {
        const topPage = selected[0].item.page;
        for (const adjacent of [topPage + 1, topPage - 1]) {
          const item = proseByPage.get(adjacent);
          if (item && !selected.some(entry => entry.item.page === item.page)) {
            selected.push({item, rank:0, contextual:true});
            break;
          }
        }
      }
      for (const entry of candidates) {
        if (selected.length >= pageLimit) break;
        if (!selected.some(existing => existing.item.id === entry.item.id)) selected.push(entry);
      }
      for (const {item} of selected) {
        const url = 'https://drive.google.com/file/d/' + pdfId + '/view?usp=sharing#page=' + item.page;
        sources.push({bookId:book.id, title:meta.title, page:item.page, globalPageId:item.id,
          url, preview:excerptAroundEvidence(item.text,terms), textLength:item.text.length});
      }
    }
    return {terms, anchorTerm, sources:sources.map((item,i) => ({id:'S'+(i+1),...item})),
      booksScanned, discardedNavigation, elapsedMs:Math.round(performance.now() - started)};
  }
}
