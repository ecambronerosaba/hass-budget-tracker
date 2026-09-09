import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const p = await b.newPage({ viewport: { width: 390, height: 780 } });
const errs = [];
p.on('pageerror', e => errs.push(String(e)));
await p.goto('http://localhost:4300/host.html');
const f = p.frameLocator('iframe');
await f.getByRole('button', { name: 'Set budget' }).waitFor({ timeout: 15000 });
await f.getByRole('button', { name: 'Set budget' }).click();
await f.getByLabel('Monthly budget total').fill('1800');
await f.locator('.sheet').getByRole('button', { name: 'Set budget' }).click();
await f.getByText('Left this month').waitFor();
await f.getByRole('button', { name: 'Log an expense' }).click();
await f.locator('#expense-amount').fill('31.40');
await f.locator('#expense-description').fill('Inside an iframe');
await f.locator('.sheet').getByRole('button', { name: 'Save expense' }).click();
await p.waitForTimeout(700);
// Does IndexedDB inside the frame survive a reload of the host page?
await p.reload();
await p.waitForTimeout(1500);
const f2 = p.frameLocator('iframe');
const txt = await f2.locator('.list__item').first().innerText().catch(() => '');
const box = await p.locator('iframe').boundingBox();
console.log('persisted row:', JSON.stringify(txt.replace(/\n/g, ' | ')));
console.log('frame fills host:', Math.round(box.width) + 'x' + Math.round(box.height));
await p.screenshot({ path: 'screenshots/ha-iframe.png' });
await b.close();
if (!txt.includes('Inside an iframe')) { console.log('FAIL: data did not persist in the iframe'); process.exit(1); }
if (errs.length) { console.log('errors:\n' + errs.join('\n')); process.exit(1); }
console.log('iframe + IndexedDB OK');
