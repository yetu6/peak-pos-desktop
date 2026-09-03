use std::collections::{HashMap, HashSet};

use rusqlite::{params, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::{
    classify_sql_error,
    pricing::{price_line, PricedLine},
    LocalStore, LocalStoreError,
};

const OPERATION_DOMAIN: &[u8] = b"peak-pos-operation-v1\0";
const CLOCK_ROLLBACK_TOLERANCE_MS: i64 = 300_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateOrderDraftIntent {
    pub service_type: String,
    pub table_label: Option<String>,
    pub notes: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateOrderContextIntent {
    pub order_id: String,
    pub expected_version: i64,
    pub service_type: String,
    pub table_label: Option<String>,
    pub notes: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AddOrderItemIntent {
    pub order_id: String,
    pub expected_version: i64,
    pub product_id: String,
    pub quantity: i64,
    pub modifier_option_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalOrderModifierView {
    pub id: String,
    pub option_id: String,
    pub name: String,
    pub price_delta_minor: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalOrderLineView {
    pub id: String,
    pub product_id: String,
    pub name: String,
    pub quantity: i64,
    pub unit_price_minor: i64,
    pub modifier_total_minor: i64,
    pub line_total_minor: i64,
    pub pricing: PricedLine,
    pub modifiers: Vec<LocalOrderModifierView>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalOrderView {
    pub id: String,
    pub state: String,
    pub sync_state: String,
    pub version: i64,
    pub staff_id: String,
    pub service_type: String,
    pub table_label: Option<String>,
    pub notes: Option<String>,
    pub currency: String,
    pub subtotal_minor: i64,
    pub tax_minor: i64,
    pub total_minor: i64,
    pub order_number: Option<String>,
    pub lines: Vec<LocalOrderLineView>,
}

#[derive(Debug)]
struct AuthorityContext {
    bundle_id: String,
    lease_id: String,
    terminal_id: String,
    credential_epoch: i64,
    shift_id: String,
    snapshot_id: String,
    currency: String,
    tax_mode: String,
    property_id: String,
    outlet_id: String,
    register_id: String,
    business_date: String,
    catalog_version: String,
    catalog_digest: String,
}

impl LocalStore {
    pub fn get_or_create_order_draft(
        &mut self,
        intent: CreateOrderDraftIntent,
        now_ms: i64,
    ) -> Result<LocalOrderView, LocalStoreError> {
        let (staff_id, lease_id) = self.active_staff(now_ms)?;
        let staff_id = staff_id.to_string();
        let lease_id = lease_id.to_string();
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(classify_sql_error)?;
        let auth = authority_context(&tx, &staff_id, "ORDER_DRAFT", now_ms)?;
        require_session_lease(&auth, &lease_id)?;
        service_type_exists(&tx, &auth.snapshot_id, &intent.service_type)?;
        if let Some(id)=tx.query_row("SELECT local_order_id FROM orders WHERE local_shift_id=?1 AND staff_id=?2 AND state='DRAFT' ORDER BY created_at_ms DESC LIMIT 1",params![auth.shift_id,staff_id],|r|r.get::<_,String>(0)).optional().map_err(classify_sql_error)? { tx.commit().map_err(classify_sql_error)?; return self.get_order_draft(&id); }
        let id = random_id("ord")?;
        tx.execute("INSERT INTO orders(local_order_id,local_shift_id,catalog_snapshot_id,currency,service_type,state,subtotal_minor,tax_minor,total_minor,immutable_committed,created_at_ms,updated_at_ms,staff_id,table_label,notes,version,sync_state) VALUES (?1,?2,?3,?4,?5,'DRAFT',0,0,0,0,?6,?6,?7,?8,?9,1,'LOCAL_DRAFT')",params![id,auth.shift_id,auth.snapshot_id,auth.currency,intent.service_type,now_ms,staff_id,clean_optional(intent.table_label),clean_optional(intent.notes)]).map_err(classify_sql_error)?;
        tx.commit().map_err(classify_sql_error)?;
        self.get_order_draft(&id)
    }

    pub fn update_order_context(
        &mut self,
        intent: UpdateOrderContextIntent,
        now_ms: i64,
    ) -> Result<LocalOrderView, LocalStoreError> {
        let (active_staff, active_lease) = self.active_staff(now_ms)?;
        let active_staff = active_staff.to_string();
        let active_lease = active_lease.to_string();
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(classify_sql_error)?;
        let (staff, snapshot) = draft_identity(&tx, &intent.order_id, intent.expected_version)?;
        if staff != active_staff {
            return Err(LocalStoreError::OperationNotAllowed);
        }
        let auth = authority_context(&tx, &active_staff, "ORDER_DRAFT", now_ms)?;
        require_session_lease(&auth, &active_lease)?;
        validate_service_type(
            &tx,
            &snapshot,
            &intent.service_type,
            intent.table_label.as_deref(),
        )?;
        let changed=tx.execute("UPDATE orders SET service_type=?1,table_label=?2,notes=?3,version=version+1,updated_at_ms=?4 WHERE local_order_id=?5 AND state='DRAFT' AND version=?6",params![intent.service_type,clean_optional(intent.table_label),clean_optional(intent.notes),now_ms,intent.order_id,intent.expected_version]).map_err(classify_sql_error)?;
        if changed != 1 {
            return Err(LocalStoreError::StaleDraft);
        }
        tx.commit().map_err(classify_sql_error)?;
        self.get_order_draft(&intent.order_id)
    }

    pub fn add_order_item(
        &mut self,
        intent: AddOrderItemIntent,
        now_ms: i64,
    ) -> Result<LocalOrderView, LocalStoreError> {
        let (active_staff, active_lease) = self.active_staff(now_ms)?;
        let active_staff = active_staff.to_string();
        let active_lease = active_lease.to_string();
        if intent.quantity <= 0 || intent.modifier_option_ids.len() > 128 {
            return Err(LocalStoreError::InvalidOrder);
        }
        let unique: HashSet<_> = intent.modifier_option_ids.iter().collect();
        if unique.len() != intent.modifier_option_ids.len() {
            return Err(LocalStoreError::InvalidOrder);
        }
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(classify_sql_error)?;
        let (staff, snapshot) = draft_identity(&tx, &intent.order_id, intent.expected_version)?;
        if staff != active_staff {
            return Err(LocalStoreError::OperationNotAllowed);
        }
        let auth = authority_context(&tx, &active_staff, "ORDER_DRAFT", now_ms)?;
        require_session_lease(&auth, &active_lease)?;
        if auth.snapshot_id != snapshot {
            return Err(LocalStoreError::CatalogRequired);
        }
        let (name,price,tax_rate):(String,i64,i64)=tx.query_row("SELECT name,price_minor,tax_rate_bp FROM catalog_products WHERE snapshot_id=?1 AND product_id=?2 AND is_available=1",params![snapshot,intent.product_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(classify_sql_error)?.ok_or(LocalStoreError::InvalidOrder)?;
        let groups = read_group_constraints(&tx, &snapshot, &intent.product_id)?;
        let mut selected_by_group: HashMap<String, Vec<(String, String, i64)>> = HashMap::new();
        for option_id in &intent.modifier_option_ids {
            let row=tx.query_row("SELECT o.group_id,o.name,o.price_delta_minor FROM catalog_modifier_options o JOIN catalog_modifier_groups g ON g.snapshot_id=o.snapshot_id AND g.group_id=o.group_id WHERE o.snapshot_id=?1 AND o.option_id=?2 AND o.is_available=1 AND g.is_active=1 AND g.product_id=?3",params![snapshot,option_id,intent.product_id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,i64>(2)?))).optional().map_err(classify_sql_error)?.ok_or(LocalStoreError::InvalidOrder)?;
            selected_by_group
                .entry(row.0)
                .or_default()
                .push((option_id.clone(), row.1, row.2));
        }
        for (group, min, max) in groups {
            let count = selected_by_group.get(&group).map_or(0, Vec::len) as i64;
            if count < min || count > max {
                return Err(LocalStoreError::InvalidOrder);
            }
        }
        let selected: Vec<_> = selected_by_group.into_values().flatten().collect();
        let deltas: Vec<_> = selected.iter().map(|v| v.2).collect();
        let priced = price_line(price, &deltas, intent.quantity, tax_rate, &auth.tax_mode)?;
        let line_id = random_id("line")?;
        let position: i64 = tx
            .query_row(
                "SELECT COALESCE(MAX(position)+1,0) FROM order_lines WHERE local_order_id=?1",
                [&intent.order_id],
                |r| r.get(0),
            )
            .map_err(classify_sql_error)?;
        let evidence = serde_json::to_vec(&priced).map_err(|_| LocalStoreError::InvalidOrder)?;
        let modifier_total = checked_modifier_total(&deltas)?;
        tx.execute("INSERT INTO order_lines(local_line_id,local_order_id,product_id,product_name_snapshot,quantity,unit_price_minor,modifier_total_minor,line_total_minor,pricing_evidence,position) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",params![line_id,intent.order_id,intent.product_id,name,intent.quantity,priced.unit_total_minor,modifier_total,priced.line_total_minor,evidence,position]).map_err(classify_sql_error)?;
        for (position, (option_id, name, delta)) in selected.iter().enumerate() {
            tx.execute("INSERT INTO order_modifiers(local_modifier_id,local_line_id,modifier_id,modifier_name_snapshot,price_delta_minor,position) VALUES (?1,?2,?3,?4,?5,?6)",params![random_id("mod")?,line_id,option_id,name,delta,position as i64]).map_err(classify_sql_error)?;
        }
        update_totals_and_version(&tx, &intent.order_id, intent.expected_version, now_ms)?;
        tx.commit().map_err(classify_sql_error)?;
        self.get_order_draft(&intent.order_id)
    }

    pub fn set_order_line_quantity(
        &mut self,
        order_id: &str,
        line_id: &str,
        quantity: i64,
        expected_version: i64,
        now_ms: i64,
    ) -> Result<LocalOrderView, LocalStoreError> {
        let (active_staff, active_lease) = self.active_staff(now_ms)?;
        let active_staff = active_staff.to_string();
        let active_lease = active_lease.to_string();
        if quantity <= 0 {
            return Err(LocalStoreError::InvalidOrder);
        }
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(classify_sql_error)?;
        let (staff, snapshot) = draft_identity(&tx, order_id, expected_version)?;
        if staff != active_staff {
            return Err(LocalStoreError::OperationNotAllowed);
        }
        let auth = authority_context(&tx, &active_staff, "ORDER_DRAFT", now_ms)?;
        require_session_lease(&auth, &active_lease)?;
        if auth.snapshot_id != snapshot {
            return Err(LocalStoreError::CatalogRequired);
        }
        let (price,tax):(i64,i64)=tx.query_row("SELECT p.price_minor,p.tax_rate_bp FROM order_lines l JOIN catalog_products p ON p.snapshot_id=?1 AND p.product_id=l.product_id WHERE l.local_order_id=?2 AND l.local_line_id=?3",params![snapshot,order_id,line_id],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(classify_sql_error)?.ok_or(LocalStoreError::InvalidOrder)?;
        let mut stmt=tx.prepare("SELECT price_delta_minor FROM order_modifiers WHERE local_line_id=?1 ORDER BY position").map_err(classify_sql_error)?;
        let deltas = stmt
            .query_map([line_id], |r| r.get::<_, i64>(0))
            .map_err(classify_sql_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(classify_sql_error)?;
        drop(stmt);
        let priced = price_line(price, &deltas, quantity, tax, &auth.tax_mode)?;
        let evidence = serde_json::to_vec(&priced).map_err(|_| LocalStoreError::InvalidOrder)?;
        let modifier_total = checked_modifier_total(&deltas)?;
        tx.execute("UPDATE order_lines SET quantity=?1,unit_price_minor=?2,modifier_total_minor=?3,line_total_minor=?4,pricing_evidence=?5 WHERE local_line_id=?6 AND local_order_id=?7",params![quantity,priced.unit_total_minor,modifier_total,priced.line_total_minor,evidence,line_id,order_id]).map_err(classify_sql_error)?;
        update_totals_and_version(&tx, order_id, expected_version, now_ms)?;
        tx.commit().map_err(classify_sql_error)?;
        self.get_order_draft(order_id)
    }

    pub fn remove_order_line(
        &mut self,
        order_id: &str,
        line_id: &str,
        expected_version: i64,
        now_ms: i64,
    ) -> Result<LocalOrderView, LocalStoreError> {
        let (active_staff, active_lease) = self.active_staff(now_ms)?;
        let active_staff = active_staff.to_string();
        let active_lease = active_lease.to_string();
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(classify_sql_error)?;
        let (staff, _) = draft_identity(&tx, order_id, expected_version)?;
        if staff != active_staff {
            return Err(LocalStoreError::OperationNotAllowed);
        }
        let auth = authority_context(&tx, &active_staff, "ORDER_DRAFT", now_ms)?;
        require_session_lease(&auth, &active_lease)?;
        tx.execute(
            "DELETE FROM order_modifiers WHERE local_line_id=?1",
            [line_id],
        )
        .map_err(classify_sql_error)?;
        if tx
            .execute(
                "DELETE FROM order_lines WHERE local_line_id=?1 AND local_order_id=?2",
                params![line_id, order_id],
            )
            .map_err(classify_sql_error)?
            != 1
        {
            return Err(LocalStoreError::InvalidOrder);
        }
        update_totals_and_version(&tx, order_id, expected_version, now_ms)?;
        tx.commit().map_err(classify_sql_error)?;
        self.get_order_draft(order_id)
    }

    pub fn get_order_draft(&self, order_id: &str) -> Result<LocalOrderView, LocalStoreError> {
        read_order(&self.connection, order_id)
    }

    pub fn discard_empty_order_draft(
        &mut self,
        order_id: &str,
        expected_version: i64,
        now_ms: i64,
    ) -> Result<(), LocalStoreError> {
        let (active_staff, active_lease) = self.active_staff(now_ms)?;
        let active_staff = active_staff.to_string();
        let active_lease = active_lease.to_string();
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(classify_sql_error)?;
        let (staff, _) = draft_identity(&tx, order_id, expected_version)?;
        if staff != active_staff {
            return Err(LocalStoreError::OperationNotAllowed);
        }
        let auth = authority_context(&tx, &active_staff, "ORDER_DRAFT", now_ms)?;
        require_session_lease(&auth, &active_lease)?;
        let lines: i64 = tx
            .query_row(
                "SELECT COUNT(*) FROM order_lines WHERE local_order_id=?1",
                [order_id],
                |r| r.get(0),
            )
            .map_err(classify_sql_error)?;
        if lines != 0 {
            return Err(LocalStoreError::InvalidOrder);
        }
        if tx
            .execute(
                "DELETE FROM orders WHERE local_order_id=?1 AND state='DRAFT' AND version=?2",
                params![order_id, expected_version],
            )
            .map_err(classify_sql_error)?
            != 1
        {
            return Err(LocalStoreError::StaleDraft);
        }
        tx.commit().map_err(classify_sql_error)
    }

    pub fn commit_order<F>(
        &mut self,
        order_id: &str,
        expected_version: i64,
        now_ms: i64,
        signer: F,
    ) -> Result<LocalOrderView, LocalStoreError>
    where
        F: FnOnce(&[u8]) -> Result<Vec<u8>, LocalStoreError>,
    {
        let (staff_id, session_lease) = self.active_staff(now_ms)?;
        let staff_id = staff_id.to_string();
        let session_lease = session_lease.to_string();
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(classify_sql_error)?;
        let current_state: String = tx
            .query_row(
                "SELECT state FROM orders WHERE local_order_id=?1",
                [order_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(classify_sql_error)?
            .ok_or(LocalStoreError::InvalidOrder)?;
        if current_state == "COMMITTED" {
            tx.commit().map_err(classify_sql_error)?;
            return self.get_order_draft(order_id);
        }
        let (order_staff, snapshot) = draft_identity(&tx, order_id, expected_version)?;
        if order_staff != staff_id {
            return Err(LocalStoreError::OperationNotAllowed);
        }
        let auth = authority_context(&tx, &staff_id, "ORDER_COMMIT", now_ms)?;
        require_session_lease(&auth, &session_lease)?;
        if auth.snapshot_id != snapshot {
            return Err(LocalStoreError::CatalogRequired);
        }
        let view = read_order(&tx, order_id)?;
        if view.lines.is_empty() {
            return Err(LocalStoreError::InvalidOrder);
        }
        validate_service_type(
            &tx,
            &snapshot,
            &view.service_type,
            view.table_label.as_deref(),
        )?;
        let limits:(i64,i64,i64,i64)=tx.query_row("SELECT used_operation_count,max_operation_count,used_gross_minor,max_gross_minor FROM authorization_bundles WHERE bundle_id=?1",[&auth.bundle_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).map_err(classify_sql_error)?;
        if limits.0 >= limits.1
            || limits
                .2
                .checked_add(view.total_minor)
                .is_none_or(|v| v > limits.3)
        {
            return Err(LocalStoreError::LimitExceeded);
        }
        let (last_sequence,previous):(i64,Option<String>)=tx.query_row("SELECT last_sequence,last_operation_hash FROM sequence_state WHERE device_id=?1 AND identity_epoch=?2",params![auth.terminal_id,auth.credential_epoch],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(classify_sql_error)?.unwrap_or((0,None));
        let sequence = last_sequence
            .checked_add(1)
            .ok_or(LocalStoreError::LimitExceeded)?;
        let operation_id = random_id("op")?;
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct CommitPayload<'a> {
            operation_type: &'static str,
            operation_id: &'a str,
            device_id: &'a str,
            identity_epoch: i64,
            sequence: i64,
            lease_id: &'a str,
            staff_id: &'a str,
            shift_id: &'a str,
            business_date: &'a str,
            property_id: &'a str,
            outlet_id: &'a str,
            register_id: &'a str,
            catalog_snapshot_id: &'a str,
            catalog_version: &'a str,
            catalog_digest: &'a str,
            committed_at_ms: i64,
            order: &'a LocalOrderView,
        }
        let mut evidence_view = view.clone();
        evidence_view.state = "COMMITTED".to_string();
        evidence_view.sync_state = "SYNC_PENDING".to_string();
        let payload = serde_json::to_vec(&CommitPayload {
            operation_type: "ORDER_COMMIT",
            operation_id: &operation_id,
            device_id: &auth.terminal_id,
            identity_epoch: auth.credential_epoch,
            sequence,
            lease_id: &auth.lease_id,
            staff_id: &staff_id,
            shift_id: &auth.shift_id,
            business_date: &auth.business_date,
            property_id: &auth.property_id,
            outlet_id: &auth.outlet_id,
            register_id: &auth.register_id,
            catalog_snapshot_id: &snapshot,
            catalog_version: &auth.catalog_version,
            catalog_digest: &auth.catalog_digest,
            committed_at_ms: now_ms,
            order: &evidence_view,
        })
        .map_err(|_| LocalStoreError::InvalidOrder)?;
        let payload_hash = hex_digest(&payload);
        let mut hash_input = Vec::new();
        hash_input.extend_from_slice(OPERATION_DOMAIN);
        hash_input.extend_from_slice(auth.terminal_id.as_bytes());
        hash_input.push(0);
        hash_input.extend_from_slice(auth.credential_epoch.to_string().as_bytes());
        hash_input.push(0);
        hash_input.extend_from_slice(sequence.to_string().as_bytes());
        hash_input.push(0);
        if let Some(v) = &previous {
            hash_input.extend_from_slice(v.as_bytes())
        }
        hash_input.push(0);
        hash_input.extend_from_slice(payload_hash.as_bytes());
        let operation_hash = hex_digest(&hash_input);
        let hash_bytes = decode_hex(&operation_hash)?;
        let mut signature_message = Vec::with_capacity(OPERATION_DOMAIN.len() + hash_bytes.len());
        signature_message.extend_from_slice(OPERATION_DOMAIN);
        signature_message.extend_from_slice(&hash_bytes);
        let signature = signer(&signature_message)?;
        if signature.len() != 64 {
            return Err(LocalStoreError::SigningFailure);
        }
        tx.execute("UPDATE orders SET state='COMMITTED',immutable_committed=1,committed_at_ms=?1,updated_at_ms=?1,sync_state='SYNC_PENDING' WHERE local_order_id=?2 AND state='DRAFT' AND version=?3",params![now_ms,order_id,expected_version]).map_err(classify_sql_error)?;
        tx.execute("INSERT INTO operations(operation_id,device_id,identity_epoch,sequence,operation_type,schema_version,lease_id,catalog_snapshot_id,payload,payload_hash,previous_operation_hash,operation_hash,device_signature,committed_at_ms) VALUES (?1,?2,?3,?4,'ORDER_COMMIT',1,?5,?6,?7,?8,?9,?10,?11,?12)",params![operation_id,auth.terminal_id,auth.credential_epoch,sequence,auth.lease_id,snapshot,payload,payload_hash,previous,operation_hash,signature,now_ms]).map_err(classify_sql_error)?;
        tx.execute("INSERT INTO outbox(outbox_id,operation_id,state,created_at_ms,updated_at_ms) VALUES (?1,?2,'QUEUED',?3,?3)",params![random_id("out")?,operation_id,now_ms]).map_err(classify_sql_error)?;
        tx.execute("INSERT INTO sequence_state(device_id,identity_epoch,last_sequence,last_operation_hash,updated_at_ms) VALUES (?1,?2,?3,?4,?5) ON CONFLICT(device_id,identity_epoch) DO UPDATE SET last_sequence=excluded.last_sequence,last_operation_hash=excluded.last_operation_hash,updated_at_ms=excluded.updated_at_ms",params![auth.terminal_id,auth.credential_epoch,sequence,operation_hash,now_ms]).map_err(classify_sql_error)?;
        tx.execute("UPDATE authorization_bundles SET used_operation_count=used_operation_count+1,used_gross_minor=used_gross_minor+?1 WHERE bundle_id=?2",params![view.total_minor,auth.bundle_id]).map_err(classify_sql_error)?;
        tx.commit().map_err(classify_sql_error)?;
        self.get_order_draft(order_id)
    }
}

fn authority_context(
    tx: &Transaction<'_>,
    staff_id: &str,
    operation: &str,
    now: i64,
) -> Result<AuthorityContext, LocalStoreError> {
    let row=tx.query_row("SELECT b.bundle_id,b.lease_id,b.terminal_id,b.credential_epoch,b.shift_id,c.snapshot_id,c.currency,c.tax_mode,b.allowed_operations_json,b.not_before_ms,b.hard_expires_at_ms,t.lifecycle_state,s.state,b.property_id,b.outlet_id,b.register_id,b.business_date,c.version,c.digest,clock.observed_wall_time_ms,c.not_before_ms,c.valid_until_ms FROM authorization_bundles b JOIN terminal_authority t ON t.terminal_id=b.terminal_id AND t.credential_epoch=b.credential_epoch AND t.is_current=1 JOIN shift_authority s ON s.bundle_id=b.bundle_id JOIN active_catalog a ON a.singleton_id=1 JOIN catalog_snapshots c ON c.snapshot_id=a.snapshot_id AND c.version=b.catalog_version AND c.digest=b.catalog_digest JOIN authorization_clock_anchor clock ON clock.singleton_id=1 WHERE b.state='ACTIVE'",[],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,i64>(3)?,r.get::<_,String>(4)?,r.get::<_,String>(5)?,r.get::<_,String>(6)?,r.get::<_,String>(7)?,r.get::<_,String>(8)?,r.get::<_,i64>(9)?,r.get::<_,i64>(10)?,r.get::<_,String>(11)?,r.get::<_,String>(12)?,r.get::<_,String>(13)?,r.get::<_,String>(14)?,r.get::<_,String>(15)?,r.get::<_,String>(16)?,r.get::<_,String>(17)?,r.get::<_,String>(18)?,r.get::<_,i64>(19)?,r.get::<_,Option<i64>>(20)?,r.get::<_,Option<i64>>(21)?))).optional().map_err(classify_sql_error)?.ok_or(LocalStoreError::AuthorizationRequired)?;
    if row.11 != "PAIRED"
        || row.12 != "ACTIVE"
        || now < row.9
        || now > row.10
        || now.saturating_add(CLOCK_ROLLBACK_TOLERANCE_MS) < row.19
        || row.20.is_some_and(|start| now < start)
        || row.21.is_some_and(|end| now > end)
    {
        return Err(LocalStoreError::AuthorizationRequired);
    }
    let allowed: Vec<String> =
        serde_json::from_str(&row.8).map_err(|_| LocalStoreError::InvalidAuthorization)?;
    if !allowed.iter().any(|v| v == operation) {
        return Err(LocalStoreError::OperationNotAllowed);
    }
    let permissions_json:Option<String>=tx.query_row("SELECT permissions_json FROM offline_staff_verifiers WHERE bundle_id=?1 AND staff_id=?2 AND revoked_at_ms IS NULL AND expires_at_ms>=?3",params![row.0,staff_id,now],|r|r.get(0)).optional().map_err(classify_sql_error)?;
    let permissions: Vec<String> = permissions_json
        .as_deref()
        .map(serde_json::from_str)
        .transpose()
        .map_err(|_| LocalStoreError::InvalidAuthorization)?
        .unwrap_or_default();
    if !permissions.iter().any(|value| value == "pos.order.create") {
        return Err(LocalStoreError::OperationNotAllowed);
    }
    Ok(AuthorityContext {
        bundle_id: row.0,
        lease_id: row.1,
        terminal_id: row.2,
        credential_epoch: row.3,
        shift_id: row.4,
        snapshot_id: row.5,
        currency: row.6,
        tax_mode: row.7,
        property_id: row.13,
        outlet_id: row.14,
        register_id: row.15,
        business_date: row.16,
        catalog_version: row.17,
        catalog_digest: row.18,
    })
}
fn require_session_lease(auth: &AuthorityContext, lease_id: &str) -> Result<(), LocalStoreError> {
    if auth.lease_id != lease_id {
        return Err(LocalStoreError::AuthorizationRequired);
    }
    Ok(())
}
fn draft_identity(
    tx: &Transaction<'_>,
    id: &str,
    version: i64,
) -> Result<(String, String), LocalStoreError> {
    tx.query_row("SELECT staff_id,catalog_snapshot_id FROM orders WHERE local_order_id=?1 AND state='DRAFT' AND version=?2",params![id,version],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(classify_sql_error)?.ok_or(LocalStoreError::StaleDraft)
}
fn validate_service_type(
    tx: &Transaction<'_>,
    snapshot: &str,
    service: &str,
    context: Option<&str>,
) -> Result<(), LocalStoreError> {
    let required:bool=tx.query_row("SELECT requires_context FROM catalog_service_types WHERE snapshot_id=?1 AND service_type=?2",params![snapshot,service],|r|r.get::<_,i64>(0).map(|v|v!=0)).optional().map_err(classify_sql_error)?.ok_or(LocalStoreError::InvalidOrder)?;
    if required && context.is_none_or(|v| v.trim().is_empty()) {
        return Err(LocalStoreError::InvalidOrder);
    }
    Ok(())
}
fn service_type_exists(
    tx: &Transaction<'_>,
    snapshot: &str,
    service: &str,
) -> Result<(), LocalStoreError> {
    let exists:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM catalog_service_types WHERE snapshot_id=?1 AND service_type=?2)",params![snapshot,service],|r|r.get(0)).map_err(classify_sql_error)?;
    if !exists {
        return Err(LocalStoreError::InvalidOrder);
    }
    Ok(())
}
fn read_group_constraints(
    tx: &Transaction<'_>,
    snapshot: &str,
    product: &str,
) -> Result<Vec<(String, i64, i64)>, LocalStoreError> {
    let mut stmt=tx.prepare("SELECT group_id,min_select,max_select FROM catalog_modifier_groups WHERE snapshot_id=?1 AND product_id=?2 AND is_active=1").map_err(classify_sql_error)?;
    let rows = stmt
        .query_map(params![snapshot, product], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .map_err(classify_sql_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(classify_sql_error)?;
    Ok(rows)
}
fn update_totals_and_version(
    tx: &Transaction<'_>,
    id: &str,
    version: i64,
    now: i64,
) -> Result<(), LocalStoreError> {
    let (subtotal,tax,total):(i64,i64,i64)=tx.query_row("SELECT COALESCE(SUM(CAST(json_extract(pricing_evidence,'$.lineSubtotalMinor') AS INTEGER)),0),COALESCE(SUM(CAST(json_extract(pricing_evidence,'$.lineTaxMinor') AS INTEGER)),0),COALESCE(SUM(line_total_minor),0) FROM order_lines WHERE local_order_id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(classify_sql_error)?;
    if tx.execute("UPDATE orders SET subtotal_minor=?1,tax_minor=?2,total_minor=?3,version=version+1,updated_at_ms=?4 WHERE local_order_id=?5 AND state='DRAFT' AND version=?6",params![subtotal,tax,total,now,id,version]).map_err(classify_sql_error)?!=1{return Err(LocalStoreError::StaleDraft)}
    Ok(())
}
fn read_order(
    connection: &rusqlite::Connection,
    id: &str,
) -> Result<LocalOrderView, LocalStoreError> {
    let mut view=connection.query_row("SELECT local_order_id,state,sync_state,version,staff_id,service_type,table_label,notes,currency,subtotal_minor,tax_minor,total_minor,order_number FROM orders WHERE local_order_id=?1",[id],|r|Ok(LocalOrderView{id:r.get(0)?,state:r.get(1)?,sync_state:r.get(2)?,version:r.get(3)?,staff_id:r.get(4)?,service_type:r.get(5)?,table_label:r.get(6)?,notes:r.get(7)?,currency:r.get(8)?,subtotal_minor:r.get(9)?,tax_minor:r.get(10)?,total_minor:r.get(11)?,order_number:r.get(12)?,lines:Vec::new()})).optional().map_err(classify_sql_error)?.ok_or(LocalStoreError::InvalidOrder)?;
    let mut stmt=connection.prepare("SELECT local_line_id,product_id,product_name_snapshot,quantity,unit_price_minor,modifier_total_minor,line_total_minor,pricing_evidence FROM order_lines WHERE local_order_id=?1 ORDER BY position").map_err(classify_sql_error)?;
    let rows = stmt
        .query_map([id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, i64>(5)?,
                r.get::<_, i64>(6)?,
                r.get::<_, Vec<u8>>(7)?,
            ))
        })
        .map_err(classify_sql_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(classify_sql_error)?;
    drop(stmt);
    for row in rows {
        let mut mods=connection.prepare("SELECT local_modifier_id,modifier_id,modifier_name_snapshot,price_delta_minor FROM order_modifiers WHERE local_line_id=?1 ORDER BY position").map_err(classify_sql_error)?;
        let modifiers = mods
            .query_map([&row.0], |r| {
                Ok(LocalOrderModifierView {
                    id: r.get(0)?,
                    option_id: r.get(1)?,
                    name: r.get(2)?,
                    price_delta_minor: r.get(3)?,
                })
            })
            .map_err(classify_sql_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(classify_sql_error)?;
        view.lines.push(LocalOrderLineView {
            id: row.0,
            product_id: row.1,
            name: row.2,
            quantity: row.3,
            unit_price_minor: row.4,
            modifier_total_minor: row.5,
            line_total_minor: row.6,
            pricing: serde_json::from_slice(&row.7).map_err(|_| LocalStoreError::Corruption)?,
            modifiers,
        });
    }
    Ok(view)
}
fn clean_optional(value: Option<String>) -> Option<String> {
    value.and_then(|v| {
        let v = v.trim().to_string();
        (!v.is_empty()).then_some(v)
    })
}
fn checked_modifier_total(values: &[i64]) -> Result<i64, LocalStoreError> {
    let total = values
        .iter()
        .try_fold(0_i128, |sum, value| sum.checked_add(i128::from(*value)))
        .ok_or(LocalStoreError::InvalidOrder)?;
    i64::try_from(total).map_err(|_| LocalStoreError::InvalidOrder)
}
fn random_id(prefix: &str) -> Result<String, LocalStoreError> {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| LocalStoreError::SecureStoreUnavailable)?;
    Ok(format!(
        "{prefix}_{}",
        bytes.iter().map(|b| format!("{b:02x}")).collect::<String>()
    ))
}
fn hex_digest(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
fn decode_hex(value: &str) -> Result<Vec<u8>, LocalStoreError> {
    if !value.len().is_multiple_of(2) {
        return Err(LocalStoreError::InvalidOrder);
    }
    (0..value.len())
        .step_by(2)
        .map(|i| {
            u8::from_str_radix(&value[i..i + 2], 16).map_err(|_| LocalStoreError::InvalidOrder)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::local_store::{DbKeyStore, DbKeyStoreError, LocalStoreErrorKind};
    use std::sync::Mutex;

    #[derive(Default)]
    struct MemoryKeys(Mutex<Option<String>>);
    impl DbKeyStore for MemoryKeys {
        fn load(&self) -> Result<Option<String>, DbKeyStoreError> {
            Ok(self.0.lock().unwrap().clone())
        }
        fn save(&self, v: &str) -> Result<(), DbKeyStoreError> {
            *self.0.lock().unwrap() = Some(v.into());
            Ok(())
        }
    }
    fn seeded() -> (tempfile::TempDir, LocalStore) {
        let temp = tempfile::tempdir().unwrap();
        let mut store =
            LocalStore::open(&temp.path().join("orders.db"), &MemoryKeys::default()).unwrap();
        store.connection.execute_batch("INSERT INTO terminal_authority VALUES ('term',1,'prop','out','reg','key',zeroblob(32),x'01','PAIRED',1,0,1,1);
        INSERT INTO authorization_bundles(bundle_id,terminal_id,credential_epoch,generation,lease_id,property_id,outlet_id,register_id,shift_id,business_date,catalog_version,catalog_digest,issued_at_ms,not_before_ms,refresh_after_ms,hard_expires_at_ms,revocation_generation,max_operation_count,max_gross_minor,max_cash_minor,allowed_operations_json,signing_key_id,signed_payload,signature,state,received_at_ms) VALUES ('bundle','term',1,1,'lease','prop','out','reg','shift','2026-09-03','v1','digest',1,1,9000,10000,0,10,1000000,1000000,'[\"ORDER_DRAFT\",\"ORDER_COMMIT\"]','key',x'01',zeroblob(64),'ACTIVE',1);
        INSERT INTO offline_staff_verifiers(bundle_id,staff_id,display_name,verifier_phc,permissions_json,expires_at_ms,max_attempts,base_lockout_ms) VALUES ('bundle','staff','Cashier','x','[\"pos.order.create\"]',10000,5,1000);
        INSERT INTO shift_authority VALUES ('bundle','shift','[\"staff\"]','ACTIVE',1,NULL);
        INSERT INTO authorization_clock_anchor VALUES (1,1,1,1,1);
        INSERT INTO catalog_snapshots(snapshot_id,version,digest,currency,published_at_ms,valid_until_ms,signed_manifest,payload,verification_state,property_id,outlet_id,not_before_ms,tax_mode) VALUES ('snap','v1','digest','TZS',1,500,x'01',x'01','VERIFIED','prop','out',1,'EXCLUSIVE');
        INSERT INTO active_catalog VALUES (1,'snap',1);
        INSERT INTO catalog_service_types VALUES ('snap','DINE_IN','Dine in',0,0);
        INSERT INTO catalog_categories VALUES ('snap','food','FOOD','Food',0,1);
        INSERT INTO catalog_products VALUES ('snap','tea','food','TEA','Tea','tea tea',10000,1800,1,0);
        INSERT INTO catalog_modifier_groups VALUES ('snap','milk','tea','Milk',1,1,0,1);
        INSERT INTO catalog_modifier_options VALUES ('snap','oat','milk','Oat milk',2000,0,1);
        INSERT INTO offline_leases VALUES ('lease','term',1,'shift','2026-09-03','snap',1,10000,x'01','ACTIVE');
        INSERT INTO shifts VALUES ('shift','shift','lease','staff','2026-09-03','ACTIVE',1,1);").unwrap();
        store.active_staff = Some(crate::local_store::ActiveStaffSession {
            staff_id: "staff".into(),
            lease_id: "lease".into(),
            expires_at_ms: 10_000,
        });
        (temp, store)
    }

    #[test]
    fn draft_is_priced_by_rust_and_commit_is_one_atomic_outbox_operation() {
        let (_temp, mut store) = seeded();
        let draft = store
            .get_or_create_order_draft(
                CreateOrderDraftIntent {
                    service_type: "DINE_IN".into(),
                    table_label: None,
                    notes: None,
                },
                100,
            )
            .unwrap();
        let priced = store
            .add_order_item(
                AddOrderItemIntent {
                    order_id: draft.id.clone(),
                    expected_version: draft.version,
                    product_id: "tea".into(),
                    quantity: 2,
                    modifier_option_ids: vec!["oat".into()],
                },
                200,
            )
            .unwrap();
        assert_eq!(
            (priced.subtotal_minor, priced.tax_minor, priced.total_minor),
            (24000, 4320, 28320)
        );
        let committed = store
            .commit_order(&priced.id, priced.version, 300, |_| Ok(vec![7; 64]))
            .unwrap();
        assert_eq!(committed.state, "COMMITTED");
        assert_eq!(committed.sync_state, "SYNC_PENDING");
        let counts:(i64,i64,i64)=store.connection.query_row("SELECT (SELECT COUNT(*) FROM operations),(SELECT COUNT(*) FROM outbox),(SELECT last_sequence FROM sequence_state)",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
        assert_eq!(counts, (1, 1, 1));
        let payload: Vec<u8> = store
            .connection
            .query_row("SELECT payload FROM operations", [], |r| r.get(0))
            .unwrap();
        let evidence: serde_json::Value = serde_json::from_slice(&payload).unwrap();
        assert_eq!(evidence["propertyId"], "prop");
        assert_eq!(evidence["businessDate"], "2026-09-03");
        assert_eq!(evidence["catalogDigest"], "digest");
        assert_eq!(
            evidence["order"]["lines"][0]["pricing"]["lineTaxMinor"],
            4320
        );
        let replay = store
            .commit_order(&priced.id, priced.version, 301, |_| {
                panic!("idempotent retry must not sign")
            })
            .unwrap();
        assert_eq!(replay.state, "COMMITTED");
    }
    #[test]
    fn signer_failure_rolls_back_order_sequence_and_outbox() {
        let (_temp, mut store) = seeded();
        let draft = store
            .get_or_create_order_draft(
                CreateOrderDraftIntent {
                    service_type: "DINE_IN".into(),
                    table_label: None,
                    notes: None,
                },
                100,
            )
            .unwrap();
        let priced = store
            .add_order_item(
                AddOrderItemIntent {
                    order_id: draft.id.clone(),
                    expected_version: draft.version,
                    product_id: "tea".into(),
                    quantity: 1,
                    modifier_option_ids: vec!["oat".into()],
                },
                200,
            )
            .unwrap();
        let error = store
            .commit_order(&priced.id, priced.version, 300, |_| {
                Err(LocalStoreError::SigningFailure)
            })
            .unwrap_err();
        assert_eq!(error.kind(), LocalStoreErrorKind::SigningFailure);
        let state: String = store
            .connection
            .query_row(
                "SELECT state FROM orders WHERE local_order_id=?1",
                [priced.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(state, "DRAFT");
        let count: i64 = store
            .connection
            .query_row("SELECT COUNT(*) FROM operations", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn order_intents_cannot_select_a_staff_without_a_native_authenticated_session() {
        let (_temp, mut store) = seeded();
        store.clear_active_staff();
        let error = store
            .get_or_create_order_draft(
                CreateOrderDraftIntent {
                    service_type: "DINE_IN".into(),
                    table_label: None,
                    notes: None,
                },
                100,
            )
            .unwrap_err();
        assert_eq!(error.kind(), LocalStoreErrorKind::AuthorizationRequired);
    }

    #[test]
    fn order_intents_fail_after_catalog_expiry_or_clock_rollback() {
        let (_temp, mut expired_store) = seeded();
        let expired = expired_store
            .get_or_create_order_draft(
                CreateOrderDraftIntent {
                    service_type: "DINE_IN".into(),
                    table_label: None,
                    notes: None,
                },
                501,
            )
            .unwrap_err();
        assert_eq!(expired.kind(), LocalStoreErrorKind::AuthorizationRequired);

        let (_temp, mut rollback_store) = seeded();
        rollback_store
            .connection
            .execute(
                "UPDATE authorization_clock_anchor SET observed_wall_time_ms=400000",
                [],
            )
            .unwrap();
        let rollback = rollback_store
            .get_or_create_order_draft(
                CreateOrderDraftIntent {
                    service_type: "DINE_IN".into(),
                    table_label: None,
                    notes: None,
                },
                100,
            )
            .unwrap_err();
        assert_eq!(rollback.kind(), LocalStoreErrorKind::AuthorizationRequired);
    }

    #[test]
    fn modifier_totals_reject_integer_overflow() {
        let error = checked_modifier_total(&[i64::MAX, 1]).unwrap_err();
        assert_eq!(error.kind(), LocalStoreErrorKind::InvalidOrder);
    }
}
