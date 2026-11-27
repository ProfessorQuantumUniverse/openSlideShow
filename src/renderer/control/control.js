'use strict';

const $ = (id) => document.getElementById(id);

// --- preview engine (mirrors the output) ---------------------------------
// Always muted. Its playback reports only count when there is no output window
// (the main process decides); otherwise it follows the output's position.
const preview = new SlideEngine($('preview'), {
  preview: true,
  cacheLimit: 6,
  onVideo: (ev) => window.api.reportVideo(ev)
});

// --- element refs ---------------------------------------------------------
const els = {
  folderBtn: $('folderBtn'),
  reloadBtn: $('reloadBtn'),
  folderInfo: $('folderInfo'),
  orderSelect: $('orderSelect'),
  orderHint: $('orderHint'),
  playBtn: $('playBtn'),
  playIcon: $('playIcon'),
  pauseIcon: $('pauseIcon'),
  prevBtn: $('prevBtn'),
  nextBtn: $('nextBtn'),
  playState: $('playState'),
  curName: $('curName'),
  curCount: $('curCount'),
  previewEmpty: $('previewEmpty'),
  durRange: $('durRange'),
  durVal: $('durVal'),
  transRange: $('transRange'),
  transVal: $('transVal'),
  kbRange: $('kbRange'),
  kbVal: $('kbVal'),
  bgSeg: $('bgSeg'),
  transSelect: $('transSelect'),
  vidAudio: $('vidAudio'),
  vidVolRange: $('vidVolRange'),
  vidVolVal: $('vidVolVal'),
  vidBar: $('vidBar'),
  vidFill: $('vidFill'),
  vidTime: $('vidTime'),
  ovEnable: $('ovEnable'),
  ovText: $('ovText'),
  ovFont: $('ovFont'),
  ovSizeRange: $('ovSizeRange'),
  ovSizeVal: $('ovSizeVal'),
  ovColor: $('ovColor'),
  ovPos: $('ovPos'),
  ovBold: $('ovBold'),
  ovShadow: $('ovShadow'),
  ovPreviewLayer: $('ovPreviewLayer'),
  ovPreviewText: $('ovPreviewText'),
  displayInfo: $('displayInfo'),
  identifyBtn: $('identifyBtn'),
  fsBtn: $('fsBtn'),
  statusText: $('statusText')
};

let count = 0;
let currentType = null;   // 'image' | 'video' of the item on screen
let lastState = null;

// --- range slider fill helper --------------------------------------------
// Only updates the --pct custom property; the gradient itself lives in CSS, so
// this stays cheap even when fired on every pointermove during a drag.
function paintRange(input) {
  const min = parseFloat(input.min), max = parseFloat(input.max);
  const pct = ((parseFloat(input.value) - min) / (max - min)) * 100;
  input.style.setProperty('--pct', pct + '%');
}

// Trailing debounce: collapse a burst of slider/typing events into one IPC
// round-trip to the main process. The local preview is still updated instantly.
function debounce(fn, ms) {
  let t = null;
  return () => {
    if (t) clearTimeout(t);
    t = setTimeout(() => { t = null; fn(); }, ms);
  };
}

function setStatus(msg) { els.statusText.textContent = msg; }

// --- overlay --------------------------------------------------------------
function readOverlay() {
  return {
    enabled: els.ovEnable.checked,
    text: els.ovText.value,
    fontFamily: els.ovFont.value,
    fontSize: parseFloat(els.ovSizeRange.value),
    color: els.ovColor.value,
    position: els.ovPos.value,
    bold: els.ovBold.checked,
    shadow: els.ovShadow.checked
  };
}

// Mirror the overlay onto the local preview so it is WYSIWYG with the output.
function renderOverlayPreview() {
  applyTextOverlay(els.ovPreviewLayer, els.ovPreviewText, readOverlay());
}

// --- config push ----------------------------------------------------------
// Read values at fire time (after debounce) so the main process always gets the
// latest state, never a stale snapshot captured when the burst started.
const sendConfig = debounce(() => {
  window.api.setConfig({
    displayDuration: parseFloat(els.durRange.value) * 1000,
    transitionDuration: parseFloat(els.transRange.value) * 1000,
    kenBurnsIntensity: parseFloat(els.kbRange.value),
    backgroundMode: els.bgSeg.querySelector('.seg.active').dataset.val,
    transitionMode: els.transSelect.value,
    sortOrder: els.orderSelect.value,
    videoAudio: els.vidAudio.checked,
    videoVolume: parseFloat(els.vidVolRange.value),
    overlay: readOverlay()
  });
}, 80);

function pushConfig() {
  sendConfig();          // debounced IPC to the main process
  renderOverlayPreview(); // local preview stays perfectly live
}

// --- transport ------------------------------------------------------------
els.playBtn.addEventListener('click', () => window.api.togglePlay());
els.prevBtn.addEventListener('click', () => window.api.prev());
els.nextBtn.addEventListener('click', () => window.api.next());

els.folderBtn.addEventListener('click', async () => {
  setStatus('Ordner wird eingelesen…');
  try {
    const res = await window.api.chooseFolder();
    setStatus(res ? `${describeCount(res.counts, res.count)} geladen.` : 'Abgebrochen.');
  } catch {
    setStatus('Fehler beim Einlesen des Ordners.');
  }
});

els.reloadBtn.addEventListener('click', async () => {
  setStatus('Neu einlesen…');
  try {
    const res = await window.api.reloadFolder();
    if (res) setStatus(`${describeCount(res.counts, res.count)} neu eingelesen.`);
  } catch {
    setStatus('Fehler beim Neu-Einlesen.');
  }
});

// Date orders need a word on where the date comes from; the others are obvious.
function renderOrderHint() {
  els.orderHint.classList.toggle('hidden', !els.orderSelect.value.startsWith('date-'));
}

els.orderSelect.addEventListener('change', () => {
  renderOrderHint();
  pushConfig();
});

els.identifyBtn.addEventListener('click', () => window.api.identifyOutput());
els.fsBtn.addEventListener('click', () => window.api.toggleOutputFullscreen());

// --- config controls ------------------------------------------------------
els.durRange.addEventListener('input', () => {
  els.durVal.textContent = parseFloat(els.durRange.value).toFixed(1) + ' s';
  paintRange(els.durRange);
  pushConfig();
});
els.transRange.addEventListener('input', () => {
  els.transVal.textContent = parseFloat(els.transRange.value).toFixed(1) + ' s';
  paintRange(els.transRange);
  pushConfig();
});
els.kbRange.addEventListener('input', () => {
  els.kbVal.textContent = Math.round(parseFloat(els.kbRange.value) * 100) + '%';
  paintRange(els.kbRange);
  pushConfig();
});

els.bgSeg.addEventListener('click', (e) => {
  const btn = e.target.closest('.seg');
  if (!btn) return;
  els.bgSeg.querySelectorAll('.seg').forEach(s => s.classList.remove('active'));
  btn.classList.add('active');
  pushConfig();
});

els.transSelect.addEventListener('change', pushConfig);

// --- video sound ------------------------------------------------------------
function renderVolume() {
  els.vidVolVal.textContent = Math.round(parseFloat(els.vidVolRange.value) * 100) + '%';
  paintRange(els.vidVolRange);
  els.vidVolRange.disabled = !els.vidAudio.checked;
}
els.vidVolRange.addEventListener('input', () => { renderVolume(); pushConfig(); });
els.vidAudio.addEventListener('change', () => { renderVolume(); pushConfig(); });

// --- overlay controls -----------------------------------------------------
els.ovSizeRange.addEventListener('input', () => {
  els.ovSizeVal.textContent = parseFloat(els.ovSizeRange.value).toFixed(1) + '%';
  paintRange(els.ovSizeRange);
  pushConfig();
});
// `input` keeps the text live as the operator types; the rest fire on change.
els.ovText.addEventListener('input', pushConfig);
els.ovColor.addEventListener('input', pushConfig);
[els.ovEnable, els.ovFont, els.ovPos, els.ovBold, els.ovShadow].forEach(el =>
  el.addEventListener('change', pushConfig)
);

// Populate the font picker from the system's installed fonts.
window.api.listFonts().then((fonts) => {
  const frag = document.createDocumentFragment();
  (fonts || []).forEach((f) => {
    const o = document.createElement('option');
    o.value = f;
    o.textContent = f;
    o.style.fontFamily = `"${f}", system-ui, sans-serif`;
    frag.appendChild(o);
  });
  els.ovFont.appendChild(frag);
  if (pendingOverlayFont) {
    selectFont(pendingOverlayFont);
    pendingOverlayFont = null;
  }
  renderOverlayPreview();
});

// Ensure a font value is selectable even if enumeration missed it.
function selectFont(name) {
  if (!name) return;
  const exists = Array.from(els.ovFont.options).some(o => o.value === name);
  if (!exists) {
    const o = document.createElement('option');
    o.value = name;
    o.textContent = name;
    o.style.fontFamily = `"${name}", system-ui, sans-serif`;
    els.ovFont.insertBefore(o, els.ovFont.firstChild);
  }
  els.ovFont.value = name;
}

// --- keyboard shortcuts ---------------------------------------------------
document.addEventListener('keydown', (e) => {
  const t = e.target;
  // Don't hijack typing/selection in any editable control.
  if (t.tagName === 'INPUT' || t.tagName === 'SELECT' ||
      t.tagName === 'TEXTAREA' || t.isContentEditable) return;
  switch (e.key) {
    case ' ': e.preventDefault(); window.api.togglePlay(); break;
    case 'ArrowRight': window.api.next(); break;
    case 'ArrowLeft': window.api.prev(); break;
    case 'f': case 'F': window.api.toggleOutputFullscreen(); break;
  }
});

// --- incoming events ------------------------------------------------------
window.api.onShow((payload) => {
  preview.show(payload);
  if (payload && payload.current) {
    els.previewEmpty.classList.add('hidden');
    els.curName.textContent = payload.current.name;
    currentType = payload.current.type;
  } else {
    els.previewEmpty.classList.remove('hidden');
    els.curName.textContent = '';
    currentType = null;
  }
  renderVideoProgress(currentType === 'video' ? { time: 0, duration: 0 } : null, true);
  if (lastState) renderCounter(lastState);
});

// Authoritative playback position of the current video (from the output).
window.api.onVideoProgress((v) => {
  if (!v || currentType !== 'video' || !lastState || v.token !== lastState.shownCounter) return;
  preview.syncVideo(v.token, v.time);
  renderVideoProgress(v);
});

function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

function renderVideoProgress(v, instant) {
  const show = Boolean(v);
  // A new video starts the bar at zero at once instead of gliding back.
  if (instant) {
    els.vidFill.style.transition = 'none';
    els.vidFill.style.setProperty('--p', 0);
    void els.vidFill.offsetWidth;     // commit the jump before re-enabling the glide
    els.vidFill.style.transition = '';
  }
  els.vidBar.classList.toggle('hidden', !show);
  els.vidTime.classList.toggle('hidden', !show);
  if (!show) return;
  if (v.error) {
    els.vidTime.textContent = 'Video nicht abspielbar — wird übersprungen';
    els.vidTime.classList.add('vid-error');
    els.vidFill.style.setProperty('--p', 0);
    return;
  }
  els.vidTime.classList.remove('vid-error');
  const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
  els.vidTime.textContent = dur ? `${formatTime(v.time)} / ${formatTime(dur)}` : '';
  els.vidFill.style.setProperty('--p', dur ? Math.min(1, v.time / dur) : 0);
}

function describeCount(counts, total) {
  if (!counts) return `${total} Dateien`;
  const parts = [`${counts.images} ${counts.images === 1 ? 'Bild' : 'Bilder'}`];
  if (counts.videos) parts.push(`${counts.videos} ${counts.videos === 1 ? 'Video' : 'Videos'}`);
  return parts.join(' · ');
}

function renderCounter(s) {
  const label = currentType === 'video' ? 'Video' : 'Bild';
  els.curCount.textContent = s.count ? `${label} ${(s.shownCounter % s.count) || s.count} · ${s.count}` : '';
}

window.api.onState((s) => applyState(s));

function applyState(s) {
  count = s.count;
  lastState = s;
  preview.setPlaying(s.isPlaying);

  // play state
  if (s.isPlaying) {
    els.playIcon.classList.add('hidden');
    els.pauseIcon.classList.remove('hidden');
    els.playState.textContent = 'Läuft';
    els.playState.className = 'state-chip state-playing';
  } else {
    els.playIcon.classList.remove('hidden');
    els.pauseIcon.classList.add('hidden');
    els.playState.textContent = 'Pausiert';
    els.playState.className = 'state-chip state-paused';
  }

  // folder
  if (s.folder) {
    // Build nodes instead of innerHTML so the folder path is always plain text.
    const total = document.createElement('strong');
    total.textContent = describeCount(s.counts, s.count);
    els.folderInfo.replaceChildren(
      total, document.createElement('br'), String(s.folder)
    );
    els.previewEmpty.classList.toggle('hidden', s.count > 0);
  } else {
    els.folderInfo.textContent = 'Noch kein Ordner ausgewählt.';
  }

  // counter
  renderCounter(s);

  // output fullscreen button reflects current projection state
  els.fsBtn.textContent = s.outputFullscreen ? 'Output Fenster' : 'Output Vollbild';
  els.fsBtn.classList.toggle('btn-primary', !!s.outputFullscreen);

  // display info
  if (s.displays) {
    const d = s.displays;
    els.displayInfo.textContent = d.hasExternal
      ? `2 Displays · Output extern`
      : `1 Display · Output im Fenster`;
    els.displayInfo.className = d.hasExternal ? 'pill pill-good' : 'pill pill-muted';
  }

  // transition list (populate once)
  if (s.transitions && els.transSelect.options.length === 0) {
    const opt = (v, label) => { const o = document.createElement('option'); o.value = v; o.textContent = label; return o; };
    const labels = {
      'fade': 'Crossfade', 'blur-fade': 'Blur Fade', 'zoom-blur': 'Zoom Blur',
      'wipe-left': 'Wipe ←', 'wipe-right': 'Wipe →', 'wipe-up': 'Wipe ↑', 'wipe-down': 'Wipe ↓',
      'wipe-diagonal': 'Wipe ↘ (Diagonal)',
      'push-left': 'Push ←', 'push-right': 'Push →', 'push-up': 'Push ↑', 'push-down': 'Push ↓',
      'cover-left': 'Cover ←', 'cover-right': 'Cover →',
      'zoom-in': 'Zoom In', 'zoom-out': 'Zoom Out', 'circle': 'Iris (Kreis)'
    };
    els.transSelect.appendChild(opt('random', '🎲 Zufällig (empfohlen)'));
    s.transitions.forEach(t => els.transSelect.appendChild(opt(t, labels[t] || t)));
  }

  // sync config controls to state (without re-triggering push loops)
  syncConfigControls(s.config);
}

let controlsSynced = false;
let pendingOverlayFont = null;    // font to select once the picker is populated
function syncConfigControls(cfg) {
  if (controlsSynced) return;     // only seed once; user owns them afterwards
  controlsSynced = true;
  els.durRange.value = cfg.displayDuration / 1000;
  els.durVal.textContent = (cfg.displayDuration / 1000).toFixed(1) + ' s';
  els.transRange.value = cfg.transitionDuration / 1000;
  els.transVal.textContent = (cfg.transitionDuration / 1000).toFixed(1) + ' s';
  els.kbRange.value = cfg.kenBurnsIntensity;
  els.kbVal.textContent = Math.round(cfg.kenBurnsIntensity * 100) + '%';
  [els.durRange, els.transRange, els.kbRange].forEach(paintRange);

  els.bgSeg.querySelectorAll('.seg').forEach(s => {
    s.classList.toggle('active', s.dataset.val === cfg.backgroundMode);
  });
  if (els.transSelect.options.length) els.transSelect.value = cfg.transitionMode;
  if (cfg.sortOrder) els.orderSelect.value = cfg.sortOrder;
  renderOrderHint();

  // video sound
  els.vidAudio.checked = cfg.videoAudio !== false;
  els.vidVolRange.value = cfg.videoVolume != null ? cfg.videoVolume : 1;
  renderVolume();

  // overlay
  const ov = cfg.overlay || {};
  els.ovEnable.checked = !!ov.enabled;
  els.ovText.value = ov.text || '';
  els.ovSizeRange.value = ov.fontSize != null ? ov.fontSize : 6;
  els.ovSizeVal.textContent = parseFloat(els.ovSizeRange.value).toFixed(1) + '%';
  paintRange(els.ovSizeRange);
  els.ovColor.value = ov.color || '#ffffff';
  if (ov.position) els.ovPos.value = ov.position;
  els.ovBold.checked = ov.bold !== false;
  els.ovShadow.checked = ov.shadow !== false;
  // The font list may not have loaded yet; defer selection if so.
  if (els.ovFont.options.length) selectFont(ov.fontFamily);
  else pendingOverlayFont = ov.fontFamily;
  renderOverlayPreview();
}

// --- boot ----------------------------------------------------------------
[els.durRange, els.transRange, els.kbRange, els.ovSizeRange].forEach(paintRange);
window.api.getState().then(applyState);
setStatus('Bereit. Wähle einen Ordner mit Bildern und Videos.');
