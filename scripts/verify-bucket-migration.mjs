/**
 * The v1.5.0 → buckets migration: the riskiest path, and the one no unit
 * test reaches, because it depends on IndexedDB's real `onupgradeneeded`
 * transaction rather than the pure `src/lib/migrate.ts` function alone.
 *
 * Seeds a v2-shaped database directly — a `months` row, an `events` row, and
 * expenses tagged `eventId` / `eventKind`, exactly as v1.5.0 wrote them —
 * then loads the app and asserts the bucket, its ledger, and the month's
 * arithmetic all survived the upgrade to v3, and that the old `events` store
 * is gone afterward.
 *
 * The app bundle is blocked on the very first navigation so nothing — old
 * code or new — ever opens the database before we've seeded it: opening an
 * existing database at a lower version than it already has throws, so the
 * seed has to land before any real connection exists.
 *
 * Run against a built preview:
 *   npm run build && npx vite preview --port 4173
 *   node scripts/verify-bucket-migration.mjs http://localhost:4173
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

const step = (msg) => console.log('• ' + msg);
const tab = (name) => page.locator('.tab', { hasText: new RegExp(`^${name}$`) });

function pad2(n) {
  return String(n).padStart(2, '0');
}
// Computed rather than hard-coded, so this pin doesn't rot: the app always
// opens on the real current month.
const now = new Date();
const monthId = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;

function expect(actual, wanted, what) {
  if (Math.abs(actual - wanted) > 0.005) {
    throw new Error(`${what}: expected ${wanted}, saw ${actual}`);
  }
}

async function statValue(label) {
  const text = await page
    .locator('.stat', { hasText: label })
    .locator('.stat__value')
    .first()
    .textContent();
  return Number(text.replace(/[^0-9.]/g, ''));
}

try {
  // Block the app's own bundle so this first navigation never opens
  // IndexedDB — the document (and the origin's storage) exists, but no code
  // has touched the database yet.
  await page.route('**/assets/*.js', (route) => route.abort());
  await page.goto(base);
  await page.locator('#root').waitFor();
  step('loaded the origin with the app bundle blocked — nothing has opened the database yet');

  await page.evaluate(
    ({ monthId }) =>
      new Promise((resolve, reject) => {
        const del = indexedDB.deleteDatabase('budget-tracker');
        del.onerror = () => reject(del.error ?? new Error('deleteDatabase failed'));
        del.onblocked = () => reject(new Error('deleteDatabase blocked — a connection is open'));
        del.onsuccess = () => {
          const req = indexedDB.open('budget-tracker', 2);
          req.onupgradeneeded = () => {
            const db = req.result;
            db.createObjectStore('months', { keyPath: 'id' });
            const expenses = db.createObjectStore('expenses', { keyPath: 'id' });
            expenses.createIndex('monthId', 'monthId', { unique: false });
            db.createObjectStore('categories', { keyPath: 'id' });
            db.createObjectStore('recurring', { keyPath: 'id' });
            db.createObjectStore('events', { keyPath: 'id' });
            db.createObjectStore('sessions', { keyPath: 'monthId' });
            db.createObjectStore('settings', { keyPath: 'id' });
          };
          req.onerror = () => reject(req.error ?? new Error('open v2 db failed'));
          req.onblocked = () => reject(new Error('open v2 db blocked'));
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction(['months', 'expenses', 'events', 'settings'], 'readwrite');
            tx.objectStore('months').put({
              id: monthId,
              year: Number(monthId.slice(0, 4)),
              month: Number(monthId.slice(5, 7)),
              budgetTotal: 2000,
              status: 'open',
              budgetHistory: [],
              recurringExpenseConfirmations: [],
              createdAt: new Date().toISOString(),
            });
            tx.objectStore('events').put({
              id: 'evt_1',
              name: 'Japan trip',
              targetAmount: 3000,
              phase: 'saving',
              monthlyContribution: 400,
              category: 'cat_other',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            });
            tx.objectStore('expenses').put({
              id: 'e1',
              monthId,
              date: `${monthId}-03`,
              amount: 400,
              category: 'cat_other',
              description: 'Japan trip fund',
              source: 'manual',
              reconciliationStatus: 'unreconciled',
              eventId: 'evt_1',
              eventKind: 'contribution',
              createdAt: `${monthId}-03T00:00:00.000Z`,
              updatedAt: `${monthId}-03T00:00:00.000Z`,
            });
            tx.objectStore('expenses').put({
              id: 'e2',
              monthId,
              date: `${monthId}-10`,
              amount: 250,
              category: 'cat_other',
              description: 'Kyoto dinner',
              source: 'manual',
              reconciliationStatus: 'unreconciled',
              eventId: 'evt_1',
              eventKind: 'spend',
              createdAt: `${monthId}-10T00:00:00.000Z`,
              updatedAt: `${monthId}-10T00:00:00.000Z`,
            });
            tx.objectStore('expenses').put({
              id: 'e3',
              monthId,
              date: `${monthId}-11`,
              amount: 30,
              category: 'cat_groceries',
              description: 'Milk',
              source: 'manual',
              reconciliationStatus: 'unreconciled',
              createdAt: `${monthId}-11T00:00:00.000Z`,
              updatedAt: `${monthId}-11T00:00:00.000Z`,
            });
            tx.objectStore('settings').put({ id: 'settings', currency: 'USD' });
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error ?? new Error('seed transaction failed'));
          };
        };
      }),
    { monthId },
  );
  step(`seeded a v2-shaped database for ${monthId}: one event, three expenses`);

  await page.unroute('**/assets/*.js');
  await page.goto(base);
  await page.getByText('Left this month').waitFor({ timeout: 20000 });
  step('reloaded — the app booted for real and should have run the v2→v3 upgrade');

  /* ---- the bucket and its ledger survived --------------------------------- */

  await tab('Buckets').click();
  await page.getByText('Japan trip', { exact: true }).waitFor();
  step('the Buckets tab lists "Japan trip"');

  await page.getByText('Japan trip', { exact: true }).click();
  await page.getByText('Japan trip fund', { exact: true }).waitFor();
  await page.getByText('Kyoto dinner', { exact: true }).waitFor();
  step('both ledger entries (the contribution and the spend) survived the upgrade');

  expect(await statValue('Set aside'), 400, 'set aside');
  expect(await statValue('Spent'), 250, 'spent');
  step('the bucket\'s figures are exact: $400 set aside, $250 spent');

  /* ---- the month's arithmetic is right ------------------------------------ */

  await tab('Month').click();
  await page.locator('.headline__value').first().waitFor();
  const label = (await page.locator('.headline__label').first().textContent()).trim();
  const text = (await page.locator('.headline__value').first().textContent()).trim();
  const leftThisMonth = Number(text.replace(/[^0-9.]/g, ''));
  if (label !== 'Left this month') {
    throw new Error(`expected "Left this month", saw "${label}"`);
  }
  // 2000 budget − 400 contribution − 30 ordinary; the 250 of bucket spending
  // must NOT count, or the migration silently double-counted something.
  expect(leftThisMonth, 1570, 'left this month after the upgrade');
  step('"Left this month" reads $1,570 — the bucket spend was correctly excluded');

  /* ---- the old store is really gone --------------------------------------- */

  const hasLegacyStore = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('budget-tracker');
        req.onsuccess = () => {
          const db = req.result;
          const has = db.objectStoreNames.contains('events');
          db.close();
          resolve(has);
        };
        req.onerror = () => reject(req.error ?? new Error('reopen failed'));
      }),
  );
  if (hasLegacyStore) {
    throw new Error('the legacy "events" object store is still present after the upgrade');
  }
  step('the legacy "events" object store is gone');

  console.log(
    '\nPASS: a v1.5.0-shaped database migrates to buckets in place — the bucket, its ledger, and ' +
      "the month's arithmetic all survive, and the old store is removed.",
  );
} catch (err) {
  console.error('\nFAIL:', err.message);
  await page
    .screenshot({ path: 'screenshots/verify-bucket-migration-failure.png', fullPage: true })
    .catch(() => {});
  process.exitCode = 1;
} finally {
  if (errors.length) console.error('\nConsole/page errors seen:\n' + errors.join('\n'));
  await browser.close();
}
