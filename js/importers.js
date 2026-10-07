/**
 * Flulivre — import des fichiers : EPUB, PDF (avec OCR si scanné), TXT et audio.
 *
 * Chaque importateur retourne :
 *   { book: {métadonnées}, blob?: Blob (audio uniquement), sparse?: bool (PDF scanné) }
 */

import { sectionize, htmlToText } from './text.js';

const AUDIO_EXT = new Set(['mp3', 'm4a', 'aac', 'flac', 'ogg', 'oga', 'opus', 'wav', 'webm']);

export function extOf(name) {
  return String(name).split('.').pop().toLowerCase();
}

export function isAudioFile(name) {
  return AUDIO_EXT.has(extOf(name));
}

/* ═══════════════════ Point d'entrée ═══════════════════ */

export async function importFile(file, onProgress = () => {}) {
  const ext = extOf(file.name);
  if (AUDIO_EXT.has(ext)) return importAudio(file, ext);
  if (ext === 'epub') return importEpub(file, onProgress);
  if (ext === 'pdf') return importPdf(file, onProgress);
  if (ext === 'txt' || ext === 'text') return importTxt(file);
  throw new Error(`Format non pris en charge : « .${ext} »`);
}

/* ═══════════════════ Audio ═══════════════════ */

/** Durée (en secondes) d'un Blob audio. */
export function probeDuration(blob) {
  return new Promise((resolve) => {
    const a = new Audio();
    a.preload = 'metadata';
    const u = URL.createObjectURL(blob);
    const done = (d) => { URL.revokeObjectURL(u); resolve(isFinite(d) ? d : 0); };
    a.onloadedmetadata = () => done(a.duration);
    a.onerror = () => done(0);
    a.src = u;
    setTimeout(() => done(0), 15000); // filet de sécurité
  });
}

async function importAudio(file, ext) {
  const duration = await probeDuration(file);
  return {
    blob: file,
    book: {
      type: 'audio',
      format: ext,
      title: file.name.replace(/\.[^.]+$/, ''),
      author: '',
      duration,
      position: { time: 0, duration },
      rate: 1,
      progress: 0
    }
  };
}

/* ═══════════════════ TXT ═══════════════════ */

async function importTxt(file) {
  const text = await file.text();
  if (!text.trim()) throw new Error('Ce fichier texte est vide.');
  return {
    book: {
      type: 'text',
      format: 'txt',
      title: file.name.replace(/\.(txt|text)$/i, ''),
      author: '',
      sections: sectionize(text, 'Texte'),
      position: { section: 0, sentence: 0 },
      rate: 1,
      progress: 0
    }
  };
}

/* ═══════════════════ EPUB ═══════════════════ */

function joinPath(base, href) {
  href = decodeURIComponent(String(href).split('#')[0]);
  if (href.startsWith('/')) href = href.slice(1);
  const parts = (base ? base.split('/') : []).concat(href.split('/'));
  const out = [];
  for (const p of parts) {
    if (p === '.' || p === '') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return out.join('/');
}

async function importEpub(file, onProgress) {
  if (typeof JSZip === 'undefined') {
    throw new Error('La bibliothèque ZIP n’a pas pu être chargée (connexion internet requise au premier lancement).');
  }

  const zip = await JSZip.loadAsync(await file.arrayBuffer());

  const containerFile = zip.file('META-INF/container.xml');
  if (!containerFile) throw new Error('EPUB invalide : container.xml introuvable.');
  const containerXml = await containerFile.async('string');
  const containerDoc = new DOMParser().parseFromString(containerXml, 'application/xml');
  const opfPath = containerDoc.querySelector('rootfile')?.getAttribute('full-path');
  if (!opfPath || !zip.file(opfPath)) throw new Error('EPUB invalide : fichier OPF introuvable.');

  const opfStr = await zip.file(opfPath).async('string');
  const opf = new DOMParser().parseFromString(opfStr, 'application/xml');
  const baseDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';

  // Métadonnées
  const meta = opf.getElementsByTagNameNS('*', 'metadata')[0] || opf;
  const title = (meta.getElementsByTagNameNS('*', 'title')[0]?.textContent || '').trim()
    || file.name.replace(/\.epub$/i, '');
  const author = (meta.getElementsByTagNameNS('*', 'creator')[0]?.textContent || '').trim();

  // Manifeste
  const manifest = new Map();
  for (const item of opf.getElementsByTagNameNS('*', 'item')) {
    manifest.set(item.getAttribute('id'), {
      href: item.getAttribute('href'),
      type: item.getAttribute('media-type') || '',
      props: item.getAttribute('properties') || ''
    });
  }

  // Couverture : item « cover-image » ou meta name="cover"
  let cover = null;
  try {
    let coverItem = [...manifest.values()].find((i) => i.props.includes('cover-image'));
    if (!coverItem) {
      const coverMeta = [...opf.getElementsByTagNameNS('*', 'meta')]
        .find((m) => m.getAttribute('name') === 'cover');
      if (coverMeta) coverItem = manifest.get(coverMeta.getAttribute('content'));
    }
    if (coverItem && coverItem.type.startsWith('image/')) {
      const f = zip.file(joinPath(baseDir, coverItem.href));
      if (f) {
        const b64 = await f.async('base64');
        if (b64.length < 2_000_000) cover = `data:${coverItem.type};base64,${b64}`;
      }
    }
  } catch (e) { /* couverture facultative */ }

  // Spine → chapitres
  const idrefs = [...opf.getElementsByTagNameNS('*', 'itemref')].map((n) => n.getAttribute('idref'));
  const sections = [];
  let chapterCount = 0;

  for (let i = 0; i < idrefs.length; i++) {
    const item = manifest.get(idrefs[i]);
    if (!item) continue;
    if (!/html|xml/.test(item.type)) continue;
    onProgress(`Extraction du chapitre ${i + 1}/${idrefs.length}…`, i / idrefs.length);

    const f = zip.file(joinPath(baseDir, item.href));
    if (!f) continue;
    let str;
    try { str = await f.async('string'); } catch (e) { continue; }

    const doc = new DOMParser().parseFromString(str, 'text/html');
    const body = doc.body || doc.documentElement;
    const text = htmlToText(body);
    if (text.replace(/\s/g, '').length < 40) continue; // page quasi vide (couverture, table…)

    chapterCount++;
    const heading = body.querySelector('h1, h2, h3');
    const secTitle = (heading?.textContent || '').trim().slice(0, 90) || `Chapitre ${chapterCount}`;
    sections.push({ title: secTitle, text });
  }

  if (!sections.length) throw new Error('Aucun texte lisible trouvé dans cet EPUB.');

  return {
    book: {
      type: 'text',
      format: 'epub',
      title,
      author,
      cover,
      sections,
      position: { section: 0, sentence: 0 },
      rate: 1,
      progress: 0
    }
  };
}

/* ═══════════════════ PDF ═══════════════════ */

const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

function ensurePdfJs() {
  if (typeof pdfjsLib === 'undefined') {
    throw new Error('La bibliothèque PDF n’a pas pu être chargée (connexion internet requise au premier lancement).');
  }
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
}

async function openPdf(file) {
  ensurePdfJs();
  const data = await file.arrayBuffer();
  try {
    return await pdfjsLib.getDocument({ data }).promise;
  } catch (e) {
    throw new Error('Impossible d’ouvrir ce PDF (fichier corrompu ou protégé).');
  }
}

/** Regroupe des pages en sections de `group` pages. */
function pagesToSections(pages, group, suffix = '') {
  const sections = [];
  for (let i = 0; i < pages.length; i += group) {
    const slice = pages.slice(i, i + group);
    const t0 = i + 1;
    const t1 = Math.min(i + group, pages.length);
    sections.push({
      title: t0 === t1 ? `Page ${t0}${suffix}` : `Pages ${t0}–${t1}${suffix}`,
      text: slice.join('\n\n')
    });
  }
  return sections;
}

async function importPdf(file, onProgress) {
  const pdf = await openPdf(file);
  const pages = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    onProgress(`Extraction du texte — page ${p}/${pdf.numPages}`, p / pdf.numPages);
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    let line = '';
    const chunks = [];
    for (const it of tc.items) {
      if (typeof it.str !== 'string') continue;
      line += it.str;
      if (it.hasEOL) { chunks.push(line.trim()); line = ''; }
    }
    if (line.trim()) chunks.push(line.trim());
    pages.push(chunks.filter(Boolean).join('\n'));
  }

  // Métadonnées du PDF (titre éventuel)
  let title = file.name.replace(/\.pdf$/i, '');
  try {
    const md = await pdf.getMetadata();
    if (md?.info?.Title && String(md.info.Title).trim()) title = String(md.info.Title).trim();
  } catch (e) { /* ignore */ }

  const totalChars = pages.join('').replace(/\s/g, '').length;
  const sparse = totalChars / Math.max(1, pdf.numPages) < 60; // probablement un scanné

  return {
    sparse,
    book: {
      type: 'text',
      format: 'pdf',
      title,
      author: '',
      sections: pagesToSections(pages, 10),
      position: { section: 0, sentence: 0 },
      rate: 1,
      progress: 0
    }
  };
}

/**
 * Reconnaissance de caractères (OCR) pour les PDF scannés,
 * via Tesseract.js (modèle français, téléchargé au premier usage).
 */
export async function ocrPdf(file, onProgress) {
  ensurePdfJs();
  if (typeof Tesseract === 'undefined') {
    throw new Error('La bibliothèque OCR n’a pas pu être chargée (connexion internet requise).');
  }

  const pdf = await openPdf(file);
  onProgress('Préparation du modèle de reconnaissance française…', 0);

  let worker;
  try {
    worker = await Tesseract.createWorker('fra');
  } catch (e) {
    throw new Error('Impossible de charger le modèle OCR français (vérifiez votre connexion internet).');
  }

  const pages = [];
  try {
    for (let p = 1; p <= pdf.numPages; p++) {
      onProgress(`Reconnaissance de caractères — page ${p}/${pdf.numPages}`, (p - 1) / pdf.numPages);
      const page = await pdf.getPage(p);
      const vp1 = page.getViewport({ scale: 1 });
      const scale = Math.min(2.2, 1400 / vp1.width);
      const vp = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;

      const { data } = await worker.recognize(canvas);
      pages.push((data.text || '').trim());
      onProgress(`Reconnaissance de caractères — page ${p}/${pdf.numPages}`, p / pdf.numPages);
    }
  } finally {
    try { await worker.terminate(); } catch (e) { /* ignore */ }
  }

  if (pages.every((t) => !t.trim())) {
    throw new Error('L’OCR n’a détecté aucun texte dans ce PDF.');
  }

  return { sections: pagesToSections(pages, 8, ' (OCR)') };
}
