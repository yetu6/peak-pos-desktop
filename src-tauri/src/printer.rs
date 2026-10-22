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
        "YETU POS — printer test\nPrinter: {name}\nIf you can read this, the till can print.\n\n               Powered by Yetu-FBC\n"
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
    let lp = which("lp").ok_or_else(|| "No printer is set up on this till".to_string())?;
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
        .map_err(|_| "No printer is set up on this till".to_string())?;
    {
        let stdin = child
            .stdin
            .as_mut()
            .ok_or_else(|| "No printer is set up on this till".to_string())?;
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
            return Err("No printer is set up on this till".to_string());
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
        .ok_or_else(|| "No printer is set up on this till".to_string())?;

    let output = Command::new(powershell)
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|_| "No printer is set up on this till".to_string())?;

    let _ = std::fs::remove_file(&path);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let detail = stderr.trim();
        if detail.is_empty() {
            return Err("No printer is set up on this till".to_string());
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
        assert_eq!(error, "No printer is set up on this till");
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
#[derive(serde::Deserialize, serde::Serialize, Clone)]
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
    for key in ["kitchen", "receipt"] {
        match settings.get(key) {
            None | Some(serde_json::Value::Null) => {}
            Some(choice) => choices.push(choice),
        }
    }
    match settings.get("stations") {
        None | Some(serde_json::Value::Null) => {}
        // "none": no paper for that station; nothing to check.
        Some(serde_json::Value::Object(stations)) => choices.extend(
            stations
                .values()
                .filter(|value| value.as_str() != Some("none")),
        ),
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

#[cfg(test)]
mod durable_tests {
    use super::*;
    #[test]
    fn network_journal_sends_once_and_probes_after_restart_without_offline_authority() {
        use crate::local_store::{DbKeyStore, DbKeyStoreError, LocalStore};
        use std::io::Read;
        struct Keys(std::sync::Mutex<Option<String>>);
        impl DbKeyStore for Keys {
            fn load(&self) -> Result<Option<String>, DbKeyStoreError> {
                Ok(self.0.lock().unwrap().clone())
            }
            fn save(&self, s: &str) -> Result<(), DbKeyStoreError> {
                *self.0.lock().unwrap() = Some(s.into());
                Ok(())
            }
        }
        let dir = tempfile::tempdir().unwrap();
        let keys = Keys(Default::default());
        let mut store = LocalStore::open(&dir.path().join("print.sqlite3"), &keys).unwrap();
        let scope = PrintScope {
            property_id: "property".into(),
            outlet_id: "outlet".into(),
            terminal_id: "terminal".into(),
        };
        let listener = std::net::TcpListener::bind("127.0.0.1:9100").unwrap();
        let receive = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut bytes = vec![];
            socket.read_to_end(&mut bytes).unwrap();
            listener.set_nonblocking(true).unwrap();
            (listener, bytes)
        });
        let paper = || JournalPaper::Thermal {
            target: PrintTarget::Network {
                host: "127.0.0.1".into(),
                port: 9100,
            },
            bytes: b"KITCHEN ORDER\n2 x Rice\n".to_vec(),
        };
        assert!(print_once(&mut store, "job", &scope, 1, false, paper()).is_err());
        assert!(store.inspect_print("job", &scope).unwrap().is_none());
        assert_eq!(
            print_once(&mut store, "job", &scope, 1, true, paper())
                .unwrap()
                .state,
            "accepted"
        );
        let (listener, bytes) = receive.join().unwrap();
        assert_eq!(bytes, b"KITCHEN ORDER\n2 x Rice\n");
        drop(store);
        let mut store = LocalStore::open(&dir.path().join("print.sqlite3"), &keys).unwrap();
        assert_eq!(
            store.inspect_print("job", &scope).unwrap().unwrap().state,
            "ACCEPTED"
        );
        assert_eq!(
            print_once(&mut store, "job", &scope, 2, true, paper())
                .unwrap()
                .state,
            "accepted"
        );
        assert!(listener.accept().is_err(), "accepted job reconnected");
        // Simulate process death at the boundary after transport but before acceptance.
        store
            .reserve_print_attempt("ambiguous", &scope, "r", "p", 1)
            .unwrap();
        store
            .mark_print("ambiguous", &scope, 1, "RESERVED", "UNKNOWN", None)
            .unwrap();
        // Actual transport succeeds, then the process loses its chance to mark
        // acceptance. The restart must retain UNKNOWN and send no second copy.
        assert!(send_journal_paper(paper()).is_ok());
        let (mut delivered, _) = listener.accept().unwrap();
        let mut delivered_bytes = Vec::new();
        delivered.read_to_end(&mut delivered_bytes).unwrap();
        assert_eq!(delivered_bytes, b"KITCHEN ORDER\n2 x Rice\n");
        drop(delivered);
        drop(store);
        let mut store = LocalStore::open(&dir.path().join("print.sqlite3"), &keys).unwrap();
        assert_eq!(
            print_once(&mut store, "ambiguous", &scope, 2, true, paper())
                .unwrap()
                .state,
            "unknown"
        );
        assert!(listener.accept().is_err(), "unknown job reconnected");
        drop(listener);
        assert_eq!(
            print_once(&mut store, "refused", &scope, 1, true, paper())
                .unwrap()
                .state,
            "not_sent"
        );
        assert_eq!(
            store
                .inspect_print("refused", &scope)
                .unwrap()
                .unwrap()
                .state,
            "NOT_SENT"
        );
        // Same failed attempt cannot transport; a newly claimed attempt can.
        let listener = std::net::TcpListener::bind("127.0.0.1:9100").unwrap();
        listener.set_nonblocking(true).unwrap();
        assert_eq!(
            print_once(
                &mut store,
                "refused",
                &scope,
                1,
                true,
                JournalPaper::System {
                    title: String::new(),
                    text: String::new()
                }
            )
            .unwrap()
            .state,
            "not_sent",
            "same-attempt failed acknowledgement recovery must ignore changed printer settings"
        );
        assert_eq!(
            print_once(&mut store, "refused", &scope, 1, true, paper())
                .unwrap()
                .state,
            "not_sent"
        );
        assert!(listener.accept().is_err());
        listener.set_nonblocking(false).unwrap();
        let receive = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut got = vec![];
            socket.read_to_end(&mut got).unwrap();
            got
        });
        assert_eq!(
            print_once(&mut store, "refused", &scope, 2, true, paper())
                .unwrap()
                .state,
            "accepted"
        );
        assert_eq!(receive.join().unwrap(), b"KITCHEN ORDER\n2 x Rice\n");
        // A durable reservation (no dispatch) may resume exactly once.
        let original = paper();
        let (route, payload) = match &original {
            JournalPaper::Thermal { target, bytes } => {
                (hash(&serde_json::to_vec(target).unwrap()), hash(bytes))
            }
            _ => unreachable!(),
        };
        store
            .reserve_print_attempt("reserved", &scope, &route, &payload, 1)
            .unwrap();
        let listener = std::net::TcpListener::bind("127.0.0.1:9100").unwrap();
        let receive = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut got = vec![];
            socket.read_to_end(&mut got).unwrap();
            got
        });
        assert_eq!(
            print_once(&mut store, "reserved", &scope, 1, true, original)
                .unwrap()
                .state,
            "accepted"
        );
        assert_eq!(receive.join().unwrap(), b"KITCHEN ORDER\n2 x Rice\n");
        // Accepted evidence wins even when current settings/payload are invalid.
        assert_eq!(
            print_once(
                &mut store,
                "reserved",
                &scope,
                2,
                true,
                JournalPaper::System {
                    title: String::new(),
                    text: String::new()
                }
            )
            .unwrap()
            .state,
            "accepted"
        );
        // Real partial transport: receiver closes after taking a prefix. The
        // payload exceeds TCP's send buffer so write_all observes the closure.
        let listener = std::net::TcpListener::bind("127.0.0.1:9100").unwrap();
        let receive = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut prefix = [0u8; 1];
            socket.read_exact(&mut prefix).unwrap();
            socket.shutdown(std::net::Shutdown::Both).unwrap();
            prefix
        });
        let partial = JournalPaper::Thermal {
            target: PrintTarget::Network {
                host: "127.0.0.1".into(),
                port: 9100,
            },
            bytes: vec![42; MAX_PRINT_PAYLOAD_BYTES],
        };
        assert_eq!(
            print_once(&mut store, "partial", &scope, 1, true, partial)
                .unwrap()
                .state,
            "unknown"
        );
        assert_eq!(receive.join().unwrap(), [42]);
        assert_eq!(
            store
                .inspect_print("partial", &scope)
                .unwrap()
                .unwrap()
                .state,
            "UNKNOWN"
        );
        // The journal transport preserves the original raw target guards.
        let other = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        other.set_nonblocking(true).unwrap();
        let port = other.local_addr().unwrap().port();
        assert!(!crate::raw_print::RAW_PORTS.contains(&port));
        assert!(matches!(
            send_journal_network("127.0.0.1", port, b"x"),
            Err(TransportFailure::NotSent(_))
        ));
        assert!(
            other.accept().is_err(),
            "connected outside the printer port range"
        );
        let nonlocal = std::net::TcpListener::bind("0.0.0.0:9100").unwrap();
        nonlocal.set_nonblocking(true).unwrap();
        assert!(matches!(
            send_journal_network("0.0.0.0", 9100, b"x"),
            Err(TransportFailure::NotSent(_))
        ));
        assert!(
            nonlocal.accept().is_err(),
            "connected to a disallowed resolved address"
        );
    }
}

use crate::local_store::{
    print_journal::{PrintAttempt, PrintScope},
    runtime::LocalStoreRuntime,
    LocalStore, LocalStoreError,
};
use sha2::{Digest, Sha256};

#[derive(serde::Deserialize, serde::Serialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum JournalPaper {
    Thermal { target: PrintTarget, bytes: Vec<u8> },
    System { title: String, text: String },
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativePrintResult {
    job_id: String,
    attempt: i64,
    state: &'static str,
    message: Option<String>,
    route_hash: String,
    payload_hash: String,
}
impl From<PrintAttempt> for NativePrintResult {
    fn from(v: PrintAttempt) -> Self {
        let (state, message) = match v.state.as_str() {
            "ACCEPTED" => ("accepted", None),
            "UNKNOWN" => (
                "unknown",
                Some(
                    "Check the printer before printing a copy. The paper may already have printed."
                        .into(),
                ),
            ),
            _ => ("not_sent", v.error),
        };
        Self {
            job_id: v.job_key,
            attempt: v.attempt,
            state,
            message,
            route_hash: v.route_hash,
            payload_hash: v.payload_hash,
        }
    }
}

/// Probe before rebuilding paper or consulting current printer settings.
#[tauri::command]
pub fn get_print_attempt(
    runtime: tauri::State<'_, LocalStoreRuntime>,
    scope: PrintScope,
    job_id: String,
) -> Result<Option<NativePrintResult>, String> {
    runtime
        .with_store(|store| {
            store
                .inspect_print(&job_id, &scope)
                .map(|v| v.map(Into::into))
        })
        .map_err(|e| format!("Print journal unavailable: {e:?}"))
}

/// The server still authenticates/authorizes/claims the job. This assertion is
/// evidence from that flow, never an offline PIN or a grant of server authority.
#[tauri::command]
pub fn print_job_once(
    runtime: tauri::State<'_, LocalStoreRuntime>,
    scope: PrintScope,
    job_id: String,
    attempt: i64,
    confirmed_backend_claim: bool,
    paper: JournalPaper,
) -> Result<NativePrintResult, String> {
    runtime
        .with_store(|store| {
            print_once(
                store,
                &job_id,
                &scope,
                attempt,
                confirmed_backend_claim,
                paper,
            )
        })
        .map_err(|e| format!("Print journal refused the request: {e:?}"))
}

const MAX_PRINT_PAYLOAD_BYTES: usize = 4 * 1024 * 1024;
fn hash(data: &[u8]) -> String {
    Sha256::digest(data)
        .iter()
        .map(|v| format!("{v:02x}"))
        .collect()
}

fn print_once(
    store: &mut LocalStore,
    key: &str,
    scope: &PrintScope,
    attempt: i64,
    confirmed_claim: bool,
    paper: JournalPaper,
) -> Result<NativePrintResult, LocalStoreError> {
    if !confirmed_claim || attempt < 1 {
        return Err(LocalStoreError::OperationNotAllowed);
    }
    if let Some(old) = store.inspect_print(key, scope)? {
        // These outcomes are independent of today's route/payload/settings.
        if matches!(old.state.as_str(), "ACCEPTED" | "UNKNOWN")
            || (old.state == "NOT_SENT" && old.attempt == attempt)
        {
            // Same-attempt NOT_SENT only recovers the failed acknowledgement;
            // today's settings must not rewrite its original evidence.
            return Ok(old.into());
        }
    }
    let (route, payload) = match &paper {
        JournalPaper::Thermal { target, bytes } => {
            if bytes.is_empty() || bytes.len() > MAX_PRINT_PAYLOAD_BYTES {
                return Err(LocalStoreError::OperationNotAllowed);
            }
            crate::raw_print::check_saved_target(&target.clone().into())
                .map_err(|_| LocalStoreError::OperationNotAllowed)?;
            (
                serde_json::to_vec(target).map_err(|_| LocalStoreError::OperationNotAllowed)?,
                bytes.clone(),
            )
        }
        JournalPaper::System { title, text } => {
            if text.trim().is_empty() || text.len() > MAX_PRINT_PAYLOAD_BYTES || title.len() > 256 {
                return Err(LocalStoreError::OperationNotAllowed);
            }
            (
                serde_json::to_vec(&("system", configured_printer_name()))
                    .map_err(|_| LocalStoreError::OperationNotAllowed)?,
                serde_json::to_vec(&(title, text))
                    .map_err(|_| LocalStoreError::OperationNotAllowed)?,
            )
        }
    };
    let reserved =
        store.reserve_print_attempt(key, scope, &hash(&route), &hash(&payload), attempt)?;
    if reserved.state != "RESERVED" {
        return Ok(reserved.into());
    }
    // FULL-synchronous WAL commit BEFORE any transport. Death after this point
    // is ambiguous; even death after success but before acceptance never resends.
    store.mark_print(key, scope, reserved.attempt, "RESERVED", "UNKNOWN", None)?;
    match send_journal_paper(paper) {
        Ok(()) => store
            .mark_print(key, scope, reserved.attempt, "UNKNOWN", "ACCEPTED", None)
            .map(Into::into),
        Err(TransportFailure::NotSent(message)) => store
            .mark_print(
                key,
                scope,
                reserved.attempt,
                "UNKNOWN",
                "NOT_SENT",
                Some(&message),
            )
            .map(Into::into),
        Err(TransportFailure::Unknown) => Ok(store
            .inspect_print(key, scope)?
            .ok_or(LocalStoreError::IntegrityFailure)?
            .into()),
    }
}

enum TransportFailure {
    NotSent(String),
    Unknown,
}
fn send_journal_paper(paper: JournalPaper) -> Result<(), TransportFailure> {
    match paper {
        JournalPaper::Thermal {
            target: PrintTarget::Network { host, port },
            bytes,
        } => send_journal_network(&host, port, &bytes),
        JournalPaper::Thermal { target, bytes } => {
            // The existing OS raw path may have handed bytes to its spooler on
            // failure. Conservatively ambiguous; never infer no-send from text.
            crate::raw_print::print_raw(&target.into(), &bytes)
                .map_err(|_| TransportFailure::Unknown)
        }
        JournalPaper::System { title, text } => {
            if !printer_is_available() {
                return Err(TransportFailure::NotSent(
                    "No printer is set up on this till".into(),
                ));
            }
            send_to_os_printer(&title, text.trim()).map_err(|_| TransportFailure::Unknown)
        }
    }
}

fn send_journal_network(host: &str, port: u16, bytes: &[u8]) -> Result<(), TransportFailure> {
    use crate::raw_print::{check_target, is_local_address, RawTarget, NETWORK_TIMEOUT};
    use std::net::{TcpStream, ToSocketAddrs};
    let not_sent = |message: String| TransportFailure::NotSent(message);
    check_target(&RawTarget::Network {
        host: host.into(),
        port,
    })
    .map_err(not_sent)?;
    let addrs: Vec<_> = (host, port)
        .to_socket_addrs()
        .map_err(|_| not_sent("The printer address could not be found.".into()))?
        .collect();
    // Check ALL resolved addresses before connecting, preserving DNS guards.
    if addrs.is_empty() || !addrs.iter().all(|a| is_local_address(a.ip())) {
        return Err(not_sent(
            "That printer is not on this building's network.".into(),
        ));
    }
    for address in addrs {
        if let Ok(mut stream) = TcpStream::connect_timeout(&address, NETWORK_TIMEOUT) {
            stream
                .set_write_timeout(Some(NETWORK_TIMEOUT))
                .map_err(|_| not_sent("The printer connection could not be prepared.".into()))?;
            // Once write is attempted an error may represent a partial send.
            stream
                .write_all(bytes)
                .map_err(|_| TransportFailure::Unknown)?;
            stream.flush().map_err(|_| TransportFailure::Unknown)?;
            let _ = stream.shutdown(std::net::Shutdown::Write);
            return Ok(());
        }
    }
    Err(not_sent(
        "The printer did not answer. Check its power and network.".into(),
    ))
}
