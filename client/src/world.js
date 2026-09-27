// Builds the mansion in PlayCanvas from the shared layout (server/src/game/data.ts):
// walkable floors, walls with real doorway gaps, swinging doors, the Garden Gate exit,
// every hiding place as physical geometry (tables and beds with a crawl gap, hollow
// wardrobes, screens, curtains), and set dressing modelled on the reference package
// (references/mansion-package/rooms, mapping in docs/MANSION_REFERENCE_MAPPING.md).
// Geometry is authored from primitives with generated textures: real walkable 3D,
// but still placeholder art compared with modelled, textured production assets.
import * as pc from 'playcanvas';
import { CORRIDORS, EXIT_CORRIDOR, EXIT_POINT, ROOMS, ROOM_IDS, CAMERA_START, CLUES, GALLERY, frontOf } from '@game/data.ts';
import { texture } from './textures.js';

const WALL_H = 3.2;
const WALL_T = 0.3;
const EPS = 0.01;

// ------------------------------------------------------------------ materials
const matCache = new Map();
export function mat(hex, opts = {}) {
  const key = hex + JSON.stringify(opts);
  if (matCache.has(key)) return matCache.get(key);
  const m = new pc.StandardMaterial();
  m.diffuse = new pc.Color().fromString(hex);
  if (opts.emissive) { m.emissive = new pc.Color().fromString(opts.emissive); m.emissiveIntensity = opts.emissiveIntensity ?? 1; }
  m.gloss = opts.gloss ?? 0.25;
  m.metalness = opts.metalness ?? 0;
  m.useMetalness = true;
  if (opts.opacity !== undefined) { m.opacity = opts.opacity; m.blendType = pc.BLEND_NORMAL; m.depthWrite = false; }
  m.update();
  matCache.set(key, m);
  return m;
}

let DEVICE = null;
/** A material using a generated texture (see textures.js). `emit` makes it glow (windows, fire). */
function tmat(key, { tint = '#ffffff', gloss = 0.3, metalness = 0, emit = 0, args = [] } = {}) {
  const id = ['t', key, tint, gloss, metalness, emit, ...args].join('|');
  if (matCache.has(id)) return matCache.get(id);
  const m = new pc.StandardMaterial();
  const tex = texture(DEVICE, key, ...args);
  m.diffuseMap = tex;
  m.diffuse = new pc.Color().fromString(tint);
  m.gloss = gloss;
  m.metalness = metalness;
  m.useMetalness = true;
  if (emit) { m.emissiveMap = tex; m.emissive = new pc.Color(1, 1, 1); m.emissiveIntensity = emit; }
  m.update();
  matCache.set(id, m);
  return m;
}

// ------------------------------------------------------------------ geometry helpers
const meshCache = new Map();
/**
 * A box mesh whose UVs are in world units / (su, sv), so a texture keeps the same
 * physical size on a 2 m and a 20 m wall instead of stretching.
 */
function boxMesh(w, h, d, su, sv) {
  const key = [w, h, d, su, sv].map(v => v.toFixed(3)).join(',');
  if (meshCache.has(key)) return meshCache.get(key);
  const hx = w / 2, hy = h / 2, hz = d / 2;
  const P = [], N = [], U = [], I = [];
  const face = (n, corners, uv) => {
    const base = P.length / 3;
    for (let i = 0; i < 4; i++) { P.push(...corners[i]); N.push(...n); U.push(...uv[i]); }
    I.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const uX = w / su, uZ = d / su, vY = h / sv, vZ = d / su;
  face([1, 0, 0], [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]], [[0, 0], [uZ, 0], [uZ, vY], [0, vY]]);
  face([-1, 0, 0], [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]], [[0, 0], [uZ, 0], [uZ, vY], [0, vY]]);
  face([0, 0, 1], [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]], [[0, 0], [uX, 0], [uX, vY], [0, vY]]);
  face([0, 0, -1], [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]], [[0, 0], [uX, 0], [uX, vY], [0, vY]]);
  face([0, 1, 0], [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]], [[0, 0], [uX, 0], [uX, vZ], [0, vZ]]);
  face([0, -1, 0], [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]], [[0, 0], [uX, 0], [uX, vZ], [0, vZ]]);
  const mesh = new pc.Mesh(DEVICE);
  mesh.setPositions(P); mesh.setNormals(N); mesh.setUvs(0, U); mesh.setIndices(I);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  meshCache.set(key, mesh);
  return mesh;
}

// ------------------------------------------------------------------ furniture models
// CC0 Quaternius furniture (tools/assets/build-props.mjs -> /models/props/). Loaded once and
// shared; each placement is fitted to a size, recoloured to the mansion palette and batched.
const PROP_BASE = 'models/props/';
let propManifest = null;
const propContainers = new Map();
const tintedMats = new Map();
const loadPropManifest = () => (propManifest ??= fetch(PROP_BASE + 'manifest.json').then(r => r.json()));
function loadProp(app, name) {
  if (!propContainers.has(name)) propContainers.set(name, new Promise((resolve, reject) => {
    const asset = new pc.Asset('prop-' + name, 'container', { url: PROP_BASE + name + '.glb' });
    asset.on('load', a => resolve(a.resource));
    asset.on('error', e => reject(new Error(name + ': ' + e)));
    app.assets.add(asset);
    app.assets.load(asset);
  }));
  return propContainers.get(name);
}
/** One shared material per (source material, tint) so identical props still batch together. */
function tinted(source, tint) {
  const t = typeof tint === 'string' ? { color: tint } : tint;
  const key = source.id + ':' + JSON.stringify(t);
  if (!tintedMats.has(key)) {
    const m = source.clone();
    if (t.color) m.diffuse = new pc.Color().fromString(t.color);
    if (t.emissive) { m.emissive = new pc.Color().fromString(t.emissive); m.emissiveIntensity = t.intensity ?? 1; }
    if (t.gloss != null) m.gloss = t.gloss;
    m.update();
    tintedMats.set(key, m);
  }
  return tintedMats.get(key);
}

export class World {
  constructor(app) {
    this.app = app;
    DEVICE = app.graphicsDevice;
    this.root = new pc.Entity('Mansion');
    app.root.addChild(this.root);
    this.staticGroup = app.batcher.addGroup('static', false, 40).id;
    this.doors = [];
    this.roomLights = {};
    this.hideCovers = {};
    this.exitDoor = null;
    this.exitLight = null;
    this.painting = null;
    this.cameraProp = null;
    this.propJobs = [];
    this.practicals = [];   // lamp / sconce lights that can flicker and fail after the attack
    this.build();
    /** Resolves when every furniture model has been placed (room-card capture waits for it). */
    this.propsReady = Promise.allSettled(this.propJobs);
  }

  // Low-level placers (all static geometry joins the batch group).
  /** Static geometry joins the batch group; pass batch=false for anything that toggles or changes. */
  wbox(parent, name, [x, y, z], [w, h, d], material, su = 1, sv = su, batch = true) {
    const e = new pc.Entity(name);
    e.addComponent('render', { meshInstances: [new pc.MeshInstance(boxMesh(w, h, d, su, sv), material)], castShadows: false, receiveShadows: false, batchGroupId: batch ? this.staticGroup : undefined });
    e.setLocalPosition(x, y, z);
    parent.addChild(e);
    return e;
  }
  box(parent, name, pos, size, material, batch = true) { return this.wbox(parent, name, pos, size, material, 1, 1, batch); }
  prim(parent, type, name, pos, scale, material, batch = true) {
    const e = new pc.Entity(name);
    e.addComponent('render', { type, material, castShadows: false, receiveShadows: false, batchGroupId: batch ? this.staticGroup : undefined });
    e.setLocalPosition(...pos);
    e.setLocalScale(...scale);
    parent.addChild(e);
    return e;
  }
  /** A rotated local frame at floor level: +z points toward `yaw` (degrees, 0 = +z, 90 = +x). */
  grp(parent, name, x, z, yaw = 0, y = 0) {
    const e = new pc.Entity(name);
    e.setLocalPosition(x, y, z);
    e.setLocalEulerAngles(0, yaw, 0);
    parent.addChild(e);
    return e;
  }

  /**
   * A furniture model fitted to a height (h), width (w) or depth (d) in a local frame whose
   * +z faces yaw; replaces fallback (the primitive version) once loaded.
   */
  propAt(parent, name, x, z, yaw, { h, w, d, y = 0, tints = {}, fallback = null } = {}) {
    const g = this.grp(parent, 'Prop_' + name, x, z, yaw, y);
    this.propJobs.push((async () => {
      const [manifest, container] = await Promise.all([loadPropManifest(), loadProp(this.app, name)]);
      const info = manifest.props[name];
      const s = h ? h / info.size[1] : w ? w / info.size[0] : d / info.size[2];
      const e = container.instantiateRenderEntity({ castShadows: false, receiveShadows: false, batchGroupId: this.staticGroup });
      e.setLocalScale(s, s, s);
      e.setLocalPosition(-(info.min[0] + info.size[0] / 2) * s, -info.min[1] * s, -(info.min[2] + info.size[2] / 2) * s);
      for (const r of e.findComponents('render')) {

        for (const mi of r.meshInstances) if (tints[mi.material.name]) mi.material = tinted(mi.material, tints[mi.material.name]);
      }
      g.addChild(e);
      if (fallback) fallback.enabled = false;
    })().catch(err => console.warn('furniture model unavailable, keeping the primitive', err)));
    return g;
  }

  build() {
    const { app, root } = this;
    app.scene.ambientLight = new pc.Color(0.2, 0.17, 0.2);
    app.scene.fog.type = pc.FOG_LINEAR;
    app.scene.fog.color = new pc.Color(0.03, 0.03, 0.06);
    app.scene.fog.start = 24;
    app.scene.fog.end = 64;

    // Cold moonlight over everything (one cheap directional light, no shadows).
    const moon = new pc.Entity('Moonlight');
    moon.addComponent('light', { type: 'directional', color: new pc.Color(0.45, 0.55, 0.85), intensity: 0.35, castShadows: false });
    moon.setLocalEulerAngles(55, 30, 0);
    root.addChild(moon);

    // Grounds and the wet paving outside so gaps never show the void.
    this.box(root, 'Grounds', [0, -0.06, 40], [100, 0.1, 100], mat('#0a0b10', { gloss: 0.5 }));

    this.roomNodes = {};
    for (const id of ROOM_IDS) {
      const room = ROOMS[id];
      const [x0, x1, z0, z1] = room.rect;
      const node = new pc.Entity(`Room_${id}`);
      root.addChild(node);
      this.roomNodes[id] = node;
      const floor = room.style?.floor ?? 'planks';
      const floorScale = { marble: 3.2, parquet: 2.4, herringbone: 2.6, planks: 3.4, stone: 3, tile: 3 }[floor] ?? 3;
      // Blender-built rooms bring their own floor, walls' finish, furniture and hiding places.
      const modelled = !!room.model;
      if (modelled) this.loadRoomModel(room.model);
      else this.wbox(node, 'Floor', [(x0 + x1) / 2, 0, (z0 + z1) / 2], [x1 - x0, 0.1, z1 - z0], tmat(floor, { gloss: floor === 'marble' ? 0.7 : 0.45 }), floorScale);
      const light = new pc.Entity(`Light_${id}`);
      light.addComponent('light', { type: 'omni', color: new pc.Color(1, 0.78, 0.55), intensity: modelled ? 0.9 : 1.35, range: Math.max(12, Math.hypot(x1 - x0, z1 - z0) * 0.6), castShadows: false });
      light.setLocalPosition(room.center[0], 2.8, room.center[1]);
      node.addChild(light);
      this.roomLights[id] = light;
      if (!modelled) {
        this.dressRoom(id, node);
        this.cornerPlants(id, node);
      }
      this.hideCovers[id] = room.hides.map(h => this.buildCover(node, h, modelled));
    }
    this.buildClues();
    for (const c of CORRIDORS) for (const [x0, x1, z0, z1] of c.rects) {
      this.wbox(root, 'PassageFloor', [(x0 + x1) / 2, 0.005, (z0 + z1) / 2], [x1 - x0, 0.1, z1 - z0], tmat('planks', { tint: '#b8a898' }), 3);
      this.wbox(root, 'PassageRunner', [(x0 + x1) / 2, 0.06, (z0 + z1) / 2], [Math.max(0.2, x1 - x0 - 0.9), 0.02, Math.max(0.2, z1 - z0 - 0.9)], mat('#5a1618', { gloss: 0.1 }));
    }
    {
      const [x0, x1, z0, z1] = EXIT_CORRIDOR.rect;
      this.wbox(root, 'ExitFloor', [(x0 + x1) / 2, 0.005, (z0 + z1) / 2], [x1 - x0, 0.1, z1 - z0], tmat('stone'), 2);
    }

    // Walls with doorway gaps, surfaced in the style of the room they bound. A dark stone cap
    // on top: from the eagle-eye views the wall tops read as masonry, not as wallpaper.
    const cap = mat('#17130f', { gloss: 0.15 });
    for (const w of computeWalls()) {
      const len = w.b - w.a + WALL_T;
      const mid = (w.a + w.b) / 2;
      const m = this.wallMat(w.axis === 'x' ? mid : w.x, w.axis === 'x' ? w.z : mid);
      if (w.axis === 'x') {
        this.wbox(root, 'Wall', [mid, WALL_H / 2, w.z], [len, WALL_H, WALL_T], m.mat, m.su, WALL_H);
        this.box(root, 'WallCap', [mid, WALL_H + 0.03, w.z], [len + 0.04, 0.06, WALL_T + 0.06], cap);
      } else {
        this.wbox(root, 'Wall', [w.x, WALL_H / 2, mid], [WALL_T, WALL_H, len], m.mat, m.su, WALL_H);
        this.box(root, 'WallCap', [w.x, WALL_H + 0.03, mid], [WALL_T + 0.06, 0.06, len + 0.04], cap);
      }
    }

    // Doors: one leaf at each passage/room junction. Hinged, they swing when someone passes.
    for (const c of CORRIDORS) for (const d of c.doors) this.buildDoor(d.pos, d.axis, false);
    this.exitDoor = this.buildDoor(EXIT_CORRIDOR.door.pos, 'z', true);
    this.buildGardenGate();
    this.buildCourtyard();
    this.buildExterior();
    this.buildFoyerStairs();

    // The single antique camera prop (position driven by game state).
    const cam = new pc.Entity('AntiqueCamera');
    this.prim(cam, 'box', 'Body', [0, 0, 0], [0.34, 0.24, 0.2], mat('#2b2622', { gloss: 0.6, metalness: 0.4 }), false);
    this.prim(cam, 'cylinder', 'Lens', [0, 0, 0.14], [0.14, 0.12, 0.14], mat('#9a8f7c', { gloss: 0.8, metalness: 0.8 }), false).setLocalEulerAngles(90, 0, 0);
    this.prim(cam, 'box', 'FlashBulb', [0.1, 0.17, 0], [0.1, 0.1, 0.1], mat('#ddd', { emissive: '#fff6d8', emissiveIntensity: 0.4 }), false);
    cam.setLocalPosition(CAMERA_START.pos[0], 0.15, CAMERA_START.pos[1]);
    root.addChild(cam);
    this.cameraProp = cam;
    this.cameraGlow = new pc.Entity('CameraGlow');
    this.cameraGlow.addComponent('light', { type: 'omni', color: new pc.Color(1, 0.9, 0.6), intensity: 0.8, range: 2.5, castShadows: false });
    this.cameraGlow.setLocalPosition(0, 0.5, 0);
    cam.addChild(this.cameraGlow);
  }

  /** Wall surface for a point on a wall: the style of the room it bounds (passages: walnut). */
  wallMat(x, z) {
    for (const id of ROOM_IDS) {
      const [x0, x1, z0, z1] = ROOMS[id].rect;
      if (x >= x0 - 0.2 && x <= x1 + 0.2 && z >= z0 - 0.2 && z <= z1 + 0.2) {
        const wall = ROOMS[id].style?.wall ?? 'walnut';
        const key = wall === 'stone' ? 'stonewall' : wall;
        return { mat: tmat(key, { gloss: wall === 'mirror' ? 0.8 : 0.3, metalness: wall === 'mirror' ? 0.3 : 0 }), su: wall === 'walnut' ? 2.4 : 3 };
      }
    }
    const [ex0, ex1, ez0, ez1] = EXIT_CORRIDOR.rect;
    if (x >= ex0 - 0.2 && x <= ex1 + 0.2 && z >= ez0 - 0.2 && z <= ez1 + 0.2) return { mat: tmat('stonewall'), su: 3 };
    return { mat: tmat('walnut'), su: 2.4 };
  }

  buildDoor([x, z], axis, locked) {
    const hinge = new pc.Entity('DoorHinge');
    // axis 'z' = passage along z, so the door lies along x.
    const alongX = axis === 'z';
    hinge.setLocalPosition(alongX ? x - 1 : x, 0, alongX ? z : z - 1);
    const leaf = new pc.Entity('DoorLeaf');
    leaf.addComponent('render', { type: 'box', material: locked ? mat('#26282c', { metalness: 0.7, gloss: 0.5 }) : mat('#5a3b22', { gloss: 0.45 }), castShadows: false });
    leaf.setLocalScale(alongX ? 2 : 0.1, 2.6, alongX ? 0.1 : 2);
    leaf.setLocalPosition(alongX ? 1 : 0, 1.3, alongX ? 0 : 1);
    hinge.addChild(leaf);
    const frameMat = mat('#2a1d14', { gloss: 0.4 });
    for (const s of [-1, 1]) {
      this.box(this.root, 'DoorPost', [alongX ? x + s * 1.08 : x, 1.5, alongX ? z : z + s * 1.08], [alongX ? 0.16 : 0.4, 3, alongX ? 0.4 : 0.16], frameMat);
    }
    this.box(this.root, 'DoorLintel', [x, 3.05, z], [alongX ? 2.3 : 0.4, 0.3, alongX ? 0.4 : 2.3], frameMat);
    this.root.addChild(hinge);
    const door = { hinge, pos: [x, z], alongX, angle: 0, target: 0, locked };
    this.doors.push(door);
    return door;
  }

  /** The rear service passage (ref 14) ends at the wrought-iron Garden Gate. */
  buildGardenGate() {
    const root = this.root;
    const gate = this.grp(root, 'GardenGate', EXIT_POINT[0], EXIT_CORRIDOR.rect[2] + 0.1, 0);
    const iron = mat('#15161a', { metalness: 0.8, gloss: 0.5 });
    for (let i = -4; i <= 4; i++) this.prim(gate, 'cylinder', 'Bar', [i * 0.22, 1.3, 0], [0.05, 2.6, 0.05], iron);
    this.box(gate, 'Rail', [0, 2.55, 0], [2, 0.08, 0.08], iron);
    this.box(gate, 'Rail2', [0, 0.25, 0], [2, 0.06, 0.06], iron);
    const sign = this.box(root, 'ExitSign', [EXIT_POINT[0], 2.75, 22.25], [1.6, 0.4, 0.05], mat('#300', { emissive: '#ff2a2a', emissiveIntensity: 1.2 }), false);
    this.exitSign = sign;
    const exitLight = new pc.Entity('ExitLight');
    exitLight.addComponent('light', { type: 'omni', color: new pc.Color(1, 0.1, 0.1), intensity: 1.2, range: 6, castShadows: false });
    exitLight.setLocalPosition(0, 2.4, 21);
    root.addChild(exitLight);
    this.exitLight = exitLight;
    // Two iron lanterns flanking the gate.
    for (const s of [-1, 1]) this.prim(root, 'sphere', 'GateLantern', [s * 0.8, 2.2, 18.9], [0.18, 0.24, 0.18], mat('#221', { emissive: '#ffb45a', emissiveIntensity: 1.2 }));
  }

  /**
   * Beyond the Garden Gate (spec §10): a walled garden courtyard between the two wings, seen
   * through the gate bars and on the way out. Crossing the gate is the escape; the courtyard
   * is scenery, not a second chase. Wayfinding in the Sealed Exhibition Room: Garden Gate · Courtyard.
   */
  buildCourtyard() {
    const root = this.root;
    const x0 = ROOMS.portrait.rect[1] + WALL_T / 2, x1 = ROOMS.archive.rect[0] - WALL_T / 2;
    const zN = EXIT_CORRIDOR.rect[2], zS = ROOMS.portrait.rect[2] + WALL_T / 2;
    const cx = (x0 + x1) / 2, cz = (zN + zS) / 2;
    this.wbox(root, 'CourtyardPaving', [cx, 0.0, cz], [x1 - x0, 0.1, zN - zS], tmat('stone', { tint: '#6a6f76', gloss: 0.7 }), 2);
    this.wbox(root, 'CourtyardPath', [cx, 0.03, cz], [1.4, 0.06, zN - zS], tmat('tile', { tint: '#8a8478', gloss: 0.6 }), 1.4);
    for (const sx of [-1, 1]) {
      for (let z = zS + 1.2; z < zN - 1.2; z += 2.4) this.box(root, 'CourtyardHedge', [cx + sx * 1.9, 0.45, z], [0.9, 0.9, 2.0], mat('#1e3322', { gloss: 0.1 }));
    }
    // A small fountain halfway down, with a lantern glow, and the arch out to the front drive.
    const fz = cz - 1;
    this.prim(root, 'cylinder', 'FountainBasin', [cx, 0.25, fz], [1.6, 0.5, 1.6], mat('#9c968a', { gloss: 0.4 }));
    this.prim(root, 'cylinder', 'FountainWater', [cx, 0.46, fz], [1.4, 0.06, 1.4], mat('#1a2a3a', { gloss: 0.95, metalness: 0.2, emissive: '#1a2a40', emissiveIntensity: 0.4 }));
    this.prim(root, 'cylinder', 'FountainStem', [cx, 0.9, fz], [0.18, 1.0, 0.18], mat('#9c968a'));
    this.plantAt(root, cx, fz, 0.6, 'houseplant_5');
    for (const z of [zN - 1.4, zS + 1.6]) {
      this.box(root, 'CourtyardLantern', [cx - 1.25, 2.3, z], [0.26, 0.38, 0.26], mat('#221', { emissive: '#ffb45a', emissiveIntensity: 1.2 }));
      this.practical(root, cx - 1.25, 2.1, z, 5.5, 0.8);
    }
    this.box(root, 'CourtyardArch', [cx, 3.4, zS + 0.1], [x1 - x0, 0.5, 0.4], mat('#a8a296'));
    // Wayfinding inside the Sealed Exhibition Room, beside the service door.
    const sign = this.grp(root, 'GateSign', EXIT_CORRIDOR.door.pos[0] + 2.1, EXIT_CORRIDOR.door.pos[1] + WALL_T / 2 + 0.01, 0);
    this.wbox(sign, 'GateSignBoard', [0, 2.05, 0.02], [1.7, 0.34, 0.03], tmat('plaque', { args: ['GARDEN GATE  ·  COURTYARD  →'], metalness: 0.6, gloss: 0.6 }), 1.7, 0.34);
  }

  /**
   * The foyer's twin staircases and balcony (reference 02): two short flights along the south
   * wall rising to a landing above the front doors. Decorative only: velvet ropes close the
   * foot of each flight and a plaque says the upper gallery is closed, so no route is implied.
   */
  buildFoyerStairs() {
    const node = this.root;
    const [x0, x1, z0] = ROOMS.portrait.rect;
    const ex = ROOMS.portrait.center[0], wall = z0 + WALL_T / 2;
    const tread = mat('#4a2c18', { gloss: 0.55 }), rail = mat('#2a1a10', { gloss: 0.6 }), gilt = mat('#b08a3a', { metalness: 0.9, gloss: 0.7 });
    const steps = 9, rise = 2.9 / steps, run = 0.28, width = 1.1, depth = width;
    for (const side of [-1, 1]) {
      // Each flight starts away from the doors and climbs toward the landing above them.
      const startX = ex + side * (1.8 + steps * run);
      for (let i = 0; i < steps; i++) {
        const x = startX - side * (i + 0.5) * run;
        this.box(node, 'Stair', [x, (i + 1) * rise / 2, wall + depth / 2], [run + 0.02, (i + 1) * rise, depth], tread);
      }
      // Banister along the open side of the flight.
      const midX = startX - side * steps * run / 2, len = Math.hypot(steps * run, 2.9);
      const bannister = this.box(node, 'Banister', [midX, 1.45 + 0.9, wall + depth - 0.04], [len, 0.07, 0.07], rail);
      bannister.setLocalEulerAngles(0, 0, side * Math.atan2(2.9, steps * run) * 180 / Math.PI);
      for (let i = 0; i <= steps; i += 3) this.box(node, 'Baluster', [startX - side * i * run, i * rise + 0.45, wall + depth - 0.04], [0.05, 0.9, 0.05], rail);
      // Velvet rope across the foot of the flight.
      const footX = startX + side * 0.25;
      for (const dz of [0.1, depth - 0.1]) this.prim(node, 'cylinder', 'Stanchion', [footX, 0.45, wall + dz], [0.07, 0.9, 0.07], gilt);
      this.box(node, 'StairRope', [footX, 0.82, wall + depth / 2], [0.05, 0.05, depth - 0.2], mat('#6e1c24'));
    }
    // Landing / balcony above the doors, with a balustrade.
    const lw = 3.8;
    this.box(node, 'Landing', [ex, 2.9, wall + 0.65], [lw, 0.14, 1.3], tread);
    this.box(node, 'BalconyRail', [ex, 3.75, wall + 1.28], [lw, 0.08, 0.08], rail);
    for (let x = -lw / 2; x <= lw / 2 + 0.01; x += 0.38) this.box(node, 'BalconyBaluster', [ex + x, 3.35, wall + 1.28], [0.05, 0.8, 0.05], rail);
    const plaque = this.grp(node, 'UpperGalleryClosed', ex, wall + 1.31, 0);
    this.wbox(plaque, 'ClosedPlaque', [0, 3.2, 0.01], [1.3, 0.24, 0.02], tmat('plaque', { args: ['UPPER GALLERY CLOSED'], metalness: 0.6, gloss: 0.6 }), 1.3, 0.24);
  }

  // ------------------------------------------------------------------ hiding places
  buildCover(node, h, modelled = false) {
    const { pos: [x, z], size: [w, d], height, kind } = h.cover;
    let entity = null;
    if (modelled) { /* the room model has the real bed / wardrobe / curtain */ }
    else if (kind === 'table' || kind === 'desk' || kind === 'crates') entity = this.buildUnderCover(node, h);
    else if (kind === 'bed4' || kind === 'bedbrass' || kind === 'bedsingle') entity = this.buildBed(node, h);
    else if (kind === 'wardrobe') entity = this.buildWardrobe(node, h);
    else if (kind === 'fscreen') entity = this.buildFoldingScreen(node, h);
    else if (kind === 'frame') entity = this.buildAjarFrame(node, h);
    else {
      const m = kind === 'curtain' ? tmat('velvet', { args: ['#5e1420'], gloss: 0.15 })
        : kind === 'bookcase' || kind === 'shelf' ? tmat('books')
        : kind === 'mirror' ? tmat('mirror', { gloss: 0.9, metalness: 0.4 })
        : mat({ panel: '#3b2a20', plinth: '#8d8a82', screen: '#4d4034', cabinet: '#5f6a6a', rack: '#6b5b43' }[kind] ?? '#444', { gloss: 0.35 });
      entity = this.wbox(node, `Cover_${h.id}`, [x, height / 2, z], [w, height, d], m, kind === 'curtain' ? 1.2 : 2, height);
      if (kind === 'plinth') this.prim(node, 'sphere', 'Bust', [x, height + 0.35, z], [0.6, 0.7, 0.6], mat('#bdb8ad'));
      if (kind === 'curtain') this.prim(node, 'cylinder', 'CurtainRod', [x, height + 0.05, z], [w > d ? 0.05 : 0.05, 0.05, 0.05], mat('#8a6a2a', { metalness: 0.8 }));
    }
    // A faint floor marker on the open side, shown only for the hiding place you chose.
    const [fx, fz] = frontOf(h, 0.2);
    const marker = this.box(node, `HideMarker_${h.id}`, [fx, 0.075, fz], [0.8, 0.02, 0.8], mat('#111', { emissive: '#8a6d2a', emissiveIntensity: 0.3 }), false);
    marker.enabled = false;
    return { entity, marker, id: h.id };
  }

  /**
   * A Blender-built room (client/public/models/rooms/<file>.glb, authored around world
   * (0, 0, origin z)): one merged mesh plus LIGHT_* marker nodes where lamps and sconces glow.
   * Shared by every room that uses the same file (the guest suite has bedroom + bathroom).
   */
  loadRoomModel({ file, origin, baked = false }) {
    this.roomModels ??= new Set();
    if (this.roomModels.has(file)) return;
    this.roomModels.add(file);
    // Baked lighting, when the build shipped one: <file>.json = {lightmap, scale} beside the GLB.
    const sidecar = baked ? fetch(`models/rooms/${file}.json`).then(r => (r.ok ? r.json() : null)).catch(() => null) : Promise.resolve(null);
    this.propJobs.push(new Promise((resolve, reject) => {
      const asset = new pc.Asset(`room-${file}`, 'container', { url: `models/rooms/${file}.glb` });
      asset.on('load', a => resolve(a.resource)); asset.on('error', reject);
      this.app.assets.add(asset); this.app.assets.load(asset);
    }).then(async res => {
      const e = res.instantiateRenderEntity({ castShadows: false, receiveShadows: false });
      e.setLocalPosition(origin[0], 0, origin[1]);
      const lm = await sidecar;
      if (lm?.lightmap) {
        try {
          this.applyLightmap(e, await loadLightmap(this.app.graphicsDevice, `models/rooms/${lm.lightmap}`), (lm.scale ?? 1) * (lm.exposure ?? 1));
        } catch (err) { console.warn('lightmap unavailable, runtime lights only', file, err); }
      }
      this.root.addChild(e);
      const baked = !!lm?.lightmap;
      for (const n of e.find(x => /^LIGHT_/.test(x.name))) {
        const p = n.getPosition();
        const kind = /candle/.test(n.name) ? 'candle' : /sconce/.test(n.name) ? 'sconce' : 'lamp';
        // With baked lighting these only light people and small props; the room itself is baked.
        const [range, intensity] = { candle: [1.8, 0.3], sconce: [3.4, baked ? 0.55 : 0.7], lamp: [3.0, baked ? 0.7 : 0.9] }[kind];
        this.practical(this.root, p.x, p.y, p.z, range, intensity);
      }
      // The room's fill light only needs to light people once the room itself is baked.
      if (baked) for (const id of ROOM_IDS) if (ROOMS[id].model?.file === file && this.roomLights[id]) this.roomLights[id].light.intensity = 0.55;
    }).catch(err => {
      // Never leave a room empty on a phone that failed to load it: fall back to the generated
      // floor, dressing and hiding places the room had before it was modelled.
      console.warn('room model unavailable, using the generated room', file, err);
      for (const id of ROOM_IDS) if (ROOMS[id].model?.file === file) this.generatedRoom(id);
    }));
  }

  /**
   * Put a baked lightmap on every material of a room model: the texture (TEXCOORD_1) carries
   * sRGB-encoded irradiance / scale, so the lightmap shader chunk multiplies it back by scale.
   * Baked surfaces ignore the runtime lights (they would light the room twice); people and the
   * generated props are still lit by them.
   */
  applyLightmap(entity, tex, scale) {
    const device = this.app.graphicsDevice;
    const base = pc.ShaderChunks?.get(device, pc.SHADERLANGUAGE_GLSL)?.get('lightmapPS');
    const scaled = base && base.includes('dLightmap *= {STD_LIGHT_TEXTURE_DECODE}')
      ? base.replace('dLightmap *= {STD_LIGHT_TEXTURE_DECODE}', `dLightmap *= ${scale.toFixed(4)} * {STD_LIGHT_TEXTURE_DECODE}`)
      : null;
    if (!scaled) console.warn('lightmap chunk not patched: baked light shown at 1/' + scale.toFixed(2));
    const done = new Set();
    for (const r of entity.findComponents('render')) {
      for (const mi of r.meshInstances) {
        mi.mask = pc.MASK_AFFECT_LIGHTMAPPED;
        const m = mi.material;
        if (done.has(m)) continue;
        done.add(m);
        m.lightMap = tex;
        m.lightMapUv = 1;
        if (scaled && !device.isWebGPU) {
          m.getShaderChunks(pc.SHADERLANGUAGE_GLSL).set('lightmapPS', scaled);
          m.shaderChunksVersion = pc.version.split('.').slice(0, 2).join('.');
        }
        m.update();
      }
    }
  }

  /** The generated version of a room (floor, dressing, hiding places): used if its model fails. */
  generatedRoom(id) {
    const room = ROOMS[id], node = this.roomNodes[id];
    const [x0, x1, z0, z1] = room.rect;
    const floor = room.style?.floor ?? 'planks';
    const floorScale = { marble: 3.2, parquet: 2.4, herringbone: 2.6, planks: 3.4, stone: 3, tile: 3 }[floor] ?? 3;
    this.wbox(node, 'Floor', [(x0 + x1) / 2, 0, (z0 + z1) / 2], [x1 - x0, 0.1, z1 - z0], tmat(floor, { gloss: floor === 'marble' ? 0.7 : 0.45 }), floorScale, floorScale, false);
    this.dressRoom(id, node);
    for (const c of this.hideCovers[id] ?? []) c.marker.destroy();
    this.hideCovers[id] = room.hides.map(h => this.buildCover(node, h, false));
  }

  // ------------------------------------------------------------------ eagle-eye helpers
  /** Scene settings for a camera mode: the mansion view is ~90 m away, so no fog there. */
  setViewMode(mode) {
    if (mode === this.viewMode) return;
    this.viewMode = mode;
    const fog = this.app.scene.fog;
    if (mode === 'mansion') { fog.type = pc.FOG_NONE; }
    else if (mode === 'room') { fog.type = pc.FOG_LINEAR; fog.start = 34; fog.end = 95; }
    else { fog.type = pc.FOG_LINEAR; fog.start = 24; fog.end = 64; }
  }

  /**
   * Gold rims on the rooms you can go to (a brighter one on your own room), and a dark veil over
   * the rest when dimOthers. Only architecture: nobody's position is shown by this.
   */
  highlightRooms(reachable = [], current = null, dimOthers = false) {
    const key = [...reachable].sort().join(',') + '|' + current + '|' + dimOthers;
    if (key === this.highlightKey) return;
    this.highlightKey = key;
    if (!this.rims) {
      const unlit = (hex, opacity) => {
        const m = new pc.StandardMaterial();
        m.diffuse = new pc.Color(0, 0, 0); m.emissive = new pc.Color().fromString(hex); m.useLighting = false; m.useFog = false;
        m.opacity = opacity; m.blendType = pc.BLEND_NORMAL; m.depthWrite = false; m.update();
        return m;
      };
      this.rimMat = unlit('#c99a45', 0.75);
      this.rimHereMat = unlit('#f3dca0', 0.85);
      const veil = unlit('#000000', 0.62);
      veil.emissive = new pc.Color(0.005, 0.004, 0.008); veil.update();
      this.rims = {}; this.veils = {};
      for (const id of ROOM_IDS) {
        const [x0, x1, z0, z1] = ROOMS[id].rect;
        const rim = new pc.Entity(`Rim_${id}`);
        rim.addComponent('render', { meshInstances: [new pc.MeshInstance(frameMesh(this.app.graphicsDevice, x0, x1, z0, z1, 0.12), this.rimMat)], castShadows: false });
        rim.setLocalPosition(0, WALL_H + 0.07, 0);
        rim.enabled = false;
        this.root.addChild(rim);
        this.rims[id] = rim;
        const v = new pc.Entity(`Veil_${id}`);
        v.addComponent('render', { type: 'box', material: veil, castShadows: false });
        v.setLocalPosition((x0 + x1) / 2, WALL_H + 0.12, (z0 + z1) / 2);
        v.setLocalScale(x1 - x0 + 0.36, 0.02, z1 - z0 + 0.36);
        v.enabled = false;
        this.root.addChild(v);
        this.veils[id] = v;
      }
    }
    const can = new Set(reachable);
    for (const id of ROOM_IDS) {
      const lit = can.has(id) || id === current;
      this.rims[id].enabled = lit;
      if (lit) this.rims[id].render.meshInstances[0].material = id === current ? this.rimHereMat : this.rimMat;
      this.veils[id].enabled = dimOthers && !lit;
    }
  }

  /** Breadcrumbs along the path your character is following (null clears): one mesh, one draw call. */
  setRoute(points) {
    const key = points ? points.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(';') : '';
    if (key === this.routeKey) return;
    this.routeKey = key;
    if (!this.routeEntity) {
      const m = new pc.StandardMaterial();
      m.diffuse = new pc.Color(0, 0, 0); m.emissive = new pc.Color(0.95, 0.72, 0.3); m.useLighting = false; m.useFog = false;
      m.opacity = 0.85; m.blendType = pc.BLEND_NORMAL; m.depthWrite = false; m.update();
      this.routeMesh = new pc.Mesh(this.app.graphicsDevice);
      this.routeEntity = new pc.Entity('Route');
      this.routeEntity.addComponent('render', { meshInstances: [new pc.MeshInstance(this.routeMesh, m)], castShadows: false });
      this.routeEntity.enabled = false;
      this.root.addChild(this.routeEntity);
    }
    const dots = [];
    for (let i = 0; points && i < points.length - 1; i++) {
      const [ax, az] = points[i], [bx, bz] = points[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      for (let d = i === 0 ? 0.3 : 0; d < len && dots.length < 400; d += 0.45) dots.push([ax + (bx - ax) * d / len, az + (bz - az) * d / len]);
    }
    this.routeEntity.enabled = dots.length > 0;
    if (!dots.length) return;
    const P = [], N = [], I = [], r = 0.055, seg = 8;
    for (const [x, z] of dots) {
      const c = P.length / 3;
      P.push(x, 0.075, z); N.push(0, 1, 0);
      for (let k = 0; k < seg; k++) {
        const a = k / seg * Math.PI * 2;
        P.push(x + Math.cos(a) * r, 0.075, z + Math.sin(a) * r); N.push(0, 1, 0);
        I.push(c, c + 1 + ((k + 1) % seg), c + 1 + k);
      }
    }
    this.routeMesh.clear(true, true);
    this.routeMesh.setPositions(P); this.routeMesh.setNormals(N); this.routeMesh.setIndices(I);
    this.routeMesh.update(pc.PRIMITIVE_TRIANGLES);
  }

  /** A pulsing ring where you are going (kind: 'move' | 'hide' | 'room'); null clears. */
  setDestination(p, kind = 'move') {
    if (!this.destRing) {
      const mk = hex => {
        const m = new pc.StandardMaterial();
        m.diffuse = new pc.Color(0, 0, 0); m.emissive = new pc.Color().fromString(hex); m.useLighting = false; m.useFog = false;
        m.opacity = 0.9; m.blendType = pc.BLEND_NORMAL; m.depthWrite = false; m.update();
        return m;
      };
      this.destMats = { move: mk('#f0c060'), room: mk('#f0c060'), hide: mk('#9fc3ff') };
      this.destRing = new pc.Entity('Destination');
      this.destRing.addComponent('render', { type: 'torus', material: this.destMats.move, castShadows: false });
      this.destRing.enabled = false;
      this.root.addChild(this.destRing);
      this.destT = 0;
    }
    this.destRing.enabled = !!p;
    if (!p) return;
    this.destRing.render.meshInstances[0].material = this.destMats[kind] ?? this.destMats.move;
    this.destRing.setLocalPosition(p[0], 0.08, p[1]);
  }

  /** Per-frame animation for the eagle-eye markers (called from updateLights). */
  pulseMarkers(dt) {
    if (!this.destRing?.enabled) return;
    this.destT = (this.destT + dt) % 1.2;
    const s = 0.55 + 0.25 * Math.sin(this.destT / 1.2 * Math.PI * 2);
    this.destRing.setLocalScale(s, 0.05, s);
  }

  /** Axis-aligned footprint of a cover as (across, depth) relative to its look direction. */
  frame(h) {
    const a = h.look * Math.PI / 180, sx = Math.abs(Math.sin(a)), cz = Math.abs(Math.cos(a));
    const [w, d] = h.cover.size;
    if (sx > cz + 0.05) return { across: d, depth: w }; // looking along ±x
    if (cz > sx + 0.05) return { across: w, depth: d }; // looking along ±z
    return { across: Math.max(w, d), depth: Math.min(w, d) }; // diagonal (e.g. a corner screen)
  }

  /**
   * Covers you get *under*: a tabletop on legs with drapery on every side except the
   * one the hider looks out of, or a tunnel of crates.
   */
  buildUnderCover(node, h) {
    const { pos: [x, z], size: [w, d], height, kind } = h.cover;
    const wood = kind === 'crates' ? mat('#6d5536') : mat(kind === 'desk' ? '#4a2c18' : '#5a3b22', { gloss: 0.5 });
    const cloth = kind === 'desk' ? mat('#3a1f2a', { gloss: 0.15 }) : tmat('velvet', { args: ['#5e1420'], gloss: 0.15 });
    const top = this.box(node, `Cover_${h.id}`, [x, height, z], [w, 0.08, d], wood);
    const lookRad = h.look * Math.PI / 180;
    const lx = Math.sin(lookRad), lz = Math.cos(lookRad);
    if (kind === 'crates') {
      for (const s of [-1, 1]) {
        const alongX = w > d;
        this.box(node, 'CrateSide', alongX ? [x, height / 2, z + s * (d / 2 - 0.2)] : [x + s * (w / 2 - 0.2), height / 2, z], alongX ? [w, height, 0.4] : [0.4, height, d], wood);
      }
      this.box(node, 'CrateTop', [x, height + 0.35, z], [w * 0.8, 0.6, d * 0.7], mat('#7b6040'));
    } else {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.box(node, 'Leg', [x + sx * (w / 2 - 0.08), height / 2, z + sz * (d / 2 - 0.08)], [0.08, height, 0.08], wood);
      const sides = [[1, 0, w], [-1, 0, w], [0, 1, d], [0, -1, d]];
      for (const [nx, nz] of sides) {
        if (nx * lx + nz * lz > 0.5) continue; // the viewing side stays open
        const cx = x + nx * w / 2, cz = z + nz * d / 2;
        const len = nx ? d : w;
        this.box(node, 'Drape', [cx, height / 2 + 0.04, cz], nx ? [0.04, height - 0.08, len] : [len, height - 0.08, 0.04], cloth);
      }
      // Birthday setting on the buffet / papers on the desk and reading table.
      if (kind === 'table' && h.id === 'buffet_table') {
        this.prim(node, 'cylinder', 'Cake', [x, height + 0.16, z], [0.5, 0.24, 0.5], mat('#efe4d4', { gloss: 0.4 }));
        for (let i = 0; i < 5; i++) this.prim(node, 'cylinder', 'Candle', [x - 0.15 + i * 0.075, height + 0.36, z], [0.02, 0.14, 0.02], mat('#fff', { emissive: '#ffcf6a', emissiveIntensity: 1 }));
      } else {
        this.box(node, 'Papers', [x + w * 0.15, height + 0.05, z - d * 0.1], [0.5, 0.02, 0.35], mat('#d8ccb0'));
        this.prim(node, 'cone', 'Lamp', [x - w * 0.3, height + 0.3, z], [0.3, 0.3, 0.3], mat('#221', { emissive: '#ffcf8a', emissiveIntensity: 0.8 }));
      }
    }
    return top;
  }

  /**
   * Beds with a real crawl gap (clearance = cover.height) and the headboard against the
   * north (+z) wall. The foot/side the hider looks out of has no skirt.
   */
  buildBed(node, h) {
    const { pos: [x, z], size: [w, d], height: H, kind } = h.cover;
    const wood = mat(kind === 'bedbrass' ? '#b08a3a' : '#3a2214', { gloss: kind === 'bedbrass' ? 0.8 : 0.5, metalness: kind === 'bedbrass' ? 0.8 : 0 });
    const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2;
    // Legs and rails.
    for (const lx of [x0 + 0.06, x1 - 0.06]) for (const lz of [z0 + 0.06, z1 - 0.06]) this.box(node, 'BedLeg', [lx, H / 2, lz], [0.1, H, 0.1], wood);
    this.box(node, 'RailL', [x0 + 0.04, H - 0.06, z], [0.08, 0.14, d], wood);
    this.box(node, 'RailR', [x1 - 0.04, H - 0.06, z], [0.08, 0.14, d], wood);
    this.box(node, 'RailFoot', [x, H - 0.06, z0 + 0.04], [w, 0.14, 0.08], wood);
    // Slatted underside (what you see from beneath), mattress, coverlet, pillows.
    const bed = this.box(node, `Cover_${h.id}`, [x, H + 0.02, z], [w - 0.1, 0.05, d - 0.1], mat('#2a1a10'));
    for (let i = 0; i < 6; i++) this.box(node, 'Slat', [x, H - 0.01, z0 + 0.25 + i * (d - 0.5) / 5], [w - 0.14, 0.03, 0.08], mat('#4a3220'));
    this.box(node, 'Mattress', [x, H + 0.2, z], [w - 0.12, 0.3, d - 0.12], mat('#e8e0d4', { gloss: 0.2 }));
    const quilt = kind === 'bed4' ? ['#6e1c24'] : kind === 'bedbrass' ? ['#2c3a5c'] : ['#233054'];
    this.wbox(node, 'Coverlet', [x, H + 0.37, z - d * 0.1], [w - 0.05, 0.05, d * 0.78], tmat('quilt', { args: quilt, gloss: 0.2 }), 1.2);
    for (const s of [-1, 1]) this.box(node, 'Pillow', [x + s * (w / 4), H + 0.44, z1 - 0.35], [w / 2 - 0.12, 0.14, 0.4], mat('#f2ece2'));
    // Headboard.
    this.box(node, 'Headboard', [x, (H + 1.3) / 2, z1 - 0.05], [w, H + 1.3, 0.1], wood);
    if (kind === 'bed4') {
      for (const lx of [x0 + 0.06, x1 - 0.06]) for (const lz of [z0 + 0.06, z1 - 0.06]) this.prim(node, 'cylinder', 'Post', [lx, 1.4, lz], [0.12, 2.8, 0.12], wood);
      this.box(node, 'Canopy', [x, 2.8, z], [w + 0.1, 0.14, d + 0.1], tmat('velvet', { args: ['#6e1c24'] }));
      // Drapes tied back at the head posts (never across the crawl gap).
      for (const lx of [x0 + 0.1, x1 - 0.1]) this.wbox(node, 'BedDrape', [lx, 1.6, z1 - 0.25], [0.18, 2.3, 0.35], tmat('velvet', { args: ['#6e1c24'] }), 1, 2.3);
    } else if (kind === 'bedbrass') {
      const brass = mat('#c9a24a', { metalness: 0.9, gloss: 0.8 });
      for (let i = 0; i <= 6; i++) this.prim(node, 'cylinder', 'FootBar', [x0 + 0.1 + i * (w - 0.2) / 6, H + 0.55, z0 + 0.02], [0.03, 0.5, 0.03], brass);
      this.prim(node, 'cylinder', 'FootRail', [x, H + 0.82, z0 + 0.02], [0.05, w, 0.05], brass).setLocalEulerAngles(0, 0, 90);
    } else {
      // Nursery canopy hoop with a sheer drape at the head.
      this.prim(node, 'torus', 'CanopyHoop', [x, 2.45, z1 - 0.3], [0.9, 0.3, 0.9], mat('#8a7a5a', { metalness: 0.6 }));
      this.wbox(node, 'Sheer', [x, 1.6, z1 - 0.3], [0.9, 1.7, 0.05], mat('#e8e4f0', { opacity: 0.45 }), 1);
    }
    return bed;
  }

  /** A hollow, adult-height wardrobe/closet: back, sides, top, clothes, two doors ajar. */
  buildWardrobe(node, h) {
    const { pos: [x, z], height: H } = h.cover;
    const { across, depth } = this.frame(h);
    const nursery = h.id === 'nursery_closet';
    const wood = mat(nursery ? '#6a5a48' : '#3e2616', { gloss: 0.5 });
    const g = this.grp(node, `Cover_${h.id}`, x, z, h.look);
    this.box(g, 'Back', [0, H / 2, -depth / 2 + 0.03], [across, H, 0.06], wood);
    for (const s of [-1, 1]) this.box(g, 'Side', [s * (across / 2 - 0.03), H / 2, 0], [0.06, H, depth], wood);
    this.box(g, 'Top', [0, H - 0.04, 0], [across, 0.08, depth], wood);
    this.box(g, 'Crown', [0, H + 0.08, 0.02], [across + 0.12, 0.14, depth + 0.1], wood);
    this.box(g, 'Plinth', [0, 0.05, 0], [across, 0.1, depth], wood);
    this.prim(g, 'cylinder', 'Rail', [0, H - 0.35, -depth * 0.15], [0.03, across - 0.1, 0.03], mat('#8a6a2a', { metalness: 0.8 })).setLocalEulerAngles(0, 0, 90);
    const coats = ['#1a1a22', '#5a1a1a', '#d8cdb8', '#2a3a2a', '#3a2a4a', '#6a4a2a'];
    for (let i = 0; i < 5; i++) {
      const cx = -across / 2 + 0.25 + i * (across - 0.5) / 4;
      if (Math.abs(cx) < 0.25) continue; // the hider stands in the middle
      this.box(g, 'Coat', [cx, H - 0.95, -depth * 0.15], [0.12, 1.2, 0.45], mat(coats[(i + (nursery ? 2 : 0)) % coats.length], { gloss: 0.15 }));
    }
    // Doors hinged at the front edges, left slightly ajar (the hider's view slit).
    for (const s of [-1, 1]) {
      const hinge = this.grp(g, 'DoorHinge', s * across / 2, depth / 2, s * -22);
      this.box(hinge, 'Door', [-s * across / 4, H / 2, 0.02], [across / 2 - 0.02, H - 0.1, 0.05], wood);
      this.prim(hinge, 'sphere', 'Knob', [-s * (across / 2 - 0.12), H / 2, 0.08], [0.05, 0.05, 0.05], mat('#b08a3a', { metalness: 0.9 }));
    }
    return g;
  }

  /** A three-panel folding screen (adult height) across the cover footprint. */
  buildFoldingScreen(node, h) {
    const { pos: [x, z], height: H } = h.cover;
    const { across } = this.frame(h);
    const g = this.grp(node, `Cover_${h.id}`, x, z, h.look);
    const fabric = tmat(h.id === 'nursery_screen' ? 'damask' : 'velvet', { args: h.id === 'nursery_screen' ? [] : ['#4a1a2a'], gloss: 0.2 });
    const pw = across / 3;
    for (let i = 0; i < 3; i++) {
      const p = this.grp(g, 'Panel', -across / 2 + pw * (i + 0.5), (i % 2) * 0.12, (i - 1) * 12);
      this.wbox(p, 'Fabric', [0, H / 2 + 0.05, 0], [pw - 0.04, H - 0.1, 0.04], fabric, 1, H);
      this.box(p, 'FrameTop', [0, H, 0], [pw, 0.05, 0.06], mat('#6d5320', { metalness: 0.6 }));
    }
    return g;
  }

  /** The Portrait Corridor's secret: a gilt portrait frame swung ajar from a wall recess. */
  buildAjarFrame(node, h) {
    const { pos: [x, z], height: H } = h.cover;
    const { across } = this.frame(h);
    const g = this.grp(node, `Cover_${h.id}`, x, z, h.look);
    this.box(g, 'Gilt', [0, H / 2 + 0.3, 0], [across + 0.12, H, 0.1], mat('#8a6a2a', { metalness: 0.7, gloss: 0.6 }));
    this.wbox(g, 'Canvas', [0, H / 2 + 0.3, 0.06], [across - 0.1, H - 0.14, 0.02], tmat('portrait', { args: [3] }), across - 0.1, H - 0.14);
    // The dark recess in the wall behind it.
    this.box(node, 'Recess', [x, 1.5, z + 1.0], [across, 2.6, 0.02], mat('#050404'));
    return g;
  }

  /** Inspectable clue props (paper, rope coils, a journal) within reach of hiding places. */
  buildClues() {
    this.clueProps = {};
    const onTable = new Set(['guest_list', 'floor_plan', 'curator_journal', 'master_letters']);
    for (const c of CLUES) {
      const y = onTable.has(c.id) ? 0.95 : c.id === 'gallery_plaques' ? 1.15 : 0.35;
      const e = new pc.Entity(`Clue_${c.id}`);
      e.addComponent('render', { type: 'box', material: mat('#e8dcc0', { emissive: '#8a7a50', emissiveIntensity: 0.35 }), castShadows: false });
      e.setLocalPosition(c.pos[0], y, c.pos[1]);
      e.setLocalScale(0.34, 0.03, 0.26);
      if (c.id === 'gallery_plaques') { e.setLocalScale(0.5, 0.18, 0.03); }
      this.root.addChild(e);
      if (c.effect === 'snare') {
        const coil = new pc.Entity('RopeCoil');
        coil.addComponent('render', { type: 'torus', material: mat('#7a1020'), castShadows: false });
        coil.setLocalPosition(c.pos[0] + 0.25, y - 0.02, c.pos[1] + 0.1);
        coil.setLocalScale(0.35, 0.35, 0.35);
        this.root.addChild(coil);
        e.coil = coil;
      }
      this.clueProps[c.id] = e;
    }
  }

  /** Rope snares currently visible to this phone. */
  syncSnares(list) {
    this.snareProps = this.snareProps || new Map();
    const live = new Set();
    for (const s of list || []) {
      live.add(s.id);
      let e = this.snareProps.get(s.id);
      if (!e) {
        e = new pc.Entity('Snare');
        e.addComponent('render', { type: 'torus', material: mat('#7a1020', { emissive: '#300', emissiveIntensity: 0.4 }), castShadows: false });
        e.setLocalScale(0.9, 0.3, 0.9);
        this.root.addChild(e);
        this.snareProps.set(s.id, e);
      }
      e.setLocalPosition(s.pos[0], 0.06, s.pos[1]);
    }
    for (const [id, e] of this.snareProps) if (!live.has(id)) { e.destroy(); this.snareProps.delete(id); }
  }

  // ------------------------------------------------------------------ set dressing
  // Every placement below keeps doorways (2 m gaps) and each hiding place's open side clear.
  rug(p, x, z, w, d, color = '#6e1c24') { this.wbox(p, 'Rug', [x, 0.058, z], [w, 0.012, d], tmat('rug', { args: [color], gloss: 0.1 }), w, d); }
  /** A frame for wall decor: nudged off the wall so it sits on the surface (walls are 0.3 m thick, centred on the room edge). */
  onWall(p, name, x, z, yaw, out) {
    const a = yaw * Math.PI / 180;
    return this.grp(p, name, x + Math.sin(a) * out, z + Math.cos(a) * out, yaw);
  }
  windowAt(p, x, z, yaw, w = 1.6) {
    const g = this.onWall(p, 'Window', x, z, yaw, 0.07);
    this.wbox(g, 'Glass', [0, 1.75, 0.04], [w, 2.1, 0.04], tmat('window', { emit: 0.7 }), w, 2.1);
    for (const s of [-1, 1]) this.wbox(g, 'Drape', [s * (w / 2 + 0.22), 1.6, 0.12], [0.4, 2.8, 0.12], tmat('velvet', { args: ['#5e1420'] }), 1, 2.8);
    this.box(g, 'Pelmet', [0, 3.0, 0.12], [w + 1, 0.2, 0.14], mat('#6d5320', { metalness: 0.5 }));
  }
  portraitAt(p, x, z, yaw, w = 1.3, h = 1.7, variant = 0, y = 1.75) {
    const g = this.onWall(p, 'Portrait', x, z, yaw, 0.11);
    this.box(g, 'Gilt', [0, y, 0.04], [w + 0.14, h + 0.14, 0.07], mat('#8a6a2a', { metalness: 0.7, gloss: 0.6 }));
    this.wbox(g, 'Canvas', [0, y, 0.085], [w, h, 0.02], tmat('portrait', { args: [variant] }), w, h);
  }
  bookcaseAt(p, x, z, yaw, w = 2.4, h = 2.6) {
    const g = this.grp(p, 'Bookcase', x, z, yaw);
    const fb = this.grp(g, 'BookcasePrimitive', 0, 0);
    this.box(fb, 'Case', [0, h / 2, 0.2], [w, h, 0.4], mat('#2e1a0e', { gloss: 0.5 }));
    this.wbox(fb, 'Books', [0, h / 2, 0.41], [w - 0.12, h - 0.16, 0.02], tmat('books'), 1.4, 1.3);
    // Carved cases side by side along the wall; the books are a painted panel set just in
    // front of each case's back, framed by the model's real shelf boards (2.9k triangles per
    // case instead of 11k for the modelled-books version: phones render whole rooms of these).
    const unit = h * 1.842 / 3.371, n = Math.max(1, Math.round(w / unit));
    const woods = { Wood1: '#3a2214', Wood2: '#2e1a0e', DarkWood: '#1e1008', Wood: '#3a2214', Metal: { color: '#b08a3a', gloss: 0.7 } };
    const s = h / 3.371;
    for (let i = 0; i < n; i++) {
      const ux = (i - (n - 1) / 2) * (w / n);
      this.propAt(g, 'f-bookcase', ux, 0.28, 0, { h, tints: woods, fallback: i === 0 ? fb : null });
      this.wbox(g, 'ShelfBooks', [ux, h * 0.47, 0.28 + 0.664 * s / 2 - 0.13], [1.842 * s * 0.84, h * 0.8, 0.02], tmat('books'), 1.2, 1.6);
    }
  }
  fireplaceAt(p, x, z, yaw) {
    const g = this.grp(p, 'Fireplace', x, z, yaw);
    this.box(g, 'Surround', [0, 0.85, 0.25], [2.3, 1.7, 0.5], mat('#c9c2b4', { gloss: 0.5 }));
    this.box(g, 'Opening', [0, 0.55, 0.47], [1.2, 1.0, 0.06], mat('#0a0706'));
    this.wbox(g, 'Fire', [0, 0.45, 0.51], [1.0, 0.7, 0.02], tmat('fire', { emit: 1.6 }), 1, 0.7);
    this.box(g, 'Mantel', [0, 1.75, 0.3], [2.6, 0.12, 0.65], mat('#b8b0a2'));
    const light = new pc.Entity('Firelight');
    light.addComponent('light', { type: 'omni', color: new pc.Color(1, 0.55, 0.2), intensity: 0.9, range: 5.5, castShadows: false });
    light.setLocalPosition(0, 0.7, 1.2);
    g.addChild(light);
    this.fires = (this.fires || []).concat(light);
    this.portraitAt(g, 0, 0, 0, 1.2, 1.0, 5, 2.55);
  }
  chandelierAt(p, x, z, r = 0.7) {
    const g = this.grp(p, 'Chandelier', x, z, 0, 2.7);
    const gold = mat('#b08a3a', { metalness: 0.9, gloss: 0.7 });
    // A slim candle crown (no solid ring, so it never hides a character from above).
    this.prim(g, 'sphere', 'Boss', [0, 0, 0], [0.22, 0.3, 0.22], gold);
    this.prim(g, 'cylinder', 'Chain', [0, 0.35, 0], [0.03, 0.7, 0.03], gold);
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      this.prim(g, 'sphere', 'Flame', [Math.cos(a) * r, 0.12, Math.sin(a) * r], [0.07, 0.11, 0.07], mat('#fff', { emissive: '#ffd27a', emissiveIntensity: 1.4 }));
    }
  }
  /** A small warm light at a lamp or sconce (clustered lighting keeps many of these cheap). */
  practical(p, x, y, z, range = 2.8, intensity = 0.75, glow = null) {
    const l = new pc.Entity('Practical');
    l.addComponent('light', { type: 'omni', color: new pc.Color(1, 0.72, 0.42), intensity, range, castShadows: false, falloffMode: pc.LIGHTFALLOFF_INVERSESQUARED });
    l.setLocalPosition(x, y, z);
    p.addChild(l);
    this.practicals.push({ light: l, base: intensity, glow, fail: false, t: 0 });
    return l;
  }
  lampAt(p, x, z, y = 0.75) {
    this.prim(p, 'cylinder', 'LampBase', [x, y + 0.15, z], [0.08, 0.3, 0.08], mat('#8a6a2a', { metalness: 0.7 }));
    const shade = this.prim(p, 'cone', 'Shade', [x, y + 0.42, z], [0.36, 0.3, 0.36], mat('#221', { emissive: '#ffcf8a', emissiveIntensity: 1.0 }), false);
    this.practical(p, x, y + 0.55, z, 2.8, 0.8, shade);
  }
  tableAt(p, x, z, w, d, h = 0.8, color = '#4a2c18') {
    const m = mat(color, { gloss: 0.55 });
    this.box(p, 'TableTop', [x, h, z], [w, 0.07, d], m);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.box(p, 'TableLeg', [x + sx * (w / 2 - 0.08), h / 2, z + sz * (d / 2 - 0.08)], [0.07, h, 0.07], m);
  }
  nightstandAt(p, x, z) {
    const fb = this.grp(p, 'NightstandPrimitive', x, z);
    this.box(fb, 'Nightstand', [0, 0.33, 0], [0.55, 0.66, 0.45], mat('#4a2c18', { gloss: 0.5 }));
    this.propAt(p, 'nightstand_2', x, z, 0, { h: 0.64, tints: { Wood: '#4a2c18', Metal: { color: '#b08a3a', gloss: 0.7 } }, fallback: fb });
    this.lampAt(p, x, z, 0.64);
  }
  dresserAt(p, x, z, yaw, w = 1.6) {
    const g = this.grp(p, 'Dresser', x, z, yaw);
    const fb = this.grp(g, 'DresserPrimitive', 0, 0);
    this.box(fb, 'Body', [0, 0.45, 0.25], [w, 0.9, 0.5], mat('#3e2616', { gloss: 0.55 }));
    for (let i = 0; i < 3; i++) this.box(fb, 'Drawer', [0, 0.2 + i * 0.26, 0.51], [w - 0.12, 0.2, 0.02], mat('#5a3a22'));
    this.propAt(g, 'drawer_1', 0, 0.3, 0, { w, tints: { Wood: '#3e2616', Wood_Dark: '#24140a', Wood_Light: '#6a4a2a' }, fallback: fb });
    this.lampAt(g, -w / 2 + 0.25, 0.25, w * 1.353 / 2.794);
  }
  armchairAt(p, x, z, yaw, color = '#6e1c24') {
    const g = this.grp(p, 'Armchair', x, z, yaw);
    const fb = this.grp(g, 'ArmchairPrimitive', 0, 0);
    const m = mat(color, { gloss: 0.2 });
    this.box(fb, 'Seat', [0, 0.25, 0], [0.8, 0.5, 0.8], m);
    this.box(fb, 'Back', [0, 0.7, -0.33], [0.8, 0.9, 0.16], m);
    for (const s of [-1, 1]) this.box(fb, 'Arm', [s * 0.36, 0.55, 0], [0.12, 0.3, 0.8], m);
    this.propAt(g, 'couch_small1', 0, 0, 0, { w: 1.25, tints: { Couch_Blue: { color, gloss: 0.15 }, Black: '#1a1010' }, fallback: fb });
  }
  chaiseAt(p, x, z, yaw, color = '#6e1c24') {
    const g = this.grp(p, 'Chaise', x, z, yaw);
    const fb = this.grp(g, 'ChaisePrimitive', 0, 0);
    const m = mat(color, { gloss: 0.2 });
    this.box(fb, 'Seat', [0, 0.25, 0], [1.8, 0.5, 0.7], m);
    this.box(fb, 'Roll', [-0.85, 0.55, 0], [0.2, 0.5, 0.7], m);
    this.propAt(g, 'f-sofa2', 0, 0, 0, { w: 2.1, tints: { Sofa: { color, gloss: 0.15 }, Legs: '#2a180c' }, fallback: fb });
  }
  /** A tall shaded standard lamp (glowing shade). */
  standardLampAt(p, x, z, h = 1.75) {
    this.practical(p, x, h - 0.2, z, 3.4, 0.9);
    this.propAt(p, 'light_stand1', x, z, 0, { h, tints: { LightMetal: { color: '#b08a3a', gloss: 0.7 }, White: { color: '#f3e2c0', emissive: '#ffcf8a', intensity: 0.9 } } });
  }
  plantAt(p, x, z, h = 1.0, kind = 'houseplant_7') {
    this.propAt(p, kind, x, z, 0, { h, tints: { Black: '#2a1c14', Brown: '#4a2c18' } });
  }
  benchAt(p, x, z, yaw, len = 1.4, color = '#5a1a2a') {
    const g = this.grp(p, 'Bench', x, z, yaw);
    this.box(g, 'Cushion', [0, 0.4, 0], [len, 0.14, 0.5], mat(color, { gloss: 0.2 }));
    this.box(g, 'Frame', [0, 0.2, 0], [len - 0.1, 0.3, 0.44], mat('#3a2214'));
  }
  statueAt(p, x, z, s = 1, pale = true) {
    this.box(p, 'Pedestal', [x, 0.5, z], [0.9 * s, 1, 0.9 * s], mat('#2a2a30', { gloss: 0.6 }));
    const m = mat(pale ? '#d6d0c4' : '#6a5a3a', { gloss: 0.45, metalness: pale ? 0 : 0.6 });
    this.prim(p, 'capsule', 'Figure', [x, 1.0 + 0.8 * s, z], [0.5 * s, 1.5 * s, 0.45 * s], m);
    this.prim(p, 'sphere', 'Head', [x, 1.0 + 1.65 * s, z], [0.26 * s, 0.3 * s, 0.26 * s], m);
  }
  drapedAt(p, x, z, h = 1.8, w = 0.9) {
    this.box(p, 'Drape', [x, h / 2, z], [w, h, w * 0.7], mat('#d8d2c6', { gloss: 0.1 }));
    this.prim(p, 'sphere', 'DrapeTop', [x, h, z], [w, 0.35, w * 0.7], mat('#d8d2c6', { gloss: 0.1 }));
  }
  easelAt(p, x, z, yaw, variant = 1) {
    const g = this.grp(p, 'Easel', x, z, yaw);
    const wood = mat('#6b5b43');
    for (const s of [-1, 1]) this.box(g, 'Leg', [s * 0.35, 0.9, 0], [0.06, 1.8, 0.06], wood);
    this.wbox(g, 'Canvas', [0, 1.3, 0.05], [0.9, 1.1, 0.04], tmat('portrait', { args: [variant] }), 0.9, 1.1);
  }
  crateAt(p, x, z, s = 0.9) { this.box(p, 'Crate', [x, s / 2, z], [s, s, s], mat('#7b6040')); }
  sconceAt(p, x, z, y = 2.2) {
    const glow = this.prim(p, 'sphere', 'Sconce', [x, y, z], [0.12, 0.18, 0.12], mat('#221', { emissive: '#ffc27a', emissiveIntensity: 1.1 }), false);
    this.practical(p, x, y - 0.1, z, 3.2, 0.6, glow);
  }
  pianoAt(p, x, z, yaw) {
    const g = this.grp(p, 'Piano', x, z, yaw);
    const black = mat('#0c0c0e', { gloss: 0.9 });
    this.box(g, 'Stage', [0, 0.12, 0], [3.2, 0.24, 3.0], mat('#3a2214', { gloss: 0.6 }));
    this.box(g, 'Body', [0, 0.95, 0.1], [1.5, 0.35, 1.9], black);
    this.box(g, 'Lid', [0.1, 1.45, 0.3], [1.3, 0.04, 1.6], black).setLocalEulerAngles(-25, 0, 0);
    for (const s of [-1, 1]) this.box(g, 'PianoLeg', [s * 0.6, 0.55, 0.1], [0.1, 0.6, 0.1], black);
    this.box(g, 'Keys', [0, 0.9, -0.9], [1.4, 0.06, 0.25], mat('#eee'));
  }

  dressRoom(id, node) {
    const [x0, x1, z0, z1] = ROOMS[id].rect;
    const [cx, cz] = ROOMS[id].center;
    const S = 180, N = 0, E = 270, W = 90; // yaw that faces INTO a room from its south/north/east/west wall
    if (id === 'portrait') {
      // Grand foyer + birthday party (refs 02, 08): checkered marble, olive walls, portraits,
      // chandelier, statues, the unveiled masterpiece (east wall) and the birthday buffet.
      for (let i = 0; i < 4; i++) this.portraitAt(node, x0 + 3 + i * 4, z0 + 0.15, N, 1.4, 1.9, i);
      this.box(node, 'MasterpieceFrame', [x1 - 0.25, 1.9, cz], [0.12, 2.6, 3.6], mat('#6d5320', { metalness: 0.8, gloss: 0.6 }));
      this.painting = this.wbox(node, 'Masterpiece', [x1 - 0.33, 1.9, cz], [0.04, 2.2, 3.2], tmat('portrait', { args: [4], emit: 0.25 }), 3.2, 2.2, false);
      this.paintingVeil = this.wbox(node, 'Veil', [x1 - 0.42, 1.9, cz], [0.05, 2.5, 3.5], tmat('velvet', { args: ['#5e1420'] }), 1, 2.5, false);
      this.chandelierAt(node, cx, cz, 0.9);
      this.rug(node, cx, cz, 7, 6, '#6e1c24');
      this.statueAt(node, -9, 15.3, 0.9);
      this.statueAt(node, -14.5, 15.3, 0.9);
      this.tableAt(node, -5.2, 3.2, 1.6, 0.9, 0.8, '#3a2214');
      this.lampAt(node, -5.2, 3.2, 0.84);
      this.benchAt(node, -11.75, 2.4, 0, 2.2);
      for (const zz of [5, 13]) this.sconceAt(node, x1 - 0.2, zz);
    } else if (id === 'sculpture') {
      // Stone vault (ref 12): pale statues on dark plinths, draped figures, gothic windows.
      for (const [dx, dz] of [[-3, -3], [3, 3], [3, -3], [-3, 3]]) this.statueAt(node, cx + dx, cz + dz, 1.05, (dx + dz) !== 0);
      this.windowAt(node, x0 + 0.1, 27, W, 1.4);
      this.windowAt(node, x0 + 0.1, 33.5, W, 1.4);
      this.drapedAt(node, -25.5, 36.9, 2.0, 1.0);
      this.drapedAt(node, -22.5, 23.2, 1.7, 0.8);
      this.crateAt(node, -26.8, 36.9, 0.8);
      this.easelAt(node, -21.2, 23.4, 20, 2);
      this.rug(node, cx, cz, 4.5, 4.5, '#3a2a44');
    } else if (id === 'archive') {
      // Two-level library (ref 07): stacks, wall bookcases, fireplace, reading lamps.
      for (let i = 0; i < 3; i++) {
        const sx = x0 + 3 + i * 4.5;
        this.bookcaseAt(node, sx, cz - 2.02, N, 3.0, 2.6);
        this.bookcaseAt(node, sx, cz - 1.98, S, 3.0, 2.6);
      }
      this.bookcaseAt(node, 6.5, z0 + 0.05, N, 3.2);
      this.bookcaseAt(node, 17, z0 + 0.05, N, 3.2);
      this.bookcaseAt(node, x1 - 0.05, 5, E, 3.0);
      this.fireplaceAt(node, x0 + 0.05, 9.5, W);
      this.armchairAt(node, 5.6, 7.4, 60);
      this.armchairAt(node, 5.6, 11.4, 120);
      this.windowAt(node, 12, z0 + 0.1, N, 1.6);
      this.rug(node, 14.2, 12.2, 4.2, 3.0, '#5a1a24');
      this.chandelierAt(node, cx, cz - 1);
    } else if (id === 'conservation') {
      // Portrait restoration studio (ref 13): easels, work tables, drawers, covered frames.
      this.tableAt(node, cx, cz, 3.2, 1.4, 0.9, '#5a3a22');
      this.box(node, 'Painting', [cx, 0.96, cz], [1.2, 0.03, 0.9], tmat('portrait', { args: [2] }));
      this.easelAt(node, 29, 32.5, E, 0);
      this.easelAt(node, 27.2, 35.8, 200, 3);
      this.windowAt(node, x1 - 0.1, 30.8, E, 1.4);
      this.box(node, 'PlanChest', [25.5, 0.55, z1 - 0.35], [2.2, 1.1, 0.7], mat('#5a3a22', { gloss: 0.5 }));
      this.drapedAt(node, 30.6, 36.6, 1.9, 0.8);
      this.box(node, 'Cart', [cx - 4, 0.45, cz + 3], [1.2, 0.9, 0.7], mat('#9aa3a3', { metalness: 0.7 }));
      this.rug(node, cx, cz, 5, 3.5, '#2a3a5a');
      this.chandelierAt(node, cx, cz, 0.6);
    } else if (id === 'study') {
      // Curator's study (ref 11): fireplace, portrait wall, bookcases (split for the north door),
      // leather armchairs, a glass cabinet of curiosities.
      this.bookcaseAt(node, -24.5, z1 - 0.05, S, 4.2);
      this.bookcaseAt(node, -15, z1 - 0.05, S, 4.2);
      this.fireplaceAt(node, x0 + 0.05, 50.5, W);
      this.armchairAt(node, -18.4, 46.8, 20, '#4a2a18');
      this.armchairAt(node, -16, 46.8, -20, '#4a2a18');
      for (const [zz, v] of [[44, 1], [51.8, 2]]) this.portraitAt(node, x1 - 0.05, zz, E, 1.0, 1.4, v);
      this.box(node, 'CuriosityCase', [-13.1, 1.1, 43.2], [1.2, 2.2, 0.6], mat('#9fb3c8', { opacity: 0.35, gloss: 0.9 }));
      this.rug(node, -17.4, 48.5, 5, 3.8, '#6e1c24');
    } else if (id === 'sealed') {
      // Sealed exhibition (ref 15): draped masterpiece behind stanchions, tufted bench,
      // pedestals with urns, the old display case, portraits.
      this.box(node, 'SealedCase', [cx, 0.6, cz + 2], [2.2, 1.2, 2.2], mat('#1b1b22', { gloss: 0.8 }));
      this.box(node, 'CaseGlass', [cx, 1.7, cz + 2], [2, 1, 2], mat('#9fb3c8', { opacity: 0.25, gloss: 0.9 }));
      this.wbox(node, 'DrapedMasterpiece', [0, 1.5, z1 - 0.4], [1.8, 3.0, 0.5], tmat('velvet', { args: ['#5e1420'] }), 1, 3);
      for (const sx of [-1.4, 1.4]) this.prim(node, 'cylinder', 'Stanchion', [sx, 0.45, z1 - 1.3], [0.08, 0.9, 0.08], mat('#b08a3a', { metalness: 0.9 }));
      this.box(node, 'Rope', [0, 0.85, z1 - 1.3], [2.8, 0.05, 0.05], mat('#7a1020'));
      this.benchAt(node, cx, cz - 2.4, 0, 2.2, '#5a1a2a');
      for (const [px, pz] of [[-4.3, 24.2], [4.3, 24.2]]) { this.box(node, 'UrnPlinth', [px, 0.55, pz], [0.6, 1.1, 0.6], mat('#2a2a30', { gloss: 0.6 })); this.prim(node, 'sphere', 'Urn', [px, 1.35, pz], [0.4, 0.5, 0.4], mat('#b08a3a', { metalness: 0.9 })); }
      this.portraitAt(node, x1 - 0.05, 25, E, 1.0, 1.4, 3);
      this.portraitAt(node, x0 + 0.05, 35.5, W, 1.0, 1.4, 4);
      this.rug(node, cx, cz, 4, 7, '#3a1a24');
      this.chandelierAt(node, cx, cz - 3, 0.6);
    } else if (id === 'mirrors') {
      // Hall of mirrors / ballroom (ref 09): gilded mirrors, piano stage, parquet, chandelier.
      for (const mx of [14.5, 17.4, 23.5, 26.4]) this.wbox(node, 'Mirror', [mx, 1.7, z0 + 0.12], [2, 2.6, 0.06], tmat('mirror', { gloss: 0.9, metalness: 0.4 }), 2, 2.6);
      for (const mx of [15.2, 24.4]) this.wbox(node, 'MirrorN', [mx, 1.7, z1 - 0.12], [2, 2.6, 0.06], tmat('mirror', { gloss: 0.9, metalness: 0.4 }), 2, 2.6);
      this.pianoAt(node, 24.2, 50.2, 200);
      this.chandelierAt(node, cx, cz, 1.0);
      this.rug(node, cx - 2, cz - 1, 3.5, 3.5, '#6e1c24');
    } else if (id === 'corridor') {
      // Portrait Corridor (ref 03): the collection. Frames along both walls (not across
      // doorways), a long runner, benches, sconces. The plaques clue is by the ajar frame.
      const doorXs = { north: [-17, 0, 17], south: [-20, 20] };
      let v = 0;
      for (let px = -24.5; px <= 24; px += 2.5) {
        const curated = GALLERY.some(g => Math.abs(px - g.wallX) < 2.6);
        if (!curated && doorXs.north.every(dx => Math.abs(px - dx) > 1.6) && Math.abs(px + 8) > 1.4 && px < 23) this.portraitAt(node, px, z1 - 0.05, S, 1.2, 1.6, v++);
        if (doorXs.south.every(dx => Math.abs(px - dx) > 1.6) && px < 23) {
          if (Math.round(px / 2.5) % 3 === 0) this.windowAt(node, px, z0 + 0.1, N, 1.2);
          else this.portraitAt(node, px, z0 + 0.05, N, 1.0, 1.3, v++);
        }
      }
      this.buildGallery(node, z1);
      this.wbox(node, 'Runner', [0, 0.06, 60], [48, 0.012, 1.8], tmat('rug', { args: ['#5a1618'] }), 4, 1.8);
      for (const bx of [-12, 8, -24]) this.benchAt(node, bx, 61.2, 180, 1.2);
      for (let sx = -22; sx <= 22; sx += 11) this.sconceAt(node, sx, z1 - 0.15, 2.3);
      // The corridor is 52 m long: light it along its length, not just at the centre.
      for (const lx of [-17, 17]) {
        const l = new pc.Entity('CorridorLight');
        l.addComponent('light', { type: 'omni', color: new pc.Color(1, 0.72, 0.45), intensity: 1.1, range: 11, castShadows: false });
        l.setLocalPosition(lx, 2.6, cz);
        node.addChild(l);
      }
    } else if (id === 'master_bedroom') {
      // Master bedroom (ref 04): four-poster, fireplace, wardrobe, windows, chaise, dresser.
      this.fireplaceAt(node, x0 + 0.05, 74.5, W);
      this.windowAt(node, -21.5, z1 - 0.1, S, 1.6);
      this.windowAt(node, -11, z1 - 0.1, S, 1.6);
      this.chaiseAt(node, -21.8, 78.6, 180, '#6e1c24');
      this.nightstandAt(node, -17.8, 77.9);
      this.nightstandAt(node, -14.2, 77.9);
      this.dresserAt(node, -11.4, z0 + 0.05, N, 1.8);
      this.armchairAt(node, -23.4, 72.6, 100, '#6e1c24');
      this.rug(node, -16, 74.5, 4.6, 5, '#6e1c24');
      this.portraitAt(node, x0 + 0.05, 69.5, W, 0.9, 1.2, 5);
    } else if (id === 'guest_bedroom') {
      // Guest bedroom (ref 05): blue damask, raised brass bed, window seat, wardrobe.
      this.windowAt(node, 3.6, z1 - 0.1, S, 1.8);
      this.box(node, 'WindowSeat', [3.6, 0.25, 77.5], [2.2, 0.5, 0.6], mat('#2c3a5c', { gloss: 0.2 }));
      this.nightstandAt(node, -3.75, 77.1);
      this.dresserAt(node, x0 + 0.05, 69.4, W, 1.4);
      this.portraitAt(node, x0 + 0.05, 74, W, 1.3, 0.9, 1);
      this.rug(node, -1.2, 72, 5, 4.2, '#2c3a5c');
      this.standardLampAt(node, 4.8, 67.2);
    } else if (id === 'spare_bedroom') {
      // Spare bedroom / old nursery (ref 06): canopied single bed, folding screen, closet,
      // rocking chair, toy shelf, trunk, window.
      this.windowAt(node, x0 + 0.1, 70, W, 1.4);
      this.box(node, 'Trunk', [11.4, 0.3, 77.3], [1.1, 0.6, 0.6], mat('#5a3a22'));
      this.box(node, 'ToyShelf', [15.8, 1.0, z1 - 0.2], [2.4, 2.0, 0.35], mat('#4a3a2a'));
      for (let i = 0; i < 5; i++) this.box(node, 'Toy', [14.9 + i * 0.45, 1.35, z1 - 0.3], [0.2, 0.2 + (i % 2) * 0.15, 0.2], mat(['#b8433a', '#3d8b5f', '#d9a441', '#4f7cac', '#9b7fd1'][i]));
      this.chaiseAt(node, 17.8, 77.0, 180, '#233054');
      this.armchairAt(node, 10.4, 67.6, 45, '#4a3a2a');
      this.rug(node, 17, 71.5, 5, 4, '#233054');
      this.portraitAt(node, x1 - 0.05, 75.5, E, 0.8, 1.0, 0);
    }
  }

  /**
   * The front of the house (spec §6 / §12): a rain-darkened forecourt and driveway, a stone
   * façade with warm windows over the foyer and archive, a columned entrance with steps and
   * heavy double doors, lanterns and a moon. Seen in the arrival shot; it is not a playable
   * space and not an exit (the Garden Gate is the only way out).
   */
  buildExterior() {
    // Only shown in the lobby and the opening: during play the tall front would block the
    // overhead camera near the foyer's south wall (nobody goes outside anyway).
    const root = this.exterior = this.grp(this.root, 'Exterior', 0, 0);
    const face = ROOMS.portrait.rect[2] - WALL_T / 2;          // outer surface of the south wall
    const ex = ROOMS.portrait.center[0];                        // the arrival entrance (foyer)
    this.frontEntrance = { x: ex, z: face };
    const wet = tmat('stone', { tint: '#5a5f68', gloss: 0.82 });
    this.wbox(root, 'Forecourt', [0, 0.0, face - 9], [64, 0.1, 18], wet, 3);
    this.wbox(root, 'Drive', [0, 0.03, face - 4.4], [64, 0.06, 4.2], tmat('tile', { tint: '#3e424a', gloss: 0.88 }), 2.4);
    this.box(root, 'Lawn', [0, 0.04, face - 12.6], [64, 0.08, 6], mat('#142018', { gloss: 0.15 }));
    for (let x = -30; x <= 30; x += 4) this.box(root, 'Hedge', [x, 0.5, face - 9.9], [3.4, 1.0, 0.9], mat('#1b2e1f', { gloss: 0.1 }));
    // Two-storey stone front with a string course, cornice and rows of lit windows.
    const fx0 = ROOMS.portrait.rect[0] - 0.4, fx1 = ROOMS.archive.rect[1] + 0.4, H = 7.4;
    this.wbox(root, 'Facade', [(fx0 + fx1) / 2, H / 2, face - 0.09], [fx1 - fx0, H, 0.18], tmat('stonewall', { tint: '#c4bdb0' }), 3, 3);
    this.box(root, 'StringCourse', [(fx0 + fx1) / 2, 3.55, face - 0.25], [fx1 - fx0, 0.18, 0.3], mat('#9c968a'));
    this.box(root, 'Cornice', [(fx0 + fx1) / 2, H + 0.1, face - 0.3], [fx1 - fx0 + 0.6, 0.35, 0.6], mat('#a8a296'));
    const warm = mat('#3a2410', { emissive: '#ffc66a', emissiveIntensity: 0.85 });
    const sash = mat('#1a1614');
    for (let x = fx0 + 2.2; x < fx1 - 1.5; x += 3.3) {
      if (Math.abs(x - ex) < 3.6) continue;
      for (const [y, h] of [[1.95, 2.3], [5.4, 1.9]]) {
        this.box(root, 'LitWindow', [x, y, face - 0.19], [1.25, h, 0.04], warm);
        this.box(root, 'Mullion', [x, y, face - 0.22], [0.06, h, 0.03], sash);
        this.box(root, 'Transom', [x, y + h * 0.18, face - 0.22], [1.25, 0.06, 0.03], sash);
        this.box(root, 'Sill', [x, y - h / 2 - 0.06, face - 0.3], [1.5, 0.1, 0.25], mat('#a8a296'));
      }
    }
    // Entrance: steps, marble columns, entablature, heavy doors, lanterns.
    for (let i = 0; i < 3; i++) {
      const d = 1.6 - i * 0.45;
      this.box(root, 'Step', [ex, 0.09 + i * 0.16, face - d / 2], [6.4 - i * 0.5, 0.18 + i * 0.32, d], mat('#b8b2a6', { gloss: 0.5 }));
    }
    for (const s of [-1, 1]) this.propAt(root, 'column_round2', ex + s * 2.45, face - 1.05, 0, { h: 4.6, y: 0.5, tints: { Marble: { color: '#ddd6c8', gloss: 0.55 } } });
    this.box(root, 'Entablature', [ex, 5.35, face - 0.95], [6.6, 0.55, 2.0], mat('#b8b2a6'));
    this.propAt(root, 'door_double', ex, face - 0.2, 180, { h: 3.3, y: 0.5, tints: { Wood: { color: '#2a160c', gloss: 0.45 }, Gold: { color: '#b08a3a', gloss: 0.75 } } });
    const glass = mat('#221a10', { emissive: '#ffcf7a', emissiveIntensity: 1.3 });
    for (const s of [-1, 1]) {
      this.box(root, 'LanternBracket', [ex + s * 1.6, 2.9, face - 0.35], [0.08, 0.5, 0.35], sash);
      this.box(root, 'Lantern', [ex + s * 1.6, 2.6, face - 0.5], [0.28, 0.42, 0.28], glass);
      this.practical(root, ex + s * 1.6, 2.4, face - 1.0, 5, 0.9);
    }
    // Lamp posts along the drive.
    for (let x = -26; x <= 26; x += 13) {
      this.prim(root, 'cylinder', 'LampPost', [x, 1.6, face - 7.2], [0.12, 3.2, 0.12], sash);
      this.box(root, 'PostLantern', [x, 3.35, face - 7.2], [0.32, 0.45, 0.32], glass);
      this.practical(root, x, 3.0, face - 7.2, 7, 0.8);
    }
    // A low moon over the lawn (not fogged out), and restrained ground mist.
    const moon = new pc.StandardMaterial();
    moon.emissive = new pc.Color(0.8, 0.86, 0.98); moon.useFog = false; moon.useLighting = false; moon.update();
    this.prim(root, 'sphere', 'Moon', [26, 26, face - 60], [5, 5, 5], moon, false);
    const mist = new pc.StandardMaterial();
    mist.diffuse = new pc.Color(0, 0, 0); mist.emissive = new pc.Color(0.16, 0.18, 0.24); mist.opacity = 0.18;
    mist.blendType = pc.BLEND_NORMAL; mist.depthWrite = false; mist.update();
    for (const [x, z, w] of [[-14, face - 12, 22], [12, face - 13, 26], [0, face - 16, 40]]) this.prim(root, 'plane', 'Mist', [x, 0.35, z], [w, 1, 4], mist, false);
    // The limousine (a stretched CC0 sedan, placeholder), parked until the arrival drives it in.
    this.limo = this.grp(root, 'Limousine', ex + 3, face - 4.4, 270);
    this.limoParked = [ex + 3, face - 4.4];
    // Headlights, tail lights and a light that travels with the car, so it reads at night.
    const head = mat('#fff', { emissive: '#fff4d6', emissiveIntensity: 2 }), tail = mat('#300', { emissive: '#ff2a1a', emissiveIntensity: 1.4 });
    for (const s of [-1, 1]) {
      this.box(this.limo, 'Headlight', [s * 0.62, 0.62, 3.25], [0.3, 0.14, 0.05], head, false);
      this.box(this.limo, 'TailLight', [s * 0.66, 0.72, -3.25], [0.24, 0.12, 0.05], tail, false);
    }
    const beam = new pc.Entity('LimoLight');
    beam.addComponent('light', { type: 'omni', color: new pc.Color(1, 0.93, 0.8), intensity: 1.6, range: 9, castShadows: false });
    beam.setLocalPosition(0, 2.2, 1.2);
    this.limo.addChild(beam);
    new Promise((resolve, reject) => {
      const asset = new pc.Asset('limo', 'container', { url: 'models/vehicles/sedan.glb' });
      asset.on('load', a => resolve(a.resource)); asset.on('error', reject);
      this.app.assets.add(asset); this.app.assets.load(asset);
    }).then(res => {
      const car = res.instantiateRenderEntity({ castShadows: false });
      car.setLocalScale(1.35, 1.3, 1.35);
      const body = car.findByName('body');
      if (body) body.setLocalScale(1, 1, 2.3);
      for (const w of car.children) if (/wheel/.test(w.name)) { const p = w.getLocalPosition(); w.setLocalPosition(p.x, p.y, p.z * 2.1); }
      for (const r of car.findComponents('render')) for (const mi of r.meshInstances) {
        const m = mi.material.clone(); m.diffuse = new pc.Color(0.13, 0.13, 0.15); m.gloss = 0.85; m.metalness = 0.4; m.update(); mi.material = m;
      }
      this.limo.addChild(car);
    }).catch(err => console.warn('limousine model unavailable', err));
  }

  /** Drive the limousine along the forecourt: t from 0 (entering) to 1 (stopped at the steps). */
  setLimo(t) {
    const [px, pz] = this.limoParked;
    const e = 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
    this.limo.setLocalPosition(px + 34 * (1 - e), 0, pz);
  }

  /**
   * View Gallery (spec §22): three curated sections on the corridor's north wall, each with
   * three works in aged gilt frames, an engraved plaque under each and a picture light.
   * `galleryFocus` gives the camera the world position of every work, by station.
   */
  buildGallery(node, wallZ) {
    this.galleryFocus = {};
    const frames = ['#8a6a2a', '#6d5320', '#a07c30'];
    for (const st of GALLERY) {
      const g = this.grp(node, `Gallery_${st.id}`, st.wallX, wallZ - WALL_T / 2 - 0.005, 180);
      this.galleryFocus[st.id] = [];
      st.portraits.forEach((p, i) => {
        const x = (i - 1) * 1.45, w = 1.15, h = p.art === 'curator' ? 1.55 : 1.3, y = 1.8;
        const frameMat = mat(frames[(i + st.portraits.length) % 3], { metalness: 0.75, gloss: p.art === 'empty' ? 0.75 : 0.55 });
        this.box(g, 'GalleryFrame', [x, y, 0.04], [w + 0.2, h + 0.2, 0.08], frameMat);
        if (p.art === 'empty') {
          // The reserved frame: carved like tonight's gift, nothing inside yet.
          for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) this.prim(g, 'sphere', 'Rosette', [x + dx * (w / 2 + 0.06), y + dy * (h / 2 + 0.06), 0.1], [0.12, 0.12, 0.06], frameMat);
        }
        this.wbox(g, 'GalleryWork', [x, y, 0.09], [w, h, 0.02], tmat('gallery', { args: [p.art], gloss: p.art === 'curator' || p.art === 'twelve' ? 0.45 : 0.2 }), w, h);
        this.wbox(g, 'Plaque', [x, 0.98, 0.06], [0.62, 0.14, 0.02], tmat('plaque', { args: [p.title], metalness: 0.6, gloss: 0.6 }), 0.62, 0.14);
        const world = g.getWorldTransform().transformPoint(new pc.Vec3(x, y, 0.1));
        this.galleryFocus[st.id].push([world.x, world.y, world.z]);
      });
      this.box(g, 'PictureLight', [0, 2.72, 0.14], [3.9, 0.05, 0.08], mat('#b08a3a', { metalness: 0.9, emissive: '#ffdca0', emissiveIntensity: 0.5 }));
      this.practical(g, 0, 2.5, 0.8, 3.6, 0.9);
    }
  }

  /**
   * Potted plants in room corners, only where nothing needs the space: never within 2 m of a
   * doorway, 1.6 m of a hiding place or clue, and not in the stone vault or sealed room.
   */
  cornerPlants(id, node) {
    if (['sculpture', 'sealed', 'corridor'].includes(id)) return;
    const [x0, x1, z0, z1] = ROOMS[id].rect;
    const doors = [...CORRIDORS.flatMap(c => c.doors.map(d => d.pos)), EXIT_CORRIDOR.door.pos];
    const busy = [...ROOMS[id].hides.flatMap(h => [h.cover.pos, frontOf(h)]), ...CLUES.filter(c => c.room === id).map(c => c.pos)];
    const far = (p, list, r) => list.every(q => Math.hypot(p[0] - q[0], p[1] - q[1]) > r);
    const kinds = ['houseplant_7', 'houseplant_1', 'houseplant_3'];
    let k = 0;
    for (const p of [[x0 + 0.7, z0 + 0.7], [x1 - 0.7, z0 + 0.7], [x0 + 0.7, z1 - 0.7], [x1 - 0.7, z1 - 0.7]]) {
      if (!far(p, doors, 2) || !far(p, busy, 1.6)) continue;
      const kind = kinds[k++ % kinds.length];
      this.plantAt(node, p[0], p[1], kind === 'houseplant_3' ? 1.2 : 1.05, kind);
    }
  }

  /** Called per frame with every visible actor position to swing doors open near travellers. */
  updateDoors(dt, positions) {
    for (const d of this.doors) {
      const near = !d.locked || this.exitOpen ? positions.some(([x, z]) => Math.hypot(x - d.pos[0], z - d.pos[1]) < 1.8) : false;
      d.target = near ? 95 : 0;
      d.angle += (d.target - d.angle) * Math.min(1, dt * 6);
      d.hinge.setLocalEulerAngles(0, d.alongX ? -d.angle : d.angle, 0);
    }
  }

  setExitOpen(open) {
    this.exitOpen = open;
    this.exitLight.light.color = open ? new pc.Color(0.2, 1, 0.35) : new pc.Color(1, 0.1, 0.1);
    this.exitSign.render.meshInstances[0].material = open ? mat('#030', { emissive: '#2aff5a', emissiveIntensity: 1.2 }) : mat('#300', { emissive: '#ff2a2a', emissiveIntensity: 1.2 });
  }

  /**
   * After the attack some lamps flicker and fail (spec: selected lamps dim or fail, but
   * windows and the remaining practicals still reveal routes). The choice is fixed per lamp
   * so every phone sees the same house. restore() brings them all back for a new match.
   */
  failLamps() {
    this.practicals.forEach((p, i) => { if ((i * 7919) % 100 < 35) { p.fail = true; p.t = 0.4 + ((i * 31) % 17) / 10; } });
  }
  restoreLamps() {
    for (const p of this.practicals) { p.fail = false; p.light.light.intensity = p.base; p.light.enabled = true; if (p.glow) p.glow.enabled = true; }
  }
  updateLights(dt) {
    this.pulseMarkers(dt);
    for (const p of this.practicals) {
      if (!p.fail || !p.light.enabled) continue;
      p.t -= dt;
      const on = p.t > 0 && Math.sin(performance.now() / 45 + p.t * 13) > 0.1;
      p.light.light.intensity = on ? p.base * (0.4 + Math.random() * 0.6) : 0;
      if (p.glow) p.glow.enabled = on;
      if (p.t <= 0) { p.light.enabled = false; if (p.glow) p.glow.enabled = false; }
    }
  }

  /**
   * Mask everything outside one room (for the hider's room view): four black slabs just above
   * the wall tops with a hole over the room. null removes the mask.
   */
  setRoomMask(rect) {
    if (!this.roomMask) {
      const m = new pc.StandardMaterial();
      m.diffuse = new pc.Color(0, 0, 0); m.emissive = new pc.Color(0.01, 0.008, 0.012); m.useLighting = false; m.useFog = false; m.update();
      this.roomMask = [0, 1, 2, 3].map(i => { const e = new pc.Entity(`RoomMask${i}`); e.addComponent('render', { type: 'box', material: m, castShadows: false }); e.enabled = false; this.root.addChild(e); return e; });
      this.roomMaskKey = null;
    }
    const key = rect ? rect.join(',') : null;
    if (key === this.roomMaskKey) return;
    this.roomMaskKey = key;
    for (const e of this.roomMask) e.enabled = !!rect;
    if (!rect) return;
    const [x0, x1, z0, z1] = rect, g = 0.3, B = 200, y = WALL_H + 0.25;
    const put = (e, cx, cz, sx, sz) => { e.setLocalPosition(cx, y, cz); e.setLocalScale(sx, 0.05, sz); };
    put(this.roomMask[0], x0 - g - B / 2, (z0 + z1) / 2, B, B * 2);            // west
    put(this.roomMask[1], x1 + g + B / 2, (z0 + z1) / 2, B, B * 2);            // east
    put(this.roomMask[2], (x0 + x1) / 2, z0 - g - B / 2, x1 - x0 + 2 * g, B);  // south
    put(this.roomMask[3], (x0 + x1) / 2, z1 + g + B / 2, x1 - x0 + 2 * g, B);  // north
  }

  setLockdown(on) {
    for (const l of Object.values(this.roomLights)) l.light.color = on ? new pc.Color(1, 0.25, 0.2) : new pc.Color(1, 0.78, 0.55);
  }

  /** Highlight only the hiding place this player is heading for. */
  showHideMarker(spotId) {
    for (const covers of Object.values(this.hideCovers)) for (const c of covers) c.marker.enabled = c.id === spotId;
  }
}

/** A room's baked lightmap: an sRGB JPEG decoded to linear by the GPU (see hg_room.py). */
async function loadLightmap(device, url) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  await img.decode();
  const tex = new pc.Texture(device, {
    name: url, format: pc.PIXELFORMAT_SRGBA8, mipmaps: true, anisotropy: 4,
    minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR, magFilter: pc.FILTER_LINEAR,
    addressU: pc.ADDRESS_CLAMP_TO_EDGE, addressV: pc.ADDRESS_CLAMP_TO_EDGE,
  });
  tex.setSource(img);
  return tex;
}

/** A flat rectangular outline (width w) around [x0, x1] x [z0, z1], facing up: one draw call. */
function frameMesh(device, x0, x1, z0, z1, w) {
  const P = [], N = [], I = [];
  const quad = (ax, az, bx, bz) => {
    const b = P.length / 3;
    P.push(ax, 0, az, bx, 0, az, bx, 0, bz, ax, 0, bz);
    N.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
    I.push(b, b + 2, b + 1, b, b + 3, b + 2);
  };
  quad(x0 - w, z0 - w, x1 + w, z0);        // south
  quad(x0 - w, z1, x1 + w, z1 + w);        // north
  quad(x0 - w, z0, x0, z1);                // west
  quad(x1, z0, x1 + w, z1);                // east
  const mesh = new pc.Mesh(device);
  mesh.setPositions(P); mesh.setNormals(N); mesh.setIndices(I);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  return mesh;
}

// ------------------------------------------------------------------ walls
/** All walkable rectangles: rooms, corridors and the exit stub. */
export function walkRects() {
  const rects = ROOM_IDS.map(id => ({ r: ROOMS[id].rect, kind: 'room', id }));
  for (const c of CORRIDORS) for (const r of c.rects) rects.push({ r, kind: 'corridor' });
  rects.push({ r: EXIT_CORRIDOR.rect, kind: 'exit' });
  return rects;
}

/** Subtract covered intervals from [a, b]. */
function subtract(a, b, cuts) {
  let parts = [[a, b]];
  for (const [c0, c1] of cuts) {
    parts = parts.flatMap(([p0, p1]) => {
      if (c1 <= p0 + EPS || c0 >= p1 - EPS) return [[p0, p1]];
      const out = [];
      if (c0 > p0 + EPS) out.push([p0, c0]);
      if (c1 < p1 - EPS) out.push([c1, p1]);
      return out;
    });
  }
  return parts.filter(([p0, p1]) => p1 - p0 > 0.05);
}

/**
 * Wall segments = rectangle edges minus the parts where another walkable rectangle
 * continues across the edge (doorways). The same rects drive the walk paths, so
 * nothing ever walks through a wall.
 */
export function computeWalls() {
  const rects = walkRects();
  const walls = [];
  rects.forEach(({ r: [x0, x1, z0, z1], kind }, i) => {
    const others = rects.filter((_, j) => j !== i).map(o => o.r);
    for (const [z, side] of [[z0, -1], [z1, 1]]) {
      if (kind === 'exit' && side < 0) continue;   // the Garden Gate end opens onto the courtyard
      const cuts = others.filter(([, , oz0, oz1]) => side > 0 ? (oz0 <= z + EPS && oz1 > z + EPS) : (oz1 >= z - EPS && oz0 < z - EPS))
        .map(([ox0, ox1]) => [ox0, ox1]);
      for (const [a, b] of subtract(x0, x1, cuts)) walls.push({ axis: 'x', z, a, b });
    }
    for (const [x, side] of [[x0, -1], [x1, 1]]) {
      const cuts = others.filter(([ox0, ox1]) => side > 0 ? (ox0 <= x + EPS && ox1 > x + EPS) : (ox1 >= x - EPS && ox0 < x - EPS))
        .map(([, , oz0, oz1]) => [oz0, oz1]);
      for (const [a, b] of subtract(z0, z1, cuts)) walls.push({ axis: 'z', x, a, b });
    }
  });
  return walls;
}
