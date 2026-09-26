// Development-only character lab (not in the production build).
//   /lab.html?mode=parts&kind=head&sex=w       every head (or body/legs/feet) of one pack
//   /lab.html?mode=strip&clips=a,b&look=w-formal   filmstrip: each row one clip at 5 phases
//   /lab.html?mode=cast                          the whole cast as configured in cast-looks.js
import * as pc from 'playcanvas';
import { loadAnims, loadSkeleton, loadPart, Character } from './characters.js';
import { LOOKS, lookParts } from './cast-looks.js';

const q = new URLSearchParams(location.search);
const app = new pc.Application(document.getElementById('c'), { graphicsDeviceOptions: { antialias: true, preserveDrawingBuffer: true } });
app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW); app.setCanvasResolution(pc.RESOLUTION_AUTO);
app.scene.ambientLight = new pc.Color(0.45, 0.45, 0.5);
const light = new pc.Entity(); light.addComponent('light', { type: 'directional', intensity: 1.4 }); light.setEulerAngles(45, 30, 0); app.root.addChild(light);
const floor = new pc.Entity(); floor.addComponent('render', { type: 'plane' }); floor.setLocalScale(60, 1, 60); app.root.addChild(floor);
const cam = new pc.Entity(); cam.addComponent('camera', { clearColor: new pc.Color(0.12, 0.12, 0.14), fov: 35 }); app.root.addChild(cam);
app.start();
const clips = await loadAnims(app);
const skeleton = await loadSkeleton(app);
const manifest = await (await fetch('/models/characters/manifest.json')).json();
const label = [];
const mode = q.get('mode') || 'parts';
const KINDS = ['head', 'body', 'legs', 'feet'];
const build = async (ids, tints) => new Character(skeleton, await Promise.all(ids.map(async (id, i) => ({ kind: KINDS[i], container: await loadPart(app, id) }))), clips, { tints });

if (mode === 'parts') {
  const sex = q.get('sex') || 'w', kind = q.get('kind') || 'head';
  const base = sex === 'w' ? 'w-formal' : 'm-suit';
  const ids = Object.keys(manifest.parts).filter(id => id.startsWith(`${sex}-`) && id.endsWith(`-${kind}`));
  for (const [i, id] of ids.entries()) {
    const parts = ['head', 'body', 'legs', 'feet'].map(k => k === kind ? id : `${base}-${k}`);
    const c = await build(parts);
    c.entity.setLocalPosition((i - (ids.length - 1) / 2) * 0.9, 0, 0);
    app.root.addChild(c.entity); c.play('idle', 0);
    label.push(`${i + 1}: ${id}  [${manifest.parts[id].materials.map(m => m.name).join(',')}]`);
  }
  const zoom = kind === 'head' ? [1.5, 7.5] : [0.9, 11];
  cam.setLocalPosition(0, zoom[0] + 0.1, zoom[1]); cam.lookAt(0, zoom[0], 0);
} else if (mode === 'strip') {
  const list = (q.get('clips') || 'walk').split(',');
  const look = q.get('look') || 'w-formal';
  for (const [row, n] of list.entries()) {
    for (let k = 0; k < 5; k++) {
      const c = await build(['head', 'body', 'legs', 'feet'].map(p => `${look}-${p}`));
      c.entity.setLocalPosition((k - 2) * 1.5, 0, -row * 2.4);
      c.entity.setLocalEulerAngles(0, Number(q.get('yaw') || 90), 0);
      app.root.addChild(c.entity); c.play(n, 0);
      c.speed = 0;
      const dur = clips.get(n).duration;
      setTimeout(() => { c.entity.anim.baseLayer.activeStateCurrentTime = dur * k / 5; }, 300);
    }
    label.push(`row ${row + 1}: ${n}`);
  }
  cam.setLocalPosition(0, 1.6 + list.length * 1.1, 7); cam.lookAt(0, 0.7, -list.length * 1.0);
} else if (mode === 'cast') {
  const ids = (q.get('ids') || Object.keys(LOOKS).join(',')).split(',');
  for (const [i, id] of ids.entries()) {
    const { parts, tints, scale, hide } = lookParts(id);
    const c = new Character(skeleton, await Promise.all(parts.map(async p => ({ kind: p.kind, container: await loadPart(app, p.id) }))), clips, { tints, scale, hide });
    c.entity.setLocalPosition((i - (ids.length - 1) / 2) * 0.85, 0, 0);
    app.root.addChild(c.entity); c.play(q.get('clip') || 'idle', 0);
    label.push(`${id}: ${parts.map(p => p.id).join(' ')}`);
  }
  const d = Number(q.get('dist') || 14);
  cam.setLocalPosition(0, 1.3, d); cam.lookAt(0, 0.95, 0);
}
document.getElementById('l').textContent = label.join('\n');
setTimeout(() => { window.__labReady = true; }, Number(q.get('t') || 1.5) * 1000);
// Lean test: /lab.html?mode=lean&ab=25&ch=30&nk=-25 — kneel_look plus procedural lean, side view.
if (mode === 'lean') {
  const c = await build(['head', 'body', 'legs', 'feet'].map(p => `m-casual2-${p}`));
  c.entity.setLocalScale(1.12, 1.12, 1.12);
  c.entity.setLocalEulerAngles(0, 90, 0);
  app.root.addChild(c.entity); c.play('kneel_look', 0);
  c.entity.setLocalPosition(0, -Number(q.get('drop') || 0), 0);
  const [ab, ch, nk, hd] = ['ab', 'ch', 'nk', 'hd'].map(k => Number(q.get(k) || 0));
  app.on('update', () => {
    c.bones.Abdomen.rotateLocal(ab, 0, 0); c.bones.Chest.rotateLocal(ch, 0, 0); c.bones.Neck.rotateLocal(nk, 0, 0); c.bones.Head.rotateLocal(hd, 0, 0);
    window.__headY = c.bones.Head.getPosition().y;
  });
  // A bed rail at 0.62 m for reference, 0.6 m in front of him.
  const rail = new pc.Entity(); rail.addComponent('render', { type: 'box' }); rail.setLocalScale(0.08, 0.08, 2); rail.setLocalPosition(0.9, 0.62, 0); app.root.addChild(rail);
  if (q.get('view') === 'under') { cam.setLocalPosition(2.0, 0.3, 0); cam.lookAt(0, 0.6, 0); }
  else { cam.setLocalPosition(0, 0.9, 4.5); cam.lookAt(0, 0.6, 0); }
}
// Props lineup: /lab.html?mode=props&filter=bed|closet — each prop at its native scale.
if (mode === 'props') {
  const pm = await (await fetch('/models/props/manifest.json')).json();
  const re = new RegExp(q.get('filter') || '.', 'i');
  const names = Object.keys(pm.props).filter(n => re.test(n));
  let x = 0;
  for (const n of names) {
    const c = await new Promise(res => { const a = new pc.Asset(n, 'container', { url: `/models/props/${n}.glb` }); a.on('load', () => res(a.resource)); app.assets.add(a); app.assets.load(a); });
    const e = c.instantiateRenderEntity();
    const w = pm.props[n].size[0];
    e.setLocalPosition(x + w / 2 - pm.props[n].min[0] - w / 2, -pm.props[n].min[1], 0);
    app.root.addChild(e);
    label.push(`${n}: ${pm.props[n].size.join(' x ')}`);
    x += w + 0.6;
  }
  cam.setLocalPosition(x / 2, 3.2, Math.max(5, x * 0.55)); cam.lookAt(x / 2, 1, 0);
  app.scene.ambientLight = new pc.Color(0.8, 0.8, 0.85);
  floor.enabled = q.get('floor') !== 'off';
  if (q.get('cam')) { const [cx, cy, cz, tx, ty, tz] = q.get('cam').split(',').map(Number); cam.setLocalPosition(cx, cy, cz); cam.lookAt(tx, ty, tz); }
  document.getElementById('l').textContent = label.join('\n');
}
