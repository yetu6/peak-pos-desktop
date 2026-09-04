ALTER TABLE order_modifiers ADD COLUMN modifier_group_name_snapshot TEXT NOT NULL DEFAULT '';

-- PIN verifier material is not financial evidence. Rust removes it when its
-- signed envelope is superseded or expired; retaining an immutable delete
-- trigger would keep low-entropy authorization material indefinitely.
DROP TRIGGER immutable_staff_verifier_delete;

CREATE TABLE trusted_signing_keys (
  kid TEXT PRIMARY KEY,
  algorithm TEXT NOT NULL CHECK (algorithm = 'Ed25519'),
  signature_version INTEGER NOT NULL CHECK (signature_version = 1),
  state TEXT NOT NULL CHECK (state IN ('CURRENT','PREVIOUS','NEXT','REVOKED')),
  public_key BLOB NOT NULL CHECK (length(public_key) = 32),
  not_before_ms INTEGER NOT NULL,
  not_after_ms INTEGER NOT NULL,
  fetched_at_ms INTEGER NOT NULL,
  CHECK (not_after_ms > not_before_ms)
) STRICT;

CREATE TABLE trusted_time_state (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  server_time_ms INTEGER NOT NULL,
  local_wall_at_anchor_ms INTEGER NOT NULL,
  monotonic_at_anchor_ms INTEGER NOT NULL,
  boot_id TEXT NOT NULL,
  backward_clock_suspected INTEGER NOT NULL DEFAULT 0 CHECK (backward_clock_suspected IN (0,1)),
  updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE TABLE reconciliation_results (
  operation_id TEXT PRIMARY KEY REFERENCES operations(operation_id) ON DELETE RESTRICT,
  outcome TEXT NOT NULL CHECK (outcome IN ('ACKNOWLEDGED','ALREADY_APPLIED','RETRYABLE','ACCEPTED_WITH_EXCEPTION','MANUAL_REVIEW_REQUIRED','REJECTED_NOT_COMMITTED')),
  server_sequence INTEGER NOT NULL,
  canonical_order_id TEXT,
  canonical_settlement_id TEXT,
  safe_reason_code TEXT,
  server_received_at_ms INTEGER NOT NULL,
  response_payload BLOB NOT NULL,
  recorded_at_ms INTEGER NOT NULL
) STRICT;

CREATE TABLE synchronization_state (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  connectivity TEXT NOT NULL CHECK (connectivity IN ('LIVE','RECONNECTING','OFFLINE','SYNC_ISSUE')),
  last_success_at_ms INTEGER,
  last_attempt_at_ms INTEGER,
  last_safe_error_code TEXT,
  updated_at_ms INTEGER NOT NULL
) STRICT;
INSERT INTO synchronization_state(singleton_id,connectivity,updated_at_ms) VALUES(1,'OFFLINE',0);

CREATE TRIGGER immutable_reconciliation_result_update
BEFORE UPDATE ON reconciliation_results BEGIN
  SELECT RAISE(ABORT, 'reconciliation result is immutable');
END;
CREATE TRIGGER immutable_reconciliation_result_delete
BEFORE DELETE ON reconciliation_results BEGIN
  SELECT RAISE(ABORT, 'reconciliation result is immutable');
END;
