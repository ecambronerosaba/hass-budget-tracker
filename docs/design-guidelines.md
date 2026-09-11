# Design guidelines

The visual system for Budget Tracker. Everything here is extracted from the code — `src/styles/tokens.css`,
`src/styles/app.css`, `src/components/ui.tsx`, `src/components/Icons.tsx`, `src/App.tsx`, the two expense
sheets, and `src/data/seed.ts` — plus the "Accessibility and design notes" section of the README. Values are
quoted from those files; `file:line` references point at the definition.

If you are changing UI, read this first. The condensed version lives in `CLAUDE.md` under `## Design`.

---

## 1. Philosophy — the non-negotiables

From the header comment of `src/styles/tokens.css:1` and the README design notes:

- **Scandinavian minimal, dark-mode-first.** Dark is the designed-for theme. Light mode is an explicit
  "stretch goal, same restrained philosophy" (`tokens.css:82`) — it must not grow its own look.
- **Flat, matte surfaces.** No blur, no gloss, no gradients-as-chrome, no glass, no glow. Elevation is two
  barely-there shadows and nothing else (`tokens.css:77`).
- **Functional color is three hues only:** blue (primary / neutral / info), sage (on track / good),
  soft desaturated red (off track / danger). *Everything else is gray.* There is no fourth functional hue.
- **Category dots do no functional work.** They are muted natural tones used only as 8px dots.
- **Copy states facts, not verdicts.** "Trending $85 over", never an exclamation mark.
- **Local-first, no account, no network.** Runs as a Home Assistant add-on or standalone — see the README's
  "Two deployments, one build".
- **Mobile-first.** Design and QA viewport is 430×932 (`scripts/*.mjs`). The layout scales up to a centered
  ~680px column; sheets cap at 520px and become centered dialogs at ≥640px.
- **Every gesture is also a button.** The reconcile swipe card is the only animated affordance in the app,
  and every swipe it handles has an equivalent tappable button (`.deck__actions`).
- **Status is never carried by color alone** — every state pairs color + icon + written label
  (`StatusPill`, `ui.tsx:75`).
- **`prefers-reduced-motion` is respected** — `--dur` collapses to `0ms` (`tokens.css:117`).

---

## 2. Token reference

All tokens are CSS custom properties defined on `:root` / `:root[data-theme='dark']` and overridden on
`:root[data-theme='light']` in `src/styles/tokens.css`. The theme is always set explicitly on
`<html data-theme>`, resolved from a per-browser preference (System / Dark / Light) in `src/lib/theme.ts` +
`src/state/useTheme.ts` — `localStorage`, never `AppSettings`, so it's never shared through the server-backed
repository the way the budget itself is. Default preference is `'system'`. There is no `@media
(prefers-color-scheme)` block in `tokens.css` itself — that resolution happens in JS (and, to avoid a flash
before the bundle loads, a duplicate of it inline in `index.html`) — the only media queries in tokens are
reduced-motion, and the 420 / 640 layout breakpoints in `app.css`.

Radii, spacing, the type scale, fonts, `--ease` and `--dur` are declared once on `:root` and shared by both
themes. Only surfaces, text, accents, `--track` and the two shadows change between light and dark.

### 2.1 Surfaces

| Token | Dark | Light | Role |
|---|---|---|---|
| `--bg` | `#141517` | `#f7f7f5` | app background — warm near-black, **never pure black** |
| `--surface` | `#1b1d20` | `#ffffff` | cards, sheets, list rows, stat tiles, swipe cards |
| `--surface-raised` | `#212429` | `#ffffff` | hover state, toasts, segmented active, quiet buttons |
| `--surface-sunken` | `#101113` | `#efefec` | inputs, chips, amount input, segmented track, bulk rows |
| `--hairline` | `#2a2e33` | `#e3e3df` | default 1px borders and dividers |
| `--hairline-strong` | `#363b41` | `#d2d2cd` | sheet grip handle, toast border, progress pips |

### 2.2 Text

| Token | Dark | Light | Role |
|---|---|---|---|
| `--text-primary` | `#eceef1` | `#1c1e20` | body and headings |
| `--text-secondary` | `#9aa2ab` | `#5c636a` | labels, muted copy, meter pace marker |
| `--text-tertiary` | `#858d95` | `#666c73` | hints, notes, timestamps, placeholders, section labels |
| `--text-inverse` | `#14161a` | `#ffffff` | text/icon on a blue fill (primary button, FAB, tab active is a color not a fill) |

`--text-tertiary` is **contrast-tuned per theme** and load-bearing. Dark `#858d95` is lightened from
`#6b737c` specifically to clear WCAG AA 4.5:1 against `--surface-raised`, the lightest dark surface it lands
on (`tokens.css:21`). Light `#666c73` is darkened from `#8b9198` to clear AA against `--surface-sunken`, the
darkest light surface (`tokens.css:93`). Do not darken (dark) or lighten (light) it casually.

### 2.3 Functional accents

Each hue has up to four roles: base, `-strong` (brighter/darker text-weight variant), `-dim` (~10–14%
alpha fill), `-line` (~30–32% alpha border). Only **blue** carries a `-line` token.

| Token | Dark | Light |
|---|---|---|
| `--blue` | `#7ba7d9` | `#3f74ad` |
| `--blue-strong` | `#9ac0ea` | `#2f5f95` |
| `--blue-dim` | `rgba(123,167,217,0.14)` | `rgba(63,116,173,0.1)` |
| `--blue-line` | `rgba(123,167,217,0.32)` | `rgba(63,116,173,0.3)` |
| `--sage` | `#93b58c` | `#5c8455` |
| `--sage-strong` | `#abcba4` | `#4a6f44` |
| `--sage-dim` | `rgba(147,181,140,0.14)` | `rgba(92,132,85,0.1)` |
| `--red` | `#cf8b84` | `#b0615a` |
| `--red-strong` | `#e3a49d` | `#964a44` |
| `--red-dim` | `rgba(207,139,132,0.14)` | `rgba(176,97,90,0.1)` |
| `--track` | `#262a2f` | `#e6e6e2` | unfilled meter / bar track |

There is **no `--sage-line` and no `--red-line`.** Where a sage or red tinted element needs a border, the
code uses an inline `rgba()` at ~0.24–0.30 alpha (`.status--good` `rgba(147,181,140,0.24)` `app.css:469`;
`.status--over` `rgba(207,139,132,0.26)` `app.css:481`; `.deck__hint--right` `rgba(147,181,140,0.3)`
`app.css:950`). If you find yourself needing a real sage/red line token more than once, add it to
`tokens.css` for both themes rather than scattering more alphas.

### 2.4 Radii

| Token | Value | Applied to |
|---|---|---|
| `--r-sm` | `8px` | `:focus-visible` outline radius, `.toast__action` |
| `--r-md` | `12px` | inputs, `.amount-input`, bulk rows, `.tablewrap` |
| `--r-lg` | `18px` | `.card`, `.banner`, `.statgrid` |
| `--r-xl` | `26px` | `.sheet`, `.deck__card` |
| `--r-pill` | `999px` | buttons, chips, status pills, meters, FAB, toasts, segmented, dots |

### 2.5 Spacing (8px base)

| Token | Value | Token | Value |
|---|---|---|---|
| `--s-1` | `4px` | `--s-5` | `24px` |
| `--s-2` | `8px` | `--s-6` | `32px` |
| `--s-3` | `12px` | `--s-7` | `48px` |
| `--s-4` | `16px` | `--s-8` | `64px` |

Conventions: card padding `--s-5` (`app.css:206`); list-row padding `13px var(--s-4)` (`app.css:671`); sheet
padding `--s-5` all round plus safe-area at the bottom (`app.css:797`); empty state `--s-7` vertical
(`app.css:753`). `.stack` sets vertical rhythm through a `--gap` custom property, default `--s-4`
(`app.css:219`).

### 2.6 Type

| Token | Value | Notes |
|---|---|---|
| `--font` | `-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif` | body font |
| `--font-num` | `ui-monospace, 'SF Mono', 'JetBrains Mono', 'Roboto Mono', Menlo, Consolas, monospace` | **all money and figures** |
| `--t-display` | `44px` | dashboard headline (`.headline__value`); drops to `38px` under 420px |
| `--t-title` | `26px` | sheet titles, "All expenses" total |
| `--t-heading` | `18px` | topbar month label, swipe card description |
| `--t-body` | `15px` | base `body` size, buttons, list titles |
| `--t-small` | `13px` | field labels, sub-lines, chips, segmented, table cells |
| `--t-micro` | `11px` | uppercase micro-labels, tab labels, meter legend, `.stat__note` |

Body line-height is `1.5`, `-webkit-font-smoothing: antialiased`, `text-rendering: optimizeLegibility`
(`app.css:17`).

### 2.7 Motion

| Token | Value | Use |
|---|---|---|
| `--ease` | `cubic-bezier(0.32, 0.72, 0, 1)` | the one easing curve — use it for every transition |
| `--dur` | `220ms` | the standard duration; collapses to `0ms` under `prefers-reduced-motion` |

Durations other than `--dur` that exist in `app.css`, each deliberate and scoped:

- `400ms` — meter fill and category-bar `width` fills (`app.css:540`, `:650`).
- `260ms` — `toast-in` keyframe (`app.css:861`).
- `120ms` — button press `transform` only (`app.css:269`).
- `90ms linear` — `.deck__hint` opacity, the one place `linear` is used, for a hint that must track the drag
  with no perceptible lag (`app.css:936`).

Treat `--dur` + `--ease` as the default for anything new. The values above are the complete set of sanctioned
exceptions — do not invent more, and do not add a second easing curve.

### 2.8 Elevation

| Token | Dark | Light |
|---|---|---|
| `--shadow-card` | `0 1px 2px rgba(0,0,0,0.32)` | `0 1px 2px rgba(20,22,26,0.06)` |
| `--shadow-float` | `0 6px 20px rgba(0,0,0,0.45)` | `0 6px 20px rgba(20,22,26,0.12)` |

`--shadow-card` is for the swipe card only. `--shadow-float` is for things that genuinely float above the
page: the FAB and toasts. Cards, sheets and list rows have **no shadow** — they are separated by `--hairline`
instead. No other shadow values anywhere.

---

## 3. Typography rules

- **All money and every numeric figure** render in `--font-num` with `font-variant-numeric: tabular-nums`.
  The `.num` class (`app.css:69`) is the carrier; it also sets `font-feature-settings: 'tnum' 1` and a small
  `letter-spacing: -0.01em`. `<Money>` and `<ExpenseAmount>` (`ui.tsx:12`, `:31`) apply it for you.
- **Never raw-concatenate a currency string.** Always go through `formatMoney` / the `useMoneyFormatter`
  hook / `<Money>` (`src/lib/money.ts:58`). Options: `compact` (drop `.00` on whole values — quieter in big
  display numbers), `signed` (force a leading sign). The negative and signed sign is U+2212 `−`, not a
  hyphen (`money.ts:63`).
- **Negative letter-spacing on large text:** display `-0.03em` (`.headline__value` `app.css:516`,
  `.txn__amount` `app.css:963`), sheet title `-0.02em` (`app.css:820`), topbar title `-0.015em`
  (`app.css:127`), amount input `-0.02em` (`app.css:409`), `.stat__value` `-0.02em` (`app.css:605`).
- **Micro-labels** — `.section-label`, `.stat__label`, `table.data th` — are `--t-micro`,
  `text-transform: uppercase`, `letter-spacing: 0.07–0.09em`, `font-weight: 600`, colored `--text-tertiary`.
- **Weights:** button text `550` (`app.css:266`); headings, titles, stat values `600`; `.list__amount` and
  `.linkish` `550`; field labels `500`.
- **The amount input is deliberately oversized** (`.amount-input` `app.css:380`): the number is `30px` /
  weight `600` / mono / `-0.02em`, with a `--text-tertiary` `$` symbol at `22px`, baseline-aligned to the
  number. It focuses on a `:focus-within` border change to `--blue-line` — no outline. This is the one input
  that shouts.
- The **bulk** amount field (`.amount-input--sm` `app.css:1137`) is `17px` / weight `500` / `16px` symbol —
  "a row of these shouldn't shout".

---

## 4. Color usage rules

### 4.1 The three functional hues, and where each is allowed

**Blue (`--blue*`)** — primary buttons (`.btn--primary`), the active nav tab (`.tab[aria-current]`), the FAB,
inline text actions (`.linkish`), info banners (`.banner`) and info pills (`.status--info`), the default
meter fill, a pressed category chip (`.chip[aria-pressed='true']`), the left swipe hint, progress pips
(`.pip--done`), and the global focus outline.

**Sage (`--sage*`)** — the on-track meter fill (`.meter__fill--good`), the "good" status pill
(`.status--good`, `IconCheck`), the large positive confirmation mark (`.tone-good svg`, 40px), the right
swipe hint (`.deck__hint--right`). Sage means "on track / confirmed", never a call to action.

**Red (`--red*`)** — over budget, off track, and destructive actions. Always the desaturated `--red*`
tokens; **never a pure or saturated red.** Uses: the over-budget meter fill (`.meter__fill--over`), the
"over" status pill (`.status--over`, `IconTrendUp`), inline validation notes (`.stat__note.tone-over`), and
the destructive button.

**Danger buttons are ghost, never filled.** `.btn--danger` (`app.css:299`) is `background: transparent`,
`color: var(--red-strong)`, `border-color: var(--red-dim)`. There is no filled red button in the app and
there must not be one.

### 4.2 Tint recipe

For a tinted pill / banner / hint: fill with the hue's `-dim` (~10–14% alpha), border with `-line` (blue) or
an inline ~0.24–0.30 alpha of the base color (sage / red), and set text and icon in `-strong`. See
`.banner` (`app.css:1007`), `.status--*` (`app.css:466`), `.chip--on` (`app.css:433`).

### 4.3 Category dots

Category colors live in `src/data/seed.ts`: `#93b58c` sage, `#c99274` clay, `#7ba7d9` blue, `#9a93c4`
lavender, `#c98fa8` rose, `#6fa8a0` teal, `#c6b27e` sand, `#8a9199` gray (the `DEFAULT_CATEGORIES` set; the
user-facing `CATEGORY_PALETTE` adds four more muted tones). They are used **only** as:

- the 8px `.dot` on a list row and `.chip__dot` on a category chip (`app.css:744`, `:440`),
- the fill of a category breakdown bar (`.catbar__fill`) and the stacked share bar in `CategoryBreakdown.tsx`.

Never as a large background fill, a text color, or anything that carries state. A missing category color falls
back to `--text-tertiary`.

---

## 5. Layout and app shell

Defined in `src/App.tsx` and the `.app*` rules of `app.css`.

- **Sticky topbar** (`.topbar` `app.css:105`): `--bg` background, 1px `--hairline` bottom border, `z-index: 20`.
  Inner row is capped at 680px and centered, padding `var(--s-3) var(--s-4)`. Left: month label
  (`.topbar__title`, `--t-heading`, 600, `-0.015em`) over a status sub-line (`.topbar__sub`, `--t-small`,
  `--text-tertiary`) reading **"In progress"** (current month), **"Open"** (a past open month), or **"Closed"**
  (reconciled) — `App.tsx:69`. Right: `‹` / `›` ghost `btn--sm` buttons to change month; **`›` is disabled
  once `activeMonthId >= currentMonthId()`** (`App.tsx:83`).
- **Main column** (`.app__main` `app.css:97`): `max-width: 680px`, centered, `padding: var(--s-5) var(--s-4) 132px`.
  The large bottom pad clears the fixed tabbar and the FAB. Under `max-width: 420px` the side padding tightens
  to `--s-3` and the dashboard headline shrinks to `38px` (`app.css:1091`).
- **Fixed bottom tab bar** (`.tabbar` / `.tabbar__inner` / `.tab` `app.css:135`): fixed, `z-index: 30`,
  `--bg` background with a 1px `--hairline` top border, `padding-bottom: env(safe-area-inset-bottom)`. Inner is
  a `grid` of `repeat(5, 1fr)`, capped at 680px. Each tab is a column: 20px icon over an `--t-micro` label at
  `letter-spacing: 0.02em`. Inactive `--text-tertiary`; the active tab is `--blue` and carries
  `aria-current="page"`. Tabs in order: **Month, Expenses, Reconcile, History, Settings** (`App.tsx:22`).
- **FAB** (`.fab` `app.css:175`): fixed, `z-index: 35`, a 54px `--r-pill` `--blue` circle with a 24px
  `--text-inverse` `IconPlus`, `--shadow-float`, `:active { transform: scale(0.94) }`. `bottom` is
  `calc(76px + env(safe-area-inset-bottom))`; `right` is `max(var(--s-4), calc(50vw - 340px + var(--s-4)))` so
  on wide screens it hugs the right edge of the 680 column instead of the viewport.
  **Rendered only when `month.status === 'open'` AND `screen !== 'reconcile'`** (`App.tsx:100`) — a closed
  month and the reconcile screen both hide it.
- **Breakpoints:** `640px` (sheets become centered dialogs, `app.css:781`/`:801`) and `420px` (column padding
  + headline size, `app.css:1091`). That is the whole set.
- **Safe area:** honored in the tabbar, the FAB, the sheet bottom padding, and the toast stack offset.

---

## 6. Components

### Card — `.card` (`app.css:202`)

`--surface` + 1px `--hairline` + `--r-lg` + `--s-5` padding. No shadow. `.card--flush` zeroes the padding and
adds `overflow: hidden` for an edge-to-edge list inside the card.

### Sheet — `<Sheet>` (`ui.tsx:122`, `.sheet` `app.css:788`)

The universal container for **create, edit and confirm**. There is no separate modal or dialog primitive.

- **Shape:** bottom sheet on mobile — `border-radius: var(--r-xl) var(--r-xl) 0 0`, `rise` keyframe
  (translateY 14px + fade). At `min-width: 640px` it becomes a fully-rounded centered dialog that only fades.
  `max-width: 520px`, `max-height: 92vh`, `overflow-y: auto`. Scrim is `rgba(8, 9, 10, 0.62)` (`app.css:774`).
- **Chrome:** a `.sheet__grip` handle (34×4, `--hairline-strong`), then a row with the title
  (`.sheet__title`, `--t-title`, 600, `-0.02em`) and a ghost icon close button (`btn btn--ghost btn--sm` with
  `IconClose`, `aria-label="Close"`). An optional `footer` prop renders below the body with `--s-5` top
  margin.
- **Behaviours (all in `ui.tsx`):** rendered through `createPortal` to `document.body`;
  `role="dialog"` + `aria-modal="true"` + `aria-label={title}`; focus trap on Tab / Shift+Tab; `Escape`
  closes; pointer-down on the scrim (not the sheet) closes; `document.body.style.overflow` is locked while
  open and restored on unmount; the element that had focus when the sheet opened is captured during render
  and **focus is restored to it on close**. If a field inside the sheet has `autoFocus`, the sheet does not
  steal focus back.

### Forms — `.field` / `.input` / `.select` / `.textarea` / `.amount-input` / `.chiprow`

- `<Field>` (`ui.tsx:255`) wraps a `.field__label` (`--t-small`, `--text-secondary`, weight 500), the
  control, and an optional hint rendered as `.stat__note` (`--t-micro`, `--text-tertiary`).
- `.input` / `.select` / `.textarea` (`app.css:335`): `--surface-sunken` background, 1px `--hairline`,
  `--r-md`, `11px 13px` padding, `appearance: none`. **On focus the border goes to `--blue-line`, the
  background lifts from sunken to `--surface`, and `outline: none`** — the sunken→surface shift is the focus
  signal. Placeholder text is `--text-tertiary`. `.textarea` is `min-height: 76px`, `resize: vertical`.
- **Category is always a tap-chip row** (`.chiprow` / `.chip` with `aria-pressed`, `app.css:413`), **never a
  `<select>`.** Inactive chip: `--surface-sunken`, `--hairline` border, `--text-secondary`. Pressed
  (`[aria-pressed='true']` or `.chip--on`): `--blue-line` border, `--blue-dim` background, `--text-primary`,
  with an 8px `.chip__dot` in the category color.
- **Progressive disclosure.** Exceptional fields are hidden behind a `.linkish` "+ …" toggle and are not
  shown by default:
  - split / reimbursement — `+ Split it — someone's paying me back` (`ExpenseSheet.tsx:284`),
  - recurring — `+ Make this recurring` (`ExpenseSheet.tsx:350`), only offered on the plain log path (not
    editing, not when a caller owns saving, not when the date points at a closed month).
  Each opens into a `.field` with a `Remove` link that collapses it again.
- **Primary add flow: amount → category chip → description → save.** The amount input is `autoFocus`
  (`ExpenseSheet.tsx:270`), fields follow in that order, and the primary button is a `btn--primary btn--block`
  at the end. Fewest taps. `BulkExpenseSheet` repeats the same shape per `.bulkrow`.

### Buttons — `.btn` (`app.css:258`)

- Base: pill, `11px 18px`, `--t-body`, weight `550`, `gap var(--s-2)`, `white-space: nowrap`, 1px
  transparent border. `:active:not(:disabled) { transform: scale(0.98) }`. `:disabled { opacity: 0.42 }`.
- Variants:
  - `--primary` — `--blue` background, `--text-inverse` text.
  - `--quiet` — `--surface-raised` background, `--text-primary`, `--hairline` border.
  - `--ghost` — transparent, `--text-secondary`, `--hairline` border.
  - `--danger` — transparent, `--red-strong` text, `--red-dim` border. **Never filled.**
- Modifiers: `--block` (full width — the default inside sheets), `--sm` (`7px 13px`, `--t-small`).
- `.linkish` (`app.css:314`) — `--blue`, `--t-small`, weight `550`, no background — for inline text actions
  and disclosure toggles.
- **Destructive confirm is two-step in place, no second modal.** The delete button relabels itself:
  `Delete expense` → `Tap again to delete`, and only the second tap deletes (`ExpenseSheet.tsx:455`).

### Toasts — `<Toasts>` (`ui.tsx:225`, `.toast` `app.css:854`)

- Bottom-center stack, `bottom: calc(140px + env(safe-area-inset-bottom))` (above the tabbar), `z-index: 60`.
  Each toast: `--surface-raised` background, 1px `--hairline-strong`, `--r-pill`, `--shadow-float`, `10px 18px`,
  `--t-small`, `toast-in` (translateY 8px + fade, 260ms).
- Container is `role="status"` + `aria-live="polite"` and `pointer-events: none`; a toast that carries an
  action re-enables `pointer-events: auto` on itself so the button is hittable.
- Optional **single** action — the canonical case is **Undo** after a destructive change. Styled
  `.toast__action`: `--blue-strong`, weight 600, with padding + matching negative margin so the hit area is
  comfortable without visually enlarging the pill.
- Message model: `message` (a fact) + optional `detail` line (rendered `.dim`) + optional `tone`
  (`good` / `over` / `neutral`). Toasts confirm what happened and, optionally, the consequence
  ("$40 left this month").

### Meter — `<Meter>` (`ui.tsx:91`, `.meter` `app.css:524`)

- 10px `--r-pill` track (`--track`) with an absolutely-positioned `.meter__fill`: `--blue` by default,
  `.meter__fill--good` sage, `.meter__fill--over` red. Width transitions `400ms var(--ease)`.
- A 2px `--text-secondary` **pace marker** (`.meter__marker`, `top/bottom: -3px` so it overhangs) shows
  where an even spend rate would put you today; it carries `title="Today, at an even pace"`.
- The whole meter is `role="img"` with a descriptive `aria-label` passed in by the caller.
- `.meter-legend` sits beneath: `--t-micro`, `--text-tertiary`, `justify-content: space-between`.
- Category bars (`.catbar` `app.css:613`): a 6px track, name (ellipsised) + amount above it, fill colored by
  the category dot color.

### StatusPill — `<StatusPill tone>` (`ui.tsx:79`, `.status` `app.css:449`)

- Pill = tinted `-dim` background + tinted border + `-strong` text + a 14px icon + a written label.
- Tones: `good` → `IconCheck` / sage; `over` → `IconTrendUp` / red; `info` → `IconInfo` / blue.
- **Never render a tone without its icon and label.** The component hard-codes the icon per tone so this
  cannot be bypassed.

### Lists — `.list` / `.list__item` (`app.css:662`)

- Each row is a full-width `<button>`: leading 8px category `.dot`, a `.list__main` block (`.list__title`
  with ellipsis + a `.list__sub` line), and a trailing `.list__amount`.
- **The trailing amount is the net** — what the month actually cost (`<ExpenseAmount>` uses `netAmount`,
  `ui.tsx:31`). Gross is detail only. `--font-num`, weight `550`.
- `.list__sub` (`--t-small`, `--text-tertiary`): wraps **between** pieces, never inside one
  (`.list__sub > * { white-space: nowrap }`). It carries inline 14px status glyphs (recurring / imported /
  matched) and a `<SplitNote>` reading `$175.00 − $150.00 back` (`ui.tsx:44`).
- `button.list__item:hover` raises the row background to `--surface-raised`.
- `.list__group-head` (`app.css:734`) is the date-group header — `--t-small`, `--text-tertiary`,
  space-between, `--surface` background.

### Stat grid — `.statgrid` / `.stat` (`app.css:569`)

- `grid-template-columns: repeat(auto-fit, minmax(140px, 1fr))`, `gap: 1px` over a `--hairline` background
  with a `--hairline` border and `--r-lg` + `overflow: hidden` — so tiles are divided by hairlines, not gaps.
- A lone final odd tile spans the full width: `.statgrid > .stat:last-child:nth-child(odd) { grid-column: 1 / -1 }`.
- `.stat` = `--surface`, `--s-4` padding, a `.stat__label` (`--t-micro` uppercase, `0.08em`, 600,
  `--text-tertiary`) + a `.stat__value` (`21px`, 600, `-0.02em`) + an optional `.stat__note` (`--t-micro`,
  `--text-tertiary`).

### Swipe cards — `.deck` / `.deck__card` (`app.css:893`) — reconcile only

- 340px-tall `.deck` with `touch-action: pan-y`. `.deck__card` = `--surface` + `--hairline` + `--r-xl` +
  `--shadow-card`. The top card is `.deck__card--top` (`cursor: grab` → `grabbing` on `:active`); the card
  behind is `.deck__card--behind` at `opacity: 0.55`.
- The card follows the finger and springs back if released before the threshold.
- Hint pills (`.deck__hint`, opacity-only, `90ms linear`): `.deck__hint--left` is blue, `.deck__hint--right`
  is sage.
- `.deck__actions` is a 2-column button grid — the tap-equivalent for both swipe directions.
- `.progress-pips` / `.pip` / `.pip--done` show position in the queue.

### Empty state — `<EmptyState>` (`ui.tsx:304`, `.empty` `app.css:751`)

Centered column, `--s-7` vertical padding. Optional icon at 26px / `opacity: 0.5`. A `--text-secondary`
title over `--text-tertiary` body text (`--t-small`).

### Segmented — `<Segmented>` (`ui.tsx:277`, `.segmented` `app.css:1063`)

Pill track: `--surface-sunken` + `--hairline`, `3px` padding, `2px` gap. Buttons are `--t-small`,
`--text-secondary` when inactive; the active one carries `aria-pressed` and gets `--surface-raised`
background + `--text-primary`. `role="group"` with an `aria-label`. For 2–3 mutually exclusive options only
(e.g. "By date" / "By amount").

### Banner — `.banner` (`app.css:1007`)

A blue-tinted info block: `--blue-dim` background, `--blue-line` border, `--r-lg`, `--s-4` padding, a leading
18px `--blue-strong` icon, `--t-small` body. Blue / informational only — there is no sage or red banner
variant.

### Other primitives

- `.kv` (`app.css:991`) — key/value rows, space-between, `--t-small`, hairline separators between rows. For
  read-only detail.
- `.tablewrap` + `table.data` (`app.css:1031`) — the one real table in the app (import preview): a
  horizontal-scroll wrapper with `--r-md` border, `--t-small` cells, uppercase `--t-micro` `th`.
- `.divider` — a 1px `--hairline` rule.
- `.bulkrow` (`app.css:1105`) — the single-expense form in miniature: a `--surface-sunken` box with
  `--hairline` border and `--r-md`, stacked fields, a small amount input, and a sticky bottom
  `.bulkrow__actions` bar ("N ready · $total" + a `btn--primary btn--block`).

---

## 7. Icons — `src/components/Icons.tsx`

- **One set, one style.** Every icon renders through the local `Svg` wrapper: `viewBox="0 0 24 24"`,
  `fill="none"`, `stroke="currentColor"`, `stroke-linecap` / `stroke-linejoin` `"round"`,
  `aria-hidden="true"`, `focusable="false"`.
- Default `stroke-width` is `1.6`; it is bumped to `2` for small or bold glyphs — `IconPlus`, `IconCheck`,
  `IconClose`.
- Color is always `currentColor` — an icon inherits the text or tone color of its context. Never hard-code an
  icon color.
- **Context sizes** (from `app.css`): 18px default (bare `svg {}`, `app.css:63`), 20px nav tabs, 24px FAB,
  14px inline in `.list__sub` and `.status`, 18px in `.banner`, 26px empty state, 40px for the large
  `.tone-good` confirmation mark.
- Icons in use: `Plus, Home, List, Reconcile, History, Settings, Check, Close, ArrowLeft, ArrowRight, Info,
  TrendUp, TrendDown, Repeat, Upload, Download, Edit, Trash, Wallet, Inbox, Link, Lock`. Add to this file in
  the same style rather than pulling in an icon library.

---

## 8. Accessibility checklist

From the README design notes and the code:

- **Focus is always visible.** `:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px;
  border-radius: var(--r-sm) }` is global (`app.css:52`). Never remove a focus outline without providing an
  equivalent visible replacement (inputs do this — they drop the outline but shift sunken→surface + border).
- **No color-only status.** Every state is color + icon + label. `StatusPill` enforces it; follow the same
  rule anywhere you signal good / over / info.
- **Tabular numerals** on all figures so columns of money line up (`.num`).
- **Reduced motion:** `@media (prefers-reduced-motion: reduce)` sets `--dur: 0ms`. Keep new motion driven by
  `--dur` (or a transition that reads it) so it is covered automatically.
- **`--text-tertiary` is contrast-tuned per theme** to clear WCAG AA 4.5:1 against the worst-case surface in
  that theme. Treat its value as load-bearing; re-tuning it is a contrast regression.
- **Sheet focus management:** focus trap + focus restore to the opener + `Escape` + body scroll lock
  (`ui.tsx:151`).
- **Meaningful visual-only elements get `role="img"` + `aria-label`** — see `<Meter>`.
- **Gesture ↔ button parity:** every reconcile swipe has a button in `.deck__actions`. Any new gesture needs
  the same.
- **Hit areas:** small pills get padding plus a negative margin so the tap target stays ~44px without the
  pill growing — see `.toast__action` (`app.css:870`). Bulk row remove / add buttons carry explicit
  `aria-label`s with the row number.

---

## 9. Voice and copy

- **Facts, not verdicts. No exclamation marks.** "Trending $85 over", "$40 left this month", "$25.00 past
  budget", "5 expenses logged · $214.30".
- Terse, present tense, second person.
- Money always through the formatter; the negative sign is U+2212 `−`, never `-`.
- A toast confirms **what happened**, then optionally **the consequence** on its `detail` line
  ("$40 left this month" / "$25.00 past budget").
- Field hints are quiet guidance, not warnings, unless the field is actually invalid — invalid state uses
  `.stat__note.tone-over` with a plain-spoken reason ("Enter an amount above zero.",
  "That's more than the charge itself — a reimbursement can't exceed what you paid.").
- Titles state where you are and track live state — "Log to March 2026", "Edit expense", "View expense"
  (a closed month), "Add several to March 2026".

---

## 10. Hard don'ts

- No blur, glass, gloss, neon, glow, heavy drop-shadows, or ambient / decorative motion.
- No filled red button; no saturated red anywhere. Danger is `.btn--danger` (ghost).
- No `<select>` for category — always the `.chiprow` chip row.
- No color-only status — always icon + label with it.
- No raw number or `$` string concatenation for money — always `formatMoney` / `<Money>` /
  `useMoneyFormatter`. Negative sign is `−` (U+2212).
- No fourth functional hue. Blue, sage, red, and gray — that is the whole palette.
- No new easing curve, and no new animation duration beyond the sanctioned set (§2.7).
- Don't remove focus outlines. Don't retune `--text-tertiary`.
- Don't show split or recurring fields by default — keep them behind the `+` disclosure link.
- Don't use a category color as anything other than an 8px dot or a breakdown-bar fill.
- Don't add a shadow to a card, sheet, or list row — separate with `--hairline`.
- Don't introduce a second modal / dialog primitive — `<Sheet>` is the create/edit/confirm container.
