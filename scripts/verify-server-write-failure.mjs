/**
 * Confirms rule 4 from the task: a connection can still drop mid-session even
 * though there's no offline mode. A write attempted against a server that has
 * gone away must surface as a visible failure (a toast) rather than looking
 * like it succeeded, and the failed change must not be on the server or in
 * the on-screen ledger once things are checked again.
 *
 * Spawns its own budget-server instance (so it can kill it mid-test without
 * disturbing anything else), pointed at the built app in
 * budget-server/www.
 *
 * Run: node scripts/verify-server-write-failure.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.join(__dirname, '..', 'budget-server', 'server.mjs');
const STATIC_DIR = path.join(__dirname, '..', 'budget-server', 'www');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PORT = 8199;
const BASE = `http://127.0.0.1:${PORT}`;
const step = (msg) => console.log(`• ${msg}`);

async function startServer(dataDir) {
  const child = spawn(process.execPath, [SERVER_PATH], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, STATIC_DIR },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return child;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  child.kill('SIGKILL');
  throw new Error('server did not become healthy in time');
}

const dataDir = await mkdtemp(path.join(tmpdir(), 'budget-write-failure-'));
let server = await startServer(dataDir);
const browser = await chromium.launch({ executablePath: CHROME });

try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Set budget' }).waitFor();
  step('app booted against the live server');

  await page.getByRole('button', { name: 'Set budget' }).click();
  await page.getByLabel('Monthly budget total').fill('1000');
  await page.locator('.sheet').getByRole('button', { name: 'Set budget' }).click();
  await page.getByText('Left this month').waitFor();
  step('budget set while the server was up');

  // Now take the server away mid-session — the page stays open, exactly the
  // "connection drops mid-session" case the contract calls out.
  server.kill('SIGKILL');
  await new Promise((r) => setTimeout(r, 300));
  step('server killed mid-session');

  const doomedMarker = `Should not persist ${Date.now()}`;
  await page.getByRole('button', { name: 'Log an expense' }).click();
  await page.locator('#expense-amount').fill('13.37');
  await page.locator('#expense-description').fill(doomedMarker);
  await page.locator('#expense-date').fill('2026-09-09');
  await page.locator('.sheet').getByRole('button', { name: 'Groceries', exact: true }).click();
  await page.locator('.sheet').getByRole('button', { name: 'Save expense' }).click();

  // A successful save closes the sheet and shows a "$X logged" toast; a
  // failed one must not — the sheet stays open (nothing to undo, the write
  // never landed) and a factual failure toast appears instead.
  const toast = page.locator('.toast', { hasText: 'Not saved' });
  await toast.waitFor({ timeout: 5000 });
  step('PASS: failure toast ("Not saved") appeared instead of a success toast');

  const sheetStillOpen = await page.locator('.sheet').count();
  if (sheetStillOpen === 0) {
    throw new Error('The expense sheet closed as if the save had succeeded.');
  }
  step('PASS: the add-expense sheet did not close as if the save succeeded');

  const successToast = await page.locator('.toast', { hasText: '$13.37 logged' }).count();
  if (successToast > 0) throw new Error('A success toast appeared alongside the failure.');

  await page.locator('.sheet button', { hasText: /Cancel|Close/ }).first().click().catch(() => {});

  // Bring the server back and confirm the failed write really never landed —
  // no queue, no retry, nothing to flush.
  server = await startServer(dataDir);
  step('server restarted');

  await page.reload();
  await page.getByText('Left this month').waitFor();
  const ghostCount = await page.getByText(doomedMarker).count();
  if (ghostCount > 0) {
    throw new Error('The expense that failed to save is visible after all — it should not be.');
  }
  step('PASS: the failed expense is absent after reload — nothing silently landed later');

  const state = await (await fetch(`${BASE}/api/state`)).json();
  const onServer = state.data.expenses.some((e) => e.description === doomedMarker);
  if (onServer) throw new Error('The failed expense made it onto the server after all.');
  step('PASS: confirmed directly via GET api/state — the failed write is not on the server');
} finally {
  await browser.close();
  if (server.exitCode === null) server.kill('SIGKILL');
  await rm(dataDir, { recursive: true, force: true });
}
