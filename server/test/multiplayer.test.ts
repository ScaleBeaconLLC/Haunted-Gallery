/**
 * Local multiplayer verification: independent @colyseus/sdk clients over real
 * WebSockets against the real room. Everything asserted here is measured on the
 * messages/state each client actually RECEIVED, not on UI labels.
 */
import assert from "assert";
import { ColyseusTestServer } from "@colyseus/testing";
import { Client } from "@colyseus/sdk";
import appConfig from "../src/app.config.js";
import { TUNING } from "../src/game/data.js";
import { testServer } from "./helpers/server.js";

// Test-only hooks (skip the opening, place/infect characters). Never enabled in production.
process.env.HG_TEST_HOOKS = "1";

type Msg = { type: string; payload: any };
interface Tap { room: any; msgs: Msg[]; raw: string[] }

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until(fn: () => boolean, ms = 6000, what = "condition") {
  const end = Date.now() + ms;
  while (!fn()) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await sleep(20); }
}
function tap(room: any): Tap {
  const t: Tap = { room, msgs: [], raw: [] };
  room.onMessage("*", (type: string, payload: any) => { t.msgs.push({ type, payload }); t.raw.push(JSON.stringify({ type, payload })); });
  room.send("hello");
  return t;
}
const lastView = (t: Tap) => [...t.msgs].reverse().find(m => m.type === "view")?.payload;
const errors = (t: Tap) => t.msgs.filter(m => m.type === "error").map(m => m.payload.message as string);
const key = (s: string) => `mp-test-device-${s}-0123456789`;

describe("Local multiplayer (independent SDK clients)", function () {
  this.timeout(60_000);
  let colyseus: ColyseusTestServer<typeof appConfig>;
  before(async () => { colyseus = await testServer(); });
  beforeEach(async () => colyseus.cleanup());

  /** A fresh, independent client (its own connection, as a separate phone would have). */
  const phone = () => new Client(`ws://127.0.0.1:${(colyseus as any).server.port}`);

  async function hostMatch() {
    const host = tap(await colyseus.sdk.create("gallery", { role: "host" }));
    await until(() => host.msgs.some(m => m.type === "host"), 6000, "host token");
    const { joinCode } = host.msgs.find(m => m.type === "host")!.payload;
    return { host, code: joinCode as string, server: colyseus.getRoomById(joinCode) as any };
  }
  async function joinAs(code: string, id: string, name: string) {
    const t = tap(await phone().joinById(code, { playerKey: key(id), name }));
    t.room.send("claim", { character: id, name });
    await until(() => lastView(t)?.character === id || lastView(t)?.id === id, 6000, `${id} claim`);
    return t;
  }
  /** Start with CPU fill off, skip the opening, park AI hunters, place people. */
  async function startHunt(host: Tap, server: any, place: Record<string, [number, number]>) {
    host.room.send("host:cpuFill", { on: false });
    host.room.send("host:start");
    await until(() => server.state.phase === "opening", 6000, "opening");
    host.room.send("test:setup", { skipOpening: true });
    await until(() => server.state.phase === "hunt", 6000, "hunt");
    const parked: Record<string, [number, number]> = { elias: [26, 52], [server.state.birthday]: [14, 52], ...place };
    host.room.send("test:setup", { inertCpu: true, place: parked });
    await sleep(300);
  }

  it("two independent clients join the SAME match by code with distinct identities; a bad code is refused", async () => {
    const { host, code, server } = await hostMatch();
    const a = await joinAs(code, "julian", "Ann");
    const b = await joinAs(code, "anika", "Bo");
    assert.strictEqual(a.room.roomId, code);
    assert.strictEqual(b.room.roomId, code);
    assert.notStrictEqual(a.room.sessionId, b.room.sessionId);
    assert.strictEqual(server.clients.length, 3); // host + 2 phones
    await until(() => host.room.state.seats.get("anika")?.taken === true);
    for (const t of [host, a, b]) {
      assert.strictEqual(t.room.state.seats.get("julian").displayName, "Ann");
      assert.strictEqual(t.room.state.seats.get("anika").displayName, "Bo");
    }
    await assert.rejects(phone().joinById("ZZZZZ", { playerKey: key("x"), name: "X" }), (e: any) => e.code === 522);
  });

  it("synchronizes permitted state and moves a character only through a server-validated action", async () => {
    const { host, code, server } = await hostMatch();
    const a = await joinAs(code, "julian", "Ann");
    const b = await joinAs(code, "anika", "Bo");
    await startHunt(host, server, { julian: [0, 30], anika: [2, 30] });
    for (const t of [host, a, b]) assert.strictEqual(t.room.state.phase, "hunt");
    const start = [...server.game.get("julian").pos];
    a.room.send("intent", { kind: "room", room: "sculpture", pace: "walk" });
    await until(() => lastView(a)?.me?.intent?.kind === "room" && lastView(a)?.me?.moving === true, 4000, "accepted intent");
    await sleep(1200);
    const now = server.game.get("julian").pos;
    assert.ok(Math.hypot(now[0] - start[0], now[1] - start[1]) > 1, "server moved the character");
    // B, standing nearby, perceives A walking — with the server's position, not a client claim.
    const seen = lastView(b).actors.find((x: any) => x.id === "julian");
    assert.ok(seen && seen.moving, "b sees julian moving");
    assert.ok(Math.hypot(seen.pos[0] - now[0], seen.pos[1] - now[1]) < 1.5, "b's copy matches the server");
  });

  it("rejects invalid actions and leaves authoritative state unchanged", async () => {
    const { host, code, server } = await hostMatch();
    const a = await joinAs(code, "julian", "Ann");
    await startHunt(host, server, { julian: [-11.75, 9] }); // Grand Portrait Gallery
    const before = JSON.stringify(server.game.get("julian").pos);
    a.room.send("intent", { kind: "room", room: "mirrors" });        // not adjacent
    a.room.send("intent", { kind: "hide", spot: "velvet_pocket" });  // hiding place in another wing
    a.room.send("flash");                                            // no camera
    a.room.send("host:start");                                       // not the host
    a.room.send("intent", { kind: "teleport", to: [0, 0] });         // not an action
    await until(() => errors(a).length >= 5, 4000, "5 rejections").catch(e => { throw new Error(e.message + " got: " + JSON.stringify(errors(a))); });
    const errs = errors(a).join(" | ");
    assert.match(errs, /reachable from here/);
    assert.match(errs, /not holding the camera/);
    assert.match(errs, /Not allowed/);
    assert.match(errs, /Unknown action/);
    assert.strictEqual(JSON.stringify(server.game.get("julian").pos), before, "no movement happened");
    assert.strictEqual(server.game.camera.holder, null);
  });

  it("isolates private data: hidden players, secret infection and SOS never reach other clients", async () => {
    const { host, code, server } = await hostMatch();
    const a = await joinAs(code, "julian", "Ann");
    const b = await joinAs(code, "anika", "Bo");
    const c = await joinAs(code, "marcus", "Cy");
    await startHunt(host, server, { julian: [-12, 9], anika: [-10, 9], marcus: [0, 30] });
    a.room.send("intent", { kind: "hide", spot: "curtain_recess", pace: "run" });
    await until(() => lastView(a)?.me?.hideState === "hidden", 12000, "a hidden");
    const mark = b.raw.length;
    await sleep(800);
    const bAfter = b.raw.slice(mark).join("\n");
    assert.ok(!/"id":"julian"/.test(bAfter), "b received nothing about hidden julian");
    // Secret infection: only marcus is told.
    const marks = { a: a.raw.length, b: b.raw.length, host: host.raw.length };
    host.room.send("test:setup", { infect: ["marcus"] });
    await until(() => c.msgs.some(m => m.type === "fx" && m.payload.type === "you_turned"), 4000, "private briefing");
    await sleep(500);
    for (const [n, t] of [["a", a], ["b", b], ["host", host]] as const) {
      assert.ok(!t.raw.slice(marks[n]).some(r => /you_turned|"turned"|infected/.test(r)), `${n} learned about the infection`);
    }
    assert.ok(!/infected/.test(JSON.stringify(host.room.state.toJSON())), "public state stays clean");
    // SOS from b to a reaches only a.
    b.room.send("sos:send", { to: "julian", preset: "come_get_me" });
    await until(() => (lastView(a)?.sos?.inbox?.length ?? 0) === 1, 4000, "sos delivered");
    const id = lastView(a).sos.inbox[0].id;
    await sleep(300);
    assert.ok(!c.raw.some(r => r.includes(id)) && !host.raw.some(r => r.includes(id)), "sos leaked");
  });

  it("reconnects after a temporary drop without resetting infection, the camera or its cooldown", async () => {
    const { host, code, server } = await hostMatch();
    const a = await joinAs(code, "julian", "Ann");
    const b = await joinAs(code, "anika", "Bo");
    await startHunt(host, server, { julian: [0, 30], anika: [-3, 34] });
    host.room.send("test:setup", { infect: ["anika"] });
    await until(() => server.game.get("anika").status === "infected");
    const g = server.game;
    g.camera.holder = "julian";
    g.camera.readyAt = g.lastTick + 60_000;
    const readyAt = g.camera.readyAt, actors = g.actors.size, sessA = a.room.sessionId, sessB = b.room.sessionId;
    for (const t of [a, b]) t.room.reconnection.minUptime = 0;
    let reconnected = 0;
    a.room.onReconnect(() => reconnected++);
    b.room.onReconnect(() => reconnected++);
    a.room.connection.close(4010); // MAY_TRY_RECONNECT: a network drop
    b.room.connection.close(4010);
    await until(() => server.state.seats.get("julian").connected === false || reconnected > 0, 4000, "drop seen");
    await until(() => reconnected === 2, 15000, "automatic reconnection");
    assert.strictEqual(a.room.sessionId, sessA);
    assert.strictEqual(b.room.sessionId, sessB);
    await until(() => server.state.seats.get("julian").connected && server.state.seats.get("anika").connected);
    assert.strictEqual(g.get("anika").status, "infected", "infection not cured");
    assert.strictEqual(g.camera.holder, "julian", "camera kept");
    assert.strictEqual(g.camera.readyAt, readyAt, "cooldown not reset");
    assert.strictEqual(g.actors.size, actors, "no duplicate characters");
    a.room.send("hello");
    await until(() => lastView(a)?.camera?.mine === true, 4000, "a's view restored");
  });

  it("after a page reload: token reconnection resumes the session; device-key re-entry returns the same seat; no host powers", async () => {
    const { host, code, server } = await hostMatch();
    const a = await joinAs(code, "julian", "Ann");
    await startHunt(host, server, { julian: [0, 30] });
    const token = a.room.reconnectionToken;
    const sess = a.room.sessionId;
    // A reload: the page (and its automatic retry) is gone; only the stored token remains.
    a.room.reconnection.enabled = false;
    a.room.connection.close(4010);
    await until(() => server.state.seats.get("julian").connected === false, 4000, "drop");
    await assert.rejects(phone().reconnect(`${code}:not-a-real-token`));
    const a2 = tap(await phone().reconnect(token));
    assert.strictEqual(a2.room.sessionId, sess, "same session resumed");
    await until(() => lastView(a2)?.id === "julian", 4000, "view restored");
    a2.room.send("host:start");
    await until(() => errors(a2).includes("Not allowed"), 3000, "host control refused");
    // A deliberate leave ends the token; the device key brings the phone back to its own seat.
    await a2.room.leave(true);
    await assert.rejects(phone().reconnect(token));
    const a3 = tap(await phone().joinById(code, { playerKey: key("julian"), name: "Ann" }));
    await until(() => lastView(a3)?.id === "julian", 4000, "same seat");
    assert.strictEqual(server.game.get("julian").cpu, false);
    assert.strictEqual([...server.game.actors.keys()].filter((k: string) => k === "julian").length, 1);
    // A stranger can't join a running match.
    await assert.rejects(phone().joinById(code, { playerKey: key("stranger"), name: "S" }), /already started/);
  });

  it("a second tab from the same device takes over the seat; the old connection is closed, not duplicated", async () => {
    const { code, server } = await hostMatch();
    const a = await joinAs(code, "julian", "Ann");
    let closed: number | null = null;
    a.room.onLeave((c: number) => { closed = c; });
    const a2 = tap(await phone().joinById(code, { playerKey: key("julian"), name: "Ann" }));
    await until(() => closed !== null, 4000, "old tab closed");
    assert.strictEqual(closed, 4201);
    assert.ok(a.msgs.some(m => m.type === "replaced"));
    await until(() => lastView(a2)?.character === "julian", 4000, "new tab owns the seat");
    assert.strictEqual(server.clients.filter((c: any) => c.userData?.playerKey === key("julian")).length, 1);
    assert.strictEqual(server.state.seats.get("julian").connected, true);
  });

  it("keeps two matches completely separate", async () => {
    const x = await hostMatch();
    const y = await hostMatch();
    assert.notStrictEqual(x.code, y.code);
    const px = await joinAs(x.code, "julian", "Xavier");
    const py = await joinAs(y.code, "julian", "Yolanda"); // same character, different match: allowed
    assert.strictEqual(x.server.state.seats.get("julian").displayName, "Xavier");
    assert.strictEqual(y.server.state.seats.get("julian").displayName, "Yolanda");
    await startHunt(x.host, x.server, { julian: [0, 30] });
    await sleep(500);
    assert.strictEqual(y.server.state.phase, "lobby", "starting X did not start Y");
    assert.ok(!py.raw.some(r => r.includes("Xavier") || r.includes(x.code)), "Y received nothing from X");
    assert.ok(!px.raw.some(r => r.includes("Yolanda") || r.includes(y.code)), "X received nothing from Y");
  });

  it("floor taps: a move intent walks the server path, bad points are refused, taps in the cooldown are queued", async () => {
    const { host, code, server } = await hostMatch();
    const a = await joinAs(code, "julian", "Ann");
    await startHunt(host, server, { julian: [20, 29] });   // Conservation Lab
    a.room.send("intent", { kind: "move", p: ["x", 1] });
    a.room.send("intent", { kind: "move", p: [24, 40.5] });  // between the lab and the Hall of Mirrors: no floor
    await until(() => errors(a).length >= 2, 4000, "2 rejections");
    assert.match(errors(a)[0], /Bad position/);
    assert.match(errors(a)[1], /can't stand there/);
    a.room.send("intent", { kind: "move", p: [22, 27], pace: "walk" });
    a.room.send("intent", { kind: "move", p: [27, 34], pace: "run" });   // inside the cooldown: queued, not refused
    await until(() => lastView(a)?.me?.pace === "run" && lastView(a)?.me?.intent?.kind === "move", 4000, "queued tap applied");
    await until(() => lastView(a)?.me?.intent?.state === "done", 8000, "arrived");
    assert.deepStrictEqual(server.game.get("julian").pos, [27, 34]);
    assert.ok(!errors(a).some(e => /One move at a time/.test(e)));
  });

  it("break free over the network: the victim's 'struggle' taps are counted by the server; only the victim is asked", async () => {
    const { host, code, server } = await hostMatch();
    const a = await joinAs(code, "julian", "Ann");
    const b = await joinAs(code, "anika", "Bo");
    await startHunt(host, server, { julian: [24, 28], anika: [30.5, 34] });
    const B = server.state.birthday;
    host.room.send("test:setup", { place: { [B]: [24.8, 28] }, struggleNeed: 6, grab: { hunter: B, victim: "julian" } });
    await until(() => !!lastView(a)?.me?.struggle, 4000, "struggle in the view");
    const st = lastView(a).me.struggle;
    assert.strictEqual(st.need, 6);
    assert.strictEqual(st.by, B);
    assert.strictEqual(st.got, 0);
    assert.ok(Math.abs(st.until - (Date.now() + TUNING.struggleMs)) < 1500, "until is a wall-clock time");
    assert.ok(a.msgs.some(m => m.type === "fx" && m.payload.type === "struggle" && m.payload.grabId === st.grabId && m.payload.need === 6));
    await sleep(200);
    assert.ok(!b.raw.some(r => r.includes(st.grabId)), "the struggle is private to the victim");
    // Tap like a phone: the cumulative count, one message per ~160 ms.
    const freed = () => a.msgs.some(m => m.type === "fx" && m.payload.type === "broke_free");
    for (let n = 1; n <= 12 && !freed(); n++) { a.room.send("struggle", { grabId: st.grabId, n }); await sleep(160); }
    await until(freed, 4000, "broke free");
    await until(() => lastView(a)?.me?.struggle === null && lastView(a)?.me?.caught === false, 4000, "view updated");
    assert.strictEqual(server.game.get("julian").status, "alive");
    assert.strictEqual(server.game.get(B).stunKind, "shoved");
    await until(() => b.msgs.some(m => m.type === "fx" && m.payload.type === "broke_free" && m.payload.id === "julian"), 3000, "witness told");
    await until(() => lastView(b)?.actors?.find((x: any) => x.id === B)?.stunned === "shoved", 3000, "witness sees the stagger");
  });

  it("struggle messages have their own rate budget: a burst is trimmed without starving other messages", async () => {
    const { host, code, server } = await hostMatch();
    const a = await joinAs(code, "julian", "Ann");
    await startHunt(host, server, { julian: [24, 28] });
    const B = server.state.birthday;
    host.room.send("test:setup", { place: { [B]: [24.8, 28] }, struggleNeed: 400, grab: { hunter: B, victim: "julian" } });
    await until(() => !!lastView(a)?.me?.struggle, 4000, "struggle in the view");
    const st = lastView(a).me.struggle;
    const g = server.game;
    let calls = 0;
    const orig = g.struggle.bind(g);
    g.struggle = (...args: any[]) => { calls++; return orig(...args); };
    for (let n = 1; n <= 40; n++) a.room.send("struggle", { grabId: st.grabId, n });
    for (let k = 0; k < 15; k++) a.room.send("peek", { on: true });   // the general budget is untouched: all 15 answered
    await until(() => errors(a).filter(e => /Peek from cover/.test(e)).length === 15, 3000, "general messages handled");
    assert.ok(calls >= 9 && calls <= 13, `struggle burst trimmed to about 10 (got ${calls})`);
    const credited = g.get("julian").struggle.got;
    assert.ok(credited <= 1 + Math.floor((Date.now() - (st.until - TUNING.struggleMs)) * TUNING.struggleMaxTapsPerSec / 1000) + 1, `tap-rate clamp (got ${credited})`);
    // It refills.
    const before = calls;
    await sleep(500);
    a.room.send("struggle", { grabId: st.grabId, n: 41 });
    await until(() => calls > before, 2000, "refilled");
    g.struggle = orig;
  });

  it("reports an expired session clearly instead of creating a replacement", async () => {
    const { host, code } = await hostMatch();
    const a = await joinAs(code, "julian", "Ann");
    await a.room.leave(true);
    await host.room.leave(true);
    await until(() => !colyseus.getRoomById(code), 6000, "room disposed");
    await assert.rejects(phone().joinById(code, { playerKey: key("julian"), name: "Ann" }), (e: any) => e.code === 522);
  });
});
