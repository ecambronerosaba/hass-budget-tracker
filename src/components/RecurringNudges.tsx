import { useState } from 'react';
import type { Month, RecurringExpense } from '../types/models';
import { dueRecurringNudges } from '../lib/projection';
import { expectedDateFor, formatDayLabel, monthLabel } from '../lib/dates';
import { useApp } from '../state/store';
import { ExpenseSheet } from './ExpenseSheet';
import { IconRepeat } from './Icons';
import { Money, useMoneyFormatter } from './ui';

/**
 * Recurring items are never auto-logged (§4.4). When one comes due the app
 * asks, and the two common answers — log it, or not yet — are one tap each.
 * "Not yet" (a 3-day snooze) is a different claim than "not this month": a
 * cancelled subscription that snoozes forever still nags every three days, so
 * a second, deliberately less prominent row holds the choices that settle it
 * for good — skip this month, or log a different amount — rather than a
 * fourth button competing with the two common ones.
 */
export function RecurringNudges({
  month,
  recurring,
}: {
  month: Month;
  recurring: RecurringExpense[];
}) {
  const { confirmRecurring, snoozeRecurring, skipRecurring, notify } = useApp();
  const money = useMoneyFormatter();
  const [editing, setEditing] = useState<RecurringExpense | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const due = dueRecurringNudges(month, recurring);

  if (month.status === 'reconciled' || due.length === 0) return null;

  return (
    <>
      <div className="stack" style={{ ['--gap' as string]: 'var(--s-3)' }}>
        {due.map(({ recurring: item }) => (
          <div className="card" key={item.id} style={{ padding: 'var(--s-4)' }}>
            <div className="row" style={{ alignItems: 'flex-start', gap: 'var(--s-3)' }}>
              <span className="dim" style={{ marginTop: 2 }}>
                <IconRepeat className="" />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ marginBottom: 2 }}>
                  Did <strong>{item.description}</strong> (<Money amount={item.amount} />) go out
                  this month?
                </div>
                <div className="stat__note">
                  Expected around {formatDayLabel(expectedDateFor(month.id, item.dayOfMonth))} · not
                  counted as spent until you confirm
                </div>
              </div>
            </div>
            <div className="row" style={{ marginTop: 'var(--s-4)', flexWrap: 'wrap' }}>
              <button
                className="btn btn--primary btn--sm"
                onClick={async () => {
                  await confirmRecurring(month.id, item.id);
                  notify(`${item.description} logged`, { detail: money(item.amount) });
                }}
              >
                Yes, log it
              </button>
              <button
                className="btn btn--quiet btn--sm"
                onClick={() => snoozeRecurring(month.id, item.id, 3)}
              >
                Not yet
              </button>
              <button
                className="btn btn--ghost btn--sm"
                aria-expanded={expandedId === item.id}
                aria-label="More options"
                onClick={() => setExpandedId((cur) => (cur === item.id ? null : item.id))}
              >
                More
              </button>
            </div>
            {expandedId === item.id && (
              <div className="row" style={{ marginTop: 'var(--s-3)', flexWrap: 'wrap' }}>
                <button className="btn btn--ghost btn--sm" onClick={() => setEditing(item)}>
                  Different amount
                </button>
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={async () => {
                    await skipRecurring(month.id, item.id);
                    notify(`${item.description} skipped`, {
                      detail: `Not counted for ${monthLabel(month.id, { year: false })}`,
                    });
                    setExpandedId(null);
                  }}
                >
                  Skip this month
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {editing && (
        <ExpenseSheet
          monthId={month.id}
          title={editing.description}
          confirmLabel="Log it"
          prefill={{
            amount: editing.amount,
            description: editing.description,
            category: editing.category,
            date: expectedDateFor(month.id, editing.dayOfMonth),
          }}
          onClose={() => setEditing(null)}
          onSave={async (values) => {
            await confirmRecurring(month.id, editing.id, {
              amount: values.amount,
              date: values.date,
            });
            notify(`${editing.description} logged`, { detail: money(values.amount) });
          }}
        />
      )}
    </>
  );
}
