// The chudail (monster), the crawler, other players, and apparitions.
import * as THREE from 'three';
import * as TX from './textures.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// ---------------- Blender models ----------------
const MODELS = {};
const ANIMATED = {};
export const CHARACTERS = [
  { key: 'adventurer', name: 'Marcus', role: 'the drifter' },
  { key: 'soldier', name: 'Vera', role: 'ex-army' },
  { key: 'hoodie', name: 'Leo', role: 'the skeptic' },
  { key: 'woman', name: 'Nadia', role: 'night nurse' },
  { key: 'man', name: 'Sam', role: 'the brother' },
  { key: 'punk', name: 'Jax', role: 'urban explorer' },
  { key: 'casual', name: 'Emily', role: 'the reporter' },
  { key: 'hooded', name: 'Rook', role: 'the medium' },
];
const DEFAULT_CHARS = ['adventurer', 'soldier', 'hoodie', 'woman'];
const loading = {};
// load one downloaded character on demand
export function ensureChar(key) {
  if (!CHARACTERS.some((c) => c.key === key)) return Promise.resolve();
  if (ANIMATED[key]) return Promise.resolve();
  if (!loading[key]) loading[key] = new Promise((res) => new GLTFLoader().load(`/models/${key}.glb`, (g) => { ANIMATED[key] = g; res(); }, undefined, () => res()));
  return loading[key];
}
export function charLoaded(key) { return !!ANIMATED[key]; }
let modelsPromise = null;
export function loadModels() {
  if (modelsPromise) return modelsPromise;
  const loader = new GLTFLoader();
  const get = (name) => new Promise((res) => loader.load(`/models/${name}.glb`, (g) => { MODELS[name] = g.scene; res(); }, undefined, (e) => { console.warn('model failed', name, e); res(); }));
  modelsPromise = Promise.all([get('hollow'), get('survivor')]);
  return modelsPromise;
}

const _q = new THREE.Quaternion();
function rigFrom(scene) {
  const inst = SkeletonUtils.clone(scene);
  inst.updateMatrixWorld(true);
  const bones = {};
  const wq = new THREE.Quaternion();
  inst.traverse((o) => {
    if (o.isBone) {
      o.getWorldQuaternion(wq); wq.invert();
      o.userData.rest = o.quaternion.clone();
      o.userData.ax = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)].map((a) => a.applyQuaternion(wq));
      bones[o.name] = o;
    }
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; }
  });
  return { inst, bones };
}
// rotate a bone about the model's X/Y/Z axes (as they were in the rest pose)
function pose(b, rx = 0, ry = 0, rz = 0) {
  if (!b) return;
  const q = b.quaternion.copy(b.userData.rest);
  if (rx) q.multiply(_q.setFromAxisAngle(b.userData.ax[0], rx));
  if (ry) q.multiply(_q.setFromAxisAngle(b.userData.ax[1], ry));
  if (rz) q.multiply(_q.setFromAxisAngle(b.userData.ax[2], rz));
}
// attach obj to bone so it sits at a given model-space transform in the rest pose
function mountAt(bone, obj, pos, rot = new THREE.Euler()) {
  const mount = new THREE.Group();
  const target = new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromEuler(rot), new THREE.Vector3(1, 1, 1));
  const local = bone.matrixWorld.clone().invert().multiply(target);
  local.decompose(mount.position, mount.quaternion, mount.scale);
  bone.add(mount); mount.add(obj);
  return mount;
}

const rr = (a, b) => a + Math.random() * (b - a);

function skinCanvas() {
  const S = 256, c = TX.canvas(S), g = c.getContext('2d');
  g.fillStyle = '#aaa396'; g.fillRect(0, 0, S, S);
  for (let k = 0; k < 60; k++) {
    const x = Math.random() * S, y = Math.random() * S, r = rr(8, 45);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(${Math.random() < 0.3 ? '80,50,70' : Math.random() < 0.5 ? '40,38,32' : '200,195,180'},${rr(0.15, 0.4)})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
  }
  g.strokeStyle = 'rgba(60,30,70,0.5)';
  for (let k = 0; k < 40; k++) {
    let x = Math.random() * S, y = Math.random() * S; g.lineWidth = rr(0.5, 1.8); g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s < 7; s++) { x += rr(-18, 18); y += rr(-25, 25); g.lineTo(x, y); } g.stroke();
  }
  for (let k = 0; k < 6; k++) { // sores / wounds
    const x = Math.random() * S, y = Math.random() * S;
    g.fillStyle = 'rgba(70,5,5,0.7)'; g.beginPath(); g.ellipse(x, y, rr(3, 9), rr(2, 6), Math.random() * 3, 0, 7); g.fill();
  }
  return c;
}

function faceCanvas() {
  const S = 512, c = TX.canvas(S), g = c.getContext('2d');
  g.drawImage(skinCanvas(), 0, 0, S, S);
  const fx = 128; // front of the sphere (u = 0.25)
  // sunken cheeks + brow shadow
  for (const sx of [-1, 1]) {
    const cg = g.createRadialGradient(fx + sx * 42, 300, 0, fx + sx * 42, 300, 40);
    cg.addColorStop(0, 'rgba(20,15,12,0.6)'); cg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = cg; g.fillRect(0, 0, S, S);
  }
  // eyes: deep black hollows
  for (const sx of [-1, 1]) {
    const ex = fx + sx * 30, ey = 228;
    const eg = g.createRadialGradient(ex, ey, 2, ex, ey, 30);
    eg.addColorStop(0, '#000'); eg.addColorStop(0.65, 'rgba(0,0,0,0.97)'); eg.addColorStop(1, 'rgba(10,5,5,0)');
    g.fillStyle = eg; g.beginPath(); g.ellipse(ex, ey, 22, 32, sx * 0.2, 0, 7); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.85)'; g.lineCap = 'round';
    for (let k = 0; k < 2; k++) { g.lineWidth = rr(2, 4); g.beginPath(); g.moveTo(ex + rr(-8, 8), ey + 24); g.lineTo(ex + rr(-10, 10), ey + rr(70, 140)); g.stroke(); }
  }
  // mouth: long, hanging open
  const my = 330;
  const mg = g.createRadialGradient(fx, my, 4, fx, my, 60);
  mg.addColorStop(0, '#000'); mg.addColorStop(0.7, '#0c0101'); mg.addColorStop(1, '#2a0303');
  g.fillStyle = mg; g.beginPath(); g.ellipse(fx, my, 24, 58, 0, 0, 7); g.fill();
  g.fillStyle = '#cfc6a0';
  for (let k = 0; k < 9; k++) {
    const a = Math.PI + (k / 8) * Math.PI; // top arc
    const x = fx + Math.cos(a) * 22, y = my + Math.sin(a) * 54;
    g.beginPath(); g.moveTo(x - 3, y); g.lineTo(x + 3, y); g.lineTo(x + rr(-1, 1), y + rr(8, 16)); g.fill();
    const b = (k / 8) * Math.PI; const x2 = fx + Math.cos(b) * 22, y2 = my + Math.sin(b) * 54;
    g.beginPath(); g.moveTo(x2 - 3, y2); g.lineTo(x2 + 3, y2); g.lineTo(x2 + rr(-1, 1), y2 - rr(8, 16)); g.fill();
  }
  g.strokeStyle = 'rgba(80,0,0,0.85)';
  for (let k = 0; k < 5; k++) { g.lineWidth = rr(2, 5); g.beginPath(); const x = fx + rr(-14, 14); g.moveTo(x, my + 50); g.lineTo(x + rr(-3, 3), my + rr(90, 170)); g.stroke(); }
  return c;
}

function gownCanvas() {
  const W = 256, H = 512, c = TX.canvas(W, H), g = c.getContext('2d');
  g.fillStyle = '#4a4a42'; g.fillRect(0, 0, W, H);
  for (let x = 0; x < W; x += 6) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,240'},${rr(0.02, 0.12)})`; g.fillRect(x, 0, rr(2, 6), H); }
  for (let k = 0; k < 30; k++) {
    const x = Math.random() * W, y = Math.random() * H, r = rr(10, 60);
    const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(${Math.random() < 0.35 ? '90,5,5' : '50,40,20'},${rr(0.25, 0.6)})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
  }
  for (let k = 0; k < 14; k++) { // old blood soaked in and run down
    const x = Math.random() * W, y0 = rr(0, H * 0.5), len = rr(80, 300);
    const gr = g.createLinearGradient(0, y0, 0, y0 + len); gr.addColorStop(0, 'rgba(70,4,4,0.85)'); gr.addColorStop(1, 'rgba(40,2,2,0)');
    g.fillStyle = gr; g.fillRect(x, y0, rr(2, 7), len);
  }
  g.globalCompositeOperation = 'destination-out';
  g.beginPath(); g.moveTo(0, H);
  for (let x = 0; x <= W; x += 8) g.lineTo(x, H - rr(30, 140) * (Math.random() < 0.2 ? 1.6 : 1));
  g.lineTo(W, H); g.closePath(); g.fill();
  for (let k = 0; k < 8; k++) { g.beginPath(); g.ellipse(Math.random() * W, rr(120, H - 100), rr(4, 14), rr(8, 26), Math.random(), 0, 7); g.fill(); }
  return c;
}

function hairCanvas() {
  const W = 256, H = 512, c = TX.canvas(W, H), g = c.getContext('2d');
  g.lineCap = 'round';
  for (let k = 0; k < 420; k++) {
    const x = Math.random() * W, len = H * rr(0.55, 1);
    g.strokeStyle = `rgba(${rr(5, 22)},${rr(4, 16)},${rr(3, 12)},${rr(0.7, 1)})`; g.lineWidth = rr(1, 3.5);
    g.beginPath(); g.moveTo(x, 0);
    let xx = x;
    for (let y = 0; y < len; y += 24) { xx += rr(-3, 3); g.lineTo(xx, y); }
    g.stroke();
  }
  return c;
}

// cold fresnel rim so her silhouette reads in the dark
function addRim(mat, color, power = 2.4) {
  const rim = new THREE.Color(color);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.rimColor = { value: rim };
    sh.fragmentShader = 'uniform vec3 rimColor;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      { float rimF = 1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0); totalEmissiveRadiance += rimColor * pow(rimF, ${power.toFixed(2)}); }`);
  };
  mat.customProgramCacheKey = () => 'rim' + power;
  return mat;
}

// long, wet, stringy hair: separate strands that hang to her waist and over her face
function addHairStrands(head, mat) {
  const strands = [];
  const strand = (len, w) => {
    const geo = new THREE.PlaneGeometry(w, len, 1, 10); geo.translate(0, -len / 2, 0);
    const pos = geo.attributes.position, wig = rr(-0.03, 0.03);
    for (let k = 0; k < pos.count; k++) { const y = pos.getY(k), f = -y / len; pos.setX(k, pos.getX(k) * (1 - f * 0.55) * (0.3 + 0.7 * Math.min(1, f * 5)) + Math.sin(f * 6 + wig * 80) * 0.012); pos.setZ(k, f * f * 0.06 - (1 - Math.min(1, f * 5)) * 0.03); }
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, mat);
  };
  // strands hang from a pivot at the centre of the skull, so they can be swung back to hang straight down
  // (gravity) while their roots slide over the scalp instead of leaving it
  const pivot = new THREE.Group(); pivot.position.set(0, 0.3, 0); head.add(pivot);
  const place = (m, x, y, z, ry, rx) => { const g = new THREE.Group(); g.rotation.order = 'YXZ'; g.position.set(x, y - 0.3, z); g.rotation.set(rx, ry, 0); g.add(m); pivot.add(g); strands.push({ g, rx, ph: Math.random() * 6.28 }); };
  for (let k = 0; k < 44; k++) { // crown, sides and back (angle 0 = back of the head, the face looks down -z)
    const a = rr(-2.35, 2.35), r = rr(0.12, 0.16), y = rr(0.24, 0.4);
    place(strand(rr(0.85, 1.45), rr(0.05, 0.1)), Math.sin(a) * r, y, Math.cos(a) * r, a, -rr(0.04, 0.22));
  }
  for (const x of [-0.12, -0.075, -0.035, 0.03, 0.085, 0.125]) { // curtain over the face, parted so one eye shows
    place(strand(rr(0.7, 1.15), rr(0.045, 0.075)), x + rr(-0.01, 0.01), rr(0.3, 0.36), -0.19, Math.PI + rr(-0.15, 0.15), rr(0.1, 0.2));
  }
  strands.forEach((h) => (h.g.children[0].castShadow = true));
  strands.pivot = pivot;
  return strands;
}

function addSmoke(root, tex) {
  const puffs = [];
  for (let k = 0; k < 10; k++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0x000000, transparent: true, opacity: 0, depthWrite: false }));
    root.add(sp);
    puffs.push({ sp, a: Math.random() * 6.28, r: rr(0.25, 0.55), y: Math.random() * 1.3, v: rr(0.15, 0.35), s: rr(0.8, 1.5) });
  }
  return (dt) => {
    for (const p of puffs) {
      p.y += p.v * dt; p.a += dt * 0.4;
      if (p.y > 1.4) { p.y = 0; p.a = Math.random() * 6.28; }
      const life = p.y / 1.4;
      p.sp.position.set(Math.cos(p.a) * p.r, p.y, Math.sin(p.a) * p.r);
      p.sp.scale.setScalar(p.s * (0.6 + life));
      p.sp.material.opacity = Math.sin(life * Math.PI) * 0.55;
    }
  };
}

const _hq = new THREE.Quaternion(), _rq = new THREE.Quaternion();
let shared = null;
function getShared() {
  if (shared) return shared;
  const sk = skinCanvas();
  shared = {
    skin: new THREE.MeshStandardMaterial({ map: TX.toTex(sk), bumpMap: TX.toTex(sk, { srgb: false }), bumpScale: 3, roughness: 0.42, color: 0xbab2a2 }),
    face: new THREE.MeshStandardMaterial({ map: TX.toTex(faceCanvas(), { repeat: false }), roughness: 0.45, color: 0xc8c0b0 }),
    gown: new THREE.MeshStandardMaterial({ map: TX.toTex(gownCanvas(), { repeat: false }), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.95, color: 0x8a857a }),
    hair: new THREE.MeshStandardMaterial({ map: TX.toTex(hairCanvas(), { repeat: false }), alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.55, color: 0x777777 }),
    hairCap: new THREE.MeshStandardMaterial({ color: 0x0b0806, roughness: 0.6 }),
    claw: new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 0.3 }),
    eye: new THREE.MeshBasicMaterial({ color: 0xfff4ea }),
    glow: TX.toTex(TX.glowCanvas(), { repeat: false }),
    ghostSkin: new THREE.MeshStandardMaterial({ color: 0x5a5650, roughness: 0.9, emissive: 0x08080c }),
  };
  return shared;
}

function limb(len, r0, r1, m) {
  const g = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, 8), m);
  mesh.position.y = -len / 2; mesh.castShadow = true; g.add(mesh);
  const joint = new THREE.Group(); joint.position.y = -len; g.add(joint);
  return { g, joint };
}

export function createMonster({ ghost = false } = {}) {
  const S = getShared();
  const skin = ghost ? S.ghostSkin : S.skin;
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const hips = new THREE.Group(); hips.position.y = 1.3; body.add(hips);

  // legs
  const legs = [];
  for (const s of [-1, 1]) {
    const thigh = limb(0.66, 0.05, 0.038, skin); thigh.g.position.set(s * 0.12, 0, 0); hips.add(thigh.g);
    const knee = new THREE.Mesh(new THREE.SphereGeometry(0.042, 8, 6), skin); thigh.joint.add(knee);
    const shin = limb(0.62, 0.036, 0.024, skin); thigh.joint.add(shin.g);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.035, 0.3), skin); foot.position.set(0, -0.62, -0.09); foot.castShadow = true; shin.g.add(foot);
    legs.push({ thigh: thigh.g, shin: shin.g, s });
  }
  // torso (gaunt lathe profile)
  const pts = [[0.11, 0], [0.09, 0.12], [0.075, 0.25], [0.11, 0.45], [0.15, 0.62], [0.16, 0.75], [0.11, 0.86], [0.05, 0.9]].map(([r, y]) => new THREE.Vector2(r, y));
  const torsoG = new THREE.Group(); torsoG.rotation.x = -0.38; hips.add(torsoG);
  const torso = new THREE.Mesh(new THREE.LatheGeometry(pts, 14), skin); torso.scale.set(1.15, 1, 0.7); torso.castShadow = true; torsoG.add(torso);
  for (let k = 0; k < 8; k++) {
    const kb = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 5), skin); kb.position.set(0, 0.08 + k * 0.1, 0.075 + Math.sin(k / 7 * Math.PI) * 0.04); torsoG.add(kb);
  }
  // torn hospital gown
  const gown = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.33, 1.2, 18, 6, true), S.gown);
  gown.scale.set(1.1, 1, 0.8); gown.position.y = 0.86 - 0.6; gown.castShadow = true; torsoG.add(gown);
  // arms: impossibly long
  const arms = [];
  for (const s of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(s * 0.19, 0.8, 0); torsoG.add(sh);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), skin); sh.add(knob);
    const up = limb(0.78, 0.032, 0.024, skin); sh.add(up.g);
    const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), skin); up.joint.add(elbow);
    const fore = limb(0.82, 0.024, 0.016, skin); up.joint.add(fore.g);
    const hand = new THREE.Group(); hand.position.y = -0.82; fore.g.add(hand);
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.025), skin); palm.position.y = -0.04; hand.add(palm);
    const fingers = [];
    for (let f = 0; f < 5; f++) {
      const fg = limb(f === 4 ? 0.2 : 0.32, 0.009, 0.005, skin);
      fg.g.position.set((f - 2) * 0.017, -0.08, 0); fg.g.rotation.z = (f - 2) * 0.1; hand.add(fg.g);
      const claw = new THREE.Mesh(new THREE.ConeGeometry(0.006, 0.06, 5), S.claw); claw.rotation.x = Math.PI; claw.position.y = -0.03; fg.joint.add(claw);
      fingers.push(fg.g);
    }
    up.g.rotation.z = s * 0.1;
    arms.push({ sh, up: up.g, fore: fore.g, fingers, s });
  }
  // neck + head
  const neck = new THREE.Group(); neck.position.y = 0.88; torsoG.add(neck);
  const neckMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, 0.3, 8), skin); neckMesh.position.y = 0.15; neck.add(neckMesh);
  const head = new THREE.Group(); head.position.y = 0.3; neck.add(head);
  const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.2, 28, 20), ghost ? S.ghostSkin : S.face);
  headMesh.scale.set(0.82, 1.5, 0.95); headMesh.rotation.y = Math.PI; headMesh.position.y = 0.16; headMesh.castShadow = true; head.add(headMesh);
  // long black hair hanging around the face
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.205, 20, 10, 0, Math.PI * 2, 0, 1.25), S.hairCap);
  cap.scale.copy(headMesh.scale); cap.position.copy(headMesh.position); cap.rotation.x = 0.15; head.add(cap);
  const hair = new THREE.Mesh(new THREE.CylinderGeometry(0.175, 0.27, 0.95, 24, 4, true, Math.PI + 0.62, Math.PI * 2 - 1.24), S.hair);
  hair.position.set(0, 0.16 + 0.3 - 0.475 + 0.02, 0.01); hair.castShadow = true; hair.name = 'hairSheet'; head.add(hair);
  const eyes = [];
  for (const sx of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(sx > 0 ? 0.011 : 0.008, 8, 6), S.eye);
    e.position.set(sx * 0.056, 0.205, -0.17); head.add(e);
    const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: S.glow, color: 0xff5030, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending }));
    gl.scale.setScalar(0.16); gl.position.copy(e.position); gl.position.z -= 0.01; head.add(gl);
    eyes.push(e, gl);
  }
  neck.rotation.x = -0.35; // head pushed forward

  const anim = { phase: 0, twitchT: 0, tilt: 0, tiltTarget: 0, turn: 0, turnTarget: 0 };
  root.userData.head = head;
  root.userData.update = (dt, speed, state, t) => {
    anim.phase += speed * dt * 2.3;
    const ph = anim.phase;
    const moving = speed > 0.1;
    const amp = Math.min(1, speed / 3);
    for (const L of legs) {
      const p = ph + (L.s > 0 ? Math.PI : 0);
      L.thigh.rotation.x = moving ? Math.sin(p) * 0.65 * amp : 0;
      L.shin.rotation.x = moving ? -Math.max(0, -Math.cos(p)) * 1.0 * amp : -0.05;
    }
    body.position.y = moving ? Math.abs(Math.sin(ph)) * 0.06 * amp : Math.sin(t * 1.3) * 0.01;
    body.rotation.z = moving ? Math.sin(ph) * 0.05 : 0;
    const chase = state === 'chase';
    for (const A of arms) {
      const p = ph + (A.s > 0 ? 0 : Math.PI);
      if (chase) {
        A.sh.rotation.x = 1.95 + Math.sin(t * 9 + A.s) * 0.15;
        A.fore.rotation.x = 0.25;
        A.fingers.forEach((f, k) => (f.rotation.x = 0.3 + Math.sin(t * 22 + k + A.s) * 0.4));
      } else {
        A.sh.rotation.x = 0.5 + (moving ? Math.sin(p) * 0.3 * amp : Math.sin(t * 0.9 + A.s) * 0.05);
        A.fore.rotation.x = 0.2 + (moving ? Math.max(0, Math.sin(p)) * 0.4 : 0);
        A.fingers.forEach((f, k) => (f.rotation.x = 0.25 + k * 0.05 + Math.sin(t * 2 + k) * 0.05));
      }
    }
    torsoG.rotation.x = chase ? -0.62 : -0.38;
    head.rotation.x = chase ? 0.95 : 0.72;
    // unnatural head twitches
    anim.twitchT -= dt;
    if (anim.twitchT <= 0) {
      anim.twitchT = chase ? 0.15 + Math.random() * 0.4 : 0.6 + Math.random() * 2.2;
      anim.tiltTarget = Math.random() < 0.25 ? (Math.random() < 0.5 ? -1 : 1) * (0.45 + Math.random() * 0.4) : (Math.random() - 0.5) * 0.4;
      anim.turnTarget = (Math.random() - 0.5) * (chase ? 0.4 : 1.2);
    }
    if (state === 'stall') anim.tiltTarget = 0.75;
    anim.tilt += (anim.tiltTarget - anim.tilt) * Math.min(1, dt * 18);
    anim.turn += (anim.turnTarget - anim.turn) * Math.min(1, dt * 14);
    head.rotation.z = anim.tilt; head.rotation.y = anim.turn;
    head.position.x = Math.sin(t * 31) * (chase ? 0.012 : 0.003);
  };
  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  root.userData.eyes = eyes;
  if (MODELS.hollow) upgradeMonster(root, { hips, head, gown, ghost, anim, S });
  return root;
}

function upgradeMonster(root, { hips, head, gown, ghost, anim, S }) {
  const { inst, bones: B } = rigFrom(MODELS.hollow);
  const mat = addRim(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, color: ghost ? 0x4a4744 : 0x878177, emissive: ghost ? 0x06060a : 0x0c0f15 }), ghost ? 0x3a4668 : 0x6f88c4, 2.2);
  inst.traverse((o) => { if (o.isMesh) o.material = mat; });
  hips.visible = false;
  // root -> flip (which surface: floor, ceiling, left/right wall) -> P (body laid flat for crawling) -> model
  const flip = new THREE.Group(), P = new THREE.Group();
  root.add(flip); flip.add(P); P.add(inst);
  const cr = { mode: 0, w: 1, ceil: 3, k: 0, rz: 0, px: 0, py: 0, ph: 0 };
  // mode 0 floor, 1 ceiling, 2 left wall, 3 right wall; w = distance from her to that wall; snap skips the blend
  root.userData.setCrawl = (mode, w = 1, ceil = 3, snap = false) => {
    cr.mode = mode; cr.w = w; cr.ceil = ceil;
    if (snap) { cr.k = mode ? 1 : 0; cr.rz = crRz(mode); cr.px = crPx(); cr.py = crPy(); }
  };
  const crRz = (mode) => (mode === 1 ? Math.PI : mode === 2 ? -Math.PI / 2 : mode === 3 ? Math.PI / 2 : 0);
  const crPx = () => (cr.mode === 2 ? -cr.w : cr.mode === 3 ? cr.w : 0);
  const crPy = () => (cr.mode === 1 ? cr.ceil - 0.02 : cr.mode >= 2 ? 1.55 : 0);
  // head (face, hair, glowing eyes) sits on the neck, tipped forward
  head.parent.remove(head); head.position.set(0, 0, 0); head.rotation.set(0, 0, 0);
  mountAt(B.head, head, new THREE.Vector3(0, 2.1, -0.43), new THREE.Euler(-0.35, 0, 0));
  // torn gown from the waist down
  gown.parent.remove(gown);
  const rag = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.3, 0.78, 18, 5, true), S.gown);
  rag.castShadow = true; rag.scale.set(1.1, 1, 0.85);
  mountAt(B.hips, rag, new THREE.Vector3(0, 1.08, -0.01));
  // a cold glow it carries with it, so you can SEE it coming down the hall (low and in front: lit from below)
  const glow = ghost ? null : new THREE.PointLight(0x8fa6dc, 4, 10, 1.3);
  if (glow) { glow.position.set(0, 1.15, -0.75); root.add(glow); }
  const hairMat = new THREE.MeshStandardMaterial({ map: S.hair.map, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.5, metalness: 0, color: 0x262422 });
  const strands = addHairStrands(head, hairMat);
  { // tuck the old hair sheet's flat top edge under the scalp; the strands give it volume
    const sheet = head.getObjectByName('hairSheet');
    sheet.geometry = new THREE.CylinderGeometry(0.15, 0.29, 1.15, 24, 4, true, Math.PI + 0.62, Math.PI * 2 - 1.24);
    sheet.position.y -= 0.14; sheet.material = hairMat;
    const cap = head.children.find((o) => o.isMesh && o.material === S.hairCap); if (cap) cap.scale.multiplyScalar(1.06);
  }
  const smoke = addSmoke(root, S.glow);
  const eyes = root.userData.eyes || [];
  const glitch = { t: rr(2, 6), on: 0 };
  Object.assign(root.userData, { bones: B, headObj: head, rag, inst, glow });
  const LR = [['_L', 1], ['_R', -1]];
  root.userData.update = (dt, speed, state, t) => {
    anim.phase += speed * dt * 2.3;
    const ph = anim.phase, moving = speed > 0.1, amp = Math.min(1, speed / 3);
    const chase = state === 'chase', stall = state === 'stall', sniff = state === 'sniff', stun = state === 'stunned';
    if (glow) { glow.intensity = (stun ? 6 + Math.random() * 3 : chase ? 6 : 4) * (0.85 + Math.random() * 0.15); glow.color.setHex(stun ? 0xffffff : chase ? 0xc0c8ff : 0x9fb4ff); }
    for (const [sfx, s] of LR) {
      const p = ph + (s > 0 ? Math.PI : 0);
      pose(B['thigh' + sfx], moving ? Math.sin(p) * 0.6 * amp : 0.04);
      pose(B['shin' + sfx], moving ? -Math.max(0, -Math.cos(p)) * 1.0 * amp : -0.08);
      // a chudail's feet point backwards
      pose(B['foot' + sfx], moving ? -Math.max(0, Math.cos(p)) * 0.3 * amp : 0, Math.PI);
      const pa = ph + (s > 0 ? 0 : Math.PI);
      if (stun) {
        pose(B['upperarm' + sfx], 2.5 + Math.sin(t * 30 + s) * 0.1, 0, s * 0.35);
        pose(B['forearm' + sfx], 1.6);
        pose(B['fingers' + sfx], 0.9 + Math.sin(t * 40 + s) * 0.3);
      } else if (chase) {
        pose(B['upperarm' + sfx], 1.25 + Math.sin(t * 9 + s) * 0.15, 0, s * 0.25);
        pose(B['forearm' + sfx], 0.35 + Math.sin(t * 7 + s) * 0.1);
        pose(B['fingers' + sfx], 0.5 + Math.sin(t * 25 + s * 2) * 0.4);
      } else if (sniff) {
        pose(B['upperarm' + sfx], 0.5 + Math.sin(t * 3 + s) * 0.08, 0, s * 0.1);
        pose(B['forearm' + sfx], 0.6);
        pose(B['fingers' + sfx], 0.2 + Math.sin(t * 14 + s * 3) * 0.35);
      } else {
        pose(B['upperarm' + sfx], (moving ? Math.sin(pa) * 0.28 * amp : Math.sin(t * 0.9 + s) * 0.05), 0, s * 0.04);
        pose(B['forearm' + sfx], 0.12 + (moving ? Math.max(0, Math.sin(pa)) * 0.3 * amp : 0));
        pose(B['fingers' + sfx], 0.15 + Math.sin(t * 2 + s) * 0.08);
      }
      pose(B['shoulder' + sfx], 0, 0, chase ? s * 0.12 : 0);
    }
    pose(B.spine, chase ? -0.28 : sniff ? -0.35 : 0, moving ? Math.sin(ph) * 0.06 : 0);
    pose(B.chest, chase ? -0.1 : 0, 0, moving ? Math.sin(ph) * 0.04 : 0);
    pose(B.neck, chase ? 0.3 : sniff ? 0.2 : 0);
    inst.position.y = moving ? Math.abs(Math.sin(ph)) * 0.05 * amp : Math.sin(t * 1.3) * 0.008;
    anim.twitchT -= dt;
    if (anim.twitchT <= 0) {
      anim.twitchT = chase ? 0.15 + Math.random() * 0.4 : 0.6 + Math.random() * 2.2;
      anim.tiltTarget = Math.random() < 0.25 ? (Math.random() < 0.5 ? -1 : 1) * (0.45 + Math.random() * 0.4) : (Math.random() - 0.5) * 0.4;
      anim.turnTarget = (Math.random() - 0.5) * (chase ? 0.4 : 1.2);
    }
    if (stall || sniff) anim.tiltTarget = sniff ? Math.sin(t * 1.5) * 0.7 : 0.75;
    anim.tilt += (anim.tiltTarget - anim.tilt) * Math.min(1, dt * 18);
    anim.turn += (anim.turnTarget - anim.turn) * Math.min(1, dt * 14);
    if (stun) { anim.tilt = Math.sin(t * 45) * 0.5; anim.turn = Math.sin(t * 37) * 0.4; }
    head.rotation.set(chase ? 0.35 : stun ? -0.3 : 0, anim.turn, anim.tilt);
    head.position.x = Math.sin(t * 31) * (chase ? 0.012 : 0.003);
    // crawling on the ceiling / a wall: blend onto the surface, then spider limbs (same pose as the Crawler)
    {
      const rate = Math.min(1, dt * 5);
      cr.k += ((cr.mode ? 1 : 0) - cr.k) * rate;
      cr.rz += (crRz(cr.mode) - cr.rz) * rate; cr.px += (crPx() - cr.px) * rate; cr.py += (crPy() - cr.py) * rate;
      flip.rotation.z = cr.rz; flip.position.set(cr.px, cr.py, 0);
      P.rotation.x = -Math.PI / 2 * cr.k; P.position.set(0, 0.72 * cr.k, 1.1 * cr.k);
      rag.visible = cr.k < 0.5;
      if (cr.k > 0.5) {
        cr.ph += (moving ? Math.max(2.5, speed) : 0.25) * dt * 3.4;
        for (const [sfx, s] of LR) {
          const a = Math.sin(cr.ph + (s > 0 ? 0 : Math.PI));
          pose(B['upperarm' + sfx], 1.35 + a * 0.45, 0, s * 0.75);
          pose(B['forearm' + sfx], -1.0 + Math.max(0, a) * 0.5);
          pose(B['hand' + sfx], 0.7);
          pose(B['fingers' + sfx], 0.3 + Math.sin(t * 18 + s) * 0.25);
          pose(B['thigh' + sfx], 1.35 - a * 0.45, 0, s * 0.85);
          pose(B['shin' + sfx], -1.9);
          pose(B['foot' + sfx], 0.6);
          pose(B['shoulder' + sfx], 0, 0, s * 0.15);
        }
        pose(B.spine, Math.sin(cr.ph * 2) * 0.06, Math.sin(cr.ph) * 0.08);
        pose(B.chest, 0.15); pose(B.neck, 1.15);
        // the head jerks around like it is not attached properly
        head.rotation.set(0.35 + Math.sin(t * 23) * 0.05, Math.sin(t * 2.7) * 0.35 + anim.turn * 0.5, Math.sin(t * 9) * 0.25 + anim.tilt);
        inst.position.y = 0;
      }
    }
    // hair hangs down whatever her head does (mostly), sways, and whips around when she runs
    head.getWorldQuaternion(_hq); root.getWorldQuaternion(_rq);
    strands.pivot.quaternion.identity().slerp(_hq.invert().multiply(_rq), 0.8);
    for (const h of strands) {
      h.g.rotation.z = Math.sin(t * 1.1 + h.ph) * 0.05 + (chase ? Math.sin(t * 8 + h.ph) * 0.1 : 0);
      h.g.rotation.x = h.rx + (moving ? Math.abs(Math.sin(ph + h.ph)) * 0.12 * amp : 0) + (chase ? 0.15 : 0);
    }
    // eyes: dim embers, flaring white-red when she hunts you
    for (let k = 1; k < eyes.length; k += 2) {
      const gl = eyes[k];
      const flare = chase ? 1 : stun ? 0.2 : 0.45 + Math.sin(t * 2.3 + k) * 0.15;
      gl.scale.setScalar(0.05 + flare * 0.07 + Math.random() * 0.01);
      gl.material.opacity = 0.45 + flare * 0.5;
      gl.material.color.setHex(chase ? 0xff3a20 : 0xff6040);
    }
    smoke(dt);
    // now and then she skips, like a bad frame of film
    glitch.t -= dt;
    if (glitch.on > 0) { glitch.on -= dt; if (glitch.on <= 0) { inst.position.x = 0; inst.position.z = 0; } }
    else if (glitch.t <= 0) {
      glitch.t = chase ? rr(0.8, 2.5) : rr(3, 8); glitch.on = rr(0.04, 0.09);
      inst.position.x = rr(-0.22, 0.22); inst.position.z = rr(-0.15, 0.15);
      anim.turn = rr(-0.8, 0.8); anim.tilt = rr(-0.7, 0.7);
    }
  };
}

function nameSprite(name, color) {
  const c = TX.canvas(512, 128), g = c.getContext('2d');
  g.font = 'bold 54px "Courier Prime", monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = '#000'; g.shadowBlur = 12; g.fillStyle = color; g.fillText(name, 256, 64);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TX.toTex(c, { repeat: false }), transparent: true, depthWrite: false, depthTest: false, fog: false, opacity: 0.85 }));
  s.renderOrder = 10;
  s.scale.set(1.0, 0.25, 1);
  return s;
}

// Teammates glow through walls: an extra copy of their body drawn only where something hides them.
export function addXray(body, col) {
  // drawn only where the real body is hidden (depth test reversed); pulled slightly toward the camera so it never shows on visible parts
  const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.4, depthWrite: false, depthFunc: THREE.GreaterDepth, fog: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -40 });
  const meshes = [];
  body.traverse((o) => {
    if (!(o.isMesh || o.isSkinnedMesh) || !o.visible) return;
    let p = o.parent, vis = true; while (p && p !== body) { if (!p.visible) vis = false; p = p.parent; }
    if (!vis || o.material.transparent || o.material.isMeshBasicMaterial) return; // skip beams, lenses, hidden parts
    meshes.push(o);
  });
  const list = [];
  for (const o of meshes) {
    let x;
    if (o.isSkinnedMesh) { x = new THREE.SkinnedMesh(o.geometry, mat); x.bind(o.skeleton, o.bindMatrix); }
    else x = new THREE.Mesh(o.geometry, mat);
    x.position.copy(o.position); x.quaternion.copy(o.quaternion); x.scale.copy(o.scale);
    x.renderOrder = 6; x.frustumCulled = false; x.castShadow = false;
    o.parent.add(x); list.push(x);
  }
  return list;
}

let beamTex = null;
export function createAvatar(name, color, charKey) {
  const S = getShared();
  const root = new THREE.Group();
  const col = new THREE.Color(color);
  const jacket = new THREE.MeshStandardMaterial({ color: col.clone().multiplyScalar(0.5), roughness: 0.8 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x23252b, roughness: 0.9 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.7 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xb98d6c, roughness: 0.65 });
  const body = new THREE.Group(); root.add(body);
  const add = (geo, m, x, y, z, parent = body) => { const me = new THREE.Mesh(geo, m); me.position.set(x, y, z); me.castShadow = true; parent.add(me); return me; };
  const torso = add(new THREE.CapsuleGeometry(0.17, 0.38, 4, 12), jacket, 0, 1.2, 0); torso.scale.set(1.25, 1, 0.75);
  add(new THREE.BoxGeometry(0.3, 0.36, 0.14), dark, 0, 1.22, 0.16); // backpack
  add(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 10), skin, 0, 1.5, 0); // neck
  const legs = [];
  for (const s of [-1, 1]) {
    const lg = new THREE.Group(); lg.position.set(s * 0.1, 0.86, 0); body.add(lg);
    add(new THREE.CapsuleGeometry(0.07, 0.62, 4, 8), pants, 0, -0.4, 0, lg);
    add(new THREE.BoxGeometry(0.1, 0.07, 0.22), dark, 0, -0.81, -0.04, lg);
    legs.push(lg);
  }
  // left arm hanging
  const larm = new THREE.Group(); larm.position.set(-0.24, 1.42, 0); larm.rotation.z = -0.12; body.add(larm);
  add(new THREE.CapsuleGeometry(0.055, 0.45, 4, 8), jacket, 0, -0.27, 0, larm);
  add(new THREE.SphereGeometry(0.05, 8, 6), skin, 0, -0.55, 0, larm);
  const headPivot = new THREE.Group(); headPivot.position.y = 1.64; body.add(headPivot);
  const head = add(new THREE.SphereGeometry(0.13, 16, 12), skin, 0, 0, 0, headPivot); head.scale.set(0.95, 1.12, 1.02);
  const hair = add(new THREE.SphereGeometry(0.135, 16, 12, 0, Math.PI * 2, 0, 1.5), dark, 0, 0.025, 0.01, headPivot); hair.rotation.x = 0.35; hair.scale.set(1, 1.1, 1.05);
  // arm + flashlight
  const arm = new THREE.Group(); arm.position.set(0.24, 1.42, 0); body.add(arm);
  const armM = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.4, 4, 8), jacket); armM.rotation.x = Math.PI / 2; armM.position.z = -0.22; arm.add(armM);
  const torch = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.22, 10), S.ghostSkin); torch.rotation.x = Math.PI / 2; torch.position.z = -0.5; arm.add(torch);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.035, 12), new THREE.MeshBasicMaterial({ color: 0xfff6e0 })); lens.position.z = -0.612; lens.rotation.y = Math.PI; arm.add(lens);
  if (!beamTex) {
    const c = TX.canvas(4, 128), g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, '#fff'); gr.addColorStop(0.4, '#555'); gr.addColorStop(1, '#000');
    g.fillStyle = gr; g.fillRect(0, 0, 4, 128); beamTex = TX.toTex(c, { srgb: false, repeat: false });
  }
  const beamGeo = new THREE.ConeGeometry(1.5, 8, 24, 1, true); beamGeo.translate(0, -4, 0); beamGeo.rotateX(Math.PI / 2);
  const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xfff0d0, alphaMap: beamTex, transparent: true, opacity: 0.03, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
  beam.position.z = -0.6; arm.add(beam);
  const light = new THREE.SpotLight(0xfff0d6, 40, 24, 0.42, 0.55, 1.5);
  light.position.set(0, 0, -0.6); arm.add(light);
  const tgt = new THREE.Object3D(); tgt.position.set(0, 0, -6); arm.add(tgt); light.target = tgt;
  const label = nameSprite(name, color); label.position.y = 2.0; root.add(label);
  const key = charKey || DEFAULT_CHARS[0];
  const glb = ANIMATED[key] ? animatedAvatar(body, arm, armM, ANIMATED[key]) : MODELS.survivor ? upgradeAvatar(body, arm, armM, col) : null;

  const xray = []; // no glow through walls for teammates (owner's call); names still show through walls
  root.userData = {
    shown: true, xray,
    setShown(v) { if (this.shown === v) return; this.shown = v; this.body.traverse((o) => { if (o.isMesh || o.isSprite) o.visible = v; }); if (!v) this.beam.visible = false; },
    phase: 0, legs, arm, headPivot, beam, light, lens, label, body, glb,
    setPose(pitch, fl, crouch, moving, dt, speed) {
      if (this.glb) return this.glb.setPose(this, pitch, fl, crouch, moving, dt, speed);
      this.arm.rotation.x = pitch; this.headPivot.rotation.x = pitch * 0.7;
      this.beam.visible = fl && this.shown; this.light.userData.on = fl; this.lens.material.color.set(fl ? 0xfff6e0 : 0x222222);
      const ty = crouch ? -0.45 : 0;
      this.body.position.y += (ty - this.body.position.y) * Math.min(1, dt * 10);
      if (moving) this.phase += dt * speed * 3.2;
      const a = moving ? Math.sin(this.phase) * 0.5 : 0;
      this.legs[0].rotation.x = a; this.legs[1].rotation.x = -a;
    },
    setDead() {
      this.light.userData.on = false; this.beam.visible = false; this.label.visible = false;
      for (const m of this.xray || []) m.material.color.set(0x8a2020);
      if (this.glb && this.glb.die) { this.glb.die(); this.arm.visible = false; return; }
      if (this.glb) { this.glb.inst.rotation.x = -Math.PI / 2; this.glb.inst.position.set(0, 0.15, 0.9); this.arm.visible = false; return; }
      this.body.rotation.x = -Math.PI / 2; this.body.position.set(0, 0.2, 0.6);
    },
  };
  return root;
}

// downloaded, pre-animated character (Quaternius, CC0 / CC-BY)
// A player's character sitting in the car for the intro cut scene (public/intro.js). Uses the character's own
// sitting animation when it has one, otherwise idle with the legs bent into a seat. update(dt, t, fear, look):
// look 0..1 lets the head wander, fear 0..1 throws the arms up in front of the face.
export function createSeatedCharacter(key, seed = 0) {
  const gltf = ANIMATED[key] || ANIMATED[DEFAULT_CHARS[0]];
  if (!gltf) return null;
  const inst = SkeletonUtils.clone(gltf.scene);
  const mixer = new THREE.AnimationMixer(inst);
  const find = (re) => gltf.animations.find((a) => re.test(a.name));
  const idle = find(/[|_]Idle$/) || find(/Idle/), sit = find(/Sitting$/);
  inst.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false;
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    o.material = ms.map((m) => { const c = m.clone(); c.roughness = 0.8; c.metalness = 0; return c; });
    if (o.material.length === 1) o.material = o.material[0];
  });
  if (idle) mixer.clipAction(idle).play();
  mixer.update(0); inst.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(inst, true);
  const k = 1.68 / ((box.max.y - box.min.y) || 1);
  mixer.stopAllAction();
  const act = mixer.clipAction(sit || idle);
  if (act) { act.play(); act.time = (seed * 0.61) % act.getClip().duration; }
  inst.updateMatrixWorld(true);
  const bn = {}; const wq = new THREE.Quaternion();
  inst.traverse((o) => {
    if (!o.isBone) return;
    o.getWorldQuaternion(wq); wq.invert();
    o.userData.axX = new THREE.Vector3(1, 0, 0).applyQuaternion(wq);
    o.userData.axY = new THREE.Vector3(0, 1, 0).applyQuaternion(wq);
    bn[o.name.toLowerCase().replace(/[^a-z0-9]/g, '')] = o;
  });
  const pick = (...n) => n.map((x) => bn[x]).find(Boolean);
  const B = {
    thighs: [pick('upperlegl', 'leftupleg'), pick('upperlegr', 'rightupleg')],
    shins: [pick('lowerlegl', 'leftleg'), pick('lowerlegr', 'rightleg')],
    uarms: [pick('upperarml', 'leftarm'), pick('upperarmr', 'rightarm')],
    farms: [pick('lowerarml', 'leftforearm'), pick('lowerarmr', 'rightforearm')],
    head: pick('head'), neck: pick('neck'), hips: pick('hips'),
  };
  const bent = [...B.thighs, ...B.shins, ...B.uarms, ...B.farms, B.head, B.neck].filter(Boolean);
  const pre = bent.map((b) => b.quaternion.clone());
  const turn = (b, ax, a) => { if (b && a) b.quaternion.multiply(_q.setFromAxisAngle(b.userData[ax], a)); };
  const wrap = new THREE.Group(); wrap.add(inst); inst.scale.multiplyScalar(k); wrap.rotation.y = Math.PI;
  const root = new THREE.Group(); root.add(wrap);
  const ph = seed * 1.9;
  let lookNow = 0;
  const api = {
    root,
    // opts: talk 0..1 (speaking: little nods, a gesture), lookYaw (turn the head towards someone, radians),
    // driver (hands on the wheel), steer (-1..1, the wheel yanked)
    update(dt, t, fear = 0, look = 1, opts = {}) {
      bent.forEach((b, i) => b.quaternion.copy(pre[i]));
      mixer.update(dt);
      bent.forEach((b, i) => pre[i].copy(b.quaternion));
      if (!sit) { for (const b of B.thighs) turn(b, 'axX', -1.5); for (const b of B.shins) turn(b, 'axX', 1.55); }
      const talk = opts.talk || 0;
      // glancing around, out of the windows, or at whoever is talking; at the end everyone stares ahead
      lookNow += ((opts.lookYaw ?? 0) - lookNow) * Math.min(1, dt * 4);
      const idleG = (Math.sin(t * 0.55 + ph) * 0.45 + Math.sin(t * 1.7 + ph * 2) * 0.12) * (opts.lookYaw == null ? 1 : 0.25);
      const g = (idleG + lookNow) * look * (1 - fear);
      turn(B.neck, 'axY', g * 0.45); turn(B.head, 'axY', g * 0.55);
      if (talk) { turn(B.head, 'axX', Math.sin(t * 8.5 + ph) * 0.06 * talk); turn(B.neck, 'axZ' in B.neck?.userData ? 'axZ' : 'axY', Math.sin(t * 3.1) * 0.05 * talk); }
      if (opts.driver) { // both hands on the wheel; it gets yanked at the end
        const st = opts.steer || 0;
        B.uarms.forEach((b, i) => { const s = i ? 1 : -1; turn(b, 'axX', -0.95 - st * s * 0.25); turn(b, 'axY', s * 0.38); });
        B.farms.forEach((b, i) => { const s = i ? 1 : -1; turn(b, 'axX', -0.6 + st * s * 0.3); });
      } else if (fear > 0) { // arms up in front of the face
        B.uarms.forEach((b, i) => { turn(b, 'axX', -1.7 * fear); turn(b, 'axY', (i ? -0.5 : 0.5) * fear); });
        B.farms.forEach((b) => turn(b, 'axX', -1.1 * fear));
        turn(B.head, 'axX', 0.25 * fear);
      } else if (talk) { // talking with one hand
        turn(B.uarms[1], 'axX', -0.35 * talk + Math.sin(t * 5 + ph) * 0.08 * talk);
        turn(B.farms[1], 'axX', -0.9 * talk + Math.sin(t * 6.3 + ph) * 0.15 * talk);
      }
      if (opts.driver && fear > 0) turn(B.head, 'axX', 0.15 * fear);
    },
    placeHips(target) { // move the whole character so its hip bone sits on the seat
      api.update(0, 0); root.updateMatrixWorld(true);
      const h = new THREE.Vector3(); (B.hips || inst).getWorldPosition(h);
      root.position.add(target.clone().sub(h));
    },
    dispose() { mixer.stopAllAction(); },
  };
  return api;
}

function animatedAvatar(body, arm, armM, gltf) {
  const inst = SkeletonUtils.clone(gltf.scene);
  const mixer = new THREE.AnimationMixer(inst);
  const clip = (re) => gltf.animations.find((a) => re.test(a.name));
  const act = {};
  for (const [k, re] of [['idle', /[|_]Idle$/], ['walk', /[|_]Walk(ing)?$/], ['run', /[|_]Run(ning)?$/], ['death', /Death$/]]) {
    const c = clip(re); if (c) act[k] = mixer.clipAction(c);
  }
  inst.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    o.material = ms.map((m) => { const c = m.clone(); c.roughness = 0.85; c.metalness = 0; if (c.color) c.color.multiplyScalar(0.75); return c; });
    if (o.material.length === 1) o.material = o.material[0];
  });
  // bones for a procedural crouch, layered on top of the animation
  inst.updateMatrixWorld(true);
  const bn = {}; const wq = new THREE.Quaternion();
  inst.traverse((o) => {
    if (!o.isBone) return;
    const n = o.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    o.getWorldQuaternion(wq); wq.invert();
    o.userData.axX = new THREE.Vector3(1, 0, 0).applyQuaternion(wq);
    bn[n] = o;
  });
  const pick = (...names) => names.map((n) => bn[n]).find(Boolean);
  const CB = {
    thighs: [pick('upperlegl', 'leftupleg'), pick('upperlegr', 'rightupleg')],
    shins: [pick('lowerlegl', 'leftleg'), pick('lowerlegr', 'rightleg')],
    feet: [pick('footl', 'leftfoot'), pick('footr', 'rightfoot')],
    spine: [pick('abdomen', 'spine'), pick('torso', 'spine1')],
    uarm: pick('upperarmr', 'rightarm'), farm: pick('lowerarmr', 'rightforearm'),
    hand: pick('wristr', 'middlehandr', 'righthand'),
  };
  const bentBones = [...CB.thighs, ...CB.shins, ...CB.feet, ...CB.spine, CB.uarm, CB.farm].filter(Boolean);
  const handV = new THREE.Vector3();
  const preQ = bentBones.map((b) => b.quaternion.clone());
  let bentLast = false;
  const bend = (b, ang) => { if (b && ang) b.quaternion.multiply(_q.setFromAxisAngle(b.userData.axX, ang)); };
  // normalise height to 1.75 m, feet on the floor, facing -Z like everything else
  if (act.idle) act.idle.play();
  mixer.update(0); inst.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(inst, true);
  const h = box.max.y - box.min.y || 1, k = 1.75 / h;
  const wrap = new THREE.Group(); wrap.add(inst);
  inst.scale.multiplyScalar(k); inst.position.y = -box.min.y * k;
  wrap.rotation.y = Math.PI;
  for (const ch of [...body.children]) if (ch !== arm) ch.visible = false;
  armM.visible = false;
  arm.position.set(0.2, 1.22, 0.32);
  body.add(wrap);
  let cur = act.idle, dead = false;
  const fade = (next, ts = 1) => {
    if (!next) return;
    next.timeScale = ts;
    if (next === cur) return;
    next.reset().play(); if (cur) next.crossFadeFrom(cur, 0.25, false);
    cur = next;
  };
  return {
    inst: wrap, crouch: 0,
    setPose(ud, pitch, fl, crouch, moving, dt, speed) {
      ud.arm.rotation.x = pitch;
      ud.beam.visible = fl && ud.shown; ud.light.userData.on = fl; ud.lens.material.color.set(fl ? 0xfff6e0 : 0x222222);
      if (!dead) {
        if (moving && speed > 4.2 && act.run) fade(act.run, 1);
        else if (moving && act.walk) fade(act.walk, Math.max(0.45, speed / 3.1));
        else fade(act.idle, 1);
      }
      this.crouch += ((crouch ? 1 : 0) - this.crouch) * Math.min(1, dt * 8);
      // undo last frame's bend on bones the animation doesn't drive, then animate
      if (bentLast) bentBones.forEach((b, i) => b.quaternion.copy(preQ[i]));
      mixer.update(dt);
      bentBones.forEach((b, i) => preQ[i].copy(b.quaternion));
      const c = this.crouch;
      bentLast = c > 0.01 && !dead;
      if (bentLast) {
        const th = 1.05 * c;                       // knees bend, hips drop, feet stay flat
        for (const b of CB.thighs) bend(b, -th);
        for (const b of CB.shins) bend(b, th * 2);
        for (const b of CB.feet) bend(b, -th);
        bend(CB.spine[0], 0.3 * c); bend(CB.spine[1], 0.2 * c);
      }
      wrap.position.y = -0.85 * (1 - Math.cos(1.05 * c));
      if (!dead && CB.uarm) {
        // hold the flashlight out in front, aimed where the player looks
        bend(CB.uarm, -1.3 - pitch * 0.8); bend(CB.farm, -0.25);
        bentLast = true;
      }
      // put the torch exactly in the hand
      if (CB.hand && !dead) {
        wrap.updateMatrixWorld(true);
        CB.hand.getWorldPosition(handV); ud.body.worldToLocal(handV);
        ud.arm.position.set(handV.x, handV.y - 0.5 * Math.sin(pitch), handV.z + 0.5 * Math.cos(pitch) - 0.08);
      }
    },
    die() {
      if (dead) return; dead = true;
      if (act.death) { act.death.setLoop(THREE.LoopOnce); act.death.clampWhenFinished = true; fade(act.death, 1); }
      else { wrap.rotation.x = -Math.PI / 2; wrap.position.y = 0.15; }
      const tick = () => { mixer.update(1 / 60); if (act.death && act.death.time < act.death.getClip().duration - 0.02) requestAnimationFrame(tick); };
      tick();
    },
  };
}

function upgradeAvatar(body, arm, armM, col) {
  const { inst, bones: B } = rigFrom(MODELS.survivor);
  const jacket = col.clone().multiplyScalar(0.55);
  inst.traverse((o) => {
    if (!o.isMesh) return;
    o.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78 });
    const c = o.geometry.getAttribute('color');
    if (!c) return;
    o.geometry = o.geometry.clone();
    const cc = o.geometry.getAttribute('color');
    for (let i = 0; i < cc.count; i++) {
      if (cc.getX(i) > 0.9 && cc.getY(i) < 0.1 && cc.getZ(i) > 0.9) {
        const n = 0.85 + Math.random() * 0.15;
        cc.setXYZ(i, jacket.r * n, jacket.g * n, jacket.b * n);
      }
    }
    cc.needsUpdate = true;
  });
  for (const ch of [...body.children]) if (ch !== arm) ch.visible = false;
  armM.visible = false;
  arm.position.set(0.19, 1.41, -0.02);
  body.add(inst);
  return {
    inst, phase: 0, crouch: 0,
    setPose(ud, pitch, fl, crouch, moving, dt, speed) {
      ud.arm.rotation.x = pitch;
      ud.beam.visible = fl && ud.shown; ud.light.userData.on = fl; ud.lens.material.color.set(fl ? 0xfff6e0 : 0x222222);
      this.crouch += ((crouch ? 1 : 0) - this.crouch) * Math.min(1, dt * 10);
      const c = this.crouch;
      if (moving) this.phase += dt * speed * 3.0;
      const a = moving ? Math.sin(this.phase) * 0.55 : 0;
      pose(B.thigh_L, a + c * 1.1); pose(B.thigh_R, -a + c * 1.1);
      pose(B.shin_L, -Math.max(0, Math.sin(this.phase)) * 0.7 * (moving ? 1 : 0) - c * 1.9);
      pose(B.shin_R, -Math.max(0, -Math.sin(this.phase)) * 0.7 * (moving ? 1 : 0) - c * 1.9);
      pose(B.foot_L, c * 0.8); pose(B.foot_R, c * 0.8);
      pose(B.upperarm_L, 1.45 + pitch, 0, -0.1);   // flashlight arm
      pose(B.forearm_L, 0.1);
      pose(B.upperarm_R, -a * 0.6 + c * 0.3, 0, -0.06);
      pose(B.forearm_R, 0.2 + c * 0.6);
      pose(B.spine, c * -0.35); pose(B.head, pitch * 0.6 + c * 0.2);
      inst.position.y = -c * 0.5 + (moving ? Math.abs(Math.cos(this.phase)) * 0.025 : 0);
      ud.arm.position.y = 1.41 - c * 0.55; ud.arm.position.z = -0.02 - c * 0.12;
    },
  };
}

// ---------------- THE CRAWLER: same body, on all fours, lives on the ceiling ----------------
export function createCrawler(ceilingH) {
  const outer = new THREE.Group();
  const flip = new THREE.Group(); outer.add(flip);
  const mon = createMonster();
  const ud = mon.userData;
  const P = new THREE.Group(); flip.add(P); P.add(mon);
  if (!ud.bones) { outer.userData.update = (dt, state, speed, t) => ud.update(dt, speed, 'chase', t); return outer; }
  if (ud.rag) ud.rag.visible = false;
  if (ud.glow) { ud.glow.parent.remove(ud.glow); ud.glow = null; } // a light that pops in/out would stall the GPU
  mon.scale.setScalar(0.85);
  P.rotation.x = -Math.PI / 2; P.position.set(0, 0.62, 0.95);
  const B = ud.bones, LR = [['_L', 1], ['_R', -1]];
  let ph = 0, dropT = 0, last = 'gone', vis = 0;
  outer.userData.update = (dt, state, speed, t) => {
    if (state !== last) { if (state === 'drop') dropT = 0; last = state; }
    ph += (state === 'crawl' ? Math.max(2.5, speed) : state === 'ceiling' ? 0.3 : 0) * dt * 3.2;
    for (const [sfx, s] of LR) {
      const a = Math.sin(ph + (s > 0 ? 0 : Math.PI));
      pose(B['upperarm' + sfx], 1.35 + a * 0.4, 0, s * 0.75);
      pose(B['forearm' + sfx], -1.0 + Math.max(0, a) * 0.5);
      pose(B['hand' + sfx], 0.7);
      pose(B['fingers' + sfx], 0.3 + Math.sin(t * 18 + s) * 0.25);
      pose(B['thigh' + sfx], 1.35 - a * 0.4, 0, s * 0.85);
      pose(B['shin' + sfx], -1.9);
      pose(B['foot' + sfx], 0.6);
      pose(B['shoulder' + sfx], 0, 0, s * 0.15);
    }
    pose(B.spine, Math.sin(ph * 2) * 0.06, Math.sin(ph) * 0.08);
    pose(B.chest, 0.15); pose(B.neck, 1.15);
    ud.headObj.rotation.set(0.35 + Math.sin(t * 23) * 0.05, Math.sin(t * 2.7) * 0.35, Math.sin(t * 9) * 0.25 + (state === 'ceiling' ? 0.6 : 0));
    // ceiling -> drop -> crawl
    let k = 0;
    if (state === 'ceiling') k = 1;
    else if (state === 'drop') { dropT += dt; k = Math.max(0, 1 - dropT / 0.55); }
    else if (state === 'retreat') { vis = Math.max(0, vis - dt * 1.5); }
    if (state !== 'retreat') vis = Math.min(1, vis + dt * 4);
    flip.rotation.z = Math.PI * k * k;
    flip.position.y = ceilingH * k * k;
    outer.visible = vis > 0.02 && state !== 'gone';
    mon.scale.setScalar(0.85 * (state === 'retreat' ? vis : 1));
  };
  return outer;
}
