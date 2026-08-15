use std::fs;
use std::io::Write;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const IDENTITY_FILE: &str = "device-identity.json";
const CONFIG_FILE: &str = "peak-config.json";

fn identity_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    Ok(dir.join(IDENTITY_FILE))
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|err| err.to_string())?;
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    Ok(dir.join(CONFIG_FILE))
}

fn set_unix_mode(path: &PathBuf, mode: u32) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(path)
            .map_err(|err| err.to_string())?
            .permissions();
        perms.set_mode(mode);
        fs::set_permissions(path, perms).map_err(|err| err.to_string())?;
    }
    let _ = (path, mode);
    Ok(())
}

#[tauri::command]
pub fn load_device_identity(app: AppHandle) -> Result<Option<String>, String> {
    let path = identity_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(path).map(Some).map_err(|err| err.to_string())
}

/// 0600 JSON in app data. Copied installer = new unpaired device (new key).
#[tauri::command]
pub fn save_device_identity(app: AppHandle, payload: String) -> Result<(), String> {
    let path = identity_path(&app)?;
    let mut file = fs::File::create(&path).map_err(|err| err.to_string())?;
    file.write_all(payload.as_bytes())
        .map_err(|err| err.to_string())?;
    set_unix_mode(&path, 0o600)
}

#[tauri::command]
pub fn load_peak_config(app: AppHandle) -> Result<Option<String>, String> {
    let path = config_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(path).map_err(|err| err.to_string())?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if let Some(url) = value.get("apiBaseUrl").and_then(|v| v.as_str()) {
            return Ok(Some(url.to_string()));
        }
    }
    Ok(Some(trimmed.to_string()))
}

#[tauri::command]
pub fn save_peak_config(app: AppHandle, payload: String) -> Result<(), String> {
    let path = config_path(&app)?;
    let body = serde_json::json!({ "apiBaseUrl": payload }).to_string();
    let mut file = fs::File::create(&path).map_err(|err| err.to_string())?;
    file.write_all(body.as_bytes())
        .map_err(|err| err.to_string())?;
    set_unix_mode(&path, 0o644)
}
