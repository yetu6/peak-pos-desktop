CREATE TABLE store_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE TABLE terminal_context (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  device_id TEXT NOT NULL,
  identity_epoch INTEGER NOT NULL CHECK (identity_epoch >= 0),
  property_id TEXT NOT NULL,
  outlet_id TEXT NOT NULL,
  register_id TEXT NOT NULL,
  context_json TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE TABLE secure_anchors (
  anchor_name TEXT PRIMARY KEY,
  generation INTEGER NOT NULL CHECK (generation >= 0),
  value_hash BLOB NOT NULL,
  updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE TABLE offline_leases (
  lease_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  identity_epoch INTEGER NOT NULL,
  shift_id TEXT NOT NULL,
  business_date TEXT NOT NULL,
  catalog_snapshot_id TEXT NOT NULL,
  issued_at_ms INTEGER NOT NULL,
  hard_expires_at_ms INTEGER NOT NULL CHECK (hard_expires_at_ms > issued_at_ms),
  signed_envelope BLOB NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('STAGED','ACTIVE','EXPIRED','REVOKED'))
) STRICT;

CREATE TABLE staff_authorization_envelopes (
  staff_id TEXT NOT NULL,
  lease_id TEXT NOT NULL REFERENCES offline_leases(lease_id) ON DELETE CASCADE,
  verifier_envelope BLOB NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  locked_until_ms INTEGER,
  expires_at_ms INTEGER NOT NULL,
  revoked_at_ms INTEGER,
  PRIMARY KEY (staff_id, lease_id)
) STRICT;

CREATE TABLE catalog_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  digest TEXT NOT NULL UNIQUE,
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  published_at_ms INTEGER NOT NULL,
  valid_until_ms INTEGER,
  signed_manifest BLOB NOT NULL,
  payload BLOB NOT NULL,
  verification_state TEXT NOT NULL CHECK (verification_state IN ('STAGED','VERIFIED','INVALID')),
  UNIQUE (version, digest)
) STRICT;

CREATE TABLE active_catalog (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  snapshot_id TEXT NOT NULL REFERENCES catalog_snapshots(snapshot_id) ON DELETE RESTRICT,
  activated_at_ms INTEGER NOT NULL
) STRICT;

CREATE TABLE shifts (
  local_shift_id TEXT PRIMARY KEY,
  canonical_shift_id TEXT UNIQUE,
  lease_id TEXT NOT NULL REFERENCES offline_leases(lease_id) ON DELETE RESTRICT,
  staff_id TEXT NOT NULL,
  business_date TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('ACTIVE','ENDED_SERVER_ACKNOWLEDGED','REVOKED')),
  opened_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE TABLE orders (
  local_order_id TEXT PRIMARY KEY,
  canonical_order_id TEXT UNIQUE,
  local_shift_id TEXT NOT NULL REFERENCES shifts(local_shift_id) ON DELETE RESTRICT,
  catalog_snapshot_id TEXT NOT NULL REFERENCES catalog_snapshots(snapshot_id) ON DELETE RESTRICT,
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  service_type TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('DRAFT','COMMITTED','SETTLED','VOIDED')),
  subtotal_minor INTEGER NOT NULL,
  tax_minor INTEGER NOT NULL,
  total_minor INTEGER NOT NULL CHECK (total_minor >= 0),
  immutable_committed INTEGER NOT NULL DEFAULT 0 CHECK (immutable_committed IN (0,1)),
  created_at_ms INTEGER NOT NULL,
  committed_at_ms INTEGER,
  updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE TABLE order_lines (
  local_line_id TEXT PRIMARY KEY,
  local_order_id TEXT NOT NULL REFERENCES orders(local_order_id) ON DELETE RESTRICT,
  product_id TEXT NOT NULL,
  product_name_snapshot TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_minor INTEGER NOT NULL,
  modifier_total_minor INTEGER NOT NULL,
  line_total_minor INTEGER NOT NULL,
  pricing_evidence BLOB NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  UNIQUE (local_order_id, position)
) STRICT;

CREATE TABLE order_modifiers (
  local_modifier_id TEXT PRIMARY KEY,
  local_line_id TEXT NOT NULL REFERENCES order_lines(local_line_id) ON DELETE RESTRICT,
  modifier_id TEXT NOT NULL,
  modifier_name_snapshot TEXT NOT NULL,
  price_delta_minor INTEGER NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  UNIQUE (local_line_id, position)
) STRICT;

CREATE TABLE cash_settlements (
  local_settlement_id TEXT PRIMARY KEY,
  canonical_settlement_id TEXT UNIQUE,
  local_order_id TEXT NOT NULL UNIQUE REFERENCES orders(local_order_id) ON DELETE RESTRICT,
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  amount_due_minor INTEGER NOT NULL CHECK (amount_due_minor >= 0),
  cash_received_minor INTEGER NOT NULL CHECK (cash_received_minor >= amount_due_minor),
  change_minor INTEGER NOT NULL CHECK (change_minor = cash_received_minor - amount_due_minor),
  evidence_payload BLOB NOT NULL,
  evidence_hash TEXT NOT NULL UNIQUE,
  committed_at_ms INTEGER NOT NULL,
  sync_state TEXT NOT NULL CHECK (sync_state IN ('QUEUED','ACKNOWLEDGED','ACCEPTED_WITH_EXCEPTION','MANUAL_REVIEW'))
) STRICT;

CREATE TABLE print_documents (
  document_id TEXT PRIMARY KEY,
  local_order_id TEXT REFERENCES orders(local_order_id) ON DELETE RESTRICT,
  local_settlement_id TEXT REFERENCES cash_settlements(local_settlement_id) ON DELETE RESTRICT,
  document_type TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  template_version TEXT NOT NULL,
  copy_marker TEXT CHECK (copy_marker IN ('DUPLICATE','REPRINT')),
  original_document_id TEXT REFERENCES print_documents(document_id) ON DELETE RESTRICT,
  catalog_snapshot_id TEXT REFERENCES catalog_snapshots(snapshot_id) ON DELETE RESTRICT,
  render_payload BLOB NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  CHECK ((copy_marker IS NULL AND original_document_id IS NULL) OR
         (copy_marker IS NOT NULL AND original_document_id IS NOT NULL))
) STRICT;

CREATE TABLE printer_profiles (
  profile_id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  adapter TEXT NOT NULL,
  destination TEXT NOT NULL,
  capability_snapshot BLOB NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0,1)),
  updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE TABLE print_jobs (
  job_id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES print_documents(document_id) ON DELETE RESTRICT,
  profile_id TEXT REFERENCES printer_profiles(profile_id) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK (state IN ('PENDING','DISPATCHING','PRINTED','FAILED','OUTCOME_UNKNOWN','HELD_NO_PRINTER','CANCELLED')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE TABLE print_attempts (
  attempt_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES print_jobs(job_id) ON DELETE RESTRICT,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  started_at_ms INTEGER NOT NULL,
  completed_at_ms INTEGER,
  outcome TEXT CHECK (outcome IN ('PRINTED','FAILED','OUTCOME_UNKNOWN')),
  bytes_may_have_reached_printer INTEGER NOT NULL DEFAULT 0 CHECK (bytes_may_have_reached_printer IN (0,1)),
  safe_diagnostic_code TEXT,
  UNIQUE (job_id, attempt_number)
) STRICT;

CREATE TABLE sequence_state (
  device_id TEXT NOT NULL,
  identity_epoch INTEGER NOT NULL CHECK (identity_epoch >= 0),
  last_sequence INTEGER NOT NULL CHECK (last_sequence >= 0),
  last_operation_hash TEXT,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (device_id, identity_epoch)
) STRICT;

CREATE TABLE operations (
  operation_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  identity_epoch INTEGER NOT NULL CHECK (identity_epoch >= 0),
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  operation_type TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  lease_id TEXT NOT NULL REFERENCES offline_leases(lease_id) ON DELETE RESTRICT,
  catalog_snapshot_id TEXT REFERENCES catalog_snapshots(snapshot_id) ON DELETE RESTRICT,
  payload BLOB NOT NULL,
  payload_hash TEXT NOT NULL,
  previous_operation_hash TEXT,
  operation_hash TEXT NOT NULL UNIQUE,
  device_signature BLOB NOT NULL,
  committed_at_ms INTEGER NOT NULL,
  UNIQUE (device_id, identity_epoch, sequence)
) STRICT;

CREATE TABLE outbox (
  outbox_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE REFERENCES operations(operation_id) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK (state IN ('QUEUED','IN_FLIGHT','ACKNOWLEDGED','MANUAL_REVIEW')),
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  next_attempt_at_ms INTEGER,
  last_safe_error_code TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE TABLE acknowledgements (
  acknowledgement_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE REFERENCES operations(operation_id) ON DELETE RESTRICT,
  server_sequence INTEGER,
  disposition TEXT NOT NULL CHECK (disposition IN ('ACKNOWLEDGED','ACCEPTED_WITH_EXCEPTION','MANUAL_REVIEW','REJECTED_NOT_COMMITTED')),
  acknowledgement_payload BLOB NOT NULL,
  received_at_ms INTEGER NOT NULL
) STRICT;

CREATE TABLE canonical_mappings (
  entity_type TEXT NOT NULL,
  local_id TEXT NOT NULL,
  canonical_id TEXT NOT NULL,
  operation_id TEXT NOT NULL REFERENCES operations(operation_id) ON DELETE RESTRICT,
  mapped_at_ms INTEGER NOT NULL,
  PRIMARY KEY (entity_type, local_id),
  UNIQUE (entity_type, canonical_id)
) STRICT;

CREATE TABLE sync_cases (
  case_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE REFERENCES operations(operation_id) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK (state IN ('OPEN','ESCALATED','RESOLVED')),
  safe_reason_code TEXT NOT NULL,
  server_evidence BLOB,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE TABLE audit_records (
  audit_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  operation_id TEXT REFERENCES operations(operation_id) ON DELETE RESTRICT,
  payload BLOB NOT NULL,
  previous_audit_hash TEXT,
  audit_hash TEXT NOT NULL UNIQUE,
  created_at_ms INTEGER NOT NULL
) STRICT;

CREATE TABLE compaction_checkpoints (
  checkpoint_name TEXT PRIMARY KEY,
  acknowledged_through_ms INTEGER NOT NULL,
  server_policy_version TEXT NOT NULL,
  evidence_hash TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_orders_shift_state ON orders(local_shift_id, state);
CREATE INDEX idx_order_lines_order ON order_lines(local_order_id);
CREATE INDEX idx_print_jobs_state ON print_jobs(state, created_at_ms);
CREATE INDEX idx_operations_sequence ON operations(device_id, identity_epoch, sequence);
CREATE INDEX idx_outbox_state_retry ON outbox(state, next_attempt_at_ms);
CREATE INDEX idx_audit_operation ON audit_records(operation_id);

CREATE TRIGGER immutable_operation_update
BEFORE UPDATE ON operations BEGIN
  SELECT RAISE(ABORT, 'immutable operation evidence');
END;
CREATE TRIGGER immutable_operation_delete
BEFORE DELETE ON operations BEGIN
  SELECT RAISE(ABORT, 'immutable operation evidence');
END;

CREATE TRIGGER immutable_cash_evidence_update
BEFORE UPDATE OF local_order_id,currency,amount_due_minor,cash_received_minor,change_minor,evidence_payload,evidence_hash,committed_at_ms
ON cash_settlements BEGIN
  SELECT RAISE(ABORT, 'immutable cash evidence');
END;
CREATE TRIGGER immutable_cash_evidence_delete
BEFORE DELETE ON cash_settlements BEGIN
  SELECT RAISE(ABORT, 'immutable cash evidence');
END;

CREATE TRIGGER immutable_committed_order_update
BEFORE UPDATE OF local_shift_id,catalog_snapshot_id,currency,service_type,subtotal_minor,tax_minor,total_minor,created_at_ms,committed_at_ms
ON orders WHEN OLD.immutable_committed = 1 BEGIN
  SELECT RAISE(ABORT, 'immutable committed order');
END;
CREATE TRIGGER immutable_committed_order_delete
BEFORE DELETE ON orders WHEN OLD.immutable_committed = 1 BEGIN
  SELECT RAISE(ABORT, 'immutable committed order');
END;
CREATE TRIGGER immutable_committed_line_update
BEFORE UPDATE ON order_lines
WHEN (SELECT immutable_committed FROM orders WHERE local_order_id = OLD.local_order_id) = 1 BEGIN
  SELECT RAISE(ABORT, 'immutable committed order line');
END;
CREATE TRIGGER immutable_committed_line_delete
BEFORE DELETE ON order_lines
WHEN (SELECT immutable_committed FROM orders WHERE local_order_id = OLD.local_order_id) = 1 BEGIN
  SELECT RAISE(ABORT, 'immutable committed order line');
END;
CREATE TRIGGER immutable_committed_modifier_update
BEFORE UPDATE ON order_modifiers
WHEN (SELECT o.immutable_committed FROM orders o JOIN order_lines l ON l.local_order_id=o.local_order_id WHERE l.local_line_id=OLD.local_line_id) = 1 BEGIN
  SELECT RAISE(ABORT, 'immutable committed modifier');
END;
CREATE TRIGGER immutable_committed_modifier_delete
BEFORE DELETE ON order_modifiers
WHEN (SELECT o.immutable_committed FROM orders o JOIN order_lines l ON l.local_order_id=o.local_order_id WHERE l.local_line_id=OLD.local_line_id) = 1 BEGIN
  SELECT RAISE(ABORT, 'immutable committed modifier');
END;

CREATE TRIGGER immutable_print_document_update
BEFORE UPDATE ON print_documents BEGIN
  SELECT RAISE(ABORT, 'immutable print document');
END;
CREATE TRIGGER immutable_print_document_delete
BEFORE DELETE ON print_documents BEGIN
  SELECT RAISE(ABORT, 'immutable print document');
END;

CREATE TRIGGER immutable_audit_update
BEFORE UPDATE ON audit_records BEGIN
  SELECT RAISE(ABORT, 'immutable audit record');
END;
CREATE TRIGGER immutable_audit_delete
BEFORE DELETE ON audit_records BEGIN
  SELECT RAISE(ABORT, 'immutable audit record');
END;
