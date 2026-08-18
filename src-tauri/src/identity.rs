use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const IDENTITY_FILE: &str = "device-identity.json";
const CONFIG_FILE: &str = "peak-config.json";
const KEYRING_SERVICE: &str = "com.peak.pos";
const KEYRING_USER: &str = "device-ed25519";
const PRIVATE_KEY_FIELD: &str = "privateKeyPkcs8";
const FILE_FALLBACK_WARNING: &str =
    "This till could not use the OS keychain. The device private key is stored as a file on disk. Ask a technician to enable the system keyring before this terminal goes live.";

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

fn set_unix_mode(path: &Path, mode: u32) -> Result<(), String> {
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

fn write_private_file(path: &Path, body: &str) -> Result<(), String> {
    let mut file = fs::File::create(path).map_err(|err| err.to_string())?;
    file.write_all(body.as_bytes())
        .map_err(|err| err.to_string())?;
    set_unix_mode(path, 0o600)
}

enum SecretError {
    Unavailable,
}

trait PrivateKeyStore {
    fn get(&self) -> Result<Option<String>, SecretError>;
    fn set(&self, secret: &str) -> Result<(), SecretError>;
    fn hardware_backed(&self) -> bool;
    fn backend_name(&self) -> &'static str;
}

struct KeyringStore;

impl PrivateKeyStore for KeyringStore {
    fn get(&self) -> Result<Option<String>, SecretError> {
        let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
            .map_err(|_| SecretError::Unavailable)?;
        match entry.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(SecretError::Unavailable),
        }
    }

    fn set(&self, secret: &str) -> Result<(), SecretError> {
        let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
            .map_err(|_| SecretError::Unavailable)?;
        entry
            .set_password(secret)
            .map_err(|_| SecretError::Unavailable)
    }

    fn hardware_backed(&self) -> bool {
        true
    }

    fn backend_name(&self) -> &'static str {
        "keychain"
    }
}

struct IdentityVault<S: PrivateKeyStore> {
    path: PathBuf,
    secrets: S,
}

#[derive(serde::Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceKeyStorageStatus {
    pub hardware_backed: bool,
    pub backend: String,
    pub warning: Option<String>,
}

impl<S: PrivateKeyStore> IdentityVault<S> {
    fn new(path: PathBuf, secrets: S) -> Self {
        Self { path, secrets }
    }

    fn read_file(&self) -> Result<Option<serde_json::Value>, String> {
        if !self.path.exists() {
            return Ok(None);
        }
        let raw = fs::read_to_string(&self.path).map_err(|err| err.to_string())?;
        if raw.trim().is_empty() {
            return Ok(None);
        }
        serde_json::from_str(&raw).map_err(|err| err.to_string())
    }

    fn take_private_key(value: &mut serde_json::Value) -> Option<String> {
        value
            .as_object_mut()
            .and_then(|object| object.remove(PRIVATE_KEY_FIELD))
            .and_then(|key| key.as_str().map(str::to_string))
            .filter(|key| !key.is_empty())
    }

    fn file_contains_private_key(value: &serde_json::Value) -> bool {
        value
            .get(PRIVATE_KEY_FIELD)
            .and_then(|key| key.as_str())
            .is_some_and(|key| !key.is_empty())
    }

    fn assemble(mut public: serde_json::Value, private_key: String) -> Result<String, String> {
        let object = public
            .as_object_mut()
            .ok_or_else(|| "Device identity is not an object".to_string())?;
        object.insert(
            PRIVATE_KEY_FIELD.to_string(),
            serde_json::Value::String(private_key),
        );
        serde_json::to_string(&public).map_err(|err| err.to_string())
    }

    fn save(&self, payload: &str) -> Result<DeviceKeyStorageStatus, String> {
        let mut value: serde_json::Value =
            serde_json::from_str(payload).map_err(|err| err.to_string())?;
        let Some(private_key) = Self::take_private_key(&mut value) else {
            return Err("Device identity is missing a private key".to_string());
        };
        match self.secrets.set(&private_key) {
            Ok(()) => {
                write_private_file(
                    &self.path,
                    &serde_json::to_string(&value).map_err(|err| err.to_string())?,
                )?;
                Ok(self.status_from(false))
            }
            Err(SecretError::Unavailable) => {
                if let Some(object) = value.as_object_mut() {
                    object.insert(
                        PRIVATE_KEY_FIELD.to_string(),
                        serde_json::Value::String(private_key),
                    );
                }
                write_private_file(
                    &self.path,
                    &serde_json::to_string(&value).map_err(|err| err.to_string())?,
                )?;
                Ok(self.status_from(true))
            }
        }
    }

    fn load(&self) -> Result<Option<String>, String> {
        let mut file = self.read_file()?.unwrap_or_else(|| serde_json::json!({}));
        let file_private = Self::take_private_key(&mut file);
        match self.secrets.get() {
            Ok(Some(private_key)) => {
                if file_private.is_some() {
                    write_private_file(
                        &self.path,
                        &serde_json::to_string(&file).map_err(|err| err.to_string())?,
                    )?;
                }
                Ok(Some(Self::assemble(file, private_key)?))
            }
            Ok(None) => {
                let Some(private_key) = file_private else {
                    return Ok(None);
                };
                match self.secrets.set(&private_key) {
                    Ok(()) => {
                        write_private_file(
                            &self.path,
                            &serde_json::to_string(&file).map_err(|err| err.to_string())?,
                        )?;
                        Ok(Some(Self::assemble(file, private_key)?))
                    }
                    Err(SecretError::Unavailable) => {
                        Ok(Some(Self::assemble(file, private_key)?))
                    }
                }
            }
            Err(SecretError::Unavailable) => {
                let Some(private_key) = file_private else {
                    return Ok(None);
                };
                Ok(Some(Self::assemble(file, private_key)?))
            }
        }
    }

    fn status(&self) -> DeviceKeyStorageStatus {
        let file_has_key = self
            .read_file()
            .ok()
            .flatten()
            .is_some_and(|value| Self::file_contains_private_key(&value));
        self.status_from(file_has_key)
    }

    fn status_from(&self, file_has_private_key: bool) -> DeviceKeyStorageStatus {
        let keyring_ok = self.secrets.get().is_ok();
        if self.secrets.hardware_backed() && keyring_ok && !file_has_private_key {
            DeviceKeyStorageStatus {
                hardware_backed: true,
                backend: self.secrets.backend_name().to_string(),
                warning: None,
            }
        } else {
            DeviceKeyStorageStatus {
                hardware_backed: false,
                backend: "file".to_string(),
                warning: Some(FILE_FALLBACK_WARNING.to_string()),
            }
        }
    }
}

fn vault(app: &AppHandle) -> Result<IdentityVault<KeyringStore>, String> {
    Ok(IdentityVault::new(identity_path(app)?, KeyringStore))
}

#[tauri::command]
pub fn load_device_identity(app: AppHandle) -> Result<Option<String>, String> {
    vault(&app)?.load()
}

/// OS keychain for the Ed25519 private key. Copied installer without the
/// keychain entry is a new unpaired device. File fallback is never silent.
#[tauri::command]
pub fn save_device_identity(app: AppHandle, payload: String) -> Result<(), String> {
    vault(&app)?.save(&payload).map(|_| ())
}

#[tauri::command]
pub fn device_key_storage_status(app: AppHandle) -> Result<DeviceKeyStorageStatus, String> {
    Ok(vault(&app)?.status())
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    struct MemoryStore {
        secret: Mutex<Option<String>>,
    }

    impl MemoryStore {
        fn empty() -> Self {
            Self {
                secret: Mutex::new(None),
            }
        }
    }

    impl PrivateKeyStore for MemoryStore {
        fn get(&self) -> Result<Option<String>, SecretError> {
            Ok(self.secret.lock().unwrap().clone())
        }

        fn set(&self, secret: &str) -> Result<(), SecretError> {
            *self.secret.lock().unwrap() = Some(secret.to_string());
            Ok(())
        }

        fn hardware_backed(&self) -> bool {
            true
        }

        fn backend_name(&self) -> &'static str {
            "keychain"
        }
    }

    struct UnavailableStore;

    impl PrivateKeyStore for UnavailableStore {
        fn get(&self) -> Result<Option<String>, SecretError> {
            Err(SecretError::Unavailable)
        }

        fn set(&self, _secret: &str) -> Result<(), SecretError> {
            Err(SecretError::Unavailable)
        }

        fn hardware_backed(&self) -> bool {
            false
        }

        fn backend_name(&self) -> &'static str {
            "file"
        }
    }

    fn temp_identity(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "peak-identity-{}-{name}.json",
            std::process::id()
        ));
        let _ = fs::remove_file(&path);
        path
    }

    fn payload(private_key: &str) -> String {
        serde_json::json!({
            "privateKeyPkcs8": private_key,
            "publicKeySpki": "pub-1",
            "deviceCode": "dev_abc",
        })
        .to_string()
    }

    #[test]
    fn keychain_save_strips_the_private_key_from_the_file() {
        let path = temp_identity("keychain");
        let vault = IdentityVault::new(path.clone(), MemoryStore::empty());
        let status = vault.save(&payload("SECRET_KEY")).expect("save");
        assert!(status.hardware_backed);
        assert_eq!(status.backend, "keychain");
        assert!(status.warning.is_none());

        let on_disk = fs::read_to_string(&path).unwrap();
        assert!(!on_disk.contains("SECRET_KEY"));
        assert!(!on_disk.contains(PRIVATE_KEY_FIELD));
        assert!(on_disk.contains("dev_abc"));

        let loaded: serde_json::Value =
            serde_json::from_str(&vault.load().unwrap().unwrap()).unwrap();
        assert_eq!(loaded[PRIVATE_KEY_FIELD], "SECRET_KEY");
        assert_eq!(loaded["deviceCode"], "dev_abc");
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn missing_keychain_keeps_the_file_and_is_loud() {
        let path = temp_identity("file");
        let vault = IdentityVault::new(path.clone(), UnavailableStore);
        let status = vault.save(&payload("SECRET_KEY")).expect("save");
        assert!(!status.hardware_backed);
        assert_eq!(status.backend, "file");
        assert_eq!(status.warning.as_deref(), Some(FILE_FALLBACK_WARNING));

        let on_disk = fs::read_to_string(&path).unwrap();
        assert!(on_disk.contains("SECRET_KEY"));
        let loaded: serde_json::Value =
            serde_json::from_str(&vault.load().unwrap().unwrap()).unwrap();
        assert_eq!(loaded[PRIVATE_KEY_FIELD], "SECRET_KEY");
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn migrates_a_plaintext_file_into_the_keychain() {
        let path = temp_identity("migrate");
        fs::write(&path, payload("OLD_SECRET")).unwrap();
        let vault = IdentityVault::new(path.clone(), MemoryStore::empty());
        let loaded = vault.load().unwrap().unwrap();
        assert!(loaded.contains("OLD_SECRET"));
        let on_disk = fs::read_to_string(&path).unwrap();
        assert!(!on_disk.contains("OLD_SECRET"));
        assert!(!on_disk.contains(PRIVATE_KEY_FIELD));
        assert!(vault.status().hardware_backed);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn copied_file_without_the_keychain_entry_is_a_new_device() {
        let path = temp_identity("copied");
        fs::write(
            &path,
            serde_json::json!({
                "publicKeySpki": "pub-1",
                "deviceCode": "dev_abc",
            })
            .to_string(),
        )
        .unwrap();
        let vault = IdentityVault::new(path.clone(), MemoryStore::empty());
        assert!(vault.load().unwrap().is_none());
        let _ = fs::remove_file(&path);
    }
}
