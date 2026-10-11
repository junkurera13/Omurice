// The plate: ketchup rice, the omelette, the head chef's cut and the
// opening. The custard inside is a viscous fluid that runs over the rice
// as fast as its doneness allows.
import * as THREE from '../vendor/three.module.min.js';
import { lathe, gridGeometry, dataTexture } from './world.js';
import { skinTextures, custardTextures, riceTextures, custardColor, valueNoise, fbm } from './textures.js';
import { subsurface } from './materials.js';
import { buildPanBody } from './pan3d.js';
import { Flow, bilinear, clamp, sstep, lerp, rng } from './sim.js';

export const RICE = { a: 8.2, b: 5.7, h: 4.6 };
const PLATE_Y = 0.75;      // top of the plate's well
const G = 120, SPAN = 30;  // custard grid
const CELL = SPAN / (G - 1);
const U = 84, W = 64;      // omelette sheet resolution

export function plateTop(x, z) {
  const r = Math.hypot(x, z);
  if (r <= 9) return PLATE_Y;
  if (r <= 13.2) { const t = (r - 9) / 4.2; return PLATE_Y + Math.sin(t * Math.PI / 2) ** 1.5 * 1.05; }
  if (r <= 13.9) return PLATE_Y + 1.05 - ((r - 13.2) / 0.7) * 1.3;
  return 0;
}
export function riceTop(x, z) {
  const q = (x / RICE.a) ** 2 + (z / RICE.b) ** 2;
  if (q >= 1) return -1;
  return PLATE_Y + RICE.h * (1 - q) * (1 + 0.6 * q) - 0.05;
}
export function surface(x, z) { return Math.max(plateTop(x, z), riceTop(x, z)); }
function surfNormal(x, z, out) {
  const e = 0.05;
  out.set(-(surface(x + e, z) - surface(x - e, z)) / (2 * e), 1, -(surface(x, z + e) - surface(x, z - e)) / (2 * e)).normalize();
  return out;
}

// Mobility of the inside by doneness: raw runs, hanjuku oozes, set stays.
function mobility(dm) {
  if (dm <= 0.3) return 1;
  if (dm <= 0.45) return lerp(1, 0.4, (dm - 0.3) / 0.15);
  if (dm <= 0.62) return lerp(0.4, 0.14, (dm - 0.45) / 0.17);
  if (dm <= 0.8) return lerp(0.14, 0.0, (dm - 0.62) / 0.18);
  return 0;
}

export class Plate3D {
  constructor(world, origin, wood) {
    this.world = world;
    const g = (this.group = new THREE.Group());
    g.position.copy(origin);
    world.scene.add(g);
    const table = new THREE.Mesh(new THREE.PlaneGeometry(90, 70), new THREE.MeshPhysicalMaterial({ map: wood, roughness: 0.5, clearcoat: 0.25, clearcoatRoughness: 0.4 }));
    table.rotation.x = -Math.PI / 2; table.receiveShadow = true;
    g.add(table);
    // Plate.
    const prof = [[0.01, PLATE_Y]];
    for (let r = 0.5; r <= 14; r += 0.25) prof.push([r, plateTop(r, 0)]);
    prof.push([13.95, 0.2], [13.4, 0.05], [7, 0.05], [6.6, 0], [0.01, 0]);
    const plate = new THREE.Mesh(lathe(prof, 128), new THREE.MeshPhysicalMaterial({ color: 0xf7f5ef, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05, side: THREE.DoubleSide }));
    plate.castShadow = plate.receiveShadow = true;
    g.add(plate);
    const rimLine = new THREE.Mesh(new THREE.TorusGeometry(12.4, 0.07, 6, 128), new THREE.MeshPhysicalMaterial({ color: 0xb08a3c, metalness: 1, roughness: 0.25 }));
    rimLine.rotation.x = Math.PI / 2; rimLine.position.y = plateTop(12.4, 0) + 0.02;
    g.add(rimLine);
    this.buildRice();
    this.buildOmelette();
    this.buildCustard();
    this.buildKnife();
    // Placement ghost.
    this.ghost = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.MeshPhysicalMaterial({ color: 0xf6d36a, roughness: 0.4, transparent: true, opacity: 0.55, depthWrite: false }));
    this.ghost.visible = false;
    g.add(this.ghost);
    this.om = null;
  }

  buildRice() {
    const g = this.group, r = rng(77);
    // Base mound so no plate shows between grains.
    const RS = RICE.a * 2.1;
    const rt = riceTextures(RS);
    const rings = 40, segs = 96;
    const pos = [], uvs = [], idx = [];
    for (let i = 0; i <= rings; i++) for (let s = 0; s <= segs; s++) {
      const rr = (i / rings) * 0.995, th = (s / segs) * Math.PI * 2;
      const x = Math.cos(th) * rr * RICE.a, z = Math.sin(th) * rr * RICE.b;
      // Packed rice isn't smooth: a little lumpiness on the mound.
      const lump = Math.sin(x * 3.1 + z * 1.7) * Math.sin(z * 2.9 - x * 1.3) * 0.06;
      pos.push(x, riceTop(x, z) - 0.06 + lump * (1 - rr), z);
      uvs.push(x / RS + 0.5, z / RS + 0.5);
    }
    for (let i = 0; i < rings; i++) for (let s = 0; s < segs; s++) {
      const a = i * (segs + 1) + s, b = a + segs + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    const mg = new THREE.BufferGeometry();
    mg.setIndex(idx);
    mg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    mg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    mg.computeVertexNormals();
    const base = new THREE.Mesh(mg, subsurface(new THREE.MeshPhysicalMaterial({
      map: rt.map, bumpMap: rt.bump, bumpScale: 2.2, roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.35, side: THREE.DoubleSide,
    }), { color: [1, 0.45, 0.3], wrap: 0.4, back: 0.15 }));
    base.receiveShadow = true;
    g.add(base);
    // Grains of rice, each tinted by how much ketchup it caught.
    const n = 2600;
    const grain = new THREE.SphereGeometry(1, 8, 5);
    const mat = subsurface(new THREE.MeshPhysicalMaterial({ roughness: 0.38, clearcoat: 0.4, clearcoatRoughness: 0.3 }), { color: [1, 0.5, 0.35], wrap: 0.5, back: 0.25 });
    const im = new THREE.InstancedMesh(grain, mat, n);
    im.receiveShadow = true;
    const m4 = new THREE.Matrix4(), nrm = new THREE.Vector3(), t = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Color();
    const q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const ang = r() * Math.PI * 2, rr = Math.sqrt(r()) * 0.985;
      const x = Math.cos(ang) * rr * RICE.a, z = Math.sin(ang) * rr * RICE.b;
      const y = riceTop(x, z) - 0.03 - r() * 0.05;
      surfNormal(x, z, nrm);
      t.set(r() - 0.5, 0, r() - 0.5).normalize();
      t.addScaledVector(nrm, -t.dot(nrm)).normalize();
      b.crossVectors(t, nrm);
      m4.makeBasis(t, nrm, b);
      q.setFromRotationMatrix(m4);
      const tilt = new THREE.Quaternion().setFromAxisAngle(b, (r() - 0.5) * 0.6);
      q.premultiply(tilt);
      s.set(0.33 + r() * 0.05, 0.125, 0.135);
      p.set(x, y, z);
      m4.compose(p, q, s);
      im.setMatrixAt(i, m4);
      const k = r();
      if (k < 0.1) c.setRGB(0.9, 0.55, 0.36);
      else if (k < 0.8) c.setRGB(0.8 + r() * 0.08, 0.24 + r() * 0.07, 0.08 + r() * 0.04);
      else c.setRGB(0.64, 0.14, 0.06);
      c.convertSRGBToLinear();
      im.setColorAt(i, c);
    }
    g.add(im);
    // Peas, diced chicken, onion.
    const add = (geo, matl, count, scale, lift, colorFn) => {
      const mm = new THREE.InstancedMesh(geo, matl, count);
      mm.castShadow = true;
      for (let i = 0; i < count; i++) {
        const ang = r() * Math.PI * 2, rr = Math.sqrt(r()) * 0.93;
        const x = Math.cos(ang) * rr * RICE.a, z = Math.sin(ang) * rr * RICE.b;
        q.setFromEuler(new THREE.Euler(r() * 6, r() * 6, r() * 6));
        const sc = scale * (0.8 + r() * 0.4);
        s.set(sc, sc * (0.8 + r() * 0.3), sc);
        // Keep them below where the egg will lie on top of the mound.
        const top = (x / RICE.a) ** 2 + (z / RICE.b) ** 2 < 0.55 ? 0.4 : 0.18;
        p.set(x, riceTop(x, z) + lift * sc - top, z);
        m4.compose(p, q, s);
        mm.setMatrixAt(i, m4);
        if (colorFn) { colorFn(c, r); mm.setColorAt(i, c); }
      }
      g.add(mm);
    };
    add(new THREE.SphereGeometry(1, 14, 10), new THREE.MeshPhysicalMaterial({ color: 0x4f8a22, roughness: 0.3, clearcoat: 0.7 }), 26, 0.28, 0.4);
    add(new THREE.BoxGeometry(1, 1, 1, 2, 2, 2), new THREE.MeshPhysicalMaterial({ roughness: 0.55, clearcoat: 0.3 }), 22, 0.6, 0.1,
      (c, r) => c.setRGB(0.8, 0.5 + r() * 0.08, 0.32).convertSRGBToLinear());
    add(new THREE.BoxGeometry(1, 0.3, 0.6), new THREE.MeshPhysicalMaterial({ color: 0xf2e6d0, roughness: 0.2, clearcoat: 1, transparent: true, opacity: 0.8 }), 30, 0.5, 0.1);
  }

  buildOmelette() {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(U * W * 3), uv = new Float32Array(U * W * 2);
    for (let j = 0; j < W; j++) for (let i = 0; i < U; i++) {
      const k = j * U + i;
      uv[k * 2] = (i / (U - 1)) * 2.2; uv[k * 2 + 1] = (j / (W - 1)) * 2.4;
    }
    const idx = [];
    for (let j = 0; j < W - 1; j++) for (let i = 0; i < U - 1; i++) {
      const a = j * U + i, b = a + 1, c = a + U, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    geo.setIndex(idx);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.omGeo = geo;
    // Satin, not shiny: the outside of a good omelette is soft and smooth.
    this.skinMat = subsurface(new THREE.MeshPhysicalMaterial({ roughness: 0.48, clearcoat: 0.25, clearcoatRoughness: 0.4, bumpScale: 0.9 }));
    this.innerMat = subsurface(new THREE.MeshPhysicalMaterial({ roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.08, side: THREE.BackSide }));
    this.skin = new THREE.Mesh(geo, this.skinMat);
    this.inner = new THREE.Mesh(geo, this.innerMat);
    // The omelette rides in a carrier so it can be tipped out of the pan.
    this.carrier = new THREE.Group();
    this.group.add(this.carrier);
    for (const m of [this.skin, this.inner]) { m.castShadow = true; m.receiveShadow = true; m.visible = false; m.frustumCulled = false; this.carrier.add(m); }
    // The pan for plating. Pivot is the lip it tips over; handle points away.
    this.tipper = new THREE.Group();
    const panInner = new THREE.Group();
    panInner.rotation.y = Math.PI;
    panInner.position.set(0, -4.7, -12.6);
    buildPanBody(panInner);
    this.tipper.add(panInner);
    this.tipper.visible = false;
    this.group.add(this.tipper);
    this.aiming = false; this.tipping = false; this.tipDone = false;
  }

  buildCustard() {
    this.cGeo = gridGeometry(G, SPAN);
    this.cRest = Float32Array.from(this.cGeo.attributes.position.array);
    this.cTex = dataTexture(G, false);   // alpha (green channel) = where custard is
    this.cMat = subsurface(new THREE.MeshPhysicalMaterial({ alphaMap: this.cTex, roughness: 0.2, clearcoat: 0.7, clearcoatRoughness: 0.12, alphaTest: 0.5, bumpScale: 1.4 }), { color: [1, 0.5, 0.08], wrap: 0.6, back: 0.45 });
    // Custard texture tiles across the grid; set per dish in setCustardLook.
    const uv = this.cGeo.attributes.uv.array;
    this.cGeo.setAttribute('uv1', new THREE.BufferAttribute(Float32Array.from(uv), 2));
    this.cMesh = new THREE.Mesh(this.cGeo, this.cMat);
    this.cMesh.castShadow = true; this.cMesh.receiveShadow = true; this.cMesh.visible = false; this.cMesh.frustumCulled = false;
    this.group.add(this.cMesh);
    const n = G * G;
    this.ch = new Float32Array(n);
    this.cz = new Float32Array(n);
    this.cmob = new Float32Array(n);
    this.cmask = new Uint8Array(n).fill(1);
    this.cflow = new Flow(G, G, 0);
    this.curdN = valueNoise(G, 2.4, 31);
    this.crumbN = fbm(G, 33, 3, 6);
    this.baseZ = new Float32Array(n);
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const x = (i / (G - 1) - 0.5) * SPAN, z = (j / (G - 1) - 0.5) * SPAN;
      this.baseZ[j * G + i] = surface(x, z);
      if (Math.hypot(x, z) > 13.6) this.cmask[j * G + i] = 0;
    }
  }

  buildKnife() {
    const k = (this.knife = new THREE.Group());
    const sh = new THREE.Shape();
    sh.moveTo(0, 0);
    sh.lineTo(17, 0);
    sh.quadraticCurveTo(21, 0.2, 22.5, 1.4);
    sh.quadraticCurveTo(14, 3.3, 0, 4.0);
    sh.lineTo(0, 0);
    const bg = new THREE.ExtrudeGeometry(sh, { depth: 0.08, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 2, curveSegments: 24 });
    bg.translate(0, 0, -0.04);
    const blade = new THREE.Mesh(bg, new THREE.MeshPhysicalMaterial({ color: 0xdfe3e8, metalness: 1, roughness: 0.18, clearcoat: 0.3 }));
    blade.castShadow = true;
    k.add(blade);
    const hg = new THREE.BoxGeometry(11, 2.4, 1.7, 4, 2, 2);
    const handle = new THREE.Mesh(hg, new THREE.MeshPhysicalMaterial({ color: 0x2b1a12, roughness: 0.45, clearcoat: 0.6 }));
    handle.position.set(-5.6, 2.1, 0);
    handle.castShadow = true;
    k.add(handle);
    for (const x of [-3, -7.5]) {
      const rv = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.8, 12), new THREE.MeshStandardMaterial({ color: 0xcfd3d8, metalness: 1, roughness: 0.25 }));
      rv.rotation.x = Math.PI / 2; rv.position.set(x, 2.1, 0);
      k.add(rv);
    }
    k.visible = false;
    this.group.add(k);
  }

  /* ---------------- omelette ---------------- */

  place(spec) {
    // spec: {x, z, L, A, dm, br, cu, tears, creases}
    const tex = skinTextures(spec.br, 4, spec.tears);
    this.skinMat.map = tex.map; this.skinMat.bumpMap = tex.bump; this.skinMat.needsUpdate = true;
    const dm = spec.dm;
    const ct = custardTextures(dm, spec.cu);
    this.innerMat.map = ct.map; this.innerMat.bumpMap = ct.bump; this.innerMat.bumpScale = 1.2;
    this.innerMat.color.set(0xffffff);
    this.innerMat.needsUpdate = true;
    const wet = 1 - sstep(0.5, 0.85, dm);
    this.innerMat.roughness = lerp(0.7, 0.25, wet);
    this.innerMat.clearcoat = lerp(0.05, 0.5, wet);
    this.om = { ...spec, s: 0, sv: 0, sT: 0, uk: -2, drop: 0, t: 0, open: false, emitted: 0 };
    this.carrier.position.set(0, 0, 0); this.carrier.quaternion.identity(); this.carrier.scale.set(1, 1, 1);
    this.skin.position.set(0, 0, 0); this.inner.position.set(0, 0, 0);
    this.mob0 = mobility(dm);
    const raw = sstep(0.42, 0.18, dm);
    // About half the egg is inside the skin; raw egg also floods out.
    this.cVol = 32 + raw * 80;
    this.ch.fill(0);
    this.skin.visible = this.inner.visible = true;
    this.cMesh.visible = false;
    this.knife.visible = false;
    this.setCustardLook(spec);
    this.updateOmelette(0);
  }

  setCustardLook(spec) {
    const dm = spec.dm;
    const ct = custardTextures(dm, spec.cu, 12);
    ct.map.repeat.set(3, 3); ct.bump.repeat.set(3, 3);
    this.cMat.map = ct.map; this.cMat.bumpMap = ct.bump; this.cMat.needsUpdate = true;
    const wet = 1 - sstep(0.5, 0.85, dm);
    // Wet custard: a soft sheen, not a mirror.
    this.cMat.roughness = lerp(0.8, 0.3, wet);
    this.cMat.clearcoat = lerp(0, 0.45, wet);
    this.cMat.clearcoatRoughness = lerp(0.5, 0.22, wet);
  }

  // Head chef's cut: knife front moves from u=-1.05 to 1.05.
  startCut() {
    const o = this.om;
    o.open = true; o.t = 0;
    const d = o.dm;
    // How far the halves fall open.
    o.sT = d < 0.6 ? 1.0 : d < 0.7 ? lerp(1.0, 0.45, (d - 0.6) / 0.1) : lerp(0.45, 0.1, sstep(0.7, 0.9, d));
    o.stiff = sstep(0.5, 0.95, d);
    this.knife.visible = true;
  }

  /* ---------- plating: the pan tips the omelette onto the rice ---------- */

  // Centre of the closed omelette when it sits at (x, z) on the rice.
  restCentre(o) {
    const yb = Math.max(riceTop(o.x, o.z), plateTop(o.x, o.z)) - 0.25;
    return new THREE.Vector3(o.x, yb + o.A * 0.92, o.z);
  }
  aim(spec) {
    this.place({ ...spec, x: 0, z: 0 });
    this.aiming = true; this.tipping = false; this.tipDone = false;
    this.om.flat = 1;
    this.updateOmelette(0);
    this.tipper.visible = true;
    this.poseTip(0, 0);
  }
  setAim(x, z) {
    if (!this.aiming) return;
    const o = this.om;
    o.x = clamp(x, -3.2, 3.2); o.z = clamp(z, -3.2, 3.2);
    this.updateOmelette(0);
    this.poseTip(0, 0);
  }
  tip() {
    if (!this.aiming) return false;
    this.aiming = false; this.tipping = true; this.tipT = 0; this.sep = null;
    return true;
  }
  // phi: how far the omelette has turned over (0 in the pan, PI on the rice).
  poseTip(phi, t) {
    const o = this.om, A = o.A;
    const C = this.restCentre(o);
    const L0 = new THREE.Vector3(0, -3.8 + A * 0.92, -(2.4 + A * 1.18));
    const pivot = new THREE.Vector3(C.x, C.y + L0.y, C.z + L0.z);
    // Held up and back while aiming; swings down as it tips.
    const lift = 1 - sstep(0, 1.3, phi);
    pivot.add(new THREE.Vector3(0, 4.5 * lift, -2 * lift));
    const theta = Math.min(phi, 2.05);
    const away = Math.max(0, t - 1.35);
    this.tipper.position.set(pivot.x, pivot.y + away * 22, pivot.z - away * 18);
    this.tipper.rotation.set(theta - away * 1.2, 0, 0);
    this.tipper.visible = away < 0.8;
    // The omelette rides in the pan, then slides off the lip and lands.
    const phiS = 1.75;
    const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), phi + Math.PI);
    let centre;
    if (phi < phiS) {
      centre = L0.clone().applyAxisAngle(new THREE.Vector3(1, 0, 0), phi).add(pivot);
      this.sep = centre.clone();
    } else {
      const k = (phi - phiS) / (Math.PI - phiS);
      centre = this.sep.clone().lerp(C, k);
      centre.y += Math.sin(k * Math.PI) * 0.8;
    }
    this.skin.position.copy(C).negate(); this.inner.position.copy(C).negate();
    this.carrier.position.copy(centre);
    this.carrier.quaternion.copy(rot);
    // A soft squash as it lands.
    const land = t > 1.3 ? Math.sin(Math.min(1, (t - 1.3) / 0.35) * Math.PI) * Math.exp(-(t - 1.3) * 3) : 0;
    this.carrier.scale.set(1 + land * 0.08, 1 - land * 0.16, 1 + land * 0.08);
  }

  update(dt) {
    const o = this.om;
    if (!o) return;
    if (this.tipping) {
      this.tipT += dt;
      const t = this.tipT;
      const e = Math.min(1, t / 1.3);
      const phi = Math.PI * (e < 0.5 ? 2 * e * e : 1 - (-2 * e + 2) ** 2 / 2);
      if (t > 1.2 && o.flat > 0) { o.flat = 1 - sstep(1.2, 1.5, t); this.updateOmelette(0); }
      this.poseTip(phi, t);
      if (t > 2.0) {
        this.tipping = false; this.tipDone = true; this.tipper.visible = false;
        this.carrier.position.set(0, 0, 0); this.carrier.quaternion.identity(); this.carrier.scale.set(1, 1, 1);
        this.skin.position.set(0, 0, 0); this.inner.position.set(0, 0, 0);
      }
      return;
    }
    if (this.aiming) return;
    if (o.drop > 0) o.drop = Math.max(0, o.drop - dt * 2.6);
    if (o.open) {
      o.t += dt;
      const t = o.t;
      // Knife: descend, slice along the top, lift away.
      const L = o.L;
      let kx, ky, kz = o.z, krz = -0.18;
      const topY = (u) => riceTop(o.x + u * L, o.z) + 1.85 * o.A * Math.pow(Math.max(0, 1 - u * u), 0.55);
      if (t < 0.7) {
        const e = 1 - (1 - t / 0.7) ** 3;
        o.uk = -1.15;
        kx = o.x - L * 1.15; ky = lerp(topY(-1) + 14, topY(-0.9) - 0.4, e);
      } else if (t < 2.0) {
        const e = (t - 0.7) / 1.3;
        o.uk = lerp(-1.15, 1.15, e * e * (3 - 2 * e));
        const u = clamp(o.uk, -1, 1);
        kx = o.x + o.uk * L; ky = topY(u) - 0.5 + Math.sin(t * 22) * 0.06;
        krz = -0.18 + Math.sin(t * 11) * 0.03;
      } else {
        const e = Math.min(1, (t - 2.0) / 0.7);
        o.uk = 1.2;
        kx = o.x + L * 1.15 + e * 6; ky = topY(1) + 0.5 + e * e * 18;
        if (e >= 1) this.knife.visible = false;
      }
      // Contact point is ~12 cm along the blade from the heel.
      this.knife.position.set(kx - 12, ky, kz + 0.02);
      this.knife.rotation.set(0, 0, krz);
      // Spring toward the open shape; runny egg wobbles, firm egg doesn't.
      if (t > 0.8) {
        const k = 22, c = lerp(3.2, 12, o.stiff);
        o.sv += (k * (o.sT - o.s) - c * o.sv) * dt;
        o.s += o.sv * dt;
      }
    }
    this.updateOmelette(dt);
    if (o.open && o.s > 0.08) this.updateCustard(dt);
  }

  updateOmelette() {
    const o = this.om;
    const pos = this.omGeo.attributes.position.array;
    const L = o.L, A = o.A;
    const W1 = 7.6;
    const dropY = o.drop > 0 ? o.drop * o.drop * 12 : 0;
    const squash = o.drop > 0 && o.drop < 0.25 ? 1 - (0.25 - o.drop) * 0.4 : 1;
    const s = clamp(o.s, 0, 1.25);
    for (let j = 0; j < W; j++) {
      const w = -1 + (2 * j) / (W - 1);
      const theta = w * Math.PI;
      for (let i = 0; i < U; i++) {
        const u = -1 + (2 * i) / (U - 1);
        const k = (j * U + i) * 3;
        const p = Math.max(0, 1 - u * u);
        const a = A * Math.pow(p, 0.72) + 0.03;
        const x0 = o.x + u * L;
        // In the pan it's a straight football; on the rice it settles to the dome.
        const ybRice = Math.max(riceTop(x0, o.z), plateTop(x0, o.z)) - 0.25;
        const yb = o.flat ? lerp(ybRice, this.restCentre(o).y - o.A * 0.92, o.flat) : ybRice;
        let x = x0;
        let y = yb + a * 0.92 * (1 - Math.cos(theta)) * squash;
        let z = o.z + a * 1.18 * Math.sin(theta) / squash;
        if (s > 0.001) {
          // Only what the knife has passed can open; the cut edges go first.
          const gate = sstep(o.uk + 0.05, o.uk - 0.35, u);
          const sw = clamp((s * 1.45 - (1 - Math.abs(w)) * 0.5) / 0.95, 0, 1.25) * gate;
          if (sw > 0) {
            const Wo = W1 * Math.pow(p, 0.42);
            const x1 = o.x + u * L * 1.05, z1 = o.z + w * Wo;
            const y1 = surface(x1, z1) + 0.32;
            const e = sw < 1 ? sw * sw * (3 - 2 * sw) : 1 + (sw - 1) * 0.6;
            x = lerp(x, x1, e); z = lerp(z, z1, e);
            y = lerp(y, y1, e);
            const floor = surface(x, z) + 0.3;
            if (y < floor) y = floor;
          }
        }
        pos[k] = x; pos[k + 1] = y + dropY; pos[k + 2] = z;
      }
    }
    this.omGeo.attributes.position.needsUpdate = true;
    this.omGeo.computeVertexNormals();
  }

  updateCustard(dt) {
    const o = this.om;
    this.cMesh.visible = true;
    const { ch, cz, cmob, baseZ } = this;
    const s = clamp(o.s, 0, 1);
    const L = o.L * 1.05, W1 = 7.6;
    // Floor = rice/plate, plus the opened skin lying on it.
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const k = j * G + i;
      const x = (i / (G - 1) - 0.5) * SPAN, z = (j / (G - 1) - 0.5) * SPAN;
      const u = (x - o.x) / L;
      let skin = 0;
      if (Math.abs(u) < 1) {
        const Wo = W1 * Math.pow(1 - u * u, 0.42) * Math.min(1, s * 1.1);
        if (Math.abs(z - o.z) < Wo) skin = 0.34;
      }
      cz[k] = baseZ[k] + skin;
    }
    // Custard wells up out of the middle as the halves part.
    if (this.cVol > 0) {
      const rate = 32 / 1.1;
      const dv = Math.min(this.cVol, rate * dt * Math.min(1, s * 1.6));
      this.cVol -= dv;
      let wsum = 0;
      const band = 0.5 + s * 1.6;
      const cells = [];
      for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
        const x = (i / (G - 1) - 0.5) * SPAN, z = (j / (G - 1) - 0.5) * SPAN;
        const u = (x - o.x) / (o.L * 0.92);
        if (Math.abs(u) >= 1 || u > o.uk) continue;
        const dz = Math.abs(z - o.z);
        const bw = band * Math.pow(1 - u * u, 0.5);
        if (dz > bw) continue;
        const w = (1 - (dz / bw) ** 2) * Math.pow(1 - u * u, 0.6);
        cells.push([j * G + i, w]); wsum += w;
      }
      if (wsum > 0) for (const [k, w] of cells) ch[k] += (dv * w) / wsum / (CELL * CELL);
    }
    // It thickens as it settles: less flow as time goes on.
    const tau = lerp(6, 2.4, sstep(0.3, 0.6, o.dm));
    const m = this.mob0 * Math.exp(-Math.max(0, o.t - 1.2) / tau);
    cmob.fill(m);
    if (m > 0.002) {
      const sub = 4;
      // Thick and creamy: it holds a ~1.5 mm film and sags rather than runs.
      for (let q = 0; q < sub; q++) this.cflow.step(ch, cz, cmob, this.cmask, [], dt / sub, 30, 0.15);
    }
    this.renderCustard();
  }

  renderCustard() {
    const o = this.om;
    const pos = this.cGeo.attributes.position.array, d = this.cTex.image.data;
    const col = custardColor(o.dm);
    const done = sstep(0.45, 0.95, o.dm);
    const curd = (o.cu || 0.4);
    for (let k = 0; k < G * G; k++) {
      const h = this.ch[k];
      const cn = this.curdN[k], cr = this.crumbN[k];
      // Soft curds show as paler lumps; overcooked egg goes crumbly.
      const lump = curd * sstep(0.55, 0.85, cn) * (0.35 + done * 0.65);
      const crumb = done * sstep(0.4, 0.75, cr);
      const bump = lump * 0.16 + crumb * 0.16 * (h > 0.05 ? 1 : 0);
      pos[k * 3 + 1] = this.cz[k] + h + (h > 0.03 ? bump : -0.3);
      const a = h > 0.14 ? 255 : h > 0.06 ? ((h - 0.06) / 0.08) * 255 : 0;
      d[k * 4] = d[k * 4 + 1] = d[k * 4 + 2] = a; d[k * 4 + 3] = 255;
    }
    this.cTex.needsUpdate = true;
    this.cGeo.attributes.position.needsUpdate = true;
    this.cGeo.computeVertexNormals();
  }

  // How much of the rice's top the egg covers once it has settled.
  coverage() {
    const o = this.om;
    if (!o) return 0;
    let tot = 0, cov = 0;
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const x = (i / (G - 1) - 0.5) * SPAN, z = (j / (G - 1) - 0.5) * SPAN;
      if ((x / RICE.a) ** 2 + (z / RICE.b) ** 2 > 0.75) continue;
      tot++;
      const u = (x - o.x) / (o.L * 1.05);
      const Wo = Math.abs(u) < 1 ? 7.6 * Math.pow(1 - u * u, 0.42) * clamp(o.s, 0, 1) : 0;
      if (Math.abs(z - o.z) < Wo || this.ch[j * G + i] > 0.05) cov++;
    }
    return tot ? cov / tot : 0;
  }

  showGhost(p, spec) {
    if (!p) { this.ghost.visible = false; return; }
    this.ghost.visible = true;
    this.ghost.scale.set(spec.L, spec.A * 0.95, spec.A * 1.15);
    this.ghost.position.set(p.x, surface(p.x, p.z) + spec.A * 0.9 + 0.6, p.z);
  }

  reset() {
    this.om = null;
    this.aiming = this.tipping = this.tipDone = false;
    this.tipper.visible = false;
    this.skin.visible = this.inner.visible = this.cMesh.visible = this.knife.visible = this.ghost.visible = false;
    this.ch.fill(0);
  }
}
