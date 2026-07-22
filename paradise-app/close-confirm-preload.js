const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('closeConfirmNative', {
  // choice: 'tray' | 'quit' | 'cancel'
  respond: (choice, remember) => ipcRenderer.send('close-response', { choice, remember }),
});
