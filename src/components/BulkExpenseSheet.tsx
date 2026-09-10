import { useMemo, useState } from 'react';
import type { ISODate } from '../types/models';
import { FALLBACK_CATEGORY_ID } from '../data/seed';
import { currentMonthId, expectedDateFor, monthLabel, today } from '../lib/dates';
import { partitionBulkRows, type BulkRow } from '../lib/bulkExpense';
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

function blankRow(date: ISODate, category: string): BulkRow {
  return { amount: '', description: '', category, date };
}

export function BulkExpenseSheet({
  monthId,
  onClose,
}: {
  monthId: string;
  onClose: () => void;
}) {
  const { categories, settings, expenses, addExpense, notify, isLocked } = useApp();
  const money = useMoneyFormatter();

  const active = useMemo(() => categories.filter((c) => !c.archived), [categories]);

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
  const [rows, setRows] = useState<BulkRow[]>(() =>
    Array.from({ length: STARTING_ROWS }, () => blankRow(seedDate, seedCategory)),
  );
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);

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
    if (!canSave || saving) return;
    setSaving(true);

    const savedIndices = new Set<number>();
    const monthsHit = new Set<string>();
    try {
      for (const row of parts.ready) {
        await addExpense(row.monthId, { ...row.input });
        savedIndices.add(row.index);
        monthsHit.add(row.monthId);
      }
    } catch (err) {
      // Some rows may already be logged. Drop those and keep the rest on
      // screen so a retry doesn't log them a second time.
      setRows((rs) => rs.filter((_, i) => !savedIndices.has(i)));
      setSaving(false);
      notify(
        savedIndices.size > 0
          ? `Logged ${savedIndices.size} of ${parts.ready.length}`
          : "Couldn't log these",
        {
          detail: err instanceof Error ? err.message : 'Nothing else was saved — try again.',
          tone: 'over',
        },
      );
      return;
    }

    const count = savedIndices.size;
    const elsewhere = [...monthsHit].filter((m) => m !== monthId);
    notify(`${count} ${count === 1 ? 'expense' : 'expenses'} logged · ${money(readyTotal)}`, {
      detail:
        elsewhere.length > 0
          ? `Some landed in ${elsewhere.map((m) => monthLabel(m, { year: false })).join(', ')}`
          : undefined,
    });
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

        <datalist id="bulk-description-suggestions">
          {descriptionSuggestions.map((d) => (
            <option key={d} value={d} />
          ))}
        </datalist>

        <div>
          {rows.map((row, index) => {
            const showError = submitted && flagged.has(index);
            const lockedRow = submitted && parts.locked.includes(index);
            return (
              <div className="bulkrow" key={index}>
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
