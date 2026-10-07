/**
 * Flulivre — moteur audio.
 * Gère les fichiers uniques ET les livres multi-pistes (chapitres),
 * avec position globale, saut de piste automatique et position persistée.
 */

class AudioEngineImpl {
  constructor() {
    this.el = new Audio();
    this.el.preload = 'metadata';
    this.book = null;
    this.state = 'idle';            // idle | playing | paused | ended
    this.blobs = [];
    this.tracks = [];
    this.offsets = [];              // début (s) de chaque piste dans la durée totale
    this.total = 0;
    this.trackIdx = 0;
    this._url = null;
    this._pendingTime = 0;
    this._lastPersist = 0;
    this.onPersist = null;
    this._ls = { state: new Set(), time: new Set(), track: new Set(), autoadvance: new Set() };

    const el = this.el;

    el.addEventListener('loadedmetadata', () => {
      if (this._pendingTime > 0 && isFinite(el.duration)) {
        el.currentTime = Math.min(this._pendingTime, Math.max(0, el.duration - 0.5));
      }
      this._pendingTime = 0;
      // durée réelle mesurée → mise à jour des offsets
      if (this.tracks[this.trackIdx] && isFinite(el.duration) && el.duration > 0) {
        this.tracks[this.trackIdx].duration = el.duration;
        this._recomputeOffsets();
      }
      this._emitTime();
    });

    el.addEventListener('timeupdate', () => {
      this._emitTime();
      const now = Date.now();
      if (this.state === 'playing' && now - this._lastPersist > 5000) {
        this._lastPersist = now;
        this.persistNow();
      }
    });

    el.addEventListener('play', () => this._setState('playing'));
    el.addEventListener('pause', () => {
      if (!this.book) return;
      this._setState('paused');
      this.persistNow();
    });
    el.addEventListener('ended', () => {
      if (!this.book) return;
      if (this.trackIdx < this.tracks.length - 1) {
        // enchaînement automatique du chapitre suivant
        this._loadTrack(this.trackIdx + 1);
        this._emit('autoadvance', this.trackIdx);
        if (this.state === 'playing') this.play();
      } else {
        this.book.progress = 1;
        this._setState('ended');
        this.persistNow();
      }
    });
  }

  on(ev, fn) { this._ls[ev].add(fn); return () => this._ls[ev].delete(fn); }
  _emit(ev, ...a) { for (const f of this._ls[ev]) f(...a); }
  _setState(s) { this.state = s; this._emit('state', s); }

  _recomputeOffsets() {
    let acc = 0;
    this.offsets = this.tracks.map((t) => { const o = acc; acc += t.duration || 0; return o; });
    this.total = acc;
  }

  /** Charge un livre audio. `blobs` : un Blob par piste. */
  load(book, blobs) {
    this.unload();
    this.book = book;
    this.blobs = Array.isArray(blobs) ? blobs : [blobs];
    this.tracks = (book.tracks && book.tracks.length)
      ? book.tracks.map((t) => ({ ...t }))
      : [{ title: book.title, duration: book.duration || 0 }];
    if (this.blobs.length < this.tracks.length) {
      this.blobs = this.tracks.map((_, i) => this.blobs[i] || null);
    }
    this._recomputeOffsets();

    // Position : nouveau format {track, time} ou ancien {time}
    const pos = book.position || {};
    let ti = 0, tt = 0;
    if (typeof pos.track === 'number') { ti = pos.track; tt = pos.time || 0; }
    else if (typeof pos.time === 'number') { ti = 0; tt = pos.time; }
    this.trackIdx = Math.max(0, Math.min(ti, this.tracks.length - 1));
    this._pendingTime = tt;

    this._loadTrack(this.trackIdx, true);
    this.el.playbackRate = book.rate || 1;
    this._setState('paused');
    this._emitTime();
  }

  _loadTrack(i, silent = false) {
    try { this.el.pause(); } catch (e) { /* ignore */ }
    if (this._url) URL.revokeObjectURL(this._url);
    this._url = null;
    const blob = this.blobs[i];
    if (blob) {
      this._url = URL.createObjectURL(blob);
      this.el.src = this._url;
    } else {
      this.el.removeAttribute('src');
      try { this.el.load(); } catch (e) { /* ignore */ }
    }
    this.trackIdx = i;
    if (!silent) this._emit('track', i);
  }

  unload() {
    try { this.el.pause(); } catch (e) { /* ignore */ }
    if (this._url) URL.revokeObjectURL(this._url);
    this._url = null;
    this.el.removeAttribute('src');
    try { this.el.load(); } catch (e) { /* ignore */ }
    this.book = null;
    this.blobs = [];
    this.tracks = [];
    this.state = 'idle';
    this._emit('state', this.state);
  }

  play() { if (this.book) this.el.play().catch((e) => console.warn('Lecture impossible :', e)); }
  pause() { this.el.pause(); }
  toggle() { this.state === 'playing' ? this.pause() : this.play(); }

  /** Temps global (toutes pistes confondues). */
  globalTime() { return (this.offsets[this.trackIdx] || 0) + (this.el.currentTime || 0); }

  /** Navigation globale (curseur unique sur tout le livre). */
  seek(global) {
    if (!this.book || !this.tracks.length) return;
    global = Math.max(0, Math.min(global, Math.max(0, this.total - 0.5)));
    let i = 0;
    for (let k = 0; k < this.offsets.length; k++) if (this.offsets[k] <= global) i = k;
    const local = global - (this.offsets[i] || 0);
    if (i !== this.trackIdx) {
      this._loadTrack(i);
      this._pendingTime = local;
    } else {
      this.el.currentTime = local;
    }
    this._emitTime();
    this._emit('track', this.trackIdx);
  }

  skip(delta) { this.seek(this.globalTime() + delta); }

  /** Va au début d'une piste précise. */
  seekTrack(i) {
    i = Math.max(0, Math.min(i, this.tracks.length - 1));
    this.seek(this.offsets[i] || 0);
  }

  nextTrack() { if (this.trackIdx < this.tracks.length - 1) this.seekTrack(this.trackIdx + 1); }
  prevTrack() {
    // comme un lecteur CD : > 3 s dans la piste → retour début de piste
    if ((this.el.currentTime || 0) > 3 || this.trackIdx === 0) this.seekTrack(this.trackIdx);
    else this.seekTrack(this.trackIdx - 1);
  }

  setRate(r) {
    this.el.playbackRate = r;
    if (this.book) this.book.rate = r;
  }

  _emitTime() {
    this._emit('time', {
      time: this.globalTime(),
      duration: this.total || 0,
      track: this.trackIdx,
      tracks: this.tracks.length
    });
  }

  persistNow() {
    const b = this.book;
    if (!b) return;
    b.position = { track: this.trackIdx, time: this.el.currentTime || 0 };
    b.duration = this.total || b.duration || 0;
    b.progress = this.total ? Math.min(1, this.globalTime() / this.total) : 0;
    b.lastPlayedAt = Date.now();
    if (this.onPersist) this.onPersist(b);
  }
}

export const AudioEngine = new AudioEngineImpl();
