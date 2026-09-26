// Post-process a room GLB exported from Blender for phones: weld + dedup + prune, quantized
// (KHR_mesh_quantization) interleaved vertices. Usage: node tools/assets/optimize-room.mjs <file.glb>
import { NodeIO, VertexLayout } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize, weld } from '@gltf-transform/functions';
import { statSync } from 'node:fs';

const file = process.argv[2];
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).setVertexLayout(VertexLayout.INTERLEAVED);
const before = statSync(file).size;
const doc = await io.read(file);
await doc.transform(weld(), dedup(), prune({ keepExtras: true, keepLeaves: true }), quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }));
await io.write(file, doc);
console.log(`${file}: ${(before / 1e6).toFixed(2)} MB -> ${(statSync(file).size / 1e6).toFixed(2)} MB`);
