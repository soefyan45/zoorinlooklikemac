#!/usr/bin/env bash
# Claude Code hook -> Zorin Notch. Reads the hook JSON on stdin and reports the session's
# state to the notch over D-Bus. Never blocks or fails Claude: the call runs in the
# background with a short timeout and the script always exits 0.
#
# Installed into ~/.claude/settings.json by scripts/install-agent-hooks.sh for:
# UserPromptSubmit, PreToolUse, PostToolUse (working), Notification, PermissionRequest
# (waiting), Stop (done) and SessionEnd (end).

input="$(cat)"

IFS=$'\t' read -r event session cwd tool message <<<"$(
    jq -r '[.hook_event_name // "", .session_id // "", .cwd // "", .tool_name // "",
            (.message // "" | gsub("[\\t\\n]"; " "))] | join("\t")' <<<"$input" 2>/dev/null
)"

case "$event" in
    UserPromptSubmit) state=working; text="Memproses prompt" ;;
    PreToolUse | PostToolUse) state=working; text="${tool:+Menjalankan $tool}" ;;
    Notification) state=waiting; text="$message" ;;
    PermissionRequest) state=waiting; text="Butuh izin${tool:+ untuk $tool}" ;;
    Stop) state=done; text="Giliran Claude selesai" ;;
    SessionEnd) state=end; text="" ;;
    *) exit 0 ;;
esac

project="$(basename "${cwd:-$PWD}")"

# Strings are passed as GVariant literals; jq's JSON string quoting is valid GVariant syntax
q() { jq -Rn --arg v "$1" '$v'; }

timeout 2 gdbus call --session \
    --dest io.github.soefyan45.ZorinNotch \
    --object-path /io/github/soefyan45/ZorinNotch \
    --method io.github.soefyan45.ZorinNotch1.AgentEvent \
    "$(q claude)" "$(q "$session")" "$(q "$state")" "$(q "$project")" "$(q "$text")" \
    >/dev/null 2>&1 &
disown 2>/dev/null

exit 0
