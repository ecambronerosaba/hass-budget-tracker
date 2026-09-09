/**
 * Money helpers.
 *
 * Amounts are stored as plain numbers of currency units (PRD §3.1), but every
 * comparison and sum goes through cents so floating point never leaks into a
 * total or, more importantly, into the exact-match reconciliation rule (§4.5).
 */

export function toCents(amount: number): number {
  // 1.005 * 100 lands on 100.49999999999999 in binary floating point, which
  // would round down. Trimming the noise first makes the round behave the way
  // a person reading the number expects.
  return Math.round(Number((amount * 100).toFixed(4)));
}

export function fromCents(cents: number): number {
  return cents / 100;
}

/** Round to 2dp, half away from zero as a person would. */
export function round2(amount: number): number {
  return fromCents(toCents(amount));
}

export function sumAmounts(amounts: number[]): number {
  return fromCents(amounts.reduce((acc, a) => acc + toCents(a), 0));
}

export function sameAmount(a: number, b: number): boolean {
  return toCents(a) === toCents(b);
}

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(currency: string, fractionDigits: number): Intl.NumberFormat {
  const key = `${currency}:${fractionDigits}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
    formatters.set(key, f);
  }
  return f;
}

export interface MoneyOptions {
  currency?: string;
  /** Drop the cents when the value is whole — quieter in big display numbers. */
  compact?: boolean;
  /** Always show a leading + or −. */
  signed?: boolean;
}

export function formatMoney(amount: number, opts: MoneyOptions = {}): string {
  const { currency = 'USD', compact = false, signed = false } = opts;
  const value = round2(amount);
  const digits = compact && Number.isInteger(value) ? 0 : 2;
  const text = formatter(currency, digits).format(Math.abs(value));
  if (signed) return `${value < 0 ? '−' : '+'}${text}`;
  return value < 0 ? `−${text}` : text;
}

/** Parse loose user/CSV input: "$1,234.50", "(12.00)", "1 234,50", "-4". */
export function parseAmount(input: string): number | null {
  if (input == null) return null;
  let s = String(input).trim();
  if (!s) return null;

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[^\d.,+-]/g, '');
  if (s.startsWith('-')) negative = true;
  s = s.replace(/[+-]/g, '');
  if (!s) return null;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // Whichever separator comes last is the decimal point.
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma > -1) {
    // A single comma is a decimal separator only if it looks like one.
    s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  }

  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return round2(negative ? -n : n);
}
