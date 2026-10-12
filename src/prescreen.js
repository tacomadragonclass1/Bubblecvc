// ------------------------------------------------------------------ prescreen
// The teacher's board setup, shown before play and returned to via the home
// button. Plain DOM, not three.js: this is a form, and a form should be a form.
//
// UFLI is explicit that the board is "prepared in advance" - the teacher decides
// which graphemes are in play for THIS lesson, and the drill is fast because the
// board only holds what has already been taught. That makes this screen the
// pedagogical control surface, not a settings page, so:
//
//   * onset and coda consonants are chosen SEPARATELY. Final-position work
//     (-t, -g, -p) uses a different set than onsets, and some letters barely
//     end English words at all.
//   * presets are saved, because nobody wants to re-tap twelve letters between
//     a small-group rotation.
//   * nothing here is modal-on-modal. A teacher at a wall-mounted panel with a
//     class waiting gets one screen and one Start.

import { VOWELS, CONSONANTS, RARE_CODA } from './letterforms.js';

const LS_PRESETS = 'bubblecvc.presets.v1';
const LS_LAST = 'bubblecvc.last.v1';

// Handy groupings a phonics teacher actually thinks in. Each is a quick-fill,
// not a mode - tapping one sets the column, then individual letters still toggle.
const GROUPS = {
  onset: {
    'Stops': ['p', 'b', 't', 'd', 'k', 'g', 'c'],
    'Nasals + liquids': ['m', 'n', 'l', 'r'],
    'Fricatives': ['f', 'v', 's', 'z', 'h'],
    'All': CONSONANTS.slice(),
  },
  coda: {
    'Stops': ['p', 'b', 't', 'd', 'g', 'k'],
    'Nasals + liquids': ['m', 'n', 'l', 'r'],
    'Fricatives': ['f', 's', 'z', 'x'],
    'All': CONSONANTS.filter(c => !RARE_CODA.includes(c)),
  },
};

const DEFAULT = {
  onset: ['m', 's', 't', 'p', 'c', 'b'],
  vowel: ['a', 'o'],
  coda: ['t', 'p', 'n', 'g', 'd'],
};

function readJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}
function writeJSON(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* private mode */ }
}

export function createPrescreen(root, onStart) {
  const state = readJSON(LS_LAST, null) || structuredClone(DEFAULT);
  // Guard against a stale save that would leave a column empty and the board
  // unplayable - a word needs at least one letter in each position.
  for (const k of ['onset', 'vowel', 'coda']) {
    if (!Array.isArray(state[k]) || !state[k].length) state[k] = structuredClone(DEFAULT[k]);
  }

  const el = document.createElement('div');
  el.className = 'prescreen';
  el.innerHTML = `
    <div class="ps-inner">
      <h1>Bubble Blending Board</h1>
      <p class="ps-sub">Choose the letters for this lesson, then press Start.</p>
      <div class="ps-cols">
        ${col('onset', 'First sound', 'consonant')}
        ${col('vowel', 'Vowel', 'vowel')}
        ${col('coda', 'Last sound', 'consonant')}
      </div>
      <div class="ps-presets">
        <label>Saved boards</label>
        <select class="ps-preset-list"><option value="">—</option></select>
        <button class="ps-load" type="button">Load</button>
        <button class="ps-save" type="button">Save as…</button>
        <button class="ps-del" type="button">Delete</button>
      </div>
      <button class="ps-start" type="button">Start</button>
      <p class="ps-warn" hidden>Each column needs at least one letter.</p>
    </div>`;
  root.appendChild(el);

  function col(key, title, kind) {
    const letters = key === 'vowel' ? VOWELS : CONSONANTS;
    const groups = GROUPS[key];
    return `
      <section class="ps-col" data-col="${key}">
        <h2>${title}</h2>
        ${groups ? `<div class="ps-groups">${Object.keys(groups)
          .map(g => `<button type="button" data-group="${g}">${g}</button>`).join('')}
          <button type="button" data-group="__none">Clear</button></div>` : ''}
        <div class="ps-letters ${kind}">
          ${letters.map(ch => {
            const rare = key === 'coda' && RARE_CODA.includes(ch);
            return `<button type="button" class="ps-letter${rare ? ' rare' : ''}"
                      data-ch="${ch}"${rare ? ' title="rarely ends a word"' : ''}>${ch}</button>`;
          }).join('')}
        </div>
      </section>`;
  }

  // ------------------------------------------------------------------- render
  function paint() {
    el.querySelectorAll('.ps-col').forEach(sec => {
      const key = sec.dataset.col;
      sec.querySelectorAll('.ps-letter').forEach(btn => {
        btn.classList.toggle('on', state[key].includes(btn.dataset.ch));
      });
    });
    const ok = state.onset.length && state.vowel.length && state.coda.length;
    el.querySelector('.ps-start').disabled = !ok;
    el.querySelector('.ps-warn').hidden = !!ok;
  }

  function refreshPresetList(selected = '') {
    const presets = readJSON(LS_PRESETS, {});
    const sel = el.querySelector('.ps-preset-list');
    sel.innerHTML = '<option value="">—</option>' +
      Object.keys(presets).sort().map(n =>
        `<option value="${n}"${n === selected ? ' selected' : ''}>${n}</option>`).join('');
  }

  // ------------------------------------------------------------------- events
  el.addEventListener('click', e => {
    const letter = e.target.closest('.ps-letter');
    if (letter) {
      const key = letter.closest('.ps-col').dataset.col;
      const ch = letter.dataset.ch;
      const i = state[key].indexOf(ch);
      if (i >= 0) state[key].splice(i, 1); else state[key].push(ch);
      // Keep stored order stable so the bay does not reshuffle as you toggle.
      const order = key === 'vowel' ? VOWELS : CONSONANTS;
      state[key].sort((a, b) => order.indexOf(a) - order.indexOf(b));
      writeJSON(LS_LAST, state);
      paint();
      return;
    }

    const group = e.target.closest('[data-group]');
    if (group) {
      const key = group.closest('.ps-col').dataset.col;
      const g = group.dataset.group;
      state[key] = g === '__none' ? [] : GROUPS[key][g].slice();
      writeJSON(LS_LAST, state);
      paint();
      return;
    }

    if (e.target.closest('.ps-start')) {
      writeJSON(LS_LAST, state);
      onStart(structuredClone(state));
      return;
    }

    if (e.target.closest('.ps-save')) {
      const name = prompt('Name this board (e.g. "Week 3 — stops + a/o")');
      if (!name) return;
      const presets = readJSON(LS_PRESETS, {});
      presets[name] = structuredClone(state);
      writeJSON(LS_PRESETS, presets);
      refreshPresetList(name);
      return;
    }

    if (e.target.closest('.ps-load')) {
      const name = el.querySelector('.ps-preset-list').value;
      if (!name) return;
      const presets = readJSON(LS_PRESETS, {});
      if (!presets[name]) return;
      Object.assign(state, structuredClone(presets[name]));
      writeJSON(LS_LAST, state);
      paint();
      return;
    }

    if (e.target.closest('.ps-del')) {
      const name = el.querySelector('.ps-preset-list').value;
      if (!name) return;
      const presets = readJSON(LS_PRESETS, {});
      delete presets[name];
      writeJSON(LS_PRESETS, presets);
      refreshPresetList();
    }
  });

  refreshPresetList();
  paint();

  return {
    el,
    show() { el.hidden = false; paint(); },
    hide() { el.hidden = true; },
    get state() { return structuredClone(state); },
  };
}
