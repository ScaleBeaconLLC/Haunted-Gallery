// Host console: create a protected session, show the QR join link, start/pause/reset.
// Shows only public information (roster, statuses, aggregate counts) — never rooms,
// hiding places or SOS.
import QRCode from 'qrcode';
import { CAST } from '@game/data.ts';
import { Connection, serverUrl, session } from './net.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const conn = new Connection();
window.__hgHost = conn; // for automated tests on a test server
let pub = null;
let joinUrl = '';

function toast(text) { const t = $('toast'); t.textContent = text; t.hidden = false; setTimeout(() => { t.hidden = true; }, 3000); }

conn.addEventListener('error', e => toast(e.detail));
conn.addEventListener('host', async e => {
  const { joinCode, hostToken } = e.detail;
  session?.setItem('hg.host', JSON.stringify({ joinCode, hostToken }));
  $('h-auth').hidden = true;
  $('h-console').hidden = false;
  $('h-code').textContent = joinCode;
  joinUrl = `${await playerBase()}/?code=${joinCode}`;
  $('h-url').value = joinUrl;
  await QRCode.toCanvas($('h-qr'), joinUrl, { width: 640, margin: 2, errorCorrectionLevel: 'M' });
  // The library sets a fixed pixel size; let CSS scale it as a square.
  Object.assign($('h-qr').style, { width: '100%', height: 'auto' });
});
conn.addEventListener('state', e => { pub = e.detail; window.__hgHostState = pub?.toJSON?.() ?? pub; render(); });
conn.addEventListener('status', e => { if (e.detail === 'lost') toast('Connection lost — retrying…'); });
conn.addEventListener('ended', e => {
  session?.removeItem('hg.host');
  $('h-console').hidden = true;
  $('h-auth').hidden = false;
  $('h-auth-note').textContent = e.detail;
});

/** The URL phones should open. On a laptop served as "localhost", use its LAN address. */
async function playerBase() {
  if (import.meta.env.VITE_PUBLIC_URL) return import.meta.env.VITE_PUBLIC_URL.replace(/\/$/, '');
  if (!/^(localhost|127\.|\[::1\])/.test(location.hostname)) return location.origin;
  try {
    const { addresses } = await (await fetch(`${serverUrl()}/api/lan`)).json();
    if (addresses?.length) {
      $('h-url-note').textContent = `Local network preview: phones must be on the same Wi-Fi as this laptop (${addresses.join(', ')}).`;
      return `${location.protocol}//${addresses[0]}${location.port ? ':' + location.port : ''}`;
    }
  } catch { /* fall through */ }
  $('h-url-note').textContent = 'This page is on localhost; phones cannot open that address.';
  return location.origin;
}

$('h-create').addEventListener('click', async () => {
  $('h-create').disabled = true;
  try { await conn.createHost($('h-key').value); }
  catch (e) { toast(e?.message || 'Could not create a session'); }
  finally { $('h-create').disabled = false; }
});
$('h-start').addEventListener('click', () => conn.send('host:start'));
$('h-pause').addEventListener('click', () => conn.send(pub?.paused ? 'host:resume' : 'host:pause'));
$('h-reset').addEventListener('click', () => { if (confirm('End this match and return everyone to the lobby?')) conn.send('host:reset'); });
$('h-cpu').addEventListener('change', e => conn.send('host:cpuFill', { on: e.target.checked }));
$('h-roster').addEventListener('click', e => {
  const b = e.target.closest('[data-kick]');
  if (b && confirm('Free this seat?')) conn.send('host:kick', { character: b.dataset.kick });
});

function render() {
  if (!pub) return;
  const lobby = pub.phase === 'lobby';
  const label = { lobby: 'Lobby', opening: 'Opening cinematic', hunt: 'The hunt', ended: 'Match over' }[pub.phase];
  $('h-phase').textContent = pub.paused ? `${label} — PAUSED` : label;
  const secs = pub.phaseEndsAt ? Math.max(0, Math.ceil((pub.phaseEndsAt - conn.now()) / 1000)) : null;
  const left = secs == null ? '—' : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  setHtml($('h-stats'), lobby
    ? `<div><b>${pub.humanCount}</b>joined</div><div><b>${12 - pub.humanCount}</b>open seats</div>`
    // Public numbers only: who has turned is secret until the recap.
    : `<div><b>${pub.insideCount}</b>still inside</div><div><b>${pub.escapedCount}</b>escaped</div><div><b>${pub.teamScore}</b>team pts</div><div><b>${pub.paused ? 'II' : left}</b>left</div>`);
  $('h-start').disabled = !lobby || pub.humanCount === 0;
  $('h-pause').disabled = lobby || pub.phase === 'ended';
  $('h-pause').textContent = pub.paused ? 'Resume' : 'Pause';
  $('h-cpu').checked = pub.cpuFill;
  $('h-cpu').disabled = !lobby;
  setHtml($('h-roster'), CAST.map(c => {
    const s = pub.seats.get(c.id);
    const who = s?.taken ? (s.isCpu ? 'CPU' : esc(s.displayName)) : 'open';
    const status = s?.birthday ? 'birthday guest' : s?.status === 'escaped' ? 'escaped' : s?.status === 'inside' ? (s.isCpu || s.connected ? 'inside' : 'inside · reconnecting') : (s?.taken ? (s.connected ? 'ready' : 'disconnected') : '');
    return `<div class="h-seat ${s?.taken ? '' : 'off'}"><div><div>${esc(c.name)}</div><div class="s">${who}${status ? ' · ' + status : ''}</div></div>
      ${lobby && s?.taken && !s.isCpu ? `<button data-kick="${c.id}">Free</button>` : ''}</div>`;
  }).join(''));
  if (pub.phase === 'ended' && pub.results) {
    const r = JSON.parse(pub.results);
    const n = ids => ids.map(id => CAST.find(c => c.id === id)?.name ?? id).join(', ') || 'nobody';
    const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    $('h-results').innerHTML = `<h3>Results</h3><p>${r.escaped.length} escaped · team ${r.teamScore} pts · ${r.rescues} verified rescue(s)</p><p class="fine">Escaped: ${esc(n(r.escaped))}${r.trapped.length ? `<br/>Trapped at lockdown: ${esc(n(r.trapped))}` : ''}</p>
      <p class="fine">Infection history:<br/>${r.infections.map(i => `${mmss(i.atSec)} ${esc(n([i.victim]))} ← ${esc(i.by === 'elias' ? 'Elias Voss' : n([i.by]))}`).join('<br/>')}</p>`;
  } else $('h-results').innerHTML = '';
}
setInterval(render, 500);

// Only touch the DOM when content changes, so host taps (Free a seat) are never lost.
function setHtml(el, html) {
  if (el.__html === html) return;
  el.innerHTML = html; el.__html = html;
}

// Return to an existing session after a refresh.
const saved = (() => { try { return JSON.parse(session?.getItem('hg.host') || 'null'); } catch { return null; } })();
if (saved?.joinCode && saved?.hostToken) {
  conn.joinHost(saved.joinCode, saved.hostToken).catch(() => {
    session?.removeItem('hg.host');
    $('h-auth-note').textContent = 'The previous session has ended. Create a new one.';
  });
}
