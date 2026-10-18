//! Raw printing (S8a): ESC/POS bytes, made by the till's ticket layouts, sent
//! to a thermal printer as they are -- to a network printer by TCP (port
//! 9100), or to a printer this computer knows through its spooler in RAW
//! mode, so the printer's own commands (large type, the cut, the cash drawer)
//! reach it untouched. Only the standard library: this module is tested on its
//! own (`rustc --test`), and nothing here talks to Yetu.

use std::io::Write;
use std::net::{IpAddr, SocketAddr, TcpStream, ToSocketAddrs};
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

/// The ports a network receipt printer takes raw jobs on (9100, and the next
/// few on a print server with several printers).
pub const RAW_PORTS: std::ops::RangeInclusive<u16> = 9100..=9109;

/// Sends the job's bytes to the printer, whole; an error says what went wrong
/// in words a person can act on. The target is checked first: a printer in
/// this building, never an address out on the internet or a port that isn't
/// a printer's (whatever the page asks for).
pub fn print_raw(target: &RawTarget, bytes: &[u8]) -> Result<(), String> {
    if bytes.is_empty() {
        return Err("There was nothing to print.".to_string());
    }
    check_target(target)?;
    match target {
        RawTarget::Network { host, port } => print_network(host, *port, bytes, true),
        RawTarget::System { name } => print_system(name, bytes),
    }
}

/// A target the till may print to: a printer this computer knows by a plain
/// name, or one on the local network on a raw printing port.
pub fn check_target(target: &RawTarget) -> Result<(), String> {
    match target {
        RawTarget::System { name } => {
            let ok = !name.trim().is_empty()
                && name.len() <= 200
                && !name.chars().any(|c| c.is_control() || c == '"' || c == '`');
            if ok {
                Ok(())
            } else {
                Err("That isn't the name of a printer on this computer.".to_string())
            }
        }
        RawTarget::Network { host, port } => {
            if !RAW_PORTS.contains(port) {
                return Err(format!(
                    "A receipt printer takes jobs on port 9100 (up to 9109), not {port}."
                ));
            }
            let ok = !host.is_empty()
                && host.len() <= 253
                && host
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == ':');
            if ok {
                Ok(())
            } else {
                Err("That isn't a printer's address.".to_string())
            }
        }
    }
}

/// A printer as saved in the till's settings: a target it may print to, and an
/// address written as numbers must already be on this building's network (a
/// name is checked when it is printed to, as it may resolve differently later).
pub fn check_saved_target(target: &RawTarget) -> Result<(), String> {
    check_target(target)?;
    if let RawTarget::Network { host, .. } = target {
        if let Ok(ip) = host.parse::<IpAddr>() {
            if !is_local_address(ip) {
                return Err(format!(
                    "{host} isn't on this building's network: a kitchen printer is."
                ));
            }
        }
    }
    Ok(())
}

/// An address on this building's network: private, link-local or this computer.
pub fn is_local_address(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_private() || v4.is_link_local() || v4.is_loopback(),
        IpAddr::V6(v6) => {
            let first = v6.segments()[0];
            v6.is_loopback() || (first & 0xfe00) == 0xfc00 || (first & 0xffc0) == 0xfe80
        }
    }
}

fn print_network(host: &str, port: u16, bytes: &[u8], local_only: bool) -> Result<(), String> {
    let unreachable = || {
        format!("The printer at {host} didn't answer. Check it is on, has paper, and is on the same network as this till.")
    };
    let addrs: Vec<SocketAddr> = (host, port)
        .to_socket_addrs()
        .map_err(|_| unreachable())?
        .collect();
    // A name that resolves outside the building is never printed to.
    if local_only && !addrs.iter().all(|addr| is_local_address(addr.ip())) {
        return Err(format!(
            "{host} isn't on this building's network: a kitchen printer is."
        ));
    }
    let mut last = None;
    for addr in addrs {
        match TcpStream::connect_timeout(&addr, NETWORK_TIMEOUT) {
            Ok(mut stream) => {
                stream
                    .set_write_timeout(Some(NETWORK_TIMEOUT))
                    .map_err(|_| unreachable())?;
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
    std::fs::write(&path, bytes)
        .map_err(|err| format!("The ticket couldn't be prepared for the printer: {err}"))?;
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
    let output = result
        .map_err(|_| format!("The printer {name} couldn't be reached from this computer."))?;
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
    let status = child
        .wait()
        .map_err(|_| format!("The printer {name} didn't take the ticket."))?;
    if !status.success() {
        return Err(format!("The printer {name} didn't take the ticket. Check it is on and set up on this computer."));
    }
    Ok(())
}

/// The printers this computer knows, by name, as staff choose them.
pub fn list_system_printers() -> Vec<String> {
    #[cfg(windows)]
    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Get-Printer | Select-Object -ExpandProperty Name",
        ])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output();
    #[cfg(not(windows))]
    let output = Command::new("lpstat")
        .arg("-e")
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output();
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
        // The fake printer listens on a free port; the check of the target has its own tests.
        print_network("127.0.0.1", port, &job, true).unwrap();
        assert_eq!(received.join().unwrap(), job);
    }

    #[test]
    fn a_network_printer_that_isnt_there_is_said_in_words() {
        // A port nothing listens on: bind, learn the port, close it.
        let port = TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let err = print_network("127.0.0.1", port, b"x", true).unwrap_err();
        assert!(
            err.starts_with("The printer at 127.0.0.1 didn't answer."),
            "{err}"
        );
    }

    #[test]
    fn only_a_printer_in_the_building_on_a_printing_port() {
        let net = |host: &str, port: u16| RawTarget::Network {
            host: host.into(),
            port,
        };
        assert!(check_target(&net("192.168.1.50", 9100)).is_ok());
        assert!(check_target(&net("192.168.1.50", 22))
            .unwrap_err()
            .contains("port 9100"));
        assert!(check_target(&net("printer;rm", 9100)).is_err());
        assert!(check_target(&RawTarget::System {
            name: "EPSON TM-T20".into()
        })
        .is_ok());
        assert!(check_target(&RawTarget::System {
            name: "x\"; calc".into()
        })
        .is_err());
        assert!(check_target(&RawTarget::System { name: " ".into() }).is_err());
        // A public address is refused before anything is sent.
        let err = print_raw(&net("8.8.8.8", 9100), b"x").unwrap_err();
        assert!(err.contains("isn't on this building's network"), "{err}");
    }

    #[test]
    fn nothing_is_sent_to_a_port_that_isnt_a_printers() {
        // Something listening on this computer, on a port outside 9100-9109:
        // print_raw refuses before connecting, so it is never written to.
        let other = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = other.local_addr().unwrap().port();
        assert!(!RAW_PORTS.contains(&port));
        other.set_nonblocking(true).unwrap();
        let err = print_raw(
            &RawTarget::Network {
                host: "127.0.0.1".into(),
                port,
            },
            b"x",
        )
        .unwrap_err();
        assert!(err.contains("port 9100"), "{err}");
        assert!(
            other.accept().is_err(),
            "print_raw connected to a port that isn't a printer's"
        );
    }

    #[test]
    fn a_saved_printer_is_one_in_the_building() {
        let net = |host: &str| RawTarget::Network {
            host: host.into(),
            port: 9100,
        };
        assert!(check_saved_target(&net("192.168.1.50")).is_ok());
        assert!(check_saved_target(&net("kitchen-printer.local")).is_ok());
        assert!(check_saved_target(&net("41.59.1.1"))
            .unwrap_err()
            .contains("isn't on this building's network"));
        assert!(check_saved_target(&RawTarget::Network {
            host: "192.168.1.50".into(),
            port: 443
        })
        .is_err());
    }

    #[test]
    fn local_addresses_are_the_buildings() {
        for ip in [
            "10.0.0.5",
            "172.16.3.1",
            "192.168.1.50",
            "169.254.10.10",
            "127.0.0.1",
            "::1",
            "fe80::1",
            "fd00::5",
        ] {
            assert!(is_local_address(ip.parse().unwrap()), "{ip}");
        }
        for ip in ["8.8.8.8", "41.59.1.1", "2001:4860::8888"] {
            assert!(!is_local_address(ip.parse().unwrap()), "{ip}");
        }
    }

    #[test]
    fn nothing_to_print_is_refused() {
        assert_eq!(
            print_raw(
                &RawTarget::Network {
                    host: "127.0.0.1".into(),
                    port: 9
                },
                &[]
            )
            .unwrap_err(),
            "There was nothing to print."
        );
    }
}
