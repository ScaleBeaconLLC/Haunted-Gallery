// Builds the seven-room mansion-museum blockout in PlayCanvas from the shared layout:
// floors, collision-consistent walls with doorway gaps, swinging doors, the locked
// service exit, 14 hiding covers and simple set dressing. This is a performant
// mobile BLOCKOUT (primitives), not final art.
import * as pc from 'playcanvas';
import { CORRIDORS, EXIT_CORRIDOR, EXIT_POINT, ROOMS, ROOM_IDS, CAMERA_START, CLUES } from '@game/data.ts';

const WALL_H = 3.2;
const WALL_T = 0.3;
const EPS = 0.01;

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

function box(app, parent, name, [x, y, z], [sx, sy, sz], material, batchGroupId) {
  const e = new pc.Entity(name);
  e.addComponent('render', { type: 'box', material, castShadows: false, receiveShadows: false, batchGroupId });
  e.setLocalPosition(x, y, z);
  e.setLocalScale(sx, sy, sz);
  parent.addChild(e);
  return e;
}
function prim(app, parent, type, name, pos, scale, material, batchGroupId) {
  const e = new pc.Entity(name);
  e.addComponent('render', { type, material, castShadows: false, receiveShadows: false, batchGroupId });
  e.setLocalPosition(...pos);
  e.setLocalScale(...scale);
  parent.addChild(e);
  return e;
}

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
 * continues across the edge (doorways). The same rects drive the client walk paths,
 * so nothing ever walks through a wall.
 */
export function computeWalls() {
  const rects = walkRects();
  const walls = [];
  rects.forEach(({ r: [x0, x1, z0, z1] }, i) => {
    const others = rects.filter((_, j) => j !== i).map(o => o.r);
    // Horizontal edges (constant z) — openings where another rect straddles/abuts across the line.
    for (const [z, side] of [[z0, -1], [z1, 1]]) {
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

export class World {
  constructor(app) {
    this.app = app;
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
    this.build();
  }

  build() {
    const { app, root } = this;
    const g = this.staticGroup;
    app.scene.ambientLight = new pc.Color(0.16, 0.14, 0.17);
    app.scene.fog.type = pc.FOG_LINEAR;
    app.scene.fog.color = new pc.Color(0.03, 0.02, 0.04);
    // Fog starts beyond the orbit camera's distance so it only hides far rooms.
    app.scene.fog.start = 24;
    app.scene.fog.end = 60;

    // Outside ground so gaps never show the void.
    box(app, root, 'Grounds', [0, -0.06, 28], [90, 0.1, 70], mat('#0b0a0d'), g);

    for (const id of ROOM_IDS) {
      const room = ROOMS[id];
      const [x0, x1, z0, z1] = room.rect;
      const node = new pc.Entity(`Room_${id}`);
      root.addChild(node);
      box(app, node, 'Floor', [(x0 + x1) / 2, 0, (z0 + z1) / 2], [x1 - x0, 0.1, z1 - z0], mat(room.floorColor), g);
      // Floor rug stripe for readability from above.
      box(app, node, 'Rug', [(x0 + x1) / 2, 0.06, (z0 + z1) / 2], [(x1 - x0) * 0.45, 0.02, (z1 - z0) * 0.45], mat('#4a1d24', { gloss: 0.1 }), g);
      const light = new pc.Entity(`Light_${id}`);
      light.addComponent('light', { type: 'omni', color: new pc.Color(1, 0.78, 0.55), intensity: 1.6, range: 14, castShadows: false });
      light.setLocalPosition(room.center[0], 2.8, room.center[1]);
      node.addChild(light);
      this.roomLights[id] = light;
      this.dressRoom(id, node);
      this.hideCovers[id] = room.hides.map(h => this.buildCover(node, h));
    }
    this.buildClues();
    for (const c of CORRIDORS) for (const [x0, x1, z0, z1] of c.rects) {
      box(app, root, 'CorridorFloor', [(x0 + x1) / 2, 0.005, (z0 + z1) / 2], [x1 - x0, 0.1, z1 - z0], mat('#231c1a'), g);
    }
    {
      const [x0, x1, z0, z1] = EXIT_CORRIDOR.rect;
      box(app, root, 'ExitFloor', [(x0 + x1) / 2, 0.005, (z0 + z1) / 2], [x1 - x0, 0.1, z1 - z0], mat('#1d1d1d'), g);
    }

    // Walls with doorway gaps.
    const wallMat = mat('#4b3a3f');
    for (const w of computeWalls()) {
      const len = w.b - w.a + WALL_T;
      const mid = (w.a + w.b) / 2;
      if (w.axis === 'x') box(app, root, 'Wall', [mid, WALL_H / 2, w.z], [len, WALL_H, WALL_T], this.wallMatAt(mid, w.z) ?? wallMat, g);
      else box(app, root, 'Wall', [w.x, WALL_H / 2, mid], [WALL_T, WALL_H, len], this.wallMatAt(w.x, mid) ?? wallMat, g);
    }

    // Doors: one leaf at each corridor/room junction. Hinged, they swing when someone passes.
    for (const c of CORRIDORS) for (const d of c.doors) this.buildDoor(d.pos, d.axis, false);
    this.exitDoor = this.buildDoor(EXIT_CORRIDOR.door.pos, 'z', true);
    const sign = box(app, root, 'ExitSign', [EXIT_POINT[0], 2.7, 22.2], [1.4, 0.35, 0.05], mat('#300', { emissive: '#ff2a2a', emissiveIntensity: 1.2 }));
    this.exitSign = sign;
    const exitLight = new pc.Entity('ExitLight');
    exitLight.addComponent('light', { type: 'omni', color: new pc.Color(1, 0.1, 0.1), intensity: 1.2, range: 6, castShadows: false });
    exitLight.setLocalPosition(0, 2.4, 23);
    root.addChild(exitLight);
    this.exitLight = exitLight;

    // The single antique camera prop (position driven by game state).
    const cam = new pc.Entity('AntiqueCamera');
    prim(app, cam, 'box', 'Body', [0, 0, 0], [0.34, 0.24, 0.2], mat('#2b2622', { gloss: 0.6, metalness: 0.4 }));
    prim(app, cam, 'cylinder', 'Lens', [0, 0, 0.14], [0.14, 0.12, 0.14], mat('#9a8f7c', { gloss: 0.8, metalness: 0.8 })).setLocalEulerAngles(90, 0, 0);
    prim(app, cam, 'box', 'FlashBulb', [0.1, 0.17, 0], [0.1, 0.1, 0.1], mat('#ddd', { emissive: '#fff6d8', emissiveIntensity: 0.4 }));
    cam.setLocalPosition(CAMERA_START.pos[0], 0.15, CAMERA_START.pos[1]);
    root.addChild(cam);
    this.cameraProp = cam;
    this.cameraGlow = new pc.Entity('CameraGlow');
    this.cameraGlow.addComponent('light', { type: 'omni', color: new pc.Color(1, 0.9, 0.6), intensity: 0.8, range: 2.5, castShadows: false });
    this.cameraGlow.setLocalPosition(0, 0.5, 0);
    cam.addChild(this.cameraGlow);
  }

  wallMatAt(x, z) {
    for (const id of ROOM_IDS) {
      const [x0, x1, z0, z1] = ROOMS[id].rect;
      if (x >= x0 - 0.2 && x <= x1 + 0.2 && z >= z0 - 0.2 && z <= z1 + 0.2) return mat(ROOMS[id].wallColor);
    }
    return null;
  }

  buildDoor([x, z], axis, locked) {
    const hinge = new pc.Entity('DoorHinge');
    // axis 'z' = passage along z, so the door lies along x.
    const alongX = axis === 'z';
    hinge.setLocalPosition(alongX ? x - 1 : x, 0, alongX ? z : z - 1);
    const leaf = new pc.Entity('DoorLeaf');
    leaf.addComponent('render', { type: 'box', material: locked ? mat('#3a3a3a', { metalness: 0.7, gloss: 0.5 }) : mat('#5a3b22', { gloss: 0.35 }), castShadows: false });
    leaf.setLocalScale(alongX ? 2 : 0.1, 2.6, alongX ? 0.1 : 2);
    leaf.setLocalPosition(alongX ? 1 : 0, 1.3, alongX ? 0 : 1);
    hinge.addChild(leaf);
    // Frame posts.
    const frameMat = mat('#2a1d14');
    for (const s of [-1, 1]) {
      box(this.app, this.root, 'DoorPost', [alongX ? x + s * 1.08 : x, 1.5, alongX ? z : z + s * 1.08], [alongX ? 0.16 : 0.4, 3, alongX ? 0.4 : 0.16], frameMat, this.staticGroup);
    }
    this.root.addChild(hinge);
    const door = { hinge, pos: [x, z], alongX, angle: 0, target: 0, locked };
    this.doors.push(door);
    return door;
  }

  buildCover(node, h) {
    const { pos: [x, z], size: [w, d], height, kind } = h.cover;
    if (kind === 'table' || kind === 'desk' || kind === 'crates') return this.buildUnderCover(node, h);
    const colors = { curtain: '#5e1420', panel: '#3b2a20', plinth: '#8d8a82', screen: '#4d4034', shelf: '#4a3322', cabinet: '#5f6a6a', rack: '#6b5b43', bookcase: '#3d2616', crates: '#6d5536', mirror: '#aab4c0' };
    const m = kind === 'mirror' ? mat(colors.mirror, { metalness: 0.9, gloss: 0.9 }) : mat(colors[kind] ?? '#444');
    const e = box(this.app, node, `Cover_${h.id}`, [x, height / 2, z], [w, height, d], m, this.staticGroup);
    if (kind === 'plinth') prim(this.app, node, 'sphere', 'Bust', [x, height + 0.35, z], [0.6, 0.7, 0.6], mat('#bdb8ad'), this.staticGroup);
    if (kind === 'crates') box(this.app, node, 'Crate2', [x + 0.2, height + 0.4, z + 0.3], [0.9, 0.8, 0.9], mat('#7b6040'), this.staticGroup);
    // A faint floor marker so players can find the hiding place they chose.
    const marker = box(this.app, node, `HideMarker_${h.id}`, [h.pos[0], 0.07, h.pos[1]], [0.8, 0.02, 0.8], mat('#111', { emissive: '#8a6d2a', emissiveIntensity: 0.25 }));
    marker.enabled = false;
    return { entity: e, marker, id: h.id };
  }

  /**
   * Covers you get *under*: a tabletop on legs with drapery on every side except the
   * one the hider looks out of (h.look), or a tunnel of crates. Real geometry, so the
   * first-person view sees the underside, the floor and whatever is beyond the opening.
   */
  buildUnderCover(node, h) {
    const g = this.staticGroup;
    const { pos: [x, z], size: [w, d], height, kind } = h.cover;
    const wood = kind === 'crates' ? mat('#6d5536') : mat(kind === 'desk' ? '#4a2c18' : '#5a3b22', { gloss: 0.45 });
    const cloth = mat(kind === 'desk' ? '#3a1f2a' : '#5e1420', { gloss: 0.15 });
    const top = box(this.app, node, `Cover_${h.id}`, [x, height, z], [w, 0.08, d], wood, g);
    const lookRad = h.look * Math.PI / 180;
    const lx = Math.sin(lookRad), lz = Math.cos(lookRad);
    if (kind === 'crates') {
      // Crates stacked along the two long sides and the back; the open end faces h.look.
      for (const s of [-1, 1]) {
        const alongX = w > d;
        box(this.app, node, 'CrateSide', alongX ? [x, height / 2, z + s * (d / 2 - 0.2)] : [x + s * (w / 2 - 0.2), height / 2, z],
          alongX ? [w, height, 0.4] : [0.4, height, d], wood, g);
      }
      box(this.app, node, 'CrateTop', [x, height + 0.35, z], [w * 0.8, 0.6, d * 0.7], mat('#7b6040'), g);
    } else {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        box(this.app, node, 'Leg', [x + sx * (w / 2 - 0.08), height / 2, z + sz * (d / 2 - 0.08)], [0.08, height, 0.08], wood, g);
      }
      // Drapery skirts on the sides that face away from the hider's view.
      const sides = [[1, 0, w], [-1, 0, w], [0, 1, d], [0, -1, d]];
      for (const [nx, nz] of sides) {
        if (nx * lx + nz * lz > 0.5) continue; // leave the viewing side open
        const cx = x + nx * w / 2, cz = z + nz * d / 2;
        const len = nx ? d : w;
        box(this.app, node, 'Drape', [cx, height / 2 + 0.04, cz], nx ? [0.04, height - 0.08, len] : [len, height - 0.08, 0.04], cloth, g);
      }
    }
    const marker = box(this.app, node, `HideMarker_${h.id}`, [h.pos[0] + lx * 0.9, 0.07, h.pos[1] + lz * 0.9], [0.8, 0.02, 0.8], mat('#111', { emissive: '#8a6d2a', emissiveIntensity: 0.25 }));
    marker.enabled = false;
    return { entity: top, marker, id: h.id };
  }

  /** Inspectable clue props (paper, rope coils, a journal) within reach of hiding places. */
  buildClues() {
    this.clueProps = {};
    for (const c of CLUES) {
      const onTable = ['guest_list', 'floor_plan', 'curator_journal'].includes(c.id);
      const y = onTable ? 0.95 : 0.35;
      const e = new pc.Entity(`Clue_${c.id}`);
      e.addComponent('render', { type: 'box', material: mat('#e8dcc0', { emissive: '#8a7a50', emissiveIntensity: 0.35 }), castShadows: false });
      e.setLocalPosition(c.pos[0], y, c.pos[1]);
      e.setLocalScale(0.34, 0.03, 0.26);
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

  dressRoom(id, node) {
    const { app } = this;
    const g = this.staticGroup;
    const [x0, x1, z0, z1] = ROOMS[id].rect;
    const [cx, cz] = ROOMS[id].center;
    if (id === 'portrait') {
      // Portraits along the south wall and the unveiled masterpiece on the west wall.
      for (let i = 0; i < 4; i++) {
        box(app, node, 'Portrait', [x0 + 3 + i * 4, 1.9, z0 + 0.2], [1.6, 2, 0.08], mat('#2a1a10', { emissive: ['#6b4a2b', '#4a3a5a', '#5a2a2a', '#3a4a3a'][i], emissiveIntensity: 0.35 }), g);
      }
      box(app, node, 'MasterpieceFrame', [x1 - 0.25, 1.9, cz], [0.12, 2.6, 3.6], mat('#6d5320', { metalness: 0.8, gloss: 0.6 }), g);
      this.painting = box(app, node, 'Masterpiece', [x1 - 0.33, 1.9, cz], [0.04, 2.2, 3.2], mat('#1a0f0a', { emissive: '#7a2a1a', emissiveIntensity: 0.5 }));
      this.paintingVeil = box(app, node, 'Veil', [x1 - 0.42, 1.9, cz], [0.05, 2.5, 3.5], mat('#5e1420'));
    } else if (id === 'sculpture') {
      for (const [dx, dz] of [[-3, -3], [3, 3], [3, -3], [-3, 3]]) {
        prim(app, node, 'cylinder', 'Pedestal', [cx + dx, 0.5, cz + dz], [0.9, 1, 0.9], mat('#6e6b64'), g);
        prim(app, node, 'capsule', 'Statue', [cx + dx, 1.8, cz + dz], [0.6, 1.6, 0.6], mat('#c9c4b8', { gloss: 0.4 }), g);
      }
    } else if (id === 'archive') {
      for (let i = 0; i < 3; i++) box(app, node, 'Stack', [x0 + 3 + i * 4.5, 1.3, cz - 2], [3, 2.6, 0.6], mat('#3b2616'), g);
    } else if (id === 'conservation') {
      box(app, node, 'LabTable', [cx, 0.5, cz], [3.2, 1, 1.4], mat('#7f8a8a', { metalness: 0.6, gloss: 0.5 }), g);
      box(app, node, 'Easel', [cx + 4, 1.2, cz - 3], [0.2, 2.4, 1.6], mat('#6b5b43'), g);
      box(app, node, 'Cart', [cx - 4, 0.45, cz + 3], [1.2, 0.9, 0.7], mat('#9aa3a3', { metalness: 0.7 }), g);
    } else if (id === 'study') {
      box(app, node, 'Bookcases', [cx, 1.4, z1 - 0.5], [8, 2.8, 0.6], mat('#3d2616'), g);
      box(app, node, 'Fireplace', [x0 + 0.5, 1, cz + 2.5], [0.6, 2, 2.4], mat('#2a2220', { emissive: '#7a2e0a', emissiveIntensity: 0.4 }), g);
    } else if (id === 'sealed') {
      box(app, node, 'SealedCase', [cx, 0.6, cz + 2], [2.2, 1.2, 2.2], mat('#1b1b22', { gloss: 0.8 }), g);
      box(app, node, 'CaseGlass', [cx, 1.7, cz + 2], [2, 1, 2], mat('#9fb3c8', { opacity: 0.25, gloss: 0.9 }));
      box(app, node, 'Rope', [cx, 0.9, cz - 3.5], [6, 0.06, 0.06], mat('#7a1020'), g);
    } else if (id === 'mirrors') {
      for (let i = 0; i < 5; i++) box(app, node, 'Mirror', [x0 + 2.5 + i * 3, 1.7, z0 + 0.2], [2, 2.6, 0.06], mat('#b8c2cc', { metalness: 1, gloss: 0.95 }), g);
      for (let i = 0; i < 3; i++) box(app, node, 'MirrorN', [x0 + 3 + i * 4.5, 1.7, z1 - 0.2], [2, 2.6, 0.06], mat('#b8c2cc', { metalness: 1, gloss: 0.95 }), g);
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
    const m = this.exitLight.light;
    m.color = open ? new pc.Color(0.2, 1, 0.35) : new pc.Color(1, 0.1, 0.1);
    this.exitSign.render.material = open ? mat('#030', { emissive: '#2aff5a', emissiveIntensity: 1.2 }) : mat('#300', { emissive: '#ff2a2a', emissiveIntensity: 1.2 });
  }

  setLockdown(on) {
    for (const l of Object.values(this.roomLights)) {
      l.light.color = on ? new pc.Color(1, 0.25, 0.2) : new pc.Color(1, 0.78, 0.55);
    }
  }

  /** Highlight only the hiding place this player is heading for. */
  showHideMarker(spotId) {
    for (const covers of Object.values(this.hideCovers)) for (const c of covers) c.marker.enabled = c.id === spotId;
  }
}
