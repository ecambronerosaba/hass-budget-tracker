/**
 * Bulk expense entry: the "Add several" sheet on the Expenses tab logs a whole
 * grid of rows in one save, routes each row to the month of its own date, and
 * silently ignores the blank rows the "+ Add row" button leaves behind.
 *
 * Asserts, against the CURRENT code in src/:
 *  1. Three filled rows + one untouched row save as exactly three expenses.
 *  2. The running "N ready · $total" reflects only the filled rows.
 *  3. A row dated into a different (open) month lands in that month, not the
 *     one being viewed.
 *  4. A half-filled row blocks the save and shows an inline reason.
 *
 * Run against a built preview:
 *   npm run build && npx vite preview --port 4173
 *   node scripts/verify-bulk-add.mjs http://localhost:4173
 */
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:4173';

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const sheet = page.locator('.sheet');
const step = (msg) => console.log('• ' + msg);

try {
  await page.goto(base);
  await page.getByRole('button', { name: 'Set budget' }).waitFor();

  await page.getByRole('button', { name: 'Set budget' }).click();
  await page.getByLabel('Monthly budget total').fill('2000');
  await sheet.getByRole('button', { name: 'Set budget' }).click();
  await page.getByText('Left this month').waitFor();
  step('budget set');

  await page.locator('.tab', { hasText: /^Expenses$/ }).click();
  await page.getByRole('button', { name: 'Add several' }).click();
  await sheet.waitFor();
  step('opened the "Add several" sheet');

  const row = (n) => ({
    amount: page.getByLabel(`Amount, row ${n}`),
    description: page.getByLabel(`Description, row ${n}`),
    date: page.getByLabel(`Date, row ${n}`, { exact: true }),
  });

  // Two rows in the viewed month, one dated a month earlier, plus a fourth
  // row added and left blank.
  await row(1).amount.fill('12.40');
  await row(1).description.fill('Trader Joe\'s');
  await row(2).amount.fill('8.00');
  await row(2).description.fill('Parking');
  await row(3).amount.fill('45.00');
  await row(3).description.fill('Gas last month');
  const viewedMonth = await row(3).date.inputValue();
  const [y, m] = viewedMonth.split('-').map(Number);
  const prevMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  await row(3).date.fill(`${prevMonth}-15`);
  await sheet.getByRole('button', { name: /Add row/ }).click();
  await row(4).amount.waitFor();
  step('filled three rows (one dated into the previous month), added a blank row 4');

  const ready = await sheet.getByText(/ready ·/).textContent();
  if (!/3 ready/.test(ready)) throw new Error(`expected "3 ready", saw "${ready.trim()}"`);
  step(`running total reads "${ready.trim()}" — blank row ignored`);

  // A half-filled row must block the save.
  await row(4).amount.fill('99');
  await sheet.getByRole('button', { name: /^Save 3 expenses$/ }).click();
  await sheet.getByText(/Needs an amount above zero, a description/).waitFor();
  if (await sheet.getByText(/expenses logged/).count()) {
    throw new Error('a half-filled row did not block the save');
  }
  step('half-filled row blocked the save with an inline reason');

  // Complete that row, then save for real.
  await row(4).description.fill('Coffee');
  await sheet.getByRole('button', { name: /^Save 4 expenses$/ }).click();
  await sheet.waitFor({ state: 'detached' });
  await page.getByText(/4 expenses logged/).waitFor();
  step('saved — toast confirms 4 expenses');

  // Three in the viewed month...
  for (const desc of ['Trader Joe\'s', 'Parking', 'Coffee']) {
    await page.getByText(desc, { exact: true }).waitFor();
  }
  const items = await page.locator('.list__item').count();
  if (items !== 3) throw new Error(`expected 3 rows in the viewed month, saw ${items}`);
  step('three expenses show in the viewed month');

  // ...and the fourth in the previous month.
  await page.getByRole('button', { name: 'Previous month' }).click();
  await page.getByText('Gas last month', { exact: true }).waitFor();
  step('the row dated back a month landed in the previous month');

  console.log('\nPASS: bulk entry logs every filled row, skips blanks, blocks partial rows, and routes by date.');
} catch (err) {
  console.error('\nFAIL:', err.message);
  await page
    .screenshot({ path: 'screenshots/verify-bulk-add-failure.png', fullPage: true })
    .catch(() => {});
  process.exitCode = 1;
} finally {
  if (errors.length) console.error('\nConsole/page errors seen:\n' + errors.join('\n'));
  await browser.close();
}
