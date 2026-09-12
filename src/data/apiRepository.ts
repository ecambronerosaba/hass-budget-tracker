import type { BudgetRepository } from './repository';
import type {
  AppSettings,
  BackupFile,
  Bucket,
  Category,
  Expense,
  Month,
  MonthId,
  ReconciliationSession,
  RecurringExpense,
} from '../types/models';
import { DEFAULT_CATEGORIES, DEFAULT_SETTINGS } from './seed';
import { migrateBackup, migrateRepoData, needsBucketMigration } from '../lib/migrate';

/** The `data` half of the document, per docs/api-contract.md. */
interface RepoData {
  months: Month[];
  expenses: Expense[];
  categories: Category[];
  recurring: RecurringExpense[];
  buckets: Bucket[];
  sessions: ReconciliationSession[];
  settings: AppSettings | null;
}

function emptyData(): RepoData {
  return {
    months: [],
    expenses: [],
    categories: [],
    recurring: [],
    buckets: [],
    sessions: [],
    settings: null,
  };
}

/** Bounds a fetch so a hung connection surfaces as a rejection instead of an
 * unbounded wait — there is no retry-forever here, so nothing should hang
 * forever either. */
async function fetchWithTimeout(
  path: string,
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(path, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * Cheap boot-time probe (`GET api/health`) used to choose between this
 * repository and `IndexedDbRepository`. Bounded so a server that never
 * answers — rather than one that answers "no" — can't leave the app stuck
 * deciding which storage to use.
 */
export async function probeServer(timeoutMs = 1200): Promise<boolean> {
  try {
    const res = await fetchWithTimeout('api/health', undefined, timeoutMs);
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  }
}

/** Thrown internally to carry what the server handed back on a 409. */
class StaleRevisionError extends Error {
  rev: number;
  data: RepoData;
  constructor(rev: number, data: RepoData) {
    super('stale revision');
    this.rev = rev;
    this.data = data;
  }
}

function upsertBy<T>(list: T[], item: T, keyOf: (x: T) => unknown): T[] {
  const key = keyOf(item);
  const idx = list.findIndex((x) => keyOf(x) === key);
  if (idx === -1) return [...list, item];
  const next = list.slice();
  next[idx] = item;
  return next;
}

/**
 * v2 storage (PRD §2, §8): the whole budget lives as one JSON document on the
 * add-on server (docs/api-contract.md), so every device served by the same
 * add-on sees the same data.
 *
 * The add-on serves this very page over Ingress, so there is no offline case
 * to design for — if the server can't be reached, the page didn't load. That
 * rules out a sync engine: no queue, no tombstones, no merge. Every write
 * PUTs the whole document with the revision this cache believes is current;
 * a 409 means someone else (another tab, another device) wrote in between, so
 * the one pending mutation is re-applied onto the server's current state and
 * retried exactly once. A second conflict is surfaced, not looped on.
 */
export class ApiRepository implements BudgetRepository {
  private rev = 0;
  private cached: RepoData = emptyData();
  private ready = false;

  private get data(): RepoData {
    if (!this.ready) throw new Error('ApiRepository used before init().');
    return this.cached;
  }

  async init(): Promise<void> {
    const res = await fetchWithTimeout('api/state', undefined, 8000);
    if (!res.ok) {
      throw new Error(`Could not load the budget from the server (status ${res.status}).`);
    }
    const body = (await res.json()) as { rev: number; data: RepoData };
    this.rev = body.rev;
    this.cached = body.data;
    this.ready = true;

    // v1.5.0 wrote `events`; migrate the whole document once, on the way in,
    // so nothing below this line ever has to know the old name.
    if (needsBucketMigration(this.cached as never)) {
      await this.commit((d) => migrateRepoData(d as never) as never);
    }

    // A fresh server returns rev 0 and empty data — seed the same defaults
    // IndexedDbRepository.init() seeds locally, in one write rather than two.
    const needsCategories = this.cached.categories.length === 0;
    const needsSettings = !this.cached.settings;
    if (needsCategories || needsSettings) {
      await this.commit((d) => ({
        ...d,
        categories: needsCategories ? DEFAULT_CATEGORIES : d.categories,
        settings: needsSettings ? DEFAULT_SETTINGS : d.settings,
      }));
    }
  }

  private async put(rev: number, data: RepoData): Promise<number> {
    let res: Response;
    try {
      res = await fetchWithTimeout(
        'api/state',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rev, data }),
        },
        8000,
      );
    } catch {
      throw new Error('Could not reach the server to save.');
    }
    if (res.status === 409) {
      const body = (await res.json()) as { rev: number; data: RepoData };
      throw new StaleRevisionError(body.rev, body.data);
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message ?? `Could not save (status ${res.status}).`);
    }
    const body = (await res.json()) as { rev: number };
    return body.rev;
  }

  /**
   * Applies a pure transform to the cached document and PUTs the result. On a
   * 409 the transform is re-applied onto the state the server returned and
   * retried once — see the class comment for why once is the whole story.
   */
  private async commit(mutate: (data: RepoData) => RepoData): Promise<void> {
    if (!this.ready) throw new Error('ApiRepository used before init().');
    const next = mutate(this.cached);
    try {
      this.rev = await this.put(this.rev, next);
      this.cached = next;
    } catch (err) {
      if (!(err instanceof StaleRevisionError)) throw err;
      const reapplied = mutate(err.data);
      try {
        this.rev = await this.put(err.rev, reapplied);
        this.cached = reapplied;
      } catch (err2) {
        if (err2 instanceof StaleRevisionError) {
          throw new Error(
            'Could not save — the budget changed elsewhere at the same moment. Reload and try again.',
          );
        }
        throw err2;
      }
    }
  }

  async getSettings(): Promise<AppSettings> {
    return this.data.settings ?? DEFAULT_SETTINGS;
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    await this.commit((d) => ({ ...d, settings }));
  }

  async listCategories(): Promise<Category[]> {
    return [...this.data.categories].sort((a, b) => a.name.localeCompare(b.name));
  }

  async saveCategory(category: Category): Promise<void> {
    await this.commit((d) => ({ ...d, categories: upsertBy(d.categories, category, (c) => c.id) }));
  }

  async listMonths(): Promise<Month[]> {
    return [...this.data.months].sort((a, b) => b.id.localeCompare(a.id));
  }

  async getMonth(id: MonthId): Promise<Month | null> {
    return this.data.months.find((m) => m.id === id) ?? null;
  }

  async saveMonth(month: Month): Promise<void> {
    await this.commit((d) => ({ ...d, months: upsertBy(d.months, month, (m) => m.id) }));
  }

  async listExpenses(monthId?: MonthId): Promise<Expense[]> {
    return this.data.expenses
      .filter((e) => !monthId || e.monthId === monthId)
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }

  async saveExpense(expense: Expense): Promise<void> {
    await this.commit((d) => ({ ...d, expenses: upsertBy(d.expenses, expense, (e) => e.id) }));
  }

  async saveExpenses(expenses: Expense[]): Promise<void> {
    await this.commit((d) => {
      let list = d.expenses;
      for (const expense of expenses) list = upsertBy(list, expense, (e) => e.id);
      return { ...d, expenses: list };
    });
  }

  async deleteExpense(id: string): Promise<void> {
    await this.commit((d) => ({ ...d, expenses: d.expenses.filter((e) => e.id !== id) }));
  }

  async listRecurring(): Promise<RecurringExpense[]> {
    return [...this.data.recurring].sort((a, b) => a.dayOfMonth - b.dayOfMonth);
  }

  async saveRecurring(recurring: RecurringExpense): Promise<void> {
    await this.commit((d) => ({ ...d, recurring: upsertBy(d.recurring, recurring, (r) => r.id) }));
  }

  async deleteRecurring(id: string): Promise<void> {
    await this.commit((d) => ({ ...d, recurring: d.recurring.filter((r) => r.id !== id) }));
  }

  /* `?? []` on every read and write below: a document written by a build that
   * predates buckets has no `buckets` key at all, and the first read of it
   * must not throw. */
  async listBuckets(): Promise<Bucket[]> {
    return [...(this.data.buckets ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async saveBucket(bucket: Bucket): Promise<void> {
    await this.commit((d) => ({ ...d, buckets: upsertBy(d.buckets ?? [], bucket, (e) => e.id) }));
  }

  async deleteBucket(id: string): Promise<void> {
    await this.commit((d) => ({ ...d, buckets: (d.buckets ?? []).filter((e) => e.id !== id) }));
  }

  async getSession(monthId: MonthId): Promise<ReconciliationSession | null> {
    return this.data.sessions.find((s) => s.monthId === monthId) ?? null;
  }

  async saveSession(session: ReconciliationSession): Promise<void> {
    await this.commit((d) => ({
      ...d,
      sessions: upsertBy(d.sessions, session, (s) => s.monthId),
    }));
  }

  async deleteSession(monthId: MonthId): Promise<void> {
    await this.commit((d) => ({ ...d, sessions: d.sessions.filter((s) => s.monthId !== monthId) }));
  }

  async exportAll(): Promise<BackupFile> {
    const d = this.data;
    return {
      format: 'budget-tracker-backup',
      version: 3,
      exportedAt: new Date().toISOString(),
      months: d.months,
      expenses: d.expenses,
      categories: d.categories,
      recurring: d.recurring,
      buckets: d.buckets ?? [],
      sessions: d.sessions,
      settings: d.settings ?? DEFAULT_SETTINGS,
    };
  }

  async importAll(backup: BackupFile): Promise<void> {
    // Ignores the data currently in `d` on purpose: a restore replaces
    // everything, so re-applying it after a 409 must produce the same result
    // regardless of what the server's concurrent write changed.
    const migrated = migrateBackup(backup);
    const next: RepoData = {
      months: migrated.months ?? [],
      expenses: migrated.expenses ?? [],
      categories: migrated.categories?.length ? migrated.categories : DEFAULT_CATEGORIES,
      recurring: migrated.recurring ?? [],
      buckets: migrated.buckets ?? [],
      sessions: migrated.sessions ?? [],
      settings: migrated.settings ?? DEFAULT_SETTINGS,
    };
    await this.commit(() => next);
  }
}
