# Paradise

A real desktop app (Electron, like Discord's own client) for the Paradise social
platform, talking to a live [Harmony](https://codeberg.org/MelodyChat/Harmony) /
Spacebar-protocol backend over REST + WebSocket. No mock data - this logs into a
real instance and sends/receives real messages.

## Running it

You'll need [Node.js](https://nodejs.org) 18+ installed.

```bash
cd paradise
npm install
npm start
```

That opens the actual app window (custom titlebar, real minimize/maximize/close,
its own taskbar/dock icon) - not a browser tab.

## Building an installer

Packaging is deliberately kept **out** of this folder. `paradise-app/` is just
the app - what actually ships inside the installer and what runs when someone
double-clicks the icon. The installer is its own separate tool, in
`../installer`, with its own `package.json` and `node_modules` (electron-builder
lives there, not here):

```bash
cd ../installer
npm install
npm run dist:linux   # -> installer/dist/*.AppImage, *.deb
npm run dist:win      # -> installer/dist/*.exe (NSIS installer)
npm run dist:mac      # -> installer/dist/*.dmg
```

`installer/package.json` points `build.directories.app` at `../paradise-app`
(electron-builder's official ["two package.json" setup](https://www.electron.build/docs/tutorials/two-package-structure)) -
it reads this folder's `main.js`/`renderer/` etc. to build from, but none of
its own devDependencies (electron-builder itself, all its transitive packages)
ever touch this app's `node_modules`. Each target must be run on (or
cross-built for) its OS. The Windows build uses `assets/icon.ico` (included
here, referenced by path from `installer/`). The macOS build wants a proper
`.icns` - `assets/icon.png` is included as a source, but you'll want to
convert it with `iconutil` on a Mac (or any `png2icns` tool) and point
`installer/package.json`'s `build.mac.icon` at the result for a polished dock
icon.

The Windows installer (`nsis` config in `installer/package.json`) is one-click,
per-user (no admin prompt), and launches Paradise automatically when it
finishes - the same install experience as Discord, Slack, etc. Desktop and
Start Menu shortcuts are created automatically.

## Releasing updates

Paradise checks for updates itself, with no bundled updater library - see
`main.js` → `checkForUpdate()`. On launch (packaged builds only; `npm start`
skips this) it asks `api.github.com` for this repo's latest release and
compares its tag to `app.getVersion()` with a plain major.minor.patch check.
Nothing downloads on its own: if a newer release exists, the download button
next to the window controls and the matching row in Settings → Help & Feedback
(see `Assets/reference_settings.png`) light up, and only clicking one starts
the download. On Windows, the downloaded installer is launched and the app
quits so it can install over itself and relaunch (`runAfterFinish` in the nsis
config). On macOS/Linux the downloaded file is revealed in Finder/the file
manager instead, since dmg/AppImage/deb installs aren't silent.

To ship a new version:

1. Bump `"version"` in **this folder's** `package.json` (that's the one
   electron-builder reads for the version number, even from the separate
   `installer/` project).
2. `cd ../installer && export GH_TOKEN=<a token with repo scope>` (needed to
   upload release assets).
3. `npm run release` - builds for the current OS and publishes the installer
   to a GitHub Release tagged with that version. Repeat per-OS (Windows build
   on Windows/CI, mac on macOS, etc.) since electron-builder can't reliably
   cross-compile native installers.

## How it connects

On launch the app auto-connects to `spacebar.chat` (the public instance of the
protocol family Harmony implements) so you land straight on Login/Register -
see `renderer/app.js` → `DEFAULT_INSTANCE`. Change that constant, or use the
"use a different instance" link on the login screen, to point at a self-hosted
Harmony/Spacebar server instead. Whatever instance you use must send CORS
headers allowing this app's origin, or the browser layer inside Electron will
block the requests - same rule as any other Discord-API-compatible client.

## Project layout

```
main.js              Electron main process: creates the window, owns real
                      minimize/maximize/close via IPC, loads renderer/index.html
preload.js            contextBridge - exposes window.paradiseNative to the page
renderer/
  index.html           app shell markup
  style.css             all styling
  harmony-client.js     REST + Gateway client for the Harmony/Spacebar protocol
  app.js                 UI logic, wires the client to the DOM
assets/                 real icon/avatar/art files (no base64 embedding)
```

A sibling `../installer` folder (outside this one) holds the separate
electron-builder project that packages this app into a real installer - see
"Building an installer" above.

## Roadmap

Tracked upstream on the project's Trello board. Known open items pulled from
there and worth tackling next: markdown rendering in messages, an attachment
upload progress bar (replacing the current "sent twice" duplicate-send bug),
user rich presence/activity, a server browser, voice/video call + screenshare,
and persisting settings/login between launches (currently everything resets
on quit since there's no local storage wired up yet).
