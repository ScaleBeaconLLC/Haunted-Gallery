// Rigged character models (CC0, Quaternius) with animation clips, replacing the primitive
// stand-ins. All parts (head / body / legs / feet) share one 62-bone skeleton, so each
// guest wears their own combination of parts and one animation set drives everyone.
// Built offline by tools/assets/build-characters.mjs into /models/characters/.
import * as pc from 'playcanvas';

const BASE = '/models/characters/';
let animsPromise = null;
let skeletonContainer = null;
const partPromises = new Map();
let clipSpeeds = {};

function loadContainer(app, url) {
  return new Promise((resolve, reject) => {
    const asset = new pc.Asset(url, 'container', { url });
    asset.on('load', a => resolve(a.resource));
    asset.on('error', e => reject(new Error(`${url}: ${e}`)));
    app.assets.add(asset);
    app.assets.load(asset);
  });
}

/** Load the shared skeleton + animation clips once. Resolves to Map(name -> AnimTrack). */
export function loadAnims(app) {
  if (!animsPromise) {
    animsPromise = Promise.all([
      loadContainer(app, `${BASE}anims.glb`),
      fetch(`${BASE}manifest.json`).then(r => r.json()),
    ]).then(([res, manifest]) => {
      skeletonContainer = res;
      const clips = new Map();
      for (const a of res.animations) clips.set(a.resource.name, a.resource);
      clipSpeeds = Object.fromEntries(manifest.clips.filter(c => c.groundSpeed).map(c => [c.name, c.groundSpeed]));
      return clips;
    });
  }
  return animsPromise;
}

export async function loadSkeleton(app) {
  await loadAnims(app);
  return skeletonContainer;
}

/** One skinned body part from /models/characters/parts/<id>.glb. */
export function loadPart(app, id) {
  if (!partPromises.has(id)) partPromises.set(id, loadContainer(app, `${BASE}parts/${id}.glb`));
  return partPromises.get(id);
}

/** Natural ground speed (m/s) of a locomotion clip, for foot-contact-matched playback. */
export const groundSpeed = name => clipSpeeds[name] ?? 1;

/**
 * A skinned character assembled from parts on one animated skeleton, with per-character
 * material copies for tinting and a state-based animation layer (`play(name, blend)`).
 */
export class Character {
  /**
   * @param parts [{ kind: 'head'|'body'|'legs'|'feet', container }]
   * @param tints { 'body:Suit': '#hex', ... } keyed by part kind and model material name
   * @param hide material keys to hide (e.g. a hat: 'head:Gold')
   */
  constructor(skeleton, parts, clips, { tints = {}, scale = 1, hide = [] } = {}) {
    this.entity = skeleton.instantiateRenderEntity();
    this.entity.setLocalScale(scale, scale, scale);
    const armature = this.entity.findByName('CharacterArmature') ?? this.entity;
    // Move each part's mesh onto this skeleton (bones are matched by name) and discard
    // the part's own copy of the bones.
    this.renders = [];
    for (const { kind, container } of parts) {
      const tmp = container.instantiateRenderEntity({ castShadows: false });
      for (const r of tmp.findComponents('render')) {
        r.entity.reparent(armature);
        r.rootBone = this.entity;
        this.renders.push({ kind, r });
      }
      tmp.destroy();
    }
    // Own copies of the materials (keyed 'kind:name') so each guest carries their own colours.
    this.materials = new Map();
    for (const { kind, r } of this.renders) {
      r.castShadows = false;
      for (const mi of r.meshInstances) {
        const name = `${kind}:${mi.material.name}`;
        if (hide.includes(name)) mi.visible = false;
        if (!this.materials.has(name)) {
          const m = mi.material.clone();
          m.name = name;
          this.materials.set(name, m);
        }
        mi.material = this.materials.get(name);
      }
    }
    this.base = new Map([...this.materials].map(([n, m]) => [n, m.diffuse.clone()]));
    for (const [name, hex] of Object.entries(tints)) this.tint(name, hex);
    this.entity.addComponent('anim', { activate: true });
    this.entity.anim.rootBone = this.entity;
    for (const [name, track] of clips) this.entity.anim.assignAnimation(name, track);
    this.state = null;
    this.bones = {};
    for (const b of ['Hips', 'Abdomen', 'Torso', 'Chest', 'Neck', 'Head', 'UpperArm.L', 'UpperArm.R', 'LowerArm.L', 'LowerArm.R'])
      this.bones[b] = this.entity.findByName(b);
  }

  /** Recolour a material (by its name in the model) with a CSS hex colour; null restores it. */
  tint(name, hex, { emissive = null, emissiveIntensity = 1 } = {}) {
    const m = this.materials.get(name);
    if (!m) return;
    m.diffuse = hex ? new pc.Color().fromString(hex) : this.base.get(name).clone();
    if (emissive) { m.emissive = new pc.Color().fromString(emissive); m.emissiveIntensity = emissiveIntensity; }
    else m.emissive = new pc.Color(0, 0, 0);
    m.update();
  }

  /** Cross-fade to a clip (state-based: one call site decides the state each frame). */
  play(name, blend = 0.25) {
    if (this.state === name) return;
    const first = this.state === null;
    this.state = name;
    this.entity.anim.baseLayer.transition(name, first ? 0 : blend);
  }

  set speed(v) { this.entity.anim.speed = v; }
  get speed() { return this.entity.anim.speed; }
}
