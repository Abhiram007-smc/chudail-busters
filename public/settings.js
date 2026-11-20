// Settings: everything a player can change, saved in this browser (localStorage). Opened from the lobby and the
// pause screen. Key bindings live here too: the game asks held('sprint') / is(e, 'interact') instead of raw keys.
const KEY = 'cb_settings_v1';

export const ACTIONS = [
  ['forward', 'Move forward', 'KeyW'], ['back', 'Move back', 'KeyS'], ['left', 'Move left', 'KeyA'], ['right', 'Move right', 'KeyD'],
  ['sprint', 'Sprint', 'ShiftLeft'], ['crouch', 'Crouch', 'KeyC'], ['sneak', 'Sneak', 'ControlLeft'], ['jump', 'Jump', 'Space'],
  ['interact', 'Take / hide / read / revive', 'KeyE'], ['light', 'Flashlight', 'KeyF'], ['bell', 'Ring a spirit bell', 'KeyQ'],
  ['ping', 'Ping (mark a spot)', 'KeyG'], ['map', 'Read the blueprint', 'KeyM'], ['talk', 'Push to talk', 'KeyV'], ['mute', 'Mute / unmute your mic', 'KeyN'], ['reload', 'Use a battery from your backpack', 'KeyR'],
];
// fixed extra keys that always work as well (arrows, the right-hand modifiers)
const ALT = { forward: ['ArrowUp'], back: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], sprint: ['ShiftRight'], sneak: ['ControlRight', 'AltLeft'] };

// phones and tablets start on Low: their browsers have far less graphics memory (the page crashes otherwise)
const PHONE = typeof navigator !== 'undefined' && (/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)) ||
  (typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches));
const DEFAULTS = {
  sens: 1.2, invertY: false, volume: 0.9, voiceVolume: 1, voice: true, micMuted: false, pushToTalk: false, quality: PHONE ? 'low' : 'high', fov: 72, calm: false,
  keys: Object.fromEntries(ACTIONS.map(([a, , k]) => [a, k])),
};
export const SETTINGS = load();
function load() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch {}
  // older single settings
  try {
    if (s.sens == null && localStorage.getItem('hm_sens')) s.sens = +localStorage.getItem('hm_sens');
    if (s.volume == null && localStorage.getItem('hm_vol')) s.volume = +localStorage.getItem('hm_vol');
    if (s.calm == null && localStorage.getItem('cb_calm')) s.calm = localStorage.getItem('cb_calm') === '1';
  } catch {}
  return { ...DEFAULTS, ...s, keys: { ...DEFAULTS.keys, ...(s.keys || {}) } };
}
export function saveSettings() { try { localStorage.setItem(KEY, JSON.stringify(SETTINGS)); } catch {} }

export function is(e, action) { return e.code === SETTINGS.keys[action] || (ALT[action] || []).includes(e.code); }
export function makeHeld(keys) { return (action) => !!keys[SETTINGS.keys[action]] || (ALT[action] || []).some((c) => keys[c]); }
export function keyName(code) {
  if (!code) return '—';
  return code.replace(/^Key/, '').replace(/^Digit/, '').replace('ShiftLeft', 'Shift').replace('ShiftRight', 'R-Shift')
    .replace('ControlLeft', 'Ctrl').replace('ControlRight', 'R-Ctrl').replace('AltLeft', 'Alt').replace('Arrow', '');
}

// ---------------------------------------------------------------- the panel
let onChange = () => {};
export function initSettings(apply) {
  onChange = apply;
  const el = document.createElement('div'); el.id = 'settings';
  el.innerHTML = `<div class="sp">
    <div class="sh">SETTINGS <button class="sx" title="Close">✕</button></div>
    <div class="sg">
      <div class="sc"><div class="st">Controls</div>
        <label>Mouse sensitivity <input type="range" data-k="sens" min="0.3" max="3" step="0.05"><i></i></label>
        <label class="ck"><input type="checkbox" data-k="invertY"> Invert mouse (up/down)</label>
        <label>Field of view <input type="range" data-k="fov" min="60" max="95" step="1"><i></i></label>
      </div>
      <div class="sc"><div class="st">Sound</div>
        <label>Master volume <input type="range" data-k="volume" min="0" max="1.2" step="0.05"><i></i></label>
        <label class="ck"><input type="checkbox" data-k="voice"> Voice chat on (hear and talk to your friends)</label>
        <label class="ck"><input type="checkbox" data-k="micMuted"> Mute my microphone (key N)</label>
        <label class="ck"><input type="checkbox" data-k="pushToTalk"> Push to talk (otherwise your mic is always open)</label>
        <label>Voice volume <input type="range" data-k="voiceVolume" min="0" max="2" step="0.05"><i></i></label>
      </div>
      <div class="sc"><div class="st">Graphics</div>
        <label>Quality <select data-k="quality"><option value="low">Low (fastest)</option><option value="medium">Medium</option><option value="high">High</option></select></label>
        <label class="ck"><input type="checkbox" data-k="calm"> Reduce flashing (photosensitivity)</label>
      </div>
      <div class="sc keys"><div class="st">Keys <button class="sr">Reset</button></div><div class="kl"></div></div>
    </div></div>`;
  document.body.appendChild(el);
  const fmt = (k, v) => (k === 'fov' ? `${v}°` : k === 'sens' || k === 'volume' || k === 'voiceVolume' ? Number(v).toFixed(2) : '');
  el.querySelectorAll('[data-k]').forEach((inp) => {
    const k = inp.dataset.k;
    const sync = () => { if (inp.type === 'checkbox') inp.checked = !!SETTINGS[k]; else inp.value = SETTINGS[k]; const i = inp.parentElement.querySelector('i'); if (i) i.textContent = fmt(k, SETTINGS[k]); };
    sync(); inp._sync = sync;
    inp.addEventListener(inp.type === 'range' ? 'input' : 'change', () => {
      SETTINGS[k] = inp.type === 'checkbox' ? inp.checked : inp.type === 'range' ? +inp.value : inp.value;
      sync(); saveSettings(); onChange(k);
    });
  });
  const kl = el.querySelector('.kl');
  let waiting = null;
  const drawKeys = () => {
    kl.innerHTML = ACTIONS.map(([a, label]) => `<div class="kr"><span>${label}</span><button data-a="${a}">${waiting === a ? 'press a key…' : keyName(SETTINGS.keys[a])}</button></div>`).join('');
    kl.querySelectorAll('button').forEach((b) => (b.onclick = (ev) => { ev.stopPropagation(); waiting = b.dataset.a; drawKeys(); }));
  };
  drawKeys();
  addEventListener('keydown', (e) => {
    if (!waiting || !el.classList.contains('show')) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.code !== 'Escape') {
      for (const [a] of ACTIONS) if (a !== waiting && SETTINGS.keys[a] === e.code) SETTINGS.keys[a] = ''; // one key, one action
      SETTINGS.keys[waiting] = e.code; saveSettings(); onChange('keys');
    }
    waiting = null; drawKeys();
  }, true);
  el.querySelector('.sr').onclick = (ev) => { ev.stopPropagation(); SETTINGS.keys = { ...DEFAULTS.keys }; saveSettings(); drawKeys(); onChange('keys'); };
  el.querySelector('.sx').onclick = (ev) => { ev.stopPropagation(); closeSettings(); };
  el.addEventListener('click', (ev) => { ev.stopPropagation(); if (ev.target === el) closeSettings(); });
  el.addEventListener('mousedown', (ev) => ev.stopPropagation());
  el._refresh = () => { el.querySelectorAll('[data-k]').forEach((i) => i._sync && i._sync()); drawKeys(); };
}
export function openSettings() { const el = document.getElementById('settings'); el._refresh(); el.classList.add('show'); }
export function closeSettings() { document.getElementById('settings')?.classList.remove('show'); }
export function settingsOpen() { return !!document.getElementById('settings')?.classList.contains('show'); }
