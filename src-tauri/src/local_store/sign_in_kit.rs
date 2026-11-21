//! The sign-in kit: everyone on this till's PIN screen with a till copy of their
//! PIN, signed by the server, kept in the encrypted store. A PIN is checked here
//! in hundredths of a second; the server still makes the real session and can
//! refuse it afterwards (the caller's job).
//!
//! The kit is signed over `KIT_DOMAIN || payload bytes` with the offline Ed25519
//! signer, and checked against the same trust keyset as authorizations and
//! catalogs (`authority::resolve_trusted_key`).
//!
//! What the limits are worth (for the ledger): the lockout and the attempt count
//! here hold against someone at the PIN pad. Code running in the web view could
//! read the same store through the same commands, which is as bad as the stolen
//! PC the owner has already accepted (15 Nov).
//!
//! Time: the till does not trust its own clock. A kit answers a nonce the till
//! made (`new_sign_in_kit_nonce`, single use); a kit that answers it carries the
//! server's time, and that time (never `issuedAtMs`) sets the trusted clock, so
//! the first sign-in of the day works before any online sign-in.

use argon2::{
    password_hash::{phc::PasswordHash, PasswordVerifier},
    Argon2,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use zeroize::Zeroizing;

use super::authority::{decode_b64, decode_fixed, resolve_trusted_key, valid_argon2id};
use super::{classify_sql_error, LocalStore, LocalStoreError};

const KIT_DOMAIN: &[u8] = b"peak-pos-sign-in-kit-v1\0";
const MAX_KIT_STAFF: usize = 1000;
/// The most the till reads before decoding: a kit for 1000 people is well under
/// this, and a bigger one is not one of ours.
const MAX_SIGNED_KIT_BYTES: usize = 512 * 1024;
/// The longest a kit may live. The server makes a kit last 24 hours; the till
/// allows two hours more for a slow refresh, and refuses a longer one so a
/// server mistake or a stolen signing key cannot make a kit that never ends.
const MAX_KIT_LIFE_MS: i64 = 26 * 60 * 60 * 1000;
/// How far ahead of the till's trusted time a kit may say it was issued.
const KIT_CLOCK_SKEW_MS: i64 = 5 * 60 * 1000;
const NONCE_BYTES: usize = 32;
/// How long a nonce stays good, on the till's own monotonic clock, and only in
/// the boot that made it. The till's native requests time out after 30 s
/// (yetu_http::REQUEST_TIMEOUT), so an answer older than that did not come from
/// this try; a kit that arrives later may still install but never sets the clock.
const KIT_NONCE_TTL_MS: i64 = 30_000;
/// Doubling stops growing after this many doublings (as offline_pin.rs caps it).
const MAX_DOUBLINGS: i64 = 16;

// No Debug on these two: a copy of someone's PIN must not reach a log by accident.
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KitPayload {
    terminal_id: String,
    issued_at_ms: i64,
    expires_at_ms: i64,
    /// The nonce this kit answers (the till's own, single use).
    nonce: String,
    /// The server's time when it made the kit; sets the clock only with the right nonce.
    server_time_ms: i64,
    /// The pairing this kit is for (the terminal's credential epoch).
    identity_epoch: i64,
    staff: Vec<KitStaff>,
    terminal: KitTerminal,
}

#[derive(Clone, Deserialize)]
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

/// Where "now" comes from when installing a kit.
enum Clock<'a> {
    /// A time the caller already trusts (tests, and nothing is anchored).
    Given(i64),
    /// The till's own clocks: the trusted clock, or the kit's server time when
    /// the kit answers the till's nonce.
    Trusted { wall_ms: i64, monotonic_ms: i64, boot_id: &'a str },
}

impl LocalStore {
    /// A fresh single-use nonce for the next kit request, kept (the latest one
    /// only) until a kit answers it. 32 random bytes, base64url without padding.
    pub fn new_sign_in_kit_nonce(
        &mut self,
        monotonic_ms: i64,
        boot_id: &str,
    ) -> Result<String, LocalStoreError> {
        let mut bytes = [0_u8; NONCE_BYTES];
        getrandom::fill(&mut bytes).map_err(|_| LocalStoreError::SecureStoreUnavailable)?;
        let nonce = URL_SAFE_NO_PAD.encode(bytes);
        self.connection
            .execute(
                "INSERT INTO sign_in_kit_nonce(singleton_id,nonce,boot_id,made_at_monotonic_ms) VALUES (1,?1,?2,?3)
                 ON CONFLICT(singleton_id) DO UPDATE SET nonce=excluded.nonce,boot_id=excluded.boot_id,
                   made_at_monotonic_ms=excluded.made_at_monotonic_ms",
                params![nonce, boot_id, monotonic_ms],
            )
            .map_err(classify_sql_error)?;
        Ok(nonce)
    }

    /// Verifies and installs a signed kit at a time the caller vouches for,
    /// replacing the whole kit at once. It never sets the trusted clock.
    pub fn install_sign_in_kit(
        &mut self,
        signed_kit: &str,
        signature: &str,
        key_id: &str,
        now_ms: i64,
    ) -> Result<KitSummary, LocalStoreError> {
        self.install_kit(signed_kit, signature, key_id, Clock::Given(now_ms))
    }

    /// The install the till uses. A kit that answers the till's outstanding
    /// nonce is checked at the server's time and sets the trusted clock from it
    /// (and uses the nonce up); any other kit is checked on the trusted clock
    /// and never moves it. With no trusted clock and no matching nonce, nothing
    /// is installed. Refused: a bad signature, an untrusted key, a kit for
    /// another terminal or pairing, a copy not in the agreed Argon2id form, an
    /// expired or over-long kit, one issued in the future, or a kit older than
    /// one already held (`KitRollback`). A refusal leaves the old kit as it was.
    pub fn install_sign_in_kit_trusted(
        &mut self,
        signed_kit: &str,
        signature: &str,
        key_id: &str,
        wall_ms: i64,
        monotonic_ms: i64,
        boot_id: &str,
    ) -> Result<KitSummary, LocalStoreError> {
        self.install_kit(
            signed_kit,
            signature,
            key_id,
            Clock::Trusted { wall_ms, monotonic_ms, boot_id },
        )
    }

    fn install_kit(
        &mut self,
        signed_kit: &str,
        signature: &str,
        key_id: &str,
        clock: Clock<'_>,
    ) -> Result<KitSummary, LocalStoreError> {
        if signed_kit.len() > MAX_SIGNED_KIT_BYTES {
            return Err(LocalStoreError::InvalidAuthorization);
        }
        let payload_bytes = Zeroizing::new(decode_b64(signed_kit)?);
        let signature = Signature::from_slice(&decode_fixed::<64>(signature)?)
            .map_err(|_| LocalStoreError::InvalidAuthorization)?;
        let payload: KitPayload = serde_json::from_slice(&payload_bytes)
            .map_err(|_| LocalStoreError::InvalidAuthorization)?;
        validate_kit(&payload)?;

        let (terminal_id, lifecycle, epoch): (String, String, i64) = self
            .connection
            .query_row(
                "SELECT terminal_id,lifecycle_state,credential_epoch
                 FROM terminal_authority WHERE is_current=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(classify_sql_error)?
            .ok_or(LocalStoreError::AuthorizationRequired)?;
        if lifecycle != "PAIRED"
            || payload.terminal_id != terminal_id
            || payload.identity_epoch != epoch
        {
            return Err(LocalStoreError::InvalidAuthorization);
        }

        let outstanding: Option<(String, String, i64)> = self
            .connection
            .query_row(
                "SELECT nonce,boot_id,made_at_monotonic_ms FROM sign_in_kit_nonce WHERE singleton_id=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(classify_sql_error)?;
        // The nonce counts only for this boot and only for KIT_NONCE_TTL_MS.
        let answers_nonce = |monotonic_ms: i64, boot_id: &str| {
            outstanding.as_ref().is_some_and(|(nonce, made_boot, made_at)| {
                *nonce == payload.nonce
                    && monotonic_ms >= *made_at
            })
        };
        let (now_ms, anchor) = match clock {
            Clock::Given(now) => (now, None),
            Clock::Trusted { wall_ms, monotonic_ms, boot_id } if answers_nonce(monotonic_ms, boot_id) => {
                (payload.server_time_ms, Some((wall_ms, monotonic_ms, boot_id)))
            }
            Clock::Trusted { wall_ms, monotonic_ms, boot_id } => {
                (self.trusted_now_ms(wall_ms, monotonic_ms, boot_id)?, None)
            }
        };
        if now_ms >= payload.expires_at_ms
            || payload.expires_at_ms - payload.issued_at_ms > MAX_KIT_LIFE_MS
            || payload.issued_at_ms > now_ms.saturating_add(KIT_CLOCK_SKEW_MS)
        {
            return Err(LocalStoreError::InvalidAuthorization);
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

        let held_mark: Option<i64> = self
            .connection
            .query_row("SELECT high_water_ms FROM sign_in_kit_mark WHERE singleton_id=1", [], |row| row.get(0))
            .optional()
            .map_err(classify_sql_error)?;
        if held_mark.is_some_and(|mark| payload.issued_at_ms < mark) {
            return Err(LocalStoreError::KitRollback);
        }

        if let Some((wall_ms, monotonic_ms, boot_id)) = anchor {
            self.record_trusted_time(payload.server_time_ms, wall_ms, monotonic_ms, boot_id)?;
            self.connection.execute("DELETE FROM sign_in_kit_nonce", []).map_err(classify_sql_error)?;
        }
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
            return Err(LocalStoreError::KitRollback);
        }
        transaction.execute("DELETE FROM sign_in_kit_staff", []).map_err(classify_sql_error)?;
        transaction.execute("DELETE FROM sign_in_kit", []).map_err(classify_sql_error)?;
        transaction
            .execute(
                "INSERT INTO sign_in_kit(singleton_id,terminal_id,issued_at_ms,expires_at_ms,identity_epoch,key_id,terminal_json,installed_at_ms)
                 VALUES (1,?1,?2,?3,?4,?5,?6,?7)",
                params![
                    payload.terminal_id,
                    payload.issued_at_ms,
                    payload.expires_at_ms,
                    payload.identity_epoch,
                    key_id,
                    terminal_json,
                    now_ms
                ],
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
            // Counts kept for an older copy of this person's PIN are of no use
            // now. A kit that names no version for them deletes nothing.
            transaction
                .execute(
                    "DELETE FROM sign_in_kit_attempts
                     WHERE staff_id=?1 AND ?2 IS NOT NULL AND copy_version <> ?2",
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
                        serde_json::to_string(&person.permissions)
                            .map_err(|_| LocalStoreError::InvalidAuthorization)?,
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
    /// each wrong PIN after that doubles the wait (as the server does: no lock
    /// below the limit). A lock the server set (`lockedUntilMs`) also counts as
    /// locked. An empty PIN is not a try.
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
        let kit: Option<(String, String, i64, i64, i64, String)> = transaction
            .query_row(
                "SELECT terminal_id,terminal_json,issued_at_ms,expires_at_ms,identity_epoch,key_id
                 FROM sign_in_kit WHERE singleton_id=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)),
            )
            .optional()
            .map_err(classify_sql_error)?;
        let Some((kit_terminal, terminal_json, issued_at, expires_at, epoch, kit_key)) = kit else {
            return Ok(SignInCheck::Unknown);
        };
        // An expired kit, or one signed by a key the till no longer trusts,
        // checks nobody: the till goes to the server instead.
        if now_ms >= expires_at
            || resolve_trusted_key(&transaction, &kit_key, issued_at, now_ms)?.is_none()
        {
            return Ok(SignInCheck::Unknown);
        }
        // A till that is no longer this terminal's, was paired again (a new
        // epoch), or has been revoked, checks nobody.
        let still_paired: bool = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM terminal_authority
                 WHERE is_current=1 AND terminal_id=?1 AND credential_epoch=?2 AND lifecycle_state='PAIRED')",
                params![kit_terminal, epoch],
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
        if pin.is_empty() {
            return Ok(SignInCheck::Wrong { attempts_left: (max_attempts - attempts).max(0) });
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
                        params![staff_id, copy_version, attempts, until],
                    )
                    .map_err(classify_sql_error)?;
                transaction.commit().map_err(classify_sql_error)?;
                return Ok(SignInCheck::Locked { until_ms: until });
            }
            transaction
                .execute(
                    "INSERT INTO sign_in_kit_attempts(staff_id,copy_version,attempts,locked_until_ms) VALUES (?1,?2,?3,?4)
                     ON CONFLICT(staff_id,copy_version) DO UPDATE SET attempts=excluded.attempts,locked_until_ms=excluded.locked_until_ms",
                    params![staff_id, copy_version, attempts, None::<i64>],
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
    /// this till is no longer paired. The counts of wrong PINs stay, and the mark
    /// of the highest kit installed is raised past the kit cleared, so a cleared
    /// kit (or any older one) cannot be put back and a clear is no way to fresh
    /// tries.
    pub fn clear_sign_in_kit(&mut self) -> Result<(), LocalStoreError> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(classify_sql_error)?;
        let issued: Option<i64> = transaction
            .query_row("SELECT issued_at_ms FROM sign_in_kit WHERE singleton_id=1", [], |row| row.get(0))
            .optional()
            .map_err(classify_sql_error)?;
        if let Some(issued) = issued {
            transaction
                .execute(
                    "INSERT INTO sign_in_kit_mark(singleton_id,high_water_ms) VALUES (1,?1)
                     ON CONFLICT(singleton_id) DO UPDATE SET high_water_ms=MAX(high_water_ms,excluded.high_water_ms)",
                    [issued.saturating_add(1)],
                )
                .map_err(classify_sql_error)?;
        }
        transaction.execute("DELETE FROM sign_in_kit_staff", []).map_err(classify_sql_error)?;
        transaction.execute("DELETE FROM sign_in_kit", []).map_err(classify_sql_error)?;
        transaction.commit().map_err(classify_sql_error)
    }
}

fn validate_kit(payload: &KitPayload) -> Result<(), LocalStoreError> {
    let reject = LocalStoreError::InvalidAuthorization;
    if payload.terminal_id.trim().is_empty()
        || payload.issued_at_ms <= 0
        || payload.expires_at_ms <= payload.issued_at_ms
        || payload.server_time_ms <= 0
        || payload.identity_epoch <= 0
        || payload.nonce.trim().is_empty()
        || payload.nonce.len() > 128
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
    use super::{MAX_KIT_LIFE_MS, MAX_KIT_STAFF, MAX_SIGNED_KIT_BYTES};

    const DOMAIN: &[u8] = b"peak-pos-sign-in-kit-v1\0";
    const NOW: i64 = 1_800_000_000_000;
    const DAY: i64 = 86_400_000;

    /// A kit issued `n` ms into the run-up to NOW: bigger is newer.
    fn t(n: i64) -> i64 {
        NOW - 1_000_000 + n
    }

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
        store.bind_terminal(binding(4)).unwrap();
        store
    }

    fn binding(epoch: i64) -> TerminalBinding {
        TerminalBinding {
                terminal_id: "terminal-1".into(),
                credential_epoch: epoch,
                property_id: "property-1".into(),
                outlet_id: "outlet-1".into(),
                register_id: "register-1".into(),
                trust_key_id: "server-key-1".into(),
                trust_public_key_b64: URL_SAFE_NO_PAD.encode(key().verifying_key().to_bytes()),
                configuration_payload_b64: URL_SAFE_NO_PAD.encode(b"configuration-v1"),
                revocation_generation: 2,
                paired_at_ms: NOW,
        }
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

    struct Kit<'a> {
        terminal: &'a str,
        issued: i64,
        expires: i64,
        nonce: &'a str,
        server_time: i64,
        epoch: i64,
        staff: Vec<Value>,
        padding: usize,
    }

    fn kit<'a>(issued: i64, staff: Vec<Value>) -> Kit<'a> {
        Kit {
            terminal: "terminal-1",
            issued,
            expires: issued + DAY,
            nonce: "not-the-tills-nonce",
            server_time: NOW,
            epoch: 4,
            staff,
            padding: 0,
        }
    }

    fn payload(kit: &Kit<'_>) -> Vec<u8> {
        let mut value = json!({
            "terminalId": kit.terminal, "issuedAtMs": kit.issued, "expiresAtMs": kit.expires,
            "nonce": kit.nonce, "serverTimeMs": kit.server_time, "identityEpoch": kit.epoch,
            "staff": kit.staff,
            "terminal": {"mode": "BAR", "prepStations": [], "propertyName": "Casanova",
                         "outletName": "Bar", "terminalName": "Main till", "capabilities": {}},
        });
        if kit.padding > 0 {
            // A field the till does not read: the kit still has to fit.
            value["padding"] = json!("x".repeat(kit.padding));
        }
        serde_json::to_vec(&value).unwrap()
    }

    fn sign(signer: &SigningKey, payload: &[u8]) -> (String, String) {
        let mut message = DOMAIN.to_vec();
        message.extend_from_slice(payload);
        (
            URL_SAFE_NO_PAD.encode(payload),
            URL_SAFE_NO_PAD.encode(signer.sign(&message).to_bytes()),
        )
    }

    fn signed(kit: &Kit<'_>) -> (String, String) {
        sign(&key(), &payload(kit))
    }

    fn install_kit(store: &mut LocalStore, kit: &Kit<'_>) -> Result<(), LocalStoreError> {
        let (signed_kit, signature) = signed(kit);
        store
            .install_sign_in_kit(&signed_kit, &signature, "server-key-1", NOW)
            .map(|_| ())
    }

    fn install(store: &mut LocalStore, issued: i64, staff: Vec<Value>) -> Result<(), LocalStoreError> {
        install_kit(store, &kit(issued, staff))
    }

    fn one_person() -> Vec<Value> {
        vec![member("staff-1", "Amina Hassan", Some("2468"))]
    }

    fn is_ok(check: SignInCheck) -> bool {
        matches!(check, SignInCheck::Ok { .. })
    }

    fn verify(store: &mut LocalStore, id: &str, pin: &str, now: i64) -> SignInCheck {
        store.verify_sign_in_pin(id, pin.into(), now).unwrap()
    }

    #[test]
    fn a_kit_with_a_bad_signature_is_refused_and_the_old_kit_stays() {
        let mut store = paired_store();
        install(&mut store, t(1_000), one_person()).unwrap();

        let other = SigningKey::from_bytes(&[9_u8; 32]);
        let (signed_kit, signature) = sign(&other, &payload(&kit(t(2_000), vec![])));
        let refused = store.install_sign_in_kit(&signed_kit, &signature, "server-key-1", NOW);
        assert!(matches!(refused, Err(LocalStoreError::InvalidAuthorization)));

        let (signed_kit, signature) = signed(&kit(t(3_000), vec![]));
        let mut tampered = URL_SAFE_NO_PAD.decode(&signed_kit).unwrap();
        tampered[10] ^= 1;
        assert!(store
            .install_sign_in_kit(&URL_SAFE_NO_PAD.encode(tampered), &signature, "server-key-1", NOW)
            .is_err());

        assert!(is_ok(verify(&mut store, "staff-1", "2468", NOW)));
    }

    #[test]
    fn a_kit_for_another_terminal_is_refused() {
        let mut store = paired_store();
        let mut other = kit(t(1_000), one_person());
        other.terminal = "terminal-2";
        assert!(install_kit(&mut store, &other).is_err());
        assert_eq!(verify(&mut store, "staff-1", "2468", NOW), SignInCheck::Unknown);
    }

    #[test]
    fn a_kit_for_another_pairing_is_refused_and_a_repair_ends_the_old_kit() {
        let mut store = paired_store();
        let mut wrong_epoch = kit(t(1_000), one_person());
        wrong_epoch.epoch = 5;
        assert!(install_kit(&mut store, &wrong_epoch).is_err());

        install(&mut store, t(1_000), one_person()).unwrap();
        assert!(is_ok(verify(&mut store, "staff-1", "2468", NOW)));
        // The same terminal id is paired again: a new credential epoch.
        store.bind_terminal(binding(5)).unwrap();
        assert_eq!(verify(&mut store, "staff-1", "2468", NOW), SignInCheck::Unknown);
    }

    #[test]
    fn a_till_that_is_not_paired_installs_nothing() {
        let mut store = paired_store();
        store
            .connection
            .execute("UPDATE terminal_authority SET lifecycle_state='REVOKED'", [])
            .unwrap();
        assert!(install(&mut store, t(1_000), one_person()).is_err());
    }

    fn keyset(first_state: &str) -> OfflinePublicKeyset {
        let make = |kid: &str, state: &str, public: [u8; 32]| OfflinePublicKey {
            kid: kid.into(),
            algorithm: "Ed25519".into(),
            signature_version: 1,
            state: state.into(),
            not_before: "2027-01-01T00:00:00Z".into(),
            not_after: "2028-01-01T00:00:00Z".into(),
            public_key_b64: URL_SAFE_NO_PAD.encode(public),
        };
        OfflinePublicKeyset {
            protocol_version: 1,
            issued_at: "2027-01-15T07:00:00Z".into(),
            keys: vec![
                make("server-key-1", first_state, key().verifying_key().to_bytes()),
                make("server-key-2", "CURRENT", [5_u8; 32]),
            ],
        }
    }

    #[test]
    fn a_key_the_till_does_not_trust_is_refused() {
        let mut store = paired_store();
        store.install_authenticated_keyset(&keyset("REVOKED"), NOW).unwrap();
        assert!(install(&mut store, t(900_000), one_person()).is_err());
    }

    #[test]
    fn a_kit_signed_by_a_key_since_dropped_or_revoked_checks_nobody() {
        let mut store = paired_store();
        install(&mut store, t(900_000), one_person()).unwrap();
        store.install_authenticated_keyset(&keyset("PREVIOUS"), NOW).unwrap();
        assert!(is_ok(verify(&mut store, "staff-1", "2468", NOW)));
        store.install_authenticated_keyset(&keyset("REVOKED"), NOW).unwrap();
        assert_eq!(verify(&mut store, "staff-1", "2468", NOW), SignInCheck::Unknown);
    }

    #[test]
    fn an_older_kit_is_refused_as_old_and_a_newer_one_replaces_the_whole_kit() {
        let mut store = paired_store();
        install(&mut store, t(2_000), one_person()).unwrap();
        assert!(matches!(
            install(&mut store, t(1_000), vec![]),
            Err(LocalStoreError::KitRollback)
        ));
        assert!(is_ok(verify(&mut store, "staff-1", "2468", NOW)));
        install(&mut store, t(3_000), vec![member("staff-2", "Juma Said", Some("1357"))]).unwrap();
        assert_eq!(verify(&mut store, "staff-1", "2468", NOW), SignInCheck::Unknown);
        assert!(is_ok(verify(&mut store, "staff-2", "1357", NOW)));
    }

    #[test]
    fn a_copy_that_is_not_the_agreed_argon2id_form_refuses_the_whole_kit() {
        let mut store = paired_store();
        let mut weak = member("staff-1", "Amina Hassan", Some("2468"));
        weak["tillCopyPhc"] = json!("$argon2id$v=19$m=1024,t=1,p=1$c2FsdHNhbHRzYWx0cw$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g");
        assert!(install(&mut store, t(1_000), vec![weak]).is_err());
    }

    #[test]
    fn a_copy_without_a_copy_version_refuses_the_whole_kit() {
        let mut store = paired_store();
        let mut person = member("staff-1", "Amina Hassan", Some("2468"));
        person.as_object_mut().unwrap().remove("copyVersion");
        assert!(install(&mut store, t(1_000), vec![person]).is_err());
    }

    #[test]
    fn two_people_with_one_staff_id_refuse_the_kit() {
        let mut store = paired_store();
        let twice = vec![member("staff-1", "Amina", None), member("staff-1", "Amina again", None)];
        // Refused by the kit's own rule, not by the table's key falling over.
        assert!(matches!(
            install(&mut store, t(1_000), twice),
            Err(LocalStoreError::InvalidAuthorization)
        ));
    }

    #[test]
    fn the_kit_holds_at_most_a_thousand_people() {
        let mut store = paired_store();
        let phc = copy("2468");
        let crowd = |count: usize| -> Vec<Value> {
            (0..count)
                .map(|n| {
                    json!({"staffId": format!("staff-{n}"), "displayName": format!("Person {n}"),
                           "needsSetup": false, "tillCopyPhc": phc, "copyVersion": "v",
                           "maxAttempts": 5, "baseLockoutMs": 60000, "roleCode": "WAITER", "permissions": []})
                })
                .collect()
        };
        assert!(install(&mut store, t(1_000), crowd(MAX_KIT_STAFF + 1)).is_err());
        install(&mut store, t(1_000), crowd(MAX_KIT_STAFF)).unwrap();
    }

    #[test]
    fn a_kit_too_big_to_be_ours_is_refused_before_it_is_read() {
        let mut store = paired_store();
        let mut big = kit(t(1_000), one_person());
        big.padding = MAX_SIGNED_KIT_BYTES;
        assert!(install_kit(&mut store, &big).is_err());
        // The same kit without the padding is fine.
        install(&mut store, t(1_000), one_person()).unwrap();
    }

    #[test]
    fn a_kit_that_lives_too_long_or_comes_from_the_future_is_refused() {
        let mut store = paired_store();
        let mut long = kit(t(1_000), one_person());
        long.expires = long.issued + MAX_KIT_LIFE_MS + 1;
        assert!(install_kit(&mut store, &long).is_err());
        long.expires = long.issued + MAX_KIT_LIFE_MS;
        install_kit(&mut store, &long).unwrap();

        let mut early = kit(NOW + 5 * 60 * 1000 + 1, one_person());
        early.expires = early.issued + DAY;
        assert!(install_kit(&mut store, &early).is_err());
        let mut just_in_time = kit(NOW + 5 * 60 * 1000, one_person());
        just_in_time.expires = just_in_time.issued + DAY;
        install_kit(&mut store, &just_in_time).unwrap();
    }

    #[test]
    fn a_correct_pin_gives_ok_with_the_person_and_the_terminal() {
        let mut store = paired_store();
        install(&mut store, t(1_000), one_person()).unwrap();
        match verify(&mut store, "staff-1", "2468", NOW) {
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
        install(&mut store, t(1_000), one_person()).unwrap();
        for left in [4, 3, 2, 1] {
            assert_eq!(
                verify(&mut store, "staff-1", "0000", NOW),
                SignInCheck::Wrong { attempts_left: left }
            );
        }
        assert_eq!(
            verify(&mut store, "staff-1", "0000", NOW),
            SignInCheck::Locked { until_ms: NOW + 60_000 }
        );
        // Locked means locked: even the right PIN waits.
        assert_eq!(
            verify(&mut store, "staff-1", "2468", NOW + 59_999),
            SignInCheck::Locked { until_ms: NOW + 60_000 }
        );
        // After the wait one more wrong PIN doubles it.
        assert_eq!(
            verify(&mut store, "staff-1", "0000", NOW + 60_000),
            SignInCheck::Locked { until_ms: NOW + 60_000 + 120_000 }
        );
        // After that wait the right PIN is let in and the count starts again.
        assert!(is_ok(verify(&mut store, "staff-1", "2468", NOW + 180_000)));
        assert_eq!(
            verify(&mut store, "staff-1", "0000", NOW + 180_001),
            SignInCheck::Wrong { attempts_left: 4 }
        );
    }

    #[test]
    fn the_kits_own_limits_are_the_ones_used() {
        let mut store = paired_store();
        let mut person = member("staff-1", "Amina Hassan", Some("2468"));
        person["maxAttempts"] = json!(2);
        person["baseLockoutMs"] = json!(1000);
        install(&mut store, t(1_000), vec![person]).unwrap();
        assert_eq!(
            verify(&mut store, "staff-1", "0000", NOW),
            SignInCheck::Wrong { attempts_left: 1 }
        );
        assert_eq!(
            verify(&mut store, "staff-1", "0000", NOW),
            SignInCheck::Locked { until_ms: NOW + 1_000 }
        );
    }

    #[test]
    fn an_empty_pin_is_not_a_try() {
        let mut store = paired_store();
        install(&mut store, t(1_000), one_person()).unwrap();
        for _ in 0..8 {
            assert_eq!(
                verify(&mut store, "staff-1", "", NOW),
                SignInCheck::Wrong { attempts_left: 5 }
            );
        }
        assert!(is_ok(verify(&mut store, "staff-1", "2468", NOW)));
    }

    #[test]
    fn a_person_absent_from_the_kit_is_unknown() {
        let mut store = paired_store();
        install(&mut store, t(1_000), one_person()).unwrap();
        assert_eq!(verify(&mut store, "staff-9", "2468", NOW), SignInCheck::Unknown);
    }

    #[test]
    fn a_person_with_no_copy_gives_no_copy_and_no_count() {
        let mut store = paired_store();
        let mut absent = member("staff-3", "Zawadi", Some("1111"));
        absent.as_object_mut().unwrap().remove("tillCopyPhc");
        absent.as_object_mut().unwrap().remove("copyVersion");
        install(&mut store, t(1_000), vec![member("staff-2", "Juma Said", None), absent]).unwrap();
        for id in ["staff-2", "staff-3"] {
            for _ in 0..7 {
                assert_eq!(verify(&mut store, id, "1111", NOW), SignInCheck::NoCopy);
            }
        }
    }

    #[test]
    fn a_lock_the_server_set_counts_as_locked_until_it_ends() {
        let mut store = paired_store();
        let mut person = member("staff-1", "Amina Hassan", Some("2468"));
        person["lockedUntilMs"] = json!(NOW + 5_000);
        install(&mut store, t(1_000), vec![person]).unwrap();
        assert_eq!(
            verify(&mut store, "staff-1", "2468", NOW),
            SignInCheck::Locked { until_ms: NOW + 5_000 }
        );
        assert!(is_ok(verify(&mut store, "staff-1", "2468", NOW + 5_000)));
    }

    #[test]
    fn after_clearing_the_kit_every_check_is_unknown() {
        let mut store = paired_store();
        install(&mut store, t(1_000), one_person()).unwrap();
        store.clear_sign_in_kit().unwrap();
        assert_eq!(verify(&mut store, "staff-1", "2468", NOW), SignInCheck::Unknown);
    }

    #[test]
    fn clearing_and_reinstalling_does_not_give_fresh_tries() {
        let mut store = paired_store();
        install(&mut store, t(1_000), one_person()).unwrap();
        for _ in 0..3 {
            verify(&mut store, "staff-1", "0000", NOW);
        }
        store.clear_sign_in_kit().unwrap();
        install(&mut store, t(1_001), one_person()).unwrap();
        assert_eq!(
            verify(&mut store, "staff-1", "0000", NOW),
            SignInCheck::Wrong { attempts_left: 1 }
        );
        assert_eq!(
            verify(&mut store, "staff-1", "0000", NOW),
            SignInCheck::Locked { until_ms: NOW + 60_000 }
        );
        store.clear_sign_in_kit().unwrap();
        install(&mut store, t(1_002), one_person()).unwrap();
        assert_eq!(
            verify(&mut store, "staff-1", "2468", NOW + 1),
            SignInCheck::Locked { until_ms: NOW + 60_000 }
        );
    }

    #[test]
    fn a_cleared_kit_cannot_come_back() {
        let mut store = paired_store();
        install(&mut store, t(2_000), one_person()).unwrap();
        store.clear_sign_in_kit().unwrap();
        assert!(matches!(
            install(&mut store, t(2_000), one_person()),
            Err(LocalStoreError::KitRollback)
        ));
        assert!(matches!(
            install(&mut store, t(1_999), one_person()),
            Err(LocalStoreError::KitRollback)
        ));
        // A newer kit is fine.
        install(&mut store, t(2_001), one_person()).unwrap();
    }

    #[test]
    fn an_expired_kit_is_refused_and_stops_checking_when_it_runs_out() {
        let mut store = paired_store();
        let mut gone = kit(t(1_000), one_person());
        gone.expires = NOW;
        assert!(install_kit(&mut store, &gone).is_err());

        let expires = NOW + 5_000;
        let mut live = kit(t(1_000), one_person());
        live.expires = expires;
        install_kit(&mut store, &live).unwrap();
        assert!(is_ok(verify(&mut store, "staff-1", "2468", expires - 1)));
        assert_eq!(verify(&mut store, "staff-1", "2468", expires), SignInCheck::Unknown);
    }

    #[test]
    fn a_revoked_till_checks_nobody() {
        let mut store = paired_store();
        install(&mut store, t(1_000), one_person()).unwrap();
        store
            .connection
            .execute("UPDATE terminal_authority SET lifecycle_state='REVOKED'", [])
            .unwrap();
        assert_eq!(verify(&mut store, "staff-1", "2468", NOW), SignInCheck::Unknown);
    }

    #[test]
    fn a_refresh_keeps_the_count_for_the_same_copy_and_drops_it_for_a_new_one() {
        let mut store = paired_store();
        install(&mut store, t(1_000), one_person()).unwrap();
        for _ in 0..3 {
            verify(&mut store, "staff-1", "0000", NOW);
        }
        let same = store
            .connection
            .query_row("SELECT till_copy_phc FROM sign_in_kit_staff", [], |r| r.get::<_, String>(0))
            .unwrap();
        let mut person = member("staff-1", "Amina Hassan", Some("2468"));
        person["tillCopyPhc"] = json!(same);
        install(&mut store, t(2_000), vec![person]).unwrap();
        assert_eq!(
            verify(&mut store, "staff-1", "0000", NOW),
            SignInCheck::Wrong { attempts_left: 1 }
        );
        // A new PIN is a new copy: the old count does not follow it.
        install(&mut store, t(3_000), vec![member("staff-1", "Amina Hassan", Some("9999"))]).unwrap();
        assert_eq!(
            verify(&mut store, "staff-1", "0000", NOW),
            SignInCheck::Wrong { attempts_left: 4 }
        );
    }

    #[test]
    fn a_kit_that_names_no_version_for_someone_keeps_their_count() {
        let mut store = paired_store();
        install(&mut store, t(1_000), one_person()).unwrap();
        for _ in 0..3 {
            verify(&mut store, "staff-1", "0000", NOW);
        }
        install(&mut store, t(2_000), vec![member("staff-1", "Amina Hassan", None)]).unwrap();
        assert_eq!(verify(&mut store, "staff-1", "2468", NOW), SignInCheck::NoCopy);
        install(&mut store, t(3_000), one_person()).unwrap();
        assert_eq!(
            verify(&mut store, "staff-1", "0000", NOW),
            SignInCheck::Wrong { attempts_left: 1 }
        );
    }

    #[test]
    fn a_clock_set_back_cannot_escape_a_lockout_or_open_the_till() {
        let mut store = paired_store();
        install(&mut store, t(1_000), one_person()).unwrap();
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
                .verify_sign_in_pin_trusted("staff-1", "2468".into(), NOW - DAY, 23_000, "boot-a")
                .unwrap(),
            SignInCheck::Unknown
        );
        // And nothing new is installed on a clock that cannot be trusted.
        let (signed_kit, signature) = signed(&kit(t(5_000), one_person()));
        assert!(store
            .install_sign_in_kit_trusted(&signed_kit, &signature, "server-key-1", NOW - DAY, 24_000, "boot-a")
            .is_err());
    }

    #[test]
    fn with_no_trusted_clock_and_no_nonce_nothing_is_installed_or_checked() {
        let mut store = paired_store();
        install(&mut store, t(1_000), one_person()).unwrap();
        assert_eq!(
            store
                .verify_sign_in_pin_trusted("staff-1", "2468".into(), NOW, 21_000, "boot-a")
                .unwrap(),
            SignInCheck::Unknown
        );
        let mut guess = kit(t(5_000), one_person());
        guess.nonce = "a-nonce-the-till-never-made";
        let (signed_kit, signature) = signed(&guess);
        assert!(store
            .install_sign_in_kit_trusted(&signed_kit, &signature, "server-key-1", NOW, 21_000, "boot-a")
            .is_err());
    }

    fn server_time_row(store: &LocalStore) -> i64 {
        store
            .connection
            .query_row("SELECT server_time_ms FROM trusted_time_state WHERE singleton_id=1", [], |r| r.get(0))
            .unwrap()
    }

    #[test]
    fn a_kit_answering_the_tills_nonce_sets_the_clock_so_the_first_sign_in_works() {
        let mut store = paired_store();
        let nonce = store.new_sign_in_kit_nonce(19_000, "boot-a").unwrap();
        assert_eq!(URL_SAFE_NO_PAD.decode(&nonce).unwrap().len(), 32);
        let mut answer = kit(t(1_000), one_person());
        answer.nonce = &nonce;
        let (signed_kit, signature) = signed(&answer);

        // A fresh boot: no anchor, so no check.
        assert_eq!(
            store.verify_sign_in_pin_trusted("staff-1", "2468".into(), NOW + 50, 20_000, "boot-a").unwrap(),
            SignInCheck::Unknown
        );
        store
            .install_sign_in_kit_trusted(&signed_kit, &signature, "server-key-1", NOW + 50, 20_000, "boot-a")
            .unwrap();
        assert_eq!(server_time_row(&store), NOW);
        assert!(is_ok(
            store.verify_sign_in_pin_trusted("staff-1", "2468".into(), NOW + 1_050, 21_000, "boot-a").unwrap()
        ));
    }

    #[test]
    fn a_nonce_is_used_once_and_a_replayed_kit_never_moves_the_clock() {
        let mut store = paired_store();
        let nonce = store.new_sign_in_kit_nonce(19_000, "boot-a").unwrap();
        let mut answer = kit(t(1_000), one_person());
        answer.nonce = &nonce;
        let (signed_kit, signature) = signed(&answer);
        store
            .install_sign_in_kit_trusted(&signed_kit, &signature, "server-key-1", NOW + 50, 20_000, "boot-a")
            .unwrap();
        assert_eq!(server_time_row(&store), NOW);

        // The same nonce again, in a kit that says the server's time is later.
        let mut replay = kit(t(2_000), one_person());
        replay.nonce = &nonce;
        replay.server_time = NOW + 5_000_000;
        let (signed_kit, signature) = signed(&replay);
        store
            .install_sign_in_kit_trusted(&signed_kit, &signature, "server-key-1", NOW + 2_050, 22_000, "boot-a")
            .unwrap();
        assert_eq!(server_time_row(&store), NOW, "a used nonce must not move the clock");

        // And a nonce only the latest request holds: an older one is no good.
        let older = store.new_sign_in_kit_nonce(22_000, "boot-a").unwrap();
        let newer = store.new_sign_in_kit_nonce(22_100, "boot-a").unwrap();
        assert_ne!(older, newer);
        let mut stale = kit(t(3_000), one_person());
        stale.nonce = &older;
        stale.server_time = NOW + 7_000_000;
        let (signed_kit, signature) = signed(&stale);
        store
            .install_sign_in_kit_trusted(&signed_kit, &signature, "server-key-1", NOW + 3_050, 23_000, "boot-a")
            .unwrap();
        assert_eq!(server_time_row(&store), NOW);
    }

    #[test]
    fn a_kit_cannot_set_the_clock_backwards_past_the_rollback_detector() {
        let mut store = paired_store();
        let nonce = store.new_sign_in_kit_nonce(19_000, "boot-a").unwrap();
        let mut first = kit(NOW - 5_000_000, one_person());
        first.nonce = &nonce;
        let (signed_kit, signature) = signed(&first);
        store
            .install_sign_in_kit_trusted(&signed_kit, &signature, "server-key-1", NOW + 50, 20_000, "boot-a")
            .unwrap();

        let nonce = store.new_sign_in_kit_nonce(22_000, "boot-a").unwrap();
        let mut back = kit(NOW - 3_650_000, vec![member("staff-2", "Juma Said", Some("1357"))]);
        back.nonce = &nonce;
        back.server_time = NOW - 3_600_000;
        let (signed_kit, signature) = signed(&back);
        let refused = store.install_sign_in_kit_trusted(&signed_kit, &signature, "server-key-1", NOW + 3_050, 23_000, "boot-a");
        assert!(matches!(refused, Err(LocalStoreError::AuthorizationRollback)));
        assert_eq!(server_time_row(&store), NOW);
        assert_eq!(
            store.verify_sign_in_pin_trusted("staff-2", "1357".into(), NOW + 3_050, 23_000, "boot-a").unwrap(),
            SignInCheck::Unknown
        );
    }

    fn anchor_rows(store: &LocalStore) -> i64 {
        store
            .connection
            .query_row("SELECT count(*) FROM trusted_time_state", [], |r| r.get(0))
            .unwrap()
    }

    fn nonce_rows(store: &LocalStore) -> i64 {
        store
            .connection
            .query_row("SELECT count(*) FROM sign_in_kit_nonce", [], |r| r.get(0))
            .unwrap()
    }

    /// A kit answering `nonce`, signed, ready to install.
    fn answer_to(nonce: &str, issued: i64) -> (String, String) {
        let mut answer = kit(issued, one_person());
        answer.nonce = nonce;
        signed(&answer)
    }

    #[test]
    fn a_failed_install_leaves_the_clock_and_the_nonce_as_they_were() {
        let mut store = paired_store();
        let nonce = store.new_sign_in_kit_nonce(19_000, "boot-a").unwrap();
        // Force the kit's own writes to fail, after the clock and the nonce
        // have been dealt with inside the install.
        store
            .connection
            .execute_batch(
                "CREATE TRIGGER force_failure BEFORE INSERT ON sign_in_kit_staff
                 BEGIN SELECT RAISE(ABORT,'forced'); END;",
            )
            .unwrap();
        let (signed_kit, signature) = answer_to(&nonce, t(1_000));
        assert!(store
            .install_sign_in_kit_trusted(&signed_kit, &signature, "server-key-1", NOW + 50, 20_000, "boot-a")
            .is_err());
        assert_eq!(anchor_rows(&store), 0, "the clock moved though the install failed");
        assert_eq!(nonce_rows(&store), 1, "the nonce was used up by a failed install");
        // The same answer then works: nothing was spent.
        store.connection.execute_batch("DROP TRIGGER force_failure").unwrap();
        store
            .install_sign_in_kit_trusted(&signed_kit, &signature, "server-key-1", NOW + 50, 20_000, "boot-a")
            .unwrap();
        assert_eq!(anchor_rows(&store), 1);
        assert_eq!(nonce_rows(&store), 0);
    }

    #[test]
    fn a_nonce_from_another_boot_does_not_anchor() {
        let mut store = paired_store();
        let nonce = store.new_sign_in_kit_nonce(19_000, "boot-a").unwrap();
        let (signed_kit, signature) = answer_to(&nonce, t(1_000));
        assert!(store
            .install_sign_in_kit_trusted(&signed_kit, &signature, "server-key-1", NOW + 50, 20_000, "boot-b")
            .is_err());
        assert_eq!(anchor_rows(&store), 0);
        assert_eq!(nonce_rows(&store), 1);
    }

    #[test]
    fn a_nonce_older_than_its_time_does_not_anchor_and_one_in_time_does() {
        // Too old: 30 s and a millisecond.
        let mut store = paired_store();
        let nonce = store.new_sign_in_kit_nonce(19_000, "boot-a").unwrap();
        let (signed_kit, signature) = answer_to(&nonce, t(1_000));
        assert!(store
            .install_sign_in_kit_trusted(&signed_kit, &signature, "server-key-1", NOW + 30_051, 49_001, "boot-a")
            .is_err());
        assert_eq!(anchor_rows(&store), 0);

        // Just in time: exactly 30 s.
        let mut store = paired_store();
        let nonce = store.new_sign_in_kit_nonce(19_000, "boot-a").unwrap();
        let (signed_kit, signature) = answer_to(&nonce, t(1_000));
        store
            .install_sign_in_kit_trusted(&signed_kit, &signature, "server-key-1", NOW + 30_050, 49_000, "boot-a")
            .unwrap();
        assert_eq!(server_time_row(&store), NOW);

        // Already anchored: a late answer still installs, but never moves the clock.
        let nonce = store.new_sign_in_kit_nonce(22_000, "boot-a").unwrap();
        let mut late = kit(t(2_000), one_person());
        late.nonce = &nonce;
        late.server_time = NOW + 9_000_000;
        let (signed_kit, signature) = signed(&late);
        store
            .install_sign_in_kit_trusted(&signed_kit, &signature, "server-key-1", NOW + 62_050, 82_001, "boot-a")
            .unwrap();
        assert_eq!(server_time_row(&store), NOW);
    }

    #[test]
    fn the_json_the_wrapper_relies_on() {
        let mut store = paired_store();
        install(&mut store, t(1_000), vec![member("staff-1", "Amina Hassan", Some("2468")), member("staff-2", "Juma", None)]).unwrap();
        let terminal = json!({"mode": "BAR", "prepStations": [], "propertyName": "Casanova",
                              "outletName": "Bar", "terminalName": "Main till", "capabilities": {}});
        assert_eq!(
            serde_json::to_value(verify(&mut store, "staff-1", "2468", NOW)).unwrap(),
            json!({"state": "OK", "terminal": terminal,
                   "staff": {"staffId": "staff-1", "displayName": "Amina Hassan",
                             "roleCode": "POS_CASHIER", "permissions": ["pos.order.create"]}})
        );
        assert_eq!(
            serde_json::to_value(verify(&mut store, "staff-1", "0000", NOW)).unwrap(),
            json!({"state": "WRONG", "attemptsLeft": 4})
        );
        assert_eq!(
            serde_json::to_value(SignInCheck::Locked { until_ms: 99 }).unwrap(),
            json!({"state": "LOCKED", "untilMs": 99})
        );
        assert_eq!(
            serde_json::to_value(verify(&mut store, "staff-2", "1", NOW)).unwrap(),
            json!({"state": "NO_COPY"})
        );
        assert_eq!(
            serde_json::to_value(verify(&mut store, "staff-9", "1", NOW)).unwrap(),
            json!({"state": "UNKNOWN"})
        );
        let (signed_kit, signature) = signed(&kit(t(2_000), one_person()));
        let summary = store.install_sign_in_kit(&signed_kit, &signature, "server-key-1", NOW).unwrap();
        assert_eq!(
            serde_json::to_value(summary).unwrap(),
            json!({"terminalId": "terminal-1", "issuedAtMs": t(2_000),
                   "expiresAtMs": t(2_000) + DAY, "staffCount": 1})
        );
        assert_eq!(
            serde_json::to_value(LocalStoreError::KitRollback.kind()).unwrap(),
            json!("KIT_ROLLBACK")
        );
    }

    /// The point of the kit: a check at the till copy's cost is quick. Runs in
    /// CI on all three systems; the numbers are printed in the job log.
    #[test]
    fn timing_twenty_checks_of_a_correct_pin() {
        let mut store = paired_store();
        install(&mut store, t(1_000), one_person()).unwrap();
        let mut millis = Vec::new();
        for _ in 0..20 {
            let started = Instant::now();
            let check = verify(&mut store, "staff-1", "2468", NOW);
            millis.push(started.elapsed().as_secs_f64() * 1000.0);
            assert!(is_ok(check));
        }
        millis.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let median = (millis[9] + millis[10]) / 2.0;
        let worst = millis[19];
        println!("SIGN_IN_KIT_TIMING median={median:.1}ms worst={worst:.1}ms over 20 checks");
        assert!(median <= 100.0, "median {median:.1} ms is over 100 ms");
    }
}
