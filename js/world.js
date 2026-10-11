// The 3D kitchen: renderer, lighting, camera moves. Units are centimetres.
import * as THREE from '../vendor/three.module.min.js';
import { RoomEnvironment } from '../vendor/RoomEnvironment.js';
import { lerp, clamp } from './sim.js';

export const SETS = {
  bowl: new THREE.Vector3(-70, 0, 0),
  stove: new THREE.Vector3(0, 0, 0),
  plate: new THREE.Vector3(70, 0, 0),
};

export class World {
  constructor(canvas) {
    this.canvas = canvas;
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false }));
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.92;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color(0x0e0b09);
    const pm = new THREE.PMREMGenerator(r);
    this.envTex = pm.fromScene(new RoomEnvironment(r), 0.04).texture;
    scene.environment = this.envTex;
    // Dim the studio reflections a touch so the key light reads.
    scene.backgroundIntensity = 1;

    this.camera = new THREE.PerspectiveCamera(32, 4 / 3, 1, 600);
    this.camPos = new THREE.Vector3(0, 40, 34);
    this.camTarget = new THREE.Vector3(0, 0, 0);
    this.camFrom = null; this.camTo = null; this.camT = 1;

    // Warm key light from a window up-left, plus a cool rim.
    const key = (this.key = new THREE.DirectionalLight(0xfff1dc, 2.4));
    key.position.set(-22, 46, 18);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const sc = key.shadow.camera;
    sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 140;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 4;
    scene.add(key, key.target);
    const rim = (this.rim = new THREE.DirectionalLight(0xbcd2ff, 0.7));
    rim.position.set(26, 22, -30);
    scene.add(rim, rim.target);
    scene.add(new THREE.HemisphereLight(0xfff4e2, 0x2a1d14, 0.35));

    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.focus = SETS.stove.clone();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const c = this.canvas;
    const w = c.clientWidth || 800, h = c.clientHeight || 600;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // Keep the key light's shadow box on whatever we're looking at.
  setFocus(p) {
    this.focus.copy(p);
    this.key.position.set(p.x - 22, 46, p.z + 18);
    this.key.target.position.copy(p);
    this.rim.position.set(p.x + 26, 22, p.z - 30);
    this.rim.target.position.copy(p);
  }

  moveCamera(pos, target, dur = 1.2) {
    this.camFrom = { p: this.camPos.clone(), t: this.camTarget.clone() };
    this.camTo = { p: pos.clone(), t: target.clone() };
    this.camT = 0; this.camDur = dur;
  }
  snapCamera(pos, target) {
    this.camPos.copy(pos); this.camTarget.copy(target); this.camT = 1; this.camTo = null;
  }

  update(dt) {
    if (this.camTo && this.camT < 1) {
      this.camT = Math.min(1, this.camT + dt / this.camDur);
      const e = this.camT < 0.5 ? 4 * this.camT ** 3 : 1 - (-2 * this.camT + 2) ** 3 / 2;
      this.camPos.lerpVectors(this.camFrom.p, this.camTo.p, e);
      this.camTarget.lerpVectors(this.camFrom.t, this.camTo.t, e);
    }
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
  }

  // Studio reflections wash out food colours; keep them for metal only.
  tameReflections() {
    this.scene.traverse(o => {
      const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of ms) if ('envMapIntensity' in m && !(m.metalness > 0.5)) m.envMapIntensity = m.userData.env ?? 0.45;
    });
  }

  render() { this.renderer.render(this.scene, this.camera); }

  // Pointer (client coords) -> ray.
  rayFrom(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    return this.raycaster.ray;
  }
  // Hit a horizontal plane (in an object's local frame) at height y.
  hitLocalPlane(clientX, clientY, obj, y) {
    const ray = this.rayFrom(clientX, clientY).clone();
    obj.updateMatrixWorld();
    const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
    ray.applyMatrix4(inv);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y);
    const p = new THREE.Vector3();
    return ray.intersectPlane(plane, p) ? p : null;
  }
  project(v) {
    const p = v.clone().project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return [(p.x * 0.5 + 0.5) * r.width, (-p.y * 0.5 + 0.5) * r.height];
  }
}

// Lathe from an [r, y] profile, with smooth normals.
export function lathe(profile, segs = 96) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(pts, segs);
  g.userData.lathe = true;
  g.computeVertexNormals();
  return g;
}

// A grid mesh we can deform every frame. Vertex (i,j) at index j*M+i,
// uv = (i/(M-1), j/(M-1)); j grows toward +z (the cook).
export function gridGeometry(M, span) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(M * M * 3), uv = new Float32Array(M * M * 2);
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    const k = j * M + i;
    pos[k * 3] = (i / (M - 1) - 0.5) * span;
    pos[k * 3 + 1] = 0;
    pos[k * 3 + 2] = (j / (M - 1) - 0.5) * span;
    uv[k * 2] = i / (M - 1); uv[k * 2 + 1] = j / (M - 1);
  }
  const idx = [];
  for (let j = 0; j < M - 1; j++) for (let i = 0; i < M - 1; i++) {
    const a = j * M + i, b = a + 1, c = a + M, d = c + 1;
    // Counter-clockwise seen from +y.
    idx.push(a, c, b, b, c, d);
  }
  g.setIndex(idx);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

export function dataTexture(M, srgb = true) {
  const data = new Uint8Array(M * M * 4);
  const t = new THREE.DataTexture(data, M, M, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
