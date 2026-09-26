/**
 * Navigation and perception geometry. Rooms are convex rectangles, so movement inside
 * a room is a straight line; between rooms it follows corridor polylines through the
 * doorways. Nothing here knows where anyone is: routes use only fixed geometry.
 */
import {
  CORRIDORS, Corridor, DOORWAYS, EXIT_CORRIDOR, EXIT_POINT, EXIT_ROOM, ROOMS, ROOM_GRAPH, ROOM_IDS, RoomId, TUNING, Vec2,
} from "./data.js";

export type ZoneId = RoomId | string; // room id, corridor id ("c0".."c9") or "exit"

export interface Waypoint { p: Vec2; door?: string }

const EPS = 0.06;
const inRect = ([x, z]: Vec2, [x0, x1, z0, z1]: [number, number, number, number], e = EPS) =>
  x >= x0 - e && x <= x1 + e && z >= z0 - e && z <= z1 + e;

export const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const toward = (from: Vec2, to: Vec2, d: number): Vec2 => {
  const l = dist(from, to) || 1;
  return [from[0] + (to[0] - from[0]) / l * d, from[1] + (to[1] - from[1]) / l * d];
};

export const CORRIDOR_BY_ID = new Map<string, Corridor>(CORRIDORS.map(c => [c.id, c]));

export function isRoom(z: ZoneId): z is RoomId { return (ROOM_IDS as string[]).includes(z); }

/** The zone containing a point: rooms first (doorway points count as the room), then corridors, then the exit stub. */
export function zoneAt(p: Vec2): ZoneId | null {
  for (const id of ROOM_IDS) if (inRect(p, ROOMS[id].rect)) return id;
  for (const c of CORRIDORS) if (c.rects.some(r => inRect(p, r))) return c.id;
  if (inRect(p, EXIT_CORRIDOR.rect)) return "exit";
  return null;
}

/** Rooms a zone touches: itself for a room, both ends for a corridor, the sealed room for the exit stub. */
export function roomsOf(z: ZoneId): RoomId[] {
  if (isRoom(z)) return [z];
  if (z === "exit") return [EXIT_ROOM];
  const c = CORRIDOR_BY_ID.get(z);
  return c ? [c.a, c.b] : [];
}

export function roomRoute(from: RoomId, to: RoomId): RoomId[] {
  if (from === to) return [];
  const prev = new Map<RoomId, RoomId>([[from, from]]);
  const q: RoomId[] = [from];
  while (q.length) {
    const r = q.shift()!;
    for (const n of ROOM_GRAPH[r]) if (!prev.has(n)) { prev.set(n, r); q.push(n); }
  }
  const out: RoomId[] = [];
  for (let r = to; r !== from; r = prev.get(r)!) out.unshift(r);
  return out;
}

// ---------------------------------------------------------------- polylines
function cumulative(path: Vec2[]): number[] {
  const c = [0];
  for (let i = 1; i < path.length; i++) c.push(c[i - 1] + dist(path[i - 1], path[i]));
  return c;
}
/** Arc-length position of the point on the polyline closest to p. */
export function paramOf(path: Vec2[], p: Vec2): number {
  const cum = cumulative(path);
  let best = Infinity, bestS = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const L = dist(a, b) || 1e-6;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (L * L)));
    const q = lerp(a, b, t);
    const d = dist(p, q);
    if (d < best) { best = d; bestS = cum[i - 1] + t * L; }
  }
  return bestS;
}
/** Polyline vertices strictly between two arc positions, in travel order. */
function verticesBetween(path: Vec2[], s0: number, s1: number): Vec2[] {
  const cum = cumulative(path);
  const idx = path.map((_, i) => i).filter(i => (s0 < s1 ? cum[i] > s0 + EPS && cum[i] < s1 - EPS : cum[i] < s0 - EPS && cum[i] > s1 + EPS));
  if (s0 > s1) idx.reverse();
  return idx.map(i => path[i]);
}

function doorKey(c: Corridor, room: RoomId) { return `${c.id}:${room}`; }
function doorPos(c: Corridor, room: RoomId): Vec2 { return c.doors.find(d => d.room === room)!.pos; }
/** A point ~1 m inside `room` in front of the corridor's doorway. */
function insideDoor(c: Corridor, room: RoomId): Vec2 {
  const path = room === c.a ? c.path : [...c.path].reverse();
  return toward(path[0], path[1], -1.0);
}

/** Waypoints from inside room `from` to just inside room `to` (adjacent rooms), through their corridor. */
function roomHop(from: RoomId, to: RoomId): Waypoint[] {
  const c = CORRIDORS.find(x => (x.a === from && x.b === to) || (x.a === to && x.b === from))!;
  const path = from === c.a ? c.path : [...c.path].reverse();
  return [
    { p: insideDoor(c, from) },
    { p: path[0], door: doorKey(c, from) },
    ...path.slice(1, -1).map(p => ({ p })),
    { p: path[path.length - 1], door: doorKey(c, to) },
    { p: insideDoor(c, to) },
  ];
}

export interface Destination { zone: ZoneId; p: Vec2 }

/**
 * Plan a route using fixed geometry only (never actor positions). Returns waypoints
 * ending at the destination point, or null if unreachable.
 */
export function planRoute(from: Vec2, fromZone: ZoneId, dest: Destination): Waypoint[] | null {
  const out: Waypoint[] = [];
  let room: RoomId;

  // Leave a corridor or the exit stub toward the best end first.
  if (fromZone === "exit") {
    if (dest.zone === "exit") return [{ p: dest.p }];
    out.push({ p: EXIT_CORRIDOR.door.pos, door: "exit" }, { p: [0, 23.2] });
    room = EXIT_ROOM;
  } else if (!isRoom(fromZone)) {
    const c = CORRIDOR_BY_ID.get(fromZone);
    if (!c) return null;
    const s0 = paramOf(c.path, from);
    if (dest.zone === c.id) {
      const s1 = paramOf(c.path, dest.p);
      return [...verticesBetween(c.path, s0, s1).map(p => ({ p })), { p: dest.p }];
    }
    const total = cumulative(c.path).at(-1)!;
    const targetRooms = roomsOf(dest.zone);
    const cost = (end: RoomId) => {
      const along = end === c.a ? s0 : total - s0;
      const hops = Math.min(...targetRooms.map(t => roomRoute(end, t).length));
      return hops * 100 + along;
    };
    const end = cost(c.a) <= cost(c.b) ? c.a : c.b;
    const sEnd = end === c.a ? 0 : total;
    out.push(...verticesBetween(c.path, s0, sEnd).map(p => ({ p })), { p: doorPos(c, end), door: doorKey(c, end) }, { p: insideDoor(c, end) });
    room = end;
  } else {
    room = fromZone;
  }

  if (isRoom(dest.zone)) {
    let r = room;
    for (const next of roomRoute(room, dest.zone)) { out.push(...roomHop(r, next)); r = next; }
    out.push({ p: dest.p });
    return out;
  }
  if (dest.zone === "exit") {
    let r = room;
    for (const next of roomRoute(room, EXIT_ROOM)) { out.push(...roomHop(r, next)); r = next; }
    out.push({ p: [0, 23.2] }, { p: EXIT_CORRIDOR.door.pos, door: "exit" }, { p: dest.p });
    return out;
  }
  const c = CORRIDOR_BY_ID.get(dest.zone);
  if (!c) return null;
  const ends = [c.a, c.b];
  const end = ends.includes(room) ? room : ends.reduce((a, b) => (roomRoute(room, a).length <= roomRoute(room, b).length ? a : b));
  let r = room;
  for (const next of roomRoute(room, end)) { out.push(...roomHop(r, next)); r = next; }
  const sStart = end === c.a ? 0 : cumulative(c.path).at(-1)!;
  out.push({ p: doorPos(c, end), door: doorKey(c, end) }, ...verticesBetween(c.path, sStart, paramOf(c.path, dest.p)).map(p => ({ p })), { p: dest.p });
  return out;
}

export function exitRoute(from: Vec2, fromZone: ZoneId) {
  return planRoute(from, fromZone, { zone: "exit", p: EXIT_POINT });
}

// ---------------------------------------------------------------- perception
/** Doorways joining two zones (room<->corridor, or the sealed room<->exit stub). */
export function doorwaysBetween(a: ZoneId, b: ZoneId) {
  return DOORWAYS.filter(d => (d.room === a && (d.corridor ?? "exit") === b) || (d.room === b && (d.corridor ?? "exit") === a));
}

/**
 * Line of sight from fixed geometry: same zone within range, or adjacent zones when
 * both people are near the doorway between them (looking through or down a corridor).
 * Cover is handled by the caller (hidden people are never visible).
 */
export function canSee(viewer: Vec2, vz: ZoneId, target: Vec2, tz: ZoneId): boolean {
  if (dist(viewer, target) > TUNING.sightRange) return false;
  if (vz === tz) return true;
  return doorwaysBetween(vz, tz).some(d => dist(viewer, d.pos) <= 10 && dist(target, d.pos) <= TUNING.doorwaySightRange);
}

/** Can a sound at `src` be heard at `at`? Walls muffle it: other zones need the source nearer. */
export function canHear(at: Vec2, az: ZoneId, src: Vec2, sz: ZoneId, radius: number): boolean {
  const d = dist(at, src);
  if (az === sz) return d <= radius;
  const adjacent = doorwaysBetween(az, sz).length > 0;
  return d <= radius * (adjacent ? 0.75 : 0.4);
}

/** Point `d` meters from a doorway into its room (where a blocker stands). */
export function blockSpot(doorKeyId: string): Vec2 | null {
  const d = DOORWAYS.find(x => x.key === doorKeyId);
  if (!d) return null;
  return toward(d.pos, ROOMS[d.room].center, 0.6);
}
/** Where a frozen blocker staggers to: further into its room, clear of the doorway. */
export function staggerSpot(doorKeyId: string): Vec2 | null {
  const d = DOORWAYS.find(x => x.key === doorKeyId);
  if (!d) return null;
  return toward(d.pos, ROOMS[d.room].center, 0.6 + TUNING.staggerDistance);
}

export { toward };
