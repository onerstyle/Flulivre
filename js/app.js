/**
 * Flulivre — module principal : bibliothèque, imports, routage entre vues,
 * mini-lecteur, raccourcis clavier et livre d'exemple.
 */

import * as db from './db.js';
import { AudioEngine } from './audio.js';
import { TTSEngine } from './tts.js';
import { importFile, ocrPdf, isAudioFile, probeDuration } from './importers.js';
import { exportLibrary, importBackup } from './backup.js';
import { renderLibrary } from './library.js';
import { initPlayer, showPlayer, hidePlayer, playerVisible } from './player.js';
import { SAMPLE } from './sample.js';
import { sectionize } from './text.js';
import { uid, makeCover, escapeHtml, toast, fmtTime } from './utils.js';

const $ = (id) => document.getElementById(id);

let books = [];

/* ═════════════════ Moteurs ═════════════════ */

AudioEngine.onPersist = (b) => db.saveBookMeta(b).catch(console.error);
TTSEngine.onPersist = (b) => db.saveBookMeta(b).catch(console.error);

function activeEngine() {
  if (AudioEngine.book) return AudioEngine;
  if (TTSEngine.book) return TTSEngine;
  return null;
}

/* ═════════════════ Bibliothèque ═════════════════ */

function sortedBooks() {
  return [...books].sort((a, b) => (b.lastPlayedAt || b.addedAt || 0) - (a.lastPlayedAt || a.addedAt || 0));
}

function refreshLibrary() {
  const q = $('search').value.trim().toLowerCase();
  const list = sortedBooks().filter((b) =>
    !q || (b.title || '').toLowerCase().includes(q) || (b.author || '').toLowerCase().includes(q)
  );
  $('library-empty').hidden = books.length > 0;
  renderLibrary(list, openBook, deleteBook, books.length);
}

async function deleteBook(id) {
  const b = books.find((x) => x.id === id);
  if (!b) return;
  if (!confirm(`Supprimer « ${b.title} » de la bibliothèque ?`)) return;

  const eng = activeEngine();
  if (eng && eng.book?.id === id) {
    eng.unload();
    if (playerVisible()) hidePlayer();
    refreshMini();
  }
  await db.deleteBook(id);
  books = books.filter((x) => x.id !== id);
  refreshLibrary();
  toast('Livre supprimé.');
}

/* ═════════════════ Ouverture d'un livre ═════════════════ */

async function openBook(id) {
  const meta = books.find((b) => b.id === id);
  if (!meta) return;

  try {
    if (meta.type === 'audio') {
      TTSEngine.unload();
      let blobs;
      if (meta.tracks && meta.tracks.length) {
        blobs = [];
        for (let i = 0; i < meta.tracks.length; i++) {
          const bb = await db.getFile(`${id}::${i}`);
          if (!bb) { toast(`Piste ${i + 1} introuvable. Réimportez ce livre.`); return; }
          blobs.push(bb);
        }
      } else {
        const bb = await db.getFile(id);
        if (!bb) { toast('Fichier audio introuvable. Réimportez ce livre.'); return; }
        blobs = [bb];
      }
      if ((meta.progress || 0) >= 0.995) { meta.position = { track: 0, time: 0 }; meta.progress = 0; }
      AudioEngine.load(meta, blobs);
      showPlayer(meta);
      AudioEngine.play();
      updateMediaMeta(meta);
    } else {
      AudioEngine.unload();
      if ((meta.progress || 0) >= 0.995) { meta.position = { section: 0, sentence: 0 }; meta.progress = 0; }
      if (!TTSEngine.supported) { toast('La synthèse vocale n’est pas disponible dans ce navigateur.'); return; }
      TTSEngine.load(meta);
      showPlayer(meta);
      TTSEngine.play();
      updateMediaMeta(meta);
    }
    meta.lastPlayedAt = Date.now();
    db.saveBookMeta(meta).catch(console.error);
    refreshLibrary();
    refreshMini();
  } catch (e) {
    console.error(e);
    toast('Impossible d’ouvrir ce livre : ' + (e.message || e));
  }
}

function goHome() {
  hidePlayer();
  refreshLibrary();
  refreshMini();
}

/* ═════════════════ Mini-lecteur ═════════════════ */

function refreshMini() {
  const eng = activeEngine();
  const mini = $('miniplayer');
  if (!eng || !eng.book || playerVisible()) { mini.hidden = true; return; }

  const b = eng.book;
  mini.hidden = false;
  $('mp-cover').src = b.cover || '';
  $('mp-title').textContent = b.title;
  $('mp-play').textContent = eng.state === 'playing' ? '⏸' : '▶';

  if (eng === AudioEngine) {
    const t = AudioEngine.globalTime();
    const d = AudioEngine.total || b.duration || 0;
    $('mp-sub').textContent = `${fmtTime(t)} · ${d ? Math.round((t / d) * 100) : 0} %`;
    $('mp-progress').firstElementChild.style.width = d ? `${(t / d) * 100}%` : '0%';
  } else {
    const total = TTSEngine.totalSentences;
    const pct = total ? Math.round((TTSEngine.globalIndex() / total) * 100) : 0;
    $('mp-sub').textContent = `Chapitre ${TTSEngine.section + 1} · ${pct} %`;
    $('mp-progress').firstElementChild.style.width = `${pct}%`;
  }
}

/* ═════════════════ Imports ═════════════════ */

function addImportEntry(name) {
  const panel = $('import-panel');
  const el = document.createElement('div');
  el.className = 'import-entry';
  el.innerHTML = `
    <div class="ie-name">${escapeHtml(name)}</div>
    <div class="ie-status">Analyse du fichier…</div>
    <div class="ie-bar"><div></div></div>`;
  panel.appendChild(el);
  return {
    set(status, pct) {
      el.querySelector('.ie-status').textContent = status;
      if (typeof pct === 'number') el.querySelector('.ie-bar div').style.width = `${Math.round(pct * 100)}%`;
    },
    done() {
      this.set('Importé ✓', 1);
      setTimeout(() => el.remove(), 1400);
    },
    fail(msg) {
      const s = el.querySelector('.ie-status');
      s.textContent = 'Échec : ' + msg;
      s.classList.add('error');
      setTimeout(() => el.remove(), 6000);
    }
  };
}

/** Modale générique renvoyant une promesse (true = confirmé). */
function askModal(title, html, okLabel) {
  return new Promise((resolve) => {
    const root = $('modal-root');
    root.hidden = false;
    root.innerHTML = `
      <div class="modal-card">
        <h3>${escapeHtml(title)}</h3>
        <p>${html}</p>
        <div class="modal-actions">
          <button class="btn-ghost" data-act="no">Annuler</button>
          <button class="btn-primary" data-act="yes">${escapeHtml(okLabel)}</button>
        </div>
      </div>`;
    root.onclick = (e) => {
      const act = e.target.closest('button')?.dataset.act;
      if (!act && e.target !== root) return;
      root.hidden = true;
      root.innerHTML = '';
      resolve(act === 'yes');
    };
  });
}

/** Modale avec champ texte (pour nommer un livre multi-pistes). */
function askModalTitle(title, html, def) {
  return new Promise((resolve) => {
    const root = $('modal-root');
    root.hidden = false;
    root.innerHTML = `
      <div class="modal-card">
        <h3>${escapeHtml(title)}</h3>
        <p>${html}</p>
        <div class="ai-form"><input id="modal-input" value="${escapeHtml(def)}"></div>
        <div class="modal-actions">
          <button class="btn-ghost" data-act="no">Annuler</button>
          <button class="btn-primary" data-act="yes">Valider</button>
        </div>
      </div>`;
    root.onclick = (e) => {
      const act = e.target.closest('button')?.dataset.act;
      if (!act && e.target !== root) return;
      const val = root.querySelector('#modal-input').value.trim();
      root.hidden = true;
      root.innerHTML = '';
      resolve(act === 'yes' ? (val || def) : null);
    };
  });
}

/** Titre deviné à partir d'un ensemble de fichiers (préfixe commun). */
function commonTitle(files) {
  const names = files.map((f) => f.name.replace(/\.[^.]+$/, ''));
  let pre = names[0] || '';
  for (const n of names) while (pre && !n.startsWith(pre)) pre = pre.slice(0, -1);
  pre = pre.replace(/[\s_\-·]+$/, '');
  return pre.length >= 3 ? pre : `Livre audio (${files.length} pistes)`;
}

/** Import d'un seul fichier (audio ou texte), avec OCR éventuel. */
async function importSingle(file) {
  const entry = addImportEntry(file.name);
  try {
    const res = await importFile(file, (s, p) => entry.set(s, p));
    let book = res.book;

    // PDF scanné → proposer la reconnaissance de caractères (OCR)
    if (res.sparse && book.sections) {
      const ok = await askModal(
        'Reconnaissance de caractères',
        `Le PDF « <strong>${escapeHtml(file.name)}</strong> » semble être un document scanné : ` +
        `très peu de texte a pu être extrait directement.<br><br>` +
        `Voulez-vous lancer la <strong>reconnaissance de caractères (OCR)</strong> ? ` +
        `Cela peut prendre quelques minutes selon le nombre de pages.`,
        'Lancer l’OCR'
      );
      if (ok) {
        entry.set('Préparation de l’OCR…', 0);
        const ocr = await ocrPdf(file, (s, p) => entry.set(s, p));
        book.sections = ocr.sections;
        book.ocr = true;
      }
    }

    book.id = uid();
    book.addedAt = Date.now();
    book.lastPlayedAt = book.addedAt;
    if (!book.cover) book.cover = makeCover(book);

    if (res.blob) await db.putFile(book.id, res.blob);
    await db.saveBookMeta(book);

    books.unshift(book);
    refreshLibrary();
    entry.done();
    toast(`« ${book.title} » ajouté à la bibliothèque 🎉`);
  } catch (err) {
    console.error(err);
    entry.fail(err.message || String(err));
    toast('Échec de l’import : ' + (err.message || err), 4500);
  }
}

/** Plusieurs fichiers audio → un seul livre avec chapitres. */
async function importMultiAudio(audioFiles) {
  const entry = addImportEntry(`📚 ${audioFiles.length} fichiers audio`);
  try {
    entry.set('Tri des pistes…', 0);
    audioFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

    const title = await askModalTitle(
      'Un livre, plusieurs chapitres',
      'Donnez un titre à ce livre audio :',
      commonTitle(audioFiles)
    );
    if (!title) { entry.fail('Import annulé.'); return; }

    const tracks = [];
    const blobs = [];
    for (let i = 0; i < audioFiles.length; i++) {
      entry.set(`Analyse de la piste ${i + 1}/${audioFiles.length}…`, i / audioFiles.length);
      const d = await probeDuration(audioFiles[i]);
      tracks.push({ title: audioFiles[i].name.replace(/\.[^.]+$/, ''), duration: d });
      blobs.push(audioFiles[i]);
    }

    const book = {
      id: uid(),
      type: 'audio',
      format: audioFiles[0].name.split('.').pop().toLowerCase(),
      title,
      author: '',
      tracks,
      duration: tracks.reduce((s, t) => s + (t.duration || 0), 0),
      position: { track: 0, time: 0 },
      rate: 1,
      progress: 0,
      addedAt: Date.now(),
      lastPlayedAt: Date.now()
    };
    book.cover = makeCover(book);

    for (let i = 0; i < blobs.length; i++) await db.putFile(`${book.id}::${i}`, blobs[i]);
    await db.saveBookMeta(book);

    books.unshift(book);
    refreshLibrary();
    entry.done();
    toast(`« ${title} » ajouté (${tracks.length} chapitres) 🎉`);
  } catch (err) {
    console.error(err);
    entry.fail(err.message || String(err));
  }
}

async function handleFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;

  const audioFiles = files.filter((f) => isAudioFile(f.name));
  const others = files.filter((f) => !isAudioFile(f.name));

  if (audioFiles.length > 1) {
    const oneBook = await askModal(
      'Plusieurs fichiers audio détectés',
      `Vous avez déposé <strong>${audioFiles.length} fichiers audio</strong> ` +
      `(par exemple les chapitres d'un même livre).<br>Comment les importer ?`,
      'Un seul livre avec chapitres'
    );
    if (oneBook) await importMultiAudio(audioFiles);
    else for (const f of audioFiles) await importSingle(f);
  } else if (audioFiles.length === 1) {
    await importSingle(audioFiles[0]);
  }

  for (const f of others) await importSingle(f);
  $('file-input').value = '';
}

/* ═════════════════ Export / import de la bibliothèque ═════════════════ */

async function exportBackup() {
  if (!books.length) { toast('La bibliothèque est vide : rien à exporter.'); return; }
  const entry = addImportEntry('💾 Sauvegarde de la bibliothèque');
  try {
    entry.set('Préparation…', 0);
    const blob = await exportLibrary(books, (p) => entry.set(`Compression… ${Math.round(p)} %`, p));
    const name = `flulivre-sauvegarde-${new Date().toISOString().slice(0, 10)}.zip`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    entry.done();
    toast(`Sauvegarde téléchargée ✅ (${books.length} livre${books.length > 1 ? 's' : ''})`);
  } catch (e) {
    console.error(e);
    entry.fail(e.message || String(e));
  }
}

async function restoreBackup(file) {
  const entry = addImportEntry('📂 Restauration : ' + file.name);
  try {
    entry.set('Lecture de la sauvegarde…', 0);
    const res = await importBackup(file, (p) => entry.set(`Restauration… ${Math.round(p)} %`, p));
    books = (await db.getAllBooks()) || [];
    refreshLibrary();
    entry.done();
    toast(`Sauvegarde restaurée ✅ ${res.count} livre${res.count > 1 ? 's' : ''}` +
      (res.audioRestored ? ` (dont ${res.audioRestored} audio)` : ''));
  } catch (e) {
    console.error(e);
    entry.fail(e.message || String(e));
  }
}

/* ═════════════════ Livre d'exemple ═════════════════ */

async function addSample() {
  const existing = books.find((b) => b.id === 'sample-candide');
  if (existing) { openBook(existing.id); return; }

  const book = {
    id: 'sample-candide',
    type: 'text',
    format: 'txt',
    title: SAMPLE.title,
    author: SAMPLE.author,
    sections: sectionize(SAMPLE.text, 'Chapitre I'),
    position: { section: 0, sentence: 0 },
    rate: 1,
    progress: 0,
    sample: true,
    addedAt: Date.now(),
    lastPlayedAt: Date.now()
  };
  book.cover = makeCover(book);
  await db.saveBookMeta(book);
  books.unshift(book);
  refreshLibrary();
  openBook(book.id);
}

/* ═════════════════ Initialisation ═════════════════ */

async function init() {
  // Chargement de la bibliothèque
  try {
    books = (await db.getAllBooks()) || [];
  } catch (e) {
    console.error('IndexedDB indisponible :', e);
    toast('Attention : le stockage local est indisponible (navigation privée ?)', 5000);
    books = [];
  }
  refreshLibrary();

  // Navigation
  $('btn-home').onclick = goHome;
  initPlayer({
    onBack: goHome,
    refreshMini,
    onLibraryChanged: async () => {
      books = (await db.getAllBooks()) || [];
      refreshLibrary();
      if (aiEntry) { aiEntry.done(); aiEntry = null; }
    }
  });

  // Thème clair / sombre (mémorisé)
  const savedTheme = localStorage.getItem('flulivre-theme') ||
    (window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  applyTheme(savedTheme);
  $('btn-theme').onclick = () =>
    applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light');

  // Progression de la narration IA (panneau d'import)
  window.addEventListener('flulivre-status', (e) => {
    if (!aiEntry) aiEntry = addImportEntry('🤖 Narration IA en cours');
    aiEntry.set(e.detail.status, e.detail.pct || 0);
  });

  // Contrôles écran verrouillé / Bluetooth / casque
  setupMediaSession();

  // Imports
  $('btn-import').onclick = () => $('file-input').click();
  $('btn-import-empty').onclick = () => $('file-input').click();
  $('file-input').onchange = (e) => handleFiles(e.target.files);
  $('btn-sample').onclick = addSample;
  $('search').oninput = refreshLibrary;

  // Export / restauration de la bibliothèque
  $('btn-export').onclick = exportBackup;
  $('btn-restore').onclick = () => $('restore-input').click();
  $('restore-input').onchange = (e) => {
    const f = e.target.files[0];
    if (f) restoreBackup(f);
    e.target.value = '';
  };

  // Glisser-déposer de fichiers (.zip = restauration de sauvegarde)
  ['dragenter', 'dragover'].forEach((ev) =>
    document.addEventListener(ev, (e) => { e.preventDefault(); })
  );
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = e.dataTransfer?.files;
    if (!files?.length) return;
    if (files.length === 1 && /\.zip$/i.test(files[0].name)) restoreBackup(files[0]);
    else handleFiles(files);
  });

  // Mini-lecteur
  $('miniplayer').onclick = (e) => {
    if (e.target.closest('#mp-play')) return;
    const eng = activeEngine();
    if (eng?.book) openBook(eng.book.id);
  };
  $('mp-play').onclick = (e) => {
    e.stopPropagation();
    activeEngine()?.toggle();
  };
  AudioEngine.on('time', refreshMiniThrottled);
  TTSEngine.on('position', refreshMiniThrottled);
  AudioEngine.on('state', refreshMini);
  TTSEngine.on('state', refreshMini);

  // Raccourcis clavier
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea')) return;
    const eng = activeEngine();
    if (!eng) return;
    if (e.code === 'Space') { e.preventDefault(); eng.toggle(); }
    else if (e.key === 'ArrowRight') { eng === AudioEngine ? eng.skip(15) : eng.nextSentence(); }
    else if (e.key === 'ArrowLeft') { eng === AudioEngine ? eng.skip(-15) : eng.prevSentence(); }
  });

  // Fin de lecture
  AudioEngine.on('state', (s) => { if (s === 'ended') toast('Lecture terminée 🎉'); });
  TTSEngine.on('ended', () => toast('Lecture terminée 🎉'));

  // Sauvegarde de la position en fermant la page
  window.addEventListener('beforeunload', () => activeEngine()?.persistNow?.());

  refreshMini();
}

let _miniLast = 0;
function refreshMiniThrottled() {
  const now = Date.now();
  if (now - _miniLast > 500) { _miniLast = now; refreshMini(); }
}

/* ═════════════════ Thème ═════════════════ */

let aiEntry = null;

function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('flulivre-theme', t);
  const btn = $('btn-theme');
  btn.textContent = t === 'light' ? '☀️' : '🌙';
  btn.title = t === 'light' ? 'Passer au thème sombre' : 'Passer au thème clair';
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.content = t === 'light' ? '#eef1f6' : '#0e1116';
}

/* ═════════════════ Media Session (écran verrouillé, casque, Bluetooth) ═════════════════ */

function setupMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;
  const safe = (action, fn) => { try { ms.setActionHandler(action, fn); } catch (e) { /* non supporté */ } };
  safe('play', () => activeEngine()?.play());
  safe('pause', () => activeEngine()?.pause());
  safe('seekbackward', () => { if (AudioEngine.book) AudioEngine.skip(-15); });
  safe('seekforward', () => { if (AudioEngine.book) AudioEngine.skip(15); });
  safe('previoustrack', () => {
    if (AudioEngine.book) AudioEngine.prevTrack();
    else if (TTSEngine.book) TTSEngine.seekSection(TTSEngine.section - 1);
  });
  safe('nexttrack', () => {
    if (AudioEngine.book) AudioEngine.nextTrack();
    else if (TTSEngine.book) TTSEngine.seekSection(TTSEngine.section + 1);
  });
}

function updateMediaMeta(b) {
  if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: b.title,
      artist: b.author || 'Flulivre',
      album: 'Flulivre',
      artwork: b.cover ? [{ src: b.cover, sizes: '1024x1024', type: 'image/png' }] : []
    });
  } catch (e) { /* ignore */ }
}

/* ── PWA : enregistrement du service worker (installation + hors-ligne) ── */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service Worker :', e));
  });
}

init();
