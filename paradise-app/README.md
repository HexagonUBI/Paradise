# Paradise

A real desktop app (Electron, like Discord's own client) for the Paradise social
platform, talking to a live [Harmony](https://codeberg.org/MelodyChat/Harmony) /
Spacebar-protocol backend over REST + WebSocket. No mock data — this logs into a
real instance and sends/receives real messages.

## Running it

You'll need [Node.js](https://nodejs.org) 18+ installed.

```bash
cd paradise
npm install
npm start
```

That opens the actual app window (custom titlebar, real minimize/maximize/close,
its own taskbar/dock icon) — not a browser tab.

## Building an installer

```bash
npm run dist:linux   # -> dist/*.AppImage, dist/*.deb
npm run dist:win      # -> dist/*.exe (NSIS installer)
npm run dist:mac      # -> dist/*.dmg
```

Each must be run on (or cross-built for) its target OS; electron-builder handles
the packaging. The Windows build uses `assets/icon.ico` (included). The macOS
build wants a proper `.icns` — `assets/icon.png` is included as a source, but
you'll want to convert it with `iconutil` on a Mac (or any `png2icns` tool) and
point `build.mac.icon` at the result for a polished dock icon.

## How it connects

On launch the app auto-connects to `spacebar.chat` (the public instance of the
protocol family Harmony implements) so you land straight on Login/Register —
see `renderer/app.js` → `DEFAULT_INSTANCE`. Change that constant, or use the
"use a different instance" link on the login screen, to point at a self-hosted
Harmony/Spacebar server instead. Whatever instance you use must send CORS
headers allowing this app's origin, or the browser layer inside Electron will
block the requests — same rule as any other Discord-API-compatible client.

## Project layout

```
main.js              Electron main process: creates the window, owns real
                      minimize/maximize/close via IPC, loads renderer/index.html
preload.js            contextBridge — exposes window.paradiseNative to the page
renderer/
  index.html           app shell markup
  style.css             all styling
  harmony-client.js     REST + Gateway client for the Harmony/Spacebar protocol
  app.js                 UI logic, wires the client to the DOM
assets/                 real icon/avatar/art files (no base64 embedding)
```

## Roadmap

Tracked upstream on the project's Trello board. Known open items pulled from
there and worth tackling next: markdown rendering in messages, an attachment
upload progress bar (replacing the current "sent twice" duplicate-send bug),
user rich presence/activity, a server browser, voice/video call + screenshare,
and persisting settings/login between launches (currently everything resets
on quit since there's no local storage wired up yet).
