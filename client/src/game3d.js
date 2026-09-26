// The PlayCanvas side of the phone client.
//  - Bird's-eye travel camera: angled, follows behind your character, frames the
//    direction of travel, stays over the room/corridor you're in (never looks through
//    walls). Drag to swing it, pinch to zoom.
//  - First-person hiding camera: from inside your cover (under a table, behind a
//    display, behind a curtain). Drag to look within limits; hold Peek to lean out.
//  - Smooth transitions between the two. Only people the server says you can perceive
//    are ever rendered, so no camera angle can reveal anyone else.
import * as pc from 'playcanvas';
import { CAMERA_START, CAST, GALLERY, ROOMS, TUNING, hideSpot } from '@game/data.ts';
import { World, mat, walkRects } from './world.js';
import { ActorView, castInfo, setScenePhase } from './actors.js';

const WALK = walkRects();
const ROOM_RECTS = WALK.filter(w => w.kind === 'room').map(w => w.r);
const inR = ([x0, x1, z0, z1], x, z) => x >= x0 - 0.05 && x <= x1 + 0.05 && z >= z0 - 0.05 && z <= z1 + 0.05;
/**
 * Where the travel camera may sit: over the room you're in, or, in a narrow passage,
 * over the passage plus the rooms it joins (so the view isn't squeezed between walls).
 */
function rectAt(x, z) {
  const room = ROOM_RECTS.find(r => inR(r, x, z));
  if (room) return room;
  const passage = WALK.find(w => w.kind !== 'room' && inR(w.r, x, z));
  if (!passage) return null;
  const [px0, px1, pz0, pz1] = passage.r;
  const touching = ROOM_RECTS.filter(([x0, x1, z0, z1]) => x0 <= px1 + 0.1 && x1 >= px0 - 0.1 && z0 <= pz1 + 0.1 && z1 >= pz0 - 0.1);
  return [passage.r, ...touching].reduce(([a0, a1, b0, b1], [c0, c1, d0, d1]) => [Math.min(a0, c0), Math.max(a1, c1), Math.min(b0, d0), Math.max(b1, d1)]);
}
const POSE = {
  under: { height: 0.42, back: 0.35, fov: 72, peekOut: 1.1, peekUp: 0.45, yaw: 115, pitch: [-12, 22] },
  behind: { height: 1.05, back: 0, fov: 64, peekOut: 0.6, peekUp: 0.25, yaw: 125, pitch: [-30, 35] },
  curtain: { height: 1.5, back: 0, fov: 60, peekOut: 0.5, peekUp: 0, yaw: 110, pitch: [-30, 30] },
  // Standing inside a wardrobe/closet: a narrow view out through the ajar doors.
  inside: { height: 1.55, back: 0.25, fov: 52, peekOut: 0.75, peekUp: 0, yaw: 40, pitch: [-20, 15] },
};
const tmpMat = new pc.Mat4();
const UP = new pc.Vec3(0, 1, 0);

export class Game3D {
  constructor(canvas, { now }) {
    this.now = now;
    const app = new pc.Application(canvas, {
      mouse: new pc.Mouse(canvas),
      touch: 'ontouchstart' in window ? new pc.TouchDevice(canvas) : undefined,
      graphicsDeviceOptions: { antialias: false, powerPreference: 'high-performance', alpha: false, preserveDrawingBuffer: !!new URLSearchParams(location.search).get('capture') },
    });
    this.app = app;
    app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
    app.setCanvasResolution(pc.RESOLUTION_AUTO);
    app.graphicsDevice.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    window.addEventListener('resize', () => app.resizeCanvas());

    this.world = new World(app);
    this.actors = new Map();
    this.me = null;
    this.myView = null;
    this.phase = 'lobby';
    this.mode = 'menu';          // menu | opening | overhead | fp | escaped | capture
    this.peekAmount = 0;
    this.peeking = false;

    const cam = new pc.Entity('Camera');
    cam.addComponent('camera', { clearColor: new pc.Color(0.02, 0.015, 0.03), fov: 58, nearClip: 0.05, farClip: 80 });
    cam.camera.toneMapping = pc.TONEMAP_ACES;
    app.root.addChild(cam);
    this.camera = cam;
    this.camPos = new pc.Vec3(-11.75, 14, -2);
    this.camRot = new pc.Quat();
    this.view = { yawOff: 0, dist: 9.5, pitch: 58, followYaw: 0, fpYaw: 0, fpPitch: 0, orbit: 0 };
    this.bindInput(canvas);

    const flash = new pc.Entity('FlashLight');
    flash.addComponent('light', { type: 'omni', color: new pc.Color(1, 1, 0.95), intensity: 0, range: 14, castShadows: false });
    app.root.addChild(flash);
    this.flashLight = flash;
    this.flashT = 0;
    // A soft light carried with you so your character and nearby approaches read on small screens.
    const lantern = new pc.Entity('Lantern');
    lantern.addComponent('light', { type: 'omni', color: new pc.Color(1, 0.86, 0.66), intensity: 1.3, range: 6.5, castShadows: false });
    app.root.addChild(lantern);
    this.lantern = lantern;

    this.stats = { frames: 0, acc: 0, fps: 0, worst: 0, ms: 0 };
    app.on('update', dt => this.update(dt));
    app.start();
  }

  bindInput(canvas) {
    const v = this.view;
    const pointers = new Map();
    let pinch = 0;
    canvas.addEventListener('pointerdown', e => { pointers.set(e.pointerId, [e.clientX, e.clientY]); canvas.setPointerCapture?.(e.pointerId); });
    canvas.addEventListener('pointermove', e => {
      if (!pointers.has(e.pointerId)) return;
      const [px, py] = pointers.get(e.pointerId);
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      const dx = e.clientX - px, dy = e.clientY - py;
      if (pointers.size === 1) {
        if (this.mode === 'fp') {
          const pose = POSE[this.myView?.me?.pose] ?? POSE.behind;
          v.fpYaw = Math.max(-pose.yaw, Math.min(pose.yaw, v.fpYaw - dx * 0.3));
          v.fpPitch = Math.max(pose.pitch[0], Math.min(pose.pitch[1], v.fpPitch - dy * 0.25));
        } else {
          v.yawOff -= dx * 0.35;
          v.pitch = Math.max(30, Math.min(80, v.pitch + dy * 0.2));
        }
      } else if (pointers.size === 2 && this.mode !== 'fp') {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinch) v.dist = Math.max(5, Math.min(18, v.dist * pinch / d));
        pinch = d;
      }
    });
    const up = e => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = 0; };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', e => { if (this.mode !== 'fp') v.dist = Math.max(5, Math.min(18, v.dist * (1 + Math.sign(e.deltaY) * 0.1))); e.preventDefault(); }, { passive: false });
  }

  actor(id) {
    let a = this.actors.get(id);
    if (!a) { a = new ActorView(this.app, id); this.actors.set(id, a); }
    return a;
  }

  setMe(id) {
    if (this.me && this.actors.get(this.me)) this.actors.get(this.me).ring.enabled = false;
    this.me = id;
    if (id) this.actor(id).ring.enabled = true;
  }

  /** Apply this phone's private view: only perceived people exist here. */
  applyView(view, pub) {
    this.myView = view;
    this.phase = view?.phase ?? pub?.phase ?? 'lobby';
    setScenePhase(this.phase);
    if (this.world.exterior) this.world.exterior.enabled = this.phase === 'lobby' || this.phase === 'opening';
    const now = this.now();
    const seen = new Set();
    if (view?.me) {
      const me = this.actor(this.me);
      me.sync({ pos: view.me.pos, yaw: view.me.yaw, moving: view.me.moving, running: view.me.pace === 'run' && view.me.moving,
        revealed: view.status === 'infected', stunned: view.me.stunned,
        action: view.me.caught ? 'grabbed' : view.me.grabbing ? 'grabbing' : view.me.searching ? 'searching' : view.me.hideState === 'entering' ? 'entering_cover' : null,
        coverPose: view.me.hideState === 'entering' ? view.me.pose : null }, now);
      seen.add(this.me);
    }
    for (const v of view?.actors || []) { this.actor(v.id).sync(v, now); seen.add(v.id); }
    this.visible = seen;
    for (const [id, a] of this.actors) {
      a.entity.enabled = seen.has(id);
      if (!seen.has(id)) a.pos = null; // re-appear where the server says, never interpolate across unseen space
    }

    // Camera prop: on the floor where you can see it, or in a visible holder's hands.
    const cam = view?.camera;
    const prop = this.world.cameraProp;
    if (this.phase === 'opening' && this.openingCameraHolder) { this.cameraHolder = this.openingCameraHolder; prop.enabled = true; }
    else if (cam?.mine) { this.cameraHolder = this.me; prop.enabled = true; }
    else if (cam?.heldBy) { this.cameraHolder = cam.heldBy; prop.enabled = true; }
    else if (cam?.floor) {
      this.cameraHolder = null; prop.enabled = true;
      prop.setLocalPosition(cam.floor[0], 0.15, cam.floor[1]);
      prop.setLocalEulerAngles(0, 35, 80);
    } else { this.cameraHolder = null; prop.enabled = false; }

    this.world.syncSnares(view?.snares);
    this.world.setExitOpen(!!view?.exitOpen);
    const me = view?.me;
    this.world.showHideMarker(me && me.intent?.kind === 'hide' && me.intent.state === 'accepted' && !me.hide ? me.intent.target : null);

    // Camera mode follows the character's real state.
    const hiddenNow = me && (me.hideState === 'hidden') && view.status === 'alive';
    const viewing = me?.viewing && view.status === 'alive' && !me.caught;
    const next = this.phase === 'opening' ? 'opening' : view?.status === 'escaped' ? 'escaped' : hiddenNow ? 'fp' : viewing ? 'gallery' : me ? 'overhead' : 'menu';
    if (next === 'gallery' && (this.mode !== 'gallery' || this.galleryStation !== me.viewing)) { this.galleryStation = me.viewing; this.galleryIndex = 1; }
    if (next === 'fp' && this.mode !== 'fp') { this.view.fpYaw = 0; this.view.fpPitch = me.pose === 'under' ? 6 : 0; }
    this.mode = next;
  }

  setPeek(on) { this.peeking = on; }

  flashAt([x, z]) {
    this.flashLight.setLocalPosition(x, 2, z);
    this.flashT = 0.6;
  }

  /** Compute where the camera wants to be this frame. */
  desiredCamera(dt) {
    const v = this.view;
    const me = this.me && this.actors.get(this.me);
    const my = this.myView?.me;
    if (this.mode === 'capture') return this.captureShot;
    if (this.mode === 'fp' && my?.hidePos) {
      const pose = POSE[my.pose] ?? POSE.behind;
      const look = (my.look ?? 0) * Math.PI / 180;
      // Eye height follows the real clearance of this cover (a bed is lower than a table).
      const cover = my.hide ? hideSpot(my.hide)?.spot.cover : null;
      const eye = my.pose === 'under' && cover ? Math.min(pose.height, cover.height * 0.55) : pose.height;
      this.peekAmount += ((this.peeking ? 1 : 0) - this.peekAmount) * Math.min(1, dt * 7);
      const k = this.peekAmount;
      // Sit toward the back of the cover so its edge frames the view (e.g. the tabletop above).
      const out = pose.peekOut * k - pose.back * (1 - k);
      const pos = new pc.Vec3(my.hidePos[0] + Math.sin(look) * out, eye + pose.peekUp * k, my.hidePos[1] + Math.cos(look) * out);
      const yaw = look + v.fpYaw * Math.PI / 180, pitch = v.fpPitch * Math.PI / 180;
      const target = new pc.Vec3(pos.x + Math.sin(yaw) * Math.cos(pitch), pos.y + Math.sin(pitch), pos.z + Math.cos(yaw) * Math.cos(pitch));
      return { pos, target, near: 0.05, fov: pose.fov };
    }
    if (this.mode === 'gallery' && my?.viewing && me?.pos) {
      // View Gallery: a close look at the actual wall from where the character stands (not a
      // menu). Choosing another work in this section turns the view; other sections mean walking.
      const works = this.world.galleryFocus?.[my.viewing] ?? [];
      const f = works[Math.max(0, Math.min(works.length - 1, this.galleryIndex ?? 1))];
      if (f) {
        // Stand back far enough that the whole work, its frame and plaque fit this screen.
        const vfov = 50, tv = Math.tan(vfov * Math.PI / 360);
        const aspect = this.app.graphicsDevice.width / Math.max(1, this.app.graphicsDevice.height);
        const d = Math.max(1.2, Math.min(3.4, Math.max(0.85 / (tv * aspect), 0.95 / tv) + 0.1));
        const look = (GALLERY.find(g => g.id === my.viewing)?.look ?? 0) * Math.PI / 180;
        const pos = new pc.Vec3(f[0] - Math.sin(look) * d, 1.55, f[2] - Math.cos(look) * d);
        return { pos, target: new pc.Vec3(f[0], 1.48, f[2]), near: 0.05, fov: vfov };
      }
    }
    if ((this.mode === 'overhead' || this.mode === 'gallery') && me?.pos) {
      // Follow behind the direction of travel; ease slowly so corners don't whip the view.
      if (me.moving) {
        let dy = ((me.yaw - v.followYaw + 540) % 360) - 180;
        v.followYaw += dy * Math.min(1, dt * 1.6);
      }
      const yaw = (v.followYaw + 180 + v.yawOff) * Math.PI / 180, pitch = v.pitch * Math.PI / 180;
      // Look a little ahead of the character along its heading, then pull the aim point
      // back toward the camera so the character sits above the control panel on screen.
      const ahead = me.moving ? 1.6 : 0.4;
      const pull = 2.2;
      const tx = me.pos[0] + Math.sin(me.yaw * Math.PI / 180) * ahead + Math.sin(yaw) * pull;
      const tz = me.pos[1] + Math.cos(me.yaw * Math.PI / 180) * ahead + Math.cos(yaw) * pull;
      let cx = tx + Math.sin(yaw) * Math.cos(pitch) * v.dist, cz = tz + Math.cos(yaw) * Math.cos(pitch) * v.dist;
      const r = rectAt(me.pos[0], me.pos[1]);
      if (r) { cx = Math.max(r[0] + 0.4, Math.min(r[1] - 0.4, cx)); cz = Math.max(r[2] + 0.4, Math.min(r[3] - 0.4, cz)); }
      return { pos: new pc.Vec3(cx, 1 + Math.sin(pitch) * v.dist, cz), target: new pc.Vec3(tx, 0.9, tz), near: 0.2, fov: 58 };
    }
    if (this.mode === 'opening' && this.arrival) {
      // Establishing shot of the front of the house as the limousine arrives.
      const { ex, face } = this.arrival;
      return { pos: new pc.Vec3(ex + 10, 3.4, face - 12.5), target: new pc.Vec3(ex + 0.5, 1.6, face - 2.2), near: 0.2, fov: 52 };
    }
    // Opening, lobby and escaped: a slow orbit of the gallery (or the exit).
    v.orbit += dt * (this.mode === 'opening' ? 7 : 4);
    const focus = this.mode === 'escaped' ? [0, 24] : ROOMS.portrait.center;
    const a = v.orbit * Math.PI / 180, d = this.mode === 'opening' ? 12 : 14;
    return { pos: new pc.Vec3(focus[0] + Math.sin(a) * d * 0.55, 10.5, focus[1] + Math.cos(a) * d * 0.5), target: new pc.Vec3(focus[0], 1, focus[1]), near: 0.2 };
  }

  update(dt) {
    for (const a of this.actors.values()) if (a.entity.enabled) a.update(dt);
    const me = this.me && this.actors.get(this.me);
    // In first person you don't see your own body.
    if (me) me.entity.enabled = this.visible?.has(this.me) && this.mode !== 'fp' && this.mode !== 'gallery';
    this.world.updateLights(dt);
    this.updateArrival(dt);
    this.world.updateDoors(dt, [...this.actors.values()].filter(a => a.entity.enabled && a.pos).map(a => a.pos));

    if (this.cameraHolder && this.actors.get(this.cameraHolder)?.pos) {
      const h = this.actors.get(this.cameraHolder);
      const yaw = h.yaw * Math.PI / 180;
      const hidden = this.cameraHolder === this.me && this.mode === 'fp';
      this.world.cameraProp.enabled = !hidden;
      this.world.cameraProp.setLocalPosition(h.pos[0] + Math.sin(yaw) * 0.45 + Math.cos(yaw) * 0.3, 1.2, h.pos[1] + Math.cos(yaw) * 0.45 - Math.sin(yaw) * 0.3);
      this.world.cameraProp.setLocalEulerAngles(0, h.yaw, 0);
    }

    if (me?.pos) { this.lantern.enabled = this.mode !== 'capture'; this.lantern.setLocalPosition(me.pos[0], this.mode === 'fp' ? 1.2 : 2.4, me.pos[1]); }
    else this.lantern.enabled = false;
    const want = this.desiredCamera(dt);
    if (want) {
      const k = this.mode === 'capture' ? 1 : Math.min(1, dt * (this.mode === 'fp' ? 7 : 4.5));
      this.camPos.lerp(this.camPos, want.pos, k);
      tmpMat.setLookAt(this.camPos, want.target, UP);
      const q = new pc.Quat().setFromMat4(tmpMat);
      this.camRot.slerp(this.camRot, q, this.mode === 'capture' ? 1 : Math.min(1, dt * 8));
      this.camera.setPosition(this.camPos);
      this.camera.setRotation(this.camRot);
      this.camera.camera.nearClip = want.near;
      const fov = want.fov ?? 58;
      this.camera.camera.fov += (fov - this.camera.camera.fov) * Math.min(1, dt * 6);
    }

    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flashLight.light.intensity = Math.max(0, this.flashT / 0.6) * 12;
    }
    const s = this.stats;
    s.frames++; s.acc += dt; s.worst = Math.max(s.worst, dt);
    if (s.acc >= 1) {
      s.fps = s.frames / s.acc; s.ms = s.acc / s.frames * 1000; s.worstMs = s.worst * 1000; s.frames = 0; s.acc = 0; s.worst = 0;
      this.adaptResolution(s.fps);
    }
    this.onFrame?.(dt);
  }

  adaptResolution(fps) {
    if (this.mode === 'capture') return;
    const dev = this.app.graphicsDevice;
    const cap = Math.min(window.devicePixelRatio || 1, 1.5);
    this.slow = fps < 40 ? (this.slow || 0) + 1 : 0;
    this.fast = fps > 57 ? (this.fast || 0) + 1 : 0;
    if (this.slow >= 3 && dev.maxPixelRatio > 0.6) { dev.maxPixelRatio = Math.max(0.6, +(dev.maxPixelRatio - 0.25).toFixed(2)); this.app.resizeCanvas(); this.slow = 0; }
    else if (this.fast >= 5 && dev.maxPixelRatio < cap) { dev.maxPixelRatio = Math.min(cap, +(dev.maxPixelRatio + 0.25).toFixed(2)); this.app.resizeCanvas(); this.fast = 0; }
  }

  /** Neutral name tags in the travel view only (never in first person, never colour-coded). */
  tags() {
    if (this.mode !== 'overhead') return [];
    const out = [];
    const cam = this.camera.camera;
    const w = window.innerWidth, h = window.innerHeight;
    const fwd = this.camera.forward, cp = this.camera.getPosition();
    const me = this.actors.get(this.me);
    for (const a of this.actors.values()) {
      if (!a.entity.enabled || !a.pos || a.id === this.me) continue;
      if (me?.pos && Math.hypot(a.pos[0] - me.pos[0], a.pos[1] - me.pos[1]) > 10) continue;
      const p = a.headWorld();
      if (new pc.Vec3().sub2(p, cp).dot(fwd) <= 0) continue;
      const s = cam.worldToScreen(p);
      if (s.x < -50 || s.y < -50 || s.x > w + 50 || s.y > h + 50) continue;
      out.push({ id: a.id, x: s.x, y: s.y, name: castInfo(a.id)?.name.split(' ')[0] });
    }
    return out;
  }

  /** Camera heading (degrees, same convention as server yaw) for placing sound cues. */
  heading() {
    const f = this.camera.forward;
    return Math.atan2(f.x, f.z) * 180 / Math.PI;
  }

  /** Fixed, empty-room shots used to generate the room picture cards. */
  setCapture(room) {
    const r = ROOMS[room];
    const [x0, x1, z0, z1] = r.rect;
    const [cx, cz] = r.center;
    const w = x1 - x0, d = z1 - z0;
    // Look along the room's long axis from just inside one end, high and angled.
    const pos = w >= d ? new pc.Vec3(x0 + 1.2, 6.2, cz - d * 0.18) : new pc.Vec3(cx - w * 0.18, 6.2, z0 + 1.2);
    this.captureShot = { pos, target: new pc.Vec3(cx + (w >= d ? w * 0.12 : 0), 0.6, cz + (w >= d ? 0 : d * 0.12)), near: 0.2 };
    this.camPos.copy(pos);
    this.mode = 'capture';
    // Brighter than gameplay so the navigation cards read clearly on a phone.
    this.app.scene.exposure = 2.1;
    this.app.scene.ambientLight = new pc.Color(0.3, 0.27, 0.3);
    this.app.scene.fog.start = 60; this.app.scene.fog.end = 120;
    for (const a of this.actors.values()) a.entity.enabled = false;
    this.world.cameraProp.enabled = false;
    if (this.world.exterior) this.world.exterior.enabled = false;   // cards show the rooms, not the front of the house
  }

  // ---------------------------------------------------------------- arrival (spec §12, 0–4 s)
  /**
   * The limousine pulls up to the front steps and the arriving guests (everyone except the
   * birthday guest, who is already inside) step out and walk to the doors. These are cinematic
   * doubles on this phone only; the real match state is untouched. Your own guest wears the ring.
   */
  startArrival(pub) {
    this.endArrival();
    const w = this.world;
    const { x: ex, z: face } = w.frontEntrance;
    const ids = CAST.map(c => c.id).filter(id => pub?.seats?.get?.(id)?.taken && id !== pub.birthday);
    this.arrival = { t: 0, ex, face, doubles: ids.map((id, i) => {
      const a = new ActorView(this.app, id);   // a separate double of the guest (same look)
      a.entity.name = `Arrival_${id}`;
      a.entity.enabled = false;
      a.ring.enabled = id === this.me;
      const [lx, lz] = w.limoParked;
      const start = [lx - 1.6 + (i % 4) * 1.0, lz + 1.3];
      const goal = [ex + ((i % 5) - 2) * 0.55, face - 1.8 - Math.floor(i / 5) * 0.6];
      a.pos = [...start]; a.target = [...start]; a.yaw = 0;
      return { a, start, goal, at: 1.5 + i * 0.16 };
    }) };
    w.setLimo(0);
  }

  endArrival() {
    if (!this.arrival) return;
    for (const d of this.arrival.doubles) d.a.destroy();
    this.arrival = null;
    this.world.setLimo(1);
  }

  updateArrival(dt) {
    const ar = this.arrival;
    if (!ar) return;
    dt *= this.arrivalTimeScale ?? 1;
    ar.t += dt;
    this.world.setLimo(ar.t / 1.5);
    for (const d of ar.doubles) {
      if (ar.t < d.at) continue;
      const a = d.a;
      if (!a.entity.enabled) { a.entity.enabled = true; }
      const dx = d.goal[0] - a.target[0], dz = d.goal[1] - a.target[1], dist = Math.hypot(dx, dz);
      const step = Math.min(dist, 1.7 * dt);
      a.moving = dist > 0.05;
      if (a.moving) { a.target = [a.target[0] + dx / dist * step, a.target[1] + dz / dist * step]; a.targetYaw = Math.atan2(dx, dz) * 180 / Math.PI; }
      a.update(dt);
    }
    if (ar.t > 6) this.endArrival();
  }

  // ---------------------------------------------------------------- opening cinematic staging
  openingBeat(id, pub) {
    const w = this.world;
    const portrait = ROOMS.portrait;
    if (id === 'arrival') {
      this.startArrival(pub);
      w.restoreLamps();
      w.setLockdown(false);
      if (w.paintingVeil) w.paintingVeil.enabled = true;
      this.openingCameraHolder = pub.photographer;
    } else if (id === 'welcome') {
      // (Slow motion is a debug aid for screenshots: the shot then ends on its own.)
      if ((this.arrivalTimeScale ?? 1) >= 1) this.endArrival();
    } else if (id === 'unveiling') {
      if (w.paintingVeil) w.paintingVeil.enabled = false;
    } else if (id === 'freeze') {
      this.flashAt([portrait.rect[1] - 3, portrait.center[1]]);
    } else if (id === 'bite') {
      w.failLamps();
      this.openingCameraHolder = null;
    } else if (id === 'lockdown') {
      w.setLockdown(true);
      setTimeout(() => w.setLockdown(false), 3500);
    }
  }
}

export { mat, TUNING, CAMERA_START };
