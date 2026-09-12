import { useState, type FormEvent } from 'react';
import type { BudgetEvent, ISODate, MonthId } from '../types/models';
import { currentMonthId, expectedDateFor, monthIdOf, monthLabel, today } from '../lib/dates';
import { parseAmount } from '../lib/money';
import { useApp } from '../state/store';
import { Field, Sheet, useMoneyFormatter } from './ui';

/**
 * Money into the fund. Deliberately smaller than the expense form: no
 * category (it comes from the event), no split, no recurring — amount, date,
 * done. What it does say plainly is the consequence, because this is the one
 * place where an event touches a month's budget.
 */
export function ContributionSheet({
  event,
  monthId,
  onClose,
}: {
  event: BudgetEvent;
  monthId: MonthId;
  onClose: () => void;
}) {
  const { addExpense, isLocked, notify } = useApp();
  const money = useMoneyFormatter();

  const [amountText, setAmountText] = useState(
    event.monthlyContribution > 0 ? String(event.monthlyContribution) : '',
  );
  const [date, setDate] = useState<ISODate>(
    monthId === currentMonthId() ? today() : expectedDateFor(monthId, 31),
  );
  const [description, setDescription] = useState(`${event.name} fund`);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  const amount = parseAmount(amountText);
  const amountValid = amount !== null && amount > 0;
  // The date field re-homes the contribution, so which month it lands in has
  // to track it live rather than the month the sheet opened against.
  const targetMonthId = monthIdOf(date);
  const locked = isLocked(targetMonthId);
  const valid = amountValid && Boolean(date) && !locked;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!valid || saving) return;
    setSaving(true);
    try {
      await addExpense(targetMonthId, {
        date,
        amount: amount as number,
        category: event.category,
        description: description.trim() || `${event.name} fund`,
        eventId: event.id,
        eventKind: 'contribution',
      });
      notify(`${money(amount as number)} set aside`, {
        detail: `Counted against ${monthLabel(targetMonthId, { year: false })}.`,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet title={`Add to ${event.name}`} onClose={onClose}>
      <form onSubmit={submit} className="stack" style={{ ['--gap' as string]: 'var(--s-4)' }}>
        <div className="field">
          <label className="field__label" htmlFor="contrib-amount">
            Amount
          </label>
          <div className="amount-input">
            <span className="amount-input__symbol">$</span>
            <input
              id="contrib-amount"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              aria-invalid={touched && !amountValid}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />
          </div>
          {touched && !amountValid && (
            <span className="stat__note tone-over">Enter an amount above zero.</span>
          )}
        </div>

        <Field label="Date" id="contrib-date">
          <input
            id="contrib-date"
            className="input"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-describedby="contrib-month-note"
          />
          <span id="contrib-month-note" className={`stat__note ${locked ? 'tone-over' : ''}`}>
            {locked
              ? `${monthLabel(targetMonthId)} is closed, so nothing new can be logged to it.`
              : `Counts against ${monthLabel(
                  targetMonthId,
                )} — that month's budget goes down by this much.`}
          </span>
        </Field>

        <Field label="Description" id="contrib-desc">
          <input
            id="contrib-desc"
            className="input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            autoComplete="off"
          />
        </Field>

        <button type="submit" className="btn btn--primary btn--block" disabled={saving || locked}>
          {saving ? 'Saving…' : 'Add to the fund'}
        </button>
      </form>
    </Sheet>
  );
}
