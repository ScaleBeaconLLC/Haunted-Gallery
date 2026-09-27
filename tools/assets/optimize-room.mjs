// Post-process a room GLB exported from Blender for phones: weld + dedup + prune, quantized
// (KHR_mesh_quantization) interleaved vertices.
// Usage: node tools/assets/optimize-room.mjs <file.glb> [--keep-lightmap]
//
// The Blender room builds run this automatically after exporting (build_guest_suite.py,
// hg_room.py). --keep-lightmap is for rooms with baked lighting (a <room>.json sidecar): prune
// would otherwise delete TEXCOORD_1, because no glTF material references the lightmap (the game
// applies it from the sidecar), and lightmap UVs get 16-bit quantization instead of 12.
import { NodeIO, VertexLayout } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize, weld } from '@gltf-transform/functions';
import { statSync } from 'node:fs';

const file = process.argv[2];
const keepLightmap = process.argv.includes('--keep-lightmap');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).setVertexLayout(VertexLayout.INTERLEAVED);
const before = statSync(file).size;
const doc = await io.read(file);

/** Drop TEXCOORD_0 from primitives whose material samples no texture (prune keeps it once
 * keepAttributes is on), leaving TEXCOORD_1 for the lightmap. */
const stripUnusedUv0 = () => (d) => {
  for (const mesh of d.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const m = prim.getMaterial();
    const textured = m && (m.getBaseColorTexture() || m.getNormalTexture() || m.getMetallicRoughnessTexture() || m.getEmissiveTexture() || m.getOcclusionTexture());
    if (!textured && prim.getAttribute('TEXCOORD_0')) prim.setAttribute('TEXCOORD_0', null);
  }
};

const steps = [weld(), dedup()];
if (keepLightmap) steps.push(stripUnusedUv0());
steps.push(
  prune({ keepExtras: true, keepLeaves: true, keepAttributes: keepLightmap }),
  quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: keepLightmap ? 16 : 12 }),
);
await doc.transform(...steps);
await io.write(file, doc);
const lm = doc.getRoot().listMeshes().flatMap(m => m.listPrimitives()).filter(p => p.getAttribute('TEXCOORD_1')).length;
console.log(`${file}: ${(before / 1e6).toFixed(2)} MB -> ${(statSync(file).size / 1e6).toFixed(2)} MB${keepLightmap ? `; ${lm} primitives keep lightmap UVs` : ''}`);
