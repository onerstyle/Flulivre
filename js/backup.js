/**
 * Flulivre — export / import de la bibliothèque (sauvegarde complète).
 *
 * Format de sauvegarde : un fichier ZIP contenant
 *   - flulivre-backup.json : toutes les métadonnées (titres, sections, progression…)
 *   - files/<id>.<format>  : les fichiers audio originaux
 *
 * Cela permet de transférer sa bibliothèque d'un appareil à un autre
 * (PC → téléphone par exemple) ou de la mettre à l'abri.
 */

import * as db from './db.js';

const MIME_AUDIO = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac',
  ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', webm: 'video/webm'
};

function needJsZip() {
  if (typeof JSZip === 'undefined') {
    throw new Error('La bibliothèque ZIP n’est pas chargée (connexion internet requise au premier lancement).');
  }
}

/**
 * Exporte toute la bibliothèque en un Blob ZIP téléchargeable.
 * @param {Array} books métadonnées des livres
 * @param {Function} onProgress(pourcentage 0-100)
 */
export async function exportLibrary(books, onProgress = () => {}) {
  needJsZip();
  if (!books.length) throw new Error('La bibliothèque est vide : rien à exporter.');

  const zip = new JSZip();
  const manifest = {
    app: 'flulivre',
    version: 1,
    exportedAt: new Date().toISOString(),
    books: []
  };

  for (const b of books) {
    manifest.books.push(b);
    if (b.type === 'audio') {
      // un fichier par piste (livres multi-chapitres) ou un seul (anciens livres)
      const keys = (b.tracks && b.tracks.length)
        ? b.tracks.map((_, i) => `${b.id}::${i}`)
        : [b.id];
      for (const k of keys) {
        const blob = await db.getFile(k);
        if (blob) zip.file(`files/${k}.${b.format || 'audio'}`, blob);
      }
    }
  }

  zip.file('flulivre-backup.json', JSON.stringify(manifest));

  const blob = await zip.generateAsync(
    { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
    (meta) => onProgress(meta.percent || 0)
  );
  return blob;
}

/**
 * Restaure une sauvegarde ZIP Flulivre.
 * Les livres sont fusionnés : un livre déjà présent (même id) est remplacé.
 * @returns {Promise<{count:number, audioRestored:number}>}
 */
export async function importBackup(file, onProgress = () => {}) {
  needJsZip();

  onProgress(10);
  const zip = await JSZip.loadAsync(file);
  const entry = zip.file('flulivre-backup.json');
  if (!entry) {
    throw new Error('Ce fichier n’est pas une sauvegarde Flulivre (flulivre-backup.json introuvable).');
  }

  let manifest;
  try {
    manifest = JSON.parse(await entry.async('string'));
  } catch (e) {
    throw new Error('Sauvegarde illisible (JSON invalide).');
  }
  if (!manifest || manifest.app !== 'flulivre' || !Array.isArray(manifest.books)) {
    throw new Error('Ce fichier n’est pas une sauvegarde Flulivre valide.');
  }

  const total = manifest.books.length;
  let audioRestored = 0;

  for (let i = 0; i < total; i++) {
    const b = manifest.books[i];
    if (!b || !b.id) continue;
    onProgress(15 + (i / total) * 80);

    if (b.type === 'audio') {
      const keys = (b.tracks && b.tracks.length)
        ? b.tracks.map((_, i) => `${b.id}::${i}`)
        : [b.id];
      for (const k of keys) {
        const f = zip.file(`files/${k}.${b.format || 'audio'}`) || zip.file(`files/${k}.audio`);
        if (f) {
          const data = await f.async('blob');
          const typed = new Blob([data], { type: MIME_AUDIO[b.format] || 'application/octet-stream' });
          await db.putFile(k, typed);
          audioRestored++;
        }
      }
    }
    await db.saveBookMeta(b);
  }

  onProgress(100);
  return { count: total, audioRestored };
}
