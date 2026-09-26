// Downloads CC0 textures and models from Poly Haven (https://polyhaven.com, CC0 1.0) into
// assets-src/polyhaven/<id>/ (gitignored). Used by tools/blender/build_guest_suite.py.
//   node tools/assets/fetch-polyhaven.mjs
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const TEXTURES = ['old_wooden_floor_02', 'dark_paneled_wood', 'floral_jacquard', 'quatrefoil_jacquard_fabric',
  'velour_velvet', 'long_white_tiles', 'interior_tiles', 'wood_table_worn'];
const MODELS = ['ClassicNightstand_01', 'GothicCommode_01', 'ArmChair_01', 'Rockingchair_01', 'ornate_mirror_01',
  'potted_plant_04', 'fancy_picture_frame_01', 'vintage_grandfather_clock_01', 'Ottoman_01'];
const RES = '1k';
const OUT = 'assets-src/polyhaven';

async function get(url, path) {
  if (existsSync(path)) return;
  mkdirSync(dirname(path), { recursive: true });
  for (let i = 1; ; i++) {
    const r = await fetch(url);
    if (r.ok) { writeFileSync(path, Buffer.from(await r.arrayBuffer())); return; }
    if (i >= 4) throw new Error(`${url}: HTTP ${r.status}`);
    await new Promise(res => setTimeout(res, 1000 * i));
  }
}
const files = async id => (await fetch(`https://api.polyhaven.com/files/${id}`)).json();

for (const id of TEXTURES) {
  const f = await files(id);
  for (const [map, key] of [['diff', 'Diffuse'], ['nor', 'nor_gl'], ['rough', 'Rough']]) {
    const e = f[key]?.[RES]?.jpg ?? f[key]?.[RES]?.png;
    if (e) await get(e.url, join(OUT, id, `${map}.${e.url.split('.').pop()}`));
  }
  console.log('texture', id);
}
for (const id of MODELS) {
  const f = await files(id);
  const g = f.gltf?.[RES]?.gltf;
  if (!g) { console.warn('no gltf for', id); continue; }
  await get(g.url, join(OUT, id, `${id}.gltf`));
  for (const [rel, inc] of Object.entries(g.include || {})) await get(inc.url, join(OUT, id, rel));
  console.log('model', id);
}
