#!/usr/bin/env bash
# Restore GNOME Shell settings from a backup made by backup.sh.
# Usage: rollback.sh [--dry-run] [BACKUP_FILE]   (default: newest file in backups/)
set -euo pipefail

UUID="${UUID:-zoorinlooklikemac@soefyan45.github.io}"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="$REPO_DIR/backups"

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then
    DRY_RUN=1
    shift
fi

FILE="${1:-$(ls -t "$BACKUP_DIR"/shell-*.dconf 2>/dev/null | grep -v pre-rollback | head -1 || true)}"
if [[ -z "$FILE" || ! -s "$FILE" ]]; then
    echo "no usable backup found in $BACKUP_DIR" >&2
    exit 1
fi

run() {
    if (( DRY_RUN )); then
        echo "[dry-run] $*"
    else
        "$@"
    fi
}

echo "restoring from: $FILE"

# Keep the current state too, in case the rollback itself needs undoing
SAFETY="$BACKUP_DIR/shell-pre-rollback-$(date +%Y%m%d-%H%M%S).dconf"
if (( DRY_RUN )); then
    echo "[dry-run] dconf dump /org/gnome/shell/ > $SAFETY"
else
    dconf dump /org/gnome/shell/ > "$SAFETY"
    echo "current state saved: $SAFETY"
fi

run gnome-extensions disable "$UUID" || true
run dconf reset -f /org/gnome/shell/
if (( DRY_RUN )); then
    echo "[dry-run] dconf load /org/gnome/shell/ < $FILE"
else
    dconf load /org/gnome/shell/ < "$FILE"
fi

echo "done. On Wayland, log out and back in if the shell still shows old extension code."
