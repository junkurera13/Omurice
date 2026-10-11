// Drawing for the bowl and the pan: a per-pixel shaded heightfield so raw
// egg looks wet and glossy, set egg looks matte, and curds catch the light.
import { bilinear, sstep, clamp, lerp, rng } from './sim.js';

const TEX = 224; // offscreen resolution for the egg surface

function makeNoise(size, cell, seed) {
  const r = rng(seed);
  const gw = Math.ceil(size / cell) + 2;
  const g = new Float32Array(gw * gw).map(() => r());
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const fx = x / cell, fy = y / cell;
    const i = fx | 0, j = fy | 0;
    let tx = fx - i, ty = fy - j;
    tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
    const a = g[j * gw + i], b = g[j * gw + i + 1], c = g[(j + 1) * gw + i], d = g[(j + 1) * gw + i + 1];
    out[y * size + x] = lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
  }
  return out;
}

export class EggSurface {
  constructor() {
    this.cv = document.createElement('canvas');
    this.cv.width = this.cv.height = TEX;
    this.ctx = this.cv.getContext('2d');
    this.img = this.ctx.createImageData(TEX, TEX);
    const n = TEX * TEX;
    this.H = new Float32Array(n);
    this.cr = new Float32Array(n); this.cg = new Float32Array(n); this.cb = new Float32Array(n);
    this.al = new Float32Array(n); this.gl = new Float32Array(n);
    this.curd = makeNoise(TEX, 6.5, 11);
    this.curd2 = makeNoise(TEX, 3.4, 12);
    this.fine = makeNoise(TEX, 1.1, 13);
    this.blob = makeNoise(TEX, 9, 14);
  }

  // fields: {h, dm, db, cu, br, yk, N}; opts: {bubbles, foam, time, mode}
  draw(F, opts = {}) {
    const { N } = F;
    const { H, cr, cg, cb, al, gl, curd, curd2, fine, blob } = this;
    const s = (N - 1) / (TEX - 1);
    const t = opts.time || 0;
    for (let y = 0; y < TEX; y++) {
      for (let x = 0; x < TEX; x++) {
        const p = y * TEX + x;
        const gx = x * s, gy = y * s;
        const h = bilinear(F.h, N, N, gx, gy);
        if (h < 0.08) { al[p] = 0; H[p] = 0; continue; }
        const dm = F.dm ? bilinear(F.dm, N, N, gx, gy) : 0;
        const cu = F.cu ? bilinear(F.cu, N, N, gx, gy) : 0;
        const br = F.br ? bilinear(F.br, N, N, gx, gy) : 0;
        const yk = F.yk ? bilinear(F.yk, N, N, gx, gy) : 1;
        // Curds: lumps of set egg standing proud of the liquid.
        const cn = curd[p] * 0.65 + curd2[p] * 0.35;
        const lump = cu * sstep(0.3, 0.8, cn);
        const vis = clamp(dm * 0.85 + lump * 0.45 + (h < 1 ? (1 - h) * dm * 0.6 : 0), 0, 1.3);
        const done = sstep(0.22, 0.85, vis);
        let hh = h + lump * 0.9;
        if (opts.foam) hh += opts.foam[p] || 0;
        // Raw colour from yolk share: clear white -> beaten -> deep yolk.
        const y01 = clamp(yk, 0, 3);
        let r0, g0, b0;
        if (y01 < 1) { r0 = lerp(238, 250, y01); g0 = lerp(232, 178, y01); b0 = lerp(196, 34, y01); }
        else { const u = (y01 - 1) / 2; r0 = lerp(250, 255, u); g0 = lerp(178, 136, u); b0 = lerp(34, 8, u); }
        // Set colour.
        let r1, g1, b1;
        if (y01 < 1) { r1 = lerp(252, 255, y01); g1 = lerp(250, 226, y01); b1 = lerp(240, 112, y01); }
        else { const u = (y01 - 1) / 2; r1 = 255; g1 = lerp(226, 200, u); b1 = lerp(112, 60, u); }
        let r = lerp(r0, r1, done), g = lerp(g0, g1, done), b = lerp(b0, b1, done);
        // Over-done egg goes dull and slightly grey-green.
        const over = sstep(0.85, 1.4, dm);
        r = lerp(r, 236, over * 0.4); g = lerp(g, 222, over * 0.35); b = lerp(b, 150, over * 0.4);
        // Lacy brown edges where it's thin and hot.
        const edge = sstep(1.6, 0.3, h);
        const bv = clamp(br * (0.25 + edge * 1.2) * (0.6 + 0.8 * blob[p]), 0, 1);
        r = lerp(r, 168, bv); g = lerp(g, 104, bv); b = lerp(b, 38, bv);
        cr[p] = r; cg[p] = g; cb[p] = b;
        // Thin raw egg is see-through.
        // Raw white is nearly clear; yolk and cooked egg are opaque.
        const opq = lerp(0.45, 0.92, sstep(0, 1, y01));
        al[p] = clamp(sstep(0.08, 1.1, h) * lerp(opq, 1, done), 0, 1);
        // Wet curds still shine; only properly set egg goes matte.
        gl[p] = (1 - sstep(0.45, 1.0, dm)) * 0.85 + 0.12;
        H[p] = hh + fine[p] * 0.08 * done;
      }
    }
    // Shade.
    const d = this.img.data;
    const Lx = -0.45, Ly = -0.6, Lz = 0.66;
    const Hx = -0.25, Hy = -0.35, Hz = 0.9;
    const hl = Math.hypot(Hx, Hy, Hz);
    const k = 0.75 / s * (opts.relief || 0.9);
    for (let y = 0; y < TEX; y++) {
      for (let x = 0; x < TEX; x++) {
        const p = y * TEX + x, o = p * 4;
        if (al[p] <= 0) { d[o + 3] = 0; continue; }
        const xl = x > 0 ? H[p - 1] : H[p], xr = x < TEX - 1 ? H[p + 1] : H[p];
        const yu = y > 0 ? H[p - TEX] : H[p], yd = y < TEX - 1 ? H[p + TEX] : H[p];
        let nx = -(xr - xl) * k * 0.5, ny = -(yd - yu) * k * 0.5, nz = 1;
        const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
        const diff = 0.68 + 0.42 * Math.max(0, nx * Lx + ny * Ly + nz * Lz);
        const sp = Math.max(0, (nx * Hx + ny * Hy + nz * Hz) / hl);
        const glo = gl[p];
        const spec = glo * (Math.pow(sp, 60) * 1.1 + Math.pow(sp, 9) * 0.12) * 255;
        d[o] = Math.min(255, cr[p] * diff + spec);
        d[o + 1] = Math.min(255, cg[p] * diff + spec);
        d[o + 2] = Math.min(255, cb[p] * diff + spec * 0.95);
        d[o + 3] = Math.min(255, al[p] * 255 + spec * 0.6);
      }
    }
    this.ctx.putImageData(this.img, 0, 0);
    return this.cv;
  }
}

/* ---------------- Stove + pan ---------------- */

export function drawStoveBackground(ctx, W, H, t) {
  // Stainless steel range top with brushed streaks.
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#2b2d30'); g.addColorStop(1, '#17181a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 0.06;
  ctx.strokeStyle = '#fff';
  for (let i = 0; i < 70; i++) {
    const y = (i * 37) % H;
    ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5 + ((i * 13) % 5) - 2); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

export function drawBurner(ctx, cx, cy, r, knob, t) {
  // Cast-iron grate.
  ctx.save();
  ctx.strokeStyle = '#0c0c0d'; ctx.lineWidth = 10; ctx.lineCap = 'round';
  for (let a = 0; a < 4; a++) {
    const ang = a * Math.PI / 2 + Math.PI / 4;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ang) * r * 0.35, cy + Math.sin(ang) * r * 0.35);
    ctx.lineTo(cx + Math.cos(ang) * r * 1.22, cy + Math.sin(ang) * r * 1.22);
    ctx.stroke();
  }
  ctx.restore();
  if (!knob) return;
  // Gas flame ring licking out from under the pan.
  const n = 36, L = [0, 6, 11, 19][knob];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const flick = 0.75 + 0.25 * Math.sin(t * 23 + i * 2.1) * Math.sin(t * 17 + i);
    const len = L * flick;
    const x0 = cx + Math.cos(a) * r * 1.0, y0 = cy + Math.sin(a) * r * 1.0;
    const x1 = cx + Math.cos(a) * (r * 1.0 + len), y1 = cy + Math.sin(a) * (r * 1.0 + len);
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, 'rgba(70,120,255,0.95)');
    g.addColorStop(0.6, 'rgba(110,170,255,0.55)');
    g.addColorStop(1, 'rgba(255,190,90,0)');
    ctx.strokeStyle = g; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }
}

export function drawPan(ctx, cx, cy, rIn, tiltY, T) {
  const rOut = rIn * 1.1;
  ctx.save();
  // Handle toward the cook (bottom of screen).
  ctx.save();
  ctx.translate(cx, cy + rOut * 0.96);
  const hg = ctx.createLinearGradient(-16, 0, 16, 0);
  hg.addColorStop(0, '#1a1a1a'); hg.addColorStop(0.5, '#3a3631'); hg.addColorStop(1, '#141414');
  ctx.fillStyle = hg;
  ctx.beginPath();
  ctx.moveTo(-13, 0); ctx.lineTo(13, 0); ctx.lineTo(17, 190); ctx.lineTo(-17, 190); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#5a5249';
  ctx.fillRect(-11, 4, 22, 12);
  ctx.restore();
  // Rim and wall.
  const rg = ctx.createRadialGradient(cx - rOut * 0.3, cy - rOut * 0.4, rOut * 0.2, cx, cy, rOut);
  rg.addColorStop(0, '#55575b'); rg.addColorStop(0.8, '#2a2b2e'); rg.addColorStop(1, '#101113');
  ctx.fillStyle = rg;
  ctx.beginPath(); ctx.arc(cx, cy, rOut, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(cx, cy, rOut - 1, Math.PI * 1.05, Math.PI * 1.7); ctx.stroke();
  // Cooking surface: dark non-stick with a faint radial sheen.
  const bg = ctx.createRadialGradient(cx - rIn * 0.25, cy - rIn * 0.3, 0, cx, cy, rIn);
  const heat = clamp((T - 150) / 150, 0, 1);
  bg.addColorStop(0, `rgb(${58 + heat * 14},${58 + heat * 4},${62})`);
  bg.addColorStop(0.75, '#2c2d31');
  bg.addColorStop(1, '#1d1e21');
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.arc(cx, cy, rIn, 0, Math.PI * 2); ctx.fill();
  // Wall shading ring.
  const wg = ctx.createRadialGradient(cx, cy, rIn * 0.8, cx, cy, rIn);
  wg.addColorStop(0, 'rgba(0,0,0,0)'); wg.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = wg;
  ctx.beginPath(); ctx.arc(cx, cy, rIn, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

export function drawButter(ctx, pan, cx, cy, scale, t) {
  if (!pan.butter || pan.poured) return;
  const melt = pan.butterMelt;
  const R = (14 + melt * 70) * Math.sqrt(pan.butter / 10) * scale;
  const brown = clamp(pan.butterBrown, 0, 1.2);
  // Melted pool.
  if (melt > 0.02) {
    const col = brown > 0.05
      ? `rgba(${Math.round(lerp(240, 120, Math.min(1, brown)))},${Math.round(lerp(205, 70, Math.min(1, brown)))},${Math.round(lerp(110, 20, Math.min(1, brown)))},0.85)`
      : 'rgba(246,214,120,0.7)';
    const g = ctx.createRadialGradient(cx - R * 0.2, cy - R * 0.2, 0, cx, cy, R);
    g.addColorStop(0, col); g.addColorStop(0.85, col); g.addColorStop(1, 'rgba(240,200,110,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const rr = R * (1 + 0.06 * Math.sin(a * 5 + t * 0.7) + 0.04 * Math.sin(a * 3 - t));
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.fill();
  }
  // Foam: busy little bubbles while water boils off.
  const st = pan.butterState();
  if ((st === 'foaming' || (pan.butterWater > 0.05 && pan.T > 100)) && melt > 0.5) {
    const n = Math.round(110 * clamp(pan.butterWater * 1.3, 0.25, 1));
    for (let i = 0; i < n; i++) {
      // Each bubble lives briefly, pops, and reappears somewhere else.
      const cyc = t * (1.8 + hash(i) * 1.5) + hash(i + 7);
      const gen = Math.floor(cyc), life = cyc - gen;
      const a = hash(i * 13 + gen * 7) * Math.PI * 2;
      const rr = Math.sqrt(hash(i * 31 + gen * 17)) * R * 0.9;
      const br = (1.5 + (i % 4)) * scale * (0.6 + life * 0.6);
      ctx.fillStyle = `rgba(255,250,232,${0.75 * (1 - life)})`;
      ctx.beginPath(); ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, br, 0, Math.PI * 2); ctx.fill();
    }
  }
  // Brown milk-solid flecks.
  if (brown > 0.12) {
    ctx.fillStyle = `rgba(90,45,10,${Math.min(0.9, brown)})`;
    for (let i = 0; i < 60 * Math.min(1, brown); i++) {
      const a = hash(i * 3.7) * Math.PI * 2, rr = Math.sqrt(hash(i * 5.3 + 1)) * R * 0.85;
      ctx.fillRect(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 2 * scale, 2 * scale);
    }
  }
  // The unmelted pat.
  if (melt < 0.98) {
    const s = 26 * scale * Math.cbrt(pan.butter / 10) * Math.pow(1 - melt, 0.5);
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(0.3);
    const g = ctx.createLinearGradient(-s, -s, s, s);
    g.addColorStop(0, '#fff6cf'); g.addColorStop(1, '#f2db8e');
    ctx.fillStyle = g;
    roundRect(ctx, -s / 2, -s / 2, s, s * 0.8, 4 * scale);
    ctx.fill();
    ctx.restore();
  }
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* Smoke and steam wisps */
export class Wisps {
  constructor() { this.p = []; }
  emit(x, y, kind, n = 1, spread = 60) {
    for (let i = 0; i < n; i++) {
      this.p.push({
        x: x + (Math.random() - 0.5) * spread * 2, y: y + (Math.random() - 0.5) * spread * 2,
        vx: (Math.random() - 0.5) * 10, vy: -20 - Math.random() * 25,
        life: 0, max: 1.6 + Math.random() * 1.4, r: 6 + Math.random() * 10, kind,
      });
    }
    if (this.p.length > 260) this.p.splice(0, this.p.length - 260);
  }
  step(dt) {
    for (const q of this.p) {
      q.life += dt; q.x += q.vx * dt + Math.sin(q.life * 3 + q.r) * 8 * dt; q.y += q.vy * dt; q.r += dt * 14;
    }
    this.p = this.p.filter(q => q.life < q.max);
  }
  draw(ctx) {
    for (const q of this.p) {
      const a = Math.sin((q.life / q.max) * Math.PI);
      const g = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, q.r);
      const c = q.kind === 'smoke' ? '60,56,52' : '255,255,255';
      const al = q.kind === 'smoke' ? 0.3 * a : 0.06 * a;
      g.addColorStop(0, `rgba(${c},${al})`); g.addColorStop(1, `rgba(${c},0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2); ctx.fill();
    }
  }
}

/* Rolled omelette in the pan, drawn as a soft football. */
function footballPath(ctx, len, rad) {
  ctx.beginPath();
  ctx.moveTo(-len / 2, 0);
  ctx.bezierCurveTo(-len * 0.36, -rad * 1.32, len * 0.36, -rad * 1.32, len / 2, 0);
  ctx.bezierCurveTo(len * 0.36, rad * 1.32, -len * 0.36, rad * 1.32, -len / 2, 0);
  ctx.closePath();
}
export function drawLog(ctx, x, y, len, rad, ext, tears, creases, roll, t) {
  // ext: {r,g,b} exterior colour; roll: phase of the current tap.
  const { r, g: gg, b } = ext;
  ctx.save();
  ctx.translate(x, y);
  // Contact shadow.
  ctx.save();
  ctx.translate(3, rad * 0.35);
  footballPath(ctx, len * 1.02, rad * 0.9);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.filter = 'blur(6px)';
  ctx.fill();
  ctx.restore();
  footballPath(ctx, len, rad);
  ctx.fillStyle = `rgb(${r},${gg},${b})`;
  ctx.fill();
  ctx.save();
  ctx.clip();
  // Round body: light from the upper left, shadowed underside.
  ctx.save();
  ctx.scale(len / (2 * rad) * 0.8, 1);
  const rg = ctx.createRadialGradient(-rad * 0.25, -rad * 0.45, 0, 0, 0, rad * 1.35);
  rg.addColorStop(0, 'rgba(255,255,236,0.55)');
  rg.addColorStop(0.35, 'rgba(255,250,220,0.12)');
  rg.addColorStop(0.7, 'rgba(120,70,0,0)');
  rg.addColorStop(1, 'rgba(110,60,0,0.5)');
  ctx.fillStyle = rg;
  ctx.fillRect(-rad * 2, -rad * 2, rad * 4, rad * 4);
  ctx.restore();
  // Rim darkening.
  footballPath(ctx, len, rad);
  ctx.strokeStyle = 'rgba(160,96,10,0.28)';
  ctx.lineWidth = rad * 0.45;
  ctx.stroke();
  // Butter-glossed highlight.
  ctx.save();
  ctx.translate(-len * 0.08, -rad * 0.55);
  ctx.scale(len * 0.3, rad * 0.16);
  const hg = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  hg.addColorStop(0, 'rgba(255,255,255,0.75)');
  hg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hg;
  ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  // Folds where the skin wrapped round: soft creases toward the tips.
  ctx.strokeStyle = 'rgba(170,110,20,0.25)'; ctx.lineWidth = 1.4;
  const sy = Math.cos(roll * Math.PI) * rad * 0.55;
  ctx.beginPath(); ctx.moveTo(-len * 0.44, sy * 0.3); ctx.quadraticCurveTo(0, sy + rad * 0.15, len * 0.44, sy * 0.3); ctx.stroke();
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * len * 0.47, 0);
    ctx.quadraticCurveTo(side * len * 0.36, -rad * 0.2, side * len * 0.3, -rad * 0.55);
    ctx.stroke();
  }
  // Tears: wet custard showing through splits in the skin.
  const rnd = rng(42);
  const nt = Math.round(tears * 4);
  for (let i = 0; i < nt; i++) {
    const tx = (rnd() - 0.5) * len * 0.6, ty = (rnd() - 0.4) * rad * 0.9;
    const w = 6 + rnd() * 10, h = 2 + rnd() * 4, a = rnd() - 0.5;
    ctx.fillStyle = 'rgba(250,170,25,0.95)';
    ctx.beginPath(); ctx.ellipse(tx, ty, w, h, a, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(140,90,10,0.6)'; ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillRect(tx - w * 0.3, ty - h * 0.4, w * 0.35, 1);
  }
  const nc = Math.round(creases * 5);
  ctx.strokeStyle = 'rgba(150,100,30,0.55)'; ctx.lineWidth = 1.2;
  for (let i = 0; i < nc; i++) {
    const tx = (rnd() - 0.5) * len * 0.6, ty = (rnd() - 0.5) * rad;
    ctx.beginPath(); ctx.moveTo(tx, ty - 7); ctx.lineTo(tx + 3, ty); ctx.lineTo(tx - 2, ty + 8); ctx.stroke();
  }
  ctx.restore();
  ctx.restore();
}

// Stable pseudo-random in [0,1) for decorative scatter.
export function hash(i) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
