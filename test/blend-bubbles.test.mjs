// Blend bubbles: a teacher taps the open water beside the row to summon an
// extra onset or coda slot (`st-o-p`, `f-a-s-t`), and two-finger-taps one away.
//
// ⛔ Same reason as test/bubble-merge.test.mjs: these gestures cannot be
// observed in a browser here, so the decisions live in src/weld.js as pure
// functions and the board mutation is checked against the real bubble set.
import * as THREE from '../vendor/three.module.js';
import {
  createBubbles, updateBubbles, resizeBubbles, layoutFor, canAccept, fillBubble,
  insertBubble, dropBubble, films, filmSpan, commitWelds, weldState, lobePitch,
} from '../src/bubbles.js';
import { summonSide, twoFingerTarget, rowTouchAction, TWO_FINGER_MS } from '../src/weld.js';
import { stepFlight } from '../src/physics.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  -> ' + extra : '')); }
};

const scene = new THREE.Scene();
const bounds = { x: 19, y: 10.8 };
const ROW_Y = 3.6;
const ONSET = 0, VOWEL = 1, CODA = 2;

const mkDie = ch => {
  const d = new THREE.Object3D();
  d.userData = { ch, state: 'flying', home: new THREE.Vector3(0, -8, 0) };
  return d;
};

// The same shape model main.js keeps: onset slots, the vowel, coda slots.
const mkBoard = (onset = 1, coda = 1) => {
  const roleOf = i => (i < onset ? ONSET : i === onset ? VOWEL : CODA);
  const layout = layoutFor(onset + 1 + coda, bounds, ROW_Y)
    .map((g, i) => ({ ...g, role: roleOf(i) }));
  return createBubbles(scene, layout);
};
const relayout = (set, onset, coda) => {
  const roleOf = i => (i < onset ? ONSET : i === onset ? VOWEL : CODA);
  resizeBubbles(set, layoutFor(onset + 1 + coda, bounds, ROW_Y)
    .map((g, i) => ({ ...g, role: roleOf(i) })));
};
const rowOf = set => set.bubbles.map(b => ({ x: b.pos.x, y: b.pos.y, r: b.r }));
const run = (set, secs, t0 = 0) => {
  const dt = 1 / 60;
  let t = t0;
  for (let i = 0; i < Math.round(secs / dt); i++) { t += dt; updateBubbles(set, t, dt); }
  return t;
};

console.log('\n1. where a tap summons, and where it must NOT');
{
  const set = mkBoard();
  run(set, 0.3);
  const row = rowOf(set);
  const r = set.bubbles[0].r;
  const L = row[0], R = row[2];

  ok('open water left of the row summons an ONSET slot',
     summonSide({ x: L.x - r * 2.2, y: ROW_Y }, row) === 'onset');
  ok('open water right of the row summons a CODA slot',
     summonSide({ x: R.x + r * 2.2, y: ROW_Y }, row) === 'coda');
  ok('a tap ON the end bubble summons nothing',
     summonSide({ x: L.x, y: ROW_Y }, row) === null);
  ok('nor does one in the sliver between two bubbles',
     summonSide({ x: (row[0].x + row[1].x) / 2, y: ROW_Y }, row) === null);

  // ⛔ The one that matters. The bay of dice is also off to the left and right,
  // lower down - a teacher reaching for a letter must not conjure a bubble.
  ok('a tap down at BAY height summons nothing, however far out it is',
     summonSide({ x: L.x - r * 2.2, y: -6 }, row) === null,
     'reaching for an onset die would summon a bubble');
  ok('nor one above the row', summonSide({ x: R.x + r * 3, y: ROW_Y + r * 2.4 }, row) === null);
  ok('just outside the end bubble is still the bubble, not open water',
     summonSide({ x: L.x - r * 1.1, y: ROW_Y }, row) === null);
}

console.log('\n2. two-finger tap only removes what may be removed');
{
  // Board is s-t-o-p: two onset slots, one coda.
  const removable = [0];                 // only the summoned onset slot
  ok('two fingers on the summoned bubble remove it',
     twoFingerTarget(0, 0, removable) === 0);
  ok('two fingers on the VOWEL remove nothing',
     twoFingerTarget(2, 2, removable) === null);
  ok('two fingers on the last coda remove nothing',
     twoFingerTarget(3, 3, removable) === null);
  ok('one finger on a core bubble and one on the summoned one takes the summoned one',
     twoFingerTarget(1, 0, removable) === 0);
  ok('a lone finger is never a removal', twoFingerTarget(0, null, removable) === null);
  ok('with two summoned bubbles, the SECOND finger decides',
     twoFingerTarget(0, 1, [0, 1]) === 1);
}

console.log('\n3. ⛔ growing the board must not disturb what is already on it');
{
  // Build c-a-t, weld the rime, THEN summon an onset slot in front of it.
  const set = mkBoard(1, 1);
  const c = mkDie('c'), a = mkDie('a'), t = mkDie('t');
  fillBubble(set.bubbles[0], c);
  fillBubble(set.bubbles[1], a);
  fillBubble(set.bubbles[2], t);
  commitWelds(set, { bs: [1], on: true });
  run(set, 0.6);
  ok('the rime is merged to begin with', filmSpan(set.bubbles[1]) === 2);
  const phases = set.bubbles.map(b => b.phase);

  relayout(set, 2, 1);
  insertBubble(set, 0, { x: -14, y: ROW_Y, r: set.bubbles[0].r, role: ONSET });
  relayout(set, 2, 1);
  run(set, 0.4);

  ok('the row is four slots', set.bubbles.length === 4);
  ok('every letter is still in its bubble',
     set.bubbles.map(b => (b.die ? b.die.userData.ch : '_')).join('') === '_cat',
     set.bubbles.map(b => (b.die ? b.die.userData.ch : '_')).join(''));
  // ⭐ The weld has to follow the same two LETTERS, not the same two indices.
  ok('the rime is STILL merged, and still around a and t',
     filmSpan(set.bubbles[2]) === 2 && set.bubbles[3].lead === set.bubbles[2],
     'films: ' + films(set).map(l => l.members.map(m => m.die ? m.die.userData.ch : '_').join('')).join('|'));
  ok('and the onset is not welded to anything', filmSpan(set.bubbles[1]) === 1);
  ok('the existing bubbles kept their idle phase, so nothing re-shuffled',
     set.bubbles.slice(1).every((b, i) => b.phase === phases[i]));
  ok('roles came out right', set.bubbles.map(b => b.role).join('') === '0012');

  // And removing it puts everything back.
  const freed = dropBubble(set, 0);
  relayout(set, 1, 1);
  run(set, 0.4);
  ok('dropping an empty summoned bubble frees nothing', freed.length === 0);
  ok('back to three slots', set.bubbles.length === 3);
  ok('letters all still there', set.bubbles.map(b => b.die.userData.ch).join('') === 'cat');
  ok('and the rime is still merged', filmSpan(set.bubbles[1]) === 2);
}

console.log('\n4. a dismissed bubble never eats the letter inside it');
{
  const set = mkBoard(2, 1);
  const sD = mkDie('s'), tD = mkDie('t');
  fillBubble(set.bubbles[0], sD);
  fillBubble(set.bubbles[1], tD);
  run(set, 0.3);
  const freed = dropBubble(set, 0);
  ok('the letter comes back out', freed.length === 1 && freed[0] === sD);
  ok('and its lens magnification is undone', sD.scale.x === 1);
  ok('the other onset letter is untouched', set.bubbles[0].die === tD);
  ok('the row shrank', set.bubbles.length === 3);
}

console.log('\n5. the bay feeds by ROLE: onset bay -> any onset slot');
{
  const set = mkBoard(2, 1);                  // s-t-o-p shape
  run(set, 0.3);
  const ctx = { bounds, bayTop: -8, bubbles: set.bubbles };

  // A die thrown up under the LEFT onset bubble is magnetised to that one.
  const d1 = mkDie('s');
  d1.position.set(set.bubbles[0].pos.x, -2, 0);
  d1.userData.vel = new THREE.Vector3(0, 20, 0);
  d1.userData.flightT = 0;
  let got = null;
  for (let i = 0; i < 200 && !got; i++) {
    const ev = stepFlight(d1, 1 / 60, { ...ctx, targetRole: ONSET });
    if (ev && ev.type === 'captured') got = ev.bubble;
    if (ev && ev.type === 'missed') break;
  }
  ok('an onset die reaches an onset slot', !!got);
  ok('and it is the one it was thrown at', got && got.index === 0,
     got ? 'landed in slot ' + got.index : 'never landed');
  if (got) fillBubble(got, d1);

  // The second onset die must go to the OTHER onset slot, not bounce off.
  const d2 = mkDie('t');
  d2.position.set(set.bubbles[1].pos.x, -2, 0);
  d2.userData.vel = new THREE.Vector3(0, 20, 0);
  d2.userData.flightT = 0;
  let got2 = null;
  for (let i = 0; i < 200 && !got2; i++) {
    const ev = stepFlight(d2, 1 / 60, { ...ctx, targetRole: ONSET });
    if (ev && ev.type === 'captured') got2 = ev.bubble;
    if (ev && ev.type === 'missed') break;
  }
  ok('the second onset die finds the remaining onset slot', got2 && got2.index === 1,
     got2 ? 'landed in slot ' + got2.index : 'never landed');

  // ⛔ And a vowel die thrown at the same place must NOT be swallowed by an
  // onset bubble - role filtering is the whole guard.
  const v = mkDie('o');
  v.position.set(set.bubbles[0].pos.x, -2, 0);
  v.userData.vel = new THREE.Vector3(0, 20, 0);
  v.userData.flightT = 0;
  let wrong = null;
  for (let i = 0; i < 200; i++) {
    const ev = stepFlight(v, 1 / 60, { ...ctx, targetRole: VOWEL });
    if (ev && ev.type === 'captured') { wrong = ev.bubble; break; }
    if (ev && ev.type === 'missed') break;
  }
  ok('a vowel die is never captured by an onset bubble',
     !wrong || wrong.role === VOWEL,
     wrong ? 'captured by slot ' + wrong.index + ' role ' + wrong.role : 'fell home');
}

console.log('\n6. the row still lays out sensibly as it grows');
{
  for (const [on, co] of [[1, 1], [2, 1], [1, 2], [2, 2], [3, 3]]) {
    const set = mkBoard(on, co);
    run(set, 0.3);
    const n = on + 1 + co;
    const widest = Math.max(...set.bubbles.map(b => Math.abs(b.pos.x) + b.r));
    ok(`${n} slots fit on screen`, widest <= bounds.x + 0.01,
       'reaches ' + widest.toFixed(2) + ' vs bounds ' + bounds.x);
    ok(`${n} slots keep the 6% gap`, Math.abs(lobePitch(set, 0) - 2.12) < 1e-9);
    ok(`${n} slots: the vowel is slot ${on}`, set.bubbles[on].role === VOWEL);
  }
}

console.log('\n7. the vowel dye reaches the shader, and only the vowel lobe');
{
  const set = mkBoard(2, 1);
  for (const b of set.bubbles) b.tint = b.role === VOWEL ? 1 : 0;
  run(set, 0.3);
  const vowel = set.bubbles[2];
  ok('an unmerged vowel bubble is dyed', vowel.mat.uniforms.uLobeTint.value[0] === 1);
  ok('its neighbours are not',
     set.bubbles[0].mat.uniforms.uLobeTint.value[0] === 0
     && set.bubbles[1].mat.uniforms.uLobeTint.value[0] === 0);

  // ⭐ Welded to the coda, only the vowel's LOBE may be pink.
  commitWelds(set, { bs: [2], on: true });
  run(set, 0.6);
  const lead = set.bubbles[2].lead;
  ok('the vowel is now one film with the coda', filmSpan(set.bubbles[2]) === 2);
  ok('the vowel lobe is dyed', lead.mat.uniforms.uLobeTint.value[0] === 1);
  ok('the coda lobe in the SAME film is not',
     lead.mat.uniforms.uLobeTint.value[1] === 0,
     'tints ' + JSON.stringify(lead.mat.uniforms.uLobeTint.value));
}

console.log('\n8. ⛔ the two bugs that only showed up driving the real page');
{
  // Both of these got through review and were caught by synthetic pointer
  // events against the live app, which is why the arbitration is pure now.
  const removable = [0];
  const T = 10000;

  // (a) A finger whose pointerup never arrived must NOT turn the next ordinary
  // tap into a removal. The first version used a five-second stale window and
  // a stale finger still ate the very next tap.
  const stale = { slot: 1, t: T };
  ok('a fresh second finger removes',
     rowTouchAction({ slot: 1, t: T }, T + 150, 0, removable, false).kind === 'remove');
  ok('a STALE finger is ignored, and the tap is an ordinary first finger',
     rowTouchAction(stale, T + TWO_FINGER_MS + 1, 0, removable, false).kind === 'first',
     'a forgotten finger would delete a bubble on the next tap');
  ok('and the window is short enough to expire before a realistic next tap',
     TWO_FINGER_MS <= 1500, TWO_FINGER_MS + 'ms');

  // (b) A second finger landing MID-SWEEP is a fumble. It must cancel - never
  // remove the bubble being merged, and never leave the first gesture running.
  // Leaving it running let the second finger overwrite weldDrag, orphaning a
  // live weld preview that nothing reverted: the boundary finished its merge
  // animation and LOOKED welded while the committed state said it was not.
  const r = rowTouchAction({ slot: 0, t: T }, T + 150, 1, removable, true);
  ok('a second finger mid-sweep does not remove anything', r.kind === 'cancel',
     'resolved to ' + r.kind);
  ok('but it still ends the first gesture', r.kind !== 'first',
     'leaving the first gesture running orphans its weld preview');

  // Nothing removable under either finger: still cancels, never pops.
  ok('two fingers on unremovable bubbles cancel rather than fall through',
     rowTouchAction({ slot: 2, t: T }, T + 100, 2, [], false).kind === 'cancel');
  ok('a lone finger is always just a first finger',
     rowTouchAction(null, T, 1, removable, false).kind === 'first');
}

console.log('\n' + (fail ? '✗ ' + fail + ' FAILED, ' : '✓ all ') + pass + ' passed');
process.exit(fail ? 1 : 0);
