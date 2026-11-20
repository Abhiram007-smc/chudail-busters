# CHUDAIL BUSTERS: developer handoff

This file is for the next developer (human or AI) picking up the project. Read it top to bottom before
touching code: it describes what exists, how it fits together, how to test it, and **exactly what is
left to do**.

---

## 1. What the game is

A co-op, first-person, browser horror game for 1–6 players plus hidden spectators.

- Players explore a procedurally generated asylum ("Ashgrove Sanatorium") at night with flashlights.
- A tall ghost, **the Chudail** (South Asian folklore: long black hair, feet pointing backwards), hunts them by
  **sound** (sprinting is loud, walking is quieter, crouch/sneak are silent) and **sight** (flashlight on = seen from far).
- A second creature, **the Crawler**, hangs from ceilings and drops on players who walk underneath.
- Win condition on `main` today: find 5 bone effigies → burn her heart in ROOM 41 (hold E) → escape through the foyer door.
- Win condition being built on `feature/multifloor-shrine`: find 5 ritual items → place them on a pentagram
  shrine in the basement → lure the Chudail into the pentagram centre → escape the house. See §7.

Live play: one person runs the server, everyone else opens a URL in Chrome/Edge/Firefox.

---

## 2. Run it

```bash
npm install
npm start            # http://localhost:3000, same Wi-Fi friends use the LAN URL printed in the terminal
npm run online       # also opens a Cloudflare quick tunnel and prints a worldwide https link
                     # (needs `cloudflared`: brew install cloudflared / winget install Cloudflare.cloudflared)
PORT=3001 node server.js   # second server for testing without disturbing a running game
```

No build step. Plain ES modules served by `server.js`. three.js is served from `node_modules/three` at `/vendor/three/`.

---

## 3. File map

| File | What it does |
| --- | --- |
| `server.js` | HTTP static server + WebSocket game server. Owns the authoritative state: lobby, players, items, monster AI, crawler AI, hiding, bells, revives, stage machine, spectators, Cloudflare tunnel (`--online`). Ticks at 20 Hz and broadcasts snapshots. |
| `shared/map.js` | **Deterministic** level generator used by BOTH server and browser (same seed ⇒ same map) + grid physics helpers (collision, line of sight, BFS pathfinding). |
| `public/index.html` | All UI (menu, lobby, character picker, HUD, briefing, note reader, death/end screens) + CSS. Fonts from Google Fonts. |
| `public/main.js` | Game client: networking, player controller (walk/sprint/sneak/crouch, stamina, flashlight battery), interaction prompts, hiding view, notes, scares director, jumpscare, spectating, hidden-spectator drone, light pool, post-processing shader, adaptive resolution, snapshot interpolation. |
| `public/world.js` | Builds the 3D asylum from map data: merged wall/floor/ceiling geometry, doorways, props (beds, lockers, wardrobes, morgue slabs…), bulbs, decals, notes, items, bells, aatma candles, ROOM 41 heart altar, exit door. Has `mergeStatic()` and distance culling (`updateCull`). |
| `public/entities.js` | The Chudail (Blender GLB rig + procedural head/hair/eyes/gown, bone-driven animation), the Crawler, player avatars (downloaded animated characters, procedural crouch + flashlight arm), x-ray teammate outlines, character roster `CHARACTERS`. |
| `public/textures.js` | Every texture is painted on a canvas at runtime (wallpaper, floors, blood, signs, notes, jumpscare face, sigils). No image files except character portraits. |
| `public/audio.js` | All audio is synthesized with Web Audio (ambience, footsteps per surface, heartbeat, monster voice, stingers, whispers, bells, chase music) except `public/sounds/scream.mp3`. |
| `blender/build_characters.py` | Headless Blender script that builds and exports `public/models/hollow.glb` (the Chudail body) and `survivor.glb` (fallback avatar). |
| `public/models/*.glb` | Player characters (Quaternius, CC0 / one CC-BY) + monster. |

---

## 4. Network protocol (WebSocket JSON)

Client → server:
- `{t:'join', name, char}` or `{t:'join', spectator:true}`
- `{t:'start'}` (lobby only), `{t:'char', char}`
- `{t:'s', x, z, yaw, pitch, fl, cr, sp, sn, mv}` player state at 15 Hz (fl=flashlight, cr=crouch, sp=sprint, sn=sneak, mv=moving)
- `{t:'pickup', id}` items: `t*` effigy/ritual item, `b*` battery, `w*` spirit bell, `r*` aatma candle
- `{t:'hide', id}` / `{t:'unhide'}`, `{t:'bell'}`, `{t:'revive', id}`, `{t:'note', id}`
- `{t:'burnStart'}` / `{t:'burn'}` (ROOM 41 heart, main branch), `{t:'escape'}`

Server → client:
- `welcome`, `lobby` (players, publicUrl), `full`, `start` (seed + state), `end`
- `snap` 20 Hz: `p: [[id,x,z,yaw,pitch,fl,cr,alive,escaped,mv,sp,hid,sn],…]`, `m: [x,z,yaw,state,target,speed,lit,lunge]`, `c: crawler [x,z,yaw,state,target]|null`
- `ev` events: `pickup, chase, kill, escaped, scare, joined, left, hide, unhide, hideFull, sniff, bell, stage, burnStart, crawlerDrop, revived, note`

Clients render remote things 130 ms in the past and interpolate (`INTERP_MS` in main.js).

---

## 5. Key systems (main branch)

- **Monster AI** (`updateMonster` in server.js): states `dormant → wander/hunt/chase/sniff/feed/stunned`.
  Perception: sight range depends on flashlight/crouch; crouched + light off is nearly invisible; hearing radius
  17 sprinting / 6 walking / 0 crouch or sneak. Speed ramps with effigies collected. Kills only while chasing.
  Hiding: she only knows you hid if she watched you get in from < 6 m; then she sniffs 3 s and opens it 60 % of the time.
- **Crawler** (`updateCrawler`): `gone → ceiling → drop → crawl → retreat`. Active after the first effigy.
- **Lighting:** one shadow-casting flashlight, a pool of 6 point lights reassigned to the nearest bulbs/candles,
  the Chudail carries a cold PointLight. Never toggle `light.visible` at runtime (changes the light count ⇒
  shader recompiles ⇒ stutter); set `intensity` instead.
- **Performance:** static props merged per material (`mergeStatic`), distance culling every 0.25 s, adaptive
  pixel ratio with a "did it help?" check (some displays cap at 30 Hz), shader warm-up on the loading screen (`warmUp`).
- **Hidden spectators:** join with `spectator:true`; server keeps them in a separate set; players never see them.

---

## 6. Testing approach that works

- Start a second server on port 3001 (`PORT=3001 node server.js`) so a live game on 3000 is untouched.
- Drive the browser game through `window.__hm` (exposes `S` state, `audio`, `renderer`, `keys`).
  e.g. teleport: `__hm.S.me.x = …`, read `__hm.S.mon.state`, `__hm.renderer.info.render.calls`.
- Write tiny Node bots with `ws` that join, send `{t:'s',…}` positions and log events (server trusts client
  positions, so bots can teleport). This is how hiding/drag-out, bells, crawler and finale were verified.
- Syntax check everything: `for f in server.js shared/map.js public/*.js; do node --check $f; done`

---

## 7. Multi-floor house + shrine finale + difficulty (merged into `main`)

Goal requested by the owner:
1. **Bigger house with multiple floors**: basement, ground floor, upper floor, connected by staircases.
2. **New finale: a black-magic pentagram shrine** in the basement that looks *very* scary. Players find 5 ritual
   items (Human Skull, Black Candle, Cracked Mirror, Cursed Doll, Braid of Her Hair), carry them to the shrine and
   place one on each point of the star. When all 5 are placed the star blazes; players must **lure the Chudail
   into the centre** (get her to chase someone through it). She is bound/burns, the front door opens, players escape.
   This replaces the ROOM 41 heart.
3. **Difficulty modes** chosen in the lobby before Begin: Easy / Normal / Hard / Nightmare.

### 7.1 DONE on the branch: `shared/map.js` rewritten (tested, deterministic)

New exports and semantics (everything is now **per level** `L ∈ {-1, 0, 1}` = basement, ground, upper):

- Constants: `CELL=3, WALL_H=3, FLOOR_H=3, GRID=39, LEVELS, LEVEL_NAMES, TALISMANS=5, ITEM_KINDS, DIFFICULTY`.
  `DIFFICULTY[key] = {label, speed, sight, hearing, crawler, items, revive}` multipliers (easy/normal/hard/nightmare).
- `map.grid[L]` is a `Uint8Array(W*H)` with cell types: `0` wall, `1` room, `2` corridor, `3` **stair ramp**
  (on the lower level), `4` **stairwell hole** (same cells on the upper level; treated as wall).
- `map.stairs = [{L, c0, c1, c2, c3, d}]`: a stair goes up from level `L` to `L+1`. `c1,c2` are the ramp cells on
  level `L` (type 3) and holes on `L+1` (type 4). `c3` is the landing on `L+1`; on level `L` it is a wall. `d` is
  the direction of travel upwards. 2 stairs ground↔upper, 2 basement↔ground.
- Every object list carries `L`: `rooms, talismans (ritual items, with kind/name), batteries, bells, souls (aatma
  candles), notes, hides, props, doors, bulbs, writings, blood`. `monsterSpawn {x,z,L}`, `exit {x,z,L:0}`,
  `spawns` (ground floor foyer).
- `map.shrine = {x, z, L:-1, room, r:5.4, center:1.5, points:[5 × {x,z}]}`: centre and star points of the
  pentagram (basement room type `'shrine'`, 9×9 cells, kept clear of props).
- Rooms have `label`, `wing`, `floor` (e.g. "WARD B", "east wing", "upper floor"). Clue notes now name the item
  and floor: `about: "Human Skull: WARD B, upper floor, east wing"`.
- Helpers (signatures CHANGED, all take `L`):
  - `cellType(map, L, i, j)`, `isWall(map, L, i, j)` (0 and 4 are walls)
  - `resolveCircle(map, L, x, z, r)`, `lineOfSight(map, L, x0, z0, x1, z1)`
  - `heightAt(map, L, x, z)`: floor height incl. stair ramps (`L*FLOOR_H` + ramp)
  - `stairTransition(map, L, x, z)` → `[newL, x, z]` or `null`. Call it **after** moving/colliding: when an entity
    is pressed against the top of a ramp it moves to `L+1` (0.45 m into the landing); when pressed against the
    hole from the landing it moves down to `L` (0.55 m onto the ramp). The hysteresis prevents ping-pong.
  - `bfsDist3(map, L, i, j)` (Int32Array, index `(L+1)*W*H + j*W + i`), `bfsPath3(map, L0,i0,j0, L1,i1,j1)` →
    `[[L,i,j],…]` crossing stairs.
  - removed: old `bfsDist`, `bfsPath`, single-level `isWall/lineOfSight/resolveCircle` signatures.

Quick verification snippet (passes):
```bash
node -e "import('./shared/map.js').then(m=>{const x=m.generateMap(5);console.log(x.stairs.length, x.talismans.map(t=>t.kind+'@'+t.L));const s=x.stairs[0];const[dx,dz]=s.d;const bx=(s.c2[0]+.5)*3+dx*1.5,bz=(s.c2[1]+.5)*3+dz*1.5;console.log(m.stairTransition(x,s.L,bx-dx*.35,bz-dz*.35))})"
```

### 7.2 DONE, server.js (verified with a bot on Hard: monster crossed floors 1→0→-1, 5 items placed, lure → bound → escape → win)

Implemented as specified below (`followPath`/`moveEntity` helpers handle multi-floor steering + `stairTransition`).
Snapshot rows now end with `L` (players index 13, monster index 8, crawler index 5). New events: `drop`, `placed`,
`bound`, `stage:'lure'|'escape'`. New messages: `{t:'place', slot}`, `{t:'difficulty', key}`. `start` includes
`difficulty, placed, progress, moved` and per-player `items, L`.

Original spec, kept for reference:

1. Imports: replace `bfsPath` with `bfsPath3`, add `stairTransition, heightAt, DIFFICULTY, ITEM_KINDS`.
2. Players get `L` (spawn `L=0`). `{t:'s'}` must carry `L`; store it. Add `L` to the snapshot row (append at the end
   so indices stay: `[…, sn, L]`). Monster row append `m.L`; crawler row append `c.L`.
3. `randomFloorNear(cx, cz, minC, maxC)` → add `L` param and use `isWall(map, L, …)`.
4. `updateMonster`: give `m.L` (from `monsterSpawn.L`). Perception/hearing/lit/kill only for players with
   `p.L === m.L`. All `lineOfSight`/`resolveCircle`/`clearPath` calls take `m.L`. Pathing: `bfsPath3(map, m.L,
   cellOf(m.x), cellOf(m.z), goal.L, gi, gj)`; goals become `{x, z, L}`. When following the path, if the next
   waypoint is on another level, keep steering at that waypoint's x/z (it is the stair landing/ramp end). After
   moving call `stairTransition(map, m.L, m.x, m.z)` and apply. The "skip ahead" LOS optimisation must only look
   at waypoints with `wp[0] === m.L`. Teleport-closer logic: pick a spot on the target player's level.
5. `updateCrawler`: same treatment (`c.L`, only targets on its level, call `stairTransition` after moving).
6. Hiding/notes/items/bells/revives: validate `p.L === item.L` in addition to distance.
7. **Inventory + shrine stage machine** (replace effigy/heart logic):
   - `game.stage`: `'items' → 'lure' → 'escape'`.
   - Picking up a `t*` item: push its id to `p.items` (do not auto-count). Broadcast pickup with `items`.
   - On death (`killPlayer`, crawler kill): drop carried items at the body (`item.taken=false`, set x/z/L to the
     body, broadcast `ev:'drop'`), so others can pick them up.
   - New message `{t:'place', slot}`: player alive, `p.L === -1`, within 1.8 m of `shrine.points[slot]`, slot empty,
     player carries ≥1 item → move one item from `p.items` to `game.placed[slot]`. Broadcast `ev:'placed'`.
     When all 5 slots are filled → `stage='lure'`, broadcast `ev:'stage'`. Monster becomes enraged
     (speed bonus) and in `wander` biases 60 % of goals to random floor near the shrine (`L=-1`).
   - Each tick in `'lure'`: if `m.L === -1` and `hypot(m.x - shrine.x, m.z - shrine.z) < shrine.center` →
     `stage='escape'`, `game.exitOpen=true`, monster `state='bound'` permanently (speed 0, no kill, no perception),
     crawler `'gone'` forever, broadcast `ev:'bound'`.
   - `escape` msg unchanged (ground floor exit, `p.L === 0`).
   - `startMsg` must include `stage`, `placed`, `taken`, and each player's `items`.
8. **Difficulty**: lobby message `{t:'difficulty', key}` (any player, lobby only) stores `game.difficulty`;
   include it in `lobbyMsg`/`startMsg`. Apply multipliers: monster speeds × `speed`, sight ranges × `sight`,
   hearing radii × `hearing`, crawler disabled if `!crawler`. Optionally scale spawned batteries/bells/candles by
   `items`/`revive` by filtering map lists deterministically (e.g. keep the first `round(n*mult)` ids) on BOTH
   server and client (send the kept ids in `startMsg`).

### 7.3 DONE, public/world.js (levels in `world.levelGroups[L]`, stairs with steps + handrails, ritual item models via `world.makeItem(kind)`, the shrine with `setPlaced/setActive/bind`, colliders carry `L` as 5th element)

Original spec:

1. Build every level: loop `LEVELS`, offset all geometry by `y = L*FLOOR_H`. Skip floor quads for type-4 cells
   (stairwell holes) and ceiling quads for type-3 cells (ramps). Walls: build walls where a walkable cell (1,2,3)
   borders a wall cell (0) **or a type-4 hole on the same level** (railing walls around the hole on the upper floor
   are not needed because the hole sides are walls by construction; but the hole's open edge facing `c3` must NOT
   get a wall).
2. Stair geometry: for each stair, a ramp mesh of ~12 steps from `L*FLOOR_H` to `(L+1)*FLOOR_H` across `c1,c2`,
   plus side walls already provided by the grid. Use dark wood + a metal handrail.
3. Put each level's meshes in its own `THREE.Group` (`world.levelGroups[L]`) so the client can show only the
   current level (+ neighbour while near a stair). Everything with `L` (props, bulbs, notes, items…) goes into the
   matching group at the right height.
4. Light sources get `y += L*FLOOR_H` and an `L` field; the client's light pool must only pick sources on the
   camera's level.
5. **The shrine** (basement room `map.shrine`), make it horrifying:
   - Pentagram carved into the floor: canvas texture (add `pentagramCanvas()` in textures.js) with deep red
     emissive lines, outer double circle with runes, dried blood pools, salt lines; emissive intensity animates.
   - 5 stone plinths at `shrine.points` with an engraved glyph per item; empty plinths have a dim ember.
   - Centre: a dark pit/ring of black candles; when all 5 are placed a column of red light + rising embers.
   - Dressing: goat-skull altar on the north wall, piles of skulls, hanging ropes with sack-covered bodies,
     chains from the ceiling, dolls nailed to walls, wall writing "BRING HER TO THE STAR", red flickering candles,
     smeared handprints. Use existing helpers (`box`, `cyl`, decal materials, `TX.writingCanvas`, glow sprites).
   - Expose `world.shrine.setPlaced(slot, kind)`, `world.shrine.setActive()`, `world.shrine.bind()` (big flash,
     fire, monster sinks) for the client to call on events.
6. Ritual item meshes by `kind`: skull (sphere + jaw + dark eye sockets), black candle (black cylinder + flame
   sprite), cracked mirror (frame + reflective plane `metalness:1, roughness:0.05`), cursed doll (existing `doll`
   builder, bigger, with pins), braid of hair (twisted dark `TubeGeometry`). Same look on the floor, carried, and
   on the plinth.
7. Remove the ROOM 41 heart (`world.heart`) and exit sigil runes text that mention bones if needed.

### 7.4 DONE, public/main.js (player `L`, `heightAt` camera, `stairTransition`, per-floor interactions, light pool + remote flashlights per floor, `updateLevels()` floor visibility, carry/place/drop/bound events, objectives + briefing, lobby difficulty buttons, floor tag in HUD)

Original spec:

1. Player state gets `L` (start 0) and uses `heightAt(map, L, x, z)` for camera height (+eye). After
   `resolveCircle(map, L, …)` call `stairTransition` and apply. Send `L` in `{t:'s'}`.
2. Every `isWall/lineOfSight/resolveCircle` call now passes `L` (scares, fear, findSpotAhead, spectator…).
3. Remote avatars, monster and crawler: read `L` from snapshots, set `position.y = heightAt(...)`
   (crawler ceiling = `L*FLOOR_H + WALL_H`). Remote flashlight intensity 0 when on another level than the camera.
4. Level visibility: every 0.25 s show `world.levelGroups[camL]`, plus the adjacent level if the camera is within
   ~5 m of a stair; hide others. Spectator drone above the roof: show all.
5. Interactions only for objects with `obj.L === me.L`. New prompts: "Take the human skull", at the shrine
   "Place the {item} on the star" (send `{t:'place', slot}` for the nearest empty slot), centre hint during `lure`.
6. HUD: floor indicator (BASEMENT / GROUND FLOOR / UPPER FLOOR), carried items list, objectives checklist:
   ☐ Find the 5 ritual items (found n/5) ☐ Fill the pentagram in the basement (n/5)
   ☐ Lure the Chudail into the centre of the star ☐ Escape through the front door.
   Update the start briefing text accordingly.
7. Events: `placed` (sound + `world.shrine.setPlaced`), `stage:'lure'` (rumble, red lights, message
   "THE STAR IS AWAKE. BRING HER TO IT."), `bound` (scream, flash, `world.shrine.bind()`, "SHE IS BOUND. GET OUT!"),
   `drop` (show item at body).
8. Lobby: difficulty selector (4 buttons) visible to all; send `{t:'difficulty', key}`; show current difficulty.

### 7.5 Status of acceptance checks

Verified:
- Server end-to-end with a bot (`hard`): monster crossed floors 1→0→-1, 5 items placed, lure → bound → escape → win.
- In the browser (port 3002 WIP server): walking up a staircase smoothly raises the camera 0→3 m and switches to the
  upper floor; walking back down returns to the ground floor; floor tag updates; basement shrine renders (glowing
  pentagram, plinths, candles, chains); picking up an item and placing it on a star point works (plinth shows the
  item, star icon lights, messages); difficulty chosen in the lobby reaches the game; 60 FPS.

- Lure rule (fixed after testing): players standing inside the burning star cannot be killed, and while she chases
  someone inside it she is dragged to the centre (`inStar` in the monster steering, server.js). Bot tests standing at the
  centre and at the edge both end `bound → escape → END win=true`.
- In the browser: all 5 items picked up and placed with the real controls, stage `lure` + active shrine (red column, 5
  stars lit); death switches to spectating a teammate (briefing overlay now hidden).

Still worth a human playthrough (not blocking):
- The `bound` cinematic (monster sinking, flash) seen from inside the star.
- Dropped items (`drop` event) appearing at a dead player's body on the right floor.
- Crawler on upper/basement floors; spectator drone above the roof (all floors visible).

Original checklist:

- A bot can walk from the foyer up a staircase (L 0→1) and down to the basement (L 0→-1) using only
  `{t:'s'}` updates driven by `bfsPath3` + `stairTransition` (write `bot` in a scratch file).
- Monster follows a player across floors (log `m.L` changes).
- Place 5 items → stage `lure`; teleport monster to shrine centre (or bait it) → `bound` → exit opens → escape → `end win`.
- No console errors; 60 FPS on a normal laptop with only one level visible.
- README updated (how to win, difficulty, floors). Push branch, then merge to `main` when it works.

---

## 7b. Scares, ghost look, hidden clues, loading screen (branch `feature/scarier`, merged)

- Screen fx in `public/main.js` (top): `fxFlash(color, peak, ms)`, `fxGlitch(ms)` (CSS filter/skew on the canvas),
  `fxFace(ms, opacity)` (one frame of the jumpscare face). `FX.calm` (lobby checkbox "Reduce flashing", localStorage
  `cb_calm`) softens all of them. `S.torchCtl = {until, k}` overrides the flashlight multiplier (used by scares).
- New scares in `runScare`: `approach` (lights + torch die; on each torch flicker the ghost is closer: 9, 6.5, 4, 2.2 m, then
  1 m with scream + white flash), `behind` (ghost 1.3 m behind you; turning to face her triggers the hit), `subliminal`,
  and a 3-cut `faceflash`. The death jumpscare adds white/red strobes. Test hook: `window.__hm.runScare(type)`.
- Ghost (`upgradeMonster` in `public/entities.js`): ~50 hair strand ribbons on a pivot that is counter-rotated every frame
  so the hair hangs straight down when her head twitches (`strands.pivot`), a fresnel rim light via `addRim()`
  (`onBeforeCompile`), smaller flaring eye glows, black smoke sprites, and a random "skipped frame" glitch.
- Clues (`shared/map.js`): `CLUE_TEMPLATES` + `RIDDLES[roomType]` + `FLOOR_HINTS`; notes carry `sigil: kind`. Sigil
  wall marks are extra `writings` entries with `sigil` (by each door of the item's room, corridor side, and on the wall
  nearest the item). `TX.sigilCanvas(kind, 'wall'|'ink')` draws them. Items lost their halo and strong light; one
  guttering candle and a faint 0.9-intensity glow remain. The client whispers (panned toward the item) within 6.5 m.
- Loading screen (`#loading`, `startLoadingFx()` in main.js): min ~4.2 s, typed creepy lines, heartbeat, a subliminal
  face, ends with a red flash + door slam.

## 7b2. She crawls on walls and the ceiling

- Server (`updateMonster`, "climbing"): `m.crawl` 0 floor, 1 ceiling, 2 left wall, 3 right wall; random episodes in
  wander/hunt (5-11 s) and often when a chase starts (2.5-4.5 s). Never on stair ramps. Within 2.6 m of the chased
  player she drops (`ev mdrop`, 0.4 s stall); she cannot kill while climbing. Snapshot monster row index 9 = crawl.
- Client: `updateMonster` finds the wall on that side (falls back to the ceiling for the rest of that climb when
  there is none, e.g. doorways) and calls `monster.userData.setCrawl(mode, wallDist, WALL_H)`. In `upgradeMonster`
  the model sits under `flip` (surface rotation/offset) and `P` (body laid flat), blended over ~0.5 s, with the
  Crawler's spider-limb pose. Footsteps become `audio.skitter` while climbing.

## 7b3. Intro cut scene (snowy road, truck, wake up in the house)

- `blender/build_intro.py` builds the whole outside scene by script (road along `cx(y)`, terrain, guard rail, pines,
  Poly Haven street lamps + textures fetched by `blender/fetch_assets.py` into gitignored `blender/assets/`, car,
  truck, Geometry-Nodes snow, 3 cameras on timeline markers). Shots A (wide), B (roadside pass-by), C (chase, lamps
  dying) = frames 1-390 at 24 fps, rendered to PNG then `blender/encode_intro.py` -> `public/video/intro.mp4`.
  With `--export` it also writes `public/models/intro_car.glb` (7-seater interior, empties `seat_0..5`, wiper pivots)
  and `intro_truck.glb`.
  Rebuild: `python3 blender/fetch_assets.py`; `Blender -b --factory-startup --python blender/build_intro.py -- /tmp/intro.blend --export`;
  `Blender -b /tmp/intro.blend -a` (frames go next to the .blend in `intro_frames/`); then encode.
- `public/intro.js`: `preloadIntro()` (video as a blob + the two GLBs) and `playIntro()` (video, then a live three.js
  scene inside the car with every player's character from `createSeatedCharacter()` in entities.js; truck, horn,
  screech, crash, black + ringing). Hold Space / Esc skips. `main.js` runs it from `buildGame` only when the start
  message has `intro: true` (server: first 4 s of a game, not spectators); while it runs `frame()` hands over to
  `S.intro.frame(dt)`. Afterwards `enterHouse(m, true)`: you start lying down (`me.eye` 0.3, `#eyes` blink, blur)
  and get up when you click in. The server keeps her dormant `18 + INTRO_S` (30) seconds.

Intro v2 (public/intro.js): the car, its occupants and lights live in a `rig` group that swerves/skids/gets shoved;
the world streams past. Co-op dialogue `SCRIPT` (holiday plan, player names via `{n0}`) is shown in `.isub`; the
line marked `dark` starts the lamps dying (since 7e the friends are SILENT: no speechSynthesis, subtitles only, at
reading speed); after the last line `setTruck()` starts the truck sequence `TR`
(horn, beams, swerve, outside slow-mo at `SLOWMO`, impact -> glass burst -> white). Driver: `createSeatedCharacter`
`update(..., { driver, steer })` puts both hands on the wheel. Lamp hum/crackle: `snd.lamp(level)` per frame,
`snd.flicker()/pop()` on the video's timeline. Solo players get no dialogue. Server `INTRO_S` = 65.

After the crash (intro v3): `blender/build_drag.py` renders `public/video/drag.mp4` (300 frames, 12.5 s: E1 she
walks out of the wreck's glow and leans over you; E2 POV dragged by the ankle to the house at HOUSE_Y; E3 up the
porch steps into the black doorway). It imports `public/models/hollow.glb` and builds her head, hair strands and gown
in Blender. Fog is a volume BOX there (a world volume blacked the whole scene out). `intro.js` `startDrag()` plays it
after the white flash (`INTRO.dragAfter`), with cues (crunch, scrape, thud, creak, slam); Space/Esc -> `skipAll()`.
Horn = `public/sounds/car_horn.mp3` (CC0) via `snd.hornSample()`; synth only if it fails to load. Server INTRO_S 80.

## 7e. Furniture collision, real footsteps, scarier ghost, Range Rover intro car, silent friends

- **Nobody walks through furniture.** `shared/map.js` `staticColliders(map)` (doorway pillars, every prop except dolls,
  shrine plinths + altar, same boxes `world.js` builds) and `resolveSolid(map, L, x, z, r)` (walls + those boxes).
  The server's `moveEntity` (ghost and crawler) now uses `resolveSolid`; before, she walked through lockers,
  wardrobes and beds. Client: when she climbs a wall (`crawl` 2/3) and a locker/wardrobe stands against that wall
  within 1.6 m (`furnitureAlongWall` in main.js), she takes the ceiling instead of sinking into it.
- **Footsteps** are real recordings: `public/sounds/steps/wood01-03.m4a` (CC0, TinyWorlds) and, since the stone one was
  disliked, `tile0-8.m4a` (CC-BY 3.0, congusbongus/OpenGameArt; never the same take twice in a row)
  (mono AAC, loudness-normalised, so Safari/iOS decode them). `audio.loadSteps()` (called with the scream sample);
  `footstep()` plays a tile take on the chequered tiles (`surface === 'tile'`) and a wood take elsewhere, with small
  pitch/volume variation; the synthesised step is only a fallback (its tile hiss was the "bad tile sound").
  `audio.floorCreak()` (renamed so it does not override the ambient `creak(x, y, z)`).
- **Scarier ghost.**
  - Face reveal: `addFaceHorror(head)` in entities.js (gaping black mouth with needle teeth and a red glow, black
    tears). `root.userData.reveal` (set in main.js: chasing you within 7 m, staring, or sniffing within 4 m) parts
    the six front hair strands to the sides and drops the jaw (shudders while chasing).
  - The stare (server): in wander/hunt, if a player farther than 9 m sees her and is looking at her (dot > 0.9),
    50% chance she stops (`state 'stare'`, 1.8-3.2 s, at most every 25-45 s), turns to face them, head lolled over
    (`stare` pose). Then 55% she charges (`ev chase` with `charge: true`: flash, glitch, big shake) or she is gone
    (`ev vanish`: static burst, lights cut 0.35 s, teleported 6-12 cells from that player out of everyone's sight).
    If the player comes within 6 m she charges. Client: `ev stare` -> `audio.stareDrone()` + slow zoom to 54 deg FOV.
- **Intro car = Range Rover** (CC-BY 3.0 "Range Rover" by IvOfficial, poly.pizza; `blender/fetch_assets.py` fetches
  it to `blender/assets/car/range_rover.glb`). `build_intro.py` (`USE_RR`) imports it, rotates (its front is -Y),
  scales to a 2.9 m wheelbase, drops its own seats and still wipers, makes its glass our see-through `glass` and its
  panels double-sided (otherwise the roof vanishes from inside). Our interior is lifted `IZ = 0.22` onto its floor;
  seats re-placed (front on the floor, bench of three on its rear-seat base, last row in the boot) with roof clearance
  checked by ray casts (inside roof ~2.0 m). Seat backs now lean back (they leaned forward before). Without the GLB
  the old primitive SUV is still built. `intro.js` reads the lift from `seat_0` and finds the headlamps by name.
  Test hook: `window.__hm.introLive = { scene, rig, cam, car, people }`.
- **Seated legs no longer go through the car floor.** Most characters (Quaternius rigs) keep `FootL/FootR` on IK
  bones parented to the root, so the shins stretched down to the road whatever the knees did.
  `createSeatedCharacter(key, seed, { knees })` now poses both legs by hand from the standing pose (thighs forward
  and `knees` rad up, shins hanging) and pins each IK foot to the end of its shin every frame. Seated characters are
  1.64 m. `intro.js` gives the boot seat (5) `knees: 0.75`. Checked by measuring each person's bounding box in the
  rig: feet 0.68-0.85 (floors 0.64-0.93), heads <= 2.0 (inside roof ~2.0).
- Dialogue is silent (user request): no speechSynthesis at all.
- Tested with a headless bot on a separate port that keeps 10-14 m from her, looking at her, and breaks line of sight
  after each chase so the stare can trigger (bots only ever on test ports, never the live 3000).

## 7f. Live drag scene, wake-up line + objectives, driving-away ending, direction signs, jump

- **Drag scene is live** (`public/drag.js` `buildDrag`, replaces `video/drag.mp4` and `blender/build_drag.py`, both now
  unused). Uses YOUR character (`createSeatedCharacter(char, 0, { knees: -1.5 })` = legs straight, laid on its back
  with the feet in her left hand: `her.userData.hands.L`, new `drag` state in `upgradeMonster`) and the game's ghost.
  Shots: S1 on the road by the wreck, she walks out of the headlight and bends over you (face reveal); S2 behind
  you, dragged up the path with the house at the end; S3 your own eyes, legs, her back, porch steps, the door opening
  on a lit hall; S4 inside the hall (wallpaper, chequered tiles, flickering bulb, writing), she comes in past the
  camera, the door slams. 17 s. `playIntro` starts it 1.5 s after the crash (`startDrag`), sounds via `dragSound`,
  black cuts via `drag.cover(t)`. `#intro` keeps class `live` so the canvas shows through. Test hooks:
  `S.intro._toDrag()`, `window.__hm.dragLive`.
- **Wake-up** (main.js): after the intro the click screen says CLICK TO WAKE UP (no briefing). On click (pointer
  lock) `wakeUpSequence()`: 2.6 s later a subtitle `<name>: We're stuck in this house... we have to find a way
  out.` (`#wakesub`, silent), then the objectives pop up (`#objpop`, same text as the briefing via
  `showBriefing(target)`), Enter or 16 s closes it.
- **Ending** (`buildOutro` in drag.js, `playOutro` in intro.js, `playEnding()` in main.js on your own `escaped`
  event): the same car, wrecked (cracked windshield texture, one headlight dead, bumper hanging, smoke), everyone who
  got out seated in it, she watches from the lit doorway. O1 front of the car pulling away, O2 dashboard looking back
  (silent line "Don't look back. Just drive."), O3 wide over the road, sky greying, white. 13.6 s, Space-hold/Esc
  skips. If the game `end` arrives meanwhile it waits (`S.pendingEnd`). The car GLB is fetched when the stage turns
  to `escape` (`outroCar()`), or reused from the intro.
- **Direction signs** (world.js): at corridor junctions (>= 3 open sides, >= 4 cells apart, <= 14 per floor) an
  enamel sign on the wall lists STAIRS / SHRINE (basement) / EXIT (ground floor) with an arrow, from a BFS distance
  field per destination (only destinations whose next step runs along that wall). Top floor: stairs = cells beside
  the stairwell opening (type 4). Room name plates above doors were already there.
- **Jump** (Space): `JUMP = { v: 4.4, g: 13 }` (~0.74 m, ~0.68 s), costs 10 stamina, landing thump + camera dip,
  no footsteps in the air. Client sends `{t:'jump'}`; server relays `ev jump {id}`; other clients play the same arc
  (`r.jt`, `jumpArc`) and pass `air` (0..1) to `setPose(...)` so the avatar tucks its knees (animated GLB avatars and
  the survivor rig) and stops the walk cycle in the air. Spectator camera follows the arc.
- Intro safety cap is now 120 s and cuts to the crash (the drag scene still plays) instead of skipping it all;
  server `INTRO_S` = 95. Full real-speed run: video 5-21 s, car 21-71 s, drag 71-91 s, wake screen at 92 s.

## 7g. Statues and ghost faces, more scares, fuller house, fewer bells (LOCAL ONLY until the owner says)

- **Ghost faces in the walls** (`public/models/ghost_face.glb`, built by `blender/build_statues.py` from the CC0 Poly
  Haven "Marble Bust 01": head only, jaw dragged open, hollow black eyes, black tears; features found from the nose
  tip). `public/statues.js` puts 5 per floor half into corridor walls at head height.
- **Stone Chudails**: her own model (`createMonster`) turned to stone (`makeStone(pose)`: grey material, black for
  the mouth/tears/hair, no glow or embers), jaw open (`reveal` 1), pose `stare` or `chase`. 2 per floor in room
  corners + 3 per floor in straight corridors, back to the wall. Client colliders (`world.colliders`, ref kept in
  `s.col`).
- **They watch you**: `statues.update(dt, camera, camL, audio)` each frame; anything not in the view frustum (or
  behind a wall) turns towards the camera (faces within +-0.75 rad of the wall normal, corridor statues +-1.3, room
  statues fully); when you look back at one that turned > 0.45 rad within 12 m, a stone grind plays. Per player.
- **New jump scares** (`runScare` in main.js; every 15-32 s now, was 22-45): `wallface` (a ghost face lunges out of
  the wall beside/ahead of you and turns to scream at you; animated through `S.anims` in `updateScares`, never via
  requestAnimationFrame so it can't get stuck), `statue` (lights stutter, the nearest statue in sight steps up to
  1.6 m closer: `statues.creep`), `handprints` (bloody hands slapped onto a screen overlay `#handcv` with bangs),
  `scream` (`audio.distantScream` off to one side), `ceiling` (`showGhost(..., 'ceiling')`: she skitters across the
  ceiling ahead; `setCrawl(1)` and a 1.2 s slide in the ghost updater).
- **Map** (shared/map.js, both sides; checked: 30 seeds hash identically in Node and the browser): rooms take up to
  10 props (was 7) with a 75% chance per wall cell (was 55%); hide types also at the 7th prop, 60% (was 45%); 13
  corridor lockers per floor (was 9); bells 6 with 9-cell spacing (was 11 / 6). Averages over 20 maps: props 222 ->
  317, hiding spots 115 -> 166, bells 11 -> 6 (before the difficulty multiplier).

## 7h. The house blueprint (LOCAL ONLY until the owner says)

- One per game. `map.blueprint` (shared/map.js, no rng: the first free spot of a fixed list ~2 m inside the front
  door, clear of foyer props and spawns); its table is in `staticColliders` and the client's `world.colliders`.
- Server `game.bp = { x, z, L, holder, onTable }`: `{t:'bp'}` takes it (alive, not hidden, same floor, within 2.6 m,
  nobody holding it); `dropItems()` (death AND disconnect) drops it where the holder was; escaping puts it back on its
  table. Every change broadcasts `ev bp { holder, x, z, L, onTable, by, why: take|drop|return }`; the start message
  carries `bp` for late joiners.
- Client: `buildBlueprint` (table, candle, a sheet with a tiny floor plan on it), `placeBlueprint` (sheet on the table,
  on the floor where it fell, or hidden while held), E prompt "Take the house blueprint", objective line says who has
  it. The holder presses **M**: `openBlueprint(L)` draws the floor plan (`drawPlan`: walls, corridors, hatched
  stairs, room names, EXIT on the ground floor, the shrine circled in the basement); 1/2/3 switch floors, M closes.
  **No "you are here" marker** (owner's call).
- Tested with two players: one takes it, the other cannot; holder leaves -> it drops on the floor; picked up again.

## 7c. Own domain (chudailbusters.com) via a named Cloudflare tunnel

The owner chose **chudailbusters.com**, registered on Cloudflare (the owner buys it; Claude must not purchase).
The game still runs on the owner's laptop; a named tunnel gives it a fixed address.

One-time setup on the machine that runs the game:
1. `cloudflared tunnel login` (opens the browser; pick chudailbusters.com). Writes `~/.cloudflared/cert.pem`.
2. `cloudflared tunnel create chudail` (writes `~/.cloudflared/<uuid>.json` credentials).
3. `cloudflared tunnel route dns chudail chudailbusters.com` (adds the CNAME at the zone apex).
4. Put `tunnel.json` next to server.js (gitignored): `{"name": "chudail", "hostname": "chudailbusters.com"}`.
Then `npm run online` serves https://chudailbusters.com (server.js `startTunnel()` runs `cloudflared tunnel run`;
without tunnel.json it falls back to a random trycloudflare.com quick tunnel).

## 8. Assets & credits
See README "Credits". Characters by Quaternius (CC0 / one CC-BY "Soldier"), scream CC0 from Wikimedia Commons,
fonts from Google Fonts (OFL). Monster built by `blender/build_characters.py`.

## 7d. Always-on service (macOS LaunchAgent)

The live game runs as a background service, independent of any Claude session:
- Install: `~/chudail-busters-live` (a clone of `main` + node_modules). Log: `server.log`; current link: `public-link.txt`.
- Service: `~/Library/LaunchAgents/com.chudailbusters.live.plist` runs `caffeinate -i node server.js --online` on port 3000,
  starts at login (RunAtLoad) and restarts on any crash (KeepAlive). `caffeinate -i` stops idle sleep; closing the lid
  or shutting down still takes the game offline until the Mac wakes.
- A dropped tunnel reopens by itself (server.js `startTunnel`), but a quick tunnel then gets a NEW random link.
  The fixed address needs the named tunnel in 7c.
- Deploy an update: `git -C ~/chudail-busters-live pull && launchctl kickstart -k gui/$(id -u)/com.chudailbusters.live`
- Stop for good: `launchctl bootout gui/$(id -u)/com.chudailbusters.live` (and delete the plist).
- Do not start another server on port 3000 (e.g. the "hollowmere" preview config); test on 3001-3004.
