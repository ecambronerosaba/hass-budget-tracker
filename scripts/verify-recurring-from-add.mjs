/**
 * Proves the "make this recurring" checkbox inside the add-expense flow.
 *
 * Ticking it while logging an expense should, in one save:
 *  1. log the expense for this month, tagged as recurring (repeat icon on the
 *     row, excluded from the day-to-day pace rate);
 *  2. create a RecurringExpense template — visible in Settings, dated to the
 *     day the expense was dated ("around the 5th");
 *  3. record that template as confirmed for this month, so the Month screen
 *     does NOT also nag "did <thing> go out this month?" — the cycle starts
 *     next month.
 *
 * Run against a built preview:
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/verify-recurring-from-add.mjs http://localhost:4173
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
const tab = (name) => page.locator('.tab', { hasText: new RegExp(`^${name}$`) });

let failed = 0;
const check = (label, ok) => {
  console.log(`${ok ? '✓' : '✗'} ${label}`);
  if (!ok) failed++;
};

await page.goto(base);
await page.getByRole('button', { name: 'Set budget' }).waitFor();

// --- budget ----------------------------------------------------------------
await page.getByRole('button', { name: 'Set budget' }).click();
await page.getByLabel('Monthly budget total').fill('2400');
await sheet.getByRole('button', { name: 'Set budget' }).click();
await page.getByText('Left this month', { exact: true }).waitFor();

// --- log an expense, flagged recurring ------------------------------------
await page.getByRole('button', { name: 'Log an expense' }).click();
await page.locator('#expense-amount').fill('19.99');
await page.locator('#expense-description').fill('Streaming service');
await page.locator('#expense-date').fill('2026-09-05');

await sheet.getByRole('button', { name: '+ Make this recurring' }).click();
const hint = await sheet.getByText(/nudges you around the/).innerText();
check('hint names the day from the date field', /around the 5th/.test(hint));

await sheet.getByRole('button', { name: 'Save expense' }).click();
await sheet.waitFor({ state: 'detached' });

check(
  'toast confirms it is now recurring',
  await page.getByText(/now recurring/).first().isVisible(),
);

// --- the month row is tagged recurring -----------------------------------
await tab('Expenses').click();
const row = page.locator('.list__item', { hasText: 'Streaming service' });
await row.waitFor();
check('logged expense row carries the recurring icon', (await row.locator('svg').count()) > 0);

// --- a template now exists in Settings ----------------------------------
await tab('Settings').click();
const rec = page.locator('.list__item', { hasText: 'Streaming service' });
await rec.waitFor();
check('Settings lists the new recurring template', await rec.isVisible());
check(
  'template is dated to the 5th',
  /around the 5th/.test(await rec.locator('.list__sub').innerText()),
);

// --- this month is NOT nagged for it ----------------------------------
await tab('Month').click();
await page.getByText('Left this month', { exact: true }).waitFor();
const nagged = await page
  .getByText(/Did .*Streaming service.* go out this month/)
  .count();
check('no duplicate "did it go out this month?" nudge', nagged === 0);

check('no console/page errors', errors.length === 0);
if (errors.length) console.log(errors);

await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
