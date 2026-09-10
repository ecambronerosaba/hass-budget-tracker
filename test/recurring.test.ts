import test from 'node:test';
import assert from 'node:assert/strict';

import { dayOfMonthOf } from '../src/lib/dates.ts';
import { resolveRecurringFromExpense } from '../src/lib/recurring.ts';
import type { RecurringExpense } from '../src/types/models.ts';

const rec = (over: Partial<RecurringExpense>): RecurringExpense => ({
  id: 'rec_1',
  description: 'Rent',
  amount: 2000,
  category: 'housing',
  dayOfMonth: 1,
  active: true,
  ...over,
});

test('dayOfMonthOf reads the day from an ISO date', () => {
  assert.equal(dayOfMonthOf('2026-09-14'), 14);
  assert.equal(dayOfMonthOf('2026-09-01'), 1);
  assert.equal(dayOfMonthOf('2026-12-31'), 31);
});

test('dayOfMonthOf clamps junk to a usable day', () => {
  assert.equal(dayOfMonthOf('2026-09-00'), 1);
  assert.equal(dayOfMonthOf('nonsense'), 1);
});

test('resolveRecurringFromExpense creates a template when none matches', () => {
  const result = resolveRecurringFromExpense([], {
    description: '  Spotify ',
    amount: 11.99,
    category: 'fun',
    dayOfMonth: 14,
  });
  assert.deepEqual(result, {
    kind: 'create',
    template: {
      description: 'Spotify',
      amount: 11.99,
      category: 'fun',
      dayOfMonth: 14,
      active: true,
    },
  });
});

test('resolveRecurringFromExpense reuses an active template by name, case-insensitively', () => {
  const result = resolveRecurringFromExpense([rec({ id: 'rec_rent' })], {
    description: 'rent',
    amount: 2100,
    category: 'housing',
    dayOfMonth: 3,
  });
  assert.deepEqual(result, { kind: 'reuse', id: 'rec_rent' });
});

test('resolveRecurringFromExpense ignores paused templates and makes a fresh one', () => {
  const result = resolveRecurringFromExpense([rec({ id: 'rec_old', active: false })], {
    description: 'Rent',
    amount: 2000,
    category: 'housing',
    dayOfMonth: 1,
  });
  assert.equal(result.kind, 'create');
});
