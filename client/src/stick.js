// Desktop keyboard steering (the on-screen thumb stick is gone: phones tap where to go).
// WASD / arrow keys walk relative to the camera (quiet); hold Shift to run (heard much further).
// Reports { x, y, s }: x right, y up (screen), s = strength 0..1 (>= RUN_AT runs).

export const RUN_AT = 0.72;   // same threshold as the server (TUNING.steerRunThreshold)

const KEYS = { KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0] };

export class KeyboardSteer {
  constructor(onChange) {
    this.onChange = onChange;
    this.value = { x: 0, y: 0, s: 0 };
    this.keys = new Set();
    const key = (e, down) => {
      if (e.target.closest?.('input, textarea')) return;
      if (!(e.code in KEYS) && e.code !== 'ShiftLeft' && e.code !== 'ShiftRight') return;
      if (down) this.keys.add(e.code); else this.keys.delete(e.code);
      let x = 0, y = 0;
      for (const k of this.keys) if (KEYS[k]) { x += KEYS[k][0]; y += KEYS[k][1]; }
      const l = Math.hypot(x, y);
      const s = l ? (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 1 : 0.5) : 0;
      this.set(l ? x / l * s : 0, l ? y / l * s : 0);
      if (e.code in KEYS) e.preventDefault();
    };
    window.addEventListener('keydown', e => key(e, true));
    window.addEventListener('keyup', e => key(e, false));
    window.addEventListener('blur', () => this.release());
  }

  set(x, y) {
    this.value = { x, y, s: Math.min(1, Math.hypot(x, y)) };
    this.onChange(this.value);
  }

  release() { this.keys.clear(); this.set(0, 0); }
}
