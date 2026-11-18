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
  CELL, TALISMANS, generateMap, bfsPath, lineOfSight, resolveCircle, isWall, cellOf,
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
  '.json': 'application/json', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
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
  phase: 'lobby', players: new Map(), map: null, seed: 0, monster: null,
  talismans: [], batteries: [], collected: 0, exitOpen: false, startTime: 0,
  nextScare: 0, endTimer: null, time: 0,
};
let nextId = 1;

const send = (p, msg) => { if (p.ws.readyState === 1) p.ws.send(JSON.stringify(msg)); };
const spectators = new Set(); // hidden admins: receive everything, invisible to players
const broadcast = (msg) => { const s = JSON.stringify(msg); for (const p of game.players.values()) if (p.ws.readyState === 1) p.ws.send(s); for (const w of spectators) if (w.readyState === 1) w.send(s); };
const now = () => game.time;
const rand = (a, b) => a + Math.random() * (b - a);
const frontOf = (h) => (h.type === 'bed' ? 1.55 : 0.95); // where you stand in front of a hiding spot

function lobbyMsg() {
  return { t: 'lobby', phase: game.phase, publicUrl: game.publicUrl || null, players: [...game.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color, char: p.char })) };
}

function freeColor() {
  const used = new Set([...game.players.values()].map((p) => p.color));
  return COLORS.find((c) => !used.has(c)) || COLORS[0];
}

function startMsg() {
  return {
    t: 'start', seed: game.seed,
    players: [...game.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color, char: p.char, x: p.x, z: p.z, alive: p.alive, escaped: p.escaped })),
    taken: [...game.talismans, ...game.batteries, ...game.bells, ...game.souls].filter((i) => i.taken).map((i) => i.id),
    collected: game.collected, exitOpen: game.exitOpen, stage: game.stage,
  };
}

function startGame() {
  game.seed = (Math.random() * 2 ** 31) >>> 0;
  game.map = generateMap(game.seed);
  const m = game.map;
  game.talismans = m.talismans.map((t) => ({ ...t, taken: false }));
  game.batteries = m.batteries.map((b) => ({ ...b, taken: false }));
  game.bells = m.bells.map((b) => ({ ...b, taken: false }));
  game.souls = m.souls.map((b) => ({ ...b, taken: false }));
  game.collected = 0; game.exitOpen = false; game.sniffed = {}; game.stage = 'effigies';
  game.crawler = { x: 0, z: 0, yaw: 0, state: 'gone', t: now() + 20, target: null, path: null, pathT: -9, pi: 0 };
  game.startTime = now(); game.nextScare = now() + 45 + Math.random() * 25;
  let n = 0;
  for (const p of game.players.values()) spawnPlayer(p, n++);
  game.monster = {
    x: m.monsterSpawn.x, z: m.monsterSpawn.z, yaw: 0, state: 'dormant', target: null,
    goal: null, path: null, pi: 0, pathT: -9, goalKey: -1, stall: 0, lostT: 0, huntT: 0, feedT: 0,
    lastSeen: null, farT: 0, stuckT: 0, lit: false, lunge: false, speed: 0,
  };
  game.phase = 'playing';
  broadcast(startMsg());
  console.log(`[game] started with ${game.players.size} player(s), seed ${game.seed}`);
}

function spawnPlayer(p, n) {
  const s = game.map.spawns[n % game.map.spawns.length];
  Object.assign(p, { x: s[0], z: s[1], yaw: Math.PI / 2, pitch: 0, fl: true, cr: false, sp: false, sn: false, mv: false, alive: true, escaped: false, hid: null, bells: 0, revives: 0 });
}

function activePlayers() { return [...game.players.values()].filter((p) => p.alive && !p.escaped); }

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

// ---------------- monster AI ----------------
function randomFloorNear(cx, cz, minC, maxC) {
  const map = game.map;
  for (let t = 0; t < 60; t++) {
    const i = cellOf(cx) + Math.round((Math.random() * 2 - 1) * maxC);
    const j = cellOf(cz) + Math.round((Math.random() * 2 - 1) * maxC);
    if (isWall(map, i, j)) continue;
    const d = Math.max(Math.abs(i - cellOf(cx)), Math.abs(j - cellOf(cz)));
    if (d < minC) continue;
    return { x: (i + 0.5) * CELL, z: (j + 0.5) * CELL };
  }
  return null;
}

function setGoal(m, g) { m.goal = g; m.pathT = -9; }

function killPlayer(p, dragged = false) {
  const m = game.monster;
  p.alive = false;
  if (p.hid) { const h = game.map.hides.find((q) => q.id === p.hid); p.x = h.x + h.fx * frontOf(h); p.z = h.z + h.fz * frontOf(h); p.hid = null; }
  broadcast({ t: 'ev', e: 'kill', id: p.id, x: p.x, z: p.z, mx: m.x, mz: m.z, dragged });
  m.state = 'feed'; m.feedT = 5; m.target = null;
  checkEnd();
}

function updateMonster(dt) {
  const m = game.monster, map = game.map;
  if (!m) return;
  const t = now();
  const targets = activePlayers();
  if (t < game.startTime + 18) { m.state = 'dormant'; m.speed = 0; return; }
  if (!targets.length) return;
  if (m.state === 'dormant') { m.state = 'wander'; m.goal = null; }

  const bonus = game.collected * 0.3 + (game.stage === 'escape' ? 0.7 : 0);

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

  // --- perception
  const fwdX = -Math.sin(m.yaw), fwdZ = -Math.cos(m.yaw);
  let seen = null, seenD = 1e9, lit = false, litBy = null, minD = 1e9;
  for (const p of targets) {
    const dx = p.x - m.x, dz = p.z - m.z, d = Math.hypot(dx, dz);
    minD = Math.min(minD, d);
    if (d > 20 || p.hid) continue;
    const los = lineOfSight(map, m.x, m.z, p.x, p.z);
    if (!los) continue;
    // flashlight on the monster
    if (p.fl && d < 11) {
      const lx = -Math.sin(p.yaw), lz = -Math.cos(p.yaw);
      const dot = (-dx * lx + -dz * lz) / (d || 1);
      if (dot > 0.95 && Math.abs(p.pitch) < 0.7) { lit = true; litBy = p; }
    }
    // crouching in the dark makes you nearly invisible; she must almost step on you
    const range = p.cr ? (p.fl ? 8 : 2.2) : p.fl ? 15 : 7;
    const near = p.cr && !p.fl ? 1.1 : 2.4;
    const facing = (dx * fwdX + dz * fwdZ) / (d || 1);
    const visible = d < near || (d < range && (facing > (p.cr ? 0.5 : 0.25) || (!p.cr && d < 5)));
    if (visible && d < seenD) { seen = p; seenD = d; }
  }
  if (!seen && lit) { seen = litBy; seenD = Math.hypot(litBy.x - m.x, litBy.z - m.z); }
  m.lit = lit;

  // --- hearing
  let noise = null;
  for (const p of targets) {
    if (!p.mv || p.hid) continue;
    const d = Math.hypot(p.x - m.x, p.z - m.z);
    const r = p.sp ? 17 : (p.cr || p.sn) ? 0 : 6;
    if (d < r) { noise = { x: p.x, z: p.z }; break; }
  }

  // --- state machine
  if (seen) {
    if (m.state !== 'chase') {
      m.stall = 0.85;
      broadcast({ t: 'ev', e: 'chase', id: seen.id });
    }
    m.state = 'chase'; m.target = seen.id; m.lostT = 0; m.huntLocker = null;
    m.lastSeen = { x: seen.x, z: seen.z };
  } else if (m.state === 'chase') {
    m.lostT += dt;
    const tp = game.players.get(m.target);
    if (tp && tp.alive && !tp.escaped && m.lostT < 2.2) m.lastSeen = { x: tp.x, z: tp.z }; // it can smell you briefly
    if (m.lostT > 6) { m.state = 'hunt'; m.huntT = 0; setGoal(m, m.lastSeen); }
  } else if (noise) {
    if (m.state !== 'hunt' || !m.goal || Math.hypot(m.goal.x - noise.x, m.goal.z - noise.z) > 3) setGoal(m, noise);
    m.state = 'hunt'; m.huntT = 0;
  }

  if (m.state === 'hunt' && m.huntLocker) {
    const L = m.huntLocker, tp = game.players.get(L.pid);
    if (Math.hypot(m.goal.x - m.x, m.goal.z - m.z) < 1.3) {
      // she stops at the door and listens first: hold your breath, 40% of the time she gives up
      m.huntLocker = null; m.state = 'sniff'; m.sniffT = 3; m.sniffYaw = L.yaw;
      m.sniffKill = tp && tp.alive && tp.hid === L.hid && Math.random() < 0.6 ? { pid: tp.id, hid: L.hid } : null;
      broadcast({ t: 'ev', e: 'sniff', hid: L.hid });
    }
  } else if (m.state === 'hunt') {
    m.huntT += dt;
    if (m.huntT > 16 || (m.goal && Math.hypot(m.goal.x - m.x, m.goal.z - m.z) < 1)) {
      // search nearby before giving up
      if (m.huntT < 16 && Math.random() < 0.6) setGoal(m, randomFloorNear(m.x, m.z, 2, 4) || m.goal);
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
      m.state = 'wander'; m.goal = randomFloorNear(m.x, m.z, 3, 8); m.pathT = -9;
    }
    return;
  }
  // sniff at occupied lockers it walks past
  if (m.state === 'wander' || m.state === 'hunt') {
    for (const p of targets) {
      if (!p.hid) continue;
      const h = map.hides.find((q) => q.id === p.hid);
      const fx = h.x + h.fx * frontOf(h), fz = h.z + h.fz * frontOf(h);
      if (Math.hypot(fx - m.x, fz - m.z) < 1.6 && (game.sniffed[h.id] || 0) < t) {
        game.sniffed[h.id] = t + 45;
        if (Math.random() < 0.3) { m.state = 'sniff'; m.sniffT = rand(2.5, 4.5); m.sniffYaw = Math.atan2(h.fx, h.fz); broadcast({ t: 'ev', e: 'sniff', hid: h.id }); return; }
      }
    }
  }
  if (m.state === 'wander') {
    if (!m.goal || Math.hypot(m.goal.x - m.x, m.goal.z - m.z) < 1) {
      let g = null;
      if (Math.random() < 0.55) {
        const p = targets[Math.floor(Math.random() * targets.length)];
        g = randomFloorNear(p.x, p.z, 2, 7);
      }
      setGoal(m, g || randomFloorNear(m.x, m.z, 3, 12));
    }
    // keep pressure: teleport closer if it's been far from everyone for a while
    if (minD > 30) m.farT += dt; else m.farT = 0;
    if (m.farT > 22) {
      const p = targets[Math.floor(Math.random() * targets.length)];
      for (let k = 0; k < 30; k++) {
        const s = randomFloorNear(p.x, p.z, 5, 8);
        if (s && !targets.some((q) => lineOfSight(map, s.x, s.z, q.x, q.z) && Math.hypot(q.x - s.x, q.z - s.z) < 25)) {
          m.x = s.x; m.z = s.z; m.farT = 0; m.goal = null; break;
        }
      }
    }
  }

  // --- speed
  let speed = m.state === 'chase' ? 3.55 : m.state === 'hunt' ? 2.6 : 1.5;
  speed += bonus;
  m.lunge = false;
  if (m.state === 'chase' && seen && seenD < 3) { speed *= 1.3; m.lunge = true; }
  if (lit) speed *= 0.45;
  if (m.stall > 0) { m.stall -= dt; speed = 0; }
  m.speed = speed;

  // --- steering target
  let tx = null, tz = null;
  const chaseT = m.state === 'chase' ? game.players.get(m.target) : null;
  if (chaseT && seen === chaseT && clearPath(m.x, m.z, chaseT.x, chaseT.z)) {
    tx = chaseT.x; tz = chaseT.z;
  } else {
    const goal = m.state === 'chase' ? m.lastSeen : m.goal;
    if (goal) {
      const gi = cellOf(goal.x), gj = cellOf(goal.z);
      const key = gj * map.W + gi;
      if (t - m.pathT > 0.5 || key !== m.goalKey || !m.path) {
        m.path = bfsPath(map, cellOf(m.x), cellOf(m.z), gi, gj) || [];
        m.pi = 0; m.pathT = t; m.goalKey = key;
      }
      // skip ahead to farthest waypoint with a clear line
      for (let k = Math.min(m.path.length - 1, m.pi + 4); k > m.pi; k--) {
        const [wi, wj] = m.path[k];
        if (clearPath(m.x, m.z, (wi + 0.5) * CELL, (wj + 0.5) * CELL)) { m.pi = k; break; }
      }
      if (m.pi < m.path.length) {
        const [wi, wj] = m.path[m.pi];
        tx = (wi + 0.5) * CELL; tz = (wj + 0.5) * CELL;
        if (Math.hypot(tx - m.x, tz - m.z) < 0.35) m.pi++;
      } else { tx = goal.x; tz = goal.z; }
    }
  }

  if (tx !== null && speed > 0) {
    const dx = tx - m.x, dz = tz - m.z, d = Math.hypot(dx, dz);
    if (d > 0.05) {
      const step = Math.min(d, speed * dt);
      const ox = m.x, oz = m.z;
      [m.x, m.z] = resolveCircle(map, m.x + (dx / d) * step, m.z + (dz / d) * step, 0.35);
      const want = Math.atan2(-dx, -dz);
      let diff = want - m.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      m.yaw += diff * Math.min(1, dt * 8);
      const moved = Math.hypot(m.x - ox, m.z - oz);
      if (moved < step * 0.2) { m.stuckT += dt; if (m.stuckT > 1) { m.path = null; m.stuckT = 0; if (m.state === 'wander') m.goal = null; } }
      else m.stuckT = 0;
    }
  }

  // --- kill
  for (const p of targets) {
    if (!p.hid && m.state === 'chase' && Math.hypot(p.x - m.x, p.z - m.z) < 1.05 && m.stall <= 0) { killPlayer(p); break; }
  }
}

function clearPath(x0, z0, x1, z1) {
  const map = game.map;
  const dx = x1 - x0, dz = z1 - z0, d = Math.hypot(dx, dz) || 1;
  const px = (-dz / d) * 0.3, pz = (dx / d) * 0.3;
  return lineOfSight(map, x0 + px, z0 + pz, x1 + px, z1 + pz) && lineOfSight(map, x0 - px, z0 - pz, x1 - px, z1 - pz);
}

// ---------------- the crawler (drops from the ceiling) ----------------
function updateCrawler(dt) {
  const c = game.crawler, map = game.map, t = now();
  if (!c) return;
  const targets = activePlayers().filter((p) => !p.hid);
  if (game.collected < 1) { c.state = 'gone'; return; }
  if (c.state === 'gone') {
    if (t < c.t || !targets.length) return;
    const p = targets[Math.floor(Math.random() * targets.length)];
    const s = randomFloorNear(p.x, p.z, 3, 7);
    if (s && !targets.some((q) => Math.hypot(q.x - s.x, q.z - s.z) < 7)) { c.x = s.x; c.z = s.z; c.state = 'ceiling'; c.t = t + 70; c.yaw = Math.random() * 6.28; }
    return;
  }
  if (c.state === 'ceiling') {
    for (const p of targets) {
      if (Math.hypot(p.x - c.x, p.z - c.z) < 2.4) {
        c.state = 'drop'; c.t = t + 1.4; c.target = p.id; c.yaw = Math.atan2(-(p.x - c.x), -(p.z - c.z));
        broadcast({ t: 'ev', e: 'crawlerDrop', id: p.id, x: c.x, z: c.z });
        return;
      }
    }
    if (t > c.t) { c.state = 'gone'; c.t = t + 5; }
    return;
  }
  if (c.state === 'drop') { if (t > c.t) { c.state = 'crawl'; c.t = t + 9; c.path = null; } return; }
  if (c.state === 'retreat') { if (t > c.t) { c.state = 'gone'; c.t = t + rand(25, 40); } return; }
  // crawl: hunt the one who woke it
  const p = game.players.get(c.target);
  if (!p || !p.alive || p.escaped || p.hid || t > c.t) { c.state = 'retreat'; c.t = t + 1.2; return; }
  const speed = 3.3 + game.collected * 0.2 + (game.stage === 'escape' ? 0.5 : 0);
  let tx = p.x, tz = p.z;
  if (!clearPath(c.x, c.z, p.x, p.z)) {
    if (!c.path || t - c.pathT > 0.4) { c.path = bfsPath(map, cellOf(c.x), cellOf(c.z), cellOf(p.x), cellOf(p.z)) || []; c.pi = 0; c.pathT = t; }
    if (c.pi < c.path.length) {
      const [wi, wj] = c.path[c.pi]; tx = (wi + 0.5) * CELL; tz = (wj + 0.5) * CELL;
      if (Math.hypot(tx - c.x, tz - c.z) < 0.35) c.pi++;
    }
  }
  const dx = tx - c.x, dz = tz - c.z, d = Math.hypot(dx, dz);
  if (d > 0.05) {
    const step = Math.min(d, speed * dt);
    [c.x, c.z] = resolveCircle(map, c.x + (dx / d) * step, c.z + (dz / d) * step, 0.3);
    c.yaw = Math.atan2(-dx, -dz);
  }
  if (Math.hypot(p.x - c.x, p.z - c.z) < 0.9) {
    p.alive = false;
    broadcast({ t: 'ev', e: 'kill', id: p.id, x: p.x, z: p.z, mx: c.x, mz: c.z, crawler: true });
    c.state = 'retreat'; c.t = t + 2;
    checkEnd();
  }
}

// ---------------- global scares ----------------
function updateScares() {
  if (now() < game.nextScare) return;
  const targets = activePlayers();
  if (!targets.length) return;
  game.nextScare = now() + 40 - game.collected * 4 + Math.random() * 35;
  const types = ['lights', 'bang', 'scream', 'whisper', 'lights', 'bang'];
  const type = types[Math.floor(Math.random() * types.length)];
  const p = targets[Math.floor(Math.random() * targets.length)];
  const pos = randomFloorNear(p.x, p.z, 2, 5) || { x: p.x, z: p.z };
  broadcast({ t: 'ev', e: 'scare', type, x: pos.x, z: pos.z });
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
  const m = game.monster;
  broadcast({
    t: 'snap',
    p: [...game.players.values()].map((p) => [p.id, +p.x.toFixed(2), +p.z.toFixed(2), +p.yaw.toFixed(3), +p.pitch.toFixed(3), p.fl ? 1 : 0, p.cr ? 1 : 0, p.alive ? 1 : 0, p.escaped ? 1 : 0, p.mv ? 1 : 0, p.sp ? 1 : 0, p.hid || 0, p.sn ? 1 : 0]),
    m: m ? [+m.x.toFixed(2), +m.z.toFixed(2), +m.yaw.toFixed(3), m.state, m.target || 0, +m.speed.toFixed(2), m.lit ? 1 : 0, m.lunge ? 1 : 0] : null,
    c: game.crawler && game.crawler.state !== 'gone' ? [+game.crawler.x.toFixed(2), +game.crawler.z.toFixed(2), +game.crawler.yaw.toFixed(3), game.crawler.state, game.crawler.target || 0] : null,
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
      me = { id: nextId++, ws, name, char, color: freeColor(), x: 0, z: 0, yaw: 0, pitch: 0, fl: true, cr: false, sp: false, sn: false, mv: false, alive: true, escaped: false, hid: null };
      game.players.set(me.id, me);
      send(me, { t: 'welcome', id: me.id, color: me.color });
      console.log(`[join] ${name} (${game.players.size}/${MAX_PLAYERS})`);
      if (game.phase === 'playing') {
        spawnPlayer(me, game.players.size - 1);
        broadcast(lobbyMsg());
        send(me, startMsg());
        broadcast({ t: 'ev', e: 'joined', id: me.id, name: me.name, color: me.color, char: me.char });
      } else broadcast(lobbyMsg());
      return;
    }
    if (!me) return;
    if (msg.t === 'start' && game.phase === 'lobby') { startGame(); return; }
    if (msg.t === 'char' && CHARS.includes(msg.char)) { me.char = msg.char; broadcast(lobbyMsg()); return; }
    if (game.phase !== 'playing') return;
    if (msg.t === 's') {
      if (!me.alive || me.escaped) return;
      me.yaw = +msg.yaw || 0; me.pitch = +msg.pitch || 0;
      if (me.hid) { me.fl = false; me.mv = false; me.sp = false; return; }
      me.x = +msg.x || me.x; me.z = +msg.z || me.z;
      me.fl = !!msg.fl; me.cr = !!msg.cr; me.sp = !!msg.sp; me.sn = !!msg.sn; me.mv = !!msg.mv;
    } else if (msg.t === 'hide') {
      if (!me.alive || me.escaped || me.hid) return;
      const h = game.map.hides.find((q) => q.id === msg.id);
      if (!h || Math.hypot(h.x - me.x, h.z - me.z) > (h.type === 'bed' ? 3.2 : 2.6)) return;
      if ([...game.players.values()].some((q) => q.hid === h.id)) { send(me, { t: 'ev', e: 'hideFull', id: h.id }); return; }
      me.hid = h.id; me.x = h.x; me.z = h.z; me.mv = false; me.fl = false;
      const m = game.monster;
      // she only knows if she watched you climb in from close by
      if (m && m.state === 'chase' && m.target === me.id && m.lostT < 0.4 && Math.hypot(m.x - me.x, m.z - me.z) < 6 && lineOfSight(game.map, m.x, m.z, me.x, me.z)) {
        m.state = 'hunt'; m.huntT = 0; m.huntLocker = { hid: h.id, pid: me.id, yaw: Math.atan2(h.fx, h.fz) };
        setGoal(m, { x: h.x + h.fx * frontOf(h), z: h.z + h.fz * frontOf(h) });
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
      if (!item || item.taken || Math.hypot(item.x - me.x, item.z - me.z) > 3) return;
      item.taken = true;
      const isT = item.id[0] === 't';
      if (isT) {
        game.collected++;
        const m = game.monster;
        if (m && m.state !== 'chase' && m.state !== 'dormant') { m.state = 'hunt'; m.huntT = 0; setGoal(m, { x: me.x, z: me.z }); }
        if (game.collected >= TALISMANS && game.stage === 'effigies') { game.stage = 'heart'; setTimeout(() => broadcast({ t: 'ev', e: 'stage', stage: 'heart' }), 1500); }
      }
      if (item.id[0] === 'w') me.bells = (me.bells || 0) + 1;
      if (item.id[0] === 'r') me.revives = (me.revives || 0) + 1;
      broadcast({ t: 'ev', e: 'pickup', id: item.id, by: me.id, collected: game.collected, exitOpen: game.exitOpen, bells: me.bells, revives: me.revives });
    } else if (msg.t === 'revive') {
      const target = game.players.get(msg.id);
      if (!me.alive || me.escaped || !(me.revives > 0) || !target || target.alive || target.escaped) return;
      if (Math.hypot(target.x - me.x, target.z - me.z) > 3) return;
      me.revives--; target.alive = true; target.hid = null;
      broadcast({ t: 'ev', e: 'revived', id: target.id, by: me.id, x: target.x, z: target.z, revives: me.revives });
    } else if (msg.t === 'bell') {
      if (!me.alive || me.escaped || !(me.bells > 0)) return;
      me.bells--;
      const m = game.monster, c = game.crawler;
      let froze = false, scared = false;
      if (m && m.state !== 'dormant' && Math.hypot(m.x - me.x, m.z - me.z) < 18) { m.stunT = 6; m.state = 'stunned'; froze = true; }
      if (c && ['ceiling', 'drop', 'crawl'].includes(c.state) && Math.hypot(c.x - me.x, c.z - me.z) < 18) { c.state = 'retreat'; c.t = now() + 1.2; scared = true; }
      broadcast({ t: 'ev', e: 'bell', by: me.id, x: me.x, z: me.z, bells: me.bells, froze, scared });
    } else if (msg.t === 'burnStart') {
      if (game.stage !== 'heart' || !me.alive || Math.hypot(game.map.heart.x - me.x, game.map.heart.z - me.z) > 3) return;
      const m = game.monster;
      if (m && m.state !== 'chase' && m.state !== 'stunned') { m.state = 'hunt'; m.huntT = 0; m.huntLocker = null; setGoal(m, { x: me.x, z: me.z }); }
      broadcast({ t: 'ev', e: 'burnStart', by: me.id });
    } else if (msg.t === 'burn') {
      if (game.stage !== 'heart' || !me.alive || Math.hypot(game.map.heart.x - me.x, game.map.heart.z - me.z) > 3) return;
      game.stage = 'escape'; game.exitOpen = true;
      const m = game.monster; if (m) { m.stunT = 4; m.state = 'stunned'; }
      if (game.crawler) { game.crawler.state = 'gone'; game.crawler.t = now() + 8; }
      broadcast({ t: 'ev', e: 'stage', stage: 'escape', by: me.id });
    } else if (msg.t === 'escape') {
      const ex = game.map.exit;
      if (!game.exitOpen || !me.alive || me.escaped || Math.hypot(ex.x - me.x, ex.z - me.z) > 3) return;
      me.escaped = true;
      broadcast({ t: 'ev', e: 'escaped', id: me.id });
      checkEnd();
    }
  });
  ws.on('close', () => {
    if (spec) { spectators.delete(ws); return; }
    if (!me) return;
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
  console.log('\n  C H U D A I L');
  console.log('  ───────────────────');
  console.log(`  You:            http://localhost:${PORT}`);
  for (const a of lanAddresses()) console.log(`  Friends (Wi-Fi): http://${a}:${PORT}`);
  if (process.argv.includes('--online') || process.env.ONLINE) startTunnel();
  else console.log('\n  Friends in another city or country? Run:  npm run online\n');
});

// ---------------- play from anywhere: free Cloudflare quick tunnel ----------------
function startTunnel() {
  console.log('\n  Opening a worldwide link (Cloudflare tunnel)...');
  let proc;
  const bin = ['/opt/homebrew/bin/cloudflared', '/usr/local/bin/cloudflared'].find((f) => fs.existsSync(f)) || 'cloudflared';
  try { proc = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`]); }
  catch { return tunnelMissing(); }
  proc.on('error', tunnelMissing);
  const scan = (buf) => {
    const m = String(buf).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && !game.publicUrl) {
      game.publicUrl = m[0];
      console.log(`\n  >>> Friends ANYWHERE join here:  ${game.publicUrl}\n`);
      broadcast(lobbyMsg());
    }
  };
  proc.stdout.on('data', scan); proc.stderr.on('data', scan);
  proc.on('exit', () => { game.publicUrl = null; });
  process.on('exit', () => proc.kill());
  process.on('SIGINT', () => { proc.kill(); process.exit(0); });
}
function tunnelMissing() {
  console.log('\n  cloudflared is not installed. Install it once, then run  npm run online  again:');
  console.log('    Mac:      brew install cloudflared');
  console.log('    Windows:  winget install --id Cloudflare.cloudflared\n');
}
