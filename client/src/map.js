// A small SVG floor plan. It only ever highlights what this phone already knows:
// its own room, an SOS snapshot room it received, and the legal route between them.
// Drawn the way the mansion eagle-eye view sees the house on a landscape phone:
// world +z runs to the right (bedroom wing on the right), +x runs up the screen.
import { CORRIDORS, ROOMS, ROOM_IDS, EXIT_CORRIDOR } from '@game/data.ts';

export function mapSvg({ myRoom, targetRoom, route = [], exitOpen }) {
  const pad = 2, minX = -33, maxX = 33, minZ = 0, maxZ = 82;
  const W = maxZ - minZ + pad * 2, H = maxX - minX + pad * 2;
  const X = z => z - minZ + pad, Y = x => maxX - x + pad;
  const rect = ([x0, x1, z0, z1]) => `x="${X(z0)}" y="${Y(x1)}" width="${z1 - z0}" height="${x1 - x0}"`;
  const onRoute = new Set(route);
  const parts = [];
  for (const c of CORRIDORS) for (const r of c.rects) parts.push(`<rect ${rect(r)} fill="#2b2023"/>`);
  parts.push(`<rect ${rect(EXIT_CORRIDOR.rect)} fill="${exitOpen ? '#1f6b36' : '#5a1a1a'}"/>`);
  for (const id of ROOM_IDS) {
    const r = ROOMS[id];
    const fill = id === myRoom ? '#6b5220' : id === targetRoom ? '#7a1a26' : onRoute.has(id) ? '#3d2f33' : '#241a1d';
    const stroke = id === targetRoom ? '#ff5a6a' : id === myRoom ? '#e5c07b' : '#4a3a3f';
    parts.push(`<rect ${rect(r.rect)} fill="${fill}" stroke="${stroke}" stroke-width="0.5" rx="0.6"/>`);
    const [cx, cz] = r.center;
    const [x0, x1, z0, z1] = r.rect;
    const label = r.name.replace("Curator's ", 'Curator’s ').split(' ');
    const tall = (x1 - x0) > 1.6 * (z1 - z0);
    const tx = X(cz), ty = Y(cx);
    if (tall) parts.push(`<text x="${tx}" y="${ty}" fill="#f3e9dc" font-size="2" text-anchor="middle" dominant-baseline="middle" font-family="Georgia" transform="rotate(-90 ${tx} ${ty})">${label.join(' ')}</text>`);
    else parts.push(`<text x="${tx}" y="${ty - 0.4}" fill="#f3e9dc" font-size="2" text-anchor="middle" font-family="Georgia">${label.slice(0, 2).join(' ')}<tspan x="${tx}" dy="2.4">${label.slice(2).join(' ')}</tspan></text>`);
  }
  parts.push(`<text x="${X(10)}" y="${Y(0) + 0.7}" fill="${exitOpen ? '#5fd08a' : '#ff6a6a'}" font-size="1.8" text-anchor="middle" font-family="system-ui">GARDEN GATE ${exitOpen ? 'OPEN' : 'LOCKED'}</text>`);
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Mansion map">${parts.join('')}</svg>`;
}
