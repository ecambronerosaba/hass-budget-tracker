import { useMemo } from 'react';
import { ImportStep } from './reconcile/ImportStep';
import { QueueA } from './reconcile/QueueA';
import { QueueB } from './reconcile/QueueB';
import { SummaryStep } from './reconcile/SummaryStep';
import { IconCheck, IconLink } from '../components/Icons';
import { Money, useMoneyFormatter } from '../components/ui';
import { formatDayLabel, monthLabel } from '../lib/dates';
import type { ReconcileStage } from '../types/models';
import { useApp, useMonth, useMonthExpenses, useSession } from '../state/store';

/**
 * The stage tabs (§4.6). Hand-rolled rather than the shared `Segmented`
 * because "Total" needs to be visibly, individually disabled while
 * something's unresolved — `Segmented` only supports enabling every option.
 * Same markup and CSS classes as `Segmented`, so it looks identical.
 */
function StageTabs({
  stage,
  onChange,
  summaryDisabled,
  disabledReason,
}: {
  stage: ReconcileStage;
  onChange: (stage: 'queue-a' | 'queue-b' | 'summary') => void;
  summaryDisabled: boolean;
  disabledReason: string;
}) {
  const options: { value: 'queue-a' | 'queue-b' | 'summary'; label: string; disabled?: boolean }[] = [
    { value: 'queue-a', label: 'Statement' },
    { value: 'queue-b', label: 'Logged' },
    { value: 'summary', label: 'Total', disabled: summaryDisabled },
  ];
  const value = stage === 'import' ? 'queue-a' : stage;
  return (
    <div className="segmented" role="group" aria-label="Reconciliation stage">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          aria-disabled={o.disabled || undefined}
          disabled={o.disabled}
          title={o.disabled ? disabledReason : undefined}
          style={o.disabled ? { opacity: 0.42, cursor: 'not-allowed' } : undefined}
          onClick={() => !o.disabled && onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The month-end flow (§4.5–4.6): import, then two queues, then close.
 * The stage lives in the session record, so a refresh or a day's gap picks up
 * exactly where the user left off.
 */
export function ReconcileScreen() {
  const {
    activeMonthId,
    setReconcileStage,
    cancelReconciliation,
    notify,
    preferences,
    setPreference,
    unresolvedCounts,
  } = useApp();
  const month = useMonth(activeMonthId);
  const expenses = useMonthExpenses(activeMonthId);
  const session = useSession(activeMonthId);
  const money = useMoneyFormatter();
  const showMatched = preferences.showMatchedPanel;
  const unresolved = unresolvedCounts(activeMonthId);
  const unresolvedTotal = unresolved.queueA + unresolved.queueB;
  const unresolvedReason =
    unresolvedTotal > 0
      ? `Finish reviewing ${
          [
            unresolved.queueA > 0 &&
              `${unresolved.queueA} statement ${unresolved.queueA === 1 ? 'row' : 'rows'}`,
            unresolved.queueB > 0 &&
              `${unresolved.queueB} logged ${unresolved.queueB === 1 ? 'expense' : 'expenses'}`,
          ]
            .filter(Boolean)
            .join(' and ')
        } first`
      : '';

  const matched = useMemo(
    () => session?.transactions.filter((t) => t.matchStatus === 'matched') ?? [],
    [session],
  );
  const expenseById = useMemo(() => new Map(expenses.map((e) => [e.id, e])), [expenses]);

  if (!month) return <div className="empty">Loading…</div>;

  if (month.status === 'reconciled') {
    return (
      <section className="card" style={{ textAlign: 'center' }}>
        <div className="tone-good" style={{ display: 'flex', justifyContent: 'center' }}>
          <IconCheck className="" />
        </div>
        <h2 style={{ fontSize: 'var(--t-heading)', fontWeight: 600, margin: '10px 0 6px' }}>
          {monthLabel(activeMonthId)} is closed
        </h2>
        <p className="muted" style={{ fontSize: 'var(--t-small)' }}>
          It's been reconciled against a statement. Switch months from the header to reconcile a
          different one.
        </p>
      </section>
    );
  }

  if (!session) {
    return <ImportStep monthId={activeMonthId} />;
  }

  return (
    <div className="stack" style={{ ['--gap' as string]: 'var(--s-4)' }}>
      <div className="stack" style={{ ['--gap' as string]: 'var(--s-2)' }}>
        <div className="row row--between" style={{ flexWrap: 'wrap', gap: 'var(--s-3)' }}>
          <StageTabs
            stage={session.stage}
            onChange={(stage) => setReconcileStage(activeMonthId, stage)}
            summaryDisabled={unresolvedTotal > 0}
            disabledReason={unresolvedReason}
          />
          <button
            className="linkish"
            onClick={async () => {
              const removed = await cancelReconciliation(activeMonthId);
              notify('Import discarded', {
                detail:
                  removed > 0
                    ? `${removed} ${removed === 1 ? 'expense' : 'expenses'} added from the statement ${
                        removed === 1 ? 'was' : 'were'
                      } removed too`
                    : 'Nothing you logged was changed',
              });
            }}
          >
            Start over
          </button>
        </div>
        {unresolvedTotal > 0 && (
          <p className="dim" style={{ fontSize: 'var(--t-micro)' }}>
            {unresolvedReason} to see the total.
          </p>
        )}
      </div>

      {session.stage === 'summary' ? (
        <SummaryStep
          month={month}
          session={session}
          expenses={expenses}
          unresolved={unresolved}
          onBack={() => setReconcileStage(activeMonthId, 'queue-b')}
          onReview={(stage) => setReconcileStage(activeMonthId, stage)}
        />
      ) : session.stage === 'queue-b' ? (
        <QueueB
          monthId={activeMonthId}
          session={session}
          expenses={expenses}
          onDone={() => setReconcileStage(activeMonthId, 'summary')}
        />
      ) : (
        <QueueA
          monthId={activeMonthId}
          session={session}
          expenses={expenses}
          onDone={() => setReconcileStage(activeMonthId, 'queue-b')}
        />
      )}

      {matched.length > 0 && session.stage !== 'summary' && (
        <section className="card card--flush">
          <button
            className="row row--between"
            style={{ width: '100%', padding: 'var(--s-4) var(--s-5)' }}
            onClick={() => setPreference('showMatchedPanel', !showMatched)}
            aria-expanded={showMatched}
          >
            <span className="row" style={{ gap: 'var(--s-3)' }}>
              <span className="dim">
                <IconLink />
              </span>
              <span style={{ fontSize: 'var(--t-small)' }}>
                {matched.length} matched automatically
              </span>
            </span>
            <span className="linkish">{showMatched ? 'Hide' : 'View'}</span>
          </button>
          {showMatched && (
            <div className="list">
              {matched.map((txn) => {
                const expense = txn.matchedExpenseId
                  ? expenseById.get(txn.matchedExpenseId)
                  : undefined;
                return (
                  <div className="list__item" key={txn.id}>
                    <span className="list__main">
                      <span className="list__title">{txn.rawDescription}</span>
                      <span className="list__sub">
                        <span>{formatDayLabel(txn.date, activeMonthId)}</span>
                        {expense && (
                          <>
                            <span>·</span>
                            <span>logged as {expense.description}</span>
                          </>
                        )}
                      </span>
                    </span>
                    <span className="list__amount num">
                      <Money amount={txn.amount} />
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {session.fileName && (
        <p className="dim" style={{ fontSize: 'var(--t-micro)', textAlign: 'center' }}>
          From {session.fileName} · {session.transactions.length} rows ·{' '}
          {money(session.transactions.reduce((sum, t) => sum + t.amount, 0))} on the statement
        </p>
      )}
    </div>
  );
}
