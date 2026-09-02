# Peak POS Desktop — Action Matrix

Status: **Proposed canonical V1 checklist — review required**

Last updated: 2026-09-02

This matrix is the machine/checklist-friendly inventory of terminal actions. It must be read with the [Master Operations Specification](./PEAK_POS_DESKTOP_MASTER_OPERATIONS.md), [Offline Safety Matrix](./PEAK_POS_DESKTOP_OFFLINE_SAFETY_MATRIX.md), and [Printing Specification](./PEAK_POS_DESKTOP_PRINTING_SPEC.md).

## 1. Classification keys

Delivery:

- `CURRENT / V1`: authoritative current contract exists and remains in V1.
- `BACKEND GAP`: V1-required authoritative contract is missing or insufficient.
- `DEFERRED`: outside V1.

Connectivity:

- `ONLINE + OFFLINE`: supported through the same certified local path in either state.
- `OFFLINE ONLY WITH CERTIFIED PROTOCOL`: product target, disabled until that protocol is certified.
- `ONLINE REQUIRED`: fail closed without authoritative online service.

`Current evidence` describes the audited baseline, not proof of V1 certification.

## 2. Startup, device, staff, and shift

| ID | Intent/action | Natural context | Target path | Delivery | Connectivity | Current evidence / required authority | V1 acceptance |
|---|---|---|---|---|---|---|---|
| BOOT-01 | Start terminal | Application launch | Automatic | CURRENT / V1 | ONLINE + OFFLINE | Tauri app boots; complete state machine absent | Secure store checked before identity/business state; no decorative delay |
| BOOT-02 | Recover local state after crash/restart | Startup | Automatic | BACKEND GAP | OFFLINE ONLY WITH CERTIFIED PROTOCOL | No transactional local store | Durable orders, settlements, outbox, print jobs, sequence, shift and lease recover atomically |
| DEV-01 | Configure API/bootstrap endpoint | First install/support | Setup | CURRENT / V1 | ONLINE REQUIRED | Current setup screen/config | Authorized safe endpoint only; not ordinary cashier workflow |
| DEV-02 | Request pairing code/QR | Unpaired | Pair terminal | CURRENT / V1 | ONLINE REQUIRED | Pairing request/poll exists | One-time short expiry, countdown, safe metadata, QR/code |
| DEV-03 | Approve/reject pairing | Hospitality Web | Registers & Devices | CURRENT / V1 | ONLINE REQUIRED | Backend pairing approval exists | Authorized web review binds property/outlet/register/device |
| DEV-04 | Complete bootstrap | Pairing approved | Automatic | BACKEND GAP | ONLINE REQUIRED | Partial current credential/config only | Signed catalog, terminal policy, staff envelopes and offline lease downloaded atomically |
| DEV-05 | Revoke terminal | Hospitality Web / active terminal | Revoke | CURRENT / V1 | ONLINE REQUIRED | Backend revocation contract exists | Online terminal locks promptly; offline reconciles revocation and locks |
| DEV-06 | Reassign terminal | Hospitality Web | Revoke/re-pair | CURRENT / V1 | ONLINE REQUIRED | Management contract exists/partial | Old credential epoch invalidated; terminal cannot self-reassign |
| DEV-07 | View safe terminal status | Status | Status | CURRENT / V1 | ONLINE + OFFLINE | Diagnostics page exists | Human IDs, version, connection, lease, catalog, storage, printers; no secrets |
| DEV-08 | Export safe diagnostics | Status | Diagnostics → Export | BACKEND GAP | ONLINE + OFFLINE | No complete redacted bundle | Secrets/PIN/PII excluded; includes safe refs, versions and health |
| AUTH-01 | View/search eligible staff | Lock screen | Staff/search | CURRENT / V1 | ONLINE + OFFLINE | Online roster exists; no certified cache | Human names/roles from authoritative snapshot |
| AUTH-02 | Authenticate PIN online | Lock screen | Staff → PIN → Confirm | CURRENT / V1 | ONLINE REQUIRED | Server Argon2 PIN session exists | Generic failure, rate limit, effective capability/session |
| AUTH-03 | Authenticate PIN offline | Lock screen | Staff → PIN → Confirm | BACKEND GAP | OFFLINE ONLY WITH CERTIFIED PROTOCOL | No offline verifier envelope | Device/lease-bound Argon2id verifier, durable attempts/lockout, no long-lived server hash |
| AUTH-04 | Lock/switch staff | Any screen | Lock/Switch | CURRENT / V1 | ONLINE + OFFLINE | Switch action exists | One persistent action; pending work remains durable; no auto-login after restart |
| AUTH-05 | Enforce session expiry/revocation | Any screen | Automatic lock | CURRENT / V1 | ONLINE + OFFLINE | Expiry exists; offline revocation bounded by lease | Irreversible commit completes safely; next action requires auth; reconnect reconciles revocation |
| SHIFT-01 | Open shift and record float | Shift required | Amount/Zero → Open | CURRENT / V1 | ONLINE REQUIRED | Backend/API/UI exist | Authoritative business date/register/staff; exact integer money |
| SHIFT-02 | Resume pre-established shift | After PIN | Resume | CURRENT / V1 | OFFLINE ONLY WITH CERTIFIED PROTOCOL | Online resume exists; local recovery absent | Offline only when lease binds active shift; restart recovery certified |
| SHIFT-03 | Create brand-new shift offline | Shift required offline | None | DEFERRED | ONLINE REQUIRED | Not supported | V1 explains reconnect requirement; never fabricates open shift |
| SHIFT-04 | View shift/expected cash | Shift | Shift status | CURRENT / V1 | ONLINE + OFFLINE | Online shift read exists | Offline view labeled as last-authoritative plus local pending cash sales |
| SHIFT-05 | Capture closing count draft | Close shift | Count → Save draft | CURRENT / V1 | ONLINE + OFFLINE | Current UI is online/memory-oriented | Local draft may persist but never says shift closed |
| SHIFT-06 | Close shift | Shift | Count → Review variance → Confirm | CURRENT / V1 | ONLINE REQUIRED | Backend close exists | Expected/count/variance visible; server acknowledgement required |
| SHIFT-07 | Approve material variance | Close shift | Supervisor PIN → Confirm | CURRENT / V1 | ONLINE REQUIRED | Backend supervisor mechanism exists; UI incomplete | Distinct supervisor, reason/evidence and no hidden variance |

## 3. Catalog and ordering

| ID | Intent/action | Natural context | Target path | Delivery | Connectivity | Current evidence / required authority | V1 acceptance |
|---|---|---|---|---|---|---|---|
| CAT-01 | Download/activate catalog snapshot | Bootstrap/reconnect | Automatic | BACKEND GAP | ONLINE REQUIRED | Current unversioned catalog response | Immutable signed version/digest, complete verification, atomic activation |
| CAT-02 | Browse categories/products | New Order | Category/product grid | CURRENT / V1 | ONLINE + OFFLINE | Online catalog/grid exists | Uses active local snapshot; responsive density; unavailable facts explicit |
| CAT-03 | Search catalog | New Order | Search | CURRENT / V1 | ONLINE + OFFLINE | Search absent | Fully local normalized search; no network dependency |
| CAT-04 | Use favorites/quick grid | New Order | Quick category | BACKEND GAP | ONLINE + OFFLINE | No managed quick layout contract | Only when configuration has authoritative terminal layout; otherwise omit |
| CAT-05 | Manage/publish catalog | Hospitality Web | Catalog | CURRENT / V1 | ONLINE REQUIRED | Cross-product management responsibility | Version changes; terminal acknowledgements distinguish publish from sync |
| CAT-06 | Acknowledge terminal catalog version | Background | Automatic | BACKEND GAP | ONLINE REQUIRED | No terminal acknowledgement contract | Backend can report exactly which terminal activated which version |
| ORD-01 | Start local draft | New Order | New Order | CURRENT / V1 | ONLINE + OFFLINE | Current cart is React memory | Durable local order ID and state before irreversible work |
| ORD-02 | Select order/service type | New Order | Type | CURRENT / V1 | ONLINE + OFFLINE | Static current options | Only configured backend-supported types; snapshot/context retained |
| ORD-03 | Set table/location/destination | New Order | Context input | CURRENT / V1 | ONLINE + OFFLINE | Table field exists | Required by configured type; room service is not Room Charge |
| ORD-04 | Add item without modifiers | New Order | Product | CURRENT / V1 | OFFLINE ONLY WITH CERTIFIED PROTOCOL | Current React then REST path | Rust prices and persists line/outbox atomically |
| ORD-05 | Configure modifiers | Modifier sheet | Choices → Add | CURRENT / V1 | OFFLINE ONLY WITH CERTIFIED PROTOCOL | Current modal supports groups | Snapshot min/max/delta enforced; optional safe single-select auto-progress |
| ORD-06 | Change line quantity | Order rail | Line → stepper | CURRENT / V1 | OFFLINE ONLY WITH CERTIFIED PROTOCOL | Current dialog/local behavior partial | Rust validates and recalculates integer totals |
| ORD-07 | Remove open line | Order rail | Line → Remove → Confirm if required | CURRENT / V1 | OFFLINE ONLY WITH CERTIFIED PROTOCOL | Backend remove endpoint exists | Versioned/audited; no deletion of settled facts |
| ORD-08 | Add order note/line note | Order rail/modifier sheet | Note → Save | CURRENT / V1 | OFFLINE ONLY WITH CERTIFIED PROTOCOL | Partial/unclear backend support | Show only where authoritative schema supports; otherwise omit |
| ORD-09 | Commit open order online | Order rail | Create/Send | BACKEND GAP | OFFLINE ONLY WITH CERTIFIED PROTOCOL | Current REST sequence is non-atomic and separate | Single Rust ledger/outbox path, immediate normal sync |
| ORD-10 | Commit open order offline | Order rail | Create/Send | BACKEND GAP | OFFLINE ONLY WITH CERTIFIED PROTOCOL | Prohibited today | Lease/catalog/shift/staff validation and signed durable operation |
| ORD-11 | Send order to preparation/KOT | Order rail | Send | CURRENT / V1 | ONLINE + OFFLINE | Server send and print job exist | Local lifecycle/document durable; server state reconciled without duplicate KOT |
| ORD-12 | View active orders | Active Orders | Order list | CURRENT / V1 | ONLINE + OFFLINE | Current card grid/server query | Dense local+server merged list/detail with explicit sync state |
| ORD-13 | Open/resume order | Active Orders | Select order | CURRENT / V1 | ONLINE + OFFLINE | Current detail/dialog behavior | Local ID remains stable; canonical mapping transparent |
| ORD-14 | Advance preparation status | Certified prep/KDS context | Status action | CURRENT / V1 | ONLINE REQUIRED | Backend states/Kitchen page exist | Only exposed if terminal role/workflow is certified; no expanded KDS claim |
| ORD-15 | Void open order | Order detail | Void → reason → Confirm | CURRENT / V1 | ONLINE REQUIRED | Backend void exists | Permission, reason, actor and immutable evidence; no refund implication |
| ORD-16 | Void/remove settled history | Order detail | None | DEFERRED | ONLINE REQUIRED | Not legitimate deletion | Refund/correction specification required; historical settlement never deleted |
| ORD-17 | Correct order after settlement | Order detail | Correction | DEFERRED | ONLINE REQUIRED | No proven complete contract | Dedicated compensating workflow required; not disguised as edit/void |

## 4. Settlement and receipts

| ID | Intent/action | Natural context | Target path | Delivery | Connectivity | Current evidence / required authority | V1 acceptance |
|---|---|---|---|---|---|---|---|
| PAY-01 | Review amount due/tenders | Order rail | Settle | CURRENT / V1 | ONLINE + OFFLINE | Current settlement dialog exists | Rust-supplied due; unavailable tenders disabled with reason |
| PAY-02 | Calculate cash received/change | Cash settlement | Amount/quick key | BACKEND GAP | ONLINE + OFFLINE | React currently calculates/displays | Integer money calculated and validated in Rust |
| PAY-03 | Commit cash settlement online | Cash settlement | Cash → Confirm | BACKEND GAP | ONLINE + OFFLINE | Current direct REST payment | Same Rust ledger/outbox operation used in all connectivity states |
| PAY-04 | Commit cash settlement on acknowledged order offline | Cash settlement | Cash → Confirm | BACKEND GAP | OFFLINE ONLY WITH CERTIFIED PROTOCOL | Prohibited today | Immutable local settlement; signed operation; clear pending status |
| PAY-05 | Commit order+cash sale entirely offline | Cash settlement | Cash → Confirm | BACKEND GAP | OFFLINE ONLY WITH CERTIFIED PROTOCOL | No composite protocol | One immutable `OFFLINE_CASH_SALE_COMMIT`; atomic server order+settlement or whole exception |
| PAY-06 | Record mobile-money settlement | Settlement | Method → reference → Confirm | CURRENT / V1 | ONLINE REQUIRED | Current backend records tenders | Truthfully labeled recorded vs processed; server acknowledgement |
| PAY-07 | Record card/provider settlement | Settlement | Method → reference → Confirm | CURRENT / V1 | ONLINE REQUIRED | Current generic tender support/contract-dependent | Provider success verified/recorded server-side; never faked |
| PAY-08 | Record bank/other external tender | Settlement | Method → reference → Confirm | CURRENT / V1 | ONLINE REQUIRED | Contract-dependent current tender types | Expose only configured authoritative methods |
| PAY-09 | Search eligible stay/folio | Room Charge | Search/select stay | CURRENT / V1 | ONLINE REQUIRED | Candidate endpoint exists | Same property, active in-house stay/open folio, no stale cache |
| PAY-10 | Commit Room Charge | Room Charge | Stay → Review/Confirm | CURRENT / V1 | ONLINE REQUIRED | Backend endpoint exists | Exactly one settlement and folio posting under one idempotent transaction |
| PAY-11 | Split tender | Settlement | None | DEFERRED | ONLINE REQUIRED | Not supported | Separate financial protocol/design required |
| PAY-12 | Refund | Settled order | None | DEFERRED | ONLINE REQUIRED | Not supported | Separate permission/accounting/provider protocol required |
| PAY-13 | Add tip/promotion/service charge | Order/settlement | None | DEFERRED | ONLINE REQUIRED | Not proven | Do not show until authoritative calculation/audit contracts exist |
| DOC-01 | View stable settlement result | After confirm | Automatic | CURRENT / V1 | ONLINE + OFFLINE | Receipt view exists | Shows locally committed vs server acknowledged, references, print outcome, next action |
| DOC-02 | View customer receipt | Result/order history | Receipt | CURRENT / V1 | ONLINE + OFFLINE | Server receipt exists | Immutable local snapshot for offline sale; truthful receipt label |
| DOC-03 | Reprint customer receipt | Result/order history | Reprint | CURRENT / V1 | ONLINE + OFFLINE | Current reprint endpoint/print jobs | Copy marked `REPRINT`; original facts unchanged; durable job |
| DOC-04 | Print customer bill/check | Open order | Bill/Check | BACKEND GAP | ONLINE + OFFLINE | No complete document contract | Marked not proof of payment; immutable document snapshot |
| DOC-05 | Issue TRA EFD/VFD fiscal document | Settlement | None | DEFERRED | ONLINE REQUIRED | No certified fiscal integration | Normal receipt must not claim fiscal/tax-invoice status |

## 5. Cash, close, synchronization, and printing operations

| ID | Intent/action | Natural context | Target path | Delivery | Connectivity | Current evidence / required authority | V1 acceptance |
|---|---|---|---|---|---|---|---|
| CASH-01 | Record cash in | Shift/Cash | Cash in → amount/reason → Confirm | CURRENT / V1 | ONLINE REQUIRED | Backend cash movement exists | Immutable, actor/shift/reason/time/idempotency |
| CASH-02 | Record cash out | Shift/Cash | Cash out → amount/reason → Confirm | CURRENT / V1 | ONLINE REQUIRED | Backend cash movement exists | Same as cash in; offline sale lease does not authorize it |
| CASH-03 | Open drawer after cash sale | Settlement result | Automatic/manual fallback | BACKEND GAP | ONLINE + OFFLINE | No certified drawer contract | Profile-supported pulse only after local commit; action audited |
| CASH-04 | Manually open drawer | Shift/Cash | Open drawer → Confirm | BACKEND GAP | ONLINE + OFFLINE | No contract | Permission-gated and audited; hardware/profile certified |
| DAY-01 | View authoritative business date | Shell/Shift | Always visible | CURRENT / V1 | ONLINE + OFFLINE | Current backend context exists | Offline clearly shows lease-bound date |
| DAY-02 | Run POS-only Day Close | Shift/Close | Readiness → Confirm | CURRENT / V1 | ONLINE REQUIRED | Backend endpoint exists | All shifts closed; one advancement; POS-only properties |
| DAY-03 | Run POS Day Close for hybrid property | None | None | DEFERRED | ONLINE REQUIRED | Night Audit owns date | Action hidden; open POS shift blocks Night Audit |
| SYNC-01 | View persistent sync status | Any screen | Status indicator | BACKEND GAP | ONLINE + OFFLINE | Current WebSocket-only indicator | Reports network + outbox + acknowledgement + conflict truth |
| SYNC-02 | Open Sync Center | Any screen | Connectivity status | BACKEND GAP | ONLINE + OFFLINE | No Sync Center | One interaction; waiting, saved, conflict, lease, catalog, printers, unavailable actions |
| SYNC-03 | Automatic ordered reconciliation | Reconnect/live | Automatic | BACKEND GAP | ONLINE REQUIRED | No reconciliation endpoint | Stable envelopes, sequence order, durable acknowledgement, safe retry |
| SYNC-04 | Retry unchanged mutation | Sync Center/background | Retry | BACKEND GAP | ONLINE REQUIRED | Current idempotency not durable | Same operation ID, sequence, signature and payload; no regeneration |
| SYNC-05 | View local conflict/evidence | Sync Center | Conflict | BACKEND GAP | ONLINE + OFFLINE | No conflict store | Cashier-safe facts and escalation; no destructive disposition |
| SYNC-06 | Resolve financial exception | Hospitality Web POS Reconciliation | Review → disposition | BACKEND GAP | ONLINE REQUIRED | No surface/contract | Authorized management workflow; immutable cash evidence preserved |
| SYNC-07 | Refresh after realtime invalidation | Background | Automatic | CURRENT / V1 | ONLINE REQUIRED | WebSocket/invalidation exists; backfill issue | Reconcile authoritative snapshot/cursor; realtime never establishes final mutation truth |
| PRINT-01 | Configure/discover local printer | Status/Printers | Printer → Configure | BACKEND GAP | ONLINE + OFFLINE | Environment variables/OS `lp` only | Device-local profile, role, capabilities and safe diagnostics |
| PRINT-02 | Test printer | Status/Printers | Test | BACKEND GAP | ONLINE + OFFLINE | Limited status path | Durable test job; no business document ambiguity |
| PRINT-03 | Queue KOT/prep ticket | Send order | Automatic | BACKEND GAP | ONLINE + OFFLINE | Server kitchen job exists; local durable queue absent | Immutable routed job committed with order operation |
| PRINT-04 | Queue receipt | Settlement | Automatic | BACKEND GAP | ONLINE + OFFLINE | Server receipt job exists; schema mismatch risk | Immutable job committed with settlement; financial state independent |
| PRINT-05 | Retry definite failed job | Print result/queue | Retry | BACKEND GAP | ONLINE + OFFLINE | No durable local retry semantics | Safe only from `FAILED`; attempt history retained |
| PRINT-06 | Handle ambiguous print outcome | Print result/queue | Inspect → manual choice | BACKEND GAP | ONLINE + OFFLINE | No `OUTCOME_UNKNOWN` | Never auto-duplicate KOT; manual KOT copy `DUPLICATE`, receipt copy `REPRINT` |
| PRINT-07 | Choose alternate printer | Failed job | Choose printer → Print copy | BACKEND GAP | ONLINE + OFFLINE | No profiles/routing | Original job retained; new attempt/copy relationship audited |

## 6. Management and deferred scope

| ID | Intent/action | Owner/surface | Delivery | Connectivity | Rule |
|---|---|---|---|---|---|
| MGT-01 | Manage catalog/categories/modifiers/layout | Hospitality Web | CURRENT / V1 | ONLINE REQUIRED | Terminal consumes published signed snapshots; no terminal CRUD |
| MGT-02 | Manage outlets/registers/devices | Hospitality Web | CURRENT / V1 | ONLINE REQUIRED | Pair/revoke/status under effective permission |
| MGT-03 | Manage users/roles/PIN lifecycle | Hospitality Web | CURRENT / V1 | ONLINE REQUIRED | No authorization architecture duplicated in terminal |
| MGT-04 | View POS orders/shifts/cash reports | Hospitality Web | CURRENT / V1 | ONLINE REQUIRED | Operational accountability, not surveillance scoring |
| MGT-05 | Review offline reconciliation exceptions | Hospitality Web POS Reconciliation | BACKEND GAP | ONLINE REQUIRED | Exact evidence, authorized disposition, notes and audit |
| DEF-01 | Expanded kitchen display system | Separate certified terminal mode | DEFERRED | ONLINE REQUIRED | KOT printing is the V1 preparation baseline |
| DEF-02 | Inventory/recipes | Hospitality platform | DEFERRED | ONLINE REQUIRED | No implied stock mutation from POS V1 |
| DEF-03 | Loyalty/gift cards/discount engine | Future specification | DEFERRED | ONLINE REQUIRED | Excluded until authoritative contracts and accounting exist |
| DEF-04 | Arbitrary offline financial operations | Future certified protocol | DEFERRED | ONLINE REQUIRED | Offline cash sale does not generalize to other mutation classes |

## 7. Cross-cutting acceptance checklist

Each `CURRENT / V1` or `BACKEND GAP` V1 action is incomplete until all applicable boxes are satisfied:

- [ ] Effective permission and staff/session/lease scope enforced in Rust and backend.
- [ ] Keyboard, touch, focus, screen-reader label, contrast, and reduced-motion behavior verified.
- [ ] Loading, empty, offline, retry, denied, expired, revoked, and conflict states defined.
- [ ] Financial values use integer smallest-unit money plus currency in Rust/backend.
- [ ] Durable operations and print jobs survive process/power interruption.
- [ ] Idempotency identity remains stable across retry and restart.
- [ ] Audit retains actor, terminal, shift, business date, catalog, operation, and canonical references.
- [ ] No raw secrets, PINs, SQL/constraint details, panic, or provider internals reach UI/logs.
- [ ] Real packaged Tauri journey is green at 1024×768, 1280×800, 1366×768, and 1440×900.
- [ ] Backend-gap behavior remains unavailable until its authoritative contract and certification are green.
