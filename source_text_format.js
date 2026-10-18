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

  const api = {readableParagraphs};
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;  // Node syntax/regression checks.
  } else {
    root.ReadingSourceText = api;  // Browser, loaded before the inline UI.
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
