import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Expense } from '../types/models';
import { isSplit, netAmount, reimbursementOf } from '../lib/expense';
import { formatMoney, type MoneyOptions } from '../lib/money';
import type { PaceTone } from '../lib/projection';
import { useApp } from '../state/store';
import { IconCheck, IconClose, IconInfo, IconTrendUp } from './Icons';

/* ------------------------------- money --------------------------------- */

export function Money({
  amount,
  compact,
  signed,
  className = '',
}: { amount: number; className?: string } & Omit<MoneyOptions, 'currency'>) {
  const { settings } = useApp();
  return (
    <span className={`num ${className}`.trim()}>
      {formatMoney(amount, { currency: settings.currency, compact, signed })}
    </span>
  );
}

/**
 * The amount a list row leads with is always the net — what the month actually
 * cost. The gross is still visible, but as detail rather than the headline,
 * because it isn't the number the budget is made of.
 */
export function ExpenseAmount({
  expense,
}: {
  expense: Pick<Expense, 'amount' | 'reimbursement'>;
}) {
  return (
    <span className="list__amount num">
      <Money amount={netAmount(expense)} />
    </span>
  );
}

/** The "$175.00 − $150.00 back" detail, for a list row's sub-line. */
export function SplitNote({
  expense,
}: {
  expense: Pick<Expense, 'amount' | 'reimbursement'>;
}) {
  const money = useMoneyFormatter();
  if (!isSplit(expense)) return null;
  return (
    <>
      <span>·</span>
      <span>
        {money(expense.amount)} − {money(reimbursementOf(expense))} back
      </span>
    </>
  );
}

export function useMoneyFormatter() {
  const { settings } = useApp();
  return (amount: number, opts: Omit<MoneyOptions, 'currency'> = {}) =>
    formatMoney(amount, { ...opts, currency: settings.currency });
}

/* ------------------------------- status -------------------------------- */

const TONE_CLASS: Record<PaceTone, string> = {
  good: 'status--good',
  info: 'status--info',
  over: 'status--over',
};

/**
 * Status is never carried by color alone (§6, accessibility): every pill
 * pairs its color with an icon and a written label.
 */
export function StatusPill({ tone, children }: { tone: PaceTone; children: ReactNode }) {
  const Icon = tone === 'good' ? IconCheck : tone === 'over' ? IconTrendUp : IconInfo;
  return (
    <span className={`status ${TONE_CLASS[tone]}`}>
      <Icon />
      {children}
    </span>
  );
}

/* -------------------------------- meter -------------------------------- */

export function Meter({
  used,
  elapsed,
  tone,
  label,
}: {
  /** 0–1, may exceed 1. */
  used: number;
  /** 0–1 — where an even pace would be right now. */
  elapsed?: number;
  tone: PaceTone;
  label: string;
}) {
  const pct = Math.min(100, Math.max(0, used * 100));
  const pacePct = elapsed === undefined ? null : Math.min(100, Math.max(0, elapsed * 100));
  const fillTone = tone === 'over' ? 'meter__fill--over' : tone === 'good' ? 'meter__fill--good' : '';
  return (
    <div
      role="img"
      aria-label={label}
      className="meter"
      style={{ ['--pct' as string]: `${pct}%`, ['--pace' as string]: `${pacePct ?? 0}%` }}
    >
      <div className={`meter__fill ${fillTone}`} />
      {pacePct !== null && <div className="meter__marker" title="Today, at an even pace" />}
    </div>
  );
}

/* -------------------------------- sheet -------------------------------- */

export function Sheet({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Read via a ref inside the effect below so that a parent re-render that
  // hands us a new onClose identity (e.g. while the user is typing) can't
  // tear the effect down and re-run it — that re-capture is what broke
  // "restore focus to the opener": it kept re-registering the opener as
  // whatever was focused *inside* the sheet at that moment.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Whatever had focus right before the sheet opened — restored on close.
  // This has to be captured during render (a lazy useState initializer runs
  // synchronously, once, before the sheet is even mounted), not inside the
  // useEffect below: an autoFocus field inside the sheet claims focus during
  // React's commit — which happens *before* useEffect runs — so reading
  // document.activeElement there would already see that field, not opener.
  const [opener] = useState<HTMLElement | null>(() => document.activeElement as HTMLElement | null);

  useEffect(() => {
    const node = ref.current;
    const FOCUSABLE = 'input,select,textarea,button,a[href],[tabindex]:not([tabindex="-1"])';
    const focusables = () =>
      node
        ? Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
            (el) => !el.hasAttribute('disabled') && el.getClientRects().length > 0,
          )
        : [];

    // Only move focus into the sheet if nothing inside it already has it —
    // an autoFocus field claims focus before this effect runs, and
    // stealing it back here is what broke autoFocus.
    if (!node?.contains(document.activeElement)) {
      focusables()[0]?.focus();
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      // Trap Tab inside the sheet so it never reaches the covered page.
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey ? active === first || !node?.contains(active) : active === last) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
      // Return focus to whatever opened the sheet, not <body>.
      opener?.focus();
    };
    // Mount/unmount only — see the onCloseRef note above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div
      className="scrim"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="sheet__grip" />
        <div className="row row--between" style={{ marginBottom: 'var(--s-4)' }}>
          <h2 className="sheet__title" style={{ marginBottom: 0 }}>
            {title}
          </h2>
          <button className="btn btn--ghost btn--sm" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </div>
        {children}
        {footer && <div style={{ marginTop: 'var(--s-5)' }}>{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------- toasts -------------------------------- */

export function Toasts() {
  const { toasts, dismissToast } = useApp();
  if (toasts.length === 0) return null;
  return createPortal(
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <span>{t.message}</span>
          {t.detail && <span className="dim">{t.detail}</span>}
          {t.action && (
            <button
              type="button"
              className="toast__action"
              onClick={() => {
                t.action?.run();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>,
    document.body,
  );
}

/* ------------------------------- fields -------------------------------- */

export function Field({
  label,
  hint,
  children,
  id,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {children}
      {hint && <span className="stat__note">{hint}</span>}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon}
      <div>
        <div style={{ color: 'var(--text-secondary)', marginBottom: 4 }}>{title}</div>
        {children}
      </div>
    </div>
  );
}

export function SectionHeading({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="row row--between" style={{ marginBottom: 'var(--s-3)' }}>
      <h2 className="section-label">{title}</h2>
      {action}
    </div>
  );
}
