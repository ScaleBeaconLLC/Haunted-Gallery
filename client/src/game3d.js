// The PlayCanvas side of the phone client.
//  - Eagle-eye cameras for a landscape phone: `mansion` (the whole house from high above,
//    looking along +x so the long axis runs left to right) while travelling, and `room`
//    (your room, fitted to the screen) once you are inside one.
//  - First person (`fp`): from inside your cover when hidden, at your character's eyes
//    (the eye button), and facing the attacker during a struggle.
//  - Eased transitions (~0.9 s) between them; near/far clip and fog are set per mode.
//  - Only people the server says you can perceive are ever rendered, so no camera angle
//    can reveal anyone else.
import * as pc from 'playcanvas';
import { CAMERA_START, CAST, DOORWAYS, GALLERY, ROOMS, TUNING, hideSpot } from '@game/data.ts';
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
// fov: vertical (portrait); hfov: horizontal in landscape.
const POSE = {
  under: { height: 0.42, back: 0.35, fov: 72, hfov: 84, peekOut: 1.1, peekUp: 0.45, yaw: 115, pitch: [-12, 22] },
  behind: { height: 1.05, back: 0, fov: 64, hfov: 80, peekOut: 0.6, peekUp: 0.25, yaw: 125, pitch: [-30, 35] },
  curtain: { height: 1.5, back: 0, fov: 60, hfov: 78, peekOut: 0.5, peekUp: 0, yaw: 110, pitch: [-30, 30] },
  // Standing inside a wardrobe/closet: a narrow view out through the ajar doors.
  inside: { height: 1.55, back: 0.25, fov: 52, hfov: 70, peekOut: 0.75, peekUp: 0, yaw: 40, pitch: [-20, 15] },
};
const WALL_TOP = 3.2;   // world.js wall height
const tmpMat = new pc.Mat4();
const UP = new pc.Vec3(0, 1, 0);
const DEG = Math.PI / 180;

/** Whole-mansion bounds for the eagle-eye view: every room, the bedroom wing and the Garden Gate courtyard. */
export const MANSION_BOUNDS = [-32, 32, 1.5, 80.5];
/** Gameplay camera modes (everything else keeps the original opening/gallery/escaped camera code). */
const VIEW = {
  mansion: { pitch: 62, fovV: 34, near: 18, far: 220 },
  room: { pitch: 66, hfov: 62, fovV: 50, near: 0.3, far: 120 },
  fp: { hfov: 80, fovV: 62, near: 0.05, far: 80 },
};
const GAMEPLAY = new Set(['mansion', 'room', 'fp']);
const TRANSITION_S = 0.9;
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Is this room much longer along x than along z (the Portrait Corridor)? It is then framed looking along +z. */
const isLong = ([x0, x1, z0, z1]) => (x1 - x0) > 1.8 * (z1 - z0);

/**
 * Place a camera (heading, pitch, vertical fov) so the rectangle `bounds`, taken at the heights
 * `ys`, fills the safe frame (fractions of the screen kept clear on each side), centred in it.
 * Rooms are framed at wall-top height: that is the outline you see from above (the floor just
 * inside the near wall is behind it anyway), so the room reads as centred.
 */
export function fitView(bounds, { heading, pitch, fovV, aspect, safe, ys = [WALL_TOP] }) {
  const h = heading * DEG, p = pitch * DEG;
  const f = new pc.Vec3(Math.sin(h) * Math.cos(p), -Math.sin(p), Math.cos(h) * Math.cos(p));
  const r = new pc.Vec3().cross(f, UP).normalize();
  const u = new pc.Vec3().cross(r, f).normalize();
  const [x0, x1, z0, z1] = bounds;
  const pts = [];
  for (const x of [x0, x1]) for (const z of [z0, z1]) for (const y of ys) pts.push([x, y, z]);
  const tv = Math.tan(fovV * DEG / 2), th = tv * aspect;
  const sx0 = -1 + 2 * safe.l, sx1 = 1 - 2 * safe.r, sy0 = -1 + 2 * safe.b, sy1 = 1 - 2 * safe.t;
  const T = [(x0 + x1) / 2, 0, (z0 + z1) / 2];
  let d = Math.max(x1 - x0, z1 - z0, 4) / tv;
  for (let i = 0; i < 10; i++) {
    const C = [T[0] - f.x * d, T[1] - f.y * d, T[2] - f.z * d];
    let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
    for (const P of pts) {
      const qx = P[0] - C[0], qy = P[1] - C[1], qz = P[2] - C[2];
      const cz = Math.max(0.1, qx * f.x + qy * f.y + qz * f.z);
      const nx = (qx * r.x + qy * r.y + qz * r.z) / (cz * th);
      const ny = (qx * u.x + qy * u.y + qz * u.z) / (cz * tv);
      bx0 = Math.min(bx0, nx); bx1 = Math.max(bx1, nx); by0 = Math.min(by0, ny); by1 = Math.max(by1, ny);
    }
    const s = Math.max((bx1 - bx0) / Math.max(0.05, sx1 - sx0), (by1 - by0) / Math.max(0.05, sy1 - sy0));
    const dx = ((bx0 + bx1) / 2 - (sx0 + sx1) / 2) * d * th;
    const dy = ((by0 + by1) / 2 - (sy0 + sy1) / 2) * d * tv;
    T[0] += r.x * dx + u.x * dy; T[1] += r.y * dx + u.y * dy; T[2] += r.z * dx + u.z * dy;
    d *= s;
  }
  const target = new pc.Vec3(T[0], T[1], T[2]);
  return { pos: new pc.Vec3(T[0] - f.x * d, T[1] - f.y * d, T[2] - f.z * d), target, dist: d, forward: f, right: r };
}

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
    // ?hq=1 pins a sharp pixel ratio (review screenshots); otherwise it adapts to the frame rate.
    this.fixedRatio = new URLSearchParams(location.search).get('hq') ? Math.min(window.devicePixelRatio || 1, 2) : null;
    app.graphicsDevice.maxPixelRatio = this.fixedRatio ?? Math.min(window.devicePixelRatio || 1, 1.5);
    this.bindResize();

    this.world = new World(app);
    this.actors = new Map();
    this.me = null;
    this.myView = null;
    this.phase = 'lobby';
    // menu | opening | escaped | capture | gallery (original camera code) | mansion | room | fp
    this.mode = 'menu';
    this.fpKind = null;          // fp: 'hide' | 'eye' | 'struggle'
    this.modeKey = '';
    this.userView = null;        // view buttons / pinch: 'mansion' | 'room' | 'eye' (until a forced state change)
    this.viewRoom = null;        // room framed by a pinch-in on the mansion view
    this.forceKey = '';
    this.autoKey = ''; this.autoSince = 0;
    this.peekAmount = 0;
    this.peeking = false;
    /** Screen space kept clear by the HUD (CSS px), set by the interface. */
    this.hudInsets = { top: 56, bottom: 64, left: 12, right: 12 };

    const cam = new pc.Entity('Camera');
    cam.addComponent('camera', { clearColor: new pc.Color(0.02, 0.015, 0.03), fov: 58, nearClip: 0.05, farClip: 80 });
    // ?tonemap=neutral|aces (review aid; the default is the game's look)
    const tm = new URLSearchParams(location.search).get('tonemap');
    cam.camera.toneMapping = tm === 'neutral' ? pc.TONEMAP_NEUTRAL : pc.TONEMAP_ACES;
    app.root.addChild(cam);
    this.camera = cam;
    this.camPos = new pc.Vec3(-11.75, 14, -2);
    this.camRot = new pc.Quat();
    this.camTarget = new pc.Vec3(-11.75, 0, 9);
    this.fovV = 58;
    this.clip = { near: 0.05, far: 80 };
    this.tr = null;              // active eased transition
    this.pan = new pc.Vec3();    // subtle one-finger pan in the overhead views
    this.view = { yawOff: 0, dist: 7.5, pitch: 55, followYaw: 0, fpYaw: 0, fpPitch: 0, eyeYaw: 0, eyePitch: -8, orbit: 0 };

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

    const ringMat = new pc.StandardMaterial();
    ringMat.diffuse = new pc.Color(0, 0, 0); ringMat.emissive = new pc.Color(1, 0.82, 0.45); ringMat.emissiveIntensity = 1.4;
    ringMat.depthTest = false;   // your own cover marker shows through the tabletop or bed above you
    ringMat.update();
    const ring = new pc.Entity('HideRing');
    ring.addComponent('render', { type: 'torus', material: ringMat, castShadows: false });
    ring.enabled = false;
    app.root.addChild(ring);
    this.hideRing = ring;
    // A short-lived ring on someone who just walked into your room (red only when revealed).
    this.emphMats = {
      neutral: mat('#111', { emissive: '#e8e2d6', emissiveIntensity: 1.1 }),
      revealed: mat('#111', { emissive: '#ff3a2a', emissiveIntensity: 1.4 }),
    };
    const emph = new pc.Entity('ArrivalRing');
    emph.addComponent('render', { type: 'torus', material: this.emphMats.neutral, castShadows: false });
    emph.enabled = false;
    app.root.addChild(emph);
    this.emphRing = emph;
    this.emph = null;

    this.stats = { frames: 0, acc: 0, fps: 0, worst: 0, ms: 0 };
    app.on('update', dt => this.update(dt));
    app.start();
  }

  /** Canvas size follows rotation, Safari's bars and the on-screen keyboard (a second pass once the viewport settles). */
  bindResize() {
    let timer = 0;
    const resize = () => {
      this.app.resizeCanvas();
      clearTimeout(timer);
      timer = setTimeout(() => { this.app.resizeCanvas(); this.onResize?.(); }, 250);
      this.onResize?.();
    };
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);
    window.visualViewport?.addEventListener('resize', resize);
    this.resize = resize;
  }

  get cameraMode() { return this.mode; }

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
    this.world.setRoomMask(null);
    this.updateMode();
  }

  // ---------------------------------------------------------------- camera mode selection
  /** Where the character is headed, as a room (null = somewhere in the current zone). */
  destinationRoom(me) {
    const i = me?.intent;
    if (!i || !me.moving || i.state === 'interrupted') return null;
    if (i.kind === 'room') return i.target;
    if (i.kind === 'hide') return hideSpot(i.target)?.room ?? null;
    if (i.kind === 'exit') return 'exit';
    if (i.kind === 'gallery') return 'corridor';
    return null;
  }

  /** The camera mode the character's real state asks for: [mode, sub-key]. */
  wantedMode() {
    const view = this.myView, me = view?.me;
    if (this.mode === 'capture') return ['capture', ''];
    if (this.phase === 'opening') return ['opening', ''];
    if (view?.status === 'escaped') return ['escaped', ''];
    if (!me || this.phase === 'lobby') return ['menu', ''];
    const caught = !!(me.struggle || me.caught);
    const hidden = me.hideState === 'hidden' && view.status === 'alive';
    const viewing = me.viewing && view.status === 'alive' && !me.caught;
    // A forced state change (hidden, caught, viewing the gallery) ends a view-button choice.
    const forceKey = caught ? `caught:${me.struggle?.grabId ?? me.caughtBy}` : hidden ? `hidden:${me.hide}` : viewing ? `viewing:${me.viewing}` : '';
    if (forceKey !== this.forceKey) { this.forceKey = forceKey; this.userView = null; this.viewRoom = null; }
    if (caught) return ['fp', 'struggle'];
    if (viewing) return ['gallery', ''];
    const roomKey = this.viewRoom ?? (me.inRoom ? me.zone : `p:${me.zone}`);
    if (this.userView === 'eye') return ['fp', hidden ? 'hide' : 'eye'];
    if (this.userView === 'mansion') return ['mansion', ''];
    if (this.userView === 'room') return ['room', roomKey];
    if (hidden) return ['fp', 'hide'];
    const dest = this.destinationRoom(me);
    if (!me.inRoom || (dest && dest !== me.zone)) return ['mansion', ''];
    return ['room', roomKey];
  }

  /** The automatic choice (no view-button override) — for the view buttons' "back to auto". */
  autoMode() {
    const saved = [this.userView, this.viewRoom];
    this.userView = null; this.viewRoom = null;
    const m = this.wantedMode()[0];
    [this.userView, this.viewRoom] = saved;
    return m;
  }

  updateMode() {
    const [mode, key] = this.wantedMode();
    const full = `${mode}|${key}`;
    if (full === `${this.mode}|${this.modeKey}`) { this.autoKey = full; return; }
    // Room/mansion flips wait a moment so a doorway threshold doesn't bounce the camera.
    const settle = GAMEPLAY.has(mode) && GAMEPLAY.has(this.mode) && !this.userView && mode !== 'fp' && this.mode !== 'fp';
    if (settle) {
      if (full !== this.autoKey) { this.autoKey = full; this.autoSince = performance.now(); return; }
      if (performance.now() - this.autoSince < 260) return;
    }
    this.setMode(mode, key);
  }

  setMode(mode, key = '') {
    const prev = this.mode;
    const me = this.myView?.me;
    if (mode === 'gallery' && (prev !== 'gallery' || this.galleryStation !== me?.viewing)) { this.galleryStation = me.viewing; this.galleryIndex = 1; }
    if (mode === 'fp' && key === 'hide' && !(prev === 'fp' && this.fpKind === 'hide')) { this.view.fpYaw = 0; this.view.fpPitch = me?.pose === 'under' ? 6 : 0; }
    if (mode === 'fp' && key === 'eye' && !(prev === 'fp' && this.fpKind === 'eye')) { this.view.eyeYaw = 0; this.view.eyePitch = -8; }
    this.mode = mode;
    this.modeKey = key;
    this.fpKind = mode === 'fp' ? key : null;
    if (GAMEPLAY.has(mode)) {
      this.pan.set(0, 0, 0);
      this.tr = { t: 0, from: { pos: this.camPos.clone(), target: null, fovV: this.fovV, near: this.clip.near, far: this.clip.far }, mode };
      // Widen the fog before zooming out; tighten it once the zoom-in is mostly done.
      if (mode === 'mansion') this.world.setViewMode?.('mansion');
    } else {
      this.tr = null;
      this.world.setViewMode?.('default');
    }
    this.onModeChange?.(mode, prev);
  }

  /** View buttons and pinch: 'mansion' | 'room' | 'eye' (null = automatic). */
  setUserView(v, room = null) {
    if (this.myView?.me?.caught || this.myView?.me?.struggle) return;
    this.userView = v;
    this.viewRoom = v === 'room' ? room : null;
    const auto = this.autoMode();
    if (v && !room && ((v === 'eye' && auto === 'fp') || v === auto)) { this.userView = null; this.viewRoom = null; }
    this.autoKey = '';
    this.updateMode();
  }

  /** A new trip between rooms goes back to the automatic cameras (watch the travel, zoom in on arrival). */
  clearUserView() { this.userView = null; this.viewRoom = null; }

  setPeek(on) { this.peeking = on; }

  flashAt([x, z]) {
    this.flashLight.setLocalPosition(x, 2, z);
    this.flashT = 0.6;
  }

  /** Someone just walked into your room: a brief ring on them and a slight push-in. */
  emphasize(id, revealed) {
    this.emph = { id, revealed, t: 0, dur: 2.6 };
    this.emphRing.render.meshInstances[0].material = revealed ? this.emphMats.revealed : this.emphMats.neutral;
  }

  // ---------------------------------------------------------------- input from the gesture layer
  /** One-finger drag: look around in first person, a small pan in the overhead views. */
  dragBy(dx, dy) {
    const v = this.view;
    if (this.mode === 'fp' && this.fpKind === 'hide') {
      const pose = POSE[this.myView?.me?.pose] ?? POSE.behind;
      v.fpYaw = clamp(v.fpYaw - dx * 0.3, -pose.yaw, pose.yaw);
      v.fpPitch = clamp(v.fpPitch - dy * 0.25, pose.pitch[0], pose.pitch[1]);
    } else if (this.mode === 'fp' && this.fpKind === 'eye') {
      v.eyeYaw = clamp(v.eyeYaw - dx * 0.3, -150, 150);
      v.eyePitch = clamp(v.eyePitch - dy * 0.25, -45, 30);
    } else if (this.mode === 'room' || this.mode === 'mansion') {
      const d = this.camPos.distance(this.camTarget);
      const h = Math.max(1, this.app.graphicsDevice.clientRect?.height || window.innerHeight);
      const perPx = 2 * d * Math.tan(this.fovV * DEG / 2) / h * 0.6;
      const f = this.camera.forward, r = this.camera.right;
      const fl = Math.hypot(f.x, f.z) || 1, rl = Math.hypot(r.x, r.z) || 1;
      this.pan.x += (-r.x / rl * dx + f.x / fl * dy) * perPx;
      this.pan.z += (-r.z / rl * dx + f.z / fl * dy) * perPx;
      const lim = this.mode === 'mansion' ? 10 : 3;
      const l = Math.hypot(this.pan.x, this.pan.z);
      if (l > lim) { this.pan.x *= lim / l; this.pan.z *= lim / l; }
    }
  }

  // ---------------------------------------------------------------- camera
  aspect() {
    const d = this.app.graphicsDevice;
    return d.width / Math.max(1, d.height);
  }
  /** A vertical fov for a horizontal one in landscape (portrait keeps the vertical fallback). */
  vfov(hfov, fallback) {
    const a = this.aspect();
    return a >= 1 ? 2 * Math.atan(Math.tan(hfov * DEG / 2) / a) / DEG : fallback;
  }
  /**
   * The part of the screen the view should fill, as fractions kept clear on each side. The
   * mansion is narrower than a landscape screen, so it may run a little under the corner controls.
   */
  safeFrame(mode = this.mode) {
    const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
    const i = this.hudInsets;
    // The room sits between the top corners' controls; its bottom edge may run behind the pills.
    const kt = mode === 'mansion' ? 0.55 : 0.9, kb = mode === 'mansion' ? 0.55 : 0.6;
    return { l: clamp(i.left / w, 0, 0.3), r: clamp(i.right / w, 0, 0.3), t: clamp(i.top * kt / h, 0, 0.3), b: clamp(i.bottom * kb / h, 0, 0.3) };
  }

  /** The room (or passage) the room view frames, and its heading. */
  roomFrame() {
    const my = this.myView?.me;
    const a = this.me && this.actors.get(this.me);
    const pos = a?.pos ?? my?.pos;
    let rect = this.viewRoom && ROOMS[this.viewRoom] ? ROOMS[this.viewRoom].rect
      : my?.inRoom && ROOMS[my.zone] ? ROOMS[my.zone].rect
      : pos ? rectAt(pos[0], pos[1]) : null;
    if (!rect) rect = ROOMS[my?.room]?.rect ?? ROOMS.portrait.rect;
    let [x0, x1, z0, z1] = rect;
    const long = isLong(rect);
    if (long && pos) {
      // The Portrait Corridor is 52 m long: frame a window around you instead of a thin strip.
      const W = 24, cx = clamp(pos[0], x0 + W / 2, x1 - W / 2);
      x0 = cx - W / 2; x1 = cx + W / 2;
    } else if (!long && (z1 - z0) > 1.8 * (x1 - x0) && pos) {
      const W = 26, cz = clamp(pos[1], z0 + W / 2, z1 - W / 2);
      z0 = cz - W / 2; z1 = cz + W / 2;
    }
    return { bounds: [x0 - 1, x1 + 1, z0 - 1, z1 + 1], heading: long ? 0 : 90 };
  }

  /** The eagle-eye and first-person cameras. */
  gameplayCamera() {
    const v = this.view;
    const my = this.myView?.me;
    const me = this.me && this.actors.get(this.me);
    const aspect = this.aspect();
    if (this.mode === 'mansion') {
      const c = VIEW.mansion;
      const fit = fitView(MANSION_BOUNDS, { heading: 90, pitch: c.pitch, fovV: c.fovV, aspect, safe: this.safeFrame() });
      fit.pos.add(this.pan); fit.target.add(this.pan);
      return { pos: fit.pos, target: fit.target, fovV: c.fovV, near: c.near, far: c.far, overhead: true };
    }
    if (this.mode === 'room') {
      const c = VIEW.room;
      const fovV = this.vfov(c.hfov, c.fovV);
      const { bounds, heading } = this.roomFrame();
      const fit = fitView(bounds, { heading, pitch: c.pitch, fovV, aspect, safe: this.safeFrame() });
      fit.pos.add(this.pan); fit.target.add(this.pan);
      const e = this.emphasisWeight();
      const ea = e > 0 && this.actors.get(this.emph.id)?.pos;
      if (ea) {
        // A slight push-in toward whoever just came in.
        const to = new pc.Vec3(ea[0], 0.9, ea[1]);
        const shift = new pc.Vec3().sub2(to, fit.target).mulScalar(0.18 * e);
        fit.target.add(shift); fit.pos.add(shift);
        fit.pos.lerp(fit.pos, fit.target, 0.08 * e);
      }
      return { pos: fit.pos, target: fit.target, fovV, near: c.near, far: c.far, overhead: true };
    }
    // First person.
    const c = VIEW.fp;
    if (this.fpKind === 'hide' && my?.hidePos) {
      const pose = POSE[my.pose] ?? POSE.behind;
      const look = (my.look ?? 0) * DEG;
      // Eye height follows the real clearance of this cover (a bed is lower than a table).
      const cover = my.hide ? hideSpot(my.hide)?.spot.cover : null;
      const eye = my.pose === 'under' && cover ? Math.min(pose.height, cover.height * 0.55) : pose.height;
      const k = this.peekAmount;
      // Sit toward the back of the cover so its edge frames the view (e.g. the tabletop above).
      const out = pose.peekOut * k - pose.back * (1 - k);
      const pos = new pc.Vec3(my.hidePos[0] + Math.sin(look) * out, eye + pose.peekUp * k, my.hidePos[1] + Math.cos(look) * out);
      const yaw = look + v.fpYaw * DEG, pitch = v.fpPitch * DEG;
      const target = new pc.Vec3(pos.x + Math.sin(yaw) * Math.cos(pitch), pos.y + Math.sin(pitch), pos.z + Math.cos(yaw) * Math.cos(pitch));
      return { pos, target, fovV: this.vfov(pose.hfov, pose.fov), near: c.near, far: c.far };
    }
    const at = me?.pos ?? my?.pos;
    if (!at) return null;
    const myYaw = (me?.yaw ?? my?.yaw ?? 0) * DEG;
    const eye = new pc.Vec3(at[0] + Math.sin(myYaw) * 0.12, 1.58, at[1] + Math.cos(myYaw) * 0.12);
    if (this.fpKind === 'struggle') {
      // Face whoever has you; a small shake while you fight.
      const by = my?.struggle?.by ?? my?.caughtBy;
      const att = by && this.actors.get(by);
      const t = performance.now() / 1000;
      eye.x += Math.sin(t * 31) * 0.015; eye.y += Math.sin(t * 23) * 0.012 - 0.1;
      const target = att?.pos && att.entity.enabled ? new pc.Vec3(att.pos[0], 1.5, att.pos[1])
        : new pc.Vec3(eye.x + Math.sin(myYaw), 1.4, eye.z + Math.cos(myYaw));
      return { pos: eye, target, fovV: this.vfov(c.hfov + 4, c.fovV), near: c.near, far: c.far };
    }
    // Your character's eyes (the eye button): drag to look around.
    const yaw = myYaw + v.eyeYaw * DEG, pitch = v.eyePitch * DEG;
    const target = new pc.Vec3(eye.x + Math.sin(yaw) * Math.cos(pitch), eye.y + Math.sin(pitch), eye.z + Math.cos(yaw) * Math.cos(pitch));
    return { pos: eye, target, fovV: this.vfov(c.hfov, c.fovV), near: c.near, far: c.far };
  }

  emphasisWeight() {
    const e = this.emph;
    if (!e) return 0;
    const k = e.t / e.dur;
    return k >= 1 ? 0 : Math.sin(Math.PI * Math.min(1, k * 1.4)) * (k > 0.7 ? (1 - k) / 0.3 : 1);
  }

  /** Nearest geometry depth for a high camera: keeps the near clip from cutting walls mid-zoom. */
  safeNear(pos, target, fovV) {
    const yTop = 5, h = pos.y - yTop;
    if (h <= 0.5) return 0.05;
    const dir = new pc.Vec3().sub2(target, pos).normalize();
    const pitch = Math.asin(clamp(-dir.y, -1, 1)), v = fovV * DEG / 2;
    let min = Infinity;
    for (const a of [-v, -v / 2, 0, v / 2, v]) {
      const e = pitch + a;
      if (e <= 0.03) continue;
      min = Math.min(min, h * Math.cos(a) / Math.sin(e));
    }
    return Number.isFinite(min) ? Math.max(0.05, min * 0.85) : 0.05;
  }

  applyGameplayCamera(dt) {
    const want = this.gameplayCamera();
    if (!want) return;
    let pos, target, fovV, near, far;
    const tr = this.tr;
    if (tr) {
      if (!tr.from.target) {
        // Start from where the camera actually looks now, at the new view's distance.
        const d = Math.max(1, this.camPos.distance(want.target));
        tr.from.target = this.camPos.clone().add(this.camera.forward.clone().mulScalar(d));
      }
      tr.t += dt;
      // A struggle is only 2.7 s: snap to the attacker's face quickly.
      const k = Math.min(1, tr.t / (this.fpKind === 'struggle' ? 0.4 : TRANSITION_S)), e = ease(k);
      pos = new pc.Vec3().lerp(tr.from.pos, want.pos, e);
      target = new pc.Vec3().lerp(tr.from.target, want.target, e);
      fovV = tr.from.fovV + (want.fovV - tr.from.fovV) * e;
      near = Math.min(tr.from.near, want.near);
      far = Math.max(tr.from.far, want.far);
      if (k >= 0.6 && tr.mode !== 'mansion') this.world.setViewMode?.(tr.mode);
      if (k >= 1) this.tr = null;
    } else {
      const k = 1 - Math.exp(-dt * (this.mode === 'fp' ? 16 : 9));
      pos = new pc.Vec3().lerp(this.camPos, want.pos, k);
      target = new pc.Vec3().lerp(this.camTarget, want.target, k);
      fovV = this.fovV + (want.fovV - this.fovV) * k;
      near = want.near; far = want.far;
      this.world.setViewMode?.(this.mode);
    }
    if (this.mode !== 'fp' || this.tr) near = Math.min(near, this.safeNear(pos, target, fovV));
    this.camPos.copy(pos);
    this.camTarget.copy(target);
    this.fovV = fovV;
    this.clip = { near, far };
    this.camera.setPosition(pos);
    tmpMat.setLookAt(pos, target, UP);
    this.camRot.setFromMat4(tmpMat);
    this.camera.setRotation(this.camRot);
    const cc = this.camera.camera;
    cc.nearClip = near; cc.farClip = far;
    const aspect = this.aspect();
    if (aspect >= 1) { cc.horizontalFov = true; cc.fov = 2 * Math.atan(Math.tan(fovV * DEG / 2) * aspect) / DEG; }
    else { cc.horizontalFov = false; cc.fov = fovV; }
  }

  /** Compute where the camera wants to be this frame (the original opening/gallery/escaped camera). */
  desiredCamera(dt) {
    const v = this.view;
    const me = this.me && this.actors.get(this.me);
    const my = this.myView?.me;
    if (this.mode === 'capture') return this.captureShot;
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
    this.updateMode();
    for (const a of this.actors.values()) if (a.entity.enabled) a.update(dt);
    const me = this.me && this.actors.get(this.me);
    const my = this.myView?.me;
    const hiddenNow = my?.hideState === 'hidden';
    // In first person you don't see your own body; in cover it's tucked away (a ring marks the spot).
    if (me) me.entity.enabled = this.visible?.has(this.me) && this.mode !== 'fp' && this.mode !== 'gallery' && !hiddenNow;
    if (me?.ring) {
      const s = this.mode === 'mansion' ? 3.4 : 1.1;
      me.ring.setLocalScale(s, 0.25 * (this.mode === 'mansion' ? 2 : 1), s);
    }
    // In the overhead views, a soft ring marks where you are hiding.
    this.hideRing.enabled = (this.mode === 'room' || this.mode === 'mansion') && !!my?.hidePos && hiddenNow;
    if (this.hideRing.enabled) {
      const pulse = 1 + 0.12 * Math.sin(performance.now() / 260);
      const s = this.mode === 'mansion' ? 3 : 1.3;
      this.hideRing.setLocalPosition(my.hidePos[0], 0.08, my.hidePos[1]);
      this.hideRing.setLocalScale(s * pulse, 0.3, s * pulse);
    }
    if (this.emph) {
      this.emph.t += dt;
      const a = this.actors.get(this.emph.id);
      if (this.emph.t >= this.emph.dur || !a?.entity.enabled || !a.pos) { this.emph = null; this.emphRing.enabled = false; }
      else {
        this.emphRing.enabled = this.mode !== 'fp';
        const pulse = 1.2 + 0.25 * Math.sin(performance.now() / 180);
        this.emphRing.setLocalPosition(a.pos[0], 0.09, a.pos[1]);
        this.emphRing.setLocalScale(pulse, 0.25, pulse);
      }
    }
    this.peekAmount += ((this.peeking ? 1 : 0) - this.peekAmount) * Math.min(1, dt * 7);
    this.world.updateLights(dt);
    this.updateArrival(dt);
    this.world.updateDoors(dt, [...this.actors.values()].filter(a => a.entity.enabled && a.pos).map(a => a.pos));

    if (this.cameraHolder && this.actors.get(this.cameraHolder)?.pos) {
      const h = this.actors.get(this.cameraHolder);
      const yaw = h.yaw * Math.PI / 180;
      const hidden = this.cameraHolder === this.me && (this.mode === 'fp' || hiddenNow);
      this.world.cameraProp.enabled = !hidden;
      this.world.cameraProp.setLocalPosition(h.pos[0] + Math.sin(yaw) * 0.45 + Math.cos(yaw) * 0.3, 1.2, h.pos[1] + Math.cos(yaw) * 0.45 - Math.sin(yaw) * 0.3);
      this.world.cameraProp.setLocalEulerAngles(0, h.yaw, 0);
    }

    if (me?.pos) { this.lantern.enabled = this.mode !== 'capture'; this.lantern.setLocalPosition(me.pos[0], this.mode === 'fp' ? 1.2 : 2.4, me.pos[1]); }
    else this.lantern.enabled = false;

    if (GAMEPLAY.has(this.mode)) this.applyGameplayCamera(dt);
    else {
      const want = this.desiredCamera(dt);
      if (want) {
        const cc = this.camera.camera;
        if (cc.horizontalFov) { cc.horizontalFov = false; cc.fov = this.fovV; }
        cc.farClip = 80;
        const k = this.mode === 'capture' ? 1 : Math.min(1, dt * 4.5);
        this.camPos.lerp(this.camPos, want.pos, k);
        tmpMat.setLookAt(this.camPos, want.target, UP);
        const q = new pc.Quat().setFromMat4(tmpMat);
        this.camRot.slerp(this.camRot, q, this.mode === 'capture' ? 1 : Math.min(1, dt * 8));
        this.camera.setPosition(this.camPos);
        this.camera.setRotation(this.camRot);
        this.camera.camera.nearClip = want.near;
        const fov = want.fov ?? 58;
        this.camera.camera.fov += (fov - this.camera.camera.fov) * Math.min(1, dt * 6);
        this.fovV = this.camera.camera.fov;
        this.clip = { near: want.near, far: 80 };
        this.camTarget.copy(want.target);
      }
    }

    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flashLight.light.intensity = Math.max(0, this.flashT / 0.6) * 12;
    }
    const s = this.stats;
    s.frames++; s.acc += dt; s.worst = Math.max(s.worst, dt);
    if (s.acc >= 1) {
      s.fps = s.frames / s.acc; s.ms = s.acc / s.frames * 1000; s.worstMs = s.worst * 1000; s.frames = 0; s.acc = 0; s.worst = 0;
      if (this.countStats) s.tris = this.countTriangles();
      this.adaptResolution(s.fps);
    }
    this.onFrame?.(dt);
  }

  /** Triangles in the mesh instances drawn last frame (the release engine build doesn't count them). */
  countTriangles() {
    const seen = new Set();
    let tris = 0;
    for (const layer of this.app.scene.layers.layerList) {
      if (!layer.enabled) continue;
      for (const mi of layer.meshInstances ?? []) {
        if (seen.has(mi) || !mi.visibleThisFrame) continue;
        seen.add(mi);
        const prim = mi.mesh?.primitive?.[0];
        if (prim && prim.type === pc.PRIMITIVE_TRIANGLES) tris += prim.count / 3 * Math.max(1, mi.instancingCount || 1);
      }
    }
    return tris;
  }

  adaptResolution(fps) {
    if (this.mode === 'capture' || this.fixedRatio) return;
    const dev = this.app.graphicsDevice;
    const cap = Math.min(window.devicePixelRatio || 1, 1.5);
    this.slow = fps < 40 ? (this.slow || 0) + 1 : 0;
    this.fast = fps > 57 ? (this.fast || 0) + 1 : 0;
    if (this.slow >= 3 && dev.maxPixelRatio > 0.6) { dev.maxPixelRatio = Math.max(0.6, +(dev.maxPixelRatio - 0.25).toFixed(2)); this.app.resizeCanvas(); this.slow = 0; }
    else if (this.fast >= 5 && dev.maxPixelRatio < cap) { dev.maxPixelRatio = Math.min(cap, +(dev.maxPixelRatio + 0.25).toFixed(2)); this.app.resizeCanvas(); this.fast = 0; }
  }

  // ---------------------------------------------------------------- screen-space helpers
  /** World point to CSS pixels, or null when it is behind the camera. */
  worldToScreen(x, y, z) {
    const p = new pc.Vec3(x, y, z);
    const cp = this.camera.getPosition();
    if (new pc.Vec3().sub2(p, cp).dot(this.camera.forward) <= 0.01) return null;
    const s = this.camera.camera.worldToScreen(p);
    return { x: s.x, y: s.y };
  }

  /** A pick ray through a CSS pixel: origin and unit direction. */
  screenRay(sx, sy) {
    const cc = this.camera.camera;
    const a = cc.screenToWorld(sx, sy, cc.nearClip);
    const b = cc.screenToWorld(sx, sy, cc.farClip);
    return { origin: a, dir: new pc.Vec3().sub2(b, a).normalize() };
  }

  /** Neutral name tags for nearby people in the room view only (never in first person, never colour-coded). */
  tags() {
    if (this.mode !== 'room') return [];
    const out = [];
    const w = window.innerWidth, h = window.innerHeight;
    const me = this.actors.get(this.me);
    for (const a of this.actors.values()) {
      if (!a.entity.enabled || !a.pos || a.id === this.me) continue;
      if (me?.pos && Math.hypot(a.pos[0] - me.pos[0], a.pos[1] - me.pos[1]) > 10) continue;
      const p = a.headWorld();
      const s = this.worldToScreen(p.x, p.y, p.z);
      if (!s || s.x < -50 || s.y < -50 || s.x > w + 50 || s.y > h + 50) continue;
      out.push({ id: a.id, x: s.x, y: s.y, name: castInfo(a.id)?.name.split(' ')[0] });
    }
    return out;
  }

  /**
   * Map pins in the mansion view: yours (gold, findable at a glance) and small neutral dots for
   * the people you perceive (red only for someone the server marks as revealed).
   */
  pins() {
    if (this.mode !== 'mansion') return [];
    const out = [];
    for (const a of this.actors.values()) {
      if (!a.pos) continue;
      const mine = a.id === this.me;
      if (!mine && !a.entity.enabled) continue;
      if (mine && !this.visible?.has(this.me)) continue;
      const s = this.worldToScreen(a.pos[0], mine ? 2.2 : 1.8, a.pos[1]);
      if (!s) continue;
      out.push({ id: a.id, x: s.x, y: s.y, me: mine, revealed: !mine && a.revealed });
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
    // Brighter than gameplay so the navigation cards read clearly on a phone, unless
    // &gameplay=1 asks for the real in-game lighting (review screenshots).
    if (new URLSearchParams(location.search).get('gameplay') !== '1') {
      this.app.scene.exposure = 2.1;
      this.app.scene.ambientLight = new pc.Color(0.3, 0.27, 0.3);
      this.app.scene.fog.start = 60; this.app.scene.fog.end = 120;
    }
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

export { mat, TUNING, CAMERA_START, DOORWAYS };
