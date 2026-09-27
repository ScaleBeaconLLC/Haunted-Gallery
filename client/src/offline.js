// Offline review mode (?offline=1): the real rules engine (server/src/game/engine.ts) runs in
// this page instead of on the Colyseus server, with CPU guests in the other seats. It exposes
// the same interface as Connection (net.js): events 'state' / 'hello' / 'view' / 'fx' /
// 'error' / 'status', send(type, payload) and now(), so the whole client runs unchanged.
// For reviewing a build on one phone without a server: not multiplayer, and nothing leaves it.
import { HauntedGame, GameError } from '@game/engine.ts';
import { CAST, MAX_ACTIVE_SURVIVORS, ROOM_IDS, SOS_PRESETS } from '@game/data.ts';

const CHARACTERS = new Set(CAST.map(c => c.id));

function publicState() {
  const seats = new Map(CAST.map(c => [c.id, { character: c.id, displayName: '', taken: false, isCpu: false, connected: false, status: '', birthday: false }]));
  return {
    joinCode: 'SOLO', phase: 'lobby', paused: false, phaseEndsAt: 0, exitOpen: false, cpuFill: true,
    teamScore: 0, escapedCount: 0, insideCount: 0, humanCount: 0, birthday: '', photographer: '', results: '', seats,
  };
}

export class OfflineConnection extends EventTarget {
  constructor({ skipOpening = false } = {}) {
    super();
    this.status = 'idle';
    this.state = null;
    this.game = null;
    this.me = null;
    this.name = '';
    this.lastView = '';
    this.skipOpening = skipOpening;
    this.timer = null;
  }

  now() { return Date.now(); }
  _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  async joinPlayer(code, name) {
    this.name = String(name || '').slice(0, 20);
    this.state = publicState();
    this.status = 'connected';
    this._emit('status', 'connected');
    this._emit('state', this.state);
    this._emit('hello', { character: null, serverNow: Date.now() });
    this._emit('view', { character: null, phase: 'lobby' });
    return { roomId: 'SOLO' };
  }
  async createHost() { throw new Error('No host in offline mode'); }
  async leave() { clearInterval(this.timer); this.game = null; }
  syncClock() {}

  send(type, p) {
    try {
      this.handle(type, p ?? {});
    } catch (e) {
      if (e instanceof GameError) this._emit('error', e.message);
      else { console.error(e); this._emit('error', 'Something went wrong'); }
    }
    this.flush();
  }

  handle(type, p) {
    const g = this.game, now = Date.now(), me = this.me;
    const play = fn => {
      if (!g) throw new GameError("The match hasn't started");
      if (!me) throw new GameError('Choose a character first');
      fn(g, me);
    };
    switch (type) {
      case 'hello': this._emit('hello', { character: me, serverNow: now }); this.lastView = ''; return;
      case 'time': return;
      case 'claim': {
        if (this.state.phase !== 'lobby') throw new GameError('Characters are locked once the match starts');
        const character = String(p.character);
        if (!CHARACTERS.has(character)) throw new GameError('Unknown character');
        if (this.me) Object.assign(this.state.seats.get(this.me), { taken: false, displayName: '', connected: false });
        this.me = character;
        Object.assign(this.state.seats.get(character), { taken: true, displayName: this.name || 'You', connected: true });
        this.state.humanCount = 1;
        this._emit('hello', { character, serverNow: now });
        clearTimeout(this.startTimer);
        this.startTimer = setTimeout(() => this.start(), 1500);   // no host: the match starts itself
        return;
      }
      case 'release': return;
      case 'steer': return play((game, id) => game.steer(id, Number(p.x), Number(p.z), Number(p.s), now));
      case 'intent': return play((game, id) => {
        const pace = p.pace === 'run' ? 'run' : p.pace === 'walk' ? 'walk' : undefined;
        const pt = v => { if (!Array.isArray(v) || v.length !== 2 || !v.every(Number.isFinite)) throw new GameError('Bad position'); return [v[0], v[1]]; };
        const room = r => { if (!ROOM_IDS.includes(r)) throw new GameError('Unknown room'); return r; };
        let intent;
        switch (p.kind) {
          case 'idle': intent = { kind: 'idle' }; break;
          case 'move': intent = { kind: 'move', p: pt(p.p) }; break;
          case 'room': intent = p.p == null ? { kind: 'room', room: room(p.room) } : { kind: 'room', room: room(p.room), p: pt(p.p) }; break;
          case 'hide': intent = { kind: 'hide', spot: String(p.spot) }; break;
          case 'exit': intent = { kind: 'exit' }; break;
          case 'pickup': intent = { kind: 'pickup' }; break;
          case 'search': intent = { kind: 'search', spot: String(p.spot) }; break;
          case 'block': intent = { kind: 'block', door: String(p.door) }; break;
          case 'chase': intent = { kind: 'chase', target: String(p.target) }; break;
          case 'gallery': intent = { kind: 'gallery', station: String(p.station) }; break;
          default: throw new GameError('Unknown action');
        }
        game.setIntent(id, intent, now, pace);
      });
      case 'struggle': if (g && me) g.struggle(me, String(p.grabId ?? ''), Number(p.n), now); return;
      case 'pace': return play((game, id) => game.setPace(id, p.pace === 'run' ? 'run' : 'walk'));
      case 'peek': return play((game, id) => game.peek(id, !!p.on));
      case 'inspect': return play((game, id) => game.inspect(id, String(p.clue), now));
      case 'snare': return play((game, id) => game.placeSnare(id, now));
      case 'give': return play((game, id) => game.giveCamera(id, String(p.to)));
      case 'drop': return play((game, id) => game.dropCamera(id));
      case 'flash': return play((game, id) => game.flash(id, now));
      case 'sos:send': return play((game, id) => {
        if (!(p.preset in SOS_PRESETS)) throw new GameError('Choose a preset message');
        game.sendSos(id, String(p.to), p.preset, now);
      });
      case 'sos:reply': return play((game, id) => game.replySos(id, String(p.id), p.reply === 'coming' ? 'coming' : 'cant', now));
      case 'sos:update': return play((game, id) => game.updateSos(id, String(p.id), now));
      case 'sos:cancel': return play((game, id) => game.cancelSos(id, String(p.id)));
      default: return;   // host and test messages don't exist offline
    }
  }

  start() {
    if (!this.me || this.game) return;
    const active = [this.me];
    const cpu = new Set();
    const free = CAST.map(c => c.id).filter(id => id !== this.me).sort(() => Math.random() - 0.5);
    while (active.length < MAX_ACTIVE_SURVIVORS && free.length > 1) { const id = free.shift(); active.push(id); cpu.add(id); }
    for (const id of cpu) Object.assign(this.state.seats.get(id), { taken: true, isCpu: true, displayName: 'CPU', connected: true });
    this.game = new HauntedGame({ active, cpu }, Date.now());
    if (this.skipOpening) this.game.fastForwardOpening(Date.now());
    this.state.birthday = this.game.birthday;
    this.state.photographer = this.game.photographer;
    this.state.seats.get(this.game.birthday).birthday = true;
    this.timer = setInterval(() => { this.game?.tick(Date.now()); this.flush(); }, 100);
    this.flush(true);
  }

  flush(force = false) {
    const g = this.game;
    if (!g) { this._emit('state', this.state); return; }
    for (const e of g.drainEvents()) {
      const { to, ...payload } = e;
      if (to.includes('*') || to.includes(this.me)) this._emit('fx', payload);
    }
    const s = this.state;
    s.phase = g.phase;
    s.phaseEndsAt = g.phase === 'ended' ? 0 : g.phaseEndsAt;
    s.exitOpen = g.exitOpen;
    s.teamScore = g.teamScore;
    const active = [...g.actors.values()].filter(a => a.active);
    for (const a of g.actors.values()) {
      const seat = s.seats.get(a.id);
      if (seat && (a.active || a.birthday)) seat.status = a.status === 'escaped' ? 'escaped' : 'inside';
    }
    s.escapedCount = active.filter(a => a.status === 'escaped').length;
    s.insideCount = active.length - s.escapedCount;
    if (g.phase === 'ended' && !s.results) { s.results = JSON.stringify(g.results()); clearInterval(this.timer); }
    this._emit('state', s);
    const nameOf = id => {
      const cast = CAST.find(c => c.id === id);
      return id === this.me && this.name ? `${cast?.name.split(' ')[0]} (${this.name})` : cast?.name ?? String(id);
    };
    const view = g.viewFor(this.me, Date.now(), nameOf);
    const json = JSON.stringify(view);
    if (force || json !== this.lastView) { this.lastView = json; this._emit('view', view); }
  }
}
