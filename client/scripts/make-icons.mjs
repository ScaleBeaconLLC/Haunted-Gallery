// Home Screen / install icons for the phone client: a gold gothic lancet arch with a wrought-iron
// gate and a crescent moon on the mansion's night background (no text). Pure Node (zlib only):
//   node client/scripts/make-icons.mjs
// writes client/public/icons/{icon-192,icon-512,icon-maskable-512,apple-touch-icon}.png
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

// ------------------------------------------------------------------ PNG (RGB, 8 bit)
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ------------------------------------------------------------------ the art (unit square, y down)
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const GOLD = hex('#e5c07b'), IRON = hex('#b8914a'), MOON = hex('#f6e8c3'), NIGHT_TOP = hex('#2a1420'), NIGHT_LOW = hex('#10080c');
const BG_IN = hex('#241016'), BG_OUT = hex('#0b0709');
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = t => Math.max(0, Math.min(1, t));

const CX = 0.5, A = 0.24, YS = 0.47, YB = 0.93, T = 0.058;
/** Inside an equilateral pointed (lancet) arch of half-width a whose sides spring at YS. */
function inArch(u, v, a, r) {
  if (v >= YS) return Math.abs(u - CX) <= a && v <= YB;
  return Math.hypot(u - (CX + A), v - YS) <= r && Math.hypot(u - (CX - A), v - YS) <= r;
}
const inOuter = (u, v) => inArch(u, v, A, 2 * A);
const inInner = (u, v) => inArch(u, v, A - T, 2 * A - T);

function art(u, v) {
  // null = background shows through
  const inside = inInner(u, v);
  const ring = inOuter(u, v) && !inside;
  if (ring) return GOLD;
  // Base step under the arch.
  if (v > YB && v < YB + 0.05 && Math.abs(u - CX) < A + 0.07) return mix(GOLD, IRON, 0.35);
  if (!inside) return null;
  // Gate: five bars, two rails, a small spear tip on each bar.
  for (let k = -2; k <= 2; k++) {
    const bx = CX + k * 0.072;
    if (Math.abs(u - bx) < 0.011 && v > 0.3 - Math.abs(k) * 0.03) return IRON;
    const tip = 0.3 - Math.abs(k) * 0.03;
    if (v <= tip && v > tip - 0.04 && Math.abs(u - bx) < 0.024 * (v - (tip - 0.04)) / 0.04) return IRON;
  }
  if ((Math.abs(v - 0.62) < 0.009 || Math.abs(v - 0.86) < 0.009)) return IRON;
  // Crescent moon, behind the bars.
  const m = Math.hypot(u - (CX + 0.035), v - 0.35), cut = Math.hypot(u - (CX + 0.085), v - 0.315);
  if (m < 0.105 && cut > 0.09) return MOON;
  // Night sky with a soft moon glow.
  const sky = mix(NIGHT_TOP, NIGHT_LOW, clamp01((v - 0.1) / 0.8));
  return mix(sky, MOON, 0.28 * clamp01(1 - m / 0.3) ** 2);
}

function render(size, scale) {
  const rgb = Buffer.alloc(size * size * 3);
  const SS = 4, o = 0.5 - scale / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let acc = [0, 0, 0];
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const px = (x + (sx + 0.5) / SS) / size, py = (y + (sy + 0.5) / SS) / size;
      const bg = mix(BG_IN, BG_OUT, clamp01(Math.hypot(px - 0.5, py - 0.46) / 0.62));
      const c = art((px - o) / scale, (py - o + 0.01) / scale) ?? bg;
      acc = [acc[0] + c[0], acc[1] + c[1], acc[2] + c[2]];
    }
    const i = (y * size + x) * 3;
    rgb[i] = Math.round(acc[0] / (SS * SS)); rgb[i + 1] = Math.round(acc[1] / (SS * SS)); rgb[i + 2] = Math.round(acc[2] / (SS * SS));
  }
  return png(size, size, rgb);
}

mkdirSync(OUT, { recursive: true });
const jobs = [['icon-192.png', 192, 0.8], ['icon-512.png', 512, 0.8], ['icon-maskable-512.png', 512, 0.6], ['apple-touch-icon.png', 180, 0.78]];
for (const [name, size, scale] of jobs) {
  writeFileSync(join(OUT, name), render(size, scale));
  console.log(`wrote ${name} (${size}x${size})`);
}
