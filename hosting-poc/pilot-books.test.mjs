import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PILOT_BOOKS} from './pilot-books.mjs';

// Audit fix W6 (2026-11-15): the pilot catalog is generated from the
// live library-data v49 manifest (scripts/refresh-pilot-books.mjs).
// These invariants are the in-suite tripwire: if the library is
// republished, the count assertion fails and the refresh script is
// the fix — never hand-edit the catalog back into a frozen snapshot.
test('pilot catalog matches the v49 manifest shape and carries no placeholders', () => {
  const ids = Object.keys(PILOT_BOOKS);
  assert.equal(ids.length, 646,
    'catalog size drifted from the v49 manifest (646 books, 2026-11-15); run node scripts/refresh-pilot-books.mjs');
  for (const id of ids) {
    assert.match(id, /^[1-9]\d*$/, 'book ids are positive integers');
    assert.equal(typeof PILOT_BOOKS[id], 'string');
    assert.ok(PILOT_BOOKS[id].length > 0, 'every book has a title');
    assert.doesNotMatch(PILOT_BOOKS[id], /title and author unverified/i,
      'placeholder bylines must never re-enter the catalog');
  }
  // The three books the frozen snapshot had drifted on (audit B9):
  // 1 and 628 were missing entirely; 332 carried a placeholder.
  assert.equal(PILOT_BOOKS['1'], 'Unrecognised Facts about Modern Psychiatric Practice');
  assert.equal(PILOT_BOOKS['332'], 'The Life and Times of Martin Luther — W. Carlos Martyn');
  assert.equal(PILOT_BOOKS['628'], 'The Natural History of Pliny, Volume III — Pliny the Elder');
});
