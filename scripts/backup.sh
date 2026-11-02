#!/usr/bin/env bash
# Save the current GNOME Shell settings (extensions, panel, dock) to backups/.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="$REPO_DIR/backups"
mkdir -p "$BACKUP_DIR"

FILE="$BACKUP_DIR/shell-$(date +%Y%m%d-%H%M%S).dconf"
dconf dump /org/gnome/shell/ > "$FILE"

if [[ ! -s "$FILE" ]]; then
    echo "backup is empty, aborting: $FILE" >&2
    rm -f "$FILE"
    exit 1
fi

echo "backup saved: $FILE ($(wc -l < "$FILE") lines)"
