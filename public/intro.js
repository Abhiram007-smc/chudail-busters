// Intro cut scene, played when a game starts.
//  1. /video/intro.mp4: the outside shots, rendered in Blender (blender/build_intro.py): the car on the snowy
//     mountain road, the street lamps dying one by one.
//  2. Live: inside the same car (intro_car.glb from that Blender scene) with every player's own character in the
//     seats. Camera on the dashboard looking back at them, then from the back seat through the windshield as a
//     truck's lights come out of the dark in their lane. Head-on.
//  3. Black, ringing ears. Then the game: you wake up on the floor of the house.
// Hold Space (or Esc) to skip.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createSeatedCharacter } from './entities.js';

const VIDEO_URL = '/video/intro.mp4';
export const INTRO = { live: 9.2, black: 2.8 };
const T_TRUCK = 4.4; // live time the camera turns to the windshield and the truck's lights appear
const SPEED = 15; // m/s, the car

let pre = null;
export function preloadIntro() {
  if (pre) return pre;
  const loader = new GLTFLoader();
  pre = Promise.all([
    fetch(VIDEO_URL).then((r) => { if (!r.ok) throw new Error('intro video ' + r.status); return r.blob(); }),
    loader.loadAsync('/models/intro_car.glb'),
    loader.loadAsync('/models/intro_truck.glb'),
  ]).then(([blob, car, truck]) => ({ videoURL: URL.createObjectURL(blob), car: car.scene, truck: truck.scene }))
    .catch((e) => { console.warn('intro unavailable:', e.message); pre = null; return null; });
  return pre;
}

const rnd = (a, b) => a + Math.random() * (b - a);
const smooth = (a, b, x) => { const k = Math.max(0, Math.min(1, (x - a) / (b - a))); return k * k * (3 - 2 * k); };

// ---------------------------------------------------------------- sound (built on the game's audio engine)
function introSound(audio) {
  const ctx = audio.ctx;
  if (!ctx) return null;
  const bus = ctx.createGain(); bus.gain.value = 1; bus.connect(audio.master);
  const nodes = [];
  const noise = () => { const s = ctx.createBufferSource(); s.buffer = audio.white; s.loop = true; return s; };
  const env = (g, t, a, peak, d) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); };
  // engine: two detuned low saws, and wind over the car
  const eng = ctx.createGain(); eng.gain.value = 0.0001; eng.connect(bus);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160; lp.connect(eng);
  const oscs = [46, 48.7, 92].map((f) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp); o.start(); nodes.push(o); return o; });
  const wind = noise(); const wbp = ctx.createBiquadFilter(); wbp.type = 'bandpass'; wbp.frequency.value = 420; wbp.Q.value = 0.5;
  const wg = ctx.createGain(); wg.gain.value = 0.0001; wind.connect(wbp); wbp.connect(wg); wg.connect(bus); wind.start(); nodes.push(wind);
  const now = () => ctx.currentTime;
  const api = {
    start() { eng.gain.setTargetAtTime(0.16, now(), 0.8); wg.gain.setTargetAtTime(0.09, now(), 1.2); },
    inside() { eng.gain.setTargetAtTime(0.24, now(), 0.3); lp.frequency.setTargetAtTime(110, now(), 0.3); wg.gain.setTargetAtTime(0.05, now(), 0.3); },
    buzz() { try { audio.buzz(0.35, 0.09); } catch {} },
    whoosh() { // the car rushing past the roadside camera
      const t = now(), n = noise(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
      bp.type = 'bandpass'; bp.Q.value = 0.8; bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(1400, t + 0.5); bp.frequency.exponentialRampToValueAtTime(250, t + 1.6);
      env(g, t, 0.45, 0.35, 1.3); n.connect(bp); bp.connect(g); g.connect(bus); n.start(t); n.stop(t + 2);
      oscs.forEach((o) => { o.frequency.setValueAtTime(o.frequency.value * 1.12, t + 0.3); o.frequency.exponentialRampToValueAtTime(o.frequency.value * 0.86, t + 1.2); o.frequency.setTargetAtTime(o.frequency.value, t + 2, 0.5); });
    },
    static() { // the radio losing the station
      const t = now(), n = noise(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
      bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 1.2; g.gain.value = 0;
      for (let k = 0; k < 40; k++) g.gain.setValueAtTime(Math.random() < 0.55 ? rnd(0.01, 0.05) : 0, t + k * 0.05);
      g.gain.setValueAtTime(0, t + 2.1);
      n.connect(bp); bp.connect(g); g.connect(bus); n.start(t); n.stop(t + 2.2);
    },
    wiper() {
      const t = now(), n = noise(), hp = ctx.createBiquadFilter(), g = ctx.createGain();
      hp.type = 'bandpass'; hp.frequency.value = 1500; hp.Q.value = 0.7; env(g, t, 0.12, 0.05, 0.25);
      n.connect(hp); hp.connect(g); g.connect(bus); n.start(t); n.stop(t + 0.5);
      const o = ctx.createOscillator(), og = ctx.createGain(); o.frequency.value = 95; env(og, t + 0.36, 0.005, 0.12, 0.08);
      o.connect(og); og.connect(bus); o.start(t + 0.3); o.stop(t + 0.5);
    },
    horn(dur = 1.4) { // a truck's air horn, getting closer
      const t = now(), g = ctx.createGain(), f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2200;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.28, t + 0.06); g.gain.setValueAtTime(0.28, t + dur - 0.1); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      for (const fr of [277, 349, 415]) { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(fr, t); o.frequency.linearRampToValueAtTime(fr * 1.04, t + dur); o.connect(f); o.start(t); o.stop(t + dur + 0.05); }
      f.connect(g); g.connect(bus);
    },
    screech() {
      const t = now(), n = noise(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
      bp.type = 'bandpass'; bp.Q.value = 9; bp.frequency.setValueAtTime(1700, t); bp.frequency.linearRampToValueAtTime(2500, t + 0.8);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.4, t + 0.08); g.gain.setValueAtTime(0.4, t + 0.75); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);
      n.connect(bp); bp.connect(g); g.connect(bus); n.start(t); n.stop(t + 0.9);
    },
    impact() {
      const t = now();
      eng.gain.cancelScheduledValues(t); eng.gain.setValueAtTime(0.0001, t); wg.gain.setValueAtTime(0.0001, t);
      const n = noise(), lp2 = ctx.createBiquadFilter(), g = ctx.createGain();
      lp2.type = 'lowpass'; lp2.frequency.setValueAtTime(6000, t); lp2.frequency.exponentialRampToValueAtTime(200, t + 1.2);
      env(g, t, 0.004, 1.4, 1.3); n.connect(lp2); lp2.connect(g); g.connect(audio.master); n.start(t); n.stop(t + 1.6);
      const o = ctx.createOscillator(), og = ctx.createGain(); o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(22, t + 1);
      env(og, t, 0.005, 1.6, 1.1); o.connect(og); og.connect(audio.master); o.start(t); o.stop(t + 1.3);
      // glass raining down
      for (let k = 0; k < 26; k++) {
        const tt = t + 0.08 + Math.random() * 0.9, b = ctx.createOscillator(), bg = ctx.createGain();
        b.type = 'triangle'; b.frequency.value = rnd(2500, 7000); env(bg, tt, 0.002, rnd(0.02, 0.08), rnd(0.05, 0.2));
        b.connect(bg); bg.connect(audio.master); b.start(tt); b.stop(tt + 0.3);
      }
    },
    ring() { // ears ringing in the dark, a slow heartbeat under it
      const t = now(), o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = 3900;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + 6);
      o.connect(g); g.connect(audio.master); o.start(t); o.stop(t + 6.2);
      [0.8, 2.0].forEach((d) => setTimeout(() => { try { audio.heartbeat(0.55); } catch {} }, d * 1000));
    },
    stop() {
      const t = now(); bus.gain.cancelScheduledValues(t); bus.gain.setTargetAtTime(0.0001, t, 0.15);
      setTimeout(() => { nodes.forEach((n) => { try { n.stop(); } catch {} }); bus.disconnect(); }, 900);
    },
  };
  return api;
}

// ---------------------------------------------------------------- the live inside-the-car scene
function roadTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 512; const g = c.getContext('2d');
  g.fillStyle = '#16181b'; g.fillRect(0, 0, 256, 512);
  for (let k = 0; k < 3000; k++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${rnd(0.02, 0.08)})`; g.fillRect(Math.random() * 256, Math.random() * 512, 2, 2); }
  const edge = g.createLinearGradient(0, 0, 256, 0); // packed snow at both edges, darker wet tyre tracks
  edge.addColorStop(0, 'rgba(190,200,215,0.95)'); edge.addColorStop(0.12, 'rgba(150,160,175,0.45)'); edge.addColorStop(0.2, 'rgba(0,0,0,0)');
  edge.addColorStop(0.8, 'rgba(0,0,0,0)'); edge.addColorStop(0.88, 'rgba(150,160,175,0.45)'); edge.addColorStop(1, 'rgba(190,200,215,0.95)');
  g.fillStyle = edge; g.fillRect(0, 0, 256, 512);
  g.fillStyle = 'rgba(170,180,195,0.25)'; g.fillRect(118, 0, 20, 512);
  g.fillStyle = '#c9c3a8'; g.fillRect(125, 40, 6, 200); // centre dash
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function glowSprite(color) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
}

// lamp lenses from the Blender materials: make them glow regardless of how the emission came through
function lampsGlow(root) {
  const looks = [[/truck_head|car_head/, 0xffffff], [/amber/, 0xff8a20], [/car_tail/, 0xff1a10], [/gauge2/, 0x8a4c18], [/gauge/, 0x1f6280]];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const hit = looks.find(([re]) => re.test(o.material.name));
    if (hit) o.material = new THREE.MeshBasicMaterial({ color: hit[1], fog: false, toneMapped: false });
  });
}

function buildLive(assets, players) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x030406);
  scene.fog = new THREE.FogExp2(0x06080c, 0.032);
  scene.add(new THREE.HemisphereLight(0x1a2436, 0x050403, 0.35));

  // the car (fixed at the origin, facing -Z; the world streams past it)
  const car = assets.car; car.position.set(0, 0, 0); car.rotation.set(0, 0, 0);
  const seats = [], wipers = [];
  car.traverse((o) => {
    if (/^seat_\d/.test(o.name)) seats[+o.name.split('_')[1]] = o;
    if (/^wiper_pivot/.test(o.name)) wipers.push({ o, q0: o.quaternion.clone() });
    if (o.isMesh) {
      o.frustumCulled = false;
      const m = o.material;
      if (/glass/i.test(m.name)) { m.transparent = true; m.opacity = /windshield/i.test(o.name) ? 0.08 : 0.22; m.depthWrite = false; m.color.set(0x0a0d12); }
    }
  });
  lampsGlow(car);
  scene.add(car); car.updateMatrixWorld(true);
  const dash = new THREE.PointLight(0x46b8ff, 1.4, 3.2, 1.5); dash.position.set(0.15, 1.28, -0.35); scene.add(dash);
  const amber = new THREE.PointLight(0xff9a40, 0.5, 2, 1.5); amber.position.set(0.5, 1.2, -0.45); scene.add(amber);
  const heads = [-0.66, 0.66].map((x) => {
    const s = new THREE.SpotLight(0xfff0dc, 260, 60, 0.5, 0.55, 1.4); s.position.set(x, 0.86, -2.4);
    s.target.position.set(x * 1.6, -0.6, -26); scene.add(s, s.target); return s;
  });

  // the players, in their seats (seat 0 is the driver, right-hand drive)
  const people = [];
  players.slice(0, 6).forEach((p, i) => {
    const ch = createSeatedCharacter(p.char, i);
    const seat = seats[i];
    if (!ch || !seat) return;
    const wp = new THREE.Vector3(); seat.getWorldPosition(wp);
    ch.placeHips(wp); scene.add(ch.root); people.push(ch);
  });

  // the world that moves past: road, snow banks, guard rail, pines, street lamps, snow, the truck
  const world = new THREE.Group(); scene.add(world);
  const roadTex = roadTexture(); roadTex.repeat.set(1, 26);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(7.4, 200), new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.55 }));
  road.rotation.x = -Math.PI / 2; road.position.set(1.85, 0.0, -90); world.add(road);
  const snowM = new THREE.MeshStandardMaterial({ color: 0x8a95aa, roughness: 0.95 });
  for (const [x, w] of [[-32, 60], [37.5, 60]]) { const s = new THREE.Mesh(new THREE.PlaneGeometry(w, 200), snowM); s.rotation.x = -Math.PI / 2; s.position.set(x + (x < 0 ? -0.0 : 0), 0.05, -90); world.add(s); }
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 200), new THREE.MeshStandardMaterial({ color: 0x777b80, metalness: 0.8, roughness: 0.35 }));
  rail.position.set(-2.55, 0.75, -90); world.add(rail);
  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.8, 0.1), rail.material, 50); world.add(posts);
  const pineG = new THREE.ConeGeometry(1.6, 6, 7); pineG.translate(0, 3, 0);
  const pines = new THREE.InstancedMesh(pineG, new THREE.MeshStandardMaterial({ color: 0x0b1410, roughness: 1 }), 90); world.add(pines);
  const pineData = Array.from({ length: 90 }, () => ({ x: Math.random() < 0.5 ? rnd(-40, -6) : rnd(9, 45), z: rnd(-200, 20), s: rnd(0.7, 1.6) }));
  const dummy = new THREE.Object3D();
  // street lamps going past for the first seconds, then the dark stretch
  const lamps = [0.2, 2.35, 4.5].map((t0, k) => {
    const g = new THREE.Group(); world.add(g);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 4.8, 8), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5, metalness: 0.6 }));
    pole.position.y = 2.4; g.add(pole);
    const glow = glowSprite(0xffa050); glow.scale.setScalar(2.2); glow.position.y = 4.15; g.add(glow);
    const L = new THREE.PointLight(0xff9a40, 0, 22, 1.4); L.position.y = 4.1; g.add(L);
    return { g, glow, L, t0, dead: k === 2 };
  });
  // snow: streams towards the windshield
  const N = 2600, pos = new Float32Array(N * 3);
  for (let k = 0; k < N; k++) { pos[k * 3] = rnd(-12, 14); pos[k * 3 + 1] = rnd(0, 7); pos[k * 3 + 2] = rnd(-70, 8); }
  const snowG = new THREE.BufferGeometry(); snowG.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const snow = new THREE.Points(snowG, new THREE.PointsMaterial({ color: 0xc8d2e0, size: 0.045, transparent: true, opacity: 0.85, depthWrite: false }));
  snow.frustumCulled = false; world.add(snow);
  // the truck, in our lane
  const truck = assets.truck; truck.rotation.set(0, Math.PI, 0); truck.position.set(0.1, 0, -400); world.add(truck);
  lampsGlow(truck);
  const tLights = [-0.9, 0.9].map((x) => {
    // (in the model's own space the truck's nose points to -Z)
    const s = new THREE.SpotLight(0xe0ebff, 0, 120, 0.42, 0.4, 1.2); s.position.set(x, 1.15, -4.9);
    s.target.position.set(x, 0.3, -40); truck.add(s, s.target);
    const gl = glowSprite(0xdde8ff); gl.position.set(x, 1.15, -5.0); truck.add(gl);
    return { s, gl };
  });

  const cam = new THREE.PerspectiveCamera(56, innerWidth / innerHeight, 0.05, 400);
  let travelled = 0;
  return {
    scene, cam,
    update(t, dt) {
      travelled += SPEED * dt;
      roadTex.offset.y = -(travelled / (200 / 26)) % 1;
      for (let k = 0; k < 50; k++) {
        const z = -196 + ((k * 4 + travelled) % 200);
        dummy.position.set(-2.55, 0.4, z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); posts.setMatrixAt(k, dummy.matrix);
      }
      posts.instanceMatrix.needsUpdate = true;
      pineData.forEach((p, k) => {
        let z = p.z + travelled; z = -200 + (((z + 200) % 220) + 220) % 220;
        dummy.position.set(p.x, 0, z); dummy.scale.setScalar(p.s); dummy.updateMatrix(); pines.setMatrixAt(k, dummy.matrix);
      });
      pines.instanceMatrix.needsUpdate = true;
      for (const lp of lamps) { // they come from far ahead and pass on the right
        const z = -55 + SPEED * (t - lp.t0);
        lp.g.position.set(4.9, 0, z);
        let on = z > -60 && z < 25 ? 1 : 0;
        if (lp.dead) on = t < lp.t0 + 1.4 && Math.random() < 0.5 ? 1 : 0; // the last one flickers and dies
        lp.L.intensity = on * 260; lp.glow.material.opacity = on;
      }
      const p = snowG.attributes.position.array;
      for (let k = 0; k < N; k++) {
        p[k * 3 + 2] += SPEED * dt; p[k * 3 + 1] -= 1.1 * dt; p[k * 3] += 0.6 * dt;
        if (p[k * 3 + 2] > 8) p[k * 3 + 2] -= 78;
        if (p[k * 3 + 1] < 0) p[k * 3 + 1] += 7;
        if (p[k * 3] > 14) p[k * 3] -= 26;
      }
      snowG.attributes.position.needsUpdate = true;

      // the truck: appears when the camera turns to the windshield, closing at 34 m/s; high beams at the end
      const tt = t - T_TRUCK;
      const front = -2.33 - 4.75; // where its nose meets ours
      truck.position.z = tt < 0 ? -400 : front - (INTRO.live - T_TRUCK - tt) * (SPEED + 19);
      const d = Math.max(1, -truck.position.z);
      const high = smooth(INTRO.live - 2.2, INTRO.live - 1.9, t);
      tLights.forEach((L) => { L.s.intensity = tt < 0 ? 0 : 900 + high * 5000; L.gl.scale.setScalar((tt < 0 ? 0 : 0.8 + high * 2.5) * (1 + 40 / d)); });

      // wipers in the second half
      if (t > T_TRUCK - 0.3) wipers.forEach((w, k) => {
        const a = Math.max(0, Math.sin((t - T_TRUCK) * Math.PI / 1.1)) * 1.25;
        w.o.quaternion.copy(w.q0).premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a));
      });
      // the driver yanks the wheel too late
      const swerve = smooth(INTRO.live - 0.9, INTRO.live - 0.1, t);
      world.rotation.y = -0.16 * swerve; world.position.x = 0.4 * swerve;

      const fear = smooth(INTRO.live - 1.6, INTRO.live - 0.6, t);
      people.forEach((ch) => ch.update(dt, t, fear, t > T_TRUCK ? 0 : 1));

      // cameras
      const bump = Math.sin(t * 9.1) * 0.006 + Math.sin(t * 3.3) * 0.004;
      const shake = fear * 0.03;
      if (t < T_TRUCK) { // on the dashboard, looking back at everyone
        cam.fov = 70;
        cam.position.set(0.04 + Math.sin(t * 0.7) * 0.03, 1.52 + bump, -1.0);
        cam.lookAt(0, 1.0 + Math.sin(t * 0.5) * 0.03, 1.6);
      } else { // from behind the front seats, out through the windshield
        cam.fov = 50;
        cam.position.set(-0.18 + (Math.random() - 0.5) * shake, 1.52 + bump + (Math.random() - 0.5) * shake, 0.62);
        cam.lookAt(0.12, 1.16, -14);
        cam.rotation.z += swerve * 0.08 + (Math.random() - 0.5) * shake;
      }
      cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix();
      dash.intensity = 1.4 + Math.random() * 0.1;
    },
    dispose() {
      scene.traverse((o) => { if (o.isMesh || o.isPoints || o.isSprite) { o.geometry?.dispose?.(); } });
      roadTex.dispose(); snowG.dispose();
      people.forEach((p) => p.dispose?.());
    },
  };
}

// ---------------------------------------------------------------- the whole sequence
export { buildLive as _buildLive };
export function playIntro({ renderer, assets, players, audio, calm, onDone }) {
  const el = document.getElementById('intro');
  const video = el.querySelector('video');
  const fade = el.querySelector('.ifade');
  const skipEl = el.querySelector('.iskip');
  const snd = introSound(audio);
  el.className = 'show';
  fade.style.transition = 'none'; fade.style.opacity = 1; fade.style.background = '#000';
  video.src = assets.videoURL; video.muted = true; video.currentTime = 0;
  let phase = 'video', t = 0, live = null, holdT = 0, done = false, vidLen = 16.25;
  const started = performance.now(); let lastNow = started, aborted = false;
  const cues = [];
  const cue = (at, fn) => cues.push({ at, fn });
  // sound cues on the video's timeline (frames / 24 in blender/build_intro.py)
  cue(0.05, () => snd?.start());
  cue(4.6, () => snd?.buzz()); cue(8.4, () => snd?.buzz());
  cue(10.25, () => snd?.whoosh());
  [13.0, 13.6, 14.2, 14.8].forEach((s) => cue(s, () => snd?.buzz()));
  video.onloadedmetadata = () => { if (isFinite(video.duration)) vidLen = video.duration; };
  video.onplaying = () => { fade.style.transition = 'opacity 1.2s'; fade.style.opacity = 0; };
  video.onended = () => startLive();
  video.onerror = () => startLive();
  video.play().catch(() => startLive());

  function startLive() {
    if (phase !== 'video') return;
    phase = 'live'; t = 0;
    video.pause(); el.classList.add('live');
    fade.style.transition = 'none'; fade.style.opacity = 1;
    live = buildLive(assets, players);
    requestAnimationFrame(() => { fade.style.transition = 'opacity 0.35s'; fade.style.opacity = 0; });
    snd?.inside();
    const at = (s, fn) => cues.push({ at: vidLen + s, fn });
    at(0.6, () => snd?.static()); at(2.6, () => snd?.static());
    at(4.6, () => snd?.buzz());
    for (let s = T_TRUCK; s < INTRO.live; s += 1.1) at(s, () => snd?.wiper());
    at(INTRO.live - 2.4, () => snd?.horn(1.0)); at(INTRO.live - 1.1, () => snd?.horn(1.1));
    at(INTRO.live - 0.85, () => snd?.screech());
  }

  function finish(skipped) {
    if (done) return;
    done = true; phase = 'black';
    fade.style.transition = skipped ? 'opacity 0.25s' : 'none'; fade.style.opacity = 1;
    fade.style.background = skipped || calm ? '#000' : '#fff';
    if (!skipped) {
      snd?.impact();
      setTimeout(() => { fade.style.transition = 'background 0.5s'; fade.style.background = '#000'; }, 90);
      setTimeout(() => snd?.ring(), 700);
    } else snd?.stop();
    setTimeout(() => {
      if (aborted) return;
      video.pause(); video.removeAttribute('src'); video.load();
      live?.dispose(); live = null;
      el.className = ''; removeEventListener('keydown', kd); removeEventListener('keyup', ku);
      if (!skipped) setTimeout(() => snd?.stop(), 4000);
      onDone();
    }, skipped ? 400 : INTRO.black * 1000);
  }
  function abort() { // the game ended or this player died while the intro was still running
    aborted = true;
    if (done && !live && el.className === '') return;
    done = true; snd?.stop();
    video.pause(); video.removeAttribute('src'); video.load();
    live?.dispose(); live = null;
    el.className = ''; removeEventListener('keydown', kd); removeEventListener('keyup', ku);
  }

  let holding = false;
  const kd = (e) => { if (e.code === 'Space') { holding = true; e.preventDefault(); } if (e.code === 'Escape') finish(true); };
  const ku = (e) => { if (e.code === 'Space') holding = false; };
  addEventListener('keydown', kd); addEventListener('keyup', ku);

  return {
    frame() {
      // real time, so a throttled or background tab doesn't stretch the intro (the ghost wakes up on the server's clock)
      const nowMs = performance.now(); const dt = Math.min(0.25, (nowMs - lastNow) / 1000); lastNow = nowMs;
      if (!done && nowMs - started > 40000) { finish(true); return; }
      if (holding) { holdT += dt; if (holdT > 0.7) finish(true); } else holdT = Math.max(0, holdT - dt * 2);
      skipEl.style.setProperty('--p', Math.min(1, holdT / 0.7));
      const clock = phase === 'video' ? video.currentTime : vidLen + t;
      for (const c of cues) if (!c.fired && clock >= c.at) { c.fired = true; c.fn(); }
      if (phase === 'live' && live) {
        t += dt;
        live.update(t, dt);
        renderer.render(live.scene, live.cam);
        if (t >= INTRO.live) finish(false);
      }
    },
    skip: () => finish(true),
    abort,
  };
}
