# Peak POS Desktop — Printing Specification

Status: **Proposed canonical V1 specification — review required**

Last updated: 2026-09-02

This document defines native printing, document truth, routing, durability, ambiguity, copies, and certification for Peak POS Desktop. Printing is independent from transaction success and uses the Rust-owned local transaction core.

## 1. Scope and classification

Delivery labels:

- `CURRENT / V1`: current authoritative concept exists and remains in V1.
- `BACKEND GAP`: V1 requirement lacks a sufficient backend/local contract.
- `DEFERRED`: outside V1.

| Capability/document | Delivery | V1 rule |
|---|---|---|
| Native OS printing foundation | CURRENT / V1 | Replace environment-only `lp` behavior with a tested adapter/profile boundary |
| Durable local print queue | BACKEND GAP | Required; SQLite-owned by Rust, not browser state |
| Printer profiles and per-terminal role routing | BACKEND GAP | Required for receipt and prep routing |
| KITCHEN ORDER TICKET / KOT | CURRENT / V1 | Required; immutable local document; no finance emphasis |
| BAR/PREP TICKET | BACKEND GAP | Required when category routing config uses a bar/prep role |
| CUSTOMER BILL / CHECK | BACKEND GAP | Required pre-settlement document; never proof of payment |
| SALES RECEIPT | CURRENT / V1 | Required after acknowledged or locally committed eligible settlement |
| ROOM CHARGE CHIT | BACKEND GAP | V1 when configured; online Room Charge only |
| CASH IN/OUT SLIP | BACKEND GAP | V1 when configured; online cash movements only |
| SHIFT CLOSE SUMMARY | BACKEND GAP | V1 optional print after acknowledged close |
| TEST PRINT | BACKEND GAP | Required device-local diagnostic |
| Receipt `REPRINT` and kitchen `DUPLICATE` | CURRENT / V1 | Required copy semantics; current contract requires expansion |
| Cash-drawer pulse | BACKEND GAP | V1 only with certified printer/profile support |
| 80mm thermal output | CURRENT / V1 | Default certified format |
| 58mm output | DEFERRED | Add only with explicit hardware/property requirement and certification |
| ESC/POS direct USB/LAN adapters | BACKEND GAP | Select adapters during implementation; certify representative hardware |
| Bluetooth printing | DEFERRED | Operational reliability/security review required |
| TRA EFD/VFD fiscal receipt or tax invoice | DEFERRED | Never claim until a separate certified fiscal contract exists |
| Expanded KDS | DEFERRED | KOT/prep printing is V1 preparation baseline |

## 2. Non-negotiable invariants

1. A printer failure never rolls back a committed order or settlement.
2. Printing is not claimed to be exactly once. Physical output can be ambiguous after a crash, spooler timeout, transport loss, or printer reset.
3. `OUTCOME_UNKNOWN` is a first-class final/attention state.
4. An ambiguous KOT MUST NOT be automatically printed again.
5. A manually printed kitchen/prep copy is visibly marked `DUPLICATE`.
6. A customer receipt copy is visibly marked `REPRINT` and references the original receipt.
7. Documents render from immutable snapshots. Reprints do not query mutable catalog names/prices or recalculate totals.
8. React never formats authoritative financial documents or controls raw printer transport.
9. Financial amounts use integer smallest units plus currency. Formatting is locale/template behavior, not calculation.
10. Successful local cash settlement may produce a truthful receipt while offline, with local/sync reference status represented according to policy; it is not called a draft.
11. Browser print dialogs are not the operational print path.
12. No normal Peak document is labeled TRA fiscal receipt, EFD/VFD receipt, or tax invoice without certified fiscal integration.

## 3. Architecture

```text
React print intent/status
→ narrow Tauri command
→ Rust document/queue service
→ encrypted SQLite document + job + attempt
→ role router
→ printer adapter / OS spooler / certified transport
→ durable outcome
```

The Rust core owns templates, immutable document snapshots, routing, state transitions, retries, copy semantics, redaction, cash-drawer decisions, and diagnostics. React displays returned states and may request safe actions such as retrying a definite failure or creating a marked copy.

For transaction-triggered output, the domain transaction persists the document snapshot and job atomically with the order/send or settlement operation. Dispatch begins only after database commit.

### 3.1 Required local entities

`printer_profile`:

- profile ID and friendly name;
- terminal binding;
- role(s): `RECEIPT`, `KITCHEN`, `BAR_PREP`, `CASHIER`, `REPORT`;
- adapter/transport type and opaque safe configuration reference;
- capability flags: width, columns, bold, double-size, cutter, drawer pulse, QR/barcode, Unicode/code page;
- enabled/health state, last tested time, configuration version.

`print_document`:

- immutable document ID/type/schema/template version;
- property/outlet/register identity snapshots;
- order/shift/settlement/local operation references;
- canonical server reference when known;
- business date, actor, timestamps, currency;
- canonical structured payload and payload hash;
- original/copy relationship and copy marking;
- minimum necessary guest/external data.

`print_job`:

- stable job ID, document ID, target role/profile;
- creation source and transaction reference;
- state, priority, created/updated time;
- maximum automatic attempt policy;
- selected adapter capability snapshot.

`print_attempt`:

- attempt ID/job ID/sequence;
- start/end time, adapter and safe destination identity;
- transport/spooler reference where available;
- result and safe error code;
- actor for manual action;
- whether bytes may have reached the printer.

## 4. Job lifecycle

```text
QUEUED → PRINTING → PRINTED
                 ↘ FAILED → RETRYING → PRINTING
                 ↘ OUTCOME_UNKNOWN → operator decision
QUEUED → HELD_NO_PRINTER
CANCELLED_BEFORE_DISPATCH
```

Rules:

- `QUEUED`: durable and not dispatched.
- `PRINTING`: transport attempt started; crash recovery treats unresolved printing as `OUTCOME_UNKNOWN`, not `FAILED`.
- `PRINTED`: transport provided its strongest supported success signal. The UI MUST NOT overstate this as human-confirmed paper delivery.
- `FAILED`: adapter can prove output was not accepted/printed; automatic bounded retry is allowed.
- `RETRYING`: a bounded safe retry of a definite failure is scheduled or being prepared; each dispatch still creates a distinct attempt record.
- `OUTCOME_UNKNOWN`: output may have occurred. No automatic retry for KOT/prep. Receipts also require an explicit copy action so a resulting second paper is marked `REPRINT`.
- `HELD_NO_PRINTER`: routing has no eligible configured printer. Transaction remains valid.
- `CANCELLED_BEFORE_DISPATCH`: cancellation is proven to precede transport; business document remains retained.

There is no generic “reset to queued” action for `OUTCOME_UNKNOWN`.

### 4.1 Copy behavior

| Original type | Ambiguous/printed follow-up | Required marking | Automatic? |
|---|---|---|---|
| KOT / prep ticket | Operator decides another paper is required | `DUPLICATE` plus original ticket ID and copy time | Never after ambiguity |
| Customer bill/check | Operator requests another copy | `COPY` | Manual |
| Sales receipt | Operator requests another copy | `REPRINT` plus original receipt/reference | Manual |
| Room Charge chit | Authorized operator requests copy | `REPRINT` | Manual |
| Cash movement/shift summary | Authorized operator requests copy | `REPRINT` | Manual |
| Test print | Repeat test | `TEST PRINT` | Manual |

A copy is a new document/job linked to the immutable original. Attempt history on an old job is never rewritten to disguise a copy.

## 5. Routing

Routing evaluates immutable order/category routing facts against the active terminal configuration at document creation:

```text
Mains category → KITCHEN role
Drinks category → BAR_PREP role
Customer receipt → RECEIPT role
Cash slip → CASHIER or RECEIPT role
Shift summary → REPORT or RECEIPT role
```

An order may generate multiple prep documents grouped by destination. Each has a distinct document/job ID and contains only its routed items. Reconciliation or catalog changes cannot reroute an already-created ticket silently.

If no profile is configured, the job becomes `HELD_NO_PRINTER` and the UI explains the consequence. Selecting an alternate printer creates an audited routing override. Printer hardware configuration is device-local; Hospitality Web may provide policy/default routing and later display health, but must not claim a terminal is configured or synchronized without acknowledgement.

## 6. Template and rendering engine

Templates are versioned Rust-owned structured renderers, not concatenated React strings. They support:

- 80mm thermal default and configured character width;
- deterministic wrapping/truncation rules with no loss of money/reference meaning;
- left/right alignment, separators, bold, and double width/height;
- tabular money formatting from integer amounts and currency;
- Unicode normalization, explicit code-page/fallback strategy, and test fixtures for local names;
- optional QR/barcode only when its payload has a defined operational purpose;
- cutter and drawer commands only when profile capability is certified;
- text/PDF or raster fallback only through reviewed adapters;
- deterministic golden/snapshot tests by template version.

The immutable structured payload, template version, and rendered-output hash are retained. Re-rendering for a different certified adapter preserves document facts and creates traceable output metadata.

## 7. Document specifications

### 7.1 Kitchen order ticket (KOT) and bar/prep ticket

Purpose: preparation, not finance.

Required content:

- property/outlet and preparation destination;
- prominent order reference and immutable ticket ID;
- order/service type and table/destination context;
- order/send time and responsible staff display name;
- quantities and product-name snapshots;
- modifiers and preparation notes with stronger emphasis than ordinary metadata;
- order note when supported;
- printed time and copy marker.

Prices and customer financial totals are omitted unless an explicit property workflow requires them. Guest PII is excluded.

Example:

```text
SAVANNAH CREST
MAIN BAR / KITCHEN

ORDER #1042
DINE IN · TABLE 7
20:43 · Asha Juma
--------------------------------
2 × HOUSE SPECIAL
    + CHEESE
    NO ONION

1 × CHICKEN WRAP
    EXTRA HOT
--------------------------------
ORDER NOTE: GUEST IN A HURRY

Printed 20:43
Ticket KOT-9281
```

A manual follow-up starts with a prominent `DUPLICATE` banner.

### 7.2 Customer bill/check

Purpose: present an amount before settlement. It is not proof of payment.

Required content:

- property/outlet;
- `CUSTOMER BILL` or `ORDER CHECK` title;
- order reference/context;
- line names, quantities, price components, subtotal, supported tax/service components, total and currency;
- print time and document ID;
- explicit “Not proof of payment” wording.

Unsupported tax or service claims are omitted, never inferred.

### 7.3 Sales receipt

Purpose: evidence of a committed settlement.

Required content:

- configured property/outlet/business identity;
- `RECEIPT` title and immutable receipt reference;
- order reference, business date, transaction timestamp, cashier, register;
- item/modifier descriptions, quantities, and immutable prices;
- subtotal, supported tax/service components, total, and currency;
- tender label;
- for cash: amount received and change;
- safely formatted external reference when applicable;
- local operation/reference and sync wording when policy requires for offline-origin evidence;
- configured truthful footer and `Peak POS`.

An offline cash receipt reflects an actual locally committed settlement. It MUST NOT say “payment draft.” It also MUST NOT claim server acknowledgement before acknowledgement exists.

A copy begins with `REPRINT` and identifies the original receipt/reference and copy time. Original facts never change when canonical server IDs later become known; mappings may be printed as supplemental reference on a new reprint only when clearly distinguished.

### 7.4 Room Charge chit

Available only after an online Room Charge succeeds. Required content:

- `ROOM CHARGE` title;
- order, settlement, stay, and folio references;
- room and minimally necessary/masked guest identity;
- amount/currency, timestamp, cashier/register;
- optional signature line only under configured property policy.

No unnecessary guest PII is printed.

### 7.5 Cash movement slip

Printed only after the online cash movement is acknowledged. It includes type (`CASH IN`/`CASH OUT`), shift/register, staff, integer amount/currency, reason, authoritative timestamp, and reference.

### 7.6 Shift close summary

Printed only after authoritative close acknowledgement. It may include opening float, acknowledged cash sales, cash in/out, expected cash, counted cash, variance, staff/supervisor evidence as permitted, close time, register, and business date. It never prints locally invented expected cash.

### 7.7 Test print

Clearly marked `TEST PRINT — NOT A TRANSACTION`. It includes profile, role, safe destination identity, width/capability samples, terminal/app version, and time. It excludes customer/order data and secrets.

## 8. Transaction integration

### 8.1 Order/send

The Rust order transaction creates the immutable KOT/prep document(s) and jobs in the same SQLite commit as the corresponding local lifecycle evidence/outbox operation. After commit, transport dispatches asynchronously.

Failure to route or print is visible but does not undo the order. Reconciliation deduplicates the business operation independently of the physical print outcome.

### 8.2 Cash settlement

The Rust cash transaction calculates amount/change and commits settlement evidence, receipt snapshot, print job, outbox operation, and any authorized drawer intent atomically. The result screen first states settlement truth, then print truth:

```text
Cash payment secured locally
TZS 23,600 · Change TZS 6,400
Waiting to sync

Receipt printing failed
[Retry] [Choose printer] [Continue]
```

If receipt dispatch is ambiguous, the action is `Print marked reprint`, not an unmarked retry.

### 8.3 Cash drawer

Automatic drawer pulse is allowed only after a committed cash settlement, on a certified profile, and according to terminal policy. It is never sent for mobile money, card, bank, or Room Charge. A pulse failure does not change settlement.

Manual drawer opening is a separate permission-gated audited operation. It remains disabled until its local/backend audit contract is certified.

## 9. Offline behavior

KOT, receipt, bill/check, and retained-document reprint work offline for locally known data. No remote print server is required for the certified local route.

Offline restart restores documents, jobs, attempts, and unresolved `PRINTING` attempts. Every unresolved in-flight attempt becomes `OUTCOME_UNKNOWN`. The application never assumes `FAILED` merely because it did not receive completion.

Printer routing config must be present and valid locally. Changing management routing or installing a new remote policy is online-required, but selecting/configuring a local OS printer may be performed offline under terminal permission and is later acknowledged as device state where the contract supports it.

## 10. Operator UX

Status → Printers shows each role, profile, safe destination, readiness, last test, held/failed/ambiguous job counts, and actions appropriate to state.

Operator messages separate transaction and printing:

- “Payment successful. Receipt waiting to print.”
- “Payment secured locally. Waiting to sync.”
- “Printer did not confirm whether the ticket printed.”
- “Do not resend automatically. Check the kitchen, then print a marked duplicate if needed.”

The UI never offers a destructive clear-queue action. It may acknowledge resolved attention after the evidence and operator decision are recorded.

## 11. Security and privacy

- Printer commands are narrow allowlisted Rust operations; no React-provided shell command or raw path.
- Adapter inputs are validated and configuration secrets stay outside React/logs.
- Network printer endpoints are constrained by configured policy; no arbitrary URL fetching.
- Spool/temp files use restrictive permissions, bounded lifetime, and secure cleanup appropriate to the OS.
- Documents minimize guest/external-reference data and follow local retention policy.
- Diagnostic bundles redact payloads unless explicitly authorized and necessary.
- Template content is escaped/encoded to prevent printer control injection from names/notes.
- Drawer commands cannot be embedded in ordinary user-entered text or templates.

## 12. Retention

Unprinted, `OUTCOME_UNKNOWN`, failed, exception-linked, or manual-review-related documents/jobs are never compacted. Documents referenced by retained transactions remain available for audit/reprint according to server-configured retention.

Acknowledged old attempt telemetry may be compacted only after the immutable document, final state, copy chain, and required audit have been retained. Sensitive temporary render artifacts are removed promptly. Catalog snapshots referenced by documents remain protected from compaction.

## 13. Backend and cross-contract requirements

The backend must provide or extend:

- versioned canonical print-document schemas matching local renderer types;
- stable document IDs and local-to-canonical mappings;
- printer role/default-routing configuration and terminal acknowledgement where centrally managed;
- immutable receipt and reprint/copy audit relationships;
- KOT/prep metadata including modifiers, notes, service context, and routing facts;
- Room Charge chit, bill/check, cash-slip, shift-summary, and test-print policy contracts as applicable;
- ingestion/retention of offline document hashes and cash-sale receipt evidence;
- safe print telemetry/terminal health contract if Hospitality Web displays it.

The current server queue MUST NOT allow any outlet terminal to claim unrelated jobs without explicit routing/authorization. Backend print jobs and the local queue must have a defined ownership/deduplication relationship rather than two competing dispatchers.

## 14. Certification

Certification uses representative supported thermal hardware and the packaged Tauri application:

- 80mm content/golden layout for every V1 document;
- long names, modifiers, notes, Unicode/fallback, large quantities and money;
- role routing and multi-destination order;
- no printer configured, printer offline, paper out, permission denied, and transport timeout;
- crash before dispatch, during dispatch, after spool acceptance, and before local completion persistence;
- restart transition from unresolved `PRINTING` to `OUTCOME_UNKNOWN`;
- no automatic ambiguous KOT replay;
- visible `DUPLICATE` and `REPRINT` copy chains;
- offline KOT, offline cash receipt, restart, and reprint;
- settlement remains committed through every print failure;
- safe definite-failure retry and alternate-printer override;
- cutter/drawer only when profile supports them; no drawer pulse for non-cash tender;
- spool/temp-file security, injection resistance, redacted logs/diagnostics;
- document retention/compaction and referenced catalog protection;
- current print payload schemas match backend/local types exactly.

Mocks and browser screenshots are supplemental; they do not certify physical output or transport ambiguity.
