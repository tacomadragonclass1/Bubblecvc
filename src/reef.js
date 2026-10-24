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
import { GLTFLoader } from '../vendor/jsm/GLTFLoader.js';
import { halfWidthAt } from './frustum.js';
import { makeUnderwater, bakeReefShading, waterUniforms } from './lightwater.js';

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

// ⭐ COLOUR IS RATIONED. The old palette was three near-identical hot pinks and
// the gardens had no focal point - everything shouted at the same volume. Now
// exactly ONE saturated accent (coralPink, on the branching coral) sits among
// muted ochre, mauve and olive. Deep sapphire has to dominate for the warm
// notes to mean anything.
const PALETTE = {
  coralPink:  0xff7a92,   // THE accent - branching coral only
  coralDeep:  0xcf5f74,   // sea fan, a half-step down
  // ⛔ THESE TWO ARE DELIBERATELY DARK, and resist the urge to "warm them up".
  // They are the big horizontal surfaces on the sea bed, so they catch the most
  // caustic light and carry the most area - at 0xc98f7a / 0xb8a06a they read as
  // pale cream in the app and became the brightest value in the frame, brighter
  // than the letters. Hot pink is supposed to be the one accent; a bright floor
  // steals that job.
  brain:      0xb07d68,   // terracotta, kept below the letters in value
  table:      0xa08a5e,   // ochre, ditto
  pipes:      0x9f8fb8,   // dusty mauve
  anemoneBase:0xd4737f,
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

// ------------------------------------------------------------- coral geometry
// ⭐ THE CORAL IS MODELLED NOW, not built from primitives.
//
// `assets/reef/coral.glb` holds the five silhouettes, generated by
// tools/make_coral.py (Blender). Rocks, kelp and litter stay procedural - they
// are abstract scenery and primitives serve them fine - but coral is what the
// eye actually reads on the sea bed, and a sphere called "brain coral" has none
// of what makes brain coral recognisable.
//
// ⛔ THE GLB CARRIES NO MATERIALS, DELIBERATELY. Every piece is painted here
// with the reef's own shared palette via mat(), which is what lets mergeInto()
// batch a whole band down to ~9 draw calls. Materials baked into the asset
// would each be unique and the merge would collapse to one call per instance.
//
// ⛔ FAILS SOFT, like everything else that loads. No asset, no fetch, a 404 -
// the procedural builders below take over and the reef looks exactly as it did
// before. This ships to GitHub Pages for a classroom; a missing file must never
// be what stops a phonics lesson.
let CORAL_GEO = null;

// Each exported piece is normalised to height 1 with its origin at the foot, so
// one number per species restores the footprint the cluster composition was
// tuned around. ⛔ Do not "simplify" these to 1.0 - the gaps, the richness
// falloff and the five-silhouette balance in buildCluster() are all tuned
// against the OLD primitive sizes, and flattening these re-tunes the whole reef
// by accident.
//
// ⛔ AND THEY MUST BE JUDGED AT THE GAME CAMERA, NOT UP CLOSE. The first set
// (branch 2.2, brain 1.15, table 1.35, pipes 1.3, fan 1.9) made coral that
// looked far better than the primitives in a close-up and was LESS visible than
// them in the actual app: merged band meshes averaged 3.8 units tall against
// the procedural 4.4. The camera sits at z=26 looking straight down -Z and
// never tilts, so the sea bed is a strip across the bottom of frame - a piece
// that is wide and low simply is not there. Height is what buys presence.
const CORAL_H = { branch: 3.0, brain: 1.3, table: 1.5, pipes: 1.9, fan: 2.0 };
// ⭐ NOT ONE SCALE FACTOR APPLIED TO FIVE SHAPES. Height buys presence, but it
// also buys BRIGHTNESS when the shape is a big pale horizontal surface - and
// brightness next to the letters is what the art direction cannot afford. So
// the upright, saturated species (branch, pipes) stay tall, and the flat pale
// ones (brain, table) are pulled back hard: at table 2.0 the cream discs became
// the lightest thing on screen and the eye went to them instead of to the dice.
// ⛔ The fan is deliberately the SMALLEST multiplier of the five. It is a wide,
// high-contrast lattice, so it reads from much further away than a solid lump
// does - at 3.0 the fans measured 15.7 units and became the thing you looked
// at, which inverts the art direction: the hot-pink BRANCHING coral is the
// cluster's one accent and focal point, and the fan is a supporting silhouette.
// Legibility per unit of height is not the same across these five shapes.

/**
 * Fetch the coral once, before the reef is built. Returns null on any failure,
 * which is a supported outcome - see above.
 */
export async function loadCoral() {
  // ⛔ GLTFLoader is imported STATICALLY at the top of this file, the way
  // src/creatures.js does it. A dynamic `await import()` here never settled -
  // the promise simply hung and the reef sat on its procedural coral forever,
  // with no error anywhere. src/creatures.js already pulls GLTFLoader in and
  // main.js always imports that, so a static import costs nothing extra.
  try {
    const gltf = await new Promise((res, rej) =>
      new GLTFLoader().load('assets/reef/coral.glb', res, undefined, rej));
    const out = {};
    gltf.scene.traverse(o => {
      if (!o.isMesh) return;
      const key = o.name.replace(/^coral_/, '');
      if (!key) return;
      const g = o.geometry;
      // ⛔⛔ THE CORAL MUST CARRY A `uv` ATTRIBUTE OR IT VANISHES.
      //
      // mergeGeometries() above requires position, normal AND uv, returns null
      // if any is missing, and mergeInto() then quietly does not add the result
      // - so the merge DELETES anything without UVs instead of failing. The GLB
      // is exported with no materials on purpose (the palette is applied here),
      // and Blender omits UVs when there is no material to need them, so every
      // piece of coral arrived uv-less and would have been dropped from every
      // band. An empty sea bed, no error, nothing in the console.
      //
      // Nothing actually SAMPLES these UVs - the palette is flat colour and the
      // underwater shader works off world position - so zeros are correct, not
      // a placeholder.
      if (!g.attributes.uv) {
        g.setAttribute('uv', new THREE.BufferAttribute(
          new Float32Array(g.attributes.position.count * 2), 2));
      }
      out[key] = g;
    });
    const want = ['branch', 'brain', 'table', 'pipes', 'fan'];
    if (!want.every(k => out[k])) return null;
    CORAL_GEO = out;
    return out;
  } catch {
    return null;
  }
}

/** A modelled coral piece, painted with the shared palette. */
function coralPiece(kind, scale, color, opts = {}) {
  const geo = CORAL_GEO && CORAL_GEO[kind];
  if (!geo) return null;
  const material = mat(color, opts);
  // ⭐ CORAL GETS LESS CAUSTIC LIGHT THAN THE ROCKS, and this is the third leg
  // of keeping the sea bed quiet (the other two are value and height above).
  // Caustics are a multiplier on a surface, so the bigger and paler the surface
  // the more they shout - on the broad table and brain forms the bright white
  // squiggles were pulling the eye down off the letters. 0.5 keeps the water
  // reading as water without turning the coral into the brightest thing on
  // screen.
  //
  // ⛔ Applied HERE, before the merge, on purpose. The per-band loop later calls
  // makeUnderwater(m, {caustics: 1.0}) on everything it finds, and that function
  // no-ops on a material it has already touched - so claiming the material now
  // is what makes the lower value stick. bakeReefShading clones the material
  // after the merge, and a clone carries the flag with it.
  // ⛔ 0.85, not 0.5. Cutting the caustics right back DID quiet the pale
  // species - and it also removed the broken white light that was varying the
  // pink ones, so the hot-pink branching coral went flat and became the only
  // thing in the frame. Caustics are doing two jobs here, and only one of them
  // was the problem. A small reduction calms the big pale surfaces without
  // un-tying the coral from the water it is sitting in.
  makeUnderwater(material, { caustics: 0.85, fog: 1.0 });
  const m = new THREE.Mesh(geo, material);
  m.scale.setScalar(scale * CORAL_H[kind]);
  m.rotation.y = Math.random() * Math.PI * 2;
  // ⛔ The sway loop in updateReef() reads `phase` off the fan and the anemone.
  // The old procedural builders set it; a modelled piece that did not would
  // drive its rotation with `undefined` and go NaN - which in three.js means it
  // silently stops rendering rather than throwing. Set it for every species:
  // it costs nothing and it cannot then be forgotten when another one starts
  // to animate.
  m.userData.phase = Math.random() * Math.PI * 2;
  return m;
}

// ⭐ Shared materials - one per LOOK, reused across every instance. With a few
// hundred pieces of scenery this is the difference between a handful of
// draw-call batches and several hundred.
//
// ⛔ THIS COMMENT USED TO BE A LIE, and it cost 128 draw calls.
//
// `mat()` is called inside every builder (makeCoral, makeBrainCoral, makeFan,
// ...), so every single coral instance was handed a BRAND NEW material object.
// mergeInto() batches by `material.uuid`, so identical-looking pieces could
// never merge with each other: band 0 came out of the merge as 32 meshes with
// 32 materials, four bands of that, on hardware this file correctly describes
// as draw-call bound long before it is fill bound.
//
// The fix is a cache keyed on what the material actually LOOKS like. Builders
// keep calling mat() exactly as before - they just get the same instance back
// when they ask for the same look, so the merge can do its job.
//
// ⛔ Do not "optimise" this by hoisting the materials to module scope instead:
// createReef() runs again on every resize, and module-scope materials would
// survive a reef.dispose() that had already disposed them.
const _matCache = new Map();
function mat(color, { rough = 0.72, metal = 0.0, flat = false, opacity = 1 } = {}) {
  const key = color + '|' + rough + '|' + metal + '|' + flat + '|' + opacity;
  let m = _matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color, roughness: rough, metalness: metal, flatShading: flat,
      transparent: opacity < 1, opacity,
    });
    _matCache.set(key, m);
  }
  return m;
}

/** Drop the cache. Called by reef.dispose(), because the materials go with it. */
function clearMatCache() { _matCache.clear(); }

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
  varying vec3 vNormalW;
  varying vec3 vKelpWorld;
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
    vNormalW = normalize(mat3(modelMatrix) * normal);
    // World position, purely so the fragment shader can measure its distance
    // from the camera and apply the same depth fog as everything else.
    vKelpWorld = (modelMatrix * vec4(p, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const kelpFrag = /* glsl */`
  precision mediump float;
  uniform vec3 uColor;
  uniform vec3 uLightDir;
  varying vec2 vUv;
  varying float vShade;
  varying vec3 vNormalW;
  varying vec3 vKelpWorld;
  void main() {
    // A paler spine down the middle of the blade reads as a leaf vein and keeps
    // the ribbon from looking like a flat rectangle.
    float spine = 1.0 - smoothstep(0.0, 0.35, abs(vUv.x - 0.5));
    vec3 c = uColor * vShade * (1.0 + spine * 0.22);

    // ⭐ FAKE TRANSLUCENCY. Kelp is a thin membrane and GLOWS when light comes
    // through it from behind - that single property is most of what makes it
    // read as a living plant rather than a cut-out ribbon. Blades facing away
    // from the key light get warmed and lifted rather than darkened, which is
    // the opposite of what ordinary shading does and exactly what a leaf does.
    float back = 1.0 - abs(dot(normalize(vNormalW), normalize(uLightDir)));
    float glow = pow(clamp(back, 0.0, 1.0), 2.2);
    c += vec3(0.30, 0.62, 0.38) * glow * 0.55;

    // Thinner, brighter toward the tip where the blade is youngest.
    c += uColor * pow(vUv.y, 3.0) * 0.35;

    // ⛔⛔ THE KELP MUST FOG LIKE EVERYTHING ELSE.
    //
    // This shader is bespoke, so the loop in createReef() that applies
    // makeUnderwater() to the swaying pieces skips it - it tests
    // isMeshStandardMaterial, and this is a ShaderMaterial. The consequence was
    // that kelp had NO depth fog at all: a strand recycled to the back of the
    // reef rendered at full saturation while every rock and coral around it was
    // 94% faded into the water. That is the "appears out of nowhere" effect,
    // and it is also why the kelp read as the most saturated thing on screen.
    //
    // These three lines are copied from lightwater.js on purpose and must stay
    // in step with it: same smoothstep range, same deepTint, same 0.94.
    float kd = length(vKelpWorld - cameraPosition);
    float kFog = smoothstep(70.0, 150.0, kd);
    vec3 kDeep = vec3(0.010, 0.062, 0.135);
    c = mix(c, kDeep, kFog * 0.94);
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
      // Matches the key light in ocean.js, so the backlight agrees with the sun.
      uLightDir: { value: new THREE.Vector3(-0.35, 1.0, 0.62).normalize() },
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
  // Modelled geometry when the asset loaded; the primitive build below is the
  // fallback. See loadCoral().
  const _m = coralPiece('branch', scale, color, { rough: 0.74 });
  if (_m) { _m.userData.kind = 'branch'; return _m; }
  const g = new THREE.Group();
  growBranch(g, 1.5, 0.22, 4, mat(color, { rough: 0.74, flat: false }));
  // A coral is ~40 cylinders and none of them move independently, so it becomes
  // one mesh the moment it is built.
  mergeInto(g);
  g.scale.setScalar(scale);
  return g;
}

// ------------------------------------------------------- coral morphologies
// ⭐ THE AUDIT'S SECOND FINDING: every coral in the reef was the SAME branching
// algorithm recoloured three times. Pink, amber and lavender shared one
// silhouette, so the gardens read as repetitive no matter how many were added.
//
// A real reef is defined by CONTRASTING FORMS, and the contrast is structural,
// not chromatic. These four give the garden four different shapes to read:
//
//   brain/dome   a solid rounded MASS      - what the gardens had none of
//   table/plate  a flat HORIZONTAL disc    - the strongest horizontal on a reef
//   pipes        a vertical RHYTHM         - repetition at a small scale
//   branching    the existing fractal      - now one voice among four
//
// Hot pink is also rationed from here on: the branching coral keeps it as the
// accent, and the new forms take muted ochre, mauve and olive. A garden where
// everything shouts at the same volume has no focal point.

/** Brain coral: a squat dome carved by meandering grooves. */
function makeBrainCoral(scale, color) {
  // Modelled geometry when the asset loaded; the primitive build below is the
  // fallback. See loadCoral().
  const _m = coralPiece('brain', scale, color, { rough: 0.85 });
  if (_m) { _m.userData.kind = 'brain'; return _m; }
  const geo = new THREE.SphereGeometry(1, 40, 28, 0, Math.PI * 2, 0, Math.PI * 0.62);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const seed = Math.random() * 10;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // Two interfering sine fields across the surface give the characteristic
    // meander. A single field just gives stripes.
    const g = Math.sin(v.x * 7.5 + seed) * Math.sin(v.z * 6.2 - seed)
            + Math.sin((v.x + v.z) * 5.1 + seed * 2) * 0.6;
    v.multiplyScalar(1 + g * 0.045);
    v.y *= 0.72;                       // squat, not hemispherical
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat(color, { rough: 0.85 }));
  m.scale.setScalar(scale);
  return m;
}

/** Table coral: a broad flat plate on a short stalk. */
function makeTableCoral(scale, color) {
  // Modelled geometry when the asset loaded; the primitive build below is the
  // fallback. See loadCoral().
  const _m = coralPiece('table', scale, color, { rough: 0.8 });
  if (_m) { _m.userData.kind = 'table'; return _m; }
  const g = new THREE.Group();
  const m = mat(color, { rough: 0.8 });

  const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, 0.9, 8), m);
  stalk.position.y = 0.45;
  g.add(stalk);

  // Slightly domed and gently irregular at the rim, so it is a living plate
  // rather than a dinner plate.
  const top = new THREE.SphereGeometry(1, 36, 10, 0, Math.PI * 2, 0, Math.PI * 0.30);
  const pos = top.attributes.position;
  const v = new THREE.Vector3();
  const seed = Math.random() * 10;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const r = Math.hypot(v.x, v.z);
    const wob = Math.sin(Math.atan2(v.z, v.x) * 5 + seed) * 0.07 * r;
    v.x += v.x * wob; v.z += v.z * wob;
    v.y *= 0.30;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  top.computeVertexNormals();
  const plate = new THREE.Mesh(top, m);
  plate.position.y = 0.9;
  g.add(plate);

  g.scale.setScalar(scale);
  return g;
}

/** Organ-pipe coral: a tight cluster of vertical tubes of varying height. */
function makePipeCoral(scale, color) {
  // Modelled geometry when the asset loaded; the primitive build below is the
  // fallback. See loadCoral().
  const _m = coralPiece('pipes', scale, color, { rough: 0.78 });
  if (_m) { _m.userData.kind = 'pipes'; return _m; }
  const g = new THREE.Group();
  const m = mat(color, { rough: 0.78 });
  const n = 9 + Math.floor(Math.random() * 6);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const rad = Math.random() * 0.55;
    const h = 0.7 + Math.random() * 1.5;
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, h, 7, 1, true), m);
    tube.position.set(Math.cos(a) * rad, h / 2, Math.sin(a) * rad);
    tube.rotation.z = (Math.random() - 0.5) * 0.18;
    g.add(tube);
    // A pale rim at the mouth - open tubes read as hollow, which is the whole
    // point of the form.
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.028, 5, 10), m);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(tube.position.x, h, tube.position.z);
    g.add(rim);
  }
  g.scale.setScalar(scale);
  return g;
}

// --------------------------------------------------------------- sea fan
// ⛔ THIRD ATTEMPT AT THIS SHAPE, and the first two failures are instructive:
//   1. An extruded Shape with alternating radii -> a yellow starburst.
//   2. A recursive branching TREE with thin stems -> bare winter twigs.
//
// Both failed because a gorgonian is not a tree. Its defining feature is that
// the branches ANASTOMOSE - they rejoin each other, forming a NET with holes
// through it. A tree only ever divides, so it can never close a loop, and
// without closed loops the eye reads "dead shrub" no matter how fine the stems.
//
// So this is built as a polar lattice instead: nodes on a fan-shaped grid,
// connected to their radial and tangential neighbours, with struts randomly
// omitted so the mesh is irregular. That gives closed cells, which is the thing
// the previous versions could not produce.
function makeFan(scale, color) {
  // Modelled geometry when the asset loaded; the primitive build below is the
  // fallback. See loadCoral().
  const _m = coralPiece('fan', scale, color, { rough: 0.74 });
  if (_m) { _m.userData.kind = 'fan'; return _m; }
  const RINGS = 7;         // radial divisions
  const SPOKES = 11;       // angular divisions
  const SWEEP = Math.PI * 0.80;
  const OMIT = 0.22;       // fraction of struts dropped, for irregularity

  const g = new THREE.Group();
  const inner = new THREE.Group();
  const m = mat(color, { rough: 0.74 });

  // Node positions on a fan, with a little jitter so the net is organic.
  const node = (ri, si) => {
    const r = 0.18 + (ri / RINGS) * 0.95;
    const a = -SWEEP / 2 + (si / (SPOKES - 1)) * SWEEP;
    // Spread widens toward the rim, which is what makes it a fan and not a pie.
    const jitter = (h) => (Math.sin(ri * 12.9 + si * 7.3 + h) * 0.5) * 0.045;
    return new THREE.Vector3(
      Math.sin(a) * r + jitter(1),
      Math.cos(a) * r * 1.15 + jitter(2),
      jitter(3) * 1.4
    );
  };

  const strut = (p, q, rad) => {
    const dir = new THREE.Vector3().subVectors(q, p);
    const len = dir.length();
    if (len < 1e-4) return;
    const geo = new THREE.CylinderGeometry(rad * 0.8, rad, len, 4, 1);
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.copy(p).addScaledVector(dir, 0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    inner.add(mesh);
  };

  for (let ri = 0; ri < RINGS; ri++) {
    for (let si = 0; si < SPOKES; si++) {
      const p = node(ri, si);
      // Stems thin toward the rim, as they do on a real fan.
      const rad = 0.030 * (1 - (ri / RINGS) * 0.55);
      // radial strut (outward)
      if (ri < RINGS - 1 && Math.random() > OMIT) strut(p, node(ri + 1, si), rad);
      // tangential strut - THIS is what closes the loops
      if (si < SPOKES - 1 && ri > 0 && Math.random() > OMIT * 1.4)
        strut(p, node(ri, si + 1), rad * 0.8);
      // occasional diagonal, so the cells are not a regular grid
      if (ri < RINGS - 1 && si < SPOKES - 1 && Math.random() < 0.18)
        strut(p, node(ri + 1, si + 1), rad * 0.7);
    }
  }

  // A short holdfast so it grows out of the rock rather than hovering.
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.07, 0.3, 6), m);
  foot.position.y = 0.05;
  inner.add(foot);

  mergeInto(inner);
  inner.scale.set(1, 1, 0.3);     // fans grow across the current: wide and thin
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
// ⭐ THE AUDIT CALLED THESE THE WEAKEST ASSET AND THE LARGEST MASS, which is the
// worst combination to get wrong. The old version was a once-subdivided
// icosahedron with uniform random jitter in a single flat blue - it read as
// crumpled paper, and because every rock was the same value as every other rock
// the gardens had no internal structure at all.
//
// Three changes, all cheap:
//   * TWO SCALES of displacement. Big lobes give a boulder its mass; small chips
//     give it surface. One scale of noise gives neither, just mush.
//   * A FLAT BASE. Rocks sit on the sea bed instead of hovering as full blobs,
//     which also doubles the apparent size of the garden for free.
//   * Value comes from bakeReefShading (vertex colours), not from the material.
function makeRock(scale, color, seed = Math.random() * 100) {
  const geo = new THREE.IcosahedronGeometry(1, 2);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();

  const noise = (a, b, c) =>
    Math.sin(a * 1.7 + seed) * Math.sin(b * 2.3 - seed) * Math.sin(c * 1.1 + seed * 0.5);

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n1 = noise(v.x * 1.4, v.y * 1.4, v.z * 1.4);   // boulder lobes
    const n2 = noise(v.x * 5.2, v.y * 5.2, v.z * 5.2);   // surface chips
    v.multiplyScalar(0.82 + n1 * 0.30 + n2 * 0.09);

    // Squash vertically, then clamp the underside flat so it beds in.
    v.y *= 0.62;
    if (v.y < -0.30) v.y = -0.30 - (v.y + 0.30) * 0.12;

    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();

  const m = new THREE.Mesh(geo, mat(color, { rough: 0.96, flat: true }));
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
// ⭐ Z_BACK IS SET BY THE FOG, NOT BY TASTE.
//
// A band is recycled to Z_BACK the instant it passes Z_FRONT, so whatever is
// visible at Z_BACK does not fade in - it APPEARS, all at once, with nothing
// behind it. At the old -112 that was 138 units from the camera, where the
// depth fog had only reached 77% of the way to the water colour, so a whole
// garden popped into being at roughly a quarter strength and killed the
// illusion of swimming over a reef.
//
// -135 is 161 units out, past where the fog saturates (see lightwater.js:
// smoothstep(70, 150, d)), so a band spawns effectively invisible and emerges.
// ⛔ Do not push this much further: the camera's far plane is 200 and sits at
// z = +26, so anything beyond z = -174 is clipped away entirely.
export const Z_BACK = -135;       // where a band is (re)spawned - fog-determined
export const Z_FRONT = -30;       // recycle once past this - still far behind z = 0
export const SPAN = Z_FRONT - Z_BACK;
// ⛔ BANDS went 4 -> 5 WITH that change, and the two must move together. The
// spacing between gardens is SPAN/BANDS; stretching the span without adding a
// band would have opened it from 20.5 to 26 units and left visible stripes of
// bare sea floor between the gardens.
const BANDS = 5;
export const TRAVEL = 1.45;       // world units per second

// ⛔ THE FLOOR IS LOW FOR A REASON. A cluster is ~15 world units tall, and the
// visible half-height at these depths is only 23-50 units, so a sea bed at
// y = -22 puts coral straight through the bubble row. At -40 the gardens sit in
// the bottom third at the far end and slide out of the bottom of frame as they
// approach, which is what "swimming over a reef" actually looks like.
export const FLOOR_Y = -40;

/**
 * Build the reef. `bounds` is the visible half-extent of the play plane.
 * `camZ` is kept for the static horizon, which is still screen-placed.
 */
export function createReef(scene, bounds, camera = null, camZ = 26) {
  if (camera) camZ = camera.position.z;
  const group = new THREE.Group();
  scene.add(group);
  const swaying = [];
  const bands = [];

  // How far out the clusters sit. Wide enough to frame the shot, pulled in on a
  // narrow screen so a portrait tablet still sees reef rather than empty water.
  const SIDE = Math.max(15, bounds.x * 1.15);
  const FLOOR = FLOOR_Y;
  waterUniforms.uFloorY.value = FLOOR_Y;

  /**
   * One garden. `flip` mirrors the arrangement; `rich` is 0-1 and decides how
   * much is in it, so a row of clusters reads as a varied reef rather than the
   * same bouquet repeated across the sea bed.
   *
   * ⭐ The five-silhouette rule still holds INSIDE a cluster: a solid mass, a
   * horizontal, a vertical rhythm, a fractal and a flat net. What varies now is
   * WHICH of them show up and where, not the principle. Hot pink is still
   * rationed - only some clusters get the branching coral, so the eye has one
   * focal point per stretch of reef instead of a row of them.
   */
  const buildCluster = (flip, rich = 1) => {
    const c = new THREE.Group();
    const chance = p => Math.random() < p;
    const jit = (a, b) => a + Math.random() * (b - a);

    const rock = makeRock(2.9 * jit(0.8, 1.25), PALETTE.rock);
    rock.rotation.y = Math.random() * 6.28;
    c.add(rock);
    if (chance(0.8)) {
      const rock2 = makeRock(1.9 * jit(0.75, 1.3), PALETTE.rockDeep);
      rock2.position.set(flip * jit(2.2, 3.8), -0.6, jit(0.8, 2.4));
      rock2.rotation.y = Math.random() * 6.28;
      c.add(rock2);
    }

    // ⭐ FIVE DIFFERENT SILHOUETTES, one of each. The old garden had the same
    // branching shape five times in different colours; this has a solid mass, a
    // horizontal, a vertical rhythm, a fractal and a flat net. Hot pink is
    // rationed to the branching coral alone so the garden has a focal point
    // instead of five things shouting at once.
    if (chance(0.25 + 0.6 * rich)) {
      const brain = makeBrainCoral(jit(1.3, 2.0), PALETTE.brain);
      brain.position.set(flip * jit(-3.2, -1.6), 0.5, jit(0.6, 1.8));
      c.add(brain);
    }

    if (chance(0.3 + 0.55 * rich)) {
      const table = makeTableCoral(jit(1.3, 2.1), PALETTE.table);
      table.position.set(flip * jit(1.2, 2.8), jit(0.4, 0.9), jit(1.2, 2.4));
      table.rotation.y = Math.random() * 6.28;
      c.add(table);
    }

    if (chance(0.3 + 0.5 * rich)) {
      const pipes = makePipeCoral(jit(1.0, 1.7), PALETTE.pipes);
      pipes.position.set(flip * jit(-1.4, 0.8), 0.6, jit(-1.4, 0.2));
      c.add(pipes);
    }

    // The accent. One hot colour, one fractal silhouette - and NOT in every
    // cluster, or the focal point stops being a focal point.
    if (chance(0.22 + 0.4 * rich)) {
      const branch = makeCoral(jit(1.1, 1.8), PALETTE.coralPink);
      branch.position.set(flip * jit(0.2, 1.8), 0.9, jit(0.0, 1.0));
      c.add(branch);
    }

    if (chance(0.35 + 0.45 * rich)) {
      const fan = makeFan(jit(1.6, 2.4), PALETTE.coralDeep);
      fan.position.set(flip * jit(2.4, 4.0), 1.0, jit(-1.8, -0.4));
      fan.rotation.y = flip * jit(0.1, 0.45);
      c.add(fan);
      swaying.push(fan);
    }

    const anemones = Math.round(jit(0, 1 + 2 * rich));
    for (let i = 0; i < anemones; i++) {
      const an = makeAnemone(jit(0.9, 1.6), PALETTE.anemoneBase);
      an.position.set(flip * jit(-2.6, 3.4), jit(0.6, 1.3), jit(1.2, 3.4));
      c.add(an);
      swaying.push(an);
    }

    const strands = Math.round(jit(1, 2 + 2.5 * rich));
    for (let i = 0; i < strands; i++) {
      const k = makeKelp(jit(3.4, 7.0), jit(0.46, 0.7),
                         i % 2 ? PALETTE.kelpLight : PALETTE.kelpDark);
      k.position.set(flip * jit(1.8, 9.0), 0.3, jit(-4.5, -1.2));
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
    const bandZ = Z_BACK + (i * SPAN) / BANDS;

    // ⛔ THE REEF IS LAID OUT ACROSS THE FRUSTUM AT THE BAND'S OWN DEPTH, not
    // across bounds.x. This band sits 56-138 units from the camera, where the
    // picture is 92-228 world units wide; two clusters at +-25 left the whole
    // left and right of the sea bed as empty water, which is exactly what it
    // looked like. Width is measured at the NEAR end of the band's travel, so
    // the row still spans the screen when it has come forward.
    const reach = camera ? halfWidthAt(camera, Math.max(bandZ, Z_FRONT)) * 1.08
                         : SIDE * 1.6;
    // One garden roughly every 26 units, so a wide screen gets more reef
    // rather than the same two gardens stretched further apart.
    const count = Math.max(3, Math.min(7, Math.round((reach * 2) / 26)));
    for (let n = 0; n < count; n++) {
      // Evenly spaced, then jittered by most of a slot - regular enough to
      // cover the floor, irregular enough not to read as a row of planters.
      const slot = (n + 0.5) / count;
      const x = (slot - 0.5) * 2 * reach + (Math.random() - 0.5) * (reach * 1.4 / count);
      const flip = x < 0 ? -1 : 1;
      // Richness falls off toward the edges of frame: the middle of the sea
      // bed is what the eye reads, and the sides are a soft frame for it.
      const rich = 0.35 + 0.65 * (1 - Math.min(1, Math.abs(x) / reach));
      const c = buildCluster(flip, rich);
      const cs = (1.6 + Math.random() * 0.9) * (1 + 0.35 * rich);
      c.scale.setScalar(cs);
      c.position.set(x, FLOOR, (Math.random() - 0.5) * 12);
      c.rotation.y = (Math.random() - 0.5) * 0.5;
      // ⭐ Tagged so a reef DWELLER can pick a garden to live in. mergeInto()
      // below strips the meshes out of this Group and welds them into the
      // band, but the Group node itself survives with its position and scale
      // intact - which is exactly the anchor the octopus needs. Keep the scale
      // on userData too, because that is what says how TALL this garden is and
      // therefore how high up something sitting in it should perch.
      c.userData.isCluster = true;
      c.userData.clusterScale = cs;
      band.add(c);
    }

    // Floor litter between the gardens, so the sea bed reads as continuous
    // rather than as islands sliding past.
    const litter = Math.round(count * 3.5);
    for (let j = 0; j < litter; j++) {
      const kind = Math.random();
      let o;
      if (kind < 0.62) { o = makeRock(1.4 + Math.random() * 2.4, 0x1c4360); o.material = stoneMat; }
      else if (kind < 0.9) {
        o = new THREE.Mesh(new THREE.SphereGeometry(1.1, 10, 7, 0, Math.PI * 1.5), shellMat);
        o.scale.set(1, 0.6, 1);
        o.rotation.set(0.3, Math.random() * 6.28, 0.2);
      } else { o = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 10), pearlMat); }
      o.position.set((Math.random() - 0.5) * reach * 2.1,
                     FLOOR + (Math.random() - 0.5) * 3,
                     (Math.random() - 0.5) * 14);
      band.add(o);
    }

    // ⛔ Merge each band INTERNALLY only. Merging across bands would weld them
    // into one mesh and they could no longer travel independently.
    for (const o of swaying) o.traverse(c => { c.userData.keepSeparate = true; });
    mergeInto(band);

    // Bake the anchoring shading, then make every surface underwater-lit. Order
    // matters: bakeReefShading clones the material, so caustics must be applied
    // to the clone, not to the original it replaced.
    band.traverse(o => {
      if (!o.isMesh) return;
      bakeReefShading(o, { floorY: FLOOR_Y, spread: 18 });
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) makeUnderwater(m, { caustics: 1.0, fog: 1.0 });
    });

    band.position.z = bandZ;
    group.add(band);
    bands.push(band);
  }

  // The swaying pieces are deliberately excluded from the merge, so they never
  // got the treatment above. Light them too, or the kelp and fans are the only
  // dry-looking things in the water.
  for (const o of swaying) {
    o.traverse(c => {
      if (!c.isMesh) return;
      const mats = Array.isArray(c.material) ? c.material : [c.material];
      // Kelp runs its own bespoke shader, so it is left alone here.
      for (const m of mats) if (m.isMeshStandardMaterial) makeUnderwater(m, { caustics: 0.75, fog: 1.0 });
    });
  }

  // ---- static horizon ----------------------------------------------------
  // The far reef barely moves - that IS correct parallax, and it also gives the
  // eye something stable to read the travelling bands against.
  const horizon = new THREE.Group();
  const reefA = makeDistantReef(
    (camera ? halfWidthAt(camera, -78) * 2.2 : bounds.x * 3.4));
  reefA.position.set(0, -bounds.y * 1.02 * ((camZ + 78) / camZ), -78);
  reefA.scale.multiplyScalar((camZ + 78) / camZ);
  horizon.add(reefA);
  const reefB = makeDistantReef(
    (camera ? halfWidthAt(camera, -58) * 1.9 : bounds.x * 2.8));
  reefB.material = reefB.material.clone();
  reefB.material.color.setHex(0x0e3450);
  reefB.material.opacity = 0.55;
  reefB.position.set(bounds.x * 0.35 * ((camZ + 58) / camZ),
                     -bounds.y * 1.12 * ((camZ + 58) / camZ), -58);
  reefB.scale.multiplyScalar((camZ + 58) / camZ);
  horizon.add(reefB);
  group.add(horizon);

  function dispose() {
    // Materials are shared now, so the same instance shows up many times in this
    // traversal. dispose() is idempotent in three.js, so disposing twice is
    // harmless - but the CACHE must be dropped, or the next createReef() (every
    // resize rebuilds the reef) would hand out materials that have already been
    // disposed and the whole sea bed would render untextured.
    group.traverse(o => {
      if (!o.isMesh) return;
      o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) m && m.dispose && m.dispose();
    });
    clearMatCache();
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
