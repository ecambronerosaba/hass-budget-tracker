import test from 'node:test';
import assert from 'node:assert/strict';

import { dedupeAgainst, fingerprintOf, normalizeDescription } from '../src/lib/reconcile.ts';
import type { BankTransaction } from '../src/types/models';

/* ---------------------------- fixtures -------------------------------- */

let seq = 0;
function aTxn(patch: Partial<BankTransaction> = {}): BankTransaction {
  seq += 1;
  return {
    id: `txn_${seq}`,
    date: '2026-09-10',
    amount: 6.5,
    rawDescription: 'BLUE BOTTLE COFFEE',
    matchStatus: 'unmatched',
    ...patch,
  };
}

/* ------------------------- normalizeDescription ------------------------ */

test('punctuation collapses to single spaces and case is dropped', () => {
  assert.equal(normalizeDescription('AMZN Mktp US*1A2B3'), 'amzn mktp us 1a2b3');
  assert.equal(normalizeDescription('  SQ *BLUE--BOTTLE  '), 'sq blue bottle');
});

test('unicode letters and digits survive normalization', () => {
  assert.equal(normalizeDescription('CAFÉ Böhme #12'), 'café böhme 12');
});

/* ---------------------------- fingerprintOf ---------------------------- */

test('the same row spelled differently fingerprints the same', () => {
  const a = fingerprintOf(aTxn({ rawDescription: 'BLUE BOTTLE COFFEE #42' }));
  const b = fingerprintOf(aTxn({ rawDescription: 'blue-bottle  coffee, 42' }));
  assert.equal(a, b);
});

test('a different amount or date is a different fingerprint', () => {
  const base = fingerprintOf(aTxn());
  assert.notEqual(base, fingerprintOf(aTxn({ amount: 6.51 })));
  assert.notEqual(base, fingerprintOf(aTxn({ date: '2026-09-11' })));
});

test('amounts compare through cents, not floats', () => {
  assert.equal(fingerprintOf(aTxn({ amount: 0.1 + 0.2 })), fingerprintOf(aTxn({ amount: 0.3 })));
});

/* ---------------------------- dedupeAgainst ---------------------------- */

test('with nothing held yet everything is fresh', () => {
  const incoming = [aTxn(), aTxn({ amount: 12, rawDescription: 'LUNCH' })];
  const r = dedupeAgainst([], incoming);
  assert.deepEqual(r.fresh, incoming);
  assert.deepEqual(r.duplicates, []);
});

test('re-importing the identical file adds nothing', () => {
  const rows = [aTxn(), aTxn({ amount: 12, rawDescription: 'LUNCH' }), aTxn({ amount: 40 })];
  const r = dedupeAgainst(rows, rows);
  assert.deepEqual(r.fresh, []);
  assert.equal(r.duplicates.length, 3);
});

test('two held coffees against three incoming leaves exactly one fresh', () => {
  const coffee = () => aTxn({ amount: 6.5, rawDescription: 'BLUE BOTTLE' });
  const incoming = [coffee(), coffee(), coffee()];
  const r = dedupeAgainst([coffee(), coffee()], incoming);
  assert.equal(r.fresh.length, 1);
  assert.equal(r.duplicates.length, 2);
  assert.equal(r.fresh[0].id, incoming[2].id);
});

test('a partial overlap keeps only the new rows, in file order', () => {
  const held = aTxn({ amount: 20, rawDescription: 'GAS STATION' });
  const alsoHeld = aTxn({ amount: 9.99, rawDescription: 'STREAMING' });
  const newA = aTxn({ amount: 55, rawDescription: 'HARDWARE STORE' });
  const newB = aTxn({ amount: 4.25, rawDescription: 'BAKERY' });

  const r = dedupeAgainst(
    [held, alsoHeld],
    [newA, { ...held, id: 'txn_reimport' }, newB, { ...alsoHeld, id: 'txn_reimport2' }],
  );
  assert.deepEqual(
    r.fresh.map((t) => t.id),
    [newA.id, newB.id],
  );
  assert.deepEqual(
    r.duplicates.map((t) => t.id),
    ['txn_reimport', 'txn_reimport2'],
  );
});

test('same day and amount but a different merchant is a different charge', () => {
  const held = aTxn({ amount: 20, rawDescription: 'GAS STATION' });
  const other = aTxn({ amount: 20, rawDescription: 'PHARMACY' });
  const r = dedupeAgainst([held], [other]);
  assert.deepEqual(r.fresh, [other]);
  assert.deepEqual(r.duplicates, []);
});

test('deduping a batch that was already deduped loses a repeated charge', () => {
  // Why the import screen hands the store the whole file rather than the rows
  // its preview judged new: the first pass has already cancelled the copies the
  // session holds, so a second pass reads the genuinely repeated charge as one
  // of them and drops it. Dedupe belongs in exactly one place.
  const coffee = () => aTxn({ amount: 6.5, rawDescription: 'BLUE BOTTLE' });
  const held = [coffee(), coffee()];
  const once = dedupeAgainst(held, [coffee(), coffee(), coffee()]);
  assert.equal(once.fresh.length, 1);
  assert.equal(dedupeAgainst(held, once.fresh).fresh.length, 0);
});
