// Touch/mouse gestures on the 3D view, classified before anything happens:
//   tap (< 10 px, < 300 ms)       -> onTap(x, y, { double })   (double: a second tap within 350 ms / 32 px)
//   one-finger drag               -> onDrag(dx, dy)             (look around in first person, a small pan overhead)
//   two-finger pinch              -> onPinchEnd(scale, cx, cy)  (< 1 fingers closed = zoom out, > 1 spread = zoom in)
//   mouse wheel                   -> onWheel(dir, x, y)         (desktop: -1 zoom in, +1 zoom out)
// Coordinates are CSS pixels relative to the viewport.

const TAP_MOVE = 10, TAP_MS = 300, DOUBLE_MS = 350, DOUBLE_PX = 32;

export class Gestures {
  constructor(el, handlers) {
    this.el = el;
    this.h = handlers;
    this.pointers = new Map();
    this.pinch = null;        // { d0, scale, cx, cy }
    this.suppress = false;    // after a pinch, no tap/drag until every finger is up
    this.lastTap = null;
    this.bind();
  }

  bind() {
    const el = this.el;
    el.addEventListener('pointerdown', e => this.down(e));
    el.addEventListener('pointermove', e => this.move(e));
    el.addEventListener('pointerup', e => this.up(e, false));
    el.addEventListener('pointercancel', e => this.up(e, true));
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('wheel', e => {
      e.preventDefault();
      const now = performance.now();
      if (now - (this.lastWheel || 0) < 350) return;   // one step per flick
      this.lastWheel = now;
      this.h.onWheel?.(Math.sign(e.deltaY), e.clientX, e.clientY);
    }, { passive: false });
  }

  down(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.pointers.set(e.pointerId, { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: e.timeStamp, drag: false });
    try { this.el.setPointerCapture?.(e.pointerId); } catch { /* synthetic or already released pointer */ }
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), scale: 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      this.suppress = true;
    } else if (this.pointers.size > 2) this.suppress = true;
  }

  move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (this.pinch && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch.scale = Math.hypot(a.x - b.x, a.y - b.y) / this.pinch.d0;
      this.pinch.cx = (a.x + b.x) / 2; this.pinch.cy = (a.y + b.y) / 2;
      this.h.onPinch?.(this.pinch.scale);
      return;
    }
    if (this.suppress || this.pointers.size !== 1) return;
    if (!p.drag && Math.hypot(p.x - p.x0, p.y - p.y0) >= TAP_MOVE) p.drag = true;
    if (p.drag) this.h.onDrag?.(dx, dy);
  }

  up(e, cancelled) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    if (this.pinch && this.pointers.size < 2) {
      const { scale, cx, cy } = this.pinch;
      this.pinch = null;
      this.h.onPinchEnd?.(scale, cx, cy);
    }
    if (this.suppress) { if (!this.pointers.size) this.suppress = false; return; }
    if (cancelled) return;
    if (p.drag) { this.h.onDragEnd?.(); return; }
    // Event timestamps, not handler time: a busy frame must not turn a quick tap into a slow one.
    const dt = e.timeStamp - p.t0;
    if (dt > TAP_MS || Math.hypot(e.clientX - p.x0, e.clientY - p.y0) >= TAP_MOVE) return;
    const now = e.timeStamp;
    const last = this.lastTap;
    const double = !!last && now - last.t < DOUBLE_MS && Math.hypot(e.clientX - last.x, e.clientY - last.y) < DOUBLE_PX;
    this.lastTap = double ? null : { t: now, x: e.clientX, y: e.clientY };
    this.h.onTap?.(e.clientX, e.clientY, { double, pointerType: e.pointerType });
  }
}
