// ----------------------------------------------------------------------- dice
// A letter die. Blue for consonants, red for vowels.
//
// ⛔ THE ORIENTATION CONSTRAINT IS THE LOAD-BEARING PART OF THIS FILE.
//
// A die that tumbles freely will, at some point in its arc, show a `b` as a `d`,
// a `p` as a `q`, or an `m` as a `w`. For a child who is still building
// grapheme-phoneme correspondence that is not a cosmetic glitch - it actively
// teaches the confusion the whole lesson is trying to prevent. So:
//
//   * ROLL (rotation about the view axis, Z) is clamped to near zero, ALWAYS,
//     including mid-flight. Roll is the axis that turns b into q and m into w.
//   * PITCH (X) and YAW (Y) are allowed a gentle wobble. Neither can mirror a
//     glyph; they only foreshorten it, which stays readable.
//   * The wobble is sinusoidal and bounded, never integrated from a velocity,
//     so it cannot drift past its limit no matter how long a session runs.
//
// If you ever add "satisfying" tumbling to a flick, you have broken the app.

import * as THREE from '../vendor/three.module.js';
import { glyphCanvas, VOWELS } from './letterforms.js';

export const DIE_SIZE = 1.45;

// Hard caps, in radians. Chosen by what stays unambiguous at a classroom
// viewing distance on a large panel, not by what looks most dynamic.
const MAX_PITCH = 0.14;   // ~8 degrees, tilt toward/away from the reader
const MAX_YAW   = 0.17;   // ~10 degrees, turn left/right
const MAX_ROLL  = 0.028;  // ~1.6 degrees - a hint of life, never a mirror

// Palette. Consonants are a deep toy-blue that sits INSIDE the water's own
// hue family, so they read as belonging to the world; vowels are a warm coral
// that is the scene's only strong warm note at this scale, which is what makes
// the vowel position instantly findable across a classroom.
const CONSONANT_COLOR = 0x2563c9;
const VOWEL_COLOR     = 0xef4d52;

const texCache = new Map();

/**
 * Die-face texture. Built at high resolution with a painted inner bevel, so the
 * face reads as a moulded toy tile rather than a flat colour with a decal.
 */
function faceTexture(ch, hex) {
  const key = ch + ':' + hex;
  if (texCache.has(key)) return texCache.get(key);

  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');

  const base = new THREE.Color(hex);
  const lit  = base.clone().offsetHSL(0, 0.03, 0.14);
  const deep = base.clone().offsetHSL(0, 0.02, -0.14);

  // Body: light falling from upper-left, as the key light does.
  const grd = g.createLinearGradient(0, 0, S * 0.35, S);
  grd.addColorStop(0, '#' + lit.getHexString());
  grd.addColorStop(0.55, '#' + base.getHexString());
  grd.addColorStop(1, '#' + deep.getHexString());
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);

  // Painted bevel: a bright inner edge top-left, a dark one bottom-right. This
  // is what gives the tile its moulded, tactile look at a glance.
  const inset = S * 0.055;
  g.lineWidth = S * 0.045;
  g.strokeStyle = 'rgba(255,255,255,0.30)';
  g.beginPath();
  g.moveTo(inset, S - inset); g.lineTo(inset, inset); g.lineTo(S - inset, inset);
  g.stroke();
  g.strokeStyle = 'rgba(0,0,0,0.26)';
  g.beginPath();
  g.moveTo(S - inset, inset); g.lineTo(S - inset, S - inset); g.lineTo(inset, S - inset);
  g.stroke();

  // Soft sheen across the upper third.
  const sheen = g.createRadialGradient(S * 0.34, S * 0.2, 0, S * 0.34, S * 0.2, S * 0.62);
  sheen.addColorStop(0, 'rgba(255,255,255,0.20)');
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = sheen;
  g.fillRect(0, 0, S, S);

  // The glyph, from the shared school-print centrelines. A dark blurred halo
  // goes down first: plain white-on-blue washed out once the material lighting
  // dimmed the face, and these letters must carry across a classroom.
  const glyph = glyphCanvas(ch, S, 26);
  g.save();
  g.globalAlpha = 0.55;
  g.filter = 'blur(9px)';
  g.globalCompositeOperation = 'multiply';
  g.drawImage(glyph, 0, 0);
  g.restore();
  g.drawImage(glyph, 0, 0);

  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 16;
  tex.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, tex);
  return tex;
}

/**
 * A box with rounded edges. three.js core has no RoundedBoxGeometry (that lives
 * in examples/, which we do not vendor), so we round a segmented box by pushing
 * each vertex onto a rounded-cube surface. Face groups and UVs survive, which is
 * what lets the letter still map to face 4 alone.
 */
function roundedBox(size, radius, seg = 9) {
  const geo = new THREE.BoxGeometry(size, size, size, seg, seg, seg);
  const pos = geo.attributes.position;
  const h = size / 2;
  const inner = h - radius;
  const v = new THREE.Vector3();
  const q = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    q.set(
      THREE.MathUtils.clamp(v.x, -inner, inner),
      THREE.MathUtils.clamp(v.y, -inner, inner),
      THREE.MathUtils.clamp(v.z, -inner, inner)
    );
    v.sub(q).normalize().multiplyScalar(radius).add(q);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

let sharedGeo = null;

export function createDie(ch) {
  const isVowel = VOWELS.includes(ch);
  const hex = isVowel ? VOWEL_COLOR : CONSONANT_COLOR;

  if (!sharedGeo) {
    sharedGeo = roundedBox(DIE_SIZE, DIE_SIZE * 0.19);
    // ⭐ A BoxGeometry has six material groups, and three.js issues one draw
    // call PER GROUP - so every die cost six calls even though it only uses two
    // materials. The lettered face is group 4 (+z), so collapsing the five plain
    // faces into the runs either side of it takes a die from 6 calls to 3.
    const groups = sharedGeo.groups.slice();
    const letterGroup = groups[4];
    const before = letterGroup.start;
    const after = letterGroup.start + letterGroup.count;
    const total = groups.reduce((n, g) => n + g.count, 0);
    sharedGeo.clearGroups();
    if (before > 0) sharedGeo.addGroup(0, before, 0);
    sharedGeo.addGroup(before, letterGroup.count, 1);
    if (total > after) sharedGeo.addGroup(after, total - after, 0);
  }

  // Clearcoat is what makes these read as moulded plastic toys rather than
  // matte blocks: a second specular lobe over a slightly rough body.
  const plain = new THREE.MeshPhysicalMaterial({
    color: hex, roughness: 0.42, metalness: 0.0,
    clearcoat: 0.85, clearcoatRoughness: 0.18,
    sheen: 0.3, sheenColor: new THREE.Color(0x9fd8ff),
  });
  const letterTex = faceTexture(ch, hex);
  const lettered = new THREE.MeshPhysicalMaterial({
    map: letterTex, roughness: 0.36, metalness: 0.0,
    clearcoat: 0.9, clearcoatRoughness: 0.14,
    // The face is also its own emissive map, so the glyph stays bright no
    // matter where the key light happens to be. Legibility beats realism.
    emissive: 0xffffff, emissiveMap: letterTex, emissiveIntensity: 0.34,
  });

  // Two materials now, indexed by the collapsed groups above: 0 = plain body,
  // 1 = the lettered +z face the reader sees.
  const mats = [plain, lettered];

  const mesh = new THREE.Mesh(sharedGeo, mats);
  mesh.userData = {
    ch,
    isVowel,
    // Per-die phase so a bay full of dice does not pulse in unison, which
    // reads as a screensaver rather than as objects.
    phase: Math.random() * Math.PI * 2,
    wobbleScale: 1,
    state: 'bay',          // bay | flying | captured | returning
    home: new THREE.Vector3(),
    slot: null,            // which bubble index it is locked into
  };
  return mesh;
}

/**
 * Apply the bounded wobble. `scale` lets a captured die settle to stillness
 * (0) or a flying die look a little more energetic (up to ~1.6) WITHOUT ever
 * escaping the roll clamp.
 */
export function applyWobble(die, t, camZ = 0) {
  const u = die.userData;
  const s = u.wobbleScale;
  if (s <= 0.001) {
    // Captured dice are square to the reader. This is deliberate: the locked
    // word must be the most legible thing on screen.
    //
    // The yaw term is perspective compensation, not decoration. A magnified die
    // parked near the left or right edge is seen from an angle by a centred
    // perspective camera, and its letter foreshortens. Turning it partway back
    // toward the camera recovers the legibility while keeping enough of the
    // angle to read as a solid object. Yaw is a SAFE axis - it cannot mirror a
    // glyph, only foreshorten it - so this does not touch the roll clamp.
    const yaw = camZ ? -Math.atan2(die.position.x, camZ) * 0.62 : 0;
    die.rotation.set(0, yaw, 0);
    return;
  }
  const p = u.phase;
  die.rotation.x = Math.sin(t * 0.9 + p) * MAX_PITCH * s;
  die.rotation.y = Math.sin(t * 0.67 + p * 1.7) * MAX_YAW * s;
  die.rotation.z = Math.sin(t * 0.53 + p * 2.3) * MAX_ROLL * s;
}

/**
 * Dev assertion: nothing may ever leave a die rotated far enough to mirror a
 * glyph. Called from the main loop behind a debug flag.
 */
export function assertReadable(die) {
  const r = die.rotation;
  const bad = Math.abs(r.z) > MAX_ROLL * 2.2 ||
              Math.abs(r.x) > MAX_PITCH * 2.2 ||
              Math.abs(r.y) > MAX_YAW * 2.2;
  if (bad) {
    console.error('[bubblecvc] die orientation exceeded the readability clamp',
      die.userData.ch, r.x.toFixed(3), r.y.toFixed(3), r.z.toFixed(3));
  }
  return !bad;
}

/**
 * Release a die's GPU resources.
 *
 * ⛔ The shared rounded-box geometry and the cached face textures are NOT
 * disposed - they are reused by every die in every session, and tearing them
 * down here would force a rebuild of all 26 glyph canvases each time a teacher
 * returns to the setup screen. Only the per-die materials are owned by the die.
 */
export function disposeDie(die) {
  const mats = Array.isArray(die.material) ? die.material : [die.material];
  for (const m of mats) if (m && m.dispose) m.dispose();
}

// ------------------------------------------------------------------ the bay
// Three columns: onset consonants, vowels, coda consonants. The columns are
// the activity's grammar made physical - left to right IS the word order, so a
// child reaches left-to-right to build left-to-right.

export const COLUMN = { ONSET: 0, VOWEL: 1, CODA: 2 };

/**
 * Lay the chosen letters out in the bay. Each column wraps into rows if the
 * teacher picked a lot of letters, growing upward from the bay floor.
 */
export function layoutBay(sets, bounds, bayTop) {
  const gap = DIE_SIZE * 0.42;
  const pitch = DIE_SIZE + gap;
  const colWidth = bounds.x * 2 / 3;
  const placements = [];

  sets.forEach((letters, col) => {
    if (!letters.length) return;
    // Keep each column inside its third of the screen, with a margin so the
    // onset and coda columns never visually merge with the vowels.
    const usable = colWidth - DIE_SIZE * 1.2;
    const perRow = Math.max(1, Math.min(letters.length, Math.floor(usable / pitch)));
    const rows = Math.ceil(letters.length / perRow);
    const centerX = -bounds.x + colWidth * (col + 0.5);

    letters.forEach((ch, i) => {
      const row = Math.floor(i / perRow);
      const idxInRow = i % perRow;
      const countInRow = Math.min(perRow, letters.length - row * perRow);
      const rowW = (countInRow - 1) * pitch;
      placements.push({
        ch,
        col,
        x: centerX - rowW / 2 + idxInRow * pitch,
        y: bayTop - DIE_SIZE / 2 - row * pitch,
        z: 0,
      });
    });
  });

  return placements;
}
