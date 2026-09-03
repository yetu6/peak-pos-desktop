use std::sync::{Arc, Mutex};

use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine as _};
use peak_pos_desktop_lib::local_store::{
    DbKeyStore, DbKeyStoreError, LocalStore, LocalStoreErrorKind,
};
use rusqlite::Connection;

#[derive(Clone, Default)]
struct MemoryKeyStore {
    value: Arc<Mutex<Option<String>>>,
}

impl DbKeyStore for MemoryKeyStore {
    fn load(&self) -> Result<Option<String>, DbKeyStoreError> {
        Ok(self.value.lock().expect("key store lock").clone())
    }

    fn save(&self, envelope: &str) -> Result<(), DbKeyStoreError> {
        *self.value.lock().expect("key store lock") = Some(envelope.to_string());
        Ok(())
    }
}

#[test]
fn first_boot_creates_encrypted_database_and_reopens_with_same_envelope() {
    let directory = tempfile::tempdir().expect("temporary directory");
    let path = directory.path().join("peak-local.sqlite3");
    let keys = MemoryKeyStore::default();

    let first = LocalStore::open(&path, &keys).expect("first encrypted open");
    assert_eq!(first.cipher_version(), "4.14.0 community");
    assert_eq!(first.schema_version(), 1);
    drop(first);

    let envelope = keys
        .load()
        .expect("load key envelope")
        .expect("first boot persisted key envelope");
    let value: serde_json::Value = serde_json::from_str(&envelope).expect("valid envelope JSON");
    let current = value["currentKey"]
        .as_str()
        .expect("current key is present");
    assert_eq!(
        STANDARD_NO_PAD.decode(current).expect("base64 key").len(),
        32
    );

    let unkeyed = Connection::open(&path).expect("open database handle without key");
    assert!(
        unkeyed
            .query_row("SELECT count(*) FROM sqlite_master", [], |row| row
                .get::<_, i64>(0))
            .is_err(),
        "unkeyed SQLite must not inspect the encrypted schema"
    );
    drop(unkeyed);

    let reopened = LocalStore::open(&path, &keys).expect("restart with persisted key");
    assert_eq!(reopened.cipher_version(), "4.14.0 community");
}

#[test]
fn existing_database_fails_closed_without_key_and_preserves_bytes() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("peak-local.sqlite3");
    let keys = MemoryKeyStore::default();
    drop(LocalStore::open(&path, &keys).unwrap());
    let before = std::fs::read(&path).unwrap();

    let missing = MemoryKeyStore::default();
    let error = LocalStore::open(&path, &missing)
        .err()
        .expect("must fail closed");
    assert_eq!(error.kind(), LocalStoreErrorKind::MissingKey);
    assert_eq!(std::fs::read(&path).unwrap(), before);
}

#[test]
fn malformed_envelope_fails_closed_and_preserves_existing_database() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("peak-local.sqlite3");
    let keys = MemoryKeyStore::default();
    drop(LocalStore::open(&path, &keys).unwrap());
    let before = std::fs::read(&path).unwrap();
    keys.save(r#"{"version":1,"generation":1,"currentKey":"bad","keyCheck":"bad"}"#)
        .unwrap();

    let error = LocalStore::open(&path, &keys)
        .err()
        .expect("must fail closed");
    assert_eq!(error.kind(), LocalStoreErrorKind::InvalidKeyEnvelope);
    assert_eq!(std::fs::read(&path).unwrap(), before);
}

#[test]
fn another_valid_device_key_cannot_replace_existing_database() {
    let directory = tempfile::tempdir().unwrap();
    let first_path = directory.path().join("first.sqlite3");
    let second_path = directory.path().join("second.sqlite3");
    let first_keys = MemoryKeyStore::default();
    let second_keys = MemoryKeyStore::default();
    drop(LocalStore::open(&first_path, &first_keys).unwrap());
    drop(LocalStore::open(&second_path, &second_keys).unwrap());
    let before = std::fs::read(&first_path).unwrap();

    let error = LocalStore::open(&first_path, &second_keys)
        .err()
        .expect("wrong key must fail");
    assert_eq!(error.kind(), LocalStoreErrorKind::KeyMismatch);
    assert_eq!(std::fs::read(&first_path).unwrap(), before);
}

struct UnavailableKeyStore;

impl DbKeyStore for UnavailableKeyStore {
    fn load(&self) -> Result<Option<String>, DbKeyStoreError> {
        Err(DbKeyStoreError)
    }

    fn save(&self, _envelope: &str) -> Result<(), DbKeyStoreError> {
        Err(DbKeyStoreError)
    }
}

#[test]
fn unavailable_secure_store_does_not_create_a_database() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("peak-local.sqlite3");
    let error = LocalStore::open(&path, &UnavailableKeyStore)
        .err()
        .expect("must fail closed");
    assert_eq!(error.kind(), LocalStoreErrorKind::SecureStoreUnavailable);
    assert!(!path.exists());
}

#[test]
fn key_rotation_rekeys_database_and_rejects_old_envelope() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("peak-local.sqlite3");
    let keys = MemoryKeyStore::default();
    let mut store = LocalStore::open(&path, &keys).unwrap();
    let old_envelope = keys.load().unwrap().unwrap();

    store.rotate_key(&keys).expect("rotate key");
    let new_envelope = keys.load().unwrap().unwrap();
    assert_ne!(old_envelope, new_envelope);
    drop(store);
    assert_eq!(LocalStore::open(&path, &keys).unwrap().schema_version(), 1);

    let old_keys = MemoryKeyStore::default();
    old_keys.save(&old_envelope).unwrap();
    assert_eq!(
        LocalStore::open(&path, &old_keys).err().unwrap().kind(),
        LocalStoreErrorKind::KeyMismatch
    );
}

#[derive(Clone, Default)]
struct InterruptibleKeyStore {
    value: Arc<Mutex<Option<String>>>,
    fail_on_save: Arc<Mutex<Option<usize>>>,
    saves: Arc<Mutex<usize>>,
}

impl DbKeyStore for InterruptibleKeyStore {
    fn load(&self) -> Result<Option<String>, DbKeyStoreError> {
        Ok(self.value.lock().unwrap().clone())
    }

    fn save(&self, envelope: &str) -> Result<(), DbKeyStoreError> {
        let mut saves = self.saves.lock().unwrap();
        *saves += 1;
        if self.fail_on_save.lock().unwrap().as_ref() == Some(&*saves) {
            return Err(DbKeyStoreError);
        }
        *self.value.lock().unwrap() = Some(envelope.to_string());
        Ok(())
    }
}

#[test]
fn restart_recovers_rotation_interrupted_after_rekey() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("peak-local.sqlite3");
    let keys = InterruptibleKeyStore::default();
    let mut store = LocalStore::open(&path, &keys).unwrap();
    *keys.fail_on_save.lock().unwrap() = Some(3);

    let error = match store.rotate_key(&keys) {
        Err(error) => error,
        Ok(()) => panic!("rotation should stop at the injected promotion interruption"),
    };
    assert_eq!(error.kind(), LocalStoreErrorKind::SecureStoreUnavailable);
    drop(store);
    assert!(path.with_extension("sqlite3.rekey-recovery").exists());

    *keys.fail_on_save.lock().unwrap() = None;
    let recovered = LocalStore::open(&path, &keys).expect("recover prepared rotation");
    assert_eq!(recovered.schema_version(), 1);
    assert!(!path.with_extension("sqlite3.rekey-recovery").exists());
}
