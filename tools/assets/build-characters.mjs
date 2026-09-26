// Offline character pipeline (run from the repo root):
//   node tools/assets/build-characters.mjs
//
// Sources (CC0, downloaded by tools/assets/fetch-sources.mjs into assets-src/, not committed):
//   - Quaternius "Ultimate Modular Women/Men" packs: rigged, clothed characters that share one
//     62-bone skeleton and 24 animations (walk, run, idle, interact, hit, death, ...).
//   - Quaternius "Universal Animation Library" (free edition): crouch, kneel, pick-up, formal
//     walk, talking idle, ... on a different (Rigify) skeleton. These clips are RETARGETED
//     here onto the Quaternius skeleton: per bone, the world-space rotation change from the
//     source T-pose is applied to the target bind (T-)pose; the hips follow the source hips
//     scaled by leg length; the IK feet are placed at the end of the retargeted shins.
//
// Outputs (committed, loaded by the game):
//   client/public/models/characters/parts/<pack>-<outfit>-<part>.glb   one skinned mesh each
//   client/public/models/characters/anims.glb      skeleton + all animation clips
//   client/public/models/characters/manifest.json  outfits, material names, clip list
import { NodeIO } from '@gltf-transform/core';
import { prune, dedup, quantize } from '@gltf-transform/functions';
import { mat4, quat, vec3 } from 'gl-matrix';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { sample, duration, worldPose, byName } from './pose.mjs';

const OUT = 'client/public/models/characters';
mkdirSync(OUT, { recursive: true });
const io = new NodeIO();

// Every source character; each is split into head / body / legs / feet parts that can be
// mixed per guest (all share one skeleton). Props (pistols, swords, backpacks) are dropped.
const SOURCES = Object.fromEntries(['women', 'men'].flatMap(p =>
  readdirSync(`assets-src/quaternius/${p}`).filter(f => f.endsWith('.gltf'))
    .map(f => [`${p[0]}-${f.replace('.gltf', '').replace(/_/g, '').toLowerCase()}`, `assets-src/quaternius/${p}/${f}`])));
const PART = n => /head/i.test(n) ? 'head' : /body/i.test(n) ? 'body' : /legs|pants/i.test(n) ? 'legs' : /feet/i.test(n) ? 'feet' : null;
// Native Quaternius clips kept (renamed for the game).
const NATIVE = { Idle: 'idle', Idle_Neutral: 'idle_alert', Walk: 'walk', Run: 'run', Interact: 'interact',
  HitRecieve: 'hit', HitRecieve_2: 'hit2', Death: 'collapse', Wave: 'wave', Punch_Right: 'lunge' };
// Universal Animation Library clips retargeted onto the Quaternius skeleton.
// A value may be [outName, fromSec, toSec] to cut a sub-range (e.g. the held part of a kneel).
const RETARGET = { Crouch_Idle_Loop: 'crouch_idle', Crouch_Fwd_Loop: 'crouch_walk', Fixing_Kneeling: ['kneel_look', 0.8, 4.1],
  PickUp_Table: 'pickup', Walk_Formal_Loop: 'walk_formal', Idle_Talking_Loop: 'talk', Sprint_Loop: 'sprint',
  Hit_Chest: 'recoil', Push_Loop: 'grab', Idle_Loop: 'idle_breathe', Dance_Loop: 'dance', Interact: 'inspect' };

// Source (Rigify DEF-*) -> target (Quaternius) bone names.
const MAP = { 'DEF-hips': 'Hips', 'DEF-spine.001': 'Abdomen', 'DEF-spine.002': 'Torso', 'DEF-spine.003': 'Chest',
  'DEF-neck': 'Neck', 'DEF-head': 'Head', 'DEF-thigh.L': 'UpperLeg.L', 'DEF-shin.L': 'LowerLeg.L', 'DEF-foot.L': 'Foot.L',
  'DEF-thigh.R': 'UpperLeg.R', 'DEF-shin.R': 'LowerLeg.R', 'DEF-foot.R': 'Foot.R' };
for (const s of ['L', 'R']) {
  Object.assign(MAP, { [`DEF-shoulder.${s}`]: `Shoulder.${s}`, [`DEF-upper_arm.${s}`]: `UpperArm.${s}`,
    [`DEF-forearm.${s}`]: `LowerArm.${s}`, [`DEF-hand.${s}`]: `Wrist.${s}` });
  for (const f of ['index', 'middle', 'ring', 'pinky']) for (const k of [1, 2, 3])
    MAP[`DEF-f_${f}.0${k}.${s}`] = `${f[0].toUpperCase()}${f.slice(1)}${k}.${s}`;
  for (const k of [1, 2, 3]) MAP[`DEF-thumb.0${k}.${s}`] = `Thumb${k}.${s}`;
}

function dropAnimations(doc) {
  for (const a of doc.getRoot().listAnimations()) {
    for (const smp of a.listSamplers()) { smp.getInput()?.dispose(); smp.getOutput()?.dispose(); }
    a.dispose();
  }
}

// ---------- character parts ----------
const manifest = { parts: {}, clips: [], source: 'Quaternius (CC0): Ultimate Modular Women/Men, Universal Animation Library' };
mkdirSync(`${OUT}/parts`, { recursive: true });
for (const [key, file] of Object.entries(SOURCES)) {
  const probe = await io.read(file);
  for (const node of probe.getRoot().listNodes().filter(n => n.getMesh())) {
    const part = PART(node.getName());
    if (!part) continue;
    const doc = await io.read(file);
    dropAnimations(doc);
    for (const n of doc.getRoot().listNodes()) if (n.getMesh() && n.getName() !== node.getName()) { n.getMesh().dispose(); n.dispose(); }
    for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) p.setAttribute('COLOR_0', null);
    await doc.transform(dedup(), prune(), quantize({ quantizeNormal: 8, quantizePosition: 14, quantizeTexcoord: 12 }));
    const mats = doc.getRoot().listMaterials().map(m => ({ name: m.getName(), color: m.getBaseColorFactor().slice(0, 3).map(x => +x.toFixed(3)) }));
    let tris = 0;
    for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
    const id = `${key}-${part}`;
    await io.write(`${OUT}/parts/${id}.glb`, doc);
    manifest.parts[id] = { source: file.replace('assets-src/', ''), materials: mats, triangles: tris };
  }
}
console.log(`exported ${Object.keys(manifest.parts).length} parts`);

// ---------- animations ----------
const base = await io.read(SOURCES['w-formal']);             // skeleton + native clips
const src = await io.read('assets-src/ual/AnimationLibrary_Godot_Standard.gltf');
const root = base.getRoot();
for (const m of root.listNodes()) if (m.getMesh()) m.dispose();
for (const s of root.listSkins()) s.dispose();
for (const a of root.listAnimations()) {
  if (NATIVE[a.getName()]) a.setName(NATIVE[a.getName()]);
  else a.dispose();
}

// Target bind pose (world) from the inverse bind matrices of an untouched copy.
const bindDoc = await io.read(SOURCES['w-formal']);
const skin = bindDoc.getRoot().listSkins()[0];
const ibm = skin.getInverseBindMatrices().getArray();
const bindW = new Map();
skin.listJoints().forEach((j, i) => {
  const m = mat4.invert(mat4.create(), ibm.slice(i * 16, i * 16 + 16));
  bindW.set(j.getName(), { r: mat4.getRotation(quat.create(), m), p: mat4.getTranslation(vec3.create(), m) });
});
const tNodes = root.listNodes();
const tByName = n => tNodes.find(x => x.getName() === n);
const parentOf = new Map();
for (const n of tNodes) for (const c of n.listChildren()) parentOf.set(c, n);
const joints = tNodes.filter(n => bindW.has(n.getName()));
const order = [];                                            // parents before children
const visit = n => { if (bindW.has(n.getName())) order.push(n); n.listChildren().forEach(visit); };
root.listScenes()[0].listChildren().forEach(visit);

// Source reference pose: the library's T-pose clip.
const srcAnims = src.getRoot().listAnimations();
const tposeW = worldPose(src, sample(srcAnims.find(a => a.getName() === 'A_TPose'), 0));
const sByName = n => byName(src, n);
const legRatio = bindW.get('Hips').p[1] / tposeW.get(sByName('DEF-hips')).p[1];
const inv = q => quat.invert(quat.create(), q);
const mul = (a, b) => quat.multiply(quat.create(), a, b);
// Where the IK foot sits relative to the shin, in the shin's bind frame.
const footOff = {};
for (const s of ['L', 'R']) {
  const sh = bindW.get(`LowerLeg.${s}`), f = bindW.get(`Foot.${s}`);
  const d = vec3.sub(vec3.create(), f.p, sh.p);
  footOff[s] = vec3.transformQuat(vec3.create(), d, inv(sh.r));
}

const FPS = 30;
for (const [srcName, spec] of Object.entries(RETARGET)) {
  const [outName, from = 0, to = null] = Array.isArray(spec) ? spec : [spec];
  const anim = srcAnims.find(a => a.getName() === srcName);
  if (!anim) throw new Error(`missing clip ${srcName}`);
  const dur = (to ?? duration(anim)) - from, frames = Math.max(2, Math.round(dur * FPS) + 1);
  const times = [], tracks = new Map(joints.map(j => [j, { t: [], r: [] }]));
  for (let f = 0; f < frames; f++) {
    const time = Math.min(dur, f / FPS);
    times.push(time);
    const W = worldPose(src, sample(anim, from + time));
    const G = new Map();                                     // target world pose this frame
    for (const n of order) {
      const name = n.getName(), bind = bindW.get(name);
      const parent = parentOf.get(n), pg = parent && G.get(parent);
      const pr = pg ? pg.r : quat.create(), pp = pg ? pg.p : vec3.create();
      const srcName2 = Object.keys(MAP).find(k => MAP[k] === name);
      let r, p;
      if (srcName2) {
        const sn = sByName(srcName2);
        const delta = mul(W.get(sn).r, inv(tposeW.get(sn).r));
        r = mul(delta, bind.r);
      } else {
        // Unmapped bone: keep its bind-pose rotation relative to its parent.
        const pb = parent && bindW.get(parent.getName());
        r = pb ? mul(pr, mul(inv(pb.r), bind.r)) : quat.clone(bind.r);
      }
      if (name === 'Hips') {
        const sh = sByName('DEF-hips');
        const d = vec3.sub(vec3.create(), W.get(sh).p, tposeW.get(sh).p);
        p = vec3.scaleAndAdd(vec3.create(), bind.p, d, legRatio);
      } else if (/^Foot\.[LR]$/.test(name)) {
        const s = name.slice(-1), shin = G.get(tByName(`LowerLeg.${s}`));
        p = vec3.add(vec3.create(), shin.p, vec3.transformQuat(vec3.create(), footOff[s], shin.r));
      } else {
        // Rigid offset from the parent, as in the bind pose.
        const pb = parent && bindW.get(parent.getName());
        if (pb) {
          const off = vec3.transformQuat(vec3.create(), vec3.sub(vec3.create(), bind.p, pb.p), inv(pb.r));
          p = vec3.add(vec3.create(), pp, vec3.transformQuat(vec3.create(), off, pr));
        } else p = vec3.clone(bind.p);
      }
      G.set(n, { r, p });
      // Local transform for the track.
      const lr = mul(inv(pr), r);
      const lp = vec3.transformQuat(vec3.create(), vec3.sub(vec3.create(), p, pp), inv(pr));
      const tr = tracks.get(n);
      tr.r.push(...lr); tr.t.push(...lp);
    }
  }
  const out = base.createAnimation(outName);
  const buf = root.listBuffers()[0];
  const input = base.createAccessor().setType('SCALAR').setArray(new Float32Array(times)).setBuffer(buf);
  for (const [n, tr] of tracks) {
    for (const [path, arr, type] of [['rotation', tr.r, 'VEC4'], ['translation', tr.t, 'VEC3']]) {
      const outAcc = base.createAccessor().setType(type).setArray(new Float32Array(arr)).setBuffer(buf);
      const s = base.createAnimationSampler().setInput(input).setOutput(outAcc).setInterpolation('LINEAR');
      out.addSampler(s).addChannel(base.createAnimationChannel().setTargetNode(n).setTargetPath(path).setSampler(s));
    }
  }
  console.log(`retargeted ${srcName} -> ${outName} (${dur.toFixed(2)} s, ${frames} frames)`);
}

// Natural ground speed of the locomotion clips (m/s), so playback can match travel speed
// without foot sliding: the planted foot travels backwards at the body's speed.
function footSpeed(doc, animName) {
  const a = doc.getRoot().listAnimations().find(x => x.getName() === animName);
  const d = duration(a), n = 60;
  const zs = [];
  for (let i = 0; i < n; i++) {
    const W = worldPose(doc, sample(a, (i / n) * d));
    zs.push(W.get(tByName('Foot.L')).p[2]);
  }
  return +(((Math.max(...zs) - Math.min(...zs)) * 2) / d).toFixed(3);
}
await base.transform(prune({ keepLeaves: true, keepAttributes: true }));
for (const a of root.listAnimations()) {
  const d = duration(a);
  manifest.clips.push({ name: a.getName(), duration: +d.toFixed(3) });
}
for (const c of manifest.clips) if (['walk', 'run', 'walk_formal', 'sprint', 'crouch_walk'].includes(c.name)) c.groundSpeed = footSpeed(base, c.name);
await io.write(`${OUT}/anims.glb`, base);
writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2));
console.log(manifest.clips.map(c => `${c.name}${c.groundSpeed ? ` (${c.groundSpeed} m/s)` : ''}`).join(', '));
