# Budget Tracker

A single-total monthly budget tracker, built to the PRD. React + TypeScript, local-first,
dark-mode-first, no account and no network.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production bundle into dist/
npm test           # pure-logic unit tests
```

`npm test` bundles the logic modules with esbuild and runs them under `node --test`.
The `scripts/` directory holds browser-level checks — point each at a running preview:

```bash
npm run build && npx vite preview --port 4173
node scripts/smoke.mjs http://localhost:4173             # the whole core loop, with screenshots
node scripts/verify-integration.mjs http://localhost:4173 # focus, contrast, undo, persistence
node scripts/verify-close-gate.mjs http://localhost:4173  # can't close an unreviewed month
node scripts/verify-swipe-reset.mjs http://localhost:4173 # aborted swipe restores the card
node scripts/verify-bulk-add.mjs http://localhost:4173    # bulk entry skips blanks, blocks partials, routes by date
node scripts/verify-bucket-budget.mjs http://localhost:4173 # contributions hit the month, bucket spending doesn't
node scripts/verify-bucket-migration.mjs http://localhost:4173 # v1.5 "event" data survives the rename
```

The `verify-*` scripts each pin a bug that shipped once. They assert behaviour the happy-path
smoke walk structurally cannot catch — state mutated out from under a flow that assumed it
wouldn't be, which is where every serious defect in this app has come from.

## How it's put together

```
src/
  types/models.ts        Domain types — plain JSON shapes, ready to travel over a wire
  data/                  Storage seam: repository interface + IndexedDB and in-memory impls
  lib/                   Pure logic: money, dates, projection, CSV import, reconciliation
  lib/bucket.ts          The one rule: what a bucket's fund is, and what a month counts
  lib/migrate.ts         Renames stored "event" data to buckets, once, on the way in
  state/store.tsx        One store over the repository; screens never touch storage directly
  components/            Sheets, swipe card, meters, icons, category breakdown
  screens/               Dashboard, expenses, buckets, reconcile (import + two queues), history, settings
```

Two rules keep it honest:

**Nothing above `data/` knows what storage is.** Screens call the store; the store calls a
`BudgetRepository`. v1 ships `IndexedDbRepository` (with `MemoryRepository` as a fallback when a
browser refuses IndexedDB). The v2 backend is a third implementation of the same interface — no
screen changes, and the model shapes serialise as-is.

**Money never touches floating point twice.** Amounts are stored as numbers but every sum and
every comparison goes through integer cents, which matters most for the exact-match rule in
reconciliation.

## What the PRD asked for, and where it lives

| Feature | Where |
| --- | --- |
| Monthly budget + audit trail of edits (§4.1) | `components/BudgetSheet.tsx`, `Month.budgetHistory` |
| Split payments / reimbursements | `lib/expense.ts`, the split field in `ExpenseSheet` |
| One-tap expense logging (§4.2) | `components/ExpenseSheet.tsx`, the FAB in `App.tsx` |
| Bulk expense entry (§4.2) | `components/BulkExpenseSheet.tsx`, `lib/bulkExpense.ts`, "Add several" on the Expenses tab |
| Live dashboard, pace and projection (§4.3) | `lib/projection.ts`, `screens/Dashboard.tsx` |
| Recurring nudges, never auto-logged (§4.4) | `components/RecurringNudges.tsx` |
| Statement import and exact auto-match (§4.5) | `lib/csv.ts`, `lib/reconcile.ts` |
| Swipe review, two separate queues (§4.6) | `screens/reconcile/` |
| History, read-only past months (§4.7) | `screens/HistoryScreen.tsx` |
| Buckets — save for a trip or a thing, then spend from it | `lib/bucket.ts`, `screens/BucketsScreen.tsx`, `screens/BucketDetail.tsx` |
| JSON export / restore (§6) | Settings → Backup |
| Remembered UI state | `Preferences` in `types/models.ts`, `setPreference` in the store |

### Two deployments, one build

The same bundle runs two ways, and picks at boot by probing `api/health`:

- **Served by the Home Assistant app** (`budget-server`) — the server holds one budget
  document and every device that opens the page sees it. This is the answer to "my phone and my
  laptop have different budgets".
- **Dropped at `/local/budget/index.html`, or opened from disk** — no server answers, so it falls
  back to IndexedDB and behaves exactly as v1 did.

There is deliberately **no sync engine**. When the add-on serves the page, losing the connection
means the page never loaded, so there is no offline state to reconcile — the server is simply the
truth. A connection can still drop mid-session, and a write that fails then surfaces as "Not
saved" rather than appearing to have worked. See `docs/api-contract.md`.

`npm run build:addon` rebuilds and refreshes the copy the add-on image serves — the Supervisor
builds each add-on from its own folder only, so `www/` cannot be a symlink to `dist/`.

### What persists

In the local deployment, data and settings live in IndexedDB. So does a `Preferences` record — the small choices the app
shouldn't make you repeat: ledger sort order, category filter, the month you were last reading,
whether the "matched automatically" panel is open. These were component state and reset on every
reload; they don't now.

Closed months are enforced in the **store**, not the screens: `isLocked(monthId)` gates
`updateExpense`, `deleteExpense` and `setBudget`. Screens also hide the affordances, but a screen
that forgets is a screen that lets a reconciled month be edited — so the guard lives where it
can't be forgotten.

### Split payments

An expense carries two figures. `amount` is what left the account; `reimbursement` is the part
someone else covered. Log a $175 group dinner with $150 coming back and the ledger leads with
**$25.00** — that's what counts against the budget, the pace, the projection and the category
shares — while the sub-line still shows `$175.00 − $150.00 back`.

The gross is what reconciliation matches on, and that is the point of keeping both: the statement
says $175, so the dinner auto-matches cleanly, while the month is only $25 poorer for it. A
reimbursement is clamped to the charge — you can't get back more than you paid.

### Buckets

Some budgets aren't months. A trip, a wedding, new golf clubs — you save for it over a while
and then spend it down. A **bucket** owns a fund, and two kinds of money move through it.

A bucket doesn't need a date. A trip has one; new golf clubs doesn't. When a bucket *does*
carry a start and an end, anything you log inside that range is pointed at it automatically —
shown on the form, and one tap to send it back to the month instead.

The whole feature rests on one rule:

> **Money you set aside counts against the month you set it aside in. Money you spend from the
> bucket counts against nothing — it was already budgeted when you saved it.**

That is what makes a bucket both separate from the monthly budget and a line item in it. A
$400 monthly set-aside for a Japan trip is $400 September can't spend, and it appears in
September's ledger like any other expense. The $250 dinner in Kyoto six months later draws
the fund down and leaves March's budget alone, because September already paid for it.

Someone who just wants a trip inside one month doesn't need a second mode: contribute the
whole amount once, then spend from it. Same model, one contribution instead of six.

Spending past the fund isn't silently absorbed. The bucket states the unfunded amount and
offers one action — **Cover from this month** — which logs a contribution for exactly that
much into the current month. Money reaches a month's budget once, and only when you say so.

Contributions and bucket spending are ordinary `Expense` records tagged with a `bucketId`, so
both still appear in the month's ledger and both still reach reconciliation — the statement
carries a transfer to savings and a dinner in Kyoto alike. The only thing the tag changes is
which of them the month's budget arithmetic counts, and that decision lives in exactly one
predicate (`countsAgainstMonth` in `lib/bucket.ts`).

A planned monthly set-aside is counted in the month's projection until it's logged, the same
way an unposted rent payment is — otherwise a $400/month plan is invisible to the number
that tells you whether the month lands on budget.

A bucket with entries can't be deleted, only closed. Untagging its expenses would silently
change the totals of months that may already be reconciled and locked; deleting them would
destroy reconciled history.

### The projection

The "am I pacing well" number separates day-to-day spending from fixed costs. Day-to-day spend is
extrapolated from the rate so far; known recurring costs are added at their real amounts whether
or not they've posted yet. So rent never gets multiplied by a daily rate, and a month whose rent
hasn't landed doesn't look deceptively cheap.

### Import: any CSV, not one bank

The PRD scoped v1 to the Amex export. That was widened during the build: the app defines its own
canonical shape —

```
date,description,amount[,category][,notes]
```

— and adapts anything else to it. The importer sniffs the delimiter, detects whether there's a
header, matches columns against an alias list (`Transaction Date`, `Merchant Name`, `Debit`…),
works out the date order by looking for a day above 12, and decides which sign means "spent" by
majority vote over the file. Every one of those is a guess shown to the user with a live preview
before anything is written. A file already in the canonical shape imports with no setup; a file
from any bank takes one glance at the mapping step.

Credits and refunds are counted and left out — reconciliation is about charges. Rows outside the
month being reconciled are counted and left out too, unless you turn that off.

The optional `category` and `notes` columns aren't decoration: when a row you didn't log reaches
the review flow, a category name the app recognises is preselected on the add form and the note is
carried into the notes field. Producing that richer file from an arbitrary spreadsheet is what the
`budget-spreadsheet-import` skill is for.

### Reconciliation

Auto-matching is exact on both amount and date, one expense per row, as specified. Two identical
$6.50 coffees on the same day match two identical statement rows rather than one twice.

Everything else goes to review, in two deliberately different shapes:

- **Queue A** — statement rows that didn't match — is the swipe stack. Right proposes the closest
  logged expense (ranked by amount agreement first, then date distance, within ±7 days and 20%)
  and waits for approval; nothing links without the user seeing the specific expense. Left opens a
  prefilled add form.
- **Queue B** — things logged that the statement doesn't show — is a list, not a second stack.
  These need reading rather than clearing. If a typo was the reason something didn't match, fixing
  the amount or date links it automatically instead of asking again.

The stage lives in the session record, so a refresh or a day's gap resumes where you left off.
Closing the month locks its budget and expenses.

## Accessibility and design notes

Status is never carried by color alone — every state pairs its color with an icon and a written
label. The palette is the one the PRD specifies: soft blue for primary and neutral, sage for on
track, a desaturated red for off track, and nothing else doing functional work. Surfaces are flat
and matte; there is no blur or glass anywhere. The only animated thing is the swipe card, which
follows the finger and springs back if released short of the threshold — every gesture it handles
is also a button.

Copy states facts, not verdicts: "Trending $85 over" rather than anything with an exclamation mark
in it.

## Running it as a Home Assistant add-on

`budget-server/` at the repo root is a self-contained Home Assistant add-on (Node stdlib only,
Ingress, no exposed port) — see `budget-server/README.md` for what it does and where data lives.
This repo is *also* an add-on **repository**: `repository.yaml` at the root is what lets Home
Assistant track it via **Settings → Add-ons → Add-on Store → ⋮ → Repositories** instead of you
copying the folder onto the box by hand every time.

Two different things people mean by "update automatically":

- **Update available, one click.** Push a commit that bumps `version:` in `budget-server/config.yaml`,
  and Supervisor's periodic store refresh notices the repo now advertises a newer version than
  what's installed. An **Update** button appears on the add-on's page. This is on by default for
  every repo-tracked add-on — no setup needed beyond adding the repository once.
- **Fully silent.** The add-on's **Info** tab (or its ⋮ menu) has an **Auto update** toggle.
  With it on, Supervisor installs a new version the moment it notices one, with no click and no
  confirmation. It's convenient, but it also means a bad push updates a live add-on unattended —
  worth turning on only once you trust the update flow, and worth pairing with Settings →
  System → Backups having a recent one, since Supervisor keeps a rollback but a bad `/data`
  migration is still easiest to recover from a backup.

Either way, the version bump is the trigger — Supervisor doesn't poll for arbitrary commits, only
for `version:` changes, so `npm run build:addon` (refresh `www/`) and a `version:` bump belong in
the same commit whenever you ship a change meant to reach the running add-on.

### The version bump is automatic

A husky `post-commit` hook (`.husky/post-commit` → `scripts/bump-version.mjs`) reads each commit's
[Conventional Commits](https://www.conventionalcommits.org) subject and bumps `version:` in both
`budget-server/config.yaml` and `package.json`, folding the change into that same commit:

| Commit subject | Bump |
| --- | --- |
| `feat: …` | minor |
| `feat!: …` / `fix: …` with a `BREAKING CHANGE:` footer | major |
| `fix: …`, `perf: …`, `chore: …`, `docs: …`, and every other conventional type | patch |
| anything that isn't a conventional commit (`wip`, merge commits, …) | none |

History rewrites never bump — rebase, merge, cherry-pick, `git revert`, and `git commit --amend`
are all skipped (detected via `GIT_REFLOG_ACTION`). Note that a hand-written `revert:` subject on
an ordinary commit still patch-bumps; only `git revert`'s own action is exempt. The hook installs
on `npm install` (via the `prepare` script); `npm test` covers its logic. To land a change without
a bump, give it a non-conventional subject (`--no-verify` won't help — it skips `pre-commit` and
`commit-msg`, not `post-commit`).

## Known limits (v1, by design)

No accounts, no sync, no bank integration, no fuzzy auto-matching, and no per-category caps —
inside a bucket or out of one, categories stay for insight rather than sub-budgets. Data
lives in one browser on one device — the JSON export in Settings is the safety net, and the app
says so.
