'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Safe, minimal bridge between the renderer windows and the main process.
 * No Node APIs are exposed to the renderer; only these explicit channels.
 */
contextBridge.exposeInMainWorld('api', {
  // --- queries ---
  getState: () => ipcRenderer.invoke('app:getState'),
  chooseFolder: () => ipcRenderer.invoke('media:chooseFolder'),
  reloadFolder: () => ipcRenderer.invoke('media:reloadFolder'),
  identifyOutput: () => ipcRenderer.invoke('output:identify'),
  listFonts: () => ipcRenderer.invoke('fonts:list'),

  // --- commands (fire and forget) ---
  play: () => ipcRenderer.send('control:play'),
  pause: () => ipcRenderer.send('control:pause'),
  togglePlay: () => ipcRenderer.send('control:togglePlay'),
  next: () => ipcRenderer.send('control:next'),
  prev: () => ipcRenderer.send('control:prev'),
  setConfig: (partial) => ipcRenderer.send('config:set', partial),
  toggleOutputFullscreen: () => ipcRenderer.send('output:toggleFullscreen'),

  // --- events ---
  // Each channel carries exactly one logical handler. Clearing first means a
  // window reload (or DevTools refresh) never stacks duplicate listeners.
  onShow: (cb) => {
    ipcRenderer.removeAllListeners('show');
    ipcRenderer.on('show', (_e, payload) => cb(payload));
  },
  onState: (cb) => {
    ipcRenderer.removeAllListeners('state:update');
    ipcRenderer.on('state:update', (_e, payload) => cb(payload));
  },
  onIdentify: (cb) => {
    ipcRenderer.removeAllListeners('identify');
    ipcRenderer.on('identify', (_e, payload) => cb(payload));
  }
});
