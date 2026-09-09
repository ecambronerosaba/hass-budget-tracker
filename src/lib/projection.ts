/**
 * Budget maths for the live dashboard (PRD §4.3).
 *
 * The projection is the "smart" part: it separates day-to-day spending, which
 * it extrapolates from the rate so far, from known recurring costs, which it
 * adds at their real amounts whether or not they've posted yet. Rent doesn't
 * get multiplied by the daily rate, and a month whose rent hasn't landed yet
 * doesn't look deceptively cheap.
 */

import type {
  Expense,
  Month,
  MonthId,
  RecurringExpense,
} from '../types/models';
import {
  daysElapsedInMonth,
  daysInMonth,
  expectedDateFor,
  monthElapsedFraction,
  splitMonthId,
  today,
} from './dates';
import { round2, sumAmounts } from './money';
import { netAmount, sumGross, sumNet } from './expense';

export type PaceTone = 'good' | 'info' | 'over';

export interface UpcomingRecurring {
  recurring: RecurringExpense;
  expectedDate: string;
  /** True once the expected day has arrived or passed without confirmation. */
  due: boolean;
}

export interface MonthSummary {
  monthId: MonthId;
  budgetTotal: number;
  /** What the month has cost so far, net of reimbursements. */
  spent: number;
  /** How much of the gross charges came back from someone else. */
  reimbursed: number;
  remaining: number;
  expenseCount: number;

  daysTotal: number;
  daysElapsed: number;
  daysRemaining: number;
  /** 0–1. */
  fractionElapsed: number;
  /** 0–1, uncapped so "past budget" is visible. */
  fractionUsed: number;

  upcoming: UpcomingRecurring[];
  upcomingTotal: number;

  /** Extrapolated day-to-day spend + all known recurring costs. */
  projectedTotal: number;
  /** Positive = projected over budget. */
  projectedDelta: number;
  /** Positive = ahead of where an even spend rate would put you. */
  paceDelta: number;
  /** What's left to spend per remaining day to land on budget. */
  dailyAllowance: number;

  tone: PaceTone;
  statusLabel: string;
  statusDetail: string;
  /** True when the month is closed — status describes the final result. */
  isFinal: boolean;
}

export interface SummaryInput {
  month: Month;
  expenses: Expense[];
  recurring: RecurringExpense[];
  /** Injectable for tests. */
  now?: string;
}

/**
 * Recurring items that haven't been confirmed as logged this month, and so
 * count as known upcoming cost rather than actual spend (§4.4).
 */
export function upcomingRecurring(
  month: Month,
  recurring: RecurringExpense[],
  now: string = today(),
): UpcomingRecurring[] {
  const settled = new Set(
    month.recurringExpenseConfirmations
      .filter((c) => c.status === 'confirmed' || c.status === 'skipped')
      .map((c) => c.recurringId),
  );
  return recurring
    .filter((r) => r.active && !settled.has(r.id))
    .map((r) => {
      const expectedDate = expectedDateFor(month.id, r.dayOfMonth);
      return { recurring: r, expectedDate, due: expectedDate <= now };
    })
    .sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));
}

/** Recurring nudges to surface right now — due, and not snoozed past today. */
export function dueRecurringNudges(
  month: Month,
  recurring: RecurringExpense[],
  now: string = today(),
): UpcomingRecurring[] {
  const snoozedUntil = new Map(
    month.recurringExpenseConfirmations
      .filter((c) => c.status === 'snoozed' && c.snoozedUntil)
      .map((c) => [c.recurringId, c.snoozedUntil as string]),
  );
  return upcomingRecurring(month, recurring, now).filter((u) => {
    if (!u.due) return false;
    const snooze = snoozedUntil.get(u.recurring.id);
    return !snooze || snooze <= now;
  });
}

export function summarizeMonth({
  month,
  expenses,
  recurring,
  now = today(),
}: SummaryInput): MonthSummary {
  const { year, month: m } = splitMonthId(month.id);
  const daysTotal = daysInMonth(year, m);
  const daysElapsed = daysElapsedInMonth(month.id, now);
  const daysRemaining = Math.max(0, daysTotal - daysElapsed);
  const fractionElapsed = monthElapsedFraction(month.id, now);

  // Net, throughout: what the month cost the user, not what passed through
  // the account. A split dinner that friends paid back is not spending.
  const spent = sumNet(expenses);
  const remaining = round2(month.budgetTotal - spent);
  const reimbursed = round2(sumGross(expenses) - spent);

  const upcoming = upcomingRecurring(month, recurring, now);
  const upcomingTotal = sumAmounts(upcoming.map((u) => u.recurring.amount));

  // Day-to-day spend excludes anything logged from a recurring template, so
  // the daily rate isn't skewed by a single large fixed cost.
  const recurringLogged = sumNet(expenses.filter((e) => e.source === 'recurring'));
  const dayToDaySpent = round2(spent - recurringLogged);
  const dayToDayRate = daysElapsed > 0 ? dayToDaySpent / daysElapsed : 0;
  const projectedDayToDay = month.status === 'reconciled'
    ? dayToDaySpent
    : round2(dayToDayRate * daysTotal);

  const projectedTotal = month.status === 'reconciled'
    ? spent
    : round2(Math.max(spent, projectedDayToDay + recurringLogged + upcomingTotal));
  const projectedDelta = round2(projectedTotal - month.budgetTotal);

  const expectedByNow = round2(month.budgetTotal * fractionElapsed);
  const paceDelta = round2(spent - expectedByNow);

  const dailyAllowance = daysRemaining > 0 ? round2(Math.max(0, remaining) / daysRemaining) : 0;

  const { tone, statusLabel, statusDetail } = describeStatus({
    month,
    spent,
    remaining,
    projectedDelta,
    paceDelta,
    daysElapsed,
    daysRemaining,
    upcomingTotal,
  });

  return {
    monthId: month.id,
    budgetTotal: month.budgetTotal,
    spent,
    reimbursed,
    remaining,
    expenseCount: expenses.length,
    daysTotal,
    daysElapsed,
    daysRemaining,
    fractionElapsed,
    fractionUsed: month.budgetTotal > 0 ? spent / month.budgetTotal : 0,
    upcoming,
    upcomingTotal,
    projectedTotal,
    projectedDelta,
    paceDelta,
    dailyAllowance,
    tone,
    statusLabel,
    statusDetail,
    isFinal: month.status === 'reconciled',
  };
}

interface StatusInput {
  month: Month;
  spent: number;
  remaining: number;
  projectedDelta: number;
  paceDelta: number;
  daysElapsed: number;
  daysRemaining: number;
  upcomingTotal: number;
}

/**
 * Copy rules (§1.2, §4.3): state the fact, never the judgement. Red is a
 * status color, not a scolding — "trending over" is information the user can
 * act on; "you're overspending!" is not.
 */
function describeStatus(input: StatusInput): {
  tone: PaceTone;
  statusLabel: string;
  statusDetail: string;
} {
  const { month, remaining, projectedDelta, paceDelta, daysElapsed, upcomingTotal } = input;
  const money = (n: number) => `$${Math.abs(round2(n)).toLocaleString('en-US', {
    minimumFractionDigits: Math.abs(round2(n)) % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;

  if (month.status === 'reconciled') {
    if (remaining < 0) {
      return {
        tone: 'over',
        statusLabel: `${money(remaining)} over`,
        statusDetail: 'Final, reconciled against your statement.',
      };
    }
    return {
      tone: 'good',
      statusLabel: `${money(remaining)} under`,
      statusDetail: 'Final, reconciled against your statement.',
    };
  }

  if (month.budgetTotal <= 0) {
    return {
      tone: 'info',
      statusLabel: 'No budget set',
      statusDetail: 'Set a total for the month to see how you\'re pacing.',
    };
  }

  if (remaining < 0) {
    return {
      tone: 'over',
      statusLabel: `${money(remaining)} past budget`,
      statusDetail: `You've logged more than this month's total. Still ${input.daysRemaining} ${
        input.daysRemaining === 1 ? 'day' : 'days'
      } to go.`,
    };
  }

  if (daysElapsed < 3) {
    const upcomingNote = upcomingTotal > 0
      ? ` ${money(upcomingTotal)} of recurring costs are expected.`
      : '';
    return {
      tone: 'info',
      statusLabel: 'Early days',
      statusDetail: `Not much to go on yet — the pace signal gets useful in a few days.${upcomingNote}`,
    };
  }

  const paceNote = paceDelta > 0
    ? `${money(paceDelta)} ahead of an even pace.`
    : `${money(paceDelta)} behind an even pace.`;

  if (projectedDelta > 0) {
    return {
      tone: 'over',
      statusLabel: `Trending ${money(projectedDelta)} over`,
      statusDetail: `At this rate, plus what's still expected, the month lands above budget. ${paceNote}`,
    };
  }

  return {
    tone: 'good',
    statusLabel: `Trending ${money(projectedDelta)} under`,
    statusDetail: `At this rate, plus what's still expected, the month lands within budget. ${paceNote}`,
  };
}

export interface CategoryTotal {
  categoryId: string;
  total: number;
  share: number;
  count: number;
}

export function totalsByCategory(expenses: Expense[]): CategoryTotal[] {
  const byCategory = new Map<string, { total: number; count: number }>();
  for (const e of expenses) {
    const entry = byCategory.get(e.category) ?? { total: 0, count: 0 };
    entry.total = round2(entry.total + netAmount(e));
    entry.count += 1;
    byCategory.set(e.category, entry);
  }
  const grand = sumAmounts([...byCategory.values()].map((v) => v.total));
  return [...byCategory.entries()]
    .map(([categoryId, v]) => ({
      categoryId,
      total: v.total,
      count: v.count,
      share: grand > 0 ? v.total / grand : 0,
    }))
    .sort((a, b) => b.total - a.total);
}
