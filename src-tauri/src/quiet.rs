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
