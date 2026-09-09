import { useMemo, useState } from 'react';
import type { BankTransaction, Expense, ReconciliationSession } from '../../types/models';
import { suggestCandidates, type Candidate } from '../../lib/reconcile';
import { formatDayLabel } from '../../lib/dates';
import { ExpenseSheet } from '../../components/ExpenseSheet';
import { SwipeCard } from '../../components/SwipeCard';
import { IconArrowLeft, IconArrowRight, IconCheck } from '../../components/Icons';
import { Money, Sheet, useMoneyFormatter } from '../../components/ui';
import { useApp, useCategoryMap } from '../../state/store';

/** Above this many statement rows, a pip-per-row indicator stops being readable
 *  or honest at a glance, so the queue falls back to a plain count instead. */
const PIP_LIMIT = 14;

/** Below this, a candidate is close enough to preselect for a quick confirm;
 *  at or below it, approval still works, it just starts from nothing picked. */
const STRONG_MATCH_SCORE = 0.85;

/**
 * Queue A (§4.6): bank rows that didn't auto-match.
 *
 * Right means "I logged this" — the app proposes its closest guess and waits
 * for approval; nothing links without the user seeing the specific expense.
 * Left means "I didn't log this" — a prefilled add form, one category tap away
 * from done.
 */
export function QueueA({
  monthId,
  session,
  expenses,
  onDone,
}: {
  monthId: string;
  session: ReconciliationSession;
  expenses: Expense[];
  onDone: () => void;
}) {
  const { linkTransaction, addExpenseFromTransaction, notify } = useApp();
  const categories = useCategoryMap();
  const money = useMoneyFormatter();

  const [matching, setMatching] = useState<BankTransaction | null>(null);
  const [adding, setAdding] = useState<BankTransaction | null>(null);
  // Swiping opens a sheet instead of resolving the transaction right away, so
  // the card has already flown off-screen (dx ~520, opacity 0) by the time
  // that sheet is showing. If the sheet is dismissed unconfirmed, `current`
  // hasn't changed, so SwipeCard's cardKey-keyed reset effect would never
  // re-fire and the card would stay stranded off-screen. Bumping this on
  // every sheet close forces that reset regardless of which sheet it was.
  const [resetToken, setResetToken] = useState(0);

  const queue = useMemo(
    () => session.transactions.filter((t) => t.matchStatus === 'unmatched'),
    [session.transactions],
  );
  const matchedCount = session.transactions.length - queue.length;

  const unlinkedExpenses = useMemo(
    () => expenses.filter((e) => e.reconciliationStatus !== 'matched'),
    [expenses],
  );

  if (queue.length === 0) {
    return (
      <section className="card" style={{ textAlign: 'center' }}>
        <div className="tone-good" style={{ display: 'flex', justifyContent: 'center' }}>
          <IconCheck className="" />
        </div>
        <h2 style={{ fontSize: 'var(--t-heading)', fontWeight: 600, margin: '10px 0 6px' }}>
          Statement queue clear
        </h2>
        <p className="muted" style={{ fontSize: 'var(--t-small)', marginBottom: 'var(--s-5)' }}>
          Every row on the statement is now accounted for. Next: the things you logged that the
          statement doesn't show.
        </p>
        <button className="btn btn--primary btn--block" onClick={onDone}>
          Review what you logged
        </button>
      </section>
    );
  }

  const current = queue[0];
  const candidates = suggestCandidates(current, unlinkedExpenses);

  return (
    <>
      <div className="row row--between">
        <div>
          <div className="section-label">Statement rows to review</div>
          <div className="stat__note">
            {queue.length} left · {matchedCount} matched automatically
          </div>
        </div>
        {/* A pip per row is only an honest picture up to a handful of rows —
            past that, cap the pip count and fall back to a plain count so a
            long statement never reads as "almost done" when it isn't. */}
        {session.transactions.length <= PIP_LIMIT ? (
          <div className="progress-pips" aria-hidden="true">
            {session.transactions.map((t) => (
              <span key={t.id} className={`pip ${t.matchStatus === 'matched' ? 'pip--done' : ''}`} />
            ))}
          </div>
        ) : (
          <div className="stat__note" aria-hidden="true">
            {matchedCount} of {session.transactions.length} read
          </div>
        )}
      </div>

      <SwipeCard
        cardKey={`${current.id}:${resetToken}`}
        leftLabel="Not logged"
        rightLabel="I logged this"
        onSwipeLeft={() => setAdding(current)}
        onSwipeRight={() => setMatching(current)}
      >
        <div style={{ flex: 1 }}>
          <div className="section-label">{formatDayLabel(current.date, monthId)}</div>
          <div className="txn__amount num" style={{ marginTop: 'var(--s-2)' }}>
            <Money amount={current.amount} />
          </div>
          <div className="txn__desc">{current.rawDescription}</div>
          {candidates.length > 0 && (
            <div className="stat__note" style={{ marginTop: 'var(--s-4)' }}>
              Closest thing you logged: {candidates[0].expense.description} ·{' '}
              {money(candidates[0].expense.amount)} · {candidates[0].reason.toLowerCase()}
            </div>
          )}
        </div>

        <div className="deck__actions" style={{ marginTop: 'var(--s-4)' }}>
          <button className="btn btn--quiet" onClick={() => setAdding(current)}>
            <IconArrowLeft />
            Not logged
          </button>
          <button className="btn btn--quiet" onClick={() => setMatching(current)}>
            I logged this
            <IconArrowRight />
          </button>
        </div>
      </SwipeCard>

      <p className="dim" style={{ fontSize: 'var(--t-micro)', textAlign: 'center' }}>
        Swipe the card, or use the buttons.
      </p>

      {matching && (
        <MatchSheet
          txn={matching}
          candidates={suggestCandidates(matching, unlinkedExpenses)}
          allExpenses={unlinkedExpenses}
          onClose={() => {
            setMatching(null);
            setResetToken((n) => n + 1);
          }}
          onConfirm={async (expenseId) => {
            await linkTransaction(monthId, matching.id, expenseId);
            notify('Linked to what you logged');
            setMatching(null);
          }}
          onNoMatch={() => {
            setAdding(matching);
            setMatching(null);
          }}
        />
      )}

      {adding && (
        <ExpenseSheet
          monthId={monthId}
          title="Add from statement"
          confirmLabel="Add expense"
          allowDelete={false}
          prefill={{
            amount: adding.amount,
            date: adding.date,
            description: adding.rawDescription,
            notes: adding.noteHint,
            // Honours the optional `category` column of the canonical format —
            // if the file named a category the app knows, it's preselected.
            category: categoryIdFromHint(adding.categoryHint, categories),
          }}
          onClose={() => {
            setAdding(null);
            setResetToken((n) => n + 1);
          }}
          onSave={async (values) => {
            await addExpenseFromTransaction(monthId, adding.id, values);
            notify(`${money(values.amount)} added`);
          }}
        />
      )}
    </>
  );
}

/** Resolve a category name from the CSV to one of the user's own categories. */
function categoryIdFromHint(
  hint: string | undefined,
  categories: Map<string, { id: string; name: string; archived: boolean }>,
): string | undefined {
  if (!hint) return undefined;
  const wanted = hint.trim().toLowerCase();
  for (const category of categories.values()) {
    if (!category.archived && category.name.toLowerCase() === wanted) return category.id;
  }
  return undefined;
}

/** The approval step — a proposal, never an auto-confirm (§4.6). */
function MatchSheet({
  txn,
  candidates,
  allExpenses,
  onClose,
  onConfirm,
  onNoMatch,
}: {
  txn: BankTransaction;
  candidates: Candidate[];
  allExpenses: Expense[];
  onClose: () => void;
  onConfirm: (expenseId: string) => Promise<void>;
  onNoMatch: () => void;
}) {
  const categories = useCategoryMap();
  const money = useMoneyFormatter();
  const [showAll, setShowAll] = useState(candidates.length === 0);
  // Only a strong candidate gets a head start — a weak one (different day,
  // amount not quite right) waits for a deliberate tap so a merely-nearby
  // expense is never a swipe away from being confirmed by reflex.
  const [selected, setSelected] = useState<string | null>(
    candidates[0] && candidates[0].score >= STRONG_MATCH_SCORE ? candidates[0].expense.id : null,
  );

  const list = showAll
    ? allExpenses.map((expense) => ({ expense, reason: '', score: 0 }))
    : candidates;

  return (
    <Sheet title="Which one is this?" onClose={onClose}>
      <div className="card" style={{ padding: 'var(--s-4)', marginBottom: 'var(--s-4)' }}>
        <div className="stat__label">From your statement</div>
        <div className="row row--between" style={{ marginTop: 6 }}>
          <span>{txn.rawDescription}</span>
          <span className="num" style={{ fontWeight: 600 }}>
            <Money amount={txn.amount} />
          </span>
        </div>
        <div className="stat__note">{formatDayLabel(txn.date)}</div>
      </div>

      {list.length === 0 ? (
        <p className="muted" style={{ fontSize: 'var(--t-small)' }}>
          Nothing you logged is close to this one. Adding it as a new expense is probably right.
        </p>
      ) : (
        <div className="stack" style={{ ['--gap' as string]: 'var(--s-2)' }}>
          {!showAll && (
            <p className="muted" style={{ fontSize: 'var(--t-small)' }}>
              Closest {list.length === 1 ? 'match' : 'matches'} from what you logged. Confirm one,
              or pick from everything.
            </p>
          )}
          {list.map(({ expense, reason }) => (
            <button
              key={expense.id}
              className="card row row--between"
              style={{
                padding: 'var(--s-4)',
                textAlign: 'left',
                borderColor: selected === expense.id ? 'var(--blue-line)' : 'var(--hairline)',
                background: selected === expense.id ? 'var(--blue-dim)' : 'var(--surface)',
              }}
              onClick={() => setSelected(expense.id)}
              aria-pressed={selected === expense.id}
            >
              <span style={{ minWidth: 0 }}>
                <span className="row" style={{ gap: 'var(--s-2)' }}>
                  <span
                    className="dot"
                    style={{
                      background: categories.get(expense.category)?.color ?? 'var(--text-tertiary)',
                    }}
                  />
                  <span className="list__title">{expense.description}</span>
                </span>
                <span className="stat__note">
                  {formatDayLabel(expense.date)}
                  {reason ? ` · ${reason.toLowerCase()}` : ''}
                </span>
              </span>
              <span className="num" style={{ fontWeight: 550 }}>
                {money(expense.amount)}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="stack" style={{ ['--gap' as string]: 'var(--s-3)', marginTop: 'var(--s-5)' }}>
        <button
          className="btn btn--primary btn--block"
          disabled={!selected}
          onClick={() => selected && onConfirm(selected)}
        >
          Confirm this match
        </button>
        {!showAll && allExpenses.length > 0 && (
          <button className="btn btn--ghost btn--block" onClick={() => setShowAll(true)}>
            Pick from everything I logged
          </button>
        )}
        <button className="btn btn--ghost btn--block" onClick={onNoMatch}>
          None of these — add it as new
        </button>
      </div>
    </Sheet>
  );
}
