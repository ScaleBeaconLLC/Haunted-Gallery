// Phone client: join by QR code, pick a guest, then play the 3D hunt. All decisions
// are sent as intents; the server's private "view" is the only source of truth.
import { CAST, OPENING_BEATS, ROOMS, SOS_PRESETS, TUNING } from '@game/data.ts';
import { Connection, local } from './net.js';
import { Game3D } from './game3d.js';
import { GameAudio } from './audio.js';
import { castInfo } from './actors.js';
import { mapSvg } from './map.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const first = id => castInfo(id)?.name.split(' ')[0] ?? id;

const conn = new Connection();
const audio = new GameAudio();
const game = new Game3D($('stage'), { now: () => conn.now() });
let pub = null;   // public schema state
let view = null;  // private view
let me = null;
let openingFired = new Set();
let lastPhaseKey = '';
let sheetOpen = null;
let wakeLock = null;

const params = new URLSearchParams(location.search);
$('join-code').value = (params.get('code') || '').toUpperCase();
$('join-name').value = local?.getItem('hg.name') || '';
if (params.get('debug')) $('debug').hidden = false;

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
// iOS needs a gesture to start audio; any tap will do after a reconnect/reload.
document.addEventListener('pointerdown', () => audio.unlock(), { passive: true });

async function requestWakeLock() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* not supported or not HTTPS */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && conn.room) requestWakeLock(); });

// ------------------------------------------------------------------ network events
conn.addEventListener('state', e => { pub = e.detail; render(); });
conn.addEventListener('hello', e => { me = e.detail.character; game.setMe(me); render(); });
conn.addEventListener('view', e => {
  const prevHide = view?.hide ?? null;
  view = e.detail;
  // Settling into cover: the character's quiet line, on this phone only and softly.
  if (view?.hide && view.hide !== prevHide && view.status === 'alive') {
    const spot = ROOMS[view.room]?.hides.find(h => h.id === view.hide)?.pos;
    if (spot) setTimeout(() => audio.voice(view.id, 'quiet', spot), 400);
  }
  const mine = view?.id ?? view?.character ?? null;
  if (mine !== me) { me = mine; game.setMe(me); }
  game.applyView(view, pub);
  render();
});
conn.addEventListener('fx', e => onFx(e.detail));
conn.addEventListener('error', e => toast(e.detail));
conn.addEventListener('reset', () => { view = null; openingFired = new Set(); closeSheet(); render(); });
conn.addEventListener('status', e => {
  const s = e.detail;
  $('conn').hidden = s === 'connected' || s === 'idle';
  $('conn').textContent = s === 'reconnecting' || s === 'joining' ? 'Reconnecting…' : 'Connection lost — retrying';
});

// ------------------------------------------------------------------ effects
function actorPos(id) { return game.actors.get(id)?.pos ?? [0, 0]; }

function onFx(fx) {
  switch (fx.type) {
    case 'discovered':
      audio.zombieCue(actorPos(fx.hunter));
      audio.voice(fx.victim, 'discovery', actorPos(fx.victim));
      caption(fx.victim === me ? `${first(fx.hunter)} found you!` : `${first(fx.hunter)} found ${first(fx.victim)}!`, true);
      if (fx.victim === me) buzz([120, 60, 120]);
      game.actors.get(fx.hunter)?.moveTo(nearby(actorPos(fx.victim)));
      break;
    case 'grabbed':
      audio.voice(fx.victim, 'grabbed', actorPos(fx.victim));
      game.actors.get(fx.hunter)?.moveTo(nearby(actorPos(fx.victim), 0.7));
      if (fx.victim === me) buzz([300]);
      caption(fx.victim === me ? 'GRABBED! Break free — someone use the camera!' : `${first(fx.victim)} is grabbed!`, true);
      break;
    case 'bite':
      audio.voice(fx.victim, 'bite', actorPos(fx.victim));
      audio.biteFoley(actorPos(fx.victim));
      if (!fx.opening) caption(fx.victim === me ? 'You were bitten. You hunt for Elias now.' : `${first(fx.victim)} was bitten.`, true);
      if (fx.victim === me) buzz([500, 100, 500]);
      break;
    case 'turned':
      if (fx.id !== me) caption(`${first(fx.id)} has turned.`);
      break;
    case 'flash':
      flashScreen();
      game.flashAt(actorPos(fx.by));
      audio.flash(actorPos(fx.by));
      caption(fx.by === me ? `Flash! ${fx.frozen.length} frozen for 5 seconds — move!` : `${first(fx.by)}'s flash freezes the hunters!`, true);
      break;
    case 'escape':
      caption(fx.id === me ? 'You escaped alive! +100' : `${first(fx.id)} escaped the mansion.`, true);
      break;
    case 'rescue_paid':
      if (fx.helper === me) caption(`${first(fx.victim)} escaped — your rescue counts! +150`, true);
      break;
    case 'camera_pickup':
      caption(fx.by === me ? 'You picked up the antique camera.' : `${first(fx.by)} picked up the camera.`);
      break;
    case 'camera_pass':
      caption(fx.recipient === me ? `${first(fx.from)} handed you the camera.` : `${first(fx.from)} passed the camera to ${first(fx.recipient)}.`);
      break;
    case 'camera_drop':
      if (!fx.opening) caption('The camera hits the floor.');
      break;
    case 'sos':
      audio.ping(); buzz([80, 40, 80]);
      break;
    case 'sos_reply':
      audio.ping();
      break;
    case 'exit_open':
      caption('The rear service exit has unlocked — reach the Sealed Exhibition Room!', true);
      break;
    case 'phase':
      if (fx.phase === 'choice' && fx.round === 1) { audio.alarm(); caption('LOCKDOWN. Get out of the gallery!', true); }
      break;
  }
}

function nearby([x, z], d = 1.2) { const a = Math.random() * Math.PI * 2; return [x + Math.cos(a) * d, z + Math.sin(a) * d]; }
function buzz(p) { try { navigator.vibrate?.(p); } catch { /* unsupported */ } }
function flashScreen() {
  const f = $('flash'); f.classList.add('on');
  requestAnimationFrame(() => requestAnimationFrame(() => f.classList.remove('on')));
}
let captionTimer = 0;
function caption(text, big = false) {
  const c = $('caption');
  c.textContent = text; c.className = big ? 'big' : ''; c.style.opacity = 1;
  clearTimeout(captionTimer);
  captionTimer = setTimeout(() => { c.style.opacity = 0; }, big ? 4200 : 3000);
}
let toastTimer = 0;
function toast(text) {
  const t = $('toast'); t.textContent = text; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

// ------------------------------------------------------------------ per-frame UI (timer, tags, opening beats)
game.onFrame = () => {
  if (!pub) return;
  const now = conn.now();
  if (pub.phase !== 'lobby' && pub.phase !== 'ended') {
    const left = pub.paused ? null : Math.max(0, Math.ceil((pub.phaseEndsAt - now) / 1000));
    $('hud-timer').textContent = pub.paused ? 'II' : String(left);
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
  // Flash button countdown.
  const fb = document.querySelector('[data-act="flash"]');
  if (fb && view?.camera?.mine) {
    const wait = Math.max(0, Math.ceil(((view.camera.readyAt ?? 0) - now) / 1000));
    fb.disabled = wait > 0;
    fb.textContent = wait > 0 ? `Recharging ${wait}s` : 'FLASH';
  }
  // Name tags.
  updateTags(game.tags());
  // Listener follows the orbit camera.
  const cp = game.camera.getPosition();
  audio.setListener(cp.x, cp.z, game.orbit.yaw + 180);
  if (!$('debug').hidden) {
    const s = game.stats; const mem = performance.memory ? ` heap ${(performance.memory.usedJSHeapSize / 1048576).toFixed(0)}MB` : '';
    $('debug').textContent = `fps ${s.fps.toFixed(0)} avg ${s.ms.toFixed(1)}ms worst ${(s.worstMs ?? 0).toFixed(0)}ms${mem}\ndpr ${devicePixelRatio} x${game.app.graphicsDevice.maxPixelRatio} ${game.app.graphicsDevice.width}x${game.app.graphicsDevice.height}`;
  }
};

// Name tags reuse one element per actor and only move it (no per-frame DOM rebuild).
const tagEls = new Map();
function updateTags(tags) {
  const live = new Set();
  for (const t of tags) {
    live.add(t.id);
    let el = tagEls.get(t.id);
    if (!el) { el = document.createElement('div'); $('tags').appendChild(el); tagEls.set(t.id, el); }
    const cls = `tag ${t.me ? 'me' : ''} ${t.id === 'elias' ? 'elias' : t.status === 'infected' ? 'infected' : ''} ${t.stunned ? 'stunned' : ''}`;
    if (el.className !== cls) el.className = cls;
    const label = t.me ? 'You' : t.name;
    if (el.textContent !== label) el.textContent = label;
    el.style.transform = `translate(${t.x.toFixed(0)}px, ${t.y.toFixed(0)}px) translate(-50%, -100%)`;
    el.hidden = false;
  }
  for (const [id, el] of tagEls) if (!live.has(id)) el.hidden = true;
}

// ------------------------------------------------------------------ rendering
function seatName(id) {
  const seat = pub?.seats?.get?.(id);
  return seat?.displayName && !seat.isCpu ? `${first(id)} (${seat.displayName})` : castInfo(id)?.name ?? id;
}

function render() {
  if (!pub) return;
  const joined = $('screen-join').hidden;
  const inLobby = pub.phase === 'lobby';
  $('screen-lobby').hidden = !(inLobby && joined);
  $('hud').hidden = inLobby || !joined;
  if (inLobby) { if (joined) renderLobby(); $('panel').hidden = true; $('inbox').innerHTML = ''; $('screen-results').hidden = true; return; }
  const phaseKey = `${pub.phase}:${pub.round}`;
  // Passing the camera is a choice-window action; SOS and the map stay open across phases.
  if (phaseKey !== lastPhaseKey) { lastPhaseKey = phaseKey; if (pub.phase !== 'choice' && sheetOpen === 'give') closeSheet(); }
  renderHud();
  renderPanel();
  renderInbox();
  renderResults();
  $('vignette').className = view?.threat ? 'danger' : '';
  $('threat').hidden = !view?.threat;
  if (view?.threat) $('threat').textContent = view.threat.grabbed ? 'GRABBED!' : 'FOUND!';
}

function renderLobby() {
  const seats = pub.seats;
  $('cast-grid').innerHTML = CAST.map(c => {
    const seat = seats.get(c.id);
    const mine = me === c.id;
    const taken = seat?.taken && !mine;
    return `<button class="cast ${mine ? 'mine' : ''} ${taken ? 'taken' : ''}" data-claim="${c.id}" ${taken ? 'disabled' : ''}>
      <div class="n"><span class="dot" style="background:${c.color}"></span>${esc(c.name)}</div>
      <div class="t">${mine ? 'You' : taken ? esc(seat.displayName) : 'Available'}</div></button>`;
  }).join('');
  $('lobby-sub').textContent = me ? `You are ${castInfo(me).name}. Tap another guest to switch.` : 'Tap a guest. Each can be chosen once.';
  $('lobby-wait').textContent = `${pub.humanCount} of 12 joined · waiting for the host to start. ${pub.cpuFill ? 'Empty seats will be played by the computer.' : ''}`;
}
$('cast-grid').addEventListener('click', e => {
  const b = e.target.closest('[data-claim]');
  if (!b) return;
  conn.send('claim', { character: b.dataset.claim, name: local?.getItem('hg.name') || $('join-name').value });
  // A guest's voice preview doubles as the audio unlock check.
  audio.voice(b.dataset.claim, 'quiet', [0, 0], { gain: 0.6 });
});

function renderHud() {
  const room = view?.room ? ROOMS[view.room].name : view?.status === 'escaped' ? 'Outside — alive' : '—';
  $('hud-room').textContent = room;
  const role = !view ? '' : view.status === 'escaped' ? 'Escaped' : view.isHunter ? 'Infected — hunting' : view.hide ? `Survivor · hidden (${ROOMS[view.room].hides.find(h => h.id === view.hide)?.label})` : 'Survivor';
  $('hud-status').textContent = `${me ? castInfo(me).name + ' · ' : ''}${role}${view?.camera?.mine ? ' · 📷 camera' : ''}`;
  const label = { opening: 'The Unveiling', choice: `Round ${pub.round} · decide`, travel: 'Moving', encounter: 'The hunt', ended: 'Aftermath' }[pub.phase] ?? pub.phase;
  $('hud-phase').textContent = pub.paused ? 'Paused by host' : label;
  if (pub.phase === 'ended') $('hud-timer').textContent = '';
  $('hud-team').textContent = `Team ${pub.teamScore} pts · ${pub.escapedCount} escaped · ${pub.aliveCount} still inside · ${pub.infectedCount} turned · exit ${pub.exitOpen ? 'OPEN' : 'locked'}`;
}

function btn(act, label, { active = false, disabled = false, cls = '', data = {} } = {}) {
  const d = Object.entries(data).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('');
  return `<button class="btn ${cls} ${active ? 'active' : ''}" data-act="${act}"${d} ${disabled ? 'disabled' : ''}>${label}</button>`;
}

function planText(c) {
  if (!c) return 'No plan yet — you will stay where you are.';
  if (c.action === 'move') return `Move to <b>${esc(ROOMS[c.to].name)}</b>`;
  if (c.action === 'hide') return `Hide in the <b>${esc(ROOMS[view.room].hides.find(h => h.id === c.spot)?.label)}</b>`;
  if (c.action === 'exit') return '<b>Escape</b> through the service exit';
  return '<b>Stay</b> in this room';
}

function renderPanel() {
  const p = $('panel');
  if (!view || pub.phase === 'opening' || pub.phase === 'ended' || !view.status) { p.hidden = true; return; }
  p.hidden = false;
  const html = [];
  if (pub.paused) { p.innerHTML = '<h3>Paused</h3><p class="plan">The host paused the game.</p>'; return; }

  if (view.status === 'escaped') {
    p.innerHTML = `<h3>You escaped</h3><p class="plan">You're out alive with <b>${view.score}</b> points. Watch the team score — others may still get out.</p>`;
    return;
  }

  if (view.status === 'alive') {
    if (pub.phase === 'choice') {
      const c = view.choice;
      html.push(`<div class="group"><h3>Your move · ${esc(ROOMS[view.room].name)}</h3><div class="plan">${planText(c)}</div><div class="row">`);
      html.push(btn('stay', 'Stay', { active: c?.action === 'stay' }));
      for (const h of view.options.hides) html.push(btn('hide', `Hide: ${esc(h.label)}`, { active: c?.action === 'hide' && c.spot === h.id, data: { spot: h.id } }));
      html.push('</div><div class="row" style="margin-top:8px">');
      for (const r of view.options.moves) html.push(btn('move', `→ ${esc(ROOMS[r].name)}`, { active: c?.action === 'move' && c.to === r, data: { to: r } }));
      html.push('</div>');
      if (view.options.canExit) html.push(`<div class="row" style="margin-top:8px">${btn('exit', 'ESCAPE through the service exit', { active: c?.action === 'exit', cls: 'primary' })}</div>`);
      else if (pub.exitOpen) html.push('<p class="plan">The service exit is open in the Sealed Exhibition Room.</p>');
      html.push('</div>');
    } else if (pub.phase === 'travel') {
      html.push(`<h3>Moving</h3><p class="plan">${planText(view.choice)}</p>`);
    } else if (pub.phase === 'encounter') {
      html.push(`<h3>The hunt</h3><p class="plan">${view.threat ? (view.threat.grabbed ? `<b>${esc(first(view.threat.hunter))} has you.</b>` : `<b>${esc(first(view.threat.hunter))} has seen you.</b>`) : view.hide ? 'Hold still. Stay hidden.' : 'Listen…'}</p>`);
    }
    // Camera controls.
    const cam = view.camera || {};
    if (cam.mine && pub.phase === 'encounter') html.push(`<div class="group">${btn('flash', 'FLASH', { cls: 'flash-btn' })}</div>`);
    const camRow = [];
    if (cam.onFloorHere && (pub.phase === 'choice' || pub.phase === 'encounter')) camRow.push(btn('pickup', '📷 Pick up the camera'));
    if (cam.mine && pub.phase === 'choice') {
      const here = (view.actors || []).filter(a => a.id !== me && a.status === 'alive' && a.id !== 'elias' && !a.birthday);
      if (here.length) camRow.push(btn('give-open', '📷 Pass the camera'));
      camRow.push(btn('drop', 'Drop the camera'));
    }
    if (camRow.length) html.push(`<div class="group"><div class="row">${camRow.join('')}</div></div>`);
    // SOS.
    const sos = view.sos;
    if (sos && pub.phase !== 'opening') {
      const out = sos.outbox?.[0];
      if (out) html.push(`<p class="plan">SOS to <b>${esc(out.recipientName)}</b>: “${esc(out.text)}” · ${out.reply === 'coming' ? '<b style="color:var(--ok)">Coming!</b>' : out.reply === 'cant' ? "Can't risk it" : 'no reply yet'}${out.stale ? ` · shows ${esc(out.roomName)} (last seen)` : ''}</p>`);
      const r = [btn('sos-open', '🆘 Ask for help', { disabled: !sos.canSend })];
      if (out?.stale) r.push(btn('sos-update', 'Update my location', { data: { id: out.id } }));
      html.push(`<div class="row">${r.join('')}</div>`);
    }
  } else if (view.isHunter) {
    if (pub.phase === 'choice' && view.huntOptions) {
      const h = view.hunt;
      html.push(`<h3>Hunt · ${esc(ROOMS[view.room].name)}</h3><p class="plan">${h ? `Hunt <b>${esc(ROOMS[h.to].name)}</b>${h.search ? `, search the <b>${esc(ROOMS[h.to].hides.find(x => x.id === h.search)?.label)}</b>` : ''}` : 'Pick a room to hunt and a hiding place to search.'}</p>`);
      for (const r of view.huntOptions.rooms) {
        html.push(`<div class="group"><div class="plan">${esc(ROOMS[r.id].name)}${r.id === view.room ? ' (here)' : ''}</div><div class="row">`);
        html.push(btn('hunt', 'Walk in', { active: h?.to === r.id && !h.search, data: { to: r.id } }));
        for (const s of ROOMS[r.id].hides) html.push(btn('hunt', `Search ${esc(s.label)}`, { active: h?.to === r.id && h.search === s.id, data: { to: r.id, search: s.id } }));
        html.push('</div></div>');
      }
    } else {
      html.push(`<h3>Infected</h3><p class="plan">${pub.phase === 'choice' ? 'The lockdown is still sealing the doors.' : 'You hunt with Elias. Find the survivors.'}</p>`);
    }
  }
  p.innerHTML = html.join('');
}

$('panel').addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const d = b.dataset;
  switch (d.act) {
    case 'stay': case 'exit': conn.send('choose', { action: d.act }); break;
    case 'hide': conn.send('choose', { action: 'hide', spot: d.spot }); break;
    case 'move': conn.send('choose', { action: 'move', to: d.to }); break;
    case 'hunt': conn.send('hunt', { to: d.to, search: d.search ?? null }); break;
    case 'flash': conn.send('flash'); break;
    case 'pickup': conn.send('pickup'); break;
    case 'drop': conn.send('drop'); break;
    case 'give-open': openGiveSheet(); break;
    case 'sos-open': openSosSheet(); break;
    case 'sos-update': conn.send('sos:update', { id: d.id }); break;
  }
});

function renderInbox() {
  const box = $('inbox');
  const inbox = view?.status === 'alive' ? view.sos?.inbox ?? [] : [];
  const now = conn.now();
  box.innerHTML = inbox.map(s => {
    const ago = Math.max(0, Math.round((now - s.updatedAt) / 1000));
    return `<div class="sos"><div class="who">${esc(s.senderName)} needs help</div>
      <div class="where">“${esc(s.text)}” · ${esc(s.roomName)}${s.lastSeen ? ' (last seen)' : ''} · ${ago < 10 ? 'just now' : `${ago}s ago`}</div>
      <div class="row">${btn('sos-reply', s.reply === 'coming' ? '✓ Coming' : "I'm coming", { active: s.reply === 'coming', data: { id: s.id, reply: 'coming' } })}
      ${btn('sos-reply', "I can't risk it", { active: s.reply === 'cant', data: { id: s.id, reply: 'cant' } })}
      ${btn('sos-map', 'Open map', { data: { id: s.id } })}</div></div>`;
  }).join('');
}
$('inbox').addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  if (b.dataset.act === 'sos-reply') conn.send('sos:reply', { id: b.dataset.id, reply: b.dataset.reply });
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
    conn.send('sos:send', { to, preset: d.preset });
    closeSheet();
  }
  if (d.act === 'give') { conn.send('give', { to: d.to }); closeSheet(); }
});

function openSosSheet() {
  const mates = view?.teammates ?? [];
  if (!mates.length) return toast('No other living guests to ask.');
  openSheet(`<h3>Ask for help</h3><p class="plan">Private: only the guest you choose sees it, with your current room (${esc(ROOMS[view.room].name)}).</p>
    <div class="row">${mates.map(id => btn('sos-to', esc(seatName(id)), { data: { to: id } })).join('')}</div>
    <h3 style="margin-top:14px">Message</h3>
    <div class="row">${Object.entries(SOS_PRESETS).map(([k, v]) => btn('sos-send', esc(v), { data: { preset: k } })).join('')}</div>
    ${btn('close', 'Cancel')}`, 'sos');
}

function openGiveSheet() {
  const here = (view.actors || []).filter(a => a.id !== me && a.status === 'alive' && a.id !== 'elias' && !a.birthday);
  openSheet(`<h3>Pass the camera to…</h3><div class="row">${here.map(a => btn('give', esc(seatName(a.id)), { data: { to: a.id } })).join('')}</div>${btn('close', 'Cancel')}`, 'give');
}

function openMapSheet(id) {
  const s = view?.sos?.inbox?.find(x => x.id === id);
  if (!s) return;
  const next = s.route?.[0];
  openSheet(`<h3>${esc(s.senderName)} · ${esc(s.roomName)}${s.lastSeen ? ' (last seen)' : ''}</h3>
    <div class="map">${mapSvg({ myRoom: view.room, targetRoom: s.room, route: s.route, exitOpen: pub.exitOpen })}</div>
    <p class="plan">${!s.route?.length ? 'They are in your room.' : `Next legal step: <b>${esc(ROOMS[next].name)}</b> (${s.route.length} room${s.route.length > 1 ? 's' : ''} away). Choose it in your next decision.`}</p>
    ${btn('close', 'Close')}`, 'map');
}

// ------------------------------------------------------------------ results
function renderResults() {
  const box = $('screen-results');
  if (pub.phase !== 'ended' || !pub.results) { box.hidden = true; return; }
  const r = JSON.parse(pub.results);
  const mine = view?.ended ?? null;
  const names = ids => ids.length ? ids.map(id => esc(seatName(id))).join(', ') : 'nobody';
  box.hidden = false;
  $('results').innerHTML = `<h2>Aftermath</h2>
    <p class="sub">${r.reason === 'dawn' ? 'Dawn broke with guests still inside.' : 'Every guest has escaped or turned.'} Elias Voss waits for the next unveiling.</p>
    <div class="results-big"><div><b>${r.escaped.length}</b>escaped</div><div><b>${r.teamScore}</b>team points</div><div><b>${mine?.score ?? 0}</b>your points</div></div>
    <div class="results-list"><p><b>Escaped:</b> ${names(r.escaped)}</p><p><b>Turned:</b> ${names(r.turned)}</p>${r.trapped.length ? `<p><b>Trapped at dawn:</b> ${names(r.trapped)}</p>` : ''}
    <p><b>Verified rescues:</b> ${r.rescues}${mine?.rescues?.length ? ` (you saved ${names(mine.rescues)})` : ''}</p>
    <p><b>The camera ended:</b> ${r.cameraEndedIn === 'escaped' ? 'outside with a survivor' : `in the ${esc(r.cameraEndedIn)}`}</p></div>
    <p class="fine">Waiting for the host to start another match.</p>`;
}

// When the page is opened directly from a QR code, focus the name field.
if ($('join-code').value) $('join-name').focus();
