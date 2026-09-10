/**
 * Bulk expense entry (§4.2, the "I have ten receipts to log" case).
 *
 * The bulk sheet holds a grid of half-filled rows: some blank and forgotten,
 * some genuinely in progress, some pointed at a month that's already closed.
 * This decides, purely, which rows become expenses and which the sheet has to
 * keep the user on — so the component never saves a partial row and the tests
 * pin the rules without a DOM.
 */

import type { ISODate, MonthId } from '../types/models';
import { isValidISODate, monthIdOf } from './dates.ts';
import { parseAmount } from './money.ts';

/** One line in the bulk grid, straight off the inputs — amount is raw text. */
export interface BulkRow {
  amount: string;
  description: string;
  category: string;
  date: ISODate;
}

/** A row that's ready to save, with its amount parsed and its month resolved. */
export interface ReadyBulkRow {
  index: number;
  monthId: MonthId;
  input: {
    date: ISODate;
    amount: number;
    category: string;
    description: string;
  };
}

export interface PartitionedBulkRows {
  /** Rows good to save, in the order the user entered them. */
  ready: ReadyBulkRow[];
  /** Indices of rows the user started but didn't finish — these block "Save all". */
  incomplete: number[];
  /** Indices of complete rows dated into a closed month — these block "Save all". */
  locked: number[];
  /** Indices of untouched rows — ignored silently, never a reason to stop. */
  blank: number[];
}

/**
 * Split the grid into ready / incomplete / locked / blank.
 *
 * A row is *blank* when the user has typed neither an amount nor a
 * description — spare rows the "+ Add row" button left behind. A row is
 * *incomplete* once either field is touched but the pair isn't a valid
 * expense yet (amount not a positive number, no description, unusable date).
 * A complete row is *locked* when its own date lands in a month `isLocked`
 * reports closed, and *ready* otherwise.
 */
export function partitionBulkRows(
  rows: BulkRow[],
  isLocked: (monthId: MonthId) => boolean,
): PartitionedBulkRows {
  const result: PartitionedBulkRows = { ready: [], incomplete: [], locked: [], blank: [] };

  rows.forEach((row, index) => {
    const description = row.description.trim();
    const amountText = row.amount.trim();

    if (!amountText && !description) {
      result.blank.push(index);
      return;
    }

    const amount = parseAmount(amountText);
    const amountValid = amount !== null && amount > 0;
    if (!amountValid || !description || !isValidISODate(row.date)) {
      result.incomplete.push(index);
      return;
    }

    const monthId = monthIdOf(row.date);
    if (isLocked(monthId)) {
      result.locked.push(index);
      return;
    }

    result.ready.push({
      index,
      monthId,
      // parseAmount already returns a 2dp value; the store rounds again on the
      // way to storage.
      input: { date: row.date, amount, category: row.category, description },
    });
  });

  return result;
}
