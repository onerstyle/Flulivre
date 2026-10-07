/**
 * Flulivre — affichage de la bibliothèque (grille de livres).
 */

import { escapeHtml } from './utils.js';

const FORMAT_LABEL = { audio: 'Livre audio', epub: 'EPUB', pdf: 'PDF', txt: 'Texte' };

/**
 * Affiche la grille de livres.
 * @param {Array} books livres à afficher
 * @param {Function} onOpen callback(id) à l'ouverture d'un livre
 * @param {Function} onDelete callback(id) à la suppression
 */
export function renderLibrary(books, onOpen, onDelete, totalCount = books.length) {
  const grid = document.getElementById('library-grid');
  const empty = document.getElementById('library-empty');
  const count = document.getElementById('lib-count');

  count.textContent = totalCount ? `${totalCount} livre${totalCount > 1 ? 's' : ''}` : '';

  if (!totalCount) {
    grid.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  if (!books.length) {
    grid.innerHTML = '<p class="muted" style="grid-column:1/-1">Aucun résultat pour cette recherche.</p>';
    return;
  }

  grid.innerHTML = books.map((b) => {
    const pct = Math.round((b.progress || 0) * 100);
    return `
      <article class="book-card" data-id="${b.id}" title="${escapeHtml(b.title)}">
        <div class="cover-wrap">
          <img src="${b.cover || ''}" alt="" loading="lazy">
          <button class="card-play" title="Écouter">▶</button>
          <button class="card-del" title="Supprimer">✕</button>
          ${pct > 0 && pct < 100 ? `<div class="card-progress"><div style="width:${pct}%"></div></div>` : ''}
        </div>
        <div class="card-title">${escapeHtml(b.title)}</div>
        <div class="card-author">${escapeHtml(b.author || '')}</div>
        <div class="card-sub">
          <span>${FORMAT_LABEL[b.format] || b.format}</span>
          ${pct > 0 ? `<span class="pct">${pct} %</span>` : ''}
        </div>
      </article>`;
  }).join('');

  grid.onclick = (e) => {
    const card = e.target.closest('.book-card');
    if (!card) return;
    const id = card.dataset.id;
    if (e.target.closest('.card-del')) { onDelete(id); return; }
    onOpen(id);
  };
}
