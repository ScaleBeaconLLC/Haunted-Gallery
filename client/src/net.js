// Colyseus connection for phones and the host console: join by code, device key,
// reconnection after network drops or device sleep, and server clock sync.
import { Client } from '@colyseus/sdk';

export function serverUrl() {
  if (import.meta.env.VITE_SERVER_URL) return import.meta.env.VITE_SERVER_URL;
  // `npm run dev` serves the page from Vite (5173) and the game server runs on 2567.
  if (location.port === '5173') return `${location.protocol}//${location.hostname}:2567`;
  return location.origin;
}

function storage(kind) {
  try { const s = window[kind]; s.getItem('x'); return s; } catch { return null; }
}
export const local = storage('localStorage');
export const session = storage('sessionStorage');

/** A random, opaque per-device key so a phone can return to its own seat. Not a secret credential. */
export function deviceKey() {
  let k = local?.getItem('hg.deviceKey');
  if (!k || !/^[A-Za-z0-9_-]{16,64}$/.test(k)) {
    const bytes = crypto.getRandomValues(new Uint8Array(18));
    k = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    local?.setItem('hg.deviceKey', k);
  }
  return k;
}

export class Connection extends EventTarget {
  constructor() {
    super();
    this.client = new Client(serverUrl());
    this.room = null;
    this.clockOffset = 0; // serverNow - Date.now()
    this.state = null;
    this.status = 'idle';
    this._joinArgs = null;
    this._syncTimer = null;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this._joinArgs && this.status === 'lost') this.rejoin();
    });
  }

  now() { return Date.now() + this.clockOffset; }

  _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  _setStatus(s) { this.status = s; this._emit('status', s); }

  async joinPlayer(code, name) {
    this._joinArgs = { kind: 'player', code, name };
    const saved = session?.getItem(`hg.reconnect.${code}`);
    if (saved) {
      try { return this._attach(await this.client.reconnect(saved)); } catch { session?.removeItem(`hg.reconnect.${code}`); }
    }
    return this._attach(await this.client.joinById(code, { playerKey: deviceKey(), name }));
  }

  async createHost(hostKey) {
    this._joinArgs = { kind: 'host-create', hostKey };
    return this._attach(await this.client.create('gallery', { role: 'host', hostKey }));
  }

  async joinHost(code, hostToken) {
    this._joinArgs = { kind: 'host', code, hostToken };
    return this._attach(await this.client.joinById(code, { role: 'host', hostToken }));
  }

  async rejoin() {
    const a = this._joinArgs;
    if (!a || this.status === 'joining') return;
    this._setStatus('joining');
    try {
      if (a.kind === 'player') await this.joinPlayer(a.code, a.name);
      else if (a.kind === 'host') await this.joinHost(a.code, a.hostToken);
    } catch (e) {
      this._setStatus('lost');
      this._emit('error', e?.message || String(e));
      setTimeout(() => { if (this.status === 'lost' && document.visibilityState === 'visible') this.rejoin(); }, 4000);
    }
  }

  _attach(room) {
    this.room = room;
    const code = room.roomId;
    if (this._joinArgs?.kind === 'player') session?.setItem(`hg.reconnect.${code}`, room.reconnectionToken);
    room.onStateChange((state) => { this.state = state; this._emit('state', state); });
    room.onMessage('*', (type, payload) => {
      if (type === 'time') {
        const rtt = Date.now() - payload.t;
        this.clockOffset = payload.serverNow - (payload.t + rtt / 2);
        return;
      }
      this._emit(type, payload);
    });
    room.onDrop?.(() => this._setStatus('reconnecting'));
    room.onReconnect?.(() => {
      this._setStatus('connected');
      session?.setItem(`hg.reconnect.${code}`, room.reconnectionToken);
      room.send('hello');
    });
    room.onLeave((code) => {
      if (this.room !== room) return;
      this._setStatus('lost');
      if (code !== 1000 && code !== 4000) setTimeout(() => this.rejoin(), 1500);
    });
    room.onError((code, message) => this._emit('error', message || `Error ${code}`));
    room.send('hello');
    this.syncClock();
    clearInterval(this._syncTimer);
    this._syncTimer = setInterval(() => this.syncClock(), 15000);
    this._setStatus('connected');
    return room;
  }

  syncClock() { try { this.room?.send('time', { t: Date.now() }); } catch { /* reconnecting */ } }
  send(type, payload) {
    if (!this.room || this.status !== 'connected') { this._emit('error', 'Reconnecting…'); return; }
    this.room.send(type, payload);
  }
  async leave() { const r = this.room; this.room = null; this._joinArgs = null; await r?.leave(true); }
}
