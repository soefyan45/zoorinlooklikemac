#!/usr/bin/env bash
# Build and install zorin-notchd (daemon + agent hooks):
#   1. cargo build --release (build files under ~/.cache, not on this repo's drive)
#   2. copy the binary to ~/.local/bin (the system drive: available at login)
#   3. D-Bus activation file, so the daemon starts on demand
# Then run scripts/install-agent-hooks.sh to point Claude Code and opencode at it.
#
# --remove takes the binary and the activation file out again.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="$HOME/.local/bin"
BIN="$BIN_DIR/zorin-notchd"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/zorin-notchd-target}"

if [[ "${1:-}" == "--remove" ]]; then
    [[ -x "$BIN" ]] && "$BIN" uninstall-service
    pkill -f "^$BIN daemon$" 2>/dev/null || true
    rm -f "$BIN"
    echo "removed $BIN"
    exit 0
fi

cargo build --release --manifest-path "$REPO_DIR/daemon/Cargo.toml"
mkdir -p "$BIN_DIR"
install -m 755 "$CARGO_TARGET_DIR/release/zorin-notchd" "$BIN"
echo "installed $BIN ($("$BIN" --version))"

"$BIN" install-service
# A running daemon keeps the old code until it is restarted; the next call starts the new one
pkill -f "^$BIN daemon$" 2>/dev/null || true

# Start it through D-Bus activation and check that it answers
if reply="$(gdbus call --session --dest io.github.soefyan45.ZorinNotchd \
        --object-path /io/github/soefyan45/ZorinNotchd \
        --method io.github.soefyan45.ZorinNotchd1.Ping 2>&1)"; then
    echo "daemon answers: $reply"
else
    echo "daemon did not answer: $reply" >&2
    exit 1
fi
