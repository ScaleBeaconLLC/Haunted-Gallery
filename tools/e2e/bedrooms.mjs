// Bedroom-wing scenario on a TEST server (HG_TEST_HOOKS=1), with a desktop browser and
// phone-sized browsers, capturing screenshots of the actual running game:
//  1. Julian (phone) picks the Master Bedroom card, travels (bird's-eye) and crawls under
//     the four-poster -> first-person view from under the bed.
//  2. Anika (desktop) walks into the Guest Bedroom and hides inside the wardrobe.
//  3. Marcus (phone) is secretly infected, walks in and searches under the bed; Julian sees
//     legs first and the face only when Marcus bends down; Julian is pulled out and caught.
// Also checks the 15:00 countdown and mansion clock, and collects page errors.
//
//   BROWSER=... PLAYWRIGHT=... node tools/e2e/bedrooms.mjs [baseUrl] [outDir]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT ? `file://${process.env.PLAYWRIGHT.replace(/\\/g, '/')}/index.mjs` : 'playwright-core');
const base = process.argv[2] || 'http://localhost:2570';
const out = process.argv[3] || 'bedrooms-out';
mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const report = { steps: [], errors: [], checks: {} };
const step = s => { report.steps.push(s); console.log(s); };
const shot = (p, name) => p.screenshot({ path: join(out, `${name}.png`) });
const view = p => p.evaluate(() => window.__hgView);

const browser = await chromium.launch({ executablePath: process.env.BROWSER, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
try {
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await host.goto(`${base}/host.html`);
  await host.click('#h-create');
  await host.waitForFunction(() => /^[A-Z2-9]{5}$/.test(document.getElementById('h-code').textContent));
  const code = await host.textContent('#h-code');
  const hook = payload => host.evaluate(p => window.__hgHost?.send('test:setup', p), payload);

  const players = {};
  const specs = [['julian', 'Jules', 'phone'], ['anika', 'Ani', 'desktop'], ['marcus', 'Mark', 'phone']];
  for (const [id, name, kind] of specs) {
    const ctx = kind === 'phone'
      ? await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
      : await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const p = await ctx.newPage();
    p.on('pageerror', e => report.errors.push(`${id}: ${e.message}`));
    await p.goto(`${base}/?code=${code}&debug=1`);
    await p.fill('#join-name', name);
    await p.click('#join-go');
    await p.waitForSelector('#screen-lobby:not([hidden])');
    await p.click(`[data-claim="${id}"]`);
    players[id] = p;
  }
  const { julian, anika, marcus } = players;
  await host.waitForFunction(() => document.querySelector('#h-stats')?.textContent.includes('3joined'));
  await host.uncheck('#h-cpu');
  await host.click('#h-start');
  await sleep(2500);
  await shot(anika, '00-desktop-opening');
  await hook({ skipOpening: true });
  await julian.waitForFunction(() => document.getElementById('hud-phase').textContent === 'Survive', null, { timeout: 15000 });
  const birthday = await host.evaluate(() => window.__hgHostState?.birthday);
  await hook({ inertCpu: true, place: { elias: [14, 8], [birthday]: [-11.75, 9], julian: [-10, 60], anika: [3, 59.5], marcus: [-20, 47] } });
  await sleep(800);
  report.checks.countdown = await julian.textContent('#hud-timer');
  report.checks.clock = await julian.textContent('#hud-clock');
  step(`hunt started; countdown ${report.checks.countdown} (${report.checks.clock})`);

  // 1. Julian: Master Bedroom card -> under the four-poster.
  await julian.waitForSelector('.room-card[data-room="master_bedroom"]');
  await shot(julian, '01-phone-corridor-room-cards');
  await julian.click('.room-card[data-room="master_bedroom"]');
  await shot(julian, '02-phone-master-bedroom-card-open');
  await julian.click('[data-act="pace"][data-pace="run"]').catch(() => {});
  await julian.click('[data-act="hide"][data-spot="under_fourposter"]');
  await sleep(1600);
  await shot(julian, '03-phone-running-down-the-portrait-corridor');
  await julian.waitForFunction(() => window.__hgView?.me?.room === 'master_bedroom', null, { timeout: 20000 });
  await sleep(700);
  await shot(julian, '04-phone-entering-master-bedroom');
  await julian.waitForFunction(() => window.__hgView?.me?.hideState === 'hidden', null, { timeout: 20000 });
  await sleep(1400);
  await shot(julian, '05-phone-first-person-under-the-bed');
  report.checks.julianPose = (await view(julian)).me.pose;
  step(`julian hidden under the four-poster (pose ${report.checks.julianPose})`);

  // 2. Anika (desktop): guest wardrobe.
  await anika.click('.room-card[data-room="guest_bedroom"]');
  await anika.click('[data-act="hide"][data-spot="guest_wardrobe"]');
  await sleep(1500);
  await shot(anika, '06-desktop-travel-into-guest-bedroom');
  await anika.waitForFunction(() => window.__hgView?.me?.hideState === 'hidden', null, { timeout: 25000 });
  await sleep(1400);
  await shot(anika, '07-desktop-first-person-inside-wardrobe');
  report.checks.anikaPose = (await view(anika)).me.pose;
  step(`anika hidden inside the guest wardrobe (pose ${report.checks.anikaPose})`);

  // 3. Marcus secretly turns and comes looking under the bed.
  await hook({ infect: ['marcus'] });
  await marcus.waitForSelector('#briefing:not([hidden])', { timeout: 10000 });
  await marcus.click('#briefing-ok');
  await marcus.click('.room-card[data-room="corridor"]');
  await marcus.waitForFunction(() => window.__hgView?.me?.room === 'corridor' && !window.__hgView?.me?.moving, null, { timeout: 30000 });
  await marcus.click('.room-card[data-room="master_bedroom"]');
  await marcus.waitForFunction(() => window.__hgView?.me?.room === 'master_bedroom' && !window.__hgView?.me?.moving, null, { timeout: 30000 });
  await shot(marcus, '08-phone-hunter-in-master-bedroom');
  let farNormal = null, revealed = false, searched = false;
  for (let i = 0; i < 160; i++) {
    const v = await view(julian);
    const m = v?.actors?.find(x => x.id === 'marcus');
    if (m && farNormal === null) { farNormal = !m.revealed; await shot(julian, '09-phone-from-under-bed-someone-enters'); }
    if (!searched) { await marcus.click('[data-act="search"][data-spot="under_fourposter"]').then(() => { searched = true; }, () => {}); }
    if (m?.action === 'searching' && !revealed) { await sleep(900); await shot(julian, '10-phone-under-bed-he-bends-down'); revealed = true; }
    if (v?.me?.caught) { await sleep(1200); await shot(julian, '11-phone-pulled-out-and-caught'); break; }
    await sleep(300);
  }
  report.checks.infectedLooksNormalAtFirst = farNormal;
  report.checks.searchSeenFromUnderBed = revealed;
  report.checks.julianCaught = !!(await view(julian))?.me?.caught || (await view(julian))?.status === 'infected';
  step(`search: normal at first=${farNormal}, bend seen=${revealed}, caught=${report.checks.julianCaught}`);
  await shot(host, '12-desktop-host-console');
} catch (e) {
  report.errors.push(`FAILED: ${e.message}`);
  console.error(e);
} finally {
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ checks: report.checks, errors: report.errors }, null, 2));
