# CHUDAIL BUSTERS: notes for Claude

Co-op multiplayer browser horror game (three.js client + Node/ws server, no build step).

- Start here: **`docs/HANDOFF.md`**: architecture, protocol, testing approach and status (3 floors,
  pentagram shrine finale and difficulty modes are merged into `main`).
- Run: `npm install && npm start` (http://localhost:3000). `npm run online` adds a Cloudflare tunnel link.
- Test without disturbing a live game: `PORT=3001 node server.js`; drive the page via `window.__hm`.
- `shared/map.js` runs on server AND client: keep it deterministic (only use the seeded `rng`).
- Never toggle a light's `.visible` at runtime (shader recompile stutter); change `.intensity`.
- Syntax check: `for f in server.js shared/map.js public/*.js; do node --check $f; done`
