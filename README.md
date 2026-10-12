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

## Load-bearing decisions — do not undo

### ⛔ The die orientation clamp

`src/dice.js` clamps **roll to ±1.6°, always, including mid-flight.** Roll is the
axis that turns `b` into `q` and `m` into `w`. A die that tumbles freely will at
some point in its arc show a mirrored glyph, which actively teaches the
confusion the lesson exists to prevent. Pitch and yaw get a gentle wobble because
neither can mirror a letter — they only foreshorten it.

If you ever add "satisfying" tumbling to the flick, you have broken the app.

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
