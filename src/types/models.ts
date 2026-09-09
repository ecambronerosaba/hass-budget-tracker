/**
 * Domain models — PRD §3.
 *
 * All shapes here are plain, JSON-serialisable objects with no class
 * instances, Dates, or Maps. That is deliberate: v2 swaps IndexedDB for a
 * real API (PRD §2), and these same shapes should travel over the wire
 * unchanged. Dates are ISO `YYYY-MM-DD` strings; timestamps are ISO 8601.
 */

/** `YYYY-MM-DD` — a calendar day, with no timezone attached. */
export type ISODate = string;
/** ISO 8601 instant, e.g. `2026-09-08T14:03:11.000Z`. */
export type Timestamp = string;
/** `YYYY-MM` — the id of a Month. */
export type MonthId = string;

export type MonthStatus = 'open' | 'reconciled';

/** One edit of a month's budget, kept as a lightweight audit trail (§4.1). */
export interface BudgetEdit {
  at: Timestamp;
  /** null when the budget was first set. */
  from: number | null;
  to: number;
}

export type RecurringConfirmationStatus = 'confirmed' | 'snoozed' | 'skipped';

/** Tracks what the user has said about a recurring item this month (§4.4). */
export interface RecurringConfirmation {
  recurringId: string;
  status: RecurringConfirmationStatus;
  /** Set when status is `confirmed` — the expense that was logged. */
  expenseId?: string;
  /** Set when status is `snoozed` — don't nudge again before this date. */
  snoozedUntil?: ISODate;
  at: Timestamp;
}

export interface Month {
  id: MonthId;
  year: number;
  /** 1–12. */
  month: number;
  budgetTotal: number;
  status: MonthStatus;
  budgetHistory: BudgetEdit[];
  recurringExpenseConfirmations: RecurringConfirmation[];
  reconciledAt?: Timestamp;
  createdAt: Timestamp;
}

export type ExpenseSource = 'manual' | 'recurring' | 'csv-added';

export type ReconciliationStatus =
  | 'unreconciled'
  | 'matched'
  | 'logged-only'
  | 'csv-only';

export interface Expense {
  id: string;
  monthId: MonthId;
  date: ISODate;
  /**
   * What actually left the account — the gross charge. This is the figure the
   * statement carries, so it is the one reconciliation matches on, and it does
   * not change when part of the money comes back.
   */
  amount: number;
  /**
   * The part of `amount` that someone else covered — a split dinner, a friend
   * paying you back. Subtracted from `amount` for every budget figure, never
   * for matching. Always between 0 and `amount`.
   */
  reimbursement?: number;
  category: string;
  description: string;
  notes?: string;
  source: ExpenseSource;
  reconciliationStatus: ReconciliationStatus;
  matchedTransactionId?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type MatchStatus = 'matched' | 'unmatched';

/**
 * A row from an imported statement. Lives only for the duration of a
 * reconciliation session (§3.1) — persisted so a refresh mid-review doesn't
 * lose the user's place, then discarded when the month closes.
 */
export interface BankTransaction {
  id: string;
  date: ISODate;
  amount: number;
  rawDescription: string;
  matchStatus: MatchStatus;
  matchedExpenseId?: string;
  /** From an optional `category` column — used to preselect on the add form. */
  categoryHint?: string;
  /** From an optional `notes` column. */
  noteHint?: string;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  isDefault: boolean;
  archived: boolean;
}

export interface RecurringExpense {
  id: string;
  description: string;
  amount: number;
  category: string;
  /** 1–31; clamped to the length of the month when projecting. */
  dayOfMonth: number;
  active: boolean;
}

/** Where the user is in the two-queue reconciliation flow (§4.6). */
export type ReconcileStage = 'import' | 'queue-a' | 'queue-b' | 'summary';

export interface ReconciliationSession {
  monthId: MonthId;
  stage: ReconcileStage;
  transactions: BankTransaction[];
  /** Expense ids the user has already resolved in Queue B. */
  resolvedLoggedOnly: string[];
  /**
   * Expenses this session created from statement rows. Discarding the session
   * has to remove them too, or "start over" silently leaves them behind.
   */
  createdExpenseIds: string[];
  /** What the import left out, kept so the closing summary can restate it. */
  excluded: { credits: number; outsideMonth: number; unreadable: number };
  importedAt: Timestamp;
  fileName?: string;
}

/**
 * Remembered UI state (PRD §6 durability, extended).
 *
 * These aren't settings the user configures — they're the small choices the
 * app should not make them repeat: how the ledger was sorted, which month they
 * were reading, how a given CSV shape maps. Persisted alongside the data so
 * they survive a reload rather than living in component state.
 */
export interface Preferences {
  expenseSort: 'date' | 'amount';
  /** Category id, or null for "All". */
  expenseCategoryFilter: string | null;
  /** The month the user was last looking at. */
  lastViewedMonthId?: MonthId;
  /** Whether the "matched automatically" panel is expanded. */
  showMatchedPanel: boolean;
  /**
   * Column mappings the user has corrected, keyed by a signature of the file's
   * headers — so the same export format never has to be mapped twice.
   */
  importMappings: Record<string, SavedImportMapping>;
}

export interface SavedImportMapping {
  mapping: Record<string, number>;
  dateFormat: string;
  signConvention: string;
  savedAt: Timestamp;
}

export const DEFAULT_PREFERENCES: Preferences = {
  expenseSort: 'date',
  expenseCategoryFilter: null,
  showMatchedPanel: false,
  importMappings: {},
};

export interface AppSettings {
  id: 'settings';
  currency: string;
  /** Category id preselected in the quick-add form. */
  lastUsedCategory?: string;
  theme: 'dark' | 'light';
  preferences?: Preferences;
}

/** Shape of the JSON backup (§6, data durability). */
export interface BackupFile {
  format: 'budget-tracker-backup';
  version: 1;
  exportedAt: Timestamp;
  months: Month[];
  expenses: Expense[];
  categories: Category[];
  recurring: RecurringExpense[];
  sessions: ReconciliationSession[];
  settings: AppSettings | null;
}
