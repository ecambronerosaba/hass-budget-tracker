import { useMemo, useState } from 'react';
import type { Expense, Month, ReconciliationSession } from '../../types/models';
import { reconciliationTotals } from '../../lib/reconcile';
import { monthLabel } from '../../lib/dates';
import { round2 } from '../../lib/money';
import { CategoryBreakdown } from '../../components/CategoryBreakdown';
import { IconInfo, IconLock } from '../../components/Icons';
import { Money, SectionHeading, StatusPill, useMoneyFormatter } from '../../components/ui';
import { useApp } from '../../state/store';

/**
 * Closing the month (§4.6). The number is stated plainly, over or under, with
 * no commentary attached to it — the figure is the point, not a verdict.
 */
export function SummaryStep({
  month,
  session,
  expenses,
  unresolved,
  onBack,
  onReview,
}: {
  month: Month;
  session: ReconciliationSession;
  expenses: Expense[];
  /** Statement rows and logged expenses still awaiting a decision. */
  unresolved: { queueA: number; queueB: number };
  onBack: () => void;
  /** Jumps back to whichever queue still has something unresolved. */
  onReview: (stage: 'queue-a' | 'queue-b') => void;
}) {
  const { finishReconciliation, notify } = useApp();
  const money = useMoneyFormatter();
  const [closing, setClosing] = useState(false);

  const totals = useMemo(() => reconciliationTotals(expenses), [expenses]);
  const delta = round2(month.budgetTotal - totals.verifiedTotal);
  const over = delta < 0;
  const unresolvedTotal = unresolved.queueA + unresolved.queueB;

  return (
    <div className="stack" style={{ ['--gap' as string]: 'var(--s-4)' }}>
      <section className="card">
        <div className="headline">
          <span className="headline__label">
            Verified total for {monthLabel(month.id, { year: false })}
          </span>
          <span className="headline__value num">
            <Money amount={totals.verifiedTotal} compact />
          </span>
          <span className="headline__meta">
            against a {money(month.budgetTotal, { compact: true })} budget
          </span>
        </div>
        <div style={{ marginTop: 'var(--s-5)' }}>
          <StatusPill tone={over ? 'over' : 'good'}>
            {money(Math.abs(delta), { compact: true })} {over ? 'over' : 'under'}
          </StatusPill>
        </div>
      </section>

      <section className="card">
        <SectionHeading title="What's in that number" />
        <div className="kv">
          <span className="kv__k">Matched to the statement</span>
          <span className="num">
            {totals.counts.matched} · {money(totals.matched)}
          </span>
        </div>
        <div className="kv">
          <span className="kv__k">Added from the statement</span>
          <span className="num">
            {totals.counts.csvAdded} · {money(totals.csvAdded)}
          </span>
        </div>
        <div className="kv">
          <span className="kv__k">Kept without a statement row</span>
          <span className="num">
            {totals.counts.loggedOnly} · {money(totals.loggedOnly)}
          </span>
        </div>
        {totals.reimbursed > 0 && (
          <div className="kv">
            <span className="kv__k">Covered by someone else</span>
            <span className="num">− {money(totals.reimbursed)}</span>
          </div>
        )}
        <div className="kv">
          <span className="kv__k">Statement rows read</span>
          <span className="num">{session.transactions.length}</span>
        </div>
        {session.excluded.credits > 0 && (
          <div className="kv">
            <span className="kv__k">Credits and refunds left out</span>
            <span className="num">{session.excluded.credits}</span>
          </div>
        )}
        {session.excluded.outsideMonth > 0 && (
          <div className="kv">
            <span className="kv__k">Rows outside {monthLabel(month.id, { short: true })}</span>
            <span className="num">{session.excluded.outsideMonth}</span>
          </div>
        )}
        {session.excluded.unreadable > 0 && (
          <div className="kv">
            <span className="kv__k">Rows that couldn't be read</span>
            <span className="num">{session.excluded.unreadable}</span>
          </div>
        )}
      </section>

      <section className="card">
        <SectionHeading title="By category" />
        <CategoryBreakdown expenses={expenses} />
      </section>

      {unresolvedTotal > 0 && (
        <div className="banner">
          <IconInfo />
          <div className="banner__body">
            <div>
              Still needs a decision before this month can close:{' '}
              {unresolved.queueA > 0 &&
                `${unresolved.queueA} statement ${unresolved.queueA === 1 ? 'row' : 'rows'}`}
              {unresolved.queueA > 0 && unresolved.queueB > 0 && ' and '}
              {unresolved.queueB > 0 &&
                `${unresolved.queueB} logged ${unresolved.queueB === 1 ? 'expense' : 'expenses'}`}
              .
            </div>
            <div className="row" style={{ gap: 'var(--s-3)', marginTop: 'var(--s-3)', flexWrap: 'wrap' }}>
              {unresolved.queueA > 0 && (
                <button className="btn btn--ghost btn--sm" onClick={() => onReview('queue-a')}>
                  Review the statement
                </button>
              )}
              {unresolved.queueB > 0 && (
                <button className="btn btn--ghost btn--sm" onClick={() => onReview('queue-b')}>
                  Review what you logged
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="banner">
        <IconLock />
        <div className="banner__body">
          Closing locks this month's budget and expenses so past reports stay accurate. You can
          still read everything in History.
        </div>
      </div>

      <div className="stack" style={{ ['--gap' as string]: 'var(--s-3)' }}>
        <button
          className="btn btn--primary btn--block"
          disabled={closing || unresolvedTotal > 0}
          title={unresolvedTotal > 0 ? 'Finish reviewing both queues first' : undefined}
          onClick={async () => {
            setClosing(true);
            try {
              await finishReconciliation(month.id);
              notify(`${monthLabel(month.id, { year: false })} closed`, {
                detail: `${money(Math.abs(delta), { compact: true })} ${over ? 'over' : 'under'}`,
                tone: over ? 'over' : 'good',
              });
            } finally {
              setClosing(false);
            }
          }}
        >
          Close {monthLabel(month.id, { year: false })}
        </button>
        <button className="btn btn--ghost btn--block" onClick={onBack}>
          Back to the review
        </button>
      </div>
    </div>
  );
}
