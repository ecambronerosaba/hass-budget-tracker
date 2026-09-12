import { useMemo, useRef, useState } from 'react';
import type { ISODate } from '../types/models';
import { FALLBACK_CATEGORY_ID } from '../data/seed';
import {
  currentMonthId,
  expectedDateFor,
  isValidISODate,
  monthIdOf,
  monthLabel,
  today,
} from '../lib/dates';
import { partitionBulkRows, type BulkRow } from '../lib/bulkExpense';
import { bucketForDate } from '../lib/bucket';
import { newId } from '../lib/id';
import { sumAmounts } from '../lib/money';
import { useApp } from '../state/store';
import { Field, Sheet, useMoneyFormatter } from './ui';
import { IconClose, IconPlus } from './Icons';

/**
 * Log a stack of expenses in one pass (§4.2). The single-expense sheet is
 * amount → chip → description → save, then it closes; doing that ten times for
 * ten receipts is the pain this removes. Here every row is that same little
 * form, they all save together, and blank rows are just ignored so there's
 * nothing to tidy up.
 *
 * The date at the top only seeds new rows — each row then carries its own,
 * because a batch of receipts is rarely all from one day. Rows are routed to a
 * month by their own date, so a row dated into last month lands there.
 */

const STARTING_ROWS = 3;

/** A grid row is a BulkRow plus a stable id, so React keeps a row's inputs
 *  bound to the same DOM node when a row above it is removed. */
type GridRow = BulkRow & { id: string };

function blankRow(date: ISODate, category: string): GridRow {
  return { id: newId('brow'), amount: '', description: '', category, date };
}

export function BulkExpenseSheet({
  monthId,
  onClose,
}: {
  monthId: string;
  onClose: () => void;
}) {
  const { categories, settings, buckets, expenses, addExpenses, notify, isLocked } = useApp();
  const money = useMoneyFormatter();

  const active = useMemo(() => categories.filter((c) => !c.archived), [categories]);

  const openBuckets = useMemo(() => buckets.filter((b) => b.phase !== 'closed'), [buckets]);
  // 'auto' resolves each row against its own date; a bucket id or null forces
  // the whole batch. A per-row picker would make the grid unreadable.
  const [batchBucket, setBatchBucket] = useState<'auto' | string | null>('auto');

  const bucketForRow = (rowDate: ISODate) =>
    batchBucket === 'auto'
      ? bucketForDate(rowDate, buckets)
      : batchBucket === null
        ? null
        : openBuckets.find((b) => b.id === batchBucket) ?? null;

  // Same rule the single sheet uses: today only when the month being viewed is
  // the live one, otherwise the last day of it, so a row doesn't silently jump
  // months before the user has touched its date.
  const seedDate =
    monthId === currentMonthId() ? today() : expectedDateFor(monthId, 31);
  const seedCategory = settings.lastUsedCategory ?? FALLBACK_CATEGORY_ID;

  // Most-frequent descriptions first (ties broken by most recent) — the same
  // typing shortcut the single sheet offers.
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

  const [defaultDate, setDefaultDate] = useState<ISODate>(seedDate);
  const [rows, setRows] = useState<GridRow[]>(() =>
    Array.from({ length: STARTING_ROWS }, () => blankRow(seedDate, seedCategory)),
  );
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  // A synchronous latch: `saving` state only disables the button on the next
  // render, so a fast double-tap on mobile can fire save() twice before that.
  const savingRef = useRef(false);

  const parts = useMemo(() => partitionBulkRows(rows, isLocked), [rows, isLocked]);
  const flagged = useMemo(
    () => new Set([...parts.incomplete, ...parts.locked]),
    [parts],
  );
  const readyTotal = sumAmounts(parts.ready.map((r) => r.input.amount));
  const canSave =
    parts.ready.length > 0 && parts.incomplete.length === 0 && parts.locked.length === 0;

  const patchRow = (index: number, patch: Partial<BulkRow>) =>
    setRows((rs) => rs.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const addAnotherRow = () =>
    setRows((rs) => [
      ...rs,
      // Inherit the last row's category — a batch tends to cluster — but the
      // top-of-sheet date, which is what the user reaches for to set the batch.
      blankRow(defaultDate, rs[rs.length - 1]?.category ?? seedCategory),
    ]);

  const removeRow = (index: number) =>
    setRows((rs) => (rs.length > 1 ? rs.filter((_, i) => i !== index) : rs));

  const save = async () => {
    setSubmitted(true);
    if (savingRef.current || !canSave) return;
    savingRef.current = true;
    setSaving(true);

    const ready = parts.ready;
    const { created, error } = await addExpenses(
      ready.map((r) => {
        const b = bucketForRow(r.input.date);
        return {
          monthId: r.monthId,
          input: { ...r.input, bucketId: b?.id ?? null, bucketKind: b ? ('spend' as const) : undefined },
        };
      }),
    );

    // The store writes rows in order, so `created` is the prefix of `ready`
    // that persisted. Drop those rows; leave the rest — including the one
    // that threw, which never reached storage — so a retry can't double-log.
    const savedRowIndices = new Set(ready.slice(0, created.length).map((r) => r.index));

    if (error) {
      setRows((rs) => rs.filter((_, i) => !savedRowIndices.has(i)));
      savingRef.current = false;
      setSaving(false);
      notify(
        created.length > 0 ? `Logged ${created.length} of ${ready.length}` : "Couldn't log these",
        {
          detail:
            error instanceof Error ? error.message : 'Nothing else was saved — try again.',
          tone: 'over',
        },
      );
      return;
    }

    const elsewhere = [...new Set(created.map((e) => e.monthId))].filter((m) => m !== monthId);
    notify(
      `${created.length} ${created.length === 1 ? 'expense' : 'expenses'} logged · ${money(
        sumAmounts(created.map((e) => e.amount)),
      )}`,
      {
        detail:
          elsewhere.length > 0
            ? `Some landed in ${elsewhere.map((m) => monthLabel(m)).join(', ')}`
            : undefined,
      },
    );
    savingRef.current = false;
    onClose();
  };

  return (
    <Sheet title={`Add several to ${monthLabel(monthId)}`} onClose={onClose}>
      <div className="stack" style={{ ['--gap' as string]: 'var(--s-4)' }}>
        <Field label="Date for new rows" id="bulk-default-date" hint="Each row can be changed below.">
          <input
            id="bulk-default-date"
            className="input"
            type="date"
            value={defaultDate}
            onChange={(e) => setDefaultDate(e.target.value)}
          />
        </Field>

        {openBuckets.length > 0 && (
          <Field label="Counts against">
            <div className="chiprow">
              <button
                type="button"
                className="chip"
                aria-pressed={batchBucket === 'auto'}
                onClick={() => setBatchBucket('auto')}
              >
                Auto by date
              </button>
              <button
                type="button"
                className="chip"
                aria-pressed={batchBucket === null}
                onClick={() => setBatchBucket(null)}
              >
                This month
              </button>
              {openBuckets.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  className="chip"
                  aria-pressed={batchBucket === b.id}
                  onClick={() => setBatchBucket(b.id)}
                >
                  <span
                    className="chip__dot"
                    style={{
                      background: categories.find((c) => c.id === b.category)?.color
                        ?? 'var(--text-tertiary)',
                    }}
                  />
                  {b.name}
                </button>
              ))}
            </div>
          </Field>
        )}

        <datalist id="bulk-description-suggestions">
          {descriptionSuggestions.map((d) => (
            <option key={d} value={d} />
          ))}
        </datalist>

        <div>
          {rows.map((row, index) => {
            const showError = submitted && flagged.has(index);
            const lockedRow = submitted && parts.locked.includes(index);
            const landsElsewhere =
              !showError && isValidISODate(row.date) && monthIdOf(row.date) !== monthId;
            const rowBucket =
              !showError && isValidISODate(row.date) ? bucketForRow(row.date) : null;
            return (
              <div className="bulkrow" key={row.id}>
                <div className="bulkrow__top">
                  <div className="amount-input amount-input--sm">
                    <span className="amount-input__symbol">$</span>
                    <input
                      aria-label={`Amount, row ${index + 1}`}
                      value={row.amount}
                      onChange={(e) => patchRow(index, { amount: e.target.value })}
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="0.00"
                    />
                  </div>
                  {rows.length > 1 && (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm bulkrow__remove"
                      aria-label={`Remove row ${index + 1}`}
                      onClick={() => removeRow(index)}
                    >
                      <IconClose />
                    </button>
                  )}
                </div>

                <input
                  className="input"
                  aria-label={`Description, row ${index + 1}`}
                  list="bulk-description-suggestions"
                  value={row.description}
                  onChange={(e) => patchRow(index, { description: e.target.value })}
                  placeholder="Trader Joe's"
                  autoComplete="off"
                />

                <div className="chiprow">
                  {active.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="chip"
                      aria-pressed={row.category === c.id}
                      onClick={() => patchRow(index, { category: c.id })}
                    >
                      <span className="chip__dot" style={{ background: c.color }} />
                      {c.name}
                    </button>
                  ))}
                </div>

                <input
                  className="input"
                  aria-label={`Date, row ${index + 1}`}
                  type="date"
                  value={row.date}
                  onChange={(e) => patchRow(index, { date: e.target.value })}
                />

                {showError && (
                  <span className="stat__note tone-over">
                    {lockedRow
                      ? `${monthLabel(row.date.slice(0, 7))} is closed — change the date or remove this row.`
                      : 'Needs an amount above zero, a description, and a valid date.'}
                  </span>
                )}
                {landsElsewhere && (
                  <span className="stat__note">
                    Lands in {monthLabel(monthIdOf(row.date))}, not {monthLabel(monthId)}.
                  </span>
                )}
                {rowBucket && (
                  <span className="stat__note">→ {rowBucket.name}</span>
                )}
              </div>
            );
          })}
        </div>

        <button type="button" className="linkish" style={{ alignSelf: 'flex-start' }} onClick={addAnotherRow}>
          <IconPlus /> Add row
        </button>

        <div className="bulkrow__actions">
          <span className="stat__note">
            {parts.ready.length} ready · {money(readyTotal)}
          </span>
          <button
            type="button"
            className="btn btn--primary btn--block"
            onClick={save}
            disabled={saving || parts.ready.length === 0 || (submitted && !canSave)}
          >
            {saving
              ? 'Saving…'
              : parts.ready.length > 0
                ? `Save ${parts.ready.length} ${parts.ready.length === 1 ? 'expense' : 'expenses'}`
                : 'Save expenses'}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
