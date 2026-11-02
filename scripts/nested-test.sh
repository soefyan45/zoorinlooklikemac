#!/usr/bin/env bash
# Run an isolated nested GNOME Shell for testing the extension.
# The nested session uses its own dconf database, so the main desktop settings are untouched.
set -euo pipefail

UUID="${UUID:-zorin-notch@soefyan45.github.io}"
SIZE="${SIZE:-1440x900}"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$REPO_DIR/logs"
SANDBOX="$(mktemp -d -t zorin-notch-nested-XXXXXX)"

mkdir -p "$LOG_DIR" "$SANDBOX/config" "$SANDBOX/data/gnome-shell/extensions"
LOG_FILE="$LOG_DIR/nested-$(date +%Y%m%d-%H%M%S).log"

# Expose only this extension to the nested shell
if [[ -d "$REPO_DIR/extension" ]]; then
    ln -s "$REPO_DIR/extension" "$SANDBOX/data/gnome-shell/extensions/$UUID"
fi

# The nested shell shares XDG_RUNTIME_DIR with the main session and creates GNOME's crash
# guard file there. If it outlives the test, a later crash of the main shell would disable all
# extensions, so remove it on exit unless it already existed before the test.
GUARD_FILE="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/gnome-shell-disable-extensions"
GUARD_EXISTED=0
[[ -e "$GUARD_FILE" ]] && GUARD_EXISTED=1

cleanup() {
    rm -rf "$SANDBOX"
    (( GUARD_EXISTED )) || rm -f "$GUARD_FILE"
}
trap cleanup EXIT

echo "nested shell $SIZE, log: $LOG_FILE"

XDG_CONFIG_HOME="$SANDBOX/config" \
XDG_DATA_HOME="$SANDBOX/data" \
MUTTER_DEBUG_DUMMY_MODE_SPECS="$SIZE" \
ZORIN_NOTCH_DRY_RUN=1 \
ZORIN_NOTCH_REPO="$REPO_DIR" \
ZORIN_NOTCH_TRACE="${TRACE:-}" \
ZORIN_NOTCH_SELFTEST="${SELFTEST:-}" \
ZORIN_NOTCH_SHOT_DIR="${SELFTEST:+$LOG_DIR/shots}" \
ZORIN_NOTCH_SHOT_FULL="${DOCK:-}" \
dbus-run-session -- bash -c "
    gsettings set org.gnome.shell disable-user-extensions false
    gsettings set org.gnome.shell enabled-extensions \"['zorin-taskbar@zorinos.com', '$UUID']\"
    # DOCK=1: preview the dock preset (only in this isolated dconf)
    [[ -n '${DOCK:-}' ]] && dconf load /org/gnome/shell/extensions/zorin-taskbar/ < '$REPO_DIR/dock/zorin-taskbar.dconf'
    # NOTIFY=1: send a real notification through GNOME's notification daemon after startup
    [[ -n '${NOTIFY:-}' ]] && (sleep 8; notify-send 'Tes notch' 'Lewat notify-send') &
    exec gnome-shell --nested --wayland
" 2>&1 | tee "$LOG_FILE"
