// Fully procedural horror audio (no sound files needed). Web Audio API.
const rnd = (a, b) => a + Math.random() * (b - a);

export class AudioSys {
  constructor() { this.ctx = null; this.volume = 0.9; }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.25;
    this.master.connect(comp); comp.connect(ctx.destination);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(3.5, 2.2);
    const rg = ctx.createGain(); rg.gain.value = 0.7;
    this.reverb.connect(rg); rg.connect(this.master);

    this.white = this.makeNoise('white', 3);
    this.brown = this.makeNoise('brown', 6);
    this.distCurve = this.makeCurve(60);
    this.hardCurve = this.makeCurve(400);
    this.hbTimer = 0;
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }

  makeNoise(type, secs) {
    const ctx = this.ctx, len = ctx.sampleRate * secs;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c); let last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (type === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
      }
    }
    return buf;
  }
  makeImpulse(secs, decay) {
    const ctx = this.ctx, len = ctx.sampleRate * secs;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }
  makeCurve(k) {
    const n = 2048, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i * 2) / n - 1; c[i] = ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x)); }
    return c;
  }

  // route a node to the master (+ optional reverb send)
  out(node, wet = 0.3, dest = null) {
    node.connect(dest || this.master);
    if (wet > 0) { const g = this.ctx.createGain(); g.gain.value = wet; node.connect(g); g.connect(this.reverb); }
  }
  panner(x, y, z, ref = 1.6, roll = 1.3) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse';
    p.refDistance = ref; p.maxDistance = 80; p.rolloffFactor = roll;
    this.setPos(p, x, y, z);
    return p;
  }
  setPos(p, x, y, z) {
    if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z);
  }
  setListener(pos, fwd) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setTargetAtTime(pos.x, t, 0.02); l.positionY.setTargetAtTime(pos.y, t, 0.02); l.positionZ.setTargetAtTime(pos.z, t, 0.02);
      l.forwardX.value = fwd.x; l.forwardY.value = fwd.y; l.forwardZ.value = fwd.z;
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else { l.setPosition(pos.x, pos.y, pos.z); l.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0); }
  }
  src(buf, loop = false) { const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = loop; return s; }
  env(g, t, a, peak, d, end = 0.0001) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(end, t + a + d);
  }

  // ---------------- ambience ----------------
  startAmbience() {
    if (this.ambOn) return; this.ambOn = true;
    const ctx = this.ctx, t = ctx.currentTime;
    const g = (this.ambGain = ctx.createGain());
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.3, t + 8);
    this.out(g, 0.5);
    this.ambNodes = [];
    [[41.2, 'sawtooth', 0.05], [41.9, 'sawtooth', 0.05], [61.7, 'sine', 0.05], [82.9, 'triangle', 0.025], [123.5, 'sine', 0.012]].forEach(([f, type, v], i) => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160;
      const og = ctx.createGain(); og.gain.value = v;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.03 + i * 0.021;
      const lg = ctx.createGain(); lg.gain.value = v * 0.8;
      lfo.connect(lg); lg.connect(og.gain);
      o.connect(lp); lp.connect(og); og.connect(g); o.start(); lfo.start();
      this.ambNodes.push(o, lfo);
    });
    // wind through the halls
    const n = this.src(this.brown, true);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 380; bp.Q.value = 0.9;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.06;
    const lg = ctx.createGain(); lg.gain.value = 220; lfo.connect(lg); lg.connect(bp.frequency);
    const ng = ctx.createGain(); ng.gain.value = 0.22;
    n.connect(bp); bp.connect(ng); ng.connect(g); n.start(); lfo.start();
    this.ambNodes.push(n, lfo);
    // faint tinnitus
    this.scheduleCreak();
  }
  stopAmbience() {
    if (!this.ambOn) return; this.ambOn = false;
    const t = this.ctx.currentTime;
    this.ambGain.gain.cancelScheduledValues(t);
    this.ambGain.gain.setTargetAtTime(0, t, 0.5);
    const nodes = this.ambNodes;
    setTimeout(() => nodes.forEach((n) => { try { n.stop(); } catch {} }), 3000);
    clearTimeout(this.creakT);
    this.setChase(false);
    this.stopMonsterVoice();
  }
  scheduleCreak() {
    this.creakT = setTimeout(() => {
      if (!this.ambOn) return;
      const a = Math.random() * Math.PI * 2, d = rnd(6, 16);
      const lp = this.listenerPos || { x: 0, y: 1.6, z: 0 };
      if (Math.random() < 0.6) this.creak(lp.x + Math.cos(a) * d, 2, lp.z + Math.sin(a) * d);
      else this.drip(lp.x + Math.cos(a) * d * 0.5, 1, lp.z + Math.sin(a) * d * 0.5);
      this.scheduleCreak();
    }, rnd(12000, 30000));
  }
  creak(x, y, z) {
    const ctx = this.ctx, t = ctx.currentTime, dur = rnd(0.6, 1.6);
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    const f = rnd(70, 150); o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f * rnd(0.7, 1.4), t + dur);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 9;
    bp.frequency.setValueAtTime(rnd(300, 500), t); bp.frequency.linearRampToValueAtTime(rnd(700, 1100), t + dur);
    const am = ctx.createOscillator(); am.type = 'square'; am.frequency.value = rnd(14, 30);
    const amg = ctx.createGain(); amg.gain.value = 0.5;
    const g = ctx.createGain(); g.gain.value = 0;
    am.connect(amg); amg.connect(g.gain);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5, t + 0.1); g.gain.linearRampToValueAtTime(0, t + dur);
    const p = this.panner(x, y, z, 3);
    o.connect(bp); bp.connect(g); g.connect(p); this.out(p, 0.6);
    o.start(t); am.start(t); o.stop(t + dur + 0.1); am.stop(t + dur + 0.1);
  }
  drip(x, y, z) {
    const ctx = this.ctx;
    for (let k = 0; k < 3; k++) {
      const t = ctx.currentTime + k * rnd(0.4, 0.9);
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(rnd(900, 1500), t); o.frequency.exponentialRampToValueAtTime(rnd(1800, 2600), t + 0.06);
      const g = ctx.createGain(); this.env(g, t, 0.003, 0.25, 0.09);
      const p = this.panner(x, y, z, 2);
      o.connect(g); g.connect(p); this.out(p, 0.8);
      o.start(t); o.stop(t + 0.15);
    }
  }

  // ---------------- player sounds ----------------
  step(vol = 0.2, pos = null, heavy = false, surface = 'wood') {
    if (!this.ctx) return;
    if (!heavy) return this.footstep(vol, pos, surface);
    const ctx = this.ctx, t = ctx.currentTime;
    const s = this.src(this.white);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = heavy ? 380 : rnd(800, 1400);
    const g = ctx.createGain(); this.env(g, t, 0.004, vol, heavy ? 0.3 : 0.12);
    s.connect(lp); lp.connect(g);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(heavy ? 70 : 110, t); o.frequency.exponentialRampToValueAtTime(heavy ? 30 : 60, t + 0.12);
    const og = ctx.createGain(); this.env(og, t, 0.004, vol * (heavy ? 2.2 : 0.8), heavy ? 0.35 : 0.1);
    o.connect(og);
    let dest = this.master;
    if (pos) { const p = this.panner(pos.x, 0.2, pos.z, heavy ? 3 : 1.5); dest = p; this.out(p, heavy ? 0.5 : 0.2); }
    g.connect(dest); og.connect(dest);
    s.start(t, rnd(0, 2), 0.4); o.start(t); o.stop(t + 0.4);
    if (heavy && Math.random() < 0.4) { // dragging claws
      const s2 = this.src(this.white); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 2;
      const g2 = ctx.createGain(); g2.gain.setValueAtTime(0, t + 0.1); g2.gain.linearRampToValueAtTime(vol * 0.25, t + 0.3); g2.gain.linearRampToValueAtTime(0, t + 0.7);
      s2.connect(bp); bp.connect(g2); g2.connect(dest); s2.start(t + 0.1, rnd(0, 2), 0.7);
    }
  }
  footstep(vol, pos, surface) {
    const ctx = this.ctx, t = ctx.currentTime;
    let dest = this.master;
    if (pos) { const p = this.panner(pos.x, 0.1, pos.z, 1.5, 1.4); dest = p; this.out(p, 0.25); }
    else { const g0 = ctx.createGain(); g0.gain.value = 1; g0.connect(this.master); const w = ctx.createGain(); w.gain.value = 0.18; g0.connect(w); w.connect(this.reverb); dest = g0; }
    // heel thump
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(rnd(85, 105), t); o.frequency.exponentialRampToValueAtTime(45, t + 0.09);
    const og = ctx.createGain(); this.env(og, t, 0.003, vol * 0.9, 0.09); o.connect(og); og.connect(dest); o.start(t); o.stop(t + 0.15);
    // sole on surface
    const n = this.src(this.white);
    const f = ctx.createBiquadFilter();
    if (surface === 'tile') { f.type = 'bandpass'; f.frequency.value = rnd(2200, 3200); f.Q.value = 1.4; }
    else { f.type = 'lowpass'; f.frequency.value = rnd(500, 900); }
    const ng = ctx.createGain(); this.env(ng, t + 0.012, 0.002, vol * (surface === 'tile' ? 0.55 : 0.8), surface === 'tile' ? 0.045 : 0.1);
    n.connect(f); f.connect(ng); ng.connect(dest); n.start(t, rnd(0, 2), 0.2);
    // old floorboards creak sometimes
    if (surface === 'wood' && Math.random() < 0.18) {
      const c = ctx.createOscillator(); c.type = 'sawtooth'; const cf = rnd(160, 320);
      c.frequency.setValueAtTime(cf, t + 0.03); c.frequency.linearRampToValueAtTime(cf * rnd(0.8, 1.2), t + 0.3);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = rnd(600, 1100); bp.Q.value = 12;
      const cg = ctx.createGain(); cg.gain.setValueAtTime(0, t + 0.03); cg.gain.linearRampToValueAtTime(vol * 0.35, t + 0.1); cg.gain.linearRampToValueAtTime(0, t + 0.32);
      c.connect(bp); bp.connect(cg); cg.connect(dest); c.start(t + 0.03); c.stop(t + 0.35);
    }
  }
  async loadSample(name, url) {
    try {
      const buf = await (await fetch(url)).arrayBuffer();
      this.samples = this.samples || {};
      this.samples[name] = await this.ctx.decodeAudioData(buf);
    } catch (e) { console.warn('sample failed', name, e); }
  }
  playSample(name, vol = 1, rate = 1) {
    const b = this.samples && this.samples[name];
    if (!b) return false;
    const s = this.src(b); s.playbackRate.value = rate;
    const g = this.ctx.createGain(); g.gain.value = vol;
    s.connect(g); this.out(g, 0.25); s.start();
    return true;
  }
  locker(x, z, open = true) {
    const ctx = this.ctx, t = ctx.currentTime;
    const p = this.panner(x, 1.2, z, 2);
    [1830, 2710, 3950].forEach((f) => {
      const n = this.src(this.white); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * rnd(0.95, 1.05); bp.Q.value = 25;
      const g = ctx.createGain(); this.env(g, t + (open ? 0 : 0.25), 0.002, 0.5, 0.5); n.connect(bp); bp.connect(g); g.connect(p); n.start(t, 0, 0.9);
    });
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(open ? 260 : 200, t); o.frequency.linearRampToValueAtTime(open ? 180 : 300, t + 0.35);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 10;
    const og = ctx.createGain(); og.gain.setValueAtTime(0, t); og.gain.linearRampToValueAtTime(0.15, t + 0.05); og.gain.linearRampToValueAtTime(0, t + 0.35);
    o.connect(bp); bp.connect(og); og.connect(p); o.start(t); o.stop(t + 0.4);
    const th = ctx.createOscillator(); th.frequency.setValueAtTime(110, t + 0.25); th.frequency.exponentialRampToValueAtTime(50, t + 0.4);
    const tg = ctx.createGain(); this.env(tg, t + 0.25, 0.003, open ? 0.2 : 0.45, 0.2); th.connect(tg); tg.connect(p); th.start(t + 0.25); th.stop(t + 0.5);
    this.out(p, 0.5);
  }
  holyBell(x, z) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const p = this.panner(x, 1.4, z, 6, 0.7);
    [1, 2.0, 2.76, 4.07, 5.4, 6.8].forEach((h, k) => {
      const o = ctx.createOscillator(); o.frequency.value = 523 * h * (1 + (Math.random() - 0.5) * 0.004);
      const g = ctx.createGain(); this.env(g, t, 0.003, 0.4 / (k + 1), 5.5 / (k * 0.5 + 1));
      o.connect(g); g.connect(p); o.start(t); o.stop(t + 6);
    });
    this.out(p, 1.1);
  }
  skitter(x, z, vol = 0.5) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const p = this.panner(x, 1.5, z, 2, 1.2);
    for (let k = 0; k < 6; k++) {
      const tt = t + k * rnd(0.025, 0.05);
      const n = this.src(this.white); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = rnd(1800, 4200); bp.Q.value = 6;
      const g = ctx.createGain(); this.env(g, tt, 0.001, vol * rnd(0.5, 1), 0.03);
      n.connect(bp); bp.connect(g); g.connect(p); n.start(tt, rnd(0, 2), 0.06);
    }
    this.out(p, 0.3);
  }
  paper() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (let k = 0; k < 3; k++) {
      const n = this.src(this.white); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = rnd(2500, 5000); bp.Q.value = 0.8;
      const g = ctx.createGain(); this.env(g, t + k * 0.06, 0.005, 0.12, 0.08);
      n.connect(bp); bp.connect(g); g.connect(this.master); n.start(t + k * 0.06, rnd(0, 2), 0.15);
    }
  }
  click() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 2400;
    const g = ctx.createGain(); this.env(g, t, 0.001, 0.08, 0.03);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.05);
  }
  breath(vol = 0.12) {
    const ctx = this.ctx, t = ctx.currentTime;
    const s = this.src(this.white);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = rnd(900, 1300); bp.Q.value = 1.2;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.25); g.gain.linearRampToValueAtTime(0, t + 0.7);
    s.connect(bp); bp.connect(g); this.out(g, 0.1); s.start(t, rnd(0, 2), 0.8);
  }
  heartbeat(vol) {
    const ctx = this.ctx;
    [0, 0.17].forEach((off, k) => {
      const t = ctx.currentTime + off;
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(k ? 52 : 62, t); o.frequency.exponentialRampToValueAtTime(30, t + 0.18);
      const g = ctx.createGain(); this.env(g, t, 0.008, vol * (k ? 0.7 : 1), 0.22);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.3);
    });
  }
  updateHeart(dt, closeness) {
    if (!this.ctx) return;
    if (closeness <= 0.02) { this.hbTimer = 0.5; return; }
    this.hbTimer -= dt;
    if (this.hbTimer <= 0) {
      this.heartbeat(0.25 + closeness * 0.75);
      this.hbTimer = 1.15 - closeness * 0.8;
    }
  }

  // ---------------- monster ----------------
  startMonsterVoice() {
    if (this.mVoice || !this.ctx) return;
    const ctx = this.ctx;
    const p = this.panner(0, 2.2, 0, 2.2, 1.6);
    const g = ctx.createGain(); g.gain.value = 0;
    // wet, rasping breath
    const n = this.src(this.brown, true);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 520; bp.Q.value = 2.5;
    const breathG = ctx.createGain(); breathG.gain.value = 0.0;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.38;
    const lg = ctx.createGain(); lg.gain.value = 0.9; lfo.connect(lg); lg.connect(breathG.gain);
    n.connect(bp); bp.connect(breathG); breathG.connect(g);
    // guttural growl
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 46;
    const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 49.5;
    const ws = ctx.createWaveShaper(); ws.curve = this.distCurve;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 340;
    const trem = ctx.createOscillator(); trem.frequency.value = 7.5;
    const tg = ctx.createGain(); tg.gain.value = 0.15;
    const growlG = ctx.createGain(); growlG.gain.value = 0.18;
    trem.connect(tg); tg.connect(growlG.gain);
    o1.connect(ws); o2.connect(ws); ws.connect(lp); lp.connect(growlG); growlG.connect(g);
    // clicking (teeth)
    const clickN = this.src(this.white, true);
    const cbp = ctx.createBiquadFilter(); cbp.type = 'bandpass'; cbp.frequency.value = 3200; cbp.Q.value = 4;
    const cg = ctx.createGain(); cg.gain.value = 0;
    const clfo = ctx.createOscillator(); clfo.type = 'square'; clfo.frequency.value = 11;
    const clg = ctx.createGain(); clg.gain.value = 0.12; clfo.connect(clg); clg.connect(cg.gain);
    clickN.connect(cbp); cbp.connect(cg); cg.connect(g);
    g.connect(p); this.out(p, 0.45);
    [n, lfo, o1, o2, trem, clickN, clfo].forEach((s) => s.start());
    this.mVoice = { p, g, nodes: [n, lfo, o1, o2, trem, clickN, clfo], growlG, o1, o2 };
  }
  stopMonsterVoice() {
    if (!this.mVoice) return;
    const v = this.mVoice; this.mVoice = null;
    v.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
    setTimeout(() => v.nodes.forEach((n) => { try { n.stop(); } catch {} }), 1500);
  }
  setMonster(x, z, level, chase) {
    if (!this.mVoice) return;
    const t = this.ctx.currentTime;
    this.setPos(this.mVoice.p, x, 2.2, z);
    this.mVoice.g.gain.setTargetAtTime(level, t, 0.3);
    const f = chase ? 58 : 46;
    this.mVoice.o1.frequency.setTargetAtTime(f, t, 0.5);
    this.mVoice.o2.frequency.setTargetAtTime(f * 1.075, t, 0.5);
  }
  screech(x, z, vol = 0.8) {
    const ctx = this.ctx, t = ctx.currentTime, dur = 1.6;
    const p = x == null ? null : this.panner(x, 2.2, z, 4, 1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.05); g.gain.setValueAtTime(vol, t + dur * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const ws = ctx.createWaveShaper(); ws.curve = this.hardCurve;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 0.8;
    for (let k = 0; k < 5; k++) {
      const o = ctx.createOscillator(); o.type = k % 2 ? 'sawtooth' : 'square';
      const f = rnd(380, 720);
      o.frequency.setValueAtTime(f * 0.7, t); o.frequency.exponentialRampToValueAtTime(f * 1.4, t + 0.25); o.frequency.exponentialRampToValueAtTime(f * 0.6, t + dur);
      const vib = ctx.createOscillator(); vib.frequency.value = rnd(25, 45);
      const vg = ctx.createGain(); vg.gain.value = rnd(20, 60); vib.connect(vg); vg.connect(o.frequency);
      o.connect(ws); o.start(t); vib.start(t); o.stop(t + dur); vib.stop(t + dur);
    }
    const n = this.src(this.white); const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1500;
    const ng = ctx.createGain(); ng.gain.value = 0.35; n.connect(hp); hp.connect(ng); ng.connect(g); n.start(t, 0, dur);
    ws.connect(bp); bp.connect(g);
    if (p) { g.connect(p); this.out(p, 0.6); } else this.out(g, 0.4);
  }
  // full-blast jumpscare scream
  scream() {
    this.playSample('scream', 1.6, 1.0);
    const ctx = this.ctx, t = ctx.currentTime, dur = 2.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.7, t + 0.015); g.gain.setValueAtTime(0.7, t + 1.5); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const ws = ctx.createWaveShaper(); ws.curve = this.hardCurve;
    for (let k = 0; k < 9; k++) {
      const o = ctx.createOscillator(); o.type = ['sawtooth', 'square', 'sawtooth'][k % 3];
      const f = rnd(220, 900);
      o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * rnd(1.3, 2), t + 0.35); o.frequency.exponentialRampToValueAtTime(f * 0.5, t + dur);
      const vib = ctx.createOscillator(); vib.frequency.value = rnd(30, 70);
      const vg = ctx.createGain(); vg.gain.value = rnd(30, 120); vib.connect(vg); vg.connect(o.frequency);
      o.connect(ws); o.start(t); vib.start(t); o.stop(t + dur); vib.stop(t + dur);
    }
    const n = this.src(this.white); const ng = ctx.createGain(); ng.gain.value = 0.5; n.connect(ng); ng.connect(g); n.start(t, 0, dur);
    const sub = ctx.createOscillator(); sub.frequency.setValueAtTime(70, t); sub.frequency.exponentialRampToValueAtTime(25, t + 1.2);
    const sg = ctx.createGain(); this.env(sg, t, 0.01, 1.2, 1.4); sub.connect(sg); sg.connect(this.master); sub.start(t); sub.stop(t + 1.6);
    ws.connect(g); this.out(g, 0.35);
  }
  // distant human scream (teammate taken)
  distantScream(x, z) {
    const ctx = this.ctx, t = ctx.currentTime, dur = 1.8;
    const p = this.panner(x, 1.6, z, 6, 0.6);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.6, t + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
    [1, 2.01, 3.02].forEach((h, k) => {
      const o = ctx.createOscillator(); o.type = k ? 'sine' : 'sawtooth';
      const f = 520 * h;
      o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f * 1.25, t + 0.3); o.frequency.exponentialRampToValueAtTime(f * 0.55, t + dur);
      const vib = ctx.createOscillator(); vib.frequency.value = 6; const vg = ctx.createGain(); vg.gain.value = 18 * h; vib.connect(vg); vg.connect(o.frequency);
      const og = ctx.createGain(); og.gain.value = 0.4 / (k + 1);
      o.connect(og); og.connect(lp); o.start(t); vib.start(t); o.stop(t + dur); vib.stop(t + dur);
    });
    lp.connect(g); g.connect(p); this.out(p, 1.2);
  }

  // ---------------- scare stingers ----------------
  stinger(vol = 0.6) {
    const ctx = this.ctx, t = ctx.currentTime;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 180;
    [220, 233.1, 246.9, 311.1, 329.6, 466.2, 493.9, 698.5, 739.9].forEach((f) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = rnd(-25, 25);
      o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f * 0.97, t + 3);
      const og = ctx.createGain(); og.gain.value = 0.12;
      const vib = ctx.createOscillator(); vib.frequency.value = rnd(5, 9); const vg = ctx.createGain(); vg.gain.value = 4; vib.connect(vg); vg.connect(o.frequency);
      o.connect(og); og.connect(hp); o.start(t); vib.start(t); o.stop(t + 3.3); vib.stop(t + 3.3);
    });
    const n = this.src(this.white); const nhp = ctx.createBiquadFilter(); nhp.type = 'highpass'; nhp.frequency.value = 3000;
    const ng = ctx.createGain(); this.env(ng, t, 0.005, 0.5, 0.5); n.connect(nhp); nhp.connect(ng); ng.connect(g); n.start(t, 0, 0.7);
    const sub = ctx.createOscillator(); sub.frequency.setValueAtTime(55, t); sub.frequency.exponentialRampToValueAtTime(28, t + 1);
    const sg = ctx.createGain(); this.env(sg, t, 0.01, vol * 1.3, 1.1); sub.connect(sg); sg.connect(this.master); sub.start(t); sub.stop(t + 1.3);
    hp.connect(g); this.out(g, 0.7);
  }
  whisper(pan = 0, vol = 0.3, dur = 1.8) {
    const ctx = this.ctx, t = ctx.currentTime;
    const sp = ctx.createStereoPanner(); sp.pan.value = pan;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.3); g.gain.setValueAtTime(vol, t + dur - 0.4); g.gain.linearRampToValueAtTime(0, t + dur);
    for (let v = 0; v < 2; v++) {
      const n = this.src(this.white);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 7;
      const bp2 = ctx.createBiquadFilter(); bp2.type = 'bandpass'; bp2.Q.value = 5;
      for (let k = 0; k < dur / 0.09; k++) {
        bp.frequency.setValueAtTime(rnd(900, 3200), t + k * 0.09);
        bp2.frequency.setValueAtTime(rnd(2500, 5000), t + k * 0.09);
      }
      const am = ctx.createGain(); am.gain.value = 0;
      for (let k = 0; k < dur / 0.07; k++) am.gain.setValueAtTime(Math.random() < 0.7 ? rnd(0.4, 1) : 0, t + k * 0.07);
      n.connect(bp); n.connect(bp2); bp.connect(am); bp2.connect(am); am.connect(g);
      n.start(t, rnd(0, 1), dur);
    }
    g.connect(sp); this.out(sp, 0.6);
  }
  bang(x, z, vol = 1) {
    const ctx = this.ctx, t = ctx.currentTime;
    const p = this.panner(x, 1.2, z, 4, 0.9);
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(75, t); o.frequency.exponentialRampToValueAtTime(28, t + 0.4);
    const og = ctx.createGain(); this.env(og, t, 0.003, vol * 1.4, 0.45);
    o.connect(og); og.connect(p); o.start(t); o.stop(t + 0.5);
    const n = this.src(this.white); const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    const ng = ctx.createGain(); this.env(ng, t, 0.002, vol, 0.3);
    n.connect(lp); lp.connect(ng); ng.connect(p); n.start(t, 0, 0.5);
    [1230, 1790, 2610].forEach((f) => {
      const n2 = this.src(this.white); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 30;
      const g2 = ctx.createGain(); this.env(g2, t, 0.002, vol * 0.9, 0.9);
      n2.connect(bp); bp.connect(g2); g2.connect(p); n2.start(t, 0, 1);
    });
    this.out(p, 1.0);
  }
  bell() {
    const ctx = this.ctx, t = ctx.currentTime;
    [1, 2.76, 5.4, 8.93, 0.5].forEach((h, k) => {
      const o = ctx.createOscillator(); o.frequency.value = 196 * h;
      const g = ctx.createGain(); this.env(g, t, 0.005, 0.25 / (k + 1), 4.5 / (k * 0.4 + 1));
      o.connect(g); this.out(g, 0.9); o.start(t); o.stop(t + 5);
    });
  }
  pickupBattery() {
    const ctx = this.ctx, t = ctx.currentTime;
    [880, 1320].forEach((f, k) => {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const g = ctx.createGain(); this.env(g, t + k * 0.08, 0.005, 0.12, 0.15);
      o.connect(g); g.connect(this.master); o.start(t + k * 0.08); o.stop(t + k * 0.08 + 0.25);
    });
  }
  buzz(dur = 0.6, vol = 0.12) {
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 120;
    const n = this.src(this.white); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3500;
    const g = ctx.createGain(); g.gain.value = 0;
    for (let k = 0; k < dur / 0.03; k++) g.gain.setValueAtTime(Math.random() < 0.5 ? vol : 0, t + k * 0.03);
    g.gain.setValueAtTime(0, t + dur);
    o.connect(g); n.connect(bp); bp.connect(g); this.out(g, 0.1);
    o.start(t); o.stop(t + dur + 0.05); n.start(t, 0, dur + 0.05);
  }
  glass(x, z) {
    const ctx = this.ctx, t = ctx.currentTime;
    const p = this.panner(x, 2.8, z, 3);
    const n = this.src(this.white); const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
    const g = ctx.createGain(); this.env(g, t, 0.002, 0.7, 0.25); n.connect(hp); hp.connect(g); g.connect(p); n.start(t, 0, 0.4);
    for (let k = 0; k < 7; k++) {
      const tt = t + rnd(0.05, 0.6);
      const o = ctx.createOscillator(); o.frequency.value = rnd(3000, 7000);
      const og = ctx.createGain(); this.env(og, tt, 0.002, 0.08, 0.12); o.connect(og); og.connect(p); o.start(tt); o.stop(tt + 0.2);
    }
    this.out(p, 0.6);
  }
  doorCreak(x, z) {
    const ctx = this.ctx, t = ctx.currentTime, dur = 2.2;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(140, t); o.frequency.linearRampToValueAtTime(90, t + dur);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 12; bp.frequency.setValueAtTime(600, t); bp.frequency.linearRampToValueAtTime(1300, t + dur);
    const am = ctx.createOscillator(); am.type = 'square'; am.frequency.setValueAtTime(18, t); am.frequency.linearRampToValueAtTime(8, t + dur);
    const amg = ctx.createGain(); amg.gain.value = 0.4;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.35, t + 0.3); g.gain.linearRampToValueAtTime(0, t + dur);
    am.connect(amg); amg.connect(g.gain);
    const p = this.panner(x, 1.2, z, 3);
    o.connect(bp); bp.connect(g); g.connect(p); this.out(p, 0.6);
    o.start(t); am.start(t); o.stop(t + dur); am.stop(t + dur);
  }
  rumble(vol = 0.8, dur = 4) {
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this.src(this.brown); const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 120;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.5); g.gain.linearRampToValueAtTime(0, t + dur);
    n.connect(lp); lp.connect(g); this.out(g, 0.5); n.start(t, 0, dur);
  }
  // low drone used on the death screen
  deathTone() {
    const ctx = this.ctx, t = ctx.currentTime;
    [36.7, 55, 58.3].forEach((f) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 200;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12, t + 1); g.gain.linearRampToValueAtTime(0, t + 6);
      o.connect(lp); lp.connect(g); this.out(g, 0.8); o.start(t); o.stop(t + 6.2);
    });
  }

  // ---------------- chase music ----------------
  setChase(on) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (on && !this.chase) {
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.55, t + 0.4);
      this.out(g, 0.2);
      const nodes = [];
      // pulsing bass
      const b = ctx.createOscillator(); b.type = 'sawtooth'; b.frequency.value = 55;
      const blp = ctx.createBiquadFilter(); blp.type = 'lowpass'; blp.frequency.value = 300;
      const bg = ctx.createGain(); bg.gain.value = 0;
      const pulse = ctx.createOscillator(); pulse.type = 'square'; pulse.frequency.value = 2.4;
      const pg = ctx.createGain(); pg.gain.value = 0.18; pulse.connect(pg); pg.connect(bg.gain);
      b.connect(blp); blp.connect(bg); bg.connect(g); nodes.push(b, pulse);
      // shrieking strings
      [880, 932.3, 987.8, 1046.5].forEach((f) => {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
        const tr = ctx.createOscillator(); tr.frequency.value = rnd(10, 14);
        const tg = ctx.createGain(); tg.gain.value = 0.012; const og = ctx.createGain(); og.gain.value = 0.012;
        tr.connect(tg); tg.connect(og.gain);
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.8;
        o.connect(bp); bp.connect(og); og.connect(g); nodes.push(o, tr);
      });
      nodes.forEach((n) => n.start());
      this.chase = { g, nodes };
      this.chaseDrum = setInterval(() => this.drum(), 420);
    } else if (!on && this.chase) {
      const c = this.chase; this.chase = null;
      clearInterval(this.chaseDrum);
      c.g.gain.cancelScheduledValues(t); c.g.gain.setTargetAtTime(0, t, 0.6);
      setTimeout(() => c.nodes.forEach((n) => { try { n.stop(); } catch {} }), 3500);
    }
  }
  drum() {
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(35, t + 0.15);
    const g = ctx.createGain(); this.env(g, t, 0.003, 0.5, 0.2); o.connect(g); this.out(g, 0.3); o.start(t); o.stop(t + 0.25);
  }
}
