/**
 * The test neither half could do alone: the app behind an Ingress-style path
 * prefix, with two isolated browsers.
 *
 * Home Assistant does not serve the add-on at a host's root. It proxies it
 * under a generated path — `/api/hassio_ingress/<token>/` — and strips that
 * prefix before the request reaches the add-on. So the client's URLs must be
 * relative (they resolve against the prefixed page URL) and the server must be
 * happy receiving un-prefixed paths. Testing at the root, as both halves did,
 * cannot catch a leading slash that escapes the prefix.
 *
 * This stands a proxy in front of the real add-on server to reproduce that
 * exact shape, then proves the point of the whole feature: two completely
 * separate browsers, one budget.
 *
 *   node scripts/verify-ingress.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TOKEN = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
const PREFIX = `/api/hassio_ingress/${TOKEN}`;
const UPSTREAM = 8099;
const PROXY = 8100;

let failed = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? '  ok  ' : 'FAIL  '}${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
};

/* ---- the real add-on server ------------------------------------------- */
const dataDir = mkdtempSync(join(tmpdir(), 'budget-'));
const server = spawn('node', ['server.mjs'], {
  cwd: 'budget-server',
  // STATIC_DIR defaults to the in-container path; point it at the folder the
  // image would copy in, so this runs the same code the add-on will.
  env: {
    ...process.env,
    DATA_DIR: dataDir,
    PORT: String(UPSTREAM),
    STATIC_DIR: new URL('../budget-server/www', import.meta.url).pathname,
  },
  stdio: 'ignore',
});
const stop = () => {
  server.kill('SIGKILL');
  proxy.close();
};

/* ---- an Ingress-shaped proxy in front of it ---------------------------- */
const proxy = createServer((req, res) => {
  if (!req.url.startsWith(PREFIX)) {
    res.writeHead(404).end('not ingress');
    return;
  }
  // Exactly what HA does: strip the prefix, forward the rest.
  const path = req.url.slice(PREFIX.length) || '/';
  const upstream = httpRequest(
    { host: '127.0.0.1', port: UPSTREAM, path, method: req.method, headers: req.headers },
    (up) => {
      res.writeHead(up.statusCode, up.headers);
      up.pipe(res);
    },
  );
  upstream.on('error', () => res.writeHead(502).end('upstream down'));
  req.pipe(upstream);
});

await new Promise((r) => proxy.listen(PROXY, r));
await new Promise((r) => setTimeout(r, 900));

const base = `http://127.0.0.1:${PROXY}${PREFIX}/`;

/* ---- drive it ---------------------------------------------------------- */
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);

try {
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  const errs = [];
  pageA.on('pageerror', (e) => errs.push(String(e)));
  pageA.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const requested = [];
  pageA.on('request', (r) => requested.push(r.url()));

  await pageA.goto(base);
  await pageA.getByRole('button', { name: 'Set budget' }).waitFor({ timeout: 20000 });
  check(true, 'app boots under an Ingress path prefix');

  // Every request the page made must stay inside the prefix. One leading
  // slash anywhere and this is where it shows up.
  const escaped = requested.filter((u) => u.startsWith(`http://127.0.0.1:${PROXY}/`) && !u.startsWith(base));
  check(escaped.length === 0, 'no request escaped the prefix', escaped.slice(0, 3).join(', ') || 'all prefixed');

  const sheetA = pageA.locator('.sheet');
  await pageA.getByRole('button', { name: 'Set budget' }).click();
  await pageA.getByLabel('Monthly budget total').fill('2600');
  await sheetA.getByRole('button', { name: 'Set budget' }).click();
  await pageA.getByText('Left this month').waitFor();

  await pageA.getByRole('button', { name: 'Log an expense' }).click();
  await pageA.locator('#expense-amount').fill('88.20');
  await pageA.locator('#expense-description').fill('Shared across devices');
  await sheetA.getByRole('button', { name: 'Save expense' }).click();
  await sheetA.waitFor({ state: 'detached' });
  await pageA.waitForTimeout(600);
  check(true, 'budget and expense written through the proxy');

  // It really is on the server, not just in a tab.
  const state = await (await fetch(`${base}api/state`)).json();
  const onServer = state.data.expenses.some((e) => e.description === 'Shared across devices');
  check(onServer, 'the expense is in the server document', `rev ${state.rev}`);

  // The whole point: a different browser, same budget.
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await pageB.goto(base);
  await pageB.getByText('Left this month').waitFor({ timeout: 20000 });
  const seen = await pageB
    .locator('.list__item', { hasText: 'Shared across devices' })
    .first()
    .innerText()
    .catch(() => '');
  check(
    seen.includes('$88.20'),
    'a second, isolated browser sees the same budget',
    seen.replace(/\n/g, ' | ') || 'not found',
  );

  const storage = await pageB.evaluate(() => {
    // Nothing should have been written to the browser's own database.
    return new Promise((resolve) => {
      const req = indexedDB.open('budget-tracker');
      req.onsuccess = () => {
        const db = req.result;
        const has = db.objectStoreNames.contains('expenses');
        if (!has) return resolve(0);
        const tx = db.transaction('expenses', 'readonly');
        const all = tx.objectStore('expenses').getAll();
        all.onsuccess = () => resolve(all.result.length);
        all.onerror = () => resolve(-1);
      };
      req.onerror = () => resolve(0);
    });
  });
  check(storage === 0, 'nothing was written to the browser database', `${storage} local rows`);

  check(errs.length === 0, 'no console errors', errs.slice(0, 2).join(' | '));
} finally {
  await browser.close();
  stop();
}

console.log(failed ? `\n${failed} check(s) failed.` : '\nIngress + cross-browser checks passed.');
process.exit(failed ? 1 : 0);
