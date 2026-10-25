import test from 'node:test';
import assert from 'node:assert/strict';
import {verifiedEvidenceQuote,normalizedEvidenceQuote} from './review-evidence.mjs';

test('verifies a long contiguous quote before reducing it to a bounded source anchor',()=>{
 const source='Opening sentence. '+('A complete source sentence supports the claim with clear detail and preserves the causal relation. '.repeat(6));
 const quote=source.slice(source.indexOf('A complete'),source.indexOf('A complete')+470);
 const checked=verifiedEvidenceQuote(quote,source);
 assert.ok(checked);
 assert.ok(checked.quote.length<=220);
 assert.ok(checked.anchorQuote.length<=320);
 assert.ok(source.includes(checked.anchorQuote));
});

test('matches known OCR ligature substitutions without changing the displayed source anchor',()=>{
 const source='James says faith is jusƟﬁed by works, and the page gives this as an example.';
 const checked=verifiedEvidenceQuote('James says faith is justified by works, and the page gives this as an example.',source);
 assert.ok(checked);
 assert.match(checked.anchorQuote,/jusƟﬁed/);
 assert.equal(normalizedEvidenceQuote('justified'),normalizedEvidenceQuote('jusƟﬁed'));
});

test('rejects altered, non-contiguous, too-short, and over-limit reviewer quotes',()=>{
 const source='A source passage states that the result follows from the stated cause and its conditions.';
 assert.equal(verifiedEvidenceQuote('This altered quote does not appear in the source.',source),null);
 assert.equal(verifiedEvidenceQuote('A source passage ... its conditions.',source),null);
 assert.equal(verifiedEvidenceQuote('short quote',source),null);
 assert.equal(verifiedEvidenceQuote(source.repeat(30),source),null);
});
