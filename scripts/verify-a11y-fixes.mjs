/**
 * Verifies the design-system/a11y fixes: icon sizing, Sheet focus
 * management, .list__title truncation, --text-tertiary contrast, and the
 * Toast action button. Run against two running previews:
 *   BEFORE=http://localhost:4203 (unfixed)  AFTER=http://localhost:4202 (fixed)
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

// This container runs other agents' background processes too — a
// vite-preview left running via `&` reliably gets reaped between (or even
// mid-) tool calls. So this script owns its preview servers end-to-end:
// spawns them, waits for readiness, runs everything, then kills them.
const BEFORE_DIR = process.argv[2] ?? '/tmp/budget-tracker-before';
const AFTER_DIR = process.argv[3] ?? '/home/claude/budget-tracker';
const BEFORE_PORT = 4213;
const AFTER_PORT = 4212;
const BEFORE = `http://localhost:${BEFORE_PORT}`;
const AFTER = `http://localhost:${AFTER_PORT}`;

function startPreview(dir, port) {
  const child = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
    cwd: dir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  return child;
}

async function waitForServer(url, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Server at ${url} did not come up within ${timeoutMs}ms`);
}

const beforeServer = startPreview(BEFORE_DIR, BEFORE_PORT);
const afterServer = startPreview(AFTER_DIR, AFTER_PORT);
await Promise.all([waitForServer(BEFORE), waitForServer(AFTER)]);
console.log(`before server up at ${BEFORE}, after server up at ${AFTER}`);

const shots = 'screenshots/verify';
mkdirSync(shots, { recursive: true });

const EXECUTABLE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: EXECUTABLE });

const log = (...args) => console.log(...args);
const results = { pass: [], fail: [] };
const check = (name, cond, detail) => {
  if (cond) {
    results.pass.push(name);
    log(`  PASS  ${name}${detail ? ' — ' + detail : ''}`);
  } else {
    results.fail.push(name);
    log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
  }
};

async function newPageAt(base, opts = {}) {
  const page = await browser.newPage({
    viewport: { width: 430, height: 932 },
    deviceScaleFactor: 2,
    ...opts,
  });
  await page.goto(base);
  await page.getByRole('button', { name: 'Set budget' }).waitFor();
  return page;
}

async function setBudgetAndAddExpense(page, description) {
  await page.getByRole('button', { name: 'Set budget' }).click();
  await page.getByLabel('Monthly budget total').fill('2400');
  await page.locator('.sheet').getByRole('button', { name: 'Set budget' }).click();
  await page.getByText('Left this month').waitFor();

  await page.getByRole('button', { name: 'Log an expense' }).click();
  await page.locator('#expense-amount').fill('12.50');
  await page.locator('#expense-description').fill(description);
  await page.locator('#expense-date').fill('2026-09-01');
  await page.locator('.sheet').getByRole('button', { name: 'Groceries', exact: true }).click();
  await page.locator('.sheet').getByRole('button', { name: 'Save expense' }).click();
  await page.locator('.sheet').waitFor({ state: 'detached' });
}

/* ===================== 1. Close "x" bounding box ===================== */
async function measureClose(base, label) {
  const page = await newPageAt(base);
  await page.getByRole('button', { name: 'Set budget' }).click();
  await page.locator('.sheet').waitFor();
  const box = await page.getByRole('button', { name: 'Close' }).boundingBox();
  log(`[${label}] Close button bbox:`, box);
  await page.close();
  return box;
}

/* ===================== 2. Sheet focus trap + restore ===================== */
async function checkFocusTrap(base, label) {
  const page = await newPageAt(base);
  // Icon-only FAB: identified by aria-label, so give it an id we can match
  // document.activeElement against (it has no distinguishing text content).
  await page.evaluate(() => {
    const fab = document.querySelector('.fab');
    if (fab) fab.id = 'verify-trigger';
  });
  const trigger = page.getByRole('button', { name: 'Log an expense' });
  await trigger.focus();
  await trigger.click();
  await page.locator('.sheet').waitFor();

  // autoFocus preserved: the amount field should hold focus, not be
  // stolen by a "first focusable element" query.
  const autoFocusOk = await page.evaluate(() => document.activeElement?.id === 'expense-amount');
  check(`[${label}] autoFocus respected on open`, autoFocusOk, `activeElement.id=${await page.evaluate(() => document.activeElement?.id)}`);

  // Tab through the whole sheet several times over; focus should never
  // leave it (e.g. never land on the FAB or a tab-bar button behind it).
  let escaped = false;
  const sheetFocusableCount = await page.locator('.sheet').locator('input,select,textarea,button,a[href]').count();
  for (let i = 0; i < sheetFocusableCount * 3 + 5; i++) {
    await page.keyboard.press('Tab');
    const inside = await page.evaluate(() => {
      const sheet = document.querySelector('.sheet');
      return !!sheet && sheet.contains(document.activeElement);
    });
    if (!inside) {
      escaped = true;
      break;
    }
  }
  check(`[${label}] Tab never escapes the open sheet`, !escaped);

  // Shift+Tab from the first item should wrap to the last, not escape either.
  await page.evaluate(() => {
    const sheet = document.querySelector('.sheet');
    const first = sheet.querySelector('input,select,textarea,button,a[href]');
    first?.focus();
  });
  await page.keyboard.press('Shift+Tab');
  const wrappedInside = await page.evaluate(() => {
    const sheet = document.querySelector('.sheet');
    return !!sheet && sheet.contains(document.activeElement);
  });
  check(`[${label}] Shift+Tab from first item wraps inside the sheet`, wrappedInside);

  // Close via the close button; focus should return to the trigger.
  await page.locator('.sheet').getByRole('button', { name: 'Close' }).click();
  await page.locator('.sheet').waitFor({ state: 'detached' });
  const activeId = await page.evaluate(() => document.activeElement?.id ?? '');
  const activeTag = await page.evaluate(() => document.activeElement?.tagName ?? '');
  check(
    `[${label}] focus returns to the trigger on close`,
    activeId === 'verify-trigger',
    `activeElement=<${activeTag} id="${activeId}">`,
  );

  await page.close();
}

/* ===================== 3. list__title truncation ===================== */
async function checkTruncation(base, label) {
  const page = await newPageAt(base);
  const longDesc =
    'A genuinely extremely long sixty-character merchant description here!!';
  await setBudgetAndAddExpense(page, longDesc);
  await page.locator('.tab', { hasText: 'Expenses' }).click();
  const row = page.locator('.list__item', { hasText: 'A genuinely extremely long' });
  await row.waitFor();

  const rowBox = await row.boundingBox();
  const titleBox = await row.locator('.list__title').boundingBox();
  const amountBox = await row.locator('.list__amount').boundingBox();

  const titleFitsRow = titleBox.width <= rowBox.width + 0.5;
  const noOverlapWithAmount = titleBox.x + titleBox.width <= amountBox.x + 0.5;
  const scrollWidth = await row.locator('.list__title').evaluate((el) => el.scrollWidth);
  const isActuallyTruncated = scrollWidth > titleBox.width + 1;

  log(`[${label}] row width=${rowBox.width.toFixed(1)} title width=${titleBox.width.toFixed(1)} title scrollWidth=${scrollWidth} amount.x=${amountBox.x.toFixed(1)}`);
  check(`[${label}] long title does not overflow the row`, titleFitsRow);
  check(`[${label}] long title does not overlap the amount`, noOverlapWithAmount);
  check(`[${label}] long title is actually truncated (ellipsis engaged)`, isActuallyTruncated);

  await page.close();
}

/* ===================== 4. Icon sizing sanity sweep ===================== */
async function checkIconSizes(base, label) {
  const page = await newPageAt(base);
  await setBudgetAndAddExpense(page, 'Coffee run');

  // Close icon inside a freshly-opened sheet.
  await page.getByRole('button', { name: 'Log an expense' }).click();
  await page.locator('.sheet').waitFor();
  const closeSvg = await page.locator('.sheet .btn--ghost svg').boundingBox();
  check(`[${label}] Close icon is a real, non-zero size`, closeSvg && closeSvg.width > 4 && closeSvg.height > 4, JSON.stringify(closeSvg));
  check(`[${label}] Close icon is not absurdly oversized`, closeSvg && closeSvg.width < 40 && closeSvg.height < 40, JSON.stringify(closeSvg));
  await page.locator('.sheet').getByRole('button', { name: 'Close' }).click();
  await page.locator('.sheet').waitFor({ state: 'detached' });

  // Export/Restore icons in Settings.
  await page.locator('.tab', { hasText: 'Settings' }).click();
  const exportSvg = await page.locator('button:has-text("Export") svg').first().boundingBox();
  check(`[${label}] Export icon is sane (<=32px)`, exportSvg && exportSvg.width <= 32 && exportSvg.width > 4, JSON.stringify(exportSvg));

  await page.close();
}

/* ===================== 5. Toast action button ===================== */
async function checkToastAction(base, label) {
  const page = await newPageAt(base);
  await setBudgetAndAddExpense(page, 'Undo-able expense');
  await page.locator('.tab', { hasText: 'Expenses' }).click();
  const row = page.locator('.list__item', { hasText: 'Undo-able expense' });
  await row.waitFor();
  await row.click();
  await page.locator('.sheet').waitFor();

  // "Delete expense" -> tap again to confirm ("Tap again to delete"), which
  // triggers store.deleteExpense's Undo-offering toast.
  const deleteBtn = page.locator('.sheet .btn--danger');
  await deleteBtn.click();
  await deleteBtn.click();
  // deleteExpense's own notify (with the Undo action) fires first; a second,
  // plain "Expense removed" toast follows right after from the sheet's own
  // handler — take the first one specifically, since that's the one that
  // carries the action.
  const removedToast = page.locator('.toast', { hasText: 'Expense removed' }).first();
  await removedToast.waitFor({ timeout: 3000 });

  const toastAction = removedToast.locator('.toast__action');
  const has = await toastAction.count();
  check(`[${label}] toast renders an action button for an undo-able toast`, has > 0);
  if (has > 0) {
    check(`[${label}] toast action label reads "Undo"`, (await toastAction.first().innerText()) === 'Undo');
    const box = await toastAction.first().boundingBox();
    check(`[${label}] toast action button is comfortably tappable (>=24px tall)`, box && box.height >= 24, JSON.stringify(box));

    // The row should be gone (deleted); clicking Undo should bring it back
    // and dismiss the toast — proving both the run() call and dismissToast.
    await page.locator('.tab', { hasText: 'Expenses' }).click();
    const goneAfterDelete = (await page.locator('.list__item', { hasText: 'Undo-able expense' }).count()) === 0;
    check(`[${label}] expense row is gone right after delete`, goneAfterDelete);

    await toastAction.first().click();
    await removedToast.waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
    check(`[${label}] clicking the toast action dismisses that toast`, (await removedToast.count()) === 0);
    await page.waitForTimeout(300);
    const backAfterUndo = (await page.locator('.list__item', { hasText: 'Undo-able expense' }).count()) > 0;
    check(`[${label}] clicking Undo actually restores the deleted expense`, backAfterUndo);
  }
  await page.close();
}

/* ===================== 6. Screenshots at two widths, two themes ===================== */
// This container is memory-constrained and shared with other agents' work;
// each shot gets its own fresh browser (not just a fresh page) and any
// single failure is caught and logged rather than aborting the whole sweep.
async function screenshotOne(base, label, theme, width) {
  let localBrowser;
  try {
    localBrowser = await chromium.launch({ executablePath: EXECUTABLE });
    const page = await localBrowser.newPage({
      viewport: { width, height: width === 430 ? 932 : 900 },
      deviceScaleFactor: width === 430 ? 2 : 1,
    });
    await page.goto(base, { timeout: 15000 });
    await page.getByRole('button', { name: 'Set budget' }).waitFor();
    await page.getByRole('button', { name: 'Set budget' }).click();
    await page.getByLabel('Monthly budget total').fill('2400');
    await page.locator('.sheet').getByRole('button', { name: 'Set budget' }).click();
    await page.getByText('Left this month').waitFor();
    if (theme === 'light') {
      await page.locator('.tab', { hasText: 'Settings' }).click();
      await page.getByRole('button', { name: 'Light' }).click();
      await page.locator('.tab', { hasText: 'Month' }).click();
    }
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${shots}/${label}-${theme}-${width}.png`, fullPage: true });

    // Settings screen is the icon-density stress case (Export/Restore/Repeat).
    await page.locator('.tab', { hasText: 'Settings' }).click();
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${shots}/${label}-${theme}-${width}-settings.png`, fullPage: true });
    log(`  shot ok: ${label}-${theme}-${width}`);
  } catch (err) {
    log(`  shot FAILED (non-fatal): ${label}-${theme}-${width}: ${err.message}`);
  } finally {
    await localBrowser?.close().catch(() => {});
  }
}

async function screenshotSweep(base, label) {
  for (const theme of ['dark', 'light']) {
    for (const width of [430, 1280]) {
      await screenshotOne(base, label, theme, width);
    }
  }
}

/* ============================== run ============================== */
try {
log('\n=== 1) Close button bounding box ===');
// (The <svg> icon inside is measured separately in section 4 — that's
// where "0x0" / "74px" actually show up; the <button> itself still has a
// little padding-driven hit area even with a collapsed icon.)
const closeBefore = await measureClose(BEFORE, 'before');
const closeAfter = await measureClose(AFTER, 'after');
check('Close button after is a real tappable target (>=24px both axes)', closeAfter.width >= 24 && closeAfter.height >= 24, JSON.stringify(closeAfter));

log('\n=== 2) Sheet focus management (before, expected broken) ===');
await checkFocusTrap(BEFORE, 'before');
log('\n=== 2) Sheet focus management (after, expected fixed) ===');
await checkFocusTrap(AFTER, 'after');

log('\n=== 3) .list__title truncation (before, expected broken) ===');
await checkTruncation(BEFORE, 'before');
log('\n=== 3) .list__title truncation (after, expected fixed) ===');
await checkTruncation(AFTER, 'after');

log('\n=== 4) Icon sizing sweep ===');
await checkIconSizes(BEFORE, 'before');
await checkIconSizes(AFTER, 'after');

log('\n=== 5) Toast action button (after only — new feature) ===');
await checkToastAction(AFTER, 'after');

log('\n=== 6) Screenshots ===');
// Free up memory before the screenshot phase, which launches its own
// short-lived browsers per shot.
await browser.close();
await screenshotSweep(BEFORE, 'before');
await screenshotSweep(AFTER, 'after');

} finally {
  await browser.close().catch(() => {});
  beforeServer.kill();
  afterServer.kill();
}

writeFileSync(`${shots}/results.json`, JSON.stringify(results, null, 2));
log(`\n${results.pass.length} passed, ${results.fail.length} failed.`);
if (results.fail.length) {
  console.error('FAILED CHECKS:', results.fail);
  process.exit(1);
}
