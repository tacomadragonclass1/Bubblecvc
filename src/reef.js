// ----------------------------------------------------------------------- reef
// The underwater world. Procedural, no assets.
//
// ⛔ COMPOSITION RULE, and it is the whole design of this file: the centre of
// the frame belongs to the bubbles. Everything here is placed into the BOTTOM
// CORNERS and the DISTANT BAND, and every single object sits behind z = -14,
// well behind the play plane at z = 0. Nothing here is ever hit-tested.
//
// Three depth layers, each doing a specific job:
//
//   FOREGROUND  z -14..-20   big, dark, low-saturation silhouettes along the
//                            bottom edge. These frame the shot and give the
//                            eye something near to measure depth against.
//   MIDGROUND   z -24..-38   the coral gardens. This is where the warm colour
//                            lives - corals, anemones, sea fans - restricted
//                            to the lower left and right so the bubble row
//                            stays clean.
//   BACKGROUND  z -60..-80   a low, hazy reef silhouette that only establishes
//                            scale, plus the open water above it.
//
// Warm colour is RATIONED. Coral pink, amber and a little lavender appear only
// in the midground clusters, because a scene that is warm everywhere stops
// reading as underwater. The deep sapphire has to dominate for the aquamarine
// highlights to mean anything.

import * as THREE from '../vendor/three.module.js';

// ---------------------------------------------------------------- geometry merge
// three.js keeps BufferGeometryUtils in examples/, which this project does not
// vendor, so here is the 30 lines of it that matter.
//
// ⭐ THIS IS A PERFORMANCE FIX, NOT A TIDY-UP. The reef is built from hundreds of
// small pieces - coral segments, kelp blades, anemone tentacles - and the first
// version drew every one of them separately: 543 draw calls for only 50k
// triangles. That ratio is the worst possible case for the weak SoC behind a
// classroom panel, which is draw-call bound long before it is fill bound.
// Anything that does not need to animate on its own gets baked into one mesh.
function mergeInto(root) {
  const byMaterial = new Map();
  root.updateMatrixWorld(true);
  const doomed = [];
  root.traverse(o => {
    if (!o.isMesh || o.userData.keepSeparate) return;
    const key = o.material.uuid;
    if (!byMaterial.has(key)) byMaterial.set(key, { material: o.material, parts: [] });
    const g = o.geometry.clone();
    g.applyMatrix4(root.matrixWorld.clone().invert().multiply(o.matrixWorld));
    byMaterial.get(key).parts.push(g);
    doomed.push(o);
  });
  for (const o of doomed) o.parent && o.parent.remove(o);

  for (const { material, parts } of byMaterial.values()) {
    if (!parts.length) continue;
    const merged = mergeGeometries(parts);
    parts.forEach(g => g.dispose());
    if (merged) root.add(new THREE.Mesh(merged, material));
  }
  return root;
}

function mergeGeometries(list) {
  // Only the attributes these shapes actually use. Anything with a different
  // attribute set is skipped rather than silently corrupted.
  const names = ['position', 'normal', 'uv'];
  let total = 0;
  for (const g of list) {
    if (!names.every(n => g.attributes[n])) return null;
    total += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  for (const n of names) {
    const size = list[0].attributes[n].itemSize;
    const arr = new Float32Array(total * size);
    let o = 0;
    for (const g of list) { arr.set(g.attributes[n].array, o); o += g.attributes[n].array.length; }
    out.setAttribute(n, new THREE.BufferAttribute(arr, size));
  }
  // Indices, rebased per part.
  let needIndex = list.some(g => g.index);
  if (needIndex) {
    const idx = [];
    let base = 0;
    for (const g of list) {
      if (g.index) for (const v of g.index.array) idx.push(v + base);
      else for (let i = 0; i < g.attributes.position.count; i++) idx.push(i + base);
      base += g.attributes.position.count;
    }
    out.setIndex(idx);
  }
  out.computeBoundingSphere();
  return out;
}

const PALETTE = {
  coralPink:  0xff7a92,
  coralDeep:  0xe0556f,
  amber:      0xffa94f,
  gold:       0xffd27a,   // used by the floor scatter, not the fans
  lavender:   0xb9a3e8,
  kelpDark:   0x1d6b63,
  kelpLight:  0x3fa88b,
  rock:       0x27506b,
  rockDeep:   0x163449,
  anemone:    0xff9ec4,
  pearl:      0xeaf6ff,
};

// Shared materials - one per look, reused across every instance. With a few
// hundred pieces of scenery this is the difference between 6 draw-call batches
// and several hundred.
function mat(color, { rough = 0.72, metal = 0.0, flat = false, opacity = 1 } = {}) {
  return new THREE.MeshStandardMaterial({
    color, roughness: rough, metalness: metal, flatShading: flat,
    transparent: opacity < 1, opacity,
  });
}

// ------------------------------------------------------------------- kelp
// ⭐ ONE MESH PER STRAND, bent in the vertex shader.
//
// The first version chained nine little plane meshes per strand and rotated each
// one. It articulated nicely but cost nine draw calls per strand, and with a
// dozen strands that was over a hundred calls of pure scenery. Now each strand
// is a single tall ribbon and the bend is computed per-vertex from the height,
// which is both far cheaper AND smoother - a continuous curve instead of a
// chain of hinges.
const kelpVert = /* glsl */`
  uniform float uTime;
  uniform float uPhase;
  uniform float uHeight;
  uniform float uAmp;
  varying vec2 vUv;
  varying float vShade;
  void main() {
    vUv = uv;
    vec3 p = position;
    // h is 0 at the holdfast, 1 at the tip. Squaring it means the base barely
    // moves while the tip travels - which is how a plant in a current behaves.
    float h = clamp(p.y / uHeight, 0.0, 1.0);
    float bend = sin(uTime * 0.7 + uPhase + h * 2.1) * uAmp * h * h;
    float twist = cos(uTime * 0.45 + uPhase * 1.4 + h * 1.6) * uAmp * 0.45 * h * h;
    p.x += bend;
    p.z += twist;
    // A little self-shading toward the tip so the strand is not flat.
    vShade = 0.72 + 0.28 * h;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const kelpFrag = /* glsl */`
  precision mediump float;
  uniform vec3 uColor;
  varying vec2 vUv;
  varying float vShade;
  void main() {
    // A paler spine down the middle of the blade reads as a leaf vein and keeps
    // the ribbon from looking like a flat rectangle.
    float spine = 1.0 - smoothstep(0.0, 0.35, abs(vUv.x - 0.5));
    vec3 c = uColor * vShade * (1.0 + spine * 0.22);
    gl_FragColor = vec4(c, 1.0);
  }
`;

function makeKelp(height, width, color) {
  // Tall and narrow, with enough vertical segments for the bend to be smooth.
  const geo = new THREE.PlaneGeometry(width, height, 1, 14);
  geo.translate(0, height / 2, 0);
  // Taper toward the tip.
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = 1 - (y / height) * 0.62;
    pos.setX(i, pos.getX(i) * t);
  }
  const m = new THREE.ShaderMaterial({
    vertexShader: kelpVert,
    fragmentShader: kelpFrag,
    uniforms: {
      uTime: { value: 0 },
      uPhase: { value: Math.random() * Math.PI * 2 },
      uHeight: { value: height },
      uAmp: { value: 0.5 + Math.random() * 0.4 },
      uColor: { value: new THREE.Color(color) },
    },
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, m);
  mesh.userData.kind = 'kelp';
  mesh.userData.mat = m;
  mesh.userData.keepSeparate = true;
  return mesh;
}

// ------------------------------------------------------------------- coral
// Branching coral, grown recursively. Three or four levels is enough to read
// as coral; more just costs draw calls.
function growBranch(parent, len, rad, depth, material) {
  if (depth <= 0) return;
  // 8 sides and smooth shading. At 6 sides with flatShading the branches read
  // as faceted sticks rather than as something that grew.
  const geo = new THREE.CylinderGeometry(rad * 0.62, rad, len, 8, 1);
  geo.translate(0, len / 2, 0);
  const seg = new THREE.Mesh(geo, material);
  parent.add(seg);

  // Rounded tip. Real branching coral is blunt and swollen at the ends, never
  // cut off flat - this one detail does most of the work.
  if (depth === 1) {
    const tip = new THREE.Mesh(new THREE.SphereGeometry(rad * 0.72, 8, 6), material);
    tip.position.y = len;
    tip.scale.set(1, 1.25, 1);
    seg.add(tip);
  }

  const n = depth > 2 ? 3 : 2;
  for (let i = 0; i < n; i++) {
    const child = new THREE.Group();
    child.position.y = len * (0.62 + Math.random() * 0.3);
    child.rotation.z = (Math.random() - 0.5) * 1.25;
    child.rotation.y = Math.random() * Math.PI * 2;
    seg.add(child);
    growBranch(child, len * (0.62 + Math.random() * 0.14), rad * 0.66, depth - 1, material);
  }
}

function makeCoral(scale, color) {
  const g = new THREE.Group();
  growBranch(g, 1.5, 0.22, 4, mat(color, { rough: 0.74, flat: false }));
  // A coral is ~40 cylinders and none of them move independently, so it becomes
  // one mesh the moment it is built.
  mergeInto(g);
  g.scale.setScalar(scale);
  return g;
}

// --------------------------------------------------------------- sea fan
// ⛔ A SEA FAN IS A LATTICE, NOT A SOLID SHAPE.
//
// The first version was a Shape with alternating radii, extruded - which came
// out as a yellow starburst, the single worst-looking object in the scene. A
// gorgonian's whole visual identity is a FLAT BRANCHING NET: stems that split
// repeatedly, fan out within one plane, and stay thin enough to see water
// through. Solid geometry can never read as one.
//
// So it is grown like the coral, but with two constraints that make it a fan
// rather than a bush: branching is confined to the XY plane (no yaw at all),
// and the split angle narrows with each generation so the tips end up roughly
// parallel instead of splaying.
function growFanBranch(parent, len, rad, depth, spread, material) {
  if (depth <= 0) return;
  const geo = new THREE.CylinderGeometry(rad * 0.68, rad, len, 5, 1);
  geo.translate(0, len / 2, 0);
  const seg = new THREE.Mesh(geo, material);
  parent.add(seg);

  // Two children most of the time, occasionally three - a perfectly binary tree
  // looks manufactured.
  const n = Math.random() < 0.22 ? 3 : 2;
  for (let i = 0; i < n; i++) {
    const child = new THREE.Group();
    child.position.y = len * (0.70 + Math.random() * 0.26);
    // Fan out in the plane only. The small random term keeps it from being
    // mirror-symmetric, which also reads as manufactured.
    const t = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
    child.rotation.z = t * spread + (Math.random() - 0.5) * 0.12;
    seg.add(child);
    growFanBranch(child, len * (0.70 + Math.random() * 0.12), rad * 0.72,
                  depth - 1, spread * 0.68, material);
  }
}

function makeFan(scale, color) {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  // Smooth shading: a sea fan has round stems, and flatShading on a 5-sided
  // cylinder makes them read as faceted sticks.
  // ⛔ STEM THICKNESS IS THE WHOLE THING. At rad 0.075 the branches were as wide
  // as they were long and the lattice closed up into solid spikes - the same
  // starburst failure as the extruded version, just arrived at differently. A
  // gorgonian's stems are hair-thin relative to the fan; you have to be able to
  // see water through it.
  const m = mat(color, { rough: 0.72, flat: false });
  growFanBranch(inner, 1.15, 0.034, 6, 0.46, m);
  // ⭐ BAKE THE LATTICE. Six generations of 2-3 branches is several hundred
  // cylinders, and because the fan is in the `swaying` list every one of them
  // was being marked keepSeparate and skipped by the scene merge - which took
  // the board from 124 draw calls to 289. The sway rotates the fan as a whole,
  // so nothing inside it needs to move independently.
  mergeInto(inner);
  // Fans grow across the current, so they are wide and very thin. Squashing on
  // Z after the fact keeps the branching maths simple.
  inner.scale.set(1, 1, 0.22);
  g.add(inner);
  g.scale.setScalar(scale);
  g.userData.kind = 'fan';
  g.userData.phase = Math.random() * Math.PI * 2;
  return g;
}

// ----------------------------------------------------------------- anemone
function makeAnemone(scale, color) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), mat(color, { rough: 0.7 }));
  base.scale.set(1, 0.72, 1);
  g.add(base);
  const tentGeo = new THREE.CapsuleGeometry(0.055, 0.5, 3, 6);
  tentGeo.translate(0, 0.3, 0);
  const tentMat = mat(PALETTE.anemone, { rough: 0.62 });
  const tents = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const r = 0.16 + Math.random() * 0.2;
    const t = new THREE.Mesh(tentGeo, tentMat);
    t.position.set(Math.cos(a) * r, 0.2, Math.sin(a) * r);
    t.rotation.set((Math.random() - 0.5) * 0.5, 0, (Math.random() - 0.5) * 0.5);
    t.userData.phase = i * 0.5;
    g.add(t);
    tents.push(t);
  }
  // The tentacles become one mesh and the CROWN sways rather than each tentacle
  // individually. At this size and distance the difference is invisible, and it
  // turns 16 draw calls per anemone into 1.
  const crown = new THREE.Group();
  for (const t of tents) { g.remove(t); crown.add(t); }
  mergeInto(crown);
  g.add(crown);
  g.userData.crown = crown;
  g.userData.kind = 'anemone';
  g.userData.phase = Math.random() * Math.PI * 2;
  g.scale.setScalar(scale);
  return g;
}

// ------------------------------------------------------------------- rocks
function makeRock(scale, color) {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    v.multiplyScalar(0.78 + Math.random() * 0.42);
    pos.setXYZ(i, v.x, v.y * 0.68, v.z);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat(color, { rough: 0.95, flat: true }));
  m.scale.setScalar(scale);
  return m;
}

// --------------------------------------------------------------- distant reef
// One long, low, hazy silhouette. Its only job is to say "the world continues",
// so it is nearly flat in value and heavily tinted toward the water colour.
function makeDistantReef(width) {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, -14);
  const steps = 52;
  for (let i = 0; i <= steps; i++) {
    const x = -width / 2 + (width * i) / steps;
    const h = 2.4
      + Math.sin(i * 0.52) * 1.7
      + Math.sin(i * 0.19 + 1.3) * 2.6
      + Math.sin(i * 1.1) * 0.7;
    shape.lineTo(x, h);
  }
  shape.lineTo(width / 2, -14);
  shape.lineTo(-width / 2, -14);
  const geo = new THREE.ShapeGeometry(shape);
  // Flat, unlit, and close to the water's own mid tone - atmospheric
  // perspective done the cheap and correct way.
  // ⛔ LOW CONTRAST IS THE POINT. At high opacity these read as flat navy
  // cardboard cutouts standing in the water. Atmospheric perspective means the
  // far reef should be only slightly darker than the water it sits in - the
  // silhouette is for scale, not for drama.
  const m = new THREE.MeshBasicMaterial({
    color: 0x12415f, transparent: true, opacity: 0.45, depthWrite: false,
  });
  return new THREE.Mesh(geo, m);
}

// ------------------------------------------------------------------ conveyor
// ⭐ THE REEF TRAVELS, THE GAMEPLAY DOES NOT.
//
// The camera never moves. Instead the reef streams toward it and recycles, which
// gives "swimming forward over a reef" while leaving the play plane at z = 0
// completely untouched - the bubbles and dice do not drift, do not change size,
// and every capture radius and tap target stays exactly where it was. Moving the
// real camera would have forced the whole play plane to chase it.
//
// Content lives in TRUE WORLD COORDINATES here, unlike the old static reef which
// pre-compensated for perspective to pin things to the corners. That
// compensation is exactly what we now want perspective to undo: a cluster should
// grow and sink out of frame as it approaches.
//
// Geometry: a cluster sits at y = -22, which at the far end is low in frame and
// by z ~ -27 has dropped below the bottom edge - so bands leave the shot on
// their own and never need fading. Nothing ever reaches the play plane.
const Z_BACK = -112;       // where a band is (re)spawned
const Z_FRONT = -30;       // recycle once past this - still far behind z = 0
const SPAN = Z_FRONT - Z_BACK;
const BANDS = 4;
const TRAVEL = 1.45;       // world units per second

// ⛔ THE FLOOR IS LOW FOR A REASON. A cluster is ~15 world units tall, and the
// visible half-height at these depths is only 23-50 units, so a sea bed at
// y = -22 puts coral straight through the bubble row. At -40 the gardens sit in
// the bottom third at the far end and slide out of the bottom of frame as they
// approach, which is what "swimming over a reef" actually looks like.
const FLOOR_Y = -40;

/**
 * Build the reef. `bounds` is the visible half-extent of the play plane.
 * `camZ` is kept for the static horizon, which is still screen-placed.
 */
export function createReef(scene, bounds, camZ = 26) {
  const group = new THREE.Group();
  scene.add(group);
  const swaying = [];
  const bands = [];

  // How far out the clusters sit. Wide enough to frame the shot, pulled in on a
  // narrow screen so a portrait tablet still sees reef rather than empty water.
  const SIDE = Math.max(15, bounds.x * 1.15);
  const FLOOR = FLOOR_Y;

  const buildCluster = (flip) => {
    const c = new THREE.Group();

    const rock = makeRock(2.9, PALETTE.rock);
    c.add(rock);
    const rock2 = makeRock(1.9, PALETTE.rockDeep);
    rock2.position.set(flip * 3.0, -0.6, 1.6);
    c.add(rock2);

    const coralA = makeCoral(1.5, PALETTE.coralPink);
    coralA.position.set(flip * -1.3, 1.2, 0.8);
    c.add(coralA);
    const coralB = makeCoral(1.1, PALETTE.amber);
    coralB.position.set(flip * 2.0, 0.9, -0.5);
    c.add(coralB);
    const coralC = makeCoral(0.8, PALETTE.lavender);
    coralC.position.set(flip * 0.3, 1.0, 2.1);
    c.add(coralC);

    const fan = makeFan(1.7, PALETTE.coralDeep);
    fan.position.set(flip * 3.2, 1.2, -1.0);
    fan.rotation.y = flip * 0.22;
    c.add(fan);
    swaying.push(fan);

    for (let i = 0; i < 2; i++) {
      const an = makeAnemone(1.1 + Math.random() * 0.5, PALETTE.coralDeep);
      an.position.set(flip * (-2.2 + Math.random() * 5.5), 0.7 + Math.random() * 0.6,
                      1.2 + Math.random() * 2);
      c.add(an);
      swaying.push(an);
    }

    for (let i = 0; i < 3; i++) {
      const k = makeKelp(4 + Math.random() * 2.5, 0.58,
                         i % 2 ? PALETTE.kelpLight : PALETTE.kelpDark);
      k.position.set(flip * (2.5 + Math.random() * 7), 0.3, -1.5 - Math.random() * 3);
      c.add(k);
      swaying.push(k);
    }
    return c;
  };

  // ---- the travelling bands ---------------------------------------------
  const stoneMat = mat(0x1c4360, { rough: 0.95, flat: true });
  const shellMat = mat(0xffd9c2, { rough: 0.6 });
  const pearlMat = mat(PALETTE.pearl, { rough: 0.18, metal: 0.1 });

  for (let i = 0; i < BANDS; i++) {
    const band = new THREE.Group();

    for (const flip of [-1, 1]) {
      const c = buildCluster(flip);
      c.scale.setScalar(2.2 + Math.random() * 0.6);
      c.position.set(flip * SIDE * (0.86 + Math.random() * 0.3),
                     FLOOR, (Math.random() - 0.5) * 10);
      band.add(c);
    }

    // Floor litter between the gardens, so the sea bed reads as continuous
    // rather than as two islands sliding past.
    for (let j = 0; j < 7; j++) {
      const kind = Math.random();
      let o;
      if (kind < 0.62) { o = makeRock(1.4 + Math.random() * 2.4, 0x1c4360); o.material = stoneMat; }
      else if (kind < 0.9) {
        o = new THREE.Mesh(new THREE.SphereGeometry(1.1, 10, 7, 0, Math.PI * 1.5), shellMat);
        o.scale.set(1, 0.6, 1);
        o.rotation.set(0.3, Math.random() * 6.28, 0.2);
      } else { o = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 10), pearlMat); }
      o.position.set((Math.random() - 0.5) * SIDE * 2.6,
                     FLOOR + (Math.random() - 0.5) * 3,
                     (Math.random() - 0.5) * 12);
      band.add(o);
    }

    // ⛔ Merge each band INTERNALLY only. Merging across bands would weld them
    // into one mesh and they could no longer travel independently.
    for (const o of swaying) o.traverse(c => { c.userData.keepSeparate = true; });
    mergeInto(band);

    band.position.z = Z_BACK + (i * SPAN) / BANDS;
    group.add(band);
    bands.push(band);
  }

  // ---- static horizon ----------------------------------------------------
  // The far reef barely moves - that IS correct parallax, and it also gives the
  // eye something stable to read the travelling bands against.
  const horizon = new THREE.Group();
  const reefA = makeDistantReef(bounds.x * 3.4);
  reefA.position.set(0, -bounds.y * 1.02 * ((camZ + 78) / camZ), -78);
  reefA.scale.multiplyScalar((camZ + 78) / camZ);
  horizon.add(reefA);
  const reefB = makeDistantReef(bounds.x * 2.8);
  reefB.material = reefB.material.clone();
  reefB.material.color.setHex(0x0e3450);
  reefB.material.opacity = 0.55;
  reefB.position.set(bounds.x * 0.35 * ((camZ + 58) / camZ),
                     -bounds.y * 1.12 * ((camZ + 58) / camZ), -58);
  reefB.scale.multiplyScalar((camZ + 58) / camZ);
  horizon.add(reefB);
  group.add(horizon);

  function dispose() {
    group.traverse(o => {
      if (!o.isMesh) return;
      o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) m && m.dispose && m.dispose();
    });
    scene.remove(group);
    swaying.length = 0;
    bands.length = 0;
  }

  return { group, swaying, bands, dispose };
}

/**
 * Currents, plus the forward travel. Everything sways on the same slow field so
 * the water feels shared.
 */
export function updateReef(reef, t, reducedMotion = false, dt = 0) {
  const amp = reducedMotion ? 0.3 : 1;

  // Advance the conveyor. Reduced motion slows it right down rather than
  // stopping it - a frozen reef under a drifting camera looks broken.
  const speed = TRAVEL * (reducedMotion ? 0.25 : 1);
  for (const band of reef.bands || []) {
    band.position.z += speed * dt;
    if (band.position.z > Z_FRONT) band.position.z -= SPAN;
  }
  for (const o of reef.swaying) {
    const u = o.userData;
    if (u.kind === 'kelp') {
      // One uniform drives the whole strand - the bend itself lives in the
      // vertex shader.
      u.mat.uniforms.uTime.value = reducedMotion ? t * 0.3 : t;
    } else if (u.kind === 'fan') {
      // A fan is stiff - it pivots at the holdfast rather than rippling.
      o.rotation.z = Math.sin(t * 0.5 + u.phase) * 0.075 * amp;
      o.rotation.y = Math.sin(t * 0.34 + u.phase * 1.3) * 0.14 * amp;
    } else if (u.kind === 'anemone' && u.crown) {
      u.crown.rotation.x = Math.sin(t * 1.25 + u.phase) * 0.17 * amp;
      u.crown.rotation.z = Math.cos(t * 1.05 + u.phase) * 0.15 * amp;
      const breathe = 1 + Math.sin(t * 0.9 + u.phase) * 0.06 * amp;
      u.crown.scale.set(breathe, 1 / breathe, breathe);
    }
  }
}
