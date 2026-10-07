# 🎧 Flulivre

**Flulivre** est une application web de lecture de livres, dans l'esprit d'**Audible** :

- 📚 une **bibliothèque** avec couvertures, progression et reprise là où vous vous étiez arrêté ;
- ▶️ la lecture de **livres audio** (MP3, M4A, WAV, OGG…) avec pause / reprise, bonds de ±30 s,
  vitesse réglable (×0,5 à ×3), position mémorisée automatiquement ;
- 🗣️ la **lecture à voix haute** des **EPUB**, **PDF** et fichiers **texte** grâce à la synthèse
  vocale du navigateur, avec **texte synchronisé** (la phrase lue est surlignée), choix de la voix
  et de la vitesse ;
- 🔍 la **reconnaissance de caractères (OCR)** pour les PDF scannés : le texte des images est
  reconnu (modèle français Tesseract) puis lu à voix haute ;
- 🌙 un **minuteur de sommeil** (durée ou **fin du chapitre**) ;
- ☀️ **thème clair / sombre** mémorisé ; taille du texte réglable (A− / A+) ;
- 🎼 **livres audio multi-pistes** : déposez plusieurs MP3 → un seul livre avec chapitres ;
- 🎙️ **choix du narrateur** sur les livres texte :
  - **voix de l'appareil** (gratuit, hors-ligne) avec la liste des voix françaises ;
  - **ElevenLabs** (plan gratuit sans carte, ~10 000 caractères/mois, guide intégré)
    qui génère un vrai livre audio MP3 à partir d'un EPUB/PDF/TXT, écoutable
    hors-ligne et exportable ;
- 📲 contrôles **écran verrouillé / casque / Bluetooth** (Media Session) ;
- 💾 tout est stocké **localement** dans votre navigateur (IndexedDB) : vos livres et votre
  progression restent d'une session à l'autre, sans compte ni serveur.

## 🚀 Lancer l'application

Aucune dépendance à installer — un simple serveur de fichiers suffit :

```bash
npm start          # ou : node server.js   (port 3000 par défaut, PORT=8080 pour changer)
```

puis ouvrez <http://localhost:3000>.

> Astuce : `python3 -m http.server 3000` fonctionne aussi.
> Une connexion internet est utile **au premier chargement** (les bibliothèques JSZip, pdf.js et
> Tesseract sont récupérées via CDN par votre navigateur, et le modèle OCR français est
> téléchargé au premier usage).

## 💾 Où sont stockés mes livres ? Export / import

Tout est stocké **localement sur votre appareil**, dans le navigateur
(**IndexedDB**) : fichiers audio, textes extraits, couvertures et progression.
Rien n'est envoyé sur un serveur ; la bibliothèque est propre à chaque
appareil/navigateur.

Pour sauvegarder ou transférer votre bibliothèque (PC → téléphone, nouveau
navigateur…) :

- **💾 Exporter** : télécharge un fichier `flulivre-sauvegarde-AAAA-MM-JJ.zip`
  contenant toute la bibliothèque (livres audio inclus).
- **📂 Importer une sauvegarde** : restaure ce fichier `.zip` (bouton, ou
  glisser-déposer le zip sur la page). Les livres déjà présents sont mis à jour,
  les autres sont ajoutés.

## 📱 Sur mobile Android

Flulivre est une **PWA installable** :

- **Sans ordinateur** : ouvrez l'adresse de l'application dans Chrome sur Android,
  menu **⋮ → « Installer l'application »** → icône sur l'écran d'accueil,
  fonctionnement hors-ligne.
- **Avec un vrai fichier `.apk`** : suivez le guide pas à pas
  **[docs/APK-ANDROID.md](docs/APK-ANDROID.md)** (Capacitor + Android Studio,
  ou PWABuilder si l'app est hébergée). Le projet Android se génère en 4 commandes :

  ```bash
  npm install -D @capacitor/core @capacitor/cli @capacitor/android
  npm run build:www
  npx cap add android
  npx cap sync
  npx cap open android   # puis Build → Build APK(s)
  ```

## 📖 Utilisation

1. Cliquez sur **＋ Importer** (ou glissez-déposez vos fichiers) :
   - fichiers audio → livres audio classiques ;
   - `.epub` → chapitres extraits, lus à voix haute ;
   - `.pdf` → texte extrait ; s'il s'agit d'un scanné, Flulivre propose l'**OCR** ;
   - `.txt` → lus à voix haute.
2. Cliquez sur une couverture pour **écouter**. La lecture reprend automatiquement
   là où vous vous étiez arrêté.
3. Dans le lecteur :
   - **Espace** : lecture / pause ; **←** / **→** : reculer / avancer ;
   - curseur : naviguer dans le livre ;
   - pour les textes lus à voix haute, le panneau **Lecture synchronisée** affiche le texte,
     surligne la phrase en cours et permet de cliquer n'importe quelle phrase pour reprendre à
     cet endroit ;
   - **🌙 Minuteur** : arrêt automatique après la durée choisie.
4. **🎁 Livre d'exemple** : un extrait de *Candide* de Voltaire est fourni pour tester
   immédiatement la lecture à voix haute.

## 🛠️ Techniques utilisées

| Besoin | Solution |
| --- | --- |
| Synthèse vocale | Web Speech API (`speechSynthesis`) — fonctionne hors ligne avec les voix du système |
| Extraction EPUB | JSZip + DOMParser (chapitres issus du *spine*, couverture incluse) |
| Extraction PDF | pdf.js (`getTextContent`) |
| OCR des scannés | Tesseract.js (modèle `fra`) |
| Stockage | IndexedDB (métadonnées + fichiers audio) |
| Serveur | `server.js` : serveur statique Node.js sans dépendance |

## 📁 Structure

```
index.html          page unique (bibliothèque + lecteur)
css/styles.css      thème sombre « façon Audible »
js/app.js           orchestration : imports, vues, mini-lecteur, raccourcis
js/db.js            persistance IndexedDB
js/audio.js         moteur livres audio
js/tts.js           moteur lecture à voix haute
js/importers.js     import EPUB / PDF (+OCR) / TXT / audio
js/library.js       grille de la bibliothèque
js/player.js        vue lecteur + lecture synchronisée
js/text.js          découpage en phrases / sections
js/sample.js        extrait de Candide (livre d'exemple)
server.js           serveur statique sans dépendance
```

## ⚠️ Limites connues

- La qualité des voix dépend de celles installées sur votre système/navigateur
  (les voix françaises de Chrome/Edge sont généralement très correctes).
- L'OCR est plus lent que l'extraction directe et dépend de la qualité du scan.
- Les fichiers restent dans le navigateur : videz le stockage du site pour tout effacer.

## 📄 Licence

MIT — voir le fichier [LICENSE](LICENSE).
