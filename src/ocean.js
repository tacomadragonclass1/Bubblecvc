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

// Depth planes. Creatures are spread across these so the water reads as having
// volume. All are well BEHIND the play plane (z = 0) so nothing ever occludes a
// letter the child is trying to read.
const LANES = [-26, -34, -42, -52, -64];

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

    // Depth gradient: bright sunlit surface up top, deep blue below. The dark
    // floor matters - it is what the white letter strokes read against.
    vec3 shallow = vec3(0.16, 0.62, 0.78);
    vec3 mid     = vec3(0.05, 0.30, 0.52);
    vec3 deep    = vec3(0.01, 0.08, 0.20);
    vec3 col = mix(mid, shallow, smoothstep(0.45, 1.0, uv.y));
    col = mix(deep, col, smoothstep(0.0, 0.55, uv.y));

    // God rays: a few wide, slow, overlapping shafts leaning off vertical.
    float rays = 0.0;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float x = uv.x * (2.2 + fi * 0.7) + uv.y * 0.55 + uTime * (0.013 + fi * 0.004);
      rays += pow(max(sin(x * 3.14159) * 0.5 + 0.5, 0.0), 7.0) * (0.5 - fi * 0.12);
    }
    rays *= smoothstep(0.0, 0.85, uv.y);          // only from above
    col += vec3(0.55, 0.85, 0.95) * rays * 0.26;

    // Caustic shimmer, strongest near the surface.
    vec2 cp = uv * uAspect * 5.0;
    float c = noise(cp + vec2(uTime * 0.07, uTime * 0.045));
    c = pow(c, 2.4);
    col += vec3(0.4, 0.75, 0.85) * c * 0.16 * smoothstep(0.1, 1.0, uv.y);

    // Vignette, so attention falls to the middle where the bubbles live.
    float v = distance(uv, vec2(0.5)) ;
    col *= 1.0 - smoothstep(0.42, 0.95, v) * 0.45;

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

function makeOctopus(scale = 1) {
  const g = new THREE.Group();
  const mat = fishMaterial(0.88, 0.45, 0.55);

  const head = new THREE.Mesh(new THREE.SphereGeometry(1.1, 16, 14), mat);
  head.scale.set(1, 1.2, 1);
  g.add(head);

  const arms = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    // Each arm is a short chain of tapering segments so it can curl.
    const arm = new THREE.Group();
    let parent = arm;
    for (let s = 0; s < 4; s++) {
      const r = 0.22 * (1 - s * 0.19);
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r, 0.55, 7), mat);
      seg.position.y = -0.55;
      seg.geometry.translate(0, -0.275, 0);
      seg.position.y = s === 0 ? -0.9 : -0.5;
      parent.add(seg);
      parent = seg;
    }
    arm.position.set(Math.cos(a) * 0.55, -0.5, Math.sin(a) * 0.55);
    arm.userData.phase = i * 0.7;
    arms.push(arm);
    g.add(arm);
  }

  for (const s of [1, -1]) {
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 10, 10),
      new THREE.MeshStandardMaterial({ color: 0xfdfdff, roughness: 0.25 })
    );
    eye.position.set(s * 0.42, 0.42, 0.92);
    g.add(eye);
    const pupil = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0x14141c })
    );
    pupil.position.set(s * 0.44, 0.4, 1.07);
    g.add(pupil);
  }

  g.scale.setScalar(scale);
  g.userData.arms = arms;
  g.userData.kind = 'octopus';
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
export function createOcean(scene, bounds) {
  const group = new THREE.Group();
  scene.add(group);

  const motes = makeMotes(260, { x: bounds.x * 2.6, y: bounds.y * 2.4 });
  group.add(motes);

  const swimmers = [];
  const spawn = (mesh, lane, speed, yJitter) => {
    mesh.position.set(0, 0, lane);
    mesh.userData.speed = speed;
    mesh.userData.lane = lane;
    mesh.userData.yJitter = yJitter;
    mesh.userData.phase = Math.random() * Math.PI * 2;
    resetSwimmer(mesh, bounds, true);
    group.add(mesh);
    swimmers.push(mesh);
  };

  // A small, varied cast. Deliberately not a school of forty - motion behind
  // the bubbles has to stay calm enough that it does not pull the eye off the
  // letters.
  spawn(makeFish(0.75, 0.08), LANES[0], 3.4, 1.1);
  spawn(makeFish(0.62, 0.14), LANES[1], 2.7, 1.5);
  spawn(makeFish(0.9, 0.55), LANES[2], 2.2, 0.9);
  spawn(makeFish(0.55, 0.02), LANES[1], 3.9, 1.8);
  spawn(makeOctopus(0.85), LANES[3], 1.2, 0.5);
  spawn(makeShark(0.9), LANES[4], 1.9, 0.35);

  // Soft light from above, matching the god rays.
  const key = new THREE.DirectionalLight(0xbfefff, 1.25);
  key.position.set(-0.3, 1, 0.55);
  scene.add(key);
  const fill = new THREE.AmbientLight(0x2d5f80, 1.5);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0x0d3a5c, 0.6);
  rim.position.set(0.4, -0.8, -0.6);
  scene.add(rim);

  return { group, swimmers, motes, lights: { key, fill, rim } };
}

function resetSwimmer(m, bounds, anywhere = false) {
  // Alternate direction so traffic goes both ways.
  const dir = Math.random() < 0.5 ? 1 : -1;
  m.userData.dir = dir;
  const margin = 14;
  const x = anywhere
    ? (Math.random() - 0.5) * bounds.x * 2
    : (-dir) * (bounds.x + margin);
  m.position.x = x;
  m.position.y = (Math.random() - 0.5) * bounds.y * 1.5;
  m.userData.baseY = m.position.y;
  // Face travel direction. The models point +x, so a leftward swimmer is
  // yawed 180 degrees - never mirrored by a negative scale, which would flip
  // the lighting and read as a hole in the water.
  m.rotation.y = dir > 0 ? 0 : Math.PI;
}

export function updateOcean(ocean, bounds, t, dt) {
  for (const m of ocean.swimmers) {
    const u = m.userData;
    m.position.x += u.dir * u.speed * dt;
    m.position.y = u.baseY + Math.sin(t * 0.6 + u.phase) * u.yJitter;

    // Gentle bank into the bob, which is what sells "swimming" over "sliding".
    const bank = Math.cos(t * 0.6 + u.phase) * 0.12;
    m.rotation.z = u.dir > 0 ? bank : -bank;

    if (u.kind === 'fish' || u.kind === 'shark') {
      const beat = u.kind === 'shark' ? 2.2 : 5.5;
      u.tail.rotation.y = Math.sin(t * beat + u.phase) * 0.45;
    } else if (u.kind === 'octopus') {
      for (const arm of u.arms) {
        arm.rotation.x = Math.sin(t * 1.6 + arm.userData.phase) * 0.3;
        arm.rotation.z = Math.cos(t * 1.3 + arm.userData.phase) * 0.25;
      }
      m.rotation.z = Math.sin(t * 0.8 + u.phase) * 0.1;
    }

    const margin = 16;
    if ((u.dir > 0 && m.position.x > bounds.x + margin) ||
        (u.dir < 0 && m.position.x < -bounds.x - margin)) {
      resetSwimmer(m, bounds);
    }
  }

  // Motes rise and wrap.
  const pos = ocean.motes.geometry.attributes.position;
  const spd = ocean.motes.userData.spd;
  const spread = ocean.motes.userData.spread;
  for (let i = 0; i < spd.length; i++) {
    let y = pos.array[i * 3 + 1] + spd[i] * dt;
    let x = pos.array[i * 3] + Math.sin(t * 0.5 + i) * 0.012;
    if (y > spread.y / 2) { y = -spread.y / 2; x = (Math.random() - 0.5) * spread.x; }
    pos.array[i * 3] = x;
    pos.array[i * 3 + 1] = y;
  }
  pos.needsUpdate = true;
}
