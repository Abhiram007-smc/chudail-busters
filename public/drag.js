// After the crash: the Chudail drags you through the snow into the house. A live three.js scene (not a video), so
// the body she drags is YOUR character and she is the same ghost as in the game.
//
//   S1 0-4.2   you lie on the road by the wreck; she walks out of the headlights and leans over you (face reveal)
//   S2 4.4-9.8 behind you: she pulls you by the ankle through the snow, the house waiting at the end of the path
//   S3 9.9-13  your own eyes: your legs, her back, the porch; the door swings open on a lit hallway
//   S4 13.2-16.7 inside the hall: she comes through the door with you, past the camera; the door slams
import * as THREE from 'three';
import * as TX from './textures.js';
import { createMonster, createSeatedCharacter } from './entities.js';

export const DRAG = { duration: 17.0 };
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// porch: three 0.2 m steps from z -58.4 to -59.6, then the deck and the hall floor at 0.6
const FRONT = -61; // front wall of the house
function groundY(z) { if (z > -58.4) return 0; if (z > -59.6) return Math.min(0.6, 0.2 * Math.ceil((-58.4 - z) / 0.4 + 1e-6)); return 0.6; }

export function buildDrag({ assets, charKey, place = 'ASHGROVE' }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x070a10);
  scene.fog = new THREE.FogExp2(0x101622, 0.02);
  const cam = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.05, 300);
  const disposables = [];
  const tex = (c, rx = 1, ry = 1) => { const t = TX.toTex(c); t.repeat.set(rx, ry); disposables.push(t); return t; };
  const mat = (o) => { const m = new THREE.MeshStandardMaterial(o); disposables.push(m); return m; };
  const box = (w, h, d, m, x, y, z, parent = scene) => { const g = new THREE.BoxGeometry(w, h, d); disposables.push(g); const b = new THREE.Mesh(g, m); b.position.set(x, y, z); parent.add(b); return b; };

  // ---- light: enough moon and snow-glow that you can actually see everything
  scene.add(new THREE.HemisphereLight(0x9aa8cc, 0x3a3c48, 1.35));
  const moon = new THREE.DirectionalLight(0xb0c0e8, 1.5); moon.position.set(-20, 30, 15); scene.add(moon);

  // ---- ground, the road by the wreck, the path to the house
  const snowM = mat({ color: 0xc4ccd8, roughness: 1 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), snowM); ground.rotation.x = -Math.PI / 2; ground.position.z = -40; scene.add(ground); disposables.push(ground.geometry);
  const roadM = mat({ color: 0x23262b, roughness: 0.6 });
  const road = new THREE.Mesh(new THREE.PlaneGeometry(220, 7.5), roadM); road.rotation.x = -Math.PI / 2; road.position.set(0, 0.01, 4); scene.add(road); disposables.push(road.geometry);
  const trailM = mat({ color: 0x9aa3b0, roughness: 1 }); // the drag furrow / path in the snow
  const trail = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 58), trailM); trail.rotation.x = -Math.PI / 2; trail.position.set(0, 0.012, -29); scene.add(trail); disposables.push(trail.geometry);

  // ---- pines
  const pineG = new THREE.ConeGeometry(1.7, 7, 7); pineG.translate(0, 3.5, 0); disposables.push(pineG);
  const pineM = mat({ color: 0x14231c, roughness: 1 });
  const pines = new THREE.InstancedMesh(pineG, pineM, 120); scene.add(pines);
  const dm = new THREE.Object3D();
  for (let k = 0; k < 120; k++) {
    const side = k % 2 ? 1 : -1, x = side * rnd(6, 40), z = rnd(-95, 20), s = rnd(0.7, 1.7);
    if (z < -50 && Math.abs(x) < 16) { dm.position.set(side * rnd(16, 40), 0, z); } else dm.position.set(x, 0, z);
    dm.scale.setScalar(s); dm.rotation.y = rnd(0, 6); dm.updateMatrix(); pines.setMatrixAt(k, dm.matrix);
  }

  // ---- the wreck: your car nose-down in the ditch, one headlight still on, hazards blinking
  const car = assets.car;
  car.traverse((o) => { if (o.userData.q0) o.quaternion.copy(o.userData.q0); });
  car.position.set(3.2, 0.25, -7.5); car.rotation.set(0.12, 0.75, 0.16); scene.add(car);
  const beam = new THREE.SpotLight(0xfff1d8, 120, 40, 0.55, 0.6, 1.3); beam.position.set(2.2, 0.9, -5.6); beam.target.position.set(-1, 0, 4); scene.add(beam, beam.target);
  const hazard = new THREE.PointLight(0xff8a20, 0, 9, 1.6); hazard.position.set(3.6, 1.1, -9.6); scene.add(hazard);
  // a street lamp that cannot decide
  const lampM = mat({ color: 0x111111, roughness: 0.5, metalness: 0.6 });
  box(0.14, 4.6, 0.14, lampM, -4.2, 2.3, -1.5);
  const lamp = new THREE.PointLight(0xffa860, 14, 16, 1.4); lamp.position.set(-3.6, 4.2, -1.5); scene.add(lamp);
  const lampGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex(TX.glowCanvas()), color: 0xffa860, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  lampGlow.scale.setScalar(1.6); lampGlow.position.copy(lamp.position); scene.add(lampGlow);

  // ---- the house: Ashgrove, two storeys of grey boards, a porch, eight windows
  const sidingM = mat({ map: tex(TX.plainWoodCanvas([70, 68, 66]), 6, 3), color: 0x8a8a92, roughness: 0.95 });
  const trimM = mat({ color: 0x2a2622, roughness: 0.8 });
  const roofM = mat({ color: 0x1a1c20, roughness: 0.9 });
  const H = 7.2, W = 16, D = 12, back = FRONT - D;
  const DW = 1.4, DH = 2.2; // door opening (from the deck at 0.6)
  box((W - DW) / 2, H, 0.3, sidingM, -(W + DW) / 4, H / 2, FRONT); // front wall left of the door
  box((W - DW) / 2, H, 0.3, sidingM, (W + DW) / 4, H / 2, FRONT); // right of it
  box(DW, H - (0.6 + DH), 0.3, sidingM, 0, (0.6 + DH + H) / 2, FRONT); // above it
  box(DW, 0.6, 0.3, sidingM, 0, 0.3, FRONT); // below the sill
  box(0.3, H, D, sidingM, -W / 2, H / 2, FRONT - D / 2); box(0.3, H, D, sidingM, W / 2, H / 2, FRONT - D / 2); box(W, H, 0.3, sidingM, 0, H / 2, back);
  for (const s of [-1, 1]) { const r = box(W / 2 + 0.9, 0.25, D + 1.4, roofM, s * W / 4, H + 1.6, FRONT - D / 2); r.rotation.z = -s * 0.42; }
  box(W + 0.4, 0.25, 0.4, trimM, 0, 3.6, FRONT + 0.15); // floor line
  // windows: dark panes; two burn a dirty yellow; in one upstairs someone stands watching
  const darkPane = mat({ color: 0x05070a, roughness: 0.2, metalness: 0.3 });
  const litPane = mat({ color: 0x1a1006, emissive: 0xffaa55, emissiveIntensity: 1.3 });
  const panes = [];
  [[-5.6, 2.1], [-2.8, 2.1], [2.8, 2.1], [5.6, 2.1], [-5.6, 5.4], [-2.8, 5.4], [2.8, 5.4], [5.6, 5.4]].forEach(([x, y], k) => {
    box(1.25, 1.65, 0.12, trimM, x, y, FRONT + 0.16);
    const p = box(1.0, 1.4, 0.05, k === 1 || k === 6 ? litPane : darkPane, x, y, FRONT + 0.23); panes.push(p);
  });
  const watcher = new THREE.Mesh(new THREE.CircleGeometry(0.26, 16), mat({ color: 0x000000 })); watcher.scale.set(0.8, 1.6, 1); watcher.position.set(2.8, 5.35, FRONT + 0.27); scene.add(watcher); disposables.push(watcher.geometry);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.8), mat({ map: tex(TX.signCanvas(place)), transparent: true })); sign.position.set(0, 3.2, FRONT + 0.2); scene.add(sign); disposables.push(sign.geometry);
  // porch: steps, deck, posts, roof, a dying bulb
  const boardM = mat({ map: tex(TX.plainWoodCanvas([60, 44, 30]), 2, 2), roughness: 0.9 });
  for (let k = 0; k < 3; k++) box(4.2, 0.2 * (k + 1), 0.4, boardM, 0, 0.1 * (k + 1), -58.6 - k * 0.4);
  box(6, 0.6, 1.5, boardM, 0, 0.3, -60.3);
  for (const x of [-2.8, 2.8]) box(0.18, 2.9, 0.18, trimM, x, 2.05, -58.9);
  box(6.4, 0.18, 2.6, roofM, 0, 3.55, -59.9);
  const porchLight = new THREE.PointLight(0xffb070, 5, 9, 1.5); porchLight.position.set(0, 3.1, -59.7); scene.add(porchLight);
  // the door, hinged on its left edge, swinging inwards
  const doorPivot = new THREE.Group(); doorPivot.position.set(-DW / 2, 0.6, FRONT); scene.add(doorPivot);
  const doorM = mat({ map: tex(TX.plainWoodCanvas([46, 30, 20]), 1, 2), roughness: 0.8 });
  box(DW, DH, 0.08, doorM, DW / 2, DH / 2, 0, doorPivot);
  box(0.06, 0.06, 0.12, mat({ color: 0x9a8a60, metalness: 0.8, roughness: 0.3 }), DW - 0.15, DH / 2, -0.08, doorPivot);
  // ---- the hall behind it: wallpaper, chequered tiles, a bare bulb, something written on the wall
  const hallL = 12, hz = FRONT - hallL / 2;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(4.2, hallL), mat({ map: tex(TX.tileFloorCanvas(), 2, 6), roughness: 0.55 }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0.61, hz); scene.add(floor); disposables.push(floor.geometry);
  const paperM = mat({ map: tex(TX.wallCanvas(0), 3, 1), roughness: 0.9 });
  for (const s of [-1, 1]) { const w = new THREE.Mesh(new THREE.PlaneGeometry(hallL, 3.0), paperM); w.position.set(s * 2.1, 2.1, hz); w.rotation.y = -s * Math.PI / 2; scene.add(w); disposables.push(w.geometry); }
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(4.2, hallL), mat({ map: tex(TX.ceilingCanvas(), 2, 6), roughness: 1 })); ceil.rotation.x = Math.PI / 2; ceil.position.set(0, 3.6, hz); scene.add(ceil); disposables.push(ceil.geometry);
  box(4.2, 3.0, 0.2, paperM, 0, 2.1, FRONT - hallL); // end of the hall
  box(1.2, 2.2, 0.05, mat({ color: 0x020202 }), 0, 1.7, FRONT - hallL + 0.12); // a dark doorway at the end
  const writing = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.0), mat({ map: tex(TX.writingCanvas('SHE BRINGS THEM HOME')), transparent: true, depthWrite: false }));
  writing.position.set(2.08, 2.1, FRONT - 4.5); writing.rotation.y = -Math.PI / 2; scene.add(writing); disposables.push(writing.geometry);
  const bulb = new THREE.PointLight(0xffb070, 6, 11, 1.4); bulb.position.set(0, 3.1, FRONT - 4); scene.add(bulb);
  const bulbGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex(TX.glowCanvas()), color: 0xffc080, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  bulbGlow.scale.setScalar(0.9); bulbGlow.position.copy(bulb.position); scene.add(bulbGlow);
  const cord = box(0.015, 0.5, 0.015, trimM, 0, 3.35, FRONT - 4);
  const moonIn = new THREE.SpotLight(0x9fb4e8, 0, 14, 0.5, 0.6, 1.2); moonIn.position.set(0, 2.4, FRONT + 2.5); moonIn.target.position.set(0, 0.6, FRONT - 6); scene.add(moonIn, moonIn.target);

  // ---- snow
  const N = 2400, sp = new Float32Array(N * 3);
  for (let k = 0; k < N; k++) { sp[k * 3] = rnd(-25, 25); sp[k * 3 + 1] = rnd(0, 14); sp[k * 3 + 2] = rnd(-75, 15); }
  const snowG = new THREE.BufferGeometry(); snowG.setAttribute('position', new THREE.BufferAttribute(sp, 3)); disposables.push(snowG);
  const snow = new THREE.Points(snowG, new THREE.PointsMaterial({ color: 0xffffff, size: 0.07, transparent: true, opacity: 0.85, depthWrite: false })); scene.add(snow);

  // ---- her, and you
  const her = createMonster(); scene.add(her);
  her.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
  const you = createSeatedCharacter(charKey, 0, { knees: -1.5 }); // legs straight out
  const lay = new THREE.Group(); scene.add(lay);
  if (you) lay.add(you.root);

  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), mtx = new THREE.Matrix4();
  const handAt = (out) => {
    const h = her.userData.hands && her.userData.hands.L;
    if (h) { her.updateMatrixWorld(true); return h.getWorldPosition(out); }
    return out.set(0.25, 0.55, 0.55).applyMatrix4(her.matrixWorld); // primitive fallback: behind her, at hip height
  };
  // lie the body on its back with the feet in her hand, the head trailing behind on the ground
  function layBody(along) { // along: +1 = she walks towards -z
    handAt(v1);
    const headX = v1.x, headZ = v1.z + along * 1.55, headY = groundY(headZ) + 0.14;
    v2.set(v1.x - headX, v1.y - headY, v1.z - headZ).normalize(); // head -> feet
    const yl = v2.clone().negate(), zl = up.clone().addScaledVector(yl, -up.dot(yl)).normalize().negate(), xl = new THREE.Vector3().crossVectors(yl, zl);
    mtx.makeBasis(xl, yl, zl); lay.quaternion.setFromRotationMatrix(mtx);
    lay.position.copy(v1).addScaledVector(v2, 0.08);
    return { head: new THREE.Vector3(headX, headY, headZ), feet: v1.clone(), dir: v2.clone() };
  }

  const S = { door: 0, events: [], body: null };
  let last = -1, prevHerX = 0, prevHerZ = 0;
  function placeHer(x, z, yaw, state, speed, t, dt, reveal = 0) {
    her.position.set(x, groundY(z), z); her.rotation.set(0, yaw, 0, 'YXZ'); her.userData.reveal = reveal;
    her.userData.setCrawl?.(0, 1, 3, true);
    her.userData.update(dt, speed, state, t);
  }

  // flicker (street lamp, hazards, porch bulb, hall bulb) and snow drifting down and sideways
  function ambient(t, dt, hallBusy = false) {
    cam.aspect = innerWidth / innerHeight;
    lamp.intensity = Math.sin(t * 13) > 0.6 && Math.random() < 0.5 ? 2 : 14;
    lampGlow.material.opacity = lamp.intensity / 14;
    hazard.intensity = Math.sin(t * Math.PI * 1.6) > 0 ? 9 : 0;
    porchLight.intensity = Math.random() < 0.06 ? 0.5 : 5;
    bulb.intensity = Math.random() < (hallBusy ? 0.08 : 0.03) ? 0.6 : 6; bulbGlow.material.opacity = bulb.intensity / 6;
    for (let k = 0; k < N; k++) { sp[k * 3 + 1] -= dt * 1.1; sp[k * 3] += dt * 0.35; if (sp[k * 3 + 1] < 0) { sp[k * 3 + 1] = 14; sp[k * 3] = rnd(-25, 25); } }
    snowG.attributes.position.needsUpdate = true;
  }

  function update(t, dt) {
    const shot = t < 4.3 ? 1 : t < 9.85 ? 2 : t < 13.1 ? 3 : 4;
    cam.fov = 55;
    ambient(t, dt, shot === 4);

    lay.visible = shot !== 1;
    if (shot === 1) { // on your back on the road. She comes out of the light and leans over you.
      const k = smooth(0.4, 3.0, t);
      const x = 2.2 - 1.9 * k, z = -6.5 + 6.6 * k; // stops ~2 m from you
      const walking = t > 0.4 && t < 3.0;
      placeHer(x, z, Math.atan2(-(0.3 - x), -(1.9 - z)), t > 3.0 ? 'stall' : 'wander', walking ? 2.2 : 0, t, dt, smooth(2.6, 3.4, t));
      her.rotation.x = -0.55 * smooth(3.0, 3.8, t); // she bends down over you
      const lookUp = smooth(2.7, 3.6, t);
      cam.position.set(0.3, 0.45, 2.1);
      v1.set(1.6 - 1.2 * lookUp, 0.7 + 1.9 * lookUp, -6 + 6.5 * lookUp);
      if (t > 3.0) { her.userData.headObj?.getWorldPosition(v2); v1.lerp(v2, lookUp); }
      cam.lookAt(v1); cam.rotateZ(0.22 * (1 - lookUp) + Math.sin(t * 1.3) * 0.02);
    } else if (shot === 2) { // behind you: she drags you up the path, the house at the end of it
      const tt = t - 4.3, z = -12 - tt * 1.75; // (she has already pulled you away from the wreck)
      placeHer(Math.sin(tt * 0.9) * 0.12, z, 0, 'drag', 1.75, t, dt);
      S.body = layBody(1);
      cam.position.set(-2.1 + Math.sin(tt * 0.5) * 0.15, 1.45, S.body.head.z + 2.4);
      cam.lookAt(0.2, 0.9, z - 5);
    } else if (shot === 3) { // your own eyes: your legs, her back, the porch, the door opening on the light
      const tt = t - 9.85, z = -52.6 - tt * 2.35;
      placeHer(Math.sin(tt * 1.1) * 0.08, z, 0, 'drag', 2.3, t, dt);
      S.body = layBody(1);
      const bump = z < -58.4 && z > -59.8 ? Math.abs(Math.sin(tt * 9)) * 0.06 : 0;
      cam.position.copy(S.body.head).addScaledVector(S.body.dir, -0.12).add(v1.set(0, 0.32 + bump, 0));
      v2.copy(S.body.feet).add(v1.set(0, 0.9, -3.2)); cam.lookAt(v2);
      cam.rotateZ(Math.sin(t * 2.1) * 0.03);
      S.door = smooth(11.7, 12.6, t);
      moonIn.intensity = 0;
    } else { // inside the hall: she comes in through the door with you and goes right past
      const tt = t - 13.1, z = FRONT + 0.4 - tt * 2.8;
      placeHer(-0.25, z, 0, 'drag', 2.6, t, dt);
      S.body = layBody(1);
      cam.position.set(1.15, 1.75, FRONT - 9.2);
      cam.lookAt(-0.2, 1.35, FRONT + 0.5);
      S.door = t < 16.15 ? 1 : 1 - smooth(16.15, 16.35, t);
      moonIn.intensity = 30 * S.door;
    }
    doorPivot.rotation.y = -1.85 * S.door;
    cam.updateProjectionMatrix();
    if (you) you.update(dt, t, 0, 0);
    // events for sound (one-shot, in order)
    const fire = (at, name) => { if (last < at && t >= at) S.events.push(name); };
    [0.8, 1.4, 2.0, 2.6].forEach((a) => fire(a, 'step'));
    fire(4.3, 'thud'); fire(4.4, 'scrapeOn');
    for (let a = 4.7; a < 9.8; a += 0.62) fire(a, 'crunch');
    for (let a = 10.1; a < 12; a += 0.5) fire(a, 'crunch');
    [12.25, 12.42, 12.6].forEach((a) => fire(a, 'stepThud'));
    fire(11.7, 'creak'); fire(13.1, 'scrapeOff'); fire(13.2, 'wood');
    fire(16.15, 'slam');
    last = t;
    const ev = S.events; S.events = []; return ev;
  }
  // blinking eyes in the first shot, black cuts between shots, black at the end
  function cover(t) {
    if (t < 1.0) return 1 - smooth(0.0, 1.0, t);
    if (t < 4.3) { const b = Math.max(0, Math.sin((t - 1) * 1.9)); return b > 0.985 ? 0.9 : 0; }
    const cut = (a) => Math.max(0, 1 - Math.abs(t - a) / 0.12);
    return Math.max(cut(4.32), cut(9.87), cut(13.12), smooth(16.35, 16.6, t));
  }
  function dispose() {
    scene.remove(car); scene.remove(her); her.traverse((o) => { if (o.isMesh) o.geometry?.dispose?.(); });
    you?.dispose?.(); lay.clear();
    pines.dispose?.(); disposables.forEach((d) => d.dispose?.());
  }
  return { scene, cam, update, cover, dispose, duration: DRAG.duration, her, lay, ambient, setDoor: (k) => { doorPivot.rotation.y = -1.85 * k; }, hazard, beam, moonIn };
}

// ---------------------------------------------------------------- the ending: you get out, and you drive away
// The same car (beaten up from the crash: cracked windshield, one headlight, bumper hanging, smoking) waits in
// front of the house. Everyone who got out is in it. She stands in the doorway and watches you go.
//   O1 0-4.6 in front of the car: it starts, one headlight, rolls towards us and past
//   O2 4.6-9.4 the dashboard, looking back at your friends and, through the rear window, the house
//   O3 9.4-13.6 high and wide: the car turns onto the road and away; the sky starts to grey; white
export const OUTRO = { duration: 13.6 };
function crackCanvas() {
  const c = TX.canvas(512, 256), g = c.getContext('2d');
  g.strokeStyle = 'rgba(235,240,255,0.85)'; g.lineWidth = 1.6;
  const cx = 330, cy = 120;
  for (let k = 0; k < 22; k++) { // spider-web crack from one impact point
    let x = cx, y = cy, a = (k / 22) * Math.PI * 2 + rnd(-0.1, 0.1);
    g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s < 9; s++) { a += rnd(-0.25, 0.25); x += Math.cos(a) * rnd(12, 30); y += Math.sin(a) * rnd(8, 22); g.lineTo(x, y); }
    g.stroke();
  }
  for (let r = 18; r < 120; r += rnd(18, 30)) { g.beginPath(); for (let k = 0; k <= 24; k++) { const a = (k / 24) * Math.PI * 2; g.lineTo(cx + Math.cos(a) * r * rnd(0.9, 1.1), cy + Math.sin(a) * r * 0.6 * rnd(0.9, 1.1)); } g.stroke(); }
  return c;
}
export function buildOutro({ assets, players, meId, place }) {
  const base = buildDrag({ assets, charKey: null, place });
  const { scene, cam, her, lay } = base;
  lay.visible = false;
  base.setDoor(1); base.hazard.intensity = 0; base.beam.intensity = 0;
  const car = assets.car;
  car.position.set(0, 0, 0); car.rotation.set(0, 0, 0); car.updateMatrixWorld(true);
  const extras = [];
  const add = (o) => { car.add(o); extras.push(o); return o; };
  // the people in it (seat 0 drives)
  const seats = []; car.traverse((o) => { if (/^seat_\d/.test(o.name)) seats[+o.name.split('_')[1]] = o; });
  const people = [];
  players.slice(0, 6).forEach((p, i) => {
    const ch = createSeatedCharacter(p.char, i, { knees: i === 5 ? 0.75 : 0.28 }); const seat = seats[i];
    if (!ch || !seat) return;
    const wp = new THREE.Vector3(); seat.getWorldPosition(wp); add(ch.root); ch.placeHips(wp); people.push({ ch, i });
  });
  const seat0 = new THREE.Vector3(); if (seats[0]) seats[0].getWorldPosition(seat0);
  const lift = seats[0] ? seat0.y - 0.86 : 0;
  // the damage
  let lampAt = []; car.traverse((o) => { if (o.isMesh && /car_headlamp/.test(o.name)) { const v = new THREE.Vector3(); o.getWorldPosition(v); lampAt.push({ o, v }); } });
  lampAt.sort((a, b) => a.v.x - b.v.x);
  if (lampAt[0]) lampAt[0].o.visible = false; // smashed
  const good = lampAt[1] ? lampAt[1].v : new THREE.Vector3(0.7, 1, -2.3);
  const head = new THREE.SpotLight(0xfff0d8, 0, 50, 0.5, 0.5, 1.3); head.position.copy(good); head.target.position.set(good.x * 1.5, 0, -30); add(head); add(head.target);
  const crackT = TX.toTex(crackCanvas(), { repeat: false });
  const crack = add(new THREE.Mesh(new THREE.PlaneGeometry(1.45, 0.7), new THREE.MeshBasicMaterial({ map: crackT, transparent: true, depthWrite: false, side: THREE.DoubleSide })));
  crack.position.set(0, 1.62 + lift * 0.5, -0.66); crack.rotation.x = -0.5;
  const bumperM = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 });
  const bumper = add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.18, 0.12), bumperM)); bumper.position.set(-0.35, 0.32, -2.32); bumper.rotation.z = 0.32;
  const smokeTex = TX.toTex(TX.glowCanvas());
  const puffs = Array.from({ length: 14 }, () => { const sp = add(new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: 0x6a6a70, transparent: true, depthWrite: false, opacity: 0 }))); return { sp, a: Math.random() * 3 }; });
  const dashL = add(new THREE.PointLight(0x46b8ff, 1.2, 3, 1.5)); dashL.position.set(0.15, 1.28 + lift, -0.35);
  // where the car is, which way it heads (0 = +z, towards the road), how fast
  const st = { x: 0.3, z: -53.2, h: 0, v: 0 };
  let ended = false;
  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
  function update(t, dt) {
    base.ambient(t, dt, false);
    // drive: wait, then pull away, turn left onto the road at its middle (z ~4), keep going
    if (t > 1.6) st.v = Math.min(st.v + dt * 2.4, 11);
    if (st.z > 0.6 && st.h < Math.PI / 2) st.h = Math.min(Math.PI / 2, st.h + (st.v / 3.4) * dt);
    st.x += -Math.sin(st.h) * st.v * dt; st.z += Math.cos(st.h) * st.v * dt;
    car.position.set(st.x, Math.abs(Math.sin(t * 9)) * 0.015 * (st.v > 0.5 ? 1 : 0), st.z);
    car.rotation.set(0, Math.PI - st.h, 0.035 + Math.sin(t * 7) * 0.006);
    head.intensity = t < 1.2 ? 0 : t < 1.5 ? (Math.random() < 0.5 ? 0 : 180) : 180;
    puffs.forEach((p, k) => { const life = ((t * 0.5 + k / puffs.length) % 1); p.sp.position.set(0.2 + Math.sin(k) * 0.3, 1.25 + life * 1.4, -1.8 - life * 0.3); p.sp.scale.setScalar(0.4 + life * 1.3); p.sp.material.opacity = Math.sin(life * Math.PI) * 0.35; });
    people.forEach((p) => p.ch.update(dt, t, 0, 1, p.i === 0 ? { driver: true, steer: st.h > 0 && st.h < 1.5 ? -0.6 : 0 } : {}));
    // she watches from the doorway, head lolled; near the end she is simply not there any more
    her.visible = t < 10.6;
    her.position.set(0.15, 0.6, -61.4); her.rotation.set(0, Math.PI, 0, 'YXZ'); her.userData.reveal = 0;
    her.userData.setCrawl?.(0, 1, 3, true); her.userData.update(dt, 0, 'stare', t);
    car.updateMatrixWorld(true);
    if (t < 4.6) { // in front of the car as it starts and comes past
      cam.fov = 50; cam.position.set(2.9, 1.45, -45.6); v1.set(st.x * 0.5, 1.2, Math.min(st.z, -47)); cam.lookAt(v1);
    } else if (t < 9.4) { // the dashboard, looking back at everyone and the house through the rear window
      cam.fov = 70; car.localToWorld(v1.set(0.04, 1.52 + lift * 0.6, lift ? -0.55 : -1.0)); car.localToWorld(v2.set(0, 1.25 + lift, 3)); cam.position.copy(v1); cam.lookAt(v2);
      cam.rotateZ(Math.sin(t * 3.1) * 0.01);
    } else { // high and wide over the junction
      cam.fov = 45; cam.position.set(8, 6, 14); cam.lookAt(st.x * 0.6, 0.8, st.z * 0.7 - 4);
      const k = smooth(9.4, 13.6, t); scene.background.setRGB(0.027 + k * 0.12, 0.04 + k * 0.12, 0.063 + k * 0.16);
    }
    cam.updateProjectionMatrix();
    const ev = [];
    if (!ended && t >= OUTRO.duration) { ended = true; ev.push('end'); }
    return ev;
  }
  function cover(t) { return t < 0.8 ? 1 - smooth(0, 0.8, t) : Math.max(Math.max(0, 1 - Math.abs(t - 4.6) / 0.1), Math.max(0, 1 - Math.abs(t - 9.4) / 0.1)); }
  function white(t) { return smooth(12.4, 13.5, t); }
  function dispose() {
    extras.forEach((o) => car.remove(o)); people.forEach((p) => p.ch.dispose?.());
    if (lampAt[0]) lampAt[0].o.visible = true;
    crackT.dispose(); smokeTex.dispose(); bumperM.dispose();
    base.dispose();
  }
  return { scene, cam, update, cover, white, dispose, duration: OUTRO.duration, car, people };
}
