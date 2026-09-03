CREATE TABLE terminal_authority (
  terminal_id TEXT NOT NULL,
  credential_epoch INTEGER NOT NULL CHECK (credential_epoch > 0),
  property_id TEXT NOT NULL,
  outlet_id TEXT NOT NULL,
  register_id TEXT NOT NULL,
  trust_key_id TEXT NOT NULL,
  trust_public_key BLOB NOT NULL CHECK (length(trust_public_key) = 32),
  configuration_payload BLOB NOT NULL,
  lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN ('PAIRED','REVOKED')),
  is_current INTEGER NOT NULL CHECK (is_current IN (0,1)),
  revocation_generation INTEGER NOT NULL CHECK (revocation_generation >= 0),
  paired_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (terminal_id, credential_epoch)
) STRICT;

CREATE TABLE authorization_bundles (
  bundle_id TEXT PRIMARY KEY,
  terminal_id TEXT NOT NULL,
  credential_epoch INTEGER NOT NULL CHECK (credential_epoch > 0),
  generation INTEGER NOT NULL CHECK (generation > 0),
  lease_id TEXT NOT NULL UNIQUE,
  property_id TEXT NOT NULL,
  outlet_id TEXT NOT NULL,
  register_id TEXT NOT NULL,
  shift_id TEXT NOT NULL,
  business_date TEXT NOT NULL,
  catalog_version TEXT NOT NULL,
  catalog_digest TEXT NOT NULL,
  issued_at_ms INTEGER NOT NULL,
  not_before_ms INTEGER NOT NULL,
  refresh_after_ms INTEGER NOT NULL,
  hard_expires_at_ms INTEGER NOT NULL,
  revocation_generation INTEGER NOT NULL CHECK (revocation_generation >= 0),
  max_operation_count INTEGER NOT NULL CHECK (max_operation_count >= 0),
  max_gross_minor INTEGER NOT NULL CHECK (max_gross_minor >= 0),
  max_cash_minor INTEGER NOT NULL CHECK (max_cash_minor >= 0),
  used_operation_count INTEGER NOT NULL DEFAULT 0 CHECK (used_operation_count >= 0 AND used_operation_count <= max_operation_count),
  used_gross_minor INTEGER NOT NULL DEFAULT 0 CHECK (used_gross_minor >= 0 AND used_gross_minor <= max_gross_minor),
  used_cash_minor INTEGER NOT NULL DEFAULT 0 CHECK (used_cash_minor >= 0 AND used_cash_minor <= max_cash_minor),
  allowed_operations_json TEXT NOT NULL,
  signing_key_id TEXT NOT NULL,
  signed_payload BLOB NOT NULL,
  signature BLOB NOT NULL CHECK (length(signature) = 64),
  state TEXT NOT NULL CHECK (state IN ('STAGED','ACTIVE','EXPIRED','REVOKED','SUPERSEDED')),
  received_at_ms INTEGER NOT NULL,
  CHECK (not_before_ms >= issued_at_ms),
  CHECK (refresh_after_ms >= not_before_ms),
  CHECK (hard_expires_at_ms > refresh_after_ms),
  UNIQUE (terminal_id, credential_epoch, generation)
) STRICT;

CREATE TABLE offline_staff_verifiers (
  bundle_id TEXT NOT NULL REFERENCES authorization_bundles(bundle_id) ON DELETE RESTRICT,
  staff_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  verifier_phc TEXT NOT NULL,
  permissions_json TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  max_attempts INTEGER NOT NULL CHECK (max_attempts > 0),
  base_lockout_ms INTEGER NOT NULL CHECK (base_lockout_ms > 0),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  locked_until_ms INTEGER,
  revoked_at_ms INTEGER,
  last_authenticated_at_ms INTEGER,
  PRIMARY KEY (bundle_id, staff_id)
) STRICT;

CREATE TABLE shift_authority (
  bundle_id TEXT PRIMARY KEY REFERENCES authorization_bundles(bundle_id) ON DELETE RESTRICT,
  shift_id TEXT NOT NULL,
  staff_scope_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('ACTIVE','REVOKED','ENDED')),
  opened_at_ms INTEGER NOT NULL,
  closed_at_ms INTEGER,
  UNIQUE (shift_id, bundle_id)
) STRICT;

CREATE TABLE authorization_clock_anchor (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  server_time_ms INTEGER NOT NULL,
  observed_wall_time_ms INTEGER NOT NULL,
  bundle_generation INTEGER NOT NULL CHECK (bundle_generation > 0),
  updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE TABLE terminal_lifecycle_events (
  event_id TEXT PRIMARY KEY,
  terminal_id TEXT NOT NULL,
  credential_epoch INTEGER NOT NULL,
  revocation_generation INTEGER NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('REVOKED','EPOCH_ADVANCED')),
  signed_payload BLOB NOT NULL,
  signature BLOB NOT NULL CHECK (length(signature) = 64),
  applied_at_ms INTEGER NOT NULL,
  UNIQUE (terminal_id, credential_epoch, revocation_generation)
) STRICT;

CREATE UNIQUE INDEX one_current_authorization_bundle
ON authorization_bundles(terminal_id)
WHERE state IN ('STAGED','ACTIVE');

CREATE UNIQUE INDEX one_current_terminal_authority
ON terminal_authority(is_current)
WHERE is_current = 1;

CREATE INDEX idx_offline_staff_active
ON offline_staff_verifiers(staff_id, expires_at_ms, revoked_at_ms);

CREATE TRIGGER immutable_terminal_binding
BEFORE UPDATE OF terminal_id,credential_epoch,property_id,outlet_id,register_id,trust_key_id,trust_public_key,configuration_payload,paired_at_ms
ON terminal_authority BEGIN
  SELECT RAISE(ABORT, 'immutable terminal binding');
END;

CREATE TRIGGER immutable_authorization_bundle
BEFORE UPDATE OF bundle_id,terminal_id,credential_epoch,generation,lease_id,property_id,outlet_id,register_id,shift_id,business_date,catalog_version,catalog_digest,issued_at_ms,not_before_ms,refresh_after_ms,hard_expires_at_ms,revocation_generation,max_operation_count,max_gross_minor,max_cash_minor,allowed_operations_json,signing_key_id,signed_payload,signature,received_at_ms
ON authorization_bundles BEGIN
  SELECT RAISE(ABORT, 'immutable authorization evidence');
END;

CREATE TRIGGER immutable_authorization_bundle_delete
BEFORE DELETE ON authorization_bundles BEGIN
  SELECT RAISE(ABORT, 'immutable authorization evidence');
END;

CREATE TRIGGER immutable_staff_verifier
BEFORE UPDATE OF bundle_id,staff_id,display_name,verifier_phc,permissions_json,expires_at_ms,max_attempts,base_lockout_ms
ON offline_staff_verifiers BEGIN
  SELECT RAISE(ABORT, 'immutable verifier envelope');
END;

CREATE TRIGGER immutable_staff_verifier_delete
BEFORE DELETE ON offline_staff_verifiers BEGIN
  SELECT RAISE(ABORT, 'immutable verifier envelope');
END;

CREATE TRIGGER immutable_lifecycle_event_update
BEFORE UPDATE ON terminal_lifecycle_events BEGIN
  SELECT RAISE(ABORT, 'immutable lifecycle evidence');
END;
CREATE TRIGGER immutable_lifecycle_event_delete
BEFORE DELETE ON terminal_lifecycle_events BEGIN
  SELECT RAISE(ABORT, 'immutable lifecycle evidence');
END;
