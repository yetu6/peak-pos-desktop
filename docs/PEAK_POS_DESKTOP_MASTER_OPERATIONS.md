# Peak POS Desktop — Master Operations Specification

> **Superseded by [PEAK_TERMINAL_MASTER_OPERATIONS.md](./PEAK_TERMINAL_MASTER_OPERATIONS.md)** for product, operator-flow, UX, lifecycle, and acceptance decisions. Retained for historical engineering detail and phase context.

Status: **Proposed canonical V1 specification — review required**

Design language: **Peak Terminal**

Last updated: 2026-09-02

This document defines the product, interaction, application, security, persistence, synchronization, and certification contract for Peak POS Desktop. It is normative for the terminal. `PEAK_HOSPITALITY_MASTER_OPERATIONS.md` remains authoritative for cross-product capability, Room Charge, management oversight, and business-date ownership.

Companion specifications:

- [Peak POS Desktop Action Matrix](./PEAK_POS_DESKTOP_ACTION_MATRIX.md)
- [Peak POS Desktop Offline Safety Matrix](./PEAK_POS_DESKTOP_OFFLINE_SAFETY_MATRIX.md)
- [Peak POS Desktop Printing Specification](./PEAK_POS_DESKTOP_PRINTING_SPEC.md)

No broad implementation may begin until these four specifications are reviewed. Documentation status does not imply that a `BACKEND GAP` exists in production.

## 1. Normative language and classification

`MUST`, `MUST NOT`, `SHOULD`, and `MAY` are normative.

Every product operation is assigned one delivery classification:

- **CURRENT / V1** — supported by a current authoritative contract and retained in V1, although its client UX or hardening may still require work.
- **BACKEND GAP** — required for V1 but not supported by the current authoritative backend contract. The terminal MUST NOT simulate it with frontend-only behavior.
- **DEFERRED** — intentionally outside V1.

Connectivity eligibility is separate from delivery classification and is defined in the Offline Safety Matrix.

## 2. Locked product boundary

Peak POS Desktop is a paired, auditable, offline-capable hospitality transaction terminal for restaurant, bar, café, and hotel outlet use. It is not a general web-management dashboard.

V1 MUST support:

- paired terminal identity and revocation;
- staff selection and PIN authentication;
- pre-established shifts and opening float;
- authoritative catalog, categories, products, and modifiers;
- dine-in, takeaway, and room-service order context where configured;
- order capture, line mutation, server-compatible pricing, and lifecycle;
- exact single-tender settlement;
- certified offline cash sales within a valid authorization envelope;
- recorded external tenders online where the backend contract supports them;
- conditional online Room Charge;
- receipts, reprints, KOT/prep printing, and durable print jobs;
- cash movements, shift count/variance/close, and correct business-date ownership;
- persistent synchronization status, reconciliation, and terminal diagnostics;
- restart-safe local operational history and evidence.

The following remain online-required in V1: Room Charge and stay/folio lookup, mobile-money/card/provider processing, device pairing, catalog and access administration, Day Close/business-date advancement, and other cross-module or externally verified financial operations.

Split tender, refunds, promotions, tips, a general service-charge engine, inventory/recipes, expanded KDS, arbitrary offline financial mutations, and TRA EFD/VFD fiscal issuance are deferred unless separately specified and certified.

## 3. Governing principles

1. One dominant operational job per screen.
2. Frequent intents take no more than three navigational or decision interactions from their natural context, except for intrinsic safety confirmation.
3. PostgreSQL becomes the central system of record after reconciliation; the local ledger is durable operational evidence while disconnected.
4. Offline cash is a real locally committed settlement, never a payment draft.
5. All offline-capable order/cash mutations use one Rust-owned transaction path online and offline.
6. React renders authoritative results from the Rust core and never calculates financial outcomes.
7. No browser storage is authoritative for identity, orders, money, shifts, leases, catalog, printing, or synchronization.
8. Realtime improves freshness; durable snapshots, reconciliation, and acknowledgements establish truth.
9. No fake capability, success state, payment processing, synchronization status, or destructive accounting history.
10. Final certification runs the packaged Tauri application.

## 4. Current-state audit and gaps

The audited application is React/Vite in Tauri with REST APIs, a native WebSocket command, keyring-backed device identity, OS `lp` printing, and React Query. The current shell technically fills the window, but its content behaves like a narrow web dashboard.

### 4.1 Current strengths

- One-time pairing request, terminal-generated Ed25519 identity, and keyring support.
- Online PIN session, shift, catalog, order, settlement, receipt, Room Charge, cash-movement, Day Close, and realtime contracts.
- Mutation idempotency keys and order-version checks on current online APIs.
- Immutable server receipt/reprint concepts and a backend print-job foundation.
- Existing unit, Rust, and journey-test scaffolding.

### 4.2 Product and UX findings

- The dark theme uses excessive evergreen, translucent panels, gradients, and glow; surface hierarchy is weak.
- New Order underuses large viewports, uses a generic page/grid composition, and lacks the required stable terminal geometry.
- The order rail is visually a floating card rather than the permanent transactional anchor.
- Active Orders is a card wall instead of a dense list/detail tool.
- Modifier, settlement, cash, void, and receipt dialogs lack one coherent sheet/result language and frequently undershoot touch targets.
- Settlement does not make tender choice, cash received, change, local commitment, and synchronization outcome sufficiently explicit.
- Connectivity currently describes a WebSocket phase rather than end-to-end storage/outbox/server health.
- Pairing, lock, setup, and error states use narrow decorative panels and lack the complete startup/recovery state machine.
- Current theme and operational cursors use browser `localStorage`; the shift pointer is also kept there.

### 4.3 Local/Tauri findings

- No transactional local database, catalog snapshot, offline lease, durable order ledger, operation sequence, outbox, conflict store, or acknowledgement store exists.
- Cash/order mutation paths call REST directly and cannot survive restart safely.
- Printing has no durable device-local queue, profile/routing model, immutable render snapshot, or ambiguous-outcome state.
- Current Tauri CSP and shell permissions require least-privilege review.
- The window has no enforced minimum 1024×768 terminal size.
- The identity fallback may write a plaintext key file; production behavior must be replaced by an explicit fail-closed secure-store policy.

### 4.4 Backend findings

- Current backend documentation prohibits offline order/payment mutation.
- Catalog responses are not immutable, signed, versioned lease-bound snapshots.
- No offline lease issuance, device-sequence registry, signed mutation envelope, ordered reconciliation endpoint, acknowledgement ledger, canonical ID mapping, or exception ledger exists.
- Current printing supports a limited global outlet queue rather than durable terminal routing and the complete document contract.
- Shift close lacks all desired variance/reason and supervisor UX contracts.
- Realtime backfill used by the desktop has certification evidence of a missing/incorrect route.
- Current staff session data is insufficient for the desired human-readable terminal context.

These missing protocols are `BACKEND GAP` requirements; they do not reduce V1 scope.

### 4.5 Audit validation baseline

At the specification audit point:

- TypeScript type-check passed.
- Rust tests passed 10/10.
- Vitest reported 109 passing, 1 failing, and 6 skipped tests across 27 passing, 1 failing, and 2 skipped files. The failure was the pending-pairing restart test in `DeviceSessionProvider.test.tsx`, where its expected first poll had not occurred when asserted.
- Existing certification artifacts include Tauri launch evidence, but physical printer certification was not completed.
- Existing realtime certification records an event-backfill request returning 404.
- Browser/Vite screenshots provide useful layout evidence but do not certify native storage, secure-store, printing, or offline recovery.

These are baseline findings, not changes authorized by this documentation phase.

## 5. Peak Terminal design system

Peak Terminal is modern, premium, restrained, dark-first, touch-first, fast, accessible, high-density without clutter, and operational rather than decorative.

### 5.1 Semantic tokens

The implementation MUST define semantic tokens before route redesign. Candidate values are subject to automated WCAG contrast verification:

| Token | Candidate | Use |
|---|---:|---|
| `background` | `#0C110F` | Application foundation |
| `surface` | `#131916` | Primary workspace |
| `surface-raised` | `#1A221E` | Rails, sheets, dialogs |
| `surface-interactive` | `#222C27` | Rows, tiles, inputs |
| `border` | `#344039` | Structural separation |
| `foreground` | `#F3F5F1` | Primary text |
| `foreground-muted` | `#A8B1AB` | Secondary information |
| `foreground-subtle` | `#78847D` | Tertiary metadata |
| `primary` | `#17704F` | Evergreen primary interaction |
| `primary-hover` | `#20845F` | Evergreen hover/pressed emphasis |
| `primary-subtle` | `#102B22` | Quiet selected/action background |
| `gold-accent` | `#C8A45D` | Selective Peak detail |
| `warning` | `#D49A35` | Warning |
| `danger` | `#D65E61` | Destructive/error |
| `success` | `#319A87` | Success, distinct from brand green |
| `focus` | `#E1BD70` | Keyboard focus outline |

Inter is the general UI typeface. Geist Mono is limited to IDs, references, devices, and order numbers. Money uses tabular numerals. Controls use approximately 8px radii, product tiles 10px, panels 10–12px, and sheets 12–14px.

Glassmorphism, neon/glow, gradient-heavy styling, billboard tiles, giant card walls, and gratuitous animation are prohibited. Motion is approximately 100ms for interaction and 140–180ms for overlays and respects reduced motion.

### 5.2 Interaction primitives

One component language covers product tile, category tab, order line, order rail, quantity stepper, modifier sheet, tender tile, money input/keypad, operational status, shift/connectivity indicator, receipt/result, destructive confirmation, and every empty/loading/error/revoked/offline state.

All primitives MUST define touch, keyboard, focus, disabled, loading, offline-unavailable, permission-denied, and error behavior. Status is never communicated by color alone.

Minimum targets:

- normal control: at least 44px;
- frequent action: 48–56px;
- product tile: 72–96px;
- tender tile: 56–72px.

WCAG 2.2 AA is mandatory. The larger target guidance is a product requirement beyond the minimum target-size criterion. Focus appearance, order, labeling, contrast, reduced motion, and screen-reader names are certified.

### 5.3 Interaction-reference findings

External products inform interaction mechanics only; Peak Terminal does not copy their visual identity.

- Square documents editable POS menu groups/tiles, density choices, single-select modifier auto-progression, and explicit grid synchronization semantics: [menu organization](https://squareup.com/help/us/en/article/7804-organize-your-menu-with-square-for-restaurants), [item-detail density and auto-progression](https://squareup.com/help/ca/en/article/8634-customize-item-details-settings), and [grid synchronization](https://squareup.com/help/us/en/article/8668-sync-your-item-grid-across-locations).
- Lightspeed K-Series documents a central register composition with order summary, keypad, and configured menu, plus dense order management: [Register screen](https://k-series-support.lightspeedhq.com/hc/en-us/articles/360050328394-Understanding-the-Register-screen) and [Order management](https://k-series-support.lightspeedhq.com/hc/en-us/articles/360050328594-Understanding-the-Order-management-screen).
- Toast documents menu/group/modifier hierarchy, explicit publish/resync behavior, device theme, grid dimensions, and high-volume modifier presentation: [menus](https://support.toasttab.com/en/article/Get-Started-With-Menus), [publishing](https://doc.toasttab.com/doc/platformguide/platformPublishingOverview.html), and [device setup](https://support.toasttab.com/en/article/Device-Setup-Overview-1493004445768).
- Shopify documents a centrally managed, reorderable smart grid for frequent products and actions: [smart-grid management](https://help.shopify.com/en/manual/sell-in-person/shopify-pos/customize-pos/smart-grid-management/edit).
- Accessibility acceptance uses [WCAG 2.2](https://www.w3.org/TR/WCAG22/), including [target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum) and [focus appearance](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html).

Design review MUST compare Peak Terminal with current Square, Lightspeed, and Toast reference captures side by side at equivalent 1024×768, 1280×800, 1366×768, and 1440×900 content areas. Evaluation criteria are spatial clarity, touch density, persistent transaction context, CTA hierarchy, modifier tap count, settlement clarity, accessibility, and large-screen efficiency—not pixel similarity. Capture date, product/version where known, viewport, and source must accompany evidence.

## 6. Information architecture and responsive shell

The stable shell is:

```text
navigation/context rail | flexible operational workspace | persistent order rail
```

Primary terminal destinations:

- Orders: Active Orders, New Order;
- Shift: status, cash movements, close shift;
- Status: Sync Center, device, catalog, printers, safe diagnostics;
- Lock/Switch Staff.

Management of catalogs, devices, users/access, reporting, and reconciliation exceptions belongs in Hospitality Web.

> **Superseded:** `PEAK_TERMINAL_MASTER_OPERATIONS.md` §5.2–5.3, §30, and §41 resolve this in the other direction — Manager and Kitchen/Service Display are locked-in, first-class Terminal modes (role/workflow-gated, per `PEAK_POS_DESKTOP_ACTION_MATRIX.md` ORD-14), not destinations to be removed. The Terminal manager workspace and kitchen/service surface are retained and finished, not deleted.

| Viewport | Navigation | Order rail | Catalog |
|---|---:|---:|---|
| 1024×768 | compact/icon, about 72px | 300–320px | 4 columns when labels permit |
| 1280×800 | about 170–180px | about 340px | 4–5 columns |
| 1366×768 | about 175px | 350–370px | about 5 columns |
| 1440×900 | about 180px | 370–390px | 5–6 columns |
| larger | bounded navigation/rail | bounded rail | add columns; cap useful tile width |

The application MUST enforce/support 1024×768 as its minimum window, avoid internal fixed canvases, preserve the order rail at supported desktop sizes, and prevent giant tiles on large screens.

## 7. Startup and terminal lifecycle

Startup shows a short functional Peak screen only while real initialization runs. The state machine is:

```text
STARTING
→ secure-store/database health
→ identity and pairing
→ revocation/configuration
→ network and reconciliation
→ LOCKED
→ staff authentication
→ shift/lease eligibility
→ READY
```

Explicit states are `STARTING`, `UNPAIRED`, `PAIRING_PENDING`, `PAIRING_APPROVED`, `BOOTSTRAPPING`, `PAIRED_ONLINE`, `PAIRED_OFFLINE_ALLOWED`, `REVOKED`, `LOCAL_STORAGE_ERROR`, `SYNC_CONFLICT`, `LOCKED`, `STAFF_AUTHENTICATED`, `SHIFT_REQUIRED`, and `READY`. Each state MUST provide an honest recovery action.

### 7.1 Pairing

Pairing is online-required and uses a short-lived, one-time code/QR. Hospitality Web displays safe device metadata and binds organization/property/outlet/register. Approval returns configuration and a long-term device credential distinct from the pairing code. Reassignment/revocation is management-controlled. React never receives private keys.

### 7.2 Staff and PIN

Online login uses the backend PIN/session contract. Offline login is allowed only for a paired device, eligible cached staff, valid device/staff/shift/catalog lease, healthy secure store, and cached policy permission.

The offline credential is a server-issued, device-bound, time-bounded verifier envelope, not a persisted reusable server PIN hash. Its verifier uses an approved Argon2id-compatible construction with server-selected parameters and salt, is encrypted under the terminal key model, and is scoped to staff/device/lease/policy epoch. Attempts, backoff, and lockout are durable. Expired/revoked envelopes are securely removed. Reconciliation immediately locks suspended/revoked staff.

No user is auto-logged-in after process restart. Offline restart returns to the staff picker/PIN gate. Low-entropy PINs do not resist an attacker with full terminal/root and device-key compromise; this is an explicit physical security boundary requiring device custody, revocation, bounded leases, monitoring, and operational response.

### 7.3 Shift

V1 offline selling requires an eligible shift opened online and bound into the offline lease. Brand-new offline shift creation is not required. Restart during an eligible offline shift restores the durable shift context after authentication.

Shift open, closing count, final close, and Day Close remain online-required in V1. Closing count MAY be saved as a local draft but MUST NOT be represented as a closed shift until acknowledged by the server.

### 7.4 Screen and recovery map

| Screen/state | Dominant job | Required composition/action |
|---|---|---|
| Starting | Establish safe terminal state | Brief progress tied to real initialization; storage failure/recovery is explicit |
| Unpaired/Pairing | Bind terminal securely | Code, QR, countdown, instructions, regenerate/help; approved assignment summary |
| Locked/Staff | Identify operator | Property/outlet/register/status, staff grid/search, PIN keypad, safe failure/lockout |
| Shift required | Establish online shift | Business date/context, opening float/zero shortcut, Open Shift |
| New Order | Build current check | Stable shell, order context/search/categories/grid/order rail |
| Modifier sheet | Complete item decision | Item/price, sequential groups, quantity, supported note, Add |
| Active Orders | Find/resume work | Dense filterable list and selected detail; direct New Order empty action |
| Settlement | Commit one tender | Large amount due, eligible tender tiles, received/change, explicit confirm |
| Result/Receipt | Confirm truth and continue | Local/server settlement state, print state, receipt/reprint, next order |
| Shift/Cash | Operate drawer/close | Shift facts, online cash movements, count/variance/approval/close |
| Sync Center | Understand local/server state | Waiting/saved/acknowledged/conflict/unavailable/retry facts |
| Status/Printers | Diagnose terminal | Safe identity/config/lease/catalog/storage/printer health and tests |
| Revoked/Expired/Error | Recover safely | Clear consequence, retained-evidence assurance, only legitimate recovery actions |

## 8. Ordering model

### 8.1 New Order

The flagship composition contains order type/context, local search, stable category navigation, a responsive product grid, and a persistent order rail. Only configured order types appear. Room-service destination is distinct from Room Charge tender.

Product selection with no modifiers adds immediately. A side sheet handles modifiers on wide terminals. Required single-select groups MAY auto-progress when a choice fully satisfies the group and no safety ambiguity exists. Min/max, availability, and price deltas come only from the active signed catalog.

The order rail shows durable local state, line-level details, totals, lifecycle, and one dominant contextual CTA. It MUST explicitly say whether an operation is locally secured, waiting to sync, acknowledged, or in review.

### 8.2 Pricing and money

The Rust transaction core calculates product price, modifier delta, supported tax components, subtotal, total, amount received, and change from the active signed/versioned catalog snapshot. React only submits intent and renders returned values.

Money is stored and transported as integer smallest units plus ISO currency. Floating-point financial arithmetic is prohibited. Unsupported tax/service rules fail closed; the terminal never invents prices or tax claims.

### 8.3 Lifecycle

Local presentation states and server states are mapped explicitly rather than conflated. A conceptual local flow is:

```text
LOCAL_DRAFT → COMMITTED_LOCAL/SYNC_PENDING → ACKNOWLEDGED_OPEN
→ SENT/PREPARING/READY/SERVED (where supported)
→ SETTLED/CLOSED
```

Legitimate branches include `VOIDED`, `CORRECTION_REQUIRED`, and `SYNC_REVIEW`. Current server lifecycle values remain authoritative after acknowledgement. Historical line, modifier, price, tax, and receipt facts are immutable.

Active Orders uses the available workspace as a dense list/detail view with filters, order type/context, staff, age, item count, total, lifecycle, settlement, and synchronization status. Its empty state includes a direct New Order action.

## 9. Settlement and tender

Settlement emphasizes amount due, tender availability, received amount, change, commitment, printing, and next action.

The common cash path is `Settle → Cash → Confirm`. Quick cash values and exact cash are available. The Rust core returns calculated change. The result screen remains stable and identifies both settlement status and synchronization status.

Cash is offline-capable within a certified lease. Mobile money, card/provider, bank/provider, Room Charge, and other externally verified tender operations are unavailable offline. If Peak only records an external method rather than processing it, the UI MUST say so truthfully.

Room Charge is available only online for a same-property, active in-house stay with an eligible open folio, matching currency, effective permission/session, and idempotency. One POS settlement maps to exactly one folio posting.

## 10. Rust-owned local transaction core

React uses narrow intent commands such as `add_order_item`, `commit_order`, `settle_cash`, `commit_offline_cash_sale`, `get_sync_state`, and `retry_print`. Generic SQL access from React and a sidecar architecture are prohibited in V1.

The same Rust mutation path handles offline-capable order/cash operations online and offline. Online normally means its durable outbox entry is synchronized immediately. Offline means the identical committed operation remains queued. There is no separate REST-direct implementation of those business transactions.

The encrypted SQLite store contains, at minimum:

- schema/migration and integrity metadata;
- terminal identity/configuration and secure-anchor references;
- signed leases and offline staff envelopes;
- immutable catalog snapshots and activation metadata;
- active shift/business context;
- orders, lines, modifiers, totals, and local/server ID mappings;
- immutable settlements and cash evidence;
- receipt/KOT document snapshots;
- printer profiles, jobs, attempts, and outcomes;
- device sequence, operation envelopes, and transactional outbox;
- acknowledgements, conflicts, exceptions, and audit records.

Every mutation atomically allocates the next sequence, updates domain state, appends required immutable evidence, creates a signed outbox envelope, creates required print jobs, and commits before success is shown.

### 10.1 Atomic offline cash-sale commitment

An order created and settled entirely offline culminates in one immutable composite operation, normatively named `OFFLINE_CASH_SALE_COMMIT`. It contains the final order, lines, modifiers, pricing/tax evidence, catalog identity, staff/shift/business context, cash received/change, settlement evidence, document references, and component hashes.

Reconciliation MUST create the server order and cash settlement atomically in one PostgreSQL transaction, or retain the entire composite in an exception/manual-review path. Partial order/payment ingestion is prohibited. Earlier local editing operations need not be imported as separate financial server mutations once superseded by this final composite.

## 11. Local database encryption and recovery

The V1 encrypted-database mechanism is **SQLCipher**. Implementation is blocked until an ADR records the maintained Rust integration, pinned SQLCipher version/build provenance, platform packaging, licensing, upgrade process, and verification evidence. Substituting another mechanism requires security review and a specification amendment. Homemade encryption and plaintext production fallback are prohibited.

The mechanism contract is:

- generate a 256-bit database key with the operating-system CSPRNG on the terminal;
- store/wrap it in OS secure storage, never React or ordinary configuration;
- bind access to the installed terminal identity where platform facilities permit;
- store versioned current/next key envelopes in OS secure storage and perform rotation through an exclusive, backed-up, interruption-tested SQLCipher rekey workflow;
- reopen the rekeyed database and pass SQLCipher integrity/schema checks before promoting the next key and deleting the protected recovery copy;
- never export keys in diagnostics, logs, backups, or support bundles;
- fail closed in production if the key is missing, invalid, inaccessible, or mismatched;
- distinguish wrong-key, corruption, migration failure, disk-full, and integrity failure without exposing secrets;
- preserve the database for controlled recovery rather than silently recreating it;
- test first boot, restart, rotation, interrupted rotation, wrong key, lost key, corruption, migration, backup/restore policy, and secure-store unavailability.

Recovery from a lost encryption key is management-led reprovisioning. Unreconciled evidence may be unrecoverable; the terminal MUST clearly disclose that consequence and MUST NOT silently pair as the old identity or reset sequence authority.

## 12. Operation identity, integrity, and threat boundary

Operation identity is `device_id + identity_epoch + monotonic_sequence`. Allocation occurs inside the same database transaction as the mutation. Envelopes include device, property, outlet, register, staff, shift, business date, lease, catalog version/digest, schema/type, payload hash, previous-operation hash, local time, server-time anchor, and device signature.

PostgreSQL stores the last accepted sequence per device/epoch and enforces uniqueness. Local secure anchors retain the highest sequence/hash where platform storage makes this feasible. Reconciliation detects gaps, reuse, stale epochs, rollback, and replay.

Encryption, signatures, hash chains, and sequences detect/restrict many forms of tampering and accidental rollback. They do not defeat complete OS/root compromise combined with device-key theft or arbitrary rollback of all local anchors. Complete terminal compromise is a separate operational security boundary addressed by physical custody, least privilege, short leases, server ceilings, revocation, anomaly review, key rotation, and incident response. The specification MUST NOT claim cryptographic prevention beyond this boundary.

## 13. Offline authorization envelope

The backend issues a signed, bounded lease containing device/credential epoch, property/outlet/register, eligible staff and permissions, pre-established shift, business date, catalog version/digest, permitted operation types, cash-only offline tender scope, issue/refresh/hard-expiry times, protocol/schema versions, revocation generation, and configurable count/value/cash ceilings.

Offline commitment fails closed when any required lease dimension is invalid, the database is unhealthy, sequence continuity is uncertain, the active snapshot does not match, staff authorization fails, a ceiling is exhausted, or clock rollback is suspected. Existing evidence remains readable and printable.

Production values for duration and ceilings require Product/Security review and MUST be server policy, not hard-coded client constants.

## 14. Catalog authority

The backend publishes immutable signed snapshots with version, publication/validity, applicability, currency/tax rules, category/product/modifier rules and availability, deterministic digest, and server signature. A snapshot is fully downloaded, verified, and stored before atomic activation.

Transactions retain their catalog version/digest and all customer-visible pricing facts. A snapshot cannot be compacted while retained transactions, documents, queued operations, or review cases reference it. Catalog invalidation triggers download when online; a published backend change is not reported as synchronized to a terminal until terminal acknowledgement exists.

## 15. Reconciliation contract

Reconnect performs authoritative refresh plus ordered outbox synchronization. Offline envelopes are not replayed through ad hoc current REST sequences. The dedicated reconciliation API authenticates the device, validates signature/lease/catalog/sequence/hash, deduplicates, applies accepted operations transactionally, retains evidence, and returns a durable acknowledgement and local-to-canonical ID map.

Permitted outcomes:

- `ACKNOWLEDGED` — committed normally by the server;
- `ALREADY_APPLIED` — identical operation already committed;
- `RETRYABLE` — no final decision; safe to resend unchanged;
- `REJECTED_NOT_COMMITTED` — only when neither a local irreversible event nor server commit occurred and the wording is factually correct;
- `ACCEPTED_WITH_EXCEPTION` — evidence committed to server exception accounting;
- `MANUAL_REVIEW_REQUIRED` — evidence retained intact pending authorized management action.

Once irreversible local cash evidence commits, reconciliation may acknowledge, accept with exception, or require manual review. It MUST NOT semantically rewrite the physical cash event as nonexistent. A lost response and repeated retries cannot duplicate order or settlement state.

Hospitality Web requires a future/appropriate **POS Reconciliation** management surface for exception evidence, sequencing/lease/catalog context, investigation, notes, and authorized disposition. This is a cross-contract `BACKEND GAP`/Hospitality Web requirement, not a cashier administration feature. The terminal shows only operational status, safe evidence, retry, reprint, and escalation guidance.

### 15.1 Required POS-owned backend contract

Exact route names may follow existing API naming conventions, but V1 requires these resources and semantics under the property-scoped POS API:

| Contract | Required behavior |
|---|---|
| `POST .../terminals/{terminalId}/offline-leases` | Issue/refresh signed device/staff/shift/catalog/business-date lease after current authorization and exposure checks |
| `GET .../catalog/snapshots/{version}` | Return immutable signed complete snapshot, digest, validity and applicability |
| `POST .../terminals/{terminalId}/catalog-acknowledgements` | Prove verified local activation of a version/digest |
| `POST .../terminals/{terminalId}/reconciliation` | Accept an ordered signed envelope batch; return a durable per-operation outcome and canonical mappings |
| `GET .../terminals/{terminalId}/reconciliation/{operationId}` | Recover a final outcome after response loss without generating a new operation |
| `GET .../terminals/{terminalId}/sync-snapshot` | Return current terminal epoch/revocation, lease policy, last sequence/hash, shift/date, catalog target and outstanding cases |
| `GET .../pos-reconciliation-cases/{caseId}` and authorized disposition actions | Support Hospitality Web investigation without terminal-side financial editing |

Logical PostgreSQL persistence MUST include:

- immutable catalog snapshot/version/digest/signature metadata;
- issued offline leases and their policy/revocation generations;
- terminal credential epochs and last accepted sequence/hash;
- one immutable operation registry row per device/epoch/sequence with payload hash and final outcome;
- atomic order/settlement import and local-to-canonical mappings;
- submitted offline evidence retained independently of normal business rows;
- reconciliation cases, evidence, notes, authorized dispositions, and audit;
- catalog activation acknowledgements and terminal sync health.

Database uniqueness MUST cover operation ID, `(device_id, identity_epoch, sequence)`, and local entity mappings. An identical retry returns the stored result. The same identity with a different payload hash is a security conflict. No migration number is assigned until isolated backend work begins and concurrent migration ownership is checked.

## 16. Synchronization UX

Persistent states are `Live`, `Reconnecting`, `Offline · N waiting`, and `Sync issue`. One interaction opens Sync Center.

Sync Center shows last successful contact/acknowledgement, queued mutations, locally secured actions, print health, lease/catalog/shift status, conflicts, unavailable offline operations, and retry/reconciliation state. It distinguishes network reachability, outbox health, server acknowledgement, and conflict health.

The terminal never leaves the cashier uncertain whether an order or settlement was saved. Automatic retry uses unchanged operation identity and payload.

## 17. Printing

Printing is a native, durable subsystem specified in the companion Printing Specification. Orders and settlements do not roll back because printing fails.

Physical printing is not exactly-once. Job states include `OUTCOME_UNKNOWN` for transport/crash ambiguity. An ambiguous KOT is never automatically printed again. Manual kitchen copies are marked `DUPLICATE`; customer receipt copies are marked `REPRINT`.

Documents are rendered from immutable local snapshots so eligible KOT, customer receipt, and reprint work offline. Printer profiles and routing are device-local and safely synchronized/configured as specified.

## 18. Cash, shift close, and business date

Cash in/out is immutable and online-required for initial V1 unless its own certified offline protocol is later added; offline cash-sale authorization does not imply arbitrary cash-movement authorization.

Shift close displays expected cash, counted cash, variance, actor, and consequence. Required supervisor approval and variance reason must be authoritative. The terminal cannot claim closure before server acknowledgement.

POS-only Day Close requires all shifts closed and advances once. Hybrid properties do not expose POS Day Close; Lodging Night Audit owns business-date advancement and must block while any POS shift is open.

## 19. Error and recovery language

Every workflow defines loading, empty, offline, reconnecting, waiting, conflict, session expired, staff/terminal revoked, lease expired, catalog stale, printer offline, print ambiguous/failed, shift required/closed, business-date conflict, order/payment conflict, server unavailable, permission denied, and local-storage failure states.

Messages use business language and safe reference IDs. SQL errors, constraints, stack traces, panic output, tokens, keys, raw credentials, and provider internals are never shown.

## 20. Security baseline

- Strict, narrow Tauri IPC commands; no generic database or command execution.
- Restrictive CSP and no arbitrary remote navigation.
- Private keys, database keys, PIN material, and long-lived credentials stay outside React.
- Hardened file permissions and vetted encrypted SQLite.
- Automatic lock, session expiry, durable offline attempt controls, revocation reconciliation.
- Minimized guest/tender data and redacted structured logs.
- Safe diagnostic bundles with secrets excluded.
- Signed upgrade/version policy; unsupported vulnerable builds may be denied new leases.
- Cash drawer pulse only after eligible cash commitment and only through certified printer/profile support.

## 21. Retention and compaction

Retention durations are server-configured policy and subject to accounting/privacy requirements. The local core MUST:

- never purge unacknowledged, retryable, exception, or manual-review operations;
- never purge referenced catalog snapshots or immutable print/receipt evidence;
- retain acknowledgements and canonical mappings long enough to prove deduplication and support audit;
- compact only acknowledged, retention-expired data inside a crash-safe transaction;
- create a signed/hashed compaction checkpoint preserving sequence and hash-chain continuity;
- remove expired offline PIN/verifier envelopes, session secrets, obsolete leases, and other sensitive authorization material promptly when not needed for audit;
- keep only the minimum guest/external-reference data required for operations and audit;
- pause compaction on integrity error, uncertain server retention, or unresolved reference;
- expose storage pressure before it threatens transaction safety and fail closed before disk exhaustion corrupts commitment.

## 22. Three-click certification

| Intent | Natural context | Interaction path | Target |
|---|---|---|---:|
| Add simple item | New Order | Item | 1 |
| Add modified item | New Order | Item → choices → Add | 3 |
| Resume order | Active Orders | Order | 1 |
| Cash settlement | Order rail | Settle → Cash → Confirm | 3 |
| Room Charge | Order rail | Settle → Room Charge → eligible stay | 3 + safety confirmation if required |
| Cash out | Shift | Cash → Cash out → Confirm | 3 |
| Reprint | Order/receipt | Reprint | 1–2 |
| Sync detail | Any operational screen | Connectivity status | 1 |

Repeated line entry is not navigation depth. Safety confirmation is never removed to satisfy the target.

## 23. Phased delivery gates

1. Specifications and review.
2. Peak Terminal shell, tokens, primitives, responsive geometry.
3. Rust encrypted store, migrations, narrow commands, integrity/recovery tests.
4. Pairing/bootstrap, device lifecycle, offline verifier, shift/lease gate.
5. Signed catalog snapshots and local ordering/pricing path.
6. Composite offline cash commitment and backend reconciliation/exception contracts.
7. Active Orders, settlement/result, Sync Center, Room Charge online path.
8. Durable printing, profiles, routing, documents, ambiguity recovery.
9. Cash/shift/business-date online operations and web reconciliation cross-contract.
10. Security, accessibility, performance, crash/restart, and real-Tauri certification.

Each phase requires implementation, tests, evidence, review, and an explicit gate. Backend work occurs only in an isolated `fbc-peak` worktree and must not touch concurrently owned authorization/identity migrations or production.

## 24. V1 release blockers and certification

Offline cash/order certification is a V1 release blocker until backend protocol, encrypted local persistence, reconciliation, security review, and real-Tauri tests are green.

Certification includes:

- first and returning boot, pairing, revocation, staff PIN, session expiry, shift open/resume;
- every supported viewport and keyboard/touch/accessibility behavior;
- authoritative catalog update/invalidation and offline search;
- online sale, external recorded tender, Room Charge exact-once folio posting;
- network loss during order, continued eligible operation, offline cash commitment;
- process/power interruption at each SQLite and printing boundary;
- offline restart, local PIN, recovered order/settlement/history;
- reconnect, lost acknowledgements, repeated/out-of-order retries, and no duplicate order/payment;
- stale/expired lease, catalog conflict, revocation reconciliation, database rollback/corruption, wrong/missing key, disk full;
- server acknowledgement, exception/manual review, and final clean Sync Center;
- printer unplug, crash after send, `OUTCOME_UNKNOWN`, safe KOT handling, marked duplicate/reprint;
- cash movements, count, variance, close shift, POS-only Day Close, and hybrid Night Audit blocking.

Browser/Vite evidence is supplemental only. Physical printer paths require representative hardware certification; mocks alone are insufficient.

## 25. Definition of done

Peak POS V1 is complete only when a real paired terminal can execute the full online business-day journey and the certified offline cash journey without ambiguity, duplicate mutation, invented authority, destructive history, or manual database repair. The cashier interface remains simple and stable while the local core, server reconciliation, and management exception surfaces preserve financial truth.
