// Mixing bowl on a wooden board, with the beaten egg as a live surface.
import * as THREE from '../vendor/three.module.min.js';
import { lathe, gridGeometry, dataTexture } from './world.js';
import { woodTexture } from './textures.js';
import { bilinear, clamp, sstep, lerp, BN, MAX_EGGS } from './sim.js';
import { rawEggRGB } from './pan3d.js';
import { subsurface } from './materials.js';

const M = 110;
const LIQ_Y = 2.9;   // liquid surface height with three eggs (cm)
const LIQ_R = 6.55;  // liquid radius (cm), matches the bowl wall at that height
// Surface height and radius for 0-5 eggs, from the bowl's inner profile.
const LEVEL_Y = [0.6, 1.71, 2.38, 2.9, 3.34, 3.74, 4.1];
const LEVEL_R = [3.4, 5.07, 5.96, 6.55, 7.0, 7.38, 7.7];
// The bowl sits this far left of the set's centre (cm); the counter doesn't move.
const SHIFT = 1.5;
// The carton: two rows of three cups to the right of the bowl.
const CARTON = { x: 19.1, z: -1.3, w: 9.6, d: 14.2, h: 2.2 };
const CUPS = [[-2.3, -4.6], [2.3, -4.6], [-2.3, 0], [2.3, 0], [-2.3, 4.6], [2.3, 4.6]];

export class Bowl3D {
  constructor(world, origin, wood) {
    const g = (this.group = new THREE.Group());
    g.position.copy(origin);
    g.position.x -= SHIFT;
    world.scene.add(g);
    // Counter.
    const board = new THREE.Mesh(new THREE.PlaneGeometry(90, 70), new THREE.MeshPhysicalMaterial({ map: wood, roughness: 0.55, clearcoat: 0.15 }));
    board.rotation.x = -Math.PI / 2; board.position.x = SHIFT; board.receiveShadow = true;
    g.add(board);
    // Ceramic bowl.
    const prof = [[0.01, 0.25]];
    for (let k = 0; k <= 16; k++) { const t = k / 16; prof.push([0.3 + t * 9.0, 0.25 + Math.pow(t, 2.2) * 6.4]); }
    prof.push([9.6, 6.75], [9.9, 6.6]);
    for (let k = 0; k <= 16; k++) { const t = k / 16; prof.push([9.9 - Math.pow(t, 0.8) * 5.8, 6.6 - t * 6.6]); }
    prof.push([0.01, 0]);
    const glaze = new THREE.MeshPhysicalMaterial({ color: 0xf6f3ec, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.08, side: THREE.DoubleSide });
    const bowl = new THREE.Mesh(lathe(prof, 96), glaze);
    bowl.castShadow = bowl.receiveShadow = true;
    g.add(bowl);
    const band = new THREE.Mesh(new THREE.TorusGeometry(9.55, 0.13, 8, 96), new THREE.MeshPhysicalMaterial({ color: 0x22409a, roughness: 0.25, clearcoat: 1 }));
    band.rotation.x = Math.PI / 2; band.position.y = 6.2;
    g.add(band);

    // Beaten egg surface.
    this.geo = gridGeometry(M, LIQ_R * 2);
    this.rest = Float32Array.from(this.geo.attributes.position.array);
    this.tex = dataTexture(M);
    this.mat = subsurface(new THREE.MeshPhysicalMaterial({ map: this.tex, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.04, transparent: true, depthWrite: true }));
    this.liquid = new THREE.Mesh(this.geo, this.mat);
    this.liquid.position.y = LIQ_Y; this.liquid.visible = false; this.liquid.receiveShadow = true;
    g.add(this.liquid);
    this.liqY = LIQ_Y; this.liqR = LIQ_R;
    this.buildCarton();
    // Falling egg (for the crack).
    this.shellMat = new THREE.MeshPhysicalMaterial({ color: 0xf1dfc6, roughness: 0.55, sheen: 0.4 });
    this.buildCrackRig();
    this.crackT = -1;
    // Floating shell bits.
    this.bits = [];
    this.yolkGeo = new THREE.SphereGeometry(1, 40, 24, 0, Math.PI * 2, 0, Math.PI / 2);
    this.yolkMat = subsurface(new THREE.MeshPhysicalMaterial({ color: 0xe8780a, roughness: 0.2, clearcoat: 0.6, clearcoatRoughness: 0.08, envMapIntensity: 0.4 }), { color: [1, 0.45, 0.05], wrap: 0.6, back: 0.5 });
    this.yolkMeshes = [];
    this.bitGeo = new THREE.SphereGeometry(0.9, 10, 6, 0, Math.PI * 0.7, 0, Math.PI * 0.4);
  }

  liquidY() { return this.liqY; }
  // Bowl grid cell <-> local cm. The grid spans the liquid, which widens
  // as it rises up the bowl.
  toCell(x, z) {
    const s = (2 * this.liqR) / (BN - 1);
    return [x / s + (BN - 1) / 2, z / s + (BN - 1) / 2];
  }
  toLocal(gx, gy) {
    const s = (2 * this.liqR) / (BN - 1);
    return [(gx - (BN - 1) / 2) * s, (gy - (BN - 1) / 2) * s];
  }

  // A pulp-card egg carton, full.
  buildCarton() {
    const pulp = new THREE.MeshPhysicalMaterial({ color: 0xb9a786, roughness: 0.95, sheen: 0.2 });
    const c = (this.carton = new THREE.Group());
    c.position.set(CARTON.x, 0, CARTON.z);
    const base = new THREE.Mesh(new THREE.BoxGeometry(CARTON.w, CARTON.h * 0.55, CARTON.d), pulp);
    base.position.y = CARTON.h * 0.275; base.castShadow = base.receiveShadow = true;
    c.add(base);
    const cupGeo = new THREE.CylinderGeometry(2.05, 1.6, CARTON.h, 24, 1, true);
    const cupIn = new THREE.MeshPhysicalMaterial({ color: 0xa8957a, roughness: 1, side: THREE.DoubleSide });
    for (const [x, z] of CUPS) {
      const cup = new THREE.Mesh(cupGeo, cupIn);
      cup.position.set(x, CARTON.h * 0.5, z); cup.castShadow = cup.receiveShadow = true;
      c.add(cup);
    }
    // Upright whole eggs, pointy end up.
    const pts = [];
    for (let k = 0; k <= 28; k++) {
      const t = k / 28, y = -Math.cos(Math.PI * t) * 2.8;
      pts.push([Math.max(0.01, Math.sin(Math.PI * t) * 2.1 * (1 - 0.1 * (y / 2.8))), y]);
    }
    const eggGeo = lathe(pts, 40);
    const shell = new THREE.MeshPhysicalMaterial({ color: 0xe8cfae, roughness: 0.65, sheen: 0.3, sheenColor: new THREE.Color(0xfff4e0), envMapIntensity: 0.5 });
    this.cartonEggs = CUPS.slice(0, MAX_EGGS).map(([x, z]) => {
      const e = new THREE.Mesh(eggGeo, shell);
      e.position.set(x, CARTON.h + 1.6, z); e.castShadow = true;
      c.add(e);
      return e;
    });
    this.group.add(c);
  }
  // Put every egg back in the carton for a new trial.
  resetCarton() {
    for (const e of this.cartonEggs) e.visible = true;
    this.liqY = LEVEL_Y[0]; this.liqR = LEVEL_R[0];
  }
  // Is local point p (on the carton's top plane) over the carton?
  overCarton(p) {
    return p && Math.abs(p.x - CARTON.x) < CARTON.w / 2 + 0.5 && Math.abs(p.z - CARTON.z) < CARTON.d / 2 + 0.5;
  }
  cartonTopY() { return CARTON.h + 1.6; }
  // Lift the egg nearest p (or the next one) out of the carton; returns where it was.
  takeEgg(p) {
    const left = this.cartonEggs.filter(e => e.visible);
    if (!left.length) return null;
    const at = e => new THREE.Vector3(CARTON.x + e.position.x, e.position.y, CARTON.z + e.position.z);
    const pick = p ? left.reduce((a, b) => (at(a).distanceToSquared(p) <= at(b).distanceToSquared(p) ? a : b)) : left[0];
    pick.visible = false;
    return at(pick);
  }

  // A whole egg, split into two shell halves along the crack line.
  buildCrackRig() {
    const half = (from, to) => {
      const pts = [];
      for (let k = 0; k <= 28; k++) {
        const t = from + ((to - from) * k) / 28;
        const y = -Math.cos(Math.PI * t) * 2.8;
        const r = Math.max(0.01, Math.sin(Math.PI * t) * 2.1 * (1 - 0.1 * (y / 2.8)));
        pts.push([r, y]);
      }
      return lathe(pts, 48);
    };
    const outer = new THREE.MeshPhysicalMaterial({ color: 0xe8cfae, roughness: 0.65, sheen: 0.3, sheenColor: new THREE.Color(0xfff4e0), envMapIntensity: 0.5 });
    const membrane = new THREE.MeshPhysicalMaterial({ color: 0xf7f3ea, roughness: 0.4, side: THREE.BackSide, envMapIntensity: 0.5 });
    const SPLIT = 0.53;
    const mk = geo => {
      const gg = new THREE.Group();
      const a = new THREE.Mesh(geo, outer), b = new THREE.Mesh(geo, membrane);
      a.castShadow = true;
      gg.add(a, b);
      return gg;
    };
    this.egg = new THREE.Group();
    this.eggTilt = new THREE.Group();
    this.eggTilt.rotation.z = -Math.PI / 2;          // long axis horizontal
    this.hA = mk(half(0, SPLIT));
    this.hB = mk(half(SPLIT, 1));
    this.splitY = -Math.cos(Math.PI * SPLIT) * 2.8;
    this.eggTilt.add(this.hA, this.hB);
    this.egg.add(this.eggTilt);
    this.egg.visible = false;
    this.group.add(this.egg);
    // What falls out: yolk and white.
    this.fallYolk = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), subsurface(new THREE.MeshPhysicalMaterial({ color: 0xe8780a, roughness: 0.15, clearcoat: 0.8, envMapIntensity: 0.4 }), { color: [1, 0.45, 0.05], wrap: 0.6, back: 0.5 }));
    this.fallWhite = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), new THREE.MeshPhysicalMaterial({ color: 0xf4efd8, roughness: 0.05, clearcoat: 1, transparent: true, opacity: 0.45, depthWrite: false, envMapIntensity: 0.6 }));
    this.fallYolk.visible = this.fallWhite.visible = false;
    this.group.add(this.fallYolk, this.fallWhite);
  }

  get crackBusy() { return this.crackT >= 0; }

  // Bring an egg in, tap it on the rim, pull it apart over `target`
  // (local x/z) and let the yolk and white fall in.
  crackAnim(target, onTap, onDrop, from) {
    if (this.crackBusy) return false;
    this.crackT = 0; this.crackTarget = target; this.onTap = onTap; this.onDrop = onDrop;
    this.crackFrom = from || new THREE.Vector3(17, 15, 3);
    this.tapped = false; this.dropped = false;
    this.egg.visible = true;
    this.hA.position.set(0, 0, 0); this.hB.position.set(0, 0, 0);
    this.hA.rotation.set(0, 0, 0); this.hB.rotation.set(0, 0, 0);
    this.egg.scale.setScalar(1);
    return true;
  }

  updateCrack(dt) {
    if (this.crackT < 0) return;
    const t = (this.crackT += dt);
    const P = this.crackTarget;
    const ease = x => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
    const L = (a, b, k) => a + (b - a) * k;
    const rim = new THREE.Vector3(10.6, 8.3, 0);
    let pos;
    if (t < 0.3) {
      // Lift it from the carton and knock it on the rim.
      const k = ease(t / 0.3), F = this.crackFrom;
      pos = new THREE.Vector3(L(F.x, rim.x, k), L(F.y, rim.y, k) + Math.sin(Math.PI * k) * 4, L(F.z, rim.z, k));
      this.egg.rotation.set(0, 0, L(0.9, 0.15, k));
    } else if (t < 0.42) {
      if (!this.tapped) { this.tapped = true; this.onTap && this.onTap(); }
      const k = ease((t - 0.3) / 0.12);
      pos = new THREE.Vector3(L(rim.x, 11.6, k), L(rim.y, 9.4, k), 0);
      this.egg.rotation.set(0, 0, 0.15);
    } else if (t < 0.7) {
      // Over the bowl.
      const k = ease((t - 0.42) / 0.28);
      pos = new THREE.Vector3(L(11.6, P.x, k), L(9.4, 10.6, k), L(0, P.z, k));
      this.egg.rotation.set(0, 0, L(0.15, 0, k));
    } else {
      pos = new THREE.Vector3(P.x, 10.6, P.z);
      // Thumbs pull the halves apart; the open ends tip down.
      const k = ease((t - 0.7) / 0.25);
      const away = Math.max(0, t - 1.0);
      this.hA.position.set(0, -k * 1.3 - away * 6, 0);
      this.hB.position.set(0, k * 1.3 + away * 6, 0);
      this.hA.rotation.z = -k * 1.0; this.hB.rotation.z = k * 1.0;
      this.egg.position.y = 10.6 + away * 8;
      const sh = Math.max(0, 1 - away * 2.2);
      this.egg.scale.setScalar(sh);
      if (sh <= 0) this.egg.visible = false;
    }
    if (t < 0.7) this.egg.position.copy(pos);
    else this.egg.position.set(P.x, this.egg.position.y, P.z);
    // Contents slip out of the gap and fall.
    const t0 = 0.8;
    if (t > t0 && !this.dropped) {
      const ft = t - t0;
      const y = 10.2 - 45 * ft * ft;
      const v = 90 * ft;
      this.fallYolk.visible = this.fallWhite.visible = true;
      this.fallYolk.position.set(P.x, y, P.z);
      this.fallYolk.scale.set(1.05, 1.05 * (1 + v * 0.01), 1.05);
      this.fallWhite.position.set(P.x + 0.3, y + 0.6, P.z);
      this.fallWhite.scale.set(1.6, 1.6 * (1 + v * 0.025), 1.4);
      if (y <= this.liqY + 0.5) {
        this.dropped = true;
        this.fallYolk.visible = this.fallWhite.visible = false;
        this.onDrop && this.onDrop();
      }
    }
    if (t > 1.6 && this.dropped) { this.crackT = -1; this.egg.visible = false; }
  }

  update(bowl, t, dt) {
    this.updateCrack(dt);
    // The surface rises (and widens) as each egg lands.
    const n = Math.min(bowl.eggs, LEVEL_Y.length - 1), k = 1 - Math.exp(-dt * 6);
    this.liqY = lerp(this.liqY, LEVEL_Y[n], k);
    this.liqR = lerp(this.liqR, LEVEL_R[n], k);
    this.liquid.position.y = this.liqY;
    this.liquid.scale.set(this.liqR / LIQ_R, 1, this.liqR / LIQ_R);
    // Shell fragments.
    while (this.bits.length < bowl.shells.length) {
      const m = new THREE.Mesh(this.bitGeo, this.shellMat);
      m.castShadow = true;
      this.group.add(m); this.bits.push(m);
    }
    while (this.bits.length > bowl.shells.length) this.group.remove(this.bits.pop());
    bowl.shells.forEach((s, i) => {
      const [x, z] = this.toLocal(s.x, s.y);
      this.bits[i].position.set(x, this.liqY + 0.12 + Math.sin(t * 2 + i) * 0.03, z);
      this.bits[i].rotation.set(Math.PI, s.rot, 0.2);
    });
    // Unbroken yolks: glossy domes that slump as the chopsticks break them.
    while (this.yolkMeshes.length < bowl.yolks.length) {
      const m = new THREE.Mesh(this.yolkGeo, this.yolkMat);
      m.castShadow = true; this.group.add(m); this.yolkMeshes.push(m);
    }
    const cs = (2 * this.liqR) / (BN - 1);
    bowl.yolks.forEach((Y, i) => {
      const m = this.yolkMeshes[i];
      m.visible = Y.intact > 0.05;
      const [x, z] = this.toLocal(Y.x, Y.y);
      const r = Y.r * cs * 0.82;
      m.position.set(x, this.liqY - r * 0.25, z);
      m.scale.set(r * (1 + (1 - Y.intact) * 0.3), r * 0.62 * Y.intact, r * (1 + (1 - Y.intact) * 0.3));
    });
    for (let i = bowl.yolks.length; i < this.yolkMeshes.length; i++) this.yolkMeshes[i].visible = false;
    if (!bowl.eggs) { this.liquid.visible = false; return; }
    this.liquid.visible = true;
    const pos = this.geo.attributes.position.array, d = this.tex.image.data;
    const sc = (BN - 1) / (M - 1);
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
      const k = j * M + i, o = k * 4;
      const gx = i * sc, gy = j * sc;
      const r = Math.hypot(gx - bowl.c, gy - bowl.c);
      const inside = sstep(bowl.R + 0.2, bowl.R - 0.6, r);
      const yk = bilinear(bowl.yk, BN, BN, gx, gy) * bowl.norm;
      const foam = bilinear(bowl.foam, BN, BN, gx, gy);
      const lift = 0;
      const c = rawEggRGB(clamp(yk, 0, 3));
      const fz = clamp(foam * 1.5, 0, 0.6);
      d[o] = lerp(c[0], 252, fz); d[o + 1] = lerp(c[1], 236, fz); d[o + 2] = lerp(c[2], 190, fz);
      // Raw white is see-through; yolk and beaten egg are not.
      d[o + 3] = Math.round(inside * 255 * lerp(0.5, 0.97, sstep(0.05, 0.9, yk)));
      pos[k * 3 + 1] = lift + foam * 0.05 + Math.sin(gx * 0.9 + t * 2) * Math.sin(gy * 0.8 - t * 1.6) * 0.008 * (1 - inside * 0) ;
    }
    this.tex.needsUpdate = true;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.computeVertexNormals();
  }
}
