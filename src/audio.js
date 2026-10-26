// ---------------------------------------------------------------------- audio
// Three jobs, deliberately kept apart:
//
//   1. PHONEMES  - the 26 human recordings carried over from Phonics Farm
//                  (Pronunciation Studio, under the non-profit educational
//                  grant). These are real voice, not TTS, and they are the
//                  pedagogical payload. Never regenerate them with a synth.
//   2. SFX       - bubbles, pops, flicks, ricochets. Synthesised here rather
//                  than shipped as files: a classroom TV has one speaker and a
//                  lot of room noise, so these are tuned to be short, bright
//                  and above the chatter. No asset to download, no licence.
//   3. WORDS     - whole-word and VC-combo audio. NOT SHIPPED YET. v1 blends
//                  the phonemes instead (which is what UFLI asks students to do
//                  anyway). The hook below is the only thing that has to change
//                  when the Kokoro clips land - see tryWordClip().
//
// WebAudio throughout, not <audio>, because blending needs sample-accurate
// scheduling. A chain of 'ended' events drifts audibly at these durations.

const PHONEME_DIR = 'audio/phonemes/';
// Flip to true once audio/words/ and audio/vc/ are populated by the Kokoro
// generator. Until then every lookup short-circuits and we blend phonemes.
export const WORD_CLIPS_AVAILABLE = false;

let ctx = null;
const buffers = new Map();   // key -> AudioBuffer
const pending = new Map();   // key -> Promise
let master = null;

/** Lazily create the context. Must be called from a user gesture on iOS/Safari. */
export function initAudio() {
  if (ctx) return ctx;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);
  return ctx;
}

/** Resume after an autoplay block. Safe to call on every pointer down. */
export function unlock() {
  if (!ctx) initAudio();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
}

async function load(url, key) {
  if (buffers.has(key)) return buffers.get(key);
  if (pending.has(key)) return pending.get(key);
  const p = fetch(url)
    .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
    .then(ab => ctx.decodeAudioData(ab))
    .then(buf => { buffers.set(key, buf); pending.delete(key); return buf; })
    .catch(() => { pending.delete(key); return null; });
  pending.set(key, p);
  return p;
}

/** Warm the cache for exactly the letters this session uses. */
export async function preloadPhonemes(letters) {
  initAudio();
  await Promise.all([...new Set(letters)].map(ch => load(PHONEME_DIR + ch + '.wav', ch)));
}

function play(buf, { when = 0, gain = 1, rate = 1 } = {}) {
  if (!buf) return null;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(g).connect(master);
  src.start(ctx.currentTime + when);
  return src;
}

/** One letter sound. Returns the clip duration so callers can chain. */
export async function playPhoneme(ch, when = 0) {
  initAudio();
  const buf = await load(PHONEME_DIR + ch + '.wav', ch);
  play(buf, { when });
  return buf ? buf.duration : 0.35;
}

/**
 * Say the sounds in order, then the blended whole. This IS the UFLI routine:
 * students say each sound, then blend. The gap shrinks on the final pass so the
 * sounds run together into a word rather than staying a list.
 */
export async function blend(letters, { gap = 0.26, thenWhole = true } = {}) {
  initAudio();
  const bufs = await Promise.all(letters.map(ch => load(PHONEME_DIR + ch + '.wav', ch)));
  let t = 0;
  for (const b of bufs) {
    play(b, { when: t });
    t += (b ? b.duration : 0.3) + gap;
  }
  if (!thenWhole) return t;

  // The whole word. A real clip if one has been generated, otherwise the same
  // phonemes run together tightly enough to read as a word.
  t += 0.34;
  const clip = await tryWordClip(letters);
  if (clip) {
    play(clip, { when: t });
    return t + clip.duration;
  }
  for (const b of bufs) {
    play(b, { when: t, gain: 1 });
    t += (b ? b.duration : 0.3) * 0.62;   // overlap-ish: fast enough to blend
  }
  return t;
}

/**
 * The single seam for whole-word audio. When the Kokoro clips are generated,
 * set WORD_CLIPS_AVAILABLE = true and drop files at:
 *     audio/words/<c><v><c>.wav      e.g. audio/words/cat.wav
 *     audio/vc/<v><c>.wav            e.g. audio/vc/ot.wav
 * Nothing else in the app needs to change.
 */
export async function tryWordClip(letters) {
  if (!WORD_CLIPS_AVAILABLE) return null;
  const w = letters.join('');
  const dir = letters.length === 2 ? 'audio/vc/' : 'audio/words/';
  return load(dir + w + '.wav', 'w:' + w);
}

// ------------------------------------------------------------------- synth sfx
// All of these are deliberately under ~400ms. On a classroom TV a long sound
// steps on the teacher's voice, and the teacher is the instruction.

function env(node, t0, peak, attack, decay) {
  const g = node.gain;
  g.setValueAtTime(0.0001, t0);
  g.exponentialRampToValueAtTime(peak, t0 + attack);
  g.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
}

function noiseBuffer(dur = 0.4) {
  const n = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/** Die leaves the bay: a short airy whoosh that rises with flick strength. */
export function sfxFlick(strength = 1) {
  initAudio();
  const t0 = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(0.3);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.1;
  bp.frequency.setValueAtTime(420, t0);
  bp.frequency.exponentialRampToValueAtTime(1500 + 900 * strength, t0 + 0.22);
  const g = ctx.createGain();
  env(g, t0, 0.16 + 0.1 * strength, 0.02, 0.24);
  src.connect(bp).connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + 0.32);
}

/** Die hits a wall. Pitch tracks impact speed so hard hits read as hard. */
export function sfxWall(speed = 1) {
  initAudio();
  const t0 = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(180 + 120 * Math.min(speed, 2), t0);
  o.frequency.exponentialRampToValueAtTime(70, t0 + 0.14);
  const g = ctx.createGain();
  env(g, t0, 0.18, 0.004, 0.14);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + 0.18);
}

/** Captured by a bubble: a wet rising glug, the "it went in" reward. */
export function sfxCapture() {
  initAudio();
  const t0 = ctx.currentTime;
  for (let i = 0; i < 3; i++) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    const s = t0 + i * 0.045;
    o.frequency.setValueAtTime(300 + i * 120, s);
    o.frequency.exponentialRampToValueAtTime(820 + i * 180, s + 0.12);
    const g = ctx.createGain();
    env(g, s, 0.2, 0.008, 0.13);
    o.connect(g).connect(master);
    o.start(s);
    o.stop(s + 0.2);
  }
}

/** Bubble popped: the classic hollow pop - fast downward chirp plus a tick. */
export function sfxPop() {
  initAudio();
  const t0 = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(900, t0);
  o.frequency.exponentialRampToValueAtTime(160, t0 + 0.09);
  const g = ctx.createGain();
  env(g, t0, 0.3, 0.004, 0.1);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + 0.14);

  const n = ctx.createBufferSource();
  n.buffer = noiseBuffer(0.08);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1800;
  const ng = ctx.createGain();
  env(ng, t0, 0.14, 0.002, 0.06);
  n.connect(hp).connect(ng).connect(master);
  n.start(t0);
  n.stop(t0 + 0.1);
}

/** Flick that did not reach: a soft deflating sigh, never a buzzer. */
/**
 * Two bubbles coalescing. ⭐ The opposite shape of sfxPop(): a pop is a sharp
 * transient that falls away, so a merge has to be a soft one that SETTLES - it
 * swells into a low note and stops there. If it ticked or snapped at all it
 * read as a letter being destroyed, which is the one thing a teacher must never
 * think they just did.
 *
 * @param walls how many shared walls let go - a sweep across all three bubbles
 *              merges two boundaries and sounds fuller for it.
 */
export function sfxMerge(walls = 1) {
  initAudio();
  const t0 = ctx.currentTime;
  // Upward glide into a resting fifth. Two voices, the second detuned, so it
  // arrives as a chord rather than as a beep.
  const f0 = walls > 1 ? 150 : 185;
  [1, 1.5].forEach((mult, i) => {
    const o = ctx.createOscillator();
    o.type = 'triangle';
    const s = t0 + i * 0.03;
    o.frequency.setValueAtTime(f0 * mult * 0.72, s);
    o.frequency.exponentialRampToValueAtTime(f0 * mult, s + 0.19);
    const g = ctx.createGain();
    // Slow attack is the whole character: nothing percussive happens.
    env(g, s, 0.2 - i * 0.06, 0.055, 0.3);
    o.connect(g).connect(master);
    o.start(s);
    o.stop(s + 0.42);
  });
  // A wet swallow underneath - the water closing over the neck. Low-passed
  // noise, never bright: brightness is what makes a sound read as a break.
  const n = ctx.createBufferSource();
  n.buffer = noiseBuffer(0.3);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(380, t0);
  lp.frequency.exponentialRampToValueAtTime(1100, t0 + 0.2);
  const ng = ctx.createGain();
  env(ng, t0, 0.1, 0.05, 0.22);
  n.connect(lp).connect(ng).connect(master);
  n.start(t0);
  n.stop(t0 + 0.32);
}

/** A merged bubble coming apart again - the merge played downward and shorter. */
export function sfxSplit() {
  initAudio();
  const t0 = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(240, t0);
  o.frequency.exponentialRampToValueAtTime(160, t0 + 0.13);
  const g = ctx.createGain();
  env(g, t0, 0.17, 0.02, 0.17);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + 0.24);
}

/**
 * A new bubble arriving out of the water. ⭐ Rising and soft-edged, the exact
 * opposite shape of sfxPop() - a bubble forming is the inverse of one bursting,
 * and the ear reads that immediately without being taught.
 */
export function sfxSummon() {
  initAudio();
  const t0 = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(220, t0);
  o.frequency.exponentialRampToValueAtTime(760, t0 + 0.17);
  const g = ctx.createGain();
  env(g, t0, 0.22, 0.03, 0.2);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + 0.3);
  // A small intake of water behind it, band-passed so it stays a gurgle rather
  // than a hiss - this fires beside a word being read, not over it.
  const n = ctx.createBufferSource();
  n.buffer = noiseBuffer(0.22);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(600, t0);
  bp.frequency.exponentialRampToValueAtTime(1900, t0 + 0.18);
  bp.Q.value = 1.4;
  const ng = ctx.createGain();
  env(ng, t0, 0.1, 0.02, 0.18);
  n.connect(bp).connect(ng).connect(master);
  n.start(t0);
  n.stop(t0 + 0.26);
}

/**
 * A summoned bubble dismissed. ⛔ Deliberately NOT the pop: nothing burst, and
 * a teacher tidying the board away must not hear the same sound as a letter
 * being released. A short descending sigh - it sinks rather than breaks.
 */
export function sfxDismiss() {
  initAudio();
  const t0 = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(520, t0);
  o.frequency.exponentialRampToValueAtTime(170, t0 + 0.2);
  const g = ctx.createGain();
  env(g, t0, 0.17, 0.015, 0.21);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + 0.3);
}

export function sfxMiss() {
  initAudio();
  const t0 = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(380, t0);
  o.frequency.exponentialRampToValueAtTime(190, t0 + 0.26);
  const g = ctx.createGain();
  env(g, t0, 0.1, 0.02, 0.26);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + 0.3);
}

/** All slots filled - a small shimmer under the spoken word. */
export function sfxComplete() {
  initAudio();
  const t0 = ctx.currentTime;
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const g = ctx.createGain();
    env(g, t0 + i * 0.07, 0.12, 0.01, 0.4);
    o.connect(g).connect(master);
    o.start(t0 + i * 0.07);
    o.stop(t0 + i * 0.07 + 0.5);
  });
}
