// Phone client: join by QR code, pick a guest, then play. Every action is an intent;
// the server's private "view" (what your character can perceive) is the only truth.
import { CAST, GALLERY, OPENING_BEATS, ROOMS, SOS_PRESETS, TUNING } from '@game/data.ts';
import * as pc from 'playcanvas';
import { Connection, local } from './net.js';
import { Game3D } from './game3d.js';
import { GameAudio } from './audio.js';
import { castInfo } from './actors.js';
import { mapSvg } from './map.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const first = id => castInfo(id)?.name.split(' ')[0] ?? id;
const params = new URLSearchParams(location.search);

// Capture mode renders an empty room from a fixed viewpoint for the room picture cards.
const captureRoom = params.get('capture');

const conn = new Connection();
const audio = new GameAudio();
const game = new Game3D($('stage'), { now: () => conn.now() });
let pub = null, view = null, me = null;
let openingFired = new Set();
let sheetOpen = null;
let wakeLock = null;
let pending = null;       // { label, at } an intent sent but not yet reflected by the server
let lastIntentSeq = 0;
let lastInterrupted = null;
let expanded = null;      // room card expanded to show its hiding places
let pace = local?.getItem('hg.pace') === 'run' ? 'run' : 'walk';

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
  $('join-code').value = (params.get('code') || '').toUpperCase();
  $('join-name').value = local?.getItem('hg.name') || '';
  if (params.get('debug')) { $('debug').hidden = false; window.__hgGame = game; }
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
async function requestWakeLock() { try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* unsupported */ } }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && conn.room) requestWakeLock(); });

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
  render();
});
conn.addEventListener('fx', e => onFx(e.detail));
conn.addEventListener('error', e => { pending = null; toast(e.detail); render(); });
conn.addEventListener('reset', () => { view = null; openingFired = new Set(); closeSheet(); $('briefing').hidden = true; render(); });
conn.addEventListener('status', e => {
  const s = e.detail;
  $('conn').hidden = s === 'connected' || s === 'idle' || s === 'ended';
  $('conn').textContent = s === 'reconnecting' || s === 'joining' ? 'Reconnecting…' : 'Connection lost — retrying';
});
// The session can't be resumed (ended, wrong code, or taken over elsewhere): say so plainly.
conn.addEventListener('ended', e => {
  view = null; pub = null;
  $('hud').hidden = true; $('panel').hidden = true; $('screen-lobby').hidden = true; $('screen-results').hidden = true;
  $('screen-join').hidden = false;
  toast(e.detail);
  $('join-note').textContent = e.detail;
});

function send(type, payload, label) {
  if (label) { pending = { label, at: Date.now() }; render(); }
  conn.send(type, payload);
}
function intent(payload, label) { send('intent', { ...payload, pace }, label); }

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
      if (fx.victim === me) buzz([500, 100, 500]);
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
      break;
    case 'phase':
      if (fx.phase === 'hunt') { audio.alarm(); caption('LOCKDOWN. Choose where to go.', true); }
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
  clearTimeout(captionTimer); captionTimer = setTimeout(() => { c.style.opacity = 0; }, big ? 4000 : 2800);
}
let toastTimer = 0;
function toast(text) { const t = $('toast'); t.textContent = text; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600); }

// ------------------------------------------------------------------ per-frame: timer, opening beats, tags, sound cues
const tagEls = new Map();
function updateTags(tags) {
  const live = new Set();
  for (const t of tags) {
    live.add(t.id);
    let el = tagEls.get(t.id);
    if (!el) { el = document.createElement('div'); el.className = 'tag'; $('tags').appendChild(el); tagEls.set(t.id, el); }
    if (el.textContent !== t.name) el.textContent = t.name;
    el.style.transform = `translate(${t.x.toFixed(0)}px, ${t.y.toFixed(0)}px) translate(-50%, -100%)`;
    el.hidden = false;
  }
  for (const [id, el] of tagEls) if (!live.has(id)) el.hidden = true;
}

function updateSoundCues() {
  const box = $('sounds');
  const sounds = view?.sounds || [];
  if (!sounds.length) { box.innerHTML = ''; return; }
  const heading = game.heading();
  const words = { steps: 'footsteps', running: 'running', search: 'rummaging', struggle: 'a struggle' };
  box.innerHTML = sounds.map(s => {
    const rel = ((s.bearing - heading + 540) % 360) - 180; // -180..180, 0 = ahead
    const side = Math.abs(rel) < 35 ? 'ahead' : Math.abs(rel) > 145 ? 'behind' : rel > 0 ? 'right' : 'left';
    return `<div class="cue ${side} ${s.band}"><span class="arrow" style="transform:rotate(${rel.toFixed(0)}deg)">▲</span>${words[s.kind] ?? 'a sound'} · ${side}${s.band === 'near' ? ' · close' : ''}</div>`;
  }).join('');
}

game.onFrame = () => {
  if (!pub || captureRoom) return;
  const now = conn.now();
  if (pub.phase === 'opening' || pub.phase === 'hunt') {
    const left = pub.paused ? null : Math.max(0, Math.ceil((pub.phaseEndsAt - now) / 1000));
    $('hud-timer').textContent = pub.paused ? 'II' : pub.phase === 'hunt' ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : String(left);
    // Fictional mansion clock: 11:45 p.m. when the hunt starts, final lockdown at midnight.
    if (pub.phase === 'hunt' && left != null) {
      const minsLeft = Math.ceil(left / 60);
      $('hud-clock').textContent = left > 0 ? `Final lockdown · 11:${String(60 - minsLeft).padStart(2, '0')} p.m.` : 'Midnight';
      $('hud-timer').classList.toggle('urgent', left <= 60);
    } else $('hud-clock').textContent = '';
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
  const fb = document.querySelector('[data-act="flash"]');
  if (fb && view?.camera?.mine) {
    const wait = Math.max(0, Math.ceil(((view.camera.readyAt ?? 0) - now) / 1000));
    fb.disabled = wait > 0;
    fb.textContent = wait > 0 ? `📷 Recharging ${wait}s` : '📷 Take Photo';
  }
  updateTags(game.tags());
  updateSoundCues();
  const cp = game.camera.getPosition();
  audio.setListener(cp.x, cp.z, game.heading() + 180);
  if (!$('debug').hidden) {
    const s = game.stats; const mem = performance.memory ? ` heap ${(performance.memory.usedJSHeapSize / 1048576).toFixed(0)}MB` : '';
    $('debug').textContent = `fps ${s.fps.toFixed(0)} avg ${s.ms.toFixed(1)}ms worst ${(s.worstMs ?? 0).toFixed(0)}ms${mem}\ndpr ${devicePixelRatio} x${game.app.graphicsDevice.maxPixelRatio} ${game.app.graphicsDevice.width}x${game.app.graphicsDevice.height} ${game.mode}`;
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
  if (captureRoom || !pub) return;
  const joined = $('screen-join').hidden;
  const inLobby = pub.phase === 'lobby';
  $('screen-lobby').hidden = !(inLobby && joined);
  $('hud').hidden = inLobby || !joined;
  if (inLobby) { if (joined) renderLobby(); $('panel').hidden = true; $('inbox').innerHTML = ''; $('screen-results').hidden = true; return; }
  renderHud();
  renderPanel();
  renderInbox();
  renderResults();
  const caught = view?.me?.caught;
  $('vignette').className = caught ? 'v-danger' : view?.me?.hideState === 'hidden' ? 'v-hidden' : '';
  $('threat').hidden = !caught;
  if (caught) $('threat').textContent = 'CAUGHT!';
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

function renderHud() {
  const m = view?.me;
  $('hud-room').textContent = view?.status === 'escaped' ? 'Outside the mansion' : m ? zoneLabel(m) : '—';
  $('hud-status').textContent = `${me ? castInfo(me).name + ' · ' : ''}${statusLine()}${view?.camera?.mine ? ' · 📷' : ''}${m?.snares ? ` · rope ×${m.snares}` : ''}`;
  $('hud-phase').textContent = pub.paused ? 'Paused by host' : { opening: 'The Unveiling', hunt: view?.role === 'hunter' ? 'You are infected' : 'Survive', ended: 'Aftermath' }[pub.phase] ?? pub.phase;
  if (pub.phase === 'ended') $('hud-timer').textContent = '';
  $('hud-team').textContent = `${pub.escapedCount} escaped · ${pub.insideCount} still inside · team ${pub.teamScore} pts · Garden Gate ${pub.exitOpen ? 'open' : 'locked'}`;
  // Captions sit just below the HUD, which grows when a long room name wraps on a phone.
  const hb = $('hud').getBoundingClientRect().bottom;
  if (hb > 0) $('caption').style.top = `${Math.round(hb + 4)}px`;
}

function btn(act, label, { active = false, disabled = false, cls = '', data = {} } = {}) {
  const d = Object.entries(data).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('');
  return `<button class="btn ${cls} ${active ? 'active' : ''}" data-act="${act}"${d} ${disabled ? 'disabled' : ''}>${label}</button>`;
}

function roomCard(r, { current = false, selected = false, blocked = false } = {}) {
  return `<button class="room-card ${current ? 'current' : ''} ${selected ? 'selected' : ''}" data-act="room-card" data-room="${r}">
    <img src="/rooms/${r}.jpg" alt="" loading="lazy" onerror="this.style.visibility='hidden'" />
    <span class="rc-name">${esc(roomName(r))}</span>${current ? '<span class="rc-tag">You are here</span>' : ''}${blocked ? '' : ''}</button>`;
}

function intentBadge() {
  const i = view?.me?.intent;
  if (pending && Date.now() - pending.at < 2500) return `<div class="intent pending">Sending: ${esc(pending.label)}…</div>`;
  if (!i || i.kind === 'idle') return '';
  if (i.state === 'interrupted') return `<div class="intent interrupted">Stopped: ${esc(i.reason || 'interrupted')}</div>`;
  if (i.state === 'accepted') return `<div class="intent accepted">On the way</div>`;
  return '';
}

function paceToggle() {
  return `<div class="pace">${btn('pace', 'Walk', { active: pace === 'walk', data: { pace: 'walk' } })}${btn('pace', 'Run', { active: pace === 'run', data: { pace: 'run' } })}</div>`;
}

// Views arrive ~10x a second: only touch the DOM when content actually changes, so a
// finger that is mid-tap (or holding Peek) never has its button replaced under it.
function setHtml(el, html) {
  if (el.__html === html) return;
  el.innerHTML = html; el.__html = html;
}

function renderPanel() {
  const p = $('panel');
  if (!view || !view.me || pub.phase === 'opening' || pub.phase === 'ended' || view.status === 'escaped') {
    p.hidden = !(view?.status === 'escaped' && pub.phase !== 'ended');
    if (!p.hidden) setHtml(p, `<h3>You escaped</h3><p class="plan">You're out alive with <b>${view.score}</b> points. Others may still get out.</p>`);
    return;
  }
  p.hidden = false;
  p.classList.remove('slim');
  if (pub.paused) { setHtml(p, '<h3>Paused</h3><p class="plan">The host paused the game.</p>'); return; }
  const m = view.me;
  const html = [intentBadge()];

  if (view.role === 'survivor') {
    const cam = view.camera || {};
    const photo = cam.mine ? btn('flash', '📷 Take Photo', { cls: 'flash-btn' }) : '';
    if (m.caught) {
      html.push(`<h3>Caught by ${esc(first(m.caughtBy))}</h3><p class="plan">You can't pull free alone.</p>${photo}`);
      setHtml(p, html.join('')); return;
    }
    if (m.hideState === 'hidden' || m.hideState === 'entering') {
      const clue = view.options.inspect?.[0];
      html.push(`<h3>${m.hideState === 'hidden' ? 'Hidden — stay alert' : 'Getting into cover…'}</h3>
        <p class="plan">Drag to look around. Hold <b>Peek</b> to lean out (people nearby can see you while you peek).</p>
        <div class="row">
          <button class="btn peek ${game.peeking ? 'active' : ''}" data-hold="peek" ${m.hideState !== 'hidden' ? 'disabled' : ''}>👁 Hold to Peek</button>
          ${clue ? btn('inspect', `🔎 Inspect ${esc(clue.label)}`, { data: { clue: clue.id } }) : ''}
          ${m.snares ? btn('snare', '🪢 Rig snare outside') : ''}
        </div>
        ${photo ? `<div class="row">${photo}</div>` : ''}
        <div class="row">${btn('leave', 'Leave hiding…')}${sosButton()}</div>`);
      if (expanded === '__leave') html.push(roomChooser(true));
      setHtml(p, html.join('')); return;
    }
    // View Gallery: standing at the wall. The clock runs and the character stays in the open.
    if (m.viewing && !m.moving) {
      const st = GALLERY.find(g => g.id === m.viewing);
      const i = Math.max(0, Math.min(st.portraits.length - 1, game.galleryIndex ?? 1));
      const work = st.portraits[i];
      html.push(`<h3>View Gallery · ${esc(st.label)}</h3>
        <div class="gallery-work"><b>${esc(work.title)}</b><p>“${esc(work.plaque)}”</p></div>
        <div class="row">${btn('gal-step', '‹ Previous', { disabled: i === 0, data: { step: -1 } })}${btn('gal-step', 'Next ›', { disabled: i === st.portraits.length - 1, data: { step: 1 } })}</div>
        <p class="plan">The clock keeps running, and anyone passing can see you here.</p>
        <div class="row">${btn('gal-back', 'Back to Game', { cls: 'primary' })}${sosButton()}</div>`);
      setHtml(p, html.join('')); return;
    }
    // While travelling, keep the panel slim so the journey stays visible.
    if (m.moving && expanded !== '__change') {
      html.push(`<div class="row">${btn('change', 'Change destination')}${btn('stop', 'Stop here')}${photo}</div><div class="row">${paceToggle()}</div>`);
      setHtml(p, html.join('')); p.classList.add('slim'); return;
    }
    html.push(`<h3>Where to? · ${esc(zoneLabel(m))}</h3>`);
    html.push(roomChooser(false));
    const extra = [];
    if (photo) extra.push(photo);
    if (cam.floor) extra.push(btn('pickup', '📷 Go get the camera'));
    // Always shown while holding the camera (disabled when nobody is in reach), so the buttons
    // don't jump around as other guests walk past.
    if (cam.mine) extra.push(btn('give-open', '📷 Hand over the camera', { disabled: !view.options.passTo?.length }));
    if (cam.mine) extra.push(btn('drop', 'Drop camera'));
    if (m.snares) extra.push(btn('snare', '🪢 Rig snare here'));
    for (const g of view.options.gallery ?? []) extra.push(btn('gallery', `🖼 View Gallery: ${esc(g.label)}`, { data: { station: g.id } }));
    const clue = view.options.inspect?.[0];
    if (clue) extra.push(btn('inspect', `🔎 Inspect ${esc(clue.label)}`, { data: { clue: clue.id } }));
    extra.push(sosButton());
    html.push(`<div class="row">${extra.join('')}</div>`);
    const out = view.sos?.outbox?.[0];
    if (out) html.push(`<p class="plan">SOS to <b>${esc(out.recipientName)}</b>: “${esc(out.text)}” · ${out.reply === 'coming' ? '<b style="color:var(--ok)">Coming!</b>' : out.reply === 'cant' ? "Can't risk it" : 'no reply yet'}${out.stale ? ` · ${btn('sos-update', 'Update my location', { data: { id: out.id } })}` : ''}</p>`);
    if (view.clues?.length) html.push(`<details class="clues"><summary>Notes you've found (${view.clues.length})</summary>${view.clues.map(c => `<p><b>${esc(c.label)}:</b> ${esc(c.text)}</p>`).join('')}</details>`);
    setHtml(p, html.join('')); return;
  }

  // Hunter controls: move, search, block, chase, wait.
  const h = view.huntOptions;
  if (m.grabbing) { html.push(`<h3>You have ${esc(first(m.grabbing))}</h3><p class="plan">Hold on…</p>`); setHtml(p, html.join('')); return; }
  if (m.stunned) { html.push(`<h3>${m.stunned === 'frozen' ? 'Frozen by the flash' : 'Tangled in rope'}</h3><p class="plan">You'll recover in a moment.</p>`); setHtml(p, html.join('')); return; }
  html.push(`<h3>Hunt · ${esc(zoneLabel(m))}</h3>`);
  if (h.chase.length) html.push(`<div class="row">${h.chase.map(id => btn('chase', `Go after ${esc(first(id))}`, { cls: 'danger', data: { target: id } })).join('')}</div>`);
  if (h.searchSpots.length) html.push(`<div class="row">${h.searchSpots.map(s => btn('search', `Search: ${esc(s.label)}`, { active: m.searching === s.id, data: { spot: s.id } })).join('')}</div>`);
  if (h.doors.length) html.push(`<details class="doors"><summary>Block a doorway</summary><div class="row">${h.doors.map(d => btn('block', esc(d.label), { active: m.blocking === d.key, data: { door: d.key } })).join('')}</div></details>`);
  html.push(`<div class="cards">${h.rooms.map(r => roomCard(r)).join('')}</div>`);
  html.push(`<div class="row">${paceToggle()}${btn('wait', 'Wait here')}</div>`);
  setHtml(p, html.join(''));
}

/** Room picture cards for reachable rooms; tapping one opens its hiding places. */
function roomChooser(fromCover) {
  const m = view.me, o = view.options;
  const cur = o.currentRoom;
  const rooms = [...(cur ? [cur] : []), ...o.rooms];
  const sel = expanded && !expanded.startsWith('__') ? expanded : null;
  const parts = [`<div class="cards">${rooms.map(r => roomCard(r, { current: r === cur, selected: r === sel })).join('')}</div>`];
  const chosen = sel ?? (fromCover ? cur : null);
  if (chosen) {
    const hides = o.hides.filter(h => h.room === chosen && h.id !== m.hide);
    parts.push(`<div class="row">${chosen !== cur ? btn('go', `Go to the ${esc(roomName(chosen))}`, { cls: 'primary', data: { room: chosen } }) : fromCover ? btn('go', 'Step out here', { data: { room: chosen } }) : ''}
      ${hides.map(h => btn('hide', `${h.pose === 'under' ? '⬇' : '▮'} Hide: ${esc(h.label)}`, { data: { spot: h.id } })).join('')}</div>`);
  }
  if (o.exit) parts.push(`<div class="row">${btn('exit', pub.exitOpen ? '🚪 Run for the Garden Gate' : '🚪 Garden Gate (locked)', { cls: pub.exitOpen ? 'primary' : '' })}</div>`);
  parts.push(`<div class="row">${paceToggle()}${btn('map-open', '🗺 Map')}</div>`);
  return parts.join('');
}

function sosButton() { return view.sos ? btn('sos-open', '🆘 Ask for help', { disabled: !view.sos.canSend }) : ''; }

$('panel').addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const d = b.dataset;
  switch (d.act) {
    case 'room-card':
      if (view.role === 'hunter') { intent({ kind: 'room', room: d.room }, `to the ${roomName(d.room)}`); break; }
      expanded = expanded === d.room ? (view.me.moving ? '__change' : null) : d.room; render(); break;
    case 'go': expanded = null; intent({ kind: 'room', room: d.room }, `to the ${roomName(d.room)}`); break;
    case 'hide': expanded = null; intent({ kind: 'hide', spot: d.spot }, 'to cover'); break;
    case 'exit': intent({ kind: 'exit' }, 'to the exit'); break;
    case 'gallery': game.galleryIndex = 1; intent({ kind: 'gallery', station: d.station }, 'to the portrait wall'); break;
    case 'gal-step': game.galleryIndex = (game.galleryIndex ?? 1) + Number(d.step); render(); break;
    case 'gal-back': intent({ kind: 'idle' }, 'back to the game'); break;
    case 'pickup': intent({ kind: 'pickup' }, 'to the camera'); break;
    case 'stop': expanded = null; intent({ kind: 'idle' }, 'stop'); break;
    case 'change': expanded = '__change'; render(); break;
    case 'leave': expanded = expanded === '__leave' ? null : '__leave'; render(); break;
    case 'pace': pace = d.pace; local?.setItem('hg.pace', pace); send('pace', { pace }); render(); break;
    case 'flash': send('flash'); break;
    case 'drop': send('drop'); break;
    case 'snare': send('snare'); break;
    case 'inspect': send('inspect', { clue: d.clue }); break;
    case 'give-open': openGiveSheet(); break;
    case 'sos-open': openSosSheet(); break;
    case 'sos-update': send('sos:update', { id: d.id }); break;
    case 'map-open': openMapSheet(); break;
    case 'chase': intent({ kind: 'chase', target: d.target }, `after ${first(d.target)}`); break;
    case 'search': intent({ kind: 'search', spot: d.spot }, 'search'); break;
    case 'block': intent({ kind: 'block', door: d.door }, 'block the doorway'); break;
    case 'wait': intent({ kind: 'idle' }, 'wait'); break;
  }
});
// Peek is press-and-hold.
const peekOn = e => { const b = e.target.closest('[data-hold="peek"]'); if (!b || b.disabled) return; e.preventDefault(); game.setPeek(true); send('peek', { on: true }); b.classList.add('active'); };
const peekOff = () => { if (!game.peeking) return; game.setPeek(false); send('peek', { on: false }); document.querySelector('[data-hold="peek"]')?.classList.remove('active'); };
$('panel').addEventListener('pointerdown', peekOn);
window.addEventListener('pointerup', peekOff);
window.addEventListener('pointercancel', peekOff);
$('panel').addEventListener('contextmenu', e => e.preventDefault());

function renderInbox() {
  const box = $('inbox');
  const inbox = view?.status === 'alive' ? view.sos?.inbox ?? [] : [];
  const now = conn.now();
  setHtml(box, inbox.map(s => {
    const ago = Math.max(0, Math.round((now - s.updatedAt) / 1000));
    return `<div class="sos"><div class="who">${esc(s.senderName)} needs help</div>
      <div class="where">“${esc(s.text)}” · ${esc(s.roomName)}${s.lastSeen ? ' (last seen)' : ''} · ${ago < 10 ? 'just now' : `${ago}s ago`}</div>
      <div class="row">${btn('sos-reply', s.reply === 'coming' ? '✓ Coming' : "I'm coming", { active: s.reply === 'coming', data: { id: s.id, reply: 'coming' } })}
      ${btn('sos-reply', "I can't risk it", { active: s.reply === 'cant', data: { id: s.id, reply: 'cant' } })}
      ${btn('sos-map', 'Open map', { data: { id: s.id } })}</div></div>`;
  }).join(''));
}
$('inbox').addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  if (b.dataset.act === 'sos-reply') send('sos:reply', { id: b.dataset.id, reply: b.dataset.reply });
  if (b.dataset.act === 'sos-map') openMapSheet(b.dataset.id);
});

// ------------------------------------------------------------------ sheets
function openSheet(html, kind) { sheetOpen = kind; $('sheet-body').innerHTML = html; $('sheet').hidden = false; }
function closeSheet() { sheetOpen = null; $('sheet').hidden = true; }
$('sheet').addEventListener('click', e => {
  if (e.target === $('sheet')) return closeSheet();
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const d = b.dataset;
  if (d.act === 'close') closeSheet();
  if (d.act === 'sos-to') { $('sheet-body').dataset.to = d.to; for (const x of $('sheet-body').querySelectorAll('[data-act="sos-to"]')) x.classList.toggle('active', x === b); }
  if (d.act === 'sos-send') {
    const to = $('sheet-body').dataset.to;
    if (!to) return toast('Choose who to ask first.');
    send('sos:send', { to, preset: d.preset });
    closeSheet();
  }
  if (d.act === 'give') { send('give', { to: d.to }); closeSheet(); }
});

function openSosSheet() {
  const contacts = view?.sos?.contacts ?? [];
  if (!contacts.length) return toast('Nobody else is inside.');
  openSheet(`<h3>Ask for help</h3><p class="plan">Private: only the guest you choose can see it, with your current room (${esc(roomName(view.me.room))}).</p>
    <div class="row">${contacts.map(id => btn('sos-to', esc(seatName(id)), { data: { to: id } })).join('')}</div>
    <h3 style="margin-top:14px">Message</h3>
    <div class="row">${Object.entries(SOS_PRESETS).map(([k, v]) => btn('sos-send', esc(v), { data: { preset: k } })).join('')}</div>
    ${btn('close', 'Cancel')}`, 'sos');
}

function openGiveSheet() {
  openSheet(`<h3>Hand the camera to…</h3><div class="row">${view.options.passTo.map(id => btn('give', esc(seatName(id)), { data: { to: id } })).join('')}</div>${btn('close', 'Cancel')}`, 'give');
}

function openMapSheet(id) {
  const s = id ? view?.sos?.inbox?.find(x => x.id === id) : null;
  const myRoom = view?.me?.room;
  const text = s ? (!s.route?.length ? 'They are in your room.' : `Next room on the way: <b>${esc(roomName(s.route[0]))}</b> (${s.route.length} room${s.route.length > 1 ? 's' : ''} away).`)
    : 'Rooms connect only through their doorways. Only rooms next to yours can be chosen.';
  openSheet(`<h3>${s ? `${esc(s.senderName)} · ${esc(s.roomName)}${s.lastSeen ? ' (last seen)' : ''}` : 'The mansion'}</h3>
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
