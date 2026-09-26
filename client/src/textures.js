// Procedurally painted surface textures for the mansion, drawn once on canvases at load
// (no downloads). Each follows the material language of the reference package
// (references/mansion-package): walnut, parquet/herringbone, checkered marble, stone,
// olive plaster, blue damask, burgundy rugs, gilt frames and moonlit glass.
// These are generated stand-ins for authored PBR textures, not final art.
import * as pc from 'playcanvas';

const cache = new Map();
let seed = 1337;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const jitter = (hex, amt) => {
  const n = parseInt(hex.slice(1), 16);
  const f = 1 + (rnd() - 0.5) * amt;
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => Math.max(0, Math.min(255, Math.round(v * f))));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
};

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')];
}

function grain(ctx, x, y, w, h, color, lines = 6) {
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.18;
  ctx.lineWidth = 1;
  for (let i = 0; i < lines; i++) {
    const yy = y + rnd() * h;
    ctx.beginPath();
    ctx.moveTo(x, yy);
    ctx.bezierCurveTo(x + w * 0.3, yy + (rnd() - 0.5) * 4, x + w * 0.7, yy + (rnd() - 0.5) * 4, x + w, yy + (rnd() - 0.5) * 3);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// ------------------------------------------------------------------ View Gallery art
// Painted in code (placeholder art, not commissioned portraits). The host, Elias, is the
// same tall white-haired figure in a dark suit and wine tie in every era.
const SKINS = ['#e0c2a2', '#c9a88a', '#b8906e', '#8a6a52', '#6a4a36', '#d8b898'];
const COATS = ['#1a1a22', '#3a2a4a', '#5a1a1a', '#2a3a2a', '#d8cdb8', '#1a2a3a', '#6a5a3a', '#4a2a2a'];
function figure(ctx, x, y, h, { coat = '#1a1a22', skin = '#c9a88a', hair = '#2a1a0a', host = false, side = 0, glass = false, hat = false } = {}) {
  const w = h * 0.34;
  ctx.fillStyle = coat;                                   // body / shoulders
  ctx.beginPath(); ctx.moveTo(x - w / 2, y); ctx.quadraticCurveTo(x - w / 2, y - h * 0.62, x, y - h * 0.66);
  ctx.quadraticCurveTo(x + w / 2, y - h * 0.62, x + w / 2, y); ctx.fill();
  if (host) { ctx.fillStyle = '#e8e2d6'; ctx.fillRect(x - w * 0.08, y - h * 0.64, w * 0.16, h * 0.2); ctx.fillStyle = '#6a0f1e'; ctx.fillRect(x - w * 0.04, y - h * 0.62, w * 0.08, h * 0.2); }
  ctx.fillStyle = skin;                                   // head (turned by `side`)
  ctx.beginPath(); ctx.ellipse(x + side * h * 0.02, y - h * 0.78, h * 0.085, h * 0.11, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = host ? '#e4e4e0' : hair;               // hair
  ctx.beginPath(); ctx.ellipse(x + side * h * 0.01 - side * h * 0.03, y - h * 0.84, h * 0.09, h * 0.065, 0, Math.PI, 0); ctx.fill();
  if (host) { ctx.fillStyle = '#e4e4e0'; ctx.beginPath(); ctx.ellipse(x + side * h * 0.02, y - h * 0.7, h * 0.06, h * 0.035, 0, 0, Math.PI); ctx.fill(); }
  if (!side) { ctx.fillStyle = 'rgba(10,6,4,0.8)'; ctx.fillRect(x - h * 0.04, y - h * 0.8, h * 0.02, h * 0.012); ctx.fillRect(x + h * 0.02, y - h * 0.8, h * 0.02, h * 0.012); }
  if (glass) { ctx.fillStyle = 'rgba(240,220,160,0.9)'; ctx.fillRect(x + w * 0.4, y - h * 0.5, h * 0.03, h * 0.07); }
  if (hat) { ctx.fillStyle = '#d9a441'; ctx.beginPath(); ctx.moveTo(x - h * 0.05, y - h * 0.9); ctx.lineTo(x, y - h * 1.05); ctx.lineTo(x + h * 0.05, y - h * 0.9); ctx.fill(); }
}
function crowd(ctx, s, n, baseY, h, opts = {}) {
  for (let i = 0; i < n; i++) {
    const x = s * (0.12 + 0.76 * (i + 0.5) / n) + (rnd() - 0.5) * s * 0.02;
    figure(ctx, x, baseY + (i % 2) * h * 0.08, h * (0.92 + rnd() * 0.12), { coat: COATS[(i * 3 + (opts.shift || 0)) % COATS.length], skin: SKINS[(i * 5 + 1) % SKINS.length], hair: ['#1a120a', '#3a2a1a', '#6a3a1a', '#0a0a0a', '#8a6a4a'][i % 5], ...opts, host: false });
  }
}
function tone(ctx, s, style) {
  const img = ctx.getImageData(0, 0, s, s), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
    const n = (rnd() - 0.5) * 18;
    if (style === 'sepia') { d[i] = l * 1.07 + 20 + n; d[i + 1] = l * 0.92 + 8 + n; d[i + 2] = l * 0.7 + n; }
    else if (style === 'faded') { d[i] = d[i] * 0.8 + 40 + n; d[i + 1] = d[i + 1] * 0.78 + 30 + n; d[i + 2] = d[i + 2] * 0.7 + 22 + n; }
    else if (style === 'oil') { d[i] += n * 1.4; d[i + 1] += n * 1.2; d[i + 2] += n; }
    else { d[i] += n * 0.5; d[i + 1] += n * 0.5; d[i + 2] += n * 0.5; }
  }
  ctx.putImageData(img, 0, 0);
  const v = ctx.createRadialGradient(s / 2, s / 2, s * 0.25, s / 2, s / 2, s * 0.72);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, style === 'flash' ? 'rgba(0,0,0,0.85)' : 'rgba(0,0,0,0.5)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, s, s);
}
const GALLERY_ART = {
  newyear(ctx, s) {
    ctx.fillStyle = '#3a3026'; ctx.fillRect(0, 0, s, s);
    const g = ctx.createRadialGradient(s / 2, s * 0.15, 5, s / 2, s * 0.15, s * 0.5); g.addColorStop(0, '#fff2c8'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
    crowd(ctx, s, 12, s * 0.92, s * 0.42, { glass: true });
    figure(ctx, s * 0.93, s * 0.95, s * 0.56, { host: true, coat: '#141016', skin: '#d8c4b0' });
    tone(ctx, s, 'sepia');
  },
  winter(ctx, s) {
    ctx.fillStyle = '#4a3a2a'; ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#c9c2b4'; ctx.fillRect(s * 0.36, s * 0.3, s * 0.28, s * 0.3);      // fireplace
    ctx.fillStyle = '#ff9a3a'; ctx.fillRect(s * 0.42, s * 0.42, s * 0.16, s * 0.16);
    ctx.fillStyle = '#1a2a4a'; ctx.fillRect(s * 0.06, s * 0.12, s * 0.18, s * 0.3);    // snowy window
    for (let i = 0; i < 40; i++) { ctx.fillStyle = '#e8eef8'; ctx.fillRect(s * 0.06 + rnd() * s * 0.18, s * 0.12 + rnd() * s * 0.3, 2, 2); }
    crowd(ctx, s, 6, s * 0.78, s * 0.36, { shift: 1 });
    crowd(ctx, s, 6, s * 0.97, s * 0.4, { shift: 4 });
    figure(ctx, s * 0.9, s * 0.8, s * 0.52, { host: true, coat: '#141016', skin: '#d8c4b0' });
    tone(ctx, s, 'faded');
  },
  garden(ctx, s) {
    ctx.fillStyle = '#0e1a22'; ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = 4;                                        // the gate
    for (let x = s * 0.4; x <= s * 0.6; x += s * 0.025) { ctx.beginPath(); ctx.moveTo(x, s * 0.2); ctx.lineTo(x, s * 0.6); ctx.stroke(); }
    for (let i = 0; i < 9; i++) { const x = s * (0.08 + i * 0.105), y = s * 0.18 + Math.sin(i) * s * 0.03; ctx.fillStyle = '#ffcf6a'; ctx.beginPath(); ctx.arc(x, y, s * 0.018, 0, 7); ctx.fill(); }
    ctx.fillStyle = '#1e2e1a'; ctx.fillRect(0, s * 0.6, s, s * 0.4);
    crowd(ctx, s, 10, s * 0.95, s * 0.4, { shift: 2 });
    figure(ctx, s * 0.5, s * 0.62, s * 0.36, { host: true, coat: '#141016', skin: '#d8c4b0' });  // at the gate
    tone(ctx, s, 'faded');
  },
  curator(ctx, s) {
    const g = ctx.createRadialGradient(s / 2, s * 0.35, s * 0.05, s / 2, s / 2, s * 0.7); g.addColorStop(0, '#5a4a36'); g.addColorStop(1, '#1a1410');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
    figure(ctx, s * 0.5, s * 1.05, s * 1.0, { host: true, coat: '#120e12', skin: '#d8c4b0' });
    tone(ctx, s, 'oil');
  },
  birthday(ctx, s) {
    ctx.fillStyle = '#5a3a3a'; ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#f4ead8'; ctx.fillRect(s * 0.38, s * 0.66, s * 0.24, s * 0.12);   // cake
    for (let i = 0; i < 6; i++) { ctx.fillStyle = '#fff'; ctx.fillRect(s * (0.4 + i * 0.035), s * 0.6, 3, s * 0.06); ctx.fillStyle = '#ffd24a'; ctx.beginPath(); ctx.arc(s * (0.4 + i * 0.035) + 1.5, s * 0.595, 3, 0, 7); ctx.fill(); }
    crowd(ctx, s, 5, s * 0.72, s * 0.34, { shift: 5, hat: true });
    figure(ctx, s * 0.5, s * 0.98, s * 0.46, { coat: '#b8433a', skin: SKINS[0], hair: '#6a3a1a', hat: true });   // the birthday guest
    figure(ctx, s * 0.82, s * 0.7, s * 0.5, { host: true, coat: '#141016', skin: '#d8c4b0' });
    tone(ctx, s, 'flash');
  },
  anniversary(ctx, s) {
    ctx.fillStyle = '#2e2622'; ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#e8dcc8'; ctx.fillRect(s * 0.1, s * 0.62, s * 0.8, s * 0.1);     // long table
    for (let i = 0; i < 5; i++) { figure(ctx, s * (0.16 + i * 0.13), s * 0.64, s * 0.3, { coat: COATS[i + 1], skin: SKINS[(i * 2) % 6], hair: '#2a1a0a' }); }
    figure(ctx, s * 0.9, s * 0.72, s * 0.52, { host: true, coat: '#141016', skin: '#d8c4b0' });
    tone(ctx, s, 'digital');
  },
  photographer(ctx, s) {
    ctx.fillStyle = '#16120e'; ctx.fillRect(0, 0, s, s);
    const g = ctx.createRadialGradient(s * 0.62, s * 0.3, 2, s * 0.62, s * 0.3, s * 0.45); g.addColorStop(0, '#ffffff'); g.addColorStop(0.2, '#fff4c8'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#2a2622'; ctx.fillRect(s * 0.42, s * 0.36, s * 0.2, s * 0.14);    // antique camera
    ctx.fillStyle = '#9a8f7c'; ctx.beginPath(); ctx.arc(s * 0.52, s * 0.43, s * 0.045, 0, 7); ctx.fill();
    ctx.strokeStyle = '#2a2622'; ctx.lineWidth = 5;
    for (const dx of [-0.08, 0, 0.08]) { ctx.beginPath(); ctx.moveTo(s * 0.52, s * 0.5); ctx.lineTo(s * (0.52 + dx), s * 0.95); ctx.stroke(); }
    ctx.globalAlpha = 0.35; figure(ctx, s * 0.25, s * 0.95, s * 0.6, { coat: '#3a3a3a', skin: '#d0c0b0' }); ctx.globalAlpha = 1;
    tone(ctx, s, 'sepia');
  },
  empty(ctx, s) {
    ctx.fillStyle = '#1a1014'; ctx.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 6) { ctx.fillStyle = `rgba(90,20,32,${0.15 + 0.1 * Math.sin(y / 5)})`; ctx.fillRect(0, y, s, 3); }
    ctx.fillStyle = 'rgba(200,170,110,0.25)'; ctx.font = `${Math.round(s * 0.2)}px Georgia, serif`; ctx.textAlign = 'center'; ctx.fillText('13', s / 2, s * 0.58);
  },
  twelve(ctx, s) {
    const g = ctx.createLinearGradient(0, 0, s, 0); g.addColorStop(0, '#3a2a1a'); g.addColorStop(1, '#141010');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#6a4a2a'; ctx.fillRect(s * 0.04, s * 0.2, s * 0.14, s * 0.62);    // the door, left
    ctx.fillStyle = '#b08a3a'; ctx.beginPath(); ctx.arc(s * 0.15, s * 0.52, s * 0.01, 0, 7); ctx.fill();
    for (let i = 0; i < 12; i++) figure(ctx, s * (0.28 + (i % 6) * 0.12), s * (i < 6 ? 0.62 : 0.95), s * 0.34, { coat: COATS[i % 8], skin: SKINS[i % 6], hair: '#1a120a', side: -1 });
    tone(ctx, s, 'oil');
  },
};

const PAINTERS = {
  /** One curated View Gallery work (512 px, see GALLERY_ART). */
  gallery(ctx, s, art) { GALLERY_ART[art](ctx, s); },
  /** Engraved brass plaque. */
  plaque(ctx, s, title) {
    const g = ctx.createLinearGradient(0, 0, 0, s); g.addColorStop(0, '#c9a24a'); g.addColorStop(1, '#7a5a1a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = '#5a3e10'; ctx.lineWidth = s * 0.03; ctx.strokeRect(s * 0.03, s * 0.12, s * 0.94, s * 0.76);
    ctx.fillStyle = '#2a1a06'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    let size = Math.round(s * 0.2);
    ctx.font = `bold ${size}px Georgia, serif`;
    while (ctx.measureText(title).width > s * 0.9 && size > 8) { size -= 2; ctx.font = `bold ${size}px Georgia, serif`; }
    ctx.fillText(title, s / 2, s / 2);
  },
  /** Square parquet blocks, alternating direction (ballroom / exhibition). */
  parquet(ctx, s) {
    const n = 4, b = s / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const vertical = (i + j) % 2 === 0;
      for (let k = 0; k < 4; k++) {
        ctx.fillStyle = jitter('#5a3a22', 0.35);
        if (vertical) ctx.fillRect(i * b + k * b / 4, j * b, b / 4 - 1, b - 1);
        else ctx.fillRect(i * b, j * b + k * b / 4, b - 1, b / 4 - 1);
      }
    }
  },
  /** Herringbone planks (library, study, master bedroom). */
  herringbone(ctx, s) {
    // Larger, darker walnut blocks laid in a herringbone (ref 04, 07, 11).
    ctx.fillStyle = '#1e120a'; ctx.fillRect(0, 0, s, s);
    const w = s / 6, l = s / 2.4;
    for (let row = -2; row < 10; row++) for (let col = -2; col < 8; col++) {
      const x = col * w * 2 + (row % 2) * w, y = row * w;
      ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4);
      ctx.fillStyle = jitter('#4a2e1c', 0.22); ctx.fillRect(0, 0, l, w - 2); grain(ctx, 0, 0, l, w - 2, '#140a04', 2);
      ctx.restore();
      ctx.save(); ctx.translate(x + w, y); ctx.rotate(-Math.PI / 4);
      ctx.fillStyle = jitter('#3e2616', 0.22); ctx.fillRect(-l, 0, l, w - 2); grain(ctx, -l, 0, l, w - 2, '#140a04', 2);
      ctx.restore();
    }
  },
  /** Long floor boards (corridor, guest room, nursery, conservation lab). */
  planks(ctx, s) {
    // Dark walnut boards with subtle grain (refs 03, 05, 06).
    const rows = 5, h = s / rows;
    ctx.fillStyle = '#140a05'; ctx.fillRect(0, 0, s, s);
    for (let r = 0; r < rows; r++) {
      let x = -rnd() * s * 0.5;
      while (x < s) {
        const len = s * (0.45 + rnd() * 0.55);
        ctx.fillStyle = jitter('#3a2416', 0.18);
        ctx.fillRect(x, r * h + 1, len - 2, h - 2);
        grain(ctx, x, r * h, len, h, '#0e0703', 5);
        x += len;
      }
    }
  },
  /** Checkered marble (grand foyer / portrait gallery). */
  marble(ctx, s) {
    const n = 4, b = s / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      ctx.fillStyle = (i + j) % 2 ? jitter('#d8d4cc', 0.06) : jitter('#3a3a40', 0.1);
      ctx.fillRect(i * b, j * b, b, b);
      ctx.strokeStyle = (i + j) % 2 ? 'rgba(120,120,130,0.35)' : 'rgba(200,200,210,0.18)';
      for (let v = 0; v < 3; v++) {
        ctx.beginPath();
        ctx.moveTo(i * b + rnd() * b, j * b);
        ctx.bezierCurveTo(i * b + rnd() * b, j * b + b * 0.4, i * b + rnd() * b, j * b + b * 0.6, i * b + rnd() * b, j * b + b);
        ctx.stroke();
      }
    }
  },
  /** Worn stone flags (sculpture vault, exit passage). */
  stone(ctx, s) {
    ctx.fillStyle = '#2e2f35'; ctx.fillRect(0, 0, s, s);
    const rows = 4, h = s / rows;
    for (let r = 0; r < rows; r++) {
      let x = r % 2 ? -h / 2 : 0;
      while (x < s) {
        const w = h * (0.9 + rnd() * 0.7);
        ctx.fillStyle = jitter('#6a6b72', 0.18);
        ctx.fillRect(x + 2, r * h + 2, w - 4, h - 4);
        x += w;
      }
    }
  },
  tile(ctx, s) { PAINTERS.stone(ctx, s); },
  /** Walnut wall paneling with raised panels and a picture rail. */
  walnut(ctx, s) {
    ctx.fillStyle = '#3a2416'; ctx.fillRect(0, 0, s, s);
    const cols = 2;
    for (let c = 0; c < cols; c++) {
      const x = c * s / cols;
      ctx.fillStyle = jitter('#4e3220', 0.2);
      ctx.fillRect(x + 8, 10, s / cols - 16, s * 0.55);
      ctx.fillRect(x + 8, s * 0.62, s / cols - 16, s * 0.34);
      ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 3;
      ctx.strokeRect(x + 12, 14, s / cols - 24, s * 0.55 - 8);
      ctx.strokeRect(x + 12, s * 0.62 + 4, s / cols - 24, s * 0.34 - 8);
      grain(ctx, x, 0, s / cols, s, '#1a0d05', 10);
    }
  },
  /** Olive plaster above a dark wainscot (grand foyer). */
  olive(ctx, s) {
    ctx.fillStyle = '#4a4a2e'; ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 400; i++) { ctx.fillStyle = `rgba(0,0,0,${rnd() * 0.05})`; ctx.fillRect(rnd() * s, rnd() * s, 6, 6); }
    ctx.fillStyle = '#3a2416'; ctx.fillRect(0, s * 0.68, s, s * 0.32);
    ctx.fillStyle = '#6d5320'; ctx.fillRect(0, s * 0.66, s, 5);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 3;
    ctx.strokeRect(10, s * 0.72, s / 2 - 20, s * 0.24); ctx.strokeRect(s / 2 + 10, s * 0.72, s / 2 - 20, s * 0.24);
  },
  /** Gothic stone blocks (sculpture vault, conservation lab, cellar). */
  stonewall(ctx, s) {
    ctx.fillStyle = '#34353c'; ctx.fillRect(0, 0, s, s);
    const rows = 6, h = s / rows;
    for (let r = 0; r < rows; r++) {
      let x = r % 2 ? -h : 0;
      while (x < s) {
        const w = h * (1.6 + rnd() * 0.8);
        ctx.fillStyle = jitter('#5d5e66', 0.16);
        ctx.fillRect(x + 2, r * h + 2, w - 4, h - 4);
        x += w;
      }
    }
  },
  /** Blue damask wallpaper (guest bedroom, ref 05). */
  damask(ctx, s) {
    // Blue damask (ref 05): a soft diamond lattice with small fleurons, low contrast.
    ctx.fillStyle = '#2e3e62'; ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(190,170,130,0.18)'; ctx.lineWidth = 2;
    const n = 4, b = s / n;
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
      const cx = i * b, cy = j * b * 0.8;
      ctx.beginPath(); ctx.moveTo(cx, cy - b * 0.3); ctx.quadraticCurveTo(cx + b * 0.22, cy, cx, cy + b * 0.3); ctx.quadraticCurveTo(cx - b * 0.22, cy, cx, cy - b * 0.3); ctx.stroke();
      ctx.fillStyle = 'rgba(190,170,130,0.14)'; ctx.beginPath(); ctx.arc(cx + b / 2, cy + b * 0.4, 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#2a1a10'; ctx.fillRect(0, s * 0.8, s, s * 0.2);
    ctx.fillStyle = '#6d5320'; ctx.fillRect(0, s * 0.8, s, 3);
  },
  /** Faded nursery wallpaper with small motifs (spare bedroom, ref 06). */
  nursery(ctx, s) {
    // Faded nursery paper (ref 06): soft blue stripes with tiny stars, gently stained.
    ctx.fillStyle = '#3a4866'; ctx.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 32) { ctx.fillStyle = 'rgba(220,210,190,0.08)'; ctx.fillRect(x, 0, 12, s * 0.8); }
    ctx.fillStyle = 'rgba(230,210,160,0.22)';
    for (let i = 0; i < 40; i++) { const x = rnd() * s, y = rnd() * s * 0.78; ctx.beginPath(); for (let k = 0; k < 5; k++) { const a = k * 1.2566 - Math.PI / 2; ctx.lineTo(x + Math.cos(a) * 3, y + Math.sin(a) * 3); ctx.lineTo(x + Math.cos(a + 0.628) * 1.3, y + Math.sin(a + 0.628) * 1.3); } ctx.fill(); }
    for (let i = 0; i < 6; i++) { ctx.fillStyle = 'rgba(0,0,0,0.08)'; ctx.fillRect(rnd() * s, rnd() * s * 0.7, 40 + rnd() * 60, 60 + rnd() * 60); }
    ctx.fillStyle = '#2e2014'; ctx.fillRect(0, s * 0.8, s, s * 0.2);
  },
  /** Deep red silk walls (dining ref 08). */
  red(ctx, s) {
    ctx.fillStyle = '#5a1618'; ctx.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 16) { ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(x, 0, 6, s); }
  },
  /** Gilded mirror panels (hall of mirrors / ballroom ref 09). */
  mirror(ctx, s) {
    ctx.fillStyle = '#3a2a18'; ctx.fillRect(0, 0, s, s);
    const g = ctx.createLinearGradient(0, 0, s, s);
    g.addColorStop(0, '#8a96a8'); g.addColorStop(0.5, '#cfd6de'); g.addColorStop(1, '#6f7a8a');
    ctx.fillStyle = '#b08a3a'; ctx.fillRect(s * 0.08, s * 0.06, s * 0.84, s * 0.7);
    ctx.fillStyle = g; ctx.fillRect(s * 0.12, s * 0.1, s * 0.76, s * 0.62);
  },
  /** Ornate rug: border bands and a central medallion. */
  rug(ctx, s, color = '#6e1c24') {
    // Persian-style rug: dark field, fine lozenge lattice, narrow borders, small medallion.
    ctx.fillStyle = color; ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(200,160,100,0.22)'; ctx.lineWidth = 1.5;
    for (let i = -s; i < 2 * s; i += 18) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + s, s); ctx.stroke(); ctx.beginPath(); ctx.moveTo(i + s, 0); ctx.lineTo(i, s); ctx.stroke(); }
    for (let i = 0; i < 160; i++) { ctx.fillStyle = `rgba(${rnd() < 0.5 ? '210,170,110' : '40,50,90'},${0.1 + rnd() * 0.15})`; ctx.fillRect(rnd() * s, rnd() * s, 3, 3); }
    const bands = [['#1a1428', 10], ['#9a7440', 3], [color, 8], ['#9a7440', 2]];
    let inset = 4;
    for (const [c, w] of bands) { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.strokeRect(inset + w / 2, inset + w / 2, s - 2 * inset - w, s - 2 * inset - w); inset += w; }
    ctx.fillStyle = 'rgba(154,116,64,0.35)';
    ctx.beginPath(); ctx.moveTo(s / 2, s * 0.36); ctx.lineTo(s * 0.62, s / 2); ctx.lineTo(s / 2, s * 0.64); ctx.lineTo(s * 0.38, s / 2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(26,20,40,0.55)';
    ctx.beginPath(); ctx.moveTo(s / 2, s * 0.43); ctx.lineTo(s * 0.56, s / 2); ctx.lineTo(s / 2, s * 0.57); ctx.lineTo(s * 0.44, s / 2); ctx.closePath(); ctx.fill();
  },
  /** Rows of leather book spines (library, study). */
  books(ctx, s) {
    ctx.fillStyle = '#20120a'; ctx.fillRect(0, 0, s, s);
    const shelves = 5, h = s / shelves;
    for (let r = 0; r < shelves; r++) {
      let x = 2;
      while (x < s - 4) {
        const w = 6 + rnd() * 10, bh = h * (0.7 + rnd() * 0.25);
        ctx.fillStyle = jitter(['#6e1c1c', '#1c3a2a', '#2a2a4a', '#6a4a1c', '#3a1c10'][Math.floor(rnd() * 5)], 0.3);
        ctx.fillRect(x, r * h + (h - bh) - 4, w - 1, bh);
        ctx.fillStyle = 'rgba(210,170,90,0.5)'; ctx.fillRect(x + 1, r * h + (h - bh) + 6, w - 3, 2);
        x += w;
      }
      ctx.fillStyle = '#3a2416'; ctx.fillRect(0, r * h + h - 4, s, 4);
    }
  },
  /** A dark old-master portrait in a gilt frame. `variant` changes the sitter. */
  portrait(ctx, s, variant = 0) {
    const hues = ['#3a2a20', '#2a2a36', '#302418', '#1e2a24', '#36202a', '#2a2418'];
    ctx.fillStyle = '#8a6a2a'; ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#5a4418'; ctx.fillRect(s * 0.05, s * 0.05, s * 0.9, s * 0.9);
    const g = ctx.createRadialGradient(s / 2, s * 0.4, s * 0.05, s / 2, s / 2, s * 0.6);
    g.addColorStop(0, '#5a4a36'); g.addColorStop(1, hues[variant % hues.length]);
    ctx.fillStyle = g; ctx.fillRect(s * 0.1, s * 0.1, s * 0.8, s * 0.8);
    // Sitter: shoulders, head, suggestion of clothing colour.
    const clothes = ['#1a1a22', '#5a1a1a', '#2a3a2a', '#d8cdb8', '#3a2a4a', '#1a2a3a'][variant % 6];
    ctx.fillStyle = clothes;
    ctx.beginPath(); ctx.ellipse(s / 2, s * 0.82, s * 0.28, s * 0.2, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = ['#c9a88a', '#8a6a52', '#e0c2a2', '#6a4a36', '#b8906e', '#d8b898'][(variant * 5) % 6];
    ctx.beginPath(); ctx.ellipse(s / 2, s * 0.45, s * 0.1, s * 0.13, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = ['#1a120a', '#3a2a1a', '#b8b0a0', '#0a0a0a', '#6a3a1a', '#2a1a0a'][(variant * 3) % 6];
    ctx.beginPath(); ctx.ellipse(s / 2, s * 0.38, s * 0.11, s * 0.08, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(s * 0.1, s * 0.1, s * 0.8, s * 0.8);
  },
  /** Moonlit leaded window (emissive). */
  window(ctx, s) {
    const g = ctx.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, '#1a2a4a'); g.addColorStop(1, '#0a1020');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = 'rgba(160,190,230,0.35)'; ctx.beginPath(); ctx.arc(s * 0.7, s * 0.25, s * 0.08, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 6;
    for (let x = s / 3; x < s; x += s / 3) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, s); ctx.stroke(); }
    for (let y = s / 4; y < s; y += s / 4) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(s, y); ctx.stroke(); }
    ctx.strokeStyle = '#4a4a4a'; ctx.lineWidth = 14; ctx.strokeRect(0, 0, s, s);
  },
  /** Firelight for hearths (emissive). */
  fire(ctx, s) {
    const g = ctx.createRadialGradient(s / 2, s, s * 0.05, s / 2, s * 0.7, s * 0.7);
    g.addColorStop(0, '#fff2a8'); g.addColorStop(0.35, '#ff8a1a'); g.addColorStop(0.7, '#7a1a04'); g.addColorStop(1, '#100404');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  },
  /** Velvet drape folds. */
  velvet(ctx, s, color = '#5e1420') {
    for (let x = 0; x < s; x += 8) {
      const t = 0.5 + 0.5 * Math.sin(x / 9);
      ctx.fillStyle = `rgba(0,0,0,${0.15 + 0.35 * t})`;
      ctx.fillRect(0, 0, s, s);
    }
    ctx.fillStyle = color; ctx.globalAlpha = 0.85; ctx.fillRect(0, 0, s, s); ctx.globalAlpha = 1;
    for (let x = 0; x < s; x += 8) { ctx.fillStyle = `rgba(0,0,0,${0.3 * (0.5 + 0.5 * Math.sin(x / 7))})`; ctx.fillRect(x, 0, 8, s); }
  },
  /** Quilted bedspread. */
  quilt(ctx, s, color = '#6e1c24') {
    ctx.fillStyle = color; ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(230,200,140,0.35)'; ctx.lineWidth = 2;
    for (let i = -s; i < s * 2; i += 24) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + s, s); ctx.stroke(); ctx.beginPath(); ctx.moveTo(i + s, 0); ctx.lineTo(i, s); ctx.stroke(); }
  },
};

/**
 * A repeating texture (cached). `key` picks a painter; extra args vary colour/variant.
 */
const UPRIGHT = new Set(['gallery', 'plaque', 'portrait']);

export function texture(device, key, ...args) {
  const id = [key, ...args].join(':');
  if (cache.has(id)) return cache.get(id);
  const size = key === 'gallery' ? 512 : key === 'plaque' ? 256 : key === 'portrait' || key === 'window' || key === 'fire' ? 128 : 256;
  const [c, ctx] = canvas(size);
  seed = 1337 + id.split('').reduce((a, ch) => a + ch.charCodeAt(0), 0);
  // Box faces map canvas row 0 to the bottom of the face: paint pictures and lettering
  // flipped so they read upright on the wall.
  if (UPRIGHT.has(key)) { ctx.translate(0, size); ctx.scale(1, -1); }
  PAINTERS[key](ctx, size, ...args);
  const t = new pc.Texture(device, { width: size, height: size, format: pc.PIXELFORMAT_RGBA8, mipmaps: true, anisotropy: 4, addressU: pc.ADDRESS_REPEAT, addressV: pc.ADDRESS_REPEAT });
  t.setSource(c);
  cache.set(id, t);
  return t;
}
