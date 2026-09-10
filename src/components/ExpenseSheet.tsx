import { useMemo, useState, type FormEvent } from 'react';
import type { Expense, ISODate } from '../types/models';
import { FALLBACK_CATEGORY_ID } from '../data/seed';
import {
  currentMonthId,
  dayOfMonthOf,
  expectedDateFor,
  monthIdOf,
  monthLabel,
  ordinal,
  today,
} from '../lib/dates';
import { clampReimbursement } from '../lib/expense';
import { parseAmount, round2 } from '../lib/money';
import { sumNet } from '../lib/expense';
import { useApp, useMonth, useMonthExpenses } from '../state/store';
import { Field, Sheet, useMoneyFormatter } from './ui';

export interface ExpensePrefill {
  amount?: number;
  reimbursement?: number;
  date?: ISODate;
  description?: string;
  notes?: string;
  category?: string;
}

/**
 * One form for logging and editing (§4.2). Amount comes first and big, with a
 * decimal keypad on mobile; category is a one-tap chip row rather than a
 * dropdown, so the whole thing is amount → chip → description → save.
 */
export function ExpenseSheet({
  monthId,
  expense,
  prefill,
  title,
  confirmLabel = 'Save expense',
  allowDelete = true,
  onClose,
  onSave,
}: {
  monthId: string;
  expense?: Expense;
  prefill?: ExpensePrefill;
  title?: string;
  confirmLabel?: string;
  allowDelete?: boolean;
  onClose: () => void;
  /** Overrides the default create/update behaviour (used by reconciliation). */
  onSave?: (values: {
    amount: number;
    reimbursement: number;
    date: ISODate;
    category: string;
    description: string;
    notes?: string;
  }) => Promise<void> | void;
}) {
  const {
    categories,
    settings,
    addExpense,
    updateExpense,
    deleteExpense,
    registerRecurringFromExpense,
    notify,
    isLocked,
    expenses,
  } = useApp();
  const month = useMonth(monthId);
  const monthExpenses = useMonthExpenses(monthId);
  const money = useMoneyFormatter();

  // A row from a closed month is opened for reading, not editing — the store
  // would refuse the write anyway, but the sheet shouldn't offer it.
  const locked = Boolean(expense) && isLocked(expense!.monthId);

  const active = useMemo(
    () => categories.filter((c) => !c.archived || c.id === expense?.category),
    [categories, expense?.category],
  );

  // Suggestions drawn from what's already been logged, most-frequent first
  // (ties broken by most recent) — so retyping "Trader Joe's" for the tenth
  // time is a couple of keystrokes, not a full retype.
  const descriptionSuggestions = useMemo(() => {
    const byKey = new Map<string, { label: string; count: number; latest: ISODate }>();
    for (const e of expenses) {
      const label = e.description.trim();
      if (!label) continue;
      const key = label.toLowerCase();
      const found = byKey.get(key);
      if (found) {
        found.count += 1;
        if (e.date > found.latest) found.latest = e.date;
      } else {
        byKey.set(key, { label, count: 1, latest: e.date });
      }
    }
    return [...byKey.values()]
      .sort((a, b) => b.count - a.count || b.latest.localeCompare(a.latest))
      .slice(0, 8)
      .map((v) => v.label);
  }, [expenses]);

  const [amountText, setAmountText] = useState(
    expense ? String(expense.amount) : prefill?.amount != null ? String(prefill.amount) : '',
  );
  const [date, setDate] = useState<ISODate>(
    expense?.date ??
      prefill?.date ??
      // Logging into the month you're browsing: today's date only makes sense
      // when that month is the current one. For a past month, defaulting to
      // real-today would silently re-home the entry into the wrong month, so
      // land on the last day of the month being viewed instead — it's always
      // inside that month and it's where a retroactive entry most often
      // belongs.
      (monthId === currentMonthId() ? today() : expectedDateFor(monthId, 31)),
  );
  const [category, setCategory] = useState(
    expense?.category ??
      prefill?.category ??
      settings.lastUsedCategory ??
      FALLBACK_CATEGORY_ID,
  );
  const [description, setDescription] = useState(
    expense?.description ?? prefill?.description ?? '',
  );
  const [notes, setNotes] = useState(expense?.notes ?? prefill?.notes ?? '');
  const initialReimbursement = expense?.reimbursement ?? prefill?.reimbursement ?? 0;
  const [reimbursementText, setReimbursementText] = useState(
    initialReimbursement > 0 ? String(initialReimbursement) : '',
  );
  const [splitOpen, setSplitOpen] = useState(initialReimbursement > 0);
  const [makeRecurring, setMakeRecurring] = useState(false);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const amount = parseAmount(amountText);
  const amountValid = amount !== null && amount > 0;
  const descriptionValid = description.trim().length > 0;
  const rawReimbursement = splitOpen ? parseAmount(reimbursementText) ?? 0 : 0;
  const reimbursementTooBig = amountValid && rawReimbursement > (amount as number);
  const reimbursement = clampReimbursement(amount ?? 0, rawReimbursement);
  const net = round2(Math.max(0, (amount ?? 0) - reimbursement));
  const valid = amountValid && descriptionValid && Boolean(date) && !reimbursementTooBig;

  // Where a new entry will actually land — the sheet re-homes an expense by
  // its date, so this has to track the date field live, not the month it
  // happened to open against.
  const targetMonthId = monthIdOf(date);
  const crossesMonth = !expense && targetMonthId !== monthId;

  // Only offered on the plain "log an expense" path — not when editing an
  // existing row, and not when a caller (reconciliation, the recurring "log a
  // different amount" sheet) has taken over saving.
  const canMakeRecurring = !expense && !onSave && !locked;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (locked || !valid || saving) return;
    setSaving(true);
    try {
      const values = {
        amount: round2(amount as number),
        reimbursement,
        date,
        category,
        description: description.trim(),
        notes: notes.trim() || undefined,
      };
      if (onSave) {
        await onSave(values);
      } else if (expense) {
        await updateExpense(expense.id, values);
        notify('Expense updated');
      } else {
        const recurring = canMakeRecurring && makeRecurring;
        const created = await addExpense(targetMonthId, {
          ...values,
          source: recurring ? 'recurring' : undefined,
        });
        if (recurring) {
          await registerRecurringFromExpense(targetMonthId, created.id, {
            description: values.description,
            amount: values.amount,
            category: values.category,
            dayOfMonth: dayOfMonthOf(date),
          });
        }
        const loggedMsg =
          reimbursement > 0
            ? `${money(net)} logged, ${money(reimbursement)} coming back`
            : `${money(values.amount)} logged`;
        const suffix = recurring ? ' · now recurring' : '';
        if (month && targetMonthId === monthId) {
          const spent = sumNet([...monthExpenses, { amount: values.amount, reimbursement }]);
          const remaining = round2(month.budgetTotal - spent);
          notify(
            loggedMsg + suffix,
            month.budgetTotal > 0
              ? {
                  detail:
                    remaining >= 0
                      ? `${money(remaining)} left this month`
                      : `${money(Math.abs(remaining))} past budget`,
                  tone: remaining >= 0 ? 'good' : 'over',
                }
              : undefined,
          );
        } else {
          // Landed in a different month than the one being viewed — say so,
          // since nothing else on screen will change to hint at it.
          notify(`${money(net)} logged to ${monthLabel(targetMonthId, { year: false })}${suffix}`);
        }
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const defaultTitle = expense
    ? locked
      ? 'View expense'
      : 'Edit expense'
    : // Unmistakable, and it tracks the date field live — browsing a past
      // month and logging into it says so right in the title.
      `Log to ${monthLabel(targetMonthId)}`;

  return (
    <Sheet title={title ?? defaultTitle} onClose={onClose}>
      {locked && (
        <p className="stat__note" style={{ marginBottom: 'var(--s-4)' }}>
          This month is closed — expenses are read-only.
        </p>
      )}
      <form onSubmit={submit} className="stack" style={{ ['--gap' as string]: 'var(--s-4)' }}>
        <div className="field">
          <label className="field__label" htmlFor="expense-amount">
            Amount
          </label>
          <div className="amount-input">
            <span className="amount-input__symbol">$</span>
            <input
              id="expense-amount"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              aria-invalid={touched && !amountValid}
              disabled={locked}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus={!locked}
            />
          </div>
          {touched && !amountValid && (
            <span className="stat__note tone-over">Enter an amount above zero.</span>
          )}
        </div>

        {/*
          Splitting is tucked behind a toggle: it's the exception, and the
          common path stays amount → chip → description → save. The gross
          figure above never changes — it's what left the account, and what the
          statement will show at month end.
        */}
        {!splitOpen ? (
          <button
            type="button"
            className="linkish"
            style={{ alignSelf: 'flex-start' }}
            onClick={() => setSplitOpen(true)}
            disabled={locked}
          >
            + Split it — someone's paying me back
          </button>
        ) : (
          <div className="field">
            <div className="row row--between">
              <label className="field__label" htmlFor="expense-reimbursement">
                Coming back to you
              </label>
              <button
                type="button"
                className="linkish"
                onClick={() => {
                  setSplitOpen(false);
                  setReimbursementText('');
                }}
                disabled={locked}
              >
                Remove
              </button>
            </div>
            <div className="amount-input" style={{ padding: '8px 14px' }}>
              <span className="amount-input__symbol" style={{ fontSize: 17 }}>
                $
              </span>
              <input
                id="expense-reimbursement"
                value={reimbursementText}
                onChange={(e) => setReimbursementText(e.target.value)}
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                style={{ fontSize: 20 }}
                aria-invalid={reimbursementTooBig}
                aria-describedby="expense-net-note"
                disabled={locked}
              />
            </div>
            <span
              id="expense-net-note"
              className={`stat__note ${reimbursementTooBig ? 'tone-over' : ''}`}
            >
              {reimbursementTooBig
                ? "That's more than the charge itself — a reimbursement can't exceed what you paid."
                : reimbursement > 0
                  ? `${money(net)} counts against your budget. The full ${money(
                      amount ?? 0,
                    )} still matches your statement.`
                  : 'How much of this charge someone else is covering.'}
            </span>
          </div>
        )}

        {/*
          Same tucked-away treatment as splitting: the common case is a one-off,
          so "make this recurring" is an opt-in link. Turned on, this entry is
          the first occurrence and the month won't nudge for it — the reminder
          starts next month, on the day this one is dated.
        */}
        {canMakeRecurring &&
          (!makeRecurring ? (
            <button
              type="button"
              className="linkish"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => setMakeRecurring(true)}
            >
              + Make this recurring
            </button>
          ) : (
            <div className="field">
              <div className="row row--between">
                <label className="field__label">Recurring monthly</label>
                <button
                  type="button"
                  className="linkish"
                  onClick={() => setMakeRecurring(false)}
                >
                  Remove
                </button>
              </div>
              <span className="stat__note">
                Logs now, then nudges you around the {ordinal(dayOfMonthOf(date))} of each
                month. Edit or pause it in Settings.
              </span>
            </div>
          ))}

        <Field label="Category">
          <div className="chiprow">
            {active.map((c) => (
              <button
                key={c.id}
                type="button"
                className="chip"
                aria-pressed={category === c.id}
                onClick={() => setCategory(c.id)}
                disabled={locked}
              >
                <span className="chip__dot" style={{ background: c.color }} />
                {c.name}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Description" id="expense-description">
          <input
            id="expense-description"
            className="input"
            list="expense-description-suggestions"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Trader Joe's"
            aria-invalid={touched && !descriptionValid}
            autoComplete="off"
            disabled={locked}
          />
          <datalist id="expense-description-suggestions">
            {descriptionSuggestions.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
          {touched && !descriptionValid && (
            <span className="stat__note tone-over">A short description helps at reconcile time.</span>
          )}
        </Field>

        <Field
          label="Date"
          id="expense-date"
          hint={
            crossesMonth
              ? `Lands in ${monthLabel(targetMonthId)} — you're viewing ${monthLabel(monthId)}.`
              : undefined
          }
        >
          <input
            id="expense-date"
            className="input"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={locked}
          />
        </Field>

        <Field label="Notes" id="expense-notes" hint="Optional">
          <textarea
            id="expense-notes"
            className="textarea"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything worth remembering later"
            disabled={locked}
          />
        </Field>

        {!locked && (
          <button type="submit" className="btn btn--primary btn--block" disabled={saving}>
            {saving ? 'Saving…' : confirmLabel}
          </button>
        )}

        {expense && allowDelete && !locked && (
          <button
            type="button"
            className="btn btn--danger btn--block"
            onClick={async () => {
              if (confirmingDelete) {
                await deleteExpense(expense.id);
                notify('Expense removed');
                onClose();
              } else {
                setConfirmingDelete(true);
              }
            }}
          >
            {confirmingDelete ? 'Tap again to delete' : 'Delete expense'}
          </button>
        )}
      </form>
    </Sheet>
  );
}
