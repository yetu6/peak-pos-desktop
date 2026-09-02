# Peak POS Desktop — Offline Safety Matrix

Status: **Proposed canonical V1 safety contract — review required**

Last updated: 2026-09-02

This document classifies every POS operation by offline safety, defines the certified V1 offline cash protocol, and states reconciliation and threat-model requirements. It is normative with the [Master Operations Specification](./PEAK_POS_DESKTOP_MASTER_OPERATIONS.md).

## 1. Classification

- **ONLINE + OFFLINE** — designed to use local authoritative/cached state in either connectivity condition. For mutations, the single Rust transaction/outbox path applies in both conditions.
- **OFFLINE ONLY WITH CERTIFIED PROTOCOL** — V1 requires offline use, but it MUST remain disabled until the complete protocol and real-Tauri certification are green.
- **ONLINE REQUIRED** — the operation MUST fail closed without current server/external authority.

The current implementation has no certified offline mutation protocol. Therefore all V1 offline mutation rows marked `OFFLINE ONLY WITH CERTIFIED PROTOCOL` are also delivery status `BACKEND GAP` until completed.

## 2. Safety matrix

### 2.1 Startup, identity, authorization, and configuration

| Operation | Classification | Offline prerequisite / reason | Local effect | Reconciliation semantics |
|---|---|---|---|---|
| Start paired terminal | ONLINE + OFFLINE | Encrypted store and identity healthy | Restore durable state; remain locked | Refresh/reconcile when reachable |
| Initial device pairing | ONLINE REQUIRED | Requires server-issued one-time approval | None beyond safe pending request | Server binds new credential epoch |
| Pairing approval/rejection | ONLINE REQUIRED | Authorized Hospitality Web action | None | Server authoritative |
| Terminal reassignment | ONLINE REQUIRED | Must revoke/rebind server identity | None | Old epoch invalidated |
| Download bootstrap/config | ONLINE REQUIRED | Must be signed/current server policy | Stage then atomically activate | Record terminal acknowledgement |
| View cached terminal/status data | ONLINE + OFFLINE | Clearly label age/lease/version | Read only | Refresh when online |
| Change terminal/outlet/register configuration | ONLINE REQUIRED | Server-governed administration | None | Server authoritative |
| View eligible cached staff | ONLINE + OFFLINE | Valid staff snapshot/lease | Read only | Refresh and remove revoked/expired material |
| PIN authentication online | ONLINE REQUIRED | Server checks current PIN/session state | Cache only approved bounded envelope | Establish server session/lease context |
| PIN authentication offline | OFFLINE ONLY WITH CERTIFIED PROTOCOL | Valid device-bound verifier envelope and lease | Durable attempt/backoff/lockout; local session | Reconcile staff status; revoke/lock immediately if invalid |
| Switch/lock staff | ONLINE + OFFLINE | Always permitted; no mutation loss | End local session; preserve ledger/outbox | Server session cleanup when reachable |
| Create/reset PIN or manage staff/access | ONLINE REQUIRED | Low-level identity/access authority | None | Server authoritative |
| Continue after session/lease hard expiry | ONLINE REQUIRED | New authority required | Preserve evidence, block new commitments | Refresh only after server approval |
| Enforce terminal revocation while disconnected | ONLINE + OFFLINE | Enforce known revocation; unknown revocation bounded by lease | Lock if locally known/lease invalid | On reconnect, reconcile generation and lock |

### 2.2 Shift and business context

| Operation | Classification | Offline prerequisite / reason | Local effect | Reconciliation semantics |
|---|---|---|---|---|
| View active shift/business date | ONLINE + OFFLINE | Lease-bound last-authoritative context | Read plus local pending totals | Refresh server state and exceptions |
| Resume pre-established shift | OFFLINE ONLY WITH CERTIFIED PROTOCOL | Lease binds device, staff eligibility, shift and date | Restore active context | Verify still open; exception if server state diverged after physical cash activity |
| Open a new shift | ONLINE REQUIRED | Initial V1 has no offline-shift protocol | No local open claim | Server creates authoritative shift |
| Change opening float | ONLINE REQUIRED | Server-authoritative cash evidence | None | Server mutation only |
| Capture local closing-count draft | ONLINE + OFFLINE | Draft is not a close | Persist explicitly as draft | Submit/recalculate when online; discard only by actor action |
| Close shift | ONLINE REQUIRED | Requires current orders, expected cash, variance and approval checks | May preserve draft only | Server acknowledgement establishes closure |
| Supervisor variance approval | ONLINE REQUIRED | Requires current distinct supervisor authorization | None | Server authoritative audit |
| Run POS Day Close | ONLINE REQUIRED | Cross-register/business-date authority | None | Atomic server advancement exactly once |
| Run Lodging Night Audit | ONLINE REQUIRED | Lodging cross-module authority | None | Server authoritative; open POS shift blocks |

### 2.3 Catalog and pricing

| Operation | Classification | Offline prerequisite / reason | Local effect | Reconciliation semantics |
|---|---|---|---|---|
| Browse categories/products | ONLINE + OFFLINE | Active verified catalog snapshot | Read only | Compare current version on reconnect |
| Search products/categories | ONLINE + OFFLINE | Local snapshot search index | Read only | Index rebuilt from activated snapshot |
| View modifiers/availability/price | ONLINE + OFFLINE | Snapshot contains complete applicable facts | Read only | Historical facts retained by transaction version |
| Download/activate new snapshot | ONLINE REQUIRED | Requires server signature/digest/version | Verify/stage; atomic activation | Terminal sends activation acknowledgement |
| Continue using snapshot while offline | OFFLINE ONLY WITH CERTIFIED PROTOCOL | Snapshot/version within lease validity | Record version/digest on every operation | Server validates lease-authorized version; never silently reprice |
| Manage/publish catalog or terminal layout | ONLINE REQUIRED | Server-governed administration | None | New version and acknowledgement tracking |
| Sell missing/deactivated/unknown-priced item | ONLINE REQUIRED | No local authority exists | Block; never invent/fallback price | Current snapshot required |

### 2.4 Orders and lines

| Operation | Classification | Offline prerequisite / reason | Local effect | Reconciliation semantics |
|---|---|---|---|---|
| Create/edit local draft | ONLINE + OFFLINE | Secure store healthy; active catalog/context | Durable draft transaction | Draft need not sync until committed; retain after restart |
| Add item/modifiers/change quantity | OFFLINE ONLY WITH CERTIFIED PROTOCOL | Valid lease, staff, shift, catalog; Rust calculation | Atomic order state + operation/outbox where committed | Ordered idempotent application or composite supersession |
| Remove uncommitted draft line | ONLINE + OFFLINE | Local draft only | Durable local edit | No server effect |
| Remove/alter committed open line | OFFLINE ONLY WITH CERTIFIED PROTOCOL | Protocol explicitly permits state and captures audit | Append mutation; never erase history | Apply once in sequence or route conflict/review |
| Commit/open order | OFFLINE ONLY WITH CERTIFIED PROTOCOL | All envelope checks pass | Immutable committed order evidence + outbox | Create/ack once; map local to canonical ID |
| Send order / create KOT | OFFLINE ONLY WITH CERTIFIED PROTOCOL | Local order eligible; printer routing available | Append lifecycle evidence + durable KOT job | Server transition once; duplicate KOT prevention independent |
| View/resume locally known order | ONLINE + OFFLINE | Retained local order snapshot | Read/edit only as permitted by state | Merge only through explicit canonical mapping/version rules |
| Fetch order known only to server | ONLINE REQUIRED | Not present locally | None | Download authoritative order |
| Advance server/kitchen lifecycle | ONLINE REQUIRED | Other-device/concurrent state needs current authority | None | Server version/state transition |
| Void order | ONLINE REQUIRED | Permission, current state, financial consequence | None | Server-authoritative immutable void evidence |
| Correct/refund settled order | ONLINE REQUIRED | Deferred accounting/provider workflow | None | Separate future compensating protocol |

### 2.5 Settlement and financial operations

| Operation | Classification | Offline prerequisite / reason | Local effect | Reconciliation semantics |
|---|---|---|---|---|
| Calculate authoritative order total | OFFLINE ONLY WITH CERTIFIED PROTOCOL | Active signed snapshot and supported tax rules | Rust stores integer-money calculation evidence | Server verifies exact catalog/rule version; never silently reprice |
| Calculate cash received/change | ONLINE + OFFLINE | Rust core, currency consistency, received ≥ due | Persist with settlement; React only renders | Server retains physical cash facts |
| Settle acknowledged order with cash | OFFLINE ONLY WITH CERTIFIED PROTOCOL | Valid cash permission/lease/ceilings and unsettled local state | Immutable settlement + outbox + receipt job atomically | Ack once, accept with exception, or manual review |
| Create and settle entire cash sale offline | OFFLINE ONLY WITH CERTIFIED PROTOCOL | Same, plus final complete order evidence | Atomic `OFFLINE_CASH_SALE_COMMIT` | Server creates order+settlement in one transaction or retains entire composite in exception/review |
| Record cash sale while online | OFFLINE ONLY WITH CERTIFIED PROTOCOL | Same local protocol; network does not bypass ledger | Commit locally, then immediate normal sync | Same ordered/deduplicated reconciliation path |
| Mobile-money processing/recording | ONLINE REQUIRED | External/provider confirmation and current server authority | No offline settlement | Authoritative server/provider record |
| Card/provider processing/recording | ONLINE REQUIRED | External/provider confirmation and current server authority | No offline settlement | Authoritative server/provider record |
| Bank transfer/other external tender | ONLINE REQUIRED | Externally verified/reference-governed | No offline settlement | Authoritative server record |
| Search stay/folio | ONLINE REQUIRED | Must be current same-property in-house/open-folio data | No authoritative offline cache | Server query |
| Room Charge settlement | ONLINE REQUIRED | Cross-module exact-one folio posting | No offline settlement | One atomic settlement + folio posting |
| Split tender | ONLINE REQUIRED | Deferred | None | Future protocol |
| Refund/reversal | ONLINE REQUIRED | Deferred compensating financial action | None | Future protocol |
| Cash in/cash out | ONLINE REQUIRED | Offline cash-sale lease does not authorize drawer movements | None | Immutable server movement |
| Manual drawer open | OFFLINE ONLY WITH CERTIFIED PROTOCOL | Separate permission, local audit, certified hardware | Immutable local audit + pulse result | Sync audit once; disabled until certified |

### 2.6 Documents, printing, synchronization, and diagnostics

| Operation | Classification | Offline prerequisite / reason | Local effect | Reconciliation semantics |
|---|---|---|---|---|
| Render KOT from locally known order | ONLINE + OFFLINE | Immutable document snapshot and supported template | Persist document/job before dispatch | Sync document metadata/evidence as required |
| Render customer receipt after local cash commit | ONLINE + OFFLINE | Immutable settlement snapshot | Persist receipt/job atomically with commit | Map to server receipt/reference without changing facts |
| Render pre-payment bill/check | ONLINE + OFFLINE | Locally known order | Persist document snapshot | Not proof of settlement |
| Reprint retained receipt | ONLINE + OFFLINE | Original document retained | New copy job marked `REPRINT` | Append audit; do not regenerate facts |
| Duplicate ambiguous KOT manually | ONLINE + OFFLINE | Authorized operator decision | New copy marked `DUPLICATE` | Append audit; never auto-duplicate |
| Automatically retry definite print failure | ONLINE + OFFLINE | Outcome definitively `FAILED` | New attempt on same job | Local print state only/telemetry sync |
| Resolve ambiguous print outcome | ONLINE + OFFLINE | Human checks physical output; automatic retry is prohibited | Retain `OUTCOME_UNKNOWN`; optionally create a marked copy | KOT copy is `DUPLICATE`; receipt copy is `REPRINT` |
| View Sync Center/local history | ONLINE + OFFLINE | Local database readable | Read only; safe manual retry request | Refresh status when reachable |
| Reconcile outbox | ONLINE REQUIRED | Backend reachable and authenticated | Persist acknowledgement/mapping atomically | Ordered, signed, idempotent server application |
| Retry reconciliation | ONLINE REQUIRED | Envelope unchanged | Increment attempt metadata only | Same operation produces same outcome/no duplicate |
| Resolve financial conflict | ONLINE REQUIRED | Authorized Hospitality Web management | Terminal remains read-only for disposition | Server exception workflow/audit |
| Generate safe local diagnostics | ONLINE + OFFLINE | Redaction and permission | Local bundle | Optional upload only with authority |
| Update application | ONLINE REQUIRED | Signed release/update authority | Verified install workflow | Version policy affects future lease issuance |

## 3. Certified offline authorization envelope

Offline selling is denied unless all of these are true:

1. The device is paired and its credential epoch matches local identity.
2. The encrypted database and secure anchors pass key, migration, integrity, sequence, and disk-health checks.
3. A server-signed lease validates against a pinned/trusted server key and supported schema.
4. The lease binds the property, outlet, register, device, credential epoch, pre-opened shift, business date, catalog version/digest, eligible staff, allowed operations, and `CASH` tender.
5. Issue, refresh-by, and hard-expiry rules pass conservative clock/rollback checks.
6. Operation count, gross sales, and cash exposure remain under server-configured ceilings.
7. The active staff authenticates using a valid device-bound offline verifier envelope and has not exhausted durable attempt/lockout policy.
8. The operation can be priced completely using the active signed catalog snapshot and supported integer-money/tax rules.

Lease values are policy-controlled and reviewed by Product/Security. The terminal does not embed production durations or financial ceilings.

When eligibility expires, new order commitment and cash settlement stop. Existing local evidence, Sync Center, and permitted reprints remain accessible after authentication. Draft editing may continue only if policy explicitly allows it and must be clearly distinguished from commit eligibility.

## 4. Single local mutation path

All offline-capable order/cash mutations enter through typed React-to-Rust intents. Rust performs validation and calculation, then one SQLite transaction:

```text
validate identity/session/lease/catalog/shift/state
→ allocate monotonic sequence
→ calculate integer-money facts
→ update local domain ledger
→ append immutable evidence
→ append signed outbox operation
→ persist document/print jobs
→ commit
→ return authoritative result to React
```

When online, a synchronizer immediately sends the committed envelope. It never skips the ledger or replaces the operation with direct REST calls. When offline, the same envelope remains queued.

React cannot write SQLite, allocate IDs, calculate prices/change, sign operations, or claim success before the transaction commits.

## 5. Composite offline cash sale

`OFFLINE_CASH_SALE_COMMIT` is the final immutable aggregate for a sale both created and settled offline. Its canonical payload contains:

- operation/device/epoch/sequence and previous hash;
- lease, staff, shift, business date, property/outlet/register;
- local order ID, service type, context, timestamps;
- every line, quantity, name snapshot, modifier selection, price component, and note allowed by policy;
- catalog version/digest and pricing/tax rule evidence;
- currency, subtotal, supported tax components, total;
- tender `CASH`, amount received, change, settlement timestamp and local settlement ID;
- receipt and KOT document IDs/hashes and print-state references;
- canonical payload hash and device signature.

Draft/edit operations may exist locally, but the server financial import of this scenario uses the final composite. In one PostgreSQL transaction, reconciliation either:

1. validates and creates the order, lines, settlement, receipt/evidence, operation acknowledgement, and canonical mappings; or
2. persists the entire submitted evidence in the exception/review ledger with no partially imported order/payment.

The backend response and subsequent retries are keyed to the same immutable operation. An exception does not erase or relabel the physical cash event.

## 6. Reconciliation outcomes and conflicts

| Outcome | Server meaning | Local transition | Cashier presentation |
|---|---|---|---|
| `ACKNOWLEDGED` | Operation committed normally | Outbox acknowledged; mapping stored | Synced |
| `ALREADY_APPLIED` | Identical operation was previously committed | Verify returned hash/mapping, then acknowledge | Synced |
| `RETRYABLE` | No final server commit/decision | Keep immutable operation queued | Waiting/retrying |
| `REJECTED_NOT_COMMITTED` | No irreversible local fact and no server commit; rejection wording is true | Preserve audit; stop retry | Could not be committed |
| `ACCEPTED_WITH_EXCEPTION` | Evidence accepted into server accounting/exception state | Acknowledge with exception link | Synced with issue; manager review required |
| `MANUAL_REVIEW_REQUIRED` | Evidence retained intact; authorized disposition needed | Preserve operation/evidence; no automatic rewrite | Sync issue; sale remains recorded locally |

`REJECTED_NOT_COMMITTED` MUST NOT be returned for a committed local cash settlement. Cash conflicts use acknowledgement, exception, or manual review.

Conflicts include expired/revoked authority discovered after disconnection, catalog/version mismatch outside lease policy, server shift/date divergence, sequence gap/rollback, duplicate ID with different payload, invalid signature/hash, ceiling discrepancy, canonical state conflict, and unsupported schema. The terminal cannot discard or edit financial evidence to clear a conflict.

Hospitality Web owns authorized investigation and disposition through a future **POS Reconciliation** surface. It must expose submitted evidence, server comparison, lease/catalog/sequence context, risk flags, notes, actor, disposition, and audit. Cashier UI is limited to status, locally secured facts, retry where safe, reprint, and escalation.

## 7. Idempotency, replay, and rollback detection

- Operation identity is `(device_id, identity_epoch, local_sequence)` with a stable operation ID.
- The sequence is allocated transactionally and never reused.
- PostgreSQL enforces uniqueness, retains payload hash/outcome/canonical mappings, and stores the last accepted sequence per epoch.
- Retried envelopes are byte/canonically identical; a duplicate identity with a different hash is a security conflict.
- Operations are processed in order unless an operation type is explicitly proven independent.
- Local secure storage SHOULD anchor the highest sequence and chain hash where supported.
- Gaps, lower sequences, stale epochs, copied databases, and rollback indicators route to security/reconciliation review.
- Re-pair/reprovision creates a new credential epoch; it does not reset or impersonate an old epoch.

These measures do not defeat an attacker controlling the OS/root, device key, database, and every secure anchor. That is complete terminal compromise and requires revocation/incident response rather than a false cryptographic guarantee.

## 8. Database encryption, crash recovery, and storage health

The V1 mechanism is **SQLCipher**. A pre-implementation ADR MUST freeze its maintained Rust integration, pinned version/build provenance, supported platforms, licensing, packaging, update path, and test plan. Any substitution requires security review and a specification amendment. No homemade encryption or plaintext production fallback is allowed.

Key lifecycle:

- generate a 256-bit database key locally with the operating-system CSPRNG;
- store/wrap with platform secure storage;
- never expose it to React, environment variables, normal config, logs, or diagnostics;
- keep versioned current/next key envelopes in OS secure storage and use an exclusive, protected-backup SQLCipher rekey workflow;
- reopen and pass SQLCipher integrity/schema checks before promoting the next key and deleting the protected recovery copy;
- fail closed on missing/wrong key;
- preserve corrupt/unopenable files for controlled recovery rather than recreate silently;
- distinguish key failure, corruption, migration error, disk full, and permission error safely.

SQLite uses transactions, foreign keys, integrity checks, schema migrations, and durability settings selected/tested for supported platforms. Tests inject process termination/power-loss equivalents before and after sequence allocation, ledger writes, outbox writes, settlement evidence, acknowledgement persistence, print dispatch, and key rotation.

Successful recovery guarantees either the complete transaction or none of it. If commit status cannot be proven, the local ledger is inspected by stable identity; React never creates a replacement operation speculatively.

## 9. Offline PIN security

The server issues a device-key-bound, time-bounded verifier envelope for explicitly eligible staff. It contains staff identity/display metadata, lease/policy epoch, Argon2id-compatible verifier parameters/material, expiry, attempt/backoff policy, and server signature. It is encrypted in the local database and protected by the secure-store key model.

The terminal:

- never stores plaintext PIN or a general reusable server credential;
- verifies only inside Rust;
- persists every failed attempt, delay, and lockout before returning failure;
- uses constant-time comparison where applicable and generic UI errors;
- removes expired/superseded verifier material promptly;
- locks and reconciles immediately when suspension/revocation is learned;
- never automatically resumes an unlocked employee session after restart.

A low-entropy PIN cannot protect against full physical/root compromise with stolen key material and offline guessing capability. Bounded leases, durable rate limits under the normal device boundary, hardware/OS custody, rapid revocation, exposure ceilings, monitoring, and incident response limit rather than eliminate that risk.

## 10. Pricing and catalog conflict policy

The active snapshot is immutable, signed, versioned, and digest-addressed. Rust uses integer smallest-unit values and explicit currency for prices, modifier deltas, supported tax, totals, received cash, and change.

The server validates the exact snapshot/rule version authorized by the lease. If a valid lease authorized that version at local commitment, later catalog publication does not silently alter historical facts. Suspected signature/digest mismatch, incomplete rules, unsupported tax computation, or a snapshot outside the lease blocks commitment or routes already-committed evidence to manual review.

## 11. Retention and compaction

- Never purge queued, retryable, exception, or manual-review operations.
- Never purge settlements, documents, acknowledgements, canonical mappings, or catalog snapshots still referenced by retained evidence.
- Compact only acknowledged records beyond server-configured accounting/privacy retention and after referential checks.
- Preserve sequence/hash continuity through a signed/hashed compaction checkpoint.
- Remove expired verifier envelopes, superseded session secrets, and obsolete leases promptly when no longer required for audit.
- Minimize guest and external-tender data; Room Charge data is not cached for offline use.
- Surface storage pressure early; pause compaction on uncertainty; fail closed before unsafe disk exhaustion.

## 12. Certification matrix

The offline protocol is not enabled in production until all rows pass in a packaged Tauri build:

| Journey/fault | Required evidence |
|---|---|
| Online → network loss during open order | UI remains stable; status changes; local state durable |
| Continue eligible ordering | Snapshot rules and Rust totals correct |
| Commit offline cash | One immutable settlement/composite and receipt job; clear local success |
| Restart offline | Locked boot; DB/sequence/lease restored; PIN gate; history intact |
| Reconnect and sync | Ordered operations acknowledged; canonical mappings stored |
| Lost response/repeated retries | No duplicate order, line, settlement, receipt evidence, or acknowledgement |
| Atomic composite failure | No partial server order/payment; full exception evidence retained |
| Expired lease/ceiling | New commitment fails closed; existing evidence remains available |
| Staff/terminal revocation | Lock at reconciliation; committed evidence retained/reviewed |
| Catalog invalidation/staleness | Valid leased snapshot honored; invalid commit blocked/reviewed; no repricing |
| Sequence replay/rollback/gap | Server detects and routes security/reconciliation issue |
| Wrong/missing DB key | Production fail closed; no silent replacement database |
| Corruption/migration/disk full | Safe recovery state; no false success or evidence purge |
| Crash at every local transaction boundary | All-or-nothing domain/outbox/evidence/job state |
| Sync Center final state | Clean only after all acknowledgements; exceptions remain visible |
| Management exception review | Hospitality Web disposition preserves original cash evidence and audit |

Browser-only tests are insufficient. Tests require actual Tauri IPC, encrypted database, secure-store behavior, network fault injection, backend PostgreSQL reconciliation, and repeated process restarts.
