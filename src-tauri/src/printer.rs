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
    send_to_os_printer(
        if title.is_empty() {
            "yetu-document"
        } else {
            title
        },
        body,
    )
}

/// Compatibility wrapper for kitchen tickets. New callers use print_document.
#[tauri::command]
pub fn print_kitchen_ticket(ticket: KitchenTicket) -> Result<(), String> {
    print_document(PrintDocument {
        title: "yetu-kitchen-ticket".to_string(),
        text: ticket.text,
    })
}

#[derive(serde::Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrinterStatus {
    pub available: bool,
    pub name: Option<String>,
}

/// Reports whether a local print path exists and which printer Peak will use.
/// This does not print a page.
#[tauri::command]
pub fn printer_status() -> PrinterStatus {
    PrinterStatus {
        available: printer_is_available(),
        name: configured_printer_name(),
    }
}

/// Sends a one-page Diagnostics test to the OS printer.
#[tauri::command]
pub fn print_test_page() -> Result<(), String> {
    let name = configured_printer_name().unwrap_or_else(|| "default".to_string());
    let body = format!(
        "YETU POS — printer test\nPrinter: {name}\nIf you can read this, the till can print.\n"
    );
    send_to_os_printer("yetu-printer-test", &body)
}

pub(crate) fn printer_is_available() -> bool {
    #[cfg(windows)]
    {
        which("powershell").is_some() || which("powershell.exe").is_some()
    }
    #[cfg(not(windows))]
    {
        which("lp").is_some()
    }
}

pub(crate) fn configured_printer_name() -> Option<String> {
    std::env::var("PEAK_PRINTER")
        .ok()
        .or_else(|| std::env::var("PEAK_KITCHEN_PRINTER").ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn send_to_os_printer(title: &str, body: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        send_windows(title, body)
    }
    #[cfg(not(windows))]
    {
        send_unix_lp(title, body)
    }
}

#[cfg(not(windows))]
fn send_unix_lp(title: &str, body: &str) -> Result<(), String> {
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

#[cfg(windows)]
fn send_windows(title: &str, body: &str) -> Result<(), String> {
    let dir = std::env::temp_dir();
    let safe_title: String = title
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let path = dir.join(format!(
        "yetu-print-{safe_title}-{}.txt",
        std::process::id()
    ));
    std::fs::write(&path, format!("{body}\n"))
        .map_err(|err| format!("Printer write failed: {err}"))?;

    let path_display = path.display().to_string().replace('\'', "''");
    let printer = configured_printer_name();
    let script = if let Some(name) = printer {
        let printer_name = name.replace('\'', "''");
        format!("Get-Content -LiteralPath '{path_display}' | Out-Printer -Name '{printer_name}'")
    } else {
        format!("Get-Content -LiteralPath '{path_display}' | Out-Printer")
    };

    let powershell = which("powershell")
        .or_else(|| which("powershell.exe"))
        .ok_or_else(|| "No kitchen printer is configured".to_string())?;

    let output = Command::new(powershell)
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|_| "No kitchen printer is configured".to_string())?;

    let _ = std::fs::remove_file(&path);

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
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[cfg(unix)]
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

    #[cfg(unix)]
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

    #[cfg(unix)]
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

    #[cfg(unix)]
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

    #[cfg(unix)]
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

    #[test]
    fn empty_document_is_rejected() {
        let error = print_document(PrintDocument {
            title: "x".to_string(),
            text: "   ".to_string(),
        })
        .unwrap_err();
        assert_eq!(error, "Print document is empty");
    }
}

// ------------------------------------------------------------------ raw printing (S8a)

/// A printer as the till's settings name it (src/print/printerSettings.ts).
#[derive(serde::Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum PrintTarget {
    System { name: String },
    Network { host: String, port: u16 },
}

impl From<PrintTarget> for crate::raw_print::RawTarget {
    fn from(target: PrintTarget) -> Self {
        match target {
            PrintTarget::System { name } => crate::raw_print::RawTarget::System { name },
            PrintTarget::Network { host, port } => {
                crate::raw_print::RawTarget::Network { host, port }
            }
        }
    }
}

/// Sends a ticket the till laid out (ESC/POS) to a thermal printer, as it is.
/// Like every print here, a failure is the device's: never an unsend.
#[tauri::command]
pub fn print_raw(target: PrintTarget, bytes: Vec<u8>) -> Result<(), String> {
    crate::raw_print::print_raw(&target.into(), &bytes)
}

/// The printers this computer knows, for choosing a kitchen or bar printer.
#[tauri::command]
pub fn list_printers() -> Vec<String> {
    crate::raw_print::list_system_printers()
}

const PRINTER_SETTINGS_FILE: &str = "printers.json";

fn printer_settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    let dir = app.path().app_config_dir().map_err(|err| err.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    Ok(dir.join(PRINTER_SETTINGS_FILE))
}

/// This till's printer settings, as last saved; none before the first save.
#[tauri::command]
pub fn load_printer_settings(app: tauri::AppHandle) -> Result<Option<serde_json::Value>, String> {
    let path = printer_settings_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let raw = std::fs::read_to_string(path).map_err(|err| err.to_string())?;
    Ok(serde_json::from_str(raw.trim()).ok())
}

/// Every printer named in the settings (the kitchen's and each station's).
fn saved_targets(settings: &serde_json::Value) -> Result<Vec<crate::raw_print::RawTarget>, String> {
    let bad = || "Those printer settings couldn't be read. Choose the printers again.".to_string();
    let mut choices = Vec::new();
    match settings.get("kitchen") {
        None | Some(serde_json::Value::Null) => {}
        Some(choice) => choices.push(choice),
    }
    match settings.get("stations") {
        None | Some(serde_json::Value::Null) => {}
        Some(serde_json::Value::Object(stations)) => choices.extend(stations.values()),
        Some(_) => return Err(bad()),
    }
    choices
        .into_iter()
        .map(|choice| {
            let target = choice.get("target").cloned().ok_or_else(bad)?;
            serde_json::from_value::<PrintTarget>(target)
                .map(Into::into)
                .map_err(|_| bad())
        })
        .collect()
}

/// Saves this till's printer settings, each printer checked first: a printer
/// in this building on a printing port, never an address elsewhere.
#[tauri::command]
pub fn save_printer_settings(
    app: tauri::AppHandle,
    settings: serde_json::Value,
) -> Result<(), String> {
    if !settings.is_object() {
        return Err(
            "Those printer settings couldn't be read. Choose the printers again.".to_string(),
        );
    }
    for target in saved_targets(&settings)? {
        crate::raw_print::check_saved_target(&target)?;
    }
    let path = printer_settings_path(&app)?;
    let mut file = std::fs::File::create(&path).map_err(|err| err.to_string())?;
    file.write_all(settings.to_string().as_bytes())
        .map_err(|err| format!("The printer settings couldn't be saved: {err}"))
}
