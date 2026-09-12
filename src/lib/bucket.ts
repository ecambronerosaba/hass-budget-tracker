/**
 * Buckets — a pot of money that isn't a month.
 *
 * The whole feature rests on one rule, and this file owns it: money set aside
 * for a bucket counts against the month it was set aside in, and money spent
 * from the bucket counts against nothing, because it was already budgeted when
 * it was saved. Every monthly figure in the app runs its expenses through
 * `countsAgainstMonth` so that rule can't end up applied two different ways in
 * two different screens.
 *
 * Reconciliation deliberately does not use it. The statement carries a
 * transfer to savings and a dinner in Kyoto alike, so the match step sees
 * every expense; only the budget arithmetic narrows.
 */

import { daysBetween, monthIdOf, monthLabel, monthsBetween, today } from './dates.ts';
import { sumNet } from './expense.ts';
import { formatMoney, round2 } from './money.ts';
import type { PaceTone } from './projection.ts';
import type { Bucket, Expense, ISODate } from '../types/models';

export function isContribution(e: Pick<Expense, 'bucketKind'>): boolean {
  return e.bucketKind === 'contribution';
}

export function isBucketSpend(e: Pick<Expense, 'bucketKind'>): boolean {
  return e.bucketKind === 'spend';
}

/** Expenses a month's budget is made of: everything except bucket spending. */
export function countsAgainstMonth(e: Pick<Expense, 'bucketKind'>): boolean {
  return e.bucketKind !== 'spend';
}

export interface BucketSummary {
  bucketId: string;
  target: number;
  /** Net of everything put into the fund. */
  saved: number;
  /** Net of everything spent from the bucket. */
  spent: number;
  /** saved − spent. Negative means the fund is overdrawn. */
  fundRemaining: number;
  /** max(0, spent − saved) — what the fund did not cover. */
  unfunded: number;
  /** max(0, target − saved) — what is left to set aside. */
  targetRemaining: number;
  /** 0–1, uncapped so "past the target" stays visible. */
  fractionSaved: number;
  /** spent ÷ (saved, or the target when nothing is saved). 0–1, uncapped. */
  fractionSpent: number;
  contributionCount: number;
  spendCount: number;
  /** Whole months from the current month to the start month. */
  monthsToStart?: number;
  /** What each remaining month has to carry to reach the target in time. */
  perMonthNeeded?: number;
  /** Net contributed in the month `now` falls in. */
  contributedThisMonth: number;
  tone: PaceTone;
  statusLabel: string;
  statusDetail: string;
}

export interface BucketSummaryInput {
  bucket: Bucket;
  /** The bucket's own expenses — everything tagged with its id. */
  expenses: Expense[];
  /** Injectable for tests. */
  now?: string;
}

export function summarizeBucket({
  bucket,
  expenses,
  now = today(),
}: BucketSummaryInput): BucketSummary {
  const contributions = expenses.filter(isContribution);
  const spends = expenses.filter(isBucketSpend);

  // Net, like every other figure in this app: a split trip dinner cost what
  // was left after the money came back, not what passed through the account.
  const saved = sumNet(contributions);
  const spent = sumNet(spends);
  const fundRemaining = round2(saved - spent);
  const unfunded = round2(Math.max(0, spent - saved));
  const targetRemaining = round2(Math.max(0, bucket.targetAmount - saved));

  const nowMonth = monthIdOf(now);
  const contributedThisMonth = sumNet(contributions.filter((e) => e.monthId === nowMonth));

  // The denominator for "how far through the fund am I" is what's actually in
  // the fund. Before anything is saved there is no fund, so the target is the
  // only honest yardstick left.
  const spendBase = saved > 0 ? saved : bucket.targetAmount;

  let monthsToStart: number | undefined;
  let perMonthNeeded: number | undefined;
  if (bucket.startDate) {
    monthsToStart = monthsBetween(nowMonth, monthIdOf(bucket.startDate));
    if (monthsToStart > 0) perMonthNeeded = round2(targetRemaining / monthsToStart);
  }

  const { tone, statusLabel, statusDetail } = describeBucket({
    bucket,
    saved,
    spent,
    fundRemaining,
    targetRemaining,
    perMonthNeeded,
    now,
  });

  return {
    bucketId: bucket.id,
    target: bucket.targetAmount,
    saved,
    spent,
    fundRemaining,
    unfunded,
    targetRemaining,
    fractionSaved: bucket.targetAmount > 0 ? saved / bucket.targetAmount : 0,
    fractionSpent: spendBase > 0 ? spent / spendBase : 0,
    contributionCount: contributions.length,
    spendCount: spends.length,
    monthsToStart,
    perMonthNeeded,
    contributedThisMonth,
    tone,
    statusLabel,
    statusDetail,
  };
}

interface DescribeInput {
  bucket: Bucket;
  saved: number;
  spent: number;
  fundRemaining: number;
  targetRemaining: number;
  perMonthNeeded?: number;
  now: string;
}

/**
 * Copy rules, same as the month's: state the fact, never the judgement. A
 * bucket that isn't funded yet is information, not a failing — it only reads
 * as off track once the date it was being saved for has arrived without the
 * money.
 */
function describeBucket(input: DescribeInput): {
  tone: PaceTone;
  statusLabel: string;
  statusDetail: string;
} {
  const { bucket, saved, spent, fundRemaining, targetRemaining } = input;
  const money = (n: number) => formatMoney(Math.abs(n));

  if (bucket.phase === 'closed') {
    const detail = `Closed. ${money(saved)} set aside, ${money(spent)} spent.`;
    return fundRemaining < 0
      ? { tone: 'over', statusLabel: `${money(fundRemaining)} over the fund`, statusDetail: detail }
      : {
          tone: 'good',
          statusLabel: `${money(fundRemaining)} under the fund`,
          statusDetail: detail,
        };
  }

  if (bucket.phase === 'spending') {
    return fundRemaining < 0
      ? {
          tone: 'over',
          statusLabel: `${money(fundRemaining)} past the fund`,
          statusDetail: `${money(saved)} was set aside and ${money(
            spent,
          )} has been spent. Cover the difference from a month, or add to the fund.`,
        }
      : {
          tone: 'good',
          statusLabel: `${money(fundRemaining)} left in the fund`,
          statusDetail: `${money(spent)} of ${money(
            saved,
          )} spent. Spending here doesn't count against your monthly budget.`,
        };
  }

  // Saving.
  if (bucket.targetAmount <= 0) {
    return {
      tone: 'info',
      statusLabel: 'No target set',
      statusDetail: 'Give this a target to see how the fund is tracking.',
    };
  }

  if (targetRemaining === 0) {
    return {
      tone: 'good',
      statusLabel: 'Fully funded',
      statusDetail: `${money(saved)} set aside against a ${money(
        bucket.targetAmount,
      )} target. Switch to spending when you start spending it.`,
    };
  }

  const started = Boolean(bucket.startDate && bucket.startDate <= input.now);
  if (started) {
    return {
      tone: 'over',
      statusLabel: `${money(targetRemaining)} short`,
      statusDetail: `The date has arrived with ${money(saved)} of ${money(
        bucket.targetAmount,
      )} set aside.`,
    };
  }

  const pace =
    input.perMonthNeeded !== undefined && bucket.startDate
      ? ` ${money(input.perMonthNeeded)} a month to be ready by ${monthLabel(
          monthIdOf(bucket.startDate),
        )}.`
      : '';
  return {
    tone: 'info',
    statusLabel: `${money(targetRemaining)} to go`,
    statusDetail: `${money(saved)} of ${money(bucket.targetAmount)} set aside.${pace}`,
  };
}

/**
 * The bucket an expense dated `date` belongs to, or null.
 *
 * Only a bucket with BOTH ends of a range can claim a date — one date is not
 * a range, and a bucket with just a start would otherwise swallow everything
 * logged after it forever.
 *
 * This is deliberately not called from the store. It runs at the UI entry
 * points where a person is logging a discretionary expense, so that a
 * recurring rent confirmation or a reconciliation link never gets quietly
 * pulled into a trip fund.
 */
export function bucketForDate(date: ISODate, buckets: Bucket[]): Bucket | null {
  const candidates = buckets.filter(
    (b) =>
      b.phase !== 'closed' &&
      Boolean(b.startDate) &&
      Boolean(b.endDate) &&
      (b.startDate as string) <= date &&
      date <= (b.endDate as string),
  );
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => {
    // Mid-trip beats still-saving: if you're spending it, that's the one.
    const phase = Number(b.phase === 'spending') - Number(a.phase === 'spending');
    if (phase !== 0) return phase;
    // Then the tighter window — a week-long trip beats a year-long savings run.
    const span = (x: Bucket) =>
      daysBetween(x.startDate as string, x.endDate as string);
    const bySpan = span(a) - span(b);
    if (bySpan !== 0) return bySpan;
    return b.createdAt.localeCompare(a.createdAt);
  })[0];
}
