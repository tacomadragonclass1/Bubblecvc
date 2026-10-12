// ------------------------------------------------------------------- pop FX
// The burst that happens when a bubble is tapped. This is the single most
// repeated moment of delight in the app - a teacher will trigger it dozens of
// times in a five minute drill - so it has two jobs that pull against each
// other: be spectacular, and never become tiring.
//
// What that means in practice:
//   * It is SHORT. Rupture is ~160ms; the whole visual payoff lands inside
//     ~0.75s. A long effect is the thing that becomes exhausting.
//   * It is QUIET in colour. Droplets and ring carry the bubble's own
//     iridescence rather than introducing new hues, so a pop never looks like
//     confetti going off in the middle of a reading lesson.
//   * It is a SOAP BUBBLE UNDERWATER, not an explosion. Everything expands
//     outward and then drifts UP, because that is what water does to droplets.
//
// Pools are per-scene and fixed size: with three bubbles there can never be
// more than three bursts in flight, so nothing is allocated during a lesson.

import * as THREE from '../vendor/three.module.js';

const POOL = 4;
const DROPS = 54;

// ---------------------------------------------------------------- shockwave
// A thin expanding annulus of film. Drawn as a single quad with the ring built
// in the fragment shader - cheaper and far smoother than a torus, and it lets
// the rim keep the same interference palette as the bubble it came from.
const ringFrag = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform float uT;        // 0..1 life
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float d = length(p);

    // The ring expands and thins as it goes.
    float radius = 0.26 + uT * 0.72;
    float width  = 0.17 * (1.0 - uT * 0.72);
    float ring = exp(-pow((d - radius) / width, 2.0) * 2.4);

    // Interference across the ring's own width, so it reads as film rather
    // than as a glowing hoop.
    float band = (d - radius) / width;
    vec3 col = 0.5 + 0.5 * cos(6.28318 * (vec3(0.0, 0.33, 0.67) + band * 0.42 + uT * 0.5));
    col = mix(vec3(1.0), col, 0.78);

    float fade = (1.0 - uT) * (1.0 - uT);
    float a = ring * fade * 0.85;
    if (a < 0.004) discard;
    gl_FragColor = vec4(col * (0.7 + ring * 0.6), a);
  }
`;

const ringVert = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// ----------------------------------------------------------------- droplets
// Round, soft, slightly iridescent specks - droplets, not sparks. The sprite is
// drawn in the shader so there is no texture to ship.
const dropVert = /* glsl */`
  attribute float aSeed;
  attribute vec3 aVel;
  uniform float uT;
  uniform float uSize;
  varying float vSeed;
  varying float vFade;
  void main() {
    // Outward burst that decays fast, then a slow buoyant rise. That hand-off
    // from "thrown" to "floating" is what makes it read as underwater.
    float decay = 1.0 - exp(-uT * 5.0);
    vec3 p = position + aVel * decay * 0.95;
    p.y += uT * uT * 1.9 + uT * 0.5;          // buoyancy, accelerating
    p.x += sin(uT * 3.0 + aSeed * 6.28) * 0.10 * uT;

    vSeed = aSeed;
    vFade = clamp(1.0 - uT * 0.92, 0.0, 1.0);

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    // Droplets shrink slightly as they rise and thin out.
    gl_PointSize = uSize * (0.45 + aSeed * 0.9) * (1.0 - uT * 0.35) * (300.0 / -mv.z);
  }
`;

const dropFrag = /* glsl */`
  precision highp float;
  varying float vSeed;
  varying float vFade;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;

    // A droplet is a tiny lens: bright rim, clear centre, one specular dot.
    float rim = smoothstep(0.5, 0.28, d) * smoothstep(0.17, 0.42, d);
    float body = smoothstep(0.5, 0.0, d) * 0.30;
    float spec = exp(-pow(length(c - vec2(-0.13, 0.15)) * 7.0, 2.0));

    vec3 tint = 0.5 + 0.5 * cos(6.28318 * (vec3(0.0, 0.33, 0.67) + vSeed));
    vec3 col = mix(vec3(0.72, 0.94, 1.0), tint, 0.45);

    float a = (rim * 0.95 + body + spec * 0.9) * vFade;
    if (a < 0.004) discard;
    gl_FragColor = vec4(col + spec * 0.6, a);
  }
`;

function makeRing() {
  const mat = new THREE.ShaderMaterial({
    vertexShader: ringVert,
    fragmentShader: ringFrag,
    uniforms: { uT: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.visible = false;
  mesh.renderOrder = 20;
  return mesh;
}

function makeDrops() {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(DROPS * 3);
  const vel = new Float32Array(DROPS * 3);
  const seed = new Float32Array(DROPS);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aVel', new THREE.BufferAttribute(vel, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));

  const mat = new THREE.ShaderMaterial({
    vertexShader: dropVert,
    fragmentShader: dropFrag,
    uniforms: { uT: { value: 0 }, uSize: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.visible = false;
  pts.frustumCulled = false;
  pts.renderOrder = 21;
  return pts;
}

export function createPopFX(scene) {
  const slots = [];
  for (let i = 0; i < POOL; i++) {
    const ring = makeRing();
    const drops = makeDrops();
    scene.add(ring);
    scene.add(drops);
    slots.push({ ring, drops, t: -1, dur: 1, r: 1 });
  }

  /** Fire a burst at a world position, sized to the bubble that popped. */
  function burst(x, y, r) {
    const s = slots.find(s => s.t < 0) || slots[0];
    s.t = 0;
    s.dur = 1.15;
    s.r = r;

    s.ring.visible = true;
    s.ring.position.set(x, y, 0.2);
    // The quad has to be big enough to hold the fully expanded ring.
    s.ring.scale.setScalar(r * 4.4);
    s.ring.material.uniforms.uT.value = 0;

    const g = s.drops.geometry;
    const pos = g.attributes.position.array;
    const vel = g.attributes.aVel.array;
    const seed = g.attributes.aSeed.array;
    for (let i = 0; i < DROPS; i++) {
      // Seed ON the former film surface, not at the centre - the droplets are
      // what the membrane became, so they start where the membrane was.
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      const sx = Math.sin(ph) * Math.cos(th), sy = Math.cos(ph), sz = Math.sin(ph) * Math.sin(th);
      pos[i * 3] = x + sx * r * 0.92;
      pos[i * 3 + 1] = y + sy * r * 0.92;
      pos[i * 3 + 2] = sz * r * 0.35;
      const speed = r * (0.5 + Math.random() * 0.95);
      vel[i * 3] = sx * speed;
      vel[i * 3 + 1] = sy * speed * 0.8;
      vel[i * 3 + 2] = sz * speed * 0.3;
      seed[i] = Math.random();
    }
    g.attributes.position.needsUpdate = true;
    g.attributes.aVel.needsUpdate = true;
    g.attributes.aSeed.needsUpdate = true;

    s.drops.visible = true;
    s.drops.material.uniforms.uT.value = 0;
    s.drops.material.uniforms.uSize.value = r * 0.55;
  }

  function update(dt) {
    for (const s of slots) {
      if (s.t < 0) continue;
      s.t += dt;
      const k = s.t / s.dur;
      if (k >= 1) {
        s.t = -1;
        s.ring.visible = false;
        s.drops.visible = false;
        continue;
      }
      // The ring is a fast event; it is done well before the droplets are.
      const ringK = Math.min(1, s.t / 0.42);
      s.ring.visible = ringK < 1;
      s.ring.material.uniforms.uT.value = ringK;
      s.drops.material.uniforms.uT.value = k;
    }
  }

  function dispose() {
    for (const s of slots) {
      scene.remove(s.ring); scene.remove(s.drops);
      s.ring.geometry.dispose(); s.ring.material.dispose();
      s.drops.geometry.dispose(); s.drops.material.dispose();
    }
    slots.length = 0;
  }

  return { burst, update, dispose };
}
