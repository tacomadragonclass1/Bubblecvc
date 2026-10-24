# Creature models

Drop CC0 glTF/GLB sea-life models here and list them in `manifest.json`.
**Everything here is optional** — with no manifest the app falls back to the
procedural creatures in `src/ocean.js` and runs exactly as before.

## What is shipped here

7 CC0 models from the **Quaternius Animated Fish Pack**, fetched via Poly Pizza
(which mirrors the pack as GLB; quaternius.com serves FBX/OBJ/Blend only).
Every one is a single skinned mesh with one `Swim` clip. 528 KB for the set.

Plus **one CC-BY model**, the octopus — see Attribution below. It is the only
asset here that is not CC0, because no CC0 octopus of usable quality exists
(checked 2026-10-24: Quaternius has none in any of its 83 packs, and every
octopus on Poly Pizza is CC-BY 3.0).

| file | used as | note |
| --- | --- | --- |
| `fish-a/b/c.glb` | fish | the three background fish |
| `manta-ray.glb` | fish | scaled up — it is a big animal |
| `shark.glb` | **hero** | the periodic hero pass — see `src/shark.js` |
| `whale.glb` | shark | the deep, slow lane |
| `dolphin.glb` | dolphin | the deep lane. Filed under `octopus` until 2026-10-24 — it is a dolphin, and calling it an octopus hid the fact that there was no octopus |
| `octopus.glb` | reefOctopus | **CC-BY**, see below. The reef dweller in `src/octopus.js` |

## Attribution — REQUIRED for `octopus.glb`

> **Octopus** by **Poly by Google**, licensed **CC-BY 3.0**.
> Source: https://poly.pizza/m/9F8QJKUT77V
> Licence: https://creativecommons.org/licenses/by/3.0/

CC-BY requires that credit be given. Keep this entry, and the matching one in
the repository README, if the model ships. Everything else here is CC0 and
needs no credit.

**Modified from the original.** The source mesh is static — no animation clips
at all. It was rigged and animated here with `tools/rig_octopus.py` (Blender):
a four-bone chain down the body, weights assigned by height, and a 3 s looping
`Idle` clip in which each bone lags the one above it so a travelling wave runs
down the arms. Geometry is untouched (3,150 tris); the file grew 150 KB -> 312 KB,
which is the animation data. CC-BY permits modification provided credit stands.

## Where to get more

**Quaternius Animated Fish Pack** — CC0, 7 aquatic species, rigged and animated.

- GLB (preferred): https://poly.pizza/bundle/Animated-Fish-Bundle-ZkGbjS8m8g
- The quaternius.com page offers FBX/OBJ/Blend only, which this loader does
  **not** read. Take the GLB from Poly Pizza.

CC0 means no attribution is required, so these can ship inside this repo.

## manifest.json

```json
{
  "fish":    [ { "file": "clownfish.glb", "scale": 1.0, "yaw": 1.5708 },
               { "file": "tuna.glb",      "scale": 1.2, "yaw": 1.5708 } ],
  "shark":   [ { "file": "shark.glb",     "scale": 1.4, "yaw": 1.5708 } ],
  "octopus": [ { "file": "octopus.glb",   "scale": 0.9, "yaw": 1.5708 } ]
}
```

- `yaw` — radians needed to make the model face **+X**, the direction the ocean
  assumes a creature swims. If a fish swims backwards, this is the knob
  (`1.5708` = 90°, `3.1416` = 180°).
  ⛔ **Every model in this pack needs `1.5708`.** They point down +Z. Shipping
  them at `yaw: 0` had the whole cast swimming sideways — invisible at
  background scale, glaring once the shark was scaled up. Measure a new model,
  do not assume: with the pack loaded, a skinned mesh's X extent should be its
  length.
- `scale` — a multiplier *after* the loader normalises every model to a common
  size, so you are nudging, not converting units.
- `clip` — optional animation name; omitted plays the first clip.

Listing several entries under one kind makes the ocean pick randomly between
them, which is the cheap way to get a varied reef.

Models that 404 or fail to parse are skipped silently — a missing asset must
never be the thing that stops a phonics lesson.

## These files are COMMITTED, not ignored

The models and `manifest.json` belong in git. GitHub Pages serves whatever is in
the repo, so a gitignored model would load locally and 404 in the classroom.
CC0 is exactly what makes committing them fine — no attribution, no licence file,
no redistribution restriction.

Keep the pack lean: these are low-poly models and the whole set should stay well
under ~10 MB. A classroom panel on tired school wifi has to fetch them.
