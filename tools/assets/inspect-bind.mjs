import { NodeIO } from '@gltf-transform/core';
import { mat4, vec3, quat } from 'gl-matrix';
const io = new NodeIO();
const tgt = await io.read('assets-src/quaternius/women/Formal.gltf');
const skin = tgt.getRoot().listSkins()[0];
const joints = skin.listJoints(), ibm = skin.getInverseBindMatrices().getArray();
const bind = new Map();
joints.forEach((j, i) => { const m = mat4.invert(mat4.create(), ibm.slice(i * 16, i * 16 + 16)); bind.set(j.getName(), m); });
const pos = n => { const v = vec3.create(); mat4.getTranslation(v, bind.get(n)); return v; };
const dir = (a, b) => { const v = vec3.sub(vec3.create(), pos(b), pos(a)); vec3.normalize(v, v); return Array.from(v).map(x => +x.toFixed(2)); };
console.log('bind UpperArm.L->LowerArm.L', dir('UpperArm.L', 'LowerArm.L'));
console.log('bind LowerArm.L->Wrist.L', dir('LowerArm.L', 'Wrist.L'));
console.log('bind UpperLeg.L->LowerLeg.L', dir('UpperLeg.L', 'LowerLeg.L'), 'LowerLeg->Foot', dir('LowerLeg.L', 'Foot.L'));
for (const n of ['Hips', 'Head', 'Foot.L', 'LowerLeg.L', 'Wrist.L']) console.log(n, Array.from(pos(n)).map(x => +x.toFixed(3)));
const sc = vec3.create(); mat4.getScaling(sc, bind.get('Hips')); console.log('bind scale', Array.from(sc).map(x=>+x.toFixed(3)));
// mesh bounds
let min=[1e9,1e9,1e9], max=[-1e9,-1e9,-1e9];
for (const m of tgt.getRoot().listMeshes()) for (const p of m.listPrimitives()) { const a=p.getAttribute('POSITION'); const lo=a.getMin([]), hi=a.getMax([]); for(let k=0;k<3;k++){min[k]=Math.min(min[k],lo[k]);max[k]=Math.max(max[k],hi[k]);} }
console.log('mesh bounds', min.map(x=>+x.toFixed(2)), max.map(x=>+x.toFixed(2)));
