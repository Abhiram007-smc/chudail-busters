// Mirrors on the walls (bathrooms first, then a few corridors). Real reflections (three.js Reflector).
// The scare: look into one and, now and then, she is standing right behind you in the reflection, closer each second.
// She is on layer 1, which only the mirrors' cameras see: turn around and nothing is there. Stare too long and the
// glass cracks. Not built on Low quality (a reflection is a second render of the house).
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { CELL, LEVELS, mulberry32 } from '/shared/map.js';
import * as TX from './textures.js';

export const MIRROR_LAYER = 1;
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function crackCanvas() {
  const c = TX.canvas(256, 384), g = c.getContext('2d');
  g.strokeStyle = 'rgba(235,240,250,0.9)'; g.lineWidth = 1.4;
  const cx = 120 + Math.random() * 30, cy = 170 + Math.random() * 40;
  for (let k = 0; k < 16; k++) {
    let x = cx, y = cy, a = (k / 16) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
    g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s < 8; s++) { a += (Math.random() - 0.5) * 0.5; x += Math.cos(a) * (10 + Math.random() * 20); y += Math.sin(a) * (10 + Math.random() * 20); g.lineTo(x, y); }
    g.stroke();
  }
  return c;
}

export function buildMirrors({ map, world, seed, avoid = [] }) {
  const rng = mulberry32((seed ^ 0x4d1) >>> 0);
  const W = map.W, H = map.H;
  const typeAt = (L, i, j) => (i >= 0 && j >= 0 && i < W && j < H ? map.grid[L][j * W + i] : 0);
  const doorCells = new Set(map.doors.map((d) => `${d.L},${d.i},${d.j}`));
  const nearDoor = (L, i, j) => doorCells.has(`${L},${i},${j}`) || N4.some(([a, b]) => doorCells.has(`${L},${i + a},${j + b}`));
  const writ = new Set(map.writings.map((w) => `${w.L},${w.i},${w.j},${w.dx},${w.dz}`));
  const blockedBy = (L, x, z) => map.props.some((p) => p.L === L && Math.abs(p.x - x) < p.hw + 0.7 && Math.abs(p.z - z) < p.hd + 0.7) ||
    avoid.some((a) => a.L === L && Math.hypot(a.x - x, a.z - z) < 4);
  const list = [];
  const frameM = new THREE.MeshStandardMaterial({ color: 0x2a1c12, roughness: 0.7, metalness: 0.2 });
  const crackTex = TX.toTex(crackCanvas(), { repeat: false });
  for (const L of LEVELS) {
    // bathrooms first, then plain corridor walls
    const cells = [];
    for (const r of map.rooms) if (r.L === L && r.type === 'bath') for (let j = r.y; j < r.y + r.h; j++) for (let i = r.x; i < r.x + r.w; i++) cells.push([i, j, 2, rng()]);
    for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) if (typeAt(L, i, j) === 2) cells.push([i, j, 1, rng()]);
    cells.sort((a, b) => b[2] - a[2] || a[3] - b[3]); // same order for every player (never sort by a random comparator)
    let placed = 0;
    for (const [i, j] of cells) {
      if (placed >= 2) break;
      if (nearDoor(L, i, j) || list.some((m) => m.L === L && Math.hypot(m.x / CELL - i, m.z / CELL - j) < 6)) continue;
      const walls = N4.filter(([a, b]) => typeAt(L, i + a, j + b) === 0 && !writ.has(`${L},${i},${j},${a},${b}`));
      if (!walls.length) continue;
      const [wx, wz] = walls[Math.floor(rng() * walls.length)];
      const x = (i + 0.5) * CELL + wx * (CELL / 2 - 0.04), z = (j + 0.5) * CELL + wz * (CELL / 2 - 0.04);
      if (blockedBy(L, x, z)) continue;
      const g = new THREE.Group(); g.position.set(x, 1.55, z); g.rotation.y = Math.atan2(-wx, -wz); // faces into the room
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.98, 1.38, 0.06), frameM); frame.position.z = -0.02; g.add(frame);
      const glass = new Reflector(new THREE.PlaneGeometry(0.84, 1.24), {
        textureWidth: Math.round(Math.min(innerWidth, 1280) * 0.5), textureHeight: Math.round(Math.min(innerHeight, 720) * 0.5), color: 0x8a8d90,
      });
      glass.position.z = 0.012;
      const origCam = glass.getReflectionCamera.bind(glass);
      glass.getReflectionCamera = (cam) => { const rc = origCam(cam); rc.layers.enable(MIRROR_LAYER); return rc; }; // the mirror sees her
      g.add(glass);
      const crack = new THREE.Mesh(new THREE.PlaneGeometry(0.84, 1.24), new THREE.MeshBasicMaterial({ map: crackTex, transparent: true, depthWrite: false, opacity: 0 }));
      crack.position.z = 0.016; g.add(crack);
      world.levelGroups[L].add(g);
      list.push({ g, glass, crack, L, x, z, nx: -wx, nz: -wz, next: 0, cracked: false });
      placed++;
    }
  }
  return {
    list,
    // mirrors only render near you on your floor (each one is a second render of the house)
    update(camera, camL) {
      for (const m of list) {
        const d = Math.hypot(m.x - camera.position.x, m.z - camera.position.z);
        m.glass.visible = m.L === camL && d < 11;
      }
    },
    // the mirror you are looking into, close enough to see yourself in it
    lookingInto(camera, camL) {
      const f = new THREE.Vector3(); camera.getWorldDirection(f);
      for (const m of list) {
        if (m.L !== camL || m.cracked) continue;
        const dx = m.x - camera.position.x, dz = m.z - camera.position.z, d = Math.hypot(dx, dz);
        if (d > 4.5 || d < 0.6) continue;
        const facing = -(dx * m.nx + dz * m.nz) / d; // you are in front of it
        const look = (dx * f.x + dz * f.z) / (d * Math.hypot(f.x, f.z) || 1);
        if (facing > 0.55 && look > 0.85) return m;
      }
      return null;
    },
    crack(m) { m.cracked = true; m.crack.material.opacity = 1; m.glass.material.uniforms && (m.glass.material.uniforms.color.value.setHex(0x6a6060)); },
  };
}
