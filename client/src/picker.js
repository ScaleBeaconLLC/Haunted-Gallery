// What a tap on the 3D view means. It only ever uses what this phone already knows (its own
// view and the fixed layout); the server validates and plans every resulting intent.
//
// Survivor priority: hiding place (<= 44 px of its cover, or on its footprint) > the camera on the
// floor > the Garden Gate > a floor point in your zone (move) > a point in a reachable room (travel).
// Mansion view: the Garden Gate or a point in a reachable room; anything else is "Too far".
// Hunter: a visible survivor (chase) > a hiding place in this room (search) > a doorway of this
// room (block) > floor (move) > a reachable room (travel).
import { CORRIDORS, DOORWAYS, EXIT_CORRIDOR, EXIT_POINT, ROOMS, ROOM_IDS, hideSpot } from '@game/data.ts';

const HIT_PX = 44;
const inRect = ([x, z], [x0, x1, z0, z1], e = 0.06) => x >= x0 - e && x <= x1 + e && z >= z0 - e && z <= z1 + e;

/** Same zone rules as the server: rooms first, then passages ("c0".."c15"), then the Garden Gate stub. */
export function zoneAt(p) {
  for (const id of ROOM_IDS) if (inRect(p, ROOMS[id].rect)) return id;
  for (const c of CORRIDORS) if (c.rects.some(r => inRect(p, r))) return c.id;
  if (inRect(p, EXIT_CORRIDOR.rect)) return 'exit';
  return null;
}
export const isRoom = z => !!ROOMS[z];
/** Rooms a zone touches: itself for a room, both ends for a passage, the sealed room for the gate stub. */
export function roomsOf(z) {
  if (isRoom(z)) return [z];
  if (z === 'exit') return ['sealed'];
  const c = CORRIDORS.find(x => x.id === z);
  return c ? [c.a, c.b] : [];
}

/** Ray against an axis-aligned box: distance or null. */
function rayBox(o, d, [x0, x1], [y0, y1], [z0, z1]) {
  let t0 = 0, t1 = Infinity;
  for (const [oo, dd, lo, hi] of [[o.x, d.x, x0, x1], [o.y, d.y, y0, y1], [o.z, d.z, z0, z1]]) {
    if (Math.abs(dd) < 1e-9) { if (oo < lo || oo > hi) return null; continue; }
    let a = (lo - oo) / dd, b = (hi - oo) / dd;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  return t0;
}

/**
 * Resolve a tap at CSS pixel (sx, sy). Returns { kind, ...intent fields, label, point } where kind is
 * an intent kind ('hide', 'pickup', 'exit', 'move', 'room', 'chase', 'search', 'block') or 'far' / 'none'.
 */
export function pickAt(game, view, sx, sy) {
  const me = view?.me;
  if (!me) return { kind: 'none' };
  const mode = game.mode;
  const { origin, dir } = game.screenRay(sx, sy);
  let floor = null;
  if (dir.y < -1e-4) {
    const t = -origin.y / dir.y;
    floor = [origin.x + dir.x * t, origin.z + dir.z * t];
  }
  const px = (x, y, z) => {
    const s = game.worldToScreen(x, y, z);
    return s ? Math.hypot(s.x - sx, s.y - sy) : Infinity;
  };
  const hunter = view.role === 'hunter';
  const overhead = mode === 'mansion';

  if (hunter) {
    const ho = view.huntOptions || {};
    if (!overhead) {
      // A visible survivor: chase.
      let best = null;
      for (const id of ho.chase ?? []) {
        const a = game.actors.get(id);
        if (!a?.entity.enabled || !a.pos) continue;
        const d = Math.min(px(a.pos[0], 1.0, a.pos[1]), px(a.pos[0], 0.1, a.pos[1]) + 6);
        if (d <= HIT_PX && (!best || d < best.d)) best = { d, id };
      }
      if (best) return { kind: 'chase', target: best.id, point: game.actors.get(best.id).pos };
      const spot = pickHide(ho.searchSpots ?? [], floor, origin, dir, px, null);
      if (spot) return { kind: 'search', spot: spot.id, label: spot.label, point: spot.pos };
      if (floor && me.inRoom) {
        const door = DOORWAYS.filter(d => d.room === me.zone && (ho.doors ?? []).some(x => x.key === d.key))
          .map(d => ({ d, m: Math.hypot(d.pos[0] - floor[0], d.pos[1] - floor[1]) }))
          .filter(x => x.m <= 1.5).sort((a, b) => a.m - b.m)[0];
        if (door) return { kind: 'block', door: door.d.key, point: door.d.pos };
      }
    }
    return floorPick(floor, me, ho.rooms ?? [], overhead);
  }

  const o = view.options || {};
  if (!overhead) {
    const spot = pickHide(o.hides ?? [], floor, origin, dir, px, me.hideState !== 'none' ? me.hide : null);
    if (spot) return { kind: 'hide', spot: spot.id, label: spot.label, point: spot.pos };
    const cf = view.camera?.floor;
    if (cf && px(cf[0], 0.15, cf[1]) <= HIT_PX) return { kind: 'pickup', point: cf };
  }
  if (o.exit) {
    const gate = px(EXIT_POINT[0], 1.2, EXIT_POINT[1]);
    if (gate <= (overhead ? 34 : 50) || (floor && inRect(floor, EXIT_CORRIDOR.rect, 0.2))) return { kind: 'exit', point: EXIT_POINT };
  }
  return floorPick(floor, me, o.rooms ?? [], overhead);
}

function pickHide(list, floor, origin, dir, px, current) {
  let best = null;
  for (const h of list) {
    if (h.id === current) continue;
    const found = hideSpot(h.id);
    if (!found) continue;
    const c = found.spot.cover;
    const [cx, cz] = c.pos, [w, d] = c.size;
    const onFoot = floor && Math.abs(floor[0] - cx) <= w / 2 + 0.15 && Math.abs(floor[1] - cz) <= d / 2 + 0.15;
    const hit = rayBox(origin, dir, [cx - w / 2, cx + w / 2], [0, c.height], [cz - d / 2, cz + d / 2]) != null;
    const dpx = px(cx, c.height / 2, cz);
    if (!onFoot && !hit && dpx > HIT_PX) continue;
    const score = onFoot || hit ? 0 : dpx;
    if (!best || score < best.score) best = { score, id: h.id, label: found.spot.label, pos: found.spot.pos };
  }
  return best;
}

function floorPick(floor, me, rooms, overhead) {
  if (!floor) return { kind: 'none' };
  const zone = zoneAt(floor);
  const p = [+floor[0].toFixed(2), +floor[1].toFixed(2)];
  if (!zone) return { kind: 'far', point: p };
  if (zone === me.zone) return { kind: 'move', p, point: p };
  if (isRoom(zone) && rooms.includes(zone)) return { kind: 'room', room: zone, p, point: p };
  // A passage leading out of your room: travel through it to the room at its far end.
  if (!isRoom(zone) && zone !== 'exit' && roomsOf(zone).includes(me.zone)) {
    const other = roomsOf(zone).find(r => r !== me.zone);
    if (other && rooms.includes(other)) return { kind: 'room', room: other, point: p };
  }
  if (isRoom(zone) && !me.inRoom && roomsOf(me.zone).includes(zone)) return { kind: 'room', room: zone, p, point: p };
  return { kind: 'far', point: p, zone, overhead };
}
