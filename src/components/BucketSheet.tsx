import { useState, type FormEvent } from 'react';
import type { Bucket } from '../types/models';
import { FALLBACK_CATEGORY_ID } from '../data/seed';
import { parseAmount } from '../lib/money';
import { useApp } from '../state/store';
import { Field, Sheet, useMoneyFormatter } from './ui';

/**
 * Create or edit a bucket. The common path is name → target → category →
 * save; dates and a monthly plan are real but secondary, so they sit behind
 * a disclosure rather than making every new bucket a six-field form.
 */
export function BucketSheet({
  bucket,
  onClose,
  onCreated,
}: {
  bucket?: Bucket;
  onClose: () => void;
  onCreated?: (id: string) => void;
}) {
  const { categories, createBucket, updateBucket, deleteBucket, expenses, notify } = useApp();
  const money = useMoneyFormatter();

  const [name, setName] = useState(bucket?.name ?? '');
  const [targetText, setTargetText] = useState(bucket ? String(bucket.targetAmount) : '');
  const [category, setCategory] = useState(bucket?.category ?? FALLBACK_CATEGORY_ID);
  const [startDate, setStartDate] = useState(bucket?.startDate ?? '');
  const [endDate, setEndDate] = useState(bucket?.endDate ?? '');
  const [monthlyText, setMonthlyText] = useState(
    bucket && bucket.monthlyContribution > 0 ? String(bucket.monthlyContribution) : '',
  );
  const [note, setNote] = useState(bucket?.note ?? '');
  const [planOpen, setPlanOpen] = useState(
    Boolean(
      bucket?.startDate ||
        bucket?.endDate ||
        (bucket?.monthlyContribution ?? 0) > 0 ||
        bucket?.note,
    ),
  );
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const target = parseAmount(targetText);
  const targetValid = target !== null && target > 0;
  const nameValid = name.trim().length > 0;
  const monthly = planOpen ? parseAmount(monthlyText) ?? 0 : 0;
  const rangeReversed = Boolean(startDate && endDate && endDate < startDate);
  const valid = nameValid && targetValid && !rangeReversed;

  const entryCount = bucket ? expenses.filter((e) => e.bucketId === bucket.id).length : 0;
  const active = categories.filter((c) => !c.archived || c.id === bucket?.category);

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
        endDate: endDate || undefined,
        monthlyContribution: Math.max(0, monthly),
        note: note.trim() || undefined,
      };
      if (bucket) {
        await updateBucket(bucket.id, values);
        notify('Bucket updated');
      } else {
        const created = await createBucket(values);
        notify('Bucket created', { detail: `${money(created.targetAmount)} target` });
        onCreated?.(created.id);
        return;
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet title={bucket ? 'Edit bucket' : 'New bucket'} onClose={onClose}>
      <form onSubmit={submit} className="stack" style={{ ['--gap' as string]: 'var(--s-4)' }}>
        <Field label="Name" id="bucket-name">
          <input
            id="bucket-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Golf clubs"
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
          <label className="field__label" htmlFor="bucket-target">
            Target
          </label>
          <div className="amount-input">
            <span className="amount-input__symbol">$</span>
            <input
              id="bucket-target"
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
          Same progressive disclosure as the expense form: most buckets are a
          name, a number and a category. Dates and a monthly plan are worth
          having, but not worth making every bucket ask for.
        */}
        {!planOpen ? (
          <button
            type="button"
            className="linkish"
            style={{ alignSelf: 'flex-start' }}
            onClick={() => setPlanOpen(true)}
          >
            + Add dates and a monthly plan
          </button>
        ) : (
          <>
            <Field
              label="Starts"
              id="bucket-start"
              hint="Optional. A trip has dates; something you're saving up for might not."
            >
              <input
                id="bucket-start"
                className="input"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </Field>

            <Field
              label="Ends"
              id="bucket-end"
              hint={
                rangeReversed
                  ? undefined
                  : 'With both dates set, expenses you log inside the range go to this bucket.'
              }
            >
              <input
                id="bucket-end"
                className="input"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
              {rangeReversed && (
                <span className="stat__note tone-over">
                  The end date is before the start date.
                </span>
              )}
            </Field>

            <div className="field">
              <label className="field__label" htmlFor="bucket-monthly">
                Set aside each month
              </label>
              <div className="amount-input amount-input--sm">
                <span className="amount-input__symbol">$</span>
                <input
                  id="bucket-monthly"
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

            <Field label="Note" id="bucket-note" hint="Optional">
              <textarea
                id="bucket-note"
                className="textarea"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Anything worth remembering later"
              />
            </Field>
          </>
        )}

        <button type="submit" className="btn btn--primary btn--block" disabled={saving}>
          {saving ? 'Saving…' : bucket ? 'Save changes' : 'Create bucket'}
        </button>

        {bucket && entryCount === 0 && (
          <button
            type="button"
            className="btn btn--danger btn--block"
            onClick={async () => {
              if (!confirmingDelete) {
                setConfirmingDelete(true);
                return;
              }
              await deleteBucket(bucket.id);
              notify('Bucket removed');
              onClose();
            }}
          >
            {confirmingDelete ? 'Tap again to delete' : 'Delete bucket'}
          </button>
        )}

        {/*
          Deleting a bucket with entries has no good answer: untagging them
          would change the totals of months that may already be closed, and
          removing them would destroy reconciled history. Closing keeps both.
        */}
        {bucket && entryCount > 0 && (
          <span className="stat__note">
            {entryCount} {entryCount === 1 ? 'entry is' : 'entries are'} logged against this
            bucket, so it can't be deleted — closing it keeps the record intact.
          </span>
        )}
      </form>
    </Sheet>
  );
}
