// Things in the house that watch you.
//  - Ghost faces: screaming plaster faces with hollow black eyes and black tears, half sunk into the corridor walls
//    (public/models/ghost_face.glb, made in Blender from a CC0 Poly Haven bust: blender/build_statues.py)
//  - Stone Chudails: statues of her, cast in grey stone in the corners of rooms, hair parted, jaw hanging open
// Neither moves while you look at it. Look away and it turns to face you; look back and it is looking at you
// (a low stone grind when it has moved a lot). Positions come from the map seed, so everyone has the same ones;
// which way they face is per player (each one watches YOU).
import * as THREE from 'three';
import { CELL, LEVELS, mulberry32, lineOfSight } from '/shared/map.js';
import { createMonster, getModel } from './entities.js';

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function buildStatues({ map, world, seed, lite = false }) {
  // lite (Low quality / phones): far fewer of them; each stone Chudail is a whole copy of her model
  const N_ROOM = lite ? 1 : 2, N_HALL = lite ? 0 : 3, N_FACE = lite ? 2 : 5;
  const rng = mulberry32((seed ^ 0x5eed) >>> 0);
  const W = map.W, H = map.H;
  const typeAt = (L, i, j) => (i >= 0 && j >= 0 && i < W && j < H ? map.grid[L][j * W + i] : 0);
  const walk = (L, i, j) => { const t = typeAt(L, i, j); return t === 1 || t === 2 || t === 3; };
  const things = [...map.talismans, ...map.batteries, ...map.bells, ...(map.souls || []), ...map.notes, ...map.hides];
  const clearOf = (L, x, z, r) => !things.some((o) => (o.L ?? 0) === L && Math.hypot(o.x - x, o.z - z) < r) &&
    !map.props.some((p) => p.L === L && Math.abs(p.x - x) < p.hw + r * 0.6 && Math.abs(p.z - z) < p.hd + r * 0.6);
  const doorCells = new Set(map.doors.map((d) => `${d.L},${d.i},${d.j}`));
  const nearDoor = (L, i, j) => doorCells.has(`${L},${i},${j}`) || N4.some(([a, b]) => doorCells.has(`${L},${i + a},${j + b}`));
  const writ = new Set(map.writings.map((w) => `${w.L},${w.i},${w.j},${w.dx},${w.dz}`));
  const list = [];

  // ---- stone for her statues
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x4a4743, roughness: 1, metalness: 0 }); // dark enough not to blow out in the torch
  const voidMat = new THREE.MeshBasicMaterial({ color: 0x020202 });
  const hairStone = new THREE.MeshStandardMaterial({ color: 0x4a4740, roughness: 0.95, side: THREE.DoubleSide });

  // her, in stone: one grey material, no glow, no smoke, no ember eyes; frozen in a pose with her jaw hanging open
  function makeStone(pose) {
    const g = createMonster();
      // turn her to stone: one grey material, no glow, no smoke, no ember eyes
      g.traverse((o) => {
        if (o.isLight) o.intensity = 0;
        if (o.isSprite) o.visible = false;
        if (o.isMesh) {
          const m = o.material, blackish = m && m.color && m.color.r + m.color.g + m.color.b < 0.08; // the open mouth, the tears
          o.material = blackish ? voidMat : m && m.alphaTest ? hairStone : stoneMat; o.castShadow = true; o.receiveShadow = true;
        }
      });
      if (g.userData.glow) { g.remove(g.userData.glow); g.userData.glow = null; }
      g.userData.reveal = 1;
      g.userData.setCrawl?.(0, 1, 3, true);
      for (let k = 0; k < 30; k++) g.userData.update(1 / 30, pose === 'chase' ? 0.01 : 0, pose, 10 + k / 30);
      for (const e of g.userData.eyes || []) e.visible = false;
      if (g.userData.inst) { g.userData.inst.position.x = 0; g.userData.inst.position.z = 0; } // not caught mid-glitch
    return g;
  }

  // ---- stone Chudails in room corners, facing into the room
  for (const L of LEVELS) {
    const rooms = map.rooms.filter((r) => r.L === L && r.type !== 'shrine' && r.w >= 2 && r.h >= 2);
    let placed = 0;
    for (let tries = 0; tries < 60 && placed < N_ROOM && rooms.length; tries++) {
      const r = rooms[Math.floor(rng() * rooms.length)];
      if (list.some((s) => s.room === r.id)) continue;
      const ci = rng() < 0.5 ? r.x : r.x + r.w - 1, cj = rng() < 0.5 ? r.y : r.y + r.h - 1;
      if (!walk(L, ci, cj) || nearDoor(L, ci, cj)) continue;
      const wx = ci === r.x ? -1 : 1, wz = cj === r.y ? -1 : 1;
      const x = (ci + 0.5) * CELL + wx * (CELL / 2 - 0.75), z = (cj + 0.5) * CELL + wz * (CELL / 2 - 0.75);
      if (!clearOf(L, x, z, 1.4)) continue;
      const g = makeStone(rng() < 0.5 ? 'stare' : 'chase');
      g.position.set(x, 0, z);
      const toCentre = Math.atan2(-((r.x + r.w / 2) * CELL - x), -((r.y + r.h / 2) * CELL - z));
      g.rotation.y = toCentre;
      world.levelGroups[L].add(g);
      world.cull.push({ o: g, x, z });
      const col = [x - 0.4, z - 0.4, x + 0.4, z + 0.4, L]; world.colliders.push(col);
      list.push({ o: g, L, x, z, y: 1.9, base: toCentre, range: Math.PI, kind: 'statue', room: r.id, seen: toCentre, col });
      placed++;
    }
  }

  // ---- stone Chudails along the corridors, back to the wall, where the hall runs straight
  for (const L of LEVELS) {
    const cells = [];
    for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) {
      if (typeAt(L, i, j) !== 2 || nearDoor(L, i, j)) continue;
      const ns = walk(L, i, j - 1) && walk(L, i, j + 1), ew = walk(L, i - 1, j) && walk(L, i + 1, j);
      if (ns !== ew) cells.push([i, j, ns]);
    }
    let placed = 0;
    for (let tries = 0; tries < 500 && placed < N_HALL && cells.length; tries++) {
      const [i, j, ns] = cells[Math.floor(rng() * cells.length)];
      if (list.some((o) => o.L === L && Math.hypot(o.x / CELL - (i + 0.5), o.z / CELL - (j + 0.5)) < 6)) continue;
      const sides = (ns ? [[-1, 0], [1, 0]] : [[0, -1], [0, 1]]).filter(([a, b]) => typeAt(L, i + a, j + b) === 0 && !writ.has(`${L},${i},${j},${a},${b}`));
      if (!sides.length) continue;
      const [wx, wz] = sides[Math.floor(rng() * sides.length)];
      const x = (i + 0.5) * CELL + wx * (CELL / 2 - 0.5), z = (j + 0.5) * CELL + wz * (CELL / 2 - 0.5);
      if (!clearOf(L, x, z, 1.3)) continue;
      const g = makeStone(rng() < 0.6 ? 'stare' : 'chase');
      const base = Math.atan2(wx, wz); // her front (-z) looks out across the hall, away from the wall
      g.position.set(x, 0, z); g.rotation.y = base;
      world.levelGroups[L].add(g); world.cull.push({ o: g, x, z });
      const col = [x - 0.4, z - 0.4, x + 0.4, z + 0.4, L]; world.colliders.push(col);
      list.push({ o: g, L, x, z, y: 1.9, base, range: 1.3, kind: 'statue', seen: base, col });
      placed++;
    }
  }

  // ---- ghost faces in the corridor walls, at head height
  const face = getModel('ghost_face');
  if (face) {
    face.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; if (o.material && !/void/i.test(o.material.name)) { o.material = o.material.clone(); o.material.color.multiplyScalar(0.62); o.material.emissive = new THREE.Color(0x07080b); } } });
    for (const L of LEVELS) {
      const cells = [];
      for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) if (typeAt(L, i, j) === 2 && !nearDoor(L, i, j)) cells.push([i, j]);
      let placed = 0;
      for (let tries = 0; tries < 400 && placed < N_FACE && cells.length; tries++) {
        const [i, j] = cells[Math.floor(rng() * cells.length)];
        if (list.some((s) => s.L === L && s.kind === 'face' && Math.hypot(s.i - i, s.j - j) < 5)) continue;
        const walls = N4.filter(([a, b]) => typeAt(L, i + a, j + b) === 0 && !writ.has(`${L},${i},${j},${a},${b}`));
        if (!walls.length) continue;
        const [wx, wz] = walls[Math.floor(rng() * walls.length)];
        const x = (i + 0.5) * CELL + wx * (CELL / 2 + 0.02), z = (j + 0.5) * CELL + wz * (CELL / 2 + 0.02);
        const holder = new THREE.Group(); holder.position.set(x, 1.28, z);
        const base = Math.atan2(-wx, -wz); holder.rotation.y = base;
        const f = face.clone(true); f.scale.setScalar(1.3); f.position.set(0.1, 0, 0); holder.add(f);
        world.levelGroups[L].add(holder); world.cull.push({ o: holder, x, z });
        list.push({ o: holder, L, x, z, y: 1.55, i, j, base, range: 0.75, kind: 'face', seen: base });
        placed++;
      }
    }
  }

  // ---- watching
  const frustum = new THREE.Frustum(), pm = new THREE.Matrix4(), p = new THREE.Vector3();
  function update(dt, camera, camL, audio) {
    camera.updateMatrixWorld();
    pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(pm);
    const cx = camera.position.x, cz = camera.position.z;
    for (const s of list) {
      if (s.L !== camL) continue;
      const d = Math.hypot(s.x - cx, s.z - cz);
      if (d > 28) continue;
      p.set(s.x, s.L * 3 + s.y, s.z);
      const seen = frustum.containsPoint(p) && lineOfSight(map, s.L, cx, cz, s.x, s.z);
      let want = Math.atan2(-(cx - s.x), -(cz - s.z)); // statue front is -z (like her); faces look along +z
      if (s.kind === 'face') want = Math.atan2(cx - s.x, cz - s.z);
      let rel = want - s.base; while (rel > Math.PI) rel -= Math.PI * 2; while (rel < -Math.PI) rel += Math.PI * 2;
      rel = Math.max(-s.range, Math.min(s.range, rel));
      if (!seen) { // it moves only while nobody is looking
        let cur = s.o.rotation.y - s.base; while (cur > Math.PI) cur -= Math.PI * 2; while (cur < -Math.PI) cur += Math.PI * 2;
        s.o.rotation.y = s.base + cur + (rel - cur) * Math.min(1, dt * 2.5);
      } else if (!s.wasSeen) { // you look back: has it turned since you last saw it?
        const moved = Math.abs(s.o.rotation.y - s.seen);
        if (moved > 0.45 && d < 12 && audio && audio.ctx) grind(audio, s.x, s.z, Math.min(1, moved));
        s.seen = s.o.rotation.y;
      }
      s.wasSeen = seen;
    }
  }
  // a jump scare: the lights stutter and, when they come back, the nearest statue you can see is closer
  function creep(camera, camL, audio) {
    const cx = camera.position.x, cz = camera.position.z;
    let best = null, bd = 14;
    for (const s of list) {
      if (s.kind !== 'statue' || s.L !== camL) continue;
      const d = Math.hypot(s.x - cx, s.z - cz);
      if (d < 3.2 || d > bd || !lineOfSight(map, s.L, cx, cz, s.x, s.z)) continue;
      best = s; bd = d;
    }
    if (!best) return false;
    const step = Math.min(1.6, bd - 2.2), ux = (cx - best.x) / bd, uz = (cz - best.z) / bd;
    const nx = best.x + ux * step, nz = best.z + uz * step;
    const t = typeAt(best.L, Math.floor(nx / CELL), Math.floor(nz / CELL));
    if (!(t === 1 || t === 2) || !clearOf(best.L, nx, nz, 0.9)) return false;
    best.x = nx; best.z = nz; best.o.position.x = nx; best.o.position.z = nz;
    best.col[0] = nx - 0.4; best.col[1] = nz - 0.4; best.col[2] = nx + 0.4; best.col[3] = nz + 0.4;
    best.o.rotation.y = Math.atan2(-(cx - nx), -(cz - nz)); best.seen = best.o.rotation.y;
    if (audio && audio.ctx) grind(audio, nx, nz, 1);
    return true;
  }
  return { list, update, creep, counts: { statues: list.filter((s) => s.kind === 'statue').length, faces: list.filter((s) => s.kind === 'face').length } };
}

// stone dragged over stone, short and low, from where the thing is
function grind(audio, x, z, amt) {
  const ctx = audio.ctx, t = ctx.currentTime;
  const p = audio.panner(x, 1.5, z, 2.5);
  const n = audio.src(audio.white);
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 260; bp.Q.value = 1.2;
  const am = ctx.createGain(); am.gain.value = 0;
  for (let k = 0; k < 14; k++) am.gain.setValueAtTime(0.4 + Math.random() * 0.6, t + k * 0.035);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5 * amt + 0.15, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
  n.connect(bp); bp.connect(am); am.connect(g); g.connect(p); audio.out(p, 0.5);
  n.start(t, Math.random(), 0.6);
}
