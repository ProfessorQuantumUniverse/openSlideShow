'use strict';

const stage = document.getElementById('stage');
const idle = document.getElementById('idle');
const ident = document.getElementById('ident');
const overlayLayer = document.getElementById('overlayLayer');
const overlayText = document.getElementById('overlayText');

const engine = new SlideEngine(stage, {
  preview: false,
  cacheLimit: 8,
  // The output is the authority on video playback: the main process advances
  // the show when it reports that a video has ended.
  onVideo: (ev) => window.api.reportVideo(ev)
});

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

// Keep the text overlay, play state and video sound in sync with the live config.
function applyState(s) {
  if (!s) return;
  engine.setPlaying(s.isPlaying);
  if (s.config) {
    applyTextOverlay(overlayLayer, overlayText, s.config.overlay);
    engine.setAudio({ enabled: s.config.videoAudio !== false, volume: s.config.videoVolume });
  }
}

window.api.onState(applyState);

// Pull initial state in case a folder was already loaded before this window
// finished loading.
window.api.getState().then((s) => {
  if (s && s.current) idle.classList.add('hidden');
  applyState(s);
});

// The cursor is hidden globally via `cursor: none` in output.css — no per-move
// JS handler needed (it only re-set a value the CSS already enforced).
