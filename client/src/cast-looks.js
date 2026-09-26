// How each established guest (and Elias) is dressed from the CC0 character parts.
// Colours come from the authoritative cast data (top `color`, `pants`, `shoes`, `hair`),
// so identities stay what they were; the models only replace the primitive stand-ins.
//
// NOT APPROVED IDENTITY ART: no approved complexion / face / hairstyle references exist in
// the repository, so every guest keeps the same neutral placeholder skin tone rather than
// guessing from names. Body type follows each guest's established voice assignment.
import { CAST, CURATOR } from '@game/data.ts';

export const SKIN = '#c89878';

// parts: head/body/legs/feet part ids (see /models/characters/manifest.json).
// roles: which model materials ('part:name') take the guest's colour for that role:
//   color = top / jacket / dress, pants = trousers / skirt, shoes, hair, skin.
// hide: model materials hidden on this guest (hats that don't belong at the party).
const W = (head, body, legs, feet) => ({ head: `w-${head}-head`, body: `w-${body}-body`, legs: `w-${legs}-legs`, feet: `w-${feet}-feet` });
const M = (head, body, legs, feet) => ({ head: `m-${head}-head`, body: `m-${body}-body`, legs: `m-${legs}-legs`, feet: `m-${feet}-feet` });
export const LOOKS = {
  julian: { ...M('suit', 'suit', 'suit', 'suit'), roles: { color: ['body:Suit'], pants: ['legs:Suit'], shoes: ['feet:Black'], hair: ['head:Hair', 'head:Eyebrows'] } },
  anika: { ...W('scifi', 'suit', 'suit', 'suit'), roles: { color: ['body:Black'], pants: ['legs:Black'], shoes: ['feet:Black'], hair: ['head:Hair_Black', 'head:Black', 'head:Blue', 'head:Brown'] } },
  marcus: { ...M('casual2', 'casual2', 'casual2', 'casual2'), roles: { color: ['body:LightBrown'], pants: ['legs:LightBlue'], shoes: ['feet:White', 'feet:Red_Dark'], hair: ['head:Hair', 'head:Eyebrows'], skin: ['head:Skin_Darker'] } },
  mei: { ...W('formal', 'formal', 'formal', 'formal'), roles: { color: ['body:LimeGreen', 'legs:LimeGreen'], pants: ['body:Gold'], shoes: ['feet:Red'], hair: ['head:Red', 'head:Brown'] } },
  dev: { ...M('adventurer', 'suit', 'suit', 'suit'), roles: { color: ['body:Suit'], pants: ['legs:Suit'], shoes: ['feet:Black'], hair: ['head:Hair', 'head:Eyebrows'] } },
  amara: { ...W('adventurer', 'casual', 'casual', 'casual'), roles: { color: ['body:White'], pants: ['legs:Orange'], shoes: ['feet:Grey'], hair: ['head:Hair_Brown', 'head:Brown'] } },
  alex: { ...M('casualhoodie', 'casualhoodie', 'casual2', 'casualhoodie'), roles: { color: ['body:Purple'], pants: ['legs:LightBlue'], shoes: ['feet:Purple', 'feet:White'], hair: ['head:Hair', 'head:Eyebrows'] } },
  andre: { ...M('beach', 'punk', 'suit', 'suit'), roles: { color: ['body:Black'], pants: ['legs:Suit'], shoes: ['feet:Black'], hair: ['head:Hair', 'head:Eyebrows'] }, fixed: { 'body:White': '#d8d2c4' } },
  rafael: { ...M('punk', 'casual2', 'suit', 'casual2'), roles: { color: ['body:LightBrown'], pants: ['legs:Suit'], shoes: ['feet:Red_Dark', 'feet:White'], hair: ['head:Red', 'head:Red_Dark', 'head:Eyebrows'] } },
  simone: { ...W('suit', 'formal', 'formal', 'formal'), roles: { color: ['body:LimeGreen', 'legs:LimeGreen'], pants: ['body:Gold'], shoes: ['feet:Red'], hair: ['head:Hair_Brown', 'head:Hair_Blond', 'head:Brown'] } },
  owen: { ...M('worker', 'adventurer', 'casual2', 'suit'), roles: { color: ['body:Green', 'body:LightGreen'], pants: ['legs:LightBlue'], shoes: ['feet:Black'], hair: ['head:Eyebrows', 'head:Moustache'] }, hide: ['head:Worker_Yellow'] },
  tessa: { ...W('casual', 'punk', 'suit', 'casual'), roles: { color: ['body:Pink'], pants: ['legs:Black'], shoes: ['feet:Grey'], hair: ['head:Hair_Brown', 'head:Hair_Blond', 'head:Brown'] }, fixed: { 'body:Black': '#2a2226' } },
  nia: { ...W('soldier', 'formal', 'formal', 'formal'), roles: { color: ['body:LimeGreen', 'legs:LimeGreen'], pants: ['body:Gold'], shoes: ['feet:Red'], hair: ['head:Hair_Brown', 'head:Brown'] } },
  elias: { ...M('king', 'suit', 'suit', 'suit'), roles: { color: ['body:Tie'], pants: ['legs:Suit'], shoes: ['feet:Black'], hair: ['head:Hair_White'] }, fixed: { 'body:Suit': '#16090c' }, hide: ['head:Gold'], scale: 1.06 },
};

/** Every part any guest (or Elias) wears — for preloading while players wait in the lobby. */
export function allCastParts() {
  return [...new Set(Object.keys(LOOKS).flatMap(id => lookParts(id).parts.map(p => p.id)))];
}

export function lookParts(id) {
  const info = id === 'elias' ? CURATOR : CAST.find(c => c.id === id);
  const look = LOOKS[id];
  const tints = {};
  for (const [role, mats] of Object.entries(look.roles || {})) {
    const hex = role === 'skin' ? SKIN : info[role];
    for (const m of mats) tints[m] = hex;
  }
  for (const k of ['head', 'body', 'legs', 'feet']) tints[`${k}:Skin`] = SKIN;
  Object.assign(tints, look.fixed || {});
  return { parts: ['head', 'body', 'legs', 'feet'].map(kind => ({ kind, id: look[kind] })), tints, hide: look.hide || [], scale: look.scale ?? 1 };
}
