/* Presentation-only reconstruction of OCR-wrapped prose for the source reader.
 *
 * Never modifies indexed book shards, stored PDF page numbers, or cited evidence.
 * Use the "Original OCR layout" control when a document's line breaks have
 * meaning (verse, tabular data, listings) or when the readable view looks odd.
 * No guesswork to rearrange columns, dehyphenate, or correct OCR words.
 */
(function (root) {
  'use strict';

  function readableParagraphs(text) {
    const original = String(text == null ? '' : text);
    const lines = original.replace(/\r\n?/g, '\n');
    return lines.split(/\n[ \t]*\n+/).map(block => {
      // Single newlines are usually PDF/OCR visual line wrapping, not prose
      // paragraph boundaries. Blank lines are retained as paragraph breaks.
      // Join using spaces, never guessing new words or changing punctuation.
      return block
        .replace(/[ \t]*\n[ \t]*/g, ' ')
        .replace(/[ \t\f\v\u00a0]+/g, ' ')
        .trim();
    }).filter(Boolean);
  }

  // Preserve character offsets in the DISPLAYED source text. Ignoring spaces
  // and punctuation makes matching robust to OCR line wrapping without
  // modifying source text or inventing any wording.
  function wordsAtOffsets(text) {
    const words = [];
    for (const match of String(text).matchAll(/[\\p{L}\\p{N}]+/gu)) {
      words.push({
        word: match[0].toLowerCase(),
        start: match.index,
        end: match.index + match[0].length,
      });
    }
    return words;
  }

  // Return a unique, contiguous source-word span, or null when the quoted
  // passage cannot be located with enough confidence. This deliberately does
  // not fuzzy-match different words, repair OCR, or highlight a generic phrase.
  // For citations that cross a physical page, a sufficiently long section of
  // the original excerpt can be matched on each contributing page.
  function locateCitedExcerpt(displayText, excerptText) {
    const page = wordsAtOffsets(displayText);
    const citation = wordsAtOffsets(excerptText);
    const SHINGLE = 8;
    if (page.length < SHINGLE || citation.length < SHINGLE) return null;

    const positions = new Map();
    for (let i = 0; i <= page.length - SHINGLE; i++) {
      const key = page.slice(i, i + SHINGLE).map(w => w.word).join(' ');
      if (!positions.has(key)) positions.set(key, []);
      // An excessively repeated phrase is ambiguous, not a good anchor.
      const occurrences = positions.get(key);
      if (occurrences.length <= 24) occurrences.push(i);
    }

    const candidates = new Map();
    for (let i = 0; i <= citation.length - SHINGLE; i++) {
      const key = citation.slice(i, i + SHINGLE).map(w => w.word).join(' ');
      const hits = positions.get(key) || [];
      if (hits.length > 24) continue;
      for (const pageAt of hits) {
        let left = pageAt, right = pageAt + SHINGLE;
        let excerptLeft = i, excerptRight = i + SHINGLE;
        while (left > 0 && excerptLeft > 0 &&
               page[left - 1].word === citation[excerptLeft - 1].word) {
          left--;
          excerptLeft--;
        }
        while (right < page.length && excerptRight < citation.length &&
               page[right].word === citation[excerptRight].word) {
          right++;
          excerptRight++;
        }
        const id = left + ':' + right;
        if (!candidates.has(id)) {
          candidates.set(id, {startWord:left, endWord:right,
                              words:right - left});
        }
      }
    }

    const ranked = [...candidates.values()].sort((a,b) =>
      b.words - a.words || a.startWord - b.startWord);
    if (!ranked.length) return null;
    const best = ranked[0];
    const start = page[best.startWord].start;
    const end = page[best.endWord - 1].end;
    // Eight ordinary words are rarely distinctive enough. Require at least
    // ten AND 60 literal displayed characters to avoid misleading emphasis.
    if (best.words < 10 || end - start < 60) return null;

    for (const other of ranked.slice(1)) {
      if (other.words < best.words * 0.9) break;
      const overlap = Math.max(0, Math.min(other.endWord, best.endWord) -
                                Math.max(other.startWord, best.startWord));
      if (overlap < Math.min(other.words, best.words) * 0.65) {
        // Equally plausible locations: do not guess which one was cited.
        return null;
      }
    }
    return {start, end, words:best.words,
            partial:best.words < citation.length};
  }

  const api = {readableParagraphs, locateCitedExcerpt};
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;  // Node syntax/regression checks.
  } else {
    root.ReadingSourceText = api;  // Browser, loaded before the inline UI.
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
