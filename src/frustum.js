// ------------------------------------------------------------------ frustum
// How wide the visible world is at a given depth.
//
// ⛔ THE BUG THIS EXISTS TO KILL. `bounds` is the half-extent of the PLAY PLANE
// at z = 0 — where the bubbles and dice live. Everything else in this scene
// lives behind it (creatures at z −18…−50, reef bands at −30…−112) or now in
// front of it (the hero shark), and at those depths the frustum is a completely
// different size: 21 units of half-width at the play plane is 46 at the nearest
// reef band and 114 at the farthest.
//
// Using bounds.x for any of them has produced three separate bugs:
//   * fish blipping in and out of existence a third of the way in from the
//     screen edge, instead of swimming off it
//   * the reef leaving the left and right of the sea bed empty
//   * the hero shark vanishing in open water at the end of its pass
//
// They all look like different bugs and they are all this one. Anything being
// placed or recycled at a depth other than 0 asks here.

import * as THREE from '../vendor/three.module.js';

/** Half the visible HEIGHT in world units at depth `z`. */
export function halfHeightAt(camera, z) {
  const dist = Math.max(0.001, camera.position.z - z);
  return Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * dist;
}

/** Half the visible WIDTH in world units at depth `z`. Aspect-dependent, so it
 *  must be recomputed after a resize rather than cached at construction. */
export function halfWidthAt(camera, z) {
  return halfHeightAt(camera, z) * camera.aspect;
}
