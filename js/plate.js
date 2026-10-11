// The plate: ketchup rice, the omelette landing on it, the cut, and the
// opening. Rendered as a 3/4-view heightfield (column ray-casting, like an
// old voxel engine) so egg physically drapes over the dome of rice.
import { Flow, bilinear, clamp, sstep, lerp, rng } from './sim.js';

export const PG = 140;           // grid cells
const SPAN = 360;                // mm covered by the grid
const CS = SPAN / PG;            // mm per cell
const FINE = 4;                  // texture detail per cell
const RICE = { a: 80, b: 54, h: 46 }; // rice dome semi-axes and height (mm)
const PLATE_R = 132, RIM_IN = 112;

export class Plate {
  constructor(W, H) {
    this.W = W; this.H = H;
    const n = PG * PG;
    this.terrain = new Float32Array(n);
    this.egg = new Float32Array(n);    // egg thickness
    this.inner = new Float32Array(n);  // 0 = outer skin showing, 1 = custard interior showing
    this.runny = new Float32Array(n);  // loose raw egg flowing on top
    this.Z = new Float32Array(n);
    this.zFlow = new Float32Array(n);
    this.mob = new Float32Array(n).fill(1);
    this.mask = new Uint8Array(n);
    this.shade = new Float32Array(n);
    this.spec = new Float32Array(n);
    this.cutMark = new Float32Array(n);
    this.flow = new Flow(PG, PG, 0);
    for (let j = 0; j < PG; j++) for (let i = 0; i < PG; i++) {
      const k = j * PG + i, x = (i - PG / 2) * CS, y = (j - PG / 2) * CS;
      this.terrain[k] = terrainAt(x, y);
      this.mask[k] = Math.hypot(x, y) < PLATE_R + 6 ? 1 : 0;
    }
    this.buildTexture();
    // Screen projection.
    this.scale = Math.min(W / 300, H / 250);
    this.cx = W / 2; this.cy = H * 0.54;
    this.cache = document.createElement('canvas');
    this.cache.width = W; this.cache.height = H;
    this.cacheCtx = this.cache.getContext('2d');
    this.dirty = true;
    this.sy = this.scale * 0.6;   // depth squash
    this.sz = this.scale * 0.82;  // height lift
    this.img = new ImageData(W, H);
    this.ybuf = new Int32Array(W);
    this.bg = this.buildBackdrop();
    this.omelette = null;
    this.t = 0;
  }

  buildTexture() {
    const F = PG * FINE, r = rng(5);
    const tr = new Uint8ClampedArray(F * F), tg = new Uint8ClampedArray(F * F), tb = new Uint8ClampedArray(F * F);
    for (let j = 0; j < F; j++) for (let i = 0; i < F; i++) {
      const x = (i / FINE - PG / 2) * CS, y = (j / FINE - PG / 2) * CS, k = j * F + i;
      const d = Math.hypot(x, y);
      let R, G, B;
      if (d > PLATE_R) {
        // Red gingham tablecloth.
        const cx = Math.floor((x + 400) / 22) % 2, cy = Math.floor((y + 400) / 22) % 2;
        const both = cx && cy, one = cx ^ cy;
        R = both ? 196 : one ? 226 : 247; G = both ? 40 : one ? 128 : 240; B = both ? 46 : one ? 124 : 232;
        if (d < PLATE_R + 1) { R = 236; G = 236; B = 230; }
        const weave = ((i + j) % 3 === 0) ? -10 : 0;
        R += weave; G += weave; B += weave;
      } else {
        // White diner plate with a cobalt band.
        R = 246; G = 246; B = 241;
        if (d > RIM_IN + 6 && d < RIM_IN + 10) { R = 40; G = 72; B = 168; }
      }
      // Ketchup rice base under the grains.
      if ((x / RICE.a) ** 2 + (y / RICE.b) ** 2 < 1.0) { R = 196; G = 66; B = 36; }
      tr[k] = R; tg[k] = G; tb[k] = B;
    }
    // Rice grains: tinted with ketchup, scattered as little ellipses.
    const grains = 4200;
    for (let g = 0; g < grains; g++) {
      const ang = r() * Math.PI * 2, rr = Math.sqrt(r()) * 1.03;
      const x = Math.cos(ang) * rr * RICE.a, y = Math.sin(ang) * rr * RICE.b;
      const gi = (x / CS + PG / 2) * FINE, gj = (y / CS + PG / 2) * FINE;
      const rot = r() * Math.PI, L = (3.1 * FINE) / CS, Wd = L * 0.42;
      const ket = r();
      const base = ket < 0.15 ? [240, 150, 110] : ket < 0.9 ? [222, 78, 40] : [168, 40, 28];
      for (let a = -L; a <= L; a += 0.5) for (let b = -Wd; b <= Wd; b += 0.5) {
        if ((a * a) / (L * L) + (b * b) / (Wd * Wd) > 1) continue;
        const px = Math.round(gi + Math.cos(rot) * a - Math.sin(rot) * b);
        const py = Math.round(gj + Math.sin(rot) * a + Math.cos(rot) * b);
        if (px < 0 || py < 0 || px >= F || py >= F) continue;
        const k = py * F + px;
        const hl = 1 - Math.abs(b) / Wd;
        tr[k] = Math.min(255, base[0] + hl * 30); tg[k] = Math.min(255, base[1] + hl * 25); tb[k] = Math.min(255, base[2] + hl * 18);
      }
      // A few peas and onion bits.
      if (g % 160 === 0) {
        for (let a = -4; a <= 4; a++) for (let b = -4; b <= 4; b++) {
          if (a * a + b * b > 14) continue;
          const px = Math.round(gi + a), py = Math.round(gj + b);
          if (px < 0 || py < 0 || px >= F || py >= F) continue;
          const k = py * F + px;
          tr[k] = 92 + a * 3; tg[k] = 150 + b * 3; tb[k] = 50;
        }
      }
    }
    this.tex = { F, tr, tg, tb };
    // Curd noise for custard texture.
    const cn = new Float32Array(F * F);
    const gw = Math.ceil(F / 5) + 2, gv = new Float32Array(gw * gw).map(() => r());
    for (let j = 0; j < F; j++) for (let i = 0; i < F; i++) {
      const fx = i / 5, fy = j / 5, a = fx | 0, b = fy | 0;
      let tx = fx - a, ty = fy - b; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
      cn[j * F + i] = lerp(lerp(gv[b * gw + a], gv[b * gw + a + 1], tx), lerp(gv[(b + 1) * gw + a], gv[(b + 1) * gw + a + 1], tx), ty);
    }
    this.curdTex = cn;
  }

  buildBackdrop() {
    // Wall and counter behind the plate, painted once.
    const c = document.createElement('canvas');
    c.width = this.W; c.height = this.H;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, this.H);
    g.addColorStop(0, '#d9cdb4'); g.addColorStop(0.3, '#cdbf9f'); g.addColorStop(1, '#8f8068');
    x.fillStyle = g; x.fillRect(0, 0, this.W, this.H);
    // Subway tile.
    x.strokeStyle = 'rgba(120,105,80,0.35)'; x.lineWidth = 1;
    for (let yy = 0; yy < this.H * 0.4; yy += 18) {
      x.beginPath(); x.moveTo(0, yy + 0.5); x.lineTo(this.W, yy + 0.5); x.stroke();
      for (let xx = ((yy / 18) % 2) * 22; xx < this.W; xx += 44) { x.beginPath(); x.moveTo(xx + 0.5, yy); x.lineTo(xx + 0.5, yy + 18); x.stroke(); }
    }
    const d = x.getImageData(0, 0, this.W, this.H);
    return d.data;
  }

  // ---------- projection ----------
  project(xmm, ymm, zmm) {
    return [this.cx + xmm * this.scale, this.cy + ymm * this.sy - zmm * this.sz];
  }
  // Screen -> ground, assuming we hit the current surface.
  // March the view ray from the front of the table backwards and stop at
  // the first surface that covers this pixel (same rule the renderer uses).
  unproject(sx, sy) {
    const x = (sx - this.cx) / this.scale;
    let prev = null;
    for (let y = SPAN / 2 - 1; y > -SPAN / 2 + 1; y -= CS * 0.25) {
      const z = this.heightAt(x, y);
      const py = this.cy + y * this.sy - z * this.sz;
      if (py <= sy) {
        if (prev) { const t = (prev[1] - sy) / (prev[1] - py || 1); return [x, prev[0] + (y - prev[0]) * t]; }
        return [x, y];
      }
      prev = [y, py];
    }
    return [x, -SPAN / 2];
  }
  heightAt(x, y) {
    return bilinear(this.Z, PG, PG, x / CS + PG / 2, y / CS + PG / 2);
  }

  // ---------- omelette ----------
  place(o) {
    // o: {x, y, Lh, r0, w0, dm, br, cu, tears, creases}
    this.omelette = {
      ...o, s: 0, sv: 0, sTarget: 0, slit: null, openT: -1, wob: 0,
      runLeft: 0, runTotal: 0, drop: 1,
    };
    this._init = false;
    this.update(0);
  }

  cut(slit) {
    // slit: {u0, u1, off} in omelette frame (u -1..1, off in mm)
    const o = this.omelette;
    o.slit = slit;
    o.openT = 0;
    const d = o.dm;
    // How far it opens: a hanjuku centre slumps open, a firm one stays shut.
    let target;
    if (d < 0.3) target = 1.18;
    else if (d < 0.65) target = 1.0;
    else target = lerp(1.0, 0.12, sstep(0.65, 1.0, d));
    const cover = clamp((slit.u1 - slit.u0) / 1.7, 0, 1);
    o.sTarget = target * lerp(0.25, 1, cover);
    o.stiff = sstep(0.55, 1.0, d);
    // Loose egg that will run out of the middle.
    const runFrac = 0.04 + 0.75 * sstep(0.48, 0.15, d);
    o.runTotal = runFrac * 140000 / (CS * CS); // ~140 ml of egg; volume in cell units
    o.runLeft = o.runTotal * sstep(0.1, 0.6, cover);
  }

  update(dt) {
    this.t += dt;
    const o = this.omelette;
    // Only recompute while something is actually moving.
    const active = !this._init || (o && (o.drop > 0 || (o.openT >= 0 && o.openT < 7)));
    if (!active) return;
    this._init = true;
    const { egg, inner, runny, terrain, Z, zFlow, cutMark } = this;
    egg.fill(0); inner.fill(0);
    if (o) {
      if (o.drop > 0) o.drop = Math.max(0, o.drop - dt * 3.2);
      if (o.openT >= 0) {
        o.openT += dt;
        // Spring toward the open shape. Runny = under-damped jiggle.
        const k = 26, c = lerp(2.6, 11, o.stiff);
        const delay = o.openT < 0.25 ? 0 : 1;
        o.sv += (k * (o.sTarget - o.s) - c * o.sv) * dt * delay;
        o.s += o.sv * dt;
      }
      const s = clamp(o.s, 0, 1.3);
      const cosA = 1, sinA = 0;
      const jig = o.openT > 0 ? Math.exp(-o.openT / 0.9) * Math.sin(o.openT * 15) * 0.07 * (1 - o.stiff) : 0;
      for (let j = 0; j < PG; j++) for (let i = 0; i < PG; i++) {
        const k = j * PG + i, x = (i - PG / 2) * CS - o.x, y = (j - PG / 2) * CS - o.y;
        const u = (x * cosA + y * sinA) / o.Lh;
        if (Math.abs(u) >= 1) continue;
        const v = -x * sinA + y * cosA;
        const p = Math.sqrt(1 - u * u);
        const w0 = o.w0, W1 = 60;
        const off = o.slit ? o.slit.off * Math.min(1, s * 1.5) : 0;
        // Inside the cut range the omelette spreads; outside it stays a closed tip.
        const inCut = o.slit ? sstep(o.slit.u0 - 0.15, o.slit.u0 + 0.05, u) * sstep(o.slit.u1 + 0.15, o.slit.u1 - 0.05, u) : 0;
        const se = s * (0.35 + 0.65 * inCut);
        const w = lerp(w0, W1, se) * Math.pow(p, 0.55) * (1 + jig);
        const vv = v - off * inCut;
        if (Math.abs(vv) >= w) continue;
        const area = Math.PI * o.r0 * o.r0 * p * p * 0.9;
        const q = vv / w;
        let t = (area / (w * 1.4)) * Math.pow(1 - q * q, 0.75);
        // Custard in the open middle sits in soft, wet folds.
        const iwq = w * clamp(se * 0.72, 0, 0.8) * inCut;
        if (iwq > 1 && Math.abs(vv) < iwq) {
          const cn = this.curdTex[((j * FINE) | 0) * PG * FINE + ((i * FINE) | 0)];
          t += (o.cu || 0.4) * (cn - 0.5) * 4 * (1 - o.stiff * 0.5) * sstep(iwq, iwq * 0.6, Math.abs(vv));
        }
        // The slit itself: a groove before it opens.
        if (o.slit && inCut > 0.2 && s < 0.35) t *= 1 - 0.55 * sstep(2.5, 0, Math.abs(vv)) * inCut * (1 - s / 0.35);
        egg[k] = t;
        // Custard interior shows in the middle as it opens.
        const iw = w * clamp(se * 0.72, 0, 0.8) * inCut;
        inner[k] = iw > 0.5 ? sstep(iw, iw * 0.82, Math.abs(vv)) : 0;
        // Drop-in: the whole thing falls from above.
        if (o.drop > 0) egg[k] += 0;
      }
      // Run-off: loose egg seeps from the slit.
      if (o.runLeft > 0 && o.openT > 0.3) {
        const rate = o.runTotal / 1.8;
        const dv = Math.min(o.runLeft, rate * dt);
        o.runLeft -= dv;
        const cells = [];
        let ws = 0;
        for (let j = 0; j < PG; j++) for (let i = 0; i < PG; i++) {
          const k = j * PG + i;
          if (inner[k] > 0.6) { const w = inner[k]; cells.push(k); ws += w; }
        }
        for (const k of cells) runny[k] += (dv * inner[k]) / ws;
      }
    }
    this.dirty = true;
    for (let k = 0; k < Z.length; k++) zFlow[k] = terrain[k] + egg[k];
    if (o && o.openT > 0) {
      const sub = 3;
      for (let s = 0; s < sub; s++) this.flow.step(runny, zFlow, this.mob, this.mask, [], dt / sub, 1.2, 0.35);
    }
    for (let k = 0; k < Z.length; k++) Z[k] = zFlow[k] + runny[k];
    // Lighting per cell: key light front-left and above, camera in front.
    const Lx = -0.45, Ly = 0.3, Lz = 0.84, Hx = -0.22, Hy = 0.47, Hz = 0.85;
    for (let j = 0; j < PG; j++) for (let i = 0; i < PG; i++) {
      const k = j * PG + i;
      const kl = i > 0 ? k - 1 : k, kr = i < PG - 1 ? k + 1 : k, ku = j > 0 ? k - PG : k, kd = j < PG - 1 ? k + PG : k;
      let nx = -(Z[kr] - Z[kl]) / (2 * CS), ny = -(Z[kd] - Z[ku]) / (2 * CS), nz = 1;
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      this.shade[k] = 0.42 + 0.66 * Math.max(0, nx * Lx + ny * Ly + nz * Lz);
      this.spec[k] = Math.max(0, nx * Hx + ny * Hy + nz * Hz);
    }
  }

  render(ctx) {
    if (this.dirty) { this.raster(); this.cacheCtx.putImageData(this.img, 0, 0); this.dirty = false; }
    ctx.drawImage(this.cache, 0, 0);
  }

  raster() {
    const { W, H, img, ybuf, Z, egg, inner, runny, shade, spec, tex, curdTex, cutMark } = this;
    const d = img.data;
    d.set(this.bg);
    ybuf.fill(H);
    const o = this.omelette;
    // Egg colours from the cook.
    const dm = o ? o.dm : 0.5, brw = o ? clamp(o.br, 0, 1) : 0;
    const skin = [lerp(252, 196, brw), lerp(224, 140, brw), lerp(120, 60, brw)];
    const done = sstep(0.25, 0.85, dm);
    const custard = [lerp(255, 250, done), lerp(160, 214, done), lerp(10, 96, done)];
    const glossIn = lerp(1.5, 0.3, done);
    const F = tex.F;
    const yOffDrop = o && o.drop > 0 ? -o.drop * o.drop * 140 : 0;
    for (let sx = 0; sx < W; sx++) {
      const xmm = (sx - this.cx) / this.scale;
      const gx = xmm / CS + PG / 2;
      if (gx < 0 || gx >= PG - 1) continue;
      let top = H;
      const fi = Math.min(F - 1, Math.max(0, Math.round(gx * FINE)));
      // Front-to-back, quarter-cell steps.
      for (let gy4 = (PG - 1.01) * 4; gy4 >= 0; gy4--) {
        const gy = gy4 * 0.25;
        const k = (gy | 0) * PG + (gx | 0);
        const z = bilinear(Z, PG, PG, gx, gy);
        const ymm = (gy - PG / 2) * CS;
        let syf = this.cy + ymm * this.sy - z * this.sz;
        if (yOffDrop && syf + yOffDrop < top) { const e0 = bilinear(egg, PG, PG, gx, gy); if (e0 > 0.3) syf += yOffDrop; }
        const yy = Math.floor(syf);
        if (yy >= top) continue;
        const e = bilinear(egg, PG, PG, gx, gy);
        // Colour of this sample.
        const fj = Math.min(F - 1, Math.max(0, Math.round(gy * FINE)));
        const tk = fj * F + fi;
        let r = tex.tr[tk], g = tex.tg[tk], b = tex.tb[tk];
        const sh = bilinear(shade, PG, PG, gx, gy);
        let sp = bilinear(spec, PG, PG, gx, gy);
        let gloss = 0.05;
        if (e > 0.3) {
          const inn = bilinear(inner, PG, PG, gx, gy);
          const cn = curdTex[tk];
          // Skin: pale yellow, faint browning freckles if it got hot.
          let sr = skin[0], sg = skin[1], sb = skin[2];
          // The cut edge of each flap: a thin cooked rim.
          const lip = inn > 0.05 && inn < 0.6 ? 1 - Math.abs(inn - 0.3) / 0.3 : 0;
          if (brw > 0.05 && cn > 0.62) { const f = brw * 0.8; sr = lerp(sr, 150, f); sg = lerp(sg, 90, f); sb = lerp(sb, 30, f); }
          // Interior: glossy custard with soft curds.
          const curdy = (o.cu || 0.4) * sstep(0.45, 0.8, cn) * 0.5;
          const ir = lerp(custard[0], 255, curdy), ig = lerp(custard[1], 232, curdy), ib = lerp(custard[2], 130, curdy);
          const edgeA = sstep(0.3, 1.2, e);
          let er = lerp(sr, ir, inn), eg = lerp(sg, ig, inn), eb = lerp(sb, ib, inn);
          er = lerp(er, 236, lip * 0.5); eg = lerp(eg, 200, lip * 0.5); eb = lerp(eb, 90, lip * 0.5);
          r = lerp(r, er, edgeA); g = lerp(g, eg, edgeA); b = lerp(b, eb, edgeA);
          gloss = lerp(0.35, glossIn, inn) * edgeA;
        }
        const ru = bilinear(runny, PG, PG, gx, gy);
        if (ru > 0.05) {
          const a = sstep(0.05, 0.9, ru);
          r = lerp(r, 252, a); g = lerp(g, 168, a); b = lerp(b, 24, a);
          gloss = Math.max(gloss, 1.3 * a);
        }
        const cm = cutMark[k];
        if (cm > 0 && e > 0.3 && (!o || o.openT < 0)) { r *= 0.72; g *= 0.62; b *= 0.5; }
        const hi = (Math.pow(sp, 40) * 1.2 + Math.pow(sp, 6) * 0.1) * gloss * 255;
        r = r * sh + hi; g = g * sh + hi; b = b * sh + hi * 0.95;
        const R = r > 255 ? 255 : r, G = g > 255 ? 255 : g, B = b > 255 ? 255 : b;
        const y0 = yy < 0 ? 0 : yy;
        for (let y = y0; y < top; y++) {
          const p = (y * W + sx) * 4;
          d[p] = R; d[p + 1] = G; d[p + 2] = B; d[p + 3] = 255;
        }
        top = y0;
        if (top <= 0) break;
      }
    }
  }

  // Where the omelette's ridge is on screen (for the knife guide).
  ridgeScreen(u) {
    const o = this.omelette;
    const x = o.x + u * o.Lh, y = o.y;
    return this.project(x, y, this.heightAt(x, y));
  }
  toOmeletteFrame(xmm, ymm) {
    const o = this.omelette;
    return [(xmm - o.x) / o.Lh, ymm - o.y];
  }
  markCut(xmm, ymm, px, py) {
    this.dirty = true;
    const steps = px == null ? 1 : Math.max(1, Math.ceil(Math.hypot(xmm - px, ymm - py) / (CS * 0.5)));
    for (let s = 1; s <= steps; s++) {
      const x = px == null ? xmm : px + (xmm - px) * (s / steps), y = py == null ? ymm : py + (ymm - py) * (s / steps);
      const i = Math.round(x / CS + PG / 2), j = Math.round(y / CS + PG / 2);
      const k = j * PG + i;
      if (k >= 0 && k < this.cutMark.length) this.cutMark[k] = 1;
    }
  }
  clearCut() { this.cutMark.fill(0); this.dirty = true; }

  coverage() {
    // Share of the rice's top that the egg ended up covering.
    let tot = 0, cov = 0;
    for (let j = 0; j < PG; j++) for (let i = 0; i < PG; i++) {
      const k = j * PG + i, x = (i - PG / 2) * CS, y = (j - PG / 2) * CS;
      if ((x / RICE.a) ** 2 + (y / RICE.b) ** 2 > 0.8) continue;
      tot++; if (this.egg[k] > 0.8) cov++;
    }
    return cov / tot;
  }
}

export function terrainAt(x, y) {
  const d = Math.hypot(x, y);
  let z = 0;
  // Plate well, a raised rim, then a rounded lip down to the cloth.
  if (d > RIM_IN) {
    const u = (d - RIM_IN) / (PLATE_R - RIM_IN);
    z = u < 0.75 ? Math.sin((u / 0.75) * Math.PI * 0.5) * 9 : 9 - 11 * sstep(0.75, 1.0, u);
  }
  const q = (x / RICE.a) ** 2 + (y / RICE.b) ** 2;
  if (q < 1) z += RICE.h * (1 - q) * (1 + 0.55 * q) * sstep(1, 0.96, q * q) ;
  // Grainy rice surface.
  if (q < 1.05) z += (Math.sin(x * 1.7) * Math.sin(y * 1.9) + Math.sin(x * 0.9 + y * 1.3)) * 0.35;
  return z;
}

export const RICE_DIMS = RICE;
