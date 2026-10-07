/**
 * Flulivre — choix du narrateur.
 *
 * Deux possibilités, toutes deux gratuites :
 *  1. « Voix de l'appareil » : lecture directe par la synthèse vocale du
 *     système, avec le choix parmi les voix françaises installées ;
 *  2. « ElevenLabs » : génère un VRAI livre audio MP3 (chapitres) avec des
 *     voix neuronales réalistes, via le plan gratuit (clé sans carte bancaire).
 *
 * Le résultat ElevenLabs est stocké comme un livre audio classique :
 * écoute hors-ligne, export, transfert — sans re-consommer de quota.
 */

import * as db from './db.js';
import { TTSEngine } from './tts.js';
import { uid, makeCover, escapeHtml, toast } from './utils.js';
import { splitSentences } from './text.js';
import { probeDuration } from './importers.js';

const LS_KEY = 'flulivre-ai-config';

export function getAiConfig() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { return {}; }
}
export function saveAiConfig(cfg) {
  localStorage.setItem(LS_KEY, JSON.stringify(cfg));
}

const ELEVEN_LIMIT = 2500;

/* ─────────────── API ElevenLabs ─────────────── */

export async function fetchElevenVoices(key) {
  const r = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': key } });
  if (!r.ok) throw new Error('clé refusée ' + r.status);
  const j = await r.json();
  return (j.voices || []).map((v) => [v.voice_id, v.name]);
}

async function synthElevenLabs(key, voiceId, text) {
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': key,
      'Accept': 'audio/mpeg'
    },
    body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2' })
  });
  if (!r.ok) {
    let msg = 'Erreur ElevenLabs ' + r.status;
    try { const j = await r.json(); msg = j.detail?.message || msg; } catch (e) { /* ignore */ }
    throw new Error(msg);
  }
  return r.blob();
}

/** Découpe un texte en blocs sous la limite de caractères. */
function chunkText(text, limit) {
  const sentences = splitSentences(text);
  const chunks = [];
  let cur = '';
  for (const s of sentences) {
    if (cur.length + s.length > limit && cur) { chunks.push(cur.trim()); cur = ''; }
    cur += s + ' ';
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks.length ? chunks : [text.slice(0, limit)];
}

/** Génère un livre audio MP3 complet avec ElevenLabs. */
export async function generateAiAudiobook(book, cfg, onProgress = () => {}) {
  const sections = book.sections || [];
  if (!sections.length) throw new Error('Ce livre ne contient aucun texte.');

  const tracks = [];
  const blobs = [];

  for (let s = 0; s < sections.length; s++) {
    onProgress(`Narration IA — chapitre ${s + 1}/${sections.length}`, s / sections.length);
    const chunks = chunkText(sections[s].text || '', ELEVEN_LIMIT);
    const parts = [];
    for (let c = 0; c < chunks.length; c++) {
      onProgress(
        `Narration IA — chapitre ${s + 1}/${sections.length} (bloc ${c + 1}/${chunks.length})`,
        (s + c / chunks.length) / sections.length
      );
      parts.push(await synthElevenLabs(cfg.key, cfg.voice, chunks[c]));
    }
    // Les MP3 se concatènent simplement : un chapitre = une piste
    const blob = new Blob(parts, { type: 'audio/mpeg' });
    const duration = await probeDuration(blob);
    tracks.push({ title: sections[s].title || `Chapitre ${s + 1}`, duration });
    blobs.push(blob);
  }

  const nb = {
    id: uid(),
    type: 'audio',
    format: 'mp3',
    title: `${book.title} (narration IA)`,
    author: book.author || '',
    tracks,
    position: { track: 0, time: 0 },
    rate: 1,
    progress: 0,
    aiVoice: cfg.voiceLabel || cfg.voice,
    addedAt: Date.now(),
    lastPlayedAt: Date.now()
  };
  nb.cover = book.cover || makeCover(nb);

  for (let i = 0; i < blobs.length; i++) await db.putFile(`${nb.id}::${i}`, blobs[i]);
  await db.saveBookMeta(nb);
  return nb;
}

/* ─────────────── Voix du système (françaises d'abord) ─────────────── */

function systemVoicesSorted() {
  const voices = ('speechSynthesis' in window) ? speechSynthesis.getVoices() : [];
  const fr = voices.filter((v) => (v.lang || '').toLowerCase().startsWith('fr'));
  const others = voices.filter((v) => !fr.includes(v));
  return [...fr, ...others];
}

/* ─────────────── Fenêtre de choix du narrateur ─────────────── */

const FREE_STEPS =
  'Plan 100 % gratuit, sans carte bancaire : 1) créez un compte sur elevenlabs.io ' +
  '2) ouvrez « Profile & keys » 3) copiez votre clé API 4) collez-la ci-dessus. ' +
  '≈ 10 000 caractères/mois offerts.';

/**
 * Ouvre la fenêtre « Narrateur » : voix de l'appareil (lecture directe)
 * ou ElevenLabs (génération d'un livre audio).
 */
export function openAiModal(book, onDone, onStatus = () => {}) {
  const cfg = getAiConfig();
  const root = document.getElementById('modal-root');
  root.hidden = false;
  root.innerHTML = `
    <div class="modal-card">
      <h3>🎙️ Choisir le narrateur</h3>
      <div class="ai-form">
        <label>Narrateur
          <select id="ai-provider">
            <option value="system" ${cfg.provider === 'elevenlabs' ? '' : 'selected'}>🗣️ Voix de l'appareil — gratuit, lecture directe</option>
            <option value="elevenlabs" ${cfg.provider === 'elevenlabs' ? 'selected' : ''}>🤖 ElevenLabs — générer un livre audio réaliste</option>
          </select>
        </label>
        <label id="ai-key-wrap" hidden>Clé API (gratuite)
          <input id="ai-key" type="password" placeholder="Collez votre clé ElevenLabs" value="${escapeHtml(cfg.key || '')}">
        </label>
        <label>Voix
          <select id="ai-voice"></select>
        </label>
        <p class="ai-hint muted" id="ai-hint"></p>
      </div>
      <div class="modal-actions">
        <button class="btn-ghost" data-act="no">Annuler</button>
        <button class="btn-primary" data-act="yes" id="ai-yes">▶ Écouter avec cette voix</button>
      </div>
    </div>`;

  const provSel = root.querySelector('#ai-provider');
  const voiceSel = root.querySelector('#ai-voice');
  const hint = root.querySelector('#ai-hint');
  const yesBtn = root.querySelector('#ai-yes');

  async function fillVoices() {
    const prov = provSel.value;
    root.querySelector('#ai-key-wrap').hidden = prov !== 'elevenlabs';

    if (prov === 'system') {
      yesBtn.textContent = '▶ Écouter avec cette voix';
      const voices = systemVoicesSorted();
      voiceSel.innerHTML = voices.length
        ? voices.map((v) => `<option value="${escapeHtml(v.name)}">${escapeHtml(v.name)} (${v.lang})</option>`).join('')
        : '<option value="">Voix par défaut</option>';
      const current = TTSEngine.voice?.name || book.voiceName;
      if (current && voices.some((v) => v.name === current)) voiceSel.value = current;
      hint.textContent =
        'Lecture directe, gratuite et hors-ligne, par la synthèse vocale de votre appareil. ' +
        'Les voix françaises sont listées en premier. Le livre audio IA (ElevenLabs) offre un rendu plus réaliste.';
      return;
    }

    // ElevenLabs
    yesBtn.textContent = '🎙️ Générer le livre audio';
    const key = root.querySelector('#ai-key').value.trim();
    if (!key) {
      voiceSel.innerHTML = '<option value="">— collez d’abord votre clé gratuite —</option>';
      hint.textContent = FREE_STEPS;
      return;
    }
    voiceSel.innerHTML = '<option value="">Chargement des voix…</option>';
    try {
      const voices = await fetchElevenVoices(key);
      voiceSel.innerHTML = voices.length
        ? voices.map(([id, name]) => `<option value="${id}">${escapeHtml(name)}</option>`).join('')
        : '<option value="">Aucune voix sur ce compte</option>';
      if (cfg.voice && voices.some(([id]) => id === cfg.voice)) voiceSel.value = cfg.voice;
      hint.textContent = 'Voix chargées ✅ Choisissez votre narrateur, puis générez : le livre audio sera conservé dans votre bibliothèque.';
    } catch (e) {
      voiceSel.innerHTML = '<option value="">— vérifiez votre clé —</option>';
      hint.textContent = 'Clé refusée (' + e.message + '). ' + FREE_STEPS;
    }
  }

  provSel.onchange = fillVoices;
  root.querySelector('#ai-key').oninput = () => { if (provSel.value === 'elevenlabs') fillVoices(); };
  fillVoices();

  root.onclick = async (e) => {
    const btn = e.target.closest('button');
    const act = btn?.dataset.act;
    if (!act && e.target !== root) return;

    const prov = provSel.value;
    const newCfg = {
      provider: prov,
      key: root.querySelector('#ai-key').value.trim(),
      voice: voiceSel.value,
      voiceLabel: voiceSel.selectedOptions[0]?.textContent || voiceSel.value
    };
    root.hidden = true;
    root.innerHTML = '';
    if (act !== 'yes') return;

    /* — Voix de l'appareil : lecture directe immédiate — */
    if (prov === 'system') {
      const v = systemVoicesSorted().find((x) => x.name === newCfg.voice);
      if (v) TTSEngine.setVoice(v);
      if (TTSEngine.state !== 'playing') TTSEngine.play();
      toast(v ? `Lecture avec la voix « ${v.name} » 🗣️` : 'Lecture avec la voix par défaut 🗣️');
      return;
    }

    /* — ElevenLabs : génération du livre audio — */
    if (!newCfg.key) {
      toast('Collez d’abord votre clé API gratuite ElevenLabs.', 5000);
      return;
    }
    saveAiConfig(newCfg);
    try {
      const nb = await generateAiAudiobook(book, newCfg, onStatus);
      onDone(nb);
    } catch (err) {
      console.error(err);
      toast('Échec de la narration IA : ' + (err.message || err), 6000);
    }
  };
}
