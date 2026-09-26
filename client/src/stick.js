// Thumb stick for direct movement. A gentle push walks (quiet); pushing all the way runs
// (faster, but heard much further away). Desktop: WASD / arrow keys walk, hold Shift to run.
// Reports { x, y, s }: x right, y up (screen), s = deflection 0..1.

export const RUN_AT = 0.72;   // same threshold as the server (TUNING.steerRunThreshold)

export class Stick {
  constructor(root, onChange) {
    this.root = root;
    this.base = root.querySelector('.stick-base');
    this.knob = root.querySelector('.stick-knob');
    this.label = root.querySelector('.stick-label');
    this.onChange = onChange;
    this.pointer = null;
    this.value = { x: 0, y: 0, s: 0 };
    this.keys = new Set();
    this.bind();
  }

  bind() {
    const start = e => {
      if (this.pointer !== null) return;
      this.pointer = e.pointerId;
      this.root.setPointerCapture?.(e.pointerId);
      this.move(e);
      e.preventDefault();
    };
    const end = e => {
      if (e.pointerId !== this.pointer) return;
      this.pointer = null;
      this.set(0, 0);
    };
    this.root.addEventListener('pointerdown', start);
    this.root.addEventListener('pointermove', e => { if (e.pointerId === this.pointer) this.move(e); });
    this.root.addEventListener('pointerup', end);
    this.root.addEventListener('pointercancel', end);
    this.root.addEventListener('contextmenu', e => e.preventDefault());
    const KEYS = { KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0] };
    const key = (e, down) => {
      if (e.target.closest?.('input, textarea')) return;
      if (!(e.code in KEYS) && e.code !== 'ShiftLeft' && e.code !== 'ShiftRight') return;
      if (down) this.keys.add(e.code); else this.keys.delete(e.code);
      if (this.pointer !== null || this.root.hidden) return;
      let x = 0, y = 0;
      for (const k of this.keys) if (KEYS[k]) { x += KEYS[k][0]; y += KEYS[k][1]; }
      const l = Math.hypot(x, y);
      const s = l ? (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 1 : 0.5) : 0;
      this.set(l ? x / l * s : 0, l ? y / l * s : 0);
      e.preventDefault();
    };
    window.addEventListener('keydown', e => key(e, true));
    window.addEventListener('keyup', e => key(e, false));
  }

  move(e) {
    const r = this.base.getBoundingClientRect();
    const radius = r.width / 2;
    let x = (e.clientX - (r.left + radius)) / radius;
    let y = -(e.clientY - (r.top + radius)) / radius;
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    this.set(x, y);
  }

  set(x, y) {
    const s = Math.min(1, Math.hypot(x, y));
    this.value = { x, y, s };
    const px = this.base.clientWidth / 2 * 0.62;
    this.knob.style.transform = `translate(${x * px}px, ${-y * px}px)`;
    const running = s >= RUN_AT, moving = s >= 0.12;
    this.root.classList.toggle('running', running);
    this.root.classList.toggle('moving', moving && !running);
    this.label.textContent = running ? 'Running · loud' : moving ? 'Walking · quiet' : '';
    this.onChange(this.value);
  }

  release() { this.pointer = null; this.keys.clear(); this.set(0, 0); }
}
