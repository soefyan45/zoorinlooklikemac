#!/usr/bin/env bash
# Turn zorin-taskbar into the dock from the design (dock/zorin-taskbar.dconf).
# Makes a backup first; undo with scripts/rollback.sh.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

"$REPO_DIR/scripts/backup.sh"
dconf load /org/gnome/shell/extensions/zorin-taskbar/ < "$REPO_DIR/dock/zorin-taskbar.dconf"
echo "dock preset applied (zorin-taskbar reloads its settings live)"
