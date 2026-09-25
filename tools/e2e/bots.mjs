// 12 headless WebSocket "phones" play complete matches against a running server and
// check privacy on every private message they receive. No rendering, so it runs on a
// laptop that cannot host 12 browsers.
//
//   node tools/e2e/bots.mjs [serverUrl] [bots] [matches]
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../server/package.json', import.meta.url));
const { Client } = require('@colyseus/sdk');

const url = process.argv[2] || 'http://localhost:2567';
const N = Number(process.argv[3] || 12);
const MATCHES = Number(process.argv[4] || 1);
const CAST = ['julian', 'anika', 'marcus', 'mei', 'dev', 'amara', 'alex', 'andre', 'rafael', 'simone', 'owen', 'tessa', 'nia'];
const PRESETS = ['come_get_me', 'found_camera', 'exit_blocked'];
const pick = a => a[Math.floor(Math.random() * a.length)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const violations = [];
const stats = { views: 0, fx: 0, sosSent: 0, sosReceived: 0, flashes: 0, errors: {} };

function checkPrivacy(me, v) {
  if (!v || !v.id) return;
  for (const a of v.actors ?? []) if (a.id !== me && a.hide) violations.push(`${me} saw ${a.id}'s hiding place`);
  for (const s of v.sos?.inbox ?? []) if (s.sender === me) violations.push(`${me} inbox contains own SOS`);
  for (const s of v.sos?.outbox ?? []) if (s.recipient === me) violations.push(`${me} outbox addressed to self`);
  if (v.isHunter && (v.sos || v.teammates)) violations.push(`hunter ${me} received survivor SOS/teammates`);
  if (v.status === 'escaped' && v.actors?.length) violations.push(`escaped ${me} still sees actors`);
}

async function runMatch(round) {
  const hostClient = new Client(url);
  const host = await hostClient.create('gallery', { role: 'host', hostKey: process.env.HOST_KEY });
  let code = null;
  host.onMessage('host', m => { code = m.joinCode; });
  host.onMessage('*', () => {});
  host.send('hello');
  while (!code) await sleep(20);

  const bots = [];
  for (let i = 0; i < N; i++) {
    const c = new Client(url);
    const key = `botdevicekey${round}x${i}xxxxxxxx`;
    const room = await c.joinById(code, { playerKey: key, name: `Bot${i + 1}` });
    const bot = { id: CAST[i], room, view: null, lastAct: 0 };
    room.onMessage('view', v => { stats.views++; bot.view = v; checkPrivacy(bot.id, v); act(bot); });
    room.onMessage('fx', f => {
      stats.fx++;
      if (f.type === 'sos') stats.sosReceived++;
      // Anyone holding the camera flashes when a teammate (or they) are threatened.
      if ((f.type === 'discovered' || f.type === 'grabbed') && bot.view?.camera?.mine) { room.send('flash'); stats.flashes++; }
    });
    room.onMessage('error', e => { stats.errors[e.message] = (stats.errors[e.message] || 0) + 1; });
    room.onMessage('*', () => {});
    room.send('hello');
    room.send('claim', { character: CAST[i], name: `Bot${i + 1}` });
    bots.push(bot);
  }
  await sleep(500);
  host.send('host:cpuFill', { on: false });
  host.send('host:start');

  function act(bot) {
    const v = bot.view;
    if (!v || v.phase !== 'choice') return;
    const key = `${v.round}`;
    if (bot.lastAct === key) return;
    bot.lastAct = key;
    const r = bot.room;
    setTimeout(() => {
      if (v.status === 'alive') {
        if (v.camera?.onFloorHere) r.send('pickup');
        if (v.sos?.canSend && v.teammates?.length && Math.random() < 0.25) { r.send('sos:send', { to: pick(v.teammates), preset: pick(PRESETS) }); stats.sosSent++; }
        for (const s of v.sos?.inbox ?? []) if (!s.reply) r.send('sos:reply', { id: s.id, reply: pick(['coming', 'cant']) });
        const o = v.options;
        if (o.canExit && Math.random() < 0.8) r.send('choose', { action: 'exit' });
        else if (Math.random() < 0.4) r.send('choose', { action: 'hide', spot: pick(o.hides).id });
        else r.send('choose', { action: 'move', to: pick(o.moves) });
      } else if (v.isHunter && v.huntOptions) {
        const room = pick(v.huntOptions.rooms);
        r.send('hunt', { to: room.id, search: pick(room.hides) });
      }
    }, 200 + Math.random() * 1500);
  }

  const started = Date.now();
  while (host.state.phase !== 'ended') {
    await sleep(500);
    if (Date.now() - started > 15 * 60_000) throw new Error('match did not end in 15 minutes');
  }
  const results = JSON.parse(host.state.results);
  await sleep(500);
  const personal = bots.map(b => b.view?.ended?.score ?? 0);
  for (const b of bots) await b.room.leave(true);
  await host.leave(true);
  return { minutes: +((Date.now() - started) / 60000).toFixed(1), rounds: host.state.round, results, personal };
}

for (let m = 0; m < MATCHES; m++) {
  const r = await runMatch(m);
  console.log(`match ${m + 1}: ${r.minutes} min, ${r.rounds} rounds, escaped ${r.results.escaped.length}, turned ${r.results.turned.length}, trapped ${r.results.trapped.length}, team ${r.results.teamScore}, rescues ${r.results.rescues}, personal ${r.personal.join('/')}`);
}
console.log(JSON.stringify({ stats, privacyViolations: violations.length, examples: violations.slice(0, 5) }, null, 2));
process.exit(violations.length ? 1 : 0);
