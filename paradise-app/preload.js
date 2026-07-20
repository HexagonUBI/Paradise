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
  onConfirmClose: (callback) => {
    ipcRenderer.on('confirm-close', () => callback());
  },
  respondClose: (choice, remember) => ipcRenderer.send('close-response', { choice, remember }),
  getCloseBehavior: () => ipcRenderer.invoke('close-behavior-get'),
  setCloseBehavior: (value) => ipcRenderer.invoke('close-behavior-set', value),
  platform: process.platform,
});
