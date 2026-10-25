/** Optional real-browser QA. Requires Playwright and a compatible Chrome binary.
 * PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
 * CHROME_BIN='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
 * node test/browser-smoke.mjs
 * Start `npm start` separately. No secrets or internal engine state are read.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const moduleName = process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(moduleName.startsWith('/') ? pathToFileURL(moduleName).href : moduleName);
const base = process.env.HEIST_URL || 'http://127.0.0.1:3000';
const artifactDir = resolve('artifacts/browser');
await mkdir(artifactDir, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}) });
const contexts = [];
const errors = [];
const checks = [];
const screenshots = [];

function check(name, value = true) { assert.ok(value, name); checks.push(name); console.log(`PASS ${name}`); }
async function page(viewport = { width: 1440, height: 1000 }) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  contexts.push(context);
  const result = await context.newPage();
  result.on('pageerror', error => errors.push(error.message));
  return result;
}
async function shot(target, name) {
  const path = resolve(artifactDir, `${name}.png`);
  await target.screenshot({ path, fullPage: true, animations: 'disabled' });
  screenshots.push(path);
}
async function noOverflow(target, label) {
  const dimensions = await target.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth }));
  check(`${label}: no horizontal overflow`, dimensions.document <= dimensions.viewport + 1);
}
async function clue(target) { return target.locator('.clue p').allTextContents(); }
async function waitStage(target, kind) {
  const selector = kind === 'keypad' ? '#code-input' : kind === 'wires' ? '[data-action="option"][data-option="cyan"]' : '[data-action="option"][data-option="iris"]';
  await target.locator(selector).waitFor();
}
async function readClues(crew) {
  return Object.fromEntries(await Promise.all(Object.entries(crew).map(async ([role, target]) => [role, (await clue(target)).join(' ')])));
}
function solveLock(clues) {
  const order = clues.architect.match(/order: (.*?)\. This order/)[1].split(' → ');
  const mappings = Object.fromEntries([...`${clues.cipher} ${clues.lookout}`.matchAll(/(MOON|EYE|CROWN|STAR) = (\d)/g)].map(match => [match[1], match[2]]));
  const answer = order.map(symbol => mappings[symbol]).join('');
  assert.match(answer, /^\d{4}$/);
  return answer;
}
function solveWire(clues, options) {
  const terminal = clues.architect.match(/TERMINAL ([AB])/)[1];
  const pulse = clues.cipher.match(/an (ODD|EVEN) pulse/)[1];
  const seal = clues.lookout.match(/a (BROKEN|INTACT) seal/)[1];
  const matching = options.filter(option => option.detail === `Terminal ${terminal} · ${pulse} pulse · ${seal} seal`);
  assert.equal(matching.length, 1, 'Exactly one public wire matches combined crew intelligence');
  return matching[0].id;
}
function solveDoor(clues) {
  const ring = clues.architect.match(/clockwise: (.*?) → back/)[1].split(' → ').map(value => value.toLowerCase());
  const slot = Number(clues.cipher.match(/SLOT (\d)/)[1]);
  const shift = Number(clues.lookout.match(/FORWARD (\d)/)[1]);
  return ring[(slot - 1 + shift) % 3];
}

try {
  const host = await page();
  await host.goto(base, { waitUntil: 'domcontentloaded' });
  await host.getByRole('button', { name: 'Begin heist', exact: false }).waitFor();
  await shot(host, '01-briefing-desktop');
  await noOverflow(host, 'Desktop briefing');
  await host.getByRole('button', { name: 'Assemble your crew', exact: false }).click();
  await host.locator('#crew-link').waitFor();
  const crewUrl = await host.locator('#crew-link').inputValue();
  const roomId = crewUrl.split('/').at(-1);
  assert.match(roomId, /^[A-F0-9]{6}$/);
  await host.getByRole('button', { name: 'Close dialog' }).click();
  check('Mission created through host UI');

  const crew = {};
  for (const role of ['cipher', 'architect', 'lookout']) {
    const target = await page();
    crew[role] = target;
    await target.goto(crewUrl, { waitUntil: 'domcontentloaded' });
    await target.getByLabel('YOUR CREW CALLSIGN').fill(`QA ${role}`);
    await target.getByLabel('SPECIALIST ASSIGNMENT').selectOption(role);
    await target.getByRole('button', { name: 'Join the crew', exact: false }).click();
    await target.locator('.clue p').waitFor();
    check(`${role} joins and receives a private dossier`, (await clue(target)).length > 0);
  }
  await host.getByText('3 ASSIGNED', { exact: true }).waitFor();
  const all = await readClues(crew);
  check('Three role dossiers differ', new Set(Object.values(all)).size === 3);
  const publicResponse = await host.request.get(`${base}/api/rooms/${roomId}/state`);
  const publicState = await publicResponse.json();
  check('Public projection omits dossiers and solutions', !('dossier' in publicState) && !('puzzles' in publicState) && !('secretSeed' in publicState));
  await host.getByRole('button', { name: 'Begin heist', exact: false }).click();
  await waitStage(host, 'keypad');
  check('Host starts authoritative mission clock');

  await host.getByRole('button', { name: 'Pause mission', exact: true }).click();
  await host.getByText('CLOCK PAUSED', { exact: true }).waitFor();
  const frozen = await host.locator('[data-clock]').first().innerText();
  await host.waitForTimeout(1250);
  assert.equal(await host.locator('[data-clock]').first().innerText(), frozen);
  check('Paused clock stays frozen');
  check('Paused host code input disabled', await host.locator('#code-input').isDisabled());
  await host.getByRole('button', { name: 'Resume mission', exact: true }).click();
  await host.getByText('TIME TO LOCKDOWN', { exact: true }).waitFor();
  check('Resume restores controls', await host.locator('#code-input').isEnabled());

  for (const target of Object.values(crew)) await target.getByRole('button', { name: 'Relay my clue', exact: false }).click();
  await host.getByText(all.architect, { exact: true }).waitFor();
  check('Crew clues relay to host communications over SSE');
  await shot(host, '02-active-host');
  await shot(crew.architect, '03-private-dossier');
  await host.locator('#code-input').fill(solveLock(all));
  await host.getByRole('button', { name: 'Unlock vault', exact: false }).click();
  await waitStage(host, 'wires');
  for (const target of Object.values(crew)) await target.getByText('02 / DISARM', { exact: false }).first().waitFor();
  check('Solving outer lock synchronizes stage two across crew');

  const wireClues = await readClues(crew);
  const options = await host.locator('[data-action="option"]').evaluateAll(items => items.map(item => ({ id: item.dataset.option, detail: item.querySelector('small').textContent })));
  const wire = solveWire(wireClues, options);
  await crew.cipher.locator(`[data-action="vote"][data-option="${wire}"]`).click();
  await host.locator(`[data-action="option"][data-option="${wire}"] .vote-count`).filter({ hasText: '1 VOTES' }).waitFor();
  check('Viewer vote updates the host wire option');
  await host.locator(`[data-action="option"][data-option="${wire}"]`).click();
  await host.getByRole('button', { name: 'Cut selected wire', exact: false }).click();
  await waitStage(host, 'doors');
  for (const target of Object.values(crew)) await target.getByText('03 / EXTRACT', { exact: false }).first().waitFor();
  check('Combined role constraints solve the alarm stage');
  const doorClues = await readClues(crew);
  const door = solveDoor(doorClues);
  await shot(host, '04-exit-puzzle');
  await host.locator(`[data-action="option"][data-option="${door}"]`).click();
  await host.getByRole('button', { name: 'Take this exit', exact: false }).click();
  await host.getByRole('heading', { name: 'The perfect getaway' }).waitFor();
  for (const target of Object.values(crew)) await target.getByRole('heading', { name: 'The perfect getaway' }).waitFor();
  check('All three stages complete through browser controls');
  await shot(host, '05-success-desktop');

  const overlay = await page({ width: 1920, height: 1080 });
  await overlay.goto(`${base}/overlay/${roomId}`, { waitUntil: 'domcontentloaded' });
  await overlay.getByRole('heading', { name: 'The perfect getaway' }).waitFor();
  check('OBS overlay shows shared outcome without operator controls', await overlay.locator('button').count() === 0);
  await shot(overlay, '06-overlay');

  await host.getByRole('button', { name: 'Run a new heist', exact: false }).click();
  await host.getByRole('button', { name: 'Begin heist', exact: false }).waitFor();
  await host.getByRole('button', { name: 'Begin heist', exact: false }).click();
  await waitStage(host, 'keypad');
  await host.setViewportSize({ width: 390, height: 844 });
  await host.reload({ waitUntil: 'domcontentloaded' });
  await waitStage(host, 'keypad');
  await shot(host, '07-mobile-host');
  await noOverflow(host, 'Mobile host');
  const mobilePauseVisible = await host.getByRole('button', { name: 'Pause mission', exact: true }).isVisible();
  check('Mobile host retains pause control', mobilePauseVisible);
  await crew.cipher.setViewportSize({ width: 390, height: 844 });
  await shot(crew.cipher, '08-mobile-crew');
  await noOverflow(crew.cipher, 'Mobile crew');

  await host.setViewportSize({ width: 1440, height: 1000 });
  for (const target of Object.values(crew)) await target.locator('.clue p').waitFor();
  const newCode = solveLock(await readClues(crew));
  const wrongCode = newCode === '0000' ? '1111' : '0000';
  for (let index = 1; index <= 3; index += 1) {
    await host.locator('#code-input').fill(wrongCode);
    await host.getByRole('button', { name: 'Unlock vault', exact: false }).click();
    await host.locator(`.alarm-dots[aria-label="${index} of 3 security strikes"]`).waitFor();
  }
  await host.getByRole('heading', { name: 'Crew compromised' }).waitFor();
  check('Three incorrect moves trigger a synchronized failure');
  await shot(host, '09-failure');
  await host.getByRole('button', { name: 'Run a new heist', exact: false }).click();
  await host.getByRole('button', { name: 'Begin heist', exact: false }).waitFor();
  check('Reset restores briefing and clears strikes', await host.locator('.alarm-dots[aria-label="0 of 3 security strikes"]').isVisible());

  const badRole = await host.request.post(`${base}/api/rooms/${roomId}/join`, { data: { name: 'Invalid role', role: 'overseer' } });
  assert.equal(badRole.status(), 400);
  check('Unknown role cannot be joined');
  const drafting = await page({ width: 390, height: 844 });
  await drafting.goto(crewUrl, { waitUntil: 'domcontentloaded' });
  await drafting.getByLabel('YOUR CREW CALLSIGN').fill('Draft survives');
  await drafting.getByLabel('SPECIALIST ASSIGNMENT').selectOption('lookout');
  await crew.cipher.locator('#chat-input').fill('Crew update while a new specialist is joining.');
  await crew.cipher.getByRole('button', { name: 'Send', exact: false }).click();
  await host.getByText('Crew update while a new specialist is joining.', { exact: true }).waitFor();
  assert.equal(await drafting.getByLabel('YOUR CREW CALLSIGN').inputValue(), 'Draft survives');
  assert.equal(await drafting.getByLabel('SPECIALIST ASSIGNMENT').inputValue(), 'lookout');
  check('Joining viewer keeps callsign and selected role across live updates');
  const hostile = await page();
  await hostile.goto(crewUrl, { waitUntil: 'domcontentloaded' });
  const hostileName = '<img src=x onerror=1>';
  await hostile.getByLabel('YOUR CREW CALLSIGN').fill(hostileName);
  await hostile.getByLabel('SPECIALIST ASSIGNMENT').selectOption('cipher');
  await hostile.getByRole('button', { name: 'Join the crew', exact: false }).click();
  await hostile.locator('.clue p').waitFor();
  await hostile.locator('#chat-input').fill('<script>alert(1)</script>');
  await hostile.getByRole('button', { name: 'Send', exact: false }).click();
  await host.getByText(hostileName, { exact: true }).waitFor();
  check('Hostile names and messages remain escaped text', await host.locator('img').count() === 0 && (await host.locator('.message p').last().innerText()) === '<script>alert(1)</script>');
  check('No browser runtime errors', errors.length === 0);
  await writeFile(resolve(artifactDir, 'report.json'), JSON.stringify({ success: true, checks, errors, screenshots }, null, 2));
  console.log(JSON.stringify({ success: true, checks: checks.length, screenshots: screenshots.length }));
} catch (error) {
  for (const [index, context] of contexts.entries()) { for (const target of context.pages()) { try { await shot(target, `failure-context-${index}`); await writeFile(resolve(artifactDir, `failure-context-${index}.html`), await target.content()); } catch {} } }
  await writeFile(resolve(artifactDir, 'report.json'), JSON.stringify({ success: false, checks, errors, screenshots, failure: error.stack }, null, 2));
  console.error(error);
  process.exitCode = 1;
} finally {
  for (const context of contexts) await context.close();
  await browser.close();
}
