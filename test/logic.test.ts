import test from 'node:test';
import assert from 'node:assert/strict';

import { parseAmount, round2, sumAmounts, formatMoney } from '../src/lib/money.ts';
import {
  daysBetween,
  expectedDateFor,
  monthElapsedFraction,
  monthIdOf,
  monthsBetween,
  shiftMonth,
  ordinal,
} from '../src/lib/dates.ts';
import {
  buildImportPlan,
  detectDateFormat,
  detectSignConvention,
  importTransactions,
  parseCsv,
  parseDateCell,
} from '../src/lib/csv.ts';
import { autoMatch, reconciliationTotals, suggestCandidates } from '../src/lib/reconcile.ts';
import { clampReimbursement, netAmount, sumNet } from '../src/lib/expense.ts';
import { summarizeMonth, totalsByCategory, upcomingRecurring } from '../src/lib/projection.ts';
import type {
  BankTransaction,
  Bucket,
  Expense,
  Month,
  RecurringExpense,
} from '../src/types/models';

/* ------------------------------- money -------------------------------- */

test('parseAmount handles the shapes a statement throws at it', () => {
  assert.equal(parseAmount('$1,234.50'), 1234.5);
  assert.equal(parseAmount('(12.00)'), -12);
  assert.equal(parseAmount('-4'), -4);
  assert.equal(parseAmount('1.234,56'), 1234.56);
  assert.equal(parseAmount('1 234.56'), 1234.56);
  assert.equal(parseAmount('12,50'), 12.5);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('abc'), null);
});

test('sums stay exact through cents', () => {
  assert.equal(sumAmounts([0.1, 0.2]), 0.3);
  assert.equal(round2(1.005), 1.01);
  assert.equal(formatMoney(1234.5), '$1,234.50');
  assert.equal(formatMoney(1200, { compact: true }), '$1,200');
});

/* -------------------------------- dates ------------------------------- */

test('date helpers stay on the local calendar', () => {
  assert.equal(monthIdOf('2026-09-04'), '2026-09');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(daysBetween('2026-09-01', '2026-09-08'), 7);
  assert.equal(expectedDateFor('2026-02', 31), '2026-02-28');
  assert.equal(ordinal(1), '1st');
  assert.equal(ordinal(11), '11th');
  assert.equal(ordinal(22), '22nd');
});

test('monthsBetween counts whole months in either direction', () => {
  assert.equal(monthsBetween('2026-09', '2027-03'), 6);
  assert.equal(monthsBetween('2026-09', '2026-09'), 0);
  assert.equal(monthsBetween('2027-03', '2026-09'), -6);
  assert.equal(monthsBetween('2026-12', '2027-01'), 1);
});

test('month elapsed fraction is bounded and day-based', () => {
  assert.equal(monthElapsedFraction('2026-09', '2026-09-15'), 15 / 30);
  assert.equal(monthElapsedFraction('2026-09', '2026-10-01'), 1);
  assert.equal(monthElapsedFraction('2026-09', '2026-08-31'), 0);
});

/* --------------------------------- csv -------------------------------- */

test('parses quoted CSV with embedded delimiters and newlines', () => {
  const parsed = parseCsv('date,description,amount\n2026-09-01,"Joe\'s, Inc.",42.18\n');
  assert.equal(parsed.hasHeader, true);
  assert.equal(parsed.rows.length, 1);
  assert.deepEqual(parsed.rows[0], ['2026-09-01', "Joe's, Inc.", '42.18']);
});

test('sniffs semicolon and tab delimited files', () => {
  assert.equal(parseCsv('date;description;amount\n2026-09-01;Shop;10').delimiter, ';');
  assert.equal(parseCsv('date\tdescription\tamount\n2026-09-01\tShop\t10').delimiter, '\t');
});

test('canonical format maps itself with no user input', () => {
  const plan = buildImportPlan('date,description,amount\n2026-09-01,Trader Joes,42.18\n');
  assert.equal(plan.confident, true);
  assert.equal(plan.mapping.date, 0);
  assert.equal(plan.mapping.description, 1);
  assert.equal(plan.mapping.amount, 2);
});

test('a bank export with different column names still maps by alias', () => {
  const plan = buildImportPlan(
    'Transaction Date,Posted Date,Merchant Name,Debit,Credit\n' +
      '09/01/2026,09/02/2026,TRADER JOES #482,42.18,\n',
  );
  assert.equal(plan.mapping.date, 0);
  assert.equal(plan.mapping.description, 2);
  assert.equal(plan.mapping.debit, 3);
  assert.equal(plan.mapping.credit, 4);
});

test('a headerless file is mapped by inspecting the data', () => {
  const plan = buildImportPlan('2026-09-01,Trader Joes,42.18\n2026-09-02,Metro,16.50\n');
  assert.equal(plan.hasHeader, false);
  assert.equal(plan.confident, false);
  assert.equal(plan.mapping.date, 0);
  assert.equal(plan.mapping.description, 1);
  assert.equal(plan.mapping.amount, 2);
});

test('date cells parse across formats, with order respected', () => {
  assert.equal(parseDateCell('2026-09-04', 'ymd'), '2026-09-04');
  assert.equal(parseDateCell('09/04/2026', 'mdy'), '2026-09-04');
  assert.equal(parseDateCell('04/09/2026', 'dmy'), '2026-09-04');
  assert.equal(parseDateCell('4 Sep 2026', 'text'), '2026-09-04');
  assert.equal(parseDateCell('Sep 4, 2026', 'text'), '2026-09-04');
  assert.equal(parseDateCell('20260904', 'ymd'), '2026-09-04');
  assert.equal(parseDateCell('not a date', 'ymd'), null);
  assert.equal(parseDateCell('2026-02-30', 'ymd'), null);
});

test('day-first files are detected from a day above 12', () => {
  assert.equal(detectDateFormat([['25/09/2026'], ['01/09/2026']], 0), 'dmy');
  assert.equal(detectDateFormat([['09/25/2026']], 0), 'mdy');
});

test('sign convention follows the majority of the file', () => {
  const mapping = { ...blankMapping, date: 0, description: 1, amount: 2 };
  const debits = [['2026-09-01', 'a', '-10'], ['2026-09-02', 'b', '-20'], ['2026-09-03', 'c', '5']];
  assert.equal(detectSignConvention(debits, mapping), 'negative-is-charge');
  const charges = [['2026-09-01', 'a', '10'], ['2026-09-02', 'b', '20']];
  assert.equal(detectSignConvention(charges, mapping), 'positive-is-charge');
});

test('import keeps charges, drops credits, and reports what it skipped', () => {
  const result = importTransactions(
    [
      ['2026-09-01', 'Trader Joes', '42.18'],
      ['2026-09-02', 'Refund', '-15.00'],
      ['2026-08-30', 'Last month', '9.99'],
      ['bad date', 'Broken', '5.00'],
    ],
    {
      mapping: { ...blankMapping, date: 0, description: 1, amount: 2 },
      dateFormat: 'ymd',
      signConvention: 'positive-is-charge',
      monthId: '2026-09',
    },
  );
  assert.equal(result.transactions.length, 1);
  assert.equal(result.transactions[0].amount, 42.18);
  assert.equal(result.creditsIgnored, 1);
  assert.equal(result.outsideMonth, 1);
  assert.equal(result.skipped.length, 1);
});

test('negative-is-charge files import as positive spending', () => {
  const result = importTransactions([['2026-09-01', 'Shop', '-42.18']], {
    mapping: { ...blankMapping, date: 0, description: 1, amount: 2 },
    dateFormat: 'ymd',
    signConvention: 'negative-is-charge',
  });
  assert.equal(result.transactions[0].amount, 42.18);
});

/* ----------------------------- reconciling ---------------------------- */

test('auto-match is exact on both amount and date', () => {
  const expenses = [
    expense({ id: 'e1', date: '2026-09-01', amount: 42.18 }),
    expense({ id: 'e2', date: '2026-09-02', amount: 16.5 }),
    expense({ id: 'e3', date: '2026-09-03', amount: 6.5 }),
  ];
  const txns = [
    txn({ id: 't1', date: '2026-09-01', amount: 42.18 }),
    txn({ id: 't2', date: '2026-09-03', amount: 16.5 }), // right amount, wrong day
    txn({ id: 't3', date: '2026-09-09', amount: 99 }),
  ];
  const result = autoMatch(txns, expenses);
  assert.equal(result.matchedCount, 1);
  assert.equal(result.transactions[0].matchedExpenseId, 'e1');
  assert.equal(result.unmatchedTransactions.length, 2);
  assert.deepEqual(
    result.loggedOnlyExpenses.map((e) => e.id).sort(),
    ['e2', 'e3'],
  );
});

test('two identical expenses on one day match two identical rows, not one twice', () => {
  const expenses = [
    expense({ id: 'e1', date: '2026-09-04', amount: 6.5 }),
    expense({ id: 'e2', date: '2026-09-04', amount: 6.5 }),
  ];
  const txns = [
    txn({ id: 't1', date: '2026-09-04', amount: 6.5 }),
    txn({ id: 't2', date: '2026-09-04', amount: 6.5 }),
  ];
  const result = autoMatch(txns, expenses);
  assert.equal(result.matchedCount, 2);
  assert.notEqual(result.transactions[0].matchedExpenseId, result.transactions[1].matchedExpenseId);
});

test('a stale match from a previous import is cleared', () => {
  const stale = expense({
    id: 'e1',
    date: '2026-09-01',
    amount: 10,
    reconciliationStatus: 'matched',
    matchedTransactionId: 'old',
  });
  const result = autoMatch([txn({ id: 't1', date: '2026-09-05', amount: 99 })], [stale]);
  assert.equal(result.expenses[0].reconciliationStatus, 'unreconciled');
  assert.equal(result.expenses[0].matchedTransactionId, undefined);
});

test('candidates rank by amount first, then by date distance', () => {
  const target = txn({ id: 't1', date: '2026-09-10', amount: 50 });
  const candidates = suggestCandidates(target, [
    expense({ id: 'far', date: '2026-09-25', amount: 50 }), // outside the window
    expense({ id: 'close-amount', date: '2026-09-12', amount: 50 }),
    expense({ id: 'close-date', date: '2026-09-10', amount: 46 }),
    expense({ id: 'unrelated', date: '2026-09-11', amount: 500 }),
  ]);
  assert.equal(candidates[0].expense.id, 'close-amount');
  assert.ok(candidates.every((c) => c.expense.id !== 'far'));
  assert.ok(candidates.every((c) => c.expense.id !== 'unrelated'));
});

test('verified total adds up the three ways an expense can survive review', () => {
  const totals = reconciliationTotals([
    expense({ id: 'a', amount: 10, reconciliationStatus: 'matched' }),
    // Added from a statement row, so linked to it — still counted as "added",
    // not as something that was logged and then matched.
    expense({ id: 'b', amount: 20, source: 'csv-added', reconciliationStatus: 'matched' }),
    expense({ id: 'c', amount: 5, reconciliationStatus: 'logged-only' }),
  ]);
  assert.deepEqual(totals.counts, { matched: 1, csvAdded: 1, loggedOnly: 1 });
  assert.equal(totals.verifiedTotal, 35);
  assert.equal(totals.matched, 10);
  assert.equal(totals.csvAdded, 20);
  assert.equal(totals.loggedOnly, 5);
});

/* ----------------------------- projection ----------------------------- */

test('projection extrapolates day-to-day spend and adds pending recurring in full', () => {
  const rent: RecurringExpense = {
    id: 'r1', description: 'Rent', amount: 1500, category: 'cat_bills', dayOfMonth: 1, active: true,
  };
  const summary = summarizeMonth({
    month: month({ budgetTotal: 3000 }),
    // $300 of day-to-day spend over 10 days => $900 projected for a 30-day month.
    expenses: [expense({ id: 'e1', date: '2026-09-05', amount: 300 })],
    recurring: [rent],
    now: '2026-09-10',
  });
  assert.equal(summary.spent, 300);
  assert.equal(summary.upcomingTotal, 1500);
  assert.equal(summary.projectedTotal, 2400);
  assert.equal(summary.projectedDelta, -600);
  assert.equal(summary.tone, 'good');
});

test('a confirmed recurring expense stops being counted as upcoming and stops skewing the rate', () => {
  const rent: RecurringExpense = {
    id: 'r1', description: 'Rent', amount: 1500, category: 'cat_bills', dayOfMonth: 1, active: true,
  };
  const m = month({
    budgetTotal: 3000,
    recurringExpenseConfirmations: [
      { recurringId: 'r1', status: 'confirmed', expenseId: 'e0', at: '2026-09-01T00:00:00.000Z' },
    ],
  });
  assert.equal(upcomingRecurring(m, [rent], '2026-09-10').length, 0);

  const summary = summarizeMonth({
    month: m,
    expenses: [
      expense({ id: 'e0', date: '2026-09-01', amount: 1500, source: 'recurring' }),
      expense({ id: 'e1', date: '2026-09-05', amount: 300 }),
    ],
    recurring: [rent],
    now: '2026-09-10',
  });
  assert.equal(summary.spent, 1800);
  assert.equal(summary.upcomingTotal, 0);
  // Rent is not multiplied by the daily rate: 900 extrapolated + 1500 actual.
  assert.equal(summary.projectedTotal, 2400);
});

test('trending over reads as information, not an accusation', () => {
  const summary = summarizeMonth({
    month: month({ budgetTotal: 1000 }),
    expenses: [expense({ id: 'e1', date: '2026-09-05', amount: 800 })],
    recurring: [],
    now: '2026-09-10',
  });
  assert.equal(summary.tone, 'over');
  assert.match(summary.statusLabel, /^Trending \$1,400 over$/);
  assert.doesNotMatch(summary.statusDetail, /!|overspend|too much|failed/i);
});

test('a closed month reports the final figure rather than a projection', () => {
  const summary = summarizeMonth({
    month: month({ budgetTotal: 1000, status: 'reconciled' }),
    expenses: [expense({ id: 'e1', date: '2026-09-05', amount: 1100 })],
    recurring: [],
    now: '2026-09-30',
  });
  assert.equal(summary.isFinal, true);
  assert.equal(summary.projectedTotal, 1100);
  assert.equal(summary.tone, 'over');
  assert.match(summary.statusLabel, /over/);
});

test('category totals rank by size and share sums to one', () => {
  const totals = totalsByCategory([
    expense({ id: 'a', amount: 60, category: 'cat_groceries' }),
    expense({ id: 'b', amount: 30, category: 'cat_dining' }),
    expense({ id: 'c', amount: 10, category: 'cat_dining' }),
  ]);
  assert.equal(totals[0].categoryId, 'cat_groceries');
  assert.equal(totals[1].total, 40);
  assert.equal(Math.round(totals.reduce((sum, t) => sum + t.share, 0)), 1);
});

/* ------------------------- split payments ----------------------------- */

test('net is gross minus what came back, clamped at both ends', () => {
  assert.equal(netAmount({ amount: 175, reimbursement: 150 }), 25);
  assert.equal(netAmount({ amount: 175 }), 175);
  assert.equal(netAmount({ amount: 175, reimbursement: 0 }), 175);
  // A reimbursement can never exceed the charge or go negative.
  assert.equal(clampReimbursement(175, 200), 175);
  assert.equal(clampReimbursement(175, -5), 0);
  assert.equal(netAmount({ amount: 175, reimbursement: 400 }), 0);
  assert.equal(sumNet([{ amount: 175, reimbursement: 150 }, { amount: 20 }]), 45);
});

test('a split expense costs the budget its net but matches on its gross', () => {
  const split = expense({ id: 'e1', date: '2026-09-04', amount: 175, reimbursement: 150 });
  const summary = summarizeMonth({
    month: month({ budgetTotal: 1000 }),
    expenses: [split],
    recurring: [],
    now: '2026-09-10',
  });
  assert.equal(summary.spent, 25);
  assert.equal(summary.reimbursed, 150);
  assert.equal(summary.remaining, 975);

  // The statement shows the full charge, and that is what auto-match sees.
  const result = autoMatch([txn({ id: 't1', date: '2026-09-04', amount: 175 })], [split]);
  assert.equal(result.matchedCount, 1);
  assert.equal(result.transactions[0].matchedExpenseId, 'e1');
});

test('a split expense does not match on its net amount', () => {
  const split = expense({ id: 'e1', date: '2026-09-04', amount: 175, reimbursement: 150 });
  const result = autoMatch([txn({ id: 't1', date: '2026-09-04', amount: 25 })], [split]);
  assert.equal(result.matchedCount, 0);
});

test('category shares and the verified total both use net', () => {
  const expenses = [
    expense({ id: 'a', amount: 175, reimbursement: 150, category: 'cat_dining' }),
    expense({ id: 'b', amount: 25, category: 'cat_groceries' }),
  ];
  const totals = totalsByCategory(expenses);
  assert.equal(totals.find((t) => t.categoryId === 'cat_dining')?.total, 25);
  assert.equal(totals.every((t) => t.share === 0.5), true);

  const reconciled = reconciliationTotals(
    expenses.map((e) => ({ ...e, reconciliationStatus: 'matched' as const })),
  );
  assert.equal(reconciled.verifiedTotal, 50);
  assert.equal(reconciled.reimbursed, 150);
});

test('an optional category column rides along on imported rows', () => {
  const plan = buildImportPlan(
    'date,description,amount,category,notes\n2026-09-01,Trader Joes,42.18,Groceries,weekly shop\n',
  );
  const result = importTransactions(plan.rows, {
    mapping: plan.mapping,
    dateFormat: plan.dateFormat,
    signConvention: plan.signConvention,
  });
  assert.equal(result.transactions[0].categoryHint, 'Groceries');
  assert.equal(result.transactions[0].noteHint, 'weekly shop');
});

/* ------------------------------ fixtures ------------------------------ */

const blankMapping = {
  date: -1, description: -1, amount: -1, debit: -1, credit: -1, category: -1, notes: -1,
};

function expense(partial: Partial<Expense> & { id: string }): Expense {
  return {
    monthId: '2026-09',
    date: '2026-09-01',
    amount: 10,
    category: 'cat_other',
    description: 'Something',
    source: 'manual',
    reconciliationStatus: 'unreconciled',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...partial,
  };
}

function txn(partial: Partial<BankTransaction> & { id: string }): BankTransaction {
  return {
    date: '2026-09-01',
    amount: 10,
    rawDescription: 'STATEMENT ROW',
    matchStatus: 'unmatched',
    ...partial,
  };
}

function month(partial: Partial<Month> = {}): Month {
  return {
    id: '2026-09',
    year: 2026,
    month: 9,
    budgetTotal: 1000,
    status: 'open',
    budgetHistory: [],
    recurringExpenseConfirmations: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    ...partial,
  };
}

/* ------------------- events inside a month's arithmetic ----------------- */

function monthFixture(patch: Partial<Month> = {}): Month {
  return {
    id: '2026-09',
    year: 2026,
    month: 9,
    budgetTotal: 2000,
    status: 'open',
    budgetHistory: [],
    recurringExpenseConfirmations: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    ...patch,
  };
}

let evSeq = 0;
function expenseFixture(patch: Partial<Expense> = {}): Expense {
  evSeq += 1;
  return {
    id: `e_${evSeq}`,
    monthId: '2026-09',
    date: '2026-09-05',
    amount: 100,
    category: 'cat_other',
    description: 'Thing',
    source: 'manual',
    reconciliationStatus: 'unreconciled',
    createdAt: '2026-09-05T00:00:00.000Z',
    updatedAt: '2026-09-05T00:00:00.000Z',
    ...patch,
  };
}

function bucketFixture(patch: Partial<Bucket> = {}): Bucket {
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

test('bucket spending is not part of the month it happened in', () => {
  const s = summarizeMonth({
    month: monthFixture(),
    expenses: [
      expenseFixture({ amount: 300 }),
      expenseFixture({ amount: 400, bucketId: 'evt_1', bucketKind: 'contribution' }),
      expenseFixture({ amount: 900, bucketId: 'evt_1', bucketKind: 'spend' }),
    ],
    recurring: [],
    now: '2026-09-15',
  });
  // 300 ordinary + 400 set aside. The 900 spent on the trip was budgeted when
  // it was saved, so counting it here would count it twice.
  assert.equal(s.spent, 700);
  assert.equal(s.expenseCount, 2);
  assert.equal(s.remaining, 1300);
});

test('a reimbursed bucket spend is excluded gross and net alike', () => {
  const s = summarizeMonth({
    month: monthFixture(),
    expenses: [
      expenseFixture({ amount: 200, reimbursement: 50 }),
      expenseFixture({ amount: 175, reimbursement: 150, bucketId: 'evt_1', bucketKind: 'spend' }),
    ],
    recurring: [],
    now: '2026-09-15',
  });
  assert.equal(s.spent, 150);
  assert.equal(s.reimbursed, 50);
});

test('a planned monthly set-aside shows as still expected until it is logged', () => {
  const pending = summarizeMonth({
    month: monthFixture(),
    expenses: [],
    recurring: [],
    buckets: [bucketFixture()],
    now: '2026-09-15',
  });
  assert.equal(pending.upcomingBuckets.length, 1);
  assert.equal(pending.upcomingBuckets[0].amount, 400);
  assert.equal(pending.upcomingTotal, 400);

  const done = summarizeMonth({
    month: monthFixture(),
    expenses: [expenseFixture({ amount: 400, bucketId: 'evt_1', bucketKind: 'contribution' })],
    recurring: [],
    buckets: [bucketFixture()],
    now: '2026-09-15',
  });
  assert.equal(done.upcomingBuckets.length, 0);
  assert.equal(done.upcomingTotal, 0);
});

test('a partly-funded month expects only the rest of the set-aside', () => {
  const s = summarizeMonth({
    month: monthFixture(),
    expenses: [expenseFixture({ amount: 150, bucketId: 'evt_1', bucketKind: 'contribution' })],
    recurring: [],
    buckets: [bucketFixture()],
    now: '2026-09-15',
  });
  assert.equal(s.upcomingBuckets[0].amount, 250);
});

test('only saving buckets with a plan are expected', () => {
  const s = summarizeMonth({
    month: monthFixture(),
    expenses: [],
    recurring: [],
    buckets: [
      bucketFixture({ id: 'a', phase: 'spending' }),
      bucketFixture({ id: 'b', phase: 'closed' }),
      bucketFixture({ id: 'c', monthlyContribution: 0 }),
    ],
    now: '2026-09-15',
  });
  assert.equal(s.upcomingBuckets.length, 0);
});
