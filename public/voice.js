// Voice chat. Every player sends their microphone straight to every other player (WebRTC, the game server only
// passes the connection messages along: {t:'rtc', to, data}). Every friend is heard at full volume wherever they are
// (any distance, any floor, alive or dead); a 3D panner keeps the direction they are in.
// The dead cannot talk to the living (but hear everyone). Talking loudly is noise SHE can hear ({t:'noise'}).
// Needs a secure page (https or localhost) for the microphone.
const ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];

export function createVoice({ audio, send, settings, myId }) {
  const peers = new Map(); // id -> { pc, el, src, gain, panner, level, analyser }
  let local = null, localLevel = 0, analyser = null, buf = null, loudT = 0, lastNoise = 0, ready = false, failed = '';

  async function start() {
    if (!settings.voice) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { failed = 'Voice chat needs the https link (or localhost).'; return; }
    try {
      local = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) { failed = 'No microphone (or permission denied): you can still hear the others.'; local = null; }
    if (local && audio.ctx) {
      analyser = audio.ctx.createAnalyser(); analyser.fftSize = 512; buf = new Float32Array(analyser.fftSize);
      audio.ctx.createMediaStreamSource(local).connect(analyser);
    }
    ready = true;
  }

  function makePeer(id) {
    if (peers.has(id)) return peers.get(id);
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const p = { pc, id, el: null, gain: null, panner: null, level: 0, makingOffer: false };
    peers.set(id, p);
    if (local) for (const tr of local.getAudioTracks()) pc.addTrack(tr, local);
    else pc.addTransceiver('audio', { direction: 'recvonly' });
    pc.onicecandidate = (e) => { if (e.candidate) send({ t: 'rtc', to: id, data: { ice: e.candidate } }); };
    pc.ontrack = (e) => {
      const stream = e.streams[0] || new MediaStream([e.track]);
      // Chrome only feeds a remote WebRTC stream into WebAudio while some media element plays it (muted)
      p.el = new Audio(); p.el.muted = true; p.el.srcObject = stream; p.el.play().catch(() => {});
      const ctx = audio.ctx; if (!ctx) return;
      const src = ctx.createMediaStreamSource(stream);
      p.gain = ctx.createGain(); p.panner = ctx.createPanner();
      p.panner.panningModel = 'HRTF'; p.panner.distanceModel = 'inverse'; p.panner.refDistance = 2; p.panner.maxDistance = 40; p.panner.rolloffFactor = 1.6;
      p.analyser = ctx.createAnalyser(); p.analyser.fftSize = 256; p.buf = new Float32Array(256);
      src.connect(p.analyser); src.connect(p.gain); p.gain.connect(p.panner); p.panner.connect(audio.master);
    };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') { try { pc.restartIce(); } catch {} } };
    return p;
  }

  // the lower id calls the higher one (so two players never call each other at once)
  async function call(id) {
    if (!ready || id === myId || peers.has(id) || myId > id) return;
    const p = makePeer(id);
    const offer = await p.pc.createOffer(); await p.pc.setLocalDescription(offer);
    send({ t: 'rtc', to: id, data: { sdp: p.pc.localDescription } });
  }
  async function onSignal(from, data) {
    if (!ready) await waitReady();
    const p = makePeer(from), pc = p.pc;
    try {
      if (data.sdp) {
        await pc.setRemoteDescription(data.sdp);
        if (data.sdp.type === 'offer') { await pc.setLocalDescription(await pc.createAnswer()); send({ t: 'rtc', to: from, data: { sdp: pc.localDescription } }); }
        for (const c of p.pendingIce || []) await pc.addIceCandidate(c).catch(() => {});
        p.pendingIce = [];
      } else if (data.ice) {
        if (!pc.remoteDescription) (p.pendingIce = p.pendingIce || []).push(data.ice);
        else await pc.addIceCandidate(data.ice).catch(() => {});
      }
    } catch (e) { console.warn('voice signal', e); }
  }
  function waitReady() { return new Promise((res) => { const k = setInterval(() => { if (ready) { clearInterval(k); res(); } }, 50); }); }

  function drop(id) { const p = peers.get(id); if (!p) return; try { p.pc.close(); } catch {} try { p.gain?.disconnect(); p.panner?.disconnect(); } catch {} if (p.el) p.el.srcObject = null; peers.delete(id); }
  function stop() { for (const id of [...peers.keys()]) drop(id); if (local) for (const t of local.getTracks()) t.stop(); local = null; ready = false; }

  const rms = (an, b) => { an.getFloatTimeDomainData(b); let s = 0; for (let k = 0; k < b.length; k += 2) s += b[k] * b[k]; return Math.sqrt(s / (b.length / 2)); };
  // every frame: where everyone's voice comes from, who may hear whom, push-to-talk, and loud talking
  function update(dt, { me, players, held, camL }) {
    if (local) {
      const open = settings.voice && !settings.micMuted && (!settings.pushToTalk || held('talk')); // the dead and the escaped talk too
      for (const t of local.getAudioTracks()) t.enabled = !!open;
      localLevel = analyser && open ? rms(analyser, buf) : 0;
      if (localLevel > 0.12 && me && me.alive) { loudT += dt; if (loudT > 0.35 && performance.now() - lastNoise > 1200) { lastNoise = performance.now(); send({ t: 'noise' }); } }
      else loudT = Math.max(0, loudT - dt);
    }
    const iAmDead = !me || me.alive === false || me.escaped;
    for (const [id, p] of peers) {
      if (!p.panner) continue;
      const r = players.get(id);
      if (!r) { p.gain.gain.value = 0; continue; }
      p.level = p.analyser ? rms(p.analyser, p.buf) : 0;
      const theyDead = !r.alive || r.escaped;
      let g = settings.voice ? settings.voiceVolume : 0;
      // everyone hears everyone: alive, dead or escaped (owner's call)
      // friends are always heard at full volume, however far away or on whatever floor (owner's call); the panner only
      // keeps the direction they are in
      p.panner.refDistance = 1000;
      p.gain.gain.setTargetAtTime(g, audio.ctx.currentTime, 0.08);
      audio.setPos(p.panner, r.x, (r.L || 0) * 3 + 1.6, r.z);
    }
  }
  return {
    start, call, onSignal, drop, stop, update,
    speaking: (id) => (id === myId ? localLevel > 0.05 : (peers.get(id)?.level || 0) > 0.04),
    status: () => failed || (local ? (settings.micMuted ? '🔇 MIC MUTED (N to unmute)' : settings.pushToTalk ? '🎙 hold V to talk (N mutes)' : '🎙 MIC ON (N to mute)') : ready ? 'Voice: listening only' : ''),
    peers,
  };
}
