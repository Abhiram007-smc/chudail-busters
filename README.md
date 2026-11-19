# CHUDAIL BUSTERS (चुड़ैल)

A co-op first-person horror game for 1–6 players, played in the browser.

Ashgrove Sanatorium closed in 1974. The patients whispered about a *chudail*: a woman with long black hair whose feet point backwards. She still walks the wards.
The house has three floors: the basement, the ground floor and the upper floor, joined by staircases. Somewhere in the basement she built a black-magic shrine: a pentagram drawn in blood. Find the five things it needs, fill the star, trap her in it, then get out alive.

## Start the game

You need [Node.js](https://nodejs.org) 18 or newer.

```bash
cd chudail
npm install
npm start
```

Open **http://localhost:3000**, type your name, and click **Enter the asylum**.

## Play with friends (up to 6 players)

**Friends anywhere in the world (different city or country):**

```bash
npm run online
```

This starts the game and opens a free Cloudflare tunnel. The terminal and the lobby screen show a link like
`https://something.trycloudflare.com`. Send it to your friends: they just open it in Chrome, Edge or Firefox.
The link changes each time you start, and stops working when you close the game.
(First time only: install the tunnel tool with `brew install cloudflared` on Mac or
`winget install --id Cloudflare.cloudflared` on Windows.)

**Same Wi-Fi:** `npm start` and friends open the `http://192.168.x.x:3000` address shown in the lobby.

Everyone picks a survivor in the lobby (8 characters), then anyone presses **Begin**.

## The intro

Every game starts with a cut scene: you and your friends are driving up a snowy mountain road at night. The street
lights flicker and die one by one. Then a truck's lights come out of the dark, in your lane. Then she comes out of the
dark, bends over you where you lie on the road, and drags **your own character** by the ankle through the snow, up the
porch steps and into the house's hallway; the door slams. When you wake up you say *"We're stuck in this house... we
have to find a way out"* and your objectives pop up. The outside shots are a movie rendered in Blender; the inside of
the car and the drag are played live, so **everyone's chosen character is in it** (the first player drives). In
co-op the friends chat about their holiday plan on the way (silent, subtitles only, using your player names). Hold
**Space** to skip it.

## The ending

Get out through the front door and you drive away in the same car, wrecked from the crash, with everyone who made it
out; she watches you go from the doorway.

## Finding your way

Every room has its name above the door, and enamel signs at the corridor junctions point to the **STAIRS**, the
**SHRINE** (basement) and the **EXIT** (ground floor).

## Difficulty

Pick one in the lobby before anyone presses **Begin**:

| Mode | What changes |
| --- | --- |
| Easy | she is slower, sees and hears less, no Crawler, more batteries, bells and aatma candles |
| Normal | the intended game |
| Hard | faster, sees and hears further, fewer batteries, bells and aatma candles |
| Nightmare | much faster and sharper, about half the supplies and very few aatma candles |

## How to win

1. **Find the 5 ritual items:** a Human Skull, a Black Candle, a Cracked Mirror, a Cursed Doll and a Braid of Her Hair.
   They are spread over all three floors and they are not easy to spot. The staff left notes with **riddles**: a note never names the room,
   it describes it ("where the cradles rock with no one in them") and hints at the floor. Each item also has **her sign**, drawn on its note:
   find the same sign scratched in blood on the walls by the room's door and inside it. Items also **whisper** when you get close.
   Every item you take makes her faster. If you die, the items you carried drop where you fell.
2. **Fill the star.** Take the stairs down to the basement shrine and place one item on each point of the pentagram (E).
3. **Lure her into the centre.** When the fifth item goes down, the star starts to burn. While it burns she cannot touch anyone standing inside it.
   Make noise, let her see you, and wait inside the star: when she comes for you, it drags her into the middle and binds her.
4. **Run.** The front door in the ground-floor foyer opens. Get out.

## Scares

Ghost apparitions, her face cutting in for a single frame, the lights dying while she gets closer with every flicker of your torch,
breathing right behind you, and a white-and-red strobe when she catches you. If flashing images are a problem for you, tick
**Reduce flashing** in the lobby: the strobes become soft single fades.

## Controls

| Key | Action |
| --- | --- |
| WASD / mouse | move / look |
| Shift | sprint (any direction). **She hears you from far away.** |
| Ctrl (or Alt) + move | sneak: slow and completely silent |
| C | crouch: completely silent; with your light off she can walk right past you |
| Space | jump (everyone sees it) |
| F | flashlight (the battery drains; find spare batteries) |
| E | take, read notes, place items on the star, hide in lockers, wardrobes and under beds, revive a friend (hold) |
| Q | ring a **spirit bell**: freezes her for 6 seconds and scares the Crawler away |

## The things that hunt you

- **The Chudail:** tall, pale, long black hair, feet turned backwards. She carries a cold glow, so you can see her coming.
  - She hunts by sound and light. Sneaking is silent.
  - Shine your torch in her face and she slows down, but then she knows exactly where you are.
  - She doesn't only run. Sometimes she climbs onto the ceiling or up a wall and skitters along it, upside down, hair hanging. Listen for nails on plaster, and look up. She drops down right in front of you.
- **The Crawler:** wakes after the first ritual item is taken. It hangs from the ceiling, and if you walk under it, it drops and chases you on all fours. Look up.
- **Lockers and wardrobes:** if she *sees you get in*, she drags you out. Break line of sight first.
- **Aatma candles** (several on the map, you can carry more than one): hold E over a fallen friend for 3 seconds to bring them back.
- Teammates' names float above them and show through walls, so you never lose each other.
- Dead players watch the survivors (click to switch) until someone revives them.
- Inside a locker your eyes adjust to the dark: you can watch through the vents. If she saw you get in she will stop and listen at the door, and she doesn't always open it.

## Performance

The game picks a resolution automatically to stay smooth, and only draws what is near you, since the fog hides the rest.
On weak laptops close other tabs; Chrome or Edge gives the best performance.

## Project layout

```
server.js               game server: lobby, monster AI, hiding, scares
shared/map.js           random level generator shared by server and browser
public/main.js          game client: player, floors and stairs, networking, scares, notes, bells, shrine finale, post-processing
public/world.js         builds the 3D house on 3 floors (rooms, stairs, props, lockers, lights, the pentagram shrine)
public/entities.js      the monster, players, loading 3D models
public/textures.js      hand-painted textures (all generated in code)
public/audio.js         generated horror audio (ambience, footsteps, stingers)
public/models/          3D characters (.glb)
public/img/chars/       character portraits for the lobby
public/sounds/          the jumpscare scream
blender/build_characters.py   Blender script that builds the monster (the chudail)
```

To rebuild the Blender models:

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python blender/build_characters.py -- public/models
```

## Credits

- Survivor characters by **Quaternius** via [Poly Pizza](https://poly.pizza):
  - "Adventurer", "Hoodie Character", "Woman", "Man", "Punk", "Animated Woman" and "Hooded Adventurer": CC0 (public domain)
  - "Soldier" — Creative Commons Attribution (CC-BY), by Quaternius ([poly.pizza/m/oAArCNHjFB](https://poly.pizza/m/oAArCNHjFB))
- Intro: street lamp model and snowy asphalt / snow textures from [Poly Haven](https://polyhaven.com) (CC0); the truck, road and mountains are built by script in Blender (`blender/build_intro.py`)
- Intro and ending car: "Range Rover" by **IvOfficial**, Creative Commons Attribution 3.0 (CC-BY), [poly.pizza/m/8zk4o6nALW](https://poly.pizza/m/8zk4o6nALW); fitted with the game's own seats, dashboard and wipers in Blender
- Footsteps: "Different steps on wood, stone, leaves, gravel and mud" by **TinyWorlds** ([OpenGameArt](https://opengameart.org/content/different-steps-on-wood-stone-leaves-gravel-and-mud)), CC0
- Horn in the intro: "Car Horn.wav" by **15HPanska_Ruttner_Jan** (Wikimedia Commons), CC0
- After the crash: the drag into the house and the ending are live three.js scenes (`public/drag.js`) with the game's own characters and Chudail
- Jumpscare scream: "Demonic Woman Scream" by **nick121087** (Freesound, via Wikimedia Commons), CC0
- The Chudail and the Crawler: modeled with a script in Blender for this game
- Fonts: Creepster, Eczar, Kalam, IM Fell English SC, Courier Prime, Homemade Apple, Rubik Wet Paint, Nosifer (Google Fonts, OFL)
- Online play: Cloudflare quick tunnels (`cloudflared`)
- Engine: [three.js](https://threejs.org) (MIT), [ws](https://github.com/websockets/ws) (MIT)
