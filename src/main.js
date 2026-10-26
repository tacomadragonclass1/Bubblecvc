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
import { createReef, updateReef, loadCoral } from './reef.js';
import { createBubbles, updateBubbles, fillBubble, popBubble, bubbleHit, slotAt, layoutFor,
         resizeBubbles, disposeBubbles, aimWelds, commitWelds, weldState, filmDice,
         filmSpan, films } from './bubbles.js';
import { beginWeldGesture, extendWeldGesture, weldPreview, resolveWeldGesture } from './weld.js';
import { createDie, applyWobble, layoutBay, DIE_SIZE, disposeDie } from './dice.js';
import * as P from './physics.js';
import * as A from './audio.js';
import { createPrescreen } from './prescreen.js';
import { createPopFX } from './pop.js';
import { createInk } from './ink.js';
import { loadCreatures } from './creatures.js';
import { createSharkPass } from './shark.js';
import { createReefOctopus } from './octopus.js';
import { updateWater } from './lightwater.js';

const FOV = 45;
const CAM_Z = 26;

let renderer, scene, camera, waterScene, waterCam, water;
let ocean, reef, bubbleSet, bubbles, popFX, ink = null, creatures = null, shark = null, octopus = null;
let sharkWasActive = false;   // edge-detect for the octopus's predator reaction
let bounds = { x: 19, y: 10.8 };
let bayTop = -4.6;
let dice = [];                 // every die currently in the bay or in motion
let board = null;              // the letter sets chosen on the prescreen
let prescreen, homeBtn, replayBtn;
let running = false;
let clock = null;
let lastSpoken = '';           // guards against re-speaking the same state
// Scene time at which the spoken blend finishes. The shark pass reads this: the
// board can look perfectly still while a word is still coming out of the
// speakers, and that is the worst possible moment to move something big behind
// the letters.
//
// ⛔ NOT a boolean cleared when A.blend() resolves. blend() SCHEDULES the whole
// sequence on the audio clock and returns its length in seconds - the promise
// settles as soon as the buffers are queued, about a quarter of a second in,
// with two more seconds of speech still to come. Measured: the flag cleared at
// frame 142 for a word that was still playing. The returned duration is the
// real end, so that is what gets stored.
let blendUntil = 0;
// Debug only, driven from window.__bubblecvc.timeScale. Lets the pop sequence
// be watched frame by frame - the timing in pop.js was tuned this way.
let timeScale = 1;
let bubbleY = 0;
let reefRebuildTimer = null;

const SLOTS = 3;

// ⭐ Spell one of these and the shark comes.
//
// The payoff is deliberately AFTER the blend: summon() only makes a pass due,
// and the ordinary idle gate holds it until the spoken word has finished. A
// child spells it, hears it said back, and then the water goes dark.
//
// Kept as a set because the obvious next request is a second word. Lower case,
// and only words the board can actually spell with three dice.
//
// `fin` joined `big` after a week in the classroom. Both need letters that are
// NOT in the prescreen default (b/i/g and f/i/n all have to be chosen), so
// neither fires by accident during an unrelated drill - which is what keeps the
// surprise worth having.
const SUMMON_WORDS = new Set(['big', 'fin']);

// Respected throughout the idle animations and the pop. Motion is reduced, never
// removed: the bubbles still have to read as suspended in water.
const reducedMotion = window.matchMedia
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// --------------------------------------------------------------------- setup
function init() {
  const canvas = document.getElementById('stage');
  renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setClearColor(0x031d33, 1);
  // Cap DPR at 2: a classroom panel is enormous and a 3x buffer buys nothing
  // visible while costing a lot of fill rate on a weak TV SoC.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  // ACES keeps the bright caustics and the bubble rim from clipping to flat
  // white, which is what made the first pass look like a web demo rather than
  // a rendered scene. Exposure is slightly over 1 so the water stays luminous.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

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

  reef = createReef(scene, bounds, camera, CAM_Z);
  ocean = createOcean(scene, bounds, null, camera);
  popFX = createPopFX(scene);
  ink = createInk(scene);

  // Modelled coral, if the asset is there. Same fail-soft rule as the creature
  // pack: the reef is already on screen with its procedural coral by the time
  // this resolves, and a missing file just leaves it that way.
  //
  // ⛔ The reef has to be REBUILT, not patched. Each band is merged into a
  // handful of meshes at construction time, so there is no longer any such
  // thing as "the brain coral in band 2" to swap out - the only way to use the
  // models is to build the bands again with them.
  loadCoral().then(set => {
    if (!set) return;
    reef.dispose();
    reef = createReef(scene, bounds, camera, CAM_Z);
    console.info('[bubblecvc] modelled coral loaded:', Object.keys(set).join(', '));
  });

  // Modelled sea life, if a pack has been dropped in. Asynchronous and entirely
  // optional: the scene is already running with procedural creatures by the time
  // this resolves, and if it finds nothing it simply leaves them alone.
  loadCreatures(renderer).then(lib => {
    if (!lib) return;
    creatures = lib;
    // Rebuild just the swimmers, now that real models are available.
    scene.remove(ocean.group);
    ocean = createOcean(scene, bounds, creatures, camera);
    // The hero shark needs a real model and returns null without one, in which
    // case there is simply no event - same fail-soft rule as the rest of the
    // pack. Built once; resize does not rebuild it.
    shark = createSharkPass(scene, creatures);
    // ⛔ Handed a GETTER, not `reef`. A resize disposes and rebuilds the reef,
    // and a stored reference would leave the octopus parented to a dead band.
    // ⛔ Both arguments are GETTERS, not values. A resize disposes and rebuilds
    // the reef, and relayout() moves the bubble row - a stored reference would
    // leave him parented to a dead band or hanging where the row used to be.
    octopus = createReefOctopus(scene, creatures, () => reef, vowelBubbleLayout);
    // The models can finish loading after a lesson has already started.
    if (shark && running) shark.reschedule(clock.elapsed);
    console.info('[bubblecvc] modelled creatures loaded:', lib.count, lib.kinds.join(', '));
  });

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
  // In portrait the bubbles are necessarily smaller (width is the constraint),
  // so the row drops toward the middle - otherwise a tall screen shows a big
  // dead band between the bubbles and the bay.
  const portrait = bounds.x < bounds.y * 1.2;
  bubbleY = bounds.y * (portrait ? 0.14 : 0.34);
  bayTop = -bounds.y * (portrait ? 0.50 : 0.42);

  water.material.uniforms.uAspect.value.set(Math.max(1, camera.aspect), 1);

  // A live session has to re-lay its furniture, or a rotated tablet drops the
  // bay off the bottom of the screen.
  if (running && board) relayout();

  // The reef is sized relative to the viewport, so an aspect change has to
  // rebuild it. Debounced: a drag-resize fires this continuously, and rebuilding
  // a few hundred merged geometries per frame would lock the tab.
  clearTimeout(reefRebuildTimer);
  reefRebuildTimer = setTimeout(() => {
    if (!reef) return;
    reef.dispose();
    reef = createReef(scene, bounds, camera, CAM_Z);
  }, 320);
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

  // Start the shark's clock with the LESSON. Until now it ran from page load,
  // which meant the first pass could be spent behind the opaque prescreen while
  // the teacher was still choosing letters.
  if (shark) shark.reschedule(clock.elapsed);
}

function endSession() {
  running = false;
  // ⛔ Send him home before the board is torn down, or he is left parked under
  // a bubble row that no longer exists for the whole of the pre-screen.
  if (octopus) octopus.release();
  // A classroom session goes setup -> play -> setup many times in one lesson, so
  // the per-session materials have to be released or the GPU slowly fills up.
  for (const d of dice) { scene.remove(d); disposeDie(d); }
  dice = [];
  if (bubbleSet) {
    scene.remove(bubbleSet.group);
    disposeBubbles(bubbleSet);
    bubbleSet = null; bubbles = null;
  }
  homeBtn.hidden = true;
  replayBtn.hidden = true;
  homeArmed = false;
  homeBtn.classList.remove('armed');
  prescreen.show();
}

function buildBubbles() {
  if (bubbleSet) { scene.remove(bubbleSet.group); disposeBubbles(bubbleSet); }
  bubbleSet = createBubbles(scene, layoutFor(SLOTS, bounds, bubbleY));
  bubbles = bubbleSet.bubbles;
}

function buildBay() {
  for (const d of dice) { scene.remove(d); disposeDie(d); }
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

/**
 * Where the vowel bubble sits, straight from the LAYOUT rather than from the
 * live mesh. The mesh bobs on its buoyancy curve and anything that followed it
 * would bob too; the layout is the still position. Read as a getter so a
 * resize is picked up without anyone having to re-register.
 */
function vowelBubbleLayout() {
  const row = layoutFor(SLOTS, bounds, bubbleY);
  return row[Math.min(1, row.length - 1)];
}

function relayout() {
  resizeBubbles(bubbleSet, layoutFor(SLOTS, bounds, bubbleY));
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
let drag = null;        // a die being dragged out of the bay
let weldDrag = null;    // a finger on the bubble row: a pop or a merge

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

/**
 * ⛔⛔ THE POP MOVED FROM pointerdown TO pointerup, AND IT HAD TO.
 *
 * A tap on a bubble pops it; a drag ACROSS bubbles welds them. Both begin with
 * a finger landing on a bubble, so the two are indistinguishable at the moment
 * of pointerdown - the only thing that tells them apart is what the finger does
 * next. Popping on the way down meant every merge gesture destroyed a letter
 * before it started.
 *
 * The cost is that a pop now waits for the finger to lift, which is a tap's
 * worth of latency (under 150ms, and exactly how every button on the panel
 * already behaves). The cost of getting it wrong the other way is a letter
 * silently vanishing mid-chain, which is the one failure this app has spent the
 * most effort eliminating.
 *
 * ⭐ AMBIGUOUS MEANS DO NOTHING. A gesture that crosses no boundary but wandered
 * too far to be a tap resolves to 'none'. Never to a pop: see weld.js.
 */
function wirePointer(canvas) {
  canvas.addEventListener('pointerdown', e => {
    if (!running) return;
    A.unlock();
    const p = toWorld(e);

    // The bubble row takes priority over the bay: it sits above it, the targets
    // are much larger, and both of its gestures are the teacher's moves.
    // ⭐ An EMPTY bubble starts a gesture too. Welding is board setup as much as
    // it is annotation - a teacher may well build the rime bubble first and
    // then throw two letters into it.
    const hit = bubbleHit(bubbleSet, p);
    if (hit) {
      // Capture keeps the sweep alive if the finger leaves the canvas, but it
      // is an optimisation, not a requirement - and it throws for any pointer
      // the browser does not consider active. The gesture must not be lost
      // because of that, so it is allowed to fail.
      try { canvas.setPointerCapture(e.pointerId); } catch { /* not fatal */ }
      weldDrag = {
        id: e.pointerId,
        g: beginWeldGesture(hit.index),
        from: new THREE.Vector2(p.x, p.y),
      };
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
    if (weldDrag && e.pointerId === weldDrag.id) {
      const p = toWorld(e);
      // ⭐ A LOOSER reach than the tap test. A finger sweeping between two
      // bubbles dips through the sliver of water between their rims, and a
      // sweep that stopped registering there would never see the far bubble.
      const over = slotAt(bubbleSet, p, 2.0);
      extendWeldGesture(weldDrag.g, over ? over.index : null,
                        Math.hypot(p.x - weldDrag.from.x, p.y - weldDrag.from.y));
      // ⭐ LIVE PREVIEW, not a hint drawn on top. The welds animate toward what
      // releasing would do, so the neck actually starts opening under the
      // teacher's finger - and dragging back to one bubble takes it apart
      // again. The feedback is the thing itself.
      aimWelds(bubbleSet, weldPreview(weldDrag.g, weldState(bubbleSet)));
      return;
    }
    if (!drag || e.pointerId !== drag.id) return;
    const p = toWorld(e);
    drag.die.position.set(p.x + drag.grabOffset.x, p.y + drag.grabOffset.y, 0.3);
    drag.samples.push({ x: p.x, y: p.y, t: performance.now() / 1000 });
    if (drag.samples.length > 24) drag.samples.shift();
  });

  const release = e => {
    if (weldDrag && e.pointerId === weldDrag.id) {
      const g = weldDrag.g;
      weldDrag = null;
      const slot = bubbles[g.lo];
      const decided = resolveWeldGesture(g, weldState(bubbleSet), slot ? slot.r : 4);
      if (decided.kind === 'weld') {
        commitWelds(bubbleSet, decided.preview);
        if (decided.preview.on) A.sfxMerge(decided.preview.bs.length);
        else A.sfxSplit();
      } else if (decided.kind === 'pop') {
        const target = bubbles[g.lo];
        // ⛔ The whole FILM, not the lobe that was tapped. A merged bubble is
        // one membrane and popping it empties all of it.
        if (target && filmDice(target).length) {
          for (const die of popBubble(target)) P.sendHome(die);
          A.sfxPop();
          lastSpoken = '';
          syncOctopus();
        }
      } else {
        // Abandoned drag: let the preview fall back to what is committed.
        aimWelds(bubbleSet, null);
      }
      return;
    }
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
  const cancel = e => {
    if (weldDrag && e.pointerId === weldDrag.id) {
      weldDrag = null;
      aimWelds(bubbleSet, null);
      return;
    }
    release(e);
  };
  canvas.addEventListener('pointercancel', cancel);
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
/**
 * ⭐ THE O ROUTINE. An octopus starts with O, so when one lands in the vowel
 * bubble he comes out of the reef to look at it.
 *
 * Driven off the BOARD STATE rather than off the capture event, and that is
 * deliberate: this is called after every change to the slots - a capture, a
 * pop, a session reset - so the octopus can never be left admiring a letter
 * that is no longer there. An event-driven version needs a matching "undo" at
 * every single place a slot can empty, and missing one strands him on screen
 * for the rest of the lesson.
 */
function syncOctopus() {
  if (!octopus) return;
  const vowel = currentWord().raw[1];
  // ⛔ THE O BEING THERE IS THE WHOLE CONDITION. He comes while it is in the
  // bubble and goes back when it leaves - which in practice means when the
  // bubble is popped.
  //
  // An earlier version also sent him home the moment the WORD was complete,
  // and that was wrong twice over: he vanished at exactly the moment the child
  // had finished building something and was looking at it, and it made the
  // rule two conditions instead of one. One condition is also what makes this
  // safe to call after every single board change.
  // The shark gate lives in the octopus itself (admire() refuses while a pass
  // is on), so this stays the single simple rule it was.
  if (vowel === 'o') octopus.admire();
  else octopus.release();
}

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

  // The summoning word. Checked before the blend is queued, so the pass is
  // already due by the time the voice finishes and the shark follows it in.
  if (shark && SUMMON_WORDS.has(key.toLowerCase())) shark.summon();

  A.sfxComplete();
  // Small delay so the capture glug has room before the voice starts.
  // The provisional hold covers the gap between here and blend() reporting its
  // real length; a failure to load audio clears it rather than wedging it.
  blendUntil = clock.elapsed + 3;
  setTimeout(() => {
    A.blend(seq, { thenWhole: true })
      .then(secs => {
        blendUntil = clock.elapsed + (Number.isFinite(secs) ? secs : 2.5);
      })
      .catch(() => { blendUntil = 0; });
  }, 260);
}

/**
 * Is it safe to START a shark pass? Not "is the app running" - this is about
 * whether a child is mid-task. Anything in flight, anything being captured or
 * returning, a bubble popping, or a word being spoken all mean no.
 *
 * The prescreen counts as idle on purpose: a shark crossing the attract screen
 * costs nothing and sets up the world before the lesson starts.
 */
function isIdle() {
  if (!running) return true;
  if (clock.elapsed < blendUntil) return false;
  for (const die of dice) {
    const st = die.userData.state;
    if (st === 'flying' || st === 'capturing' || st === 'returning') return false;
  }
  if (bubbles) for (const b of bubbles) if (b.popping > 0) return false;
  return true;
}

// ---------------------------------------------------------------- main loop
function frame() {
  const now = performance.now() / 1000;
  const dt = Math.min(0.05, now - clock.t) * timeScale;
  clock.t = now;
  clock.elapsed += dt;
  const t = clock.elapsed;

  water.material.uniforms.uTime.value = t;
  updateWater(t);
  // Before updateOcean: the fish scatter from where the shark IS this frame,
  // not from where it was last one.
  if (shark) {
    shark.update(t, dt, { live: running, idle: isIdle(),
                          speaking: clock.elapsed < blendUntil, camera, bounds });
    const lit = shark.light();
    water.material.uniforms.uEclipse.value = lit.amount;
    water.material.uniforms.uEclipseX.value = lit.x;
  }
  updateOcean(ocean, bounds, t, dt, shark ? shark.threat() : null);
  updateReef(reef, t, reducedMotion, dt);
  // ⛔ BEFORE octopus.update(), not after. This advances every AnimationMixer,
  // which writes bone rotations - and the octopus POSES ITS OWN BONES while it
  // is dashing (arms streamed back). With the mixer running afterwards it
  // simply overwrote that pose every frame and the dash had no arms in it.
  if (creatures) creatures.update(dt);
  // After updateReef: the octopus watches for a band WRAPPING to decide whether
  // to appear, and that only happens inside updateReef. Running before it would
  // see every wrap a frame late.
  if (octopus) octopus.update(t, dt, {
    reducedMotion,
    // A pass in progress sends him back to the reef and keeps him there.
    predator: !!(shark && shark.active),
  });

  // ⭐ Re-evaluate when the pass STARTS or ENDS, not just when the board
  // changes. syncOctopus() is otherwise only called on a capture or a pop, so
  // without this he would either stay in the foreground until the next time a
  // die moved, or - worse - never come back after the shark had gone even
  // though the O was still sitting in the bubble.
  const sharkNow = !!(shark && shark.active);
  if (sharkNow !== sharkWasActive) {
    sharkWasActive = sharkNow;
    syncOctopus();
  }
  if (popFX) popFX.update(dt);
  if (ink) ink.update(dt);

  if (running) {
    updateBubbles(bubbleSet, t, dt, reducedMotion, popFX);

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
            // ⭐⭐ i is for ink - and the ink comes out of the OCTOPUS, on
            // whatever plane he happens to be on. The letter is only the
            // trigger. ⛔ This origin is not negotiable; see src/ink.js.
            //
            // ⛔ Not fired at the bubble. An earlier version puffed the cloud
            // around the letter itself, which made it look like the `i` was
            // leaking: the joke only works if the ink has an animal attached to
            // it. He may be far out on the reef, in which case it is a small
            // puff in the distance, or up over the middle bubble doing the
            // O routine, in which case it is a proper cloud - perspective sizes
            // it correctly either way with no special casing.
            if (ink && u.ch === 'i' && octopus) {
              const o = octopus.inkOrigin();
              if (o) ink.puff(o.x, o.y, o.r, o.z);
            }
            syncOctopus();
            setTimeout(speakIfReady, 120);
          }
          break;
        case 'returning':
          P.stepReturn(die, dt);
          break;
      }
      applyWobble(die, t, CAM_Z);
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
  // The live scene graph. Art direction on a thing that moves cannot be done by
  // reading source - this is how the shark's lane, scale and shading were
  // actually set, by measuring the rendered result from the console.
  get scene() { return scene; },
  // The shark's timing gate, exposed so it can actually be checked: throw a
  // die, read this, and confirm it goes false while the board is in use.
  get idle() { return isIdle(); },
  // A pass is minutes away by design, which makes it untestable by waiting.
  // sharkNow() starts one immediately; shark.eta is the seconds remaining.
  sharkNow() { if (shark) shark.now(); return !!shark; },
  get shark() {
    if (!shark) return null;
    const lit = shark.light();
    return { active: shark.active, eta: +shark.eta.toFixed(1),
             progress: +shark.progress.toFixed(3),
             eclipse: +lit.amount.toFixed(3), eclipseX: +lit.x.toFixed(3) };
  },
  /** z of each travelling reef band - proves the conveyor is advancing. */
  get reefZ() { return reef && reef.bands ? reef.bands.map(b => +b.position.z.toFixed(2)) : null; },
  /** Renderer statistics - draw calls, triangles, live GPU resources. */
  get stats() {
    const i = renderer.info;
    return {
      calls: i.render.calls, triangles: i.render.triangles,
      geometries: i.memory.geometries, textures: i.memory.textures,
      programs: i.programs ? i.programs.length : null,
    };
  },
  /** Average frame time over N frames, measured on the real loop. */
  async fps(frames = 90) {
    const t0 = performance.now();
    await new Promise(res => { let i = 0; const tick = () => (++i < frames ? requestAnimationFrame(tick) : res()); requestAnimationFrame(tick); });
    const ms = (performance.now() - t0) / frames;
    return { msPerFrame: +ms.toFixed(2), fps: +(1000 / ms).toFixed(1) };
  },
  set timeScale(v) { timeScale = v; },
  get timeScale() { return timeScale; },
  /**
   * Freeze a bubble at an exact point in its pop sequence, for inspection.
   * Set timeScale to 0 first, then step the phase by hand - chasing a 0.76s
   * animation with screenshots does not work.
   */
  setPopPhase(i, phase) {
    const b = bubbles && bubbles[i];
    if (!b) return 'no bubble ' + i;
    for (const d of popBubble(b)) P.sendHome(d);
    b.popping = 1;
    b.popT = phase;
    b.burstFired = false;          // so the ring and droplets still spawn
    return 'bubble ' + i + ' held at t=' + phase;
  },
  get popPhases() {
    return bubbles ? bubbles.map(b => (b.popping ? +b.popT.toFixed(3) : null)) : null;
  },
  /** Pop a slot by index, as a tap would. */
  popSlot(i) {
    const b = bubbles && bubbles[i];
    if (!b || !b.die) return 'slot ' + i + ' is empty';
    const freed = popBubble(b);
    for (const die of freed) P.sendHome(die);
    lastSpoken = '';
    syncOctopus();
    return 'popped ' + i + ' (released ' + freed.length + ')';
  },
  get bayTop() { return bayTop; },
  /**
   * ⭐ THE WELD HANDLES. A finger drag cannot be driven through remote browser
   * automation - synthetic pointer events do not reliably deliver pointerdown
   * here and rAF is throttled to about 1Hz - so these are the only honest way
   * to inspect a merge in the real page. The gesture DECISION is unit tested
   * separately in test/bubble-merge.test.mjs; these drive the result of it.
   */
  get welds() {
    return bubbleSet ? bubbleSet.welds.map(w => ({
      on: w.on, w: +w.w.toFixed(3), target: w.target,
    })) : null;
  },
  /** How the row is grouped into films right now, e.g. ['c', 'at']. */
  get films() {
    if (!bubbles) return null;
    return films(bubbleSet).map(lead => lead.members
      .map(m => (m.die ? m.die.userData.ch : '_')).join(''));
  },
  /** Weld or unweld one boundary (0 = onset|vowel, 1 = vowel|coda). */
  weld(boundary, on = true) {
    if (!bubbleSet) return 'no board';
    const wd = bubbleSet.welds[boundary];
    if (!wd) return 'no boundary ' + boundary;
    wd.on = !!on;
    aimWelds(bubbleSet, null);
    return 'boundary ' + boundary + ' -> ' + (on ? 'welded' : 'split');
  },
  /**
   * Replay a whole finger sweep from slot `a` to slot `b`, exactly as the
   * pointer handler would, and report what it decided. This is the way to check
   * that a sweep welds and a tap pops without touching the DOM.
   */
  sweep(a, b) {
    if (!bubbleSet) return 'no board';
    const g = beginWeldGesture(a);
    const step = b >= a ? 1 : -1;
    for (let i = a; i !== b + step; i += step) {
      extendWeldGesture(g, i, Math.abs(bubbles[i].pos.x - bubbles[a].pos.x));
    }
    const decided = resolveWeldGesture(g, weldState(bubbleSet), bubbles[a].r);
    if (decided.kind === 'weld') {
      commitWelds(bubbleSet, decided.preview);
      if (decided.preview.on) A.sfxMerge(decided.preview.bs.length); else A.sfxSplit();
    } else if (decided.kind === 'pop') {
      const t = bubbles[a];
      if (filmDice(t).length) {
        for (const die of popBubble(t)) P.sendHome(die);
        A.sfxPop(); lastSpoken = ''; syncOctopus();
      }
    }
    return decided.kind + (decided.preview ? ' ' + JSON.stringify(decided.preview) : '');
  },
  /** Lobe centres and the film each slot belongs to - the merged geometry. */
  get lobes() {
    if (!bubbles) return null;
    return bubbles.map(b => ({
      i: b.index, x: +b.pos.x.toFixed(2), y: +b.pos.y.toFixed(2),
      film: b.lead.index, span: filmSpan(b),
    }));
  },
  /**
   * The reef octopus. `octoState` is null while it is away between passes -
   * that is the normal resting condition, not a fault. `octoShow()` drops it
   * onto the furthest band immediately so it can be inspected without waiting
   * for a wrap (a full band cycle is ~57s).
   */
  get octoState() { return octopus ? octopus.state : null; },
  octoShow() { return octopus ? octopus.debugShow() : 'no octopus'; },
  /** Launch a die by letter, in world units per second - bypasses the gesture. */
  throwDie(ch, vx, vy, col = null) {
    // `col` disambiguates a letter that appears in more than one column - `t`
    // is commonly in both the onset and coda sets, and without this the helper
    // silently grabs whichever one it finds first.
    const d = dice.find(x => x.userData.ch === ch && x.userData.state === 'bay'
      && (col === null || x.userData.col === col));
    if (!d) return 'no bay die ' + ch + (col === null ? '' : ' in col ' + col);
    P.launch(d, vx, vy);
    return 'launched ' + ch;
  },
};
