// -------------------------------------------------------------------- bubbles
// The slots a word gets built into, and the FILM that is drawn around them.
//
// ⭐⭐ SLOT AND FILM ARE SEPARATE THINGS, and keeping them apart is what makes
// bubble merging safe. A SLOT is the logical home of one phoneme: it owns the
// die, the capture radius, the magnet target and its place in the word. There
// are always exactly as many slots as the board has sounds, and nothing about
// merging changes that. A FILM is the soap membrane you can see, and ONE film
// may wrap several adjacent slots - that is the merge.
//
// So when a teacher welds the vowel and the coda together to show the rime, the
// word state, the throwing, the aiming and the audio are all completely
// untouched: the only thing that changed is how many membranes are drawn and
// what shape they are. Everything that used to read `bubbles[i].die` still
// does.
//
// Rendering is a thin-film soap bubble: a fresnel rim, interference colour that
// shifts with view angle, and a travelling specular. No environment map, no
// refraction pass - it has to stay cheap enough for a weak TV SoC driving a
// very large panel.

import * as THREE from '../vendor/three.module.js';
import { DIE_SIZE } from './dice.js';

// ⭐⭐ THE MERGED SHAPE IS A RADIAL UNION OF SPHERES, SOLVED IN CLOSED FORM.
//
// The obvious way to draw a two-slot bubble is to stretch one sphere sideways,
// and that is what the old `span: 2` code did. It is wrong for this feature:
// a stretched sphere is a capsule, and a capsule says "one shape", when the
// whole pedagogical point is that the child can still see the two letters as
// two things inside one envelope. Two bubbles that have coalesced are a PEANUT
// - two lobes with a filleted waist - and that is what has to be on screen.
//
// Marching cubes or a raymarched SDF would both do it and both cost far too
// much here. Instead: keep the unit sphere mesh and DISPLACE it. For each
// vertex direction d, the distance from the film's centre to the surface is the
// farthest point at which d leaves any lobe - and that has a closed form,
// because it is just the far root of a ray/sphere intersection. One sqrt per
// lobe, no iteration, and the 3072-vertex sphere already in use is plenty of
// resolution for it.
//
// The hard union of two spheres has a CREASE where they intersect. Surface
// tension does not allow a crease, so the roots are combined with a smooth
// maximum rather than a maximum, and the blend radius is the neck fillet. That
// single number is what the merge animation drives.
const bubbleVert = /* glsl */`
  uniform vec3  uLobe[3];    // lobe centres, in units of the film's radius
  uniform float uLobeR[3];   // lobe radii, same units (normally 1.0)
  uniform float uNeck[3];    // fillet radius at the boundary ENTERING lobe i
  uniform int   uLobes;      // 1 = an ordinary bubble, 2-3 = a merged one
  // ⛔⛔ THE IDLE TURN IS A SHADER ROTATION, NOT A MESH ROTATION, and on a
  // merged film that is the difference between alive and broken.
  //
  // Turning the mesh was correct while every bubble was a sphere: a sphere is
  // the same shape from every angle, so rotating it moved the interference
  // pattern and nothing else. A peanut is not. Rotating the mesh swung one
  // lobe toward the camera and the other away - so the two halves of a merged
  // bubble rendered at visibly different sizes - and tilted the whole film
  // while the letters inside it stayed level, leaving each letter sitting off
  // the centre of its own lobe.
  //
  // What the turn was ever FOR is the iridescence shifting as the film moves,
  // and that only needs the sampling direction to turn. So the geometry stays
  // put and the pattern turns inside it: identical to the old look on a single
  // bubble, and the only sane behaviour on a merged one.
  uniform vec2  uSpin;       // yaw, roll - applied to the PATTERN only

  varying vec3 vNormalW;
  varying vec3 vViewW;
  varying vec3 vPosL;
  varying vec2 vUv;

  // Smooth maximum. The interpolation weight comes back alongside the value so
  // the normal can be blended by exactly the same amount - that is what keeps
  // the shading continuous across the fillet without a second evaluation.
  vec2 smaxW(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / max(k, 1e-4), 0.0, 1.0);
    return vec2(mix(a, b, h) + k * h * (1.0 - h), h);
  }

  void main() {
    vUv = uv;
    vec3 d = normalize(position);
    // ⭐ The interference pattern is still organised around the FILM's centre,
    // not per lobe. A merged bubble is one membrane, so it has one continuous
    // drain and one marbling across the whole peanut - which is a large part of
    // what makes it read as a single bubble rather than two stuck together.
    float cy = cos(uSpin.x), sy = sin(uSpin.x);
    float cz = cos(uSpin.y), sz = sin(uSpin.y);
    vec3 q = vec3(d.x * cy + d.z * sy, d.y, -d.x * sy + d.z * cy);
    vPosL = vec3(q.x * cz - q.y * sz, q.x * sz + q.y * cz, q.z);

    float R = 0.0;
    vec3 N = d;
    for (int i = 0; i < 3; i++) {
      // Guarded rather than an early break: a constant loop bound with no exit
      // is the shape GLSL ES 1.0 is happiest with on weak drivers.
      if (i < uLobes) {
        vec3 c = uLobe[i];
        float b = dot(d, c);
        float disc = b * b - dot(c, c) + uLobeR[i] * uLobeR[i];
        // Far root, clamped forward: a lobe the ray never reaches contributes
        // nothing instead of pulling the surface inside out.
        float ti = disc >= 0.0 ? max(0.0, b + sqrt(disc)) : 0.0;
        vec3 ni = normalize(d * ti - c);
        if (i == 0) { R = ti; N = ni; }
        else {
          vec2 s = smaxW(R, ti, uNeck[i]);
          R = s.x;
          N = normalize(mix(N, ni, s.y));
        }
      }
    }

    vec3 p = d * R;
    vec4 wp = modelMatrix * vec4(p, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * N);
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

export const BUBBLE_R_MAX = 4.1;

// ⭐ BUBBLES SIT ALMOST TOUCHING, and that is a pedagogical choice.
//
// These bubbles are a word being BLENDED. Sounds that run together should look
// like they run together - a row of well-separated spheres reads as unrelated
// objects, which is the opposite of what blending teaches. So the gap is a thin
// sliver of water, just enough to keep each bubble's rim readable as its own
// closed shape.
const GAP = 0.06;          // sliver between rims, as a fraction of diameter
const ROW_WIDTH = 0.95;    // how much of the usable width the row may occupy

// ---------------------------------------------------------------------- weld
// ⭐⭐ THE NUMBERS THAT MAKE A MERGE READ AS A MERGE.
//
// All in units of the bubble radius r, so they survive every viewport.
//
// PULL is how much closer two lobes come as they weld. It is not decoration:
// at rest the rims are GAP apart, so two spheres that merely blended in place
// would have to bridge a gap of empty water, and the only way to bridge it is
// with a fat neck that swallows the lobes. Drawing them together until they
// genuinely overlap is both what real coalescing bubbles do and what lets the
// waist stay narrow enough to see two letters in two lobes.
//
// ⛔ JOIN_AT IS DERIVED, NOT CHOSEN. It is the weld amount at which the lobes
// become exactly TANGENT, and it is the handover point: below it the slots are
// drawn as separate films, at and above it one film draws them both. The
// handover is seamless only because tangent-lobes-with-no-fillet is pixel-for-
// pixel the same picture as two spheres touching, so this must stay a
// consequence of GAP and PULL rather than a tuned constant.
const PULL = 0.44;             // lobe pitch lost between w=0 and w=1
const JOIN_AT = (GAP * 2) / PULL;   // ≈ 0.273
// ⭐ Raised from 0.34 once the geodesic landed. A tighter fillet is a smaller
// radius of curvature than anything else on the film, so it is the one place
// tessellation shows - and a fuller neck also reads better as ONE bubble,
// which is what the merge is for.
const NECK_K = 0.46;           // fillet radius at full weld
const WELD_RATE = 3.6;         // per second; ~0.28s to follow the finger
// How completely a merged film moves as ONE body.
//
// ⭐ Why a merged film has to move as one body at all: left on their own
// oscillators, two lobes drift vertically against each other by most of a bob
// amplitude, and the two LETTERS inside drift with them. A rime whose letters
// slide up and down past each other is the opposite of what welding them was
// meant to show.
//
// ⛔ But the fade has to be SLOW, and it has to start at exactly the join
// point. Starting later leaves a step; running faster turns the sync-up itself
// into a lurch, which is the second thing the no-jump test caught. Ramped
// across the entire remaining weld, so the lobes settle into one rhythm over
// the same quarter second the neck takes to open.
const COHERE_AT = 1.0;

export { JOIN_AT };

/** Lobe pitch, in units of r, for a boundary welded by `w`. */
function pitchFor(w) { return 2 * (1 + GAP) - PULL * w; }

/**
 * The STILL distance between the two lobes either side of a boundary, in units
 * of r. 2.12 at rest, exactly 2.0 (tangent) at the join point, 1.68 welded.
 *
 * Exported because the live `pos` of a lobe carries its bob, and the bob is
 * most of a tenth of a radius - so anything asking "are these lobes tangent
 * yet" has to ask the geometry, not the frame.
 */
export function lobePitch(set, boundary) {
  const wd = set.welds[boundary];
  return wd ? pitchFor(wd.w) : null;
}

const smoothstep01 = (a, b, x) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

let unitSphere = null;

/**
 * @param layout array of { x, y, r } - one entry per SLOT. There is no longer
 *               any such thing as a wide slot: width comes from welding
 *               neighbours together at run time, not from the layout.
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
        // ⛔ uLobes is a UNIFORM, never a #define. Welding changes how many
        // lobes a film has several times in a lesson, and a #define would mean
        // a fresh shader program - a visible compile stall on a classroom TV -
        // every time a teacher dragged a finger. As a uniform the program is
        // compiled once and reused for every film.
        uLobe: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
        uLobeR: { value: [1, 1, 1] },
        uNeck: { value: [0, 0, 0] },
        uLobes: { value: 1 },
        uSpin: { value: new THREE.Vector2() },
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
    //
    // ⛔⛔ THE SPHERE'S POLES POINT ALONG X, AND THAT ONE LINE IS THE WHOLE
    // FIX FOR THE FACETED NECK.
    //
    // This vertex shader displaces each direction by a DIFFERENT radius, so
    // where the radius changes fastest the mesh needs its vertices. On a merged
    // film the radius changes fastest across the FILLET - a cone of directions
    // around the X axis, because the lobes are laid out along X and the peanut
    // is therefore a surface of revolution about X.
    //
    // A stock SphereGeometry puts its poles at +Y and -Y and fans long thin
    // triangles out of them, and those fans lie straight across that cone: the
    // merged bubble grew a hard faceted ribbon over the top of its neck and a
    // matching one underneath, at +Y and -Y and nowhere else. Rotating the
    // geometry a quarter turn puts the poles on X instead, where the film is
    // just a spherical cap and nothing is changing - and the latitude rings now
    // run PARALLEL to the fillet, which is the best possible place for them.
    //
    // ⛔ Rotating the GEOMETRY is not the same as rotating the mesh and is safe
    // where that is not: shading here is a function of direction alone, and
    // this changes only which directions get a vertex, not what any direction
    // looks like.
    //
    // ⭐ The segment counts are deliberately lopsided for the same reason.
    // Latitude (across the fillet) is doubled to 96; longitude, which only goes
    // round the axis of revolution where nothing varies, stays at 64.
    //
    // ❗ An icosahedron was tried first and is a trap: three.js subdivides a
    // PolyhedronGeometry face into (detail+1)^2, not 4^detail, so detail 5 is
    // 720 triangles and the bubble came back a visible dodecagon.
    if (!unitSphere) unitSphere = new THREE.SphereGeometry(1, 64, 96).rotateZ(Math.PI / 2);
    const mesh = new THREE.Mesh(unitSphere, mat);
    mesh.position.set(slot.x, slot.y, 0);
    mesh.renderOrder = 10;        // after the dice, so the film sits over them
    mesh.scale.setScalar(r);
    // ⛔ A merged film is a peanut up to three lobes long, and three.js culls a
    // mesh against its GEOMETRY's bounding sphere - the unit sphere's, which
    // knows nothing about the displacement the vertex shader applies. Left on,
    // a wide merged bubble vanishes near the edge of frame.
    mesh.frustumCulled = false;

    group.add(mesh);
    const b = {
      index: i,
      mesh,
      mat,
      r,
      // The slot's place in the LAYOUT - its position with nothing welded. Lobe
      // positions are derived from this and the live weld state every frame.
      base: new THREE.Vector3(slot.x, slot.y, 0),
      // Where the slot actually IS this frame: the centre of its lobe. This is
      // the one position dice, capture and the magnet all read, which is why
      // merging needs no changes anywhere in the physics.
      pos: new THREE.Vector3(slot.x, slot.y, 0),
      home: new THREE.Vector3(slot.x, slot.y, 0),
      phase: Math.random() * Math.PI * 2,
      // Each bubble gets its own drift rates so three of them never pulse in
      // lockstep, which is what makes a row of spheres read as a screensaver.
      rate: 0.58 + Math.random() * 0.34,
      swayRate: 0.41 + Math.random() * 0.28,
      breathRate: 0.33 + Math.random() * 0.22,
      // ⭐ A LIST, not a single slot. A bubble can only legitimately hold one
      // die, but it MUST be able to hold more than one, because the thing that
      // used to happen when it could not was a letter stuck in a bubble
      // forever. See fillBubble() for the full story.
      dice: [],
      // A die that has been accepted and is flying in but has not landed yet.
      // This is what closes the double-capture window - see canAccept().
      inbound: null,
      popping: 0,       // >0 while the pop animation runs; only on a LEAD slot
      popT: 0,
      burstFired: false,
      // Group membership, maintained by regroup(). `lead` is the slot whose
      // mesh draws the film this slot is inside; for an unmerged bubble that is
      // itself. Only a lead carries `members`.
      lead: null,
      members: null,
      lensScale: 1,
      captureR: r * 1.22,
    };
    b.lead = b;
    b.members = [b];
    bubbles.push(b);

    // `b.die` stays readable everywhere it already was (the word check, the tap
    // handler, the debug API) but is now DERIVED, so there is exactly one place
    // the truth lives. Read-only on purpose: an assignment here is what created
    // the orphaned-die bug, and now it throws instead of silently losing a die.
    Object.defineProperty(b, 'die', {
      get() { return this.dice[0] || null; },
      enumerable: true,
    });
  });

  // One weld per BOUNDARY between adjacent slots. `on` is what the teacher has
  // committed to; `target` is what the film is currently animating toward,
  // which during a drag is a live preview of what releasing would do.
  const welds = Array.from({ length: Math.max(0, layout.length - 1) },
    () => ({ w: 0, target: 0, on: false }));

  const set = { group, bubbles, welds, sig: null };
  regroup(set);
  return set;
}

// --------------------------------------------------------------------- groups
/**
 * Rebuild slot → film membership from the weld state.
 *
 * ⛔ Only called when the CONNECTIVITY changes, not every frame. Two slots are
 * in the same film once their weld has passed JOIN_AT, and that is a discrete
 * event - the frame it happens is the frame the shared wall snaps, which is
 * also when the neck FX and the sound fire.
 */
function regroup(set) {
  const { bubbles, welds } = set;
  let i = 0;
  while (i < bubbles.length) {
    let j = i;
    while (j < welds.length && welds[j].w >= JOIN_AT) j++;
    const members = bubbles.slice(i, j + 1);
    const lead = members[0];
    lead.members = members;
    for (const m of members) {
      m.lead = lead;
      if (m !== lead) {
        m.members = null;
        // Membership moved; anything the old film was animating is now the
        // lead's business, so make sure a stale pop cannot linger here.
        m.popping = 0;
        m.popT = 0;
        m.mesh.visible = false;
      }
    }
    lead.mesh.visible = true;
    i = j + 1;
  }
}

/** The films currently on screen, as lead slots. */
export function films(set) {
  return set.bubbles.filter(b => b.lead === b);
}

/** Every die inside the film `b` belongs to, whichever lobe it is in. */
export function filmDice(b) {
  const out = [];
  for (const m of b.lead.members) for (const d of m.dice) out.push(d);
  return out;
}

/** How many slots the film `b` belongs to wraps. 1 for an ordinary bubble. */
export function filmSpan(b) { return b.lead.members.length; }

// ---------------------------------------------------------------------- welds
/**
 * Point every weld at what it should be animating toward.
 *
 * `preview` is the live result of a finger that is still down: the boundaries
 * it spans and whether it is welding or unwelding them. Pass null and the welds
 * simply return to what the teacher has committed, which is what happens when a
 * drag is abandoned.
 */
export function aimWelds(set, preview = null) {
  set.welds.forEach((wd, k) => {
    const inPreview = preview && preview.bs.includes(k);
    wd.target = inPreview ? (preview.on ? 1 : 0) : (wd.on ? 1 : 0);
  });
}

/** Commit a preview, so releasing the finger makes it stick. */
export function commitWelds(set, preview) {
  if (preview) for (const k of preview.bs) set.welds[k].on = preview.on;
  aimWelds(set, null);
}

/** Committed weld state as plain booleans - what the gesture reducer reads. */
export function weldState(set) { return set.welds.map(w => w.on); }

/**
 * Advance the weld animation, and report any boundary that crossed the join
 * point this frame. A crossing is the moment the shared wall between two
 * bubbles snaps (or re-forms), which is the one instant that wants a sound and
 * a ring of film at the neck.
 */
function stepWelds(set, dt) {
  const events = [];
  for (let k = 0; k < set.welds.length; k++) {
    const wd = set.welds[k];
    if (wd.w === wd.target) continue;
    const was = wd.w;
    const step = WELD_RATE * dt;
    wd.w = wd.target > wd.w ? Math.min(wd.target, wd.w + step)
                            : Math.max(wd.target, wd.w - step);
    if (was < JOIN_AT && wd.w >= JOIN_AT) events.push({ boundary: k, joined: true });
    else if (was >= JOIN_AT && wd.w < JOIN_AT) events.push({ boundary: k, joined: false });
  }
  return events;
}

/**
 * Where every slot in the row sits, in units of r, measured from the row's
 * centre. Positions are built by WALKING THE BOUNDARIES, because each boundary
 * welds on its own clock: a teacher can weld the rime, then weld the onset onto
 * it a minute later, and the two necks will be at different stages.
 *
 * ⛔⛔ THIS IS THE WHOLE ROW, NOT ONE FILM, AND THAT IS NOT AN OPTIMISATION.
 *
 * The first version computed offsets per film, which meant a boundary's pull
 * did nothing at all until the film formed - and then the lobes snapped inward
 * by the entire gap in one frame. Measured at 0.6 world units on a 4.1 radius:
 * a visible twitch of the letters at the exact moment the bubble merged, and
 * the opposite of the seamless handover the tangency maths was designed for.
 *
 * Walking the whole row makes the pull continuous: two bubbles LEAN together
 * all through the gesture, arrive touching, and only then become one film.
 * The lean is also the live feedback - a teacher sees the merge coming before
 * lifting their finger.
 *
 * ⭐ Recentred, so a row that gets shorter stays under the middle of the
 * camera instead of growing a bald patch on one side.
 */
function rowOffsets(set) {
  const n = set.bubbles.length;
  const xs = [0];
  for (let k = 0; k < n - 1; k++) xs.push(xs[k] + pitchFor(set.welds[k].w));
  const mid = (xs[0] + xs[n - 1]) / 2;
  for (let k = 0; k < n; k++) xs[k] -= mid;
  return xs;
}

/** How completely a film moves as one body: 0 the instant it joins, 1 welded. */
function coherence(set, lead) {
  const n = lead.members.length;
  if (n < 2) return 1;
  let minW = 1;
  for (let k = 0; k < n - 1; k++) minW = Math.min(minW, set.welds[lead.index + k].w);
  return smoothstep01(JOIN_AT, COHERE_AT, minW);
}

/** The idle oscillation of one slot: rise, sway and breathe. */
function motionOf(b, t, m) {
  return {
    bob: (Math.sin(t * b.rate + b.phase) * 0.30
        + Math.sin(t * b.rate * 2.37 + b.phase * 1.9) * 0.09) * m,
    sway: (Math.cos(t * b.swayRate + b.phase * 1.3) * 0.22
         + Math.sin(t * b.swayRate * 1.71 + b.phase) * 0.07) * m,
    breathe: Math.sin(t * b.breathRate + b.phase * 2.1) * 0.022 * m,
  };
}

/**
 * Idle life, and the merge. Four independent slow oscillations per film - rise,
 * sway, breathe and a drifting highlight - at rates that are prime-ish to each
 * other so the motion never visibly loops. This is what separates "suspended in
 * water" from "balloon on a string".
 */
export function updateBubbles(set, t, dt, reducedMotion = false, fx = null) {
  const { bubbles, welds } = set;

  const joins = stepWelds(set, dt);
  // Connectivity is cheap to fingerprint and changes a handful of times per
  // lesson, so regroup only runs when it actually differs.
  const sig = welds.map(w => (w.w >= JOIN_AT ? 1 : 0)).join('');
  if (sig !== set.sig) {
    set.sig = sig;
    regroup(set);
  }
  // A ring of film where the wall between the two bubbles let go. Fired after
  // regroup so the neck position is read off the film that now exists.
  for (const ev of joins) {
    const a = bubbles[ev.boundary], b = bubbles[ev.boundary + 1];
    if (fx) fx.burst((a.pos.x + b.pos.x) / 2, (a.pos.y + b.pos.y) / 2, a.r * 0.40);
  }

  const m = reducedMotion ? 0.25 : 1;

  // One walk of the row per frame; every film reads its own slice of it.
  const row = rowOffsets(set);
  const rowCx = (bubbles[0].base.x + bubbles[bubbles.length - 1].base.x) / 2;

  for (const lead of bubbles) {
    if (lead.lead !== lead) continue;
    const members = lead.members;
    const r = lead.r;
    const i = lead.index, j = i + members.length - 1;
    // The film's still centre is the midpoint of its outermost LOBES, so the
    // film sits over its own letters however the row has been squeezed.
    const mid = (row[i] + row[j]) / 2;
    const offs = members.map((_, k) => row[i + k] - mid);
    const coh = coherence(set, lead);

    const cx = rowCx + mid * r;
    const cy = members[0].base.y;
    lead.home.set(cx, cy, 0);

    const lm = motionOf(lead, t, m);
    const popping = lead.popping > 0;

    if (popping) {
      stepPop(lead, dt, fx, offs, members);
    } else {
      lead.mesh.position.set(cx + lm.sway, cy + lm.bob, 0);
      // Surface tension breathing - a real bubble is never perfectly spherical.
      // Volume-preserving-ish: it widens as it flattens, which reads as a
      // membrane under tension rather than a pulsing ball.
      lead.mesh.scale.set(r * (1 + lm.breathe), r * (1 - lm.breathe), r * (1 + lm.breathe * 0.4));
      // Slow orientation drift makes the iridescence shift as the film moves,
      // which is most of what sells a soap film. Fed to the SHADER, not to the
      // transform - see uSpin. The mesh itself never turns.
      lead.mat.uniforms.uSpin.value.set(
        Math.sin(t * 0.21 + lead.phase) * 0.5 * m,
        Math.cos(t * 0.17 + lead.phase * 1.4) * 0.22 * m);
    }

    // ---- lobes -------------------------------------------------------------
    // ⭐ Each lobe keeps its OWN bob until the film is coherent, and that is
    // the whole reason the handover frame does not flinch. At the instant a
    // boundary passes JOIN_AT, coherence is 0, so every lobe is still sitting
    // exactly where its own separate bubble was sitting the frame before. The
    // film only takes over the motion as the weld completes.
    const u = lead.mat.uniforms;
    const sx = lead.mesh.scale.x || 1, sy = lead.mesh.scale.y || 1;
    for (let k = 0; k < members.length; k++) {
      const b = members[k];
      const own = motionOf(b, t, m);
      const ex = popping ? 0 : (own.sway - lm.sway) * (1 - coh);
      const ey = popping ? 0 : (own.bob - lm.bob) * (1 - coh);
      const wx = offs[k] * r + ex, wy = ey;
      b.pos.set(lead.mesh.position.x + wx, lead.mesh.position.y + wy, 0);
      u.uLobe.value[k].set(wx / sx, wy / sy, 0);
      u.uLobeR.value[k] = 1;
      // The fillet opens from nothing at the join point, so a freshly joined
      // film starts as two tangent spheres and the neck grows from there.
      u.uNeck.value[k] = k === 0 ? 0
        : NECK_K * smoothstep01(JOIN_AT, 1, welds[lead.index + k - 1].w);
      if (b !== lead) b.mesh.visible = false;
    }
    for (let k = members.length; k < 3; k++) u.uLobe.value[k].set(0, 0, 0);
    u.uLobes.value = members.length;
    u.uTime.value = t;
    u.uFill.value = members.some(b => b.dice.length) ? 1 : 0;

    if (popping) continue;

    // ⭐ The bubble acts as a LENS: the die inside reads magnified, as it
    // would through a curved film. Pure presentation - the capture radius and
    // the tap target are unchanged, so gameplay is untouched.
    for (const b of members) {
      for (let k = 0; k < b.dice.length; k++) {
        const die = b.dice[k];
        // Any die past the first is a letter that should not be in here. Rather
        // than stack it exactly on top of the first - which is what made the old
        // bug invisible until a teacher popped the bubble and a letter stayed
        // behind - fan it off to one side so it is plainly VISIBLE as a second
        // letter. A glitch a teacher can see and pop is a far smaller problem
        // than one that silently eats a die.
        const off = k === 0 ? 0 : b.r * 0.42 * (k % 2 ? 1 : -1) * Math.ceil(k / 2);
        die.position.set(b.pos.x + off, b.pos.y, 0.1 + k * 0.02);
        // Settle: a quick, slightly over-damped pop to full size as it locks.
        const ud = die.userData;
        if (ud.settle !== undefined && ud.settle < 1) {
          ud.settle = Math.min(1, ud.settle + dt * 4.4);
          const e = ud.settle;
          const over = 1 + Math.sin(e * Math.PI) * 0.09;   // tiny overshoot
          die.scale.setScalar(b.lensScale * (0.55 + 0.45 * e) * over);
        } else {
          die.scale.setScalar(b.lensScale);
        }
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
 * ⭐ Can this SLOT receive a die right now?
 *
 * A popping bubble used to refuse everything for the whole 0.76s sequence, so a
 * teacher who popped and immediately re-threw watched the die sail through and
 * drop back for no visible reason. Once the bubble has started REFORMING it is
 * already on screen and already at its home position, so it can accept - and
 * since a throw takes about 0.6s to arrive anyway, the die lands into a bubble
 * that is whole by the time it gets there.
 *
 * ⛔ The pop state is read from the slot's FILM, not from the slot. A merged
 * bubble pops as one object, so both its lobes have to refuse together - a
 * version that checked only the slot let a die be thrown into the far lobe of a
 * bubble that was in the middle of bursting.
 */
export function canAccept(b) {
  if (b.dice.length) return false;
  // ⛔ AND NOT ALREADY CLAIMED. `dice` is only filled when the suck-in
  // animation FINISHES, 0.26s after the bubble agrees to take the die. For that
  // 0.26s the bubble used to still answer "yes" to everyone, so two letters
  // flung at the same slot together were both accepted - and the second one to
  // land overwrote the first, which stayed on screen, locked, referenced by
  // nothing, and impossible to pop out. `inbound` closes that window.
  if (b.inbound) return false;
  const lead = b.lead;
  if (lead.popping <= 0) return true;
  return lead.popT >= T_REFORM_AT;
}

/**
 * Claim a bubble for a die that is on its way in. Called the instant the bubble
 * agrees to take it, so no second die can be accepted into the same slot.
 */
export function reserveBubble(b, die) {
  b.inbound = die;
}

/**
 * Advance one film's pop. Four phases, all driven off a single clock so the
 * sequence cannot desynchronise.
 *
 * ⛔ The slots are released by popBubble() at the START, not here. The letters
 * are available again immediately, so a teacher mid-chain never waits on an
 * animation - the burst is decoration over an already-completed state change.
 */
function stepPop(lead, dt, fx, offs, members) {
  lead.popT += dt;
  const t = lead.popT;
  const r = lead.r;
  const u = lead.mat.uniforms;

  if (t < T_ANTICIPATE) {
    // Anticipation: a quick inward squeeze and a visible tightening of the rim.
    const k = t / T_ANTICIPATE;
    const squeeze = 1 - Math.sin(k * Math.PI) * 0.065;
    const wobble = Math.sin(k * Math.PI * 3.0) * 0.022;
    lead.mesh.scale.set(r * (squeeze + wobble), r * (squeeze - wobble), r * squeeze);
    u.uTension.value = k;
    u.uPop.value = 0;
    return false;
  }

  if (t < T_ANTICIPATE + T_RUPTURE) {
    // Burst: elastic expansion while the film tears open.
    const k = (t - T_ANTICIPATE) / T_RUPTURE;
    const grow = 1 + Math.pow(k, 0.55) * 0.30;
    lead.mesh.scale.setScalar(r * grow);
    u.uTension.value = 1 - k;
    u.uPop.value = k;
    if (!lead.burstFired) {
      lead.burstFired = true;
      // Ring and droplets launch at the moment of rupture, from the film's
      // position at that instant - not from where the bubble started.
      // ⭐ ONE BURST PER LOBE. A merged bubble is a long membrane and a single
      // ring at its centre left the two ends looking as though nothing had
      // happened to them.
      if (fx) {
        for (let k2 = 0; k2 < members.length; k2++) {
          fx.burst(lead.mesh.position.x + offs[k2] * r, lead.mesh.position.y, r * 1.08);
        }
      }
    }
    return false;
  }

  if (t < T_ANTICIPATE + T_RUPTURE + T_EMPTY) {
    lead.mesh.visible = false;
    u.uPop.value = 1;
    u.uFill.value = 0;
    return false;
  }

  // Reform: eases back in at the EXACT home position, empty and ready. Slight
  // overshoot so it arrives with a little surface tension rather than a fade-in.
  const k = Math.min(1, (t - T_ANTICIPATE - T_RUPTURE - T_EMPTY) / T_REFORM);
  lead.mesh.visible = true;
  u.uPop.value = 0;
  u.uTension.value = 0;
  const e = 1 - Math.pow(1 - k, 3);
  const over = 1 + Math.sin(k * Math.PI) * 0.11;
  lead.mesh.scale.setScalar(r * e * over);
  lead.mesh.position.copy(lead.home);

  if (t >= T_TOTAL) {
    lead.popping = 0;
    lead.popT = 0;
    lead.burstFired = false;
    lead.mesh.scale.setScalar(r);
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
  // Each bubble owns its ShaderMaterial (its uniforms carry per-film state).
  // The unit sphere is shared and deliberately kept.
  for (const b of set.bubbles) b.mat.dispose();
  set.group.clear();
}

export function resizeBubbles(set, layout) {
  set.bubbles.forEach((b, i) => {
    const slot = layout[i];
    if (!slot) return;
    b.r = slot.r;
    b.base.set(slot.x, slot.y, 0);
    b.home.copy(b.base);
    b.pos.copy(b.base);
    b.captureR = b.r * 1.22;
    b.mesh.position.copy(b.base);
    b.mesh.scale.setScalar(b.r);
    // Every held die has to be re-fitted to the new bubble size too.
    if (b.dice.length) {
      const want = b.r * 0.86;
      b.lensScale = Math.min(2.2, Math.max(0.42, want / (DIE_SIZE * 0.75)));
      for (const die of b.dice) die.userData.settle = 1;
    }
  });
  // Welds survive a resize - a teacher who has merged the rime does not expect
  // a rotated tablet to take it apart - but the film geometry is all in units
  // of r, so the next update() simply rebuilds it at the new size.
  set.sig = null;
}

export function fillBubble(b, die) {
  // ⭐ PUSH, never overwrite.
  //
  // The old line here was `b.die = die`, and that single assignment was the
  // whole bug a week of classroom use turned up: fling two letters at one
  // bubble and the second one to land replaced the first. The replaced die was
  // left in state 'captured' - no case in the main loop's switch, so never
  // updated - sitting inside the film at full lens scale, with nothing holding
  // a reference to it. popBubble() returned only `b.die`, so popping freed the
  // newcomer and the original stayed in there for the rest of the session.
  //
  // canAccept() now makes a double arrival essentially impossible, but this
  // stays a list anyway: entry is guarded by timing, and timing is exactly the
  // kind of guard that a future change quietly breaks. A list cannot lose a
  // die even if something does get through.
  if (!b.dice.includes(die)) b.dice.push(die);
  if (b.inbound === die) b.inbound = null;
  b.lead.mat.uniforms.uFill.value = 1;
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
  // Per-DIE, so a second die settles on its own clock instead of resetting the
  // first one's animation.
  die.userData.settle = 0.001;                   // drives the settle pop-in
}

/**
 * Start the pop.
 *
 * ⭐ RELEASES EVERYTHING THE FILM IS HOLDING, and returns all of it. Popping
 * is the one gesture that is guaranteed to empty a bubble - whatever is in
 * there comes out, however it got in. That rule came out of a week of classroom
 * use, and it is the reason a stuck letter can no longer survive a pop even if
 * some future change lets two in again.
 *
 * ⭐ A MERGED BUBBLE POPS AS ONE BUBBLE. Tap a welded rime and both letters
 * come home, because what is on screen is one membrane and popping it has to do
 * what it looks like it does. A teacher who wants to change just the vowel
 * splits the bubble first - the gesture that merged it also takes it apart.
 *
 * Returns an ARRAY. Callers send every die home.
 */
export function popBubble(b) {
  const lead = b.lead;
  const released = [];
  for (const m of lead.members) {
    for (const die of m.dice) released.push(die);
    m.dice.length = 0;
    // An inbound die is NOT released - it has not arrived, and it is still
    // mid-flight under its own animation. Dropping the claim is enough: the
    // bubble will be reforming by the time it lands, and canAccept() allows that.
    m.inbound = null;
  }
  for (const die of released) {
    // Undo the lens magnification before the die flies home, or it would return
    // to the bay at twice the size of its neighbours.
    die.scale.setScalar(1);
    die.userData.settle = undefined;
  }
  lead.popping = 1;
  lead.popT = 0;
  lead.burstFired = false;
  return released;
}

/** Which slot, if any, is close enough to swallow a die at `p`. */
export function bubbleAt(set, p, slotFilter = null) {
  for (const b of set.bubbles) {
    if (!canAccept(b)) continue;
    if (slotFilter !== null && b.index !== slotFilter) continue;
    const dx = p.x - b.pos.x;
    const dy = p.y - b.pos.y;
    if (dx * dx + dy * dy <= b.captureR * b.captureR) return b;
  }
  return null;
}

/**
 * Nearest slot to `p`, within `margin` lobe-radii. Used for both the tap that
 * pops and the drag that welds, so the two gestures agree exactly about which
 * bubble the finger is on.
 *
 * ⭐ NEAREST, not first. Now that the rims nearly touch, the forgiveness
 * margins overlap - and returning the first match meant a tap in the overlap
 * always popped the left-hand bubble, even when the finger was clearly on the
 * right-hand one. Mid-chain that silently destroys the wrong letter.
 */
export function slotAt(set, p, margin = 1.12) {
  let best = null, bestD = Infinity;
  for (const b of set.bubbles) {
    if (b.lead.popping > 0) continue;
    const dx = p.x - b.pos.x;
    const dy = p.y - b.pos.y;
    const d = (dx * dx + dy * dy) / (b.r * b.r);
    if (d <= margin && d < bestD) { best = b; bestD = d; }
  }
  return best;
}

/** Hit test for a tap - used for popping. Tighter than the drag's reach. */
export function bubbleHit(set, p) {
  return slotAt(set, p, 1.12);
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
 * time. `ROW_WIDTH` is how much of the width the bubble row occupies.
 *
 * The old code derived the radius from the pitch and then capped it, which meant
 * the cap silently pushed them apart again on a wide screen. This derives the
 * PITCH FROM THE RADIUS, so the gap is whatever GAP says it is, always.
 */
export function layoutFor(slots, bounds, y) {
  // Radius is limited by two things: how much width the row may take, and how
  // much height there is between the bubble row and the top of frame.
  const byWidth = (bounds.x * 2 * ROW_WIDTH) / (slots * 2 * (1 + GAP));
  const byHeight = (bounds.y - y) * 0.92;
  const r = Math.min(BUBBLE_R_MAX, byWidth, byHeight);

  const pitch = 2 * r * (1 + GAP);
  const w = (slots - 1) * pitch;
  return Array.from({ length: slots }, (_, i) => ({
    x: -w / 2 + i * pitch,
    y,
    r,
  }));
}
