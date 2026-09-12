import test from 'node:test';
import assert from 'node:assert/strict';

import {
  countsAgainstMonth,
  isContribution,
  isEventSpend,
  summarizeEvent,
} from '../src/lib/event.ts';
import type { BudgetEvent, Expense } from '../src/types/models';

test('only event spending is kept out of a month', () => {
  assert.equal(countsAgainstMonth({}), true);
  assert.equal(countsAgainstMonth({ eventKind: undefined }), true);
  assert.equal(countsAgainstMonth({ eventKind: 'contribution' }), true);
  assert.equal(countsAgainstMonth({ eventKind: 'spend' }), false);
});

test('the two event roles are told apart', () => {
  assert.equal(isContribution({ eventKind: 'contribution' }), true);
  assert.equal(isContribution({ eventKind: 'spend' }), false);
  assert.equal(isContribution({}), false);
  assert.equal(isEventSpend({ eventKind: 'spend' }), true);
  assert.equal(isEventSpend({ eventKind: 'contribution' }), false);
  assert.equal(isEventSpend({}), false);
});

/* ---------------------------- fixtures -------------------------------- */

function anEvent(patch: Partial<BudgetEvent> = {}): BudgetEvent {
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
    eventId: 'evt_1',
    ...patch,
  };
}

/* -------------------------- summarizeEvent ---------------------------- */

test('saved and spent are net of splits and exact through cents', () => {
  const s = summarizeEvent({
    event: anEvent(),
    expenses: [
      anExpense({ eventKind: 'contribution', amount: 0.1 }),
      anExpense({ eventKind: 'contribution', amount: 0.2 }),
      anExpense({ eventKind: 'spend', amount: 175, reimbursement: 150 }),
    ],
    now: '2026-09-15',
  });
  assert.equal(s.saved, 0.3);
  assert.equal(s.spent, 25);
  assert.equal(s.contributionCount, 2);
  assert.equal(s.spendCount, 1);
});

test('the fund balance and the unfunded amount are two sides of one number', () => {
  const under = summarizeEvent({
    event: anEvent({ phase: 'spending' }),
    expenses: [
      anExpense({ eventKind: 'contribution', amount: 1000 }),
      anExpense({ eventKind: 'spend', amount: 180 }),
    ],
    now: '2026-09-15',
  });
  assert.equal(under.fundRemaining, 820);
  assert.equal(under.unfunded, 0);
  assert.equal(under.tone, 'good');
  assert.equal(under.statusLabel, '$820.00 left in the fund');

  const over = summarizeEvent({
    event: anEvent({ phase: 'spending' }),
    expenses: [
      anExpense({ eventKind: 'contribution', amount: 100 }),
      anExpense({ eventKind: 'spend', amount: 240 }),
    ],
    now: '2026-09-15',
  });
  assert.equal(over.fundRemaining, -140);
  assert.equal(over.unfunded, 140);
  assert.equal(over.tone, 'over');
  assert.equal(over.statusLabel, '$140.00 past the fund');
});

test('targetRemaining floors at zero and a met target reads as funded', () => {
  const s = summarizeEvent({
    event: anEvent({ targetAmount: 500 }),
    expenses: [anExpense({ eventKind: 'contribution', amount: 800 })],
    now: '2026-09-15',
  });
  assert.equal(s.targetRemaining, 0);
  assert.equal(s.tone, 'good');
  assert.equal(s.statusLabel, 'Fully funded');
});

test('a saving event whose start date has passed reports the shortfall', () => {
  const s = summarizeEvent({
    event: anEvent({ targetAmount: 1000, startDate: '2026-08-01' }),
    expenses: [anExpense({ eventKind: 'contribution', amount: 760 })],
    now: '2026-09-15',
  });
  assert.equal(s.tone, 'over');
  assert.equal(s.statusLabel, '$240.00 short');
});

test('a saving event still ahead of its date states what is left', () => {
  const s = summarizeEvent({
    event: anEvent({ targetAmount: 3000, startDate: '2027-03-01' }),
    expenses: [anExpense({ eventKind: 'contribution', amount: 600 })],
    now: '2026-09-15',
  });
  assert.equal(s.tone, 'info');
  assert.equal(s.statusLabel, '$2,400.00 to go');
  assert.equal(s.monthsToStart, 6);
  assert.equal(s.perMonthNeeded, 400);
});

test('with no start date there is no pace to state', () => {
  const s = summarizeEvent({
    event: anEvent({ targetAmount: 1000 }),
    expenses: [],
    now: '2026-09-15',
  });
  assert.equal(s.monthsToStart, undefined);
  assert.equal(s.perMonthNeeded, undefined);
});

test('fractionSpent falls back to the target when nothing is saved yet', () => {
  const s = summarizeEvent({
    event: anEvent({ targetAmount: 400, phase: 'spending' }),
    expenses: [anExpense({ eventKind: 'spend', amount: 100 })],
    now: '2026-09-15',
  });
  assert.equal(s.fractionSpent, 0.25);
});

test('contributedThisMonth only counts the month being asked about', () => {
  const s = summarizeEvent({
    event: anEvent(),
    expenses: [
      anExpense({ eventKind: 'contribution', amount: 400, monthId: '2026-08', date: '2026-08-03' }),
      anExpense({ eventKind: 'contribution', amount: 250, monthId: '2026-09', date: '2026-09-03' }),
    ],
    now: '2026-09-15',
  });
  assert.equal(s.contributedThisMonth, 250);
});

test('a closed event describes the result rather than a plan', () => {
  const s = summarizeEvent({
    event: anEvent({ phase: 'closed', targetAmount: 1000 }),
    expenses: [
      anExpense({ eventKind: 'contribution', amount: 1000 }),
      anExpense({ eventKind: 'spend', amount: 900 }),
    ],
    now: '2026-09-15',
  });
  assert.equal(s.tone, 'good');
  assert.equal(s.statusLabel, '$100.00 under the fund');
});
