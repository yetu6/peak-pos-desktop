use std::{
    fs,
    path::{Path, PathBuf},
};

use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine as _};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zeroize::{Zeroize, Zeroizing};

mod authority;
mod eligibility;
mod migrations;
mod offline_pin;
pub mod runtime;

pub use authority::{
    AuthorizationPayload, AuthorizationStageResult, SignedAuthorizationBundle,
    SignedTerminalLifecycleEvent, StaffVerifierPayload, TerminalBinding, TerminalLifecyclePayload,
};
pub use eligibility::{OfflineEligibilityState, OfflineEligibilityStatus};
pub use offline_pin::{OfflineAuthenticationResult, OfflineAuthenticationState};

const KEY_BYTES: usize = 32;
const KEY_ENVELOPE_VERSION: u32 = 1;
const KEY_CHECK_DOMAIN: &[u8] = b"peak-pos-local-store-key-v1\0";

#[derive(Debug, Clone, Copy)]
pub struct DbKeyStoreError;

pub trait DbKeyStore: Send + Sync {
    fn load(&self) -> Result<Option<String>, DbKeyStoreError>;
    fn save(&self, envelope: &str) -> Result<(), DbKeyStoreError>;
}

#[derive(Debug, thiserror::Error)]
pub enum LocalStoreError {
    #[error("the encrypted local store key is unavailable")]
    MissingKey,
    #[error("the operating-system secure store is unavailable")]
    SecureStoreUnavailable,
    #[error("the encrypted local store key envelope is invalid")]
    InvalidKeyEnvelope,
    #[error("the encrypted local store could not be opened with this device key")]
    KeyMismatch,
    #[error("the local store path could not be prepared")]
    PathUnavailable(#[source] std::io::Error),
    #[error("the encrypted local store could not be initialized")]
    Initialization(#[source] rusqlite::Error),
    #[error("the local store is corrupt")]
    Corruption,
    #[error("the local store migration failed")]
    MigrationFailure,
    #[error("the local store has insufficient durable storage")]
    DiskFull,
    #[error("the local store integrity check failed")]
    IntegrityFailure,
    #[error("terminal authorization is required")]
    AuthorizationRequired,
    #[error("terminal authorization is invalid")]
    InvalidAuthorization,
    #[error("terminal authorization rollback was detected")]
    AuthorizationRollback,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LocalStoreErrorKind {
    MissingKey,
    SecureStoreUnavailable,
    InvalidKeyEnvelope,
    KeyMismatch,
    Corruption,
    MigrationFailure,
    DiskFull,
    IntegrityFailure,
    AuthorizationRequired,
    InvalidAuthorization,
    AuthorizationRollback,
}

impl LocalStoreError {
    pub fn kind(&self) -> LocalStoreErrorKind {
        match self {
            Self::MissingKey => LocalStoreErrorKind::MissingKey,
            Self::SecureStoreUnavailable | Self::PathUnavailable(_) => {
                LocalStoreErrorKind::SecureStoreUnavailable
            }
            Self::InvalidKeyEnvelope => LocalStoreErrorKind::InvalidKeyEnvelope,
            Self::KeyMismatch => LocalStoreErrorKind::KeyMismatch,
            Self::Corruption => LocalStoreErrorKind::Corruption,
            Self::MigrationFailure | Self::Initialization(_) => {
                LocalStoreErrorKind::MigrationFailure
            }
            Self::DiskFull => LocalStoreErrorKind::DiskFull,
            Self::IntegrityFailure => LocalStoreErrorKind::IntegrityFailure,
            Self::AuthorizationRequired => LocalStoreErrorKind::AuthorizationRequired,
            Self::InvalidAuthorization => LocalStoreErrorKind::InvalidAuthorization,
            Self::AuthorizationRollback => LocalStoreErrorKind::AuthorizationRollback,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DbKeyEnvelope {
    version: u32,
    generation: u64,
    state: KeyEnvelopeState,
    current_key: String,
    key_check: String,
    next_key: Option<String>,
    next_key_check: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum KeyEnvelopeState {
    Current,
    Prepared,
}

impl DbKeyEnvelope {
    fn new(key: &[u8]) -> Self {
        Self {
            version: KEY_ENVELOPE_VERSION,
            generation: 1,
            state: KeyEnvelopeState::Current,
            current_key: STANDARD_NO_PAD.encode(key),
            key_check: key_check(key),
            next_key: None,
            next_key_check: None,
        }
    }

    fn decode_current(&self) -> Result<Zeroizing<Vec<u8>>, LocalStoreError> {
        if self.version != KEY_ENVELOPE_VERSION || self.generation == 0 {
            return Err(LocalStoreError::InvalidKeyEnvelope);
        }
        decode_checked_key(&self.current_key, &self.key_check)
    }

    fn decode_next(&self) -> Result<Option<Zeroizing<Vec<u8>>>, LocalStoreError> {
        match (&self.next_key, &self.next_key_check) {
            (None, None) if self.state == KeyEnvelopeState::Current => Ok(None),
            (Some(key), Some(check)) if self.state == KeyEnvelopeState::Prepared => {
                decode_checked_key(key, check).map(Some)
            }
            _ => Err(LocalStoreError::InvalidKeyEnvelope),
        }
    }

    fn prepare(&mut self, next_key: &[u8]) {
        self.state = KeyEnvelopeState::Prepared;
        self.next_key = Some(STANDARD_NO_PAD.encode(next_key));
        self.next_key_check = Some(key_check(next_key));
    }

    fn promote(&mut self) -> Result<(), LocalStoreError> {
        let next_key = self
            .next_key
            .take()
            .ok_or(LocalStoreError::InvalidKeyEnvelope)?;
        let next_check = self
            .next_key_check
            .take()
            .ok_or(LocalStoreError::InvalidKeyEnvelope)?;
        self.current_key.zeroize();
        self.key_check.zeroize();
        self.current_key = next_key;
        self.key_check = next_check;
        self.generation += 1;
        self.state = KeyEnvelopeState::Current;
        Ok(())
    }
}

impl Drop for DbKeyEnvelope {
    fn drop(&mut self) {
        self.current_key.zeroize();
        self.key_check.zeroize();
        self.next_key.zeroize();
        self.next_key_check.zeroize();
    }
}

pub struct LocalStore {
    connection: Connection,
    cipher_version: String,
    schema_version: u32,
    path: PathBuf,
}

impl LocalStore {
    pub fn open(path: &Path, key_store: &impl DbKeyStore) -> Result<Self, LocalStoreError> {
        let already_initialized = path
            .metadata()
            .map(|metadata| metadata.len() > 0)
            .unwrap_or(false);
        let stored_envelope = key_store
            .load()
            .map_err(|_| LocalStoreError::SecureStoreUnavailable)?;

        let envelope = match stored_envelope {
            Some(value) => {
                let value = Zeroizing::new(value);
                serde_json::from_str::<DbKeyEnvelope>(&value)
                    .map_err(|_| LocalStoreError::InvalidKeyEnvelope)?
            }
            None if already_initialized => return Err(LocalStoreError::MissingKey),
            None => {
                let mut key = Zeroizing::new(vec![0_u8; KEY_BYTES]);
                getrandom::fill(&mut key).map_err(|_| LocalStoreError::SecureStoreUnavailable)?;
                let envelope = DbKeyEnvelope::new(&key);
                let serialized = Zeroizing::new(
                    serde_json::to_string(&envelope)
                        .map_err(|_| LocalStoreError::InvalidKeyEnvelope)?,
                );
                key_store
                    .save(&serialized)
                    .map_err(|_| LocalStoreError::SecureStoreUnavailable)?;
                envelope
            }
        };
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(LocalStoreError::PathUnavailable)?;
        }
        let current_key = envelope.decode_current()?;
        let next_key = envelope.decode_next()?;
        let (mut connection, opened_with_next) = if let Some(next_key) = next_key.as_ref() {
            match open_keyed(path, next_key) {
                Ok(connection) => (connection, true),
                Err(_) => (open_keyed(path, &current_key)?, false),
            }
        } else {
            (open_keyed(path, &current_key)?, false)
        };

        if envelope.state == KeyEnvelopeState::Prepared {
            let next_key = next_key.ok_or(LocalStoreError::InvalidKeyEnvelope)?;
            if !opened_with_next {
                rekey(&connection, &next_key)?;
            }
            harden_connection(&connection)?;
            integrity_check_connection(&connection)?;
            let mut promoted = envelope;
            promoted.promote()?;
            persist_envelope(key_store, &promoted)?;
            let recovery = recovery_path(path);
            if recovery.exists() {
                fs::remove_file(recovery).map_err(LocalStoreError::PathUnavailable)?;
            }
        }

        harden_connection(&connection)?;
        let schema_version = migrations::migrate(&mut connection)?;

        harden_file_permissions(path)?;
        let cipher_version = connection
            .query_row("PRAGMA cipher_version", [], |row| row.get(0))
            .map_err(LocalStoreError::Initialization)?;

        let store = Self {
            connection,
            cipher_version,
            schema_version,
            path: path.to_path_buf(),
        };
        store.integrity_check()?;
        let recovery = recovery_path(path);
        if recovery.exists() {
            fs::remove_file(recovery).map_err(LocalStoreError::PathUnavailable)?;
        }
        Ok(store)
    }

    pub fn cipher_version(&self) -> &str {
        &self.cipher_version
    }

    pub fn is_healthy(&self) -> bool {
        self.connection
            .query_row("SELECT 1", [], |row| row.get::<_, i64>(0))
            .is_ok()
    }

    pub fn integrity_check(&self) -> Result<(), LocalStoreError> {
        integrity_check_connection(&self.connection)
    }

    pub fn schema_version(&self) -> u32 {
        self.schema_version
    }

    pub fn rotate_key(&mut self, key_store: &impl DbKeyStore) -> Result<(), LocalStoreError> {
        let serialized = Zeroizing::new(
            key_store
                .load()
                .map_err(|_| LocalStoreError::SecureStoreUnavailable)?
                .ok_or(LocalStoreError::MissingKey)?,
        );
        let mut envelope: DbKeyEnvelope =
            serde_json::from_str(&serialized).map_err(|_| LocalStoreError::InvalidKeyEnvelope)?;
        if envelope.state != KeyEnvelopeState::Current {
            return Err(LocalStoreError::InvalidKeyEnvelope);
        }

        self.connection
            .execute_batch(
                "PRAGMA locking_mode = EXCLUSIVE;\
                 PRAGMA wal_checkpoint(TRUNCATE);\
                 PRAGMA journal_mode = DELETE;",
            )
            .map_err(classify_sql_error)?;
        let recovery_path = recovery_path(&self.path);
        fs::copy(&self.path, &recovery_path).map_err(LocalStoreError::PathUnavailable)?;
        harden_file_permissions(&recovery_path)?;

        let mut next_key = Zeroizing::new(vec![0_u8; KEY_BYTES]);
        getrandom::fill(&mut next_key).map_err(|_| LocalStoreError::SecureStoreUnavailable)?;
        envelope.prepare(&next_key);
        persist_envelope(key_store, &envelope)?;

        rekey(&self.connection, &next_key)?;
        harden_connection(&self.connection)?;
        self.integrity_check()?;
        envelope.promote()?;
        persist_envelope(key_store, &envelope)?;
        fs::remove_file(recovery_path).map_err(LocalStoreError::PathUnavailable)?;
        Ok(())
    }
}

fn integrity_check_connection(connection: &Connection) -> Result<(), LocalStoreError> {
    let cipher_rows = pragma_rows(connection, "PRAGMA cipher_integrity_check")?;
    if !cipher_rows.is_empty() && cipher_rows.iter().any(|row| row != "ok") {
        return Err(LocalStoreError::IntegrityFailure);
    }
    let sqlite_rows = pragma_rows(connection, "PRAGMA integrity_check")?;
    if sqlite_rows.as_slice() != ["ok"] {
        return Err(LocalStoreError::IntegrityFailure);
    }
    Ok(())
}

fn open_keyed(path: &Path, key: &[u8]) -> Result<Connection, LocalStoreError> {
    let connection = Connection::open(path).map_err(classify_sql_error)?;
    apply_key(&connection, key).map_err(LocalStoreError::Initialization)?;
    connection
        .query_row("SELECT count(*) FROM sqlite_master", [], |_| Ok(()))
        .map_err(|_| LocalStoreError::KeyMismatch)?;
    Ok(connection)
}

fn rekey(connection: &Connection, key: &[u8]) -> Result<(), LocalStoreError> {
    connection
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE;")
        .map_err(classify_sql_error)?;
    let key_hex = encode_hex(key);
    connection
        .execute_batch(&format!("PRAGMA rekey = \"x'{key_hex}'\";"))
        .map_err(classify_sql_error)
}

fn persist_envelope(
    key_store: &impl DbKeyStore,
    envelope: &DbKeyEnvelope,
) -> Result<(), LocalStoreError> {
    let serialized = Zeroizing::new(
        serde_json::to_string(envelope).map_err(|_| LocalStoreError::InvalidKeyEnvelope)?,
    );
    key_store
        .save(&serialized)
        .map_err(|_| LocalStoreError::SecureStoreUnavailable)
}

fn recovery_path(path: &Path) -> PathBuf {
    path.with_extension("sqlite3.rekey-recovery")
}

fn pragma_rows(connection: &Connection, pragma: &str) -> Result<Vec<String>, LocalStoreError> {
    let mut statement = connection.prepare(pragma).map_err(classify_sql_error)?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(classify_sql_error)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(classify_sql_error)
}

fn apply_key(connection: &Connection, key: &[u8]) -> Result<(), rusqlite::Error> {
    let key_hex = encode_hex(key);
    connection.execute_batch(&format!(
        "PRAGMA key = \"x'{key_hex}'\"; PRAGMA cipher_memory_security = ON;"
    ))
}

fn harden_connection(connection: &Connection) -> Result<(), LocalStoreError> {
    connection
        .execute_batch(
            "PRAGMA foreign_keys = ON;\
             PRAGMA journal_mode = WAL;\
             PRAGMA synchronous = FULL;\
             PRAGMA secure_delete = ON;\
             PRAGMA trusted_schema = OFF;\
             PRAGMA busy_timeout = 5000;",
        )
        .map_err(classify_sql_error)?;

    let foreign_keys: i64 = connection
        .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
        .map_err(classify_sql_error)?;
    let synchronous: i64 = connection
        .query_row("PRAGMA synchronous", [], |row| row.get(0))
        .map_err(classify_sql_error)?;
    let secure_delete: i64 = connection
        .query_row("PRAGMA secure_delete", [], |row| row.get(0))
        .map_err(classify_sql_error)?;
    let trusted_schema: i64 = connection
        .query_row("PRAGMA trusted_schema", [], |row| row.get(0))
        .map_err(classify_sql_error)?;
    if foreign_keys != 1 || synchronous != 2 || secure_delete != 1 || trusted_schema != 0 {
        return Err(LocalStoreError::Initialization(
            rusqlite::Error::InvalidQuery,
        ));
    }
    Ok(())
}

fn classify_sql_error(error: rusqlite::Error) -> LocalStoreError {
    use rusqlite::{Error, ErrorCode};

    match &error {
        Error::SqliteFailure(code, _) if code.code == ErrorCode::DiskFull => {
            LocalStoreError::DiskFull
        }
        Error::SqliteFailure(code, _)
            if matches!(
                code.code,
                ErrorCode::DatabaseCorrupt | ErrorCode::NotADatabase
            ) =>
        {
            LocalStoreError::Corruption
        }
        _ => LocalStoreError::MigrationFailure,
    }
}

fn key_check(key: &[u8]) -> String {
    let mut digest = Sha256::new();
    digest.update(KEY_CHECK_DOMAIN);
    digest.update(key);
    STANDARD_NO_PAD.encode(digest.finalize())
}

fn decode_checked_key(
    encoded: &str,
    expected_check: &str,
) -> Result<Zeroizing<Vec<u8>>, LocalStoreError> {
    let key = Zeroizing::new(
        STANDARD_NO_PAD
            .decode(encoded)
            .map_err(|_| LocalStoreError::InvalidKeyEnvelope)?,
    );
    if key.len() != KEY_BYTES
        || !constant_time_eq(key_check(&key).as_bytes(), expected_check.as_bytes())
    {
        return Err(LocalStoreError::InvalidKeyEnvelope);
    }
    Ok(key)
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0_u8, |difference, (a, b)| difference | (a ^ b))
        == 0
}

fn encode_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

#[cfg(unix)]
fn harden_file_permissions(path: &Path) -> Result<(), LocalStoreError> {
    use std::os::unix::fs::PermissionsExt;

    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(LocalStoreError::PathUnavailable)
}

#[cfg(not(unix))]
fn harden_file_permissions(_path: &Path) -> Result<(), LocalStoreError> {
    Ok(())
}
