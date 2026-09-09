import { useMemo, useState } from 'react';
import type { Expense, ReconciliationSession } from '../../types/models';
import { formatDayLabel } from '../../lib/dates';
import { isExactPair } from '../../lib/reconcile';
import { ExpenseSheet } from '../../components/ExpenseSheet';
import { IconCheck } from '../../components/Icons';
import { Money, SplitNote } from '../../components/ui';
import { useApp, useCategoryMap } from '../../state/store';

/**
 * Queue B (§4.6): things logged that never showed up on the statement.
 *
 * Deliberately a list rather than a second swipe stack — these need reading,
 * not clearing, and mixing them into the same gesture would invite reflex
 * answers about whether a real expense happened.
 */
export function QueueB({
  monthId,
  session,
  expenses,
  onDone,
}: {
  monthId: string;
  session: ReconciliationSession;
  expenses: Expense[];
  onDone: () => void;
}) {
  const { resolveLoggedOnly, deleteExpense, linkTransaction, updateExpense, notify } = useApp();
  const categories = useCategoryMap();
  const [editing, setEditing] = useState<Expense | null>(null);

  const resolved = useMemo(() => new Set(session.resolvedLoggedOnly), [session.resolvedLoggedOnly]);
  const queue = useMemo(
    () => expenses.filter((e) => e.reconciliationStatus !== 'matched' && !resolved.has(e.id)),
    [expenses, resolved],
  );

  if (queue.length === 0) {
    return (
      <section className="card" style={{ textAlign: 'center' }}>
        <div className="tone-good" style={{ display: 'flex', justifyContent: 'center' }}>
          <IconCheck className="" />
        </div>
        <h2 style={{ fontSize: 'var(--t-heading)', fontWeight: 600, margin: '10px 0 6px' }}>
          Both queues clear
        </h2>
        <p className="muted" style={{ fontSize: 'var(--t-small)', marginBottom: 'var(--s-5)' }}>
          Everything is accounted for on both sides.
        </p>
        <button className="btn btn--primary btn--block" onClick={onDone}>
          See the month's total
        </button>
      </section>
    );
  }

  return (
    <>
      <div>
        <div className="section-label">Logged, but not on the statement</div>
        <p className="muted" style={{ fontSize: 'var(--t-small)', marginTop: 6 }}>
          {queue.length} {queue.length === 1 ? 'expense' : 'expenses'} to confirm. Cash and
          not-yet-posted charges are normal — keep them.
        </p>
      </div>

      <div className="stack" style={{ ['--gap' as string]: 'var(--s-3)' }}>
        {queue.map((expense) => (
          <div className="card" key={expense.id} style={{ padding: 'var(--s-4)' }}>
            <div className="row row--between" style={{ alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: 'var(--s-2)' }}>
                  <span
                    className="dot"
                    style={{
                      background: categories.get(expense.category)?.color ?? 'var(--text-tertiary)',
                    }}
                  />
                  <span className="list__title">{expense.description}</span>
                </div>
                <div className="list__sub" style={{ marginTop: 4 }}>
                  <span>{formatDayLabel(expense.date, monthId)}</span>
                  <span>·</span>
                  <span>{categories.get(expense.category)?.name ?? 'Uncategorised'}</span>
                  <SplitNote expense={expense} />
                </div>
              </div>
              <span className="num" style={{ fontWeight: 600 }}>
                <Money amount={expense.amount} />
              </span>
            </div>

            <p className="muted" style={{ fontSize: 'var(--t-small)', margin: 'var(--s-3) 0' }}>
              This isn't in your statement. Still happened?
            </p>

            <div className="row" style={{ flexWrap: 'wrap' }}>
              <button
                className="btn btn--primary btn--sm"
                onClick={async () => {
                  await resolveLoggedOnly(monthId, expense.id);
                  notify('Kept', { detail: 'Cash or not yet posted' });
                }}
              >
                Yes, keep it
              </button>
              <button className="btn btn--quiet btn--sm" onClick={() => setEditing(expense)}>
                Fix amount or date
              </button>
              <button
                className="btn btn--danger btn--sm"
                onClick={async () => {
                  await deleteExpense(expense.id);
                  notify('Removed from the month');
                }}
              >
                No, remove it
              </button>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <ExpenseSheet
          monthId={monthId}
          expense={editing}
          title="Fix this expense"
          allowDelete={false}
          onClose={() => setEditing(null)}
          onSave={async (values) => {
            const corrected: Expense = { ...editing, ...values };
            // A typo is often the whole reason a row didn't match — so once the
            // numbers agree, link it instead of asking about it again.
            const hit = session.transactions.find(
              (t) => t.matchStatus === 'unmatched' && isExactPair(t, corrected),
            );
            await updateExpense(editing.id, values);
            if (hit) {
              await linkTransaction(monthId, hit.id, editing.id);
              notify('Fixed and matched', { detail: hit.rawDescription });
            } else {
              notify('Expense updated');
            }
          }}
        />
      )}
    </>
  );
}
