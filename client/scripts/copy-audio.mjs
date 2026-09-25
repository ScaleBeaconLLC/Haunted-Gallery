// Copies the 52 validated voice auditions (MP3 + OGG) and the manifest from the handoff
// pack into client/public/audio so Vite serves them. The handoff folder stays the source.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', '..', 'PlayCanvas-Handoff', 'audio');
const dest = join(here, '..', 'public', 'audio');
if (!existsSync(src)) {
  console.warn(`[audio] ${src} not found; the game will run without voice clips.`);
  process.exit(0);
}
mkdirSync(dest, { recursive: true });
cpSync(join(src, 'MP3'), join(dest, 'MP3'), { recursive: true });
cpSync(join(src, 'OGG'), join(dest, 'OGG'), { recursive: true });
const manifest = JSON.parse(readFileSync(join(src, 'manifest.json'), 'utf8'));
// Paths in the manifest are relative to the handoff folder ("audio/MP3/..."), which matches /audio/... here.
writeFileSync(join(dest, 'manifest.json'), JSON.stringify(manifest));
console.log(`[audio] copied ${manifest.clips.length} clips`);
