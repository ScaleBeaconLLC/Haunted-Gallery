// Shared glTF pose helpers for the offline asset pipeline: sample an animation at a time,
// and compute world rotation / position / uniform scale for every node.
import { quat, vec3 } from 'gl-matrix';

/** Value of every channel of `anim` at time t: Map(node -> { translation?, rotation?, scale? }). */
export function sample(anim, t) {
  const out = new Map();
  for (const ch of anim.listChannels()) {
    const node = ch.getTargetNode(), path = ch.getTargetPath(), s = ch.getSampler();
    const input = s.getInput().getArray(), output = s.getOutput().getArray();
    const n = path === 'rotation' ? 4 : 3;
    const cubic = s.getInterpolation() === 'CUBICSPLINE';
    const stride = cubic ? n * 3 : n, off = cubic ? n : 0;
    let i = 0;
    while (i < input.length - 1 && input[i + 1] <= t) i++;
    const j = Math.min(i + 1, input.length - 1);
    const a = Array.from(output.slice(i * stride + off, i * stride + off + n));
    let v = a;
    if (j !== i && s.getInterpolation() !== 'STEP' && t > input[i]) {
      const b = Array.from(output.slice(j * stride + off, j * stride + off + n));
      const k = Math.min(1, (t - input[i]) / (input[j] - input[i]));
      if (path === 'rotation') { const q = quat.create(); quat.slerp(q, a, b, k); v = Array.from(q); }
      else v = a.map((x, m) => x + (b[m] - x) * k);
    }
    if (!out.has(node)) out.set(node, {});
    out.get(node)[path] = v;
  }
  return out;
}

export function duration(anim) {
  let d = 0;
  for (const s of anim.listSamplers()) d = Math.max(d, s.getInput().getMax([0])[0]);
  return d;
}

/**
 * World pose of every node under the scene. `pose` overrides local TRS (from sample()).
 * Returns Map(node -> { r: quat, p: vec3, s: number, local: {t, r, s} }).
 */
export function worldPose(doc, pose = new Map()) {
  const res = new Map();
  const visit = (node, parent) => {
    const o = pose.get(node) || {};
    const t = o.translation || node.getTranslation();
    const r = o.rotation || node.getRotation();
    const sc = o.scale || node.getScale();
    const s = (sc[0] + sc[1] + sc[2]) / 3;
    let w;
    if (!parent) w = { r: quat.clone(r), p: vec3.clone(t), s };
    else {
      const p = vec3.create();
      vec3.transformQuat(p, vec3.scale(p, t, parent.s), parent.r);
      vec3.add(p, p, parent.p);
      const q = quat.create(); quat.multiply(q, parent.r, r);
      w = { r: q, p, s: parent.s * s };
    }
    w.local = { t, r, s: sc };
    res.set(node, w);
    for (const c of node.listChildren()) visit(c, w);
  };
  for (const n of doc.getRoot().listScenes()[0].listChildren()) visit(n, null);
  return res;
}

export const byName = (doc, name) => doc.getRoot().listNodes().find(n => n.getName() === name);
