/**
 * Flulivre — vue Lecteur.
 * Mode audio (fichiers, éventuellement multi-pistes/chapitres) et mode
 * synthèse vocale (EPUB / PDF / TXT) avec lecture synchronisée.
 * Inclus : minuteur de sommeil (durée ou fin de chapitre), taille du texte,
 * génération de livre audio par narrateur IA.
 */

import { AudioEngine } from './audio.js';
import { TTSEngine } from './tts.js';
import { openAiModal } from './ai-tts.js';
import { fmtTime, escapeHtml, toast } from './utils.js';

const $ = (id) => document.getElementById(id);

let book = null;          // livre affiché
let mode = null;          // 'audio' | 'tts'
let onBack = () => {};
let refreshMini = () => {};
let onLibraryChanged = () => {};
let seeking = false;      // curseur en cours de manipulation

/* ═══════════════ Minuteur de sommeil (durée ou fin de chapitre) ═══════════════ */

let sleepEnd = 0;
let sleepTimer = null;
let sleepChapter = false;

function buildSleepMenu() {
  const menu = $('sleep-menu');
  const options = [
    { label: 'Désactivé', min: 0 },
    { label: 'Fin du chapitre en cours', min: 'chapter' },
    { label: '5 minutes', min: 5 },
    { label: '15 minutes', min: 15 },
    { label: '30 minutes', min: 30 },
    { label: '45 minutes', min: 45 },
    { label: '60 minutes', min: 60 }
  ];
  menu.innerHTML = options.map((o) => `<button data-min="${o.min}">🌙 ${o.label}</button>`).join('');
  menu.onclick = (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const v = btn.dataset.min;
    setSleep(v === 'chapter' ? 'chapter' : Number(v));
    menu.hidden = true;
  };
}

function clearSleep() {
  clearInterval(sleepTimer);
  sleepTimer = null;
  sleepEnd = 0;
  sleepChapter = false;
  const btn = $('btn-sleep');
  btn.classList.remove('active');
  btn.textContent = '🌙 Minuteur';
}

function setSleep(v) {
  clearSleep();
  const btn = $('btn-sleep');
  if (!v) return;

  if (v === 'chapter') {
    sleepChapter = true;
    btn.classList.add('active');
    btn.textContent = '🌙 Fin du chapitre';
    return;
  }
  sleepEnd = Date.now() + v * 60000;
  btn.classList.add('active');
  sleepTimer = setInterval(() => {
    const left = sleepEnd - Date.now();
    if (left <= 0) {
      clearSleep();
      activeEngine()?.pause();
      toast('Minuteur terminé — bonne nuit 🌙');
      return;
    }
    btn.textContent = `🌙 ${fmtTime(left / 1000)}`;
  }, 1000);
}

/** Appelé quand un chapitre s'enchaîne automatiquement. */
function onAutoAdvance() {
  if (!sleepChapter) return;
  const eng = activeEngine();
  clearSleep();
  if (eng) eng.pause();
  toast('Fin du chapitre — mise en pause 🌙');
}

function activeEngine() {
  if (AudioEngine.book) return AudioEngine;
  if (TTSEngine.book) return TTSEngine;
  return null;
}

/* ═══════════════ Taille du texte du panneau de lecture ═══════════════ */

const FS_KEY = 'flulivre-reader-fs';

function applyReaderFont(size) {
  document.documentElement.style.setProperty('--reader-fs', size + 'px');
  localStorage.setItem(FS_KEY, size);
}

function initReaderFont() {
  const saved = Number(localStorage.getItem(FS_KEY)) || 17;
  applyReaderFont(Math.max(14, Math.min(24, saved)));
}

/* ═══════════════ Options vitesse / voix ═══════════════ */

function buildRateOptions() {
  const sel = $('p-rate');
  sel.innerHTML = '';
  for (let r = 0.5; r <= 3.001; r += 0.25) {
    const v = Math.round(r * 100) / 100;
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = `× ${v}`;
    sel.appendChild(opt);
  }
  sel.value = book?.rate || 1;
}

function buildVoiceOptions() {
  const sel = $('p-voice');
  const voices = speechSynthesis.getVoices();
  sel.innerHTML = '';
  if (!voices.length) {
    sel.innerHTML = '<option value="">Voix par défaut</option>';
    return;
  }
  const fr = voices.filter((v) => (v.lang || '').toLowerCase().startsWith('fr'));
  const others = voices.filter((v) => !(v.lang || '').toLowerCase().startsWith('fr'));
  for (const v of [...fr, ...others]) {
    const opt = document.createElement('option');
    opt.value = v.name;
    opt.textContent = `${v.name} (${v.lang})`;
    sel.appendChild(opt);
  }
  const current = TTSEngine.voice?.name || book?.voiceName;
  if (current && [...fr, ...others].some((v) => v.name === current)) sel.value = current;
}

function buildChapterOptions() {
  const sel = $('p-chapters');
  sel.innerHTML = (book.sections || []).map((s, i) =>
    `<option value="${i}">${escapeHtml(s.title || `Partie ${i + 1}`)}</option>`
  ).join('');
  sel.value = TTSEngine.section;
}

/** Liste des pistes pour un livre audio multi-pistes. */
function buildTrackOptions() {
  const box = $('p-audio-chapters');
  const sel = $('p-audio-tracks');
  const tracks = AudioEngine.tracks || [];
  if (mode !== 'audio' || tracks.length < 2) { box.hidden = true; return; }
  box.hidden = false;
  sel.innerHTML = tracks.map((t, i) =>
    `<option value="${i}">${i + 1}. ${escapeHtml(t.title || 'Piste ' + (i + 1))} (${fmtTime(t.duration || 0)})</option>`
  ).join('');
  sel.value = AudioEngine.trackIdx;
}

/* ═══════════════ Lecture synchronisée (voix synthèse) ═══════════════ */

function renderReader() {
  if (mode !== 'tts' || !book) return;
  const container = $('p-reader-text');
  const sentences = TTSEngine.sentences();
  container.innerHTML = '';
  sentences.forEach((s, i) => {
    const span = document.createElement('span');
    span.className = 'sentence';
    span.textContent = s + ' ';
    span.dataset.i = i;
    span.onclick = () => {
      TTSEngine.seekGlobal((TTSEngine._offsets[TTSEngine.section] || 0) + i);
      if (TTSEngine.state !== 'playing') TTSEngine.play();
    };
    container.appendChild(span);
  });
  highlightSentence(TTSEngine.sentence, false);
  $('p-chapters').value = TTSEngine.section;
}

function highlightSentence(i, scroll = true) {
  const container = $('p-reader-text');
  const prev = container.querySelector('.sentence.current');
  if (prev) prev.classList.remove('current');
  const el = container.querySelector(`.sentence[data-i="${i}"]`);
  if (el) {
    el.classList.add('current');
    if (scroll && TTSEngine.state === 'playing') {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
}

/* ═══════════════ Mises à jour d'interface ═══════════════ */

function updatePlayButtons() {
  const playing = activeEngine()?.state === 'playing';
  $('btn-play').textContent = playing ? '⏸' : '▶';
}

function onAudioTime({ time, duration, track, tracks }) {
  if (mode !== 'audio' || !book) return;
  if (!seeking) {
    const slider = $('p-seek');
    slider.max = Math.max(1, Math.floor(duration || 0));
    slider.value = Math.floor(time);
  }
  $('p-time-cur').textContent = fmtTime(time);
  $('p-time-end').textContent = duration ? `−${fmtTime(Math.max(0, duration - time))}` : '—';
  if (tracks > 1) {
    $('p-tts-info').textContent =
      `Chapitre ${track + 1}/${tracks} · ${AudioEngine.tracks[track]?.title || ''}`;
  } else {
    $('p-tts-info').textContent = 'Livre audio';
  }
}

function onTtsPosition(p) {
  if (mode !== 'tts' || !book) return;
  if (!seeking) {
    const slider = $('p-seek');
    slider.max = Math.max(1, p.total - 1);
    slider.value = p.global;
  }
  const pct = p.total ? Math.round((p.global / p.total) * 100) : 0;
  $('p-time-cur').textContent = `${pct} %`;
  $('p-time-end').textContent = `${p.section + 1}/${p.sections}`;
  $('p-tts-info').textContent =
    `Chapitre ${p.section + 1}/${p.sections} · Phrase ${p.sentence + 1}/${Math.max(1, p.sectionSentences)}`;
}

/* ═══════════════ API publique ═══════════════ */

export function initPlayer(opts = {}) {
  onBack = opts.onBack || (() => {});
  refreshMini = opts.refreshMini || (() => {});
  onLibraryChanged = opts.onLibraryChanged || (() => {});

  buildSleepMenu();
  initReaderFont();

  $('btn-back').onclick = () => onBack();
  $('btn-play').onclick = () => activeEngine()?.toggle();

  $('btn-prev').onclick = () => {
    if (mode === 'audio') AudioEngine.skip(-30);
    else TTSEngine.prevSentence();
  };
  $('btn-next').onclick = () => {
    if (mode === 'audio') AudioEngine.skip(30);
    else TTSEngine.nextSentence();
  };

  // Curseur de progression (global : toutes pistes ou tout le texte)
  const slider = $('p-seek');
  slider.addEventListener('pointerdown', () => { seeking = true; });
  slider.addEventListener('input', () => {
    if (mode === 'audio') $('p-time-cur').textContent = fmtTime(Number(slider.value));
  });
  slider.addEventListener('change', () => {
    seeking = false;
    const v = Number(slider.value);
    if (mode === 'audio') AudioEngine.seek(v);
    else TTSEngine.seekGlobal(v);
  });
  slider.addEventListener('pointerup', () => { seeking = false; });

  // Réglages
  $('p-rate').onchange = () => {
    const r = Number($('p-rate').value);
    if (mode === 'audio') AudioEngine.setRate(r);
    else TTSEngine.setRate(r);
  };
  $('p-voice').onchange = () => {
    const v = speechSynthesis.getVoices().find((x) => x.name === $('p-voice').value);
    if (v) TTSEngine.setVoice(v);
  };

  // Chapitres (texte)
  $('p-chapters').onchange = () => TTSEngine.seekSection(Number($('p-chapters').value));
  $('btn-prev-chapter').onclick = () => TTSEngine.seekSection(TTSEngine.section - 1);
  $('btn-next-chapter').onclick = () => TTSEngine.seekSection(TTSEngine.section + 1);

  // Chapitres / pistes (audio multi-fichiers)
  $('p-audio-tracks').onchange = () => AudioEngine.seekTrack(Number($('p-audio-tracks').value));
  $('btn-prev-track').onclick = () => AudioEngine.prevTrack();
  $('btn-next-track').onclick = () => AudioEngine.nextTrack();

  // Taille du texte
  $('btn-font-minus').onclick = () => {
    const cur = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--reader-fs')) || 17;
    applyReaderFont(Math.max(14, cur - 1));
  };
  $('btn-font-plus').onclick = () => {
    const cur = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--reader-fs')) || 17;
    applyReaderFont(Math.min(24, cur + 1));
  };

  // Narrateur IA (livres texte uniquement)
  $('btn-ai').onclick = () => {
    if (mode !== 'tts' || !book) return;
    openAiModal(book, (newBook) => {
      toast('🤖 Livre audio IA créé : « ' + newBook.title + ' »');
      onLibraryChanged(newBook.id);
    }, (s, p) => {
      // progression affichée dans le panneau d'import
      window.dispatchEvent(new CustomEvent('flulivre-status', { detail: { status: s, pct: p } }));
    });
  };

  // Minuteur
  $('btn-sleep').onclick = (e) => {
    e.stopPropagation();
    $('sleep-menu').hidden = !$('sleep-menu').hidden;
  };
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.sleep-wrap')) $('sleep-menu').hidden = true;
  });

  /* ── Abonnements aux moteurs ── */
  AudioEngine.on('time', onAudioTime);
  AudioEngine.on('state', () => { updatePlayButtons(); refreshMini(); });
  AudioEngine.on('track', (i) => {
    if (mode !== 'audio') return;
    const sel = $('p-audio-tracks');
    if (sel.value !== String(i)) sel.value = i;
    onAudioTime({
      time: AudioEngine.globalTime(),
      duration: AudioEngine.total,
      track: i,
      tracks: AudioEngine.tracks.length
    });
  });
  AudioEngine.on('autoadvance', onAutoAdvance);

  TTSEngine.on('state', () => { updatePlayButtons(); refreshMini(); });
  TTSEngine.on('position', onTtsPosition);
  TTSEngine.on('sentence', (section, sentence) => {
    if (mode !== 'tts' || !book) return;
    highlightSentence(sentence);
  });
  TTSEngine.on('section', () => {
    if (mode !== 'tts' || !book) return;
    renderReader();
    onTtsPosition({
      section: TTSEngine.section,
      sentence: TTSEngine.sentence,
      sectionSentences: TTSEngine.sentences().length,
      sections: (book.sections || []).length,
      global: TTSEngine.globalIndex(),
      total: TTSEngine.totalSentences
    });
  });
  TTSEngine.on('autoadvance', onAutoAdvance);

  // Les voix du navigateur arrivent parfois en différé.
  if ('speechSynthesis' in window) {
    speechSynthesis.addEventListener('voiceschanged', () => {
      if (mode === 'tts' && !$('view-player').hidden) {
        buildVoiceOptions();
        if (!TTSEngine.voice) {
          const fr = speechSynthesis.getVoices().find((v) => (v.lang || '').toLowerCase().startsWith('fr'));
          if (fr) TTSEngine.setVoice(fr);
        }
      }
    });
  }
}

/** Affiche le lecteur pour un livre donné (moteur déjà chargé). */
export function showPlayer(b) {
  book = b;
  mode = b.type === 'audio' ? 'audio' : 'tts';

  $('view-library').hidden = true;
  $('view-player').hidden = false;

  $('p-cover').src = b.cover || '';
  $('p-title').textContent = b.title;
  $('p-author').textContent = b.author || (b.aiVoice ? 'Narrateur IA : ' + b.aiVoice : 'Auteur inconnu');
  $('p-format').textContent = { audio: 'Livre audio', epub: 'EPUB', pdf: 'PDF', txt: 'Texte' }[b.format] || b.format;

  buildRateOptions();
  seeking = false;

  if (mode === 'audio') {
    $('reader-pane').hidden = true;
    $('voice-wrap').hidden = true;
    $('btn-ai').hidden = true;
    $('p-tts-info').hidden = false;
    $('btn-prev').textContent = '−30 s';
    $('btn-next').textContent = '+30 s';
    $('btn-prev').title = 'Reculer de 30 secondes';
    $('btn-next').title = 'Avancer de 30 secondes';
    buildTrackOptions();
    const slider = $('p-seek');
    slider.max = Math.max(1, Math.floor(AudioEngine.total || b.duration || 0));
    slider.value = Math.floor(AudioEngine.globalTime());
  } else {
    $('reader-pane').hidden = false;
    $('voice-wrap').hidden = false;
    $('btn-ai').hidden = false;
    $('p-audio-chapters').hidden = true;
    $('p-tts-info').hidden = false;
    $('btn-prev').textContent = '¶ ←';
    $('btn-next').textContent = '→ ¶';
    $('btn-prev').title = 'Phrase précédente';
    $('btn-next').title = 'Phrase suivante';
    buildVoiceOptions();
    buildChapterOptions();
    renderReader();
  }

  updatePlayButtons();
}

/** Retour à la bibliothèque (le moteur continue de tourner). */
export function hidePlayer() {
  $('view-player').hidden = true;
  $('view-library').hidden = false;
  book = null;
  mode = null;
}

export function playerVisible() {
  return !$('view-player').hidden;
}
