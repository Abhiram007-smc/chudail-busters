// Phone / tablet controls: a move stick on the left, drag on the right half to look, and buttons. The buttons press
// the player's bound keys (settings.js), so every game rule that listens for keys works unchanged.
export const IS_TOUCH = typeof window !== 'undefined' && (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window) && !matchMedia('(pointer: fine)').matches;

export function initTouch({ keys, settings, look, onPause, active }) {
  const root = document.createElement('div'); root.id = 'touch';
  const B = [ // [action, label, hold?]
    ['interact', 'E', true], ['jump', '⤒', false], ['crouch', 'C', 'toggle'], ['light', '🔦', false],
    ['bell', '🔔', false], ['ping', '◆', false], ['map', '🗺', false], ['talk', '🎙', true], ['sprint', '»', 'toggle'],
  ];
  root.innerHTML = `<div class="tstick"><i></i></div><div class="tlook"></div><div class="tbtns">${B.map(([a, l]) => `<button data-a="${a}">${l}</button>`).join('')}</div><button class="tpause">❚❚</button>`;
  document.body.appendChild(root);
  const code = (a) => settings.keys[a];
  const press = (a, down) => {
    const c = code(a); if (!c) return;
    if (down === !!keys[c]) return;
    keys[c] = down;
    window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code: c }));
  };
  // buttons
  for (const b of root.querySelectorAll('.tbtns button')) {
    const [a, , mode] = B.find((x) => x[0] === b.dataset.a);
    b.addEventListener('touchstart', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (mode === 'toggle') { const on = !keys[code(a)]; press(a, on); b.classList.toggle('on', on); }
      else { press(a, true); b.classList.add('on'); if (!mode) setTimeout(() => { press(a, false); b.classList.remove('on'); }, 120); }
    }, { passive: false });
    b.addEventListener('touchend', (e) => { e.preventDefault(); if (mode === true) { press(a, false); b.classList.remove('on'); } }, { passive: false });
  }
  root.querySelector('.tpause').addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); onPause(); }, { passive: false });
  // move stick
  const stick = root.querySelector('.tstick'), knob = stick.querySelector('i');
  let sid = null, sx = 0, sy = 0;
  const setMove = (dx, dy) => {
    const r = 55, len = Math.hypot(dx, dy), k = len > r ? r / len : 1;
    knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    const nx = dx / r, ny = dy / r;
    press('forward', ny < -0.35); press('back', ny > 0.35); press('left', nx < -0.35); press('right', nx > 0.35);
  };
  stick.addEventListener('touchstart', (e) => { e.preventDefault(); const t = e.changedTouches[0]; sid = t.identifier; const r = stick.getBoundingClientRect(); sx = r.left + r.width / 2; sy = r.top + r.height / 2; setMove(t.clientX - sx, t.clientY - sy); }, { passive: false });
  // look: drag anywhere on the right half
  const lookEl = root.querySelector('.tlook');
  let lid = null, lx = 0, ly = 0;
  lookEl.addEventListener('touchstart', (e) => { e.preventDefault(); const t = e.changedTouches[0]; lid = t.identifier; lx = t.clientX; ly = t.clientY; }, { passive: false });
  addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === sid) setMove(t.clientX - sx, t.clientY - sy);
      if (t.identifier === lid) { look(t.clientX - lx, t.clientY - ly); lx = t.clientX; ly = t.clientY; }
    }
    if (active()) e.preventDefault();
  }, { passive: false });
  const end = (e) => { for (const t of e.changedTouches) { if (t.identifier === sid) { sid = null; setMove(0, 0); } if (t.identifier === lid) lid = null; } };
  addEventListener('touchend', end); addEventListener('touchcancel', end);
  return { show(on) { root.classList.toggle('show', !!on); if (!on) { setMove(0, 0); for (const [a] of B) press(a, false); root.querySelectorAll('.on').forEach((b) => b.classList.remove('on')); } } };
}
