import { useRef, useState } from 'react';
import type { BackupFile, Category, RecurringExpense } from '../types/models';
import { CATEGORY_PALETTE } from '../data/seed';
import { ordinal } from '../lib/dates';
import { parseAmount } from '../lib/money';
import { IconDownload, IconInfo, IconRepeat, IconUpload } from '../components/Icons';
import { Field, Money, SectionHeading, Sheet, useMoneyFormatter } from '../components/ui';
import { useApp } from '../state/store';
import { useTheme } from '../state/useTheme';

export function SettingsScreen() {
  const { categories, recurring, durable, storageLocation } = useApp();
  const { pref: theme, setPref: setTheme } = useTheme();
  const [editingCategory, setEditingCategory] = useState<Category | 'new' | null>(null);
  const [editingRecurring, setEditingRecurring] = useState<RecurringExpense | 'new' | null>(null);

  return (
    <div className="stack" style={{ ['--gap' as string]: 'var(--s-5)' }}>
      {!durable && (
        <div className="banner" style={{ borderColor: 'var(--red-dim)', background: 'var(--red-dim)' }}>
          <IconInfo />
          <div className="banner__body">
            This browser wouldn't let the app open local storage, so everything is held in memory
            for this session only. Export a backup before you close the tab.
          </div>
        </div>
      )}

      <section className="card card--flush">
        <div className="row row--between" style={{ padding: 'var(--s-5) var(--s-5) var(--s-3)' }}>
          <h2 className="section-label">Recurring expenses</h2>
          <button
            className="linkish"
            aria-label="Add recurring expense"
            onClick={() => setEditingRecurring('new')}
          >
            Add
          </button>
        </div>
        <p
          className="muted"
          style={{ fontSize: 'var(--t-small)', padding: '0 var(--s-5) var(--s-4)' }}
        >
          Never logged automatically — the app just asks when one is due, and counts it in the
          projection until you answer.
        </p>
        {recurring.length === 0 ? (
          <div className="empty" style={{ paddingTop: 0 }}>
            <IconRepeat />
            <span>Nothing recurring yet. Rent, subscriptions, the gym — that sort of thing.</span>
          </div>
        ) : (
          <div className="list">
            {recurring.map((item) => (
              <button
                className="list__item"
                key={item.id}
                onClick={() => setEditingRecurring(item)}
              >
                <span className="list__main">
                  <span className="list__title" style={{ opacity: item.active ? 1 : 0.5 }}>
                    {item.description}
                  </span>
                  <span className="list__sub">
                    around the {ordinal(item.dayOfMonth)}
                    {!item.active && (
                      <>
                        <span>·</span>
                        <span>paused</span>
                      </>
                    )}
                  </span>
                </span>
                <span className="list__amount num">
                  <Money amount={item.amount} />
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="card card--flush">
        <div className="row row--between" style={{ padding: 'var(--s-5) var(--s-5) var(--s-3)' }}>
          <h2 className="section-label">Categories</h2>
          <button
            className="linkish"
            aria-label="Add category"
            onClick={() => setEditingCategory('new')}
          >
            Add
          </button>
        </div>
        <p
          className="muted"
          style={{ fontSize: 'var(--t-small)', padding: '0 var(--s-5) var(--s-4)' }}
        >
          Archiving keeps a category out of new expenses without touching the history that already
          uses it.
        </p>
        <div className="list">
          {categories.map((category) => (
            <button
              className="list__item"
              key={category.id}
              onClick={() => setEditingCategory(category)}
            >
              <span className="dot" style={{ background: category.color }} />
              <span className="list__main">
                <span className="list__title" style={{ opacity: category.archived ? 0.5 : 1 }}>
                  {category.name}
                </span>
                {category.archived && <span className="list__sub">archived</span>}
              </span>
            </button>
          ))}
        </div>
      </section>

      <DataSection />

      <section className="card">
        <SectionHeading title="Appearance" />
        <div className="row row--between">
          <span style={{ fontSize: 'var(--t-small)' }}>Theme</span>
          <div className="segmented" role="group" aria-label="Theme">
            <button aria-pressed={theme === 'system'} onClick={() => setTheme('system')}>
              System
            </button>
            <button aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>
              Dark
            </button>
            <button aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>
              Light
            </button>
          </div>
        </div>
      </section>

      <p className="dim" style={{ fontSize: 'var(--t-micro)', textAlign: 'center' }}>
        {storageLocation === 'server'
          ? 'Shared on this Home Assistant — every device that opens it here sees the same budget. Theme is set per device. No account, no analytics.'
          : 'Everything stays on this device. No account, no sync, no analytics.'}
      </p>

      {editingCategory && (
        <CategorySheet
          category={editingCategory === 'new' ? null : editingCategory}
          onClose={() => setEditingCategory(null)}
        />
      )}
      {editingRecurring && (
        <RecurringSheet
          recurring={editingRecurring === 'new' ? null : editingRecurring}
          onClose={() => setEditingRecurring(null)}
        />
      )}
    </div>
  );
}

/* ------------------------------ data ---------------------------------- */

function DataSection() {
  const { exportBackup, importBackup, notify, storageLocation } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const doExport = async () => {
    const backup = await exportBackup();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `budget-backup-${backup.exportedAt.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify('Backup downloaded');
  };

  return (
    <section className="card">
      <SectionHeading title="Backup" />
      <p className="muted" style={{ fontSize: 'var(--t-small)', marginBottom: 'var(--s-4)' }}>
        {storageLocation === 'server'
          ? 'Data is shared on this Home Assistant — every device that opens this page sees the same budget. A JSON export is still worth keeping.'
          : 'Data lives in this browser only, so clearing site data would take it with it. A JSON export is your safety net.'}
      </p>
      <div className="grid-2">
        <button className="btn btn--quiet" onClick={doExport}>
          <IconDownload />
          Export
        </button>
        <button className="btn btn--quiet" onClick={() => fileRef.current?.click()}>
          <IconUpload />
          Restore
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          try {
            const parsed = JSON.parse(await file.text()) as BackupFile;
            if (parsed.format !== 'budget-tracker-backup') {
              setError('That file is not a backup from this app.');
              return;
            }
            await importBackup(parsed);
            setError(null);
            notify('Backup restored');
          } catch {
            setError('That file could not be read.');
          }
        }}
      />
      {error && (
        <p className="tone-over" style={{ fontSize: 'var(--t-small)', marginTop: 'var(--s-3)' }}>
          {error}
        </p>
      )}
      <p className="stat__note" style={{ marginTop: 'var(--s-3)' }}>
        Restoring replaces everything currently in the app.
      </p>
    </section>
  );
}

/* ---------------------------- categories ------------------------------ */

function CategorySheet({
  category,
  onClose,
}: {
  category: Category | null;
  onClose: () => void;
}) {
  const { saveCategory, createCategory, notify } = useApp();
  const [name, setName] = useState(category?.name ?? '');
  const [color, setColor] = useState(category?.color ?? CATEGORY_PALETTE[0]);

  const save = async () => {
    if (!name.trim()) return;
    if (category) {
      await saveCategory({ ...category, name: name.trim(), color });
      notify('Category updated');
    } else {
      await createCategory(name, color);
      notify('Category added');
    }
    onClose();
  };

  return (
    <Sheet title={category ? 'Edit category' : 'New category'} onClose={onClose}>
      <div className="stack" style={{ ['--gap' as string]: 'var(--s-4)' }}>
        <Field label="Name" id="cat-name">
          <input
            id="cat-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Coffee"
          />
        </Field>

        <Field label="Color">
          <div className="chiprow">
            {CATEGORY_PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                className="chip"
                aria-pressed={color === c}
                aria-label={`Color ${c}`}
                onClick={() => setColor(c)}
                style={{ padding: 9 }}
              >
                <span
                  className="chip__dot"
                  style={{ background: c, width: 14, height: 14 }}
                />
              </button>
            ))}
          </div>
        </Field>

        <button className="btn btn--primary btn--block" onClick={save} disabled={!name.trim()}>
          {category ? 'Save changes' : 'Add category'}
        </button>

        {category && (
          <button
            className="btn btn--ghost btn--block"
            onClick={async () => {
              await saveCategory({ ...category, archived: !category.archived });
              notify(category.archived ? 'Category restored' : 'Category archived');
              onClose();
            }}
          >
            {category.archived ? 'Restore category' : 'Archive category'}
          </button>
        )}
      </div>
    </Sheet>
  );
}

/* ----------------------------- recurring ------------------------------ */

function RecurringSheet({
  recurring,
  onClose,
}: {
  recurring: RecurringExpense | null;
  onClose: () => void;
}) {
  const { categories, saveRecurring, createRecurring, deleteRecurring, notify } = useApp();
  const money = useMoneyFormatter();
  const [description, setDescription] = useState(recurring?.description ?? '');
  const [amountText, setAmountText] = useState(recurring ? String(recurring.amount) : '');
  const [category, setCategory] = useState(recurring?.category ?? categories[0]?.id ?? '');
  const [day, setDay] = useState(String(recurring?.dayOfMonth ?? 1));
  const [confirmDelete, setConfirmDelete] = useState(false);

  const amount = parseAmount(amountText);
  const valid = description.trim() && amount !== null && amount > 0;

  const save = async () => {
    if (!valid) return;
    const dayOfMonth = Math.min(31, Math.max(1, Number(day) || 1));
    if (recurring) {
      await saveRecurring({
        ...recurring,
        description: description.trim(),
        amount: amount as number,
        category,
        dayOfMonth,
      });
      notify('Recurring expense updated');
    } else {
      await createRecurring({
        description: description.trim(),
        amount: amount as number,
        category,
        dayOfMonth,
        active: true,
      });
      notify('Recurring expense added', { detail: money(amount as number) });
    }
    onClose();
  };

  return (
    <Sheet title={recurring ? 'Edit recurring expense' : 'New recurring expense'} onClose={onClose}>
      <div className="stack" style={{ ['--gap' as string]: 'var(--s-4)' }}>
        <Field label="Description" id="rec-desc">
          <input
            id="rec-desc"
            className="input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Rent"
          />
        </Field>

        <Field label="Amount">
          <div className="amount-input">
            <span className="amount-input__symbol">$</span>
            <input
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              aria-label="Recurring amount"
            />
          </div>
        </Field>

        <Field label="Category">
          <div className="chiprow">
            {categories
              .filter((c) => !c.archived)
              .map((c) => (
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

        <Field label="Expected day of month" id="rec-day" hint="Used for the nudge and the projection">
          <input
            id="rec-day"
            className="input"
            type="number"
            min={1}
            max={31}
            value={day}
            onChange={(e) => setDay(e.target.value)}
          />
        </Field>

        <button className="btn btn--primary btn--block" onClick={save} disabled={!valid}>
          {recurring ? 'Save changes' : 'Add recurring expense'}
        </button>

        {recurring && (
          <>
            <button
              className="btn btn--ghost btn--block"
              onClick={async () => {
                await saveRecurring({ ...recurring, active: !recurring.active });
                notify(recurring.active ? 'Paused' : 'Resumed');
                onClose();
              }}
            >
              {recurring.active ? 'Pause this one' : 'Resume this one'}
            </button>
            <button
              className="btn btn--danger btn--block"
              onClick={async () => {
                if (!confirmDelete) {
                  setConfirmDelete(true);
                  return;
                }
                await deleteRecurring(recurring.id);
                notify('Recurring expense removed');
                onClose();
              }}
            >
              {confirmDelete ? 'Tap again to delete' : 'Delete'}
            </button>
          </>
        )}
      </div>
    </Sheet>
  );
}
