#!/bin/sh
# Builds dist/RojeyPOS-Setup-<version>.exe from dist/win-unpacked (or "dist/Rojey POS") with NSIS (no Wine needed).
set -e
cd "$(dirname "$0")/.."
V=$(node -p "require('./package.json').version")
NS="${NSISDIR:-$HOME/.cache/electron-builder/nsis/nsis-3.0.4.1}"
APPDIR="$PWD/dist/win-unpacked"; [ -d "$APPDIR" ] || APPDIR="$PWD/dist/Rojey POS"
NSISDIR="$NS" "$NS/linux/makensis" -V2 -DVERSION="$V" -DOUTFILE="$PWD/dist/RojeyPOS-Setup-$V.exe" -DAPPDIR="$APPDIR" -DICON="$PWD/build/icon.ico" installer/installer.nsi
