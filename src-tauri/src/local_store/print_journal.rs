//! Durable evidence only: no financial writes, offline authority, or payload cache.
use super::{classify_sql_error, LocalStore, LocalStoreError};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PrintScope {
    pub property_id: String,
    pub outlet_id: String,
    pub terminal_id: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrintAttempt {
    pub job_key: String,
    pub attempt: i64,
    pub state: String,
    pub route_hash: String,
    pub payload_hash: String,
    pub error: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    fn store() -> LocalStore {
        struct Keys(std::sync::Mutex<Option<String>>);
        impl super::super::DbKeyStore for Keys {
            fn load(&self) -> Result<Option<String>, super::super::DbKeyStoreError> {
                Ok(self.0.lock().unwrap().clone())
            }
            fn save(&self, v: &str) -> Result<(), super::super::DbKeyStoreError> {
                *self.0.lock().unwrap() = Some(v.into());
                Ok(())
            }
        }
        let dir = tempfile::tempdir().unwrap().keep();
        LocalStore::open(&dir.join("journal.sqlite3"), &Keys(Default::default())).unwrap()
    }
    fn scope() -> PrintScope {
        PrintScope {
            property_id: "property".into(),
            outlet_id: "outlet".into(),
            terminal_id: "terminal".into(),
        }
    }
    #[test]
    fn journal_guards_identity_dispatch_acceptance_and_no_send_retry() {
        let mut s = store();
        let scope = scope();
        assert_eq!(
            s.reserve_print("job", &scope, "route", "payload")
                .unwrap()
                .attempt,
            1
        );
        assert!(s.reserve_print("job", &scope, "other", "payload").is_err());
        assert!(s.reserve_print("job", &scope, "route", "other").is_err());
        let mut other = scope.clone();
        other.terminal_id = "other".into();
        assert!(s.inspect_print("job", &other).is_err());
        assert!(s
            .mark_print("job", &scope, 1, "RESERVED", "ACCEPTED", None)
            .is_err());
        s.mark_print("job", &scope, 1, "RESERVED", "UNKNOWN", None)
            .unwrap();
        assert_eq!(
            s.reserve_print("job", &scope, "route", "payload")
                .unwrap()
                .state,
            "UNKNOWN"
        );
        s.mark_print(
            "job",
            &scope,
            1,
            "UNKNOWN",
            "NOT_SENT",
            Some("connect refused"),
        )
        .unwrap();
        let retry = s.reserve_print("job", &scope, "route", "payload").unwrap();
        assert_eq!(retry.attempt, 2);
        assert!(s
            .mark_print("job", &scope, 1, "RESERVED", "UNKNOWN", None)
            .is_err());
        s.mark_print("job", &scope, 2, "RESERVED", "UNKNOWN", None)
            .unwrap();
        s.mark_print("job", &scope, 2, "UNKNOWN", "ACCEPTED", None)
            .unwrap();
        assert_eq!(
            s.reserve_print("job", &scope, "route", "payload")
                .unwrap()
                .state,
            "ACCEPTED"
        );
        assert!(s
            .mark_print("job", &scope, 2, "ACCEPTED", "NOT_SENT", None)
            .is_err());
        let financial: i64 = s.connection.query_row("SELECT (SELECT count(*) FROM orders)+(SELECT count(*) FROM operations)+(SELECT count(*) FROM cash_settlements)", [], |r| r.get(0)).unwrap();
        assert_eq!(financial, 0);
    }
    #[test]
    fn journal_is_bounded_without_evicting_duplicate_protection() {
        let mut s = store();
        let scope = scope();
        s.reserve_print("job", &scope, "route", "payload").unwrap();
        s.mark_print("job", &scope, 1, "RESERVED", "UNKNOWN", None)
            .unwrap();
        // The transport test separately drops/reopens the keyed connection.
        s.connection
            .execute_batch("PRAGMA wal_checkpoint(FULL)")
            .unwrap();
        assert_eq!(
            s.inspect_print("job", &scope).unwrap().unwrap().state,
            "UNKNOWN"
        );
        assert!(s.reserve_print("", &scope, "route", "payload").is_err());
        assert!(s
            .reserve_print(&"x".repeat(257), &scope, "route", "payload")
            .is_err());
        s.connection.execute_batch("WITH RECURSIVE n(v) AS (SELECT 1 UNION ALL SELECT v+1 FROM n WHERE v<99999) INSERT INTO native_print_attempts(job_key,attempt,property_id,outlet_id,terminal_id,route_hash,payload_hash,state) SELECT 'filler-'||v,1,'property','outlet','terminal','r','p','ACCEPTED' FROM n").unwrap();
        assert!(matches!(
            s.reserve_print("over-capacity", &scope, "route", "payload"),
            Err(LocalStoreError::LimitExceeded)
        ));
        assert_eq!(
            s.inspect_print("job", &scope).unwrap().unwrap().state,
            "UNKNOWN"
        );
        assert_eq!(
            s.reserve_print("job", &scope, "route", "payload")
                .unwrap()
                .state,
            "UNKNOWN"
        );
    }
}

// Named limits, fail closed: deleting old acceptance evidence permits duplicates.
const MAX_JOURNAL_ATTEMPTS: i64 = 100_000;
const MAX_ID_BYTES: usize = 256;
impl LocalStore {
    pub fn inspect_print(
        &self,
        key: &str,
        scope: &PrintScope,
    ) -> Result<Option<PrintAttempt>, LocalStoreError> {
        if [
            key,
            &scope.property_id,
            &scope.outlet_id,
            &scope.terminal_id,
        ]
        .iter()
        .any(|s| s.trim().is_empty() || s.len() > MAX_ID_BYTES || s.chars().any(char::is_control))
        {
            return Err(LocalStoreError::OperationNotAllowed);
        }
        let result = self.connection.query_row(
            "SELECT job_key,attempt,state,route_hash,payload_hash,error,property_id,outlet_id,terminal_id FROM native_print_attempts WHERE job_key=?1 ORDER BY attempt DESC LIMIT 1", [key], |r| {
                Ok((PrintAttempt { job_key:r.get(0)?, attempt:r.get(1)?, state:r.get(2)?, route_hash:r.get(3)?, payload_hash:r.get(4)?, error:r.get(5)? }, PrintScope {property_id:r.get(6)?,outlet_id:r.get(7)?,terminal_id:r.get(8)?}))
            }).optional().map_err(classify_sql_error)?;
        match result {
            Some((_, old)) if old != *scope => Err(LocalStoreError::OperationNotAllowed),
            Some((attempt, _)) => Ok(Some(attempt)),
            None => Ok(None),
        }
    }

    #[cfg(test)]
    fn reserve_print(
        &mut self,
        key: &str,
        scope: &PrintScope,
        route: &str,
        payload: &str,
    ) -> Result<PrintAttempt, LocalStoreError> {
        let next = self.inspect_print(key, scope)?.map_or(1, |v| {
            if v.state == "NOT_SENT" {
                v.attempt + 1
            } else {
                v.attempt
            }
        });
        self.reserve_print_attempt(key, scope, route, payload, next)
    }

    pub(crate) fn reserve_print_attempt(
        &mut self,
        key: &str,
        scope: &PrintScope,
        route: &str,
        payload: &str,
        attempt: i64,
    ) -> Result<PrintAttempt, LocalStoreError> {
        if attempt < 1 {
            return Err(LocalStoreError::OperationNotAllowed);
        }
        let old = self.inspect_print(key, scope)?;
        if let Some(old) = &old {
            if (old.state != "NOT_SENT" || attempt <= old.attempt)
                && (old.route_hash != route || old.payload_hash != payload)
            {
                return Err(LocalStoreError::OperationNotAllowed);
            }
            if old.state != "NOT_SENT" || old.attempt == attempt {
                return Ok(old.clone());
            }
            if attempt <= old.attempt {
                return Err(LocalStoreError::OperationNotAllowed);
            }
        }
        let count: i64 = self
            .connection
            .query_row("SELECT count(*) FROM native_print_attempts", [], |r| {
                r.get(0)
            })
            .map_err(classify_sql_error)?;
        if count >= MAX_JOURNAL_ATTEMPTS {
            return Err(LocalStoreError::LimitExceeded);
        }
        self.connection.execute("INSERT INTO native_print_attempts(job_key,attempt,property_id,outlet_id,terminal_id,route_hash,payload_hash,state) VALUES(?1,?2,?3,?4,?5,?6,?7,'RESERVED')", params![key,attempt,scope.property_id,scope.outlet_id,scope.terminal_id,route,payload]).map_err(classify_sql_error)?;
        self.inspect_print(key, scope)?
            .ok_or(LocalStoreError::IntegrityFailure)
    }

    pub(crate) fn mark_print(
        &mut self,
        key: &str,
        scope: &PrintScope,
        attempt: i64,
        from: &str,
        to: &str,
        error: Option<&str>,
    ) -> Result<PrintAttempt, LocalStoreError> {
        if !matches!(
            (from, to),
            ("RESERVED", "UNKNOWN") | ("UNKNOWN", "ACCEPTED") | ("UNKNOWN", "NOT_SENT")
        ) {
            return Err(LocalStoreError::OperationNotAllowed);
        }
        let current = self
            .inspect_print(key, scope)?
            .ok_or(LocalStoreError::OperationNotAllowed)?;
        if current.attempt != attempt || current.state != from {
            return Err(LocalStoreError::OperationNotAllowed);
        }
        let error = error.map(|s| s.chars().take(512).collect::<String>());
        let changed = self.connection.execute("UPDATE native_print_attempts SET state=?1,error=?2 WHERE job_key=?3 AND attempt=?4 AND state=?5", params![to,error,key,attempt,from]).map_err(classify_sql_error)?;
        if changed != 1 {
            return Err(LocalStoreError::IntegrityFailure);
        }
        self.inspect_print(key, scope)?
            .ok_or(LocalStoreError::IntegrityFailure)
    }
}
