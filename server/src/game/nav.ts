/**
 * Navigation and perception geometry. Rooms are convex rectangles; between rooms routes
 * follow corridor polylines through the doorways. Inside a room with furniture
 * (RoomDef.obstacles) every leg is planned on a 0.25 m occupancy grid (A*, 8-connected,
 * then string-pulled with exact line-of-sight tests), so nobody walks through a table;
 * rooms without obstacles keep straight lines. Nothing here knows where anyone is:
 * routes use only fixed geometry.
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
  return refineRoute(from, rawRoute(from, fromZone, dest));
}

/** The doorway route (corridor polylines, straight lines inside rooms). */
function rawRoute(from: Vec2, fromZone: ZoneId, dest: Destination): Waypoint[] | null {
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

/**
 * The doorway through which a route from (from, fromZone) enters `room`, and the unit
 * direction pointing into the room. Null when already in that room (or unreachable).
 */
export function entryOf(from: Vec2, fromZone: ZoneId, room: RoomId): { door: Vec2; key: string; inward: Vec2 } | null {
  if (fromZone === room) return null;
  const route = rawRoute(from, fromZone, { zone: room, p: ROOMS[room].center });
  if (!route) return null;
  for (let k = route.length - 2; k >= 0; k--) {
    const w = route[k];
    if (!w.door) continue;
    const next = route[k + 1].p;
    const l = dist(w.p, next) || 1;
    return { door: w.p, key: w.door, inward: [(next[0] - w.p[0]) / l, (next[1] - w.p[1]) / l] };
  }
  return null;
}

// ---------------------------------------------------------------- in-room pathfinding
/** Walls are 0.3 m thick and centred on the room edge: their inner face is this far inside. */
export const WALL_INNER = 0.15;
/** Occupancy grid resolution (m). */
export const NAV_CELL = 0.25;
type Rect = [number, number, number, number];

interface RoomNav {
  /** Where a body centre may stand: the rect shrunk by the wall face and the body radius. */
  bounds: Rect;
  /** Furniture footprints inflated by the body radius. */
  obs: Rect[];
  grid: { x0: number; z0: number; nx: number; nz: number; free: Uint8Array } | null;
}
const NAV = new Map<RoomId, RoomNav>();

function navOf(room: RoomId): RoomNav {
  let n = NAV.get(room);
  if (!n) {
    const s = WALL_INNER + TUNING.bodyRadius, r = TUNING.bodyRadius;
    const [x0, x1, z0, z1] = ROOMS[room].rect;
    n = {
      bounds: [x0 + s, x1 - s, z0 + s, z1 - s],
      obs: (ROOMS[room].obstacles ?? []).map(([a, b, c, d]) => [a - r, b + r, c - r, d + r] as Rect),
      grid: null,
    };
    NAV.set(room, n);
  }
  return n;
}

/** Does this room have furniture to path around? */
export function hasObstacles(room: RoomId): boolean { return !!ROOMS[room].obstacles?.length; }

const insideOpen = (p: Vec2, [x0, x1, z0, z1]: Rect, e = 1e-6) => p[0] > x0 + e && p[0] < x1 - e && p[1] > z0 + e && p[1] < z1 - e;
const inBounds = (p: Vec2, [x0, x1, z0, z1]: Rect, e = 1e-6) => p[0] >= x0 - e && p[0] <= x1 + e && p[1] >= z0 - e && p[1] <= z1 + e;

/** Can a body stand at p in this room (clear of the walls and of every inflated obstacle)? */
export function isWalkable(room: RoomId, p: Vec2): boolean {
  const n = navOf(room);
  return inBounds(p, n.bounds) && !n.obs.some(r => insideOpen(p, r));
}

/** Does the segment a-b pass through the interior of the rectangle? (Liang-Barsky clip.) */
function segmentHits(a: Vec2, b: Vec2, [x0, x1, z0, z1]: Rect): boolean {
  const e = 1e-6;
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const clip = (p: number, q: number) => {
    if (Math.abs(p) < 1e-12) return q > 0;
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  };
  if (!clip(-dx, a[0] - (x0 + e)) || !clip(dx, (x1 - e) - a[0]) || !clip(-dz, a[1] - (z0 + e)) || !clip(dz, (z1 - e) - a[1])) return false;
  return t1 - t0 > 1e-9;
}

/** Straight line of travel between two standable points of a room (no furniture in the way). */
export function clearLine(room: RoomId, a: Vec2, b: Vec2): boolean {
  const n = navOf(room);
  if (!inBounds(a, n.bounds) || !inBounds(b, n.bounds)) return false;
  return !n.obs.some(r => segmentHits(a, b, r));
}

function gridOf(room: RoomId) {
  const n = navOf(room);
  if (!n.grid) {
    const [x0, x1, z0, z1] = ROOMS[room].rect;
    const nx = Math.ceil((x1 - x0) / NAV_CELL), nz = Math.ceil((z1 - z0) / NAV_CELL);
    const free = new Uint8Array(nx * nz);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      free[j * nx + i] = isWalkable(room, [x0 + (i + 0.5) * NAV_CELL, z0 + (j + 0.5) * NAV_CELL]) ? 1 : 0;
    }
    n.grid = { x0, z0, nx, nz, free };
  }
  return n.grid;
}
const cellCentre = (g: { x0: number; z0: number; nx: number }, k: number): Vec2 =>
  [g.x0 + ((k % g.nx) + 0.5) * NAV_CELL, g.z0 + (Math.floor(k / g.nx) + 0.5) * NAV_CELL];

/**
 * The nearest point of this room where a body can stand (clear of walls and furniture) and
 * that joins the room's walkable floor (not a sliver wedged between furniture and a wall),
 * or null if there is none within maxDist.
 */
export function nearestWalkable(room: RoomId, p: Vec2, maxDist = Infinity): Vec2 | null {
  if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
  const furnished = hasObstacles(room);
  const usable = (q: Vec2) => isWalkable(room, q) && (!furnished || anchorCell(room, q) >= 0);
  if (usable(p)) return [p[0], p[1]];
  const n = navOf(room);
  const [bx0, bx1, bz0, bz1] = n.bounds;
  const clamp = (q: Vec2): Vec2 => [Math.min(Math.max(q[0], bx0), bx1), Math.min(Math.max(q[1], bz0), bz1)];
  const e = 1e-3;
  const cands: Vec2[] = [clamp(p)];
  for (const [x0, x1, z0, z1] of n.obs) {
    cands.push(clamp([x0 - e, p[1]]), clamp([x1 + e, p[1]]), clamp([p[0], z0 - e]), clamp([p[0], z1 + e]),
      clamp([x0 - e, z0 - e]), clamp([x0 - e, z1 + e]), clamp([x1 + e, z0 - e]), clamp([x1 + e, z1 + e]));
  }
  let best: Vec2 | null = null, bd = Infinity;
  cands.sort((a, b) => dist(p, a) - dist(p, b));
  for (const c of cands) if (usable(c)) { best = c; bd = dist(p, c); break; }
  if (!best) {
    const g = gridOf(room);
    for (let k = 0; k < g.free.length; k++) {
      if (!g.free[k]) continue;
      const c = cellCentre(g, k), d = dist(p, c);
      if (d < bd) { best = c; bd = d; }
    }
  }
  return best && bd <= maxDist + 1e-9 ? [round3(best[0]), round3(best[1])] : null;
}
const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** The free grid cell to start/finish A* from: the nearest one in plain sight of p (within `reach` cells). */
function anchorCell(room: RoomId, p: Vec2, reach = 3): number {
  const g = gridOf(room);
  const ci = Math.floor((p[0] - g.x0) / NAV_CELL), cj = Math.floor((p[1] - g.z0) / NAV_CELL);
  let best = -1, bd = Infinity;
  for (let r = 1; r <= reach && best < 0; r++) {
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
      if (i < 0 || j < 0 || i >= g.nx || j >= g.nz || !g.free[j * g.nx + i]) continue;
      const c = cellCentre(g, j * g.nx + i), d = dist(p, c);
      if (d < bd && clearLine(room, p, c)) { best = j * g.nx + i; bd = d; }
    }
  }
  return best;
}

/** A* over the room grid between two free cells; returns the cell centres (inclusive) or null. */
function astar(room: RoomId, si: number, ti: number): Vec2[] | null {
  const g = gridOf(room);
  const N = g.free.length, nx = g.nx;
  const gs = new Float64Array(N).fill(Infinity);
  const parent = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const tx = ti % nx, tz = Math.floor(ti / nx);
  const h = (k: number) => {
    const dx = Math.abs((k % nx) - tx), dz = Math.abs(Math.floor(k / nx) - tz);
    return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
  };
  // binary heap of [f, k]
  const heapF: number[] = [], heapK: number[] = [];
  const push = (f: number, k: number) => {
    let i = heapF.length; heapF.push(f); heapK.push(k);
    while (i > 0) { const p = (i - 1) >> 1; if (heapF[p] <= f) break; heapF[i] = heapF[p]; heapK[i] = heapK[p]; i = p; }
    heapF[i] = f; heapK[i] = k;
  };
  const pop = (): number => {
    const top = heapK[0];
    const f = heapF.pop()!, k = heapK.pop()!;
    if (heapF.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i, mf = f;
        if (l < heapF.length && heapF[l] < mf) { m = l; mf = heapF[l]; }
        if (r < heapF.length && heapF[r] < mf) { m = r; mf = heapF[r]; }
        if (m === i) break;
        heapF[i] = heapF[m]; heapK[i] = heapK[m]; i = m;
      }
      heapF[i] = f; heapK[i] = k;
    }
    return top;
  };
  gs[si] = 0; push(h(si), si);
  while (heapF.length) {
    const k = pop();
    if (closed[k]) continue;
    if (k === ti) {
      const cells: Vec2[] = [];
      for (let c = k; c >= 0; c = parent[c]) cells.push(cellCentre(g, c));
      return cells.reverse();
    }
    closed[k] = 1;
    const i = k % nx, j = Math.floor(k / nx);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= nx || jj >= g.nz) continue;
      const q = jj * nx + ii;
      if (!g.free[q] || closed[q]) continue;
      // No corner cutting: a diagonal step needs both orthogonal neighbours free.
      if (di && dj && (!g.free[j * nx + ii] || !g.free[jj * nx + i])) continue;
      const ng = gs[k] + (di && dj ? Math.SQRT2 : 1);
      if (ng < gs[q]) { gs[q] = ng; parent[q] = k; push(ng + h(q), q); }
    }
  }
  return null;
}

/**
 * Waypoints (after `from`) for walking from `from` to `to` inside `room`, around its
 * furniture. An unstandable start or goal is first moved to the nearest standable point.
 * Every returned point is standable and every leg is a clear line. Null if unreachable.
 */
export function roomPath(room: RoomId, from: Vec2, to: Vec2): Vec2[] | null {
  const out: Vec2[] = [];
  let s: Vec2 = from;
  if (!isWalkable(room, s)) { const q = nearestWalkable(room, s); if (!q) return null; out.push(q); s = q; }
  let t: Vec2 | null = isWalkable(room, to) ? [to[0], to[1]] : nearestWalkable(room, to);
  if (!t) return null;
  if (clearLine(room, s, t)) { out.push(t); return out; }
  // Standing in a sliver the grid can't reach (e.g. steered there): step out onto the floor
  // first, in plain sight within 2 m if possible.
  let si = anchorCell(room, s);
  if (si < 0) {
    const wide = anchorCell(room, s, 8);
    const q = wide >= 0 ? cellCentre(gridOf(room), wide) : nearestWalkable(room, s);
    if (!q) return null;
    out.push(q); s = q; si = anchorCell(room, s);
    if (clearLine(room, s, t)) { out.push(t); return out; }
  }
  let ti = anchorCell(room, t);
  if (ti < 0) { t = nearestWalkable(room, t); if (!t) return null; ti = anchorCell(room, t); }
  if (si < 0 || ti < 0) return null;
  const cells = astar(room, si, ti);
  if (!cells) return null;
  // String pulling: from each anchor, jump to the furthest point still in plain sight.
  const pts: Vec2[] = [s, ...cells, t];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !clearLine(room, pts[i], pts[j])) j--;
    out.push(pts[j]);
    i = j;
  }
  return out;
}

/**
 * Replace every leg that runs inside one furnished room (both ends interior points, not
 * doorway waypoints) with a grid path around the furniture. Doorway waypoints are kept,
 * so zones still change at them.
 */
function refineRoute(from: Vec2, route: Waypoint[] | null): Waypoint[] | null {
  if (!route) return null;
  const out: Waypoint[] = [];
  let prev: Waypoint = { p: from };
  for (const wp of route) {
    if (!wp.door && !prev.door) {
      const z = zoneAt(prev.p);
      if (z && isRoom(z) && hasObstacles(z) && zoneAt(wp.p) === z) {
        const legs = roomPath(z, prev.p, wp.p);
        if (!legs) return null;
        for (const p of legs) out.push({ p });
        prev = { p: legs[legs.length - 1] };
        continue;
      }
    }
    out.push(wp);
    prev = wp;
  }
  return out;
}

/**
 * The nearest point where a body can stand inside a zone, within maxDist: rooms use the
 * wall faces and furniture; passages and the Garden Gate stub keep off their side walls.
 */
export function nearestStandable(zone: ZoneId, p: Vec2, maxDist = Infinity): Vec2 | null {
  if (isRoom(zone)) return nearestWalkable(zone, p, maxDist);
  const rects: Rect[] = zone === "exit" ? [EXIT_CORRIDOR.rect] : CORRIDOR_BY_ID.get(zone)?.rects ?? [];
  const s = WALL_INNER + TUNING.bodyRadius;
  let best: Vec2 | null = null, bd = Infinity;
  for (const [x0, x1, z0, z1] of rects) {
    // Only the narrow (cross) axis has walls; the long axis ends in doorways.
    const r: Rect = x1 - x0 <= z1 - z0 ? [x0 + s, x1 - s, z0, z1] : [x0, x1, z0 + s, z1 - s];
    const c: Vec2 = [Math.min(Math.max(p[0], r[0]), r[1]), Math.min(Math.max(p[1], r[2]), r[3])];
    const d = dist(p, c);
    if (d < bd) { best = c; bd = d; }
  }
  return best && bd <= maxDist + 1e-9 ? best : null;
}

// ---------------------------------------------------------------- perception
/** Doorways joining two zones (room<->corridor, or the sealed room<->exit stub). */
export function doorwaysBetween(a: ZoneId, b: ZoneId) {
  return DOORWAYS.filter(d => (d.room === a && (d.corridor ?? "exit") === b) || (d.room === b && (d.corridor ?? "exit") === a));
}

/**
 * Line of sight from fixed geometry: everyone in the same room (any distance), the same
 * passage within range, or adjacent zones when both people are near the doorway between
 * them (looking through or down a corridor). Cover is handled by the caller (hidden
 * people are never visible).
 */
export function canSee(viewer: Vec2, vz: ZoneId, target: Vec2, tz: ZoneId): boolean {
  if (vz === tz && isRoom(vz)) return true;
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
