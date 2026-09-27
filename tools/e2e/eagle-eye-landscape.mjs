// Eagle-eye proof, end to end on iPhone-landscape phones against a TEST server (HG_TEST_HOOKS=1):
// install/rotate/launch screens, mansion -> travel -> room view, floor taps, pace, hide -> first
// person, peek, eye view, "someone came in", lunge warning, break free and a lost struggle, hunter
// taps, the opening, View Gallery, the Garden Gate escape and results. Screenshots + report.json.
//   cd server && HG_TEST_HOOKS=1 PORT=2570 npx tsx src/index.ts
//   node tools/e2e/eagle-eye-landscape.mjs [base] [outDir]
// Env: PHONE=844x390 (default) or 932x430; INSETS=47 (left/right safe-area inset in px, 0 = none);
//      SHARP=1 renders screenshots at pixel ratio 2; CLEAN=1 hides the debug overlay;
//      PLAYWRIGHT=<dir of playwright(-core)> if it isn't the global install.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const { chromium } = await import(`file://${(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright').replace(/\\/g, '/')}/index.mjs`);
const [PW, PH] = (process.env.PHONE || '844x390').split('x').map(Number);
const INSET = Number(process.env.INSETS ?? 47);
const base = process.argv[2] || 'http://localhost:2570';
const out = process.argv[3] || `eagle-eye-landscape-${PW}x${PH}`;
mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const report = { checks: {}, errors: [], console: [] };
const shots = [];
// SHARP=1: render each screenshot at pixel ratio 2 (software GL otherwise drops to 0.6); CLEAN=1: hide the debug overlay.
const SHARP = !!process.env.SHARP, CLEAN = !!process.env.CLEAN;
const shot = async (p, name) => {
  const f = join(out, `${name}.png`);
  if (CLEAN) await p.addStyleTag({ content: '#debug{display:none!important}' }).catch(() => {});
  const sharp = SHARP && await p.evaluate(() => { const g = window.__hgGame; if (!g) return false; g.__saved = g.app.graphicsDevice.maxPixelRatio; g.fixedRatio = 2; g.app.graphicsDevice.maxPixelRatio = 2; g.app.resizeCanvas(); return true; }).catch(() => false);
  if (sharp) await p.waitForTimeout(900);
  await p.screenshot({ path: f });
  if (sharp) await p.evaluate(() => { const g = window.__hgGame; g.fixedRatio = null; g.app.graphicsDevice.maxPixelRatio = g.__saved; g.app.resizeCanvas(); }).catch(() => {});
  shots.push(f);
};
const view = p => p.evaluate(() => window.__hgView);
const mode = p => p.evaluate(() => `${window.__hgGame.cameraMode}${window.__hgGame.fpKind ? ':' + window.__hgGame.fpKind : ''}`);
const waitMode = (p, m, timeout = 25000) => p.waitForFunction(m => {
  const g = window.__hgGame; return `${g.cameraMode}${g.fpKind ? ':' + g.fpKind : ''}`.startsWith(m) && !g.tr;
}, m, { timeout }).catch(async e => {
  const st = await p.evaluate(() => { const g = window.__hgGame; return { mode: g.mode, fpKind: g.fpKind, user: g.userView, tr: g.tr && { t: g.tr.t, mode: g.tr.mode }, force: g.forceKey, autoKey: g.autoKey, want: g.wantedMode(), me: window.__hgView?.me && { zone: window.__hgView.me.zone, moving: window.__hgView.me.moving, intent: window.__hgView.me.intent } }; });
  throw new Error(`waitMode ${m}: ${JSON.stringify(st)}`);
});
const toScreen = (p, x, y, z) => p.evaluate(([x, y, z]) => window.__hgGame.worldToScreen(x, y, z), [x, y, z]);
async function tapWorld(p, x, y, z, how = 'touch') {
  const s = await toScreen(p, x, y, z);
  if (!s) throw new Error(`(${x},${z}) not on screen`);
  if (how === 'touch') await p.touchscreen.tap(s.x, s.y); else await p.mouse.click(s.x, s.y);
  return s;
}
const check = (name, ok, detail) => { report.checks[name] = detail === undefined ? ok : { ok, detail }; console.log(ok ? 'PASS' : 'FAIL', name, detail ?? ''); };

const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const host = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
  await host.goto(`${base}/host.html`, { timeout: 120000 });
  await host.click('#h-create');
  await host.waitForFunction(() => /^[A-Z2-9]{5}$/.test(document.getElementById('h-code').textContent));
  const code = await host.textContent('#h-code');
  const hook = payload => host.evaluate(pl => window.__hgHost?.send('test:setup', pl), payload);

  {
    const ios = await browser.newContext({ viewport: { width: PW, height: PH }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1' });
    const q = await ios.newPage();
    await q.goto(`${base}/?code=${code}`, { timeout: 120000 });
    await q.waitForSelector('#a2hs:not([hidden])', { timeout: 20000 }).then(() => check('iOS Safari: Add to Home Screen sheet on the join screen', true), () => check('iOS Safari: Add to Home Screen sheet on the join screen', false));
    await shot(q, '00b-join-ios-add-to-home-screen');
    await q.click('#a2hs-close');
    await q.reload();
    check('A2HS sheet stays dismissed', await q.locator('#a2hs').isHidden());
    const manifest = await q.evaluate(async () => (await fetch(document.querySelector('link[rel=manifest]').href)).json());
    check('manifest served (landscape, no start_url)', manifest.orientation === 'landscape' && !('start_url' in manifest), manifest.display_override);
    const icons = await q.evaluate(async () => Promise.all(['/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png', '/icons/apple-touch-icon.png'].map(async u => (await fetch(u)).status)));
    check('icons served', icons.every(x => x === 200), icons);
    await ios.close();
  }
  const ctx = await browser.newContext({ viewport: { width: PH, height: PW }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const insets = async page => { if (INSET) await (await page.context().newCDPSession(page)).send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, left: INSET, right: INSET, bottom: 21 } }).catch(e => report.console.push('safe-area override unavailable: ' + e.message)); };
  await insets(p);
  p.on('pageerror', e => report.errors.push(e.message));
  p.on('response', r => { if (r.status() >= 400) report.console.push(`HTTP ${r.status()} ${r.url()}`); });
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') report.console.push(`${m.type()}: ${m.text()}`.slice(0, 300)); });
  await p.goto(`${base}/?code=${code}&debug=1`, { timeout: 120000 });
  await p.fill('#join-name', 'Jules');
  await shot(p, '00-join-portrait');
  await p.setViewportSize({ width: PW, height: PH });
  await sleep(300);
  await shot(p, '01-join-landscape');
  await p.click('#join-go');
  await p.waitForSelector('#screen-lobby:not([hidden])');
  await p.click('[data-claim="julian"]');
  await p.waitForFunction(() => document.body.dataset.stage === 'ready');
  await sleep(400);
  await shot(p, '02-lobby-landscape-after-claim');
  const rotateShown = () => p.evaluate(() => getComputedStyle(document.getElementById('rotate')).display !== 'none');
  check('rotate hidden in landscape (lobby)', !(await rotateShown()));
  await p.setViewportSize({ width: PH, height: PW });
  await sleep(400);
  check('rotate shown in portrait after claim', await rotateShown());
  await shot(p, '03-rotate-prompt-portrait');
  await p.setViewportSize({ width: PW, height: PH });
  await sleep(300);
  check('rotate hidden again in landscape', !(await rotateShown()));
  // Launch button (user gesture): no fullscreen in headless, but it must not throw.
  if (await p.locator('#launch-go').isVisible()) await p.click('#launch-go');

  await host.waitForFunction(() => document.querySelector('#h-stats')?.textContent.includes('1joined'));
  await host.click('#h-start');
  await sleep(1500);
  await hook({ skipOpening: true });
  await p.waitForFunction(() => document.getElementById('hud-phase')?.textContent === 'Survive', null, { timeout: 20000 });
  const birthday = await host.evaluate(() => window.__hgHostState?.birthday);
  const place = { elias: [-24, 30], julian: [11.75, 9] };
  if (birthday && birthday !== 'julian') place[birthday] = [-20, 48];
  await hook({ inertCpu: true, place });
  await sleep(2500);
  await p.evaluate(() => {
    const w = window.__hgGame.world; window.__worldCalls = { route: [], dest: [], hl: [], mode: [] };
    for (const [k, m] of [['route', 'setRoute'], ['dest', 'setDestination'], ['hl', 'highlightRooms'], ['mode', 'setViewMode']]) {
      const orig = w[m]?.bind(w);
      if (orig) w[m] = (...a) => { window.__worldCalls[k].push(JSON.stringify(a).slice(0, 160)); return orig(...a); };
    }
  });
  await waitMode(p, 'room', 10000);
  check('room view in the archive', (await mode(p)) === 'room', await mode(p));
  await shot(p, '04-room-view-archive');
  const longest = 'Elias, over the intercom by the Garden Gate: "You have fifteen minutes to leave my house. Go on. Find somewhere to hide."';
  const lines = async () => p.evaluate(t => { const c = document.getElementById('caption'); c.textContent = t; c.className = 'big'; c.style.opacity = 1;
    const r = c.getBoundingClientRect(); const lh = parseFloat(getComputedStyle(c).lineHeight); return { lines: Math.round((r.height - 8) / lh), w: r.width, bottom: innerHeight - r.bottom }; }, longest);
  const l844 = await lines();
  await sleep(700);
  await shot(p, '04b-longest-subtitle');
  await p.setViewportSize({ width: 667, height: 375 });
  await sleep(400);
  const l667 = await lines();
  await p.setViewportSize({ width: PW, height: PH });
  await sleep(400);
  check('longest subtitle fits in 2 lines (844x390, 667x375)', l844.lines <= 2 && l667.lines <= 2, { l844, l667 });
  await p.evaluate(() => { document.getElementById('caption').style.opacity = 0; });

  // Idle HUD coverage.
  const coverage = await p.evaluate(() => {
    const ids = ['hud-where', 'hud-time', 'viewbtns', 'menu-btn', 'pace', 'actions', 'flash-btn'];
    let a = 0;
    for (const id of ids) { const el = document.getElementById(id); if (!el || el.offsetParent === null && getComputedStyle(el).position !== 'fixed') continue; const r = el.getBoundingClientRect(); if (getComputedStyle(el).display === 'none') continue; a += r.width * r.height; }
    return a / (innerWidth * innerHeight);
  });
  check('idle HUD covers < 10% of the screen', coverage < 0.1, coverage.toFixed(3));
  const small = await p.evaluate(() => [...document.querySelectorAll('#hud button, #pace button, #actions button, #flash-btn')]
    .filter(b => getComputedStyle(b).display !== 'none' && b.offsetParent !== null)
    .map(b => { const r = b.getBoundingClientRect(); return { id: b.id || b.dataset.view || b.dataset.act || b.textContent.trim(), w: r.width, h: r.height }; })
    .filter(r => r.w < 44 || r.h < 44));
  check('touch targets >= 44 px', !small.length, small);

  // Mansion view button.
  await p.click('#viewbtns [data-view="mansion"]');
  await waitMode(p, 'mansion');
  await sleep(300);
  await shot(p, '05-mansion-view');
  report.checks.mansionEntities = await p.evaluate(() => {
    const g = window.__hgGame;
    const out = { arrival: !!g.arrival, actors: [...g.actors.values()].filter(a => a.entity.enabled).map(a => [a.id, a.pos]) };
    out.named = g.app.root.find(e => e.enabled && /^(Actor_|Arrival_)/.test(e.name) && e.parent?.enabled !== false).map(e => { const p = e.getPosition(); return [e.name, +p.x.toFixed(1), +p.z.toFixed(1)]; });
    return out;
  });
  // Tap the Conservation Lab in the mansion view: travel there, watch in the mansion view.
  await tapWorld(p, 22.5, 0, 28.5);
  await p.waitForFunction(() => window.__hgView?.me?.moving && window.__hgView.me.intent?.kind === 'room', null, { timeout: 5000 });
  const v1 = await view(p);
  check('mansion tap -> room intent to the lab', v1.me.intent.target === 'conservation', v1.me.intent);
  await sleep(1200);
  check('mansion view while travelling', (await mode(p)).startsWith('mansion'), await mode(p));
  await shot(p, '06-mansion-travel');
  await p.waitForFunction(() => window.__hgView?.me?.zone === 'conservation', null, { timeout: 30000 });
  await waitMode(p, 'room', 25000);
  check('room view on entering the lab', (await mode(p)) === 'room', await mode(p));
  await p.waitForFunction(() => !window.__hgView?.me?.moving, null, { timeout: 15000 });
  const v2 = await view(p);
  check('arrived near the tapped point', Math.hypot(v2.me.pos[0] - 22.5, v2.me.pos[1] - 28.5) < 1.3, v2.me.pos);
  await sleep(500);
  await shot(p, '07-room-view-conservation-lab');
  const wc = await p.evaluate(() => window.__worldCalls);
  check('world feedback: route, destination, room highlights, fog modes', wc.route.some(r => r !== '[null]') && wc.dest.some(d => !d.startsWith('[null')) && wc.hl.some(h => h.includes('true')) && wc.mode.includes('["mansion"]') && wc.mode.includes('["room"]'),
    { route: wc.route.slice(0, 3), dest: wc.dest.slice(0, 4), hl: wc.hl.slice(0, 3), mode: [...new Set(wc.mode)] });

  // Tap a neighbouring room from the room view: the camera pulls out to the mansion for the trip.
  await tapWorld(p, 20, 0, 45);
  await p.waitForFunction(() => window.__hgView?.me?.intent?.target === 'mirrors' && window.__hgView.me.moving, null, { timeout: 5000 });
  await waitMode(p, 'mansion', 25000).then(() => check('room-view tap on the next room -> mansion view for the trip', true), e => check('room-view tap on the next room -> mansion view for the trip', false, e.message));
  await p.waitForFunction(() => window.__hgView?.me?.zone === 'mirrors', null, { timeout: 30000 });
  await waitMode(p, 'room', 25000);
  await shot(p, '07b-room-view-hall-of-mirrors');
  // Pinch: fingers together zooms out to the mansion; spreading them over the lab frames the lab.
  const pinch = (cx, cy, from, to) => p.evaluate(([cx, cy, from, to]) => {
    const el = document.getElementById('stage');
    const ev = (type, id, x) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', isPrimary: id === 71, clientX: x, clientY: cy }));
    ev('pointerdown', 71, cx - from); ev('pointerdown', 72, cx + from);
    for (let k = 1; k <= 6; k++) { const d = from + (to - from) * k / 6; ev('pointermove', 71, cx - d); ev('pointermove', 72, cx + d); }
    ev('pointerup', 71, cx - to); ev('pointerup', 72, cx + to);
  }, [cx, cy, from, to]);
  await pinch(422, 200, 120, 40);
  await waitMode(p, 'mansion').then(() => check('pinch in (fingers together) -> mansion', true), e => check('pinch in (fingers together) -> mansion', false, e.message));
  const lab = await toScreen(p, 24, 0, 30);
  await pinch(lab.x, lab.y, 30, 110);
  await waitMode(p, 'room').then(() => check('pinch out over the lab -> room view of the lab', true), e => check('pinch out over the lab -> room view of the lab', false, e.message));
  report.checks.pinchRoom = await p.evaluate(() => window.__hgGame.viewRoom);
  await shot(p, '07c-pinch-framed-lab-from-mirrors');
  await p.click('#viewbtns [data-view="room"]');
  await waitMode(p, 'room');
  check('room button returns to your own room', (await p.evaluate(() => window.__hgGame.viewRoom)) === null);
  await p.click('#viewbtns [data-view="mansion"]');
  await waitMode(p, 'mansion');
  await tapWorld(p, 22.5, 0, 28.5);
  await p.waitForFunction(() => window.__hgView?.me?.zone === 'conservation' && !window.__hgView.me.moving, null, { timeout: 40000 });
  await waitMode(p, 'room', 25000);
  // Tap the floor: move.
  await tapWorld(p, 20.2, 0, 29.4);
  await p.waitForFunction(() => window.__hgView?.me?.intent?.kind === 'move', null, { timeout: 5000 });
  await sleep(300);
  await shot(p, '08-floor-tap-route');
  await p.waitForFunction(() => !window.__hgView?.me?.moving, null, { timeout: 15000 });
  const v3 = await view(p);
  check('floor tap moved', Math.hypot(v3.me.pos[0] - 20.2, v3.me.pos[1] - 29.4) < 0.8, v3.me.pos);

  // Pace pill.
  await p.click('#pace [data-pace="run"]');
  await p.waitForFunction(() => window.__hgView?.me?.pace === 'run', null, { timeout: 4000 }).then(() => check('pace pill -> run', true), () => check('pace pill -> run', false));
  await p.click('#pace [data-pace="walk"]');
  await p.waitForFunction(() => window.__hgView?.me?.pace === 'walk', null, { timeout: 4000 }).then(() => check('pace pill -> sneak', true), () => check('pace pill -> sneak', false));
  // Double tap runs once.
  const dt = await toScreen(p, 23.5, 0, 28.2);
  await p.touchscreen.tap(dt.x, dt.y); await p.touchscreen.tap(dt.x, dt.y);
  let sawRun = false;
  for (let i = 0; i < 25; i++) { const v = await view(p); if (v.me.moving && v.me.pace === 'run') sawRun = true; if (sawRun && !v.me.moving) break; await sleep(100); }
  check('double tap runs', sawRun, await p.evaluate(() => window.__hgSent.filter(x => x.type === 'intent' || x.type === 'pace').slice(-4)));
  await sleep(1500);
  check('pace back to sneak after the double-tap run', (await view(p)).me.pace === 'walk', (await view(p)).me.pace);

  // Sound cues as edge chevrons (a fake list on this phone's own view object).
  await p.evaluate(() => { window.__hgView.sounds = [{ bearing: 0, band: 'near', kind: 'steps' }, { bearing: 90, band: 'far', kind: 'running' }, { bearing: 225, band: 'far', kind: 'search' }]; });
  await sleep(400);
  const cues = await p.evaluate(() => [...document.querySelectorAll('#sounds .cue')].filter(c => !c.hidden).map(c => { const r = c.getBoundingClientRect(); return [c.textContent, Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]; }));
  check('sound chevrons on the screen edges (+z = right, +x = up in the room view)', cues.length === 3 && cues[0][1] > 700 && cues[1][2] < 120, cues);
  await shot(p, '08b-sound-chevrons');
  await p.evaluate(() => { window.__hgView.sounds = []; });
  // Tap a hiding place (the restoration table): hide -> first person.
  await tapWorld(p, 24.6, 0.46, 32.0);
  await p.waitForFunction(() => window.__hgView?.me?.intent?.kind === 'hide', null, { timeout: 5000 });
  check('tap on the table -> hide intent', (await view(p)).me.intent.target === 'under_restoration_table', (await view(p)).me.intent);
  await p.waitForFunction(() => window.__hgView?.me?.hideState === 'hidden', null, { timeout: 15000 });
  await waitMode(p, 'fp', 25000);
  check('hidden -> first person', (await mode(p)) === 'fp:hide', await mode(p));
  await sleep(600);
  await shot(p, '09-hidden-under-table-first-person');
  // Peek (hold).
  const peek = await p.locator('#actions [data-hold="peek"]').boundingBox();
  await p.mouse.move(peek.x + peek.width / 2, peek.y + peek.height / 2);
  await p.mouse.down();
  await p.waitForFunction(() => window.__hgView?.me?.peeking === true, null, { timeout: 4000 }).then(() => check('peek on', true), () => check('peek on', false));
  await sleep(700);
  await shot(p, '10-peeking');
  await p.mouse.up();
  await p.waitForFunction(() => window.__hgView?.me?.peeking === false, null, { timeout: 4000 }).then(() => check('peek off', true), () => check('peek off', false));
  // Room view while hidden, then eyes again.
  await p.click('#viewbtns [data-view="room"]');
  await waitMode(p, 'room');
  await sleep(300);
  await shot(p, '11-hidden-room-view');
  await p.click('#viewbtns [data-view="eye"]');
  await waitMode(p, 'fp');
  // Leave.
  await p.click('#actions [data-act="leave"]');
  await p.waitForFunction(() => window.__hgView?.me?.hideState === 'none', null, { timeout: 6000 });
  await waitMode(p, 'room', 25000);
  check('leave -> room view', (await mode(p)) === 'room', await mode(p));
  // Eye button: character-eye first person.
  await p.click('#viewbtns [data-view="eye"]');
  await waitMode(p, 'fp');
  check('eye button -> fp:eye', (await mode(p)) === 'fp:eye', await mode(p));
  await sleep(400);
  await shot(p, '12-eye-first-person');
  await p.click('#viewbtns [data-view="room"]');
  await waitMode(p, 'room');

  // Someone came in (neutral), then a grab and the break-free struggle.
  const guest = (await view(p)).actors?.length ? null : null;
  const other = ['marcus', 'mei', 'dev', 'amara', 'alex'].find(id => id !== birthday);
  await hook({ place: { [other]: [26, 25] } }).catch(e => report.errors.push('place: ' + e.message));
  await p.waitForFunction(() => !document.getElementById('alert').hidden, null, { timeout: 4000 }).catch(() => {});
  report.checks.alertText = await p.evaluate(() => { const a = document.getElementById('alert'); return a.hidden ? null : a.textContent + ' ' + a.className; });
  check('someone came in (neutral)', /Someone came in/.test(report.checks.alertText ?? ''), report.checks.alertText);
  await sleep(300);
  await shot(p, '13-someone-came-in');
  // A real grab: Elias steps up next to Julian -> the lunge warning (windup), then the grab and the struggle.
  await p.evaluate(() => { window.__lunges = 0; new MutationObserver(() => { if (document.getElementById('lunge').classList.contains('on')) window.__lunges++; }).observe(document.getElementById('lunge'), { attributes: true }); });
  const jp = (await view(p)).me.pos;
  await hook({ place: { elias: [jp[0] + 0.7, jp[1]] } });
  const struggled = await p.waitForFunction(() => !document.getElementById('struggle').hidden, null, { timeout: 8000 }).then(() => true, () => false);
  check('lunge warning before the grab (red edge pulse)', (await p.evaluate(() => window.__lunges)) > 0, await p.evaluate(() => window.__lunges));
  check('struggle overlay appears on a grab', struggled);
  const drum = n => p.evaluate(async n => {
    const el = document.getElementById('struggle');
    for (let i = 0; i < n; i++) {
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 10 + i, pointerType: 'touch', clientX: 420, clientY: 200 }));
      await new Promise(r => setTimeout(r, 90));
    }
  }, n);
  if (struggled) {
    // Tap the overlay at ~11 taps/s from inside the page (CDP taps are too slow under software GL).
    check('struggle -> fp facing attacker', (await mode(p)).startsWith('fp:struggle'), await mode(p));
    const need = (await view(p)).me.struggle?.need ?? 18;   // Elias: 14 + 4
    report.checks.struggleNeed = need;
    await drum(need + 3);
    const freed = await p.waitForFunction(() => !window.__hgView?.me?.caught && !window.__hgView?.me?.struggle, null, { timeout: 5000 }).then(() => true, () => false);
    const v = await view(p);
    check('tapping breaks free', freed && v.status === 'alive', { caught: v.me?.caught, status: v.status, sent: await p.evaluate(() => window.__hgSent.filter(x => x.type === 'struggle').map(x => x.payload.n)) });
    await sleep(300);
    await shot(p, '15-broke-free');
  }
  report.checks.struggleSent = await p.evaluate(() => window.__hgSent.filter(x => x.type === 'struggle'));
  // Back to portrait mid-game: the rotate prompt with the subtitle mirrored.
  await p.setViewportSize({ width: PH, height: PW });
  await sleep(500);
  check('rotate shown in portrait during play', await rotateShown());
  await shot(p, '16-rotate-in-play');
  await p.setViewportSize({ width: PW, height: PH });
  await sleep(600);
  // Menu sheet.
  if (await p.locator('#briefing').isVisible()) await p.click('#briefing-ok');
  await p.click('#menu-btn');
  await sleep(300);
  await shot(p, '17-menu-sheet');
  await p.click('#sheet [data-act="close"]');
  // A second grab only for the overlay screenshot (too many taps needed): it ends in the bite.
  await sleep(2600);   // grab immunity after breaking free
  await hook({ place: { elias: [21, 28.6], julian: [22, 28.5] }, struggleNeed: 200, grab: { hunter: 'elias', victim: 'julian' } });
  await p.waitForFunction(() => !document.getElementById('struggle').hidden, null, { timeout: 6000 }).catch(() => {});
  await drum(4);
  await shot(p, '14-struggle-overlay');
  await p.waitForFunction(() => window.__hgView?.status === 'infected', null, { timeout: 8000 }).then(() => check('failed struggle -> bitten', true), () => check('failed struggle -> bitten', false));
  await hook({ struggleNeed: null });
  // Hunter taps once the turning is over: a hiding place (search) and the floor (move).
  await p.waitForSelector('#briefing:not([hidden])', { timeout: 20000 }).catch(() => {});
  await shot(p, '17b-briefing-you-turned');
  await p.waitForFunction(() => window.__hgView?.me && !window.__hgView.me.stunned, null, { timeout: 25000 });
  await hook({ place: { julian: [22, 28.5] } });
  await p.waitForSelector('#briefing:not([hidden])', { timeout: 8000 }).catch(() => {});
  if (await p.locator('#briefing').isVisible()) await p.click('#briefing-ok');
  await p.waitForFunction(() => window.__hgView?.role === 'hunter', null, { timeout: 5000 });
  await waitMode(p, 'room', 8000);
  await sleep(500);
  await tapWorld(p, 24.6, 0.46, 32.0);
  await p.waitForFunction(() => window.__hgView?.me?.intent?.kind === 'search', null, { timeout: 5000 }).then(() => check('hunter: tap hiding place -> search', true), async () => check('hunter: tap hiding place -> search', false, (await view(p)).me.intent));
  await sleep(2500);
  await tapWorld(p, 20.5, 0, 27.5);
  await p.waitForFunction(() => window.__hgView?.me?.intent?.kind === 'move', null, { timeout: 5000 }).then(() => check('hunter: tap floor -> move', true), async () => check('hunter: tap floor -> move', false, (await view(p)).me.intent));
  await sleep(800);
  await shot(p, '18-hunter-room-view');
  // Garden Gate: a fresh match; Julian stands in the Sealed Exhibition Room and taps the gate.
  {
    const host2 = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
    await host2.goto(`${base}/host.html`);
    await host2.click('#h-create');
    await host2.waitForFunction(() => /^[A-Z2-9]{5}$/.test(document.getElementById('h-code').textContent));
    const code2 = await host2.textContent('#h-code');
    const g = await (await browser.newContext({ viewport: { width: PW, height: PH }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })).newPage();
    await insets(g);
    g.on('pageerror', e => report.errors.push('gate: ' + e.message));
    await g.goto(`${base}/?code=${code2}&debug=1`);
    await g.fill('#join-name', 'Jules');
    await g.click('#join-go');
    await g.waitForSelector('#screen-lobby:not([hidden])');
    await g.click('[data-claim="julian"]');
    await host2.waitForFunction(() => document.querySelector('#h-stats')?.textContent.includes('1joined'));
    await host2.click('#h-start');
    // The opening in landscape (camera unchanged; subtitles at the bottom, only the timer and room name).
    await sleep(12500);
    await shot(g, '18b-opening-landscape');
    check('opening: no gameplay controls', await g.evaluate(() => ['pace', 'actions', 'flash-btn'].every(id => document.getElementById(id).hidden) && document.getElementById('viewbtns').hidden));
    await host2.evaluate(() => window.__hgHost.send('test:setup', { skipOpening: true }));
    await g.waitForFunction(() => window.__hgView?.me && window.__hgView.phase === 'hunt', null, { timeout: 20000 });
    const bday = await host2.evaluate(() => window.__hgHostState?.birthday);
    const pl = { elias: [-24, 30], julian: [8.5, 60.2] }; if (bday && bday !== 'julian') pl[bday] = [-20, 48];
    await host2.evaluate(pl => window.__hgHost.send('test:setup', { inertCpu: true, exitOpenNow: true, place: pl }), pl);
    // Portrait Corridor: the long room is framed as a window around you; View Gallery plaque card.
    await sleep(1500);
    await waitMode(g, 'room', 25000);
    await shot(g, '18c-portrait-corridor-room-view');
    await g.click('#actions [data-act="gallery"][data-station="host"]');
    await g.waitForFunction(() => window.__hgView?.me?.viewing === 'host' && !window.__hgView.me.moving, null, { timeout: 15000 });
    await g.waitForSelector('#gallery-card:not([hidden])', { timeout: 5000 }).then(() => check('View Gallery plaque card', true), () => check('View Gallery plaque card', false));
    await sleep(1500);
    await shot(g, '18d-view-gallery-plaque');
    await g.click('#gallery-card [data-act="gal-step"][data-step="1"]');
    await g.click('#gallery-card [data-act="gal-back"]');
    await g.waitForFunction(() => !window.__hgView?.me?.viewing, null, { timeout: 5000 }).then(() => check('gal-back leaves the gallery', true), () => check('gal-back leaves the gallery', false));
    await host2.evaluate(() => window.__hgHost.send('test:setup', { place: { julian: [0, 27] } }));
    await sleep(2000);
    await waitMode(g, 'room', 25000);
    const pill = await g.locator('#actions [data-act="exit"]').isVisible();
    check('Garden Gate pill in the Sealed Exhibition Room', pill);
    await shot(g, '19-sealed-room-garden-gate-pill');
    await g.click('#viewbtns [data-view="mansion"]');
    await waitMode(g, 'mansion');
    await tapWorld(g, 0, 1.2, 19.2);
    await g.waitForFunction(() => window.__hgView?.me?.intent?.kind === 'exit', null, { timeout: 5000 }).then(() => check('mansion view: tap the Garden Gate -> exit', true), async () => check('mansion view: tap the Garden Gate -> exit', false, (await view(g)).me?.intent));
    await g.waitForFunction(() => window.__hgView?.status === 'escaped', null, { timeout: 30000 }).then(() => check('escaped through the Garden Gate', true), () => check('escaped through the Garden Gate', false));
    await sleep(1500);
    await shot(g, '20-escaped');
    // Everyone else turns -> the night ends -> results (landscape two columns).
    const others = ['anika', 'marcus', 'mei', 'dev', 'amara', 'alex', 'andre', 'rafael', 'simone', 'owen', 'tessa', 'nia'];
    await host2.evaluate(ids => window.__hgHost.send('test:setup', { infect: ids }), others);
    await g.waitForSelector('#screen-results:not([hidden])', { timeout: 15000 }).then(() => check('results screen', true), () => check('results screen', false));
    await sleep(500);
    await shot(g, '21-results-landscape');
    // Room-card capture mode still renders (tools/capture-rooms.mjs).
    const c = await (await browser.newContext({ viewport: { width: 800, height: 500 } })).newPage();
    await c.goto(`${base}/?capture=conservation`);
    await c.waitForFunction(() => window.__captureReady === true, null, { timeout: 60000 }).then(() => check('capture mode ready', true), () => check('capture mode ready', false));
    await shot(c, '22-capture-mode-conservation');
  }
  // Debug line.
  report.checks.debug = await p.textContent('#debug');
  report.checks.version = await p.evaluate(() => window.__hgView?.me?.pos);
} catch (e) {
  report.errors.push('FATAL ' + (e.stack || e.message));
  console.error(e);
} finally {
  report.shots = shots;
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ errors: report.errors, console: report.console.slice(0, 20) }, null, 2));
  await browser.close();
}
