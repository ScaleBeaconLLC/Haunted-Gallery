/**
 * Canonical Haunted Gallery design data, shared by the Colyseus server and the
 * PlayCanvas client (the client imports this file directly through Vite).
 *
 * Sources: PlayCanvas-Handoff/project6-game-bible.json, scene-layout.json,
 * RESCUE_AND_SOS.md and CLAUDE.md. Coordinates are meters on the ground plane
 * (x, z) — scene-layout.json's second number is used as z. Keep this file free of
 * Node or browser APIs.
 */

export type RoomId = "portrait" | "sculpture" | "archive" | "conservation" | "study" | "sealed" | "mirrors";
export type CharacterId =
  | "julian" | "anika" | "marcus" | "mei" | "dev" | "amara" | "alex"
  | "andre" | "rafael" | "simone" | "owen" | "tessa" | "nia";

export interface CastMember { id: CharacterId; name: string; voice: string; color: string }

/** The 13 guests, in the game bible's order. Colors are placeholder stand-in tints. */
export const CAST: CastMember[] = [
  { id: "julian", name: "Julian Mercer", voice: "Blake", color: "#4f7cac" },
  { id: "anika", name: "Anika Rao", voice: "Eleanor", color: "#c05780" },
  { id: "marcus", name: "Marcus Bell", voice: "Jason", color: "#3d8b5f" },
  { id: "mei", name: "Mei Chen", voice: "Hana", color: "#d9a441" },
  { id: "dev", name: "Dev Patel", voice: "Aarav", color: "#6a5acd" },
  { id: "amara", name: "Amara Okafor", voice: "Luna", color: "#e07b39" },
  { id: "alex", name: "Alex Park", voice: "Nate", color: "#2aa9b8" },
  { id: "andre", name: "Andre Calder", voice: "Mark", color: "#8c6d46" },
  { id: "rafael", name: "Rafael Duarte", voice: "Simon", color: "#b8433a" },
  { id: "simone", name: "Simone Whitaker", voice: "Sarah", color: "#9b7fd1" },
  { id: "owen", name: "Owen Price", voice: "Clive", color: "#5d7a8c" },
  { id: "tessa", name: "Tessa Monroe", voice: "Ashley", color: "#d46a9f" },
  { id: "nia", name: "Nia Calder", voice: "Olivia", color: "#e3c567" },
];
export const CHARACTER_IDS = CAST.map(c => c.id);
export const CURATOR = { id: "elias", name: "Elias Voss", voice: "Hades", color: "#5a1020" } as const;

export const MAX_ACTIVE_SURVIVORS = 12;

/** Adjacency from the game bible. Every edge is a physical corridor in LEVEL below. */
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
 * (scene-layout.json `rear_service_exit_reference` [0, 20]); act 5 has survivors
 * "cross the central exhibition and attempt the final exit".
 */
export const EXIT_ROOM: RoomId = "sealed";
export const EXIT_POINT: [number, number] = [0, 19.2];

export interface HideSpot {
  id: string;
  label: string;
  /** Where a hidden survivor stands. */
  pos: [number, number];
  /** Cover volume center, size (w along x, d along z) and height, placed between the hider and the room. */
  cover: { pos: [number, number]; size: [number, number]; height: number; kind: string };
}

export interface RoomDef {
  id: RoomId;
  name: string;
  story: string;
  searchRisk: string;
  /** Floor rectangle [x0, x1, z0, z1]. */
  rect: [number, number, number, number];
  center: [number, number];
  hides: [HideSpot, HideSpot];
  floorColor: string;
  wallColor: string;
}

// Room rectangles reproduce scene-layout.json centers/sizes. Portrait and Archive have no
// size in the layout; 17.5 x 15 m keeps their listed hiding points inside. Three hiding
// points were nudged up to 2.5 m so their covers do not block a doorway:
// portrait.service_niche (-19,15)->(-19.4,13.2), archive.rolling_shelf (6,16)->(8.6,15),
// sealed.crate_tunnel (-5.7,25)->(-5.7,27).
export const ROOMS: Record<RoomId, RoomDef> = {
  portrait: {
    id: "portrait", name: "Grand Portrait Gallery",
    story: "The midnight unveiling and first bite happen here.",
    searchRisk: "Frames and curtains create false movement and uncertain sightlines.",
    rect: [-20.5, -3, 1.5, 16.5], center: [-11.75, 9], floorColor: "#3a2a22", wallColor: "#5b2f36",
    hides: [
      { id: "curtain_recess", label: "Curtain recess", pos: [-19.6, 3], cover: { pos: [-18.2, 3], size: [0.3, 2.4], height: 2.8, kind: "curtain" } },
      { id: "service_niche", label: "Portrait service niche", pos: [-19.6, 13.2], cover: { pos: [-18.2, 13.2], size: [0.4, 2.2], height: 2.4, kind: "panel" } },
    ],
  },
  sculpture: {
    id: "sculpture", name: "Sculpture Vault",
    story: "A dangerous shortcut around the central exhibition.",
    searchRisk: "Statues make silhouettes difficult to read.",
    rect: [-32, -16, 22, 38], center: [-24, 30], floorColor: "#34343a", wallColor: "#4a4d57",
    hides: [
      { id: "plinth_shadow", label: "Plinth shadow", pos: [-30.8, 24.4], cover: { pos: [-29.2, 25.6], size: [1.6, 1.6], height: 1.9, kind: "plinth" } },
      { id: "shipping_screen", label: "Shipping screen", pos: [-17, 35.6], cover: { pos: [-18.4, 34.4], size: [0.3, 2.6], height: 2.3, kind: "screen" } },
    ],
  },
  archive: {
    id: "archive", name: "Archive Library",
    story: "Museum records reveal Elias has staged previous private unveilings.",
    searchRisk: "Rolling shelves can trap a survivor who waits too long.",
    rect: [3, 20.5, 1.5, 16.5], center: [11.75, 9], floorColor: "#2e2a24", wallColor: "#4e3b2a",
    hides: [
      { id: "reading_alcove", label: "Screened reading alcove", pos: [19.7, 12.5], cover: { pos: [18.3, 12.5], size: [0.3, 2.4], height: 2.4, kind: "screen" } },
      { id: "rolling_shelf", label: "Rolling shelf bay", pos: [8.6, 15.8], cover: { pos: [8.6, 14.5], size: [2.6, 0.6], height: 2.6, kind: "shelf" } },
    ],
  },
  conservation: {
    id: "conservation", name: "Conservation Lab",
    story: "Restoration notes explain that the camera flash interrupts the infection long enough to flee.",
    searchRisk: "Metal carts and hanging canvas announce careless movement.",
    rect: [16, 32, 22, 38], center: [24, 30], floorColor: "#2c3433", wallColor: "#3f5553",
    hides: [
      { id: "cabinet_bay", label: "Rolling cabinet bay", pos: [31, 24.2], cover: { pos: [29.6, 25.4], size: [0.6, 2.4], height: 2.2, kind: "cabinet" } },
      { id: "canvas_rack", label: "Canvas rack recess", pos: [17, 35.8], cover: { pos: [18.4, 34.8], size: [0.4, 2.6], height: 2.5, kind: "rack" } },
    ],
  },
  study: {
    id: "study", name: "Curator's Study",
    story: "Personal records establish Elias Voss as the recurring Curator.",
    searchRisk: "The Curator searches this room more thoroughly after its clue is found.",
    rect: [-28, -12, 42, 54], center: [-20, 48], floorColor: "#33261d", wallColor: "#4a3222",
    hides: [
      { id: "bookcase_gap", label: "Secret bookcase gap", pos: [-27.2, 44], cover: { pos: [-25.9, 44], size: [0.5, 2.4], height: 2.8, kind: "bookcase" } },
      { id: "desk_drapery", label: "Desk drapery recess", pos: [-13.2, 52.9], cover: { pos: [-14.4, 51.9], size: [2.2, 0.4], height: 2.6, kind: "curtain" } },
    ],
  },
  sealed: {
    id: "sealed", name: "Sealed Exhibition Room",
    story: "The central hub offers the fastest routes and the greatest exposure.",
    searchRisk: "Most paths cross here, increasing the chance of meeting a hunter.",
    rect: [-7, 7, 22, 38], center: [0, 30], floorColor: "#2a2a30", wallColor: "#3a3440",
    hides: [
      { id: "crate_tunnel", label: "Crate tunnel", pos: [-6.3, 27], cover: { pos: [-5, 27], size: [1.2, 2.4], height: 1.8, kind: "crates" } },
      { id: "blackout_recess", label: "Display blackout recess", pos: [6.3, 35], cover: { pos: [5, 35], size: [0.3, 2.4], height: 2.6, kind: "curtain" } },
    ],
  },
  mirrors: {
    id: "mirrors", name: "Hall of Mirrors",
    story: "Reflections make camera timing and zombie identity uncertain.",
    searchRisk: "A false reflection can reveal a hiding survivor when a hunter searches.",
    rect: [12, 28, 42, 54], center: [20, 48], floorColor: "#26262e", wallColor: "#5f6570",
    hides: [
      { id: "false_reflection", label: "False reflection alcove", pos: [27.2, 44], cover: { pos: [25.9, 44], size: [0.3, 2.4], height: 2.8, kind: "mirror" } },
      { id: "velvet_pocket", label: "Velvet partition pocket", pos: [13.2, 52.9], cover: { pos: [14.4, 51.9], size: [2.2, 0.3], height: 2.4, kind: "curtain" } },
    ],
  },
};
export const ROOM_IDS = Object.keys(ROOMS) as RoomId[];

export function hideIds(room: RoomId): string[] {
  return ROOMS[room].hides.map(h => h.id);
}

/**
 * Corridors are walkable floor rectangles. Each graph edge is one corridor route; its
 * `path` is the ordered list of walk points from room `a`'s doorway to room `b`'s.
 * `doors` are the two doorway centers and the wall axis they sit in.
 */
export interface Corridor {
  a: RoomId; b: RoomId;
  rects: [number, number, number, number][];
  path: [number, number][];
  doors: { room: RoomId; pos: [number, number]; axis: "x" | "z" }[];
}

const W = 1; // half corridor width -> 2 m doorways

function straightZ(a: RoomId, b: RoomId, x: number, z0: number, z1: number): Corridor {
  return { a, b, rects: [[x - W, x + W, z0, z1]], path: [[x, z0], [x, z1]],
    doors: [{ room: a, pos: [x, z0], axis: "z" }, { room: b, pos: [x, z1], axis: "z" }] };
}
function straightX(a: RoomId, b: RoomId, z: number, x0: number, x1: number): Corridor {
  return { a, b, rects: [[x0, x1, z - W, z + W]], path: [[x0, z], [x1, z]],
    doors: [{ room: a, pos: [x0, z], axis: "x" }, { room: b, pos: [x1, z], axis: "x" }] };
}
/** Leave room `a` along x at height z, turn at x=turnX, reach room `b` along z. */
function elbow(a: RoomId, b: RoomId, z: number, xFrom: number, turnX: number, zTo: number): Corridor {
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
];

/** The service exit corridor stub south of the Sealed Exhibition Room. */
export const EXIT_CORRIDOR = { rect: [-1, 1, 18.6, 22] as [number, number, number, number], door: { pos: [0, 22] as [number, number], axis: "z" as const } };

export function corridorBetween(from: RoomId, to: RoomId): { path: [number, number][]; corridor: Corridor } | null {
  for (const c of CORRIDORS) {
    if (c.a === from && c.b === to) return { path: c.path, corridor: c };
    if (c.b === from && c.a === to) return { path: [...c.path].reverse(), corridor: c };
  }
  return null;
}

/**
 * Open floor standing spots per room, used to place visible (not hidden) actors.
 * Deterministic so server-assigned spot indices look the same on every phone.
 */
export const SPOTS_PER_ROOM = 16;
export function standingSpot(room: RoomId, index: number): [number, number] {
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
// Rules and tuning (initial values; tune after the 12-phone rehearsal).
// ---------------------------------------------------------------------------
export const TUNING = {
  openingMs: 24_000,
  choiceMs: 20_000,
  /** Round 1 is the lockdown scramble: hunters stay with the new victim. */
  lockdownRounds: 1,
  /** The service exit unlocks at the start of this round's choice window. */
  exitOpensRound: 3,
  travelMs: 7_000,
  encounterMs: 11_000,
  discoverAtMs: 600,
  grabAtMs: 2_600,
  biteAtMs: 5_600,
  flashFreezeMs: 5_000,
  cameraRechargeMs: 7_000,
  maxRounds: 14,
  reconnectLobbySec: 30,
  reconnectMatchSec: 120,
  sosCooldownMs: 8_000,
  /** An SOS stays answerable for the window it was sent in and the next one. */
  sosLifetimeRounds: 1,
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
export const CAMERA_START: { room: RoomId; pos: [number, number] } = { room: "portrait", pos: [-17.5, 10] };

/** Opening beats (seconds from the start of the opening), mirrored by the client cinematic. */
export const OPENING_BEATS = [
  { at: 0, id: "arrival", caption: "Twelve guests arrive by limousine at the Voss mansion museum." },
  { at: 4, id: "welcome", caption: "Elias Voss, the Curator, welcomes the group. {birthday} is already inside." },
  { at: 8, id: "unveiling", caption: "Midnight. Elias unveils a supposedly lost masterpiece." },
  { at: 11, id: "photo", caption: "{photographer} raises the antique camera for a birthday photo." },
  { at: 12, id: "freeze", caption: "The flash freezes Elias mid-smile. The group backs away. {birthday} stays to check on him." },
  { at: 17, id: "bite", caption: "Elias bites {birthday}. The camera falls — batteries intact." },
  { at: 20, id: "lockdown", caption: "Security lockdown. Every door seals. Survive — and get as many out as you can." },
] as const;

export const ACTION_LABELS = { stay: "Stay", move: "Move", hide: "Hide", exit: "Escape" } as const;
