//! F-238: WebKitGTK's GPU-buffer (DMABUF) renderer draws the till's window
//! with the wrong row width on some Linux graphics (nouveau on the QA
//! machine): diagonal stripes across a maximised window, and pieces of the
//! last screen left inside sheets, typed text hidden among them. The older
//! renderer draws it right. Whoever runs the till can still choose: a value
//! already set is kept. Windows and macOS don't use WebKitGTK.

/// WebKitGTK's own switch for its DMABUF renderer.
pub const DMABUF_SWITCH: &str = "WEBKIT_DISABLE_DMABUF_RENDERER";

/// What to set the switch to, given what it is now: nothing when already chosen.
fn dmabuf_default(already: Option<std::ffi::OsString>) -> Option<&'static str> {
    match already {
        Some(_) => None,
        None => Some("1"),
    }
}

/// Before the window starts (and before any thread), so WebKitGTK reads it.
pub fn apply_defaults() {
    if let Some(value) = dmabuf_default(std::env::var_os(DMABUF_SWITCH)) {
        std::env::set_var(DMABUF_SWITCH, value);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_older_renderer_unless_someone_chose() {
        assert_eq!(dmabuf_default(None), Some("1"));
        assert_eq!(dmabuf_default(Some("0".into())), None);
        assert_eq!(dmabuf_default(Some("1".into())), None);
    }
}
