use std::collections::HashSet;

use base64::{
    engine::general_purpose::{STANDARD, STANDARD_NO_PAD, URL_SAFE_NO_PAD},
    Engine as _,
};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use super::{classify_sql_error, LocalStore, LocalStoreError};

const CATALOG_DOMAIN: &[u8] = b"peak-pos-catalog-snapshot-v1\0";
const PROTOCOL_VERSION: u32 = 1;
const SCHEMA_VERSION: u32 = 1;
const MAX_SERVICE_TYPES: usize = 16;
const MAX_CATEGORIES: usize = 256;
const MAX_PRODUCTS: usize = 10_000;
const MAX_GROUPS: usize = 20_000;
const MAX_OPTIONS: usize = 100_000;
const MAX_TEXT: usize = 256;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SignedCatalogSnapshot {
    #[serde(rename = "kid", alias = "keyId")]
    pub key_id: String,
    pub algorithm: String,
    pub signature_version: u32,
    pub digest: String,
    pub payload_b64: String,
    pub signature_b64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogSnapshotPayload {
    pub protocol_version: u32,
    pub schema_version: u32,
    pub snapshot_id: String,
    pub version: String,
    pub property_id: String,
    pub outlet_id: String,
    pub currency: String,
    pub published_at_ms: i64,
    pub not_before_ms: i64,
    pub valid_until_ms: i64,
    pub tax_mode: String,
    pub service_types: Vec<CatalogServiceTypePayload>,
    pub categories: Vec<CatalogCategoryPayload>,
    pub products: Vec<CatalogProductPayload>,
    pub modifier_groups: Vec<CatalogModifierGroupPayload>,
    pub modifier_options: Vec<CatalogModifierOptionPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogServiceTypePayload {
    pub service_type: String,
    pub label: String,
    pub requires_context: bool,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogCategoryPayload {
    pub category_id: String,
    pub code: String,
    pub name: String,
    pub sort_order: i64,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogProductPayload {
    pub product_id: String,
    pub category_id: Option<String>,
    pub code: String,
    pub name: String,
    pub price_minor: i64,
    pub tax_rate_bp: i64,
    pub is_available: bool,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogModifierGroupPayload {
    pub group_id: String,
    pub product_id: String,
    pub name: String,
    pub min_select: i64,
    pub max_select: i64,
    pub sort_order: i64,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogModifierOptionPayload {
    pub option_id: String,
    pub group_id: String,
    pub name: String,
    pub price_delta_minor: i64,
    pub sort_order: i64,
    pub is_available: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CatalogActivationResult {
    pub state: &'static str,
    pub snapshot_id: String,
    pub version: String,
    pub digest: String,
    pub product_count: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalCatalogView {
    pub snapshot_id: String,
    pub version: String,
    pub currency: String,
    pub tax_mode: String,
    pub service_types: Vec<CatalogServiceTypeView>,
    pub categories: Vec<CatalogCategoryView>,
    pub products: Vec<CatalogProductView>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CatalogServiceTypeView {
    pub id: String,
    pub label: String,
    pub requires_context: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CatalogCategoryView {
    pub id: String,
    pub code: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CatalogProductView {
    pub id: String,
    pub category_id: Option<String>,
    pub code: String,
    pub name: String,
    pub price_minor: i64,
    pub tax_rate_bp: i64,
    pub currency: String,
    pub modifier_groups: Vec<CatalogModifierGroupView>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CatalogModifierGroupView {
    pub id: String,
    pub name: String,
    pub min_select: i64,
    pub max_select: i64,
    pub options: Vec<CatalogModifierOptionView>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CatalogModifierOptionView {
    pub id: String,
    pub name: String,
    pub price_delta_minor: i64,
}

impl LocalStore {
    pub fn install_catalog_snapshot(
        &mut self,
        envelope: SignedCatalogSnapshot,
        received_at_ms: i64,
    ) -> Result<CatalogActivationResult, LocalStoreError> {
        if envelope.algorithm != "Ed25519" || envelope.signature_version != 1 {
            return Err(LocalStoreError::InvalidCatalog);
        }
        let payload_bytes = Zeroizing::new(decode_b64(&envelope.payload_b64)?);
        let actual_digest = hex_digest(&payload_bytes);
        if envelope.digest.len() != 64 || envelope.digest != actual_digest {
            return Err(LocalStoreError::InvalidCatalog);
        }
        let payload: CatalogSnapshotPayload =
            serde_json::from_slice(&payload_bytes).map_err(|_| LocalStoreError::InvalidCatalog)?;
        validate_payload(&payload, received_at_ms)?;
        let signature = Signature::from_slice(&decode_fixed::<64>(&envelope.signature_b64)?)
            .map_err(|_| LocalStoreError::InvalidCatalog)?;
        let authority = self.connection.query_row(
            "SELECT t.trust_key_id,t.trust_public_key,t.property_id,t.outlet_id,t.lifecycle_state,
                    b.bundle_id,b.lease_id,b.shift_id,b.business_date,b.catalog_version,b.catalog_digest,
                    b.terminal_id,b.credential_epoch,b.hard_expires_at_ms
             FROM terminal_authority t JOIN authorization_bundles b
               ON b.terminal_id=t.terminal_id AND b.credential_epoch=t.credential_epoch
             WHERE t.is_current=1 AND b.state IN ('STAGED','ACTIVE')",
            [], |row| Ok((row.get::<_,String>(0)?,row.get::<_,Vec<u8>>(1)?,row.get::<_,String>(2)?,row.get::<_,String>(3)?,row.get::<_,String>(4)?,row.get::<_,String>(5)?,row.get::<_,String>(6)?,row.get::<_,String>(7)?,row.get::<_,String>(8)?,row.get::<_,String>(9)?,row.get::<_,String>(10)?,row.get::<_,String>(11)?,row.get::<_,i64>(12)?,row.get::<_,i64>(13)?))
        ).optional().map_err(classify_sql_error)?.ok_or(LocalStoreError::AuthorizationRequired)?;
        if authority.4 != "PAIRED"
            || payload.property_id != authority.2
            || payload.outlet_id != authority.3
            || payload.version != authority.9
            || envelope.digest != authority.10
            || received_at_ms > authority.13
        {
            return Err(LocalStoreError::InvalidCatalog);
        }
        let trusted=self.connection.query_row("SELECT public_key,state,not_before_ms,not_after_ms FROM trusted_signing_keys WHERE kid=?1",[&envelope.key_id],|r|Ok((r.get::<_,Vec<u8>>(0)?,r.get::<_,String>(1)?,r.get::<_,i64>(2)?,r.get::<_,i64>(3)?))).optional().map_err(classify_sql_error)?;
        let has_keyset: bool = self
            .connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM trusted_signing_keys)",
                [],
                |r| r.get(0),
            )
            .map_err(classify_sql_error)?;
        let key_bytes = match trusted {
            Some((key, state, not_before, not_after))
                if state != "REVOKED"
                    && payload.published_at_ms >= not_before
                    && payload.published_at_ms < not_after
                    && received_at_ms >= not_before
                    && received_at_ms < not_after =>
            {
                key
            }
            Some(_) => return Err(LocalStoreError::InvalidCatalog),
            None if !has_keyset && envelope.key_id == authority.0 => authority.1,
            None => return Err(LocalStoreError::InvalidCatalog),
        };
        let public_key: [u8; 32] = key_bytes
            .try_into()
            .map_err(|_| LocalStoreError::InvalidCatalog)?;
        let verifying_key =
            VerifyingKey::from_bytes(&public_key).map_err(|_| LocalStoreError::InvalidCatalog)?;
        let mut message = Vec::with_capacity(CATALOG_DOMAIN.len() + 64 + 1 + payload_bytes.len());
        message.extend_from_slice(CATALOG_DOMAIN);
        message.extend_from_slice(envelope.digest.as_bytes());
        message.push(0);
        message.extend_from_slice(&payload_bytes);
        verifying_key
            .verify(&message, &signature)
            .map_err(|_| LocalStoreError::InvalidCatalog)?;

        let snapshot_exists = if let Some((digest, bytes)) = self
            .connection
            .query_row(
                "SELECT digest,payload FROM catalog_snapshots WHERE snapshot_id=?1",
                [&payload.snapshot_id],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, Vec<u8>>(1)?)),
            )
            .optional()
            .map_err(classify_sql_error)?
        {
            if digest != envelope.digest || bytes != payload_bytes.as_slice() {
                return Err(LocalStoreError::AuthorizationRollback);
            }
            true
        } else {
            false
        };

        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(classify_sql_error)?;
        if !snapshot_exists {
            tx.execute("INSERT INTO catalog_snapshots(snapshot_id,version,digest,currency,published_at_ms,valid_until_ms,signed_manifest,payload,verification_state,property_id,outlet_id,not_before_ms,tax_mode) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'VERIFIED',?9,?10,?11,?12)", params![payload.snapshot_id,payload.version,envelope.digest,payload.currency,payload.published_at_ms,payload.valid_until_ms,signature.to_bytes().as_slice(),payload_bytes.as_slice(),payload.property_id,payload.outlet_id,payload.not_before_ms,payload.tax_mode]).map_err(classify_sql_error)?;
            for value in &payload.service_types {
                tx.execute(
                    "INSERT INTO catalog_service_types VALUES (?1,?2,?3,?4,?5)",
                    params![
                        payload.snapshot_id,
                        value.service_type,
                        value.label,
                        i64::from(value.requires_context),
                        value.sort_order
                    ],
                )
                .map_err(classify_sql_error)?;
            }
            for value in &payload.categories {
                tx.execute(
                    "INSERT INTO catalog_categories VALUES (?1,?2,?3,?4,?5,?6)",
                    params![
                        payload.snapshot_id,
                        value.category_id,
                        value.code,
                        value.name,
                        value.sort_order,
                        i64::from(value.is_active)
                    ],
                )
                .map_err(classify_sql_error)?;
            }
            for value in &payload.products {
                tx.execute(
                    "INSERT INTO catalog_products VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
                    params![
                        payload.snapshot_id,
                        value.product_id,
                        value.category_id,
                        value.code,
                        value.name,
                        normalize_search(&format!("{} {}", value.code, value.name)),
                        value.price_minor,
                        value.tax_rate_bp,
                        i64::from(value.is_available),
                        value.sort_order
                    ],
                )
                .map_err(classify_sql_error)?;
            }
            for value in &payload.modifier_groups {
                tx.execute(
                    "INSERT INTO catalog_modifier_groups VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                    params![
                        payload.snapshot_id,
                        value.group_id,
                        value.product_id,
                        value.name,
                        value.min_select,
                        value.max_select,
                        value.sort_order,
                        i64::from(value.is_active)
                    ],
                )
                .map_err(classify_sql_error)?;
            }
            for value in &payload.modifier_options {
                tx.execute(
                    "INSERT INTO catalog_modifier_options VALUES (?1,?2,?3,?4,?5,?6,?7)",
                    params![
                        payload.snapshot_id,
                        value.option_id,
                        value.group_id,
                        value.name,
                        value.price_delta_minor,
                        value.sort_order,
                        i64::from(value.is_available)
                    ],
                )
                .map_err(classify_sql_error)?;
            }
        }
        tx.execute("INSERT INTO active_catalog(singleton_id,snapshot_id,activated_at_ms) VALUES (1,?1,?2) ON CONFLICT(singleton_id) DO UPDATE SET snapshot_id=excluded.snapshot_id,activated_at_ms=excluded.activated_at_ms",params![payload.snapshot_id,received_at_ms]).map_err(classify_sql_error)?;
        tx.execute(
            "UPDATE authorization_bundles SET state='ACTIVE' WHERE bundle_id=?1 AND state='STAGED'",
            [&authority.5],
        )
        .map_err(classify_sql_error)?;
        tx.execute("INSERT OR IGNORE INTO offline_leases(lease_id,device_id,identity_epoch,shift_id,business_date,catalog_snapshot_id,issued_at_ms,hard_expires_at_ms,signed_envelope,state) SELECT lease_id,terminal_id,credential_epoch,shift_id,business_date,?1,issued_at_ms,hard_expires_at_ms,signed_payload,'ACTIVE' FROM authorization_bundles WHERE bundle_id=?2",params![payload.snapshot_id,authority.5]).map_err(classify_sql_error)?;
        let first_staff: String = tx.query_row("SELECT staff_id FROM offline_staff_verifiers WHERE bundle_id=?1 ORDER BY staff_id LIMIT 1",[&authority.5],|r|r.get(0)).map_err(classify_sql_error)?;
        tx.execute("INSERT OR IGNORE INTO shifts(local_shift_id,canonical_shift_id,lease_id,staff_id,business_date,state,opened_at_ms,updated_at_ms) VALUES (?1,?1,?2,?3,?4,'ACTIVE',?5,?5)",params![authority.7,authority.6,first_staff,authority.8,received_at_ms]).map_err(classify_sql_error)?;
        tx.commit().map_err(classify_sql_error)?;
        Ok(activation_result(&payload, envelope.digest))
    }

    pub fn get_local_catalog(
        &self,
        query: Option<&str>,
        category_id: Option<&str>,
    ) -> Result<LocalCatalogView, LocalStoreError> {
        let (snapshot_id,version,currency,tax_mode):(String,String,String,String)=self.connection.query_row("SELECT c.snapshot_id,c.version,c.currency,c.tax_mode FROM active_catalog a JOIN catalog_snapshots c ON c.snapshot_id=a.snapshot_id WHERE c.verification_state='VERIFIED'",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional().map_err(classify_sql_error)?.ok_or(LocalStoreError::CatalogRequired)?;
        let mut service_stmt=self.connection.prepare("SELECT service_type,label,requires_context FROM catalog_service_types WHERE snapshot_id=?1 ORDER BY sort_order").map_err(classify_sql_error)?;
        let service_types = service_stmt
            .query_map([&snapshot_id], |r| {
                Ok(CatalogServiceTypeView {
                    id: r.get(0)?,
                    label: r.get(1)?,
                    requires_context: r.get::<_, i64>(2)? != 0,
                })
            })
            .map_err(classify_sql_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(classify_sql_error)?;
        let mut category_stmt=self.connection.prepare("SELECT category_id,code,name FROM catalog_categories WHERE snapshot_id=?1 AND is_active=1 ORDER BY sort_order").map_err(classify_sql_error)?;
        let categories = category_stmt
            .query_map([&snapshot_id], |r| {
                Ok(CatalogCategoryView {
                    id: r.get(0)?,
                    code: r.get(1)?,
                    name: r.get(2)?,
                })
            })
            .map_err(classify_sql_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(classify_sql_error)?;
        let normalized = query.map(normalize_search).unwrap_or_default();
        let like = format!("%{normalized}%");
        let mut product_stmt=self.connection.prepare("SELECT product_id,category_id,code,name,price_minor,tax_rate_bp FROM catalog_products WHERE snapshot_id=?1 AND is_available=1 AND (?2='' OR normalized_search LIKE ?3) AND (?4 IS NULL OR category_id=?4) ORDER BY sort_order").map_err(classify_sql_error)?;
        let rows = product_stmt
            .query_map(params![snapshot_id, normalized, like, category_id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, i64>(4)?,
                    r.get::<_, i64>(5)?,
                ))
            })
            .map_err(classify_sql_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(classify_sql_error)?;
        let mut products = Vec::with_capacity(rows.len());
        for row in rows {
            products.push(CatalogProductView {
                id: row.0.clone(),
                category_id: row.1,
                code: row.2,
                name: row.3,
                price_minor: row.4,
                tax_rate_bp: row.5,
                currency: currency.clone(),
                modifier_groups: self.read_modifier_groups(&snapshot_id, &row.0)?,
            });
        }
        Ok(LocalCatalogView {
            snapshot_id,
            version,
            currency,
            tax_mode,
            service_types,
            categories,
            products,
        })
    }

    fn read_modifier_groups(
        &self,
        snapshot_id: &str,
        product_id: &str,
    ) -> Result<Vec<CatalogModifierGroupView>, LocalStoreError> {
        let mut stmt=self.connection.prepare("SELECT group_id,name,min_select,max_select FROM catalog_modifier_groups WHERE snapshot_id=?1 AND product_id=?2 AND is_active=1 ORDER BY sort_order").map_err(classify_sql_error)?;
        let rows = stmt
            .query_map(params![snapshot_id, product_id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, i64>(3)?,
                ))
            })
            .map_err(classify_sql_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(classify_sql_error)?;
        let mut groups = Vec::with_capacity(rows.len());
        for row in rows {
            let mut options_stmt=self.connection.prepare("SELECT option_id,name,price_delta_minor FROM catalog_modifier_options WHERE snapshot_id=?1 AND group_id=?2 AND is_available=1 ORDER BY sort_order").map_err(classify_sql_error)?;
            let options = options_stmt
                .query_map(params![snapshot_id, row.0], |r| {
                    Ok(CatalogModifierOptionView {
                        id: r.get(0)?,
                        name: r.get(1)?,
                        price_delta_minor: r.get(2)?,
                    })
                })
                .map_err(classify_sql_error)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(classify_sql_error)?;
            groups.push(CatalogModifierGroupView {
                id: row.0,
                name: row.1,
                min_select: row.2,
                max_select: row.3,
                options,
            });
        }
        Ok(groups)
    }
}

fn activation_result(payload: &CatalogSnapshotPayload, digest: String) -> CatalogActivationResult {
    CatalogActivationResult {
        state: "ACTIVE",
        snapshot_id: payload.snapshot_id.clone(),
        version: payload.version.clone(),
        digest,
        product_count: payload.products.len(),
    }
}
fn decode_b64(value: &str) -> Result<Vec<u8>, LocalStoreError> {
    STANDARD_NO_PAD
        .decode(value)
        .or_else(|_| STANDARD.decode(value))
        .or_else(|_| URL_SAFE_NO_PAD.decode(value))
        .map_err(|_| LocalStoreError::InvalidCatalog)
}
fn decode_fixed<const N: usize>(value: &str) -> Result<[u8; N], LocalStoreError> {
    decode_b64(value)?
        .try_into()
        .map_err(|_| LocalStoreError::InvalidCatalog)
}
fn hex_digest(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
pub(super) fn normalize_search(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}
fn valid_text(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= MAX_TEXT
}
// Each check below returns on its own, single condition, rather than
// contributing one term to a single enormous `||` chain: that chain (thirty
// sub-conditions, five of them closures passed to `.any()`) put every
// intermediate result and closure it built in one stack frame, which is
// exactly what overflowed even a 256 MiB thread stack in an unoptimized
// Windows MSVC debug build's Cargo test (see release.yml's Cargo test step,
// and local_store::catalog::tests::altered_or_inapplicable_snapshot_fails_
// closed, the test that first caught it -- v0.1.1's release build). Written
// this way, no plausible future growth of this function should be able to
// reopen that crash regardless of how large a stack budget the CI step
// carries; a bug that a smaller function structurally cannot reproduce is a
// more durable fix than a larger number chasing one that can.
fn validate_payload(p: &CatalogSnapshotPayload, now: i64) -> Result<(), LocalStoreError> {
    let reject = LocalStoreError::InvalidCatalog;
    if p.protocol_version != PROTOCOL_VERSION || p.schema_version != SCHEMA_VERSION {
        return Err(reject);
    }
    if !valid_text(&p.snapshot_id)
        || !valid_text(&p.version)
        || !valid_text(&p.property_id)
        || !valid_text(&p.outlet_id)
    {
        return Err(reject);
    }
    if p.currency.len() != 3 || !p.currency.chars().all(|c| c.is_ascii_uppercase()) {
        return Err(reject);
    }
    if !matches!(p.tax_mode.as_str(), "EXCLUSIVE" | "INCLUSIVE") {
        return Err(reject);
    }
    if p.not_before_ms < p.published_at_ms
        || p.valid_until_ms <= p.not_before_ms
        || now < p.not_before_ms
        || now > p.valid_until_ms
    {
        return Err(reject);
    }
    if p.service_types.is_empty() || p.service_types.len() > MAX_SERVICE_TYPES {
        return Err(reject);
    }
    if p.categories.len() > MAX_CATEGORIES {
        return Err(reject);
    }
    if p.products.is_empty() || p.products.len() > MAX_PRODUCTS {
        return Err(reject);
    }
    if p.modifier_groups.len() > MAX_GROUPS || p.modifier_options.len() > MAX_OPTIONS {
        return Err(reject);
    }

    let category_ids: HashSet<_> = p.categories.iter().map(|v| &v.category_id).collect();
    let product_ids: HashSet<_> = p.products.iter().map(|v| &v.product_id).collect();
    let group_ids: HashSet<_> = p.modifier_groups.iter().map(|v| &v.group_id).collect();
    let option_ids: HashSet<_> = p.modifier_options.iter().map(|v| &v.option_id).collect();
    let service_ids: HashSet<_> = p.service_types.iter().map(|v| &v.service_type).collect();
    if service_ids.len() != p.service_types.len()
        || category_ids.len() != p.categories.len()
        || product_ids.len() != p.products.len()
        || group_ids.len() != p.modifier_groups.len()
        || option_ids.len() != p.modifier_options.len()
    {
        return Err(reject);
    }

    for v in &p.service_types {
        if !valid_text(&v.service_type) || !valid_text(&v.label) || v.sort_order < 0 {
            return Err(reject);
        }
    }
    for v in &p.categories {
        if !valid_text(&v.category_id)
            || !valid_text(&v.code)
            || !valid_text(&v.name)
            || v.sort_order < 0
        {
            return Err(reject);
        }
    }
    for v in &p.products {
        if !valid_text(&v.product_id)
            || !valid_text(&v.code)
            || !valid_text(&v.name)
            || v.price_minor < 0
            || !(0..=100_000).contains(&v.tax_rate_bp)
            || v.sort_order < 0
            || v.category_id
                .as_ref()
                .is_some_and(|id| !category_ids.contains(id))
        {
            return Err(reject);
        }
    }
    for v in &p.modifier_groups {
        if !valid_text(&v.group_id)
            || !valid_text(&v.name)
            || !product_ids.contains(&v.product_id)
            || v.min_select < 0
            || v.max_select < v.min_select
            || v.sort_order < 0
        {
            return Err(reject);
        }
    }
    for v in &p.modifier_options {
        if !valid_text(&v.option_id)
            || !valid_text(&v.name)
            || !group_ids.contains(&v.group_id)
            || v.sort_order < 0
        {
            return Err(reject);
        }
    }

    // A group's maximum is "up to": more than is available today (an option
    // sold out, or Yetu's "any number", maxSelect 2147483647) is not a broken
    // catalogue, and refusing the catalogue for it left the till with no
    // offline menu at all (F-228). What is chosen is checked when the item is
    // added (orders.rs, read_group_constraints).
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::local_store::{
        AuthorizationPayload, DbKeyStore, DbKeyStoreError, LocalStoreErrorKind,
        SignedAuthorizationBundle, StaffVerifierPayload,
    };
    use argon2::{password_hash::PasswordHasher, Argon2};
    use ed25519_dalek::{Signer, SigningKey};
    use std::sync::Mutex;

    #[derive(Default)]
    struct MemoryKeys(Mutex<Option<String>>);
    impl DbKeyStore for MemoryKeys {
        fn load(&self) -> Result<Option<String>, DbKeyStoreError> {
            Ok(self.0.lock().unwrap().clone())
        }
        fn save(&self, value: &str) -> Result<(), DbKeyStoreError> {
            *self.0.lock().unwrap() = Some(value.to_string());
            Ok(())
        }
    }
    fn payload() -> CatalogSnapshotPayload {
        CatalogSnapshotPayload {
            protocol_version: 1,
            schema_version: 1,
            snapshot_id: "snap-1".into(),
            version: "v1".into(),
            property_id: "prop-1".into(),
            outlet_id: "out-1".into(),
            currency: "TZS".into(),
            published_at_ms: 900,
            not_before_ms: 1_000,
            valid_until_ms: 10_000,
            tax_mode: "EXCLUSIVE".into(),
            service_types: vec![CatalogServiceTypePayload {
                service_type: "DINE_IN".into(),
                label: "Dine in".into(),
                requires_context: false,
                sort_order: 0,
            }],
            categories: vec![CatalogCategoryPayload {
                category_id: "food".into(),
                code: "FOOD".into(),
                name: "Food".into(),
                sort_order: 0,
                is_active: true,
            }],
            products: vec![CatalogProductPayload {
                product_id: "tea".into(),
                category_id: Some("food".into()),
                code: "TEA".into(),
                name: "Masala Tea".into(),
                price_minor: 10_000,
                tax_rate_bp: 1_800,
                is_available: true,
                sort_order: 0,
            }],
            modifier_groups: vec![CatalogModifierGroupPayload {
                group_id: "milk".into(),
                product_id: "tea".into(),
                name: "Milk".into(),
                min_select: 1,
                max_select: 1,
                sort_order: 0,
                is_active: true,
            }],
            modifier_options: vec![CatalogModifierOptionPayload {
                option_id: "oat".into(),
                group_id: "milk".into(),
                name: "Oat milk".into(),
                price_delta_minor: 2_000,
                sort_order: 0,
                is_available: true,
            }],
        }
    }
    fn seeded_store(key: &SigningKey) -> (tempfile::TempDir, LocalStore) {
        seeded_store_with(key, &payload())
    }
    fn seeded_store_with(key: &SigningKey, p: &CatalogSnapshotPayload) -> (tempfile::TempDir, LocalStore) {
        let temp = tempfile::tempdir().unwrap();
        let store =
            LocalStore::open(&temp.path().join("store.db"), &MemoryKeys::default()).unwrap();
        let bytes = serde_json::to_vec(p).unwrap();
        store.connection.execute("INSERT INTO terminal_authority VALUES ('term-1',1,'prop-1','out-1','reg-1','trust-1',?1,x'01','PAIRED',1,0,900,900)",[key.verifying_key().to_bytes().as_slice()]).unwrap();
        store.connection.execute("INSERT INTO authorization_bundles(bundle_id,terminal_id,credential_epoch,generation,lease_id,property_id,outlet_id,register_id,shift_id,business_date,catalog_version,catalog_digest,issued_at_ms,not_before_ms,refresh_after_ms,hard_expires_at_ms,revocation_generation,max_operation_count,max_gross_minor,max_cash_minor,allowed_operations_json,signing_key_id,signed_payload,signature,state,received_at_ms) VALUES ('bundle-1','term-1',1,1,'lease-1','prop-1','out-1','reg-1','shift-1','2026-09-03','v1',?1,900,1000,5000,10000,0,100,1000000,1000000,'[\"ORDER_DRAFT\",\"ORDER_COMMIT\"]','trust-1',x'01',zeroblob(64),'STAGED',1000)",[hex_digest(&bytes)]).unwrap();
        store.connection.execute("INSERT INTO offline_staff_verifiers(bundle_id,staff_id,display_name,verifier_phc,permissions_json,expires_at_ms,max_attempts,base_lockout_ms) VALUES ('bundle-1','staff-1','Cashier','x','[]',10000,5,1000)",[]).unwrap();
        store.connection.execute("INSERT INTO shift_authority VALUES ('bundle-1','shift-1','[\"staff-1\"]','ACTIVE',900,NULL)",[]).unwrap();
        (temp, store)
    }
    fn envelope(key: &SigningKey, p: &CatalogSnapshotPayload) -> SignedCatalogSnapshot {
        let bytes = serde_json::to_vec(p).unwrap();
        let digest = hex_digest(&bytes);
        let mut message = Vec::new();
        message.extend_from_slice(CATALOG_DOMAIN);
        message.extend_from_slice(digest.as_bytes());
        message.push(0);
        message.extend_from_slice(&bytes);
        SignedCatalogSnapshot {
            key_id: "trust-1".into(),
            algorithm: "Ed25519".into(),
            signature_version: 1,
            digest,
            payload_b64: STANDARD_NO_PAD.encode(bytes),
            signature_b64: STANDARD_NO_PAD.encode(key.sign(&message).to_bytes()),
        }
    }
    #[test]
    fn signed_snapshot_activates_atomically_and_drives_local_search() {
        let key = SigningKey::from_bytes(&[7; 32]);
        let (_temp, mut store) = seeded_store(&key);
        let result = store
            .install_catalog_snapshot(envelope(&key, &payload()), 2_000)
            .unwrap();
        assert_eq!(result.state, "ACTIVE");
        assert_eq!(
            store
                .install_catalog_snapshot(envelope(&key, &payload()), 2_001)
                .unwrap(),
            result
        );
        let view = store
            .get_local_catalog(Some("  MASALA   tea "), Some("food"))
            .unwrap();
        assert_eq!(view.products.len(), 1);
        assert_eq!(view.products[0].modifier_groups[0].options[0].id, "oat");
        let state: String = store
            .connection
            .query_row(
                "SELECT state FROM authorization_bundles WHERE bundle_id='bundle-1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(state, "ACTIVE");
    }
    // F-228: Yetu sends a group that takes any number as maxSelect 2147483647, and
    // Bahari QA Hotel's Extras (two options) made every offline start-up fail: the
    // whole catalogue was refused because the maximum passed what was available. A
    // maximum is "up to"; the choice itself is checked when the item is added.
    #[test]
    fn a_group_of_any_number_and_one_with_an_option_sold_out_still_install() {
        let key = SigningKey::from_bytes(&[9; 32]);
        let mut any = payload();
        any.modifier_groups[0].min_select = 0;
        any.modifier_groups[0].max_select = i64::from(i32::MAX);
        let (_temp, mut store) = seeded_store_with(&key, &any);
        let result = store.install_catalog_snapshot(envelope(&key, &any), 2_000).unwrap();
        assert_eq!(result.state, "ACTIVE");

        let mut sold_out = payload();
        sold_out.modifier_groups[0].min_select = 0;
        sold_out.modifier_groups[0].max_select = 2;
        sold_out.modifier_options[0].is_available = false;
        let (_temp2, mut store2) = seeded_store_with(&key, &sold_out);
        let result = store2.install_catalog_snapshot(envelope(&key, &sold_out), 2_000).unwrap();
        assert_eq!(result.state, "ACTIVE");
    }
    #[test]
    fn altered_or_inapplicable_snapshot_fails_closed() {
        let key = SigningKey::from_bytes(&[8; 32]);
        let (_temp, mut store) = seeded_store(&key);
        let mut bad = envelope(&key, &payload());
        bad.digest = "0".repeat(64);
        assert_eq!(
            store
                .install_catalog_snapshot(bad, 2_000)
                .unwrap_err()
                .kind(),
            LocalStoreErrorKind::InvalidCatalog
        );
        let mut invalid = payload();
        invalid.property_id = "another".into();
        assert!(store
            .install_catalog_snapshot(envelope(&key, &invalid), 2_000)
            .is_err());
    }

    #[test]
    fn same_catalog_lease_refresh_activates_without_a_download_deadlock() {
        let key = SigningKey::from_bytes(&[9; 32]);
        let (_temp, mut store) = seeded_store(&key);
        store
            .install_catalog_snapshot(envelope(&key, &payload()), 2_000)
            .unwrap();
        let verifier = Argon2::default()
            .hash_password(b"2468")
            .unwrap()
            .to_string();
        let authorization = AuthorizationPayload {
            protocol_version: 1,
            schema_version: 1,
            bundle_id: "bundle-2".into(),
            generation: 2,
            lease_id: "lease-2".into(),
            terminal_id: "term-1".into(),
            credential_epoch: 1,
            property_id: "prop-1".into(),
            outlet_id: "out-1".into(),
            register_id: "reg-1".into(),
            shift_id: "shift-1".into(),
            business_date: "2026-09-03".into(),
            catalog_version: "v1".into(),
            catalog_digest: hex_digest(&serde_json::to_vec(&payload()).unwrap()),
            issued_at_ms: 2_100,
            not_before_ms: 2_100,
            refresh_after_ms: 5_000,
            hard_expires_at_ms: 9_000,
            server_time_ms: 2_100,
            revocation_generation: 0,
            max_operation_count: 100,
            max_gross_minor: 1_000_000,
            max_cash_minor: 1_000_000,
            allowed_operations: vec!["ORDER_DRAFT".into(), "ORDER_COMMIT".into()],
            tender_methods: vec!["CASH".into()],
            shift_opened_at_ms: 900,
            property_timezone: "Africa/Dar_es_Salaam".into(),
            staff: vec![StaffVerifierPayload {
                staff_id: "staff-1".into(),
                display_name: "Cashier".into(),
                verifier_phc: verifier,
                permissions: vec!["pos.order.create".into()],
                expires_at_ms: 9_000,
                max_attempts: 5,
                base_lockout_ms: 1_000,
            }],
        };
        let bytes = serde_json::to_vec(&authorization).unwrap();
        let mut message = b"peak-pos-offline-authorization-v1\0".to_vec();
        message.extend_from_slice(&bytes);
        let result = store
            .stage_authorization(
                SignedAuthorizationBundle {
                    key_id: "trust-1".into(),
                    algorithm: "Ed25519".into(),
                    signature_version: 1,
                    payload_b64: STANDARD_NO_PAD.encode(bytes),
                    signature_b64: STANDARD_NO_PAD.encode(key.sign(&message).to_bytes()),
                },
                2_200,
            )
            .unwrap();
        assert_eq!(result.state, "ACTIVE");
        assert_eq!(result.prerequisite, None);
        let lease_exists: bool = store
            .connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM offline_leases WHERE lease_id='lease-2')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(lease_exists);
    }
}
