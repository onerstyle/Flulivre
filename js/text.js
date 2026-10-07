/**
 * Flulivre — traitement du texte : découpage en sections, en phrases,
 * conversion HTML → texte brut.
 */

/**
 * Découpe un texte en phrases (gère . ! ? … et les guillemets fermants).
 * Les phrases trop courtes sont fusionnées avec la précédente.
 */
export function splitSentences(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return [];
  const parts = t.match(/[^.!?…]+[.!?…]+(?:["»’”)\]]+\s*|\s+|$)|[^.!?…]+$/g) || [t];
  const out = [];
  for (let p of parts) {
    p = p.trim();
    if (!p) continue;
    if (p.length < 3 && out.length > 0) out[out.length - 1] += ' ' + p;
    else out.push(p);
  }
  return out;
}

/**
 * Découpe un long texte en sections d'environ `maxChars` caractères,
 * en coupant entre les paragraphes.
 */
export function sectionize(text, baseTitle = 'Texte', maxChars = 45000) {
  const paras = String(text || '')
    .replace(/\r\n?/g, '\n')
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const sections = [];
  let cur = [];
  let len = 0;

  const flush = () => {
    if (!cur.length) return;
    const n = sections.length + 1;
    sections.push({
      title: `${baseTitle} · partie ${n}`,
      text: cur.join('\n\n')
    });
    cur = [];
    len = 0;
  };

  for (const p of paras) {
    if (len + p.length > maxChars && cur.length) flush();
    cur.push(p);
    len += p.length + 2;
  }
  flush();

  if (!sections.length) sections.push({ title: baseTitle, text: '' });
  // S'il n'y a qu'une seule partie, on garde simplement le titre de base.
  if (sections.length === 1) sections[0].title = baseTitle;
  return sections;
}

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'HEAD', 'META', 'LINK', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'NAV', 'ASIDE']);
const BLOCK_TAGS = new Set([
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'UL', 'OL', 'DIV', 'BLOCKQUOTE',
  'TABLE', 'TR', 'SECTION', 'ARTICLE', 'FIGURE', 'FIGCAPTION', 'HEADER', 'FOOTER',
  'HR', 'DT', 'DD', 'PRE', 'MAIN'
]);

/**
 * Convertit un document/élément HTML en texte brut structuré
 * (un saut de ligne par bloc). Utilisé pour les fichiers EPUB.
 */
export function htmlToText(root) {
  const out = [];

  (function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      out.push(node.nodeValue);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName;
    if (SKIP_TAGS.has(tag)) return;
    if (tag === 'BR') { out.push('\n'); return; }
    for (const child of node.childNodes) walk(child);
    if (BLOCK_TAGS.has(tag)) out.push('\n');
  })(root);

  return out.join('')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
