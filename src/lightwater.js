// ------------------------------------------------------------------ lightwater
// Makes light behave like it is underwater ON the geometry, not just behind it.
//
// ⭐ THE AUDIT FINDING THIS FIXES: the water shader painted beautiful caustics,
// god rays and depth — and then every rock, coral and fish was lit by a plain
// directional light as if it were standing in a field. The scene was underwater
// *behind* the objects and dry *on* them. That single mismatch is most of why
// the reef read as placeholder.
//
// Two effects, both injected into three.js' standard material rather than added
// as a post pass, because a post pass costs a full-screen read and this costs
// a handful of instructions on surfaces that are already being shaded:
//
//   CAUSTICS  - the dappled net of focused sunlight. Projected from ABOVE in
//               world space (light comes from the surface), so it crawls across
//               a rock correctly as the reef travels beneath it, and it only
//               lands on upward-facing surfaces.
//   DEPTH FOG - distant reef bleeds toward the water colour. Three.js' own fog
//               is linear in view space and goes grey; this is tinted and tuned
//               to the water ramp, so the far reef recedes instead of greying.
//
// One shared uniform drives every material, so animating the whole reef is a
// single assignment per frame.

import * as THREE from '../vendor/three.module.js';

export const waterUniforms = {
  uCTime: { value: 0 },
  // Where the sea floor is. Caustics are strongest on the bed and fade upward,
  // because that is where the focused light actually lands.
  uFloorY: { value: -40 },
  uCausticStrength: { value: 1.0 },
};

// Same cheap value noise the water backdrop uses. Matching the noise matters:
// if the caustics on the rocks were a different pattern from the caustics in
// the water, the eye reads two unrelated effects instead of one light source.
const NOISE_GLSL = /* glsl */`
  float lwHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float lwNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(lwHash(i), lwHash(i + vec2(1,0)), u.x),
               mix(lwHash(i + vec2(0,1)), lwHash(i + vec2(1,1)), u.x), u.y);
  }
`;

/**
 * Inject caustics + tinted depth falloff into a standard/physical material.
 * Safe to call on any material; returns the same material for chaining.
 */
export function makeUnderwater(material, { caustics = 1.0, fog = 1.0 } = {}) {
  if (!material || material.userData.__underwater) return material;
  material.userData.__underwater = true;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uCTime = waterUniforms.uCTime;
    shader.uniforms.uFloorY = waterUniforms.uFloorY;
    shader.uniforms.uCausticStrength = waterUniforms.uCausticStrength;
    shader.uniforms.uCausticAmount = { value: caustics };
    shader.uniforms.uFogAmount = { value: fog };

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vLwWorld;
        varying vec3 vLwNormalW;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vLwWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vLwNormalW = normalize(mat3(modelMatrix) * objectNormal);`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vLwWorld;
        varying vec3 vLwNormalW;
        uniform float uCTime;
        uniform float uFloorY;
        uniform float uCausticStrength;
        uniform float uCausticAmount;
        uniform float uFogAmount;
        ${NOISE_GLSL}`)
      // After all lighting, before tone mapping - caustics are added light, and
      // the depth tint has to sit on top of everything including the specular.
      .replace('#include <tonemapping_fragment>', `
        {
          // Projected from above: sample on the XZ plane, so the pattern is
          // fixed to the world and the reef slides through it.
          // ⛔ SPATIAL FREQUENCY IS THE WHOLE EFFECT. At 0.085 the noise cell
          // is ~12 world units across while a rock is ~6 - every rock sat inside
          // half a cell and got one near-constant value, so the caustics were
          // mathematically present and completely invisible. The pattern has to
          // be FINER than the objects it falls on.
          vec2 cp = vLwWorld.xz * 0.34;
          float c1 = lwNoise(cp + vec2(uCTime * 0.085, uCTime * 0.055));
          float c2 = lwNoise(cp * 1.7 - vec2(uCTime * 0.062, uCTime * 0.093));
          // Ridged difference gives thin bright filaments rather than blobs.
          // ⛔ max() before pow() - pow with a negative base is undefined in
          // GLSL and tore black holes in the water the first time around.
          // Broader filaments than the backdrop uses: light landing on a
          // surface spreads, it does not stay needle-thin like the volumetric
          // shafts behind it.
          float ridge = max(0.0, 1.0 - abs(c1 - c2) * 1.95);
          float caustic = pow(ridge, 4.0);

          // Only on surfaces that can see the surface. A vertical rock face
          // catching the same dappling as its top is the tell that it is a
          // texture rather than light.
          float up = clamp(vLwNormalW.y * 0.5 + 0.5, 0.0, 1.0);
          up = pow(up, 1.8);

          // Strongest on the bed, fading with height - focused light loses
          // coherence the further it travels from where it converges.
          float h = clamp((vLwWorld.y - uFloorY) / 26.0, 0.0, 1.0);
          float byHeight = mix(1.0, 0.25, h);

          gl_FragColor.rgb += vec3(0.42, 0.86, 0.98)
            * caustic * up * byHeight * uCausticStrength * uCausticAmount * 0.85;

          // Tinted distance falloff. Toward the water's own mid-blue, never
          // toward grey - greying out is what makes cheap fog look like smoke.
          // ⛔ THE FOG COLOUR MUST BE DARKER THAN THE WATER IT BLENDS INTO.
          // The first value here was a mid-blue brighter than the vignetted
          // water down at the sea bed, so the distant reef receded toward a
          // GLOW - the coral came out pale and ghostly, lighter than the
          // background, which is the opposite of atmospheric perspective.
          // These numbers track the water ramp's deep end, after its vignette.
          float d = length(vLwWorld - cameraPosition);
          float fogT = smoothstep(70.0, 150.0, d) * uFogAmount;
          vec3 deepTint = vec3(0.010, 0.062, 0.135);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, deepTint, fogT * 0.82);
        }
        #include <tonemapping_fragment>`);
  };

  // Materials with an injected shader must not share a compiled program with
  // the untouched version of the same material.
  material.customProgramCacheKey = () => 'underwater';
  material.needsUpdate = true;
  return material;
}

/** Advance the caustic animation. One call per frame drives every material. */
export function updateWater(t) {
  waterUniforms.uCTime.value = t;
}

/**
 * Bake shading into vertex colours: ambient occlusion toward the sea bed, and
 * sediment on upward faces.
 *
 * ⭐ THE AUDIT FINDING THIS FIXES: nothing was anchored. A coral stem simply
 * intersected a rock with no darkening at the join, so everything read as
 * objects *placed near* each other rather than growing out of each other.
 * There is no real AO solution here that is cheap enough - but height-based
 * darkening plus a little noise buys most of the impression for free, because
 * it is baked once at build time and costs nothing per frame.
 *
 * Sediment is the same trick in reverse: upward faces get a pale sandy lift,
 * which both reads as settled silt and gives the rocks the value variation they
 * completely lacked.
 */
export function bakeReefShading(mesh, { floorY = -40, spread = 16 } = {}) {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  if (!pos || !nrm) return;

  const colors = new Float32Array(pos.count * 3);
  // ⛔ Keep this DIM and COOL. A bright warm sand tint at any real strength
  // bleaches the coral to pale pink and the whole garden looks sun-faded - silt
  // underwater is a muted blue-grey, not beach sand in daylight.
  const SAND = [0.56, 0.56, 0.52];

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const ny = nrm.getY(i);

    // Occlusion: dark at the bed, opening up with height.
    const h = Math.min(1, Math.max(0, (y - floorY) / spread));
    let ao = 0.34 + 0.62 * Math.pow(h, 0.55);

    // Mottling, so large flat faces are not a single flat value. This is what
    // stops the rocks reading as crumpled paper.
    const n = (Math.sin(x * 1.7 + z * 2.3) * 0.5 + Math.sin(x * 0.6 - y * 1.1) * 0.5);
    ao *= 0.90 + 0.10 * (n * 0.5 + 0.5);

    // Sediment on up-facing surfaces, strongest low down where silt settles.
    const upness = Math.max(0, ny);
    const silt = Math.pow(upness, 4.0) * (1 - h) * 0.13;

    colors[i * 3]     = ao * (1 - silt) + SAND[0] * silt;
    colors[i * 3 + 1] = ao * (1 - silt) + SAND[1] * silt;
    colors[i * 3 + 2] = ao * (1 - silt) + SAND[2] * silt;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  // The material is shared, so it has to be cloned before enabling vertex
  // colours or every other mesh using it would render black.
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const out = mats.map(m => {
    const c = m.clone();
    c.vertexColors = true;
    return c;
  });
  mesh.material = Array.isArray(mesh.material) ? out : out[0];
}
