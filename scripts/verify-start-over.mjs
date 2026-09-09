/**
 * Repro for bug #3 (MEDIUM): "Start over" always said "Nothing you logged
 * was changed", even when the session had created expenses from statement
 * rows (which cancelReconciliation deletes). The toast lied about what
 * actually happened.
 *
 * Demonstrates, against the CURRENT code in src/:
 *  1. Import a statement, add one row as a new expense (a session-created
 *     expense) — it shows up in the Expenses tab.
 *  2. Click "Start over". The toast must say an expense was removed, with
 *     the correct count — not the blanket "nothing changed" line.
 *  3. The expense is actually gone from the Expenses tab, confirming the
 *     toast matches reality.
 *  4. As a control, starting over with nothing session-created still says
 *     "Nothing you logged was changed" (the honest case, not overcorrected).
 *
 * Run: node scripts/verify-start-over.mjs http://localhost:4201
 */
import { openApp, setBudget, pasteStatement, importStatement, tab } from './verify-helpers.mjs';

const base = process.argv[2] ?? 'http://localhost:4201';
const { browser, page, errors } = await openApp(base);

try {
  await setBudget(page, '1000');

  await pasteStatement(page, [
    'Transaction Date,Merchant Name,Amount',
    '09/07/2026,AMZN MKTP US*2H4R,31.99',
  ]);
  await importStatement(page);
  await page.getByText('Statement rows to review').waitFor();
  console.log('• one unmatched statement row imported');

  await page.getByRole('button', { name: 'Not logged' }).click();
  await page.getByText('Add from statement').waitFor();
  await page.locator('.sheet').getByRole('button', { name: 'Entertainment', exact: true }).click();
  await page.locator('.sheet').getByRole('button', { name: 'Add expense' }).click();
  await page.locator('.sheet').waitFor({ state: 'detached' });
  console.log('• added the row as a new expense (session-created)');

  await tab(page, 'Expenses').click();
  await page.getByText('AMZN MKTP US*2H4R').waitFor();
  console.log('  confirmed it now appears in the Expenses tab');

  await tab(page, 'Reconcile').click();
  await page.getByRole('button', { name: 'Start over' }).click();

  // Target the "Import discarded" toast by its message, not stack position —
  // the earlier "N transactions imported" toast can still be fading out.
  const toast = page.locator('.toast', { hasText: 'Import discarded' });
  await toast.waitFor();
  const toastText = await toast.innerText();
  console.log(`• toast after "Start over": "${toastText.replace(/\n/g, ' · ')}"`);

  if (/Nothing you logged was changed/.test(toastText)) {
    throw new Error(
      'BUG PRESENT: toast still claims "Nothing you logged was changed" even though a ' +
        'session-created expense was just deleted.',
    );
  }
  if (!/1/.test(toastText) || !/removed|deleted/i.test(toastText)) {
    throw new Error(`Toast doesn't state the count of removed expenses: "${toastText}"`);
  }
  console.log('  toast correctly reports that a created expense was removed, with a count');

  await tab(page, 'Expenses').click();
  const stillThere = await page.getByText('AMZN MKTP US*2H4R').isVisible().catch(() => false);
  if (stillThere) {
    throw new Error('The expense the toast said was removed is still in the Expenses tab.');
  }
  console.log('  and it is in fact gone from the Expenses tab — the toast matches reality');

  // --- control: starting over with nothing session-created ---------------
  await tab(page, 'Reconcile').click();
  await pasteStatement(page, [
    'Transaction Date,Merchant Name,Amount',
    '09/07/2026,SOME OTHER CHARGE,12.00',
  ]);
  await importStatement(page);
  await page.getByText('Statement rows to review').waitFor();
  await page.getByRole('button', { name: 'Start over' }).click();
  const toast2 = page.locator('.toast', { hasText: 'Import discarded' });
  await toast2.waitFor();
  const toast2Text = await toast2.innerText();
  console.log(`• control (nothing created this time): "${toast2Text.replace(/\n/g, ' · ')}"`);
  if (!/Nothing you logged was changed/.test(toast2Text)) {
    throw new Error(`Expected the honest "nothing changed" line when nothing was created: "${toast2Text}"`);
  }
  console.log('  correctly still says "Nothing you logged was changed" when that\'s true');

  console.log('\nPASS: bug #3 is fixed — the "Start over" toast tells the truth either way.');
} catch (err) {
  console.error('\nFAIL:', err.message);
  await page.screenshot({ path: 'screenshots/verify-start-over-failure.png', fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  if (errors.length) console.error('\nConsole/page errors seen:\n' + errors.join('\n'));
  await browser.close();
}
