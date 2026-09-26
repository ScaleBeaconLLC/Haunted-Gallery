// Head height (m, model scale 1) over time for clips: node tools/assets/clip-heights.mjs a,b
import { NodeIO } from '@gltf-transform/core';
import { sample, duration, worldPose, byName } from './pose.mjs';
const doc = await new NodeIO().read('client/public/models/characters/anims.glb');
const head = byName(doc, 'Head');
for (const name of (process.argv[2] || 'kneel_search').split(',')) {
  const a = doc.getRoot().listAnimations().find(x => x.getName() === name);
  const d = duration(a), row = [];
  for (let i = 0; i <= 20; i++) { const t = d * i / 20; row.push(`${t.toFixed(2)}:${worldPose(doc, sample(a, t)).get(head).p[1].toFixed(2)}`); }
  console.log(name, d.toFixed(2) + 's', row.join(' '));
}
