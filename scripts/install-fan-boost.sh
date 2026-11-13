#!/usr/bin/env bash
# Install zoorin-fan-boost (fan/): full fan speed while the CPU is hot, for ASUS laptops whose
# fan has only auto and full speed. Needs root:
#   sudo ./scripts/install-fan-boost.sh           install and start
#   sudo ./scripts/install-fan-boost.sh --remove  stop, remove, fan back to auto
# Settings: /etc/zoorin-fan-boost/fan.conf, owned by the user who ran sudo, so Zoorinlooklikemac's
# preferences can change them (kept on reinstall).
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
if [[ $EUID -ne 0 ]]; then
    echo "run it with sudo: sudo $0 $*" >&2
    exit 1
fi

if [[ "${1:-}" == "--remove" ]]; then
    systemctl disable --now zoorin-fan-boost.service 2>/dev/null || true
    rm -f /etc/systemd/system/zoorin-fan-boost.service /usr/local/bin/zoorin-fan-boost
    rm -rf /etc/zoorin-fan-boost
    systemctl daemon-reload
    echo "removed"
    exit 0
fi

install -m 755 "$REPO_DIR/fan/zoorin-fan-boost" /usr/local/bin/zoorin-fan-boost
install -m 644 "$REPO_DIR/fan/zoorin-fan-boost.service" /etc/systemd/system/zoorin-fan-boost.service

# The settings belong to the desktop user (the preferences write them); the service only reads
OWNER="${SUDO_USER:-root}"
install -d -m 755 -o "$OWNER" /etc/zoorin-fan-boost
if [[ ! -f /etc/zoorin-fan-boost/fan.conf ]]; then
    install -m 644 -o "$OWNER" "$REPO_DIR/fan/zoorin-fan-boost.conf" /etc/zoorin-fan-boost/fan.conf
    # Thresholds from the first version's settings file
    if [[ -f /etc/default/zoorin-fan-boost ]]; then
        for key in ON OFF INTERVAL; do
            value="$(grep -E "^$key=[0-9]+$" /etc/default/zoorin-fan-boost | cut -d= -f2 || true)"
            [[ -n "$value" ]] && sed -i "s/^$key=.*/$key=$value/" /etc/zoorin-fan-boost/fan.conf
        done
    fi
fi
rm -f /etc/default/zoorin-fan-boost
systemctl daemon-reload
systemctl enable --now zoorin-fan-boost.service
systemctl --no-pager --lines=3 status zoorin-fan-boost.service || true
