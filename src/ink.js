// --------------------------------------------------------------------- ink
// A puff of octopus ink. Fired when an `i` lands in a bubble, purely as an
// easter egg - i for ink, and the octopus is the one who owns the joke.
//
// ⛔⛔ THE INK IS TIED TO THE OCTOPUS. It disperses FROM him, on whatever plane
// he happens to be on. The letter is only the TRIGGER. An early version puffed
// the cloud around the letter itself and it read as the `i` leaking - the joke
// only works if the ink has an animal attached to it. The origin is always
// `octopus.inkOrigin()`: far out on the reef it is a small puff in the
// distance, up near the bubbles it is a proper cloud, and perspective sizes it
// either way with no special casing. ⛔ Do not relocate the puff to make it
// more visible. If it needs to read better at depth, change its SIZE.
//
// ⛔ IT IS DELIBERATELY SHORT. The temptation with ink is to make it a dramatic
// billowing cloud, and the DURATION side of that is still wrong here: this
// fires in the middle of a phonics drill, over the top of the letter a child is
// reading, and anything that outlasts the moment stops being a treat and
// becomes an obstacle. The whole thing is over in well under two seconds.
//
// ⛔⛔ BUT IT IS NO LONGER SMALL, AND THAT WAS A CORRECTION FROM USE.
// The original was sized to stay near the die and never reach a neighbouring
// bubble. In the classroom it did not READ - reported as "it doesn't always
// read" - and it was taken up 50%. The reason the first judgement was wrong is
// a scale the file could not see: the puff plays at whatever distance the
// octopus happens to be, and most of the time he is out on the reef, where
// perspective had already shrunk a cloud that was only just big enough at the
// bubble. ⛔ Do not shrink it back on the grounds of the paragraph above - the
// constraint that mattered turned out to be TIME, not size.
//
// Built as ONE pooled Points cloud, like src/pop.js - no allocation during a
// lesson, one draw call, and it can simply be left in the scene when idle.

import * as THREE from '../vendor/three.module.js';

const PUFFS = 3;        // at most this many clouds in flight at once
const GRAINS = 34;      // particles per cloud - enough to read as a cloud

// ⭐ Taken up 50% after classroom use. Applied as ONE factor on the incoming
// radius rather than to each of the four places a size is derived, so cluster
// width, spread velocity and grain size all grow together - a cloud 1.5x wider
// made of grains 1.5x wider covers the same FRACTION of itself, so it gets
// bigger without getting sparse.
const SCALE = 1.5;

const inkVert = /* glsl */`
  attribute float aSeed;
  attribute vec3 aVel;
  uniform float uT;
  uniform float uSize;
  varying float vSeed;
  varying float vFade;
  void main() {
    // Ink does not fly, it BLOOMS: a quick push outward that decays almost at
    // once, then it just hangs and spreads. That hand-off is the whole look.
    float decay = 1.0 - exp(-uT * 4.2);
    vec3 p = position + aVel * decay;
    // Barely any rise. Ink is denser than the droplets in pop.js and this one
    // must not drift up over the letter it was fired next to.
    p.y += uT * 0.28;
    p.x += sin(uT * 2.1 + aSeed * 6.28) * 0.22 * uT;

    vSeed = aSeed;
    // Fades from the edges in, so it thins out rather than vanishing.
    vFade = clamp(1.0 - uT * 1.15, 0.0, 1.0);

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    // Each grain SWELLS as it fades - a diffusing cloud gets bigger and
    // fainter at the same time, which is what makes it read as dispersing into
    // water rather than as dots being turned off.
    gl_PointSize = uSize * (0.5 + aSeed * 0.8) * (1.0 + uT * 1.9) * (300.0 / -mv.z);
  }
`;

const inkFrag = /* glsl */`
  precision highp float;
  varying float vSeed;
  varying float vFade;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    // Soft-edged blob, densest in the middle. No rim, no specular - this is the
    // one thing in the scene that is supposed to be murk.
    float body = smoothstep(0.5, 0.05, d);
    // ⛔ Ink is not black, and here it cannot even be very dark. Real cephalopod
    // ink is a deep warm sepia - but this fires INSIDE a bubble, against water
    // that is already nearly black, and the first version was so close in value
    // to its background that the puff was invisible. Lifted into a warm
    // red-brown that still reads as ink and actually separates from the water.
    vec3 col = mix(vec3(0.20, 0.11, 0.13), vec3(0.34, 0.19, 0.20), vSeed);
    // ⛔ Kept well under 1. It has to read when he is far out on the reef AND
    // not swamp him when he is up under the bubble doing the O routine - the
    // same puff plays at both distances. Opaque enough to be a cloud, sheer
    // enough that his mantle and eyes stay visible through it.
    float a = body * vFade * 0.66;
    if (a < 0.004) discard;
    gl_FragColor = vec4(col, a);
  }
`;

export function createInk(scene) {
  const slots = [];
  for (let i = 0; i < PUFFS; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(GRAINS * 3), 3));
    geo.setAttribute('aVel', new THREE.BufferAttribute(new Float32Array(GRAINS * 3), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(GRAINS), 1));
    const mat = new THREE.ShaderMaterial({
      vertexShader: inkVert,
      fragmentShader: inkFrag,
      uniforms: { uT: { value: 0 }, uSize: { value: 1 } },
      transparent: true,
      depthWrite: false,
      // ⛔ NORMAL blending, never additive. Additive ink glows, and glowing ink
      // is a contradiction - it has to DARKEN the water behind it.
      blending: THREE.NormalBlending,
    });
    const pts = new THREE.Points(geo, mat);
    pts.visible = false;
    pts.frustumCulled = false;
    // Over the bubbles but under nothing else that matters.
    pts.renderOrder = 22;
    scene.add(pts);
    slots.push({ pts, t: -1, dur: 1.25 });
  }

  /** Puff of ink at a world position. `r` scales it to the thing it came from. */
  function puff(x, y, r = 1, z = 0) {
    r *= SCALE;
    const s = slots.find(s => s.t < 0) || slots[0];
    s.t = 0;
    s.pts.visible = true;

    const g = s.pts.geometry;
    const pos = g.attributes.position.array;
    const vel = g.attributes.aVel.array;
    const seed = g.attributes.aSeed.array;
    for (let i = 0; i < GRAINS; i++) {
      // Start clustered, not at a single point - ink leaves a siphon as a
      // stream, so the cloud has width from the very first frame.
      const th = Math.random() * Math.PI * 2;
      const rr = Math.random() * 0.28 * r;
      pos[i * 3] = x + Math.cos(th) * rr;
      pos[i * 3 + 1] = y + Math.sin(th) * rr * 0.8;
      pos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.3 * r;
      // Outward, biased sideways and slightly DOWN: ink sinks a little before
      // the current takes it.
      const a = Math.random() * Math.PI * 2;
      const sp = r * (0.25 + Math.random() * 0.5);
      vel[i * 3] = Math.cos(a) * sp;
      vel[i * 3 + 1] = Math.sin(a) * sp * 0.6 - sp * 0.12;
      vel[i * 3 + 2] = (Math.random() - 0.5) * sp * 0.4;
      seed[i] = Math.random();
    }
    g.attributes.position.needsUpdate = true;
    g.attributes.aVel.needsUpdate = true;
    g.attributes.aSeed.needsUpdate = true;
    s.pts.material.uniforms.uT.value = 0;
    s.pts.material.uniforms.uSize.value = r * 2.3;
  }

  function update(dt) {
    for (const s of slots) {
      if (s.t < 0) continue;
      s.t += dt;
      if (s.t >= s.dur) { s.t = -1; s.pts.visible = false; continue; }
      s.pts.material.uniforms.uT.value = s.t / s.dur;
    }
  }

  function dispose() {
    for (const s of slots) {
      scene.remove(s.pts);
      s.pts.geometry.dispose();
      s.pts.material.dispose();
    }
    slots.length = 0;
  }

  return { puff, update, dispose };
}
