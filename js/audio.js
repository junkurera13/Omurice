// Kitchen sounds, all synthesised: sizzle, crack, handle taps, the knife,
// and a couple of Windows-ish chimes.
export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try { this.muted = localStorage.getItem('omu-muted') === '1'; } catch {}
  }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = (this.ctx = new AC());
    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(c.destination);
    // Looping noise for the sizzle.
    const len = c.sampleRate * 2;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    const src = c.createBufferSource();
    src.buffer = buf; src.loop = true;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2200;
    const bp = c.createBiquadFilter(); bp.type = 'peaking'; bp.frequency.value = 5200; bp.gain.value = 6;
    this.sizzleGain = c.createGain(); this.sizzleGain.gain.value = 0;
    src.connect(hp); hp.connect(bp); bp.connect(this.sizzleGain); this.sizzleGain.connect(this.master);
    src.start();
    // Burner hiss.
    const src2 = c.createBufferSource(); src2.buffer = buf; src2.loop = true; src2.playbackRate.value = 0.7;
    const lp = c.createBiquadFilter(); lp.type = 'bandpass'; lp.frequency.value = 900; lp.Q.value = 0.6;
    this.hissGain = c.createGain(); this.hissGain.gain.value = 0;
    src2.connect(lp); lp.connect(this.hissGain); this.hissGain.connect(this.master);
    src2.start();
  }
  setMuted(m) {
    this.muted = m;
    try { localStorage.setItem('omu-muted', m ? '1' : '0'); } catch {}
    if (this.master) this.master.gain.value = m ? 0 : 0.8;
  }
  sizzle(level, crackle) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.sizzleGain.gain.setTargetAtTime(Math.min(0.5, level * 0.35), t, 0.08);
    if (crackle > 0 && Math.random() < crackle * 0.5) this.pop(0.03 + Math.random() * 0.06);
  }
  hiss(level) {
    if (!this.ctx) return;
    this.hissGain.gain.setTargetAtTime(level * 0.05, this.ctx.currentTime, 0.2);
  }
  burst(dur, freq, q, vol, type = 'bandpass') {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  pop(v) { this.burst(0.03, 3000 + Math.random() * 3000, 2, v); }
  crack() { this.burst(0.06, 1800, 1.5, 0.7); setTimeout(() => this.burst(0.05, 900, 2, 0.35), 50); }
  plop() { this.tone(180, 0.12, 'sine', 0.25, 90); }
  tap() { this.tone(110, 0.09, 'triangle', 0.5, 60); this.burst(0.05, 600, 1, 0.25); }
  scrape() { this.burst(0.08, 2600, 3, 0.05); }
  knife() { this.burst(0.35, 4200, 4, 0.18); }
  tone(f, dur, type, vol, fEnd) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
    if (fEnd) o.frequency.exponentialRampToValueAtTime(fEnd, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  chord(notes, step = 0.09, dur = 0.9, type = 'triangle', vol = 0.18) {
    if (!this.ctx) return;
    notes.forEach((n, i) => setTimeout(() => this.tone(440 * Math.pow(2, (n - 69) / 12), dur, type, vol), i * step * 1000));
  }
  tada() { this.chord([60, 64, 67, 72, 76], 0.08, 1.2); }
  fail() { this.chord([64, 60, 55], 0.16, 0.7, 'square', 0.08); }
  ding() { this.chord([76, 83], 0.07, 0.4, 'sine', 0.2); }
}
