// Natural-play screenshot tour against a REAL (production) server: no test hooks.
// The host console creates a session with HOST_KEY and fills empty seats with CPU guests.
// Three players then walk from the party, room by room through real doorways, into
// the bedroom wing and hide:
//  - Julian (phone 390x844): Grand Portrait Gallery -> Sculpture Vault -> Study ->
//    Portrait Corridor -> Master Bedroom, then under the four-poster.
//  - Anika (desktop 1280x800): Gallery -> Sculpture Vault -> Study ->
//    Corridor -> Guest Bedroom, then inside the wardrobe.
//  - Marcus (phone): the same route as Julian, into the Spare Bedroom and under the single bed.
// CPU zombies play for real, so a player may be caught on the way. That is reported, not failed.
//
//   HOST_KEY=... BROWSER=... PLAYWRIGHT=... node tools/e2e/cloud-tour.mjs https://<server> [outDir]
// Never prints the host key.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT ? `file://${process.env.PLAYWRIGHT.replace(/\\/g, '/')}/index.mjs` : 'playwright-core');
const base = process.argv[2] || 'http://localhost:2567';
const out = process.argv[3] || 'cloud-tour-out';
mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const report = { steps: [], errors: [], checks: {} };
const step = s => { report.steps.push(s); console.log(s); };
const shot = (p, name) => p.screenshot({ path: join(out, `${name}.png`) }).catch(e => report.errors.push(`shot ${name}: ${e.message}`));
const view = p => p.evaluate(() => window.__hgView);

const ROUTES = {
  julian: { room: 'master_bedroom', spot: 'under_fourposter', via: ['sculpture', 'study', 'corridor', 'master_bedroom'] },
  anika: { room: 'guest_bedroom', spot: 'guest_wardrobe', via: ['sculpture', 'study', 'corridor', 'guest_bedroom'] },
  marcus: { room: 'spare_bedroom', spot: 'under_single_bed', via: ['sculpture', 'study', 'corridor', 'spare_bedroom'] },
};

// Tap like a person: if the button was redrawn mid-tap, look again and tap again.
async function tap(p, sel) {
  for (let i = 0; i < 8; i++) {
    if (await p.locator(sel).first().click({ timeout: 4000 }).then(() => true, () => false)) return;
    await sleep(300);
  }
  await p.screenshot({ path: join(out, `failed-tap-${Date.now()}.png`) }).catch(() => {});
  const v = await p.evaluate(() => window.__hgView?.me).catch(() => null);
  throw new Error(`could not tap ${sel} (room ${v?.room}, zone ${v?.zone}, caught ${v?.caught}, moving ${v?.moving}, intent ${JSON.stringify(v?.intent)})`);
}

// Walk room by room (only the current and adjacent rooms are offered), then hide.
async function walkAndHide(id, p, onRoom) {
  const r = ROUTES[id];
  await p.click('[data-act="pace"][data-pace="run"]').catch(() => {});
  // Natural play: a CPU zombie may catch this player on the way. That is reported, not failed.
  const caught = async () => { const v = await view(p); return v?.role === 'hunter' || v?.me?.caught || v?.me?.intent?.reason === 'Caught'; };
  for (const room of r.via) {
    if (await caught()) return `caught on the way to ${room} (natural play)`;
    try {
      if (room === r.room) {
        await tap(p, `.room-card[data-room="${room}"]`);
        await tap(p, `[data-act="hide"][data-spot="${r.spot}"]`);
      } else {
        await tap(p, `.room-card[data-room="${room}"]`);
        await tap(p, `[data-act="go"][data-room="${room}"]`);
      }
    } catch (e) {
      if (await caught()) return `caught on the way to ${room} (natural play)`;
      throw e;
    }
    await onRoom?.(room, 'leaving');
    const ok = await p.waitForFunction(rm => {
      const v = window.__hgView; const me = v?.me;
      return me?.caught || v?.role === 'hunter' || (me?.room === rm && !me?.moving);
    }, room, { timeout: 60000 }).then(() => true, () => false);
    if (!ok) return `timed out walking to ${room}`;
    await onRoom?.(room, 'arrived');
  }
  const done = await p.waitForFunction(() => window.__hgView?.me?.hideState === 'hidden' || window.__hgView?.me?.caught || window.__hgView?.role === 'hunter', null, { timeout: 20000 }).then(() => true, () => false);
  const v = await view(p);
  return done ? (v?.me?.hideState === 'hidden' ? `hidden (${v.me.pose}) in ${v.me.room}` : `caught/turned in ${v?.me?.room}`) : 'did not settle into cover';
}

const browser = await chromium.launch({ executablePath: process.env.BROWSER, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
try {
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  host.on('pageerror', e => report.errors.push(`host: ${e.message}`));
  await host.goto(`${base}/host.html`, { timeout: 120000 });
  await host.fill('#h-key', process.env.HOST_KEY || '');
  await host.click('#h-create');
  await host.waitForFunction(() => /^[A-Z2-9]{5}$/.test(document.getElementById('h-code').textContent), null, { timeout: 20000 });
  const code = await host.textContent('#h-code');
  report.checks.qrUrl = await host.inputValue('#h-url');
  await shot(host, '00-desktop-host-console-qr');
  step(`session created; QR link ${report.checks.qrUrl}`);

  const players = {};
  const specs = [['julian', 'Jules', 'phone'], ['anika', 'Ani', 'desktop'], ['marcus', 'Mark', 'phone']];
  for (const [id, name, kind] of specs) {
    const ctx = kind === 'phone'
      ? await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
      : await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const p = await ctx.newPage();
    p.on('pageerror', e => report.errors.push(`${id}: ${e.message}`));
    await p.goto(report.checks.qrUrl, { timeout: 120000 }); // exactly what scanning the QR opens
    await p.fill('#join-name', name);
    await p.click('#join-go');
    await p.waitForSelector('#screen-lobby:not([hidden])');
    if (id === 'julian') await shot(p, '01-phone-choose-your-guest');
    await p.click(`[data-claim="${id}"]`);
    players[id] = p;
  }
  const { julian, anika, marcus } = players;
  await host.waitForFunction(() => document.querySelector('#h-stats')?.textContent.includes('3joined'), null, { timeout: 20000 });
  await shot(host, '02-desktop-host-lobby-3-joined');
  await host.click('#h-start'); // CPU fill stays on: all 13 guests + Elias
  await sleep(6000);
  await shot(anika, '03-desktop-opening-party');
  await shot(julian, '04-phone-opening-party');
  await julian.waitForFunction(() => document.getElementById('hud-phase')?.textContent === 'Survive', null, { timeout: 60000 });
  report.checks.countdown = await julian.textContent('#hud-timer');
  report.checks.clock = await julian.textContent('#hud-clock');
  report.checks.actorsSeenAtStart = (await view(julian))?.actors?.length;
  step(`hunt started: countdown ${report.checks.countdown} (${report.checks.clock}); julian sees ${report.checks.actorsSeenAtStart} others`);
  await shot(julian, '05-phone-hunt-begins-room-cards');

  const tours = [
    walkAndHide('julian', julian, async (room, when) => {
      if (room === 'corridor' && when === 'leaving') { await sleep(1800); await shot(julian, '06-phone-running-into-portrait-corridor'); }
      if (room === 'master_bedroom' && when === 'leaving') { await sleep(2500); await shot(julian, '08-phone-on-the-way-to-master-bedroom'); }
      if (room === 'corridor' && when === 'arrived') await shot(julian, '07-phone-corridor-bedroom-cards');
    }),
    walkAndHide('anika', anika, async (room, when) => {
      if (room === 'study' && when === 'leaving') { await sleep(1500); await shot(anika, '09-desktop-travel-to-curators-study'); }
      if (room === 'guest_bedroom' && when === 'leaving') { await sleep(2500); await shot(anika, '10-desktop-on-the-way-to-guest-bedroom'); }
    }),
    walkAndHide('marcus', marcus, async (room, when) => {
      if (room === 'spare_bedroom' && when === 'leaving') { await sleep(2500); await shot(marcus, '12-phone-on-the-way-to-spare-bedroom'); }
    }),
  ];
  const [j, a, m] = await Promise.all(tours);
  report.checks.julian = j; report.checks.anika = a; report.checks.marcus = m;
  step(`julian: ${j}\nanika: ${a}\nmarcus: ${m}`);
  await sleep(1500);
  await shot(julian, '13-phone-first-person-under-four-poster');
  await shot(anika, '14-desktop-first-person-inside-wardrobe');
  await shot(marcus, '15-phone-first-person-under-single-bed');
  await sleep(15000);
  await shot(julian, '16-phone-under-bed-later');
  await shot(host, '17-desktop-host-console-during-hunt');
  report.checks.timerLater = await julian.textContent('#hud-timer');
  step(`countdown after the tour: ${report.checks.timerLater}`);
} catch (e) {
  report.errors.push(`FAILED: ${e.message}`);
  console.error(e.message);
} finally {
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ checks: report.checks, errors: report.errors }, null, 2));
