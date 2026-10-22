-- Separate from offline financial print_jobs; retain tombstones forever.
-- Capacity exhaustion fails closed instead of evicting duplicate protection.
CREATE TABLE native_print_attempts (
 job_key TEXT NOT NULL,
 attempt INTEGER NOT NULL CHECK(attempt > 0),
 property_id TEXT NOT NULL,
 outlet_id TEXT NOT NULL,
 terminal_id TEXT NOT NULL,
 route_hash TEXT NOT NULL,
 payload_hash TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('RESERVED','UNKNOWN','ACCEPTED','NOT_SENT')),
 error TEXT,
 PRIMARY KEY(job_key, attempt)
);
