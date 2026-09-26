// 12 headless WebSocket "phones" play complete real-time matches against a running
// server, sending the same intents as the phone UI, and check every private message:
//  - someone is only shown as infected when close up, attacking, frozen/tangled, or
//    publicly known (Elias, the birthday guest) — never from across a room;
//  - public state never carries infection counts or statuses;
//  - SOS reaches only its recipient; hunters get no survivor SOS or contacts.
//
//   HOST_KEY=... node tools/e2e/bots.mjs [serverUrl] [bots] [matches]
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../server/package.json', import.meta.url));
const { Client } = require('@colyseus/sdk');

const url = process.argv[2] || 'http://localhost:2567';
const N = Number(process.argv[3] || 12);
const MATCHES = Number(process.argv[4] || 1);
const REVEAL = 3.2 + 0.6; // server reveal distance plus movement between ticks
const CAST = ['julian', 'anika', 'marcus', 'mei', 'dev', 'amara', 'alex', 'andre', 'rafael', 'simone', 'owen', 'tessa', 'nia'];
const PRESETS = ['come_get_me', 'found_camera', 'exit_blocked'];
const pick = a => a[Math.floor(Math.random() * a.length)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const violations = [];
const stats = { views: 0, fx: 0, sosSent: 0, sosReceived: 0, flashes: 0, hides: 0, blocks: 0, searches: 0, intents: 0, errors: {} };
const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function check(bot, v, pub) {
  if (!v?.me) return;
  for (const a of v.actors ?? []) {
    if ('status' in a || 'hide' in a) violations.push(`${bot.id} got status/hide for ${a.id}`);
    const known = a.id === 'elias' || a.id === pub.birthday || v.role === 'hunter';
    if (a.revealed && !known && !a.action && !a.stunned && d(a.pos, v.me.pos) > REVEAL) {
      violations.push(`${bot.id} saw ${a.id} as infected from ${d(a.pos, v.me.pos).toFixed(1)} m`);
    }
  }
  for (const s of v.sos?.inbox ?? []) if (s.sender === bot.id) violations.push(`${bot.id} inbox has own SOS`);
  if (v.role === 'hunter' && v.sos) violations.push(`hunter ${bot.id} received SOS data`);
}

async function runMatch(round) {
  const host = await new Client(url).create('gallery', { role: 'host', hostKey: process.env.HOST_KEY });
  let code = null;
  host.onMessage('host', m => { code = m.joinCode; });
  host.onMessage('*', () => {});
  host.send('hello');
  while (!code) await sleep(20);
  const pubCheck = () => {
    const j = JSON.stringify(host.state.toJSON());
    if (/infected|alive"|aliveCount|infectedCount/.test(j)) violations.push('public state mentions infection');
  };

  const bots = [];
  for (let i = 0; i < N; i++) {
    const room = await new Client(url).joinById(code, { playerKey: `botkey${round}x${i}xxxxxxxxxxx`, name: `Bot${i + 1}` });
    const bot = { id: CAST[i], room, view: null, nextAt: 0 };
    room.onMessage('view', v => { stats.views++; bot.view = v; check(bot, v, host.state); });
    room.onMessage('fx', f => { stats.fx++; if (f.type === 'sos') stats.sosReceived++; });
    room.onMessage('error', e => { stats.errors[e.message] = (stats.errors[e.message] || 0) + 1; });
    room.onMessage('*', () => {});
    room.send('hello');
    room.send('claim', { character: CAST[i], name: `Bot${i + 1}` });
    bots.push(bot);
  }
  await sleep(500);
  host.send('host:cpuFill', { on: false });
  host.send('host:start');

  const act = bot => {
    const v = bot.view, r = bot.room;
    if (!v?.me || v.phase !== 'hunt' || v.status === 'escaped') return;
    const now = Date.now();
    if (now < bot.nextAt) return;
    bot.nextAt = now + 2500 + Math.random() * 4000;
    const pace = Math.random() < 0.35 ? 'run' : 'walk';
    const send = p => { stats.intents++; r.send('intent', { ...p, pace }); };
    if (v.role === 'survivor') {
      if (v.camera?.mine && v.actors.some(a => a.revealed && d(a.pos, v.me.pos) < 6) && v.camera.readyAt <= now) { r.send('flash'); stats.flashes++; }
      if (v.me.caught) return;
      if (v.sos?.canSend && Math.random() < 0.08) { r.send('sos:send', { to: pick(v.sos.contacts), preset: pick(PRESETS) }); stats.sosSent++; }
      for (const s of v.sos?.inbox ?? []) if (!s.reply) r.send('sos:reply', { id: s.id, reply: pick(['coming', 'cant']) });
      if (v.options.inspect?.length && Math.random() < 0.5) r.send('inspect', { clue: v.options.inspect[0].id });
      if (v.me.snares && Math.random() < 0.3) r.send('snare');
      if (v.me.hideState === 'hidden') {
        if (Math.random() < 0.3) { r.send('peek', { on: true }); setTimeout(() => r.send('peek', { on: false }), 800); }
        if (Math.random() < 0.6) return;
      }
      if (v.camera?.floor && Math.random() < 0.5) return send({ kind: 'pickup' });
      if (v.exitOpen && v.options.exit && Math.random() < 0.6) return send({ kind: 'exit' });
      if (Math.random() < 0.45) { stats.hides++; return send({ kind: 'hide', spot: pick(v.options.hides).id }); }
      if (v.options.rooms.length) return send({ kind: 'room', room: pick(v.options.rooms) });
    } else {
      const h = v.huntOptions;
      if (v.me.grabbing || v.me.stunned) return;
      if (h.chase.length) return send({ kind: 'chase', target: pick(h.chase) });
      const x = Math.random();
      if (x < 0.35 && h.searchSpots.length) { stats.searches++; return send({ kind: 'search', spot: pick(h.searchSpots).id }); }
      if (x < 0.5 && h.doors.length) { stats.blocks++; return send({ kind: 'block', door: pick(h.doors).key }); }
      if (h.rooms.length) return send({ kind: 'room', room: pick(h.rooms) });
    }
  };

  const started = Date.now();
  while (host.state.phase !== 'ended') {
    await sleep(250);
    for (const b of bots) act(b);
    pubCheck();
    if (Date.now() - started > 16 * 60_000) throw new Error('match did not end in 16 minutes');
  }
  const results = JSON.parse(host.state.results);
  await sleep(400);
  const personal = bots.map(b => b.view?.ended?.score ?? 0);
  for (const b of bots) await b.room.leave(true);
  await host.leave(true);
  return { minutes: +((Date.now() - started) / 60000).toFixed(1), results, personal };
}

for (let m = 0; m < MATCHES; m++) {
  const r = await runMatch(m);
  console.log(`match ${m + 1}: ${r.minutes} min, escaped ${r.results.escaped.length}, turned ${r.results.infections.length} (incl. birthday), trapped ${r.results.trapped.length}, team ${r.results.teamScore}, rescues ${r.results.rescues}`);
}
console.log(JSON.stringify({ stats, privacyViolations: violations.length, examples: [...new Set(violations)].slice(0, 8) }, null, 2));
process.exit(violations.length ? 1 : 0);
