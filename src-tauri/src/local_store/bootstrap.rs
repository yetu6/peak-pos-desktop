use base64::{
    engine::general_purpose::{STANDARD, STANDARD_NO_PAD, URL_SAFE_NO_PAD},
    Engine as _,
};
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};

use super::{
    classify_sql_error, AuthorizationPayload, AuthorizationStageResult, CatalogActivationResult,
    LocalStore, LocalStoreError, SignedAuthorizationBundle, SignedCatalogSnapshot, TerminalBinding,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OfflinePublicKey {
    pub kid: String,
    pub algorithm: String,
    pub signature_version: u32,
    pub state: String,
    pub not_before: String,
    pub not_after: String,
    pub public_key_b64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OfflinePublicKeyset {
    pub protocol_version: u32,
    pub issued_at: String,
    pub keys: Vec<OfflinePublicKey>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ServerOfflineBootstrap {
    pub server_time_ms: i64,
    pub keyset: OfflinePublicKeyset,
    pub catalog: SignedCatalogSnapshot,
    pub authorization: SignedAuthorizationBundle,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OfflineBootstrapResult {
    pub authorization: AuthorizationStageResult,
    pub catalog: CatalogActivationResult,
}

/// The device/property/outlet identity the caller already established, which
/// a server-signed bootstrap must match exactly before any of it is trusted.
#[derive(Debug, Clone, Copy)]
pub struct ExpectedTerminalIdentity<'a> {
    pub terminal_id: &'a str,
    pub property_id: &'a str,
    pub outlet_id: &'a str,
}

impl LocalStore {
    pub fn install_authenticated_keyset(
        &mut self,
        keyset: &OfflinePublicKeyset,
        trusted_received_at_ms: i64,
    ) -> Result<(), LocalStoreError> {
        self.install_trusted_keyset(keyset, trusted_received_at_ms)
    }

    /// Returns time derived from the last authenticated server anchor and the
    /// operating system's monotonic clock. A missing anchor, reboot, monotonic
    /// regression, or suspicious wall-clock rollback fails closed for new
    /// offline operations without modifying existing financial evidence.
    pub fn trusted_now_ms(
        &mut self,
        local_wall_ms: i64,
        monotonic_ms: i64,
        boot_id: &str,
    ) -> Result<i64, LocalStoreError> {
        let (server, anchor_wall, anchor_monotonic, anchor_boot, rollback):
            (i64, i64, i64, String, bool) = self
            .connection
            .query_row(
                "SELECT server_time_ms,local_wall_at_anchor_ms,monotonic_at_anchor_ms,boot_id,backward_clock_suspected FROM trusted_time_state WHERE singleton_id=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
            )
            .optional()
            .map_err(classify_sql_error)?
            .ok_or(LocalStoreError::AuthorizationRequired)?;
        if rollback
            || boot_id.is_empty()
            || anchor_boot != boot_id
            || monotonic_ms < anchor_monotonic
        {
            self.mark_clock_suspicious(local_wall_ms)?;
            return Err(LocalStoreError::AuthorizationRollback);
        }
        let elapsed = monotonic_ms
            .checked_sub(anchor_monotonic)
            .ok_or(LocalStoreError::AuthorizationRollback)?;
        let trusted = server
            .checked_add(elapsed)
            .ok_or(LocalStoreError::AuthorizationRollback)?;
        let expected_wall = anchor_wall
            .checked_add(elapsed)
            .ok_or(LocalStoreError::AuthorizationRollback)?;
        if local_wall_ms
            .checked_add(300_000)
            .is_none_or(|wall_with_tolerance| wall_with_tolerance < expected_wall)
        {
            self.mark_clock_suspicious(local_wall_ms)?;
            return Err(LocalStoreError::AuthorizationRollback);
        }
        Ok(trusted)
    }

    /// The identity the caller already established (from the session/device
    /// binding) that the server-signed bootstrap must exactly match before
    /// any of it is trusted.
    pub fn install_online_bootstrap(
        &mut self,
        expected: ExpectedTerminalIdentity<'_>,
        bootstrap: ServerOfflineBootstrap,
        local_wall_ms: i64,
        monotonic_ms: i64,
        boot_id: &str,
    ) -> Result<OfflineBootstrapResult, LocalStoreError> {
        self.install_trusted_keyset(&bootstrap.keyset, bootstrap.server_time_ms)?;
        let auth_bytes = decode_b64(&bootstrap.authorization.payload_b64)?;
        let auth: AuthorizationPayload = serde_json::from_slice(&auth_bytes)
            .map_err(|_| LocalStoreError::InvalidAuthorization)?;
        if auth.terminal_id != expected.terminal_id
            || auth.property_id != expected.property_id
            || auth.outlet_id != expected.outlet_id
            || auth.server_time_ms != bootstrap.server_time_ms
        {
            return Err(LocalStoreError::InvalidAuthorization);
        }
        let terminal_exists: bool = self
            .connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM terminal_authority WHERE is_current=1)",
                [],
                |r| r.get(0),
            )
            .map_err(classify_sql_error)?;
        if !terminal_exists {
            let current = bootstrap
                .keyset
                .keys
                .iter()
                .find(|k| k.state == "CURRENT")
                .ok_or(LocalStoreError::InvalidAuthorization)?;
            self.bind_terminal(TerminalBinding {
                terminal_id: auth.terminal_id.clone(),
                credential_epoch: auth.credential_epoch,
                property_id: auth.property_id.clone(),
                outlet_id: auth.outlet_id.clone(),
                register_id: auth.register_id.clone(),
                trust_key_id: current.kid.clone(),
                trust_public_key_b64: current.public_key_b64.clone(),
                configuration_payload_b64: STANDARD_NO_PAD.encode(b"{}"),
                revocation_generation: auth.revocation_generation,
                paired_at_ms: bootstrap.server_time_ms,
            })?;
        }
        self.record_trusted_time(
            bootstrap.server_time_ms,
            local_wall_ms,
            monotonic_ms,
            boot_id,
        )?;
        let authorization =
            self.stage_authorization(bootstrap.authorization, bootstrap.server_time_ms)?;
        let catalog = self.install_catalog_snapshot(bootstrap.catalog, bootstrap.server_time_ms)?;
        self.record_sync_live(bootstrap.server_time_ms)?;
        Ok(OfflineBootstrapResult {
            authorization,
            catalog,
        })
    }

    fn install_trusted_keyset(
        &mut self,
        keyset: &OfflinePublicKeyset,
        received_at: i64,
    ) -> Result<(), LocalStoreError> {
        let issued_at = parse_rfc3339_ms(&keyset.issued_at)?;
        if keyset.protocol_version != 1
            || keyset.keys.is_empty()
            || keyset.keys.len() > 3
            || issued_at > received_at + 60_000
        {
            return Err(LocalStoreError::InvalidAuthorization);
        }
        let current_count = keyset.keys.iter().filter(|k| k.state == "CURRENT").count();
        if current_count != 1 {
            return Err(LocalStoreError::InvalidAuthorization);
        }
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(classify_sql_error)?;
        tx.execute("DELETE FROM trusted_signing_keys", [])
            .map_err(classify_sql_error)?;
        for key in &keyset.keys {
            let not_before = parse_rfc3339_ms(&key.not_before)?;
            let not_after = parse_rfc3339_ms(&key.not_after)?;
            if key.algorithm != "Ed25519"
                || key.signature_version != 1
                || not_after <= not_before
                || !matches!(
                    key.state.as_str(),
                    "CURRENT" | "PREVIOUS" | "NEXT" | "REVOKED"
                )
            {
                return Err(LocalStoreError::InvalidAuthorization);
            }
            let public = decode_b64(&key.public_key_b64)?;
            if public.len() != 32 {
                return Err(LocalStoreError::InvalidAuthorization);
            }
            tx.execute("INSERT INTO trusted_signing_keys(kid,algorithm,signature_version,state,public_key,not_before_ms,not_after_ms,fetched_at_ms) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",params![key.kid,key.algorithm,key.signature_version,key.state,public,not_before,not_after,received_at]).map_err(classify_sql_error)?;
        }
        tx.commit().map_err(classify_sql_error)
    }

    fn record_trusted_time(
        &mut self,
        server: i64,
        wall: i64,
        monotonic: i64,
        boot_id: &str,
    ) -> Result<(), LocalStoreError> {
        if server <= 0 || wall <= 0 || monotonic < 0 || boot_id.is_empty() {
            return Err(LocalStoreError::InvalidAuthorization);
        }
        if let Some((old_server,old_wall,old_mono,old_boot))=self.connection.query_row("SELECT server_time_ms,local_wall_at_anchor_ms,monotonic_at_anchor_ms,boot_id FROM trusted_time_state WHERE singleton_id=1",[],|r|Ok((r.get::<_,i64>(0)?,r.get::<_,i64>(1)?,r.get::<_,i64>(2)?,r.get::<_,String>(3)?))).optional().map_err(classify_sql_error)?{
            let trusted_floor=if old_boot==boot_id&&monotonic>=old_mono{old_server.saturating_add(monotonic-old_mono)}else{old_server};
            if server+300_000<trusted_floor||wall+300_000<old_wall{return Err(LocalStoreError::AuthorizationRollback)}
        }
        self.connection.execute("INSERT INTO trusted_time_state(singleton_id,server_time_ms,local_wall_at_anchor_ms,monotonic_at_anchor_ms,boot_id,backward_clock_suspected,updated_at_ms) VALUES(1,?1,?2,?3,?4,0,?2) ON CONFLICT(singleton_id) DO UPDATE SET server_time_ms=excluded.server_time_ms,local_wall_at_anchor_ms=excluded.local_wall_at_anchor_ms,monotonic_at_anchor_ms=excluded.monotonic_at_anchor_ms,boot_id=excluded.boot_id,backward_clock_suspected=0,updated_at_ms=excluded.updated_at_ms",params![server,wall,monotonic,boot_id]).map_err(classify_sql_error)?;
        Ok(())
    }

    fn mark_clock_suspicious(&mut self, observed_wall_ms: i64) -> Result<(), LocalStoreError> {
        self.connection
            .execute(
                "UPDATE trusted_time_state SET backward_clock_suspected=1,updated_at_ms=?1 WHERE singleton_id=1",
                [observed_wall_ms],
            )
            .map_err(classify_sql_error)?;
        self.active_staff = None;
        Ok(())
    }
}

fn decode_b64(value: &str) -> Result<Vec<u8>, LocalStoreError> {
    STANDARD_NO_PAD
        .decode(value)
        .or_else(|_| STANDARD.decode(value))
        .or_else(|_| URL_SAFE_NO_PAD.decode(value))
        .map_err(|_| LocalStoreError::InvalidAuthorization)
}
fn parse_rfc3339_ms(value: &str) -> Result<i64, LocalStoreError> {
    use time::{format_description::well_known::Rfc3339, OffsetDateTime};
    OffsetDateTime::parse(value, &Rfc3339)
        .map_err(|_| LocalStoreError::InvalidAuthorization)?
        .unix_timestamp_nanos()
        .checked_div(1_000_000)
        .and_then(|v| i64::try_from(v).ok())
        .ok_or(LocalStoreError::InvalidAuthorization)
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use rusqlite::Connection;

    use super::*;

    fn test_store() -> LocalStore {
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

    #[test]
    fn trusted_time_survives_app_restart_on_same_os_boot() {
        let mut store = test_store();
        store
            .record_trusted_time(1_000_000, 5_000_000, 20_000, "boot-a")
            .unwrap();
        assert_eq!(
            store.trusted_now_ms(5_030_000, 50_000, "boot-a").unwrap(),
            1_030_000
        );
    }

    #[test]
    fn backward_wall_clock_and_reboot_fail_closed_and_latch() {
        let mut store = test_store();
        store
            .record_trusted_time(1_000_000, 5_000_000, 20_000, "boot-a")
            .unwrap();
        assert!(matches!(
            store.trusted_now_ms(4_000_000, 50_000, "boot-a"),
            Err(LocalStoreError::AuthorizationRollback)
        ));
        assert!(matches!(
            store.trusted_now_ms(5_030_000, 50_000, "boot-a"),
            Err(LocalStoreError::AuthorizationRollback)
        ));

        let mut rebooted = test_store();
        rebooted
            .record_trusted_time(1_000_000, 5_000_000, 20_000, "boot-a")
            .unwrap();
        assert!(matches!(
            rebooted.trusted_now_ms(5_030_000, 1_000, "boot-b"),
            Err(LocalStoreError::AuthorizationRollback)
        ));
    }

    #[test]
    fn authenticated_keyset_is_bounded_and_preserves_rotation_states() {
        let mut store = test_store();
        let key = |kid: &str, state: &str| OfflinePublicKey {
            kid: kid.into(),
            algorithm: "Ed25519".into(),
            signature_version: 1,
            state: state.into(),
            not_before: "2026-09-04T00:00:00Z".into(),
            not_after: "2026-09-06T00:00:00Z".into(),
            public_key_b64: STANDARD_NO_PAD.encode([7_u8; 32]),
        };
        let keyset = OfflinePublicKeyset {
            protocol_version: 1,
            issued_at: "2026-09-04T01:00:00Z".into(),
            keys: vec![
                key("previous", "PREVIOUS"),
                key("current", "CURRENT"),
                key("next", "NEXT"),
            ],
        };
        store
            .install_authenticated_keyset(&keyset, 1_788_483_600_000)
            .unwrap();
        let count: i64 = store
            .connection
            .query_row("SELECT count(*) FROM trusted_signing_keys", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 3);

        let mut oversized = keyset;
        oversized.keys.push(key("revoked", "REVOKED"));
        assert!(matches!(
            store.install_authenticated_keyset(&oversized, 1_788_483_600_000),
            Err(LocalStoreError::InvalidAuthorization)
        ));
        let count_after_rejection: i64 = store
            .connection
            .query_row("SELECT count(*) FROM trusted_signing_keys", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count_after_rejection, 3);
    }
}
