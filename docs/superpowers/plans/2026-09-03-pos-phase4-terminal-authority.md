# Peak POS Phase 4 Terminal Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the Rust-owned pairing/bootstrap, device lifecycle, signed offline authorization staging, durable offline PIN verification, and shift/lease eligibility gate without enabling ordering or settlement.

**Architecture:** Tauri Rust owns device private keys, verification, authorization persistence, PIN attempts, and eligibility decisions. React performs online transport and presentation only, passing opaque signed server envelopes to narrow Rust commands. Because signed catalogs arrive in Phase 5, Phase 4 stages otherwise-valid leases and truthfully reports `CATALOG_REQUIRED`; it never creates placeholder authority or claims offline selling is ready.

**Tech Stack:** Rust 2021, Tauri 2, SQLCipher/rusqlite 0.40.2, ed25519-dalek 3.0.0, argon2 0.6.0, base64 0.23.1, SHA-256, zeroize, React 19, TypeScript, Vitest.

**Spec:** `docs/PEAK_POS_DESKTOP_MASTER_OPERATIONS.md` §§7, 10–13, 19–20, 23–24 and `docs/PEAK_POS_DESKTOP_OFFLINE_SAFETY_MATRIX.md` §§3, 8–9.

## Global Constraints

- Phase 4 does not enable catalog ordering, pricing, order commitment, cash settlement, reconciliation, or printing.
- The current backend lacks the certified offline authorization response; online operation remains available while offline eligibility reports the exact missing prerequisite.
- Device private keys, database keys, PINs, verifier material, signatures, and raw signed payloads never cross Rust-to-React IPC responses or logs.
- Pairing and bootstrap remain online-required. Offline authentication is available only after a previously paired terminal receives and verifies a bounded authorization bundle.
- No reusable server PIN hash or plaintext PIN is stored. Argon2id work occurs only in Rust and failed attempts/lockout commit before a generic result returns.
- A staged lease cannot become transaction authority until Phase 5 installs the exact signed catalog version/digest and every other gate passes.
- Existing online pairing/session behavior remains functional. Missing new backend fields degrade to online-only, never fabricated offline authority.
- Complete OS/root compromise plus stolen keys remains outside the cryptographic prevention boundary.
- No backend migration, merge, or deployment is authorized.

---

### Task 1: Move production device signing behind Rust

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src-tauri/src/identity.rs`
- Modify: `src-tauri/src/lib.rs`
- Create: `src/lib/nativeDeviceAuthority.ts`
- Modify: `src/lib/deviceAuth.ts`
- Modify: `src/lib/deviceIdentity.ts`
- Modify: `src/auth/DeviceSessionProvider.tsx`
- Test: `src-tauri/src/identity.rs`, `src/lib/deviceAuth.test.ts`, `src/auth/DeviceSessionProvider.test.tsx`

**Interfaces:**
- Produces Rust commands `ensure_device_identity`, `sign_device_challenge`, and the existing redacted `device_key_storage_status`.
- Produces TypeScript `DeviceAuthority` with `ensureIdentity()` and `signChallenge(nonce)`; production uses Tauri, tests inject a fake.

- [ ] Write Rust tests proving first boot creates a 32-byte Ed25519 secret only in the keyring adapter, returns only the public key, signs a challenge verifiably, and fails closed when secure storage is unavailable.
- [ ] Run the focused identity tests and confirm failure because the native authority commands do not exist.
- [ ] Add pinned ed25519-dalek and implement generation/signing plus migration of an existing keychain PKCS#8 secret. Preserve legacy files on failure, but never return their private-key field to React.
- [ ] Write frontend tests proving pairing and staff challenge requests use an injected signer without receiving a private key.
- [ ] Run the tests and confirm the old private-key argument/API causes the expected failure.
- [ ] Replace production WebCrypto private-key handling with the native authority adapter while retaining a test-only injected adapter.
- [ ] Run focused Rust and frontend identity/pairing tests to green.

### Task 2: Add schema v2 for staged terminal authorization

**Files:**
- Create: `src-tauri/src/local_store/migrations/0002_terminal_authority.sql`
- Modify: `src-tauri/src/local_store/migrations.rs`
- Test: `src-tauri/src/local_store/migrations.rs`

**Interfaces:**
- Produces schema version 2 tables `terminal_authority`, `authorization_bundles`, `offline_staff_verifiers`, `shift_authority`, and `authorization_clock_anchor`.

- [ ] Write migration tests for v1→v2 atomicity, singleton terminal identity, unique active authorization generation, verifier-to-bundle references, nonnegative attempt counters, and immutable signed payload/signature fields.
- [ ] Run focused migration tests and confirm schema version/table assertions fail at version 1.
- [ ] Implement migration 0002 transactionally. Store signed payload bytes and extracted indexed facts separately; add triggers preventing mutation/deletion of signed evidence while allowing lifecycle status and attempt controls.
- [ ] Verify fresh install and v1 upgrade both reach schema 2 idempotently with foreign keys enabled.

### Task 3: Verify and stage signed bootstrap bundles

**Files:**
- Create: `src-tauri/src/local_store/authority.rs`
- Modify: `src-tauri/src/local_store/mod.rs`
- Modify: `src-tauri/src/local_store/runtime.rs`
- Modify: `src-tauri/src/lib.rs`
- Create: `src/lib/offlineAuthorization.ts`
- Modify: `src/lib/postLoginBootstrap.ts`
- Test: Rust unit/integration tests and `src/lib/postLoginBootstrap.test.ts`

**Interfaces:**
- Consumes `SignedAuthorizationBundle { keyId, payloadB64, signatureB64 }` and the pairing-pinned Ed25519 public key.
- Produces narrow command `stage_offline_authorization` returning only `{ state, hardExpiresAt, staffCount, prerequisite }`.

- [ ] Write tests with fixed signed fixtures covering valid bundle, altered payload, wrong key, terminal/epoch/property/outlet/register mismatch, unsupported protocol/schema, invalid time ordering, excessive Argon2 parameters, and rollback generation.
- [ ] Run focused tests and confirm the authority module/command is missing.
- [ ] Implement domain-separated Ed25519 verification over exact payload bytes, strict serde schemas, applicability checks, bounded Argon2id parameter parsing, and one SQL transaction for bundle/verifier/shift staging.
- [ ] Extend pairing status/session metadata to accept optional credential epoch, property/outlet/register identity, and trust key. If absent, retain online operation and report `BOOTSTRAP_REQUIRED`.
- [ ] Add best-effort online authorization fetch from `POST /api/v1/pos/terminals/{terminalId}/offline-leases`; 404/501 marks the documented backend gap without breaking online login, while malformed or invalid signed responses fail closed and remain visible.
- [ ] Run focused Rust and TypeScript bootstrap tests to green.

### Task 4: Implement durable offline PIN verification

**Files:**
- Create: `src-tauri/src/local_store/offline_pin.rs`
- Modify: `src-tauri/src/local_store/mod.rs`
- Modify: `src-tauri/src/local_store/runtime.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: Rust unit/integration tests

**Interfaces:**
- Produces command `authenticate_offline_staff({ staffId, pin }) -> OfflineAuthenticationResult` with states `AUTHENTICATED`, `DENIED`, `LOCKED`, `EXPIRED`, `REVOKED`, or `NOT_ELIGIBLE`.

- [ ] Write tests proving correct PIN success, generic wrong-PIN failure, durable attempt increment, exponential/server-policy backoff, hard lockout, restart persistence, expiry, revocation, staff/device/lease scoping, and no PIN/verifier in serialized result.
- [ ] Run focused tests and confirm the command is absent.
- [ ] Implement Argon2id PHC verification with zeroized PIN bytes and parameter bounds. Begin an immediate SQL transaction before verification; persist failed attempt/backoff/lockout before returning.
- [ ] On success, reset only policy-permitted counters, persist last-authentication evidence, and return a bounded local session descriptor without verifier material.
- [ ] Verify tests and inspect output to confirm no secret-bearing diagnostics.

### Task 5: Add the shift/lease/catalog eligibility gate and lifecycle reconciliation

**Files:**
- Create: `src-tauri/src/local_store/eligibility.rs`
- Modify: `src-tauri/src/local_store/authority.rs`
- Modify: `src-tauri/src/local_store/runtime.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: Rust unit/integration tests

**Interfaces:**
- Produces commands `offline_eligibility_status` and `apply_terminal_lifecycle_event`.
- Returns safe gate states `ELIGIBLE`, `BOOTSTRAP_REQUIRED`, `DEVICE_REVOKED`, `STORAGE_UNHEALTHY`, `LEASE_NOT_YET_VALID`, `LEASE_EXPIRED`, `CLOCK_ROLLBACK`, `SHIFT_REQUIRED`, `SHIFT_MISMATCH`, `CATALOG_REQUIRED`, `STAFF_REQUIRED`, or `LIMIT_EXHAUSTED`.

- [ ] Write table-driven tests for every gate state and precedence, including a Phase 4 valid staged lease returning `CATALOG_REQUIRED` when the exact active catalog is absent.
- [ ] Run focused tests and confirm no evaluator exists.
- [ ] Implement a pure evaluator fed only by Rust-read durable facts, conservative system/server clock anchors, and server-supplied ceilings; do not accept React assertions of connectivity, time, shift, catalog, or permission.
- [ ] Implement signed revocation/epoch advancement handling that immediately invalidates local authentication, retains immutable evidence, and never silently resets terminal sequence identity.
- [ ] Verify gate/lifecycle tests and restart behavior.

### Task 6: Integrate honest lock-screen lifecycle UX

**Files:**
- Modify: `src/auth/DeviceSessionProvider.tsx`
- Modify: `src/pages/PairingScreen.tsx`
- Modify: `src/pages/PinUnlock.tsx`
- Modify: `src/components/ConnectivityIndicator.tsx`
- Modify: `src/auth/DeviceSessionProvider.test.tsx`
- Modify: `src/pages/PinUnlock.test.tsx`

**Interfaces:**
- Consumes safe native authority/authentication/gate results.
- Preserves the existing online unlock path; on network failure only, checks native offline authentication and presents the authoritative prerequisite. Phase 4 deliberately keeps the shell locked even if the gate is otherwise eligible because the Phase 5 local catalog/order workspace does not exist yet.

- [ ] Write interaction tests for paired online unlock, eligible offline unlock, offline denial, durable lockout copy, revoked terminal, expired lease, catalog-required online-only state, restart returning locked, and keyboard/touch PIN behavior.
- [ ] Run focused tests and confirm the UI lacks the new lifecycle states.
- [ ] Add calm operational status/copy using existing Peak Terminal primitives. Do not create a second ordering interface or expose raw protocol detail.
- [ ] Ensure a process restart never publishes an authenticated staff session automatically and missing backend authorization never blocks online login.
- [ ] Run focused accessibility and interaction tests to green.

### Task 7: Phase gate verification and separate commit

**Files:**
- Modify: this plan with executed checkboxes/evidence.

**Interfaces:**
- Produces one reviewable Phase 4 commit and stops before Phase 5.

- [ ] Run `bun run typecheck`, `bun run lint`, `bun run test`, and `bun run build`.
- [ ] Run `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`, and `cargo check`.
- [ ] Run `git diff --check` and audit that there is no catalog activation, order/cash mutation, reconciliation, printing implementation, generic SQL IPC, secret-bearing response, backend migration, merge, or deployment.
- [ ] Launch the actual Tauri app under Xvfb; confirm the process remains running and keyring/storage failure is redacted rather than fatal.
- [ ] Commit separately with message `feat: establish terminal offline authority gate`.
- [ ] Report the commit SHA, tests, Tauri evidence, backend-gap behavior, and platform/security release gates. Stop before Phase 5.

## Execution evidence

- Implemented all Phase 4 native authority boundaries and frontend adapters described above.
- Focused tests cover key custody/signing, legacy-key migration, schema v2, signature tampering, epoch/generation rollback, Argon2id parameter bounds, durable PIN backoff/lockout, eligibility precedence, signed revocation, backend-gap behavior, and presentation-only UI handling.
- Frontend verification: typecheck and lint pass; 126 tests pass with 6 intentionally skipped when run serially; production build passes. The default highly parallel Vitest invocation exhausted worker startup capacity on this host, while the identical serial suite completed green.
- Rust verification: formatting and clippy with warnings denied pass; 38 tests pass across unit/integration suites; SQLCipher provenance and fail-closed key tests remain green.
- Actual Tauri binary launched under Xvfb and remained running until the bounded 45-second certification harness stopped it. Only expected headless EGL acceleration warnings were emitted.
- No Phase 5 catalog activation, local ordering, cash mutation, synchronization, reconciliation, or printing protocol was introduced.
