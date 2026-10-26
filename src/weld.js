// ----------------------------------------------------------------------- weld
// The gesture that merges bubbles, as pure state - no THREE, no DOM, no scene.
//
// ⛔⛔ THIS FILE EXISTS BECAUSE THE GESTURE CANNOT BE TESTED IN A BROWSER.
// requestAnimationFrame is throttled to about 1Hz under remote inspection and
// synthetic clicks do not reliably deliver pointerdown, so every previous
// attempt to check an input rule by driving the real page produced a wrong
// answer. Keeping the decision - weld, unweld, pop, or do nothing - in a pure
// reducer means it can be tested for real, and main.js is left with nothing but
// plumbing.
//
// ⭐⭐ THE GESTURE ACTS ON THE BOUNDARY BETWEEN TWO LETTERS, NOT ON THE
// BUBBLES.
//
// That one decision is what makes the whole feature small. A finger laid across
// the vowel and the coda crosses one boundary and welds it; a finger dragged
// across all three crosses both and welds both; and a finger dragged across an
// already-welded pair crosses the same boundary and takes it apart again. There
// is no separate "unmerge" gesture to teach, and the three-bubble case is not a
// special case - it falls out of counting boundaries.
//
// ⭐ THE RESULT COMES FROM THE RANGE OF SLOTS TOUCHED, NOT FROM THE PATH.
// A teacher's finger on a 75" panel does not travel in a straight line, it may
// dip below the row between two bubbles, and it may arrive at the second bubble
// from underneath. Taking min..max of every slot the finger was over means a
// wobbly sweep, a diagonal, and a finger that skips the middle bubble entirely
// all do the obvious thing.

/**
 * ⭐ HOW A DRAG IS TOLD APART FROM A TAP THAT POPS.
 *
 * Two independent tests, and BOTH have to pass for a pop:
 *
 *   1. the gesture never left the slot it started on, and
 *   2. the finger never moved more than this far from where it went down.
 *
 * The first is the real rule. The second covers the case the first cannot see:
 * a finger that starts on a bubble, swings out well past the row, and comes
 * back to the same bubble. That reads as an abandoned drag, not a tap, and the
 * safe answer is to do NOTHING - popping destroys a letter mid-chain, so an
 * ambiguous gesture must never pop.
 *
 * In units of the bubble radius, so it scales with the board.
 */
export const TAP_REACH = 0.62;

/** Begin a bubble gesture at the slot the finger went down on. */
export function beginWeldGesture(slotIndex) {
  return { lo: slotIndex, hi: slotIndex, reach: 0 };
}

/**
 * Fold in one pointer sample. `slotIndex` may be null - a finger that strays off
 * the row entirely does not narrow the range, it just does not widen it.
 * `reach` is the distance from the down point, in world units.
 */
export function extendWeldGesture(g, slotIndex, reach) {
  if (slotIndex !== null && slotIndex !== undefined) {
    if (slotIndex < g.lo) g.lo = slotIndex;
    if (slotIndex > g.hi) g.hi = slotIndex;
  }
  if (reach > g.reach) g.reach = reach;
  return g;
}

/**
 * What releasing the finger right now would do to the welds, or null if the
 * gesture spans no boundary at all.
 *
 * ⭐ TOGGLE, decided over the WHOLE range at once: if every boundary the finger
 * crossed is already welded the gesture takes them apart, otherwise it welds
 * all of them. Deciding per-boundary instead would make a sweep across all
 * three bubbles flip a half-merged board into the other half-merged board,
 * which is unpredictable to a teacher in front of a class. This way one sweep
 * always means "make this one bubble", and a second identical sweep always
 * means "put it back".
 */
export function weldPreview(g, welds) {
  const bs = [];
  for (let k = g.lo; k < g.hi; k++) bs.push(k);
  if (!bs.length) return null;
  return { bs, on: !bs.every(k => welds[k]) };
}

/** Did this gesture stay put enough to count as a tap on one bubble? */
export function isTap(g, r) {
  return g.lo === g.hi && g.reach <= TAP_REACH * r;
}

/**
 * The single decision, for the frame the finger lifts.
 * @returns {{kind:'weld', preview}|{kind:'pop'}|{kind:'none'}}
 */
export function resolveWeldGesture(g, welds, r) {
  const preview = weldPreview(g, welds);
  if (preview) return { kind: 'weld', preview };
  if (isTap(g, r)) return { kind: 'pop' };
  return { kind: 'none' };
}
