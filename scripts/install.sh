#!/usr/bin/env bash
# Install Zorin Notch for the current user (no sudo):
#   1. backup of /org/gnome/shell/ (scripts/backup.sh)
#   2. copy extension/ into ~/.local/share/gnome-shell/extensions/<uuid>
#   3. enable it
#
# The extension is copied, not linked: this repo lives on a drive that is only mounted after
# login, so a link would be broken when GNOME starts after a reboot and the notch would be
# missing. Run this script again after changing the code; on Wayland the new code is loaded
# at the next login.
#
# --link links instead of copying (development only, never across reboots).
# Undo: scripts/rollback.sh (restores a backup) and delete the extension folder.
set -euo pipefail

UUID="zoorinlooklikemac@soefyan45.github.io"
# The extension's first name; its settings and enabled entry move to the current one
OLD_UUID="zorin-notch@soefyan45.github.io"
OLD_DCONF="/org/gnome/shell/extensions/zorin-notch/"
NEW_DCONF="/org/gnome/shell/extensions/zoorinlooklikemac/"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"
MODE="copy"
[[ "${1:-}" == "--link" ]] && MODE="link"

"$REPO_DIR/scripts/backup.sh"

# Settings schema of the preferences window
glib-compile-schemas --strict "$REPO_DIR/extension/schemas"

mkdir -p "$(dirname "$TARGET")"
if [[ -L "$TARGET" ]]; then
    rm "$TARGET"
fi

if [[ "$MODE" == "link" ]]; then
    if [[ -e "$TARGET" ]]; then
        echo "$TARGET exists and is not a link; not touching it" >&2
        exit 1
    fi
    ln -s "$REPO_DIR/extension" "$TARGET"
    echo "linked $TARGET -> $REPO_DIR/extension (development only)"
else
    # The self test module stays out of the installed copy
    rsync -a --delete --exclude 'devtools.js' "$REPO_DIR/extension/" "$TARGET/"
    echo "copied extension to $TARGET"
fi

# Settings made under the first name carry over once (the old ones stay, for a rollback)
if [[ -n "$(dconf list "$OLD_DCONF" 2>/dev/null)" && -z "$(dconf list "$NEW_DCONF" 2>/dev/null)" ]]; then
    dconf dump "$OLD_DCONF" | dconf load "$NEW_DCONF"
    echo "settings moved from $OLD_DCONF to $NEW_DCONF"
fi

# Edit the enabled list directly: gnome-extensions cannot enable an extension the running
# shell has not discovered yet
python3 -I - "$UUID" "$OLD_UUID" <<'EOF'
import ast, subprocess, sys
uuid, old_uuid = sys.argv[1], sys.argv[2]
get = lambda key: ast.literal_eval(subprocess.check_output(
    ['gsettings', 'get', 'org.gnome.shell', key], text=True).removeprefix('@as '))
enabled = get('enabled-extensions')
# Only one of the two names may be enabled, or the notch would be drawn twice
enabled = [e for e in enabled if e != old_uuid]
if uuid not in enabled:
    enabled.append(uuid)
disabled = [e for e in get('disabled-extensions') if e != uuid]
subprocess.check_call(['gsettings', 'set', 'org.gnome.shell', 'enabled-extensions', str(enabled)])
subprocess.check_call(['gsettings', 'set', 'org.gnome.shell', 'disabled-extensions', str(disabled)])
print('enabled:', uuid)
EOF

if [[ -d "${TARGET%/*}/$OLD_UUID" ]]; then
    echo "the old copy ${TARGET%/*}/$OLD_UUID is no longer enabled; delete it once the new one runs"
fi
echo "done. Log out and back in to load the new code."
