use std::io::Write;
use std::process::{Command, Stdio};

#[derive(serde::Deserialize)]
pub struct KitchenTicket {
    pub text: String,
}

/// Sends a Peak kitchen-ticket *copy* to the OS printer. This command never
/// talks to Peak: a missing printer is a device failure, not an unsend.
#[tauri::command]
pub fn print_kitchen_ticket(ticket: KitchenTicket) -> Result<(), String> {
    let body = ticket.text.trim();
    if body.is_empty() {
        return Err("Kitchen ticket text is empty".to_string());
    }
    send_to_os_printer(body)
}

fn send_to_os_printer(body: &str) -> Result<(), String> {
    if which("lp").is_none() {
        return Err("No kitchen printer is configured".to_string());
    }
    let printer = std::env::var("PEAK_KITCHEN_PRINTER")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let mut command = Command::new("lp");
    command.arg("-t").arg("peak-kitchen-ticket");
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

fn which(binary: &str) -> Option<std::path::PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).find_map(|dir| {
        let candidate = dir.join(binary);
        candidate.is_file().then_some(candidate)
    })
}
