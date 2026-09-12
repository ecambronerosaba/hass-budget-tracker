import { useState, type FormEvent } from 'react';
import type { BudgetEvent } from '../types/models';
import { FALLBACK_CATEGORY_ID } from '../data/seed';
import { parseAmount } from '../lib/money';
import { useApp } from '../state/store';
import { Field, Sheet, useMoneyFormatter } from './ui';

/**
 * Create or edit an event. The common path is name → target → category →
 * save; a date and a monthly plan are real but secondary, so they sit behind
 * a disclosure rather than making every new event a six-field form.
 */
export function EventSheet({
  event,
  onClose,
  onCreated,
}: {
  event?: BudgetEvent;
  onClose: () => void;
  onCreated?: (id: string) => void;
}) {
  const { categories, createEvent, updateEvent, deleteEvent, expenses, notify } = useApp();
  const money = useMoneyFormatter();

  const [name, setName] = useState(event?.name ?? '');
  const [targetText, setTargetText] = useState(event ? String(event.targetAmount) : '');
  const [category, setCategory] = useState(event?.category ?? FALLBACK_CATEGORY_ID);
  const [startDate, setStartDate] = useState(event?.startDate ?? '');
  const [monthlyText, setMonthlyText] = useState(
    event && event.monthlyContribution > 0 ? String(event.monthlyContribution) : '',
  );
  const [note, setNote] = useState(event?.note ?? '');
  const [planOpen, setPlanOpen] = useState(
    Boolean(event?.startDate || (event?.monthlyContribution ?? 0) > 0 || event?.note),
  );
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const target = parseAmount(targetText);
  const targetValid = target !== null && target > 0;
  const nameValid = name.trim().length > 0;
  const monthly = planOpen ? parseAmount(monthlyText) ?? 0 : 0;
  const valid = nameValid && targetValid;

  const entryCount = event ? expenses.filter((e) => e.eventId === event.id).length : 0;
  const active = categories.filter((c) => !c.archived || c.id === event?.category);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!valid || saving) return;
    setSaving(true);
    try {
      const values = {
        name: name.trim(),
        targetAmount: target as number,
        category,
        startDate: startDate || undefined,
        monthlyContribution: Math.max(0, monthly),
        note: note.trim() || undefined,
      };
      if (event) {
        await updateEvent(event.id, values);
        notify('Event updated');
      } else {
        const created = await createEvent(values);
        notify('Event created', { detail: `${money(created.targetAmount)} target` });
        onCreated?.(created.id);
        return;
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet title={event ? 'Edit event' : 'New event'} onClose={onClose}>
      <form onSubmit={submit} className="stack" style={{ ['--gap' as string]: 'var(--s-4)' }}>
        <Field label="Name" id="event-name">
          <input
            id="event-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Japan trip"
            autoComplete="off"
            aria-invalid={touched && !nameValid}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          />
          {touched && !nameValid && (
            <span className="stat__note tone-over">Give it a name you'll recognise later.</span>
          )}
        </Field>

        <div className="field">
          <label className="field__label" htmlFor="event-target">
            Target
          </label>
          <div className="amount-input">
            <span className="amount-input__symbol">$</span>
            <input
              id="event-target"
              value={targetText}
              onChange={(e) => setTargetText(e.target.value)}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              aria-invalid={touched && !targetValid}
            />
          </div>
          {touched && !targetValid ? (
            <span className="stat__note tone-over">Enter a target above zero.</span>
          ) : (
            <span className="stat__note">What you expect the whole thing to cost.</span>
          )}
        </div>

        <Field label="Category">
          <div className="chiprow">
            {active.map((c) => (
              <button
                key={c.id}
                type="button"
                className="chip"
                aria-pressed={category === c.id}
                onClick={() => setCategory(c.id)}
              >
                <span className="chip__dot" style={{ background: c.color }} />
                {c.name}
              </button>
            ))}
          </div>
        </Field>

        {/*
          Same progressive disclosure as the expense form: most events are a
          name, a number and a category. A date and a monthly plan are worth
          having, but not worth making every event ask for.
        */}
        {!planOpen ? (
          <button
            type="button"
            className="linkish"
            style={{ alignSelf: 'flex-start' }}
            onClick={() => setPlanOpen(true)}
          >
            + Add a date and a monthly plan
          </button>
        ) : (
          <>
            <Field
              label="Starts"
              id="event-start"
              hint="Optional — what the saving pace is measured against."
            >
              <input
                id="event-start"
                className="input"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </Field>

            <div className="field">
              <label className="field__label" htmlFor="event-monthly">
                Set aside each month
              </label>
              <div className="amount-input amount-input--sm">
                <span className="amount-input__symbol">$</span>
                <input
                  id="event-monthly"
                  value={monthlyText}
                  onChange={(e) => setMonthlyText(e.target.value)}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.00"
                />
              </div>
              <span className="stat__note">
                Counted in each month's projection until you log it, the way a recurring
                expense is.
              </span>
            </div>

            <Field label="Note" id="event-note" hint="Optional">
              <textarea
                id="event-note"
                className="textarea"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Anything worth remembering later"
              />
            </Field>
          </>
        )}

        <button type="submit" className="btn btn--primary btn--block" disabled={saving}>
          {saving ? 'Saving…' : event ? 'Save changes' : 'Create event'}
        </button>

        {event && entryCount === 0 && (
          <button
            type="button"
            className="btn btn--danger btn--block"
            onClick={async () => {
              if (!confirmingDelete) {
                setConfirmingDelete(true);
                return;
              }
              await deleteEvent(event.id);
              notify('Event removed');
              onClose();
            }}
          >
            {confirmingDelete ? 'Tap again to delete' : 'Delete event'}
          </button>
        )}

        {/*
          Deleting an event with entries has no good answer: untagging them
          would change the totals of months that may already be closed, and
          removing them would destroy reconciled history. Closing keeps both.
        */}
        {event && entryCount > 0 && (
          <span className="stat__note">
            {entryCount} {entryCount === 1 ? 'entry is' : 'entries are'} logged against this
            event, so it can't be deleted — closing it keeps the record intact.
          </span>
        )}
      </form>
    </Sheet>
  );
}
