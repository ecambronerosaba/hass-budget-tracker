import { useMemo, useState } from 'react';
import { CategoryBreakdown } from '../components/CategoryBreakdown';
import { IconArrowLeft, IconHistory, IconLock } from '../components/Icons';
import {
  EmptyState,
  ExpenseAmount,
  Money,
  SectionHeading,
  SplitNote,
  StatusPill,
  useMoneyFormatter,
} from '../components/ui';
import { currentMonthId, formatDayLabel, monthLabel } from '../lib/dates';
import { sumNet } from '../lib/expense';
import { round2 } from '../lib/money';
import type { MonthId } from '../types/models';
import { useApp, useCategoryMap } from '../state/store';

/** Past months at a glance, and read-only detail on the way in (§4.7). */
export function HistoryScreen() {
  const { months, expenses, setActiveMonthId } = useApp();
  const categories = useCategoryMap();
  const money = useMoneyFormatter();
  const [open, setOpen] = useState<MonthId | null>(null);

  const rows = useMemo(() => {
    const now = currentMonthId();
    return months
      .filter((m) => m.id < now || m.status === 'reconciled')
      .map((month) => {
        const monthExpenses = expenses.filter((e) => e.monthId === month.id);
        const total = sumNet(monthExpenses);
        return { month, total, delta: round2(month.budgetTotal - total), count: monthExpenses.length };
      });
  }, [months, expenses]);

  if (open) {
    const row = rows.find((r) => r.month.id === open);
    if (!row) {
      setOpen(null);
      return null;
    }
    const monthExpenses = expenses
      .filter((e) => e.monthId === open)
      .sort((a, b) => b.date.localeCompare(a.date));

    return (
      <div className="stack" style={{ ['--gap' as string]: 'var(--s-4)' }}>
        <button className="linkish row" style={{ gap: 6 }} onClick={() => setOpen(null)}>
          <IconArrowLeft />
          All months
        </button>

        <section className="card">
          <div className="headline">
            <span className="headline__label">{monthLabel(open)}</span>
            <span className="headline__value num">
              <Money amount={row.total} compact />
            </span>
            <span className="headline__meta">
              against {money(row.month.budgetTotal, { compact: true })} ·{' '}
              {row.month.status === 'reconciled' ? 'reconciled' : 'never reconciled'}
            </span>
          </div>
          <div style={{ marginTop: 'var(--s-5)' }}>
            <StatusPill tone={row.delta < 0 ? 'over' : 'good'}>
              {money(Math.abs(row.delta), { compact: true })} {row.delta < 0 ? 'over' : 'under'}
            </StatusPill>
          </div>
        </section>

        <section className="card">
          <SectionHeading title="By category" />
          <CategoryBreakdown expenses={monthExpenses} />
        </section>

        <section className="card card--flush">
          <div style={{ padding: 'var(--s-5) var(--s-5) var(--s-3)' }}>
            <h2 className="section-label">
              {monthExpenses.length} {monthExpenses.length === 1 ? 'expense' : 'expenses'}
            </h2>
          </div>
          <div className="list">
            {monthExpenses.map((expense) => (
              <div className="list__item" key={expense.id}>
                <span
                  className="dot"
                  style={{
                    background: categories.get(expense.category)?.color ?? 'var(--text-tertiary)',
                  }}
                />
                <span className="list__main">
                  <span className="list__title">{expense.description}</span>
                  <span className="list__sub">
                    <span>{formatDayLabel(expense.date, open)}</span>
                    <span>·</span>
                    <span>{categories.get(expense.category)?.name ?? 'Uncategorised'}</span>
                    <SplitNote expense={expense} />
                  </span>
                </span>
                <ExpenseAmount expense={expense} />
              </div>
            ))}
          </div>
        </section>

        {row.month.status === 'reconciled' && (
          <div className="banner">
            <IconLock />
            <div className="banner__body">Closed month — read-only.</div>
          </div>
        )}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState icon={<IconHistory />} title="No past months yet">
        <span>Once a month ends, it shows up here with its final total.</span>
      </EmptyState>
    );
  }

  return (
    <div className="stack" style={{ ['--gap' as string]: 'var(--s-4)' }}>
      <SectionHeading title="Past months" />
      <section className="card card--flush">
        <div className="list">
          {rows.map(({ month, total, delta, count }) => (
            <button
              className="list__item"
              key={month.id}
              onClick={() => {
                setActiveMonthId(month.id);
                setOpen(month.id);
              }}
            >
              <span className="list__main">
                <span className="list__title">{monthLabel(month.id)}</span>
                <span className="list__sub">
                  <span>
                    {money(total)} of {money(month.budgetTotal, { compact: true })}
                  </span>
                  <span>·</span>
                  <span>
                    {count} {count === 1 ? 'expense' : 'expenses'}
                  </span>
                  {month.status !== 'reconciled' && (
                    <>
                      <span>·</span>
                      <span>not reconciled</span>
                    </>
                  )}
                </span>
              </span>
              <span className={`list__amount num ${delta < 0 ? 'tone-over' : 'tone-good'}`}>
                {money(Math.abs(delta), { compact: true })} {delta < 0 ? 'over' : 'under'}
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
