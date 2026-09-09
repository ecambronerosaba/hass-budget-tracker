/**
 * Reconciliation logic (PRD §4.5, §4.6).
 *
 * Auto-matching is deliberately strict: exact amount and exact date, one
 * expense per transaction. Anything looser belongs in the review flow, where
 * the user sees the proposal and decides — the app never quietly links two
 * things that only nearly agree.
 */

import type { BankTransaction, Expense } from '../types/models';
import { daysBetween } from './dates';
import { sumGross, sumNet } from './expense';
import { round2, sameAmount, toCents } from './money';

export interface AutoMatchResult {
  transactions: BankTransaction[];
  expenses: Expense[];
  matchedCount: number;
  unmatchedTransactions: BankTransaction[];
  loggedOnlyExpenses: Expense[];
}

/**
 * Exact amount + exact date, greedy and one-to-one. Ties (two identical $6.50
 * coffees on the same day) resolve in list order, which is correct either way:
 * the pairing is arbitrary but the totals are not.
 */
export function autoMatch(
  transactions: BankTransaction[],
  expenses: Expense[],
): AutoMatchResult {
  const byKey = new Map<string, Expense[]>();
  for (const expense of expenses) {
    const key = matchKey(expense.date, expense.amount);
    const bucket = byKey.get(key);
    if (bucket) bucket.push(expense);
    else byKey.set(key, [expense]);
  }

  const matchedExpenseIds = new Set<string>();
  const nextTransactions = transactions.map((txn) => {
    const bucket = byKey.get(matchKey(txn.date, txn.amount));
    const candidate = bucket?.find((e) => !matchedExpenseIds.has(e.id));
    if (!candidate) {
      return { ...txn, matchStatus: 'unmatched' as const, matchedExpenseId: undefined };
    }
    matchedExpenseIds.add(candidate.id);
    return { ...txn, matchStatus: 'matched' as const, matchedExpenseId: candidate.id };
  });

  const nextExpenses = expenses.map((expense) => {
    if (!matchedExpenseIds.has(expense.id)) {
      // Reset any stale link from a previous import of the same month.
      return expense.reconciliationStatus === 'matched'
        ? { ...expense, reconciliationStatus: 'unreconciled' as const, matchedTransactionId: undefined }
        : expense;
    }
    const txn = nextTransactions.find((t) => t.matchedExpenseId === expense.id);
    return {
      ...expense,
      reconciliationStatus: 'matched' as const,
      matchedTransactionId: txn?.id,
    };
  });

  return {
    transactions: nextTransactions,
    expenses: nextExpenses,
    matchedCount: matchedExpenseIds.size,
    unmatchedTransactions: nextTransactions.filter((t) => t.matchStatus === 'unmatched'),
    loggedOnlyExpenses: nextExpenses.filter((e) => !matchedExpenseIds.has(e.id)),
  };
}

function matchKey(date: string, amount: number): string {
  return `${date}|${toCents(amount)}`;
}

export interface Candidate {
  expense: Expense;
  /** 0–1; higher is a closer resemblance. */
  score: number;
  reason: string;
}

const DAY_WINDOW = 7;

/**
 * The suggestion shown behind the "this matches something I logged" swipe
 * (§4.6, §8). A proposal only — the user confirms it before anything links.
 * Ranked by amount agreement first, then by how close the dates are.
 */
export function suggestCandidates(
  txn: BankTransaction,
  expenses: Expense[],
  limit = 3,
): Candidate[] {
  const txnCents = toCents(txn.amount);
  return expenses
    .map((expense) => {
      const dayGap = Math.abs(daysBetween(txn.date, expense.date));
      const centsGap = Math.abs(toCents(expense.amount) - txnCents);
      const relativeGap = txnCents > 0 ? centsGap / txnCents : 1;
      if (dayGap > DAY_WINDOW || relativeGap > 0.2) return null;

      const amountScore = 1 - Math.min(1, relativeGap / 0.2);
      const dateScore = 1 - dayGap / (DAY_WINDOW + 1);
      const score = amountScore * 0.7 + dateScore * 0.3;

      let reason: string;
      if (centsGap === 0 && dayGap === 0) reason = 'Same amount, same day';
      else if (centsGap === 0) reason = `Same amount, ${dayLabel(dayGap)} apart`;
      else if (dayGap === 0) reason = 'Same day, amount differs';
      else reason = `${dayLabel(dayGap)} apart, amount differs`;

      return { expense, score, reason } satisfies Candidate;
    })
    .filter((c): c is Candidate => c !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function dayLabel(days: number): string {
  return days === 1 ? '1 day' : `${days} days`;
}

export interface ReconciliationTotals {
  matched: number;
  csvAdded: number;
  loggedOnly: number;
  /** Net of reimbursements — the figure that goes against the budget. */
  verifiedTotal: number;
  /** How much of the month's gross charges came back from someone else. */
  reimbursed: number;
  counts: { matched: number; csvAdded: number; loggedOnly: number };
}

/** The final verified figure once both queues are clear (§4.6). */
export function reconciliationTotals(expenses: Expense[]): ReconciliationTotals {
  // Source wins over status here: an expense created from a statement row is
  // linked to it and so is technically "matched", but for the user it belongs
  // in the "things I hadn't logged" bucket, which is the interesting number.
  const csvAdded = expenses.filter((e) => e.source === 'csv-added');
  const matched = expenses.filter(
    (e) => e.source !== 'csv-added' && e.reconciliationStatus === 'matched',
  );
  const loggedOnly = expenses.filter(
    (e) => e.source !== 'csv-added' && e.reconciliationStatus !== 'matched',
  );
  // Net, like every other budget figure — the verified total is what the month
  // cost, not what passed through the account.
  return {
    matched: sumNet(matched),
    csvAdded: sumNet(csvAdded),
    loggedOnly: sumNet(loggedOnly),
    verifiedTotal: sumNet(expenses),
    reimbursed: round2(sumGross(expenses) - sumNet(expenses)),
    counts: {
      matched: matched.length,
      csvAdded: csvAdded.length,
      loggedOnly: loggedOnly.length,
    },
  };
}

/** True when the imported row and the logged expense agree exactly. */
export function isExactPair(txn: BankTransaction, expense: Expense): boolean {
  return txn.date === expense.date && sameAmount(txn.amount, expense.amount);
}
