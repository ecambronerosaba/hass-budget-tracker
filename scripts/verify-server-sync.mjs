/**
 * Proves the point of the server-backed repository: an expense logged in one
 * browser context is visible from a completely separate, isolated browser
 * context (browser.newContext(), not a new page) — same server, different
 * "browser". This is the one thing IndexedDB structurally cannot do.
 *
 * Requires a running budget-server (see budget-server) serving a
 * build of this app that includes ApiRepository, at the URL given as argv[2].
 *
 * Run: node scripts/verify-server-sync.mjs http://localhost:8099
 */
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:8099';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const step = (msg) => console.log(`• ${msg}`);

const browser = await chromium.launch({ executablePath: CHROME });

try {
  // --- context A: set a budget and log an expense -------------------------
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await pageA.goto(base);
  await pageA.getByRole('button', { name: 'Set budget' }).waitFor();
  step('context A booted against the server');

  await pageA.getByRole('button', { name: 'Set budget' }).click();
  await pageA.getByLabel('Monthly budget total').fill('1000');
  await pageA.locator('.sheet').getByRole('button', { name: 'Set budget' }).click();
  await pageA.getByText('Left this month').waitFor();
  step('budget set in context A');

  const marker = `Cross-context proof ${Date.now()}`;
  await pageA.getByRole('button', { name: 'Log an expense' }).click();
  await pageA.locator('#expense-amount').fill('42.18');
  await pageA.locator('#expense-description').fill(marker);
  await pageA.locator('#expense-date').fill('2026-09-09');
  await pageA.locator('.sheet').getByRole('button', { name: 'Groceries', exact: true }).click();
  await pageA.locator('.sheet').getByRole('button', { name: 'Save expense' }).click();
  await pageA.locator('.sheet').waitFor({ state: 'detached' });
  step(`expense "${marker}" logged in context A`);

  // Confirm it actually reached the server, not just context A's own state.
  const state = await (await fetch(`${base}/api/state`)).json();
  const onServer = state.data.expenses.some((e) => e.description === marker);
  if (!onServer) throw new Error('Expense is not on the server after saving in context A.');
  step('confirmed on the server directly via GET api/state');

  // --- context B: brand-new isolated context, no shared storage -----------
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await pageB.goto(base);
  await pageB.getByText(marker).waitFor({ timeout: 5000 });
  step('PASS: expense from context A is visible in isolated context B');

  await ctxA.close();
  await ctxB.close();
} finally {
  await browser.close();
}
