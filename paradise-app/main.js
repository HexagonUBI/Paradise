const { app, BrowserWindow, ipcMain, Menu, shell, safeStorage, Tray, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { spawn } = require('child_process');

let mainWindow = null;
let closeConfirmWindow = null;
let tray = null;
let isQuitting = false;
const authFile = () => path.join(app.getPath('userData'), 'session.bin');
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

// closeBehavior: 'ask' (default) | 'tray' | 'quit'
function loadSettings(){
  try {
    if(!fs.existsSync(settingsFile())) return {};
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch(err){ return {}; }
}
function saveSettings(patch){
  try {
    const merged = { ...loadSettings(), ...patch };
    fs.writeFileSync(settingsFile(), JSON.stringify(merged));
    return merged;
  } catch(err){ console.error('saveSettings failed:', err); return loadSettings(); }
}
function getCloseBehavior(){ return loadSettings().closeBehavior || 'ask'; }

// A real, separate OS window (modal to mainWindow, so it blocks interaction
// with the main app without touching it) instead of an in-page overlay -
// styled to look like a native app-quit confirmation (e.g. Skype's).
function showCloseConfirmWindow(){
  if(closeConfirmWindow){ closeConfirmWindow.focus(); return; }
  closeConfirmWindow = new BrowserWindow({
    width: 440,
    height: 238,
    parent: mainWindow,
    modal: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: 'Quit Paradise?',
    icon: path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'close-confirm-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  closeConfirmWindow.setMenuBarVisibility(false);
  closeConfirmWindow.loadFile(path.join(__dirname, 'renderer', 'close-confirm.html'));
  closeConfirmWindow.once('ready-to-show', () => closeConfirmWindow.show());
  // Closing it any other way (Alt+F4, the X button) is the same as Cancel - do nothing.
  closeConfirmWindow.on('closed', () => { closeConfirmWindow = null; });
}

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

  // Closing the window either quits the app or minimizes it to the tray,
  // depending on the user's saved preference. If they haven't chosen yet,
  // the renderer is asked to show a prompt so the user can decide (and
  // optionally remember their choice for next time).
  mainWindow.on('close', (event) => {
    if(isQuitting || process.platform === 'darwin') return;
    const behavior = getCloseBehavior();
    if(behavior === 'tray'){ event.preventDefault(); mainWindow.hide(); return; }
    if(behavior === 'quit'){ isQuitting = true; return; } // let the close proceed, app quits normally
    // behavior === 'ask': hold the close and show the standalone confirm window
    event.preventDefault();
    showCloseConfirmWindow();
  });

  // Open real links (e.g. attachment URLs, "learn more" links) in the OS browser, not inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

const TRAY_ICONS = {
  connecting: path.join(__dirname, 'assets', 'tray', 'connecting.ico'),
  connected: path.join(__dirname, 'assets', 'tray', 'connected.ico'),
  unstable: path.join(__dirname, 'assets', 'tray', 'unstable.ico'),
  disconnected: path.join(__dirname, 'assets', 'tray', 'disconnected.ico'),
};
const TRAY_TOOLTIPS = {
  connecting: 'Paradise \u2014 Connecting\u2026',
  connected: 'Paradise \u2014 Connected',
  unstable: 'Paradise \u2014 Reconnecting\u2026',
  disconnected: 'Paradise \u2014 Disconnected',
};

function createTray(){
  const iconPath = path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon_256.png');
  tray = new Tray(nativeImage.createFromPath(iconPath));
  tray.setToolTip('Paradise');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Paradise', click: () => { if(mainWindow){ mainWindow.show(); mainWindow.focus(); } } },
    { type: 'separator' },
    { label: 'Quit Paradise', click: () => { isQuitting = true; app.quit(); } },
  ]));
  tray.on('click', () => {
    if(!mainWindow) return;
    if(mainWindow.isVisible()){ mainWindow.focus(); }
    else { mainWindow.show(); mainWindow.focus(); }
  });
}

function setTrayStatus(status){
  if(!tray || !TRAY_ICONS[status]) return;
  tray.setImage(nativeImage.createFromPath(TRAY_ICONS[status]));
  tray.setToolTip(TRAY_TOOLTIPS[status]);
}
ipcMain.on('tray-status', (_event, status) => setTrayStatus(status));

/* ---------------- auto-update (plain GitHub Releases, zero runtime dependencies) ----------------
   The `installer/` folder (its own package.json, its own electron-builder devDependency,
   its own node_modules) is the ONLY thing that produces an installer wizard, and only ever
   runs once, the first time someone sets Paradise up. After that, this app updates itself:
   it downloads a plain zip of the new release's files (or, on Linux, the new AppImage
   directly), swaps them into its own install directory via a tiny detached helper script
   (needed because Windows won't let a running .exe overwrite itself), and relaunches. No
   installer window ever appears again, and there's no bundled updater library to go missing. */
const UPDATE_REPO = 'HexagonUBI/Paradise';
let pendingUpdate = null; // { version, asset } once a newer release is found

// Simple major.minor.patch comparison; ignores 'v' prefixes and pre-release tags.
function compareVersions(a, b){
  const parse = (v) => String(v || '').replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  const pa = parse(a), pb = parse(b);
  for(let i = 0; i < 3; i++){
    if((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
  }
  return 0;
}

// Picks the plain-files payload for this OS - NOT the installer. installer/package.json
// tags these unambiguously: "Paradise-<version>-win-x64.zip", "...-mac-x64.zip", and the
// Linux AppImage doubles as its own payload (it's already just one self-contained file).
function pickAssetForPlatform(assets){
  const list = assets || [];
  const find = (pred) => list.find(pred);
  const named = (needle, ext) => find(a => a.name.toLowerCase().includes(needle) && a.name.toLowerCase().endsWith(ext));
  if(process.platform === 'win32') return named('-win-', '.zip');
  if(process.platform === 'darwin') return named('-mac-', '.zip');
  return find(a => a.name.toLowerCase().endsWith('.appimage'));
}

// Plain https GET that parses a JSON response - used instead of fetch(), which
// is not reliably available in Electron's main process across versions (unlike
// a browser or renderer window). Keeping this on the same `https` module as
// downloadAsset() removes that whole class of doubt.
function httpsGetJson(url){
  return new Promise((resolve, reject) => {
    const request = (u) => {
      https.get(u, { headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'Paradise-App' } }, (res) => {
        if([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location){
          res.resume();
          return request(res.headers.location);
        }
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if(res.statusCode !== 200) return reject(new Error(`GitHub API responded ${res.statusCode}: ${data.slice(0, 200)}`));
          try { resolve(JSON.parse(data)); } catch(err){ reject(err); }
        });
      }).on('error', reject);
    };
    request(url);
  });
}

async function checkForUpdate(){
  // Normally skipped outside a packaged build (there's nothing meaningful to
  // compare a dev "0.1.0 from source" against). Set PARADISE_DEV_UPDATE_CHECK=1
  // to force it anyway - handy for testing the update UI via `npm start`.
  if(!app.isPackaged && !process.env.PARADISE_DEV_UPDATE_CHECK) return null;
  try {
    const release = await httpsGetJson(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`);
    const latestVersion = String(release.tag_name || '').replace(/^v/i, '');
    console.log(`[updater] current=${app.getVersion()} latest=${latestVersion || '(none)'}`);
    if(!latestVersion || compareVersions(latestVersion, app.getVersion()) <= 0) return null;
    const asset = pickAssetForPlatform(release.assets);
    if(!asset){
      console.warn(`[updater] release ${latestVersion} has no asset matching this platform (${process.platform}); assets:`, (release.assets || []).map(a => a.name));
      return null;
    }
    return { version: latestVersion, asset };
  } catch(err){
    console.error('[updater] checkForUpdate failed:', err);
    return null;
  }
}

async function runUpdateCheck(){
  pendingUpdate = await checkForUpdate();
  if(pendingUpdate && mainWindow){
    mainWindow.webContents.send('update-available', { version: pendingUpdate.version });
  }
}

// Downloads a release asset to disk, following redirects (GitHub asset URLs
// 302 to S3) and reporting progress from the Content-Length header.
function downloadAsset(asset, onProgress){
  return new Promise((resolve, reject) => {
    const destPath = path.join(app.getPath('temp'), asset.name);
    const request = (url) => {
      https.get(url, { headers: { 'User-Agent': 'Paradise-App' } }, (res) => {
        if([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location){
          res.resume();
          return request(res.headers.location);
        }
        if(res.statusCode !== 200){
          res.resume();
          return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let received = 0;
        const file = fs.createWriteStream(destPath);
        res.on('data', (chunk) => {
          received += chunk.length;
          if(onProgress && total) onProgress(Math.round((received / total) * 100));
        });
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve(destPath)));
        file.on('error', reject);
      }).on('error', reject);
    };
    request(asset.browser_download_url);
  });
}

// Windows: writes a tiny PowerShell helper that waits for this process to fully
// exit (so its own .exe/.dll files aren't locked anymore), unzips the downloaded
// payload over the current install directory, relaunches Paradise, then cleans
// up after itself. This is what actually applies the update - not a wizard.
function applyUpdateWindows(zipPath){
  const installDir = path.dirname(process.execPath);
  const stagingDir = path.join(app.getPath('temp'), `paradise-update-${Date.now()}`);
  const scriptPath = path.join(app.getPath('temp'), `paradise-update-${Date.now()}.ps1`);
  const logPath = path.join(app.getPath('temp'), 'paradise-update-log.txt');
  // Retries the copy step for ~30s: right after quitting, some of Electron's
  // helper processes (GPU process, crashpad handler) can hold onto a handle
  // for a moment longer than the main process, so a single attempt can fail.
  // Logs every step to logPath instead of swallowing errors, so a failure is
  // actually diagnosable instead of just silently doing nothing.
  const ps1 = `
function Log($msg) { Add-Content -Path "${logPath}" -Value "$(Get-Date -Format o) $msg" }
Log "=== update started, waiting for PID ${process.pid} to exit ==="
try { Wait-Process -Id ${process.pid} -Timeout 30 -ErrorAction SilentlyContinue } catch {}
Start-Sleep -Seconds 2

$copied = $false
for($attempt = 1; $attempt -le 12; $attempt++){
  try {
    if(-not (Test-Path "${stagingDir}")){
      New-Item -ItemType Directory -Force -Path "${stagingDir}" | Out-Null
      Expand-Archive -Path "${zipPath}" -DestinationPath "${stagingDir}" -Force
      Log "Extracted update zip to staging"
    }
    Copy-Item -Path "${stagingDir}\\*" -Destination "${installDir}" -Recurse -Force -ErrorAction Stop
    $copied = $true
    Log "Copied new files into install dir on attempt $attempt"
    break
  } catch {
    Log "Attempt $attempt failed: $($_.Exception.Message)"
    Start-Sleep -Seconds 2
  }
}

if($copied){
  Log "Launching updated Paradise.exe"
  Start-Process -FilePath "${path.join(installDir, 'Paradise.exe')}"
} else {
  Log "FAILED: could not apply update after 12 attempts (see errors above)"
}

Remove-Item -Path "${stagingDir}" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path "${zipPath}" -Force -ErrorAction SilentlyContinue
Log "=== update script finished, copied=$copied ==="
`.trim();
  fs.writeFileSync(scriptPath, ps1, 'utf8');
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', scriptPath], { detached: true, stdio: 'ignore' });
  child.unref();
}

// Linux (AppImage): the AppImage IS the app, so "updating" is just atomically
// swapping it for the new one on disk (a same-filesystem rename keeps working
// even while the old file is still open/running) and relaunching it.
function applyUpdateLinuxAppImage(downloadedPath){
  const currentPath = process.env.APPIMAGE || process.execPath;
  fs.chmodSync(downloadedPath, 0o755);
  fs.renameSync(downloadedPath, currentPath);
  const child = spawn(currentPath, [], { detached: true, stdio: 'ignore' });
  child.unref();
}

// macOS: same idea as Windows - a small background script waits for us to quit,
// replaces the .app bundle's contents, relaunches, then removes itself.
function applyUpdateMac(zipPath){
  const appBundle = path.resolve(process.execPath, '..', '..', '..'); // .../Paradise.app
  const stagingDir = path.join(app.getPath('temp'), `paradise-update-${Date.now()}`);
  const scriptPath = path.join(app.getPath('temp'), `paradise-update-${Date.now()}.sh`);
  const logPath = path.join(app.getPath('temp'), 'paradise-update-log.txt');
  const sh = `#!/bin/sh
log() { echo "$(date -u +%FT%TZ) $1" >> "${logPath}"; }
log "=== update started, waiting for PID ${process.pid} to exit ==="
while kill -0 ${process.pid} 2>/dev/null; do sleep 0.5; done
sleep 2

copied=0
for attempt in 1 2 3 4 5 6 7 8 9 10 11 12; do
  if [ ! -d "${stagingDir}" ]; then
    mkdir -p "${stagingDir}"
    ditto -x -k "${zipPath}" "${stagingDir}" 2>>"${logPath}" && log "Extracted update zip to staging"
  fi
  if rm -rf "${appBundle}" 2>>"${logPath}" && mv "${stagingDir}"/*.app "${appBundle}" 2>>"${logPath}"; then
    copied=1
    log "Replaced app bundle on attempt $attempt"
    break
  else
    log "Attempt $attempt failed"
    sleep 2
  fi
done

if [ "$copied" = "1" ]; then
  xattr -dr com.apple.quarantine "${appBundle}" 2>/dev/null
  log "Launching updated app"
  open "${appBundle}"
else
  log "FAILED: could not apply update after 12 attempts (see errors above)"
fi
rm -rf "${stagingDir}" "${zipPath}"
log "=== update script finished, copied=$copied ==="
`;
  fs.writeFileSync(scriptPath, sh, { mode: 0o755 });
  const child = spawn('/bin/sh', [scriptPath], { detached: true, stdio: 'ignore' });
  child.unref();
}

ipcMain.handle('update-get-pending', () => (pendingUpdate ? { version: pendingUpdate.version } : null));

ipcMain.on('update-start-download', async () => {
  if(!pendingUpdate || !mainWindow) return;
  const send = (channel, payload) => { if(mainWindow) mainWindow.webContents.send(channel, payload); };
  try {
    const filePath = await downloadAsset(pendingUpdate.asset, (pct) => send('update-download-progress', { percent: pct }));
    if(process.platform === 'win32'){
      send('update-downloaded');
      applyUpdateWindows(filePath);
    } else if(process.platform === 'darwin'){
      send('update-downloaded');
      applyUpdateMac(filePath);
    } else if(process.env.APPIMAGE){
      send('update-downloaded');
      applyUpdateLinuxAppImage(filePath);
    } else {
      // deb build (or an unpackaged Linux run): not self-applicable, hand it off.
      shell.showItemInFolder(filePath);
      send('update-manual', { path: filePath });
      return;
    }
    isQuitting = true;
    setTimeout(() => app.quit(), 400);
  } catch(err){
    console.error('update download/apply failed:', err);
    send('update-error', { message: err.message });
  }
});

ipcMain.handle('app-get-version', () => app.getVersion());

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

// Response from the close-confirmation dialog shown in the renderer.
ipcMain.on('close-response', (_event, { choice, remember }) => {
  if(closeConfirmWindow){ closeConfirmWindow.close(); }
  if(choice === 'cancel') return; // dismissed - main window stays exactly as it was
  if(remember && (choice === 'quit' || choice === 'tray')){
    saveSettings({ closeBehavior: choice });
    if(mainWindow) mainWindow.webContents.send('close-behavior-changed', choice);
  }
  if(choice === 'quit'){ isQuitting = true; app.quit(); }
  else if(choice === 'tray' && mainWindow){ mainWindow.hide(); }
});

// Lets the Settings screen read/write the close-behavior preference directly.
ipcMain.handle('close-behavior-get', () => getCloseBehavior());
ipcMain.handle('close-behavior-set', (_event, value) => {
  if(!['ask', 'tray', 'quit'].includes(value)) return getCloseBehavior();
  return saveSettings({ closeBehavior: value }).closeBehavior;
});

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
  createTray();
  runUpdateCheck();

  app.on('activate', () => {
    if(BrowserWindow.getAllWindows().length === 0) createWindow();
    else if(mainWindow){ mainWindow.show(); mainWindow.focus(); }
  });
});

app.on('before-quit', () => { isQuitting = true; });

app.on('window-all-closed', () => {
  if(process.platform !== 'darwin') app.quit();
});
