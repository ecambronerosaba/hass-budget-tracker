/**
 * The storage seam (PRD §2, §8).
 *
 * Nothing above this file knows that v1 stores data in IndexedDB. When the v2
 * backend lands, an `ApiRepository` implementing this same interface can be
 * dropped in — the UI and domain logic don't change.
 */

import type {
  AppSettings,
  BackupFile,
  Category,
  Expense,
  Month,
  MonthId,
  ReconciliationSession,
  RecurringExpense,
} from '../types/models';

export interface BudgetRepository {
  init(): Promise<void>;

  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<void>;

  listCategories(): Promise<Category[]>;
  saveCategory(category: Category): Promise<void>;

  listMonths(): Promise<Month[]>;
  getMonth(id: MonthId): Promise<Month | null>;
  saveMonth(month: Month): Promise<void>;

  listExpenses(monthId?: MonthId): Promise<Expense[]>;
  saveExpense(expense: Expense): Promise<void>;
  saveExpenses(expenses: Expense[]): Promise<void>;
  deleteExpense(id: string): Promise<void>;

  listRecurring(): Promise<RecurringExpense[]>;
  saveRecurring(recurring: RecurringExpense): Promise<void>;
  deleteRecurring(id: string): Promise<void>;

  getSession(monthId: MonthId): Promise<ReconciliationSession | null>;
  saveSession(session: ReconciliationSession): Promise<void>;
  deleteSession(monthId: MonthId): Promise<void>;

  exportAll(): Promise<BackupFile>;
  /** Replaces everything currently stored with the contents of the backup. */
  importAll(backup: BackupFile): Promise<void>;
}
