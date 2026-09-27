// Phone client: join by QR code, pick a guest, then play. Every action is an intent;
// the server's private "view" (what your character can perceive) is the only truth.
// Played in landscape: the mansion fills the screen, taps on the 3D view choose where to go,
// and small controls in the corners appear only when they are relevant.
import { CAST, DOORWAYS, EXIT_POINT, GALLERY, OPENING_BEATS, ROOMS, SOS_PRESETS, TUNING, hideSpot } from '@game/data.ts';
import * as pc from 'playcanvas';
import { Connection, local } from './net.js';
import { Game3D } from './game3d.js';
import { GameAudio } from './audio.js';
import { castInfo } from './actors.js';
import { preloadCast } from './characters.js';
import { allCastParts } from './cast-looks.js';
import { mapSvg } from './map.js';
import { KeyboardSteer } from './stick.js';
import { Gestures } from './input.js';
import { pickAt, roomsOf, zoneAt } from './picker.js';
import { StruggleOverlay } from './struggle.js';
import { launch, launched, launchUseful, requestWakeLock, setStage, setupInstall } from './launch.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const first = id => castInfo(id)?.name.split(' ')[0] ?? id;
const params = new URLSearchParams(location.search);
/** Write text only when it changed (no per-frame DOM churn). */
const setText = (el, s) => { if (el && el.__t !== s) { el.textContent = s; el.__t = s; } };

// Capture mode renders an empty room from a fixed viewpoint for the room picture cards.
const captureRoom = params.get('capture');

const conn = new Connection();
const audio = new GameAudio();
const game = new Game3D($('stage'), { now: () => conn.now() });
let pub = null, view = null, me = null;
let openingFired = new Set();
let sheetOpen = null;
let pending = null;       // { label, at } an intent sent but not yet reflected by the server
let lastIntentSeq = 0;
let lastInterrupted = null;
let pace = local?.getItem('hg.pace') === 'run' ? 'run' : 'walk';
let lastTap = null;       // { kind, point, at } the destination the player just tapped
let runOnce = null;       // a double-tap run: pace goes back to the chosen one on arrival
let seenArrivals = { room: null, ids: new Set() };
let lunging = false;
let sosAlert = null;      // an SOS just arrived: show the chip once the sender's name is in the view

if (captureRoom) {
  document.body.classList.add('capture');
  game.setCapture(captureRoom);
  // Optional camera for checking a room from another angle: &shot=x,y,z,tx,ty,tz
  const shot = params.get('shot')?.split(',').map(Number);
  if (shot?.length === 6) {
    game.captureShot = { pos: new pc.Vec3(shot[0], shot[1], shot[2]), target: new pc.Vec3(shot[3], shot[4], shot[5]), near: 0.2 };
    game.camPos.copy(game.captureShot.pos);
  }
  window.__hgApp = game.app; // capture tooling reads render stats (draw calls)
  // Wait for the furniture models so the room cards show the real rooms.
  game.world.propsReady.then(() => setTimeout(() => { window.__captureReady = true; }, 1500));
} else {
  preloadCast(game.app, allCastParts());   // download the cast while players join and wait
  $('join-code').value = (params.get('code') || '').toUpperCase();
  $('join-name').value = local?.getItem('hg.name') || '';
  if (params.get('debug')) { $('debug').hidden = false; window.__hgGame = game; game.countStats = true; }
  setupInstall();
}

// ------------------------------------------------------------------ join
$('join-go').addEventListener('click', async () => {
  const code = $('join-code').value.trim().toUpperCase();
  const name = $('join-name').value.trim();
  if (!/^[A-Z2-9]{5}$/.test(code)) return toast('Enter the 5-letter code from the QR poster.');
  if (!name) return toast('Enter your name.');
  local?.setItem('hg.name', name);
  $('join-go').disabled = true;
  await audio.unlock();
  audio.loadManifest().then(() => audio.preloadCharacters(CAST.map(c => c.id)));
  try {
    await conn.joinPlayer(code, name);
    history.replaceState(null, '', `?code=${code}${params.get('debug') ? '&debug=1' : ''}`);
    $('screen-join').hidden = true;
    render();
    requestWakeLock();
  } catch (e) {
    toast(e?.message || 'Could not join. Check the code.');
  } finally {
    $('join-go').disabled = false;
  }
});
document.addEventListener('pointerdown', () => audio.unlock(), { passive: true });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && conn.room) requestWakeLock(); });

// "Enter the mansion": full screen + landscape where the phone allows it (a user gesture).
for (const id of ['launch-go', 'rotate-go']) $(id).addEventListener('click', async () => { await launch(); render(); });

// ------------------------------------------------------------------ direct movement (desktop keyboard)
// WASD / arrows walk relative to the camera, Shift runs. The phone resends ~8x a second;
// the server moves the character (walls, furniture, doorways).
let stickValue = { x: 0, y: 0, s: 0 }, steerActive = false;
const stick = new KeyboardSteer(v => { stickValue = v; if (v.s >= 0.12) steerTip(); });
const canSteer = () => pub?.phase === 'hunt' && !pub.paused && view?.me && view.status !== 'escaped'
  && !view.me.caught && !view.me.struggle && !view.me.grabbing && !view.me.stunned && !sheetOpen;
setInterval(() => {
  if (!conn.room) return;
  const v = stickValue;
  if (v.s >= 0.12 && canSteer()) {
    const fw = game.camera.forward, rt = game.camera.right;
    const fl = Math.hypot(fw.x, fw.z) || 1, rl = Math.hypot(rt.x, rt.z) || 1;
    const x = rt.x / rl * v.x + fw.x / fl * v.y, z = rt.z / rl * v.x + fw.z / fl * v.y;
    conn.send('steer', { x: +x.toFixed(3), z: +z.toFixed(3), s: +v.s.toFixed(2) });
    steerActive = true;
  } else if (steerActive) {
    conn.send('steer', { x: 0, z: 0, s: 0 });
    steerActive = false;
  }
}, 120);
/** Explain the sound rule once, at the first real move (not a wall of instructions). */
function steerTip(force = false) {
  if (!force && local?.getItem('hg.tip.steer')) return;
  local?.setItem('hg.tip.steer', '1');
  caption('Arrow keys or WASD walk quietly. Hold Shift to run: faster, but anyone nearby hears you.', true);
}

// ------------------------------------------------------------------ network
conn.addEventListener('state', e => { pub = e.detail; render(); });
conn.addEventListener('hello', e => { me = e.detail.character; game.setMe(me); render(); });
conn.addEventListener('view', e => {
  const prev = view;
  view = e.detail;
  window.__hgView = view; // this phone's own view (used by automated tests)
  const mine = view?.id ?? view?.character ?? null;
  if (mine !== me) { me = mine; game.setMe(me); }
  game.applyView(view, pub);
  const intent = view?.me?.intent;
  if (intent && intent.seq !== lastIntentSeq) { lastIntentSeq = intent.seq; pending = null; }
  if (intent?.state === 'interrupted' && intent.reason && lastInterrupted !== `${intent.seq}:${intent.reason}`) {
    lastInterrupted = `${intent.seq}:${intent.reason}`;
    caption(intent.reason, true);
  }
  if (prev?.me?.hideState !== 'hidden' && view?.me?.hideState === 'hidden') {
    // Settled into cover: this character's quiet line, on this phone only.
    audio.voice(view.id, 'quiet', view.me.hidePos);
    game.setPeek(false);
  }
  if (sosAlert) {
    const s = view?.sos?.inbox?.find(x => x.id === sosAlert);
    if (s) { sosAlert = null; alertChip(`${s.senderName} needs help · tap to answer`, 'sos'); }
  }
  struggleUi.update(pub?.phase === 'hunt' ? view?.me?.struggle ?? null : null);
  watchArrivals();
  watchLunge();
  updateWorldFeedback();
  if (runOnce && view?.me && !view.me.moving && Date.now() - runOnce > 700) {
    runOnce = null;
    if (view.me.pace !== pace && view.status !== 'escaped') conn.send('pace', { pace });
  }
  render();
});
conn.addEventListener('fx', e => onFx(e.detail));
conn.addEventListener('error', e => { pending = null; lastTap = null; toast(e.detail); render(); });
conn.addEventListener('reset', () => { view = null; openingFired = new Set(); closeSheet(); $('briefing').hidden = true; struggleUi.hide(); render(); });
conn.addEventListener('status', e => {
  const s = e.detail;
  $('conn').hidden = s === 'connected' || s === 'idle' || s === 'ended';
  $('conn').textContent = s === 'reconnecting' || s === 'joining' ? 'Reconnecting…' : 'Connection lost — retrying';
});
// The session can't be resumed (ended, wrong code, or taken over elsewhere): say so plainly.
conn.addEventListener('ended', e => {
  view = null; pub = null;
  $('hud').hidden = true; $('screen-lobby').hidden = true; $('screen-results').hidden = true;
  for (const id of ['pace', 'actions', 'flash-btn', 'gallery-card', 'notice']) $(id).hidden = true;
  struggleUi.hide(); closeSheet();
  $('screen-join').hidden = false;
  setStage('join');
  toast(e.detail);
  $('join-note').textContent = e.detail;
});

const sentLog = params.get('debug') ? (window.__hgSent = []) : null;   // automated tests read what was sent
function send(type, payload, label) {
  if (label) { pending = { label, at: Date.now() }; render(); }
  sentLog?.push({ type, payload, at: Date.now() });
  conn.send(type, payload);
}
// The server takes one move per 350 ms: a quick second tap waits its turn (the last one wins).
let intentQueued = null, lastIntentAt = 0;
function intent(payload, label, paceNow = pace) {
  const msg = { ...payload, pace: paceNow };
  const wait = lastIntentAt + TUNING.intentCooldownMs + 20 - Date.now();
  if (wait > 0) {
    if (!intentQueued) setTimeout(() => { const q = intentQueued; intentQueued = null; if (q) intent(q.payload, q.label, q.paceNow); }, wait);
    intentQueued = { payload, label, paceNow };
    return;
  }
  lastIntentAt = Date.now();
  send('intent', msg, label);
}

const struggleUi = new StruggleOverlay($('struggle'), {
  send: p => { sentLog?.push({ type: 'struggle', payload: p, at: Date.now() }); conn.send('struggle', p); },
  now: () => conn.now(),
  buzz: p => buzz(p),
  totalMs: TUNING.struggleMs ?? 2700,
});

// ------------------------------------------------------------------ effects (each only reaches phones that perceive it)
function actorPos(id) { return (id === me ? view?.me?.pos : null) ?? game.actors.get(id)?.pos ?? view?.me?.pos ?? [0, 0]; }

function onFx(fx) {
  switch (fx.type) {
    case 'grabbed':
      audio.zombieCue(actorPos(fx.hunter));
      audio.voice(fx.victim, 'grabbed', actorPos(fx.victim));
      if (fx.victim === me) { buzz([300]); caption('CAUGHT! Someone with the camera or a snare can still save you.', true); }
      break;
    case 'bite':
      audio.voice(fx.victim, 'bite', actorPos(fx.victim));
      audio.biteFoley(actorPos(fx.victim));
      if (fx.victim === me) { buzz([500, 100, 500]); caption('Bitten. You couldn\'t pull free.', true); }
      break;
    case 'struggle':
      if (!fx.victim || fx.victim === me) { buzz([120, 40, 120]); caption('Break free! Tap as fast as you can!', true); }
      break;
    case 'broke_free':
      caption(fx.id === me ? 'You broke free! Run!' : `${first(fx.id)} broke free!`, true);
      if (fx.id === me) buzz([60, 40, 60]);
      break;
    case 'you_turned':
      showBriefing(fx.by);
      break;
    case 'search_done':
      if (fx.found?.includes(me)) { audio.voice(me, 'discovery', actorPos(me)); buzz([120, 60, 120]); caption('Found!', true); }
      break;
    case 'searching':
      if (view?.me?.hide === fx.spot) buzz([40]);
      break;
    case 'flash':
      flashScreen();
      game.flashAt(actorPos(fx.by));
      audio.flash(actorPos(fx.by));
      if (fx.by === me) caption(fx.frozen.length ? 'Flash! They freeze for five seconds — move!' : 'Flash! Nothing froze.', true);
      break;
    case 'snared':
      caption('Tangled in the rope snare!', true);
      break;
    case 'recovered':
      break;
    case 'escape':
      caption(fx.id === me ? 'Through the Garden Gate — you escaped alive! +100' : `${first(fx.id)} escaped through the Garden Gate.`, true);
      break;
    case 'rescue_paid':
      if (fx.helper === me) caption(`${first(fx.victim)} escaped — your rescue counts! +150`, true);
      break;
    case 'camera_pickup':
      caption(fx.by === me ? 'You have the antique camera.' : `${first(fx.by)} picked up the camera.`);
      break;
    case 'camera_pass':
      caption(fx.recipient === me ? `${first(fx.from)} handed you the camera.` : `${first(fx.from)} passed the camera.`);
      break;
    case 'camera_drop':
      if (!fx.opening) caption('The camera hits the floor.');
      break;
    case 'blocking':
      break;
    case 'sos':
      audio.ping(); buzz([80, 40, 80]);
      // The sender's name arrives with the next view (the inbox); fall back to a neutral chip.
      sosAlert = fx.id;
      setTimeout(() => { if (sosAlert === fx.id) { sosAlert = null; alertChip('Someone needs help · tap to answer', 'sos'); } }, 700);
      break;
    case 'sos_reply':
      audio.ping();
      break;
    case 'exit_open':
      caption('A buzz from the south: the Garden Gate has released.', true);
      break;
    case 'deadline_warning':
      audio.alarm();
      caption(fx.leftMs >= 60_000 * 2 ? 'Intercom: "Five minutes. The shutters are warming up."' : 'Intercom: "One minute. Choose quickly."', true);
      showClock();
      break;
    case 'phase':
      if (fx.phase === 'hunt') { audio.alarm(); caption('LOCKDOWN. Choose where to go.', true); showClock(); }
      break;
  }
}

function showBriefing(by) {
  const team = (view?.team || []).map(first).join(', ');
  $('briefing').innerHTML = `<div class="card"><h2>You've turned.</h2>
    <p>${by === 'elias' ? 'Elias Voss' : esc(first(by))} bit you. <b>Nobody else has been told.</b> You still look like yourself from a distance — only a close look at your face gives you away.</p>
    <p>Hunt with Elias${team ? ` (${esc(team)})` : ''}: walk up to survivors to catch them, search hiding places, or stand in a doorway to block it.</p>
    <p class="fine">Survivors' camera flash freezes you for 5 seconds; rope snares tangle you briefly. You always get back up.</p>
    <button class="primary" id="briefing-ok">I understand</button></div>`;
  $('briefing').hidden = false;
  $('briefing-ok').onclick = () => { $('briefing').hidden = true; };
}

function buzz(p) { try { navigator.vibrate?.(p); } catch { /* unsupported */ } }
function flashScreen() { const f = $('flash'); f.classList.add('on'); requestAnimationFrame(() => requestAnimationFrame(() => f.classList.remove('on'))); }
let captionTimer = 0;
function caption(text, big = false) {
  const c = $('caption'); c.textContent = text; c.className = big ? 'big' : ''; c.style.opacity = 1;
  setText($('rotate-sub'), text);   // the rotate prompt mirrors the story so nothing is missed
  clearTimeout(captionTimer); captionTimer = setTimeout(() => { c.style.opacity = 0; }, big ? 4000 : 2800);
}
let toastTimer = 0;
function toast(text, kind = '') { const t = $('toast'); t.textContent = text; t.className = kind; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, kind === 'soft' ? 1400 : 2600); }
let alertTimer = 0;
/** The single top-centre alert chip: neutral, danger (a revealed zombie) or an SOS you can tap. */
function alertChip(text, kind = '') {
  const a = $('alert');
  a.textContent = text; a.className = kind; a.hidden = false;
  a.style.animation = 'none'; void a.offsetWidth; a.style.animation = '';
  clearTimeout(alertTimer); alertTimer = setTimeout(() => { a.hidden = true; }, kind === 'sos' ? 6000 : 3200);
}
$('alert').addEventListener('click', () => { if ($('alert').classList.contains('sos')) { $('alert').hidden = true; openMenu(); } });
let clockTimer = 0;
/** "Final lockdown · 11:xx p.m." shows for a few seconds at the hunt start and at each warning. */
function showClock() { $('hud-clock').classList.add('show'); clearTimeout(clockTimer); clockTimer = setTimeout(() => $('hud-clock').classList.remove('show'), 4000); }

// ------------------------------------------------------------------ what this phone perceives changing
/** Someone newly inside your room: a neutral chip unless the server marks them revealed. */
function watchArrivals() {
  const m = view?.me;
  const room = pub?.phase === 'hunt' && m?.inRoom && view.status !== 'escaped' ? m.zone : null;
  const ids = new Set();
  if (room) {
    const [x0, x1, z0, z1] = ROOMS[room].rect;
    for (const a of view.actors ?? []) if (a.pos[0] >= x0 && a.pos[0] <= x1 && a.pos[1] >= z0 && a.pos[1] <= z1) ids.add(a.id);
  }
  if (room && room === seenArrivals.room) {
    const fresh = (view.actors ?? []).filter(a => ids.has(a.id) && !seenArrivals.ids.has(a.id));
    if (fresh.length) {
      const zombie = fresh.find(a => a.revealed);
      const who = zombie ?? fresh[0];
      alertChip(zombie ? 'A zombie came in' : 'Someone came in', zombie ? 'danger' : '');
      game.emphasize(who.id, !!zombie);
      if (zombie) buzz([90]);
    }
  }
  seenArrivals = { room, ids };
}
/** A hunter's grab windup on you: red edge pulse and a buzz (once per lunge). */
function watchLunge() {
  const now = (view?.actors ?? []).some(a => a.lunging);
  if (now && !lunging) {
    const l = $('lunge'); l.classList.remove('on'); void l.offsetWidth; l.classList.add('on');
    buzz([200]);
  }
  lunging = now;
}

/** Gold rims on reachable rooms, the planned route and the destination ring. */
let hlKey = '', routeKey = '', destKey = '';
function updateWorldFeedback() {
  const w = game.world;
  const m = view?.me;
  const live = pub?.phase === 'hunt' && m && view.status !== 'escaped';
  const rooms = live ? (view.options?.rooms ?? view.huntOptions?.rooms ?? []) : [];
  const current = live ? view.options?.currentRoom ?? (m.inRoom ? m.zone : null) : null;
  const mode = game.mode;
  let hl = [[], null, false];
  if (live && mode === 'mansion') hl = [[...new Set([...rooms, ...(current ? [current] : []), ...(view.options?.exit ? ['sealed'] : [])])], current, true];
  else if (live && mode === 'room') hl = [rooms, current, false];
  const hk = JSON.stringify(hl);
  if (hk !== hlKey) { hlKey = hk; w.highlightRooms?.(...hl); }
  // Route and destination for a trip the server accepted.
  const i = m?.intent;
  const going = live && m.moving && i && i.kind !== 'idle' && i.state !== 'interrupted' && !m.steering;
  const route = going && m.path?.length ? [m.pos, ...m.path] : null;
  const rk = route ? route.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(';') : '';
  if (rk !== routeKey) { routeKey = rk; w.setRoute?.(route); }
  let dest = null, kind = 'move';
  if (going) {
    const tapped = lastTap && lastTap.seq == null && Date.now() - lastTap.at < 4000 ? lastTap : null;
    if (tapped) lastTap.seq = i.seq;
    const t = lastTap && lastTap.seq === i.seq ? lastTap : null;
    kind = i.kind === 'hide' ? 'hide' : i.kind === 'room' || i.kind === 'exit' ? 'room' : 'move';
    dest = t?.point ?? (i.kind === 'hide' ? hideSpot(i.target)?.spot.pos : i.kind === 'exit' ? EXIT_POINT : m.path?.[m.path.length - 1]) ?? null;
  }
  const dk = dest ? `${kind}:${dest[0].toFixed(2)},${dest[1].toFixed(2)}` : '';
  if (dk !== destKey) { destKey = dk; w.setDestination?.(dest, kind); }
}

// ------------------------------------------------------------------ per-frame: timer, opening beats, tags, sound cues
const tagEls = new Map();
function updateTags(tags) {
  const live = new Set();
  for (const t of tags) {
    live.add(t.id);
    let el = tagEls.get(t.id);
    if (!el) { el = document.createElement('div'); el.className = 'tag'; $('tags').appendChild(el); tagEls.set(t.id, el); }
    setText(el, t.name);
    el.style.transform = `translate(${t.x.toFixed(0)}px, ${t.y.toFixed(0)}px) translate(-50%, -100%)`;
    el.hidden = false;
  }
  for (const [id, el] of tagEls) if (!live.has(id)) el.hidden = true;
}

const pinEls = new Map();
function updatePins(pins) {
  const live = new Set();
  for (const p of pins) {
    live.add(p.id);
    let el = pinEls.get(p.id);
    if (!el) { el = document.createElement('div'); $('pins').appendChild(el); pinEls.set(p.id, el); }
    const cls = `pin ${p.me ? 'me' : 'other'}${p.revealed ? ' revealed' : ''}`;
    if (el.className !== cls) el.className = cls;
    el.style.transform = `translate(${p.x.toFixed(0)}px, ${p.y.toFixed(0)}px)`;
    el.hidden = false;
  }
  for (const [id, el] of pinEls) if (!live.has(id)) el.hidden = true;
}

/** Sounds you hear but can't see: a chevron on the screen edge in their direction. */
const cueEls = [];
const CUE_WORDS = { steps: 'steps', running: 'running', search: 'rummaging', struggle: 'struggle' };
function updateSoundCues() {
  const box = $('sounds');
  const sounds = pub?.phase === 'hunt' && !struggleUi.active ? view?.sounds || [] : [];
  const w = window.innerWidth, h = window.innerHeight;
  const heading = game.heading();
  const mx = 56, top = 70, bottom = 84;
  sounds.forEach((s, i) => {
    let el = cueEls[i];
    if (!el) { el = document.createElement('div'); el.innerHTML = '<i></i><span></span>'; box.appendChild(el); cueEls[i] = el; }
    const rel = ((s.bearing - heading + 540) % 360) - 180;   // 0 = ahead (up the screen), -90 = right
    const a = -rel * Math.PI / 180;                          // clockwise from up
    const dx = Math.sin(a), dy = -Math.cos(a);
    const cx = w / 2, cy = h / 2;
    const kx = dx > 0 ? (w - mx - cx) / dx : dx < 0 ? (mx - cx) / dx : Infinity;
    const ky = dy > 0 ? (h - bottom - cy) / dy : dy < 0 ? (top - cy) / dy : Infinity;
    const k = Math.min(kx, ky);
    const cls = `cue ${s.band} ${s.kind}`;
    if (el.className !== cls) el.className = cls;
    setText(el.lastChild, CUE_WORDS[s.kind] ?? 'a sound');
    el.firstChild.style.transform = `rotate(${(-rel).toFixed(0)}deg)`;
    el.style.transform = `translate(${(cx + dx * k).toFixed(0)}px, ${(cy + dy * k).toFixed(0)}px) translate(-50%, -50%)`;
    el.hidden = false;
  });
  for (let i = sounds.length; i < cueEls.length; i++) cueEls[i].hidden = true;
}

let lastCharge = -1;
function updateFlashButton(now) {
  const fb = $('flash-btn');
  if (fb.hidden || !view?.camera?.mine) return;
  const readyAt = view.camera.readyAt ?? 0;
  const k = readyAt > now ? Math.max(0, Math.min(1, 1 - (readyAt - now) / TUNING.cameraRechargeMs)) : 1;
  const q = Math.round(k * 100) / 100;
  if (q !== lastCharge) {
    lastCharge = q;
    fb.style.setProperty('--charge', String(q));
    fb.classList.toggle('charging', q < 1);
    fb.disabled = q < 1;
  }
}

game.onFrame = () => {
  if (!pub || captureRoom) return;
  const now = conn.now();
  if (pub.phase === 'opening' || pub.phase === 'hunt') {
    const left = pub.paused ? null : Math.max(0, Math.ceil((pub.phaseEndsAt - now) / 1000));
    setText($('hud-timer'), pub.paused ? 'II' : pub.phase === 'hunt' ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : String(left));
    // Fictional mansion clock: 11:45 p.m. when the hunt starts, final lockdown at midnight.
    if (pub.phase === 'hunt' && left != null) {
      const minsLeft = Math.ceil(left / 60);
      setText($('hud-clock'), left > 0 ? `Final lockdown · 11:${String(60 - minsLeft).padStart(2, '0')} p.m.` : 'Midnight');
      $('hud-timer').classList.toggle('urgent', left <= 60);
    } else setText($('hud-clock'), '');
  }
  if (pub.phase === 'opening' && !pub.paused) {
    const t = (now - (pub.phaseEndsAt - TUNING.openingMs)) / 1000;
    for (const beat of OPENING_BEATS) {
      if (t >= beat.at && !openingFired.has(beat.id)) {
        openingFired.add(beat.id);
        game.openingBeat(beat.id, pub);
        if (beat.id === 'lockdown') audio.alarm();
        if (beat.id === 'freeze') { flashScreen(); audio.flash(ROOMS.portrait.center); }
        caption(beat.caption.replace(/\{birthday\}/g, castInfo(pub.birthday)?.name ?? 'The birthday guest')
          .replace(/\{photographer\}/g, pub.photographer === me ? 'You' : castInfo(pub.photographer)?.name ?? 'A guest'), true);
      }
    }
  }
  updateFlashButton(now);
  updateTags(game.tags());
  updatePins(game.pins());
  updateSoundCues();
  struggleUi.frame();
  const cp = game.camera.getPosition();
  audio.setListener(cp.x, cp.z, game.heading() + 180);
  if (!$('debug').hidden) {
    const s = game.stats; const mem = performance.memory ? ` heap ${(performance.memory.usedJSHeapSize / 1048576).toFixed(0)}MB` : '';
    const st = game.app.stats;
    const cam = game.camera.camera;
    $('debug').textContent = `fps ${s.fps.toFixed(0)} avg ${s.ms.toFixed(1)}ms worst ${(s.worstMs ?? 0).toFixed(0)}ms${mem}\n`
      + `dpr ${devicePixelRatio} x${game.app.graphicsDevice.maxPixelRatio} ${game.app.graphicsDevice.width}x${game.app.graphicsDevice.height}\n`
      + `draws ${st?.drawCalls?.total ?? '?'} tris ${((st?.frame?.triangles || s.tris || 0) / 1000).toFixed(0)}k\n`
      + `cam ${game.mode}${game.fpKind ? ':' + game.fpKind : ''}${game.userView ? ' (user)' : ''} near ${cam.nearClip.toFixed(2)} far ${cam.farClip.toFixed(0)}`;
  }
};

// ------------------------------------------------------------------ rendering
function seatName(id) {
  const seat = pub?.seats?.get?.(id);
  return seat?.displayName && !seat.isCpu ? `${first(id)} (${seat.displayName})` : castInfo(id)?.name ?? id;
}
const roomName = r => ROOMS[r]?.name ?? r;
const zoneLabel = m => m.inRoom ? roomName(m.room) : m.zone === 'exit' ? 'Service passage · Garden Gate' : `Passage off the ${roomName(m.room)}`;

function render() {
  if (captureRoom) return;
  const joined = $('screen-join').hidden;
  if (!joined) { setStage('join'); return; }
  if (!pub) return;
  const inLobby = pub.phase === 'lobby';
  setStage(inLobby ? (me ? 'ready' : 'lobby') : 'play');
  $('screen-lobby').hidden = !(inLobby && joined);
  $('hud').hidden = inLobby || !joined || pub.phase === 'ended';
  if (inLobby) {
    if (joined) renderLobby();
    for (const id of ['pace', 'actions', 'flash-btn', 'gallery-card', 'notice']) $(id).hidden = true;
    $('screen-results').hidden = true;
    renderRotate();
    return;
  }
  renderHud();
  renderControls();
  renderActions();
  renderGalleryCard();
  renderNotice();
  if (sheetOpen === 'menu') setHtml($('sheet-body'), menuHtml());
  renderResults();
  renderRotate();
  const caught = view?.me?.caught;
  $('vignette').className = caught ? 'v-danger' : view?.me?.hideState === 'hidden' ? 'v-hidden' : '';
  $('threat').hidden = !caught || struggleUi.active;
  if (caught) $('threat').textContent = 'CAUGHT!';
}

function renderRotate() {
  $('rotate-go').hidden = launched() || !launchUseful();
}

function renderLobby() {
  const seats = pub.seats;
  setHtml($('cast-grid'), CAST.map(c => {
    const seat = seats.get(c.id);
    const mine = me === c.id;
    const taken = seat?.taken && !mine;
    return `<button class="cast ${mine ? 'mine' : ''} ${taken ? 'taken' : ''}" data-claim="${c.id}" ${taken ? 'disabled' : ''}>
      <div class="n"><span class="dot" style="background:${c.color}"></span>${esc(c.name)}</div>
      <div class="t">${mine ? 'You' : taken ? esc(seat.displayName) : 'Available'} · <span class="shoe" style="background:${c.shoes}"></span> shoes</div></button>`;
  }).join(''));
  $('lobby-sub').textContent = me ? `You are ${castInfo(me).name}. Tap another guest to switch.` : 'Tap a guest. Each can be chosen once.';
  $('lobby-wait').textContent = `${pub.humanCount} of 12 joined · waiting for the host to start. ${pub.cpuFill ? 'Empty seats will be played by the computer.' : ''}`;
  $('launch-go').hidden = !me || launched();
}
$('cast-grid').addEventListener('click', e => {
  const b = e.target.closest('[data-claim]');
  if (!b) return;
  conn.send('claim', { character: b.dataset.claim, name: local?.getItem('hg.name') || $('join-name').value });
  audio.voice(b.dataset.claim, 'quiet', [0, 0], { gain: 0.6 });
});

function statusLine() {
  if (!view) return '';
  const m = view.me;
  if (view.status === 'escaped') return 'Outside — alive';
  if (!m) return '';
  if (m.caught) return 'Caught!';
  if (m.stunned === 'frozen') return 'Frozen by the flash';
  if (m.stunned === 'tangled') return 'Tangled in a rope snare — recovering';
  if (m.hideState === 'hidden') return m.peeking ? 'Peeking — you can be seen' : 'Hidden — stay alert';
  if (m.hideState === 'entering') return 'Getting into cover…';
  if (m.hideState === 'leaving') return 'Leaving cover…';
  if (m.searching) return 'Searching…';
  if (m.blocking) return 'Blocking the doorway';
  if (m.moving) {
    const i = m.intent;
    const verb = m.pace === 'run' ? 'Running' : 'Walking';
    if (i.kind === 'room') return `${verb} to the ${roomName(i.target)}`;
    if (i.kind === 'hide') return `${verb} to cover`;
    if (i.kind === 'exit') return `${verb} for the Garden Gate`;
    if (i.kind === 'chase') return `Chasing ${first(i.target)}`;
    if (i.kind === 'search') return `${verb} to search`;
    if (i.kind === 'block') return `${verb} to the doorway`;
    if (i.kind === 'pickup') return `${verb} to the camera`;
    return verb;
  }
  return 'Standing in the open';
}

/** One word under the room name: Still, Sneaking, Running, Hidden, Caught, Travelling… */
function stateWord() {
  if (!view || pub?.phase !== 'hunt') return ['', ''];
  const m = view.me;
  if (view.status === 'escaped') return ['Escaped', ''];
  if (!m) return ['', ''];
  if (m.caught || m.struggle) return ['Caught', 'danger'];
  if (m.stunned === 'frozen') return ['Frozen', 'danger'];
  if (m.stunned === 'tangled') return ['Tangled', 'danger'];
  if (m.stunned === 'shoved') return ['Staggering', 'danger'];
  if (m.stunned) return ['Turning', 'danger'];
  if (m.grabbing) return ['Holding on', 'danger'];
  if (m.hideState === 'hidden') return [m.peeking ? 'Peeking' : 'Hidden', 'hidden'];
  if (m.hideState === 'entering') return ['Hiding', 'hidden'];
  if (m.hideState === 'leaving') return ['Leaving cover', ''];
  if (m.searching) return ['Searching', ''];
  if (m.blocking) return ['Blocking', ''];
  if (m.viewing && !m.moving) return ['Viewing', ''];
  if (m.moving) {
    const dest = game.destinationRoom(m);
    if (!m.inRoom || (dest && dest !== m.zone)) return [m.pace === 'run' ? 'Running' : 'Travelling', m.pace === 'run' ? 'loud' : ''];
    return m.pace === 'run' ? ['Running', 'loud'] : ['Sneaking', ''];
  }
  return ['Still', ''];
}

const live = () => pub?.phase === 'hunt' && !!view?.me && view.status !== 'escaped' && !pub.paused && !captureRoom;

function renderHud() {
  const m = view?.me;
  setText($('hud-room'), view?.status === 'escaped' ? 'Outside the mansion' : m ? zoneLabel(m) : '—');
  const [word, tone] = stateWord();
  const st = $('hud-state');
  setText(st, `${word}${view?.camera?.mine && word ? ' · camera' : ''}${m?.snares && word ? ` · rope ×${m.snares}` : ''}`);
  if (st.dataset.s !== tone) st.dataset.s = tone;
  setText($('hud-status'), `${me ? castInfo(me).name + ' · ' : ''}${statusLine()}`);
  setText($('hud-phase'), pub.paused ? 'Paused by host' : { opening: 'The Unveiling', hunt: view?.role === 'hunter' ? 'You are infected' : 'Survive', ended: 'Aftermath' }[pub.phase] ?? pub.phase);
  if (pub.phase === 'ended') setText($('hud-timer'), '');
  // View buttons: only in the hunt, and not while caught or at the portrait wall.
  const canView = live() && !m.caught && !m.struggle && !(m.viewing && !m.moving);
  $('viewbtns').hidden = !canView;
  $('menu-btn').hidden = !(pub.phase === 'hunt' && view?.me && view.status !== 'escaped');
  const active = game.mode === 'fp' ? 'eye' : game.mode;
  for (const b of document.querySelectorAll('#viewbtns .vbtn')) b.classList.toggle('on', b.dataset.view === active);
  const n = view?.sos?.inbox?.length ?? 0;
  $('menu-badge').hidden = !n;
  setText($('menu-badge'), String(n));
}

function renderControls() {
  const m = view?.me;
  const ok = live() && !m.caught && !m.struggle && !m.stunned && m.hideState !== 'hidden' && m.hideState !== 'entering' && !(m.viewing && !m.moving);
  $('pace').hidden = !ok;
  if (ok) {
    for (const b of $('pace').children) {
      const p = b.dataset.pace;
      const on = p ? m.moving && m.pace === p : !m.moving;
      b.classList.toggle('on', on);
      b.classList.toggle('pref', p === pace);
      b.setAttribute('aria-pressed', String(on));
    }
  }
  const flash = live() && !!view.camera?.mine && view.role === 'survivor';
  $('flash-btn').hidden = !flash;
  document.body.classList.toggle('has-flash', flash);
  if (!flash) lastCharge = -1;
}

function actBtn(act, icon, label, data = {}, title = label, cls = '') {
  const d = Object.entries(data).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('');
  return `<button class="act ${cls}" data-act="${act}"${d} title="${esc(title)}"><b>${icon}</b><span>${esc(label)}</span></button>`;
}
function btn(act, label, { active = false, disabled = false, cls = '', data = {} } = {}) {
  const d = Object.entries(data).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('');
  return `<button class="btn ${cls} ${active ? 'active' : ''}" data-act="${act}"${d} ${disabled ? 'disabled' : ''}>${label}</button>`;
}

/** Up to three contextual pills (bottom right): only what you can do right here, right now. */
function renderActions() {
  const box = $('actions');
  const m = view?.me;
  if (!live() || (m.viewing && !m.moving) || m.stunned) { box.hidden = true; return; }
  const acts = [];
  const cam = view.camera || {};
  if (view.role === 'survivor') {
    const o = view.options || {};
    if (m.caught || m.struggle) {
      if (view.sos?.canSend && !m.struggle) acts.push(actBtn('sos-open', '🆘', 'Call for help'));
    } else if (m.hideState === 'hidden' || m.hideState === 'entering') {
      acts.push(`<button class="act peek ${game.peeking ? 'active' : ''}" data-hold="peek" ${m.hideState !== 'hidden' ? 'disabled' : ''}><b>👁</b><span>Peek</span></button>`);
      acts.push(actBtn('leave', '↩', 'Leave', {}, 'Step out of cover'));
      if (m.snares && m.hideState === 'hidden') acts.push(actBtn('snare', '🪢', 'Snare', {}, 'Rig a snare outside'));
    } else {
      for (const hs of o.nearHides ?? []) acts.push(actBtn('hide', hs.pose === 'under' ? '⬇' : '▮', 'Hide', { spot: hs.id }, hs.label, 'hide'));
      const nearGate = o.exit && (m.zone === 'sealed' || m.zone === 'exit' || roomsOf(m.zone).includes('sealed') && !m.inRoom);
      if (nearGate) acts.push(actBtn('exit', '🚪', 'Garden Gate', {}, pub.exitOpen ? 'Run for the Garden Gate' : 'Garden Gate (locked)', 'gate'));
      if (cam.floor && Math.hypot(cam.floor[0] - m.pos[0], cam.floor[1] - m.pos[1]) < 5) acts.push(actBtn('pickup', '📷', 'Get camera', {}, 'Pick up the antique camera'));
      const clue = o.inspect?.find(c => !c.read) ?? null;
      if (clue) acts.push(actBtn('inspect', '🔎', 'Inspect', { clue: clue.id }, clue.label));
      for (const g of o.gallery ?? []) acts.push(actBtn('gallery', '🖼', 'View Gallery', { station: g.id }, g.label));
      if (cam.mine && o.passTo?.length) acts.push(actBtn('give-open', '🤝', 'Hand over', {}, 'Hand over the camera'));
    }
  } else if (!m.grabbing) {
    const ho = view.huntOptions || {};
    for (const sp of ho.nearSearch ?? []) acts.push(actBtn('search', '✋', 'Search', { spot: sp.id }, sp.label, m.searching === sp.id ? 'active' : ''));
    for (const d of ho.doors ?? []) {
      const dw = DOORWAYS.find(x => x.key === d.key);
      if (dw && Math.hypot(dw.pos[0] - m.pos[0], dw.pos[1] - m.pos[1]) < 2.4) acts.push(actBtn('block', '⛔', 'Block', { door: d.key }, d.label, m.blocking === d.key ? 'active' : ''));
    }
  }
  const shown = acts.slice(0, 3);
  box.hidden = !shown.length;
  setHtml(box, shown.join(''));
}

/** View Gallery: a plaque card (bottom left) while the character stands at the portrait wall. */
function renderGalleryCard() {
  const card = $('gallery-card');
  const m = view?.me;
  if (!live() || !m.viewing || m.moving) { card.hidden = true; return; }
  const st = GALLERY.find(g => g.id === m.viewing);
  if (!st) { card.hidden = true; return; }
  const i = Math.max(0, Math.min(st.portraits.length - 1, game.galleryIndex ?? 1));
  const work = st.portraits[i];
  card.hidden = false;
  setHtml(card, `<h3>View Gallery · ${esc(st.label)}</h3>
    <div class="work"><b>${esc(work.title)}</b><p>“${esc(work.plaque)}”</p></div>
    <div class="row">${btn('gal-step', '‹', { disabled: i === 0, data: { step: -1 } })}${btn('gal-step', '›', { disabled: i === st.portraits.length - 1, data: { step: 1 } })}${btn('gal-back', 'Back to Game', { cls: 'primary' })}</div>
    <p class="fine">The clock keeps running, and anyone passing can see you here.</p>`);
}

function renderNotice() {
  const n = $('notice');
  let html = '';
  if (pub.paused && pub.phase !== 'ended') html = '<h3>Paused</h3><p>The host paused the game.</p>';
  else if (view?.status === 'escaped' && pub.phase !== 'ended') html = `<h3>You escaped</h3><p>You're out alive with <b>${view.score}</b> points. Others may still get out.</p>`;
  n.hidden = !html;
  if (html) setHtml(n, html);
}

// Views arrive ~10x a second: only touch the DOM when content actually changes, so a
// finger that is mid-tap (or holding Peek) never has its button replaced under it.
function setHtml(el, html) {
  if (el.__html === html) return;
  el.innerHTML = html; el.__html = html;
}

function onAct(e) {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const d = b.dataset;
  switch (d.act) {
    case 'still': intent({ kind: 'idle' }, 'stop'); break;
    case 'pace':
      pace = d.pace; runOnce = null; local?.setItem('hg.pace', pace); send('pace', { pace }); render();
      if (!local?.getItem('hg.tip.pace')) { local?.setItem('hg.tip.pace', '1'); caption(pace === 'run' ? 'Running is fast, but anyone within 13 m hears you.' : 'Sneaking: quiet, heard only within 6 m.'); }
      break;
    case 'hide': lastTap = { kind: 'hide', point: hideSpot(d.spot)?.spot.pos, at: Date.now() }; intent({ kind: 'hide', spot: d.spot }, 'to cover'); break;
    case 'leave': {
      const h = view?.me?.hide && hideSpot(view.me.hide);
      const out = h ? frontOfSpot(h.spot) : view?.me?.pos;
      intent({ kind: 'move', p: out }, 'step out'); break;
    }
    case 'exit': game.clearUserView(); intent({ kind: 'exit' }, 'to the Garden Gate'); break;
    case 'gallery': game.galleryIndex = 1; intent({ kind: 'gallery', station: d.station }, 'to the portrait wall'); break;
    case 'gal-step': game.galleryIndex = (game.galleryIndex ?? 1) + Number(d.step); render(); break;
    case 'gal-back': intent({ kind: 'idle' }, 'back to the game'); break;
    case 'pickup': intent({ kind: 'pickup' }, 'to the camera'); break;
    case 'flash': send('flash'); break;
    case 'drop': send('drop'); break;
    case 'snare': send('snare'); break;
    case 'inspect': send('inspect', { clue: d.clue }); break;
    case 'give-open': openGiveSheet(); break;
    case 'sos-open': openSosSheet(); break;
    case 'sos-update': send('sos:update', { id: d.id }); break;
    case 'map-open': openMapSheet(); break;
    case 'menu': openMenu(); break;
    case 'chase': intent({ kind: 'chase', target: d.target }, `after ${first(d.target)}`); break;
    case 'search': intent({ kind: 'search', spot: d.spot }, 'search'); break;
    case 'block': intent({ kind: 'block', door: d.door }, 'block the doorway'); break;
    case 'wait': intent({ kind: 'idle' }, 'wait'); break;
  }
}
/** The open side of a hiding place (same rule as the server's frontOf). */
function frontOfSpot(spot, gap = 0.55) {
  const a = spot.look * Math.PI / 180, dx = Math.sin(a), dz = Math.cos(a);
  const [w, dd] = spot.cover.size;
  const half = Math.abs(dx) * w / 2 + Math.abs(dz) * dd / 2;
  return [+(spot.cover.pos[0] + dx * (half + gap)).toFixed(2), +(spot.cover.pos[1] + dz * (half + gap)).toFixed(2)];
}
for (const id of ['actions', 'pace', 'gallery-card', 'hud']) $(id).addEventListener('click', onAct);
$('flash-btn').addEventListener('click', onAct);
// Peek is press-and-hold.
const peekOn = e => { const b = e.target.closest('[data-hold="peek"]'); if (!b || b.disabled) return; e.preventDefault(); game.setPeek(true); send('peek', { on: true }); b.classList.add('active'); };
const peekOff = () => { if (!game.peeking) return; game.setPeek(false); send('peek', { on: false }); document.querySelector('[data-hold="peek"]')?.classList.remove('active'); };
$('actions').addEventListener('pointerdown', peekOn);
$('actions').addEventListener('contextmenu', e => e.preventDefault());
window.addEventListener('pointerup', peekOff);
window.addEventListener('pointercancel', peekOff);

// View buttons (top right): mansion / room / eyes. They hold until hiding or a struggle takes over.
$('viewbtns').addEventListener('click', e => {
  const b = e.target.closest('[data-view]');
  if (!b || b.disabled) return;
  game.setUserView(b.dataset.view);
  render();
});

// ------------------------------------------------------------------ taps on the 3D view
const canAct = () => live() && !view.me.caught && !view.me.struggle && !view.me.stunned && !view.me.grabbing && !sheetOpen;
function onTap(x, y, { double }) {
  if (!canAct() || game.mode === 'gallery') return;
  const pick = pickAt(game, view, x, y);
  const hidingFp = game.mode === 'fp' && game.fpKind === 'hide';
  if (hidingFp && pick.kind !== 'hide') {
    if (pick.kind !== 'none') caption('Hold Peek to look out. Tap Leave to step out, or the room button to pick a spot.');
    return;
  }
  const at = Date.now();
  const runPace = double ? 'run' : pace;
  switch (pick.kind) {
    case 'hide': lastTap = { kind: 'hide', point: pick.point, at }; intent({ kind: 'hide', spot: pick.spot }, 'to cover'); break;
    case 'pickup': lastTap = { kind: 'move', point: pick.point, at }; intent({ kind: 'pickup' }, 'to the camera', runPace); break;
    case 'exit': game.clearUserView(); lastTap = { kind: 'room', point: pick.point, at }; intent({ kind: 'exit' }, 'to the Garden Gate', runPace); break;
    case 'move': lastTap = { kind: 'move', point: pick.point, at }; intent({ kind: 'move', p: pick.p }, 'move', runPace); break;
    case 'room': game.clearUserView(); lastTap = { kind: 'room', point: pick.point, at }; intent({ kind: 'room', room: pick.room, p: pick.p }, `to the ${roomName(pick.room)}`, runPace); break;
    case 'chase': lastTap = { kind: 'move', point: pick.point, at }; intent({ kind: 'chase', target: pick.target }, `after ${first(pick.target)}`, runPace); break;
    case 'search': lastTap = { kind: 'hide', point: pick.point, at }; intent({ kind: 'search', spot: pick.spot }, 'search'); break;
    case 'block': lastTap = { kind: 'move', point: pick.point, at }; intent({ kind: 'block', door: pick.door }, 'block the doorway', runPace); break;
    case 'far': toast('Too far — choose a room next to yours', 'soft'); return;
    default: return;
  }
  if (double && ['move', 'room', 'exit', 'pickup', 'chase', 'block'].includes(pick.kind) && pace !== 'run') runOnce = Date.now();
  if (pick.point) game.world.setDestination?.(pick.point, lastTap?.kind ?? 'move');
}
/** Pinch / wheel: zoom out mansion <- room <- eyes; zoom in on the mansion frames the room under your fingers. */
function zoom(dir, x, y) {
  if (!live() || view.me.caught || view.me.struggle || game.mode === 'gallery') return;
  if (dir > 0) {
    if (game.mode === 'fp') game.setUserView('room');
    else if (game.mode === 'room') game.setUserView('mansion');
  } else if (game.mode === 'mansion') {
    const { origin, dir: d } = game.screenRay(x, y);
    const t = d.y < -1e-4 ? -origin.y / d.y : null;
    const z = t != null ? zoneAt([origin.x + d.x * t, origin.z + d.z * t]) : null;
    game.setUserView('room', z && ROOMS[z] && z !== view.me.zone ? z : null);
  } else if (game.mode === 'room') game.setUserView('eye');
  render();
}
new Gestures($('stage'), {
  onTap,
  onDrag: (dx, dy) => game.dragBy(dx, dy),
  onPinchEnd: (scale, cx, cy) => { if (scale < 0.8) zoom(1, cx, cy); else if (scale > 1.25) zoom(-1, cx, cy); },
  onWheel: (dir, x, y) => zoom(dir, x, y),
});
game.onModeChange = () => { measureHud(); render(); updateWorldFeedback(); };

/** Screen space the HUD keeps clear, so the eagle-eye views frame the mansion between the controls. */
function measureHud() {
  const h = window.innerHeight;
  const cs = getComputedStyle($('hud'));
  const top = $('hud').hidden ? 56 : Math.max(48, $('hud').getBoundingClientRect().bottom + 6);
  game.hudInsets = { top, bottom: 60 + (parseFloat(getComputedStyle($('pace')).bottom) || 8), left: parseFloat(cs.paddingLeft) || 12, right: parseFloat(cs.paddingRight) || 12 };
  if (h < 300) game.hudInsets.top = Math.min(game.hudInsets.top, 44);
}
game.onResize = () => measureHud();
measureHud();

// ------------------------------------------------------------------ side sheet: menu, SOS, hand over, map
function openSheet(html, kind) { sheetOpen = kind; setHtml($('sheet-body'), html); $('sheet').hidden = false; }
function closeSheet() { sheetOpen = null; $('sheet').hidden = true; }
function openMenu() { openSheet(menuHtml(), 'menu'); }
$('sheet').addEventListener('click', e => {
  if (e.target === $('sheet')) return closeSheet();
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const d = b.dataset;
  if (d.act === 'close') closeSheet();
  else if (d.act === 'back') openMenu();
  else if (d.act === 'sos-to') { $('sheet-body').dataset.to = d.to; for (const x of $('sheet-body').querySelectorAll('[data-act="sos-to"]')) x.classList.toggle('active', x === b); }
  else if (d.act === 'sos-send') {
    const to = $('sheet-body').dataset.to;
    if (!to) return toast('Choose who to ask first.');
    send('sos:send', { to, preset: d.preset });
    closeSheet();
  }
  else if (d.act === 'give') { send('give', { to: d.to }); closeSheet(); }
  else if (d.act === 'sos-reply') send('sos:reply', { id: d.id, reply: d.reply });
  else if (d.act === 'sos-map') openMapSheet(d.id);
  else if (d.act === 'drop') { send('drop'); closeSheet(); }
  else onAct(e);
});

function inboxHtml() {
  const inbox = view?.status === 'alive' ? view.sos?.inbox ?? [] : [];
  if (!inbox.length) return '';
  const now = conn.now();
  return `<h3>Calls for help</h3>${inbox.map(s => {
    const ago = Math.max(0, Math.round((now - s.updatedAt) / 1000));
    return `<div class="sos"><div class="who">${esc(s.senderName)} needs help</div>
      <div class="where">“${esc(s.text)}” · ${esc(s.roomName)}${s.lastSeen ? ' (last seen)' : ''} · ${ago < 10 ? 'just now' : `${Math.round(ago / 10) * 10}s ago`}</div>
      <div class="row">${btn('sos-reply', s.reply === 'coming' ? '✓ Coming' : "I'm coming", { active: s.reply === 'coming', data: { id: s.id, reply: 'coming' } })}
      ${btn('sos-reply', "I can't risk it", { active: s.reply === 'cant', data: { id: s.id, reply: 'cant' } })}
      ${btn('sos-map', 'Map', { data: { id: s.id } })}</div></div>`;
  }).join('')}`;
}

/** The ⋯ menu: who you are, the team, SOS, the camera, clues and the map. */
function menuHtml() {
  if (!view?.me) return `<div class="sheet-head"><h2>Haunted Gallery</h2><button class="sheet-x" data-act="close" aria-label="Close">✕</button></div>`;
  const m = view.me;
  const head = `<div class="sheet-head"><div><h2>${esc(me ? castInfo(me).name : '')}</h2><span class="role">${esc($('hud-phase').textContent)}</span></div>
    <button class="sheet-x" data-act="close" aria-label="Close">✕</button></div>
    <p class="team">${pub.escapedCount} escaped · ${pub.insideCount} still inside · team ${pub.teamScore} pts · Garden Gate ${pub.exitOpen ? 'open' : 'locked'}</p>`;
  const map = `<h3>Map</h3><div class="map">${mapSvg({ myRoom: m.room, exitOpen: pub.exitOpen })}</div>`;
  if (view.role === 'hunter') {
    const team = (view.team ?? []).map(id => esc(seatName(id))).join(', ');
    return `${head}<h3>Your pack</h3><p class="plan">Elias${team ? `, ${team}` : ''}. Walk up to survivors to catch them; tap a hiding place to search it, a doorway to block it.</p>${map}`;
  }
  const cam = view.camera || {};
  const out = view.sos?.outbox?.[0];
  const parts = [head, inboxHtml()];
  parts.push(`<h3>Ask for help</h3>${out ? `<p class="plan">To <b>${esc(out.recipientName)}</b>: “${esc(out.text)}” · ${out.reply === 'coming' ? '<b style="color:var(--ok)">Coming!</b>' : out.reply === 'cant' ? "Can't risk it" : 'no reply yet'}</p>${out.stale ? btn('sos-update', 'Update my location', { data: { id: out.id } }) : ''}` : ''}
    ${view.sos ? btn('sos-open', '🆘 Send an SOS', { disabled: !view.sos.canSend }) : ''}`);
  if (cam.mine) parts.push(`<h3>Antique camera</h3><div class="row">${btn('give-open', 'Hand over', { disabled: !view.options?.passTo?.length })}${btn('drop', 'Drop it')}</div>`);
  if (m.snares) parts.push(`<h3>Rope snares · ${m.snares}</h3><p class="plan">Hide, then tap Snare to rig one just outside your cover.</p>`);
  if (view.clues?.length) parts.push(`<details class="clues"><summary>Notes you've found (${view.clues.length})</summary>${view.clues.map(c => `<p><b>${esc(c.label)}:</b> ${esc(c.text)}</p>`).join('')}</details>`);
  parts.push(map);
  return parts.join('');
}

function openSosSheet() {
  const contacts = view?.sos?.contacts ?? [];
  if (!contacts.length) return toast('Nobody else is inside.');
  openSheet(`<div class="sheet-head"><h2>Ask for help</h2><button class="sheet-x" data-act="back" aria-label="Back">‹</button></div>
    <p class="plan">Private: only the guest you choose can see it, with your current room (${esc(roomName(view.me.room))}).</p>
    <div class="row">${contacts.map(id => btn('sos-to', esc(seatName(id)), { data: { to: id } })).join('')}</div>
    <h3>Message</h3>
    <div class="row">${Object.entries(SOS_PRESETS).map(([k, v]) => btn('sos-send', esc(v), { data: { preset: k } })).join('')}</div>
    ${btn('close', 'Cancel')}`, 'sos');
}

function openGiveSheet() {
  openSheet(`<div class="sheet-head"><h2>Hand the camera to…</h2><button class="sheet-x" data-act="back" aria-label="Back">‹</button></div>
    <div class="row">${(view.options.passTo ?? []).map(id => btn('give', esc(seatName(id)), { data: { to: id } })).join('')}</div>${btn('close', 'Cancel')}`, 'give');
}

function openMapSheet(id) {
  const s = id ? view?.sos?.inbox?.find(x => x.id === id) : null;
  const myRoom = view?.me?.room;
  const text = s ? (!s.route?.length ? 'They are in your room.' : `Next room on the way: <b>${esc(roomName(s.route[0]))}</b> (${s.route.length} room${s.route.length > 1 ? 's' : ''} away).`)
    : 'Rooms connect only through their doorways. Only rooms next to yours can be chosen.';
  openSheet(`<div class="sheet-head"><h2>${s ? `${esc(s.senderName)} · ${esc(s.roomName)}${s.lastSeen ? ' (last seen)' : ''}` : 'The mansion'}</h2><button class="sheet-x" data-act="back" aria-label="Back">‹</button></div>
    <div class="map">${mapSvg({ myRoom, targetRoom: s?.room, route: s?.route ?? [], exitOpen: pub.exitOpen })}</div>
    <p class="plan">${text}</p>${btn('close', 'Close')}`, 'map');
}

// ------------------------------------------------------------------ results (with the full infection history)
function renderResults() {
  const box = $('screen-results');
  if (pub.phase !== 'ended' || !pub.results) { box.hidden = true; return; }
  const r = JSON.parse(pub.results);
  const mine = view?.ended ?? null;
  const names = ids => ids.length ? ids.map(id => esc(seatName(id))).join(', ') : 'nobody';
  const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  box.hidden = false;
  $('results').innerHTML = `<h2>Aftermath</h2>
    <p class="sub">${r.reason === 'lockdown' ? 'Midnight. The final shutters closed with guests still inside — they belong to the collection now.' : 'Every guest has escaped or turned before midnight.'} Elias Voss is already writing the next invitation.</p>
    <div class="results-big"><div><b>${r.escaped.length}</b>escaped</div><div><b>${r.teamScore}</b>team points</div><div><b>${mine?.score ?? 0}</b>your points</div></div>
    <div class="results-list"><p><b>Escaped:</b> ${names(r.escaped)}</p>${r.trapped.length ? `<p><b>Claimed at midnight:</b> ${names(r.trapped)}</p>` : ''}
    <p><b>Who turned, and when:</b></p><ol class="timeline">${r.infections.map(i => `<li>${mmss(i.atSec)} · ${esc(seatName(i.victim))} — bitten by ${esc(i.by === 'elias' ? 'Elias Voss' : seatName(i.by))} in the ${esc(roomName(i.room))}</li>`).join('')}</ol>
    <p><b>Verified rescues:</b> ${r.rescues}${mine?.rescues?.length ? ` (you saved ${names(mine.rescues)})` : ''}</p>
    <p><b>The camera ended:</b> ${r.cameraEndedIn === 'escaped' ? 'outside with a survivor' : `in the ${esc(r.cameraEndedIn)}`}</p></div>
    <p class="fine">Waiting for the host to start another match.</p>`;
}

if ($('join-code').value && !captureRoom) $('join-name').focus();
