#[derive(serde::Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HostDiagnostics {
    pub os: String,
    pub arch: String,
    pub app_version: String,
}

/// OS and the version baked into this binary. Never includes keys or tokens.
#[tauri::command]
pub fn host_diagnostics() -> HostDiagnostics {
    collect_host_diagnostics()
}

fn collect_host_diagnostics() -> HostDiagnostics {
    HostDiagnostics {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_diagnostics_uses_the_crate_version() {
        let host = collect_host_diagnostics();
        assert_eq!(host.app_version, env!("CARGO_PKG_VERSION"));
        assert!(!host.app_version.is_empty());
        assert!(!host.os.is_empty());
        assert!(!host.arch.is_empty());
    }
}
