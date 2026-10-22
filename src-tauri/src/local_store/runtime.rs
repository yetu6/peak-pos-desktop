use std::{fs, path::Path, sync::Mutex};

use tauri::{AppHandle, Manager, State};

use super::{
    AddOrderItemIntent, AuthorizationStageResult, CatalogActivationResult, CreateOrderDraftIntent,
    ExpectedTerminalIdentity, LocalCatalogView, LocalOrderView, OfflineAuthenticationResult,
    OfflineBootstrapResult, OfflineCashCommitResult, OfflineEligibilityStatus,
    ServerOfflineBootstrap, SignedAuthorizationBundle, SignedCatalogSnapshot,
    SignedTerminalLifecycleEvent, TerminalBinding, UpdateOrderContextIntent,
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

    pub(crate) fn with_store<T>(
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
pub fn get_sync_state(
    runtime: State<'_, LocalStoreRuntime>,
) -> Result<super::SyncState, LocalStoreErrorKind> {
    runtime.with_store(|store| store.sync_state())
}

#[tauri::command]
pub async fn retry_sync(
    runtime: State<'_, LocalStoreRuntime>,
    base_url: String,
    bearer_token: String,
) -> Result<super::SyncState, String> {
    let client = reqwest::Client::new();
    let operations = runtime
        .with_store(|store| store.pending_sync_batch(now_ms()))
        .map_err(|error| format!("{error:?}"))?;
    let keyset_url = format!(
        "{}/api/v1/pos/offline/trust-keyset",
        base_url.trim_end_matches('/')
    );
    let keyset_response = client
        .get(keyset_url)
        .bearer_auth(&bearer_token)
        .send()
        .await;
    let Ok(keyset_response) = keyset_response else {
        return runtime
            .with_store(|store| store.record_sync_unavailable(now_ms()))
            .map_err(|error| format!("{error:?}"));
    };
    if !keyset_response.status().is_success() {
        return runtime
            .with_store(|store| store.record_sync_unavailable(now_ms()))
            .map_err(|error| format!("{error:?}"));
    }
    let keyset: super::OfflinePublicKeyset = match keyset_response.json().await {
        Ok(keyset) => keyset,
        Err(_) => {
            return runtime
                .with_store(|store| store.record_sync_issue("SYNC_KEYSET_INVALID", now_ms()))
                .map_err(|error| format!("{error:?}"));
        }
    };
    // F-262: before a shift has vouched for the till's clock this waits; it is not a sync issue.
    match runtime.with_store(|store| {
        store.take_offline_keyset(&keyset, now_ms(), monotonic_ms(), &boot_id())
    }) {
        Ok(Some(state)) => return Ok(state),
        Ok(None) => {}
        Err(error) => return Err(format!("{error:?}")),
    }
    if operations.is_empty() {
        return runtime
            .with_store(|store| store.record_sync_live(now_ms()))
            .map_err(|error| format!("{error:?}"));
    }
    let url = format!(
        "{}/api/v1/pos/offline/reconcile",
        base_url.trim_end_matches('/')
    );
    let response = client
        .post(url)
        .bearer_auth(bearer_token)
        .json(&serde_json::json!({"operations": operations}))
        .send()
        .await;
    let Ok(response) = response else {
        return runtime
            .with_store(|store| store.record_sync_unavailable(now_ms()))
            .map_err(|error| format!("{error:?}"));
    };
    if !response.status().is_success() {
        return runtime
            .with_store(|store| store.record_sync_unavailable(now_ms()))
            .map_err(|error| format!("{error:?}"));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|_| "SYNC_RESPONSE_UNAVAILABLE".to_string())?;
    let decoded: super::ReconcileResponse =
        serde_json::from_slice(&bytes).map_err(|_| "SYNC_RESPONSE_INVALID".to_string())?;
    runtime
        .with_store(|store| store.apply_sync_results(&decoded.results, &bytes, now_ms()))
        .map_err(|error| format!("{error:?}"))
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
    runtime.with_store(|store| {
        let now = trusted_now(store)?;
        store.authenticate_offline_staff(&staff_id, pin, now)
    })
}

#[tauri::command]
pub fn get_offline_staff_roster(
    runtime: State<'_, LocalStoreRuntime>,
) -> Result<Vec<super::OfflineStaffRosterEntry>, LocalStoreErrorKind> {
    runtime.with_store(|store| {
        let now = trusted_now(store)?;
        store.offline_staff_roster(now)
    })
}

#[tauri::command]
pub fn offline_eligibility_status(
    runtime: State<'_, LocalStoreRuntime>,
    staff_id: Option<String>,
) -> Result<OfflineEligibilityStatus, LocalStoreErrorKind> {
    runtime.with_store(|store| {
        let now = trusted_now(store)?;
        store.offline_eligibility(staff_id.as_deref(), now)
    })
}

#[tauri::command]
pub fn install_catalog_snapshot(
    runtime: State<'_, LocalStoreRuntime>,
    envelope: SignedCatalogSnapshot,
) -> Result<CatalogActivationResult, LocalStoreErrorKind> {
    runtime.with_store(|store| store.install_catalog_snapshot(envelope, now_ms()))
}

#[tauri::command]
pub fn install_offline_bootstrap(
    runtime: State<'_, LocalStoreRuntime>,
    expected_terminal_id: String,
    expected_property_id: String,
    expected_outlet_id: String,
    bootstrap: ServerOfflineBootstrap,
) -> Result<OfflineBootstrapResult, LocalStoreErrorKind> {
    runtime.with_store(|store| {
        store.install_online_bootstrap(
            ExpectedTerminalIdentity {
                terminal_id: &expected_terminal_id,
                property_id: &expected_property_id,
                outlet_id: &expected_outlet_id,
            },
            bootstrap,
            now_ms(),
            monotonic_ms(),
            &boot_id(),
        )
    })
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
    runtime.with_store(|store| {
        let now = trusted_now(store)?;
        store.get_or_create_order_draft(intent, now)
    })
}

#[tauri::command]
pub fn update_order_context(
    runtime: State<'_, LocalStoreRuntime>,
    intent: UpdateOrderContextIntent,
) -> Result<LocalOrderView, LocalStoreErrorKind> {
    runtime.with_store(|store| {
        let now = trusted_now(store)?;
        store.update_order_context(intent, now)
    })
}

#[tauri::command]
pub fn add_local_order_item(
    runtime: State<'_, LocalStoreRuntime>,
    intent: AddOrderItemIntent,
) -> Result<LocalOrderView, LocalStoreErrorKind> {
    runtime.with_store(|store| {
        let now = trusted_now(store)?;
        store.add_order_item(intent, now)
    })
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
        let now = trusted_now(store)?;
        store.set_order_line_quantity(&order_id, &line_id, quantity, expected_version, now)
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
        let now = trusted_now(store)?;
        store.remove_order_line(&order_id, &line_id, expected_version, now)
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
    runtime.with_store(|store| {
        let now = trusted_now(store)?;
        store.discard_empty_order_draft(&order_id, expected_version, now)
    })
}

#[tauri::command]
pub fn commit_local_order(
    app: AppHandle,
    runtime: State<'_, LocalStoreRuntime>,
    order_id: String,
    expected_version: i64,
) -> Result<LocalOrderView, LocalStoreErrorKind> {
    runtime.with_store(|store| {
        let now = trusted_now(store)?;
        store.commit_order(&order_id, expected_version, now, |digest| {
            crate::identity::sign_device_operation(&app, digest)
                .map_err(|_| LocalStoreError::SigningFailure)
        })
    })
}

#[tauri::command]
pub fn commit_offline_cash_sale(
    app: AppHandle,
    runtime: State<'_, LocalStoreRuntime>,
    order_id: String,
    expected_version: i64,
    cash_received_minor: i64,
) -> Result<OfflineCashCommitResult, LocalStoreErrorKind> {
    runtime.with_store(|store| {
        let now = trusted_now(store)?;
        store.commit_offline_cash_sale(
            &order_id,
            expected_version,
            cash_received_minor,
            now,
            |message| {
                crate::identity::sign_device_operation(&app, message)
                    .map_err(|_| LocalStoreError::SigningFailure)
            },
        )
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

fn trusted_now(store: &mut LocalStore) -> Result<i64, LocalStoreError> {
    store.trusted_now_ms(now_ms(), monotonic_ms(), &boot_id())
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| i64::try_from(duration.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}

#[cfg(target_os = "linux")]
fn monotonic_ms() -> i64 {
    fs::read_to_string("/proc/uptime")
        .ok()
        .and_then(|value| value.split_whitespace().next()?.parse::<f64>().ok())
        .map(|seconds| (seconds * 1000.0) as i64)
        .unwrap_or(0)
}
#[cfg(target_os = "windows")]
fn monotonic_ms() -> i64 {
    unsafe extern "system" {
        fn GetTickCount64() -> u64;
    }
    i64::try_from(unsafe { GetTickCount64() }).unwrap_or(i64::MAX)
}
#[cfg(target_os = "macos")]
fn monotonic_ms() -> i64 {
    #[repr(C)]
    struct TimebaseInfo {
        numer: u32,
        denom: u32,
    }
    unsafe extern "C" {
        fn mach_continuous_time() -> u64;
        fn mach_timebase_info(info: *mut TimebaseInfo) -> i32;
    }
    let mut info = TimebaseInfo { numer: 0, denom: 0 };
    if unsafe { mach_timebase_info(&mut info) } != 0 || info.denom == 0 {
        return 0;
    }
    let nanos = u128::from(unsafe { mach_continuous_time() })
        .saturating_mul(u128::from(info.numer))
        / u128::from(info.denom);
    i64::try_from(nanos / 1_000_000).unwrap_or(i64::MAX)
}
#[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
fn monotonic_ms() -> i64 {
    0
}

#[cfg(target_os = "linux")]
fn boot_id() -> String {
    fs::read_to_string("/proc/sys/kernel/random/boot_id")
        .map(|value| value.trim().to_string())
        .unwrap_or_else(|_| "unknown-linux-boot".into())
}
#[cfg(any(target_os = "windows", target_os = "macos"))]
fn boot_id() -> String {
    // The rounded wall/uptime-derived boot epoch remains stable across app
    // restarts. Any material wall-clock rollback changes the marker and fails
    // the trusted-time gate closed.
    let boot_epoch_minutes = now_ms().saturating_sub(monotonic_ms()) / 60_000;
    format!("platform-boot-{boot_epoch_minutes}")
}
#[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
fn boot_id() -> String {
    "unsupported-platform-boot".into()
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
    fn store_opens_with_the_platform_memory_security_setting() {
        let temporary = tempfile::tempdir().unwrap();
        let store = LocalStore::open(
            &temporary.path().join(STORE_FILE),
            &MemoryKeyStore::default(),
        )
        .unwrap();
        let enabled: String = store
            .connection
            .query_row("PRAGMA cipher_memory_security", [], |row| row.get(0))
            .unwrap();
        assert_eq!(
            enabled,
            if cfg!(target_os = "windows") {
                "0"
            } else {
                "1"
            }
        );
    }

    #[test]
    fn runtime_reports_only_redacted_health_metadata() {
        let temporary = tempfile::tempdir().unwrap();
        let runtime = LocalStoreRuntime::initialize(temporary.path(), &MemoryKeyStore::default());
        let status = runtime.status();
        assert_eq!(status.state, "READY");
        assert_eq!(status.schema_version, Some(6));
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
