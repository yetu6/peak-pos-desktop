// Windows CI: see tests/terminal_authority.rs. The same real-file store
// mechanism; the timing and logic tests in src/local_store/sign_in_kit.rs run
// on every system.
#![cfg(not(target_os = "windows"))]

use std::sync::{Arc, Mutex};

use argon2::{password_hash::PasswordHasher, Argon2};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::{Signer, SigningKey};
use peak_pos_desktop_lib::local_store::{
    DbKeyStore, DbKeyStoreError, LocalStore, SignInCheck, TerminalBinding,
};

#[derive(Clone, Default)]
struct MemoryKeyStore(Arc<Mutex<Option<String>>>);

impl DbKeyStore for MemoryKeyStore {
    fn load(&self) -> Result<Option<String>, DbKeyStoreError> {
        Ok(self.0.lock().unwrap().clone())
    }
    fn save(&self, envelope: &str) -> Result<(), DbKeyStoreError> {
        *self.0.lock().unwrap() = Some(envelope.to_string());
        Ok(())
    }
}

const NOW: i64 = 1_800_000_000_000;

#[test]
fn the_kit_lives_in_the_encrypted_store_and_survives_a_reopen() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("store.sqlite3");
    let keys = MemoryKeyStore::default();
    let signer = SigningKey::from_bytes(&[7_u8; 32]);
    let phc = Argon2::default().hash_password(b"2468").unwrap().to_string();

    let mut store = LocalStore::open(&path, &keys).unwrap();
    store
        .bind_terminal(TerminalBinding {
            terminal_id: "terminal-1".into(),
            credential_epoch: 4,
            property_id: "property-1".into(),
            outlet_id: "outlet-1".into(),
            register_id: "register-1".into(),
            trust_key_id: "server-key-1".into(),
            trust_public_key_b64: URL_SAFE_NO_PAD.encode(signer.verifying_key().to_bytes()),
            configuration_payload_b64: URL_SAFE_NO_PAD.encode(b"configuration-v1"),
            revocation_generation: 2,
            paired_at_ms: NOW,
        })
        .unwrap();
    let payload = serde_json::to_vec(&serde_json::json!({
        "terminalId": "terminal-1", "issuedAtMs": NOW - 1_000, "expiresAtMs": NOW + 86_400_000,
        "nonce": "n", "serverTimeMs": NOW, "identityEpoch": 4,
        "staff": [{"staffId": "staff-1", "displayName": "Amina Hassan Zebaki", "needsSetup": false,
                   "tillCopyPhc": phc, "copyVersion": "v1", "maxAttempts": 5,
                   "baseLockoutMs": 60000, "roleCode": "POS_CASHIER", "permissions": []}],
        "terminal": {"mode": "BAR", "prepStations": [], "propertyName": "Casanova Property",
                     "outletName": "Bar", "terminalName": "Main till", "capabilities": {}},
    }))
    .unwrap();
    let mut message = b"peak-pos-sign-in-kit-v1\0".to_vec();
    message.extend_from_slice(&payload);
    store
        .install_sign_in_kit(
            &URL_SAFE_NO_PAD.encode(&payload),
            &URL_SAFE_NO_PAD.encode(signer.sign(&message).to_bytes()),
            "server-key-1",
            NOW,
        )
        .unwrap();
    drop(store);

    // The names and the copy are not readable in the file on disk.
    let mut raw = std::fs::read(&path).unwrap();
    for extra in ["store.sqlite3-wal", "store.sqlite3-shm"] {
        if let Ok(more) = std::fs::read(directory.path().join(extra)) {
            raw.extend(more);
        }
    }
    let contains = |needle: &[u8]| raw.windows(needle.len()).any(|w| w == needle);
    assert!(!contains(b"Amina Hassan Zebaki"));
    assert!(!contains(b"Casanova Property"));
    assert!(!contains(b"$argon2id"));

    let mut reopened = LocalStore::open(&path, &keys).unwrap();
    assert!(matches!(
        reopened.verify_sign_in_pin("staff-1", "2468".into(), NOW).unwrap(),
        SignInCheck::Ok { .. }
    ));
}
