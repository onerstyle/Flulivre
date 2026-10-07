/**
 * Flulivre — prépare le dossier « www/ » (la version web embarquée dans l'APK).
 * Sans aucune dépendance : node scripts/build-www.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'www');

const ITEMS = [
  'index.html',
  'manifest.webmanifest',
  'sw.js',
  'css',
  'js',
  'icons'
];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

for (const item of ITEMS) {
  const src = path.join(ROOT, item);
  const dest = path.join(OUT, item);
  fs.cpSync(src, dest, { recursive: true });
}

console.log('✅ Dossier www/ prêt pour Capacitor (contenu : ' + fs.readdirSync(OUT).join(', ') + ')');
