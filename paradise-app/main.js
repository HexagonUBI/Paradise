const { app, BrowserWindow, ipcMain, Menu, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
const authFile = () => path.join(app.getPath('userData'), 'session.bin');

function createWindow(){
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#FFFFFF',
    title: 'Paradise',
    icon: path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    frame: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.on('maximize', () => mainWindow.webContents.send('window-state', { maximized: true }));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window-state', { maximized: false }));
  mainWindow.on('closed', () => { mainWindow = null; });

  // Open real links (e.g. attachment URLs, "learn more" links) in the OS browser, not inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// Custom titlebar window controls (the renderer has no access to real window
// chrome, since frame:false removes it — these IPC handlers are what actually
// minimize/maximize/close the OS window when the on-screen buttons are clicked).
ipcMain.on('window-minimize', () => mainWindow && mainWindow.minimize());
ipcMain.on('window-maximize-toggle', () => {
  if(!mainWindow) return;
  if(mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('window-close', () => mainWindow && mainWindow.close());
ipcMain.handle('window-is-maximized', () => (mainWindow ? mainWindow.isMaximized() : false));

ipcMain.on('open-external', (_event, url) => {
  if(typeof url === 'string' && /^https:\/\//.test(url)) shell.openExternal(url);
});

// Session persistence — encrypted at rest with the OS keychain via safeStorage,
// so logging back in doesn't require re-entering credentials every launch.
ipcMain.handle('auth-save', (_event, data) => {
  try {
    const json = JSON.stringify(data);
    const payload = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(json)
      : Buffer.from(json, 'utf8'); // fallback: plaintext if OS keychain isn't available
    fs.writeFileSync(authFile(), payload);
    return true;
  } catch(err){ console.error('auth-save failed:', err); return false; }
});

ipcMain.handle('auth-load', () => {
  try {
    if(!fs.existsSync(authFile())) return null;
    const buf = fs.readFileSync(authFile());
    const json = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8');
    return JSON.parse(json);
  } catch(err){ console.error('auth-load failed:', err); return null; }
});

ipcMain.handle('auth-clear', () => {
  try { if(fs.existsSync(authFile())) fs.unlinkSync(authFile()); return true; }
  catch(err){ console.error('auth-clear failed:', err); return false; }
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null); // Discord-style: no native menu bar, the app draws its own chrome
  createWindow();

  app.on('activate', () => {
    if(BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if(process.platform !== 'darwin') app.quit();
});
