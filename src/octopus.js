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
// ⛔ 3.0, raised from 2.1, and the reason is that three separate things were
// multiplying to make this animal invisible in the actual app: it is SMALL, it
// spends a lot of its time CAMOUFLAGED, and it sits in the busiest strip of the
// frame among the coral and the letter dice. Each was defensible alone; together
// they meant a teacher watching for it saw nothing at all. At 3.0 it runs ~10%
// of screen height through the middle of its approach, which is findable
// without being a distraction up where the letters are.
const SCALE = 3.0;

// How high above the sea bed it perches. A garden is scaled 1.6-3.4x and its
// coral stands ~7 local units tall, so this puts the octopus up ON the coral
// rather than down in the silt - which matters because the floor at y = -40
// drops out of the bottom of frame while the band is still approaching, and
// something sitting on the floor would spend most of its pass invisible.
// Raised with SCALE for the same reason: perched higher it is silhouetted
// against open water rather than buried in the coral it is sitting on.
const PERCH_UP = 7.5;
const PERCH_PER_SCALE = 3.2;

// ⛔ HE IS ALWAYS THERE. There is no appearance lottery any more.
//
// This started as a sporadic visitor on a 16% chance per band wrap, which meant
// you could watch the reef for two minutes and see nothing. Raising the odds
// helped, but the real problem was the model: once the letter O calls him to
// the foreground, "is he around?" stops being an interesting question and
// becomes a reason the trick sometimes does not fire. So he simply LIVES on the
// reef - when his garden recycles to the back he moves to another one on the
// same band, and he is on screen essentially all the time.
//
// What makes him interesting is now the camouflage and the scurrying, not his
// absence.

// Its own colour, and the tones it camouflages INTO. The blend targets are
// taken from the reef palette (brain coral, rock, ochre table coral) so a
// camouflaged octopus matches something that is actually out there.
// ⭐ The tones he camouflages INTO, and they are deliberately a WIDE spread -
// warm terracotta, cold slate, ochre, deep teal, near-black. Earlier these all
// sat in the same muddy mid-range, so a colour change was technically happening
// and visually almost nothing: he shifted from one brown to a slightly
// different brown. Camouflage is the best thing this creature does and it has
// to be legible from the back of a classroom, so the targets are now far apart
// from each other AND far from his own mauve.
const BLEND_TONES = [
  0xd98a5a,   // warm sand
  0x1d5f8a,   // cold blue, the opposite side of the wheel from his own colour
  0xc9b24e,   // ochre-gold
  0x16806a,   // deep teal
  0x3a2740,   // near-black aubergine
  0xb43f5a,   // deep coral red
];

// ⛔ A FRIGHTENED OCTOPUS MATCHES THE SEA BED, not whatever colour came up in
// the shuffle. The full palette above is wide on purpose - the idle colour
// changes should be seen - but the fear reaction is the one moment he is
// actually trying not to be noticed, and flushing cold blue while crouched on
// tan rock is the opposite of hiding. These are only the substrate tones.
const SPOOK_TONES = [0xd98a5a, 0xc9b24e, 0x3a2740, 0x27506b];

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
// ------------------------------------------------------ the migration
// ⛔ HE SWIMS BACK. HE DOES NOT RIDE THE BAND ROUND.
//
// A band recycles the instant it passes Z_FRONT (-30), jumping straight to the
// back of the reef - and he is still plainly on screen at that point (his perch
// sits at -0.86 of the frame height when the jump happens, nowhere near the
// bottom edge). Riding it round meant he blinked out downstage and blinked back
// in upstage, which is the single most illusion-breaking thing in the scene.
//
// So when his garden gets close to being overtaken he LEAVES it and torpedoes
// to the back of the reef under his own power: head first, arms streamed behind
// him, body stretched along the direction of travel. Then he picks a new garden
// on the furthest band and settles.
const MIGRATE_AT = -72;     // band z at which he gives up on this garden
const MIGRATE_SPEED = 34;   // world units per second - this is the fast one
const MIGRATE_MIN = 2.6;
const MIGRATE_MAX = 5.0;
// How hard the arms stream back during the dash, in radians at the last bone.
// Applied ON TOP of whatever the Idle clip wrote this frame - see stepMigrate.
const ARM_SWEEP = 0.95;

// ------------------------------------------------- the "O" routine
// ⭐ Spell an O into the vowel bubble and the octopus comes to look at it.
//
// An octopus begins with O, so the letter is his. He leaves the reef, swims
// toward the camera, hangs OVER the middle bubble with his arms trailing down
// around it, and tips his head forward to peer down at the letter until the
// word is finished.
//
// ⛔ HE STOPS BEHIND THE PLAY PLANE, NOT IN FRONT OF IT. The hero shark passes
// in front of the bubbles and that is right for a two-second event, but this
// one HOLDS for as long as a child takes to finish a word. z -8 keeps every
// die and every bubble drawing in front of him, so nothing a child needs to
// read is ever occluded - and because the bubble film is transparent, the
// parts of him the die does not cover still read straight through it. That
// combination is the whole look: the letter sits crisply in front, and he is
// visible behind it through the soap.
//
// ⭐ HE HANGS ABOVE THE BUBBLE AND LOOKS DOWN INTO IT. He used to park BELOW
// the row and tip back to look up, which put the whole animal in the one strip
// of empty water the board has (bubble row bottom y -0.4, dice bay top y -4.5)
// and left him squatting on the reef. Coming over the top instead reads as an
// animal leaning in over something it is curious about, and it uses the open
// water above the row rather than the cramped gap below it.
//
// ⛔ y IS NOT COMPARABLE ACROSS DEPTHS - see frustum.js. The play plane's half
// height is 10.77 but at z -8 it is 14.08, so the bubble's top edge (world y
// 7.7 at z 0) sits at the SAME SCREEN HEIGHT as y 10.1 back where he is. His
// eyes have to clear that number, not 7.7, or he looks level with the letter
// rather than above it. His eyes ride about a unit above his origin and his
// mantle about four and a half above it, so an origin near 9 puts the eyes
// just over the rim and the top of the head at the very top of frame.
//
// ⭐ The head running off the top is FINE and is deliberate. What matters is
// that the eyes and the letter are both in shot.
export const ADMIRE_Z = -8;
// The camera sits at z 26 and never moves, so the frustum where he hangs is
// this much bigger than at the play plane. Multiplying a play-plane y by it
// gives the y at HIS depth that lands on the same screen height.
const ADMIRE_DEPTH_GAIN = (26 - ADMIRE_Z) / 26;
// ⭐ MEASURED off the live model in the admire pose, not derived - the pitch
// swings both of these, so they are only valid for ADMIRE_PITCH. If that
// changes, re-measure rather than reasoning about it: his eyes ride this far
// above his own origin, and his mantle 4.75, and his arms hang 4.47 below.
export const ADMIRE_EYE_RISE = 2.81;
// How far his eyes clear the bubble's top rim, in units at his depth. This is
// the number that actually sets the composition - it is the gap between the
// top of the soap and the animal peering over it.
export const ADMIRE_EYE_CLEAR = 1.7;
// ⛔ DERIVED FROM THE BUBBLE, NOT A FIXED y. The bubble row is laid out from
// the viewport: `bubbleY` is 0.34 of the half-height in landscape but 0.14 in
// portrait, and the radius shrinks on a narrow screen. A hardcoded y looked
// right on the development window and would have left him stranded in open
// water well above a portrait board. Fed from the LAYOUT, not from the live
// mesh - the mesh bobs, and he must not bob with it.
// Tipped FORWARD to look DOWN. rotation.y 0 already faces the camera (the reef
// heading maths uses atan2(dx, dz), so zero is +Z); a positive x rotation tips
// his top toward the camera and reads as a head tilting back, so the sign is
// negative here - his top goes away from the camera and his face comes down.
//
// ⛔ There is a ceiling on this in both directions, and it is the same one:
// past a certain tilt the mantle rolls over the face and hides both eyes, and
// he reads as turning away rather than as looking. The eyes are the entire
// point of the pose. Judge any change to this number by whether both eyes are
// still visible AT THE GAME CAMERA, never from a close-up.
const ADMIRE_PITCH = -0.5;
// He is much closer than his reef perch, so he needs LESS scale, not more -
// perspective is already doing the work of making him big.
const ADMIRE_SCALE = 0.62;
// ⛔ HE TAKES HIS TIME. The first version crossed from the reef to the
// foreground in 1.9s flat, which from the back of the reef is most of the width
// of the world and read as a creature being yanked on a string. Duration is
// derived from the distance he actually has to cover, so a long trip takes
// longer, and the whole thing is unhurried: if the child finishes the word
// before he arrives, he simply turns around. Arriving is not the point.
const ADMIRE_SPEED = 24;    // world units per second
const ADMIRE_IN_MIN = 2.4;
const ADMIRE_IN_MAX = 6.5;
const ADMIRE_OUT = 2.2;     // seconds swimming back out

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
  // ⭐ The deform bones, so the dash can stream the arms back.
  //
  // tools/rig_octopus.py builds a four-bone chain down the body - b0 is the
  // mantle (deliberately rigid), b1..b3 carry progressively more of the arms.
  // Posing b1..b3 is how an arm sweep happens at all: the baked Idle clip makes
  // them undulate, but nothing in it streams them, and a clip cannot know which
  // way he is travelling anyway.
  const bones = [];
  holder.traverse(o => {
    if (!o.isSkinnedMesh || !o.skeleton) return;
    for (const b of o.skeleton.bones) if (!bones.includes(b)) bones.push(b);
  });
  bones.sort((a, b) => (a.name > b.name ? 1 : -1));   // b0, b1, b2, b3

  return { holder, skin, trim, keep, bones,
           base: skin.map(m => m.color.clone()),
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
export function createReefOctopus(scene, creatures, getReef, getVowelBubble) {
  // Reused, never reallocated - this runs every frame of the hold.
  const admireTarget = new THREE.Vector3(0, 9, ADMIRE_Z);
  /** Where he hangs to look at the letter. See the ADMIRE_* notes above. */
  function admirePos() {
    const b = getVowelBubble && getVowelBubble();
    if (!b || !Number.isFinite(b.y) || !Number.isFinite(b.r)) return admireTarget;
    const rim = (b.y + b.r) * ADMIRE_DEPTH_GAIN;
    return admireTarget.set(b.x || 0, rim + ADMIRE_EYE_CLEAR - ADMIRE_EYE_RISE, ADMIRE_Z);
  }

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

  // True while a shark pass is on. A predator outranks everything else he
  // might be doing.
  let spooked = false;
  let wasSpooked = false;

  // The migration. Non-null while he is swimming back to the far reef.
  // { t, dur, from: Vector3, toBand }
  let migrate = null;

  // The "O" routine. Non-null while he is away from the reef admiring a letter.
  // { phase: 'in'|'hold'|'out', t, from: Vector3, fromScale }
  let show = null;

  // Chameleon.
  let blend = 0.2;          // 0 = its own colour, 1 = matching the coral
  let blendTo = 0.2;
  let blendT = 0;
  let blendDur = 5;
  let tone = new THREE.Color(BLEND_TONES[0]);
  let flush = 0;            // a brief bright pulse, strongest right after a move

  const rnd = (a, b) => a + Math.random() * (b - a);

  /** Put him on the furthest band available, right now. */
  function settleFar() {
    const reef = getReef && getReef();
    const bands = (reef && reef.bands) || [];
    if (!bands.length) return false;
    const far = bands.slice().sort((a, b) => a.position.z - b.position.z)[0];
    return settleOn(far);
  }

  /** Leave. The pass is over, or the reef was rebuilt under us. */
  function retire() {
    if (band) band.remove(holder);
    scene.add(holder);
    holder.visible = false;
    band = null; anchor = null;
  }

  /** Move in, on a band that has just wrapped to the far end. */
  function settleOn(newBand, want = null) {
    const clusters = newBand.children.filter(c => c.userData && c.userData.isCluster);
    if (!clusters.length) return false;
    // `want` is the garden a migration aimed at - honouring it is what makes
    // the arrival continuous with the swim.
    const c = (want && clusters.includes(want))
      ? want : clusters[Math.floor(Math.random() * clusters.length)];
    const cs = c.userData.clusterScale || 2;

    // ⛔ NO RANDOM OFFSET WHEN A SWIM AIMED HERE. perchOn() computed the exact
    // world point he has been swimming toward for the last few seconds; jogging
    // the anchor a couple of units sideways on arrival puts a visible hop on
    // the end of an otherwise continuous move.
    const exact = !!(want && c === want);
    anchor = {
      x: c.position.x + (exact ? 0 : rnd(-2.5, 2.5)),
      y: FLOOR_Y + PERCH_UP + cs * PERCH_PER_SCALE,
      z: c.position.z + (exact ? 0 : rnd(-1.5, 2.5)),
    };
    band = newBand;
    band.add(holder);
    // ⛔⛔ SET THE LOCAL POSITION IMMEDIATELY. `holder.position` may still hold
    // a WORLD position from a swim that just ended, and band.add() does not
    // convert it - so the band's own z gets added to it and he lands at twice
    // the depth (a measured -262 on a band at -131) until the next frame
    // corrects it. One frame, 131 units out, right at the end of the dash.
    holder.position.set(anchor.x, anchor.y, anchor.z);
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
      //
      // ⛔ 0.32, not 0.55, and the top of the range is 0.90 rather than 1.0.
      // Camouflage is the best thing this creature does and it was also what
      // made it impossible to find: at a 55% chance of blending to FULL match,
      // the animal was effectively absent more often than it was present. It
      // now hides less often and never completely - there is always a little of
      // its own colour left, which is the difference between "well hidden" and
      // "not there". Spotting it is the game; winning that game has to be
      // possible.
      // ⭐ He commits. The old range left him hovering around the middle a lot,
      // where the skin is a blend of two colours and reads as neither - which
      // is the least interesting place on the dial. Now he is either clearly
      // wearing a colour or clearly wearing his own, and the eye can see the
      // change happen.
      if (Math.random() < 0.45) {
        blendTo = rnd(0.82, 0.96);         // wearing the tone, near fully
        blendDur = rnd(2.2, 4.2);
        // A fresh tone for each hiding phase, so consecutive changes are
        // between DIFFERENT colours rather than the same one twice.
        let next = tone;
        for (let g = 0; g < 4 && next.getHex() === tone.getHex(); g++) {
          next = new THREE.Color(BLEND_TONES[Math.floor(Math.random() * BLEND_TONES.length)]);
        }
        tone = next;
      } else {
        blendTo = rnd(0.0, 0.12);          // unmistakably his own colour
        blendDur = rnd(1.8, 3.4);
      }
      blendT = 0;
    }
    // Keep it inside its own garden rather than wandering off across the sea bed.
    to.x = THREE.MathUtils.clamp(to.x, -9, 9);
    to.y = THREE.MathUtils.clamp(to.y, -2.5, 4.5);
    to.z = THREE.MathUtils.clamp(to.z, -5, 6);
    modeT = 0;
  }

  /**
   * Push the current camouflage value onto the model's materials. Shared by the
   * reef behaviour and the O routine so the two can never drift apart.
   */
  function paint() {
    const shown = THREE.MathUtils.clamp(blend - flush * 0.55, 0, 1);
    // Every skin material shifts from ITS OWN base colour toward the chosen
    // coral tone. Starting from each material's own colour rather than from one
    // shared constant matters: the model is painted in several related mauves,
    // and flattening them all to a single colour would throw away the shading
    // the artist built in and leave a plastic silhouette.
    body.skin.forEach((m, i) => {
      // ⛔ The tone is applied at FULL strength at shown = 1, not at a fraction
      // of it. A cap here is invisible in the code and reads on screen as the
      // camouflage never quite working.
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

  /**
   * World-space perch on a SPECIFIC garden.
   *
   * ⛔ IT TAKES THE CLUSTER, IT DOES NOT CHOOSE ONE. The first version picked a
   * random cluster on every call, and it is called once a frame during the
   * dash - so the destination jittered between gardens the whole way across and
   * he still arrived with a 66-unit jump when settleOn() then picked a third
   * one. Commit to a destination at the start and swim to THAT.
   */
  function perchOn(b, c) {
    const cs = (c && c.userData.clusterScale) || 2;
    return new THREE.Vector3(
      c ? c.position.x : 0,
      FLOOR_Y + PERCH_UP + cs * PERCH_PER_SCALE,
      b.position.z + (c ? c.position.z : 0));
  }

  /** Give up on this garden and swim for the back of the reef. */
  function startMigration() {
    const reef = getReef && getReef();
    const bands = (reef && reef.bands) || [];
    // Furthest band that is NOT the one he is leaving.
    const far = bands.filter(b => b !== band)
                     .sort((a, b2) => a.position.z - b2.position.z)[0];
    if (!far) return;
    const from = new THREE.Vector3();
    holder.getWorldPosition(from);
    if (band) band.remove(holder);
    band = null; anchor = null;
    scene.add(holder);
    holder.position.copy(from);
    holder.visible = true;
    const clusters = far.children.filter(c => c.userData && c.userData.isCluster);
    const toCluster = clusters.length
      ? clusters[Math.floor(Math.random() * clusters.length)] : null;
    const dist = from.distanceTo(perchOn(far, toCluster));
    migrate = {
      t: 0,
      dur: THREE.MathUtils.clamp(dist / MIGRATE_SPEED, MIGRATE_MIN, MIGRATE_MAX),
      from,
      toBand: far,
      toCluster,
    };
    // Flush to his own colours for the dash. An animal bolting is not hiding.
    blendTo = 0.05; blendT = 0; blendDur = 0.8;
    flush = 1;
  }

  /**
   * Bend the deform chain by `amount`, growing toward the arm tips.
   *
   * b0 is the mantle and is left alone - an octopus's body is firm and only the
   * arms flow, which is also why tools/rig_octopus.py gives b0 zero amplitude
   * in the Idle clip.
   */
  function armSweep(amount) {
    const bones = body.bones;
    for (let i = 1; i < bones.length; i++) {
      // Ramped down the chain so the arc opens out toward the tips instead of
      // hinging at one joint.
      bones[i].rotation.x += amount * (i / (bones.length - 1)) * 0.8;
    }
  }

  /** Advance the dash. Returns true while it owns him. */
  function stepMigrate(t, dt) {
    const reef = getReef && getReef();
    const bands = (reef && reef.bands) || [];
    if (!bands.includes(migrate.toBand)) {   // reef rebuilt under us
      migrate = null;
      settleFar();
      return false;
    }
    migrate.t += dt;
    const k = Math.min(1, migrate.t / migrate.dur);
    // ⛔ The destination is recomputed EVERY FRAME. The target band is itself
    // travelling forward at TRAVEL u/s the whole time he is swimming, so a
    // target captured at the start would leave him arriving several units in
    // front of the garden he aimed at.
    const to = perchOn(migrate.toBand, migrate.toCluster);
    // easeInOut, but weighted to a hard launch - the push off the coral is the
    // bit that reads as a torpedo.
    // ⛔ THE BASE IS CLAMPED, AND IT HAS TO BE. At k = 1, (1 - 0.18) / 0.82
    // evaluates to 1.0000000000000002 in floating point, so the base lands at
    // -2.2e-16 - and Math.pow(negative, fractional) is NaN. That NaN went
    // straight into holder.position on the last frame of every single dash and
    // the octopus's world position was briefly not a number.
    const tail = Math.max(0, 1 - (k - 0.18) / 0.82);
    const e = k < 0.18 ? (k / 0.18) * (k / 0.18) * 0.22
                       : 0.22 + 0.78 * (1 - Math.pow(tail, 2.2));
    holder.position.lerpVectors(migrate.from, to, e);

    // Head first, arms behind: he faces the way he is going, which is away
    // from the camera, and rotation.y 0 already means facing +Z.
    const dir = to.clone().sub(migrate.from);
    holder.rotation.y = Math.atan2(dir.x, dir.z);
    // Nose down slightly into the dive, levelling off as he arrives.
    holder.rotation.x = -0.28 * Math.sin(k * Math.PI);
    holder.rotation.z = Math.sin(t * 2.2) * 0.07 * (1 - k);

    // Stretched along the direction of travel while the speed is up. Squash and
    // stretch is what sells velocity on a creature with no visible propulsion.
    const speed = Math.sin(Math.min(1, k / 0.75) * Math.PI);
    holder.scale.set(SCALE * (1 - speed * 0.16), SCALE * (1 - speed * 0.16),
                     SCALE * (1 + speed * 0.42));
    if (mixer) mixer.timeScale = 1 + speed * 2.2;   // arms thrashing

    // ⭐ ARMS STREAMED BACK. Squash-and-stretch alone does not read as a
    // torpedo - the silhouette has to change, and on this animal the
    // silhouette IS the arms.
    //
    // ⛔ This ADDS to the pose the AnimationMixer wrote this frame rather than
    // replacing it, so the Idle undulation still plays underneath and the arms
    // keep flexing while they trail. It only works because main.js runs
    // creatures.update() (the mixers) BEFORE this; with the old order the clip
    // overwrote all of it and the dash had no arms in it at all.
    armSweep(speed * ARM_SWEEP);

    if (k >= 1) {
      const b = migrate.toBand, c = migrate.toCluster;
      migrate = null;
      holder.scale.setScalar(SCALE);
      holder.rotation.set(0, 0, 0);
      scene.remove(holder);
      // ⛔ Settle on the garden he actually swam to, not a fresh random one.
      settleOn(b, c);
      return false;
    }
    return true;
  }

  /**
   * Come and look at the letter. Safe to call repeatedly - a second call while
   * he is already on his way in, or already there, does nothing.
   *
   * Works whether or not he is currently on the reef: if he is away between
   * passes the letter SUMMONS him, and he swims up from below the frame.
   */
  function admire() {
    // ⛔ A SHARK OUTRANKS A LETTER. Refusing here rather than only gating the
    // caller matters because the caller re-evaluates the board after every
    // change: without this, popping and re-throwing the O during a pass would
    // walk him straight back out into the shark's path.
    if (spooked) return;
    if (show && show.phase !== 'out') return;
    // The letter outranks the commute. If he is mid-dash he turns and comes.
    if (migrate) { migrate = null; holder.scale.setScalar(SCALE); holder.rotation.set(0, 0, 0); }
    const from = new THREE.Vector3();
    if (show) {
      // Caught mid-retreat - turn him around from wherever he got to.
      from.copy(holder.position);
    } else if (band) {
      // On the reef: start from where he actually is, so he swims in from his
      // garden rather than teleporting to a start mark.
      holder.getWorldPosition(from);
    } else {
      // Away. Rise into frame from below, centre-ish, rather than fading in -
      // a creature appearing out of nothing is the thing this whole file keeps
      // trying not to do.
      from.set(rnd(-6, 6), -26, -14);
    }
    if (band) { band.remove(holder); }
    band = null; anchor = null;
    scene.add(holder);
    holder.position.copy(from);
    holder.visible = true;
    // ⭐ Duration from DISTANCE, not a constant. He may be setting off from the
    // very back of the reef or from a garden that is nearly out of frame, and a
    // fixed duration makes the far trip a panicked dash and the near one a
    // crawl. Clamped at both ends so it never looks teleported or glacial.
    const dist = from.distanceTo(admirePos());
    const dur = THREE.MathUtils.clamp(dist / ADMIRE_SPEED, ADMIRE_IN_MIN, ADMIRE_IN_MAX);
    show = { phase: 'in', t: 0, from: from.clone(), dur };
    // Arrive in his own colours. Camouflage is for hiding on the reef; this is
    // the opposite of hiding.
    blendTo = 0.0; blendT = 0; blendDur = 1.2;
    flush = 1;
  }

  /**
   * The O has left the bubble. Swim back out to the reef.
   *
   * ⛔ HE SWIMS TO AN ACTUAL GARDEN, not to a generic "away" point. The first
   * version retreated to a fixed spot below and behind, then called settleFar()
   * - which placed him on the reef instantly, a 148-unit jump, and that
   * endpoint was still ON SCREEN (y -30 at z -70 is 0.75 of the way down the
   * frame, not past the edge). So the exit ended in exactly the teleport the
   * migration exists to avoid. The retreat is now just a migration with a
   * different starting point.
   */
  function release() {
    if (!show || show.phase === 'out') return;
    const reef = getReef && getReef();
    const bands = (reef && reef.bands) || [];
    const far = bands.slice().sort((a, b) => a.position.z - b.position.z)[0] || null;
    const clusters = far ? far.children.filter(c => c.userData && c.userData.isCluster) : [];
    const toCluster = clusters.length
      ? clusters[Math.floor(Math.random() * clusters.length)] : null;
    const from = holder.position.clone();
    // ⛔ Distance-based, like the migration, and for the same reason: a fixed
    // 2.2s had to cover a turn on the spot AND a ~120 unit dash back to the
    // reef, so neither read - he snapped round and shot off in a blur. The
    // turn needs time to be seen as a turn.
    const dist = far ? from.distanceTo(perchOn(far, toCluster)) : 90;
    show = {
      phase: 'out',
      t: 0,
      from,
      dur: THREE.MathUtils.clamp(dist / MIGRATE_SPEED, ADMIRE_OUT, MIGRATE_MAX),
      toBand: far,
      toCluster,
    };
  }

  /** Is he currently doing the O routine? */
  function isAdmiring() { return !!show && show.phase !== 'out'; }

  /**
   * The O routine, run instead of the reef behaviour. Returns true while it
   * owns the octopus.
   */
  function stepShow(t, dt) {
    show.t += dt;
    // ⛔ USE show.dur FOR BOTH PHASES. This line used to hardcode ADMIRE_OUT for
    // the retreat, which silently threw away the distance-based duration
    // release() had just computed - so the turn-and-torpedo had 2.2s to cover a
    // 115-unit swim and went past in a blur.
    const dur = show.dur || (show.phase === 'out' ? ADMIRE_OUT : ADMIRE_IN_MIN);
    const k = Math.min(1, show.t / dur);

    if (show.phase === 'hold') {
      // Parked under the letter. A slow hover and a little sway, so he reads as
      // treading water and looking rather than as a pasted-on sprite.
      const bob = Math.sin(t * 0.9) * 0.22;
      const sway = Math.sin(t * 0.61) * 0.5;
      const at = admirePos();
      holder.position.set(at.x + sway, at.y + bob, at.z);
      holder.rotation.set(ADMIRE_PITCH + Math.sin(t * 0.77) * 0.045,
                          Math.sin(t * 0.43) * 0.19, Math.sin(t * 0.55) * 0.05);
      holder.scale.setScalar(SCALE * ADMIRE_SCALE);
      if (mixer) mixer.timeScale = 0.75;
      return true;
    }

    if (show.phase === 'in') {
      // ⛔ Eased at BOTH ends, not just the arrival. easeOutCubic starts at full
      // speed, which is exactly the "yanked on a string" look - he has to push
      // off gently, cross, and settle. smootherstep does all three.
      const e = k * k * k * (k * (k * 6 - 15) + 10);
      holder.position.lerpVectors(show.from, admirePos(), e);
      holder.rotation.set(ADMIRE_PITCH * e, 0, 0);
      // Grow from his reef size to his close-up size along the way.
      holder.scale.setScalar(SCALE * (1 + (ADMIRE_SCALE - 1) * e));
      if (mixer) mixer.timeScale = 1.6;        // working at it
      if (k >= 1) show = { phase: 'hold', t: 0, from: show.from, dur };
      return true;
    }

    // ---- 'out': TURN, THEN TORPEDO ----------------------------------------
    //
    // ⛔ THIS IS NOT THE APPROACH PLAYED BACKWARDS, and the first version was
    // exactly that: a straight lerp home with the pitch easing out and - thanks
    // to a `* 0.0` left in the yaw term - no turn whatsoever. He drifted away
    // still facing the camera, arms hanging, and the whole exit read as a
    // rewind rather than as an animal leaving.
    //
    // He is facing the CAMERA when this starts (that is the whole admire pose),
    // and he has to end up facing the opposite way. So the move is in two
    // parts: a visible turn on the spot, then a dash with the arms streamed
    // back toward the viewer, which is the shape the migration already uses.
    const reef2 = getReef && getReef();
    const bands2 = (reef2 && reef2.bands) || [];
    const stillThere = show.toBand && bands2.includes(show.toBand);
    // Recomputed every frame: the destination band is travelling forward the
    // whole time he is swimming to it.
    const home = stillThere ? perchOn(show.toBand, show.toCluster)
                            : new THREE.Vector3(show.from.x * 0.4, -24, -90);

    // The turn happens up front and barely moves him - you have to SEE him come
    // about before he goes.
    const TURN = 0.3;
    const turn = Math.min(1, k / TURN);
    const turnE = turn * turn * (3 - 2 * turn);
    // Travel eases in only after the turn is underway, so he does not slide
    // away sideways while still coming about.
    const go = Math.max(0, (k - TURN * 0.55) / (1 - TURN * 0.55));
    const e = go * go * (3 - 2 * go);
    holder.position.lerpVectors(show.from, home, e);

    // Face where he is going. He starts at yaw 0 (looking at the camera) and
    // swings to the heading of his travel - which is into the screen, so this
    // is close to a half turn.
    const dirOut = home.clone().sub(show.from);
    const yawTo = Math.atan2(dirOut.x, dirOut.z);
    let dYaw = yawTo;
    while (dYaw > Math.PI) dYaw -= Math.PI * 2;
    while (dYaw < -Math.PI) dYaw += Math.PI * 2;
    holder.rotation.y = dYaw * turnE;
    // Level out of the look-up as he comes about, then nose down into the dive.
    holder.rotation.x = ADMIRE_PITCH * (1 - turnE) - 0.22 * Math.sin(e * Math.PI);
    holder.rotation.z = Math.sin(t * 2.4) * 0.06 * (1 - e);

    // ⭐ Arms streamed BACK - which, since he is swimming away, means stretched
    // out toward the camera. Same mechanism as the migration dash.
    const outSpeed = Math.sin(Math.min(1, Math.max(0, (k - TURN) / (1 - TURN))) * Math.PI);
    armSweep(outSpeed * ARM_SWEEP);

    // Shrink back toward his reef size, elongated along travel while quick.
    const sc = SCALE * (ADMIRE_SCALE + (1 - ADMIRE_SCALE) * e);
    holder.scale.set(sc * (1 - outSpeed * 0.16), sc * (1 - outSpeed * 0.16),
                     sc * (1 + outSpeed * 0.42));
    if (mixer) mixer.timeScale = 1 + outSpeed * 2.2;
    if (k >= 1) {
      const b = stillThere ? show.toBand : null;
      const c = show.toCluster;
      show = null;
      holder.scale.setScalar(SCALE);
      holder.rotation.set(0, 0, 0);
      scene.remove(holder);
      if (b) settleOn(b, c); else settleFar();
      return false;
    }
    return true;
  }

  function update(t, dt, opts = {}) {
    const reduced = !!opts.reducedMotion;

    // ⭐ A shark is passing. He gets out of the foreground, and he does it the
    // same way he leaves for any other reason - by swimming, through the usual
    // retreat - so there is no special-case motion to go wrong.
    //
    // ⛔ The hero shark passes IN FRONT of the bubbles. An octopus parked under
    // the middle bubble during a pass is not merely odd, it is directly in the
    // way of the one big event in the app.
    spooked = !!opts.predator;
    if (spooked && !wasSpooked) {
      // Pick a sea-bed colour once, on the fright, and hold it for the pass.
      tone = new THREE.Color(SPOOK_TONES[Math.floor(Math.random() * SPOOK_TONES.length)]);
    }
    wasSpooked = spooked;
    if (spooked && show && show.phase !== 'out') release();

    // ⛔⛔ WRAP BOOKKEEPING RUNS FIRST, ALWAYS, EVEN WHEN SOMETHING ELSE OWNS
    // HIM. The O routine and the dash both return early, and while they did so
    // zWatch went stale - so the first frame he was back on the reef, the
    // watcher compared a band's current z against one from several seconds ago,
    // decided it had just wrapped, and re-seated him on a random garden. A
    // 60-unit sideways hop immediately after an otherwise continuous swim.
    //
    // Recording z every frame and only ACTING on it when he is free is what
    // keeps the two in step.
    const reef0 = getReef && getReef();
    const wrapped = [];
    for (const b of (reef0 && reef0.bands) || []) {
      const prev = zWatch.get(b);
      const z = b.position.z;
      zWatch.set(b, z);
      if (prev !== undefined && z < prev - 1) wrapped.push(b);
    }

    // ⭐ The O routine OWNS him while it runs - no band watching, no scurrying,
    // no camouflage drift. Returning early is what keeps the two behaviours
    // from fighting over his position every frame.
    if (show) {
      // Chameleon still eases, so he can flush back to his own colours on the
      // way in, but everything else is the routine's.
      blendT += dt;
      blend += (blendTo - blend) * Math.min(1, dt * 2.2);
      flush = Math.max(0, flush - dt * 1.3);
      paint();
      // ⛔ RETURN EVEN ON THE FRAME IT FINISHES. Falling through meant the
      // band-wrap watcher below ran in the same frame he was re-seated on the
      // reef - and if that band had just recycled, it seated him a SECOND time
      // on a different garden, 67 units sideways in one frame. Exactly the
      // teleport this whole mechanism exists to remove.
      stepShow(t, dt);
      return;
    }

    // The dash back to the far reef. Same deal - it owns him while it runs,
    // and it returns on its completion frame too, for the same reason.
    if (migrate) {
      blend += (blendTo - blend) * Math.min(1, dt * 2.2);
      flush = Math.max(0, flush - dt * 1.3);
      paint();
      stepMigrate(t, dt);
      return;
    }

    const reef = getReef && getReef();
    const bands = (reef && reef.bands) || [];

    // ⭐ Leave BEFORE the garden is overtaken, and swim for it. See MIGRATE_AT.
    if (band && band.position.z > MIGRATE_AT) {
      startMigration();
      if (migrate) return;
    }

    // ---- wrap watching ----------------------------------------------------
    // A band that has just jumped backward is at the far end of the reef, which
    // is the ONLY place this creature is allowed to appear. Anywhere else and it
    // would materialise in open view - the same mistake the shark pass had to
    // be fixed for.
    for (const b of wrapped) {
      if (b === band) {
        // Normally unreachable: he leaves at MIGRATE_AT, well before his band
        // reaches the recycle point. This is the backstop for the case where
        // something held him on past it - take a different garden on the same
        // band rather than riding it round.
        settleOn(b);
      } else if (!band && !migrate) {
        // Not attached at all (startup, or he has just finished an O routine).
        // Take the first band that comes round, so he is never away for long.
        settleOn(b);
      }
    }

    // A rebuilt reef leaves us parented to a disposed band.
    if (band && !bands.includes(band)) retire();
    if (!band || !anchor) return;

    const m = reduced ? 0.35 : 1;

    // ---- fear -------------------------------------------------------------
    // ⭐ A shark overhead and he does what a real octopus does: stops dead and
    // goes the colour of the rock. No darting about - movement is what gets you
    // seen, and an animal that keeps scurrying while a predator passes reads as
    // oblivious rather than as hiding.
    if (spooked) {
      mode = 'rest';
      modeT = 0;
      modeDur = 1;                     // nothing new will start while frozen
      to.copy(at);
      // Press flat against the coral and go hard into camouflage.
      blendTo = 0.98;
      blendDur = 0.9;
      flush = 0;                       // no bright flush - that is the opposite
      at.y += (-1.6 - at.y) * Math.min(1, dt * 1.6);
      holder.position.set(anchor.x + at.x, anchor.y + at.y, anchor.z + at.z);
      // Hunkered: squat down and pull the arms IN, the reverse of the dash.
      const crouch = 1 - 0.14;
      holder.scale.set(SCALE / Math.sqrt(crouch), SCALE * crouch, SCALE / Math.sqrt(crouch));
      if (mixer) mixer.timeScale = 0.35;        // barely breathing
      armSweep(-0.34);
      blendT += dt;
      blend += (blendTo - blend) * Math.min(1, dt * 2.0);
      paint();
      return;
    }
    holder.scale.setScalar(SCALE);

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
    paint();
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

  // On the reef from the very first frame rather than after the first wrap.
  settleFar();

  return {
    update, dispose, debugShow, admire, release, isAdmiring,
    /**
     * Where a puff of ink should come out, in WORLD space, or null if he is
     * somehow not in the scene. Slightly below and in front of the mantle -
     * ink leaves through the siphon, under the body, not out of the top of the
     * head. Returns the live Vector3's values, not the rounded ones `state`
     * reports, because this feeds a particle position.
     */
    inkOrigin() {
      if (!holder.visible) return null;
      const w = holder.getWorldPosition(new THREE.Vector3());
      if (!Number.isFinite(w.x)) return null;
      // Scaled off SCALE so it stays under him whatever size he is.
      return { x: w.x, y: w.y - SCALE * 0.45, z: w.z + SCALE * 0.6,
               r: SCALE * 1.15 };
    },
    /**
     * Null while it is away between passes - that is the normal resting state.
     * The position is the WORLD position, composed through the band it is
     * riding, which is the only number that answers "is it actually on screen".
     */
    get state() {
      // ⛔ `band` alone is NOT "is he here". He is off-band and plainly on
      // screen during both the dash back to the far reef and the O routine, and
      // reporting null for those made a test conclude he was absent 5.7% of the
      // time when he was in fact swimming across the frame.
      if (migrate || show) {
        const w = holder.getWorldPosition(new THREE.Vector3());
        return {
          mode: migrate ? 'migrate' : ('admire:' + show.phase),
          blend: +blend.toFixed(2),
          x: +w.x.toFixed(1), y: +w.y.toFixed(1), z: +w.z.toFixed(1),
        };
      }
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
