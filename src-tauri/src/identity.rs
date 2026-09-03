use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine as _,
};
use ed25519_dalek::{pkcs8::DecodePrivateKey, Signer, SigningKey};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use zeroize::Zeroizing;

const IDENTITY_FILE: &str = "device-identity.json";
const CONFIG_FILE: &str = "peak-config.json";
const KEYRING_SERVICE: &str = "com.peak.pos";
const KEYRING_USER: &str = "device-ed25519";
const PRIVATE_KEY_FIELD: &str = "privateKeyPkcs8";
const SECURE_STORE_WARNING: &str =
    "This terminal cannot access its OS secure store. Device signing and certified offline operation are disabled.";
const NATIVE_KEY_VERSION: u32 = 2;

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

#[derive(serde::Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeDeviceIdentity {
    pub public_key: String,
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NativeKeyEnvelope {
    version: u32,
    secret_key: String,
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
                backend: "unavailable".to_string(),
                warning: Some(SECURE_STORE_WARNING.to_string()),
            }
        }
    }

    fn ensure(&self) -> Result<NativeDeviceIdentity, String> {
        let mut public = self.read_file()?.unwrap_or_else(|| serde_json::json!({}));
        let legacy_file_key = Self::take_private_key(&mut public);
        let signing_key = match self.secrets.get() {
            Ok(Some(secret)) => decode_signing_key(&secret)?,
            Ok(None) => {
                let key = if let Some(secret) = legacy_file_key {
                    decode_signing_key(&secret)?
                } else {
                    generate_signing_key()?
                };
                self.secrets
                    .set(&encode_signing_key(&key)?)
                    .map_err(|_| "Device secure storage is unavailable".to_string())?;
                key
            }
            Err(SecretError::Unavailable) => {
                return Err("Device secure storage is unavailable".to_string())
            }
        };
        let public_key = URL_SAFE_NO_PAD.encode(signing_key.verifying_key().to_bytes());
        let object = public
            .as_object_mut()
            .ok_or_else(|| "Device identity metadata is invalid".to_string())?;
        object.remove(PRIVATE_KEY_FIELD);
        object.insert(
            "publicKey".to_string(),
            serde_json::Value::String(public_key.clone()),
        );
        write_private_file(
            &self.path,
            &serde_json::to_string(&public).map_err(|_| "Device identity metadata is invalid")?,
        )?;
        Ok(NativeDeviceIdentity { public_key })
    }

    fn sign(&self, message: &[u8]) -> Result<String, String> {
        let secret = Zeroizing::new(
            self.secrets
                .get()
                .map_err(|_| "Device secure storage is unavailable".to_string())?
                .ok_or_else(|| "Device identity is unavailable".to_string())?,
        );
        let signing_key = decode_signing_key(&secret)?;
        Ok(URL_SAFE_NO_PAD.encode(signing_key.sign(message).to_bytes()))
    }

    fn load_public(&self) -> Result<String, String> {
        self.ensure()?;
        let mut value = self
            .read_file()?
            .ok_or_else(|| "Device identity metadata is unavailable".to_string())?;
        Self::take_private_key(&mut value);
        serde_json::to_string(&value).map_err(|_| "Device identity metadata is invalid".to_string())
    }

    fn save_public(&self, payload: &str) -> Result<(), String> {
        let identity = self.ensure()?;
        let mut value: serde_json::Value =
            serde_json::from_str(payload).map_err(|_| "Device identity metadata is invalid")?;
        Self::take_private_key(&mut value);
        let object = value
            .as_object_mut()
            .ok_or_else(|| "Device identity metadata is invalid".to_string())?;
        object.insert(
            "publicKey".to_string(),
            serde_json::Value::String(identity.public_key),
        );
        write_private_file(
            &self.path,
            &serde_json::to_string(&value).map_err(|_| "Device identity metadata is invalid")?,
        )
    }
}

fn generate_signing_key() -> Result<SigningKey, String> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| "Device key generation failed".to_string())?;
    let key = SigningKey::from_bytes(&bytes);
    use zeroize::Zeroize;
    bytes.zeroize();
    Ok(key)
}

fn encode_signing_key(key: &SigningKey) -> Result<String, String> {
    serde_json::to_string(&NativeKeyEnvelope {
        version: NATIVE_KEY_VERSION,
        secret_key: URL_SAFE_NO_PAD.encode(key.to_bytes()),
    })
    .map_err(|_| "Device key encoding failed".to_string())
}

fn decode_signing_key(secret: &str) -> Result<SigningKey, String> {
    if let Ok(envelope) = serde_json::from_str::<NativeKeyEnvelope>(secret) {
        if envelope.version != NATIVE_KEY_VERSION {
            return Err("Device key version is unsupported".to_string());
        }
        let bytes: [u8; 32] = URL_SAFE_NO_PAD
            .decode(envelope.secret_key)
            .map_err(|_| "Device key is invalid".to_string())?
            .try_into()
            .map_err(|_| "Device key is invalid".to_string())?;
        return Ok(SigningKey::from_bytes(&bytes));
    }

    let der = STANDARD
        .decode(secret)
        .or_else(|_| URL_SAFE_NO_PAD.decode(secret))
        .map_err(|_| "Device key is invalid".to_string())?;
    SigningKey::from_pkcs8_der(&der).map_err(|_| "Device key is invalid".to_string())
}

fn vault(app: &AppHandle) -> Result<IdentityVault<KeyringStore>, String> {
    Ok(IdentityVault::new(identity_path(app)?, KeyringStore))
}

#[tauri::command]
pub fn ensure_device_identity(app: AppHandle) -> Result<NativeDeviceIdentity, String> {
    vault(&app)?.ensure()
}

#[tauri::command]
pub fn sign_device_challenge(app: AppHandle, nonce: String) -> Result<String, String> {
    let message = URL_SAFE_NO_PAD
        .decode(&nonce)
        .or_else(|_| STANDARD.decode(&nonce))
        .map_err(|_| "Device challenge is invalid".to_string())?;
    if message.len() != 32 {
        return Err("Device challenge is invalid".to_string());
    }
    vault(&app)?.sign(&message)
}

#[tauri::command]
pub fn load_device_identity_public(app: AppHandle) -> Result<String, String> {
    vault(&app)?.load_public()
}

#[tauri::command]
pub fn save_device_identity_public(app: AppHandle, payload: String) -> Result<(), String> {
    vault(&app)?.save_public(&payload)
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
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use ed25519_dalek::{pkcs8::EncodePrivateKey, Signature, Verifier, VerifyingKey};
    use std::sync::Mutex;

    struct MemoryStore {
        secret: std::sync::Arc<Mutex<Option<String>>>,
    }

    impl MemoryStore {
        fn empty() -> Self {
            Self {
                secret: std::sync::Arc::new(Mutex::new(None)),
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
        let path =
            std::env::temp_dir().join(format!("peak-identity-{}-{name}.json", std::process::id()));
        let _ = fs::remove_file(&path);
        path
    }

    #[test]
    fn installing_over_the_same_app_data_path_keeps_the_keypair() {
        // Tauri stores identity under app_data_dir, not next to the binary.
        // A v2 installer that replaces the executable must not move that path.
        assert_eq!(IDENTITY_FILE, "device-identity.json");
        assert!(!IDENTITY_FILE.contains('/') && !IDENTITY_FILE.contains('\\'));

        let path = temp_identity("upgrade");
        let keychain = MemoryStore::empty();
        let v1 = IdentityVault::new(
            path.clone(),
            MemoryStore {
                secret: std::sync::Arc::clone(&keychain.secret),
            },
        );
        let first = v1.ensure().expect("create identity");

        let v2 = IdentityVault::new(
            path.clone(),
            MemoryStore {
                secret: std::sync::Arc::clone(&keychain.secret),
            },
        );
        let loaded = v2.ensure().expect("reload identity");
        assert_eq!(loaded, first);
        let on_disk = fs::read_to_string(&path).unwrap();
        assert!(!on_disk.contains(PRIVATE_KEY_FIELD));
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn legacy_plaintext_key_is_migrated_once_into_secure_storage() {
        let path = temp_identity("legacy-migration");
        let legacy_key = SigningKey::from_bytes(&[11_u8; 32]);
        let legacy_secret = STANDARD.encode(legacy_key.to_pkcs8_der().unwrap().as_bytes());
        fs::write(
            &path,
            serde_json::json!({
                (PRIVATE_KEY_FIELD): legacy_secret,
                "deviceCode": "terminal-legacy"
            })
            .to_string(),
        )
        .unwrap();
        let secrets = MemoryStore::empty();
        let vault = IdentityVault::new(
            path.clone(),
            MemoryStore {
                secret: std::sync::Arc::clone(&secrets.secret),
            },
        );

        let identity = vault.ensure().expect("migrate legacy key");
        assert_eq!(
            identity.public_key,
            URL_SAFE_NO_PAD.encode(legacy_key.verifying_key().to_bytes())
        );
        assert!(secrets.secret.lock().unwrap().is_some());
        assert!(!fs::read_to_string(&path)
            .unwrap()
            .contains(PRIVATE_KEY_FIELD));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn native_authority_creates_key_in_secure_store_and_returns_only_public_identity() {
        let path = temp_identity("native-create");
        let secrets = MemoryStore::empty();
        let vault = IdentityVault::new(
            path.clone(),
            MemoryStore {
                secret: std::sync::Arc::clone(&secrets.secret),
            },
        );

        let identity = vault.ensure().expect("ensure native identity");
        assert_eq!(
            URL_SAFE_NO_PAD.decode(&identity.public_key).unwrap().len(),
            32
        );
        assert!(!serde_json::to_string(&identity)
            .unwrap()
            .contains("private"));
        assert!(secrets.secret.lock().unwrap().as_ref().is_some());
        assert!(!fs::read_to_string(&path)
            .unwrap()
            .contains(PRIVATE_KEY_FIELD));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn native_authority_signs_without_returning_private_key() {
        let path = temp_identity("native-sign");
        let vault = IdentityVault::new(path.clone(), MemoryStore::empty());
        let identity = vault.ensure().unwrap();
        let signature = vault.sign(b"server-challenge").unwrap();
        let public_bytes: [u8; 32] = URL_SAFE_NO_PAD
            .decode(identity.public_key)
            .unwrap()
            .try_into()
            .unwrap();
        let verifying_key = VerifyingKey::from_bytes(&public_bytes).unwrap();
        let signature = Signature::from_slice(&URL_SAFE_NO_PAD.decode(signature).unwrap()).unwrap();
        verifying_key
            .verify(b"server-challenge", &signature)
            .unwrap();
        let _ = fs::remove_file(path);
    }

    #[test]
    fn native_authority_fails_closed_when_secure_store_is_unavailable() {
        let path = temp_identity("native-unavailable");
        let vault = IdentityVault::new(path.clone(), UnavailableStore);
        assert!(vault.ensure().is_err());
        assert!(!path.exists());
    }
}
