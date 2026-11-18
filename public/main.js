// CHUDAIL — client
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CELL, WALL_H, TALISMANS, generateMap, resolveCircle, pushOutBox, lineOfSight, isWall } from '/shared/map.js';
import { AudioSys } from './audio.js';
import { buildWorld, disposeScene } from './world.js';
import { createMonster, createAvatar, createCrawler, loadModels, CHARACTERS, ensureChar, charLoaded, addXray } from './entities.js';
import * as TX from './textures.js';

const $ = (id) => document.getElementById(id);
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
const angLerp = (a, b, k) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * k; };
const audio = new AudioSys();
window.__hm = { audio };
loadModels();
addEventListener('beforeunload', (e) => { if (S.phase === 'playing') { e.preventDefault(); e.returnValue = ''; } });

// ---------------- renderer ----------------
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
window.__hm.renderer = renderer;
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 34);
camera.rotation.order = 'YXZ';

const HorrorShader = {
  uniforms: {
    tDiffuse: { value: null }, time: { value: 0 }, fear: { value: 0 }, red: { value: 0 }, black: { value: 0 }, lift: { value: 0 },
    res: { value: new THREE.Vector2(innerWidth, innerHeight) },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time, fear, red, black, lift; uniform vec2 res; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      float w = fear * fear * 0.0045;
      uv.x += sin(uv.y * 38.0 + time * 9.0) * w + (hash(vec2(floor(uv.y * 90.0), floor(time * 24.0))) - 0.5) * w * 1.5 * step(0.6, fear);
      vec2 c = uv - 0.5;
      float ca = 0.0012 + fear * 0.007 + red * 0.01;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c * ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c * ca).b;
      // eyes adjusted to the dark (while hiding): lift the shadows, cold tint
      col = mix(col, pow(max(col, 0.0), vec3(0.4)) * vec3(0.82, 0.94, 1.06) * 1.35, lift);
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, 0.72);
      col *= vec3(0.96, 1.0, 1.04);
      col = mix(col, vec3(l * 1.6, l * 0.2, l * 0.15) + vec3(0.12, 0.0, 0.0), red * 0.75);
      float v = 1.0 - smoothstep(0.2 - fear * 0.1, 0.95 - fear * 0.3, length(c * vec2(1.0, 0.9)));
      col *= mix(0.08, 1.0, v);
      float g = hash(uv * res + fract(time * 7.13) * 100.0) - 0.5;
      col += g * (0.055 + fear * 0.09);
      col *= 0.975 + 0.025 * sin(uv.y * res.y * 1.4 + time * 12.0);
      col *= 1.0 - black;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

// ---------------- state ----------------
const S = {
  phase: 'menu', myId: 0, myColor: '#fff', name: '', myChar: (() => { try { return localStorage.getItem('hm_char') || ''; } catch { return ''; } })(),
  lobby: [], players: new Map(), map: null, world: null, scene: null, composer: null, post: null,
  monster: null, ghost: null, mon: null,
  me: null, collected: 0, exitOpen: false,
  fear: 0, red: 0, black: 0, shake: 0,
  flickUntil: 0, lightsOutUntil: 0, timers: [], nextScare: 0, ghostState: null,
  tune: { fl: 135, exposure: 1.45, hemi: 0.9, fog: 0.058, bulb: 1.6, remote: 60 },
  clues: new Set(), reading: null,
  spectating: null, jumpscare: false, sens: 1.2, lastSend: 0, prompt: null, escSent: 0,
};
const keys = {};

// ---------------- networking ----------------
let ws = null;
const send = (m) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };
function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
  ws.onopen = () => send(S.spectator ? { t: 'join', spectator: true } : { t: 'join', name: S.name, char: S.myChar });
  ws.onmessage = (e) => handle(JSON.parse(e.data));
  ws.onclose = () => {
    if (S.phase !== 'menu') { leaveGame(); showScreen('menu'); $('joinBtn').disabled = false; $('joinBtn').textContent = 'Connection lost. Retry'; S.phase = 'menu'; }
  };
}

function handle(m) {
  switch (m.t) {
    case 'welcome': S.myId = m.id; S.myColor = m.color; break;
    case 'full': $('joinBtn').disabled = false; $('joinBtn').textContent = 'Asylum full (6/6). Retry'; ws.close(); S.phase = 'menu'; break;
    case 'lobby':
      S.lobby = m.players; renderLobby();
      if (m.publicUrl && m.publicUrl !== S.publicUrl) { S.publicUrl = m.publicUrl; loadShare(); }
      if (m.phase === 'lobby') {
        if (S.phase !== 'lobby') { leaveGame(); S.phase = 'lobby'; showScreen('lobby'); }
      }
      break;
    case 'start': startGame(m); break;
    case 'snap': applySnap(m); break;
    case 'ev': onEvent(m); break;
    case 'end': onEnd(m); break;
  }
}

// ---------------- UI ----------------
function showScreen(id) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('show', s.id === id);
  $('grain').style.display = id === 'menu' || id === 'lobby' ? 'block' : 'none';
}
function renderLobby() {
  const ul = $('plist'); ul.innerHTML = '';
  for (let k = 0; k < 6; k++) {
    const p = S.lobby[k]; const li = document.createElement('li');
    const ch = p && CHARACTERS.find((c) => c.key === p.char);
    if (p) li.innerHTML = `<span class="dot" style="color:${p.color};background:${p.color}"></span>${esc(p.name)} <span style="color:#6d675c;font-size:13px">as ${ch ? ch.name : '?'}</span>${p.id === S.myId ? ' <span style="color:#6d675c;font-size:13px">(you)</span>' : ''}`;
    else li.innerHTML = '<span class="slot">empty bed…</span>';
    ul.appendChild(li);
  }
  $('pcount').textContent = `${S.lobby.length}/6`;
  const mine = S.lobby.find((p) => p.id === S.myId);
  if (mine && mine.char) { S.myChar = mine.char; ensureChar(mine.char); }
  $('startBtn').style.display = S.spectator ? 'none' : '';
  $('chars').style.display = S.spectator ? 'none' : '';
  if (S.spectator) { $('pcount').textContent = `${S.lobby.length}/6 · you are a hidden spectator`; return; }
  const grid = $('chars'); grid.innerHTML = '';
  for (const c of CHARACTERS) {
    const d = document.createElement('div');
    d.className = 'char' + (c.key === S.myChar ? ' mine' : '');
    const who = S.lobby.filter((p) => p.char === c.key).map((p) => `<span style="color:${p.color};background:${p.color}"></span>`).join('');
    d.innerHTML = `<div class="who">${who}</div><img src="/img/chars/${c.key}.webp" alt=""><b>${c.name}</b><i>${c.role}</i>`;
    d.onclick = () => { S.myChar = c.key; try { localStorage.setItem('hm_char', c.key); } catch {} send({ t: 'char', char: c.key }); ensureChar(c.key); audio.click(); };
    grid.appendChild(d);
  }
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

async function loadShare() {
  const el = $('share');
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);
  if (S.publicUrl) { el.innerHTML = `<b style="color:#9fe08a">ONLINE</b>: friends anywhere in the world join at:<br><code>${esc(S.publicUrl)}</code>`; return; }
  if (!local) { el.innerHTML = `Invite friends with this link:<br><code>${esc(location.origin)}</code>`; return; }
  try {
    const info = await (await fetch('/info')).json();
    if (info.publicUrl) { S.publicUrl = info.publicUrl; return loadShare(); }
    el.innerHTML = info.lan.length
      ? `Friends on the same Wi-Fi join at:<br>${info.lan.map((u) => `<code>${esc(u)}</code>`).join('<br>')}<br><span style="font-size:11px">Friends in another city or country: start the game with <b>npm run online</b>.</span>`
      : 'No network found. Solo play only (see README to invite friends).';
  } catch { el.textContent = 'Share your address with friends (port 3000).'; }
}

function message(text, cls = '') {
  const d = document.createElement('div'); d.textContent = text; if (cls) d.className = cls;
  $('messages').appendChild(d); setTimeout(() => d.remove(), 5200);
}

$('name').value = localStorage.getItem('hm_name') || '';
$('joinBtn').onclick = () => {
  S.name = $('name').value.trim() || 'Survivor';
  try { localStorage.setItem('hm_name', S.name); } catch {}
  audio.init();
  if (!audio.samples) audio.loadSample('scream', '/sounds/scream.mp3');
  $('joinBtn').disabled = true; $('joinBtn').textContent = 'Opening the gates…';
  S.phase = 'joining';
  connect(); loadShare();
};
$('specBtn').onclick = () => {
  S.spectator = true; S.name = 'Spectator';
  audio.init(); if (!audio.samples) audio.loadSample('scream', '/sounds/scream.mp3');
  $('specBtn').disabled = true; $('joinBtn').disabled = true;
  S.phase = 'joining'; connect(); loadShare();
};
$('name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('joinBtn').click(); });
$('startBtn').onclick = () => { audio.init(); send({ t: 'start' }); };
$('sens').oninput = (e) => { S.sens = +e.target.value; try { localStorage.setItem('hm_sens', S.sens); } catch {} };
$('vol').oninput = (e) => { audio.setVolume(+e.target.value); try { localStorage.setItem('hm_vol', e.target.value); } catch {} };
try {
  if (localStorage.getItem('hm_sens')) { S.sens = +localStorage.getItem('hm_sens'); $('sens').value = S.sens; }
  if (localStorage.getItem('hm_vol')) { audio.volume = +localStorage.getItem('hm_vol'); $('vol').value = audio.volume; }
} catch {}

// menu: grain + eyes in the dark
const grainCtx = $('grain').getContext('2d');
const grainImg = grainCtx.createImageData(256, 256);
function drawGrain() {
  const d = grainImg.data;
  for (let i = 0; i < d.length; i += 4) { const v = Math.random() * 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
  grainCtx.putImageData(grainImg, 0, 0);
}
$('grain').style.width = '100%'; $('grain').style.height = '100%';
const eyes = document.createElement('div'); eyes.className = 'eyes'; document.body.appendChild(eyes);
setInterval(() => {
  if (S.phase !== 'menu' && S.phase !== 'lobby') { eyes.style.opacity = 0; return; }
  if (Math.random() < 0.35) {
    eyes.style.left = (Math.random() < 0.5 ? rnd(3, 18) : rnd(78, 94)) + 'vw';
    eyes.style.top = rnd(55, 88) + 'vh';
    eyes.style.opacity = 0.9;
    setTimeout(() => (eyes.style.opacity = 0), rnd(1500, 3500));
  }
}, 5000);

// ---------------- input ----------------
addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (S.phase !== 'playing') return;
  if (e.code === 'KeyF' && S.me?.alive && !S.me.escaped && !S.me.hidden) {
    if (S.me.battery > 0) { S.me.fl = !S.me.fl; audio.click(); }
  }
  if ((e.code === 'KeyE' || e.code === 'Escape') && S.reading) { closeNote(); return; }
  if (e.code === 'KeyE' && S.me?.hidden) { send({ t: 'unhide' }); return; }
  if (e.code === 'KeyE' && S.prompt && S.prompt.note) { openNote(S.prompt.id); S.prompt = null; return; }
  if (e.code === 'KeyE' && S.prompt && !S.prompt.burn && !S.prompt.revive) {
    if (S.prompt.hide) send({ t: 'hide', id: S.prompt.id }); else send({ t: 'pickup', id: S.prompt.id });
    S.prompt = null;
  }
  if ((e.ctrlKey || e.metaKey) && ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyF', 'KeyE'].includes(e.code)) e.preventDefault();
  if (S.spectator && /^Digit[0-6]$/.test(e.code)) {
    const n = +e.code.slice(5); const list = [...S.players.values()].filter((p) => !p.escaped);
    S.droneFollow = n === 0 ? null : list[n - 1]?.id || null;
    if (!S.droneFollow) for (const p of S.players.values()) p.avatar.userData.setShown(!p.hid);
  }
  if (e.code === 'KeyQ' && S.me?.alive && !S.me.escaped && !S.me.hidden) {
    if (S.me.bells > 0) send({ t: 'bell' }); else message('You have no spirit bells.');
  }
  if (e.code === 'KeyE' && S.prompt && S.prompt.burn && !S.burn) { S.burn = { start: performance.now() }; send({ t: 'burnStart' }); audio.whisper(0, 0.3, 1.5); }
  if (e.code === 'KeyE' && S.prompt && S.prompt.revive && !S.reviving) { S.reviving = { start: performance.now(), id: S.prompt.target }; audio.whisper(0, 0.25, 1.2); }
  if (e.code === 'Tab') e.preventDefault();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas || !S.me || (!S.me.alive && !S.spectator) || S.jumpscare) return;
  const k = 0.0021 * S.sens;
  S.me.yaw -= e.movementX * k;
  S.me.pitch = clamp(S.me.pitch - e.movementY * k, S.spectator ? -1.55 : -1.45, 1.45);
  if (S.me.hidden) { const bed = S.world.hides.get(S.me.hidden)?.type === 'bed'; S.me.yaw = S.me.hideYaw + clamp(angDiff(S.me.yaw, S.me.hideYaw), bed ? -0.8 : -0.55, bed ? 0.8 : 0.55); S.me.pitch = clamp(S.me.pitch, bed ? -0.1 : -0.35, bed ? 0.12 : 0.3); }
});
addEventListener('mousedown', () => {
  if (S.phase === 'playing' && document.pointerLockElement === canvas && S.spectating !== null) nextSpectate();
});
$('resume').onclick = () => { audio.init(); canvas.requestPointerLock(); };
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (S.phase === 'playing' && !locked) showScreen('resume');
  else if (S.phase === 'playing' && locked) { showScreen(''); $('brief').style.display = 'none'; $('resume').querySelector('h2').textContent = 'CLICK TO RESUME'; }
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  if (S.composer) S.composer.setSize(innerWidth, innerHeight);
  HorrorShader.uniforms.res.value.set(innerWidth, innerHeight);
});

// ---------------- game setup ----------------
let flashlight, flashTarget, playerGlow, lightPool = [], dust = null;
const flDir = new THREE.Vector3(0, 0, -1);

function startGame(m) {
  leaveGame();
  showScreen('loading');
  S.phase = 'loading';
  const go = () => buildGame(m);
  const fonts = Promise.all(['64px "IM Fell English SC"', 'bold 54px "Courier Prime"', '92px "Rubik Wet Paint"', '20px "Homemade Apple"'].map((f) => document.fonts.load(f).catch(() => {})));
  const chars = Promise.all(m.players.map((p) => ensureChar(p.char)));
  Promise.race([Promise.all([loadModels(), fonts, chars]), new Promise((r) => setTimeout(r, 9000))]).then(() => setTimeout(go, 30));
}

function buildGame(m) {
  const map = (S.map = generateMap(m.seed));
  const scene = (S.scene = new THREE.Scene());
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.FogExp2(0x000000, 0.072);
  scene.add(camera);
  S.world = buildWorld(scene, map);

  S.hemi = new THREE.HemisphereLight(0x2a3448, 0x140c08, 0.9); scene.add(S.hemi);
  playerGlow = new THREE.PointLight(0x8a96b0, 1.2, 6, 1.6); camera.add(playerGlow);
  // first-person hand holding the flashlight
  {
    const vm = new THREE.Group();
    const metalM = new THREE.MeshStandardMaterial({ color: 0x15161a, metalness: 0.6, roughness: 0.45 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.024, 0.26, 14), metalM); body.rotation.x = Math.PI / 2; vm.add(body);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.03, 0.06, 16), metalM); head.rotation.x = Math.PI / 2; head.position.z = -0.15; vm.add(head);
    const lensM = new THREE.MeshBasicMaterial({ color: 0xfff4dc });
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.036, 16), lensM); lens.position.z = -0.181; lens.rotation.y = Math.PI; vm.add(lens);
    const skin = new THREE.MeshStandardMaterial({ color: 0x2e241f, roughness: 0.9 }); // dark glove
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.07, 0.11), skin); hand.position.set(0.012, -0.012, 0.03); vm.add(hand);
    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.05, 4, 8), skin); thumb.rotation.x = Math.PI / 2; thumb.position.set(-0.03, 0.02, -0.02); vm.add(thumb);
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.25, 12), new THREE.MeshStandardMaterial({ color: 0x0b0c0f, roughness: 1 }));
    sleeve.rotation.x = Math.PI / 2; sleeve.position.set(0.02, -0.03, 0.2); vm.add(sleeve);
    vm.position.set(0.24, -0.25, -0.42); vm.rotation.set(0.04, 0.05, 0);
    vm.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });
    camera.add(vm); S.viewmodel = { g: vm, lensM };
  }

  flashlight = new THREE.SpotLight(0xfff1d8, 135, 36, 0.66, 0.5, 1.25);
  flashlight.castShadow = true;
  flashlight.shadow.mapSize.set(1024, 1024);
  flashlight.shadow.camera.near = 0.15; flashlight.shadow.camera.far = 16;
  flashlight.shadow.bias = -0.0004; flashlight.shadow.normalBias = 0.03;
  flashlight.map = TX.toTex(TX.flashlightCookie(), { repeat: false });
  flashTarget = new THREE.Object3D();
  scene.add(flashlight, flashTarget); flashlight.target = flashTarget;

  lightPool = [];
  for (let k = 0; k < 6; k++) { const l = new THREE.PointLight(0xffaa66, 0, 10, 1.4); scene.add(l); lightPool.push({ light: l, src: null }); }
  S.poolT = 0;

  // dust motes, lit only inside the flashlight beam
  const N = 450, pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.018, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  pts.frustumCulled = false; scene.add(pts);
  dust = { pts, pos, col, N, vel: new Float32Array(N * 3).map(() => (Math.random() - 0.5) * 0.04), init: false };

  S.monster = createMonster(); scene.add(S.monster);
  S.crawler = createCrawler(WALL_H); S.crawler.visible = false; scene.add(S.crawler);
  S.crawl = { x: 0, z: 0, yaw: 0, tx: 0, tz: 0, tyaw: 0, state: 'gone', target: 0, step: 0, speed: 0, skitter: 0 };
  S.ghost = createMonster({ ghost: true }); S.ghost.visible = false; scene.add(S.ghost);
  S.mon = { x: map.monsterSpawn.x, z: map.monsterSpawn.z, yaw: 0, tx: map.monsterSpawn.x, tz: map.monsterSpawn.z, tyaw: 0, state: 'dormant', target: 0, speed: 0, vis: 0, step: 0, lit: false };
  S.monster.position.set(S.mon.x, 0, S.mon.z);

  S.players.clear();
  for (const p of m.players) addPlayer(p);
  for (const j of S.pendingJoins || []) addPlayer({ id: j.id, name: j.name, color: j.color, char: j.char, x: map.spawns[0][0], z: map.spawns[0][1] });
  S.pendingJoins = [];
  const mine = m.players.find((p) => p.id === S.myId) || { x: map.spawns[0][0], z: map.spawns[0][1] };
  S.me = {
    x: mine.x, z: mine.z, yaw: Math.PI / 2, pitch: 0, vx: 0, vz: 0, stamina: 100, exhausted: false, battery: 100, fl: true,
    crouch: false, sneak: false, sprint: false, moving: false, eye: 1.62, bob: 0, stepAcc: 0, alive: true, escaped: false, breathT: 0, hidden: null, hideYaw: 0, bells: 0, revives: 0,
  };
  if (S.spectator) {
    Object.assign(S.me, { alive: false, fl: false, droneY: 2.2, x: map.spawns[0][0], z: map.spawns[0][1] });
    addXray(S.monster, 0xff2a2a); addXray(S.crawler, 0xff5a20);
    S.droneFollow = null;
  }
  S.collected = m.collected; S.exitOpen = m.exitOpen; S.stage = m.stage || 'effigies'; S.burn = null;
  if (S.stage === 'escape') S.world.heart.burn();
  for (const id of m.taken) takeItem(id);
  S.world.exit.setProgress(S.collected, S.exitOpen);
  buildIcons();

  S.composer = new EffectComposer(renderer);
  S.composer.addPass(new RenderPass(scene, camera));
  S.composer.addPass(new OutputPass());
  S.post = new ShaderPass(HorrorShader); S.composer.addPass(S.post);

  S.fear = 0; S.red = 0; S.black = 1; S.shake = 0; S.timers = []; S.spectating = null; S.jumpscare = false; S.ghostState = null;
  S.nextScare = performance.now() / 1000 + rnd(30, 45);
  S.flickUntil = 0; S.lightsOutUntil = 0;
  S.clues = new Set(); S.reading = null; renderClues();
  S.phase = 'playing';
  $('hud').classList.add('show'); $('spectate').style.display = 'none';
  $('bars').style.display = S.spectator ? 'none' : '';
  $('specHud').style.display = S.spectator ? 'block' : 'none';
  setObjective();
  warmUp(scene);
  audio.init(); audio.startAmbience(); audio.startMonsterVoice();
  showScreen('resume');
  $('resume').querySelector('h2').textContent = 'CLICK TO ENTER';
  if (!S.spectator) showBriefing(); else $('brief').style.display = 'none';
  if (!S.spectator) setTimeout(() => {
    message('The foyer door is sealed by five runes.');
    setTimeout(() => message('Find the bone effigies. Something is waking up.', 'red'), 2500);
  }, 1200);
}

// Draw every kind of object once (incl. shadows) behind the loading screen so nothing has to compile mid-game.
function warmUp(scene) {
  const things = [S.monster, S.crawler, S.ghost];
  const saved = things.map((o) => [o.visible, o.position.clone()]);
  camera.position.set(S.me.x, 1.6, S.me.z); camera.rotation.set(0, S.me.yaw, 0);
  const f = new THREE.Vector3(0, 0, -1).applyEuler(camera.rotation);
  things.forEach((o, k) => { o.visible = true; o.position.set(S.me.x + f.x * (2 + k), 0, S.me.z + f.z * (2 + k)); });
  flashlight.position.copy(camera.position); flashTarget.position.copy(camera.position).addScaledVector(f, 5);
  flashlight.intensity = 50;
  S.crawler.userData.update(0.016, 'crawl', 2, 0);
  renderer.compile(scene, camera);
  S.composer.render(0.016);
  things.forEach((o, k) => { o.visible = saved[k][0]; o.position.copy(saved[k][1]); });
  if (!scareCv) scareCv = TX.jumpscareCanvas();
}

function addPlayer(p) {
  if (p.id === S.myId || S.players.has(p.id)) return;
  const avatar = createAvatar(p.name, p.color, p.char);
  avatar.position.set(p.x, 0, p.z);
  S.scene.add(avatar);
  if (p.char && !charLoaded(p.char)) ensureChar(p.char).then(() => {
    const r = S.players.get(p.id); if (!r || !S.scene) return;
    const fresh = createAvatar(p.name, p.color, p.char);
    fresh.position.copy(r.avatar.position); fresh.rotation.copy(r.avatar.rotation);
    S.scene.remove(r.avatar); S.scene.add(fresh); r.avatar = fresh; r.deadShown = false;
  });
  const r = { id: p.id, name: p.name, color: p.color, char: p.char, alive: p.alive !== false, escaped: !!p.escaped, avatar, x: p.x, z: p.z, yaw: 0, pitch: 0, tx: p.x, tz: p.z, tyaw: 0, tpitch: 0, fl: true, cr: false, mv: false, sp: false, step: 0, deadShown: false };
  if (!r.alive) { avatar.userData.setDead(); r.deadShown = true; }
  if (r.escaped) { avatar.userData.setShown(false); avatar.userData.label.visible = false; }
  S.players.set(p.id, r);
}

function leaveGame() {
  if (document.pointerLockElement) document.exitPointerLock();
  $('hud').classList.remove('show');
  if (S.scene) { disposeScene(S.scene); S.scene = null; }
  if (S.composer) { S.composer.dispose?.(); S.composer = null; }
  S.world = null; S.players.clear(); S.me = null;
  audio.stopAmbience?.();
  $('scare').style.display = 'none';
  $('vent').classList.remove('show');
}

function buildIcons() {
  const el = $('icons'); el.innerHTML = '';
  for (let k = 0; k < TALISMANS; k++) { const d = document.createElement('div'); d.className = 'ic' + (k < S.collected ? ' got' : ''); d.textContent = '✝'; el.appendChild(d); }
}

function takeItem(id) {
  const w = S.world;
  const t = w.talismans.get(id);
  if (t) { t.taken = true; t.group.visible = false; t.src.dead = true; return 't'; }
  const b = w.batteries.get(id);
  if (b) { b.taken = true; b.group.visible = false; b.sprite.visible = false; return 'b'; }
  const sc = w.souls.get(id);
  if (sc) { sc.taken = true; sc.group.visible = false; sc.sprite.visible = false; return 'r'; }
  const w2 = w.bells.get(id);
  if (w2) { w2.taken = true; w2.group.visible = false; w2.sprite.visible = false; return 'w'; }
  return null;
}

// ---------------- snapshots & events ----------------
// render remote things ~130 ms in the past and interpolate between snapshots: smooth even over a laggy internet link
const INTERP_MS = 130;
function pushSnap(buf, s) { buf.push(s); if (buf.length > 14) buf.shift(); }
function sampleBuf(buf, rt) {
  if (!buf || !buf.length) return null;
  if (rt <= buf[0].t) return buf[0];
  for (let i = buf.length - 1; i > 0; i--) {
    const a = buf[i - 1], b = buf[i];
    if (rt >= a.t && rt <= b.t) {
      const k = (rt - a.t) / (b.t - a.t || 1);
      return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, yaw: a.yaw + angDiff(b.yaw, a.yaw) * k, pitch: a.pitch + (b.pitch - a.pitch) * k };
    }
  }
  return buf[buf.length - 1];
}
function applySnap(m) {
  if (S.phase !== 'playing') return;
  for (const a of m.p) {
    const [id, x, z, yaw, pitch, fl, cr, alive, esc, mv, sp, hid, sn] = a;
    if (id === S.myId) continue;
    let r = S.players.get(id);
    if (!r) continue;
    const nowT = performance.now();
    r.buf = r.buf || [];
    if (r.buf.length && Math.hypot(r.buf[r.buf.length - 1].x - x, r.buf[r.buf.length - 1].z - z) > 6) r.buf.length = 0;
    pushSnap(r.buf, { t: nowT, x, z, yaw, pitch });
    r.tx = x; r.tz = z; r.tyaw = yaw; r.tpitch = pitch; r.fl = !!fl; r.cr = !!cr; r.mv = !!mv; r.sp = !!sp; r.sn = !!sn;
    r.escaped = !!esc; r.hid = hid || null;
    if (!alive && r.alive) { r.alive = false; }
  }
  if (m.m) {
    const [x, z, yaw, state, target, speed, lit, lunge] = m.m;
    Object.assign(S.mon, { tx: x, tz: z, tyaw: yaw, state, target, speed, lit: !!lit, lunge: !!lunge });
    const mb = (S.mon.buf = S.mon.buf || []);
    if (mb.length && Math.hypot(mb[mb.length - 1].x - x, mb[mb.length - 1].z - z) > 6) mb.length = 0;
    pushSnap(mb, { t: performance.now(), x, z, yaw, pitch: 0 });
  }
  if (m.c) {
    const [x, z, yaw, state, target] = m.c;
    if (S.crawl.state === 'gone') { S.crawl.x = x; S.crawl.z = z; S.crawl.buf = []; }
    pushSnap((S.crawl.buf = S.crawl.buf || []), { t: performance.now(), x, z, yaw, pitch: 0 });
    Object.assign(S.crawl, { tx: x, tz: z, tyaw: yaw, state, target });
  } else S.crawl.state = 'gone';
}

function onEvent(m) {
  if (S.phase !== 'playing' && S.phase !== 'loading') return;
  if (!S.world && m.e !== 'joined') return;
  const t = performance.now() / 1000;
  const nameOf = (id) => (id === S.myId ? 'You' : S.players.get(id)?.name || 'Someone');
  switch (m.e) {
    case 'pickup': {
      const kind = takeItem(m.id);
      if (kind === 't') {
        S.collected = m.collected; buildIcons(); renderClues(); setObjective();
        S.world.exit.setProgress(S.collected, m.exitOpen);
        if (m.by === S.myId) {
          audio.bell(); audio.stinger(0.35); S.red = 0.7; S.shake = 0.4;
          message(`You took an effigy (${S.collected}/${TALISMANS})`);
          setTimeout(() => message('It knows where you are.', 'red'), 900);
          setTimeout(() => audio.whisper(rnd(-0.6, 0.6), 0.35, 2.2), 600);
        } else {
          audio.bell();
          message(`${nameOf(m.by)} found an effigy (${S.collected}/${TALISMANS})`);
        }
      } else if (kind === 'r' && m.by === S.myId) {
        S.me.revives = m.revives; audio.holyBell(S.me.x, S.me.z); message(`Soul candle (${m.revives}). Hold E over a fallen friend to bring them back.`);
      } else if (kind === 'w' && m.by === S.myId) {
        S.me.bells = m.bells; audio.pickupBattery(); message(`Spirit bell (${m.bells}). Press Q to ring it and freeze her.`);
      } else if (kind === 'b' && m.by === S.myId) {
        S.me.battery = Math.min(100, S.me.battery + 55); audio.pickupBattery(); message('Battery +55%');
        if (!S.me.fl) S.me.fl = true;
      }
      break;
    }
    case 'chase': {
      const d = Math.hypot(S.mon.x - camera.position.x, S.mon.z - camera.position.z);
      if (m.id === S.myId) {
        audio.screech(S.mon.x, S.mon.z, 0.9); audio.stinger(0.55); S.shake = 0.6; S.red = 0.35;
        message('IT SEES YOU. RUN.', 'red');
      } else if (d < 25) audio.screech(S.mon.x, S.mon.z, 0.6);
      break;
    }
    case 'kill': {
      if (m.id === S.myId) { if (S.me.hidden) { const h = S.world.hides.get(S.me.hidden); if (h) { h.busy = 1.2; h.door.visible = true; } $('vent').classList.remove('show'); S.me.hidden = null; S.me.x = m.x; S.me.z = m.z; } doJumpscare(m.mx, m.mz); break; }
      const r = S.players.get(m.id);
      if (r) { r.alive = false; r.tx = m.x; r.tz = m.z; }
      audio.distantScream(m.x, m.z);
      addBlood(m.x, m.z);
      message(`${nameOf(m.id)} was taken.`, 'red');
      break;
    }
    case 'escaped': {
      if (m.id === S.myId) {
        S.me.escaped = true; S.black = 0; S.whiteOut = 1;
        message('You escaped Ashgrove. She will not follow you.');
        audio.setChase(false);
        setTimeout(() => startSpectate(), 2500);
      } else {
        const r = S.players.get(m.id); if (r) { r.escaped = true; r.avatar.userData.setShown(false); r.avatar.userData.label.visible = false; }
        message(`${nameOf(m.id)} escaped!`);
      }
      break;
    }
    case 'scare': globalScare(m, t); break;
    case 'hide': case 'unhide': {
      const h = S.world.hides.get(m.hid);
      if (h) { h.busy = 0.7; audio.locker(h.x, h.z, true); }
      if (m.id === S.myId) {
        if (m.e === 'hide') {
          S.me.hidden = m.hid; S.me.x = h.x; S.me.z = h.z; S.me.vx = S.me.vz = 0;
          h.door.visible = false; $('vent').classList.add('show'); $('vent').classList.toggle('bed', h.type === 'bed');
          S.me.flBefore = S.me.fl;
          S.me.hideYaw = S.me.yaw = Math.atan2(-h.fx, -h.fz); S.me.pitch = 0;
          message('Hidden. Press E to get out.');
        } else {
          S.me.hidden = null; S.me.x = m.x; S.me.z = m.z;
          if (h) h.door.visible = true; $('vent').classList.remove('show');
          S.me.fl = !!S.me.flBefore && S.me.battery > 0;
        }
      }
      break;
    }
    case 'hideFull': message('Someone is already in there.'); break;
    case 'revived': {
      if (m.by === S.myId) { S.me.revives = m.revives; S.reviving = null; }
      audio.holyBell(m.x, m.z); audio.whisper(0, 0.3, 2);
      if (m.id === S.myId) {
        Object.assign(S.me, { alive: true, x: m.x, z: m.z, hidden: null, battery: Math.max(S.me.battery, 50), fl: true, stamina: 100 });
        S.spectating = null; S.jumpscare = false; S.red = 0; S.black = 0.6;
        $('spectate').style.display = 'none'; $('death').classList.remove('show');
        showScreen(document.pointerLockElement === canvas ? '' : 'resume');
        message(`${nameOf(m.by)} brought you back. Don't waste it.`);
      } else {
        const r = S.players.get(m.id);
        if (r) {
          S.scene.remove(r.avatar);
          r.avatar = createAvatar(r.name, r.color, r.char); r.avatar.position.set(m.x, 0, m.z); S.scene.add(r.avatar);
          r.alive = true; r.deadShown = false; r.buf = []; r.x = r.tx = m.x; r.z = r.tz = m.z;
        }
        message(`${nameOf(m.id)} is back from the dead!`);
      }
      break;
    }
    case 'bell': {
      if (m.by === S.myId) S.me.bells = m.bells;
      audio.holyBell(m.x, m.z);
      S.bellFlash = { x: m.x, z: m.z, t: 1 };
      if (m.froze) { setTimeout(() => audio.screech(S.mon.x, S.mon.z, 0.8), 150); message(m.by === S.myId ? 'She is frozen. GO!' : `${nameOf(m.by)} rang a bell. She is frozen!`); }
      else if (m.by === S.myId) message('The bell rings… she is too far away to hear it.');
      if (m.scared) message('The crawler flees back into the dark.');
      break;
    }
    case 'stage': {
      S.stage = m.stage;
      if (m.stage === 'heart') {
        audio.rumble(0.7, 4); audio.whisper(0, 0.45, 3);
        message('The bones whisper as one…', 'red');
        setTimeout(() => message('"Her heart still beats in ROOM 41."', 'red'), 2200);
      } else if (m.stage === 'escape') {
        S.exitOpen = true; S.burn = null;
        S.world.heart.burn(); S.world.exit.setProgress(TALISMANS, true);
        audio.scream(); audio.rumble(1, 6); S.shake = 1.5; S.red = 1;
        message(`${m.by === S.myId ? 'You' : nameOf(m.by)} burned her heart!`, 'red');
        setTimeout(() => message('THE FOYER DOOR IS OPEN. RUN!', 'red'), 1800);
        for (const b of S.world.bulbs) { b.color.set(0xff2010); b.dead = false; b.flicker = true; }
      }
      setObjective(); renderClues();
      break;
    }
    case 'burnStart': if (m.by !== S.myId) message(`${nameOf(m.by)} is burning the heart. Protect them!`, 'red'); else message('She can feel it. She is coming.', 'red'); break;
    case 'crawlerDrop': {
      audio.screech(m.x, m.z, m.id === S.myId ? 1 : 0.6); audio.skitter(m.x, m.z, 1.2);
      if (m.id === S.myId) { audio.stinger(0.8); S.shake = 1; S.red = 0.6; message('ABOVE YOU', 'red'); }
      break;
    }
    case 'note': {
      const n = S.world.notes.get(m.id);
      if (n && n.clue && !S.clues.has(m.id)) { S.clues.add(m.id); renderClues(); if (m.by !== S.myId) message(`${nameOf(m.by)} found a clue: ${n.about}`); }
      break;
    }
    case 'sniff': {
      const h = S.world.hides.get(m.hid);
      if (S.me?.hidden === m.hid) { audio.stinger(0.25); S.shake = 0.3; message("Don't breathe.", 'red'); }
      else if (h) audio.locker(h.x, h.z, false);
      break;
    }
    case 'joined': if (!S.scene) { (S.pendingJoins = S.pendingJoins || []).push(m); break; } addPlayer({ id: m.id, name: m.name, color: m.color, char: m.char, x: S.map.spawns[0][0], z: S.map.spawns[0][1] }); message(`${m.name} entered the asylum`); break;
    case 'left': {
      const r = S.players.get(m.id);
      if (r) { S.scene.remove(r.avatar); S.players.delete(m.id); }
      if (S.spectating === m.id) nextSpectate();
      message(`${m.name} left`);
      break;
    }
  }
}

function addBlood(x, z) {
  const mats = S.world.bloodMats;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), mats[Math.floor(Math.random() * mats.length)]);
  mesh.rotation.x = -Math.PI / 2; mesh.rotation.z = Math.random() * 6; mesh.position.set(x, 0.014, z); S.scene.add(mesh);
}

function onEnd(m) {
  S.phase = 'ended';
  if (document.pointerLockElement) document.exitPointerLock();
  audio.setChase(false);
  $('hud').classList.remove('show');
  const h = $('endTitle');
  h.textContent = m.win ? 'YOU ESCAPED' : 'NO ONE ESCAPED';
  h.className = m.win ? 'win' : 'lose';
  $('endList').innerHTML = m.players.map((p) => `<li><span class="dot" style="color:${p.color};background:${p.color}"></span> ${esc(p.name)}: ${p.escaped ? '<span style="color:#cfe">escaped</span>' : p.alive ? 'still inside…' : '<span style="color:#a22">taken</span>'}</li>`).join('');
  setTimeout(() => { $('death').classList.remove('show'); showScreen('end'); }, S.jumpscare ? 2500 : 600);
}

function setObjective() {
  const hr = S.map.rooms[S.map.heart.room];
  const st = S.stage;
  const item = (done, active, text) => `<div class="obj ${done ? 'done' : active ? 'active' : ''}">${done ? '☑' : '☐'} ${text}</div>`;
  $('objective').innerHTML =
    '<div class="h">OBJECTIVES</div>' +
    item(st !== 'effigies', st === 'effigies', `Find the 5 bone effigies <span class="n">(${S.collected}/${TALISMANS})</span>`) +
    item(st === 'escape', st === 'heart', st === 'effigies' ? 'Burn her heart <span class="n">(location unknown)</span>' : `Burn her heart in ROOM 41 <span class="n">(${hr.wing})</span>`) +
    item(false, st === 'escape', 'Escape through the foyer door');
}

// briefing shown on the "click to enter" screen at the start of a game
function showBriefing() {
  $('brief').innerHTML = `
    <div class="bh">YOUR OBJECTIVES</div>
    <ol>
      <li><b>Find the 5 bone effigies.</b> Notes left by the staff tell you which room and wing they are in.</li>
      <li><b>Burn her heart in ROOM 41.</b> After all five are taken, hold <kbd>E</kbd> at the altar. She will come for you.</li>
      <li><b>Escape through the foyer door</b> behind you. Anyone who gets out wins it for the team.</li>
    </ol>
    <div class="bh">TO SURVIVE</div>
    <ul>
      <li><span style="color:#ffd27a">Spirit bells</span>: press <kbd>Q</kbd> to freeze her for 6 seconds.</li>
      <li><span style="color:#9fd8ff">Soul candles</span>: hold <kbd>E</kbd> over a fallen friend to bring them back.</li>
      <li>Hide in lockers and wardrobes, but never while she is watching.</li>
      <li><kbd>C</kbd> crouch with your light off and she can walk right past you. <kbd>Ctrl</kbd> sneak is silent.</li>
      <li>Something lives on the ceiling once the first bone is taken. Look up.</li>
    </ul>`;
  $('brief').style.display = 'block';
}

// ---------------- notes & clues ----------------
function openNote(id) {
  const n = S.world.notes.get(id);
  if (!n) return;
  S.reading = id; n.read = true;
  $('noteText').textContent = n.text;
  $('note').classList.add('show');
  audio.paper?.();
  if (n.clue) send({ t: 'note', id });
}
function closeNote() { S.reading = null; $('note').classList.remove('show'); audio.paper?.(); }
function renderClues() {
  const el = $('clues');
  if (!S.world || (!S.clues.size && S.stage !== 'heart')) { el.innerHTML = ''; return; }
  const rows = [...S.clues].map((id) => {
    const n = S.world.notes.get(id); const t = S.world.talismans.get(n.clue);
    return `<div class="${t && t.taken ? 'done' : ''}">• ${esc(n.about)}</div>`;
  });
  if (S.stage === 'heart') rows.push(`<div style="color:#ff6a50">• ROOM 41, ${esc(S.map.rooms[S.map.heart.room].wing)}: her heart</div>`);
  el.innerHTML = '<div class="h">CLUES</div>' + rows.join('');
}

// ---------------- scares ----------------
function later(sec, fn) { S.timers.push({ at: performance.now() / 1000 + sec, fn }); }

function globalScare(m, t) {
  if (!S.me) return;
  switch (m.type) {
    case 'lights':
      S.lightsOutUntil = t + rnd(2.5, 4.5); S.flickUntil = Math.max(S.flickUntil, t + 0.9);
      audio.buzz(0.9, 0.12); audio.rumble(0.4, 3);
      break;
    case 'bang': audio.bang(m.x, m.z, 1); slamNearestDoor(m.x, m.z, 10); break;
    case 'scream': audio.distantScream(m.x + rnd(-15, 15), m.z + rnd(-15, 15)); break;
    case 'whisper': audio.whisper(rnd(-0.9, 0.9), 0.3, 2.5); break;
  }
}

function slamNearestDoor(x, z, maxD) {
  let best = null, bd = maxD;
  for (const d of S.world.doors) { const dd = Math.hypot(d.x - x, d.z - z); if (dd < bd) { bd = dd; best = d; } }
  if (best) { best.slam = 0.6; audio.bang(best.x, best.z, 1.1); later(1.8, () => audio.doorCreak(best.x, best.z)); }
  return best;
}

function camForward() { return { x: -Math.sin(S.me.yaw), z: -Math.cos(S.me.yaw) }; }

function findSpotAhead(minD, maxD) {
  const f = camForward(), cx = camera.position.x, cz = camera.position.z;
  for (let d = maxD; d >= minD; d -= 0.5) {
    const x = cx + f.x * d, z = cz + f.z * d;
    if (!isWall(S.map, Math.floor(x / CELL), Math.floor(z / CELL)) && lineOfSight(S.map, cx, cz, x, z)) return { x, z, d };
  }
  return null;
}

function showGhost(x, z, until, kind) {
  const g = S.ghost;
  g.position.set(x, 0, z);
  g.rotation.y = Math.atan2(-(camera.position.x - x), -(camera.position.z - z));
  g.visible = true;
  S.ghostState = { until, seen: false, kind, lookT: 0 };
}
function hideGhost() { S.ghost.visible = false; S.ghostState = null; }

function runScare(t, forced) {
  const options = ['apparition', 'apparition', 'footsteps', 'whisper', 'blackout', 'blackout', 'bulb', 'slam'];
  if (S.collected >= 2) options.push('faceflash', 'blackout');
  let type = forced || options[Math.floor(Math.random() * options.length)];
  const monD = Math.hypot(S.mon.x - S.me.x, S.mon.z - S.me.z);
  if (type === 'apparition' && monD < 18) type = 'whisper';
  switch (type) {
    case 'apparition': {
      const spot = findSpotAhead(7, 15);
      if (!spot) { audio.whisper(rnd(-1, 1), 0.3); break; }
      showGhost(spot.x, spot.z, t + 3, 'far');
      break;
    }
    case 'footsteps': {
      const f = camForward();
      for (let k = 0; k < 6; k++) {
        later(k * 0.42, () => {
          if (!S.me) return;
          const d = 7 - k * 1.1;
          audio.step(0.35, { x: S.me.x - f.x * d + rnd(-0.3, 0.3), z: S.me.z - f.z * d });
        });
      }
      later(2.8, () => audio.whisper(rnd(-0.3, 0.3), 0.45, 1.6));
      break;
    }
    case 'whisper': audio.whisper(rnd(-1, 1), 0.35, 2.2); break;
    case 'blackout': {
      S.flickUntil = t + 1.5; audio.buzz(0.5, 0.1);
      if (Math.random() < 0.55) {
        later(1.45, () => {
          const spot = findSpotAhead(1.2, 1.9);
          if (!spot || !S.me?.alive) return;
          showGhost(spot.x, spot.z, performance.now() / 1000 + 0.4, 'face');
          audio.stinger(0.95); audio.screech(spot.x, spot.z, 0.5); S.red = 0.8; S.shake = 1;
          later(0.42, () => { S.flickUntil = performance.now() / 1000 + 0.15; hideGhost(); });
        });
      }
      break;
    }
    case 'bulb': {
      let best = null, bd = 16;
      for (const b of S.world.bulbs) { if (b.dead) continue; const d = Math.hypot(b.x - S.me.x, b.z - S.me.z); if (d < bd) { bd = d; best = b; } }
      if (best) { best.dead = true; best.sprite.visible = false; best.mesh.emissiveIntensity = 0; audio.glass(best.x, best.z); S.shake = 0.2; }
      else audio.whisper(rnd(-1, 1), 0.3);
      break;
    }
    case 'slam': if (!slamNearestDoor(S.me.x, S.me.z, 14)) audio.bang(S.me.x + rnd(-8, 8), S.me.z + rnd(-8, 8)); break;
    case 'faceflash': {
      const ff = $('faceflash');
      if (!ff.firstChild) ff.appendChild(scareCanvas());
      ff.style.display = 'block'; ff.style.opacity = 0.55; audio.stinger(0.7); S.red = 0.5;
      setTimeout(() => (ff.style.display = 'none'), 110);
      break;
    }
  }
}

function updateScares(dt, t) {
  for (let k = S.timers.length - 1; k >= 0; k--) if (t >= S.timers[k].at) { const fn = S.timers[k].fn; S.timers.splice(k, 1); fn(); }
  if (!S.me.alive || S.me.escaped) return;
  if (t > S.nextScare) {
    if (S.mon.state === 'chase' && S.mon.target === S.myId) S.nextScare = t + 8;
    else { runScare(t); S.nextScare = t + rnd(22, 45) - S.collected * 2.5; }
  }
  const gs = S.ghostState;
  if (gs) {
    S.ghost.userData.update(dt, 0, 'stall', t);
    const dx = S.ghost.position.x - camera.position.x, dz = S.ghost.position.z - camera.position.z, d = Math.hypot(dx, dz);
    const f = camForward(); const dot = (dx * f.x + dz * f.z) / (d || 1);
    if (gs.kind === 'far') {
      if (dot > 0.88 && !gs.seen) { gs.seen = true; audio.stinger(0.5); S.shake = 0.3; gs.until = Math.min(gs.until, t + 0.7); }
      if (S.me.fl && dot > 0.97) { gs.lookT += dt; if (gs.lookT > 0.2) gs.until = Math.min(gs.until, t + 0.08); }
      if (d < 5.5) gs.until = t;
    }
    if (t > gs.until) { hideGhost(); if (gs.kind === 'far') S.flickUntil = t + 0.18; }
  }
}

let scareCv = null;
function scareCanvas() { if (!scareCv) scareCv = TX.jumpscareCanvas(); const c = document.createElement('canvas'); c.width = c.height = 1024; c.getContext('2d').drawImage(scareCv, 0, 0); return c; }

function doJumpscare(mx, mz) {
  S.jumpscare = true; S.me.alive = false;
  audio.setChase(false);
  // snap the camera onto the monster's face
  const dx = mx - S.me.x, dz = mz - S.me.z;
  S.me.yaw = Math.atan2(-dx, -dz); S.me.pitch = 0.35;
  const f = camForward();
  S.mon.x = S.mon.tx = S.me.x + f.x * 0.7; S.mon.z = S.mon.tz = S.me.z + f.z * 0.7;
  S.mon.yaw = S.mon.tyaw = Math.atan2(f.x, f.z);
  S.mon.state = 'chase';
  audio.scream(); S.shake = 2; S.red = 1;
  const el = $('scare'); el.innerHTML = ''; const c = scareCanvas(); el.appendChild(c);
  setTimeout(() => {
    el.style.display = 'block';
    const t0 = performance.now();
    const anim = () => {
      const k = (performance.now() - t0) / 1000;
      if (k > 1.9) { el.style.display = 'none'; return; }
      const s = 1 + k * 0.35 + Math.random() * 0.08;
      c.style.transform = `translate(calc(-50% + ${rnd(-30, 30)}px), calc(-50% + ${rnd(-30, 30)}px)) scale(${s}) rotate(${rnd(-3, 3)}deg)`;
      const inv = Math.random() < 0.12;
      c.style.filter = `${inv ? 'invert(1) ' : ''}contrast(${rnd(1.2, 2)}) saturate(${rnd(1, 3)}) hue-rotate(${Math.random() < 0.2 ? rnd(-30, 30) : 0}deg)`;
      el.style.opacity = Math.random() < 0.1 ? 0.3 : 1;
      requestAnimationFrame(anim);
    };
    anim();
  }, 140);
  setTimeout(() => {
    if (S.phase !== 'playing' || S.me?.alive) return;
    showScreen('death'); $('death').classList.add('show'); audio.deathTone();
  }, 2050);
  setTimeout(() => {
    if (S.phase !== 'playing') return;
    $('death').classList.remove('show');
    S.jumpscare = false;
    if (S.me?.alive) return;
    startSpectate();
  }, 6500);
}

function aliveOthers() { return [...S.players.values()].filter((p) => p.alive && !p.escaped); }
function startSpectate() {
  if (S.phase !== 'playing') return;
  const list = aliveOthers();
  S.spectating = list.length ? list[0].id : -1;
  $('spectate').style.display = 'block';
  if (document.pointerLockElement !== canvas) showScreen('resume'); else showScreen('');
}
function nextSpectate() {
  const list = aliveOthers();
  if (!list.length) { S.spectating = -1; return; }
  const i = list.findIndex((p) => p.id === S.spectating);
  S.spectating = list[(i + 1) % list.length].id;
}

// ---------------- per-frame updates ----------------
function surfaceAt(x, z) { return S.map.grid[Math.floor(z / CELL) * S.map.W + Math.floor(x / CELL)] === 2 ? 'tile' : 'wood'; }

function updateHidden(dt, t) {
  const me = S.me, h = S.world.hides.get(me.hidden);
  me.fl = false; me.moving = false; me.sprint = false;
  me.stamina = Math.min(100, me.stamina + dt * 15);
  if (h.type === 'bed') camera.position.set(h.x + h.fx * 0.35, 0.26, h.z + h.fz * 0.35);
  else camera.position.set(h.x - h.fx * 0.08, 1.6, h.z - h.fz * 0.08);
  camera.rotation.set(me.pitch + (Math.random() - 0.5) * S.shake * 0.04, me.yaw, 0);
  // you hold your breath when it is close
  const d = Math.hypot(S.mon.x - h.x, S.mon.z - h.z);
  me.breathT -= dt;
  if (me.breathT <= 0) { me.breathT = d < 5 ? 2.4 : 1.6; if (d > 3) audio.breath(d < 8 ? 0.03 : 0.06); }
  if (t - S.lastSend > 1 / 10) { S.lastSend = t; send({ t: 's', x: me.x, z: me.z, yaw: +me.yaw.toFixed(3), pitch: +me.pitch.toFixed(3), fl: false, cr: false, sp: false, sn: false, mv: false }); }
}

function updatePlayer(dt, t) {
  const me = S.me, map = S.map;
  if (me.hidden) return updateHidden(dt, t);
  let ix = 0, iz = 0;
  if (keys.KeyW || keys.ArrowUp) iz += 1;
  if (keys.KeyS || keys.ArrowDown) iz -= 1;
  if (keys.KeyA || keys.ArrowLeft) ix -= 1;
  if (keys.KeyD || keys.ArrowRight) ix += 1;
  const len = Math.hypot(ix, iz); if (len) { ix /= len; iz /= len; }
  me.crouch = !!keys.KeyC;
  me.sneak = !!(keys.ControlLeft || keys.ControlRight || keys.AltLeft) && !me.crouch;
  // sprint in any direction except straight backwards
  const wantSprint = (keys.ShiftLeft || keys.ShiftRight) && iz > -0.5 && !me.crouch && !me.sneak && len > 0;
  me.sprint = wantSprint && !me.exhausted && me.stamina > 0;
  if (me.sprint) { me.stamina -= dt * 16; if (me.stamina <= 0) { me.stamina = 0; me.exhausted = true; message('Out of breath…'); } }
  else { me.stamina = Math.min(100, me.stamina + dt * (me.exhausted ? 14 : 18)); if (me.exhausted && me.stamina > 20) me.exhausted = false; }
  const back = iz < 0 ? 0.75 : 1;
  const speed = (me.crouch ? 1.7 : me.sneak ? 1.3 : me.sprint ? 5.8 : 3.1) * back;
  const fx = -Math.sin(me.yaw), fz = -Math.cos(me.yaw), rx = Math.cos(me.yaw), rz = -Math.sin(me.yaw);
  const tvx = (fx * iz + rx * ix) * speed, tvz = (fz * iz + rz * ix) * speed;
  const acc = Math.min(1, dt * 10);
  me.vx += (tvx - me.vx) * acc; me.vz += (tvz - me.vz) * acc;
  const ox = me.x, oz = me.z;
  let nx = me.x + me.vx * dt, nz = me.z + me.vz * dt;
  for (let pass = 0; pass < 2; pass++) {
    [nx, nz] = resolveCircle(map, nx, nz, 0.3);
    for (const c of S.world.colliders) {
      if (Math.abs(c[0] - nx) > 4 || Math.abs(c[1] - nz) > 4) continue;
      const r = pushOutBox(nx, nz, 0.3, c[0], c[1], c[2], c[3]);
      if (r) { nx = r[0]; nz = r[1]; }
    }
  }
  me.x = nx; me.z = nz;
  const moved = Math.hypot(me.x - ox, me.z - oz);
  me.moving = moved > dt * 0.4;
  // footsteps + head bob
  me.stepAcc += moved;
  const stride = me.sprint ? 2.3 : me.crouch ? 1.2 : me.sneak ? 1.0 : 1.85;
  if (me.stepAcc > stride) { me.stepAcc = 0; if (!me.sneak && !me.crouch) audio.step(me.sprint ? 0.42 : 0.22, null, false, surfaceAt(me.x, me.z)); }
  me.bob += moved * (me.sprint ? 3.2 : 3.6);
  const bobAmp = me.sprint ? 0.085 : (me.crouch || me.sneak) ? 0.015 : 0.04;
  // field-of-view kick so sprinting feels fast
  const fovT = me.sprint && me.moving ? 82 : 72;
  if (Math.abs(camera.fov - fovT) > 0.05) { camera.fov += (fovT - camera.fov) * Math.min(1, dt * 6); camera.updateProjectionMatrix(); }
  const eyeT = me.crouch ? 1.05 : 1.62;
  me.eye += (eyeT - me.eye) * Math.min(1, dt * 9);
  const sh = S.shake;
  camera.position.set(me.x, me.eye + Math.sin(me.bob) * bobAmp * (me.moving ? 1 : 0), me.z);
  camera.rotation.set(
    me.pitch + (Math.random() - 0.5) * sh * 0.05,
    me.yaw + (Math.random() - 0.5) * sh * 0.05,
    Math.sin(me.bob * 0.5) * bobAmp * 0.25 + (Math.random() - 0.5) * sh * 0.03,
  );
  // breathing when tired
  if (me.stamina < 30) { me.breathT -= dt; if (me.breathT <= 0) { audio.breath(0.08 + (30 - me.stamina) / 200); me.breathT = 0.75; } }
  // flashlight battery
  if (me.fl) { me.battery = Math.max(0, me.battery - dt * (100 / 200)); if (me.battery <= 0) { me.fl = false; audio.click(); message('Your flashlight died.', 'red'); } }
  // escape
  if (S.exitOpen && Math.hypot(me.x - S.map.exit.x, me.z - S.map.exit.z) < 2.3 && t - S.escSent > 1) { S.escSent = t; send({ t: 'escape' }); }
  // network
  if (t - S.lastSend > 1 / 15) {
    S.lastSend = t;
    send({ t: 's', x: +me.x.toFixed(2), z: +me.z.toFixed(2), yaw: +me.yaw.toFixed(3), pitch: +me.pitch.toFixed(3), fl: me.fl, cr: me.crouch, sp: me.sprint, sn: me.sneak, mv: me.moving });
  }
}

// hidden spectator: free-flying drone camera (no collision), or ride along in any player's view
function updateDrone(dt) {
  const me = S.me;
  const list = [...S.players.values()].filter((p) => !p.escaped);
  $('specHud').innerHTML = `HIDDEN SPECTATOR · nobody can see you<br>WASD fly · mouse look · SPACE up · C down · SHIFT fast<br>` +
    list.map((p, i) => `<span style="color:${p.color}">${i + 1}</span> ${esc(p.name)}${p.alive ? '' : ' ✕'}`).join(' &nbsp; ') + ' &nbsp; <span style="color:#fff">0</span> free fly' +
    `<br><span style="color:#ff6a50">she is ${S.mon.state}</span>`;
  if (S.droneFollow) {
    const r = S.players.get(S.droneFollow);
    if (r && !r.escaped) {
      r.avatar.userData.setShown(false);
      camera.position.set(r.x, r.cr ? 1.05 : 1.6, r.z); camera.rotation.set(r.pitch, r.yaw, 0);
      return;
    }
    S.droneFollow = null;
  }
  let ix = 0, iz = 0, iy = 0;
  if (keys.KeyW) iz += 1; if (keys.KeyS) iz -= 1; if (keys.KeyA) ix -= 1; if (keys.KeyD) ix += 1;
  if (keys.Space) iy += 1; if (keys.KeyC || keys.ControlLeft) iy -= 1;
  const sp = ((keys.ShiftLeft || keys.ShiftRight) ? 20 : 7) * dt;
  const cp = Math.cos(me.pitch);
  me.x += (-Math.sin(me.yaw) * cp * iz + Math.cos(me.yaw) * ix) * sp;
  me.z += (-Math.cos(me.yaw) * cp * iz - Math.sin(me.yaw) * ix) * sp;
  me.droneY = clamp(me.droneY + (Math.sin(me.pitch) * iz + iy) * sp, 0.3, 45);
  camera.position.set(me.x, me.droneY, me.z);
  camera.rotation.set(me.pitch, me.yaw, 0);
}

function updateSpectate(dt) {
  let r = S.players.get(S.spectating);
  if (!r || !r.alive || r.escaped) { nextSpectate(); r = S.players.get(S.spectating); }
  for (const p of S.players.values()) if (!p.escaped) { p.avatar.userData.setShown(p !== r); p.avatar.userData.label.visible = p !== r && p.alive; }
  const el = $('spectate');
  if (!r) { el.textContent = S.me.escaped ? 'YOU ESCAPED. Waiting for the others…' : 'NO ONE LEFT TO WATCH'; return; }
  el.innerHTML = `${S.me.escaped ? 'ESCAPED' : 'DEAD'} · WATCHING <span style="color:${r.color}">${esc(r.name)}</span> · click to switch`;
  camera.position.set(r.x, r.cr ? 1.05 : 1.6, r.z);
  camera.rotation.set(r.pitch, r.yaw, 0);
}

function updateRemotes(dt) {
  const rt = performance.now() - INTERP_MS;
  for (const r of S.players.values()) {
    const ox = r.x, oz = r.z;
    const smp = sampleBuf(r.buf, rt);
    if (smp) { r.x = smp.x; r.z = smp.z; r.yaw = smp.yaw; r.pitch = smp.pitch; }
    const a = r.avatar;
    a.position.set(r.x, 0, r.z); a.rotation.y = r.yaw;
    if (r.escaped) { a.userData.setShown(false); a.userData.label.visible = false; continue; }
    if (S.spectating !== r.id && S.droneFollow !== r.id) { a.userData.setShown(!r.hid || S.spectator); a.userData.label.visible = (!r.hid || S.spectator) && r.alive; }
    if (!r.alive) { if (!r.deadShown) { a.userData.setDead(); r.deadShown = true; } continue; }
    const moved = Math.hypot(r.x - ox, r.z - oz);
    a.userData.setPose(r.pitch, r.fl, r.cr, r.mv, dt, moved / Math.max(dt, 1e-3));
    r.step += moved;
    if (r.step > (r.sp ? 2.3 : 1.85)) { r.step = 0; if (!r.cr && !r.sn) audio.step(r.sp ? 0.45 : 0.25, { x: r.x, z: r.z }, false, surfaceAt(r.x, r.z)); }
    // label always faces camera (sprite), fade with distance
    const d = Math.hypot(r.x - camera.position.x, r.z - camera.position.z);
    a.userData.label.material.opacity = clamp(1 - (d - 4) / 10, 0.15, 0.85);
  }
}

function updateCrawler(dt, t) {
  const c = S.crawl, g = S.crawler;
  const ox = c.x, oz = c.z;
  const smp = sampleBuf(c.buf, performance.now() - INTERP_MS);
  if (smp) { c.x = smp.x; c.z = smp.z; c.yaw = smp.yaw; }
  const moved = Math.hypot(c.x - ox, c.z - oz);
  c.speed += (moved / Math.max(dt, 1e-3) - c.speed) * Math.min(1, dt * 6);
  g.position.set(c.x, 0, c.z); g.rotation.y = c.yaw;
  g.userData.update(dt, c.state, c.speed, t);
  if (c.state === 'crawl') {
    c.skitter -= dt;
    if (c.skitter <= 0) { c.skitter = 0.22; audio.skitter(c.x, c.z, 0.5); }
  } else if (c.state === 'ceiling') {
    c.skitter -= dt;
    const d = Math.hypot(c.x - camera.position.x, c.z - camera.position.z);
    if (c.skitter <= 0) { c.skitter = rnd(2.5, 6); if (d < 10) audio.skitter(c.x, c.z, 0.18); }
  }
}

function updateMonster(dt, t) {
  const m = S.mon, g = S.monster;
  if (S.jumpscare) {
    g.position.set(m.x, -0.35, m.z); g.rotation.y = m.yaw;
    g.userData.update(dt, 0, 'chase', t);
    return;
  }
  const ox = m.x, oz = m.z;
  const smp = sampleBuf(m.buf, performance.now() - INTERP_MS);
  const jump = smp ? Math.hypot(smp.x - m.x, smp.z - m.z) > 6 : false; // teleport
  if (smp) { m.x = smp.x; m.z = smp.z; m.yaw = angLerp(m.yaw, smp.yaw, Math.min(1, dt * 12)); }
  const moved = jump ? 0 : Math.hypot(m.x - ox, m.z - oz);
  m.vis += (moved / Math.max(dt, 1e-3) - m.vis) * Math.min(1, dt * 6);
  g.position.set(m.x, 0, m.z); g.rotation.y = m.yaw;
  const st = m.state === 'chase' && m.speed < 0.05 ? 'stall' : m.state;
  g.userData.update(dt, m.vis, st, t);
  m.step += moved;
  if (m.step > 1.5) { m.step = 0; audio.step(m.state === 'chase' ? 0.7 : 0.45, { x: m.x, z: m.z }, true); }
}

const tmpV = new THREE.Vector3();
const offV = new THREE.Vector3();
function flickerVal(src, t) {
  if (src.candle) return 0.82 + Math.sin(t * 11 + src.phase) * 0.1 + Math.random() * 0.08;
  if (!src.flicker) return 1;
  const n = Math.sin(t * 1.7 + src.phase) * Math.sin(t * 0.63 + src.phase * 1.3);
  if (n > 0.45) return Math.sin(t * 57 + src.phase) > 0.2 ? 0.08 : 0.9;
  return 0.95 + Math.random() * 0.05;
}

function updateLights(dt, t) {
  const W = S.world, me = S.me;
  const lightsOut = t < S.lightsOutUntil;
  // fixtures (emissive + glow) for all bulbs
  for (const b of W.bulbs) {
    if (b.dead) continue;
    b.level = lightsOut ? 0 : flickerVal(b, t);
    b.mesh.emissiveIntensity = 2.2 * b.level;
    b.mesh.emissive.copy(b.color);
    b.sprite.material.opacity = 0.5 * b.level; b.sprite.material.color.copy(b.color);
  }
  // assign the 4 real lights to the nearest sources
  S.poolT -= dt;
  if (S.poolT <= 0) {
    S.poolT = 0.25;
    const cx = camera.position.x, cz = camera.position.z;
    const list = W.lightSources.filter((s) => !s.dead).map((s) => [Math.hypot(s.x - cx, s.z - cz), s]).sort((a, b) => a[0] - b[0]);
    lightPool.forEach((p, k) => {
      const s = list[k] && list[k][0] < 26 ? list[k][1] : null;
      p.src = s;
      if (s) { p.light.position.set(s.x, s.y, s.z); p.light.distance = s.dist; }
    });
  }
  for (const p of lightPool) {
    const s = p.src;
    if (!s || s.dead) { p.light.intensity = 0; continue; }
    p.light.color.copy(s.color);
    const lvl = s.kind === 'bulb' ? s.level : s.kind === 'candle' ? flickerVal(s, t) * (lightsOut ? 0.3 : 1) : 1;
    p.light.intensity = s.base * lvl * S.tune.bulb;
  }
  if (S.exitOpen && W.exit.src) W.exit.src.base = W.exit.opened ? 14 : 6 + Math.sin(t * 6) * 3;

  // flashlight
  if (!me) return;
  const fwd = tmpV.set(0, 0, -1).applyEuler(camera.rotation);
  flDir.lerp(fwd, Math.min(1, dt * 16)).normalize();
  const off = offV.set(0.24, -0.25, -0.62).applyEuler(camera.rotation);
  flashlight.position.copy(camera.position).add(off);
  flashTarget.position.copy(flashlight.position).addScaledVector(flDir, 6);
  let fl = (me.alive && !me.escaped) ? me.fl : false;
  let watched = null;
  if (S.spectating !== null && S.spectating !== -1) { watched = S.players.get(S.spectating); fl = !!watched?.fl; }
  let k = 1;
  const monD = Math.hypot(S.mon.x - camera.position.x, S.mon.z - camera.position.z);
  if (me.alive && me.battery < 15 && Math.random() < 0.06) k = 0.15;
  if (monD < 9 && S.mon.state !== 'dormant' && Math.random() < 0.2 * (1 - monD / 9) * 2) k = Math.random() * 0.3;
  if (t < S.flickUntil) k = Math.random() < 0.08 ? 0.3 : 0;
  if (S.jumpscare) k = 1;
  const batt = me.alive ? 0.55 + 0.45 * Math.min(1, me.battery / 30) : 1;
  flashlight.intensity = fl ? S.tune.fl * k * batt : 0;
  playerGlow.intensity = S.jumpscare ? 3 : me.hidden ? 0.06 : 1.2;
  if (S.viewmodel) {
    const vm = S.viewmodel;
    vm.g.visible = me.alive && !me.escaped && !me.hidden && !S.jumpscare && S.spectating === null;
    const bobK = me.moving ? (me.sprint ? 1.8 : 1) : 0;
    vm.g.position.set(0.24 + Math.sin(me.bob * 0.5) * 0.012 * bobK, -0.25 + Math.abs(Math.cos(me.bob * 0.5)) * 0.012 * bobK - (me.crouch ? 0.02 : 0), -0.42);
    vm.lensM.color.setHex(fl && flashlight.intensity > 1 ? 0xfff4dc : 0x333333);
  }
  for (const r of S.players.values()) { const L = r.avatar.userData.light; L.intensity = L.userData.on && r.alive && !r.escaped && !r.hid && S.spectating !== r.id ? S.tune.remote : 0; }

  // dust in the beam
  if (dust) {
    const { pos, col, N, vel } = dust;
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    for (let i = 0; i < N; i++) {
      const j = i * 3;
      if (!dust.init || Math.abs(pos[j] - cx) > 5 || Math.abs(pos[j + 2] - cz) > 5) {
        pos[j] = cx + rnd(-5, 5); pos[j + 1] = rnd(0.1, WALL_H - 0.1); pos[j + 2] = cz + rnd(-5, 5);
      }
      pos[j] += vel[j] * dt; pos[j + 1] += vel[j + 1] * dt * 0.3; pos[j + 2] += vel[j + 2] * dt;
      if (pos[j + 1] < 0.05 || pos[j + 1] > WALL_H) vel[j + 1] *= -1;
      const dx = pos[j] - flashlight.position.x, dy = pos[j + 1] - flashlight.position.y, dz = pos[j + 2] - flashlight.position.z;
      const d = Math.hypot(dx, dy, dz) || 1;
      const a = (dx * flDir.x + dy * flDir.y + dz * flDir.z) / d;
      const b = fl ? Math.max(0, (a - 0.88) / 0.12) * Math.max(0, 1 - d / 6) * k : 0;
      col[j] = col[j + 1] = col[j + 2] = b * 0.9;
    }
    dust.init = true;
    dust.pts.geometry.attributes.position.needsUpdate = true;
    dust.pts.geometry.attributes.color.needsUpdate = true;
  }
}

let promptHtml = null;
function setPrompt(html) {
  if (html === promptHtml) return;
  promptHtml = html;
  const el = $('prompt');
  if (html) { el.innerHTML = html; el.style.opacity = 1; } else el.style.opacity = 0;
}

function updateInteract() {
  const me = S.me; S.prompt = null;
  const el = $('prompt');
  if (!me.alive || me.escaped) { setPrompt(''); return; }
  const f = camForward();
  let best = null, bs = 0;
  const consider = (id, x, z, range, label) => {
    const dx = x - me.x, dz = z - me.z, d = Math.hypot(dx, dz);
    if (d > range) return;
    const dot = (dx * f.x + dz * f.z) / (d || 1);
    const s = dot - d * 0.1;
    if ((dot > 0.55 || d < 0.9) && s > bs - 1) { bs = s; best = { id, label }; }
  };
  for (const [id, tl] of S.world.talismans) if (!tl.taken) consider(id, tl.x, tl.z, 2.4, 'Take the bone effigy');
  for (const [id, b] of S.world.batteries) if (!b.taken) consider(id, b.x, b.z, 1.9, 'Pick up battery');
  for (const [id, b] of S.world.bells) if (!b.taken) consider(id, b.x, b.z, 1.9, 'Take the spirit bell');
  for (const [id, c] of S.world.souls) if (!c.taken) consider(id, c.x, c.z, 1.9, 'Take the soul candle');
  // a fallen friend: hold E with a soul candle to bring them back
  for (const r of S.players.values()) {
    if (r.alive || r.escaped) continue;
    const d = Math.hypot(r.x - me.x, r.z - me.z);
    if (d > 2.4) continue;
    if (me.revives > 0) {
      if (S.reviving && S.reviving.id === r.id) {
        if (!keys.KeyE || d > 2.6) S.reviving = null;
        else {
          const tt = (performance.now() - S.reviving.start) / 1000;
          setPrompt(`<b>E</b>Bringing ${esc(r.name)} back… <span style="display:inline-block;width:160px;height:6px;background:#012;vertical-align:middle"><i style="display:block;height:100%;width:${Math.round(Math.min(100, tt / 3 * 100))}%;background:#7fd0ff"></i></span>`);
          if (tt >= 3 && !S.reviving.sent) { S.reviving.sent = true; send({ t: 'revive', id: r.id }); }
          S.prompt = { id: 'revive', revive: true, target: r.id };
          return;
        }
      }
      best = { id: 'revive', revive: true, target: r.id, label: `Hold E to revive ${esc(r.name)} (soul candle)` };
    } else best = { id: 'nocandle', label: `Find a soul candle to revive ${esc(r.name)}` };
    break;
  }
  for (const [id, n] of S.world.notes) consider(id, n.x, n.z, 1.8, n.read ? 'Read the note again' : 'Read the note');
  if (!best) for (const [id, h] of S.world.hides) consider(id, h.x + h.fx * (h.type === 'bed' ? 1.15 : 0.5), h.z + h.fz * (h.type === 'bed' ? 1.15 : 0.5), 1.7, h.type === 'bed' ? 'Hide under the bed' : `Hide in the ${h.type}`);
  if (best && best.id[0] === 'h') best.hide = true;
  if (best && best.id[0] === 'n') best.note = true;
  if (me.hidden) { const ht = S.world.hides.get(me.hidden)?.type || 'locker'; setPrompt(ht === 'bed' ? '<b>E</b>Crawl out from under the bed' : `<b>E</b>Get out of the ${ht}`); S.prompt = null; return; }
  const H = S.world.heart, hd = Math.hypot(H.x - me.x, H.z - me.z);
  if (S.stage === 'heart' && hd < 2.6) {
    best = { id: 'heart', burn: true, label: 'Hold E to burn her heart' };
    if (S.burn) {
      if (!keys.KeyE) { S.burn = null; }
      else {
        S.burn.t = (performance.now() - S.burn.start) / 1000;
        const pct = Math.min(100, (S.burn.t / 4) * 100);
        setPrompt(`<b>E</b>Burning… <span style="display:inline-block;width:160px;height:6px;background:#300;vertical-align:middle"><i style="display:block;height:100%;width:${Math.round(pct)}%;background:#ff5a20"></i></span>`);
        S.prompt = best;
        if (S.burn.t >= 4 && !S.burn.sent) { S.burn.sent = true; send({ t: 'burn' }); }
        return;
      }
    }
  } else if (S.burn) S.burn = null;
  S.prompt = best;
  if (best) setPrompt(`<b>E</b>${best.label}`);
  else if (S.exitOpen && Math.hypot(me.x - S.map.exit.x, me.z - S.map.exit.z) < 6) setPrompt('GO THROUGH THE DOOR');
  else setPrompt('');
}

let hudT = 0, hudKey = '', teamKey = '';
function updateHUD(dt) {
  const me = S.me;
  const hk = `${Math.round(me.battery)}|${Math.round(me.stamina)}|${me.exhausted}|${me.bells}|${me.revives}`;
  if (hk !== hudKey) {
    hudKey = hk;
    $('battery').querySelector('i').style.width = Math.round(me.battery) + '%';
    $('battery').classList.toggle('low', me.battery < 20);
    $('stamina').querySelector('i').style.width = Math.round(me.stamina) + '%';
    $('stamina').querySelector('i').style.background = me.exhausted ? '#7a3020' : '';
    $('bellCount').innerHTML = (me.bells > 0 ? `SPIRIT BELLS ×${me.bells}  [Q]<br>` : '') + (me.revives > 0 ? `<span style="color:#9fd8ff">SOUL CANDLES ×${me.revives}</span>` : '');
  }
  hudT -= dt;
  if (hudT > 0) return;
  hudT = 0.3;
  const rows = S.spectator ? [] : [`<div style="color:${S.myColor}" class="${me.alive ? '' : 'dead'}">${esc(S.name)} ${me.escaped ? '✓' : me.alive ? '' : '✕'}</div>`];
  for (const r of S.players.values()) rows.push(`<div style="color:${r.color}" class="${r.alive ? '' : 'dead'}">${esc(r.name)} ${r.escaped ? '✓' : r.alive ? '' : '✕'}</div>`);
  const tk = rows.join('');
  if (tk !== teamKey) { teamKey = tk; $('team').innerHTML = tk; }
}

function updateAudioAndFear(dt, t) {
  const me = S.me, m = S.mon;
  const fwd = tmpV.set(0, 0, -1).applyEuler(camera.rotation);
  audio.setListener(camera.position, fwd);
  audio.listenerPos = camera.position;
  const d = Math.hypot(m.x - camera.position.x, m.z - camera.position.z);
  const active = m.state !== 'dormant';
  const chasingMe = m.state === 'chase' && m.target === S.myId && me.alive;
  const vis = active && d < 22 && lineOfSight(S.map, camera.position.x, camera.position.z, m.x, m.z);
  const level = !active ? 0 : m.state === 'chase' || m.state === 'stunned' ? 1 : m.state === 'hunt' ? 0.6 : 0.4;
  audio.setMonster(m.x, m.z, level * 0.7, m.state === 'chase');
  let close = active ? clamp(1 - d / 20, 0, 1) : 0;
  if (chasingMe) close = Math.max(close, 0.65);
  if (me.hidden) close = Math.max(close, active ? clamp(1 - d / 10, 0, 1) : 0);
  if (me.alive && !me.escaped) audio.updateHeart(dt, close);
  const crawlMe = S.crawl.state === 'crawl' && S.crawl.target === S.myId;
  audio.setChase(me.alive && !me.escaped && ((m.state === 'chase' && (chasingMe || d < 10)) || crawlMe));
  // fear drives the post effect
  let f = active ? clamp((16 - d) / 14, 0, 1) * (vis ? 1 : 0.45) : 0;
  if (chasingMe || crawlMe) f = Math.max(f, 0.6);
  if (!me.alive && !S.jumpscare) f *= 0.3;
  S.fear += (f - S.fear) * Math.min(1, dt * 3);
}

function updatePost(dt, t) {
  const u = S.post.uniforms;
  S.red = Math.max(0, S.red - dt * 1.2);
  S.shake = Math.max(0, S.shake - dt * 1.5);
  S.black = Math.max(0, S.black - dt * 0.6);
  u.time.value = t; u.fear.value = S.fear; u.red.value = S.red; u.black.value = S.black;
  if (S.whiteOut) { S.whiteOut = Math.max(0, S.whiteOut - dt * 0.4); renderer.toneMappingExposure = S.tune.exposure + S.whiteOut * 8; }
  else renderer.toneMappingExposure = S.tune.exposure;
  // inside a hiding spot your eyes adjust: the dark room becomes visible through the slits
  const adj = S.me && (S.me.hidden || (S.spectator && !S.droneFollow)) ? 1 : 0;
  S.eyeAdj = (S.eyeAdj || 0) + (adj - (S.eyeAdj || 0)) * Math.min(1, dt * 1.5);
  const high = S.spectator && !S.droneFollow && S.me.droneY > 3.1;
  S.scene.fog.density = high ? 0.006 : S.tune.fog * (1 - S.eyeAdj * 0.35);
  const far = high ? 160 : 34;
  if (camera.far !== far) { camera.far = far; camera.updateProjectionMatrix(); }
  S.hemi.intensity = S.tune.hemi * (1 + S.eyeAdj * 24);
  u.lift.value = S.eyeAdj;
  if (!S.whiteOut) renderer.toneMappingExposure = S.tune.exposure + S.eyeAdj * 0.8;
}

// ---------------- main loop ----------------
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const t = now / 1000;
  if (S.phase === 'menu' || S.phase === 'lobby' || S.phase === 'joining') { drawGrain(); return; }
  if (S.phase !== 'playing' || !S.scene || !S.me) { if (S.composer && S.scene) S.composer.render(dt); return; }
  const me = S.me;
  if (S.reading && (!me.alive || (S.mon.state === 'chase' && S.mon.target === S.myId))) closeNote();
  if (S.spectator) updateDrone(dt);
  else if (me.alive && !me.escaped && !S.jumpscare) updatePlayer(dt, t);
  else if (S.jumpscare) {
    camera.position.set(me.x, 1.5, me.z);
    camera.rotation.set(me.pitch + (Math.random() - 0.5) * 0.08, me.yaw + (Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.1);
  } else if (S.spectating !== null) updateSpectate(dt);
  updateRemotes(dt);
  updateMonster(dt, t);
  updateCrawler(dt, t);
  updateLights(dt, t);
  S.world.update(dt, t);
  updateScares(dt, t);
  updateInteract();
  updateHUD(dt);
  updateAudioAndFear(dt, t);
  updatePost(dt, t);
  perf.cullT -= dt;
  if (perf.cullT <= 0) { perf.cullT = 0.25; S.world.updateCull(camera.position.x, camera.position.z, S.spectator && S.me.droneY > 3.1 ? 200 : 26); }
  S.composer.render(dt);
  adaptResolution(now);
}

// keep the frame rate smooth: lower the render resolution when the GPU struggles
const perf = { cullT: 0, bad: 0, good: 0, frames: 0, t0: performance.now(), pr: Math.min(devicePixelRatio, 1.5), max: Math.min(devicePixelRatio, 1.5) };
function adaptResolution(now) {
  perf.frames++;
  const el = now - perf.t0;
  if (el < 1000) return;
  const fps = (perf.frames * 1000) / el;
  perf.frames = 0; perf.t0 = now;
  let pr = perf.pr;
  if (perf.trial) {
    // did the lower resolution actually help? If not, the display is just capped (e.g. 30 Hz): undo it
    if (fps < perf.trial.fps * 1.12) { pr = perf.trial.from; perf.lockUntil = now + 30000; }
    perf.trial = null;
  } else {
    perf.bad = fps < 45 ? perf.bad + 1 : 0; perf.good = fps > 58 ? perf.good + 1 : 0;
    if (perf.bad >= 3 && pr > 0.6 && !(now < perf.lockUntil)) { perf.trial = { from: pr, fps }; pr = Math.max(0.6, pr - 0.25); perf.bad = 0; }
    else if (perf.good >= 6 && pr < perf.max) { pr = Math.min(perf.max, pr + 0.25); perf.good = 0; }
  }
  if (pr !== perf.pr) {
    perf.pr = pr; renderer.setPixelRatio(pr);
    if (S.composer) { S.composer.setPixelRatio(pr); S.composer.setSize(innerWidth, innerHeight); }
  }
  window.__hm.fps = Math.round(fps);
}
requestAnimationFrame(frame);

// debug hooks (used for automated testing)
window.__hm.S = S; window.__hm.keys = keys; window.__hm.runScare = (type) => runScare(performance.now() / 1000, type);
