import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bucketForDate,
  countsAgainstMonth,
  isBucketSpend,
  isContribution,
  summarizeBucket,
} from '../src/lib/bucket.ts';
import type { Bucket, Expense } from '../src/types/models';

test('only bucket spending is kept out of a month', () => {
  assert.equal(countsAgainstMonth({}), true);
  assert.equal(countsAgainstMonth({ bucketKind: undefined }), true);
  assert.equal(countsAgainstMonth({ bucketKind: 'contribution' }), true);
  assert.equal(countsAgainstMonth({ bucketKind: 'spend' }), false);
});

test('the two bucket roles are told apart', () => {
  assert.equal(isContribution({ bucketKind: 'contribution' }), true);
  assert.equal(isContribution({ bucketKind: 'spend' }), false);
  assert.equal(isContribution({}), false);
  assert.equal(isBucketSpend({ bucketKind: 'spend' }), true);
  assert.equal(isBucketSpend({ bucketKind: 'contribution' }), false);
  assert.equal(isBucketSpend({}), false);
});

/* ---------------------------- fixtures -------------------------------- */

function aBucket(patch: Partial<Bucket> = {}): Bucket {
  return {
    id: 'evt_1',
    name: 'Japan trip',
    targetAmount: 3000,
    phase: 'saving',
    monthlyContribution: 400,
    category: 'cat_other',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  };
}

let seq = 0;
function anExpense(patch: Partial<Expense> = {}): Expense {
  seq += 1;
  return {
    id: `exp_${seq}`,
    monthId: '2026-09',
    date: '2026-09-10',
    amount: 100,
    category: 'cat_other',
    description: 'Something',
    source: 'manual',
    reconciliationStatus: 'unreconciled',
    createdAt: '2026-09-10T00:00:00.000Z',
    updatedAt: '2026-09-10T00:00:00.000Z',
    bucketId: 'evt_1',
    ...patch,
  };
}

/* -------------------------- summarizeBucket ---------------------------- */

test('saved and spent are net of splits and exact through cents', () => {
  const s = summarizeBucket({
    bucket: aBucket(),
    expenses: [
      anExpense({ bucketKind: 'contribution', amount: 0.1 }),
      anExpense({ bucketKind: 'contribution', amount: 0.2 }),
      anExpense({ bucketKind: 'spend', amount: 175, reimbursement: 150 }),
    ],
    now: '2026-09-15',
  });
  assert.equal(s.saved, 0.3);
  assert.equal(s.spent, 25);
  assert.equal(s.contributionCount, 2);
  assert.equal(s.spendCount, 1);
});

test('the fund balance and the unfunded amount are two sides of one number', () => {
  const under = summarizeBucket({
    bucket: aBucket({ phase: 'spending' }),
    expenses: [
      anExpense({ bucketKind: 'contribution', amount: 1000 }),
      anExpense({ bucketKind: 'spend', amount: 180 }),
    ],
    now: '2026-09-15',
  });
  assert.equal(under.fundRemaining, 820);
  assert.equal(under.unfunded, 0);
  assert.equal(under.tone, 'good');
  assert.equal(under.statusLabel, '$820.00 left in the fund');

  const over = summarizeBucket({
    bucket: aBucket({ phase: 'spending' }),
    expenses: [
      anExpense({ bucketKind: 'contribution', amount: 100 }),
      anExpense({ bucketKind: 'spend', amount: 240 }),
    ],
    now: '2026-09-15',
  });
  assert.equal(over.fundRemaining, -140);
  assert.equal(over.unfunded, 140);
  assert.equal(over.tone, 'over');
  assert.equal(over.statusLabel, '$140.00 past the fund');
});

test('targetRemaining floors at zero and a met target reads as funded', () => {
  const s = summarizeBucket({
    bucket: aBucket({ targetAmount: 500 }),
    expenses: [anExpense({ bucketKind: 'contribution', amount: 800 })],
    now: '2026-09-15',
  });
  assert.equal(s.targetRemaining, 0);
  assert.equal(s.tone, 'good');
  assert.equal(s.statusLabel, 'Fully funded');
});

test('a saving bucket whose start date has passed reports the shortfall', () => {
  const s = summarizeBucket({
    bucket: aBucket({ targetAmount: 1000, startDate: '2026-08-01' }),
    expenses: [anExpense({ bucketKind: 'contribution', amount: 760 })],
    now: '2026-09-15',
  });
  assert.equal(s.tone, 'over');
  assert.equal(s.statusLabel, '$240.00 short');
});

test('a saving bucket still ahead of its date states what is left', () => {
  const s = summarizeBucket({
    bucket: aBucket({ targetAmount: 3000, startDate: '2027-03-01' }),
    expenses: [anExpense({ bucketKind: 'contribution', amount: 600 })],
    now: '2026-09-15',
  });
  assert.equal(s.tone, 'info');
  assert.equal(s.statusLabel, '$2,400.00 to go');
  assert.equal(s.monthsToStart, 6);
  assert.equal(s.perMonthNeeded, 400);
});

test('with no start date there is no pace to state', () => {
  const s = summarizeBucket({
    bucket: aBucket({ targetAmount: 1000 }),
    expenses: [],
    now: '2026-09-15',
  });
  assert.equal(s.monthsToStart, undefined);
  assert.equal(s.perMonthNeeded, undefined);
});

test('fractionSpent falls back to the target when nothing is saved yet', () => {
  const s = summarizeBucket({
    bucket: aBucket({ targetAmount: 400, phase: 'spending' }),
    expenses: [anExpense({ bucketKind: 'spend', amount: 100 })],
    now: '2026-09-15',
  });
  assert.equal(s.fractionSpent, 0.25);
});

test('contributedThisMonth only counts the month being asked about', () => {
  const s = summarizeBucket({
    bucket: aBucket(),
    expenses: [
      anExpense({ bucketKind: 'contribution', amount: 400, monthId: '2026-08', date: '2026-08-03' }),
      anExpense({ bucketKind: 'contribution', amount: 250, monthId: '2026-09', date: '2026-09-03' }),
    ],
    now: '2026-09-15',
  });
  assert.equal(s.contributedThisMonth, 250);
});

test('a closed bucket describes the result rather than a plan', () => {
  const s = summarizeBucket({
    bucket: aBucket({ phase: 'closed', targetAmount: 1000 }),
    expenses: [
      anExpense({ bucketKind: 'contribution', amount: 1000 }),
      anExpense({ bucketKind: 'spend', amount: 900 }),
    ],
    now: '2026-09-15',
  });
  assert.equal(s.tone, 'good');
  assert.equal(s.statusLabel, '$100.00 under the fund');
});

/* ---------------------------- bucketForDate --------------------------- */

function dated(patch: Partial<Bucket> = {}): Bucket {
  return aBucket({
    startDate: '2027-03-01',
    endDate: '2027-03-14',
    phase: 'spending',
    ...patch,
  });
}

test('a date inside the range claims the bucket, inclusive at both ends', () => {
  const b = dated();
  assert.equal(bucketForDate('2027-03-01', [b])?.id, b.id);
  assert.equal(bucketForDate('2027-03-07', [b])?.id, b.id);
  assert.equal(bucketForDate('2027-03-14', [b])?.id, b.id);
});

test('a date outside the range claims nothing', () => {
  const b = dated();
  assert.equal(bucketForDate('2027-02-28', [b]), null);
  assert.equal(bucketForDate('2027-03-15', [b]), null);
});

test('a bucket needs both ends of a range to claim anything', () => {
  assert.equal(bucketForDate('2027-03-07', [dated({ endDate: undefined })]), null);
  assert.equal(bucketForDate('2027-03-07', [dated({ startDate: undefined })]), null);
  assert.equal(
    bucketForDate('2027-03-07', [dated({ startDate: undefined, endDate: undefined })]),
    null,
  );
});

test('a closed bucket never claims a date', () => {
  assert.equal(bucketForDate('2027-03-07', [dated({ phase: 'closed' })]), null);
});

test('spending beats saving when both ranges contain the date', () => {
  const saving = dated({ id: 'a', phase: 'saving' });
  const spending = dated({ id: 'b', phase: 'spending' });
  assert.equal(bucketForDate('2027-03-07', [saving, spending])?.id, 'b');
});

test('the narrower range wins between two buckets in the same phase', () => {
  const wide = dated({ id: 'wide', startDate: '2027-01-01', endDate: '2027-12-31' });
  const tight = dated({ id: 'tight', startDate: '2027-03-05', endDate: '2027-03-09' });
  assert.equal(bucketForDate('2027-03-07', [wide, tight])?.id, 'tight');
});

test('the newer bucket wins when phase and span tie', () => {
  const older = dated({ id: 'older', createdAt: '2026-01-01T00:00:00.000Z' });
  const newer = dated({ id: 'newer', createdAt: '2026-06-01T00:00:00.000Z' });
  assert.equal(bucketForDate('2027-03-07', [older, newer])?.id, 'newer');
});

test('no buckets at all is null, not a throw', () => {
  assert.equal(bucketForDate('2027-03-07', []), null);
});
