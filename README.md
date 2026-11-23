# Rojey POS (desktop)

Offline-first Windows till for the Rojey (iRestora PLUS) website. It has its own local database and works for days without internet. It syncs orders, running orders, customers and permissions with the website in real time, and updates itself from this repository's Releases.

- **How to use the app:** [HOW-TO-USE.md](HOW-TO-USE.md)
- **How to publish an update:** [RELEASING.md](RELEASING.md)

## Layout

| Path | What it is |
|---|---|
| `src/main.js` | App: sign-in, sync worker, permissions, printing, IPC |
| `src/db.js` | Local SQLite database (`node:sqlite`) |
| `src/pull.js` | Reads menu, tables, users and settings from the website's POS page |
| `src/server.js` | Website calls (the same ones the web POS makes) |
| `src/print.js` | KOT and receipt printing, printer error reports |
| `src/updater.js` | Automatic updates from GitHub Releases |
| `src/ui/` | Screens: sign-in, POS, settings, sales |
| `test/` | End-to-end test against a fake website (`npm test`, needs a display or `xvfb-run`) |
| `installer/` | NSIS installer (per-user; `/S /RUN` is used by the updater) |
| `legacy/rojey-pos-v1/` | Version 1 (an Electron shell around the web POS), kept for reference |

## Build

```
npm install
npm test                       # end-to-end test
npx electron-builder --win portable --x64
sh installer/build-installer.sh   # dist/RojeyPOS-Setup-<version>.exe
```

Designed by Derrick Mugooba · Mauzo Books · 0755933629
