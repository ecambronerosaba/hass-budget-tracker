/**
 * Date helpers.
 *
 * Everything is local-calendar based and string-first: `YYYY-MM-DD`. We never
 * hand a bare `YYYY-MM-DD` to `new Date()` (that parses as UTC and can shift a
 * day backwards west of Greenwich) — dates are split and rebuilt explicitly.
 */

import type { ISODate, MonthId } from '../types/models';

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function toISODate(d: Date): ISODate {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function today(): ISODate {
  return toISODate(new Date());
}

export function parseISODate(iso: ISODate): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function isValidISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12) return false;
  return d >= 1 && d <= daysInMonth(y, m);
}

export function monthIdOf(iso: ISODate): MonthId {
  return iso.slice(0, 7);
}

export function monthIdFrom(year: number, month: number): MonthId {
  return `${year}-${pad2(month)}`;
}

export function currentMonthId(): MonthId {
  const now = new Date();
  return monthIdFrom(now.getFullYear(), now.getMonth() + 1);
}

export function splitMonthId(id: MonthId): { year: number; month: number } {
  const [year, month] = id.split('-').map(Number);
  return { year, month };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function shiftMonth(id: MonthId, delta: number): MonthId {
  const { year, month } = splitMonthId(id);
  const d = new Date(year, month - 1 + delta, 1);
  return monthIdFrom(d.getFullYear(), d.getMonth() + 1);
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function monthLabel(id: MonthId, opts: { short?: boolean; year?: boolean } = {}): string {
  const { year, month } = splitMonthId(id);
  const name = MONTH_NAMES[month - 1] ?? id;
  const shown = opts.short ? name.slice(0, 3) : name;
  return opts.year === false ? shown : `${shown} ${year}`;
}

/** "Sep 4" / "Sep 4, 2025" if the date is outside the given month. */
export function formatDayLabel(iso: ISODate, contextMonthId?: MonthId): string {
  const d = parseISODate(iso);
  const base = `${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
  if (contextMonthId && monthIdOf(iso) !== contextMonthId) return `${base}, ${d.getFullYear()}`;
  return base;
}

export function relativeDayLabel(iso: ISODate): string {
  const diff = daysBetween(today(), iso);
  if (diff === 0) return 'Today';
  if (diff === -1) return 'Yesterday';
  if (diff === 1) return 'Tomorrow';
  return formatDayLabel(iso);
}

/** Whole days from `a` to `b` (positive when b is later). */
export function daysBetween(a: ISODate, b: ISODate): number {
  const ms = parseISODate(b).getTime() - parseISODate(a).getTime();
  return Math.round(ms / 86_400_000);
}

export function addDays(iso: ISODate, days: number): ISODate {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/** The day-of-month (clamped to 1–31) that an ISO date falls on. */
export function dayOfMonthOf(iso: ISODate): number {
  return Math.min(31, Math.max(1, Number(iso.slice(8, 10)) || 1));
}

export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

/**
 * How far through the month we are, as a 0–1 fraction.
 * Past months are 1, future months are 0. Within the current month, a day
 * counts as elapsed once it has started, so the 1st of a 30-day month is 1/30.
 */
export function monthElapsedFraction(monthId: MonthId, now: ISODate = today()): number {
  const { year, month } = splitMonthId(monthId);
  const total = daysInMonth(year, month);
  const nowMonth = monthIdOf(now);
  if (nowMonth > monthId) return 1;
  if (nowMonth < monthId) return 0;
  const day = parseISODate(now).getDate();
  return Math.min(1, day / total);
}

export function daysElapsedInMonth(monthId: MonthId, now: ISODate = today()): number {
  const { year, month } = splitMonthId(monthId);
  const total = daysInMonth(year, month);
  const nowMonth = monthIdOf(now);
  if (nowMonth > monthId) return total;
  if (nowMonth < monthId) return 0;
  return parseISODate(now).getDate();
}

/** The date a recurring item is expected on, clamped to the month's length. */
export function expectedDateFor(monthId: MonthId, dayOfMonth: number): ISODate {
  const { year, month } = splitMonthId(monthId);
  const day = Math.min(Math.max(1, Math.round(dayOfMonth)), daysInMonth(year, month));
  return `${monthId}-${pad2(day)}`;
}
