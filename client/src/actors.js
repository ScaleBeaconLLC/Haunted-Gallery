// Placeholder cast stand-ins (capsule body + head, per-character tint) and their
// animation along doorway paths. NO final character models or animation clips exist
// yet; see PROGRESS.md. Swap `buildBody` for imported GLB models when they arrive.
import * as pc from 'playcanvas';
import { CAST, CURATOR, ROOMS, corridorBetween, standingSpot, EXIT_CORRIDOR, EXIT_POINT } from '@game/data.ts';
import { mat } from './world.js';

const INFECTED_SKIN = '#6f8f5a';

export function castInfo(id) {
  return id === 'elias' ? CURATOR : CAST.find(c => c.id === id);
}

/** Waypoints for a travel leg, always through the connecting corridor's doorways. */
export function legPath(leg) {
  const from = standingSpot(leg.from, leg.fromSpot);
  if (leg.to === 'exit') {
    return [from, [EXIT_CORRIDOR.door.pos[0], EXIT_CORRIDOR.door.pos[1] + 1.2], EXIT_CORRIDOR.door.pos, EXIT_POINT];
  }
  if (leg.to === leg.from) {
    const hide = leg.hide ? ROOMS[leg.from].hides.find(h => h.id === leg.hide) : null;
    return [from, hide ? hide.pos : standingSpot(leg.to, leg.toSpot)];
  }
  const c = corridorBetween(leg.from, leg.to);
  const to = standingSpot(leg.to, leg.toSpot);
  if (!c) return [from, to];
  // Step a little inside each room at the doorway so paths don't clip the door frame.
  const inset = (p, q, d) => { const dx = q[0] - p[0], dz = q[1] - p[1]; const l = Math.hypot(dx, dz) || 1; return [p[0] - dx / l * d, p[1] - dz / l * d]; };
  const pts = c.path;
  const first = inset(pts[0], pts[1], 1.2);
  const last = inset(pts[pts.length - 1], pts[pts.length - 2], 1.2);
  return [from, first, ...pts, last, to];
}

function pathLength(pts) {
  let l = 0; for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return l;
}
export function pointAlong(pts, t) {
  const total = pathLength(pts);
  let d = Math.max(0, Math.min(1, t)) * total;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (d <= seg || i === pts.length - 1) {
      const k = seg ? Math.min(1, d / seg) : 1;
      return { pos: [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k], dir: [pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]] };
    }
    d -= seg;
  }
  return { pos: pts[pts.length - 1], dir: [0, 1] };
}

export class ActorView {
  constructor(app, id) {
    this.app = app;
    this.id = id;
    this.info = castInfo(id);
    this.entity = new pc.Entity(`Actor_${id}`);
    this.pos = [0, 0];
    this.target = null; // [x, z]
    this.path = null;   // { pts, start, dur }
    this.yaw = 0;
    this.status = 'alive';
    this.stunned = false;
    this.hidden = false;
    this.isMe = false;
    this.fading = 0;
    this.walkPhase = Math.random() * 6;
    this.buildBody();
    app.root.addChild(this.entity);
    this.entity.enabled = false;
  }

  buildBody() {
    const isElias = this.id === 'elias';
    const tint = this.info.color;
    const body = new pc.Entity('Body');
    body.addComponent('render', { type: 'capsule', material: mat(tint, { gloss: 0.3 }), castShadows: false });
    body.setLocalScale(isElias ? 0.62 : 0.55, isElias ? 1.05 : 0.9, isElias ? 0.62 : 0.55);
    body.setLocalPosition(0, isElias ? 1.05 : 0.9, 0);
    const head = new pc.Entity('Head');
    head.addComponent('render', { type: 'sphere', material: mat('#d9b89c'), castShadows: false });
    head.setLocalScale(0.34, 0.38, 0.34);
    head.setLocalPosition(0, isElias ? 2.2 : 1.92, 0);
    const nose = new pc.Entity('Facing');
    nose.addComponent('render', { type: 'box', material: mat('#222'), castShadows: false });
    nose.setLocalScale(0.1, 0.06, 0.12);
    nose.setLocalPosition(0, isElias ? 2.25 : 1.97, 0.19);
    this.body = body; this.head = head;
    this.entity.addChild(body); this.entity.addChild(head); this.entity.addChild(nose);
    if (isElias) {
      const collar = new pc.Entity('Cape');
      collar.addComponent('render', { type: 'box', material: mat('#140407'), castShadows: false });
      collar.setLocalScale(0.9, 1.5, 0.15);
      collar.setLocalPosition(0, 1.25, -0.3);
      this.entity.addChild(collar);
    }
    // Selection ring for "you".
    const ring = new pc.Entity('MeRing');
    ring.addComponent('render', { type: 'cylinder', material: mat('#111', { emissive: '#f2d27a', emissiveIntensity: 0.9 }), castShadows: false });
    ring.setLocalScale(1.1, 0.02, 1.1);
    ring.setLocalPosition(0, 0.04, 0);
    ring.enabled = false;
    this.ring = ring;
    this.entity.addChild(ring);
  }

  setMe(isMe) { this.isMe = isMe; this.ring.enabled = isMe; }

  setStatus(status, stunned) {
    if (status === this.status && stunned === this.stunned) return;
    this.status = status; this.stunned = stunned;
    const infected = status === 'infected' && this.id !== 'elias';
    this.head.render.material = stunned ? mat('#dfe8ff', { emissive: '#9fb8ff', emissiveIntensity: 0.8 })
      : infected ? mat(INFECTED_SKIN, { emissive: '#1d3a12', emissiveIntensity: 0.3 }) : mat('#d9b89c');
    this.body.render.material = stunned ? mat('#c8d4ff', { emissive: '#7f9cff', emissiveIntensity: 0.5 })
      // Infected guests keep their clothing tint so everyone can still tell who turned.
      : infected ? mat(this.info.color, { emissive: '#12300a', emissiveIntensity: 0.5 }) : mat(this.info.color, { gloss: 0.3 });
  }

  place([x, z]) { this.pos = [x, z]; this.target = null; this.path = null; this.apply(); }
  moveTo([x, z]) { if (!this.target || this.target[0] !== x || this.target[1] !== z) { this.target = [x, z]; this.path = null; } }
  follow(pts, start, dur) { this.path = { pts, start, dur }; this.target = null; }

  faceTowards([x, z]) {
    const dx = x - this.pos[0], dz = z - this.pos[1];
    if (Math.hypot(dx, dz) > 0.01) this.yaw = Math.atan2(dx, dz) * 180 / Math.PI;
  }

  update(dt, now) {
    let moving = false;
    if (this.path) {
      const t = (now - this.path.start) / this.path.dur;
      const { pos, dir } = pointAlong(this.path.pts, t);
      if (Math.hypot(dir[0], dir[1]) > 0.01) this.yaw = Math.atan2(dir[0], dir[1]) * 180 / Math.PI;
      moving = t > 0 && t < 1;
      this.pos = pos;
      if (t >= 1) this.path = null;
    } else if (this.target) {
      const dx = this.target[0] - this.pos[0], dz = this.target[1] - this.pos[1];
      const d = Math.hypot(dx, dz);
      const step = Math.min(d, dt * 2.6);
      if (d > 0.02) {
        this.pos = [this.pos[0] + dx / d * step, this.pos[1] + dz / d * step];
        this.yaw = Math.atan2(dx, dz) * 180 / Math.PI;
        moving = true;
      } else this.target = null;
    }
    if (moving && !this.stunned) this.walkPhase += dt * 9;
    this.apply(moving);
  }

  apply(moving = false) {
    const bob = moving ? Math.abs(Math.sin(this.walkPhase)) * 0.08 : 0;
    const hunch = this.status === 'infected' && this.id !== 'elias' ? 14 : 0;
    this.entity.setLocalPosition(this.pos[0], bob, this.pos[1]);
    this.entity.setLocalEulerAngles(hunch, this.yaw, moving ? Math.sin(this.walkPhase) * 3 : 0);
  }

  headWorld() { const p = this.entity.getPosition(); return new pc.Vec3(p.x, p.y + (this.id === 'elias' ? 2.6 : 2.3), p.z); }
  destroy() { this.entity.destroy(); }
}
