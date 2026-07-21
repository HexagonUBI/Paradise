# Paradise installer builder

This is **not** the Paradise app - it's the separate tool that packages
[`../paradise-app`](../paradise-app) into a real, installable build (NSIS on
Windows, dmg on macOS, AppImage/deb on Linux) and, optionally, publishes it to
this repo's GitHub Releases.

It's kept in its own folder with its own `package.json`/`node_modules` on
purpose: `electron-builder` and everything it pulls in are build-time tooling,
not something the shipped app should carry around. This is electron-builder's
own recommended ["two package.json" structure](https://www.electron.build/docs/tutorials/two-package-structure) -
`build.directories.app` in [`package.json`](./package.json) points at
`../paradise-app`, so electron-builder reads *that* folder's `main.js`,
`renderer/`, and `assets/` to build from, while every dependency needed to do
the building lives here instead.

## Usage

```bash
npm install
npm run dist:win      # -> dist/*.exe   (NSIS installer)
npm run dist:mac       # -> dist/*.dmg
npm run dist:linux      # -> dist/*.AppImage, dist/*.deb
npm run release          # builds for the current OS AND uploads it to a GitHub Release
                           # (needs GH_TOKEN, a token with repo scope, exported first)
```

Each installer target has to be built on (or cross-built for) its own OS -
electron-builder can't reliably produce a Windows `.exe` from Linux/macOS or
vice versa.

The app itself (`../paradise-app/main.js`) checks the GitHub release this
publishes against its own version on every launch and offers to download +
install it - see the "Releasing updates" section of
[`../paradise-app/README.md`](../paradise-app/README.md).
