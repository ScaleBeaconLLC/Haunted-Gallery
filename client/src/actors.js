// Placeholder cast stand-ins built from primitives: legs with each guest's own pants and
// shoes, torso, head and hair. Recognisable from the knees down (what you see from under
// a table). Infection only changes skin and posture, and only when the server says the
// face is actually readable from this phone. NO final character models or animation
// clips exist yet (see PROGRESS.md); swap `build` for imported GLB models later.
import * as pc from 'playcanvas';
import { CAST, CURATOR, hideSpot } from '@game/data.ts';
import { mat } from './world.js';

const SKIN = '#d9b89c';
const INFECTED_SKIN = '#7d9468';

export function castInfo(id) {
  return id === 'elias' ? CURATOR : CAST.find(c => c.id === id);
}

function part(parent, type, name, pos, scale, material) {
  const e = new pc.Entity(name);
  e.addComponent('render', { type, material, castShadows: false });
  e.setLocalPosition(...pos);
  e.setLocalScale(...scale);
  parent.addChild(e);
  return e;
}

export class ActorView {
  constructor(app, id) {
    this.app = app;
    this.id = id;
    this.info = castInfo(id);
    this.entity = new pc.Entity(`Actor_${id}`);
    this.pos = null;          // rendered position
    this.target = [0, 0];     // latest server position
    this.yaw = 0;
    this.targetYaw = 0;
    this.moving = false;
    this.running = false;
    this.revealed = false;
    this.stunned = null;
    this.action = null;
    this.walk = Math.random() * 6;
    this.bend = 0;
    this.crouch = 0;
    this.build();
    app.root.addChild(this.entity);
    this.entity.enabled = false;
  }

  build() {
    const tall = this.id === 'elias' ? 1.12 : 1;
    const i = this.info;
    const root = new pc.Entity('Rig');
    root.setLocalScale(tall, tall, tall);
    this.entity.addChild(root);
    this.rig = root;
    // Legs pivot at the hip so they can swing.
    this.legs = [-1, 1].map(s => {
      const hip = new pc.Entity('Hip');
      hip.setLocalPosition(0.12 * s, 0.86, 0);
      root.addChild(hip);
      part(hip, 'cylinder', 'Leg', [0, -0.42, 0], [0.17, 0.84, 0.17], mat(i.pants));
      part(hip, 'box', 'Shoe', [0, -0.82, 0.07], [0.16, 0.1, 0.3], mat(i.shoes, { gloss: 0.6 }));
      return hip;
    });
    // Torso pivots at the waist for bending into cover / searching / hunching.
    const waist = new pc.Entity('Waist');
    waist.setLocalPosition(0, 0.9, 0);
    root.addChild(waist);
    this.waist = waist;
    part(waist, 'capsule', 'Torso', [0, 0.38, 0], [0.5, 0.78, 0.34], mat(i.color, { gloss: 0.3 }));
    this.arms = [-1, 1].map(s => {
      const sh = new pc.Entity('Shoulder');
      sh.setLocalPosition(0.3 * s, 0.66, 0);
      waist.addChild(sh);
      part(sh, 'cylinder', 'Arm', [0, -0.3, 0], [0.11, 0.6, 0.11], mat(i.color));
      return sh;
    });
    this.head = part(waist, 'sphere', 'Head', [0, 0.98, 0], [0.3, 0.34, 0.3], mat(SKIN));
    part(waist, 'sphere', 'Hair', [0, 1.06, -0.03], [0.32, 0.22, 0.32], mat(i.hair));
    this.eyes = part(waist, 'box', 'Eyes', [0, 1.0, 0.14], [0.16, 0.04, 0.03], mat('#1a1a1a'));
    if (this.id === 'elias') part(waist, 'box', 'Cape', [0, 0.3, -0.22], [0.7, 1.2, 0.06], mat('#140407'));
    // A ring under your own character only (never on anyone else).
    this.ring = part(this.entity, 'torus', 'MeRing', [0, 0.04, 0], [1.1, 0.25, 1.1], mat('#111', { emissive: '#f2d27a', emissiveIntensity: 1.1 }));
    this.ring.enabled = false;
  }

  /** Apply the server's description of this person as seen from this phone. */
  sync(v, now) {
    this.target = v.pos;
    this.targetYaw = v.yaw;
    this.moving = v.moving;
    this.running = v.running;
    this.action = v.action;
    this.coverPose = v.coverPose ?? null;
    this.searchLow = v.action === 'searching' && v.searchSpot ? hideSpot(v.searchSpot)?.spot.pose === 'under' : false;
    if (!this.pos) this.pos = [...v.pos];
    const revealed = !!v.revealed;
    const stunned = v.stunned || null;
    if (revealed !== this.revealed || stunned !== this.stunned) {
      this.revealed = revealed; this.stunned = stunned;
      const skin = stunned === 'frozen' ? mat('#dfe8ff', { emissive: '#9fb8ff', emissiveIntensity: 0.9 })
        : revealed ? mat(INFECTED_SKIN, { emissive: '#1d3a12', emissiveIntensity: 0.35 }) : mat(SKIN);
      this.head.render.material = skin;
      this.eyes.render.material = revealed ? mat('#300', { emissive: '#ff3a1a', emissiveIntensity: 0.9 }) : mat('#1a1a1a');
    }
    this.lastSeen = now;
  }

  update(dt) {
    if (!this.pos) return;
    const dx = this.target[0] - this.pos[0], dz = this.target[1] - this.pos[1];
    const d = Math.hypot(dx, dz);
    if (d > 4) this.pos = [...this.target];
    else { const k = Math.min(1, dt * 9); this.pos = [this.pos[0] + dx * k, this.pos[1] + dz * k]; }
    let dy = ((this.targetYaw - this.yaw + 540) % 360) - 180;
    this.yaw += dy * Math.min(1, dt * 10);

    const walking = this.moving && !this.stunned;
    if (walking) this.walk += dt * (this.running ? 13 : 8);
    const swing = walking ? Math.sin(this.walk) * (this.running ? 40 : 25) : 0;
    this.legs[0].setLocalEulerAngles(swing, 0, 0);
    this.legs[1].setLocalEulerAngles(-swing, 0, 0);
    const reach = this.action === 'grabbing' ? -80 : 0;
    this.arms[0].setLocalEulerAngles(reach || -swing * 0.8, 0, 0);
    this.arms[1].setLocalEulerAngles(reach || swing * 0.8, 0, 0);
    // Bend: crouching into cover, searching low, or the hunch of a visibly turned guest.
    // Getting under a bed or table means going nearly flat; into a wardrobe means stepping in upright.
    const entering = this.action === 'entering_cover';
    const under = entering && this.coverPose === 'under';
    const goal = this.action === 'searching' ? (this.searchLow ? 70 : 55) : under ? 84 : entering && this.coverPose === 'inside' ? 5 : entering ? 45 : this.action === 'grabbed' ? -15
      : this.revealed && this.id !== 'elias' ? 16 : this.running ? 10 : 0;
    this.bend += (goal - this.bend) * Math.min(1, dt * 6);
    this.waist.setLocalEulerAngles(this.bend, 0, 0);
    const bob = walking ? Math.abs(Math.sin(this.walk)) * (this.running ? 0.07 : 0.04) : 0;
    // Searching low: drop into a crouch so the face comes down to table height.
    this.crouch += ((this.action === 'searching' ? (this.searchLow ? 0.75 : 0.3) : under ? 0.8 : entering && this.coverPose !== 'inside' ? 0.35 : 0) - this.crouch) * Math.min(1, dt * 5);
    const shake = this.action === 'grabbed' ? Math.sin(performance.now() / 40) * 0.03 : 0;
    this.entity.setLocalPosition(this.pos[0] + shake, bob - this.crouch, this.pos[1]);
    this.entity.setLocalEulerAngles(0, this.yaw, 0);
  }

  headWorld() { const p = this.entity.getPosition(); return new pc.Vec3(p.x, p.y + (this.id === 'elias' ? 2.3 : 2.1), p.z); }
  destroy() { this.entity.destroy(); }
}
