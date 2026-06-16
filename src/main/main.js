'use strict';

const { app, BrowserWindow, ipcMain, dialog, screen } = require('electron');
const path = require('path');
const { scanFolder } = require('./mediaScanner');
const { Playlist } = require('./playlist');

const isDev = process.argv.includes('--dev');

// ---------------------------------------------------------------------------
// Central application state (single source of truth).
// ---------------------------------------------------------------------------
const TRANSITIONS = [
  'fade', 'blur-fade', 'wipe-left', 'wipe-right', 'wipe-up', 'wipe-down',
  'push-left', 'push-right', 'zoom-in', 'zoom-out', 'circle'
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
    transitionMode: 'random'    // 'random' | one of TRANSITIONS
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

function createOutputWindow() {
  const { primary, external } = pickDisplays();
  const target = external || primary;
  const hasExternal = Boolean(external);

  outputWin = new BrowserWindow({
    x: target.bounds.x,
    y: target.bounds.y,
    width: hasExternal ? target.bounds.width : Math.min(1280, primary.bounds.width - 120),
    height: hasExternal ? target.bounds.height : Math.min(720, primary.bounds.height - 120),
    frame: !hasExternal,            // borderless only on the real output display
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
    if (hasExternal) setOutputFullscreen(true);
  });

  outputWin.on('closed', () => { outputWin = null; });
}

function setOutputFullscreen(on) {
  if (!outputWin) return;
  const { primary, external } = pickDisplays();
  const target = external || primary;
  if (on) {
    outputWin.setMenuBarVisibility(false);
    // Borderless fullscreen covering the whole target display.
    outputWin.setBounds(target.workArea ? target.bounds : target.bounds);
    outputWin.setFullScreen(true);
  } else {
    outputWin.setFullScreen(false);
  }
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
    displays: describeDisplays()
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
    displays: describeDisplays()
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
    setOutputFullscreen(!outputWin.isFullScreen());
  });

  ipcMain.handle('output:identify', () => {
    send(outputWin, 'identify', true);
    return true;
  });
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

app.on('window-all-closed', () => app.quit());
