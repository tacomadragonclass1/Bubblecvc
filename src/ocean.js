// ---------------------------------------------------------------------- ocean
// Scenery, and scenery only. Nothing in here is ever hit-tested, nothing here
// can be interacted with, and nothing here may ever steal a pointer event from
// a die or a bubble. If a shark swims behind the letter bay it must remain
// completely inert - a child reaching for a `t` must never pop a fish instead.
//
// Everything is procedural: no textures, no models, no image assets. That keeps
// the repo small and the thing starts instantly on a classroom TV with a tired
// network. The cost is that creatures are stylised rather than photoreal, which
// suits a kindergarten room anyway.

import * as THREE from '../vendor/three.module.js';
import { halfWidthAt } from './frustum.js';

// Depth planes. Creatures are spread across these so the water reads as having
// volume. All are well BEHIND the play plane (z = 0) so nothing ever occludes a
// letter the child is trying to read.
// ⭐ Lane depth is a SIZE decision as much as a composition one. A creature at
// z = -64 is 90 units from the camera against the play plane's 26, so it renders
// at ~29% size - which is why modelled fish that measured correctly in world
// units still showed up as specks. These are pulled closer so the sea life
// actually reads, while staying well behind the play plane at z = 0.
const LANES = [-18, -24, -31, -39, -50];

// ----------------------------------------------------------------- the water
// A full-screen quad behind everything, running a gradient plus moving light
// shafts. Drawn first with depthWrite off so it never fights the creatures.
const waterVert = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const waterFrag = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform vec2  uAspect;
  // How much light the hero shark is blocking (0-1) and where it is across the
  // screen (uv.x). A travelling shadow, not a global dim: the whole frame going
  // dark reads as a bug, while light falling off UNDER the body and coming back
  // is what tells you something enormous just went over.
  uniform float uEclipse;
  uniform float uEclipseX;

  // Cheap value noise - enough for drifting caustics, far cheaper than simplex.
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1,0)), u.x),
               mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
  }

  void main() {
    vec2 uv = vUv;

    // ---- depth ramp --------------------------------------------------------
    // Four stops, not two. A single gradient reads as wallpaper; a ramp with a
    // bright shallow band, a saturated mid, and a near-black floor gives the
    // scene somewhere to BE deep, which is what sells volume.
    vec3 surface = vec3(0.38, 0.88, 0.92);   // pale aquamarine, sunlit
    vec3 shallow = vec3(0.10, 0.60, 0.74);   // brilliant turquoise
    vec3 mid     = vec3(0.03, 0.26, 0.50);   // deep sapphire
    vec3 abyss   = vec3(0.005, 0.045, 0.14); // near-black blue floor

    vec3 col = mix(abyss, mid, smoothstep(0.0, 0.42, uv.y));
    col = mix(col, shallow, smoothstep(0.34, 0.80, uv.y));
    col = mix(col, surface, smoothstep(0.80, 1.0, uv.y) * 0.55);

    // ---- god rays ----------------------------------------------------------
    // Leaning shafts of different widths. The narrow ones are brighter and move
    // slightly faster, which reads as light through a moving surface.
    float rays = 0.0;
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      float w  = 2.0 + fi * 0.85;
      float x = uv.x * w + uv.y * (0.62 + fi * 0.07) + uTime * (0.016 + fi * 0.005);
      float shaft = pow(max(sin(x * 3.14159) * 0.5 + 0.5, 0.0), 9.0 - fi);
      rays += shaft * (0.55 - fi * 0.10);
    }
    rays *= smoothstep(-0.05, 0.9, uv.y);
    // Wide and soft - the shadow of a body 39 units long, seen through water,
    // has no edge at all.
    float ecl = uEclipse * exp(-pow((uv.x - uEclipseX) / 0.42, 2.0));
    rays *= 1.0 - ecl * 0.78;
    // Warm the rays very slightly - sunlight through water is not pure cyan,
    // and this is what stops the whole frame reading as one flat hue.
    col += vec3(0.80, 0.94, 0.88) * rays * 0.17;

    // ---- caustics ----------------------------------------------------------
    // Two layers drifting against each other at different scales, ridged so the
    // bright lines are thin. This is the single biggest "underwater" cue.
    // ⛔ max() before pow() is NOT optional. GLSL pow() with a negative base is
    // undefined, and this expression goes negative wherever the two noise layers
    // diverge - which rendered as large black blobs torn across the water.
    vec2 cp = uv * uAspect * 4.2;
    float c1 = noise(cp * 1.0 + vec2(uTime * 0.075, uTime * 0.05));
    float c2 = noise(cp * 1.9 - vec2(uTime * 0.055, uTime * 0.085));
    float ridge = max(0.0, 1.0 - abs(c1 - c2) * 2.6);
    float caustic = pow(ridge, 6.0);
    caustic *= smoothstep(0.02, 0.75, uv.y);
    caustic *= 1.0 - ecl * 0.55;
    col += vec3(0.50, 0.90, 0.98) * caustic * 0.17;

    // A much larger, softer wash for low-frequency variation, so the water is
    // never uniformly lit across a big panel. Kept near 1.0 - this is a gentle
    // modulation, not a second light.
    float wash = noise(uv * uAspect * 1.15 + vec2(uTime * 0.02, uTime * 0.014));
    col *= 0.94 + wash * 0.13;

    // ---- distance haze -----------------------------------------------------
    // Atmospheric perspective: the far water lifts toward the mid blue, which
    // is what makes the foreground creatures read as nearer.
    col = mix(col, mid * 1.15, 0.12);

    // A touch of the water itself darkening under the shark, so the dip is not
    // only in the highlights. Small: 8% is the difference between "a cloud went
    // over" and "the renderer glitched".
    col *= 1.0 - ecl * 0.08;

    // ---- vignette ----------------------------------------------------------
    // Elliptical and gentle, pulling attention to the bubble row.
    vec2 vp = (uv - vec2(0.5, 0.56)) * vec2(1.0, 1.25);
    float v = length(vp);
    col *= 1.0 - smoothstep(0.34, 0.92, v) * 0.52;

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function makeWater() {
  const mat = new THREE.ShaderMaterial({
    vertexShader: waterVert,
    fragmentShader: waterFrag,
    uniforms: {
      uTime: { value: 0 },
      uAspect: { value: new THREE.Vector2(1, 1) },
      uEclipse: { value: 0 },
      uEclipseX: { value: 0.5 },
    },
    depthWrite: false,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  // Drawn in clip space by a dedicated ortho camera, so it always fills the
  // screen regardless of the play camera's framing.
  return mesh;
}

// ------------------------------------------------------------------ creatures
// Built from primitives and animated on the CPU. Counts are low on purpose:
// a classroom TV is often a weak SoC behind a very large panel.

function fishMaterial(hue, sat = 0.55, light = 0.5, opacity = 1) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(hue, sat, light),
    roughness: 0.55,
    metalness: 0.05,
    transparent: opacity < 1,
    opacity,
  });
}

function makeFish(scale = 1, hue = 0.09) {
  const g = new THREE.Group();

  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), fishMaterial(hue, 0.65, 0.55));
  body.scale.set(1.5, 0.85, 0.6);
  g.add(body);

  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.62, 1.0, 10), fishMaterial(hue, 0.6, 0.48));
  tail.rotation.z = Math.PI / 2;
  tail.position.x = -1.85;
  tail.scale.set(1, 1, 0.35);
  g.add(tail);

  const dorsal = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.75, 8), fishMaterial(hue, 0.6, 0.6));
  dorsal.position.set(0.1, 0.78, 0);
  dorsal.scale.set(1, 1, 0.25);
  g.add(dorsal);

  const eye = new THREE.Mesh(
    new THREE.SphereGeometry(0.15, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0x0a0a12, roughness: 0.3 })
  );
  eye.position.set(1.05, 0.22, 0.34);
  g.add(eye);

  g.scale.setScalar(scale);
  g.userData.tail = tail;
  g.userData.kind = 'fish';
  return g;
}

function makeShark(scale = 1) {
  const g = new THREE.Group();
  const grey = () => new THREE.MeshStandardMaterial({ color: 0x6b7f92, roughness: 0.7, metalness: 0.02 });

  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), grey());
  body.scale.set(3.0, 0.85, 0.75);
  g.add(body);

  const snout = new THREE.Mesh(new THREE.ConeGeometry(0.8, 1.5, 12), grey());
  snout.rotation.z = -Math.PI / 2;
  snout.position.x = 3.3;
  snout.scale.set(1, 1, 0.9);
  g.add(snout);

  const tail = new THREE.Mesh(new THREE.ConeGeometry(1.1, 1.8, 8), grey());
  tail.rotation.z = Math.PI / 2;
  tail.position.x = -3.6;
  tail.scale.set(1, 1, 0.3);
  g.add(tail);

  const dorsal = new THREE.Mesh(new THREE.ConeGeometry(0.75, 1.5, 8), grey());
  dorsal.position.set(0.2, 1.1, 0);
  dorsal.scale.set(1, 1, 0.22);
  g.add(dorsal);

  for (const s of [1, -1]) {
    const fin = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.3, 8), grey());
    fin.position.set(1.0, -0.5, s * 0.55);
    fin.rotation.set(0, 0, Math.PI * 0.75);
    fin.scale.set(1, 1, 0.25);
    g.add(fin);
  }

  g.scale.setScalar(scale);
  g.userData.tail = tail;
  g.userData.kind = 'shark';
  return g;
}

// ------------------------------------------------------------- drifting motes
// Rising specks and far-off bubbles. Cheap, and they do most of the work of
// making the water feel like water.
function makeMotes(count, spread) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const spd = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3]     = (Math.random() - 0.5) * spread.x;
    pos[i * 3 + 1] = (Math.random() - 0.5) * spread.y;
    pos[i * 3 + 2] = -18 - Math.random() * 50;
    spd[i] = 0.9 + Math.random() * 2.4;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xcdf2ff,
    size: 0.28,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const pts = new THREE.Points(geo, mat);
  pts.userData.spd = spd;
  pts.userData.spread = spread;
  pts.frustumCulled = false;
  return pts;
}

/**
 * Build the whole backdrop. `bounds` is the visible half-extent of the play
 * plane so creatures can be launched from just outside the screen.
 */
export function createOcean(scene, bounds, creatures = null, camera = null) {
  // `creatures` is the optional glTF library from src/creatures.js. When a kind
  // is present there we use the real model; otherwise we fall back to the
  // procedural builder for that kind specifically - so a pack containing only
  // fish still upgrades the fish and leaves the octopus alone.
  const build = (kind, scale, hue) => {
    const modelled = creatures && creatures.make(kind, scale);
    if (modelled) { modelled.userData.kind = kind; return modelled; }
    if (kind === 'shark') return makeShark(scale);
    // ⛔ The fallback for anything else is a FISH, not an octopus. It used to be
    // makeOctopus(), which is how a procedural octopus could end up swimming a
    // lane - and the reef octopus (src/octopus.js) is the only octopus in this
    // app now. A missing model should degrade to generic background life, not
    // to a second creature pretending to be a specific animal.
    return makeFish(scale, hue === undefined ? 0.1 : hue);
  };
  const group = new THREE.Group();
  scene.add(group);

  const motes = makeMotes(260, { x: bounds.x * 2.6, y: bounds.y * 2.4 });
  group.add(motes);

  const swimmers = [];
  const spawn = (mesh, lane, speed, yJitter) => {
    mesh.position.set(0, 0, lane);
    // Roughly how long this creature is, for the off-screen margin. The
    // bounding box of an unposed skinned mesh is an approximation, which is all
    // a margin needs - it only has to be bigger than the body, not exact.
    const bb = new THREE.Box3().setFromObject(mesh);
    const sz = new THREE.Vector3();
    bb.getSize(sz);
    mesh.userData.spanX = Math.max(sz.x, sz.z) || 6;
    mesh.userData.speed = speed;
    mesh.userData.lane = lane;
    mesh.userData.yJitter = yJitter;
    mesh.userData.phase = Math.random() * Math.PI * 2;
    resetSwimmer(mesh, bounds, true, camera);
    group.add(mesh);
    swimmers.push(mesh);
  };

  // A small, varied cast. Deliberately not a school of forty - motion behind
  // the bubbles has to stay calm enough that it does not pull the eye off the
  // letters.
  spawn(build('fish', 0.75, 0.08), LANES[0], 3.4, 1.1);
  spawn(build('fish', 0.62, 0.14), LANES[1], 2.7, 1.5);
  spawn(build('fish', 0.90, 0.55), LANES[2], 2.2, 0.9);
  spawn(build('fish', 0.55, 0.02), LANES[1], 3.9, 1.8);
  // ⛔ A DOLPHIN, and now called one. This was `build('octopus', ...)` mapped in
  // the manifest to dolphin.glb, because the fish pack had no octopus - so the
  // code, the manifest and the screen all disagreed about what this animal was.
  // The reef octopus in src/octopus.js is the real one; this lane is a dolphin.
  spawn(build('dolphin', 0.85), LANES[3], 1.2, 0.5);
  // The deep lane is the WHALE (see manifest.json): slow, far, permanent
  // traffic. The shark was pulled out of the routine cast entirely - it is an
  // event now, in src/shark.js, and a small one cruising here all day would
  // spend the surprise that event depends on.
  spawn(build('shark', 0.90), LANES[4], 1.9, 0.35);

  // ---- lighting ----------------------------------------------------------
  // A three-light rig, built to do a specific job rather than "look lit":
  //   key  - the sun, from above and slightly left, matching the god rays
  //   hemi - the water itself: aqua from above, deep blue bounce from below.
  //          This is what keeps shadowed faces coloured instead of grey.
  //   rim  - a cold back-edge that separates dice and bubbles from the water
  const key = new THREE.DirectionalLight(0xfff1d6, 2.1);
  key.position.set(-0.35, 1.0, 0.62);
  scene.add(key);

  const hemi = new THREE.HemisphereLight(0x8ff0ff, 0x05284a, 1.5);
  scene.add(hemi);

  const fill = new THREE.AmbientLight(0x2f6f96, 0.55);
  scene.add(fill);

  // Placed BEHIND the play plane so it catches the top edge of the dice and the
  // far side of the bubble film.
  const rim = new THREE.DirectionalLight(0x6fd6ff, 1.35);
  rim.position.set(0.55, 0.35, -0.9);
  scene.add(rim);

  return { group, swimmers, motes, camera, lights: { key, hemi, fill, rim } };
}

/**
 * Put a swimmer back at the edge it should enter from.
 *
 * ⛔ The edge is measured at the swimmer's OWN LANE, not at the play plane. A
 * fish at z = −50 is 76 units from the camera where the frustum is 70 units
 * wide; `bounds.x + 14` put it at 35, which is a third of the way INSIDE the
 * picture. That is the "fish blipping in and out of existence" bug: they were
 * not swimming off the screen, they were being teleported in plain sight.
 */
function resetSwimmer(m, bounds, anywhere = false, camera = null) {
  // Alternate direction so traffic goes both ways.
  const dir = Math.random() < 0.5 ? 1 : -1;
  m.userData.dir = dir;
  const edge = swimmerEdge(m, bounds, camera);
  const x = anywhere
    ? (Math.random() - 0.5) * edge * 1.7
    : (-dir) * edge;
  m.position.x = x;
  m.position.y = (Math.random() - 0.5) * bounds.y * 1.5;
  m.userData.baseY = m.position.y;
  // Face travel direction. The models point +x, so a leftward swimmer is
  // yawed 180 degrees - never mirrored by a negative scale, which would flip
  // the lighting and read as a hole in the water.
  m.rotation.y = dir > 0 ? 0 : Math.PI;
}

/**
 * `threat` is the hero shark's position while it is crossing, or null. The
 * scatter lives HERE rather than in shark.js because this loop owns baseY and
 * rewrites it every frame - anything the shark pushed from outside would be
 * overwritten before it was ever drawn.
 */
/**
 * How far out a swimmer must be to be genuinely off screen, measured at its own
 * depth. Falls back to the old play-plane figure only if no camera was handed
 * in, so the ocean still runs standalone.
 */
function swimmerEdge(m, bounds, camera) {
  if (!camera) return bounds.x + 14;
  // Half the model's own length, so a manta does not appear nose-first at the
  // edge, plus a little clear air.
  const half = (m.userData.spanX || 6) * 0.5;
  return halfWidthAt(camera, m.position.z) + half + 3;
}

export function updateOcean(ocean, bounds, t, dt, threat = null) {
  for (const m of ocean.swimmers) {
    const u = m.userData;

    // ---- get out of the way ------------------------------------------------
    // The scene noticing the shark is most of what makes it real. The flee
    // value decays slowly, so fish stay unsettled for a few seconds after it
    // has gone by instead of snapping back to a cruise the instant it passes.
    if (threat) {
      const dx = m.position.x - threat.x;
      const dz = (m.position.z - threat.z) * 0.6;
      const d = Math.hypot(dx, dz);
      if (d < threat.radius) {
        const k = 1 - d / threat.radius;
        u.flee = Math.min(1, (u.flee || 0) + k * dt * 2.4);
        // Away from the body, vertically. Sign is taken once per frame from
        // where the fish already is, so a school does not all pick "up".
        const away = (m.position.y >= threat.y ? 1 : -1);
        u.baseY = THREE.MathUtils.clamp(
          u.baseY + away * k * 7.5 * dt, -bounds.y * 0.95, bounds.y * 0.95);
      }
    }
    u.flee = Math.max(0, (u.flee || 0) - dt * 0.45);

    m.position.x += u.dir * u.speed * (1 + u.flee * 1.9) * dt;
    m.position.y = u.baseY + Math.sin(t * 0.6 + u.phase) * u.yJitter;

    // Gentle bank into the bob, which is what sells "swimming" over "sliding".
    // A fleeing fish banks harder, which is the tell that it is bolting rather
    // than cruising faster.
    const bank = Math.cos(t * 0.6 + u.phase) * (0.12 + u.flee * 0.3);
    m.rotation.z = u.dir > 0 ? bank : -bank;

    // A modelled creature carries its own baked swim animation - the hand-rolled
    // tail wag below is only for the procedural fallbacks.
    if (u.modelled) {
      // nothing to do: the AnimationMixer drives it
    } else if (u.kind === 'fish' || u.kind === 'shark') {
      const beat = u.kind === 'shark' ? 2.2 : 5.5;
      u.tail.rotation.y = Math.sin(t * beat + u.phase) * 0.45;
    }

    // Same edge as the one it entered from, or a fish that swam in from off
    // screen would vanish before reaching the far side.
    const edge = swimmerEdge(m, bounds, ocean.camera);
    if ((u.dir > 0 && m.position.x > edge) ||
        (u.dir < 0 && m.position.x < -edge)) {
      resetSwimmer(m, bounds, false, ocean.camera);
    }
  }

  // Motes rise and wrap.
  const pos = ocean.motes.geometry.attributes.position;
  const spd = ocean.motes.userData.spd;
  const spread = ocean.motes.userData.spread;
  for (let i = 0; i < spd.length; i++) {
    let y = pos.array[i * 3 + 1] + spd[i] * dt;
    let x = pos.array[i * 3] + Math.sin(t * 0.5 + i) * 0.012;
    // Drift toward the camera at the same rate the reef travels, so suspended
    // matter agrees with the sea floor about which way we are going. Without
    // this the motes are the one cue that gives away a static camera.
    let z = pos.array[i * 3 + 2] + 1.45 * dt;
    if (z > -12) { z = -72; x = (Math.random() - 0.5) * spread.x; }
    if (y > spread.y / 2) { y = -spread.y / 2; x = (Math.random() - 0.5) * spread.x; }
    pos.array[i * 3] = x;
    pos.array[i * 3 + 1] = y;
    pos.array[i * 3 + 2] = z;
  }
  pos.needsUpdate = true;
}
