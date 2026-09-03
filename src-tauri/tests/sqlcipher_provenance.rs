use rusqlite::Connection;

#[test]
fn bundled_database_engine_is_pinned_sqlcipher() {
    let connection = Connection::open_in_memory().expect("open SQLCipher memory database");
    let cipher_version: String = connection
        .query_row("PRAGMA cipher_version", [], |row| row.get(0))
        .expect("bundled engine must expose SQLCipher version");
    let sqlite_version: String = connection
        .query_row("SELECT sqlite_version()", [], |row| row.get(0))
        .expect("bundled engine must expose SQLite version");

    assert_eq!(cipher_version, "4.14.0 community");
    assert_eq!(sqlite_version, "3.51.3");
}

#[test]
fn keyed_database_rejects_unkeyed_access() {
    let directory = tempfile::tempdir().expect("temporary directory");
    let path = directory.path().join("encrypted.sqlite3");
    let keyed = Connection::open(&path).expect("open encrypted database");
    keyed
        .execute_batch(
            "PRAGMA key = \"x'000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'\";
             CREATE TABLE evidence (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
             INSERT INTO evidence(value) VALUES ('physical-cash-evidence');",
        )
        .expect("create encrypted schema");
    drop(keyed);

    let unkeyed = Connection::open(&path).expect("open file handle without key");
    let result = unkeyed.query_row("SELECT value FROM evidence", [], |row| {
        row.get::<_, String>(0)
    });
    assert!(
        result.is_err(),
        "plaintext SQLite access must not read encrypted evidence"
    );
}
