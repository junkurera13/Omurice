// Procedural textures, painted once on canvases.
import * as THREE from '../vendor/three.module.min.js';
import { rng, lerp, clamp, sstep } from './sim.js';

export function valueNoise(size, cell, seed) {
  const r = rng(seed);
  const gw = Math.ceil(size / cell) + 2;
  const g = new Float32Array(gw * gw).map(() => r());
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const fx = x / cell, fy = y / cell, i = fx | 0, j = fy | 0;
    let tx = fx - i, ty = fy - j;
    tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
    out[y * size + x] = lerp(lerp(g[j * gw + i], g[j * gw + i + 1], tx), lerp(g[(j + 1) * gw + i], g[(j + 1) * gw + i + 1], tx), ty);
  }
  return out;
}

// Tileable-ish fractal noise.
export function fbm(size, seed, oct = 4, base = 64) {
  const out = new Float32Array(size * size);
  let amp = 0.5, tot = 0;
  for (let o = 0; o < oct; o++) {
    const n = valueNoise(size, Math.max(1, base / (1 << o)), seed + o * 17);
    for (let k = 0; k < out.length; k++) out[k] += n[k] * amp;
    tot += amp; amp *= 0.5;
  }
  for (let k = 0; k < out.length; k++) out[k] /= tot;
  return out;
}

function canvasTex(cv, srgb = true) {
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function woodTexture() {
  const S = 1024, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(S, S), d = img.data;
  const n = fbm(256, 3, 4, 48);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const nn = n[((y >> 2) & 255) * 256 + ((x >> 2) & 255)];
    // Long grain lines along x, warped by noise.
    const g = Math.sin((y + nn * 90) * 0.09 + Math.sin(x * 0.004) * 3) * 0.5 + 0.5;
    const fine = Math.sin((y + nn * 30) * 0.9) * 0.5 + 0.5;
    const plank = Math.floor(y / 256);
    const tone = [0, 0.08, -0.05, 0.04][plank % 4];
    const v = 0.55 + 0.25 * g + 0.08 * fine + tone + (nn - 0.5) * 0.3;
    const gap = (y % 256) < 3 ? 0.35 : 1;
    const o = (y * S + x) * 4;
    d[o] = clamp(92 * v * gap, 0, 255); d[o + 1] = clamp(58 * v * gap, 0, 255); d[o + 2] = clamp(36 * v * gap, 0, 255); d[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = canvasTex(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function steelTexture() {
  const S = 512, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#7d8086'; ctx.fillRect(0, 0, S, S);
  const r = rng(9);
  for (let i = 0; i < 2600; i++) {
    const y = r() * S, a = 0.03 + r() * 0.06;
    ctx.strokeStyle = r() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(S, y + (r() - 0.5) * 3); ctx.stroke();
  }
  const t = canvasTex(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function softSprite(inner = 'rgba(255,255,255,1)') {
  const S = 128, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, inner); g.addColorStop(0.4, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  return canvasTex(cv);
}

// The outside of the omelette: butter-yellow skin, freckled brown if the
// pan was too hot. Returns {map, bump}.
export function skinTextures(br, seed = 4, tears = 0) {
  const S = 512, cv = document.createElement('canvas'), bv = document.createElement('canvas');
  cv.width = bv.width = S; cv.height = bv.height = S;
  const ctx = cv.getContext('2d'), btx = bv.getContext('2d');
  const img = ctx.createImageData(S, S), bimg = btx.createImageData(S, S);
  const n1 = fbm(S, seed, 5, 96), n2 = valueNoise(S, 5, seed + 3), n3 = valueNoise(S, 2.2, seed + 5);
  const wn = fbm(S, seed + 9, 3, 40);
  const wrinkle = new Float32Array(S * S);
  for (let k = 0; k < S * S; k++) wrinkle[k] = sstep(0.04, 0, Math.abs(wn[k] - 0.5)) * 0.8;
  const b = clamp(br, 0, 1.2);
  for (let k = 0; k < S * S; k++) {
    // Base: pale butter yellow with soft mottling.
    // Bright lemon-yellow, a touch more orange where it's thicker.
    let r = 247, g = 190 + (n1[k] - 0.5) * 26, bl = 22 + (n1[k] - 0.5) * 22;
    const st = sstep(0.62, 0.8, n2[k]) * 0.25;
    r = lerp(r, 252, st); g = lerp(g, 212, st); bl = lerp(bl, 70, st);
    // Browning: blotches grow and darken with heat.
    const spot = sstep(1 - b * 0.55, 1.02 - b * 0.4, n1[k] * 0.7 + n3[k] * 0.3) * Math.min(1, b * 1.6);
    r = lerp(r, 176, spot); g = lerp(g, 112, spot); bl = lerp(bl, 42, spot);
    const o = k * 4;
    img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = bl; img.data[o + 3] = 255;
    // Fine wrinkles where the skin folded: ridged noise, stretched along
    // the length of the omelette (u runs along it).
    const kx = k % S, ky = (k / S) | 0;
    const wr = wrinkle[((ky) % S) * S + ((kx >> 2) % S)];
    const h = 128 + (n2[k] - 0.5) * 30 + (n3[k] - 0.5) * 16 - wr * 70;
    bimg.data[o] = bimg.data[o + 1] = bimg.data[o + 2] = h; bimg.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0); btx.putImageData(bimg, 0, 0);
  // Tears from a rough fold: wet custard showing through splits.
  const rr = rng(seed + 11);
  const nt = Math.round(clamp(tears, 0, 2) * 5);
  for (let i = 0; i < nt; i++) {
    const x = (0.2 + rr() * 0.6) * S, y = (0.3 + rr() * 0.4) * S, w = 14 + rr() * 26, h = 4 + rr() * 6, a = rr() - 0.5;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.fillStyle = 'rgb(240,160,24)'; ctx.beginPath(); ctx.ellipse(0, 0, w, h, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(150,95,20,0.7)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.restore();
  }
  const map = canvasTex(cv), bump = canvasTex(bv, false);
  map.wrapS = map.wrapT = bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  return { map, bump };
}

// Colour of the egg's inside by doneness. 0.2 raw, ~0.52 hanjuku, 0.9 dry.
export function custardColor(dm) {
  const stops = [
    [0.15, [230, 116, 6]],
    [0.32, [238, 138, 8]],
    [0.5, [244, 160, 16]],
    [0.62, [246, 182, 38]],
    [0.75, [242, 206, 92]],
    [0.92, [234, 222, 152]],
  ];
  if (dm <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (dm <= stops[i][0]) {
      const t = (dm - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]);
      return stops[i - 1][1].map((c, k) => lerp(c, stops[i][1][k], t));
    }
  }
  return stops[stops.length - 1][1];
}

// The inside face of the omelette: custard with soft curds. Wet and
// golden when hanjuku; pale, dry and crumbly when overcooked.
export function custardTextures(dm, cu = 0.5, seed = 8) {
  const S = 512, cv = document.createElement('canvas'), bv = document.createElement('canvas');
  cv.width = bv.width = S; cv.height = bv.height = S;
  const ctx = cv.getContext('2d'), btx = bv.getContext('2d');
  const img = ctx.createImageData(S, S), bimg = btx.createImageData(S, S);
  const c = custardColor(dm);
  const lumpsN = fbm(S, seed, 3, 28), fine = valueNoise(S, 3, seed + 2), crack = fbm(S, seed + 5, 4, 40);
  const done = sstep(0.45, 0.95, dm);
  for (let k = 0; k < S * S; k++) {
    const l = sstep(0.5, 0.75, lumpsN[k]) * (0.4 + cu * 0.6);
    let r = lerp(c[0], 255, l * 0.25), g = lerp(c[1], 228, l * 0.3), b = lerp(c[2], 140, l * 0.3);
    // Wet runnels between curds are deeper orange.
    const runnel = (1 - done) * sstep(0.45, 0.3, lumpsN[k]) * 0.5;
    r = lerp(r, 238, runnel); g = lerp(g, 150, runnel); b = lerp(b, 14, runnel);
    // Overcooked: dry crumbs and hairline cracks.
    const cr = done * sstep(0.02, 0, Math.abs(crack[k] - 0.5));
    r = lerp(r, 196, cr * 0.6); g = lerp(g, 170, cr * 0.6); b = lerp(b, 100, cr * 0.6);
    const o = k * 4;
    img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
    const h = 120 + l * 90 + (fine[k] - 0.5) * 40 * (0.3 + done) - cr * 80;
    bimg.data[o] = bimg.data[o + 1] = bimg.data[o + 2] = clamp(h, 0, 255); bimg.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0); btx.putImageData(bimg, 0, 0);
  const map = canvasTex(cv), bump = canvasTex(bv, false);
  map.wrapS = map.wrapT = bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  return { map, bump };
}

// Ketchup rice packed into a mould: thousands of glossy, slightly
// translucent grains, painted once. Planar map over the mound (S cm wide).
export function riceTextures(S_cm = 17, seed = 21) {
  const S = 1024, cv = document.createElement('canvas'), bv = document.createElement('canvas');
  cv.width = bv.width = S; cv.height = bv.height = S;
  const ctx = cv.getContext('2d'), btx = bv.getContext('2d');
  ctx.fillStyle = 'rgb(122,30,10)'; ctx.fillRect(0, 0, S, S);
  btx.fillStyle = 'rgb(40,40,40)'; btx.fillRect(0, 0, S, S);
  const r = rng(seed);
  const L = (0.64 / S_cm) * S, Wd = L * 0.4;
  for (let i = 0; i < 11000; i++) {
    const x = r() * S, y = r() * S, a = r() * Math.PI;
    const k = r();
    const base = k < 0.1 ? [236, 150, 100] : k < 0.85 ? [205 + r() * 20, 62 + r() * 22, 22 + r() * 12] : [168, 38, 16];
    const s = 0.85 + r() * 0.3;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.scale(s, s);
    const g = ctx.createRadialGradient(-L * 0.15, -Wd * 0.3, 0, 0, 0, L * 0.55);
    g.addColorStop(0, `rgb(${Math.min(255, base[0] + 40)},${Math.min(255, base[1] + 40)},${Math.min(255, base[2] + 30)})`);
    g.addColorStop(0.6, `rgb(${base[0]},${base[1]},${base[2]})`);
    g.addColorStop(1, `rgb(${base[0] * 0.7},${base[1] * 0.6},${base[2] * 0.6})`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(0, 0, L / 2, Wd / 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    btx.save(); btx.translate(x, y); btx.rotate(a); btx.scale(s, s);
    const bg = btx.createRadialGradient(0, 0, 0, 0, 0, L * 0.5);
    bg.addColorStop(0, 'rgb(235,235,235)'); bg.addColorStop(1, 'rgb(70,70,70)');
    btx.fillStyle = bg;
    btx.beginPath(); btx.ellipse(0, 0, L / 2, Wd / 2, 0, 0, Math.PI * 2); btx.fill();
    btx.restore();
  }
  return { map: canvasTex(cv), bump: canvasTex(bv, false) };
}
