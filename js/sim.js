// Egg physics for OMURICE.EXE.
//
// Everything here is plain numbers on grids so it can run headless in Node
// for tuning. Units: millimetres for thickness/height, °C for temperature,
// seconds for time. "Doneness" is 0 (raw liquid) .. 1 (fully set, dry);
// ~0.5 is the custardy hanjuku interior a Kichi-style omelette wants.

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const sstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const lerp = (a, b, t) => a + (b - a) * t;

// Small deterministic RNG so a run is reproducible in tests.
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export function bilinear(f, W, H, x, y) {
  if (x < 0) x = 0; else if (x > W - 1.001) x = W - 1.001;
  if (y < 0) y = 0; else if (y > H - 1.001) y = H - 1.001;
  const i = x | 0, j = y | 0, fx = x - i, fy = y - j, k = j * W + i;
  const a = f[k] + (f[k + 1] - f[k]) * fx;
  const b = f[k + W] + (f[k + W + 1] - f[k + W]) * fx;
  return a + (b - a) * fy;
}

// Shallow-water style viscous flow on a heightfield. `h` is fluid thickness,
// `z` the floor, `mob` per-cell mobility (0 = set solid, 1 = raw liquid).
// Fluid thinner than `hmin` doesn't move (surface tension holds the edge).
// Scalars in `scal` travel with the fluid, mass weighted.
export class Flow {
  constructor(W, H, nScal) {
    this.W = W; this.H = H;
    const n = W * H;
    this.fx = new Float32Array(n);
    this.fy = new Float32Array(n);
    this.out = new Float32Array(n);
    this.C = [];
    for (let s = 0; s < nScal; s++) this.C.push(new Float32Array(n));
  }
  step(h, z, mob, mask, scal, dt, K, hmin) {
    const { W, H, fx, fy, out, C } = this;
    const n = W * H;
    out.fill(0);
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const k = j * W + i;
        fx[k] = 0; fy[k] = 0;
        if (!mask[k]) continue;
        if (i < W - 1 && mask[k + 1]) {
          const d = h[k] + z[k] - h[k + 1] - z[k + 1];
          const up = d > 0 ? k : k + 1;
          const hu = h[up] - hmin;
          if (hu > 0) {
            const f = Math.min(K * mob[up] * hu * dt, 0.2) * d;
            fx[k] = f;
            if (f > 0) out[k] += f; else out[k + 1] -= f;
          }
        }
        if (j < H - 1 && mask[k + W]) {
          const d = h[k] + z[k] - h[k + W] - z[k + W];
          const up = d > 0 ? k : k + W;
          const hu = h[up] - hmin;
          if (hu > 0) {
            const f = Math.min(K * mob[up] * hu * dt, 0.2) * d;
            fy[k] = f;
            if (f > 0) out[k] += f; else out[k + W] -= f;
          }
        }
      }
    }
    // Never move more than most of what a cell holds.
    for (let k = 0; k < n; k++) {
      const o = out[k];
      out[k] = o > h[k] * 0.45 ? (h[k] * 0.45) / o : 1;
    }
    for (let s = 0; s < scal.length; s++) {
      const S = scal[s], c = C[s];
      for (let k = 0; k < n; k++) c[k] = S[k] * h[k];
    }
    for (let k = 0; k < n; k++) {
      let f = fx[k];
      if (f !== 0) {
        const src = f > 0 ? k : k + 1, dst = f > 0 ? k + 1 : k;
        const m = Math.abs(f) * out[src];
        h[src] -= m; h[dst] += m;
        for (let s = 0; s < scal.length; s++) {
          const v = m * scal[s][src];
          C[s][src] -= v; C[s][dst] += v;
        }
      }
      f = fy[k];
      if (f !== 0) {
        const src = f > 0 ? k : k + W, dst = f > 0 ? k + W : k;
        const m = Math.abs(f) * out[src];
        h[src] -= m; h[dst] += m;
        for (let s = 0; s < scal.length; s++) {
          const v = m * scal[s][src];
          C[s][src] -= v; C[s][dst] += v;
        }
      }
    }
    for (let s = 0; s < scal.length; s++) {
      const S = scal[s], c = C[s];
      for (let k = 0; k < n; k++) if (h[k] > 1e-4) S[k] = c[k] / h[k];
    }
  }
}

/* ------------------------------------------------------------------ */
/* Bowl: crack three eggs and beat them.                               */
/* ------------------------------------------------------------------ */

export const BN = 64;
export class Bowl {
  constructor(seed = 7) {
    const N = BN; this.N = N;
    this.c = (N - 1) / 2; this.R = N * 0.46;
    const n = N * N;
    this.yk = new Float32Array(n);   // yolk share; 1 = evenly beaten
    this.h = new Float32Array(n);    // liquid depth for display
    this.foam = new Float32Array(n);
    this.tmp = new Float32Array(n);
    this.tmp2 = new Float32Array(n);
    this.mask = new Uint8Array(n);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      this.mask[j * N + i] = Math.hypot(i - this.c, j - this.c) < this.R ? 1 : 0;
    }
    this.eggs = 0;
    this.rand = rng(seed);
    this.shells = []; // {x,y} fragments floating in the bowl
    this.yolks = [];  // intact yolks {x,y,r,intact}
    this.std0 = 0;
    this.whiskWork = 0;
    this.norm = 1;
  }
  crack(x, y) {
    if (this.eggs >= 3) return null;
    const N = this.N, c = this.c;
    // Keep the yolk inside the pool.
    const dx = x - c, dy = y - c, r = Math.hypot(dx, dy), lim = this.R * 0.55;
    if (r > lim) { x = c + (dx / r) * lim; y = c + (dy / r) * lim; }
    this.eggs++;
    const yr = 5.2;
    this.yolks.push({ x, y, r: yr, intact: 1 });
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i;
      if (!this.mask[k]) continue;
      this.h[k] = 4 * this.eggs;
      const d = Math.hypot(i - x, j - y);
      if (d < yr) this.yk[k] = Math.max(this.yk[k], 3.0 * sstep(yr, yr - 1.2, d));
    }
    let shell = null;
    if (this.rand() < 0.3) {
      const a = this.rand() * 6.28;
      shell = { x: x + Math.cos(a) * 8, y: y + Math.sin(a) * 8, rot: this.rand() * 6.28 };
      this.shells.push(shell);
    }
    this.norm = 1 / Math.max(0.05, this.mean());
    if (this.eggs === 3) this.std0 = this.std();
    return { shell };
  }
  removeShellAt(x, y) {
    const i = this.shells.findIndex(s => Math.hypot(s.x - x, s.y - y) < 4.5);
    if (i >= 0) { this.shells.splice(i, 1); return true; }
    return false;
  }
  mean() {
    let s = 0, m = 0;
    for (let k = 0; k < this.yk.length; k++) if (this.mask[k]) { s += this.yk[k]; m++; }
    return s / m;
  }
  std() {
    const mu = this.mean();
    let s = 0, m = 0;
    for (let k = 0; k < this.yk.length; k++) if (this.mask[k]) { const d = this.yk[k] - mu; s += d * d; m++; }
    return Math.sqrt(s / m);
  }
  mixedness() {
    if (this.eggs < 3 || !this.std0) return 0;
    return clamp(1 - this.std() / this.std0, 0, 1);
  }
  foamLevel() {
    let s = 0, m = 0;
    for (let k = 0; k < this.foam.length; k++) if (this.mask[k]) { s += this.foam[k]; m++; }
    return s / m;
  }
  // Whisk stroke at (x,y) moving (vx,vy) cells/s.
  whisk(x, y, vx, vy, dt) {
    if (!this.eggs) return;
    const N = this.N, yk = this.yk, t = this.tmp;
    const speed = Math.hypot(vx, vy);
    if (speed < 2) return;
    const rb = 9;
    // Breaking a yolk takes a firm stroke through it.
    for (const Y of this.yolks) {
      if (Y.intact > 0 && Math.hypot(Y.x - x, Y.y - y) < Y.r + 2) Y.intact = Math.max(0, Y.intact - speed * dt * 0.05);
    }
    t.set(yk);
    const before = this.mean();
    const lim = this.R - 1.2, c = this.c;
    const x0 = Math.max(0, Math.floor(x - rb)), x1 = Math.min(N - 1, Math.ceil(x + rb));
    const y0 = Math.max(0, Math.floor(y - rb)), y1 = Math.min(N - 1, Math.ceil(y + rb));
    const disp = Math.min(speed * dt, rb * 0.7);
    const ux = vx / speed, uy = vy / speed;
    for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) {
      const k = j * N + i;
      if (!this.mask[k]) continue;
      const d = Math.hypot(i - x, j - y);
      if (d >= rb) continue;
      // Is this cell inside an intact yolk? Then it doesn't smear yet.
      let held = 0;
      for (const Y of this.yolks) if (Y.intact > 0.01 && Math.hypot(i - Y.x, j - Y.y) < Y.r) held = Y.intact;
      const w = (1 - d / rb) ** 2 * (1 - held);
      // Whisk tines drag liquid and shear it (a swirl around the tip).
      const sx = i - ux * disp * w * 1.6 + (j - y) * 0.18 * w * Math.sign(vx * (j - y) - vy * (i - x) || 1);
      const sy = j - uy * disp * w * 1.6 - (i - x) * 0.18 * w * Math.sign(vx * (j - y) - vy * (i - x) || 1);
      let qx = sx, qy = sy;
      const dc = Math.hypot(qx - c, qy - c);
      if (dc > lim) { qx = c + ((qx - c) * lim) / dc; qy = c + ((qy - c) * lim) / dc; }
      const v = bilinear(t, N, N, qx, qy);
      // Tines also chop the liquid: local diffusion.
      const mixAmt = clamp(speed * dt * 0.012 * w, 0, 0.5);
      const avg = (t[k - 1] + t[k + 1] + t[k - N] + t[k + N]) * 0.25;
      yk[k] = v + (avg - v) * mixAmt;
      this.foam[k] = Math.min(1, this.foam[k] + Math.max(0, speed - 110) * 0.00002 * w);
    }
    // Conserve yolk.
    const after = this.mean();
    if (after > 0) { const f = before / after; for (let k = 0; k < yk.length; k++) yk[k] *= f; }
    this.whiskWork += speed * dt;
    for (const s of this.shells) {
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < rb) { s.x += ux * disp * 0.5 * (1 - d / rb); s.y += uy * disp * 0.5 * (1 - d / rb); }
      const dc = Math.hypot(s.x - this.c, s.y - this.c);
      if (dc > this.R - 3) { s.x = this.c + (s.x - this.c) * (this.R - 3) / dc; s.y = this.c + (s.y - this.c) * (this.R - 3) / dc; }
    }
  }
  step(dt) {
    // Foam settles slowly; yolk diffuses a little on its own.
    for (let k = 0; k < this.foam.length; k++) this.foam[k] *= 1 - dt * 0.04;
    for (const Y of this.yolks) {
      if (Y.intact > 0) continue;
    }
  }
  // Sample the beaten egg as it leaves the bowl (a spiral through the bowl,
  // which is roughly how a bowl empties when tipped and swirled).
  pourSample(frac) {
    const a = frac * 23, r = this.R * (0.15 + 0.7 * ((frac * 3.7) % 1));
    return this.norm * bilinear(this.yk, this.N, this.N, this.c + Math.cos(a) * r, this.c + Math.sin(a) * r);
  }
}

/* ------------------------------------------------------------------ */
/* Pan: butter, heat, pour, stir, tilt, roll.                           */
/* ------------------------------------------------------------------ */

export const PN = 84;
export const KNOB_TEMPS = [22, 135, 180, 245]; // off, low, medium, high: where the pan settles
export const EGG_ML = 150;                     // three large eggs

export class Pan {
  constructor(seed = 3) {
    const N = PN; this.N = N;
    const n = N * N;
    this.c = (N - 1) / 2;
    this.R = N * 0.47;                  // pan interior radius in cells
    this.cs = 200 / (2 * this.R);       // 20 cm cooking surface -> mm per cell
    this.cellArea = this.cs * this.cs;
    this.h = new Float32Array(n);
    this.dm = new Float32Array(n);      // bulk doneness
    this.db = new Float32Array(n);      // bottom skin doneness
    this.cu = new Float32Array(n);      // curd (stirred, broken-up set egg)
    this.br = new Float32Array(n);      // browning of the underside
    this.yk = new Float32Array(n);      // yolk share carried from the bowl
    this.mob = new Float32Array(n);
    this.z = new Float32Array(n);
    this.zb = new Float32Array(n);
    this.mask = new Uint8Array(n);
    this.copies = [0, 0, 0, 0, 0, 0].map(() => new Float32Array(n));
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i, r = Math.hypot(i - this.c, j - this.c);
      this.mask[k] = r < this.R - 0.5 ? 1 : 0;
      // Flat floor that curves up into the wall.
      this.zb[k] = r > this.R * 0.8 ? ((r - this.R * 0.8) / (this.R * 0.2)) ** 2 * 9 : 0;
    }
    this.flow = new Flow(N, N, 4);
    this.rand = rng(seed);

    this.T = 24;
    this.knob = 0;
    this.butter = 0;        // grams in pan
    this.butterMelt = 0;    // 0..1
    this.butterWater = 0;   // 0..1 of butter's water still to boil off (the foam)
    this.butterBrown = 0;   // 0..1+
    this.tiltY = 0;         // 0..1 forward tilt (far edge down)
    this.tiltX = 0;         // -1..1 side tilt
    this.time = 0;
    this.pourTime = null;
    this.pourLeft = 0;
    this.pourTotal = 0;
    this.pourX = this.c; this.pourY = this.c;
    this.bowl = null;
    this.shellsInEgg = 0;
    this.rollR = 0;
    this.rolling = false;
    this.rollTaps = 0;
    this.tears = 0;
    this.creases = 0;
    this.lastTap = -9;
    this.smoke = 0;
    this.stats = {
      pourTemp: null, butterAtPour: null,
      stirEarly: 0, stirMid: 0, stirLate: 0,
      atRoll: null, maxT: 24,
    };
  }

  setKnob(k) { this.knob = k; }

  addButter() {
    if (this.butter >= 30) return false;
    // A cold pat on a pan: the new butter dilutes any browning.
    const g = 10;
    this.butterBrown = (this.butterBrown * this.butter) / (this.butter + g);
    this.butterWater = (this.butterWater * this.butter + 1 * g) / (this.butter + g);
    this.butterMelt = (this.butterMelt * this.butter) / (this.butter + g);
    this.butter += g;
    return true;
  }

  butterState() {
    if (!this.butter) return 'none';
    if (this.butterBrown > 0.75) return 'burnt';
    if (this.butterBrown > 0.25) return 'brown';
    if (this.butterMelt < 0.95) return 'melting';
    if (this.butterWater > 0.12) return this.T > 105 ? 'foaming' : 'melted';
    return 'clear';
  }

  startPour(bowl, x = this.c, y = this.c) {
    if (this.pourTime !== null) return;
    this.bowl = bowl;
    this.pourTime = this.time;
    this.pourTotal = (EGG_ML * 1000) / this.cellArea;
    this.pourLeft = this.pourTotal;
    this.pourX = x; this.pourY = y;
    this.shellsInEgg = bowl ? bowl.shells.length : 0;
    this.stats.pourTemp = this.T;
    this.stats.butterAtPour = {
      g: this.butter, melt: this.butterMelt, water: this.butterWater,
      brown: this.butterBrown, state: this.butterState(),
    };
  }

  get poured() { return this.pourTime !== null; }
  get pouring() { return this.pourLeft > 0; }
  cookTime() { return this.poured ? this.time - this.pourTime : 0; }

  aggregate() {
    const { h, dm, db, cu, br, mask } = this;
    let M = 0, sdm = 0, sdb = 0, scu = 0, sbr = 0, scu2 = 0, cov = 0, cells = 0;
    let sx = 0, sy = 0, minJ = 1e9, maxJ = -1, minI = 1e9, maxI = -1;
    const N = this.N;
    for (let k = 0; k < h.length; k++) {
      if (!mask[k]) continue;
      cells++;
      const m = h[k];
      if (m < 0.15) continue;
      cov++;
      M += m; sdm += m * dm[k]; sdb += m * db[k]; scu += m * cu[k]; scu2 += m * cu[k] * cu[k]; sbr += m * br[k];
      const i = k % N, j = (k / N) | 0;
      sx += m * i; sy += m * j;
      if (m > 0.6) { if (j < minJ) minJ = j; if (j > maxJ) maxJ = j; if (i < minI) minI = i; if (i > maxI) maxI = i; }
    }
    if (!M) return { mass: 0, dm: 0, db: 0, cu: 0, cuStd: 0, br: 0, cover: 0, cx: this.c, cy: this.c, minJ: this.c, maxJ: this.c, minI: this.c, maxI: this.c };
    const cuM = scu / M;
    return {
      mass: M, dm: sdm / M, db: sdb / M, cu: cuM, cuStd: Math.sqrt(Math.max(0, scu2 / M - cuM * cuM)),
      br: sbr / M, cover: cov / cells, cx: sx / M, cy: sy / M, minJ, maxJ, minI, maxI,
    };
  }

  // Spatula / chopsticks dragged through the pan.
  stir(x, y, vx, vy, dt) {
    if (!this.poured || this.rolling) return 0;
    const speed = Math.hypot(vx, vy);
    if (speed < 3) return 0;
    const N = this.N, rb = 4.2;
    const { h, dm, db, cu, br, yk, mask } = this;
    const F = [h, dm, db, cu, br, yk];
    for (let f = 0; f < 6; f++) this.copies[f].set(F[f]);
    const [ch, cdm, cdb, ccu, cbr, cyk] = this.copies;
    const ux = vx / speed, uy = vy / speed;
    const disp = Math.min(speed * dt, rb * 0.8);
    const x0 = Math.max(1, Math.floor(x - rb - 1)), x1 = Math.min(N - 2, Math.ceil(x + rb + 1));
    const y0 = Math.max(1, Math.floor(y - rb - 1)), y1 = Math.min(N - 2, Math.ceil(y + rb + 1));
    let before = 0, after = 0, work = 0;
    for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) {
      const k = j * N + i;
      if (!mask[k]) continue;
      before += h[k];
      const d = Math.hypot(i - x, j - y);
      if (d >= rb) continue;
      const w = (1 - d / rb) ** 1.5;
      // Set egg drags less freely than liquid.
      const drag = 0.55 + 0.45 * (1 - sstep(0.4, 1, ch[k] > 0.1 ? cdm[k] : 0));
      const sx = i - ux * disp * w * drag, sy = j - uy * disp * w * drag;
      h[k] = bilinear(ch, N, N, sx, sy);
      const ndm = bilinear(cdm, N, N, sx, sy), ndb = bilinear(cdb, N, N, sx, sy);
      cu[k] = bilinear(ccu, N, N, sx, sy);
      br[k] = bilinear(cbr, N, N, sx, sy);
      yk[k] = bilinear(cyk, N, N, sx, sy);
      // Scraping lifts the set bottom into the body and lets raw egg
      // reach the hot metal. That's what makes small, soft curds.
      const a = clamp((speed / 45) * w * dt * 7, 0, 0.85);
      const set = sstep(0.12, 0.6, ndb);
      dm[k] = ndm + (ndb - ndm) * a * 0.55;
      db[k] = ndb + (ndm - ndb) * a;
      cu[k] = Math.min(1, cu[k] + a * set * 1.3);
      // Curds break into smaller pieces under fast strokes; a late stir
      // tears the skin you need for rolling (db drops above).
      work += a * (h[k] > 0.2 ? 1 : 0);
    }
    for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) {
      const k = j * N + i;
      if (!mask[k]) { h[k] = 0; continue; }
      after += h[k];
    }
    if (after > 0) {
      const s = before / after;
      for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) h[j * N + i] *= s;
    }
    const agg = this._lastAgg;
    const phaseDm = agg ? agg.dm : 0;
    const wk = work * 0.0006;
    if (phaseDm < 0.32) this.stats.stirEarly += wk;
    else if (phaseDm < 0.45) this.stats.stirMid += wk;
    else this.stats.stirLate += wk;
    return work;
  }

  // Fist tap on the handle while the pan is tilted: the omelette folds
  // over itself toward the far lip.
  tap() {
    if (!this.poured || this.pouring) return { ok: false, why: 'empty' };
    if (this.rollR >= 1) return { ok: false, why: 'done' };
    const agg = this.aggregate();
    if (this.tiltY < 0.3) {
      this.lastTap = this.time;
      return { ok: false, why: 'flat' };
    }
    if (!this.rolling) {
      this.rolling = true;
      this.stats.atRoll = { ...agg, t: this.cookTime(), T: this.T };
    }
    const quick = this.time - this.lastTap < 0.18;
    this.lastTap = this.time;
    this.rollTaps++;
    const step = 0.15 + this.tiltY * 0.08;
    this.rollR = Math.min(1, this.rollR + step);
    // Skin strength: a set bottom holds; raw egg or a stuck pan tears.
    const skin = sstep(0.35, 0.8, agg.db);
    const slick = this.stats.butterAtPour && this.stats.butterAtPour.g >= 10 ? 1 : this.stats.butterAtPour && this.stats.butterAtPour.g > 0 ? 0.8 : 0.5;
    let tear = (1 - skin * slick) * 0.55;
    // Overcooked egg is stiff and cracks instead of folding.
    let crease = Math.max(0, agg.dm - 0.8) * 1.6;
    if (quick) tear += 0.08;
    tear *= 0.6 + 0.8 * this.rand();
    crease *= 0.6 + 0.8 * this.rand();
    this.tears += tear;
    this.creases += crease;
    return { ok: true, tear, crease, R: this.rollR };
  }

  step(dt) {
    this.time += dt;
    const target = KNOB_TEMPS[this.knob];
    const tau = this.knob > 0 ? 11 : 35;
    let dT = (target - this.T) / tau;
    const agg = (this._lastAgg = this._aggTick > 0 ? this._lastAgg : this.aggregate());
    this._aggTick = (this._aggTick || 0) > 0 ? this._aggTick - 1 : 6;
    // Wet egg pulls heat out of the metal.
    if (agg.mass > 0) dT -= agg.cover * (this.T - 45) * 0.03 * (1 - 0.5 * clamp(agg.dm, 0, 1));
    this.T += dT * dt;
    if (this.T > this.stats.maxT) this.stats.maxT = this.T;

    // Butter.
    if (this.butter > 0 && !this.poured) {
      if (this.T > 32) this.butterMelt = Math.min(1, this.butterMelt + ((this.T - 30) / 110) * 0.45 * dt);
      if (this.butterMelt > 0.6 && this.T > 100) this.butterWater = Math.max(0, this.butterWater - ((this.T - 98) / 60) * 0.045 * dt);
      if (this.butterWater < 0.25 && this.T > 145) this.butterBrown += ((this.T - 145) / 45) * 0.04 * dt * (1.2 - this.butterWater * 2);
    }
    this.smoke = clamp((this.T - 205) / 50, 0, 1) * (this.butter > 0 && !this.poured ? 1 : 0.4) + (this.butterBrown > 0.8 && !this.poured ? 0.5 : 0);

    // Pouring.
    if (this.pourLeft > 0) {
      const rate = this.pourTotal / 1.5;
      const dv = Math.min(this.pourLeft, rate * dt);
      this.pourLeft -= dv;
      const frac = 1 - this.pourLeft / this.pourTotal;
      const ykIn = this.bowl ? this.bowl.pourSample(frac) : 1;
      const N = this.N, rp = 3.2;
      const px = this.pourX + Math.sin(this.time * 9) * 1.2, py = this.pourY + Math.cos(this.time * 7) * 1.2;
      let wsum = 0;
      const cells = [];
      for (let j = Math.floor(py - rp); j <= Math.ceil(py + rp); j++) for (let i = Math.floor(px - rp); i <= Math.ceil(px + rp); i++) {
        const k = j * N + i;
        if (!this.mask[k]) continue;
        const d = Math.hypot(i - px, j - py);
        if (d > rp) continue;
        const w = 1 - d / rp;
        wsum += w; cells.push([k, w]);
      }
      for (const [k, w] of cells) {
        const add = (dv * w) / wsum;
        const hn = this.h[k] + add;
        const f = add / hn;
        this.dm[k] *= 1 - f; this.db[k] *= 1 - f; this.cu[k] *= 1 - f;
        this.yk[k] = this.yk[k] * (1 - f) + ykIn * f;
        this.h[k] = hn;
      }
      // Cold egg hitting the metal.
      this.T -= (32 * dv) / this.pourTotal;
      if (this.pourLeft <= 0 && this.stats.butterAtPour && this.stats.butterAtPour.brown > 0.2) {
        const b = this.stats.butterAtPour.brown * 0.25;
        for (let k = 0; k < this.br.length; k++) if (this.h[k] > 0.1) this.br[k] += b;
      }
    }

    // Cooking.
    const H = clamp((this.T - 70) / 100, 0, 2.6);
    const greasy = this.stats.butterAtPour ? (this.stats.butterAtPour.g >= 10 ? 1 : this.stats.butterAtPour.g > 0 ? 1.25 : 1.7) : 1;
    const rollSlow = this.rolling ? 0.55 : 1;
    const { h, dm, db, cu, br, yk, mob, mask, z, zb } = this;
    for (let k = 0; k < h.length; k++) {
      if (!mask[k]) continue;
      const m = h[k];
      if (m < 0.05) {
        if (m < 0.02) { db[k] = 0; br[k] = 0; cu[k] = 0; dm[k] = 0; }
        mob[k] = 1;
        continue;
      }
      db[k] = Math.min(1.7, db[k] + H * 0.2 * dt);
      dm[k] = Math.min(1.7, dm[k] + (H * 0.04 * dt * rollSlow) / (0.35 + m / 4.5));
      if (this.T > 160) br[k] += ((this.T - 160) / 60) * 0.09 * sstep(0.55, 1.1, db[k]) * dt * greasy;
      const liq = 1 - sstep(0.2, 0.68, dm[k]);
      mob[k] = liq * liq * (1 - 0.55 * sstep(0.5, 1, db[k]));
    }

    // Flow (frozen once the omelette is being rolled).
    if (this.poured && !this.rolling) {
      const N = this.N, s = this.cs * 0.75;
      // Forward tilt drops the far edge (small j, top of the screen).
      const tx = this.tiltX * s, ty = this.tiltY * s * 1.15;
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const k = j * N + i;
        z[k] = zb[k] + (i - this.c) * tx + (j - this.c) * ty;
      }
      const sub = 8, sdt = dt / sub;
      // Beaten egg is thick: it flows slowly and keeps a rounded edge
      // ~2 mm high instead of thinning out to a film.
      for (let s2 = 0; s2 < sub; s2++) this.flow.step(h, z, mob, mask, [dm, cu, yk, br], sdt, 6, 1.5);
    }
  }

  // Interior carry-over once it's on the rice.
  restDoneness(agg) { return agg.dm; }
}

/* ------------------------------------------------------------------ */
/* Scoring                                                              */
/* ------------------------------------------------------------------ */

const band = (x, lo, hi, soft) => {
  if (x >= lo && x <= hi) return 1;
  const d = x < lo ? lo - x : x - hi;
  return clamp(1 - d / soft, 0, 1);
};

export function scoreRun(r) {
  // r: { mix, foam, shells, pan, plateOffset (cm), dmFinal, rolledR }
  const lines = [];
  const add = (key, label, pts, max, note) => lines.push({ key, label, pts: Math.round(clamp(pts, 0, max) * 10) / 10, max, note });
  const pan = r.pan, bp = pan.stats.butterAtPour || { g: 0, state: 'none', brown: 0 };
  const atRoll = pan.stats.atRoll || pan.aggregate();

  // The inside is what the dish is about: 45 points.
  const d = r.dmFinal;
  {
    let p;
    if (d >= 0.45 && d <= 0.6) p = 45;
    else if (d > 0.6) p = 45 * (1 - sstep(0.6, 0.84, d));
    else p = 45 * (1 - sstep(0.45, 0.2, d));
    let note;
    if (d < 0.25) note = 'Raw. It ran straight off the rice and flooded the plate.';
    else if (d < 0.38) note = 'Too wet. Thin egg ran down the rice and pooled on the plate.';
    else if (d < 0.45) note = 'Slightly loose, a little ran off. Very close.';
    else if (d <= 0.6) note = 'Golden, glossy, custardy. It slid open and coated the rice. Perfect hanjuku.';
    else if (d < 0.7) note = 'A touch overcooked. It opened, but the centre had already set.';
    else if (d < 0.82) note = 'Overcooked. Pale and firm inside, it barely flowed.';
    else note = 'Cooked solid. It just split in two. That is not omurice.';
    add('inside', 'The inside', p, 45, note);
  }
  // Prep.
  {
    let p = 5 * sstep(0.55, 0.93, r.mix);
    let note = r.mix > 0.93 ? 'Beaten smooth.' : r.mix > 0.75 ? 'Streaks of white left in.' : 'Barely beaten. You can see the whites.';
    if (r.foam > 0.35) { p -= 1; note += ' Too much air whipped in.'; }
    if (r.shells > 0) { p -= 2 * r.shells; note += ` Crunch. ${r.shells > 1 ? 'Shell pieces' : 'A piece of shell'} in the pan.`; }
    add('prep', 'Beating', p, 5, note);
  }
  // Heat & butter.
  {
    const T = pan.stats.pourTemp ?? 20;
    const band = (x, lo, hi, soft) => (x >= lo && x <= hi ? 1 : clamp(1 - (x < lo ? lo - x : x - hi) / soft, 0, 1));
    let p = 6 * band(T, 150, 190, 45);
    let note = T < 110 ? `Cold pan (${Math.round(T)}°C). The egg stewed.` : T < 150 ? `A little cool at ${Math.round(T)}°C.` : T <= 190 ? `Pan at ${Math.round(T)}°C. Good sizzle.` : `Scorching pan (${Math.round(T)}°C).`;
    let b = 0;
    if (bp.g >= 10 && bp.g <= 20) b += 2; else if (bp.g > 0) b += 1;
    if (bp.state === 'foaming' || bp.state === 'clear') b += 2;
    else if (bp.state === 'melted' || bp.state === 'melting') b += 1;
    if (bp.state === 'brown') b -= 0.5;
    if (bp.state === 'burnt') b -= 2;
    if (bp.g === 0) note += ' No butter.';
    else if (bp.state === 'burnt') note += ' Burnt butter.';
    else if (bp.state === 'brown') note += ' The butter had browned.';
    else if (bp.state === 'foaming') note += ' Poured on foaming butter.';
    add('heat', 'Heat & butter', p + b, 10, note);
  }
  // Curds.
  {
    const band = (x, lo, hi, soft) => (x >= lo && x <= hi ? 1 : clamp(1 - (x < lo ? lo - x : x - hi) / soft, 0, 1));
    const cuQ = band(atRoll.cu, 0.3, 0.85, 0.3);
    const early = sstep(0.4, 2.2, pan.stats.stirEarly + pan.stats.stirMid * 0.6);
    let p = 10 * (0.55 * cuQ + 0.45 * early) - 5 * sstep(0.3, 2.0, pan.stats.stirLate);
    const note = atRoll.cu < 0.12 ? 'Never scrambled. A flat sheet, not soft curds.' : pan.stats.stirLate > 1.0 ? 'Kept stirring after it set and broke the skin.' : atRoll.cu < 0.3 ? 'Big, uneven curds.' : 'Small, soft curds.';
    add('curds', 'Scramble', p, 10, note);
  }
  // Outside colour.
  {
    const brF = pan.aggregate().br;
    const p = 10 * (1 - sstep(0.04, 0.45, brF));
    const note = brF < 0.06 ? 'Pale yellow outside. No browning.' : brF < 0.2 ? 'Light browning on the outside.' : brF < 0.45 ? 'Brown patches outside.' : 'Browned like a pancake.';
    add('color', 'Outside colour', p, 10, note);
  }
  // The fold.
  {
    const R = r.rolledR;
    let p = 15 * (0.5 * sstep(0.4, 1, R) + 0.5) - Math.min(7, pan.tears * 4.5) - Math.min(5, pan.creases * 4);
    if (R < 0.4) p = Math.min(p, 4);
    let note = R < 0.4 ? 'Never folded. It went on the rice flat.' : R < 0.99 ? 'Half folded. Lopsided.' : 'Tapped into a neat football.';
    if (pan.tears > 0.6) note += ' The skin tore.'; else if (pan.tears > 0.25) note += ' A small tear.';
    if (pan.creases > 0.4) note += ' It cracked as it folded.';
    add('fold', 'The fold', p, 15, note);
  }
  // Placement.
  {
    const off = r.plateOffset;
    add('plate', 'Placement', 5 * (1 - sstep(0.5, 3.5, off)), 5, off < 0.8 ? 'Dead centre on the rice.' : off < 2 ? 'Slightly off centre.' : 'Off to the side.');
  }
  let total = Math.round(lines.reduce((s2, l) => s2 + l.pts, 0));
  // A solid egg can't pass, however good the rest was.
  if (d >= 0.82) total = Math.min(total, 55);
  if (d < 0.25) total = Math.min(total, 60);
  return { total: clamp(total, 0, 100), lines };
}
