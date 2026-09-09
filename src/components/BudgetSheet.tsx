import { useState, type FormEvent } from 'react';
import { monthLabel } from '../lib/dates';
import { parseAmount } from '../lib/money';
import { useApp, useMonth } from '../state/store';
import { Sheet, useMoneyFormatter } from './ui';

/** Set or adjust the single monthly total (§4.1). */
export function BudgetSheet({ monthId, onClose }: { monthId: string; onClose: () => void }) {
  const { setBudget, notify, isLocked } = useApp();
  const month = useMonth(monthId);
  const money = useMoneyFormatter();
  const [text, setText] = useState(month && month.budgetTotal > 0 ? String(month.budgetTotal) : '');
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const locked = isLocked(monthId);

  const amount = parseAmount(text);
  const valid = amount !== null && amount > 0;
  const isFirst = !month || month.budgetTotal <= 0;
  const edits = month?.budgetHistory ?? [];

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (locked || !valid || saving) return;
    setSaving(true);
    try {
      await setBudget(monthId, amount as number);
      notify(isFirst ? 'Budget set' : 'Budget updated', { detail: money(amount as number) });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      title={
        locked || isFirst ? `Budget for ${monthLabel(monthId)}` : `Adjust ${monthLabel(monthId)}`
      }
      onClose={onClose}
    >
      <form onSubmit={submit} className="stack">
        <p className="muted" style={{ fontSize: 'var(--t-small)' }}>
          {locked
            ? 'This month is closed, so its budget is locked. Here is the total and its history.'
            : "One number for the whole month. You can change it later — every change is kept in the month's history so past reports stay honest."}
        </p>

        <div className="amount-input">
          <span className="amount-input__symbol">$</span>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            inputMode="decimal"
            placeholder="0"
            aria-label="Monthly budget total"
            disabled={locked}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus={!locked}
          />
        </div>
        {touched && !valid && (
          <span className="stat__note tone-over">Enter a budget above zero.</span>
        )}

        {edits.length > 0 && (
          <div>
            <div className="section-label" style={{ marginBottom: 'var(--s-2)' }}>
              Changes this month
            </div>
            {edits
              .slice()
              .reverse()
              .slice(0, 4)
              .map((edit) => (
                <div className="kv" key={edit.at}>
                  <span className="kv__k">
                    {new Date(edit.at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                  <span className="num">
                    {edit.from === null ? 'Set to ' : `${money(edit.from)} → `}
                    {money(edit.to)}
                  </span>
                </div>
              ))}
          </div>
        )}

        {!locked && (
          <button type="submit" className="btn btn--primary btn--block" disabled={saving}>
            {isFirst ? 'Set budget' : 'Update budget'}
          </button>
        )}
      </form>
    </Sheet>
  );
}
