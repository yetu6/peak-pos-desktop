use argon2::password_hash::phc::PasswordHash;
use base64::{
    engine::general_purpose::{STANDARD, STANDARD_NO_PAD, URL_SAFE_NO_PAD},
    Engine as _,
};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use zeroize::Zeroizing;

use super::{classify_sql_error, LocalStore, LocalStoreError};

const AUTHORIZATION_DOMAIN: &[u8] = b"peak-pos-offline-authorization-v1\0";
const LIFECYCLE_DOMAIN: &[u8] = b"peak-pos-terminal-lifecycle-v1\0";
const AUTHORIZATION_PROTOCOL_VERSION: u32 = 1;
const AUTHORIZATION_SCHEMA_VERSION: u32 = 1;
const ARGON2_VERSION: u32 = 19;
const ARGON2_MIN_MEMORY_KIB: u32 = 19_456;
const ARGON2_MAX_MEMORY_KIB: u32 = 131_072;
const ARGON2_MIN_TIME: u32 = 2;
const ARGON2_MAX_TIME: u32 = 10;
const ARGON2_MAX_LANES: u32 = 4;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TerminalBinding {
    pub terminal_id: String,
    pub credential_epoch: i64,
    pub property_id: String,
    pub outlet_id: String,
    pub register_id: String,
    pub trust_key_id: String,
    pub trust_public_key_b64: String,
    pub configuration_payload_b64: String,
    pub revocation_generation: i64,
    pub paired_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SignedAuthorizationBundle {
    #[serde(rename = "kid", alias = "keyId")]
    pub key_id: String,
    pub algorithm: String,
    pub signature_version: u32,
    pub payload_b64: String,
    pub signature_b64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SignedTerminalLifecycleEvent {
    pub key_id: String,
    pub payload_b64: String,
    pub signature_b64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TerminalLifecyclePayload {
    pub protocol_version: u32,
    pub event_id: String,
    pub terminal_id: String,
    pub credential_epoch: i64,
    pub generation: i64,
    pub state: String,
    pub reason: String,
    pub effective_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorizationPayload {
    pub protocol_version: u32,
    pub schema_version: u32,
    pub bundle_id: String,
    pub generation: i64,
    pub lease_id: String,
    pub terminal_id: String,
    pub credential_epoch: i64,
    pub property_id: String,
    pub outlet_id: String,
    pub register_id: String,
    pub shift_id: String,
    pub business_date: String,
    pub catalog_version: String,
    pub catalog_digest: String,
    pub issued_at_ms: i64,
    pub not_before_ms: i64,
    pub refresh_after_ms: i64,
    pub hard_expires_at_ms: i64,
    pub server_time_ms: i64,
    pub revocation_generation: i64,
    pub max_operation_count: i64,
    pub max_gross_minor: i64,
    pub max_cash_minor: i64,
    pub allowed_operations: Vec<String>,
    pub tender_methods: Vec<String>,
    pub shift_opened_at_ms: i64,
    pub property_timezone: String,
    pub staff: Vec<StaffVerifierPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StaffVerifierPayload {
    pub staff_id: String,
    pub display_name: String,
    pub verifier_phc: String,
    pub permissions: Vec<String>,
    pub expires_at_ms: i64,
    pub max_attempts: i64,
    pub base_lockout_ms: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AuthorizationStageResult {
    pub state: &'static str,
    pub hard_expires_at: i64,
    pub staff_count: usize,
    pub catalog_version: String,
    pub catalog_digest: String,
    pub prerequisite: Option<&'static str>,
}

impl LocalStore {
    pub fn bind_terminal(&mut self, binding: TerminalBinding) -> Result<(), LocalStoreError> {
        validate_binding(&binding)?;
        let public_key = decode_fixed::<32>(&binding.trust_public_key_b64)?;
        let configuration = decode_b64(&binding.configuration_payload_b64)?;
        let latest_epoch: Option<i64> = self
            .connection
            .query_row(
                "SELECT MAX(credential_epoch) FROM terminal_authority WHERE terminal_id=?1",
                [&binding.terminal_id],
                |row| row.get(0),
            )
            .map_err(classify_sql_error)?;
        if latest_epoch.is_some_and(|epoch| epoch >= binding.credential_epoch) {
            let exact: bool = self
                .connection
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM terminal_authority
                     WHERE terminal_id=?1 AND credential_epoch=?2 AND property_id=?3
                       AND outlet_id=?4 AND register_id=?5 AND trust_key_id=?6
                       AND trust_public_key=?7 AND configuration_payload=?8
                       AND revocation_generation=?9 AND lifecycle_state='PAIRED' AND is_current=1)",
                    params![
                        binding.terminal_id,
                        binding.credential_epoch,
                        binding.property_id,
                        binding.outlet_id,
                        binding.register_id,
                        binding.trust_key_id,
                        public_key.as_slice(),
                        configuration.as_slice(),
                        binding.revocation_generation,
                    ],
                    |row| row.get(0),
                )
                .map_err(classify_sql_error)?;
            return if latest_epoch == Some(binding.credential_epoch) && exact {
                Ok(())
            } else {
                Err(LocalStoreError::AuthorizationRollback)
            };
        }
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(classify_sql_error)?;
        transaction
            .execute(
                "UPDATE terminal_authority SET is_current=0, updated_at_ms=?1 WHERE is_current=1",
                [binding.paired_at_ms],
            )
            .map_err(classify_sql_error)?;
        transaction
            .execute(
                "INSERT INTO terminal_authority
                 (terminal_id,credential_epoch,property_id,outlet_id,register_id,trust_key_id,
                  trust_public_key,configuration_payload,lifecycle_state,is_current,
                  revocation_generation,paired_at_ms,updated_at_ms)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'PAIRED',1,?9,?10,?10)
                 ON CONFLICT(terminal_id,credential_epoch) DO UPDATE SET
                   lifecycle_state='PAIRED', is_current=1,
                   revocation_generation=MAX(revocation_generation,excluded.revocation_generation),
                   updated_at_ms=excluded.updated_at_ms",
                params![
                    binding.terminal_id,
                    binding.credential_epoch,
                    binding.property_id,
                    binding.outlet_id,
                    binding.register_id,
                    binding.trust_key_id,
                    public_key.as_slice(),
                    configuration,
                    binding.revocation_generation,
                    binding.paired_at_ms,
                ],
            )
            .map_err(classify_sql_error)?;
        transaction.commit().map_err(classify_sql_error)?;
        self.active_staff = None;
        Ok(())
    }

    pub fn stage_authorization(
        &mut self,
        envelope: SignedAuthorizationBundle,
        received_at_ms: i64,
    ) -> Result<AuthorizationStageResult, LocalStoreError> {
        if envelope.algorithm != "Ed25519" || envelope.signature_version != 1 {
            return Err(LocalStoreError::InvalidAuthorization);
        }
        let payload_bytes = Zeroizing::new(decode_b64(&envelope.payload_b64)?);
        let signature = Signature::from_slice(&decode_fixed::<64>(&envelope.signature_b64)?)
            .map_err(|_| LocalStoreError::InvalidAuthorization)?;
        let payload: AuthorizationPayload = serde_json::from_slice(&payload_bytes)
            .map_err(|_| LocalStoreError::InvalidAuthorization)?;
        validate_payload(&payload)?;

        let authority = self
            .connection
            .query_row(
                "SELECT terminal_id,credential_epoch,property_id,outlet_id,register_id,
                        trust_key_id,trust_public_key,revocation_generation,lifecycle_state
                 FROM terminal_authority WHERE is_current=1",
                [],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                        row.get::<_, Vec<u8>>(6)?,
                        row.get::<_, i64>(7)?,
                        row.get::<_, String>(8)?,
                    ))
                },
            )
            .optional()
            .map_err(classify_sql_error)?
            .ok_or(LocalStoreError::AuthorizationRequired)?;
        if authority.8 != "PAIRED"
            || payload.terminal_id != authority.0
            || payload.credential_epoch != authority.1
            || payload.property_id != authority.2
            || payload.outlet_id != authority.3
            || payload.register_id != authority.4
            || payload.revocation_generation < authority.7
        {
            return Err(LocalStoreError::InvalidAuthorization);
        }
        let trusted = self.connection.query_row(
            "SELECT public_key,state,not_before_ms,not_after_ms FROM trusted_signing_keys WHERE kid=?1",
            [&envelope.key_id], |row| Ok((row.get::<_,Vec<u8>>(0)?,row.get::<_,String>(1)?,row.get::<_,i64>(2)?,row.get::<_,i64>(3)?)),
        ).optional().map_err(classify_sql_error)?;
        let has_keyset: bool = self
            .connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM trusted_signing_keys)",
                [],
                |row| row.get(0),
            )
            .map_err(classify_sql_error)?;
        let key_bytes = match trusted {
            Some((key, state, not_before, not_after))
                if state != "REVOKED"
                    && payload.issued_at_ms >= not_before
                    && payload.issued_at_ms < not_after
                    && received_at_ms >= not_before
                    && received_at_ms < not_after =>
            {
                key
            }
            Some(_) => return Err(LocalStoreError::InvalidAuthorization),
            None if !has_keyset && envelope.key_id == authority.5 => authority.6,
            None => return Err(LocalStoreError::InvalidAuthorization),
        };
        let public_key: [u8; 32] = key_bytes
            .try_into()
            .map_err(|_| LocalStoreError::InvalidAuthorization)?;
        let verifying_key = VerifyingKey::from_bytes(&public_key)
            .map_err(|_| LocalStoreError::InvalidAuthorization)?;
        let mut signed_message =
            Vec::with_capacity(AUTHORIZATION_DOMAIN.len() + payload_bytes.len());
        signed_message.extend_from_slice(AUTHORIZATION_DOMAIN);
        signed_message.extend_from_slice(&payload_bytes);
        verifying_key
            .verify(&signed_message, &signature)
            .map_err(|_| LocalStoreError::InvalidAuthorization)?;

        if let Some((existing_payload, existing_signature)) = self
            .connection
            .query_row(
                "SELECT signed_payload,signature FROM authorization_bundles WHERE bundle_id=?1",
                [&payload.bundle_id],
                |row| Ok((row.get::<_, Vec<u8>>(0)?, row.get::<_, Vec<u8>>(1)?)),
            )
            .optional()
            .map_err(classify_sql_error)?
        {
            if existing_payload != payload_bytes.as_slice()
                || existing_signature != signature.to_bytes()
            {
                return Err(LocalStoreError::AuthorizationRollback);
            }
            return Ok(stage_result(&payload, self.catalog_matches(&payload)?));
        }

        let last_generation: Option<i64> = self
            .connection
            .query_row(
                "SELECT MAX(generation) FROM authorization_bundles
                 WHERE terminal_id=?1 AND credential_epoch=?2",
                params![payload.terminal_id, payload.credential_epoch],
                |row| row.get(0),
            )
            .map_err(classify_sql_error)?;
        if last_generation.is_some_and(|generation| payload.generation <= generation) {
            return Err(LocalStoreError::AuthorizationRollback);
        }
        let catalog_matches = self.catalog_matches(&payload)?;
        let activation_state = if catalog_matches { "ACTIVE" } else { "STAGED" };

        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(classify_sql_error)?;
        transaction
            .execute(
                "UPDATE authorization_bundles SET state='SUPERSEDED'
                 WHERE terminal_id=?1 AND state IN ('STAGED','ACTIVE')",
                [&payload.terminal_id],
            )
            .map_err(classify_sql_error)?;
        transaction
            .execute(
                "DELETE FROM offline_staff_verifiers
                 WHERE expires_at_ms<?1 OR bundle_id IN
                   (SELECT bundle_id FROM authorization_bundles WHERE state='SUPERSEDED')",
                [received_at_ms],
            )
            .map_err(classify_sql_error)?;
        transaction
            .execute(
                "INSERT INTO authorization_bundles
             (bundle_id,terminal_id,credential_epoch,generation,lease_id,property_id,outlet_id,
              register_id,shift_id,business_date,catalog_version,catalog_digest,issued_at_ms,
              not_before_ms,refresh_after_ms,hard_expires_at_ms,revocation_generation,
              max_operation_count,max_gross_minor,max_cash_minor,allowed_operations_json,
              signing_key_id,signed_payload,signature,state,received_at_ms)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,
                     ?19,?20,?21,?22,?23,?24,?25,?26)",
                params![
                    payload.bundle_id,
                    payload.terminal_id,
                    payload.credential_epoch,
                    payload.generation,
                    payload.lease_id,
                    payload.property_id,
                    payload.outlet_id,
                    payload.register_id,
                    payload.shift_id,
                    payload.business_date,
                    payload.catalog_version,
                    payload.catalog_digest,
                    payload.issued_at_ms,
                    payload.not_before_ms,
                    payload.refresh_after_ms,
                    payload.hard_expires_at_ms,
                    payload.revocation_generation,
                    payload.max_operation_count,
                    payload.max_gross_minor,
                    payload.max_cash_minor,
                    serde_json::to_string(&payload.allowed_operations)
                        .map_err(|_| LocalStoreError::InvalidAuthorization)?,
                    envelope.key_id,
                    payload_bytes.as_slice(),
                    signature.to_bytes().as_slice(),
                    activation_state,
                    received_at_ms,
                ],
            )
            .map_err(classify_sql_error)?;
        for staff in &payload.staff {
            transaction
                .execute(
                    "INSERT INTO offline_staff_verifiers
                 (bundle_id,staff_id,display_name,verifier_phc,permissions_json,expires_at_ms,
                  max_attempts,base_lockout_ms,attempts)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,0)",
                    params![
                        payload.bundle_id,
                        staff.staff_id,
                        staff.display_name,
                        staff.verifier_phc,
                        serde_json::to_string(&staff.permissions)
                            .map_err(|_| LocalStoreError::InvalidAuthorization)?,
                        staff.expires_at_ms,
                        staff.max_attempts,
                        staff.base_lockout_ms,
                    ],
                )
                .map_err(classify_sql_error)?;
        }
        transaction.execute(
            "INSERT INTO shift_authority(bundle_id,shift_id,staff_scope_json,state,opened_at_ms)
             VALUES (?1,?2,?3,'ACTIVE',?4)",
            params![
                payload.bundle_id,
                payload.shift_id,
                serde_json::to_string(&payload.staff.iter().map(|s| &s.staff_id).collect::<Vec<_>>())
                    .map_err(|_| LocalStoreError::InvalidAuthorization)?,
                payload.shift_opened_at_ms,
            ],
        ).map_err(classify_sql_error)?;
        transaction
            .execute(
                "INSERT INTO authorization_clock_anchor
             (singleton_id,server_time_ms,observed_wall_time_ms,bundle_generation,updated_at_ms)
             VALUES (1,?1,?2,?3,?2)
             ON CONFLICT(singleton_id) DO UPDATE SET
               server_time_ms=excluded.server_time_ms,
               observed_wall_time_ms=excluded.observed_wall_time_ms,
               bundle_generation=excluded.bundle_generation,
               updated_at_ms=excluded.updated_at_ms",
                params![payload.server_time_ms, received_at_ms, payload.generation],
            )
            .map_err(classify_sql_error)?;
        if catalog_matches {
            transaction.execute("INSERT INTO offline_leases(lease_id,device_id,identity_epoch,shift_id,business_date,catalog_snapshot_id,issued_at_ms,hard_expires_at_ms,signed_envelope,state) SELECT ?1,?2,?3,?4,?5,a.snapshot_id,?6,?7,?8,'ACTIVE' FROM active_catalog a WHERE a.singleton_id=1",params![payload.lease_id,payload.terminal_id,payload.credential_epoch,payload.shift_id,payload.business_date,payload.issued_at_ms,payload.hard_expires_at_ms,payload_bytes.as_slice()]).map_err(classify_sql_error)?;
            transaction.execute("INSERT OR IGNORE INTO shifts(local_shift_id,canonical_shift_id,lease_id,staff_id,business_date,state,opened_at_ms,updated_at_ms) VALUES (?1,?1,?2,?3,?4,'ACTIVE',?5,?6)",params![payload.shift_id,payload.lease_id,payload.staff[0].staff_id,payload.business_date,payload.shift_opened_at_ms,received_at_ms]).map_err(classify_sql_error)?;
        }
        transaction.commit().map_err(classify_sql_error)?;
        self.active_staff = None;
        Ok(stage_result(&payload, catalog_matches))
    }

    pub fn apply_terminal_lifecycle_event(
        &mut self,
        envelope: SignedTerminalLifecycleEvent,
    ) -> Result<(), LocalStoreError> {
        let payload_bytes = Zeroizing::new(decode_b64(&envelope.payload_b64)?);
        let payload: TerminalLifecyclePayload = serde_json::from_slice(&payload_bytes)
            .map_err(|_| LocalStoreError::InvalidAuthorization)?;
        let signature = Signature::from_slice(&decode_fixed::<64>(&envelope.signature_b64)?)
            .map_err(|_| LocalStoreError::InvalidAuthorization)?;
        if payload.protocol_version != 1
            || payload.event_id.trim().is_empty()
            || payload.terminal_id.trim().is_empty()
            || payload.credential_epoch <= 0
            || payload.generation < 0
            || payload.effective_at_ms <= 0
            || !matches!(payload.state.as_str(), "REVOKED" | "EPOCH_ADVANCED")
        {
            return Err(LocalStoreError::InvalidAuthorization);
        }
        let authority = self
            .connection
            .query_row(
                "SELECT trust_key_id,trust_public_key,revocation_generation
                 FROM terminal_authority
                 WHERE is_current=1 AND terminal_id=?1 AND credential_epoch=?2",
                params![payload.terminal_id, payload.credential_epoch],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Vec<u8>>(1)?,
                        row.get::<_, i64>(2)?,
                    ))
                },
            )
            .optional()
            .map_err(classify_sql_error)?
            .ok_or(LocalStoreError::AuthorizationRequired)?;
        if let Some((existing_payload, existing_signature)) = self
            .connection
            .query_row(
                "SELECT signed_payload,signature FROM terminal_lifecycle_events WHERE event_id=?1",
                [&payload.event_id],
                |row| Ok((row.get::<_, Vec<u8>>(0)?, row.get::<_, Vec<u8>>(1)?)),
            )
            .optional()
            .map_err(classify_sql_error)?
        {
            return if existing_payload == payload_bytes.as_slice()
                && existing_signature == signature.to_bytes()
            {
                Ok(())
            } else {
                Err(LocalStoreError::AuthorizationRollback)
            };
        }
        if envelope.key_id != authority.0 || payload.generation <= authority.2 {
            return Err(LocalStoreError::AuthorizationRollback);
        }
        let public_key: [u8; 32] = authority
            .1
            .try_into()
            .map_err(|_| LocalStoreError::InvalidAuthorization)?;
        let verifying_key = VerifyingKey::from_bytes(&public_key)
            .map_err(|_| LocalStoreError::InvalidAuthorization)?;
        let mut signed_message = Vec::with_capacity(LIFECYCLE_DOMAIN.len() + payload_bytes.len());
        signed_message.extend_from_slice(LIFECYCLE_DOMAIN);
        signed_message.extend_from_slice(&payload_bytes);
        verifying_key
            .verify(&signed_message, &signature)
            .map_err(|_| LocalStoreError::InvalidAuthorization)?;

        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(classify_sql_error)?;
        transaction
            .execute(
                "INSERT INTO terminal_lifecycle_events
                 (event_id,terminal_id,credential_epoch,revocation_generation,event_type,
                  signed_payload,signature,applied_at_ms)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                params![
                    payload.event_id,
                    payload.terminal_id,
                    payload.credential_epoch,
                    payload.generation,
                    payload.state,
                    payload_bytes.as_slice(),
                    signature.to_bytes().as_slice(),
                    payload.effective_at_ms,
                ],
            )
            .map_err(classify_sql_error)?;
        transaction
            .execute(
                "UPDATE terminal_authority SET lifecycle_state='REVOKED',
                 revocation_generation=?1,updated_at_ms=?2
                 WHERE is_current=1 AND terminal_id=?3 AND credential_epoch=?4",
                params![
                    payload.generation,
                    payload.effective_at_ms,
                    payload.terminal_id,
                    payload.credential_epoch,
                ],
            )
            .map_err(classify_sql_error)?;
        transaction
            .execute(
                "UPDATE authorization_bundles SET state='REVOKED'
                 WHERE terminal_id=?1 AND credential_epoch=?2 AND state IN ('STAGED','ACTIVE')",
                params![payload.terminal_id, payload.credential_epoch],
            )
            .map_err(classify_sql_error)?;
        transaction
            .execute(
                "UPDATE offline_staff_verifiers SET revoked_at_ms=?1
                 WHERE bundle_id IN (SELECT bundle_id FROM authorization_bundles
                   WHERE terminal_id=?2 AND credential_epoch=?3)",
                params![
                    payload.effective_at_ms,
                    payload.terminal_id,
                    payload.credential_epoch
                ],
            )
            .map_err(classify_sql_error)?;
        transaction
            .execute(
                "UPDATE shift_authority SET state='REVOKED',closed_at_ms=?1
                 WHERE bundle_id IN (SELECT bundle_id FROM authorization_bundles
                   WHERE terminal_id=?2 AND credential_epoch=?3) AND state='ACTIVE'",
                params![
                    payload.effective_at_ms,
                    payload.terminal_id,
                    payload.credential_epoch
                ],
            )
            .map_err(classify_sql_error)?;
        transaction.commit().map_err(classify_sql_error)?;
        self.active_staff = None;
        Ok(())
    }

    fn catalog_matches(&self, payload: &AuthorizationPayload) -> Result<bool, LocalStoreError> {
        self.connection
            .query_row(
                "SELECT EXISTS(
                   SELECT 1 FROM active_catalog a JOIN catalog_snapshots c ON c.snapshot_id=a.snapshot_id
                   WHERE c.version=?1 AND c.digest=?2 AND c.verification_state='VERIFIED'
                 )",
                params![payload.catalog_version, payload.catalog_digest],
                |row| row.get(0),
            )
            .map_err(classify_sql_error)
    }
}

fn stage_result(payload: &AuthorizationPayload, catalog_matches: bool) -> AuthorizationStageResult {
    AuthorizationStageResult {
        state: if catalog_matches { "ACTIVE" } else { "STAGED" },
        hard_expires_at: payload.hard_expires_at_ms,
        staff_count: payload.staff.len(),
        catalog_version: payload.catalog_version.clone(),
        catalog_digest: payload.catalog_digest.clone(),
        prerequisite: (!catalog_matches).then_some("CATALOG_REQUIRED"),
    }
}

fn validate_binding(binding: &TerminalBinding) -> Result<(), LocalStoreError> {
    if binding.credential_epoch <= 0
        || binding.revocation_generation < 0
        || binding.paired_at_ms <= 0
        || [
            &binding.terminal_id,
            &binding.property_id,
            &binding.outlet_id,
            &binding.register_id,
            &binding.trust_key_id,
        ]
        .iter()
        .any(|value| value.trim().is_empty())
    {
        return Err(LocalStoreError::InvalidAuthorization);
    }
    Ok(())
}

fn validate_payload(payload: &AuthorizationPayload) -> Result<(), LocalStoreError> {
    let allowed_operation_names = [
        "ORDER_DRAFT",
        "ORDER_COMMIT",
        "CASH_SETTLE",
        "PRINT_KOT",
        "PRINT_RECEIPT",
        "REPRINT",
    ];
    let unique_operations: HashSet<_> = payload.allowed_operations.iter().collect();
    let unique_staff: HashSet<_> = payload.staff.iter().map(|staff| &staff.staff_id).collect();
    if payload.protocol_version != AUTHORIZATION_PROTOCOL_VERSION
        || payload.schema_version != AUTHORIZATION_SCHEMA_VERSION
        || payload.generation <= 0
        || payload.credential_epoch <= 0
        || payload.revocation_generation < 0
        || payload.max_operation_count <= 0
        || payload.max_gross_minor <= 0
        || payload.max_cash_minor <= 0
        || payload.not_before_ms < payload.issued_at_ms
        || payload.refresh_after_ms < payload.not_before_ms
        || payload.hard_expires_at_ms <= payload.refresh_after_ms
        || payload.server_time_ms < payload.issued_at_ms
        || payload.staff.is_empty()
        || payload.allowed_operations.is_empty()
        || payload.tender_methods != ["CASH"]
        || payload.property_timezone.trim().is_empty()
        || unique_operations.len() != payload.allowed_operations.len()
        || payload
            .allowed_operations
            .iter()
            .any(|operation| !allowed_operation_names.contains(&operation.as_str()))
        || unique_staff.len() != payload.staff.len()
        || [
            &payload.bundle_id,
            &payload.lease_id,
            &payload.terminal_id,
            &payload.property_id,
            &payload.outlet_id,
            &payload.register_id,
            &payload.shift_id,
            &payload.business_date,
            &payload.catalog_version,
            &payload.catalog_digest,
        ]
        .iter()
        .any(|value| value.trim().is_empty())
    {
        return Err(LocalStoreError::InvalidAuthorization);
    }
    for staff in &payload.staff {
        if staff.staff_id.trim().is_empty()
            || staff.display_name.trim().is_empty()
            || staff.expires_at_ms > payload.hard_expires_at_ms
            || staff.expires_at_ms <= payload.not_before_ms
            || staff.max_attempts <= 0
            || staff.base_lockout_ms <= 0
            || !valid_argon2id(&staff.verifier_phc)
        {
            return Err(LocalStoreError::InvalidAuthorization);
        }
    }
    Ok(())
}

fn valid_argon2id(phc: &str) -> bool {
    let Ok(hash) = PasswordHash::new(phc) else {
        return false;
    };
    let memory = hash.params.get_decimal("m");
    let time = hash.params.get_decimal("t");
    let lanes = hash.params.get_decimal("p");
    hash.algorithm.as_str() == "argon2id"
        && hash.version == Some(ARGON2_VERSION)
        && hash.salt.is_some()
        && hash.hash.is_some()
        && memory.is_some_and(|m| (ARGON2_MIN_MEMORY_KIB..=ARGON2_MAX_MEMORY_KIB).contains(&m))
        && time.is_some_and(|t| (ARGON2_MIN_TIME..=ARGON2_MAX_TIME).contains(&t))
        && lanes.is_some_and(|p| (1..=ARGON2_MAX_LANES).contains(&p))
}

fn decode_b64(value: &str) -> Result<Vec<u8>, LocalStoreError> {
    STANDARD_NO_PAD
        .decode(value)
        .or_else(|_| STANDARD.decode(value))
        .or_else(|_| URL_SAFE_NO_PAD.decode(value))
        .map_err(|_| LocalStoreError::InvalidAuthorization)
}

fn decode_fixed<const N: usize>(value: &str) -> Result<[u8; N], LocalStoreError> {
    decode_b64(value)?
        .try_into()
        .map_err(|_| LocalStoreError::InvalidAuthorization)
}
