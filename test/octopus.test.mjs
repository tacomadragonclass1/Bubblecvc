// The reef octopus is a state machine riding the reef conveyor. None of that
// needs a GPU, so it can be driven honestly here: simulate a fake reef whose
// bands travel and wrap exactly as updateReef makes them, then run thousands of
// frames and check the behaviour the classroom is supposed to see.
import * as THREE from '../vendor/three.module.js';
import { createReefOctopus } from '../src/octopus.js';

// A stand-in creature library. The real one needs a GPU-less GLTFLoader and a
// fetch, neither of which exists here - but every behaviour under test is about
// the state machine, which only needs SOMETHING shaped like a model instance.
function fakeCreatures() {
  return {
    make() {
      const h = new THREE.Group();
      const mk = (hex) => new THREE.MeshStandardMaterial({ color: new THREE.Color(hex) });
      const body = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), mk(0x9b7290));
      const suck = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 4), mk(0xf4f6ff));
      const pup  = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 4), mk(0x101018));
      h.add(body, suck, pup);
      h.userData.mixer = { timeScale: 1 };
      return h;
    },
  };
}
import { FLOOR_Y, Z_BACK, Z_FRONT, SPAN, TRAVEL } from '../src/reef.js';

let pass = 0, fail = 0;
const ok = (n, c, extra='') => { if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; console.log('  ✗ ' + n + (extra ? '  -> ' + extra : '')); } };

// A stand-in reef: 4 bands, each carrying tagged cluster Groups, laid out and
// recycled the way src/reef.js does it.
function fakeReef() {
  const bands = [];
  for (let i = 0; i < 4; i++) {
    const band = new THREE.Group();
    band.position.z = Z_BACK + (i * SPAN) / 4;
    for (let n = 0; n < 5; n++) {
      const c = new THREE.Group();
      c.position.set((n - 2) * 22, FLOOR_Y, (Math.random() - 0.5) * 12);
      c.userData.isCluster = true;
      c.userData.clusterScale = 1.6 + Math.random() * 1.8;
      band.add(c);
    }
    bands.push(band);
  }
  return { bands };
}

// One frame of updateReef's conveyor.
const advance = (reef, dt) => {
  for (const b of reef.bands) {
    b.position.z += TRAVEL * dt;
    if (b.position.z > Z_FRONT) b.position.z -= SPAN;
  }
};

const scene = new THREE.Scene();
let reef = fakeReef();
const octo = createReefOctopus(scene, fakeCreatures(), () => reef);

console.log('\n1. it stays away until a band wraps, then appears');
{
  octo.update(0, 0.016, {});
  ok('absent on the first frame', octo.state === null);
  // Run long enough for several band wraps (a full cycle is SPAN/TRAVEL ~57s).
  let t = 0, appearances = 0, wasOut = true;
  const seenModes = new Set(), blends = [];
  const ys = [], depths = [], depthsWithY = [];
  for (let i = 0; i < 60000; i++) {           // ~16 minutes of frames
    const dt = 1 / 60; t += dt;
    advance(reef, dt);
    octo.update(t, dt, {});
    const st = octo.state;
    if (st) {
      if (wasOut) { appearances++; wasOut = false; }
      seenModes.add(st.mode); blends.push(st.blend);
      depths.push(st.z); depthsWithY.push([st.z, st.y]);
    } else wasOut = true;
  }
  ok('it appeared more than once over 16 min', appearances > 1, 'appearances=' + appearances);
  ok('it also went AWAY between passes (sporadic)', appearances > 1 && wasOut !== undefined);
  ok('it rested, crawled AND jetted', seenModes.has('rest') && seenModes.has('crawl') && seenModes.has('jet'),
     [...seenModes].join(','));
  const lo = Math.min(...blends), hi = Math.max(...blends);
  ok('camouflage swings from vivid to nearly matched', lo < 0.2 && hi > 0.7,
     'blend range ' + lo.toFixed(2) + '..' + hi.toFixed(2));
  // ⛔ The bound here is DERIVED, not picked. Forward drift is
  //   Z_FRONT(-30) + cluster z jitter(+6) + anchor rnd(+2.5) + at.z clamp(+6)
  // = -15.5 at the very most. An earlier version asserted < -20, which is not an
  // invariant of anything - it just happened to hold on most seeds, and failed
  // the moment a seed pushed the drift to its real limit.
  ok('it stays behind the play plane at all times',
     Math.max(...depths) < -15, 'nearest z=' + Math.max(...depths).toFixed(1));
  // ⭐ The invariant that actually matters is about the SCREEN, not depth. The
  // octopus may come fairly far forward, but only while sinking out of the
  // bottom of frame with its garden - what must never happen is it drifting up
  // into the part of the picture the lesson uses. In screen terms (y as a
  // fraction of the visible half-height at its own depth) the bubble row sits
  // at about +0.34 and the dice bay at -0.42, so anything staying below -0.25
  // is clear of both by a wide margin and can never occlude a letter.
  const worstScreenY = Math.max(...depthsWithY.map(
    ([z, y]) => y / (Math.tan(22.5 * Math.PI / 180) * (26 - z))));
  ok('it never rises into the part of the screen the lesson uses',
     worstScreenY < -0.25, 'highest screen y=' + worstScreenY.toFixed(2) + ' (bubbles sit at +0.34)');
}

console.log('\n2. it never appears in plain view (the shark lesson)');
{
  // Every appearance must begin on a band at the FAR end of its travel.
  const r2 = fakeReef();
  const o2 = createReefOctopus(new THREE.Scene(), fakeCreatures(), () => r2);
  let t = 0, worst = -Infinity, n = 0, prev = null;
  for (let i = 0; i < 90000; i++) {
    const dt = 1 / 60; t += dt;
    advance(r2, dt);
    o2.update(t, dt, {});
    const st = o2.state;
    if (st && !prev) { worst = Math.max(worst, st.z); n++; }
    prev = st;
  }
  ok('every appearance started far back', n > 0 && worst < Z_BACK + 20,
     n + ' appearances, nearest entry z=' + (isFinite(worst) ? worst.toFixed(1) : 'n/a'));
}

console.log('\n3. a reef rebuild (resize) does not strand it');
{
  const r3 = { bands: fakeReef().bands };
  const o3 = createReefOctopus(new THREE.Scene(), fakeCreatures(), () => r3);
  let t = 0;
  for (let i = 0; i < 40000 && !o3.state; i++) { const dt=1/60; t+=dt; advance(r3,dt); o3.update(t,dt,{}); }
  ok('it is on the reef before the rebuild', o3.state !== null);
  r3.bands = fakeReef().bands;              // what a resize does
  o3.update(t, 1/60, {});
  ok('a rebuilt reef retires it instead of stranding it', o3.state === null);
  // and it can come back
  let back = false;
  for (let i = 0; i < 60000 && !back; i++) { const dt=1/60; t+=dt; advance(r3,dt); o3.update(t,dt,{}); back = !!o3.state; }
  ok('it recovers onto the new reef', back);
}

console.log('\n4. reduced motion keeps it present but calmer');
{
  const r4 = fakeReef();
  const o4 = createReefOctopus(new THREE.Scene(), fakeCreatures(), () => r4);
  let t = 0, jets = 0, frames = 0;
  for (let i = 0; i < 60000; i++) { const dt=1/60; t+=dt; advance(r4,dt); o4.update(t,dt,{reducedMotion:true});
    const st=o4.state; if (st) { frames++; if (st.mode==='jet') jets++; } }
  ok('still appears under reduced motion', frames > 0, 'visible frames=' + frames);
  ok('but jets less of the time', frames === 0 || jets / frames < 0.35,
     'jet share ' + (frames ? (jets/frames*100).toFixed(0) + '%' : 'n/a'));
}

console.log('\n5. debugShow puts it on the reef immediately');
{
  const r5 = fakeReef();
  const o5 = createReefOctopus(new THREE.Scene(), fakeCreatures(), () => r5);
  const msg = o5.debugShow();
  ok('debugShow lands it', o5.state !== null, msg);
}

console.log('\n' + (fail ? '✗ ' + fail + ' FAILED, ' : '✓ all ') + pass + ' passed');
process.exit(fail ? 1 : 0);

console.log('\n6. no model -> the feature switches off, it does not fall back to a blob');
{
  const o6 = createReefOctopus(new THREE.Scene(), { make: () => null }, () => fakeReef());
  ok('returns a dead stub', o6.state === null && o6.debugShow() === 'no octopus model');
  let threw = false;
  try { o6.update(0, 1/60, {}); } catch { threw = true; }
  ok('its update is a safe no-op', !threw);
}
console.log('\n' + (fail ? '✗ ' + fail + ' FAILED' : '✓ all passed') + ' (' + pass + ' checks)');
