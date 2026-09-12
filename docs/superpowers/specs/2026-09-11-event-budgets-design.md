# Event budgets — design

**Date:** 2026-09-11
**Status:** approved for implementation (see "Decisions taken without asking")

A second budgeting facet: a named goal with its own total — a trip, a wedding, a new
laptop — that is planned and tracked separately from the monthly budget, while the money
you set aside for it still shows up as a line item in the month you set it aside.

## The problem

The app has exactly one budgeting unit: a calendar month with a single total. That works
for groceries and rent and fails for anything that spans months. A $3,000 trip in March
either blows March apart or is invisible until it arrives. Users want to:

1. Name a thing, give it a target, and watch a fund grow toward it.
2. Have the saving show up in each month's budget — it *is* money that month can't spend.
3. Flip the same thing over to spending mode when the trip starts, and draw the fund down.
4. Not have the trip's spending hit the month's budget a second time.

## The core idea: one pot, two phases, one honest rule

An **event** owns a fund. Two kinds of money move:

- A **contribution** — money set aside toward the event.
- A **spend** — money spent on the event itself.

The rule that makes the whole thing add up, and the only one a user has to hold:

> **Contributions count against the month you make them. Spending on the event does not
> count against any month — that money was already budgeted when it was saved.**

Everything else follows from it. A user who wants "a trip inside this month's budget"
does not need a second mode: they contribute the whole amount in one go in that month
(one line item, one number in the month's budget) and then spend from the fund. A user
saving over six months contributes six times. Same model.

When spending outruns the fund, the app does not silently absorb it. The event reports an
**unfunded** amount as a fact, and offers one action — *Cover from this month* — which logs
a contribution for exactly that amount in the current month. The money lands in a month's
budget once, explicitly, at the moment the user says so.

### Why no `countsInMonthlyBudget` flag

The obvious alternative gives each event a switch for whether it touches months. It was
rejected: two knobs (phase + funding mode) with four combinations, two of which are
nonsense, to express something the single rule already expresses. The one-rule model
cannot double-count and cannot lose money, and there is no state in which the user has to
work out which mode they are in.

## Data model

### One new record

```ts
export type EventPhase = 'saving' | 'spending' | 'closed';

export interface BudgetEvent {
  id: string;
  name: string;
  /** What the whole thing is planned to cost. */
  targetAmount: number;
  phase: EventPhase;
  /** When the event happens — optional, drives the saving pace line. */
  startDate?: ISODate;
  endDate?: ISODate;
  /** Planned set-aside per month; 0 means "no plan, just a pot". */
  monthlyContribution: number;
  /** Category used for contributions and preselected for spends. */
  category: string;
  note?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  closedAt?: Timestamp;
}
```

### Two new fields on `Expense`

```ts
/** Set when this expense belongs to an event's ledger. */
eventId?: string;
/** Only meaningful with `eventId`. */
eventKind?: 'contribution' | 'spend';
```

**There is no separate event-entry record.** Contributions and event spends *are*
expenses, living in the month they happened. This is the load-bearing decision:

- A contribution is money leaving the account, so it is an expense, so it counts against
  its month with no special case anywhere — that is the "line item in the monthly budget"
  the feature asks for, obtained for free.
- Both kinds still appear in the month's ledger, still reach reconciliation, still match a
  statement row. A trip dinner is on the statement; a transfer to savings is on the
  statement. Hiding them from reconciliation would break the month's close.
- There is no second record to keep in sync with the first, and so no class of bug where
  deleting one strands the other. Every `verify-*` script in this repo pins a bug of
  exactly that shape.

The only thing the new fields change is **budget arithmetic**, in one place.

### Migration

- **IndexedDB:** `DB_VERSION` 1 → 2, adding an `events` object store. The existing
  `onupgradeneeded` already guards each store with `contains`, so the upgrade is additive
  and existing data is untouched.
- **Server:** `emptyData()` gains `events: []`. `DATA_KEYS` (the PUT validator) is
  **not** extended — requiring a seventh key would 400 a PUT from a client built before
  this change. The server stores `data` verbatim, so the new key round-trips regardless.
- **Client:** every read of `data.events` defaults to `[]`, so a document written before
  this change loads clean.
- **Backup:** `BackupFile` gains `events: BudgetEvent[]` and its `version` widens to
  `1 | 2`. New exports write `2`; restore accepts both and defaults `events` to `[]`.

## The one arithmetic rule, in code

`src/lib/event.ts` owns the predicate, and everything that computes a monthly figure uses
it:

```ts
/** Expenses that count against a month's budget: everything except event spending. */
export function countsAgainstMonth(e: Pick<Expense, 'eventKind'>): boolean {
  return e.eventKind !== 'spend';
}
```

Applied in exactly these places:

| Where | Change |
| --- | --- |
| `summarizeMonth` | `spent`, `reimbursed`, `expenseCount`, the day-to-day rate and the projection all run over `expenses.filter(countsAgainstMonth)`. |
| `totalsByCategory` on the Dashboard | Same filter — an event's spending is not part of the month's category mix. |
| `ExpensesScreen` running total | Same filter, with a stated note when event spending is present. |
| `reconcile.ts` | **Unchanged.** Reconciliation is about the statement, and the statement carries every charge. |

`reconciliationTotals.verifiedTotal` therefore includes event spending while the
dashboard's `spent` does not. That is correct but could read as a contradiction, so the
reconcile summary states the event portion on its own line when there is one.

## Event maths — `src/lib/event.ts`

Pure, testable, no React. Mirrors `lib/projection.ts` in shape and in voice.

```ts
export interface EventSummary {
  eventId: string;
  target: number;
  /** Net of contributions. */
  saved: number;
  /** Net of event spending. */
  spent: number;
  /** saved − spent; negative means the fund is overdrawn. */
  fundRemaining: number;
  /** max(0, spent − saved) — what the fund did not cover. */
  unfunded: number;
  /** max(0, target − saved) — what is left to set aside. */
  targetRemaining: number;
  /** 0–1, uncapped. */
  fractionSaved: number;
  /** spent ÷ (saved or target), 0–1 uncapped. */
  fractionSpent: number;
  contributionCount: number;
  spendCount: number;
  /** Whole months from now to startDate; undefined when no start date. */
  monthsToStart?: number;
  /** targetRemaining ÷ monthsToStart. */
  perMonthNeeded?: number;
  /** True when this month already has a contribution logged. */
  contributedThisMonth: number;
  tone: PaceTone;
  statusLabel: string;
  statusDetail: string;
}

export function summarizeEvent(input: {
  event: BudgetEvent;
  expenses: Expense[];   // the event's own, filtered by eventId
  now?: ISODate;
}): EventSummary;
```

### Tone, per the three-hue rule

| Phase | Condition | Tone | Label |
| --- | --- | --- | --- |
| saving | `saved >= target` | good | "Fully funded" |
| saving | start date passed, `saved < target` | over | "$240.00 short" |
| saving | otherwise | info | "$1,200.00 to go" |
| spending | `spent <= saved` | good | "$820.00 left in the fund" |
| spending | `spent > saved` | over | "$140.00 past the fund" |
| closed | `spent <= saved` | good | "Came in under" |
| closed | `spent > saved` | over | "$140.00 over the fund" |

Copy states facts. No exclamation marks, no verdicts. Money through `formatMoney`; the
negative sign is U+2212.

### Saving pace

With a `startDate`, `monthsToStart` is a whole-month difference against the current month
(new `monthsBetween(a: MonthId, b: MonthId)` in `lib/dates.ts`). `perMonthNeeded` is
`targetRemaining / max(1, monthsToStart)`. Copy: "$1,200.00 to go · $400.00 a month to be
ready by March 2027."

## The month ↔ event seam

Two touchpoints, both small.

**1. Planned contributions show as expected cost.** `summarizeMonth` accepts an optional
`events` array. An event that is `phase: 'saving'`, has `monthlyContribution > 0`, and has
no contribution logged in that month contributes its planned amount to `upcomingTotal` and
appears in the Dashboard's "Expected this month" list. This is the same shape as an
unconfirmed recurring item, and reuses that section verbatim.

It is carried on a **separate** `upcomingEvents: UpcomingEventContribution[]` field rather
than widening `UpcomingRecurring` into a union — the recurring type stays exactly what it
is, and the Dashboard renders two small lists into one section.

**2. A summary card on the Month screen.** Rendered only when at least one event is not
closed: one row per event with name, phase, a `.catbar`-style 6px meter, and what this
month has contributed. Tapping it goes to the Events tab.

## Shell: a sixth tab

Events get a top-level tab — `Month · Expenses · Events · Reconcile · History · Settings`.
The tabbar goes from `repeat(5,1fr)` to `repeat(6,1fr)`; at the 430px design viewport that
is 71px per tab, which holds a 20px icon over an 11px label with room to spare. New
`IconFlag` in `Icons.tsx`, same grid and stroke as the rest.

The FAB is hidden on the Events tab — it logs to the active month, which is the wrong
context there. The Events screens carry their own primary buttons, so no affordance is
lost. `CLAUDE.md` and `docs/design-guidelines.md` are updated to say six tabs.

The topbar's month navigation stays as-is on the Events tab. `HistoryScreen` already spans
all months under the same topbar; inventing a per-screen shell rule for this one case would
cost more than it buys.

## Screens and components

```
src/lib/event.ts                    pure maths + the countsAgainstMonth predicate
src/screens/EventsScreen.tsx        list of events; drills into detail (HistoryScreen pattern)
src/screens/EventDetail.tsx         one event: header, phase flip, meter, stats, ledger
src/components/EventSheet.tsx       create / edit an event
src/components/ContributionSheet.tsx  add to the fund
```

### Events list

A `.card--flush` list. Each row: an 8px `.dot` in the event's category color, name,
`.list__sub` carrying phase + "saved of target", and a trailing `.list__amount` with the
fund balance. Closed events fall below a `.divider` under a "Closed" micro-label. Empty
state uses the standard centered treatment with a faded 26px `IconFlag`.

A `.btn--primary` "New event" sits above the list.

### Event detail

- Back link (`.linkish` + `IconArrowLeft`), matching `HistoryScreen`.
- **Headline card**: `.headline` leading with the number that matters for the phase —
  saving leads with what is saved, spending with what is left in the fund. `<Meter>` with
  the pace marker showing where an even saving rate would be today (saving phase only, and
  only with a start date). `<StatusPill>` + detail line beneath.
- **Phase flip**: a `<Segmented>` — *Saving* / *Spending* — directly under the headline,
  with a one-line `.stat__note` stating what the choice means. Two mutually exclusive
  options is exactly what Segmented is for. `closed` is not one of the segments; it is
  reached by an explicit "Close event" button and shown as a `.banner` when set.
- **Stat grid**: Target · Saved · Spent · Left in fund (+ "Unfunded" when non-zero, in
  `.tone-over`).
- **Primary action** follows the phase: *Add to the fund* (saving) / *Log an expense*
  (spending). Both are `.btn--primary`.
- **Unfunded banner**: when `unfunded > 0`, an info `.banner` stating the amount with a
  `.linkish` *Cover from this month* action that logs a contribution for that amount into
  the current month.
- **Ledger**: the event's own expenses, newest first, contributions and spends
  distinguished by a 14px inline glyph in `.list__sub` (`IconDownload` for into-the-fund,
  `IconWallet` for spent-from-it) and by the sub-line naming the month. Rows open the
  normal edit sheet, and are read-only when their month is closed.
- Closed event: read-only throughout, with a `.banner` + `IconLock`, exactly like a
  reconciled month.

### Event sheet

Fields in order: **Name** (autofocused) → **Target amount** (the oversized amount input) →
**Category** (`.chiprow`, never a select) → then, behind a `.linkish` "+ Add a date and a
monthly plan" disclosure: **Start date**, **Monthly set-aside**, **Note**. Progressive
disclosure, per the design rules — the common path is name, target, category, save.

Delete is offered only while the event has no entries; with entries the sheet says so and
offers *Close event* instead. This is deliberate: untagging expenses on delete would
silently change the totals of months that may already be reconciled and locked, and
deleting them would destroy reconciled history. Neither is acceptable, and "close" is what
the user actually wants in that situation.

### Contribution sheet

Deliberately smaller than `ExpenseSheet`: amount (autofocused, oversized), date, and a
description prefilled with "<Event name> fund". No category (it comes from the event), no
split, no recurring. It states the consequence in a `.stat__note`: "Counts against
September 2026 — that month's budget goes down by this much."

### Spending uses `ExpenseSheet`

`ExpenseSheet` gains one optional prop, `event?: BudgetEvent`, which tags the created
expense with `eventId` / `eventKind: 'spend'`, preselects the event's category, and adds a
`.stat__note` stating "Spent from the <name> fund — this does not count against the
month's budget." No new form, no duplicated validation.

## Store

`AppData` gains `events: BudgetEvent[]`. `ExpenseInput` gains `eventId?` and `eventKind?`,
which `buildExpense` and `updateExpense` carry through. New actions:

```ts
createEvent(input: Omit<BudgetEvent, 'id'|'createdAt'|'updatedAt'>): Promise<BudgetEvent>;
updateEvent(id: string, patch: Partial<BudgetEvent>): Promise<void>;
setEventPhase(id: string, phase: EventPhase): Promise<void>;
/** Refuses when the event has any tagged expenses. */
deleteEvent(id: string): Promise<void>;
/** Logs a contribution into the current month for the unfunded amount. */
coverFromMonth(eventId: string, monthId: MonthId): Promise<void>;
```

Two guards live in the store, not the screens, for the same reason `isLocked` does:

- `deleteEvent` throws / notifies rather than deleting when the event has entries.
- `coverFromMonth` refuses on a locked month, with the existing "That month is closed"
  toast shape.

Selectors: `useEvent(id)`, `useEventExpenses(eventId)`, `useEventSummary(id)`.

## Repository

`BudgetRepository` gains `listEvents()`, `saveEvent()`, `deleteEvent()`. Implemented in
all three: `IndexedDbRepository` (new store), `MemoryRepository`, `ApiRepository` (a new
key in the cached document, via the existing `upsertBy` + `commit` path). `exportAll` /
`importAll` carry `events` in each.

## Testing

**Unit — `test/event.test.ts`:**
- `countsAgainstMonth` on each of the four expense shapes.
- `summarizeEvent`: saved/spent/fundRemaining/unfunded exact through cents; net-of-split
  handling on both kinds; `targetRemaining` floors at zero; `fractionSpent` falls back to
  the target when nothing is saved; every tone/label row in the table above.
- `monthsToStart` / `perMonthNeeded`, including a start date in the current month and one
  in the past.

**Unit — added to `test/logic.test.ts`:**
- `summarizeMonth` excludes `eventKind: 'spend'` from `spent`, `expenseCount` and the
  projection, and includes contributions.
- A planned monthly contribution lands in `upcomingEvents` and `upcomingTotal`, and drops
  out once a contribution exists in that month.
- `totalsByCategory` over a filtered list is unchanged (the filter is the caller's job).

**Browser — `scripts/verify-event-budget.mjs`,** in the style of the other `verify-*` pins:
1. A contribution lowers the month's "left this month" by its amount.
2. A trip spend does **not** lower it, and still appears in the month's ledger.
3. Flipping saving → spending changes the headline and the primary action.
4. *Cover from this month* clears the unfunded amount and adds exactly one contribution.
5. An event entry in a reconciled month is read-only.

`npm run build` must typecheck clean, and `npm test` must pass, before the work is done.

## Decisions taken without asking

The user asked not to be interrupted, so these were settled rather than raised. Each is
reversible and is called out here so it can be overruled cheaply:

1. **One rule instead of a per-event funding mode** — contributions hit the month, spends
   never do. A user wanting a trip inside one month contributes once. (Reversible: add a
   flag later; nothing in the model forbids it.)
2. **Contributions are real expenses**, so they appear in the month's ledger and category
   breakdown under the event's category. The alternative — hiding them from the ledger —
   would make the month's list not add up to the month's total.
3. **A sixth tab** rather than a card buried on the Month screen. The phase flip is a
   recurring interaction and needs to be two taps away.
4. **Events are not month-scoped**, so the topbar's month arrows do not filter them.
5. **Delete only while empty.** With entries, the action is Close.
6. **No per-event categories or sub-budgets.** Categories stay global, and events do not
   get spending caps per category — that is the same "categories are for insight, not
   sub-budgets" line the app already draws.
7. **Planned contributions count in the month's projection.** Without this, a $400/month
   plan is invisible to the number that tells you whether the month lands on budget.
