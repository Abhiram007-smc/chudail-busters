// Builds the 3D level from the shared map data.
import * as THREE from 'three';
import { CELL, WALL_H, FLOOR_H, LEVELS, mulberry32 } from '/shared/map.js';
import * as TX from './textures.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Merge all static meshes of a group into one mesh per material (far fewer draw calls).
function mergeStatic(group, keep = []) {
  group.updateMatrixWorld(true);
  const inv = group.matrixWorld.clone().invert();
  const keepSet = new Set();
  for (const k of keep) if (k) k.traverse((o) => keepSet.add(o));
  const buckets = new Map(), victims = [];
  group.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh || keepSet.has(o)) return;
    const g = o.geometry.index ? o.geometry.clone() : null;
    if (!g) return;
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.uv || !g.attributes.normal) return;
    g.applyMatrix4(inv.clone().multiply(o.matrixWorld));
    const key = o.material;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(g); victims.push(o);
  });
  if (victims.length < 2) return;
  for (const o of victims) o.parent.remove(o);
  for (const [mat, list] of buckets) {
    const merged = mergeGeometries(list, false);
    if (!merged) continue;
    const me = new THREE.Mesh(merged, mat); me.castShadow = true; me.receiveShadow = true;
    group.add(me);
  }
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function quadBuilder() {
  const pos = [], nor = [], uv = [], idx = [];
  return {
    add(p0, p1, p2, p3, n, uvs) {
      const b = pos.length / 3;
      for (const p of [p0, p1, p2, p3]) pos.push(p[0], p[1], p[2]);
      for (let k = 0; k < 4; k++) nor.push(n[0], n[1], n[2]);
      for (const u of uvs) uv.push(u[0], u[1]);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    },
    build() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeBoundingSphere();
      return g;
    },
  };
}

function mat(canvas, opts = {}) {
  const map = TX.toTex(canvas);
  const bump = TX.toTex(canvas, { srgb: false });
  if (opts.repeat) { map.repeat.set(...opts.repeat); bump.repeat.set(...opts.repeat); }
  return new THREE.MeshStandardMaterial({ map, bumpMap: bump, bumpScale: opts.bump ?? 1.5, roughness: opts.rough ?? 0.92, metalness: opts.metal ?? 0, color: opts.color ?? 0xffffff });
}

export function buildWorld(scene, map) {
  const world = { colliders: [], lightSources: [], doors: [], talismans: new Map(), batteries: new Map(), bulbs: [], disposables: [], hides: new Map(), cull: [] };
  const cullable = (o, x, z) => world.cull.push({ o, x, z });
  const W = map.W, H = map.H;
  // one group per floor, raised to its height; everything on a floor goes in its group
  world.levelGroups = {};
  for (const L of LEVELS) { const g = new THREE.Group(); g.position.y = L * FLOOR_H; g.name = 'level' + L; scene.add(g); world.levelGroups[L] = g; }
  const lvl = (L) => world.levelGroups[L ?? 0];
  const rng = mulberry32(map.seed ^ 0xabcdef);

  // ---------- materials ----------
  const wallMats = [0, 1, 2].map((v) => mat(TX.wallCanvas(v), { bump: 2 }));
  const woodFloor = mat(TX.woodFloorCanvas(), { bump: 1.5, rough: 0.8 });
  const tileFloor = mat(TX.tileFloorCanvas(), { bump: 1.2, rough: 0.55 });
  const ceilMat = mat(TX.ceilingCanvas(), { bump: 2 });
  // each place has its own colours: the Haveli is warm red-ochre lime plaster and dark sheesham floors, the School
  // institutional green walls and pale floors (the textures stay, the colour multiplies them)
  const TINT = {
    haveli: { walls: [0xd9946a, 0xc98a5e, 0xe0a070], wood: 0x9a5a3a, tile: 0xc0a080, ceil: 0xc89a78 },
    school: { walls: [0xa8c8a8, 0xb8d0b8, 0x9cbca8], wood: 0xc8b49a, tile: 0xd8d8c8, ceil: 0xd0d8c8 },
    hotel: { walls: [0xc8a8b8, 0xb8a0c0, 0xd0b0a0], wood: 0x8a4a3a, tile: 0xd0c0a8, ceil: 0xd8c8b0 },     // faded rose wallpaper, red carpet-wood
    police: { walls: [0xb0b8c0, 0xa8b0a0, 0xc0c0b0], wood: 0x7a7a70, tile: 0xa8a8a0, ceil: 0xb8b8b0 },    // grey-blue government paint
  }[map.theme];
  if (TINT) {
    wallMats.forEach((m, k) => m.color.setHex(TINT.walls[k]));
    woodFloor.color.setHex(TINT.wood); tileFloor.color.setHex(TINT.tile); ceilMat.color.setHex(TINT.ceil);
  }
  const woodDark = mat(TX.plainWoodCanvas([52, 33, 20]), { rough: 0.8 });
  const woodPale = mat(TX.plainWoodCanvas([92, 70, 50]), { rough: 0.85 });
  const metal = mat(TX.rustCanvas(), { rough: 0.6, metal: 0.55 });
  const fabric = mat(TX.fabricCanvas(), { rough: 1 });
  const porcelain = new THREE.MeshStandardMaterial({ color: 0xbdb8a8, roughness: 0.35, map: TX.toTex(TX.fabricCanvas()) });
  world.mats = { woodDark, metal, fabric };

  // ---------- floors / ceilings / walls (per floor) ----------
  const addMesh = (geo, m, parent, shadow = true) => {
    const mesh = new THREE.Mesh(geo, m); mesh.receiveShadow = true; mesh.castShadow = shadow; parent.add(mesh); return mesh;
  };
  for (const L of LEVELS) {
    const g = map.grid[L];
    const ty = (i, j) => (i >= 0 && j >= 0 && i < W && j < H ? g[j * W + i] : 0);
    const fWood = quadBuilder(), fTile = quadBuilder(), ceil = quadBuilder();
    const walls = [quadBuilder(), quadBuilder(), quadBuilder()];
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const t = ty(i, j);
      if (!t) continue;
      const x0 = i * CELL, x1 = x0 + CELL, z0 = j * CELL, z1 = z0 + CELL;
      const u0 = (i % 2) / 2, u1 = u0 + 0.5, v0 = (j % 2) / 2, v1 = v0 + 0.5;
      // no floor over a stairwell hole (4) or under a ramp (3: the steps are the floor); no ceiling above a ramp
      if (t === 1 || t === 2) (t === 1 ? fWood : fTile).add([x0, 0, z1], [x1, 0, z1], [x1, 0, z0], [x0, 0, z0], [0, 1, 0], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
      if (t !== 3) ceil.add([x0, WALL_H, z0], [x1, WALL_H, z0], [x1, WALL_H, z1], [x0, WALL_H, z1], [0, -1, 0], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
      for (const [dx, dz] of DIRS) {
        if (ty(i + dx, j + dz) !== 0) continue;
        const n = [-dx, 0, -dz];
        const cx = (i + 0.5) * CELL + dx * CELL / 2, cz = (j + 0.5) * CELL + dz * CELL / 2;
        const rx = -dz, rz = dx;
        const p0 = [cx - rx * CELL / 2, 0, cz - rz * CELL / 2], p1 = [cx + rx * CELL / 2, 0, cz + rz * CELL / 2];
        const v = rng() < 0.12 ? 1 : rng() < 0.15 ? 2 : 0;
        walls[v].add(p0, p1, [p1[0], WALL_H, p1[2]], [p0[0], WALL_H, p0[2]], n, [[0, 0], [1, 0], [1, 1], [0, 1]]);
      }
    }
    addMesh(fWood.build(), woodFloor, lvl(L), true);
    addMesh(fTile.build(), tileFloor, lvl(L), true);
    addMesh(ceil.build(), ceilMat, lvl(L), false);
    walls.forEach((w, k) => addMesh(w.build(), wallMats[k], lvl(L)));
  }

  // ---------- staircases ----------
  for (const st of map.stairs) {
    const g = new THREE.Group(); lvl(st.L).add(g);
    const [dx, dz] = st.d, steps = 12, run = 2 * CELL / steps, rise = FLOOR_H / steps;
    const sx = (st.c1[0] + 0.5) * CELL - dx * CELL / 2, sz = (st.c1[1] + 0.5) * CELL - dz * CELL / 2;
    const along = (k) => [sx + dx * run * (k + 0.5), sz + dz * run * (k + 0.5)];
    for (let k = 0; k < steps; k++) {
      const [x, z] = along(k), h = rise * (k + 1);
      const m = new THREE.Mesh(new THREE.BoxGeometry(dx ? run : CELL - 0.02, h, dz ? run : CELL - 0.02), k % 2 ? woodDark : woodPale);
      m.position.set(x, h / 2, z); g.add(m);
    }
    for (const sd of [-1, 1]) { // handrails
      const px = dz * sd * (CELL / 2 - 0.12), pz = dx * sd * (CELL / 2 - 0.12);
      const len = Math.hypot(2 * CELL, FLOOR_H);
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, len, 6), metal);
      rail.position.set(sx + dx * CELL + px, FLOOR_H / 2 + 0.9, sz + dz * CELL + pz);
      rail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx * 2 * CELL, FLOOR_H, dz * 2 * CELL).normalize());
      g.add(rail);
    }
    mergeStatic(g);
  }

  // ---------- doorways (pillars, header, door leaves) ----------
  const doorLeafMat = woodPale;
  for (const d of map.doors) {
    const bx = (d.i + 0.5) * CELL + d.dx * CELL / 2, bz = (d.j + 0.5) * CELL + d.dz * CELL / 2;
    const alongX = d.dz !== 0; // edge runs along X when moving in Z
    const T = 0.34, PW = 0.75, HB = 2.45;
    const g = new THREE.Group(); lvl(d.L).add(g);
    for (const s of [-1, 1]) {
      const off = s * (CELL / 2 - PW / 2);
      const px = bx + (alongX ? off : 0), pz = bz + (alongX ? 0 : off);
      const box = new THREE.Mesh(new THREE.BoxGeometry(alongX ? PW : T, WALL_H, alongX ? T : PW), wallMats[0]);
      box.position.set(px, WALL_H / 2, pz); box.castShadow = box.receiveShadow = true; g.add(box);
      const hw = (alongX ? PW : T) / 2, hd = (alongX ? T : PW) / 2;
      world.colliders.push([px - hw, pz - hd, px + hw, pz + hd, d.L]);
      // trim
      const trim = new THREE.Mesh(new THREE.BoxGeometry(alongX ? 0.08 : T + 0.06, HB, alongX ? T + 0.06 : 0.08), woodDark);
      trim.position.set(bx + (alongX ? s * (CELL / 2 - PW) : 0), HB / 2, bz + (alongX ? 0 : s * (CELL / 2 - PW))); g.add(trim);
    }
    const header = new THREE.Mesh(new THREE.BoxGeometry(alongX ? CELL : T, WALL_H - HB, alongX ? T : CELL), wallMats[0]);
    header.position.set(bx, (WALL_H + HB) / 2, bz); header.castShadow = true; g.add(header);
    const htrim = new THREE.Mesh(new THREE.BoxGeometry(alongX ? CELL - PW * 2 + 0.1 : T + 0.06, 0.1, alongX ? T + 0.06 : CELL - PW * 2 + 0.1), woodDark);
    htrim.position.set(bx, HB, bz); g.add(htrim);

    if (d.leaf) {
      const gap = CELL - PW * 2;
      const pivot = new THREE.Group();
      // hinge on one side of the gap, swinging into the room
      const hs = d.swing;
      pivot.position.set(bx + (alongX ? hs * gap / 2 : 0) - d.dx * 0.05, 0, bz + (alongX ? 0 : hs * gap / 2) - d.dz * 0.05);
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(gap - 0.04, HB - 0.04, 0.06), doorLeafMat);
      leaf.castShadow = leaf.receiveShadow = true;
      leaf.position.set(-hs * (gap / 2), HB / 2, 0);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), metal);
      knob.position.set(-hs * (gap - 0.15), 1.05, 0.05); leaf.add(knob);
      pivot.add(leaf);
      // closed orientation: leaf lies along the edge
      const baseRot = alongX ? 0 : -Math.PI / 2;
      // open into the room (away from corridor): rotate ~100deg
      const openDir = (alongX ? -d.dz : d.dx) * hs;
      const open = baseRot + openDir * (1.6 + rng() * 0.9);
      pivot.rotation.y = open;
      g.add(pivot);
      world.doors.push({ pivot, base: baseRot, open, cur: open, slam: 0, x: bx, z: bz });
      mergeStatic(g, [pivot]);
    } else mergeStatic(g);
    cullable(g, bx, bz);
  }

  // ---------- props ----------
  const box = (w, h, d, m, x, y, z, parent) => {
    const me = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); me.position.set(x, y, z); me.castShadow = me.receiveShadow = true; parent.add(me); return me;
  };
  const cyl = (r, h, m, x, y, z, parent, rt = r) => {
    const me = new THREE.Mesh(new THREE.CylinderGeometry(rt, r, h, 10), m); me.position.set(x, y, z); me.castShadow = true; parent.add(me); return me;
  };
  const builders = {
    bed(g) {
      for (const [x, z] of [[-0.5, -0.95], [0.5, -0.95], [-0.5, 0.95], [0.5, 0.95]]) cyl(0.03, 0.5, metal, x, 0.25, z, g);
      box(1.05, 0.08, 1.95, metal, 0, 0.45, 0, g);
      const mt = box(0.95, 0.18, 1.85, fabric, 0, 0.58, 0.02, g); mt.rotation.z = (rng() - 0.5) * 0.06;
      box(1.05, 0.9, 0.05, metal, 0, 0.75, -0.97, g);
      for (let k = -2; k <= 2; k++) cyl(0.02, 0.5, metal, k * 0.18, 0.95, -0.97, g);
      if (rng() < 0.6) { const p = box(0.5, 0.12, 0.35, fabric, (rng() - 0.5) * 0.3, 0.73, -0.7, g); p.rotation.y = rng(); }
      if (rng() < 0.4) { // restraint straps
        for (const z of [-0.2, 0.5]) box(1.0, 0.02, 0.07, woodDark, 0, 0.68, z, g);
      }
    },
    cabinet(g) {
      box(1.0, 1.9, 0.5, woodDark, 0, 0.95, 0, g);
      for (let k = 0; k < 4; k++) { box(0.9, 0.02, 0.02, metal, 0, 0.3 + k * 0.45, 0.26, g); box(0.12, 0.03, 0.03, metal, 0, 0.45 + k * 0.45, 0.27, g); }
      if (rng() < 0.4) { const dr = box(0.9, 0.38, 0.45, woodDark, 0, 0.5, 0.3, g); dr.rotation.y = 0.1; }
    },
    wheelchair(g) {
      box(0.5, 0.06, 0.5, fabric, 0, 0.5, 0, g); box(0.5, 0.5, 0.05, fabric, 0, 0.8, -0.25, g);
      for (const s of [-1, 1]) {
        const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.025, 6, 20), metal); wheel.position.set(s * 0.3, 0.32, -0.05); wheel.rotation.y = Math.PI / 2; wheel.castShadow = true; g.add(wheel);
        cyl(0.015, 0.4, metal, s * 0.25, 0.7, 0.2, g);
      }
      g.rotation.y += (rng() - 0.5) * 0.8;
    },
    chair(g) {
      box(0.45, 0.05, 0.45, woodDark, 0, 0.45, 0, g);
      for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) box(0.04, 0.45, 0.04, woodDark, x, 0.22, z, g);
      box(0.45, 0.5, 0.04, woodDark, 0, 0.72, -0.21, g);
      if (rng() < 0.4) { g.rotation.z = Math.PI / 2; g.position.y = 0.22; }
      else g.rotation.y += (rng() - 0.5) * 1.2;
    },
    desk(g) {
      box(1.6, 0.06, 0.8, woodDark, 0, 0.78, 0, g);
      box(0.4, 0.75, 0.75, woodDark, -0.58, 0.375, 0, g); box(0.05, 0.75, 0.75, woodDark, 0.77, 0.375, 0, g);
      for (let k = 0; k < 3; k++) { const p = box(0.22, 0.01, 0.3, porcelain, (rng() - 0.3) * 0.8, 0.815, (rng() - 0.5) * 0.4, g); p.rotation.y = rng() * 3; }
      if (rng() < 0.5) { cyl(0.08, 0.04, metal, 0.4, 0.83, -0.2, g); cyl(0.015, 0.4, metal, 0.4, 1.0, -0.2, g); }
    },
    crates(g) {
      box(0.95, 0.8, 0.95, woodPale, 0, 0.4, 0, g);
      if (rng() < 0.7) { const t = box(0.7, 0.6, 0.7, woodPale, (rng() - 0.5) * 0.2, 1.1, (rng() - 0.5) * 0.2, g); t.rotation.y = rng(); }
    },
    shelf(g) {
      for (const x of [-0.8, 0.8]) box(0.05, 2.1, 0.45, metal, x, 1.05, 0, g);
      for (let k = 0; k < 4; k++) {
        box(1.65, 0.04, 0.45, metal, 0, 0.3 + k * 0.55, 0, g);
        for (let n = 0; n < 4; n++) if (rng() < 0.55) {
          const jar = cyl(0.07, 0.22, rng() < 0.5 ? porcelain : fabric, -0.6 + n * 0.4 + (rng() - 0.5) * 0.1, 0.43 + k * 0.55, 0, g);
          if (rng() < 0.2) { jar.rotation.z = Math.PI / 2; jar.position.y -= 0.04; }
        }
      }
    },
    tub(g) {
      box(1.75, 0.55, 0.85, porcelain, 0, 0.32, 0, g);
      const inner = new THREE.Mesh(new THREE.PlaneGeometry(1.55, 0.65), new THREE.MeshStandardMaterial({ color: 0x1a0402, roughness: 0.15, metalness: 0.2 }));
      inner.rotation.x = -Math.PI / 2; inner.position.set(0, 0.6, 0); g.add(inner);
      for (const x of [-0.75, 0.75]) for (const z of [-0.35, 0.35]) cyl(0.05, 0.1, metal, x, 0.05, z, g);
    },
    pew(g) {
      box(2.2, 0.06, 0.45, woodDark, 0, 0.45, 0.05, g);
      box(2.2, 0.55, 0.05, woodDark, 0, 0.75, -0.18, g);
      for (const x of [-1.05, 1.05]) box(0.06, 0.9, 0.55, woodDark, x, 0.45, 0, g);
    },
    bench(g) {
      box(1.9, 0.06, 0.4, woodDark, 0, 0.45, 0, g);
      for (const x of [-0.85, 0.85]) box(0.06, 0.45, 0.38, woodDark, x, 0.22, 0, g);
    },
    crib(g) {
      box(1.25, 0.05, 0.7, woodPale, 0, 0.4, 0, g);
      for (let k = 0; k <= 10; k++) for (const z of [-0.33, 0.33]) cyl(0.012, 0.6, woodPale, -0.6 + k * 0.12, 0.7, z, g);
      for (const z of [-0.33, 0.33]) box(1.25, 0.04, 0.04, woodPale, 0, 1.0, z, g);
      for (const x of [-0.62, 0.62]) box(0.05, 1.0, 0.7, woodPale, x, 0.5, 0, g);
      if (rng() < 0.6) builders.doll(new THREE.Group(), g, 0.45);
    },
    locker(g) {
      const lm = lockerMat;
      const T = 0.03, Wd = 0.92, Ht = 2.05, D = 0.58;
      box(Wd, Ht, T, lm, 0, Ht / 2, -D / 2 + T / 2, g);            // back
      box(T, Ht, D, lm, -Wd / 2 + T / 2, Ht / 2, 0, g);             // sides
      box(T, Ht, D, lm, Wd / 2 - T / 2, Ht / 2, 0, g);
      box(Wd, T, D, lm, 0, Ht - T / 2, 0, g);                      // top
      box(Wd, T, D, lm, 0, 0.06, 0, g);                            // floor
      const door = new THREE.Group(); door.position.set(-Wd / 2 + 0.02, 0, D / 2 - 0.015); g.add(door);
      const dw = Wd - 0.04;
      const panel = (y0, y1) => box(dw, y1 - y0, 0.025, lm, dw / 2, (y0 + y1) / 2, 0, door);
      panel(0.04, 1.42); panel(1.82, Ht - 0.02);
      for (let k = 0; k < 6; k++) { const y = 1.44 + k * 0.065; box(dw, 0.032, 0.025, lm, dw / 2, y + 0.016, 0, door); }
      box(0.03, 0.14, 0.04, metal, dw - 0.08, 1.05, 0.03, door);  // handle
      for (let k = 0; k < 3; k++) box(dw * 0.7, 0.012, 0.03, metal, dw / 2, 0.25 + k * 0.05, 0.005, door); // low vents
      return door;
    },
    wardrobe(g) {
      const wm = wardMat;
      const T = 0.04, Wd = 1.22, Ht = 2.1, D = 0.66;
      box(Wd, Ht, T, wm, 0, Ht / 2, -D / 2 + T / 2, g);
      box(T, Ht, D, wm, -Wd / 2 + T / 2, Ht / 2, 0, g);
      box(T, Ht, D, wm, Wd / 2 - T / 2, Ht / 2, 0, g);
      box(Wd + 0.08, 0.08, D + 0.06, wm, 0, Ht + 0.04, 0, g);
      box(Wd, 0.1, D, wm, 0, 0.05, 0, g);
      const door = new THREE.Group(); door.position.set(-Wd / 2 + 0.02, 0, D / 2 - 0.02); g.add(door);
      const dw = Wd - 0.04;
      const panel = (y0, y1) => box(dw, y1 - y0, 0.03, wm, dw / 2, (y0 + y1) / 2, 0, door);
      panel(0.1, 1.4); panel(1.86, Ht - 0.02);
      for (let k = 0; k < 7; k++) box(dw, 0.035, 0.03, wm, dw / 2, 1.43 + k * 0.062, 0, door);
      box(0.04, 0.04, 0.05, metal, dw - 0.1, 1.1, 0.03, door);
      box(0.02, Ht - 0.15, 0.035, woodDark, dw / 2, Ht / 2, 0.005, door);
      return door;
    },
    slab(g) {
      for (const [x, z] of [[-0.4, -0.9], [0.4, -0.9], [-0.4, 0.9], [0.4, 0.9]]) cyl(0.03, 0.8, metal, x, 0.4, z, g);
      box(0.95, 0.05, 2.0, metal, 0, 0.82, 0, g);
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 1.25, 6, 12), sheetMat);
      body.rotation.x = Math.PI / 2; body.scale.set(1, 1, 0.5); body.position.set(0, 0.95, 0.05); body.castShadow = true; g.add(body);
      const headB = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), sheetMat); headB.position.set(0, 0.97, -0.82); headB.scale.y = 0.8; g.add(headB);
      if (rng() < 0.6) { // a pale foot with a toe tag
        const foot = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.12, 4, 8), deadSkin); foot.rotation.x = Math.PI / 2; foot.position.set(0.1, 0.9, 0.98); g.add(foot);
        box(0.06, 0.09, 0.005, paperMat, 0.1, 0.84, 1.06, g);
      }
      if (rng() < 0.4) { // or a hand hanging off the side
        const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.45, 4, 8), deadSkin); arm.position.set(0.5, 0.65, 0.1); arm.rotation.z = 0.15; g.add(arm);
      }
    },
    drawers(g) {
      box(1.9, 2.0, 0.7, metal, 0, 1.0, 0, g);
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
        const x = -0.6 + c * 0.6, y = 0.4 + r * 0.6;
        const open = r === 0 && c === Math.floor(rng() * 3);
        const d = box(0.52, 0.5, 0.03, metal, x, y, 0.36 + (open ? 0.5 : 0), g);
        box(0.18, 0.03, 0.03, porcelain, x, y + 0.15, 0.39 + (open ? 0.5 : 0), g);
        if (open) {
          box(0.48, 0.08, 0.5, metal, x, y - 0.2, 0.12 + 0.25, g);
          const hand = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.35, 4, 8), deadSkin); hand.position.set(x + 0.1, y - 0.35, 0.6); hand.rotation.x = 0.3; g.add(hand);
        }
      }
    },
    optable(g) {
      cyl(0.12, 0.7, metal, 0, 0.35, 0, g);
      box(0.75, 0.08, 1.9, metal, 0, 0.75, 0, g);
      const sh = box(0.8, 0.02, 1.4, sheetMat, 0, 0.8, 0.2, g); sh.material = bloodSheet;
      box(0.06, 0.08, 1.8, metal, 0.42, 0.78, 0, g);
      // overhead surgical lamp
      cyl(0.02, 1.2, metal, 0.9, 2.4, -0.4, g);
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.28, 0.12, 20), metal); lamp.position.set(0.5, 2.2, -0.2); lamp.rotation.z = 0.4; g.add(lamp);
      box(0.4, 0.03, 0.3, metal, -0.65, 0.95, -0.6, g); // tray
      for (let k = 0; k < 4; k++) { const tl = box(0.015, 0.005, 0.18, metal, -0.75 + k * 0.06, 0.97, -0.6, g); tl.rotation.y = (rng() - 0.5) * 0.4; }
      cyl(0.015, 0.95, metal, -0.65, 0.48, -0.6, g);
    },
    doll(g, parent, y = 0) {
      const target = parent || g;
      const d = new THREE.Group(); d.position.set((rng() - 0.5) * 0.3, y, (rng() - 0.5) * 0.2);
      box(0.14, 0.18, 0.1, fabric, 0, 0.09, 0, d);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 10), porcelain); head.position.set(0, 0.25, 0); head.rotation.z = (rng() - 0.5) * 1.2; d.add(head);
      const eyeM = new THREE.MeshBasicMaterial({ color: 0x000000 });
      for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 4), eyeM); e.position.set(s * 0.03, 0.02, 0.07); head.add(e); }
      d.rotation.y = rng() * 6; target.add(d);
    },
  };
  const wardMat = woodDark.clone(); wardMat.side = THREE.DoubleSide;
  const sheetMat = new THREE.MeshStandardMaterial({ color: 0x9c988c, roughness: 1, map: TX.toTex(TX.fabricCanvas()) });
  const bloodSheet = new THREE.MeshStandardMaterial({ color: 0xa8a294, roughness: 1, map: TX.toTex(TX.fabricCanvas()) });
  const deadSkin = new THREE.MeshStandardMaterial({ color: 0x77716a, roughness: 0.75 });
  const paperMat = new THREE.MeshStandardMaterial({ color: 0xd8d2bc, roughness: 1 });
  const lockerMat = new THREE.MeshStandardMaterial({ map: TX.toTex(TX.rustCanvas()), color: 0x5d6a62, metalness: 0.55, roughness: 0.55, side: THREE.DoubleSide });
  let hideN = 0;
  for (const p of map.props) {
    const g = new THREE.Group();
    g.position.set(p.x, 0, p.z); g.rotation.y = p.rot;
    const ret = builders[p.type](g);
    mergeStatic(g, ret ? [ret] : []);
    cullable(g, p.x, p.z);
    if (p.type === 'locker' || p.type === 'wardrobe' || p.type === 'bed') { const h = map.hides[hideN]; world.hides.set(h.id, { ...h, door: ret || g.add(new THREE.Group()).children[g.children.length - 1], open: 0, target: 0, busy: 0 }); hideN++; }
    lvl(p.L).add(g);
    if (p.type !== 'doll') world.colliders.push([p.x - p.hw, p.z - p.hd, p.x + p.hw, p.z + p.hd, p.L]);
  }

  // ---------- bulbs ----------
  const glowTex = TX.toTex(TX.glowCanvas(), { repeat: false });
  world.glowTex = glowTex;
  const cordMat = new THREE.MeshBasicMaterial({ color: 0x050505 });
  for (const b of map.bulbs) {
    const len = 0.4 + rng() * 0.5;
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, len, 4), cordMat);
    cord.position.set(b.x, WALL_H - len / 2, b.z); lvl(b.L).add(cord);
    const color = b.warm ? 0xffb066 : 0xd8e8ff;
    const bulbMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: color, emissiveIntensity: 2 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), bulbMat);
    bulb.position.set(b.x, WALL_H - len - 0.05, b.z); lvl(b.L).add(bulb);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.16, 14, 1, true), new THREE.MeshStandardMaterial({ color: 0x2a2a26, metalness: 0.6, roughness: 0.5, side: THREE.DoubleSide }));
    shade.position.set(b.x, WALL_H - len + 0.03, b.z); lvl(b.L).add(shade);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
    spr.scale.setScalar(0.9); spr.position.copy(bulb.position); lvl(b.L).add(spr);
    const src = {
      x: b.x, y: WALL_H - len - 0.15 + b.L * FLOOR_H, z: b.z, L: b.L, color: new THREE.Color(color), base: 8, dist: 13, flicker: b.flicker, dead: false,
      phase: rng() * 100, mesh: bulbMat, sprite: spr, kind: 'bulb', level: 1,
    };
    world.bulbs.push(src); world.lightSources.push(src);
  }

  // ---------- decals ----------
  const decalMat = (c) => new THREE.MeshStandardMaterial({ map: TX.toTex(c, { repeat: false }), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 0.4 });
  const bloodMats = [0, 1, 2, 3].map(() => decalMat(TX.bloodCanvas()));
  for (const b of map.blood) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(b.s, b.s), bloodMats[b.seed % 4]);
    m.rotation.x = -Math.PI / 2; m.rotation.z = b.r; m.position.set(b.x, 0.012, b.z); m.receiveShadow = true; lvl(b.L).add(m); cullable(m, b.x, b.z);
  }
  world.bloodMats = bloodMats;
  const sigilMats = new Map();
  const writingMats = new Map();
  for (const w of map.writings) {
    let m;
    if (w.sigil) { // her sign: small, low, easy to walk past
      if (!sigilMats.has(w.sigil)) sigilMats.set(w.sigil, decalMat(TX.sigilCanvas(w.sigil, 'wall')));
      const sz = 0.42 + (w.seed % 7) * 0.03;
      m = new THREE.Mesh(new THREE.PlaneGeometry(sz, sz), sigilMats.get(w.sigil));
    } else { // one texture per phrase (the same few phrases repeat all over the house: a phone runs out of memory otherwise)
      if (!writingMats.has(w.text)) writingMats.set(w.text, decalMat(TX.writingCanvas(w.text)));
      m = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.975), writingMats.get(w.text));
    }
    const along = w.sigil ? (((w.seed >> 3) % 100) / 100 - 0.5) * 1.6 : 0; // slide along the wall
    const cx = (w.i + 0.5) * CELL + w.dx * (CELL / 2 - 0.015) + (w.dz ? along : 0), cz = (w.j + 0.5) * CELL + w.dz * (CELL / 2 - 0.015) + (w.dx ? along : 0);
    m.position.set(cx, w.sigil ? 0.55 + ((w.seed % 100) / 100) * 0.9 : 1.55 + ((w.seed % 100) / 100 - 0.5) * 0.4, cz);
    if (w.sigil) m.rotation.z = ((w.seed % 13) / 13 - 0.5) * 0.5;
    m.rotation.y = Math.atan2(-w.dx, -w.dz);
    m.receiveShadow = true; lvl(w.L).add(m); cullable(m, cx, cz);
  }

  // ---------- room signs above doorways ----------
  const signTex = new Map();
  for (const d of map.doors) {
    const label = map.rooms[d.room].label;
    if (!signTex.has(label)) signTex.set(label, TX.toTex(TX.signCanvas(label), { repeat: false }));
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.31), new THREE.MeshStandardMaterial({ map: signTex.get(label), roughness: 0.55, metalness: 0.2 }));
    const bx = (d.i + 0.5) * CELL + d.dx * CELL / 2, bz = (d.j + 0.5) * CELL + d.dz * CELL / 2;
    sign.position.set(bx + d.dx * 0.18, 2.72, bz + d.dz * 0.18);
    sign.rotation.y = Math.atan2(d.dx, d.dz);
    sign.rotation.z = (rng() - 0.5) * 0.08;
    sign.receiveShadow = true; lvl(d.L).add(sign); cullable(sign, bx, bz);
  }

  // ---------- direction signs at corridor junctions: the way to the stairs, the shrine and the way out ----------
  {
    const W = map.W, Hh = map.H, walk = (L, i, j) => { const t = (i >= 0 && j >= 0 && i < W && j < Hh) ? map.grid[L][j * W + i] : 0; return t === 1 || t === 2 || t === 3; };
    const solid = (L, i, j) => !(i >= 0 && j >= 0 && i < W && j < Hh) || map.grid[L][j * W + i] === 0;
    const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const field = (L, starts) => { // BFS distance (in cells) to the nearest start cell on this floor
      const d = new Int32Array(W * Hh).fill(-1), q = [];
      for (const [i, j] of starts) if (walk(L, i, j) && d[j * W + i] < 0) { d[j * W + i] = 0; q.push(i, j); }
      for (let h = 0; h < q.length; h += 2) { const i = q[h], j = q[h + 1]; for (const [a, b] of N4) { const ni = i + a, nj = j + b; if (walk(L, ni, nj) && d[nj * W + ni] < 0) { d[nj * W + ni] = d[j * W + i] + 1; q.push(ni, nj); } } }
      return d;
    };
    const cellAt = (x, z) => [Math.floor(x / CELL), Math.floor(z / CELL)];
    const near = (L, x, z) => { const [i, j] = cellAt(x, z); for (const [a, b] of [[0, 0], ...N4]) if (walk(L, i + a, j + b)) return [[i + a, j + b]]; return []; };
    const texCache = new Map();
    const dirTex = (lines) => {
      const key = lines.join('|'); if (texCache.has(key)) return texCache.get(key);
      const c = TX.canvas(512, 64 + lines.length * 72), g = c.getContext('2d');
      g.fillStyle = '#1b2b26'; g.fillRect(0, 0, c.width, c.height);
      g.strokeStyle = '#cfc8ad'; g.lineWidth = 5; g.strokeRect(9, 9, c.width - 18, c.height - 18);
      g.fillStyle = '#e2dabd'; g.font = '50px "IM Fell English SC", "Courier Prime", serif'; g.textBaseline = 'middle';
      lines.forEach((ln, k) => { const y = 66 + k * 72; const left = ln.startsWith('←'); g.textAlign = left ? 'left' : 'right'; g.fillText(ln, left ? 34 : c.width - 34, y); });
      for (let k = 0; k < 16; k++) { g.fillStyle = Math.random() < 0.5 ? 'rgba(20,14,8,0.8)' : 'rgba(110,55,20,0.5)'; g.beginPath(); g.arc(Math.random() * c.width, Math.random() * c.height, 2 + Math.random() * 7, 0, 7); g.fill(); }
      const t = TX.toTex(c, { repeat: false }); texCache.set(key, t); return t;
    };
    for (const L of LEVELS) {
      if (!map.grid[L]) continue;
      const dests = [];
      const stairs = []; for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) if (map.grid[L][j * W + i] === 3) stairs.push([i, j]);
      if (!stairs.length) { // top floor: the stairs arrive through an opening in the floor; aim for the landing beside it
        for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) if (map.grid[L][j * W + i] === 4) for (const [a, b] of N4) if (walk(L, i + a, j + b)) stairs.push([i + a, j + b]);
      }
      if (stairs.length) dests.push({ label: 'STAIRS', d: field(L, stairs) });
      if (map.shrine && map.shrine.L === L) dests.push({ label: 'SHRINE', d: field(L, near(L, map.shrine.x, map.shrine.z)) });
      if (map.exit && (map.exit.L ?? 0) === L) dests.push({ label: 'EXIT', d: field(L, near(L, map.exit.x + CELL * 0.5, map.exit.z)) });
      if (!dests.length) continue;
      const placed = [];
      for (let j = 1; j < Hh - 1; j++) for (let i = 1; i < W - 1; i++) {
        if (map.grid[L][j * W + i] !== 2 || placed.length >= 14) continue;
        const open = N4.filter(([a, b]) => walk(L, i + a, j + b)).length;
        if (open < 3 || placed.some(([a, b]) => Math.max(Math.abs(a - i), Math.abs(b - j)) < 4)) continue;
        // the best wall: the one whose sign can point along the most destinations
        let best = null;
        for (const [wx, wz] of N4) {
          if (!solid(L, i + wx, j + wz)) continue;
          const lines = [];
          for (const ds of dests) {
            const here = ds.d[j * W + i]; if (here <= 1) continue;
            let step = null; for (const [a, b] of N4) { const v = walk(L, i + a, j + b) ? ds.d[(j + b) * W + i + a] : -1; if (v >= 0 && v < here && (!step || v < step[2])) step = [a, b, v]; }
            if (!step) continue;
            const side = step[0] * -wz + step[1] * wx; // + = to the right of someone facing this wall
            if (Math.abs(side) > 0.5) lines.push(side > 0 ? `${ds.label}  →` : `←  ${ds.label}`);
          }
          if (lines.length && (!best || lines.length > best.lines.length)) best = { wx, wz, lines };
        }
        if (!best) continue;
        placed.push([i, j]);
        const hgt = 0.14 + best.lines.length * 0.16;
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.05, hgt), new THREE.MeshStandardMaterial({ map: dirTex(best.lines), roughness: 0.55, metalness: 0.15 }));
        const x = (i + 0.5) * CELL + best.wx * (CELL / 2 - 0.03), z = (j + 0.5) * CELL + best.wz * (CELL / 2 - 0.03);
        sign.position.set(x, 1.85, z); sign.rotation.y = Math.atan2(-best.wx, -best.wz); sign.rotation.z = (rng() - 0.5) * 0.05;
        lvl(L).add(sign); cullable(sign, x, z);
      }
      world.dirSigns = (world.dirSigns || 0) + placed.length;
    }
  }

  // ---------- notes ----------
  world.notes = new Map();
  const noteTex = TX.toTex(TX.paperCanvas(), { repeat: false });
  for (const n of map.notes) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.32), new THREE.MeshStandardMaterial({ map: noteTex, roughness: 0.95, emissive: 0x2a2620, emissiveIntensity: 0.6 }));
    m.rotation.x = -Math.PI / 2; m.rotation.z = n.rot; m.position.set(n.x, 0.016, n.z); m.receiveShadow = true; lvl(n.L).add(m); cullable(m, n.x, n.z);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xfff0c8, transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending }));
    spr.scale.setScalar(0.7); spr.position.set(n.x, 0.06, n.z); lvl(n.L).add(spr);
    world.notes.set(n.id, { ...n, mesh: m, sprite: spr, read: false });
  }

  // ---------- ritual items (skull, black candle, cracked mirror, cursed doll, braid of hair) ----------
  const boneMat = new THREE.MeshStandardMaterial({ color: 0xb3a582, roughness: 0.7, emissive: 0x1a0c04, emissiveIntensity: 0.25 });
  const twineMat = new THREE.MeshStandardMaterial({ color: 0x5a1010, roughness: 1, side: THREE.DoubleSide });
  const waxMat = new THREE.MeshStandardMaterial({ color: 0xe8e0c8, roughness: 0.6 });
  const blackWax = new THREE.MeshStandardMaterial({ color: 0x0b0a0a, roughness: 0.4 });
  const mirrorMat = new THREE.MeshStandardMaterial({ color: 0x9fb0b8, metalness: 1, roughness: 0.06 });
  const hairMat = new THREE.MeshStandardMaterial({ color: 0x0a0807, roughness: 0.55 });
  const voidMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const flameSprite = (color = 0xff9a40, sx = 0.12, sy = 0.2) => { const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); f.scale.set(sx, sy, 1); return f; };
  function makeItem(kind) {
    const g = new THREE.Group();
    if (kind === 'skull') {
      const sk = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), boneMat); sk.scale.set(1, 1.1, 1.15); sk.position.y = 0.15; g.add(sk);
      const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.05, 0.11), boneMat); jaw.position.set(0, 0.04, 0.05); g.add(jaw);
      for (const sx of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), voidMat); e.scale.set(1, 1.2, 0.5); e.position.set(sx * 0.05, 0.17, 0.125); g.add(e); }
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.04, 3), voidMat); nose.rotation.x = Math.PI; nose.position.set(0, 0.11, 0.14); g.add(nose);
    } else if (kind === 'candle') {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.42, 12), blackWax); c.position.y = 0.21; g.add(c);
      const drip = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.015, 6, 12), blackWax); drip.rotation.x = Math.PI / 2; drip.position.y = 0.4; g.add(drip);
      const f = flameSprite(0xff3a1a, 0.12, 0.24); f.position.y = 0.5; g.add(f); g.userData.flame = f;
    } else if (kind === 'mirror') {
      const fr = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.025, 8, 24), woodDark); fr.scale.y = 1.35; fr.position.y = 0.26; g.add(fr);
      const glass = new THREE.Mesh(new THREE.CircleGeometry(0.16, 24), mirrorMat); glass.scale.y = 1.35; glass.position.set(0, 0.26, 0.004); g.add(glass);
      const crack = new THREE.Mesh(new THREE.PlaneGeometry(0.008, 0.36), voidMat); crack.rotation.z = 0.5; crack.position.set(0.02, 0.27, 0.01); g.add(crack);
      const crack2 = new THREE.Mesh(new THREE.PlaneGeometry(0.006, 0.2), voidMat); crack2.rotation.z = -0.9; crack2.position.set(-0.04, 0.3, 0.011); g.add(crack2);
      g.rotation.x = -0.25;
    } else if (kind === 'doll') {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.1), fabric); body.position.y = 0.13; g.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 10), porcelain); head.position.y = 0.32; head.rotation.z = 0.6; g.add(head);
      for (const sx of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.016, 6, 4), voidMat); e.position.set(sx * 0.032, 0.33, 0.08); g.add(e); }
      for (let k = 0; k < 5; k++) { const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.14, 4), metal); pin.position.set((rng() - 0.5) * 0.14, 0.14 + rng() * 0.2, 0.06); pin.rotation.set(1.2 + rng(), rng(), rng()); g.add(pin); }
      for (const sx of [-1, 1]) { const a = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, 0.04), fabric); a.position.set(sx * 0.11, 0.14, 0); a.rotation.z = sx * 0.4; g.add(a); }
    } else { // braid of her hair
      const pts = []; for (let k = 0; k <= 24; k++) pts.push(new THREE.Vector3(Math.sin(k * 0.9) * 0.05, 0.02 + k * 0.022, Math.cos(k * 0.9) * 0.03));
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.028, 6), hairMat); tube.rotation.z = 1.35; tube.position.set(0.25, 0.04, 0); g.add(tube);
      const tie = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.012, 6, 10), twineMat); tie.position.set(-0.17, 0.05, 0); tie.rotation.y = Math.PI / 2; g.add(tie);
    }
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return g;
  }
  world.makeItem = makeItem;
  for (const t of map.talismans) {
    const g = new THREE.Group(); g.position.set(t.x, 0, t.z); lvl(t.L).add(g);
    // an old stool with two candles, the item sitting on it
    const stool = new THREE.Group(); g.add(stool);
    box(0.6, 0.05, 0.6, woodDark, 0, 0.55, 0, stool);
    for (const [x, z] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) box(0.04, 0.55, 0.04, woodDark, x, 0.275, z, stool);
    const flames = [];
    for (const k of [0, 1]) {
      const x = k ? 0.22 : -0.22, h = 0.12 + rng() * 0.1;
      cyl(0.025, h, waxMat, x, 0.58 + h / 2, -0.18, stool);
      if (k) continue; // one candle has burned out; the other gutters, barely
      const f = flameSprite(); f.position.set(x, 0.58 + h + 0.04, -0.18); stool.add(f); flames.push(f);
    }
    const item = makeItem(t.kind); item.position.y = 0.58; g.add(item);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff6a30, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.scale.setScalar(0.5); halo.position.y = 0.8; g.add(halo);
    // a faint candle glow you only notice once you are in the room
    const src = { x: t.x, y: 0.9 + t.L * FLOOR_H, z: t.z, L: t.L, color: new THREE.Color(0xff8a3a), base: 0.9, dist: 3.2, flicker: false, candle: true, dead: false, phase: rng() * 100, kind: 'candle', level: 1 };
    world.lightSources.push(src);
    world.talismans.set(t.id, {
      group: g, item, stool, flames, halo, src, x: t.x, z: t.z, L: t.L, kind: t.kind, name: t.name, taken: false,
      // dropped by a dead player: lies on the floor wherever they fell
      moveTo(x, z, L) { this.x = x; this.z = z; this.L = L; lvl(L).add(this.group); this.group.position.set(x, 0, z); this.stool.visible = false; this.item.position.y = 0.02; this.src.dead = true; },
    });
  }

  // ---------- batteries ----------
  const batMat = new THREE.MeshStandardMaterial({ color: 0x202428, metalness: 0.6, roughness: 0.4 });
  const batBand = new THREE.MeshStandardMaterial({ color: 0x103010, emissive: 0x40ff60, emissiveIntensity: 1.2 });
  for (const b of map.batteries) {
    const g = new THREE.Group(); g.position.set(b.x, 0.06, b.z); g.rotation.set(0, rng() * 6, Math.PI / 2); lvl(b.L).add(g);
    cyl(0.05, 0.22, batMat, 0, 0, 0, g); cyl(0.052, 0.05, batBand, 0, 0.06, 0, g); cyl(0.02, 0.03, metal, 0, 0.12, 0, g);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x50ff70, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
    spr.scale.setScalar(0.6); spr.position.set(b.x, 0.1, b.z); lvl(b.L).add(spr);
    world.batteries.set(b.id, { group: g, sprite: spr, x: b.x, z: b.z, L: b.L, taken: false });
  }

  // ---------- spirit bells ----------
  world.bells = new Map();
  const brass = new THREE.MeshStandardMaterial({ color: 0xb08a3a, metalness: 0.85, roughness: 0.35, emissive: 0x2a1a04, emissiveIntensity: 0.6 });
  const bellProfile = [[0.0, 0], [0.11, 0.0], [0.105, 0.02], [0.08, 0.06], [0.065, 0.12], [0.06, 0.16], [0.04, 0.19], [0.0, 0.2]].map(([r, y]) => new THREE.Vector2(r, y));
  for (const b of map.bells) {
    const g = new THREE.Group(); g.position.set(b.x, 0, b.z); g.rotation.y = rng() * 6; lvl(b.L).add(g);
    const bellM = new THREE.Mesh(new THREE.LatheGeometry(bellProfile, 16), brass); bellM.castShadow = true; g.add(bellM);
    cyl(0.012, 0.16, woodDark, 0, 0.28, 0, g);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), woodDark); knob.position.y = 0.37; g.add(knob);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffd27a, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
    spr.scale.setScalar(0.8); spr.position.set(b.x, 0.18, b.z); lvl(b.L).add(spr);
    world.bells.set(b.id, { group: g, sprite: spr, x: b.x, z: b.z, L: b.L, taken: false });
  }

  // ---------- soul candles (revive a friend) ----------
  world.souls = new Map();
  const soulWax = new THREE.MeshStandardMaterial({ color: 0xcfd8e0, roughness: 0.5, emissive: 0x203040, emissiveIntensity: 0.6 });
  for (const c of map.souls) {
    const g = new THREE.Group(); g.position.set(c.x, 0, c.z); lvl(c.L).add(g);
    cyl(0.06, 0.08, metal, 0, 0.04, 0, g);
    cyl(0.045, 0.32, soulWax, 0, 0.24, 0, g);
    const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x7fd0ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    f.scale.set(0.14, 0.26, 1); f.position.y = 0.48; g.add(f);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x6ab8ff, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
    spr.scale.setScalar(1.1); spr.position.set(c.x, 0.45, c.z); lvl(c.L).add(spr);
    world.souls.set(c.id, { group: g, flame: f, sprite: spr, x: c.x, z: c.z, L: c.L, taken: false });
  }

  // ---------- THE SHRINE: a black-magic pentagram in the basement ----------
  {
    const sh = map.shrine, room = map.rooms[sh.room];
    const g = new THREE.Group(); lvl(sh.L).add(g);
    const stone = new THREE.MeshStandardMaterial({ color: 0x2c2826, roughness: 0.95, map: TX.toTex(TX.rustCanvas()) });
    const starTex = TX.toTex(TX.pentagramCanvas(), { repeat: false });
    const starMat = new THREE.MeshStandardMaterial({ map: starTex, emissiveMap: starTex, emissive: 0xff1a08, emissiveIntensity: 0.6, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 0.6 });
    const star = new THREE.Mesh(new THREE.PlaneGeometry(sh.r * 2 + 3, sh.r * 2 + 3), starMat);
    star.rotation.x = -Math.PI / 2; star.position.set(sh.x, 0.02, sh.z); g.add(star);
    // centre pit ringed with bones
    const pit = new THREE.Mesh(new THREE.CircleGeometry(sh.center, 32), new THREE.MeshBasicMaterial({ color: 0x050000 }));
    pit.rotation.x = -Math.PI / 2; pit.position.set(sh.x, 0.025, sh.z); g.add(pit);
    for (let k = 0; k < 22; k++) {
      const a = (k / 22) * Math.PI * 2;
      const b = cyl(0.025, 0.35, boneMat, sh.x + Math.cos(a) * (sh.center + 0.1), 0.04, sh.z + Math.sin(a) * (sh.center + 0.1), g);
      b.rotation.set(Math.PI / 2, 0, a + rng());
    }
    // pillar of red light that wakes up when the star is complete
    const columnMat = new THREE.MeshBasicMaterial({ color: 0xff1a0a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    const column = new THREE.Mesh(new THREE.CylinderGeometry(sh.center, sh.center * 1.15, WALL_H, 32, 1, true), columnMat);
    column.position.set(sh.x, WALL_H / 2, sh.z); g.add(column);
    // five plinths, one per star point
    const slots = sh.points.map((pt, k) => {
      const pg = new THREE.Group(); pg.position.set(pt.x, 0, pt.z); g.add(pg);
      box(0.75, 0.9, 0.75, stone, 0, 0.45, 0, pg);
      box(0.9, 0.08, 0.9, stone, 0, 0.92, 0, pg);
      const ember = flameSprite(0xff2a0a, 0.5, 0.5); ember.position.y = 1.0; ember.material.opacity = 0.25; pg.add(ember);
      for (const sx of [-1, 1]) { const h = 0.2 + rng() * 0.2; cyl(0.03, h, blackWax, sx * 0.3, 0.96 + h / 2, 0.3, pg); const f = flameSprite(0xff3a1a); f.position.set(sx * 0.3, 0.96 + h + 0.05, 0.3); pg.add(f); }
      world.colliders.push([pt.x - 0.45, pt.z - 0.45, pt.x + 0.45, pt.z + 0.45, sh.L]);
      return { pg, ember, item: null };
    });
    // a ring of black candles around the star
    const ring = [];
    for (let k = 0; k < 15; k++) {
      const a = (k / 15) * Math.PI * 2, r = sh.r + 1.0, h = 0.25 + rng() * 0.35;
      const x = sh.x + Math.cos(a) * r, z = sh.z + Math.sin(a) * r;
      cyl(0.04, h, blackWax, x, h / 2, z, g);
      const f = flameSprite(0xff4a1a, 0.13, 0.24); f.position.set(x, h + 0.08, z); g.add(f); ring.push(f);
    }
    // goat-skull altar against the north wall
    const ax = sh.x, az = room.y * CELL + 0.75;
    box(2.6, 1.0, 1.0, stone, ax, 0.5, az, g);
    box(2.9, 0.1, 1.2, stone, ax, 1.03, az, g);
    const goat = new THREE.Group(); goat.position.set(ax, 1.35, az + 0.1); g.add(goat);
    const gs = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), boneMat); gs.scale.set(0.8, 1, 1.5); gs.rotation.x = 0.5; goat.add(gs);
    for (const sx of [-1, 1]) {
      const pts = []; for (let k = 0; k <= 12; k++) pts.push(new THREE.Vector3(sx * (0.12 + k * 0.03), 0.12 + Math.sin(k * 0.3) * 0.25, -k * 0.035));
      goat.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.035 - 0.0, 6), new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.6 })));
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), voidMat); eye.position.set(sx * 0.08, 0.05, 0.2); goat.add(eye);
    }
    for (let k = 0; k < 7; k++) { const x = ax - 1.2 + k * 0.4, h = 0.2 + rng() * 0.4; cyl(0.035, h, k % 2 ? blackWax : waxMat, x, 1.08 + h / 2, az + 0.35, g); const f = flameSprite(0xff5a1a); f.position.set(x, 1.08 + h + 0.06, az + 0.35); g.add(f); ring.push(f); }
    world.colliders.push([ax - 1.45, az - 0.6, ax + 1.45, az + 0.6, sh.L]);
    // piles of skulls in the corners, sack-covered bodies hanging from the ceiling, chains
    const corners = [[room.x, room.y + room.h - 1], [room.x + room.w - 1, room.y + room.h - 1], [room.x + room.w - 1, room.y], [room.x, room.y]];
    corners.forEach(([i, j], k) => {
      const cx = (i + 0.5) * CELL, cz = (j + 0.5) * CELL;
      if (k < 3) for (let n = 0; n < 9; n++) { const sk = makeItem('skull'); sk.scale.setScalar(0.9 + rng() * 0.4); sk.position.set(cx + (rng() - 0.5) * 1.2, (n > 5 ? 0.2 : 0), cz + (rng() - 0.5) * 1.2); sk.rotation.y = rng() * 6; g.add(sk); }
    });
    const sackMat = new THREE.MeshStandardMaterial({ color: 0x3a3226, roughness: 1, map: TX.toTex(TX.fabricCanvas()) });
    const ropeMat = new THREE.MeshStandardMaterial({ color: 0x4a3a22, roughness: 1 });
    const hanging = [];
    for (let k = 0; k < 4; k++) {
      const a = k * 1.57 + 0.78, r = sh.r + 2.3;
      const x = sh.x + Math.cos(a) * r, z = sh.z + Math.sin(a) * r;
      const piv = new THREE.Group(); piv.position.set(x, WALL_H, z); g.add(piv);
      const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.9, 5), ropeMat); rope.position.y = -0.45; piv.add(rope);
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.9, 6, 10), sackMat); body.position.y = -1.45; body.scale.z = 0.8; piv.add(body);
      const feet = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.18, 4, 6), new THREE.MeshStandardMaterial({ color: 0x6a645a, roughness: 0.8 })); feet.position.y = -2.1; piv.add(feet);
      hanging.push(piv);
    }
    for (let k = 0; k < 10; k++) {
      const x = sh.x + (rng() - 0.5) * room.w * CELL * 0.8, z = sh.z + (rng() - 0.5) * room.h * CELL * 0.8, len = 0.6 + rng() * 1.4;
      for (let n = 0; n < len / 0.09; n++) { const l = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.009, 4, 8), metal); l.position.set(x, WALL_H - n * 0.08, z); l.rotation.y = n % 2 ? Math.PI / 2 : 0; g.add(l); }
    }
    // nailed dolls + writing on the walls
    for (let k = 0; k < 6; k++) {
      const side = k % 4, t = 0.2 + rng() * 0.6;
      const x = side < 2 ? room.x * CELL + t * room.w * CELL : side === 2 ? room.x * CELL + 0.12 : (room.x + room.w) * CELL - 0.12;
      const z = side === 0 ? room.y * CELL + 0.12 : side === 1 ? (room.y + room.h) * CELL - 0.12 : room.y * CELL + t * room.h * CELL;
      if (side === 0 && Math.abs(x - ax) < 1.8) continue;
      const d = makeItem('doll'); d.position.set(x, 1.3 + rng() * 0.6, z); d.rotation.z = Math.PI + (rng() - 0.5); g.add(d);
    }
    for (const [text, wx, wz, ry] of [['BRING HER TO THE STAR', sh.x, (room.y + room.h) * CELL - 0.02, Math.PI], ['FIVE GIFTS', room.x * CELL + 0.02, sh.z, Math.PI / 2], ['SHE CANNOT LEAVE THE CIRCLE', (room.x + room.w) * CELL - 0.02, sh.z, -Math.PI / 2]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 1.6), decalMat(TX.writingCanvas(text)));
      m.position.set(wx, 1.9, wz); m.rotation.y = ry; g.add(m);
    }
    for (let k = 0; k < 6; k++) { const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bloodMats[k % 4]); m.rotation.x = -Math.PI / 2; m.rotation.z = rng() * 6; m.position.set(sh.x + (rng() - 0.5) * 9, 0.015, sh.z + (rng() - 0.5) * 9); g.add(m); }
    const src = { x: sh.x, y: 2.2 + sh.L * FLOOR_H, z: sh.z, L: sh.L, color: new THREE.Color(0xff1a08), base: 6, dist: 14, flicker: false, candle: true, dead: false, phase: 3, kind: 'shrine', level: 1 };
    world.lightSources.push(src);
    world.shrine = {
      ...sh, slots, star, starMat, column, columnMat, ring, hanging, src, active: false, boundT: 0, flash: 0,
      setPlaced(slot, kind) {
        const s = slots[slot]; if (!s || s.item) return;
        s.item = makeItem(kind); s.item.position.y = 0.97; s.pg.add(s.item);
        s.ember.material.opacity = 0.9; s.ember.scale.set(0.9, 1.4, 1);
        this.src.base += 2;
      },
      setActive() { this.active = true; this.src.base = 16; this.src.dist = 18; },
      bind() { this.boundT = 0.001; this.flash = 1; this.src.color.set(0xffffff); this.src.base = 40; },
    };
  }

  // ---------- exit door ----------
  const ex = map.exit;
  const exitG = new THREE.Group(); exitG.position.set(ex.x + 0.02, 0, ex.z); lvl(0).add(exitG);
  const sig = TX.sigilCanvases(0, 5, false);
  const sigBase = TX.toTex(sig.base, { repeat: false }), sigEm = TX.toTex(sig.em, { repeat: false });
  const doorMat = new THREE.MeshStandardMaterial({ map: sigBase, emissiveMap: sigEm, emissive: 0xffffff, emissiveIntensity: 1.6, metalness: 0.5, roughness: 0.6 });
  const leaves = [];
  for (const s of [-1, 1]) {
    const piv = new THREE.Group(); piv.position.set(0, 0, s * 1.1); exitG.add(piv);
    const geo = new THREE.BoxGeometry(0.12, 2.6, 1.1);
    // UVs: map each leaf to half of the sigil (+x face is index 0)
    const uv = geo.attributes.uv;
    for (let k = 0; k < uv.count; k++) { const u = uv.getX(k); uv.setX(k, s < 0 ? 0.5 + u * 0.5 : u * 0.5); }
    const leaf = new THREE.Mesh(geo, doorMat); leaf.position.set(0.06, 1.3, -s * 0.55); leaf.castShadow = true; piv.add(leaf);
    leaves.push({ piv, s });
  }
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.25, 2.6), woodDark); frame.position.set(0.1, 2.72, 0); exitG.add(frame);
  // bright "outside" behind the door
  const outside = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.6), new THREE.MeshBasicMaterial({ color: 0xdfe8ff, fog: false }));
  outside.position.set(-0.01, 1.3, 0); outside.rotation.y = Math.PI / 2; outside.visible = false; exitG.add(outside);
  const exitSrc = { x: ex.x + 0.8, y: 1.6, z: ex.z, L: 0, color: new THREE.Color(0xff2a10), base: 2.5, dist: 7, flicker: false, dead: false, phase: 0, kind: 'exit', level: 1 };
  world.lightSources.push(exitSrc);
  world.exit = {
    leaves, outside, src: exitSrc, mat: doorMat, opened: false, openT: 0,
    setProgress(n, open) {
      const s = TX.sigilCanvases(n, 5, open);
      sigBase.image = s.base; sigEm.image = s.em; sigBase.needsUpdate = true; sigEm.needsUpdate = true;
      exitSrc.base = 2.5 + n * 1.2;
      if (open && !this.opened) { this.opened = true; outside.visible = true; exitSrc.color.set(0xdfe8ff); exitSrc.base = 14; exitSrc.dist = 14; }
    },
  };

  world.updateCull = (cx, cz, r = 26) => {
    const r2 = r * r;
    for (const c of world.cull) { const dx = c.x - cx, dz = c.z - cz; c.o.visible = dx * dx + dz * dz < r2; }
  };
  world.update = (dt, t) => {
    for (const tl of world.talismans.values()) {
      if (tl.taken) continue;
      tl.item.rotation.y += dt * 0.4;
      tl.flames.forEach((f, k) => { const q = Math.random() < 0.04 ? 0.15 : 0.75 + Math.sin(t * 13 + k * 3) * 0.12 + Math.random() * 0.1; f.scale.set(0.07 * q, 0.12 * q, 1); });
      if (tl.item.userData.flame) tl.item.userData.flame.scale.set(0.12, 0.22 + Math.random() * 0.05, 1);
    }
    {
      const S = world.shrine;
      S.ring.forEach((f, k) => { const q = 0.85 + Math.sin(t * 11 + k) * 0.12 + Math.random() * 0.08; f.scale.set(0.13 * q, 0.24 * q, 1); });
      S.hanging.forEach((h, k) => { h.rotation.z = Math.sin(t * 0.6 + k) * 0.06; h.rotation.y += dt * 0.05 * (k % 2 ? 1 : -1); });
      const placed = S.slots.filter((s) => s.item).length;
      S.starMat.emissiveIntensity = (S.active ? 2.6 + Math.sin(t * 6) * 0.8 : 0.5 + placed * 0.3 + Math.sin(t * 2) * 0.15) * (S.boundT ? 2 : 1);
      S.src.level = S.active ? 0.85 + Math.random() * 0.3 : 0.7 + Math.sin(t * 3) * 0.15;
      S.columnMat.opacity += ((S.active ? 0.16 + Math.sin(t * 9) * 0.05 : 0) + S.flash * 0.6 - S.columnMat.opacity) * Math.min(1, dt * 3);
      S.slots.forEach((s) => { if (s.item) s.item.rotation.y += dt * 0.6; });
      if (S.boundT) { S.boundT += dt; S.flash = Math.max(0, S.flash - dt * 0.4); }
    }
    for (const c of world.souls.values()) if (!c.taken) { const q = 0.85 + Math.sin(t * 9 + c.x) * 0.1 + Math.random() * 0.08; c.flame.scale.set(0.14 * q, 0.26 * q, 1); c.sprite.material.opacity = 0.3 + Math.sin(t * 2 + c.z) * 0.08; }
    for (const b of world.bells.values()) if (!b.taken) { b.sprite.material.opacity = 0.25 + Math.sin(t * 2.5 + b.x) * 0.12; b.group.rotation.z = Math.sin(t * 1.7 + b.z) * 0.04; }
    for (const b of world.batteries.values()) if (!b.taken) b.sprite.material.opacity = 0.25 + Math.sin(t * 3 + b.x) * 0.12;
    for (const h of world.hides.values()) {
      if (h.busy > 0) { h.busy -= dt; h.target = h.busy > 0.35 ? 1.25 : 0; } else h.target = 0;
      h.open += (h.target - h.open) * Math.min(1, dt * (h.target ? 9 : 6));
      h.door.rotation.y = -h.open;
    }
    for (const d of world.doors) {
      if (d.slam > 0) { d.slam -= dt; const target = d.base + (d.open - d.base) * 0.12; d.cur += (target - d.cur) * Math.min(1, dt * 25); }
      else d.cur += (d.open - d.cur) * Math.min(1, dt * 0.4);
      d.pivot.rotation.y = d.cur;
    }
    if (world.exit.opened && world.exit.openT < 1) {
      world.exit.openT = Math.min(1, world.exit.openT + dt * 0.35);
      const e = world.exit.openT * world.exit.openT * (3 - 2 * world.exit.openT);
      for (const l of world.exit.leaves) l.piv.rotation.y = -l.s * e * 1.6;
    }
  };
  return world;
}

export function disposeScene(scene) {
  scene.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of ms) { for (const k of ['map', 'bumpMap', 'emissiveMap', 'alphaMap']) if (m[k]) m[k].dispose(); m.dispose(); }
    }
  });
}
