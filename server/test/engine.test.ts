import assert from "assert";
import { CAST, CharacterId, CORRIDORS, EXIT_POINT, ROOMS, ROOM_GRAPH, ROOM_IDS, RoomId, SCORE, TUNING, Vec2, frontOf, hideSpot } from "../src/game/data.js";
import { ActorId, HauntedGame } from "../src/game/engine.js";
import { blockSpot, canSee, isWalkable, planRoute, zoneAt } from "../src/game/nav.js";

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
    // Travel taps inside the cooldown are queued (the last one wins), other actions still wait.
    g.setIntent("julian", { kind: "room", room: "sculpture" }, clock.t + 50);
    assert.throws(() => g.setIntent("julian", { kind: "hide", spot: "curtain_recess" }, clock.t + 60), /One move at a time/);
    assert.throws(() => g.setIntent("julian", { kind: "room", room: "mirrors" }, clock.t + 70), /reachable/, "queued taps are still validated");
    g.setIntent("julian", { kind: "room", room: "sealed" }, clock.t + 80);
    assert.strictEqual(g.get("julian").pending?.intent.kind, "room");
    advance(g, clock, TUNING.intentCooldownMs + 100);
    assert.strictEqual(g.get("julian").pending, null, "applied when the cooldown expired");
    assert.deepStrictEqual(g.get("julian").intent, { kind: "room", room: "sealed" }, "the last tap won");
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

  it("bedroom wing: reachable only through the Portrait Corridor; beds and wardrobes are real hiding places", () => {
    const { g, clock } = huntStarted(["julian", "anika"]);
    parkOthers(g, ["julian", "anika"]);
    place(g, "julian", ROOMS.study.center);
    assert.throws(() => g.setIntent("julian", { kind: "room", room: "master_bedroom" }, clock.t), /reachable/, "no shortcut past the corridor");
    g.setIntent("julian", { kind: "room", room: "corridor" }, clock.t, "run");
    run(g, clock, () => g.get("julian").room === "corridor" && !g.get("julian").path.length);
    g.setIntent("julian", { kind: "hide", spot: "under_fourposter" }, clock.t, "run");
    run(g, clock, () => g.get("julian").hideState === "hidden");
    assert.strictEqual(g.get("julian").room, "master_bedroom");
    assert.strictEqual((g.viewFor("julian", clock.t, names) as any).me.pose, "under");
    // Anika takes the wardrobe in the guest room.
    place(g, "anika", ROOMS.corridor.center);
    g.setIntent("anika", { kind: "hide", spot: "guest_wardrobe" }, clock.t, "run");
    run(g, clock, () => g.get("anika").hideState === "hidden");
    assert.strictEqual((g.viewFor("anika", clock.t, names) as any).me.pose, "inside");
    // A hunter who searches the bed finds Julian and pulls him out to the open side.
    const B = g.birthday;
    advance(g, clock, TUNING.lockdownGraceMs);
    place(g, B, ROOMS.master_bedroom.openArea ? [-16, 70] : ROOMS.master_bedroom.center);
    g.setIntent(B, { kind: "search", spot: "under_fourposter" }, clock.t);
    run(g, clock, () => !!g.get("julian").grabbedBy, 20_000);
    const j = g.get("julian").pos;
    assert.ok(j[1] < 74.65, "pulled out from under the bed (south of the frame)");
  });

  it("View Gallery: walk to a section of the portrait wall, stay visible and vulnerable, leave by moving", () => {
    const { g, clock } = huntStarted(["julian", "anika"]);
    parkOthers(g, ["julian", "anika"]);
    place(g, "julian", ROOMS.study.center);
    assert.throws(() => g.setIntent("julian", { kind: "gallery", station: "receptions" }, clock.t), /Portrait Corridor/, "only from the corridor");
    place(g, "julian", [-20, 60]);
    const opts = (g.viewFor("julian", clock.t, names) as any).options.gallery.map((x: any) => x.id);
    assert.deepStrictEqual(opts, ["receptions"], "only the section within reach is offered");
    assert.throws(() => g.setIntent("julian", { kind: "gallery", station: "collection" }, clock.t), /Portrait Corridor/, "another section means walking there");
    g.setIntent("julian", { kind: "gallery", station: "receptions" }, clock.t);
    run(g, clock, () => g.get("julian").viewing === "receptions");
    const me = (g.viewFor("julian", clock.t, names) as any).me;
    assert.strictEqual(me.viewing, "receptions");
    assert.strictEqual(me.hideState, "none", "viewing is not hiding");
    // Anyone nearby sees them standing at the wall.
    place(g, "anika", [-19, 60]);
    const seen = (g.viewFor("anika", clock.t, names) as any).actors.find((x: any) => x.id === "julian");
    assert.strictEqual(seen?.action, "viewing");
    // The timer keeps running while viewing.
    const left = g.huntEndsAt - clock.t;
    advance(g, clock, 3000);
    assert.ok(g.huntEndsAt - clock.t < left);
    // Any movement ends the viewing.
    clock.t += TUNING.intentCooldownMs;
    g.setIntent("julian", { kind: "room", room: "study" }, clock.t);
    assert.strictEqual(g.get("julian").viewing, null);
    // Hunters can't use it.
    const B = g.birthday;
    place(g, B, [-21, 60]);
    assert.throws(() => g.setIntent(B, { kind: "gallery", station: "receptions" }, clock.t), /Hunters/);
    // A grab interrupts viewing.
    place(g, "julian", [-22.5, 60.7]);
    clock.t += TUNING.intentCooldownMs;
    g.setIntent("julian", { kind: "gallery", station: "receptions" }, clock.t);
    run(g, clock, () => g.get("julian").viewing === "receptions");
    advance(g, clock, TUNING.lockdownGraceMs);
    g.setIntent(B, { kind: "chase", target: "julian" }, clock.t, "run");
    run(g, clock, () => !!g.get("julian").grabbedBy, 20_000);
    assert.strictEqual(g.get("julian").viewing, null);
  });

  describe("direct steering (phone stick)", () => {
    const hold = (g: HauntedGame, clock: { t: number }, id: any, x: number, z: number, st: number, ms: number) => {
      const end = clock.t + ms;
      while (clock.t < end && g.phase === "hunt" && g.get(id).status !== "escaped") { g.steer(id, x, z, st, clock.t); advance(g, clock, 100); }
    };
    it("a gentle push walks, a strong push runs; walls and furniture stop you, doorways let you through", () => {
      const { g, clock } = huntStarted(["julian"]);
      parkOthers(g, ["julian"]);
      place(g, "julian", [0, 67.6]);
      hold(g, clock, "julian", 1, 0, 0.4, 1000);
      const walked = g.get("julian").pos[0];
      assert.ok(walked > 1.4 && walked < 2.0, `walked ${walked}`);
      assert.strictEqual(g.get("julian").pace, "walk");
      place(g, "julian", [0, 67.6]);
      hold(g, clock, "julian", -1, 0, 1, 1000);
      assert.ok(g.get("julian").pos[0] < -3.0, "ran further");
      assert.strictEqual(g.get("julian").pace, "run");
      // east wall: the wardrobe's footprint stops you short
      place(g, "julian", [1, 69.7]);
      hold(g, clock, "julian", 1, 0, 1, 3000);
      assert.ok(g.get("julian").pos[0] <= 3.6 - TUNING.bodyRadius + 1e-6, "stopped by the wardrobe");
      // the bed
      place(g, "julian", [0.5, 73.7]);
      hold(g, clock, "julian", -1, 0, 1, 3000);
      assert.ok(g.get("julian").pos[0] >= -0.65 + TUNING.bodyRadius - 1e-6, "stopped by the bed");
      // south wall away from the door, then through the doorway into the passage and the corridor
      place(g, "julian", [3, 68]);
      hold(g, clock, "julian", 0, -1, 1, 3000);
      assert.strictEqual(g.get("julian").room, "guest_bedroom");
      assert.ok(g.get("julian").pos[1] >= 66 + TUNING.bodyRadius - 1e-6, "wall");
      place(g, "julian", [0, 68]);
      hold(g, clock, "julian", 0, -1, 1, 2500);
      assert.strictEqual(g.get("julian").room, "corridor", "walked out through the hallway door");
    });

    it("running is heard from the next room; walking is not", () => {
      const { g, clock } = huntStarted(["julian", "anika"]);
      parkOthers(g, ["julian", "anika"]);
      // Anika waits in the passage outside the door; Julian is out of her sight line, ~8 m away.
      place(g, "anika", [0, 65.5]);
      place(g, "julian", [3.5, 73]);
      assert.ok(!g.perceives(g.get("anika"), g.get("julian")), "out of sight");
      g.steer("julian", 0, 1, 0.4, clock.t); advance(g, clock, 100);
      const walkHeard = (g.viewFor("anika", clock.t, names) as any).sounds.length;
      g.steer("julian", 0, 1, 1, clock.t); advance(g, clock, 100);
      const runHeard = (g.viewFor("anika", clock.t, names) as any).sounds.map((s: any) => s.kind);
      assert.strictEqual(walkHeard, 0);
      assert.ok(runHeard.includes("running"));
    });

    it("Hide is offered only beside a hiding place; the stick leaves cover first", () => {
      const { g, clock } = huntStarted(["julian"]);
      parkOthers(g, ["julian"]);
      place(g, "julian", ROOMS.guest_bedroom.center);
      assert.deepStrictEqual((g.viewFor("julian", clock.t, names) as any).options.nearHides, []);
      place(g, "julian", frontOf(hideSpot("under_brass_bed")!.spot));
      assert.deepStrictEqual((g.viewFor("julian", clock.t, names) as any).options.nearHides.map((h: any) => h.id), ["under_brass_bed"]);
      g.setIntent("julian", { kind: "hide", spot: "under_brass_bed" }, clock.t);
      run(g, clock, () => g.get("julian").hideState === "hidden");
      g.steer("julian", 1, 0, 0.5, clock.t);
      assert.strictEqual(g.get("julian").hideState, "leaving");
      hold(g, clock, "julian", 1, 0, 0.5, TUNING.leaveCoverMs + 800);
      assert.strictEqual(g.get("julian").hideState, "none");
      assert.ok(g.get("julian").pos[0] > -1.6, "crawled out and walked away");
    });

    it("the new Guest Bathroom is reached only through the Guest Bedroom", () => {
      const { g, clock } = huntStarted(["julian"]);
      parkOthers(g, ["julian"]);
      place(g, "julian", [3, 73.5]);
      hold(g, clock, "julian", 0, 1, 0.5, 2500);
      assert.strictEqual(g.get("julian").room, "guest_bath");
      g.setIntent("julian", { kind: "hide", spot: "linen_cupboard" }, clock.t + TUNING.intentCooldownMs);
      run(g, clock, () => g.get("julian").hideState === "hidden");
      assert.strictEqual((g.viewFor("julian", clock.t, names) as any).me.pose, "inside");
    });

    it("walking through the open Garden Gate is the escape", () => {
      const { g, clock } = huntStarted(["julian"]);
      parkOthers(g, ["julian"]);
      place(g, "julian", [0, 23.5]);
      hold(g, clock, "julian", 0, -1, 1, 3000);
      assert.strictEqual(g.get("julian").status, "escaped");
      assert.ok(Math.abs(g.get("julian").pos[1] - EXIT_POINT[1]) < 2);
    });
  });

  it("one 15-minute countdown with intercom warnings at 5:00 and 1:00; the Garden Gate is open from the start", () => {
    const { g, clock } = huntStarted(["julian"]);
    assert.strictEqual(g.huntEndsAt - g.huntStartedAt, 15 * 60_000);
    assert.strictEqual(g.exitOpen, true);
    for (const a of g.actors.values()) a.cpu = false;
    g.drainEvents();
    place(g, "julian", ROOMS.master_bedroom.center);
    run(g, clock, () => g.phase === "ended", 16 * 60_000);
    const warns = g.drainEvents().filter(e => e.type === "deadline_warning").map(e => e.leftMs);
    assert.deepStrictEqual(warns, [5 * 60_000, 60_000]);
    assert.strictEqual(g.results().reason, "lockdown");
    assert.deepStrictEqual(g.results().trapped, ["julian"]);
  });

  it("Elias walks (no teleport) to the Garden Gate during the opening and physically guards it", () => {
    const g = newGame(["julian"]);
    const clock = { t: 0 };
    const trail: Vec2[] = [];
    run(g, clock, () => { if (clock.t % 1000 === 0) trail.push([...g.get("elias").pos] as Vec2); return g.phase === "hunt"; });
    for (let i = 1; i < trail.length; i++) {
      assert.ok(Math.hypot(trail[i][0] - trail[i - 1][0], trail[i][1] - trail[i - 1][1]) <= TUNING.eliasSpeed * 1.05 + 0.01, "no jumps");
    }
    assert.strictEqual(g.get("elias").blocking, "exit", "at the gate when the hunt starts");
    // A survivor who dashes straight for the gate is stopped at the doorway.
    for (const a of g.actors.values()) if (a.id !== "elias") a.cpu = false;
    g.setIntent("julian", { kind: "exit" }, clock.t, "run");
    run(g, clock, () => g.get("julian").intentState !== "accepted", 30_000);
    assert.notStrictEqual(g.get("julian").status, "escaped");
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

// ---------------------------------------------------------------------------------------
// Eagle-eye round: furniture-aware paths, floor taps, entry stops, same-room sight, the
// lunge warning and the break-free struggle. The Conservation Lab is the rebuilt proof room.
// ---------------------------------------------------------------------------------------
describe("Eagle-eye rules", () => {
  const LAB = ROOMS.conservation;
  const R = TUNING.bodyRadius;
  const furniture = LAB.obstacles!.map(([x0, x1, z0, z1]) => [x0 - R, x1 + R, z0 - R, z1 + R]);
  /** Strictly inside a lab obstacle grown by the body radius (touching its edge is fine). */
  const inFurniture = (p: Vec2, e = 1e-4) => zoneAt(p) === "conservation" && furniture.some(([x0, x1, z0, z1]) => p[0] > x0 + e && p[0] < x1 - e && p[1] > z0 + e && p[1] < z1 - e);
  /** Every 5 cm of the leg a-b stays out of the lab furniture. */
  const legClear = (a: Vec2, b: Vec2) => {
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.05));
    for (let k = 0; k <= n; k++) if (inFurniture([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n])) return false;
    return true;
  };
  const d2 = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const view = (g: HauntedGame, id: ActorId, t: number) => g.viewFor(id, t, names) as any;

  /** Walk julian into a hiding place, checking every tick that he never stands inside furniture (except the final crawl under it). */
  function hideTraced(g: HauntedGame, clock: { t: number }, spot: string) {
    const h = hideSpot(spot)!;
    const trace: Vec2[] = [];
    const j = g.get("julian");
    g.setIntent("julian", { kind: "hide", spot }, clock.t);
    const crawl = !isWalkable("conservation", h.spot.pos);
    // The planned waypoints: all standable except the crawl into the cover; every walked leg clear.
    const pts = [j.pos, ...j.path.map(w => w.p)];
    const walked = crawl ? pts.slice(0, -1) : pts;
    for (let k = 1; k < walked.length; k++) {
      assert.ok(!inFurniture(walked[k]), `${spot}: waypoint ${walked[k]} is inside furniture`);
      assert.ok(legClear(walked[k - 1], walked[k]), `${spot}: leg ${walked[k - 1]} -> ${walked[k]} crosses furniture`);
    }
    if (crawl) assert.deepStrictEqual(pts.at(-2), frontOf(h.spot), "crawls in from the open side");
    run(g, clock, () => {
      const onCrawl = crawl && j.path.length === 1;
      if (!onCrawl && j.hideState === "none") { assert.ok(!inFurniture(j.pos), `${spot}: walked through furniture at ${j.pos}`); trace.push([...j.pos] as Vec2); }
      return j.hideState === "hidden";
    }, 30_000);
    assert.deepStrictEqual(j.pos, h.spot.pos);
    return { trace, pts };
  }

  describe("paths around furniture", () => {
    it("routes into, out of and through the Conservation Lab never cut through its furniture", () => {
      const starts: Vec2[] = [LAB.center, [17, 23], [31.2, 35.3], [20.5, 36.8], [28, 31], [24, 36]];
      for (const p of starts) assert.ok(!inFurniture(p), `start ${p} is standable`);
      const goals: { zone: string; p: Vec2 }[] = [
        ...starts.map(p => ({ zone: "conservation", p })),
        // Goals on furniture (the covered statue, the restoration table) end beside it.
        { zone: "conservation", p: [31, 37] }, { zone: "conservation", p: [24.6, 32] },
        ...LAB.hides.map(h => ({ zone: "conservation", p: frontOf(h) })),
        { zone: "mirrors", p: ROOMS.mirrors.center }, { zone: "archive", p: ROOMS.archive.center }, { zone: "sealed", p: ROOMS.sealed.center },
      ];
      let furnished = 0;
      for (const s of starts) for (const goal of goals) {
        const route = planRoute(s, "conservation", goal)!;
        assert.ok(route, `no route ${s} -> ${goal.p}`);
        let prev = s;
        for (const w of route) {
          assert.ok(!inFurniture(w.p), `waypoint ${w.p} inside furniture (${s} -> ${goal.p})`);
          assert.ok(legClear(prev, w.p), `leg ${prev} -> ${w.p} crosses furniture (${s} -> ${goal.p})`);
          prev = w.p;
        }
        if (route.length > 1 && goal.zone === "conservation") furnished++;
      }
      assert.ok(furnished > 5, "some routes had to bend around furniture");
      // Through-traffic: Archive -> Hall of Mirrors crosses the lab by its doorways, around the rack.
      const through = planRoute(ROOMS.archive.center, "archive", { zone: "mirrors", p: ROOMS.mirrors.center })!;
      let prev = ROOMS.archive.center;
      for (const w of through) { assert.ok(legClear(prev, w.p)); prev = w.p; }
      assert.strictEqual(through.filter(w => w.door).length, 4, "doorway waypoints kept");
      // Rooms without furniture keep a straight line.
      assert.deepStrictEqual(planRoute([-15, 5], "portrait", { zone: "portrait", p: [-6, 14] }), [{ p: [-6, 14] }]);
    });

    it("hides under the restoration table: walks around it to the open side, then crawls under", () => {
      const { g, clock } = huntStarted(["julian"]);
      parkOthers(g, ["julian"]);
      place(g, "julian", [24.6, 36.5]);   // north of the table: must go round it
      const { pts } = hideTraced(g, clock, "under_restoration_table");
      assert.ok(pts.length >= 4, "went around the table");
      assert.strictEqual((view(g, "julian", clock.t)).me.pose, "under");
      // Climbing out lands on the open side, clear of the table.
      clock.t += TUNING.intentCooldownMs;
      g.setIntent("julian", { kind: "move", p: [20, 29] }, clock.t);
      advance(g, clock, TUNING.leaveCoverMs + 100);
      assert.ok(!inFurniture(g.get("julian").pos), "out from under the table");
    });

    it("reaches the canvas rack hiding place through the bay along the west wall", () => {
      const { g, clock } = huntStarted(["julian"]);
      parkOthers(g, ["julian"]);
      place(g, "julian", [26, 29]);
      const { trace } = hideTraced(g, clock, "canvas_rack");
      // Behind the rack (x < 17.55) south of the spot: the only way in is the bay past the notes desk.
      assert.ok(trace.some(p => p[0] < 17.55 && p[1] > 33.0 && p[1] < 34.8), "walked up the bay");
      assert.ok(!trace.some(p => p[0] > 17.55 && p[0] < 19.25 && p[1] > 33.05 && p[1] < 36.45), "never through the rack");
      // Standing-room cover: leaving it doesn't teleport you anywhere.
      clock.t += TUNING.intentCooldownMs;
      g.setIntent("julian", { kind: "idle" }, clock.t);
      g.steer("julian", 1, 0, 0.5, clock.t);
      assert.strictEqual(g.get("julian").hideState, "leaving");
      advance(g, clock, TUNING.leaveCoverMs + 50);
      assert.ok(d2(g.get("julian").pos, hideSpot("canvas_rack")!.spot.pos) < 0.2);
    });

    it("reaches the cabinet bay through the gap south of the solvent cabinet", () => {
      const { g, clock } = huntStarted(["julian"]);
      parkOthers(g, ["julian"]);
      place(g, "julian", [24, 30]);
      const { trace, pts } = hideTraced(g, clock, "cabinet_bay");
      // The cabinet's inflated footprint spans x 29.0-30.15; crossing that band is only possible in the gap z 23.22-23.95.
      const band = trace.filter(p => p[0] > 29.0 && p[0] < 30.15);
      assert.ok(band.length > 0 && band.every(p => p[1] > 23.2 && p[1] < 23.96), `crossed beside the cabinet at ${JSON.stringify(band)}`);
      assert.ok(pts.some(p => p[0] > 28.7 && p[0] < 30.6 && p[1] > 23.2 && p[1] < 24.0), "a waypoint in the south gap");
    });

    it("a hunter searching standing-room cover stands in its way in, finds the hider and pulls them clear of the furniture", () => {
      const { g, clock } = huntStarted(["julian"]);
      const B = g.birthday;
      parkOthers(g, ["julian"]);
      advance(g, clock, TUNING.lockdownGraceMs);
      place(g, "julian", [28, 24]);
      hideTraced(g, clock, "cabinet_bay");
      place(g, B, [24, 29]);
      assert.deepStrictEqual((view(g, B, clock.t)).huntOptions.nearSearch, [], "not offered from across the room");
      g.setIntent(B, { kind: "search", spot: "cabinet_bay" }, clock.t);
      const route = [g.get(B).pos, ...g.get(B).path.map(w => w.p)];
      for (let k = 1; k < route.length; k++) assert.ok(legClear(route[k - 1], route[k]));
      run(g, clock, () => !!g.get(B).searching, 20_000);
      assert.ok(d2(g.get(B).pos, hideSpot("cabinet_bay")!.spot.pos) < 1.0, "searches from inside the bay");
      run(g, clock, () => !!g.get("julian").grabbedBy, 10_000);
      assert.ok(!inFurniture(g.get("julian").pos));
    });
  });

  describe("floor taps and arrivals", () => {
    it("move: validated, snapped off furniture within reach, refused when nowhere near floor", () => {
      const { g, clock } = huntStarted(["julian", "anika"]);
      parkOthers(g, ["julian", "anika"]);
      place(g, "julian", [20, 29]);
      for (const bad of [[NaN, 1], [1], [1, 2, 3], "20,29", [Infinity, 30], null] as any[]) {
        assert.throws(() => g.setIntent("julian", { kind: "move", p: bad } as any, clock.t), /Bad position/, JSON.stringify(bad));
      }
      assert.throws(() => g.setIntent("julian", { kind: "move", p: [24, 40.5] }, clock.t), /can't stand there/, "outside the building");
      assert.throws(() => g.setIntent("julian", { kind: "move", p: [-11, 9] }, clock.t), /reachable/, "a room two doors away");
      // On the restoration table: nudged to the nearest floor beside it.
      g.setIntent("julian", { kind: "move", p: [24.6, 31.4] }, clock.t, "walk");
      const target = g.get("julian").path.at(-1)!.p;
      assert.ok(!inFurniture(target) && d2(target, [24.6, 31.4]) <= TUNING.moveSnapRange, `snapped to ${target}`);
      run(g, clock, () => g.get("julian").intentState === "done");
      assert.deepStrictEqual(g.get("julian").pos, target);
      assert.strictEqual(g.get("julian").room, "conservation");
      // Hunters use floor taps too.
      g.get("anika").status = "infected";
      place(g, "anika", [22, 26]);
      g.setIntent("anika", { kind: "move", p: [27, 24] }, clock.t);
      run(g, clock, () => !g.get("anika").path.length);
      assert.deepStrictEqual(g.get("anika").pos, [27, 24]);
    });

    it("move: a tap in the next room travels there and stops at that point; hidden movers leave cover first", () => {
      const { g, clock } = huntStarted(["julian"]);
      parkOthers(g, ["julian"]);
      place(g, "julian", [20, 29]);
      g.setIntent("julian", { kind: "move", p: [3, 31] }, clock.t, "run");
      assert.deepStrictEqual(g.get("julian").intent, { kind: "room", room: "sealed", p: [3, 31] });
      run(g, clock, () => g.get("julian").intentState === "done");
      assert.strictEqual(g.get("julian").room, "sealed");
      assert.deepStrictEqual(g.get("julian").pos, [3, 31]);
      // From cover: out first, then walk.
      clock.t += TUNING.intentCooldownMs;
      g.setIntent("julian", { kind: "hide", spot: "blackout_recess" }, clock.t);
      run(g, clock, () => g.get("julian").hideState === "hidden");
      clock.t += TUNING.intentCooldownMs;
      g.setIntent("julian", { kind: "move", p: [0, 30] }, clock.t);
      assert.strictEqual(g.get("julian").hideState, "leaving");
      assert.strictEqual(g.get("julian").afterLeave?.kind, "move");
      run(g, clock, () => g.get("julian").intentState === "done" && g.get("julian").hideState === "none");
      assert.deepStrictEqual(g.get("julian").pos, [0, 30]);
    });

    it("move: taps inside the cooldown are queued, the last one wins; other actions still wait", () => {
      const { g, clock } = huntStarted(["julian"]);
      parkOthers(g, ["julian"]);
      place(g, "julian", [20, 29]);
      const t0 = clock.t;
      g.setIntent("julian", { kind: "move", p: [22, 27] }, t0);
      g.setIntent("julian", { kind: "move", p: [26, 29] }, t0 + 100);
      g.setIntent("julian", { kind: "move", p: [27, 34] }, t0 + 200);
      assert.throws(() => g.setIntent("julian", { kind: "hide", spot: "canvas_rack" }, t0 + 250), /One move at a time/);
      assert.strictEqual(g.get("julian").pending!.at, t0 + TUNING.intentCooldownMs);
      assert.deepStrictEqual((g.get("julian").intent as any).p, [22, 27], "the first tap is under way");
      run(g, clock, () => clock.t >= t0 + TUNING.intentCooldownMs);
      assert.deepStrictEqual((g.get("julian").intent as any).p, [27, 34], "the last queued tap replaced it");
      run(g, clock, () => g.get("julian").intentState === "done");
      assert.deepStrictEqual(g.get("julian").pos, [27, 34]);
      // A queued tap that is no longer possible when it comes due is dropped with a reason.
      g.setIntent("julian", { kind: "move", p: [24, 29] }, clock.t);
      g.setIntent("julian", { kind: "move", p: [22, 29] }, clock.t + 10);
      g.get("julian").stunnedUntil = clock.t + 5000; g.get("julian").stunKind = "tangled";
      g.drainEvents();
      advance(g, clock, 500);
      assert.strictEqual(g.get("julian").pending, null);
      assert.ok(g.drainEvents().some(e => e.type === "interrupted" && e.to.includes("julian")));
    });

    it("room: phones stop ~1.5 m inside the entry doorway (side-stepping someone standing there) or at a tapped point", () => {
      const { g, clock } = huntStarted(["julian", "anika", "marcus"]);
      parkOthers(g, ["julian", "anika", "marcus"]);
      place(g, "julian", ROOMS.sealed.center);
      g.setIntent("julian", { kind: "room", room: "conservation" }, clock.t, "run");
      run(g, clock, () => g.get("julian").intentState === "done");
      const j = g.get("julian").pos;
      assert.ok(d2(j, [17.5, 30]) < 0.05, `stopped 1.5 m inside the west doorway (16, 30), at ${j}`);
      // The next arrival through the same doorway steps aside.
      place(g, "anika", ROOMS.sealed.center);
      g.setIntent("anika", { kind: "room", room: "conservation" }, clock.t, "run");
      run(g, clock, () => g.get("anika").intentState === "done");
      const a = g.get("anika").pos;
      assert.ok(Math.abs(a[0] - 17.5) < 0.05 && Math.abs(Math.abs(a[1] - 30) - 0.8) < 0.05, `side-stepped to ${a}`);
      // A tapped point in the room.
      place(g, "marcus", ROOMS.archive.center);
      g.setIntent("marcus", { kind: "room", room: "conservation", p: [27, 33] }, clock.t, "run");
      run(g, clock, () => g.get("marcus").intentState === "done");
      assert.deepStrictEqual(g.get("marcus").pos, [27, 33]);
      // A point that isn't anywhere near that room's floor falls back to the entry stop (south doorway (18, 22)).
      place(g, "marcus", ROOMS.archive.center);
      clock.t += TUNING.intentCooldownMs;
      g.setIntent("marcus", { kind: "room", room: "conservation", p: [0, 30] }, clock.t, "run");
      run(g, clock, () => g.get("marcus").intentState === "done");
      assert.ok(d2(g.get("marcus").pos, [18, 23.5]) < 0.05, `entry stop at ${g.get("marcus").pos}`);
    });
  });

  describe("sight", () => {
    it("everyone in the same room is visible at any distance; passages keep the range limit", () => {
      const { g, clock } = huntStarted(["julian", "anika"]);
      parkOthers(g, ["julian", "anika"]);
      for (const [room, a, b] of [["conservation", [16.6, 22.6], [31.4, 37.4]], ["portrait", [-20, 2], [-3.5, 16]]] as [string, Vec2, Vec2][]) {
        place(g, "julian", a); place(g, "anika", b);
        assert.ok(d2(a, b) > TUNING.sightRange, "further apart than the old sight range");
        assert.ok(g.perceives(g.get("julian"), g.get("anika")) && g.perceives(g.get("anika"), g.get("julian")), room);
        assert.ok(view(g, "julian", clock.t).actors.some((x: any) => x.id === "anika"), `${room}: in the view`);
      }
      assert.ok(!canSee([0, 0], "c3", [0, TUNING.sightRange + 1], "c3"), "a passage keeps the cap");
      assert.ok(!canSee([17, 23], "conservation", [5, 10], "archive"), "walls still block other rooms");
    });

    it("a secretly turned guest far across the room is visible but not revealed; hiding still hides", () => {
      const { g, clock } = huntStarted(["julian", "marcus"]);
      parkOthers(g, ["julian", "marcus"]);
      place(g, "julian", [16.8, 22.8]);
      place(g, "marcus", [31.2, 37.2]);
      g.get("marcus").status = "infected";
      const v = view(g, "julian", clock.t);
      const m = v.actors.find((x: any) => x.id === "marcus");
      assert.ok(m, "seen across the lab");
      assert.strictEqual(m.revealed, false);
      assert.strictEqual(m.lunging, false);
      assert.ok(!/infected/.test(JSON.stringify(v)), "no trace of the infection in the view");
      g.get("julian").hide = "under_restoration_table"; g.get("julian").hideState = "hidden";
      assert.ok(!view(g, "marcus", clock.t).actors.some((x: any) => x.id === "julian"), "cover still hides");
    });
  });

  describe("lunge and break free", () => {
    /** Julian in the lab with a secretly turned Marcus beside him (no lockdown grace for him). */
    function grabScene(extra: CharacterId[] = []) {
      const { g, clock } = huntStarted(["julian", "anika", "marcus", ...extra]);
      parkOthers(g, ["julian", "anika", "marcus", ...extra]);
      advance(g, clock, TUNING.lockdownGraceMs);
      place(g, "julian", [24, 28]);
      place(g, "anika", [30.5, 34]);    // same room, far away
      g.get("marcus").status = "infected";
      place(g, "marcus", [24.8, 28]);
      g.drainEvents();
      return { g, clock };
    }
    const grabbed = (g: HauntedGame, clock: { t: number }) => { run(g, clock, () => !!g.get("julian").grabbedBy, 5000); return g.get("julian").struggle!; };

    it("the lunge warning goes to its target, and to onlookers only when they can tell it's a hunter", () => {
      const { g, clock } = grabScene();
      advance(g, clock, TUNING.tickMs);   // the windup starts
      assert.ok(g.get("marcus").ai.windup, "winding up");
      assert.strictEqual(view(g, "julian", clock.t).actors.find((x: any) => x.id === "marcus").lunging, true, "the target feels it");
      const far = view(g, "anika", clock.t).actors.find((x: any) => x.id === "marcus");
      assert.ok(far && far.lunging === false && far.revealed === false, "a bystander can't tell a secret hunter is lunging");
      g.get(g.birthday).pos = [30, 34.5]; g.get(g.birthday).zone = "conservation"; g.get(g.birthday).room = "conservation";
      assert.strictEqual(view(g, g.birthday, clock.t).actors.find((x: any) => x.id === "marcus").lunging, true, "fellow hunters know");
      // Elias is always recognisable: everyone who sees him lunge is warned.
      place(g, "marcus", [26, 26]); g.get("marcus").ai.windup = null;
      place(g, "elias", [24.8, 28]);
      advance(g, clock, TUNING.tickMs);
      assert.strictEqual(view(g, "anika", clock.t).actors.find((x: any) => x.id === "elias").lunging, true);
      run(g, clock, () => !!g.get("julian").grabbedBy, 3000);
      assert.strictEqual(view(g, "julian", clock.t).actors.find((x: any) => x.id === "elias").lunging, false, "grabbing, not lunging");
      assert.strictEqual(g.get("julian").struggle!.need, TUNING.struggleNeed + TUNING.struggleNeedElias, "Elias is harder to break from");
    });

    it("enough taps in time: the victim breaks free, the hunter is shoved, and nobody can grab them for a moment", () => {
      const { g, clock } = grabScene();
      const B = g.birthday;
      const s = grabbed(g, clock);
      assert.strictEqual(s.need, TUNING.struggleNeed);
      assert.strictEqual(s.until - s.startedAt, TUNING.struggleMs);
      assert.strictEqual(g.get("marcus").biteAt - s.startedAt, TUNING.biteDelayMs, "bite timing unchanged");
      const ev = g.drainEvents();
      const fx = ev.filter(e => e.type === "struggle");
      assert.strictEqual(fx.length, 1);
      assert.deepStrictEqual(fx[0].to, ["julian"], "only the victim is asked to struggle");
      assert.deepStrictEqual({ ...fx[0], to: undefined }, { type: "struggle", to: undefined, grabId: s.grabId, by: "marcus", until: s.until, need: s.need });
      assert.deepStrictEqual(view(g, "julian", clock.t).me.struggle, { grabId: s.grabId, by: "marcus", until: s.until, need: s.need, got: 0 });
      assert.strictEqual(view(g, "anika", clock.t).me.struggle, null);
      assert.ok(!JSON.stringify(view(g, "anika", clock.t)).includes(s.grabId), "the struggle is private");
      // 8 taps a second, reported like a phone does (cumulative count).
      let freedAt = 0;
      while (!freedAt) {
        const n = Math.floor((clock.t - s.startedAt) * 8 / 1000) + 1;
        g.struggle("julian", s.grabId, n, clock.t);
        if (!g.get("julian").grabbedBy) { freedAt = clock.t; break; }
        assert.ok(view(g, "julian", clock.t).me.struggle.got <= n);
        advance(g, clock, TUNING.tickMs);
        assert.ok(clock.t < s.until + 500 && g.get("julian").status === "alive", "should have broken free");
      }
      assert.ok(freedAt - s.startedAt < TUNING.struggleMs);
      const j = g.get("julian"), m = g.get("marcus");
      assert.strictEqual(j.status, "alive");
      assert.strictEqual(j.struggle, null);
      assert.strictEqual(j.breaks, 1);
      assert.strictEqual(j.grabImmuneUntil, freedAt + TUNING.grabImmunityMs);
      assert.strictEqual(m.grabbing, null);
      assert.strictEqual(m.stunKind, "shoved");
      assert.strictEqual(m.stunnedUntil, freedAt + TUNING.shoveStunMs);
      assert.ok(!g.assists.has("julian"), "breaking free is nobody's rescue");
      const broke = g.drainEvents().find(e => e.type === "broke_free")!;
      assert.deepStrictEqual({ id: broke.id, from: broke.from }, { id: "julian", from: "marcus" });
      assert.ok(["julian", "marcus", "anika"].every(x => broke.to.includes(x as ActorId)), "witnesses see it");
      assert.ok(!broke.to.includes("elias"), "people elsewhere don't");
      const seen = view(g, "julian", clock.t).actors.find((x: any) => x.id === "marcus");
      assert.strictEqual(seen.stunned, "shoved");
      assert.throws(() => g.setIntent("marcus", { kind: "move", p: [20, 29] }, clock.t), /staggering/);
      assert.strictEqual(view(g, "julian", clock.t).me.struggle, null);
      // Another hunter right there can't grab Julian until the immunity ends; then the next struggle is harder.
      place(g, B, [j.pos[0] - 0.6, j.pos[1]]);
      run(g, clock, () => clock.t >= j.grabImmuneUntil - TUNING.tickMs);
      assert.strictEqual(j.grabbedBy, null, "immune");
      assert.strictEqual(g.get(B).ai.windup, null, "no lunge at an immune survivor");
      run(g, clock, () => !!j.grabbedBy, 3000);
      assert.strictEqual(j.grabbedBy, B);
      assert.ok(clock.t >= freedAt + TUNING.grabImmunityMs + TUNING.grabWindupMs);
      assert.strictEqual(j.struggle!.need, TUNING.struggleNeed + TUNING.struggleNeedPerBreak);
    });

    it("no taps: bitten exactly 3 s after the grab; late or stale reports are ignored", () => {
      const { g, clock } = grabScene();
      const s = grabbed(g, clock);
      assert.strictEqual(g.struggle("julian", "not-this-grab", 5, clock.t), false);
      assert.strictEqual(g.struggle("anika", s.grabId, 5, clock.t), false, "only the victim");
      run(g, clock, () => clock.t >= s.until + TUNING.struggleGraceMs - TUNING.tickMs);
      assert.strictEqual(g.get("julian").status, "alive");
      run(g, clock, () => g.get("julian").status === "infected", 2000);
      assert.strictEqual(clock.t, s.startedAt + TUNING.biteDelayMs);
      assert.strictEqual(g.get("julian").struggle, null);
      assert.strictEqual(g.struggle("julian", s.grabId, 99, clock.t), false);
      assert.strictEqual(g.infectionLog.at(-1)!.victim, "julian");
    });

    it("the server clamps credited taps to 12 a second", () => {
      const { g, clock } = grabScene();
      const s = grabbed(g, clock);
      run(g, clock, () => clock.t >= s.startedAt + 500);
      assert.strictEqual(g.struggle("julian", s.grabId, 100, clock.t), true);
      assert.strictEqual(s.got, Math.floor(500 * TUNING.struggleMaxTapsPerSec / 1000) + 1);
      assert.ok(g.get("julian").grabbedBy, "not free yet");
      assert.strictEqual(g.struggle("julian", s.grabId, 50, clock.t + 10), false, "a count can't go backwards");
      assert.strictEqual(g.struggle("julian", s.grabId, NaN, clock.t + 10), false);
      run(g, clock, () => !g.get("julian").grabbedBy, 3000);
      const needMs = Math.ceil((s.need - 1) * 1000 / TUNING.struggleMaxTapsPerSec);
      assert.ok(clock.t - s.startedAt >= needMs, `freed at +${clock.t - s.startedAt} ms, no sooner than the cap allows (+${needMs})`);
      assert.strictEqual(g.get("julian").status, "alive");
    });

    it("a friend's flash during the struggle still frees the victim", () => {
      const { g, clock } = grabScene();
      place(g, "anika", [27, 28]);
      g.camera.holder = "anika";
      const s = grabbed(g, clock);
      advance(g, clock, 1000);
      g.struggle("julian", s.grabId, 3, clock.t);
      const r = g.flash("anika", clock.t);
      assert.ok(r.saved.includes("julian"));
      const j = g.get("julian");
      assert.strictEqual(j.grabbedBy, null);
      assert.strictEqual(j.struggle, null);
      assert.strictEqual(j.breaks, 0, "not a break-free");
      assert.strictEqual(g.get("marcus").stunKind, "frozen");
      assert.strictEqual(g.assists.get("julian")?.helper, "anika");
      advance(g, clock, TUNING.biteDelayMs);
      assert.strictEqual(j.status, "alive");
    });

    it("CPU survivors tap at 3.5-6.5 a second: fast ones break free, slow ones don't", () => {
      for (const [rate, free] of [[6.5, true], [3.5, false]] as const) {
        const { g, clock } = grabScene();
        const s = grabbed(g, clock);
        g.get("julian").cpu = true;       // (a CPU survivor would have fled the revealed hunter; take over once caught)
        advance(g, clock, TUNING.tickMs);
        assert.ok(s.cpuRate >= TUNING.cpuTapRate[0] && s.cpuRate <= TUNING.cpuTapRate[1], `rate ${s.cpuRate}`);
        s.cpuRate = rate;
        run(g, clock, () => !g.get("julian").grabbedBy, 4000);
        assert.strictEqual(g.get("julian").status, free ? "alive" : "infected", `rate ${rate}`);
        if (free) {
          assert.strictEqual(g.get("julian").breaks, 1);
          assert.ok(clock.t - s.startedAt <= Math.ceil(s.need / rate * 1000) + TUNING.tickMs);
        } else assert.strictEqual(clock.t, s.startedAt + TUNING.biteDelayMs);
      }
    });
  });

  it("messages say Garden Gate", () => {
    const { g, clock } = huntStarted(["julian"]);
    const B = g.birthday;
    parkOthers(g, ["julian"]);
    place(g, "julian", ROOMS.master_bedroom.center);
    assert.throws(() => g.setIntent("julian", { kind: "exit" }, clock.t), /Garden Gate/);
    place(g, B, ROOMS.sealed.center);
    const doors = view(g, B, clock.t).huntOptions.doors;
    assert.strictEqual(doors.find((d: any) => d.key === "exit").label, "Garden Gate");
  });
});
