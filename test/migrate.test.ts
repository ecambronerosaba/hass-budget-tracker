import test from 'node:test';
import assert from 'node:assert/strict';

import {
  migrateBackup,
  migrateRepoData,
  needsBucketMigration,
} from '../src/lib/migrate.ts';

/** A document in the shape v1.5.0 wrote. */
function legacyDoc() {
  return {
    months: [],
    expenses: [
      {
        id: 'e1', monthId: '2026-09', date: '2026-09-03', amount: 400,
        category: 'cat_other', description: 'Japan trip fund', source: 'manual',
        reconciliationStatus: 'unreconciled', eventId: 'evt_1', eventKind: 'contribution',
        createdAt: '2026-09-03T00:00:00.000Z', updatedAt: '2026-09-03T00:00:00.000Z',
      },
      {
        id: 'e2', monthId: '2026-09', date: '2026-09-10', amount: 250,
        category: 'cat_other', description: 'Kyoto dinner', source: 'manual',
        reconciliationStatus: 'unreconciled', eventId: 'evt_1', eventKind: 'spend',
        createdAt: '2026-09-10T00:00:00.000Z', updatedAt: '2026-09-10T00:00:00.000Z',
      },
      {
        id: 'e3', monthId: '2026-09', date: '2026-09-11', amount: 30,
        category: 'cat_groceries', description: 'Milk', source: 'manual',
        reconciliationStatus: 'unreconciled',
        createdAt: '2026-09-11T00:00:00.000Z', updatedAt: '2026-09-11T00:00:00.000Z',
      },
    ],
    categories: [],
    recurring: [],
    events: [
      {
        id: 'evt_1', name: 'Japan trip', targetAmount: 3000, phase: 'saving',
        monthlyContribution: 400, category: 'cat_other',
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    sessions: [],
    settings: null,
  };
}

test('a v1.5 document is recognised as needing migration', () => {
  assert.equal(needsBucketMigration(legacyDoc()), true);
});

test('migration moves events to buckets and re-tags their expenses', () => {
  const out = migrateRepoData(legacyDoc());

  assert.equal(out.buckets.length, 1);
  assert.equal(out.buckets[0].id, 'evt_1');
  assert.equal(out.buckets[0].name, 'Japan trip');
  assert.equal(out.buckets[0].targetAmount, 3000);
  assert.equal(out.buckets[0].phase, 'saving');
  assert.equal(out.buckets[0].monthlyContribution, 400);

  const [c, s, plain] = out.expenses;
  assert.equal(c.bucketId, 'evt_1');
  assert.equal(c.bucketKind, 'contribution');
  assert.equal(s.bucketId, 'evt_1');
  assert.equal(s.bucketKind, 'spend');
  assert.equal(plain.bucketId, undefined);
  assert.equal(plain.bucketKind, undefined);

  // The old field names must not survive, or a later reader sees both.
  for (const e of out.expenses) {
    assert.equal('eventId' in e, false);
    assert.equal('eventKind' in e, false);
  }
  assert.equal('events' in out, false);
});

test('migration is idempotent', () => {
  const once = migrateRepoData(legacyDoc());
  const twice = migrateRepoData(once);
  assert.deepEqual(twice, once);
  assert.equal(needsBucketMigration(once), false);
});

test('a document already on buckets is left exactly as it was', () => {
  const modern = {
    months: [], expenses: [], categories: [], recurring: [],
    buckets: [
      {
        id: 'bkt_1', name: 'Golf clubs', targetAmount: 1200, phase: 'saving',
        monthlyContribution: 0, category: 'cat_other',
        createdAt: '2026-02-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z',
      },
    ],
    sessions: [], settings: null,
  };
  assert.equal(needsBucketMigration(modern), false);
  assert.deepEqual(migrateRepoData(modern), modern);
});

test('a document with neither key gets an empty bucket list and nothing else', () => {
  const bare = {
    months: [], expenses: [], categories: [], recurring: [], sessions: [], settings: null,
  };
  assert.equal(needsBucketMigration(bare), false);
  assert.deepEqual(migrateRepoData(bare).buckets, []);
});

test('a v2 backup restores into buckets and is stamped v3', () => {
  const backup = {
    format: 'budget-tracker-backup', version: 2,
    exportedAt: '2026-09-11T00:00:00.000Z', ...legacyDoc(),
  };
  const out = migrateBackup(backup as never);
  assert.equal(out.version, 3);
  assert.equal(out.buckets.length, 1);
  assert.equal(out.expenses[0].bucketId, 'evt_1');
  assert.equal('events' in out, false);
});
