'use strict';

/**
 * SlideEngine — the visual core, shared by the Output screen and the Control
 * preview so both render identically from the same `show` payload.
 *
 * Architecture per layer (two layers, double-buffered):
 *
 *   .oss-layer              <- transition transforms / opacity / clip-path
 *     .oss-kb.oss-kb-bg     <- Ken Burns transform of the fill
 *       img.oss-bg          <- blurred "cover" fill of an image (kills black bars)
 *       canvas.oss-bg       <- the same fill for a video (see VideoBackdrop)
 *     .oss-kb.oss-kb-fg     <- Ken Burns transform of the sharp image
 *       img.oss-fg          <- sharp "contain" image
 *       video.oss-fg        <- or: the playing video (one element per show)
 *
 * Keeping transition transforms (on .oss-layer) separate from the Ken Burns
 * transform (on .oss-kb) means the two never fight over `transform`.
 *
 * Everything animates via the Web Animations API on `transform`, `opacity`,
 * `filter` and `clip-path`, which the compositor handles on the GPU — so the
 * main thread stays free and the motion is butter-smooth. Videos play through
 * Chromium's native media pipeline (hardware decoding where available) and are
 * composited like any other layer, so every transition works with them too.
 */
class SlideEngine {
  /**
   * @param {HTMLElement} rootEl
   * @param {object} [opts]
   * @param {boolean} [opts.preview]   smaller, lighter rendering; always muted
   * @param {number}  [opts.cacheLimit] decoded images kept for prefetch
   * @param {function} [opts.onVideo]  receives playback reports
   *        {token, type: 'progress'|'ended'|'error', time, duration, message?}
   */
  constructor(rootEl, opts = {}) {
    this.root = rootEl;
    this.preview = Boolean(opts.preview);
    this.cacheLimit = opts.cacheLimit || 8;
    this.onVideo = typeof opts.onVideo === 'function' ? opts.onVideo : null;

    this._cache = new Map();      // url -> decoded HTMLImageElement (prefetch)
    this._videoCache = new Map(); // url -> Promise<HTMLVideoElement> (first frame ready)
    this._gen = 0;                // generation token to drop superseded shows
    this._active = 0;
    this._next = 1;
    this._settle = null;          // finishes the in-flight transition, if any
    this._playing = true;         // show running? (videos pause with the show)
    this._audio = { enabled: true, volume: 1 };

    this.root.classList.add('oss-root');
    this.layers = [this._makeLayer(), this._makeLayer()];
    this.layers.forEach(l => this.root.appendChild(l.el));
    this.layers[1].el.style.opacity = '0';
  }

  _makeLayer() {
    const el = document.createElement('div');
    el.className = 'oss-layer';

    // Background and foreground each get their OWN Ken Burns wrapper so the
    // blurred fill can move freely (cropping is invisible) while the sharp
    // image only does a gentle, crop-safe motion.
    const kbBg = document.createElement('div');
    kbBg.className = 'oss-kb oss-kb-bg';
    const bg = document.createElement('img');
    bg.className = 'oss-bg oss-bg-img';
    bg.decoding = 'async';
    const bgCanvas = document.createElement('canvas');
    bgCanvas.className = 'oss-bg oss-bg-video';
    kbBg.appendChild(bg);
    kbBg.appendChild(bgCanvas);

    const kbFg = document.createElement('div');
    kbFg.className = 'oss-kb oss-kb-fg';
    const fg = document.createElement('img');
    fg.className = 'oss-fg oss-fg-img';
    fg.decoding = 'async';
    kbFg.appendChild(fg);

    el.appendChild(kbBg);
    el.appendChild(kbFg);
    return {
      el, kbBg, kbFg, bg, fg,
      backdrop: new VideoBackdrop(bgCanvas),
      video: null,        // HTMLVideoElement while this layer shows a video
      videoToken: 0,
      videoAbort: null,   // AbortController for the video's listeners
      kbBgAnim: null, kbFgAnim: null, trAnim: null, outAnim: null
    };
  }

  // ---- prefetch + decode (async, off the animation path) -----------------
  async _ensureDecoded(url) {
    if (!url) return null;
    const cached = this._cache.get(url);
    if (cached) {
      // refresh LRU position
      this._cache.delete(url);
      this._cache.set(url, cached);
      return cached;
    }
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    try {
      await img.decode();
    } catch {
      // Broken/unsupported file — return null so caller can skip gracefully.
      return null;
    }
    this._cache.set(url, img);
    while (this._cache.size > this.cacheLimit) {
      const oldestKey = this._cache.keys().next().value;
      const oldestImg = this._cache.get(oldestKey);
      this._cache.delete(oldestKey);
      // Drop the source so the browser can release the decoded bitmap right
      // away instead of waiting for GC — keeps memory flat over long events.
      if (oldestImg) oldestImg.src = '';
    }
    return img;
  }

  // ---- video loading --------------------------------------------------------
  // A video is "ready" once its first frame is decoded (readyState >= 2), so a
  // transition into it never shows an empty frame. Each show gets its own
  // element; it is torn down afterwards so its decoder is freed immediately.
  _prepareVideo(url) {
    const v = document.createElement('video');
    v.className = 'oss-fg oss-video';
    v.preload = 'auto';
    v.muted = true;              // sound is switched on when it goes live
    v.playsInline = true;
    v.controls = false;
    v.disablePictureInPicture = true;
    v.disableRemotePlayback = true;
    v.src = url;

    return new Promise((resolve, reject) => {
      const ac = new AbortController();
      const done = (err) => {
        clearTimeout(timer);
        ac.abort();
        if (err) { SlideEngine._releaseVideo(v); reject(err); } else resolve(v);
      };
      const timer = setTimeout(() => done(new Error('Zeitüberschreitung beim Laden')),
        SlideEngine.VIDEO_LOAD_TIMEOUT_MS);
      if (v.readyState >= 2) { done(); return; }
      v.addEventListener('loadeddata', () => done(), { signal: ac.signal });
      v.addEventListener('error', () => done(new Error(SlideEngine._mediaErrorText(v.error))),
        { signal: ac.signal });
    });
  }

  /** A ready video for `url`: the prefetched one if available, else a new one. */
  _takeVideo(url) {
    const pending = this._videoCache.get(url);
    if (pending) {
      this._videoCache.delete(url);  // the element now belongs to the show
      return pending;
    }
    return this._prepareVideo(url);
  }

  _prefetchVideo(url) {
    if (this._videoCache.has(url)) return;
    const p = this._prepareVideo(url);
    p.catch(() => this._videoCache.delete(url)); // retried (and reported) on show
    this._videoCache.set(url, p);
    while (this._videoCache.size > SlideEngine.VIDEO_PREFETCH_LIMIT) {
      const oldestKey = this._videoCache.keys().next().value;
      const oldest = this._videoCache.get(oldestKey);
      this._videoCache.delete(oldestKey);
      oldest.then(SlideEngine._releaseVideo, () => {});
    }
  }

  prefetch(items) {
    // Images are cheap to keep decoded; videos hold a decoder each, so only the
    // next upcoming video is prepared ahead of time.
    let videoQueued = false;
    (items || []).forEach(it => {
      if (!it || !it.url) return;
      if (it.type === 'video') {
        if (!videoQueued) { videoQueued = true; this._prefetchVideo(it.url); }
      } else {
        this._ensureDecoded(it.url);
      }
    });
  }

  static _releaseVideo(v) {
    if (!v) return;
    try {
      v.pause();
      v.removeAttribute('src');
      v.load();               // aborts loading and frees the decoder right away
    } catch { /* already torn down */ }
    v.remove();
  }

  static _mediaErrorText(err) {
    if (!err) return 'Unbekannter Fehler';
    switch (err.code) {
      case 1: return 'Laden abgebrochen';
      case 2: return 'Lesefehler';
      case 3: return 'Video konnte nicht dekodiert werden';
      case 4: return 'Format/Codec wird nicht unterstützt';
      default: return err.message || 'Unbekannter Fehler';
    }
  }

  clear() {
    this._gen++;                       // drop any show still loading
    if (this._settle) this._settle();
    this.layers.forEach(l => {
      if (l.kbBgAnim) l.kbBgAnim.cancel();
      if (l.kbFgAnim) l.kbFgAnim.cancel();
      this._detachVideo(l);
      l.el.style.opacity = '0';
      l.el.style.willChange = '';   // release compositor layers while idle
      l.kbBg.style.willChange = '';
      l.kbFg.style.willChange = '';
    });
    this._videoCache.forEach(p => p.then(SlideEngine._releaseVideo, () => {}));
    this._videoCache.clear();
  }

  // ---- live playback control ------------------------------------------------
  /** Pause / resume the video on screen together with the show. */
  setPlaying(playing) {
    this._playing = Boolean(playing);
    const layer = this.layers[this._active];
    if (!layer.video) return;
    if (this._playing) this._play(layer);
    else layer.video.pause();
  }

  /** Video sound on/off and volume (0..1). The preview is always silent. */
  setAudio(audio) {
    if (!audio) return;
    this._audio = { enabled: audio.enabled !== false, volume: audio.volume != null ? audio.volume : 1 };
    const v = this.layers[this._active].video;
    if (v) this._applyAudio(v);
  }

  /**
   * Keep a secondary view (the control preview) in step with the authoritative
   * playback position reported by the output. Corrects only noticeable drift,
   * and not too often, so the preview never stutters from constant seeking.
   */
  syncVideo(token, time) {
    const layer = this.layers[this._active];
    const v = layer.video;
    if (!v || layer.videoToken !== token || v.seeking || !Number.isFinite(time)) return;
    const now = performance.now();
    if (now - (layer.lastSync || 0) < SlideEngine.VIDEO_SYNC_COOLDOWN_MS) return;
    if (Math.abs(v.currentTime - time) > SlideEngine.VIDEO_SYNC_TOLERANCE_S) {
      layer.lastSync = now;
      v.currentTime = Math.min(time, v.duration || time);
    }
  }

  _applyAudio(v) {
    v.muted = this.preview || !this._audio.enabled;
    v.volume = Math.min(1, Math.max(0, this._audio.volume));
  }

  _play(layer) {
    const v = layer.video;
    if (!v || v.ended) return;
    v.play().catch((err) => {
      if (layer.video !== v || err.name === 'AbortError') return; // superseded / paused
      if (err.name === 'NotAllowedError' && !v.muted) {
        // Autoplay with sound refused: play silently rather than not at all.
        v.muted = true;
        this._play(layer);
        return;
      }
      this._report(layer.videoToken, 'error', { message: err.message });
    });
  }

  _report(token, type, extra) {
    if (this.onVideo) this.onVideo(Object.assign({ token, type }, extra));
  }

  // ---- main entry point ---------------------------------------------------
  async show(payload) {
    if (!payload || !payload.current) { this.clear(); return; }
    const gen = ++this._gen;
    const isVideo = payload.current.type === 'video';
    if (payload.playing != null) this._playing = Boolean(payload.playing);
    if (payload.audio) this._audio = payload.audio;

    let media = null;
    let error = null;
    if (isVideo) {
      try { media = await this._takeVideo(payload.current.url); } catch (err) { error = err; }
    } else {
      media = await this._ensureDecoded(payload.current.url);
    }
    if (gen !== this._gen) {                 // a newer show() superseded us
      if (isVideo) SlideEngine._releaseVideo(media);
      return;
    }
    if (!media) {
      // Keep the previous slide on screen. Videos report back so the show
      // moves on; a broken image simply waits for the next regular advance.
      if (isVideo) this._report(payload.token, 'error', { message: error ? error.message : '' });
      this.prefetch(payload.upcoming);
      return;
    }

    // Land any transition still in flight (rapid next/prev) before reusing
    // its layers — synchronously, so nothing fires late on the wrong layer.
    if (this._settle) this._settle();

    const incoming = this.layers[this._next];
    const outgoing = this.layers[this._active];

    this._buildLayer(incoming, payload, isVideo ? media : null);
    if (isVideo) this._startVideo(incoming, media, payload);
    else this._startKenBurns(incoming, payload);

    const firstShow = payload.transition === 'none';
    if (firstShow) {
      incoming.el.style.willChange = '';   // static slide — release promotion
      incoming.el.style.opacity = '1';
      incoming.el.style.zIndex = '2';
      outgoing.el.style.opacity = '0';
      outgoing.el.style.zIndex = '1';
      this._detachVideo(outgoing);
    } else {
      this._runTransition(incoming, outgoing, payload);
    }

    this._active = this._next;
    this._next = 1 - this._next;

    this.prefetch(payload.upcoming);
  }

  _buildLayer(layer, payload, video) {
    this._detachVideo(layer);

    const mode = payload.backgroundMode || 'blur';
    layer.el.classList.remove('mode-blur', 'mode-solid', 'mode-stretch');
    layer.el.classList.add('mode-' + mode);
    layer.el.classList.toggle('is-video', Boolean(video));

    if (video) {
      // Free the previous image's bitmap on this layer; the video takes over.
      layer.fg.removeAttribute('src');
      layer.bg.removeAttribute('src');
    } else {
      const url = payload.current.url;
      layer.fg.src = url;
      layer.bg.src = url;
    }

    // Reset transition styling so the next transition starts clean.
    layer.el.style.clipPath = '';
    layer.el.style.filter = '';
    layer.el.style.transform = '';
  }

  // ---- Video ----------------------------------------------------------------
  _startVideo(layer, video, payload) {
    // Videos bring their own motion: no Ken Burns on top of them.
    if (layer.kbBgAnim) { layer.kbBgAnim.cancel(); layer.kbBgAnim = null; }
    if (layer.kbFgAnim) { layer.kbFgAnim.cancel(); layer.kbFgAnim = null; }
    layer.kbBg.style.willChange = '';
    layer.kbFg.style.willChange = '';
    layer.kbBg.style.transform = 'scale(1.02)';
    layer.kbFg.style.transform = 'none';

    const token = payload.token;
    const ac = new AbortController();
    layer.video = video;
    layer.videoToken = token;
    layer.videoAbort = ac;
    layer.lastSync = 0;

    const opt = { signal: ac.signal };
    let lastReport = 0;
    const progress = (force) => {
      const now = performance.now();
      if (!force && now - lastReport < SlideEngine.VIDEO_REPORT_INTERVAL_MS) return;
      lastReport = now;
      this._report(token, 'progress', { time: video.currentTime, duration: video.duration });
    };
    video.addEventListener('timeupdate', () => progress(false), opt);
    video.addEventListener('ended', () => {
      this._report(token, 'ended', { time: video.duration, duration: video.duration });
    }, opt);
    video.addEventListener('error', () => {
      this._report(token, 'error', { message: SlideEngine._mediaErrorText(video.error) });
    }, opt);

    this._applyAudio(video);
    layer.kbFg.appendChild(video);

    if ((payload.backgroundMode || 'blur') === 'blur') layer.backdrop.attach(video);

    progress(true);                        // duration is known: tell the UI
    if (this._playing) this._play(layer);
  }

  /** Stop and free the layer's video (if any), its listeners and backdrop. */
  _detachVideo(layer) {
    layer.backdrop.detach();
    if (!layer.video) return;
    if (layer.videoAbort) layer.videoAbort.abort();
    SlideEngine._releaseVideo(layer.video);
    layer.video = null;
    layer.videoAbort = null;
    layer.videoToken = 0;
  }

  /** Fade the sound of a video that is being transitioned away from. */
  _fadeOutAudio(video, ms) {
    if (!video || video.muted || video.paused || ms <= 0) return;
    const v0 = video.volume;
    const t0 = performance.now();
    const step = (now) => {
      if (!video.isConnected) return;             // already torn down
      // rAF timestamps mark the frame start and can precede t0 slightly.
      const k = Math.min(1, Math.max(0, (now - t0) / ms));
      video.volume = Math.min(1, Math.max(0, v0 * (1 - k)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ---- Ken Burns ----------------------------------------------------------
  // The background (blurred cover) takes the full zoom + pan — any cropping is
  // invisible because it is blurred. The foreground (sharp, object-fit:contain)
  // gets a much gentler, crop-safe motion: the pan is clamped to the zoom
  // headroom so an edge of the image is never revealed and only a few percent
  // is ever cropped. At intensity 0 the sharp image is a pixel-perfect fit.
  _startKenBurns(layer, payload) {
    if (layer.kbBgAnim) layer.kbBgAnim.cancel();
    if (layer.kbFgAnim) layer.kbFgAnim.cancel();

    const kb = payload.kenBurns || {};
    const intensity = payload.kenBurnsIntensity != null ? payload.kenBurnsIntensity : 1;
    // Run the motion a touch past the slide+transition so it never visibly
    // freezes before the next image takes over.
    const dur = (payload.displayDuration || 7000) + (payload.transitionDuration || 1500) + SlideEngine.KB_TAIL_MS;
    const easing = 'cubic-bezier(0.33, 0, 0.2, 1)';

    if (intensity <= 0 || !payload.kenBurns) {
      // A static slide needs no compositor promotion — release it.
      layer.kbBg.style.willChange = '';
      layer.kbFg.style.willChange = '';
      layer.kbBg.style.transform = 'scale(1.02)';
      layer.kbFg.style.transform = 'none';   // exact contain → nothing cut off
      return;
    }

    // Promote only the moving wrappers, and only while they actually animate.
    layer.kbBg.style.willChange = 'transform';
    layer.kbFg.style.willChange = 'transform';

    // --- background: full, expressive motion ---
    layer.kbBgAnim = layer.kbBg.animate(
      [
        { transform: `scale(${kb.fromScale}) translate(${kb.fromX}%, ${kb.fromY}%)` },
        { transform: `scale(${kb.toScale}) translate(${kb.toX}%, ${kb.toY}%)` }
      ],
      { duration: dur, easing, fill: 'forwards' }
    );

    // --- foreground: gentle + crop-safe ---
    const FG = 0.34;                                   // fraction of the bg motion
    const fgScale = (s) => 1 + (s - 1) * FG;
    // Max pan (in %) that keeps the scaled image fully covering the frame.
    const safePan = (p, scale) => {
      const headroom = Math.max(0, (scale - 1) / 2 * 100) * 0.85;
      return Math.max(-headroom, Math.min(headroom, p * FG));
    };
    const fFrom = fgScale(kb.fromScale);
    const fTo = fgScale(kb.toScale);
    layer.kbFgAnim = layer.kbFg.animate(
      [
        { transform: `scale(${fFrom}) translate(${safePan(kb.fromX, fFrom)}%, ${safePan(kb.fromY, fFrom)}%)` },
        { transform: `scale(${fTo}) translate(${safePan(kb.toX, fTo)}%, ${safePan(kb.toY, fTo)}%)` }
      ],
      { duration: dur, easing, fill: 'forwards' }
    );

    // Once the motion settles the wrapper is static again — drop the promotion
    // so we never hold idle compositor layers between slides.
    layer.kbBgAnim.onfinish = () => { layer.kbBg.style.willChange = ''; };
    layer.kbFgAnim.onfinish = () => { layer.kbFg.style.willChange = ''; };
  }

  // ---- Transitions --------------------------------------------------------
  _runTransition(incoming, outgoing, payload) {
    const dur = this.preview
      ? Math.min(payload.transitionDuration, 900)
      : payload.transitionDuration || 1500;
    const name = payload.transition || 'fade';
    const ease = 'cubic-bezier(0.4, 0.0, 0.2, 1)';

    // Promote only the layers and only the properties this transition touches,
    // for just its duration — so the GPU never holds idle clip-path/filter
    // layers between slides.
    incoming.el.style.willChange = SlideEngine.WILL_CHANGE[name] || 'opacity, transform';

    // Stack incoming above outgoing.
    incoming.el.style.zIndex = '2';
    outgoing.el.style.zIndex = '1';
    incoming.el.style.opacity = '1';

    const { inFrames, outFrames } = SlideEngine._transitionFrames(name);

    // A video being left keeps playing under the transition and fades out.
    this._fadeOutAudio(outgoing.video, dur);

    incoming.trAnim = incoming.el.animate(inFrames, { duration: dur, easing: ease, fill: 'both' });
    if (outFrames) {
      outgoing.el.style.willChange = 'transform';
      outgoing.outAnim = outgoing.el.animate(outFrames, { duration: dur, easing: ease, fill: 'both' });
    }

    // Runs exactly once: when the transition ends, or synchronously when the
    // next show() lands it early.
    const settle = () => {
      if (this._settle !== settle) return;
      this._settle = null;
      // The end state of every transition is the layer's plain style, so the
      // animations can be cancelled instead of left holding fill state.
      if (incoming.trAnim) { incoming.trAnim.onfinish = null; incoming.trAnim.cancel(); incoming.trAnim = null; }
      if (outgoing.outAnim) { outgoing.outAnim.cancel(); outgoing.outAnim = null; }
      outgoing.el.style.opacity = '0';
      incoming.el.style.clipPath = '';
      incoming.el.style.filter = '';
      incoming.el.style.transform = '';
      incoming.el.style.willChange = '';
      outgoing.el.style.transform = '';
      outgoing.el.style.willChange = '';
      // The outgoing layer is invisible now: stop its video, free the decoder.
      this._detachVideo(outgoing);
    };
    this._settle = settle;
    incoming.trAnim.onfinish = settle;
  }

  static _transitionFrames(name) {
    let inFrames = null;
    let outFrames = null;

    switch (name) {
      case 'fade':
        inFrames = [{ opacity: 0 }, { opacity: 1 }];
        break;
      case 'blur-fade':
        inFrames = [
          { opacity: 0, filter: 'blur(28px)' },
          { opacity: 1, filter: 'blur(0px)' }
        ];
        break;
      case 'zoom-blur':
        // Premium combo: the new image swells in from a soft blur.
        inFrames = [
          { opacity: 0, filter: 'blur(24px)', transform: 'scale(1.18)' },
          { opacity: 1, filter: 'blur(0px)', transform: 'scale(1)' }
        ];
        break;
      case 'wipe-left':
        inFrames = [{ clipPath: 'inset(0 0 0 100%)' }, { clipPath: 'inset(0 0 0 0%)' }];
        break;
      case 'wipe-right':
        inFrames = [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)' }];
        break;
      case 'wipe-up':
        inFrames = [{ clipPath: 'inset(100% 0 0 0)' }, { clipPath: 'inset(0% 0 0 0)' }];
        break;
      case 'wipe-down':
        inFrames = [{ clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0% 0)' }];
        break;
      case 'wipe-diagonal':
        // A diagonal edge sweeps from the top-left corner to the bottom-right.
        inFrames = [
          { clipPath: 'polygon(0% 0%, 0% 0%, 0% 0%)' },
          { clipPath: 'polygon(0% 0%, 200% 0%, 0% 200%)' }
        ];
        break;
      case 'push-left':
        inFrames = [{ transform: 'translateX(100%)' }, { transform: 'translateX(0%)' }];
        outFrames = [{ transform: 'translateX(0%)' }, { transform: 'translateX(-100%)' }];
        break;
      case 'push-right':
        inFrames = [{ transform: 'translateX(-100%)' }, { transform: 'translateX(0%)' }];
        outFrames = [{ transform: 'translateX(0%)' }, { transform: 'translateX(100%)' }];
        break;
      case 'push-up':
        inFrames = [{ transform: 'translateY(100%)' }, { transform: 'translateY(0%)' }];
        outFrames = [{ transform: 'translateY(0%)' }, { transform: 'translateY(-100%)' }];
        break;
      case 'push-down':
        inFrames = [{ transform: 'translateY(-100%)' }, { transform: 'translateY(0%)' }];
        outFrames = [{ transform: 'translateY(0%)' }, { transform: 'translateY(100%)' }];
        break;
      case 'cover-left':
        // Incoming slides in over a stationary outgoing image.
        inFrames = [{ transform: 'translateX(100%)' }, { transform: 'translateX(0%)' }];
        break;
      case 'cover-right':
        inFrames = [{ transform: 'translateX(-100%)' }, { transform: 'translateX(0%)' }];
        break;
      case 'zoom-in':
        inFrames = [
          { opacity: 0, transform: 'scale(1.35)' },
          { opacity: 1, transform: 'scale(1)' }
        ];
        break;
      case 'zoom-out':
        inFrames = [
          { opacity: 0, transform: 'scale(0.72)' },
          { opacity: 1, transform: 'scale(1)' }
        ];
        break;
      case 'circle':
        inFrames = [
          { clipPath: 'circle(0% at 50% 50%)' },
          { clipPath: 'circle(150% at 50% 50%)' }
        ];
        break;
      default:
        inFrames = [{ opacity: 0 }, { opacity: 1 }];
    }

    return { inFrames, outFrames };
  }
}

// Extra time the Ken Burns motion runs beyond the slide + transition so it
// never visibly stops before the next image arrives.
SlideEngine.KB_TAIL_MS = 800;
// Give up on a video whose first frame isn't decodable within this time.
SlideEngine.VIDEO_LOAD_TIMEOUT_MS = 10000;
// Videos prepared ahead of time (each holds a decoder until it is shown).
SlideEngine.VIDEO_PREFETCH_LIMIT = 2;
// Playback progress is reported at most this often (to the main process / UI).
SlideEngine.VIDEO_REPORT_INTERVAL_MS = 200;
// Preview drift correction: tolerated offset and minimum time between seeks.
SlideEngine.VIDEO_SYNC_TOLERANCE_S = 0.4;
SlideEngine.VIDEO_SYNC_COOLDOWN_MS = 3000;

// Map each transition to the minimal set of properties it animates, so the
// engine can scope `will-change` precisely (see _runTransition).
SlideEngine.WILL_CHANGE = {
  'fade': 'opacity',
  'blur-fade': 'opacity, filter',
  'zoom-blur': 'opacity, filter, transform',
  'wipe-left': 'clip-path',
  'wipe-right': 'clip-path',
  'wipe-up': 'clip-path',
  'wipe-down': 'clip-path',
  'wipe-diagonal': 'clip-path',
  'circle': 'clip-path',
  'push-left': 'transform',
  'push-right': 'transform',
  'push-up': 'transform',
  'push-down': 'transform',
  'cover-left': 'transform',
  'cover-right': 'transform',
  'zoom-in': 'opacity, transform',
  'zoom-out': 'opacity, transform'
};

window.SlideEngine = SlideEngine;

/**
 * VideoBackdrop — the blurred "cover" fill behind a video.
 *
 * A second <video> element would decode the whole file twice. Instead, every
 * new frame of the playing video is downsampled on the GPU into a tiny canvas
 * (128 px wide, WebGL texture upload + 16-tap box filter), which the regular
 * `.oss-bg` CSS blur then scales up. Cost per frame: one GPU texture copy and
 * a few thousand fragment samples — no CPU readback, no extra decoder.
 * Falls back to a 2D canvas when WebGL is unavailable.
 */
class VideoBackdrop {
  constructor(canvas) {
    this.canvas = canvas;
    this.video = null;
    this.handle = 0;
    this.last = 0;
    this.gl = null;
    this.ctx = null;
    this.initialized = false;
    canvas.width = 2;
    canvas.height = 2;
  }

  attach(video) {
    this.detach();
    if (!this.initialized) this._init();
    this.video = video;
    this._resize();
    this._draw();                          // first frame is already decoded
    if (typeof video.requestVideoFrameCallback !== 'function') return;
    // Redraw only when the video actually presents a new frame (capped), so a
    // paused or ended video costs nothing.
    const tick = (now) => {
      if (this.video !== video) return;
      if (now - this.last >= VideoBackdrop.MIN_FRAME_MS) {
        this.last = now;
        this._draw();
      }
      this.handle = video.requestVideoFrameCallback(tick);
    };
    this.handle = video.requestVideoFrameCallback(tick);
  }

  detach() {
    if (this.video && this.handle && typeof this.video.cancelVideoFrameCallback === 'function') {
      this.video.cancelVideoFrameCallback(this.handle);
    }
    this.video = null;
    this.handle = 0;
  }

  _init() {
    this.initialized = true;
    const gl = this.canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, stencil: false,
      premultipliedAlpha: false, preserveDrawingBuffer: false
    });
    if (gl && this._initGl(gl)) {
      this.gl = gl;
      this.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.glReady = false; });
      this.canvas.addEventListener('webglcontextrestored', () => {
        if (this._initGl(this.gl)) { this._resize(); this._draw(); }
      });
      return;
    }
    this.ctx = this.canvas.getContext('2d', { alpha: false });
  }

  _initGl(gl) {
    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null;
    };
    const vs = compile(gl.VERTEX_SHADER, `#version 300 es
      in vec2 p;
      out vec2 uv;
      void main() {
        uv = vec2(0.5 + 0.5 * p.x, 0.5 - 0.5 * p.y);
        gl_Position = vec4(p, 0.0, 1.0);
      }`);
    // Each output pixel averages a 4x4 grid of (bilinear) taps spread over its
    // footprint in the source frame, so downsampling a 4K frame doesn't alias
    // into a shimmering background.
    const fs = compile(gl.FRAGMENT_SHADER, `#version 300 es
      precision mediump float;
      uniform sampler2D tex;
      uniform vec2 footprint;
      in vec2 uv;
      out vec4 color;
      void main() {
        vec3 c = vec3(0.0);
        for (int y = 0; y < 4; y++) {
          for (int x = 0; x < 4; x++) {
            vec2 o = (vec2(float(x), float(y)) - 1.5) * 0.25 * footprint;
            c += texture(tex, uv + o).rgb;
          }
        }
        color = vec4(c * 0.0625, 1.0);
      }`);
    if (!vs || !fs) return false;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
    gl.useProgram(prog);

    // One oversized triangle covers the whole viewport.
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(gl.getUniformLocation(prog, 'tex'), 0);

    this.uFootprint = gl.getUniformLocation(prog, 'footprint');
    this.glReady = true;
    return true;
  }

  _resize() {
    const v = this.video;
    if (!v) return;
    const vw = v.videoWidth || 16;
    const vh = v.videoHeight || 9;
    const w = VideoBackdrop.WIDTH;
    const h = Math.max(1, Math.min(4 * w, Math.round(w * vh / vw)));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    if (this.gl && this.glReady) {
      this.gl.viewport(0, 0, w, h);
      this.gl.uniform2f(this.uFootprint, 1 / w, 1 / h);
    }
  }

  _draw() {
    const v = this.video;
    if (!v || v.readyState < 2) return;
    try {
      if (this.gl) {
        if (!this.glReady) return;
        const gl = this.gl;
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      } else if (this.ctx) {
        this.ctx.drawImage(v, 0, 0, this.canvas.width, this.canvas.height);
      }
    } catch (err) {
      // e.g. a frame the GPU can't import: degrade to the 2D path for good.
      if (this.gl) {
        console.warn('[backdrop] WebGL upload failed, using 2D canvas:', err && err.message);
        this._fallbackTo2d();
      }
    }
  }

  _fallbackTo2d() {
    // A canvas keeps its first context type, so swap in a fresh element.
    const fresh = this.canvas.cloneNode(false);
    this.canvas.replaceWith(fresh);
    this.canvas = fresh;
    this.gl = null;
    this.glReady = false;
    this.ctx = fresh.getContext('2d', { alpha: false });
    this._resize();
  }
}

VideoBackdrop.WIDTH = 128;          // px; the CSS blur hides the low resolution
VideoBackdrop.MIN_FRAME_MS = 30;    // at most ~33 redraws per second

/**
 * Render the custom text overlay (e.g. the event name) into a given layer.
 * Shared by Output and the Control preview so both look identical.
 *
 *   layerEl  <- full-frame flex box that positions the text (the CSS container)
 *   textEl   <- the actual text element; its size scales with the frame height
 *
 * Font size is expressed in `cqh` (1% of the container's height), so the same
 * numeric value looks proportionally identical on the full-screen output and in
 * the small preview frame.
 */
function applyTextOverlay(layerEl, textEl, overlay) {
  const ov = overlay || {};
  const text = (ov.text || '').trim();

  if (!ov.enabled || !text) {
    layerEl.style.display = 'none';
    return;
  }

  layerEl.style.display = 'flex';
  textEl.textContent = text;
  textEl.style.setProperty('--ov-size', ov.fontSize != null ? ov.fontSize : 6);
  textEl.style.color = ov.color || '#ffffff';
  textEl.style.fontFamily = ov.fontFamily
    ? `"${ov.fontFamily}", system-ui, sans-serif`
    : 'system-ui, sans-serif';
  textEl.style.fontWeight = ov.bold ? '700' : '400';
  textEl.style.textShadow = ov.shadow
    ? '0 0.3cqh 1.2cqh rgba(0,0,0,0.85), 0 0 0.4cqh rgba(0,0,0,0.6)'
    : 'none';

  // position: "{top|middle|bottom}-{left|center|right}"
  const [vert, horiz] = String(ov.position || 'bottom-right').split('-');
  const VMAP = { top: 'flex-start', middle: 'center', bottom: 'flex-end' };
  const HMAP = { left: 'flex-start', center: 'center', right: 'flex-end' };
  layerEl.style.alignItems = VMAP[vert] || 'flex-end';
  layerEl.style.justifyContent = HMAP[horiz] || 'flex-end';
  textEl.style.textAlign = horiz === 'left' ? 'left' : horiz === 'center' ? 'center' : 'right';
}

window.applyTextOverlay = applyTextOverlay;
