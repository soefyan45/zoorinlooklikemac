#!/usr/bin/env bash
# Install Zoorinlooklikemac from a release download (no build tools needed). The release
# workflow puts this script at the top of the archive as install.sh, next to the extension zip
# and the zorin-notchd binary:
#   1. backup of /org/gnome/shell/ (scripts/backup.sh)
#   2. the extension into ~/.local/share/gnome-shell/extensions, enabled
#   3. zorin-notchd into ~/.local/bin, with its D-Bus activation file
# Options:
#   --dock    also turn zorin-taskbar into the dock from the design (scripts/apply-dock.sh)
#   --agents  also connect Claude Code and opencode (scripts/install-agent-hooks.sh)
#   --remove  take the extension and the daemon out again (settings stay; undo those with
#             scripts/rollback.sh)
# Log out and back in afterwards: GNOME on Wayland loads extension code at login.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
UUID="zoorinlooklikemac@soefyan45.github.io"
ZIP="$DIR/$UUID.shell-extension.zip"
EXT_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"
BIN="$HOME/.local/bin/zorin-notchd"

DOCK=0
AGENTS=0
REMOVE=0
for arg in "$@"; do
    case "$arg" in
        --dock) DOCK=1 ;;
        --agents) AGENTS=1 ;;
        --remove) REMOVE=1 ;;
        *) echo "unknown option: $arg (use --dock, --agents or --remove)" >&2; exit 2 ;;
    esac
done

set_enabled() {
    python3 -I - "$UUID" "$1" <<'EOF'
import ast, subprocess, sys
uuid, on = sys.argv[1], sys.argv[2] == '1'
get = lambda key: ast.literal_eval(subprocess.check_output(
    ['gsettings', 'get', 'org.gnome.shell', key], text=True).removeprefix('@as '))
enabled = [e for e in get('enabled-extensions') if e != uuid] + ([uuid] if on else [])
disabled = [e for e in get('disabled-extensions') if e != uuid]
subprocess.check_call(['gsettings', 'set', 'org.gnome.shell', 'enabled-extensions', str(enabled)])
subprocess.check_call(['gsettings', 'set', 'org.gnome.shell', 'disabled-extensions', str(disabled)])
EOF
}

if (( REMOVE )); then
    set_enabled 0
    rm -rf "$EXT_DIR"
    if [[ -x "$BIN" ]]; then
        "$BIN" uninstall-service
        rm -f "$BIN"
    fi
    echo "removed the extension and zorin-notchd; log out and back in"
    exit 0
fi

shell_version="$(gnome-shell --version 2>/dev/null | grep -oE '[0-9]+' | head -1 || true)"
if [[ "$shell_version" != "46" ]]; then
    echo "note: made for GNOME Shell 46 (Zorin OS 18); this is GNOME Shell ${shell_version:-unknown}" >&2
fi

"$DIR/scripts/backup.sh"

# Unpacked by hand: gnome-extensions cannot enable an extension the running shell has not
# discovered yet, so the enabled list is edited directly
rm -rf "$EXT_DIR"
mkdir -p "$EXT_DIR"
python3 -I -c 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$ZIP" "$EXT_DIR"
glib-compile-schemas "$EXT_DIR/schemas"
set_enabled 1
echo "extension installed: $EXT_DIR"

mkdir -p "$(dirname "$BIN")"
install -m 755 "$DIR/zorin-notchd" "$BIN"
"$BIN" install-service
# A running daemon keeps its old code until it is restarted; the next call starts the new one
pkill -f "^$BIN daemon$" 2>/dev/null || true
echo "daemon installed: $BIN ($("$BIN" --version))"

(( DOCK )) && "$DIR/scripts/apply-dock.sh"
(( AGENTS )) && "$DIR/scripts/install-agent-hooks.sh"

echo "done. Log out and back in to load the extension."
