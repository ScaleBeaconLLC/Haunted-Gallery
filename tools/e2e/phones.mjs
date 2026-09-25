// Multi-phone smoke test: a host console plus N phone-sized touch browsers join by
// code, pick guests, start a match, play rounds (move/hide/SOS) and capture
// screenshots, console errors and frame pacing. Needs a running server with the
// built client (server: `npm start`, client: `npm run build`).
//
//   BROWSER="C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
//   PLAYWRIGHT=path/to/node_modules/playwright-core \
//   node tools/e2e/phones.mjs [baseUrl] [phones] [outDir]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT ? `file://${process.env.PLAYWRIGHT.replace(/\\/g, '/')}/index.mjs` : 'playwright-core');
const base = process.argv[2] || 'http://localhost:2567';
const phones = Number(process.argv[3] || 4);
const out = process.argv[4] || 'e2e-out';
mkdirSync(out, { recursive: true });
const CAST = ['julian', 'anika', 'marcus', 'mei', 'dev', 'amara', 'alex', 'andre', 'rafael', 'simone', 'owen', 'tessa', 'nia'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const report = { base, phones, errors: [], steps: [], fps: {} };
const step = s => { report.steps.push(`${new Date().toISOString().slice(11, 19)} ${s}`); console.log(s); };

const launch = () => chromium.launch({
  executablePath: process.env.BROWSER,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const browser = await launch();
// A single Chromium process caps active WebGL contexts (~16) and silently drops the
// oldest, which a real phone never hits; so put at most 4 phones in each process.
const extraBrowsers = [];
let phoneCount = 0;
async function phoneBrowser() {
  const group = Math.floor(phoneCount++ / 4);
  if (group === 0) return browser;
  if (!extraBrowsers[group - 1]) extraBrowsers[group - 1] = await launch();
  return extraBrowsers[group - 1];
}
try {
  const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const host = await hostCtx.newPage();
  host.on('pageerror', e => report.errors.push(`host: ${e.message}`));
  await host.goto(`${base}/host.html`);
  await host.click('#h-create');
  await host.waitForFunction(() => /^[A-Z2-9]{5}$/.test(document.getElementById('h-code').textContent), null, { timeout: 15000 });
  const code = await host.textContent('#h-code');
  step(`host created session ${code}; join URL ${await host.inputValue('#h-url')}`);

  const pages = [];
  for (let i = 0; i < phones; i++) {
    const ctx = await (await phoneBrowser()).newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const p = await ctx.newPage();
    p.on('pageerror', e => report.errors.push(`phone${i}: ${e.message}`));
    p.on('console', m => { if (m.type() === 'error') report.errors.push(`phone${i} console: ${m.text()}`); });
    await p.goto(`${base}/?code=${code}&debug=1`);
    await p.fill('#join-name', `Tester${i + 1}`);
    await p.click('#join-go');
    await p.waitForSelector('#screen-lobby:not([hidden])', { timeout: 20000 });
    await p.click(`[data-claim="${CAST[i]}"]`);
    pages.push(p);
  }
  await pages[0].waitForFunction(n => document.querySelectorAll('.cast.taken, .cast.mine').length >= n, phones, { timeout: 10000 });
  await pages[0].screenshot({ path: join(out, '01-lobby.png') });
  step(`${phones} phones joined and claimed guests`);

  await host.waitForFunction(() => !document.getElementById('h-start').disabled);
  await host.click('#h-start');
  await sleep(4000);
  await pages[0].screenshot({ path: join(out, '02-opening.png') });
  await host.screenshot({ path: join(out, '02-host.png') });
  step('match started (opening cinematic)');

  await pages[0].waitForSelector('[data-act="move"]', { timeout: 40000 });
  await pages[0].screenshot({ path: join(out, '03-choice-round1.png') });
  step('round 1 choices visible');
  // Round 1: phones 3+ flee the gallery right away (in parallel). Phones 0-2 act after
  // the SOS so the window doesn't close early.
  const flee = async (p, i) => {
    const moves = await p.$$('[data-act="move"]');
    if (!moves.length) return false;
    return moves[i % moves.length].click().then(() => true, () => false);
  };
  let moved = (await Promise.all(pages.slice(3).map((p, k) => flee(p, k + 3)))).filter(Boolean).length;
  // SOS from phone 0 to phone 1.
  await pages[0].click('[data-act="sos-open"]');
  await pages[0].click(`#sheet [data-act="sos-to"][data-to="${CAST[1]}"]`);
  await pages[0].screenshot({ path: join(out, '04-sos-compose.png') });
  await pages[0].click('#sheet [data-act="sos-send"][data-preset="come_get_me"]');
  await pages[1].waitForSelector('.sos', { timeout: 5000 });
  await pages[1].screenshot({ path: join(out, '05-sos-received.png') });
  const leak = await Promise.all(pages.slice(2).map(p => p.$('.sos')));
  report.sosLeakToOthers = leak.some(Boolean);
  step(`SOS delivered privately (leak to others: ${report.sosLeakToOthers})`);
  await pages[1].click('.sos [data-act="sos-reply"][data-reply="coming"]');
  await pages[1].click('.sos [data-act="sos-map"]');
  await pages[1].screenshot({ path: join(out, '06-sos-map.png') });
  await pages[1].click('#sheet [data-act="close"]');
  moved += (await Promise.all(pages.slice(0, 3).map((p, i) => flee(p, i)))).filter(Boolean).length;
  step(`${moved}/${pages.length} phones chose a move in round 1`);

  await pages[0].waitForFunction(() => document.getElementById('hud-phase').textContent === 'Moving', null, { timeout: 30000 });
  await sleep(3500);
  await pages[0].screenshot({ path: join(out, '07-travel.png') });
  step('travel phase animating');
  await pages[0].waitForFunction(() => document.getElementById('hud-phase').textContent === 'The hunt', null, { timeout: 20000 });
  await pages[0].screenshot({ path: join(out, '08-hunt.png') });

  // Round 2: every living survivor hides (infected players get hunter controls instead).
  await pages[0].waitForFunction(() => /Round 2/.test(document.getElementById('hud-phase').textContent), null, { timeout: 40000 });
  await sleep(800);
  const hid = (await Promise.all(pages.map(async p => { const h = await p.$('[data-act="hide"]'); return h ? h.click().then(() => true, () => false) : false; }))).filter(Boolean).length;
  const hunters = (await Promise.all(pages.map(p => p.$('[data-act="hunt"]')))).filter(Boolean).length;
  await pages[0].screenshot({ path: join(out, '09-round2.png') });
  step(`round 2: ${hid} phones hid, ${hunters} phones show hunter controls`);
  await sleep(9000);
  await pages[0].screenshot({ path: join(out, '10-round2-later.png') });
  // Every phone must still be rendering 3D (canvas not blank) and report its frame stats.
  for (const [i, p] of pages.entries()) {
    report.fps[`phone${i}`] = await p.textContent('#debug');
    const lit = await p.evaluate(() => {
      const c = document.getElementById('stage');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      return gl ? !gl.isContextLost() : false;
    });
    if (!lit) report.errors.push(`phone${i}: WebGL context lost`);
  }
  await host.screenshot({ path: join(out, '11-host-live.png') });

  // Pause/resume through the host console.
  await host.click('#h-pause');
  await pages[0].waitForFunction(() => document.getElementById('hud-phase').textContent.includes('Paused'), null, { timeout: 5000 });
  step('host pause reached phones');
  await host.click('#h-pause');
  step('resumed');
} catch (e) {
  report.errors.push(`FAILED: ${e.message}`);
  console.error(e);
} finally {
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  for (const b of extraBrowsers) await b.close();
}
console.log(JSON.stringify({ errors: report.errors, fps: report.fps, sosLeakToOthers: report.sosLeakToOthers }, null, 2));
