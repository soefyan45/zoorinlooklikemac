//! zorin-notchd: daemon and agent hooks for Zorin Notch.
//!
//! The notch, dock and Spotlight are drawn by the GNOME Shell extension (only GNOME Shell can
//! draw over the screen on Wayland). This binary does the work around it:
//!
//! - `hook claude`: Claude Code hook. Reads the hook JSON on stdin and reports the session's
//!   state to the notch. Replaces agents/claude-hook.sh (bash + jq + gdbus per tool call).
//! - `event <agent> <session> <state> <project> [message]`: the same report from any agent,
//!   used by the opencode plugin.
//! - `daemon`: the D-Bus service io.github.soefyan45.ZorinNotchd, started on demand by
//!   D-Bus activation. It answers Ping, Search (files and document contents through GNOME's
//!   Tracker index), Ask/Answer (two-way permissions, see permission.rs) and Stats (CPU,
//!   memory, GPU, SSD and network for the notch, see sysinfo.rs).
//! - `search <words>`: the same search from the command line, for trying it out.
//! - `stats`: the system info as JSON, for trying it out.
//! - `install-service` / `uninstall-service`: the D-Bus activation file.
//!
//! Hooks never fail the agent and the exit code is always 0. Reports are sent without waiting
//! for a reply, under a short timeout; the one hook that waits is Claude's PermissionRequest,
//! which gives the user a minute to answer on the notch.

mod permission;
mod search;
mod sysinfo;

use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::Value;
use zbus::message::Flags;
use zbus::{Connection, Message, interface};

const VERSION: &str = env!("CARGO_PKG_VERSION");

// The extension's service, which draws the agent state on the notch
const NOTCH_BUS: &str = "io.github.soefyan45.ZorinNotch";
const NOTCH_PATH: &str = "/io/github/soefyan45/ZorinNotch";
const NOTCH_IFACE: &str = "io.github.soefyan45.ZorinNotch1";

// This daemon's own service
const DAEMON_BUS: &str = "io.github.soefyan45.ZorinNotchd";
const DAEMON_PATH: &str = "/io/github/soefyan45/ZorinNotchd";
const DAEMON_IFACE: &str = "io.github.soefyan45.ZorinNotchd1";

// A hook gives up after this; the agent must never wait on the notch
const HOOK_TIMEOUT: Duration = Duration::from_millis(1000);
// Longest message sent to the notch (the extension cuts at 300 characters too)
const MESSAGE_MAX: usize = 300;

/// What a Claude Code hook event means for the notch: (state, message)
fn claude_state(input: &Value) -> Option<(&'static str, String)> {
    let event = input.get("hook_event_name")?.as_str()?;
    let tool = input.get("tool_name").and_then(Value::as_str).unwrap_or("");
    let state = match event {
        "UserPromptSubmit" => ("working", "Processing prompt".to_string()),
        "PreToolUse" | "PostToolUse" if !tool.is_empty() => ("working", format!("Running {tool}")),
        "PreToolUse" | "PostToolUse" => ("working", String::new()),
        "Notification" => (
            "waiting",
            input.get("message").and_then(Value::as_str).unwrap_or("").to_string(),
        ),
        "PermissionRequest" if !tool.is_empty() => ("waiting", format!("Needs permission for {tool}")),
        "PermissionRequest" => ("waiting", "Needs permission".to_string()),
        "Stop" => ("done", "Claude finished its turn".to_string()),
        "SessionEnd" => ("end", String::new()),
        _ => return None,
    };
    Some(state)
}

/// Project name shown on the notch: the last part of the working directory
fn project_name(cwd: Option<&str>) -> String {
    let cwd = cwd
        .map(PathBuf::from)
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_default();
    cwd.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

/// One line, no control characters, bounded length
fn clean(text: &str) -> String {
    let flat: String = text
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    flat.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(MESSAGE_MAX).collect()
}

/// Report an agent's state to the notch, without waiting for a reply
async fn send_event(agent: &str, session: &str, state: &str, project: &str, message: &str) -> zbus::Result<()> {
    let conn = Connection::session().await?;
    let body = (agent, session, state, project, clean(message));
    let msg = Message::method_call(NOTCH_PATH, "AgentEvent")
        .destination(NOTCH_BUS)
        .interface(NOTCH_IFACE)
        .with_flags(Flags::NO_REPLY_EXPECTED)
        .build(&body)?;
    conn.send(&msg).await
}

async fn hook_claude() {
    let mut raw = String::new();
    if std::io::stdin().read_to_string(&mut raw).is_err() {
        return;
    }
    let Ok(input) = serde_json::from_str::<Value>(&raw) else {
        return;
    };
    let Some((state, message)) = claude_state(&input) else {
        return;
    };
    let session = input.get("session_id").and_then(Value::as_str).unwrap_or("default");
    let project = project_name(input.get("cwd").and_then(Value::as_str));
    // Errors (notch not running, no session bus) are fine: the agent goes on
    let _ = tokio::time::timeout(HOOK_TIMEOUT, send_event("claude", session, state, &project, &message)).await;

    // A permission prompt: the user may answer on the notch. No answer, no decision: Claude
    // Code then asks in the terminal as usual.
    if input.get("hook_event_name").and_then(Value::as_str) == Some("PermissionRequest") {
        if let Some(request) = permission::request_from_hook(&input, &project) {
            let outcome = permission::ask_daemon(&request).await;
            if let Some(decision) = permission::decision_json(outcome) {
                println!("{decision}");
            }
        }
    }
}

async fn event(args: &[String]) {
    let [agent, session, state, project, rest @ ..] = args else {
        eprintln!("usage: zorin-notchd event <agent> <session> <state> <project> [message]");
        return;
    };
    let message = rest.join(" ");
    let _ = tokio::time::timeout(HOOK_TIMEOUT, send_event(agent, session, state, project, &message)).await;
}

#[derive(Default)]
struct Daemon {
    permissions: permission::Pending,
    stats: std::sync::Mutex<sysinfo::Sampler>,
}

/// The first reading needs a second one to measure loads: this far apart
const STATS_PRIME: Duration = Duration::from_millis(300);

#[interface(name = "io.github.soefyan45.ZorinNotchd1")]
impl Daemon {
    /// Version of the daemon, to check that it runs
    fn ping(&self) -> String {
        VERSION.to_string()
    }

    /// A hook asks whether a tool may run. Waits for the user's answer on the notch (at most a
    /// minute) and returns "allow", "deny" or "none" (ask in the terminal instead).
    async fn ask(
        &self,
        agent: String,
        session: String,
        project: String,
        tool: String,
        detail: String,
        #[zbus(connection)] conn: &Connection,
        #[zbus(header)] header: zbus::message::Header<'_>,
    ) -> String {
        let request = permission::Request { agent, session, project, tool, detail };
        let sender = header.sender().map(|s| s.to_string());
        permission::ask_notch(&self.permissions, conn, sender.as_deref(), &request)
            .await
            .as_str()
            .to_string()
    }

    /// The notch's answer to a request. False when it is unknown, closed or already answered.
    fn answer(&self, id: String, allow: bool) -> bool {
        self.permissions.answer(&id, allow)
    }

    /// System info as JSON: cpu {load, temp, cores, mhz, model}, mem {used, total}, gpu {name,
    /// load, temp, ...} or null, ssd {temp} or null, net {rx, tx} in bytes per second, top
    /// [{name, cpu}]. Loads cover the time since the previous call.
    async fn stats(&self) -> String {
        let primed = self.stats.lock().map(|s| s.has_previous()).unwrap_or(false);
        if !primed {
            if let Ok(mut sampler) = self.stats.lock() {
                sampler.prime();
            }
            tokio::time::sleep(STATS_PRIME).await;
        }
        self.stats.lock().map(|mut s| s.snapshot().to_string()).unwrap_or_default()
    }

    /// Files by name and, with `content`, by the text inside them. Rows are
    /// (kind, title, uri, snippet, mime); kind is file, folder or document, `limit` applies
    /// to names and to contents separately. Snippets mark matches with « ». Empty when
    /// Tracker is not running.
    async fn search(
        &self,
        query: String,
        limit: u32,
        files: bool,
        content: bool,
        #[zbus(connection)] conn: &Connection,
    ) -> Vec<(String, String, String, String, String)> {
        search::search(conn, &query, limit.clamp(1, 50) as usize, files, content)
            .await
            .into_iter()
            .map(|h| (h.kind.to_string(), h.title, h.uri, h.snippet, h.mime))
            .collect()
    }
}

async fn search_cli(words: &[String]) {
    let Ok(conn) = Connection::session().await else {
        eprintln!("zorin-notchd: no session bus");
        return;
    };
    let started = std::time::Instant::now();
    let hits = search::search(&conn, &words.join(" "), 8, true, true).await;
    for h in &hits {
        println!("{:<9} {}\n          {}", h.kind, h.title, h.uri);
        if !h.snippet.is_empty() {
            println!("          {}", h.snippet);
        }
    }
    eprintln!("{} hits in {} ms", hits.len(), started.elapsed().as_millis());
}

async fn run_daemon() -> zbus::Result<()> {
    let _conn = zbus::connection::Builder::session()
        .name(DAEMON_BUS)
        .serve_at(DAEMON_PATH, Daemon::default())
        .build()
        .await?;
    // Served until the session ends
    std::future::pending::<()>().await;
    Ok(())
}

fn service_path() -> PathBuf {
    let data = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| Path::new(&std::env::var_os("HOME").unwrap_or_default()).join(".local/share"));
    data.join("dbus-1/services").join(format!("{DAEMON_BUS}.service"))
}

fn install_service() -> std::io::Result<PathBuf> {
    let exe = std::env::current_exe()?;
    let path = service_path();
    std::fs::create_dir_all(path.parent().unwrap_or(Path::new("/")))?;
    std::fs::write(
        &path,
        format!("[D-BUS Service]\nName={DAEMON_BUS}\nExec={} daemon\n", exe.display()),
    )?;
    Ok(path)
}

fn uninstall_service() -> std::io::Result<PathBuf> {
    let path = service_path();
    match std::fs::remove_file(&path) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e),
        _ => Ok(path),
    }
}

const USAGE: &str = "usage: zorin-notchd <command>
  hook claude                                   Claude Code hook (JSON on stdin)
  event <agent> <session> <state> <project> [message]
                                                report an agent state (working, waiting, done, end)
  search <words>                                search files and document contents (Tracker)
  stats                                         system info as JSON
  daemon                                        run the D-Bus service
  install-service | uninstall-service           D-Bus activation file
  --version";

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.iter().map(String::as_str).collect::<Vec<_>>().as_slice() {
        ["hook", "claude"] => hook_claude().await,
        ["event", ..] => event(&args[1..]).await,
        ["search", ..] => search_cli(&args[1..]).await,
        ["stats"] => {
            let mut sampler = sysinfo::Sampler::default();
            sampler.prime();
            tokio::time::sleep(Duration::from_secs(1)).await;
            println!("{}", sampler.snapshot());
        }
        ["daemon"] => {
            if let Err(e) = run_daemon().await {
                eprintln!("zorin-notchd: {e}");
                std::process::exit(1);
            }
        }
        ["install-service"] => match install_service() {
            Ok(path) => println!("installed {}", path.display()),
            Err(e) => {
                eprintln!("zorin-notchd: {e}");
                std::process::exit(1);
            }
        },
        ["uninstall-service"] => match uninstall_service() {
            Ok(path) => println!("removed {}", path.display()),
            Err(e) => {
                eprintln!("zorin-notchd: {e}");
                std::process::exit(1);
            }
        },
        ["--version"] => println!("zorin-notchd {VERSION}"),
        _ => {
            eprintln!("{USAGE}");
            std::process::exit(2);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn claude_events_map_to_notch_states() {
        let tool = json!({"hook_event_name": "PreToolUse", "tool_name": "Bash"});
        assert_eq!(claude_state(&tool), Some(("working", "Running Bash".to_string())));

        let permission = json!({"hook_event_name": "PermissionRequest", "tool_name": "Edit"});
        assert_eq!(claude_state(&permission), Some(("waiting", "Needs permission for Edit".to_string())));

        let note = json!({"hook_event_name": "Notification", "message": "Claude is waiting"});
        assert_eq!(claude_state(&note), Some(("waiting", "Claude is waiting".to_string())));

        assert_eq!(claude_state(&json!({"hook_event_name": "Stop"})).unwrap().0, "done");
        assert_eq!(claude_state(&json!({"hook_event_name": "SessionEnd"})).unwrap().0, "end");
        assert_eq!(claude_state(&json!({"hook_event_name": "SubagentStop"})), None);
        assert_eq!(claude_state(&json!({})), None);
    }

    #[test]
    fn project_is_the_last_directory() {
        assert_eq!(project_name(Some("/home/me/code/zoorinlooklikemac")), "zoorinlooklikemac");
    }

    #[test]
    fn messages_are_one_bounded_line() {
        assert_eq!(clean("a\tb\n\nc  d"), "a b c d");
        assert_eq!(clean(&"x".repeat(1000)).chars().count(), MESSAGE_MAX);
    }
}
