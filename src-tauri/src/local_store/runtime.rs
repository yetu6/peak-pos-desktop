use std::{fs, path::Path, sync::Mutex};

use tauri::{AppHandle, Manager, State};

use super::{
    AddOrderItemIntent, AuthorizationStageResult, CatalogActivationResult, CreateOrderDraftIntent,
    LocalCatalogView, LocalOrderView, OfflineAuthenticationResult, OfflineEligibilityStatus,
    SignedAuthorizationBundle, SignedCatalogSnapshot, SignedTerminalLifecycleEvent,
    TerminalBinding, UpdateOrderContextIntent,
};
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

    fn with_store<T>(
        &self,
        operation: impl FnOnce(&mut LocalStore) -> Result<T, LocalStoreError>,
    ) -> Result<T, LocalStoreErrorKind> {
        match &self.state {
            RuntimeState::Ready(store) => {
                let mut store = store
                    .lock()
                    .map_err(|_| LocalStoreErrorKind::IntegrityFailure)?;
                operation(&mut store).map_err(|error| error.kind())
            }
            RuntimeState::Failed(issue) => Err(*issue),
        }
    }
}

#[tauri::command]
pub fn local_store_status(runtime: State<'_, LocalStoreRuntime>) -> LocalStoreStatus {
    runtime.status()
}

#[tauri::command]
pub fn bind_terminal_authority(
    runtime: State<'_, LocalStoreRuntime>,
    binding: TerminalBinding,
) -> Result<(), LocalStoreErrorKind> {
    runtime.with_store(|store| store.bind_terminal(binding))
}

#[tauri::command]
pub fn stage_offline_authorization(
    runtime: State<'_, LocalStoreRuntime>,
    envelope: SignedAuthorizationBundle,
) -> Result<AuthorizationStageResult, LocalStoreErrorKind> {
    runtime.with_store(|store| store.stage_authorization(envelope, now_ms()))
}

#[tauri::command]
pub fn apply_terminal_lifecycle_event(
    runtime: State<'_, LocalStoreRuntime>,
    envelope: SignedTerminalLifecycleEvent,
) -> Result<(), LocalStoreErrorKind> {
    runtime.with_store(|store| store.apply_terminal_lifecycle_event(envelope))
}

#[tauri::command]
pub fn authenticate_offline_staff(
    runtime: State<'_, LocalStoreRuntime>,
    staff_id: String,
    pin: String,
) -> Result<OfflineAuthenticationResult, LocalStoreErrorKind> {
    runtime.with_store(|store| store.authenticate_offline_staff(&staff_id, pin, now_ms()))
}

#[tauri::command]
pub fn offline_eligibility_status(
    runtime: State<'_, LocalStoreRuntime>,
    staff_id: Option<String>,
) -> Result<OfflineEligibilityStatus, LocalStoreErrorKind> {
    runtime.with_store(|store| store.offline_eligibility(staff_id.as_deref(), now_ms()))
}

#[tauri::command]
pub fn install_catalog_snapshot(
    runtime: State<'_, LocalStoreRuntime>,
    envelope: SignedCatalogSnapshot,
) -> Result<CatalogActivationResult, LocalStoreErrorKind> {
    runtime.with_store(|store| store.install_catalog_snapshot(envelope, now_ms()))
}

#[tauri::command]
pub fn get_local_catalog(
    runtime: State<'_, LocalStoreRuntime>,
    query: Option<String>,
    category_id: Option<String>,
) -> Result<LocalCatalogView, LocalStoreErrorKind> {
    runtime.with_store(|store| store.get_local_catalog(query.as_deref(), category_id.as_deref()))
}

#[tauri::command]
pub fn get_or_create_order_draft(
    runtime: State<'_, LocalStoreRuntime>,
    intent: CreateOrderDraftIntent,
) -> Result<LocalOrderView, LocalStoreErrorKind> {
    runtime.with_store(|store| store.get_or_create_order_draft(intent, now_ms()))
}

#[tauri::command]
pub fn update_order_context(
    runtime: State<'_, LocalStoreRuntime>,
    intent: UpdateOrderContextIntent,
) -> Result<LocalOrderView, LocalStoreErrorKind> {
    runtime.with_store(|store| store.update_order_context(intent, now_ms()))
}

#[tauri::command]
pub fn add_local_order_item(
    runtime: State<'_, LocalStoreRuntime>,
    intent: AddOrderItemIntent,
) -> Result<LocalOrderView, LocalStoreErrorKind> {
    runtime.with_store(|store| store.add_order_item(intent, now_ms()))
}

#[tauri::command]
pub fn set_local_order_line_quantity(
    runtime: State<'_, LocalStoreRuntime>,
    order_id: String,
    line_id: String,
    quantity: i64,
    expected_version: i64,
) -> Result<LocalOrderView, LocalStoreErrorKind> {
    runtime.with_store(|store| {
        store.set_order_line_quantity(&order_id, &line_id, quantity, expected_version, now_ms())
    })
}

#[tauri::command]
pub fn remove_local_order_line(
    runtime: State<'_, LocalStoreRuntime>,
    order_id: String,
    line_id: String,
    expected_version: i64,
) -> Result<LocalOrderView, LocalStoreErrorKind> {
    runtime.with_store(|store| {
        store.remove_order_line(&order_id, &line_id, expected_version, now_ms())
    })
}

#[tauri::command]
pub fn get_local_order(
    runtime: State<'_, LocalStoreRuntime>,
    order_id: String,
) -> Result<LocalOrderView, LocalStoreErrorKind> {
    runtime.with_store(|store| store.get_order_draft(&order_id))
}

#[tauri::command]
pub fn discard_empty_local_order(
    runtime: State<'_, LocalStoreRuntime>,
    order_id: String,
    expected_version: i64,
) -> Result<(), LocalStoreErrorKind> {
    runtime
        .with_store(|store| store.discard_empty_order_draft(&order_id, expected_version, now_ms()))
}

#[tauri::command]
pub fn commit_local_order(
    app: AppHandle,
    runtime: State<'_, LocalStoreRuntime>,
    order_id: String,
    expected_version: i64,
) -> Result<LocalOrderView, LocalStoreErrorKind> {
    runtime.with_store(|store| {
        store.commit_order(&order_id, expected_version, now_ms(), |digest| {
            crate::identity::sign_device_operation(&app, digest)
                .map_err(|_| LocalStoreError::SigningFailure)
        })
    })
}

#[tauri::command]
pub fn clear_active_staff_session(
    runtime: State<'_, LocalStoreRuntime>,
) -> Result<(), LocalStoreErrorKind> {
    runtime.with_store(|store| {
        store.clear_active_staff();
        Ok(())
    })
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| i64::try_from(duration.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or(0)
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
        assert_eq!(status.schema_version, Some(3));
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
