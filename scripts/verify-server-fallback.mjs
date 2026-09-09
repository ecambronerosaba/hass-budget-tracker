/**
 * Confirms the automatic-selection half of the feature: when the build is
 * served with no api/* endpoints behind it (the /local/budget/index.html
 * deployment shape), the app falls back to IndexedDbRepository rather than
 * hanging on the health probe or showing a blank screen, and data survives a
 * reload the same way it always has.
 *
 * Point this at a plain static server for the built app — e.g.
 *   npx vite preview --port 4173
 * which serves dist/ with no /api routes at all.
 *
 * Run: node scripts/verify-server-fallback.mjs http://localhost:4173
 */
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:4173';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const step = (msg) => console.log(`• ${msg}`);

const browser = await chromium.launch({ executablePath: CHROME });
const context = await browser.newContext();
const page = await context.newPage();

try {
  const bootStart = Date.now();
  await page.goto(base);
  await page.getByRole('button', { name: 'Set budget' }).waitFor({ timeout: 6000 });
  const bootMs = Date.now() - bootStart;
  step(`app booted in ${bootMs}ms with no server present (health probe did not hang)`);
  if (bootMs > 5000) throw new Error(`Boot took ${bootMs}ms — the probe is not bounded tightly enough.`);

  const marker = `Fallback proof ${Date.now()}`;
  await page.getByRole('button', { name: 'Set budget' }).click();
  await page.getByLabel('Monthly budget total').fill('500');
  await page.locator('.sheet').getByRole('button', { name: 'Set budget' }).click();
  await page.getByText('Left this month').waitFor();

  await page.getByRole('button', { name: 'Log an expense' }).click();
  await page.locator('#expense-amount').fill('9.99');
  await page.locator('#expense-description').fill(marker);
  await page.locator('#expense-date').fill('2026-09-09');
  await page.locator('.sheet').getByRole('button', { name: 'Groceries', exact: true }).click();
  await page.locator('.sheet').getByRole('button', { name: 'Save expense' }).click();
  await page.locator('.sheet').waitFor({ state: 'detached' });
  step(`expense "${marker}" logged against IndexedDB`);

  // Settings should say "local to this browser", not the server line.
  await page.locator('.tab', { hasText: /^Settings$/ }).click();
  await page.getByText('Data lives in this browser only').waitFor({ timeout: 3000 });
  step('Settings correctly reports local-browser storage, not server storage');

  await page.reload();
  await page.getByText('Left this month').waitFor();
  await page.getByText(marker).waitFor({ timeout: 5000 });
  step('PASS: expense survives a reload via IndexedDB with no server present');
} finally {
  await browser.close();
}
