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
import * as idb from './idb';

/** v1 storage: everything local, nothing over the network (PRD §2, §6). */
export class IndexedDbRepository implements BudgetRepository {
  async init(): Promise<void> {
    await idb.openDb();
    const categories = await idb.getAll<Category>('categories');
    if (categories.length === 0) {
      await idb.putMany('categories', DEFAULT_CATEGORIES);
    }
    const settings = await idb.get<AppSettings>('settings', 'settings');
    if (!settings) {
      await idb.put('settings', DEFAULT_SETTINGS);
    }
  }

  async getSettings(): Promise<AppSettings> {
    return (await idb.get<AppSettings>('settings', 'settings')) ?? DEFAULT_SETTINGS;
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    await idb.put('settings', settings);
  }

  async listCategories(): Promise<Category[]> {
    const categories = await idb.getAll<Category>('categories');
    return categories.sort((a, b) => a.name.localeCompare(b.name));
  }

  async saveCategory(category: Category): Promise<void> {
    await idb.put('categories', category);
  }

  async listMonths(): Promise<Month[]> {
    const months = await idb.getAll<Month>('months');
    return months.sort((a, b) => b.id.localeCompare(a.id));
  }

  async getMonth(id: MonthId): Promise<Month | null> {
    return idb.get<Month>('months', id);
  }

  async saveMonth(month: Month): Promise<void> {
    await idb.put('months', month);
  }

  async listExpenses(monthId?: MonthId): Promise<Expense[]> {
    const expenses = monthId
      ? await idb.getAllByIndex<Expense>('expenses', 'monthId', monthId)
      : await idb.getAll<Expense>('expenses');
    return expenses.sort(
      (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
    );
  }

  async saveExpense(expense: Expense): Promise<void> {
    await idb.put('expenses', expense);
  }

  async saveExpenses(expenses: Expense[]): Promise<void> {
    await idb.putMany('expenses', expenses);
  }

  async deleteExpense(id: string): Promise<void> {
    await idb.remove('expenses', id);
  }

  async listRecurring(): Promise<RecurringExpense[]> {
    const items = await idb.getAll<RecurringExpense>('recurring');
    return items.sort((a, b) => a.dayOfMonth - b.dayOfMonth);
  }

  async saveRecurring(recurring: RecurringExpense): Promise<void> {
    await idb.put('recurring', recurring);
  }

  async deleteRecurring(id: string): Promise<void> {
    await idb.remove('recurring', id);
  }

  async getSession(monthId: MonthId): Promise<ReconciliationSession | null> {
    return idb.get<ReconciliationSession>('sessions', monthId);
  }

  async saveSession(session: ReconciliationSession): Promise<void> {
    await idb.put('sessions', session);
  }

  async deleteSession(monthId: MonthId): Promise<void> {
    await idb.remove('sessions', monthId);
  }

  async exportAll(): Promise<BackupFile> {
    const [months, expenses, categories, recurring, sessions, settings] = await Promise.all([
      idb.getAll<Month>('months'),
      idb.getAll<Expense>('expenses'),
      idb.getAll<Category>('categories'),
      idb.getAll<RecurringExpense>('recurring'),
      idb.getAll<ReconciliationSession>('sessions'),
      this.getSettings(),
    ]);
    return {
      format: 'budget-tracker-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      months,
      expenses,
      categories,
      recurring,
      sessions,
      settings,
    };
  }

  async importAll(backup: BackupFile): Promise<void> {
    await idb.clearStores(['months', 'expenses', 'categories', 'recurring', 'sessions', 'settings']);
    await Promise.all([
      idb.putMany('months', backup.months ?? []),
      idb.putMany('expenses', backup.expenses ?? []),
      idb.putMany(
        'categories',
        backup.categories?.length ? backup.categories : DEFAULT_CATEGORIES,
      ),
      idb.putMany('recurring', backup.recurring ?? []),
      idb.putMany('sessions', backup.sessions ?? []),
      idb.put('settings', backup.settings ?? DEFAULT_SETTINGS),
    ]);
  }
}
