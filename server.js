// CHUDAIL — multiplayer horror server
// Serves the game and runs the authoritative game state + monster AI.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { spawn } from 'node:child_process';
import {
  CELL, TALISMANS, DIFFICULTY, GHOST_TYPES, generateMap, mapSignature, cellType, bfsPath3, lineOfSight, resolveCircle, resolveSolid, isWall, cellOf, stairTransition,
} from './shared/map.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const MAX_PLAYERS = 6;
const TICK = 1 / 20;
const COLORS = ['#e8c45a', '#5aa8e8', '#e85a8c', '#6ee08a', '#b48cff', '#ff9a4a'];
const CHARS = ['adventurer', 'soldier', 'hoodie', 'woman', 'man', 'punk', 'casual', 'hooded'];

// ---------------- static files ----------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css',
  '.json': 'application/json', '.mp4': 'video/mp4', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
const ROOTS = [
  ['/vendor/three/', path.join(__dirname, 'node_modules/three/')],
  ['/shared/', path.join(__dirname, 'shared/')],
  ['/', path.join(__dirname, 'public/')],
];

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/info') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ lan: lanAddresses().map((a) => `http://${a}:${PORT}`), publicUrl: game.publicUrl || null, players: game.players.size, phase: game.phase }));
    return;
  }
  for (const [prefix, dir] of ROOTS) {
    if (!url.startsWith(prefix)) continue;
    let rel = url.slice(prefix.length) || 'index.html';
    const file = path.normalize(path.join(dir, rel));
    if (!file.startsWith(dir)) break;
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(data);
    });
    return;
  }
  res.writeHead(404); res.end('not found');
});

// ---------------- game state ----------------
const game = {
  phase: 'lobby', players: new Map(), map: null, seed: 0, monster: null, difficulty: 'normal',
  talismans: [], batteries: [], bells: [], souls: [], progress: 0, placed: [null, null, null, null, null],
  exitOpen: false, startTime: 0, nextScare: 0, endTimer: null, time: 0, stage: 'items',
};
let nextId = 1;

const send = (p, msg) => { if (p.ws.readyState === 1) p.ws.send(JSON.stringify(msg)); };
const spectators = new Set(); // hidden admins: receive everything, invisible to players
const broadcast = (msg) => { const s = JSON.stringify(msg); for (const p of game.players.values()) if (p.ws.readyState === 1) p.ws.send(s); for (const w of spectators) if (w.readyState === 1) w.send(s); };
const now = () => game.time;
const rand = (a, b) => a + Math.random() * (b - a);
const INTRO_S = 95; // intro cut scene (public/intro.js): ~55 s drive + silent co-op chat, the crash, ~17 s dragged into the house; she sleeps through it
const frontOf = (h) => (h.type === 'bed' ? 1.55 : 0.95); // where you stand in front of a hiding spot
const D = () => DIFFICULTY[game.difficulty] || DIFFICULTY.normal;
const pickRand = (arr) => arr[Math.floor(Math.random() * arr.length)];

function lobbyMsg() {
  return { t: 'lobby', phase: game.phase, difficulty: game.difficulty, countdown: game.countdown ? Math.max(0, game.countdownAt - now()) : 0, publicUrl: game.publicUrl || null, players: [...game.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color, char: p.char })) };
}

function freeColor() {
  const used = new Set([...game.players.values()].map((p) => p.color));
  return COLORS.find((c) => !used.has(c)) || COLORS[0];
}

function startMsg() {
  return {
    t: 'start', seed: game.seed, intro: now() - game.startTime < 4, sig: mapSignature(game.map), difficulty: game.difficulty,
    players: [...game.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color, char: p.char, x: p.x, z: p.z, L: p.L, alive: p.alive, escaped: p.escaped, items: p.items })),
    taken: [...game.talismans, ...game.batteries, ...game.bells, ...game.souls].filter((i) => i.taken).map((i) => i.id),
    moved: game.talismans.filter((i) => i.moved).map((i) => ({ id: i.id, x: i.x, z: i.z, L: i.L })),
    progress: game.progress, placed: game.placed, exitOpen: game.exitOpen, stage: game.stage,
    ghostType: game.ghostType || 'chudail',
    bp: game.bp ? { holder: game.bp.holder, x: game.bp.x, z: game.bp.z, L: game.bp.L, onTable: game.bp.onTable } : null,
  };
}

function startGame() {
  game.seed = (Math.random() * 2 ** 31) >>> 0;
  game.map = generateMap(game.seed);
  const m = game.map, d = D();
  game.talismans = m.talismans.map((t) => ({ ...t, taken: false }));
  // fewer supplies on harder difficulties (removed items start "taken")
  const thin = (list, mult) => list.map((b, i) => ({ ...b, taken: i >= Math.round(list.length * Math.min(1, mult)) }));
  game.batteries = thin(m.batteries, d.items);
  game.bells = thin(m.bells, d.items);
  game.bp = { ...m.blueprint, holder: null, onTable: true }; // the one blueprint of the house
  { const types = Object.keys(GHOST_TYPES); game.ghostType = types[Math.floor(Math.random() * types.length)]; } // what she is tonight
  game.souls = thin(m.souls, d.revive);
  game.progress = 0; game.placed = [null, null, null, null, null];
  game.exitOpen = false; game.sniffed = {}; game.stage = 'items';
  game.crawler = { x: 0, z: 0, L: 0, yaw: 0, state: 'gone', t: now() + 20, target: null, path: null, pathT: -9, pi: 0 };
  game.startTime = now(); game.nextScare = now() + 45 + INTRO_S + Math.random() * 25;
  let n = 0;
  for (const p of game.players.values()) spawnPlayer(p, n++);
  game.monster = {
    x: m.monsterSpawn.x, z: m.monsterSpawn.z, L: m.monsterSpawn.L, yaw: 0, state: 'dormant', target: null,
    goal: null, path: null, pi: 0, pathT: -9, goalKey: -1, stall: 0, lostT: 0, huntT: 0, feedT: 0,
    lastSeen: null, farT: 0, stuckT: 0, lit: false, lunge: false, speed: 0, crawl: 0, crawlT: 10,
  };
  game.phase = 'playing';
  broadcast(startMsg());
  console.log(`[game] started with ${game.players.size} player(s), seed ${game.seed}, ${game.difficulty}`);
}

function spawnPlayer(p, n) {
  const s = game.map.spawns[n % game.map.spawns.length];
  Object.assign(p, { x: s[0], z: s[1], L: 0, yaw: Math.PI / 2, pitch: 0, fl: true, cr: false, sp: false, sn: false, mv: false, alive: true, escaped: false, hid: null, bells: 0, revives: 0, items: [] });
}

function activePlayers() { return [...game.players.values()].filter((p) => p.alive && !p.escaped); }
function preyPlayers() { const t = now(); return activePlayers().filter((p) => !(p.graceUntil > t)); } // late joiners get a few seconds

function endGame() {
  if (game.phase !== 'playing') return;
  game.phase = 'ended';
  const list = [...game.players.values()].map((p) => ({ name: p.name, color: p.color, alive: p.alive, escaped: p.escaped }));
  const win = list.some((p) => p.escaped);
  broadcast({ t: 'end', win, players: list });
  console.log(`[game] ended — ${win ? 'escaped' : 'everyone died'}`);
  clearTimeout(game.endTimer);
  game.endTimer = setTimeout(() => { game.phase = 'lobby'; game.monster = null; broadcast(lobbyMsg()); }, 11000);
}

function checkEnd() { if (game.phase === 'playing' && activePlayers().length === 0) endGame(); }

// ---------------- helpers ----------------
function randomFloorNear(L, cx, cz, minC, maxC) {
  const map = game.map;
  for (let t = 0; t < 60; t++) {
    const i = cellOf(cx) + Math.round((Math.random() * 2 - 1) * maxC);
    const j = cellOf(cz) + Math.round((Math.random() * 2 - 1) * maxC);
    if (isWall(map, L, i, j)) continue;
    const d = Math.max(Math.abs(i - cellOf(cx)), Math.abs(j - cellOf(cz)));
    if (d < minC) continue;
    return { x: (i + 0.5) * CELL, z: (j + 0.5) * CELL, L };
  }
  return null;
}
function setGoal(m, g) { m.goal = g; m.pathT = -9; }
function clearPath(L, x0, z0, x1, z1) {
  const map = game.map;
  const dx = x1 - x0, dz = z1 - z0, d = Math.hypot(dx, dz) || 1;
  const px = (-dz / d) * 0.3, pz = (dx / d) * 0.3;
  return lineOfSight(map, L, x0 + px, z0 + pz, x1 + px, z1 + pz) && lineOfSight(map, L, x0 - px, z0 - pz, x1 - px, z1 - pz);
}
// carried ritual items fall where you die so someone else can bring them to the star
// the blueprint: whoever holds it drops it where they fall (or leave); if they get out, it goes back on its table
function bpMsg(extra = {}) { const b = game.bp; return { t: 'ev', e: 'bp', holder: b.holder, x: b.x, z: b.z, L: b.L, onTable: b.onTable, ...extra }; }
function dropBlueprint(p) {
  const b = game.bp; if (!b || b.holder !== p.id) return;
  Object.assign(b, { holder: null, x: p.x + rand(-0.3, 0.3), z: p.z + rand(-0.3, 0.3), L: p.L, onTable: false });
  broadcast(bpMsg({ by: p.id, why: 'drop' }));
}
function dropItems(p) {
  dropBlueprint(p);
  for (const id of p.items || []) {
    const it = game.talismans.find((q) => q.id === id);
    if (!it) continue;
    it.taken = false; it.moved = true; it.x = p.x + rand(-0.4, 0.4); it.z = p.z + rand(-0.4, 0.4); it.L = p.L;
    broadcast({ t: 'ev', e: 'drop', id, x: it.x, z: it.z, L: it.L, by: p.id });
  }
  p.items = [];
}
function killPlayer(p, dragged = false, by = null) {
  const m = game.monster;
  console.log(`[kill] ${p.name} (${by ? 'the crawler' : dragged ? 'pulled out of a hiding place' : 'caught'})`);
  p.alive = false;
  if (p.hid) { const h = game.map.hides.find((q) => q.id === p.hid); p.x = h.x + h.fx * frontOf(h); p.z = h.z + h.fz * frontOf(h); p.hid = null; }
  dropItems(p);
  const src = by || m;
  broadcast({ t: 'ev', e: 'kill', id: p.id, x: p.x, z: p.z, L: p.L, mx: src.x, mz: src.z, dragged, crawler: !!by });
  if (!by) { m.state = 'feed'; m.feedT = 5; m.target = null; }
  checkEnd();
}

// steer an entity (monster/crawler) along a multi-floor path towards goal {x,z,L}
function followPath(e, goal, t) {
  const map = game.map, N = map.W * map.H;
  const gL = goal.L ?? e.L, gi = cellOf(goal.x), gj = cellOf(goal.z);
  const key = (gL + 1) * N + gj * map.W + gi;
  if (t - e.pathT > 0.5 || key !== e.goalKey || !e.path) {
    e.path = bfsPath3(map, e.L, cellOf(e.x), cellOf(e.z), gL, gi, gj) || [];
    e.pi = 0; e.pathT = t; e.goalKey = key;
  }
  // skip ahead to the farthest waypoint on this floor with a clear line
  for (let k = Math.min(e.path.length - 1, e.pi + 4); k > e.pi; k--) {
    let same = true; for (let q = e.pi; q <= k; q++) if (e.path[q][0] !== e.L) { same = false; break; }
    if (!same) continue;
    const [, wi, wj] = e.path[k];
    if (clearPath(e.L, e.x, e.z, (wi + 0.5) * CELL, (wj + 0.5) * CELL)) { e.pi = k; break; }
  }
  if (e.pi < e.path.length) {
    const [wl, wi, wj] = e.path[e.pi];
    const tx = (wi + 0.5) * CELL, tz = (wj + 0.5) * CELL;
    if (wl === e.L && Math.hypot(tx - e.x, tz - e.z) < 0.35) e.pi++;
    return [tx, tz];
  }
  return gL === e.L ? [goal.x, goal.z] : null;
}
// move with collision, then take the stairs if pressed against the top/bottom
function moveEntity(e, tx, tz, speed, dt, radius) {
  const dx = tx - e.x, dz = tz - e.z, d = Math.hypot(dx, dz);
  if (d < 0.05) return 0;
  const step = Math.min(d, speed * dt);
  const ox = e.x, oz = e.z;
  [e.x, e.z] = resolveSolid(game.map, e.L, e.x + (dx / d) * step, e.z + (dz / d) * step, radius);
  const tr = stairTransition(game.map, e.L, e.x, e.z);
  if (tr) { [e.L, e.x, e.z] = tr; e.path = null; }
  const want = Math.atan2(-dx, -dz);
  let diff = want - e.yaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  e.yaw += diff * Math.min(1, dt * 8);
  return Math.hypot(e.x - ox, e.z - oz) / step;
}

// ---------------- monster AI ----------------
function updateMonster(dt) {
  const m = game.monster, map = game.map;
  if (!m) return;
  const t = now(), d0 = D(), G = GHOST_TYPES[game.ghostType] || GHOST_TYPES.chudail;
  const d = { ...d0, sight: d0.sight * G.sight, hearing: d0.hearing * G.hearing, speed: d0.speed * G.speed };
  const targets = preyPlayers();
  if (m.state === 'bound') { m.speed = 0; m.lit = false; return; }
  if (t < game.startTime + 18 + INTRO_S) { m.state = 'dormant'; m.speed = 0; return; }
  if (!targets.length) return;
  if (m.state === 'dormant') { m.state = 'wander'; m.goal = null; }

  // the trap: once the star is complete, she is bound if she steps into the centre
  if (game.stage === 'lure' && m.L === map.shrine.L && Math.hypot(m.x - map.shrine.x, m.z - map.shrine.z) < map.shrine.center + 0.9) {
    m.state = 'bound'; m.speed = 0; game.stage = 'escape'; game.exitOpen = true;
    if (game.crawler) game.crawler.state = 'gone';
    broadcast({ t: 'ev', e: 'bound', x: m.x, z: m.z });
    broadcast({ t: 'ev', e: 'stage', stage: 'escape' });
    console.log('[game] she is bound');
    return;
  }

  const bonus = game.progress * 0.25 + (game.stage === 'lure' ? 0.5 : 0);

  if (m.stunT > 0) {
    m.stunT -= dt; m.state = 'stunned'; m.speed = 0; m.lit = false;
    if (m.stunT <= 0) { m.state = 'wander'; m.goal = null; m.huntLocker = null; }
    return;
  }
  if (m.state === 'feed') {
    m.feedT -= dt; m.speed = 0;
    if (m.feedT <= 0) { m.state = 'wander'; m.goal = null; }
    return;
  }

  // --- the stare: you spotted her down the hall and she stops dead and looks back at you.
  // Then she either charges or is simply gone.
  if (m.state === 'stare') {
    m.speed = 0; m.stareT -= dt;
    const tp = game.players.get(m.target);
    const ok = tp && tp.alive && !tp.escaped && !tp.hid && tp.L === m.L;
    if (ok) { const want = Math.atan2(-(tp.x - m.x), -(tp.z - m.z)); let df = want - m.yaw; while (df > Math.PI) df -= Math.PI * 2; while (df < -Math.PI) df += Math.PI * 2; m.yaw += df * Math.min(1, dt * 3); }
    const close = ok && Math.hypot(tp.x - m.x, tp.z - m.z) < 6;
    if (m.stareT <= 0 || close || !ok) {
      if (ok && (close || Math.random() < 0.55)) {
        m.state = 'chase'; m.lostT = 0; m.lastSeen = { x: tp.x, z: tp.z, L: tp.L }; m.stall = 0;
        broadcast({ t: 'ev', e: 'chase', id: tp.id, charge: true });
      } else {
        const from = { x: m.x, z: m.z, L: m.L };
        for (let k = 0; k < 40; k++) {
          const p = tp || pickRand(targets);
          const s = p && randomFloorNear(p.L, p.x, p.z, 6, 12);
          if (s && !targets.some((q) => q.L === s.L && lineOfSight(map, s.L, s.x, s.z, q.x, q.z) && Math.hypot(q.x - s.x, q.z - s.z) < 25)) {
            m.x = s.x; m.z = s.z; m.L = s.L; m.goal = null; m.path = null; break;
          }
        }
        m.state = 'wander'; m.crawl = 0;
        broadcast({ t: 'ev', e: 'vanish', x: from.x, z: from.z, L: from.L });
      }
    }
    return;
  }

  // --- perception (same floor only)
  const fwdX = -Math.sin(m.yaw), fwdZ = -Math.cos(m.yaw);
  let seen = null, seenD = 1e9, lit = false, litBy = null, minD = 1e9;
  for (const p of targets) {
    if (p.L !== m.L) continue;
    const dx = p.x - m.x, dz = p.z - m.z, dist = Math.hypot(dx, dz);
    minD = Math.min(minD, dist);
    if (dist > 20 * d.sight || p.hid) continue;
    if (!lineOfSight(map, m.L, m.x, m.z, p.x, p.z)) continue;
    if (p.fl && dist < 11) {
      const lx = -Math.sin(p.yaw), lz = -Math.cos(p.yaw);
      const dot = (-dx * lx + -dz * lz) / (dist || 1);
      if (dot > 0.95 && Math.abs(p.pitch) < 0.7) { lit = true; litBy = p; }
    }
    const range = (p.cr ? (p.fl ? 8 : 2.2) : p.fl ? 15 : 7) * d.sight;
    const near = p.cr && !p.fl ? 1.1 : 2.4;
    const facing = (dx * fwdX + dz * fwdZ) / (dist || 1);
    const visible = dist < near || (dist < range && (facing > (p.cr ? 0.5 : 0.25) || (!p.cr && dist < 5)));
    if (visible && dist < seenD) { seen = p; seenD = dist; }
  }
  if (!seen && lit && !G.blind) { seen = litBy; seenD = Math.hypot(litBy.x - m.x, litBy.z - m.z); }
  // the Hungry One: every so often she simply knows where the nearest of you is
  if (G.sense && !seen && m.state === 'wander' && t > (m.senseT || 0)) {
    m.senseT = t + G.sense;
    let near = null, nd = 1e9; for (const p of targets) { if (p.hid) continue; const dd = Math.hypot(p.x - m.x, p.z - m.z) + (p.L !== m.L ? 30 : 0); if (dd < nd) { nd = dd; near = p; } }
    if (near) { m.state = 'hunt'; m.huntT = 0; setGoal(m, { x: near.x, z: near.z, L: near.L }); }
  }
  m.lit = lit;

  // --- hearing (same floor)
  let noise = null;
  for (const p of targets) {
    if (p.voiceT && now() - p.voiceT < 0.8 && !p.hid && p.L === m.L && Math.hypot(p.x - m.x, p.z - m.z) < 11 * d.hearing) { noise = { x: p.x, z: p.z, L: p.L }; break; } // loud voices carry
    if (!p.mv || p.hid || p.L !== m.L) continue;
    const dist = Math.hypot(p.x - m.x, p.z - m.z);
    const r = (p.sp ? 17 : (p.cr || p.sn) ? 0 : 6) * d.hearing;
    if (dist < r) { noise = { x: p.x, z: p.z, L: p.L }; break; }
  }

  // --- state machine
  if (seen && m.state !== 'chase' && !m.crawl && seenD > 9 && t > (m.stareNext || 0)) {
    // is that player actually looking at her? then she stares back instead of running at once
    const lx = -Math.sin(seen.yaw), lz = -Math.cos(seen.yaw);
    const look = ((m.x - seen.x) * lx + (m.z - seen.z) * lz) / seenD;
    if (look > 0.9 && Math.random() < 0.5) {
      m.state = 'stare'; m.stareT = rand(1.8, 3.2); m.target = seen.id; m.stareNext = t + rand(25, 45);
      broadcast({ t: 'ev', e: 'stare', id: seen.id });
      return;
    }
    m.stareNext = t + 4;
  }
  if (seen) {
    if (m.state !== 'chase') {
      m.stall = 0.85; broadcast({ t: 'ev', e: 'chase', id: seen.id });
      // sometimes she sees you and goes up the wall or onto the ceiling to come for you
      if (!m.crawl && Math.random() < 0.4) { m.crawl = 1 + Math.floor(Math.random() * 3); m.crawlT = rand(2.5, 4.5); }
    }
    m.state = 'chase'; m.target = seen.id; m.lostT = 0; m.huntLocker = null;
    m.lastSeen = { x: seen.x, z: seen.z, L: seen.L };
  } else if (m.state === 'chase') {
    m.lostT += dt;
    const tp = game.players.get(m.target);
    if (tp && tp.alive && !tp.escaped && m.lostT < 2.2) m.lastSeen = { x: tp.x, z: tp.z, L: tp.L }; // she can smell you briefly
    if (m.lostT > 6) { m.state = 'hunt'; m.huntT = 0; setGoal(m, m.lastSeen); }
  } else if (noise) {
    if (m.state !== 'hunt' || !m.goal || Math.hypot(m.goal.x - noise.x, m.goal.z - noise.z) > 3) setGoal(m, noise);
    m.state = 'hunt'; m.huntT = 0;
  }

  if (m.state === 'hunt' && m.huntLocker) {
    const hl = m.huntLocker, tp = game.players.get(hl.pid);
    if (m.L === m.goal.L && Math.hypot(m.goal.x - m.x, m.goal.z - m.z) < 1.3) {
      m.huntLocker = null; m.state = 'sniff'; m.sniffT = 3; m.sniffYaw = hl.yaw;
      m.sniffKill = tp && tp.alive && tp.hid === hl.hid && Math.random() < 0.6 ? { pid: tp.id, hid: hl.hid } : null;
      broadcast({ t: 'ev', e: 'sniff', hid: hl.hid });
    }
  } else if (m.state === 'hunt') {
    m.huntT += dt;
    if (m.huntT > 16 || (m.goal && m.goal.L === m.L && Math.hypot(m.goal.x - m.x, m.goal.z - m.z) < 1)) {
      if (m.huntT < 16 && Math.random() < 0.6) setGoal(m, randomFloorNear(m.L, m.x, m.z, 2, 4) || m.goal);
      else { m.state = 'wander'; m.goal = null; }
    }
  }
  if (m.state === 'sniff') {
    m.sniffT -= dt; m.speed = 0;
    m.yaw += (m.sniffYaw - m.yaw) * Math.min(1, dt * 5);
    if (m.sniffT <= 0) {
      const k = m.sniffKill; m.sniffKill = null;
      const tp = k && game.players.get(k.pid);
      if (tp && tp.alive && tp.hid === k.hid) { killPlayer(tp, true); return; }
      m.state = 'wander'; m.goal = randomFloorNear(m.L, m.x, m.z, 3, 8); m.pathT = -9;
    }
    return;
  }
  if (m.state === 'wander' || m.state === 'hunt') {
    for (const p of targets) {
      if (!p.hid || p.L !== m.L) continue;
      const h = map.hides.find((q) => q.id === p.hid);
      const fx = h.x + h.fx * frontOf(h), fz = h.z + h.fz * frontOf(h);
      if (Math.hypot(fx - m.x, fz - m.z) < 1.6 && (game.sniffed[h.id] || 0) < t) {
        game.sniffed[h.id] = t + 45;
        if (Math.random() < 0.3) { m.state = 'sniff'; m.sniffT = rand(2.5, 4.5); m.sniffYaw = Math.atan2(h.fx, h.fz); broadcast({ t: 'ev', e: 'sniff', hid: h.id }); return; }
      }
    }
  }
  if (m.state === 'wander') {
    if (!m.goal || (m.goal.L === m.L && Math.hypot(m.goal.x - m.x, m.goal.z - m.z) < 1)) {
      let g = null;
      const sh = map.shrine;
      if (game.stage === 'lure' && Math.random() < 0.6) g = randomFloorNear(sh.L, sh.x, sh.z, 1, 4); // drawn to the star
      else if (Math.random() < 0.55) { const p = pickRand(targets); g = randomFloorNear(p.L, p.x, p.z, 2, 7); }
      setGoal(m, g || randomFloorNear(m.L, m.x, m.z, 3, 12));
    }
    // keep pressure: if nobody is near her (or on her floor) for a while, appear closer to someone
    if (minD > 30) m.farT += dt; else m.farT = 0;
    if (m.farT > 25) {
      const p = pickRand(targets);
      for (let k = 0; k < 30; k++) {
        const s = randomFloorNear(p.L, p.x, p.z, 5, 8);
        if (s && !targets.some((q) => q.L === s.L && lineOfSight(map, s.L, s.x, s.z, q.x, q.z) && Math.hypot(q.x - s.x, q.z - s.z) < 25)) {
          m.x = s.x; m.z = s.z; m.L = s.L; m.farT = 0; m.goal = null; m.path = null; break;
        }
      }
    }
  }

  // --- speed
  let speed = (m.state === 'chase' ? 3.55 : m.state === 'hunt' ? 2.6 : 1.5) + bonus;
  // --- climbing: now and then she leaves the floor and crawls along the ceiling (1) or the left (2) / right (3)
  // wall. It only changes how she moves and looks; sight, hearing and paths are the same as on the floor.
  m.crawlT -= dt;
  const onStair = cellType(map, m.L, cellOf(m.x), cellOf(m.z)) === 3;
  const prey = m.state === 'chase' ? game.players.get(m.target) : null;
  const nearPrey = prey && prey.L === m.L && Math.hypot(prey.x - m.x, prey.z - m.z) < 2.6;
  if (m.crawl && (onStair || nearPrey || m.crawlT <= 0 || !['wander', 'hunt', 'chase'].includes(m.state))) {
    if (nearPrey) { m.stall = Math.max(m.stall, 0.4); broadcast({ t: 'ev', e: 'mdrop', x: m.x, z: m.z, L: m.L }); } // drops down in front of you
    m.crawl = 0; m.crawlT = rand(8, 16);
  } else if (!m.crawl && m.crawlT <= 0) {
    if (!onStair && !nearPrey && ['wander', 'hunt', 'chase'].includes(m.state) && Math.random() < (m.state === 'chase' ? 0.5 : 0.4)) {
      m.crawl = 1 + Math.floor(Math.random() * 3); m.crawlT = m.state === 'chase' ? rand(2.5, 4.5) : rand(5, 11);
    } else m.crawlT = rand(6, 14);
  }

  speed *= d.speed;
  if (m.crawl) speed *= m.state === 'chase' ? 1.08 : 1.25; // skittering
  m.lunge = false;
  if (m.state === 'chase' && seen && seenD < 3) { speed *= 1.3; m.lunge = true; }
  speed *= lit ? G.lit : G.dark; // the Shadow cannot move in torchlight at all
  if (m.stall > 0) { m.stall -= dt; speed = 0; }
  m.speed = speed;

  // --- steering
  let target = null;
  const chaseT = m.state === 'chase' ? game.players.get(m.target) : null;
  const sh = map.shrine;
  const inStar = (e, pad) => e.L === sh.L && Math.hypot(e.x - sh.x, e.z - sh.z) < sh.r + pad;
  // while the star burns, chasing someone inside it drags her into its centre
  if (game.stage === 'lure' && chaseT && inStar(chaseT, 0.6) && inStar(m, 4)) target = [sh.x, sh.z];
  else if (chaseT && seen === chaseT && clearPath(m.L, m.x, m.z, chaseT.x, chaseT.z)) target = [chaseT.x, chaseT.z];
  else {
    const goal = m.state === 'chase' ? m.lastSeen : m.goal;
    if (goal) target = followPath(m, goal, t);
  }
  if (target && speed > 0) {
    const r = moveEntity(m, target[0], target[1], speed, dt, 0.35);
    if (r < 0.2) { m.stuckT += dt; if (m.stuckT > 1) { m.path = null; m.stuckT = 0; if (m.state === 'wander') m.goal = null; } }
    else m.stuckT = 0;
  }

  // --- kill (only while chasing, same floor)
  for (const p of targets) {
    // while the star burns, she cannot touch anyone standing inside it
    const safe = game.stage === 'lure' && p.L === map.shrine.L && Math.hypot(p.x - map.shrine.x, p.z - map.shrine.z) < map.shrine.r + 0.6;
    if (!safe && !p.hid && !m.crawl && p.L === m.L && m.state === 'chase' && Math.hypot(p.x - m.x, p.z - m.z) < 1.05 && m.stall <= 0) { killPlayer(p); break; }
  }
}

// ---------------- the crawler (drops from the ceiling) ----------------
function updateCrawler(dt) {
  const c = game.crawler, t = now();
  if (!c) return;
  if (!D().crawler || game.progress < 1 || game.stage === 'escape') { c.state = 'gone'; return; }
  const targets = preyPlayers().filter((p) => !p.hid);
  if (c.state === 'gone') {
    if (t < c.t || !targets.length) return;
    const p = pickRand(targets);
    const s = randomFloorNear(p.L, p.x, p.z, 3, 7);
    if (s && !targets.some((q) => q.L === s.L && Math.hypot(q.x - s.x, q.z - s.z) < 7)) { c.x = s.x; c.z = s.z; c.L = s.L; c.state = 'ceiling'; c.t = t + 70; c.yaw = Math.random() * 6.28; }
    return;
  }
  if (c.state === 'ceiling') {
    for (const p of targets) {
      if (p.L === c.L && Math.hypot(p.x - c.x, p.z - c.z) < 2.4) {
        c.state = 'drop'; c.t = t + 1.4; c.target = p.id; c.yaw = Math.atan2(-(p.x - c.x), -(p.z - c.z));
        broadcast({ t: 'ev', e: 'crawlerDrop', id: p.id, x: c.x, z: c.z, L: c.L });
        return;
      }
    }
    if (t > c.t) { c.state = 'gone'; c.t = t + 5; }
    return;
  }
  if (c.state === 'drop') { if (t > c.t) { c.state = 'crawl'; c.t = t + 9; c.path = null; } return; }
  if (c.state === 'retreat') { if (t > c.t) { c.state = 'gone'; c.t = t + rand(25, 40); } return; }
  const p = game.players.get(c.target);
  if (!p || !p.alive || p.escaped || p.hid || t > c.t) { c.state = 'retreat'; c.t = t + 1.2; return; }
  const speed = (3.3 + game.progress * 0.2) * D().speed;
  const target = p.L === c.L && clearPath(c.L, c.x, c.z, p.x, p.z) ? [p.x, p.z] : followPath(c, { x: p.x, z: p.z, L: p.L }, t);
  if (target) moveEntity(c, target[0], target[1], speed, dt, 0.3);
  if (p.L === c.L && Math.hypot(p.x - c.x, p.z - c.z) < 0.9) {
    killPlayer(p, false, c);
    c.state = 'retreat'; c.t = t + 2;
  }
}

// ---------------- global scares ----------------
function updateScares() {
  if (now() < game.nextScare) return;
  const targets = activePlayers();
  if (!targets.length) return;
  game.nextScare = now() + 40 - game.progress * 4 + Math.random() * 35;
  const type = pickRand(['lights', 'bang', 'scream', 'whisper', 'lights', 'bang']);
  const p = pickRand(targets);
  const pos = randomFloorNear(p.L, p.x, p.z, 2, 5) || { x: p.x, z: p.z, L: p.L };
  broadcast({ t: 'ev', e: 'scare', type, x: pos.x, z: pos.z, L: pos.L });
}

// ---------------- loop ----------------
let last = Date.now();
setInterval(() => {
  const n = Date.now();
  const dt = Math.min(0.1, (n - last) / 1000);
  last = n; game.time += dt;
  if (game.phase !== 'playing') return;
  updateMonster(dt);
  updateCrawler(dt);
  updateScares();
  const m = game.monster, c = game.crawler;
  broadcast({
    t: 'snap',
    p: [...game.players.values()].map((p) => [p.id, +p.x.toFixed(2), +p.z.toFixed(2), +p.yaw.toFixed(3), +p.pitch.toFixed(3), p.fl ? 1 : 0, p.cr ? 1 : 0, p.alive ? 1 : 0, p.escaped ? 1 : 0, p.mv ? 1 : 0, p.sp ? 1 : 0, p.hid || 0, p.sn ? 1 : 0, p.L]),
    m: m ? [+m.x.toFixed(2), +m.z.toFixed(2), +m.yaw.toFixed(3), m.state, m.target || 0, +m.speed.toFixed(2), m.lit ? 1 : 0, m.lunge ? 1 : 0, m.L, m.crawl || 0] : null,
    c: c && c.state !== 'gone' ? [+c.x.toFixed(2), +c.z.toFixed(2), +c.yaw.toFixed(3), c.state, c.target || 0, c.L] : null,
  });
}, TICK * 1000);

// ---------------- networking ----------------
const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
  let me = null, spec = false;
  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (spec) return; // spectators only watch
    if (msg.t === 'join' && msg.spectator && !me) {
      spec = true; spectators.add(ws);
      ws.send(JSON.stringify({ t: 'welcome', id: -1, color: '#ffffff', spectator: true }));
      ws.send(JSON.stringify(lobbyMsg()));
      if (game.phase === 'playing') ws.send(JSON.stringify(startMsg()));
      console.log(`[spectator] joined (${spectators.size} watching)`);
      return;
    }
    if (msg.t === 'join') {
      if (me) return;
      if (game.players.size >= MAX_PLAYERS) { ws.send(JSON.stringify({ t: 'full' })); return; }
      const name = String(msg.name || 'Survivor').replace(/[<>]/g, '').slice(0, 14) || 'Survivor';
      const used = new Set([...game.players.values()].map((q) => q.char));
      const char = CHARS.includes(msg.char) ? msg.char : CHARS.find((c) => !used.has(c));
      me = { id: nextId++, ws, name, char, color: freeColor(), x: 0, z: 0, L: 0, yaw: 0, pitch: 0, fl: true, cr: false, sp: false, sn: false, mv: false, alive: true, escaped: false, hid: null, items: [] };
      game.players.set(me.id, me);
      send(me, { t: 'welcome', id: me.id, color: me.color });
      console.log(`[join] ${name} (${game.players.size}/${MAX_PLAYERS})`);
      if (game.phase === 'playing') {
        spawnPlayer(me, game.players.size - 1);
        me.graceUntil = now() + 10; // came in late: she leaves you alone for a few seconds while you find your feet
        console.log(`[late] ${name} joined a game in progress`);
        broadcast(lobbyMsg());
        send(me, startMsg());
        broadcast({ t: 'ev', e: 'joined', id: me.id, name: me.name, color: me.color, char: me.char });
      } else broadcast(lobbyMsg());
      return;
    }
    if (!me) return;
    // Begin: a short countdown everyone in the lobby sees (and anyone can stop), so friends still joining make it in
    if (msg.t === 'start' && game.phase === 'lobby') {
      if (game.countdown) return;
      game.countdownAt = now() + 5;
      game.countdown = setTimeout(() => { game.countdown = null; if (game.phase === 'lobby' && game.players.size) startGame(); }, 5000);
      console.log(`[countdown] ${me.name} pressed Begin`);
      broadcast({ t: 'countdown', secs: 5, by: me.name });
      return;
    }
    if (msg.t === 'cancelStart' && game.phase === 'lobby' && game.countdown) {
      clearTimeout(game.countdown); game.countdown = null;
      broadcast({ t: 'countdown', cancel: true, by: me.name });
      return;
    }
    if (msg.t === 'char' && CHARS.includes(msg.char)) { me.char = msg.char; broadcast(lobbyMsg()); return; }
    if (msg.t === 'difficulty' && game.phase === 'lobby' && DIFFICULTY[msg.key]) { game.difficulty = msg.key; broadcast(lobbyMsg()); return; }
    if (game.phase !== 'playing') return;
    const sameL = (o) => (o.L ?? 0) === me.L;
    if (msg.t === 's') {
      if (!me.alive || me.escaped) return;
      me.yaw = +msg.yaw || 0; me.pitch = +msg.pitch || 0;
      if (me.hid) { me.fl = false; me.mv = false; me.sp = false; return; }
      me.x = +msg.x || me.x; me.z = +msg.z || me.z;
      if ([-1, 0, 1].includes(msg.L)) me.L = msg.L;
      me.fl = !!msg.fl; me.cr = !!msg.cr; me.sp = !!msg.sp; me.sn = !!msg.sn; me.mv = !!msg.mv;
    } else if (msg.t === 'jump') { // everyone else plays the same arc on their screen
      if (me.alive && !me.escaped && !me.hid) broadcast({ t: 'ev', e: 'jump', id: me.id });
    } else if (msg.t === 'hide') {
      if (!me.alive || me.escaped || me.hid) return;
      const h = game.map.hides.find((q) => q.id === msg.id);
      if (!h || !sameL(h) || Math.hypot(h.x - me.x, h.z - me.z) > (h.type === 'bed' ? 3.2 : 2.6)) return;
      if ([...game.players.values()].some((q) => q.hid === h.id)) { send(me, { t: 'ev', e: 'hideFull', id: h.id }); return; }
      me.hid = h.id; me.x = h.x; me.z = h.z; me.mv = false; me.fl = false;
      const m = game.monster;
      if (m && m.state === 'chase' && m.target === me.id && m.L === me.L && m.lostT < 0.4 && Math.hypot(m.x - me.x, m.z - me.z) < 6 && lineOfSight(game.map, m.L, m.x, m.z, me.x, me.z)) {
        m.state = 'hunt'; m.huntT = 0; m.huntLocker = { hid: h.id, pid: me.id, yaw: Math.atan2(h.fx, h.fz) };
        setGoal(m, { x: h.x + h.fx * frontOf(h), z: h.z + h.fz * frontOf(h), L: h.L });
      }
      broadcast({ t: 'ev', e: 'hide', id: me.id, hid: h.id });
    } else if (msg.t === 'note') {
      if (typeof msg.id === 'string' && /^n\d+$/.test(msg.id)) broadcast({ t: 'ev', e: 'note', id: msg.id, by: me.id });
    } else if (msg.t === 'unhide') {
      if (!me.hid) return;
      const h = game.map.hides.find((q) => q.id === me.hid);
      me.hid = null; me.x = h.x + h.fx * frontOf(h); me.z = h.z + h.fz * frontOf(h);
      broadcast({ t: 'ev', e: 'unhide', id: me.id, hid: h.id, x: me.x, z: me.z });
    } else if (msg.t === 'pickup') {
      if (!me.alive || me.escaped) return;
      const item = [...game.talismans, ...game.batteries, ...game.bells, ...game.souls].find((i) => i.id === msg.id);
      if (!item || item.taken || !sameL(item) || Math.hypot(item.x - me.x, item.z - me.z) > 3) return;
      item.taken = true;
      if (item.id[0] === 't') {
        me.items.push(item.id);
        if (!item.ever) { item.ever = true; game.progress++; }
        const m = game.monster;
        if (m && !['chase', 'dormant', 'bound'].includes(m.state)) { m.state = 'hunt'; m.huntT = 0; setGoal(m, { x: me.x, z: me.z, L: me.L }); }
      }
      if (item.id[0] === 'w') me.bells = (me.bells || 0) + 1;
      if (item.id[0] === 'r') me.revives = (me.revives || 0) + 1;
      broadcast({ t: 'ev', e: 'pickup', id: item.id, by: me.id, progress: game.progress, items: me.items, bells: me.bells, revives: me.revives });
    } else if (msg.t === 'place') {
      const sh = game.map.shrine, slot = msg.slot | 0;
      if (!me.alive || me.escaped || me.L !== sh.L || !me.items.length || slot < 0 || slot > 4 || game.placed[slot]) return;
      const pt = sh.points[slot];
      if (Math.hypot(pt.x - me.x, pt.z - me.z) > 2.4) return;
      const id = me.items.shift();
      game.placed[slot] = id;
      const count = game.placed.filter(Boolean).length;
      broadcast({ t: 'ev', e: 'placed', slot, id, by: me.id, count, items: me.items });
      if (count === TALISMANS && game.stage === 'items') {
        game.stage = 'lure';
        broadcast({ t: 'ev', e: 'stage', stage: 'lure' });
        const m = game.monster;
        if (m && m.state !== 'chase') { m.state = 'hunt'; m.huntT = 0; setGoal(m, { x: me.x, z: me.z, L: me.L }); }
      }
    } else if (msg.t === 'revive') {
      const target = game.players.get(msg.id);
      if (!me.alive || me.escaped || !(me.revives > 0) || !target || target.alive || target.escaped || target.L !== me.L) return;
      if (Math.hypot(target.x - me.x, target.z - me.z) > 3) return;
      me.revives--; target.alive = true; target.hid = null;
      broadcast({ t: 'ev', e: 'revived', id: target.id, by: me.id, x: target.x, z: target.z, L: target.L, revives: me.revives });
    } else if (msg.t === 'bell') {
      if (!me.alive || me.escaped || !(me.bells > 0)) return;
      me.bells--;
      const m = game.monster, c = game.crawler;
      let froze = false, scared = false;
      if (m && !['dormant', 'bound'].includes(m.state) && m.L === me.L && Math.hypot(m.x - me.x, m.z - me.z) < 18) { m.stunT = 6; m.state = 'stunned'; froze = true; }
      if (c && ['ceiling', 'drop', 'crawl'].includes(c.state) && c.L === me.L && Math.hypot(c.x - me.x, c.z - me.z) < 18) { c.state = 'retreat'; c.t = now() + 1.2; scared = true; }
      broadcast({ t: 'ev', e: 'bell', by: me.id, x: me.x, z: me.z, L: me.L, bells: me.bells, froze, scared });
    } else if (msg.t === 'rtc') { // voice chat: pass the connection messages between two players
      const to = game.players.get(msg.to);
      if (to && msg.data && JSON.stringify(msg.data).length < 20000) send(to, { t: 'rtc', from: me.id, data: msg.data });
    } else if (msg.t === 'noise') { // someone is talking loudly into their microphone: she can hear that
      if (me.alive && !me.escaped) me.voiceT = now();
    } else if (msg.t === 'ping') { // mark a spot for everyone (at most one every 1.2 s)
      if (!me.alive || me.escaped || now() < (me.pingT || 0)) return;
      me.pingT = now() + 1.2;
      const kind = ['spot', 'item', 'danger'].includes(msg.kind) ? msg.kind : 'spot';
      broadcast({ t: 'ev', e: 'ping', by: me.id, x: +msg.x || 0, y: +msg.y || 0, z: +msg.z || 0, L: [-1, 0, 1].includes(msg.L) ? msg.L : me.L, kind, label: String(msg.label || '').slice(0, 40) });
    } else if (msg.t === 'bp') { // take the blueprint
      const b = game.bp;
      if (!b || b.holder || !me.alive || me.escaped || me.hid || me.L !== b.L || Math.hypot(b.x - me.x, b.z - me.z) > 2.6) return;
      b.holder = me.id;
      broadcast(bpMsg({ by: me.id, why: 'take' }));
    } else if (msg.t === 'escape') {
      const ex = game.map.exit;
      if (!game.exitOpen || !me.alive || me.escaped || me.L !== ex.L || Math.hypot(ex.x - me.x, ex.z - me.z) > 3) return;
      me.escaped = true;
      console.log(`[escape] ${me.name}`);
      broadcast({ t: 'ev', e: 'escaped', id: me.id });
      if (game.bp && game.bp.holder === me.id) { Object.assign(game.bp, { ...game.map.blueprint, holder: null, onTable: true }); broadcast(bpMsg({ by: me.id, why: 'return' })); }
      checkEnd();
    }
  });
  ws.on('close', () => {
    if (spec) { spectators.delete(ws); return; }
    if (!me) return;
    if (game.phase === 'playing') dropItems(me);
    game.players.delete(me.id);
    console.log(`[leave] ${me.name}`);
    broadcast({ t: 'ev', e: 'left', id: me.id, name: me.name });
    if (game.phase === 'playing') {
      if (game.players.size === 0) { game.phase = 'lobby'; game.monster = null; }
      else checkEnd();
    }
    broadcast(lobbyMsg());
  });
});

server.listen(PORT, () => {
  console.log('\n  C H U D A I L   B U S T E R S');
  console.log('  ───────────────────');
  console.log(`  You:            http://localhost:${PORT}`);
  for (const a of lanAddresses()) console.log(`  Friends (Wi-Fi): http://${a}:${PORT}`);
  if (process.argv.includes('--online') || process.env.ONLINE) startTunnel();
  else console.log('\n  Friends in another city or country? Run:  npm run online\n');
});

// ---------------- play from anywhere: Cloudflare tunnel ----------------
// With a tunnel.json next to server.js ({"name": "chudail", "hostname": "chudailbusters.com"}) and that named
// tunnel created on this machine (docs/HANDOFF.md, "Own domain"), the game is served on the fixed domain.
// Otherwise a free quick tunnel gives a random https://*.trycloudflare.com link that changes every start.
function namedTunnel() {
  try {
    const cfg = JSON.parse(fs.readFileSync(new URL('./tunnel.json', import.meta.url), 'utf8'));
    if (cfg.name && cfg.hostname) return cfg;
  } catch {}
  return null;
}
function startTunnel(attempt = 1) {
  const named = namedTunnel();
  console.log(named ? `\n  Opening https://${named.hostname} (Cloudflare tunnel "${named.name}")...` : '\n  Opening a worldwide link (Cloudflare tunnel)...');
  let proc;
  const bin = ['/opt/homebrew/bin/cloudflared', '/usr/local/bin/cloudflared'].find((f) => fs.existsSync(f)) || 'cloudflared';
  const args = named
    ? ['tunnel', '--no-autoupdate', 'run', '--url', `http://localhost:${PORT}`, named.name]
    : ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`];
  try { proc = spawn(bin, args); game.tunnelProc = proc; }
  catch { return tunnelMissing(); }
  proc.on('error', tunnelMissing);
  const scan = (buf) => {
    const txt = String(buf);
    const m = named ? (/Registered tunnel connection/.test(txt) ? [`https://${named.hostname}`] : null) : txt.match(/https:\/\/(?!api\.)[a-z0-9]+(?:-[a-z0-9]+)+\.trycloudflare\.com/); // not api.trycloudflare.com from an error
    if (named && /error|failed/i.test(txt) && !game.publicUrl) console.log('  [tunnel] ' + txt.trim().split('\n').pop());
    if (m && !game.publicUrl) {
      game.publicUrl = m[0];
      console.log(`\n  >>> Friends ANYWHERE join here:  ${game.publicUrl}\n`);
      try { fs.writeFileSync(new URL('./public-link.txt', import.meta.url), game.publicUrl + '\n'); } catch {}
      broadcast(lobbyMsg());
    }
  };
  proc.stdout.on('data', scan); proc.stderr.on('data', scan);
  proc.on('exit', () => {
    if (game.stopping) return;
    const had = game.publicUrl; game.publicUrl = null;
    // Never give up: the game is meant to stay reachable. A dropped link (Wi-Fi change, sleep) reopens by itself;
    // a quick tunnel then gets a new random address, written to public-link.txt.
    if (had) { console.log('  [tunnel] The worldwide link dropped, reopening...'); setTimeout(() => startTunnel(1), 3000); return; }
    if (attempt === 4) console.log('\n  Could not open a worldwide link. This network may be blocking Cloudflare; try another Wi-Fi or a phone hotspot. Still trying every minute.\n');
    else if (attempt < 4) console.log(`  [tunnel] Cloudflare did not answer, trying again (${attempt + 1}/4)...`);
    setTimeout(() => startTunnel(attempt + 1), Math.min(4000 * attempt, 60000));
  });
  if (!game.tunnelHooks) {
    game.tunnelHooks = true;
    const stop = () => { game.stopping = true; game.tunnelProc?.kill(); process.exit(0); };
    process.on('exit', () => game.tunnelProc?.kill());
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  }
}
function tunnelMissing() {
  console.log('\n  cloudflared is not installed. Install it once, then run  npm run online  again:');
  console.log('    Mac:      brew install cloudflared');
  console.log('    Windows:  winget install --id Cloudflare.cloudflared\n');
}
