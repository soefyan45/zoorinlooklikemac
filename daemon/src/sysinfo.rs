//! System info for the notch (Pego "Bar sistem"): CPU load and temperature, memory, GPU, SSD
//! temperature, network speed and the busiest apps. Read from /proc and /sys only.
//!
//! Loads and speeds are differences between two samples: the daemon keeps the previous one, so
//! each call reports what happened since the last call (the extension asks every few seconds).

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use serde_json::{Value, json};

/// The busiest apps listed in the panel
const TOP_APPS: usize = 3;

fn read(path: impl AsRef<Path>) -> Option<String> {
    fs::read_to_string(path).ok().map(|s| s.trim().to_string())
}

fn read_num(path: impl AsRef<Path>) -> Option<f64> {
    read(path)?.parse().ok()
}

fn round1(x: f64) -> f64 {
    (x * 10.0).round() / 10.0
}

/// One reading of the counters
#[derive(Clone, Default)]
struct Sample {
    at: Option<Instant>,
    cpu_total: u64,
    cpu_idle: u64,
    /// CPU ticks used so far, per app name
    apps: HashMap<String, u64>,
    net_rx: u64,
    net_tx: u64,
    /// Time the GPU spent idle (Intel RC6), in ms
    gpu_idle_ms: Option<u64>,
}

#[derive(Default)]
pub struct Sampler {
    prev: Option<Sample>,
    model: Option<String>,
}

impl Sampler {
    pub fn has_previous(&self) -> bool {
        self.prev.is_some()
    }

    /// Take a reading and keep it, so the next snapshot measures from here
    pub fn prime(&mut self) {
        self.prev = Some(sample());
    }

    /// Everything the notch shows, as JSON
    pub fn snapshot(&mut self) -> Value {
        let now = sample();
        let prev = self.prev.replace(now.clone()).unwrap_or_default();
        let secs = match (prev.at, now.at) {
            (Some(a), Some(b)) => b.duration_since(a).as_secs_f64().max(0.05),
            _ => 1.0,
        };

        let total = now.cpu_total.saturating_sub(prev.cpu_total).max(1) as f64;
        let idle = now.cpu_idle.saturating_sub(prev.cpu_idle) as f64;
        let load = (100.0 * (1.0 - idle / total)).clamp(0.0, 100.0);

        let mut top: Vec<(String, f64)> = now
            .apps
            .iter()
            .filter_map(|(name, ticks)| {
                let used = ticks.saturating_sub(*prev.apps.get(name)?) as f64;
                (used > 0.0).then(|| (name.clone(), 100.0 * used / total))
            })
            .collect();
        top.sort_by(|a, b| b.1.total_cmp(&a.1));
        top.truncate(TOP_APPS);

        let model = self.model.get_or_insert_with(cpu_model).clone();
        json!({
            "cpu": {
                "load": round1(load),
                "temp": cpu_temp(),
                "cores": cpu_count(),
                "mhz": cpu_mhz(),
                "model": model,
            },
            "mem": memory(),
            "gpu": gpu(&prev, &now, secs),
            "ssd": ssd_temp().map(|t| json!({"temp": t})),
            "net": {
                "rx": (now.net_rx.saturating_sub(prev.net_rx) as f64 / secs).round(),
                "tx": (now.net_tx.saturating_sub(prev.net_tx) as f64 / secs).round(),
            },
            "top": top.into_iter().map(|(name, cpu)| json!({"name": name, "cpu": round1(cpu)})).collect::<Vec<_>>(),
        })
    }
}

fn sample() -> Sample {
    let (cpu_total, cpu_idle) = cpu_ticks().unwrap_or_default();
    let (net_rx, net_tx) = net_bytes();
    Sample {
        at: Some(Instant::now()),
        cpu_total,
        cpu_idle,
        apps: app_ticks(),
        net_rx,
        net_tx,
        gpu_idle_ms: intel_gpu().and_then(|card| read_num(card.join("gt/gt0/rc6_residency_ms")).map(|v| v as u64)),
    }
}

/// (all ticks, idle ticks) from the first line of /proc/stat
fn cpu_ticks() -> Option<(u64, u64)> {
    let stat = read("/proc/stat")?;
    let fields: Vec<u64> = stat.lines().next()?.split_whitespace().skip(1).take(8)
        .filter_map(|f| f.parse().ok()).collect();
    if fields.len() < 5 {
        return None;
    }
    // user nice system idle iowait irq softirq steal
    Some((fields.iter().sum(), fields[3] + fields[4]))
}

fn cpu_count() -> usize {
    read("/proc/cpuinfo").map(|s| s.lines().filter(|l| l.starts_with("processor")).count()).unwrap_or(0)
}

fn cpu_model() -> String {
    read("/proc/cpuinfo")
        .and_then(|s| s.lines().find(|l| l.starts_with("model name")).and_then(|l| l.split(':').nth(1)).map(clean_model))
        .unwrap_or_default()
}

/// "Intel(R) Core(TM) Ultra 7 155H" -> "Intel Core Ultra 7 155H"
fn clean_model(raw: &str) -> String {
    raw.replace("(R)", "").replace("(TM)", "").replace(" CPU", "")
        .split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Average clock of the cores, in MHz
fn cpu_mhz() -> Option<f64> {
    let entries = fs::read_dir("/sys/devices/system/cpu").ok()?;
    let khz: Vec<f64> = entries
        .filter_map(Result::ok)
        .filter(|e| e.file_name().to_string_lossy().strip_prefix("cpu").is_some_and(|n| n.parse::<u32>().is_ok()))
        .filter_map(|e| read_num(e.path().join("cpufreq/scaling_cur_freq")))
        .collect();
    (!khz.is_empty()).then(|| (khz.iter().sum::<f64>() / khz.len() as f64 / 1000.0).round())
}

/// hwmon devices by name: (name, directory)
fn hwmons() -> Vec<(String, PathBuf)> {
    fs::read_dir("/sys/class/hwmon").map(|entries| {
        entries.filter_map(Result::ok)
            .filter_map(|e| Some((read(e.path().join("name"))?, e.path())))
            .collect()
    }).unwrap_or_default()
}

/// A temperature input of a hwmon device in °C: the one with this label, else temp1
fn hwmon_temp(dir: &Path, label: Option<&str>) -> Option<f64> {
    if let Some(label) = label {
        for i in 1..64 {
            if read(dir.join(format!("temp{i}_label"))).as_deref() == Some(label) {
                return read_num(dir.join(format!("temp{i}_input"))).map(|m| round1(m / 1000.0));
            }
        }
    }
    read_num(dir.join("temp1_input")).map(|m| round1(m / 1000.0))
}

/// CPU package temperature: Intel coretemp, AMD k10temp or zenpower, else the ACPI zone
fn cpu_temp() -> Option<f64> {
    let mons = hwmons();
    let find = |name: &str| mons.iter().find(|(n, _)| n == name).map(|(_, dir)| dir.clone());
    if let Some(dir) = find("coretemp") {
        return hwmon_temp(&dir, Some("Package id 0"));
    }
    for (name, label) in [("k10temp", "Tctl"), ("zenpower", "Tdie"), ("cpu_thermal", "")] {
        if let Some(dir) = find(name) {
            return hwmon_temp(&dir, (!label.is_empty()).then_some(label));
        }
    }
    find("acpitz").and_then(|dir| hwmon_temp(&dir, None))
}

fn ssd_temp() -> Option<f64> {
    hwmons().into_iter().find(|(n, _)| n == "nvme").and_then(|(_, dir)| hwmon_temp(&dir, Some("Composite")))
}

/// Used and total memory in bytes
fn memory() -> Value {
    let info = read("/proc/meminfo").unwrap_or_default();
    let field = |key: &str| -> f64 {
        info.lines().find(|l| l.starts_with(key))
            .and_then(|l| l.split_whitespace().nth(1)).and_then(|v| v.parse::<f64>().ok())
            .unwrap_or(0.0) * 1024.0
    };
    let total = field("MemTotal:");
    json!({"used": total - field("MemAvailable:"), "total": total})
}

/// Received and sent bytes so far, all interfaces but loopback
fn net_bytes() -> (u64, u64) {
    let dev = read("/proc/net/dev").unwrap_or_default();
    dev.lines().skip(2).filter_map(|line| {
        let (name, rest) = line.split_once(':')?;
        if name.trim() == "lo" {
            return None;
        }
        let f: Vec<u64> = rest.split_whitespace().filter_map(|v| v.parse().ok()).collect();
        Some((*f.first()?, *f.get(8)?))
    }).fold((0, 0), |(rx, tx), (r, t)| (rx + r, tx + t))
}

/// CPU ticks used by each app (processes with the same name added up)
fn app_ticks() -> HashMap<String, u64> {
    let mut apps = HashMap::new();
    let Ok(entries) = fs::read_dir("/proc") else {
        return apps;
    };
    for entry in entries.filter_map(Result::ok) {
        if !entry.file_name().to_string_lossy().bytes().all(|b| b.is_ascii_digit()) {
            continue;
        }
        let Some(stat) = read(entry.path().join("stat")) else {
            continue;
        };
        // pid (comm) state ppid ... utime is the 14th field, stime the 15th
        let (Some(open), Some(close)) = (stat.find('('), stat.rfind(')')) else {
            continue;
        };
        let name = stat[open + 1..close].to_string();
        let fields: Vec<&str> = stat[close + 1..].split_whitespace().collect();
        let ticks = fields.get(11).and_then(|v| v.parse::<u64>().ok()).unwrap_or(0)
            + fields.get(12).and_then(|v| v.parse::<u64>().ok()).unwrap_or(0);
        *apps.entry(name).or_insert(0) += ticks;
    }
    apps
}

fn driver(card: &Path) -> Option<String> {
    fs::read_link(card.join("device/driver")).ok()
        .and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
}

/// The first DRM card driven by the given drivers
fn card_with(drivers: &[&str]) -> Option<PathBuf> {
    let entries = fs::read_dir("/sys/class/drm").ok()?;
    let mut cards: Vec<PathBuf> = entries.filter_map(Result::ok)
        .filter(|e| { let n = e.file_name().to_string_lossy().into_owned(); n.starts_with("card") && !n.contains('-') })
        .map(|e| e.path()).collect();
    cards.sort();
    cards.into_iter().find(|c| driver(c).is_some_and(|d| drivers.contains(&d.as_str())))
}

fn intel_gpu() -> Option<PathBuf> {
    card_with(&["i915", "xe"])
}

/// GPU load, temperature and clock where the driver tells: AMD reports its load and
/// temperature, Intel its clock and idle time (its load is the rest)
fn gpu(prev: &Sample, now: &Sample, secs: f64) -> Value {
    if let Some(card) = card_with(&["amdgpu"]) {
        let hwmon = fs::read_dir(card.join("device/hwmon")).ok()
            .and_then(|mut e| e.next()).and_then(Result::ok).map(|e| e.path());
        return json!({
            "name": "Radeon",
            "load": read_num(card.join("device/gpu_busy_percent")),
            "temp": hwmon.and_then(|dir| hwmon_temp(&dir, Some("edge"))),
        });
    }
    if let Some(card) = intel_gpu() {
        let load = match (prev.gpu_idle_ms, now.gpu_idle_ms) {
            (Some(a), Some(b)) => Some(round1((100.0 - (b.saturating_sub(a) as f64) / (secs * 10.0)).clamp(0.0, 100.0))),
            _ => None,
        };
        return json!({
            "name": "Intel Graphics",
            "load": load,
            "temp": Value::Null,
            "mhz": read_num(card.join("gt_act_freq_mhz")),
            "max": read_num(card.join("gt_max_freq_mhz")),
        });
    }
    Value::Null
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_names_lose_the_marks() {
        assert_eq!(clean_model(" Intel(R) Core(TM) Ultra 7 155H"), "Intel Core Ultra 7 155H");
        assert_eq!(clean_model("AMD Ryzen 7 5800H with Radeon Graphics"), "AMD Ryzen 7 5800H with Radeon Graphics");
    }

    #[test]
    fn a_snapshot_has_every_part() {
        let mut sampler = Sampler::default();
        sampler.prime();
        let snap = sampler.snapshot();
        let load = snap["cpu"]["load"].as_f64().unwrap();
        assert!((0.0..=100.0).contains(&load));
        assert!(snap["cpu"]["cores"].as_u64().unwrap() > 0);
        assert!(snap["mem"]["total"].as_f64().unwrap() > snap["mem"]["used"].as_f64().unwrap());
        assert!(snap["net"]["rx"].as_f64().unwrap() >= 0.0);
        assert!(snap["top"].as_array().unwrap().len() <= TOP_APPS);
    }
}
