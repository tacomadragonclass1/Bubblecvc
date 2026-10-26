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

// --------------------------------------------------------------- summoning
/**
 * ⭐⭐ TAPPING THE EMPTY WATER BESIDE THE ROW SUMMONS A BLEND BUBBLE.
 *
 * Which side decides which kind: past the left end of the row is an ONSET slot
 * (`st-o-p`), past the right end is a CODA slot (`f-a-s-t`). That matches the
 * bays, which sit on the same sides of the screen and which the new bubble is
 * fed from, and it matches the word, which runs left to right.
 *
 * ⛔ The band matters as much as the side. The test is "beside the BUBBLE ROW",
 * not "anywhere on that half of the screen" - the bay of dice is also off to
 * the left and right, lower down, and a teacher reaching for a letter must not
 * conjure a bubble instead. So a tap only summons if it is within a bubble's
 * height of the row.
 *
 * @param p        tap position in world units
 * @param row      every slot's live centre, left to right: [{x, y, r}, ...]
 * @returns 'onset' | 'coda' | null
 */
export function summonSide(p, row) {
  if (!row.length) return null;
  const first = row[0], last = row[row.length - 1];
  const r = first.r;
  if (Math.abs(p.y - first.y) > r * 1.5) return null;
  // The margin is the capture-zone width, so the dead band between "this is
  // the end bubble" and "this is open water" is the same forgiveness the rest
  // of the board uses.
  if (p.x < first.x - r * 1.3) return 'onset';
  if (p.x > last.x + r * 1.3) return 'coda';
  return null;
}

// ---------------------------------------------------------------- removing
/**
 * ⭐⭐ TWO FINGERS ON A SUMMONED BUBBLE TAKE IT AWAY.
 *
 * ⛔ It has to be two fingers, and the reason is that every one-finger gesture
 * on the row is already spoken for: one finger down then up is a pop, one
 * finger dragged across a boundary is a weld. A second finger is the only input
 * left that cannot be confused with either, and it is also an action a child
 * leaning on the panel will not produce by accident.
 *
 * ⭐ It fires on the SECOND FINGER LANDING, not on release. Waiting for both to
 * lift means watching two pointers for an indeterminate time while the first
 * finger's weld preview is still animating underneath, and a teacher who has
 * put two fingers on a bubble has already said what they want. It is also
 * cheaply undone - tap the empty water and the bubble comes back.
 *
 * Only a SUMMONED slot can go. The vowel never can, and neither can the last
 * onset or the last coda: a board must always be able to spell a CVC word.
 *
 * @returns the slot index to remove, or null
 */
/**
 * ⛔⛔ HOW CLOSE IN TIME TWO FINGERS MUST LAND - and the same number is how
 * long a finger may sit unaccounted for before it is treated as gone.
 *
 * Those two have to be ONE number, and splitting them was a real bug. A
 * pointerup can go missing - the finger leaves the canvas, the panel glitches,
 * the browser swallows it - and that finger then looks like a finger that is
 * still down, so the teacher's next ordinary tap becomes a "second finger" and
 * silently deletes a bubble. A generous stale window does not fix that, it
 * moves it: five seconds was tried and a stale finger still ate the very next
 * tap. The window has to be short enough that a forgotten finger has expired
 * before any realistic next tap, and long enough that two fingers put down
 * together are always inside it. A deliberate two-finger tap lands inside
 * ~200ms; a teacher tapping twice in a row is slower than this.
 */
export const TWO_FINGER_MS = 1200;

/**
 * What a finger landing on the bubble row means, given whatever is already
 * down. Pure so it can actually be tested - both of the bugs this encodes got
 * through review and were only caught by driving the real page.
 *
 * @param first      the finger already on the row: { slot, t } or null
 * @param now        timestamp of this landing
 * @param slot       the slot this finger landed on
 * @param candidates removable slots within the two fingers' film
 * @param firstMoved has the first finger travelled far enough to be a sweep?
 * @returns {kind:'first'}                 - behave as an ordinary first finger
 *          {kind:'cancel'}                - end the first gesture, do nothing
 *          {kind:'remove', slot}          - end it and dismiss that bubble
 */
export function rowTouchAction(first, now, slot, candidates, firstMoved) {
  // ⛔ A finger older than the window is not a finger, it is a leak.
  if (!first || now - first.t > TWO_FINGER_MS) return { kind: 'first' };
  // ⛔ A second finger landing mid-sweep is a FUMBLE, not a removal: it would
  // delete the very bubble the teacher was merging. It still ends the first
  // gesture, because two fingers on the row is never a weld and never a pop -
  // and because leaving the first gesture running let the second finger
  // overwrite it, orphaning a live weld preview that nothing then reverted.
  if (firstMoved) return { kind: 'cancel' };
  const target = twoFingerTarget(first.slot, slot, candidates);
  return target === null ? { kind: 'cancel' } : { kind: 'remove', slot: target };
}

export function twoFingerTarget(slotA, slotB, removable) {
  if (slotA === null || slotB === null) return null;
  // Both fingers have to be on the same bubble, or on the same merged film -
  // the caller resolves film membership and passes the candidates.
  const cand = removable.filter(i => i === slotA || i === slotB);
  if (!cand.length) return null;
  // If the two fingers are on different removable bubbles, take the one the
  // SECOND finger landed on: that is the deliberate one.
  return cand.includes(slotB) ? slotB : cand[0];
}
