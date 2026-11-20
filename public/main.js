// CHUDAIL — client
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CELL, WALL_H, FLOOR_H, LEVELS, TALISMANS, DIFFICULTY, GHOST_TYPES, LEVEL_NAMES, generateMap, mapSignature, resolveCircle, pushOutBox, lineOfSight, isWall, heightAt, stairTransition, staticColliders } from '/shared/map.js';
import { AudioSys } from './audio.js';
import { buildWorld, disposeScene } from './world.js';
import { createMonster, createAvatar, createCrawler, loadModels, CHARACTERS, ensureChar, charLoaded, addXray, getModel } from './entities.js';
import * as TX from './textures.js';
import { SETTINGS, is, makeHeld, initSettings, openSettings, closeSettings, settingsOpen } from './settings.js';
import { newRun, track as trackAch, runSummary } from './achievements.js';
import { createVoice } from './voice.js';
import { IS_TOUCH, initTouch } from './touch.js';
import { preloadIntro, playIntro, playOutro } from './intro.js';
import { buildStatues } from './statues.js';
import { GLTFLoader as OutroLoader } from 'three/addons/loaders/GLTFLoader.js';

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
// ---------------- screen fx: flashes, strobes, glitches ----------------
// FX.calm (lobby checkbox) turns strobes into soft single fades for photosensitive players
const FX = { calm: false };
function fxFlash(color = '#fff', peak = 0.9, ms = 140) {
  const el = $('fxflash');
  if (FX.calm) { peak = Math.min(peak, 0.22); ms = Math.max(ms, 320); }
  el.style.transition = 'none'; el.style.background = color; el.style.opacity = peak;
  void el.offsetWidth;
  el.style.transition = `opacity ${ms}ms ease-out`; el.style.opacity = 0;
}
function fxGlitch(ms = 120) {
  if (FX.calm) return;
  const looks = ['invert(1) contrast(1.4)', 'contrast(3) saturate(0) brightness(1.5)', 'hue-rotate(160deg) saturate(4)', 'contrast(2.2) sepia(1) hue-rotate(-45deg) saturate(6)'];
  canvas.style.filter = looks[(Math.random() * looks.length) | 0];
  canvas.style.transform = `translateX(${rnd(-28, 28)}px) skewX(${rnd(-6, 6)}deg) scale(1.04)`;
  setTimeout(() => { canvas.style.filter = ''; canvas.style.transform = ''; }, ms);
}
function fxFace(ms = 70, opacity = 0.85) { // one subliminal frame of her face
  const ff = $('faceflash');
  if (!ff.firstChild) ff.appendChild(scareCanvas());
  if (FX.calm) opacity *= 0.3;
  const c = ff.firstChild;
  c.style.transform = `translate(-50%,-50%) scale(${rnd(1, 1.4)}) rotate(${rnd(-7, 7)}deg)`;
  c.style.filter = Math.random() < 0.35 ? 'invert(1) contrast(1.5)' : `contrast(${rnd(1.3, 2.2)}) saturate(${rnd(0.5, 2)})`;
  ff.style.display = 'block'; ff.style.opacity = opacity;
  clearTimeout(fxFace.t); fxFace.t = setTimeout(() => (ff.style.display = 'none'), ms);
}

const S = {
  phase: 'menu', myId: 0, myColor: '#fff', name: '', myChar: (() => { try { return localStorage.getItem('hm_char') || ''; } catch { return ''; } })(),
  lobby: [], players: new Map(), map: null, world: null, scene: null, composer: null, post: null,
  monster: null, ghost: null, mon: null,
  me: null, progress: 0, placed: [null, null, null, null, null], exitOpen: false, difficulty: 'normal', camL: 0,
  fear: 0, red: 0, black: 0, shake: 0,
  flickUntil: 0, lightsOutUntil: 0, timers: [], nextScare: 0, ghostState: null,
  tune: { fl: 135, exposure: 1.45, hemi: 0.9, fog: 0.058, bulb: 1.6, remote: 60 },
  clues: new Set(), reading: null,
  spectating: null, jumpscare: false, sens: 1.2, lastSend: 0, prompt: null, escSent: 0,
};
const keys = {};
const held = makeHeld(keys); // held('sprint'): honours the player's key bindings (settings.js)

// ---------------- networking ----------------
let ws = null;
const send = (m) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };
// report to the game server's log (we cannot see a friend's phone): load steps, errors, the device
function clog(msg) { try { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'clog', m: String(msg) })); } catch {} }
addEventListener('error', (e) => clog(`ERROR ${e.message} @ ${(e.filename || '').split('/').pop()}:${e.lineno}`));
addEventListener('unhandledrejection', (e) => clog(`PROMISE ERROR ${e.reason && (e.reason.message || e.reason)}`));
canvas.addEventListener('webglcontextlost', () => clog('WEBGL CONTEXT LOST (graphics memory ran out?)'));
function deviceInfo() {
  let tex = '?'; try { const gl = renderer.getContext(); tex = gl.getParameter(gl.MAX_TEXTURE_SIZE); } catch {}
  return `device: ${navigator.userAgent.slice(0, 140)} | screen ${screen.width}x${screen.height} dpr ${devicePixelRatio} | touch ${IS_TOUCH} | quality ${SETTINGS.quality} | maxTex ${tex} | mem ${navigator.deviceMemory || '?'}GB`;
}
function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
  ws.onopen = () => { send(S.spectator ? { t: 'join', spectator: true } : { t: 'join', name: S.name, char: S.myChar }); clog(deviceInfo()); };
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
      S.lobby = m.players; if (m.difficulty) S.difficulty = m.difficulty; renderLobby();
      if (m.countdown > 0 && !S.countdownTimer && S.phase === 'lobby') showCountdown(m.countdown);
      if (m.publicUrl && m.publicUrl !== S.publicUrl) { S.publicUrl = m.publicUrl; loadShare(); }
      if (m.phase === 'lobby') {
        if (S.phase !== 'lobby') { leaveGame(); S.phase = 'lobby'; showScreen('lobby'); }
      }
      break;
    case 'countdown': showCountdown(m.cancel ? 0 : m.secs, m.by, m.cancel); break;
    case 'start': showCountdown(0); startGame(m); break;
    case 'snap': applySnap(m); break;
    case 'rtc': S.voice?.onSignal(m.from, m.data); break;
    case 'ev': onEvent(m); if (S.run) trackAch(S.run, m).forEach(achToast); break;
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
  const dEl = $('diff');
  const tips = { easy: 'slower, half-blind, plenty of supplies, no crawler', normal: 'the way it was meant to be', hard: 'faster, sharper ears, fewer supplies', nightmare: 'she hears everything. good luck.' };
  dEl.innerHTML = Object.entries(DIFFICULTY).map(([k, d]) => `<button data-k="${k}" class="${k === S.difficulty ? 'on' : ''}">${d.label}</button>`).join('') + `<div class="tip">${tips[S.difficulty] || ''}</div>`;
  dEl.querySelectorAll('button').forEach((b) => { b.disabled = !!S.spectator; b.onclick = () => { send({ t: 'difficulty', key: b.dataset.k }); audio.click(); }; });
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
  if (!audio.samples) audio.loadSample('scream', '/sounds/scream.mp3'); audio.loadSteps();
  $('joinBtn').disabled = true; $('joinBtn').textContent = 'Opening the gates…';
  S.phase = 'joining';
  connect(); loadShare();
};
$('specBtn').onclick = () => {
  if (!confirm('Watch as a hidden spectator? You will NOT be a player: you only watch, invisible. (To play, press Enter the asylum.)')) return;
  S.spectator = true; S.name = 'Spectator';
  audio.init(); if (!audio.samples) audio.loadSample('scream', '/sounds/scream.mp3'); audio.loadSteps();
  $('specBtn').disabled = true; $('joinBtn').disabled = true;
  S.phase = 'joining'; connect(); loadShare();
};
$('name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('joinBtn').click(); });
$('startBtn').onclick = () => { audio.init(); send({ t: 'start' }); };
// Begin starts a 5 s countdown everyone sees; anyone can stop it (friends still coming in)
function showCountdown(secs, by, cancelled) {
  let el = $('countdown');
  if (!el) {
    el = document.createElement('div'); el.id = 'countdown';
    el.innerHTML = '<div class="cn"></div><div class="cb"></div><button>WAIT! not everyone is here</button>';
    el.querySelector('button').onclick = () => send({ t: 'cancelStart' });
    document.body.appendChild(el);
  }
  clearInterval(S.countdownTimer); S.countdownTimer = null;
  if (!secs) { el.classList.remove('show'); if (cancelled) message(`${by} stopped the countdown.`); return; }
  audio.init();
  const end = performance.now() + secs * 1000;
  el.querySelector('.cb').textContent = by ? `${by} pressed Begin. Everyone in the lobby goes in together.` : 'The game is about to start.';
  const tick = () => { const left = Math.max(0, Math.ceil((end - performance.now()) / 1000)); el.querySelector('.cn').textContent = left ? `STARTING IN ${left}` : 'HERE WE GO'; };
  tick(); el.classList.add('show'); S.countdownTimer = setInterval(tick, 200);
}
// settings (public/settings.js): applied now and whenever they change
function applySettings(k) {
  S.sens = SETTINGS.sens; FX.calm = !!SETTINGS.calm; audio.setVolume(SETTINGS.volume);
  if (!k || k === 'quality') {
    perf.max = SETTINGS.quality === 'low' ? 0.7 : SETTINGS.quality === 'medium' ? 1 : Math.min(devicePixelRatio, 1.5);
    if (perf.pr > perf.max) { perf.pr = perf.max; renderer.setPixelRatio(perf.pr); if (S.composer) { S.composer.setPixelRatio(perf.pr); S.composer.setSize(innerWidth, innerHeight); } }
    renderer.shadowMap.enabled = SETTINGS.quality !== 'low'; // takes effect in the next game
  }
  window.dispatchEvent(new CustomEvent('cb-settings', { detail: k }));
}
initSettings(applySettings);
window.addEventListener('cb-settings', (e) => {
  if (e.detail === 'voice' && S.phase === 'playing' && !S.spectator) {
    if (!SETTINGS.voice) { S.voice?.stop(); S.voice = null; }
    else if (!S.voice) { S.voice = createVoice({ audio, send, settings: SETTINGS, myId: S.myId }); S.voice.start().then(() => { for (const id of S.players.keys()) S.voice?.call(id); }); }
  }
});
$('lobbySettings').onclick = (e) => { e.stopPropagation(); openSettings(); };
$('pauseSettings').onclick = (e) => { e.stopPropagation(); openSettings(); };

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
  if (is(e, 'light') && S.me?.alive && !S.me.escaped && !S.me.hidden) {
    if (S.me.battery > 0) { S.me.fl = !S.me.fl; audio.click(); }
  }
  if (is(e, 'ping') && S.me?.alive && !S.me.escaped && !S.me.hidden) { doPing(); return; }
  if (is(e, 'map') && S.me?.alive && !S.me.escaped) { if (S.bpOpen) closeBlueprint(); else if (S.bp?.holder === S.myId) openBlueprint(S.me.L); else if (S.bp) message(S.bp.holder ? `${whoName(S.bp.holder)} has the blueprint.` : 'The blueprint of the house is on a table by the front door.'); return; }
  if (S.bpOpen && ['Digit1', 'Digit2', 'Digit3'].includes(e.code)) { openBlueprint({ Digit1: -1, Digit2: 0, Digit3: 1 }[e.code]); return; }
  if ((is(e, 'interact') || e.code === 'Escape') && S.reading) { closeNote(); return; }
  if (is(e, 'interact') && S.me?.hidden) { send({ t: 'unhide' }); return; }
  if (is(e, 'interact') && S.prompt && S.prompt.note) { openNote(S.prompt.id); S.prompt = null; return; }
  if (is(e, 'interact') && S.prompt && S.prompt.place) { send({ t: 'place', slot: S.prompt.slot }); S.prompt = null; return; }
  if (is(e, 'interact') && S.prompt && !S.prompt.revive) {
    if (S.prompt.hide) send({ t: 'hide', id: S.prompt.id }); else if (S.prompt.id === 'bp') send({ t: 'bp' }); else send({ t: 'pickup', id: S.prompt.id });
    S.prompt = null;
  }
  if ((e.ctrlKey || e.metaKey) && ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyF', 'KeyE'].includes(e.code)) e.preventDefault();
  if (S.spectator && /^Digit[0-6]$/.test(e.code)) {
    const n = +e.code.slice(5); const list = [...S.players.values()].filter((p) => !p.escaped);
    S.droneFollow = n === 0 ? null : list[n - 1]?.id || null;
    if (!S.droneFollow) for (const p of S.players.values()) p.avatar.userData.setShown(!p.hid);
  }
  if (is(e, 'bell') && S.me?.alive && !S.me.escaped && !S.me.hidden) {
    if (S.me.bells > 0) send({ t: 'bell' }); else message('You have no spirit bells.');
  }
  if (is(e, 'interact') && S.prompt && S.prompt.revive && !S.reviving) { S.reviving = { start: performance.now(), id: S.prompt.target }; audio.whisper(0, 0.25, 1.2); }
  if (e.code === 'Tab') e.preventDefault();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas || !S.me || (!S.me.alive && !S.spectator) || S.jumpscare) return;
  applyLook(e.movementX, e.movementY, 0.0021);
});
function applyLook(dx, dy, scale) {
  const k = scale * S.sens;
  S.me.yaw -= dx * k;
  S.me.pitch = clamp(S.me.pitch - dy * k * (SETTINGS.invertY ? -1 : 1), S.spectator ? -1.55 : -1.45, 1.45);
  if (S.me.hidden) { const bed = S.world.hides.get(S.me.hidden)?.type === 'bed'; S.me.yaw = S.me.hideYaw + clamp(angDiff(S.me.yaw, S.me.hideYaw), bed ? -0.8 : -0.55, bed ? 0.8 : 0.55); S.me.pitch = clamp(S.me.pitch, bed ? -0.1 : -0.35, bed ? 0.12 : 0.3); }
}
// "in play": the mouse is captured, or on a phone the player tapped in
const inPlay = () => document.pointerLockElement === canvas || (IS_TOUCH && S.touchActive);
const tapText = (t) => (IS_TOUCH ? t.replace('CLICK', 'TAP') : t);
if (IS_TOUCH) document.body.classList.add('touch');
const TC = IS_TOUCH ? initTouch({
  keys, settings: SETTINGS, active: () => S.touchActive,
  look: (dx, dy) => { if (S.phase === 'playing' && S.me && (S.me.alive || S.spectator) && !S.jumpscare) applyLook(dx, dy, 0.0045); },
  onPause: () => { S.touchActive = false; TC.show(false); if (S.phase === 'playing') showScreen('resume'); },
}) : null;
addEventListener('mousedown', () => {
  if (S.phase === 'playing' && inPlay() && S.spectating !== null) nextSpectate();
});
$('resume').onclick = () => {
  if (settingsOpen()) return; audio.init();
  if (S.phase !== 'playing') return;
  if (IS_TOUCH) { S.touchActive = true; TC.show(true); onLocked(); } else canvas.requestPointerLock();
};
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (S.phase === 'playing' && !locked) showScreen('resume');
  else if (S.phase === 'playing' && locked) onLocked();
});
function onLocked() {
  if (S.wakePending) clog('woke up: in the game');
  {
    showScreen(''); $('brief').style.display = 'none'; $('resume').querySelector('h2').textContent = tapText('CLICK TO RESUME');
    if (S.wakePending && S.me) { S.wakePending = false; S.me.wake = 0; wakeUpSequence(); $('eyes').className = 'open'; canvas.style.transition = 'filter 4.5s ease-out'; canvas.style.filter = 'blur(9px) brightness(0.6)'; requestAnimationFrame(() => requestAnimationFrame(() => (canvas.style.filter = ''))); setTimeout(() => { canvas.style.transition = ''; $('eyes').className = ''; }, 5200); }
  }
}
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  if (S.composer) S.composer.setSize(innerWidth, innerHeight);
  HorrorShader.uniforms.res.value.set(innerWidth, innerHeight);
});

// ---------------- game setup ----------------
let flashlight, flashTarget, playerGlow, lightPool = [], dust = null;
const flDir = new THREE.Vector3(0, 0, -1);

// ---------------- loading: the house lets you in ----------------
const LOAD_LINES = [
  'she has been waiting for you', 'count the doors. she already has', 'do not run. she hears running',
  'her feet point backwards', 'the star in the basement is hungry', 'someone is breathing behind the wallpaper',
  'they never found the night nurses', 'if she says your name, do not answer', 'she is already in the house',
  'keep your light low', 'five gifts. five points. one way out', 'the last group did not come back up',
];
let loadFx = null;
function startLoadingFx(quiet = false) {
  stopLoadingFx();
  const el = $('loading'), line = $('lline'), prog = $('lprog');
  try { audio.init(); } catch {}
  const face = scareCanvas(); face.className = 'lface'; el.prepend(face);
  const lines = LOAD_LINES.slice().sort(() => Math.random() - 0.5);
  const st = { t0: performance.now(), p: 0, done: false, ids: [], face, k: 0 };
  const every = (ms, fn) => st.ids.push(setInterval(fn, ms));
  const type = () => {
    const txt = lines[st.k++ % lines.length]; let n = 0; line.textContent = '';
    clearInterval(st.typer); st.typer = setInterval(() => { line.textContent = txt.slice(0, ++n); if (n >= txt.length) clearInterval(st.typer); }, 42);
  };
  type(); every(2300, type);
  every(120, () => { st.p += (st.done ? 100 - st.p : (88 - st.p) * 0.035); prog.style.width = st.p.toFixed(1) + '%'; });
  // (quiet: the intro cut scene comes next, so no ghostly sounds before it)
  if (!quiet) every(900, () => { try { audio.heartbeat(0.35 + Math.min(0.4, (performance.now() - st.t0) / 12000)); } catch {} });
  // she drifts up out of the dark now and then
  every(2600, () => {
    if (Math.random() < 0.55) { face.style.opacity = rnd(0.05, 0.12).toFixed(2); setTimeout(() => (face.style.opacity = 0), 900); }
  });
  if (!quiet) setTimeout(() => { try { audio.whisper(rnd(-0.8, 0.8), 0.35, 2.2); audio.rumble(0.45, 4); } catch {} }, 700);
  // one subliminal frame, once
  setTimeout(() => {
    if (!loadFx || FX.calm) return;
    face.style.transition = 'none'; face.style.opacity = 0.75; face.style.filter = 'invert(1) contrast(2)';
    if (!quiet) try { audio.stinger(0.35); } catch {}
    setTimeout(() => { face.style.opacity = 0; face.style.filter = ''; face.style.transition = ''; }, 60);
  }, rnd(1900, 3100));
  loadFx = st;
}
function stopLoadingFx() {
  if (!loadFx) return;
  loadFx.ids.forEach(clearInterval); clearInterval(loadFx.typer); loadFx.face.remove(); loadFx = null;
}

function startGame(m) {
  leaveGame();
  showScreen('loading');
  S.phase = 'loading';
  startLoadingFx(!!m.intro && !S.spectator);
  const t0 = performance.now();
  // let the dread build for a few seconds even on a fast machine
  const go = () => { if (loadFx) loadFx.done = true; setTimeout(() => buildGame(m), Math.max(250, 4200 - (performance.now() - t0))); };
  const fonts = Promise.all(['64px "IM Fell English SC"', 'bold 54px "Courier Prime"', '92px "Rubik Wet Paint"', '20px "Homemade Apple"'].map((f) => document.fonts.load(f).catch(() => {})));
  const chars = Promise.all(m.players.map((p) => ensureChar(p.char)));
  // the intro cut scene plays only at the very start of a game (not for late joiners or hidden spectators)
  S.introAssets = null;
  // phones (Low quality) skip the cut scenes: holding the movie, the car scene and the drag scene on top of the house
  // is more memory than a phone browser allows
  const wantIntro = m.intro && !S.spectator && SETTINGS.quality !== 'low';
  clog(`start received: loading (intro ${wantIntro ? 'yes' : 'no'})`);
  const intro = wantIntro ? preloadIntro().then((a) => (S.introAssets = a)) : null;
  Promise.race([Promise.all([loadModels(), fonts, chars, intro]), new Promise((r) => setTimeout(() => r('timeout'), wantIntro ? 25000 : 9000))]).then((r) => { clog(r === 'timeout' ? 'assets: timed out, going on' : 'assets loaded'); setTimeout(go, 30); });
}

function buildGame(m) {
  clog('building the house');
  const map = (S.map = generateMap(m.seed));
  S.mapBad = m.sig != null && mapSignature(map) !== m.sig;
  if (S.mapBad) console.error('map out of sync with the server', mapSignature(map), m.sig);
  const scene = (S.scene = new THREE.Scene());
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.FogExp2(0x000000, 0.072);
  scene.add(camera);
  S.world = buildWorld(scene, map);
  try { S.statues = buildStatues({ map, world: S.world, seed: m.seed, lite: SETTINGS.quality === 'low' }); } catch (e) { console.warn('statues failed', e); S.statues = null; }
  buildBlueprint(map, m.bp);
  document.body.classList.add('ingame');
  S.ghostType = GHOST_TYPES[m.ghostType] ? m.ghostType : 'chudail';
  S.voice?.stop(); S.voice = null;
  if (!S.spectator && SETTINGS.voice) {
    S.voice = createVoice({ audio, send, settings: SETTINGS, myId: S.myId });
    audio.init();
    S.voice.start().then(() => { for (const id of S.players.keys()) S.voice?.call(id); });
  }
  S.run = S.spectator ? null : newRun({ myId: S.myId, solo: m.players.length === 1, difficulty: m.difficulty, ghostType: S.ghostType });

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
  S.mon = { L: map.monsterSpawn.L, x: map.monsterSpawn.x, z: map.monsterSpawn.z, yaw: 0, tx: map.monsterSpawn.x, tz: map.monsterSpawn.z, tyaw: 0, state: 'dormant', target: 0, speed: 0, vis: 0, step: 0, lit: false };
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
  S.progress = m.progress || 0; S.exitOpen = m.exitOpen; S.stage = m.stage || 'items'; S.difficulty = m.difficulty || 'normal';
  S.placed = m.placed || [null, null, null, null, null];
  S.me.L = mine.L ?? 0; S.me.items = (mine.items || []).slice();
  for (const id of m.taken) takeItem(id);
  for (const mv of m.moved || []) { const tl = S.world.talismans.get(mv.id); if (tl && !tl.taken) tl.moveTo(mv.x, mv.z, mv.L); }
  S.placed.forEach((id, slot) => { if (id) { takeItem(id); S.world.shrine.setPlaced(slot, S.world.talismans.get(id).kind); } });
  if (S.stage !== 'items') S.world.shrine.setActive();
  S.world.exit.setProgress(S.placed.filter(Boolean).length, S.exitOpen);
  buildIcons();

  S.composer = new EffectComposer(renderer);
  S.composer.addPass(new RenderPass(scene, camera));
  S.composer.addPass(new OutputPass());
  S.post = new ShaderPass(HorrorShader); S.composer.addPass(S.post);

  (S.pings || []).forEach((p) => p.el.remove()); S.pings = []; $('ntags')?.replaceChildren();
  S.fear = 0; S.red = 0; S.black = 1; S.shake = 0; S.timers = []; S.anims = []; S.spectating = null; S.jumpscare = false; S.ghostState = null;
  S.nextScare = performance.now() / 1000 + rnd(30, 45);
  S.flickUntil = 0; S.lightsOutUntil = 0; S.torchCtl = null;
  S.clues = new Set(); S.reading = null; renderClues();
  S.phase = 'playing';
  $('hud').classList.add('show'); $('spectate').style.display = 'none';
  $('bars').style.display = S.spectator ? 'none' : '';
  $('specHud').style.display = S.spectator ? 'block' : 'none';
  setObjective();
  warmUp(scene);
  audio.init();
  stopLoadingFx();
  if (S.introAssets && m.intro && !S.spectator) {
    // the drive, the truck... then you wake up on the floor of the house
    showScreen(''); $('hud').classList.remove('show');
    clog('intro playing');
    S.intro = playIntro({
      renderer, assets: S.introAssets, audio, calm: FX.calm,
      players: [...m.players].sort((a, b) => a.id - b.id), meId: S.myId,
      onDone: () => { S.intro = null; $('hud').classList.add('show'); enterHouse(m, true); },
    });
    return;
  }
  clog(`house built (${renderer.info.memory.textures} textures, ${renderer.info.memory.geometries} geometries)`);
  enterHouse(m, !!m.intro && !S.spectator); // no cut scene (phones): still wake up on the floor, the line, the objectives
}

function enterHouse(m, woke) {
  audio.startAmbience(); audio.startMonsterVoice();
  if (woke && S.me && !S.spectator) { S.me.eye = 0.3; S.wakePending = true; } // lying on the floor until you click in
  else fxFace(70, 0.7);
  // the door shuts behind you
  fxFlash('#7a0000', woke ? 0.4 : 0.8, 700); if (!woke) { audio.stinger(0.6); audio.bang(S.me ? S.me.x : 0, S.me ? S.me.z : 0, 1); }
  showScreen('resume');
  $('resume').querySelector('h2').textContent = tapText(woke && !S.spectator ? 'CLICK TO WAKE UP' : 'CLICK TO ENTER');
  if (!S.spectator && !woke) showBriefing(); else $('brief').style.display = 'none';
  if (!S.spectator && !woke) setTimeout(() => {
    if (S.mapBad) { message('This page is out of date with the server. Refresh the page (Ctrl/Cmd + Shift + R).', 'red'); return; }
    message(woke ? 'You wake up on a cold floor. The car... the truck... where are the others?' : 'The front door slammed shut behind you.');
    setTimeout(() => message('The star in the basement wants five gifts. Find the riddles.', 'red'), 2500);
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
  avatar.position.set(p.x, heightAt(S.map, p.L ?? 0, p.x, p.z), p.z);
  S.scene.add(avatar);
  if (p.char && !charLoaded(p.char)) ensureChar(p.char).then(() => {
    const r = S.players.get(p.id); if (!r || !S.scene) return;
    const fresh = createAvatar(p.name, p.color, p.char);
    fresh.position.copy(r.avatar.position); fresh.rotation.copy(r.avatar.rotation);
    S.scene.remove(r.avatar); S.scene.add(fresh); r.avatar = fresh; r.deadShown = false;
  });
  const r = { L: p.L ?? 0, id: p.id, name: p.name, color: p.color, char: p.char, alive: p.alive !== false, escaped: !!p.escaped, avatar, x: p.x, z: p.z, yaw: 0, pitch: 0, tx: p.x, tz: p.z, tyaw: 0, tpitch: 0, fl: true, cr: false, mv: false, sp: false, step: 0, deadShown: false };
  if (!r.alive) { avatar.userData.setDead(); r.deadShown = true; }
  if (r.escaped) { avatar.userData.setShown(false); avatar.userData.label.visible = false; }
  S.players.set(p.id, r);
}

function leaveGame() {
  if (S.intro) { S.intro.abort(); S.intro = null; }
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
  const n = S.placed.filter(Boolean).length;
  for (let k = 0; k < TALISMANS; k++) { const d = document.createElement('div'); d.className = 'ic' + (k < n ? ' got' : ''); d.textContent = '⛧'; el.appendChild(d); }
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
    const [id, x, z, yaw, pitch, fl, cr, alive, esc, mv, sp, hid, sn, L] = a;
    if (id === S.myId) continue;
    let r = S.players.get(id);
    if (!r) continue;
    const nowT = performance.now();
    r.buf = r.buf || [];
    if ((r.buf.length && Math.hypot(r.buf[r.buf.length - 1].x - x, r.buf[r.buf.length - 1].z - z) > 6) || r.L !== L) r.buf.length = 0;
    r.L = L ?? 0;
    pushSnap(r.buf, { t: nowT, x, z, yaw, pitch });
    r.tx = x; r.tz = z; r.tyaw = yaw; r.tpitch = pitch; r.fl = !!fl; r.cr = !!cr; r.mv = !!mv; r.sp = !!sp; r.sn = !!sn;
    r.escaped = !!esc; r.hid = hid || null;
    if (!alive && r.alive) { r.alive = false; }
  }
  if (m.m) {
    const [x, z, yaw, state, target, speed, lit, lunge, L, crawl] = m.m;
    if (S.mon.L !== L && S.mon.buf) S.mon.buf.length = 0;
    S.mon.L = L ?? 0;
    Object.assign(S.mon, { tx: x, tz: z, tyaw: yaw, state, target, speed, lit: !!lit, lunge: !!lunge, crawl: crawl || 0 });
    const mb = (S.mon.buf = S.mon.buf || []);
    if (mb.length && Math.hypot(mb[mb.length - 1].x - x, mb[mb.length - 1].z - z) > 6) mb.length = 0;
    pushSnap(mb, { t: performance.now(), x, z, yaw, pitch: 0 });
  }
  if (m.c) {
    const [x, z, yaw, state, target, L] = m.c;
    if (S.crawl.L !== L) S.crawl.buf = [];
    S.crawl.L = L ?? 0;
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
        const tl = S.world.talismans.get(m.id);
        S.progress = m.progress;
        if (m.by === S.myId) {
          S.me.items = m.items;
          audio.bell(); audio.stinger(0.35); S.red = 0.7; S.shake = 0.4;
          message(`You took the ${tl.name}. Bring it to the star in the basement.`);
          setTimeout(() => message('She knows where you are.', 'red'), 900);
          setTimeout(() => audio.whisper(rnd(-0.6, 0.6), 0.35, 2.2), 600);
        } else {
          audio.bell();
          message(`${nameOf(m.by)} found the ${tl.name}`);
        }
        renderClues(); setObjective();
      } else if (kind === 'r' && m.by === S.myId) {
        S.me.revives = m.revives; audio.holyBell(S.me.x, S.me.z); message(`Aatma candle (${m.revives}). Hold E over a fallen friend to bring them back.`);
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
        audio.screech(S.mon.x, S.mon.z, 0.9); audio.stinger(0.55); S.shake = m.charge ? 1 : 0.6; S.red = m.charge ? 0.55 : 0.35;
        if (m.charge) { fxFlash('#fff', 0.35, 120); fxGlitch(120); S.stareUntil = 0; }
        message('IT SEES YOU. RUN.', 'red');
      } else if (d < 25) audio.screech(S.mon.x, S.mon.z, 0.6);
      break;
    }
    case 'kill': {
      if (m.id === S.myId) { if (S.me.hidden) { const h = S.world.hides.get(S.me.hidden); if (h) { h.busy = 1.2; h.door.visible = true; } $('vent').classList.remove('show'); S.me.hidden = null; S.me.x = m.x; S.me.z = m.z; } doJumpscare(m.mx, m.mz); break; }
      const r = S.players.get(m.id);
      if (r) { r.alive = false; r.tx = m.x; r.tz = m.z; }
      audio.distantScream(m.x, m.z);
      addBlood(m.x, m.z, m.L ?? 0);
      message(`${nameOf(m.id)} was taken.`, 'red');
      break;
    }
    case 'escaped': {
      if (m.id === S.myId) {
        S.me.escaped = true; S.black = 0; S.whiteOut = 1;
        message('You escaped Ashgrove. She will not follow you.');
        audio.setChase(false);
        playEnding();
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
        Object.assign(S.me, { L: m.L ?? S.me.L, alive: true, x: m.x, z: m.z, hidden: null, battery: Math.max(S.me.battery, 50), fl: true, stamina: 100 });
        S.spectating = null; S.jumpscare = false; S.red = 0; S.black = 0.6;
        $('spectate').style.display = 'none'; $('death').classList.remove('show');
        showScreen(inPlay() ? '' : 'resume');
        message(`${nameOf(m.by)} brought you back. Don't waste it.`);
      } else {
        const r = S.players.get(m.id);
        if (r) {
          S.scene.remove(r.avatar);
          r.avatar = createAvatar(r.name, r.color, r.char); r.L = m.L ?? r.L; r.avatar.position.set(m.x, heightAt(S.map, r.L, m.x, m.z), m.z); S.scene.add(r.avatar);
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
      if (m.stage === 'escape') outroCar(); // fetch the car for the ending now
      S.stage = m.stage;
      if (m.stage === 'lure') {
        S.world.shrine.setActive();
        audio.rumble(1, 5); audio.whisper(0, 0.5, 3); S.shake = 1; S.red = 0.6;
        message('THE STAR IS AWAKE', 'red');
        setTimeout(() => message('Bring her to it. She cannot touch you inside the star.', 'red'), 2000);
        for (const b of S.world.bulbs) { b.color.set(0xff2010); b.flicker = true; }
      } else if (m.stage === 'escape') {
        S.exitOpen = true; S.world.exit.setProgress(TALISMANS, true);
        setTimeout(() => message('THE FRONT DOOR IS OPEN. GET OUT!', 'red'), 2500);
      }
      setObjective(); renderClues();
      break;
    }
    case 'placed': {
      const tl = S.world.talismans.get(m.id);
      S.placed[m.slot] = m.id; takeItem(m.id);
      S.world.shrine.setPlaced(m.slot, tl.kind);
      if (m.by === S.myId) S.me.items = m.items;
      audio.bell(); audio.stinger(0.3); audio.whisper(rnd(-0.5, 0.5), 0.3, 1.6);
      message(`${nameOf(m.by)} placed the ${tl.name} on the star (${m.count}/${TALISMANS})`);
      S.world.exit.setProgress(m.count, false);
      buildIcons(); setObjective(); renderClues();
      break;
    }
    case 'ping': showPing(m); break;
    case 'bp': { // the blueprint changed hands, fell, or went back on its table
      S.bp = { holder: m.holder, x: m.x, z: m.z, L: m.L, onTable: m.onTable };
      placeBlueprint();
      if (m.why === 'take') message(m.by === S.myId ? 'You took the house blueprint. Press M to read it.' : `${nameOf(m.by)} took the house blueprint.`);
      else if (m.why === 'drop') { message(`The blueprint fell where ${nameOf(m.by)} was.`); if (m.by === S.myId) closeBlueprint(); }
      else if (m.why === 'return') { message('The blueprint is back on its table by the front door.'); if (m.by === S.myId) closeBlueprint(); }
      setObjective();
      break;
    }
    case 'jump': { const r = S.players.get(m.id); if (r && m.id !== S.myId) r.jt = 0; break; }
    case 'stare': { // you looked at her down the hall, and she stopped to look back
      if (m.id === S.myId) { audio.stareDrone(2.6); S.stareUntil = performance.now() / 1000 + 3.2; }
      break;
    }
    case 'vanish': {
      if (S.me && (m.L ?? 0) === S.me.L && Math.hypot(m.x - S.me.x, m.z - S.me.z) < 30) {
        audio.vanish(m.x, m.z); fxGlitch(150); S.lightsOutUntil = Math.max(S.lightsOutUntil || 0, performance.now() / 1000 + 0.35);
      }
      S.stareUntil = 0;
      break;
    }
    case 'mdrop': { // she lets go of the ceiling / wall right in front of someone
      if (S.me && (m.L ?? 0) === S.me.L && Math.hypot(m.x - S.me.x, m.z - S.me.z) < 12) {
        audio.bang(m.x, m.z, 0.9); audio.screech(m.x, m.z, 0.7); S.shake = Math.max(S.shake, 0.9); S.red = Math.max(S.red, 0.5);
        if (Math.hypot(m.x - S.me.x, m.z - S.me.z) < 5) { fxFlash('#fff', 0.55, 180); fxGlitch(110); }
      }
      break;
    }
    case 'drop': {
      const tl = S.world.talismans.get(m.id);
      if (tl) { tl.taken = false; tl.group.visible = true; tl.moveTo(m.x, m.z, m.L); }
      if (m.by === S.myId && S.me) S.me.items = [];
      message(`The ${tl ? tl.name : 'item'} was dropped where ${nameOf(m.by)} fell.`);
      setObjective();
      break;
    }
    case 'bound': {
      S.mon.boundT = 0.001;
      S.world.shrine.bind();
      audio.scream(); audio.rumble(1, 7); audio.stinger(1); S.shake = 2; S.red = 1; S.whiteOut = 0.6;
      message('SHE IS BOUND', 'red');
      break;
    }
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
    case 'joined': S.voice?.call(m.id); if (!S.scene) { (S.pendingJoins = S.pendingJoins || []).push(m); break; } addPlayer({ id: m.id, name: m.name, color: m.color, char: m.char, x: S.map.spawns[0][0], z: S.map.spawns[0][1] }); message(`${m.name} entered the asylum`); break;
    case 'left': {
      S.voice?.drop(m.id);
      const r = S.players.get(m.id);
      r?.tagEl?.remove();
      if (r) { S.scene.remove(r.avatar); S.players.delete(m.id); }
      if (S.spectating === m.id) nextSpectate();
      message(`${m.name} left`);
      break;
    }
  }
}

function addBlood(x, z, L = 0) {
  const mats = S.world.bloodMats;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), mats[Math.floor(Math.random() * mats.length)]);
  mesh.rotation.x = -Math.PI / 2; mesh.rotation.z = Math.random() * 6; mesh.position.set(x, 0.014, z); S.world.levelGroups[L].add(mesh);
}

// the car for the ending (the intro already has it; late joiners load it when the escape opens)
function outroCar() {
  if (S.introAssets && S.introAssets.car) return Promise.resolve(S.introAssets.car);
  if (!S.outroCarP) S.outroCarP = new Promise((res) => new OutroLoader().load('/models/intro_car.glb', (g) => res(g.scene), undefined, () => res(null)));
  return S.outroCarP;
}
// you got out: everyone who made it drives away in the wrecked car, then you watch the others
function playEnding() {
  const after = () => { S.intro = null; if (S.pendingEnd) { const e = S.pendingEnd; S.pendingEnd = null; onEnd(e); } else if (S.phase === 'playing') { $('hud').classList.add('show'); startSpectate(); } };
  if (document.pointerLockElement) document.exitPointerLock();
  outroCar().then((car) => {
    if (!car || S.phase !== 'playing' || S.spectator) { setTimeout(after, 1500); return; }
    const out = [{ id: S.myId, name: S.name, char: S.myChar }];
    for (const [id, r] of S.players) if (r.escaped && id !== S.myId) out.push({ id, name: r.name, char: r.char });
    $('hud').classList.remove('show'); showScreen('');
    S.intro = playOutro({ renderer, assets: { car }, players: out, meId: S.myId, audio, onDone: after });
    if (!S.intro) after();
  });
}

function onEnd(m) {
  document.body.classList.remove('ingame');
  closeBlueprint(); S.touchActive = false; TC?.show(false);
  setTimeout(() => { S.voice?.stop(); S.voice = null; }, 15000); // keep talking over the end screen a little
  if (S.intro && S.intro.outro) { S.pendingEnd = m; return; } // let the drive away finish first
  if (S.intro) { S.intro.abort(); S.intro = null; $('hud').classList.add('show'); }
  S.phase = 'ended';
  if (document.pointerLockElement) document.exitPointerLock();
  audio.setChase(false);
  $('hud').classList.remove('show');
  const h = $('endTitle');
  h.textContent = m.win ? 'YOU ESCAPED' : 'NO ONE ESCAPED';
  h.className = m.win ? 'win' : 'lose';
  const ach = runSummary(S.run);
  $('endAch').innerHTML = ach.length ? '<div class="ah">ACHIEVEMENTS</div>' + ach.map((a) => `<div class="ai">🏆 <b>${esc(a.name)}</b> ${esc(a.desc)}</div>`).join('') : '';
  $('endList').innerHTML = m.players.map((p) => `<li><span class="dot" style="color:${p.color};background:${p.color}"></span> ${esc(p.name)}: ${p.escaped ? '<span style="color:#cfe">escaped</span>' : p.alive ? 'still inside…' : '<span style="color:#a22">taken</span>'}</li>`).join('');
  setTimeout(() => { $('death').classList.remove('show'); showScreen('end'); }, S.jumpscare ? 2500 : 600);
}

function setObjective() {
  const st = S.stage, placedN = S.placed.filter(Boolean).length;
  const carried = (S.me?.items || []).map((id) => S.world.talismans.get(id)?.name).filter(Boolean);
  const item = (done, active, text) => `<div class="obj ${done ? 'done' : active ? 'active' : ''}">${done ? '☑' : '☐'} ${text}</div>`;
  $('objective').innerHTML =
    `<div class="h" style="color:#ff8a7a">${esc((GHOST_TYPES[S.ghostType] || GHOST_TYPES.chudail).name)}</div>` +
    '<div class="h">OBJECTIVES</div>' +
    item(S.progress >= TALISMANS || st !== 'items', st === 'items' && S.progress < TALISMANS, `Find the 5 ritual items <span class="n">(${S.progress}/${TALISMANS})</span>`) +
    item(st !== 'items', st === 'items', `Place them on the star in the basement shrine <span class="n">(${placedN}/${TALISMANS})</span>`) +
    item(st === 'escape', st === 'lure', 'Lure the Chudail into the centre of the star') +
    item(false, st === 'escape', 'Escape through the front door (ground floor)') +
    (carried.length ? `<div class="n" style="margin-top:6px;color:#ffb070">Carrying: ${carried.map(esc).join(', ')}</div>` : '') +
    (S.bp?.holder === S.myId ? '<div class="n" style="margin-top:6px;color:#9fd0ff">You have the house blueprint: press <b>M</b></div>' : S.bp?.holder ? `<div class="n" style="margin-top:6px;color:#7f9fb8">${esc(whoName(S.bp.holder))} has the blueprint</div>` : '');
}

// briefing shown on the "click to enter" screen at the start of a game
function showBriefing(target = $('brief')) {
  const gt = GHOST_TYPES[S.ghostType] || GHOST_TYPES.chudail;
  target.innerHTML = `
    <div class="bh" style="color:#ff8a7a">TONIGHT SHE IS ${esc(gt.name.toUpperCase())}</div>
    <p style="margin:0 0 12px">${esc(gt.hint)}</p>
    <div class="bh">YOUR OBJECTIVES</div>
    <ol>
      <li><b>Find the 5 ritual items</b> hidden on all three floors: a skull, a black candle, a cracked mirror, a cursed doll and a braid of her hair. The staff left riddles in their notes, and each item has her sign: find the same sign scratched on the walls. Listen too: they whisper when you are close.</li>
      <li><b>Carry them down to the shrine in the basement</b> and place one on each point of the star. If you die carrying one, you drop it.</li>
      <li><b>Lure the Chudail into the centre of the star.</b> When it burns she cannot touch anyone standing inside it. Make her come to you; when she steps into the middle she is bound.</li>
      <li><b>Escape through the front door</b> on the ground floor.</li>
    </ol>
    <div class="bh">TO SURVIVE · ${esc((DIFFICULTY[S.difficulty] || DIFFICULTY.normal).label.toUpperCase())}</div>
    <ul>
      <li><span style="color:#ffd27a">Spirit bells</span>: press <kbd>Q</kbd> to freeze her for 6 seconds.</li>
      <li><span style="color:#9fd8ff">Aatma candles</span>: hold <kbd>E</kbd> over a fallen friend to bring them back.</li>
      <li>Hide in lockers, wardrobes and under beds, but never while she is watching.</li>
      <li><kbd>C</kbd> crouch with your light off and she can walk right past you. <kbd>Ctrl</kbd> sneak is silent. <kbd>Space</kbd> jump.</li>
      <li>Something lives on the ceiling once the first item is taken. Look up.</li>
      <li>There is <b>one blueprint of the house</b> on a table by the front door. Whoever carries it can read it with <kbd>M</kbd>. If they fall, it falls with them.</li>
    </ul>`;
  target.style.display = 'block';
}

// waking up after the intro: you say it out loud (well, in subtitles), then the objectives pop up
function wakeUpSequence() {
  const who = esc(S.name || 'You');
  later(2.6, () => {
    $('wakesub').innerHTML = `<b>${who}:</b> We're stuck in this house... we have to find a way out.`;
    $('wakesub').style.opacity = 1;
  });
  later(6.6, () => ($('wakesub').style.opacity = 0));
  later(7.2, () => showObjectivesPopup());
}
function showObjectivesPopup() {
  const pop = $('objpop');
  showBriefing(pop.querySelector('.inner'));
  pop.classList.add('show');
  clearTimeout(S.objT); S.objT = setTimeout(hideObjectivesPopup, 16000);
}
function hideObjectivesPopup() {
  const pop = $('objpop');
  if (!pop.classList.contains('show')) return;
  pop.classList.remove('show'); clearTimeout(S.objT);
  message('The star in the basement wants five gifts. Find the riddles.', 'red');
}
addEventListener('keydown', (e) => { if (e.code === 'Enter' && $('objpop').classList.contains('show')) hideObjectivesPopup(); });
$('objpop').addEventListener('click', () => hideObjectivesPopup());
$('objpop').addEventListener('touchstart', (e) => { e.preventDefault(); hideObjectivesPopup(); }, { passive: false });

// ---------------- notes & clues ----------------
function openNote(id) {
  const n = S.world.notes.get(id);
  if (!n) return;
  S.reading = id; n.read = true;
  $('noteText').textContent = n.text;
  const sg = $('noteSigil');
  if (n.sigil) { sg.src = sigilURL(n.sigil); sg.style.display = 'block'; } else sg.style.display = 'none';
  $('note').classList.add('show');
  audio.paper?.();
  if (n.clue) send({ t: 'note', id });
}
const sigilCache = {};
function sigilURL(kind) { return sigilCache[kind] || (sigilCache[kind] = TX.sigilCanvas(kind, 'ink').toDataURL()); }
function closeNote() { S.reading = null; $('note').classList.remove('show'); audio.paper?.(); }
function renderClues() {
  const el = $('clues');
  if (!S.world || !S.clues.size) { el.innerHTML = ''; return; }
  const rows = [...S.clues].map((id) => {
    const n = S.world.notes.get(id); const t = S.world.talismans.get(n.clue);
    return `<div class="${t && (t.taken || S.placed.includes(n.clue)) ? 'done' : ''}">• ${esc(n.about)}${n.sigil ? `<img class="sg" src="${sigilURL(n.sigil)}" alt="">` : ''}</div>`;
  });
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
    if (!isWall(S.map, S.me.L, Math.floor(x / CELL), Math.floor(z / CELL)) && lineOfSight(S.map, S.me.L, cx, cz, x, z)) return { x, z, d };
  }
  return null;
}

function showGhost(x, z, until, kind) {
  const g = S.ghost;
  g.userData.setCrawl?.(kind === 'ceiling' ? 1 : 0, 1, WALL_H, true);
  g.position.set(x, heightAt(S.map, S.me.L, x, z), z);
  g.rotation.y = Math.atan2(-(camera.position.x - x), -(camera.position.z - z));
  g.visible = true;
  S.ghostState = { until, seen: false, kind, lookT: 0 };
}
function hideGhost() { S.ghost.visible = false; S.ghost.userData.setCrawl?.(0, 1, WALL_H, true); S.ghostState = null; }

// ---------------- achievements ----------------
function achToast(a) {
  let box = $('achbox'); if (!box) { box = document.createElement('div'); box.id = 'achbox'; document.body.appendChild(box); }
  const el = document.createElement('div'); el.className = 'ach';
  el.innerHTML = `<b>🏆 ACHIEVEMENT</b><span>${esc(a.name)}</span><small>${esc(a.desc)}</small>`;
  box.appendChild(el); audio.ping?.(false);
  setTimeout(() => el.classList.add('out'), 4200); setTimeout(() => el.remove(), 5000);
}

// ---------------- pings: mark a spot for your friends ----------------
const pingRay = new THREE.Raycaster();
function doPing() {
  const me = S.me; if (!S.scene) return;
  let kind = 'spot', label = 'HERE', point = null;
  // she is in your sights?
  const m = S.mon, dx = m.x - camera.position.x, dz = m.z - camera.position.z, d = Math.hypot(dx, dz), f = camForward();
  if ((m.L || 0) === me.L && d < 25 && (dx * f.x + dz * f.z) / (d || 1) > 0.94 && lineOfSight(S.map, me.L, camera.position.x, camera.position.z, m.x, m.z)) {
    kind = 'danger'; label = "SHE'S HERE!"; point = new THREE.Vector3(m.x, me.L * FLOOR_H + 1.8, m.z);
  } else if (S.prompt && S.prompt.id && !S.prompt.revive && !S.prompt.hide) { // the thing you are looking at
    const it = S.world.talismans.get(S.prompt.id) || S.world.batteries.get(S.prompt.id) || S.world.bells.get(S.prompt.id) || S.world.souls.get(S.prompt.id) || (S.prompt.id === 'bp' ? S.bp : null);
    if (it) { kind = 'item'; label = String(S.prompt.label || 'ITEM').replace(/^(Take the |Pick up |Take )/i, '').toUpperCase(); point = new THREE.Vector3(it.x, me.L * FLOOR_H + 0.6, it.z); }
  }
  if (!point) { // wherever the crosshair hits
    pingRay.setFromCamera({ x: 0, y: 0 }, camera); pingRay.far = 30;
    const hit = pingRay.intersectObject(S.world.levelGroups[me.L], true).find((h) => h.object.visible && h.object.isMesh);
    point = hit ? hit.point : camera.position.clone().addScaledVector(pingRay.ray.direction, 6);
  }
  send({ t: 'ping', x: +point.x.toFixed(2), y: +point.y.toFixed(2), z: +point.z.toFixed(2), L: me.L, kind, label });
}
function showPing(m) {
  let layer = $('pings'); if (!layer) { layer = document.createElement('div'); layer.id = 'pings'; document.body.appendChild(layer); }
  const who = m.by === S.myId ? null : S.players.get(m.by);
  const col = m.kind === 'danger' ? '#ff3b2f' : (who ? who.color : '#ffd27a');
  const el = document.createElement('div'); el.className = 'ping ' + m.kind;
  el.innerHTML = `<b style="color:${col}">${m.kind === 'danger' ? '⚠' : '◆'}</b><span>${esc(m.label)}</span><i></i><small>${esc(who ? who.name : 'you')}</small>`;
  layer.appendChild(el);
  S.pings = (S.pings || []).concat([{ el, x: m.x, y: m.y, z: m.z, L: m.L, until: performance.now() / 1000 + (m.kind === 'danger' ? 6 : 9) }]);
  audio.ping?.(m.kind === 'danger');
  if (m.by !== S.myId) message(`${who ? who.name : 'Someone'} pinged: ${m.label}`, m.kind === 'danger' ? 'red' : '');
}
// teammates' names, always visible through walls: distance under the name, ↑/↓ when they are on another floor
const nv = new THREE.Vector3();
function updateNameTags() {
  let layer = $('ntags'); if (!layer) { layer = document.createElement('div'); layer.id = 'ntags'; document.body.appendChild(layer); }
  const seen = new Set();
  if (S.phase === 'playing' && S.scene && S.me && !S.bpOpen) for (const r of S.players.values()) {
    if (r.escaped || S.spectating === r.id) continue;
    let el = r.tagEl;
    if (!el) { el = r.tagEl = document.createElement('div'); el.className = 'ntag'; el.innerHTML = '<b></b><i></i>'; layer.appendChild(el); }
    seen.add(el);
    const y = (r.L || 0) * FLOOR_H + (r.cr ? 1.35 : 2.05) + (r.jy || 0);
    nv.set(r.x, y, r.z).project(camera);
    if (nv.z > 1 || Math.abs(nv.x) > 1.05 || Math.abs(nv.y) > 1.05) { el.style.display = 'none'; continue; }
    const d = Math.hypot(r.x - camera.position.x, r.z - camera.position.z), other = (r.L || 0) !== S.camL;
    el.style.display = 'block';
    el.style.transform = `translate(${(nv.x * 0.5 + 0.5) * innerWidth}px, ${(-nv.y * 0.5 + 0.5) * innerHeight}px) translate(-50%, -100%)`;
    const b = el.querySelector('b'); b.textContent = r.name + (r.alive ? '' : ' ✕'); b.style.color = r.color;
    el.querySelector('i').textContent = `${Math.round(d)} m${other ? ((r.L || 0) > S.camL ? ' ↑' : ' ↓') : ''}`;
    el.style.opacity = other ? 0.5 : r.alive ? 0.95 : 0.55;
  }
  for (const el of [...layer.children]) if (!seen.has(el)) el.style.display = 'none';
}

const pv = new THREE.Vector3();
function updatePings() {
  if (!S.pings || !S.pings.length) return;
  const t = performance.now() / 1000;
  S.pings = S.pings.filter((p) => {
    if (t > p.until || !S.scene) { p.el.remove(); return false; }
    pv.set(p.x, p.y + 0.4, p.z).project(camera);
    const behind = pv.z > 1, other = p.L !== S.camL;
    let sx = (pv.x * 0.5 + 0.5) * innerWidth, sy = (-pv.y * 0.5 + 0.5) * innerHeight;
    if (behind) { sx = innerWidth - sx; sy = innerHeight - 40; }
    sx = Math.max(30, Math.min(innerWidth - 30, sx)); sy = Math.max(40, Math.min(innerHeight - 40, sy));
    p.el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -100%)`;
    const d = Math.hypot(p.x - camera.position.x, p.z - camera.position.z);
    p.el.querySelector('i').textContent = `${Math.round(d)} m${other ? (p.L > S.camL ? ' ↑' : ' ↓') : ''}`;
    p.el.style.opacity = Math.min(1, (p.until - t) / 1.2) * (other ? 0.6 : 1);
    return true;
  });
}

// ---------------- the blueprint of the house ----------------
function whoName(id) { return id === S.myId ? 'You' : S.players.get(id)?.name || 'Someone'; }
// one table by the front door; the sheet lies on it (or wherever its holder fell). Only its holder can read it (M).
function drawPlan(c, L, { labels = true } = {}) {
  const map = S.map, W = map.W, H = map.H, g = c.getContext('2d'), sz = c.width;
  const walk = (i, j) => { if (i < 0 || j < 0 || i >= W || j >= H) return false; const t = map.grid[L][j * W + i]; return t === 1 || t === 2 || t === 3 || t === 4; };
  // the occupied part of the grid, with a margin
  let i0 = W, i1 = 0, j0 = H, j1 = 0;
  for (const LL of LEVELS) for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const t = map.grid[LL][j * W + i]; if (t) { i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j); } }
  const span = Math.max(i1 - i0, j1 - j0) + 3, cs = (sz * 0.86) / span, ox = (sz - (i1 - i0 + 1) * cs) / 2 - i0 * cs, oy = (sz - (j1 - j0 + 1) * cs) / 2 - j0 * cs + sz * 0.03;
  g.fillStyle = '#1b4a86'; g.fillRect(0, 0, sz, sz);
  g.strokeStyle = 'rgba(160,200,255,0.12)'; g.lineWidth = 1;
  for (let k = 0; k <= sz; k += cs) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k, sz); g.stroke(); g.beginPath(); g.moveTo(0, k); g.lineTo(sz, k); g.stroke(); }
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (!walk(i, j)) continue;
    const t = map.grid[L][j * W + i];
    g.fillStyle = t === 2 ? 'rgba(220,235,255,0.10)' : t === 3 || t === 4 ? 'rgba(220,235,255,0.28)' : 'rgba(220,235,255,0.18)';
    g.fillRect(ox + i * cs, oy + j * cs, cs + 0.5, cs + 0.5);
    if (t === 3 || t === 4) { g.strokeStyle = 'rgba(235,245,255,0.7)'; g.lineWidth = 1; for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo(ox + i * cs + (k * cs) / 4, oy + j * cs + 2); g.lineTo(ox + i * cs + (k * cs) / 4, oy + (j + 1) * cs - 2); g.stroke(); } }
  }
  g.strokeStyle = '#e8f1ff'; g.lineWidth = Math.max(1.5, cs * 0.12); g.lineCap = 'round';
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (!walk(i, j)) continue;
    const x = ox + i * cs, y = oy + j * cs;
    if (!walk(i - 1, j)) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + cs); g.stroke(); }
    if (!walk(i + 1, j)) { g.beginPath(); g.moveTo(x + cs, y); g.lineTo(x + cs, y + cs); g.stroke(); }
    if (!walk(i, j - 1)) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + cs, y); g.stroke(); }
    if (!walk(i, j + 1)) { g.beginPath(); g.moveTo(x, y + cs); g.lineTo(x + cs, y + cs); g.stroke(); }
  }
  if (!labels) return;
  g.fillStyle = '#f2f7ff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `bold ${Math.max(13, cs * 0.66)}px "Courier Prime", monospace`;
  for (const r of map.rooms) if (r.L === L) g.fillText(r.label, ox + (r.cx + 0.5) * cs, oy + (r.cy + 0.5) * cs, r.w * cs - 4);
  const mark = (x, z, text, col) => { g.fillStyle = col; g.font = `bold ${Math.max(15, cs * 0.85)}px "Courier Prime", monospace`; g.fillText(text, ox + (x / CELL) * cs, oy + (z / CELL) * cs); };
  if (L === 0) mark(map.exit.x - CELL * 0.2, map.exit.z - CELL * 0.75, 'EXIT ▼', '#ffd27a');
  if (map.shrine && map.shrine.L === L) { g.strokeStyle = '#ff9a8a'; g.lineWidth = 2; g.beginPath(); g.arc(ox + (map.shrine.x / CELL) * cs, oy + (map.shrine.z / CELL) * cs, cs * 1.4, 0, 7); g.stroke(); }
  g.fillStyle = '#e8f1ff'; g.textAlign = 'left'; g.font = `${Math.round(sz * 0.032)}px "IM Fell English SC", serif`;
  g.fillText(`ASHGROVE SANATORIUM · ${LEVEL_NAMES[L].toUpperCase()}`, sz * 0.05, sz * 0.05);
  g.textAlign = 'right'; g.font = `${Math.round(sz * 0.022)}px "Courier Prime", monospace`;
  g.fillText('1 basement · 2 ground · 3 upper · M close', sz * 0.95, sz * 0.96);
}
function buildBlueprint(map, state) {
  if (!map.blueprint) { S.bp = null; return; }
  const b = map.blueprint, g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x3a2618, roughness: 0.8 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.06, 1.2), wood); top.position.y = 0.8; g.add(top);
  for (const [x, z] of [[-0.32, -0.54], [0.32, -0.54], [-0.32, 0.54], [0.32, 0.54]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.8, 0.06), wood); l.position.set(x, 0.4, z); g.add(l); }
  const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.16, 8), new THREE.MeshStandardMaterial({ color: 0xd8cfb0 })); candle.position.set(0.22, 0.91, -0.45); g.add(candle);
  const flame = new THREE.PointLight(0xffa860, 1.6, 4, 1.6); flame.position.set(0.22, 1.05, -0.45); g.add(flame);
  g.position.set(b.x, b.L * FLOOR_H, b.z); S.world.levelGroups[b.L].add(g); g.position.y = 0;
  S.world.colliders.push([b.x - 0.38, b.z - 0.62, b.x + 0.38, b.z + 0.62, b.L]);
  const c = TX.canvas(512); drawPlan(c, 0, { labels: false });
  const tex = TX.toTex(c, { repeat: false });
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, emissive: 0x0a1a33 }));
  sheet.rotation.x = -Math.PI / 2; S.scene.add(sheet);
  S.bpSheet = sheet;
  S.bp = state ? { ...state } : { holder: null, x: b.x, z: b.z, L: b.L, onTable: true };
  placeBlueprint();
}
function placeBlueprint() {
  const sh = S.bpSheet; if (!sh || !S.bp) return;
  sh.visible = !S.bp.holder;
  sh.position.set(S.bp.x, S.bp.L * FLOOR_H + (S.bp.onTable ? 0.835 : 0.02), S.bp.z);
  sh.rotation.z = S.bp.onTable ? 0.1 : (S.bp.x * 7.3) % 6.28;
}
function openBlueprint(L) {
  let el = $('bpview');
  if (!el) {
    el = document.createElement('canvas'); el.id = 'bpview';
    Object.assign(el.style, { position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%,-50%) rotate(-1deg)', width: 'min(86vh, 92vw)', height: 'min(86vh, 92vw)', zIndex: 7, boxShadow: '0 0 60px #000, 0 0 0 6px #d8d0b8', pointerEvents: 'none' });
    document.body.appendChild(el);
  }
  el.width = el.height = 1100; drawPlan(el, L); el.style.display = 'block';
  S.bpOpen = true; audio.paper?.();
}
function closeBlueprint() { const el = $('bpview'); if (el) el.style.display = 'none'; if (S.bpOpen) audio.paper?.(); S.bpOpen = false; }

// a face in the wall next to you: it lunges out at you, screaming, then sinks back
function wallFace(t) {
  const model = getModel('ghost_face'); if (!model || !S.me) return false;
  const ci = Math.floor(S.me.x / CELL), cj = Math.floor(S.me.z / CELL), f = camForward();
  const opts = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([a, b]) => isWall(S.map, S.me.L, ci + a, cj + b))
    .map(([a, b]) => ({ a, b, side: Math.abs(a * f.x + b * f.z) })).sort((p, q) => p.side - q.side); // a wall beside you, not ahead
  if (!opts.length) return false;
  const { a, b } = opts[0];
  const wallX = (ci + 0.5) * CELL + a * CELL / 2, wallZ = (cj + 0.5) * CELL + b * CELL / 2;
  // about a metre ahead of you along that wall, so it bursts out at the edge of your view, not behind you
  let px = a ? wallX : S.me.x + f.x * 1.1, pz = b ? wallZ : S.me.z + f.z * 1.1;
  if (!isWall(S.map, S.me.L, Math.floor((px + a * 0.2) / CELL), Math.floor((pz + b * 0.2) / CELL))) { px = a ? wallX : S.me.x; pz = b ? wallZ : S.me.z; }
  const base = Math.atan2(-a, -b);
  const g = new THREE.Group(); g.position.set(px, S.me.L * FLOOR_H + 1.25, pz); g.rotation.y = base;
  const face = model.clone(true); face.scale.setScalar(1.35); face.position.set(0.1, 0, 0); g.add(face);
  S.scene.add(g);
  const scene = S.scene;
  // driven by the game loop (S.anims), so it can never get stuck in the wall
  S.anims.push((t2) => {
    const k = t2 - t;
    const out = k < 0.18 ? Math.max(0, k / 0.18) : k < 0.9 ? 1 : Math.max(0, 1 - (k - 0.9) / 0.6);
    g.position.x = px - a * 0.55 * out; g.position.z = pz - b * 0.55 * out;
    let turn = Math.atan2(camera.position.x - g.position.x, camera.position.z - g.position.z) - base;
    while (turn > Math.PI) turn -= Math.PI * 2; while (turn < -Math.PI) turn += Math.PI * 2;
    g.rotation.y = base + turn * Math.min(1, out * 1.2); // it turns to scream at you
    g.rotation.z = Math.sin(k * 40) * 0.04 * out;
    if (k >= 1.6) { scene.remove(g); return false; }
    return true;
  });
  audio.stinger(0.9); audio.screech(px, pz, 0.9); S.shake = 1.1; S.red = 0.7; fxFlash('#fff', 0.5, 120); fxGlitch(120);
  return true;
}

// something slams bloody hands against your eyes (the glass of the screen)
function handprints() {
  let cv = $('handcv');
  if (!cv) { cv = document.createElement('canvas'); cv.id = 'handcv'; Object.assign(cv.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: 6, transition: 'opacity 2.5s' }); document.body.appendChild(cv); }
  cv.width = innerWidth; cv.height = innerHeight; const g = cv.getContext('2d'); g.clearRect(0, 0, cv.width, cv.height);
  cv.style.transition = 'none'; cv.style.opacity = 1;
  const n = 3 + Math.floor(Math.random() * 3);
  for (let k = 0; k < n; k++) later(k * rnd(0.18, 0.32), () => {
    if (!S.me?.alive) return;
    TX.handprint(g, rnd(0.15, 0.85) * cv.width, rnd(0.2, 0.8) * cv.height, rnd(3.6, 5.4) * Math.min(cv.width, cv.height) / 900, rnd(-0.6, 0.6));
    audio.bang(S.me.x, S.me.z, 0.55); S.shake = 0.5; S.red = Math.max(S.red, 0.4);
  });
  later(n * 0.3 + 1.2, () => { cv.style.transition = 'opacity 2.5s'; cv.style.opacity = 0; });
}

function runScare(t, forced) {
  const options = ['apparition', 'apparition', 'footsteps', 'whisper', 'blackout', 'blackout', 'bulb', 'slam', 'behind', 'subliminal',
    'wallface', 'wallface', 'statue', 'statue', 'handprints', 'scream', 'ceiling'];
  if (S.progress >= 1) options.push('approach', 'behind', 'ceiling', 'wallface');
  if (S.progress >= 2) options.push('faceflash', 'approach', 'blackout');
  let type = forced || options[Math.floor(Math.random() * options.length)];
  const monD = Math.hypot(S.mon.x - S.me.x, S.mon.z - S.me.z);
  if ((type === 'apparition' || type === 'approach' || type === 'behind' || type === 'ceiling') && monD < 18) type = 'whisper';
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
          fxFlash('#fff', 0.75, 200); fxGlitch(140); later(0.2, () => fxFace(50, 0.6));
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
    case 'faceflash': { // three hard cuts to her face between white flashes
      audio.stinger(0.8); S.red = 0.6; S.shake = 0.8;
      for (let k = 0; k < 3; k++) setTimeout(() => { fxFlash(k === 2 ? '#a00000' : '#fff', 0.9, 120); setTimeout(() => fxFace(70, 0.8 - k * 0.15), 60); }, k * (FX.calm ? 500 : 190));
      setTimeout(() => fxGlitch(160), 420);
      break;
    }
    case 'subliminal': { // you are not sure you saw it
      fxFace(40, 0.55); audio.stinger(0.3); S.red = 0.35;
      later(0.3, () => { fxGlitch(90); fxFace(30, 0.35); });
      break;
    }
    case 'behind': { // she breathes right behind you; turn around and she is there
      const f = camForward();
      const x = camera.position.x - f.x * 1.3, z = camera.position.z - f.z * 1.3;
      if (isWall(S.map, S.me.L, Math.floor(x / CELL), Math.floor(z / CELL)) || !lineOfSight(S.map, S.me.L, camera.position.x, camera.position.z, x, z)) { audio.whisper(0, 0.5, 1.6); break; }
      showGhost(x, z, t + 5, 'behind');
      audio.whisper(0, 0.55, 1.8); audio.breath(0.3); later(1.2, () => audio.breath(0.35));
      break;
    }
    case 'wallface': { // a screaming face pushes out of the wall right beside you, then sinks back in
      if (!wallFace(t)) audio.whisper(rnd(-1, 1), 0.4, 1.8);
      break;
    }
    case 'statue': { // the lights stutter; when they come back, a statue is closer
      S.flickUntil = t + 0.7; audio.buzz(0.45, 0.1);
      later(0.32, () => { if (!S.me?.alive) return; if (S.statues?.creep(camera, S.camL, audio)) { S.shake = 0.35; later(0.4, () => audio.whisper(rnd(-0.5, 0.5), 0.3, 1.4)); } else audio.whisper(rnd(-1, 1), 0.3, 1.6); });
      break;
    }
    case 'handprints': handprints(); break;
    case 'scream': { // a woman screams somewhere off to one side
      const a = Math.random() * Math.PI * 2, d = rnd(9, 15);
      audio.distantScream(S.me.x + Math.cos(a) * d, S.me.z + Math.sin(a) * d); S.red = 0.3; S.shake = 0.25;
      break;
    }
    case 'ceiling': { // she skitters across the ceiling just ahead of you
      const f = camForward(), r = { x: -f.z, z: f.x }, ahead = 4.2;
      const cx = S.me.x + f.x * ahead, cz = S.me.z + f.z * ahead;
      const a = { x: cx - r.x * 2.6, z: cz - r.z * 2.6 }, b = { x: cx + r.x * 2.6, z: cz + r.z * 2.6 };
      const cell = (p) => isWall(S.map, S.me.L, Math.floor(p.x / CELL), Math.floor(p.z / CELL));
      if (cell({ x: cx, z: cz }) || !lineOfSight(S.map, S.me.L, S.me.x, S.me.z, cx, cz)) { audio.skitter(cx, cz, 0.6); break; }
      const from = cell(a) ? { x: cx, z: cz } : a, to = cell(b) ? { x: cx, z: cz } : b;
      showGhost(from.x, from.z, t + 1.3, 'ceiling');
      Object.assign(S.ghostState, { from, to, t0: t });
      [0, 0.25, 0.5, 0.75].forEach((s) => later(s, () => audio.skitter((from.x + to.x) / 2, (from.z + to.z) / 2, 0.8)));
      S.flickUntil = t + 0.4; S.shake = 0.3;
      break;
    }
    case 'approach': { // lights die; each flicker of your torch she is closer
      const dists = [9, 6.5, 4, 2.2], spots = dists.map((d) => findSpotAhead(d - 0.6, d));
      if (spots.some((p) => !p) || !findSpotAhead(0.8, 1.0)) { runScare(t, 'blackout'); return; }
      S.lightsOutUntil = t + 3.2; S.torchCtl = { until: t + 3, k: 0 }; audio.buzz(0.6, 0.12); audio.click();
      spots.forEach((sp, k) => later(0.6 + k * 0.45, () => {
        if (!S.me?.alive) return;
        const now = performance.now() / 1000;
        showGhost(sp.x, sp.z, now + 10, 'strobe');
        S.torchCtl = { until: now + (FX.calm ? 0.25 : 0.09), k: 1.6 };
        later(FX.calm ? 0.25 : 0.09, () => { S.ghost.visible = false; S.torchCtl = { until: performance.now() / 1000 + 3, k: 0 }; });
        audio.drum(); audio.heartbeat(0.6 + k * 0.15);
      }));
      later(0.6 + dists.length * 0.45, () => {
        if (!S.me?.alive) { S.torchCtl = null; return; }
        const sp = findSpotAhead(0.8, 1.0), now = performance.now() / 1000;
        if (sp) showGhost(sp.x, sp.z, now + 0.35, 'face');
        S.torchCtl = { until: now + 0.35, k: 2 };
        audio.stinger(1); audio.screech(S.me.x, S.me.z, 0.7); S.shake = 1.5; S.red = 1;
        fxFlash('#fff', 1, 260); fxGlitch(180); later(0.12, () => fxFace(80, 0.8));
        later(0.35, () => { hideGhost(); S.torchCtl = null; S.lightsOutUntil = 0; S.flickUntil = performance.now() / 1000 + 0.6; });
      });
      break;
    }
  }
}

function updateScares(dt, t) {
  for (let k = S.timers.length - 1; k >= 0; k--) if (t >= S.timers[k].at) { const fn = S.timers[k].fn; S.timers.splice(k, 1); fn(); }
  S.anims = (S.anims || []).filter((fn) => fn(t)); // short scare animations (a face out of the wall...)
  if (!S.me.alive || S.me.escaped) return;
  if (t > (S.nextCall || 0)) {
    S.nextCall = t + 0.5;
    let best = null, bd = 6.5;
    for (const tl of S.world.talismans.values()) {
      if (tl.taken || tl.L !== S.me.L) continue;
      const d = Math.hypot(tl.x - S.me.x, tl.z - S.me.z); if (d < bd) { bd = d; best = tl; }
    }
    if (best && t > (S.nextWhisperItem || 0)) {
      S.nextWhisperItem = t + rnd(6, 10);
      const f = camForward(), dx = best.x - S.me.x, dz = best.z - S.me.z;
      const pan = Math.max(-1, Math.min(1, (dx * -f.z + dz * f.x) / (bd || 1))); // + = to your right
      audio.whisper(pan, 0.1 + 0.14 * (1 - bd / 6.5), 1.6);
      if (bd < 3.5 && S.me.fl) S.flickUntil = Math.max(S.flickUntil, t + 0.25);
    }
  }
  if (t > S.nextScare) {
    if (S.mon.state === 'chase' && S.mon.target === S.myId) S.nextScare = t + 8;
    else { runScare(t); S.nextScare = t + rnd(15, 32) - S.progress * 2; }
  }
  const gs = S.ghostState;
  if (gs) {
    if (gs.kind === 'ceiling') {
      const k = Math.min(1, (t - gs.t0) / 1.2);
      S.ghost.position.set(gs.from.x + (gs.to.x - gs.from.x) * k, heightAt(S.map, S.me.L, S.ghost.position.x, S.ghost.position.z), gs.from.z + (gs.to.z - gs.from.z) * k);
      S.ghost.rotation.y = Math.atan2(-(gs.to.x - gs.from.x), -(gs.to.z - gs.from.z));
      S.ghost.userData.setCrawl?.(1, 1, WALL_H, k === 0);
      S.ghost.userData.update(dt, 4, 'chase', t);
    } else S.ghost.userData.update(dt, 0, 'stall', t);
    const dx = S.ghost.position.x - camera.position.x, dz = S.ghost.position.z - camera.position.z, d = Math.hypot(dx, dz);
    const f = camForward(); const dot = (dx * f.x + dz * f.z) / (d || 1);
    if (gs.kind === 'far') {
      if (dot > 0.88 && !gs.seen) { gs.seen = true; audio.stinger(0.5); S.shake = 0.3; gs.until = Math.min(gs.until, t + 0.7); fxGlitch(80); }
      if (S.me.fl && dot > 0.97) { gs.lookT += dt; if (gs.lookT > 0.2) gs.until = Math.min(gs.until, t + 0.08); }
      if (d < 5.5) gs.until = t;
    }
    if (gs.kind === 'behind' && !gs.seen && dot > 0.72) {
      gs.seen = true; gs.until = t + 0.3;
      audio.stinger(1); audio.screech(S.ghost.position.x, S.ghost.position.z, 0.8); S.shake = 1.4; S.red = 0.9;
      fxFlash('#fff', 0.95, 220); fxGlitch(150); later(0.1, () => fxFace(60, 0.7));
    }
    if (t > gs.until) { hideGhost(); if (gs.kind === 'far') S.flickUntil = t + 0.18; }
  }
}

let scareCv = null;
function scareCanvas() { if (!scareCv) scareCv = TX.jumpscareCanvas(); const c = document.createElement('canvas'); c.width = c.height = 1024; c.getContext('2d').drawImage(scareCv, 0, 0); return c; }

function doJumpscare(mx, mz) {
  S.jumpscare = true; S.me.alive = false; S.torchCtl = null; hideGhost();
  fxFlash('#fff', 1, 380); fxGlitch(220);
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
      if (k > 1.9) { el.style.display = 'none'; fxFlash('#fff', 1, 600); return; }
      const s = 1 + k * 0.35 + Math.random() * 0.08;
      c.style.transform = `translate(calc(-50% + ${rnd(-30, 30)}px), calc(-50% + ${rnd(-30, 30)}px)) scale(${s}) rotate(${rnd(-3, 3)}deg)`;
      const inv = Math.random() < 0.12;
      c.style.filter = `${inv ? 'invert(1) ' : ''}contrast(${rnd(1.2, 2)}) saturate(${rnd(1, 3)}) hue-rotate(${Math.random() < 0.2 ? rnd(-30, 30) : 0}deg)`;
      el.style.opacity = Math.random() < 0.1 ? 0.3 : 1;
      if (Math.random() < 0.06) fxFlash(Math.random() < 0.5 ? '#fff' : '#b00000', 0.7, 90);
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
  $('brief').style.display = 'none'; $('resume').querySelector('h2').textContent = 'CLICK TO RESUME';
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
function surfaceAt(x, z, L = 0) { return S.map.grid[L][Math.floor(z / CELL) * S.map.W + Math.floor(x / CELL)] === 2 ? 'tile' : 'wood'; }

function updateHidden(dt, t) {
  const me = S.me, h = S.world.hides.get(me.hidden);
  me.fl = false; me.moving = false; me.sprint = false;
  me.stamina = Math.min(100, me.stamina + dt * 15);
  const base = me.L * FLOOR_H;
  if (h.type === 'bed') camera.position.set(h.x + h.fx * 0.35, base + 0.26, h.z + h.fz * 0.35);
  else camera.position.set(h.x - h.fx * 0.08, base + 1.6, h.z - h.fz * 0.08);
  camera.rotation.set(me.pitch + (Math.random() - 0.5) * S.shake * 0.04, me.yaw, 0);
  // you hold your breath when it is close
  const d = Math.hypot(S.mon.x - h.x, S.mon.z - h.z);
  me.breathT -= dt;
  if (me.breathT <= 0) { me.breathT = d < 5 ? 2.4 : 1.6; if (d > 3) audio.breath(d < 8 ? 0.03 : 0.06); }
  if (t - S.lastSend > 1 / 10) { S.lastSend = t; send({ t: 's', x: me.x, z: me.z, L: me.L, yaw: +me.yaw.toFixed(3), pitch: +me.pitch.toFixed(3), fl: false, cr: false, sp: false, sn: false, mv: false }); }
}

const JUMP = { v: 4.4, g: 13 }; // take-off speed (m/s) and gravity: ~0.74 m high, ~0.68 s in the air
function jumpArc(t) { return Math.max(0, JUMP.v * t - 0.5 * JUMP.g * t * t); }

function updatePlayer(dt, t) {
  const me = S.me, map = S.map;
  if (me.hidden) return updateHidden(dt, t);
  let ix = 0, iz = 0;
  if (held('forward')) iz += 1;
  if (held('back')) iz -= 1;
  if (held('left')) ix -= 1;
  if (held('right')) ix += 1;
  const len = Math.hypot(ix, iz); if (len) { ix /= len; iz /= len; }
  me.crouch = held('crouch');
  me.sneak = held('sneak') && !me.crouch;
  // sprint in any direction except straight backwards
  const wantSprint = held('sprint') && iz > -0.5 && !me.crouch && !me.sneak && len > 0;
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
    [nx, nz] = resolveCircle(map, me.L, nx, nz, 0.3);
    for (const c of S.world.colliders) {
      if ((c[4] ?? 0) !== me.L || Math.abs(c[0] - nx) > 4 || Math.abs(c[1] - nz) > 4) continue;
      const r = pushOutBox(nx, nz, 0.3, c[0], c[1], c[2], c[3]);
      if (r) { nx = r[0]; nz = r[1]; }
    }
  }
  // staircases: walking off the top or back down changes floor
  const tr = stairTransition(map, me.L, nx, nz);
  if (tr) { [me.L, nx, nz] = tr; message(LEVEL_NAMES[me.L].toUpperCase()); }
  me.x = nx; me.z = nz;
  const moved = Math.hypot(me.x - ox, me.z - oz);
  me.moving = moved > dt * 0.4;
  // jump (Space): a real arc; everyone else plays the same arc from the 'jump' event
  if (me.jy == null) { me.jy = 0; me.jv = 0; me.land = 0; }
  const wantJump = held('jump');
  if (wantJump && !me.spaceWas && me.jy === 0 && me.jv === 0 && !me.crouch && !S.wakePending && me.wake == null && me.stamina > 10) {
    me.jv = JUMP.v; me.stamina -= 10; send({ t: 'jump' }); audio.step(0.18, null, false, surfaceAt(me.x, me.z, me.L));
  }
  me.spaceWas = wantJump;
  if (me.jy > 0 || me.jv > 0) {
    me.jv -= JUMP.g * dt; me.jy += me.jv * dt;
    if (me.jy <= 0) { me.jy = 0; me.jv = 0; me.land = 1; me.stepAcc = 0; audio.step(0.55, null, false, surfaceAt(me.x, me.z, me.L)); }
  }
  me.land = Math.max(0, me.land - dt * 5);
  const airborne = me.jy > 0;
  // footsteps + head bob
  if (!airborne) me.stepAcc += moved;
  const stride = me.sprint ? 2.3 : me.crouch ? 1.2 : me.sneak ? 1.0 : 1.85;
  if (me.stepAcc > stride) { me.stepAcc = 0; if (!me.sneak && !me.crouch) audio.step(me.sprint ? 0.42 : 0.22, null, false, surfaceAt(me.x, me.z, me.L)); }
  me.bob += moved * (me.sprint ? 3.2 : 3.6);
  const bobAmp = me.sprint ? 0.085 : (me.crouch || me.sneak) ? 0.015 : 0.04;
  // field-of-view kick so sprinting feels fast
  // while she stares back at you, the hall seems to stretch and pull her closer (slow zoom in)
  const staring = t < (S.stareUntil || 0);
  const fovT = staring ? SETTINGS.fov - 18 : me.sprint && me.moving ? SETTINGS.fov + 10 : SETTINGS.fov;
  if (Math.abs(camera.fov - fovT) > 0.05) { camera.fov += (fovT - camera.fov) * Math.min(1, dt * (staring ? 0.9 : 6)); camera.updateProjectionMatrix(); }
  let eyeT = me.crouch ? 1.05 : 1.62;
  if (me.wake != null) { // getting up off the floor after the crash
    me.wake += dt;
    const k = Math.min(1, Math.max(0, (me.wake - 1.6) / 2.4));
    eyeT = 0.3 + (eyeT - 0.3) * k * k * (3 - 2 * k);
    if (me.wake > 4.2) me.wake = null;
  } else if (S.wakePending) eyeT = 0.3;
  me.eye += (eyeT - me.eye) * Math.min(1, dt * 9);
  const sh = S.shake;
  const floorY = heightAt(map, me.L, me.x, me.z);
  me.floorY = me.floorY === undefined ? floorY : me.floorY + (floorY - me.floorY) * Math.min(1, dt * 14);
  camera.position.set(me.x, me.floorY + me.eye + me.jy - Math.sin(me.land * Math.PI) * 0.09 + Math.sin(me.bob) * bobAmp * (me.moving && !airborne ? 1 : 0), me.z);
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
  if (S.exitOpen && me.L === 0 && Math.hypot(me.x - S.map.exit.x, me.z - S.map.exit.z) < 2.3 && t - S.escSent > 1) { S.escSent = t; send({ t: 'escape' }); }
  // network
  if (t - S.lastSend > 1 / 15) {
    S.lastSend = t;
    send({ t: 's', x: +me.x.toFixed(2), z: +me.z.toFixed(2), L: me.L, yaw: +me.yaw.toFixed(3), pitch: +me.pitch.toFixed(3), fl: me.fl, cr: me.crouch, sp: me.sprint, sn: me.sneak, mv: me.moving });
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
      camera.position.set(r.x, heightAt(S.map, r.L, r.x, r.z) + (r.cr ? 1.05 : 1.6) + (r.jy || 0), r.z); camera.rotation.set(r.pitch, r.yaw, 0);
      S.camL = r.L; return;
    }
    S.droneFollow = null;
  }
  let ix = 0, iz = 0, iy = 0;
  if (held('forward')) iz += 1; if (held('back')) iz -= 1; if (held('left')) ix -= 1; if (held('right')) ix += 1;
  if (held('jump')) iy += 1; if (held('crouch') || held('sneak')) iy -= 1;
  const sp = (held('sprint') ? 20 : 7) * dt;
  const cp = Math.cos(me.pitch);
  me.x += (-Math.sin(me.yaw) * cp * iz + Math.cos(me.yaw) * ix) * sp;
  me.z += (-Math.cos(me.yaw) * cp * iz - Math.sin(me.yaw) * ix) * sp;
  me.droneY = clamp(me.droneY + (Math.sin(me.pitch) * iz + iy) * sp, -FLOOR_H + 0.3, 45);
  S.camL = clamp(Math.floor(me.droneY / FLOOR_H), -1, 1);
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
  camera.position.set(r.x, heightAt(S.map, r.L, r.x, r.z) + (r.cr ? 1.05 : 1.6), r.z);
  camera.rotation.set(r.pitch, r.yaw, 0);
  S.camL = r.L;
}

function updateRemotes(dt) {
  const rt = performance.now() - INTERP_MS;
  for (const r of S.players.values()) {
    const ox = r.x, oz = r.z;
    const smp = sampleBuf(r.buf, rt);
    if (smp) { r.x = smp.x; r.z = smp.z; r.yaw = smp.yaw; r.pitch = smp.pitch; }
    const a = r.avatar;
    let air = 0; r.jy = 0;
    if (r.jt != null) { // a jump: the same arc they see, with knees tucked
      r.jt += dt; const T = (2 * JUMP.v) / JUMP.g;
      if (r.jt >= T) { r.jt = null; if (r.alive && !r.hid && !r.escaped) audio.step(0.4, { x: r.x, z: r.z }, false, surfaceAt(r.x, r.z, r.L)); }
      else { r.jy = jumpArc(r.jt); air = Math.sin(Math.PI * r.jt / T); }
    }
    a.position.set(r.x, heightAt(S.map, r.L, r.x, r.z) + r.jy, r.z); a.rotation.y = r.yaw;
    if (r.escaped) { a.userData.setShown(false); a.userData.label.visible = false; continue; }
    if (S.spectating !== r.id && S.droneFollow !== r.id) { a.userData.setShown(!r.hid || S.spectator); a.userData.label.visible = (!r.hid || S.spectator) && r.alive; }
    if (!r.alive) { if (!r.deadShown) { a.userData.setDead(); r.deadShown = true; } continue; }
    const moved = Math.hypot(r.x - ox, r.z - oz);
    a.userData.setPose(r.pitch, r.fl, r.cr, r.mv, dt, moved / Math.max(dt, 1e-3), air);
    r.step += moved;
    if (r.step > (r.sp ? 2.3 : 1.85)) { r.step = 0; if (!r.cr && !r.sn) audio.step(r.sp ? 0.45 : 0.25, { x: r.x, z: r.z }, false, surfaceAt(r.x, r.z, r.L)); }
    // label always faces camera (sprite), fade with distance
    const d = Math.hypot(r.x - camera.position.x, r.z - camera.position.z);
    a.userData.label.material.opacity = clamp(1 - (d - 4) / 10, 0.15, 0.85);
    a.userData.label.visible = false; // the screen name tags (updateNameTags) show names through walls instead
  }
}

function updateCrawler(dt, t) {
  const c = S.crawl, g = S.crawler;
  const ox = c.x, oz = c.z;
  const smp = sampleBuf(c.buf, performance.now() - INTERP_MS);
  if (smp) { c.x = smp.x; c.z = smp.z; c.yaw = smp.yaw; }
  const moved = Math.hypot(c.x - ox, c.z - oz);
  c.speed += (moved / Math.max(dt, 1e-3) - c.speed) * Math.min(1, dt * 6);
  g.position.set(c.x, heightAt(S.map, c.L || 0, c.x, c.z), c.z); g.rotation.y = c.yaw;
  g.userData.update(dt, c.state, c.speed, t);
  if (!levelShown(c.L || 0)) g.visible = false;
  if (c.state === 'crawl') {
    c.skitter -= dt;
    if (c.skitter <= 0) { c.skitter = 0.22; audio.skitter(c.x, c.z, 0.5); }
  } else if (c.state === 'ceiling') {
    c.skitter -= dt;
    const d = Math.hypot(c.x - camera.position.x, c.z - camera.position.z);
    if (c.skitter <= 0) { c.skitter = rnd(2.5, 6); if (d < 10) audio.skitter(c.x, c.z, 0.18); }
  }
}

// is there furniture between (x,z) and the wall plane, within a couple of metres along the wall?
function furnitureAlongWall(L, x, z, alongXAxis, plane) {
  for (const c of staticColliders(S.map)) {
    if (c[4] !== L) continue;
    if (alongXAxis) { // wall plane is x = plane
      if (c[3] < z - 1.6 || c[1] > z + 1.6) continue;
      if (Math.max(c[0], Math.min(x, plane)) <= Math.min(c[2], Math.max(x, plane)) + 0.05) return true;
    } else {
      if (c[2] < x - 1.6 || c[0] > x + 1.6) continue;
      if (Math.max(c[1], Math.min(z, plane)) <= Math.min(c[3], Math.max(z, plane)) + 0.05) return true;
    }
  }
  return false;
}

function updateMonster(dt, t) {
  const m = S.mon, g = S.monster;
  if (S.jumpscare) {
    g.userData.setCrawl?.(0, 1, WALL_H, true);
    g.position.set(m.x, heightAt(S.map, S.me.L, m.x, m.z) - 0.35, m.z); g.rotation.y = m.yaw;
    g.userData.update(dt, 0, 'chase', t);
    return;
  }
  const ox = m.x, oz = m.z;
  const smp = sampleBuf(m.buf, performance.now() - INTERP_MS);
  const jump = smp ? Math.hypot(smp.x - m.x, smp.z - m.z) > 6 : false; // teleport
  if (smp) { m.x = smp.x; m.z = smp.z; m.yaw = angLerp(m.yaw, smp.yaw, Math.min(1, dt * 12)); }
  const moved = jump ? 0 : Math.hypot(m.x - ox, m.z - oz);
  m.vis += (moved / Math.max(dt, 1e-3) - m.vis) * Math.min(1, dt * 6);
  let my = heightAt(S.map, m.L || 0, m.x, m.z);
  if (m.boundT) { m.boundT += dt; my -= Math.min(3.2, Math.max(0, m.boundT - 1.5) * 0.45); } // bound: she burns and sinks into the star
  g.position.set(m.x, my, m.z); g.rotation.y = m.yaw;
  // on the ceiling or a wall? (server says which; find the wall on that side, or use the ceiling if there is none)
  let mode = m.crawl || 0, wallD = 1;
  if (mode !== m.crawlWas) { m.crawlWas = mode; m.crawlCeil = false; }
  if (mode >= 2 && !m.crawlCeil) {
    const sd = mode === 3 ? 1 : -1, rx = Math.cos(m.yaw) * sd, rz = -Math.sin(m.yaw) * sd; // her right (or left)
    const ci = Math.floor(m.x / CELL), cj = Math.floor(m.z / CELL), ax = Math.abs(rx) > Math.abs(rz);
    if (isWall(S.map, m.L || 0, ci + (ax ? Math.sign(rx) : 0), cj + (ax ? 0 : Math.sign(rz)))) {
      const plane = ax ? (ci + (rx > 0 ? 1 : 0)) * CELL : (cj + (rz > 0 ? 1 : 0)) * CELL;
      wallD = clamp(Math.abs(plane - (ax ? m.x : m.z)) / Math.max(0.5, Math.abs(ax ? rx : rz)), 0.45, 2.2);
      // a locker or wardrobe against that wall would swallow her: take the ceiling instead
      if (furnitureAlongWall(m.L || 0, m.x, m.z, ax, plane)) m.crawlCeil = true;
    } else m.crawlCeil = true; // no wall here (doorway, open room): stay on the ceiling for this climb
  }
  if (mode >= 2 && m.crawlCeil) mode = 1;
  g.userData.setCrawl?.(mode, wallD, WALL_H);
  const st = m.state === 'chase' && m.speed < 0.05 ? 'stall' : m.state === 'bound' ? 'stunned' : m.state;
  // up close while she hunts you (or while she stares at you) her hair parts and you see her face
  const camD = Math.hypot(m.x - camera.position.x, m.z - camera.position.z);
  g.userData.reveal = !mode && (m.L || 0) === S.camL && ((m.state === 'chase' && camD < 7) || m.state === 'stare' || m.state === 'sniff' && camD < 4) ? 1 : 0;
  g.userData.update(dt, m.vis, st, t);
  // hide her if her floor isn't drawn (keep the root visible: it holds a light)
  const shown = levelShown(m.L || 0) && !(m.boundT > 9);
  for (const ch of g.children) if (!ch.isLight) ch.visible = shown;
  if (g.userData.glow && (!shown || (m.L || 0) !== S.camL)) g.userData.glow.intensity = 0;
  m.step += moved;
  if (m.step > (m.crawl ? 0.9 : 1.5)) {
    m.step = 0;
    if (m.crawl) audio.skitter(m.x, m.z, m.state === 'chase' ? 0.7 : 0.45); // nails on plaster
    else audio.step(m.state === 'chase' ? 0.7 : 0.45, { x: m.x, z: m.z }, true);
  }
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
    const list = W.lightSources.filter((s) => !s.dead && (s.L ?? 0) === S.camL).map((s) => [Math.hypot(s.x - cx, s.z - cz), s]).sort((a, b) => a[0] - b[0]);
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
  if (S.torchCtl && t < S.torchCtl.until) k = S.torchCtl.k;
  if (S.jumpscare) k = 1;
  const batt = me.alive ? 0.55 + 0.45 * Math.min(1, me.battery / 30) : 1;
  flashlight.intensity = fl ? S.tune.fl * k * batt : 0;
  playerGlow.intensity = S.jumpscare ? 3 : me.hidden ? 0.06 : (S.torchCtl && t < S.torchCtl.until && S.torchCtl.k === 0) ? 0 : 1.2;
  if (S.viewmodel) {
    const vm = S.viewmodel;
    vm.g.visible = me.alive && !me.escaped && !me.hidden && !S.jumpscare && S.spectating === null;
    const bobK = me.moving ? (me.sprint ? 1.8 : 1) : 0;
    vm.g.position.set(0.24 + Math.sin(me.bob * 0.5) * 0.012 * bobK, -0.25 + Math.abs(Math.cos(me.bob * 0.5)) * 0.012 * bobK - (me.crouch ? 0.02 : 0), -0.42);
    vm.lensM.color.setHex(fl && flashlight.intensity > 1 ? 0xfff4dc : 0x333333);
  }
  for (const r of S.players.values()) { const Lt = r.avatar.userData.light; Lt.intensity = Lt.userData.on && r.alive && !r.escaped && !r.hid && r.L === S.camL && S.spectating !== r.id ? S.tune.remote : 0; }

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
  const here = (o) => (o.L ?? 0) === me.L;
  for (const [id, tl] of S.world.talismans) if (!tl.taken && here(tl)) consider(id, tl.x, tl.z, 2.4, `Take the ${tl.name.toLowerCase()}`);
  for (const [id, b] of S.world.batteries) if (!b.taken && here(b)) consider(id, b.x, b.z, 1.9, 'Pick up battery');
  for (const [id, b] of S.world.bells) if (!b.taken && here(b)) consider(id, b.x, b.z, 1.9, 'Take the spirit bell');
  for (const [id, c] of S.world.souls) if (!c.taken && here(c)) consider(id, c.x, c.z, 1.9, 'Take the aatma candle');
  // a fallen friend: hold E with a soul candle to bring them back
  for (const r of S.players.values()) {
    if (r.alive || r.escaped || r.L !== me.L) continue;
    const d = Math.hypot(r.x - me.x, r.z - me.z);
    if (d > 2.4) continue;
    if (me.revives > 0) {
      if (S.reviving && S.reviving.id === r.id) {
        if (!held('interact') || d > 2.6) S.reviving = null;
        else {
          const tt = (performance.now() - S.reviving.start) / 1000;
          setPrompt(`<b>E</b>Bringing ${esc(r.name)} back… <span style="display:inline-block;width:160px;height:6px;background:#012;vertical-align:middle"><i style="display:block;height:100%;width:${Math.round(Math.min(100, tt / 3 * 100))}%;background:#7fd0ff"></i></span>`);
          if (tt >= 3 && !S.reviving.sent) { S.reviving.sent = true; send({ t: 'revive', id: r.id }); }
          S.prompt = { id: 'revive', revive: true, target: r.id };
          return;
        }
      }
      best = { id: 'revive', revive: true, target: r.id, label: `Hold E to revive ${esc(r.name)} (aatma candle)` };
    } else best = { id: 'nocandle', label: `Find an aatma candle to revive ${esc(r.name)}` };
    break;
  }
  for (const [id, n] of S.world.notes) if (here(n)) consider(id, n.x, n.z, 1.8, n.read ? 'Read the note again' : 'Read the note');
  if (!best) for (const [id, h] of S.world.hides) if (here(h)) consider(id, h.x + h.fx * (h.type === 'bed' ? 1.15 : 0.5), h.z + h.fz * (h.type === 'bed' ? 1.15 : 0.5), 1.7, h.type === 'bed' ? 'Hide under the bed' : `Hide in the ${h.type}`);
  if (S.bp && !S.bp.holder && here(S.bp) && !best) consider('bp', S.bp.x, S.bp.z, 2.3, 'Take the house blueprint');
  if (best && best.id[0] === 'h') best.hide = true;
  if (best && best.id[0] === 'n') best.note = true;
  if (me.hidden) { const ht = S.world.hides.get(me.hidden)?.type || 'locker'; setPrompt(ht === 'bed' ? '<b>E</b>Crawl out from under the bed' : `<b>E</b>Get out of the ${ht}`); S.prompt = null; return; }
  // the shrine: place carried items on the star, then lure her in
  const sh = S.world.shrine;
  if (me.L === sh.L && Math.hypot(sh.x - me.x, sh.z - me.z) < sh.r + 3) {
    if (S.stage === 'items' && me.items.length) {
      let bd = 2.3;
      sh.points.forEach((pt, slot) => {
        if (S.placed[slot]) return;
        const d = Math.hypot(pt.x - me.x, pt.z - me.z);
        if (d < bd) { bd = d; best = { id: 'slot' + slot, place: true, slot, label: `Place the ${S.world.talismans.get(me.items[0]).name.toLowerCase()} on the star` }; }
      });
    } else if (S.stage === 'lure' && !best) { setPrompt('MAKE HER FOLLOW YOU INTO THE CENTRE OF THE STAR'); S.prompt = null; return; }
  }
  S.prompt = best;
  if (best) setPrompt(`<b>E</b>${best.label}`);
  else if (S.exitOpen && me.L === 0 && Math.hypot(me.x - S.map.exit.x, me.z - S.map.exit.z) < 6) setPrompt('GO THROUGH THE DOOR');
  else setPrompt('');
}

let hudT = 0, hudKey = '', teamKey = '';
function updateHUD(dt) {
  const me = S.me;
  const fl = (LEVEL_NAMES[S.camL] || '').toUpperCase();
  if ($('floorTag').textContent !== fl) $('floorTag').textContent = fl;
  const hk = `${Math.round(me.battery)}|${Math.round(me.stamina)}|${me.exhausted}|${me.bells}|${me.revives}`;
  if (hk !== hudKey) {
    hudKey = hk;
    $('battery').querySelector('i').style.width = Math.round(me.battery) + '%';
    $('battery').classList.toggle('low', me.battery < 20);
    $('stamina').querySelector('i').style.width = Math.round(me.stamina) + '%';
    $('stamina').querySelector('i').style.background = me.exhausted ? '#7a3020' : '';
    $('bellCount').innerHTML = (me.bells > 0 ? `SPIRIT BELLS ×${me.bells}  [Q]<br>` : '') + (me.revives > 0 ? `<span style="color:#9fd8ff">AATMA CANDLES ×${me.revives}</span>` : '');
  }
  hudT -= dt;
  if (hudT > 0) return;
  hudT = 0.3;
  const talk = (id) => (S.voice && S.voice.speaking(id) ? ' 🔊' : '');
  const rows = S.spectator ? [] : [`<div style="color:${S.myColor}" class="${me.alive ? '' : 'dead'}">${esc(S.name)} ${me.escaped ? '✓' : me.alive ? '' : '✕'}${talk(S.myId)}</div>`];
  for (const r of S.players.values()) rows.push(`<div style="color:${r.color}" class="${r.alive ? '' : 'dead'}">${esc(r.name)} ${r.escaped ? '✓' : r.alive ? '' : '✕'}${talk(r.id)}</div>`);
  if (S.voice && S.voice.status()) rows.push(`<div style="color:#7d7464;font-size:11px;font-weight:400">${esc(S.voice.status())}</div>`);
  const tk = rows.join('');
  if (tk !== teamKey) { teamKey = tk; $('team').innerHTML = tk; }
}

function updateAudioAndFear(dt, t) {
  const me = S.me, m = S.mon;
  const fwd = tmpV.set(0, 0, -1).applyEuler(camera.rotation);
  audio.setListener(camera.position, fwd);
  audio.listenerPos = camera.position;
  const dl = Math.abs((m.L || 0) - S.camL);
  const d = dl ? 99 : Math.hypot(m.x - camera.position.x, m.z - camera.position.z);
  const active = m.state !== 'dormant' && m.state !== 'bound';
  const chasingMe = m.state === 'chase' && m.target === S.myId && me.alive;
  const vis = active && d < 22 && lineOfSight(S.map, S.camL, camera.position.x, camera.position.z, m.x, m.z);
  const level = !active ? 0 : m.state === 'chase' || m.state === 'stunned' ? 1 : m.state === 'hunt' ? 0.6 : 0.4;
  audio.setMonster(m.x, m.z, level * 0.7 * (dl === 0 ? 1 : dl === 1 ? 0.3 : 0), m.state === 'chase');
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

// ---------------- which floors to draw ----------------
const levelVis = { '-1': true, 0: true, 1: true };
function levelShown(L) { return levelVis[L]; }
function updateLevels() {
  const cx = camera.position.x, cz = camera.position.z;
  const all = S.spectator && !S.droneFollow && S.me.droneY > FLOOR_H + 0.2;
  for (const L of LEVELS) {
    let v = L === S.camL || all;
    if (!v && Math.abs(L - S.camL) === 1) {
      // near a staircase you can see the floor above/below through the stairwell
      for (const st of S.map.stairs) {
        if (!((st.L === L && st.L + 1 === S.camL) || (st.L === S.camL && st.L + 1 === L))) continue;
        if (Math.hypot((st.c2[0] + 0.5) * CELL - cx, (st.c2[1] + 0.5) * CELL - cz) < 9) { v = true; break; }
      }
    }
    levelVis[L] = v; S.world.levelGroups[L].visible = v;
  }
  for (const r of S.players.values()) if (!levelVis[r.L] && !r.escaped) { r.avatar.userData.setShown(false); r.avatar.userData.label.visible = false; }
}

// ---------------- main loop ----------------
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const t = now / 1000;
  if (S.phase === 'menu' || S.phase === 'lobby' || S.phase === 'joining') { drawGrain(); return; }
  if (S.phase !== 'playing' || !S.scene || !S.me) { if (S.composer && S.scene) S.composer.render(dt); return; }
  if (S.intro) { if (!S.me.alive && !S.spectator) { S.intro.abort(); S.intro = null; } else { S.intro.frame(); return; } }
  const me = S.me;
  if (S.reading && (!me.alive || (S.mon.state === 'chase' && S.mon.target === S.myId))) closeNote();
  if (!S.spectator && S.spectating === null) S.camL = me.L;
  if (S.spectator) updateDrone(dt);
  else if (me.alive && !me.escaped && !S.jumpscare) updatePlayer(dt, t);
  else if (S.jumpscare) {
    camera.position.set(me.x, me.L * FLOOR_H + 1.5, me.z);
    camera.rotation.set(me.pitch + (Math.random() - 0.5) * 0.08, me.yaw + (Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.1);
  } else if (S.spectating !== null) updateSpectate(dt);
  updateRemotes(dt);
  updateLevels();
  updateMonster(dt, t);
  updateCrawler(dt, t);
  S.statues?.update(dt, camera, S.camL, audio);
  updatePings();
  updateNameTags();
  S.voice?.update(dt, { me: S.me, players: S.players, held, camL: S.camL });
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
applySettings(); // the saved settings, now that everything they touch exists
window.__hm.frame = frame; // lets automated tests step the game while the tab is hidden
window.__hm.S = S; window.__hm.keys = keys; window.__hm.runScare = (type) => runScare(performance.now() / 1000, type);
window.__hm.playEnding = () => playEnding(); window.__hm.onMsg = (m) => handle(m);
