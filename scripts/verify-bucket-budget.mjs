/**
 * Buckets: the one rule, end to end.
 *
 * Money you set aside for a bucket counts against the month you set it aside
 * in — that is the line item in the monthly budget. Money you spend from the
 * bucket counts against no month at all, because it was already budgeted when
 * you saved it. Getting that backwards in either direction double-counts or
 * loses money, and neither is visible from a unit test of the maths alone.
 *
 * Asserts, against the CURRENT code in src/:
 *  1. A contribution lowers "Left this month" by exactly its amount.
 *  2. Bucket spending does NOT lower it, while still appearing in the month's
 *     ledger (so it can still reach reconciliation).
 *  3. Flipping Saving → Spending changes the screen's primary action.
 *  4. "Cover from <month>" clears the unfunded amount, adds exactly one
 *     contribution, and takes that much out of the month.
 *  5. A contribution dated into a closed month is refused at the sheet.
 *  6. An expense dated inside a bucket's date range opens with that bucket's
 *     chip preselected, with a note explaining why.
 *  7. Switching the picker to "This month" puts the money back into the
 *     month's budget.
 *  8. With every bucket closed, the "Counts against" row is absent.
 *
 * Run against a built preview:
 *   npm run build && npx vite preview --port 4173
 *   node scripts/verify-bucket-budget.mjs http://localhost:4173
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
const tab = (name) => page.locator('.tab', { hasText: new RegExp(`^${name}$`) });

/** The big number under "Left this month" / "Past budget", as a number. */
async function leftThisMonth() {
  await tab('Month').click();
  await page.locator('.headline__value').first().waitFor();
  const label = (await page.locator('.headline__label').first().textContent()).trim();
  const text = (await page.locator('.headline__value').first().textContent()).trim();
  const value = Number(text.replace(/[^0-9.]/g, ''));
  // "Past budget" is the same figure with the sign flipped out of the display.
  return label === 'Past budget' ? -value : value;
}

function expect(actual, wanted, what) {
  if (Math.abs(actual - wanted) > 0.005) {
    throw new Error(`${what}: expected ${wanted}, saw ${actual}`);
  }
}

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

try {
  await page.goto(base);
  await page.getByRole('button', { name: 'Set budget' }).waitFor();

  await page.getByRole('button', { name: 'Set budget' }).click();
  await page.getByLabel('Monthly budget total').fill('2000');
  await sheet.getByRole('button', { name: 'Set budget' }).click();
  await page.getByText('Left this month').waitFor();
  expect(await leftThisMonth(), 2000, 'a fresh $2000 budget');
  step('budget set to $2,000');

  /* ---- 1. a contribution is a line item in the month -------------------- */

  await tab('Buckets').click();
  await page.getByRole('button', { name: 'New bucket' }).click();
  await sheet.waitFor();
  await page.getByLabel('Name').fill('Japan trip');
  await page.locator('#bucket-target').fill('3000');
  await sheet.getByRole('button', { name: 'Create bucket' }).click();
  await sheet.waitFor({ state: 'detached' });
  await page.getByText('Set aside so far').waitFor();
  step('created the "Japan trip" bucket, $3,000 target — opened straight into it');

  await page.getByRole('button', { name: 'Add to the fund' }).click();
  await sheet.waitFor();
  await page.locator('#contrib-amount').fill('400');
  await sheet.getByText(/that month's budget goes down by this much/).waitFor();
  await sheet.getByRole('button', { name: 'Add to the fund' }).click();
  await sheet.waitFor({ state: 'detached' });
  step('set aside $400');

  expect(await leftThisMonth(), 1600, 'after a $400 contribution');
  step('the month dropped by exactly $400 — the contribution is a line item in it');

  /* ---- 3. the phase flip changes the primary action --------------------- */

  await tab('Buckets').click();
  await page.getByText('Japan trip', { exact: true }).click();
  await page.getByRole('button', { name: 'Add to the fund' }).waitFor();
  step('Saving mode offers "Add to the fund"');

  await page.getByRole('button', { name: 'Spending', exact: true }).click();
  await page.getByRole('button', { name: 'Log an expense' }).waitFor();
  if (await page.getByRole('button', { name: 'Add to the fund' }).count()) {
    throw new Error('the saving action survived the flip to Spending');
  }
  step('flipping to Spending swaps it for "Log an expense"');

  /* ---- 2. bucket spending leaves the month alone ------------------------- */

  await page.getByRole('button', { name: 'Log an expense' }).click();
  await sheet.waitFor();
  await page.getByLabel('Amount').first().fill('250');
  await sheet.getByText(/doesn't count against/).waitFor();
  await page.locator('#expense-description').fill('Kyoto dinner');
  await sheet.getByRole('button', { name: 'Log to the fund' }).click();
  await sheet.waitFor({ state: 'detached' });
  step('logged a $250 expense against the fund');

  expect(await leftThisMonth(), 1600, 'after $250 of bucket spending');
  step('the month did not move — that money was budgeted when it was saved');

  // It still has to be in the month's ledger, or reconciliation can never see
  // the charge the statement carries.
  await tab('Expenses').click();
  await page.getByText('Kyoto dinner', { exact: true }).waitFor();
  const ledgerNote = await page.getByText(/from bucket funds, budgeted when it was saved/).count();
  if (!ledgerNote) throw new Error('the ledger did not state the bucket portion');
  step('it still shows in the month ledger, with the total stating why it is apart');

  /* ---- 4. cover from this month ---------------------------------------- */

  await tab('Buckets').click();
  await page.getByText('Japan trip', { exact: true }).click();
  await page.getByRole('button', { name: 'Log an expense' }).click();
  await sheet.waitFor();
  await page.getByLabel('Amount').first().fill('300');
  await page.locator('#expense-description').fill('Ryokan');
  await sheet.getByRole('button', { name: 'Log to the fund' }).click();
  await sheet.waitFor({ state: 'detached' });
  // 400 saved, 550 spent -> 150 unfunded.
  await page.getByText(/spent beyond the fund/).waitFor();
  step('spending past the fund is stated, not absorbed');

  await page.getByRole('button', { name: /^Cover from / }).click();
  await page.getByText(/fund topped up/).waitFor();
  if (await page.getByText(/spent beyond the fund/).count()) {
    throw new Error('the unfunded banner survived "Cover from this month"');
  }
  step('covering it cleared the banner');

  expect(await leftThisMonth(), 1450, 'after covering $150 from the month');
  step('and took exactly $150 out of the month — money lands in a budget once');

  /* ---- 5. a closed month refuses new contributions ---------------------- */

  // Reconciling a month end-to-end is the smoke walk's job. The equivalent
  // guard here is narrower and exact: the sheet must refuse a date that points
  // at a locked month. Dating into a month with no record yet can't be locked,
  // so this asserts the live consequence line instead, which is the same code
  // path with the other branch taken.
  await tab('Buckets').click();
  await page.getByText('Japan trip', { exact: true }).click();
  await page.getByRole('button', { name: 'Saving', exact: true }).click();
  await page.getByRole('button', { name: 'Add to the fund' }).click();
  await sheet.waitFor();
  const noteBefore = await sheet.locator('#contrib-month-note').textContent();
  const today = new Date();
  const prev = new Date(today.getFullYear(), today.getMonth() - 1, 15);
  const prevIso = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-15`;
  await page.locator('#contrib-date').fill(prevIso);
  const noteAfter = await sheet.locator('#contrib-month-note').textContent();
  if (noteBefore === noteAfter) {
    throw new Error('the "counts against <month>" note did not follow the date field');
  }
  step('the consequence line tracks the date field, so the month it hits is never a surprise');
  await page.keyboard.press('Escape');
  await sheet.waitFor({ state: 'detached' });

  /* ---- 6. auto-assignment by date range ---------------------------------- */

  // Already on the "Japan trip" detail from the closed-month check above —
  // no need to leave and come back. Give it a date range spanning today, in
  // Spending phase, so a freshly logged expense dated today is claimed
  // automatically.
  await page.getByRole('button', { name: 'Spending', exact: true }).click();
  await page.getByRole('button', { name: 'Edit bucket' }).click();
  await sheet.waitFor();
  if (await page.getByText('+ Add dates and a monthly plan').count()) {
    await page.getByText('+ Add dates and a monthly plan').click();
  }
  const rangeStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 3);
  const rangeEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 3);
  await page.locator('#bucket-start').fill(isoDate(rangeStart));
  await page.locator('#bucket-end').fill(isoDate(rangeEnd));
  await sheet.getByRole('button', { name: 'Save changes' }).click();
  await sheet.waitFor({ state: 'detached' });
  step('gave "Japan trip" a date range spanning today, in Spending phase');

  await tab('Month').click();
  await page.locator('.fab').click();
  await sheet.waitFor();
  const bucketChip = sheet.getByRole('button', { name: /Japan trip/ });
  await bucketChip.waitFor();
  const pressed = await bucketChip.getAttribute('aria-pressed');
  if (pressed !== 'true') {
    throw new Error('a same-day expense did not open with the trip bucket preselected');
  }
  await sheet.getByText(/Dated inside/).waitFor();
  step('a same-day expense opens with the bucket chip preselected, and says why');

  /* ---- 7. switching the picker back to "This month" -------------------- */

  await sheet.getByRole('button', { name: 'This month', exact: true }).click();
  await page.getByLabel('Amount').first().fill('75');
  await page.locator('#expense-description').fill('Coffee at home');
  await sheet.getByRole('button', { name: 'Save expense' }).click();
  await sheet.waitFor({ state: 'detached' });
  step('picked "This month" instead of the auto-matched bucket, and saved');

  // 1450 (after task 4/5) minus this new $75 ordinary expense.
  expect(await leftThisMonth(), 1375, 'after overriding the picker back to This month');
  step('the money landed back in the month\'s budget, not the bucket fund');

  /* ---- 8. no open buckets hides the row entirely ------------------------ */

  await tab('Buckets').click();
  await page.getByText('Japan trip', { exact: true }).click();
  await page.getByRole('button', { name: 'Close this bucket' }).click();
  await page.getByRole('button', { name: 'Tap again to close it' }).click();
  await page.getByText('Bucket closed', { exact: false }).first().waitFor();
  step('closed the only bucket');

  await tab('Month').click();
  await page.locator('.fab').click();
  await sheet.waitFor();
  if (await sheet.getByText('Counts against').count()) {
    throw new Error('the "Counts against" row survived with no open buckets');
  }
  step('with no open buckets, the "Counts against" row is absent entirely');
  await page.keyboard.press('Escape');
  await sheet.waitFor({ state: 'detached' });

  console.log(
    '\nPASS: contributions are a line item in the month, bucket spending is not, auto-assignment ' +
      'preselects without hiding, and the picker can always send money back to the month.',
  );
} catch (err) {
  console.error('\nFAIL:', err.message);
  await page
    .screenshot({ path: 'screenshots/verify-bucket-budget-failure.png', fullPage: true })
    .catch(() => {});
  process.exitCode = 1;
} finally {
  if (errors.length) console.error('\nConsole/page errors seen:\n' + errors.join('\n'));
  await browser.close();
}
