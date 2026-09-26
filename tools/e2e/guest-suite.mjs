// Guest suite playtest on a TEST server (HG_TEST_HOOKS=1), using the real on-screen stick:
//  1. Julian (phone) walks with the stick (walk = quiet, full push = run), and the small
//     contextual "Hide" appears only beside the wardrobe; he hides inside -> first-person view.
//  2. Anika (desktop) hides under the iron bed.
//  3. Marcus (phone, secretly infected) walks in: Julian's camera pulls back to a bird's-eye
//     view of THIS room only. Marcus has his own close, grounded camera.
//  4. Marcus kneels to check the bed; while he is busy, Julian slips out of the wardrobe and
//     runs for the hallway door with the stick.
// Screenshots + checks.   BROWSER=... PLAYWRIGHT=... node tools/e2e/guest-suite.mjs [base] [out]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT ? `file://${process.env.PLAYWRIGHT.replace(/\\/g, '/')}/index.mjs` : 'playwright-core');
const base = process.argv[2] || 'http://localhost:2570';
const out = process.argv[3] || 'guest-suite-out';
mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const report = { checks: {}, errors: [] };
const shot = (p, name) => p.screenshot({ path: join(out, `${name}.png`) });
const view = p => p.evaluate(() => window.__hgView);


async function tap(p, sel, tries = 10) {
  for (let i = 0; i < tries; i++) {
    if (await p.locator(sel).first().click({ timeout: 2500 }).then(() => true, () => false)) return;
    await sleep(300);
  }
  const me = await p.evaluate(() => window.__hgView?.me);
  throw new Error(`could not tap ${sel} (pos ${me?.pos}, hide ${me?.hideState})`);
}

/** Drag the on-screen stick toward a world point (camera-relative, like a thumb). */
async function stickTo(p, target, { strength = 0.5, within = 0.5, timeout = 20000, stop = null } = {}) {
  const box = await p.locator('#stick .stick-base').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2, r = box.width / 2;
  await p.mouse.move(cx, cy);
  await p.mouse.down();
  const end = Date.now() + timeout;
  let reached = false, best = Infinity, lastGain = Date.now(), side = 1;
  while (Date.now() < end) {
    const s = await p.evaluate(() => {
      const g = window.__hgGame, me = window.__hgView?.me;
      const f = g.camera.forward, rt = g.camera.right;
      return { pos: me?.pos, f: [f.x, f.z], r: [rt.x, rt.z], hide: me?.hideState };
    });
    if (stop && await stop()) { reached = true; break; }
    const dx = target[0] - s.pos[0], dz = target[1] - s.pos[1], d = Math.hypot(dx, dz);
    if (d < within) { reached = true; break; }
    if (d < best - 0.05) { best = d; lastGain = Date.now(); }
    // Stuck against furniture: sidestep like a person would, then try again.
    let wx = dx / d, wz = dz / d;
    if (Date.now() - lastGain > 1200) { [wx, wz] = [-wz * side, wx * side]; if (Date.now() - lastGain > 2400) { side = -side; lastGain = Date.now(); } }
    const fl = Math.hypot(...s.f) || 1, rl = Math.hypot(...s.r) || 1;
    const sx = (wx * s.r[0] + wz * s.r[1]) / rl, sy = (wx * s.f[0] + wz * s.f[1]) / fl;
    const l = Math.hypot(sx, sy) || 1;
    await p.mouse.move(cx + sx / l * r * strength, cy - sy / l * r * strength);
    await sleep(150);
  }
  await p.mouse.up();
  return reached;
}

const browser = await chromium.launch({ executablePath: process.env.BROWSER, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const host = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
  await host.goto(`${base}/host.html`, { timeout: 120000 });
  await host.click('#h-create');
  await host.waitForFunction(() => /^[A-Z2-9]{5}$/.test(document.getElementById('h-code').textContent));
  const code = await host.textContent('#h-code');
  const hook = payload => host.evaluate(pl => window.__hgHost?.send('test:setup', pl), payload);
  const pages = {};
  for (const [id, name, kind] of [['julian', 'Jules', 'phone'], ['anika', 'Ani', 'desktop'], ['marcus', 'Mark', 'phone']]) {
    const ctx = kind === 'phone'
      ? await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
      : await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const p = await ctx.newPage();
    p.on('pageerror', e => report.errors.push(`${id}: ${e.message}`));
    await p.goto(`${base}/?code=${code}&debug=1`, { timeout: 120000 });
    await p.evaluate(() => localStorage.removeItem('hg.tip.steer'));
    await p.fill('#join-name', name);
    await p.click('#join-go');
    await p.waitForSelector('#screen-lobby:not([hidden])');
    await p.click(`[data-claim="${id}"]`);
    pages[id] = p;
  }
  const { julian, anika, marcus } = pages;
  await host.waitForFunction(() => document.querySelector('#h-stats')?.textContent.includes('3joined'));
  await host.uncheck('#h-cpu');
  await host.click('#h-start');
  await sleep(1500);
  await hook({ skipOpening: true });
  await julian.waitForFunction(() => document.getElementById('hud-phase')?.textContent === 'Survive', null, { timeout: 20000 });
  const birthday = await host.evaluate(() => window.__hgHostState?.birthday);
  await hook({ inertCpu: true, searchMs: 9000, place: { elias: [14, 8], [birthday]: [-11.75, 9], julian: [0, 64.6], anika: [-0.4, 72.6], marcus: [0, 60] } });
  await sleep(1500);

  // 1. Julian walks in through the hallway door with a gentle push, then runs.
  await shot(julian, '01-phone-stick-and-dock-in-the-passage');
  await stickTo(julian, [0, 67.8], { strength: 0.45, within: 0.4 });
  report.checks.walkLabel = 'checked during walk';
  report.checks.inBedroom = (await view(julian)).me.room;
  await julian.mouse.move(0, 0);
  // push all the way toward the open floor by the wardrobe: running (label + server pace)
  let runLabel = '', runPace = '';
  await stickTo(julian, [2.4, 68.6], { strength: 1, within: 0.4, stop: async () => {
    runLabel = await julian.textContent('#stick .stick-label'); runPace = (await view(julian)).me.pace;
    if (runLabel.startsWith('Running')) await shot(julian, '02-phone-full-push-runs-loud');
    return false;
  } });
  report.checks.runLabel = runLabel;
  report.checks.runningPace = runPace;
  await stickTo(julian, [0.6, 67.8], { strength: 0.5, within: 0.4 }); await sleep(700);
  // The Hide button must match the rule: shown only within 1.4 m of a hiding place's open side.
  const jv0 = await view(julian);
  const fronts = { guest_wardrobe: [3.09, 69.7], under_brass_bed: [-0.15, 73.7], window_seat: [-2.76, 69.9] };
  const near = Object.entries(fronts).filter(([, p]) => Math.hypot(p[0] - jv0.me.pos[0], p[1] - jv0.me.pos[1]) <= 1.4).map(([id]) => id);
  const shown = await julian.locator('#actions [data-act="hide"]').evaluateAll(els => els.map(e => e.dataset.spot));
  const noHideInOpen = JSON.stringify(near.sort()) === JSON.stringify(shown.sort());
  report.checks.hideRuleAt = { pos: jv0.me.pos, expected: near, shown };
  report.checks.noHideButtonInTheOpen = noHideInOpen;
  await stickTo(julian, [1.8, 68.9], { strength: 0.5, within: 0.4 });
  let reachedWardrobe = false;
  for (let i = 0; i < 3 && !reachedWardrobe; i++) reachedWardrobe = await stickTo(julian, [3.05, 69.7], { strength: 0.4, within: 0.35, timeout: 15000 });
  report.checks.wardrobeApproach = { reached: reachedWardrobe, pos: (await view(julian)).me.pos };
  await sleep(900);
  await julian.waitForSelector('#actions [data-act="hide"][data-spot="guest_wardrobe"]', { timeout: 8000 });
  report.checks.hideOfferedBesideWardrobe = true;
  await shot(julian, '03-phone-contextual-hide-beside-wardrobe');
  await tap(julian, '#actions [data-act="hide"][data-spot="guest_wardrobe"]');
  await julian.waitForFunction(() => window.__hgView?.me?.hideState === 'hidden', null, { timeout: 15000 });
  await sleep(1500);
  report.checks.julianMode = await julian.evaluate(() => window.__hgGame.mode);
  await shot(julian, '04-phone-inside-the-wardrobe-first-person');

  // 2. Anika hides under the bed (desktop), from its open side.
  await anika.waitForSelector('#actions [data-act="hide"][data-spot="under_brass_bed"]', { timeout: 8000 });
  await tap(anika, '#actions [data-act="hide"][data-spot="under_brass_bed"]');
  await anika.waitForFunction(() => window.__hgView?.me?.hideState === 'hidden', null, { timeout: 15000 });
  await sleep(1500);
  await shot(anika, '05-desktop-under-the-iron-bed');

  // 3. Marcus is infected (secretly) and walks in.
  await hook({ infect: ['marcus'] });
  await marcus.waitForSelector('#briefing:not([hidden])', { timeout: 10000 });
  await marcus.click('#briefing-ok');
  await marcus.waitForFunction(() => window.__hgGame?.mode === 'hunter', null, { timeout: 10000 });
  await stickTo(marcus, [0, 67.6], { strength: 0.45, within: 0.5, timeout: 30000 });
  await sleep(1200);
  await shot(marcus, '06-phone-seeker-close-grounded-camera');
  await julian.waitForFunction(() => window.__hgGame.mode === 'roomview', null, { timeout: 10000 }).then(() => { report.checks.hiderPullback = true; }, () => { report.checks.hiderPullback = false; });
  await sleep(1800);
  await shot(julian, '07-phone-hider-pulls-back-to-this-room-only');
  await shot(anika, '08-desktop-under-bed-someone-came-in');
  report.checks.maskOn = await julian.evaluate(() => window.__hgGame.world.roomMask?.[0]?.enabled);

  // 4. Marcus checks the bed (contextual Search beside it).
  await stickTo(marcus, [-0.1, 73.2], { strength: 0.45, within: 0.45, timeout: 30000 });
  await sleep(900);
  await marcus.waitForSelector('#actions [data-act="search"][data-spot="under_brass_bed"]', { timeout: 8000 });
  report.checks.searchOfferedBesideBed = true;
  await tap(marcus, '#actions [data-act="search"][data-spot="under_brass_bed"]');
  await marcus.waitForFunction(() => window.__hgView?.me?.searching, null, { timeout: 15000 });
  await sleep(900);
  await shot(marcus, '09-phone-seeker-kneels-at-the-bed');
  await shot(anika, '10-desktop-under-bed-the-seeker-looks-in');
  // ...while he is busy, Julian slips out of the wardrobe and runs for the hallway door.
  const outOk = await stickTo(julian, [0.2, 66.8], { strength: 1, within: 0.6, timeout: 25000 });
  await sleep(400);
  await shot(julian, '11-phone-hider-slips-out-while-seeker-is-busy');
  await stickTo(julian, [0, 63.5], { strength: 1, within: 0.8, timeout: 15000 });
  const jv = await view(julian);
  report.checks.julianEscapedRoom = jv.me.room !== 'guest_bedroom' || jv.me.zone !== 'guest_bedroom';
  report.checks.julianZone = jv.me.zone;
  report.checks.julianNotCaught = !jv.me.caught;
  await shot(julian, '12-phone-out-in-the-passage');
  await sleep(6000);
  report.checks.anikaFound = !!(await view(anika))?.me?.caught || (await view(anika))?.status === 'infected';
  await shot(anika, '13-desktop-found-under-the-bed');
  // Rooms drawer (the redesigned room chooser) on Julian's phone.
  await julian.click('[data-act="rooms"]');
  await sleep(1200);
  await shot(julian, '14-phone-rooms-drawer');
} catch (e) {
  report.errors.push(`FAILED: ${e.message}`);
  console.error(e.message);
} finally {
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify(report, null, 2));
