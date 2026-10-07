/**
 * Flulivre — moteur de lecture à voix haute (synthèse vocale).
 *
 * Principe : le texte du livre est découpé en phrases. Chaque phrase est lue
 * par une SpeechSynthesisUtterance. La pause est fiable : on annule la phrase
 * en cours et on mémorise l'index ; la reprise repart du début de la phrase.
 * La position (chapitre + phrase) est persistée à intervalle régulier.
 */

import { splitSentences } from './text.js';

class TTSEngineImpl {
  constructor() {
    this.book = null;
    this.state = 'idle';            // idle | playing | paused | ended
    this.section = 0;               // index du chapitre/section courant
    this.sentence = 0;              // index de la phrase courante
    this.rate = 1;
    this.voice = null;

    this._cache = new Map();        // index de section → phrases
    this._offsets = [];             // index global de départ de chaque section
    this._total = 0;                // nombre total de phrases
    this._seq = 0;                  // jeton anti-courses pour les utterances
    this._timer = null;
    this._lastPersist = 0;

    this.onPersist = null;          // callback fourni par app.js
    this._ls = { state: new Set(), position: new Set(), sentence: new Set(), section: new Set(), ended: new Set(), autoadvance: new Set() };
  }

  /* ── Abonnement aux événements ── */
  on(ev, fn) { this._ls[ev].add(fn); return () => this._ls[ev].delete(fn); }
  _emit(ev, ...a) { for (const f of this._ls[ev]) f(...a); }

  get supported() { return 'speechSynthesis' in window; }

  /* ── Chargement d'un livre ── */
  load(book) {
    this.stopSpeak();
    this.book = book;
    this._cache.clear();
    this._offsets = [];
    let acc = 0;
    const sections = book.sections || [];
    for (let i = 0; i < sections.length; i++) {
      this._offsets.push(acc);
      acc += this.sentences(i).length;
    }
    this._total = acc;

    const pos = book.position || {};
    this.section = Math.max(0, Math.min(pos.section || 0, sections.length - 1));
    const n = this.sentences(this.section).length;
    this.sentence = Math.max(0, Math.min(pos.sentence || 0, Math.max(0, n - 1)));
    this.rate = book.rate || 1;

    // Choix de la voix : voix mémorisée, sinon première voix française.
    const voices = this.supported ? speechSynthesis.getVoices() : [];
    this.voice = (book.voiceName && voices.find((v) => v.name === book.voiceName)) || null;
    if (!this.voice) this.voice = voices.find((v) => (v.lang || '').toLowerCase().startsWith('fr')) || null;

    this.state = 'paused';
    this._emit('state', this.state);
    this._emitPosition();
    this._emitSentence();
  }

  unload() {
    this.stopSpeak();
    this.book = null;
    this.state = 'idle';
    this._emit('state', this.state);
  }

  /* ── Accès aux phrases ── */
  sentences(i = this.section) {
    if (!this.book || !this.book.sections || !this.book.sections[i]) return [];
    if (!this._cache.has(i)) this._cache.set(i, splitSentences(this.book.sections[i].text));
    return this._cache.get(i);
  }

  get totalSentences() { return this._total; }

  globalIndex() { return (this._offsets[this.section] || 0) + this.sentence; }

  /* ── Contrôles ── */
  play() {
    if (!this.book || !this.supported) return;
    if (this.state === 'playing') return;
    if (this.state === 'ended') { this.section = 0; this.sentence = 0; }
    this.state = 'playing';
    this._emit('state', this.state);
    this._speakCurrent();
  }

  pause() {
    if (!this.book) return;
    this.stopSpeak();
    this.state = 'paused';
    this._emit('state', this.state);
    this.persistNow();
  }

  toggle() { this.state === 'playing' ? this.pause() : this.play(); }

  /** Coupe la synthèse en cours (sans changer la position). */
  stopSpeak() {
    this._seq++;
    clearTimeout(this._timer);
    if (this.supported) { try { speechSynthesis.cancel(); } catch (e) { /* ignore */ } }
  }

  nextSentence() { this._step(1); }
  prevSentence() { this._step(-1); }

  _step(dir) {
    if (!this.book) return;
    const sections = this.book.sections || [];
    if (dir > 0) {
      if (this.sentence < this.sentences().length - 1) this.sentence++;
      else {
        let s = this.section + 1;
        while (s < sections.length && this.sentences(s).length === 0) s++;
        if (s >= sections.length) { if (this.state === 'playing') this._finish(); return; }
        this.section = s; this.sentence = 0;
        this._emit('section', this.section);
      }
    } else {
      if (this.sentence > 0) this.sentence--;
      else {
        let s = this.section - 1;
        while (s >= 0 && this.sentences(s).length === 0) s--;
        if (s < 0) { this.sentence = 0; }
        else { this.section = s; this.sentence = Math.max(0, this.sentences(s).length - 1); this._emit('section', this.section); }
      }
    }
    if (this.state === 'playing') { this.stopSpeak(); this._speakCurrent(); }
    else { this._emitSentence(); this._emitPosition(); this.persistNow(); }
  }

  /** Va à un chapitre précis (début du chapitre). */
  seekSection(i) {
    if (!this.book) return;
    const sections = this.book.sections || [];
    i = Math.max(0, Math.min(i, sections.length - 1));
    this.section = i;
    this.sentence = 0;
    this._emit('section', this.section);
    if (this.state === 'playing') { this.stopSpeak(); this._speakCurrent(); }
    else { this._emitSentence(); this._emitPosition(); }
    this.persistNow();
  }

  /** Va à un index global de phrase (curseur de progression). */
  seekGlobal(i) {
    if (!this.book || this._total === 0) return;
    i = Math.max(0, Math.min(this._total - 1, i));
    let s = 0;
    for (let k = 0; k < this._offsets.length; k++) if (this._offsets[k] <= i) s = k;
    const changed = s !== this.section;
    this.section = s;
    this.sentence = i - this._offsets[s];
    if (changed) this._emit('section', this.section);
    if (this.state === 'playing') { this.stopSpeak(); this._speakCurrent(); }
    else { this._emitSentence(); this._emitPosition(); }
    this.persistNow();
  }

  setRate(r) {
    this.rate = r;
    if (this.book) this.book.rate = r;
    if (this.state === 'playing') { this.stopSpeak(); this._speakCurrent(); }
  }

  setVoice(v) {
    this.voice = v;
    if (this.book && v) this.book.voiceName = v.name;
    if (this.state === 'playing') { this.stopSpeak(); this._speakCurrent(); }
  }

  /* ── Interne ── */
  _speakCurrent() {
    const text = this.sentences()[this.sentence];
    if (!text) { this._nextSectionAuto(); return; }

    const seq = ++this._seq;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = Math.max(0.5, Math.min(3, this.rate || 1));
    if (this.voice) { u.voice = this.voice; u.lang = this.voice.lang; }
    else u.lang = 'fr-FR';
    u.onend = () => { if (seq === this._seq) this._advance(); };
    u.onerror = (e) => {
      if (seq !== this._seq) return;
      if (e.error === 'interrupted' || e.error === 'canceled') return;
      console.warn('Erreur synthèse vocale :', e.error);
      this._advance(); // on saute la phrase problématique
    };

    clearTimeout(this._timer);
    // Léger délai après cancel() : évite un bug Chrome où speak() est ignoré.
    this._timer = setTimeout(() => { if (seq === this._seq) speechSynthesis.speak(u); }, 45);

    this._emitSentence();
    this._emitPosition();
    this._persistThrottled();
  }

  _advance() {
    this.sentence++;
    if (this.sentence >= this.sentences().length) this._nextSectionAuto();
    else this._speakCurrent();
  }

  _nextSectionAuto() {
    const sections = this.book ? this.book.sections || [] : [];
    let s = this.section + 1;
    while (s < sections.length && this.sentences(s).length === 0) s++;
    if (s >= sections.length) { this._finish(); return; }
    this.section = s;
    this.sentence = 0;
    this._emit('autoadvance', this.section); // pour la minuterie « fin de chapitre »
    this._emit('section', this.section);
    this._speakCurrent();
  }

  _finish() {
    this.stopSpeak();
    this.state = 'ended';
    if (this.book) this.book.progress = 1;
    this._emit('state', this.state);
    this._emitPosition();
    this.persistNow();
    this._emit('ended');
  }

  _emitPosition() {
    this._emit('position', {
      section: this.section,
      sentence: this.sentence,
      sectionSentences: this.sentences().length,
      sections: this.book ? (this.book.sections || []).length : 0,
      global: this.globalIndex(),
      total: this._total
    });
  }

  _emitSentence() {
    this._emit('sentence', this.section, this.sentence, this.sentences()[this.sentence] || '');
  }

  _persistThrottled() {
    const now = Date.now();
    if (now - this._lastPersist > 2000) { this._lastPersist = now; this.persistNow(); }
  }

  persistNow() {
    if (!this.book) return;
    this.book.position = { section: this.section, sentence: this.sentence };
    this.book.progress = this._total > 0 ? this.globalIndex() / this._total : 0;
    this.book.lastPlayedAt = Date.now();
    if (this.onPersist) this.onPersist(this.book);
  }
}

export const TTSEngine = new TTSEngineImpl();
