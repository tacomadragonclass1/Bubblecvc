// -------------------------------------------------------------------- bubbles
// The slots a word gets built into. One bubble = one PHONEME, which is why the
// count is data-driven rather than hardcoded to three: in advanced mode a
// welded digraph die (`th`) merges two adjacent bubbles into one wider bubble,
// so `th-o-p` shows three bubbles even on a four-slot board. Everything here
// takes a layout array, never a magic 3.
//
// Rendering is a thin-film soap bubble: a fresnel rim, interference colour that
// shifts with view angle, and a travelling specular. No environment map, no
// refraction pass - it has to stay cheap enough for a weak TV SoC driving a
// very large panel.

import * as THREE from '../vendor/three.module.js';
import { DIE_SIZE } from './dice.js';

const bubbleVert = /* glsl */`
  varying vec3 vNormalW;
  varying vec3 vViewW;
  varying vec3 vPosL;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vPosL = normalize(position);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewW = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

// ⭐ THIN-FILM INTERFERENCE, done properly.
//
// The first version tinted the whole sphere with a cosine rainbow, which is why
// it read as a frosted disc rather than soap: the colour was everywhere and the
// centre was never transparent. A real soap bubble is almost invisible face-on
// and blazes at the silhouette, because you are seeing REFLECTED light, and
// reflectance off a near-index-matched film is tiny at normal incidence.
//
// So: compute Fresnel first, and let it gate BOTH the interference colour and
// the alpha. Everything else is detail on top of that one relationship.
const bubbleFrag = /* glsl */`
  precision highp float;
  varying vec3 vNormalW;
  varying vec3 vViewW;
  varying vec3 vPosL;
  varying vec2 vUv;

  uniform float uTime;
  uniform float uPop;       // 0 = whole, 1 = ruptured
  uniform float uTension;   // anticipation: tightens the rim just before burst
  uniform float uFill;      // 0 = empty, 1 = holding a letter
  uniform vec3  uTint;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1,0)), u.x),
               mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
  }

  // Interference colour for a film of thickness d (nanometres) seen at cosTheta.
  // Sampling three wavelengths is enough to get the real soap palette - the
  // magentas and golds that a plain hue ramp never produces.
  vec3 thinFilm(float d, float cosT) {
    float opd = 2.0 * 1.33 * d * cosT;              // optical path difference
    vec3 lambda = vec3(680.0, 545.0, 445.0);        // R, G, B
    vec3 phase = 6.28318 * opd / lambda;
    return 0.5 + 0.5 * cos(phase);
  }

  void main() {
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(vViewW);
    float cosT = clamp(abs(dot(N, V)), 0.0, 1.0);
    // Schlick with a NON-ZERO F0. This is the number that decides whether the
    // thing looks like soap. At 0 the bubble is a bare outline with a grey
    // middle; a real film still reflects ~6% face-on, and that 6% is exactly
    // what carries the colour across the body of the bubble.
    float fres = 0.065 + 0.935 * pow(1.0 - cosT, 3.0);

    // ---- film thickness ----------------------------------------------------
    // Real film DRAINS: it is thinnest at the top and pools toward the bottom,
    // and the pattern flows. Two noise octaves drifting at different rates give
    // the slow marbling; the vertical term gives the drain.
    float drain = (0.5 - vPosL.y * 0.5);
    float flow  = noise(vec2(vPosL.x * 2.1 + uTime * 0.07, vPosL.y * 2.4 - uTime * 0.11));
    float flow2 = noise(vec2(vPosL.z * 3.4 - uTime * 0.05, vPosL.y * 3.0 + uTime * 0.08));
    // Wide range on purpose: the thickness has to sweep through SEVERAL
    // interference orders across one bubble, or you get a single flat tint
    // instead of the marbled bands a soap film actually shows.
    float d = 180.0 + drain * 560.0 + flow * 330.0 + flow2 * 190.0;
    // Tension (anticipation before a pop) squeezes the film thinner, which
    // visibly shifts the bands toward the blue end - a real physical tell.
    d *= 1.0 - uTension * 0.42;

    vec3 film = thinFilm(d, cosT);

    // ---- reflectance -------------------------------------------------------
    // Interference is only visible in what the film REFLECTS, so everything is
    // multiplied by Fresnel. This is what keeps the middle clear enough to read
    // a letter through.
    // Saturate the film before it is scaled down by Fresnel - otherwise the
    // body of the bubble washes to grey and only the rim carries colour.
    film = mix(vec3(dot(film, vec3(0.33))), film, 1.35);
    vec3 col = film * fres * 2.9;

    // ---- faked environment -------------------------------------------------
    // No env map (too costly, and nothing to load). Instead, shade the
    // reflection by direction: bright aqua from above, deep blue from below.
    // Cheap, and it ties the bubble to the water it is floating in.
    vec3 R = reflect(-V, N);
    vec3 envUp   = vec3(0.70, 0.99, 1.0);
    vec3 envDown = vec3(0.05, 0.26, 0.46);
    vec3 env = mix(envDown, envUp, smoothstep(-0.7, 0.9, R.y));
    col += env * fres * 0.34;

    // ---- highlights --------------------------------------------------------
    // One big soft studio highlight (a window, essentially) plus a small sharp
    // one. Two highlights of different size is most of what makes a sphere read
    // as curved rather than as a circle.
    vec3 L1 = normalize(vec3(-0.45, 0.78, 0.55));
    float spec1 = pow(max(dot(N, normalize(L1 + V)), 0.0), 64.0);
    vec3 L2 = normalize(vec3(0.62, 0.35, 0.72));
    float spec2 = pow(max(dot(N, normalize(L2 + V)), 0.0), 380.0);
    // The large highlight drifts slowly across the surface as the bubble turns.
    float drift = 0.72 + 0.28 * sin(uTime * 0.37);
    col += vec3(1.0, 0.99, 0.96) * spec1 * 0.55 * drift;
    col += vec3(1.0) * spec2 * 0.9;

    // ---- rim ---------------------------------------------------------------
    // A fine luminous edge. Tightened during anticipation.
    float rim = pow(1.0 - cosT, 5.2 - uTension * 2.0);
    col += mix(vec3(0.80, 0.97, 1.0), film, 0.70) * rim * (1.25 + uTension * 1.9);

    // A filled bubble settles: very slightly warmer and calmer, never brighter
    // enough to compete with the letter it is holding.
    col += uTint * uFill * 0.05;

    // ---- alpha -------------------------------------------------------------
    // Transparent in the middle, opaque-ish at the silhouette, plus whatever the
    // highlights contribute. This single line is the difference between soap
    // film and a plastic ball.
    float alpha = fres * 0.72 + rim * 0.46 + spec1 * 0.45 + spec2 * 0.85 + 0.02;
    alpha *= 1.0 - uFill * 0.07;

    // ---- rupture -----------------------------------------------------------
    // The film does not fade uniformly; it tears. Holes open where the film was
    // already thinnest, which is what a bursting bubble actually does.
    if (uPop > 0.0) {
      // The film TEARS - it does not glow. An earlier version added a big white
      // flash across the whole sphere and the bursting bubble read as a ball of
      // frosted glass. The holes have to do the work: they open fast, from the
      // thinnest areas outward, so you see membrane coming apart.
      float tear = noise(vec2(vPosL.x * 3.6, vPosL.y * 3.6 + vPosL.z * 2.2));
      float tear2 = noise(vec2(vPosL.z * 5.1 + 3.0, vPosL.x * 4.4 - 2.0));
      float thin = tear * 0.65 + tear2 * 0.35 + drain * 0.22;
      // Holes open quickly and keep opening, so by uPop ~0.8 almost nothing of
      // the film is left to draw.
      float hole = smoothstep(uPop * 1.25 - 0.22, uPop * 1.25 + 0.04, thin);
      alpha *= hole;
      // A brief, narrow flash at the moment of rupture only - and it rides the
      // film's own interference colour rather than being white.
      float flash = pow(max(0.0, 1.0 - abs(uPop - 0.22) * 6.5), 2.0);
      col += mix(vec3(1.0, 0.98, 0.95), film, 0.45) * flash * 1.15;
      alpha += flash * 0.42 * hole;
      // The torn edges brighten, the way a retracting film does.
      float edge = exp(-pow((thin - uPop * 1.25) * 9.0, 2.0));
      col += mix(vec3(0.9, 0.98, 1.0), film, 0.6) * edge * 1.5;
      alpha += edge * 0.5;
    }

    if (alpha < 0.003) discard;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

export const BUBBLE_R_MAX = 3.6;

let unitSphere = null;

/**
 * @param layout array of { x, y, span } - span 1 is a normal bubble, span 2 is
 *               a merged bubble holding a two-letter welded die.
 */
export function createBubbles(scene, layout) {
  const group = new THREE.Group();
  scene.add(group);
  const bubbles = [];

  layout.forEach((slot, i) => {
    const mat = new THREE.ShaderMaterial({
      vertexShader: bubbleVert,
      fragmentShader: bubbleFrag,
      uniforms: {
        uTime: { value: 0 },
        uPop: { value: 0 },
        uTension: { value: 0 },
        uFill: { value: 0 },
        uTint: { value: new THREE.Color(0.55, 0.85, 1.0) },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
    });

    const r = slot.r || BUBBLE_R_MAX;
    // ⭐ UNIT sphere, scaled by r. The radius has to be a SCALE, not baked into
    // the geometry: on a window resize the layout recomputes a new radius, and
    // a baked geometry cannot follow it. That bug shipped a portrait layout
    // where the bubbles kept their landscape size and overlapped into a tangle.
    if (!unitSphere) unitSphere = new THREE.SphereGeometry(1, 64, 48);
    const mesh = new THREE.Mesh(unitSphere, mat);
    mesh.position.set(slot.x, slot.y, 0);
    mesh.renderOrder = 10;        // after the dice, so the film sits over them
    // A merged bubble is a stretched sphere, not a bigger one: the height must
    // match its neighbours or the row stops reading as a single word.
    const span = slot.span || 1;
    mesh.scale.set(r * (span === 1 ? 1 : 1.62), r, r);

    group.add(mesh);
    bubbles.push({
      index: i,
      mesh,
      mat,
      span,
      r,
      home: new THREE.Vector3(slot.x, slot.y, 0),
      phase: Math.random() * Math.PI * 2,
      // Each bubble gets its own drift rates so three of them never pulse in
      // lockstep, which is what makes a row of spheres read as a screensaver.
      rate: 0.58 + Math.random() * 0.34,
      swayRate: 0.41 + Math.random() * 0.28,
      breathRate: 0.33 + Math.random() * 0.22,
      die: null,        // the die locked inside
      popping: 0,       // >0 while the pop animation runs
      captureR: r * (span === 1 ? 1.22 : 1.7),
    });
  });

  return { group, bubbles };
}

/**
 * Idle life. Four independent slow oscillations per bubble - rise, sway, breathe
 * and a drifting highlight - at rates that are prime-ish to each other so the
 * motion never visibly loops. This is what separates "suspended in water" from
 * "balloon on a string".
 */
export function updateBubbles(bubbles, t, dt, reducedMotion = false, fx = null) {
  for (const b of bubbles) {
    b.mat.uniforms.uTime.value = t;

    if (b.popping > 0) { stepPop(b, dt, fx); continue; }

    const m = reducedMotion ? 0.25 : 1;
    const baseX = b.r * (b.span === 1 ? 1 : 1.62);
    const baseY = b.r;

    // Buoyancy: a slow rise-and-settle, plus a smaller faster ripple on top.
    const bob = (Math.sin(t * b.rate + b.phase) * 0.30
               + Math.sin(t * b.rate * 2.37 + b.phase * 1.9) * 0.09) * m;
    const sway = (Math.cos(t * b.swayRate + b.phase * 1.3) * 0.22
                + Math.sin(t * b.swayRate * 1.71 + b.phase) * 0.07) * m;

    // Surface tension breathing - a real bubble is never perfectly spherical.
    // Volume-preserving-ish: it widens as it flattens, which reads as a
    // membrane under tension rather than a pulsing ball.
    const breathe = Math.sin(t * b.breathRate + b.phase * 2.1) * 0.022 * m;
    b.mesh.scale.set(baseX * (1 + breathe), baseY * (1 - breathe), baseY * (1 + breathe * 0.4));

    b.mesh.position.set(b.home.x + sway, b.home.y + bob, 0);
    // Slow orientation drift makes the iridescence shift as it turns, which is
    // most of what sells a soap film.
    b.mesh.rotation.y = Math.sin(t * 0.21 + b.phase) * 0.5 * m;
    b.mesh.rotation.z = Math.cos(t * 0.17 + b.phase * 1.4) * 0.22 * m;

    if (b.die) {
      // ⭐ The bubble acts as a LENS: the die inside reads magnified, as it
      // would through a curved film. Pure presentation - the capture radius and
      // the tap target are unchanged, so gameplay is untouched.
      b.die.position.set(b.mesh.position.x, b.mesh.position.y, 0.1);
      // Settle: a quick, slightly over-damped pop to full size as it locks.
      if (b.settle !== undefined && b.settle < 1) {
        b.settle = Math.min(1, b.settle + dt * 4.4);
        const k = b.settle;
        const over = 1 + Math.sin(k * Math.PI) * 0.09;   // tiny overshoot
        b.die.scale.setScalar(b.lensScale * (0.55 + 0.45 * k) * over);
      } else {
        b.die.scale.setScalar(b.lensScale);
      }
    }
  }
}

// --------------------------------------------------------------- pop timing
// Tuned by watching it, not by theory. The rupture has to be FAST or it reads
// as a balloon deflating; the droplets have to linger or there is no payoff.
const T_ANTICIPATE = 0.11;   // surface-tension wobble + inward squeeze
const T_RUPTURE    = 0.17;   // elastic expansion into the tear
const T_EMPTY      = 0.14;   // film gone, only the ring and droplets remain
const T_REFORM     = 0.34;   // the new, empty bubble eases back in
const T_TOTAL      = T_ANTICIPATE + T_RUPTURE + T_EMPTY + T_REFORM;  // ~0.76s
const T_REFORM_AT  = T_ANTICIPATE + T_RUPTURE + T_EMPTY;

/**
 * ⭐ Can this bubble receive a die right now?
 *
 * A popping bubble used to refuse everything for the whole 0.76s sequence, so a
 * teacher who popped and immediately re-threw watched the die sail through and
 * drop back for no visible reason. Once the bubble has started REFORMING it is
 * already on screen and already at its home position, so it can accept - and
 * since a throw takes about 0.6s to arrive anyway, the die lands into a bubble
 * that is whole by the time it gets there.
 */
export function canAccept(b) {
  if (b.die) return false;
  if (b.popping <= 0) return true;
  return b.popT >= T_REFORM_AT;
}

/**
 * Advance one bubble's pop. Four phases, all driven off a single clock so the
 * sequence cannot desynchronise.
 *
 * ⛔ The slot is released by popBubble() at the START, not here. The letter is
 * available again immediately, so a teacher mid-chain never waits on an
 * animation - the burst is decoration over an already-completed state change.
 */
function stepPop(b, dt, fx) {
  b.popT += dt;
  const t = b.popT;
  const baseX = b.r * (b.span === 1 ? 1 : 1.62);
  const baseY = b.r;
  const u = b.mat.uniforms;

  if (t < T_ANTICIPATE) {
    // Anticipation: a quick inward squeeze and a visible tightening of the rim.
    const k = t / T_ANTICIPATE;
    const squeeze = 1 - Math.sin(k * Math.PI) * 0.065;
    const wobble = Math.sin(k * Math.PI * 3.0) * 0.022;
    b.mesh.scale.set(baseX * (squeeze + wobble), baseY * (squeeze - wobble), baseY * squeeze);
    u.uTension.value = k;
    u.uPop.value = 0;
    return false;
  }

  if (t < T_ANTICIPATE + T_RUPTURE) {
    // Burst: elastic expansion while the film tears open.
    const k = (t - T_ANTICIPATE) / T_RUPTURE;
    const grow = 1 + Math.pow(k, 0.55) * 0.30;
    b.mesh.scale.set(baseX * grow, baseY * grow, baseY * grow);
    u.uTension.value = 1 - k;
    u.uPop.value = k;
    if (!b.burstFired) {
      b.burstFired = true;
      // Ring and droplets launch at the moment of rupture, from the film's
      // position at that instant - not from where the bubble started.
      if (fx) fx.burst(b.mesh.position.x, b.mesh.position.y, b.r * 1.08);
    }
    return false;
  }

  if (t < T_ANTICIPATE + T_RUPTURE + T_EMPTY) {
    b.mesh.visible = false;
    u.uPop.value = 1;
    u.uFill.value = 0;
    return false;
  }

  // Reform: eases back in at the EXACT home position, empty and ready. Slight
  // overshoot so it arrives with a little surface tension rather than a fade-in.
  const k = Math.min(1, (t - T_ANTICIPATE - T_RUPTURE - T_EMPTY) / T_REFORM);
  b.mesh.visible = true;
  u.uPop.value = 0;
  u.uTension.value = 0;
  const e = 1 - Math.pow(1 - k, 3);
  const over = 1 + Math.sin(k * Math.PI) * 0.11;
  const sc = e * over;
  b.mesh.scale.set(baseX * sc, baseY * sc, baseY * sc);
  b.mesh.position.copy(b.home);

  if (t >= T_TOTAL) {
    b.popping = 0;
    b.popT = 0;
    b.burstFired = false;
    b.mesh.scale.set(baseX, baseY, baseY);
    return true;
  }
  return false;
}

/**
 * Apply a freshly computed layout to existing bubbles - new positions AND new
 * radius - without destroying them. Called on every resize so a rotated tablet
 * re-lays the board instead of keeping the landscape geometry.
 */
export function disposeBubbles(set) {
  // Each bubble owns its ShaderMaterial (its uniforms carry per-bubble state).
  // The unit sphere is shared and deliberately kept.
  for (const b of set.bubbles) b.mat.dispose();
  set.group.clear();
}

export function resizeBubbles(bubbles, layout) {
  bubbles.forEach((b, i) => {
    const slot = layout[i];
    if (!slot) return;
    b.r = slot.r;
    b.home.set(slot.x, slot.y, 0);
    b.captureR = b.r * (b.span === 1 ? 1.22 : 1.7);
    b.mesh.position.copy(b.home);
    b.mesh.scale.set(b.r * (b.span === 1 ? 1 : 1.62), b.r, b.r);
    // A held die has to be re-fitted to the new bubble size too.
    if (b.die) {
      const want = b.r * 0.86;
      b.lensScale = Math.min(2.2, Math.max(0.42, want / (DIE_SIZE * 0.75)));
      b.settle = 1;
    }
  });
}

export function fillBubble(b, die) {
  b.die = die;
  b.mat.uniforms.uFill.value = 1;
  die.userData.state = 'captured';
  die.userData.slot = b.index;
  die.userData.wobbleScale = 0;    // stop wobbling: locked letters are still

  // Lens magnification, sized so the die fills a comfortable share of the
  // bubble whatever radius the viewport ended up with. Capped so a huge bubble
  // on a wide panel does not blow the letter up past the film.
  // Target die half-extent inside the film. The floor is well BELOW 1: on a
  // narrow portrait viewport the bubbles are small, and a lens that refused to
  // go under 1.0 left the die sticking out through the membrane.
  const want = b.r * 0.86;
  b.lensScale = Math.min(2.2, Math.max(0.42, want / (DIE_SIZE * 0.75)));
  b.settle = 0.001;                              // drives the settle pop-in
}

/** Start the pop. Returns the die that was inside, so the caller can send it home. */
export function popBubble(b) {
  const die = b.die;
  b.die = null;
  b.settle = undefined;
  // Undo the lens magnification before the die flies home, or it would return
  // to the bay at twice the size of its neighbours.
  if (die) die.scale.setScalar(1);
  b.popping = 1;
  b.popT = 0;
  b.burstFired = false;
  return die;
}

/** Which bubble, if any, is close enough to swallow a die at `p`. */
export function bubbleAt(bubbles, p, slotFilter = null) {
  for (const b of bubbles) {
    if (!canAccept(b)) continue;
    if (slotFilter !== null && b.index !== slotFilter) continue;
    const dx = p.x - b.mesh.position.x;
    const dy = p.y - b.mesh.position.y;
    // Merged bubbles are wider, so the test is elliptical.
    const rx = b.captureR * (b.span === 1 ? 1 : 1.62);
    if ((dx * dx) / (rx * rx) + (dy * dy) / (b.captureR * b.captureR) <= 1) return b;
  }
  return null;
}

/** Hit test for a tap - used for popping. Tighter than the capture zone. */
export function bubbleHit(bubbles, p) {
  for (const b of bubbles) {
    if (b.popping > 0) continue;
    const dx = p.x - b.mesh.position.x;
    const dy = p.y - b.mesh.position.y;
    // Tap target is the bubble's own radius with a small forgiveness margin.
    // Bigger bubbles therefore get bigger tap targets for free.
    const rx = b.r * (b.span === 1 ? 1 : 1.62);
    if ((dx * dx) / (rx * rx) + (dy * dy) / (b.r * b.r) <= 1.12) return b;
  }
  return null;
}

/**
 * Bubble positions AND radius.
 *
 * ⭐ The radius is computed, never fixed. Bubbles are meant to be the focal
 * point of the scene, so they take as much room as the slot pitch allows - but
 * a portrait tablet has a third of the width of a classroom panel, and a fixed
 * radius there would overlap the bubbles into one blob. So: derive the pitch
 * from the usable width, then take a fraction of it as the radius, capped.
 *
 * ⭐ Positions still track the BAY COLUMNS rather than sitting in a tight clump.
 * That is play-feel, not decoration: with a central clump an onset die had to
 * cross ~10 world units sideways and a reasonable throw fell 5 units short every
 * time. `SPREAD` is how much of the half-width the bubble row occupies.
 */
// Portrait is a different composition problem from a classroom panel: width is
// scarce, height is plentiful. So a narrow viewport spends more of its width on
// the row and accepts a tighter gap between bubbles.
const SPREAD_WIDE = 0.78, SPREAD_NARROW = 0.88;
const R_WIDE = 0.40, R_NARROW = 0.44;

export function layoutFor(slots, bounds, y) {
  const portrait = bounds.x < bounds.y * 1.2;
  const spread = portrait ? SPREAD_NARROW : SPREAD_WIDE;
  const R_OF_PITCH = portrait ? R_NARROW : R_WIDE;
  const usable = bounds.x * 2 * spread;
  const pitch = usable / slots;
  // Also keep the bubble from growing taller than the space between the bay and
  // the top of frame, which is what actually bites in a short landscape window.
  const vertical = (bounds.y - y) * 0.92;
  const r = Math.min(BUBBLE_R_MAX, pitch * R_OF_PITCH, vertical);
  const w = (slots - 1) * pitch;
  return Array.from({ length: slots }, (_, i) => ({
    x: -w / 2 + i * pitch,
    y,
    span: 1,
    r,
  }));
}
