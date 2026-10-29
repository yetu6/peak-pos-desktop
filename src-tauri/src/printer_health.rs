//! Whether a system printer can really print now. Windows lists a switched-off
//! printer as fine and queues its jobs without a word, so Status asks for the
//! printer's own state and for jobs waiting in Windows' queue.

use std::process::Stdio;

/// Named setting: a job that has waited this many minutes in the queue is stuck, not printing.
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
pub const STUCK_AFTER_MINUTES: u32 = 3;

#[derive(serde::Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrinterHealth {
    /// "ready", "offline", "paper-out", "problem" or "unknown".
    pub state: String,
    /// What the system called a problem (for example "PaperJam"), when it did.
    pub detail: Option<String>,
    /// Jobs waiting longer than STUCK_AFTER_MINUTES.
    pub stuck_jobs: u32,
}

fn health(state: &str, detail: Option<String>, stuck_jobs: u32) -> PrinterHealth {
    PrinterHealth { state: state.to_string(), detail, stuck_jobs }
}

/// The printer's state from Windows' PrinterStatus (and WorkOffline), as words the app knows.
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
fn windows_state(status: &str, work_offline: bool) -> (&'static str, Option<String>) {
    if work_offline {
        return ("offline", None);
    }
    match status.trim().to_ascii_lowercase().as_str() {
        "normal" | "idle" | "busy" | "printing" | "processing" | "waiting" | "initializing" | "warmingup" | "powersave"
        | "ioactive" | "tonerlow" | "manualfeed" => ("ready", None),
        "offline" | "notavailable" => ("offline", None),
        "paperout" => ("paper-out", None),
        "paperjam" | "paperproblem" | "error" | "dooropen" | "userintervention" | "notoner" | "outputbinfull"
        | "paused" | "outofmemory" | "pagepunt" | "pendingdeletion" => ("problem", Some(status.trim().to_string())),
        _ => ("unknown", None),
    }
}

/// Parses what the Windows script printed: {"status":"Normal","workOffline":false,"jobs":2,"oldestSeconds":400}.
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
pub fn parse_windows(json: &str) -> PrinterHealth {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(json.trim()) else {
        return health("unknown", None, 0);
    };
    let status = value.get("status").and_then(|v| v.as_str()).unwrap_or("");
    let work_offline = value.get("workOffline").and_then(|v| v.as_bool()).unwrap_or(false);
    let jobs = value.get("jobs").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
    let oldest_seconds = value.get("oldestSeconds").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
    let stuck = if jobs > 0 && oldest_seconds >= STUCK_AFTER_MINUTES * 60 { jobs } else { 0 };
    if status.is_empty() && !work_offline {
        return health("unknown", None, stuck);
    }
    let (state, detail) = windows_state(status, work_offline);
    health(state, detail, stuck)
}

/// Parses `lpstat -p <name>`: "printer X is idle.  enabled since ..." or "printer X disabled since ...".
pub fn parse_lpstat(text: &str) -> PrinterHealth {
    let lower = text.to_ascii_lowercase();
    if lower.contains("disabled") {
        health("offline", None, 0)
    } else if lower.contains(" is idle") || lower.contains("now printing") || lower.contains("is processing") {
        health("ready", None, 0)
    } else {
        health("unknown", None, 0)
    }
}

/// Fixed script text: the printer's name arrives as $env:YETU_PRINTER_NAME.
#[allow(dead_code)]
pub(crate) const WINDOWS_HEALTH_SCRIPT: &str = "$p = Get-Printer -Name $env:YETU_PRINTER_NAME -ErrorAction Stop; \
$w = $false; if ($p.PSObject.Properties['WorkOffline']) { $w = [bool]$p.WorkOffline }; \
$j = @(Get-PrintJob -PrinterName $env:YETU_PRINTER_NAME -ErrorAction SilentlyContinue); \
$age = 0; if ($j.Count -gt 0) { $first = ($j | Measure-Object -Property SubmittedTime -Minimum).Minimum; $age = [int][Math]::Max(0, ((Get-Date) - $first).TotalSeconds) }; \
[pscustomobject]@{ status = [string]$p.PrinterStatus; workOffline = $w; jobs = $j.Count; oldestSeconds = $age } | ConvertTo-Json -Compress";

#[cfg(windows)]
fn check(name: &str) -> PrinterHealth {
    let output = crate::quiet::powershell_script(
        "powershell",
        WINDOWS_HEALTH_SCRIPT,
        &[(crate::quiet::ENV_PRINTER_NAME, std::ffi::OsStr::new(name))],
    )
    .stdin(Stdio::null())
    .stderr(Stdio::null())
    .output();
    match output {
        Ok(out) if out.status.success() => parse_windows(&String::from_utf8_lossy(&out.stdout)),
        _ => health("unknown", None, 0),
    }
}

#[cfg(not(windows))]
fn check(name: &str) -> PrinterHealth {
    let output = crate::quiet::command("lpstat")
        .args(["-p", name])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output();
    match output {
        Ok(out) if out.status.success() => parse_lpstat(&String::from_utf8_lossy(&out.stdout)),
        _ => health("unknown", None, 0),
    }
}

/// How a system printer is doing right now. Never prints; never an unsend.
#[tauri::command]
pub fn printer_health(name: String) -> Result<PrinterHealth, String> {
    crate::raw_print::require_known_printer(&name)?;
    Ok(check(&name))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn windows(status: &str, offline: bool, jobs: u32, oldest: u32) -> PrinterHealth {
        parse_windows(&format!(
            r#"{{"status":"{status}","workOffline":{offline},"jobs":{jobs},"oldestSeconds":{oldest}}}"#
        ))
    }

    #[test]
    fn a_normal_printer_with_nothing_waiting_is_ready() {
        assert_eq!(windows("Normal", false, 0, 0), health("ready", None, 0));
    }

    #[test]
    fn an_offline_printer_is_offline_by_status_or_by_work_offline() {
        assert_eq!(windows("Offline", false, 0, 0).state, "offline");
        assert_eq!(windows("Normal", true, 0, 0).state, "offline");
    }

    #[test]
    fn paper_out_and_other_problems_are_named() {
        assert_eq!(windows("PaperOut", false, 0, 0).state, "paper-out");
        assert_eq!(windows("PaperJam", false, 0, 0), health("problem", Some("PaperJam".into()), 0));
    }

    #[test]
    fn old_jobs_are_stuck_and_a_job_being_printed_now_is_not() {
        assert_eq!(windows("Normal", false, 3, STUCK_AFTER_MINUTES * 60).stuck_jobs, 3);
        assert_eq!(windows("Normal", false, 3, STUCK_AFTER_MINUTES * 60 - 1).stuck_jobs, 0);
        assert_eq!(windows("Normal", false, 0, 9999).stuck_jobs, 0);
    }

    #[test]
    fn an_unknown_or_missing_status_is_never_ready() {
        assert_eq!(windows("SomethingNew", false, 0, 0).state, "unknown");
        assert_eq!(parse_windows("").state, "unknown");
        assert_eq!(parse_windows("not json").state, "unknown");
        assert_eq!(parse_windows(r#"{"jobs":0}"#).state, "unknown");
    }

    #[test]
    fn lpstat_idle_is_ready_disabled_is_offline_anything_else_unknown() {
        assert_eq!(parse_lpstat("printer EPSON is idle.  enabled since Mon 26 Oct").state, "ready");
        assert_eq!(parse_lpstat("printer EPSON now printing EPSON-12.  enabled since x").state, "ready");
        assert_eq!(parse_lpstat("printer EPSON disabled since Mon 26 Oct -\n\treason unknown").state, "offline");
        assert_eq!(parse_lpstat("").state, "unknown");
    }
}
