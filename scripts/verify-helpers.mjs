/**
 * Shared setup used by the verify-*.mjs repro scripts. Not part of the app —
 * just cuts down on copy-pasted boilerplate across the bug-specific scripts.
 */
import { chromium } from 'playwright';

export const CHROME_PATH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

export async function openApp(base) {
  const browser = await chromium.launch({ executablePath: CHROME_PATH });
  const page = await browser.newPage({
    viewport: { width: 430, height: 932 },
    deviceScaleFactor: 2,
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(base);
  await page.getByRole('button', { name: 'Set budget' }).waitFor();
  return { browser, page, errors };
}

const sheet = (page) => page.locator('.sheet');
export const tab = (page, name) => page.locator('.tab', { hasText: new RegExp(`^${name}$`) });

export async function setBudget(page, amount) {
  await page.getByRole('button', { name: 'Set budget' }).click();
  await page.getByLabel('Monthly budget total').fill(String(amount));
  await sheet(page).getByRole('button', { name: 'Set budget' }).click();
  await page.getByText('Left this month').waitFor();
}

export async function addExpense(page, { amount, description, date, category }) {
  await page.getByRole('button', { name: 'Log an expense' }).click();
  await page.locator('#expense-amount').fill(amount);
  await page.locator('#expense-description').fill(description);
  await page.locator('#expense-date').fill(date);
  if (category) await sheet(page).getByRole('button', { name: category, exact: true }).click();
  await sheet(page).getByRole('button', { name: 'Save expense' }).click();
  await sheet(page).waitFor({ state: 'detached' });
}

/** Pastes CSV rows into the reconcile import step and reads them into a plan. */
export async function pasteStatement(page, rows) {
  await tab(page, 'Reconcile').click();
  await page.getByText('Or paste the rows instead').click();
  await page.locator('textarea').fill(rows.join('\n'));
  await page.getByRole('button', { name: 'Read these rows' }).click();
  await page.getByText('Preview').waitFor();
}

export async function importStatement(page) {
  await page.getByRole('button', { name: /^Import \d+ transactions?$/ }).click();
}
