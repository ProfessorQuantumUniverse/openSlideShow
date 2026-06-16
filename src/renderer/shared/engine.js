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

    // Background and foreground each get their OWN Ken Burns wrapper so the
    // blurred fill can move freely (cropping is invisible) while the sharp
    // image only does a gentle, crop-safe motion.
    const kbBg = document.createElement('div');
    kbBg.className = 'oss-kb oss-kb-bg';
    const bg = document.createElement('img');
    bg.className = 'oss-bg';
    bg.decoding = 'async';
    kbBg.appendChild(bg);

    const kbFg = document.createElement('div');
    kbFg.className = 'oss-kb oss-kb-fg';
    const fg = document.createElement('img');
    fg.className = 'oss-fg';
    fg.decoding = 'async';
    kbFg.appendChild(fg);

    el.appendChild(kbBg);
    el.appendChild(kbFg);
    return { el, kbBg, kbFg, bg, fg, kbBgAnim: null, kbFgAnim: null, trAnim: null };
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

  prefetch(items) {
    (items || []).forEach(it => { this._ensureDecoded(it.url); });
  }

  clear() {
    this.layers.forEach(l => {
      if (l.kbBgAnim) l.kbBgAnim.cancel();
      if (l.kbFgAnim) l.kbFgAnim.cancel();
      if (l.trAnim) l.trAnim.cancel();
      l.el.style.opacity = '0';
      l.el.style.willChange = '';   // release compositor layers while idle
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
      incoming.el.style.willChange = '';   // static slide — release promotion
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
    const dur = (payload.displayDuration || 7000) + (payload.transitionDuration || 1500) + 800;
    const easing = 'cubic-bezier(0.33, 0, 0.2, 1)';

    if (intensity <= 0) {
      layer.kbBg.style.transform = 'scale(1.02)';
      layer.kbFg.style.transform = 'none';   // exact contain → nothing cut off
      return;
    }

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

    incoming.trAnim = incoming.el.animate(inFrames, { duration: dur, easing: ease, fill: 'both' });
    if (outFrames) {
      outgoing.el.style.willChange = 'transform';
      outgoing.trAnim = outgoing.el.animate(outFrames, { duration: dur, easing: ease, fill: 'both' });
    }
    incoming.trAnim.onfinish = () => {
      outgoing.el.style.opacity = '0';
      // Clear lingering fill state so the layer is reusable, and release the
      // compositor promotion now that the layer is static again.
      incoming.el.style.clipPath = '';
      incoming.el.style.filter = '';
      incoming.el.style.transform = '';
      incoming.el.style.willChange = '';
      if (outFrames && outgoing.trAnim) {
        outgoing.trAnim.cancel();
        outgoing.el.style.transform = '';
      }
      outgoing.el.style.willChange = '';
    };
  }
}

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
