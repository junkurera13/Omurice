// Stove, pan, butter and the egg in the pan, in 3D.
import * as THREE from '../vendor/three.module.min.js';
import { lathe, gridGeometry, dataTexture } from './world.js';
import { steelTexture, softSprite, valueNoise } from './textures.js';
import { bilinear, clamp, sstep, lerp, PN } from './sim.js';
import { subsurface } from './materials.js';

const M = 132;                 // render grid for the egg
const FLOOR = 0.04;            // egg sits just above the pan floor (cm)

export function rawEggRGB(y01) {
  // Raw colour by yolk share: clear-ish white -> beaten -> deep yolk.
  if (y01 < 1) return [lerp(236, 240, y01), lerp(228, 146, y01), lerp(196, 10, y01)];
  const u = Math.min(1, (y01 - 1) / 2);
  return [lerp(240, 244, u), lerp(146, 118, u), lerp(10, 4, u)];
}
export function setEggRGB(y01) {
  if (y01 < 1) return [lerp(246, 249, y01), lerp(242, 194, y01), lerp(228, 34, y01)];
  const u = Math.min(1, (y01 - 1) / 2);
  return [248, lerp(194, 176, u), lerp(34, 20, u)];
}

export class Stove {
  constructor(world, origin) {
    this.world = world;
    const g = (this.group = new THREE.Group());
    g.position.copy(origin);
    world.scene.add(g);
    const steel = steelTexture();
    steel.repeat.set(3, 3);
    // Stainless range top.
    const top = new THREE.Mesh(new THREE.PlaneGeometry(90, 70), new THREE.MeshPhysicalMaterial({ color: 0x18191b, map: steel, metalness: 0.3, roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.15 }));
    top.rotation.x = -Math.PI / 2; top.receiveShadow = true;
    g.add(top);
    // Burner: cap and ring.
    const iron = new THREE.MeshStandardMaterial({ color: 0x121214, roughness: 0.85, metalness: 0.3 });
    const burner = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.6, 1.2, 48), iron);
    burner.position.y = 0.6; burner.castShadow = burner.receiveShadow = true;
    g.add(burner);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.6, 0.6, 40), new THREE.MeshStandardMaterial({ color: 0x2a2724, roughness: 0.5, metalness: 0.6 }));
    cap.position.y = 1.5; g.add(cap);
    // Cast-iron grate.
    for (let a = 0; a < 4; a++) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.3, 12), iron);
      const ang = a * Math.PI / 2 + Math.PI / 4;
      arm.position.set(Math.sin(ang) * 8.6, 1.9, Math.cos(ang) * 8.6);
      arm.rotation.y = ang;
      arm.castShadow = arm.receiveShadow = true;
      g.add(arm);
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(14.5, 0.55, 8, 64), iron);
    ring.rotation.x = Math.PI / 2; ring.position.y = 1.9; ring.castShadow = true;
    g.add(ring);
    // Gas flames.
    const fg = new THREE.ConeGeometry(0.22, 1, 6, 1, true);
    fg.translate(0, 0.5, 0);
    const fm = new THREE.MeshBasicMaterial({ color: 0x4f7dff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    this.flames = new THREE.InstancedMesh(fg, fm, 40);
    this.flames.frustumCulled = false;
    g.add(this.flames);
    this.flameLight = new THREE.PointLight(0x4f7dff, 0, 20, 2);
    this.flameLight.position.set(0, 2.2, 0);
    g.add(this.flameLight);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3();
  }
  update(t, knob) {
    const L = [0, 0.7, 1.15, 1.8][knob];
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const fl = 0.75 + 0.25 * Math.sin(t * 31 + i * 2.3) * Math.sin(t * 19 + i);
      this._p.set(Math.cos(a) * 2.75, 1.65, Math.sin(a) * 2.75);
      // Tilt outward like a real gas ring.
      this._q.setFromEuler(new THREE.Euler(Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9));
      this._s.set(1, L ? L * fl : 0.0001, 1);
      this._m.compose(this._p, this._q, this._s);
      this.flames.setMatrixAt(i, this._m);
    }
    this.flames.instanceMatrix.needsUpdate = true;
    this.flameLight.intensity = L * 18;
  }
}

// The frying pan itself (body + handle), added to `g`. Origin is the
// centre of the cooking surface; the handle points to +z.
export function buildPanBody(g) {
  const prof = [[0, 0]];
  for (let r = 0.5; r <= 8; r += 0.5) prof.push([r, 0]);
  for (let r = 8.2; r <= 10; r += 0.2) prof.push([r, ((r - 8) / 2) ** 2 * 0.9]);
  for (let k = 1; k <= 12; k++) { const t = k / 12; prof.push([10 + t * 2.3, 0.9 + Math.sin(t * Math.PI / 2) * 3.7]); }
  prof.push([12.55, 4.75], [12.75, 4.6], [12.6, 3.6]);
  for (let k = 1; k <= 8; k++) { const t = k / 8; prof.push([12.6 - t * 2.2, 3.6 - Math.sin(t * Math.PI / 2) * 3.95]); }
  prof.push([5, -0.35], [0.01, -0.35]);
  const body = new THREE.Mesh(lathe(prof, 120), new THREE.MeshPhysicalMaterial({ color: 0x1f2023, roughness: 0.4, metalness: 0.35, clearcoat: 0.45, clearcoatRoughness: 0.35, side: THREE.DoubleSide }));
  body.castShadow = true; body.receiveShadow = true;
  g.add(body);
  const hg = new THREE.Group();
  hg.position.set(0, 3.9, 12.3);
  hg.rotation.x = -0.2;
  const bake = new THREE.MeshPhysicalMaterial({ color: 0x141312, roughness: 0.5, clearcoat: 0.6, clearcoatRoughness: 0.4 });
  const steelM = new THREE.MeshStandardMaterial({ color: 0x6d7076, metalness: 1, roughness: 0.38 });
  const bracket = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.0, 3.2), steelM);
  bracket.position.z = 1.2; hg.add(bracket);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.25, 17, 20), bake);
  handle.rotation.x = Math.PI / 2; handle.scale.set(1.25, 1, 0.8);
  handle.position.z = 10.5; handle.castShadow = true;
  hg.add(handle);
  g.add(hg);
  return hg;
}

export class Pan3D {
  constructor(world, stove) {
    this.world = world;
    const g = (this.group = new THREE.Group());
    g.position.set(0, 2.6, 0);
    stove.group.add(g);
    this.handle = buildPanBody(g);

    // The egg: a deformable sheet with a top side and a skin side.
    const span = ((PN - 1) * (200 / (2 * PN * 0.47))) / 10; // grid span in cm
    this.span = span;
    this.geo = gridGeometry(M, span);
    this.rest = Float32Array.from(this.geo.attributes.position.array);
    this.colTex = dataTexture(M);
    this.roughTex = dataTexture(M, false);
    this.skinTex = dataTexture(M);
    this.topMat = subsurface(new THREE.MeshPhysicalMaterial({
      map: this.colTex, roughnessMap: this.roughTex, clearcoatMap: this.roughTex,
      roughness: 1, clearcoat: 1, clearcoatRoughness: 0.1, alphaTest: 0.5, side: THREE.FrontSide,
    }));
    this.botMat = subsurface(new THREE.MeshPhysicalMaterial({
      map: this.skinTex, roughness: 0.5, clearcoat: 0.2, clearcoatRoughness: 0.35, alphaTest: 0.5, side: THREE.BackSide,
    }));
    this.top = new THREE.Mesh(this.geo, this.topMat);
    this.bot = new THREE.Mesh(this.geo, this.botMat);
    for (const m of [this.top, this.bot]) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; m.visible = false; g.add(m); }
    // Curds made by chopsticks are ribbons and folds, not round lumps:
    // ridged noise gives long creamy ridges with wet channels between.
    const n1 = valueNoise(M, 5, 21), n2 = valueNoise(M, 2.6, 22);
    this.lumpN = n1.map(v => 1 - Math.abs(2 * v - 1));
    this.lumpN2 = n2.map(v => 1 - Math.abs(2 * v - 1));

    // Butter.
    const butterM = new THREE.MeshPhysicalMaterial({ color: 0xfbe7a2, roughness: 0.42, sheen: 0.5, sheenColor: new THREE.Color(0xfff2c0) });
    this.pat = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.0, 2.0, 4, 2, 4), butterM);
    this.pat.castShadow = true; this.pat.visible = false;
    g.add(this.pat);
    this.poolMat = new THREE.MeshPhysicalMaterial({ color: 0xf2cf6a, roughness: 0.06, clearcoat: 1, transparent: true, opacity: 0.94, depthWrite: false });
    this.pool = new THREE.Mesh(new THREE.CircleGeometry(1, 64), this.poolMat);
    this.pool.rotation.x = -Math.PI / 2; this.pool.position.y = 0.02; this.pool.visible = false;
    g.add(this.pool);
    this.foam = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshPhysicalMaterial({ color: 0xfff7e0, roughness: 0.2, clearcoat: 1, transparent: true, opacity: 0.85 }), 160);
    this.foam.visible = false; this.foam.frustumCulled = false;
    g.add(this.foam);

    // Pour stream.
    this.stream = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.42, 1, 16, 1, true), new THREE.MeshPhysicalMaterial({ color: 0xf7b52a, roughness: 0.1, clearcoat: 1 }));
    this.stream.visible = false;
    g.add(this.stream);

    // Steam and smoke.
    this.spriteTex = softSprite();
    this.puffs = [];
    for (let i = 0; i < 46; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.spriteTex, transparent: true, depthWrite: false, opacity: 0 }));
      s.visible = false;
      stove.group.add(s);
      this.puffs.push({ s, life: 1, max: 1 });
    }
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3();
    this.rollInfo = null;
  }

  cellToLocal(gx, gy, pan) {
    const s = pan.cs / 10;
    return [(gx - pan.c) * s, (gy - pan.c) * s];
  }
  localToCell(x, z, pan) {
    const s = pan.cs / 10;
    return [x / s + pan.c, z / s + pan.c];
  }

  emit(kind, x, z) {
    const p = this.puffs.find(q => q.life >= q.max);
    if (!p) return;
    p.kind = kind; p.life = 0; p.max = 1.4 + Math.random() * 1.4;
    p.x = x + (Math.random() - 0.5) * 12; p.z = z + (Math.random() - 0.5) * 12; p.y = 4;
    p.s.visible = true;
    p.s.material.color.set(kind === 'smoke' ? 0x4a4440 : 0xffffff);
  }

  update(pan, t, dt, opts) {
    const g = this.group;
    // Tilt: far edge (-z) goes down.
    g.rotation.x = -pan.tiltY * 0.32 + (opts.kick || 0) * 0.04;
    g.position.y = 2.6 + pan.tiltY * 0.8 + (opts.kick || 0) * 0.5;

    // Butter.
    const melt = pan.butterMelt;
    const showButter = pan.butter > 0 && !pan.poured;
    this.pat.visible = showButter && melt < 0.97;
    if (this.pat.visible) {
      const s = Math.cbrt(pan.butter / 10) * Math.pow(1 - melt, 0.45);
      this.pat.scale.set(s, Math.max(0.15, s * (1 - melt * 0.6)), s);
      this.pat.position.set(0.6, 0.5 * this.pat.scale.y, 0.4);
      this.pat.rotation.y = 0.4;
    }
    this.pool.visible = showButter && melt > 0.03;
    if (this.pool.visible) {
      const R = (1.4 + melt * 5.2) * Math.sqrt(pan.butter / 10);
      this.pool.scale.set(R, R * 0.93, 1);
      const b = clamp(pan.butterBrown, 0, 1.2);
      this.poolMat.color.setRGB(lerp(0.95, 0.42, Math.min(1, b)), lerp(0.78, 0.2, Math.min(1, b)), lerp(0.36, 0.04, Math.min(1, b))).convertSRGBToLinear();
      // Foam while the water boils out.
      const foamOn = pan.butterWater > 0.04 && pan.T > 100 && melt > 0.5;
      this.foam.visible = foamOn || b > 0.15;
      if (this.foam.visible) {
        const n = foamOn ? Math.round(160 * clamp(pan.butterWater * 1.4, 0.2, 1)) : 0;
        for (let i = 0; i < 160; i++) {
          if (i >= n) { this._m.makeScale(0, 0, 0); this.foam.setMatrixAt(i, this._m); continue; }
          const cyc = t * (1.6 + (i % 7) * 0.2) + i * 0.37, gen = Math.floor(cyc), life = cyc - gen;
          const a = (Math.sin(i * 12.9898 + gen * 78.233) * 43758.5453) % 1 * Math.PI * 2;
          const rr = Math.sqrt(Math.abs((Math.sin(i * 4.1 + gen * 9.7) * 1e4) % 1)) * R * 0.9;
          const sz = (0.06 + (i % 5) * 0.035) * (0.5 + life * 0.7) * (life < 0.9 ? 1 : 0);
          this._v.set(Math.cos(a) * rr, 0.05 + sz * 0.6, Math.sin(a) * rr);
          this._s.set(sz, sz * 0.7, sz);
          this._m.compose(this._v, this._q.identity(), this._s);
          this.foam.setMatrixAt(i, this._m);
        }
        this.foam.instanceMatrix.needsUpdate = true;
      }
    } else this.foam.visible = false;

    // Pour stream.
    this.stream.visible = pan.pouring;
    if (pan.pouring) {
      const [x, z] = this.cellToLocal(pan.pourX + Math.sin(t * 9) * 1.2, pan.pourY + Math.cos(t * 7) * 1.2, pan);
      const top = 26;
      this.stream.scale.set(1 + Math.sin(t * 30) * 0.06, top, 1);
      this.stream.position.set(x, top / 2, z);
    }

    if (pan.poured) this.updateEgg(pan, opts);

    // Steam / smoke puffs.
    const heat = sstep(100, 200, pan.T);
    if (pan.poured && Math.random() < 0.5 * heat) this.emit('steam', 0, 0);
    if (pan.smoke > 0 && Math.random() < pan.smoke) this.emit('smoke', 0, 0);
    for (const p of this.puffs) {
      if (p.life >= p.max) { p.s.visible = false; continue; }
      p.life += dt;
      p.y += dt * (6 + p.life * 3);
      p.x += Math.sin(p.life * 2 + p.max * 9) * dt * 2;
      const a = Math.sin((p.life / p.max) * Math.PI);
      p.s.material.opacity = (p.kind === 'smoke' ? 0.35 : 0.1) * a;
      const sc = 4 + p.life * 6;
      p.s.scale.set(sc, sc, 1);
      p.s.position.set(p.x, p.y, p.z);
    }
  }

  updateEgg(pan, opts) {
    this.top.visible = this.bot.visible = true;
    const N = pan.N;
    const pos = this.geo.attributes.position.array, rest = this.rest;
    const col = this.colTex.image.data, rough = this.roughTex.image.data, skin = this.skinTex.image.data;
    const sc = (N - 1) / (M - 1);
    const cmPerMm = 0.1;
    const roll = opts.roll || 0;
    const kick = opts.kick || 0;
    if (pan.rolling && !this.rollInfo) this.rollInfo = this.sheetExtent(pan);
    const ri = this.rollInfo;
    for (let j = 0; j < M; j++) {
      for (let i = 0; i < M; i++) {
        const k = j * M + i, o = k * 4;
        const gx = i * sc, gy = j * sc;
        const h = bilinear(pan.h, N, N, gx, gy);
        const dm = bilinear(pan.dm, N, N, gx, gy);
        const cu = bilinear(pan.cu, N, N, gx, gy);
        const br = bilinear(pan.br, N, N, gx, gy);
        const db = bilinear(pan.db, N, N, gx, gy);
        const yk = bilinear(pan.yk, N, N, gx, gy);
        const zb = bilinear(pan.zb, N, N, gx, gy);
        // Curds stand up from the wet egg.
        const cn = this.lumpN[k] * 0.65 + this.lumpN2[k] * 0.35;
        const lump = cu * sstep(0.55, 0.92, cn);
        const vis = clamp(dm * 0.85 + lump * 0.5, 0, 1.3);
        const done = sstep(0.22, 0.85, vis);
        const y01 = clamp(yk, 0, 3);
        const rc = rawEggRGB(y01), scc = setEggRGB(y01);
        let r = lerp(rc[0], scc[0], done), gg = lerp(rc[1], scc[1], done), b = lerp(rc[2], scc[2], done);
        const over = sstep(0.85, 1.4, dm);
        r = lerp(r, 236, over * 0.35); gg = lerp(gg, 224, over * 0.3); b = lerp(b, 150, over * 0.35);
        const edge = sstep(1.6, 0.3, h);
        const bv = clamp(br * (0.2 + edge * 1.1), 0, 1);
        r = lerp(r, 170, bv); gg = lerp(gg, 104, bv); b = lerp(b, 36, bv);
        col[o] = r; col[o + 1] = gg; col[o + 2] = b;
        // The visible edge sits where the egg is ~1 mm thick: a rounded lip.
        col[o + 3] = h > 1.3 ? 255 : h > 0.5 ? Math.round(((h - 0.5) / 0.8) * 255) : 0;
        // Wet egg: glossy clear coat, low roughness. Set egg: satin.
        const wet = 1 - sstep(0.35, 0.95, dm * 0.8 + lump * 0.4);
        rough[o] = Math.round(lerp(50, 170, wet));          // clearcoat strength
        rough[o + 1] = Math.round(lerp(150, 70, wet));      // roughness: satin, not oily
        // Skin side: pale yellow, browned where hot.
        const sk = sstep(0.2, 0.9, db);
        const sb = clamp(br, 0, 1);
        skin[o] = lerp(lerp(rc[0], 247, sk), 168, sb); skin[o + 1] = lerp(lerp(rc[1], 190, sk), 104, sb); skin[o + 2] = lerp(lerp(rc[2], 24, sk), 34, sb);
        skin[o + 3] = col[o + 3];
        // Height.
        const p3 = k * 3;
        const y = FLOOR + (zb + h + lump * 0.9) * cmPerMm;
        if (!ri) {
          pos[p3] = rest[p3]; pos[p3 + 1] = y; pos[p3 + 2] = rest[p3 + 2];
        } else {
          // Pin empty vertices onto the egg's outline.
          let x0 = rest[p3], z0 = rest[p3 + 2];
          const row = ri.rows[j];
          const rr = row.near ? row.r : row;
          const pinned = row.near || h < 0.4;
          if (pinned) { x0 = clamp(x0, rr[0], rr[1]); z0 = clamp(z0, ri.zF, ri.zN); }
          this.curl(x0, z0, h * cmPerMm, roll, ri, pos, p3, kick);
          // Tuck the empty skirt under the egg so no slivers show.
          if (pinned) pos[p3 + 1] -= 0.4;
        }
      }
    }
    this.colTex.needsUpdate = true; this.roughTex.needsUpdate = true; this.skinTex.needsUpdate = true;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.computeVertexNormals();
  }

  // Extent of the egg sheet at the moment rolling starts (local cm).
  sheetExtent(pan) {
    const N = pan.N;
    let zF = 1e9, zN = -1e9, xMax = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      if (pan.h[j * N + i] < 0.5) continue;
      const [x, z] = this.cellToLocal(i, j, pan);
      zF = Math.min(zF, z); zN = Math.max(zN, z); xMax = Math.max(xMax, Math.abs(x));
    }
    if (zF > zN) { zF = -9; zN = 9; xMax = 9; }
    // Per render row: where the egg starts and ends across x, so empty
    // vertices can be pinned to the egg's edge (no stretched slivers).
    const rows = [];
    const sc = (N - 1) / (M - 1);
    for (let j = 0; j < M; j++) {
      let lo = 1e9, hi = -1e9;
      for (let i = 0; i < M; i++) {
        if (bilinear(pan.h, N, N, i * sc, j * sc) < 0.4) continue;
        const x = this.rest[(j * M + i) * 3];
        lo = Math.min(lo, x); hi = Math.max(hi, x);
      }
      rows.push(lo <= hi ? [lo, hi] : null);
    }
    // Fill empty rows from the nearest row that has egg.
    for (let j = 0; j < M; j++) if (!rows[j]) {
      let d = 1;
      while (d < M && !rows[j - d] && !rows[j + d]) d++;
      rows[j] = rows[j - d] || rows[j + d] || [0, 0];
      rows[j] = { near: true, r: rows[j] };
    }
    return { zF, zN, xMax, rows };
  }

  // The wrist-tap fold: the far edge climbs the pan wall and flips back
  // over the top; each tap rolls more of the sheet into a tight spiral
  // that sits against the far lip. Football-shaped: tips pinched in.
  curl(x0, z0, th, roll, ri, pos, p3, kick) {
    const { zF, zN, xMax } = ri;
    const L = zN - zF;
    const Lr = roll * L * 0.94;
    const zc = zF + Lr;                         // fold line in sheet coords
    const R = clamp(Lr / (2 * Math.PI * 0.95), 0.45, 2.6);
    const wallZ = -9.4;                         // where the log rests
    const shift = (wallZ + R) - zc;             // slide the whole sheet far
    const slide = Math.min(1, roll * 3);
    const halfLen = lerp(xMax, xMax * 0.7, roll);
    let x = x0 * lerp(1, 0.7, roll);
    let y, z;
    if (z0 >= zc) {
      // Still flat; sliding toward the far side.
      y = FLOOR + th;
      z = z0 + shift * slide;
    } else {
      const s = zc - z0;
      const phi = s / R;
      const r = Math.max(0.25, R - 0.16 * phi + th * 0.5);
      const taper = Math.sqrt(Math.max(0.05, 1 - (x / (halfLen + 0.01)) ** 2));
      const tp = 0.35 + 0.65 * taper;
      const rr = r * tp, rr0 = (R + th * 0.5) * tp;
      y = FLOOR + rr0 - rr * Math.cos(phi) + th * 0.3;
      z = zc + shift * slide - rr * Math.sin(phi);
      // Pinch the tips toward the middle a little more.
      x *= 0.92 + 0.08 * taper;
    }
    y += kick * 0.6;
    pos[p3] = x; pos[p3 + 1] = y; pos[p3 + 2] = z;
  }

  reset() {
    this.rollInfo = null;
    this.top.visible = this.bot.visible = false;
    this.pat.visible = this.pool.visible = this.foam.visible = false;
    this.stream.visible = false;
  }
}

export class Chopsticks {
  constructor(parent) {
    const g = (this.group = new THREE.Group());
    const wood = new THREE.MeshPhysicalMaterial({ color: 0xc89a62, roughness: 0.55, clearcoat: 0.3 });
    for (const o of [-0.45, 0.45]) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.12, 24, 10), wood);
      c.geometry.translate(0, 12, 0);
      c.position.x = o;
      c.castShadow = true;
      g.add(c);
    }
    g.visible = false;
    parent.add(g);
  }
  place(p, down, t) {
    this.group.visible = !!p;
    if (!p) return;
    this.group.position.set(p.x, p.y + (down ? 0.1 : 1.2), p.z);
    this.group.rotation.set(-0.55, 0.5, -0.35);
    this.group.children[0].position.x = down ? -0.25 : -0.5;
    this.group.children[1].position.x = down ? 0.25 : 0.5;
  }
}
