/**
 * Statement import (PRD §4.5, revised).
 *
 * Rather than hard-coding one bank's export, the app defines its own canonical
 * shape and adapts any CSV to it:
 *
 *     date,description,amount[,category][,notes]
 *
 * Everything else is a mapping problem. The parser sniffs the delimiter,
 * detects a header row, guesses which column is which from a list of aliases,
 * works out the date format and the sign convention from the data, and then
 * hands all of those guesses to the UI so the user can correct any of them
 * before importing. A file that matches the canonical shape needs zero clicks;
 * a file from any bank needs a glance at the mapping step.
 */

import type { BankTransaction } from '../types/models';
import { isValidISODate, pad2 } from './dates';
import { newId } from './id';
import { parseAmount, round2 } from './money';

export const CANONICAL_HEADERS = ['date', 'description', 'amount', 'category', 'notes'] as const;

export const CANONICAL_TEMPLATE = [
  'date,description,amount,category,notes',
  '2026-09-01,Trader Joe\'s,42.18,Groceries,',
  '2026-09-03,Metro North,16.50,Transport,commute',
  '2026-09-04,Blue State Coffee,6.50,Dining & Takeout,',
].join('\n');

export type CsvField = 'date' | 'description' | 'amount' | 'debit' | 'credit' | 'category' | 'notes';

/** Column index for each canonical field; -1 means "not present". */
export interface ColumnMapping {
  date: number;
  description: number;
  amount: number;
  /** Optional split debit/credit columns, used instead of `amount`. */
  debit: number;
  credit: number;
  category: number;
  notes: number;
}

export type SignConvention = 'positive-is-charge' | 'negative-is-charge';
export type DateFormat = 'ymd' | 'mdy' | 'dmy' | 'text';

export interface ParsedCsv {
  delimiter: string;
  hasHeader: boolean;
  headers: string[];
  rows: string[][];
}

export interface ImportPlan extends ParsedCsv {
  mapping: ColumnMapping;
  signConvention: SignConvention;
  dateFormat: DateFormat;
  /** True when every required field was matched by name, not position. */
  confident: boolean;
}

export interface SkippedRow {
  rowNumber: number;
  reason: string;
  raw: string[];
}

export interface ImportResult {
  transactions: BankTransaction[];
  skipped: SkippedRow[];
  /** Rows read as refunds/credits and left out — we reconcile charges only. */
  creditsIgnored: number;
  /** Rows belonging to a different month than the one being reconciled. */
  outsideMonth: number;
}

/* ------------------------------- parsing ------------------------------- */

const DELIMITERS = [',', ';', '\t', '|'];

export function sniffDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 8);
  let best = ',';
  let bestScore = -1;
  for (const d of DELIMITERS) {
    const counts = sample.map((line) => splitLine(line, d).length);
    if (counts.length === 0) continue;
    const first = counts[0];
    if (first < 2) continue;
    const consistent = counts.every((c) => c === first);
    const score = first * (consistent ? 10 : 1);
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/** Split a single line, honouring RFC 4180 quoting. */
function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      out.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out.map((f) => f.trim());
}

/** Full-text parse — handles quoted fields containing newlines. */
export function parseCsv(text: string, delimiter?: string): ParsedCsv {
  const clean = text.replace(/^﻿/, '');
  const d = delimiter ?? sniffDelimiter(clean);

  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  const endField = () => {
    row.push(field.trim());
    field = '';
  };
  const endRow = () => {
    endField();
    if (row.some((c) => c !== '')) rows.push(row);
    row = [];
  };

  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === d) {
      endField();
    } else if (ch === '\n') {
      endRow();
    } else if (ch === '\r') {
      // handled by the \n that follows
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) endRow();

  const hasHeader = rows.length > 0 && looksLikeHeader(rows[0]);
  const width = Math.max(0, ...rows.map((r) => r.length));
  const headers = hasHeader
    ? padRow(rows[0], width)
    : Array.from({ length: width }, (_, i) => `Column ${i + 1}`);

  return {
    delimiter: d,
    hasHeader,
    headers,
    rows: (hasHeader ? rows.slice(1) : rows).map((r) => padRow(r, width)),
  };
}

function padRow(row: string[], width: number): string[] {
  const out = row.slice(0, width);
  while (out.length < width) out.push('');
  return out;
}

/** A header row is one where no cell parses as a date or an amount. */
function looksLikeHeader(row: string[]): boolean {
  const nonEmpty = row.filter((c) => c !== '');
  if (nonEmpty.length === 0) return false;
  const dataish = nonEmpty.filter(
    (c) => parseDateCell(c, 'auto') !== null || parseAmount(c) !== null,
  );
  return dataish.length === 0;
}

/* ------------------------------- mapping ------------------------------- */

const ALIASES: Record<CsvField, string[]> = {
  date: ['date', 'transaction date', 'trans date', 'posted date', 'post date', 'posting date', 'transaction_date', 'booking date', 'time'],
  description: ['description', 'merchant', 'merchant name', 'payee', 'name', 'details', 'memo', 'narrative', 'reference', 'transaction description', 'particulars'],
  amount: ['amount', 'transaction amount', 'value', 'charge', 'total', 'amount (usd)', 'debit/credit'],
  debit: ['debit', 'withdrawal', 'money out', 'paid out', 'outflow', 'debit amount'],
  credit: ['credit', 'deposit', 'money in', 'paid in', 'inflow', 'credit amount'],
  category: ['category', 'type', 'classification', 'tag'],
  notes: ['notes', 'note', 'comment', 'comments', 'extended details', 'additional info'],
};

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function findColumn(headers: string[], field: CsvField): number {
  const normalized = headers.map(normalizeHeader);
  const aliases = ALIASES[field];
  const exact = normalized.findIndex((h) => aliases.includes(h));
  if (exact > -1) return exact;
  return normalized.findIndex((h) => h !== '' && aliases.some((a) => h.includes(a)));
}

export const EMPTY_MAPPING: ColumnMapping = {
  date: -1, description: -1, amount: -1, debit: -1, credit: -1, category: -1, notes: -1,
};

/** Guess a mapping from headers, falling back to inspecting the data. */
export function guessMapping(parsed: ParsedCsv): { mapping: ColumnMapping; confident: boolean } {
  const mapping: ColumnMapping = { ...EMPTY_MAPPING };
  if (parsed.hasHeader) {
    for (const field of Object.keys(ALIASES) as CsvField[]) {
      mapping[field] = findColumn(parsed.headers, field);
    }
  }
  const named = mapping.date > -1 && mapping.description > -1
    && (mapping.amount > -1 || mapping.debit > -1);
  if (named) return { mapping, confident: true };

  // Fall back to shape: the first column that parses as a date everywhere,
  // the first that parses as a number, the widest remaining text column.
  const sample = parsed.rows.slice(0, 25);
  const width = parsed.headers.length;
  const isDateCol = (i: number) =>
    sample.length > 0 && sample.every((r) => parseDateCell(r[i] ?? '', 'auto') !== null);
  const isNumCol = (i: number) =>
    sample.length > 0 && sample.every((r) => (r[i] ?? '') === '' || parseAmount(r[i]) !== null);

  if (mapping.date < 0) {
    for (let i = 0; i < width; i += 1) if (isDateCol(i)) { mapping.date = i; break; }
  }
  if (mapping.amount < 0 && mapping.debit < 0) {
    for (let i = width - 1; i >= 0; i -= 1) {
      if (i !== mapping.date && isNumCol(i)) { mapping.amount = i; break; }
    }
  }
  if (mapping.description < 0) {
    let bestIdx = -1;
    let bestLen = -1;
    for (let i = 0; i < width; i += 1) {
      if (i === mapping.date || i === mapping.amount) continue;
      const len = sample.reduce((acc, r) => acc + (r[i] ?? '').length, 0);
      if (len > bestLen) { bestLen = len; bestIdx = i; }
    }
    mapping.description = bestIdx;
  }
  return { mapping, confident: false };
}

/* ------------------------------- dates -------------------------------- */

const MONTH_WORDS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Parse a date cell into `YYYY-MM-DD`. `format` disambiguates 03/04/2026 —
 * 'auto' assumes month-first unless the numbers rule it out.
 */
export function parseDateCell(cell: string, format: DateFormat | 'auto'): string | null {
  const value = (cell ?? '').trim();
  if (!value) return null;

  const iso = value.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) return build(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const compact = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return build(Number(compact[1]), Number(compact[2]), Number(compact[3]));

  const worded = value.match(/^(\d{1,2})[\s-]([a-z]{3,9})[\s-](\d{2,4})$/i);
  if (worded) {
    const m = MONTH_WORDS[worded[2].slice(0, 4).toLowerCase()] ?? MONTH_WORDS[worded[2].slice(0, 3).toLowerCase()];
    if (m) return build(expandYear(Number(worded[3])), m, Number(worded[1]));
  }
  const worded2 = value.match(/^([a-z]{3,9})\s+(\d{1,2}),?\s+(\d{2,4})$/i);
  if (worded2) {
    const m = MONTH_WORDS[worded2[1].slice(0, 4).toLowerCase()] ?? MONTH_WORDS[worded2[1].slice(0, 3).toLowerCase()];
    if (m) return build(expandYear(Number(worded2[3])), m, Number(worded2[2]));
  }

  const numeric = value.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (numeric) {
    const a = Number(numeric[1]);
    const b = Number(numeric[2]);
    const year = expandYear(Number(numeric[3]));
    let monthFirst: boolean;
    if (format === 'mdy') monthFirst = true;
    else if (format === 'dmy') monthFirst = false;
    else monthFirst = !(a > 12 && b <= 12);
    return monthFirst ? build(year, a, b) : build(year, b, a);
  }

  return null;
}

function expandYear(year: number): number {
  if (year >= 1000) return year;
  return year >= 70 ? 1900 + year : 2000 + year;
}

function build(year: number, month: number, day: number): string | null {
  const iso = `${year}-${pad2(month)}-${pad2(day)}`;
  return isValidISODate(iso) ? iso : null;
}

/** Month-first vs day-first, decided by looking for a value above 12. */
export function detectDateFormat(rows: string[][], dateCol: number): DateFormat {
  if (dateCol < 0) return 'ymd';
  let sawIso = false;
  for (const row of rows) {
    const value = (row[dateCol] ?? '').trim();
    if (/^\d{4}[-/.]/.test(value)) { sawIso = true; continue; }
    const numeric = value.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
    if (numeric) {
      const a = Number(numeric[1]);
      const b = Number(numeric[2]);
      if (a > 12 && b <= 12) return 'dmy';
      if (b > 12 && a <= 12) return 'mdy';
    }
  }
  return sawIso ? 'ymd' : 'mdy';
}

/* ------------------------------- amounts ------------------------------- */

/**
 * Which sign means "money spent". Most card exports list charges as positive
 * and refunds negative; most bank exports do the opposite. Decided by majority
 * vote over the file, then shown to the user for confirmation.
 */
export function detectSignConvention(rows: string[][], mapping: ColumnMapping): SignConvention {
  if (mapping.debit > -1) return 'positive-is-charge';
  if (mapping.amount < 0) return 'positive-is-charge';
  let positives = 0;
  let negatives = 0;
  for (const row of rows) {
    const amount = parseAmount(row[mapping.amount] ?? '');
    if (amount === null || amount === 0) continue;
    if (amount > 0) positives += 1;
    else negatives += 1;
  }
  return negatives > positives ? 'negative-is-charge' : 'positive-is-charge';
}

/* ------------------------------- import -------------------------------- */

export function buildImportPlan(text: string, delimiter?: string): ImportPlan {
  const parsed = parseCsv(text, delimiter);
  const { mapping, confident } = guessMapping(parsed);
  return {
    ...parsed,
    mapping,
    confident,
    dateFormat: detectDateFormat(parsed.rows, mapping.date),
    signConvention: detectSignConvention(parsed.rows, mapping),
  };
}

export interface ImportOptions {
  mapping: ColumnMapping;
  dateFormat: DateFormat;
  signConvention: SignConvention;
  /** When given, rows outside this month are counted and dropped. */
  monthId?: string;
}

export function importTransactions(
  rows: string[][],
  options: ImportOptions,
): ImportResult {
  const { mapping, dateFormat, signConvention, monthId } = options;
  const transactions: BankTransaction[] = [];
  const skipped: SkippedRow[] = [];
  let creditsIgnored = 0;
  let outsideMonth = 0;

  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const date = parseDateCell(row[mapping.date] ?? '', dateFormat);
    if (!date) {
      skipped.push({ rowNumber, reason: 'No readable date', raw: row });
      return;
    }

    let signedAmount: number | null = null;
    if (mapping.debit > -1 || mapping.credit > -1) {
      const debit = mapping.debit > -1 ? parseAmount(row[mapping.debit] ?? '') : null;
      const credit = mapping.credit > -1 ? parseAmount(row[mapping.credit] ?? '') : null;
      if (debit) signedAmount = Math.abs(debit);
      else if (credit) signedAmount = -Math.abs(credit);
    } else {
      const raw = parseAmount(row[mapping.amount] ?? '');
      if (raw !== null) {
        signedAmount = signConvention === 'negative-is-charge' ? -raw : raw;
      }
    }

    if (signedAmount === null) {
      skipped.push({ rowNumber, reason: 'No readable amount', raw: row });
      return;
    }
    if (signedAmount <= 0) {
      creditsIgnored += 1;
      return;
    }
    if (monthId && !date.startsWith(monthId)) {
      outsideMonth += 1;
      return;
    }

    const description = (row[mapping.description] ?? '').trim() || 'Unlabelled transaction';
    transactions.push({
      id: newId('txn'),
      date,
      amount: round2(signedAmount),
      rawDescription: description,
      matchStatus: 'unmatched',
      categoryHint: categoryHintFor(row, mapping) ?? undefined,
      noteHint: mapping.notes > -1 ? (row[mapping.notes] ?? '').trim() || undefined : undefined,
    });
  });

  transactions.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);
  return { transactions, skipped, creditsIgnored, outsideMonth };
}

/** Suggested category name from a mapped category column, if present. */
export function categoryHintFor(row: string[], mapping: ColumnMapping): string | null {
  if (mapping.category < 0) return null;
  const value = (row[mapping.category] ?? '').trim();
  return value || null;
}
