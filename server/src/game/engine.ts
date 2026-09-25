/**
 * Authoritative Haunted Gallery rules. No networking and no wall clock: every call
 * takes the current game time in ms (the room excludes paused time). The Colyseus
 * room feeds validated player intents in and turns `drainEvents()` plus
 * `viewFor()` into public state and private per-phone messages.
 *
 * Design authority: CLAUDE.md and RESCUE_AND_SOS.md. Notably, the camera is NOT
 * required to use the exit (the old Python prototype's camera gate is not ported).
 */
import {
  CAMERA_START, CAST, CURATOR, CharacterId, EXIT_ROOM, MAX_ACTIVE_SURVIVORS, ROOMS, ROOM_GRAPH, RoomId,
  SCORE, SOS_PRESETS, SPOTS_PER_ROOM, SosPreset, SosReply, TUNING, hideIds, standingSpot,
} from "./data.js";

export type ActorId = CharacterId | "elias";
export type Status = "alive" | "infected" | "escaped";
export type Phase = "opening" | "choice" | "travel" | "encounter" | "ended";

export interface Actor {
  id: ActorId;
  status: Status;
  room: RoomId;
  spot: number;
  hide: string | null;
  lastHide: string | null;
  hideStreak: number;
  /** Controlled by the server AI (Elias, the birthday guest, CPU seats, idle infected players). */
  cpu: boolean;
  active: boolean; // one of the (up to) 12 active survivors at match start
  birthday: boolean;
  score: number;
  stunnedUntil: number;
}

export type SurvivorChoice =
  | { action: "stay" }
  | { action: "move"; to: RoomId }
  | { action: "hide"; spot: string }
  | { action: "exit" };
export interface HunterChoice { to: RoomId; search: string | null }

export interface Sos {
  id: string;
  sender: CharacterId;
  recipient: CharacterId;
  preset: SosPreset;
  room: RoomId;
  sentAt: number;
  updatedAt: number;
  round: number;
  reply: SosReply | null;
  repliedAt: number | null;
  cancelled: boolean;
}

interface Assist { helper: CharacterId; method: "camera_stun"; photographer: CharacterId }

interface Threat { victim: CharacterId; hunter: ActorId; grabbed: boolean; released: boolean }

interface TravelLeg { id: ActorId; from: RoomId; to: RoomId | "exit"; fromSpot: number; toSpot: number; hide: string | null }

/** An event for some phones. `to` lists actor ids whose phones receive it ("*" = everyone). */
export interface GameEvent { type: string; to: (ActorId | "*")[]; [k: string]: unknown }

export interface MatchSetup {
  /** Characters seated for the match (humans + CPU fill), at most 12. */
  active: CharacterId[];
  cpu: Set<CharacterId>;
  random?: () => number;
  idFactory?: () => string;
}

export class GameError extends Error {}

export class HauntedGame {
  phase: Phase = "opening";
  round = 0;
  phaseStartedAt: number;
  phaseEndsAt: number;
  exitOpen = false;
  teamScore = 0;
  readonly actors = new Map<ActorId, Actor>();
  readonly birthday: CharacterId;
  readonly photographer: CharacterId;
  camera: { holder: CharacterId | null; room: RoomId; pos: [number, number]; readyAt: number };
  cameraAssistPaid = new Set<CharacterId>();
  rescuePaid = new Set<CharacterId>();
  assists = new Map<CharacterId, Assist>();
  choices = new Map<ActorId, SurvivorChoice>();
  hunterChoices = new Map<ActorId, HunterChoice>();
  travel: TravelLeg[] = [];
  threats: Threat[] = [];
  sos: Sos[] = [];
  lastSosAt = new Map<CharacterId, number>();
  endReason: "all_resolved" | "dawn" | null = null;
  rescueLog: { victim: CharacterId; helper: CharacterId; photographer: CharacterId; at: number; round: number }[] = [];
  private events: GameEvent[] = [];
  private scheduled: { at: number; run: () => void }[] = [];
  private rand: () => number;
  private newId: () => string;

  constructor(setup: MatchSetup, now: number) {
    this.rand = setup.random ?? Math.random;
    this.newId = setup.idFactory ?? (() => Math.random().toString(36).slice(2, 12));
    const active = [...new Set(setup.active)];
    if (active.length < 1 || active.length > MAX_ACTIVE_SURVIVORS) throw new GameError("A match needs 1-12 active survivors");
    if (active.some(id => !CAST.find(c => c.id === id))) throw new GameError("Unknown character");

    // The birthday guest is the unselected character; with fewer than 12 seats pick one at random.
    const unselected = CAST.map(c => c.id).filter(id => !active.includes(id));
    this.birthday = unselected[Math.floor(this.rand() * unselected.length)];
    this.photographer = active[Math.floor(this.rand() * active.length)];

    let spot = 2;
    for (const id of active) {
      this.actors.set(id, this.makeActor(id, "alive", "portrait", spot++, setup.cpu.has(id), true, false));
    }
    this.actors.set(this.birthday, this.makeActor(this.birthday, "alive", "portrait", 0, true, false, true));
    this.actors.set("elias", this.makeActor("elias", "infected", "portrait", 1, true, false, false));
    this.camera = { holder: this.photographer, room: "portrait", pos: CAMERA_START.pos, readyAt: 0 };

    this.phaseStartedAt = now;
    this.phaseEndsAt = now + TUNING.openingMs;
    this.emit({ type: "phase", to: ["*"], phase: "opening" });
    // Opening continuity: the bite happens ~5 s after the flash, the camera drops intact.
    this.schedule(now + 17_000, () => {
      const b = this.actors.get(this.birthday)!;
      b.status = "infected";
      this.emit({ type: "bite", to: ["*"], victim: this.birthday, hunter: "elias", opening: true });
    });
    this.schedule(now + 17_500, () => {
      this.camera.holder = null;
      this.camera.room = CAMERA_START.room;
      this.camera.pos = CAMERA_START.pos;
      this.emit({ type: "camera_drop", to: ["*"], room: this.camera.room, opening: true });
    });
  }

  private makeActor(id: ActorId, status: Status, room: RoomId, spot: number, cpu: boolean, active: boolean, birthday: boolean): Actor {
    return { id, status, room, spot, hide: null, lastHide: null, hideStreak: 0, cpu, active, birthday, score: 0, stunnedUntil: 0 };
  }

  // ------------------------------------------------------------------ helpers
  private emit(e: GameEvent) { this.events.push(e); }
  drainEvents(): GameEvent[] { const e = this.events; this.events = []; return e; }
  private schedule(at: number, run: () => void) { this.scheduled.push({ at, run }); this.scheduled.sort((a, b) => a.at - b.at); }

  get(id: ActorId): Actor {
    const a = this.actors.get(id);
    if (!a) throw new GameError("Unknown actor");
    return a;
  }
  survivors(): Actor[] { return [...this.actors.values()].filter(a => a.active && a.status === "alive"); }
  hunters(): Actor[] { return [...this.actors.values()].filter(a => a.status === "infected"); }
  isSurvivor(id: ActorId) { const a = this.actors.get(id); return !!a && a.active && a.status === "alive"; }
  isHunter(id: ActorId) { return this.actors.get(id)?.status === "infected"; }
  inRoom(room: RoomId): Actor[] { return [...this.actors.values()].filter(a => a.room === room && a.status !== "escaped"); }
  private stunned(a: Actor, now: number) { return a.stunnedUntil > now; }
  private pick<T>(xs: T[]): T { return xs[Math.floor(this.rand() * xs.length)]; }
  private weighted<T>(xs: T[], w: (x: T) => number): T {
    const ws = xs.map(w); const total = ws.reduce((s, x) => s + x, 0);
    let r = this.rand() * total;
    for (let i = 0; i < xs.length; i++) { r -= ws[i]; if (r <= 0) return xs[i]; }
    return xs[xs.length - 1];
  }
  private freeSpot(room: RoomId, except?: ActorId): number {
    const used = new Set(this.inRoom(room).filter(a => a.id !== except && !a.hide).map(a => a.spot));
    const free = [...Array(SPOTS_PER_ROOM).keys()].filter(i => !used.has(i));
    return free.length ? this.pick(free) : Math.floor(this.rand() * SPOTS_PER_ROOM);
  }
  /** Shortest route by rooms (BFS); returns the room sequence excluding `from`. */
  static route(from: RoomId, to: RoomId): RoomId[] {
    if (from === to) return [];
    const prev = new Map<RoomId, RoomId>([[from, from]]);
    const queue: RoomId[] = [from];
    while (queue.length) {
      const r = queue.shift()!;
      for (const n of ROOM_GRAPH[r]) if (!prev.has(n)) { prev.set(n, r); queue.push(n); }
    }
    const path: RoomId[] = [];
    for (let r = to; r !== from; r = prev.get(r)!) path.unshift(r);
    return path;
  }

  // ------------------------------------------------------------------ clock
  tick(now: number): void {
    while (this.scheduled.length && this.scheduled[0].at <= now) this.scheduled.shift()!.run();
    if (this.phase === "ended") return;
    if (now >= this.phaseEndsAt) this.advance(now);
  }

  /** Human choices all locked: shorten the choice window. */
  maybeFinishChoicesEarly(now: number, humanIds: ActorId[]): void {
    if (this.phase !== "choice") return;
    const pending = humanIds.filter(id => {
      const a = this.actors.get(id);
      if (!a || a.cpu) return false;
      if (this.isSurvivor(id)) return !this.choices.has(id);
      if (this.isHunter(id) && this.round > TUNING.lockdownRounds) return !this.hunterChoices.has(id);
      return false;
    });
    if (pending.length === 0 && now < this.phaseEndsAt - 3000) this.phaseEndsAt = now + 3000;
  }

  private advance(now: number): void {
    switch (this.phase) {
      case "opening": return this.startChoice(now);
      case "choice": return this.startTravel(now);
      case "travel": return this.finishTravel(now);
      case "encounter": return this.finishEncounter(now);
    }
  }

  private setPhase(phase: Phase, now: number, duration: number) {
    this.phase = phase;
    this.phaseStartedAt = now;
    this.phaseEndsAt = now + duration;
    this.emit({ type: "phase", to: ["*"], phase, round: this.round });
  }

  // ------------------------------------------------------------------ choice
  private startChoice(now: number) {
    this.round += 1;
    this.choices.clear();
    this.hunterChoices.clear();
    this.threats = [];
    if (!this.exitOpen && this.round >= TUNING.exitOpensRound) {
      this.exitOpen = true;
      this.emit({ type: "exit_open", to: ["*"] });
    }
    this.setPhase("choice", now, TUNING.choiceMs);
    // CPU survivors decide immediately; CPU hunters decide at lock time (see startTravel).
    for (const a of this.survivors()) if (a.cpu) this.choices.set(a.id, this.cpuSurvivorChoice(a));
    for (const a of this.survivors()) if (a.cpu) this.cpuMaybePickUpCamera(a, now);
  }

  choose(id: ActorId, choice: SurvivorChoice): SurvivorChoice {
    if (this.phase !== "choice") throw new GameError("Choices are locked right now");
    if (!this.isSurvivor(id)) throw new GameError("Only a living survivor can make that choice");
    const a = this.get(id);
    let order: SurvivorChoice;
    switch (choice?.action) {
      case "stay": order = { action: "stay" }; break;
      case "move":
        if (!ROOM_GRAPH[a.room].includes(choice.to)) throw new GameError("Choose a connected room");
        order = { action: "move", to: choice.to }; break;
      case "hide":
        if (!hideIds(a.room).includes(choice.spot)) throw new GameError("Choose a hiding place in your current room");
        order = { action: "hide", spot: choice.spot }; break;
      case "exit":
        if (a.room !== EXIT_ROOM) throw new GameError("The exit is in the Sealed Exhibition Room");
        if (!this.exitOpen) throw new GameError("The service exit is still locked down");
        order = { action: "exit" }; break;
      default: throw new GameError("Unknown choice");
    }
    this.choices.set(id, order);
    return order;
  }

  chooseHunt(id: ActorId, to: RoomId, search: string | null): HunterChoice {
    if (this.phase !== "choice") throw new GameError("Choices are locked right now");
    if (!this.isHunter(id)) throw new GameError("Only an infected hunter can hunt");
    if (this.round <= TUNING.lockdownRounds) throw new GameError("The lockdown is still sealing the doors");
    const a = this.get(id);
    if (to !== a.room && !ROOM_GRAPH[a.room].includes(to)) throw new GameError("Hunt your room or a connected room");
    if (search !== null && !hideIds(to).includes(search)) throw new GameError("Search a hiding place in that room");
    const c = { to, search };
    this.hunterChoices.set(id, c);
    return c;
  }

  // ------------------------------------------------------------------ travel
  private startTravel(now: number) {
    this.travel = [];
    for (const a of this.survivors()) {
      // A missing choice keeps the survivor where they are, still hidden if they were hidden.
      const c = this.choices.get(a.id) ?? (a.hide ? { action: "hide", spot: a.hide } as SurvivorChoice : { action: "stay" } as SurvivorChoice);
      this.choices.set(a.id, c);
      if (c.action === "move") {
        this.travel.push({ id: a.id, from: a.room, to: c.to, fromSpot: a.spot, toSpot: this.freeSpot(c.to), hide: null });
      } else if (c.action === "exit") {
        this.travel.push({ id: a.id, from: a.room, to: "exit", fromSpot: a.spot, toSpot: 0, hide: null });
      } else if (c.action === "hide") {
        if (a.hide !== c.spot) this.travel.push({ id: a.id, from: a.room, to: a.room, fromSpot: a.spot, toSpot: a.spot, hide: c.spot });
      } else if (a.hide) {
        // "stay" while hidden means step back out into the room.
        this.travel.push({ id: a.id, from: a.room, to: a.room, fromSpot: a.spot, toSpot: this.freeSpot(a.room, a.id), hide: null });
      }
    }
    if (this.round > TUNING.lockdownRounds) {
      for (const h of this.hunters()) {
        let c = this.hunterChoices.get(h.id);
        if (!c || h.cpu) c = this.cpuHunterChoice(h);
        this.hunterChoices.set(h.id, c);
        if (c.to !== h.room) this.travel.push({ id: h.id, from: h.room, to: c.to, fromSpot: h.spot, toSpot: this.freeSpot(c.to), hide: null });
      }
    }
    this.setPhase("travel", now, TUNING.travelMs);
    // Each phone only learns about legs that start or end in a room it occupies.
    for (const leg of this.travel) {
      this.emit({ type: "travel", to: this.witnesses(leg), leg });
    }
  }

  private witnesses(leg: TravelLeg): ActorId[] {
    const rooms = new Set<string>([leg.from, leg.to]);
    return [...this.actors.values()].filter(a => a.status !== "escaped" && rooms.has(a.room)).map(a => a.id);
  }

  private finishTravel(now: number) {
    for (const leg of this.travel) {
      const a = this.get(leg.id);
      if (leg.to === "exit") {
        if (a.status === "alive") this.escape(a, now);
        continue;
      }
      if (a.room !== leg.to) {
        // Moving through a doorway leaves any hiding place first.
        a.hide = null;
        a.hideStreak = 0;
        if (this.camera.holder === a.id) this.camera.room = leg.to;
        a.room = leg.to;
      }
      a.spot = leg.toSpot;
      if (leg.hide) a.hide = leg.hide;
      else if (a.status === "alive" && this.choices.get(a.id)?.action !== "hide") a.hide = null;
    }
    for (const a of this.survivors()) {
      if (a.hide) { a.hideStreak = a.lastHide === a.hide ? a.hideStreak + 1 : 1; a.lastHide = a.hide; }
      else a.hideStreak = 0;
    }
    this.travel = [];
    if (this.checkEnd(now)) return;
    this.startEncounter(now);
  }

  private escape(a: Actor, now: number) {
    a.status = "escaped";
    a.hide = null;
    a.score += SCORE.escape;
    this.teamScore += SCORE.escape;
    if (this.camera.holder === a.id) this.camera.room = EXIT_ROOM; // leaves with the survivor
    const aid = this.assists.get(a.id as CharacterId);
    if (aid && !this.rescuePaid.has(a.id as CharacterId)) {
      this.get(aid.helper).score += SCORE.rescue;
      this.teamScore += SCORE.rescue;
      this.rescuePaid.add(a.id as CharacterId);
      if (!this.cameraAssistPaid.has(a.id as CharacterId)) {
        this.get(aid.photographer).score += SCORE.cameraAssist;
        this.cameraAssistPaid.add(a.id as CharacterId);
      }
      this.rescueLog.push({ victim: a.id as CharacterId, helper: aid.helper, photographer: aid.photographer, at: now, round: this.round });
      this.emit({ type: "rescue_paid", to: [aid.helper, aid.photographer, a.id], victim: a.id, helper: aid.helper });
    }
    this.cancelSosFor(a.id as CharacterId);
    this.emit({ type: "escape", to: ["*"], id: a.id });
  }

  // ------------------------------------------------------------------ encounter
  private startEncounter(now: number) {
    this.setPhase("encounter", now, TUNING.encounterMs);
    this.threats = [];
    if (this.round <= TUNING.lockdownRounds) return; // hunters are still at the first victim
    const rooms = new Set(this.hunters().map(h => h.room));
    for (const room of rooms) {
      const hunters = this.inRoom(room).filter(a => a.status === "infected" && !this.stunned(a, now));
      if (!hunters.length) continue;
      const here = this.inRoom(room).filter(a => a.active && a.status === "alive");
      const searched = new Set(hunters.map(h => this.hunterChoices.get(h.id)?.search).filter(Boolean) as string[]);
      const found = here.filter(s => s.hide && searched.has(s.hide));
      const exposed = here.filter(s => !s.hide);
      const discovered = [...exposed, ...found];
      if (!discovered.length) continue;
      const free = [...hunters].sort(() => this.rand() - 0.5);
      for (const victim of discovered.sort(() => this.rand() - 0.5)) {
        const hunter = free.shift();
        this.threats.push({ victim: victim.id as CharacterId, hunter: hunter?.id ?? hunters[0].id, grabbed: false, released: !hunter });
      }
      this.schedule(now + TUNING.discoverAtMs, () => {
        for (const v of found) if (v.status === "alive") { v.hide = null; }
        for (const t of this.threats.filter(t => discovered.some(d => d.id === t.victim))) {
          const v = this.get(t.victim);
          if (v.status !== "alive") continue;
          this.emit({ type: "discovered", to: this.inRoom(room).map(a => a.id), victim: t.victim, hunter: t.hunter, room, fromHiding: found.includes(v) });
        }
        this.cpuFlashIfThreatened(room, now + TUNING.discoverAtMs + 400);
      });
      this.schedule(now + TUNING.grabAtMs, () => {
        for (const t of this.threats) {
          const h = this.get(t.hunter), v = this.get(t.victim);
          if (t.released || v.room !== room || v.status !== "alive" || this.stunned(h, now + TUNING.grabAtMs)) continue;
          t.grabbed = true;
          this.emit({ type: "grabbed", to: this.inRoom(room).map(a => a.id), victim: t.victim, hunter: t.hunter, room });
        }
      });
      this.schedule(now + TUNING.biteAtMs, () => {
        for (const t of this.threats) {
          const h = this.get(t.hunter), v = this.get(t.victim);
          if (!t.grabbed || t.released || v.room !== room || v.status !== "alive" || this.stunned(h, now + TUNING.biteAtMs)) continue;
          this.infect(v, t.hunter, now + TUNING.biteAtMs);
        }
      });
    }
  }

  private infect(v: Actor, hunter: ActorId, now: number) {
    v.status = "infected";
    v.hide = null;
    this.assists.delete(v.id as CharacterId);
    this.cancelSosFor(v.id as CharacterId);
    this.choices.delete(v.id);
    this.emit({ type: "bite", to: this.inRoom(v.room).map(a => a.id), victim: v.id, hunter, room: v.room });
    this.emit({ type: "turned", to: ["*"], id: v.id });
    if (this.camera.holder === v.id) {
      this.camera.holder = null;
      this.camera.room = v.room;
      this.camera.pos = standingSpot(v.room, v.spot);
      this.emit({ type: "camera_drop", to: this.inRoom(v.room).map(a => a.id), room: v.room });
    }
  }

  /** The camera holder deliberately takes a photo. Freezes every visible infected hunter in the room. */
  flash(id: ActorId, now: number): { frozen: ActorId[]; saved: ActorId[] } {
    if (this.phase !== "encounter") throw new GameError("Save the flash for when a hunter is in sight");
    if (this.camera.holder !== id || !this.isSurvivor(id)) throw new GameError("You are not holding the camera");
    if (now < this.camera.readyAt) throw new GameError("The camera is recharging");
    const me = this.get(id);
    const targets = this.inRoom(me.room).filter(a => a.status === "infected" && !this.stunned(a, now));
    if (!targets.length) throw new GameError("No hunter in sight");
    for (const h of targets) h.stunnedUntil = now + TUNING.flashFreezeMs;
    this.camera.readyAt = now + TUNING.cameraRechargeMs;
    me.hide = null; // the flash gives away the photographer's position
    const saved: ActorId[] = [];
    for (const t of this.threats) {
      if (t.released || !targets.some(h => h.id === t.hunter)) continue;
      const v = this.get(t.victim);
      if (v.status !== "alive" || v.room !== me.room) continue;
      t.released = true;
      saved.push(t.victim);
      // Rescue evidence: an observable, co-located camera assist on someone else. Once per victim.
      if (t.victim !== id && !this.assists.has(t.victim)) {
        this.assists.set(t.victim, { helper: id as CharacterId, method: "camera_stun", photographer: id as CharacterId });
      }
    }
    this.emit({ type: "flash", to: this.inRoom(me.room).map(a => a.id), by: id, room: me.room, frozen: targets.map(t => t.id), saved, until: now + TUNING.flashFreezeMs });
    return { frozen: targets.map(t => t.id), saved };
  }

  private finishEncounter(now: number) {
    this.threats = [];
    if (this.checkEnd(now)) return;
    this.startChoice(now);
  }

  private checkEnd(now: number): boolean {
    const alive = this.survivors().length;
    const dawn = this.round >= TUNING.maxRounds && this.phase === "encounter";
    if (alive > 0 && !dawn) return false;
    this.endReason = alive === 0 ? "all_resolved" : "dawn";
    this.phase = "ended";
    this.phaseStartedAt = now;
    this.phaseEndsAt = now;
    for (const s of this.sos) s.cancelled = true;
    this.emit({ type: "phase", to: ["*"], phase: "ended", reason: this.endReason });
    return true;
  }

  // ------------------------------------------------------------------ camera handling
  pickUpCamera(id: ActorId, now: number) {
    if (this.phase !== "choice" && this.phase !== "encounter") throw new GameError("You can't reach it right now");
    if (!this.isSurvivor(id)) throw new GameError("Only a living survivor can take the camera");
    const a = this.get(id);
    if (this.camera.holder) throw new GameError("Someone already has the camera");
    if (this.camera.room !== a.room) throw new GameError("The camera is not in this room");
    this.camera.holder = id as CharacterId;
    this.emit({ type: "camera_pickup", to: this.inRoom(a.room).map(x => x.id), by: id, room: a.room });
  }

  giveCamera(id: ActorId, to: ActorId) {
    if (this.phase !== "choice") throw new GameError("Pass the camera during a choice window");
    if (this.camera.holder !== id) throw new GameError("You are not holding the camera");
    if (!this.isSurvivor(to) || to === id) throw new GameError("Pass it to another living survivor");
    const a = this.get(id), b = this.get(to);
    if (a.room !== b.room || b.hide) throw new GameError("They must be standing in your room");
    this.camera.holder = to as CharacterId;
    this.emit({ type: "camera_pass", to: this.inRoom(a.room).map(x => x.id), from: id, recipient: to });
  }

  dropCamera(id: ActorId) {
    if (this.camera.holder !== id) throw new GameError("You are not holding the camera");
    const a = this.get(id);
    this.camera.holder = null;
    this.camera.room = a.room;
    this.camera.pos = standingSpot(a.room, a.spot);
    this.emit({ type: "camera_drop", to: this.inRoom(a.room).map(x => x.id), room: a.room });
  }

  // ------------------------------------------------------------------ SOS
  sendSos(sender: ActorId, recipient: ActorId, preset: SosPreset, now: number): Sos {
    if (this.phase === "opening" || this.phase === "ended") throw new GameError("SOS opens after the lockdown");
    if (!this.isSurvivor(sender)) throw new GameError("Only a living survivor can ask for help");
    if (!this.isSurvivor(recipient) || sender === recipient) throw new GameError("Choose another living guest");
    if (!(preset in SOS_PRESETS)) throw new GameError("Choose a preset message");
    if (this.sos.some(s => s.sender === sender && s.round === this.round && !s.cancelled)) throw new GameError("One SOS per choice window");
    const last = this.lastSosAt.get(sender as CharacterId) ?? -Infinity;
    if (now - last < TUNING.sosCooldownMs) throw new GameError("Wait a moment before sending another SOS");
    // Supersede this sender's older request so each sender has one active SOS.
    for (const s of this.sos) if (s.sender === sender) s.cancelled = true;
    const s: Sos = {
      id: this.newId(), sender: sender as CharacterId, recipient: recipient as CharacterId, preset,
      room: this.get(sender).room, sentAt: now, updatedAt: now, round: this.round, reply: null, repliedAt: null, cancelled: false,
    };
    this.sos.push(s);
    this.lastSosAt.set(sender as CharacterId, now);
    this.emit({ type: "sos", to: [recipient], id: s.id });
    return s;
  }

  private activeSos(s: Sos): boolean {
    return !s.cancelled && this.round - s.round <= TUNING.sosLifetimeRounds && this.isSurvivor(s.sender) && this.isSurvivor(s.recipient);
  }

  replySos(recipient: ActorId, sosId: string, reply: SosReply, now: number) {
    const s = this.sos.find(x => x.id === sosId);
    if (!s || s.recipient !== recipient) throw new GameError("That request isn't yours");
    if (!this.activeSos(s)) throw new GameError("That request has expired");
    if (reply !== "coming" && reply !== "cant") throw new GameError("Unknown reply");
    s.reply = reply;
    s.repliedAt = now;
    this.emit({ type: "sos_reply", to: [s.sender], id: s.id });
  }

  /** The sender deliberately refreshes the room snapshot on their active request. */
  updateSos(sender: ActorId, sosId: string, now: number) {
    const s = this.sos.find(x => x.id === sosId);
    if (!s || s.sender !== sender || !this.activeSos(s)) throw new GameError("No active request to update");
    s.room = this.get(sender).room;
    s.updatedAt = now;
    this.emit({ type: "sos", to: [s.recipient], id: s.id, updated: true });
  }

  cancelSos(sender: ActorId, sosId: string) {
    const s = this.sos.find(x => x.id === sosId);
    if (!s || s.sender !== sender) throw new GameError("No such request");
    s.cancelled = true;
    this.emit({ type: "sos_cancel", to: [s.recipient], id: s.id });
  }

  private cancelSosFor(id: CharacterId) {
    for (const s of this.sos) if (!s.cancelled && (s.sender === id || s.recipient === id)) s.cancelled = true;
  }

  // ------------------------------------------------------------------ CPU behaviour
  private cpuSurvivorChoice(a: Actor): SurvivorChoice {
    const threatHere = this.inRoom(a.room).some(x => x.status === "infected");
    if (this.exitOpen) {
      if (a.room === EXIT_ROOM && this.rand() < 0.85) return { action: "exit" };
      const step = HauntedGame.route(a.room, EXIT_ROOM)[0];
      if (step && this.rand() < 0.7) return { action: "move", to: step };
    }
    if (threatHere || this.round <= TUNING.lockdownRounds) {
      if (this.rand() < 0.75) return { action: "move", to: this.pick(ROOM_GRAPH[a.room]) };
    }
    const r = this.rand();
    if (r < 0.45) {
      const spots = hideIds(a.room);
      const fresh = spots.filter(s => s !== a.lastHide);
      return { action: "hide", spot: this.rand() < 0.65 && fresh.length ? this.pick(fresh) : this.pick(spots) };
    }
    if (r < 0.6) return { action: "stay" };
    return { action: "move", to: this.pick(ROOM_GRAPH[a.room]) };
  }

  private cpuMaybePickUpCamera(a: Actor, now: number) {
    if (!this.camera.holder && this.camera.room === a.room && this.isSurvivor(a.id) && this.rand() < 0.8) {
      try { this.pickUpCamera(a.id, now); } catch { /* raced */ }
    }
  }

  private cpuHunterChoice(h: Actor): HunterChoice {
    // Hunters "hear" occupied rooms, but do not know hiding places; repeat hiding raises search odds.
    const options: RoomId[] = [h.room, ...ROOM_GRAPH[h.room]];
    const to = this.weighted(options, r => 1 + 1.2 * this.inRoom(r).filter(x => x.active && x.status === "alive").length);
    const streak = (spot: string) => this.inRoom(to).filter(x => x.status === "alive" && x.lastHide === spot)
      .reduce((s, x) => s + x.hideStreak, 0);
    const search = this.weighted(hideIds(to), s => 1 + 2 * streak(s));
    return { to, search };
  }

  private cpuFlashIfThreatened(room: RoomId, at: number) {
    const holder = this.camera.holder ? this.get(this.camera.holder) : null;
    if (!holder || !holder.cpu || holder.room !== room || holder.status !== "alive") return;
    if (!this.threats.some(t => !t.released && this.get(t.victim).room === room)) return;
    this.schedule(at, () => { try { this.flash(holder.id, at); } catch { /* not possible any more */ } });
  }

  /** A human seat stops being controlled by a person (left for good) or comes back. */
  setCpu(id: ActorId, cpu: boolean) {
    const a = this.actors.get(id);
    if (a && id !== "elias" && !a.birthday) a.cpu = cpu;
  }

  // ------------------------------------------------------------------ views
  /**
   * What one phone may know. Survivors: own room, visible occupants of that room,
   * own hiding place, camera, own SOS. Hunters: own room's visible occupants only,
   * never survivor rooms elsewhere, hiding places or SOS. Nothing here is broadcast.
   */
  viewFor(id: ActorId, now: number, names: (id: ActorId) => string) {
    const me = this.actors.get(id);
    if (!me) return null;
    const visibleHere = (room: RoomId) => this.inRoom(room)
      .filter(a => a.id === id || !a.hide)
      .map(a => ({
        id: a.id, status: a.status, spot: a.spot, hide: a.id === id ? a.hide : null,
        stunned: this.stunned(a, now), birthday: a.birthday,
      }));
    const base = {
      id, status: me.status, score: me.score, round: this.round, phase: this.phase,
      isHunter: me.status === "infected", birthday: me.birthday,
    };
    if (me.status === "escaped") return { ...base, room: null, actors: [], ended: this.endedView(id) };

    const threatsOnMe = this.threats.filter(t => t.victim === id && !t.released);
    const cam = this.camera;
    const view: Record<string, unknown> = {
      ...base,
      room: me.room,
      hide: me.hide,
      spot: me.spot,
      actors: visibleHere(me.room),
      camera: {
        mine: cam.holder === id,
        readyAt: cam.holder === id ? cam.readyAt : null,
        // Only a camera lying in your room, or one carried by someone visibly standing with you.
        onFloorHere: !cam.holder && cam.room === me.room,
        floorPos: !cam.holder && cam.room === me.room ? cam.pos : null,
        heldBy: cam.holder && cam.holder !== id && this.isSurvivor(cam.holder)
          && this.get(cam.holder).room === me.room && !this.get(cam.holder).hide ? cam.holder : null,
      },
      exitOpen: this.exitOpen,
      threat: threatsOnMe.length ? { hunter: threatsOnMe[0].hunter, grabbed: threatsOnMe[0].grabbed } : null,
      travel: this.phase === "travel" ? this.travel.filter(l => l.id === id || l.from === me.room || l.to === me.room) : [],
      ended: this.phase === "ended" ? this.endedView(id) : null,
    };

    if (this.isSurvivor(id)) {
      view.choice = this.choices.get(id) ?? null;
      view.options = {
        moves: ROOM_GRAPH[me.room],
        hides: ROOMS[me.room].hides.map(h => ({ id: h.id, label: h.label })),
        canExit: this.exitOpen && me.room === EXIT_ROOM,
      };
      view.sos = this.sosViewFor(id as CharacterId, now, names);
      view.teammates = this.survivors().filter(a => a.id !== id).map(a => a.id);
    } else if (me.status === "infected") {
      view.hunt = this.hunterChoices.get(id) ?? null;
      view.huntOptions = this.round > TUNING.lockdownRounds ? {
        rooms: [me.room, ...ROOM_GRAPH[me.room]].map(r => ({ id: r, hides: hideIds(r) })),
      } : null;
    }
    return view;
  }

  private sosViewFor(id: CharacterId, now: number, names: (id: ActorId) => string) {
    const me = this.get(id);
    const inbox = this.sos.filter(s => s.recipient === id && this.activeSos(s)).map(s => ({
      id: s.id, sender: s.sender, senderName: names(s.sender), preset: s.preset, text: SOS_PRESETS[s.preset],
      room: s.room, roomName: ROOMS[s.room].name, sentAt: s.sentAt, updatedAt: s.updatedAt,
      // The snapshot is marked "last seen" once the sender has left that room; the new room is never revealed.
      lastSeen: this.get(s.sender).room !== s.room,
      reply: s.reply,
      route: HauntedGame.route(me.room, s.room),
    }));
    const outbox = this.sos.filter(s => s.sender === id && this.activeSos(s)).map(s => ({
      id: s.id, recipient: s.recipient, recipientName: names(s.recipient), preset: s.preset, text: SOS_PRESETS[s.preset],
      room: s.room, roomName: ROOMS[s.room].name, sentAt: s.sentAt, updatedAt: s.updatedAt, reply: s.reply, repliedAt: s.repliedAt,
      stale: me.room !== s.room,
    }));
    const canSend = !this.sos.some(s => s.sender === id && s.round === this.round && !s.cancelled)
      && now - (this.lastSosAt.get(id) ?? -Infinity) >= TUNING.sosCooldownMs
      && this.phase !== "opening" && this.phase !== "ended";
    return { inbox, outbox, canSend };
  }

  private endedView(id: ActorId) {
    if (this.phase !== "ended") return null;
    return { score: this.get(id).score, rescues: this.rescueLog.filter(r => r.helper === id).map(r => r.victim) };
  }

  /** Public aggregate results; revealed to everyone only after the match ends. */
  results() {
    const guests = [...this.actors.values()].filter(a => a.id !== "elias");
    return {
      reason: this.endReason,
      escaped: guests.filter(a => a.active && a.status === "escaped").map(a => a.id),
      turned: guests.filter(a => a.status === "infected").map(a => a.id),
      trapped: guests.filter(a => a.active && a.status === "alive").map(a => a.id),
      teamScore: this.teamScore,
      rescues: this.rescueLog.length,
      cameraEndedIn: this.camera.holder && this.get(this.camera.holder).status === "escaped" ? "escaped" : ROOMS[this.camera.room].name,
      birthday: this.birthday,
      photographer: this.photographer,
    };
  }
}
