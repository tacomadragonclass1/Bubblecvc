// ---------------------------------------------------------------- letterforms
// School-print letter shapes, lifted verbatim from the Low Vision Braille app
// (lowvisionbraille/index.html) where they are already classroom-proven.
//
// These are CENTERLINES, not a font, and that is the point for a kindergarten
// reader. A font gives you a double-story `a` and a serifed `t`; school print
// does not. Drawing from centerlines guarantees the single-story `a`, the
// serif-free `t`, and a `g` with an open descender - the letterforms children
// are actually taught to write.
//
// Coordinate space: x-height 70, ascenders reach -30, descenders reach 100.
// Each entry is a list of strokes drawn in writing order. A stroke is an SVG
// path string, or [path, widthScale] to stroke it thinner than the rest of the
// glyph - used only by the i/j dot, see below.
export const PATHS = {
  a:['M60 30 C60 12 48 0 30 0 C10 0 0 15 0 35 C0 55 10 70 30 70 C48 70 60 58 60 40','M60 0 L60 70'],
  b:['M0 -30 L0 70','M0 30 C0 12 12 0 30 0 C50 0 60 15 60 35 C60 55 50 70 30 70 C12 70 0 58 0 40'],
  c:['M57 10 C49 3 40 0 30 0 C10 0 0 15 0 35 C0 55 10 70 30 70 C40 70 49 67 57 60'],
  d:['M60 30 C60 12 48 0 30 0 C10 0 0 15 0 35 C0 55 10 70 30 70 C48 70 60 58 60 40','M60 -30 L60 70'],
  e:['M0 33 L60 33 C60 12 48 0 30 0 C10 0 0 15 0 35 C0 55 12 70 32 70 C43 70 52 66 59 60'],
  f:['M45 -25 C26 -38 15 -24 15 -8 L15 70','M0 8 L38 8'],
  g:['M60 30 C60 12 48 0 30 0 C10 0 0 15 0 35 C0 55 10 70 30 70 C48 70 60 58 60 40','M60 0 L60 76 C60 105 26 110 7 94'],
  h:['M0 -30 L0 70','M0 29 C0 10 13 0 29 0 C46 0 55 11 55 28 L55 70'],
  // The dot is a zero-length stroke, so a round cap turns it into a disc of
  // radius lineWidth/2. At the 26-unit stroke this app draws with, that disc
  // is 13 tall and the stem's own round cap already reaches 13 ABOVE the
  // x-height line - so a dot centred at -24 overlapped the stem by 2 units and
  // the two fused into one blob. Centre it at -34 and draw it at 0.85 width:
  // that opens a 9.9-unit gap, and puts the top of the dot at -45, just clear
  // of the -43 that the ascenders of b/d/h/l reach. Both numbers are tied to
  // the stroke width - revisit them together if that 26 ever changes.
  i:[['M0 -34 L0 -33.9', 0.85],'M0 0 L0 70'],
  j:[['M25 -34 L25 -33.9', 0.85],'M25 0 L25 78 C25 96 14 103 0 96'],
  k:['M0 -30 L0 70','M53 0 L0 38 L56 70'],
  l:['M0 -30 L0 70'],
  m:['M0 0 L0 70','M0 25 C0 -8 44 -8 44 25 L44 70','M44 25 C44 -8 88 -8 88 25 L88 70'],
  n:['M0 0 L0 70','M0 29 C0 10 13 0 29 0 C46 0 55 11 55 28 L55 70'],
  o:['M60 35 C60 14 49 0 30 0 C11 0 0 14 0 35 C0 56 11 70 30 70 C49 70 60 56 60 35'],
  p:['M0 0 L0 100','M0 30 C0 12 12 0 30 0 C50 0 60 15 60 35 C60 55 50 70 30 70 C12 70 0 58 0 40'],
  q:['M60 30 C60 12 48 0 30 0 C10 0 0 15 0 35 C0 55 10 70 30 70 C48 70 60 58 60 40','M60 0 L60 100'],
  r:['M0 0 L0 70','M0 30 C0 7 17 -4 36 3'],
  s:['M53 8 C42 -2 15 -5 6 10 C-8 36 57 29 57 52 C57 75 20 77 1 62'],
  t:['M23 -25 L23 70','M0 0 L48 0'],
  u:['M0 0 L0 42 C0 61 9 70 26 70 C44 70 55 58 55 40','M55 0 L55 70'],
  v:['M0 0 L30 70 L60 0'],
  w:['M0 0 L22 70 L44 8 L66 70 L88 0'],
  x:['M0 0 L60 70','M60 0 L0 70'],
  y:['M0 0 L30 63','M60 0 L15 100'],
  z:['M0 0 L60 0 L0 70 L60 70'],};

// Ascender/descender extremes of the shared coordinate space. Every glyph is
// rendered into this same box so that letters on different dice sit on a common
// baseline - an `o` must not look bigger than a `b` just because it is rounder.
export const EM = { top: -40, bottom: 110, left: -10, right: 98 };

// Letters whose mirror or rotation is another letter. Nothing in this app is
// allowed to rotate a die far enough to make these ambiguous, but they are
// listed so the constraint has something to assert against in dev builds.
export const CONFUSABLE = ['b', 'd', 'p', 'q', 'm', 'w', 'n', 'u'];

export const VOWELS = ['a', 'e', 'i', 'o', 'u'];
export const CONSONANTS = 'bcdfghjklmnpqrstvwxyz'.split('');

// Consonants that essentially never END an English CVC word. The pre-screen
// greys these out of the coda column rather than hiding them, so a teacher can
// still force one if they want a nonsense word - UFLI uses pseudowords on
// purpose, so this is a nudge and not a lock.
export const RARE_CODA = ['j', 'q', 'v', 'w', 'y', 'h', 'c'];

/**
 * Render one glyph to a square canvas, centred, as white strokes on a
 * transparent ground. The result becomes the emissive/alpha texture on a die
 * face, so colour is applied by the material, not baked in here.
 */
export function glyphCanvas(ch, size = 256, lineWidth = 9) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');

  const w = EM.right - EM.left, h = EM.bottom - EM.top;
  // Fit the EM box into the canvas with a margin, preserving aspect so the
  // letters are never stretched.
  const pad = size * 0.14;
  const scale = Math.min((size - pad * 2) / w, (size - pad * 2) / h);
  const ox = (size - w * scale) / 2 - EM.left * scale;
  const oy = (size - h * scale) / 2 - EM.top * scale;

  g.save();
  g.translate(ox, oy);
  g.scale(scale, scale);
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  g.lineJoin = 'round';

  for (const stroke of PATHS[ch] || []) {
    const [d, widthScale] = Array.isArray(stroke) ? stroke : [stroke, 1];
    g.lineWidth = lineWidth * widthScale;
    g.stroke(new Path2D(d));
  }
  g.restore();
  return cv;
}
