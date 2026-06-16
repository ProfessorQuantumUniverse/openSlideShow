'use strict';

const stage = document.getElementById('stage');
const idle = document.getElementById('idle');
const ident = document.getElementById('ident');
const overlayLayer = document.getElementById('overlayLayer');
const overlayText = document.getElementById('overlayText');

const engine = new SlideEngine(stage, { preview: false, cacheLimit: 8 });

window.api.onShow((payload) => {
  if (payload && payload.current) {
    idle.classList.add('hidden');
  } else {
    idle.classList.remove('hidden');
  }
  engine.show(payload);
});

window.api.onIdentify(() => {
  ident.classList.add('show');
  setTimeout(() => ident.classList.remove('show'), 1600);
});

// Keep the text overlay in sync with the live config.
window.api.onState((s) => {
  if (s && s.config) applyTextOverlay(overlayLayer, overlayText, s.config.overlay);
});

// Pull initial state in case a folder was already loaded before this window
// finished loading.
window.api.getState().then((s) => {
  if (s && s.current) idle.classList.add('hidden');
  if (s && s.config) applyTextOverlay(overlayLayer, overlayText, s.config.overlay);
});

// Safety: keep the cursor hidden even if focus changes.
document.addEventListener('mousemove', () => { document.body.style.cursor = 'none'; });
