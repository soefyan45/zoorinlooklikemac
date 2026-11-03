#!/usr/bin/env bash
# Open the preferences window of the installed extension for two seconds, without logging
# out (the running shell only learns about new preferences at login). Lists the rows.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/zorin-notch@soefyan45.github.io}"
# GNOME's prefs module needs gnome-shell's private typelibs (Shew)
TYPELIBS=/usr/lib/gnome-shell/girepository-1.0

GI_TYPELIB_PATH="$TYPELIBS" LD_LIBRARY_PATH="$TYPELIBS" timeout 20 \
    gjs -m "$REPO_DIR/scripts/prefs-check.js" "$TARGET" 2>&1 | grep -v -E '^$|Unknown key'
