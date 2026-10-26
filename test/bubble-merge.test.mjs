// Bubble merging: the gesture that welds two bubbles into one long bubble so a
// teacher can show the rime as a single unit.
//
// ⛔ WHY THIS IS A UNIT TEST AND NOT A BROWSER CHECK. The gesture is a finger
// drag, and in this project a finger drag cannot be observed: synthetic pointer
// events do not reliably deliver pointerdown through remote automation, and rAF
// is throttled to ~1Hz, so an animation cannot be watched either. Every rule
// here was therefore written to be checkable off the DOM - the decision in
// src/weld.js is pure, and the geometry in src/bubbles.js can be stepped by
// hand with a fake clock.
import * as THREE from '../vendor/three.module.js';
import {
  createBubbles, updateBubbles, resizeBubbles, layoutFor, canAccept, fillBubble,
  popBubble, filmDice, filmSpan, films, weldState, aimWelds, commitWelds, lobePitch,
  JOIN_AT,
} from '../src/bubbles.js';
import {
  beginWeldGesture, extendWeldGesture, weldPreview, resolveWeldGesture, isTap, TAP_REACH,
} from '../src/weld.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  -> ' + extra : '')); }
};

const scene = new THREE.Scene();
const bounds = { x: 19, y: 10.8 };
const mkDie = ch => {
  const d = new THREE.Object3D();
  d.userData = { ch, state: 'flying', home: new THREE.Vector3(0, -8, 0) };
  return d;
};
const fresh = () => createBubbles(scene, layoutFor(3, bounds, 3.6));

/** Run the real update loop for `secs` of scene time at 60fps. */
const run = (set, secs, t0 = 0) => {
  const dt = 1 / 60;
  let t = t0;
  for (let i = 0; i < Math.round(secs / dt); i++) { t += dt; updateBubbles(set, t, dt); }
  return t;
};

/** A finger sweep from slot a to slot b, as the pointer handler builds it. */
const sweepGesture = (set, a, b) => {
  const g = beginWeldGesture(a);
  const step = b >= a ? 1 : -1;
  for (let i = a; i !== b + step; i += step) {
    extendWeldGesture(g, i, Math.abs(set.bubbles[i].pos.x - set.bubbles[a].pos.x));
  }
  return g;
};

console.log('\n1. the gesture: a sweep welds, a tap pops, a wander does NEITHER');
{
  const set = fresh();
  const r = set.bubbles[0].r;

  // A tap: down and up on one bubble, barely moving.
  const tap = extendWeldGesture(beginWeldGesture(1), 1, 0.1);
  ok('a tap on one bubble resolves to a pop',
     resolveWeldGesture(tap, weldState(set), r).kind === 'pop');

  // A sweep from the vowel to the coda: one boundary crossed.
  const rime = sweepGesture(set, 1, 2);
  const d = resolveWeldGesture(rime, weldState(set), r);
  ok('a sweep across two bubbles resolves to a weld', d.kind === 'weld');
  ok('and it welds exactly the boundary between them',
     JSON.stringify(d.preview.bs) === '[1]', JSON.stringify(d.preview));
  ok('the sweep is NOT read as a tap', !isTap(rime, r));

  // ⛔ The case that must not pop: a finger that starts and ends on the same
  // bubble but swung a long way out in between. That is an abandoned drag, and
  // popping it would destroy a letter the teacher never meant to touch.
  const wander = extendWeldGesture(beginWeldGesture(0), null, r * (TAP_REACH + 0.5));
  const dw = resolveWeldGesture(wander, weldState(set), r);
  ok('a wandering gesture that crosses no boundary does NOTHING', dw.kind === 'none',
     'resolved to ' + dw.kind);

  // Onset side, explicitly - the feature has to work on both ends of the word.
  const onset = sweepGesture(set, 0, 1);
  ok('a sweep on the ONSET side welds boundary 0',
     JSON.stringify(resolveWeldGesture(onset, weldState(set), r).preview.bs) === '[0]');

  // A sweep right to left reads the same as left to right.
  const back = sweepGesture(set, 2, 1);
  ok('direction does not matter',
     JSON.stringify(resolveWeldGesture(back, weldState(set), r).preview.bs) === '[1]');
}

console.log('\n2. one sweep makes the bubble, the same sweep takes it apart');
{
  const set = fresh();
  const r = set.bubbles[0].r;
  const g = sweepGesture(set, 1, 2);

  let d = resolveWeldGesture(g, weldState(set), r);
  ok('first sweep WELDS', d.preview.on === true);
  commitWelds(set, d.preview);
  ok('committed', weldState(set)[1] === true);

  d = resolveWeldGesture(sweepGesture(set, 1, 2), weldState(set), r);
  ok('an identical second sweep UNWELDS', d.preview.on === false);
  commitWelds(set, d.preview);
  ok('and the boundary is open again', weldState(set)[1] === false);
}

console.log('\n3. a sweep across all three is ONE decision, not two');
{
  const set = fresh();
  const r = set.bubbles[0].r;
  let d = resolveWeldGesture(sweepGesture(set, 0, 2), weldState(set), r);
  ok('it crosses both boundaries', JSON.stringify(d.preview.bs) === '[0,1]');
  ok('and welds them both', d.preview.on === true);
  commitWelds(set, d.preview);

  // ⛔ The half-merged case is the one that would be unpredictable if the
  // toggle were decided per boundary: a board with the rime already welded,
  // swept across all three, must become ONE bubble - not flip to the other
  // half-merged board.
  const half = fresh();
  commitWelds(half, { bs: [1], on: true });
  d = resolveWeldGesture(sweepGesture(half, 0, 2), weldState(half), r);
  ok('a sweep over a half-merged row welds the REST, it does not flip it',
     d.preview.on === true && JSON.stringify(d.preview.bs) === '[0,1]',
     JSON.stringify(d.preview));

  // And only once everything is welded does the same sweep undo it.
  commitWelds(half, d.preview);
  d = resolveWeldGesture(sweepGesture(half, 0, 2), weldState(half), r);
  ok('a sweep over a fully merged row takes it all apart', d.preview.on === false);
}

console.log('\n4. the merged shape: one film, two lobes, a waist you can see');
{
  const set = fresh();
  const r = set.bubbles[0].r;
  run(set, 0.3);
  ok('three separate films to begin with', films(set).length === 3);
  ok('the slot row is untouched by a weld that has not happened',
     filmSpan(set.bubbles[1]) === 1);

  commitWelds(set, { bs: [1], on: true });
  run(set, 0.6);                       // the weld animation is ~0.2s

  ok('the vowel and coda now share ONE film', films(set).length === 2);
  ok('and that film spans two slots', filmSpan(set.bubbles[1]) === 2);
  ok('the onset is still its own bubble', filmSpan(set.bubbles[0]) === 1);
  ok('the film is led by the LEFT slot of the pair',
     set.bubbles[2].lead === set.bubbles[1]);

  const lead = set.bubbles[1];
  const u = lead.mat.uniforms;
  ok('the shader is told it has two lobes', u.uLobes.value === 2);
  ok('the neck fillet has opened', u.uNeck.value[1] > 0.2, 'neck ' + u.uNeck.value[1]);

  // ⭐ The pedagogical requirement, as a number. The lobes must OVERLAP (or the
  // waist is a bridge of empty water rather than one bubble) but must not
  // overlap so far that the two letters stop having their own lobes.
  const sep = lobePitch(set, 1);
  ok('the lobes overlap, so it reads as one bubble', sep < 2.0, 'pitch ' + sep.toFixed(3) + 'r');
  ok('but the waist is still clearly a waist', sep > 1.5, 'pitch ' + sep.toFixed(3) + 'r');
  // Half-width of the circle where two spheres of radius r, `sep` apart, meet.
  const waist = Math.sqrt(1 - (sep / 2) ** 2);
  ok('the waist is roughly half a lobe wide - two shapes, one envelope',
     waist > 0.40 && waist < 0.70, 'waist ' + waist.toFixed(3) + 'r');

  // ⭐ The row stays CENTRED rather than anchored. Merging the rime makes the
  // word physically shorter, so every slot shifts a little toward the middle -
  // which keeps the board composed under a camera that never moves. The onset
  // moves, but it must not move anything like a bubble's width.
  const drift = set.bubbles[0].pos.x - set.bubbles[0].base.x;
  ok('the onset leans in with the row, it does not relocate',
     drift > 0 && drift < r * 0.3, 'drifted ' + drift.toFixed(3));
  // Tolerance is the sway amplitude (0.29 units), because these are LIVE
  // positions. Dropping the recentring would put this at 1.8.
  const mid3 = (set.bubbles[0].pos.x + set.bubbles[2].pos.x) / 2;
  ok('and the row is still centred on the camera', Math.abs(mid3) < 0.32,
     'centre at ' + mid3.toFixed(4));
}

console.log('\n5. ⛔ no lobe ever JUMPS - the handover frame must not flinch');
{
  // The film takes over from the separate bubbles at the exact weld amount
  // where the lobes become tangent, which is why the lobes keep their own bob
  // until that point and only then start moving as one body. If that is ever
  // broken, a letter visibly twitches the instant the bubble forms.
  //
  // ⭐ TWO DIFFERENT FAULTS, TWO DIFFERENT MEASUREMENTS, and conflating them is
  // what made the first version of this test useless. A merge legitimately
  // moves the lobes fast, so an absolute per-frame limit is either too loose to
  // catch anything or fails on correct motion.
  //
  //   SPIKE  - one frame travelling far further than the frames either side of
  //            it. That is a discontinuity, and it is what a snap looks like.
  //            Caught: lobes that did not begin closing until the film formed,
  //            then jumped inward by half the rim gap in one frame (ratio 4).
  //   SPEED  - smooth but too quick. Caught: a coherence fade that ran in half
  //            the time the neck did, so the lobes lurched into sync after the
  //            merge had already looked finished. Perfectly continuous, and
  //            perfectly wrong, so the spike test cannot see it.
  const dt = 1 / 60;
  const trace = (set, frames, t0) => {
    let t = t0;
    const prev = set.bubbles.map(b => b.pos.clone());
    const out = set.bubbles.map(() => []);
    for (let i = 0; i < frames; i++) {
      t += dt;
      updateBubbles(set, t, dt);
      set.bubbles.forEach((b, k) => {
        out[k].push(b.pos.distanceTo(prev[k]));
        prev[k].copy(b.pos);
      });
    }
    return { out, t };
  };
  // Each frame against its immediate neighbours: smooth easing gives ~1, an
  // isolated jump gives whatever multiple of the surrounding motion it is.
  const spike = v => {
    let worst = 0;
    for (let i = 1; i < v.length - 1; i++) {
      worst = Math.max(worst, v[i] / Math.max(v[i - 1], v[i + 1], 0.01));
    }
    return worst;
  };
  const peak = (v, r) => Math.max(...v) / dt / r;   // lobe radii per second

  const set = fresh();
  const r = set.bubbles[0].r;
  let t = run(set, 0.5, 0);

  commitWelds(set, { bs: [0, 1], on: true });
  let m = trace(set, 90, t); t = m.t;
  ok('merging has no frame that jumps past its neighbours',
     Math.max(...m.out.map(spike)) < 2.0,
     'spike ratio ' + Math.max(...m.out.map(spike)).toFixed(2));
  ok('and no lobe is hurried', Math.max(...m.out.map(v => peak(v, r))) < 3.0,
     'peak ' + Math.max(...m.out.map(v => peak(v, r))).toFixed(2) + ' r/s');
  ok('all three ended up in one film', films(set).length === 1);
  ok('and the shader is drawing three lobes', set.bubbles[0].mat.uniforms.uLobes.value === 3);

  commitWelds(set, { bs: [0, 1], on: false });
  m = trace(set, 90, t); t = m.t;
  ok('coming apart has no jump either', Math.max(...m.out.map(spike)) < 2.0,
     'spike ratio ' + Math.max(...m.out.map(spike)).toFixed(2));
  ok('nor is it hurried', Math.max(...m.out.map(v => peak(v, r))) < 3.0,
     'peak ' + Math.max(...m.out.map(v => peak(v, r))).toFixed(2) + ' r/s');
  ok('back to three films', films(set).length === 3);
  ok('and back at their layout positions',
     set.bubbles.every(b => Math.abs(b.pos.x - b.base.x) < 0.35));

  // The control: an untouched board, which must be nothing but the bob.
  const calm = fresh();
  const c = trace(calm, 120, run(calm, 0.5, 0));
  ok('an unmerged board is smooth as well', Math.max(...c.out.map(spike)) < 2.0,
     'spike ratio ' + Math.max(...c.out.map(spike)).toFixed(2));
  ok('and barely moves at all', Math.max(...c.out.map(v => peak(v, r))) < 0.5,
     'peak ' + Math.max(...c.out.map(v => peak(v, r))).toFixed(3) + ' r/s');
}

console.log('\n6. the handover happens at TANGENCY, which is why it is seamless');
{
  // JOIN_AT is derived from the gap and the pull, not tuned. At that weld
  // amount the lobes are exactly 2r apart - touching - and the fillet is still
  // zero, so one film drawing two tangent lobes is the same picture as two
  // bubbles touching. If this drifts, the merge gets a visible pop.
  const set = fresh();
  const r = set.bubbles[0].r;
  run(set, 0.4);
  set.welds[1].on = true;
  aimWelds(set, null);
  // Step until the film forms, then look at the geometry on that exact frame.
  const dt = 1 / 60;
  let t = 0.4, formed = false;
  for (let i = 0; i < 200 && !formed; i++) {
    t += dt; updateBubbles(set, t, dt);
    formed = filmSpan(set.bubbles[1]) === 2;
  }
  ok('the film formed', formed);
  // ⛔ The STILL pitch, not the live one: a lobe's position carries its bob,
  // and at the handover frame the lobes are deliberately still on their own
  // bobs, which is up to a seventh of a radius of difference.
  const sep = lobePitch(set, 1);
  ok('the lobes are tangent on the frame it forms', Math.abs(sep - 2) < 0.03,
     'pitch ' + sep.toFixed(4) + 'r');
  ok('and the neck fillet starts from nothing',
     set.bubbles[1].mat.uniforms.uNeck.value[1] < 0.04,
     'neck ' + set.bubbles[1].mat.uniforms.uNeck.value[1].toFixed(4));
  ok('JOIN_AT is the derived value, not a tuned one', Math.abs(JOIN_AT - 0.12 / 0.44) < 1e-9);
}

console.log('\n7. a merged bubble pops as ONE bubble');
{
  const set = fresh();
  const a = mkDie('a'), tt = mkDie('t'), c = mkDie('c');
  fillBubble(set.bubbles[0], c);
  fillBubble(set.bubbles[1], a);
  fillBubble(set.bubbles[2], tt);
  commitWelds(set, { bs: [1], on: true });
  run(set, 0.6);

  ok('the film holds both letters of the rime', filmDice(set.bubbles[1]).length === 2);
  ok('the onset film holds just its own', filmDice(set.bubbles[0]).length === 1);

  // Tapping EITHER lobe pops the whole film.
  const freed = popBubble(set.bubbles[2]);
  ok('tapping the far lobe releases BOTH letters', freed.length === 2,
     'released ' + freed.length);
  ok('both slots are empty', set.bubbles[1].die === null && set.bubbles[2].die === null);
  ok('the onset is untouched', set.bubbles[0].die === c);
  ok('lens magnification undone on both', freed.every(d => d.scale.x === 1));

  // ⛔ And while the merged film is bursting, NEITHER lobe accepts a die. A
  // version that read the pop state off the slot let a letter be thrown into
  // the far lobe of a bubble that was mid-rupture.
  ok('the tapped lobe refuses a die', canAccept(set.bubbles[2]) === false);
  ok('the OTHER lobe refuses too', canAccept(set.bubbles[1]) === false,
     'the far lobe of a popping merged bubble accepted a die');
  ok('a separate bubble is unaffected', canAccept(set.bubbles[0]) === false); // holds c
}

console.log('\n8. welds survive a resize; an unmerged board behaves exactly as before');
{
  const set = fresh();
  commitWelds(set, { bs: [1], on: true });
  run(set, 0.6);
  const r0 = set.bubbles[0].r;
  resizeBubbles(set, layoutFor(3, { x: 7, y: 12 }, 1.6));
  run(set, 0.6);
  ok('the bubbles got smaller', set.bubbles[0].r < r0);
  ok('the rime is still merged', filmSpan(set.bubbles[1]) === 2);
  const sep = lobePitch(set, 1);
  ok('and the merged shape is the same in units of the new radius',
     sep > 1.5 && sep < 2.0, 'pitch ' + sep.toFixed(3) + 'r');

  const plain = fresh();
  run(plain, 0.5);
  ok('an unwelded board still draws one lobe per bubble',
     plain.bubbles.every(b => b.mat.uniforms.uLobes.value === 1));
  ok('with no fillet', plain.bubbles.every(b => b.mat.uniforms.uNeck.value[1] === 0));
  ok('each slot leads its own film', plain.bubbles.every(b => b.lead === b));
  ok('at the original 6% gap', Math.abs(lobePitch(plain, 0) - 2.12) < 1e-9,
     'pitch ' + lobePitch(plain, 0).toFixed(4) + 'r');
}

console.log('\n' + (fail ? '✗ ' + fail + ' FAILED, ' : '✓ all ') + pass + ' passed');
process.exit(fail ? 1 : 0);
