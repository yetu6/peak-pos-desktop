use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

#[derive(serde::Deserialize)]
pub struct PrintDocument {
    pub title: String,
    pub text: String,
}

#[derive(serde::Deserialize)]
pub struct KitchenTicket {
    pub text: String,
}

/// Sends a Peak document to the OS printer. This command never talks to Peak:
/// a missing printer is a device failure, not an unsend or a payment change.
#[tauri::command]
pub fn print_document(document: PrintDocument) -> Result<(), String> {
    let body = document.text.trim();
    if body.is_empty() {
        return Err("Print document is empty".to_string());
    }
    let title = document.title.trim();
    send_to_os_printer(if title.is_empty() { "peak-document" } else { title }, body)
}

/// Compatibility wrapper for kitchen tickets. New callers use print_document.
#[tauri::command]
pub fn print_kitchen_ticket(ticket: KitchenTicket) -> Result<(), String> {
    print_document(PrintDocument {
        title: "peak-kitchen-ticket".to_string(),
        text: ticket.text,
    })
}

#[derive(serde::Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrinterStatus {
    pub available: bool,
    pub name: Option<String>,
}

/// Reports whether `lp` is on PATH and which printer Peak will use.
/// This does not print a page.
#[tauri::command]
pub fn printer_status() -> PrinterStatus {
    PrinterStatus {
        available: printer_is_available(),
        name: configured_printer_name(),
    }
}

pub(crate) fn printer_is_available() -> bool {
    which("lp").is_some()
}

pub(crate) fn configured_printer_name() -> Option<String> {
    std::env::var("PEAK_PRINTER")
        .ok()
        .or_else(|| std::env::var("PEAK_KITCHEN_PRINTER").ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn send_to_os_printer(title: &str, body: &str) -> Result<(), String> {
    let lp = which("lp").ok_or_else(|| "No kitchen printer is configured".to_string())?;
    let printer = configured_printer_name();

    let mut command = Command::new(lp);
    command.arg("-t").arg(title);
    if let Some(name) = printer {
        command.arg("-d").arg(name);
    }
    command.stdin(Stdio::piped());
    command.stdout(Stdio::null());
    command.stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|_| "No kitchen printer is configured".to_string())?;
    {
        let stdin = child
            .stdin
            .as_mut()
            .ok_or_else(|| "No kitchen printer is configured".to_string())?;
        stdin
            .write_all(body.as_bytes())
            .map_err(|err| format!("Printer write failed: {err}"))?;
        stdin
            .write_all(b"\n")
            .map_err(|err| format!("Printer write failed: {err}"))?;
    }
    let output = child
        .wait_with_output()
        .map_err(|err| format!("Printer wait failed: {err}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let detail = stderr.trim();
        if detail.is_empty() {
            return Err("No kitchen printer is configured".to_string());
        }
        return Err(format!("Print failed: {detail}"));
    }
    Ok(())
}

fn which(binary: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).find_map(|dir| {
        let candidate = dir.join(binary);
        candidate.is_file().then_some(candidate)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn fake_lp_dir(script: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("peak-lp-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let lp = dir.join("lp");
        fs::write(&lp, script).unwrap();
        let mut perms = fs::metadata(&lp).unwrap().permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&lp, perms).unwrap();
        dir
    }

    #[test]
    fn print_document_writes_title_and_body_to_lp_stdin() {
        let _guard = ENV_LOCK.lock().unwrap();
        let spool = std::env::temp_dir().join(format!("peak-spool-{}.txt", std::process::id()));
        let _ = fs::remove_file(&spool);
        let dir = fake_lp_dir(&format!(
            "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"{spool}\"\ncat >> \"{spool}\"\n",
            spool = spool.display()
        ));
        let original = std::env::var("PATH").unwrap();
        std::env::set_var("PATH", format!("{}:{original}", dir.display()));
        std::env::remove_var("PEAK_PRINTER");
        std::env::remove_var("PEAK_KITCHEN_PRINTER");

        print_document(PrintDocument {
            title: "peak-kitchen-ticket".to_string(),
            text: "KITCHEN TICKET\nKT-1".to_string(),
        })
        .expect("print");

        let captured = fs::read_to_string(&spool).unwrap();
        assert!(captured.contains("-t"));
        assert!(captured.contains("peak-kitchen-ticket"));
        assert!(captured.contains("KITCHEN TICKET"));
        assert!(captured.contains("KT-1"));

        std::env::set_var("PATH", original);
        let _ = fs::remove_file(&spool);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_lp_is_a_device_failure() {
        let _guard = ENV_LOCK.lock().unwrap();
        let original = std::env::var("PATH").unwrap();
        std::env::set_var("PATH", "/tmp/peak-no-lp");
        let error = print_document(PrintDocument {
            title: "x".to_string(),
            text: "body".to_string(),
        })
        .unwrap_err();
        assert_eq!(error, "No kitchen printer is configured");
        std::env::set_var("PATH", original);
    }

    #[test]
    fn printer_status_reports_missing_lp_without_printing() {
        let _guard = ENV_LOCK.lock().unwrap();
        let original = std::env::var("PATH").unwrap();
        std::env::set_var("PATH", "/tmp/peak-no-lp");
        std::env::remove_var("PEAK_PRINTER");
        std::env::remove_var("PEAK_KITCHEN_PRINTER");
        let status = printer_status();
        assert!(!status.available);
        assert!(status.name.is_none());
        std::env::set_var("PATH", original);
    }

    #[test]
    fn printer_status_reports_the_configured_name() {
        let _guard = ENV_LOCK.lock().unwrap();
        let dir = fake_lp_dir("#!/bin/sh\nexit 0\n");
        let original = std::env::var("PATH").unwrap();
        std::env::set_var("PATH", format!("{}:{original}", dir.display()));
        std::env::set_var("PEAK_PRINTER", "front-bar");
        std::env::remove_var("PEAK_KITCHEN_PRINTER");
        let status = printer_status();
        assert!(status.available);
        assert_eq!(status.name.as_deref(), Some("front-bar"));
        std::env::set_var("PATH", original);
        std::env::remove_var("PEAK_PRINTER");
        let _ = fs::remove_dir_all(&dir);
    }
}
