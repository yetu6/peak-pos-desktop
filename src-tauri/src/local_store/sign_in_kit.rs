//! The sign-in kit: everyone on this till's PIN screen with a till copy of their
//! PIN, signed by the server, kept in the encrypted store. A PIN is checked here
//! in hundredths of a second; the server still makes the real session and can
//! refuse it afterwards (the caller's job).
//!
//! The kit is signed over `KIT_DOMAIN || payload bytes` with the offline Ed25519
//! signer, and checked against the same trust keyset as authorizations and
//! catalogs.

use argon2::{
    password_hash::{phc::PasswordHash, PasswordVerifier},
    Argon2,
};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use zeroize::Zeroizing;

use super::authority::{decode_b64, decode_fixed, valid_argon2id};
use super::{classify_sql_error, LocalStore, LocalStoreError};

const KIT_DOMAIN: &[u8] = b"peak-pos-sign-in-kit-v1\0";
const MAX_KIT_STAFF: usize = 1000;
/// Doubling stops growing after this many doublings (as offline_pin.rs caps it).
const MAX_DOUBLINGS: i64 = 16;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KitPayload {
    terminal_id: String,
    issued_at_ms: i64,
    expires_at_ms: i64,
    staff: Vec<KitStaff>,
    terminal: KitTerminal,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KitStaff {
    staff_id: String,
    display_name: String,
    #[serde(default)]
    needs_setup: bool,
    till_copy_phc: Option<String>,
    copy_version: Option<String>,
    locked_until_ms: Option<i64>,
    max_attempts: i64,
    base_lockout_ms: i64,
    role_code: String,
    #[serde(default)]
    permissions: Vec<String>,
}

/// What the till needs to know about itself once someone is in.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KitTerminal {
    pub mode: String,
    #[serde(default)]
    pub prep_stations: Value,
    pub property_name: String,
    pub outlet_name: String,
    pub terminal_name: String,
    #[serde(default)]
    pub capabilities: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignInStaff {
    pub staff_id: String,
    pub display_name: String,
    pub role_code: String,
    pub permissions: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KitSummary {
    pub terminal_id: String,
    pub issued_at_ms: i64,
    pub expires_at_ms: i64,
    pub staff_count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(
    tag = "state",
    rename_all = "SCREAMING_SNAKE_CASE",
    rename_all_fields = "camelCase"
)]
pub enum SignInCheck {
    Ok {
        staff: SignInStaff,
        terminal: KitTerminal,
    },
    Wrong {
        attempts_left: i64,
    },
    Locked {
        until_ms: i64,
    },
    NoCopy,
    Unknown,
}

impl LocalStore {
    /// Verifies and installs a signed kit, replacing the whole kit at once.
    /// Refused: a bad signature, an untrusted key, a kit for another terminal,
    /// a copy that is not the agreed Argon2id form, or a kit older than the one
    /// held. Whatever is refused leaves the old kit exactly as it was.
    pub fn install_sign_in_kit(
        &mut self,
        signed_kit: &str,
        signature: &str,
        key_id: &str,
        now_ms: i64,
    ) -> Result<KitSummary, LocalStoreError> {
        let invalid = LocalStoreError::InvalidAuthorization;
        let payload_bytes = Zeroizing::new(decode_b64(signed_kit)?);
        let signature = Signature::from_slice(&decode_fixed::<64>(signature)?)
            .map_err(|_| LocalStoreError::InvalidAuthorization)?;
        let payload: KitPayload =
            serde_json::from_slice(&payload_bytes).map_err(|_| LocalStoreError::InvalidAuthorization)?;
        validate_kit(&payload)?;

        let (terminal_id, lifecycle): (String, String) = self
            .connection
            .query_row(
                "SELECT terminal_id,lifecycle_state
                 FROM terminal_authority WHERE is_current=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(classify_sql_error)?
            .ok_or(LocalStoreError::AuthorizationRequired)?;
        if lifecycle != "PAIRED" || payload.terminal_id != terminal_id {
            return Err(invalid);
        }

        if now_ms >= payload.expires_at_ms {
            return Err(invalid);
        }
        let key_bytes = resolve_trusted_key(&self.connection, key_id, payload.issued_at_ms, now_ms)?
            .ok_or(LocalStoreError::InvalidAuthorization)?;
        let public_key: [u8; 32] = key_bytes
            .try_into()
            .map_err(|_| LocalStoreError::InvalidAuthorization)?;
        let verifying_key = VerifyingKey::from_bytes(&public_key)
            .map_err(|_| LocalStoreError::InvalidAuthorization)?;
        let mut message = Vec::with_capacity(KIT_DOMAIN.len() + payload_bytes.len());
        message.extend_from_slice(KIT_DOMAIN);
        message.extend_from_slice(&payload_bytes);
        verifying_key
            .verify(&message, &signature)
            .map_err(|_| LocalStoreError::InvalidAuthorization)?;

        let terminal_json = serde_json::to_string(&payload.terminal)
            .map_err(|_| LocalStoreError::InvalidAuthorization)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(classify_sql_error)?;
        let mark: Option<i64> = transaction
            .query_row("SELECT high_water_ms FROM sign_in_kit_mark WHERE singleton_id=1", [], |row| row.get(0))
            .optional()
            .map_err(classify_sql_error)?;
        if mark.is_some_and(|mark| payload.issued_at_ms < mark) {
            return Err(invalid);
        }
        transaction.execute("DELETE FROM sign_in_kit_staff", []).map_err(classify_sql_error)?;
        transaction.execute("DELETE FROM sign_in_kit", []).map_err(classify_sql_error)?;
        transaction
            .execute(
                "INSERT INTO sign_in_kit(singleton_id,terminal_id,issued_at_ms,expires_at_ms,key_id,terminal_json,installed_at_ms)
                 VALUES (1,?1,?2,?3,?4,?5,?6)",
                params![payload.terminal_id, payload.issued_at_ms, payload.expires_at_ms, key_id, terminal_json, now_ms],
            )
            .map_err(classify_sql_error)?;
        transaction
            .execute(
                "INSERT INTO sign_in_kit_mark(singleton_id,high_water_ms) VALUES (1,?1)
                 ON CONFLICT(singleton_id) DO UPDATE SET high_water_ms=MAX(high_water_ms,excluded.high_water_ms)",
                [payload.issued_at_ms],
            )
            .map_err(classify_sql_error)?;
        for person in &payload.staff {
            // Counts kept for an older copy of this person's PIN are of no use now.
            transaction
                .execute(
                    "DELETE FROM sign_in_kit_attempts WHERE staff_id=?1 AND copy_version IS NOT ?2",
                    params![person.staff_id, person.copy_version],
                )
                .map_err(classify_sql_error)?;
            transaction
                .execute(
                    "INSERT INTO sign_in_kit_staff(staff_id,display_name,role_code,permissions_json,needs_setup,
                        till_copy_phc,copy_version,server_locked_until_ms,max_attempts,base_lockout_ms)
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
                    params![
                        person.staff_id,
                        person.display_name,
                        person.role_code,
                        serde_json::to_string(&person.permissions).map_err(|_| LocalStoreError::InvalidAuthorization)?,
                        i64::from(person.needs_setup),
                        person.till_copy_phc,
                        person.copy_version,
                        person.locked_until_ms,
                        person.max_attempts,
                        person.base_lockout_ms,
                    ],
                )
                .map_err(classify_sql_error)?;
        }
        transaction.commit().map_err(classify_sql_error)?;
        Ok(KitSummary {
            terminal_id: payload.terminal_id,
            issued_at_ms: payload.issued_at_ms,
            expires_at_ms: payload.expires_at_ms,
            staff_count: payload.staff.len(),
        })
    }

    /// Checks a PIN against the kit. Wrong PINs are counted with the kit's own
    /// `maxAttempts`; the one that reaches it locks for `baseLockoutMs`, and
    /// each wrong PIN after that doubles the wait. A lock the server set
    /// (`lockedUntilMs`) also counts as locked.
    pub fn verify_sign_in_pin(
        &mut self,
        staff_id: &str,
        pin: String,
        now_ms: i64,
    ) -> Result<SignInCheck, LocalStoreError> {
        let pin = Zeroizing::new(pin);
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(classify_sql_error)?;
        let kit: Option<(String, String, i64, i64, String)> = transaction
            .query_row(
                "SELECT terminal_id,terminal_json,issued_at_ms,expires_at_ms,key_id FROM sign_in_kit WHERE singleton_id=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
            )
            .optional()
            .map_err(classify_sql_error)?;
        let Some((kit_terminal, terminal_json, issued_at, expires_at, kit_key)) = kit else {
            return Ok(SignInCheck::Unknown);
        };
        // An expired kit, or one signed by a key the till no longer trusts,
        // checks nobody: the till goes to the server instead.
        if now_ms >= expires_at
            || resolve_trusted_key(&transaction, &kit_key, issued_at, now_ms)?.is_none()
        {
            return Ok(SignInCheck::Unknown);
        }
        // A till that is no longer this terminal's, or has been revoked, checks nobody.
        let still_paired: bool = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM terminal_authority
                 WHERE is_current=1 AND terminal_id=?1 AND lifecycle_state='PAIRED')",
                [&kit_terminal],
                |row| row.get(0),
            )
            .map_err(classify_sql_error)?;
        if !still_paired {
            return Ok(SignInCheck::Unknown);
        }
        type Row = (String, String, String, bool, Option<String>, Option<String>, Option<i64>, i64, i64);
        let person: Option<Row> = transaction
            .query_row(
                "SELECT display_name,role_code,permissions_json,needs_setup,till_copy_phc,copy_version,
                        server_locked_until_ms,max_attempts,base_lockout_ms
                 FROM sign_in_kit_staff WHERE staff_id=?1",
                [staff_id],
                |row| {
                    Ok((
                        row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?,
                        row.get(5)?, row.get(6)?, row.get(7)?, row.get(8)?,
                    ))
                },
            )
            .optional()
            .map_err(classify_sql_error)?;
        let Some((display_name, role_code, permissions_json, needs_setup, phc, copy_version, server_locked, max_attempts, base_lockout)) = person else {
            return Ok(SignInCheck::Unknown);
        };
        let (Some(phc), Some(copy_version)) = (phc.filter(|_| !needs_setup), copy_version) else {
            return Ok(SignInCheck::NoCopy);
        };
        let (attempts, locked_until): (i64, Option<i64>) = transaction
            .query_row(
                "SELECT attempts,locked_until_ms FROM sign_in_kit_attempts WHERE staff_id=?1 AND copy_version=?2",
                params![staff_id, copy_version],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(classify_sql_error)?
            .unwrap_or((0, None));
        if let Some(until) = server_locked.filter(|until| now_ms < *until) {
            return Ok(SignInCheck::Locked { until_ms: until });
        }
        if let Some(until) = locked_until.filter(|until| now_ms < *until) {
            return Ok(SignInCheck::Locked { until_ms: until });
        }

        let parsed = PasswordHash::new(&phc).map_err(|_| LocalStoreError::InvalidAuthorization)?;
        let correct = Argon2::default()
            .verify_password(pin.as_bytes(), &parsed)
            .is_ok();
        if !correct {
            let attempts = attempts.saturating_add(1);
            if attempts >= max_attempts {
                let doublings = (attempts - max_attempts).min(MAX_DOUBLINGS);
                let until = now_ms.saturating_add(base_lockout.saturating_mul(2_i64.saturating_pow(u32::try_from(doublings).unwrap_or(16))));
                transaction
                    .execute(
                        "INSERT INTO sign_in_kit_attempts(staff_id,copy_version,attempts,locked_until_ms) VALUES (?1,?2,?3,?4)
                         ON CONFLICT(staff_id,copy_version) DO UPDATE SET attempts=excluded.attempts,locked_until_ms=excluded.locked_until_ms",
                        params![staff_id, copy_version, attempts, until]
                    )
                    .map_err(classify_sql_error)?;
                transaction.commit().map_err(classify_sql_error)?;
                return Ok(SignInCheck::Locked { until_ms: until });
            }
            transaction
                .execute(
                    "INSERT INTO sign_in_kit_attempts(staff_id,copy_version,attempts,locked_until_ms) VALUES (?1,?2,?3,?4)
                         ON CONFLICT(staff_id,copy_version) DO UPDATE SET attempts=excluded.attempts,locked_until_ms=excluded.locked_until_ms",
                        params![staff_id, copy_version, attempts, None::<i64>]
                )
                .map_err(classify_sql_error)?;
            transaction.commit().map_err(classify_sql_error)?;
            return Ok(SignInCheck::Wrong { attempts_left: max_attempts - attempts });
        }
        if attempts != 0 || locked_until.is_some() {
            transaction
                .execute(
                    "DELETE FROM sign_in_kit_attempts WHERE staff_id=?1 AND copy_version=?2",
                    params![staff_id, copy_version],
                )
                .map_err(classify_sql_error)?;
        }
        transaction.commit().map_err(classify_sql_error)?;
        Ok(SignInCheck::Ok {
            staff: SignInStaff {
                staff_id: staff_id.to_string(),
                display_name,
                role_code,
                permissions: serde_json::from_str(&permissions_json)
                    .map_err(|_| LocalStoreError::InvalidAuthorization)?,
            },
            terminal: serde_json::from_str(&terminal_json)
                .map_err(|_| LocalStoreError::InvalidAuthorization)?,
        })
    }

    /// The same, on the trusted clock: the last server time plus the machine's
    /// monotonic time. With no anchor, a restart, or a clock set back, nothing
    /// is installed. Setting the PC clock back is no way round a lockout.
    pub fn install_sign_in_kit_trusted(
        &mut self,
        signed_kit: &str,
        signature: &str,
        key_id: &str,
        wall_ms: i64,
        monotonic_ms: i64,
        boot_id: &str,
    ) -> Result<KitSummary, LocalStoreError> {
        let now = self.trusted_now_ms(wall_ms, monotonic_ms, boot_id)?;
        self.install_sign_in_kit(signed_kit, signature, key_id, now)
    }

    /// The same, on the trusted clock; when it cannot be trusted the answer is
    /// Unknown, so the till signs in with the server instead.
    pub fn verify_sign_in_pin_trusted(
        &mut self,
        staff_id: &str,
        pin: String,
        wall_ms: i64,
        monotonic_ms: i64,
        boot_id: &str,
    ) -> Result<SignInCheck, LocalStoreError> {
        match self.trusted_now_ms(wall_ms, monotonic_ms, boot_id) {
            Ok(now) => self.verify_sign_in_pin(staff_id, pin, now),
            Err(_) => Ok(SignInCheck::Unknown),
        }
    }

    /// Forgets the kit: every later check is Unknown. Used when the server says
    /// this till is no longer paired. The counts of wrong PINs and the mark of
    /// the highest kit installed stay: clearing is no way to fresh tries or
    /// to put an older kit back.
    pub fn clear_sign_in_kit(&mut self) -> Result<(), LocalStoreError> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(classify_sql_error)?;
        transaction.execute("DELETE FROM sign_in_kit_staff", []).map_err(classify_sql_error)?;
        transaction.execute("DELETE FROM sign_in_kit", []).map_err(classify_sql_error)?;
        transaction.commit().map_err(classify_sql_error)
    }
}

/// The public key to check a kit against, or None when the till does not trust
/// that key now: absent from the keyset, revoked, or outside its dates. With no
/// keyset yet, the terminal's own key from pairing is the one trusted.
fn resolve_trusted_key(
    connection: &rusqlite::Connection,
    key_id: &str,
    issued_at_ms: i64,
    now_ms: i64,
) -> Result<Option<Vec<u8>>, LocalStoreError> {
    let trusted: Option<(Vec<u8>, String, i64, i64)> = connection
        .query_row(
            "SELECT public_key,state,not_before_ms,not_after_ms FROM trusted_signing_keys WHERE kid=?1",
            [key_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .map_err(classify_sql_error)?;
    let has_keyset: bool = connection
        .query_row("SELECT EXISTS(SELECT 1 FROM trusted_signing_keys)", [], |row| row.get(0))
        .map_err(classify_sql_error)?;
    match trusted {
        Some((key, state, not_before, not_after))
            if state != "REVOKED"
                && issued_at_ms >= not_before
                && issued_at_ms < not_after
                && now_ms >= not_before
                && now_ms < not_after =>
        {
            Ok(Some(key))
        }
        Some(_) => Ok(None),
        None if !has_keyset => connection
            .query_row(
                "SELECT trust_public_key FROM terminal_authority WHERE is_current=1 AND trust_key_id=?1",
                [key_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(classify_sql_error),
        None => Ok(None),
    }
}

fn validate_kit(payload: &KitPayload) -> Result<(), LocalStoreError> {
    let reject = LocalStoreError::InvalidAuthorization;
    if payload.terminal_id.trim().is_empty()
        || payload.issued_at_ms <= 0
        || payload.expires_at_ms <= payload.issued_at_ms
        || payload.staff.len() > MAX_KIT_STAFF
    {
        return Err(reject);
    }
    let mut seen = std::collections::HashSet::new();
    for person in &payload.staff {
        if person.staff_id.trim().is_empty()
            || person.display_name.trim().is_empty()
            || person.max_attempts <= 0
            || person.base_lockout_ms <= 0
            || !seen.insert(person.staff_id.as_str())
            || person.till_copy_phc.as_deref().is_some_and(|phc| !valid_argon2id(phc))
            || (person.till_copy_phc.is_some() && person.copy_version.as_deref().is_none_or(|v| v.trim().is_empty()))
        {
            return Err(LocalStoreError::InvalidAuthorization);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::time::Instant;

    use argon2::{password_hash::PasswordHasher, Argon2};
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use ed25519_dalek::{Signer, SigningKey};
    use rusqlite::Connection;
    use serde_json::{json, Value};

    use super::super::{
        LocalStore, LocalStoreError, OfflinePublicKey, OfflinePublicKeyset, SignInCheck,
        TerminalBinding,
    };

    const DOMAIN: &[u8] = b"peak-pos-sign-in-kit-v1\0";
    const NOW: i64 = 1_800_000_000_000;

    fn store() -> LocalStore {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .pragma_update(None, "foreign_keys", true)
            .unwrap();
        let schema_version = super::super::migrations::migrate(&mut connection).unwrap();
        LocalStore {
            connection,
            cipher_version: "test".into(),
            schema_version,
            path: PathBuf::from(":memory:"),
            active_staff: None,
        }
    }

    fn key() -> SigningKey {
        SigningKey::from_bytes(&[7_u8; 32])
    }

    fn paired_store() -> LocalStore {
        let mut store = store();
        store
            .bind_terminal(TerminalBinding {
                terminal_id: "terminal-1".into(),
                credential_epoch: 4,
                property_id: "property-1".into(),
                outlet_id: "outlet-1".into(),
                register_id: "register-1".into(),
                trust_key_id: "server-key-1".into(),
                trust_public_key_b64: URL_SAFE_NO_PAD.encode(key().verifying_key().to_bytes()),
                configuration_payload_b64: URL_SAFE_NO_PAD.encode(b"configuration-v1"),
                revocation_generation: 2,
                paired_at_ms: NOW,
            })
            .unwrap();
        store
    }

    fn copy(pin: &str) -> String {
        Argon2::default().hash_password(pin.as_bytes()).unwrap().to_string()
    }

    fn member(id: &str, name: &str, pin: Option<&str>) -> Value {
        let mut value = json!({
            "staffId": id, "displayName": name, "needsSetup": pin.is_none(),
            "maxAttempts": 5, "baseLockoutMs": 60000, "roleCode": "POS_CASHIER",
            "permissions": ["pos.order.create"],
        });
        if let Some(pin) = pin {
            value["tillCopyPhc"] = json!(copy(pin));
            value["copyVersion"] = json!(format!("v-{pin}"));
        }
        value
    }

    fn payload(terminal: &str, issued: i64, staff: Vec<Value>) -> Vec<u8> {
        payload_expiring(terminal, issued, NOW + 86_400_000, staff)
    }

    fn payload_expiring(terminal: &str, issued: i64, expires: i64, staff: Vec<Value>) -> Vec<u8> {
        serde_json::to_vec(&json!({
            "terminalId": terminal, "issuedAtMs": issued, "expiresAtMs": expires, "staff": staff,
            "terminal": {"mode": "BAR", "prepStations": [], "propertyName": "Casanova",
                         "outletName": "Bar", "terminalName": "Main till", "capabilities": {}},
        }))
        .unwrap()
    }

    fn sign(signer: &SigningKey, payload: &[u8]) -> (String, String) {
        let mut message = DOMAIN.to_vec();
        message.extend_from_slice(payload);
        (
            URL_SAFE_NO_PAD.encode(payload),
            URL_SAFE_NO_PAD.encode(signer.sign(&message).to_bytes()),
        )
    }

    fn install(store: &mut LocalStore, issued: i64, staff: Vec<Value>) -> Result<(), LocalStoreError> {
        let (kit, signature) = sign(&key(), &payload("terminal-1", issued, staff));
        store
            .install_sign_in_kit(&kit, &signature, "server-key-1", NOW)
            .map(|_| ())
    }

    fn one_person() -> Vec<Value> {
        vec![member("staff-1", "Amina Hassan", Some("2468"))]
    }

    #[test]
    fn a_kit_with_a_bad_signature_is_refused_and_the_old_kit_stays() {
        let mut store = paired_store();
        install(&mut store, 1_000, one_person()).unwrap();

        let other = SigningKey::from_bytes(&[9_u8; 32]);
        let (kit, signature) = sign(&other, &payload("terminal-1", 2_000, vec![]));
        assert!(store
            .install_sign_in_kit(&kit, &signature, "server-key-1", NOW)
            .is_err());

        let (kit, signature) = sign(&key(), &payload("terminal-1", 3_000, vec![]));
        let mut tampered = URL_SAFE_NO_PAD.decode(&kit).unwrap();
        tampered[10] ^= 1;
        assert!(store
            .install_sign_in_kit(&URL_SAFE_NO_PAD.encode(tampered), &signature, "server-key-1", NOW)
            .is_err());

        assert!(matches!(
            store.verify_sign_in_pin("staff-1", "2468".into(), NOW).unwrap(),
            SignInCheck::Ok { .. }
        ));
    }

    #[test]
    fn a_kit_for_another_terminal_is_refused() {
        let mut store = paired_store();
        let (kit, signature) = sign(&key(), &payload("terminal-2", 1_000, one_person()));
        assert!(store
            .install_sign_in_kit(&kit, &signature, "server-key-1", NOW)
            .is_err());
        assert_eq!(
            store.verify_sign_in_pin("staff-1", "2468".into(), NOW).unwrap(),
            SignInCheck::Unknown
        );
    }

    #[test]
    fn a_key_the_till_does_not_trust_is_refused() {
        let mut store = paired_store();
        let keyset = OfflinePublicKeyset {
            protocol_version: 1,
            issued_at: "2027-01-15T07:00:00Z".into(),
            keys: vec![OfflinePublicKey {
                kid: "server-key-1".into(),
                algorithm: "Ed25519".into(),
                signature_version: 1,
                state: "REVOKED".into(),
                not_before: "2027-01-01T00:00:00Z".into(),
                not_after: "2028-01-01T00:00:00Z".into(),
                public_key_b64: URL_SAFE_NO_PAD.encode(key().verifying_key().to_bytes()),
            }, OfflinePublicKey {
                kid: "server-key-2".into(),
                algorithm: "Ed25519".into(),
                signature_version: 1,
                state: "CURRENT".into(),
                not_before: "2027-01-01T00:00:00Z".into(),
                not_after: "2028-01-01T00:00:00Z".into(),
                public_key_b64: URL_SAFE_NO_PAD.encode([5_u8; 32]),
            }],
        };
        store.install_authenticated_keyset(&keyset, NOW).unwrap();
        assert!(install(&mut store, NOW - 10, one_person()).is_err());
    }

    #[test]
    fn an_older_kit_is_refused_and_a_newer_one_replaces_the_whole_kit() {
        let mut store = paired_store();
        install(&mut store, 2_000, one_person()).unwrap();
        assert!(install(&mut store, 1_000, vec![]).is_err());
        assert!(matches!(
            store.verify_sign_in_pin("staff-1", "2468".into(), NOW).unwrap(),
            SignInCheck::Ok { .. }
        ));
        install(&mut store, 3_000, vec![member("staff-2", "Juma Said", Some("1357"))]).unwrap();
        assert_eq!(
            store.verify_sign_in_pin("staff-1", "2468".into(), NOW).unwrap(),
            SignInCheck::Unknown
        );
        assert!(matches!(
            store.verify_sign_in_pin("staff-2", "1357".into(), NOW).unwrap(),
            SignInCheck::Ok { .. }
        ));
    }

    #[test]
    fn a_copy_that_is_not_the_agreed_argon2id_form_refuses_the_whole_kit() {
        let mut store = paired_store();
        let mut weak = member("staff-1", "Amina Hassan", Some("2468"));
        weak["tillCopyPhc"] = json!("$argon2id$v=19$m=1024,t=1,p=1$c2FsdHNhbHRzYWx0cw$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g");
        assert!(install(&mut store, 1_000, vec![weak]).is_err());
    }

    #[test]
    fn a_correct_pin_gives_ok_with_the_person_and_the_terminal() {
        let mut store = paired_store();
        install(&mut store, 1_000, one_person()).unwrap();
        match store.verify_sign_in_pin("staff-1", "2468".into(), NOW).unwrap() {
            SignInCheck::Ok { staff, terminal } => {
                assert_eq!(staff.staff_id, "staff-1");
                assert_eq!(staff.display_name, "Amina Hassan");
                assert_eq!(staff.role_code, "POS_CASHIER");
                assert_eq!(staff.permissions, vec!["pos.order.create".to_string()]);
                assert_eq!(terminal.mode, "BAR");
                assert_eq!(terminal.property_name, "Casanova");
                assert_eq!(terminal.terminal_name, "Main till");
            }
            other => panic!("expected Ok, got {other:?}"),
        }
    }

    #[test]
    fn wrong_pins_count_down_and_the_fifth_locks_then_doubles() {
        let mut store = paired_store();
        install(&mut store, 1_000, one_person()).unwrap();
        for left in [4, 3, 2, 1] {
            assert_eq!(
                store.verify_sign_in_pin("staff-1", "0000".into(), NOW).unwrap(),
                SignInCheck::Wrong { attempts_left: left }
            );
        }
        assert_eq!(
            store.verify_sign_in_pin("staff-1", "0000".into(), NOW).unwrap(),
            SignInCheck::Locked { until_ms: NOW + 60_000 }
        );
        // Locked means locked: even the right PIN waits.
        assert_eq!(
            store.verify_sign_in_pin("staff-1", "2468".into(), NOW + 59_999).unwrap(),
            SignInCheck::Locked { until_ms: NOW + 60_000 }
        );
        // After the wait one more wrong PIN doubles it.
        assert_eq!(
            store.verify_sign_in_pin("staff-1", "0000".into(), NOW + 60_000).unwrap(),
            SignInCheck::Locked { until_ms: NOW + 60_000 + 120_000 }
        );
        // After that wait the right PIN is let in and the count starts again.
        assert!(matches!(
            store.verify_sign_in_pin("staff-1", "2468".into(), NOW + 180_000).unwrap(),
            SignInCheck::Ok { .. }
        ));
        assert_eq!(
            store.verify_sign_in_pin("staff-1", "0000".into(), NOW + 180_001).unwrap(),
            SignInCheck::Wrong { attempts_left: 4 }
        );
    }

    #[test]
    fn the_kits_own_limits_are_the_ones_used() {
        let mut store = paired_store();
        let mut person = member("staff-1", "Amina Hassan", Some("2468"));
        person["maxAttempts"] = json!(2);
        person["baseLockoutMs"] = json!(1000);
        install(&mut store, 1_000, vec![person]).unwrap();
        assert_eq!(
            store.verify_sign_in_pin("staff-1", "0000".into(), NOW).unwrap(),
            SignInCheck::Wrong { attempts_left: 1 }
        );
        assert_eq!(
            store.verify_sign_in_pin("staff-1", "0000".into(), NOW).unwrap(),
            SignInCheck::Locked { until_ms: NOW + 1_000 }
        );
    }

    #[test]
    fn a_person_absent_from_the_kit_is_unknown() {
        let mut store = paired_store();
        install(&mut store, 1_000, one_person()).unwrap();
        assert_eq!(
            store.verify_sign_in_pin("staff-9", "2468".into(), NOW).unwrap(),
            SignInCheck::Unknown
        );
    }

    #[test]
    fn a_person_with_no_copy_gives_no_copy_and_no_count() {
        let mut store = paired_store();
        let mut absent = member("staff-3", "Zawadi", Some("1111"));
        absent.as_object_mut().unwrap().remove("tillCopyPhc");
        install(
            &mut store,
            1_000,
            vec![member("staff-2", "Juma Said", None), absent],
        )
        .unwrap();
        for id in ["staff-2", "staff-3"] {
            for _ in 0..7 {
                assert_eq!(
                    store.verify_sign_in_pin(id, "1111".into(), NOW).unwrap(),
                    SignInCheck::NoCopy
                );
            }
        }
    }

    #[test]
    fn a_lock_the_server_set_counts_as_locked_until_it_ends() {
        let mut store = paired_store();
        let mut person = member("staff-1", "Amina Hassan", Some("2468"));
        person["lockedUntilMs"] = json!(NOW + 5_000);
        install(&mut store, 1_000, vec![person]).unwrap();
        assert_eq!(
            store.verify_sign_in_pin("staff-1", "2468".into(), NOW).unwrap(),
            SignInCheck::Locked { until_ms: NOW + 5_000 }
        );
        assert!(matches!(
            store.verify_sign_in_pin("staff-1", "2468".into(), NOW + 5_000).unwrap(),
            SignInCheck::Ok { .. }
        ));
    }

    #[test]
    fn after_clearing_the_kit_every_check_is_unknown() {
        let mut store = paired_store();
        install(&mut store, 1_000, one_person()).unwrap();
        store.clear_sign_in_kit().unwrap();
        assert_eq!(
            store.verify_sign_in_pin("staff-1", "2468".into(), NOW).unwrap(),
            SignInCheck::Unknown
        );
    }

    #[test]
    fn clearing_and_reinstalling_does_not_give_fresh_tries() {
        let mut store = paired_store();
        install(&mut store, 1_000, one_person()).unwrap();
        for _ in 0..3 {
            store.verify_sign_in_pin("staff-1", "0000".into(), NOW).unwrap();
        }
        store.clear_sign_in_kit().unwrap();
        install(&mut store, 1_000, one_person()).unwrap();
        assert_eq!(
            store.verify_sign_in_pin("staff-1", "0000".into(), NOW).unwrap(),
            SignInCheck::Wrong { attempts_left: 1 }
        );
        assert_eq!(
            store.verify_sign_in_pin("staff-1", "0000".into(), NOW).unwrap(),
            SignInCheck::Locked { until_ms: NOW + 60_000 }
        );
        store.clear_sign_in_kit().unwrap();
        install(&mut store, 1_000, one_person()).unwrap();
        assert_eq!(
            store.verify_sign_in_pin("staff-1", "2468".into(), NOW + 1).unwrap(),
            SignInCheck::Locked { until_ms: NOW + 60_000 }
        );
    }

    #[test]
    fn an_older_kit_cannot_be_put_back_after_a_clear() {
        let mut store = paired_store();
        install(&mut store, 2_000, one_person()).unwrap();
        store.clear_sign_in_kit().unwrap();
        assert!(install(&mut store, 1_999, one_person()).is_err());
        // The same kit again is fine.
        install(&mut store, 2_000, one_person()).unwrap();
    }

    #[test]
    fn an_expired_kit_is_refused_and_stops_checking_when_it_runs_out() {
        let mut store = paired_store();
        let (kit, signature) = sign(&key(), &payload_expiring("terminal-1", 1_000, NOW, one_person()));
        assert!(store.install_sign_in_kit(&kit, &signature, "server-key-1", NOW).is_err());

        let expires = NOW + 5_000;
        let (kit, signature) = sign(&key(), &payload_expiring("terminal-1", 1_000, expires, one_person()));
        store.install_sign_in_kit(&kit, &signature, "server-key-1", NOW).unwrap();
        assert!(matches!(
            store.verify_sign_in_pin("staff-1", "2468".into(), expires - 1).unwrap(),
            SignInCheck::Ok { .. }
        ));
        assert_eq!(
            store.verify_sign_in_pin("staff-1", "2468".into(), expires).unwrap(),
            SignInCheck::Unknown
        );
    }

    #[test]
    fn a_kit_signed_by_a_key_since_dropped_or_revoked_checks_nobody() {
        let mut store = paired_store();
        install(&mut store, NOW - 10, one_person()).unwrap();
        let keyset = |state: &str| OfflinePublicKeyset {
            protocol_version: 1,
            issued_at: "2027-01-15T07:00:00Z".into(),
            keys: vec![
                OfflinePublicKey {
                    kid: "server-key-1".into(),
                    algorithm: "Ed25519".into(),
                    signature_version: 1,
                    state: state.into(),
                    not_before: "2027-01-01T00:00:00Z".into(),
                    not_after: "2028-01-01T00:00:00Z".into(),
                    public_key_b64: URL_SAFE_NO_PAD.encode(key().verifying_key().to_bytes()),
                },
                OfflinePublicKey {
                    kid: "server-key-2".into(),
                    algorithm: "Ed25519".into(),
                    signature_version: 1,
                    state: "CURRENT".into(),
                    not_before: "2027-01-01T00:00:00Z".into(),
                    not_after: "2028-01-01T00:00:00Z".into(),
                    public_key_b64: URL_SAFE_NO_PAD.encode([5_u8; 32]),
                },
            ],
        };
        // Trusted and current: still checked. NOW is inside the key's dates.
        store.install_authenticated_keyset(&keyset("PREVIOUS"), NOW).unwrap();
        assert!(matches!(
            store.verify_sign_in_pin("staff-1", "2468".into(), NOW).unwrap(),
            SignInCheck::Ok { .. }
        ));
        store.install_authenticated_keyset(&keyset("REVOKED"), NOW).unwrap();
        assert_eq!(
            store.verify_sign_in_pin("staff-1", "2468".into(), NOW).unwrap(),
            SignInCheck::Unknown
        );
    }

    #[test]
    fn a_clock_set_back_cannot_escape_a_lockout_or_open_the_till() {
        let mut store = paired_store();
        install(&mut store, 1_000, one_person()).unwrap();
        store.record_trusted_time(NOW, NOW, 20_000, "boot-a").unwrap();
        for _ in 0..5 {
            store
                .verify_sign_in_pin_trusted("staff-1", "0000".into(), NOW + 1_000, 21_000, "boot-a")
                .unwrap();
        }
        assert!(matches!(
            store
                .verify_sign_in_pin_trusted("staff-1", "2468".into(), NOW + 2_000, 22_000, "boot-a")
                .unwrap(),
            SignInCheck::Locked { .. }
        ));
        // Someone sets the PC clock back by a day; the monotonic clock keeps going.
        assert_eq!(
            store
                .verify_sign_in_pin_trusted("staff-1", "2468".into(), NOW - 86_400_000, 23_000, "boot-a")
                .unwrap(),
            SignInCheck::Unknown
        );
        // And nothing new is installed on a clock that cannot be trusted.
        let (kit, signature) = sign(&key(), &payload("terminal-1", 5_000, one_person()));
        assert!(store
            .install_sign_in_kit_trusted(&kit, &signature, "server-key-1", NOW - 86_400_000, 24_000, "boot-a")
            .is_err());
    }

    #[test]
    fn with_no_trusted_clock_nothing_is_installed_or_checked() {
        let mut store = paired_store();
        install(&mut store, 1_000, one_person()).unwrap();
        assert_eq!(
            store
                .verify_sign_in_pin_trusted("staff-1", "2468".into(), NOW, 21_000, "boot-a")
                .unwrap(),
            SignInCheck::Unknown
        );
        let (kit, signature) = sign(&key(), &payload("terminal-1", 5_000, one_person()));
        assert!(store
            .install_sign_in_kit_trusted(&kit, &signature, "server-key-1", NOW, 21_000, "boot-a")
            .is_err());
    }

    #[test]
    fn a_revoked_till_checks_nobody() {
        let mut store = paired_store();
        install(&mut store, 1_000, one_person()).unwrap();
        store
            .connection
            .execute("UPDATE terminal_authority SET lifecycle_state='REVOKED'", [])
            .unwrap();
        assert_eq!(
            store.verify_sign_in_pin("staff-1", "2468".into(), NOW).unwrap(),
            SignInCheck::Unknown
        );
    }

    #[test]
    fn a_refresh_keeps_the_count_for_the_same_copy_and_drops_it_for_a_new_one() {
        let mut store = paired_store();
        install(&mut store, 1_000, one_person()).unwrap();
        for _ in 0..3 {
            store.verify_sign_in_pin("staff-1", "0000".into(), NOW).unwrap();
        }
        let same = store
            .connection
            .query_row("SELECT till_copy_phc FROM sign_in_kit_staff", [], |r| r.get::<_, String>(0))
            .unwrap();
        let mut person = member("staff-1", "Amina Hassan", Some("2468"));
        person["tillCopyPhc"] = json!(same);
        install(&mut store, 2_000, vec![person]).unwrap();
        assert_eq!(
            store.verify_sign_in_pin("staff-1", "0000".into(), NOW).unwrap(),
            SignInCheck::Wrong { attempts_left: 1 }
        );
        // A new PIN is a new copy: the old count does not follow it.
        install(&mut store, 3_000, vec![member("staff-1", "Amina Hassan", Some("9999"))]).unwrap();
        assert_eq!(
            store.verify_sign_in_pin("staff-1", "0000".into(), NOW).unwrap(),
            SignInCheck::Wrong { attempts_left: 4 }
        );
    }

    /// The point of the kit: a check at the till copy's cost is quick. Runs in
    /// CI on all three systems; the numbers are printed in the job log.
    #[test]
    fn timing_twenty_checks_of_a_correct_pin() {
        let mut store = paired_store();
        install(&mut store, 1_000, one_person()).unwrap();
        let mut millis = Vec::new();
        for _ in 0..20 {
            let started = Instant::now();
            let check = store.verify_sign_in_pin("staff-1", "2468".into(), NOW).unwrap();
            millis.push(started.elapsed().as_secs_f64() * 1000.0);
            assert!(matches!(check, SignInCheck::Ok { .. }));
        }
        millis.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let median = (millis[9] + millis[10]) / 2.0;
        let worst = millis[19];
        println!("SIGN_IN_KIT_TIMING median={median:.1}ms worst={worst:.1}ms over 20 checks");
        assert!(median <= 100.0, "median {median:.1} ms is over 100 ms");
    }
}
