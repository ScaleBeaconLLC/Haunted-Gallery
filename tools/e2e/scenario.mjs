// Scripted three-phone scenario against a TEST server (HG_TEST_HOOKS=1, not production):
//  1. Julian taps the Archive card, picks "Under the reading table", is watched walking
//     there in the bird's-eye view, then switches to first person once hidden; peeks.
//  2. Anika (a friend) walks into the Archive and joins him under the table: Julian's
//     view shows her approaching, never marked infected.
//  3. Marcus is secretly infected (test hook), gets the private briefing, walks into the
//     Archive and searches the table: Julian sees ordinary-looking legs until Marcus is
//     close and bending down — then the face is readable. Hiders are found and caught.
// Also records every message each phone receives and checks for leaks.
//
//   BROWSER=... PLAYWRIGHT=... node tools/e2e/scenario.mjs [baseUrl] [outDir]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT ? `file://${process.env.PLAYWRIGHT.replace(/\\/g, '/')}/index.mjs` : 'playwright-core');
const base = process.argv[2] || 'http://localhost:2570';
const out = process.argv[3] || 'scenario-out';
mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const report = { steps: [], errors: [], checks: {} };
const step = s => { report.steps.push(s); console.log(s); };
const shot = (p, name) => p.screenshot({ path: join(out, `${name}.png`) });

const browser = await chromium.launch({ executablePath: process.env.BROWSER, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
try {
  const host = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
  await host.goto(`${base}/host.html`);
  await host.click('#h-create');
  await host.waitForFunction(() => /^[A-Z2-9]{5}$/.test(document.getElementById('h-code').textContent));
  const code = await host.textContent('#h-code');
  // The host page's connection object isn't global; send hooks through a tiny helper.
  const hook = payload => host.evaluate(p => window.__hgHost?.send('test:setup', p), payload);

  const phones = {};
  for (const [id, name] of [['julian', 'Jules'], ['anika', 'Ani'], ['marcus', 'Mark']]) {
    const p = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
    p.on('pageerror', e => report.errors.push(`${id}: ${e.message}`));
    p.on('websocket', ws => ws.on('framereceived', f => { (p._ws ??= []).push(typeof f.payload === 'string' ? f.payload : Buffer.from(f.payload).toString('latin1')); }));
    await p.goto(`${base}/?code=${code}&debug=1`);
    await p.fill('#join-name', name);
    await p.click('#join-go');
    await p.waitForSelector('#screen-lobby:not([hidden])');
    await p.click(`[data-claim="${id}"]`);
    phones[id] = p;
  }
  const { julian, anika, marcus } = phones;
  await host.waitForFunction(() => document.querySelector('#h-stats')?.textContent.includes('3joined'));
  await host.uncheck('#h-cpu');
  await host.click('#h-start');
  await sleep(1500);
  await hook({ skipOpening: true });
  await julian.waitForFunction(() => document.getElementById('hud-phase').textContent === 'Survive', null, { timeout: 15000 });
  // Park the AI hunters out of the way and set the stage.
  await hook({ inertCpu: true, place: { elias: [26, 52], [await host.evaluate(() => window.__hgHostState?.birthday)]: [14, 52], julian: [9, 6], anika: [0, 30], marcus: [-3, 34] } });
  await sleep(600);
  step('hunt started; hunters parked; julian in the Archive, anika and marcus in the Sealed room');

  // 1. Room picture -> hiding place -> watch the walk -> first person.
  await julian.waitForSelector('.room-card');
  await shot(julian, '01-room-cards');
  await julian.click('.room-card[data-room="archive"]');
  await shot(julian, '02-archive-card-open');
  await julian.click('[data-act="hide"][data-spot="reading_alcove"]');
  await sleep(1200);
  const midHide = await julian.evaluate(() => document.getElementById('hud-status').textContent);
  report.checks.notHiddenWhileWalking = !/Hidden/.test(midHide);
  await shot(julian, '03-walking-to-cover-birdseye');
  await julian.waitForFunction(() => document.getElementById('hud-status').textContent.includes('Hidden'), null, { timeout: 20000 });
  await sleep(1500);
  await shot(julian, '04-hidden-first-person');
  report.checks.cameraMode = await julian.evaluate(() => document.getElementById('debug').textContent.split(' ').at(-1));
  step(`julian hidden (status while walking: "${midHide}"), camera mode ${report.checks.cameraMode}`);
  const peek = await julian.$('[data-hold="peek"]');
  const box = await peek.boundingBox();
  await julian.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await julian.mouse.down();
  await sleep(900);
  await shot(julian, '05-peeking');
  await julian.mouse.up();
  await sleep(600);

  // 2. A friend approaches the hiding place.
  await anika.click('.room-card[data-room="archive"]');
  await anika.click('[data-act="hide"][data-spot="reading_alcove"]');
  step('anika heading to the same table');
  let sawFriend = false, friendRevealed = false;
  for (let i = 0; i < 40; i++) {
    const v = await julian.evaluate(() => window.__hgView);
    const a = v?.actors?.find(x => x.id === 'anika');
    if (a) { sawFriend = true; friendRevealed ||= a.revealed; }
    if (i === 12) await shot(julian, '06-friend-approaching-from-cover');
    if (v && a && a.action === 'entering_cover') { await shot(julian, '07-friend-getting-under'); break; }
    await sleep(400);
  }
  report.checks.friendSeenApproaching = sawFriend;
  report.checks.friendEverMarkedInfected = friendRevealed;
  await anika.waitForFunction(() => document.getElementById('hud-status').textContent.includes('Hidden'), null, { timeout: 20000 });
  step(`friend approach: seen=${sawFriend}, ever marked infected=${friendRevealed}`);

  // 3. Marcus is secretly infected, then comes looking.
  const before = { julian: julian._ws?.length ?? 0, anika: anika._ws?.length ?? 0 };
  await hook({ infect: ['marcus'] });
  await marcus.waitForSelector('#briefing:not([hidden])', { timeout: 10000 });
  await shot(marcus, '08-private-briefing');
  await marcus.click('#briefing-ok');
  await sleep(800);
  const leaked = ['julian', 'anika'].some(id => (phones[id]._ws ?? []).slice(before[id]).some(f => /you_turned|"turned"/.test(f)));
  report.checks.infectionAnnouncedToOthers = leaked;
  const pubText = await host.evaluate(() => JSON.stringify(window.__hgHostState));
  report.checks.publicStateMentionsInfection = /infected/.test(pubText);
  step(`marcus infected privately (announced to others: ${leaked})`);
  await marcus.click('.room-card[data-room="archive"]');
  let farLooksNormal = null, closeRevealed = false, searched = false;
  for (let i = 0; i < 160; i++) {
    const v = await julian.evaluate(() => window.__hgView);
    const m = v?.actors?.find(x => x.id === 'marcus');
    if (m && farLooksNormal === null) {
      const d = Math.hypot(m.pos[0] - v.me.pos[0], m.pos[1] - v.me.pos[1]);
      if (d > 5) { farLooksNormal = !m.revealed; await shot(julian, '09-someone-enters-legs-only'); }
    }
    if (!searched) {
      const mv = await marcus.evaluate(() => window.__hgView);
      if (mv?.me?.room === 'archive' && !mv.me.moving) {
        await marcus.click('[data-act="search"][data-spot="reading_alcove"]').catch(() => {});
        searched = true;
      }
    }
    if (m?.revealed && !closeRevealed) { closeRevealed = true; await shot(julian, '10-face-revealed-up-close'); }
    if (v?.me?.caught) { await sleep(1200); await shot(julian, '11-caught'); break; }
    await sleep(350);
  }
  report.checks.infectedLooksNormalFromDistance = farLooksNormal;
  report.checks.infectedRevealedUpClose = closeRevealed;
  await shot(marcus, '12-hunter-view');
  step(`infected approach: normal from afar=${farLooksNormal}, revealed up close=${closeRevealed}`);
} catch (e) {
  report.errors.push(`FAILED: ${e.message}`);
  console.error(e);
} finally {
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ checks: report.checks, errors: report.errors }, null, 2));
