// Opening arrival shot on any server (no test hooks needed): the limousine pulls up at the
// front steps and the arriving guests walk to the doors, then the opening cuts inside.
// Screenshots from a desktop and a phone-sized browser. Headless software rendering is slow,
// so the shot runs in debug slow motion (?debug=1 only) and screenshots wait on its own clock.
//
//   HOST_KEY=... BROWSER=... PLAYWRIGHT=... node tools/e2e/arrival.mjs [baseUrl] [outDir]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT ? `file://${process.env.PLAYWRIGHT.replace(/\\/g, '/')}/index.mjs` : 'playwright-core');
const base = process.argv[2] || 'http://localhost:2570';
const out = process.argv[3] || 'arrival-out';
mkdirSync(out, { recursive: true });
const report = { shots: [], checks: {}, errors: [] };
const browser = await chromium.launch({ executablePath: process.env.BROWSER, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const host = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
  await host.goto(`${base}/host.html`, { timeout: 120000 });
  if (process.env.HOST_KEY) await host.fill('#h-key', process.env.HOST_KEY);
  await host.click('#h-create');
  await host.waitForFunction(() => /^[A-Z2-9]{5}$/.test(document.getElementById('h-code').textContent));
  const code = await host.textContent('#h-code');
  const pages = {};
  for (const [id, name, kind] of [['anika', 'Ani', 'desktop'], ['julian', 'Jules', 'phone']]) {
    const ctx = kind === 'phone'
      ? await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
      : await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const p = await ctx.newPage();
    p.on('pageerror', e => report.errors.push(`${id}: ${e.message}`));
    await p.goto(`${base}/?code=${code}&debug=1`, { timeout: 120000 });
    await p.fill('#join-name', name);
    await p.click('#join-go');
    await p.waitForSelector('#screen-lobby:not([hidden])');
    await p.click(`[data-claim="${id}"]`);
    pages[id] = p;
  }
  await pages.anika.waitForTimeout(4000);   // let the character models download
  await host.waitForFunction(() => document.querySelector('#h-stats')?.textContent.includes('2joined'));
  for (const p of Object.values(pages)) await p.evaluate(() => { window.__hgGame.arrivalTimeScale = 0.95; });
  await host.click('#h-start');
  const at = (p, t) => p.waitForFunction(tt => (window.__hgGame.arrival?.t ?? 0) >= tt, t, { timeout: 180000 });
  const shots = [
    ['01-desktop-limousine-pulls-up', pages.anika, 0.9],
    ['02-phone-guests-step-out', pages.julian, 2.6],
    ['03-desktop-guests-walk-to-the-doors', pages.anika, 3.6],
  ];
  for (const [name, page, t] of shots) {
    await at(page, t);
    await page.screenshot({ path: join(out, `${name}.png`) });
    report.shots.push([name, await page.evaluate(() => +window.__hgGame.arrival?.t.toFixed(2))]);
  }
  report.checks.guestsOut = await pages.anika.evaluate(() => window.__hgGame.arrival?.doubles.filter(d => d.a.entity.enabled).length);
  report.checks.guestModels = await pages.anika.evaluate(() => window.__hgGame.arrival?.doubles.filter(d => d.a.model).length);
  report.checks.limo = await pages.anika.evaluate(() => window.__hgGame.world.limo.children.length > 0);
  await pages.anika.waitForFunction(() => !window.__hgGame.arrival, null, { timeout: 180000 });
  await pages.anika.waitForTimeout(1500);
  await pages.anika.screenshot({ path: join(out, '04-desktop-inside-the-foyer.png') });
  report.checks.arrivalEnded = true;
} catch (e) {
  report.errors.push(`FAILED: ${e.message}`);
} finally {
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify(report, null, 2));
