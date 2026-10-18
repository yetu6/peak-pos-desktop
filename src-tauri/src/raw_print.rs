//! Raw printing (S8a): ESC/POS bytes, made by the till's ticket layouts, sent
//! to a thermal printer as they are -- to a network printer by TCP (port
//! 9100), or to a printer this computer knows through its spooler in RAW
//! mode, so the printer's own commands (large type, the cut, the cash drawer)
//! reach it untouched. Only the standard library: this module is tested on its
//! own (`rustc --test`), and nothing here talks to Yetu.

use std::io::Write;
use std::net::{TcpStream, ToSocketAddrs};
use std::process::{Command, Stdio};
use std::time::Duration;

/// How long a network printer has to answer before the job is said to have failed.
pub const NETWORK_TIMEOUT: Duration = Duration::from_secs(5);

/// Where the bytes go: a printer this computer knows, or one on the network.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RawTarget {
    System { name: String },
    Network { host: String, port: u16 },
}

/// Sends the job's bytes to the printer, whole; an error says what went wrong
/// in words a person can act on.
pub fn print_raw(target: &RawTarget, bytes: &[u8]) -> Result<(), String> {
    if bytes.is_empty() {
        return Err("There was nothing to print.".to_string());
    }
    match target {
        RawTarget::Network { host, port } => print_network(host, *port, bytes),
        RawTarget::System { name } => print_system(name, bytes),
    }
}

fn print_network(host: &str, port: u16, bytes: &[u8]) -> Result<(), String> {
    let unreachable = || {
        format!("The printer at {host} didn't answer. Check it is on, has paper, and is on the same network as this till.")
    };
    let addrs = (host, port).to_socket_addrs().map_err(|_| unreachable())?;
    let mut last = None;
    for addr in addrs {
        match TcpStream::connect_timeout(&addr, NETWORK_TIMEOUT) {
            Ok(mut stream) => {
                stream.set_write_timeout(Some(NETWORK_TIMEOUT)).map_err(|_| unreachable())?;
                stream.write_all(bytes).map_err(|_| unreachable())?;
                stream.flush().map_err(|_| unreachable())?;
                let _ = stream.shutdown(std::net::Shutdown::Write);
                return Ok(());
            }
            Err(err) => last = Some(err),
        }
    }
    let _ = last;
    Err(unreachable())
}

#[cfg(windows)]
fn print_system(name: &str, bytes: &[u8]) -> Result<(), String> {
    // The spooler in RAW mode (winspool.drv: OpenPrinter, StartDocPrinter with
    // "RAW", WritePrinter), through PowerShell as the till's text printing
    // already is: the bytes reach the printer exactly as made.
    let dir = std::env::temp_dir();
    let path = dir.join(format!("yetu-raw-{}-{}.bin", std::process::id(), nanos()));
    std::fs::write(&path, bytes).map_err(|err| format!("The ticket couldn't be prepared for the printer: {err}"))?;
    let path_display = path.display().to_string().replace('\'', "''");
    let printer = name.replace('\'', "''");
    let script = format!(
        r#"$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class YetuRaw {{
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public class DOCINFO {{ public string pDocName; public string pOutputFile; public string pDataType; }}
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] public static extern bool OpenPrinter(string name, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] public static extern int StartDocPrinter(IntPtr h, int level, DOCINFO di);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool WritePrinter(IntPtr h, byte[] b, int n, out int w);
  public static void Send(string printer, byte[] bytes) {{
    IntPtr h; if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw new Exception("printer not found");
    try {{
      var di = new DOCINFO {{ pDocName = "Yetu ticket", pDataType = "RAW" }};
      if (StartDocPrinter(h, 1, di) == 0) throw new Exception("printer refused the job");
      try {{ StartPagePrinter(h); int w; if (!WritePrinter(h, bytes, bytes.Length, out w) || w != bytes.Length) throw new Exception("printer took only part of the job"); EndPagePrinter(h); }}
      finally {{ EndDocPrinter(h); }}
    }} finally {{ ClosePrinter(h); }}
  }}
}}
'@
[YetuRaw]::Send('{printer}', [System.IO.File]::ReadAllBytes('{path_display}'))"#
    );
    let result = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output();
    let _ = std::fs::remove_file(&path);
    let output = result.map_err(|_| format!("The printer {name} couldn't be reached from this computer."))?;
    if !output.status.success() {
        return Err(format!("The printer {name} didn't take the ticket. Check it is on, has paper, and is set up on this computer."));
    }
    Ok(())
}

#[cfg(windows)]
fn nanos() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
}

#[cfg(not(windows))]
fn print_system(name: &str, bytes: &[u8]) -> Result<(), String> {
    // CUPS: lp with -o raw passes the bytes to the printer untouched.
    let mut child = Command::new("lp")
        .args(["-d", name, "-o", "raw"])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| format!("The printer {name} couldn't be reached from this computer."))?;
    child
        .stdin
        .take()
        .ok_or_else(|| format!("The printer {name} couldn't be reached from this computer."))?
        .write_all(bytes)
        .map_err(|_| format!("The printer {name} didn't take the ticket."))?;
    let status = child.wait().map_err(|_| format!("The printer {name} didn't take the ticket."))?;
    if !status.success() {
        return Err(format!("The printer {name} didn't take the ticket. Check it is on and set up on this computer."));
    }
    Ok(())
}

/// The printers this computer knows, by name, as staff choose them.
pub fn list_system_printers() -> Vec<String> {
    #[cfg(windows)]
    let output = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", "Get-Printer | Select-Object -ExpandProperty Name"])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output();
    #[cfg(not(windows))]
    let output = Command::new("lpstat").arg("-e").stdin(Stdio::null()).stderr(Stdio::null()).output();
    match output {
        Ok(out) if out.status.success() => String::from_utf8_lossy(&out.stdout)
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(String::from)
            .collect(),
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use std::net::TcpListener;

    #[test]
    fn a_network_printer_gets_the_bytes_whole() {
        let printer = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = printer.local_addr().unwrap().port();
        let received = std::thread::spawn(move || {
            let (mut socket, _) = printer.accept().unwrap();
            let mut got = Vec::new();
            socket.read_to_end(&mut got).unwrap();
            got
        });
        let job = vec![0x1b, 0x40, b'4', b'2', 0x0a, 0x1d, 0x56, 0x42, 3];
        print_raw(&RawTarget::Network { host: "127.0.0.1".into(), port }, &job).unwrap();
        assert_eq!(received.join().unwrap(), job);
    }

    #[test]
    fn a_network_printer_that_isnt_there_is_said_in_words() {
        // A port nothing listens on: bind, learn the port, close it.
        let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let err = print_raw(&RawTarget::Network { host: "127.0.0.1".into(), port }, b"x").unwrap_err();
        assert!(err.starts_with("The printer at 127.0.0.1 didn't answer."), "{err}");
    }

    #[test]
    fn nothing_to_print_is_refused() {
        assert_eq!(print_raw(&RawTarget::Network { host: "127.0.0.1".into(), port: 9 }, &[]).unwrap_err(), "There was nothing to print.");
    }
}
