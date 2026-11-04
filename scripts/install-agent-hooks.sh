#!/usr/bin/env bash
# Connect coding agents to Zorin Notch:
#   - Claude Code: hooks in ~/.claude/settings.json calling ~/.local/bin/zorin-notchd hook claude
#                  (scripts/install-daemon.sh), or ~/.local/share/zorin-notch/claude-hook.sh
#                  when the Rust binary is not installed
#   - opencode:    ~/.config/opencode/plugins/zorin-notch.js (uses the binary too when present)
#
# Files are copied to the home drive (this repo's drive is mounted only after login).
# Runs again safely: previous Zorin Notch hooks are replaced, other hooks are kept.
# A backup of settings.json is written next to it first.
#
# --remove takes everything out again.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SHARE_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/zorin-notch"
HOOK="$SHARE_DIR/claude-hook.sh"
RUST_BIN="$HOME/.local/bin/zorin-notchd"
CLAUDE_SETTINGS="$HOME/.claude/settings.json"
OPENCODE_PLUGIN="${XDG_CONFIG_HOME:-$HOME/.config}/opencode/plugins/zorin-notch.js"
REMOVE=0
[[ "${1:-}" == "--remove" ]] && REMOVE=1

if [[ -f "$CLAUDE_SETTINGS" ]]; then
    cp "$CLAUDE_SETTINGS" "$CLAUDE_SETTINGS.bak-$(date +%Y%m%d-%H%M%S)"
fi

if (( ! REMOVE )); then
    mkdir -p "$SHARE_DIR"
    install -m 755 "$REPO_DIR/agents/claude-hook.sh" "$HOOK"
    echo "hook script: $HOOK"
fi
COMMAND="$HOOK"
if [[ -x "$RUST_BIN" ]]; then
    COMMAND="$RUST_BIN hook claude"
fi
(( REMOVE )) || echo "claude code hook command: $COMMAND"

python3 -I - "$CLAUDE_SETTINGS" "$COMMAND" "$REMOVE" <<'EOF'
import json, os, sys
path, hook, remove = sys.argv[1], sys.argv[2], sys.argv[3] == '1'
settings = json.load(open(path)) if os.path.exists(path) else {}
hooks = settings.setdefault('hooks', {})

# Drop earlier Zorin Notch hooks, keep everything else
for event in list(hooks):
    groups = []
    for group in hooks[event]:
        kept = [h for h in group.get('hooks', []) if 'zorin-notch' not in h.get('command', '')]
        if kept:
            group['hooks'] = kept
            groups.append(group)
    if groups:
        hooks[event] = groups
    else:
        del hooks[event]

if not remove:
    # Tool events take a matcher; the others do not
    for event, matcher in [('UserPromptSubmit', None), ('PreToolUse', '*'), ('PostToolUse', '*'),
                           ('Notification', None), ('PermissionRequest', '*'), ('Stop', None),
                           ('SessionEnd', None)]:
        group = {'hooks': [{'type': 'command', 'command': hook}]}
        if matcher:
            group = {'matcher': matcher, **group}
        hooks.setdefault(event, []).append(group)

if not hooks:
    settings.pop('hooks')
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, 'w') as f:
    f.write(json.dumps(settings, indent=2, ensure_ascii=False) + '\n')
print('claude code hooks', 'removed' if remove else 'installed', '->', path)
EOF

if (( REMOVE )); then
    rm -f "$OPENCODE_PLUGIN" "$HOOK"
    echo "opencode plugin removed"
elif [[ -d "$(dirname "$OPENCODE_PLUGIN")" ]]; then
    install -m 644 "$REPO_DIR/agents/opencode-plugin.js" "$OPENCODE_PLUGIN"
    echo "opencode plugin: $OPENCODE_PLUGIN"
else
    echo "opencode plugins folder not found, skipped"
fi

echo "done. New Claude Code / opencode sessions pick this up."
