# Bubble CVC — a blending board you throw

A teacher-led phonics blending board for large classroom touchscreens. Three
bubbles float over an ocean; a bay of 3D letter dice sits along the bottom. A
student flicks a die up into a bubble, hears the phoneme, and builds a word.

Modelled on the **UFLI Foundations Virtual Blending Board** (Step 4, Blending
Drill). Open `index.html` through a web server — it uses ES modules, so
`file://` will not work.

**No build step.** three.js is vendored in `vendor/`.

---

## What it is for

UFLI's Step 4 is five minutes of *decoding automaticity*: the teacher builds
words from previously-taught graphemes and students read them chorally, saying
each sound then blending. The board is prepared in advance and holds only what
has already been taught.

**This app deliberately diverges on one point.** In UFLI, *only the teacher
manipulates the board* — students read what the teacher builds. Here the student
does the throwing. That is a considered trade for a wall-mounted touch panel,
where the physical act is most of the engagement. The risk it introduces is that
flicking becomes the activity and reading becomes incidental, so the design
pushes back: **no word is spoken until the slots are filled**, which puts the
blending at the end as the payoff rather than at the start as a warm-up.

---

## The core loop

1. Teacher picks the letters for the lesson on the pre-screen, and presses Start.
2. Student flicks a die from the bay up toward the bubbles.
3. A die that lands is swallowed, locks square to the reader, and **plays its
   phoneme** (a real human recording, not TTS).
4. When the word is complete, the sounds play in order and then blend.
5. **Tap one bubble to pop just that letter.** The other letters stay.

Step 5 is the whole point — see *Word chains* below.

### Order of play

The spec said "left to right", but it also described starting with the **vowel**
and adding a coda to make a word family, then adding the onset. Those are only
compatible if *left to right* describes the **columns**, not the sequence. So:

- the bay column → bubble slot mapping is fixed (onset→0, vowel→1, coda→2)
- **fill order is free**

A coda die can never land in the onset bubble, but you may fill the slots in any
order you like.

### Word chains — the reason per-bubble popping exists

A blending board earns its keep by changing **one** grapheme and re-reading:
`cat → cot → cop → mop`. The changed position is where attention goes. If
popping cleared the whole word, every new word would cost three throws and the
drill would lose its tempo and its point.

So popping is **per bubble**. Pop the vowel on `cat`, flick in `o`, and you have
`cot` in one move. Park `o` and `t`, hear "ot", then try onsets in front of it.

---

## The pre-screen

| Control | Why |
| --- | --- |
| Three separate columns | Onset and coda consonants are chosen **independently**. Final-position work (`-t`, `-g`, `-p`) uses a different set than onsets. |
| Group buttons | Stops / nasals+liquids / fricatives / all / clear. The groupings a phonics teacher actually thinks in. |
| Dimmed letters in *Last sound* | `j q v w y h c` barely end English words. Dimmed as a nudge, **never disabled** — UFLI uses pseudowords on purpose, so `vog` must stay reachable. |
| Saved boards | UFLI says the board is "prepared in advance". Nobody wants to re-tap twelve letters between small-group rotations. Stored in `localStorage`. |

The last-used selection is restored automatically.

---

## Art direction

An enchanted underwater diorama, built in three depth layers. The composition
rule that governs everything: **the centre of the frame belongs to the bubbles.**

| Layer | Depth | Job |
| --- | --- | --- |
| Foreground | z −14…−20 | Big, dark blue-black silhouettes along the bottom edge. They frame the shot and give the eye something near to measure against. |
| Midground | z −24…−48 | The coral gardens — the only place warm colour lives. Confined to the bottom corners. |
| Background | z −58…−78 | Two hazy reef bands, low contrast, for scale only. |

**Warm colour is rationed.** Coral pink, amber and a little lavender appear only
in the midground clusters. A scene that is warm everywhere stops reading as
underwater — the deep sapphire has to dominate for the aquamarine to mean
anything.

The water is a four-stop depth ramp (pale aquamarine surface → turquoise →
sapphire → near-black floor) with leaning god rays, two counter-drifting caustic
layers, and a gentle elliptical vignette. Rendering is ACES tone-mapped at
exposure 1.12 so the bright rim and caustics roll off instead of clipping flat.

Lighting is a deliberate three-light rig: a warm key from above matching the god
rays, a **hemisphere light** carrying aqua from above and deep blue bounce from
below (this is what keeps shadowed faces coloured rather than grey), and a cold
rim from behind that separates the dice and bubbles from the water.

## Load-bearing decisions — do not undo

### ⛔ The die orientation clamp

`src/dice.js` clamps **roll to ±1.6°, always, including mid-flight.** Roll is the
axis that turns `b` into `q` and `m` into `w`. A die that tumbles freely will at
some point in its arc show a mirrored glyph, which actively teaches the
confusion the lesson exists to prevent. Pitch and yaw get a gentle wobble because
neither can mirror a letter — they only foreshorten it.

If you ever add "satisfying" tumbling to the flick, you have broken the app.

### ⭐ The bubble shader is Fresnel-gated, with a non-zero F0

`fres = 0.065 + 0.935 * pow(1 - cosT, 3)` in `src/bubbles.js`. That `0.065` is
the single most important number in the file. Thin-film interference is only
visible in what the film **reflects**, so the colour is multiplied by Fresnel —
which is what keeps the middle transparent enough to read a letter through.

Set F0 to 0 and the bubble becomes a bare outline with a dead grey middle. A real
soap film still reflects ~6% face-on, and that 6% is exactly what carries the
iridescence across the body. Both failure modes were rendered and looked at
during this work.

Colour comes from sampling three wavelengths through the interference equation,
not from a hue ramp — that is where the magentas and golds come from. Film
thickness drains toward the bottom and flows on two noise octaves, sweeping
through several interference orders so the bubble is marbled rather than tinted.

### ⭐ The pop tears, it does not glow

Four phases in `stepPop`, ~0.76s total: anticipation (inward squeeze, rim
tightens, film thins toward blue) → rupture (elastic expansion while holes open
from the thinnest areas outward) → empty → reform at the exact home position.
`src/pop.js` adds a thin-film shockwave ring and ~54 droplets that burst outward
and then rise, because that is what water does.

An earlier version added a bright white flash across the whole sphere and the
bursting bubble read as a ball of frosted glass. The **holes** have to do the
work. The flash that remains is narrow, brief, and tinted by the film's own
interference colour.

⛔ **The slot is released at the START of the pop, not the end.** The burst is
decoration over an already-completed state change, so a teacher mid-chain never
waits on an animation. A bubble also accepts a new die once it is *reforming* —
without that, a die thrown during the burst silently failed.

### ⭐ Bubble radius is a SCALE, never baked into the geometry

The mesh is a unit sphere scaled by `b.r`. Radius is recomputed from the viewport
on every resize, and a baked geometry cannot follow it — that shipped a portrait
layout where the bubbles kept their landscape size and overlapped into a tangle.

### ⛔ A sea fan is a LATTICE, and its stems must be hair-thin

Two failed versions are worth knowing about, because both arrived at the same
yellow starburst from different directions:

1. An extruded `Shape` with alternating radii — a solid outline can never read
   as a gorgonian.
2. A branching lattice with stems at `rad 0.075` — as wide as they were long, so
   the gaps closed up and it became solid spikes again.

What works: `growFanBranch` at `rad 0.034`, six generations, splay narrowing each
generation, confined to the XY plane (no yaw at all) and squashed on Z. You have
to be able to see water through it.

The lattice is **merged at build time**. The fan is in the `swaying` list, which
marks its children `keepSeparate` and skips them in the scene merge — several
hundred unmerged cylinders took the board from 124 draw calls to 289. The sway
rotates the fan as a whole, so nothing inside needs to move on its own.

### ⭐ The reef scales with the viewport, and rebuilds on resize

Scenery sized in absolute world units does not survive an aspect change:
`bounds.x` runs from ~5 on a portrait tablet to ~23 on a classroom panel, so a
fan that sits politely in the corner of a 16:9 screen sprawls across a phone and
cuts through the bubble row.

Cluster **spread** is now driven by `halfWidthAt()` at each band's own depth (see
the depth section below), not by `bounds`; `SIDE` survives only as the fallback
for when no camera is passed. Individual pieces are still sized in world units.
(An earlier version of this file documented an `S = clamp(bounds.x / 22, …)`
scale factor — that constant is long gone; `SIDE` replaced it.)

Because `S` is baked at build time, a resize **disposes and rebuilds** the reef,
debounced by 320ms — a drag-resize fires continuously and rebuilding a few
hundred merged geometries per frame would lock the tab.

### ⭐ The bubbles sit ALMOST TOUCHING, and that is pedagogical

Three bubbles holding a word are a word being **blended**. Sounds that run
together should look like they run together — a row of well-separated spheres
reads as three unrelated objects, which is the opposite of what blending teaches.
The gap is a 6% sliver, just enough that each rim still closes as its own shape.

`layoutFor` derives the **pitch from the radius**, not the other way round. The
old code did the reverse and then capped the radius, which meant the cap silently
pushed the bubbles apart again on a wide screen — the spacing you asked for
quietly became the spacing the cap allowed.

Because the rims nearly touch, the tap margins overlap, so `bubbleHit` returns
the **nearest** bubble rather than the first match. Returning the first meant a
tap in the overlap always popped the left-hand bubble — mid-chain that silently
destroys the wrong letter.

### ⭐ The reef travels; the gameplay does not

The camera never moves. The reef streams toward it on a recycling conveyor
(`bands` in `src/reef.js`), which gives "swimming forward over a reef" while
leaving the play plane at z = 0 completely untouched — bubbles and dice do not
drift, do not change size, and every capture radius and tap target stays put.
Moving the real camera would have forced the whole play plane to chase it.

Conveyor content lives in **true world coordinates**, unlike the static horizon
which is still screen-placed. That difference is the point: a cluster should grow
and sink out of frame as it approaches.

⛔ **The sea floor is at y = −40 for a reason.** A cluster is ~15 world units
tall and the visible half-height at these depths is only 23–50, so a floor at
−22 put coral straight through the bubble row. At −40 the gardens sit in the
bottom third at the far end and slide out of the bottom of frame as they
approach, so bands leave the shot on their own and never need fading.

⛔ **Merge each band internally only.** Merging across bands welds them into one
mesh and they can no longer travel independently.

Motes drift forward at the same rate, because suspended matter that disagrees
with the sea floor about which way you are going gives away the static camera.

### ⭐ Bubbles track the bay columns

Bubble x positions are the bay column centres pulled 52% toward the middle
(`layoutFor` in `src/bubbles.js`). This is play-feel, not decoration. When the
bubbles were a tight clump in the centre, an onset die had to cross ~10 world
units sideways to reach its slot, which demanded a hard, precisely-angled throw.
Measured during development: a reasonable throw fell **5 units short every
time**. Raising `pull` toward 1.0 parks each bubble over its own column and makes
aiming trivial; lowering it toward 0 restores the unplayable version.

### ⭐ Letterforms are centrelines, not a font

Lifted from the Low Vision Braille app, where they are already classroom-proven.
A font gives a double-story `a` and a serifed `t`; school print does not. The
glyph also gets a dark blurred halo under the white stroke — plain white-on-blue
washed out once the material's lighting dimmed the face, and these letters have
to carry across a room.

### Captured dice stop moving

A locked letter is perfectly square to the reader and completely still. The
built word must be the most legible thing on screen.

### A bubble always comes back

Popping never removes a slot. A teacher mid-chain must always be able to refill
the position she just cleared.

---

## Audio

`audio/phonemes/` — the 26 **human** recordings carried over from Phonics Farm
(Pronunciation Studio, under the non-profit educational grant). These are the
pedagogical payload. Never regenerate them with a synth.

Everything else — bubble capture, pop, flick, wall hit, completion — is
**synthesised in WebAudio** at runtime. No sound files to ship or license, and
each is kept under ~400ms because on a classroom TV a long sound steps on the
teacher's voice, and the teacher is the instruction.

### Whole-word audio is NOT shipped yet

v1 blends the phonemes instead, which is exactly what UFLI asks students to do.
When Kokoro clips are generated, the only change needed is in `src/audio.js`:

```js
export const WORD_CLIPS_AVAILABLE = true;   // currently false
```

…with files at `audio/words/<cvc>.wav` and `audio/vc/<vc>.wav`. Nothing else
needs to change — `tryWordClip()` is the single seam.

**Open question for that work:** whether Kokoro pronounces VC chunks like `og`
and `ot` as sounds rather than letter names, and whether nonsense words like
`vog` come out phonetically. Verify by ear before trusting it.

---

## Underwater light (`src/lightwater.js`)

An art-direction audit found the core problem in one sentence: **the scene was
underwater *behind* the objects and dry *on* them.** The water shader painted
caustics, god rays and a depth ramp — and then every rock, coral and fish was lit
by a plain directional light as if standing in a field. Nothing in the whole
project used `castShadow`, `receiveShadow`, `aoMap`, `vertexColors` or
`onBeforeCompile`.

Three fixes, all injected into the standard material rather than added as a post
pass, because a post pass costs a full-screen read and this costs a few
instructions on surfaces already being shaded. **Draw calls did not change.**

**Caustics**, projected from above in world space, so the pattern is fixed to the
world and the reef slides through it. Only on upward-facing surfaces, strongest
at the sea bed.

⛔ **Spatial frequency is the entire effect.** At `0.085` the noise cell is ~12
world units while a rock is ~6 — every rock sat inside half a cell and received
one near-constant value. The caustics were mathematically present and completely
invisible. The pattern must be **finer than the objects it falls on** (now `0.34`).

**Baked vertex-colour AO**, darkening toward the sea bed with noise mottling.
Nothing was anchored before: a coral stem simply intersected a rock with no
darkening at the join, so everything read as objects *placed near* each other
rather than growing out of each other. Baked once at build time, free per frame.

**Tinted depth falloff.** ⛔ The fog colour **must be darker than the water it
blends into.** The first value was a mid-blue brighter than the vignetted water
at the sea bed, so the distant reef receded toward a *glow* — the coral came out
pale and ghostly, lighter than its background, which is the exact inverse of
atmospheric perspective.

Also ⛔ keep the sediment tint **dim and cool**. A bright warm sand colour at any
real strength bleaches coral to pale pink and the garden looks sun-faded; silt
underwater is muted blue-grey, not beach sand in daylight.

### Coral morphology — five silhouettes, not one shape in five colours

The audit's second finding: **every coral was the same branching algorithm
recoloured three times.** Pink, amber and lavender shared one silhouette, so the
gardens read as repetitive no matter how many were added. A reef is defined by
*contrasting forms*, and the contrast is structural, not chromatic.

| Form | What it contributes |
| --- | --- |
| Brain / dome | A solid rounded **mass** — the gardens had none |
| Table / plate | The strongest **horizontal** on a reef |
| Organ pipes | A **vertical rhythm**; repetition at small scale |
| Branching | The existing fractal — now one voice among four |
| Sea fan | A flat **net** |

**Colour is rationed.** Exactly one saturated accent (`coralPink`, on the
branching coral) sits among muted terracotta, ochre and dusty mauve. The old
palette was three near-identical hot pinks and the garden had no focal point —
everything shouted at the same volume.

### ⛔ A sea fan is a NET, not a tree — third attempt

Two earlier versions failed into the same yellow starburst from opposite
directions: an extruded `Shape` with alternating radii, then a recursive
branching **tree** with hair-thin stems (which came out as bare winter twigs).

Both failed for one reason: **a gorgonian anastomoses** — its branches rejoin
each other and form closed cells you can see water through. A tree only ever
divides, so it can never close a loop, and without closed loops the eye reads
"dead shrub" however fine the stems are.

It is now built as a **polar lattice**: nodes on a fan-shaped grid wired to their
radial, tangential and occasional diagonal neighbours, with ~22% of struts
randomly omitted. The tangential struts are the ones that close the cells.

### Kelp translucency

Kelp is a thin membrane and **glows when lit from behind** — that single property
is most of what separates a living plant from a cut-out ribbon. Blades facing
away from the key light get warmed and lifted rather than darkened, which is the
opposite of ordinary shading and exactly what a leaf does.

⚠️ When adding a varying to the kelp shader, note the vertex shader has
`vUv = uv;` between `void main() {` and `vec3 p = position;` — an anchor that
skips it will insert the assignment without the declaration, and the material
silently fails to compile and renders nothing.

### Rocks

Rebuilt — the audit called them the weakest asset *and* the largest mass, which
is the worst combination. The old version was a once-subdivided icosahedron with
uniform jitter in one flat blue and read as crumpled paper. Now: two scales of
displacement (big lobes for mass, small chips for surface), a **flat base** so
they bed into the floor instead of hovering, and all value coming from the baked
vertex colours rather than the material.

## Performance

Measured from `renderer.info`, not estimated:

| | Before the merge pass | After it | Now (full-width reef + shark) |
| --- | --- | --- | --- |
| Draw calls (full board) | 543 | **184** | **179** |
| Triangles | 50,454 | 51,354 | **120,309** |
| Geometries | 295 | 106 | 216 |

The reef spanning the whole sea bed costs roughly 2.3× the triangles (16
gardens per cycle instead of 8, plus their litter). **Draw calls did not move**,
which is the number that mattered — the analysis below found this scene
draw-call bound, not triangle bound, and each band is still merged into one
mesh. Density is one constant: "one garden roughly every 26 units" in
`createReef`. ⚠️ Still unverified on the actual classroom panel.

The reef was drawing a separate mesh per coral segment, kelp blade and anemone
tentacle. With only ~50k triangles that made it **draw-call bound**, which is the
worst case for the weak SoC behind a classroom panel. Three fixes:

- A small `mergeInto` / `mergeGeometries` pair in `src/reef.js` (three.js keeps
  `BufferGeometryUtils` in `examples/`, which this project does not vendor).
  Anything that does not animate on its own is baked at build time.
- **Kelp is one mesh per strand**, bent in a vertex shader from vertex height.
  Cheaper than the old nine-hinge chain *and* smoother — a continuous curve.
- **Dice went from 6 draw calls to 3** by collapsing the box's six material
  groups: three.js issues one call per group, and a die only uses two materials.

Session cycling (setup → play → setup, six times) leaks **zero** geometries and
zero textures — per-die materials and per-bubble shader materials are disposed,
while the shared rounded-box geometry and the cached glyph textures are kept.

⚠️ **Frame rate was NOT measured.** The remote devtools bridge throttles
`requestAnimationFrame` to roughly 1 Hz, so any FPS number taken through it is
meaningless (a measurement attempt returned "1 fps"). Draw calls and triangle
counts are real. Real frame rate needs checking on the actual panel.

## Layout

```
index.html          shell, styling, the home/replay chrome
src/main.js         scene assembly, input, word state machine
src/letterforms.js  school-print centrelines → canvas glyphs
src/dice.js         die mesh, THE ORIENTATION CLAMP, bay layout
src/bubbles.js      thin-film bubble shader, capture/pop, slot layout
src/physics.js      flick, flight, wall ricochet, magnet, capture
src/audio.js        phonemes, synthesised sfx, word-clip seam
src/prescreen.js    teacher's letter picker and saved boards
src/ocean.js        water shader, fish/octopus/shark, motes
vendor/             three.js r186 (+ licence)
audio/phonemes/     26 human phoneme recordings
```

### Testing it

A flick game cannot be meaningfully unit tested, so `window.__bubblecvc` is a
permanent inspection handle:

```js
__bubblecvc.slots            // ['m', 'a', 't']
__bubblecvc.dice             // every die: letter, state, position, velocity
__bubblecvc.throwDie('m', 6, 22)   // launch in world units/sec, no gesture needed
```

⚠️ When driving it from a remote devtools bridge, **screenshot pixels are not
CSS pixels.** This viewport reports 2184×1114 while screenshots come back at
1538×784 — synthetic `clientX/Y` taken off a screenshot must be scaled by the
ratio or every tap lands somewhere else entirely.

---

## Modelled sea life (optional)

The procedural fish, shark and octopus are spheres with cones attached. Abstract
scenery built that way reads fine — rocks, kelp, caustics all work — but anything
the eye recognises as an **animal** does not. Failed realism looks worse than
honest abstraction, so the creatures (and only the creatures) can be replaced
with real CC0 models.

Drop GLB files into `assets/creatures/` and list them in `manifest.json`; see
`assets/creatures/README.md`. **Entirely optional and fails soft** — no manifest,
a 404, or a model that will not parse all fall back to the procedural creature
for that kind specifically, so a pack containing only fish still upgrades the
fish and leaves the octopus alone.

Verified end to end against a CC0 sample: GLB parsed, skinned mesh found, named
animation clips read, and `AnimationMixer` driving them. `GLTFLoader`,
`SkeletonUtils` and `BufferGeometryUtils` are vendored in `vendor/jsm/` with
their bare `'three'` imports rewritten to the local build.

### ⛔ `yaw` is not decoration — the whole pack shipped swimming sideways

Every entry in `manifest.json` said `yaw: 0`, and every model in the Quaternius
pack points down **+Z** while `ocean.js` swims its creatures along **+X**. The
entire cast — fish, manta, dolphin, whale, shark — was therefore crabbing
sideways across the screen for weeks. It is not obvious at background scale,
which is exactly why it survived; it became impossible to miss the moment the
shark was scaled to 39 units.

Every entry is now `yaw: 1.5708`. If you add a model, check it: a skinned mesh's
extent along X should be its LENGTH, not its width.

```js
// in the console, with the pack loaded
skin.computeBoundingBox();
const b = skin.boundingBox.clone().applyMatrix4(skin.matrixWorld);
b.max.x - b.min.x   // should be the long axis
```

⛔ **Models are committed, not gitignored.** Pages serves what is in the repo, so
an ignored model loads locally and 404s in the classroom. CC0 is what makes that
fine.

## The hero shark (`src/shark.js`)

One enormous shark crosses the scene every few minutes and is then gone for
several more. It is the only creature in the app that is an **event** rather
than traffic.

**The model is not what makes it work.** It is the same 644-triangle CC0
Quaternius shark that was already in the pack — what changed is staging:

| lever | value | why |
| --- | --- | --- |
| length | ~39 units | about half the screen width at its lane |
| crossing | 19 s | long enough to feel heavy; longer than this and a body that close stops being an event and becomes an obstruction |
| lane | z −26 → **+3** | enters deep, exits in FRONT of the play plane |
| tail beat | `mixer.timeScale = 0.42` | does more for the sense of mass than the scale does |
| gap | 1.5–3 min (first 45–75 s **into the lesson**) | rare enough to be a treat, often enough that a lesson sees several |

Check any replacement model by its **outline**, not its wireframe. A
near-silhouette shows nothing but profile, which is why the low poly count costs
nothing here.

### ⛔ Nothing runs while the prescreen is up, and the clock starts with the LESSON

The prescreen is **opaque** — a solid gradient at `z-index: 60` covering
`inset: 0` — so the entire 3D scene is hidden behind it. The first version
counted from page load and let a pass run while the letter picker was open: the
shark crossed an invisible scene, nobody saw it, and the schedule rolled on to
the 4–7 minute gap. A teacher who spent a minute choosing letters started the
lesson having already burned the pass, then waited up to seven minutes for the
next one. From the classroom that looks exactly like "I hit refresh and there is
no shark."

So: `ctx.live` (a session is actually running) gates every pass,
`shark.reschedule(clock.elapsed)` restarts the countdown when **Start** is
pressed, and a pass still in flight when **Home** is pressed is dropped rather
than animated to nobody.

### ⛔ The gate must not be able to STARVE the event

4–7 minutes did not survive contact with a classroom: a class saw the shark
once and never again, because the activity ended before the second one was due.
"Sparse" has to mean *a treat*, not *a rumour*. Hence 90–170 s.

The idle gate needs the same discipline. On a busy board — three children
flicking dice, words being spoken — "nothing at all is happening" can stay false
for a long stretch, and every pass would slip further behind. After `GRACE`
(40 s) of waiting, the only thing still allowed to hold a pass back is a word
actually being spoken. A die in flight is a half-second event and is not a
reason to withhold a nineteen-second one.

### ⛔ Three ways it could vanish in plain sight, and why none of them remain

Milo watched a pass "flicker, and I could see that it was there, but it
disappeared". Three separate mechanisms produce exactly that signature, so all
three are gone rather than one being guessed at:

1. **Frustum culling against the bind pose.** three.js culls a `SkinnedMesh`
   using the bounding sphere of its *unposed* geometry — here a radius of 20
   world units for a body whose posed half-length is 19.5. Half a unit of
   margin on a shape that fills the screen. `frustumCulled = false` on the hero
   and on every creature (the fish have the same hazard).
2. **A cached exit point.** The endpoints used to be computed once, at the start
   of the pass. A window that changes shape during those nineteen seconds —
   fullscreen, a rotated tablet, a panel's on-screen keyboard — left the pass
   finishing against stale numbers. They are recomputed every frame from the
   live camera.
3. **Ending on a counter.** The pass used to end when `u >= 1`. It now ends when
   the body is *genuinely off screen*, measured against the live frustum, with
   `u >= 1.6` only as a backstop. A position test cannot fail this way.

Verified by sampling a whole pass every frame: 274 frames, exactly one
visibility change (the hide at the end), and zero frames where the body was on
screen while hidden.

### ⛔ A pass only ever STARTS when the board is idle

`isIdle()` in `main.js`: nothing flying, capturing or returning, no bubble
popping, and **no word still being spoken**. A 39-unit dark shape sweeping
behind the letters while a child is sounding out a word is exactly the kind of
distraction the die-roll clamp exists to prevent — it just arrives in time
rather than in space. If the window comes up mid-word the pass waits; it is not
skipped. Once started it always finishes, because a shark that vanishes in open
water reads as a bug.

⛔ **The speech hold is a deadline, not a flag.** `A.blend()` *schedules* the
whole sequence on the audio clock and returns its length in seconds — the
promise settles about a quarter-second in, with two more seconds of speech still
to come. A boolean cleared on resolve was measured releasing the gate at frame
142 of a word that was still playing. `blendUntil` stores the real end instead.

### ⭐ It comes FORWARD, and crosses in front of the bubbles

The pass is not a flat sweep across the back of the scene. It enters deep at
z −26, where the small fish can see it and scatter, and swims **past the play
plane** to z +3 — in front of the bubbles, the dice and everything else. For
the second half of the crossing the body is between the viewer and the board.

⛔ **This deliberately breaks the earlier rule that nothing may occlude a
letter.** It is allowed to cover the bubbles; that is the effect. Which means
the idle gate above matters MORE now, not less — a pass may never *start* while
a child is mid-word. If it ever feels like an interruption, shorten
`CROSS_SECONDS` or pull `Z_EXIT` back toward 0. Do not weaken the gate.

⛔ **The approach has to finish BEFORE mid-screen.** x crosses the centre at
u ≈ 0.59, so the body must already be forward by then. A cubic ease (u³) was
tried first: it put the shark in front of the bubbles only for the last 12% of
the pass, by which point it is leaving frame, so the close-up lasted two
seconds and happened in the corner. `smooth(0.06, 0.52, u)` is what puts the
whole second half up close.

⛔ **z = +4 was too close.** At that depth the frame fills with midsection and
the animal stops being legible as a shark — a grey wall with a fin. +3 is the
line where the head and foreparts still read while the body still dwarfs the
board. If you move it, look at a frozen frame at u ≈ 0.46, not at the numbers.

The beat, in order: snout enters at the far edge (u ≈ 0.26) · head and gills
fill a third of the frame in the foreground (u ≈ 0.46) · body and tail stream
past · clear of the frame by u ≈ 0.96.

### Freezing a frame to judge it

`__bubblecvc.timeScale = 0` stops the clock. This matters more than it sounds:
a screenshot taken from a tool call lands **seconds** after the call that asked
for it, so "capture at u = 0.27" quietly returned u ≈ 0.5 and two art-direction
decisions were nearly made on the wrong frame. Drive to the progress you want,
set `timeScale = 0`, then look.

### The light dips as it goes over

`uEclipse` / `uEclipseX` in the water shader fade the god rays (−78%) and the
caustics (−55%) under the body, and `waterUniforms.uCausticStrength` dips the
caustics on the geometry at the same time. It is a travelling shadow, not a
global dim — the whole frame going dark reads as a bug. This is the touch that
makes the pass land; it is cheap and it is not optional.

### The fish get out of the way

`updateOcean` takes a `threat` and the swimmers bank away and accelerate inside
26 units of it, then stay unsettled for a few seconds after. The scatter lives
in `ocean.js` rather than `shark.js` because that loop owns `baseY` and rewrites
it every frame — anything pushed from outside would be overwritten before it was
ever drawn.

### Driving it from the console

A pass is minutes away by design, which makes it untestable by waiting:

```js
__bubblecvc.sharkNow()   // start one now
__bubblecvc.shark        // { active, eta, progress, eclipse, eclipseX }
__bubblecvc.idle         // the timing gate
__bubblecvc.scene        // the live scene graph
```

Art direction on something that moves cannot be done by reading source. The
lane, the scale and the counter-shading above were all set by measuring the
rendered result from the console.

## ⛔ Depth is not a detail: `src/frustum.js`

`bounds` is the half-extent of the **play plane** at z = 0, where the bubbles
and dice live. Almost nothing else in this scene is at z = 0, and at other
depths the frustum is a completely different size — 21 units of half-width at
the play plane is 46 at the nearest reef band and 114 at the farthest.

Using `bounds.x` for anything not at z = 0 has now produced **four** separate
bugs that looked unrelated:

| symptom | actual cause |
| --- | --- |
| fish "blipping in and out of existence" | recycled at x = ±35.5 while the visible edge at their lane was 36–63 |
| the sea bed empty at left and right | two gardens at ±25 in a picture 92–228 units wide |
| the hero shark vanishing in open water | exit margin measured at the play plane, 25 units short |
| the shark popping into frame | same, at the entry end |

The deepest swimmer was the worst: the whale at z −50 was appearing and
vanishing **27 units inside the frame**, in open water, in plain sight.

`halfWidthAt(camera, z)` / `halfHeightAt(camera, z)` are the fix and the
prevention. Anything placed, spread or recycled at a depth other than 0 asks
there. It takes the **camera**, not a cached number, because the answer also
depends on the window's aspect ratio and therefore changes on every resize.

## The reef spans the whole sea bed

Each travelling band lays its gardens across the frustum **at that band's own
depth**, one roughly every 26 units, evenly spaced and then jittered by most of
a slot — regular enough to cover the floor, irregular enough not to read as a
row of planters. A wide screen gets more reef rather than the same two gardens
stretched further apart.

Composition is randomised per cluster, with a `rich` value that falls off
toward the edges of frame: the middle of the sea bed is what the eye reads, the
sides are a soft frame for it. ⭐ The five-silhouette rule still holds *within*
a cluster — a solid mass, a horizontal, a vertical rhythm, a fractal and a flat
net — and hot pink is still rationed to the branching coral, which now appears
in only some clusters. One focal point per stretch of reef, not a row of them.

## Not built yet

- **Advanced mode** — CCVC / CVCC. Bubble count is already data-driven (`layoutFor`
  takes a slot count, and `span` widens a bubble), so the layout is ready for it.
- **Digraphs** — two dice welded as one unit. The intended behaviour: on a
  four-slot board, throwing a welded `th` into the onset side **merges the first
  two bubbles into one wider bubble**, so the bubble count follows the *phoneme*
  count rather than the letter count. `span: 2` in the bubble layout already
  renders this; the merge logic is what remains.
- **Self-guided mode** — the laptop version where the app, not the teacher, tells
  the student what to build.
- **Word history** — showing the chain of words built this session.
