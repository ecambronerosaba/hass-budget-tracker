/**
 * Independent integration check, run after all parallel work is merged.
 * Verifies the claims that matter across file boundaries, not per-agent.
 *   node scripts/verify-integration.mjs http://localhost:4210
 */
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:4210';
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const sheet = page.locator('.sheet');
const tab = (n) => page.locator('.tab', { hasText: new RegExp(`^${n}$`) });
let failed = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? '  ok  ' : 'FAIL  '}${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
};

await page.goto(base);
await page.getByRole('button', { name: 'Set budget' }).click();
await page.getByLabel('Monthly budget total').fill('2000');
await sheet.getByRole('button', { name: 'Set budget' }).click();
await page.getByText('Left this month').waitFor();

/* --- 1. the sheet Close button is a real target ------------------------ */
await page.getByRole('button', { name: 'Log an expense' }).click();
const closeBox = await sheet.getByRole('button', { name: 'Close' }).boundingBox();
check(
  closeBox.width >= 24 && closeBox.height >= 24,
  'sheet Close is tappable',
  `${Math.round(closeBox.width)}×${Math.round(closeBox.height)}px`,
);

/* --- 2. autoFocus survives, focus is trapped, and returns -------------- */
const focusedId = await page.evaluate(() => document.activeElement?.id);
check(focusedId === 'expense-amount', 'autoFocus not stolen by Close', `focus on #${focusedId}`);

for (let i = 0; i < 25; i += 1) await page.keyboard.press('Tab');
const trapped = await page.evaluate(() => !!document.activeElement?.closest('.sheet'));
check(trapped, 'Tab never escapes the open sheet');

await page.keyboard.press('Escape');
await sheet.waitFor({ state: 'detached' });
const returned = await page.evaluate(
  () => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName,
);
check(returned === 'Log an expense', 'focus returns to the trigger', `now on "${returned}"`);

/* --- 3. a long description does not overflow its row ------------------- */
await page.getByRole('button', { name: 'Log an expense' }).click();
await page.locator('#expense-amount').fill('12.34');
await page.locator('#expense-description').fill('SQ *THE VERY LONG MERCHANT NAME THAT WOULD OVERFLOW 998877');
await sheet.getByRole('button', { name: 'Save expense' }).click();
await sheet.waitFor({ state: 'detached' });
await tab('Expenses').click();
const overflow = await page.locator('.list__item').first().evaluate((row) => {
  const title = row.querySelector('.list__title');
  return { rowW: row.clientWidth, titleW: title.getBoundingClientRect().width };
});
check(
  overflow.titleW <= overflow.rowW,
  'long merchant name is contained',
  `title ${Math.round(overflow.titleW)}px in a ${overflow.rowW}px row`,
);

/* --- 4. tertiary text meets WCAG AA in both themes --------------------- */
const contrast = await page.evaluate(() => {
  const lum = (c) => {
    const [r, g, b] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map((v) => {
      const s = Number(v) / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const read = () => {
    const s = getComputedStyle(document.documentElement);
    const probe = document.createElement('div');
    probe.style.color = s.getPropertyValue('--text-tertiary');
    probe.style.background = s.getPropertyValue('--surface-raised');
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    const r = ratio(cs.color, cs.backgroundColor);
    probe.remove();
    return Math.round(r * 100) / 100;
  };
  const out = {};
  document.documentElement.dataset.theme = 'dark';
  out.dark = read();
  document.documentElement.dataset.theme = 'light';
  out.light = read();
  document.documentElement.dataset.theme = 'dark';
  return out;
});
check(contrast.dark >= 4.5, 'tertiary text passes AA in dark', `${contrast.dark}:1`);
check(contrast.light >= 4.5, 'tertiary text passes AA in light', `${contrast.light}:1`);

/* --- 5. undo restores a deleted expense -------------------------------- */
const before = await page.locator('.list__item').count();
await page.locator('.list__item').first().click();
await sheet.getByRole('button', { name: 'Delete expense' }).click();
await sheet.getByRole('button', { name: /Tap again/ }).click();
await sheet.waitFor({ state: 'detached' });
const afterDelete = await page.locator('.list__item').count();
await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
await page.waitForTimeout(500);
const afterUndo = await page.locator('.list__item').count();
check(
  afterDelete === before - 1 && afterUndo === before,
  'undo restores the deleted expense',
  `${before} → ${afterDelete} → ${afterUndo}`,
);

/* --- 6. preferences survive a reload ----------------------------------- */
await page.getByRole('button', { name: 'By amount' }).click();
await page.waitForTimeout(400);
await page.locator('.tab', { hasText: /^Month$/ }).click();
await page.getByRole('button', { name: 'Previous month' }).click();
await page.waitForTimeout(600);
const monthBefore = await page.locator('.topbar__title').innerText();

await page.reload();
await page.waitForTimeout(1200);
const monthAfter = await page.locator('.topbar__title').innerText();
check(monthAfter === monthBefore, 'the month you were viewing survives reload', monthAfter);

await tab('Expenses').click();
const sortPressed = await page
  .getByRole('button', { name: 'By amount' })
  .getAttribute('aria-pressed');
check(sortPressed === 'true', 'sort order survives reload');

await browser.close();
console.log(
  errors.length ? `\nConsole errors:\n${errors.join('\n')}` : '\nNo console errors.',
);
if (failed || errors.length) {
  console.log(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log('All integration checks passed.');
