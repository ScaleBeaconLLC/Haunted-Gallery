import assert from "assert";
import { CAST, CharacterId, CORRIDORS, ROOMS, ROOM_GRAPH, ROOM_IDS, RoomId, SCORE, TUNING, Vec2, hideSpot } from "../src/game/data.js";
import { ActorId, HauntedGame } from "../src/game/engine.js";
import { blockSpot, planRoute, zoneAt } from "../src/game/nav.js";

function seeded(seed: number) {
  return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
}
const names = (id: ActorId) => String(id);
const TWELVE = CAST.slice(0, 12).map(c => c.id);

function newGame(active: CharacterId[] = TWELVE, seed = 7) {
  let n = 0;
  return new HauntedGame({ active, cpu: new Set(), random: seeded(seed), idFactory: () => `id${++n}` }, 0);
}
function run(g: HauntedGame, clock: { t: number }, until: () => boolean, limit = 120_000) {
  const end = clock.t + limit;
  while (!until()) {
    clock.t += TUNING.tickMs;
    g.tick(clock.t);
    if (clock.t > end) throw new Error(`timed out (phase ${g.phase})`);
  }
}
function advance(g: HauntedGame, clock: { t: number }, ms: number) { const end = clock.t + ms; run(g, clock, () => clock.t >= end); }
/** Start the hunt with every actor human-controlled (inert unless told to act). */
function huntStarted(active?: CharacterId[]) {
  const g = newGame(active);
  const clock = { t: 0 };
  for (const a of g.actors.values()) a.cpu = false;
  run(g, clock, () => g.phase === "hunt");
  return { g, clock };
}
function place(g: HauntedGame, id: ActorId, pos: Vec2) {
  const a = g.get(id);
  a.pos = [...pos] as Vec2; a.path = []; a.hide = null; a.hideState = "none";
  const z = zoneAt(pos)!; a.zone = z; if ((ROOM_IDS as string[]).includes(z)) a.room = z as RoomId;
}
/** Park everyone not involved in a scenario far away in the Hall of Mirrors. */
function parkOthers(g: HauntedGame, keep: ActorId[]) {
  let i = 0;
  for (const a of g.actors.values()) if (!keep.includes(a.id)) place(g, a.id, [13 + (i++ % 6) * 2.4, 44 + Math.floor(i / 6) * 2]);
}

describe("Real-time rules", () => {
  it("opening: the unselected guest is the birthday victim, one camera drops, the hunt starts", () => {
    const g = newGame();
    const clock = { t: 0 };
    assert.strictEqual(g.birthday, "nia");
    run(g, clock, () => g.phase === "hunt");
    assert.strictEqual(g.get("nia").status, "infected");
    assert.strictEqual(g.camera.holder, null);
    assert.ok(g.drainEvents().every(e => e.type !== "turned"), "no public 'turned' announcement");
  });

  it("every route between rooms stays on walkable floor and crosses doorways", () => {
    for (const from of ROOM_IDS) for (const to of ROOM_IDS) {
      const route = planRoute(ROOMS[from].center, from, { zone: to, p: ROOMS[to].center })!;
      let prev: Vec2 = ROOMS[from].center;
      for (const w of route) {
        for (let k = 1; k <= 8; k++) {
          const p: Vec2 = [prev[0] + (w.p[0] - prev[0]) * k / 8, prev[1] + (w.p[1] - prev[1]) * k / 8];
          assert.ok(zoneAt(p), `${from}->${to} leaves the floor at ${p}`);
        }
        prev = w.p;
      }
      if (ROOM_GRAPH[from].includes(to)) assert.strictEqual(route.filter(w => w.door).length, 2, `${from}->${to} should cross 2 doorways`);
    }
    for (const c of CORRIDORS) assert.ok(c.path.every(p => zoneAt(p)));
  });

  it("travel is physical: no teleport, walking takes time, running is faster", () => {
    const { g, clock } = huntStarted(["julian", "anika"]);
    parkOthers(g, ["julian", "anika"]);
    place(g, "julian", ROOMS.portrait.center);
    place(g, "anika", ROOMS.portrait.center);
    g.setIntent("julian", { kind: "room", room: "sealed" }, clock.t, "walk");
    g.setIntent("anika", { kind: "room", room: "sealed" }, clock.t, "run");
    advance(g, clock, 1000);
    const j = g.get("julian");
    assert.strictEqual(j.room, "portrait", "still in the gallery after one second");
    assert.ok(j.path.length > 0);
    const startJ = clock.t;
    let anikaAt = 0, julianAt = 0;
    run(g, clock, () => {
      if (!anikaAt && g.get("anika").room === "sealed" && !g.get("anika").path.length) anikaAt = clock.t;
      if (!julianAt && j.room === "sealed" && !j.path.length) julianAt = clock.t;
      return !!(anikaAt && julianAt);
    });
    assert.ok(julianAt - startJ > 4000, "a walk between rooms takes several seconds");
    assert.ok(anikaAt < julianAt, "running arrives first");
  });

  it("rejects unreachable rooms and hiding places; allows changing destination mid-route", () => {
    const { g, clock } = huntStarted(["julian"]);
    parkOthers(g, ["julian"]);
    place(g, "julian", ROOMS.portrait.center);
    assert.throws(() => g.setIntent("julian", { kind: "room", room: "mirrors" }, clock.t), /reachable/);
    assert.throws(() => g.setIntent("julian", { kind: "hide", spot: "velvet_pocket" }, clock.t), /reachable/);
    g.setIntent("julian", { kind: "room", room: "sealed" }, clock.t);
    assert.throws(() => g.setIntent("julian", { kind: "room", room: "sculpture" }, clock.t + 50), /One move at a time/);
    run(g, clock, () => g.get("julian").zone === "c1");
    g.setIntent("julian", { kind: "room", room: "portrait" }, clock.t);
    run(g, clock, () => !g.get("julian").path.length);
    assert.strictEqual(g.get("julian").room, "portrait", "turned back through the same doorway");
  });

  it("is only hidden after physically entering cover; then invisible to people in the room", () => {
    const { g, clock } = huntStarted(["julian", "anika"]);
    parkOthers(g, ["julian", "anika"]);
    place(g, "julian", ROOMS.archive.center);
    place(g, "anika", [11, 9]);
    g.setIntent("julian", { kind: "hide", spot: "reading_alcove" }, clock.t);
    advance(g, clock, 300);
    assert.strictEqual(g.get("julian").hideState, "none", "not hidden while crossing open floor");
    assert.ok(g.viewFor("anika", clock.t, names)!.actors!.toString(), "view builds");
    run(g, clock, () => g.get("julian").hideState === "hidden");
    const anikaView = g.viewFor("anika", clock.t, names) as any;
    assert.ok(!anikaView.actors.some((a: any) => a.id === "julian"), "a hidden guest is not in other views");
    assert.ok(!JSON.stringify(anikaView).includes("reading_alcove\",\"state"), "no hiding place leak");
    g.peek("julian", true);
    assert.ok((g.viewFor("anika", clock.t, names) as any).actors.some((a: any) => a.id === "julian"), "peeking exposes");
    g.peek("julian", false);
    assert.ok(!(g.viewFor("anika", clock.t, names) as any).actors.some((a: any) => a.id === "julian"));
  });

  it("keeps infection secret: only close or attacking hunters look infected; no public turned event", () => {
    const { g, clock } = huntStarted(["julian", "anika", "marcus"]);
    parkOthers(g, ["julian", "anika", "marcus", "elias"]);
    place(g, "elias", [10, 5]);
    place(g, "marcus", [10.6, 5]);
    place(g, "julian", [4.5, 14]);   // same room, far away
    place(g, "anika", [26, 50]);     // another room entirely
    advance(g, clock, TUNING.lockdownGraceMs);
    g.drainEvents(); // the opening bite is witnessed by everyone by design
    run(g, clock, () => g.get("marcus").status === "infected");
    const events = g.drainEvents();
    assert.ok(!events.some(e => e.to.includes("*") && /bite|turned|you_turned/.test(e.type)), "infection is never broadcast");
    assert.ok(events.some(e => e.type === "you_turned" && e.to.includes("marcus")), "the victim is told privately");
    assert.ok(!events.some(e => e.type === "bite" && e.to.includes("anika")), "people in other rooms learn nothing");
    // Move Elias away so Marcus is just a figure across the room.
    place(g, "elias", [26, 44]);
    const far = (g.viewFor("julian", clock.t, names) as any).actors.find((a: any) => a.id === "marcus");
    assert.ok(far, "julian can see marcus across the room");
    assert.strictEqual(far.revealed, false, "at a distance he just looks like Marcus");
    place(g, "julian", [9, 5]);
    const near = (g.viewFor("julian", clock.t, names) as any).actors.find((a: any) => a.id === "marcus");
    assert.strictEqual(near.revealed, true, "up close the face gives it away");
    const anika = g.viewFor("anika", clock.t, names) as any;
    assert.ok(!anika.actors.some((a: any) => a.id === "marcus"), "anika cannot see marcus from another room");
    assert.ok(anika.sos.contacts.includes("marcus"), "and he is still an ordinary contact");
    assert.strictEqual(g.results().infections.at(-1)!.victim, "marcus", "recap keeps the history");
  });

  it("search: a hunter who searches the right place finds, grabs and bites; hunters only learn spots they saw", () => {
    const { g, clock } = huntStarted(["julian"]);
    const B = g.birthday;
    parkOthers(g, ["julian"]);
    place(g, "julian", ROOMS.archive.center);
    g.setIntent("julian", { kind: "hide", spot: "rolling_shelf" }, clock.t);
    run(g, clock, () => g.get("julian").hideState === "hidden");
    assert.ok(!g.get(B).ai.sawHide.some(s => s.spot === "rolling_shelf"), "a hunter elsewhere learns nothing");
    place(g, B, [12, 6]);
    advance(g, clock, TUNING.lockdownGraceMs);
    g.setIntent(B, { kind: "search", spot: "rolling_shelf" }, clock.t);
    run(g, clock, () => !!g.get("julian").grabbedBy);
    assert.strictEqual(g.get("julian").hideState, "none");
    run(g, clock, () => g.get("julian").status === "infected");
  });

  it("doorway blocking stops travellers; a flash staggers the blocker clear and the doorway works again", () => {
    const { g, clock } = huntStarted(["julian"]);
    const B = g.birthday;
    parkOthers(g, ["julian"]);
    advance(g, clock, TUNING.lockdownGraceMs);
    const door = "c1:sealed"; // portrait <-> sealed corridor, sealed side
    place(g, B, blockSpot(door)!);
    g.setIntent(B, { kind: "block", door }, clock.t);
    run(g, clock, () => g.get(B).blocking === door);
    place(g, "julian", ROOMS.portrait.center);
    g.get("julian").pace = "run";
    g.camera.holder = "julian";
    g.setIntent("julian", { kind: "room", room: "sealed" }, clock.t);
    run(g, clock, () => g.get("julian").intentState === "interrupted");
    const j = g.get("julian");
    assert.match(j.intentReason!, /doorway/);
    assert.ok(j.room === "portrait" || j.zone === "c1", "stopped short, did not pass through");
    assert.ok(j.status === "alive" && !j.grabbedBy, "stopped out of reach");
    const r = g.flash("julian", clock.t);
    assert.deepStrictEqual(r.frozen, [B]);
    assert.strictEqual(g.get(B).blocking, null, "the freeze releases the doorway");
    g.get("julian").lastIntentAt = -Infinity;
    g.setIntent("julian", { kind: "room", room: "sealed" }, clock.t);
    run(g, clock, () => g.get("julian").room === "sealed" || !!g.get("julian").grabbedBy, 4000);
    assert.strictEqual(g.get("julian").room, "sealed", "passed through within the freeze");
    assert.throws(() => g.flash("julian", clock.t + 1000), /recharging/);
  });

  it("flash freezes 5 s, recharges 7 s, frees a grabbed friend; rescue pays only on escape; camera not needed to escape", () => {
    const { g, clock } = huntStarted(["julian", "anika"]);
    const B = g.birthday;
    parkOthers(g, ["julian", "anika"]);
    advance(g, clock, TUNING.lockdownGraceMs);
    place(g, B, [0, 30]);
    place(g, "anika", [0.8, 30]);
    place(g, "julian", [3, 30]);
    g.camera.holder = "julian";
    run(g, clock, () => g.get("anika").grabbedBy === B);
    const t0 = clock.t;
    const r = g.flash("julian", t0);
    assert.ok(r.saved.includes("anika"));
    assert.strictEqual(g.get(B).stunnedUntil, t0 + 5000);
    // Hold the hunter still and far away so the escape itself is not contested.
    place(g, B, [26, 50]);
    assert.strictEqual(g.camera.readyAt, t0 + 7000);
    assert.strictEqual(g.get("julian").score, 0, "no points until the rescued guest escapes");
    run(g, clock, () => g.exitOpen, 200_000);
    g.setIntent("anika", { kind: "exit" }, clock.t, "run");
    run(g, clock, () => g.get("anika").status !== "alive");
    assert.strictEqual(g.get("anika").status, "escaped", "escaped without the camera");
    assert.strictEqual(g.get("anika").score, SCORE.escape);
    assert.strictEqual(g.get("julian").score, SCORE.rescue + SCORE.cameraAssist);
    assert.strictEqual(g.teamScore, SCORE.escape + SCORE.rescue);
  });

  it("clue -> snare -> tangle: temporary, releases blocking, immune to immediate re-snaring", () => {
    const { g, clock } = huntStarted(["julian"]);
    const B = g.birthday;
    parkOthers(g, ["julian"]);
    advance(g, clock, TUNING.lockdownGraceMs);
    place(g, "julian", hideSpot("canvas_rack")!.spot.pos);
    g.get("julian").hide = "canvas_rack"; g.get("julian").hideState = "hidden";
    const note = g.inspect("julian", "restoration_notes", clock.t);
    assert.match(note, /snare/);
    assert.strictEqual(g.get("julian").snares, 1);
    g.placeSnare("julian", clock.t);
    const s = g.snares[0];
    place(g, B, [s.pos[0] + 3, s.pos[1]]);
    g.get(B).blocking = "c5:conservation";
    g.setIntent(B, { kind: "room", room: "conservation" }, clock.t);
    g.get(B).path = [{ p: s.pos }, { p: [s.pos[0] - 3, s.pos[1]] }];
    run(g, clock, () => g.get(B).stunKind === "tangled");
    assert.strictEqual(g.get(B).blocking, null);
    assert.strictEqual(g.get(B).status, "infected", "tangled, not killed or removed");
    assert.strictEqual(g.snares.length, 0);
    run(g, clock, () => g.get(B).stunKind === null);
    assert.ok(g.get(B).snareImmuneUntil > clock.t, "repeat-hit protection");
  });

  it("SOS cannot be used to test who turned", () => {
    const { g, clock } = huntStarted(["julian", "anika", "marcus"]);
    g.get("marcus").status = "infected";
    const julian = g.viewFor("julian", clock.t, names) as any;
    assert.ok(julian.sos.contacts.includes("marcus"), "turned guests stay in the contact list");
    const s = g.sendSos("julian", "marcus", "come_get_me", clock.t);
    assert.strictEqual(s.delivered, false);
    const out = (g.viewFor("julian", clock.t, names) as any).sos.outbox[0];
    assert.strictEqual(out.reply, null, "looks like any unanswered request");
    assert.ok(!("delivered" in out));
    assert.ok(!JSON.stringify(g.viewFor("marcus", clock.t, names)).includes(s.id), "hunters never receive it");
  });

  it("an abandoned doorway block is released when a turned player disconnects", () => {
    const { g } = huntStarted(["julian", "marcus"]);
    const m = g.get("marcus");
    m.status = "infected";
    m.blocking = "exit";
    g.setCpu("marcus", true);
    assert.strictEqual(m.blocking, null);
  });

  it("CPU-only matches end, keep one camera, and never leak hidden guests into views", () => {
    for (let seed = 1; seed <= 12; seed++) {
      let n = 0;
      const g = new HauntedGame({ active: TWELVE, cpu: new Set(TWELVE), random: seeded(seed), idFactory: () => `s${seed}-${++n}` }, 0);
      const clock = { t: 0 };
      let checks = 0;
      run(g, clock, () => {
        if (clock.t % 2000 === 0 && g.phase === "hunt") {
          for (const viewer of g.actors.values()) {
            if (viewer.status === "escaped") continue;
            const v = g.viewFor(viewer.id, clock.t, names) as any;
            for (const x of v.actors) {
              const o = g.get(x.id);
              assert.ok(!(o.hideState === "hidden" && !o.peeking), "hidden guest leaked into a view");
            }
            checks++;
          }
        }
        for (const a of g.actors.values()) assert.ok(!(a.status === "infected" && a.hideState !== "none"));
        return g.phase === "ended";
      }, TUNING.huntMaxMs + 60_000);
      const r = g.results();
      assert.strictEqual(r.escaped.length + r.trapped.length + r.turned.filter(id => id !== g.birthday).length, 12);
      assert.ok(checks > 0);
    }
  });
});
