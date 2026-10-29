//! The one way this app starts another program. On Windows a child process
//! started from a windowed app opens a console window; for a till that flashed
//! on every print. `command` starts it with no window. Never call
//! `std::process::Command::new` directly: the test below fails if anyone does.

use std::ffi::OsStr;
use std::process::Command;

/// CREATE_NO_WINDOW (Windows process creation flag).
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub fn command<S: AsRef<OsStr>>(program: S) -> Command {
    #[allow(unused_mut)]
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

/// Environment variables the fixed PowerShell scripts read their values from.
pub const ENV_PRINTER_NAME: &str = "YETU_PRINTER_NAME";
pub const ENV_PRINT_FILE: &str = "YETU_PRINT_FILE";

/// A PowerShell run of a script fixed at compile time. Every value the script
/// needs (a printer's name, a file's path) goes in `vars` and is read in the
/// script as `$env:NAME`; a value is never written into script text, so no
/// character in it can end up as PowerShell code. `&'static str` makes a
/// formatted script a compile error.
pub fn powershell_script<S: AsRef<OsStr>>(program: S, script: &'static str, vars: &[(&str, &OsStr)]) -> Command {
    let mut command = command(program);
    command.args(["-NoProfile", "-NonInteractive", "-Command", script]);
    for (name, value) in vars {
        command.env(name, value);
    }
    command
}

/// True when script text has a `{name}` or `{0}` format placeholder in it.
#[cfg(test)]
pub fn has_format_placeholder(script: &str) -> bool {
    let bytes = script.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'{' {
            let mut j = i + 1;
            while j < bytes.len() && (bytes[j].is_ascii_alphanumeric() || bytes[j] == b'_') {
                j += 1;
            }
            if j > i + 1 && j < bytes.len() && bytes[j] == b'}' {
                return true;
            }
        }
        i += 1;
    }
    false
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    fn sources(dir: &Path, found: &mut Vec<std::path::PathBuf>) {
        for entry in std::fs::read_dir(dir).expect("read src dir") {
            let path = entry.expect("dir entry").path();
            if path.is_dir() {
                sources(&path, found);
            } else if path.extension().is_some_and(|ext| ext == "rs") {
                found.push(path);
            }
        }
    }

    #[test]
    fn every_program_is_started_through_quiet_command() {
        let mut files = Vec::new();
        sources(&Path::new(env!("CARGO_MANIFEST_DIR")).join("src"), &mut files);
        assert!(!files.is_empty());
        // Built from pieces so this file does not trip its own scan.
        let banned = [concat!("Command", "::new("), concat!("process", "::Command")];
        let offenders: Vec<String> = files
            .iter()
            .filter(|path| !path.ends_with("quiet.rs"))
            .filter(|path| {
                let text = std::fs::read_to_string(path).expect("read source");
                banned.iter().any(|pattern| text.contains(pattern))
            })
            .map(|path| path.display().to_string())
            .collect();
        assert!(
            offenders.is_empty(),
            "start programs with crate::quiet::command so no window flashes on Windows: {offenders:?}"
        );
    }

    const NASTY: &str = "Bar 'x\u{2019}; $(calc) \u{2018}\nline2";

    #[test]
    fn a_printer_name_reaches_the_command_only_through_the_environment() {
        let name = std::ffi::OsString::from(NASTY);
        let command = super::powershell_script("powershell", "$env:YETU_PRINTER_NAME | Out-Null", &[(super::ENV_PRINTER_NAME, &name)]);
        for arg in command.get_args() {
            let arg = arg.to_string_lossy();
            for piece in ["'x", "\u{2019}", ";", "$(calc)", "\n", "line2"] {
                assert!(!arg.contains(piece), "{piece:?} found in an argument: {arg}");
            }
        }
        let envs: Vec<_> = command.get_envs().collect();
        assert!(envs.iter().any(|(k, v)| *k == "YETU_PRINTER_NAME" && *v == Some(name.as_os_str())));
    }

    #[test]
    fn the_placeholder_check_catches_interpolation() {
        assert!(has_format_placeholder("Out-Printer -Name '{printer}'"));
        assert!(has_format_placeholder("x {0} y"));
        assert!(!has_format_placeholder("class A { public int x; } $env:YETU_PRINTER_NAME"));
    }

    #[test]
    fn a_quiet_command_still_runs() {
        #[cfg(windows)]
        let output = super::command("cmd").args(["/C", "echo", "ok"]).output();
        #[cfg(not(windows))]
        let output = super::command("echo").arg("ok").output();
        let output = output.expect("runs");
        assert!(output.status.success());
        assert!(String::from_utf8_lossy(&output.stdout).contains("ok"));
    }
}
