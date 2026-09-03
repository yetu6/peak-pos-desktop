use rusqlite::{params, OptionalExtension};
use serde::Serialize;

use super::{classify_sql_error, LocalStore, LocalStoreError};

const CLOCK_ROLLBACK_TOLERANCE_MS: i64 = 300_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OfflineEligibilityState {
    Eligible,
    BootstrapRequired,
    DeviceRevoked,
    StorageUnhealthy,
    LeaseNotYetValid,
    LeaseExpired,
    ClockRollback,
    ShiftRequired,
    ShiftMismatch,
    CatalogRequired,
    StaffRequired,
    LimitExhausted,
}

#[derive(Debug, Clone)]
pub struct EligibilityFacts {
    pub storage_healthy: bool,
    pub terminal_present: bool,
    pub terminal_revoked: bool,
    pub bundle_present: bool,
    pub bundle_active: bool,
    pub not_before_ms: i64,
    pub hard_expires_at_ms: i64,
    pub observed_wall_time_ms: i64,
    pub shift_active: bool,
    pub shift_matches: bool,
    pub catalog_matches: bool,
    pub staff_required: bool,
    pub staff_eligible: bool,
    pub operation_count_remaining: i64,
    pub gross_remaining_minor: i64,
    pub cash_remaining_minor: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfflineEligibilityStatus {
    pub state: OfflineEligibilityState,
    pub lease_id: Option<String>,
    pub shift_id: Option<String>,
    pub catalog_version: Option<String>,
    pub hard_expires_at_ms: Option<i64>,
    pub operation_count_remaining: Option<i64>,
    pub gross_remaining_minor: Option<i64>,
    pub cash_remaining_minor: Option<i64>,
}

pub fn evaluate(facts: &EligibilityFacts, now_ms: i64) -> OfflineEligibilityState {
    if !facts.storage_healthy {
        return OfflineEligibilityState::StorageUnhealthy;
    }
    if !facts.terminal_present {
        return OfflineEligibilityState::BootstrapRequired;
    }
    if facts.terminal_revoked {
        return OfflineEligibilityState::DeviceRevoked;
    }
    if !facts.bundle_present {
        return OfflineEligibilityState::BootstrapRequired;
    }
    if now_ms < facts.not_before_ms {
        return OfflineEligibilityState::LeaseNotYetValid;
    }
    if now_ms > facts.hard_expires_at_ms {
        return OfflineEligibilityState::LeaseExpired;
    }
    if now_ms.saturating_add(CLOCK_ROLLBACK_TOLERANCE_MS) < facts.observed_wall_time_ms {
        return OfflineEligibilityState::ClockRollback;
    }
    if !facts.shift_active {
        return OfflineEligibilityState::ShiftRequired;
    }
    if !facts.shift_matches {
        return OfflineEligibilityState::ShiftMismatch;
    }
    if !facts.catalog_matches {
        return OfflineEligibilityState::CatalogRequired;
    }
    if !facts.bundle_active {
        return OfflineEligibilityState::BootstrapRequired;
    }
    if facts.staff_required && !facts.staff_eligible {
        return OfflineEligibilityState::StaffRequired;
    }
    if facts.operation_count_remaining <= 0
        || facts.gross_remaining_minor <= 0
        || facts.cash_remaining_minor <= 0
    {
        return OfflineEligibilityState::LimitExhausted;
    }
    OfflineEligibilityState::Eligible
}

impl LocalStore {
    pub fn offline_eligibility(
        &self,
        staff_id: Option<&str>,
        now_ms: i64,
    ) -> Result<OfflineEligibilityStatus, LocalStoreError> {
        let row = self
            .connection
            .query_row(
                "SELECT t.lifecycle_state,b.bundle_id,b.state,b.not_before_ms,b.hard_expires_at_ms,
                    b.lease_id,b.shift_id,b.catalog_version,b.catalog_digest,
                    b.max_operation_count-b.used_operation_count,
                    b.max_gross_minor-b.used_gross_minor,b.max_cash_minor-b.used_cash_minor,
                    s.state,s.shift_id,c.observed_wall_time_ms
             FROM terminal_authority t
             LEFT JOIN authorization_bundles b ON b.terminal_id=t.terminal_id
                  AND b.credential_epoch=t.credential_epoch AND b.state IN ('STAGED','ACTIVE')
             LEFT JOIN shift_authority s ON s.bundle_id=b.bundle_id
             LEFT JOIN authorization_clock_anchor c ON c.singleton_id=1
             WHERE t.is_current=1",
                [],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, Option<i64>>(3)?,
                        row.get::<_, Option<i64>>(4)?,
                        row.get::<_, Option<String>>(5)?,
                        row.get::<_, Option<String>>(6)?,
                        row.get::<_, Option<String>>(7)?,
                        row.get::<_, Option<String>>(8)?,
                        row.get::<_, Option<i64>>(9)?,
                        row.get::<_, Option<i64>>(10)?,
                        row.get::<_, Option<i64>>(11)?,
                        row.get::<_, Option<String>>(12)?,
                        row.get::<_, Option<String>>(13)?,
                        row.get::<_, Option<i64>>(14)?,
                    ))
                },
            )
            .optional()
            .map_err(classify_sql_error)?;
        let Some(row) = row else {
            return Ok(empty_status(OfflineEligibilityState::BootstrapRequired));
        };
        let bundle_present = row.1.is_some();
        let catalog_matches = match (&row.7, &row.8) {
            (Some(version), Some(digest)) => self
                .connection
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM active_catalog a JOIN catalog_snapshots c
                 ON c.snapshot_id=a.snapshot_id WHERE c.version=?1 AND c.digest=?2
                 AND c.verification_state='VERIFIED')",
                    params![version, digest],
                    |row| row.get(0),
                )
                .map_err(classify_sql_error)?,
            _ => false,
        };
        let staff_eligible = if let (Some(staff), Some(bundle)) = (staff_id, row.1.as_ref()) {
            self.connection.query_row(
                "SELECT EXISTS(SELECT 1 FROM offline_staff_verifiers
                 WHERE bundle_id=?1 AND staff_id=?2 AND revoked_at_ms IS NULL AND expires_at_ms>=?3)",
                params![bundle, staff, now_ms], |row| row.get(0),
            ).map_err(classify_sql_error)?
        } else {
            staff_id.is_none()
        };
        let facts = EligibilityFacts {
            storage_healthy: true,
            terminal_present: true,
            terminal_revoked: row.0 == "REVOKED",
            bundle_present,
            bundle_active: row.2.as_deref() == Some("ACTIVE"),
            not_before_ms: row.3.unwrap_or(i64::MAX),
            hard_expires_at_ms: row.4.unwrap_or(i64::MIN),
            observed_wall_time_ms: row.14.unwrap_or(now_ms),
            shift_active: row.12.as_deref() == Some("ACTIVE"),
            shift_matches: row.6.is_some() && row.6 == row.13,
            catalog_matches,
            staff_required: staff_id.is_some(),
            staff_eligible,
            operation_count_remaining: row.9.unwrap_or(0),
            gross_remaining_minor: row.10.unwrap_or(0),
            cash_remaining_minor: row.11.unwrap_or(0),
        };
        Ok(OfflineEligibilityStatus {
            state: evaluate(&facts, now_ms),
            lease_id: row.5,
            shift_id: row.6,
            catalog_version: row.7,
            hard_expires_at_ms: row.4,
            operation_count_remaining: row.9,
            gross_remaining_minor: row.10,
            cash_remaining_minor: row.11,
        })
    }
}

fn empty_status(state: OfflineEligibilityState) -> OfflineEligibilityStatus {
    OfflineEligibilityStatus {
        state,
        lease_id: None,
        shift_id: None,
        catalog_version: None,
        hard_expires_at_ms: None,
        operation_count_remaining: None,
        gross_remaining_minor: None,
        cash_remaining_minor: None,
    }
}

#[cfg(test)]
mod tests {
    use super::{evaluate, EligibilityFacts, OfflineEligibilityState};

    fn eligible() -> EligibilityFacts {
        EligibilityFacts {
            storage_healthy: true,
            terminal_present: true,
            terminal_revoked: false,
            bundle_present: true,
            bundle_active: true,
            not_before_ms: 1_000,
            hard_expires_at_ms: 10_000,
            observed_wall_time_ms: 1_000,
            shift_active: true,
            shift_matches: true,
            catalog_matches: true,
            staff_required: false,
            staff_eligible: true,
            operation_count_remaining: 10,
            gross_remaining_minor: 100,
            cash_remaining_minor: 100,
        }
    }

    #[test]
    fn gate_states_have_fail_closed_precedence() {
        type GateCase = (fn(&mut EligibilityFacts), OfflineEligibilityState);
        let cases: [GateCase; 12] = [
            (
                |f: &mut EligibilityFacts| f.storage_healthy = false,
                OfflineEligibilityState::StorageUnhealthy,
            ),
            (
                |f: &mut EligibilityFacts| f.terminal_present = false,
                OfflineEligibilityState::BootstrapRequired,
            ),
            (
                |f: &mut EligibilityFacts| f.terminal_revoked = true,
                OfflineEligibilityState::DeviceRevoked,
            ),
            (
                |f: &mut EligibilityFacts| f.bundle_present = false,
                OfflineEligibilityState::BootstrapRequired,
            ),
            (
                |f: &mut EligibilityFacts| f.not_before_ms = 3_000,
                OfflineEligibilityState::LeaseNotYetValid,
            ),
            (
                |f: &mut EligibilityFacts| f.hard_expires_at_ms = 1_500,
                OfflineEligibilityState::LeaseExpired,
            ),
            (
                |f: &mut EligibilityFacts| f.observed_wall_time_ms = 500_000,
                OfflineEligibilityState::ClockRollback,
            ),
            (
                |f: &mut EligibilityFacts| f.shift_active = false,
                OfflineEligibilityState::ShiftRequired,
            ),
            (
                |f: &mut EligibilityFacts| f.shift_matches = false,
                OfflineEligibilityState::ShiftMismatch,
            ),
            (
                |f: &mut EligibilityFacts| f.catalog_matches = false,
                OfflineEligibilityState::CatalogRequired,
            ),
            (
                |f: &mut EligibilityFacts| {
                    f.staff_required = true;
                    f.staff_eligible = false;
                },
                OfflineEligibilityState::StaffRequired,
            ),
            (
                |f: &mut EligibilityFacts| f.cash_remaining_minor = 0,
                OfflineEligibilityState::LimitExhausted,
            ),
        ];
        for (mutate, expected) in cases {
            let mut facts = eligible();
            mutate(&mut facts);
            assert_eq!(evaluate(&facts, 2_000), expected);
        }
        assert_eq!(
            evaluate(&eligible(), 2_000),
            OfflineEligibilityState::Eligible
        );
    }

    #[test]
    fn otherwise_valid_staged_bundle_cannot_become_eligible() {
        let mut facts = eligible();
        facts.bundle_active = false;
        assert_eq!(
            evaluate(&facts, 2_000),
            OfflineEligibilityState::BootstrapRequired
        );
    }
}
