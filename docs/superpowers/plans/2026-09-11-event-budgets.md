# Event Budgets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second budgeting facet — a named event (trip, wedding, laptop) with its own target and fund, saved for over months and then spent from, where contributions count against the month they are made in and event spending never counts against a month.

**Architecture:** One new record (`BudgetEvent`) plus two optional fields on `Expense` (`eventId`, `eventKind`). There is no separate event-entry record: contributions and event spends *are* expenses living in their real months, so they reach the ledger and reconciliation for free. The only thing the new fields change is budget arithmetic, gated behind one predicate — `countsAgainstMonth(e)` — applied in `summarizeMonth`, the Dashboard's category breakdown, and the Expenses screen total.

**Tech Stack:** React 18 + TypeScript, Vite, no runtime dependencies. Tests are `node --experimental-strip-types --test` over `test/*.test.ts` (relative imports inside `src/lib` and in test files carry explicit `.ts` extensions). Browser checks are Playwright scripts in `scripts/`.

**Spec:** `docs/superpowers/specs/2026-09-11-event-budgets-design.md`

## Global Constraints

Copied verbatim from the spec and from `CLAUDE.md`. Every task's requirements implicitly include this section.

- **The one rule:** contributions count against the month you make them; spending on an event does not count against any month.
- **No new record for entries.** Contributions and event spends are `Expense` rows tagged with `eventId` + `eventKind`.
- **Money:** never concatenate a currency string — always `formatMoney` / `<Money>` / `useMoneyFormatter` from `src/lib/money.ts`. Negative sign is U+2212 `−`, not `-`. Every sum goes through integer cents (`sumAmounts`, `sumNet`, `round2`).
- **Copy:** facts, not verdicts. No exclamation marks. Terse, present tense, second person.
- **Three functional hues only** — blue (primary/neutral/info), sage (good), soft red (over). No fourth hue. Category colors are only ever an 8px `.dot` / `.chip__dot` or a `.catbar` fill.
- **Status is never color alone** — always color + icon + label (`<StatusPill>`).
- **No `<select>` for category** — always the `.chiprow` chip row with `aria-pressed`.
- **No filled red button.** Destructive is `.btn--danger` (ghost) with a two-step in-place confirm ("Delete event" → "Tap again to delete").
- **`<Sheet>` is the only modal primitive.** Do not introduce a second one.
- **No shadow on cards, sheets, or list rows** — separate with `--hairline`. No blur/glass/gloss/glow/gradients.
- **Motion:** only `--ease` and `--dur`. No new curve, no new duration.
- **Progressive disclosure:** secondary fields hide behind a `.linkish` "+ …" toggle.
- **All figures** use `--font-num` + `tabular-nums` via `.num` / `<Money>`.
- **Do not run `git commit`.** A husky `post-commit` hook bumps `version:` in `budget-server/config.yaml` and `package.json` and amends it into the commit. `CLAUDE.md` says not to commit unless the user asked. Steps below say "Verify" where a normal plan would say "Commit".
- **Verification commands:** `npm test` (unit) and `npm run build` (tsc -b + bundle). Both must be clean before the work is called done.

---

### Task 1: Domain types and the `countsAgainstMonth` predicate

**Files:**
- Modify: `src/types/models.ts`
- Create: `src/lib/event.ts`
- Create: `test/event.test.ts`

**Interfaces:**
- Consumes: `ISODate`, `Timestamp`, `Expense` from `src/types/models.ts`.
- Produces:
  - `type EventPhase = 'saving' | 'spending' | 'closed'`
  - `interface BudgetEvent` (fields listed in Step 3)
  - `Expense.eventId?: string`, `Expense.eventKind?: EventKind` where `type EventKind = 'contribution' | 'spend'`
  - `countsAgainstMonth(e: Pick<Expense, 'eventKind'>): boolean` from `src/lib/event.ts`
  - `isContribution(e)`, `isEventSpend(e)` from `src/lib/event.ts`

- [ ] **Step 1: Write the failing test**

Create `test/event.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { countsAgainstMonth, isContribution, isEventSpend } from '../src/lib/event.ts';

test('only event spending is kept out of a month', () => {
  assert.equal(countsAgainstMonth({}), true);
  assert.equal(countsAgainstMonth({ eventKind: undefined }), true);
  assert.equal(countsAgainstMonth({ eventKind: 'contribution' }), true);
  assert.equal(countsAgainstMonth({ eventKind: 'spend' }), false);
});

test('the two event roles are told apart', () => {
  assert.equal(isContribution({ eventKind: 'contribution' }), true);
  assert.equal(isContribution({ eventKind: 'spend' }), false);
  assert.equal(isContribution({}), false);
  assert.equal(isEventSpend({ eventKind: 'spend' }), true);
  assert.equal(isEventSpend({ eventKind: 'contribution' }), false);
  assert.equal(isEventSpend({}), false);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../src/lib/event.ts'`.

- [ ] **Step 3: Add the types**

In `src/types/models.ts`, after the `RecurringExpense` interface, add:

```ts
/**
 * A budget that isn't a month: a trip, a wedding, a laptop. It owns a fund.
 * Money goes in (contributions) and later comes out (spending), and the phase
 * says which of those the user is doing right now.
 */
export type EventPhase = 'saving' | 'spending' | 'closed';

export interface BudgetEvent {
  id: string;
  name: string;
  /** What the whole thing is planned to cost. */
  targetAmount: number;
  phase: EventPhase;
  /** When the event happens — optional, and what the saving pace is measured against. */
  startDate?: ISODate;
  endDate?: ISODate;
  /** Planned set-aside per month; 0 means "no plan, just a pot". */
  monthlyContribution: number;
  /** Category used for contributions and preselected for spending. */
  category: string;
  note?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  closedAt?: Timestamp;
}
```

In the same file, extend `Expense` — add these two fields just after `matchedTransactionId`:

```ts
  /**
   * Set when this expense belongs to an event's ledger. There is deliberately
   * no separate entry record: a contribution and a trip dinner are both money
   * that left the account, so they are expenses, and they reach the month's
   * ledger and reconciliation with no special case.
   */
  eventId?: string;
  /**
   * Which side of the event's fund this is. Only meaningful with `eventId`.
   * `contribution` counts against its month like any expense — that is the
   * line item in the monthly budget. `spend` never counts against a month:
   * that money was already budgeted when it was saved.
   */
  eventKind?: EventKind;
```

And above `Expense`, add:

```ts
export type EventKind = 'contribution' | 'spend';
```

- [ ] **Step 4: Write the minimal implementation**

Create `src/lib/event.ts`:

```ts
/**
 * Event budgets — a pot of money that isn't a month.
 *
 * The whole feature rests on one rule, and this file owns it: money set aside
 * for an event counts against the month it was set aside in, and money spent
 * on the event counts against nothing, because it was already budgeted when it
 * was saved. Every monthly figure in the app runs its expenses through
 * `countsAgainstMonth` so that rule can't be applied in two different ways in
 * two different screens.
 */

import type { Expense } from '../types/models';

export function isContribution(e: Pick<Expense, 'eventKind'>): boolean {
  return e.eventKind === 'contribution';
}

export function isEventSpend(e: Pick<Expense, 'eventKind'>): boolean {
  return e.eventKind === 'spend';
}

/** Expenses a month's budget is made of: everything except event spending. */
export function countsAgainstMonth(e: Pick<Expense, 'eventKind'>): boolean {
  return e.eventKind !== 'spend';
}
```

- [ ] **Step 5: Run the test and verify it passes**

Run: `npm test`
Expected: PASS, all suites.

- [ ] **Step 6: Verify the typecheck**

Run: `npm run build`
Expected: clean — new optional fields break no existing call site.

---

### Task 2: `monthsBetween` date helper

**Files:**
- Modify: `src/lib/dates.ts`
- Modify: `test/logic.test.ts`

**Interfaces:**
- Produces: `monthsBetween(a: MonthId, b: MonthId): number` — whole months from `a` to `b`, positive when `b` is later.

- [ ] **Step 1: Write the failing test**

Append to `test/logic.test.ts` in the dates section (after the existing `shiftMonth` test):

```ts
test('monthsBetween counts whole months in either direction', () => {
  assert.equal(monthsBetween('2026-09', '2027-03'), 6);
  assert.equal(monthsBetween('2026-09', '2026-09'), 0);
  assert.equal(monthsBetween('2027-03', '2026-09'), -6);
  assert.equal(monthsBetween('2026-12', '2027-01'), 1);
});
```

Add `monthsBetween` to the existing `from '../src/lib/dates.ts'` import list at the top of the file.

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test`
Expected: FAIL — `monthsBetween is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/dates.ts`:

```ts
/** Whole months from `a` to `b` (positive when b is later). */
export function monthsBetween(a: MonthId, b: MonthId): number {
  const from = splitMonthId(a);
  const to = splitMonthId(b);
  return (to.year - from.year) * 12 + (to.month - from.month);
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test`
Expected: PASS.

---

### Task 3: `summarizeEvent` — the event's maths

**Files:**
- Modify: `src/lib/event.ts`
- Modify: `test/event.test.ts`

**Interfaces:**
- Consumes: `countsAgainstMonth` etc. (Task 1), `monthsBetween` (Task 2), `sumNet` from `src/lib/expense.ts`, `round2` from `src/lib/money.ts`, `PaceTone` from `src/lib/projection.ts`, `currentMonthId`/`monthIdOf`/`monthLabel`/`today` from `src/lib/dates.ts`.
- Produces: `interface EventSummary` and `summarizeEvent({ event, expenses, now? }): EventSummary` from `src/lib/event.ts`.

Note on imports: files under `src/lib` import each other with an explicit `.ts` extension (see `projection.ts` importing `./dates.ts`). Type-only imports from `../types/models` do **not** carry the extension. Follow both conventions exactly or the test runner cannot resolve the module.

- [ ] **Step 1: Write the failing tests**

Append to `test/event.test.ts`:

```ts
import { summarizeEvent } from '../src/lib/event.ts';
import type { BudgetEvent, Expense } from '../src/types/models';

function anEvent(patch: Partial<BudgetEvent> = {}): BudgetEvent {
  return {
    id: 'evt_1',
    name: 'Japan trip',
    targetAmount: 3000,
    phase: 'saving',
    monthlyContribution: 400,
    category: 'cat_other',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  };
}

let seq = 0;
function anExpense(patch: Partial<Expense> = {}): Expense {
  seq += 1;
  return {
    id: `exp_${seq}`,
    monthId: '2026-09',
    date: '2026-09-10',
    amount: 100,
    category: 'cat_other',
    description: 'Something',
    source: 'manual',
    reconciliationStatus: 'unreconciled',
    createdAt: '2026-09-10T00:00:00.000Z',
    updatedAt: '2026-09-10T00:00:00.000Z',
    eventId: 'evt_1',
    ...patch,
  };
}

test('saved and spent are net of splits and exact through cents', () => {
  const s = summarizeEvent({
    event: anEvent(),
    expenses: [
      anExpense({ eventKind: 'contribution', amount: 0.1 }),
      anExpense({ eventKind: 'contribution', amount: 0.2 }),
      anExpense({ eventKind: 'spend', amount: 175, reimbursement: 150 }),
    ],
    now: '2026-09-15',
  });
  assert.equal(s.saved, 0.3);
  assert.equal(s.spent, 25);
  assert.equal(s.contributionCount, 2);
  assert.equal(s.spendCount, 1);
});

test('the fund balance and the unfunded amount are two sides of one number', () => {
  const under = summarizeEvent({
    event: anEvent({ phase: 'spending' }),
    expenses: [
      anExpense({ eventKind: 'contribution', amount: 1000 }),
      anExpense({ eventKind: 'spend', amount: 180 }),
    ],
    now: '2026-09-15',
  });
  assert.equal(under.fundRemaining, 820);
  assert.equal(under.unfunded, 0);
  assert.equal(under.tone, 'good');
  assert.equal(under.statusLabel, '$820.00 left in the fund');

  const over = summarizeEvent({
    event: anEvent({ phase: 'spending' }),
    expenses: [
      anExpense({ eventKind: 'contribution', amount: 100 }),
      anExpense({ eventKind: 'spend', amount: 240 }),
    ],
    now: '2026-09-15',
  });
  assert.equal(over.fundRemaining, -140);
  assert.equal(over.unfunded, 140);
  assert.equal(over.tone, 'over');
  assert.equal(over.statusLabel, '$140.00 past the fund');
});

test('targetRemaining floors at zero and a met target reads as funded', () => {
  const s = summarizeEvent({
    event: anEvent({ targetAmount: 500 }),
    expenses: [anExpense({ eventKind: 'contribution', amount: 800 })],
    now: '2026-09-15',
  });
  assert.equal(s.targetRemaining, 0);
  assert.equal(s.tone, 'good');
  assert.equal(s.statusLabel, 'Fully funded');
});

test('a saving event whose start date has passed reports the shortfall', () => {
  const s = summarizeEvent({
    event: anEvent({ targetAmount: 1000, startDate: '2026-08-01' }),
    expenses: [anExpense({ eventKind: 'contribution', amount: 760 })],
    now: '2026-09-15',
  });
  assert.equal(s.tone, 'over');
  assert.equal(s.statusLabel, '$240.00 short');
});

test('a saving event still ahead of its date states what is left', () => {
  const s = summarizeEvent({
    event: anEvent({ targetAmount: 3000, startDate: '2027-03-01' }),
    expenses: [anExpense({ eventKind: 'contribution', amount: 600 })],
    now: '2026-09-15',
  });
  assert.equal(s.tone, 'info');
  assert.equal(s.statusLabel, '$2,400.00 to go');
  assert.equal(s.monthsToStart, 6);
  assert.equal(s.perMonthNeeded, 400);
});

test('with no start date there is no pace to state', () => {
  const s = summarizeEvent({
    event: anEvent({ targetAmount: 1000 }),
    expenses: [],
    now: '2026-09-15',
  });
  assert.equal(s.monthsToStart, undefined);
  assert.equal(s.perMonthNeeded, undefined);
});

test('fractionSpent falls back to the target when nothing is saved yet', () => {
  const s = summarizeEvent({
    event: anEvent({ targetAmount: 400, phase: 'spending' }),
    expenses: [anExpense({ eventKind: 'spend', amount: 100 })],
    now: '2026-09-15',
  });
  assert.equal(s.fractionSpent, 0.25);
});

test('contributedThisMonth only counts the month being asked about', () => {
  const s = summarizeEvent({
    event: anEvent(),
    expenses: [
      anExpense({ eventKind: 'contribution', amount: 400, monthId: '2026-08', date: '2026-08-03' }),
      anExpense({ eventKind: 'contribution', amount: 250, monthId: '2026-09', date: '2026-09-03' }),
    ],
    now: '2026-09-15',
  });
  assert.equal(s.contributedThisMonth, 250);
});

test('a closed event describes the result rather than a plan', () => {
  const s = summarizeEvent({
    event: anEvent({ phase: 'closed', targetAmount: 1000 }),
    expenses: [
      anExpense({ eventKind: 'contribution', amount: 1000 }),
      anExpense({ eventKind: 'spend', amount: 900 }),
    ],
    now: '2026-09-15',
  });
  assert.equal(s.tone, 'good');
  assert.equal(s.statusLabel, '$100.00 under the fund');
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test`
Expected: FAIL — `summarizeEvent is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/event.ts` (and add the imports at the top of the file):

```ts
import { monthIdOf, monthLabel, monthsBetween, today } from './dates.ts';
import { sumNet } from './expense.ts';
import { formatMoney, round2 } from './money.ts';
import type { PaceTone } from './projection.ts';
import type { BudgetEvent, Expense } from '../types/models';
```

```ts
export interface EventSummary {
  eventId: string;
  target: number;
  /** Net of everything put into the fund. */
  saved: number;
  /** Net of everything spent on the event. */
  spent: number;
  /** saved − spent. Negative means the fund is overdrawn. */
  fundRemaining: number;
  /** max(0, spent − saved) — what the fund did not cover. */
  unfunded: number;
  /** max(0, target − saved) — what is left to set aside. */
  targetRemaining: number;
  /** 0–1, uncapped so "over the target" stays visible. */
  fractionSaved: number;
  /** spent ÷ (saved, or the target when nothing is saved). 0–1, uncapped. */
  fractionSpent: number;
  contributionCount: number;
  spendCount: number;
  /** Whole months from the current month to the start month. */
  monthsToStart?: number;
  /** What each remaining month has to carry to reach the target in time. */
  perMonthNeeded?: number;
  /** Net contributed in the month `now` falls in. */
  contributedThisMonth: number;
  tone: PaceTone;
  statusLabel: string;
  statusDetail: string;
}

export interface EventSummaryInput {
  event: BudgetEvent;
  /** The event's own expenses — everything tagged with its id. */
  expenses: Expense[];
  /** Injectable for tests. */
  now?: string;
}

export function summarizeEvent({
  event,
  expenses,
  now = today(),
}: EventSummaryInput): EventSummary {
  const contributions = expenses.filter(isContribution);
  const spends = expenses.filter(isEventSpend);

  // Net, like every other figure in this app: a split trip dinner cost what
  // was left after the money came back, not what passed through the account.
  const saved = sumNet(contributions);
  const spent = sumNet(spends);
  const fundRemaining = round2(saved - spent);
  const unfunded = round2(Math.max(0, spent - saved));
  const targetRemaining = round2(Math.max(0, event.targetAmount - saved));

  const nowMonth = monthIdOf(now);
  const contributedThisMonth = sumNet(contributions.filter((e) => e.monthId === nowMonth));

  // The denominator for "how far through the fund am I" is what's actually in
  // the fund. Before anything is saved there is no fund, so the target is the
  // only honest yardstick left.
  const spendBase = saved > 0 ? saved : event.targetAmount;

  let monthsToStart: number | undefined;
  let perMonthNeeded: number | undefined;
  if (event.startDate) {
    monthsToStart = monthsBetween(nowMonth, monthIdOf(event.startDate));
    if (monthsToStart > 0) perMonthNeeded = round2(targetRemaining / monthsToStart);
  }

  const { tone, statusLabel, statusDetail } = describeEvent({
    event,
    saved,
    spent,
    fundRemaining,
    targetRemaining,
    monthsToStart,
    perMonthNeeded,
    now,
  });

  return {
    eventId: event.id,
    target: event.targetAmount,
    saved,
    spent,
    fundRemaining,
    unfunded,
    targetRemaining,
    fractionSaved: event.targetAmount > 0 ? saved / event.targetAmount : 0,
    fractionSpent: spendBase > 0 ? spent / spendBase : 0,
    contributionCount: contributions.length,
    spendCount: spends.length,
    monthsToStart,
    perMonthNeeded,
    contributedThisMonth,
    tone,
    statusLabel,
    statusDetail,
  };
}

interface DescribeInput {
  event: BudgetEvent;
  saved: number;
  spent: number;
  fundRemaining: number;
  targetRemaining: number;
  monthsToStart?: number;
  perMonthNeeded?: number;
  now: string;
}

/**
 * Copy rules, same as the month's: state the fact, never the judgement. An
 * event that isn't funded yet is information, not a failing — it only turns
 * red once the date it was being saved for has arrived without the money.
 */
function describeEvent(input: DescribeInput): {
  tone: PaceTone;
  statusLabel: string;
  statusDetail: string;
} {
  const { event, saved, spent, fundRemaining, targetRemaining } = input;
  const money = (n: number) => formatMoney(Math.abs(n));

  if (event.phase === 'closed') {
    return fundRemaining < 0
      ? {
          tone: 'over',
          statusLabel: `${money(fundRemaining)} over the fund`,
          statusDetail: `Closed. ${money(saved)} set aside, ${money(spent)} spent.`,
        }
      : {
          tone: 'good',
          statusLabel: `${money(fundRemaining)} under the fund`,
          statusDetail: `Closed. ${money(saved)} set aside, ${money(spent)} spent.`,
        };
  }

  if (event.phase === 'spending') {
    return fundRemaining < 0
      ? {
          tone: 'over',
          statusLabel: `${money(fundRemaining)} past the fund`,
          statusDetail: `${money(saved)} was set aside and ${money(
            spent,
          )} has been spent. Cover the difference from a month, or add to the fund.`,
        }
      : {
          tone: 'good',
          statusLabel: `${money(fundRemaining)} left in the fund`,
          statusDetail: `${money(spent)} of ${money(
            saved,
          )} spent. Spending here doesn't count against your monthly budget.`,
        };
  }

  // Saving.
  if (event.targetAmount <= 0) {
    return {
      tone: 'info',
      statusLabel: 'No target set',
      statusDetail: 'Give this a target to see how the fund is tracking.',
    };
  }

  if (targetRemaining === 0) {
    return {
      tone: 'good',
      statusLabel: 'Fully funded',
      statusDetail: `${money(saved)} set aside against a ${money(
        event.targetAmount,
      )} target. Switch to spending when it starts.`,
    };
  }

  const started = Boolean(event.startDate && event.startDate <= input.now);
  if (started) {
    return {
      tone: 'over',
      statusLabel: `${money(targetRemaining)} short`,
      statusDetail: `The date has arrived with ${money(saved)} of ${money(
        event.targetAmount,
      )} set aside.`,
    };
  }

  const pace =
    input.perMonthNeeded !== undefined && event.startDate
      ? ` ${money(input.perMonthNeeded)} a month to be ready by ${monthLabel(
          monthIdOf(event.startDate),
        )}.`
      : '';
  return {
    tone: 'info',
    statusLabel: `${money(targetRemaining)} to go`,
    statusDetail: `${money(saved)} of ${money(event.targetAmount)} set aside.${pace}`,
  };
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Verify the typecheck**

Run: `npm run build`
Expected: clean.

---

### Task 4: The monthly seam — `summarizeMonth` excludes event spending and counts planned contributions

**Files:**
- Modify: `src/lib/projection.ts`
- Modify: `test/logic.test.ts`

**Interfaces:**
- Consumes: `countsAgainstMonth`, `isContribution` from `src/lib/event.ts` (Task 1); `BudgetEvent` from models.
- Produces:
  - `interface UpcomingEventContribution { event: BudgetEvent; amount: number }`
  - `MonthSummary.upcomingEvents: UpcomingEventContribution[]`
  - `SummaryInput.events?: BudgetEvent[]`
  - `plannedEventContributions(monthId, events, expenses): UpcomingEventContribution[]`

Circular-import note: `src/lib/event.ts` imports `PaceTone` from `./projection.ts` as a **type only**, and `projection.ts` imports values from `./event.ts`. TypeScript erases the type-only side, so there is no runtime cycle. Keep the `import type` keyword on that line in `event.ts`.

- [ ] **Step 1: Write the failing tests**

Append to `test/logic.test.ts` in the projection section. Reuse the file's existing expense/month factory helpers if it has them; otherwise add these local ones just above the new tests:

```ts
function monthFixture(patch: Partial<Month> = {}): Month {
  return {
    id: '2026-09',
    year: 2026,
    month: 9,
    budgetTotal: 2000,
    status: 'open',
    budgetHistory: [],
    recurringExpenseConfirmations: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    ...patch,
  };
}

let evSeq = 0;
function expenseFixture(patch: Partial<Expense> = {}): Expense {
  evSeq += 1;
  return {
    id: `e_${evSeq}`,
    monthId: '2026-09',
    date: '2026-09-05',
    amount: 100,
    category: 'cat_other',
    description: 'Thing',
    source: 'manual',
    reconciliationStatus: 'unreconciled',
    createdAt: '2026-09-05T00:00:00.000Z',
    updatedAt: '2026-09-05T00:00:00.000Z',
    ...patch,
  };
}

function eventFixture(patch: Partial<BudgetEvent> = {}): BudgetEvent {
  return {
    id: 'evt_1',
    name: 'Japan trip',
    targetAmount: 3000,
    phase: 'saving',
    monthlyContribution: 400,
    category: 'cat_other',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  };
}
```

Add `BudgetEvent` to the `import type { ... } from '../src/types/models'` line at the top of `test/logic.test.ts`.

```ts
test('event spending is not part of the month it happened in', () => {
  const s = summarizeMonth({
    month: monthFixture(),
    expenses: [
      expenseFixture({ amount: 300 }),
      expenseFixture({ amount: 400, eventId: 'evt_1', eventKind: 'contribution' }),
      expenseFixture({ amount: 900, eventId: 'evt_1', eventKind: 'spend' }),
    ],
    recurring: [],
    now: '2026-09-15',
  });
  // 300 ordinary + 400 set aside. The 900 spent on the trip was budgeted when
  // it was saved, so counting it here would count it twice.
  assert.equal(s.spent, 700);
  assert.equal(s.expenseCount, 2);
  assert.equal(s.remaining, 1300);
});

test('a reimbursed event spend is excluded gross and net alike', () => {
  const s = summarizeMonth({
    month: monthFixture(),
    expenses: [
      expenseFixture({ amount: 200, reimbursement: 50 }),
      expenseFixture({ amount: 175, reimbursement: 150, eventId: 'evt_1', eventKind: 'spend' }),
    ],
    recurring: [],
    now: '2026-09-15',
  });
  assert.equal(s.spent, 150);
  assert.equal(s.reimbursed, 50);
});

test('a planned monthly set-aside shows as still expected until it is logged', () => {
  const pending = summarizeMonth({
    month: monthFixture(),
    expenses: [],
    recurring: [],
    events: [eventFixture()],
    now: '2026-09-15',
  });
  assert.equal(pending.upcomingEvents.length, 1);
  assert.equal(pending.upcomingEvents[0].amount, 400);
  assert.equal(pending.upcomingTotal, 400);

  const done = summarizeMonth({
    month: monthFixture(),
    expenses: [
      expenseFixture({ amount: 400, eventId: 'evt_1', eventKind: 'contribution' }),
    ],
    recurring: [],
    events: [eventFixture()],
    now: '2026-09-15',
  });
  assert.equal(done.upcomingEvents.length, 0);
  assert.equal(done.upcomingTotal, 0);
});

test('a partly-funded month expects only the rest of the set-aside', () => {
  const s = summarizeMonth({
    month: monthFixture(),
    expenses: [
      expenseFixture({ amount: 150, eventId: 'evt_1', eventKind: 'contribution' }),
    ],
    recurring: [],
    events: [eventFixture()],
    now: '2026-09-15',
  });
  assert.equal(s.upcomingEvents[0].amount, 250);
});

test('only saving events with a plan are expected', () => {
  const s = summarizeMonth({
    month: monthFixture(),
    expenses: [],
    recurring: [],
    events: [
      eventFixture({ id: 'a', phase: 'spending' }),
      eventFixture({ id: 'b', phase: 'closed' }),
      eventFixture({ id: 'c', monthlyContribution: 0 }),
    ],
    now: '2026-09-15',
  });
  assert.equal(s.upcomingEvents.length, 0);
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test`
Expected: FAIL — `s.spent` is 1600 not 700, and `upcomingEvents` is undefined.

- [ ] **Step 3: Write the implementation**

In `src/lib/projection.ts`:

Add to the imports at the top:

```ts
import { countsAgainstMonth, isContribution } from './event.ts';
import type { BudgetEvent } from '../types/models';
```

(add `BudgetEvent` to the existing `import type { ... } from '../types/models'` line instead of a second line, to match the file's style.)

Add the new type just below `UpcomingRecurring`:

```ts
/** A monthly set-aside the user has planned but not yet logged (§4.3). */
export interface UpcomingEventContribution {
  event: BudgetEvent;
  /** What's left of this month's planned set-aside. */
  amount: number;
}
```

Add to `MonthSummary`, right after `upcoming`:

```ts
  upcomingEvents: UpcomingEventContribution[];
```

Add to `SummaryInput`, after `recurring`:

```ts
  /** Optional: lets the projection see set-asides that are planned but unlogged. */
  events?: BudgetEvent[];
```

Add the new exported helper, just below `dueRecurringNudges`:

```ts
/**
 * What each saving event still expects this month. A planned set-aside is
 * known future cost in exactly the way an unposted rent payment is, so it
 * belongs in the projection rather than appearing out of nowhere on the day
 * it's logged. Partial contributions count — only the remainder is expected.
 */
export function plannedEventContributions(
  monthId: MonthId,
  events: BudgetEvent[],
  expenses: Expense[],
): UpcomingEventContribution[] {
  return events
    .filter((e) => e.phase === 'saving' && e.monthlyContribution > 0)
    .map((event) => {
      const already = sumNet(
        expenses.filter(
          (e) => e.monthId === monthId && e.eventId === event.id && isContribution(e),
        ),
      );
      return { event, amount: round2(Math.max(0, event.monthlyContribution - already)) };
    })
    .filter((u) => u.amount > 0);
}
```

In `summarizeMonth`, immediately after the `const { year, month: m } = splitMonthId(month.id);` line, add:

```ts
  // The month's budget is made of everything except event spending — that was
  // already budgeted in the month it was set aside. `expenses` still carries
  // it, because the ledger and reconciliation need the whole picture; only the
  // arithmetic below narrows.
  const counted = expenses.filter(countsAgainstMonth);
```

Then replace every later use of `expenses` inside `summarizeMonth` with `counted`:
- `const spent = sumNet(expenses);` → `sumNet(counted)`
- `const reimbursed = round2(sumGross(expenses) - spent);` → `sumGross(counted)`
- `const recurringLogged = sumNet(expenses.filter((e) => e.source === 'recurring'));` → `counted.filter(...)`
- `expenseCount: expenses.length,` → `counted.length`

Then, after the `upcoming` / `upcomingTotal` lines, replace them with:

```ts
  const upcoming = upcomingRecurring(month, recurring, now);
  const upcomingEvents = plannedEventContributions(month.id, events, expenses);
  const upcomingTotal = sumAmounts([
    ...upcoming.map((u) => u.recurring.amount),
    ...upcomingEvents.map((u) => u.amount),
  ]);
```

Add `events = []` to the destructured parameter list of `summarizeMonth`:

```ts
export function summarizeMonth({
  month,
  expenses,
  recurring,
  events = [],
  now = today(),
}: SummaryInput): MonthSummary {
```

And add `upcomingEvents,` to the returned object, next to `upcoming,`.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test`
Expected: PASS, including every pre-existing projection test (none of them tag an expense with an event, so `counted === expenses` for all of them).

- [ ] **Step 5: Verify the typecheck**

Run: `npm run build`
Expected: one error in `src/screens/Dashboard.tsx` if `upcomingEvents` is rendered nowhere yet — it isn't referenced, so expect clean. If `tsc` flags an unused import, remove it.

---

### Task 5: Repository support for events

**Files:**
- Modify: `src/data/repository.ts`
- Modify: `src/data/idb.ts`
- Modify: `src/data/indexedDbRepository.ts`
- Modify: `src/data/memoryRepository.ts`
- Modify: `src/data/apiRepository.ts`
- Modify: `src/types/models.ts` (the `BackupFile` shape)
- Modify: `budget-server/server.mjs`

**Interfaces:**
- Consumes: `BudgetEvent` (Task 1).
- Produces, on `BudgetRepository`:
  - `listEvents(): Promise<BudgetEvent[]>`
  - `saveEvent(event: BudgetEvent): Promise<void>`
  - `deleteEvent(id: string): Promise<void>`
- `BackupFile.events: BudgetEvent[]` and `BackupFile.version: 1 | 2`.

There is no unit test for this task: these are thin storage adapters with no logic, and `npm run build` plus the browser check in Task 11 is what covers them. The interface change is what makes a missing implementation a compile error.

- [ ] **Step 1: Extend the interface**

In `src/data/repository.ts`, add `BudgetEvent` to the type imports and add to the `BudgetRepository` interface, after the recurring block:

```ts
  listEvents(): Promise<BudgetEvent[]>;
  saveEvent(event: BudgetEvent): Promise<void>;
  deleteEvent(id: string): Promise<void>;
```

- [ ] **Step 2: Verify it now fails to compile**

Run: `npm run build`
Expected: FAIL — three errors, one per repository class, each saying the class incorrectly implements `BudgetRepository`.

- [ ] **Step 3: Widen the backup shape**

In `src/types/models.ts`, change `BackupFile`:

```ts
export interface BackupFile {
  format: 'budget-tracker-backup';
  /** 1 predates event budgets; 2 carries `events`. Both restore. */
  version: 1 | 2;
  exportedAt: Timestamp;
  months: Month[];
  expenses: Expense[];
  categories: Category[];
  recurring: RecurringExpense[];
  events: BudgetEvent[];
  sessions: ReconciliationSession[];
  settings: AppSettings | null;
}
```

- [ ] **Step 4: IndexedDB**

In `src/data/idb.ts`:
- Add `'events'` to the `StoreName` union.
- Change `const DB_VERSION = 1;` to `const DB_VERSION = 2;`
- Inside `onupgradeneeded`, alongside the other guarded creations, add:

```ts
      if (!db.objectStoreNames.contains('events')) {
        db.createObjectStore('events', { keyPath: 'id' });
      }
```

In `src/data/indexedDbRepository.ts`, add `BudgetEvent` to the type imports and, after the recurring methods:

```ts
  async listEvents(): Promise<BudgetEvent[]> {
    const events = await idb.getAll<BudgetEvent>('events');
    // Newest first — an event you just made is the one you're about to use.
    return events.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async saveEvent(event: BudgetEvent): Promise<void> {
    await idb.put('events', event);
  }

  async deleteEvent(id: string): Promise<void> {
    await idb.remove('events', id);
  }
```

In the same file, add `idb.getAll<BudgetEvent>('events')` to the `Promise.all` in `exportAll`, include `events` in the returned object, set `version: 2`, add `'events'` to the `clearStores([...])` list in `importAll`, and add `idb.putMany('events', backup.events ?? [])` to that method's `Promise.all`.

- [ ] **Step 5: MemoryRepository**

In `src/data/memoryRepository.ts`, add `private events = new Map<string, BudgetEvent>();` next to the other maps, add `BudgetEvent` to the type imports, and:

```ts
  async listEvents(): Promise<BudgetEvent[]> {
    return [...this.events.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async saveEvent(event: BudgetEvent): Promise<void> {
    this.events.set(event.id, { ...event });
  }

  async deleteEvent(id: string): Promise<void> {
    this.events.delete(id);
  }
```

Then mirror the `exportAll` / `importAll` changes this file already makes for `recurring`: export `events`, write `version: 2`, and on import clear the map and refill it from `backup.events ?? []`.

- [ ] **Step 6: ApiRepository**

In `src/data/apiRepository.ts`:
- Add `events: BudgetEvent[];` to the `RepoData` interface and `events: []` to `emptyData()`.
- Add `BudgetEvent` to the type imports.
- Add the three methods, following the exact shape of the recurring ones:

```ts
  async listEvents(): Promise<BudgetEvent[]> {
    return [...(this.data.events ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async saveEvent(event: BudgetEvent): Promise<void> {
    await this.commit((d) => ({ ...d, events: upsertBy(d.events ?? [], event, (e) => e.id) }));
  }

  async deleteEvent(id: string): Promise<void> {
    await this.commit((d) => ({ ...d, events: (d.events ?? []).filter((e) => e.id !== id) }));
  }
```

The `?? []` matters: a document written by a build that predates this feature has no `events` key, and the first read of it must not throw.

- In `exportAll`, add `events: d.events ?? []` and change `version: 1` to `version: 2`.
- In `importAll`, add `events: backup.events ?? []` to the `next` object.

- [ ] **Step 7: Server**

In `budget-server/server.mjs`, add `events: []` to `emptyData()`.

Do **not** add `'events'` to `DATA_KEYS`. That constant is the PUT validator, and requiring a seventh key would reject a write from any client built before this change. The server stores `data` verbatim, so the new key round-trips without being validated. Add a comment saying exactly that:

```js
function emptyData() {
  return {
    months: [],
    expenses: [],
    categories: [],
    recurring: [],
    // Not in DATA_KEYS on purpose: requiring it would 400 a PUT from a client
    // built before event budgets. The document is stored verbatim either way.
    events: [],
    sessions: [],
    settings: null,
  };
}
```

- [ ] **Step 8: Verify**

Run: `npm run build`
Expected: clean.

Run: `npm test`
Expected: PASS (this includes `budget-server`'s own suite via `scripts/test/*.test.mjs` — if `budget-server/test/server.test.mjs` asserts the exact shape of `emptyData()`, update that assertion to include `events`).

---

### Task 6: Store — event state and actions

**Files:**
- Modify: `src/state/store.tsx`

**Interfaces:**
- Consumes: repository methods (Task 5), `summarizeEvent` (Task 3), `isContribution`/`isEventSpend` (Task 1).
- Produces, on `AppStore`:
  - `events: BudgetEvent[]`
  - `createEvent(input: EventInput): Promise<BudgetEvent>`
  - `updateEvent(id: string, patch: Partial<EventInput>): Promise<void>`
  - `setEventPhase(id: string, phase: EventPhase): Promise<void>`
  - `deleteEvent(id: string): Promise<void>` — refuses when the event has entries
  - `coverFromMonth(eventId: string, monthId: MonthId, amount: number): Promise<void>`
  - `eventExpenses(eventId: string): Expense[]`
- And the selectors `useEvent(id)`, `useEventExpenses(eventId)`, `useEventSummary(id)`.
- `ExpenseInput` gains `eventId?: string` and `eventKind?: EventKind`.

- [ ] **Step 1: Carry the new fields through `ExpenseInput` and `buildExpense`**

In `src/state/store.tsx`, add to `ExpenseInput`:

```ts
  /** Tags this expense into an event's ledger. */
  eventId?: string;
  eventKind?: EventKind;
```

and in `buildExpense`, add to the returned object (after `matchedTransactionId`):

```ts
    eventId: input.eventId,
    eventKind: input.eventId ? input.eventKind ?? 'spend' : undefined,
```

The `input.eventId ?` guard is what stops a stray `eventKind` with no event from turning an ordinary expense invisible to its month.

In `updateExpense`, the existing `{ ...existing, ...patch }` spread already carries a patched `eventId`/`eventKind` through, but it can also set `eventKind` without `eventId`. Add this line to the `next` object, after `monthId`:

```ts
        eventKind: next_eventId(existing, patch),
```

and define the helper just above `buildExpense`:

```ts
/** An eventKind with no event is meaningless — and would silently take the
 *  expense out of its month's budget. Normalise the pair, never one alone. */
function next_eventId(
  existing: Expense,
  patch: Partial<ExpenseInput>,
): Expense['eventKind'] {
  const eventId = patch.eventId !== undefined ? patch.eventId : existing.eventId;
  if (!eventId) return undefined;
  return patch.eventKind ?? existing.eventKind ?? 'spend';
}
```

(Yes, the name reads oddly for something returning a kind — rename it `normalizedEventKind` and use that name in both places.)

- [ ] **Step 2: Add events to `AppData` and the load path**

- Add `events: BudgetEvent[];` to the `AppData` interface and `events: []` to `EMPTY`.
- In `reload`, add `repo.listEvents()` to the `Promise.all` destructure and to the `setData({...})` call.
- Add `BudgetEvent`, `EventKind`, `EventPhase` to the type imports from `../types/models`.

- [ ] **Step 3: Add the actions**

Add this block to `AppStore`, after the recurring actions:

```ts
  createEvent: (input: EventInput) => Promise<BudgetEvent>;
  updateEvent: (id: string, patch: Partial<EventInput>) => Promise<void>;
  setEventPhase: (id: string, phase: EventPhase) => Promise<void>;
  /**
   * Only when the event has no entries. With entries, untagging them would
   * silently change the totals of months that may already be closed, and
   * deleting them would destroy reconciled history — so the answer is Close.
   */
  deleteEvent: (id: string) => Promise<void>;
  /** Logs a contribution covering what the fund didn't, into `monthId`. */
  coverFromMonth: (eventId: string, monthId: MonthId, amount: number) => Promise<void>;
```

and above it, next to `ExpenseInput`:

```ts
export interface EventInput {
  name: string;
  targetAmount: number;
  category: string;
  phase?: EventPhase;
  startDate?: ISODate;
  endDate?: ISODate;
  monthlyContribution?: number;
  note?: string;
}
```

Implement inside `AppProvider`, in a `/* ------------------------------ events ------------------------------- */` section placed after the recurring section:

```ts
  const createEvent = useCallback<AppStore['createEvent']>(
    async (input) => {
      const now = new Date().toISOString();
      const event: BudgetEvent = {
        id: newId('evt'),
        name: input.name.trim(),
        targetAmount: round2(input.targetAmount),
        phase: input.phase ?? 'saving',
        startDate: input.startDate || undefined,
        endDate: input.endDate || undefined,
        monthlyContribution: round2(input.monthlyContribution ?? 0),
        category: input.category || FALLBACK_CATEGORY_ID,
        note: input.note?.trim() || undefined,
        createdAt: now,
        updatedAt: now,
      };
      await repo().saveEvent(event);
      await reload();
      return event;
    },
    [reload],
  );

  const updateEvent = useCallback<AppStore['updateEvent']>(
    async (id, patch) => {
      const existing = data.events.find((e) => e.id === id);
      if (!existing) return;
      const next: BudgetEvent = {
        ...existing,
        ...patch,
        name: patch.name?.trim() ?? existing.name,
        targetAmount:
          patch.targetAmount !== undefined ? round2(patch.targetAmount) : existing.targetAmount,
        monthlyContribution:
          patch.monthlyContribution !== undefined
            ? round2(patch.monthlyContribution)
            : existing.monthlyContribution,
        startDate: patch.startDate !== undefined ? patch.startDate || undefined : existing.startDate,
        note: patch.note !== undefined ? patch.note.trim() || undefined : existing.note,
        updatedAt: new Date().toISOString(),
      };
      await repo().saveEvent(next);
      await reload();
    },
    [data.events, reload],
  );

  const setEventPhase = useCallback<AppStore['setEventPhase']>(
    async (id, phase) => {
      const existing = data.events.find((e) => e.id === id);
      if (!existing) return;
      await repo().saveEvent({
        ...existing,
        phase,
        closedAt: phase === 'closed' ? new Date().toISOString() : undefined,
        updatedAt: new Date().toISOString(),
      });
      await reload();
    },
    [data.events, reload],
  );

  const deleteEvent = useCallback<AppStore['deleteEvent']>(
    async (id) => {
      const tagged = data.expenses.filter((e) => e.eventId === id);
      if (tagged.length > 0) {
        notify("This event has entries", {
          detail: `${tagged.length} ${
            tagged.length === 1 ? 'entry is' : 'entries are'
          } logged against it. Close it instead.`,
        });
        return;
      }
      await repo().deleteEvent(id);
      await reload();
    },
    [data.expenses, notify, reload],
  );

  const coverFromMonth = useCallback<AppStore['coverFromMonth']>(
    async (eventId, monthId, amount) => {
      const event = data.events.find((e) => e.id === eventId);
      if (!event || amount <= 0) return;
      if (isLocked(monthId)) {
        notify('That month is closed', { detail: 'Nothing new can be logged to it.' });
        return;
      }
      await addExpense(monthId, {
        date: monthId === currentMonthId() ? today() : expectedDateFor(monthId, 31),
        amount: round2(amount),
        category: event.category,
        description: `${event.name} fund`,
        eventId: event.id,
        eventKind: 'contribution',
      });
      notify(`${event.name} fund topped up`, {
        detail: `Counted against ${monthLabel(monthId, { year: false })}.`,
      });
    },
    [addExpense, data.events, isLocked, notify],
  );

  const eventExpenses = useCallback<AppStore['eventExpenses']>(
    (eventId) => data.expenses.filter((e) => e.eventId === eventId),
    [data.expenses],
  );
```

Add `monthLabel` to the import from `../lib/dates`.

Wire all six into the `useMemo` value object and its dependency array, alongside the existing actions.

- [ ] **Step 4: Add the selectors**

At the bottom of `src/state/store.tsx`, next to `useMonth` / `useMonthExpenses`:

```ts
export function useEvent(eventId: string): BudgetEvent | null {
  const { events } = useApp();
  return useMemo(() => events.find((e) => e.id === eventId) ?? null, [events, eventId]);
}

export function useEventExpenses(eventId: string): Expense[] {
  const { expenses } = useApp();
  return useMemo(
    () =>
      expenses
        .filter((e) => e.eventId === eventId)
        .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
    [expenses, eventId],
  );
}

export function useEventSummary(eventId: string): EventSummary | null {
  const event = useEvent(eventId);
  const expenses = useEventExpenses(eventId);
  return useMemo(
    () => (event ? summarizeEvent({ event, expenses }) : null),
    [event, expenses],
  );
}
```

Import `summarizeEvent` and `type EventSummary` from `../lib/event`, and add `eventExpenses: (eventId: string) => Expense[];` to `AppStore`.

- [ ] **Step 5: Verify**

Run: `npm run build`
Expected: clean.

Run: `npm test`
Expected: PASS.

---

### Task 7: `IconFlag` and the sixth tab

**Files:**
- Modify: `src/components/Icons.tsx`
- Modify: `src/styles/app.css:146-152`
- Modify: `src/App.tsx`
- Modify: `CLAUDE.md`
- Modify: `docs/design-guidelines.md`

**Interfaces:**
- Produces: `IconFlag` from `src/components/Icons.tsx`; `Screen` gains `'events'`.

- [ ] **Step 1: Add the icon**

In `src/components/Icons.tsx`, following the file's exact style (24-grid, `fill="none"`, `currentColor`, default 1.6 stroke, round caps via the shared `Svg`):

```tsx
export const IconFlag = (p: Props) => (
  <Svg {...p}>
    <path d="M6 21V4" />
    <path d="M6 4.5h11l-2 3.5 2 3.5H6" />
  </Svg>
);
```

- [ ] **Step 2: Widen the tabbar**

In `src/styles/app.css`, in `.tabbar__inner`:

```css
  grid-template-columns: repeat(6, 1fr);
```

- [ ] **Step 3: Add the tab**

In `src/App.tsx`:

```ts
export type Screen = 'dashboard' | 'expenses' | 'events' | 'reconcile' | 'history' | 'settings';

const TABS: { id: Screen; label: string; Icon: typeof IconHome }[] = [
  { id: 'dashboard', label: 'Month', Icon: IconHome },
  { id: 'expenses', label: 'Expenses', Icon: IconList },
  { id: 'events', label: 'Events', Icon: IconFlag },
  { id: 'reconcile', label: 'Reconcile', Icon: IconReconcile },
  { id: 'history', label: 'History', Icon: IconHistory },
  { id: 'settings', label: 'Settings', Icon: IconSettings },
];
```

Render it in `<main>`:

```tsx
        {screen === 'events' && <EventsScreen />}
```

and import `EventsScreen` from `./screens/EventsScreen` and `IconFlag` from `./components/Icons`.

Hide the FAB on the Events tab — it logs into the active month, which is not the context there, and the Events screens carry their own primary buttons:

```tsx
      {canAdd && screen !== 'reconcile' && screen !== 'events' && (
```

- [ ] **Step 4: Update the two design documents**

In `CLAUDE.md`, under "Layout / shell", change:

- `grid repeat(5,1fr)` → `grid repeat(6,1fr)`
- `Tabs: Month, Expenses, Reconcile, History, Settings.` → `Tabs: Month, Expenses, Events, Reconcile, History, Settings.`
- The FAB line: `**Shown only when the month is open AND the screen isn't Reconcile.**` → `**Shown only when the month is open AND the screen is neither Reconcile nor Events.**`

Make the same three edits wherever `docs/design-guidelines.md` states them (grep it for `repeat(5` and `Reconcile, History, Settings`).

- [ ] **Step 5: Verify**

Run: `npm run build`
Expected: FAIL until Task 8 creates `EventsScreen`. Do Task 8 before re-running, or stub the import with a one-line placeholder component and replace it in Task 8. Prefer doing Task 8 immediately.

---

### Task 8: Events list screen

**Files:**
- Create: `src/screens/EventsScreen.tsx`
- Modify: `src/styles/app.css` (append one small rule)

**Interfaces:**
- Consumes: `useApp`, `useCategoryMap` (store), `summarizeEvent` (Task 3), `IconFlag` (Task 7), `EventSheet` (Task 9 — write Task 9 first if executing strictly in order, or accept one compile error until then).
- Produces: `EventsScreen` (default-free named export), and `EventDetail` is opened from it via local state, mirroring how `HistoryScreen` drills into a month.

- [ ] **Step 1: Write the screen**

Create `src/screens/EventsScreen.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { EventDetail } from './EventDetail';
import { EventSheet } from '../components/EventSheet';
import { IconFlag } from '../components/Icons';
import { EmptyState, Money, SectionHeading, useMoneyFormatter } from '../components/ui';
import { summarizeEvent } from '../lib/event';
import type { BudgetEvent } from '../types/models';
import { useApp, useCategoryMap } from '../state/store';

const PHASE_LABEL: Record<BudgetEvent['phase'], string> = {
  saving: 'Saving',
  spending: 'Spending',
  closed: 'Closed',
};

/**
 * Budgets that aren't months (§4.8): a trip, a wedding, a laptop. Same
 * drill-in shape as History — a list here, one thing at a time in the detail.
 */
export function EventsScreen() {
  const { events, expenses } = useApp();
  const categories = useCategoryMap();
  const money = useMoneyFormatter();
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const rows = useMemo(
    () =>
      events.map((event) => ({
        event,
        summary: summarizeEvent({
          event,
          expenses: expenses.filter((e) => e.eventId === event.id),
        }),
      })),
    [events, expenses],
  );

  const active = rows.filter((r) => r.event.phase !== 'closed');
  const closed = rows.filter((r) => r.event.phase === 'closed');

  if (open) {
    // A deleted or missing event falls back to the list rather than a blank.
    if (!rows.some((r) => r.event.id === open)) {
      setOpen(null);
      return null;
    }
    return <EventDetail eventId={open} onBack={() => setOpen(null)} />;
  }

  return (
    <div className="stack" style={{ ['--gap' as string]: 'var(--s-4)' }}>
      <div className="row row--between">
        <div>
          <div className="section-label">Events</div>
          <p className="muted" style={{ fontSize: 'var(--t-small)', marginTop: 4 }}>
            A budget that isn't a month. Save toward it, then spend from it.
          </p>
        </div>
        <button className="btn btn--primary btn--sm" onClick={() => setCreating(true)}>
          New event
        </button>
      </div>

      {rows.length === 0 ? (
        <section className="card">
          <EmptyState icon={<IconFlag />} title="No events yet">
            <span>
              A trip, a wedding, a new laptop — anything you save for over more than one
              month.
            </span>
          </EmptyState>
        </section>
      ) : (
        <section className="card card--flush">
          <div className="list">
            {active.map(({ event, summary }) => (
              <EventRow
                key={event.id}
                event={event}
                fraction={
                  event.phase === 'spending' ? summary.fractionSpent : summary.fractionSaved
                }
                color={categories.get(event.category)?.color ?? 'var(--text-tertiary)'}
                sub={
                  event.phase === 'spending'
                    ? `${PHASE_LABEL[event.phase]} · ${money(summary.spent)} of ${money(
                        summary.saved,
                        { compact: true },
                      )} in the fund`
                    : `${PHASE_LABEL[event.phase]} · ${money(summary.saved)} of ${money(
                        summary.target,
                        { compact: true },
                      )}`
                }
                amount={
                  event.phase === 'spending' ? summary.fundRemaining : summary.targetRemaining
                }
                onOpen={() => setOpen(event.id)}
              />
            ))}
          </div>
        </section>
      )}

      {closed.length > 0 && (
        <>
          <SectionHeading title="Closed" />
          <section className="card card--flush">
            <div className="list">
              {closed.map(({ event, summary }) => (
                <EventRow
                  key={event.id}
                  event={event}
                  fraction={summary.fractionSpent}
                  color={categories.get(event.category)?.color ?? 'var(--text-tertiary)'}
                  sub={`Closed · ${money(summary.spent)} spent of ${money(summary.saved, {
                    compact: true,
                  })} saved`}
                  amount={summary.fundRemaining}
                  onOpen={() => setOpen(event.id)}
                />
              ))}
            </div>
          </section>
        </>
      )}

      {creating && (
        <EventSheet
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setOpen(id);
          }}
        />
      )}
    </div>
  );
}

function EventRow({
  event,
  fraction,
  color,
  sub,
  amount,
  onOpen,
}: {
  event: BudgetEvent;
  fraction: number;
  color: string;
  sub: string;
  amount: number;
  onOpen: () => void;
}) {
  return (
    <button className="list__item eventrow" onClick={onOpen}>
      <span className="dot" style={{ background: color }} />
      <span className="list__main">
        <span className="list__title" style={{ opacity: event.phase === 'closed' ? 0.6 : 1 }}>
          {event.name}
        </span>
        <span className="list__sub">
          <span>{sub}</span>
        </span>
        <span className="catbar__track" style={{ marginTop: 6 }}>
          <span
            className="catbar__fill"
            style={{
              width: `${Math.min(100, Math.max(0, fraction * 100))}%`,
              background: color,
            }}
          />
        </span>
      </span>
      <span className="list__amount num">
        <Money amount={amount} compact />
      </span>
    </button>
  );
}
```

- [ ] **Step 2: Add the one CSS rule the row needs**

`.catbar__track` and `.catbar__fill` are `div`-shaped in the existing CSS; used as `<span>`s inside `.list__main` they need to be blocks. Append to `src/styles/app.css`, in the lists section:

```css
/* An event row carries a hairline-thin progress bar under its sub-line —
   the same 6px track the category breakdown uses, just nested in a list. */
.eventrow .catbar__track {
  display: block;
  width: 100%;
}

.eventrow .catbar__fill {
  display: block;
}
```

- [ ] **Step 3: Verify**

Run: `npm run build`
Expected: two errors — `./EventDetail` and `../components/EventSheet` do not exist yet. Tasks 9 and 10 resolve them.

---

### Task 9: Event sheet (create / edit) and contribution sheet

**Files:**
- Create: `src/components/EventSheet.tsx`
- Create: `src/components/ContributionSheet.tsx`

**Interfaces:**
- Consumes: `useApp`, `createEvent`/`updateEvent`/`deleteEvent`/`setEventPhase`/`addExpense` (Task 6), `Sheet`/`Field`/`useMoneyFormatter` from `../components/ui`, `parseAmount` from `../lib/money`.
- Produces:
  - `<EventSheet event?: BudgetEvent; onClose: () => void; onCreated?: (id: string) => void />`
  - `<ContributionSheet event: BudgetEvent; monthId: MonthId; onClose: () => void />`

- [ ] **Step 1: Write `EventSheet`**

Create `src/components/EventSheet.tsx`:

```tsx
import { useState, type FormEvent } from 'react';
import type { BudgetEvent } from '../types/models';
import { FALLBACK_CATEGORY_ID } from '../data/seed';
import { monthLabel } from '../lib/dates';
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
  const { categories, createEvent, updateEvent, deleteEvent, events, expenses, notify } =
    useApp();
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
              <div className="amount-input" style={{ padding: '8px 14px' }}>
                <span className="amount-input__symbol" style={{ fontSize: 17 }}>
                  $
                </span>
                <input
                  id="event-monthly"
                  value={monthlyText}
                  onChange={(e) => setMonthlyText(e.target.value)}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.00"
                  style={{ fontSize: 20 }}
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
```

Note: `events` and `monthLabel` are imported but only `expenses` and `categories` are used above — remove the unused `events` destructure and the `monthLabel` import before running the build.

- [ ] **Step 2: Write `ContributionSheet`**

Create `src/components/ContributionSheet.tsx`:

```tsx
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
          />
          <span className={`stat__note ${locked ? 'tone-over' : ''}`}>
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
```

- [ ] **Step 3: Verify**

Run: `npm run build`
Expected: one remaining error — `./EventDetail` does not exist. Task 10 resolves it.

---

### Task 10: Event detail screen, and `ExpenseSheet`'s event mode

**Files:**
- Create: `src/screens/EventDetail.tsx`
- Modify: `src/components/ExpenseSheet.tsx`

**Interfaces:**
- Consumes: everything from Tasks 3, 6, 9.
- Produces: `<EventDetail eventId: string; onBack: () => void />`; `ExpenseSheet` gains `event?: BudgetEvent`.

- [ ] **Step 1: Teach `ExpenseSheet` about events**

In `src/components/ExpenseSheet.tsx`:

Add `event` to the props type and destructure:

```tsx
  /** When set, the expense being logged is spending from this event's fund. */
  event?: BudgetEvent;
```

Import `type BudgetEvent` from `../types/models`.

Default the category to the event's when one is given — change the `useState` initialiser for `category` to:

```tsx
  const [category, setCategory] = useState(
    expense?.category ??
      prefill?.category ??
      event?.category ??
      settings.lastUsedCategory ??
      FALLBACK_CATEGORY_ID,
  );
```

Tag the created expense — in `submit`, in the `addExpense` call, add:

```tsx
          eventId: event?.id,
          eventKind: event ? ('spend' as const) : undefined,
```

Suppress the "make this recurring" offer for event spending (a trip dinner is not a monthly bill):

```tsx
  const canMakeRecurring = !expense && !onSave && !event && !isLocked(targetMonthId);
```

And state the consequence — add this just below the amount field's error line, inside the same `.field`:

```tsx
          {event && (
            <span className="stat__note">
              Spent from the {event.name} fund — this doesn't count against{' '}
              {monthLabel(targetMonthId, { year: false })}'s budget.
            </span>
          )}
```

Finally, when an event is given, make the default title say so:

```tsx
  const defaultTitle = expense
    ? locked
      ? 'View expense'
      : 'Edit expense'
    : event
      ? `Log to ${event.name}`
      : `Log to ${monthLabel(targetMonthId)}`;
```

- [ ] **Step 2: Write `EventDetail`**

Create `src/screens/EventDetail.tsx`:

```tsx
import { useState } from 'react';
import { ContributionSheet } from '../components/ContributionSheet';
import { EventSheet } from '../components/EventSheet';
import { ExpenseSheet } from '../components/ExpenseSheet';
import {
  IconArrowLeft,
  IconDownload,
  IconFlag,
  IconInfo,
  IconLock,
  IconWallet,
} from '../components/Icons';
import {
  EmptyState,
  ExpenseAmount,
  Meter,
  Money,
  Segmented,
  SectionHeading,
  Sheet,
  SplitNote,
  StatusPill,
  useMoneyFormatter,
} from '../components/ui';
import { currentMonthId, formatDayLabel, monthLabel } from '../lib/dates';
import { isContribution } from '../lib/event';
import type { Expense } from '../types/models';
import { useApp, useCategoryMap, useEvent, useEventExpenses, useEventSummary } from '../state/store';

/**
 * One event, in whichever phase it's in. Saving leads with what's in the
 * fund against the target; spending leads with what's left of the fund. The
 * flip between them is the point of the screen, so it sits directly under the
 * headline rather than behind a menu.
 */
export function EventDetail({ eventId, onBack }: { eventId: string; onBack: () => void }) {
  const { setEventPhase, coverFromMonth, isLocked, notify } = useApp();
  const event = useEvent(eventId);
  const entries = useEventExpenses(eventId);
  const summary = useEventSummary(eventId);
  const categories = useCategoryMap();
  const money = useMoneyFormatter();

  const [editing, setEditing] = useState(false);
  const [contributing, setContributing] = useState(false);
  const [spending, setSpending] = useState(false);
  const [editingEntry, setEditingEntry] = useState<Expense | null>(null);
  const [confirmingClose, setConfirmingClose] = useState(false);

  if (!event || !summary) return <div className="empty">Loading…</div>;

  const closed = event.phase === 'closed';
  const color = categories.get(event.category)?.color ?? 'var(--text-tertiary)';
  const thisMonth = currentMonthId();

  // Saving leads with the fund against the target; spending leads with what's
  // left of the fund. Same meter, different question.
  const headlineLabel =
    event.phase === 'saving' ? 'Set aside so far' : closed ? 'Left over' : 'Left in the fund';
  const headlineValue = event.phase === 'saving' ? summary.saved : summary.fundRemaining;
  const fraction = event.phase === 'saving' ? summary.fractionSaved : summary.fractionSpent;

  return (
    <div className="stack" style={{ ['--gap' as string]: 'var(--s-5)' }}>
      <button className="linkish row" style={{ gap: 6 }} onClick={onBack}>
        <IconArrowLeft />
        All events
      </button>

      <section className="card">
        <div className="headline">
          <span className="headline__label">{headlineLabel}</span>
          <div className="row row--between" style={{ width: '100%', alignItems: 'flex-end' }}>
            <span className="headline__value num">
              <Money amount={Math.abs(headlineValue)} compact />
            </span>
            <button className="linkish" onClick={() => setEditing(true)}>
              {closed ? 'View details' : 'Edit event'}
            </button>
          </div>
          <span className="headline__meta">
            {event.name} · {money(summary.target, { compact: true })} target
            {event.startDate && ` · ${monthLabel(event.startDate.slice(0, 7))}`}
          </span>
        </div>

        <div style={{ marginTop: 'var(--s-5)' }}>
          <Meter
            used={fraction}
            tone={summary.tone}
            label={
              event.phase === 'saving'
                ? `${Math.round(summary.fractionSaved * 100)}% of the target set aside`
                : `${Math.round(summary.fractionSpent * 100)}% of the fund spent`
            }
          />
          <div className="meter-legend">
            <span>
              {event.phase === 'saving'
                ? `${Math.round(summary.fractionSaved * 100)}% of target`
                : `${Math.round(summary.fractionSpent * 100)}% of fund`}
            </span>
            <span>
              {summary.contributionCount + summary.spendCount}{' '}
              {summary.contributionCount + summary.spendCount === 1 ? 'entry' : 'entries'}
            </span>
          </div>
        </div>

        <div style={{ marginTop: 'var(--s-5)' }}>
          <StatusPill tone={summary.tone}>{summary.statusLabel}</StatusPill>
          <p className="muted" style={{ fontSize: 'var(--t-small)', marginTop: 'var(--s-3)' }}>
            {summary.statusDetail}
          </p>
        </div>
      </section>

      {!closed && (
        <section className="card">
          <SectionHeading title="Mode" />
          <Segmented
            ariaLabel="Event mode"
            value={event.phase === 'spending' ? 'spending' : 'saving'}
            onChange={(phase) => setEventPhase(event.id, phase)}
            options={[
              { value: 'saving', label: 'Saving' },
              { value: 'spending', label: 'Spending' },
            ]}
          />
          <p className="stat__note" style={{ marginTop: 'var(--s-3)' }}>
            {event.phase === 'saving'
              ? "Money you set aside counts against the month you set it aside in — that's the line item in your monthly budget."
              : "Spending here draws the fund down and doesn't count against any month. It was already budgeted when you saved it."}
          </p>
          <div style={{ marginTop: 'var(--s-4)' }}>
            {event.phase === 'saving' ? (
              <button
                className="btn btn--primary btn--block"
                onClick={() => setContributing(true)}
              >
                Add to the fund
              </button>
            ) : (
              <button className="btn btn--primary btn--block" onClick={() => setSpending(true)}>
                Log an expense
              </button>
            )}
          </div>
        </section>
      )}

      <div className="statgrid">
        <div className="stat">
          <span className="stat__label">Target</span>
          <span className="stat__value num">
            <Money amount={summary.target} compact />
          </span>
          <span className="stat__note">what it's planned to cost</span>
        </div>
        <div className="stat">
          <span className="stat__label">Set aside</span>
          <span className="stat__value num">
            <Money amount={summary.saved} compact />
          </span>
          <span className="stat__note">
            {summary.contributionCount}{' '}
            {summary.contributionCount === 1 ? 'contribution' : 'contributions'}
          </span>
        </div>
        <div className="stat">
          <span className="stat__label">Spent</span>
          <span className="stat__value num">
            <Money amount={summary.spent} compact />
          </span>
          <span className="stat__note">
            {summary.spendCount} {summary.spendCount === 1 ? 'expense' : 'expenses'}
          </span>
        </div>
        <div className="stat">
          <span className="stat__label">Left in fund</span>
          <span className={`stat__value num ${summary.fundRemaining < 0 ? 'tone-over' : ''}`}>
            <Money amount={summary.fundRemaining} compact />
          </span>
          <span className="stat__note">
            {summary.fundRemaining < 0 ? 'past what was saved' : 'saved but not yet spent'}
          </span>
        </div>
        {summary.perMonthNeeded !== undefined && event.phase === 'saving' && (
          <div className="stat">
            <span className="stat__label">Per month</span>
            <span className="stat__value num">
              <Money amount={summary.perMonthNeeded} compact />
            </span>
            <span className="stat__note">
              over {summary.monthsToStart}{' '}
              {summary.monthsToStart === 1 ? 'month' : 'months'}
            </span>
          </div>
        )}
      </div>

      {summary.unfunded > 0 && !closed && (
        <div className="banner">
          <IconInfo />
          <div className="banner__body">
            <strong>
              <Money amount={summary.unfunded} /> spent beyond the fund.
            </strong>{' '}
            That money hasn't come out of any month's budget yet.{' '}
            <button
              className="linkish"
              onClick={async () => {
                if (isLocked(thisMonth)) {
                  notify('This month is closed', { detail: 'Nothing new can be logged to it.' });
                  return;
                }
                await coverFromMonth(event.id, thisMonth, summary.unfunded);
              }}
            >
              Cover from {monthLabel(thisMonth, { year: false })}
            </button>
          </div>
        </div>
      )}

      {closed && (
        <div className="banner">
          <IconLock />
          <div className="banner__body">
            <strong>Event closed.</strong> Its entries stay in their months and are read-only
            here.{' '}
            <button className="linkish" onClick={() => setEventPhase(event.id, 'spending')}>
              Reopen
            </button>
          </div>
        </div>
      )}

      <section className="card card--flush">
        <div className="row row--between" style={{ padding: 'var(--s-5) var(--s-5) var(--s-3)' }}>
          <h2 className="section-label">Ledger</h2>
        </div>
        {entries.length === 0 ? (
          <EmptyState icon={<IconFlag />} title="Nothing logged yet">
            <span>
              {event.phase === 'saving'
                ? 'Add to the fund and it shows up here, and in that month’s budget.'
                : 'Log an expense and it draws the fund down.'}
            </span>
          </EmptyState>
        ) : (
          <div className="list">
            {entries.map((entry) => (
              <button
                className="list__item"
                key={entry.id}
                onClick={() => !isLocked(entry.monthId) && setEditingEntry(entry)}
                aria-label={`${entry.description}, ${money(entry.amount)}${
                  isLocked(entry.monthId) ? ', read-only' : ''
                }`}
              >
                <span className="dot" style={{ background: color }} />
                <span className="list__main">
                  <span className="list__title">{entry.description}</span>
                  <span className="list__sub">
                    <span>{formatDayLabel(entry.date)}</span>
                    <span>·</span>
                    <span>{isContribution(entry) ? 'into the fund' : 'from the fund'}</span>
                    {isContribution(entry) ? <IconDownload /> : <IconWallet />}
                    <SplitNote expense={entry} />
                  </span>
                </span>
                <ExpenseAmount expense={entry} />
              </button>
            ))}
          </div>
        )}
      </section>

      {!closed && (
        <button
          className="btn btn--ghost btn--block"
          onClick={async () => {
            if (!confirmingClose) {
              setConfirmingClose(true);
              return;
            }
            await setEventPhase(event.id, 'closed');
            notify('Event closed', { detail: event.name });
          }}
        >
          {confirmingClose ? 'Tap again to close it' : 'Close this event'}
        </button>
      )}

      {editing && <EventSheet event={event} onClose={() => setEditing(false)} />}
      {contributing && (
        <ContributionSheet
          event={event}
          monthId={thisMonth}
          onClose={() => setContributing(false)}
        />
      )}
      {spending && (
        <ExpenseSheet
          monthId={thisMonth}
          event={event}
          confirmLabel="Log to the fund"
          onClose={() => setSpending(false)}
        />
      )}
      {editingEntry && (
        <ExpenseSheet
          monthId={editingEntry.monthId}
          expense={editingEntry}
          onClose={() => setEditingEntry(null)}
        />
      )}
    </div>
  );
}
```

Note: `Sheet` is imported but unused — remove it from the import before running the build.

- [ ] **Step 3: Verify**

Run: `npm run build`
Expected: clean.

Run: `npm test`
Expected: PASS.

---

### Task 11: Dashboard and Expenses screen integration

**Files:**
- Modify: `src/screens/Dashboard.tsx`
- Modify: `src/screens/ExpensesScreen.tsx`

**Interfaces:**
- Consumes: `countsAgainstMonth`, `isEventSpend` (Task 1); `summarizeMonth`'s new `events` input and `upcomingEvents` output (Task 4); `IconFlag` (Task 7).

- [ ] **Step 1: Feed events into the Dashboard's summary**

In `src/screens/Dashboard.tsx`:

```tsx
  const { activeMonthId, recurring, events, isLocked } = useApp();
```

```tsx
  const summary = useMemo(
    () => (month ? summarizeMonth({ month, expenses, recurring, events }) : null),
    [month, expenses, recurring, events],
  );
```

- [ ] **Step 2: Keep event spending out of the month's category mix**

Still in `Dashboard.tsx`, add above the return:

```tsx
  // The month's own spending — event spending was budgeted when it was saved,
  // so it isn't part of what this month cost or how it was split up.
  const monthExpenses = expenses.filter(countsAgainstMonth);
```

and pass `monthExpenses` to `<CategoryBreakdown expenses={monthExpenses} />` and to the "Recent" list's `.slice(0, 5)`. Import `countsAgainstMonth` from `../lib/event`.

- [ ] **Step 3: Show planned set-asides in "Expected this month"**

Change the section's render condition and add the event rows. Replace:

```tsx
      {summary.upcoming.length > 0 && month.status === 'open' && (
```

with:

```tsx
      {(summary.upcoming.length > 0 || summary.upcomingEvents.length > 0) &&
        month.status === 'open' && (
```

and inside the inner `.stack`, after the existing `summary.upcoming.map(...)`, add:

```tsx
            {summary.upcomingEvents.map(({ event, amount }) => (
              <div className="row row--between" key={event.id}>
                <span className="row" style={{ gap: 'var(--s-2)', minWidth: 0 }}>
                  <span
                    className="dot"
                    style={{
                      background: categories.get(event.category)?.color ?? 'var(--text-tertiary)',
                    }}
                  />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {event.name} fund
                  </span>
                </span>
                <span className="row" style={{ gap: 'var(--s-3)' }}>
                  <span className="stat__note">to set aside</span>
                  <Money amount={amount} compact />
                </span>
              </div>
            ))}
```

- [ ] **Step 4: Add the events card to the Month screen**

Insert this section just above the "By category" card in `Dashboard.tsx`:

```tsx
      {events.some((e) => e.phase !== 'closed') && (
        <section className="card card--flush">
          <div className="row row--between" style={{ padding: 'var(--s-5) var(--s-5) var(--s-3)' }}>
            <h2 className="section-label">Events</h2>
            <button className="linkish" onClick={() => onNavigate('events')}>
              See all
            </button>
          </div>
          <div className="list">
            {events
              .filter((e) => e.phase !== 'closed')
              .map((event) => {
                const s = summarizeEvent({
                  event,
                  expenses: allExpenses.filter((e) => e.eventId === event.id),
                });
                return (
                  <button
                    className="list__item"
                    key={event.id}
                    onClick={() => onNavigate('events')}
                  >
                    <span
                      className="dot"
                      style={{
                        background:
                          categories.get(event.category)?.color ?? 'var(--text-tertiary)',
                      }}
                    />
                    <span className="list__main">
                      <span className="list__title">{event.name}</span>
                      <span className="list__sub">
                        <span>{event.phase === 'saving' ? 'Saving' : 'Spending'}</span>
                        <span>·</span>
                        <span>
                          {money(s.saved)} of {money(s.target, { compact: true })}
                        </span>
                        {s.contributedThisMonth > 0 && (
                          <>
                            <span>·</span>
                            <span>{money(s.contributedThisMonth)} this month</span>
                          </>
                        )}
                      </span>
                    </span>
                    <span className="list__amount num">
                      <Money
                        amount={
                          event.phase === 'saving' ? s.targetRemaining : s.fundRemaining
                        }
                        compact
                      />
                    </span>
                  </button>
                );
              })}
          </div>
        </section>
      )}
```

This needs the *whole* expense list, not just the month's, because an event's fund spans months. Add `expenses: allExpenses` to the `useApp()` destructure:

```tsx
  const { activeMonthId, recurring, events, expenses: allExpenses, isLocked } = useApp();
```

and import `summarizeEvent` from `../lib/event`.

- [ ] **Step 5: Mark and exclude event spending on the Expenses screen**

In `src/screens/ExpensesScreen.tsx`:

Import `countsAgainstMonth, isEventSpend` from `../lib/event`, `IconFlag` from `../components/Icons`, and add `events` to the `useApp()` destructure.

Change the total so it matches the Dashboard's:

```tsx
  const counted = visible.filter(countsAgainstMonth);
  const total = sumNet(counted);
  const eventSpend = sumNet(visible.filter(isEventSpend));
  const eventNames = new Map(events.map((e) => [e.id, e.name]));
```

Under the total, state the fact rather than leaving two numbers that don't reconcile — replace the `· N items` span's parent block's trailing content with:

```tsx
          <div style={{ fontSize: 'var(--t-title)', fontWeight: 600, letterSpacing: '-0.02em' }}>
            <span className="num">{money(total)}</span>{' '}
            <span className="dim" style={{ fontSize: 'var(--t-small)', fontWeight: 400 }}>
              · {visible.length} {visible.length === 1 ? 'item' : 'items'}
            </span>
          </div>
          {eventSpend > 0 && (
            <span className="stat__note">
              Plus {money(eventSpend)} spent from event funds, budgeted when it was saved.
            </span>
          )}
```

And mark the rows — in the `.list__sub`, alongside the existing source glyphs:

```tsx
                    {expense.eventId && <IconFlag />}
                    {expense.eventId && (
                      <>
                        <span>·</span>
                        <span>{eventNames.get(expense.eventId) ?? 'Event'}</span>
                      </>
                    )}
```

- [ ] **Step 6: Verify**

Run: `npm run build`
Expected: clean.

Run: `npm test`
Expected: PASS.

---

### Task 12: Browser regression pin

**Files:**
- Create: `scripts/verify-event-budget.mjs`
- Modify: `README.md`

**Interfaces:**
- Consumes: the running app. Read `scripts/verify-bulk-add.mjs` first and copy its exact bootstrapping (Playwright import, `chromium.launch`, viewport, the URL argument, the `assert`/`fail` helpers, exit code convention). Do **not** invent a different harness shape.

- [ ] **Step 1: Read the existing pin**

Run: `cat scripts/verify-bulk-add.mjs`

Note how it navigates, how it clears storage between phases, how it waits for elements, and how it reports. The new script must look like it was written by the same person.

- [ ] **Step 2: Write the script**

Create `scripts/verify-event-budget.mjs` pinning these five behaviours, each with its own assertion and message:

1. **A contribution lowers the month.** Set a budget of 2000. Create an event "Japan trip" with target 3000. Add 400 to the fund. Go to the Month tab; assert "Left this month" reads `$1,600`.
2. **A trip spend does not lower the month.** Flip the event to Spending. Log a 250 expense against it. Go to the Month tab; assert "Left this month" still reads `$1,600`. Go to the Expenses tab; assert the row is present (so it reaches reconciliation) and that the total still reads `$400.00`.
3. **The flip changes the screen.** On the event, with phase Saving, assert the primary button reads "Add to the fund"; after pressing Spending, assert it reads "Log an expense".
4. **Cover from this month.** With 400 saved and 250 spent there is no unfunded amount; log a further 300 spend so `unfunded` is 150, assert the banner appears, press "Cover from …", and assert the banner is gone, the fund shows 550 saved, and the month's "Left this month" has dropped by exactly 150.
5. **A closed month locks event entries.** Not scriptable without a full reconcile run; instead assert the narrower, equivalent guard: opening a contribution sheet dated into a reconciled month disables the submit button and shows the "is closed" note. If the harness makes even that awkward, assert instead that `ContributionSheet`'s note text appears for an open month and drop this case, noting why in a comment — do not leave a half-working assertion in the file.

- [ ] **Step 3: Run it**

```bash
npm run build && npx vite preview --port 4173 &
node scripts/verify-event-budget.mjs http://localhost:4173
```

Expected: every check passes and the script exits 0.

- [ ] **Step 4: Document it**

In `README.md`, add to the `verify-*` list in the commands block:

```
node scripts/verify-event-budget.mjs http://localhost:4173 # contributions hit the month, event spending doesn't
```

and add a row to the "What the PRD asked for, and where it lives" table:

```
| Event budgets — save for a trip, then spend from it | `lib/event.ts`, `screens/EventsScreen.tsx`, `screens/EventDetail.tsx` |
```

---

### Task 13: Documentation

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: README — explain the rule**

Add a section after "Split payments", in the same voice as its neighbours:

```markdown
### Event budgets

Some budgets aren't months. A trip, a wedding, a laptop — you save for it over a while and
then spend it down. An **event** owns a fund, and two kinds of money move through it.

The whole feature rests on one rule:

> **Money you set aside counts against the month you set it aside in. Money you spend on the
> event counts against nothing — it was already budgeted when you saved it.**

That is what makes an event both separate from the monthly budget and a line item in it. A
$400 monthly set-aside for a Japan trip is $400 September can't spend, and it appears in
September's ledger like any other expense. The $250 dinner in Kyoto six months later draws
the fund down and leaves March's budget alone, because September already paid for it.

Someone who just wants a trip inside one month doesn't need a second mode: contribute the
whole amount once, and spend from it. Same model, one contribution instead of six.

Spending past the fund isn't silently absorbed. The event states the unfunded amount and
offers one action — **Cover from this month** — which logs a contribution for exactly that
much into the current month. Money reaches a month's budget once, and only when you say so.

Contributions and event spending are ordinary `Expense` records tagged with an `eventId`, so
both still appear in the month's ledger and both still reach reconciliation — the statement
carries a transfer to savings and a dinner in Kyoto alike. The only thing the tag changes is
which of them the month's budget arithmetic counts, and that decision lives in exactly one
predicate (`countsAgainstMonth` in `lib/event.ts`).

An event with entries can't be deleted, only closed. Untagging its expenses would silently
change the totals of months that may already be reconciled and locked; deleting them would
destroy reconciled history.
```

Add to the `src/` tree listing:

```
  lib/event.ts           The one rule: what an event's fund is, and what a month counts
```

and change the `screens/` line to mention events.

- [ ] **Step 2: CLAUDE.md — record the architecture rule**

Add to the "Architecture" bullet list, after the money bullet:

```markdown
- Event budgets are not a second ledger: a contribution and an event expense are ordinary
  `Expense` rows tagged `eventId` + `eventKind`. The **only** thing the tag changes is budget
  arithmetic, through one predicate — `countsAgainstMonth` (`src/lib/event.ts`). Contributions
  count against their month; `eventKind: 'spend'` never does. Reconciliation is deliberately
  untouched by it: the statement carries both.
```

Verify the tab-count edits from Task 7 Step 4 are present.

- [ ] **Step 3: Final verification**

```bash
npm test
npm run build
```

Both clean. Then re-run the smoke walk to make sure the sixth tab didn't break the shell:

```bash
npx vite preview --port 4173 &
node scripts/smoke.mjs http://localhost:4173
node scripts/verify-integration.mjs http://localhost:4173
node scripts/verify-event-budget.mjs http://localhost:4173
```

All three exit 0.

---

## Self-review

**Spec coverage:**

| Spec section | Task |
| --- | --- |
| `BudgetEvent` record | 1 |
| `Expense.eventId` / `eventKind` | 1 |
| `countsAgainstMonth` predicate | 1 |
| IndexedDB migration | 5 |
| Server `emptyData`, `DATA_KEYS` left alone | 5 |
| `BackupFile` v2 | 5 |
| `summarizeEvent` + tone table | 3 |
| `monthsBetween` / saving pace | 2, 3 |
| `summarizeMonth` exclusion | 4 |
| `plannedEventContributions` → `upcomingEvents` | 4 |
| Dashboard events card | 11 |
| Sixth tab, `IconFlag`, FAB rule | 7 |
| Events list | 8 |
| Event detail, phase flip, unfunded banner, ledger | 10 |
| `EventSheet` progressive disclosure, delete-only-when-empty | 9 |
| `ContributionSheet` | 9 |
| `ExpenseSheet` event mode | 10 |
| Store actions + guards | 6 |
| Unit tests | 1, 2, 3, 4 |
| Browser pin | 12 |
| Docs | 7, 12, 13 |

No spec requirement is unassigned.

**Placeholder scan:** none — every code step carries real code. Task 12 Step 2 describes
assertions rather than showing the script verbatim, which is deliberate: the harness shape
must be copied from `scripts/verify-bulk-add.mjs` at execution time, and Step 1 makes
reading it a required step.

**Type consistency:** `countsAgainstMonth` / `isContribution` / `isEventSpend` /
`summarizeEvent` / `EventSummary` / `plannedEventContributions` / `UpcomingEventContribution`
/ `upcomingEvents` / `EventInput` / `coverFromMonth(eventId, monthId, amount)` are spelled
identically in every task that names them. `BudgetEvent.monthlyContribution` (not
`monthlySetAside`) throughout. `EventPhase` values are `'saving' | 'spending' | 'closed'`
everywhere.

**Known ordering note:** Tasks 7–10 form one compile unit — Task 7 imports `EventsScreen`,
which imports `EventDetail` and `EventSheet`. `npm run build` is only expected to be clean
at the end of Task 10. Each of those tasks still has its own reviewable deliverable; the
build gate simply lands on 10.
