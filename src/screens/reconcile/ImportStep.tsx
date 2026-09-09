import { useMemo, useRef, useState } from 'react';
import {
  buildImportPlan,
  CANONICAL_TEMPLATE,
  detectDateFormat,
  detectSignConvention,
  importTransactions,
  type ColumnMapping,
  type DateFormat,
  type ImportPlan,
  type SignConvention,
} from '../../lib/csv';
import { monthLabel } from '../../lib/dates';
import { IconDownload, IconInfo, IconUpload } from '../../components/Icons';
import { Field, Money, Segmented } from '../../components/ui';
import { useApp } from '../../state/store';

const FIELD_LABELS: { key: keyof ColumnMapping; label: string; required?: boolean }[] = [
  { key: 'date', label: 'Date', required: true },
  { key: 'description', label: 'Description', required: true },
  { key: 'amount', label: 'Amount', required: true },
  { key: 'debit', label: 'Debit column (optional)' },
  { key: 'credit', label: 'Credit column (optional)' },
];

/**
 * Import step (§4.5, revised for any CSV).
 *
 * The app has its own canonical shape — date, description, amount — and this
 * screen's job is to get any file into it. Everything is a guess the user can
 * override, and the preview shows exactly what will be imported before
 * anything is written.
 */
export function ImportStep({ monthId }: { monthId: string }) {
  const { startReconciliation, notify } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);

  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [dateFormat, setDateFormat] = useState<DateFormat>('mdy');
  const [sign, setSign] = useState<SignConvention>('positive-is-charge');
  const [scopeToMonth, setScopeToMonth] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadText = (text: string, name: string) => {
    try {
      const next = buildImportPlan(text);
      if (next.rows.length === 0) {
        setError('That file has no data rows in it.');
        return;
      }
      setPlan(next);
      setMapping(next.mapping);
      setDateFormat(next.dateFormat);
      setSign(next.signConvention);
      setFileName(name);
      setError(null);
    } catch {
      setError('That file could not be read as CSV.');
    }
  };

  const result = useMemo(() => {
    if (!plan || !mapping) return null;
    if (mapping.date < 0 || (mapping.amount < 0 && mapping.debit < 0)) return null;
    return importTransactions(plan.rows, {
      mapping,
      dateFormat,
      signConvention: sign,
      monthId: scopeToMonth ? monthId : undefined,
    });
  }, [plan, mapping, dateFormat, sign, scopeToMonth, monthId]);

  const setColumn = (key: keyof ColumnMapping, index: number) => {
    setMapping((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [key]: index };
      if (plan) {
        if (key === 'date') setDateFormat(detectDateFormat(plan.rows, index));
        if (key === 'amount' || key === 'debit') setSign(detectSignConvention(plan.rows, next));
      }
      return next;
    });
  };

  const downloadTemplate = () => {
    const blob = new Blob([CANONICAL_TEMPLATE], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'budget-import-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const start = async () => {
    if (!result || result.transactions.length === 0) return;
    setBusy(true);
    try {
      await startReconciliation(monthId, result.transactions, fileName, {
        credits: result.creditsIgnored,
        outsideMonth: result.outsideMonth,
        unreadable: result.skipped.length,
      });
      notify(`${result.transactions.length} transactions imported`);
    } finally {
      setBusy(false);
    }
  };

  if (!plan || !mapping) {
    return (
      <div className="stack" style={{ ['--gap' as string]: 'var(--s-4)' }}>
        <section className="card">
          <h2 style={{ fontSize: 'var(--t-heading)', fontWeight: 600, marginBottom: 6 }}>
            Import your statement
          </h2>
          <p className="muted" style={{ fontSize: 'var(--t-small)' }}>
            Any CSV works. The app needs three things — a date, a description and an amount — and
            it will try to find them itself. You get to check its guesses before anything is
            imported.
          </p>

          <div
            className="stack"
            style={{ ['--gap' as string]: 'var(--s-3)', marginTop: 'var(--s-5)' }}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                loadText(await file.text(), file.name);
                e.target.value = '';
              }}
            />
            <button className="btn btn--primary btn--block" onClick={() => fileRef.current?.click()}>
              <IconUpload />
              Choose a CSV file
            </button>
            <button className="btn btn--ghost btn--block" onClick={downloadTemplate}>
              <IconDownload />
              Download the template format
            </button>
          </div>

          {error && (
            <p className="tone-over" style={{ fontSize: 'var(--t-small)', marginTop: 'var(--s-4)' }}>
              {error}
            </p>
          )}
        </section>

        <details className="card">
          <summary style={{ cursor: 'pointer', fontSize: 'var(--t-small)' }}>
            Or paste the rows instead
          </summary>
          <PasteBox onLoad={(text) => loadText(text, 'pasted rows')} />
        </details>

        <div className="banner">
          <IconInfo />
          <div className="banner__body">
            The canonical format is <code>date,description,amount</code> — optionally followed by{' '}
            <code>category</code> and <code>notes</code>. Files in that shape import with no setup
            at all; anything else just needs the columns pointed at the right places.
          </div>
        </div>
      </div>
    );
  }

  const columnOptions = [
    { value: -1, label: '— none —' },
    ...plan.headers.map((h, i) => ({ value: i, label: h || `Column ${i + 1}` })),
  ];

  return (
    <div className="stack" style={{ ['--gap' as string]: 'var(--s-4)' }}>
      <section className="card">
        <div className="row row--between" style={{ marginBottom: 'var(--s-4)' }}>
          <div>
            <div className="section-label">Reading</div>
            <div>{fileName}</div>
            <div className="stat__note">
              {plan.rows.length} rows · {plan.hasHeader ? 'header detected' : 'no header row'} ·
              delimiter {plan.delimiter === '\t' ? 'tab' : `"${plan.delimiter}"`}
            </div>
          </div>
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => {
              setPlan(null);
              setMapping(null);
            }}
          >
            Change file
          </button>
        </div>

        {!plan.confident && (
          <div className="banner" style={{ marginBottom: 'var(--s-4)' }}>
            <IconInfo />
            <div className="banner__body">
              The column names weren't recognisable, so these are guesses from the data. Worth a
              quick check.
            </div>
          </div>
        )}

        <div className="stack" style={{ ['--gap' as string]: 'var(--s-3)' }}>
          {FIELD_LABELS.map(({ key, label }) => (
            <Field key={key} label={label} id={`map-${key}`}>
              <select
                id={`map-${key}`}
                className="select"
                value={mapping[key]}
                onChange={(e) => setColumn(key, Number(e.target.value))}
              >
                {columnOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
          ))}
        </div>

        <div className="stack" style={{ ['--gap' as string]: 'var(--s-4)', marginTop: 'var(--s-5)' }}>
          <Field label="Date order">
            <Segmented
              ariaLabel="Date order"
              value={dateFormat}
              onChange={setDateFormat}
              options={[
                { value: 'mdy', label: 'M/D/Y' },
                { value: 'dmy', label: 'D/M/Y' },
                { value: 'ymd', label: 'Y-M-D' },
              ]}
            />
          </Field>

          <Field label="Which sign means money spent">
            <Segmented
              ariaLabel="Sign convention"
              value={sign}
              onChange={setSign}
              options={[
                { value: 'positive-is-charge', label: 'Positive' },
                { value: 'negative-is-charge', label: 'Negative' },
              ]}
            />
          </Field>

          <label className="row" style={{ gap: 'var(--s-3)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={scopeToMonth}
              onChange={(e) => setScopeToMonth(e.target.checked)}
            />
            <span style={{ fontSize: 'var(--t-small)' }}>
              Only import rows dated in {monthLabel(monthId)}
            </span>
          </label>
        </div>
      </section>

      {result && (
        <section className="card">
          <div className="section-label" style={{ marginBottom: 'var(--s-3)' }}>
            Preview
          </div>
          <div className="tablewrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {result.transactions.slice(0, 6).map((t) => (
                  <tr key={t.id}>
                    <td className="num">{t.date}</td>
                    <td>{t.rawDescription}</td>
                    <td className="num" style={{ textAlign: 'right' }}>
                      <Money amount={t.amount} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 'var(--s-4)' }}>
            <div className="kv">
              <span className="kv__k">Charges to import</span>
              <span className="num">{result.transactions.length}</span>
            </div>
            {result.creditsIgnored > 0 && (
              <div className="kv">
                <span className="kv__k">Credits and refunds left out</span>
                <span className="num">{result.creditsIgnored}</span>
              </div>
            )}
            {result.outsideMonth > 0 && (
              <div className="kv">
                <span className="kv__k">Rows outside {monthLabel(monthId, { short: true })}</span>
                <span className="num">{result.outsideMonth}</span>
              </div>
            )}
            {result.skipped.length > 0 && (
              <div className="kv">
                <span className="kv__k">Rows that couldn't be read</span>
                <span className="num tone-over">{result.skipped.length}</span>
              </div>
            )}
          </div>

          {result.skipped.length > 0 && (
            <details style={{ marginTop: 'var(--s-3)' }}>
              <summary className="dim" style={{ fontSize: 'var(--t-small)', cursor: 'pointer' }}>
                See the skipped rows
              </summary>
              <div className="stack" style={{ ['--gap' as string]: 'var(--s-2)', marginTop: 'var(--s-3)' }}>
                {result.skipped.slice(0, 8).map((s) => (
                  <div key={s.rowNumber} className="stat__note">
                    Row {s.rowNumber}: {s.reason} — {s.raw.slice(0, 3).join(' · ')}
                  </div>
                ))}
              </div>
            </details>
          )}

          <button
            className="btn btn--primary btn--block"
            style={{ marginTop: 'var(--s-5)' }}
            disabled={busy || result.transactions.length === 0}
            onClick={start}
          >
            {result.transactions.length === 0
              ? 'Nothing to import yet'
              : `Import ${result.transactions.length} transactions`}
          </button>
        </section>
      )}

      {!result && (
        <p className="tone-over" style={{ fontSize: 'var(--t-small)' }}>
          Point the date and amount columns at the right places to see a preview.
        </p>
      )}
    </div>
  );
}

function PasteBox({ onLoad }: { onLoad: (text: string) => void }) {
  const [text, setText] = useState('');
  return (
    <div className="stack" style={{ ['--gap' as string]: 'var(--s-3)', marginTop: 'var(--s-4)' }}>
      <textarea
        className="textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'date,description,amount\n2026-09-01,Trader Joe\'s,42.18'}
      />
      <button
        className="btn btn--quiet"
        disabled={!text.trim()}
        onClick={() => onLoad(text)}
      >
        Read these rows
      </button>
    </div>
  );
}
