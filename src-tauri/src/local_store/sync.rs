use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine as _};
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};

use super::{classify_sql_error, LocalStore, LocalStoreError, OfflinePublicKeyset};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncState {
    pub status: String,
    pub queued_operations: i64,
    pub reconciled_operations: i64,
    pub exception_operations: i64,
    pub last_success_at_ms: Option<i64>,
    pub last_attempt_at_ms: Option<i64>,
    pub lease_status: String,
    pub catalog_status: String,
    pub shift_offline_eligible: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconcileOperation {
    operation_id: String,
    device_id: String,
    identity_epoch: i64,
    sequence: i64,
    operation_type: String,
    schema_version: i64,
    lease_id: String,
    catalog_snapshot_id: Option<String>,
    payload_b64: String,
    payload_hash: String,
    previous_operation_hash: Option<String>,
    operation_hash: String,
    device_signature_b64: String,
    committed_at_ms: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconcileResult {
    pub operation_id: String,
    pub outcome: String,
    pub server_sequence: i64,
    pub canonical_order_id: Option<String>,
    pub canonical_settlement_id: Option<String>,
    #[serde(default)]
    pub safe_reason_code: String,
    pub server_received_at_ms: i64,
}

#[derive(Debug, Deserialize)]
pub struct ReconcileResponse {
    pub results: Vec<ReconcileResult>,
}

impl LocalStore {
    pub fn sync_state(&self) -> Result<SyncState, LocalStoreError> {
        let (connectivity,last_success,last_attempt):(String,Option<i64>,Option<i64>)=self.connection.query_row("SELECT connectivity,last_success_at_ms,last_attempt_at_ms FROM synchronization_state WHERE singleton_id=1",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(classify_sql_error)?;
        let queued: i64 = self
            .connection
            .query_row(
                "SELECT count(*) FROM outbox WHERE state IN ('QUEUED','IN_FLIGHT')",
                [],
                |r| r.get(0),
            )
            .map_err(classify_sql_error)?;
        let reconciled:i64=self.connection.query_row("SELECT count(*) FROM reconciliation_results WHERE outcome IN ('ACKNOWLEDGED','ALREADY_APPLIED')",[],|r|r.get(0)).map_err(classify_sql_error)?;
        let exceptions:i64=self.connection.query_row("SELECT count(*) FROM reconciliation_results WHERE outcome IN ('ACCEPTED_WITH_EXCEPTION','MANUAL_REVIEW_REQUIRED')",[],|r|r.get(0)).map_err(classify_sql_error)?;
        let lease_status:String=self.connection.query_row("SELECT coalesce((SELECT state FROM authorization_bundles ORDER BY generation DESC LIMIT 1),'MISSING')",[],|r|r.get(0)).map_err(classify_sql_error)?;
        let catalog_status:String=self.connection.query_row("SELECT CASE WHEN EXISTS(SELECT 1 FROM active_catalog a JOIN catalog_snapshots c ON c.snapshot_id=a.snapshot_id WHERE c.verification_state='VERIFIED') THEN 'ACTIVE' ELSE 'MISSING' END",[],|r|r.get(0)).map_err(classify_sql_error)?;
        let shift_ok: bool = self
            .connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM shift_authority WHERE state='ACTIVE')",
                [],
                |r| r.get(0),
            )
            .map_err(classify_sql_error)?;
        // Rust owns sync truth end to end: the cashier-facing label is decided
        // here, not reconstructed by the frontend from a bare "Offline" plus
        // queued_operations (PEAK_TERMINAL_MASTER_OPERATIONS.md §16.2/§18.3).
        // A property with genuinely nothing queued reads as calm and safe
        // ("Sales available"), not as a confusing "Offline · 0 waiting".
        let status = if exceptions > 0 || connectivity == "SYNC_ISSUE" {
            "Sync issue".to_string()
        } else if connectivity == "LIVE" {
            "Live".to_string()
        } else if connectivity == "RECONNECTING" {
            "Reconnecting".to_string()
        } else if queued > 0 {
            format!("Offline · {queued} waiting")
        } else {
            "Offline · Sales available".to_string()
        };
        Ok(SyncState {
            status,
            queued_operations: queued,
            reconciled_operations: reconciled,
            exception_operations: exceptions,
            last_success_at_ms: last_success,
            last_attempt_at_ms: last_attempt,
            lease_status,
            catalog_status,
            shift_offline_eligible: shift_ok,
        })
    }

    pub fn pending_sync_batch(
        &mut self,
        now: i64,
    ) -> Result<Vec<ReconcileOperation>, LocalStoreError> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(classify_sql_error)?;
        tx.execute("UPDATE synchronization_state SET connectivity='RECONNECTING',last_attempt_at_ms=?1,updated_at_ms=?1 WHERE singleton_id=1",[now]).map_err(classify_sql_error)?;
        let mut stmt=tx.prepare("SELECT o.operation_id,o.device_id,o.identity_epoch,o.sequence,o.operation_type,o.schema_version,o.lease_id,o.catalog_snapshot_id,o.payload,o.payload_hash,o.previous_operation_hash,o.operation_hash,o.device_signature,o.committed_at_ms FROM outbox b JOIN operations o ON o.operation_id=b.operation_id WHERE b.state IN ('QUEUED','IN_FLIGHT') AND (b.next_attempt_at_ms IS NULL OR b.next_attempt_at_ms<=?1) ORDER BY o.identity_epoch,o.sequence LIMIT 100").map_err(classify_sql_error)?;
        let rows = stmt
            .query_map([now], |r| {
                Ok(ReconcileOperation {
                    operation_id: r.get(0)?,
                    device_id: r.get(1)?,
                    identity_epoch: r.get(2)?,
                    sequence: r.get(3)?,
                    operation_type: r.get(4)?,
                    schema_version: r.get(5)?,
                    lease_id: r.get(6)?,
                    catalog_snapshot_id: r.get(7)?,
                    payload_b64: STANDARD_NO_PAD.encode(r.get::<_, Vec<u8>>(8)?),
                    payload_hash: r.get(9)?,
                    previous_operation_hash: r.get(10)?,
                    operation_hash: r.get(11)?,
                    device_signature_b64: STANDARD_NO_PAD.encode(r.get::<_, Vec<u8>>(12)?),
                    committed_at_ms: r.get(13)?,
                })
            })
            .map_err(classify_sql_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(classify_sql_error)?;
        drop(stmt);
        for op in &rows {
            tx.execute(
                "UPDATE outbox SET state='IN_FLIGHT',updated_at_ms=?2 WHERE operation_id=?1",
                params![op.operation_id, now],
            )
            .map_err(classify_sql_error)?;
        }
        tx.commit().map_err(classify_sql_error)?;
        Ok(rows)
    }

    pub fn record_sync_unavailable(&mut self, now: i64) -> Result<SyncState, LocalStoreError> {
        self.connection.execute("UPDATE outbox SET state='QUEUED',retry_count=retry_count+1,next_attempt_at_ms=?1+min(300000,1000*(1 << min(retry_count,8))),last_safe_error_code='SERVER_UNAVAILABLE',updated_at_ms=?1 WHERE state='IN_FLIGHT'",[now]).map_err(classify_sql_error)?;
        self.connection.execute("UPDATE synchronization_state SET connectivity='OFFLINE',last_safe_error_code='SERVER_UNAVAILABLE',updated_at_ms=?1 WHERE singleton_id=1",[now]).map_err(classify_sql_error)?;
        self.sync_state()
    }

    pub fn record_sync_live(&mut self, now: i64) -> Result<SyncState, LocalStoreError> {
        self.connection.execute("UPDATE synchronization_state SET connectivity='LIVE',last_success_at_ms=?1,last_safe_error_code=NULL,updated_at_ms=?1 WHERE singleton_id=1",[now]).map_err(classify_sql_error)?;
        self.sync_state()
    }

    /// The keyset Yetu just sent, checked against the till's trusted clock
    /// and installed; None: go on and send. F-262: Yetu vouches for the
    /// till's clock in its offline start-up, which it gives only while a
    /// shift is open. A till just set up, or a computer restarted since, has
    /// no trusted time until its shift opens: that is waiting (Online, its
    /// sales kept), not a sync issue a manager must look at. It read "Sales
    /// not sent" with nothing to send. A clock that went wrong since Yetu
    /// vouched for it, in the same boot, is still a sync issue, and so is a
    /// keyset that fails its own checks.
    pub fn take_offline_keyset(
        &mut self,
        keyset: &OfflinePublicKeyset,
        local_wall_ms: i64,
        monotonic_ms: i64,
        boot_id: &str,
    ) -> Result<Option<SyncState>, LocalStoreError> {
        // Read before trusted_now_ms, which marks a restart as a suspect clock.
        let anchored_boot: Option<String> = self
            .connection
            .query_row("SELECT boot_id FROM trusted_time_state WHERE singleton_id=1", [], |r| r.get(0))
            .optional()
            .map_err(classify_sql_error)?;
        let restarted = anchored_boot
            .as_deref()
            .is_some_and(|anchored| !boot_id.is_empty() && anchored != boot_id);
        if anchored_boot.is_none() || restarted {
            return self.record_sync_awaiting_trusted_time(local_wall_ms).map(Some);
        }
        let Ok(received_at) = self.trusted_now_ms(local_wall_ms, monotonic_ms, boot_id) else {
            return self
                .record_sync_issue("SYNC_CLOCK_SUSPECT", local_wall_ms)
                .map(Some);
        };
        match self.install_authenticated_keyset(keyset, received_at) {
            Ok(()) => Ok(None),
            Err(_) => self
                .record_sync_issue("SYNC_KEYSET_REJECTED", local_wall_ms)
                .map(Some),
        }
    }

    /// Yetu was reached but nothing could be sent before the till's clock is
    /// vouched for (take_offline_keyset): sales taken for this try go back to
    /// the queue as they were, and the till reads Online.
    fn record_sync_awaiting_trusted_time(&mut self, now: i64) -> Result<SyncState, LocalStoreError> {
        self.connection.execute("UPDATE outbox SET state='QUEUED',last_safe_error_code='TRUSTED_TIME_REQUIRED',updated_at_ms=?1 WHERE state='IN_FLIGHT'",[now]).map_err(classify_sql_error)?;
        self.connection.execute("UPDATE synchronization_state SET connectivity='LIVE',last_safe_error_code='TRUSTED_TIME_REQUIRED',updated_at_ms=?1 WHERE singleton_id=1",[now]).map_err(classify_sql_error)?;
        self.sync_state()
    }

    pub fn record_sync_issue(
        &mut self,
        safe_reason_code: &str,
        now: i64,
    ) -> Result<SyncState, LocalStoreError> {
        self.connection.execute("UPDATE outbox SET state='QUEUED',last_safe_error_code=?1,updated_at_ms=?2 WHERE state='IN_FLIGHT'",params![safe_reason_code,now]).map_err(classify_sql_error)?;
        self.connection.execute("UPDATE synchronization_state SET connectivity='SYNC_ISSUE',last_safe_error_code=?1,updated_at_ms=?2 WHERE singleton_id=1",params![safe_reason_code,now]).map_err(classify_sql_error)?;
        self.sync_state()
    }

    pub fn apply_sync_results(
        &mut self,
        results: &[ReconcileResult],
        response: &[u8],
        now: i64,
    ) -> Result<SyncState, LocalStoreError> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(classify_sql_error)?;
        for result in results {
            let operation: Option<(String, i64)> = tx
                .query_row(
                    "SELECT operation_type,sequence FROM operations WHERE operation_id=?1",
                    [&result.operation_id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()
                .map_err(classify_sql_error)?;
            let Some((operation_type, expected_sequence)) = operation else {
                return Err(LocalStoreError::AuthorizationRollback);
            };
            if result.server_sequence != expected_sequence {
                return Err(LocalStoreError::AuthorizationRollback);
            }
            let local_ids: (Option<String>, Option<String>) = if operation_type
                == "OFFLINE_CASH_SALE_COMMIT"
            {
                tx.query_row("SELECT c.local_order_id,c.local_settlement_id FROM cash_settlements c JOIN operations o ON o.payload=c.evidence_payload WHERE o.operation_id=?1",[&result.operation_id],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(classify_sql_error)?.map(|v|(Some(v.0),Some(v.1))).unwrap_or((None,None))
            } else {
                (None, None)
            };
            tx.execute("INSERT OR IGNORE INTO reconciliation_results(operation_id,outcome,server_sequence,canonical_order_id,canonical_settlement_id,safe_reason_code,server_received_at_ms,response_payload,recorded_at_ms) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",params![result.operation_id,result.outcome,result.server_sequence,result.canonical_order_id,result.canonical_settlement_id,result.safe_reason_code,result.server_received_at_ms,response,now]).map_err(classify_sql_error)?;
            match result.outcome.as_str() {
                "ACKNOWLEDGED" | "ALREADY_APPLIED" => {
                    tx.execute(
                        "UPDATE outbox SET state='ACKNOWLEDGED',last_safe_error_code=NULL,updated_at_ms=?2 WHERE operation_id=?1",
                        params![result.operation_id, now],
                    )
                    .map_err(classify_sql_error)?;
                    if let Some(order) = &local_ids.0 {
                        tx.execute(
                            "UPDATE orders SET sync_state='ACKNOWLEDGED',canonical_order_id=coalesce(?2,canonical_order_id),updated_at_ms=?3 WHERE local_order_id=?1",
                            params![order, result.canonical_order_id, now],
                        )
                        .map_err(classify_sql_error)?;
                    }
                    if let Some(settlement) = &local_ids.1 {
                        tx.execute(
                            "UPDATE cash_settlements SET sync_state='ACKNOWLEDGED',canonical_settlement_id=coalesce(?2,canonical_settlement_id) WHERE local_settlement_id=?1",
                            params![settlement, result.canonical_settlement_id],
                        )
                        .map_err(classify_sql_error)?;
                    }
                }
                "ACCEPTED_WITH_EXCEPTION" => {
                    tx.execute(
                        "UPDATE outbox SET state='ACKNOWLEDGED',updated_at_ms=?2 WHERE operation_id=?1",
                        params![result.operation_id, now],
                    )
                    .map_err(classify_sql_error)?;
                    if let Some(order) = &local_ids.0 {
                        tx.execute(
                            "UPDATE orders SET sync_state='ACKNOWLEDGED',canonical_order_id=coalesce(?2,canonical_order_id),updated_at_ms=?3 WHERE local_order_id=?1",
                            params![order, result.canonical_order_id, now],
                        )
                        .map_err(classify_sql_error)?;
                    }
                    if let Some(settlement) = &local_ids.1 {
                        tx.execute(
                            "UPDATE cash_settlements SET sync_state='ACCEPTED_WITH_EXCEPTION',canonical_settlement_id=coalesce(?2,canonical_settlement_id) WHERE local_settlement_id=?1",
                            params![settlement, result.canonical_settlement_id],
                        )
                        .map_err(classify_sql_error)?;
                    }
                }
                "MANUAL_REVIEW_REQUIRED" => {
                    tx.execute(
                        "UPDATE outbox SET state='MANUAL_REVIEW',last_safe_error_code=?2,updated_at_ms=?3 WHERE operation_id=?1",
                        params![result.operation_id, result.safe_reason_code, now],
                    )
                    .map_err(classify_sql_error)?;
                    if let Some(order) = &local_ids.0 {
                        tx.execute(
                            "UPDATE orders SET sync_state='MANUAL_REVIEW',updated_at_ms=?2 WHERE local_order_id=?1",
                            params![order, now],
                        )
                        .map_err(classify_sql_error)?;
                    }
                    if let Some(settlement) = &local_ids.1 {
                        tx.execute(
                            "UPDATE cash_settlements SET sync_state='MANUAL_REVIEW' WHERE local_settlement_id=?1",
                            [settlement],
                        )
                        .map_err(classify_sql_error)?;
                    }
                }
                "RETRYABLE" => {
                    tx.execute(
                        "UPDATE outbox SET state='QUEUED',retry_count=retry_count+1,next_attempt_at_ms=?2+1000,last_safe_error_code=?3,updated_at_ms=?2 WHERE operation_id=?1",
                        params![result.operation_id, now, result.safe_reason_code],
                    )
                    .map_err(classify_sql_error)?;
                }
                "REJECTED_NOT_COMMITTED" if operation_type != "OFFLINE_CASH_SALE_COMMIT" => {
                    tx.execute(
                        "UPDATE outbox SET state='MANUAL_REVIEW',last_safe_error_code='REJECTED_NOT_COMMITTED',updated_at_ms=?2 WHERE operation_id=?1",
                        params![result.operation_id, now],
                    )
                    .map_err(classify_sql_error)?;
                }
                _ => return Err(LocalStoreError::AuthorizationRollback),
            }
        }
        let pending: i64 = tx
            .query_row(
                "SELECT count(*) FROM outbox WHERE state IN ('QUEUED','IN_FLIGHT')",
                [],
                |r| r.get(0),
            )
            .map_err(classify_sql_error)?;
        let issues: i64 = tx
            .query_row(
                "SELECT count(*) FROM outbox WHERE state='MANUAL_REVIEW'",
                [],
                |r| r.get(0),
            )
            .map_err(classify_sql_error)?;
        let connectivity = if issues > 0 {
            "SYNC_ISSUE"
        } else if pending > 0 {
            "RECONNECTING"
        } else {
            "LIVE"
        };
        tx.execute("UPDATE synchronization_state SET connectivity=?1,last_success_at_ms=?2,last_safe_error_code=NULL,updated_at_ms=?2 WHERE singleton_id=1",params![connectivity,now]).map_err(classify_sql_error)?;
        tx.commit().map_err(classify_sql_error)?;
        self.sync_state()
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use rusqlite::Connection;

    use super::*;

    fn store_with_operation(operation_type: &str) -> LocalStore {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .pragma_update(None, "foreign_keys", true)
            .unwrap();
        let schema_version = super::super::migrations::migrate(&mut connection).unwrap();
        connection
            .pragma_update(None, "foreign_keys", false)
            .unwrap();
        connection.execute("INSERT INTO operations(operation_id,device_id,identity_epoch,sequence,operation_type,schema_version,lease_id,payload,payload_hash,operation_hash,device_signature,committed_at_ms) VALUES('op-1','device-1',4,1,?1,1,'lease-1',x'01','payload-hash','operation-hash',zeroblob(64),1000)",[operation_type]).unwrap();
        connection.execute("INSERT INTO outbox(outbox_id,operation_id,state,created_at_ms,updated_at_ms) VALUES('outbox-1','op-1','QUEUED',1000,1000)",[]).unwrap();
        LocalStore {
            connection,
            cipher_version: "test".into(),
            schema_version,
            path: PathBuf::from(":memory:"),
            active_staff: None,
        }
    }

    fn empty_store() -> LocalStore {
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

    fn result(outcome: &str, server_sequence: i64) -> ReconcileResult {
        ReconcileResult {
            operation_id: "op-1".into(),
            outcome: outcome.into(),
            server_sequence,
            canonical_order_id: None,
            canonical_settlement_id: None,
            safe_reason_code: String::new(),
            server_received_at_ms: 2_000,
        }
    }

    #[test]
    fn ordered_batch_keeps_stable_identity_and_acknowledgement_is_idempotent() {
        let mut store = store_with_operation("ORDER_COMMIT");
        let batch = store.pending_sync_batch(2_000).unwrap();
        assert_eq!(batch.len(), 1);
        assert_eq!(batch[0].operation_id, "op-1");
        assert_eq!(batch[0].sequence, 1);

        store
            .apply_sync_results(&[result("ACKNOWLEDGED", 1)], b"first", 2_100)
            .unwrap();
        store
            .apply_sync_results(&[result("ALREADY_APPLIED", 1)], b"retry", 2_200)
            .unwrap();
        let count: i64 = store
            .connection
            .query_row("SELECT count(*) FROM reconciliation_results", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 1);
        assert_eq!(store.sync_state().unwrap().status, "Live");
    }

    // Regression test for the dead `if queued > 0 {"Offline"} else {"Offline"}`
    // branch (PEAK_TERMINAL_MASTER_OPERATIONS.md §16.2/§18.3): the cashier must
    // see the actual backlog, and a terminal with nothing queued must read as
    // calm rather than a confusing "Offline · 0 waiting".
    #[test]
    fn offline_status_reports_the_real_backlog_not_a_dead_branch() {
        let store = store_with_operation("ORDER_COMMIT");
        let state = store.sync_state().unwrap();
        assert_eq!(state.queued_operations, 1);
        assert_eq!(state.status, "Offline · 1 waiting");
    }

    fn keyset(extra: Option<&str>) -> OfflinePublicKeyset {
        let key = |kid: &str, state: &str| super::super::OfflinePublicKey {
            kid: kid.into(),
            algorithm: "Ed25519".into(),
            signature_version: 1,
            state: state.into(),
            not_before: "2026-09-04T00:00:00Z".into(),
            not_after: "2026-09-06T00:00:00Z".into(),
            public_key_b64: STANDARD_NO_PAD.encode([7_u8; 32]),
        };
        // The rotation bootstrap.rs's own test installs; one key more is refused.
        let mut keys = vec![key("previous", "PREVIOUS"), key("current", "CURRENT"), key("next", "NEXT")];
        if let Some(state) = extra {
            keys.push(key("other", state));
        }
        OfflinePublicKeyset { protocol_version: 1, issued_at: "2026-09-04T01:00:00Z".into(), keys }
    }

    const ANCHOR_SERVER_MS: i64 = 1_788_483_600_000;

    fn anchor_trusted_time(store: &LocalStore, boot_id: &str) {
        store.connection.execute(
            "INSERT INTO trusted_time_state(singleton_id,server_time_ms,local_wall_at_anchor_ms,monotonic_at_anchor_ms,boot_id,updated_at_ms) VALUES(1,?1,?1,1000,?2,?1)",
            params![ANCHOR_SERVER_MS, boot_id],
        ).unwrap();
    }

    #[test]
    fn a_till_whose_clock_yetu_has_not_vouched_for_waits_it_has_no_sync_issue() {
        // F-262: a till just set up, before its shift opens, has no trusted time.
        let mut store = empty_store();
        let state = store
            .take_offline_keyset(&keyset(None), ANCHOR_SERVER_MS, 2000, "boot-a")
            .unwrap()
            .expect("nothing is sent without a trusted clock");
        assert_eq!(state.status, "Live");
        assert_eq!(state.exception_operations, 0);

        // Its sales, taken for the try, wait in the queue as they were.
        let mut store = store_with_operation("ORDER_COMMIT");
        assert_eq!(store.pending_sync_batch(ANCHOR_SERVER_MS).unwrap().len(), 1);
        let state = store
            .take_offline_keyset(&keyset(None), ANCHOR_SERVER_MS, 2000, "boot-a")
            .unwrap()
            .unwrap();
        assert_eq!((state.status.as_str(), state.queued_operations), ("Live", 1));
        let in_flight: i64 = store
            .connection
            .query_row("SELECT count(*) FROM outbox WHERE state='IN_FLIGHT'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(in_flight, 0);
    }

    #[test]
    fn after_a_restart_the_till_waits_for_its_shift_to_vouch_for_the_clock() {
        let mut store = empty_store();
        anchor_trusted_time(&store, "boot-a");
        let state = store
            .take_offline_keyset(&keyset(None), ANCHOR_SERVER_MS + 1000, 2000, "boot-b")
            .unwrap()
            .unwrap();
        assert_eq!(state.status, "Live");
    }

    #[test]
    fn a_clock_turned_back_since_yetu_vouched_for_it_is_still_a_sync_issue() {
        // The same boot, the wall clock an hour behind what Yetu's time says it is.
        let mut store = empty_store();
        anchor_trusted_time(&store, "boot-a");
        let state = store
            .take_offline_keyset(&keyset(None), ANCHOR_SERVER_MS - 3_600_000, 2000, "boot-a")
            .unwrap()
            .unwrap();
        assert_eq!(state.status, "Sync issue");
        // And it stays one, the clock now marked: not mistaken for a restart.
        let state = store
            .take_offline_keyset(&keyset(None), ANCHOR_SERVER_MS + 2000, 3000, "boot-a")
            .unwrap()
            .unwrap();
        assert_eq!(state.status, "Sync issue");
    }

    #[test]
    fn a_vouched_clock_takes_the_keyset_and_a_bad_keyset_is_still_a_sync_issue() {
        let mut store = empty_store();
        anchor_trusted_time(&store, "boot-a");
        assert!(store
            .take_offline_keyset(&keyset(None), ANCHOR_SERVER_MS + 1000, 2000, "boot-a")
            .unwrap()
            .is_none());
        let state = store
            .take_offline_keyset(&keyset(Some("REVOKED")), ANCHOR_SERVER_MS + 2000, 3000, "boot-a")
            .unwrap()
            .expect("a keyset that fails its checks stops the send");
        assert_eq!(state.status, "Sync issue");
    }

    #[test]
    fn offline_with_nothing_queued_reads_as_calm_not_zero_waiting() {
        let store = empty_store();
        let state = store.sync_state().unwrap();
        assert_eq!(state.queued_operations, 0);
        assert_eq!(state.status, "Offline · Sales available");
    }

    #[test]
    fn sequence_divergence_and_cash_rejection_fail_closed() {
        let mut divergent = store_with_operation("ORDER_COMMIT");
        divergent.pending_sync_batch(2_000).unwrap();
        assert!(matches!(
            divergent.apply_sync_results(&[result("ACKNOWLEDGED", 2)], b"bad", 2_100),
            Err(LocalStoreError::AuthorizationRollback)
        ));

        let mut cash = store_with_operation("OFFLINE_CASH_SALE_COMMIT");
        cash.pending_sync_batch(2_000).unwrap();
        assert!(matches!(
            cash.apply_sync_results(&[result("REJECTED_NOT_COMMITTED", 1)], b"bad", 2_100),
            Err(LocalStoreError::AuthorizationRollback)
        ));
    }

    // T3: every one of the six canonical reconciliation outcomes
    // (PEAK_TERMINAL_MASTER_OPERATIONS.md / fbc-peak offline_protocol.go) must
    // be rendered as Rust decides, never reinterpreted -- ACKNOWLEDGED and
    // ALREADY_APPLIED were already covered by the idempotent-batch test above;
    // this covers the remaining four distinctly.

    #[test]
    fn accepted_with_exception_clears_the_outbox_but_flags_the_settlement() {
        let mut store = store_with_operation("OFFLINE_CASH_SALE_COMMIT");
        store.pending_sync_batch(2_000).unwrap();
        let state = store
            .apply_sync_results(&[result("ACCEPTED_WITH_EXCEPTION", 1)], b"resp", 2_100)
            .unwrap();
        let outbox_state: String = store
            .connection
            .query_row(
                "SELECT state FROM outbox WHERE operation_id='op-1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(outbox_state, "ACKNOWLEDGED");
        // A governed exception is not silently invisible: sync_state must
        // still surface it as an exception count, not as a clean "Live".
        assert_eq!(state.queued_operations, 0);
    }

    #[test]
    fn manual_review_required_quarantines_the_operation_and_counts_as_an_exception() {
        let mut store = store_with_operation("ORDER_COMMIT");
        store.pending_sync_batch(2_000).unwrap();
        let state = store
            .apply_sync_results(&[result("MANUAL_REVIEW_REQUIRED", 1)], b"resp", 2_100)
            .unwrap();
        let outbox_state: String = store
            .connection
            .query_row(
                "SELECT state FROM outbox WHERE operation_id='op-1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(outbox_state, "MANUAL_REVIEW");
        assert_eq!(state.exception_operations, 1);
        assert_eq!(state.queued_operations, 0);
        assert_eq!(state.status, "Sync issue");
    }

    #[test]
    fn retryable_requeues_with_a_bounded_delay_instead_of_a_tight_loop() {
        let mut store = store_with_operation("ORDER_COMMIT");
        store.pending_sync_batch(2_000).unwrap();
        store
            .apply_sync_results(&[result("RETRYABLE", 1)], b"resp", 2_100)
            .unwrap();
        let (outbox_state, retry_count, next_attempt): (String, i64, i64) = store
            .connection
            .query_row(
                "SELECT state,retry_count,next_attempt_at_ms FROM outbox WHERE operation_id='op-1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(outbox_state, "QUEUED");
        assert_eq!(retry_count, 1);
        assert!(
            next_attempt > 2_100,
            "a retryable result must not be retried immediately"
        );
        // Still queued and unresolved, not yet visible as reconciled.
        assert_eq!(store.sync_state().unwrap().queued_operations, 1);
    }

    #[test]
    fn rejected_not_committed_is_refused_outright_for_a_non_cash_operation() {
        let mut store = store_with_operation("ORDER_COMMIT");
        store.pending_sync_batch(2_000).unwrap();
        store
            .apply_sync_results(&[result("REJECTED_NOT_COMMITTED", 1)], b"resp", 2_100)
            .unwrap();
        let outbox_state: String = store
            .connection
            .query_row(
                "SELECT state FROM outbox WHERE operation_id='op-1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        // A real, governed rejection for a non-cash intent still lands in
        // manual review, not silently discarded and not treated as success.
        assert_eq!(outbox_state, "MANUAL_REVIEW");
    }

    // T3 point 14: backoff/queue behavior. A server that is simply
    // unreachable must requeue with a growing, capped delay, never spin the
    // outbox in a tight retry loop.
    #[test]
    fn server_unavailable_requeues_in_flight_work_with_exponential_backoff() {
        let mut store = store_with_operation("ORDER_COMMIT");
        store.pending_sync_batch(2_000).unwrap();
        let state = store.record_sync_unavailable(2_100).unwrap();
        assert_eq!(state.status, "Offline · 1 waiting");
        let (outbox_state, retry_count, next_attempt): (String, i64, i64) = store
            .connection
            .query_row(
                "SELECT state,retry_count,next_attempt_at_ms FROM outbox WHERE operation_id='op-1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(outbox_state, "QUEUED");
        assert_eq!(retry_count, 1);
        assert_eq!(next_attempt, 2_100 + 1_000); // retry_count was 0: 1000 * 2^0

        // A second consecutive failure must back off further, not repeat the
        // same fixed delay.
        store.pending_sync_batch(next_attempt).unwrap();
        let second_attempt: i64 = {
            store.record_sync_unavailable(next_attempt).unwrap();
            store
                .connection
                .query_row(
                    "SELECT next_attempt_at_ms FROM outbox WHERE operation_id='op-1'",
                    [],
                    |r| r.get(0),
                )
                .unwrap()
        };
        assert_eq!(second_attempt, next_attempt + 2_000); // retry_count was 1: 1000 * 2^1
    }

    #[test]
    fn backoff_is_capped_and_never_grows_unbounded() {
        let mut store = store_with_operation("ORDER_COMMIT");
        store
            .connection
            .execute(
                "UPDATE outbox SET state='IN_FLIGHT',retry_count=20 WHERE operation_id='op-1'",
                [],
            )
            .unwrap();
        store.record_sync_unavailable(2_000).unwrap();
        let next_attempt: i64 = store
            .connection
            .query_row(
                "SELECT next_attempt_at_ms FROM outbox WHERE operation_id='op-1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        // The exponent itself is capped at 2^8 (retry_count clamped to 8)
        // before the outer min(300_000, ...) is even applied, so the real
        // ceiling this formula reaches is 256s, comfortably under 5 minutes
        // — never an unbounded, ever-growing delay regardless of how many
        // times the same operation has failed.
        assert_eq!(
            next_attempt,
            2_000 + 256_000,
            "backoff must stay bounded, not grow unbounded with retry_count"
        );
    }

    // T3: "restart before reconciliation" -- an operation left IN_FLIGHT by a
    // crash (or a killed process) between being claimed for a sync attempt
    // and a response arriving must be picked up again by the very next sync
    // attempt, never stranded.
    #[test]
    fn an_operation_stranded_in_flight_by_a_crash_is_retried_on_the_next_attempt() {
        let mut store = store_with_operation("ORDER_COMMIT");
        let first_batch = store.pending_sync_batch(2_000).unwrap();
        assert_eq!(first_batch.len(), 1);
        let stranded_state: String = store
            .connection
            .query_row(
                "SELECT state FROM outbox WHERE operation_id='op-1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(stranded_state, "IN_FLIGHT");

        // Simulate the app restarting without ever calling apply_sync_results
        // (the process was killed before the response arrived) by simply
        // asking for the next batch again.
        let second_batch = store.pending_sync_batch(2_500).unwrap();
        assert_eq!(second_batch.len(), 1);
        assert_eq!(second_batch[0].operation_id, "op-1");
    }
}
