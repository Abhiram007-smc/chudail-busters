// Shared between server (Node) and client (browser).
// Deterministic level generation + grid physics helpers.

export const CELL = 3;        // world units per grid cell
export const WALL_H = 3;      // ceiling height
export const GRID = 45;       // grid is GRID x GRID cells
export const TALISMANS = 5;

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WRITINGS = [
  'IT HEARS YOU', "DON'T RUN", 'SHE IS TALL', 'NO WAY OUT', 'TURN AROUND',
  'IT WAS NEVER A HOSPITAL', 'WHERE ARE THE NURSES', 'STAY TOGETHER', 'DONT LOOK AT IT',
  'IT WEARS THEIR FACES', 'HELP US', 'FIVE BONES FIVE BONES', 'I CAN STILL HEAR HER',
  'LIGHTS OUT', 'IT SMILES', 'SHE COUNTS US', 'DONT GET IN IF IT SEES', 'WALK SLOW', 'THE DOOR WANTS BONES',
  'NURSE HALE LIED', 'ROOM 41 IS EMPTY NOW', 'WE ARE STILL HERE', 'SHE IS UNDER THE LIGHTS', 'LISTEN', 'NOT ALONE',
];

const ROOM_NAMES = {
  foyer: 'FOYER', ward: 'WARD', office: 'OFFICE', storage: 'STORAGE', bath: 'BATHS', chapel: 'CHAPEL',
  nursery: 'NURSERY', morgue: 'MORGUE', surgery: 'SURGERY', records: 'RECORDS',
};

const CLUE_TEMPLATES = [
  'Dr. Hale moved one of the bones to the {ROOM}, {WING}. He said it would keep her calm.\n\nIt did not keep her calm.',
  'If anyone finds this: there is one in the {ROOM}. {WING_CAP}.\nTake it and RUN. She knows the moment it is lifted.',
  'Night log, 3:12 am.\nBones rattling again in the {ROOM} ({WING}). Nobody goes in there anymore. I am not going in there.',
  'Patient 41 keeps drawing the {ROOM}. Over and over. A little skull with candles around it.\n\nShe drew it in the {WING}. She has never left her bed.',
  'Five bones. Five locks on the foyer door.\nI found one in the {ROOM}, {WING}, but I heard her coming and I put it back.\nI am so sorry.',
  'Chaplain\'s note.\nThe fifth relic was hidden in the {ROOM}, {WING}. Let it stay buried. Some doors should not open.',
  'Maintenance: candles keep relighting by themselves in the {ROOM} ({WING}). Reported it twice. No reply.',
];

const LORE_NOTES = [
  'Admission record, 1971.\nPatient arrived at six feet tall.\n\nRecord, 1973: patient is now seven feet tall. Staff refuse to measure her again.',
  'She cannot see well in the dark.\nBut she hears EVERYTHING.\nWalk slowly. Never run. Never.',
  'The lockers saved my life twice.\nBut do NOT climb in while she is watching. She remembers which one.',
  'Shine the torch in her face and she flinches, slows down.\nBut she will never forget who did it.',
  'Day 9. The nurses stopped coming.\nI hear her walking above the ceiling tiles at night. Click. Click. Click.',
  'DO NOT OPEN THE FOYER DOOR UNTIL ALL FIVE ARE TAKEN.\nTHE SEAL KNOWS.',
  '(a child\'s drawing of a very tall lady with a long smile)\n\n"she smiles when the lights go out"',
  'To whoever is next:\nThe batteries in the supply rooms still work. The bulbs here do not stay on for long. Neither did we.',
  'Her name was never written down. The staff just called her THE HOLLOW, because of the eyes.',
  'The bones are not her. The bones are the LOCK.\nHer heart is still beating in ROOM 41. Burn it and she cannot follow you.',
  'The chaplain left bells everywhere. Ring one and she freezes, just for a moment.\nJust long enough.',
  'Something crawls on the ceiling in the corridors. Look up before you walk under the dark spots.',
];

const ROOM_PROPS = {
  foyer: ['desk', 'bench', 'chair', 'cabinet'],
  ward: ['bed', 'bed', 'bed', 'cabinet', 'wheelchair', 'chair', 'bed'],
  office: ['desk', 'chair', 'cabinet', 'crates', 'shelf'],
  storage: ['crates', 'crates', 'shelf', 'cabinet', 'crates', 'bed'],
  bath: ['tub', 'cabinet', 'tub'],
  chapel: ['pew', 'pew', 'pew', 'bench'],
  nursery: ['crib', 'crib', 'doll', 'chair', 'doll', 'wardrobe'],
  morgue: ['slab', 'slab', 'drawers', 'slab', 'cabinet'],
  surgery: ['optable', 'cabinet', 'shelf', 'wheelchair', 'bed'],
  records: ['shelf', 'shelf', 'cabinet', 'desk', 'crates'],
};
const HIDE_TYPES = new Set(['locker', 'wardrobe', 'bed']);

// footprint: w = along the wall, d = out from the wall
export const PROP_SIZE = {
  bed: [1.1, 2.0], cabinet: [1.0, 0.55], wheelchair: [0.75, 0.85], chair: [0.55, 0.55],
  desk: [1.7, 0.85], crates: [1.0, 1.0], shelf: [1.7, 0.5], tub: [1.8, 0.9],
  pew: [2.3, 0.65], bench: [2.0, 0.5], crib: [1.3, 0.75], doll: [0.3, 0.3], locker: [0.95, 0.62],
  wardrobe: [1.25, 0.7], slab: [1.0, 2.1], drawers: [1.9, 0.75], optable: [1.0, 2.0],
};

export function generateMap(seed) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const m = tryGenerate((seed + attempt * 7919) >>> 0);
    if (m) { m.seed = seed; return m; }
  }
  throw new Error('map generation failed');
}

function tryGenerate(seed) {
  const rng = mulberry32(seed);
  const W = GRID, H = GRID;
  const grid = new Uint8Array(W * H);      // 0 wall, 1 room, 2 corridor
  const roomId = new Int16Array(W * H).fill(-1);
  const path = new Uint8Array(W * H);
  const ri = (a, b) => a + Math.floor(rng() * (b - a + 1));
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];

  const rooms = [];
  const cy0 = Math.floor(H / 2);
  rooms.push({ x: 2, y: cy0 - 2, w: 5, h: 5, type: 'foyer' });
  const types = ['ward', 'office', 'storage', 'bath', 'chapel', 'nursery', 'ward', 'office', 'morgue', 'surgery', 'records', 'ward'];
  for (let a = 0; a < 2000 && rooms.length < 25; a++) {
    const w = ri(3, 7), h = ri(3, 7), x = ri(1, W - w - 1), y = ri(1, H - h - 1);
    let ok = true;
    for (const r of rooms) {
      if (x < r.x + r.w + 2 && x + w + 2 > r.x && y < r.y + r.h + 2 && y + h + 2 > r.y) { ok = false; break; }
    }
    if (ok) rooms.push({ x, y, w, h, type: pick(types) });
  }
  if (rooms.length < 14) return null;

  rooms.forEach((r, idx) => {
    r.id = idx; r.cx = r.x + Math.floor(r.w / 2); r.cy = r.y + Math.floor(r.h / 2);
    for (let j = r.y; j < r.y + r.h; j++) for (let i = r.x; i < r.x + r.w; i++) {
      grid[j * W + i] = 1; roomId[j * W + i] = idx;
    }
  });

  const carve = (i, j) => { const k = j * W + i; if (grid[k] === 0) grid[k] = 2; path[k] = 1; };
  const corridor = (a, b) => {
    let i = a.cx, j = a.cy;
    const goH = () => { while (i !== b.cx) { carve(i, j); i += Math.sign(b.cx - i); } };
    const goV = () => { while (j !== b.cy) { carve(i, j); j += Math.sign(b.cy - j); } };
    if (rng() < 0.5) { goH(); goV(); } else { goV(); goH(); }
    carve(i, j);
  };

  // Minimum spanning tree (Prim) + a few loops so you can escape chases
  const md = (a, b) => Math.abs(rooms[a].cx - rooms[b].cx) + Math.abs(rooms[a].cy - rooms[b].cy);
  const conn = [0], left = rooms.slice(1).map((r) => r.id), edges = [];
  while (left.length) {
    let best = null, bd = 1e9;
    for (const a of conn) for (const b of left) { const d = md(a, b); if (d < bd) { bd = d; best = [a, b]; } }
    edges.push(best); conn.push(best[1]); left.splice(left.indexOf(best[1]), 1);
  }
  let extra = 0;
  for (let t = 0; t < 400 && extra < 9; t++) {
    const a = ri(1, rooms.length - 1), b = ri(0, rooms.length - 1);
    if (a === b || md(a, b) > 20) continue;
    if (edges.some((e) => (e[0] === a && e[1] === b) || (e[0] === b && e[1] === a))) continue;
    edges.push([a, b]); extra++;
  }
  edges.forEach(([a, b]) => corridor(rooms[a], rooms[b]));

  const map = { W, H, grid, roomId, path, rooms };
  const foyer = rooms[0];
  const dist = bfsDist(map, foyer.cx, foyer.cy);
  const dOf = (r) => dist[r.cy * W + r.cx];

  // --- Talismans (bone effigies): spread out, far from spawn
  const cand = rooms.slice(1).sort((a, b) => dOf(b) - dOf(a));
  const chosen = [cand[0]];
  while (chosen.length < TALISMANS && chosen.length < cand.length) {
    let best = null, bs = -1;
    for (const r of cand) {
      if (chosen.includes(r)) continue;
      const mind = Math.min(...chosen.map((c) => Math.hypot(c.cx - r.cx, c.cy - r.cy)));
      const s = mind + dOf(r) * 0.15;
      if (s > bs) { bs = s; best = r; }
    }
    chosen.push(best);
  }
  const used = new Set();
  const talismans = chosen.map((r, n) => {
    r.hasTalisman = true;
    const cells = [];
    for (let j = r.y + 1; j < r.y + r.h - 1; j++) for (let i = r.x + 1; i < r.x + r.w - 1; i++) {
      if (i !== r.cx && j !== r.cy && !path[j * W + i]) cells.push([i, j]);
    }
    const [i, j] = cells.length ? pick(cells) : [r.cx, r.cy];
    used.add(j * W + i);
    return { id: 't' + n, x: (i + 0.5) * CELL, z: (j + 0.5) * CELL, room: r.id };
  });

  // --- Monster spawn: farthest room
  const far = cand[0];
  const monsterSpawn = { x: (far.cx + 0.5) * CELL, z: (far.cy + 0.5) * CELL };

  // --- Batteries
  const floorCells = [];
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (grid[j * W + i]) floorCells.push([i, j]);
  const batteries = [];
  for (let t = 0; t < 600 && batteries.length < 14; t++) {
    const [i, j] = pick(floorCells);
    const k = j * W + i;
    if (used.has(k) || dist[k] < 5) continue;
    used.add(k);
    batteries.push({ id: 'b' + batteries.length, x: (i + 0.5) * CELL + (rng() - 0.5) * 1.2, z: (j + 0.5) * CELL + (rng() - 0.5) * 1.2 });
  }

  // --- Doorways (room <-> corridor openings, 1 cell wide)
  const isF = (i, j) => i >= 0 && j >= 0 && i < W && j < H && grid[j * W + i] !== 0;
  const doors = [];
  const doorEdge = new Set();
  for (const r of rooms) {
    for (let j = r.y; j < r.y + r.h; j++) for (let i = r.x; i < r.x + r.w; i++) {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const oi = i + dx, oj = j + dz;
        if (oi >= r.x && oi < r.x + r.w && oj >= r.y && oj < r.y + r.h) continue;
        if (!isF(oi, oj) || roomId[oj * W + oi] === r.id) continue;
        const px = dz, pz = dx; // perpendicular
        if (isF(oi + px, oj + pz) || isF(oi - px, oj - pz)) continue;
        doors.push({ i, j, dx, dz, leaf: rng() < 0.6, room: r.id, swing: rng() < 0.5 ? 1 : -1 });
        doorEdge.add(j * W + i);
      }
    }
  }

  // --- Props along room walls
  const props = [];
  for (const r of rooms) {
    const list = ROOM_PROPS[r.type];
    let count = 0;
    for (let j = r.y; j < r.y + r.h; j++) for (let i = r.x; i < r.x + r.w; i++) {
      const k = j * W + i;
      if (i === r.cx || j === r.cy || path[k] || used.has(k) || doorEdge.has(k)) continue;
      if (r.type === 'foyer' && Math.abs(i - r.cx) <= 1 && Math.abs(j - r.cy) <= 1) continue;
      // entrance adjacency: any neighbour outside the room that is floor
      let nearOpen = false; const walls = [];
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const oi = i + dx, oj = j + dz;
        const inside = oi >= r.x && oi < r.x + r.w && oj >= r.y && oj < r.y + r.h;
        if (inside) continue;
        if (isF(oi, oj)) nearOpen = true; else walls.push([dx, dz]);
      }
      if (nearOpen || !walls.length || count >= 7) continue;
      if (rng() > 0.55) continue;
      const [wx, wz] = pick(walls);
      const hideType = ['ward', 'office', 'nursery', 'records'].includes(r.type) && rng() < 0.5 ? 'wardrobe' : 'locker';
      const type = (count === 0 && r.type !== 'foyer' && rng() < 0.9) || ((count === 2 || count === 4) && rng() < 0.45) ? hideType : pick(list);
      const [pw, pd] = PROP_SIZE[type];
      const off = CELL / 2 - pd / 2 - 0.08;
      const rot = wz === -1 ? 0 : wz === 1 ? Math.PI : wx === -1 ? Math.PI / 2 : -Math.PI / 2;
      const swap = wx !== 0;
      props.push({
        type, rot,
        x: (i + 0.5) * CELL + wx * off, z: (j + 0.5) * CELL + wz * off,
        hw: (swap ? pd : pw) / 2, hd: (swap ? pw : pd) / 2,
        seed: Math.floor(rng() * 1e6),
      });
      count++;
    }
  }

  // --- Ceiling bulbs
  const bulbs = [];
  for (const r of rooms) {
    if (r.id === 0 || rng() < 0.88) bulbs.push({ x: (r.cx + 0.5) * CELL, z: (r.cy + 0.5) * CELL, flicker: r.id !== 0 && rng() < 0.55, warm: rng() < 0.7 });
  }
  const corrCells = floorCells.filter(([i, j]) => grid[j * W + i] === 2);
  for (let n = 0; n < 26 && corrCells.length; n++) {
    const [i, j] = pick(corrCells);
    if (bulbs.some((b) => Math.hypot(b.x / CELL - (i + 0.5), b.z / CELL - (j + 0.5)) < 4)) continue;
    bulbs.push({ x: (i + 0.5) * CELL, z: (j + 0.5) * CELL, flicker: rng() < 0.45, warm: rng() < 0.5 });
  }

  // --- Decals: writing on walls, blood on floors
  const writings = [];
  for (let t = 0; t < 600 && writings.length < 24; t++) {
    const [i, j] = pick(floorCells);
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => !isF(i + dx, j + dz));
    if (!dirs.length) continue;
    const [dx, dz] = pick(dirs);
    writings.push({ i, j, dx, dz, text: pick(WRITINGS), seed: Math.floor(rng() * 1e6) });
  }
  const blood = [];
  for (let n = 0; n < 32; n++) {
    const [i, j] = pick(floorCells);
    blood.push({ x: (i + 0.5) * CELL + (rng() - 0.5) * 1.8, z: (j + 0.5) * CELL + (rng() - 0.5) * 1.8, s: 0.8 + rng() * 1.6, r: rng() * 6.28, seed: Math.floor(rng() * 1e6) });
  }

  // lockers along straight corridors
  const corrLockers = [];
  for (let t = 0; t < 900 && corrLockers.length < 20; t++) {
    const [i, j] = pick(corrCells);
    const k = j * W + i;
    const ns = isF(i, j - 1) && isF(i, j + 1) && !isF(i - 1, j) && !isF(i + 1, j);
    const ew = isF(i - 1, j) && isF(i + 1, j) && !isF(i, j - 1) && !isF(i, j + 1);
    if (!(ns || ew) || used.has(k) || corrLockers.some(([a, b]) => Math.abs(a - i) + Math.abs(b - j) < 4)) continue;
    used.add(k); corrLockers.push([i, j]);
    const [wx, wz] = ns ? (rng() < 0.5 ? [-1, 0] : [1, 0]) : (rng() < 0.5 ? [0, -1] : [0, 1]);
    const [pw, pd] = PROP_SIZE.locker;
    const off = CELL / 2 - pd / 2 - 0.04;
    const rot = wz === -1 ? 0 : wz === 1 ? Math.PI : wx === -1 ? Math.PI / 2 : -Math.PI / 2;
    const swap = wx !== 0;
    props.push({ type: 'locker', rot, x: (i + 0.5) * CELL + wx * off, z: (j + 0.5) * CELL + wz * off, hw: (swap ? pd : pw) / 2, hd: (swap ? pw : pd) / 2, seed: Math.floor(rng() * 1e6) });
  }

  // room names + compass wings (used for signs and clues)
  const counts = {};
  const letters = 'ABCDEFGH';
  for (const r of rooms) {
    const n = (counts[r.type] = (counts[r.type] || 0) + 1);
    const total = rooms.filter((q) => q.type === r.type).length;
    const base = ROOM_NAMES[r.type];
    if (r.isHeart) { r.wing = r.wing || ''; }
    r.label = r.isHeart ? 'ROOM 41' : total > 1 ? (r.type === 'ward' ? `${base} ${letters[n - 1]}` : `${base} ${n}`) : base;
    const dx = r.cx - W / 2, dz = r.cy - H / 2, th = W / 7;
    const ns = dz < -th ? 'north' : dz > th ? 'south' : '';
    const ew = dx < -th ? 'west' : dx > th ? 'east' : '';
    r.wing = ns || ew ? `${ns}${ns && ew ? '-' : ''}${ew} wing` : 'middle of the building';
  }

  // notes: clues to each effigy + lore
  const notes = [];
  const noteSpot = (avoidRoom) => {
    for (let t = 0; t < 200; t++) {
      const r = pick(rooms);
      if (r.id === avoidRoom || r.id === 0 && rng() < 0.7) continue;
      const i = r.x + Math.floor(rng() * r.w), j = r.y + Math.floor(rng() * r.h), k = j * W + i;
      if (used.has(k)) continue;
      used.add(k);
      return { x: (i + 0.5) * CELL + (rng() - 0.5) * 1.4, z: (j + 0.5) * CELL + (rng() - 0.5) * 1.4, room: r.id };
    }
    return null;
  };
  const tmpl = CLUE_TEMPLATES.slice().sort(() => rng() - 0.5);
  talismans.forEach((t, n) => {
    const r = rooms[t.room];
    const sp = noteSpot(r.id); if (!sp) return;
    const wing = r.wing, cap = wing[0].toUpperCase() + wing.slice(1);
    const text = tmpl[n % tmpl.length].replace(/\{ROOM\}/g, r.label).replace(/\{WING\}/g, wing).replace(/\{WING_CAP\}/g, cap);
    notes.push({ id: 'n' + notes.length, ...sp, text, clue: t.id, about: `${r.label}, ${wing}`, rot: rng() * 6.28 });
  });
  const lore = [...LORE_NOTES.slice(-3), ...LORE_NOTES.slice(0, -3).sort(() => rng() - 0.5).slice(0, 5)];
  for (const text of lore) { const sp = noteSpot(-1); if (sp) notes.push({ id: 'n' + notes.length, ...sp, text, rot: rng() * 6.28 }); }

  // ROOM 41: where her heart still beats (the finale)
  const heartRoom = cand.find((r) => !r.hasTalisman && r.w >= 3 && r.h >= 3) || cand[1] || cand[0];
  heartRoom.label = 'ROOM 41'; heartRoom.isHeart = true;
  const heart = { x: (heartRoom.cx + 0.5) * CELL, z: (heartRoom.cy + 0.5) * CELL, room: heartRoom.id };
  used.add(heartRoom.cy * W + heartRoom.cx);

  // spirit bells: ring one to freeze her
  const bells = [];
  for (let t = 0; t < 600 && bells.length < 9; t++) {
    const [i, j] = pick(floorCells);
    const k = j * W + i;
    if (used.has(k) || dist[k] < 4 || bells.some((b) => Math.hypot(b.x / CELL - i, b.z / CELL - j) < 6)) continue;
    used.add(k);
    bells.push({ id: 'w' + bells.length, x: (i + 0.5) * CELL + (rng() - 0.5), z: (j + 0.5) * CELL + (rng() - 0.5) });
  }

  // soul candles: hold one over a fallen friend to bring them back
  const souls = [];
  for (let t = 0; t < 600 && souls.length < 7; t++) {
    const r = pick(rooms);
    if (r.id === 0) continue;
    const i = r.x + Math.floor(rng() * r.w), j = r.y + Math.floor(rng() * r.h), k = j * W + i;
    if (used.has(k) || souls.some((q) => Math.hypot(q.x / CELL - i, q.z / CELL - j) < 7)) continue;
    used.add(k);
    souls.push({ id: 'r' + souls.length, x: (i + 0.5) * CELL + (rng() - 0.5), z: (j + 0.5) * CELL + (rng() - 0.5) });
  }

  // hiding places
  const hides = props.filter((p) => HIDE_TYPES.has(p.type)).map((p, n) => ({ id: 'h' + n, type: p.type, x: p.x, z: p.z, rot: p.rot, fx: Math.sin(p.rot), fz: Math.cos(p.rot) }));

  const fx = (foyer.cx + 0.5) * CELL, fz = (foyer.cy + 0.5) * CELL;
  const spawns = [[fx + 1, fz - 1], [fx + 1, fz + 1], [fx - 1, fz - 1], [fx - 1, fz + 1], [fx + 2.2, fz], [fx - 0.2, fz]];
  const exit = { x: foyer.x * CELL, z: (cy0 + 0.5) * CELL };

  return {
    W, H, grid, roomId, path, rooms, talismans, batteries, monsterSpawn, doors, props,
    bulbs, writings, blood, spawns, exit, hides, notes, heart, bells, souls,
  };
}

// ---------- helpers ----------
export function isWall(map, i, j) {
  if (i < 0 || j < 0 || i >= map.W || j >= map.H) return true;
  return map.grid[j * map.W + i] === 0;
}
export function cellOf(x) { return Math.floor(x / CELL); }

export function bfsDist(map, si, sj) {
  const { W, H } = map;
  const dist = new Int32Array(W * H).fill(1e9);
  const q = new Int32Array(W * H);
  let h = 0, t = 0;
  dist[sj * W + si] = 0; q[t++] = sj * W + si;
  while (h < t) {
    const k = q[h++], i = k % W, j = (k / W) | 0;
    const nd = dist[k] + 1;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + dx, nj = j + dz;
      if (isWall(map, ni, nj)) continue;
      const nk = nj * W + ni;
      if (dist[nk] > nd) { dist[nk] = nd; q[t++] = nk; }
    }
  }
  return dist;
}

export function bfsPath(map, si, sj, ti, tj) {
  const { W, H } = map;
  if (isWall(map, ti, tj) || isWall(map, si, sj)) return null;
  const prev = new Int32Array(W * H).fill(-1);
  const q = new Int32Array(W * H);
  let h = 0, t = 0;
  const s = sj * W + si, goal = tj * W + ti;
  prev[s] = s; q[t++] = s;
  while (h < t) {
    const k = q[h++];
    if (k === goal) break;
    const i = k % W, j = (k / W) | 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + dx, nj = j + dz;
      if (isWall(map, ni, nj)) continue;
      const nk = nj * W + ni;
      if (prev[nk] !== -1) continue;
      prev[nk] = k; q[t++] = nk;
    }
  }
  if (prev[goal] === -1) return null;
  const out = [];
  for (let k = goal; k !== s; k = prev[k]) out.push([k % W, (k / W) | 0]);
  out.reverse();
  return out;
}

export function lineOfSight(map, x0, z0, x1, z1) {
  const dx = x1 - x0, dz = z1 - z0;
  const d = Math.hypot(dx, dz);
  const steps = Math.ceil(d / 0.3);
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    if (isWall(map, Math.floor((x0 + dx * t) / CELL), Math.floor((z0 + dz * t) / CELL))) return false;
  }
  return true;
}

// push a circle out of walls
export function resolveCircle(map, x, z, r) {
  for (let pass = 0; pass < 2; pass++) {
    const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL);
    for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) {
      if (!isWall(map, i, j)) continue;
      const r2 = pushOutBox(x, z, r, i * CELL, j * CELL, (i + 1) * CELL, (j + 1) * CELL);
      if (r2) { x = r2[0]; z = r2[1]; }
    }
  }
  return [x, z];
}

export function pushOutBox(x, z, r, minx, minz, maxx, maxz) {
  const px = Math.max(minx, Math.min(x, maxx)), pz = Math.max(minz, Math.min(z, maxz));
  const dx = x - px, dz = z - pz, d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return null;
  if (d2 > 1e-9) { const d = Math.sqrt(d2); return [px + (dx / d) * r, pz + (dz / d) * r]; }
  // centre inside box: push along smallest axis
  const l = x - minx, rr = maxx - x, t = z - minz, b = maxz - z;
  const m = Math.min(l, rr, t, b);
  if (m === l) return [minx - r, z];
  if (m === rr) return [maxx + r, z];
  if (m === t) return [x, minz - r];
  return [x, maxz + r];
}
