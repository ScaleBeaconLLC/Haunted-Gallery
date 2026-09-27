// Break-free struggle: a full-screen tap zone while the server's view says you are caught.
// Progress is the SERVER's count (got / need); local taps only give instant feedback pulses.
// The phone sends the cumulative tap count for this grab on the first tap, then at most
// every 150 ms (the last count always goes out).

const SEND_MS = 150;

export class StruggleOverlay {
  constructor(root, { send, now, buzz, totalMs = 2700 }) {
    this.root = root;
    this.total = totalMs;
    this.send = send;
    this.now = now;
    this.buzz = buzz;
    this.state = null;        // view.me.struggle
    this.grabId = null;
    this.n = 0;
    this.lastSent = 0; this.sentN = 0; this.timer = 0;
    root.innerHTML = `
      <div class="st-zone" aria-hidden="true"></div>
      <div class="st-center">
        <svg class="st-ring" viewBox="0 0 120 120" aria-hidden="true">
          <circle class="st-track" cx="60" cy="60" r="52"/>
          <circle class="st-prog" cx="60" cy="60" r="52" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/>
        </svg>
        <div class="st-tap">TAP!</div>
      </div>
      <div class="st-label" role="status">Break free! Tap as fast as you can</div>
      <div class="st-time"><i></i></div>`;
    this.prog = root.querySelector('.st-prog');
    this.tapEl = root.querySelector('.st-tap');
    this.timeBar = root.querySelector('.st-time i');
    this.label = root.querySelector('.st-label');
    // Every finger that lands counts (two thumbs drum faster than one).
    root.addEventListener('pointerdown', e => { e.preventDefault(); this.tap(); });
    root.addEventListener('contextmenu', e => e.preventDefault());
    root.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
  }

  get active() { return !!this.state; }

  /** Called with every view: show, update or hide. */
  update(struggle) {
    if (!struggle) {
      if (this.state) this.hide();
      return;
    }
    if (struggle.grabId !== this.grabId) {
      this.grabId = struggle.grabId; this.n = 0; this.sentN = 0; this.lastSent = 0;
      clearTimeout(this.timer);
      this.label.textContent = 'Break free! Tap as fast as you can';
      this.buzz?.([60]);
    }
    this.state = struggle;
    this.root.hidden = false;
    document.body.classList.add('struggling');
    const k = Math.max(0, Math.min(1, (struggle.got ?? 0) / Math.max(1, struggle.need ?? 1)));
    this.prog.style.strokeDashoffset = String(100 - k * 100);
  }

  hide() {
    this.state = null;
    this.root.hidden = true;
    document.body.classList.remove('struggling');
    clearTimeout(this.timer);
  }

  tap() {
    if (!this.state) return;
    this.n += 1;
    this.tapEl.classList.remove('pulse');
    void this.tapEl.offsetWidth;          // restart the pulse animation
    this.tapEl.classList.add('pulse');
    this.flush();
  }

  flush() {
    if (!this.state || this.n === this.sentN) return;
    const t = performance.now();
    const wait = this.lastSent ? SEND_MS - (t - this.lastSent) : 0;
    if (wait > 0) {
      if (!this.timer) this.timer = setTimeout(() => { this.timer = 0; this.flush(); }, wait);
      return;
    }
    this.lastSent = t; this.sentN = this.n;
    this.send({ grabId: this.grabId, n: this.n });
  }

  /** Per frame: the time left until the server's deadline. */
  frame() {
    if (!this.state) return;
    const left = Math.max(0, (this.state.until ?? 0) - this.now());
    this.timeBar.style.transform = `scaleX(${Math.min(1, left / this.total).toFixed(3)})`;
  }
}
