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

  // --- commands (fire and forget) ---
  play: () => ipcRenderer.send('control:play'),
  pause: () => ipcRenderer.send('control:pause'),
  togglePlay: () => ipcRenderer.send('control:togglePlay'),
  next: () => ipcRenderer.send('control:next'),
  prev: () => ipcRenderer.send('control:prev'),
  setConfig: (partial) => ipcRenderer.send('config:set', partial),
  toggleOutputFullscreen: () => ipcRenderer.send('output:toggleFullscreen'),

  // --- events ---
  onShow: (cb) => ipcRenderer.on('show', (_e, payload) => cb(payload)),
  onState: (cb) => ipcRenderer.on('state:update', (_e, payload) => cb(payload)),
  onIdentify: (cb) => ipcRenderer.on('identify', (_e, payload) => cb(payload))
});
