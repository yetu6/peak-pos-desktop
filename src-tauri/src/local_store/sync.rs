use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine as _};
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};

use super::{classify_sql_error, LocalStore, LocalStoreError};

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
}
