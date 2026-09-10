import { useMemo, useRef, useState } from 'react';
import { BulkExpenseSheet } from '../components/BulkExpenseSheet';
import { ExpenseSheet } from '../components/ExpenseSheet';
import { IconInbox, IconLink, IconPlus, IconRepeat, IconUpload } from '../components/Icons';
import {
  EmptyState,
  ExpenseAmount,
  Segmented,
  SplitNote,
  useMoneyFormatter,
} from '../components/ui';
import { formatDayLabel, monthLabel } from '../lib/dates';
import { netAmount, sumNet } from '../lib/expense';
import type { Expense } from '../types/models';
import { useApp, useCategoryMap, useMonthExpenses } from '../state/store';

type SortKey = 'date' | 'amount';

/** The month's ledger (§4.2): sortable, filterable, with a running total. */
export function ExpensesScreen() {
  const { activeMonthId, preferences, setPreference, isLocked } = useApp();
  const expenses = useMonthExpenses(activeMonthId);
  const categories = useCategoryMap();
  const money = useMoneyFormatter();

  // Held in preferences so a reload doesn't reset how you last looked at the
  // ledger — but the tap has to feel instant, so the UI updates from local
  // state immediately and the persisted write happens in the background.
  const [sort, setSortState] = useState<SortKey>(preferences.expenseSort);
  const [categoryFilter, setCategoryFilterState] = useState<string | null>(
    preferences.expenseCategoryFilter,
  );
  // setPreference is a read-modify-write; two of them fired back to back (one
  // per key) can race and lose whichever wrote first. Chaining them here
  // keeps each write queued behind the last without making the tap itself
  // wait — the UI already updated from local state above.
  const persistQueue = useRef(Promise.resolve());
  const persist = <K extends 'expenseSort' | 'expenseCategoryFilter'>(
    key: K,
    value: (typeof preferences)[K],
  ) => {
    persistQueue.current = persistQueue.current.then(() => setPreference(key, value));
  };
  const setSort = (value: SortKey) => {
    setSortState(value);
    persist('expenseSort', value);
  };
  const setCategoryFilter = (value: string | null) => {
    setCategoryFilterState(value);
    persist('expenseCategoryFilter', value);
  };
  const [editing, setEditing] = useState<Expense | null>(null);
  const [bulkAdding, setBulkAdding] = useState(false);

  const used = useMemo(() => {
    const ids = new Set(expenses.map((e) => e.category));
    return [...categories.values()].filter((c) => ids.has(c.id));
  }, [expenses, categories]);

  const visible = useMemo(() => {
    const filtered = categoryFilter
      ? expenses.filter((e) => e.category === categoryFilter)
      : expenses;
    return [...filtered].sort((a, b) =>
      sort === 'amount'
        ? netAmount(b) - netAmount(a)
        : b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
    );
  }, [expenses, categoryFilter, sort]);

  const total = sumNet(visible);
  const locked = isLocked(activeMonthId);

  return (
    <div className="stack" style={{ ['--gap' as string]: 'var(--s-4)' }}>
      <div className="row row--between" style={{ flexWrap: 'wrap', gap: 'var(--s-3)' }}>
        <div>
          <div className="section-label">
            {categoryFilter ? categories.get(categoryFilter)?.name : 'All expenses'}
          </div>
          <div style={{ fontSize: 'var(--t-title)', fontWeight: 600, letterSpacing: '-0.02em' }}>
            <span className="num">{money(total)}</span>{' '}
            <span className="dim" style={{ fontSize: 'var(--t-small)', fontWeight: 400 }}>
              · {visible.length} {visible.length === 1 ? 'item' : 'items'}
            </span>
          </div>
        </div>
        <div className="row" style={{ gap: 'var(--s-2)', flexWrap: 'wrap' }}>
          {!locked && (
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => setBulkAdding(true)}
            >
              <IconPlus /> Add several
            </button>
          )}
          <Segmented
            ariaLabel="Sort expenses"
            value={sort}
            onChange={setSort}
            options={[
              { value: 'date', label: 'By date' },
              { value: 'amount', label: 'By amount' },
            ]}
          />
        </div>
      </div>

      {used.length > 1 && (
        <div className="chiprow">
          <button
            className="chip"
            aria-pressed={categoryFilter === null}
            onClick={() => setCategoryFilter(null)}
          >
            All
          </button>
          {used.map((c) => (
            <button
              key={c.id}
              className="chip"
              aria-pressed={categoryFilter === c.id}
              onClick={() => setCategoryFilter(categoryFilter === c.id ? null : c.id)}
            >
              <span className="chip__dot" style={{ background: c.color }} />
              {c.name}
            </button>
          ))}
        </div>
      )}

      <section className="card card--flush">
        {visible.length === 0 ? (
          <EmptyState icon={<IconInbox />} title={`Nothing logged in ${monthLabel(activeMonthId, { year: false })}`}>
            <span>Expenses you log show up here with a running total.</span>
          </EmptyState>
        ) : (
          <div className="list">
            {visible.map((expense) => (
              <button
                className="list__item"
                key={expense.id}
                onClick={() => !locked && setEditing(expense)}
                aria-label={`${expense.description}, ${money(netAmount(expense))}${
                  locked ? ', read-only' : ''
                }`}
              >
                <span
                  className="dot"
                  style={{
                    background: categories.get(expense.category)?.color ?? 'var(--text-tertiary)',
                  }}
                />
                <span className="list__main">
                  <span className="list__title">{expense.description}</span>
                  <span className="list__sub">
                    <span>{formatDayLabel(expense.date, activeMonthId)}</span>
                    <span>·</span>
                    <span>{categories.get(expense.category)?.name ?? 'Uncategorised'}</span>
                    {expense.source === 'recurring' && (
                      <IconRepeat />
                    )}
                    {expense.source === 'csv-added' && <IconUpload />}
                    {expense.reconciliationStatus === 'matched' && <IconLink />}
                    <SplitNote expense={expense} />
                  </span>
                </span>
                <ExpenseAmount expense={expense} />
              </button>
            ))}
          </div>
        )}
      </section>

      {locked && (
        <p className="dim" style={{ fontSize: 'var(--t-micro)', textAlign: 'center' }}>
          This month is reconciled — expenses are read-only.
        </p>
      )}

      {editing && (
        <ExpenseSheet
          monthId={activeMonthId}
          expense={editing}
          allowDelete={!locked}
          onClose={() => setEditing(null)}
        />
      )}

      {bulkAdding && (
        <BulkExpenseSheet monthId={activeMonthId} onClose={() => setBulkAdding(false)} />
      )}
    </div>
  );
}
