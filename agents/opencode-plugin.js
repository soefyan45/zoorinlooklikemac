// opencode plugin -> Zorin Notch. Reports each session's state to the notch over D-Bus:
// working while it runs, waiting when it asks for permission or an answer, done when the
// run ends. Calls run in the background and errors are ignored, so the notch can never slow
// down or break opencode.
//
// Installed into ~/.config/opencode/plugins/ by scripts/install-agent-hooks.sh.
// Uses ~/.local/bin/zorin-notchd (scripts/install-daemon.sh) when installed, gdbus otherwise.

import { existsSync } from "node:fs"
import { homedir } from "node:os"

const DEST = "io.github.soefyan45.ZorinNotch"
const PATH = "/io/github/soefyan45/ZorinNotch"
const METHOD = "io.github.soefyan45.ZorinNotch1.AgentEvent"
// Busy updates are throttled per session; state changes always go out
const WORKING_INTERVAL_MS = 1500
const RUST_BIN = `${homedir()}/.local/bin/zorin-notchd`

export const ZorinNotchPlugin = async ({ $, directory }) => {
  const project = String(directory ?? "").split("/").filter(Boolean).pop() ?? ""
  const lastWorking = new Map()
  const rust = existsSync(RUST_BIN)

  const send = (session, state, message = "") => {
    // The binary gives up after 1 s on its own and never fails
    if (rust) {
      $`${RUST_BIN} event opencode ${session || "default"} ${state} ${project} ${message}`
        .quiet()
        .nothrow()
        .catch(() => {})
      return
    }
    // GVariant string literals use the same quoting as JSON strings
    $`timeout 2 gdbus call --session --dest ${DEST} --object-path ${PATH} --method ${METHOD} ${JSON.stringify("opencode")} ${JSON.stringify(session || "default")} ${JSON.stringify(state)} ${JSON.stringify(project)} ${JSON.stringify(message)}`
      .quiet()
      .nothrow()
      .catch(() => {})
  }

  const working = (session, message) => {
    const now = Date.now()
    if (now - (lastWorking.get(session) ?? 0) < WORKING_INTERVAL_MS) return
    lastWorking.set(session, now)
    send(session, "working", message)
  }

  const sessionOf = (event) => {
    const p = event?.properties ?? {}
    return p.sessionID ?? p.sessionId ?? p.info?.id ?? p.part?.sessionID ?? ""
  }

  return {
    event: async ({ event }) => {
      try {
        const session = sessionOf(event)
        switch (event?.type) {
          case "session.execution.started":
            lastWorking.delete(session)
            working(session, "Processing prompt")
            break
          case "message.part.updated":
            working(session, "")
            break
          case "permission.asked":
          case "permission.updated":
            send(session, "waiting", "Needs permission")
            break
          case "question.asked":
            send(session, "waiting", "Waiting for an answer")
            break
          case "session.execution.succeeded":
          case "session.idle":
            lastWorking.delete(session)
            send(session, "done", "opencode finished its turn")
            break
          case "session.execution.failed":
            lastWorking.delete(session)
            send(session, "done", "Stopped with an error")
            break
          case "session.deleted":
            lastWorking.delete(session)
            send(session, "end")
            break
        }
      } catch {
        // never let the notch affect opencode
      }
    },
    "tool.execute.before": async (input) => {
      try {
        working(input?.sessionID ?? "", input?.tool ? `Running ${input.tool}` : "")
      } catch {}
    },
  }
}
