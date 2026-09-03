use std::{fs, path::Path, sync::Mutex};

use tauri::{AppHandle, Manager, State};

use super::{DbKeyStore, DbKeyStoreError, LocalStore, LocalStoreError, LocalStoreErrorKind};

const KEYRING_SERVICE: &str = "com.peak.pos";
const KEYRING_USER: &str = "local-sqlcipher-envelope-v1";
const STORE_DIRECTORY: &str = "transaction-store";
const STORE_FILE: &str = "peak-pos.sqlite3";

pub struct OsKeyStore;

impl DbKeyStore for OsKeyStore {
    fn load(&self) -> Result<Option<String>, DbKeyStoreError> {
        let entry =
            keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|_| DbKeyStoreError)?;
        match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(DbKeyStoreError),
        }
    }

    fn save(&self, envelope: &str) -> Result<(), DbKeyStoreError> {
        let entry =
            keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|_| DbKeyStoreError)?;
        entry.set_password(envelope).map_err(|_| DbKeyStoreError)
    }
}

enum RuntimeState {
    Ready(Mutex<LocalStore>),
    Failed(LocalStoreErrorKind),
}

pub struct LocalStoreRuntime {
    state: RuntimeState,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalStoreStatus {
    pub state: &'static str,
    pub schema_version: Option<u32>,
    pub cipher_version: Option<String>,
    pub issue: Option<LocalStoreErrorKind>,
}

impl LocalStoreRuntime {
    pub fn initialize(directory: &Path, key_store: &impl DbKeyStore) -> Self {
        let result = prepare_private_directory(directory)
            .map_err(LocalStoreError::PathUnavailable)
            .and_then(|_| LocalStore::open(&directory.join(STORE_FILE), key_store))
            .and_then(|store| {
                store.integrity_check()?;
                harden_store_files(directory)?;
                Ok(store)
            });
        match result {
            Ok(store) => Self {
                state: RuntimeState::Ready(Mutex::new(store)),
            },
            Err(error) => Self {
                state: RuntimeState::Failed(error.kind()),
            },
        }
    }

    pub fn initialize_for_app(app: &AppHandle) -> Self {
        match app.path().app_data_dir() {
            Ok(path) => Self::initialize(&path.join(STORE_DIRECTORY), &OsKeyStore),
            Err(_) => Self {
                state: RuntimeState::Failed(LocalStoreErrorKind::SecureStoreUnavailable),
            },
        }
    }

    pub fn status(&self) -> LocalStoreStatus {
        match &self.state {
            RuntimeState::Ready(store) => match store.lock() {
                Ok(store) => LocalStoreStatus {
                    state: "READY",
                    schema_version: Some(store.schema_version()),
                    cipher_version: Some(store.cipher_version().to_string()),
                    issue: None,
                },
                Err(_) => LocalStoreStatus {
                    state: "FAILED",
                    schema_version: None,
                    cipher_version: None,
                    issue: Some(LocalStoreErrorKind::IntegrityFailure),
                },
            },
            RuntimeState::Failed(issue) => LocalStoreStatus {
                state: "FAILED",
                schema_version: None,
                cipher_version: None,
                issue: Some(*issue),
            },
        }
    }
}

#[tauri::command]
pub fn local_store_status(runtime: State<'_, LocalStoreRuntime>) -> LocalStoreStatus {
    runtime.status()
}

fn prepare_private_directory(path: &Path) -> Result<(), std::io::Error> {
    fs::create_dir_all(path)?;
    set_mode(path, 0o700)
}

fn harden_store_files(directory: &Path) -> Result<(), LocalStoreError> {
    for file in [STORE_FILE, "peak-pos.sqlite3-wal", "peak-pos.sqlite3-shm"] {
        let path = directory.join(file);
        if path.exists() {
            set_mode(&path, 0o600).map_err(LocalStoreError::PathUnavailable)?;
        }
    }
    Ok(())
}

#[cfg(unix)]
fn set_mode(path: &Path, mode: u32) -> Result<(), std::io::Error> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(mode))
}

#[cfg(not(unix))]
fn set_mode(_path: &Path, _mode: u32) -> Result<(), std::io::Error> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;

    #[derive(Default)]
    struct MemoryKeyStore(Mutex<Option<String>>);

    impl DbKeyStore for MemoryKeyStore {
        fn load(&self) -> Result<Option<String>, DbKeyStoreError> {
            Ok(self.0.lock().unwrap().clone())
        }

        fn save(&self, envelope: &str) -> Result<(), DbKeyStoreError> {
            *self.0.lock().unwrap() = Some(envelope.to_string());
            Ok(())
        }
    }

    #[test]
    fn runtime_reports_only_redacted_health_metadata() {
        let temporary = tempfile::tempdir().unwrap();
        let runtime = LocalStoreRuntime::initialize(temporary.path(), &MemoryKeyStore::default());
        let status = runtime.status();
        assert_eq!(status.state, "READY");
        assert_eq!(status.schema_version, Some(1));
        assert_eq!(status.cipher_version.as_deref(), Some("4.14.0 community"));
        assert_eq!(status.issue, None);
        let json = serde_json::to_string(&status).unwrap();
        assert!(!json.contains("currentKey"));
        assert!(!json.contains("sqlite3"));
    }

    #[cfg(unix)]
    #[test]
    fn runtime_hardens_directory_and_database_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let temporary = tempfile::tempdir().unwrap();
        let directory = temporary.path().join("store");
        let runtime = LocalStoreRuntime::initialize(&directory, &MemoryKeyStore::default());
        assert_eq!(runtime.status().state, "READY");
        assert_eq!(
            fs::metadata(&directory).unwrap().permissions().mode() & 0o777,
            0o700
        );
        assert_eq!(
            fs::metadata(directory.join(STORE_FILE))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
}
