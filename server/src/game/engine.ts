/**
 * Authoritative real-time Haunted Gallery rules. No networking and no wall clock:
 * `tick(now)` advances the simulation using game time in ms (the room excludes paused
 * time). Players send *intents* (go to a room, hide there, search, block a doorway…);
 * the server moves characters along real doorway routes at walking/running speed and
 * resolves cover, perception, grabs, bites, the camera, snares and escapes.
 *
 * Secrecy: infection is private. Nobody is told who turned; phones only receive what
 * their character can perceive (see `viewFor`). CPU players use the same perception.
 *
 * Design authority: CLAUDE.md, RESCUE_AND_SOS.md and the real-time upgrade brief. The
 * camera is NOT required to use the exit.
 */
import {
  CAMERA_START, CAST, CLUES, CharacterId, DOORWAYS, EXIT_POINT, EXIT_ROOM, GALLERY, GALLERY_REACH, GalleryStation, MAX_ACTIVE_SURVIVORS, ROOMS, ROOM_GRAPH,
  HideSpot, RoomId, SCORE, SOS_PRESETS, SosPreset, SosReply, TUNING, Vec2, frontOf, hideIds, hideSpot, standingSpot,
} from "./data.js";
import {
  Waypoint, ZoneId, blockSpot, canHear, canSee, clearLine, dist, doorwaysBetween, entryOf, hasObstacles, isRoom, isWalkable, nearestStandable, nearestWalkable,
  planRoute, roomPath, roomRoute, roomsOf, staggerSpot, toward, zoneAt,
} from "./nav.js";

export type ActorId = CharacterId | "elias";
export type Status = "alive" | "infected" | "escaped";
export type Phase = "opening" | "hunt" | "ended";
export type Pace = "walk" | "run";

export type Intent =
  | { kind: "idle" }
  /** Travel to a reachable room; `p` is an optional arrival point inside it. */
  | { kind: "room"; room: RoomId; p?: Vec2 }
  /** Walk to a floor point in your own zone (set by the server when validating a tap). */
  | { kind: "move"; p: Vec2; zone?: ZoneId }
  | { kind: "hide"; spot: string }
  | { kind: "exit" }
  | { kind: "pickup" }
  | { kind: "search"; spot: string }
  | { kind: "block"; door: string }
  | { kind: "chase"; target: ActorId }
  | { kind: "goto"; zone: ZoneId; p: Vec2 }
  | { kind: "gallery"; station: string };

type HideState = "none" | "entering" | "hidden" | "leaving";

export interface Actor {
  id: ActorId;
  status: Status;
  active: boolean;
  birthday: boolean;
  cpu: boolean;
  score: number;
  pos: Vec2;
  zone: ZoneId;
  room: RoomId;
  yaw: number;
  path: Waypoint[];
  pace: Pace;
  intent: Intent;
  intentSeq: number;
  intentState: "accepted" | "done" | "interrupted";
  intentReason: string | null;
  lastIntentAt: number;
  hide: string | null;
  hideState: HideState;
  hideTimer: number;
  /** Where to go once out of cover (set when a move is chosen while hidden). */
  afterLeave: Intent | null;
  peeking: boolean;
  stunnedUntil: number;
  /** frozen: flash; tangled: snare; turning: just bitten; shoved: a victim broke free of its grab. */
  stunKind: "frozen" | "tangled" | "turning" | "shoved" | null;
  snareImmuneUntil: number;
  grabbedBy: ActorId | null;
  grabbing: ActorId | null;
  biteAt: number;
  searching: { spot: string; until: number } | null;
  blocking: string | null;
  /** Standing at a View Gallery section, looking at the wall (open, visible, vulnerable). */
  viewing: string | null;
  /** Direct steering from the phone's stick: a unit direction, walk or run, valid until `until`. */
  steer: { dx: number; dz: number; run: boolean; until: number } | null;
  snares: number;
  clues: Set<string>;
  clueNotes: Map<string, string>;
  /** A move/room tap made inside the intent cooldown: applied when it expires (last one wins). */
  pending: { intent: Intent; pace?: Pace; at: number } | null;
  /** While grabbed: the break-free struggle (server-counted taps). */
  struggle: Struggle | null;
  /** How many times this survivor has already broken free (each makes the next harder). */
  breaks: number;
  /** Nobody can grab this survivor before this time (just broke free). */
  grabImmuneUntil: number;
  ai: {
    nextThinkAt: number;
    sawHide: { spot: string; at: number }[];
    heard: { p: Vec2; zone: ZoneId; at: number } | null;
    hideUntil: number;
    blockUntil: number;
    lastSeen: { p: Vec2; zone: ZoneId; at: number } | null;
    lastSearched: Map<string, number>;
    replanAt: number;
    guardUntil: number;
    nextGuardAt: number;
    committedUntil: number;
    chaseUntil: number;
    ignore: Map<ActorId, number>;
    windup: { target: ActorId; since: number } | null;
  };
}

/** A grabbed survivor's attempt to break free before the bite. */
export interface Struggle {
  grabId: string;
  by: ActorId;
  startedAt: number;
  /** Taps count until this time (plus a short grace for late messages); the bite lands later. */
  until: number;
  need: number;
  /** Taps credited so far. */
  got: number;
  /** Highest cumulative tap count the victim's phone has reported. */
  reported: number;
  /** CPU victims: simulated taps per second and taps so far. */
  cpuRate: number;
  cpuTaps: number;
  cpuAt: number;
}

export interface Sos {
  id: string;
  sender: CharacterId;
  recipient: CharacterId;
  preset: SosPreset;
  room: RoomId;
  sentAt: number;
  updatedAt: number;
  /** False when the recipient could not receive it (the sender is never told why). */
  delivered: boolean;
  reply: SosReply | null;
  repliedAt: number | null;
  cancelled: boolean;
}

interface Assist { helper: CharacterId; method: "camera_stun" | "snare"; photographer: CharacterId | null }
interface Snare { id: string; owner: CharacterId; pos: Vec2; zone: ZoneId; placedAt: number }

/** An event for some phones. `to` lists actor ids whose phones receive it ("*" = everyone). */
export interface GameEvent { type: string; to: (ActorId | "*")[]; [k: string]: unknown }

export interface MatchSetup {
  active: CharacterId[];
  cpu: Set<CharacterId>;
  random?: () => number;
  idFactory?: () => string;
}

export class GameError extends Error {}

const round2 = (v: number) => Math.round(v * 100) / 100;
const validVec = (p: unknown): p is Vec2 =>
  Array.isArray(p) && p.length === 2 && typeof p[0] === "number" && typeof p[1] === "number" && Number.isFinite(p[0]) && Number.isFinite(p[1]);

export class HauntedGame {
  phase: Phase = "opening";
  startedAt: number;
  huntStartedAt = 0;
  huntEndsAt = 0;
  exitOpensAt = 0;
  exitOpen = false;
  teamScore = 0;
  readonly actors = new Map<ActorId, Actor>();
  readonly birthday: CharacterId;
  readonly photographer: CharacterId;
  /** Test servers only (HG_TEST_HOOKS): a longer search so screenshots can catch it. */
  testSearchMs: number | null = null;
  /** Test servers only (HG_TEST_HOOKS): a fixed number of taps to break free. */
  testStruggleNeed: number | null = null;
  camera: { holder: CharacterId | null; pos: Vec2; zone: ZoneId; room: RoomId; readyAt: number };
  snares: Snare[] = [];
  /** Clue ids whose snare has been taken (each clue gives one). */
  clueSnaresTaken = new Set<string>();
  assists = new Map<CharacterId, Assist>();
  rescuePaid = new Set<CharacterId>();
  cameraAssistPaid = new Set<CharacterId>();
  sos: Sos[] = [];
  lastSosAt = new Map<CharacterId, number>();
  endReason: "all_resolved" | "lockdown" | null = null;
  private warningsSent = new Set<number>();
  endedAt = 0;
  rescueLog: { victim: CharacterId; helper: CharacterId; method: string; at: number }[] = [];
  infectionLog: { victim: ActorId; by: ActorId; room: RoomId; atSec: number }[] = [];
  escapeLog: { id: CharacterId; atSec: number; withCamera: boolean }[] = [];
  private events: GameEvent[] = [];
  private scheduled: { at: number; run: () => void }[] = [];
  private rand: () => number;
  private newId: () => string;
  private lastTick = 0;

  constructor(setup: MatchSetup, now: number) {
    this.rand = setup.random ?? Math.random;
    this.newId = setup.idFactory ?? (() => Math.random().toString(36).slice(2, 12));
    const active = [...new Set(setup.active)];
    if (active.length < 1 || active.length > MAX_ACTIVE_SURVIVORS) throw new GameError("A match needs 1-12 active survivors");
    if (active.some(id => !CAST.find(c => c.id === id))) throw new GameError("Unknown character");

    const unselected = CAST.map(c => c.id).filter(id => !active.includes(id));
    this.birthday = unselected[Math.floor(this.rand() * unselected.length)];
    this.photographer = active[Math.floor(this.rand() * active.length)];

    let spot = 2;
    for (const id of active) this.actors.set(id, this.makeActor(id, "alive", standingSpot("portrait", spot++), setup.cpu.has(id), true, false));
    this.actors.set(this.birthday, this.makeActor(this.birthday, "alive", standingSpot("portrait", 0), true, false, true));
    this.actors.set("elias", this.makeActor("elias", "infected", standingSpot("portrait", 1), true, false, false));
    this.camera = { holder: this.photographer, pos: CAMERA_START.pos, zone: "portrait", room: "portrait", readyAt: 0 };

    this.startedAt = now;
    this.lastTick = now;
    this.emit({ type: "phase", to: ["*"], phase: "opening" });
    // Opening continuity: the bite happens ~5 s after the flash; the camera drops intact.
    this.schedule(now + 17_000, () => {
      const b = this.get(this.birthday);
      b.status = "infected";
      this.infectionLog.push({ victim: this.birthday, by: "elias", room: "portrait", atSec: 0 });
      this.emit({ type: "bite", to: ["*"], victim: this.birthday, hunter: "elias", opening: true });
    });
    // After the bite Elias walks (he never teleports) to the intercom at the Garden Gate
    // and takes up position in its doorway for the announcement.
    this.schedule(now + 19_000, () => { this.beginIntent(this.get("elias"), { kind: "block", door: "exit" }, now + 19_000); });
    this.schedule(now + 17_500, () => {
      this.camera = { ...this.camera, holder: null, pos: CAMERA_START.pos, zone: "portrait", room: "portrait" };
      this.emit({ type: "camera_drop", to: ["*"], opening: true });
    });
  }

  private makeActor(id: ActorId, status: Status, pos: Vec2, cpu: boolean, active: boolean, birthday: boolean): Actor {
    return {
      id, status, active, birthday, cpu, score: 0, pos: [...pos] as Vec2, zone: "portrait", room: "portrait", yaw: 90,
      path: [], pace: "walk", intent: { kind: "idle" }, intentSeq: 0, intentState: "done", intentReason: null, lastIntentAt: -Infinity,
      hide: null, hideState: "none", hideTimer: 0, afterLeave: null, peeking: false,
      stunnedUntil: 0, stunKind: null, snareImmuneUntil: 0, grabbedBy: null, grabbing: null, biteAt: 0, searching: null, blocking: null, viewing: null, steer: null,
      snares: 0, clues: new Set(), clueNotes: new Map(), pending: null, struggle: null, breaks: 0, grabImmuneUntil: 0,
      ai: { nextThinkAt: 0, sawHide: [], heard: null, hideUntil: 0, blockUntil: 0, lastSeen: null, lastSearched: new Map(), replanAt: 0, guardUntil: 0, nextGuardAt: Infinity, committedUntil: 0, chaseUntil: 0, ignore: new Map(), windup: null },
    };
  }

  // ------------------------------------------------------------------ helpers
  private emit(e: GameEvent) { this.events.push(e); }
  drainEvents(): GameEvent[] { const e = this.events; this.events = []; return e; }
  private schedule(at: number, run: () => void) { this.scheduled.push({ at, run }); this.scheduled.sort((a, b) => a.at - b.at); }
  private pick<T>(xs: T[]): T { return xs[Math.floor(this.rand() * xs.length)]; }

  get(id: ActorId): Actor {
    const a = this.actors.get(id);
    if (!a) throw new GameError("Unknown actor");
    return a;
  }
  survivors(): Actor[] { return [...this.actors.values()].filter(a => a.active && a.status === "alive"); }
  hunters(): Actor[] { return [...this.actors.values()].filter(a => a.status === "infected"); }
  isSurvivor(id: ActorId) { const a = this.actors.get(id); return !!a && a.active && a.status === "alive"; }
  isHunter(id: ActorId) { return this.actors.get(id)?.status === "infected"; }
  private stunned(a: Actor, now: number) { return a.stunnedUntil > now; }
  private concealed(a: Actor) { return a.hideState === "hidden" || a.hideState === "leaving"; }
  private exposed(a: Actor) { return !this.concealed(a) || a.peeking; }
  private graceOver(now: number) { return this.phase === "hunt" && now >= this.huntStartedAt + TUNING.lockdownGraceMs; }
  private huntSec(now: number) { return this.huntStartedAt ? Math.max(0, Math.round((now - this.huntStartedAt) / 1000)) : 0; }

  /** Can `viewer` perceive `target` right now (sight only, never through cover)? */
  perceives(viewer: Actor, target: Actor): boolean {
    if (viewer === target) return true;
    if (target.status === "escaped" || viewer.status === "escaped") return false;
    if (this.concealed(target)) {
      if (!target.peeking) return false;
      if (viewer.zone !== target.zone || dist(viewer.pos, target.pos) > TUNING.peekExposureRange) return false;
    }
    return canSee(viewer.pos, viewer.zone, target.pos, target.zone);
  }
  perceivers(target: Actor): Actor[] {
    return [...this.actors.values()].filter(v => v !== target && this.perceives(v, target));
  }
  private witnessesOf(...xs: Actor[]): ActorId[] {
    const ids = new Set<ActorId>(xs.map(x => x.id));
    for (const x of xs) for (const v of this.perceivers(x)) ids.add(v.id);
    return [...ids];
  }
  private pointVisibleTo(v: Actor, p: Vec2, zone: ZoneId) { return v.status !== "escaped" && canSee(v.pos, v.zone, p, zone); }

  /** Is `target`'s infection readable by `viewer` (a face seen close, or an obvious attack)? */
  revealed(viewer: Actor, target: Actor, now: number): boolean {
    if (target.status !== "infected") return false;
    if (target.id === "elias" || target.birthday || viewer.status === "infected" || viewer === target) return true;
    // Only infected people freeze under a flash or thrash in a snare: that gives them away.
    if (target.grabbing || (this.stunned(target, now) && target.stunKind !== "turning")) return true;
    if (target.searching && viewer.hide === target.searching.spot) return true;
    return dist(viewer.pos, target.pos) <= TUNING.revealDistance;
  }

  // ------------------------------------------------------------------ clock
  tick(now: number): void {
    const dt = Math.min(0.5, Math.max(0, (now - this.lastTick) / 1000));
    this.lastTick = now;
    while (this.scheduled.length && this.scheduled[0].at <= now) this.scheduled.shift()!.run();
    if (this.phase === "ended") return;
    if (this.phase === "opening") {
      // Only scripted movement happens during the opening (Elias walking to the gate).
      for (const a of this.actors.values()) if (a.path.length) this.step(a, now, dt);
      if (now >= this.startedAt + TUNING.openingMs) this.startHunt(now);
      return;
    }
    // Intercom warnings before the final lockdown (public: everyone hears the intercom).
    for (const w of TUNING.deadlineWarningsMs) {
      if (!this.warningsSent.has(w) && this.huntEndsAt - now <= w) {
        this.warningsSent.add(w);
        this.emit({ type: "deadline_warning", to: ["*"], leftMs: w });
      }
    }
    if (!this.exitOpen && now >= this.exitOpensAt) {
      this.exitOpen = true;
      this.emit({ type: "exit_open", to: ["*"] });
    }
    // Taps queued during the move cooldown: the last one is applied once it expires.
    for (const a of this.actors.values()) {
      const q = a.pending;
      if (!q || now < q.at) continue;
      a.pending = null;
      try { this.setIntent(a.id, q.intent, now, q.pace); } catch (e) {
        if (e instanceof GameError && !a.cpu) this.emit({ type: "interrupted", to: [a.id], reason: e.message });
      }
    }
    for (const a of this.actors.values()) {
      if (!a.cpu || a.status === "escaped") continue;
      // CPU survivors react at once to a hunter they can recognise close by.
      if (a.status === "alive" && now < a.ai.nextThinkAt && now >= a.ai.committedUntil - 3500
        && this.hunters().some(h => !this.stunned(h, now) && dist(h.pos, a.pos) < 5 && this.perceives(a, h) && this.revealed(a, h, now))) a.ai.nextThinkAt = now;
      if (now >= a.ai.nextThinkAt) this.think(a, now);
    }
    for (const a of this.actors.values()) this.step(a, now, dt);
    this.triggerSnares(now);
    this.resolveGrabs(now);
    this.checkEnd(now);
  }

  /** Test support: finish the opening now, running its scheduled beats (bite, camera drop). */
  fastForwardOpening(now: number) {
    if (this.phase !== "opening") return;
    for (const s of this.scheduled.splice(0)) s.run();
    this.startedAt = now - TUNING.openingMs;
  }

  get phaseEndsAt() {
    return this.phase === "opening" ? this.startedAt + TUNING.openingMs : this.phase === "hunt" ? this.huntEndsAt : 0;
  }

  private startHunt(now: number) {
    this.phase = "hunt";
    this.huntStartedAt = now;
    this.huntEndsAt = now + TUNING.huntMaxMs;
    this.exitOpensAt = now + TUNING.exitOpensAfterMs;
    // The Garden Gate is simply open when there is no unlock delay (no "released" event).
    if (TUNING.exitOpensAfterMs <= 0) this.exitOpen = true;
    const range = ([lo, hi]: number[]) => lo + this.rand() * (hi - lo);
    const elias = this.get("elias");
    elias.ai.guardUntil = now + range(TUNING.eliasFirstGuardMs);
    elias.ai.nextGuardAt = elias.ai.guardUntil + range(TUNING.eliasGuardGapMs);
    for (const a of this.actors.values()) {
      a.ai.nextThinkAt = now + 300 + this.rand() * 1500;
      if (a.status === "infected" && !a.cpu) this.emit({ type: "you_turned", to: [a.id], by: "elias" });
    }
    this.emit({ type: "phase", to: ["*"], phase: "hunt" });
  }

  // ------------------------------------------------------------------ intents (validated player actions)
  private allowedRooms(a: Actor): RoomId[] {
    if (isRoom(a.zone)) return [a.zone, ...ROOM_GRAPH[a.zone]];
    return roomsOf(a.zone);
  }

  setPace(id: ActorId, pace: Pace) {
    const a = this.get(id);
    if (pace !== "walk" && pace !== "run") throw new GameError("Walk or run");
    a.pace = pace;
  }

  /**
   * Validate and start a movement/action intent. Returns the intent sequence number.
   * Move/room taps inside the cooldown are queued (the last one wins) instead of refused.
   */
  setIntent(id: ActorId, intent: Intent, now: number, pace?: Pace): number {
    if (this.phase !== "hunt") throw new GameError(this.phase === "opening" ? "Wait for the lockdown" : "The night is over");
    const a = this.get(id);
    if (a.status === "escaped") throw new GameError("You're already out");
    if (a.grabbedBy) throw new GameError("You're caught — tap to break free");
    if (this.stunned(a, now)) throw new GameError(a.stunKind === "tangled" ? "You're tangled in the rope" : a.stunKind === "turning" ? "You're still turning…"
      : a.stunKind === "shoved" ? "You're staggering back" : "You're frozen by the flash");
    if (a.grabbing) throw new GameError("You're holding someone");
    if (pace !== undefined && pace !== "walk" && pace !== "run") throw new GameError("Walk or run");
    const travel = intent?.kind === "move" || intent?.kind === "room";
    const cooling = now - a.lastIntentAt < TUNING.intentCooldownMs;
    if (cooling && !travel) throw new GameError("One move at a time");
    const checked = this.checkIntent(a, intent);
    if (cooling) {
      // Re-validated from wherever the character is when the cooldown ends.
      a.pending = { intent, pace, at: a.lastIntentAt + TUNING.intentCooldownMs };
      return a.intentSeq + 1;
    }
    a.pending = null;
    if (pace) a.pace = pace;
    a.lastIntentAt = now;
    this.beginIntent(a, checked, now);
    return a.intentSeq;
  }

  /** Throws a GameError if the intent isn't allowed now; returns it normalised (taps resolved). */
  private checkIntent(a: Actor, intent: Intent): Intent {
    const hunter = a.status === "infected";
    const rooms = this.allowedRooms(a);
    switch (intent?.kind) {
      case "idle": break;
      case "move": return this.resolveMove(a, intent.p);
      case "room":
        if (!rooms.includes(intent.room)) throw new GameError("That room isn't reachable from here");
        if (intent.p != null) {
          if (!validVec(intent.p)) throw new GameError("Bad position");
          return { kind: "room", room: intent.room, p: [intent.p[0], intent.p[1]] };
        }
        return { kind: "room", room: intent.room };
      case "hide": {
        if (hunter) throw new GameError("Hunters don't hide");
        const h = hideSpot(intent.spot);
        if (!h || !rooms.includes(h.room)) throw new GameError("That hiding place isn't reachable from here");
        break;
      }
      case "exit":
        if (hunter) throw new GameError("Hunters don't leave");
        if (!rooms.includes(EXIT_ROOM) && a.zone !== "exit") throw new GameError("The Garden Gate is in the Sealed Exhibition Room");
        break;
      case "pickup":
        if (hunter) throw new GameError("Hunters can't use the camera");
        if (this.camera.holder || !this.pointVisibleTo(a, this.camera.pos, this.camera.zone)) throw new GameError("You can't see the camera");
        break;
      case "search": {
        if (!hunter) throw new GameError("Only hunters search hiding places");
        if (!isRoom(a.zone) || !hideIds(a.zone).includes(intent.spot)) throw new GameError("Search a hiding place in this room");
        break;
      }
      case "block": {
        if (!hunter) throw new GameError("Only hunters block doorways");
        const d = DOORWAYS.find(x => x.key === intent.door);
        if (!d || !isRoom(a.zone) || d.room !== a.zone) throw new GameError("Block a doorway of the room you're in");
        break;
      }
      case "chase": {
        if (!hunter) throw new GameError("Only hunters chase");
        const t = this.actors.get(intent.target);
        if (!t || t.status === "infected" || !this.perceives(a, t)) throw new GameError("You can't see them");
        break;
      }
      case "gallery": {
        if (hunter) throw new GameError("Hunters don't browse the gallery");
        const st = GALLERY.find(g => g.id === intent.station);
        if (!st || !this.galleryStations(a).includes(st)) throw new GameError("Walk along the Portrait Corridor to view that part of the gallery");
        break;
      }
      case "goto":
        // Internal: CPU players investigating a sound or a last-seen position.
        if (!a.cpu) throw new GameError("Unknown action");
        break;
      default: throw new GameError("Unknown action");
    }
    return intent;
  }

  /**
   * A tap on the floor. Inside your own zone (room or passage) you walk there, nudged off
   * furniture and walls by up to TUNING.moveSnapRange; a tap inside a reachable neighbouring
   * room travels there and stops at that point; the Garden Gate passage means leaving.
   */
  private resolveMove(a: Actor, p: unknown): Intent {
    if (!validVec(p)) throw new GameError("Bad position");
    const z = zoneAt(p);
    const rooms = this.allowedRooms(a);
    if (z && z !== a.zone && isRoom(z) && rooms.includes(z)) return { kind: "room", room: z, p: [p[0], p[1]] };
    if (z === "exit" && a.zone !== "exit" && a.status === "alive" && rooms.includes(EXIT_ROOM)) return { kind: "exit" };
    const q = nearestStandable(a.zone, p, TUNING.moveSnapRange);
    if (q) return { kind: "move", p: q, zone: a.zone };
    if (z && z !== a.zone) throw new GameError("That isn't reachable from here");
    throw new GameError("You can't stand there");
  }

  private beginIntent(a: Actor, intent: Intent, now: number) {
    a.intentSeq += 1;
    a.intent = intent;
    a.intentState = "accepted";
    a.intentReason = null;
    a.searching = null;
    a.viewing = null;
    a.steer = null;
    if (a.blocking) { a.blocking = null; }
    a.peeking = false;
    // Leaving cover takes a moment; the journey starts once the character is out.
    if (a.hideState === "hidden" || a.hideState === "entering") {
      if (intent.kind === "hide" && intent.spot === a.hide) { a.intentState = "done"; return; }
      if (intent.kind === "idle") { a.intentState = "done"; return; }
      a.hideState = "leaving";
      a.hideTimer = now + TUNING.leaveCoverMs;
      a.afterLeave = intent;
      a.path = [];
      return;
    }
    if (a.hideState === "leaving") { a.afterLeave = intent; return; }
    this.planFor(a, intent, now);
  }

  private planFor(a: Actor, intent: Intent, now: number) {
    let dest: { zone: ZoneId; p: Vec2 } | null = null;
    switch (intent.kind) {
      case "idle": a.path = []; a.intentState = "done"; return;
      case "move": dest = { zone: intent.zone ?? a.zone, p: intent.p }; break;
      case "room": {
        // A tapped point in that room; else phones stop just inside the entry doorway
        // (CPU players still spread out over the room).
        const p = intent.p ? nearestWalkable(intent.room, intent.p, TUNING.moveSnapRange) : null;
        dest = { zone: intent.room, p: p ?? (a.cpu ? this.arrivalPoint(intent.room, a) : this.entryPoint(a, intent.room)) };
        break;
      }
      case "hide": {
        const h = hideSpot(intent.spot)!;
        if (this.walkableSpot(h)) {
          // Standing room behind furniture (a rack, a cabinet): walk all the way in around it.
          const route = planRoute(a.pos, a.zone, { zone: h.room, p: h.spot.pos });
          if (!route) return this.interrupt(a, "No route");
          a.path = route;
          return;
        }
        // Under/inside furniture: walk to its open side, then crawl straight in.
        const approach = frontOf(h.spot);
        const route = planRoute(a.pos, a.zone, { zone: h.room, p: approach });
        if (!route) return this.interrupt(a, "No route");
        a.path = [...route, { p: h.spot.pos }];
        return;
      }
      case "exit": dest = { zone: "exit", p: EXIT_POINT }; break;
      case "pickup": dest = { zone: this.camera.zone, p: this.camera.pos }; break;
      case "search": {
        const h = hideSpot(intent.spot)!;
        dest = { zone: h.room, p: this.searchStand(h) };
        break;
      }
      case "block": dest = { zone: a.zone, p: blockSpot(intent.door)! }; break;
      case "chase": {
        const t = this.get(intent.target);
        dest = { zone: t.zone, p: t.pos };
        a.ai.lastSeen = { p: [...t.pos] as Vec2, zone: t.zone, at: now };
        break;
      }
      case "goto": dest = { zone: intent.zone, p: intent.p }; break;
      case "gallery": dest = { zone: "corridor", p: GALLERY.find(g => g.id === intent.station)!.pos }; break;
    }
    const route = dest && planRoute(a.pos, a.zone, dest);
    if (!route) return this.interrupt(a, "No route");
    a.path = route;
  }

  private arrivalPoint(room: RoomId, a: Actor): Vec2 {
    if (room === a.zone) return a.pos;
    const [x, z] = standingSpot(room, Math.floor(this.rand() * 16));
    return [x + (this.rand() - 0.5), z + (this.rand() - 0.5)];
  }

  /**
   * Where a phone player arriving in `room` stops: about 1.5 m inside the doorway they come
   * through, stepping a little to the side if someone already stands (or is heading) there.
   */
  private entryPoint(a: Actor, room: RoomId): Vec2 {
    if (room === a.zone) return a.pos;
    const e = entryOf(a.pos, a.zone, room);
    if (!e) return this.arrivalPoint(room, a);
    const d = TUNING.entryStopDistance;
    const base: Vec2 = [e.door[0] + e.inward[0] * d, e.door[1] + e.inward[1] * d];
    const side: Vec2 = [-e.inward[1], e.inward[0]];
    const taken = (p: Vec2) => [...this.actors.values()].some(o => o !== a && o.status !== "escaped" && !this.concealed(o)
      && ((o.zone === room && dist(o.pos, p) < 0.7) || (o.path.length > 0 && dist(o.path[o.path.length - 1].p, p) < 0.7)));
    for (const k of [0, 0.8, -0.8, 1.6, -1.6]) {
      const c = nearestWalkable(room, [base[0] + side[0] * k, base[1] + side[1] * k], 0.6);
      if (c && !taken(c)) return c;
    }
    return nearestWalkable(room, base) ?? base;
  }

  /** A hiding place with standing room (behind a rack or cabinet), not inside a piece of furniture. */
  private walkableSpot(h: { room: RoomId; spot: HideSpot }) {
    return hasObstacles(h.room) && isWalkable(h.room, h.spot.pos);
  }

  private mouthCache = new Map<string, Vec2>();
  /**
   * The way into a standing-room hiding place: the point `d` metres from the hider back along
   * the walk in (towards the cover's open side). Searchers stand here and snares land here.
   */
  private coverMouth(h: { room: RoomId; spot: HideSpot }, d: number): Vec2 {
    const key = `${h.spot.id}:${d}`;
    const hit = this.mouthCache.get(key);
    if (hit) return hit;
    let prev: Vec2 = h.spot.pos, left = d, out: Vec2 | null = null;
    for (const p of roomPath(h.room, h.spot.pos, frontOf(h.spot)) ?? []) {
      const l = dist(prev, p);
      if (l >= left) { out = toward(prev, p, left); break; }
      left -= l; prev = p;
    }
    out = out ?? prev;
    this.mouthCache.set(key, out);
    return out;
  }

  /** Where a searcher stands to search a hiding place. */
  private searchStand(h: { room: RoomId; spot: HideSpot }): Vec2 {
    return this.walkableSpot(h) ? this.coverMouth(h, TUNING.searchStandDistance) : frontOf(h.spot);
  }

  /** Where someone climbing out of cover ends up: out on the open side, never inside furniture. */
  private outOfCover(h: { room: RoomId; spot: HideSpot }, pos: Vec2): Vec2 {
    if (this.walkableSpot(h)) return pos;
    const p = frontOf(h.spot, 0.35);
    return hasObstacles(h.room) ? nearestWalkable(h.room, p) ?? p : p;
  }

  /** Snap a point off furniture when it lies in a furnished room (other rooms: unchanged). */
  private offFurniture(p: Vec2): Vec2 {
    const z = zoneAt(p);
    return z && isRoom(z) && hasObstacles(z) ? nearestWalkable(z, p) ?? p : p;
  }

  private interrupt(a: Actor, reason: string) {
    a.path = [];
    a.intentState = "interrupted";
    a.intentReason = reason;
    if (!a.cpu) this.emit({ type: "interrupted", to: [a.id], reason });
  }
  private complete(a: Actor) { a.intentState = "done"; a.path = []; }

  // ------------------------------------------------------------------ movement and actions
  private speed(a: Actor): number {
    if (a.id === "elias") return TUNING.eliasSpeed;
    if (a.status === "infected") return a.pace === "run" ? TUNING.zombieRunSpeed : TUNING.zombieWalkSpeed;
    return a.pace === "run" ? TUNING.runSpeed : TUNING.walkSpeed;
  }

  /** Is this doorway physically plugged by a hunter standing in it (for survivors)? */
  private doorBlockedFor(a: Actor, door: string, now: number): Actor | null {
    if (a.status !== "alive") return null;
    for (const h of this.hunters()) {
      // Blocking is physical: the hunter must actually be standing in that doorway.
      const d = DOORWAYS.find(x => x.key === door);
      if (h.blocking === door && !this.stunned(h, now) && !h.path.length && d && dist(h.pos, d.pos) < 1.6) return h;
    }
    return null;
  }

  private step(a: Actor, now: number, dt: number) {
    if (a.status === "escaped" || this.phase === "ended") return;
    if (this.stunned(a, now)) { a.path = []; return; }
    if (a.stunKind && !this.stunned(a, now)) {
      a.stunKind = null;
      this.emit({ type: "recovered", to: this.witnessesOf(a), id: a.id });
    }

    // Cover transitions.
    if (a.hideState === "entering" && now >= a.hideTimer) {
      a.hideState = "hidden";
      // Hunters who watched them get in know where they went; nobody else does.
      for (const h of this.hunters()) if (this.perceivesAtCover(h, a)) h.ai.sawHide.push({ spot: a.hide!, at: now });
      if (!a.cpu) this.emit({ type: "hidden", to: [a.id], spot: a.hide });
    }
    if (a.hideState === "leaving" && now >= a.hideTimer) {
      a.hideState = "none";
      // Out on the open side of the cover (not left standing inside the bed or wardrobe).
      const hs = a.hide ? hideSpot(a.hide) : null;
      if (hs) { a.pos = this.outOfCover(hs, a.pos); this.updateZone(a); }
      a.hide = null;
      const next = a.afterLeave; a.afterLeave = null;
      this.emit({ type: "left_cover", to: this.witnessesOf(a), id: a.id });
      if (next) this.planFor(a, next, now);
    }
    if (a.grabbedBy || a.grabbing) { a.path = []; return; }

    // Searching a hiding place.
    if (a.searching) {
      if (now >= a.searching.until) this.finishSearch(a, now);
      return;
    }

    // Chasers re-aim at a target they can still see.
    if (a.intent.kind === "chase" && a.intentState === "accepted" && (!a.path.length || now >= a.ai.replanAt)) {
      a.ai.replanAt = now + 400;
      const t = this.actors.get(a.intent.target)!;
      if (t.status === "alive" && this.perceives(a, t)) {
        a.ai.lastSeen = { p: [...t.pos] as Vec2, zone: t.zone, at: now };
        const route = planRoute(a.pos, a.zone, { zone: t.zone, p: t.pos });
        if (route) a.path = route;
      } else if (!a.path.length) {
        this.complete(a);
      }
    }

    if (a.steer) {
      if (now >= a.steer.until) a.steer = null;
      else if (a.hideState === "none") { this.steerStep(a, now, dt); return; }
    }
    if (!a.path.length) return;
    let budget = this.speed(a) * dt;
    while (budget > 0 && a.path.length) {
      const wp = a.path[0];
      if (wp.door) {
        const blocker = this.doorBlockedFor(a, wp.door, now);
        if (blocker && dist(a.pos, wp.p) <= TUNING.blockedStopDistance + 0.05) {
          // Physically stopped short of a doorway someone is standing in.
          this.interrupt(a, "Someone is standing in the doorway");
          return;
        }
      }
      const d = dist(a.pos, wp.p);
      if (d > 1e-3) a.yaw = Math.atan2(wp.p[0] - a.pos[0], wp.p[1] - a.pos[1]) * 180 / Math.PI;
      if (d <= budget) {
        a.pos = [wp.p[0], wp.p[1]];
        budget -= d;
        a.path.shift();
        if (wp.door) this.updateZone(a);
      } else {
        a.pos = toward(a.pos, wp.p, budget);
        budget = 0;
        // Stop at the blocked-doorway distance rather than walking into the blocker.
        if (wp.door && this.doorBlockedFor(a, wp.door, now) && dist(a.pos, wp.p) < TUNING.blockedStopDistance) {
          a.pos = toward(wp.p, a.pos, TUNING.blockedStopDistance);
        }
      }
    }
    this.updateZone(a);
    if (!a.path.length) this.arrive(a, now);
  }

  private perceivesAtCover(h: Actor, a: Actor) {
    return h.status === "infected" && canSee(h.pos, h.zone, a.pos, a.zone);
  }

  private updateZone(a: Actor) {
    const z = zoneAt(a.pos);
    if (z) { a.zone = z; if (isRoom(z)) a.room = z; }
  }

  private arrive(a: Actor, now: number) {
    const intent = a.intent;
    switch (intent.kind) {
      case "hide": {
        const inSpot = this.actorsHiddenAt(intent.spot).filter(x => x !== a);
        if (inSpot.length >= TUNING.hideCapacity) {
          // Full: back out onto the floor rather than stand inside the furniture.
          const hs = hideSpot(intent.spot);
          if (hs && hasObstacles(hs.room)) { a.pos = this.outOfCover(hs, a.pos); this.updateZone(a); }
          return this.interrupt(a, "There's no room left in there");
        }
        a.hide = intent.spot;
        a.hideState = "entering";
        a.hideTimer = now + TUNING.enterCoverMs;
        this.emit({ type: "took_cover", to: this.witnessesOf(a), id: a.id, spot: intent.spot });
        return this.complete(a);
      }
      case "exit":
        if (!this.exitOpen) return this.interrupt(a, "The Garden Gate is still locked");
        this.escape(a, now);
        return;
      case "pickup":
        if (!this.camera.holder && dist(a.pos, this.camera.pos) <= TUNING.pickupReach + 0.3) {
          this.camera.holder = a.id as CharacterId;
          this.emit({ type: "camera_pickup", to: this.witnessesOf(a), by: a.id });
          return this.complete(a);
        }
        return this.interrupt(a, "The camera isn't here any more");
      case "search": {
        a.searching = { spot: intent.spot, until: now + (this.testSearchMs ?? TUNING.searchMs) };
        // Face the hiding place (to look under / behind / into it).
        const hs = hideSpot(intent.spot);
        if (hs && this.walkableSpot(hs) && dist(hs.spot.pos, a.pos) > 1e-3) a.yaw = Math.atan2(hs.spot.pos[0] - a.pos[0], hs.spot.pos[1] - a.pos[1]) * 180 / Math.PI;
        else if (hs) a.yaw = (hs.spot.look + 180) % 360;
        a.ai.lastSearched.set(intent.spot, now);
        this.emit({ type: "searching", to: this.witnessesOf(a, ...this.actorsHiddenAt(intent.spot)), id: a.id, spot: intent.spot });
        return;
      }
      case "gallery": {
        // Stop at the wall and look at it. The timer keeps running and the viewer stays in the open.
        const st = GALLERY.find(g => g.id === intent.station)!;
        a.viewing = st.id;
        a.yaw = st.look;
        return this.complete(a);
      }
      case "block":
        a.blocking = intent.door;
        a.intentState = "done";
        this.emit({ type: "blocking", to: this.witnessesOf(a), id: a.id, door: intent.door });
        return;
      case "chase":
        return; // re-aimed each tick
      default:
        return this.complete(a);
    }
  }

  actorsHiddenAt(spot: string): Actor[] {
    return [...this.actors.values()].filter(x => x.status === "alive" && x.hide === spot && x.hideState !== "none");
  }

  private finishSearch(h: Actor, now: number) {
    const spot = h.searching!.spot;
    h.searching = null;
    h.intentState = "done";
    const found = this.actorsHiddenAt(spot);
    for (const v of found) {
      v.hide = null; v.hideState = "none"; v.peeking = false; v.afterLeave = null;
      // Pulled out of cover to the open side, right in front of the searcher (never into furniture).
      v.pos = this.offFurniture(toward(h.pos, v.pos, Math.min(0.45, dist(h.pos, v.pos))));
      this.updateZone(v);
      if (v.cpu) v.ai.nextThinkAt = now;
    }
    this.emit({ type: "search_done", to: this.witnessesOf(h, ...found), id: h.id, spot, found: found.map(f => f.id) });
  }

  // ------------------------------------------------------------------ grabs, struggles, bites, infection
  private resolveGrabs(now: number) {
    for (const h of this.hunters()) {
      if (h.grabbing) {
        const v = this.get(h.grabbing);
        if (v.struggle) this.updateStruggle(v, now);
        if (h.grabbing && now >= h.biteAt) this.infect(v, h, now);
        continue;
      }
      if (this.stunned(h, now) || h.searching) { h.ai.windup = null; continue; }
      if ((h.id === "elias" || h.birthday) && !this.graceOver(now)) { h.ai.windup = null; continue; }
      const prey = this.survivors().filter(s => !s.grabbedBy && s.grabImmuneUntil <= now && this.exposed(s)
        && dist(s.pos, h.pos) <= TUNING.grabDistance && this.perceives(h, s));
      if (!prey.length) { h.ai.windup = null; continue; }
      const v = prey.sort((x, y) => dist(x.pos, h.pos) - dist(y.pos, h.pos))[0];
      // The lunge: stay within reach for a moment (a survivor who keeps running breaks it).
      if (!h.ai.windup || h.ai.windup.target !== v.id) { h.ai.windup = { target: v.id, since: now }; continue; }
      if (now - h.ai.windup.since < TUNING.grabWindupMs) continue;
      this.startGrab(h, v, now);
    }
  }

  /**
   * The grab lands. The bite follows TUNING.biteDelayMs later (unchanged, so a friend's flash
   * has the same window); during the first TUNING.struggleMs the victim can tap to break free.
   */
  private startGrab(h: Actor, v: Actor, now: number) {
    h.ai.windup = null;
    h.grabbing = v.id; h.biteAt = now + TUNING.biteDelayMs; h.path = []; h.blocking = null; h.pending = null;
    v.grabbedBy = h.id; v.path = []; v.peeking = false; v.viewing = null; v.steer = null; v.pending = null;
    // Caught halfway into cover: dragged out of the furniture.
    if (v.hideState !== "none") { v.hideState = "none"; v.hide = null; v.afterLeave = null; v.pos = this.offFurniture(v.pos); this.updateZone(v); }
    v.intentState = "interrupted"; v.intentReason = "Caught";
    const need = this.testStruggleNeed ?? TUNING.struggleNeed + (h.id === "elias" ? TUNING.struggleNeedElias : 0) + TUNING.struggleNeedPerBreak * v.breaks;
    const s: Struggle = {
      grabId: this.newId(), by: h.id, startedAt: now, until: now + TUNING.struggleMs, need, got: 0, reported: 0, cpuRate: 0, cpuTaps: 0, cpuAt: now,
    };
    v.struggle = s;
    this.emit({ type: "grabbed", to: this.witnessesOf(h, v), victim: v.id, hunter: h.id });
    this.emit({ type: "struggle", to: [v.id], grabId: s.grabId, by: h.id, until: s.until, need: s.need });
  }

  /**
   * Taps reported by the victim's phone: `n` is its cumulative count for this grab. The server
   * credits at most TUNING.struggleMaxTapsPerSec since the grab and decides the outcome.
   * Returns false for a stale or malformed report (ignored).
   */
  struggle(id: ActorId, grabId: string, n: number, now: number): boolean {
    if (this.phase !== "hunt") return false;
    const v = this.actors.get(id);
    const s = v?.struggle;
    if (!v || !s || s.grabId !== grabId || !Number.isFinite(n)) return false;
    if (now > s.until + TUNING.struggleGraceMs) return false;
    const taps = Math.min(1000, Math.floor(n));
    if (taps <= s.reported) return false;
    s.reported = taps;
    this.creditStruggle(v, now);
    return true;
  }

  private updateStruggle(v: Actor, now: number) {
    const s = v.struggle!;
    const t = Math.min(now, s.until);
    if (v.cpu) {
      // CPU survivors tap at their own steady pace.
      if (!s.cpuRate) { const [lo, hi] = TUNING.cpuTapRate; s.cpuRate = lo + this.rand() * (hi - lo); }
      s.cpuTaps += s.cpuRate * Math.max(0, t - s.cpuAt) / 1000;
    }
    s.cpuAt = Math.max(s.cpuAt, t);
    this.creditStruggle(v, now);
  }

  private creditStruggle(v: Actor, now: number) {
    const s = v.struggle!;
    if (now > s.until + TUNING.struggleGraceMs) return;
    const elapsed = Math.max(0, Math.min(now, s.until) - s.startedAt);
    const cap = Math.floor(elapsed * TUNING.struggleMaxTapsPerSec / 1000) + 1;
    s.got = Math.max(s.got, Math.min(cap, s.reported + Math.floor(s.cpuTaps)));
    if (s.got >= s.need) this.breakFree(v, now);
  }

  /** The victim wrenches free: the hunter staggers back (can't grab for a moment) and nobody can grab the victim right away. */
  private breakFree(v: Actor, now: number) {
    const s = v.struggle!;
    const h = this.get(s.by);
    v.struggle = null;
    v.breaks += 1;
    v.grabImmuneUntil = now + TUNING.grabImmunityMs;
    this.disable(h, "shoved", TUNING.shoveStunMs, now, null, "camera_stun");
    // Pushed back half a step, if there is floor there.
    if (isRoom(h.zone)) {
      const back = toward(v.pos, h.pos, dist(v.pos, h.pos) + 0.5);
      if (zoneAt(back) === h.zone && isWalkable(h.zone, back) && (!hasObstacles(h.zone) || clearLine(h.zone, h.pos, back))) h.pos = back;
      h.yaw = Math.atan2(v.pos[0] - h.pos[0], v.pos[1] - h.pos[1]) * 180 / Math.PI;
    }
    this.emit({ type: "broke_free", to: this.witnessesOf(v, h), id: v.id, from: h.id });
  }

  /** Test support (HG_TEST_HOOKS): make `hunter` grab `victim` now, standing them face to face if apart. */
  forceGrab(hunter: ActorId, victim: ActorId, now: number) {
    if (this.phase !== "hunt") throw new GameError("Not now");
    const h = this.get(hunter), v = this.get(victim);
    if (h.status !== "infected" || v.status !== "alive" || !v.active) throw new GameError("Pick a hunter and a survivor");
    if (h.grabbing || v.grabbedBy || this.stunned(h, now)) throw new GameError("Not now");
    if (dist(h.pos, v.pos) > TUNING.grabDistance) {
      const dirs: Vec2[] = [h.pos, [v.pos[0] + 1, v.pos[1]], [v.pos[0] - 1, v.pos[1]], [v.pos[0], v.pos[1] + 1], [v.pos[0], v.pos[1] - 1]];
      for (const d of dirs) {
        const p = toward(v.pos, d, 0.8);
        if (zoneAt(p) === v.zone && (!isRoom(v.zone) || isWalkable(v.zone, p))) { h.pos = p; break; }
      }
      if (dist(h.pos, v.pos) > TUNING.grabDistance) h.pos = [...v.pos] as Vec2;
      this.updateZone(h);
    }
    h.path = []; h.searching = null; h.intent = { kind: "idle" }; h.intentState = "done";
    this.startGrab(h, v, now);
  }

  private infect(v: Actor, h: Actor, now: number) {
    h.grabbing = null;
    v.grabbedBy = null;
    v.struggle = null; v.pending = null;
    v.status = "infected";
    v.hide = null; v.hideState = "none"; v.path = []; v.pace = "walk";
    v.intent = { kind: "idle" }; v.intentState = "done";
    v.stunnedUntil = now + TUNING.turningMs;
    v.stunKind = "turning";
    this.assists.delete(v.id as CharacterId);
    this.infectionLog.push({ victim: v.id, by: h.id, room: v.room, atSec: this.huntSec(now) });
    // Only people who actually see it happen learn about it. There is no announcement.
    this.emit({ type: "bite", to: this.witnessesOf(v, h), victim: v.id, hunter: h.id });
    this.emit({ type: "you_turned", to: [v.id], by: h.id });
    if (this.camera.holder === v.id) {
      this.camera = { ...this.camera, holder: null, pos: [...v.pos] as Vec2, zone: v.zone, room: v.room };
      this.emit({ type: "camera_drop", to: this.witnessesOf(v) });
    }
    v.ai.nextThinkAt = now + 1500;
  }

  /** Freeze/tangle/shove a hunter: it cannot attack, search or block, and it lets go. */
  private disable(h: Actor, kind: "frozen" | "tangled" | "shoved", ms: number, now: number, helper: Actor | null, method: Assist["method"]) {
    h.stunnedUntil = now + ms;
    h.stunKind = kind;
    h.path = [];
    h.searching = null;
    h.pending = null;
    h.ai.windup = null;
    h.intentState = "interrupted";
    const saved: ActorId[] = [];
    if (h.grabbing) {
      const v = this.get(h.grabbing);
      v.grabbedBy = null;
      v.struggle = null;
      h.grabbing = null;
      saved.push(v.id);
      if (helper && v.id !== helper.id && !this.assists.has(v.id as CharacterId)) {
        this.assists.set(v.id as CharacterId, { helper: helper.id as CharacterId, method, photographer: method === "camera_stun" ? helper.id as CharacterId : null });
      }
      v.intentState = "done";
      if (v.cpu) v.ai.nextThinkAt = now;
    }
    // A doorway blocker staggers clear so the opening is actually usable.
    if (h.blocking) {
      const s = staggerSpot(h.blocking);
      if (s) { h.pos = this.offFurniture(s); this.updateZone(h); }
      h.blocking = null;
    }
    return saved;
  }

  // ------------------------------------------------------------------ camera
  flash(id: ActorId, now: number) {
    if (this.phase !== "hunt") throw new GameError("Not now");
    const a = this.get(id);
    if (this.camera.holder !== id || a.status !== "alive") throw new GameError("You're not holding the camera");
    if (now < this.camera.readyAt) throw new GameError("The camera is recharging");
    this.camera.readyAt = now + TUNING.cameraRechargeMs;
    // Taking a photo from cover gives your position away.
    if (a.hideState !== "none") { a.hideState = "none"; a.hide = null; a.afterLeave = null; a.peeking = false; }
    const targets = this.hunters().filter(h => !this.stunned(h, now) && dist(h.pos, a.pos) <= TUNING.flashRange && this.perceives(a, h));
    const saved: ActorId[] = [];
    for (const h of targets) {
      saved.push(...this.disable(h, "frozen", TUNING.flashFreezeMs, now, a, "camera_stun"));
      // A hunter lunging at someone nearby misses them: that also counts as a camera assist.
      for (const s of this.survivors()) {
        if (s !== a && dist(s.pos, h.pos) <= 2.5 && !this.assists.has(s.id as CharacterId) && !saved.includes(s.id)) {
          this.assists.set(s.id as CharacterId, { helper: a.id as CharacterId, method: "camera_stun", photographer: a.id as CharacterId });
          saved.push(s.id);
        }
      }
    }
    this.emit({ type: "flash", to: this.witnessesOf(a), by: id, frozen: targets.map(t => t.id), until: now + TUNING.flashFreezeMs });
    return { frozen: targets.map(t => t.id), saved };
  }

  giveCamera(id: ActorId, to: ActorId) {
    const a = this.get(id), b = this.actors.get(to);
    if (this.camera.holder !== id) throw new GameError("You're not holding the camera");
    if (!b || b === a || b.status === "escaped" || !this.perceives(a, b) || dist(a.pos, b.pos) > TUNING.passReach) throw new GameError("Get closer to hand it over");
    if (a.grabbedBy || b.grabbedBy) throw new GameError("Not while someone is caught");
    // You are standing face to face, so you'd see a turned face: they won't take it.
    if (b.status !== "alive") throw new GameError("They don't reach for it");
    this.camera.holder = to as CharacterId;
    this.emit({ type: "camera_pass", to: this.witnessesOf(a, b), from: id, recipient: to });
  }

  dropCamera(id: ActorId) {
    const a = this.get(id);
    if (this.camera.holder !== id) throw new GameError("You're not holding the camera");
    this.camera = { ...this.camera, holder: null, pos: [...a.pos] as Vec2, zone: a.zone, room: a.room };
    this.emit({ type: "camera_drop", to: this.witnessesOf(a) });
  }

  // ------------------------------------------------------------------ peek, clues, snares
  peek(id: ActorId, on: boolean) {
    const a = this.get(id);
    if (a.status !== "alive") throw new GameError("Only survivors peek");
    if (a.hideState !== "hidden" && on) throw new GameError("Peek from cover");
    a.peeking = !!on && a.hideState === "hidden";
  }

  /** Clues within reach of where you are (including from inside the nearby cover). */
  cluesInReach(a: Actor): string[] {
    if (a.status !== "alive") return [];
    return CLUES.filter(c => c.room === a.room && a.zone === a.room && dist(c.pos, a.pos) <= TUNING.inspectReach).map(c => c.id);
  }

  inspect(id: ActorId, clueId: string, now: number) {
    const a = this.get(id);
    if (this.phase !== "hunt") throw new GameError("Not now");
    if (!this.cluesInReach(a).includes(clueId)) throw new GameError("It's out of reach from here");
    const c = CLUES.find(x => x.id === clueId)!;
    a.clues.add(c.id);
    let note = c.text;
    if (c.effect === "camera") {
      note += this.camera.holder ? " — It looks like someone picked it up." : ` — Last noted in the ${ROOMS[this.camera.room].name}.`;
    }
    if (c.effect === "exit") {
      const left = Math.max(0, Math.ceil((this.exitOpensAt - now) / 1000));
      note += this.exitOpen ? " The Garden Gate has already released." : ` The panel timer reads ${left} seconds.`;
    }
    if (c.effect === "snare") {
      if (!this.clueSnaresTaken.has(c.id)) {
        this.clueSnaresTaken.add(c.id);
        a.snares += 1;
        note += " You take the rope snare (1 use).";
      } else note += " The rope has already been taken.";
    }
    a.clueNotes.set(c.id, note);
    return note;
  }

  placeSnare(id: ActorId, now: number) {
    const a = this.get(id);
    if (this.phase !== "hunt" || a.status !== "alive") throw new GameError("Not now");
    if (a.snares < 1) throw new GameError("You don't have a snare");
    if (a.grabbedBy) throw new GameError("Not while caught");
    // From cover, rig it just outside your hiding place (in the way in, for standing-room cover).
    let pos: Vec2 = [...a.pos] as Vec2;
    if (a.hide) {
      const h = hideSpot(a.hide)!;
      pos = this.walkableSpot(h) ? this.coverMouth(h, TUNING.snareMouthDistance) : this.outOfCover(h, a.pos);
    }
    a.snares -= 1;
    const s: Snare = { id: this.newId(), owner: id as CharacterId, pos, zone: zoneAt(pos) ?? a.zone, placedAt: now };
    this.snares.push(s);
    this.emit({ type: "snare_set", to: this.witnessesOf(a), id: s.id });
  }

  private triggerSnares(now: number) {
    for (const s of [...this.snares]) {
      const h = this.hunters().find(x => !this.stunned(x, now) && x.snareImmuneUntil <= now && dist(x.pos, s.pos) <= TUNING.snareTriggerRadius);
      if (!h) continue;
      this.snares = this.snares.filter(x => x !== s);
      h.snareImmuneUntil = now + TUNING.snareStunMs + TUNING.snareImmunityMs;
      const owner = this.get(s.owner);
      this.disable(h, "tangled", TUNING.snareStunMs, now, owner.status === "alive" ? owner : null, "snare");
      this.emit({ type: "snared", to: this.witnessesOf(h), id: h.id, until: now + TUNING.snareStunMs });
    }
  }

  // ------------------------------------------------------------------ escape and end
  private escape(a: Actor, now: number) {
    a.status = "escaped";
    a.path = []; a.hide = null; a.hideState = "none"; a.pending = null;
    a.score += SCORE.escape;
    this.teamScore += SCORE.escape;
    const withCamera = this.camera.holder === a.id;
    this.escapeLog.push({ id: a.id as CharacterId, atSec: this.huntSec(now), withCamera });
    const aid = this.assists.get(a.id as CharacterId);
    if (aid && !this.rescuePaid.has(a.id as CharacterId)) {
      this.get(aid.helper).score += SCORE.rescue;
      this.teamScore += SCORE.rescue;
      this.rescuePaid.add(a.id as CharacterId);
      if (aid.photographer && !this.cameraAssistPaid.has(a.id as CharacterId)) {
        this.get(aid.photographer).score += SCORE.cameraAssist;
        this.cameraAssistPaid.add(a.id as CharacterId);
      }
      this.rescueLog.push({ victim: a.id as CharacterId, helper: aid.helper, method: aid.method, at: now });
      this.emit({ type: "rescue_paid", to: [aid.helper, a.id], victim: a.id, helper: aid.helper });
    }
    for (const s of this.sos) if (!s.cancelled && (s.sender === a.id || s.recipient === a.id)) s.cancelled = true;
    // Escapes are public (the headcount is shown to everyone); infection never is.
    this.emit({ type: "escape", to: ["*"], id: a.id });
  }

  private checkEnd(now: number) {
    const inside = this.survivors().length;
    if (inside > 0 && now < this.huntEndsAt) return;
    this.endReason = inside === 0 ? "all_resolved" : "lockdown";
    this.phase = "ended";
    this.endedAt = now;
    for (const s of this.sos) s.cancelled = true;
    this.emit({ type: "phase", to: ["*"], phase: "ended", reason: this.endReason });
  }

  // ------------------------------------------------------------------ SOS (cannot be used to test who turned)
  private sosActive(s: Sos, now: number) { return !s.cancelled && now - s.sentAt <= TUNING.sosLifetimeMs; }

  sendSos(sender: ActorId, recipient: ActorId, preset: SosPreset, now: number): Sos {
    if (this.phase !== "hunt") throw new GameError("SOS opens after the lockdown");
    if (!this.isSurvivor(sender)) throw new GameError("You can't send that now");
    const r = this.actors.get(recipient);
    if (!r || !r.active || r.status === "escaped" || recipient === sender) throw new GameError("Choose another guest inside");
    if (!(preset in SOS_PRESETS)) throw new GameError("Choose a preset message");
    if (this.sos.some(s => s.sender === sender && this.sosActive(s, now))) throw new GameError("You already have a request out");
    if (now - (this.lastSosAt.get(sender as CharacterId) ?? -Infinity) < TUNING.sosCooldownMs) throw new GameError("Wait a moment before asking again");
    const s: Sos = {
      id: this.newId(), sender: sender as CharacterId, recipient: recipient as CharacterId, preset,
      room: this.get(sender).room, sentAt: now, updatedAt: now,
      // Hunters don't receive survivor SOS; the sender just never hears back.
      delivered: r.status === "alive", reply: null, repliedAt: null, cancelled: false,
    };
    this.sos.push(s);
    this.lastSosAt.set(sender as CharacterId, now);
    if (s.delivered) this.emit({ type: "sos", to: [recipient], id: s.id });
    return s;
  }

  replySos(recipient: ActorId, sosId: string, reply: SosReply, now: number) {
    const s = this.sos.find(x => x.id === sosId);
    if (!s || s.recipient !== recipient || !s.delivered || !this.isSurvivor(recipient)) throw new GameError("That request isn't yours");
    if (!this.sosActive(s, now)) throw new GameError("That request has expired");
    if (reply !== "coming" && reply !== "cant") throw new GameError("Unknown reply");
    s.reply = reply;
    s.repliedAt = now;
    if (this.isSurvivor(s.sender)) this.emit({ type: "sos_reply", to: [s.sender], id: s.id });
  }

  updateSos(sender: ActorId, sosId: string, now: number) {
    const s = this.sos.find(x => x.id === sosId);
    if (!s || s.sender !== sender || !this.sosActive(s, now) || !this.isSurvivor(sender)) throw new GameError("No active request to update");
    s.room = this.get(sender).room;
    s.updatedAt = now;
    if (s.delivered && this.isSurvivor(s.recipient)) this.emit({ type: "sos", to: [s.recipient], id: s.id, updated: true });
  }

  cancelSos(sender: ActorId, sosId: string) {
    const s = this.sos.find(x => x.id === sosId);
    if (!s || s.sender !== sender) throw new GameError("No such request");
    s.cancelled = true;
  }

  // ------------------------------------------------------------------ CPU behaviour (perception-limited)
  private sounds(listener: Actor, now: number) {
    const out: { bearing: number; band: "near" | "far"; kind: string }[] = [];
    for (const o of this.actors.values()) {
      if (o === listener || o.status === "escaped" || this.perceives(listener, o)) continue;
      let radius = 0, kind = "";
      if (o.grabbing || o.grabbedBy) { radius = TUNING.hearStruggle; kind = "struggle"; }
      else if (o.searching) { radius = TUNING.hearSearch; kind = "search"; }
      else if (this.isMoving(o, now)) { radius = o.pace === "run" ? TUNING.hearRun : TUNING.hearWalk; kind = o.pace === "run" ? "running" : "steps"; }
      if (!radius || !canHear(listener.pos, listener.zone, o.pos, o.zone, radius)) continue;
      const bearing = Math.round(Math.atan2(o.pos[0] - listener.pos[0], o.pos[1] - listener.pos[1]) * 180 / Math.PI / 15) * 15;
      out.push({ bearing, band: dist(o.pos, listener.pos) < 5 ? "near" : "far", kind, ...(listener.cpu ? { src: o } : {}) } as any);
    }
    return out.slice(0, 5);
  }

  private think(a: Actor, now: number) {
    a.ai.nextThinkAt = now + (a.status === "infected" ? 600 : 800) + this.rand() * 900;
    if (this.phase !== "hunt" || this.stunned(a, now)) return;
    try {
      if (a.status === "alive") this.thinkSurvivor(a, now);
      else if (a.status === "infected") this.thinkHunter(a, now);
    } catch { /* an intent was refused (e.g. cooldown); try again next think */ }
  }

  private cpuIntent(a: Actor, intent: Intent, now: number, pace?: Pace) {
    a.lastIntentAt = -Infinity;
    a.ai.committedUntil = now + 4000;
    this.setIntent(a.id, intent, now, pace);
  }

  private thinkSurvivor(a: Actor, now: number) {
    const cam = this.camera;
    const threats = [...this.actors.values()].filter(o => {
      if (o === a || o.status === "escaped" || this.stunned(o, now) || !this.perceives(a, o)) return false;
      if (o.status === "infected" && this.revealed(a, o, now)) return true;
      // Anyone sprinting straight at you is worth running from — friend or not.
      if (o.pace === "run" && o.path.length && dist(o.pos, a.pos) < 7) {
        const yaw = o.yaw * Math.PI / 180, dx = a.pos[0] - o.pos[0], dz = a.pos[1] - o.pos[1], l = Math.hypot(dx, dz) || 1;
        return (Math.sin(yaw) * dx + Math.cos(yaw) * dz) / l > 0.8;
      }
      return false;
    });
    const nearest = threats.sort((x, y) => dist(x.pos, a.pos) - dist(y.pos, a.pos))[0];
    const canFlash = cam.holder === a.id && now >= cam.readyAt;
    if (a.grabbedBy) { if (canFlash) this.flash(a.id, now); return; }
    if (canFlash && nearest && dist(nearest.pos, a.pos) <= Math.min(5, TUNING.flashRange)) { this.flash(a.id, now); return; }
    // Stick with a chosen route for a few seconds unless a revealed hunter is right there.
    const imminent = nearest && nearest.status === "infected" && dist(nearest.pos, a.pos) < 3;
    if (a.path.length && now < a.ai.committedUntil && !imminent) return;
    if (a.hideState === "hidden") {
      if (a.snares && this.rand() < 0.3) this.placeSnare(a.id, now);
      if (nearest || now < a.ai.hideUntil) return;
    }
    // Lockdown scramble: get out of the gallery before Elias finishes with his first victim.
    if (!this.graceOver(now) && a.room === "portrait" && !a.path.length && a.hideState === "none") {
      return this.cpuIntent(a, { kind: "room", room: this.pick(ROOM_GRAPH.portrait) }, now, "run");
    }
    if (a.path.length && !nearest) return;
    if (nearest && a.hideState === "none") {
      // Flee through the doorway that best opens distance from the threat.
      // The doorway you'd run through to reach `room`: in a corridor, that corridor's door
      // at the room; in a room, this room's door leading to it.
      const doorOf = (room: RoomId) => isRoom(a.zone)
        ? DOORWAYS.find(d => d.room === a.zone && d.to === room)
        : DOORWAYS.find(d => d.corridor === a.zone && d.room === room);
      const options = this.allowedRooms(a).filter(r => r !== a.room || !isRoom(a.zone));
      const score = (room: RoomId) => { const d = doorOf(room); return d ? dist(d.pos, nearest.pos) - dist(d.pos, a.pos) : -99; };
      const best = options.sort((x, y) => score(y) - score(x))[0];
      if (best) this.cpuIntent(a, { kind: "room", room: best }, now, "run");
      return;
    }
    if (!cam.holder && this.pointVisibleTo(a, cam.pos, cam.zone) && this.rand() < 0.7) return this.cpuIntent(a, { kind: "pickup" }, now, "walk");
    if (this.exitOpen && this.rand() < 0.6) return this.cpuIntent(a, { kind: "exit" }, now, this.rand() < 0.4 ? "run" : "walk");
    const reach = this.cluesInReach(a).filter(c => !a.clues.has(c));
    if (reach.length && this.rand() < 0.5) this.inspect(a.id, reach[0], now);
    const r = this.rand();
    const rooms = this.allowedRooms(a);
    if (r < 0.5) {
      const room = this.rand() < 0.6 ? a.room : this.pick(rooms);
      a.ai.hideUntil = now + 12_000 + this.rand() * 25_000;
      return this.cpuIntent(a, { kind: "hide", spot: this.pick(hideIds(room)) }, now, this.rand() < 0.3 ? "run" : "walk");
    }
    if (r < 0.9) return this.cpuIntent(a, { kind: "room", room: this.pick(rooms.filter(x => x !== a.room)) }, now, this.rand() < 0.3 ? "run" : "walk");
  }

  private thinkHunter(a: Actor, now: number) {
    if ((a.id === "elias" || a.birthday) && !this.graceOver(now)) return;
    if (a.grabbing || a.searching) return;
    if (a.id === "elias" && this.guardGate(a, now)) return;
    // 1. Chase a survivor it can actually see — for a while; AI hunters lose interest.
    const prey = this.survivors().filter(s => this.perceives(a, s) && (a.ai.ignore.get(s.id) ?? 0) <= now)
      .sort((x, y) => dist(x.pos, a.pos) - dist(y.pos, a.pos))[0];
    if (a.intent.kind === "chase" && now > a.ai.chaseUntil) {
      a.ai.ignore.set((a.intent as any).target, now + 6000);
      this.cpuIntent(a, { kind: "idle" }, now);
      return;
    }
    if (prey) {
      if (a.intent.kind !== "chase" || (a.intent as any).target !== prey.id) {
        this.cpuIntent(a, { kind: "chase", target: prey.id }, now, "run");
        a.ai.chaseUntil = now + 7000;
      }
      return;
    }
    if (a.blocking && now < a.ai.blockUntil) return;
    if (a.path.length && a.intent.kind !== "chase") return;
    // 2. Search a hiding place it watched someone slip into.
    a.ai.sawHide = a.ai.sawHide.filter(s => now - s.at < 45_000);
    const seen = a.ai.sawHide.find(s => isRoom(a.zone) && hideIds(a.zone).includes(s.spot));
    if (seen) { a.ai.sawHide = a.ai.sawHide.filter(s => s !== seen); return this.cpuIntent(a, { kind: "search", spot: seen.spot }, now); }
    if (seen === undefined && a.ai.sawHide.length) {
      const target = hideSpot(a.ai.sawHide[0].spot)!;
      return this.cpuIntent(a, { kind: "goto", zone: target.room, p: target.spot.pos } as Intent, now, "walk");
    }
    // 3. Go toward something it heard.
    const heard = this.sounds(a, now).filter((s: any) => s.src && s.src.status === "alive");
    if (heard.length) {
      const src = (heard[0] as any).src as Actor;
      return this.cpuIntent(a, { kind: "goto", zone: src.zone, p: [...src.pos] as Vec2 } as Intent, now, heard[0].kind === "running" ? "run" : "walk");
    }
    if (a.intent.kind === "chase" && a.ai.lastSeen && now - a.ai.lastSeen.at < 8000) {
      return this.cpuIntent(a, { kind: "goto", zone: a.ai.lastSeen.zone, p: a.ai.lastSeen.p } as Intent, now, "run");
    }
    // 4. Patrol: search, move, block a doorway, or wait.
    const r = this.rand();
    if (isRoom(a.zone) && r < 0.35) {
      const spots = hideIds(a.zone).filter(s => now - (a.ai.lastSearched.get(s) ?? -Infinity) > 25_000);
      if (spots.length) return this.cpuIntent(a, { kind: "search", spot: this.pick(spots) }, now);
    }
    if (isRoom(a.zone) && r < 0.5) {
      const doors = DOORWAYS.filter(d => d.room === a.zone);
      const exitDoor = doors.find(d => d.key === "exit");
      const door = exitDoor && this.exitOpen && this.rand() < 0.5 ? exitDoor : this.pick(doors);
      a.ai.blockUntil = now + 10_000 + this.rand() * 15_000;
      return this.cpuIntent(a, { kind: "block", door: door.key }, now);
    }
    if (r < 0.85) {
      const rooms = this.allowedRooms(a).filter(x => x !== a.room);
      return this.cpuIntent(a, { kind: "room", room: this.pick(rooms) }, now, "walk");
    }
  }

  /**
   * CPU Elias's Garden Gate duty. Returns true when it decided what to do this think.
   * He only reacts to what he can perceive; anyone close enough gets chased (a lure).
   */
  private guardGate(a: Actor, now: number): boolean {
    const range = ([lo, hi]: number[]) => lo + this.rand() * (hi - lo);
    if (now >= a.ai.nextGuardAt && now > a.ai.guardUntil) {
      a.ai.guardUntil = now + range(TUNING.eliasLaterGuardMs);
      a.ai.nextGuardAt = a.ai.guardUntil + range(TUNING.eliasGuardGapMs);
    }
    if (now >= a.ai.guardUntil) return false;
    const near = this.survivors().filter(s => this.perceives(a, s) && dist(s.pos, a.pos) <= TUNING.guardChaseRadius && (a.ai.ignore.get(s.id) ?? 0) <= now);
    if (near.length) return false; // normal chase logic takes over (he leaves the doorway)
    if (a.intent.kind === "chase" && now <= a.ai.chaseUntil) return false;
    if (a.blocking === "exit" || (a.intent.kind === "block" && a.path.length)) return true;
    if (isRoom(a.zone) || roomsOf(a.zone).length) {
      try { this.cpuIntent(a, { kind: "block", door: "exit" }, now, "walk"); } catch { /* retry next think */ }
      // cpuIntent validates "block" against the current room; walk toward the Sealed room first if needed.
      if (a.intent.kind !== "block") this.cpuIntent(a, { kind: "goto", zone: EXIT_ROOM, p: blockSpot("exit")! } as Intent, now, "walk");
    }
    return true;
  }

  /** A human seat stops being controlled by a person (left for good) or comes back. */
  setCpu(id: ActorId, cpu: boolean) {
    const a = this.actors.get(id);
    if (!a || id === "elias" || a.birthday) return;
    a.cpu = cpu;
    // An abandoned doorway block must not trap anyone.
    if (cpu) { a.blocking = null; a.ai.nextThinkAt = 0; }
  }

  // ------------------------------------------------------------------ views
  /**
   * Everything one phone may know, computed from that character's perception. Other
   * people's infection is only included when it is readable (close up, attacking,
   * frozen); hidden people are never included; SOS only between sender and recipient.
   */
  viewFor(id: ActorId, now: number, names: (id: ActorId) => string) {
    const me = this.actors.get(id);
    if (!me) return null;
    const base = { id, status: me.status, score: me.score, phase: this.phase, exitOpen: this.exitOpen };
    if (me.status === "escaped") return { ...base, ended: this.endedView(me) };

    const r2 = (p: Vec2): Vec2 => [round2(p[0]), round2(p[1])];
    const actors = [...this.actors.values()].filter(o => o !== me && this.perceives(me, o)).map(o => ({
      id: o.id,
      pos: r2(o.pos),
      yaw: Math.round(o.yaw),
      moving: this.isMoving(o, now),
      running: o.pace === "run" && this.isMoving(o, now),
      revealed: this.revealed(me, o, now),
      stunned: this.stunned(o, now) ? o.stunKind : null,
      action: o.grabbing ? "grabbing" : o.grabbedBy ? "grabbed" : o.searching ? "searching" : o.blocking ? "blocking" : o.viewing ? "viewing"
        : o.hideState === "entering" ? "entering_cover" : o.peeking ? "peeking" : null,
      // Onlookers see HOW someone gets into cover (crawling under a bed, stepping into a wardrobe).
      coverPose: o.hideState === "entering" && o.hide ? hideSpot(o.hide)?.spot.pose ?? null : null,
      searchSpot: o.searching ? o.searching.spot : null,
      grabbedBy: o.grabbedBy && this.perceives(me, this.get(o.grabbedBy)) ? o.grabbedBy : null,
      // A hunter in its grab windup: the target always feels it coming; onlookers only notice
      // when they can already tell that person is a hunter (infection stays secret).
      lunging: o.status === "infected" && !!o.ai.windup && !o.grabbing && (o.ai.windup.target === me.id || this.revealed(me, o, now)),
    }));
    const hs = me.hide ? hideSpot(me.hide) : null;
    const cam = this.camera;
    const camFloorVisible = !cam.holder && this.pointVisibleTo(me, cam.pos, cam.zone);
    const heldBy = cam.holder && cam.holder !== id && actors.some(x => x.id === cam.holder) ? cam.holder : null;
    const view: Record<string, unknown> = {
      ...base,
      huntEndsAt: this.huntEndsAt,
      me: {
        pos: r2(me.pos), yaw: Math.round(me.yaw), zone: me.zone, room: me.room, inRoom: isRoom(me.zone),
        hide: me.hide, hideState: me.hideState, pose: hs?.spot.pose ?? null, look: hs?.spot.look ?? null, hidePos: hs?.spot.pos ?? null,
        peeking: me.peeking, pace: me.pace, moving: this.isMoving(me, now), steering: !!me.steer,
        path: me.path.slice(0, 12).map(w => r2(w.p)),
        intent: { seq: me.intentSeq, kind: me.intent.kind, target: (me.intent as any).room ?? (me.intent as any).spot ?? (me.intent as any).door ?? (me.intent as any).target ?? null, state: me.intentState, reason: me.intentReason },
        caught: !!me.grabbedBy, caughtBy: me.grabbedBy, grabbing: me.grabbing,
        struggle: me.struggle ? { grabId: me.struggle.grabId, by: me.struggle.by, until: me.struggle.until, need: me.struggle.need, got: me.struggle.got } : null,
        stunned: this.stunned(me, now) ? me.stunKind : null,
        searching: me.searching?.spot ?? null, blocking: me.blocking, viewing: me.viewing,
        snares: me.snares,
      },
      actors,
      camera: {
        mine: cam.holder === id,
        readyAt: cam.holder === id ? cam.readyAt : null,
        floor: camFloorVisible ? r2(cam.pos) : null,
        heldBy,
      },
      snares: this.snares.filter(s => this.pointVisibleTo(me, s.pos, s.zone)).map(s => ({ id: s.id, pos: r2(s.pos), mine: s.owner === id })),
      sounds: this.phase === "hunt" ? this.sounds(me, now) : [],
      ended: this.phase === "ended" ? this.endedView(me) : null,
    };

    const rooms = this.allowedRooms(me);
    if (me.status === "alive") {
      view.role = "survivor";
      view.options = {
        rooms: rooms.filter(r => r !== me.room || !isRoom(me.zone)),
        currentRoom: isRoom(me.zone) ? me.zone : null,
        hides: rooms.flatMap(r => ROOMS[r].hides.map(h => ({ id: h.id, room: r, label: h.label, pose: h.pose }))),
        exit: rooms.includes(EXIT_ROOM) || me.zone === "exit",
        inspect: this.cluesInReach(me).map(c => ({ id: c, label: CLUES.find(x => x.id === c)!.label, read: me.clues.has(c) })),
        passTo: actors.filter(x => x.id !== "elias" && !x.revealed && dist(this.get(x.id).pos, me.pos) <= TUNING.passReach).map(x => x.id),
        gallery: this.galleryStations(me).map(g => ({ id: g.id, label: g.label })),
        // Only the hiding place(s) you are standing right beside (the phone shows a small "Hide").
        nearHides: this.nearSpots(me, TUNING.hideOfferRange).map(h => ({ id: h.id, label: h.label, pose: h.pose })),
      };
      view.clues = [...me.clueNotes].map(([cid, text]) => ({ id: cid, label: CLUES.find(c => c.id === cid)!.label, text }));
      view.sos = this.sosViewFor(me, now, names);
    } else {
      view.role = "hunter";
      view.team = this.hunters().filter(h => h !== me).map(h => h.id);
      view.huntOptions = {
        rooms: rooms.filter(r => r !== me.room || !isRoom(me.zone)),
        searchSpots: isRoom(me.zone) ? ROOMS[me.zone].hides.map(h => ({ id: h.id, label: h.label })) : [],
        nearSearch: this.nearSpots(me, TUNING.searchOfferRange).map(h => ({ id: h.id, label: h.label, pose: h.pose })),
        doors: isRoom(me.zone) ? DOORWAYS.filter(d => d.room === me.zone).map(d => ({ key: d.key, to: d.to, label: d.to === "exit" ? "Garden Gate" : `Door to ${ROOMS[d.to as RoomId].name}` })) : [],
        chase: actors.filter(x => x.id !== "elias" && this.get(x.id).status === "alive").map(x => x.id),
      };
    }
    return view;
  }

  /** Hiding places in this room whose open side (or, for standing-room cover, the spot itself) is within `range` metres. */
  private nearSpots(a: Actor, range: number) {
    if (!isRoom(a.zone) || a.hideState !== "none") return [];
    const room = a.zone;
    return ROOMS[room].hides.filter(h => dist(frontOf(h), a.pos) <= range || (this.walkableSpot({ room, spot: h }) && dist(h.pos, a.pos) <= range));
  }

  private isMoving(a: Actor, now: number) {
    if (this.stunned(a, now)) return false;
    return a.path.length > 0 || (!!a.steer && now < a.steer.until && a.hideState === "none");
  }

  /**
   * Direct control: the phone's stick. A gentle push walks (quiet), a strong push runs (heard
   * much further away). Leaving cover first takes the usual moment. The server moves the
   * character: walls, furniture and blocked doorways stop it; doorways let it through.
   */
  steer(id: ActorId, dx: number, dz: number, strength: number, now: number) {
    if (this.phase !== "hunt") throw new GameError("Wait for the lockdown");
    const a = this.get(id);
    if (a.status === "escaped" || a.grabbedBy || a.grabbing || this.stunned(a, now)) return;
    const len = Math.hypot(dx, dz);
    if (!Number.isFinite(len) || !Number.isFinite(strength)) throw new GameError("Bad input");
    if (len < 1e-3 || strength < 0.12) { a.steer = null; return; }
    const run = strength >= TUNING.steerRunThreshold;
    a.pending = null;
    if (a.path.length || a.intent.kind !== "idle") {
      a.path = []; a.intent = { kind: "idle" }; a.intentState = "done"; a.intentReason = null;
    }
    a.searching = null; a.viewing = null; a.peeking = false;
    if (a.blocking) a.blocking = null;
    if (a.hideState === "hidden" || a.hideState === "entering") {
      a.hideState = "leaving"; a.hideTimer = now + TUNING.leaveCoverMs; a.afterLeave = null;
    }
    a.pace = run ? "run" : "walk";
    a.steer = { dx: dx / len, dz: dz / len, run, until: now + TUNING.steerHoldMs };
  }

  private walkable(p: Vec2, from: ZoneId, a: Actor, now: number): boolean {
    const r = TUNING.bodyRadius;
    const z = zoneAt(p);
    if (!z) return false;
    // keep the body clear of walls: every side point must be on walkable floor
    for (const [ox, oz] of [[r, 0], [-r, 0], [0, r], [0, -r]] as const) if (!zoneAt([p[0] + ox, p[1] + oz])) return false;
    // furniture in Blender-built rooms
    for (const rid of roomsOf(z)) for (const [x0, x1, z0, z1] of ROOMS[rid].obstacles ?? []) {
      if (p[0] > x0 - r && p[0] < x1 + r && p[1] > z0 - r && p[1] < z1 + r) return false;
    }
    // a hunter standing in a doorway still stops survivors
    if (z !== from) {
      for (const d of doorwaysBetween(from, z)) if (this.doorBlockedFor(a, d.key, now)) return false;
    }
    if (z === "exit" && a.status !== "alive") return false;
    return true;
  }

  private steerStep(a: Actor, now: number, dt: number) {
    const s = a.steer!;
    const budget = this.speed(a) * dt;
    a.yaw = Math.atan2(s.dx, s.dz) * 180 / Math.PI;
    const from = a.zone;
    const tries: Vec2[] = [
      [a.pos[0] + s.dx * budget, a.pos[1] + s.dz * budget],
      [a.pos[0] + s.dx * budget, a.pos[1]],      // slide along a wall
      [a.pos[0], a.pos[1] + s.dz * budget],
    ];
    // Never trap someone who is already inside a footprint (e.g. placed there): let them walk out.
    const free = !this.walkable(a.pos, from, a, now);
    const next = tries.find(p => free ? !!zoneAt(p) : this.walkable(p, from, a, now));
    if (!next) return;
    a.pos = next;
    this.updateZone(a);
    // Crossing the Garden Gate threshold is the escape.
    if (a.zone === "exit" && a.status === "alive" && dist(a.pos, EXIT_POINT) < 0.9) {
      if (this.exitOpen) { a.steer = null; this.escape(a, now); }
    }
  }

  /** Gallery sections a survivor can walk to right now: in the Portrait Corridor, within reach. */
  private galleryStations(a: Actor): GalleryStation[] {
    if (a.zone !== "corridor" || a.status !== "alive" || a.grabbedBy) return [];
    return GALLERY.filter(g => dist(g.pos, a.pos) <= GALLERY_REACH);
  }

  private sosViewFor(me: Actor, now: number, names: (id: ActorId) => string) {
    const inbox = this.sos.filter(s => s.recipient === me.id && s.delivered && this.sosActive(s, now)).map(s => ({
      id: s.id, sender: s.sender, senderName: names(s.sender), preset: s.preset, text: SOS_PRESETS[s.preset],
      room: s.room, roomName: ROOMS[s.room].name, sentAt: s.sentAt, updatedAt: s.updatedAt,
      // "last seen" once the sender left that room; the new room is never revealed.
      lastSeen: this.get(s.sender).room !== s.room,
      reply: s.reply,
      route: roomRoute(me.room, s.room),
    }));
    const outbox = this.sos.filter(s => s.sender === me.id && this.sosActive(s, now)).map(s => ({
      id: s.id, recipient: s.recipient, recipientName: names(s.recipient), preset: s.preset, text: SOS_PRESETS[s.preset],
      room: s.room, roomName: ROOMS[s.room].name, sentAt: s.sentAt, updatedAt: s.updatedAt,
      // Undelivered requests look exactly like unanswered ones.
      reply: s.delivered ? s.reply : null, repliedAt: s.delivered ? s.repliedAt : null,
      stale: me.room !== s.room,
    }));
    // Contacts: everyone still inside (turned or not) — escapes are public, infection is not.
    const contacts = [...this.actors.values()].filter(o => o !== me && o.active && o.status !== "escaped").map(o => o.id);
    const canSend = this.phase === "hunt" && !this.sos.some(s => s.sender === me.id && this.sosActive(s, now))
      && now - (this.lastSosAt.get(me.id as CharacterId) ?? -Infinity) >= TUNING.sosCooldownMs;
    return { inbox, outbox, contacts, canSend };
  }

  private endedView(me: Actor) {
    if (this.phase !== "ended") return null;
    return { score: me.score, rescues: this.rescueLog.filter(r => r.helper === me.id).map(r => r.victim) };
  }

  /** Public results; only published once the match has ended. Includes the full infection history. */
  results() {
    const guests = [...this.actors.values()].filter(a => a.id !== "elias");
    return {
      reason: this.endReason,
      escaped: guests.filter(a => a.active && a.status === "escaped").map(a => a.id),
      turned: guests.filter(a => a.status === "infected").map(a => a.id),
      trapped: guests.filter(a => a.active && a.status === "alive").map(a => a.id),
      teamScore: this.teamScore,
      rescues: this.rescueLog.length,
      infections: this.infectionLog,
      escapes: this.escapeLog,
      cameraEndedIn: this.camera.holder && this.get(this.camera.holder).status === "escaped" ? "escaped" : ROOMS[this.camera.room].name,
      birthday: this.birthday,
      photographer: this.photographer,
      durationSec: this.huntSec(this.endedAt || this.lastTick),
    };
  }
}
