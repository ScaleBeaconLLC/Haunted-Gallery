import assert from "assert";
import { CAST, CharacterId, SCORE, TUNING } from "../src/game/data.js";
import { ActorId, HauntedGame } from "../src/game/engine.js";

/** Small deterministic PRNG so failures reproduce. */
function seeded(seed: number) {
  return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
}
const names = (id: ActorId) => String(id);
const TWELVE = CAST.slice(0, 12).map(c => c.id);

function newGame(opts: { active?: CharacterId[]; cpu?: CharacterId[]; seed?: number } = {}) {
  const active = opts.active ?? TWELVE;
  let n = 0;
  const g = new HauntedGame({ active, cpu: new Set(opts.cpu ?? []), random: seeded(opts.seed ?? 7), idFactory: () => `sos${++n}` }, 0);
  return g;
}
/** Advance game time in 100 ms steps until `until` returns true. */
function run(g: HauntedGame, clock: { t: number }, until: () => boolean, limit = 600_000) {
  const end = clock.t + limit;
  while (!until()) {
    clock.t += 100;
    g.tick(clock.t);
    if (clock.t > end) throw new Error(`timed out in phase ${g.phase} round ${g.round}`);
  }
}
function toChoice(g: HauntedGame, clock: { t: number }, round: number) {
  run(g, clock, () => g.phase === "choice" && g.round === round);
}

describe("HauntedGame rules", () => {
  it("makes the unselected 13th guest the birthday victim and drops the one camera", () => {
    const g = newGame();
    const clock = { t: 0 };
    assert.strictEqual(g.birthday, "nia");
    assert.ok(TWELVE.includes(g.photographer));
    assert.strictEqual(g.camera.holder, g.photographer);
    run(g, clock, () => g.phase === "choice");
    assert.strictEqual(g.get("nia").status, "infected");
    assert.strictEqual(g.get("nia").active, false);
    assert.strictEqual(g.camera.holder, null);
    assert.strictEqual(g.camera.room, "portrait");
    assert.strictEqual(g.survivors().length, 12);
    assert.strictEqual(g.round, 1);
  });

  it("validates choices against the room graph and hiding places", () => {
    const g = newGame();
    const clock = { t: 0 };
    toChoice(g, clock, 1);
    assert.throws(() => g.choose("julian", { action: "move", to: "mirrors" }), /connected room/);
    assert.throws(() => g.choose("julian", { action: "hide", spot: "crate_tunnel" }), /current room/);
    assert.throws(() => g.choose("julian", { action: "exit" }), /Sealed Exhibition/);
    assert.throws(() => g.choose("nia" as ActorId, { action: "stay" }), /living survivor/);
    assert.deepStrictEqual(g.choose("julian", { action: "move", to: "sealed" }), { action: "move", to: "sealed" });
    assert.throws(() => g.chooseHunt("elias", "sealed", null), /lockdown/);
  });

  it("lets a survivor escape WITHOUT the camera once the exit opens, scoring +100/+100", () => {
    const g = newGame({ active: ["julian", "anika"] });
    const clock = { t: 0 };
    toChoice(g, clock, 1);
    g.choose("julian", { action: "move", to: "sealed" });
    g.choose("anika", { action: "move", to: "sculpture" });
    toChoice(g, clock, 2);
    assert.strictEqual(g.get("julian").room, "sealed");
    assert.strictEqual(g.exitOpen, false);
    // Keep julian safe while the exit is still locked.
    g.choose("julian", { action: "hide", spot: "blackout_recess" });
    g.choose("anika", { action: "hide", spot: "plinth_shadow" });
    for (const h of g.hunters()) g.hunterChoices.set(h.id, { to: h.room, search: null });
    for (const h of g.hunters()) h.cpu = false; // hold hunters in place for this test
    toChoice(g, clock, 3);
    assert.strictEqual(g.exitOpen, true);
    assert.notStrictEqual(g.camera.holder, "julian");
    g.choose("julian", { action: "exit" });
    run(g, clock, () => g.phase === "encounter");
    assert.strictEqual(g.get("julian").status, "escaped");
    assert.strictEqual(g.get("julian").score, SCORE.escape);
    assert.strictEqual(g.teamScore, SCORE.escape);
  });

  it("keeps rooms, hiding places and SOS private (hunters and other guests learn nothing)", () => {
    const g = newGame({ active: ["julian", "anika", "marcus"] });
    const clock = { t: 0 };
    toChoice(g, clock, 1);
    g.choose("julian", { action: "move", to: "sculpture" });
    g.choose("anika", { action: "move", to: "sealed" });
    g.choose("marcus", { action: "hide", spot: "curtain_recess" });
    toChoice(g, clock, 2);
    const sos = g.sendSos("marcus", "anika", "come_get_me", clock.t);
    assert.strictEqual(sos.room, "portrait");

    const eliasView = JSON.stringify(g.viewFor("elias", clock.t, names));
    // Elias shares the portrait gallery with hidden Marcus: he must not see him or the SOS.
    assert.ok(!eliasView.includes("marcus"), "hunter view leaks a hidden survivor");
    assert.ok(!eliasView.includes("come_get_me") && !eliasView.includes("sos1"));
    assert.ok(!eliasView.includes("sculpture\",\"status") && !eliasView.includes("\"room\":\"sealed\""));

    const julian = g.viewFor("julian", clock.t, names) as any;
    assert.strictEqual(julian.room, "sculpture");
    assert.ok(julian.actors.every((a: any) => a.id === "julian"), "sees only own room");
    assert.deepStrictEqual(julian.sos.inbox, []);
    assert.ok(!JSON.stringify(julian).includes("curtain_recess\""), "another guest's hiding place leaked");

    const anika = g.viewFor("anika", clock.t, names) as any;
    assert.strictEqual(anika.sos.inbox.length, 1);
    assert.strictEqual(anika.sos.inbox[0].roomName, "Grand Portrait Gallery");
    assert.deepStrictEqual(anika.sos.inbox[0].route, ["portrait"]);
    g.replySos("anika", sos.id, "coming", clock.t);
    const marcus = g.viewFor("marcus", clock.t, names) as any;
    assert.strictEqual(marcus.sos.outbox[0].reply, "coming");
    assert.strictEqual(marcus.score + anika.score, 0, "SOS earns nothing");
    assert.strictEqual(g.teamScore, 0);
    assert.throws(() => g.sendSos("marcus", "julian", "exit_blocked", clock.t + 60_000), /One SOS per choice window/);
    assert.throws(() => g.replySos("julian", sos.id, "coming", clock.t), /isn't yours/);
    assert.throws(() => g.sendSos("elias", "julian", "come_get_me", clock.t), /living survivor/);
  });

  it("marks an SOS 'last seen' after the sender moves, without revealing the new room", () => {
    const g = newGame({ active: ["julian", "anika"] });
    const clock = { t: 0 };
    toChoice(g, clock, 1);
    const s = g.sendSos("julian", "anika", "found_camera", clock.t);
    g.choose("julian", { action: "move", to: "sculpture" });
    g.choose("anika", { action: "move", to: "sealed" });
    toChoice(g, clock, 2);
    const inbox = (g.viewFor("anika", clock.t, names) as any).sos.inbox;
    assert.strictEqual(inbox[0].lastSeen, true);
    assert.strictEqual(inbox[0].room, "portrait");
    assert.ok(!JSON.stringify(inbox).includes("sculpture"));
    g.updateSos("julian", s.id, clock.t);
    assert.strictEqual((g.viewFor("anika", clock.t, names) as any).sos.inbox[0].room, "sculpture");
  });

  it("bites a grabbed survivor and drops the camera where they turned", () => {
    const g = newGame({ active: ["julian", "anika"] });
    const clock = { t: 0 };
    toChoice(g, clock, 1);
    g.pickUpCamera("julian", clock.t);
    g.choose("julian", { action: "stay" });
    g.choose("anika", { action: "move", to: "sealed" });
    g.get("elias").cpu = false;
    toChoice(g, clock, 2);
    g.chooseHunt("elias", "portrait", null);
    g.hunterChoices.set(g.birthday, { to: "sculpture", search: null });
    g.get(g.birthday).cpu = false;
    g.choose("julian", { action: "stay" });
    g.choose("anika", { action: "hide", spot: "crate_tunnel" });
    run(g, clock, () => g.phase === "encounter");
    run(g, clock, () => g.get("julian").status !== "alive" || g.phase !== "encounter");
    assert.strictEqual(g.get("julian").status, "infected");
    assert.strictEqual(g.camera.holder, null);
    assert.strictEqual(g.camera.room, "portrait");
  });

  it("pays rescue +150 and camera assist +50 only after the saved guest truly escapes", () => {
    const g = newGame({ active: ["julian", "anika"] });
    const clock = { t: 0 };
    toChoice(g, clock, 1);
    g.pickUpCamera("julian", clock.t);
    g.choose("julian", { action: "stay" });
    g.choose("anika", { action: "stay" });
    for (const h of g.hunters()) h.cpu = false;
    toChoice(g, clock, 2);
    g.chooseHunt("elias", "portrait", null);
    g.chooseHunt(g.birthday, "portrait", null);
    g.choose("julian", { action: "stay" });
    g.choose("anika", { action: "stay" });
    run(g, clock, () => g.threats.some(t => t.victim === "anika" && t.grabbed));
    const result = g.flash("julian", clock.t);
    assert.ok(result.saved.includes("anika"));
    assert.throws(() => g.flash("julian", clock.t + 100), /recharging|No hunter/);
    run(g, clock, () => g.phase === "choice" && g.round === 3);
    assert.strictEqual(g.get("anika").status, "alive");
    assert.strictEqual(g.get("julian").score, 0, "no points before the escape");
    // Walk anika to the exit.
    g.choose("anika", { action: "move", to: "sealed" });
    g.choose("julian", { action: "move", to: "sculpture" });
    g.chooseHunt("elias", "portrait", null);
    g.chooseHunt(g.birthday, "portrait", null);
    toChoice(g, clock, 4);
    g.choose("anika", { action: "exit" });
    g.choose("julian", { action: "hide", spot: "plinth_shadow" });
    g.chooseHunt("elias", "portrait", null);
    g.chooseHunt(g.birthday, "portrait", null);
    run(g, clock, () => g.phase === "encounter");
    assert.strictEqual(g.get("anika").status, "escaped");
    assert.strictEqual(g.get("anika").score, SCORE.escape);
    assert.strictEqual(g.get("julian").score, SCORE.rescue + SCORE.cameraAssist);
    assert.strictEqual(g.teamScore, SCORE.escape + SCORE.rescue);
  });

  it("freezes hunters for 5 s and recharges 7 s after the shutter", () => {
    assert.strictEqual(TUNING.flashFreezeMs, 5000);
    assert.strictEqual(TUNING.cameraRechargeMs, 7000);
  });

  it("runs complete CPU-only matches to an ending while holding every invariant", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const g = newGame({ cpu: TWELVE, seed });
      const clock = { t: 0 };
      run(g, clock, () => {
        const holders = [...g.actors.values()].filter(a => g.camera.holder === a.id);
        assert.ok(holders.length <= 1);
        for (const a of g.actors.values()) {
          assert.ok(!(a.status === "infected" && a.hide), "infected actors never hide");
          if (a.hide) assert.ok(a.status === "alive");
        }
        return g.phase === "ended";
      }, 3_600_000);
      const r = g.results();
      assert.strictEqual(r.escaped.length + r.turned.filter(id => id !== g.birthday).length + r.trapped.length, 12);
      assert.ok(r.teamScore >= r.escaped.length * SCORE.escape);
    }
  });
});
