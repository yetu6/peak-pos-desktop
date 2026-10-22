//! Owner, 23 Oct 2026: the till opens by itself when the computer starts.
//!
//! Named setting: on by default; `YETU_START_WITH_COMPUTER=0` (or `false`,
//! `no`, `off`) turns it off for one till. Applied at every start, so a removed
//! entry comes back and a till switched off stays off. Release builds only: a
//! developer's machine never registers a dev build. On Windows it starts when
//! Windows signs in; a till PC set to sign in automatically starts it at power-up.
use tauri_plugin_autostart::ManagerExt;

pub const SETTING: &str = "YETU_START_WITH_COMPUTER";

/// Whether this till starts with the computer, from the setting's raw value.
pub fn wanted(raw: Option<&str>) -> bool {
    !matches!(
        raw.map(|value| value.trim().to_ascii_lowercase())
            .as_deref(),
        Some("0" | "false" | "no" | "off")
    )
}

pub fn apply(app: &tauri::AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    let launcher = app.autolaunch();
    let result = match (
        wanted(std::env::var(SETTING).ok().as_deref()),
        launcher.is_enabled(),
    ) {
        (true, Ok(false)) => launcher.enable(),
        (false, Ok(true)) => launcher.disable(),
        (_, Ok(_)) => Ok(()),
        (_, Err(error)) => Err(error),
    };
    if let Err(error) = result {
        // Never stops the till from opening; it only fails to register itself.
        eprintln!("start with the computer: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::wanted;

    #[test]
    fn starts_with_the_computer_unless_a_till_turns_it_off() {
        assert!(wanted(None));
        assert!(wanted(Some("")));
        assert!(wanted(Some("1")));
        assert!(wanted(Some("yes")));
        for off in ["0", "false", "no", "off", " OFF ", "False"] {
            assert!(!wanted(Some(off)), "{off:?} should turn it off");
        }
    }
}
