const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('paradiseNative', {
  minimize: () => ipcRenderer.send('window-minimize'),
  toggleMaximize: () => ipcRenderer.send('window-maximize-toggle'),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  setTrayStatus: (status) => ipcRenderer.send('tray-status', status),
  close: () => ipcRenderer.send('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  onWindowStateChange: (callback) => {
    ipcRenderer.on('window-state', (_event, state) => callback(state));
  },
  saveAuth: (data) => ipcRenderer.invoke('auth-save', data),
  loadAuth: () => ipcRenderer.invoke('auth-load'),
  clearAuth: () => ipcRenderer.invoke('auth-clear'),
  onCloseBehaviorChanged: (callback) => {
    ipcRenderer.on('close-behavior-changed', (_event, value) => callback(value));
  },
  getCloseBehavior: () => ipcRenderer.invoke('close-behavior-get'),
  setCloseBehavior: (value) => ipcRenderer.invoke('close-behavior-set', value),
  getAppVersion: () => ipcRenderer.invoke('app-get-version'),
  getUpdatedFrom: () => ipcRenderer.invoke('app-get-updated-from'),
  getPendingUpdate: () => ipcRenderer.invoke('update-get-pending'),
  onUpdateAvailable: (callback) => { ipcRenderer.on('update-available', (_event, info) => callback(info)); },
  onUpdateDownloadProgress: (callback) => { ipcRenderer.on('update-download-progress', (_event, progress) => callback(progress)); },
  onUpdateDownloaded: (callback) => { ipcRenderer.on('update-downloaded', () => callback()); },
  onUpdateManual: (callback) => { ipcRenderer.on('update-manual', (_event, info) => callback(info)); },
  onUpdateError: (callback) => { ipcRenderer.on('update-error', (_event, info) => callback(info)); },
  startUpdateDownload: () => ipcRenderer.send('update-start-download'),
  platform: process.platform,
});
