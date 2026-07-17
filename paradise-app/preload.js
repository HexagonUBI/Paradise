const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('paradiseNative', {
  minimize: () => ipcRenderer.send('window-minimize'),
  toggleMaximize: () => ipcRenderer.send('window-maximize-toggle'),
  close: () => ipcRenderer.send('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  onWindowStateChange: (callback) => {
    ipcRenderer.on('window-state', (_event, state) => callback(state));
  },
  saveAuth: (data) => ipcRenderer.invoke('auth-save', data),
  loadAuth: () => ipcRenderer.invoke('auth-load'),
  clearAuth: () => ipcRenderer.invoke('auth-clear'),
  platform: process.platform,
});
