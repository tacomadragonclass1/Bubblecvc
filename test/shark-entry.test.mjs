// Regression test for the one-frame flash before a shark pass.
//
// begin() made the holder visible but update() returned before ever setting a
// position, so the shark rendered once at a stale transform - (0,0,0) on the
// first pass of a session, which is the dead centre of the play plane at
// close-up scale.
import * as THREE from '../vendor/three.module.js';
import { createSharkPass } from '../src/shark.js';
import { halfWidthAt } from '../src/frustum.js';

let pass=0, fail=0;
const ok=(n,c,x='')=>{ if(c){pass++;console.log('  ✓ '+n);} else {fail++;console.log('  ✗ '+n+(x?'  -> '+x:''));} };

// A stand-in hero model with a real extent, so bodyHalfLength is meaningful.
const fakeCreatures = {
  make() {
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(40, 6, 6),
                             new THREE.MeshStandardMaterial());
    g.add(m);
    return g;
  },
};
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 16/9, 0.1, 200);
camera.position.z = 26;
const bounds = { x: 19.1, y: 10.8 };

console.log('\n1. the shark is never visible at a stale position');
{
  const shark = createSharkPass(scene, fakeCreatures);
  const holder = scene.children.find(o => o.type === 'Group');
  ok('holder exists and starts hidden', !!holder && holder.visible === false);

  // Drive it until a pass begins, checking EVERY frame that it is never
  // visible while sitting somewhere it could be seen.
  let t = 0, bad = null, becameVisibleAt = null;
  for (let i = 0; i < 60 * 400 && !becameVisibleAt; i++) {
    const dt = 1/60; t += dt;
    shark.update(t, dt, { live: true, idle: true, speaking: false, camera, bounds });
    if (holder.visible) {
      becameVisibleAt = { x: holder.position.x, y: holder.position.y, z: holder.position.z };
      // On the very frame it becomes visible it must already be off screen.
      const edge = halfWidthAt(camera, holder.position.z);
      if (Math.abs(holder.position.x) < edge) bad = { ...becameVisibleAt, edge };
    }
  }
  ok('a pass started', !!becameVisibleAt, 'none within 400s');
  ok('NOT at the origin when first shown',
     !!becameVisibleAt && (becameVisibleAt.x !== 0 || becameVisibleAt.y !== 0),
     becameVisibleAt ? JSON.stringify(becameVisibleAt) : '');
  ok('already off screen on the frame it is shown', bad === null,
     bad ? 'x=' + bad.x.toFixed(1) + ' inside edge ' + bad.edge.toFixed(1) : '');
}

console.log('\n2. a pass abandoned mid-screen cannot flash on the next one');
{
  const shark = createSharkPass(scene, fakeCreatures);
  const holder = scene.children[scene.children.length - 1];
  let t = 0;
  // run until it is mid-pass and clearly on screen
  for (let i = 0; i < 60 * 400; i++) {
    const dt = 1/60; t += dt;
    shark.update(t, dt, { live: true, idle: true, speaking: false, camera, bounds });
    if (shark.active && shark.progress > 0.5) break;
  }
  ok('reached mid-pass', shark.active && shark.progress > 0.5,
     'progress=' + shark.progress.toFixed(2));
  const midX = holder.position.x;
  // Home pressed: the lesson ends mid-pass. shark.end() hides it where it is.
  shark.update(t, 1/60, { live: false, idle: true, speaking: false, camera, bounds });
  ok('hidden when the lesson ends', !holder.visible);
  ok('and abandoned somewhere visible', Math.abs(midX) < halfWidthAt(camera, holder.position.z) + 40);
  // Next lesson. The next pass must not show it at that abandoned spot.
  shark.reschedule(t);
  let shown = null;
  for (let i = 0; i < 60 * 400 && !shown; i++) {
    const dt = 1/60; t += dt;
    shark.update(t, dt, { live: true, idle: true, speaking: false, camera, bounds });
    if (holder.visible) shown = holder.position.x;
  }
  ok('next pass does not reuse the abandoned position', shown !== null && shown !== midX,
     'shown at x=' + (shown === null ? 'never' : shown.toFixed(1)) + ', abandoned at ' + midX.toFixed(1));
  ok('and is off screen when shown', shown !== null &&
     Math.abs(shown) >= halfWidthAt(camera, holder.position.z));
}

console.log('\n' + (fail ? '✗ '+fail+' FAILED, ' : '✓ all ') + pass + ' passed');
process.exit(fail?1:0);
