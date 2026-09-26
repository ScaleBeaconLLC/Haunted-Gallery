// Renders each room EMPTY from a fixed viewpoint in the real PlayCanvas scene and saves
// optimized JPEG navigation cards to client/public/rooms/<room>.jpg. No players,
// hiding positions or camera location can appear: capture mode renders no actors.
//
//   BROWSER=... PLAYWRIGHT=.../playwright-core node tools/capture-rooms.mjs [baseUrl]
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT ? `file://${process.env.PLAYWRIGHT.replace(/\\/g, '/')}/index.mjs` : 'playwright-core');
const base = process.argv[2] || 'http://localhost:2567';
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'client', 'public', 'rooms');
mkdirSync(out, { recursive: true });
const ROOMS = ['portrait', 'sculpture', 'archive', 'conservation', 'study', 'sealed', 'mirrors', 'corridor', 'master_bedroom', 'guest_bedroom', 'spare_bedroom', 'guest_bath'];

const browser = await chromium.launch({ executablePath: process.env.BROWSER, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 1 })).newPage();
for (const room of ROOMS) {
  await page.goto(`${base}/?capture=${room}`);
  await page.waitForFunction(() => window.__captureReady === true, null, { timeout: 30000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(out, `${room}.jpg`), type: 'jpeg', quality: 78 });
  console.log(`captured ${room}`);
}
await browser.close();
