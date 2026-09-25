// Validates every clip in PlayCanvas-Handoff/audio/manifest.json: file exists, is non-empty,
// probes as the expected codec, fully decodes without errors, and roughly matches the
// manifest duration. Writes tools/audio/audio-report.json.
//
// Usage: FFMPEG=path/to/ffmpeg FFPROBE=path/to/ffprobe node tools/audio/validate-audio.mjs
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const handoff = join(root, 'PlayCanvas-Handoff');
const ffmpeg = process.env.FFMPEG || 'ffmpeg';
const ffprobe = process.env.FFPROBE || 'ffprobe';
const manifest = JSON.parse(readFileSync(join(handoff, 'audio', 'manifest.json'), 'utf8'));

function probe(file) {
  const out = execFileSync(ffprobe, ['-v', 'error', '-show_entries',
    'format=duration:stream=codec_name,sample_rate,channels', '-of', 'json', file]);
  const j = JSON.parse(out);
  const s = j.streams?.[0] ?? {};
  return { codec: s.codec_name, sampleRate: Number(s.sample_rate), channels: s.channels,
    duration: Number(j.format?.duration) };
}

function decodeErrors(file) {
  const r = spawnSync(ffmpeg, ['-v', 'error', '-i', file, '-f', 'null', '-'], { encoding: 'utf8' });
  return r.status === 0 ? r.stderr.trim() : `exit ${r.status}: ${r.stderr.trim()}`;
}

function check(relPath, codec, expected) {
  const file = join(handoff, relPath);
  if (!existsSync(file)) return { path: relPath, ok: false, problem: 'missing' };
  const size = statSync(file).size;
  if (size === 0) return { path: relPath, ok: false, size, problem: 'empty (0 bytes)' };
  try {
    const p = probe(file);
    const errors = decodeErrors(file);
    const problems = [];
    if (p.codec !== codec) problems.push(`codec ${p.codec}, expected ${codec}`);
    if (errors) problems.push(`decode: ${errors.split('\n')[0]}`);
    if (Math.abs(p.duration - expected) > 0.35) problems.push(`duration ${p.duration.toFixed(2)}s vs manifest ${expected}s`);
    return { path: relPath, ok: problems.length === 0, size, ...p, problem: problems.join('; ') || undefined };
  } catch (e) {
    return { path: relPath, ok: false, size, problem: `probe failed: ${e.message.split('\n')[0]}` };
  }
}

const results = [];
for (const c of manifest.clips) {
  results.push({ id: `${c.character}/${c.event}`, mp3: check(c.mp3, 'mp3', c.duration_s), ogg: check(c.ogg, 'vorbis', c.duration_s) });
}

// Files on disk that the manifest does not mention.
const listed = new Set(manifest.clips.flatMap(c => [c.mp3, c.ogg]));
const walk = d => readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
const unlisted = walk(join(handoff, 'audio')).map(f => relative(handoff, f).replaceAll('\\', '/'))
  .filter(f => /\.(mp3|ogg)$/.test(f) && !listed.has(f));

const bad = results.flatMap(r => [r.mp3, r.ogg]).filter(x => !x.ok);
const report = { checkedAt: new Date().toISOString(), manifestClips: manifest.clips.length,
  filesChecked: results.length * 2, failures: bad.length, unlisted, failuresDetail: bad, clips: results };
writeFileSync(join(root, 'tools', 'audio', 'audio-report.json'), JSON.stringify(report, null, 2));
console.log(`clips ${manifest.clips.length}, files ${results.length * 2}, failures ${bad.length}, unlisted ${unlisted.length}`);
for (const b of bad) console.log(`  FAIL ${b.path}: ${b.problem}`);
process.exitCode = bad.length ? 1 : 0;
