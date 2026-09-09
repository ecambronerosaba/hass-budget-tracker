import type { BudgetRepository } from './repository';
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
import { DEFAULT_CATEGORIES, DEFAULT_SETTINGS } from './seed';

/**
 * Non-persistent fallback, used when IndexedDB is unavailable (private
 * windows, locked-down browsers) and by tests. Same seam, no durability — the
 * UI warns when this is what's backing the app.
 */
export class MemoryRepository implements BudgetRepository {
  private months = new Map<MonthId, Month>();
  private expenses = new Map<string, Expense>();
  private categories = new Map<string, Category>();
  private recurring = new Map<string, RecurringExpense>();
  private sessions = new Map<MonthId, ReconciliationSession>();
  private settings: AppSettings = { ...DEFAULT_SETTINGS };

  async init(): Promise<void> {
    if (this.categories.size === 0) {
      for (const c of DEFAULT_CATEGORIES) this.categories.set(c.id, { ...c });
    }
  }

  async getSettings(): Promise<AppSettings> {
    return { ...this.settings };
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    this.settings = { ...settings };
  }

  async listCategories(): Promise<Category[]> {
    return [...this.categories.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async saveCategory(category: Category): Promise<void> {
    this.categories.set(category.id, { ...category });
  }

  async listMonths(): Promise<Month[]> {
    return [...this.months.values()].sort((a, b) => b.id.localeCompare(a.id));
  }

  async getMonth(id: MonthId): Promise<Month | null> {
    return this.months.get(id) ?? null;
  }

  async saveMonth(month: Month): Promise<void> {
    this.months.set(month.id, { ...month });
  }

  async listExpenses(monthId?: MonthId): Promise<Expense[]> {
    return [...this.expenses.values()]
      .filter((e) => !monthId || e.monthId === monthId)
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }

  async saveExpense(expense: Expense): Promise<void> {
    this.expenses.set(expense.id, { ...expense });
  }

  async saveExpenses(expenses: Expense[]): Promise<void> {
    for (const e of expenses) this.expenses.set(e.id, { ...e });
  }

  async deleteExpense(id: string): Promise<void> {
    this.expenses.delete(id);
  }

  async listRecurring(): Promise<RecurringExpense[]> {
    return [...this.recurring.values()].sort((a, b) => a.dayOfMonth - b.dayOfMonth);
  }

  async saveRecurring(recurring: RecurringExpense): Promise<void> {
    this.recurring.set(recurring.id, { ...recurring });
  }

  async deleteRecurring(id: string): Promise<void> {
    this.recurring.delete(id);
  }

  async getSession(monthId: MonthId): Promise<ReconciliationSession | null> {
    return this.sessions.get(monthId) ?? null;
  }

  async saveSession(session: ReconciliationSession): Promise<void> {
    this.sessions.set(session.monthId, session);
  }

  async deleteSession(monthId: MonthId): Promise<void> {
    this.sessions.delete(monthId);
  }

  async exportAll(): Promise<BackupFile> {
    return {
      format: 'budget-tracker-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      months: [...this.months.values()],
      expenses: [...this.expenses.values()],
      categories: [...this.categories.values()],
      recurring: [...this.recurring.values()],
      sessions: [...this.sessions.values()],
      settings: this.settings,
    };
  }

  async importAll(backup: BackupFile): Promise<void> {
    this.months = new Map((backup.months ?? []).map((m) => [m.id, m]));
    this.expenses = new Map((backup.expenses ?? []).map((e) => [e.id, e]));
    const cats = backup.categories?.length ? backup.categories : DEFAULT_CATEGORIES;
    this.categories = new Map(cats.map((c) => [c.id, c]));
    this.recurring = new Map((backup.recurring ?? []).map((r) => [r.id, r]));
    this.sessions = new Map((backup.sessions ?? []).map((s) => [s.monthId, s]));
    this.settings = backup.settings ?? { ...DEFAULT_SETTINGS };
  }
}
