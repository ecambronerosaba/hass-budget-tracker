import { useMemo, useState } from 'react';
import { BudgetSheet } from '../components/BudgetSheet';
import { CategoryBreakdown } from '../components/CategoryBreakdown';
import { RecurringNudges } from '../components/RecurringNudges';
import { ExpenseSheet } from '../components/ExpenseSheet';
import {
  IconArrowRight,
  IconInbox,
  IconLock,
  IconReconcile,
  IconRepeat,
} from '../components/Icons';
import {
  EmptyState,
  ExpenseAmount,
  Meter,
  Money,
  SectionHeading,
  SplitNote,
  StatusPill,
  useMoneyFormatter,
} from '../components/ui';
import { currentMonthId, formatDayLabel, monthLabel, today } from '../lib/dates';
import { countsAgainstMonth, summarizeBucket } from '../lib/bucket';
import { summarizeMonth } from '../lib/projection';
import type { Expense } from '../types/models';
import {
  useApp,
  useCategoryMap,
  useMonth,
  useMonthExpenses,
  useSession,
} from '../state/store';
import type { Screen } from '../App';

export function Dashboard({ onNavigate }: { onNavigate: (screen: Screen) => void }) {
  const { activeMonthId, recurring, buckets, expenses: allExpenses, isLocked } = useApp();
  const month = useMonth(activeMonthId);
  const monthExpenses = useMonthExpenses(activeMonthId);
  const session = useSession(activeMonthId);
  const categories = useCategoryMap();
  const money = useMoneyFormatter();

  const [budgetOpen, setBudgetOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);

  // The month's own spending. Bucket spending was budgeted in the month it
  // was set aside, so it is not part of what this month cost, how it was
  // split up, or what the "Recent" list is a recent slice of.
  const expenses = useMemo(
    () => monthExpenses.filter(countsAgainstMonth),
    [monthExpenses],
  );

  const summary = useMemo(
    () => (month ? summarizeMonth({ month, expenses: monthExpenses, recurring, buckets }) : null),
    [month, monthExpenses, recurring, buckets],
  );

  if (!month || !summary) {
    return <div className="empty">Loading…</div>;
  }

  const hasBudget = month.budgetTotal > 0;
  const monthEnded = activeMonthId < currentMonthId();
  const nearMonthEnd = summary.daysRemaining <= 3;
  const showReconcileCta =
    month.status === 'open' && (monthEnded || nearMonthEnd || Boolean(session));

  return (
    <div className="stack" style={{ ['--gap' as string]: 'var(--s-5)' }}>
      {!hasBudget && (
        <div className="card">
          <h2 style={{ fontSize: 'var(--t-heading)', fontWeight: 600, marginBottom: 6 }}>
            Set a budget for {monthLabel(activeMonthId, { year: false })}
          </h2>
          <p className="muted" style={{ fontSize: 'var(--t-small)', marginBottom: 'var(--s-4)' }}>
            One total for the month. Everything else on this screen works off that number.
          </p>
          <button className="btn btn--primary" onClick={() => setBudgetOpen(true)}>
            Set budget
          </button>
        </div>
      )}

      {hasBudget && (
        <section className="card">
          <div className="headline">
            <span className="headline__label">
              {summary.remaining >= 0 ? 'Left this month' : 'Past budget'}
            </span>
            <div className="row row--between" style={{ width: '100%', alignItems: 'flex-end' }}>
              <span className="headline__value num">
                <Money amount={Math.abs(summary.remaining)} compact />
              </span>
              <button className="linkish" onClick={() => setBudgetOpen(true)}>
                {month.status === 'reconciled' ? 'View budget' : 'Adjust budget'}
              </button>
            </div>
            <span className="headline__meta">
              {money(summary.spent)} of {money(month.budgetTotal, { compact: true })} logged
              {summary.reimbursed > 0 &&
                ` · ${money(summary.reimbursed)} of it coming back to you`}
              {month.status === 'reconciled' && ' · reconciled'}
            </span>
          </div>

          <div style={{ marginTop: 'var(--s-5)' }}>
            <Meter
              used={summary.fractionUsed}
              elapsed={month.status === 'reconciled' ? undefined : summary.fractionElapsed}
              tone={summary.tone}
              label={`${Math.round(summary.fractionUsed * 100)}% of budget used, day ${
                summary.daysElapsed
              } of ${summary.daysTotal}`}
            />
            <div className="meter-legend">
              <span>{Math.round(summary.fractionUsed * 100)}% of budget used</span>
              <span>
                {month.status === 'reconciled'
                  ? 'Month closed'
                  : `Day ${summary.daysElapsed} of ${summary.daysTotal}`}
              </span>
            </div>
          </div>

          <div style={{ marginTop: 'var(--s-5)' }}>
            <StatusPill tone={summary.tone}>{summary.statusLabel}</StatusPill>
            <p className="muted" style={{ fontSize: 'var(--t-small)', marginTop: 'var(--s-3)' }}>
              {summary.statusDetail}
            </p>
          </div>
        </section>
      )}

      {hasBudget && (
        <div className="statgrid">
          <div className="stat">
            <span className="stat__label">Logged</span>
            <span className="stat__value num">
              <Money amount={summary.spent} compact />
            </span>
            <span className="stat__note">
              {summary.expenseCount} {summary.expenseCount === 1 ? 'expense' : 'expenses'}
            </span>
          </div>
          <div className="stat">
            <span className="stat__label">Budget</span>
            <span className="stat__value num">
              <Money amount={month.budgetTotal} compact />
            </span>
            <span className="stat__note">
              {summary.isFinal ? 'locked for this month' : 'one total for the month'}
            </span>
          </div>

          {/* A closed month has no future to project into. */}
          {!summary.isFinal && (
            <>
              <div className="stat">
                <span className="stat__label">Projected</span>
                <span
                  className={`stat__value num ${
                    summary.projectedDelta > 0 ? 'tone-over' : 'tone-good'
                  }`}
                >
                  <Money amount={summary.projectedTotal} compact />
                </span>
                <span className="stat__note">
                  {summary.projectedDelta > 0 ? 'over' : 'under'} by{' '}
                  {money(Math.abs(summary.projectedDelta), { compact: true })}
                </span>
              </div>
              <div className="stat">
                <span className="stat__label">Daily allowance</span>
                <span className="stat__value num">
                  <Money amount={summary.dailyAllowance} compact />
                </span>
                <span className="stat__note">
                  {summary.daysRemaining} {summary.daysRemaining === 1 ? 'day' : 'days'} left
                </span>
              </div>
              <div className="stat">
                <span className="stat__label">Still expected</span>
                <span className="stat__value num">
                  <Money amount={summary.upcomingTotal} compact />
                </span>
                <span className="stat__note">
                  {summary.upcoming.length === 0
                    ? 'nothing recurring pending'
                    : `${summary.upcoming.length} recurring ${
                        summary.upcoming.length === 1 ? 'item' : 'items'
                      }`}
                </span>
              </div>
            </>
          )}
        </div>
      )}

      <RecurringNudges month={month} recurring={recurring} />

      {showReconcileCta && (
        <button
          className="card row row--between"
          style={{ textAlign: 'left', width: '100%' }}
          onClick={() => onNavigate('reconcile')}
        >
          <span className="row" style={{ gap: 'var(--s-3)' }}>
            <span className="dim">
              <IconReconcile />
            </span>
            <span>
              <span style={{ display: 'block' }}>
                {session ? 'Finish reconciling' : 'Reconcile this month'}
              </span>
              <span className="stat__note">
                {session
                  ? 'You have a review in progress.'
                  : 'Import your statement and check it against what you logged.'}
              </span>
            </span>
          </span>
          <span className="dim">
            <IconArrowRight />
          </span>
        </button>
      )}

      {month.status === 'reconciled' && (
        <div className="banner">
          <IconLock />
          <div className="banner__body">
            <strong>Month closed.</strong> Reconciled on{' '}
            {month.reconciledAt
              ? new Date(month.reconciledAt).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                })
              : 'a past date'}
            . The budget and expenses are read-only now.
          </div>
        </div>
      )}

      {(summary.upcoming.length > 0 || summary.upcomingBuckets.length > 0) &&
        month.status === 'open' && (
        <section className="card">
          <SectionHeading title="Expected this month" />
          <p className="muted" style={{ fontSize: 'var(--t-small)', marginBottom: 'var(--s-4)' }}>
            Counted in the projection, not in what you've spent — until you confirm each one.
          </p>
          <div className="stack" style={{ ['--gap' as string]: 'var(--s-3)' }}>
            {summary.upcoming.map(({ recurring: item, expectedDate, due }) => (
              <div className="row row--between" key={item.id}>
                <span className="row" style={{ gap: 'var(--s-2)', minWidth: 0 }}>
                  <span
                    className="dot"
                    style={{ background: categories.get(item.category)?.color ?? 'var(--text-tertiary)' }}
                  />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.description}
                  </span>
                </span>
                <span className="row" style={{ gap: 'var(--s-3)' }}>
                  <span className="stat__note">
                    {due ? 'due' : formatDayLabel(expectedDate)}
                  </span>
                  <Money amount={item.amount} compact />
                </span>
              </div>
            ))}
            {summary.upcomingBuckets.map(({ bucket, amount }) => (
              <div className="row row--between" key={bucket.id}>
                <span className="row" style={{ gap: 'var(--s-2)', minWidth: 0 }}>
                  <span
                    className="dot"
                    style={{
                      background: categories.get(bucket.category)?.color ?? 'var(--text-tertiary)',
                    }}
                  />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {bucket.name} fund
                  </span>
                </span>
                <span className="row" style={{ gap: 'var(--s-3)' }}>
                  <span className="stat__note">to set aside</span>
                  <Money amount={amount} compact />
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {buckets.some((b) => b.phase !== 'closed') && (
        <section className="card card--flush">
          <div className="row row--between" style={{ padding: 'var(--s-5) var(--s-5) var(--s-3)' }}>
            <h2 className="section-label">Buckets</h2>
            <button className="linkish" onClick={() => onNavigate('buckets')}>
              See all
            </button>
          </div>
          <div className="list">
            {buckets
              .filter((b) => b.phase !== 'closed')
              .map((bucket) => {
                // A bucket's fund spans months, so this reads the whole
                // ledger rather than the month on screen.
                const s = summarizeBucket({
                  bucket,
                  expenses: allExpenses.filter((x) => x.bucketId === bucket.id),
                });
                return (
                  <button
                    className="list__item"
                    key={bucket.id}
                    onClick={() => onNavigate('buckets')}
                  >
                    <span
                      className="dot"
                      style={{
                        background:
                          categories.get(bucket.category)?.color ?? 'var(--text-tertiary)',
                      }}
                    />
                    <span className="list__main">
                      <span className="list__title">{bucket.name}</span>
                      <span className="list__sub">
                        <span>{bucket.phase === 'saving' ? 'Saving' : 'Spending'}</span>
                        <span>·</span>
                        <span>
                          {money(s.saved)} of {money(s.target, { compact: true })}
                        </span>
                        {s.contributedThisMonth > 0 && (
                          <>
                            <span>·</span>
                            <span>{money(s.contributedThisMonth)} this month</span>
                          </>
                        )}
                      </span>
                    </span>
                    <span className="list__amount num">
                      <Money
                        amount={bucket.phase === 'saving' ? s.targetRemaining : s.fundRemaining}
                        compact
                      />
                    </span>
                  </button>
                );
              })}
          </div>
        </section>
      )}

      <section className="card">
        <SectionHeading title="By category" />
        <CategoryBreakdown expenses={expenses} />
      </section>

      <section className="card card--flush">
        <div className="row row--between" style={{ padding: 'var(--s-5) var(--s-5) var(--s-3)' }}>
          <h2 className="section-label">Recent</h2>
          <button className="linkish" onClick={() => onNavigate('expenses')}>
            See all
          </button>
        </div>
        {expenses.length === 0 ? (
          <EmptyState icon={<IconInbox />} title="Nothing logged yet">
            <span>Tap the + button to log your first expense.</span>
          </EmptyState>
        ) : (
          <div className="list">
            {expenses.slice(0, 5).map((expense) => (
              <button
                className="list__item"
                key={expense.id}
                onClick={() => !isLocked(activeMonthId) && setEditing(expense)}
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
                    {expense.source === 'recurring' && <IconRepeat />}
                    <SplitNote expense={expense} />
                  </span>
                </span>
                <ExpenseAmount expense={expense} />
              </button>
            ))}
          </div>
        )}
      </section>

      <p className="dim" style={{ fontSize: 'var(--t-micro)', textAlign: 'center' }}>
        {monthLabel(activeMonthId)} · today is {formatDayLabel(today())}
      </p>

      {budgetOpen && <BudgetSheet monthId={activeMonthId} onClose={() => setBudgetOpen(false)} />}
      {editing && (
        <ExpenseSheet
          monthId={activeMonthId}
          expense={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
