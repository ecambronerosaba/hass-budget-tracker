# CLAUDE.md

Budget Tracker is a single-total monthly budget tracker: React + TypeScript, local-first, dark-mode-first,
no account and no network. It logs expenses (with split / reimbursement and recurring nudges), shows a live
dashboard with pace and projection, and reconciles a month against an imported bank statement through a
two-queue swipe flow. It ships as a Home Assistant add-on and also runs standalone from disk.

## Commands

```bash
npm run dev          # vite dev server, http://localhost:5173
npm run build         # tsc -b + production bundle into dist/
npm test              # pure-logic unit tests: node --experimental-strip-types --test
                      #   over test/*.test.ts + scripts/test/*.test.mjs (relative
                      #   imports in src/lib and the test files carry .ts extensions
                      #   so the runner resolves them with no bundler)
npm run build:addon   # npm run build, then refresh budget-server/www/ from dist/
```

`scripts/*.mjs` are browser-level checks (smoke walk + `verify-*` regression pins) — run against
`npx vite preview` per the README.

## Architecture (see README "How it's put together")

- Nothing above `src/data/` knows what storage is. Screens call `src/state/store.tsx`; the store calls a
  `BudgetRepository`. Impls: `IndexedDbRepository`, `MemoryRepository` fallback, and (add-on) a server-backed one.
- Money never touches floating point twice — every sum and comparison goes through integer cents
  (`src/lib/money.ts`).
- Closed months are enforced in the store (`isLocked` gates `updateExpense` / `deleteExpense` / `setBudget`),
  not just hidden in screens.
- Buckets are not a second ledger: a contribution and a bucket expense are ordinary `Expense` rows
  tagged `bucketId` + `bucketKind`. The **only** thing the tag changes is budget arithmetic, through one
  predicate — `countsAgainstMonth` (`src/lib/bucket.ts`). Contributions count against their month (that's the
  "line item in the monthly budget"); `bucketKind: 'spend'` never does. Reconciliation is deliberately
  untouched by it — the statement carries both. A bucket with entries can be closed, never deleted.
  A bucket with both a start and an end date claims expenses dated inside it (`bucketForDate`), but only
  at the UI entry points where a person logs a discretionary expense — never from the store, so recurring
  and reconciliation paths are unaffected.

## Two deployments, one build

The same bundle picks its backend at boot by probing `api/health`:

- **Served by the Home Assistant add-on** (`budget-server/`) — the server holds one budget document; every
  device that opens the page sees the same data. No sync engine — the server is simply the truth.
- **Standalone** (`/local/budget/index.html` or opened from disk) — no server answers, so it falls back to
  IndexedDB and behaves as v1 did.

## Gotcha: the version bump is automatic

- A husky **`post-commit`** hook (`.husky/post-commit` → `scripts/bump-version.mjs`) reads each commit's
  Conventional Commit subject and bumps `version:` in **both** `budget-server/config.yaml` and
  `package.json`, then **amends it into that same commit**.
- Bump rules: `feat:` → minor; `feat!:` or a `BREAKING CHANGE:` footer → major; `fix:` / `perf:` / `chore:` /
  `docs:` / every other conventional type → patch; non-conventional subject (`wip`, merge, …) → no bump.
- History rewrites never bump (rebase / merge / cherry-pick / `git revert` / `--amend`, detected via
  `GIT_REFLOG_ACTION`). `--no-verify` does **not** skip it (that only skips `pre-commit` / `commit-msg`).
- Supervisor only ships an add-on update when `version:` changes, so `npm run build:addon` (refresh `www/`)
  **and** the version bump belong in the **same commit** as any change meant to reach the running add-on.
- If a hook would fire, don't run `git commit` unless the user asked for a commit.

---

## Design

Full reference: `docs/design-guidelines.md`. This section is the quick-reference — respect all of it when
touching UI. Source: `src/styles/tokens.css`, `src/styles/app.css`, `src/components/ui.tsx`,
`src/components/Icons.tsx`, `src/App.tsx`, README "Accessibility and design notes".

### Philosophy — non-negotiables

- Scandinavian minimal, **dark-mode-first**. Light mode is a stretch goal held to the same restraint — it
  gets no look of its own.
- Flat, matte surfaces. **No blur, gloss, glass, glow, gradients-as-chrome, or heavy shadows.**
- **Three functional hues only:** blue (primary / neutral / info), sage (on track / good), soft desaturated
  red (off track / danger). Everything else is gray. No fourth hue.
- Category dots are muted naturals and do no functional work.
- Copy states **facts, not verdicts** — no exclamation marks.
- Local-first, no account, no network.
- Mobile-first; design/QA viewport 430×932. Scales to a centered ~680px column; sheets cap at 520px, become
  centered dialogs at ≥640px.
- **Every gesture is also a button** (the reconcile swipe card is the only animated affordance).
- **Status is never color alone** — always color + icon + label.
- `prefers-reduced-motion` zeroes `--dur`.

### Tokens (names — full values in the reference)

- **Surfaces:** `--bg` (warm near-black, never pure black), `--surface` (cards/sheets/rows), `--surface-raised`
  (hover/toasts/quiet buttons), `--surface-sunken` (inputs/chips), `--hairline`, `--hairline-strong`.
- **Text:** `--text-primary`, `--text-secondary`, `--text-tertiary` (contrast-tuned per theme to clear WCAG AA
  4.5:1 — **do not retune**), `--text-inverse` (on blue fills).
- **Accents:** `--blue` / `--blue-strong` / `--blue-dim` / `--blue-line`; `--sage` / `--sage-strong` /
  `--sage-dim`; `--red` / `--red-strong` / `--red-dim`; `--track`. Only blue has a `-line` token; sage/red
  tinted borders are inline rgba ~0.24–0.30.
- **Radii:** `--r-sm` 8 (focus outline) · `--r-md` 12 (inputs) · `--r-lg` 18 (cards/banner/statgrid) ·
  `--r-xl` 26 (sheets/swipe cards) · `--r-pill` 999 (buttons, chips, pills, meters, FAB, toasts, dots).
- **Spacing (8px base):** `--s-1` 4 … `--s-8` 64. Card/sheet padding `--s-5`; list row `13px --s-4`.
  `.stack` rhythm via `--gap` (default `--s-4`).
- **Type scale:** `--t-display` 44 · `--t-title` 26 · `--t-heading` 18 · `--t-body` 15 · `--t-small` 13 ·
  `--t-micro` 11. Fonts: `--font` (system sans), `--font-num` (mono — all money/figures).
- **Motion:** `--ease` `cubic-bezier(0.32,0.72,0,1)` (the one curve), `--dur` `220ms` (the one duration →
  `0ms` reduced-motion). Sanctioned exceptions only: 400ms meter/bar fills, 260ms toast-in, 120ms button
  press, 90ms linear deck hint. No new curve, no new duration.
- **Elevation:** `--shadow-card` (swipe card only), `--shadow-float` (FAB, toasts). Cards/sheets/rows have
  **no shadow** — separate with `--hairline`.

### Typography rules

- All money and every figure: `--font-num` + `tabular-nums` via `.num` / `<Money>` / `useMoneyFormatter`.
- **Never concatenate a currency string** — always `formatMoney` (`src/lib/money.ts`). Options `compact`,
  `signed`. Negative / signed sign is **U+2212 `−`**, not `-`.
- Negative letter-spacing on large text: display `-0.03em`, title `-0.02em`, topbar `-0.015em`, amount input
  `-0.02em`.
- Micro-labels (`.section-label`, `.stat__label`, table `th`): `--t-micro`, `uppercase`,
  `letter-spacing 0.07–0.09em`, weight 600, `--text-tertiary`.
- Button text weight 550; headings/titles/stat values 600; field labels 500.
- Amount input is deliberately oversized (30px / 600 / mono, `$` symbol 22px). Bulk uses `.amount-input--sm`
  (17px / 500) — a row of them shouldn't shout.

### Color usage

- **Blue:** primary buttons, active tab, FAB, `.linkish`, info banner/pill, default meter fill, pressed
  chip, left swipe hint, focus outline.
- **Sage:** on-track meter, "good" status pill, positive confirmation mark, right swipe hint. Never a CTA.
- **Red:** over budget, off track, destructive — always desaturated `--red*`. **Danger buttons are ghost
  (`.btn--danger`: transparent bg, `--red-strong` text, `--red-dim` border) — never a filled red button.**
- **Tint recipe:** `-dim` fill (~10–14% alpha) + `-line`/inline-rgba border + `-strong` text/icon.
- **Category colors** (`src/data/seed.ts`): used **only** as 8px `.dot` / `.chip__dot` and `.catbar` fills —
  never a large fill, text color, or state carrier. Fallback `--text-tertiary`.

### Layout / shell (`src/App.tsx`)

- Sticky topbar: `--bg`, 1px `--hairline` bottom. Month label (`--t-heading` 600) + status sub-line
  ("In progress" / "Open" / "Closed"). `‹ ›` ghost buttons; `›` disabled at the current month.
- Main column: `max-width 680px`, centered, `padding --s-5 --s-4 132px`. Under 420px side padding → `--s-3`,
  headline → 38px.
- Fixed bottom tab bar: `grid repeat(6,1fr)`, 20px icons, `--t-micro` labels, inactive `--text-tertiary`,
  active `--blue` + `aria-current="page"`. Respects `env(safe-area-inset-bottom)`. Tabs: Month, Expenses,
  Buckets, Reconcile, History, Settings.
- FAB: 54px `--blue` pill, 24px `--text-inverse` plus, `--shadow-float`, `:active` scale 0.94; offset-clamped
  to hug the 680 column edge. **Shown only when the month is open AND the screen is neither Reconcile nor Buckets**
  (both carry their own primary buttons).
- Breakpoints: 640 (sheets → centered dialogs) and 420 (column padding + headline). That's all.

### Component conventions (brief)

- **Card** — `.card`: `--surface` + `--hairline` + `--r-lg` + `--s-5`. `.card--flush` = 0 padding +
  `overflow:hidden` for edge-to-edge lists. No shadow.
- **Sheet** — `<Sheet>` is the **universal create/edit/confirm container**; no other modal primitive. Bottom
  sheet on mobile (rises 14px + fades), centered dialog ≥640px (fades only). `max-width 520`, `max-height
  92vh`, self-scrolling, scrim `rgba(8,9,10,0.62)`. Grip handle + `--t-title` title + ghost `IconClose`.
  Behaviours: portal, `role="dialog"`/`aria-modal`, focus trap, `Escape` closes, scrim-click closes, body
  scroll lock, **focus restored to the opener** on close.
- **Forms** — `<Field>` = label (`--t-small`, `--text-secondary`, 500) + control + `--t-micro` hint.
  `.input`/`.select`/`.textarea`: sunken bg, `--hairline` border, `--r-md`, `11px 13px`; **on focus border →
  `--blue-line`, bg → `--surface`, no outline**. Placeholder `--text-tertiary`. **Category is always a
  `.chiprow` tap-chip row with `aria-pressed`, never a `<select>`.** Progressive disclosure: split and
  "make recurring" hidden behind a `.linkish` "+ …" toggle, not shown by default. Primary add flow:
  **amount (autofocused) → category chip → description → save.**
- **Buttons** — `.btn`: pill, `11px 18px`, `--t-body`, weight 550, `:active` scale 0.98, `:disabled`
  opacity 0.42. Variants `--primary` (blue/`--text-inverse`), `--quiet` (`--surface-raised` + `--hairline`),
  `--ghost` (transparent + `--hairline` + `--text-secondary`), `--danger` (transparent + `--red-strong` +
  `--red-dim`). Modifiers `--block` (default in sheets), `--sm`. `.linkish` = inline blue text action.
  **Destructive confirm is two-step in place** ("Delete expense" → "Tap again to delete"), no extra modal.
- **Toasts** — bottom-center pill above the tabbar, `--surface-raised` + `--hairline-strong` +
  `--shadow-float`, rises 8px + fades. `role="status"`, `aria-live="polite"`, auto-dismiss, container
  `pointer-events:none`. Optional single action (canonically **Undo** after a destructive change),
  `--blue-strong` weight 600. Message = fact + optional `detail` + optional `tone`.
- **Meter** — 10px `--track` pill + fill (`--blue` default / `--sage` good / `--red` over, width 400ms). 2px
  `--text-secondary` **pace marker** = where an even rate would be today. `role="img"` + `aria-label`.
  `.meter-legend` beneath (`--t-micro`, tertiary, space-between). `.catbar` = 6px track, fill in the category
  color.
- **StatusPill** — `.status`: `-dim` bg + tinted border + `-strong` text + 14px icon + label. Tones
  `good` (IconCheck/sage), `over` (IconTrendUp/red), `info` (IconInfo/blue). **Never a tone without its
  icon + label.**
- **Lists** — full-width row button: leading 8px `.dot`, `.list__main` (ellipsised title + `.list__sub`),
  trailing `.list__amount` = **net** amount (`--font-num`, 550). `.list__sub` (`--t-small` tertiary) wraps
  between pieces, carries 14px inline status glyphs + `<SplitNote>` ("$175.00 − $150.00 back"). Hover →
  `--surface-raised`. Money headline leads with **net**; gross is detail.
- **Stat grid** — `grid auto-fit minmax(140px,1fr)`, `gap: 1px` over a `--hairline` background (tiles divided
  by hairlines). Lone final odd tile spans full width. `.stat` = `--t-micro` uppercase label + 21px/600
  value + optional `--t-micro` note.
- **Swipe cards** (reconcile only) — 340px `.deck`, card = `--surface` + `--hairline` + `--r-xl` +
  `--shadow-card`; top card `cursor:grab`, card behind `opacity 0.55`. Follows the finger, springs back below
  threshold. Left hint blue, right hint sage. `.deck__actions` = 2-col button grid (tap equivalent).
  `.progress-pips` show queue position.
- **Empty state** — centered, faded 26px icon (`opacity 0.5`), `--text-secondary` title over
  `--text-tertiary` body, `--s-7` vertical padding.
- **Segmented** — pill track (`--surface-sunken` + `--hairline`, 3px pad); inactive `--text-secondary`,
  active `aria-pressed` → `--surface-raised` + `--text-primary`. 2–3 mutually exclusive options.
- **Banner** — blue-tinted info block only: `--blue-dim` bg, `--blue-line` border, `--r-lg`, leading 18px
  `--blue-strong` icon, `--t-small` body. No sage/red variant.
- **Other** — `.kv` read-only key/value rows; `.tablewrap` + `table.data` for the one real table (import
  preview); `.divider` = 1px `--hairline`; `.bulkrow` = the single-expense form in miniature.

### Icons (`src/components/Icons.tsx`)

- One set, one style: `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`, round caps/joins,
  `aria-hidden="true"`, `focusable="false"`.
- `stroke-width` 1.6 default; 2 for small/bold glyphs (Plus, Check, Close). Color always `currentColor`.
- Context sizes: 18 default · 20 nav tabs · 24 FAB · 14 inline in `.list__sub` / `.status` · 18 banner ·
  26 empty state · 40 large `.tone-good` mark.
- Extend this file in the same style — no icon library.

### Accessibility

- Global `:focus-visible` = `2px solid var(--blue)`, offset 2px, `--r-sm` radius. Never remove without a
  visible replacement.
- No color-only status — icon + label always.
- Tabular numerals on all figures.
- Keep motion driven by `--dur` so reduced-motion covers it.
- `--text-tertiary` is contrast-tuned per theme — treat its value as load-bearing.
- Sheets: focus trap + focus restore to opener + `Escape` + body scroll lock.
- Visual-only meaningful elements get `role="img"` + `aria-label` (see `<Meter>`).
- Every swipe gesture has a button equivalent.
- Small pills keep a ~44px hit area via padding + negative margin (see `.toast__action`).

### Voice & copy

- **Facts, not verdicts. No exclamation marks.** "Trending $85 over", "$40 left this month", "$25.00 past
  budget", "5 expenses logged · $214.30".
- Terse, present tense, second person.
- Money always via the formatter; negative sign U+2212 `−`.
- Toasts confirm what happened + optionally the consequence (on the `detail` line).
- Invalid fields use `.stat__note.tone-over` with a plain-spoken reason; hints otherwise stay quiet.

### Hard don'ts

- No blur / glass / gloss / neon / glow / heavy drop-shadows / ambient or decorative motion.
- No filled red button; no saturated red anywhere.
- No `<select>` for category — always the `.chiprow` chip row.
- No color-only status.
- No raw number / `$` string concatenation for money — always `formatMoney` / `<Money>` /
  `useMoneyFormatter`; negative sign is `−` (U+2212).
- No fourth functional hue.
- No new easing curve or ad-hoc animation duration beyond the sanctioned set.
- Don't remove focus outlines. Don't retune `--text-tertiary`.
- Don't show split / recurring fields by default — keep them behind the "+" disclosure.
- Don't use a category color as anything but an 8px dot or a breakdown-bar fill.
- Don't add a shadow to a card, sheet, or list row — separate with `--hairline`.
- Don't introduce a second modal / dialog primitive — `<Sheet>` is the create/edit/confirm container.

Full reference: `docs/design-guidelines.md`.
