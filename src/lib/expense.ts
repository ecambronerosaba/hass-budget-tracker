/**
 * Gross vs net.
 *
 * An expense carries two figures. `amount` is what left the account — the
 * number the statement shows, and therefore the only number reconciliation is
 * allowed to match on. `reimbursement` is the part someone else covered. Every
 * budget figure in the app — remaining, pace, projection, category shares, the
 * verified month total — is built from the net of the two, because that is
 * what the month actually cost the user.
 *
 * Keeping both means a $175 dinner still matches a $175 statement row while
 * only $25 of it counts against the budget.
 */

import type { Expense } from '../types/models';
import { fromCents, round2, toCents } from './money.ts';

export function reimbursementOf(expense: Pick<Expense, 'reimbursement'>): number {
  return round2(Math.max(0, expense.reimbursement ?? 0));
}

/** What this expense actually cost: gross minus whatever came back. */
export function netAmount(expense: Pick<Expense, 'amount' | 'reimbursement'>): number {
  return round2(Math.max(0, expense.amount - reimbursementOf(expense)));
}

export function isSplit(expense: Pick<Expense, 'reimbursement'>): boolean {
  return reimbursementOf(expense) > 0;
}

/** Sum of net cost across expenses, exact through cents. */
export function sumNet(expenses: Pick<Expense, 'amount' | 'reimbursement'>[]): number {
  return fromCents(expenses.reduce((acc, e) => acc + toCents(netAmount(e)), 0));
}

/** Sum of what actually left the account — used when comparing to a statement. */
export function sumGross(expenses: Pick<Expense, 'amount'>[]): number {
  return fromCents(expenses.reduce((acc, e) => acc + toCents(e.amount), 0));
}

/** Clamp a user-entered reimbursement to something the expense can support. */
export function clampReimbursement(amount: number, reimbursement: number): number {
  if (!Number.isFinite(reimbursement) || reimbursement <= 0) return 0;
  return round2(Math.min(Math.max(0, amount), reimbursement));
}
