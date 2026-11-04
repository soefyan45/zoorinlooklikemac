//! Two-way permissions: a Claude Code `PermissionRequest` hook asks the daemon, the daemon asks
//! the notch, the user answers there with Allow or Deny.
//!
//! Safe by construction: only an explicit answer from the notch becomes a decision. Every other
//! way out (no notch, no answer in time, the hook already gone because the user answered in the
//! terminal, a command too long to show in full) returns no decision, so Claude Code asks in the
//! terminal as it always did.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{Value, json};
use tokio::sync::oneshot;
use zbus::{Connection, Message};

use crate::{DAEMON_BUS, DAEMON_IFACE, DAEMON_PATH, NOTCH_BUS, NOTCH_IFACE, NOTCH_PATH};

/// How long the notch waits for an answer before the terminal prompt takes over
pub const TIMEOUT_S: u32 = 60;
/// Longest command shown on the notch. Anything longer is not shown in full, so it is not
/// offered there: allowing what cannot be read would be a blind yes.
const DETAIL_MAX: usize = 300;
/// The notch must answer within this, or it is taken as absent
const NOTCH_REPLY: Duration = Duration::from_millis(1500);
/// These tools ask the user a question or for a plan decision: "Allow" would answer for them
const TERMINAL_ONLY_TOOLS: [&str; 2] = ["AskUserQuestion", "ExitPlanMode"];

/// What the hook asks about
#[derive(Debug, Clone, PartialEq)]
pub struct Request {
    pub agent: String,
    pub session: String,
    pub project: String,
    pub tool: String,
    pub detail: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Allow,
    Deny,
    /// No answer in time, no notch to ask, or too long to show: the terminal decides
    None,
}

impl Outcome {
    pub fn as_str(self) -> &'static str {
        match self {
            Outcome::Allow => "allow",
            Outcome::Deny => "deny",
            Outcome::None => "none",
        }
    }

    pub fn parse(text: &str) -> Outcome {
        match text {
            "allow" => Outcome::Allow,
            "deny" => Outcome::Deny,
            _ => Outcome::None,
        }
    }
}

/// Requests waiting for the notch's answer
#[derive(Clone, Default)]
pub struct Pending(Arc<Mutex<HashMap<String, oneshot::Sender<bool>>>>);

impl Pending {
    fn add(&self) -> (String, oneshot::Receiver<bool>) {
        let (tx, rx) = oneshot::channel();
        let mut map = self.0.lock().unwrap_or_else(|e| e.into_inner());
        // Ids cannot be guessed by another process on the bus
        let mut id = random_id();
        while map.contains_key(&id) {
            id = random_id();
        }
        map.insert(id.clone(), tx);
        (id, rx)
    }

    fn remove(&self, id: &str) {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).remove(id);
    }

    /// The notch's answer. False for an unknown, closed or already answered request.
    pub fn answer(&self, id: &str, allow: bool) -> bool {
        let sender = self.0.lock().unwrap_or_else(|e| e.into_inner()).remove(id);
        sender.is_some_and(|tx| tx.send(allow).is_ok())
    }
}

fn random_id() -> String {
    let mut bytes = [0u8; 12];
    let filled = std::fs::File::open("/dev/urandom").and_then(|mut f| std::io::Read::read_exact(&mut f, &mut bytes));
    if filled.is_err() {
        // Without the kernel's randomness fall back to the clock: still unique, just guessable
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
        bytes[..8].copy_from_slice(&(now.as_nanos() as u64).to_le_bytes());
    }
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// One line for the notch; line breaks stay visible as ⏎ so a second command cannot hide
fn one_line(text: &str) -> String {
    let mut out = String::new();
    for c in text.trim().chars() {
        match c {
            '\n' | '\r' => out.push_str(" ⏎ "),
            c if c.is_control() => out.push(' '),
            c => out.push(c),
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The request for a `PermissionRequest` hook input, or None when the notch should not
/// decide it (questions to the user, details too long to show in full)
pub fn request_from_hook(input: &Value, project: &str) -> Option<Request> {
    let tool = input.get("tool_name")?.as_str()?;
    if tool.is_empty() || TERMINAL_ONLY_TOOLS.contains(&tool) {
        return None;
    }
    let args = input.get("tool_input").unwrap_or(&Value::Null);
    let field = |name: &str| args.get(name).and_then(Value::as_str);
    let detail = match tool {
        "Bash" => field("command").map(str::to_string),
        "Read" | "Write" | "Edit" | "MultiEdit" => field("file_path").map(str::to_string),
        "NotebookEdit" => field("notebook_path").map(str::to_string),
        "WebFetch" => field("url").map(str::to_string),
        "WebSearch" => field("query").map(str::to_string),
        _ => None,
    }
    .unwrap_or_else(|| args.to_string());
    let detail = one_line(&detail);
    if detail.chars().count() > DETAIL_MAX {
        return None;
    }
    Some(Request {
        agent: "claude".to_string(),
        session: input.get("session_id").and_then(Value::as_str).unwrap_or("default").to_string(),
        project: project.to_string(),
        tool: one_line(tool),
        detail,
    })
}

/// What Claude Code reads from the hook's stdout; None = no decision, ask in the terminal
pub fn decision_json(outcome: Outcome) -> Option<Value> {
    let decision = match outcome {
        Outcome::Allow => json!({"behavior": "allow"}),
        Outcome::Deny => json!({"behavior": "deny", "message": "Denied from the Zorin Notch"}),
        Outcome::None => return None,
    };
    Some(json!({"hookSpecificOutput": {"hookEventName": "PermissionRequest", "decision": decision}}))
}

/// Hook side: ask the daemon (started on demand) and wait for its answer
pub async fn ask_daemon(req: &Request) -> Outcome {
    let Ok(conn) = Connection::session().await else {
        return Outcome::None;
    };
    // The daemon gives up after TIMEOUT_S; a little more here covers its startup and the reply
    let wait = Duration::from_secs(u64::from(TIMEOUT_S) + 5);
    let body = (&req.agent, &req.session, &req.project, &req.tool, &req.detail);
    let call = conn.call_method(Some(DAEMON_BUS), DAEMON_PATH, Some(DAEMON_IFACE), "Ask", &body);
    match tokio::time::timeout(wait, call).await {
        Ok(Ok(reply)) => {
            let body = reply.body();
            body.deserialize::<String>().map(|s| Outcome::parse(&s)).unwrap_or(Outcome::None)
        }
        _ => Outcome::None,
    }
}

/// Daemon side: show the request on the notch and wait for Allow, Deny, the timeout, or the
/// hook disappearing. `sender` is the hook's bus name.
pub async fn ask_notch(pending: &Pending, conn: &Connection, sender: Option<&str>, req: &Request) -> Outcome {
    let (id, answer) = pending.add();

    let shown = tokio::time::timeout(
        NOTCH_REPLY,
        conn.call_method(
            Some(NOTCH_BUS),
            NOTCH_PATH,
            Some(NOTCH_IFACE),
            "PermissionAsked",
            &(&id, &req.agent, &req.session, &req.project, &req.tool, &req.detail, TIMEOUT_S),
        ),
    )
    .await;
    // The notch says whether it takes the request (it may be switched off in the settings)
    let accepted = matches!(&shown, Ok(Ok(reply)) if reply.body().deserialize::<bool>().unwrap_or(false));
    if !accepted {
        pending.remove(&id);
        return Outcome::None;
    }

    let (outcome, reason) = tokio::select! {
        answered = answer => match answered {
            Ok(true) => (Outcome::Allow, "answered"),
            Ok(false) => (Outcome::Deny, "answered"),
            Err(_) => (Outcome::None, "closed"),
        },
        () = tokio::time::sleep(Duration::from_secs(u64::from(TIMEOUT_S))) => (Outcome::None, "timeout"),
        () = caller_gone(conn, sender) => (Outcome::None, "terminal"),
    };
    pending.remove(&id);
    if reason != "answered" {
        // The notch drops the request (answered in the terminal, or too late)
        notify_closed(conn, &id, reason).await;
    }
    outcome
}

/// Resolves when the hook's connection is gone (Claude Code ended it); never, without a sender
async fn caller_gone(conn: &Connection, sender: Option<&str>) {
    let Some(sender) = sender else {
        return std::future::pending().await;
    };
    loop {
        tokio::time::sleep(Duration::from_millis(500)).await;
        let reply = conn
            .call_method(
                Some("org.freedesktop.DBus"),
                "/org/freedesktop/DBus",
                Some("org.freedesktop.DBus"),
                "NameHasOwner",
                &(sender,),
            )
            .await;
        if let Ok(reply) = reply {
            if reply.body().deserialize::<bool>() == Ok(false) {
                return;
            }
        }
    }
}

async fn notify_closed(conn: &Connection, id: &str, reason: &str) {
    let msg = Message::method_call(NOTCH_PATH, "PermissionClosed")
        .destination(NOTCH_BUS)
        .interface(NOTCH_IFACE)
        .with_flags(zbus::message::Flags::NO_REPLY_EXPECTED)
        .build(&(id, reason));
    if let Ok(msg) = msg {
        let _ = tokio::time::timeout(NOTCH_REPLY, conn.send(&msg)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hook(tool: &str, args: Value) -> Value {
        json!({"hook_event_name": "PermissionRequest", "session_id": "s1", "tool_name": tool, "tool_input": args})
    }

    #[test]
    fn detail_is_what_the_tool_will_do() {
        let bash = request_from_hook(&hook("Bash", json!({"command": "ls -la\nrm x"})), "proj").unwrap();
        assert_eq!(bash.detail, "ls -la ⏎ rm x");
        assert_eq!((bash.tool.as_str(), bash.project.as_str(), bash.session.as_str()), ("Bash", "proj", "s1"));

        let edit = request_from_hook(&hook("Edit", json!({"file_path": "/a/b.rs", "old_string": "x"})), "p").unwrap();
        assert_eq!(edit.detail, "/a/b.rs");

        let other = request_from_hook(&hook("Grep", json!({"pattern": "x"})), "p").unwrap();
        assert!(other.detail.contains("pattern"));
    }

    #[test]
    fn what_cannot_be_read_in_full_stays_in_the_terminal() {
        let long = "x".repeat(DETAIL_MAX + 1);
        assert_eq!(request_from_hook(&hook("Bash", json!({"command": long})), "p"), None);
        let fits = "x".repeat(DETAIL_MAX);
        assert!(request_from_hook(&hook("Bash", json!({"command": fits})), "p").is_some());
        assert_eq!(request_from_hook(&hook("AskUserQuestion", json!({})), "p"), None);
        assert_eq!(request_from_hook(&hook("ExitPlanMode", json!({})), "p"), None);
        assert_eq!(request_from_hook(&json!({}), "p"), None);
    }

    #[test]
    fn only_allow_and_deny_make_a_decision() {
        let allow = decision_json(Outcome::Allow).unwrap();
        assert_eq!(allow["hookSpecificOutput"]["hookEventName"], "PermissionRequest");
        assert_eq!(allow["hookSpecificOutput"]["decision"]["behavior"], "allow");
        let deny = decision_json(Outcome::Deny).unwrap();
        assert_eq!(deny["hookSpecificOutput"]["decision"]["behavior"], "deny");
        assert!(deny["hookSpecificOutput"]["decision"]["message"].is_string());
        assert_eq!(decision_json(Outcome::None), None);
        assert_eq!(Outcome::parse("garbage"), Outcome::None);
    }

    #[test]
    fn an_answer_counts_once() {
        let pending = Pending::default();
        let (id, mut rx) = pending.add();
        assert!(!pending.answer("not-an-id", true));
        assert!(pending.answer(&id, true));
        assert_eq!(rx.try_recv(), Ok(true));
        assert!(!pending.answer(&id, false));
        let (other, _rx) = pending.add();
        assert_ne!(id, other);
        assert_eq!(other.len(), 24);
    }
}
