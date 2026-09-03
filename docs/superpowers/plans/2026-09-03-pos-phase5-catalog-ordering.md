# Peak POS Phase 5 Signed Catalog and Local Ordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a verified signed catalog the sole pricing authority for a Rust-owned, durable local order-draft and order-commit path.

**Architecture:** React sends narrow catalog/order intents and renders Rust-returned views. Rust verifies exact signed catalog bytes against the pairing-pinned trust key, atomically activates only the snapshot named by the current authorization bundle, calculates integer-money totals, persists drafts, and commits an immutable signed `ORDER_COMMIT` plus outbox row. Phase 6 will transport/reconcile that unchanged operation; Phase 5 never sends it through legacy order REST endpoints.

**Tech Stack:** Rust 2021, Tauri 2, SQLCipher/rusqlite 0.40.2, ed25519-dalek 3.0.0, SHA-256, serde, React 19, TypeScript, TanStack Query, Vitest.

**Spec:** `docs/PEAK_POS_DESKTOP_MASTER_OPERATIONS.md` §§8, 10, 12–14, 23; `docs/PEAK_POS_DESKTOP_ACTION_MATRIX.md` CAT-01–06 and ORD-01–10; `docs/PEAK_POS_DESKTOP_OFFLINE_SAFETY_MATRIX.md` catalog/order rows.

## Global Constraints

- The active signed/versioned local snapshot is the only authority for product, modifier, availability, tax, and total facts.
- Rust uses checked integer smallest-unit money plus a three-letter uppercase currency; floating point is prohibited.
- React never computes committed prices, modifier totals, tax, subtotal, or total.
- Draft edits are durable local state and do not require sequence/outbox evidence until commitment.
- `ORDER_COMMIT` allocates sequence, updates immutable domain state, signs evidence, and inserts the outbox row in one immediate SQL transaction.
- Online and offline order commitment use this same local command; Phase 6 owns transport and acknowledgement.
- Missing/invalid signed catalog contracts remain fail-closed `BACKEND GAP` conditions; legacy catalog JSON is not promoted into certified authority.
- Phase 5 does not implement cash settlement, Room Charge, reconciliation transport, Sync Center, or printing.
- No backend migration, merge, or deployment is authorized.

---

### Task 1: Add schema v3 catalog projections and durable order context

**Files:**
- Create: `src-tauri/src/local_store/migrations/0003_catalog_ordering.sql`
- Modify: `src-tauri/src/local_store/migrations.rs`
- Test: `src-tauri/src/local_store/migrations.rs`

**Interfaces:**
- Produces immutable projection tables `catalog_service_types`, `catalog_categories`, `catalog_products`, `catalog_modifier_groups`, and `catalog_modifier_options` keyed by `snapshot_id`.
- Adds nullable draft context/evidence fields `staff_id`, `table_label`, `notes`, `version`, `order_number`, and `sync_state` to `orders`; Phase 5 code refuses missing values rather than relying on migration defaults.

- [ ] Write a migration test that expects schema version 3, foreign-key-linked catalog projections, uniqueness within a snapshot, indexed normalized search, and immutable projection triggers.
- [ ] Run `cargo test local_store::migrations::tests::catalog_ordering_migration` and confirm it fails at schema 2.
- [ ] Add migration 0003 and advance the sequential migration runner without modifying committed migration 0001/0002 semantics.
- [ ] Re-run all migration and encrypted-restart tests to green.

### Task 2: Verify and atomically activate signed catalog snapshots

**Files:**
- Create: `src-tauri/src/local_store/catalog.rs`
- Modify: `src-tauri/src/local_store/mod.rs`
- Modify: `src-tauri/src/local_store/runtime.rs`
- Modify: `src-tauri/src/lib.rs`
- Create: `src-tauri/tests/signed_catalog.rs`

**Interfaces:**
- Consumes `SignedCatalogSnapshot { key_id, digest, payload_b64, signature_b64 }`.
- Verifies signature over `peak-pos-catalog-snapshot-v1\0 || digest || \0 || exact_payload_bytes`.
- Produces `install_catalog_snapshot(envelope, received_at_ms) -> CatalogActivationResult` and command `install_catalog_snapshot`.
- The strict payload includes protocol/schema, snapshot/version, property/outlet, currency, validity, tax mode, service types, categories, products, modifier groups, and options.

- [ ] Write fixed-key integration tests for valid activation, altered payload, wrong digest/signature/key, property/outlet mismatch, version/digest mismatch with the staged lease, expired/not-yet-valid snapshot, duplicate IDs, dangling relationships, unsupported tax mode, unavailable required modifier option, and idempotent exact replay.
- [ ] Run `cargo test --test signed_catalog` and confirm failure because the types/method are absent.
- [ ] Implement strict decoding, SHA-256 digest verification, domain-separated Ed25519 verification, applicability/validity checks, relationship validation, and bounded counts/string lengths.
- [ ] In one immediate transaction insert immutable snapshot bytes and projections, replace `active_catalog`, and change only the exact matching `authorization_bundles` row from `STAGED` to `ACTIVE`.
- [ ] Re-run signed-catalog, eligibility, restart, and SQLCipher tests to green.

### Task 3: Implement local catalog reads, normalized search, and deterministic pricing

**Files:**
- Create: `src-tauri/src/local_store/pricing.rs`
- Modify: `src-tauri/src/local_store/catalog.rs`
- Modify: `src-tauri/src/local_store/runtime.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/local_store/pricing.rs`, `src-tauri/tests/signed_catalog.rs`

**Interfaces:**
- Produces command `get_local_catalog(query, category_id) -> LocalCatalogView`.
- Produces pure `price_line(product_price_minor, modifier_deltas, quantity, tax_rate_bp, tax_mode) -> PricedLine` using checked `i128` intermediates and half-up integer division.
- Supports only `EXCLUSIVE` and `INCLUSIVE`; every unsupported/overflowing/negative-result calculation fails closed.

- [ ] Write literal table-driven pricing tests for zero tax, 18% exclusive, 18% inclusive, modifier deltas, quantity, half-unit rounding, negative-result rejection, and overflow rejection.
- [ ] Run focused pricing tests and confirm the module is absent.
- [ ] Implement checked integer calculation and immutable pricing-evidence serialization.
- [ ] Write catalog-read tests proving category filtering, case/whitespace-normalized local search across product name/code, stable configured ordering, unavailable-product exclusion, and complete modifier constraints.
- [ ] Implement indexed projection reads and run focused tests to green.

### Task 4: Implement durable Rust-owned order drafts

**Files:**
- Create: `src-tauri/src/local_store/orders.rs`
- Modify: `src-tauri/src/local_store/mod.rs`
- Modify: `src-tauri/src/local_store/runtime.rs`
- Modify: `src-tauri/src/lib.rs`
- Create: `src-tauri/tests/local_orders.rs`

**Interfaces:**
- Produces `get_or_create_order_draft`, `update_order_context`, `add_order_item`, `set_order_line_quantity`, `remove_order_line`, `get_order_draft`, and `discard_empty_order_draft` commands.
- Every command accepts IDs/selections only; Rust loads the active catalog, validates staff/shift/lease/service type/modifier constraints, prices, persists, increments draft version, and returns `LocalOrderView`.

- [ ] Write integration tests for durable first draft, restart recovery, configured service type/context, plain item add, modifier min/max/group ownership/availability, quantity update, line removal, stale draft version, wrong staff/shift/catalog, and totals recalculation.
- [ ] Run `cargo test --test local_orders` and confirm the intent API is absent.
- [ ] Implement CSPRNG local IDs, immediate transactions, optimistic draft version checks, catalog-derived snapshots/evidence, and complete view reads.
- [ ] Re-run local-order and signed-catalog tests to green.

### Task 5: Commit one immutable signed order operation and outbox row

**Files:**
- Modify: `src-tauri/src/local_store/orders.rs`
- Modify: `src-tauri/src/identity.rs`
- Modify: `src-tauri/src/local_store/runtime.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/tests/local_orders.rs`

**Interfaces:**
- Produces `commit_order(order_id, expected_version, now_ms, signer) -> LocalOrderView` and Tauri command `commit_order`; staff and lease identity come only from the Rust-owned authenticated session.
- Signs `peak-pos-operation-v1\0 || operation_hash_bytes` using the Rust/keyring-owned device key.
- Inserts immutable canonical JSON payload, payload hash, previous hash, operation hash, sequence, signature, and `QUEUED` outbox row atomically with order commitment and lease ceiling consumption.

- [ ] Write tests proving one commit creates exactly one operation/outbox row, sequence/hash continuity across two orders, exact retry idempotency, stale/expired/revoked/catalog/permission/limit refusal, signer failure rollback, restart durability, and committed-line immutability.
- [ ] Run the commit tests and confirm failure because no commit implementation exists.
- [ ] Expose only a crate-private raw byte signer from the identity vault; no private key or secret-bearing response crosses IPC.
- [ ] Implement canonical payload hashing, sequence allocation, device signature, order immutability, authorization counter update, and outbox insert inside one transaction.
- [ ] Re-run local-order, identity, eligibility, and migration tests to green.

### Task 6: Bootstrap the certified catalog and expose a narrow frontend adapter

**Files:**
- Create: `src/lib/localPosCore.ts`
- Create: `src/lib/localPosCore.test.ts`
- Modify: `src/lib/postLoginBootstrap.ts`
- Modify: `src/lib/postLoginBootstrap.test.ts`
- Modify: `src/auth/DeviceSessionProvider.tsx`

**Interfaces:**
- Produces `LocalPosCore` methods mirroring only the native commands from Tasks 2–5.
- After a lease stages with `catalogVersion`, bootstrap requests `GET /api/v1/pos/catalog/snapshots/{version}`, passes the opaque envelope to Rust, and optionally posts a safe activation acknowledgement.
- Missing snapshot/acknowledgement routes report `BACKEND_GAP`; they never activate the legacy `/api/v1/pos/catalog` response.

- [ ] Write adapter tests for exact command/argument mapping and absence of SQL/private material.
- [ ] Write bootstrap tests for opaque snapshot installation, missing snapshot backend gap, invalid native verification, 401 expiry, and non-blocking missing acknowledgement.
- [ ] Run the tests and confirm the adapter/bootstrap extension is absent.
- [ ] Implement the native adapter and bootstrap sequence; extend safe bootstrap state without placing catalog payload/signature in React state.
- [ ] Re-run provider/bootstrap tests to green.

### Task 7: Move New Order from React/REST calculations to Rust-returned state

**Files:**
- Create: `src/hooks/useLocalOrder.ts`
- Create: `src/hooks/useLocalOrder.test.tsx`
- Modify: `src/pages/NewOrder.tsx`
- Modify: `src/pages/NewOrder.test.tsx`
- Modify: `src/components/ItemModifierDialog.tsx`
- Modify: `src/components/ItemModifierDialog.test.tsx`
- Modify: `src/hooks/usePosData.ts`

**Interfaces:**
- `useLocalCatalog` and `useLocalDraft` call `LocalPosCore`; TanStack Query caches views, not authority.
- New Order renders `LocalOrderView` money/totals and invokes one native intent per tap/stepper/context/commit.
- Modifier UI returns only selected IDs and quantity; it may display signed per-option deltas but never sums a price.

- [ ] Replace the New Order interaction test with a real local-core fake whose returned views contain literal Rust-authoritative totals; assert the UI renders those totals and never calls REST create/add.
- [ ] Run focused tests and confirm current React cart/REST behavior fails the new expectations.
- [ ] Implement local hooks, pending/error states, local search field, restart draft recovery, catalog/lease unavailable state, and locally-secured/waiting-to-sync confirmation.
- [ ] Remove React modifier/product/quantity total arithmetic and unused New Order REST mutation hooks; preserve touch targets, focus behavior, persistent rail, and three-click composition.
- [ ] Re-run New Order, modifier, terminal primitive, and accessibility tests to green.

### Task 8: Verify and commit the Phase 5 gate

**Files:**
- Modify: this plan with execution evidence.

**Interfaces:**
- Produces one reviewable Phase 5 commit and stops before Phase 6.

- [ ] Run `npm run typecheck`, `npm run lint`, `npm test -- --fileParallelism=false`, and `npm run build`.
- [ ] Run `cargo fmt --all -- --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`, and `cargo check`.
- [ ] Audit that no cash settlement, reconciliation transport, printing protocol, generic SQL IPC, backend migration, merge, or deployment was introduced.
- [ ] Launch the actual Tauri application under Xvfb and verify the process remains alive; capture safe catalog-unavailable behavior where the backend contract is absent.
- [ ] Commit with message `feat: add signed catalog and local ordering core`.
- [ ] Report the commit SHA, verification evidence, exact backend gaps, and remaining Phase 6 release blockers. Stop before Phase 6.

## Execution evidence — 2026-09-03

- Schema v3 adds immutable signed-catalog projections and upgrades a real v2-shaped store sequentially without replaying prior migrations.
- Rust tests cover signed snapshot activation/replay/fail-closed applicability, indexed local search, integer pricing/overflow, native-authenticated staff and lease binding, catalog expiry/clock rollback, durable order intents, atomic outbox commitment, signer rollback, SQLCipher restart/key behavior, and terminal authority. Final suite: 49 passed.
- Frontend tests prove native command mapping, signed snapshot bootstrap, native-authoritative total rendering, and absence of New Order REST create/add calls. Final suite: 128 passed, 6 intentionally skipped.
- `cargo fmt --check`, strict Clippy, TypeScript typecheck, Oxlint, Vite production build, and real Tauri launch all passed. The actual desktop binary reached `Running target/debug/peak-pos-desktop` under Xvfb; only the expected headless EGL/DRI acceleration warnings were emitted.
- Independent Phase 5 review findings were resolved before the final gates: webview-supplied staff identity was removed from order intents, the Rust core now requires a live native-authenticated staff/lease session for every draft mutation, same-catalog lease refresh activates atomically, clock/catalog bounds fail closed, modifier totals use checked arithmetic, and recovered order context hydrates the UI.
- The signed lease and signed catalog snapshot endpoints remain explicit backend gaps. Phase 5 does not claim transport/reconciliation, offline cash, or durable printing.
