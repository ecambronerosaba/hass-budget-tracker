/**
 * End-to-end smoke walk through the whole core loop, with screenshots.
 * Run against a built preview: node scripts/smoke.mjs http://localhost:4173
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:4173';
const shots = 'screenshots';
mkdirSync(shots, { recursive: true });

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const shot = async (name) => {
  await page.waitForTimeout(260);
  await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
};
const step = (msg) => console.log(`• ${msg}`);
const sheet = page.locator('.sheet');
const tab = (name) => page.locator('.tab', { hasText: new RegExp(`^${name}$`) });

await page.goto(base);
await page.getByRole('button', { name: 'Set budget' }).waitFor();
step('app booted');

// --- budget ------------------------------------------------------------
await page.getByRole('button', { name: 'Set budget' }).click();
await page.getByLabel('Monthly budget total').fill('2400');
await sheet.getByRole('button', { name: 'Set budget' }).click();
await page.getByText('Left this month').waitFor();
step('budget set');

// --- expenses ----------------------------------------------------------
const addExpense = async ({ amount, description, date, category, reimbursement }) => {
  await page.getByRole('button', { name: 'Log an expense' }).click();
  await page.locator('#expense-amount').fill(amount);
  await page.locator('#expense-description').fill(description);
  await page.locator('#expense-date').fill(date);
  if (category) await sheet.getByRole('button', { name: category, exact: true }).click();
  if (reimbursement) {
    await sheet.getByRole('button', { name: /Split it/ }).click();
    await page.locator('#expense-reimbursement').fill(reimbursement);
  }
  await sheet.getByRole('button', { name: 'Save expense' }).click();
  await sheet.waitFor({ state: 'detached' });
};

await addExpense({ amount: '42.18', description: "Trader Joe's", date: '2026-09-01', category: 'Groceries' });
await addExpense({ amount: '16.50', description: 'Metro North', date: '2026-09-03', category: 'Transport' });
await addExpense({ amount: '6.50', description: 'Blue State Coffee', date: '2026-09-04', category: 'Dining & Takeout' });
await addExpense({ amount: '128.40', description: 'Warby Parker', date: '2026-09-06', category: 'Shopping' });
// A split: $175 left the account, $150 is coming back from friends.
await addExpense({
  amount: '175.00',
  reimbursement: '150.00',
  description: 'Group dinner — Barcelona',
  date: '2026-09-05',
  category: 'Dining & Takeout',
});
step('five expenses logged, one of them split');

// --- recurring ---------------------------------------------------------
await tab('Settings').click();
await page.getByRole('button', { name: 'Add' }).first().click();
await page.locator('#rec-desc').fill('Rent');
await page.getByLabel('Recurring amount').fill('1500');
await sheet.getByRole('button', { name: 'Bills & Subscriptions', exact: true }).click();
await page.locator('#rec-day').fill('1');
await sheet.getByRole('button', { name: 'Add recurring expense' }).click();
await sheet.waitFor({ state: 'detached' });
await shot('05-settings');
step('recurring expense added');

// --- dashboard ---------------------------------------------------------
await tab('Month').click();
await page.getByText('Did').first().waitFor();
await shot('01-dashboard');
step('dashboard shows the nudge and the projection');

await page.getByRole('button', { name: 'Yes, log it' }).click();
await page.waitForTimeout(400);
await shot('02-dashboard-after-rent');
step('recurring confirmed');

await tab('Expenses').click();
await shot('03-expenses');

// The ledger should lead with the net cost of the split, not the gross.
const splitRow = page.locator('.list__item', { hasText: 'Group dinner' });
const splitText = await splitRow.innerText();
if (!splitText.includes('$25.00') || !splitText.includes('$150.00 back')) {
  throw new Error(`split row did not show net + gross detail:\n${splitText}`);
}
step('split expense reads as $25.00 net, $175.00 − $150.00 back');

// --- reconcile ---------------------------------------------------------
await tab('Reconcile').click();
await page.getByText('Or paste the rows instead').click();
await page.locator('textarea').fill(
  [
    'Transaction Date,Merchant Name,Amount',
    '09/01/2026,TRADER JOES #482,42.18', // exact match
    '09/02/2026,GREENWICH PROPERTY MGMT,1500.00', // rent, posted a day late -> unmatched, needs approval
    '09/03/2026,MTA METRO NORTH,16.50', // exact match
    '09/07/2026,AMZN MKTP US*2H4R,31.99', // never logged
    '09/06/2026,WARBY PARKER 0043,128.40', // exact match
    '09/05/2026,BARCELONA WINE BAR,175.00', // the split dinner: matches on gross, costs $25
    '09/09/2026,REFUND SEPHORA,-22.00', // credit, ignored
  ].join('\n'),
);
await page.getByRole('button', { name: 'Read these rows' }).click();
await page.getByText('Preview').waitFor();
await shot('06-import-mapping');
step('csv parsed and mapped from unfamiliar headers');

await page.getByRole('button', { name: /^Import \d+ transactions$/ }).click();
await page.getByText('Statement rows to review').waitFor();
await shot('07-queue-a');
step('queue A reached');

// Card 1 — the rent row: propose the match, approve it.
await page.getByRole('button', { name: 'I logged this' }).click();
await page.getByText('Which one is this?').waitFor();
await shot('08-match-proposal');
await sheet.getByRole('button', { name: 'Confirm this match' }).click();
await page.waitForTimeout(500);
step('proposed match approved');

// Card 2 — the Amazon row: add it as a new expense.
await page.getByRole('button', { name: 'Not logged' }).click();
await page.getByText('Add from statement').waitFor();
await sheet.getByRole('button', { name: 'Entertainment', exact: true }).click();
await sheet.getByRole('button', { name: 'Add expense' }).click();
await page.waitForTimeout(600);
await shot('09-queue-a-clear');
step('unlogged row added from the statement');

await page.getByRole('button', { name: 'Review what you logged' }).click();
await page.getByText('Logged, but not on the statement').waitFor();
await shot('10-queue-b');
step('queue B reached');

let guard = 0;
while ((await page.getByRole('button', { name: 'Yes, keep it' }).count()) > 0 && guard++ < 10) {
  await page.getByRole('button', { name: 'Yes, keep it' }).first().click();
  await page.waitForTimeout(350);
}
await page.getByRole('button', { name: "See the month's total" }).click();
await page.getByText('Verified total').waitFor();
await shot('11-summary');
step('summary reached');

await page.getByRole('button', { name: /^Close September$/ }).click();
await page.waitForTimeout(700);
await tab('History').click();
await shot('12-history');
step('month closed and archived');

// --- light mode + desktop ---------------------------------------------
await tab('Settings').click();
await page.getByRole('button', { name: 'Light' }).click();
await tab('Month').click();
await shot('13-light');
await tab('Settings').click();
await page.getByRole('button', { name: 'Dark' }).click();

await page.setViewportSize({ width: 1280, height: 900 });
await tab('Month').click();
await shot('14-desktop');
step('light mode and desktop widths render');

await browser.close();

if (errors.length) {
  console.error('\nConsole/page errors:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('\nSmoke walk complete — no console errors.');
