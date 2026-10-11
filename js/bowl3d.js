// Mixing bowl on a wooden board, with the beaten egg as a live surface.
import * as THREE from '../vendor/three.module.min.js';
import { lathe, gridGeometry, dataTexture } from './world.js';
import { woodTexture } from './textures.js';
import { bilinear, clamp, sstep, lerp, BN } from './sim.js';
import { rawEggRGB } from './pan3d.js';

const M = 110;
const LIQ_Y = 2.9;   // liquid surface height inside the bowl (cm)
const LIQ_R = 6.55;  // liquid radius (cm), matches the bowl wall at that height

export class Bowl3D {
  constructor(world, origin, wood) {
    const g = (this.group = new THREE.Group());
    g.position.copy(origin);
    world.scene.add(g);
    // Counter.
    const board = new THREE.Mesh(new THREE.PlaneGeometry(90, 70), new THREE.MeshPhysicalMaterial({ map: wood, roughness: 0.55, clearcoat: 0.15 }));
    board.rotation.x = -Math.PI / 2; board.receiveShadow = true;
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
    this.mat = new THREE.MeshPhysicalMaterial({ map: this.tex, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.04, transparent: true, depthWrite: true });
    this.liquid = new THREE.Mesh(this.geo, this.mat);
    this.liquid.position.y = LIQ_Y; this.liquid.visible = false; this.liquid.receiveShadow = true;
    g.add(this.liquid);
    // Falling egg (for the crack).
    this.shellMat = new THREE.MeshPhysicalMaterial({ color: 0xf1dfc6, roughness: 0.55, sheen: 0.4 });
    this.drop = new THREE.Mesh(new THREE.SphereGeometry(2.1, 32, 24), this.shellMat);
    this.drop.scale.set(1, 1.3, 1); this.drop.visible = false; this.drop.castShadow = true;
    g.add(this.drop);
    this.dropT = -1;
    // Floating shell bits.
    this.bits = [];
    this.bitGeo = new THREE.SphereGeometry(0.9, 10, 6, 0, Math.PI * 0.7, 0, Math.PI * 0.4);
  }

  liquidY() { return LIQ_Y; }
  // Bowl grid cell <-> local cm.
  toCell(x, z) {
    const s = (2 * LIQ_R) / (BN - 1);
    return [x / s + (BN - 1) / 2, z / s + (BN - 1) / 2];
  }
  toLocal(gx, gy) {
    const s = (2 * LIQ_R) / (BN - 1);
    return [(gx - (BN - 1) / 2) * s, (gy - (BN - 1) / 2) * s];
  }

  crackAnim() { this.dropT = 0; this.drop.visible = true; }

  update(bowl, t, dt) {
    if (this.dropT >= 0) {
      this.dropT += dt;
      const y = 18 - this.dropT * this.dropT * 90;
      this.drop.position.set(0.5, Math.max(LIQ_Y + 1, y), 0.3);
      if (y < LIQ_Y + 1) { this.drop.visible = false; this.dropT = -1; }
    }
    // Shell fragments.
    while (this.bits.length < bowl.shells.length) {
      const m = new THREE.Mesh(this.bitGeo, this.shellMat);
      m.castShadow = true;
      this.group.add(m); this.bits.push(m);
    }
    while (this.bits.length > bowl.shells.length) this.group.remove(this.bits.pop());
    bowl.shells.forEach((s, i) => {
      const [x, z] = this.toLocal(s.x, s.y);
      this.bits[i].position.set(x, LIQ_Y + 0.12 + Math.sin(t * 2 + i) * 0.03, z);
      this.bits[i].rotation.set(Math.PI, s.rot, 0.2);
    });
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
      let lift = 0;
      for (const Y of bowl.yolks) {
        if (Y.intact <= 0) continue;
        const dd = Math.hypot(gx - Y.x, gy - Y.y);
        if (dd < Y.r) lift += Math.sqrt(1 - (dd / Y.r) ** 2) * 0.55 * Y.intact;
      }
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
