# 📱 Flulivre sur Android — guide pas à pas

Trois possibilités, de la plus simple à la plus « pro ». Choisissez-en **une seule** :

---

## Option 1 — Installation directe depuis Chrome (recommandée, 2 minutes)

Flulivre est une **PWA** : elle s'installe comme une application depuis le navigateur,
sans passer par le Play Store, et fonctionne **hors-ligne**.

1. Sur votre téléphone Android, ouvrez **Chrome**.
2. Allez sur l'adresse où Flulivre est hébergée :
   - pendant cette session : l'adresse de l'aperçu (voir le chat),
   - pour toujours : l'adresse de publication (GitHub Pages, Netlify…) si elle a été activée.
3. Touchez le menu **⋮** (en haut à droite) puis **« Installer l'application »**
   (ou « Ajouter à l'écran d'accueil »).
4. L'icône 🎧 **Flulivre** apparaît sur l'écran d'accueil : l'application s'ouvre
   en plein écran, comme une application native.

✅ Avantages : rien à installer sur un ordinateur, mises à jour automatiques, fonctionne
sur **tous les téléphones Android récents** (Android 8+).

---

## Option 2 — Générer un vrai fichier `.apk` avec Capacitor (sur ordinateur)

Cette méthode fabrique un fichier `app-debug.apk` que vous pourrez installer sur
n'importe quel téléphone Android, même sans internet.

### Étape 1 — Installer les outils (une seule fois)

1. **Node.js** (version LTS) : <https://nodejs.org> → télécharger puis installer
   en laissant tout par défaut.
2. **Android Studio** : <https://developer.android.com/studio> → installer
   en laissant tout par défaut (il installe automatiquement le « SDK Android »).

### Étape 2 — Récupérer le dossier Flulivre

Téléchargez/copiez le dossier **Flulivre** (ce dépôt) sur votre ordinateur.

### Étape 3 — Ouvrir un terminal dans le dossier

- **Windows** : ouvrez le dossier, tapez `cmd` dans la barre d'adresse, Entrée.
- **macOS** : Terminal, puis `cd chemin/vers/Flulivre`.

### Étape 4 — Taper ces commandes, une par une (Entrée après chacune)

```bash
npm install -D @capacitor/core @capacitor/cli @capacitor/android
npm run build:www
npx cap add android
npx cap sync
```

> La première commande télécharge Capacitor (internet requis, ~1 minute).
> `cap add android` crée le projet Android dans le dossier `android/`.

### Étape 5 — Construire l'APK

Deux choix :

**A. Avec Android Studio (le plus simple visuellement)**

```bash
npx cap open android
```

- Android Studio s'ouvre et « indexe » le projet (1ʳᵉ fois : quelques minutes).
- Menu **Build → Build App Bundle(s) / APK(s) → Build APK(s)**.
- En bas à droite, une bulle « APK build finished » apparaît : cliquez sur **locate**.
- Votre fichier est là : `android/app/build/outputs/apk/debug/app-debug.apk` ✅

**B. Sans ouvrir Android Studio** (ligne de commande)

```bash
cd android
./gradlew assembleDebug        # macOS/Linux
gradlew.bat assembleDebug      # Windows
```

Même résultat : `android/app/build/outputs/apk/debug/app-debug.apk`.

### Étape 6 — Installer l'APK sur le téléphone

1. Copiez `app-debug.apk` sur le téléphone (câble USB, e-mail, Google Drive…).
2. Sur le téléphone, touchez le fichier → Android demande d'**autoriser
   « Sources inconnues »** pour cette application → autorisez.
3. Touchez **Installer**. L'icône Flulivre apparaît : c'est terminé 🎉

> Vos livres sont stockés **dans l'application** (comme dans le navigateur).
> La lecture à voix haute utilise les voix installées sur le téléphone
> (Paramètres Android → Accessibilité → Synthèse vocale : vérifiez qu'une voix
> française est présente).

---

## Option 3 — Générer un APK en ligne avec PWABuilder (si l'app est publiée)

Si Flulivre est hébergée à une adresse publique permanente (GitHub Pages…) :

1. Allez sur <https://www.pwabuilder.com>.
2. Collez l'adresse du site → **Start**.
3. Cliquez sur **Android → Generate package** → téléchargez l'APK.

---

## ❓ Questions fréquentes

- **« La voix ne marche pas dans l'APK »** : certains WebView Android anciens ne gèrent
  pas la synthèse vocale. Dans ce cas, utilisez l'**option 1** (installation via Chrome),
  qui s'exécute dans le vrai moteur Chrome, toujours compatible.
- **« Mes livres restent-ils sur le téléphone ? »** : oui, tout est stocké localement
  (IndexedDB). Ne videz pas les données de l'application, sinon la progression est perdue.
- **« Mise à jour de l'APK »** : refaites les étapes 4 à 6 après chaque changement
  (ou utilisez l'option 1, qui se met à jour toute seule).
