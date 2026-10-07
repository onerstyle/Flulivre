/**
 * Flulivre — persistance locale via IndexedDB.
 *
 * Deux magasins :
 *  - "books" : les métadonnées (titre, auteur, progression, sections de texte…)
 *  - "files" : les fichiers audio (Blob), stockés à part pour des lectures rapides.
 */

const DB_NAME = 'flulivre';
const DB_VERSION = 1;
const STORE_BOOKS = 'books';
const STORE_FILES = 'files';

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_BOOKS)) {
        db.createObjectStore(STORE_BOOKS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_FILES)) {
        db.createObjectStore(STORE_FILES);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function tx(db, stores, mode) {
  return db.transaction(stores, mode);
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Tous les livres (métadonnées). */
export async function getAllBooks() {
  const db = await openDB();
  return wrap(tx(db, STORE_BOOKS, 'readonly').objectStore(STORE_BOOKS).getAll());
}

/** Sauvegarde / mise à jour d'un livre. */
export async function saveBookMeta(book) {
  const db = await openDB();
  return wrap(tx(db, STORE_BOOKS, 'readwrite').objectStore(STORE_BOOKS).put(book));
}

/** Supprime un livre ET son fichier audio éventuel. */
export async function deleteBook(id) {
  const db = await openDB();
  await wrap(tx(db, STORE_BOOKS, 'readwrite').objectStore(STORE_BOOKS).delete(id));
  await wrap(tx(db, STORE_FILES, 'readwrite').objectStore(STORE_FILES).delete(id));
}

/** Stocke le Blob audio d'un livre. */
export async function putFile(id, blob) {
  const db = await openDB();
  return wrap(tx(db, STORE_FILES, 'readwrite').objectStore(STORE_FILES).put(blob, id));
}

/** Récupère le Blob audio d'un livre. */
export async function getFile(id) {
  const db = await openDB();
  return wrap(tx(db, STORE_FILES, 'readonly').objectStore(STORE_FILES).get(id));
}
