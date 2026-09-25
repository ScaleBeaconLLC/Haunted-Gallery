// The PlayCanvas side of the phone client: app/device setup, the touch orbit camera,
// reconciling the server's private view into visible actors, travel along doorway
// paths, opening cinematic staging and flash/bite effects.
import * as pc from 'playcanvas';
import { CAMERA_START, ROOMS, TUNING, standingSpot } from '@game/data.ts';
import { World, mat, walkRects } from './world.js';

const WALK_RECTS = walkRects().map(w => w.r);
/** The walkable rectangle containing a point (rooms first, since they are listed first). */
function rectAt(x, z) {
  return WALK_RECTS.find(([x0, x1, z0, z1]) => x >= x0 - 0.05 && x <= x1 + 0.05 && z >= z0 - 0.05 && z <= z1 + 0.05) ?? null;
}
import { ActorView, castInfo, legPath } from './actors.js';

export class Game3D {
  constructor(canvas, { now }) {
    this.now = now; // server-synced clock
    const app = new pc.Application(canvas, {
      mouse: new pc.Mouse(canvas),
      touch: 'ontouchstart' in window ? new pc.TouchDevice(canvas) : undefined,
      graphicsDeviceOptions: { antialias: false, powerPreference: 'high-performance', alpha: false },
    });
    this.app = app;
    app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
    app.setCanvasResolution(pc.RESOLUTION_AUTO);
    // Cap the render resolution on high-DPI phones to protect frame pacing and battery.
    app.graphicsDevice.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    window.addEventListener('resize', () => app.resizeCanvas());

    this.world = new World(app);
    this.actors = new Map();
    this.me = null;
    this.view = null;
    this.phase = 'lobby';
    this.flashLight = null;

    const cam = new pc.Entity('Camera');
    cam.addComponent('camera', { clearColor: new pc.Color(0.02, 0.015, 0.03), fov: 55, nearClip: 0.2, farClip: 80 });
    cam.camera.toneMapping = pc.TONEMAP_ACES;
    app.root.addChild(cam);
    this.camera = cam;
    this.orbit = { yaw: 180, pitch: 60, dist: 14, target: new pc.Vec3(CAMERA_START.pos[0], 1, CAMERA_START.pos[1]), focus: new pc.Vec3(-11.75, 1, 9), auto: 0 };
    this.bindInput(canvas);

    const flash = new pc.Entity('FlashLight');
    flash.addComponent('light', { type: 'omni', color: new pc.Color(1, 1, 0.95), intensity: 0, range: 14, castShadows: false });
    app.root.addChild(flash);
    this.flashLight = flash;
    this.flashT = 0;

    this.stats = { frames: 0, acc: 0, fps: 0, worst: 0, ms: 0 };
    app.on('update', dt => this.update(dt));
    app.start();
  }

  bindInput(canvas) {
    const o = this.orbit;
    const pointers = new Map();
    let pinch = 0;
    canvas.addEventListener('pointerdown', e => { pointers.set(e.pointerId, [e.clientX, e.clientY]); canvas.setPointerCapture?.(e.pointerId); o.auto = 0; });
    canvas.addEventListener('pointermove', e => {
      if (!pointers.has(e.pointerId)) return;
      const [px, py] = pointers.get(e.pointerId);
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (pointers.size === 1) {
        o.yaw -= (e.clientX - px) * 0.35;
        o.pitch = Math.max(18, Math.min(80, o.pitch + (e.clientY - py) * 0.25));
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinch) o.dist = Math.max(4, Math.min(22, o.dist * pinch / d));
        pinch = d;
      }
    });
    const up = e => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = 0; };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', e => { o.dist = Math.max(4, Math.min(22, o.dist * (1 + Math.sign(e.deltaY) * 0.1))); e.preventDefault(); }, { passive: false });
  }

  actor(id) {
    let a = this.actors.get(id);
    if (!a) { a = new ActorView(this.app, id); this.actors.set(id, a); }
    return a;
  }

  setMe(id) {
    this.me = id;
    for (const [aid, a] of this.actors) a.setMe(aid === id);
  }

  /** Apply the server's private view for this phone. */
  applyView(view, pub) {
    this.view = view;
    this.phase = view.phase ?? pub?.phase ?? 'lobby';
    const now = this.now();
    if (!view.room) {
      for (const a of this.actors.values()) a.entity.enabled = false;
      return;
    }
    const seen = new Set();
    const travel = new Map((view.travel || []).map(l => [l.id, l]));
    const travelStart = pub ? pub.phaseEndsAt - TUNING.travelMs : now;

    for (const v of view.actors || []) {
      seen.add(v.id);
      const a = this.actor(v.id);
      a.setMe(v.id === this.me);
      a.setStatus(v.status, v.stunned || (this.openingFrozen && v.id === 'elias'));
      const firstShow = !a.entity.enabled;
      a.entity.enabled = true;
      const leg = travel.get(v.id);
      if (leg && this.phase === 'travel') {
        if (!a.path || a.legKey !== JSON.stringify(leg)) {
          a.legKey = JSON.stringify(leg);
          if (firstShow) a.place(legPath(leg)[0]);
          a.follow(legPath(leg), travelStart, TUNING.travelMs * 0.92);
        }
        continue;
      }
      a.legKey = null;
      const spot = v.hide ? ROOMS[view.room].hides.find(h => h.id === v.hide)?.pos : standingSpot(view.room, v.spot);
      if (!spot) continue;
      if (firstShow || this.phase === 'opening' && a.path == null && !a.target && Math.hypot(a.pos[0] - spot[0], a.pos[1] - spot[1]) > 8) a.place(spot);
      else if (!a.path) a.moveTo(spot);
    }
    // Arrivals from other rooms are only visible while they walk in.
    for (const leg of view.travel || []) {
      if (seen.has(leg.id)) continue;
      seen.add(leg.id);
      const a = this.actor(leg.id);
      if (!a.path || a.legKey !== JSON.stringify(leg)) {
        a.legKey = JSON.stringify(leg);
        a.entity.enabled = true;
        a.place(legPath(leg)[0]);
        a.follow(legPath(leg), travelStart, TUNING.travelMs * 0.92);
      }
    }
    // Actors no longer visible disappear once they finish walking out of view.
    this.visibleIds = seen;
    for (const [id, a] of this.actors) if (!seen.has(id) && !a.path) a.entity.enabled = false;

    // Camera prop: on the floor here, in my hands, or in a visible guest's hands.
    const cam = view.camera;
    const prop = this.world.cameraProp;
    if (this.phase === 'opening' && this.openingCameraHolder) {
      this.cameraHolder = this.openingCameraHolder;
      prop.enabled = true;
    } else if (cam?.mine) { this.cameraHolder = this.me; prop.enabled = true; }
    else if (cam?.heldBy) { this.cameraHolder = cam.heldBy; prop.enabled = true; }
    else if (cam?.onFloorHere && cam.floorPos) {
      this.cameraHolder = null; prop.enabled = true;
      prop.setLocalPosition(cam.floorPos[0], 0.15, cam.floorPos[1]);
      prop.setLocalEulerAngles(0, 35, 80);
    } else { this.cameraHolder = null; prop.enabled = false; }

    this.world.setExitOpen(!!view.exitOpen);
    this.world.showHideMarkers(view.room, !view.isHunter && view.status === 'alive');
  }

  focusRoom(room) {
    const [x, z] = ROOMS[room].center;
    this.orbit.focus.set(x, 1, z);
  }

  flashAt([x, z]) {
    this.flashLight.setLocalPosition(x, 2, z);
    this.flashT = 0.6;
  }

  update(dt) {
    const now = this.now();
    const positions = [];
    for (const a of this.actors.values()) {
      if (!a.entity.enabled) continue;
      a.update(dt, now);
      positions.push(a.pos);
      if (!a.path && this.visibleIds && !this.visibleIds.has(a.id)) a.entity.enabled = false;
    }
    this.world.updateDoors(dt, positions);

    // Camera prop follows its holder's hand.
    if (this.cameraHolder && this.actors.get(this.cameraHolder)?.entity.enabled) {
      const h = this.actors.get(this.cameraHolder);
      const yaw = h.yaw * Math.PI / 180;
      this.world.cameraProp.setLocalPosition(h.pos[0] + Math.sin(yaw) * 0.45 + Math.cos(yaw) * 0.3, 1.25, h.pos[1] + Math.cos(yaw) * 0.45 - Math.sin(yaw) * 0.3);
      this.world.cameraProp.setLocalEulerAngles(0, h.yaw, 0);
    }

    // Orbit camera: follow me (or the room/cinematic focus).
    const o = this.orbit;
    const me = this.me && this.actors.get(this.me);
    const followMe = me?.entity.enabled && this.phase !== 'opening';
    const goal = followMe ? new pc.Vec3(me.pos[0], 1, me.pos[1]) : o.focus;
    o.target.lerp(o.target, goal, Math.min(1, dt * 4));
    if (this.phase === 'opening') o.yaw += dt * 6;
    const yaw = o.yaw * Math.PI / 180, pitch = o.pitch * Math.PI / 180;
    let cx = o.target.x + Math.sin(yaw) * Math.cos(pitch) * o.dist;
    const cy = o.target.y + Math.sin(pitch) * o.dist;
    let cz = o.target.z + Math.cos(yaw) * Math.cos(pitch) * o.dist;
    // Keep the camera over the room (or corridor) the target stands in, so the view
    // never looks through a wall; near a wall this tilts toward a top-down view.
    const r = rectAt(o.target.x, o.target.z);
    if (r) {
      cx = Math.max(r[0] + 0.4, Math.min(r[1] - 0.4, cx));
      cz = Math.max(r[2] + 0.4, Math.min(r[3] - 0.4, cz));
    }
    this.camera.setLocalPosition(cx, cy, cz);
    this.camera.lookAt(o.target);

    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flashLight.light.intensity = Math.max(0, this.flashT / 0.6) * 12;
    }

    // Frame pacing stats for on-device checks (?debug=1).
    const s = this.stats;
    s.frames++; s.acc += dt; s.worst = Math.max(s.worst, dt);
    if (s.acc >= 1) {
      s.fps = s.frames / s.acc; s.ms = s.acc / s.frames * 1000; s.worstMs = s.worst * 1000; s.frames = 0; s.acc = 0; s.worst = 0;
      this.adaptResolution(s.fps);
    }
    this.onFrame?.(dt);
  }

  /**
   * Adaptive resolution: after 3 slow seconds in a row drop the pixel ratio a step
   * (never below 0.6); after 5 comfortable seconds raise it back toward the cap.
   */
  adaptResolution(fps) {
    const dev = this.app.graphicsDevice;
    const cap = Math.min(window.devicePixelRatio || 1, 1.5);
    this.slow = fps < 40 ? (this.slow || 0) + 1 : 0;
    this.fast = fps > 57 ? (this.fast || 0) + 1 : 0;
    if (this.slow >= 3 && dev.maxPixelRatio > 0.6) {
      dev.maxPixelRatio = Math.max(0.6, +(dev.maxPixelRatio - 0.25).toFixed(2));
      this.app.resizeCanvas(); this.slow = 0;
    } else if (this.fast >= 5 && dev.maxPixelRatio < cap) {
      dev.maxPixelRatio = Math.min(cap, +(dev.maxPixelRatio + 0.25).toFixed(2));
      this.app.resizeCanvas(); this.fast = 0;
    }
  }

  /** Screen-space positions for HTML name tags. */
  tags() {
    const out = [];
    const cam = this.camera.camera;
    const w = this.app.graphicsDevice.clientRect?.width ?? window.innerWidth;
    const h = this.app.graphicsDevice.clientRect?.height ?? window.innerHeight;
    const fwd = this.camera.forward;
    const cp = this.camera.getPosition();
    for (const a of this.actors.values()) {
      if (!a.entity.enabled) continue;
      const p = a.headWorld();
      const to = new pc.Vec3().sub2(p, cp);
      if (to.dot(fwd) <= 0) continue;
      const s = cam.worldToScreen(p);
      if (s.x < -50 || s.y < -50 || s.x > w + 50 || s.y > h + 50) continue;
      out.push({ id: a.id, x: s.x, y: s.y, name: castInfo(a.id)?.name.split(' ')[0], status: a.status, me: a.id === this.me, stunned: a.stunned });
    }
    return out;
  }

  // ---------------------------------------------------------------- opening cinematic staging
  openingBeat(id, pub) {
    const w = this.world;
    const portrait = ROOMS.portrait;
    if (id === 'arrival') {
      this.focusRoom('portrait');
      this.orbit.dist = 17; this.orbit.pitch = 52;
      w.setLockdown(false);
      if (w.paintingVeil) w.paintingVeil.enabled = true;
      this.openingCameraHolder = pub.photographer;
      this.openingFrozen = false;
    } else if (id === 'unveiling') {
      if (w.paintingVeil) w.paintingVeil.enabled = false;
    } else if (id === 'freeze') {
      this.openingFrozen = true;
      this.flashAt([portrait.rect[1] - 3, portrait.center[1]]);
      this.actor('elias').setStatus('infected', true);
    } else if (id === 'bite') {
      this.openingFrozen = false;
      const e = this.actor('elias');
      e.setStatus('infected', false);
      const b = this.actors.get(pub.birthday);
      if (b) e.moveTo([b.pos[0] + 0.6, b.pos[1]]);
      this.openingCameraHolder = null;
    } else if (id === 'lockdown') {
      w.setLockdown(true);
      setTimeout(() => w.setLockdown(false), 3500);
    }
  }
}

export { mat };
