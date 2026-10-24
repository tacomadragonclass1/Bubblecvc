// -------------------------------------------------------------------- shark
// The hero shark: one enormous silhouette that crosses the scene every few
// minutes and then is gone.
//
// WHY THIS IS NOT JUST ANOTHER SWIMMER. The pack's shark used to be spawned by
// ocean.js as ordinary traffic - lane -50, ~9 units long, back and forth
// forever. At that size and that repetition the eye files it as "a fish", and
// no amount of extra polygons would have changed that. What makes a shark land
// is staging: scale, slowness, silhouette, the light dipping as it goes over,
// the small fish getting out of the way, and above all RARITY. All of that is
// here; none of it is in the model.
//
// ⭐ The model itself is the CC0 Quaternius shark already in the pack (644
// triangles). Its PROFILE is accurate - snout taper, dorsal, caudal lobe - and
// a near-silhouette shows nothing but profile, so the low poly count costs
// nothing at hero scale. Check any replacement the same way: look at the
// outline, not the wireframe.
//
// ⛔ THE TIMING GATE IS NOT POLISH. This is a reading board. A forty-unit dark
// shape sweeping behind the letters while a child is sounding out a word is
// exactly the thing that breaks a blend. A pass only ever STARTS when the board
// is idle (see isIdle in main.js); once started it is allowed to finish, because
// a shark that vanishes mid-screen reads as a bug.

import * as THREE from '../vendor/three.module.js';
import { makeUnderwater, waterUniforms } from './lightwater.js';
import { halfWidthAt } from './frustum.js';

// How long one crossing takes, in seconds. Shorter than the first version's 30:
// that was a pass across the BACK of the scene, where slowness is what reads as
// mass. This one comes forward past the camera and parallax does that job
// instead - held any longer, a body this close stops being an event and starts
// being an obstruction in front of the letters.
const CROSS_SECONDS = 19;

// Multiplier on the loader's normalised 5.6-unit creature length, so the body
// comes out around 39 units - roughly half the screen width at the hero lane.
const HERO_SCALE = 7.0;

// ⭐ IT COMES FORWARD. Enters deep, where the small fish can see it and scatter,
// then swims PAST THE PLAY PLANE (z = 0) and crosses the MIDDLE of the screen
// in FRONT of the bubbles. That approach is the whole "woah": a shape
// that is merely large at the back of the scene becomes something passing right
// in front of you, briefly filling the frame.
//
// ⛔ This deliberately breaks the earlier rule that nothing may occlude a
// letter. It is allowed to cover the bubbles - which is exactly why the idle
// gate in main.js matters MORE now, not less: a pass may never START while a
// child is mid-word. If it ever feels like an interruption, shorten
// CROSS_SECONDS or pull Z_EXIT back toward 0. Do not weaken the gate.
const Z_ENTER = -26;
const Z_EXIT  = 3;

// Clear margin beyond the visible edge at both ends, ON TOP of half the body
// length. See edgeX() for why this cannot just be added to bounds.x.
const LEAD = 8;

// First pass soon after the LESSON starts - not after the page loads. Values in
// seconds.
//
// ⛔ THE PRESCREEN IS OPAQUE. Its background is a solid gradient at z-index 60
// covering inset: 0, so the whole 3D scene is hidden behind it. The first
// version counted the page-load clock and let a pass run while the letter
// picker was up: the shark crossed an invisible scene, nobody saw it, and the
// schedule then rolled on to the 4-7 minute gap. A teacher who spent a minute
// choosing letters would start the lesson having already burned the pass, and
// then wait up to seven minutes for the next one. That is exactly what "I hit
// refresh and I don't see the shark" looked like from the classroom.
const FIRST_MIN = 45,  FIRST_MAX = 75;
// ⭐ 4-7 minutes was too rare to survive contact with a real lesson: a class saw
// it once and never again, because an activity does not last long enough for
// the second one. "Sparse" has to mean "a treat", not "a rumour". At 1.5-3
// minutes a ten-minute activity gets three or four passes, which is still few
// enough that the room reacts every time.
const GAP_MIN   = 90,  GAP_MAX   = 170;

// ⛔ The idle gate must never be able to STARVE the event. On a busy board -
// three children flicking dice, words being spoken - "nothing at all is
// happening" can stay false for a long time, and every pass would slip further
// behind. After this many seconds of waiting, the only thing still allowed to
// hold a pass back is a word actually being spoken; a die in flight is a
// half-second event and is not a reason to withhold a 19-second one.
const GRACE = 40;

// How far from the body a fish starts getting out of the way.
const THREAT_RADIUS = 26;

const rand = (a, b) => a + Math.random() * (b - a);

/**
 * `creatures` is the glTF library from creatures.js. The hero needs a REAL
 * model: the procedural fallback is a squashed sphere with cones on it, which
 * is honest scenery at 9 units and a joke at 39. With no model the event simply
 * never schedules and the scene is exactly as it was.
 */
export function createSharkPass(scene, creatures) {
  // ⛔ bounds is NOT captured here. main.js REPLACES the bounds object on every
  // resize, so a reference taken at construction would still describe the old
  // viewport - and the shark would enter from inside the frame, or never leave
  // it. It arrives per frame in ctx instead.
  let bounds = { x: 19, y: 10.8 };
  const holder = creatures && creatures.make('hero', HERO_SCALE);
  if (!holder) return null;

  // ---- silhouette treatment ---------------------------------------------
  // Materials are SHARED by three.js clone(), so these are cloned first -
  // mutating in place would reach back into the library copy.
  holder.traverse(o => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const out = mats.map(m => {
      const c = m.clone();
      // ⭐ COUNTER-SHADING, not a flat dark body. The first pass painted both of
      // the model's materials the same near-black and the result was a hole in
      // the frame - a blob with no form at any point in the crossing. Real
      // sharks are dark on top and pale underneath, and that boundary running
      // the length of the body is what makes the eye read a SHAPE rather than a
      // shadow. The pack's model already splits Top/Bottom; keep that split and
      // only push both toward the water's palette.
      // Both values sit BELOW the water they cross, or the body reads as a pale
      // toy: the first attempt at counter-shading was too light and looked like
      // a model on a shelf. Dark enough to be a shape, light enough on the
      // underside to still have a form.
      const belly = /bottom|belly|under/i.test(m.name || '');
      c.color = new THREE.Color(belly ? 0x5e7b8d : 0x102a3e);
      // Not fully matte: a little specular along the back is what catches the
      // key light and separates the dorsal edge from the water behind it.
      c.roughness = belly ? 0.93 : 0.78;
      c.metalness = 0.0;
      // Re-apply the underwater shading with its OWN settings: the flag that
      // makeUnderwater sets to stay idempotent came across with the clone, and
      // a hero needs less fog than background traffic so its edge stays crisp
      // against the water instead of dissolving into it.
      delete c.userData.__underwater;
      makeUnderwater(c, { caustics: 0.8, fog: 0.3 });
      return c;
    });
    o.material = Array.isArray(o.material) ? out : out[0];
  });

  // The baked Swim clip runs at a fish's tempo. A big animal beats slowly, and
  // this one number does more for the sense of mass than the scale does.
  const mixer = holder.userData.mixer;
  if (mixer) mixer.timeScale = 0.42;

  holder.visible = false;
  // ⛔ NEVER let three.js frustum-cull this. Culling tests a SkinnedMesh against
  // the bounding sphere of its BIND POSE, which here works out at a radius of
  // 20 world units for a body whose posed half-length is 19.5 - half a unit of
  // margin on a shape that fills the screen. Any disagreement between those two
  // numbers shows up as the whole animal blinking out mid-frame. There is
  // exactly one of these; drawing it unconditionally costs nothing.
  holder.frustumCulled = false;
  holder.traverse(o => { o.frustumCulled = false; });
  scene.add(holder);

  // Half the body along its travel axis, from the loader's normalised length.
  // Used for the entry/exit margin, so a bigger HERO_SCALE cannot make the
  // shark pop into view.
  const bodyHalfLength = 5.6 * HERO_SCALE / 2;

  let active = false;
  let camNow = null;               // live camera, for per-depth measurements
  let u = 0;                       // 0..1 progress across the screen
  let dir = 1, xStart = 0, xEnd = 0, y0 = 0, y1 = 0, phase = 0;
  let zExit = Z_EXIT;              // jittered per pass, see begin()
  let nextAt = rand(FIRST_MIN, FIRST_MAX);
  let waitingSince = 0;            // when the pass first became due but blocked
  let clockT = 0;
  let eclipse = 0;                 // 0..1, how much light it is blocking
  let eclipseX = 0.5;              // where on screen, in uv

  // Geometry caustics are a single shared uniform, so the dip only has to be
  // written once per frame. Captured here so the pass restores exactly what it
  // found rather than assuming 1.0.
  const causticBase = waterUniforms.uCausticStrength.value;

  function begin() {
    active = true;
    waitingSince = 0;
    u = 0;
    dir = Math.random() < 0.5 ? 1 : -1;
    // Each end is measured at ITS OWN depth: the frustum is 46 units wide where
    // it enters and 16 where it leaves, so one figure cannot serve both. The
    // entry width used at the exit would park the last quarter of the pass
    // harmlessly off screen; the exit width used at the entry would pop the
    // snout into frame out of nothing.
    // A little variation per pass. At one every couple of minutes an identical
    // move starts to read as a loop; the depth jitter changes how much of the
    // body fills the frame without ever making it small.
    zExit = Z_EXIT + rand(-0.8, 1.2);
    // ⛔ The endpoints are NOT cached here. They are recomputed every frame in
    // update() from the live camera, because the window can change shape in the
    // middle of a 19-second pass - fullscreen, a panel's on-screen keyboard, a
    // rotated tablet - and a pass finishing against stale endpoints ends while
    // the body is still in view.
    // Enters in mid-water and comes up into the bubble row as it closes, so
    // the nearest part of the pass happens at the height the eye is already
    // reading. The dorsal fin clears the bubbles at the start; by the end the
    // body is in front of them, which is the point.
    y0 = rand(-bounds.y * 0.34, -bounds.y * 0.12);
    y1 = rand(-bounds.y * 0.16, bounds.y * 0.12);
    phase = Math.random() * Math.PI * 2;
    holder.visible = true;
  }

  function end() {
    active = false;
    waitingSince = 0;
    holder.visible = false;
    eclipse = 0;
    waterUniforms.uCausticStrength.value = causticBase;
    nextAt = clockT + rand(GAP_MIN, GAP_MAX);
  }

  /**
   * @param ctx.live   a lesson is actually on screen. Nothing runs while the
   *                   prescreen is up, because the prescreen hides the scene
   *                   completely - a pass there is a pass nobody sees.
   * @param ctx.idle   board is safe to interrupt (nothing in flight, nothing
   *                   being spoken). A pass only STARTS when this is true; if
   *                   the window arrives mid-word the pass waits rather than
   *                   being skipped, so a busy lesson does not lose its shark.
   * @param ctx.camera used to find where the body is on screen, for the dip.
   */
  /**
   * How far out along x the body must START to be genuinely off screen.
   *
   * ⛔ NOT bounds.x + a constant. bounds.x is the half-width at the PLAY PLANE
   * (z = 0); the shark runs 30 units behind it, where the frustum is half again
   * as wide - 44 world units instead of 21 at this aspect. Using the play-plane
   * figure put the tail still on screen at u = 1, so the shark vanished in
   * open water. Measured from the camera every pass, because it also depends
   * on the window's aspect ratio.
   */
  function edgeAt(camera, z) {
    return halfWidthAt(camera, z) + bodyHalfLength + LEAD;
  }

  function update(t, dt, ctx) {
    clockT = t;
    if (ctx.bounds) bounds = ctx.bounds;
    camNow = ctx.camera;
    if (!active) {
      if (ctx.live && t >= nextAt) {
        if (ctx.idle) {
          begin();
        } else {
          if (!waitingSince) waitingSince = t;
          // Overdue and still blocked: let it go anyway unless a word is
          // actually being spoken.
          if (t - waitingSince > GRACE && !ctx.speaking) begin();
        }
      }
      return;
    }
    // The lesson ended mid-pass (Home pressed). The scene is behind the
    // prescreen now, so finish quietly rather than animating to nobody.
    if (!ctx.live) { end(); return; }

    u += dt / CROSS_SECONDS;

    // Position, with a slow swell on top so it never travels on rails.
    // ⛔ The approach has to be AHEAD of the sweep, not behind it. A cubic (u³)
    // was tried first and it put the shark in front of the bubbles only in the
    // last 12% of the pass - by which point it is already leaving frame, so the
    // close-up lasted barely two seconds and happened in the corner. x crosses
    // the centre of the screen at u ≈ 0.59, so the body has to BE forward by
    // then. This holds it deep briefly, brings it past the play plane by
    // mid-screen, and leaves it close for the whole exit.
    const ease = u * u * (3 - 2 * u);
    const smooth = (a, b, x) => {
      const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return k * k * (3 - 2 * k);
    };
    // Measured live, at each end's OWN depth: the frustum is 46 units wide
    // where it enters and 16 where it leaves, so one figure cannot serve both.
    xStart = -dir * edgeAt(camNow, Z_ENTER);
    xEnd = dir * edgeAt(camNow, zExit);
    // Finishing the approach BEFORE mid-screen (x crosses centre at u ≈ 0.59)
    // is what makes the whole second half of the pass happen in front of the
    // bubbles. Finishing it later put the close-up in the corner; finishing it
    // at z = 4 put the camera so close that the frame filled with midsection
    // and the animal stopped being legible as a shark.
    const approach = smooth(0.06, 0.52, u);
    const x = xStart + (xEnd - xStart) * u;
    const y = y0 + (y1 - y0) * ease + Math.sin(t * 0.22 + phase) * 1.1;
    holder.position.set(x, y, Z_ENTER + (zExit - Z_ENTER) * approach);

    // ⛔ The pass ends when the body is GENUINELY OFF SCREEN, not when a counter
    // reaches 1. A pass was seen to "flicker and disappear" mid-screen, and every
    // candidate cause - a stale exit endpoint after a resize, a cull against
    // the bind-pose sphere, an aspect ratio the margin was not computed for -
    // has that same signature: the shark vanishing in plain sight. Asking where
    // the body actually is cannot fail that way. u >= 1.6 is a backstop so a
    // pass can never run forever.
    if (u >= 1) {
      const clear = Math.abs(x) - bodyHalfLength > halfWidthAt(camNow, holder.position.z);
      if (clear || u >= 1.6) { end(); return; }
    }
    holder.rotation.y = dir > 0 ? 0 : Math.PI;
    // Bank into the descent. Tiny: a shark does not roll like an aircraft.
    const bank = Math.sin(t * 0.22 + phase) * 0.05 - 0.04;
    holder.rotation.z = dir > 0 ? bank : -bank;

    // ---- the light dip -----------------------------------------------------
    // It is between the scene and the sun, so the god rays and the caustics
    // fall off under it and come back as it moves on. Presence fades at both
    // ends so nothing pops when it enters or leaves.
    const presence = Math.min(1, Math.sin(Math.PI * u) * 2.2);
    eclipse = presence * 0.85;
    const ndc = holder.position.clone().project(ctx.camera);
    eclipseX = ndc.x * 0.5 + 0.5;
    waterUniforms.uCausticStrength.value = causticBase * (1 - eclipse * 0.38);
  }

  return {
    /** Where the body is, for the fish to flee from. Null when nothing is on. */
    threat() {
      return active
        ? { x: holder.position.x, y: holder.position.y, z: holder.position.z,
            radius: THREAT_RADIUS }
        : null;
    },
    /** Eclipse state for the water backdrop shader. */
    light() { return { amount: eclipse, x: eclipseX }; },
    /** 0-1 across the screen. Read by the debug handle when tuning the look. */
    get progress() { return active ? u : 0; },
    update,
    get active() { return active; },
    /** Seconds until the next pass - read by the debug handle. */
    get eta() { return active ? 0 : Math.max(0, nextAt - clockT); },
    /**
     * Start the clock for a new lesson. Called when a session begins, so the
     * first shark is a known 45-75s into the LESSON rather than a leftover of
     * however long someone spent on the letter picker.
     *
     * Takes the time explicitly because the models load asynchronously: this
     * can be called before the pass has ever been updated, when its own clock
     * is still sitting at zero.
     */
    reschedule(now = clockT) { clockT = now; nextAt = now + rand(FIRST_MIN, FIRST_MAX); },
    /**
     * Call the shark. Used by the summoning word (see SUMMON_WORDS in main.js).
     *
     * ⭐ This does NOT begin a pass - it makes one DUE. The ordinary gate then
     * holds it until the board is idle, which means until the spoken word has
     * finished. That is the whole effect: a child spells the word, hears it
     * said back, and THEN the water goes dark. Starting the pass directly would
     * put a forty-unit shark across the board while the blend is still playing,
     * which is the one thing the gate exists to prevent.
     */
    summon() {
      if (active) return false;        // already here
      nextAt = clockT;
      waitingSince = 0;
      return true;
    },
    /** Debug / preview: start one now, ignoring the schedule. */
    now() { if (!active) begin(); },
    dispose() {
      scene.remove(holder);
      waterUniforms.uCausticStrength.value = causticBase;
    },
  };
}
