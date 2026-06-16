'use strict';

const { app, BrowserWindow, ipcMain, dialog, screen, globalShortcut } = require('electron');
const path = require('path');
const { execFile } = require('child_process');
const { scanFolder } = require('./mediaScanner');
const { Playlist } = require('./playlist');

const isDev = process.argv.includes('--dev');

// App icon used for windows in dev (packaged builds embed it in the .exe).
const APP_ICON = path.join(__dirname, '..', '..', 'build', 'icon.ico');

// ---------------------------------------------------------------------------
// Central application state (single source of truth).
// ---------------------------------------------------------------------------
const TRANSITIONS = [
  'fade', 'blur-fade', 'zoom-blur',
  'wipe-left', 'wipe-right', 'wipe-up', 'wipe-down', 'wipe-diagonal',
  'push-left', 'push-right', 'push-up', 'push-down',
  'cover-left', 'cover-right',
  'zoom-in', 'zoom-out', 'circle'
];

const state = {
  folder: null,
  media: [],            // [{path,url,name,size}]
  playlist: new Playlist(),
  isPlaying: false,
  shownCounter: 0,      // how many images have been shown since folder load
  current: null,        // {url,name}
  config: {
    displayDuration: 7000,
    transitionDuration: 1500,
    kenBurnsIntensity: 1.0,
    backgroundMode: 'blur',     // 'blur' | 'solid' | 'stretch'
    transitionMode: 'random',   // 'random' | one of TRANSITIONS
    overlay: {                  // custom text overlay (e.g. the event name)
      enabled: false,
      text: '',
      fontFamily: 'Segoe UI',
      fontSize: 6,              // height of the text as a % of the screen height
      color: '#ffffff',
      position: 'bottom-right', // {top|middle|bottom}-{left|center|right}
      bold: true,
      shadow: true
    }
  }
};

let controlWin = null;
let outputWin = null;
let advanceTimer = null;

// ---------------------------------------------------------------------------
// Window management
// ---------------------------------------------------------------------------
function pickDisplays() {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const external = displays.find(d => d.id !== primary.id) || null;
  return { primary, external, all: displays };
}

function createControlWindow() {
  const { primary } = pickDisplays();
  controlWin = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    x: primary.bounds.x + 60,
    y: primary.bounds.y + 60,
    backgroundColor: '#0b0d12',
    title: 'OpenSlideShow — Control',
    icon: APP_ICON,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  controlWin.removeMenu();
  controlWin.loadFile(path.join(__dirname, '..', 'renderer', 'control', 'index.html'));
  if (isDev) controlWin.webContents.openDevTools({ mode: 'detach' });

  controlWin.on('closed', () => {
    controlWin = null;
    app.quit();
  });
}

function windowedOutputBounds() {
  const { primary } = pickDisplays();
  return {
    x: primary.bounds.x + 80,
    y: primary.bounds.y + 80,
    width: Math.min(1280, primary.bounds.width - 160),
    height: Math.min(720, primary.bounds.height - 160)
  };
}

function createOutputWindow() {
  const { primary, external } = pickDisplays();
  const hasExternal = Boolean(external);
  const target = external || primary;
  const wb = windowedOutputBounds();

  outputWin = new BrowserWindow({
    x: hasExternal ? target.bounds.x : wb.x,
    y: hasExternal ? target.bounds.y : wb.y,
    width: hasExternal ? target.bounds.width : wb.width,
    height: hasExternal ? target.bounds.height : wb.height,
    frame: false,                   // always borderless — no OS title bar, ever
    backgroundColor: '#000000',
    title: 'OpenSlideShow — Output',
    show: false,
    fullscreenable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false   // never throttle animations when unfocused
    }
  });
  outputWin.removeMenu();
  outputWin.loadFile(path.join(__dirname, '..', 'renderer', 'output', 'index.html'));

  outputWin.once('ready-to-show', () => {
    outputWin.show();
    // Auto-project to full screen only when a real second display is present.
    if (hasExternal) setOutputFullscreen(true);
  });

  outputWin.on('closed', () => { outputWin = null; });
}

function isOutputFullscreen() {
  return Boolean(outputWin && outputWin.isKiosk());
}

function setOutputFullscreen(on) {
  if (!outputWin) return;
  const { primary, external } = pickDisplays();
  const target = external || primary;

  if (on) {
    // Place the window on the target display first, then enter kiosk mode.
    // Kiosk reliably covers the Windows taskbar and leaves no chrome — the
    // standard approach for beamer / digital-signage output.
    outputWin.setKiosk(false);
    outputWin.setBounds(target.bounds);
    outputWin.setKiosk(true);
    outputWin.setAlwaysOnTop(true, 'screen-saver');
    outputWin.focus();
    // Safety net: the operator can always leave projection with Esc, even when
    // the output covers a single monitor and the control panel is hidden.
    globalShortcut.register('Escape', () => setOutputFullscreen(false));
  } else {
    globalShortcut.unregister('Escape');
    outputWin.setAlwaysOnTop(false);
    outputWin.setKiosk(false);
    if (!external) outputWin.setBounds(windowedOutputBounds());
  }
  broadcastState();
}

// ---------------------------------------------------------------------------
// Broadcasting helpers
// ---------------------------------------------------------------------------
function send(win, channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function broadcastState() {
  const snapshot = {
    folder: state.folder,
    count: state.media.length,
    isPlaying: state.isPlaying,
    shownCounter: state.shownCounter,
    current: state.current,
    config: state.config,
    transitions: TRANSITIONS,
    displays: describeDisplays(),
    outputFullscreen: isOutputFullscreen()
  };
  send(controlWin, 'state:update', snapshot);
  send(outputWin, 'state:update', snapshot);
}

function describeDisplays() {
  const { primary, external, all } = pickDisplays();
  return {
    hasExternal: Boolean(external),
    primaryId: primary.id,
    externalId: external ? external.id : null,
    list: all.map(d => ({
      id: d.id,
      label: `${d.size.width}×${d.size.height}${d.id === primary.id ? ' (Primär)' : ''}`,
      bounds: d.bounds
    }))
  };
}

// ---------------------------------------------------------------------------
// System font enumeration (for the text-overlay font picker)
// ---------------------------------------------------------------------------
// A small, always-available fallback so the picker is never empty even if the
// platform enumeration fails (no PowerShell / no fontconfig).
const FALLBACK_FONTS = [
  'Arial', 'Calibri', 'Cambria', 'Candara', 'Comic Sans MS', 'Consolas',
  'Constantia', 'Corbel', 'Courier New', 'Franklin Gothic', 'Gabriola',
  'Georgia', 'Impact', 'Lucida Console', 'Lucida Sans Unicode',
  'Palatino Linotype', 'Segoe UI', 'Tahoma', 'Times New Roman',
  'Trebuchet MS', 'Verdana'
];

let _fontsCache = null;

function cleanFontList(names) {
  const seen = new Set();
  const out = [];
  for (const raw of names) {
    const name = String(raw).trim();
    // Skip empties, hidden font families (leading '@' on Windows) and dupes.
    if (!name || name.startsWith('@') || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

function listSystemFonts() {
  if (_fontsCache) return Promise.resolve(_fontsCache);
  return new Promise((resolve) => {
    const done = (names) => {
      const list = names && names.length ? cleanFontList(names) : FALLBACK_FONTS.slice();
      _fontsCache = list;
      resolve(list);
    };

    if (process.platform === 'win32') {
      const ps =
        'Add-Type -AssemblyName System.Drawing;' +
        '(New-Object System.Drawing.Text.InstalledFontCollection).Families' +
        ' | ForEach-Object { $_.Name }';
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', ps],
        { timeout: 8000, windowsHide: true, maxBuffer: 1024 * 1024 },
        (err, stdout) => done(err || !stdout ? null : stdout.split(/\r?\n/))
      );
    } else {
      // macOS / Linux: fontconfig is the most portable source of family names.
      execFile(
        'fc-list',
        ['--format', '%{family[0]}\n'],
        { timeout: 8000, maxBuffer: 1024 * 1024 },
        (err, stdout) => done(err || !stdout ? null : stdout.split(/\r?\n/))
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Ken Burns + transition selection (done here so both windows stay in sync)
// ---------------------------------------------------------------------------
function rand(min, max) { return min + Math.random() * (max - min); }

function makeKenBurns() {
  const intensity = state.config.kenBurnsIntensity;
  if (intensity <= 0) {
    return { fromScale: 1.0, toScale: 1.0, fromX: 0, fromY: 0, toX: 0, toY: 0 };
  }
  // Base zoom + pan, scaled by intensity. Always covers the frame (scale >= ~1.08).
  const zoom = 0.10 * intensity;
  const pan = 4.0 * intensity; // percent of frame
  const zoomIn = Math.random() < 0.5;
  const fromScale = zoomIn ? 1.06 : 1.06 + zoom;
  const toScale = zoomIn ? 1.06 + zoom : 1.06;
  const dir = () => (Math.random() < 0.5 ? -1 : 1);
  return {
    fromScale,
    toScale,
    fromX: rand(0, pan) * dir(),
    fromY: rand(0, pan) * dir(),
    toX: rand(0, pan) * dir(),
    toY: rand(0, pan) * dir()
  };
}

function pickTransition() {
  const mode = state.config.transitionMode;
  if (mode !== 'random' && TRANSITIONS.includes(mode)) return mode;
  return TRANSITIONS[Math.floor(Math.random() * TRANSITIONS.length)];
}

function buildShowPayload(mediaIndex, withTransition) {
  const item = state.media[mediaIndex];
  if (!item) return null;

  // Prefetch hints: the next few items in shuffle order.
  const upcoming = [];
  const order = state.playlist.order;
  const startPos = state.playlist.pos;
  for (let k = 1; k <= 3; k++) {
    const p = order[(startPos + k) % order.length];
    const m = state.media[p];
    if (m) upcoming.push({ url: m.url, name: m.name });
  }

  return {
    current: { url: item.url, name: item.name },
    upcoming,
    transition: withTransition ? pickTransition() : 'none',
    transitionDuration: state.config.transitionDuration,
    displayDuration: state.config.displayDuration,
    kenBurns: makeKenBurns(),
    backgroundMode: state.config.backgroundMode,
    kenBurnsIntensity: state.config.kenBurnsIntensity,
    shownCounter: state.shownCounter
  };
}

// ---------------------------------------------------------------------------
// Playback control
// ---------------------------------------------------------------------------
function clearTimer() {
  if (advanceTimer) { clearTimeout(advanceTimer); advanceTimer = null; }
}

function scheduleNext() {
  clearTimer();
  if (!state.isPlaying || state.media.length === 0) return;
  advanceTimer = setTimeout(() => advance(1, true), state.config.displayDuration);
}

function showCurrent(withTransition) {
  const idx = state.playlist.current;
  if (idx < 0) return;
  state.current = { url: state.media[idx].url, name: state.media[idx].name };
  state.shownCounter += 1;
  const payload = buildShowPayload(idx, withTransition);
  send(outputWin, 'show', payload);
  send(controlWin, 'show', payload);
  broadcastState();
}

function advance(direction, withTransition) {
  if (state.media.length === 0) return;
  if (direction >= 0) state.playlist.next();
  else state.playlist.prev();
  showCurrent(withTransition);
  scheduleNext();
}

function play() {
  if (state.media.length === 0) return;
  state.isPlaying = true;
  scheduleNext();
  broadcastState();
}

function pause() {
  state.isPlaying = false;
  clearTimer();
  broadcastState();
}

// ---------------------------------------------------------------------------
// Loading media
// ---------------------------------------------------------------------------
async function loadFolder(folderPath) {
  const media = await scanFolder(folderPath);
  state.folder = folderPath;
  state.media = media;
  state.shownCounter = 0;
  state.playlist.load(media.length);
  clearTimer();

  if (media.length > 0) {
    showCurrent(false);      // first image, no transition
    if (state.isPlaying) scheduleNext();
  } else {
    state.current = null;
    send(outputWin, 'show', null);
    send(controlWin, 'show', null);
  }
  broadcastState();
  return { folder: folderPath, count: media.length };
}

// ---------------------------------------------------------------------------
// IPC wiring
// ---------------------------------------------------------------------------
function registerIpc() {
  ipcMain.handle('app:getState', () => ({
    folder: state.folder,
    count: state.media.length,
    isPlaying: state.isPlaying,
    shownCounter: state.shownCounter,
    current: state.current,
    config: state.config,
    transitions: TRANSITIONS,
    displays: describeDisplays(),
    outputFullscreen: isOutputFullscreen()
  }));

  ipcMain.handle('media:chooseFolder', async () => {
    const res = await dialog.showOpenDialog(controlWin, {
      title: 'Bilderordner wählen',
      properties: ['openDirectory']
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    return loadFolder(res.filePaths[0]);
  });

  ipcMain.handle('media:reloadFolder', async () => {
    if (!state.folder) return null;
    return loadFolder(state.folder);
  });

  ipcMain.on('control:play', () => play());
  ipcMain.on('control:pause', () => pause());
  ipcMain.on('control:togglePlay', () => (state.isPlaying ? pause() : play()));
  ipcMain.on('control:next', () => advance(1, true));
  ipcMain.on('control:prev', () => advance(-1, true));

  ipcMain.on('config:set', (_e, partial) => {
    Object.assign(state.config, partial || {});
    // Live re-time if the display duration changed while playing.
    if (state.isPlaying) scheduleNext();
    broadcastState();
  });

  ipcMain.on('output:toggleFullscreen', () => {
    if (!outputWin) return;
    setOutputFullscreen(!isOutputFullscreen());
  });

  ipcMain.handle('output:identify', () => {
    send(outputWin, 'identify', true);
    return true;
  });

  ipcMain.handle('fonts:list', () => listSystemFonts());
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
function parseCliFolder() {
  const arg = process.argv.find(a => a.startsWith('--folder='));
  return arg ? arg.slice('--folder='.length) : null;
}

app.whenReady().then(() => {
  registerIpc();
  createControlWindow();
  createOutputWindow();

  // Optional auto-start: --folder="C:\path" (kiosk / unattended use).
  const cliFolder = parseCliFolder();
  if (cliFolder) {
    outputWin.webContents.once('did-finish-load', () => {
      loadFolder(cliFolder).then(() => play()).catch(() => {});
    });
  }

  screen.on('display-added', broadcastState);
  screen.on('display-removed', broadcastState);
  screen.on('display-metrics-changed', broadcastState);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createControlWindow();
      createOutputWindow();
    }
  });
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
