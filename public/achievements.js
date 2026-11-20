// Achievements: earned in a game from what YOU did (the server's events), remembered in this browser.
const KEY = 'cb_achievements_v1';

export const ACHIEVEMENTS = [
  { id: 'first', name: 'First Night', desc: 'Escape Ashgrove.' },
  { id: 'ghost', name: 'Like a Ghost', desc: 'Escape without her ever chasing you.' },
  { id: 'nobell', name: 'No Bells Needed', desc: 'Escape without ringing a spirit bell.' },
  { id: 'lifeline', name: 'Lifeline', desc: 'Bring 3 friends back in one game.' },
  { id: 'medic', name: 'Not Today', desc: 'Bring a friend back.' },
  { id: 'ritual', name: 'Ritualist', desc: 'Place 3 items on the star yourself in one game.' },
  { id: 'bound', name: 'Exorcist', desc: 'Be alive when she is bound in the star.' },
  { id: 'speed', name: 'Speedrun', desc: 'Escape within 12 minutes of waking up.' },
  { id: 'hider', name: 'Hold Your Breath', desc: 'Hide while she is hunting you, and live.' },
  { id: 'solo', name: 'Lone Wolf', desc: 'Escape alone (a one-player game).' },
  { id: 'nightmare', name: 'Nightmare', desc: 'Escape on Nightmare.' },
  { id: 'taken', name: 'Taken', desc: 'Get taken by her. Everyone does.' },
  { id: 'allfour', name: 'Know Your Enemy', desc: 'Escape from all four of her: Chudail, Blind Bride, Shadow, Hungry One.' },
];
const byId = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));

function loadStore() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; } }
function saveStore(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} }
export function unlockedIds() { return new Set(Object.keys(loadStore().got || {})); }

// one run = one game, from your point of view
export function newRun({ myId, solo, difficulty, ghostType }) {
  return { myId, solo, difficulty, ghostType, t0: performance.now() / 1000, chased: false, bells: 0, revives: 0, placed: 0, hidT: -1, huntedWhileHidden: false, alive: true, escaped: false, bound: false, earned: [] };
}

// feed every server event; returns achievements earned right now (to show a toast)
export function track(run, m) {
  if (!run) return [];
  const me = run.myId, got = [];
  switch (m.e) {
    case 'chase': if (m.id === me) { run.chased = true; if (run.hidT >= 0) run.huntedWhileHidden = true; } break;
    case 'sniff': if (run.hidT >= 0) run.huntedWhileHidden = true; break;
    case 'bell': if (m.by === me) run.bells++; break;
    case 'revived': if (m.by === me) { run.revives++; got.push('medic'); if (run.revives >= 3) got.push('lifeline'); } break;
    case 'placed': if (m.by === me) { run.placed++; if (run.placed >= 3) got.push('ritual'); } break;
    case 'hide': if (m.id === me) run.hidT = performance.now() / 1000; break;
    case 'unhide': if (m.id === me) { if (run.huntedWhileHidden && run.alive) got.push('hider'); run.hidT = -1; run.huntedWhileHidden = false; } break;
    case 'bound': if (run.alive) got.push('bound'); break;
    case 'kill': if (m.id === me) { run.alive = false; got.push('taken'); } break;
    case 'escaped':
      if (m.id === me) {
        run.escaped = true; got.push('first');
        if (!run.chased) got.push('ghost');
        if (!run.bells) got.push('nobell');
        if (performance.now() / 1000 - run.t0 < 12 * 60) got.push('speed');
        if (run.solo) got.push('solo');
        if (run.difficulty === 'nightmare') got.push('nightmare');
        const st = loadStore(); st.beat = { ...(st.beat || {}), [run.ghostType]: true }; saveStore(st);
        if (['chudail', 'blind', 'shadow', 'hungry'].every((g) => st.beat[g])) got.push('allfour');
      }
      break;
  }
  return unlock(run, got);
}
function unlock(run, ids) {
  const st = loadStore(); st.got = st.got || {};
  const fresh = [];
  for (const id of ids) {
    if (run.earned.includes(id)) continue;
    run.earned.push(id);
    if (!st.got[id]) { st.got[id] = Date.now(); fresh.push(byId[id]); }
  }
  saveStore(st);
  return fresh;
}
export function runSummary(run) { return run ? run.earned.map((id) => byId[id]).filter(Boolean) : []; }
