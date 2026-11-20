-- The sign-in kit: everyone on this till's PIN screen, each with a till copy of
-- their PIN (Argon2id, never the server's own hash). One kit at a time, replaced
-- whole. Lives in the SQLCipher store, so the copies and names are encrypted.
CREATE TABLE sign_in_kit (
 singleton_id INTEGER PRIMARY KEY CHECK(singleton_id = 1),
 terminal_id TEXT NOT NULL,
 issued_at_ms INTEGER NOT NULL CHECK(issued_at_ms > 0),
 key_id TEXT NOT NULL,
 terminal_json TEXT NOT NULL,
 installed_at_ms INTEGER NOT NULL
);
CREATE TABLE sign_in_kit_staff (
 staff_id TEXT PRIMARY KEY,
 display_name TEXT NOT NULL,
 role_code TEXT NOT NULL,
 permissions_json TEXT NOT NULL,
 needs_setup INTEGER NOT NULL CHECK(needs_setup IN (0,1)),
 till_copy_phc TEXT,
 copy_version TEXT,
 server_locked_until_ms INTEGER,
 max_attempts INTEGER NOT NULL CHECK(max_attempts > 0),
 base_lockout_ms INTEGER NOT NULL CHECK(base_lockout_ms > 0),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
 locked_until_ms INTEGER
);
