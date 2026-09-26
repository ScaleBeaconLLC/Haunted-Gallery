/**
 * Canonical Haunted Gallery design data, shared by the Colyseus server and the
 * PlayCanvas client (the client imports this file directly through Vite).
 *
 * Sources: PlayCanvas-Handoff/project6-game-bible.json, scene-layout.json,
 * RESCUE_AND_SOS.md, CLAUDE.md, and the real-time gameplay/camera/hiding upgrade brief.
 * Coordinates are meters on the ground plane (x, z) — scene-layout.json's second
 * number is used as z. Keep this file free of Node or browser APIs.
 */

export type RoomId = "portrait" | "sculpture" | "archive" | "conservation" | "study" | "sealed" | "mirrors";
export type CharacterId =
  | "julian" | "anika" | "marcus" | "mei" | "dev" | "amara" | "alex"
  | "andre" | "rafael" | "simone" | "owen" | "tessa" | "nia";
export type Vec2 = [number, number];

export interface CastMember { id: CharacterId; name: string; voice: string; color: string; pants: string; shoes: string; hair: string }

/**
 * The 13 guests, in the game bible's order. Colors are placeholder stand-in tints; the
 * pants/shoes/hair give each guest a recognisable silhouette from the legs up, which
 * survives infection (only skin and posture change).
 */
export const CAST: CastMember[] = [
  { id: "julian", name: "Julian Mercer", voice: "Blake", color: "#4f7cac", pants: "#1d2533", shoes: "#6b3a1f", hair: "#2a1a10" },
  { id: "anika", name: "Anika Rao", voice: "Eleanor", color: "#c05780", pants: "#1a1a1a", shoes: "#c9a227", hair: "#111111" },
  { id: "marcus", name: "Marcus Bell", voice: "Jason", color: "#3d8b5f", pants: "#3b3b3b", shoes: "#f2f2f2", hair: "#140d08" },
  { id: "mei", name: "Mei Chen", voice: "Hana", color: "#d9a441", pants: "#2c2c54", shoes: "#b3202f", hair: "#0d0d0d" },
  { id: "dev", name: "Dev Patel", voice: "Aarav", color: "#6a5acd", pants: "#4a3b2a", shoes: "#2e6f9e", hair: "#1a120b" },
  { id: "amara", name: "Amara Okafor", voice: "Luna", color: "#e07b39", pants: "#2b1d14", shoes: "#e8d5b0", hair: "#0f0a07" },
  { id: "alex", name: "Alex Park", voice: "Nate", color: "#2aa9b8", pants: "#56606b", shoes: "#ff8c1a", hair: "#3b2a1a" },
  { id: "andre", name: "Andre Calder", voice: "Mark", color: "#8c6d46", pants: "#101820", shoes: "#8a1c1c", hair: "#1c140e" },
  { id: "rafael", name: "Rafael Duarte", voice: "Simon", color: "#b8433a", pants: "#e6e0d4", shoes: "#3a2616", hair: "#241710" },
  { id: "simone", name: "Simone Whitaker", voice: "Sarah", color: "#9b7fd1", pants: "#3a2d4d", shoes: "#d4d4d4", hair: "#c9a35b" },
  { id: "owen", name: "Owen Price", voice: "Clive", color: "#5d7a8c", pants: "#6b5d45", shoes: "#141414", hair: "#8a6b4a" },
  { id: "tessa", name: "Tessa Monroe", voice: "Ashley", color: "#d46a9f", pants: "#1f3b2d", shoes: "#9b59b6", hair: "#6b2a12" },
  { id: "nia", name: "Nia Calder", voice: "Olivia", color: "#e3c567", pants: "#2e2340", shoes: "#39b54a", hair: "#140d0a" },
];
export const CHARACTER_IDS = CAST.map(c => c.id);
export const CURATOR = { id: "elias", name: "Elias Voss", voice: "Hades", color: "#5a1020", pants: "#120408", shoes: "#050505", hair: "#b8b8b8" } as const;

export const MAX_ACTIVE_SURVIVORS = 12;

/** Adjacency from the game bible. Every edge is a physical corridor in CORRIDORS below. */
export const ROOM_GRAPH: Record<RoomId, RoomId[]> = {
  portrait: ["sculpture", "sealed"],
  sculpture: ["portrait", "sealed", "study"],
  archive: ["sealed", "conservation"],
  conservation: ["archive", "sealed", "mirrors"],
  study: ["sculpture", "sealed"],
  sealed: ["portrait", "sculpture", "archive", "conservation", "study", "mirrors"],
  mirrors: ["conservation", "sealed"],
};

/**
 * The rear service exit sits on the south wall of the Sealed Exhibition Room
 * (scene-layout.json `rear_service_exit_reference` [0, 20]).
 */
export const EXIT_ROOM: RoomId = "sealed";
export const EXIT_POINT: Vec2 = [0, 19.2];

/** How a hidden survivor sits in cover: this drives the first-person camera height and look. */
export type HidePose = "under" | "behind" | "curtain";

export interface HideSpot {
  id: string;
  label: string;
  /** Where a hidden survivor is. */
  pos: Vec2;
  pose: HidePose;
  /** First-person look direction (yaw in degrees, 0 = +z, 90 = +x) when settling into cover. */
  look: number;
  /** Cover volume center, footprint (x, z) and height. "under" covers are tables the hider sits beneath. */
  cover: { pos: Vec2; size: Vec2; height: number; kind: string };
}

export interface RoomDef {
  id: RoomId;
  name: string;
  story: string;
  searchRisk: string;
  /** Floor rectangle [x0, x1, z0, z1]. */
  rect: [number, number, number, number];
  center: Vec2;
  hides: [HideSpot, HideSpot];
  floorColor: string;
  wallColor: string;
}

// Room rectangles reproduce scene-layout.json centers/sizes. Portrait and Archive have no
// size in the layout; 17.5 x 15 m keeps their listed hiding points inside. Hiding points
// moved from the layout so covers don't block doorways: portrait.buffet_table (was the
// service niche at -19,15), archive.rolling_shelf (6,16)->(8.6,15.8), sealed.crate_tunnel
// (-5.7,25)->(-5.7,27), study.desk_drapery (now under the curator's desk).
export const ROOMS: Record<RoomId, RoomDef> = {
  portrait: {
    id: "portrait", name: "Grand Portrait Gallery",
    story: "The midnight unveiling and first bite happen here.",
    searchRisk: "Frames and curtains create false movement and uncertain sightlines.",
    rect: [-20.5, -3, 1.5, 16.5], center: [-11.75, 9], floorColor: "#3a2a22", wallColor: "#5b2f36",
    hides: [
      { id: "curtain_recess", label: "Curtain recess", pos: [-19.6, 3], pose: "curtain", look: 90, cover: { pos: [-18.2, 3], size: [0.3, 2.4], height: 2.8, kind: "curtain" } },
      { id: "buffet_table", label: "Under the draped buffet table", pos: [-18.7, 12.6], pose: "under", look: 90, cover: { pos: [-18.7, 12.6], size: [1.3, 2.8], height: 0.9, kind: "table" } },
    ],
  },
  sculpture: {
    id: "sculpture", name: "Sculpture Vault",
    story: "A dangerous shortcut around the central exhibition.",
    searchRisk: "Statues make silhouettes difficult to read.",
    rect: [-32, -16, 22, 38], center: [-24, 30], floorColor: "#34343a", wallColor: "#4a4d57",
    hides: [
      { id: "plinth_shadow", label: "Behind the plinth", pos: [-30.8, 24.4], pose: "behind", look: 45, cover: { pos: [-29.2, 25.6], size: [1.6, 1.6], height: 1.9, kind: "plinth" } },
      { id: "shipping_screen", label: "Behind the shipping screen", pos: [-17, 35.6], pose: "behind", look: 225, cover: { pos: [-18.4, 34.4], size: [0.3, 2.6], height: 2.3, kind: "screen" } },
    ],
  },
  archive: {
    id: "archive", name: "Archive Library",
    story: "Museum records reveal Elias has staged previous private unveilings.",
    searchRisk: "Rolling shelves can trap a survivor who waits too long.",
    rect: [3, 20.5, 1.5, 16.5], center: [11.75, 9], floorColor: "#2e2a24", wallColor: "#4e3b2a",
    hides: [
      { id: "reading_alcove", label: "Under the reading table", pos: [14.2, 12.2], pose: "under", look: 200, cover: { pos: [14.2, 12.2], size: [2.6, 1.3], height: 0.85, kind: "table" } },
      { id: "rolling_shelf", label: "Behind the rolling shelf", pos: [8.6, 15.8], pose: "behind", look: 180, cover: { pos: [8.6, 14.5], size: [2.6, 0.6], height: 2.6, kind: "shelf" } },
    ],
  },
  conservation: {
    id: "conservation", name: "Conservation Lab",
    story: "Restoration notes explain that the camera flash interrupts the infection long enough to flee.",
    searchRisk: "Metal carts and hanging canvas announce careless movement.",
    rect: [16, 32, 22, 38], center: [24, 30], floorColor: "#2c3433", wallColor: "#3f5553",
    hides: [
      { id: "cabinet_bay", label: "Behind the cabinet bay", pos: [31, 24.2], pose: "behind", look: 300, cover: { pos: [29.6, 25.4], size: [0.6, 2.4], height: 2.2, kind: "cabinet" } },
      { id: "canvas_rack", label: "Behind the canvas rack", pos: [17, 35.8], pose: "behind", look: 120, cover: { pos: [18.4, 34.8], size: [0.4, 2.6], height: 2.5, kind: "rack" } },
    ],
  },
  study: {
    id: "study", name: "Curator's Study",
    story: "Personal records establish Elias Voss as the recurring Curator.",
    searchRisk: "The Curator searches this room more thoroughly after its clue is found.",
    rect: [-28, -12, 42, 54], center: [-20, 48], floorColor: "#33261d", wallColor: "#4a3222",
    hides: [
      { id: "bookcase_gap", label: "Behind the secret bookcase", pos: [-27.2, 44], pose: "behind", look: 90, cover: { pos: [-25.9, 44], size: [0.5, 2.4], height: 2.8, kind: "bookcase" } },
      { id: "desk_drapery", label: "Under the curator's desk", pos: [-17.4, 49.6], pose: "under", look: 200, cover: { pos: [-17.4, 49.6], size: [2.6, 1.3], height: 0.85, kind: "desk" } },
    ],
  },
  sealed: {
    id: "sealed", name: "Sealed Exhibition Room",
    story: "The central hub offers the fastest routes and the greatest exposure.",
    searchRisk: "Most paths cross here, increasing the chance of meeting a hunter.",
    rect: [-7, 7, 22, 38], center: [0, 30], floorColor: "#2a2a30", wallColor: "#3a3440",
    hides: [
      { id: "crate_tunnel", label: "Inside the crate tunnel", pos: [-5.7, 27], pose: "under", look: 90, cover: { pos: [-5.7, 27], size: [1.4, 2.6], height: 1.1, kind: "crates" } },
      { id: "blackout_recess", label: "Behind the blackout curtain", pos: [6.3, 35], pose: "curtain", look: 270, cover: { pos: [5, 35], size: [0.3, 2.4], height: 2.6, kind: "curtain" } },
    ],
  },
  mirrors: {
    id: "mirrors", name: "Hall of Mirrors",
    story: "Reflections make camera timing and zombie identity uncertain.",
    searchRisk: "A false reflection can reveal a hiding survivor when a hunter searches.",
    rect: [12, 28, 42, 54], center: [20, 48], floorColor: "#26262e", wallColor: "#5f6570",
    hides: [
      { id: "false_reflection", label: "Behind the false reflection", pos: [27.2, 44], pose: "behind", look: 270, cover: { pos: [25.9, 44], size: [0.3, 2.4], height: 2.8, kind: "mirror" } },
      { id: "velvet_pocket", label: "Behind the velvet partition", pos: [13.2, 52.9], pose: "curtain", look: 135, cover: { pos: [14.4, 51.9], size: [2.2, 0.3], height: 2.4, kind: "curtain" } },
    ],
  },
};
export const ROOM_IDS = Object.keys(ROOMS) as RoomId[];

export function hideIds(room: RoomId): string[] {
  return ROOMS[room].hides.map(h => h.id);
}
export function hideSpot(id: string): { room: RoomId; spot: HideSpot } | null {
  for (const room of ROOM_IDS) {
    const spot = ROOMS[room].hides.find(h => h.id === id);
    if (spot) return { room, spot };
  }
  return null;
}

/**
 * Corridors are walkable floor rectangles. Each graph edge is one corridor route; its
 * `path` is the ordered list of walk points from room `a`'s doorway to room `b`'s.
 */
export interface Corridor {
  id: string;
  a: RoomId; b: RoomId;
  rects: [number, number, number, number][];
  path: Vec2[];
  doors: { room: RoomId; pos: Vec2; axis: "x" | "z" }[];
}

const W = 1; // half corridor width -> 2 m doorways

function straightZ(a: RoomId, b: RoomId, x: number, z0: number, z1: number): Omit<Corridor, "id"> {
  return { a, b, rects: [[x - W, x + W, z0, z1]], path: [[x, z0], [x, z1]],
    doors: [{ room: a, pos: [x, z0], axis: "z" }, { room: b, pos: [x, z1], axis: "z" }] };
}
function straightX(a: RoomId, b: RoomId, z: number, x0: number, x1: number): Omit<Corridor, "id"> {
  return { a, b, rects: [[x0, x1, z - W, z + W]], path: [[x0, z], [x1, z]],
    doors: [{ room: a, pos: [x0, z], axis: "x" }, { room: b, pos: [x1, z], axis: "x" }] };
}
/** Leave room `a` along x at height z, turn at x=turnX, reach room `b` along z. */
function elbow(a: RoomId, b: RoomId, z: number, xFrom: number, turnX: number, zTo: number): Omit<Corridor, "id"> {
  const [lo, hi] = xFrom < turnX ? [xFrom, turnX + W] : [turnX - W, xFrom];
  return {
    a, b,
    rects: [[lo, hi, z - W, z + W], [turnX - W, turnX + W, zTo, z - W]],
    path: [[xFrom, z], [turnX, z], [turnX, zTo]],
    doors: [{ room: a, pos: [xFrom, z], axis: "x" }, { room: b, pos: [turnX, zTo], axis: "z" }],
  };
}

export const CORRIDORS: Corridor[] = [
  straightZ("portrait", "sculpture", -17.5, 16.5, 22),
  straightZ("portrait", "sealed", -5, 16.5, 22),
  straightZ("archive", "sealed", 5, 16.5, 22),
  straightZ("archive", "conservation", 18, 16.5, 22),
  straightX("sculpture", "sealed", 30, -16, -7),
  straightX("sealed", "conservation", 30, 7, 16),
  straightZ("sculpture", "study", -20, 38, 42),
  straightZ("conservation", "mirrors", 20, 38, 42),
  elbow("study", "sealed", 48, -12, -3, 38),
  elbow("mirrors", "sealed", 48, 12, 3, 38),
].map((c, i) => ({ id: `c${i}`, ...c }));

/** The service exit corridor stub south of the Sealed Exhibition Room. */
export const EXIT_CORRIDOR = { rect: [-1, 1, 18.6, 22] as [number, number, number, number], door: { pos: [0, 22] as Vec2, axis: "z" as const } };

export function corridorBetween(from: RoomId, to: RoomId): { path: Vec2[]; corridor: Corridor } | null {
  for (const c of CORRIDORS) {
    if (c.a === from && c.b === to) return { path: c.path, corridor: c };
    if (c.b === from && c.a === to) return { path: [...c.path].reverse(), corridor: c };
  }
  return null;
}

/** Every doorway: a corridor end in a room wall, plus the service exit. Keys are stable ids. */
export interface Doorway { key: string; room: RoomId; to: RoomId | "exit"; pos: Vec2; corridor: string | null }
export const DOORWAYS: Doorway[] = [
  ...CORRIDORS.flatMap(c => c.doors.map(d => ({ key: `${c.id}:${d.room}`, room: d.room, to: (d.room === c.a ? c.b : c.a) as RoomId, pos: d.pos, corridor: c.id }))),
  { key: "exit", room: EXIT_ROOM, to: "exit", pos: EXIT_CORRIDOR.door.pos, corridor: null },
];

/**
 * Open floor standing spots per room, used to place arrivals and the opening crowd.
 */
export const SPOTS_PER_ROOM = 16;
export function standingSpot(room: RoomId, index: number): Vec2 {
  const [cx, cz] = ROOMS[room].center;
  const [x0, x1, z0, z1] = ROOMS[room].rect;
  const i = ((index % SPOTS_PER_ROOM) + SPOTS_PER_ROOM) % SPOTS_PER_ROOM;
  const ring = i < 6 ? 0 : 1;
  const k = ring === 0 ? i : i - 6;
  const n = ring === 0 ? 6 : 10;
  const angle = (k / n) * Math.PI * 2 + (ring ? 0.3 : 0);
  const rx = Math.min((x1 - x0) / 2 - 2.2, ring ? 5 : 2.4);
  const rz = Math.min((z1 - z0) / 2 - 2.2, ring ? 5 : 2.4);
  return [cx + Math.cos(angle) * rx, cz + Math.sin(angle) * rz];
}

// ---------------------------------------------------------------------------
// Clues and the snare defence.
// ---------------------------------------------------------------------------
export type ClueEffect = "camera" | "route" | "snare" | "exit" | "identity";
export interface Clue { id: string; room: RoomId; label: string; pos: Vec2; nearHide: string; effect: ClueEffect; text: string }

/**
 * Inspectable details, each within reach of a hiding place (≤ 1.6 m) so a hidden
 * survivor can read it without crossing open floor. Three grant a velvet-rope snare.
 */
export const CLUES: Clue[] = [
  { id: "guest_list", room: "portrait", label: "Birthday guest list", pos: [-18.2, 11.3], nearHide: "buffet_table", effect: "camera",
    text: "Pinned to the buffet: the photographer's itinerary. Someone has scrawled where the antique camera was last carried." },
  { id: "shipping_manifest", room: "sculpture", label: "Shipping manifest and rope coil", pos: [-17.2, 34.3], nearHide: "shipping_screen", effect: "snare",
    text: "A coil of velvet stanchion rope with brass hooks. Rigged low across a floor, it tangles anything that shambles into it." },
  { id: "floor_plan", room: "archive", label: "Museum floor plan", pos: [13.0, 13.2], nearHide: "reading_alcove", effect: "route",
    text: "The service exit is in the south wall of the Sealed Exhibition Room. Every wing connects to it." },
  { id: "restoration_notes", room: "conservation", label: "Restoration notes", pos: [17.4, 34.3], nearHide: "canvas_rack", effect: "snare",
    text: "\"The flash stops them for five breaths, no more.\" Tucked in the notes: spare velvet rope and hooks for a snare." },
  { id: "curator_journal", room: "study", label: "Elias Voss's journal", pos: [-16.6, 50.2], nearHide: "desk_drapery", effect: "snare",
    text: "\"Guests who fall keep their coats and shoes. Watch their faces, not their clothes.\" A rope snare is coiled in the drawer." },
  { id: "security_manual", room: "sealed", label: "Security panel manual", pos: [6.1, 33.6], nearHide: "blackout_recess", effect: "exit",
    text: "Lockdown procedure: the rear service door releases automatically shortly after the alarm." },
  { id: "mirror_note", room: "mirrors", label: "Mirror-maker's note", pos: [27.0, 45.5], nearHide: "false_reflection", effect: "identity",
    text: "\"A reflection shows the face before the feet.\" Someone who looks like a friend from behind may not be one." },
];

// ---------------------------------------------------------------------------
// Rules and tuning (initial values; tune after the 12-phone rehearsal).
// ---------------------------------------------------------------------------
export const TUNING = {
  openingMs: 24_000,
  /** Elias and the first victim stay at the unveiling for the first moments of the hunt. */
  lockdownGraceMs: 20_000,
  /** The service exit unlocks this long after the hunt starts. */
  exitOpensAfterMs: 90_000,
  /** The hunt ends at "dawn" after this long; anyone still inside is trapped. */
  huntMaxMs: 12 * 60_000,
  tickMs: 100,

  walkSpeed: 1.7,
  runSpeed: 3.6,
  zombieWalkSpeed: 1.3,
  zombieRunSpeed: 2.7,
  eliasSpeed: 2.5,
  /** A bitten guest is out of action this long while turning (slows chain infections). */
  turningMs: 15_000,

  /** Seconds to settle into cover and to crawl back out. */
  enterCoverMs: 700,
  leaveCoverMs: 600,
  hideCapacity: 2,

  /** Same-room sight distance; through a doorway both parties must be near that doorway. */
  sightRange: 18,
  doorwaySightRange: 6,
  /** A face (and so infection) is readable this close, or while the person is attacking/searching you. */
  revealDistance: 3.2,
  /** Peeking lets people in the room see the peeker from this far. */
  peekExposureRange: 7,

  grabDistance: 1.1,
  /** A hunter must stay within reach this long before the grab lands (a running survivor breaks it). */
  grabWindupMs: 700,
  biteDelayMs: 3_000,
  searchMs: 1_800,
  hearWalk: 6,
  hearRun: 13,
  hearSearch: 8,
  hearStruggle: 14,

  flashRange: 9,
  flashFreezeMs: 5_000,
  cameraRechargeMs: 7_000,
  /** A frozen doorway blocker staggers this far back into its room, opening the doorway. */
  staggerDistance: 1.8,
  pickupReach: 1.3,
  passReach: 2.0,
  inspectReach: 1.6,

  snareStunMs: 6_000,
  snareImmunityMs: 20_000,
  snareTriggerRadius: 0.9,
  /** Permanent banishment is a separate rule and is OFF: defences only incapacitate. */
  permanentBanish: false,

  /** A traveller halts this far before a doorway it can see is blocked. */
  blockedStopDistance: 2.4,
  /** Minimum time between accepted movement intents from one player. */
  intentCooldownMs: 350,

  reconnectLobbySec: 30,
  reconnectMatchSec: 120,
  sosCooldownMs: 20_000,
  sosLifetimeMs: 90_000,
};

export const SCORE = { escape: 100, rescue: 150, cameraAssist: 50 } as const;

export type SosPreset = "come_get_me" | "found_camera" | "exit_blocked";
export const SOS_PRESETS: Record<SosPreset, string> = {
  come_get_me: "Come get me",
  found_camera: "I found the camera",
  exit_blocked: "The exit is blocked",
};
export type SosReply = "coming" | "cant";

/** Where the camera falls in the opening (scene-layout.json camera_start). */
export const CAMERA_START: { room: RoomId; pos: Vec2 } = { room: "portrait", pos: [-17.5, 10] };

/** Opening beats (seconds from the start of the opening), mirrored by the client cinematic. */
export const OPENING_BEATS = [
  { at: 0, id: "arrival", caption: "Twelve guests arrive by limousine at the Voss mansion museum." },
  { at: 4, id: "welcome", caption: "Elias Voss, the Curator, welcomes the group. {birthday} is already inside." },
  { at: 8, id: "unveiling", caption: "Midnight. Elias unveils a supposedly lost masterpiece." },
  { at: 11, id: "photo", caption: "{photographer} raises the antique camera for a birthday photo." },
  { at: 12, id: "freeze", caption: "The flash freezes Elias mid-smile. The group backs away. {birthday} stays to check on him." },
  { at: 17, id: "bite", caption: "Elias bites {birthday}. The camera falls — batteries intact." },
  { at: 20, id: "lockdown", caption: "Security lockdown. Anyone could be next — and you may not know who has turned." },
] as const;
