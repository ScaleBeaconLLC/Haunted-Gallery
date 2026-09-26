// View Gallery scenario on a TEST server (HG_TEST_HOOKS=1): a phone-sized player in the
// Portrait Corridor walks to the curated wall, looks through a section's works (close view of
// the actual wall), and goes back to the game; a desktop player nearby sees them standing at the
// wall (visible, not hidden). Screenshots + checks.
//
//   BROWSER=... PLAYWRIGHT=... node tools/e2e/gallery.mjs [baseUrl] [outDir]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT ? `file://${process.env.PLAYWRIGHT.replace(/\\/g, '/')}/index.mjs` : 'playwright-core');
const base = process.argv[2] || 'http://localhost:2570';
const out = process.argv[3] || 'gallery-out';
mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const report = { checks: {}, errors: [] };
const shot = (p, name) => p.screenshot({ path: join(out, `${name}.png`) });
const view = p => p.evaluate(() => window.__hgView);
async function tap(p, sel) {
  for (let i = 0; i < 8; i++) {
    if (await p.locator(sel).first().click({ timeout: 4000 }).then(() => true, () => false)) return;
    await sleep(300);
  }
  throw new Error(`could not tap ${sel}`);
}

const browser = await chromium.launch({ executablePath: process.env.BROWSER, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const host = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
  await host.goto(`${base}/host.html`);
  await host.click('#h-create');
  await host.waitForFunction(() => /^[A-Z2-9]{5}$/.test(document.getElementById('h-code').textContent));
  const code = await host.textContent('#h-code');
  const hook = payload => host.evaluate(pl => window.__hgHost?.send('test:setup', pl), payload);
  const players = {};
  for (const [id, name, kind] of [['julian', 'Jules', 'phone'], ['anika', 'Ani', 'desktop']]) {
    const ctx = kind === 'phone'
      ? await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
      : await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const p = await ctx.newPage();
    p.on('pageerror', e => report.errors.push(`${id}: ${e.message}`));
    await p.goto(`${base}/?code=${code}`);
    await p.fill('#join-name', name);
    await p.click('#join-go');
    await p.waitForSelector('#screen-lobby:not([hidden])');
    await p.click(`[data-claim="${id}"]`);
    players[id] = p;
  }
  const { julian, anika } = players;
  await host.waitForFunction(() => document.querySelector('#h-stats')?.textContent.includes('2joined'));
  await host.uncheck('#h-cpu');
  await host.click('#h-start');
  await sleep(1500);
  await hook({ skipOpening: true });
  await julian.waitForFunction(() => document.getElementById('hud-phase')?.textContent === 'Survive', null, { timeout: 20000 });
  const birthday = await host.evaluate(() => window.__hgHostState?.birthday);
  await hook({ inertCpu: true, place: { elias: [14, 8], [birthday]: [-11.75, 9], julian: [-19.5, 60.2], anika: [-16.5, 59.2] } });
  await sleep(1200);

  // The option appears only in the corridor, near a section.
  const opts = (await view(julian))?.options?.gallery?.map(g => g.id);
  report.checks.offered = opts;
  await shot(julian, '01-phone-corridor-view-gallery-offered');
  await tap(julian, '[data-act="gallery"][data-station="receptions"]');
  await julian.waitForFunction(() => window.__hgView?.me?.viewing === 'receptions', null, { timeout: 20000 });
  await sleep(1800);
  await shot(julian, '02-phone-view-gallery-winter-reception');
  report.checks.viewing = (await view(julian)).me.viewing;
  report.checks.firstWork = await julian.textContent('.gallery-work b');
  await tap(julian, '[data-act="gal-step"][data-step="-1"]');
  await sleep(1500);
  await shot(julian, '03-phone-view-gallery-new-year-1931');
  report.checks.previousWork = await julian.textContent('.gallery-work b');
  // Anika, nearby, sees Julian standing at the wall — in the open, not hidden.
  const seen = (await view(anika))?.actors?.find(a => a.id === 'julian');
  report.checks.anikaSeesViewer = seen ? seen.action : 'not visible';
  await shot(anika, '04-desktop-someone-at-the-portrait-wall');
  const timer1 = await julian.textContent('#hud-timer');
  await sleep(2500);
  report.checks.timerRuns = timer1 !== await julian.textContent('#hud-timer');
  await tap(julian, '[data-act="gal-back"]');
  await julian.waitForFunction(() => !window.__hgView?.me?.viewing, null, { timeout: 10000 });
  await sleep(1200);
  await shot(julian, '05-phone-back-to-game');
  report.checks.backToGame = true;
  // Walk to the host section and look at the Curator's 1902 portrait.
  await hook({ place: { julian: [6.5, 60.2] } });
  await sleep(1000);
  await tap(julian, '[data-act="gallery"][data-station="host"]');
  await julian.waitForFunction(() => window.__hgView?.me?.viewing === 'host', null, { timeout: 20000 });
  await tap(julian, '[data-act="gal-step"][data-step="-1"]');
  await sleep(1800);
  await shot(julian, '06-phone-view-gallery-the-curator-1902');
  report.checks.curatorWork = await julian.textContent('.gallery-work b');
  await hook({ place: { julian: [20.5, 60.2] } });
  await sleep(1000);
  await tap(julian, '[data-act="gallery"][data-station="collection"]');
  await julian.waitForFunction(() => window.__hgView?.me?.viewing === 'collection', null, { timeout: 20000 });
  await sleep(1800);
  await shot(julian, '07-phone-view-gallery-reserved-frame');
  report.checks.reservedWork = await julian.textContent('.gallery-work b');
} catch (e) {
  report.errors.push(`FAILED: ${e.message}`);
  console.error(e.message);
} finally {
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify(report, null, 2));
