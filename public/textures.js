// Procedurally painted textures (canvas) — no image files needed.
import * as THREE from 'three';

const R = Math.random;
const rr = (a, b) => a + R() * (b - a);

export function canvas(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

export function toTex(c, { srgb = true, repeat = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function noise(g, S, amt, mono = true) {
  const img = g.getImageData(0, 0, S, S), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (R() - 0.5) * amt;
    d[i] += n; d[i + 1] += mono ? n : (R() - 0.5) * amt; d[i + 2] += mono ? n : (R() - 0.5) * amt;
  }
  g.putImageData(img, 0, 0);
}

// draw with horizontal wrap so textures tile
function wrapDraw(S, x, fn) { fn(x); if (x < 120) fn(x + S); if (x > S - 120) fn(x - S); }

function stains(g, S, n, ymin = 0, ymax = S, col = '25,18,8', amax = 0.35) {
  for (let k = 0; k < n; k++) {
    const x = R() * S, y = rr(ymin, ymax), r = rr(10, 90), a = rr(0.08, amax);
    wrapDraw(S, x, (xx) => {
      const gr = g.createRadialGradient(xx, y, 0, xx, y, r);
      gr.addColorStop(0, `rgba(${col},${a})`); gr.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = gr; g.beginPath(); g.ellipse(xx, y, r, r * rr(0.6, 1.4), 0, 0, Math.PI * 2); g.fill();
    });
  }
}

function streaks(g, S, n, col = '28,22,10') {
  for (let k = 0; k < n; k++) {
    const x = R() * S, y0 = rr(-20, 120), len = rr(60, 320), w = rr(3, 22);
    const gr = g.createLinearGradient(0, y0, 0, y0 + len);
    gr.addColorStop(0, `rgba(${col},${rr(0.2, 0.45)})`); gr.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = gr; wrapDraw(S, x, (xx) => g.fillRect(xx, y0, w, len));
  }
}

function damask(g, x, y, s) {
  g.save(); g.translate(x, y); g.scale(s, s);
  g.beginPath();
  g.moveTo(0, -38);
  g.bezierCurveTo(18, -26, 26, -6, 10, 6); g.bezierCurveTo(22, 14, 18, 30, 0, 40);
  g.bezierCurveTo(-18, 30, -22, 14, -10, 6); g.bezierCurveTo(-26, -6, -18, -26, 0, -38);
  g.fill(); g.stroke();
  g.beginPath(); g.ellipse(0, 0, 5, 9, 0, 0, Math.PI * 2); g.stroke();
  for (const sx of [-1, 1]) {
    g.beginPath(); g.moveTo(sx * 10, -6); g.bezierCurveTo(sx * 34, -20, sx * 40, 8, sx * 24, 12); g.stroke();
  }
  g.restore();
}

export function handprint(g, x, y, s, rot, col = 'rgba(90,8,8,0.85)') {
  g.save(); g.translate(x, y); g.rotate(rot); g.scale(s, s);
  g.fillStyle = col;
  g.beginPath(); g.ellipse(0, 0, 16, 19, 0, 0, Math.PI * 2); g.fill();
  const fingers = [[-13, -18, -0.35, 20], [-5, -24, -0.1, 26], [4, -25, 0.05, 27], [12, -21, 0.25, 23], [19, -2, 0.9, 17]];
  g.lineCap = 'round'; g.strokeStyle = col;
  for (const [fx, fy, a, l] of fingers) {
    g.lineWidth = 7.5; g.beginPath(); g.moveTo(fx * 0.6, fy * 0.4); g.lineTo(fx + Math.sin(a) * l, fy - Math.cos(a) * l * 0.9); g.stroke();
  }
  // drips
  for (let k = 0; k < 4; k++) {
    const dx = rr(-14, 14), len = rr(20, 90);
    g.lineWidth = rr(1.5, 3.5); g.beginPath(); g.moveTo(dx, 10); g.lineTo(dx + rr(-2, 2), 10 + len); g.stroke();
    g.beginPath(); g.arc(dx, 10 + len, g.lineWidth * 0.9, 0, Math.PI * 2); g.fill();
  }
  g.restore();
}

// ---------- walls ----------
export function wallCanvas(variant = 0) {
  const S = 512, c = canvas(S), g = c.getContext('2d');
  const base = ['#3b3a2c', '#35302a', '#2f3530'][variant % 3];
  g.fillStyle = base; g.fillRect(0, 0, S, S);
  for (let x = 0; x < S; x += 32) { g.fillStyle = (x / 32) % 2 ? 'rgba(0,0,0,0.07)' : 'rgba(255,240,200,0.03)'; g.fillRect(x, 0, 16, 320); }
  g.save(); g.beginPath(); g.rect(0, 0, S, 320); g.clip();
  g.fillStyle = 'rgba(15,12,6,0.28)'; g.strokeStyle = 'rgba(150,135,90,0.18)'; g.lineWidth = 2;
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
    const x = col * 128 + (row % 2 ? 64 : 0), y = row * 92 + 34;
    wrapDraw(S, x, (xx) => damask(g, xx, y, 0.9));
  }
  g.restore();
  streaks(g, S, 12);
  stains(g, S, 30, 0, 330);
  // peeling patches of older paper
  for (let k = 0; k < 4; k++) {
    const x = rr(30, S - 90), y = rr(20, 260), w = rr(30, 70), h = rr(40, 110);
    g.fillStyle = 'rgba(105,98,72,0.55)'; g.strokeStyle = 'rgba(10,8,4,0.6)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(x, y);
    for (let a = 0; a < 10; a++) g.lineTo(x + w / 2 + Math.cos((a / 10) * 6.28) * w * rr(0.4, 0.6), y + h / 2 + Math.sin((a / 10) * 6.28) * h * rr(0.4, 0.6));
    g.closePath(); g.fill(); g.stroke();
  }
  // chair rail
  g.fillStyle = '#24170e'; g.fillRect(0, 318, S, 18);
  g.fillStyle = 'rgba(255,220,170,0.13)'; g.fillRect(0, 318, S, 3);
  g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(0, 334, S, 3);
  // wainscot panels
  g.fillStyle = '#21160d'; g.fillRect(0, 337, S, 175);
  for (let y = 337; y < 512; y += 3) { g.fillStyle = `rgba(${R() < 0.5 ? '0,0,0' : '90,60,30'},${rr(0.03, 0.1)})`; g.fillRect(0, y, S, 1); }
  for (const p of [0, 1]) {
    const x0 = p * 256 + 22, w = 212, y0 = 358, h = 118;
    g.strokeStyle = 'rgba(0,0,0,0.65)'; g.lineWidth = 6; g.strokeRect(x0, y0, w, h);
    g.strokeStyle = 'rgba(200,150,100,0.1)'; g.lineWidth = 2; g.strokeRect(x0 + 4, y0 + 4, w - 8, h - 8);
  }
  g.fillStyle = '#120b06'; g.fillRect(0, 488, S, 24);
  g.fillStyle = 'rgba(255,220,170,0.08)'; g.fillRect(0, 488, S, 2);
  stains(g, S, 14, 330, 512, '0,0,0', 0.4);
  const gr = g.createLinearGradient(0, 400, 0, 512); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = gr; g.fillRect(0, 400, S, 112);
  const gt = g.createLinearGradient(0, 0, 0, 80); gt.addColorStop(0, 'rgba(0,0,0,0.5)'); gt.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gt; g.fillRect(0, 0, S, 80);

  if (variant === 1) { // blood
    for (let k = 0; k < 3; k++) handprint(g, rr(80, S - 80), rr(120, 300), rr(0.9, 1.3), rr(-0.5, 0.5));
    g.strokeStyle = 'rgba(80,5,5,0.7)'; g.lineCap = 'round';
    for (let k = 0; k < 3; k++) {
      g.lineWidth = rr(8, 20); g.beginPath(); const x = rr(60, S - 60), y = rr(150, 380);
      g.moveTo(x, y); g.bezierCurveTo(x + rr(-80, 80), y + 40, x + rr(-80, 80), y + 80, x + rr(-120, 120), y + rr(90, 160)); g.stroke();
    }
  }
  if (variant === 2) { // scratches / tallies
    g.strokeStyle = 'rgba(190,170,130,0.45)'; g.lineWidth = 2;
    for (let s = 0; s < 6; s++) {
      const x = rr(40, S - 120), y = rr(60, 260);
      for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(x + k * 14, y); g.lineTo(x + k * 14 + rr(-4, 4), y + rr(40, 60)); g.stroke(); }
      g.beginPath(); g.moveTo(x - 6, y + 10); g.lineTo(x + 52, y + 40); g.stroke();
    }
    for (let k = 0; k < 4; k++) { // claw gouges
      const x = rr(60, S - 60), y = rr(80, 220);
      g.strokeStyle = 'rgba(10,6,3,0.85)'; g.lineWidth = 4;
      for (let f = 0; f < 4; f++) { g.beginPath(); g.moveTo(x + f * 12, y); g.quadraticCurveTo(x + f * 12 + 10, y + 70, x + f * 12 + 4, y + 140); g.stroke(); }
    }
  }
  noise(g, S, 22);
  return c;
}

// ---------- floors ----------
export function woodFloorCanvas() {
  const S = 512, c = canvas(S), g = c.getContext('2d');
  const ph = S / 6;
  for (let p = 0; p < 6; p++) {
    let off = R() * S;
    for (const segStart of [0, off]) {
      const l = 40 + R() * 25;
      g.fillStyle = `rgb(${l + 18},${l * 0.62 + 6},${l * 0.35})`;
      g.fillRect(segStart, p * ph, S - segStart, ph);
    }
    for (let k = 0; k < 40; k++) {
      g.strokeStyle = `rgba(${R() < 0.5 ? '0,0,0' : '120,80,40'},${rr(0.05, 0.18)})`; g.lineWidth = rr(0.5, 2);
      g.beginPath(); const y = p * ph + R() * ph; g.moveTo(0, y);
      for (let x = 0; x <= S; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + k) * 2);
      g.stroke();
    }
    g.fillStyle = 'rgba(0,0,0,0.85)'; g.fillRect(0, p * ph, S, 3);
    g.fillRect(off, p * ph, 3, ph);
    g.fillStyle = 'rgba(30,30,30,0.9)';
    for (const x of [off + 10, off - 12]) for (const dy of [12, ph - 12]) { g.beginPath(); g.arc(x, p * ph + dy, 2.5, 0, 7); g.fill(); }
  }
  stains(g, S, 30, 0, S, '10,6,2', 0.45);
  noise(g, S, 20);
  return c;
}

export function tileFloorCanvas() {
  const S = 512, c = canvas(S), g = c.getContext('2d');
  const n = 4, ts = S / n;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const dark = (i + j) % 2;
    const l = dark ? rr(30, 40) : rr(105, 125);
    g.fillStyle = `rgb(${l},${l * 0.98},${l * 0.9})`; g.fillRect(i * ts, j * ts, ts, ts);
  }
  g.strokeStyle = 'rgba(15,12,8,0.9)'; g.lineWidth = 4;
  for (let k = 0; k <= n; k++) { g.beginPath(); g.moveTo(k * ts, 0); g.lineTo(k * ts, S); g.stroke(); g.beginPath(); g.moveTo(0, k * ts); g.lineTo(S, k * ts); g.stroke(); }
  g.strokeStyle = 'rgba(10,8,5,0.7)'; g.lineWidth = 1.2;
  for (let k = 0; k < 10; k++) { // cracks
    let x = R() * S, y = R() * S; g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s < 8; s++) { x += rr(-25, 25); y += rr(-25, 25); g.lineTo(x, y); }
    g.stroke();
  }
  stains(g, S, 40, 0, S, '30,22,8', 0.5);
  stains(g, S, 6, 0, S, '60,8,4', 0.35);
  noise(g, S, 26);
  return c;
}

export function ceilingCanvas() {
  const S = 512, c = canvas(S), g = c.getContext('2d');
  g.fillStyle = '#6f6b60'; g.fillRect(0, 0, S, S);
  g.strokeStyle = 'rgba(20,18,12,0.6)'; g.lineWidth = 5;
  g.strokeRect(0, 0, S / 2, S / 2); g.strokeRect(S / 2, 0, S / 2, S / 2); g.strokeRect(0, S / 2, S / 2, S / 2); g.strokeRect(S / 2, S / 2, S / 2, S / 2);
  for (let k = 0; k < 12; k++) { // water rings
    const x = R() * S, y = R() * S, r = rr(20, 90);
    for (let q = 0; q < 3; q++) { g.strokeStyle = `rgba(90,60,20,${rr(0.15, 0.3)})`; g.lineWidth = rr(1, 3); g.beginPath(); g.ellipse(x, y, r * (1 - q * 0.2), r * (0.8 - q * 0.15), R(), 0, 7); g.stroke(); }
  }
  stains(g, S, 40, 0, S, '40,30,15', 0.4);
  noise(g, S, 24);
  return c;
}

export function plainWoodCanvas(base = [58, 38, 24]) {
  const S = 256, c = canvas(S), g = c.getContext('2d');
  g.fillStyle = `rgb(${base})`; g.fillRect(0, 0, S, S);
  for (let k = 0; k < 70; k++) {
    g.strokeStyle = `rgba(${R() < 0.5 ? '0,0,0' : '140,100,60'},${rr(0.05, 0.2)})`; g.lineWidth = rr(0.5, 2);
    g.beginPath(); const y = R() * S; g.moveTo(0, y); for (let x = 0; x <= S; x += 16) g.lineTo(x, y + Math.sin(x * 0.03 + k) * 3); g.stroke();
  }
  stains(g, S, 10, 0, S, '0,0,0', 0.3);
  noise(g, S, 18);
  return c;
}

export function rustCanvas() {
  const S = 256, c = canvas(S), g = c.getContext('2d');
  g.fillStyle = '#6a6a66'; g.fillRect(0, 0, S, S);
  stains(g, S, 40, 0, S, '110,55,20', 0.6);
  stains(g, S, 20, 0, S, '30,20,10', 0.5);
  noise(g, S, 30, false);
  return c;
}

export function fabricCanvas() {
  const S = 256, c = canvas(S), g = c.getContext('2d');
  g.fillStyle = '#8c897c'; g.fillRect(0, 0, S, S);
  for (let y = 0; y < S; y += 4) { g.fillStyle = 'rgba(0,0,0,0.05)'; g.fillRect(0, y, S, 2); }
  stains(g, S, 18, 0, S, '90,70,30', 0.5);
  stains(g, S, 4, 0, S, '90,8,6', 0.7);
  noise(g, S, 20);
  return c;
}

// ---------- decals ----------
export function bloodCanvas() {
  const S = 256, c = canvas(S), g = c.getContext('2d');
  const col = () => `rgba(${rr(60, 95)},${rr(0, 8)},${rr(0, 8)},${rr(0.75, 0.95)})`;
  g.fillStyle = col();
  for (let k = 0; k < 9; k++) { g.beginPath(); g.ellipse(128 + rr(-30, 30), 128 + rr(-30, 30), rr(15, 50), rr(15, 45), R() * 3, 0, 7); g.fill(); }
  for (let k = 0; k < 40; k++) {
    const a = R() * 6.28, d = rr(50, 120);
    g.beginPath(); g.arc(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, rr(1, 6), 0, 7); g.fill();
  }
  for (let k = 0; k < 6; k++) {
    const a = R() * 6.28; g.strokeStyle = col(); g.lineWidth = rr(3, 8); g.lineCap = 'round';
    g.beginPath(); g.moveTo(128, 128); g.lineTo(128 + Math.cos(a) * rr(60, 115), 128 + Math.sin(a) * rr(60, 115)); g.stroke();
  }
  const gr = g.createRadialGradient(128, 128, 10, 128, 128, 70);
  gr.addColorStop(0, 'rgba(20,0,0,0.6)'); gr.addColorStop(1, 'rgba(20,0,0,0)');
  g.globalCompositeOperation = 'source-atop'; g.fillStyle = gr; g.fillRect(0, 0, S, S);
  return c;
}

export function writingCanvas(text) {
  const c = canvas(1024, 384), g = c.getContext('2d');
  const size = text.length > 14 ? 64 : 92;
  g.font = `${size}px "Rubik Wet Paint", "Rock Salt", cursive`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const words = text.split(' ');
  const lines = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (g.measureText(t).width > 920 && cur) { lines.push(cur); cur = w; } else cur = t; }
  lines.push(cur);
  const y0 = 192 - ((lines.length - 1) * size * 1.2) / 2;
  g.fillStyle = 'rgba(105,8,6,0.92)';
  lines.forEach((l, i) => {
    g.save(); g.translate(512, y0 + i * size * 1.2); g.rotate(rr(-0.06, 0.06)); g.fillText(l, 0, 0); g.restore();
  });
  // drips running down from letters
  g.strokeStyle = 'rgba(95,6,4,0.85)'; g.lineCap = 'round';
  const img = g.getImageData(0, 0, 1024, 384).data;
  for (let k = 0; k < 40; k++) {
    const x = Math.floor(rr(60, 964));
    let y = -1;
    for (let yy = 383; yy > 0; yy -= 2) if (img[(yy * 1024 + x) * 4 + 3] > 120) { y = yy; break; }
    if (y < 0) continue;
    const len = rr(10, 120); g.lineWidth = rr(2, 5);
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + rr(-1, 1), Math.min(380, y + len)); g.stroke();
  }
  return c;
}

export function glowCanvas() {
  const S = 128, c = canvas(S), g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  return c;
}

// Projected flashlight pattern (hot spot, ring, smudges)
export function flashlightCookie() {
  const S = 256, c = canvas(S), g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, '#fff'); gr.addColorStop(0.18, '#f2f2f2'); gr.addColorStop(0.32, '#b8b8b8');
  gr.addColorStop(0.55, '#9a9a9a'); gr.addColorStop(0.62, '#c8c8c8'); gr.addColorStop(0.7, '#6a6a6a'); gr.addColorStop(1, '#000');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  for (let k = 0; k < 14; k++) {
    const a = R() * 6.28, d = rr(10, 90);
    const sg = g.createRadialGradient(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 0, 128 + Math.cos(a) * d, 128 + Math.sin(a) * d, rr(8, 30));
    sg.addColorStop(0, 'rgba(0,0,0,0.25)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = sg; g.fillRect(0, 0, S, S);
  }
  return c;
}

// Monster face (head texture)
export function monsterFaceCanvas() {
  const S = 512, c = canvas(S), g = c.getContext('2d');
  g.fillStyle = '#b9b2a4'; g.fillRect(0, 0, S, S);
  stains(g, S, 30, 0, S, '90,80,70', 0.35);
  // veins
  g.strokeStyle = 'rgba(60,40,70,0.45)';
  for (let k = 0; k < 30; k++) {
    let x = R() * S, y = R() * S; g.lineWidth = rr(0.5, 2); g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s < 6; s++) { x += rr(-20, 20); y += rr(-20, 20); g.lineTo(x, y); } g.stroke();
  }
  // face is drawn centred around u=0.25 (front of sphere when mapped)
  const fx = S * 0.25, fy = S * 0.5;
  for (const sx of [-1, 1]) {
    const ex = fx + sx * 34, ey = fy - 30;
    const eg = g.createRadialGradient(ex, ey, 2, ex, ey, 34);
    eg.addColorStop(0, '#000'); eg.addColorStop(0.6, 'rgba(0,0,0,0.95)'); eg.addColorStop(1, 'rgba(20,10,10,0)');
    g.fillStyle = eg; g.beginPath(); g.ellipse(ex, ey, 30, 38, sx * 0.25, 0, 7); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.8)'; g.lineWidth = 4; // black tears
    g.beginPath(); g.moveTo(ex + rr(-6, 6), ey + 20); g.lineTo(ex + rr(-8, 8), ey + rr(70, 130)); g.stroke();
  }
  // mouth: impossibly wide grin
  g.fillStyle = '#120202';
  g.beginPath(); g.moveTo(fx - 95, fy + 40);
  g.quadraticCurveTo(fx, fy + 150, fx + 95, fy + 40);
  g.quadraticCurveTo(fx, fy + 90, fx - 95, fy + 40); g.fill();
  g.fillStyle = '#d8cfa8';
  for (let k = 0; k < 16; k++) {
    const t = k / 15, x = fx - 85 + t * 170;
    const yTop = fy + 40 + Math.sin(t * Math.PI) * 48;
    g.beginPath(); g.moveTo(x - 5, yTop); g.lineTo(x + 5, yTop); g.lineTo(x, yTop + rr(8, 16)); g.fill();
    const yBot = fy + 40 + Math.sin(t * Math.PI) * 100;
    g.beginPath(); g.moveTo(x - 5, yBot); g.lineTo(x + 5, yBot); g.lineTo(x, yBot - rr(8, 16)); g.fill();
  }
  noise(g, S, 20);
  return c;
}

// Enamel hospital sign above doorways
export function signCanvas(label) {
  const W = 512, H = 128, c = canvas(W, H), g = c.getContext('2d');
  g.fillStyle = '#1d2a26'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#c9c2a8'; g.lineWidth = 5; g.strokeRect(10, 10, W - 20, H - 20);
  g.fillStyle = '#d8d0b4';
  g.font = '64px "IM Fell English SC", "Courier Prime", serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(label, W / 2, H / 2 + 4, W - 60);
  for (const x of [26, W - 26]) { g.fillStyle = '#6a6458'; g.beginPath(); g.arc(x, H / 2, 6, 0, 7); g.fill(); }
  // chipped enamel + rust
  for (let k = 0; k < 24; k++) {
    const x = R() * W, y = R() * H, r = rr(2, 12);
    g.fillStyle = R() < 0.5 ? 'rgba(20,14,8,0.85)' : 'rgba(110,55,20,0.6)';
    g.beginPath(); g.ellipse(x, y, r, r * rr(0.4, 1), R() * 3, 0, 7); g.fill();
  }
  stains(g, W, 8, 0, H, '90,45,15', 0.5);
  const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.35)');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  return c;
}

// Blood ritual circle on the floor of ROOM 41
export function ritualCanvas() {
  const S = 512, c = canvas(S), g = c.getContext('2d');
  const col = 'rgba(120,6,4,0.9)';
  g.strokeStyle = col; g.lineCap = 'round';
  for (const [r, w] of [[240, 10], [222, 4], [150, 6]]) { g.lineWidth = w; g.beginPath(); g.arc(256, 256, r, 0, 7); g.stroke(); }
  g.lineWidth = 5; g.beginPath();
  for (let k = 0; k <= 5; k++) { const a = -Math.PI / 2 + (k * 2 * 2 * Math.PI) / 5; const x = 256 + Math.cos(a) * 222, y = 256 + Math.sin(a) * 222; k ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.stroke();
  g.fillStyle = col; g.font = '34px "IM Fell English SC", serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const runes = 'ᚺᛟᛚᛚᛟᚹ ᚺᛖᚱ ᚺᛖᚨᚱᛏ';
  for (let k = 0; k < runes.length; k++) { const a = (k / runes.length) * Math.PI * 2; g.save(); g.translate(256 + Math.cos(a) * 186, 256 + Math.sin(a) * 186); g.rotate(a + Math.PI / 2); g.fillText(runes[k], 0, 0); g.restore(); }
  for (let k = 0; k < 30; k++) { g.beginPath(); g.arc(rr(30, 482), rr(30, 482), rr(2, 9), 0, 7); g.fill(); }
  return c;
}

// Crumpled note lying on the floor
export function paperCanvas() {
  const W = 256, H = 340, c = canvas(W, H), g = c.getContext('2d');
  g.fillStyle = '#d9d2bb'; g.fillRect(0, 0, W, H);
  stains(g, W, 12, 0, H, '120,90,40', 0.3);
  g.strokeStyle = 'rgba(80,90,140,0.35)'; g.lineWidth = 1;
  for (let y = 40; y < H; y += 18) { g.beginPath(); g.moveTo(10, y); g.lineTo(W - 10, y); g.stroke(); }
  g.strokeStyle = 'rgba(30,25,40,0.75)'; g.lineWidth = 1.6;
  for (let y = 36; y < H - 30; y += 18) {
    let x = 16 + R() * 6; const end = W - 20 - R() * 60;
    g.beginPath(); g.moveTo(x, y);
    while (x < end) { x += rr(3, 7); g.lineTo(x, y - rr(0, 6)); }
    g.stroke();
  }
  // creases
  g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(0, H * 0.48); g.lineTo(W, H * 0.52); g.stroke();
  g.beginPath(); g.moveTo(W * 0.5, 0); g.lineTo(W * 0.46, H); g.stroke();
  if (R() < 0.5) handprint(g, rr(60, 200), rr(80, 280), 0.6, rr(-1, 1), 'rgba(110,8,8,0.6)');
  return c;
}

// Big painted jumpscare face (2D overlay)
export function jumpscareCanvas() {
  const W = 1024, H = 1024, c = canvas(W, H), g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  const cx = W / 2, cy = H / 2 + 30;
  // hair mass behind the face
  g.save(); g.filter = 'blur(2px)';
  for (let k = 0; k < 500; k++) {
    const side = Math.random() < 0.5 ? -1 : 1;
    const x0 = cx + rr(-260, 260), y0 = rr(-40, 120);
    g.strokeStyle = `rgba(${rr(6, 20)},${rr(5, 14)},${rr(4, 10)},${rr(0.6, 1)})`; g.lineWidth = rr(1, 5);
    g.beginPath(); g.moveTo(x0, y0);
    g.bezierCurveTo(x0 + side * rr(80, 220), rr(200, 400), x0 + side * rr(120, 300), rr(500, 800), x0 + side * rr(60, 260), rr(900, 1100));
    g.stroke();
  }
  g.restore();
  // face
  g.save();
  g.beginPath(); g.ellipse(cx, cy, 245, 420, 0, 0, 7); g.clip();
  const sk = g.createRadialGradient(cx - 50, cy + 40, 30, cx, cy, 470);
  sk.addColorStop(0, '#d7d0c0'); sk.addColorStop(0.35, '#a59d8e'); sk.addColorStop(0.7, '#4c463d'); sk.addColorStop(1, '#0d0b09');
  g.fillStyle = sk; g.fillRect(0, 0, W, H);
  g.filter = 'blur(6px)';
  for (let k = 0; k < 140; k++) {
    const x = cx + rr(-240, 240), y = cy + rr(-400, 400), r = rr(8, 50);
    g.fillStyle = `rgba(${Math.random() < 0.6 ? '45,38,32' : Math.random() < 0.5 ? '230,225,210' : '90,50,70'},${rr(0.05, 0.22)})`;
    g.beginPath(); g.ellipse(x, y, r, r * rr(0.5, 1.4), Math.random() * 3, 0, 7); g.fill();
  }
  g.filter = 'blur(1.2px)';
  g.strokeStyle = 'rgba(70,40,90,0.35)';
  for (let k = 0; k < 40; k++) {
    let x = cx + rr(-230, 230), y = cy + rr(-380, 380); g.lineWidth = rr(1, 2.5); g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s < 5; s++) { const nx = x + rr(-40, 40), ny = y + rr(-40, 40); g.quadraticCurveTo((x + nx) / 2 + rr(-15, 15), (y + ny) / 2 + rr(-15, 15), nx, ny); x = nx; y = ny; }
    g.stroke();
  }
  // brow & cheek shadows
  g.filter = 'blur(30px)';
  g.fillStyle = 'rgba(10,8,6,0.75)';
  g.beginPath(); g.ellipse(cx - 100, cy + 120, 60, 120, 0.2, 0, 7); g.fill();
  g.beginPath(); g.ellipse(cx + 100, cy + 120, 60, 120, -0.2, 0, 7); g.fill();
  // eye sockets (asymmetric, deep)
  const eyesP = [[cx - 105, cy - 150, 82, 105, 0.15], [cx + 108, cy - 135, 88, 112, -0.2]];
  for (const [ex, ey, rx, ry, rot] of eyesP) {
    g.filter = 'blur(18px)'; g.fillStyle = 'rgba(0,0,0,0.95)';
    g.beginPath(); g.ellipse(ex, ey, rx * 1.15, ry * 1.15, rot, 0, 7); g.fill();
    g.filter = 'blur(4px)'; g.fillStyle = '#000';
    g.beginPath(); g.ellipse(ex, ey + 5, rx * 0.8, ry * 0.85, rot, 0, 7); g.fill();
  }
  // pinprick pupils
  g.filter = 'blur(3px)';
  for (const [ex, ey, , , ] of eyesP) {
    const pg = g.createRadialGradient(ex + 6, ey + 14, 0, ex + 6, ey + 14, 22);
    pg.addColorStop(0, 'rgba(255,250,240,1)'); pg.addColorStop(0.25, 'rgba(255,200,180,0.8)'); pg.addColorStop(1, 'rgba(255,40,20,0)');
    g.fillStyle = pg; g.beginPath(); g.arc(ex + 6, ey + 14, 22, 0, 7); g.fill();
  }
  // black tears
  g.filter = 'blur(2px)'; g.lineCap = 'round';
  for (const [ex, ey] of eyesP) for (let k = 0; k < 4; k++) {
    g.strokeStyle = `rgba(0,0,0,${rr(0.75, 0.95)})`; g.lineWidth = rr(6, 18);
    const x = ex + rr(-50, 50); g.beginPath(); g.moveTo(x, ey + 60); g.bezierCurveTo(x + rr(-10, 10), ey + 150, x + rr(-15, 15), ey + 250, x + rr(-15, 15), ey + rr(260, 520)); g.stroke();
  }
  // nose slits
  g.filter = 'blur(3px)'; g.fillStyle = 'rgba(0,0,0,0.9)';
  g.beginPath(); g.ellipse(cx - 18, cy + 15, 8, 22, 0.3, 0, 7); g.fill();
  g.beginPath(); g.ellipse(cx + 18, cy + 15, 8, 22, -0.3, 0, 7); g.fill();
  // mouth: stretched open, far too long
  const my = cy + 210;
  g.filter = 'blur(10px)'; g.fillStyle = 'rgba(30,0,0,0.9)';
  g.beginPath(); g.ellipse(cx, my, 110, 230, 0, 0, 7); g.fill();
  g.filter = 'blur(2px)';
  const mg = g.createRadialGradient(cx, my + 20, 10, cx, my, 220);
  mg.addColorStop(0, '#000'); mg.addColorStop(0.6, '#070000'); mg.addColorStop(0.9, '#3a0505'); mg.addColorStop(1, '#5a0a08');
  g.fillStyle = mg; g.beginPath(); g.ellipse(cx, my, 88, 205, 0, 0, 7); g.fill();
  // torn corners
  g.strokeStyle = 'rgba(40,0,0,0.9)'; g.lineWidth = 7;
  for (const sx of [-1, 1]) { g.beginPath(); g.moveTo(cx + sx * 80, my - 120); g.quadraticCurveTo(cx + sx * 150, my - 150, cx + sx * 190, my - 230); g.stroke(); }
  // a few long, thin, uneven teeth
  for (let k = 0; k < 11; k++) {
    const a = Math.PI + 0.35 + (k / 10) * (Math.PI - 0.7);
    const x = cx + Math.cos(a) * 82, y = my + Math.sin(a) * 195;
    const tg = g.createLinearGradient(x, y, x, y + 70);
    tg.addColorStop(0, '#c9bf98'); tg.addColorStop(1, '#5a4a28');
    g.fillStyle = tg; g.beginPath(); g.moveTo(x - rr(5, 9), y - 4); g.lineTo(x + rr(5, 9), y - 4); g.lineTo(x + rr(-3, 3), y + rr(35, 85)); g.fill();
  }
  for (let k = 0; k < 9; k++) {
    const a = 0.45 + (k / 8) * (Math.PI - 0.9);
    const x = cx + Math.cos(a) * 80, y = my + Math.sin(a) * 192;
    g.fillStyle = '#8a7a50'; g.beginPath(); g.moveTo(x - 6, y + 4); g.lineTo(x + 6, y + 4); g.lineTo(x + rr(-3, 3), y - rr(25, 60)); g.fill();
  }
  // blood from the mouth
  g.filter = 'blur(1.5px)';
  for (let k = 0; k < 10; k++) {
    g.strokeStyle = `rgba(${rr(90, 130)},0,0,${rr(0.7, 0.95)})`; g.lineWidth = rr(4, 12);
    const x = cx + rr(-90, 90); g.beginPath(); g.moveTo(x, my + 150); g.lineTo(x + rr(-6, 6), my + rr(260, 460)); g.stroke();
  }
  g.restore();
  // soften the face outline into the darkness
  g.save(); g.filter = 'blur(28px)'; g.strokeStyle = 'rgba(0,0,0,0.95)'; g.lineWidth = 90;
  g.beginPath(); g.ellipse(cx, cy, 255, 430, 0, 0, 7); g.stroke(); g.restore();
  // strands of hair falling over the face
  g.save(); g.filter = 'blur(1px)';
  for (let k = 0; k < 260; k++) {
    const side = Math.random() < 0.5 ? -1 : 1;
    const x0 = cx + side * (Math.random() < 0.5 ? rr(20, 230) : rr(170, 270)), y0 = cy - rr(330, 440);
    g.strokeStyle = `rgba(${rr(4, 14)},${rr(3, 10)},${rr(2, 8)},${rr(0.55, 0.95)})`; g.lineWidth = rr(1, 4);
    g.beginPath(); g.moveTo(x0, y0);
    g.bezierCurveTo(x0 + side * rr(-20, 60), cy - 100, x0 + side * rr(-30, 80), cy + 200, x0 + side * rr(0, 120), cy + rr(300, 520));
    g.stroke();
  }
  g.restore();
  // grain + vignette
  const img = g.getImageData(0, 0, W, H), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (R() - 0.5) * 34; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(img, 0, 0);
  const v = g.createRadialGradient(cx, cy, 250, cx, cy, 700);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.92)');
  g.fillStyle = v; g.fillRect(0, 0, W, H);
  return c;
}

// Exit door sigil: base + emissive (lit runes = collected)
export function sigilCanvases(collected, total, open) {
  const S = 512, base = canvas(S), em = canvas(S);
  const g = base.getContext('2d'), e = em.getContext('2d');
  g.fillStyle = '#2b2622'; g.fillRect(0, 0, S, S);
  stains(g, S, 30, 0, S, '110,55,20', 0.55);
  g.strokeStyle = 'rgba(0,0,0,0.8)'; g.lineWidth = 10; g.strokeRect(12, 12, S - 24, S - 24);
  g.fillStyle = '#121010'; g.fillRect(S / 2 - 3, 0, 6, S);
  for (let k = 0; k < 10; k++) for (const x of [36, S - 36]) { g.fillStyle = '#4a443c'; g.beginPath(); g.arc(x, 40 + k * 48, 7, 0, 7); g.fill(); }
  noise(g, S, 25);
  e.fillStyle = '#000'; e.fillRect(0, 0, S, S);
  const cx = S / 2, cy = S / 2, r = 150;
  for (const ctx of [g, e]) {
    ctx.strokeStyle = ctx === g ? 'rgba(20,5,5,0.9)' : (open ? '#ffffff' : '#ff2a10');
    ctx.lineWidth = 6;
    if (ctx === e && !open && collected === 0) continue;
    ctx.globalAlpha = ctx === e ? (open ? 1 : 0.25 + 0.75 * (collected / total)) : 1;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, r - 22, 0, 7); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  for (let k = 0; k < total; k++) {
    const a = -Math.PI / 2 + (k / total) * Math.PI * 2;
    const x = cx + Math.cos(a) * (r - 11), y = cy + Math.sin(a) * (r - 11);
    const lit = open || k < collected;
    for (const ctx of [g, e]) {
      if (ctx === e && !lit) continue;
      ctx.strokeStyle = ctx === g ? 'rgba(15,5,5,0.95)' : (open ? '#fff' : '#ff3a18');
      ctx.lineWidth = 5;
      ctx.save(); ctx.translate(x, y); ctx.rotate(a + Math.PI / 2);
      ctx.beginPath(); ctx.moveTo(0, -26); ctx.lineTo(0, 26); ctx.moveTo(-14, -10); ctx.lineTo(14, 6); ctx.moveTo(-10, 18); ctx.lineTo(10, -22); ctx.stroke();
      ctx.restore();
      // line to centre
      ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(cx, cy); ctx.stroke(); ctx.globalAlpha = 1;
    }
  }
  return { base, em };
}
