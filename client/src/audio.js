// Web Audio mixer for phones.
//  - Voice auditions: MP3 with OGG fallback, one voice per character, priority
//    quiet < discovery < grabbed < bite; a higher priority interrupts the current line.
//  - Spatial: equal-power panner + distance attenuation relative to the camera.
//  - Separate buses for voice / zombie cue / Foley / ambience, into a limiter.
// The zombie discovery cue, bite Foley and ambience are NOT in the handoff pack; the
// synthesized sounds below are clearly-marked PLACEHOLDERS until real assets exist.

const PRIORITY = { quiet: 1, discovery: 2, grabbed: 3, bite: 4 };

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.manifest = null;
    this.buffers = new Map();
    this.loading = new Map();
    this.voices = new Map(); // character -> { src, priority, panner }
    this.listener = { x: 0, z: 0, yaw: 0 };
    this.ext = 'mp3';
    this.enabled = true;
  }

  /** Must run inside a user gesture on iOS. */
  async unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { this.enabled = false; return; }
      this.ctx = new AC();
      const c = this.ctx;
      this.limiter = c.createDynamicsCompressor();
      this.limiter.threshold.value = -10; this.limiter.knee.value = 6; this.limiter.ratio.value = 12;
      this.limiter.attack.value = 0.003; this.limiter.release.value = 0.2;
      this.master = c.createGain(); this.master.gain.value = 0.9;
      this.master.connect(this.limiter).connect(c.destination);
      this.bus = {};
      for (const [name, gain] of Object.entries({ voice: 1, cue: 0.7, foley: 0.8, ambience: 0.25, ui: 0.5 })) {
        this.bus[name] = c.createGain(); this.bus[name].gain.value = gain; this.bus[name].connect(this.master);
      }
      const probe = document.createElement('audio');
      this.ext = probe.canPlayType('audio/mpeg') ? 'mp3' : 'ogg';
      this.startAmbience();
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  async loadManifest() {
    try {
      this.manifest = await (await fetch('/audio/manifest.json')).json();
    } catch { this.manifest = { clips: [] }; }
  }

  clipUrl(character, event) {
    const clip = this.manifest?.clips.find(c => c.character === character && c.event === event);
    if (!clip) return null;
    return '/' + (this.ext === 'mp3' ? clip.mp3 : clip.ogg);
  }

  async buffer(url) {
    if (this.buffers.has(url)) return this.buffers.get(url);
    if (!this.loading.has(url)) {
      this.loading.set(url, (async () => {
        const data = await (await fetch(url)).arrayBuffer();
        const buf = await new Promise((res, rej) => this.ctx.decodeAudioData(data, res, rej));
        this.buffers.set(url, buf);
        return buf;
      })().catch(() => null));
    }
    return this.loading.get(url);
  }

  preloadCharacters(ids) {
    if (!this.ctx || !this.manifest) return;
    for (const id of ids) for (const ev of Object.keys(PRIORITY)) {
      const url = this.clipUrl(id, ev);
      if (url) this.buffer(url);
    }
  }

  setListener(x, z, yawDeg) { this.listener = { x, z, yaw: yawDeg * Math.PI / 180 }; }

  spatial(x, z, bus, gain = 1) {
    const c = this.ctx;
    const g = c.createGain();
    const p = c.createStereoPanner ? c.createStereoPanner() : null;
    const dx = x - this.listener.x, dz = z - this.listener.z;
    const dist = Math.hypot(dx, dz);
    // Distance attenuation: full within 3 m, fading to ~15% at 20 m.
    g.gain.value = gain * Math.max(0.15, Math.min(1, 3 / Math.max(3, dist)));
    if (p) {
      const angle = Math.atan2(dx, dz) - this.listener.yaw;
      p.pan.value = Math.max(-0.8, Math.min(0.8, Math.sin(angle)));
      g.connect(p).connect(this.bus[bus]);
    } else g.connect(this.bus[bus]);
    return g;
  }

  /** Play a character's line. Lower-priority speech from the same character is interrupted. */
  async voice(character, event, pos, { gain } = {}) {
    if (!this.ctx || !this.enabled) return;
    const pr = PRIORITY[event] ?? 1;
    const current = this.voices.get(character);
    if (current && current.priority > pr && current.playing) return;
    const url = this.clipUrl(character, event);
    if (!url) return;
    const buf = await this.buffer(url);
    if (!buf) return;
    const again = this.voices.get(character);
    if (again?.playing) { try { again.src.stop(); } catch { /* already stopped */ } }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    // Whispers sit well under projected cries; the limiter keeps screams safe.
    const level = gain ?? (event === 'quiet' ? 0.35 : event === 'discovery' ? 1 : 1.15);
    src.connect(this.spatial(pos[0], pos[1], 'voice', level));
    const entry = { src, priority: pr, playing: true };
    src.onended = () => { entry.playing = false; };
    this.voices.set(character, entry);
    src.start();
  }

  // ---------------------------------------------------------------- PLACEHOLDER synthesized effects
  noise(duration) {
    const c = this.ctx, len = Math.floor(c.sampleRate * duration);
    const b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  /** PLACEHOLDER zombie discovery cue (low filtered growl). Replace with a sourced asset. */
  zombieCue(pos) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.noise(1.4);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 260; f.Q.value = 8;
    const lfo = c.createOscillator(); lfo.frequency.value = 11;
    const lfoGain = c.createGain(); lfoGain.gain.value = 90; lfo.connect(lfoGain).connect(f.frequency);
    const env = c.createGain(); env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(1.4, t + 0.15); env.gain.exponentialRampToValueAtTime(0.01, t + 1.3);
    src.connect(f).connect(env).connect(this.spatial(pos[0], pos[1], 'cue'));
    src.start(t); lfo.start(t); src.stop(t + 1.4); lfo.stop(t + 1.4);
  }

  /** PLACEHOLDER bite Foley (wet crunch). Replace with licensed Foley. */
  biteFoley(pos) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.noise(0.35);
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 1.5;
    const env = c.createGain(); env.gain.setValueAtTime(1.2, t); env.gain.exponentialRampToValueAtTime(0.01, t + 0.3);
    src.connect(f).connect(env).connect(this.spatial(pos[0], pos[1], 'foley'));
    src.start(t);
  }

  /** PLACEHOLDER camera flash (shutter click + capacitor whine). */
  flash(pos) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const click = c.createBufferSource(); click.buffer = this.noise(0.05);
    const env = c.createGain(); env.gain.setValueAtTime(1, t); env.gain.exponentialRampToValueAtTime(0.01, t + 0.05);
    click.connect(env).connect(this.spatial(pos[0], pos[1], 'foley'));
    click.start(t);
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(2200, t + 0.05); o.frequency.exponentialRampToValueAtTime(7000, t + 1.2);
    const og = c.createGain(); og.gain.setValueAtTime(0.05, t + 0.05); og.gain.linearRampToValueAtTime(0, t + 1.2);
    o.connect(og).connect(this.bus.foley); o.start(t + 0.05); o.stop(t + 1.25);
  }

  /** PLACEHOLDER lockdown alarm. */
  alarm() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = 'square';
    const g = c.createGain(); g.gain.value = 0;
    for (let i = 0; i < 6; i++) {
      o.frequency.setValueAtTime(i % 2 ? 620 : 880, t + i * 0.35);
      g.gain.setValueAtTime(0.08, t + i * 0.35); g.gain.setValueAtTime(0.0, t + i * 0.35 + 0.3);
    }
    o.connect(g).connect(this.bus.ui); o.start(t); o.stop(t + 2.2);
  }

  ping() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.frequency.value = 880;
    const g = c.createGain(); g.gain.setValueAtTime(0.15, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g).connect(this.bus.ui); o.start(t); o.stop(t + 0.3);
  }

  /** PLACEHOLDER ambience: detuned low drone + filtered air. */
  startAmbience() {
    const c = this.ctx;
    const out = c.createGain(); out.gain.value = 0.5; out.connect(this.bus.ambience);
    for (const f of [55, 55.7, 82.4]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180;
      const g = c.createGain(); g.gain.value = 0.12;
      o.connect(lp).connect(g).connect(out); o.start();
    }
    const air = c.createBufferSource(); air.buffer = this.noise(4); air.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500; bp.Q.value = 0.6;
    const ag = c.createGain(); ag.gain.value = 0.05;
    air.connect(bp).connect(ag).connect(out); air.start();
  }
}
