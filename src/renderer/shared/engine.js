'use strict';

/**
 * SlideEngine — the visual core, shared by the Output screen and the Control
 * preview so both render identically from the same `show` payload.
 *
 * Architecture per layer (two layers, double-buffered):
 *
 *   .oss-layer            <- transition transforms / opacity / clip-path
 *     .oss-kb             <- continuous Ken Burns transform (scale + pan)
 *       img.oss-bg        <- blurred "cover" fill (kills black bars)
 *       img.oss-fg        <- sharp "contain" image
 *
 * Keeping transition transforms (on .oss-layer) separate from the Ken Burns
 * transform (on .oss-kb) means the two never fight over `transform`.
 *
 * Everything animates via the Web Animations API on `transform`, `opacity`,
 * `filter` and `clip-path`, which the compositor handles on the GPU — so the
 * main thread stays free and the motion is butter-smooth.
 */
class SlideEngine {
  constructor(rootEl, opts = {}) {
    this.root = rootEl;
    this.preview = Boolean(opts.preview);
    this.cacheLimit = opts.cacheLimit || 8;

    this._cache = new Map();   // url -> decoded HTMLImageElement (prefetch)
    this._gen = 0;             // generation token to drop superseded shows
    this._active = 0;
    this._next = 1;

    this.root.classList.add('oss-root');
    this.layers = [this._makeLayer(), this._makeLayer()];
    this.layers.forEach(l => this.root.appendChild(l.el));
    this.layers[1].el.style.opacity = '0';
  }

  _makeLayer() {
    const el = document.createElement('div');
    el.className = 'oss-layer';
    const kb = document.createElement('div');
    kb.className = 'oss-kb';
    const bg = document.createElement('img');
    bg.className = 'oss-bg';
    bg.decoding = 'async';
    const fg = document.createElement('img');
    fg.className = 'oss-fg';
    fg.decoding = 'async';
    kb.appendChild(bg);
    kb.appendChild(fg);
    el.appendChild(kb);
    return { el, kb, bg, fg, kbAnim: null, trAnim: null };
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
      const oldest = this._cache.keys().next().value;
      this._cache.delete(oldest);
    }
    return img;
  }

  prefetch(items) {
    (items || []).forEach(it => { this._ensureDecoded(it.url); });
  }

  clear() {
    this.layers.forEach(l => {
      if (l.kbAnim) l.kbAnim.cancel();
      if (l.trAnim) l.trAnim.cancel();
      l.el.style.opacity = '0';
    });
  }

  // ---- main entry point ---------------------------------------------------
  async show(payload) {
    if (!payload || !payload.current) { this.clear(); return; }
    const gen = ++this._gen;

    const img = await this._ensureDecoded(payload.current.url);
    if (gen !== this._gen) return;          // a newer show() superseded us
    if (!img) return;

    const incoming = this.layers[this._next];
    const outgoing = this.layers[this._active];

    this._buildLayer(incoming, payload);
    this._startKenBurns(incoming, payload);

    const firstShow = payload.transition === 'none';
    if (firstShow) {
      incoming.el.style.opacity = '1';
      incoming.el.style.zIndex = '2';
      outgoing.el.style.opacity = '0';
      outgoing.el.style.zIndex = '1';
    } else {
      this._runTransition(incoming, outgoing, payload);
    }

    this._active = this._next;
    this._next = 1 - this._next;

    this.prefetch(payload.upcoming);
  }

  _buildLayer(layer, payload) {
    const url = payload.current.url;
    layer.fg.src = url;
    layer.bg.src = url;

    const mode = payload.backgroundMode || 'blur';
    layer.el.classList.remove('mode-blur', 'mode-solid', 'mode-stretch');
    layer.el.classList.add('mode-' + mode);

    // Reset transition styling so the next transition starts clean.
    layer.el.style.clipPath = '';
    layer.el.style.filter = '';
    layer.el.style.transform = '';
  }

  // ---- Ken Burns ----------------------------------------------------------
  _startKenBurns(layer, payload) {
    if (layer.kbAnim) layer.kbAnim.cancel();
    const kb = payload.kenBurns || {};
    const intensity = payload.kenBurnsIntensity != null ? payload.kenBurnsIntensity : 1;
    if (intensity <= 0) {
      layer.kb.style.transform = 'scale(1.04)';
      return;
    }
    const from = `scale(${kb.fromScale}) translate(${kb.fromX}%, ${kb.fromY}%)`;
    const to = `scale(${kb.toScale}) translate(${kb.toX}%, ${kb.toY}%)`;
    // Run longer than the slide so motion never visibly stops before replacement.
    const dur = (payload.displayDuration || 7000) + (payload.transitionDuration || 1500) + 800;
    layer.kbAnim = layer.kb.animate(
      [{ transform: from }, { transform: to }],
      { duration: dur, easing: 'cubic-bezier(0.33, 0, 0.2, 1)', fill: 'forwards' }
    );
  }

  // ---- Transitions --------------------------------------------------------
  _runTransition(incoming, outgoing, payload) {
    const dur = this.preview
      ? Math.min(payload.transitionDuration, 900)
      : payload.transitionDuration || 1500;
    const name = payload.transition || 'fade';
    const ease = 'cubic-bezier(0.4, 0.0, 0.2, 1)';

    // Stack incoming above outgoing.
    incoming.el.style.zIndex = '2';
    outgoing.el.style.zIndex = '1';
    incoming.el.style.opacity = '1';

    // Finish any in-flight transition on these layers (rapid next/prev).
    if (incoming.trAnim) incoming.trAnim.finish();
    if (outgoing.trAnim) outgoing.trAnim.finish();

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
      case 'push-left':
        inFrames = [{ transform: 'translateX(100%)' }, { transform: 'translateX(0%)' }];
        outFrames = [{ transform: 'translateX(0%)' }, { transform: 'translateX(-100%)' }];
        break;
      case 'push-right':
        inFrames = [{ transform: 'translateX(-100%)' }, { transform: 'translateX(0%)' }];
        outFrames = [{ transform: 'translateX(0%)' }, { transform: 'translateX(100%)' }];
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

    incoming.trAnim = incoming.el.animate(inFrames, { duration: dur, easing: ease, fill: 'both' });
    if (outFrames) {
      outgoing.trAnim = outgoing.el.animate(outFrames, { duration: dur, easing: ease, fill: 'both' });
    }
    incoming.trAnim.onfinish = () => {
      outgoing.el.style.opacity = '0';
      // Clear lingering fill state so layer is reusable.
      incoming.el.style.clipPath = '';
      incoming.el.style.filter = '';
      incoming.el.style.transform = '';
      if (outFrames && outgoing.trAnim) {
        outgoing.trAnim.cancel();
        outgoing.el.style.transform = '';
      }
    };
  }
}

window.SlideEngine = SlideEngine;
