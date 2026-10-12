# Creature models

Drop CC0 glTF/GLB sea-life models here and list them in `manifest.json`.
**Everything here is optional** — with no manifest the app falls back to the
procedural creatures in `src/ocean.js` and runs exactly as before.

## Where to get them

**Quaternius Animated Fish Pack** — CC0, 7 aquatic species, rigged and animated.

- GLB (preferred): https://poly.pizza/bundle/Animated-Fish-Bundle-ZkGbjS8m8g
- The quaternius.com page offers FBX/OBJ/Blend only, which this loader does
  **not** read. Take the GLB from Poly Pizza.

CC0 means no attribution is required, so these can ship inside this repo.

## manifest.json

```json
{
  "fish":    [ { "file": "clownfish.glb", "scale": 1.0, "yaw": 0 },
               { "file": "tuna.glb",      "scale": 1.2, "yaw": 0 } ],
  "shark":   [ { "file": "shark.glb",     "scale": 1.4, "yaw": 1.5708 } ],
  "octopus": [ { "file": "octopus.glb",   "scale": 0.9, "yaw": 0 } ]
}
```

- `yaw` — radians needed to make the model face **+X**, the direction the ocean
  assumes a creature swims. If a fish swims backwards, this is the knob
  (`1.5708` = 90°, `3.1416` = 180°).
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
