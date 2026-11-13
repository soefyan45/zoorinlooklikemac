#!/usr/bin/env bash
# Install zoorin-fan-boost (fan/): full fan speed while the CPU is hot, for ASUS laptops whose
# fan has only auto and full speed. Needs root:
#   sudo ./scripts/install-fan-boost.sh           install and start
#   sudo ./scripts/install-fan-boost.sh --remove  stop, remove, fan back to auto
# Thresholds: /etc/default/zoorin-fan-boost (kept on reinstall).
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
if [[ $EUID -ne 0 ]]; then
    echo "run it with sudo: sudo $0 $*" >&2
    exit 1
fi

if [[ "${1:-}" == "--remove" ]]; then
    systemctl disable --now zoorin-fan-boost.service 2>/dev/null || true
    rm -f /etc/systemd/system/zoorin-fan-boost.service /usr/local/bin/zoorin-fan-boost
    systemctl daemon-reload
    echo "removed (settings kept in /etc/default/zoorin-fan-boost)"
    exit 0
fi

install -m 755 "$REPO_DIR/fan/zoorin-fan-boost" /usr/local/bin/zoorin-fan-boost
install -m 644 "$REPO_DIR/fan/zoorin-fan-boost.service" /etc/systemd/system/zoorin-fan-boost.service
[[ -f /etc/default/zoorin-fan-boost ]] || install -m 644 "$REPO_DIR/fan/zoorin-fan-boost.conf" /etc/default/zoorin-fan-boost
systemctl daemon-reload
systemctl enable --now zoorin-fan-boost.service
systemctl --no-pager --lines=3 status zoorin-fan-boost.service || true
