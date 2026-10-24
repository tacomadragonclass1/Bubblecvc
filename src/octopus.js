// ------------------------------------------------------------------- octopus
// A reef DWELLER, which is a different kind of thing from everything else in
// this scene. Fish and the whale are LANE SWIMMERS: they cross the screen at a
// fixed depth and recycle at the edges (src/ocean.js). The hero shark is an
// EVENT: scheduled, foregrounded, once every few minutes (src/shark.js). This
// octopus is neither - it lives in a particular coral garden, stays there, and
// goes away when that garden slides out of shot.
//
// ⛔ WHICH MEANS IT MUST RIDE THE REEF, NOT THE WORLD.
//
// The camera never moves in this app; the reef streams toward it and recycles
// (see THE REEF TRAVELS in src/reef.js). So an octopus parked at a fixed world
// position would not "hang out in the coral" at all - the coral would walk out
// from under it within seconds and leave it hovering in open water. It is
// parented to a reef BAND instead, so the conveyor carries it along with the
// garden it is sitting in, for free, and it leaves frame when that garden does.
//
// Three behaviours, all independent of user input:
//   * SCURRY - short crawls and longer jets between spots in its garden. Fast,
//     with a hard stop, because a slow drift reads as floating rather than as
//     an animal deciding to move.
//   * CHAMELEON - it goes through phases of matching the coral it is sitting
//     on, nearly vanishing, then flushing back to its own colour. This is the
//     thing children actually watch for.
//   * APPEARING AT ALL - sporadic. It only ever joins a band at the FAR end of
//     the reef, so it is never seen popping into existence mid-screen, and it
//     sits out some passes entirely.

import * as THREE from '../vendor/three.module.js';
import { makeUnderwater } from './lightwater.js';
import { FLOOR_Y, Z_FRONT, SPAN } from './reef.js';

// ⭐ SIZE IS NOT A GUESS - it is read off the frustum.
//
// A band travels z = -112 -> -30, which at a 45 degree fov and camera z = 26 is
// 56 to 138 units away, where the visible half-height is 23 to 57 units. A
// 3-unit creature out there is 2.6% of screen height: present, and far too
// small for a classroom panel at the back of the room to read as "scurrying".
// At ~6 units across it runs 5% of screen height at the far end and 10% by the
// time its garden is leaving shot, which is the band that actually reads.
const SCALE = 2.1;

// How high above the sea bed it perches. A garden is scaled 1.6-3.4x and its
// coral stands ~7 local units tall, so this puts the octopus up ON the coral
// rather than down in the silt - which matters because the floor at y = -40
// drops out of the bottom of frame while the band is still approaching, and
// something sitting on the floor would spend most of its pass invisible.
const PERCH_UP = 5.0;
const PERCH_PER_SCALE = 3.2;

// ⭐ Chance it takes any given opportunity to appear, and this number is
// MEASURED, not picked. A band wraps every ~14s (4 bands, a 57s cycle), and a
// pass that is taken puts the octopus on screen for ~54s of it. So:
//
//   0.55 -> on screen 54s out of every 79s. Permanent furniture, not an event.
//   0.30 -> away ~50s between passes.
//   0.16 -> away ~99s between passes (range 14-353s).  <- chosen
//
// 0.16 means present about a third of the time and genuinely unpredictable,
// which is the same register as the shark pass (90-170s) without making a reef
// DWELLER behave like a scheduled event. Re-measure with test/_vis.mjs.
const APPEAR_CHANCE = 0.16;

// Its own colour, and the tones it camouflages INTO. The blend targets are
// taken from the reef palette (brain coral, rock, ochre table coral) so a
// camouflaged octopus matches something that is actually out there.
const BLEND_TONES = [0xc98f7a, 0x27506b, 0xb8a06a, 0x1d6b63, 0x163449];

/**
 * Adopt the modelled octopus and find the materials the camouflage has to drive.
 *
 * ⛔ NO PROCEDURAL FALLBACK. Every other creature here degrades to hand-built
 * geometry if its model is missing, and for a fish in a far lane that is a
 * reasonable trade. It is not reasonable for this one: a sphere with eight
 * cylinders stuck on it reads as a spider, and a bad octopus sitting in the
 * coral for a minute at a time is worse than no octopus at all. If the model is
 * absent the whole feature switches off and the reef is simply empty.
 */
function adoptModel(creatures) {
  const holder = creatures && creatures.make('reefOctopus', 1);
  if (!holder) return null;

  // The model carries five materials - body, the sucker beads, eye white, pupil
  // and one more. Camouflage must drive the SKIN and leave the eyes alone, so
  // they are told apart by what they look like rather than by name: a material
  // index is whatever the exporter happened to emit, but "nearly white" and
  // "nearly black" are stable facts about an eye.
  const skin = [], trim = [], keep = [];
  const seen = new Set();
  holder.traverse(o => {
    if (!o.isMesh) return;
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
      if (!m || !m.color || seen.has(m.uuid)) continue;
      seen.add(m.uuid);
      const hsl = {}; m.color.getHSL(hsl);
      if (hsl.l > 0.82 && hsl.s < 0.25) trim.push(m);        // suckers, eye white
      else if (hsl.l < 0.12) keep.push(m);                   // pupil - never changes
      else skin.push(m);                                     // body
    }
  });
  return { holder, skin, trim, keep, base: skin.map(m => m.color.clone()),
           trimBase: trim.map(m => m.color.clone()) };
}

/**
 * @param creatures the glTF library from src/creatures.js. Returns a dead stub
 *                  if it has no `reefOctopus` - see adoptModel().
 * @param getReef   a function returning the CURRENT reef. Not the reef itself:
 *                  a resize disposes and rebuilds the whole reef (see main.js),
 *                  which would leave us holding a dead band. Looking it up each
 *                  frame means a rebuild just ends the current pass.
 */
export function createReefOctopus(scene, creatures, getReef) {
  const body = adoptModel(creatures);
  if (!body) {
    // Fail soft and silent, exactly like the rest of the creature pipeline.
    return { update() {}, dispose() {}, debugShow: () => 'no octopus model',
             get state() { return null; } };
  }
  const holder = new THREE.Group();
  holder.add(body.holder);
  holder.scale.setScalar(SCALE);
  holder.visible = false;
  scene.add(holder);

  // The model's own looping Idle clip: a travelling wave down the arms, baked
  // in Blender (tools/rig_octopus.py). It runs the WHOLE time the octopus is on
  // screen and is completely independent of the scurry below - the clip is the
  // animal breathing, the scurry is the animal deciding to go somewhere.
  const mixer = body.holder.userData.mixer || null;

  // Where it lives right now.
  let band = null;          // the reef band it is riding, or null when away
  let anchor = null;        // {x, y, z} perch in that band's local space
  const zWatch = new Map(); // band -> last seen z, for wrap detection

  // Locomotion.
  let mode = 'rest';        // rest | crawl | jet
  let modeT = 0;
  let modeDur = 2.0;
  const at = new THREE.Vector3();     // current local offset from the anchor
  const from = new THREE.Vector3();
  const to = new THREE.Vector3();
  let facing = 0;           // yaw, radians
  let facingTo = 0;

  // Chameleon.
  let blend = 0.2;          // 0 = its own colour, 1 = matching the coral
  let blendTo = 0.2;
  let blendT = 0;
  let blendDur = 5;
  let tone = new THREE.Color(BLEND_TONES[0]);
  let flush = 0;            // a brief bright pulse, strongest right after a move

  const rnd = (a, b) => a + Math.random() * (b - a);

  /** Leave. The pass is over, or the reef was rebuilt under us. */
  function retire() {
    if (band) band.remove(holder);
    scene.add(holder);
    holder.visible = false;
    band = null; anchor = null;
  }

  /** Move in, on a band that has just wrapped to the far end. */
  function settleOn(newBand) {
    const clusters = newBand.children.filter(c => c.userData && c.userData.isCluster);
    if (!clusters.length) return false;
    const c = clusters[Math.floor(Math.random() * clusters.length)];
    const cs = c.userData.clusterScale || 2;

    anchor = {
      x: c.position.x + rnd(-2.5, 2.5),
      y: FLOOR_Y + PERCH_UP + cs * PERCH_PER_SCALE,
      z: c.position.z + rnd(-1.5, 2.5),
    };
    band = newBand;
    band.add(holder);
    holder.visible = true;

    at.set(0, 0, 0); from.copy(at); to.copy(at);
    facing = facingTo = rnd(-Math.PI, Math.PI);
    // A fresh camouflage choice each appearance, so it is not always hiding as
    // the same colour.
    tone = new THREE.Color(BLEND_TONES[Math.floor(Math.random() * BLEND_TONES.length)]);
    blend = blendTo = rnd(0.1, 0.4);
    blendT = 0; blendDur = rnd(3, 6);
    mode = 'rest'; modeT = 0; modeDur = rnd(1.2, 2.6);
    flush = 0;
    return true;
  }

  /** Choose the next thing to do. */
  function nextMove(reduced) {
    from.copy(at);
    const roll = Math.random();

    if (roll < (reduced ? 0.18 : 0.34)) {
      // JET: the big, obvious one. A long shot across the garden with the arms
      // streamed behind, which is the move that reads from the back of a room.
      mode = 'jet';
      modeDur = rnd(0.95, 1.35);
      const ang = rnd(-Math.PI, Math.PI);
      const dist = rnd(4.5, 8.0);
      to.set(at.x + Math.cos(ang) * dist, at.y + rnd(-0.6, 1.8), at.z + Math.sin(ang) * dist * 0.5);
      facingTo = Math.atan2(to.x - at.x, to.z - at.z);
      // Octopuses flash when they move. Coupling the two makes both legible.
      flush = 1;
      blendTo = rnd(0.0, 0.2); blendT = 0; blendDur = rnd(1.2, 2.4);
    } else if (roll < (reduced ? 0.4 : 0.68)) {
      // CRAWL: a short scurry, staying low over the coral.
      mode = 'crawl';
      modeDur = rnd(0.7, 1.15);
      const ang = rnd(-Math.PI, Math.PI);
      const dist = rnd(1.8, 3.6);
      to.set(at.x + Math.cos(ang) * dist, at.y + rnd(-0.4, 0.9), at.z + Math.sin(ang) * dist * 0.5);
      facingTo = Math.atan2(to.x - at.x, to.z - at.z);
      flush = Math.max(flush, 0.5);
    } else {
      // REST. Sitting still IS a behaviour: it is what makes the next move read
      // as a decision rather than as constant fidgeting.
      mode = 'rest';
      modeDur = reduced ? rnd(4.5, 9) : rnd(2.4, 6.5);
      to.copy(at);
      // A long rest is when it commits to a camouflage phase.
      if (Math.random() < 0.55) {
        blendTo = rnd(0.75, 1.0);          // nearly gone
        blendDur = rnd(2.5, 5.0);
      } else {
        blendTo = rnd(0.0, 0.35);          // sitting there in plain colour
        blendDur = rnd(2.0, 4.0);
      }
      blendT = 0;
    }
    // Keep it inside its own garden rather than wandering off across the sea bed.
    to.x = THREE.MathUtils.clamp(to.x, -9, 9);
    to.y = THREE.MathUtils.clamp(to.y, -2.5, 4.5);
    to.z = THREE.MathUtils.clamp(to.z, -5, 6);
    modeT = 0;
  }

  function update(t, dt, opts = {}) {
    const reduced = !!opts.reducedMotion;
    const reef = getReef && getReef();
    const bands = (reef && reef.bands) || [];

    // ---- wrap watching ----------------------------------------------------
    // A band that has just jumped backward is at the far end of the reef, which
    // is the ONLY place this creature is allowed to appear. Anywhere else and it
    // would materialise in open view - the same mistake the shark pass had to
    // be fixed for.
    for (const b of bands) {
      const prev = zWatch.get(b);
      const z = b.position.z;
      zWatch.set(b, z);
      if (prev === undefined) continue;
      const wrapped = z < prev - 1;           // only a recycle moves z backward
      if (!wrapped) continue;
      if (b === band) {
        // Our own garden has gone round. The pass is over.
        retire();
      } else if (!band && Math.random() < APPEAR_CHANCE) {
        settleOn(b);
      }
    }

    // A rebuilt reef leaves us parented to a disposed band.
    if (band && !bands.includes(band)) retire();
    if (!band || !anchor) return;

    const m = reduced ? 0.35 : 1;

    // ---- locomotion -------------------------------------------------------
    modeT += dt;
    if (modeT >= modeDur) nextMove(reduced);

    const k = Math.min(1, modeT / modeDur);
    let stretch = 1, lean = 0;

    if (mode === 'rest') {
      // Breathing, and a slow settle onto the coral.
      at.copy(to);
      stretch = 1 + Math.sin(t * 1.15) * 0.035 * m;
    } else if (mode === 'crawl') {
      // Scurry: quick out of the blocks, hard stop. easeOutCubic.
      const e = 1 - Math.pow(1 - k, 3);
      at.lerpVectors(from, to, e);
      // A crawl waddles - the body rocks side to side over its arms.
      lean = Math.sin(k * Math.PI * 3) * 0.17 * m;
      stretch = 1 - Math.sin(k * Math.PI) * 0.05;
    } else {
      // JET: contract, then shoot. The pause before the launch is the
      // anticipation that makes the launch read.
      const WIND = 0.26;                 // fraction of the move spent coiling
      if (k < WIND) {
        const w = k / WIND;
        at.copy(from);
        stretch = 1 - Math.sin(w * Math.PI * 0.5) * 0.16;   // squash down
      } else {
        const e = 1 - Math.pow(1 - (k - WIND) / (1 - WIND), 2.4);
        at.lerpVectors(from, to, e);
        stretch = 1 + (1 - e) * 0.3;                        // stretched in flight
      }
      lean = Math.sin(k * Math.PI) * 0.1 * m;
    }

    holder.position.set(anchor.x + at.x, anchor.y + at.y, anchor.z + at.z);

    // Turn to face the way it is going, but not instantly.
    let d = facingTo - facing;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    facing += d * Math.min(1, dt * 6);
    holder.rotation.y = facing;
    holder.rotation.z = lean;
    // Squash-and-stretch on the model as a whole: volume-preserving, so a jet
    // reads as the animal contracting and firing rather than as it scaling.
    body.holder.scale.set(1 / Math.sqrt(stretch), stretch, 1 / Math.sqrt(stretch));

    // ---- the baked idle ---------------------------------------------------
    // How hard the animal is working right now: 1 all through a crawl, ramping
    // in over the first third of a jet (the rest of a jet is the wind-up).
    const moving = mode === 'jet' ? Math.min(1, k / 0.3) : (mode === 'crawl' ? 1 : 0);

    // The arms undulate from the model's own looping clip.
    //
    // ⛔ DO NOT CALL mixer.update() HERE. Every mixer handed out by
    // src/creatures.js is also in that module's shared list, which main.js
    // advances once a frame via creatures.update(dt). Advancing it again here
    // would run the clip at double speed and make the rate depend on how many
    // things happened to be holding it. `timeScale` is the supported way to
    // change the rate of a mixer somebody else is driving.
    if (mixer) mixer.timeScale = (reduced ? 0.45 : 1) * (1 + moving * 0.8);

    // ---- chameleon --------------------------------------------------------
    // Phases, not a constant shimmer: it holds a colour for seconds at a time,
    // which is what makes the CHANGE the thing you notice.
    blendT += dt;
    const bk = Math.min(1, blendT / blendDur);
    // Smoothstep, so a change eases in and out like chromatophores spreading
    // rather than snapping.
    blend += (blendTo - blend) * Math.min(1, dt * (1.2 + 2.4 * (1 - bk)));

    flush = Math.max(0, flush - dt * 1.3);
    const shown = THREE.MathUtils.clamp(blend - flush * 0.55, 0, 1);

    // Every skin material shifts from ITS OWN base colour toward the chosen
    // coral tone. Starting from each material's own colour rather than from one
    // shared constant matters: the model is painted in several related mauves,
    // and flattening them all to a single colour would throw away the shading
    // the artist built in and leave a plastic silhouette.
    body.skin.forEach((m, i) => {
      m.color.copy(body.base[i]).lerp(tone, shown);
      // Camouflaged skin also goes matte - a blended octopus still carrying a
      // wet highlight gives itself away immediately.
      if (m.roughness !== undefined) m.roughness = 0.55 + shown * 0.3;
    });
    // The suckers and eye whites dim toward the body but never all the way: a
    // perfectly camouflaged octopus is an invisible one, and SPOTTING it is the
    // game. Real cephalopods keep the pupil dark through a colour change, so
    // `body.keep` is deliberately never touched.
    body.trim.forEach((m, i) => {
      m.color.copy(body.trimBase[i]).lerp(tone, shown * 0.7);
    });
  }

  function dispose() {
    retire();
    scene.remove(holder);
    // ⛔ Do NOT dispose the geometry or materials here. This is an INSTANCE from
    // the shared creature library (src/creatures.js), which owns those and
    // hands the same ones to every instance - disposing them from here would
    // blank the model for anything else holding it, and for any octopus made
    // afterwards. The library's own dispose() is the right place.
    zWatch.clear();
  }

  /** Debug: force it onto the nearest band right now. */
  function debugShow() {
    const reef = getReef && getReef();
    const bands = (reef && reef.bands) || [];
    if (!bands.length) return 'no reef';
    if (band) retire();
    // Furthest band, so it still enters the way it is meant to.
    const far = bands.slice().sort((a, b) => a.position.z - b.position.z)[0];
    return settleOn(far) ? 'octopus on band z=' + far.position.z.toFixed(1) : 'no cluster';
  }

  return {
    update, dispose, debugShow,
    /**
     * Null while it is away between passes - that is the normal resting state.
     * The position is the WORLD position, composed through the band it is
     * riding, which is the only number that answers "is it actually on screen".
     */
    get state() {
      if (!band) return null;
      // ⛔ getWorldPosition, NOT matrixWorld. Reading matrixWorld gives whatever
      // the last render left there, and the band this is parented to is only
      // refreshed by the renderer - so off the render path (a test, a console
      // poke between frames) it reports the LOCAL offset and the depth looks
      // like +3 instead of -110. getWorldPosition updates the ancestors first.
      const w = holder.getWorldPosition(new THREE.Vector3());
      return {
        mode,
        blend: +blend.toFixed(2),
        x: +w.x.toFixed(1), y: +w.y.toFixed(1), z: +w.z.toFixed(1),
      };
    },
  };
}
