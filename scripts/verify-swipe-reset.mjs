/**
 * Repro for bug #2 (HIGH): a real swipe on a Queue A card opens a sheet
 * without resolving the transaction. SwipeCard's dx/exiting reset effect is
 * keyed on `cardKey`, which doesn't change when the sheet is closed
 * unconfirmed, so the card stays stranded at translateX(520px), opacity 0 —
 * invisible and unrecoverable without a reload.
 *
 * Demonstrates, against the CURRENT code in src/:
 *  1. A real mouse drag past the swipe threshold opens the match sheet.
 *  2. Closing that sheet WITHOUT confirming a match restores the card —
 *     transform back near 0, opacity back to 1.
 *  3. The card is swipeable again afterwards (the gesture stays answerable).
 *
 * Run: node scripts/verify-swipe-reset.mjs http://localhost:4201
 */
import { openApp, setBudget, pasteStatement, importStatement } from './verify-helpers.mjs';

const base = process.argv[2] ?? 'http://localhost:4201';
const { browser, page, errors } = await openApp(base);

async function readCardStyle(page) {
  return page.locator('.deck__card--top').evaluate((el) => ({
    transform: el.style.transform,
    opacity: el.style.opacity,
  }));
}

function translateX(transform) {
  const m = /translate3d\(([-\d.]+)px/.exec(transform);
  return m ? parseFloat(m[1]) : NaN;
}

/**
 * The reset happens in a useEffect keyed on cardKey, which commits a frame
 * after the sheet's onClose state updates — so poll briefly rather than
 * reading the style synchronously right after the sheet detaches.
 */
async function waitForCardAtRest(page, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await page.locator('.deck__card--top').evaluate((el) => ({
      transform: el.style.transform,
      opacity: el.style.opacity,
    }));
    if (Math.abs(translateX(last.transform)) < 5 && last.opacity === '1') {
      // The inline style (React's target) updates immediately, but the CSS
      // transition animating the card there visually takes a bit longer —
      // give it time to actually arrive before anything drags it again.
      await page.waitForTimeout(400);
      return last;
    }
    await page.waitForTimeout(50);
  }
  return last;
}

async function dragCard(page, direction) {
  const card = page.locator('.deck__card--top');
  const box = await card.boundingBox();
  const startX = box.x + box.width / 2;
  const startY = box.y + 60; // clear of the button row near the bottom
  const distance = direction === 'right' ? 200 : -200;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let step = 1; step <= 10; step++) {
    await page.mouse.move(startX + (distance * step) / 10, startY, { steps: 2 });
  }
  await page.mouse.up();
}

try {
  await setBudget(page, '1000');

  // A statement row that matches nothing logged — lands unresolved in Queue A.
  await pasteStatement(page, [
    'Transaction Date,Merchant Name,Amount',
    '09/07/2026,DOORDASH*ORDER,24.10',
  ]);
  await importStatement(page);
  await page.getByText('Statement rows to review').waitFor();
  console.log('• one unmatched statement row imported ($24.10 DoorDash)');

  const before = await readCardStyle(page);
  console.log(`  card at rest: transform="${before.transform}" opacity="${before.opacity}"`);

  await dragCard(page, 'right');
  await page.getByText('Which one is this?').waitFor();
  console.log('• dragged the card right past the threshold — match sheet opened');

  const midFlight = await readCardStyle(page);
  console.log(`  underlying card while sheet is open: transform="${midFlight.transform}" opacity="${midFlight.opacity}"`);
  if (Math.abs(translateX(midFlight.transform)) < 200 || midFlight.opacity !== '0') {
    console.log('  (note: card had not finished flying off before the sheet appeared — timing, not a bug)');
  }

  // Back out WITHOUT confirming a match.
  await page.keyboard.press('Escape');
  await page.getByText('Which one is this?').waitFor({ state: 'detached' });
  console.log('• closed the sheet unconfirmed (Escape)');

  const after = await waitForCardAtRest(page);
  const x = translateX(after.transform);
  console.log(`  card after closing the sheet: transform="${after.transform}" opacity="${after.opacity}"`);

  if (!(Math.abs(x) < 5) || after.opacity !== '1') {
    throw new Error(
      `BUG PRESENT: card is stranded off-screen — translateX=${x}, opacity=${after.opacity} ` +
        '(expected translateX ~0, opacity 1). Backing out of the sheet did not restore the card.',
    );
  }
  console.log('  card is back at rest and fully visible');

  // The row should still be the same unresolved DoorDash charge — nothing
  // silently got linked or dismissed by the aborted swipe.
  await page.getByText('DOORDASH*ORDER').waitFor();
  console.log('  still the same unresolved row — the aborted swipe changed nothing');

  // And the gesture is answerable again: swipe left this time.
  await dragCard(page, 'left');
  await page.getByText('Add from statement').waitFor();
  console.log('• swiped left afterwards — "Add from statement" opened, so the card is fully interactive again');

  console.log('\nPASS: bug #2 is fixed — backing out of the sheet restores the swipe card.');
} catch (err) {
  console.error('\nFAIL:', err.message);
  await page.screenshot({ path: 'screenshots/verify-swipe-reset-failure.png', fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  if (errors.length) console.error('\nConsole/page errors seen:\n' + errors.join('\n'));
  await browser.close();
}
