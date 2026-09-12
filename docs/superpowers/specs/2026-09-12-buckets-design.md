# Buckets — design

**Date:** 2026-09-12
**Status:** approved for implementation
**Supersedes the naming in:** `2026-09-11-event-budgets-design.md` (the one rule and the
single-ledger decision carry over unchanged)

Four changes to the feature that shipped as v1.5.0:

1. **"Event" becomes "bucket".** The thing is a pot of money, not an occasion. New golf clubs
   is as valid as a trip to Japan.
2. **Dates are properly optional**, in the model's framing and in the copy — a bucket with no
   dates is the normal case, not a degenerate one.
3. **An expense dated inside a bucket's date range is assigned to that bucket automatically.**
4. **The log-an-expense form gets an explicit picker** for what the expense counts against.

## 1. The rename

"Event" was the wrong noun. It implies an occasion with a date, which pushed every bit of copy
toward trips and made a golf-clubs fund read as a misuse. "Bucket" is what the thing actually
is: a pot you put money into and later take money out of.

| Before | After |
| --- | --- |
| `BudgetEvent` | `Bucket` |
| `EventPhase` | `BucketPhase` |
| `EventKind` | `BucketKind` |
| `Expense.eventId` / `.eventKind` | `Expense.bucketId` / `.bucketKind` |
| `src/lib/event.ts` | `src/lib/bucket.ts` |
| `summarizeEvent` / `EventSummary` | `summarizeBucket` / `BucketSummary` |
| `EventsScreen` / `EventDetail` / `EventSheet` | `BucketsScreen` / `BucketDetail` / `BucketSheet` |
| store: `events`, `createEvent`, … | `buckets`, `createBucket`, … |
| repo: `listEvents` / `saveEvent` / `deleteEvent` | `listBuckets` / `saveBucket` / `deleteBucket` |
| IndexedDB store `events` | `buckets` |
| document / backup key `events` | `buckets` |
| `.eventrow` | `.bucketrow` |
| `IconFlag` | `IconBucket` |
| tab label "Events" | "Buckets" |

`countsAgainstMonth` keeps its name — it describes the month, not the bucket.

**What does not change:** the one rule ("money you set aside counts against the month you set
it aside in; money you spend from the bucket counts against no month"), the single-ledger
decision (a contribution and a bucket expense are ordinary `Expense` rows), the phases
(`saving` / `spending` / `closed`), and the delete-only-while-empty guard.

### Migration is mandatory

v1.5.0 is merged and may already have been installed by Supervisor, so stored data can exist
in the old shape. A rename that silently drops it is not acceptable. Every read path migrates:

- **IndexedDB** — `DB_VERSION` 2 → 3. The `onupgradeneeded` handler creates the `buckets`
  store, copies every row out of `events`, deletes the `events` store, and walks the
  `expenses` store rewriting `eventId`/`eventKind` to `bucketId`/`bucketKind`. All inside the
  version-change transaction, so it is atomic.
- **Server-backed document** — `ApiRepository.init()` checks the fetched document and, when it
  still carries `events` or event-tagged expenses, commits the migrated document once.
- **Backups** — `importAll` migrates before storing, so a v2 backup restores into buckets.
- **Export** — `BackupFile.version` widens to `1 | 2 | 3`; new exports write `3`.
- **Server** — `emptyData()` swaps `events: []` for `buckets: []`. `DATA_KEYS` is still
  untouched (it never listed either), so no client is rejected.

The migration itself is a pure function in `src/lib/migrate.ts`, so it is unit-testable
without a browser, and it is **idempotent** — running it on already-migrated data is a no-op.

## 2. Dates are optional

`startDate` and `endDate` were already optional in the type, but only `startDate` had a UI
field and all the copy assumed an occasion. Changes:

- `endDate` gets a field, next to `startDate`, under the same disclosure — now labelled
  **"+ Add dates and a monthly plan"**.
- The hint states the case plainly: *"Optional. A trip has dates; something you're saving up
  for might not."*
- The name placeholder becomes **"Golf clubs"** rather than "Japan trip", so the form itself
  says a bucket needn't be a trip.
- Saving-phase copy stops assuming a date: *"Switch to spending when you start spending it"*
  rather than "when it starts".
- The pace line (`$400.00 a month to be ready by March 2027`) already only appears with a
  `startDate`, and stays that way.

Target amount stays required. A bucket without a number to aim at has no meter and no status,
and `summarizeBucket` already carries a "No target set" fallback as a safety net for data that
arrives that way.

## 3. Automatic assignment by date range

```ts
/**
 * The bucket an expense dated `date` belongs to, or null. Only buckets with
 * BOTH ends of a range can claim a date — one date is not a range.
 */
export function bucketForDate(date: ISODate, buckets: Bucket[]): Bucket | null;
```

Rules, in order:

1. Candidates are buckets that are **not closed** and have **both** `startDate` and `endDate`,
   with `startDate <= date <= endDate` (inclusive at both ends).
2. Prefer `phase === 'spending'` over `'saving'` — if you are mid-trip, that is the bucket.
3. Then the **narrowest** range, in days. A week-long trip beats a year-long savings window.
4. Then the **most recently created**.
5. Deterministic, and `null` when nothing matches.

### It preselects; it does not hide

The match sets the picker's initial value and says so on screen. It never silently retags.
A user logging groceries during their trip week must be able to see that the app has pointed
the expense at the trip fund, and change it in one tap — otherwise the month's budget quietly
stops meaning what they think it means. "Automatic" here means *the user does nothing in the
common case*, not *the user is not told*.

### Where it applies, and where it deliberately does not

| Path | Auto-assigned? | Why |
| --- | --- | --- |
| `ExpenseSheet` (the FAB, the ledger, reconcile's "add from statement") | **Yes**, preselected + overridable | A person is logging a discretionary charge. |
| `BulkExpenseSheet` | **Yes**, per row by its own date, with a batch-level override | Ten trip receipts at once is exactly the case. |
| Recurring confirmations (`confirmRecurring`) | **No** | Rent confirmed during a trip week is not a trip cost. |
| Reconcile auto-match (`autoMatch`) | **No** | It links existing expenses; it never decides what a charge is for. |
| `coverFromMonth` | **No** | It is already explicitly a contribution to a named bucket. |

So auto-assignment lives at the **UI entry points where a human is logging a discretionary
expense**, not in the store. Putting it in `addExpense` would catch the recurring and
reconciliation paths too, which is wrong in both.

## 4. The picker

A `.chiprow` of tap-chips with `aria-pressed`, labelled **"Counts against"**, placed directly
after the Category row in `ExpenseSheet`:

```
Counts against
[ This month ] [ Japan trip ] [ Golf clubs ]
```

- `This month` is first and is the default when nothing matches by date.
- One chip per **non-closed** bucket. Closed buckets never appear — except the one an expense
  being edited is already tagged to, which appears so the tag is visible and removable.
- **The whole row is hidden when the user has no open buckets**, so anyone not using the
  feature sees the form exactly as it was.
- Below it, a `.stat__note` states the consequence and, when relevant, why:
  - matched by date → *"Dated inside Japan trip — logging to its fund. This doesn't count
    against September's budget."*
  - chosen by hand → *"Spent from the Japan trip fund — this doesn't count against
    September's budget."*
  - `This month` → no note; that is the unremarkable case.

Selecting a bucket tags the expense `bucketKind: 'spend'`. **The picker never creates a
contribution** — money *into* a bucket comes from the bucket screen's "Add to the fund", which
is a different intent with a different form. A chiprow that could mean either would be a
coin-flip every time.

Choosing a bucket also suppresses the "+ Make this recurring" offer, since a trip dinner is
not a monthly bill.

### This is deliberately not behind a disclosure

The design rules put secondary fields behind a `.linkish` "+ …". This row is not secondary
once buckets exist — it is a primary choice about where the money lands, and it was the
explicit ask. Hiding it behind a toggle would make the app's second budgeting axis
undiscoverable from the place people actually log money. It stays hidden for users with no
buckets, which is what the disclosure rule is really protecting.

### Bulk entry

`BulkExpenseSheet` gets one sheet-level chiprow, since a grid of per-row pickers would be
unreadable:

```
Counts against
[ Auto by date ] [ This month ] [ Japan trip ]
```

`Auto by date` is the default and resolves each row independently against its own date; each
matched row shows a `→ Japan trip` note beside the existing "Lands in <month>" note. The other
chips force every row in the batch.

## Clearing a tag — a bug the picker would otherwise hit

`ExpenseInput.bucketId` is typed `string | null | undefined`:

- `undefined` — not provided; leave whatever the expense already has.
- `null` — **clear the tag**; the expense goes back to counting against its month.
- a string — set it.

This matters because `updateExpense` merges a partial patch, and the current code reads
`patch.eventId !== undefined ? patch.eventId : existing.eventId`. With only `undefined`
available there is no way to express "remove this tag", so picking `This month` on an
already-tagged expense would silently do nothing. `null` is the sentinel that makes the picker
work in both directions.

`buildExpense` and `updateExpense` both normalise the pair: a kind without an id is always
dropped, because a stray `bucketKind: 'spend'` would take an ordinary expense out of its
month's budget with nothing to explain why.

## Testing

**Unit — `test/migrate.test.ts` (new):**
- a v2 document with two events and three expenses (contribution, spend, untagged) migrates:
  ids and every field preserved, expenses re-tagged, `events` key gone
- already-migrated data is untouched, and migrating twice equals migrating once
- a document with neither key is untouched
- a v2 `BackupFile` restores into buckets

**Unit — `test/bucket.test.ts` (renamed from `event.test.ts`):**
- every existing `summarizeBucket` case, renamed
- `bucketForDate`: inclusive at both ends; no match outside; ignores closed buckets; ignores
  buckets missing either end of the range; prefers `spending` over `saving`; then the
  narrower range; then the newer bucket; returns null for no candidates

**Unit — `test/logic.test.ts`:** existing month-arithmetic cases, renamed fields.

**Browser — `scripts/verify-bucket-migration.mjs` (new):** the riskiest path, and the one no
unit test reaches. Seeds IndexedDB directly with a **v2-shaped** database (version 2, an
`events` store holding a legacy event, `expenses` rows tagged `eventId`), then loads the app
and asserts the bucket, its ledger, and the month's arithmetic all survived the upgrade.

**Browser — `scripts/verify-bucket-budget.mjs` (renamed):** the existing five checks, plus:
- an expense dated inside a bucket's range opens with that bucket preselected and says so
- switching the picker to `This month` puts the money back into the month's budget
- the picker row is absent when there are no open buckets

## Decisions taken without asking

The user asked not to be interrupted. Each of these is reversible:

1. **Auto-assignment preselects rather than silently tagging** — the user sees it and can
   change it in one tap. Silent retagging would make the month's total stop meaning what the
   user thinks it means.
2. **A date range needs both ends.** A `startDate` alone does not claim expenses.
3. **The picker only ever creates spending, never contributions.**
4. **Recurring and reconciliation paths are exempt** from auto-assignment.
5. **The picker is not behind a disclosure**, but the whole row is hidden with no buckets.
6. **Target amount stays required**; only dates became truly optional.
7. **Bulk gets a batch-level override**, not per-row pickers.
8. **`IconFlag` is replaced by `IconBucket`**, not kept alongside it — nothing else used it.
