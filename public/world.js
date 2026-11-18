// Builds the 3D level from the shared map data.
import * as THREE from 'three';
import { CELL, WALL_H, mulberry32 } from '/shared/map.js';
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
  const floorAt = (i, j) => i >= 0 && j >= 0 && i < W && j < H && map.grid[j * W + i] !== 0;
  const rng = mulberry32(map.seed ^ 0xabcdef);

  // ---------- materials ----------
  const wallMats = [0, 1, 2].map((v) => mat(TX.wallCanvas(v), { bump: 2 }));
  const woodFloor = mat(TX.woodFloorCanvas(), { bump: 1.5, rough: 0.8 });
  const tileFloor = mat(TX.tileFloorCanvas(), { bump: 1.2, rough: 0.55 });
  const ceilMat = mat(TX.ceilingCanvas(), { bump: 2 });
  const woodDark = mat(TX.plainWoodCanvas([52, 33, 20]), { rough: 0.8 });
  const woodPale = mat(TX.plainWoodCanvas([92, 70, 50]), { rough: 0.85 });
  const metal = mat(TX.rustCanvas(), { rough: 0.6, metal: 0.55 });
  const fabric = mat(TX.fabricCanvas(), { rough: 1 });
  const porcelain = new THREE.MeshStandardMaterial({ color: 0xbdb8a8, roughness: 0.35, map: TX.toTex(TX.fabricCanvas()) });
  world.mats = { woodDark, metal, fabric };

  // ---------- floors / ceilings / walls ----------
  const fWood = quadBuilder(), fTile = quadBuilder(), ceil = quadBuilder();
  const walls = [quadBuilder(), quadBuilder(), quadBuilder()];
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (!floorAt(i, j)) continue;
    const x0 = i * CELL, x1 = x0 + CELL, z0 = j * CELL, z1 = z0 + CELL;
    const isRoom = map.grid[j * W + i] === 1;
    const u0 = (i % 2) / 2, u1 = u0 + 0.5, v0 = (j % 2) / 2, v1 = v0 + 0.5;
    (isRoom ? fWood : fTile).add([x0, 0, z1], [x1, 0, z1], [x1, 0, z0], [x0, 0, z0], [0, 1, 0], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
    ceil.add([x0, WALL_H, z0], [x1, WALL_H, z0], [x1, WALL_H, z1], [x0, WALL_H, z1], [0, -1, 0], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
    for (const [dx, dz] of DIRS) {
      if (floorAt(i + dx, j + dz)) continue;
      const n = [-dx, 0, -dz];
      const cx = (i + 0.5) * CELL + dx * CELL / 2, cz = (j + 0.5) * CELL + dz * CELL / 2;
      // right vector = (-n) x up = (dx,0,dz) x (0,1,0) = (-dz, 0, dx)
      const rx = -dz, rz = dx;
      const p0 = [cx - rx * CELL / 2, 0, cz - rz * CELL / 2], p1 = [cx + rx * CELL / 2, 0, cz + rz * CELL / 2];
      const v = rng() < 0.12 ? 1 : rng() < 0.15 ? 2 : 0;
      walls[v].add(p0, p1, [p1[0], WALL_H, p1[2]], [p0[0], WALL_H, p0[2]], n, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    }
  }
  const addMesh = (geo, m, shadow = true) => {
    const mesh = new THREE.Mesh(geo, m); mesh.receiveShadow = true; mesh.castShadow = shadow; scene.add(mesh); return mesh;
  };
  addMesh(fWood.build(), woodFloor, false);
  addMesh(fTile.build(), tileFloor, false);
  addMesh(ceil.build(), ceilMat, false);
  walls.forEach((w, k) => addMesh(w.build(), wallMats[k]));

  // ---------- doorways (pillars, header, door leaves) ----------
  const doorLeafMat = woodPale;
  for (const d of map.doors) {
    const bx = (d.i + 0.5) * CELL + d.dx * CELL / 2, bz = (d.j + 0.5) * CELL + d.dz * CELL / 2;
    const alongX = d.dz !== 0; // edge runs along X when moving in Z
    const T = 0.34, PW = 0.75, HB = 2.45;
    const g = new THREE.Group(); scene.add(g);
    for (const s of [-1, 1]) {
      const off = s * (CELL / 2 - PW / 2);
      const px = bx + (alongX ? off : 0), pz = bz + (alongX ? 0 : off);
      const box = new THREE.Mesh(new THREE.BoxGeometry(alongX ? PW : T, WALL_H, alongX ? T : PW), wallMats[0]);
      box.position.set(px, WALL_H / 2, pz); box.castShadow = box.receiveShadow = true; g.add(box);
      const hw = (alongX ? PW : T) / 2, hd = (alongX ? T : PW) / 2;
      world.colliders.push([px - hw, pz - hd, px + hw, pz + hd]);
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
    scene.add(g);
    if (p.type !== 'doll') world.colliders.push([p.x - p.hw, p.z - p.hd, p.x + p.hw, p.z + p.hd]);
  }

  // ---------- bulbs ----------
  const glowTex = TX.toTex(TX.glowCanvas(), { repeat: false });
  world.glowTex = glowTex;
  const cordMat = new THREE.MeshBasicMaterial({ color: 0x050505 });
  for (const b of map.bulbs) {
    const len = 0.4 + rng() * 0.5;
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, len, 4), cordMat);
    cord.position.set(b.x, WALL_H - len / 2, b.z); scene.add(cord);
    const color = b.warm ? 0xffb066 : 0xd8e8ff;
    const bulbMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: color, emissiveIntensity: 2 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), bulbMat);
    bulb.position.set(b.x, WALL_H - len - 0.05, b.z); scene.add(bulb);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.16, 14, 1, true), new THREE.MeshStandardMaterial({ color: 0x2a2a26, metalness: 0.6, roughness: 0.5, side: THREE.DoubleSide }));
    shade.position.set(b.x, WALL_H - len + 0.03, b.z); scene.add(shade);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
    spr.scale.setScalar(0.9); spr.position.copy(bulb.position); scene.add(spr);
    const src = {
      x: b.x, y: WALL_H - len - 0.15, z: b.z, color: new THREE.Color(color), base: 8, dist: 13, flicker: b.flicker, dead: false,
      phase: rng() * 100, mesh: bulbMat, sprite: spr, kind: 'bulb', level: 1,
    };
    world.bulbs.push(src); world.lightSources.push(src);
  }

  // ---------- decals ----------
  const decalMat = (c) => new THREE.MeshStandardMaterial({ map: TX.toTex(c, { repeat: false }), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 0.4 });
  const bloodMats = [0, 1, 2, 3].map(() => decalMat(TX.bloodCanvas()));
  for (const b of map.blood) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(b.s, b.s), bloodMats[b.seed % 4]);
    m.rotation.x = -Math.PI / 2; m.rotation.z = b.r; m.position.set(b.x, 0.012, b.z); m.receiveShadow = true; scene.add(m); cullable(m, b.x, b.z);
  }
  world.bloodMats = bloodMats;
  for (const w of map.writings) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.975), decalMat(TX.writingCanvas(w.text)));
    const cx = (w.i + 0.5) * CELL + w.dx * (CELL / 2 - 0.015), cz = (w.j + 0.5) * CELL + w.dz * (CELL / 2 - 0.015);
    m.position.set(cx, 1.55 + ((w.seed % 100) / 100 - 0.5) * 0.4, cz);
    m.rotation.y = Math.atan2(-w.dx, -w.dz);
    m.receiveShadow = true; scene.add(m); cullable(m, cx, cz);
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
    sign.receiveShadow = true; scene.add(sign); cullable(sign, bx, bz);
  }

  // ---------- notes ----------
  world.notes = new Map();
  const noteTex = TX.toTex(TX.paperCanvas(), { repeat: false });
  for (const n of map.notes) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.32), new THREE.MeshStandardMaterial({ map: noteTex, roughness: 0.95, emissive: 0x2a2620, emissiveIntensity: 0.6 }));
    m.rotation.x = -Math.PI / 2; m.rotation.z = n.rot; m.position.set(n.x, 0.016, n.z); m.receiveShadow = true; scene.add(m); cullable(m, n.x, n.z);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xfff0c8, transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending }));
    spr.scale.setScalar(0.7); spr.position.set(n.x, 0.06, n.z); scene.add(spr);
    world.notes.set(n.id, { ...n, mesh: m, sprite: spr, read: false });
  }

  // ---------- talismans ----------
  const boneMat = new THREE.MeshStandardMaterial({ color: 0xa89a78, roughness: 0.75, emissive: 0x1a0c04, emissiveIntensity: 0.25 });
  const twineMat = new THREE.MeshStandardMaterial({ color: 0x5a1010, roughness: 1 });
  const waxMat = new THREE.MeshStandardMaterial({ color: 0xe8e0c8, roughness: 0.6 });
  for (const t of map.talismans) {
    const g = new THREE.Group(); g.position.set(t.x, 0, t.z); scene.add(g);
    // small table
    box(0.9, 0.05, 0.9, woodDark, 0, 0.75, 0, g);
    for (const [x, z] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]]) box(0.05, 0.75, 0.05, woodDark, x, 0.375, z, g);
    // effigy: bound bones + skull
    const eff = new THREE.Group(); eff.position.y = 0.78; g.add(eff);
    const s1 = cyl(0.025, 0.7, boneMat, 0, 0.35, 0, eff); s1.rotation.z = 0.1;
    const s2 = cyl(0.02, 0.45, boneMat, 0, 0.45, 0, eff); s2.rotation.z = Math.PI / 2 - 0.15;
    for (const a of [0.6, -0.6]) { const l = cyl(0.018, 0.35, boneMat, a * 0.12, 0.12, 0, eff); l.rotation.z = a; }
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), boneMat); skull.scale.set(1, 1.15, 1); skull.position.y = 0.72; eff.add(skull);
    const em = new THREE.MeshBasicMaterial({ color: 0x000000 });
    for (const sx of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 6), em); e.scale.set(1, 1.2, 0.5); e.position.set(sx * 0.034, 0.735, 0.08); eff.add(e); }
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.04, 0.07), boneMat); jaw.position.set(0, 0.63, 0.03); eff.add(jaw);
    for (let k = 0; k < 5; k++) { const rag = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.18 + Math.random() * 0.12), twineMat); rag.material.side = THREE.DoubleSide; rag.position.set(-0.2 + k * 0.1, 0.33, 0.02); rag.rotation.z = (Math.random() - 0.5) * 0.4; eff.add(rag); }
    box(0.08, 0.06, 0.08, twineMat, 0, 0.45, 0, eff);
    // candles
    const flames = [];
    for (let k = 0; k < 3; k++) {
      const a = k * 2.1 + 0.4, x = Math.cos(a) * 0.3, z = Math.sin(a) * 0.3, h = 0.1 + rng() * 0.15;
      cyl(0.03, h, waxMat, x, 0.78 + h / 2, z, g);
      const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff9a40, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      f.scale.set(0.12, 0.2, 1); f.position.set(x, 0.78 + h + 0.06, z); g.add(f); flames.push(f);
    }
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff7a30, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.scale.setScalar(1.6); halo.position.y = 1.0; g.add(halo);
    const src = { x: t.x, y: 1.3, z: t.z, color: new THREE.Color(0xff8a3a), base: 4, dist: 8, flicker: false, candle: true, dead: false, phase: rng() * 100, kind: 'candle', level: 1 };
    world.lightSources.push(src);
    world.talismans.set(t.id, { group: g, eff, flames, halo, src, x: t.x, z: t.z, taken: false });
  }

  // ---------- batteries ----------
  const batMat = new THREE.MeshStandardMaterial({ color: 0x202428, metalness: 0.6, roughness: 0.4 });
  const batBand = new THREE.MeshStandardMaterial({ color: 0x103010, emissive: 0x40ff60, emissiveIntensity: 1.2 });
  for (const b of map.batteries) {
    const g = new THREE.Group(); g.position.set(b.x, 0.06, b.z); g.rotation.set(0, rng() * 6, Math.PI / 2); scene.add(g);
    cyl(0.05, 0.22, batMat, 0, 0, 0, g); cyl(0.052, 0.05, batBand, 0, 0.06, 0, g); cyl(0.02, 0.03, metal, 0, 0.12, 0, g);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x50ff70, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
    spr.scale.setScalar(0.6); spr.position.set(b.x, 0.1, b.z); scene.add(spr);
    world.batteries.set(b.id, { group: g, sprite: spr, x: b.x, z: b.z, taken: false });
  }

  // ---------- spirit bells ----------
  world.bells = new Map();
  const brass = new THREE.MeshStandardMaterial({ color: 0xb08a3a, metalness: 0.85, roughness: 0.35, emissive: 0x2a1a04, emissiveIntensity: 0.6 });
  const bellProfile = [[0.0, 0], [0.11, 0.0], [0.105, 0.02], [0.08, 0.06], [0.065, 0.12], [0.06, 0.16], [0.04, 0.19], [0.0, 0.2]].map(([r, y]) => new THREE.Vector2(r, y));
  for (const b of map.bells) {
    const g = new THREE.Group(); g.position.set(b.x, 0, b.z); g.rotation.y = rng() * 6; scene.add(g);
    const bellM = new THREE.Mesh(new THREE.LatheGeometry(bellProfile, 16), brass); bellM.castShadow = true; g.add(bellM);
    cyl(0.012, 0.16, woodDark, 0, 0.28, 0, g);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), woodDark); knob.position.y = 0.37; g.add(knob);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffd27a, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
    spr.scale.setScalar(0.8); spr.position.set(b.x, 0.18, b.z); scene.add(spr);
    world.bells.set(b.id, { group: g, sprite: spr, x: b.x, z: b.z, taken: false });
  }

  // ---------- soul candles (revive a friend) ----------
  world.souls = new Map();
  const soulWax = new THREE.MeshStandardMaterial({ color: 0xcfd8e0, roughness: 0.5, emissive: 0x203040, emissiveIntensity: 0.6 });
  for (const c of map.souls) {
    const g = new THREE.Group(); g.position.set(c.x, 0, c.z); scene.add(g);
    cyl(0.06, 0.08, metal, 0, 0.04, 0, g);
    cyl(0.045, 0.32, soulWax, 0, 0.24, 0, g);
    const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x7fd0ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    f.scale.set(0.14, 0.26, 1); f.position.y = 0.48; g.add(f);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x6ab8ff, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
    spr.scale.setScalar(1.1); spr.position.set(c.x, 0.45, c.z); scene.add(spr);
    world.souls.set(c.id, { group: g, flame: f, sprite: spr, x: c.x, z: c.z, taken: false });
  }

  // ---------- ROOM 41: her heart ----------
  {
    const h = map.heart;
    const g = new THREE.Group(); g.position.set(h.x, 0, h.z); scene.add(g);
    const stone = new THREE.MeshStandardMaterial({ color: 0x3a3632, roughness: 0.95, map: TX.toTex(TX.rustCanvas()) });
    box(1.5, 0.8, 0.9, stone, 0, 0.4, 0, g);
    box(1.7, 0.08, 1.05, stone, 0, 0.82, 0, g);
    const circle = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), new THREE.MeshStandardMaterial({ map: TX.toTex(TX.ritualCanvas(), { repeat: false }), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, emissive: 0x550000, emissiveMap: TX.toTex(TX.ritualCanvas(), { repeat: false }), emissiveIntensity: 0.5 }));
    circle.rotation.x = -Math.PI / 2; circle.position.y = 0.015; g.add(circle);
    const heartMat = new THREE.MeshStandardMaterial({ color: 0x6a0c0c, roughness: 0.3, emissive: 0x500000, emissiveIntensity: 1 });
    const heart = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 18), heartMat);
    heart.scale.set(1, 1.25, 0.9); heart.position.y = 1.08; heart.rotation.z = 0.35; heart.castShadow = true; g.add(heart);
    const pos = heart.geometry.attributes.position;
    for (let k = 0; k < pos.count; k++) { const n = 1 + (Math.sin(pos.getX(k) * 40) * Math.sin(pos.getY(k) * 33)) * 0.06; pos.setXYZ(k, pos.getX(k) * n, pos.getY(k) * n, pos.getZ(k) * n); }
    heart.geometry.computeVertexNormals();
    const vein = new THREE.MeshStandardMaterial({ color: 0x2a0404, roughness: 0.4 });
    for (let k = 0; k < 5; k++) { const v = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.012, 6, 20, 2 + rng()), vein); v.rotation.set(rng() * 3, rng() * 3, rng() * 3); heart.add(v); }
    for (let k = 0; k < 3; k++) { const a = cyl(0.03, 0.25, vein, (k - 1) * 0.06, 0.25, 0, heart); a.rotation.z = (k - 1) * 0.4; }
    const flames = [];
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2, x = Math.cos(a) * 1.35, z = Math.sin(a) * 1.35;
      cyl(0.035, 0.25, waxMat, x, 0.125, z, g);
      const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff6a2a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      f.scale.set(0.12, 0.22, 1); f.position.set(x, 0.33, z); g.add(f); flames.push(f);
    }
    const fire = [];
    for (let k = 0; k < 10; k++) {
      const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: k % 2 ? 0xff7a20 : 0xffc040, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9 }));
      f.visible = false; f.position.set((rng() - 0.5) * 0.4, 1.0 + rng() * 0.4, (rng() - 0.5) * 0.3); g.add(f); fire.push(f);
    }
    const src = { x: h.x, y: 1.6, z: h.z, color: new THREE.Color(0xff1a10), base: 3, dist: 8, flicker: false, dead: false, phase: 0, kind: 'heart', level: 1 };
    world.lightSources.push(src);
    world.heart = { x: h.x, z: h.z, g, heart, heartMat, flames, fire, src, burning: false, burnT: 0,
      burn() { this.burning = true; this.src.color.set(0xff7a20); this.src.base = 12; this.src.dist = 12; fire.forEach((f) => (f.visible = true)); } };
  }

  // ---------- exit door ----------
  const ex = map.exit;
  const exitG = new THREE.Group(); exitG.position.set(ex.x + 0.02, 0, ex.z); scene.add(exitG);
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
  const exitSrc = { x: ex.x + 0.8, y: 1.6, z: ex.z, color: new THREE.Color(0xff2a10), base: 2.5, dist: 7, flicker: false, dead: false, phase: 0, kind: 'exit', level: 1 };
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
      tl.eff.rotation.y += dt * 0.3;
      tl.flames.forEach((f, k) => { const s = 0.9 + Math.sin(t * 13 + k * 3) * 0.1 + Math.random() * 0.08; f.scale.set(0.12 * s, 0.2 * s, 1); });
      tl.halo.material.opacity = 0.3 + Math.sin(t * 7) * 0.05;
    }
    { const H = world.heart; const beat = (t * 1.1) % 1; const pulse = Math.exp(-beat * 14) + Math.exp(-Math.max(0, beat - 0.22) * 14) * (beat > 0.22 ? 0.7 : 0);
      const sc = H.burning ? 1 - Math.min(0.6, H.burnT * 0.08) : 1 + pulse * 0.12;
      if (H.burning) H.burnT += dt;
      H.heart.scale.set(sc, sc * 1.25, sc * 0.9); H.heartMat.emissiveIntensity = H.burning ? 2.5 : 0.6 + pulse * 2;
      H.src.level = H.burning ? 0.8 + Math.random() * 0.4 : 0.5 + pulse;
      H.flames.forEach((f, k) => { const q = 0.9 + Math.sin(t * 13 + k) * 0.1; f.scale.set(0.12 * q, 0.22 * q, 1); });
      if (H.burning) H.fire.forEach((f, k) => { const q = 0.5 + Math.random() * 0.7; f.scale.set(0.5 * q, 0.9 * q, 1); f.position.y = 1.0 + ((t * 0.8 + k * 0.1) % 0.8); f.material.opacity = 0.9 - ((t * 0.8 + k * 0.1) % 0.8); });
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
