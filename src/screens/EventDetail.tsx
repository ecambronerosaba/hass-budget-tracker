import { useState } from 'react';
import { ContributionSheet } from '../components/ContributionSheet';
import { EventSheet } from '../components/EventSheet';
import { ExpenseSheet } from '../components/ExpenseSheet';
import {
  IconArrowLeft,
  IconDownload,
  IconFlag,
  IconInfo,
  IconLock,
  IconWallet,
} from '../components/Icons';
import {
  EmptyState,
  ExpenseAmount,
  Meter,
  Money,
  SectionHeading,
  Segmented,
  SplitNote,
  StatusPill,
  useMoneyFormatter,
} from '../components/ui';
import { currentMonthId, formatDayLabel, monthLabel } from '../lib/dates';
import { isContribution } from '../lib/event';
import type { Expense } from '../types/models';
import {
  useApp,
  useCategoryMap,
  useEvent,
  useEventExpenses,
  useEventSummary,
} from '../state/store';

/**
 * One event, in whichever phase it's in. Saving leads with what's in the fund
 * against the target; spending leads with what's left of the fund. The flip
 * between the two is the point of the screen, so it sits directly under the
 * headline rather than behind a menu.
 */
export function EventDetail({ eventId, onBack }: { eventId: string; onBack: () => void }) {
  const { setEventPhase, coverFromMonth, isLocked, notify } = useApp();
  const event = useEvent(eventId);
  const entries = useEventExpenses(eventId);
  const summary = useEventSummary(eventId);
  const categories = useCategoryMap();
  const money = useMoneyFormatter();

  const [editing, setEditing] = useState(false);
  const [contributing, setContributing] = useState(false);
  const [spending, setSpending] = useState(false);
  const [editingEntry, setEditingEntry] = useState<Expense | null>(null);
  const [confirmingClose, setConfirmingClose] = useState(false);

  if (!event || !summary) return <div className="empty">Loading…</div>;

  const closed = event.phase === 'closed';
  const color = categories.get(event.category)?.color ?? 'var(--text-tertiary)';
  const thisMonth = currentMonthId();
  const entryCount = summary.contributionCount + summary.spendCount;

  // Saving leads with the fund against the target; spending leads with what's
  // left of it. Same meter, different question.
  const headlineLabel =
    event.phase === 'saving' ? 'Set aside so far' : closed ? 'Left over' : 'Left in the fund';
  const headlineValue = event.phase === 'saving' ? summary.saved : summary.fundRemaining;
  const fraction = event.phase === 'saving' ? summary.fractionSaved : summary.fractionSpent;

  return (
    <div className="stack" style={{ ['--gap' as string]: 'var(--s-5)' }}>
      <button className="linkish row" style={{ gap: 6 }} onClick={onBack}>
        <IconArrowLeft />
        All events
      </button>

      <section className="card">
        <div className="headline">
          <span className="headline__label">{headlineLabel}</span>
          <div className="row row--between" style={{ width: '100%', alignItems: 'flex-end' }}>
            <span className="headline__value num">
              <Money amount={Math.abs(headlineValue)} compact />
            </span>
            <button className="linkish" onClick={() => setEditing(true)}>
              {closed ? 'View details' : 'Edit event'}
            </button>
          </div>
          <span className="headline__meta">
            {event.name} · {money(summary.target, { compact: true })} target
            {event.startDate && ` · ${monthLabel(event.startDate.slice(0, 7))}`}
          </span>
        </div>

        <div style={{ marginTop: 'var(--s-5)' }}>
          <Meter
            used={fraction}
            tone={summary.tone}
            label={
              event.phase === 'saving'
                ? `${Math.round(summary.fractionSaved * 100)}% of the target set aside`
                : `${Math.round(summary.fractionSpent * 100)}% of the fund spent`
            }
          />
          <div className="meter-legend">
            <span>
              {event.phase === 'saving'
                ? `${Math.round(summary.fractionSaved * 100)}% of target`
                : `${Math.round(summary.fractionSpent * 100)}% of fund`}
            </span>
            <span>
              {entryCount} {entryCount === 1 ? 'entry' : 'entries'}
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

      {!closed && (
        <section className="card">
          <SectionHeading title="Mode" />
          <Segmented
            ariaLabel="Event mode"
            value={event.phase === 'spending' ? 'spending' : 'saving'}
            onChange={(phase) => setEventPhase(event.id, phase)}
            options={[
              { value: 'saving', label: 'Saving' },
              { value: 'spending', label: 'Spending' },
            ]}
          />
          <p className="stat__note" style={{ marginTop: 'var(--s-3)' }}>
            {event.phase === 'saving'
              ? "Money you set aside counts against the month you set it aside in — that's the line item in your monthly budget."
              : "Spending here draws the fund down and doesn't count against any month. It was already budgeted when you saved it."}
          </p>
          <div style={{ marginTop: 'var(--s-4)' }}>
            {event.phase === 'saving' ? (
              <button
                className="btn btn--primary btn--block"
                onClick={() => setContributing(true)}
              >
                Add to the fund
              </button>
            ) : (
              <button className="btn btn--primary btn--block" onClick={() => setSpending(true)}>
                Log an expense
              </button>
            )}
          </div>
        </section>
      )}

      <div className="statgrid">
        <div className="stat">
          <span className="stat__label">Target</span>
          <span className="stat__value num">
            <Money amount={summary.target} compact />
          </span>
          <span className="stat__note">what it's planned to cost</span>
        </div>
        <div className="stat">
          <span className="stat__label">Set aside</span>
          <span className="stat__value num">
            <Money amount={summary.saved} compact />
          </span>
          <span className="stat__note">
            {summary.contributionCount}{' '}
            {summary.contributionCount === 1 ? 'contribution' : 'contributions'}
          </span>
        </div>
        <div className="stat">
          <span className="stat__label">Spent</span>
          <span className="stat__value num">
            <Money amount={summary.spent} compact />
          </span>
          <span className="stat__note">
            {summary.spendCount} {summary.spendCount === 1 ? 'expense' : 'expenses'}
          </span>
        </div>
        <div className="stat">
          <span className="stat__label">Left in fund</span>
          <span className={`stat__value num ${summary.fundRemaining < 0 ? 'tone-over' : ''}`}>
            <Money amount={summary.fundRemaining} compact />
          </span>
          <span className="stat__note">
            {summary.fundRemaining < 0 ? 'past what was saved' : 'saved but not yet spent'}
          </span>
        </div>
        {/* A closed event has no plan left to pace against. */}
        {summary.perMonthNeeded !== undefined && event.phase === 'saving' && (
          <div className="stat">
            <span className="stat__label">Needed per month</span>
            <span className="stat__value num">
              <Money amount={summary.perMonthNeeded} compact />
            </span>
            <span className="stat__note">
              over {summary.monthsToStart} {summary.monthsToStart === 1 ? 'month' : 'months'}
              {/* The plan and what the target actually needs can differ. Say
                  which is which rather than showing two numbers that look
                  like they disagree. */}
              {event.monthlyContribution > 0 &&
                ` · you plan ${money(event.monthlyContribution, { compact: true })}`}
            </span>
          </div>
        )}
      </div>

      {/*
        Spending past the fund isn't silently absorbed — it's stated, with the
        one action that resolves it honestly: put the money into a month's
        budget, once, deliberately.
      */}
      {summary.unfunded > 0 && !closed && (
        <div className="banner">
          <IconInfo />
          <div className="banner__body">
            <strong>
              <Money amount={summary.unfunded} /> spent beyond the fund.
            </strong>{' '}
            That money hasn't come out of any month's budget yet.{' '}
            <button
              className="linkish"
              onClick={() => coverFromMonth(event.id, thisMonth, summary.unfunded)}
            >
              Cover from {monthLabel(thisMonth, { year: false })}
            </button>
          </div>
        </div>
      )}

      {closed && (
        <div className="banner">
          <IconLock />
          <div className="banner__body">
            <strong>Event closed.</strong> Its entries stay in their months and are read-only
            here.{' '}
            <button className="linkish" onClick={() => setEventPhase(event.id, 'spending')}>
              Reopen
            </button>
          </div>
        </div>
      )}

      <section className="card card--flush">
        <div className="row row--between" style={{ padding: 'var(--s-5) var(--s-5) var(--s-3)' }}>
          <h2 className="section-label">Ledger</h2>
        </div>
        {entries.length === 0 ? (
          <EmptyState icon={<IconFlag />} title="Nothing logged yet">
            <span>
              {event.phase === 'saving'
                ? "Add to the fund and it shows up here, and in that month's budget."
                : 'Log an expense and it draws the fund down.'}
            </span>
          </EmptyState>
        ) : (
          <div className="list">
            {entries.map((entry) => (
              <button
                className="list__item"
                key={entry.id}
                onClick={() => !isLocked(entry.monthId) && setEditingEntry(entry)}
                aria-label={`${entry.description}, ${money(entry.amount)}, ${
                  isContribution(entry) ? 'into the fund' : 'from the fund'
                }${isLocked(entry.monthId) ? ', read-only' : ''}`}
              >
                <span className="dot" style={{ background: color }} />
                <span className="list__main">
                  <span className="list__title">{entry.description}</span>
                  <span className="list__sub">
                    <span>{formatDayLabel(entry.date)}</span>
                    <span>·</span>
                    <span>{isContribution(entry) ? 'into the fund' : 'from the fund'}</span>
                    {isContribution(entry) ? <IconDownload /> : <IconWallet />}
                    <SplitNote expense={entry} />
                  </span>
                </span>
                <ExpenseAmount expense={entry} />
              </button>
            ))}
          </div>
        )}
      </section>

      {!closed && (
        <button
          className="btn btn--ghost btn--block"
          onClick={async () => {
            if (!confirmingClose) {
              setConfirmingClose(true);
              return;
            }
            await setEventPhase(event.id, 'closed');
            notify('Event closed', { detail: event.name });
          }}
        >
          {confirmingClose ? 'Tap again to close it' : 'Close this event'}
        </button>
      )}

      {editing && <EventSheet event={event} onClose={() => setEditing(false)} />}
      {contributing && (
        <ContributionSheet
          event={event}
          monthId={thisMonth}
          onClose={() => setContributing(false)}
        />
      )}
      {spending && (
        <ExpenseSheet
          monthId={thisMonth}
          event={event}
          confirmLabel="Log to the fund"
          onClose={() => setSpending(false)}
        />
      )}
      {editingEntry && (
        <ExpenseSheet
          monthId={editingEntry.monthId}
          expense={editingEntry}
          onClose={() => setEditingEntry(null)}
        />
      )}
    </div>
  );
}
