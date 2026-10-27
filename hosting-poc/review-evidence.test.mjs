import test from 'node:test';
import assert from 'node:assert/strict';
import {verifiedEvidenceQuote,normalizedEvidenceQuote} from './review-evidence.mjs';
import {buildReviewSpans} from './review-spans.mjs';

test('verifies a long contiguous quote before reducing it to a bounded source anchor',()=>{
 const source='Opening sentence. '+('A complete source sentence supports the claim with clear detail and preserves the causal relation. '.repeat(6));
 const quote=source.slice(source.indexOf('A complete'),source.indexOf('A complete')+470);
 const checked=verifiedEvidenceQuote(quote,source);
 assert.ok(checked);
 assert.ok(checked.quote.length<=220);
 assert.ok(checked.anchorQuote.length<=320);
 assert.ok(source.includes(checked.anchorQuote));
});

test('preserves complete Hume and Kant sentences as readable anchors when reviewed spans split',()=>{
 const hume='Had not objects a regular conjunction with each other we should never have entertained any notion of cause and effect, and this regular conjunction produces that inference of the understanding which is the only connection that we can have any comprehension of.';
 const heat='And it is certain we here advance a very intelligible proposition at least, if not a true one, when we assert that, after the constant conjunction of two objects--heat and flame, for instance, weight and solidity--we are determined by custom alone to expect the one from the appearance of the other.';
 const kant='Thus, the relation of phenomena (as possible perceptions), according to which that which happens is, as to its existence, necessarily determined in time by something which antecedes, in conformity with a rule -- in other words, the relation of cause and effect -- is the condition of the objective validity of our empirical judgements in regard to the sequence of perceptions, consequently of their empirical truth, and therefore of experience.';
 const source=`${hume}\n\n${heat}\n\n${kant}`;
 const spans=buildReviewSpans('S1',source);
 assert.ok(spans.some(span=>span.text===hume),
  'the run #21 Hume statement now fits in one exact reviewed span');
 assert.ok(spans.some(span=>span.text===heat),
  'the run #21 heat-and-flame example now reaches review as one complete sentence');
 const kantSpan=spans.find(span=>span.text.includes('therefore of experience.'));
 assert.ok(kantSpan&&kantSpan.text.length<=320,
  'the long Kant sentence stays within the existing reviewer-span budget');
 const checked=verifiedEvidenceQuote(kantSpan.text,source);
 assert.ok(checked);
 assert.ok(checked.quote.length<=220,
  'the reviewer quote remains under the existing verified quote limit');
 assert.equal(checked.anchorQuote,kant,
  'the citation highlight expands only to the complete, exact source sentence');
 assert.ok(checked.anchorQuote.length<=480);
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
