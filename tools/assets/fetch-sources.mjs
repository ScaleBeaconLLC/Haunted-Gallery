// Downloads the CC0 source assets into assets-src/ (gitignored). Run from the repo root:
//   node tools/assets/fetch-sources.mjs
// Then build the runtime files with: node tools/assets/build-characters.mjs
//
// Sources (all CC0 1.0, Quaternius — https://quaternius.com):
//   Ultimate Modular Women  https://quaternius.com/packs/ultimatemodularwomen.html
//   Ultimate Modular Men    https://quaternius.com/packs/ultimatemodularcharacters.html
//   Universal Animation Library (free edition, glTF mirror)
//                           https://github.com/J-Ponzo/gltf-universal-animation-library
import { mkdirSync, writeFileSync } from 'node:fs';

const PACKS = {
  women: '1720N9IGyQHXYvtvZJzazhxtTTlz-y2Vf',   // Google Drive folder linked from quaternius.com
  men: '1USAAquX2JJWuA2m6zol0KUkFe3UkZ8zX',
};

async function list(id) {
  const html = await (await fetch(`https://drive.google.com/embeddedfolderview?id=${id}`)).text();
  const out = [];
  const re = /id="entry-([A-Za-z0-9_-]+)"[\s\S]*?href="([^"]+)"[\s\S]*?flip-entry-title">([^<]+)/g;
  let m;
  while ((m = re.exec(html))) out.push({ id: m[1], folder: m[2].includes('/folders/'), title: m[3] });
  return out;
}
const download = async (id, path) => {
  const res = await fetch(`https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
};

for (const [pack, root] of Object.entries(PACKS)) {
  const dir = `assets-src/quaternius/${pack}`;
  mkdirSync(dir, { recursive: true });
  const top = await list(root);
  for (const f of top.filter(e => !e.folder && /\.txt$/.test(e.title))) await download(f.id, `${dir}/${f.title}`);
  const chars = top.find(e => e.title === 'Individual Characters');
  const gltf = (await list(chars.id)).find(e => e.title === 'glTF');
  for (const f of await list(gltf.id)) {
    await download(f.id, `${dir}/${f.title}`);
    console.log(`${pack}/${f.title}`);
  }
}

mkdirSync('assets-src/ual', { recursive: true });
const RAW = 'https://raw.githubusercontent.com/J-Ponzo/gltf-universal-animation-library/HEAD/';
for (const f of ['glTF/AnimationLibrary_Godot_Standard.gltf', 'glTF/AnimationLibrary_Godot_Standard.bin', 'LICENSE', 'README.md']) {
  const res = await fetch(RAW + f);
  writeFileSync(`assets-src/ual/${f.split('/').pop()}`, Buffer.from(await res.arrayBuffer()));
  console.log(`ual/${f}`);
}
