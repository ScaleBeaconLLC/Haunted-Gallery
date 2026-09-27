// Landscape entry: stage marker for the rotate prompt, the "Enter the mansion" launch
// (fullscreen + landscape lock where the device supports them, wake lock), the iPhone
// Add to Home Screen sheet and the Android install prompt.
import { local } from './net.js';

const $ = id => document.getElementById(id);
const ua = navigator.userAgent || '';
export const isIOS = /iP(hone|od|ad)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => navigator.standalone === true
  || matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches;
const canFullscreen = () => !!(document.documentElement.requestFullscreen && document.fullscreenEnabled);
const canLock = () => !!screen.orientation?.lock;

/** join | lobby (joined, no guest yet) | ready (guest chosen) | play (opening, hunt, results). */
export function setStage(stage) {
  if (document.body.dataset.stage !== stage) document.body.dataset.stage = stage;
}

let wakeLock = null;
export async function requestWakeLock() {
  try { if (!wakeLock || wakeLock.released) wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* unsupported or denied */ }
}

/** True once the player has launched (or the page is already running full screen / from the Home Screen). */
export const launched = () => document.body.classList.contains('launched') || isStandalone() || !!document.fullscreenElement;

/**
 * "Enter the mansion" (a user gesture): full screen and a landscape lock where supported
 * (Android Chrome); iPhone Safari supports neither, so the rotate prompt is its fallback.
 */
export async function launch() {
  document.body.classList.add('launched');
  requestWakeLock();
  try {
    if (canFullscreen() && !document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
  } catch { /* refused: the page stays in the browser */ }
  try { if (canLock()) await screen.orientation.lock('landscape'); } catch { /* not supported (iOS) or not full screen */ }
  window.dispatchEvent(new Event('resize'));
}
/** Whether the launch button can do more than the rotate prompt already does. */
export const launchUseful = () => canFullscreen() || canLock();

// ------------------------------------------------------------------ Add to Home Screen
let installEvent = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installEvent = e;
  renderInstall();
});
window.addEventListener('appinstalled', () => { installEvent = null; renderInstall(); });

function renderInstall() {
  const btn = $('install-go');
  if (btn) btn.hidden = !installEvent;
}

export function setupInstall() {
  const sheet = $('a2hs');
  const dismissed = local?.getItem('hg.a2hs.dismissed') === '1';
  if (sheet) sheet.hidden = !(isIOS && !isStandalone() && !dismissed);
  $('a2hs-close')?.addEventListener('click', () => { local?.setItem('hg.a2hs.dismissed', '1'); sheet.hidden = true; });
  $('install-go')?.addEventListener('click', async () => {
    if (!installEvent) return;
    const e = installEvent; installEvent = null;
    try { await e.prompt(); await e.userChoice; } catch { /* dismissed */ }
    renderInstall();
  });
  renderInstall();
  if (isStandalone()) document.body.classList.add('standalone');
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && document.body.dataset.stage === 'play') requestWakeLock(); });
}
