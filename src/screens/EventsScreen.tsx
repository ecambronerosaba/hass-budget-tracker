import { useMemo, useState } from 'react';
import { EventDetail } from './EventDetail';
import { EventSheet } from '../components/EventSheet';
import { IconFlag } from '../components/Icons';
import { EmptyState, Money, SectionHeading, useMoneyFormatter } from '../components/ui';
import { summarizeEvent } from '../lib/event';
import type { BudgetEvent } from '../types/models';
import { useApp, useCategoryMap } from '../state/store';

const PHASE_LABEL: Record<BudgetEvent['phase'], string> = {
  saving: 'Saving',
  spending: 'Spending',
  closed: 'Closed',
};

/**
 * Budgets that aren't months: a trip, a wedding, a laptop. Same drill-in
 * shape as History — a list here, one thing at a time in the detail — because
 * an event is read one at a time and the list is only ever a few rows long.
 */
export function EventsScreen() {
  const { events, expenses } = useApp();
  const categories = useCategoryMap();
  const money = useMoneyFormatter();
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const rows = useMemo(
    () =>
      events.map((event) => ({
        event,
        summary: summarizeEvent({
          event,
          expenses: expenses.filter((e) => e.eventId === event.id),
        }),
      })),
    [events, expenses],
  );

  const active = rows.filter((r) => r.event.phase !== 'closed');
  const closed = rows.filter((r) => r.event.phase === 'closed');

  if (open) {
    // An event deleted out from under this view falls back to the list rather
    // than rendering a blank detail screen.
    if (!rows.some((r) => r.event.id === open)) {
      setOpen(null);
      return null;
    }
    return <EventDetail eventId={open} onBack={() => setOpen(null)} />;
  }

  return (
    <div className="stack" style={{ ['--gap' as string]: 'var(--s-4)' }}>
      <div className="row row--between" style={{ gap: 'var(--s-3)', alignItems: 'flex-start' }}>
        <div>
          <div className="section-label">Events</div>
          <p className="muted" style={{ fontSize: 'var(--t-small)', marginTop: 4 }}>
            A budget that isn't a month. Save toward it, then spend from it.
          </p>
        </div>
        <button className="btn btn--primary btn--sm" onClick={() => setCreating(true)}>
          New event
        </button>
      </div>

      {rows.length === 0 ? (
        <section className="card">
          <EmptyState icon={<IconFlag />} title="No events yet">
            <span>
              A trip, a wedding, a new laptop — anything you save for over more than one
              month.
            </span>
          </EmptyState>
        </section>
      ) : (
        active.length > 0 && (
          <section className="card card--flush">
            <div className="list">
              {active.map(({ event, summary }) => (
                <EventRow
                  key={event.id}
                  event={event}
                  fraction={
                    event.phase === 'spending' ? summary.fractionSpent : summary.fractionSaved
                  }
                  color={categories.get(event.category)?.color ?? 'var(--text-tertiary)'}
                  sub={
                    event.phase === 'spending'
                      ? `${PHASE_LABEL[event.phase]} · ${money(summary.spent)} of ${money(
                          summary.saved,
                          { compact: true },
                        )} in the fund`
                      : `${PHASE_LABEL[event.phase]} · ${money(summary.saved)} of ${money(
                          summary.target,
                          { compact: true },
                        )}`
                  }
                  amount={
                    event.phase === 'spending' ? summary.fundRemaining : summary.targetRemaining
                  }
                  amountNote={event.phase === 'spending' ? 'left in fund' : 'still to save'}
                  onOpen={() => setOpen(event.id)}
                />
              ))}
            </div>
          </section>
        )
      )}

      {closed.length > 0 && (
        <>
          <SectionHeading title="Closed" />
          <section className="card card--flush">
            <div className="list">
              {closed.map(({ event, summary }) => (
                <EventRow
                  key={event.id}
                  event={event}
                  fraction={summary.fractionSpent}
                  color={categories.get(event.category)?.color ?? 'var(--text-tertiary)'}
                  sub={`Closed · ${money(summary.spent)} spent of ${money(summary.saved, {
                    compact: true,
                  })} saved`}
                  amount={summary.fundRemaining}
                  amountNote="left over"
                  onOpen={() => setOpen(event.id)}
                />
              ))}
            </div>
          </section>
        </>
      )}

      {creating && (
        <EventSheet
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setOpen(id);
          }}
        />
      )}
    </div>
  );
}

function EventRow({
  event,
  fraction,
  color,
  sub,
  amount,
  amountNote,
  onOpen,
}: {
  event: BudgetEvent;
  fraction: number;
  color: string;
  sub: string;
  amount: number;
  amountNote: string;
  onOpen: () => void;
}) {
  const money = useMoneyFormatter();
  return (
    <button
      className="list__item eventrow"
      onClick={onOpen}
      aria-label={`${event.name}, ${sub}, ${money(amount)} ${amountNote}`}
    >
      <span className="dot" style={{ background: color }} />
      <span className="list__main">
        <span className="list__title" style={{ opacity: event.phase === 'closed' ? 0.6 : 1 }}>
          {event.name}
        </span>
        <span className="list__sub">
          <span>{sub}</span>
        </span>
        <span className="catbar__track" style={{ marginTop: 6 }} aria-hidden="true">
          <span
            className="catbar__fill"
            style={{
              width: `${Math.min(100, Math.max(0, fraction * 100))}%`,
              background: color,
            }}
          />
        </span>
      </span>
      <span className="list__amount num">
        <Money amount={amount} compact />
      </span>
    </button>
  );
}
