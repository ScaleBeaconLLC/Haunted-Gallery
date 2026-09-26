// Two independent clients against a REAL (production-mode) server — no test hooks.
// Verifies: same match by code with distinct identities; a bad code is refused;
// a server-validated move seen by the other client; an invalid move rejected;
// private-data isolation (hidden player, SOS); drop reconnection and reload
// (token) reconnection without state loss; a second match stays separate.
//
//   HOST_KEY=... node tools/e2e/remote-multiplayer.mjs https://<server>
// Exit code 0 only if every check passes. Never prints tokens or the host key.
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../server/package.json', import.meta.url));
const { Client } = require('@colyseus/sdk');

const url = process.argv[2] || 'http://localhost:2567';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
async function until(fn, ms, what) {
  const end = Date.now() + ms;
  while (!fn()) { if (Date.now() > end) throw new Error(`timed out: ${what}`); await sleep(50); }
}
function tap(room) {
  const t = { room, msgs: [], raw: [] };
  room.onMessage('*', (type, payload) => { t.msgs.push({ type, payload }); t.raw.push(JSON.stringify({ type, payload })); });
  room.send('hello');
  return t;
}
const lastView = t => [...t.msgs].reverse().find(m => m.type === 'view')?.payload;
const errors = t => t.msgs.filter(m => m.type === 'error').map(m => m.payload.message);
const rnd = () => Math.random().toString(36).slice(2, 10);
const key = n => `remote-${n}-${rnd()}${rnd()}`;

async function newMatch() {
  const host = tap(await new Client(url).create('gallery', { role: 'host', hostKey: process.env.HOST_KEY }));
  await until(() => host.msgs.some(m => m.type === 'host'), 10000, 'host token');
  return { host, code: host.msgs.find(m => m.type === 'host').payload.joinCode };
}
async function join(code, character, name) {
  const t = tap(await new Client(url).joinById(code, { playerKey: key(character), name }));
  t.room.send('claim', { character, name });
  await until(() => lastView(t)?.character === character, 10000, `${character} claim`);
  return t;
}

try {
  const { host, code } = await newMatch();
  const a = await join(code, 'julian', 'RemoteA');
  const b = await join(code, 'anika', 'RemoteB');
  check('two clients joined the same match by code', a.room.roomId === code && b.room.roomId === code);
  check('distinct identities', a.room.sessionId !== b.room.sessionId && lastView(a).character !== lastView(b).character);
  await until(() => host.room.state.seats.get('anika')?.taken, 5000, 'seat sync');
  check('public roster synchronized to both', a.room.state.seats.get('anika').displayName === 'RemoteB' && b.room.state.seats.get('julian').displayName === 'RemoteA');
  let badCode = null;
  try { await new Client(url).joinById('ZZZZZ', { playerKey: key('x'), name: 'X' }); } catch (e) { badCode = e.code; }
  check('unknown match code refused (expired/wrong)', badCode === 522, `code ${badCode}`);

  host.room.send('host:cpuFill', { on: false });
  host.room.send('host:start');
  await until(() => host.room.state.phase === 'hunt', 40000, 'hunt (after the 24 s opening)');
  check('both clients see the hunt start', a.room.state.phase === 'hunt' && b.room.state.phase === 'hunt');

  // Invalid action: a room that is not adjacent to the Grand Portrait Gallery.
  const before = JSON.stringify(lastView(a).me.pos);
  a.room.send('intent', { kind: 'room', room: 'mirrors' });
  await until(() => errors(a).length > 0, 5000, 'rejection');
  await sleep(300);
  check('invalid move rejected by the server', /reachable/.test(errors(a)[0]) && JSON.stringify(lastView(a).me.pos) === before, errors(a)[0]);

  // Private isolation: A slips into the curtain recess while B stands in the same room.
  a.room.send('intent', { kind: 'hide', spot: 'curtain_recess', pace: 'run' });
  await until(() => lastView(b)?.actors?.some(x => x.id === 'julian' && x.moving), 5000, 'b sees a moving');
  check('synchronized action: B sees A moving (server position)', true);
  await until(() => lastView(a)?.me?.hideState === 'hidden', 15000, 'a hidden');
  const mark = b.raw.length;
  await sleep(1000);
  check('hidden player absent from the other client’s received data', !b.raw.slice(mark).some(r => r.includes('"id":"julian"')));
  b.room.send('sos:send', { to: 'julian', preset: 'come_get_me' });
  await until(() => (lastView(a)?.sos?.inbox?.length ?? 0) === 1, 5000, 'sos');
  const sosId = lastView(a).sos.inbox[0].id;
  await sleep(300);
  check('SOS delivered only to its recipient', !host.raw.some(r => r.includes(sosId)));
  check('public state carries no private data', !/curtain_recess|infected|"hide"|sos/i.test(JSON.stringify(host.room.state.toJSON())));

  // Temporary drop: automatic reconnection keeps the session and the hidden state.
  const sessA = a.room.sessionId;
  a.room.reconnection.minUptime = 0;
  let back = false;
  a.room.onReconnect(() => { back = true; });
  a.room.connection.close(4010);
  await until(() => back, 20000, 'auto reconnection');
  a.room.send('hello');
  await until(() => lastView(a)?.me?.hideState === 'hidden', 5000, 'state after reconnect');
  check('drop → automatic reconnection, same session, still hidden', a.room.sessionId === sessA);

  // Reload: only the stored token remains.
  const token = b.room.reconnectionToken, sessB = b.room.sessionId;
  b.room.reconnection.enabled = false;
  b.room.connection.close(4010);
  await sleep(800);
  const b2 = tap(await new Client(url).reconnect(token));
  await until(() => lastView(b2)?.id === 'anika', 8000, 'b2 view');
  check('reload → token reconnection resumes the same session and seat', b2.room.sessionId === sessB);
  b2.room.send('host:start');
  await until(() => errors(b2).length > 0, 5000, 'host refusal');
  check('rejoined player gets no host control', errors(b2).includes('Not allowed'));

  // A second match is separate.
  const y = await newMatch();
  const py = await join(y.code, 'julian', 'OtherMatch');
  await sleep(500);
  check('second match has its own code and lobby', y.code !== code && y.host.room.state.phase === 'lobby');
  check('no cross-match traffic', !py.raw.some(r => r.includes('RemoteA')) && !a.raw.some(r => r.includes('OtherMatch')));

  for (const t of [a, b2, host, py, y.host]) await t.room.leave(true).catch(() => {});
} catch (e) {
  check('run completed', false, e.message);
}
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed against ${url}`);
process.exit(failed ? 1 : 0);
