use rusqlite::{Connection, TransactionBehavior};

use super::{classify_sql_error, LocalStoreError};

const CURRENT_SCHEMA_VERSION: u32 = 4;
const INITIAL_SCHEMA: &str = include_str!("migrations/0001_initial.sql");
const TERMINAL_AUTHORITY_SCHEMA: &str = include_str!("migrations/0002_terminal_authority.sql");
const CATALOG_ORDERING_SCHEMA: &str = include_str!("migrations/0003_catalog_ordering.sql");
const RECONCILIATION_SCHEMA: &str = include_str!("migrations/0004_reconciliation.sql");

pub(super) fn migrate(connection: &mut Connection) -> Result<u32, LocalStoreError> {
    let version: u32 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(classify_sql_error)?;
    if version > CURRENT_SCHEMA_VERSION {
        return Err(LocalStoreError::MigrationFailure);
    }
    if version < CURRENT_SCHEMA_VERSION {
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(classify_sql_error)?;
        if version < 1 {
            transaction
                .execute_batch(INITIAL_SCHEMA)
                .map_err(classify_sql_error)?;
        }
        if version < 2 {
            transaction
                .execute_batch(TERMINAL_AUTHORITY_SCHEMA)
                .map_err(classify_sql_error)?;
        }
        if version < 3 {
            transaction
                .execute_batch(CATALOG_ORDERING_SCHEMA)
                .map_err(classify_sql_error)?;
        }
        if version < 4 {
            transaction
                .execute_batch(RECONCILIATION_SCHEMA)
                .map_err(classify_sql_error)?;
        }
        transaction
            .pragma_update(None, "user_version", CURRENT_SCHEMA_VERSION)
            .map_err(classify_sql_error)?;
        transaction.commit().map_err(classify_sql_error)?;
    }
    Ok(CURRENT_SCHEMA_VERSION)
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use super::*;

    #[test]
    fn initial_migration_is_atomic_and_reentrant() {
        let mut connection = Connection::open_in_memory().expect("open memory database");
        connection
            .pragma_update(None, "foreign_keys", true)
            .unwrap();
        assert_eq!(migrate(&mut connection).unwrap(), 4);
        assert_eq!(migrate(&mut connection).unwrap(), 4);
        let count: i64 = connection
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN \
                 ('orders','cash_settlements','operations','outbox','print_jobs')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 5);
    }

    #[test]
    fn initial_schema_enforces_financial_and_operation_identity_constraints() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .pragma_update(None, "foreign_keys", true)
            .unwrap();
        migrate(&mut connection).unwrap();
        assert_eq!(
            connection
                .query_row("PRAGMA foreign_keys", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            1
        );

        let sql = "INSERT INTO cash_settlements \
          (local_settlement_id,local_order_id,currency,amount_due_minor,cash_received_minor,change_minor,evidence_payload,evidence_hash,committed_at_ms,sync_state) \
          VALUES ('s','missing','TZS',100,50,-50,x'01','h',1,'QUEUED')";
        assert!(connection.execute(sql, []).is_err());
    }

    #[test]
    fn failing_migration_transaction_leaves_no_partial_schema() {
        let mut connection = Connection::open_in_memory().unwrap();
        let transaction = connection.transaction().unwrap();
        let result = transaction.execute_batch(
            "CREATE TABLE should_rollback(id INTEGER PRIMARY KEY);\
             CREATE TABLE should_rollback(id INTEGER PRIMARY KEY);",
        );
        assert!(result.is_err());
        drop(transaction);
        let count: i64 = connection
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE name='should_rollback'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn schema_has_unique_operation_identity_and_immutable_evidence_guards() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .pragma_update(None, "foreign_keys", true)
            .unwrap();
        migrate(&mut connection).unwrap();
        let unique_indexes: i64 = connection
            .query_row(
                "SELECT count(*) FROM pragma_index_list('operations') WHERE \"unique\" = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(
            unique_indexes >= 2,
            "operation ID, hash, and device sequence are unique"
        );
        let immutable_triggers: i64 = connection
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='trigger' AND name LIKE 'immutable_%'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(immutable_triggers >= 10);
    }

    #[test]
    fn current_schema_includes_terminal_authority_staging_constraints() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .pragma_update(None, "foreign_keys", true)
            .unwrap();
        assert_eq!(migrate(&mut connection).unwrap(), 4);
        let tables: i64 = connection
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN \
                 ('terminal_authority','authorization_bundles','offline_staff_verifiers',\
                  'shift_authority','authorization_clock_anchor')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(tables, 5);
    }

    #[test]
    fn catalog_ordering_migration_reaches_version_three_with_immutable_projections() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .pragma_update(None, "foreign_keys", true)
            .unwrap();
        assert_eq!(migrate(&mut connection).unwrap(), 4);
        let projection_tables: i64 = connection
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN
                 ('catalog_service_types','catalog_categories','catalog_products',
                  'catalog_modifier_groups','catalog_modifier_options')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(projection_tables, 5);
        let order_columns: i64 = connection
            .query_row(
                "SELECT count(*) FROM pragma_table_info('orders') WHERE name IN
                 ('staff_id','table_label','notes','version','order_number','sync_state')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(order_columns, 6);
        let search_indexes: i64 = connection
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='index'
                 AND name='idx_catalog_products_search'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(search_indexes, 1);
        let immutable_projection_triggers: i64 = connection
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='trigger'
                 AND name LIKE 'immutable_catalog_%'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(immutable_projection_triggers, 12);
    }

    #[test]
    fn existing_version_two_store_upgrades_without_replaying_prior_migrations() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .pragma_update(None, "foreign_keys", true)
            .unwrap();
        connection.execute_batch(INITIAL_SCHEMA).unwrap();
        connection.execute_batch(TERMINAL_AUTHORITY_SCHEMA).unwrap();
        connection.pragma_update(None, "user_version", 2).unwrap();

        assert_eq!(migrate(&mut connection).unwrap(), 4);
        let projection_tables: i64 = connection
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name LIKE 'catalog_%'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(projection_tables >= 6);
        assert_eq!(migrate(&mut connection).unwrap(), 4);
    }
}
