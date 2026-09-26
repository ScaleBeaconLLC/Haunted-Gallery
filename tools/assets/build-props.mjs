// Furniture / architecture props (CC0, Quaternius "Ultimate House Interior" and "Ultimate
// Furniture" packs). The packs ship OBJ + MTL; this downloads the chosen models into
// assets-src/props/ (gitignored) and converts each to a GLB with flat-colour PBR materials.
//   node tools/assets/build-props.mjs            (run from the repo root)
// Output: client/public/models/props/<name>.glb + manifest.json (bounds, source, licence).
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize, weld } from '@gltf-transform/functions';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const PACKS = {
  interior: '1SNK9PwPi8xqqxmpU5xEZeiQjB26C1oX6',   // quaternius.com/packs/ultimatehomeinterior.html
  furniture: '1n85oUi0RN5ZUXEIMKA-AnBsPErVXWcma',  // quaternius.com/packs/ultimatefurniture.html
};
const WANT = {
  interior: ['Bed_King', 'Bed_Single', 'Bookshelf', 'Fireplace', 'Chair_1', 'Chair_2', 'Chair_3', 'Chair_4',
    'Couch_Medium1', 'Couch_Small1', 'Couch_Large1', 'Curtains_Double', 'Drawer_1', 'Drawer_2', 'Drawer_3', 'Drawer_4', 'Drawer_5',
    'NightStand_1', 'NightStand_2', 'NightStand_3', 'Light_Chandelier', 'Light_Floor1', 'Light_Floor2', 'Light_Floor3', 'Light_Desk',
    'Light_Stand1', 'Light_Stand2', 'Table_RoundLarge', 'Table_RoundSmall', 'Houseplant_1', 'Houseplant_3', 'Houseplant_5', 'Houseplant_7',
    'Column_Round1', 'Column_Round2', 'Column_SquareBig', 'Door_Double', 'Window_Large1', 'Window_Large2', 'Carpet_1', 'Carpet_2', 'Shelf_Large', 'Stool'],
  furniture: ['BedDouble', 'BedTwin', 'Bookcase', 'Bookcase_Books', 'Closet', 'ShortCloset', 'Desk', 'Sofa', 'Sofa2', 'Table', 'Table2', 'Chair', 'NightStand'],
};

async function list(id) {
  const html = await (await fetch(`https://drive.google.com/embeddedfolderview?id=${id}`)).text();
  const out = [];
  const re = /id="entry-([A-Za-z0-9_-]+)"[\s\S]*?href="([^"]+)"[\s\S]*?flip-entry-title">([^<]+)/g;
  let m;
  while ((m = re.exec(html))) out.push({ id: m[1], folder: m[2].includes('/folders/'), title: m[3] });
  return out;
}
async function download(id, path) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`);
    if (res.ok) { writeFileSync(path, Buffer.from(await res.arrayBuffer())); return; }
    if (attempt >= 5) throw new Error(`${path}: HTTP ${res.status}`);
    await new Promise(r => setTimeout(r, 1500 * attempt));   // Drive sometimes answers 500 briefly
  }
}

// ---- download (skipped when already present) ----
for (const [pack, root] of Object.entries(PACKS)) {
  const dir = `assets-src/props/${pack}`;
  mkdirSync(dir, { recursive: true });
  const top = await list(root);
  const lic = top.find(e => /license/i.test(e.title));
  if (lic && !existsSync(`${dir}/License.txt`)) await download(lic.id, `${dir}/License.txt`);
  const objDir = top.find(e => e.title === 'OBJ');
  const files = await list(objDir.id);
  for (const name of WANT[pack]) for (const ext of ['obj', 'mtl']) {
    const f = files.find(e => e.title === `${name}.${ext}`);
    if (!f) { console.warn(`missing ${pack}/${name}.${ext}`); continue; }
    if (!existsSync(`${dir}/${f.title}`)) await download(f.id, `${dir}/${f.title}`);
  }
}

// ---- OBJ + MTL -> GLB ----
function parseMtl(text) {
  const mats = {};
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const [k, ...r] = line.trim().split(/\s+/);
    if (k === 'newmtl') mats[cur = r.join(' ')] = { color: [0.8, 0.8, 0.8], emissive: [0, 0, 0] };
    else if (k === 'Kd' && cur) mats[cur].color = r.slice(0, 3).map(Number);
    else if (k === 'Ke' && cur) mats[cur].emissive = r.slice(0, 3).map(Number);
    else if (k === 'd' && cur) mats[cur].alpha = Number(r[0]);
  }
  return mats;
}
function parseObj(text) {
  const v = [], vn = [], groups = new Map();
  let mtl = 'default';
  for (const line of text.split(/\r?\n/)) {
    const [k, ...r] = line.trim().split(/\s+/);
    if (k === 'v') v.push(r.slice(0, 3).map(Number));
    else if (k === 'vn') vn.push(r.map(Number));
    else if (k === 'usemtl') mtl = r.join(' ');
    else if (k === 'f') {
      const idx = r.map(t => { const [a, , c] = t.split('/'); return [Number(a) - 1, c ? Number(c) - 1 : -1]; });
      if (!groups.has(mtl)) groups.set(mtl, []);
      for (let i = 1; i < idx.length - 1; i++) groups.get(mtl).push(idx[0], idx[i], idx[i + 1]);
    }
  }
  return { v, vn, groups };
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const OUT = 'client/public/models/props';
mkdirSync(OUT, { recursive: true });
const manifest = { source: 'Quaternius (CC0 1.0): Ultimate House Interior Pack, Ultimate Furniture Pack', props: {} };
for (const [pack, names] of Object.entries(WANT)) {
  for (const name of names) {
    const objPath = `assets-src/props/${pack}/${name}.obj`;
    if (!existsSync(objPath)) continue;
    const { v, vn, groups } = parseObj(readFileSync(objPath, 'utf8'));
    const mats = existsSync(`assets-src/props/${pack}/${name}.mtl`) ? parseMtl(readFileSync(`assets-src/props/${pack}/${name}.mtl`, 'utf8')) : {};
    const doc = new Document();
    const buf = doc.createBuffer();
    const mesh = doc.createMesh(name);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const [mname, tri] of groups) {
      const pos = new Float32Array(tri.length * 3), nor = new Float32Array(tri.length * 3);
      for (let i = 0; i < tri.length; i += 3) {
        const P = [0, 1, 2].map(k => v[tri[i + k][0]]);
        // Face normal as a fallback when the OBJ has none.
        const e1 = P[1].map((x, j) => x - P[0][j]), e2 = P[2].map((x, j) => x - P[0][j]);
        let fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const l = Math.hypot(...fn) || 1; fn = fn.map(x => x / l);
        // Winding is inconsistent in some of these models, so materials are double-sided
        // (lit on both faces) and each face uses a normal that matches its winding.
        const n0 = tri[i][1] >= 0 && vn[tri[i][1]];
        const agrees = n0 && fn[0] * n0[0] + fn[1] * n0[1] + fn[2] * n0[2] >= 0;
        for (let kk = 0; kk < 3; kk++) {
          const k = kk;
          const [pi, ni] = tri[i + k];
          pos.set(v[pi], (i + kk) * 3);
          nor.set(agrees && ni >= 0 && vn[ni] ? vn[ni] : fn, (i + kk) * 3);
          for (let j = 0; j < 3; j++) { min[j] = Math.min(min[j], v[pi][j]); max[j] = Math.max(max[j], v[pi][j]); }
        }
      }
      const m = mats[mname] || { color: [0.8, 0.8, 0.8], emissive: [0, 0, 0] };
      // Blender writes MTL Kd already in linear space (no sRGB conversion needed).
      const material = doc.createMaterial(mname).setBaseColorFactor([...m.color, 1])
        .setRoughnessFactor(0.75).setMetallicFactor(/metal|gold|brass|silver/i.test(mname) ? 0.7 : 0)
.setEmissiveFactor(m.emissive).setDoubleSided(true);
      const prim = doc.createPrimitive()
        .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buf))
        .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(nor).setBuffer(buf))
        .setMaterial(material);
      mesh.addPrimitive(prim);
    }
    const node = doc.createNode(name).setMesh(mesh);
    doc.createScene(name).addChild(node);
    // Float vertices (no quantization): the static batcher merges props across rooms.
    await doc.transform(weld(), dedup(), prune());
    const file = `${pack === 'furniture' ? 'f-' : ''}${name}`.toLowerCase();
    await io.write(`${OUT}/${file}.glb`, doc);
    manifest.props[file] = { source: `${pack}/${name}`, size: max.map((x, j) => +(x - min[j]).toFixed(3)),
      min: min.map(x => +x.toFixed(3)), materials: [...groups.keys()] };
  }
}
writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2));
console.log(Object.entries(manifest.props).map(([k, p]) => `${k} ${p.size.join('x')}`).join('\n'));
