// opencode plugin -> Zorin Notch. Reports each session's state to the notch over D-Bus:
// working while it runs, waiting when it asks for permission or an answer, done when the
// run ends. Calls run in the background and errors are ignored, so the notch can never slow
// down or break opencode.
//
// Installed into ~/.config/opencode/plugins/ by scripts/install-agent-hooks.sh.

const DEST = "io.github.soefyan45.ZorinNotch"
const PATH = "/io/github/soefyan45/ZorinNotch"
const METHOD = "io.github.soefyan45.ZorinNotch1.AgentEvent"
// Busy updates are throttled per session; state changes always go out
const WORKING_INTERVAL_MS = 1500

export const ZorinNotchPlugin = async ({ $, directory }) => {
  const project = String(directory ?? "").split("/").filter(Boolean).pop() ?? ""
  const lastWorking = new Map()

  // GVariant string literals use the same quoting as JSON strings
  const send = (session, state, message = "") => {
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
            working(session, "Memproses prompt")
            break
          case "message.part.updated":
            working(session, "")
            break
          case "permission.asked":
          case "permission.updated":
            send(session, "waiting", "Butuh izin")
            break
          case "question.asked":
            send(session, "waiting", "Menunggu jawaban")
            break
          case "session.execution.succeeded":
          case "session.idle":
            lastWorking.delete(session)
            send(session, "done", "Giliran opencode selesai")
            break
          case "session.execution.failed":
            lastWorking.delete(session)
            send(session, "done", "Berhenti karena error")
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
        working(input?.sessionID ?? "", input?.tool ? `Menjalankan ${input.tool}` : "")
      } catch {}
    },
  }
}
