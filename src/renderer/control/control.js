'use strict';

const $ = (id) => document.getElementById(id);

// --- preview engine (mirrors the output) ---------------------------------
const preview = new SlideEngine($('preview'), { preview: true, cacheLimit: 6 });

// --- element refs ---------------------------------------------------------
const els = {
  folderBtn: $('folderBtn'),
  reloadBtn: $('reloadBtn'),
  folderInfo: $('folderInfo'),
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
  displayInfo: $('displayInfo'),
  identifyBtn: $('identifyBtn'),
  fsBtn: $('fsBtn'),
  statusText: $('statusText')
};

let count = 0;

// --- range slider fill helper --------------------------------------------
function paintRange(input) {
  const min = parseFloat(input.min), max = parseFloat(input.max);
  const pct = ((parseFloat(input.value) - min) / (max - min)) * 100;
  input.style.background =
    `linear-gradient(90deg, var(--accent) 0%, var(--accent) ${pct}%, #2a3142 ${pct}%)`;
}

function setStatus(msg) { els.statusText.textContent = msg; }

// --- config push ----------------------------------------------------------
function pushConfig() {
  window.api.setConfig({
    displayDuration: parseFloat(els.durRange.value) * 1000,
    transitionDuration: parseFloat(els.transRange.value) * 1000,
    kenBurnsIntensity: parseFloat(els.kbRange.value),
    backgroundMode: els.bgSeg.querySelector('.seg.active').dataset.val,
    transitionMode: els.transSelect.value
  });
}

// --- transport ------------------------------------------------------------
els.playBtn.addEventListener('click', () => window.api.togglePlay());
els.prevBtn.addEventListener('click', () => window.api.prev());
els.nextBtn.addEventListener('click', () => window.api.next());

els.folderBtn.addEventListener('click', async () => {
  setStatus('Ordner wird eingelesen…');
  const res = await window.api.chooseFolder();
  if (res) setStatus(`${res.count} Bilder geladen.`);
  else setStatus('Abgebrochen.');
});

els.reloadBtn.addEventListener('click', async () => {
  setStatus('Neu einlesen…');
  const res = await window.api.reloadFolder();
  if (res) setStatus(`${res.count} Bilder neu eingelesen.`);
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

// --- keyboard shortcuts ---------------------------------------------------
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
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
  } else {
    els.previewEmpty.classList.remove('hidden');
    els.curName.textContent = '';
  }
});

window.api.onState((s) => applyState(s));

function applyState(s) {
  count = s.count;

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
    els.folderInfo.innerHTML = `<strong>${s.count}</strong> Bilder<br>${s.folder}`;
    els.previewEmpty.classList.toggle('hidden', s.count > 0);
  } else {
    els.folderInfo.textContent = 'Noch kein Ordner ausgewählt.';
  }

  // counter
  els.curCount.textContent = s.count ? `Bild ${(s.shownCounter % s.count) || s.count} · ${s.count}` : '';

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
      'fade': 'Crossfade', 'blur-fade': 'Blur Fade',
      'wipe-left': 'Wipe ←', 'wipe-right': 'Wipe →', 'wipe-up': 'Wipe ↑', 'wipe-down': 'Wipe ↓',
      'push-left': 'Push ←', 'push-right': 'Push →',
      'zoom-in': 'Zoom In', 'zoom-out': 'Zoom Out', 'circle': 'Iris (Kreis)'
    };
    els.transSelect.appendChild(opt('random', '🎲 Zufällig (empfohlen)'));
    s.transitions.forEach(t => els.transSelect.appendChild(opt(t, labels[t] || t)));
  }

  // sync config controls to state (without re-triggering push loops)
  syncConfigControls(s.config);
}

let controlsSynced = false;
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
}

// --- boot ----------------------------------------------------------------
[els.durRange, els.transRange, els.kbRange].forEach(paintRange);
window.api.getState().then(applyState);
setStatus('Bereit. Wähle einen Bilderordner.');
