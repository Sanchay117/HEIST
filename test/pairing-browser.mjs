/** Browser regression: real app UI + local HTTP/SSE + test-only mocked Twitch.
 * Uses PLAYWRIGHT_MODULE and CHROME_BIN like browser-smoke.mjs. No live Twitch calls.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startTwitchFixture } from './support/twitch-fixture.mjs';
import { PAIRING_TTL_MS } from '../lib/pairing.mjs';

const moduleName = process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(moduleName.startsWith('/') ? pathToFileURL(moduleName).href : moduleName);
const f = await startTwitchFixture();
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}) });
const checks = [], errors = [], screenshots = [];
const dir = resolve('artifacts/pairing-browser');
await mkdir(dir, { recursive: true });
const check = (name, value = true) => { assert.ok(value, name); checks.push(name); console.log(`PASS ${name}`); };
async function page(width = 1440) {
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  return page;
}
async function shot(page, name) { const path = resolve(dir, `${name}.png`); await page.screenshot({ path, fullPage: true }); screenshots.push(path); }
async function getCode(page) {
  await page.getByRole('button', { name: 'Get pairing code', exact: true }).click();
  await page.locator('#pair-command').waitFor();
  return (await page.locator('#pair-command').inputValue()).slice(6);
}
async function confirm(page, name) {
  await page.getByRole('button', { name: 'Confirm account' }).waitFor();
  check('Claim requires explicit account confirmation before clues', await page.locator('.clue').count() === 0);
  await page.getByRole('button', { name: 'Confirm account' }).click();
  await page.locator('.clue p').waitFor();
  await page.locator('.identity-banner').filter({ hasText: name }).waitFor();
}
async function sendText(page, text) {
  await page.getByLabel('TRANSMIT', { exact: true }).fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}
async function allDemoClues(host) {
  await host.getByRole('button', { name: 'Try with a demo crew' }).click();
  await host.getByRole('button', { name: 'Ask all three specialists' }).click();
  await host.locator('#modal-backdrop').waitFor({ state: 'detached' });
  return host.locator('.comms .message p').allTextContents();
}

try {
  const host = await page(); await host.goto(f.base);
  await host.getByRole('button', { name: 'Create live mission' }).click();
  await host.waitForURL(/\/play\/[A-F0-9]{6}$/);
  const roomId = new URL(host.url()).pathname.split('/').at(-1);
  const companionUrl = `${f.base}/crew/${roomId}`;
  const one = await page(390); await one.goto(companionUrl);
  await one.getByText('Twitch pairing unavailable.', { exact: false }).waitFor();
  check('Disconnected bridge locks the live companion', await one.locator('#join-form,.clue,[data-action="vote"]').count() === 0);
  await shot(one, '01-unavailable-mobile');
  await host.getByRole('button', { name: 'Connect Twitch', exact: true }).click();
  await host.getByText('Connected to test_channel', { exact: true }).waitFor();
  await one.getByRole('button', { name: 'Get pairing code', exact: true }).waitFor();
  const firstCode = await getCode(one);
  check('Unlinked browser waits without revealing a dossier or voting controls', await one.locator('.clue,[data-action="vote"],#chat-form').count() === 0);
  await shot(one, '02-pending-mobile');
  await f.send('999', `!link ${firstCode}`, 'Nightowl');
  await confirm(one, 'Nightowl');
  check('Companion-first pairing receives the canonical role', (await one.locator('.dossier-top h2').innerText()).includes('Cipher'));
  await f.send('999', '!heist', 'Nightowl');

  const two = await page(); await two.goto(companionUrl);
  const secondCode = await getCode(two);
  await f.send('999', `!link ${secondCode}`, 'Nightowl'); await confirm(two, 'Nightowl');
  check('Chat-first second browser receives exactly the same role and dossier', (await one.locator('.clue p').allTextContents()).join('') === (await two.locator('.clue p').allTextContents()).join(''));
  await host.locator('.sidebar [data-tab="mission"]').click();
  await host.getByText('1 ASSIGNED', { exact: true }).waitFor();
  await host.getByRole('button', { name: 'Begin heist' }).click();
  await f.send('999', '!vote 1234', 'Nightowl');
  await one.locator('[data-own-vote]').filter({ hasText: '1234' }).waitFor();
  await two.locator('[data-own-vote]').filter({ hasText: '1234' }).waitFor();
  await sendText(one, '!vote 5678');
  await two.locator('[data-own-vote]').filter({ hasText: '5678' }).waitFor();
  await f.send('999', '!vote 4321', 'Nightowl');
  await one.locator('[data-own-vote]').filter({ hasText: '4321' }).waitFor();
  const current = (await f.call(`/api/rooms/${roomId}/state`)).body;
  check('Twitch and both browsers replace one shared vote', current.crew.total === 1 && current.votes.length === 1 && current.votes[0].count === 1 && current.votes[0].optionId === '4321');
  await shot(one, '03-linked-mobile');
  await shot(two, '04-linked-desktop');

  await f.send('888', `!link ${firstCode}`, 'OtherViewer');
  check('Replaying a code cannot silently change the browser account', (await one.locator('.identity-banner').innerText()).includes('Nightowl'));
  const three = await page(); await three.goto(companionUrl); await getCode(three);
  f.advance(PAIRING_TTL_MS);
  await three.getByRole('button', { name: 'Get a new pairing code' }).waitFor();
  check('Expired code gets a clear recovery action with clues still locked', await three.locator('.clue').count() === 0);
  await shot(three, '05-expired-desktop');
  await host.getByRole('button', { name: 'Broadcast setup', exact: true }).click();
  await host.getByRole('button', { name: 'Disconnect Twitch', exact: true }).click();
  await three.getByText('Twitch pairing unavailable.', { exact: false }).waitFor();
  await one.locator('.identity-banner').filter({ hasText: 'Twitch is disconnected' }).waitFor();
  check('Disconnect disables pending pairing and clearly preserves existing verified links');
  await host.getByRole('button', { name: 'Connect Twitch', exact: true }).click();
  await three.getByRole('button', { name: 'Get a new pairing code' }).waitFor();
  check('Reconnection restores pairing recovery without duplicating existing members');
  check('Mobile pairing has no horizontal overflow', await one.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  // Preserve the original single-person rehearsal, using only public demo clues.
  f.advance(-PAIRING_TTL_MS);
  const solo = await page(); await solo.goto(f.base);
  await solo.getByRole('button', { name: 'Begin heist' }).click();
  let clues = await allDemoClues(solo);
  const text = clues.join(' ');
  const order = text.match(/plates in this order: (.*?)\. This order/)[1].split(' → ');
  const map = Object.fromEntries([...text.matchAll(/(MOON|EYE|CROWN|STAR) = (\d)/g)].map(match => [match[1], match[2]]));
  const answer=order.map(symbol => map[symbol]).join('');
  assert.match(answer,/^\d{4}$/);
  await solo.getByLabel('Four digit access code').fill(answer);
  await solo.getByRole('button', { name: 'Unlock vault' }).click();
  await solo.locator('[data-action="option"][data-option="cyan"]').waitFor({timeout:8000});
  clues = await allDemoClues(solo);
  const wireText = clues.slice(-3).join(' ');
  const terminal = wireText.match(/TERMINAL ([AB])/)[1], pulse = wireText.match(/an (ODD|EVEN) pulse/)[1], seal = wireText.match(/a (BROKEN|INTACT) seal/)[1];
  const option = solo.locator('[data-action="option"]').filter({ hasText: `Terminal ${terminal} · ${pulse} pulse · ${seal} seal` });
  await option.click(); await solo.getByRole('button', { name: 'Cut selected wire' }).click();
  await solo.locator('[data-action="option"][data-option="iris"]').waitFor();
  clues = await allDemoClues(solo);
  const exitText = clues.slice(-3).join(' ');
  const ring = exitText.match(/clockwise: (.*?) → back/)[1].split(' → ').map(value => value.toLowerCase());
  const slot = Number(exitText.match(/SLOT (\d)/)[1]), shift = Number(exitText.match(/FORWARD (\d)/)[1]);
  await solo.locator(`[data-action="option"][data-option="${ring[(slot - 1 + shift) % 3]}"]`).click();
  await solo.getByRole('button', { name: 'Take this exit' }).click();
  await solo.getByRole('heading', { name: 'The perfect getaway' }).waitFor();
  check('Solo demo completes all three stages without Twitch or account pairing');
  await shot(solo, '06-solo-demo-success');
  check('No browser runtime errors', errors.length === 0);
  await writeFile(resolve(dir, 'report.json'), JSON.stringify({ success: true, twitchTransport: 'mocked, no real Twitch verification', checks, errors, screenshots }, null, 2));
  console.log(JSON.stringify({ success: true, checks: checks.length, screenshots: screenshots.length }));
} catch (error) {
  const failedPage=browser.contexts().at(-1)?.pages().at(-1);
  if(failedPage){await shot(failedPage,'failure');console.log((await failedPage.locator('body').innerText()).slice(-6000));}
  await writeFile(resolve(dir, 'report.json'), JSON.stringify({ success: false, error: error.stack, checks, errors, screenshots }, null, 2));
  throw error;
} finally { await browser.close(); await f.close(); }
