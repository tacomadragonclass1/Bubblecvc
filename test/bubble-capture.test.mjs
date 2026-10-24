// Regression test for the stuck-letter bug: two dice flung at one bubble, where
// popping released only one and the other was stranded inside forever.
import * as THREE from '../vendor/three.module.js';
import { createBubbles, layoutFor, canAccept, fillBubble, popBubble, reserveBubble } from '../src/bubbles.js';
import { startCapture } from '../src/physics.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra='') => {
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
const fresh = () => createBubbles(scene, layoutFor(3, bounds, 3.6)).bubbles;

console.log('\n1. the window that caused the bug');
{
  const bubbles = fresh();
  const b = bubbles[1];
  const a = mkDie('a'), o = mkDie('o');
  ok('an empty bubble accepts', canAccept(b) === true);
  // Die `a` is accepted and begins its 0.26s suck-in.
  startCapture(a, b);
  ok('a die in flight CLAIMS the bubble', b.inbound === a);
  ok('a second die is now refused (this is the fix)', canAccept(b) === false,
     'canAccept still true -> both dice would be accepted');
  // Before the fix, canAccept was still true here because b.die is only set
  // when the capture FINISHES, so `o` was accepted too.
  fillBubble(b, a);
  ok('the claim clears once it lands', b.inbound === null);
  ok('the bubble now holds exactly one', b.dice.length === 1);
  ok('b.die still reads as the held die', b.die === a);
  ok('a full bubble refuses another', canAccept(b) === false);
}

console.log('\n2. popping releases EVERYTHING (the rule from classroom use)');
{
  const bubbles = fresh();
  const b = bubbles[0];
  const a = mkDie('a'), o = mkDie('o');
  // Force the broken state directly, as if something had got past the guard.
  fillBubble(b, a);
  b.inbound = null;
  fillBubble(b, o);
  ok('both dice are held, neither overwritten', b.dice.length === 2,
     'held ' + b.dice.length);
  const freed = popBubble(b);
  ok('pop returns BOTH', freed.length === 2, 'returned ' + freed.length);
  ok('pop returned the first die too', freed.includes(a));
  ok('the bubble is empty afterwards', b.dice.length === 0);
  ok('b.die reads empty', b.die === null);
  ok('lens magnification undone on both', a.scale.x === 1 && o.scale.x === 1);
}

console.log('\n3. the ordinary single-letter path is unchanged');
{
  const bubbles = fresh();
  const b = bubbles[2];
  const t = mkDie('t');
  startCapture(t, b);
  fillBubble(b, t);
  const freed = popBubble(b);
  ok('pop returns one die', freed.length === 1 && freed[0] === t);
  ok('pop started the animation', b.popping === 1);
  ok('a popping bubble is empty', b.die === null);
  ok('inbound cleared by the pop', b.inbound === null);
}

console.log('\n4. b.die is read-only, so the old bug cannot come back');
{
  const bubbles = fresh();
  const b = bubbles[0];
  let threw = false;
  try { b.die = mkDie('x'); } catch { threw = true; }
  ok('assigning b.die throws instead of losing a die', threw);
}

console.log('\n5. a die already inbound is not double-counted');
{
  const bubbles = fresh();
  const b = bubbles[1];
  const a = mkDie('a');
  reserveBubble(b, a);
  fillBubble(b, a);
  fillBubble(b, a);               // a repeat must not duplicate it
  ok('filling twice with the same die holds one', b.dice.length === 1);
}

console.log('\n' + (fail ? '✗ ' + fail + ' FAILED, ' : '✓ all ') + pass + ' passed');
process.exit(fail ? 1 : 0);
