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

// How long one crossing takes, in seconds. This is the single most important
// number in the file. Under ~18s it reads as a fast fish; at 30 the snout is on
// screen for several seconds before the eye understands the scale of the thing.
const CROSS_SECONDS = 30;

// Multiplier on the loader's normalised 5.6-unit creature length, so the body
// comes out around 39 units - roughly half the screen width at the hero lane.
const HERO_SCALE = 7.0;

// Nearer than the deep lane (-50) but still well behind the play plane at z=0,
// so it can never occlude a die, a bubble or a letter. It closes slightly as it
// crosses, which reads as a turn toward the glass rather than a slide.
const Z_ENTER = -35;
const Z_EXIT  = -28;

// Clear margin beyond the visible edge at both ends, ON TOP of half the body
// length. See edgeX() for why this cannot just be added to bounds.x.
const LEAD = 8;

// First pass soon after the session opens, so a lesson actually sees one and
// the world is established; after that, rare. Values in seconds.
const FIRST_MIN = 60,  FIRST_MAX = 120;
const GAP_MIN   = 240, GAP_MAX   = 420;

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
  holder.renderOrder = -5;
  scene.add(holder);

  // Half the body along its travel axis, from the loader's normalised length.
  // Used for the entry/exit margin, so a bigger HERO_SCALE cannot make the
  // shark pop into view.
  const bodyHalfLength = 5.6 * HERO_SCALE / 2;

  let active = false;
  let edge = 60;                   // off-screen x, recomputed per frame
  let u = 0;                       // 0..1 progress across the screen
  let dir = 1, span = 0, y0 = 0, y1 = 0, phase = 0;
  let nextAt = rand(FIRST_MIN, FIRST_MAX);
  let clockT = 0;
  let eclipse = 0;                 // 0..1, how much light it is blocking
  let eclipseX = 0.5;              // where on screen, in uv

  // Geometry caustics are a single shared uniform, so the dip only has to be
  // written once per frame. Captured here so the pass restores exactly what it
  // found rather than assuming 1.0.
  const causticBase = waterUniforms.uCausticStrength.value;

  function begin() {
    active = true;
    u = 0;
    dir = Math.random() < 0.5 ? 1 : -1;
    span = edge * 2;
    // ⛔ UNDER the bubble row, never through it (and low enough that the DORSAL
    // FIN clears it too - the fin reaches ~5 units above the body, and a dark
    // fin showing through a bubble takes contrast away from the letter inside
    // it). The first version entered at
    // 0.28-0.52 of the half-height, which is exactly where the bubbles sit, and
    // a 39-unit body sweeping behind three letters is precisely the distraction
    // the timing gate exists to prevent - it just arrives spatially instead of
    // temporally. This band is the open mid-water between the bubbles and the
    // reef: the body gets a clean run and the letters keep their backdrop.
    y0 = rand(-bounds.y * 0.20, -bounds.y * 0.04);
    y1 = rand(-bounds.y * 0.42, -bounds.y * 0.24);
    phase = Math.random() * Math.PI * 2;
    holder.visible = true;
  }

  function end() {
    active = false;
    holder.visible = false;
    eclipse = 0;
    waterUniforms.uCausticStrength.value = causticBase;
    nextAt = clockT + rand(GAP_MIN, GAP_MAX);
  }

  /**
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
  function edgeX(camera) {
    const dist = camera.position.z - Z_ENTER;        // the FAR end: widest frustum
    const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * dist;
    return halfH * camera.aspect + bodyHalfLength + LEAD;
  }

  function update(t, dt, ctx) {
    clockT = t;
    if (ctx.bounds) bounds = ctx.bounds;
    edge = edgeX(ctx.camera);
    if (!active) {
      if (t >= nextAt && ctx.idle) begin();
      return;
    }

    u += dt / CROSS_SECONDS;
    if (u >= 1) { end(); return; }

    // Position. x sweeps the full span; z closes slightly; y eases from high to
    // low with a slow swell on top so it never travels on rails.
    const x = (-dir) * (span / 2) + dir * span * u;
    const ease = u * u * (3 - 2 * u);
    const y = y0 + (y1 - y0) * ease + Math.sin(t * 0.22 + phase) * 1.1;
    holder.position.set(x, y, Z_ENTER + (Z_EXIT - Z_ENTER) * u);
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
    /** Debug / preview: start one now, ignoring the schedule. */
    now() { if (!active) begin(); },
    dispose() {
      scene.remove(holder);
      waterUniforms.uCausticStrength.value = causticBase;
    },
  };
}
