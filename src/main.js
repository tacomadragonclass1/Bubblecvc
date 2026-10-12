// ----------------------------------------------------------------------- main
// Scene assembly, input, and the small state machine that turns three captured
// dice into a spoken word.
//
// ORDER OF PLAY - worth reading before changing it. The spec says the child
// works "left to right", but notes 4 and 5 describe starting with the VOWEL and
// adding a coda to make a word family (-ot), then adding the onset. Those are
// only compatible if "left to right" means the COLUMNS map to fixed bubbles,
// not that slots must be filled in sequence. So:
//
//   bay column -> bubble slot is fixed (onset->0, vowel->1, coda->2)
//   fill order is free
//
// That is strictly more capable and it is what makes word-family work possible:
// park `o` and `t`, hear "ot", then try `h`, `p`, `c` in front of it.

import * as THREE from '../vendor/three.module.js';
import { createOcean, updateOcean, makeWater } from './ocean.js';
import { createBubbles, updateBubbles, fillBubble, popBubble, bubbleAt, bubbleHit, layoutFor } from './bubbles.js';
import { createDie, applyWobble, layoutBay, COLUMN, DIE_SIZE } from './dice.js';
import * as P from './physics.js';
import * as A from './audio.js';
import { createPrescreen } from './prescreen.js';

const FOV = 45;
const CAM_Z = 26;

let renderer, scene, camera, waterScene, waterCam, water;
let ocean, bubbleSet, bubbles;
let bounds = { x: 19, y: 10.8 };
let bayTop = -4.6;
let dice = [];                 // every die currently in the bay or in motion
let board = null;              // the letter sets chosen on the prescreen
let prescreen, homeBtn, replayBtn;
let running = false;
let clock = null;
let lastSpoken = '';           // guards against re-speaking the same state

const SLOTS = 3;

// --------------------------------------------------------------------- setup
function init() {
  const canvas = document.getElementById('stage');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setClearColor(0x04253f, 1);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);
  camera.position.set(0, 0, CAM_Z);

  // The water is drawn by its own clip-space camera so it always fills the
  // frame no matter how the play camera is framed or resized.
  waterScene = new THREE.Scene();
  waterCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  water = makeWater();
  waterScene.add(water);

  resize();
  window.addEventListener('resize', resize);

  ocean = createOcean(scene, bounds);

  prescreen = createPrescreen(document.body, startSession);
  homeBtn = document.getElementById('home');
  replayBtn = document.getElementById('replay');
  wireChrome();
  wirePointer(canvas);

  clock = { t: performance.now() / 1000, elapsed: 0 };
  renderer.setAnimationLoop(frame);
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();

  const halfH = CAM_Z * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  bounds = { x: halfH * camera.aspect, y: halfH };
  bayTop = -bounds.y * 0.42;

  water.material.uniforms.uAspect.value.set(Math.max(1, camera.aspect), 1);

  // A live session has to re-lay its furniture, or a rotated tablet drops the
  // bay off the bottom of the screen.
  if (running && board) relayout();
}

// ----------------------------------------------------------------- session
function startSession(chosen) {
  board = chosen;
  prescreen.hide();
  running = true;
  lastSpoken = '';

  A.unlock();
  A.preloadPhonemes([...board.onset, ...board.vowel, ...board.coda]);

  buildBubbles();
  buildBay();

  homeBtn.hidden = false;
  replayBtn.hidden = false;
}

function endSession() {
  running = false;
  for (const d of dice) scene.remove(d);
  dice = [];
  if (bubbleSet) { scene.remove(bubbleSet.group); bubbleSet = null; bubbles = null; }
  homeBtn.hidden = true;
  replayBtn.hidden = true;
  homeArmed = false;
  homeBtn.classList.remove('armed');
  prescreen.show();
}

function buildBubbles() {
  if (bubbleSet) scene.remove(bubbleSet.group);
  bubbleSet = createBubbles(scene, layoutFor(SLOTS, bounds, bounds.y * 0.30));
  bubbles = bubbleSet.bubbles;
}

function buildBay() {
  for (const d of dice) scene.remove(d);
  dice = [];
  const sets = [board.onset, board.vowel, board.coda];
  for (const place of layoutBay(sets, bounds, bayTop)) {
    const die = createDie(place.ch);
    die.position.set(place.x, place.y, place.z);
    die.userData.home.set(place.x, place.y, place.z);
    die.userData.col = place.col;
    scene.add(die);
    dice.push(die);
  }
}

function relayout() {
  const layout = layoutFor(SLOTS, bounds, bounds.y * 0.30);
  bubbles.forEach((b, i) => {
    b.home.set(layout[i].x, layout[i].y, 0);
    b.mesh.position.copy(b.home);
  });
  const sets = [board.onset, board.vowel, board.coda];
  const places = layoutBay(sets, bounds, bayTop);
  let k = 0;
  for (const die of dice) {
    const p = places[k++];
    if (!p) continue;
    die.userData.home.set(p.x, p.y, p.z);
    if (die.userData.state === 'bay') die.position.copy(die.userData.home);
  }
}

// ------------------------------------------------------------------- chrome
let homeArmed = false, homeArmTimer = null;

function wireChrome() {
  // Double-tap to leave, exactly as in the braille app: the button stays
  // VISIBLE and legible, and the second tap is the guard. Hiding it from the
  // child by making it dim is not the mechanism - it has to be findable by an
  // adult across a classroom.
  homeBtn.addEventListener('pointerdown', e => {
    e.stopPropagation();
    A.unlock();
    if (homeArmed) {
      clearTimeout(homeArmTimer);
      homeArmed = false;
      homeBtn.classList.remove('armed');
      endSession();
    } else {
      homeArmed = true;
      homeBtn.classList.add('armed');
      homeArmTimer = setTimeout(() => {
        homeArmed = false;
        homeBtn.classList.remove('armed');
      }, 1600);
    }
  });

  // Replay. UFLI's routine is "say each sound, then blend" - teachers need to
  // re-hear that without destroying the word, and every bubble gesture pops.
  replayBtn.addEventListener('pointerdown', e => {
    e.stopPropagation();
    A.unlock();
    const w = currentWord();
    if (w.letters.length >= 2) A.blend(w.letters, { thenWhole: w.letters.length >= 2 });
    else if (w.letters.length === 1) A.playPhoneme(w.letters[0]);
  });
}

// ------------------------------------------------------------------- pointer
let drag = null;

function toWorld(ev) {
  const ndc = new THREE.Vector2(
    (ev.clientX / window.innerWidth) * 2 - 1,
    -(ev.clientY / window.innerHeight) * 2 + 1
  );
  // Unproject onto the z = 0 play plane.
  const v = new THREE.Vector3(ndc.x, ndc.y, 0.5).unproject(camera);
  const dir = v.sub(camera.position).normalize();
  const t = -camera.position.z / dir.z;
  return camera.position.clone().add(dir.multiplyScalar(t));
}

function dieAt(p) {
  // Generous square hit test - a fingertip on a wall panel is wide, and dice
  // in the bay never overlap, so there is no ambiguity to resolve.
  const r = DIE_SIZE * 0.85;
  for (const d of dice) {
    if (d.userData.state !== 'bay') continue;
    if (Math.abs(p.x - d.position.x) < r && Math.abs(p.y - d.position.y) < r) return d;
  }
  return null;
}

function wirePointer(canvas) {
  canvas.addEventListener('pointerdown', e => {
    if (!running) return;
    A.unlock();
    const p = toWorld(e);

    // Popping takes priority: a filled bubble is a bigger, likelier target than
    // anything behind it, and clearing a slot is the chain move.
    const hit = bubbleHit(bubbles, p);
    if (hit && hit.die) {
      const die = popBubble(hit);
      A.sfxPop();
      P.sendHome(die);
      lastSpoken = '';
      return;
    }

    const die = dieAt(p);
    if (!die) return;
    canvas.setPointerCapture(e.pointerId);
    drag = {
      die,
      id: e.pointerId,
      grabOffset: new THREE.Vector3(die.position.x - p.x, die.position.y - p.y, 0),
      samples: [{ x: p.x, y: p.y, t: performance.now() / 1000 }],
    };
    die.userData.wobbleScale = 0.4;
  });

  canvas.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const p = toWorld(e);
    drag.die.position.set(p.x + drag.grabOffset.x, p.y + drag.grabOffset.y, 0.3);
    drag.samples.push({ x: p.x, y: p.y, t: performance.now() / 1000 });
    if (drag.samples.length > 24) drag.samples.shift();
  });

  const release = e => {
    if (!drag || e.pointerId !== drag.id) return;
    const die = drag.die;
    const { vx, vy } = P.velocityFromGesture(drag.samples, performance.now() / 1000);
    const speed = Math.hypot(vx, vy);
    drag = null;

    // A flick must carry some upward intent. A sideways swipe or a slow drop is
    // not a throw, and is returned without comment - never a failure sound.
    if (speed < P.MIN_LAUNCH_SPEED || vy <= 0.1) {
      die.userData.wobbleScale = 1;
      P.sendHome(die);
      return;
    }
    const strength = P.launch(die, vx, vy);
    A.sfxFlick(strength);
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
}

// --------------------------------------------------------------- word state
function currentWord() {
  const letters = [];
  const slots = [];
  for (let i = 0; i < SLOTS; i++) {
    const b = bubbles[i];
    if (b && b.die) { letters.push(b.die.userData.ch); slots.push(i); }
    else { letters.push(null); slots.push(null); }
  }
  const filled = letters.filter(Boolean);
  return { letters: filled, raw: letters, count: filled.length };
}

/**
 * Decide what, if anything, to say after a capture.
 *   vowel + coda, no onset  -> the VC chunk ("ot"), the word-family move
 *   all three               -> sounds, then the whole word
 * Guarded by lastSpoken so re-entering the same state does not re-trigger.
 */
function speakIfReady() {
  const { raw } = currentWord();
  const [onset, vowel, coda] = raw;
  let seq = null;

  if (onset && vowel && coda) seq = [onset, vowel, coda];
  else if (!onset && vowel && coda) seq = [vowel, coda];

  if (!seq) { lastSpoken = ''; return; }
  const key = seq.join('');
  if (key === lastSpoken) return;
  lastSpoken = key;

  A.sfxComplete();
  // Small delay so the capture glug has room before the voice starts.
  setTimeout(() => A.blend(seq, { thenWhole: true }), 260);
}

// ---------------------------------------------------------------- main loop
function frame() {
  const now = performance.now() / 1000;
  const dt = Math.min(0.05, now - clock.t);
  clock.t = now;
  clock.elapsed += dt;
  const t = clock.elapsed;

  water.material.uniforms.uTime.value = t;
  updateOcean(ocean, bounds, t, dt);

  if (running) {
    updateBubbles(bubbles, t, dt);

    for (const die of dice) {
      const u = die.userData;
      switch (u.state) {
        case 'flying': {
          const ev = P.stepFlight(die, dt, { bounds, bayTop, bubbles, targetSlot: u.col });
          if (ev && ev.type === 'wall') {
            A.sfxWall(ev.speed / 14);
          } else if (ev && ev.type === 'captured') {
            P.startCapture(die, ev.bubble);
            A.sfxCapture();
          } else if (ev && ev.type === 'missed') {
            A.sfxMiss();
            P.sendHome(die);
          }
          break;
        }
        case 'capturing':
          if (P.stepCapture(die, dt)) {
            fillBubble(u.capBubble, die);
            A.playPhoneme(u.ch);
            setTimeout(speakIfReady, 120);
          }
          break;
        case 'returning':
          P.stepReturn(die, dt);
          break;
      }
      if (u.state !== 'captured') applyWobble(die, t);
    }
  }

  renderer.autoClear = true;
  renderer.render(waterScene, waterCam);
  renderer.autoClear = false;
  renderer.render(scene, camera);
}

init();

// A small inspection handle. Not debug cruft: a 3D flick game cannot be unit
// tested meaningfully, so the way to check physics changes is to drive it from
// the console and read the state back. Keep it.
window.__bubblecvc = {
  get dice() { return dice.map(d => ({
    ch: d.userData.ch, state: d.userData.state, col: d.userData.col,
    x: +d.position.x.toFixed(2), y: +d.position.y.toFixed(2),
    v: d.userData.vel ? [+d.userData.vel.x.toFixed(1), +d.userData.vel.y.toFixed(1)] : null,
    bounces: d.userData.bounces,
  })); },
  get slots() { return bubbles ? bubbles.map(b => b.die ? b.die.userData.ch : null) : null; },
  get word() { return currentWord(); },
  get bounds() { return bounds; },
  get bayTop() { return bayTop; },
  /** Launch a die by letter, in world units per second - bypasses the gesture. */
  throwDie(ch, vx, vy) {
    const d = dice.find(x => x.userData.ch === ch && x.userData.state === 'bay');
    if (!d) return 'no bay die ' + ch;
    P.launch(d, vx, vy);
    return 'launched ' + ch;
  },
};
