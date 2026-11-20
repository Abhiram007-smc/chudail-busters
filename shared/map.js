// Shared between server (Node) and client (browser).
// Deterministic 3-floor asylum generator (basement, ground floor, upper floor) + grid physics helpers.

export const CELL = 3;        // world units per grid cell
export const WALL_H = 3;      // ceiling height
export const FLOOR_H = 3;     // height of one storey
export const GRID = 39;       // each floor is GRID x GRID cells
export const LEVELS = [-1, 0, 1];
export const LEVEL_NAMES = { '-1': 'basement', 0: 'ground floor', 1: 'upper floor' };
export const TALISMANS = 5;   // ritual items needed for the pentagram
export const ITEM_KINDS = [
  { kind: 'skull', name: 'Human Skull' },
  { kind: 'candle', name: 'Black Candle' },
  { kind: 'mirror', name: 'Cracked Mirror' },
  { kind: 'doll', name: 'Cursed Doll' },
  { kind: 'hair', name: 'Braid of Her Hair' },
];
export const DIFFICULTY = {
  easy: { label: 'Easy', speed: 0.8, sight: 0.75, hearing: 0.6, crawler: false, items: 1.4, revive: 1.4 },
  normal: { label: 'Normal', speed: 1, sight: 1, hearing: 1, crawler: true, items: 1, revive: 1 },
  hard: { label: 'Hard', speed: 1.15, sight: 1.25, hearing: 1.35, crawler: true, items: 0.75, revive: 0.7 },
  nightmare: { label: 'Nightmare', speed: 1.3, sight: 1.5, hearing: 1.7, crawler: true, items: 0.5, revive: 0.45 },
};
// what she is tonight (the server picks one per game): multipliers on top of the difficulty
export const GHOST_TYPES = {
  chudail: { name: 'The Chudail', hint: 'She sees, she hears, she hunts. The one from the stories.', sight: 1, hearing: 1, speed: 1, lit: 0.45, dark: 1 },
  blind: { name: 'The Blind Bride', hint: 'She cannot see you at all, but she hears everything, and she is fast. Crouch. Sneak. Do not run.', sight: 0.12, hearing: 2.2, speed: 1.15, lit: 1, dark: 1, blind: true },
  shadow: { name: 'The Shadow', hint: 'In torchlight she cannot move at all. In the dark she is very fast. Keep your light on her.', sight: 1, hearing: 0.9, speed: 1, lit: 0, dark: 1.35 },
  hungry: { name: 'The Hungry One', hint: 'Slow, but she never stops. Every so often she simply knows where the nearest of you is.', sight: 1, hearing: 1.1, speed: 0.82, lit: 0.6, dark: 1, sense: 25 },
};
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
// The server (Node) and every browser must build the exact same map from a seed. Math.hypot is not
// guaranteed to round identically across JS engines (a 1-ulp difference flips tie-breaks and the maps
// diverge), but + * and Math.sqrt are exact IEEE operations everywhere. Never use Math.hypot in here.
const edist = (...v) => { let s = 0; for (const x of v) s += x * x; return Math.sqrt(s); };

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WRITINGS = [
  'IT HEARS YOU', "DON'T RUN", 'SHE IS TALL', 'NO WAY OUT', 'TURN AROUND', 'IT WAS NEVER A HOSPITAL',
  'WHERE ARE THE NURSES', 'STAY TOGETHER', 'DONT LOOK AT IT', 'IT WEARS THEIR FACES', 'HELP US',
  'FIVE POINTS FIVE GIFTS', 'I CAN STILL HEAR HER', 'LIGHTS OUT', 'IT SMILES', 'SHE COUNTS US',
  'DONT GET IN IF IT SEES', 'WALK SLOW', 'THE STAR WANTS GIFTS', 'NURSE HALE LIED', 'SHE IS DOWNSTAIRS',
  'WE ARE STILL HERE', 'BRING HER TO THE STAR', 'LISTEN', 'NOT ALONE', 'HER FEET POINT BACK',
];

const ROOM_NAMES = {
  foyer: 'FOYER', ward: 'WARD', office: 'OFFICE', storage: 'STORAGE', bath: 'BATHS', chapel: 'CHAPEL',
  nursery: 'NURSERY', morgue: 'MORGUE', surgery: 'SURGERY', records: 'RECORDS', shrine: 'THE SHRINE',
};
const LEVEL_TYPES = {
  '-1': ['morgue', 'morgue', 'storage', 'surgery', 'bath', 'storage', 'records'],
  0: ['ward', 'office', 'chapel', 'nursery', 'records', 'bath', 'ward', 'office'],
  1: ['ward', 'ward', 'nursery', 'bath', 'storage', 'office', 'surgery', 'nursery'],
};

// Clues never name the room. They describe what kind of room it is and roughly which floor, and every
// item has her sign: the same mark is drawn on the note and scratched on the walls by that room's door
// and inside it, next to the item.
const CLUE_TEMPLATES = [
  "Dr. Hale took the {ITEM} away from her and hid it {RIDDLE}, {FLOOR}.\nHe scratched her sign beside it so he could find it again.\nThis sign:",
  "Night log, 3:12 am.\nThe new nurse carried the {ITEM} {RIDDLE}. {FLOOR_CAP}.\nShe never came back out. There are scratches on the wall by that door. Like this:",
  "Patient 41 draws the same sign over and over.\nShe whispers that her {ITEM} is {RIDDLE}, {FLOOR}.\nShe says the walls there are marked.",
  "Five gifts for the star.\nThe {ITEM} is {RIDDLE}, {FLOOR}. Look for her sign on the walls near it.\nI heard her coming and put it back. I am so sorry.",
  "Chaplain's note.\nI sealed the {ITEM} away {RIDDLE}, {FLOOR}, and marked the door so no one would go in.\nThe mark:",
  "Maintenance, again: the candles keep relighting by themselves {RIDDLE}. {FLOOR_CAP}.\nAnd every morning the same scratches on the wall:",
];
const RIDDLES = {
  ward: ['where they lay in rows and nobody came', 'where the beds still remember their shapes'],
  office: ['at the desk where the doctor signed them in', 'where the doctor kept his secrets in a drawer'],
  storage: ['behind the boxes nobody counts', 'with the things they did not need any more'],
  bath: ['where the water never drains', 'where the tubs are stained and the taps still drip'],
  chapel: ['where nobody prays any more', 'where the pews face an empty wall'],
  nursery: ['where the cradles rock with no one in them', 'where the dolls watch the empty cribs'],
  morgue: ['where the cold ones sleep on steel', 'where they kept the ones who stopped breathing'],
  surgery: ['under the lamp where they cut', 'where the table has straps on it'],
  records: ['among the names nobody reads', 'where every patient became a number in a file'],
};
const FLOOR_HINTS = { '-1': 'below the ground, where the air is wet', 0: 'on the floor with the front door', 1: 'up where the ceiling creaks' };
const FLOOR_SHORT = { '-1': 'below', 0: 'ground floor', 1: 'above' };

const LORE_NOTES = [
  'Admission record, 1971.\nPatient arrived at six feet tall.\n\nRecord, 1973: patient is now seven feet tall. Staff refuse to measure her again.',
  'She cannot see well in the dark.\nBut she hears EVERYTHING.\nWalk slowly. Never run. Never.',
  'The lockers saved my life twice.\nBut do NOT climb in while she is watching. She remembers which one.',
  'Shine the torch in her face and she flinches, slows down.\nBut she will never forget who did it.',
  'Day 9. The nurses stopped coming.\nI hear her walking above the ceiling tiles at night. Click. Click. Click.',
  '(a child\'s drawing of a very tall lady with a long smile)\n\n"she smiles when the lights go out"',
  'To whoever is next:\nThe batteries in the supply rooms still work. The bulbs here do not stay on for long. Neither did we.',
  'Her name was never written down. The night staff called her the CHUDAIL.\nLook at her feet. They point backwards.',
  'The orderlies said: if you see footprints walking away from you in the dust, run. She is coming TOWARD you.',
  'THE SHRINE IS IN THE BASEMENT.\nFive points on the star. Five gifts. When the star burns, she must stand in the middle.\nMake her follow you in. It is the only way she can be bound.',
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
  shrine: [],
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
  for (let attempt = 0; attempt < 30; attempt++) {
    const m = tryGenerate((seed + attempt * 7919) >>> 0);
    if (m) { m.seed = seed; return m; }
  }
  throw new Error('map generation failed');
}

function tryGenerate(seed) {
  const rng = mulberry32(seed);
  const W = GRID, H = GRID;
  const ri = (a, b) => a + Math.floor(rng() * (b - a + 1));
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  // Fisher-Yates with our rng. Never shuffle with arr.sort(() => rng() - 0.5): each JS engine's sort calls the
  // comparator a different number of times, so Chrome, Firefox, Safari and Node would all build different maps.
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const grid = {}, roomId = {}, path = {};
  const rooms = [];
  const cy0 = Math.floor(H / 2);

  // ---------- rooms + corridors on each floor ----------
  for (const L of LEVELS) {
    const g = (grid[L] = new Uint8Array(W * H));
    const rid = (roomId[L] = new Int16Array(W * H).fill(-1));
    const pth = (path[L] = new Uint8Array(W * H));
    const lr = [];
    if (L === 0) lr.push({ x: 2, y: cy0 - 2, w: 5, h: 5, type: 'foyer' });
    if (L === -1) lr.push({ x: Math.floor(W / 2) - 4, y: Math.floor(H / 2) - 4, w: 9, h: 9, type: 'shrine' });
    const target = L === 0 ? 16 : L === 1 ? 15 : 11;
    for (let a = 0; a < 2500 && lr.length < target; a++) {
      const w = ri(3, 7), h = ri(3, 7), x = ri(1, W - w - 1), y = ri(1, H - h - 1);
      if (lr.some((r) => x < r.x + r.w + 2 && x + w + 2 > r.x && y < r.y + r.h + 2 && y + h + 2 > r.y)) continue;
      lr.push({ x, y, w, h, type: pick(LEVEL_TYPES[L]) });
    }
    if (lr.length < target - 4) return null;
    for (const r of lr) {
      r.id = rooms.length; r.L = L; rooms.push(r);
      r.cx = r.x + Math.floor(r.w / 2); r.cy = r.y + Math.floor(r.h / 2);
      for (let j = r.y; j < r.y + r.h; j++) for (let i = r.x; i < r.x + r.w; i++) { g[j * W + i] = 1; rid[j * W + i] = r.id; }
    }
    const carve = (i, j) => { const k = j * W + i; if (g[k] === 0) g[k] = 2; pth[k] = 1; };
    const corridor = (a, b) => {
      let i = a.cx, j = a.cy;
      const goH = () => { while (i !== b.cx) { carve(i, j); i += Math.sign(b.cx - i); } };
      const goV = () => { while (j !== b.cy) { carve(i, j); j += Math.sign(b.cy - j); } };
      if (rng() < 0.5) { goH(); goV(); } else { goV(); goH(); }
      carve(i, j);
    };
    const md = (a, b) => Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy);
    const conn = [lr[0]], left = lr.slice(1), edges = [];
    while (left.length) {
      let best = null, bd = 1e9;
      for (const a of conn) for (const b of left) { const d = md(a, b); if (d < bd) { bd = d; best = [a, b]; } }
      edges.push(best); conn.push(best[1]); left.splice(left.indexOf(best[1]), 1);
    }
    for (let t = 0, extra = 0; t < 400 && extra < 6; t++) {
      const a = pick(lr), b = pick(lr);
      if (a === b || md(a, b) > 18 || edges.some((e) => e.includes(a) && e.includes(b))) continue;
      edges.push([a, b]); extra++;
    }
    edges.forEach(([a, b]) => corridor(a, b));
  }

  // ---------- staircases ----------
  const stairs = [];
  const inB = (i, j) => i >= 1 && j >= 1 && i < W - 1 && j < H - 1;
  const tunnel = (L, start, forbid) => { // shortest dig from start to existing floor
    const key = (i, j) => j * W + i, fb = new Set(forbid.map(([i, j]) => key(i, j)));
    const prev = new Map([[key(...start), -1]]), q = [start];
    while (q.length) {
      const [i, j] = q.shift();
      if (!(i === start[0] && j === start[1]) && grid[L][key(i, j)] !== 0) {
        const out = []; let k = prev.get(key(i, j));
        while (k !== -1) { out.push([k % W, (k / W) | 0]); k = prev.get(k); }
        return out.length <= 10 ? out : null;
      }
      for (const [dx, dz] of DIRS) {
        const ni = i + dx, nj = j + dz, nk = key(ni, nj);
        if (!inB(ni, nj) || fb.has(nk) || prev.has(nk)) continue;
        prev.set(nk, key(i, j)); q.push([ni, nj]);
      }
    }
    return null;
  };
  const carveStair = (lo) => {
    const up = lo + 1;
    for (let t = 0; t < 5000; t++) {
      const d = pick(DIRS), i = ri(3, W - 4), j = ri(3, H - 4);
      const c = (k) => [i + d[0] * k, j + d[1] * k];
      const cells = [c(-1), c(0), c(1), c(2), c(3)];
      if (cells.some(([a, b]) => !inB(a, b))) continue;
      const perp = [d[1], d[0]];
      const sides = (p) => [[p[0] + perp[0], p[1] + perp[1]], [p[0] - perp[0], p[1] - perp[1]]];
      const wall = (L, [a, b]) => grid[L][b * W + a] === 0;
      if (![c(0), c(1), c(2)].every((p) => wall(lo, p)) || ![...sides(c(0)), ...sides(c(1))].every((p) => wall(lo, p))) continue;
      if (![c(0), c(1)].every((p) => wall(up, p)) || ![...sides(c(0)), ...sides(c(1))].every((p) => wall(up, p))) continue;
      if (stairs.some((s) => Math.abs(s.c1[0] - i) + Math.abs(s.c1[1] - j) < 8)) continue;
      const forbidLo = [c(0), c(1), c(2), ...sides(c(0)), ...sides(c(1))];
      const forbidUp = [c(0), c(1), ...sides(c(0)), ...sides(c(1))];
      const tl = tunnel(lo, c(-1), forbidLo), tu = tunnel(up, c(2), forbidUp);
      if (!tl || !tu) continue;
      for (const [a, b] of [c(-1), ...tl]) { const k = b * W + a; if (!grid[lo][k]) grid[lo][k] = 2; path[lo][k] = 1; }
      for (const [a, b] of [c(2), ...tu]) { const k = b * W + a; if (!grid[up][k]) grid[up][k] = 2; path[up][k] = 1; }
      for (const p of [c(0), c(1)]) { grid[lo][p[1] * W + p[0]] = 3; path[lo][p[1] * W + p[0]] = 1; grid[up][p[1] * W + p[0]] = 4; }
      stairs.push({ L: lo, c1: c(0), c2: c(1), c3: c(2), c0: c(-1), d });
      return true;
    }
    return false;
  };
  for (const lo of [0, 0, -1, -1]) if (!carveStair(lo)) return null;

  const map = { W, H, grid, roomId, path, rooms, stairs, levels: LEVELS };
  const foyer = rooms.find((r) => r.type === 'foyer');
  const shrineRoom = rooms.find((r) => r.type === 'shrine');
  const dist = bfsDist3(map, 0, foyer.cx, foyer.cy);
  const N = W * H;
  const dAt = (L, i, j) => dist[(L + 1) * N + j * W + i];
  if (dAt(-1, shrineRoom.cx, shrineRoom.cy) > 1e8 || rooms.some((r) => dAt(r.L, r.cx, r.cy) > 1e8)) return null; // must all connect
  const used = { '-1': new Set(), 0: new Set(), 1: new Set() };
  // keep the shrine floor clear
  for (let j = shrineRoom.y; j < shrineRoom.y + shrineRoom.h; j++) for (let i = shrineRoom.x; i < shrineRoom.x + shrineRoom.w; i++) used[-1].add(j * W + i);
  const floorCells = {};
  for (const L of LEVELS) { floorCells[L] = []; for (let k = 0; k < N; k++) if (grid[L][k] === 1 || grid[L][k] === 2) floorCells[L].push([k % W, (k / W) | 0]); }

  // ---------- ritual items, spread over all floors ----------
  const cand = rooms.filter((r) => r.type !== 'foyer' && r.type !== 'shrine').sort((a, b) => dAt(b.L, b.cx, b.cy) - dAt(a.L, a.cx, a.cy));
  const pos3 = (r) => [r.cx, r.cy, r.L * 12];
  const chosen = [cand[0]];
  while (chosen.length < TALISMANS) {
    let best = null, bs = -1;
    for (const r of cand) {
      if (chosen.includes(r)) continue;
      const p = pos3(r);
      const mind = Math.min(...chosen.map((c) => { const q = pos3(c); return edist(p[0] - q[0], p[1] - q[1], p[2] - q[2]); }));
      const s = mind + dAt(r.L, r.cx, r.cy) * 0.1 + (chosen.filter((c) => c.L === r.L).length >= 2 ? -40 : 0);
      if (s > bs) { bs = s; best = r; }
    }
    chosen.push(best);
  }
  const kinds = shuffle(ITEM_KINDS.slice());
  const talismans = chosen.map((r, n) => {
    r.hasTalisman = true;
    const cells = [];
    for (let j = r.y + 1; j < r.y + r.h - 1; j++) for (let i = r.x + 1; i < r.x + r.w - 1; i++) if (i !== r.cx && j !== r.cy && !path[r.L][j * W + i]) cells.push([i, j]);
    const [i, j] = cells.length ? pick(cells) : [r.cx, r.cy];
    used[r.L].add(j * W + i);
    return { id: 't' + n, ...kinds[n], x: (i + 0.5) * CELL, z: (j + 0.5) * CELL, L: r.L, room: r.id };
  });

  // ---------- the shrine (pentagram) ----------
  const sx = (shrineRoom.cx + 0.5) * CELL, sz = (shrineRoom.cy + 0.5) * CELL;
  const shrine = {
    x: sx, z: sz, L: -1, room: shrineRoom.id, r: 5.4, center: 1.5,
    points: [0, 1, 2, 3, 4].map((k) => { const a = -Math.PI / 2 + (k * 2 * Math.PI) / 5; return { x: sx + Math.cos(a) * 5.4, z: sz + Math.sin(a) * 5.4 }; }),
  };

  // ---------- monster spawn: farthest room upstairs or downstairs ----------
  const far = cand.find((r) => r.L !== 0) || cand[0];
  const monsterSpawn = { x: (far.cx + 0.5) * CELL, z: (far.cy + 0.5) * CELL, L: far.L };

  const scatter = (count, prefix, minDist, spacing, filter) => {
    const out = [];
    for (let t = 0; t < 3000 && out.length < count; t++) {
      const L = pick(LEVELS); const [i, j] = pick(floorCells[L]); const k = j * W + i;
      if (used[L].has(k) || dAt(L, i, j) < minDist || (filter && !filter(L, i, j))) continue;
      if (out.some((b) => b.L === L && edist(b.x / CELL - i, b.z / CELL - j) < spacing)) continue;
      used[L].add(k);
      out.push({ id: prefix + out.length, x: (i + 0.5) * CELL + (rng() - 0.5) * 1.0, z: (j + 0.5) * CELL + (rng() - 0.5) * 1.0, L });
    }
    return out;
  };
  const batteries = scatter(18, 'b', 5, 3);
  const bells = scatter(6, 'w', 5, 9); // rarer: a bell freezes her, it should feel precious
  const souls = scatter(9, 'r', 4, 7, (L, i, j) => grid[L][j * W + i] === 1);

  // ---------- doorways, props, bulbs, decals per floor ----------
  const doors = [], props = [], bulbs = [], writings = [], blood = [];
  for (const L of LEVELS) {
    const g = grid[L], rid = roomId[L], pth = path[L];
    const isF = (i, j) => i >= 0 && j >= 0 && i < W && j < H && (g[j * W + i] === 1 || g[j * W + i] === 2);
    const solid = (i, j) => !(i >= 0 && j >= 0 && i < W && j < H) || g[j * W + i] === 0;
    const doorEdge = new Set();
    const lrooms = rooms.filter((r) => r.L === L);
    for (const r of lrooms) {
      for (let j = r.y; j < r.y + r.h; j++) for (let i = r.x; i < r.x + r.w; i++) for (const [dx, dz] of DIRS) {
        const oi = i + dx, oj = j + dz;
        if (oi >= r.x && oi < r.x + r.w && oj >= r.y && oj < r.y + r.h) continue;
        if (!isF(oi, oj) || rid[oj * W + oi] === r.id) continue;
        const px = dz, pz = dx;
        if (isF(oi + px, oj + pz) || isF(oi - px, oj - pz)) continue;
        doors.push({ i, j, dx, dz, L, leaf: r.type !== 'shrine' && rng() < 0.6, room: r.id, swing: rng() < 0.5 ? 1 : -1 });
        doorEdge.add(j * W + i);
      }
    }
    for (const r of lrooms) {
      if (r.type === 'shrine') continue;
      const list = ROOM_PROPS[r.type];
      let count = 0;
      for (let j = r.y; j < r.y + r.h; j++) for (let i = r.x; i < r.x + r.w; i++) {
        const k = j * W + i;
        if (i === r.cx || j === r.cy || pth[k] || used[L].has(k) || doorEdge.has(k)) continue;
        if (r.type === 'foyer' && Math.abs(i - r.cx) <= 1 && Math.abs(j - r.cy) <= 1) continue;
        let nearOpen = false; const walls = [];
        for (const [dx, dz] of DIRS) {
          const oi = i + dx, oj = j + dz;
          if (oi >= r.x && oi < r.x + r.w && oj >= r.y && oj < r.y + r.h) continue;
          if (!solid(oi, oj)) nearOpen = true; else walls.push([dx, dz]);
        }
        if (nearOpen || !walls.length || count >= 10 || rng() > 0.75) continue; // fuller rooms
        const [wx, wz] = pick(walls);
        const hideType = ['ward', 'office', 'nursery', 'records'].includes(r.type) && rng() < 0.5 ? 'wardrobe' : 'locker';
        const type = (count === 0 && r.type !== 'foyer' && rng() < 0.9) || ((count === 2 || count === 4 || count === 6) && rng() < 0.6) ? hideType : pick(list);
        const [pw, pd] = PROP_SIZE[type];
        const off = CELL / 2 - pd / 2 - 0.08;
        const rot = wz === -1 ? 0 : wz === 1 ? Math.PI : wx === -1 ? Math.PI / 2 : -Math.PI / 2;
        const swap = wx !== 0;
        props.push({ type, rot, L, x: (i + 0.5) * CELL + wx * off, z: (j + 0.5) * CELL + wz * off, hw: (swap ? pd : pw) / 2, hd: (swap ? pw : pd) / 2, seed: Math.floor(rng() * 1e6) });
        count++;
      }
    }
    // corridor lockers
    const corr = floorCells[L].filter(([i, j]) => g[j * W + i] === 2);
    const placed = [];
    for (let t = 0; t < 1200 && placed.length < 13; t++) {
      const [i, j] = pick(corr); const k = j * W + i;
      const ns = isF(i, j - 1) && isF(i, j + 1) && solid(i - 1, j) && solid(i + 1, j);
      const ew = isF(i - 1, j) && isF(i + 1, j) && solid(i, j - 1) && solid(i, j + 1);
      if (!(ns || ew) || used[L].has(k) || placed.some(([a, b]) => Math.abs(a - i) + Math.abs(b - j) < 4)) continue;
      used[L].add(k); placed.push([i, j]);
      const [wx, wz] = ns ? (rng() < 0.5 ? [-1, 0] : [1, 0]) : (rng() < 0.5 ? [0, -1] : [0, 1]);
      const [pw, pd] = PROP_SIZE.locker; const off = CELL / 2 - pd / 2 - 0.04;
      const rot = wz === -1 ? 0 : wz === 1 ? Math.PI : wx === -1 ? Math.PI / 2 : -Math.PI / 2;
      const swap = wx !== 0;
      props.push({ type: 'locker', rot, L, x: (i + 0.5) * CELL + wx * off, z: (j + 0.5) * CELL + wz * off, hw: (swap ? pd : pw) / 2, hd: (swap ? pw : pd) / 2, seed: Math.floor(rng() * 1e6) });
    }
    for (const r of lrooms) {
      if (r.type === 'shrine') continue;
      if (r.type === 'foyer' || rng() < 0.85) bulbs.push({ x: (r.cx + 0.5) * CELL, z: (r.cy + 0.5) * CELL, L, flicker: r.type !== 'foyer' && rng() < 0.55, warm: rng() < 0.7 });
    }
    for (let n = 0; n < 16 && corr.length; n++) {
      const [i, j] = pick(corr);
      if (bulbs.some((b) => b.L === L && edist(b.x / CELL - (i + 0.5), b.z / CELL - (j + 0.5)) < 4)) continue;
      bulbs.push({ x: (i + 0.5) * CELL, z: (j + 0.5) * CELL, L, flicker: rng() < 0.45, warm: rng() < 0.5 });
    }
    for (let t = 0, n = 0; t < 600 && n < 14; t++) {
      const [i, j] = pick(floorCells[L]);
      const dirs = DIRS.filter(([dx, dz]) => solid(i + dx, j + dz));
      if (!dirs.length) continue;
      const [dx, dz] = pick(dirs);
      writings.push({ i, j, dx, dz, L, text: pick(WRITINGS), seed: Math.floor(rng() * 1e6) }); n++;
    }
    for (let n = 0; n < 18; n++) {
      const [i, j] = pick(floorCells[L]);
      blood.push({ x: (i + 0.5) * CELL + (rng() - 0.5) * 1.8, z: (j + 0.5) * CELL + (rng() - 0.5) * 1.8, L, s: 0.8 + rng() * 1.6, r: rng() * 6.28, seed: Math.floor(rng() * 1e6) });
    }
  }

  // ---------- room names + wings ----------
  const counts = {};
  const letters = 'ABCDEFGHIJKL';
  for (const r of rooms) {
    const total = rooms.filter((q) => q.type === r.type).length;
    const n = (counts[r.type] = (counts[r.type] || 0) + 1);
    const base = ROOM_NAMES[r.type];
    r.label = total > 1 ? (r.type === 'ward' ? `${base} ${letters[n - 1]}` : `${base} ${n}`) : base;
    const dx = r.cx - W / 2, dz = r.cy - H / 2, th = W / 7;
    const ns = dz < -th ? 'north' : dz > th ? 'south' : '';
    const ew = dx < -th ? 'west' : dx > th ? 'east' : '';
    r.wing = ns || ew ? `${ns}${ns && ew ? '-' : ''}${ew} wing` : 'middle of the building';
    r.floor = LEVEL_NAMES[r.L];
  }

  // ---------- notes: one clue per ritual item + lore ----------
  const notes = [];
  const noteSpot = (avoidRoom) => {
    for (let t = 0; t < 300; t++) {
      const r = pick(rooms);
      if (r.id === avoidRoom || r.type === 'shrine' || (r.type === 'foyer' && rng() < 0.6)) continue;
      const i = r.x + Math.floor(rng() * r.w), j = r.y + Math.floor(rng() * r.h), k = j * W + i;
      if (used[r.L].has(k)) continue;
      used[r.L].add(k);
      return { x: (i + 0.5) * CELL + (rng() - 0.5) * 1.4, z: (j + 0.5) * CELL + (rng() - 0.5) * 1.4, L: r.L, room: r.id };
    }
    return null;
  };
  const tmpl = shuffle(CLUE_TEMPLATES.slice());
  const cap = (x) => x[0].toUpperCase() + x.slice(1);
  talismans.forEach((t, n) => {
    const r = rooms[t.room];
    const sp = noteSpot(r.id); if (!sp) return;
    const riddle = pick(RIDDLES[r.type] || ['somewhere nobody goes']);
    const text = tmpl[n % tmpl.length].replace(/\{ITEM\}/g, t.name.toLowerCase()).replace(/\{RIDDLE\}/g, riddle)
      .replace(/\{FLOOR_CAP\}/g, cap(FLOOR_HINTS[r.L])).replace(/\{FLOOR\}/g, FLOOR_HINTS[r.L]);
    notes.push({ id: 'n' + notes.length, ...sp, text, clue: t.id, sigil: t.kind, about: `${t.name}: "${riddle}", ${FLOOR_SHORT[r.L]}`, rot: rng() * 6.28 });
  });
  // her sign, scratched on the walls: by each door of the item's room (corridor side) and inside, near the item
  const solidAt = (L, i, j) => isWall(map, L, i, j);
  const wallDirs = (L, i, j, not) => DIRS.filter(([dx, dz]) => solidAt(L, i + dx, j + dz) && !(not && dx === not[0] && dz === not[1]));
  for (const t of talismans) {
    const r = rooms[t.room];
    for (const d of doors.filter((q) => q.room === r.id)) {
      const ci = d.i + d.dx, cj = d.j + d.dz;
      if (solidAt(d.L, ci, cj)) continue;
      const dirs = wallDirs(d.L, ci, cj, [-d.dx, -d.dz]);
      if (dirs.length) { const [dx, dz] = pick(dirs); writings.push({ i: ci, j: cj, dx, dz, L: d.L, sigil: t.kind, seed: Math.floor(rng() * 1e6) }); }
    }
    const ti = Math.floor(t.x / CELL), tj = Math.floor(t.z / CELL);
    let best = null, bd = 1e9;
    for (let j = r.y; j < r.y + r.h; j++) for (let i = r.x; i < r.x + r.w; i++) {
      const dirs = wallDirs(r.L, i, j); if (!dirs.length) continue;
      const dd = edist(i - ti, j - tj); if (dd < bd) { bd = dd; best = [i, j, dirs]; }
    }
    if (best) { const [dx, dz] = pick(best[2]); writings.push({ i: best[0], j: best[1], dx, dz, L: r.L, sigil: t.kind, seed: Math.floor(rng() * 1e6) }); }
  }
  const lore = [...LORE_NOTES.slice(-3), ...shuffle(LORE_NOTES.slice(0, -3)).slice(0, 6)];
  for (const text of lore) { const sp = noteSpot(-1); if (sp) notes.push({ id: 'n' + notes.length, ...sp, text, rot: rng() * 6.28 }); }

  const hides = props.filter((p) => HIDE_TYPES.has(p.type)).map((p, n) => ({ id: 'h' + n, type: p.type, L: p.L, x: p.x, z: p.z, rot: p.rot, fx: Math.sin(p.rot), fz: Math.cos(p.rot) }));
  const fx = (foyer.cx + 0.5) * CELL, fz = (foyer.cy + 0.5) * CELL;
  const spawns = [[fx + 1, fz - 1], [fx + 1, fz + 1], [fx - 1, fz - 1], [fx - 1, fz + 1], [fx + 2.2, fz], [fx - 0.2, fz]];
  const exit = { x: foyer.x * CELL, z: (cy0 + 0.5) * CELL, L: 0 };
  // the one blueprint of the house lies on a small table just inside the front door (no rng: the first free spot)
  const blueprint = (() => {
    for (const [dx, dz] of [[2.1, -2.0], [2.1, 2.0], [2.1, -3.1], [2.1, 3.1], [3.3, -2.0], [3.3, 2.0]]) {
      const x = exit.x + dx, z = exit.z + dz;
      if (props.some((p) => p.L === 0 && Math.abs(p.x - x) < p.hw + 0.9 && Math.abs(p.z - z) < p.hd + 0.8)) continue;
      if (spawns.some(([sx, sz]) => edist(sx - x, sz - z) < 1.3)) continue;
      return { x, z, L: 0 };
    }
    return { x: exit.x + 2.1, z: exit.z - 2.0, L: 0 };
  })();

  return Object.assign(map, {
    talismans, batteries, bells, souls, monsterSpawn, doors, props, bulbs, writings, blood, spawns, exit, hides, notes, shrine, blueprint,
  });
}

// ---------- helpers ----------
// fingerprint of everything you interact with; server and browser compare it to catch a map that came out different
export function mapSignature(map) {
  const parts = [map.talismans, map.batteries, map.bells, map.souls, map.hides, map.notes, map.doors]
    .map((list) => list.map((o) => `${o.id ?? ''}:${Math.round((o.x ?? o.i) * 100)}:${Math.round((o.z ?? o.j) * 100)}:${o.L ?? 0}`).join('|'));
  let h = 0; const s = parts.join('#');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

export function cellType(map, L, i, j) {
  if (i < 0 || j < 0 || i >= map.W || j >= map.H || !map.grid[L]) return 0;
  return map.grid[L][j * map.W + i];
}
// walls for movement / sight: solid cells and the open stairwell holes on the floor above
export function isWall(map, L, i, j) { const t = cellType(map, L, i, j); return t === 0 || t === 4; }
export function cellOf(x) { return Math.floor(x / CELL); }

// height of the floor under (x, z) on level L (ramps up along staircases)
export function heightAt(map, L, x, z) {
  const base = L * FLOOR_H;
  const i = cellOf(x), j = cellOf(z);
  if (cellType(map, L, i, j) !== 3) return base;
  for (const s of map.stairs) {
    if (s.L !== L) continue;
    const [dx, dz] = s.d;
    const sx = (s.c1[0] + 0.5) * CELL - dx * CELL / 2, sz = (s.c1[1] + 0.5) * CELL - dz * CELL / 2;
    const along = ((x - sx) * dx + (z - sz) * dz) / (2 * CELL);
    const lat = Math.abs((x - sx) * dz - (z - sz) * dx);
    if (lat <= CELL / 2 + 0.01 && along >= -0.05 && along <= 1.05) return base + Math.max(0, Math.min(1, along)) * FLOOR_H;
  }
  return base;
}

// walking off the top of a staircase onto the floor above, or back down
export function stairTransition(map, L, x, z) {
  for (const s of map.stairs) {
    const [dx, dz] = s.d;
    const bx = (s.c2[0] + 0.5) * CELL + dx * CELL / 2, bz = (s.c2[1] + 0.5) * CELL + dz * CELL / 2;
    const along = (x - bx) * dx + (z - bz) * dz;
    const lat = Math.abs((x - bx) * dz - (z - bz) * dx);
    if (lat > CELL / 2) continue;
    if (L === s.L && along > -0.42 && along < 0.25) return [s.L + 1, x + dx * (0.45 - along), z + dz * (0.45 - along)];
    if (L === s.L + 1 && along < 0.37 && along > -0.25) return [s.L, x - dx * (0.55 + along), z - dz * (0.55 + along)];
  }
  return null;
}

function walkable(map, L, i, j) { const t = cellType(map, L, i, j); return t === 1 || t === 2 || t === 3; }
const lvlIdx = (L) => L + 1;

export function bfsDist3(map, L0, si, sj) {
  const { W, H } = map, N = W * H;
  const dist = new Int32Array(N * 3).fill(1e9);
  const q = new Int32Array(N * 3);
  let h = 0, t = 0;
  const start = lvlIdx(L0) * N + sj * W + si;
  dist[start] = 0; q[t++] = start;
  const links = stairLinks(map);
  while (h < t) {
    const k = q[h++], L = Math.floor(k / N) - 1, r = k % N, i = r % W, j = (r / W) | 0, nd = dist[k] + 1;
    for (const [dx, dz] of DIRS) {
      const ni = i + dx, nj = j + dz;
      if (!walkable(map, L, ni, nj)) continue;
      const nk = lvlIdx(L) * N + nj * W + ni;
      if (dist[nk] > nd) { dist[nk] = nd; q[t++] = nk; }
    }
    const lk = links.get(k);
    if (lk !== undefined && dist[lk] > nd) { dist[lk] = nd; q[t++] = lk; }
  }
  return dist;
}

function stairLinks(map) {
  if (map._links) return map._links;
  const { W, H } = map, N = W * H, m = new Map();
  for (const s of map.stairs) {
    const a = lvlIdx(s.L) * N + s.c2[1] * W + s.c2[0], b = lvlIdx(s.L + 1) * N + s.c3[1] * W + s.c3[0];
    m.set(a, b); m.set(b, a);
  }
  Object.defineProperty(map, '_links', { value: m, enumerable: false });
  return m;
}

// shortest path across floors; returns [[L, i, j], ...] (start excluded)
export function bfsPath3(map, L0, si, sj, L1, ti, tj) {
  if (!walkable(map, L0, si, sj) || !walkable(map, L1, ti, tj)) return null;
  const { W, H } = map, N = W * H;
  const prev = new Int32Array(N * 3).fill(-1);
  const q = new Int32Array(N * 3);
  let h = 0, t = 0;
  const s = lvlIdx(L0) * N + sj * W + si, goal = lvlIdx(L1) * N + tj * W + ti;
  const links = stairLinks(map);
  prev[s] = s; q[t++] = s;
  while (h < t) {
    const k = q[h++];
    if (k === goal) break;
    const L = Math.floor(k / N) - 1, r = k % N, i = r % W, j = (r / W) | 0;
    for (const [dx, dz] of DIRS) {
      const ni = i + dx, nj = j + dz;
      if (!walkable(map, L, ni, nj)) continue;
      const nk = lvlIdx(L) * N + nj * W + ni;
      if (prev[nk] === -1) { prev[nk] = k; q[t++] = nk; }
    }
    const lk = links.get(k);
    if (lk !== undefined && prev[lk] === -1) { prev[lk] = k; q[t++] = lk; }
  }
  if (prev[goal] === -1) return null;
  const out = [];
  for (let k = goal; k !== s; k = prev[k]) { const r = k % N; out.push([Math.floor(k / N) - 1, r % W, (r / W) | 0]); }
  out.reverse();
  return out;
}

export function lineOfSight(map, L, x0, z0, x1, z1) {
  const dx = x1 - x0, dz = z1 - z0;
  const d = edist(dx, dz);
  const steps = Math.ceil(d / 0.3);
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    if (isWall(map, L, Math.floor((x0 + dx * t) / CELL), Math.floor((z0 + dz * t) / CELL))) return false;
  }
  return true;
}

// push a circle out of walls on level L
export function resolveCircle(map, L, x, z, r) {
  for (let pass = 0; pass < 2; pass++) {
    const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL);
    for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) {
      if (!isWall(map, L, i, j)) continue;
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
  const l = x - minx, rr = maxx - x, t = z - minz, b = maxz - z;
  const m = Math.min(l, rr, t, b);
  if (m === l) return [minx - r, z];
  if (m === rr) return [maxx + r, z];
  if (m === t) return [x, minz - r];
  return [x, maxz + r];
}

// solid furniture, doorway pillars and shrine stones: [minx, minz, maxx, maxz, L].
// The client and the server both use this list, so nobody walks through a wardrobe.
export function staticColliders(map) {
  if (map._colliders) return map._colliders;
  const out = [];
  for (const d of map.doors) {
    const bx = (d.i + 0.5) * CELL + d.dx * CELL / 2, bz = (d.j + 0.5) * CELL + d.dz * CELL / 2;
    const alongX = d.dz !== 0, T = 0.34, PW = 0.75;
    for (const s of [-1, 1]) {
      const off = s * (CELL / 2 - PW / 2);
      const px = bx + (alongX ? off : 0), pz = bz + (alongX ? 0 : off);
      const hw = (alongX ? PW : T) / 2, hd = (alongX ? T : PW) / 2;
      out.push([px - hw, pz - hd, px + hw, pz + hd, d.L]);
    }
  }
  for (const p of map.props) if (p.type !== 'doll') out.push([p.x - p.hw, p.z - p.hd, p.x + p.hw, p.z + p.hd, p.L]);
  if (map.blueprint) { const b = map.blueprint; out.push([b.x - 0.38, b.z - 0.62, b.x + 0.38, b.z + 0.62, b.L]); } // its table
  const sh = map.shrine;
  if (sh) {
    for (const pt of sh.points) out.push([pt.x - 0.45, pt.z - 0.45, pt.x + 0.45, pt.z + 0.45, sh.L]);
    const room = map.rooms[sh.room], ax = sh.x, az = room.y * CELL + 0.75;
    out.push([ax - 1.45, az - 0.6, ax + 1.45, az + 0.6, sh.L]);
  }
  Object.defineProperty(map, '_colliders', { value: out, enumerable: false });
  return out;
}

// walls + furniture: push a circle of radius r clear of everything solid on level L
export function resolveSolid(map, L, x, z, r) {
  const cols = staticColliders(map);
  for (let pass = 0; pass < 2; pass++) {
    [x, z] = resolveCircle(map, L, x, z, r);
    for (const c of cols) {
      if (c[4] !== L || c[0] - x > r + 0.1 || x - c[2] > r + 0.1 || c[1] - z > r + 0.1 || z - c[3] > r + 0.1) continue;
      const p = pushOutBox(x, z, r, c[0], c[1], c[2], c[3]);
      if (p) { x = p[0]; z = p[1]; }
    }
  }
  return [x, z];
}
