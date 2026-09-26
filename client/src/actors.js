// How each person is drawn: a rigged, animated character model (CC0 Quaternius parts,
// dressed per guest in client/src/cast-looks.js) driven by a small state machine that
// maps the server's description (moving / running / action / cover pose / stunned) to
// animation clips, plus limited procedural adjustment (infected hunch, looking under a
// bed, lying flat to crawl under cover). While the model downloads, a primitive stand-in
// is shown. Infection only changes skin and posture, and only when the server says the
// face is actually readable from this phone.
import * as pc from 'playcanvas';
import { CAST, CURATOR, TUNING, hideSpot } from '@game/data.ts';
import { mat } from './world.js';
import { Character, groundSpeed, loadAnims, loadPart, loadSkeleton } from './characters.js';
import { lookParts, SKIN as MODEL_SKIN } from './cast-looks.js';

const SKIN = '#d9b89c';
const INFECTED_SKIN = '#7d9468';
const FROZEN = '#dfe8ff';
// Slightly larger than life so people read clearly from the overhead camera on a phone.
const MODEL_SCALE = 1.12;

export function castInfo(id) {
  return id === 'elias' ? CURATOR : CAST.find(c => c.id === id);
}

/** Scene phase, set by Game3D (the party idles differently from the hunt). */
let scenePhase = 'lobby';
export const setScenePhase = p => { scenePhase = p; };

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
    this.lie = 0;
    this.lookUnder = 0;
    this.speedNow = 0;
    this.seed = Math.random();
    this.body = new pc.Entity('Body');   // yaw/position root for model or stand-in
    this.entity.addChild(this.body);
    this.buildStandIn();
    this.ring = part(this.entity, 'torus', 'MeRing', [0, 0.04, 0], [1.1, 0.25, 1.1], mat('#111', { emissive: '#f2d27a', emissiveIntensity: 1.1 }));
    this.ring.enabled = false;
    app.root.addChild(this.entity);
    this.entity.enabled = false;
    this.loadModel();
  }

  /** Primitive placeholder shown only until the character model has downloaded. */
  buildStandIn() {
    const i = this.info;
    const root = new pc.Entity('StandIn');
    this.body.addChild(root);
    this.standIn = root;
    this.legs = [-1, 1].map(s => {
      const hip = new pc.Entity('Hip');
      hip.setLocalPosition(0.12 * s, 0.86, 0);
      root.addChild(hip);
      part(hip, 'cylinder', 'Leg', [0, -0.42, 0], [0.17, 0.84, 0.17], mat(i.pants));
      part(hip, 'box', 'Shoe', [0, -0.82, 0.07], [0.16, 0.1, 0.3], mat(i.shoes, { gloss: 0.6 }));
      return hip;
    });
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
  }

  async loadModel() {
    try {
      const look = lookParts(this.id);
      const [clips, skeleton, ...containers] = await Promise.all([
        loadAnims(this.app), loadSkeleton(this.app), ...look.parts.map(p => loadPart(this.app, p.id))]);
      if (this.destroyed) return;
      const c = new Character(skeleton, look.parts.map((p, i) => ({ kind: p.kind, container: containers[i] })), clips,
        { tints: look.tints, hide: look.hide, scale: look.scale * MODEL_SCALE });
      this.body.addChild(c.entity);
      this.model = c;
      this.skinKeys = [...c.materials.keys()].filter(k => /:Skin(_Darker)?$/.test(k));
      this.eyeKeys = [...c.materials.keys()].filter(k => /:Eye$/.test(k));
      this.standIn.enabled = false;
      this.applyLook();
    } catch (e) {
      console.warn(`character model for ${this.id} unavailable, keeping the stand-in`, e);
    }
  }

  /** Skin / eyes for the current revealed / frozen state. */
  applyLook() {
    const { revealed, stunned } = this;
    if (this.model) {
      for (const k of this.skinKeys) {
        if (stunned === 'frozen') this.model.tint(k, FROZEN, { emissive: '#9fb8ff', emissiveIntensity: 0.9 });
        else if (revealed) this.model.tint(k, INFECTED_SKIN, { emissive: '#1d3a12', emissiveIntensity: 0.35 });
        else this.model.tint(k, MODEL_SKIN);
      }
      for (const k of this.eyeKeys) this.model.tint(k, revealed ? '#330000' : null, revealed ? { emissive: '#ff3a1a', emissiveIntensity: 1 } : {});
    } else {
      this.head.render.material = stunned === 'frozen' ? mat(FROZEN, { emissive: '#9fb8ff', emissiveIntensity: 0.9 })
        : revealed ? mat(INFECTED_SKIN, { emissive: '#1d3a12', emissiveIntensity: 0.35 }) : mat(SKIN);
    }
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
      this.applyLook();
    }
    this.lastSeen = now;
  }

  /** Which clip this person is performing right now (one place decides the state). */
  animState() {
    const a = this.action, elias = this.id === 'elias';
    if (this.stunned === 'tangled') return 'hit2';
    if (a === 'grabbed') return 'recoil';
    if (a === 'grabbing') return 'grab';
    if (a === 'searching') return this.searchLow ? 'kneel_look' : 'inspect';
    if (a === 'entering_cover') return this.coverPose === 'inside' ? 'walk' : 'crouch_walk';
    if (a === 'peeking') return 'crouch_idle';
    if (this.moving) return this.running ? 'run' : elias || this.revealed ? 'walk_formal' : 'walk';
    if (a === 'blocking') return 'idle_alert';
    if (scenePhase === 'opening' && !elias) return this.seed < 0.45 ? 'talk' : 'idle_breathe';
    return this.revealed || elias ? 'idle_alert' : 'idle';
  }

  update(dt) {
    if (!this.pos) return;
    const px = this.pos[0], pz = this.pos[1];
    const dx = this.target[0] - this.pos[0], dz = this.target[1] - this.pos[1];
    const d = Math.hypot(dx, dz);
    if (d > 4) this.pos = [...this.target];
    else { const k = Math.min(1, dt * 9); this.pos = [this.pos[0] + dx * k, this.pos[1] + dz * k]; }
    // Measured ground speed of the rendered body, for foot-matched clip playback.
    const moved = Math.hypot(this.pos[0] - px, this.pos[1] - pz) / Math.max(dt, 1e-3);
    this.speedNow += (Math.min(moved, 6) - this.speedNow) * Math.min(1, dt * 6);
    let dy = ((this.targetYaw - this.yaw + 540) % 360) - 180;
    // Turn through the angle rather than snapping (faster when running).
    this.yaw += dy * Math.min(1, dt * (this.running ? 9 : 7));

    const entering = this.action === 'entering_cover';
    const under = entering && this.coverPose === 'under';
    const goalCrouch = under ? 0.25 : 0;
    this.crouch += (goalCrouch - this.crouch) * Math.min(1, dt * 5);
    // Going under a bed or table: the body lies forward and flat to crawl in.
    this.lie += ((under ? 1 : 0) - this.lie) * Math.min(1, dt * 4);
    const shake = this.action === 'grabbed' ? Math.sin(performance.now() / 40) * 0.03 : 0;
    this.entity.setLocalPosition(this.pos[0] + shake, 0, this.pos[1]);
    this.entity.setLocalEulerAngles(0, this.yaw, 0);

    if (this.model) {
      const m = this.model;
      const state = this.animState();
      m.play(state, state === 'recoil' || state === 'grab' ? 0.12 : 0.25);
      // Match playback to how fast the body actually travels (no foot sliding); freeze
      // completely when frozen by the flash (no idle sway through the freeze).
      const loco = { walk: TUNING.walkSpeed, walk_formal: TUNING.walkSpeed, run: TUNING.runSpeed, crouch_walk: 1.2 }[state];
      m.speed = this.stunned === 'frozen' ? 0
        : loco ? Math.max(0.55, Math.min(1.8, Math.max(this.speedNow, loco * 0.6) / groundSpeed(state))) : 1;
      this.body.setLocalPosition(0, -this.crouch - this.lie * 0.55 - this.lookUnder * 0.2, -this.lie * 0.2);
      this.body.setLocalEulerAngles(this.lie * 72, 0, 0);
      // Procedural layer on top of the clip (applied after the animation system evaluates).
      const b = m.bones;
      const hunch = this.revealed && this.id !== 'elias' ? 14 : 0;
      // Looking under a bed: from the kneel, lean the torso down and lift the chin so the
      // face comes into the opening (and into the hidden player's view).
      this.lookUnder += ((this.action === 'searching' && this.searchLow ? 1 : 0) - this.lookUnder) * Math.min(1, dt * 5);
      const u = this.lookUnder;
      if (hunch || u > 0.01) {
        b.Abdomen?.rotateLocal(60 * u, 0, 0);
        b.Chest?.rotateLocal(hunch * 0.6 + 50 * u, 0, 0);
        b.Neck?.rotateLocal(hunch * 0.4 - 85 * u, 0, 0);
        if (u > 0.01) b.Head?.rotateLocal(-40 * u, 0, 0);
      }
    } else {
      this.animateStandIn(dt, entering, under);
    }
  }

  animateStandIn(dt, entering, under) {
    const walking = this.moving && !this.stunned;
    if (walking) this.walk += dt * (this.running ? 13 : 8);
    const swing = walking ? Math.sin(this.walk) * (this.running ? 40 : 25) : 0;
    this.legs[0].setLocalEulerAngles(swing, 0, 0);
    this.legs[1].setLocalEulerAngles(-swing, 0, 0);
    const reach = this.action === 'grabbing' ? -80 : 0;
    this.arms[0].setLocalEulerAngles(reach || -swing * 0.8, 0, 0);
    this.arms[1].setLocalEulerAngles(reach || swing * 0.8, 0, 0);
    const goal = this.action === 'searching' ? (this.searchLow ? 70 : 55) : under ? 84 : entering && this.coverPose === 'inside' ? 5 : entering ? 45 : this.action === 'grabbed' ? -15
      : this.revealed && this.id !== 'elias' ? 16 : this.running ? 10 : 0;
    this.bend += (goal - this.bend) * Math.min(1, dt * 6);
    this.waist.setLocalEulerAngles(this.bend, 0, 0);
    const bob = walking ? Math.abs(Math.sin(this.walk)) * (this.running ? 0.07 : 0.04) : 0;
    const standCrouch = this.action === 'searching' ? (this.searchLow ? 0.75 : 0.3) : under ? 0.8 : entering && this.coverPose !== 'inside' ? 0.35 : 0;
    this.body.setLocalPosition(0, bob - standCrouch, 0);
  }

  headWorld() {
    const h = this.model?.bones.Head;
    if (h) { const p = h.getPosition(); return new pc.Vec3(p.x, p.y + 0.45, p.z); }
    const p = this.entity.getPosition();
    return new pc.Vec3(p.x, p.y + (this.id === 'elias' ? 2.3 : 2.1), p.z);
  }
  destroy() { this.destroyed = true; this.entity.destroy(); }
}
