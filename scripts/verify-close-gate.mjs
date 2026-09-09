/**
 * Repro for bug #1 (HIGH): a month could be closed with statement rows or
 * logged expenses never reviewed, because the stage tabs were a free jump
 * and Close had no gate at all.
 *
 * Demonstrates, against the CURRENT code in src/:
 *  1. With one unresolved statement row and one unresolved logged expense,
 *     the "Total" tab is disabled and carries a factual reason.
 *  2. Once both queues are cleared, the tab enables itself and Close works.
 *
 * Run: node scripts/verify-close-gate.mjs http://localhost:4201
 */
import { openApp, setBudget, addExpense, pasteStatement, importStatement } from './verify-helpers.mjs';

const base = process.argv[2] ?? 'http://localhost:4201';
const { browser, page, errors } = await openApp(base);

const summaryTab = () => page.locator('.segmented button', { hasText: 'Total' });

try {
  await setBudget(page, '1000');
  await addExpense(page, {
    amount: '50.00',
    description: 'Test Expense',
    date: '2026-09-05',
    category: 'Shopping',
  });
  console.log('• budget set, one $50 expense logged (2026-09-05)');

  // A statement row that matches nothing already logged — lands unresolved
  // in Queue A. The $50 expense above won't auto-match either (different
  // date/amount), so it stays unresolved in Queue B too.
  await pasteStatement(page, [
    'Transaction Date,Merchant Name,Amount',
    '09/10/2026,BIG CHARGE,1500.00',
  ]);
  await importStatement(page);
  await page.getByText('Statement rows to review').waitFor();
  console.log('• imported: 1 unmatched statement row, 1 unconfirmed logged expense');

  // --- assertion 1: Total tab is disabled while unresolved ---------------
  const disabledBefore = await summaryTab().isDisabled();
  const titleBefore = await summaryTab().getAttribute('title');
  console.log(`  Total tab disabled=${disabledBefore} title="${titleBefore}"`);
  if (!disabledBefore) {
    throw new Error(
      'BUG PRESENT: the "Total" tab is clickable while a statement row and a logged ' +
        'expense are both still unresolved — a free jump straight to Close.',
    );
  }
  if (!titleBefore || !/statement/i.test(titleBefore) || !/logged/i.test(titleBefore)) {
    throw new Error(`Total tab is disabled but its reason doesn't name what's left: "${titleBefore}"`);
  }

  // Clicking a disabled button should do nothing — confirm it doesn't navigate.
  await summaryTab().click({ force: true }).catch(() => {});
  await page.waitForTimeout(200);
  if (await page.getByText('Verified total').isVisible().catch(() => false)) {
    throw new Error('BUG PRESENT: clicking the disabled Total tab navigated to the summary anyway.');
  }
  console.log('  clicking the disabled tab did not navigate — still on the review screen');

  // --- clear Queue A: "Not logged" -> add the statement row as a new expense
  await page.getByRole('button', { name: 'Not logged' }).click();
  await page.getByText('Add from statement').waitFor();
  await page.locator('.sheet').getByRole('button', { name: 'Bills & Subscriptions', exact: true }).click();
  await page.locator('.sheet').getByRole('button', { name: 'Add expense' }).click();
  await page.locator('.sheet').waitFor({ state: 'detached' });
  await page.getByText('Statement queue clear').waitFor();
  console.log('• Queue A cleared (statement row added as a new expense)');

  // Queue A clear, Queue B still has the original $50 expense unresolved.
  const stillDisabled = await summaryTab().isDisabled();
  if (!stillDisabled) {
    throw new Error('BUG PRESENT: Total tab enabled even though Queue B still has an unresolved expense.');
  }
  console.log('  Total tab still correctly disabled (Queue B not clear yet)');

  await page.getByRole('button', { name: 'Review what you logged' }).click();
  await page.getByText('Logged, but not on the statement').waitFor();
  await page.getByRole('button', { name: 'Yes, keep it' }).click();
  await page.getByText('Both queues clear').waitFor();
  console.log('• Queue B cleared (kept the $50 expense)');

  // --- assertion 2: now that everything is resolved, Total enables -------
  const disabledAfter = await summaryTab().isDisabled();
  if (disabledAfter) {
    throw new Error('Total tab is still disabled after both queues were cleared — over-gated.');
  }
  await summaryTab().click();
  await page.getByText('Verified total').waitFor();
  console.log('  Total tab enabled once both queues cleared, and navigates to the summary');

  const closeBtn = page.getByRole('button', { name: /^Close September$/ });
  if (await closeBtn.isDisabled()) {
    throw new Error('Close is disabled even though nothing is unresolved.');
  }
  await closeBtn.click();
  await page.waitForTimeout(500);
  await page.getByText(/is closed$/).waitFor();
  console.log('• month closed cleanly once both queues were actually reviewed');

  console.log('\nPASS: bug #1 is fixed — Close/Total are gated on unresolvedCounts, with a factual reason.');
} catch (err) {
  console.error('\nFAIL:', err.message);
  await page.screenshot({ path: 'screenshots/verify-close-gate-failure.png', fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  if (errors.length) console.error('\nConsole/page errors seen:\n' + errors.join('\n'));
  await browser.close();
}
