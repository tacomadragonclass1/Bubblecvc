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

const bubbleVert = /* glsl */`
  varying vec3 vNormalW;
  varying vec3 vViewW;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewW = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const bubbleFrag = /* glsl */`
  precision highp float;
  varying vec3 vNormalW;
  varying vec3 vViewW;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uPop;      // 0 = whole, 1 = fully popped
  uniform float uFill;     // 0 = empty, 1 = holding a letter
  uniform vec3  uTint;

  // Thin-film interference, approximated: map the fresnel term through a few
  // offset cosines to get the oily rainbow a soap film actually shows.
  vec3 filmColor(float t) {
    return 0.5 + 0.5 * cos(6.28318 * (vec3(0.0, 0.33, 0.67) + t));
  }

  void main() {
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(vViewW);
    float f = 1.0 - abs(dot(N, V));          // 0 face-on, 1 at the silhouette

    // Interference bands tighten toward the rim and drift slowly.
    float band = f * 3.1 + uTime * 0.06 + vUv.y * 0.6;
    vec3 film = filmColor(band);

    float rim = pow(f, 2.1);
    float alpha = clamp(rim * 0.92 + 0.07, 0.0, 1.0);

    // A moving highlight sells the curvature more than any amount of shading.
    vec2 hp = vUv - vec2(0.32 + sin(uTime * 0.3) * 0.02, 0.72);
    float spec = exp(-dot(hp, hp) * 190.0);

    vec3 col = film * (0.42 + rim * 0.75) + uTint * 0.22;
    col += vec3(1.0) * spec * 0.85;

    // A filled bubble glows a touch so a built word reads as settled.
    col += uTint * uFill * 0.18;
    alpha += spec * 0.5 + uFill * 0.07;

    // Popping: the film thins and blows out just before it vanishes.
    alpha *= (1.0 - uPop);
    col += vec3(1.0) * uPop * 0.6;

    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

export const BUBBLE_R = 2.15;

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
        uFill: { value: 0 },
        uTint: { value: new THREE.Color(0.55, 0.85, 1.0) },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
    });

    const mesh = new THREE.Mesh(new THREE.SphereGeometry(BUBBLE_R, 42, 32), mat);
    mesh.position.set(slot.x, slot.y, 0);
    mesh.renderOrder = 10;        // after the dice, so the film sits over them
    // A merged bubble is a stretched sphere, not a bigger one: the height must
    // match its neighbours or the row stops reading as a single word.
    const span = slot.span || 1;
    mesh.scale.set(span === 1 ? 1 : 1.62, 1, 1);

    group.add(mesh);
    bubbles.push({
      index: i,
      mesh,
      mat,
      span,
      home: new THREE.Vector3(slot.x, slot.y, 0),
      phase: Math.random() * Math.PI * 2,
      die: null,        // the die locked inside
      popping: 0,       // >0 while the pop animation runs
      captureR: BUBBLE_R * (span === 1 ? 1.5 : 2.1),
    });
  });

  return { group, bubbles };
}

/** Gentle idle bob. Each bubble drifts on its own phase. */
export function updateBubbles(bubbles, t, dt) {
  for (const b of bubbles) {
    b.mat.uniforms.uTime.value = t;

    if (b.popping > 0) {
      b.popping = Math.min(1, b.popping + dt * 4.2);
      b.mat.uniforms.uPop.value = b.popping;
      const s = 1 + b.popping * 0.45;
      b.mesh.scale.set((b.span === 1 ? 1 : 1.62) * s, s, s);
      if (b.popping >= 1) {
        // Reform, empty, after a beat. The bubble always comes back - there is
        // no state in which a slot is simply gone, because a teacher mid-chain
        // must always be able to refill the position she just cleared.
        b.popping = 0;
        b.mat.uniforms.uPop.value = 0;
        b.mat.uniforms.uFill.value = 0;
        b.mesh.scale.set(b.span === 1 ? 1 : 1.62, 1, 1);
      }
      continue;
    }

    const bob = Math.sin(t * 0.72 + b.phase) * 0.17;
    const sway = Math.cos(t * 0.48 + b.phase * 1.3) * 0.11;
    b.mesh.position.set(b.home.x + sway, b.home.y + bob, 0);

    // A held die rides with its bubble, dead centre and perfectly square.
    if (b.die) {
      b.die.position.set(b.mesh.position.x, b.mesh.position.y, 0.08);
    }
  }
}

export function fillBubble(b, die) {
  b.die = die;
  b.mat.uniforms.uFill.value = 1;
  die.userData.state = 'captured';
  die.userData.slot = b.index;
  die.userData.wobbleScale = 0;    // stop wobbling: locked letters are still
}

/** Start the pop. Returns the die that was inside, so the caller can send it home. */
export function popBubble(b) {
  const die = b.die;
  b.die = null;
  b.popping = 0.001;
  return die;
}

/** Which bubble, if any, is close enough to swallow a die at `p`. */
export function bubbleAt(bubbles, p, slotFilter = null) {
  for (const b of bubbles) {
    if (b.die || b.popping > 0) continue;
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
    const rx = BUBBLE_R * (b.span === 1 ? 1 : 1.62);
    if ((dx * dx) / (rx * rx) + (dy * dy) / (BUBBLE_R * BUBBLE_R) <= 1.08) return b;
  }
  return null;
}

/**
 * Bubble positions.
 *
 * ⭐ These track the BAY COLUMNS rather than sitting in a tight clump, and that
 * is a play-feel decision, not a cosmetic one. The bay spans the full width, so
 * when the bubbles were packed into the middle an onset die had to cross ~10
 * world units sideways to reach its slot - which demanded a hard, precisely
 * angled throw instead of the "up and toward the centre" flick the game is
 * supposed to reward. Measured: a reasonable throw fell 5 units short every time.
 *
 * `pull` is how far each bubble is dragged back toward centre from directly
 * above its column. 1.0 would park each bubble over its own column (trivial
 * aiming, and no longer "bubbles in the middle"); 0 is the old clump. Around
 * 0.5 keeps them reading as a centred cluster while making the natural flick
 * land.
 */
export function layoutFor(slots, bounds, y, pull = 0.52) {
  const colWidth = (bounds.x * 2) / slots;
  return Array.from({ length: slots }, (_, i) => ({
    x: (-bounds.x + colWidth * (i + 0.5)) * pull,
    y,
    span: 1,
  }));
}
