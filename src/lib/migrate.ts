/**
 * Storage migrations.
 *
 * v1.5.0 shipped this feature under the name "event": a document carried an
 * `events` array and expenses were tagged `eventId` / `eventKind`. v1.6.0
 * renamed the concept to "bucket", and a rename that drops a shipped user's
 * data is not a rename, it is data loss — so every read path runs this first.
 *
 * Kept pure and free of storage details so it can be unit-tested without a
 * browser, and so the IndexedDB, server-backed and backup paths cannot drift
 * into three subtly different migrations.
 */

import type { Bucket, BackupFile, Expense } from '../types/models';

/** An expense as v1.5.0 wrote it. */
export type LegacyExpense = Omit<Expense, 'bucketId' | 'bucketKind'> & {
  eventId?: string;
  eventKind?: Expense['bucketKind'];
  bucketId?: string;
  bucketKind?: Expense['bucketKind'];
};

/** The `data` half of the document, in either shape. */
export interface LegacyRepoData {
  months: unknown[];
  expenses: LegacyExpense[];
  categories: unknown[];
  recurring: unknown[];
  events?: Bucket[];
  buckets?: Bucket[];
  sessions: unknown[];
  settings: unknown;
  [key: string]: unknown;
}

/** True when anything in `data` still speaks the old name. */
export function needsBucketMigration(data: LegacyRepoData): boolean {
  if (Array.isArray(data.events)) return true;
  return (data.expenses ?? []).some(
    (e) => e.eventId !== undefined || e.eventKind !== undefined,
  );
}

function migrateExpense(e: LegacyExpense): Expense {
  // Destructured out rather than deleted, so the old keys cannot survive into
  // the stored record and be read back later alongside the new ones.
  const { eventId, eventKind, ...rest } = e;
  const bucketId = rest.bucketId ?? eventId;
  const bucketKind = rest.bucketKind ?? eventKind;
  const out = { ...rest } as Expense;
  if (bucketId) {
    out.bucketId = bucketId;
    // A kind with no id would take an ordinary expense out of its month.
    out.bucketKind = bucketKind ?? 'spend';
  } else {
    delete out.bucketId;
    delete out.bucketKind;
  }
  return out;
}

/**
 * Returns the document in the current shape. Idempotent: running it on
 * already-migrated data returns an equal document, which is what lets every
 * read path call it unconditionally.
 */
export function migrateRepoData<T extends LegacyRepoData>(
  data: T,
): Omit<T, 'events' | 'expenses'> & { buckets: Bucket[]; expenses: Expense[] } {
  const { events, ...rest } = data;
  return {
    ...(rest as Omit<T, 'events' | 'expenses'>),
    buckets: data.buckets ?? events ?? [],
    expenses: (data.expenses ?? []).map(migrateExpense),
  };
}

/** The same, for a restored backup file, re-stamped to the current version. */
export function migrateBackup(backup: BackupFile): BackupFile {
  return { ...migrateRepoData(backup as never), version: 3 } as BackupFile;
}
