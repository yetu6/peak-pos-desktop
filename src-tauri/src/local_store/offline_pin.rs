use argon2::{
    password_hash::{phc::PasswordHash, PasswordVerifier},
    Argon2,
};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::Serialize;
use zeroize::Zeroizing;

use super::{classify_sql_error, LocalStore, LocalStoreError, OfflineEligibilityState};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OfflineAuthenticationState {
    Authenticated,
    Denied,
    Locked,
    Expired,
    Revoked,
    NotEligible,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfflineAuthenticationResult {
    pub state: OfflineAuthenticationState,
    pub staff_id: Option<String>,
    pub display_name: Option<String>,
    pub shift_id: Option<String>,
    pub lease_id: Option<String>,
    pub expires_at_ms: Option<i64>,
    pub retry_after_ms: Option<i64>,
}

struct OfflineVerifierRow {
    bundle_id: String,
    lease_id: String,
    shift_id: String,
    bundle_state: String,
    hard_expires_at_ms: i64,
    terminal_state: String,
    shift_state: String,
    catalog_matches: bool,
    display_name: String,
    verifier_phc: String,
    verifier_expires_at_ms: i64,
    max_attempts: i64,
    base_lockout_ms: i64,
    attempts: i64,
    locked_until_ms: Option<i64>,
    revoked_at_ms: Option<i64>,
}

impl LocalStore {
    pub fn authenticate_offline_staff(
        &mut self,
        staff_id: &str,
        pin: String,
        now_ms: i64,
    ) -> Result<OfflineAuthenticationResult, LocalStoreError> {
        let eligibility = self.offline_eligibility(Some(staff_id), now_ms)?;
        match eligibility.state {
            OfflineEligibilityState::Eligible => {}
            OfflineEligibilityState::DeviceRevoked => {
                return Ok(result(OfflineAuthenticationState::Revoked));
            }
            OfflineEligibilityState::LeaseExpired => {
                return Ok(result(OfflineAuthenticationState::Expired));
            }
            _ => return Ok(result(OfflineAuthenticationState::NotEligible)),
        }
        let pin = Zeroizing::new(pin);
        authenticate_offline_staff_impl(&mut self.connection, staff_id, &pin, now_ms)
    }
}

pub(super) fn authenticate_offline_staff_impl(
    connection: &mut Connection,
    staff_id: &str,
    pin: &str,
    now_ms: i64,
) -> Result<OfflineAuthenticationResult, LocalStoreError> {
    if staff_id.trim().is_empty() || pin.is_empty() || now_ms <= 0 {
        return Ok(result(OfflineAuthenticationState::Denied));
    }
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(classify_sql_error)?;
    let row = transaction
        .query_row(
            "SELECT b.bundle_id,b.lease_id,b.shift_id,b.state,b.hard_expires_at_ms,
                    t.lifecycle_state,s.state,
                    EXISTS(SELECT 1 FROM active_catalog ac JOIN catalog_snapshots c
                           ON c.snapshot_id=ac.snapshot_id
                           WHERE c.version=b.catalog_version AND c.digest=b.catalog_digest
                             AND c.verification_state='VERIFIED'),
                    v.display_name,v.verifier_phc,v.expires_at_ms,v.max_attempts,
                    v.base_lockout_ms,v.attempts,v.locked_until_ms,v.revoked_at_ms
             FROM offline_staff_verifiers v
             JOIN authorization_bundles b ON b.bundle_id=v.bundle_id
             JOIN terminal_authority t ON t.terminal_id=b.terminal_id
                                      AND t.credential_epoch=b.credential_epoch AND t.is_current=1
             JOIN shift_authority s ON s.bundle_id=b.bundle_id
             WHERE v.staff_id=?1 AND b.state IN ('STAGED','ACTIVE')
             ORDER BY b.generation DESC LIMIT 1",
            [staff_id],
            |row| {
                Ok(OfflineVerifierRow {
                    bundle_id: row.get(0)?,
                    lease_id: row.get(1)?,
                    shift_id: row.get(2)?,
                    bundle_state: row.get(3)?,
                    hard_expires_at_ms: row.get(4)?,
                    terminal_state: row.get(5)?,
                    shift_state: row.get(6)?,
                    catalog_matches: row.get(7)?,
                    display_name: row.get(8)?,
                    verifier_phc: row.get(9)?,
                    verifier_expires_at_ms: row.get(10)?,
                    max_attempts: row.get(11)?,
                    base_lockout_ms: row.get(12)?,
                    attempts: row.get(13)?,
                    locked_until_ms: row.get(14)?,
                    revoked_at_ms: row.get(15)?,
                })
            },
        )
        .optional()
        .map_err(classify_sql_error)?;
    let Some(row) = row else {
        transaction.commit().map_err(classify_sql_error)?;
        return Ok(result(OfflineAuthenticationState::NotEligible));
    };

    let gate_state = if row.terminal_state == "REVOKED" || row.revoked_at_ms.is_some() {
        Some(OfflineAuthenticationState::Revoked)
    } else if now_ms > row.hard_expires_at_ms || now_ms > row.verifier_expires_at_ms {
        Some(OfflineAuthenticationState::Expired)
    } else if row.bundle_state != "ACTIVE" || row.shift_state != "ACTIVE" || !row.catalog_matches {
        Some(OfflineAuthenticationState::NotEligible)
    } else if row.locked_until_ms.is_some_and(|until| now_ms < until) {
        Some(OfflineAuthenticationState::Locked)
    } else {
        None
    };
    if let Some(state) = gate_state {
        transaction.commit().map_err(classify_sql_error)?;
        let mut output = result(state);
        output.retry_after_ms = row.locked_until_ms.filter(|until| *until > now_ms);
        return Ok(output);
    }

    let parsed =
        PasswordHash::new(&row.verifier_phc).map_err(|_| LocalStoreError::InvalidAuthorization)?;
    if Argon2::default()
        .verify_password(pin.as_bytes(), &parsed)
        .is_err()
    {
        let attempts = row.attempts.saturating_add(1);
        let exponent = u32::try_from(attempts.saturating_sub(1).min(16)).unwrap_or(16);
        let backoff = row
            .base_lockout_ms
            .saturating_mul(2_i64.saturating_pow(exponent));
        let locked_until = if attempts >= row.max_attempts {
            row.hard_expires_at_ms
        } else {
            now_ms.saturating_add(backoff).min(row.hard_expires_at_ms)
        };
        transaction
            .execute(
                "UPDATE offline_staff_verifiers SET attempts=?1,locked_until_ms=?2
             WHERE bundle_id=?3 AND staff_id=?4",
                params![attempts, locked_until, row.bundle_id, staff_id],
            )
            .map_err(classify_sql_error)?;
        transaction.commit().map_err(classify_sql_error)?;
        let mut output = result(if attempts >= row.max_attempts {
            OfflineAuthenticationState::Locked
        } else {
            OfflineAuthenticationState::Denied
        });
        output.retry_after_ms = Some(locked_until);
        return Ok(output);
    }

    transaction
        .execute(
            "UPDATE offline_staff_verifiers
         SET attempts=0,locked_until_ms=NULL,last_authenticated_at_ms=?1
         WHERE bundle_id=?2 AND staff_id=?3",
            params![now_ms, row.bundle_id, staff_id],
        )
        .map_err(classify_sql_error)?;
    transaction.commit().map_err(classify_sql_error)?;
    Ok(OfflineAuthenticationResult {
        state: OfflineAuthenticationState::Authenticated,
        staff_id: Some(staff_id.to_string()),
        display_name: Some(row.display_name),
        shift_id: Some(row.shift_id),
        lease_id: Some(row.lease_id),
        expires_at_ms: Some(row.hard_expires_at_ms.min(row.verifier_expires_at_ms)),
        retry_after_ms: None,
    })
}

fn result(state: OfflineAuthenticationState) -> OfflineAuthenticationResult {
    OfflineAuthenticationResult {
        state,
        staff_id: None,
        display_name: None,
        shift_id: None,
        lease_id: None,
        expires_at_ms: None,
        retry_after_ms: None,
    }
}

#[cfg(test)]
mod tests {
    use argon2::{password_hash::PasswordHasher, Argon2};
    use rusqlite::{params, Connection};

    use super::super::migrations;
    use super::{authenticate_offline_staff_impl, OfflineAuthenticationState};

    fn eligible_connection() -> Connection {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .pragma_update(None, "foreign_keys", true)
            .unwrap();
        migrations::migrate(&mut connection).unwrap();
        let verifier = Argon2::default()
            .hash_password(b"2468")
            .unwrap()
            .to_string();
        connection.execute_batch(
            "INSERT INTO catalog_snapshots(snapshot_id,version,digest,currency,published_at_ms,signed_manifest,payload,verification_state)
             VALUES ('catalog-id','catalog-8','sha256:catalog','TZS',100,x'01',x'02','VERIFIED');
             INSERT INTO active_catalog(singleton_id,snapshot_id,activated_at_ms) VALUES (1,'catalog-id',100);
             INSERT INTO terminal_authority(terminal_id,credential_epoch,property_id,outlet_id,register_id,trust_key_id,trust_public_key,configuration_payload,lifecycle_state,is_current,revocation_generation,paired_at_ms,updated_at_ms)
             VALUES ('terminal-1',4,'property-1','outlet-1','register-1','key-1',zeroblob(32),x'01','PAIRED',1,2,100,100);
             INSERT INTO authorization_bundles(bundle_id,terminal_id,credential_epoch,generation,lease_id,property_id,outlet_id,register_id,shift_id,business_date,catalog_version,catalog_digest,issued_at_ms,not_before_ms,refresh_after_ms,hard_expires_at_ms,revocation_generation,max_operation_count,max_gross_minor,max_cash_minor,allowed_operations_json,signing_key_id,signed_payload,signature,state,received_at_ms)
             VALUES ('bundle-1','terminal-1',4,1,'lease-1','property-1','outlet-1','register-1','shift-1','2026-09-03','catalog-8','sha256:catalog',1000,1000,5000,10000,2,50,500000,500000,'[\"ORDER_COMMIT\"]','key-1',x'01',zeroblob(64),'ACTIVE',1000);
             INSERT INTO shift_authority(bundle_id,shift_id,staff_scope_json,state,opened_at_ms)
             VALUES ('bundle-1','shift-1','[\"staff-1\"]','ACTIVE',500);
             INSERT INTO authorization_clock_anchor(singleton_id,server_time_ms,observed_wall_time_ms,bundle_generation,updated_at_ms)
             VALUES (1,1000,1000,1,1000);",
        ).unwrap();
        connection.execute(
            "INSERT INTO offline_staff_verifiers(bundle_id,staff_id,display_name,verifier_phc,permissions_json,expires_at_ms,max_attempts,base_lockout_ms,attempts)
             VALUES ('bundle-1','staff-1','Amina Hassan',?1,'[\"pos.order.create\"]',10000,3,1000,0)",
            params![verifier],
        ).unwrap();
        connection
    }

    #[test]
    fn correct_pin_authenticates_only_when_all_authority_is_eligible() {
        let mut connection = eligible_connection();
        let result =
            authenticate_offline_staff_impl(&mut connection, "staff-1", "2468", 2_000).unwrap();
        assert_eq!(result.state, OfflineAuthenticationState::Authenticated);
        assert_eq!(result.staff_id.as_deref(), Some("staff-1"));
        assert_eq!(result.shift_id.as_deref(), Some("shift-1"));
    }

    #[test]
    fn wrong_pin_persists_backoff_before_returning_and_survives_retry() {
        let mut connection = eligible_connection();
        let denied =
            authenticate_offline_staff_impl(&mut connection, "staff-1", "0000", 2_000).unwrap();
        assert_eq!(denied.state, OfflineAuthenticationState::Denied);
        let (attempts, locked_until): (i64, i64) = connection.query_row(
            "SELECT attempts,locked_until_ms FROM offline_staff_verifiers WHERE staff_id='staff-1'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).unwrap();
        assert_eq!((attempts, locked_until), (1, 3_000));

        let locked =
            authenticate_offline_staff_impl(&mut connection, "staff-1", "2468", 2_500).unwrap();
        assert_eq!(locked.state, OfflineAuthenticationState::Locked);
        let accepted =
            authenticate_offline_staff_impl(&mut connection, "staff-1", "2468", 3_001).unwrap();
        assert_eq!(accepted.state, OfflineAuthenticationState::Authenticated);
    }

    #[test]
    fn expired_lease_fails_before_pin_verification() {
        let mut connection = eligible_connection();
        let result =
            authenticate_offline_staff_impl(&mut connection, "staff-1", "2468", 10_001).unwrap();
        assert_eq!(result.state, OfflineAuthenticationState::Expired);
        let attempts: i64 = connection
            .query_row(
                "SELECT attempts FROM offline_staff_verifiers WHERE staff_id='staff-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(attempts, 0);
    }

    #[test]
    fn maximum_failed_attempts_lock_until_the_authorization_expires() {
        let mut connection = eligible_connection();
        let first =
            authenticate_offline_staff_impl(&mut connection, "staff-1", "0000", 2_000).unwrap();
        assert_eq!(first.state, OfflineAuthenticationState::Denied);
        let second =
            authenticate_offline_staff_impl(&mut connection, "staff-1", "0000", 3_001).unwrap();
        assert_eq!(second.state, OfflineAuthenticationState::Denied);
        let third =
            authenticate_offline_staff_impl(&mut connection, "staff-1", "0000", 5_002).unwrap();
        assert_eq!(third.state, OfflineAuthenticationState::Locked);
        assert_eq!(third.retry_after_ms, Some(10_000));
        let still_locked =
            authenticate_offline_staff_impl(&mut connection, "staff-1", "2468", 9_999).unwrap();
        assert_eq!(still_locked.state, OfflineAuthenticationState::Locked);
    }
}
