import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { BudgetRepository } from '../data/repository';
import { ApiRepository, probeServer } from '../data/apiRepository';
import { IndexedDbRepository } from '../data/indexedDbRepository';
import { MemoryRepository } from '../data/memoryRepository';
import { DEFAULT_PREFERENCES } from '../types/models';
import { DEFAULT_SETTINGS, FALLBACK_CATEGORY_ID } from '../data/seed';
import type {
  AppSettings,
  Preferences,
  BackupFile,
  BankTransaction,
  Category,
  Expense,
  ExpenseSource,
  ISODate,
  Month,
  MonthId,
  ReconcileStage,
  ReconciliationSession,
  RecurringExpense,
} from '../types/models';
import { addDays, currentMonthId, expectedDateFor, splitMonthId, today } from '../lib/dates';
import { clampReimbursement } from '../lib/expense';
import { newId } from '../lib/id';
import { round2 } from '../lib/money';
import { autoMatch } from '../lib/reconcile';
import { resolveRecurringFromExpense, type RecurringTemplateDraft } from '../lib/recurring';

/* ------------------------------- types --------------------------------- */

export interface Toast {
  id: string;
  message: string;
  detail?: string;
  tone?: 'neutral' | 'good' | 'over';
  /** An offer to reverse what just happened, e.g. "Undo" after a delete. */
  action?: { label: string; run: () => void | Promise<void> };
}

export interface ExpenseInput {
  date: ISODate;
  /** Gross — what left the account. */
  amount: number;
  /** The part of it someone else covered. */
  reimbursement?: number;
  category: string;
  description: string;
  notes?: string;
  source?: ExpenseSource;
  reconciliationStatus?: Expense['reconciliationStatus'];
  matchedTransactionId?: string;
}

/** Where the active repository actually keeps its data — for the honest line
 * in Settings, since someone can have both deployments and needs to tell
 * them apart. */
export type StorageLocation = 'server' | 'browser';

interface AppData {
  settings: AppSettings;
  categories: Category[];
  months: Month[];
  expenses: Expense[];
  recurring: RecurringExpense[];
  sessions: ReconciliationSession[];
}

const EMPTY: AppData = {
  settings: DEFAULT_SETTINGS,
  categories: [],
  months: [],
  expenses: [],
  recurring: [],
  sessions: [],
};

export interface AppStore extends AppData {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  /** False when IndexedDB was unavailable and data lives only in memory. */
  durable: boolean;
  /** Which repository is actually backing the app right now (§5, Settings). */
  storageLocation: StorageLocation;

  activeMonthId: MonthId;
  setActiveMonthId: (id: MonthId) => void;

  toasts: Toast[];
  notify: (message: string, options?: Omit<Toast, 'id' | 'message'>) => void;
  dismissToast: (id: string) => void;

  preferences: Preferences;
  setPreference: <K extends keyof Preferences>(key: K, value: Preferences[K]) => Promise<void>;

  /** True when the month is closed and its data must not change (§4.1). */
  isLocked: (monthId: MonthId) => boolean;

  setBudget: (monthId: MonthId, amount: number) => Promise<void>;
  addExpense: (monthId: MonthId, input: ExpenseInput) => Promise<Expense>;
  /**
   * Persist several expenses in order. Resolves with the prefix that made it
   * to storage (`created`) and the error that stopped the rest, if any — it
   * does not throw on a partial write.
   */
  addExpenses: (
    items: { monthId: MonthId; input: ExpenseInput }[],
  ) => Promise<{ created: Expense[]; error: unknown }>;
  updateExpense: (id: string, patch: Partial<ExpenseInput>) => Promise<void>;
  deleteExpense: (id: string) => Promise<void>;

  saveCategory: (category: Category) => Promise<void>;
  createCategory: (name: string, color: string) => Promise<Category>;

  saveRecurring: (recurring: RecurringExpense) => Promise<void>;
  createRecurring: (input: Omit<RecurringExpense, 'id'>) => Promise<void>;
  deleteRecurring: (id: string) => Promise<void>;
  confirmRecurring: (
    monthId: MonthId,
    recurringId: string,
    overrides?: { amount?: number; date?: ISODate },
  ) => Promise<void>;
  snoozeRecurring: (monthId: MonthId, recurringId: string, days?: number) => Promise<void>;
  skipRecurring: (monthId: MonthId, recurringId: string) => Promise<void>;
  /**
   * Promote a just-logged expense to a monthly template: reuse an active
   * template of the same name or create one, then mark it confirmed for
   * `monthId` so this month isn't nudged for it again.
   */
  registerRecurringFromExpense: (
    monthId: MonthId,
    expenseId: string,
    draft: RecurringTemplateDraft,
  ) => Promise<void>;

  startReconciliation: (
    monthId: MonthId,
    transactions: BankTransaction[],
    fileName?: string,
    excluded?: { credits: number; outsideMonth: number; unreadable: number },
  ) => Promise<void>;
  setReconcileStage: (monthId: MonthId, stage: ReconcileStage) => Promise<void>;
  linkTransaction: (monthId: MonthId, txnId: string, expenseId: string) => Promise<void>;
  addExpenseFromTransaction: (
    monthId: MonthId,
    txnId: string,
    input: Omit<ExpenseInput, 'source'>,
  ) => Promise<void>;
  resolveLoggedOnly: (monthId: MonthId, expenseId: string) => Promise<void>;
  finishReconciliation: (monthId: MonthId) => Promise<void>;
  /** Discards the import. Resolves with how many created expenses it removed. */
  cancelReconciliation: (monthId: MonthId) => Promise<number>;

  /** Statement rows and logged expenses still awaiting a decision (§4.6). */
  unresolvedCounts: (monthId: MonthId) => { queueA: number; queueB: number };

  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  exportBackup: () => Promise<BackupFile>;
  importBackup: (backup: BackupFile) => Promise<void>;
}

const StoreContext = createContext<AppStore | null>(null);

/* ----------------------------- helpers --------------------------------- */

function makeMonth(id: MonthId): Month {
  const { year, month } = splitMonthId(id);
  return {
    id,
    year,
    month,
    budgetTotal: 0,
    status: 'open',
    budgetHistory: [],
    recurringExpenseConfirmations: [],
    createdAt: new Date().toISOString(),
  };
}

/** Turn a form/import payload into a storable Expense. Shared by the single
 *  and bulk add paths so the two can't drift on defaults or normalisation. */
function buildExpense(monthId: MonthId, input: ExpenseInput): Expense {
  const now = new Date().toISOString();
  const amount = round2(input.amount);
  const reimbursement = clampReimbursement(amount, input.reimbursement ?? 0);
  return {
    id: newId('exp'),
    monthId,
    date: input.date,
    amount,
    reimbursement: reimbursement > 0 ? reimbursement : undefined,
    category: input.category || FALLBACK_CATEGORY_ID,
    description: input.description.trim(),
    notes: input.notes?.trim() || undefined,
    source: input.source ?? 'manual',
    reconciliationStatus: input.reconciliationStatus ?? 'unreconciled',
    matchedTransactionId: input.matchedTransactionId,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Boot-time storage choice (PRD §2, §8). The same build runs two ways: served
 * by the add-on, where the server holds the truth and every device sees it;
 * or dropped at `/local/budget/index.html` on its own, where it falls back to
 * the v1 behaviour of one copy per browser. `probeServer` is what tells the
 * two apart, and it is bounded so a network that never answers can't leave
 * this stuck instead of just picking the local fallback.
 */
async function pickRepository(): Promise<{
  repo: BudgetRepository;
  durable: boolean;
  location: StorageLocation;
}> {
  if (await probeServer()) {
    const api = new ApiRepository();
    try {
      await api.init();
      return { repo: api, durable: true, location: 'server' };
    } catch {
      // Health answered but the state fetch didn't — fall through to local
      // storage rather than stall the boot on a server that isn't actually
      // cooperating.
    }
  }
  const indexed = new IndexedDbRepository();
  try {
    await indexed.init();
    return { repo: indexed, durable: true, location: 'browser' };
  } catch {
    const memory = new MemoryRepository();
    await memory.init();
    return { repo: memory, durable: false, location: 'browser' };
  }
}

/**
 * Wraps a repository so a write that fails is never silent. There's no
 * offline queue to catch it — the contract is that a failed write surfaces
 * immediately — so every call is watched, and a rejection is turned into a
 * toast (stating the fact, not scolding) before being re-thrown. Re-throwing
 * matters as much as the toast: it's what stops a screen that awaits the
 * call from also announcing success or closing as if the write had landed.
 */
function withFailureNotice(repo: BudgetRepository, notify: AppStore['notify']): BudgetRepository {
  return new Proxy(repo, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      return async (...args: unknown[]) => {
        try {
          return await value.apply(target, args);
        } catch (err) {
          notify('Not saved', {
            detail: err instanceof Error ? err.message : 'The server did not confirm the change.',
            tone: 'neutral',
          });
          throw err;
        }
      };
    },
  });
}

/* ----------------------------- provider -------------------------------- */

export function AppProvider({
  children,
  repository,
}: {
  children: ReactNode;
  /** Injectable for tests and previews. */
  repository?: BudgetRepository;
}) {
  const repoRef = useRef<BudgetRepository | null>(repository ?? null);
  const [durable, setDurable] = useState(true);
  const [storageLocation, setStorageLocation] = useState<StorageLocation>('browser');
  const [status, setStatus] = useState<AppStore['status']>('loading');
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AppData>(EMPTY);
  const [activeMonthId, setActiveMonthIdState] = useState<MonthId>(currentMonthId());
  const restoredMonth = useRef(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const reload = useCallback(async () => {
    const repo = repoRef.current;
    if (!repo) return;
    const [settings, categories, months, expenses, recurring] = await Promise.all([
      repo.getSettings(),
      repo.listCategories(),
      repo.listMonths(),
      repo.listExpenses(),
      repo.listRecurring(),
    ]);
    const sessions = (
      await Promise.all(months.map((m) => repo.getSession(m.id)))
    ).filter((s): s is ReconciliationSession => s !== null);
    setData({ settings, categories, months, expenses, recurring, sessions });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!repoRef.current) {
          const picked = await pickRepository();
          if (cancelled) return;
          repoRef.current = picked.repo;
          setDurable(picked.durable);
          setStorageLocation(picked.location);
        } else {
          await repoRef.current.init();
        }
        // Make sure the current month exists so the dashboard has something to show.
        const repo = repoRef.current;
        const id = currentMonthId();
        if (repo && !(await repo.getMonth(id))) await repo.saveMonth(makeMonth(id));
        if (cancelled) return;
        const settings = await repo.getSettings();
        const remembered = settings.preferences?.lastViewedMonthId;
        if (!restoredMonth.current && remembered && remembered <= currentMonthId()) {
          restoredMonth.current = true;
          setActiveMonthIdState(remembered);
        }
        await reload();
        if (!cancelled) setStatus('ready');
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not open local storage.');
          setStatus('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const notify = useCallback<AppStore['notify']>((message, options) => {
    const toast: Toast = { id: newId('toast'), message, ...options };
    // Two at a time, oldest dropped — a stack of confirmations is noise, and
    // it would cover the thing the user just changed.
    setToasts((prev) => [...prev, toast].slice(-2));
    // An offer to undo has to outlive the glance that notices it.
    window.setTimeout(
      () => setToasts((prev) => prev.filter((t) => t.id !== toast.id)),
      toast.action ? 7000 : 2800,
    );
  }, []);

  /** Changing month is a preference, not just view state — it should survive. */
  const setActiveMonthId = useCallback(
    (id: MonthId) => {
      setActiveMonthIdState(id);
      void (async () => {
        const r = repoRef.current;
        if (!r) return;
        // A month the user has never visited has no record yet, and the
        // dashboard renders nothing without one — so navigating to it is what
        // brings it into existence.
        if (!(await r.getMonth(id))) {
          await r.saveMonth(makeMonth(id));
          await reload();
        }
        const settings = await r.getSettings();
        const current = { ...DEFAULT_PREFERENCES, ...(settings.preferences ?? {}) };
        await r.saveSettings({ ...settings, preferences: { ...current, lastViewedMonthId: id } });
      })();
    },
    [reload],
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const repo = () => {
    const r = repoRef.current;
    if (!r) throw new Error('Storage is not ready yet.');
    return withFailureNotice(r, notify);
  };

  const preferences: Preferences = useMemo(
    () => ({ ...DEFAULT_PREFERENCES, ...(data.settings.preferences ?? {}) }),
    [data.settings.preferences],
  );

  const setPreference = useCallback<AppStore['setPreference']>(
    async (key, value) => {
      const settings = await repo().getSettings();
      const current = { ...DEFAULT_PREFERENCES, ...(settings.preferences ?? {}) };
      await repo().saveSettings({ ...settings, preferences: { ...current, [key]: value } });
      await reload();
    },
    [reload],
  );

  /**
   * A closed month is read-only (§4.1). This is checked in the store rather
   * than in each screen, because a screen that forgets is a screen that lets
   * a reconciled month be edited.
   */
  const isLocked = useCallback<AppStore['isLocked']>(
    (monthId) => data.months.find((m) => m.id === monthId)?.status === 'reconciled',
    [data.months],
  );

  const ensureMonth = useCallback(async (monthId: MonthId): Promise<Month> => {
    const existing = await repo().getMonth(monthId);
    if (existing) return existing;
    const created = makeMonth(monthId);
    await repo().saveMonth(created);
    return created;
  }, []);

  /* ------------------------------ budget ------------------------------- */

  const setBudget = useCallback<AppStore['setBudget']>(
    async (monthId, amount) => {
      const month = await ensureMonth(monthId);
      if (month.status === 'reconciled') {
        notify('This month is closed', { detail: 'Its budget is locked.', tone: 'neutral' });
        return;
      }
      const next: Month = {
        ...month,
        budgetTotal: round2(amount),
        budgetHistory: [
          ...month.budgetHistory,
          { at: new Date().toISOString(), from: month.budgetTotal || null, to: round2(amount) },
        ],
      };
      await repo().saveMonth(next);
      await reload();
    },
    [ensureMonth, notify, reload],
  );

  /* ----------------------------- expenses ------------------------------ */

  const addExpense = useCallback<AppStore['addExpense']>(
    async (monthId, input) => {
      await ensureMonth(monthId);
      const expense = buildExpense(monthId, input);
      await repo().saveExpense(expense);
      const settings = await repo().getSettings();
      await repo().saveSettings({ ...settings, lastUsedCategory: expense.category });
      await reload();
      return expense;
    },
    [ensureMonth, reload],
  );

  /**
   * Log a batch of expenses in one pass (the bulk-entry sheet). Rows are
   * written one at a time in order; `created` is exactly the prefix that
   * persisted, so a caller that hit `error` knows which rows to drop and which
   * to leave for a retry — a retry can't double-log, because the row that
   * threw never reached storage. The settings touch and the single `reload`
   * happen once at the end rather than once per row.
   */
  const addExpenses = useCallback<AppStore['addExpenses']>(
    async (items) => {
      const created: Expense[] = [];
      let failure: unknown = null;
      try {
        for (const monthId of new Set(items.map((i) => i.monthId))) {
          await ensureMonth(monthId);
        }
        for (const { monthId, input } of items) {
          const expense = buildExpense(monthId, input);
          await repo().saveExpense(expense);
          created.push(expense);
        }
      } catch (err) {
        failure = err;
      }
      if (created.length > 0) {
        try {
          const settings = await repo().getSettings();
          await repo().saveSettings({
            ...settings,
            lastUsedCategory: created[created.length - 1].category,
          });
        } catch {
          // The expenses are saved; a stale last-used category is cosmetic.
        }
      }
      await reload();
      return { created, error: failure };
    },
    [ensureMonth, reload],
  );

  const updateExpense = useCallback<AppStore['updateExpense']>(
    async (id, patch) => {
      const existing = data.expenses.find((e) => e.id === id);
      if (!existing) return;
      if (isLocked(existing.monthId)) {
        notify('That month is closed', { detail: 'Its expenses are read-only.' });
        return;
      }
      const amount = patch.amount !== undefined ? round2(patch.amount) : existing.amount;
      const reimbursement = clampReimbursement(
        amount,
        patch.reimbursement !== undefined ? patch.reimbursement : existing.reimbursement ?? 0,
      );
      const next: Expense = {
        ...existing,
        ...patch,
        amount,
        reimbursement: reimbursement > 0 ? reimbursement : undefined,
        description: patch.description?.trim() ?? existing.description,
        notes: patch.notes !== undefined ? patch.notes.trim() || undefined : existing.notes,
        monthId: patch.date ? patch.date.slice(0, 7) : existing.monthId,
        updatedAt: new Date().toISOString(),
      };
      if (next.monthId !== existing.monthId) await ensureMonth(next.monthId);
      await repo().saveExpense(next);
      await reload();
    },
    [data.expenses, ensureMonth, isLocked, notify, reload],
  );

  const deleteExpense = useCallback<AppStore['deleteExpense']>(
    async (id) => {
      const existing = data.expenses.find((e) => e.id === id);
      if (!existing) return;
      if (isLocked(existing.monthId)) {
        notify('That month is closed', { detail: 'Its expenses are read-only.' });
        return;
      }

      // If a statement row was matched to this expense, hand the row back to
      // Queue A rather than leaving it pointing at something that's gone.
      const session = await repo().getSession(existing.monthId);
      if (session && existing.matchedTransactionId) {
        await repo().saveSession({
          ...session,
          transactions: session.transactions.map((t) =>
            t.matchedExpenseId === id
              ? { ...t, matchStatus: 'unmatched' as const, matchedExpenseId: undefined }
              : t,
          ),
          createdExpenseIds: session.createdExpenseIds.filter((x) => x !== id),
        });
      }

      await repo().deleteExpense(id);
      await reload();

      // Deleting the wrong row out of a 40-item ledger is easy; a confirm tap
      // doesn't help with that, so the way back is offered instead.
      notify('Expense removed', {
        detail: existing.description,
        action: {
          label: 'Undo',
          run: async () => {
            await repo().saveExpense(existing);
            await reload();
          },
        },
      });
    },
    [data.expenses, isLocked, notify, reload],
  );

  /* ---------------------------- categories ----------------------------- */

  const saveCategory = useCallback<AppStore['saveCategory']>(
    async (category) => {
      await repo().saveCategory(category);
      await reload();
    },
    [reload],
  );

  const createCategory = useCallback<AppStore['createCategory']>(
    async (name, color) => {
      const category: Category = {
        id: newId('cat'),
        name: name.trim(),
        color,
        isDefault: false,
        archived: false,
      };
      await repo().saveCategory(category);
      await reload();
      return category;
    },
    [reload],
  );

  /* ----------------------------- recurring ----------------------------- */

  const saveRecurring = useCallback<AppStore['saveRecurring']>(
    async (recurring) => {
      await repo().saveRecurring(recurring);
      await reload();
    },
    [reload],
  );

  const createRecurring = useCallback<AppStore['createRecurring']>(
    async (input) => {
      await repo().saveRecurring({ ...input, id: newId('rec') });
      await reload();
    },
    [reload],
  );

  const deleteRecurring = useCallback<AppStore['deleteRecurring']>(
    async (id) => {
      await repo().deleteRecurring(id);
      await reload();
    },
    [reload],
  );

  const recordConfirmation = useCallback(
    async (
      monthId: MonthId,
      recurringId: string,
      status: 'confirmed' | 'snoozed' | 'skipped',
      extra: { expenseId?: string; snoozedUntil?: ISODate } = {},
    ) => {
      const month = await ensureMonth(monthId);
      const confirmations = month.recurringExpenseConfirmations.filter(
        (c) => c.recurringId !== recurringId,
      );
      confirmations.push({ recurringId, status, at: new Date().toISOString(), ...extra });
      await repo().saveMonth({ ...month, recurringExpenseConfirmations: confirmations });
    },
    [ensureMonth],
  );

  const confirmRecurring = useCallback<AppStore['confirmRecurring']>(
    async (monthId, recurringId, overrides) => {
      const recurring = data.recurring.find((r) => r.id === recurringId);
      if (!recurring) return;
      const expense = await addExpense(monthId, {
        // Dated to the day it was expected rather than the day it was
        // confirmed — that's the date the statement will carry, so exact
        // matching at month end has a chance of working.
        date: overrides?.date ?? expectedDateFor(monthId, recurring.dayOfMonth),
        amount: overrides?.amount ?? recurring.amount,
        category: recurring.category,
        description: recurring.description,
        source: 'recurring',
      });
      await recordConfirmation(monthId, recurringId, 'confirmed', { expenseId: expense.id });
      await reload();
    },
    [addExpense, data.recurring, recordConfirmation, reload],
  );

  const snoozeRecurring = useCallback<AppStore['snoozeRecurring']>(
    async (monthId, recurringId, days = 3) => {
      await recordConfirmation(monthId, recurringId, 'snoozed', {
        snoozedUntil: addDays(today(), days),
      });
      await reload();
    },
    [recordConfirmation, reload],
  );

  const skipRecurring = useCallback<AppStore['skipRecurring']>(
    async (monthId, recurringId) => {
      await recordConfirmation(monthId, recurringId, 'skipped');
      await reload();
    },
    [recordConfirmation, reload],
  );

  const registerRecurringFromExpense = useCallback<AppStore['registerRecurringFromExpense']>(
    async (monthId, expenseId, draft) => {
      const resolution = resolveRecurringFromExpense(data.recurring, draft);
      let recurringId: string;
      if (resolution.kind === 'reuse') {
        recurringId = resolution.id;
      } else {
        const created: RecurringExpense = { ...resolution.template, id: newId('rec') };
        await repo().saveRecurring(created);
        recurringId = created.id;
      }
      await recordConfirmation(monthId, recurringId, 'confirmed', { expenseId });
      await reload();
    },
    [data.recurring, recordConfirmation, reload],
  );

  /* -------------------------- reconciliation --------------------------- */

  const startReconciliation = useCallback<AppStore['startReconciliation']>(
    async (monthId, transactions, fileName, excluded) => {
      const monthExpenses = await repo().listExpenses(monthId);
      const result = autoMatch(transactions, monthExpenses);
      await repo().saveExpenses(result.expenses);
      await repo().saveSession({
        monthId,
        stage: 'queue-a',
        transactions: result.transactions,
        resolvedLoggedOnly: [],
        createdExpenseIds: [],
        excluded: excluded ?? { credits: 0, outsideMonth: 0, unreadable: 0 },
        importedAt: new Date().toISOString(),
        fileName,
      });
      await reload();
    },
    [reload],
  );

  const setReconcileStage = useCallback<AppStore['setReconcileStage']>(
    async (monthId, stage) => {
      const session = await repo().getSession(monthId);
      if (!session) return;
      await repo().saveSession({ ...session, stage });
      await reload();
    },
    [reload],
  );

  const linkTransaction = useCallback<AppStore['linkTransaction']>(
    async (monthId, txnId, expenseId) => {
      const session = await repo().getSession(monthId);
      if (!session) return;
      const expense = data.expenses.find((e) => e.id === expenseId);
      if (!expense) return;
      await repo().saveSession({
        ...session,
        transactions: session.transactions.map((t) =>
          t.id === txnId ? { ...t, matchStatus: 'matched', matchedExpenseId: expenseId } : t,
        ),
      });
      await repo().saveExpense({
        ...expense,
        reconciliationStatus: 'matched',
        matchedTransactionId: txnId,
        updatedAt: new Date().toISOString(),
      });
      await reload();
    },
    [data.expenses, reload],
  );

  const addExpenseFromTransaction = useCallback<AppStore['addExpenseFromTransaction']>(
    async (monthId, txnId, input) => {
      const session = await repo().getSession(monthId);
      if (!session) return;
      const expense = await addExpense(monthId, {
        ...input,
        source: 'csv-added',
        reconciliationStatus: 'matched',
        matchedTransactionId: txnId,
      });
      const fresh = await repo().getSession(monthId);
      if (fresh) {
        await repo().saveSession({
          ...fresh,
          transactions: fresh.transactions.map((t) =>
            t.id === txnId ? { ...t, matchStatus: 'matched', matchedExpenseId: expense.id } : t,
          ),
          createdExpenseIds: [...(fresh.createdExpenseIds ?? []), expense.id],
        });
      }
      await reload();
    },
    [addExpense, reload],
  );

  const resolveLoggedOnly = useCallback<AppStore['resolveLoggedOnly']>(
    async (monthId, expenseId) => {
      const session = await repo().getSession(monthId);
      const expense = data.expenses.find((e) => e.id === expenseId);
      if (expense && expense.reconciliationStatus !== 'matched') {
        await repo().saveExpense({
          ...expense,
          reconciliationStatus: 'logged-only',
          updatedAt: new Date().toISOString(),
        });
      }
      if (session && !session.resolvedLoggedOnly.includes(expenseId)) {
        await repo().saveSession({
          ...session,
          resolvedLoggedOnly: [...session.resolvedLoggedOnly, expenseId],
        });
      }
      await reload();
    },
    [data.expenses, reload],
  );

  const finishReconciliation = useCallback<AppStore['finishReconciliation']>(
    async (monthId) => {
      const month = await ensureMonth(monthId);
      await repo().saveMonth({
        ...month,
        status: 'reconciled',
        reconciledAt: new Date().toISOString(),
      });
      await repo().deleteSession(monthId);
      await reload();
    },
    [ensureMonth, reload],
  );

  const cancelReconciliation = useCallback<AppStore['cancelReconciliation']>(
    async (monthId) => {
      const session = await repo().getSession(monthId);
      // Everything this session created goes with it — otherwise "start over"
      // after importing the wrong file leaves phantom expenses behind.
      const created = new Set(session?.createdExpenseIds ?? []);
      for (const id of created) await repo().deleteExpense(id);

      await repo().deleteSession(monthId);
      const monthExpenses = await repo().listExpenses(monthId);
      await repo().saveExpenses(
        monthExpenses
          .filter((e) => !created.has(e.id))
          .map((e) => ({
            ...e,
            reconciliationStatus: 'unreconciled' as const,
            matchedTransactionId: undefined,
          })),
      );
      await reload();
      return created.size;
    },
    [reload],
  );

  /* ------------------------------ settings ----------------------------- */

  /**
   * What still needs a decision before the month can honestly be closed.
   * Queue A is statement rows nobody has looked at; Queue B is logged expenses
   * the statement didn't show and the user hasn't confirmed.
   */
  const unresolvedCounts = useCallback<AppStore['unresolvedCounts']>(
    (monthId) => {
      const session = data.sessions.find((s) => s.monthId === monthId);
      if (!session) return { queueA: 0, queueB: 0 };
      const resolved = new Set(session.resolvedLoggedOnly);
      return {
        queueA: session.transactions.filter((t) => t.matchStatus === 'unmatched').length,
        queueB: data.expenses.filter(
          (e) =>
            e.monthId === monthId &&
            e.reconciliationStatus !== 'matched' &&
            !resolved.has(e.id),
        ).length,
      };
    },
    [data.sessions, data.expenses],
  );

  const updateSettings = useCallback<AppStore['updateSettings']>(
    async (patch) => {
      const settings = await repo().getSettings();
      await repo().saveSettings({ ...settings, ...patch });
      await reload();
    },
    [reload],
  );

  const exportBackup = useCallback<AppStore['exportBackup']>(() => repo().exportAll(), []);

  const importBackup = useCallback<AppStore['importBackup']>(
    async (backup) => {
      await repo().importAll(backup);
      await reload();
    },
    [reload],
  );

  const value = useMemo<AppStore>(
    () => ({
      ...data,
      status,
      error,
      durable,
      storageLocation,
      activeMonthId,
      setActiveMonthId,
      preferences,
      setPreference,
      isLocked,
      unresolvedCounts,
      toasts,
      notify,
      dismissToast,
      setBudget,
      addExpense,
      addExpenses,
      updateExpense,
      deleteExpense,
      saveCategory,
      createCategory,
      saveRecurring,
      createRecurring,
      deleteRecurring,
      confirmRecurring,
      snoozeRecurring,
      skipRecurring,
      registerRecurringFromExpense,
      startReconciliation,
      setReconcileStage,
      linkTransaction,
      addExpenseFromTransaction,
      resolveLoggedOnly,
      finishReconciliation,
      cancelReconciliation,
      updateSettings,
      exportBackup,
      importBackup,
    }),
    [
      data, status, error, durable, storageLocation, activeMonthId, preferences, setPreference, isLocked,
      unresolvedCounts, toasts, notify, dismissToast,
      setBudget, addExpense, addExpenses, updateExpense, deleteExpense, saveCategory, createCategory,
      saveRecurring, createRecurring, deleteRecurring, confirmRecurring, snoozeRecurring,
      skipRecurring, registerRecurringFromExpense, startReconciliation, setReconcileStage, linkTransaction,
      addExpenseFromTransaction, resolveLoggedOnly, finishReconciliation,
      cancelReconciliation, updateSettings, exportBackup, importBackup,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useApp(): AppStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useApp must be used inside <AppProvider>.');
  return store;
}

/* ----------------------------- selectors ------------------------------- */

export function useMonth(monthId: MonthId): Month | null {
  const { months } = useApp();
  return useMemo(() => months.find((m) => m.id === monthId) ?? null, [months, monthId]);
}

export function useMonthExpenses(monthId: MonthId): Expense[] {
  const { expenses } = useApp();
  return useMemo(
    () => expenses.filter((e) => e.monthId === monthId),
    [expenses, monthId],
  );
}

export function useSession(monthId: MonthId): ReconciliationSession | null {
  const { sessions } = useApp();
  return useMemo(
    () => sessions.find((s) => s.monthId === monthId) ?? null,
    [sessions, monthId],
  );
}

export function useCategoryMap(): Map<string, Category> {
  const { categories } = useApp();
  return useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
}
