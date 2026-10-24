// ------------------------------------------------------------------ creatures
// Loads real modelled sea life from glTF/GLB, replacing the procedural
// sphere-and-cone creatures in ocean.js.
//
// ⭐ THIS IS ENTIRELY OPTIONAL AND FAILS SOFT. If `assets/creatures/manifest.json`
// is missing, or a model 404s, or the GPU chokes on one, the ocean silently
// keeps its procedural creatures and the app works exactly as before. The reason
// is deployment: this ships to GitHub Pages and runs on a classroom panel, and
// a missing asset must never be the thing that stops a phonics lesson.
//
// WHY MODELS AT ALL: the procedural fish/octopus/shark were squashed spheres
// with cones stuck on. Abstract scenery (rocks, kelp, caustics) reads fine built
// that way, but anything the eye recognises as an ANIMAL does not - failed
// realism looks worse than honest abstraction. Rocks and kelp stay procedural.
//
// Sourcing: CC0 wherever possible, so most of the pack ships inside this public
// classroom repo with no attribution burden. Quaternius' animated fish pack is
// the reference. ⚠️ ONE EXCEPTION as of 2026-10-24: `octopus.glb` is CC-BY 3.0,
// because no CC0 octopus of usable quality exists - Quaternius has none in any
// of its 83 packs and every octopus on Poly Pizza is CC-BY. CC-BY is fine here
// provided the credit stands: see the Attribution section of
// assets/creatures/README.md and the repository README. If you add assets,
// prefer CC0 and only reach for CC-BY when there is genuinely no alternative.

import * as THREE from '../vendor/three.module.js';
import { GLTFLoader } from '../vendor/jsm/GLTFLoader.js';
import { makeUnderwater } from './lightwater.js';

const MANIFEST = 'assets/creatures/manifest.json';

/**
 * Manifest shape - each entry describes one model and how to orient it, because
 * every artist points their models down a different axis:
 *
 * {
 *   "fish":    [ { "file": "clownfish.glb", "scale": 1.0, "yaw": 0, "clip": "Swim" } ],
 *   "shark":   [ { "file": "shark.glb",     "scale": 1.4, "yaw": 1.5708 } ],
 *   "octopus": [ { "file": "octopus.glb",   "scale": 0.9, "yaw": 0 } ]
 * }
 *
 * `yaw` is the rotation (radians) needed to make the model face +X, which is
 * the direction ocean.js assumes a creature swims. `clip` names the animation
 * to play; omitted means "use the first one".
 */

export async function loadCreatures(renderer) {
  let manifest;
  try {
    const res = await fetch(MANIFEST, { cache: 'no-cache' });
    if (!res.ok) return null;
    manifest = await res.json();
  } catch {
    return null;   // no manifest: procedural creatures stay
  }

  const loader = new GLTFLoader();
  const library = {};   // kind -> [{ scene, clips, scale, yaw, clipName }]
  let loaded = 0;

  const entries = [];
  for (const [kind, list] of Object.entries(manifest)) {
    for (const spec of list) entries.push([kind, spec]);
  }

  await Promise.all(entries.map(([kind, spec]) =>
    new Promise(resolve => {
      loader.load(
        'assets/creatures/' + spec.file,
        gltf => {
          // Normalise: centre the model on its own bounding box and scale it to
          // a known size, so a pack whose models are 100x the size of another
          // still drops in without hand-tuning every entry.
          const root = gltf.scene;
          const box = new THREE.Box3().setFromObject(root);
          const size = new THREE.Vector3();
          box.getSize(size);
          // ⭐ Normalise to a REAL WORLD SIZE, not to 1.
          //
          // Scaling the longest axis to 1 unit seems tidy and is wrong: the
          // procedural fish these replace are roughly 2-3 world units long, and
          // the spawn scales in ocean.js (0.55-0.9) assume that. Normalising to
          // 1 made every creature 3-4x too small - they loaded, animated, and
          // were effectively invisible at ~20px on a classroom panel.
          //
          // The value is larger than the raw procedural size because creatures
          // live 18-50 units BEHIND the play plane and shrink with distance.
          const TARGET_LENGTH = 5.6;
          const longest = Math.max(size.x, size.y, size.z) || 1;
          const norm = TARGET_LENGTH / longest;

          // ⛔ The recentring offset is STORED, not applied here.
          //
          // Setting root.position = -centre and then scaling the same node is
          // wrong: a node's position is not affected by its own scale, so the
          // offset stays at full size while the mesh shrinks - which flung each
          // fish up to 8 unscaled units away from its lane and made them look
          // like they had vanished. The offset has to be scaled by the same
          // factor, which can only happen once the spawn scale is known.
          // Caustics on the fish as well. A fish lit like it is in air while
          // the rock beside it is dappled is the most obvious possible tell.
          // Less fog than the reef - a creature should stay readable against
          // the water rather than dissolving into it.
          root.traverse(o => {
            if (!o.isMesh) return;
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of mats) makeUnderwater(m, { caustics: 0.5, fog: 0.5 });
          });

          const centre = new THREE.Vector3();
          box.getCenter(centre);

          (library[kind] = library[kind] || []).push({
            scene: root,
            clips: gltf.animations || [],
            scale: (spec.scale || 1) * norm,
            centre,
            yaw: spec.yaw || 0,
            clipName: spec.clip || null,
          });
          loaded++;
          resolve();
        },
        undefined,
        () => resolve()    // a model that fails to load is simply absent
      );
    })
  ));

  if (!loaded) return null;

  const mixers = [];

  /**
   * Instance one creature of the given kind, or null if the pack has none -
   * ocean.js then falls back to its procedural builder for that kind.
   */
  function make(kind, scale = 1) {
    const variants = library[kind];
    if (!variants || !variants.length) return null;
    const v = variants[Math.floor(Math.random() * variants.length)];

    // SkeletonUtils.clone is what GLTFLoader's own docs point at for skinned
    // meshes - a plain Object3D.clone() shares the skeleton and every instance
    // ends up playing the same animation in lockstep.
    const inst = cloneSkinned(v.scene);

    // The orientation fix goes on a WRAPPER, so ocean.js can keep setting
    // rotation.y on the outer object to turn a creature around without having
    // to know anything about how the artist built it.
    const holder = new THREE.Group();
    const k = v.scale * scale;
    inst.rotation.y = v.yaw;
    inst.scale.setScalar(k);
    // Recentre in the SCALED frame, so the model sits on its lane position
    // rather than orbiting it.
    inst.position.copy(v.centre).multiplyScalar(-k);
    holder.add(inst);

    if (v.clips.length) {
      const mixer = new THREE.AnimationMixer(inst);
      const clip = (v.clipName && THREE.AnimationClip.findByName(v.clips, v.clipName))
        || v.clips[0];
      const action = mixer.clipAction(clip);
      action.play();
      // Each instance runs its swim cycle at a slightly different rate and
      // offset, or a school of fish beats its tails in perfect unison.
      action.timeScale = 0.8 + Math.random() * 0.5;
      mixer.setTime(Math.random() * clip.duration);
      mixers.push(mixer);
      holder.userData.mixer = mixer;
    }

    // Same reasoning as the hero shark: these are animated skinned meshes, and
    // three.js culls them against their BIND POSE bounds. A creature popping
    // out while still on screen is indistinguishable from the lane-edge bug
    // that used to make them blink, and this removes the second cause.
    holder.frustumCulled = false;
    holder.traverse(o => { o.frustumCulled = false; });
    holder.userData.modelled = true;
    return holder;
  }

  function update(dt) {
    for (const m of mixers) m.update(dt);
  }

  function dispose() {
    for (const list of Object.values(library)) {
      for (const v of list) {
        v.scene.traverse(o => {
          if (o.isMesh) {
            o.geometry.dispose();
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of mats) m && m.dispose && m.dispose();
          }
        });
      }
    }
    mixers.length = 0;
  }

  return { make, update, dispose, kinds: Object.keys(library), count: loaded };
}

/**
 * Minimal skinned clone. three.js keeps SkeletonUtils in examples/, and we
 * already vendor it, but this avoids a second import for the common case and
 * makes the skeleton-sharing hazard explicit at the call site.
 */
function cloneSkinned(source) {
  const clone = source.clone(true);
  const srcBones = [];
  const dstBones = [];
  source.traverse(o => srcBones.push(o));
  clone.traverse(o => dstBones.push(o));

  clone.traverse(node => {
    if (!node.isSkinnedMesh) return;
    const i = dstBones.indexOf(node);
    const srcMesh = srcBones[i];
    const skeleton = srcMesh.skeleton;
    const bones = skeleton.bones.map(b => dstBones[srcBones.indexOf(b)]);
    node.bind(new THREE.Skeleton(bones, skeleton.boneInverses), node.bindMatrix);
  });
  return clone;
}
