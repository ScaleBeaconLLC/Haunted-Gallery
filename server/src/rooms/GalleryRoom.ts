import { randomBytes, timingSafeEqual } from "node:crypto";
import { Room, Client, CloseCode, ServerError } from "colyseus";
import { CAST, CharacterId, MAX_ACTIVE_SURVIVORS, ROOM_IDS, RoomId, SOS_PRESETS, SosPreset, TUNING } from "../game/data.js";
import { ActorId, GameError, GameEvent, HauntedGame } from "../game/engine.js";
import { GalleryState, Seat } from "./schema/GalleryState.js";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CHARACTER_SET = new Set<string>(CAST.map(c => c.id));

interface UserData {
  role: "host" | "player";
  playerKey?: string;
  lastView?: string;
  bucket: { tokens: number; at: number };
}
type GalleryClient = Client<{ userData: UserData }>;

function randomCode(len = 5) {
  const bytes = randomBytes(len);
  return [...bytes].map(b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}
function safeEqual(a: string, b: string) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}
function cleanName(name: unknown) {
  return String(name ?? "").replace(/[^\p{L}\p{N} .'_-]/gu, "").trim().slice(0, 20);
}

/**
 * One private Haunted Gallery session. The host creates it (protected by HOST_KEY
 * on the server), guests join by the 5-letter code from the QR link. The room owns
 * seats, timers, pause/reset and privacy; the rules live in HauntedGame.
 */
export class GalleryRoom extends Room<{ state: GalleryState; client: GalleryClient }> {
  maxClients = 24;
  state = new GalleryState();

  private game: HauntedGame | null = null;
  private hostToken = "";
  /** playerKey -> character claimed by that device. */
  private claims = new Map<string, CharacterId>();
  private pausedTotal = 0;
  private pausedAt = 0;

  // ---------------------------------------------------------------- lifecycle
  onCreate(options: any) {
    const required = process.env.HOST_KEY;
    if (required) {
      if (!safeEqual(options?.hostKey ?? "", required)) throw new ServerError(403, "Host key required to create a session");
    } else if (process.env.NODE_ENV === "production") {
      throw new ServerError(503, "HOST_KEY is not configured on the server");
    }
    this.roomId = randomCode();
    this.state.joinCode = this.roomId;
    this.hostToken = randomBytes(24).toString("base64url");
    this.setPrivate(true);
    for (const c of CAST) this.state.seats.set(c.id, new Seat({ character: c.id }));
    this.clock.setInterval(() => this.tick(), 100);
  }

  onAuth(client: GalleryClient, options: any) {
    const role = options?.role === "host" ? "host" : "player";
    if (role === "host") {
      // With HOST_KEY set, the key or this session's token grants host control. In local
      // development (no HOST_KEY) only the creating tab gets it; later tabs need the token.
      const required = process.env.HOST_KEY;
      const tokenOk = safeEqual(options?.hostToken ?? "", this.hostToken);
      const keyOk = required ? safeEqual(options?.hostKey ?? "", required) : !this.hostJoined;
      if (!tokenOk && !keyOk) throw new ServerError(403, "Not authorized to host this session");
      return { role };
    }
    const playerKey = String(options?.playerKey ?? "");
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(playerKey)) throw new ServerError(400, "Missing device key");
    if (this.state.phase !== "lobby" && !this.claims.has(playerKey)) {
      throw new ServerError(409, "This match has already started");
    }
    return { role, playerKey };
  }
  private hostJoined = false;

  onJoin(client: GalleryClient, options: any, auth: { role: "host" | "player"; playerKey?: string }) {
    client.userData = { role: auth.role, playerKey: auth.playerKey, bucket: { tokens: 20, at: Date.now() } };
    if (auth.role === "host") {
      this.hostJoined = true;
      return;
    }
    const character = this.claims.get(auth.playerKey!);
    if (character) {
      const seat = this.state.seats.get(character)!;
      seat.connected = true;
      this.game?.setCpu(character, false);
    }
    const name = cleanName(options?.name);
    if (name && character) this.state.seats.get(character)!.displayName = name;
    this.updateCounts();
    this.pushViews(true);
  }

  async onDrop(client: GalleryClient) {
    const seat = this.seatOf(client);
    if (seat) seat.connected = false;
    const secs = this.state.phase === "lobby" ? TUNING.reconnectLobbySec : TUNING.reconnectMatchSec;
    try {
      await this.allowReconnection(client, secs);
    } catch { /* expired; onLeave follows */ }
  }

  onReconnect(client: GalleryClient) {
    const seat = this.seatOf(client);
    if (seat) seat.connected = true;
    client.userData.lastView = undefined;
    this.pushViews(true);
  }

  onLeave(client: GalleryClient, code?: number) {
    const key = client.userData?.playerKey;
    const character = key ? this.claims.get(key) : undefined;
    if (!character) return;
    const seat = this.state.seats.get(character)!;
    seat.connected = false;
    if (this.state.phase === "lobby" && code === CloseCode.CONSENTED) {
      // Leaving the lobby deliberately frees the character for someone else.
      this.claims.delete(key!);
      Object.assign(seat, { taken: false, displayName: "", isCpu: false });
    } else if (this.game) {
      // Gone for good during a match: the AI plays that guest so the match stays consistent.
      this.game.setCpu(character, true);
    }
    this.updateCounts();
  }

  // ---------------------------------------------------------------- messages
  messages = {
    time: (client: GalleryClient, payload: { t: number }) => {
      client.send("time", { t: payload?.t, serverNow: Date.now() });
    },
    /** Sent by a client once its handlers are registered (and again after a reconnect). */
    hello: (client: GalleryClient) => {
      if (client.userData?.role === "host") {
        client.send("host", { hostToken: this.hostToken, joinCode: this.roomId });
        return;
      }
      client.send("hello", { character: this.characterOf(client) ?? null, serverNow: Date.now() });
      client.userData.lastView = undefined;
      this.pushViews();
    },
    claim: (client: GalleryClient, payload: { character: string; name: string }) => this.guard(client, "player", () => {
      if (this.state.phase !== "lobby") throw new GameError("Characters are locked once the match starts");
      const character = String(payload?.character);
      if (!CHARACTER_SET.has(character)) throw new GameError("Unknown character");
      const name = cleanName(payload?.name);
      if (!name) throw new GameError("Enter your name first");
      const seat = this.state.seats.get(character)!;
      const key = client.userData.playerKey!;
      if (seat.taken && this.claims.get(key) !== character) throw new GameError("Someone already chose that guest");
      const humans = [...this.claims.values()].filter(c => c !== this.claims.get(key)).length;
      if (humans >= MAX_ACTIVE_SURVIVORS) throw new GameError("All 12 survivor seats are taken");
      const previous = this.claims.get(key);
      if (previous && previous !== character) Object.assign(this.state.seats.get(previous)!, { taken: false, displayName: "", connected: false });
      this.claims.set(key, character as CharacterId);
      Object.assign(seat, { taken: true, displayName: name, connected: true, isCpu: false });
    }),
    release: (client: GalleryClient) => this.guard(client, "player", () => {
      if (this.state.phase !== "lobby") throw new GameError("Characters are locked once the match starts");
      const key = client.userData.playerKey!;
      const character = this.claims.get(key);
      if (!character) return;
      this.claims.delete(key);
      Object.assign(this.state.seats.get(character)!, { taken: false, displayName: "", connected: false });
    }),

    choose: (client: GalleryClient, p: any) => this.play(client, (game, me) => {
      const action = p?.action;
      if (action === "move") game.choose(me, { action, to: this.roomArg(p.to) });
      else if (action === "hide") game.choose(me, { action, spot: String(p.spot) });
      else if (action === "stay" || action === "exit") game.choose(me, { action });
      else throw new GameError("Unknown choice");
      game.maybeFinishChoicesEarly(this.gameNow(), this.humanCharacters());
    }),
    hunt: (client: GalleryClient, p: any) => this.play(client, (game, me) => {
      game.chooseHunt(me, this.roomArg(p?.to), p?.search == null ? null : String(p.search));
      game.maybeFinishChoicesEarly(this.gameNow(), this.humanCharacters());
    }),
    pickup: (client: GalleryClient) => this.play(client, (game, me) => game.pickUpCamera(me, this.gameNow())),
    give: (client: GalleryClient, p: any) => this.play(client, (game, me) => game.giveCamera(me, this.characterArg(p?.to))),
    drop: (client: GalleryClient) => this.play(client, (game, me) => game.dropCamera(me)),
    flash: (client: GalleryClient) => this.play(client, (game, me) => game.flash(me, this.gameNow())),
    "sos:send": (client: GalleryClient, p: any) => this.play(client, (game, me) => {
      const preset = String(p?.preset) as SosPreset;
      if (!(preset in SOS_PRESETS)) throw new GameError("Choose a preset message");
      game.sendSos(me, this.characterArg(p?.to), preset, this.gameNow());
    }),
    "sos:reply": (client: GalleryClient, p: any) => this.play(client, (game, me) =>
      game.replySos(me, String(p?.id), p?.reply === "coming" ? "coming" : "cant", this.gameNow())),
    "sos:update": (client: GalleryClient, p: any) => this.play(client, (game, me) => game.updateSos(me, String(p?.id), this.gameNow())),
    "sos:cancel": (client: GalleryClient, p: any) => this.play(client, (game, me) => game.cancelSos(me, String(p?.id))),

    "host:cpuFill": (client: GalleryClient, p: any) => this.guard(client, "host", () => {
      if (this.state.phase !== "lobby") throw new GameError("Change CPU fill in the lobby");
      this.state.cpuFill = !!p?.on;
    }),
    "host:start": (client: GalleryClient) => this.guard(client, "host", () => this.startMatch()),
    "host:pause": (client: GalleryClient) => this.guard(client, "host", () => {
      if (!this.game || this.state.paused || this.game.phase === "ended") return;
      this.pausedAt = Date.now();
      this.state.paused = true;
    }),
    "host:resume": (client: GalleryClient) => this.guard(client, "host", () => {
      if (!this.state.paused) return;
      this.pausedTotal += Date.now() - this.pausedAt;
      this.state.paused = false;
    }),
    "host:reset": (client: GalleryClient) => this.guard(client, "host", () => this.resetToLobby()),
    "host:kick": (client: GalleryClient, p: any) => this.guard(client, "host", () => {
      if (this.state.phase !== "lobby") throw new GameError("Remove players in the lobby");
      const character = this.characterArg(p?.character);
      for (const [key, c] of this.claims) if (c === character) this.claims.delete(key);
      Object.assign(this.state.seats.get(character)!, { taken: false, displayName: "", connected: false });
      for (const c of this.clients) if (c.userData?.playerKey && !this.claims.has(c.userData.playerKey)) c.userData.lastView = undefined;
    }),
  };

  // ---------------------------------------------------------------- match control
  private startMatch() {
    if (this.state.phase !== "lobby") throw new GameError("A match is already running");
    const humans = [...this.claims.values()];
    if (humans.length === 0) throw new GameError("At least one guest must choose a character");
    const active: CharacterId[] = [...humans];
    const cpu = new Set<CharacterId>();
    if (this.state.cpuFill) {
      const free = CAST.map(c => c.id).filter(id => !active.includes(id)).sort(() => Math.random() - 0.5);
      while (active.length < MAX_ACTIVE_SURVIVORS && free.length > 1) {
        const id = free.shift()!;
        active.push(id); cpu.add(id);
      }
    }
    for (const id of cpu) Object.assign(this.state.seats.get(id)!, { taken: true, isCpu: true, displayName: "CPU", connected: true });
    this.pausedTotal = 0;
    this.state.paused = false;
    this.game = new HauntedGame({ active, cpu }, this.gameNow());
    for (const id of active) if (!cpu.has(id) && !this.state.seats.get(id)!.connected) this.game.setCpu(id, true);
    this.state.birthday = this.game.birthday;
    this.state.photographer = this.game.photographer;
    this.state.seats.get(this.game.birthday)!.birthday = true;
    this.state.results = "";
    this.syncPublic();
    this.pushViews(true);
  }

  private resetToLobby() {
    this.game = null;
    this.state.phase = "lobby";
    Object.assign(this.state, { round: 0, phaseEndsAt: 0, exitOpen: false, teamScore: 0, escapedCount: 0,
      infectedCount: 0, aliveCount: 0, birthday: "", photographer: "", results: "", paused: false });
    const claimed = new Set(this.claims.values());
    for (const seat of this.state.seats.values()) {
      seat.status = ""; seat.birthday = false;
      if (!claimed.has(seat.character as CharacterId)) Object.assign(seat, { taken: false, isCpu: false, displayName: "", connected: false });
    }
    // Forget devices that left during the match.
    const present = new Set(this.clients.map(c => c.userData?.playerKey).filter(Boolean));
    for (const [key, c] of this.claims) if (!present.has(key)) {
      this.claims.delete(key);
      Object.assign(this.state.seats.get(c)!, { taken: false, isCpu: false, displayName: "", connected: false });
    }
    this.broadcast("reset", {});
    for (const c of this.clients) c.userData.lastView = undefined;
    this.updateCounts();
    this.pushViews(true);
  }

  // ---------------------------------------------------------------- loop
  private gameNow() {
    return (this.state.paused ? this.pausedAt : Date.now()) - this.pausedTotal;
  }

  private tick() {
    if (!this.game || this.state.paused) return;
    this.game.tick(this.gameNow());
    this.flushEvents();
    this.syncPublic();
    this.pushViews();
  }

  private flushEvents() {
    if (!this.game) return;
    for (const e of this.game.drainEvents()) {
      const { to, ...payload } = e as GameEvent;
      const out = this.toRealTimes(payload);
      if (to.includes("*")) this.broadcast("fx", out);
      else for (const c of this.clients) {
        const ch = this.characterOf(c);
        if (ch && (to as string[]).includes(ch)) c.send("fx", out);
      }
    }
  }

  private syncPublic() {
    const g = this.game;
    if (!g) return;
    const s = this.state;
    s.phase = g.phase;
    s.round = g.round;
    s.phaseEndsAt = g.phase === "ended" ? 0 : g.phaseEndsAt + this.pausedTotal;
    s.exitOpen = g.exitOpen;
    s.teamScore = g.teamScore;
    for (const a of g.actors.values()) {
      if (a.id === "elias") continue;
      const seat = s.seats.get(a.id);
      if (seat && (a.active || a.birthday) && seat.status !== a.status) seat.status = a.status;
    }
    this.updateCounts();
    if (g.phase === "ended" && !s.results) s.results = JSON.stringify(g.results());
  }

  private updateCounts() {
    const s = this.state;
    s.humanCount = this.claims.size;
    if (!this.game) return;
    const active = [...this.game.actors.values()].filter(a => a.active);
    s.escapedCount = active.filter(a => a.status === "escaped").length;
    s.aliveCount = active.filter(a => a.status === "alive").length;
    s.infectedCount = active.filter(a => a.status === "infected").length;
  }

  /** Send each phone its own private view, only when it changed. */
  private pushViews(force = false) {
    const now = this.gameNow();
    const nameOf = (id: ActorId) => {
      const seat = this.state.seats.get(id);
      const cast = CAST.find(c => c.id === id);
      return seat?.displayName && !seat.isCpu ? `${cast?.name.split(" ")[0]} (${seat.displayName})` : cast?.name ?? String(id);
    };
    for (const c of this.clients) {
      if (c.userData?.role !== "player") continue;
      const ch = this.characterOf(c);
      const view = ch && this.game ? this.toRealTimes(this.game.viewFor(ch, now, nameOf)) : { character: ch ?? null, phase: "lobby" };
      const json = JSON.stringify(view);
      if (!force && json === c.userData.lastView) continue;
      c.userData.lastView = json;
      c.send("view", view);
    }
  }

  /** Engine times exclude pauses; phones need wall-clock epoch ms. */
  private toRealTimes<T>(v: T): T {
    const off = this.pausedTotal;
    const walk = (x: any): any => {
      if (Array.isArray(x)) return x.map(walk);
      if (x && typeof x === "object") {
        const o: any = {};
        for (const [k, val] of Object.entries(x)) {
          o[k] = ["readyAt", "sentAt", "updatedAt", "repliedAt", "until"].includes(k) && typeof val === "number" ? val + off : walk(val);
        }
        return o;
      }
      return x;
    };
    return walk(v);
  }

  // ---------------------------------------------------------------- helpers
  private characterOf(c: GalleryClient): CharacterId | undefined {
    const key = c.userData?.playerKey;
    return key ? this.claims.get(key) : undefined;
  }
  private seatOf(c: GalleryClient) {
    const ch = this.characterOf(c);
    return ch ? this.state.seats.get(ch) : undefined;
  }
  private humanCharacters(): ActorId[] {
    const connected = new Set(this.clients.map(c => this.characterOf(c)).filter(Boolean));
    return [...this.claims.values()].filter(c => connected.has(c));
  }
  private roomArg(r: unknown): RoomId {
    if (!ROOM_IDS.includes(r as RoomId)) throw new GameError("Unknown room");
    return r as RoomId;
  }
  private characterArg(c: unknown): CharacterId {
    if (!CHARACTER_SET.has(String(c))) throw new GameError("Unknown guest");
    return c as CharacterId;
  }

  private rateOk(client: GalleryClient) {
    const b = client.userData.bucket;
    const now = Date.now();
    b.tokens = Math.min(20, b.tokens + (now - b.at) / 100); // 10 msg/s sustained, bursts of 20
    b.at = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  private guard(client: GalleryClient, role: "host" | "player", fn: () => void) {
    if (!client.userData || client.userData.role !== role) return client.send("error", { message: "Not allowed" });
    if (!this.rateOk(client)) return;
    try {
      fn();
    } catch (e) {
      if (e instanceof GameError) client.send("error", { message: e.message });
      else { console.error(e); client.send("error", { message: "Something went wrong" }); }
    }
    this.flushEvents();
    this.syncPublic();
    this.pushViews();
  }

  private play(client: GalleryClient, fn: (game: HauntedGame, me: CharacterId) => void) {
    this.guard(client, "player", () => {
      if (!this.game || this.state.paused) throw new GameError(this.state.paused ? "The host paused the game" : "The match hasn't started");
      const me = this.characterOf(client);
      if (!me) throw new GameError("Choose a character first");
      fn(this.game, me);
    });
  }
}
