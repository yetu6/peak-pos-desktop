use std::sync::{Arc, Mutex};

use argon2::{password_hash::PasswordHasher, Argon2};
use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine as _};
use ed25519_dalek::{Signer, SigningKey};
use peak_pos_desktop_lib::local_store::{
    AuthorizationPayload, DbKeyStore, DbKeyStoreError, LocalStore, OfflineEligibilityState,
    SignedAuthorizationBundle, SignedTerminalLifecycleEvent, StaffVerifierPayload, TerminalBinding,
    TerminalLifecyclePayload,
};

const AUTH_DOMAIN: &[u8] = b"peak-pos-offline-authorization-v1\0";
const LIFECYCLE_DOMAIN: &[u8] = b"peak-pos-terminal-lifecycle-v1\0";

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

fn open_store() -> (tempfile::TempDir, LocalStore) {
    let directory = tempfile::tempdir().unwrap();
    let store = LocalStore::open(
        &directory.path().join("store.sqlite3"),
        &MemoryKeyStore::default(),
    )
    .unwrap();
    (directory, store)
}

fn binding(signing_key: &SigningKey) -> TerminalBinding {
    TerminalBinding {
        terminal_id: "terminal-1".into(),
        credential_epoch: 4,
        property_id: "property-1".into(),
        outlet_id: "outlet-1".into(),
        register_id: "register-1".into(),
        trust_key_id: "server-key-1".into(),
        trust_public_key_b64: STANDARD_NO_PAD.encode(signing_key.verifying_key().to_bytes()),
        configuration_payload_b64: STANDARD_NO_PAD.encode(b"configuration-v1"),
        revocation_generation: 2,
        paired_at_ms: 1_800_000_000_000,
    }
}

fn signed_bundle(signing_key: &SigningKey) -> SignedAuthorizationBundle {
    let verifier = Argon2::default()
        .hash_password(b"2468")
        .unwrap()
        .to_string();
    let payload = AuthorizationPayload {
        protocol_version: 1,
        schema_version: 1,
        bundle_id: "bundle-5".into(),
        generation: 5,
        lease_id: "lease-5".into(),
        terminal_id: "terminal-1".into(),
        credential_epoch: 4,
        property_id: "property-1".into(),
        outlet_id: "outlet-1".into(),
        register_id: "register-1".into(),
        shift_id: "shift-7".into(),
        business_date: "2026-09-03".into(),
        catalog_version: "catalog-8".into(),
        catalog_digest: "sha256:catalog".into(),
        issued_at_ms: 1_800_000_000_000,
        not_before_ms: 1_800_000_000_000,
        refresh_after_ms: 1_800_003_600_000,
        hard_expires_at_ms: 1_800_007_200_000,
        server_time_ms: 1_800_000_000_000,
        revocation_generation: 2,
        max_operation_count: 50,
        max_gross_minor: 500_000,
        max_cash_minor: 500_000,
        allowed_operations: vec!["ORDER_COMMIT".into(), "CASH_SETTLE".into()],
        tender_methods: vec!["CASH".into()],
        shift_opened_at_ms: 1_799_996_400_000,
        property_timezone: "Africa/Dar_es_Salaam".into(),
        staff: vec![StaffVerifierPayload {
            staff_id: "staff-1".into(),
            display_name: "Amina Hassan".into(),
            verifier_phc: verifier,
            permissions: vec!["pos.order.create".into(), "pos.payment.record".into()],
            expires_at_ms: 1_800_007_200_000,
            max_attempts: 5,
            base_lockout_ms: 1_000,
        }],
    };
    let payload = serde_json::to_vec(&payload).unwrap();
    let mut message = AUTH_DOMAIN.to_vec();
    message.extend_from_slice(&payload);
    SignedAuthorizationBundle {
        key_id: "server-key-1".into(),
        algorithm: "Ed25519".into(),
        signature_version: 1,
        payload_b64: STANDARD_NO_PAD.encode(payload),
        signature_b64: STANDARD_NO_PAD.encode(signing_key.sign(&message).to_bytes()),
    }
}

fn resign_payload(
    signing_key: &SigningKey,
    payload: AuthorizationPayload,
) -> SignedAuthorizationBundle {
    let payload = serde_json::to_vec(&payload).unwrap();
    let mut message = AUTH_DOMAIN.to_vec();
    message.extend_from_slice(&payload);
    SignedAuthorizationBundle {
        key_id: "server-key-1".into(),
        algorithm: "Ed25519".into(),
        signature_version: 1,
        payload_b64: STANDARD_NO_PAD.encode(payload),
        signature_b64: STANDARD_NO_PAD.encode(signing_key.sign(&message).to_bytes()),
    }
}

fn decode_payload(bundle: &SignedAuthorizationBundle) -> AuthorizationPayload {
    serde_json::from_slice(&STANDARD_NO_PAD.decode(&bundle.payload_b64).unwrap()).unwrap()
}

#[test]
fn valid_signed_bundle_is_staged_but_waits_for_its_catalog() {
    let (_directory, mut store) = open_store();
    let signing_key = SigningKey::from_bytes(&[7_u8; 32]);
    store.bind_terminal(binding(&signing_key)).unwrap();

    let result = store
        .stage_authorization(signed_bundle(&signing_key), 1_800_000_000_500)
        .unwrap();

    assert_eq!(result.state, "STAGED");
    assert_eq!(result.staff_count, 1);
    assert_eq!(result.prerequisite, Some("CATALOG_REQUIRED"));
}

#[test]
fn terminal_binding_rejects_credential_epoch_rollback() {
    let (_directory, mut store) = open_store();
    let signing_key = SigningKey::from_bytes(&[7_u8; 32]);
    store.bind_terminal(binding(&signing_key)).unwrap();
    let mut older = binding(&signing_key);
    older.credential_epoch = 3;
    assert!(store.bind_terminal(older).is_err());
}

#[test]
fn authorization_rejects_tampering_and_generation_rollback() {
    let (_directory, mut store) = open_store();
    let signing_key = SigningKey::from_bytes(&[7_u8; 32]);
    store.bind_terminal(binding(&signing_key)).unwrap();
    let valid = signed_bundle(&signing_key);

    let mut tampered = valid.clone();
    let mut bytes = STANDARD_NO_PAD.decode(&tampered.payload_b64).unwrap();
    bytes[10] ^= 1;
    tampered.payload_b64 = STANDARD_NO_PAD.encode(bytes);
    assert!(store
        .stage_authorization(tampered, 1_800_000_000_100)
        .is_err());

    store
        .stage_authorization(valid.clone(), 1_800_000_000_500)
        .unwrap();
    let mut rollback = decode_payload(&valid);
    rollback.bundle_id = "bundle-rollback".into();
    rollback.generation = 4;
    assert!(store
        .stage_authorization(resign_payload(&signing_key, rollback), 1_800_000_000_600)
        .is_err());
}

#[test]
fn authorization_rejects_unbounded_pin_verifier_parameters() {
    let (_directory, mut store) = open_store();
    let signing_key = SigningKey::from_bytes(&[7_u8; 32]);
    store.bind_terminal(binding(&signing_key)).unwrap();
    let mut payload = decode_payload(&signed_bundle(&signing_key));
    payload.staff[0].verifier_phc = "$argon2id$v=19$m=999999,t=2,p=1$c2FsdA$aGFzaA".into();

    assert!(store
        .stage_authorization(resign_payload(&signing_key, payload), 1_800_000_000_500)
        .is_err());
}

#[test]
fn staged_terminal_authority_survives_an_encrypted_store_restart() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("store.sqlite3");
    let key_store = MemoryKeyStore::default();
    let signing_key = SigningKey::from_bytes(&[7_u8; 32]);
    {
        let mut store = LocalStore::open(&path, &key_store).unwrap();
        store.bind_terminal(binding(&signing_key)).unwrap();
        store
            .stage_authorization(signed_bundle(&signing_key), 1_800_000_000_500)
            .unwrap();
    }

    let reopened = LocalStore::open(&path, &key_store).unwrap();
    let status = reopened
        .offline_eligibility(Some("staff-1"), 1_800_000_001_000)
        .unwrap();
    assert_eq!(status.state, OfflineEligibilityState::CatalogRequired);
}

#[test]
fn signed_revocation_invalidates_terminal_and_every_local_authority() {
    let (_directory, mut store) = open_store();
    let signing_key = SigningKey::from_bytes(&[7_u8; 32]);
    store.bind_terminal(binding(&signing_key)).unwrap();
    store
        .stage_authorization(signed_bundle(&signing_key), 1_800_000_000_500)
        .unwrap();

    let payload = serde_json::to_vec(&TerminalLifecyclePayload {
        protocol_version: 1,
        event_id: "event-3".into(),
        terminal_id: "terminal-1".into(),
        credential_epoch: 4,
        generation: 3,
        state: "REVOKED".into(),
        reason: "device reported lost".into(),
        effective_at_ms: 1_800_000_001_000,
    })
    .unwrap();
    let mut message = LIFECYCLE_DOMAIN.to_vec();
    message.extend_from_slice(&payload);
    let event = SignedTerminalLifecycleEvent {
        key_id: "server-key-1".into(),
        payload_b64: STANDARD_NO_PAD.encode(payload),
        signature_b64: STANDARD_NO_PAD.encode(signing_key.sign(&message).to_bytes()),
    };
    store.apply_terminal_lifecycle_event(event.clone()).unwrap();
    store.apply_terminal_lifecycle_event(event).unwrap();

    let status = store
        .offline_eligibility(Some("staff-1"), 1_800_000_002_000)
        .unwrap();
    assert_eq!(status.state, OfflineEligibilityState::DeviceRevoked);
}
