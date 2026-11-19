// Intro cut scene, played when a game starts.
//  1. /video/intro.mp4: the outside shots, rendered in Blender (blender/build_intro.py): the car on the snowy
//     mountain road, the street lamps flickering and dying one by one.
//  2. Live: inside the same car (intro_car.glb from that Blender scene) with every player's own character in the
//     seats (the first player drives, hands on the wheel). In co-op the friends talk about their holiday plan
//     (spoken with the browser's voices + subtitles) until the lamps go out. Then through the windshield: a
//     truck's lights in their lane, the horn, high beams, the driver yanks the wheel, the car skids, and a
//     slow-motion shot from outside as the truck hits.
//  3. Black, ringing ears. Then the game: you wake up on the floor of the house.
// Hold Space (or Esc) to skip.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createSeatedCharacter } from './entities.js';

const VIDEO_URL = '/video/intro.mp4';
export const INTRO = { black: 2.8, maxSeconds: 75 };
const SPEED = 15; // m/s, the car
const TRUCK_V = 19; // m/s, the truck
// truck sequence, seconds after the camera turns to the windshield
const TR = { horn1: 2.2, beams: 3.3, horn2: 3.4, swerve: 3.75, outside: 4.25, impact: 4.85 };
const SLOWMO = 0.28;

let pre = null;
export function preloadIntro() {
  if (pre) return pre;
  const loader = new GLTFLoader();
  try { speechSynthesis.getVoices(); } catch {} // voices load asynchronously in some browsers
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

// ---------------------------------------------------------------- the holiday plan (co-op only)
// s = which friend says it (0 = the driver); lines map onto however many players there are.
// {n0}.. = the player names of those friends. dark: the lamps start dying on this line.
const SCRIPT = [
  { s: 1, text: 'Bro, how much longer? You said Manali by midnight.' },
  { s: 0, text: 'Relax yaar, one more hour. Then three full days of snow, maggi and zero work.' },
  { s: 2, text: "And paragliding at Solang! I'm not going home without doing it." },
  { s: 1, text: 'You will scream like you did on the ropeway, {n2}.' },
  { s: 3, text: 'Momos on Mall Road first. Then that old temple in the forest, at night.' },
  { s: 0, text: 'At night? In that forest? No thank you.' },
  { s: 2, text: 'Wait... why are all the lights going off?', dark: true },
  { s: 0, text: 'Power cut, probably. These hill roads are always like this.' },
  { s: 1, text: 'No signal either. Just drive faster, {n0}.' },
];

function buildDialogue(players) {
  const n = Math.min(players.length, 6);
  if (n < 2) return [];
  const who = (s) => (s < n ? s : s % n);
  const name = (s) => players[who(s)]?.name || 'bro';
  return SCRIPT.map((l) => ({ seat: who(l.s), dark: !!l.dark, text: l.text.replace(/\{n(\d)\}/g, (_, d) => name(+d)) }));
}

function pickVoices() {
  let vs = [];
  try { vs = speechSynthesis.getVoices() || []; } catch { return []; }
  const en = vs.filter((v) => /^en/i.test(v.lang));
  const indian = en.filter((v) => /IN/i.test(v.lang));
  const pool = [...indian, ...en.filter((v) => !indian.includes(v))];
  return pool.length ? pool : vs;
}

// ---------------------------------------------------------------- sound (built on the game's audio engine)
function introSound(audio) {
  const ctx = audio.ctx;
  if (!ctx) return null;
  const bus = ctx.createGain(); bus.gain.value = 1; bus.connect(audio.master);
  const nodes = [];
  const noise = () => { const s = ctx.createBufferSource(); s.buffer = audio.white; s.loop = true; return s; };
  const env = (g, t, a, peak, d) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); };
  const drive = (k) => { const n = 1024, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i / n) * 2 - 1; c[i] = Math.tanh(x * k); } const w = ctx.createWaveShaper(); w.curve = c; return w; };
  // engine: two detuned low saws, and wind over the car
  const eng = ctx.createGain(); eng.gain.value = 0.0001; eng.connect(bus);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160; lp.connect(eng);
  const oscs = [46, 48.7, 92].map((f) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp); o.start(); nodes.push(o); return o; });
  const wind = noise(); const wbp = ctx.createBiquadFilter(); wbp.type = 'bandpass'; wbp.frequency.value = 420; wbp.Q.value = 0.5;
  const wg = ctx.createGain(); wg.gain.value = 0.0001; wind.connect(wbp); wbp.connect(wg); wg.connect(bus); wind.start(); nodes.push(wind);
  // a failing street lamp: mains hum + crackle; its level is driven every frame by the lamps
  const hum = ctx.createGain(); hum.gain.value = 0; hum.connect(bus);
  const hf = ctx.createBiquadFilter(); hf.type = 'bandpass'; hf.frequency.value = 900; hf.Q.value = 0.8; hf.connect(hum);
  [100, 200, 300, 120].forEach((f, i) => { const o = ctx.createOscillator(); o.type = i === 3 ? 'square' : 'sawtooth'; o.frequency.value = f; const g = ctx.createGain(); g.gain.value = i === 3 ? 0.25 : 0.5 / (i + 1); o.connect(g); g.connect(hf); o.start(); nodes.push(o); });
  const crk = noise(); const crf = ctx.createBiquadFilter(); crf.type = 'highpass'; crf.frequency.value = 2500; crk.connect(crf); crf.connect(hum); crk.start(); nodes.push(crk);
  const now = () => ctx.currentTime;
  let horn = null;
  const api = {
    start() { eng.gain.setTargetAtTime(0.16, now(), 0.8); wg.gain.setTargetAtTime(0.09, now(), 1.2); },
    inside() { eng.gain.setTargetAtTime(0.2, now(), 0.3); lp.frequency.setTargetAtTime(110, now(), 0.3); wg.gain.setTargetAtTime(0.05, now(), 0.3); },
    // electrical buzzing + crackle while a lamp flickers (level 0..1, set many times a second)
    lamp(level) { hum.gain.setTargetAtTime(level * 0.09, now(), 0.008); },
    flicker(dur = 0.6) { // a burst of flicker crackle on the movie's timeline
      const t = now(); let k = 0;
      for (let s = 0; s < dur; s += rnd(0.03, 0.09)) { hum.gain.setValueAtTime((k++ % 2 ? 0 : rnd(0.04, 0.1)), t + s); }
      hum.gain.setValueAtTime(0, t + dur);
    },
    pop() { // a bulb giving up: a click, a fizz
      const t = now(), n = noise(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      f.type = 'bandpass'; f.frequency.value = 3200; f.Q.value = 2; env(g, t, 0.002, 0.25, 0.35);
      n.connect(f); f.connect(g); g.connect(bus); n.start(t); n.stop(t + 0.5);
      const o = ctx.createOscillator(), og = ctx.createGain(); o.type = 'square'; o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.08);
      env(og, t, 0.001, 0.12, 0.08); o.connect(og); og.connect(bus); o.start(t); o.stop(t + 0.15);
    },
    whoosh() { // the car rushing past the roadside camera
      const t = now(), n = noise(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
      bp.type = 'bandpass'; bp.Q.value = 0.8; bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(1400, t + 0.5); bp.frequency.exponentialRampToValueAtTime(250, t + 1.6);
      env(g, t, 0.45, 0.35, 1.3); n.connect(bp); bp.connect(g); g.connect(bus); n.start(t); n.stop(t + 2);
      oscs.forEach((o) => { o.frequency.setValueAtTime(o.frequency.value * 1.12, t + 0.3); o.frequency.exponentialRampToValueAtTime(o.frequency.value * 0.86, t + 1.2); o.frequency.setTargetAtTime(o.frequency.value, t + 2, 0.5); });
    },
    static() { // the radio losing the station
      const t = now(), n = noise(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
      bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 1.2; g.gain.value = 0;
      for (let k = 0; k < 40; k++) g.gain.setValueAtTime(Math.random() < 0.55 ? rnd(0.01, 0.04) : 0, t + k * 0.05);
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
    // a big truck's air horn: a harsh, slightly out-of-tune chord with a hard attack, rising as it closes in
    horn(dur = 1.4, vol = 0.32) {
      api.hornOff();
      const t = now(), out = ctx.createGain(), sh = drive(4), lpf = ctx.createBiquadFilter(), f1 = ctx.createBiquadFilter(), f2 = ctx.createBiquadFilter();
      lpf.type = 'lowpass'; lpf.frequency.value = 3800;
      f1.type = 'peaking'; f1.frequency.value = 650; f1.gain.value = 9; f1.Q.value = 1.4;
      f2.type = 'peaking'; f2.frequency.value = 1350; f2.gain.value = 6; f2.Q.value = 1.6;
      sh.connect(f1); f1.connect(f2); f2.connect(lpf); lpf.connect(out);
      out.gain.setValueAtTime(0.0001, t); out.gain.exponentialRampToValueAtTime(vol, t + 0.025);
      out.gain.linearRampToValueAtTime(vol * 1.25, t + dur);
      out.connect(bus); audio.out?.(out, 0.25);
      const os = [];
      for (const [fr, det] of [[233, -6], [294, 4], [349, -3], [466, 7]]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(fr * 0.94, t); o.frequency.exponentialRampToValueAtTime(fr, t + 0.06);
        o.frequency.linearRampToValueAtTime(fr * 1.03, t + dur); o.detune.value = det;
        const vib = ctx.createOscillator(), vg = ctx.createGain(); vib.frequency.value = rnd(5, 7); vg.gain.value = 2.5; vib.connect(vg); vg.connect(o.frequency);
        const g = ctx.createGain(); g.gain.value = 0.25; o.connect(g); g.connect(sh); o.start(t); vib.start(t); os.push(o, vib);
      }
      horn = { out, os, end: t + dur };
      out.gain.setValueAtTime(vol * 1.25, t + dur); out.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.12);
      os.forEach((o) => o.stop(t + dur + 0.15));
    },
    hornOff() { if (horn && horn.end > now()) { const t = now(); horn.out.gain.cancelScheduledValues(t); horn.out.gain.setTargetAtTime(0.0001, t, 0.03); horn.os.forEach((o) => { try { o.stop(t + 0.2); } catch {} }); } horn = null; },
    screech() {
      const t = now(), n = noise(), bp = ctx.createBiquadFilter(), g = ctx.createGain(), n2 = noise(), bp2 = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.Q.value = 9; bp.frequency.setValueAtTime(1700, t); bp.frequency.linearRampToValueAtTime(2500, t + 1.4);
      bp2.type = 'bandpass'; bp2.Q.value = 12; bp2.frequency.setValueAtTime(3300, t); bp2.frequency.linearRampToValueAtTime(2900, t + 1.4);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.45, t + 0.06); g.gain.setValueAtTime(0.45, t + 1.6); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
      n.connect(bp); n2.connect(bp2); bp.connect(g); bp2.connect(g); g.connect(bus); n.start(t); n2.start(t); n.stop(t + 1.9); n2.stop(t + 1.9);
    },
    slow() { eng.gain.setTargetAtTime(0.05, now(), 0.2); lp.frequency.setTargetAtTime(60, now(), 0.2); oscs.forEach((o) => o.frequency.setTargetAtTime(o.frequency.value * 0.6, now(), 0.3)); },
    impact() {
      const t = now();
      api.hornOff(); hum.gain.setValueAtTime(0, t);
      eng.gain.cancelScheduledValues(t); eng.gain.setValueAtTime(0.0001, t); wg.gain.setValueAtTime(0.0001, t);
      const n = noise(), lp2 = ctx.createBiquadFilter(), g = ctx.createGain();
      lp2.type = 'lowpass'; lp2.frequency.setValueAtTime(6000, t); lp2.frequency.exponentialRampToValueAtTime(200, t + 1.2);
      env(g, t, 0.004, 1.4, 1.3); n.connect(lp2); lp2.connect(g); g.connect(audio.master); n.start(t); n.stop(t + 1.6);
      const o = ctx.createOscillator(), og = ctx.createGain(); o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(22, t + 1);
      env(og, t, 0.005, 1.6, 1.1); o.connect(og); og.connect(audio.master); o.start(t); o.stop(t + 1.3);
      for (let k = 0; k < 4; k++) { // metal folding
        const tt = t + 0.02 + k * 0.07, m = ctx.createOscillator(), mg = ctx.createGain(); m.type = 'sawtooth';
        m.frequency.setValueAtTime(rnd(90, 160), tt); m.frequency.exponentialRampToValueAtTime(rnd(30, 50), tt + 0.4);
        env(mg, tt, 0.004, 0.35, 0.4); m.connect(mg); mg.connect(audio.master); m.start(tt); m.stop(tt + 0.5);
      }
      for (let k = 0; k < 30; k++) { // glass raining down
        const tt = t + 0.08 + Math.random() * 1.1, b = ctx.createOscillator(), bg = ctx.createGain();
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

function buildLive(assets, players, hooks = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x030406);
  scene.fog = new THREE.FogExp2(0x06080c, 0.032);
  scene.add(new THREE.HemisphereLight(0x1a2436, 0x050403, 0.35));

  // the car rig: the car, everyone in it and its lights move together (it swerves, skids, gets hit);
  // the road and everything outside stream past it (it sits near the origin facing -Z)
  const rig = new THREE.Group(); scene.add(rig);
  const car = assets.car; car.position.set(0, 0, 0); car.rotation.set(0, 0, 0); rig.add(car);
  const seats = [], wipers = []; let wheel = null;
  car.traverse((o) => {
    if (!o.userData.q0) o.userData.q0 = o.quaternion.clone(); // the cached model is reused next game
    o.quaternion.copy(o.userData.q0);
    if (/^seat_\d/.test(o.name)) seats[+o.name.split('_')[1]] = o;
    if (/^wiper_pivot/.test(o.name)) wipers.push(o);
    if (/car_steering/.test(o.name) && o.isMesh) wheel = o;
    if (o.isMesh) {
      o.frustumCulled = false;
      const m = o.material;
      if (/glass/i.test(m.name)) { m.transparent = true; m.opacity = /windshield/i.test(o.name) ? 0.08 : 0.22; m.depthWrite = false; m.color.set(0x0a0d12); }
    }
  });
  lampsGlow(car);
  rig.updateMatrixWorld(true);
  const dash = new THREE.PointLight(0x46b8ff, 1.4, 3.2, 1.5); dash.position.set(0.15, 1.28, -0.35); rig.add(dash);
  const amber = new THREE.PointLight(0xff9a40, 0.5, 2, 1.5); amber.position.set(0.5, 1.2, -0.45); rig.add(amber);
  [-0.66, 0.66].forEach((x) => {
    const s = new THREE.SpotLight(0xfff0dc, 260, 60, 0.5, 0.55, 1.4); s.position.set(x, 0.86, -2.4);
    s.target.position.set(x * 1.6, -0.6, -26); rig.add(s, s.target);
  });

  // the players, in their seats (seat 0 is the driver, right-hand drive)
  const people = [];
  players.slice(0, 6).forEach((p, i) => {
    const ch = createSeatedCharacter(p.char, i);
    const seat = seats[i];
    if (!ch || !seat) return;
    const wp = new THREE.Vector3(); seat.getWorldPosition(wp);
    ch.placeHips(wp); rig.add(ch.root);
    people.push({ ch, seat: i, x: wp.x, z: wp.z, base: ch.root.position.clone() });
  });

  // the world that moves past: road, snow banks, guard rail, pines, street lamps, snow, the truck
  const world = new THREE.Group(); scene.add(world);
  const roadTex = roadTexture(); roadTex.repeat.set(1, 26);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(7.4, 200), new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.55 }));
  road.rotation.x = -Math.PI / 2; road.position.set(1.85, 0.0, -90); world.add(road);
  const snowM = new THREE.MeshStandardMaterial({ color: 0x8a95aa, roughness: 0.95 });
  for (const x of [-32, 37.5]) { const s = new THREE.Mesh(new THREE.PlaneGeometry(60, 200), snowM); s.rotation.x = -Math.PI / 2; s.position.set(x, 0.05, -90); world.add(s); }
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 200), new THREE.MeshStandardMaterial({ color: 0x777b80, metalness: 0.8, roughness: 0.35 }));
  rail.position.set(-2.55, 0.75, -90); world.add(rail);
  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.8, 0.1), rail.material, 50); world.add(posts);
  const pineG = new THREE.ConeGeometry(1.6, 6, 7); pineG.translate(0, 3, 0);
  const pines = new THREE.InstancedMesh(pineG, new THREE.MeshStandardMaterial({ color: 0x0b1410, roughness: 1 }), 90); world.add(pines);
  const pineData = Array.from({ length: 90 }, () => ({ x: Math.random() < 0.5 ? rnd(-40, -6) : rnd(9, 45), z: rnd(-200, 20), s: rnd(0.7, 1.6) }));
  const dummy = new THREE.Object3D();
  // street lamps keep coming past (every 32 m) until the dark stretch begins
  const lampPool = [0, 1, 2, 3].map(() => {
    const g = new THREE.Group(); world.add(g);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 4.8, 8), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5, metalness: 0.6 }));
    pole.position.y = 2.4; g.add(pole);
    const glow = glowSprite(0xffa050); glow.scale.setScalar(2.2); glow.position.y = 4.15; g.add(glow);
    const L = new THREE.PointLight(0xff9a40, 0, 22, 1.4); L.position.y = 4.1; g.add(L);
    return { g, glow, L };
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
  const tLights = [-0.9, 0.9].map((x) => { // (in the model's own space the truck's nose points to -Z)
    const s = new THREE.SpotLight(0xe0ebff, 0, 120, 0.42, 0.4, 1.2); s.position.set(x, 1.15, -4.9);
    s.target.position.set(x, 0.3, -40); truck.add(s, s.target);
    const gl = glowSprite(0xdde8ff); gl.position.set(x, 1.15, -5.0); truck.add(gl);
    return { s, gl };
  });
  // glass bursting out at the impact
  const GN = 420, gpos = new Float32Array(GN * 3), gvel = [];
  const glassG = new THREE.BufferGeometry(); glassG.setAttribute('position', new THREE.BufferAttribute(gpos, 3));
  const glass = new THREE.Points(glassG, new THREE.PointsMaterial({ color: 0xdfeaff, size: 0.06, transparent: true, opacity: 0.9, depthWrite: false }));
  glass.frustumCulled = false; glass.visible = false; scene.add(glass);

  const cam = new THREE.PerspectiveCamera(56, innerWidth / innerHeight, 0.05, 400);
  const v = new THREE.Vector3(), v2 = new THREE.Vector3();
  let travelled = 0, tDark = Infinity, tTruck = Infinity, hit = -1, lampState = 0, truckZ0 = 0;
  const S = { timeScale: 1, outside: false, done: false, talk: -1 };

  function lampsAt(t, dt) {
    // lamps every 32 m on the right; once it's dark they flicker, crackle and die one by one
    let level = 0;
    lampPool.forEach((lp, k) => {
      const phase = (travelled + k * 32) % 128;
      const z = -96 + phase; // from 96 m ahead to 32 m behind
      lp.g.position.set(4.9, 0, z);
      const passT = t - (z + 96) / SPEED; // when this lamp came into view
      let on = 1;
      if (passT > tDark) on = 0; // lamps that appear after it went dark are dead
      else if (t > tDark) { const d = t - tDark - k * 0.45; on = d < 0 ? 1 : d < 0.6 ? (Math.random() < 0.45 ? 1 : 0) : 0; if (d > 0 && d < 0.6) level = Math.max(level, on ? 1 : 0.4); }
      lp.L.intensity = on * 260; lp.glow.material.opacity = on;
      if (on && z > -40 && z < 10) level = Math.max(level, 0.12 * (1 - Math.abs(z + 15) / 25)); // the hum as one goes by
    });
    hooks.lamp?.(level);
    const dead = t > tDark && lampPool.every((lp) => lp.L.intensity === 0);
    if (dead && lampState === 0) { lampState = 1; hooks.pop?.(); }
  }

  return {
    scene, cam, S,
    setDark(t) { if (tDark === Infinity) tDark = t; },
    setTruck(t) { if (tTruck === Infinity) tTruck = t; },
    setTalk(seat) { S.talk = seat; },
    get truckT() { return tTruck; },
    update(t, dt) {
      const T = t - tTruck; // seconds into the truck sequence
      const moving = hit < 0 ? 1 : Math.max(0, 1 - (t - hit) * 3);
      travelled += SPEED * dt * moving;
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
      lampsAt(t, dt);
      const p = snowG.attributes.position.array;
      for (let k = 0; k < N; k++) {
        p[k * 3 + 2] += SPEED * dt * moving; p[k * 3 + 1] -= 1.1 * dt; p[k * 3] += 0.6 * dt;
        if (p[k * 3 + 2] > 8) p[k * 3 + 2] -= 78;
        if (p[k * 3 + 1] < 0) p[k * 3 + 1] += 7;
        if (p[k * 3] > 14) p[k * 3] -= 26;
      }
      snowG.attributes.position.needsUpdate = true;

      // the swerve: the driver yanks the wheel right, the back steps out, everyone is thrown sideways
      const sw = smooth(TR.swerve, TR.swerve + 0.7, T);
      const wob = T > TR.swerve ? Math.sin((T - TR.swerve) * 11) * 0.05 * (1 - sw * 0.5) : 0;
      if (hit < 0) {
        rig.rotation.set(0, -0.62 * sw + wob, 0.07 * sw);
        rig.position.set(1.5 * sw, 0, 0);
      } else { // the hit: shoved back and spun
        const k = t - hit;
        rig.position.z = 5.5 * (1 - Math.exp(-k * 5));
        rig.rotation.y = -0.62 - 1.1 * (1 - Math.exp(-k * 4));
        rig.rotation.z = 0.07 + Math.sin(k * 40) * 0.03 * Math.exp(-k * 6);
      }
      if (wheel) wheel.quaternion.copy(wheel.userData.q0).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -2.4 * sw + wob * 4));

      // the truck: appears when the camera turns to the windshield, closing at 34 m/s, drifting into us
      // aim at our front corner on its side (the car is turned right by now)
      const corner = rig.localToWorld(v2.set(-0.85, 0.8, -2.2));
      if (T < 0) truck.position.set(0.1, 0, -400);
      else {
        const zNose = corner.z - (TR.impact - T) * (SPEED + TRUCK_V); // where its nose is
        if (hit < 0) truck.position.z = zNose - 4.75;
        else truck.position.z = truckZ0 + rig.position.z * 0.92; // pushing us back
        if (hit < 0) truck.position.x += ((corner.x + 0.6) * sw + 0.1 * (1 - sw) - truck.position.x) * Math.min(1, dt * 4);
        if (hit < 0 && T >= TR.impact) { // contact
          hit = t; truckZ0 = truck.position.z; hooks.impact?.();
          const nose = rig.localToWorld(v.set(0, 1.2, -1.9));
          for (let k = 0; k < GN; k++) {
            gpos[k * 3] = nose.x + rnd(-0.8, 0.8); gpos[k * 3 + 1] = nose.y + rnd(-0.2, 0.5); gpos[k * 3 + 2] = nose.z + rnd(-0.2, 0.3);
            gvel[k] = new THREE.Vector3(rnd(-6, 6), rnd(1, 6), rnd(-4, 7));
          }
          glass.visible = true;
        }
      }
      if (glass.visible) {
        for (let k = 0; k < GN; k++) { gvel[k].y -= 9.8 * dt; gpos[k * 3] += gvel[k].x * dt; gpos[k * 3 + 1] += gvel[k].y * dt; gpos[k * 3 + 2] += gvel[k].z * dt; }
        glassG.attributes.position.needsUpdate = true;
      }
      const d = Math.max(1, -truck.position.z);
      const high = smooth(TR.beams, TR.beams + 0.25, T);
      const outside = T >= TR.outside;
      tLights.forEach((L) => {
        L.s.intensity = T < 0 ? 0 : (900 + high * 5000) * (outside ? 0.25 : 1);
        L.gl.scale.setScalar((T < 0 ? 0 : 0.8 + high * 2.5) * (outside ? 1.6 : 1 + 40 / d));
      });

      // wipers once we look out of the windshield
      if (T > -0.3) wipers.forEach((w) => {
        const a = Math.max(0, Math.sin((T + 0.3) * Math.PI / 1.1)) * 1.25;
        w.quaternion.copy(w.userData.q0).premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a));
      });

      // the people
      const fear = smooth(TR.horn2 - 0.2, TR.swerve + 0.2, T);
      const lurch = T > TR.swerve ? Math.sin((T - TR.swerve) * 9) * Math.exp(-(T - TR.swerve) * 1.5) : 0;
      const speaker = people.find((q) => q.seat === S.talk);
      people.forEach((q) => {
        let lookYaw = null;
        if (speaker && speaker !== q) lookYaw = Math.max(-1, Math.min(1, Math.atan2(speaker.x - q.x, -(speaker.z - q.z)) * 0.8));
        q.ch.update(dt, t, fear, T > -0.5 ? 0.3 : 1, { talk: q.seat === S.talk ? 1 : 0, lookYaw, driver: q.seat === 0, steer: sw });
        q.ch.root.position.set(q.base.x + lurch * 0.12 + sw * 0.08, q.base.y, q.base.z);
        q.ch.root.rotation.z = -lurch * 0.18 - sw * 0.12;
      });

      // cameras
      const bump = Math.sin(t * 9.1) * 0.006 + Math.sin(t * 3.3) * 0.004;
      const shake = fear * 0.03 + (hit > 0 ? 0.08 : 0);
      S.outside = T >= TR.outside;
      S.timeScale = S.outside ? SLOWMO : 1;
      if (T < 0) { // on the dashboard, looking back at everyone
        cam.fov = 70;
        rig.localToWorld(v.set(0.04 + Math.sin(t * 0.7) * 0.03, 1.52 + bump, -1.0));
        rig.localToWorld(v2.set(0, 1.0 + Math.sin(t * 0.5) * 0.03, 1.6));
        cam.position.copy(v); cam.lookAt(v2);
      } else if (!S.outside) { // from behind the front seats, out through the windshield
        cam.fov = 50;
        rig.localToWorld(v.set(0.06 + (Math.random() - 0.5) * shake, 1.62 + bump + (Math.random() - 0.5) * shake, 0.66));
        rig.localToWorld(v2.set(0.1, 1.2 - sw * 0.2, -14));
        cam.position.copy(v); cam.lookAt(v2);
        cam.rotation.z += -sw * 0.1 + (Math.random() - 0.5) * shake;
      } else { // outside, low at the roadside, in slow motion: the car skidding sideways into the truck's path
        cam.fov = 42;
        cam.position.set(rig.position.x + 10 + (Math.random() - 0.5) * shake, 1.05, rig.position.z - 2.6);
        cam.lookAt(rig.position.x - 0.3, 1.25, rig.position.z - 4.0);
      }
      cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix();
      dash.intensity = 1.4 + Math.random() * 0.1;
    },
    dispose() {
      scene.traverse((o) => { if ((o.isMesh || o.isPoints || o.isSprite) && !o.userData.q0) o.geometry?.dispose?.(); });
      roadTex.dispose(); snowG.dispose(); glassG.dispose();
      people.forEach((p) => p.ch.dispose?.());
    },
  };
}

// ---------------------------------------------------------------- the whole sequence
export { buildLive as _buildLive, buildDialogue as _buildDialogue };
export function playIntro({ renderer, assets, players, audio, calm, onDone }) {
  const el = document.getElementById('intro');
  const video = el.querySelector('video');
  const fade = el.querySelector('.ifade');
  const skipEl = el.querySelector('.iskip');
  const sub = el.querySelector('.isub');
  const snd = introSound(audio);
  el.className = 'show';
  fade.style.transition = 'none'; fade.style.opacity = 1; fade.style.background = '#000';
  sub.innerHTML = ''; sub.style.opacity = 0;
  video.src = assets.videoURL; video.muted = true; video.currentTime = 0;
  let phase = 'video', t = 0, live = null, holdT = 0, done = false, vidLen = 16.25;
  const started = performance.now(); let lastNow = started, aborted = false;
  const cues = [];
  const cue = (at, fn) => cues.push({ at, fn });
  // sound cues on the video's timeline (frames / 24 in blender/build_intro.py): the sick lamps buzzing in
  // shots A and B, the car rushing past, then each lamp ahead flickering and dying in shot C
  cue(0.05, () => snd?.start());
  [1.2, 3.9, 6.7, 8.1, 9.6, 11.2].forEach((s) => cue(s, () => snd?.flicker(rnd(0.4, 0.9))));
  cue(10.25, () => snd?.whoosh());
  [13.0, 13.58, 14.17, 14.75].forEach((s) => { cue(s, () => snd?.flicker(0.5)); cue(s + 0.52, () => snd?.pop()); });
  video.onloadedmetadata = () => { if (isFinite(video.duration)) vidLen = video.duration; };
  video.onplaying = () => { fade.style.transition = 'opacity 1.2s'; fade.style.opacity = 0; };
  video.onended = () => startLive();
  video.onerror = () => startLive();
  video.play().catch(() => startLive());

  // ---- the conversation
  const lines = buildDialogue(players);
  const voices = pickVoices();
  const PITCH = [0.95, 1.25, 0.82, 1.4, 1.05, 1.15];
  let nextIx = 0, lineEnd = Infinity, speaking = false, talkDone = false;
  const colorOf = (seat) => { const c = players[seat]?.color; return typeof c === 'number' ? '#' + c.toString(16).padStart(6, '0') : (c || '#e6dcc2'); };
  function say(ix) {
    const l = lines[ix]; if (!l || done) return;
    speaking = true; live?.setTalk(l.seat);
    if (l.dark) live?.setDark(t);
    sub.innerHTML = `<b style="color:${colorOf(l.seat)}">${(players[l.seat]?.name || '').replace(/[<>&]/g, '')}</b> ${l.text.replace(/[<>&]/g, '')}`;
    sub.style.opacity = 1;
    const fallback = Math.max(1.6, l.text.length * 0.062 + 0.6);
    lineEnd = t + fallback;
    try {
      const u = new SpeechSynthesisUtterance(l.text);
      if (voices.length) u.voice = voices[l.seat % voices.length];
      u.pitch = PITCH[l.seat % PITCH.length]; u.rate = 1.04; u.volume = 1;
      // once a voice really starts, speech sets the pace (the timer is only a safety net); without voices the
      // subtitles run on reading speed
      u.onstart = () => { if (speaking && nextIx === ix) lineEnd = Math.max(lineEnd, t + fallback + 2.5); };
      u.onend = () => { if (speaking && nextIx === ix) lineEnd = Math.min(lineEnd, t + 0.25); };
      speechSynthesis.cancel(); speechSynthesis.speak(u);
    } catch {}
  }
  function nextLine() {
    speaking = false; live?.setTalk(-1); sub.style.opacity = 0;
    nextIx++;
    if (nextIx < lines.length) lineEnd = t + 0.35; // a short gap, then the next line
    else { talkDone = true; live?.setTruck(t + 1.6); } // silence... then the windshield
  }

  function startLive() {
    if (phase !== 'video') return;
    phase = 'live'; t = 0;
    video.pause(); el.classList.add('live');
    fade.style.transition = 'none'; fade.style.opacity = 1;
    live = buildLive(assets, players, {
      lamp: (lv) => snd?.lamp(lv),
      pop: () => snd?.pop(),
      impact: () => { snd?.impact(); setTimeout(() => finish(false), 260); },
    });
    requestAnimationFrame(() => { fade.style.transition = 'opacity 0.35s'; fade.style.opacity = 0; });
    snd?.inside();
    if (lines.length) lineEnd = 1.0; // first line after a second
    else { live.setDark(1.4); live.setTruck(3.9); cue(vidLen + 0.4, () => snd?.static()); }
  }

  function truckCues(T0) { // sound cues relative to the truck sequence
    const at = (s, fn) => cues.push({ at: vidLen + T0 + s, fn });
    for (let s = 0; s < TR.swerve; s += 1.1) at(s, () => snd?.wiper());
    at(TR.horn1, () => snd?.horn(0.9, 0.22));
    at(TR.horn2, () => snd?.horn(1.6, 0.38));
    at(TR.swerve, () => snd?.screech());
    at(TR.outside, () => snd?.slow());
  }

  function finish(skipped) {
    if (done) return;
    done = true; phase = 'black';
    try { speechSynthesis.cancel(); } catch {}
    sub.style.opacity = 0;
    fade.style.transition = skipped ? 'opacity 0.25s' : 'none'; fade.style.opacity = 1;
    fade.style.background = skipped || calm ? '#000' : '#fff';
    if (!skipped) {
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
    try { speechSynthesis.cancel(); } catch {}
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
  let truckCued = false;

  return {
    frame() {
      // real time, so a throttled or background tab doesn't stretch the intro (the ghost wakes up on the server's clock)
      const nowMs = performance.now(); const rdt = Math.min(0.25, (nowMs - lastNow) / 1000); lastNow = nowMs;
      if (!done && nowMs - started > INTRO.maxSeconds * 1000) { finish(true); return; }
      if (holding) { holdT += rdt; if (holdT > 0.7) finish(true); } else holdT = Math.max(0, holdT - rdt * 2);
      skipEl.style.setProperty('--p', Math.min(1, holdT / 0.7));
      const clock = phase === 'video' ? video.currentTime : vidLen + t;
      for (const c of cues) if (!c.fired && clock >= c.at) { c.fired = true; c.fn(); }
      if (phase === 'live' && live) {
        const dt = rdt * live.S.timeScale;
        t += dt;
        if (lines.length && !talkDone && t >= lineEnd) { if (speaking) nextLine(); else say(nextIx); }
        if (!truckCued && isFinite(live.truckT)) { truckCued = true; truckCues(live.truckT); }
        live.update(t, dt);
        renderer.render(live.scene, live.cam);
      }
    },
    skip: () => finish(true),
    abort,
  };
}
