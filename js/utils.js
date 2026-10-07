/**
 * Flulivre — utilitaires généraux.
 */

/** Identifiant unique court. */
export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Formate une durée en "h:mm:ss" ou "m:ss". */
export function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Formate une durée en texte court : "1 h 05 min", "12 min"… */
export function fmtDurationShort(sec) {
  if (!isFinite(sec) || sec <= 0) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`;
  if (m > 0) return `${m} min`;
  return `${Math.round(sec)} s`;
}

/** Teinte (0-359) dérivée d'une chaîne — pour générer des couvertures colorées. */
export function hashHue(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return h;
}

/** Protège une chaîne avant injection dans du HTML. */
export function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Limitateur d'appels (au plus une exécution tous les `ms`). */
export function throttle(fn, ms) {
  let last = 0;
  let timer = null;
  return (...args) => {
    const now = Date.now();
    const call = () => { last = Date.now(); timer = null; fn(...args); };
    if (now - last >= ms) call();
    else if (!timer) timer = setTimeout(call, ms - (now - last));
  };
}

/** Affiche une notification éphémère. */
export function toast(msg, ms = 2800) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, ms);
}

/**
 * Génère une couverture de livre (dataURL) quand le fichier n'en contient pas.
 * Dégradé de couleur dérivé du titre + typographie.
 */
export function makeCover({ title = 'Sans titre', author = '', format = '' }) {
  const W = 320, H = 480;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  const hue = hashHue(title);
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, `hsl(${hue}, 45%, 30%)`);
  g.addColorStop(1, `hsl(${(hue + 45) % 360}, 55%, 16%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Fine bordure décorative
  ctx.strokeStyle = 'rgba(255,255,255,.25)';
  ctx.lineWidth = 2;
  ctx.strokeRect(14, 14, W - 28, H - 28);

  // Badge de format
  const label = String(format || '').toUpperCase();
  if (label) {
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(label, 28, 42);
  }

  // Titre (avec retour à la ligne)
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.font = '700 27px Georgia, serif';
  const words = String(title).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > W - 64 && line) { lines.push(line); line = w; }
    else line = test;
    if (lines.length === 6) break;
  }
  if (line && lines.length < 7) lines.push(line);
  const shown = lines.slice(0, 7);
  let y = H / 2 - ((shown.length - 1) * 34) / 2;
  for (const l of shown) { ctx.fillText(l, W / 2, y); y += 34; }

  // Auteur
  if (author) {
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    ctx.font = '500 16px Georgia, serif';
    ctx.fillText(author, W / 2, H - 44);
  }

  return canvas.toDataURL('image/jpeg', 0.88);
}
