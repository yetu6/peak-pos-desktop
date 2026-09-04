# PEAK TERMINAL — MASTER OPERATIONS & PRODUCT EXECUTION SPECIFICATION

**Status:** LOCKED PRODUCT / OPERATIONS SOURCE OF TRUTH
**Product:** Peak Terminal (native POS application; bounded context remains `POS`)
**Primary desktop stack:** Tauri + Rust transaction core + React/Vite operator UI
**Backend:** Peak Go backend + PostgreSQL
**Local durability:** SQLCipher-backed local store / durable local transaction log
**Target environment:** Hotels, resorts, restaurants, bars, cafés, room-service outlets, and other hospitality outlets operating under Peak Hospitality
**Design family:** Peak Evergreen — dark-first Terminal experience, neutral surfaces, restrained Evergreen interaction color and restrained gold accents
**Document purpose:** Define exactly how Peak Terminal behaves from installation to retirement, how staff operate it every day, how it behaves online/offline, and what "production complete" means.

---

## 0. Authority of this document

This document is the product and operational constitution for Peak Terminal.

Implementation phases, UI screens, backend APIs, Rust modules, tests, deployment scripts, and agent execution plans must derive from this document. Existing code is evidence of current implementation, **not** the final product definition when it conflicts with this specification.

Do not redesign settled financial, security, offline, or authority invariants unless the repository proves an actual contradiction.

When this document conflicts with an older handoff, partial UI, prototype, mock, fixture, or phase checklist, this document wins unless a newer explicitly approved amendment exists.

Peak Terminal must never ship as a collection of technically correct screens. It must operate as one coherent hospitality terminal from power-on through shift close and Night Audit coordination.

---

# 1. Product definition

## 1.1 What Peak Terminal is

Peak Terminal is the native, high-speed hospitality point-of-sale application for Peak-managed properties.

It is responsible for:

- terminal/device identity and pairing;
- staff PIN access and staff switching;
- outlet/register context;
- opening and closing POS shifts;
- catalog browsing and product search;
- creating and managing orders;
- sending items to service/kitchen workflows where applicable;
- accepting supported tenders;
- durable cash-sale commitment;
- online Room Charge posting to a guest folio;
- operation during network degradation/offline periods when explicitly authorized;
- durable local outbox and ordered synchronization;
- reconciliation and governed exception handling;
- receipt/ticket printing through a native durable print queue;
- manager workflows and controlled overrides;
- shift cash accountability;
- coordination with the Hospitality business date and Night Audit;
- operational diagnostics and recoverability without exposing infrastructure complexity to normal cashiers.

Peak Terminal is **not** a browser POS. It is a native terminal application with a Rust-owned transaction core.

## 1.2 Product naming

Use **Peak Terminal** in the product UI and operational documentation.

The backend bounded context, package names, database objects, API paths, and historical engineering references may continue to use `POS` where appropriate.

Preferred product family presentation:

- Peak Platform
- Peak Hospitality
- Peak Terminal
- Peak Login

Do not make the cashier-facing UI feel like an engineering console called "Peak POS".

## 1.3 What Peak Terminal is not

Peak Terminal is not:

- a generic ERP;
- a hotel PMS replacement;
- a public payment wallet;
- a financial ledger authority separate from Peak backend truth;
- a cloud-only application;
- an Electron/browser wrapper around web POS semantics;
- a place for property administrators to edit arbitrary backend configuration;
- a place to expose API URLs, credentials, raw HTTP failures, SQL details, event IDs, or reconciliation internals to ordinary operators.

---

# 2. Product principles

## 2.1 Operational simplicity

The operator should understand the terminal within minutes.

The application must prefer:

- direct actions;
- clear current-state indicators;
- predictable navigation;
- large touch targets;
- minimal typing;
- safe defaults;
- clear consequences before destructive actions;
- fast recovery from common failures.

Routine cashier workflows must not require understanding Peak architecture.

## 2.2 Three-click operating principle

For frequent workflows, the operator should normally reach the desired action in no more than three meaningful interactions.

Examples:

- New sale: product → Pay → Cash.
- Resume order: Orders → order.
- Room Charge: Pay → Room Charge → eligible guest/stay + confirm.
- Reprint receipt: Orders → order → Reprint.
- Switch staff: staff control → PIN.
- View sync problem: connectivity/sync indicator → affected operation.

Manager and configuration workflows may be deeper where safety requires it.

The three-click principle must never override financial integrity or authorization checks.

## 2.3 Performance first

Peak Terminal must feel immediate.

The local transaction core, catalog, active-order state, print queue, and offline outbox must not depend on slow network round trips for local operations that are legally and contractually allowed offline.

Interaction targets:

- local navigation and UI state changes: perceptually immediate;
- product selection/cart updates: no visible network dependency;
- local cash commit: durable first, UI success only after durable commit;
- search within local catalog: near-instant;
- remote actions: explicit loading state without freezing the terminal;
- reconnect/sync: background by default, non-blocking unless an invariant requires blocking.

## 2.4 Truthful UI

Never show success before the authoritative action required for that workflow has succeeded.

Examples:

- offline cash success requires the immutable local financial commit and durable outbox insertion;
- Room Charge success requires backend folio posting confirmation;
- shift close success requires backend/local close invariants to pass;
- receipt printing success requires actual print-queue state, not simply clicking "Print".

## 2.5 Fail closed for authority, fail operationally graceful for infrastructure

Security, settlement, shift, entitlement, device, lease, key, and business-date invariants fail closed.

Infrastructure failures should degrade gracefully when the protocol permits it.

Example:

- internet loss + valid offline authority → continue supported cash operations;
- internet loss + no valid offline authority → show Online required;
- printer unavailable after completed sale → sale remains complete; print becomes recoverable queue work;
- Room Charge offline → unavailable; do not create a fake promise.

---

# 3. Experience and visual design standard

## 3.1 Quality bar

Peak Terminal must look and feel like a top-class production hospitality terminal, not an internal admin panel.

The visual experience must be:

- simple;
- beautiful;
- modern;
- sleek;
- highly polished;
- calm under pressure;
- operationally dense where useful but never cluttered;
- touch-first;
- consistent;
- accessible;
- deliberate in spacing, typography, hierarchy, motion, feedback, and empty/error states.

Every screen must be finished to production quality. Placeholder cards, developer copy, raw API terminology, fake data, dead controls, unfinished visual states, generic AI-looking dashboards, excessive gradients, neon effects, or decorative glassmorphism that reduces readability are not acceptable.

## 3.2 Peak Evergreen Terminal design language

Peak Terminal is **dark-first**.

Suggested anchors:

- Canvas: `#0A100D`
- Main surface: `#101713`
- Soft surface: `#151F1A`
- Raised surface: `#1B2821`
- Foreground: `#F2F6F3`
- Muted foreground: `#9BA9A1`
- Border: `#29372F`
- Evergreen primary: `#237A5E`
- Evergreen bright/action emphasis: `#56AE89`
- Restrained gold: `#D8B15D`
- Focus: `#67C29A`

Use green for interaction and success deliberately, not everywhere. Use gold sparingly for premium brand emphasis, terminal identity, selected highlights, and important non-error emphasis.

Red/amber must be reserved for actual risk, exception, destructive, or attention states.

## 3.3 Typography

- Operational UI: Inter or the product-standard sans serif.
- IDs, references, amounts where tabular clarity matters, device/diagnostic identifiers: Geist Mono.
- Use tabular numerals for money, times, counts, and shift figures.

Typography must remain readable at a distance on 1024×768 and common POS screens.

## 3.4 Touch and ergonomics

- Minimum touch target: 44×44 px; prefer 48–56 px for high-frequency POS controls.
- Primary tender controls must be large and unmistakable.
- Avoid tiny icon-only controls for important actions.
- Never require hover to discover a critical operation.
- Keyboard shortcuts are welcome but must not be the only path.
- Focus state must always be visible.

## 3.5 Motion

Motion should clarify state transitions, not decorate.

Use short restrained transitions for:

- page/rail selection;
- drawer/dialog appearance;
- state confirmation;
- order line changes;
- status updates.

Avoid long animated loaders and dramatic page transitions in transactional flows.

## 3.6 Production polish requirements

Every screen must define:

- loading state;
- empty state;
- success state;
- recoverable error state;
- permission-denied state where relevant;
- offline/degraded state where relevant;
- keyboard focus;
- touch behavior;
- small-screen/1024×768 behavior;
- large-screen behavior;
- high-contrast readability.

No screen is complete until these are implemented and certified.

---

# 4. Application architecture and ownership

## 4.1 Rust owns transactional truth

Rust/Tauri owns:

- local database access;
- SQLCipher lifecycle;
- order commit semantics;
- integer-money arithmetic;
- catalog verification/activation;
- signed bootstrap verification;
- trusted time authority;
- signing-key lifecycle;
- offline lease authority;
- settlement-claim enforcement support;
- monotonic operation sequencing;
- offline cash financial commit;
- durable outbox;
- sync/reconciliation engine;
- durable print queue;
- native printer communication;
- crash/restart recovery;
- native credential storage.

React must not reimplement these rules.

## 4.2 React owns operator intent and presentation

React owns:

- visual shell;
- operator navigation;
- forms and dialogs;
- product/catalog presentation;
- order presentation;
- safe local input collection;
- calling narrow Tauri commands;
- rendering Rust-owned authoritative state;
- accessibility and responsive behavior.

React must not:

- write SQL;
- compute authoritative money differently from Rust;
- fabricate reconciliation outcomes;
- infer offline permission independently;
- decide whether a financial operation is valid;
- silently mutate local durable state.

## 4.3 Backend ownership

Peak backend owns canonical server truth for:

- property/outlet/register/device identity;
- staff identity/permissions;
- settlement claims;
- shared/server-known orders;
- reconciliation materialization;
- server audit/evidence;
- folio Room Charge posting;
- shift/business-date cross-product invariants;
- device revocation;
- centralized operational oversight.

PostgreSQL remains authoritative server-side.

---

# 5. Terminal modes

A terminal must have an explicit configured mode/capability profile.

Minimum modes:

## 5.1 REGISTER

For cashier/service operations:

- active orders;
- new order;
- tender;
- receipt printing;
- shift operations;
- local/offline cash;
- Room Charge when online and entitled;
- sync state.

## 5.2 KITCHEN / SERVICE DISPLAY

For preparation/service workflows:

- incoming tickets/orders;
- item status;
- preparation timing;
- ready/served transitions where the backend contract supports them.

A Kitchen terminal should not expose tender/cash drawer controls merely because those components exist in the application.

## 5.3 MANAGER

Manager capability may be a mode and/or a role-aware workspace available on a Register.

It may expose:

- cash movement;
- shift oversight;
- variance review;
- void/refund/discount approvals;
- reconciliation cases;
- print queue and reprints;
- device status;
- controlled diagnostics;
- staff/session oversight.

Mode and role are not substitutes for each other. Device mode defines what the terminal is configured to do; staff permission defines what the signed-in person may do.

---

# 6. Complete terminal lifecycle

Peak Terminal has three distinct lifecycle layers:

1. installation/provisioning;
2. terminal startup/bootstrap;
3. daily staff operations.

They must not be mixed into one confusing onboarding flow.

---

# 7. Installation and provisioning

## 7.1 Installation principle

Normal cashiers must never type or understand the backend API URL.

Production builds receive the Peak environment/service endpoint from packaged configuration or an installer-controlled configuration path.

A raw screen such as:

`Server address → https://____ → Connect`

is **not** part of normal production operations.

It may exist only under:

- installer/service mode;
- development mode;
- diagnostics/recovery mode;
- explicitly protected configuration.

## 7.2 First installation flow

Target experience:

`Launch → branded splash → environment/bootstrap check → unpaired terminal → secure pairing`.

Pairing must establish:

- organization/property;
- outlet;
- register/terminal identity;
- device identity/epoch;
- configured terminal mode;
- allowed capabilities;
- printer/device configuration where required;
- secure local credentials;
- initial signed keyset/catalog/lease/bootstrap state where applicable.

## 7.3 Pairing UX

Pairing should feel operational, not technical.

Example:

**Set up this terminal**
Property: Peak Lodge Dodoma
Outlet: Restaurant
Register: Restaurant 02
Mode: Register

`[Confirm terminal]`

If pairing uses a code/approval flow, display short human-readable steps.

Never display raw bearer tokens, database IDs, private keys, or secrets.

## 7.4 Pairing failure

Provide actionable states:

- pairing code expired;
- terminal already paired;
- property/outlet disabled;
- terminal revoked;
- network unavailable;
- service unavailable.

Offer safe retry/restart paths.

---

# 8. Boot and startup lifecycle

## 8.1 Branded splash

Every normal launch begins with a polished Peak Terminal splash/boot surface.

It should communicate calm progress without exposing implementation details.

Example:

**Peak**
**TERMINAL**
Preparing this terminal…

The splash may show subtle progress stages only when startup is slow enough to justify them.

## 8.2 Startup checks

Behind the splash, the native core checks:

- local database integrity;
- encrypted-store availability;
- device identity;
- pairing state;
- terminal revocation state if known;
- trusted time state;
- signing keyset;
- active catalog;
- active/offline lease state;
- pending outbox/reconciliation state;
- printer configuration/state;
- current staff/lock state;
- current shift state;
- network/backend reachability.

## 8.3 Startup result routing

Conceptual state flow:

`STARTING → UNPROVISIONED | LOCKED | RECOVERY_REQUIRED | DEVICE_REVOKED`.

Normal paired terminal:

`STARTING → LOCKED → staff PIN`.

Do not route a paired production terminal back to server-URL setup.

---

# 9. Terminal state machine

The implementation must model terminal legality through explicit states.

Primary states:

- `STARTING`
- `UNPROVISIONED`
- `PAIRING`
- `CONFIGURING`
- `LOCKED`
- `AUTHENTICATING`
- `NO_SHIFT`
- `OPENING_SHIFT`
- `OPERATIONAL_ONLINE`
- `OPERATIONAL_DEGRADED`
- `OPERATIONAL_OFFLINE_AUTHORIZED`
- `SYNC_PENDING`
- `RECONCILING`
- `REVIEW_REQUIRED`
- `SHIFT_CLOSE_BLOCKED`
- `CLOSING_SHIFT`
- `RECOVERY_REQUIRED`
- `DEVICE_REVOKED`

Exceptional reasons include:

- lease expired;
- unknown signing key;
- key revoked;
- clock untrusted;
- catalog invalid;
- database recovery required;
- settlement claim invalid;
- manual reconciliation case;
- printer unavailable;
- business-date mismatch;
- shift closed remotely;
- device revoked.

The state machine must be enforced by the native core. The UI renders it.

---

# 10. Staff authentication and shared-terminal sessions

## 10.1 PIN-first operational access

After pairing/bootstrap, the normal staff journey is:

`Locked terminal → staff PIN → authorization/bootstrap → operational context`.

Do not make staff enter property IDs, organization IDs, or API configuration.

## 10.2 Staff switching

Shared-terminal staff switching must be quick:

`Staff control → Lock/Switch → PIN`.

Switching staff must preserve the device pairing but must not leak the previous staff member's privileged session.

## 10.3 Staff context

Once authenticated, clearly show:

- staff name/number;
- terminal/register name;
- outlet;
- business date;
- shift state;
- connectivity/sync state.

Do not overfill the header.

## 10.4 Session expiry

If the backend operational session expires:

- lock the staff session;
- retain safe local durable state;
- require PIN re-entry when possible;
- do not destroy pairing or unsynchronized operations.

---

# 11. Shift lifecycle

A POS shift is a first-class operational workflow, not a backend flag.

## 11.1 No-shift state

If the staff member is authorized but no shift is open, the terminal should present a focused Open Shift workspace instead of dropping them into a disabled register.

## 11.2 Open shift

Flow:

`PIN → No shift open → Open Shift → opening float → confirm`.

Capture:

- staff;
- outlet/register;
- business date;
- opening float if the outlet uses cash;
- timestamp;
- required manager authorization if policy demands it.

## 11.3 Operational shift

During an open shift, expose appropriate operational figures without cluttering the sales workspace.

Manager/shift summary may include:

- opening float;
- cash sales;
- refunds/void impacts;
- cash in;
- cash out;
- expected cash;
- pending sync count;
- open reconciliation cases;
- counted cash only during close where policy permits.

## 11.4 Shift close

Close Shift is a guided workflow:

1. pre-close checks;
2. expected-cash summary;
3. counted cash entry;
4. variance calculation;
5. variance reason/manager approval if required;
6. sync/reconciliation blockers;
7. final close confirmation.

Example:

**Close Shift**

- Opening float: TZS 100,000
- Cash activity: TZS 642,000
- Expected cash: TZS 742,000
- Counted cash: TZS 738,000
- Variance: TZS -4,000
- Pending sync: 0
- Blocking exceptions: 0

`[Close shift]`

## 11.5 Shift-close blockers

Shift close must fail closed when any required invariant fails, including:

- unsynchronized irreversible cash;
- open `MANUAL_REVIEW_REQUIRED` case affecting expected cash;
- unresolved required print/audit condition if policy explicitly requires it;
- invalid business-date relationship;
- backend-defined close blocker.

The UI must explain the blocker and provide a route to the required resolution surface.

A raw 409/500 is not an acceptable operator experience.

---

# 12. Main operational shell

## 12.1 Layout

The default Register workspace should use a high-efficiency three-zone layout where screen size permits:

1. compact navigation rail;
2. main workspace/catalog/order list;
3. persistent current-order rail.

Example:

`Navigation | Products / Active Orders | Current Order / Totals / Pay`.

The current order should remain visible while browsing products unless screen constraints require a deliberate compact mode.

## 12.2 Navigation

Register navigation should be short and role/mode-aware.

Typical items:

- Orders
- New Order
- Kitchen/Service where entitled and relevant
- Sync Center
- Manager where permitted

Diagnostics/configuration should not dominate normal navigation.

## 12.3 Header/status strip

Show only operational essentials:

- current time;
- business date;
- shift state;
- connectivity/sync state;
- terminal/outlet context where useful.

Do not continuously show raw event names or aggregate versions in production UI. Such data belongs in protected diagnostics.

---

# 13. Catalog and product discovery

## 13.1 Local-first catalog

The active signed catalog is local and must remain usable offline when the lease/protocol allows operations.

Catalog activation must be atomic and signature/digest verified.

## 13.2 Product browsing

Support:

- categories;
- fast text search;
- favorites/quick items if product data supports it;
- product availability state;
- modifiers/options where the domain contract supports them.

Use large product tiles or efficient list rows depending on terminal density.

## 13.3 Search

Peak Terminal does **not** use Meilisearch for local product discovery.

Use local SQLite/FTS5 or the approved local-search mechanism for immediate offline-capable catalog search.

---

# 14. Order lifecycle

## 14.1 Core lifecycle

At minimum:

`DRAFT → OPEN/SENT → TENDERING → CLOSED`

with controlled paths for:

- hold/resume;
- void;
- cancel where allowed;
- kitchen/service transitions;
- server-known/shared order settlement;
- locally-originated offline order commitment.

Exact backend state names must remain aligned with the canonical domain model.

## 14.2 Create order

Creating an order should be instantaneous locally when allowed.

Do not require unnecessary customer identity for ordinary outlet sales.

## 14.3 Order editing

Editing rules must follow order state and authorization.

Examples requiring higher authority may include:

- removing sent/prepared items;
- large discounts;
- void after tender;
- refund;
- reopening a finalized order.

Do not implement silent manager bypasses.

## 14.4 Active Orders

Provide a fast directory of active/held orders with:

- order reference;
- table/guest/room context where relevant;
- amount;
- age/time;
- status;
- staff;
- sync state if locally pending.

Opening an order should be one action.

---

# 15. Tendering

Tender options are capability-, connectivity-, entitlement-, shift-, and order-state aware.

The UI asks the native/backend authority what is currently legal.

## 15.1 Cash

Cash is the primary offline-capable tender where authorized.

The operator flow should be short:

`Pay → Cash → amount received/confirm → durable commit → success`.

Support change calculation where relevant, but authoritative money arithmetic belongs in Rust.

## 15.2 Room Charge

Room Charge is an online-only hospitality tender.

Flow:

`Pay → Room Charge → search eligible stay/room/guest → confirm folio context → post → success`.

Show sufficient identity/context to avoid posting to the wrong guest:

- room;
- guest name;
- stay status;
- folio reference where useful;
- amount to post.

If offline:

**Room Charge unavailable offline. Use Cash or reconnect.**

Do not create a deferred local Room Charge that pretends the folio has been charged.

## 15.3 Other tenders

Any additional tender must have an explicit authoritative contract before appearing in the UI.

Do not expose a tender merely because a backend enum exists.

---

# 16. Offline operating model

## 16.1 Offline is authorized, not assumed

Offline mode requires valid local authority, including the relevant combination of:

- paired active device;
- device epoch;
- trusted time;
- signed keyset;
- valid signed lease;
- active signed catalog/version/digest;
- staff/shift context;
- allowed operation set;
- ceilings/constraints;
- settlement claim for server-known/shared orders where required.

## 16.2 Offline UX

Offline operation should feel calm and boring.

Preferred operator state:

**Offline · 3 waiting**

or:

**Offline · Sales available**

Avoid exposing:

- transport stack errors;
- retry attempt internals;
- raw operation hashes;
- HTTP status codes;
- database details.

## 16.3 Offline cash commit

For allowed offline cash:

`order → cash received → authoritative Rust totals → immutable OFFLINE_CASH_SALE_COMMIT → local durable transaction + outbox → UI success`.

The local financial fact is durable before success is shown.

Network is not required after local cash commitment.

## 16.4 Locally-originated orders

A locally-originated offline order is self-authorized by its immutable order commit under the approved protocol and does not require a server settlement claim.

## 16.5 Server-known/shared orders

A server-known/shared order requires an exclusive settlement claim before offline cash settlement is offered.

Claim binds the canonical identifiers required by the backend contract, including terminal/device epoch/shift/order scope.

If no valid claim exists, the UI should show **Online required** before irreversible cash is accepted.

---

# 17. Synchronization and reconciliation

## 17.1 Native ownership

Rust owns synchronization.

The flow is:

`durable local outbox → ordered submit → server reconciliation → durable response persistence → local state transition`.

## 17.2 Ordering

Operations are ordered according to the protocol's device/epoch/monotonic sequence semantics.

## 17.3 Reconciliation outcomes

Support all canonical server outcomes:

- `ACKNOWLEDGED`
- `ALREADY_APPLIED`
- `RETRYABLE`
- `ACCEPTED_WITH_EXCEPTION`
- `MANUAL_REVIEW_REQUIRED`
- `REJECTED_NOT_COMMITTED`

Client behavior must follow the server contract exactly.

The UI must not reinterpret these outcomes.

## 17.4 Batch behavior

At minimum:

- `ACKNOWLEDGED` → continue;
- `ALREADY_APPLIED` → continue;
- `RETRYABLE` → persist retry/backoff and stop;
- `MANUAL_REVIEW_REQUIRED` → persist blocker and stop;
- other outcomes follow the canonical protocol.

## 17.5 Ambiguous response

Required certification:

`client sends → server commits → response lost → client retries byte-identical operation → server returns ALREADY_APPLIED → exactly one server-side financial result`.

This is a release blocker.

---

# 18. Sync Center

Sync Center is a first-class operational workspace, not a diagnostics afterthought.

## 18.1 Cashier view

Show safe operational truth:

- overall sync state;
- pending count;
- waiting/retrying operations;
- operations requiring manager attention;
- last successful synchronization;
- concise safe reason.

Example:

**Sync Center**

- Pending: 3
- Needs attention: 1
- Last synchronized: 14:37

Each row may show:

- order/reference;
- amount;
- created time;
- state;
- next retry where applicable.

## 18.2 Manager view

Managers may access richer governed context for manual-review cases, but still not raw secrets or unrestricted database/event payloads.

## 18.3 Connectivity indicator

The header indicator should summarize operational state:

- Online
- Syncing
- Offline · N waiting
- Attention required

The current dead/unreachable branch that prevents `Offline · N waiting` must be fixed.

---

# 19. Printing

Printing is a durable native subsystem.

## 19.1 Print architecture

`completed operational fact → durable print job → routing → native printer attempt → durable result`.

Printer failure must never roll back a completed sale.

## 19.2 Print queue states

At minimum:

- QUEUED
- PRINTING
- PRINTED
- FAILED_RETRYABLE
- AMBIGUOUS
- CANCELLED where legally/operationally valid

## 19.3 Ambiguous send

If the app cannot know whether bytes reached the printer, classify as `AMBIGUOUS`.

Do not blindly auto-reprint because duplicate physical receipts/tickets can create operational confusion or fraud opportunities.

Require an explicit operator/manager decision where appropriate.

## 19.4 Reprint

Reprint must be explicit, auditable, and clearly marked if business/legal policy requires a duplicate/reprint indication.

## 19.5 Printer configuration

Printer routing belongs to terminal/device configuration and may include:

- receipt printer;
- kitchen printer(s);
- bar/service printer(s).

Do not mix printer setup into normal cashier sales navigation.

---

# 20. Kitchen and service operations

Where the property uses kitchen/service workflows, Peak Terminal must support a dedicated operational surface or configured terminal mode.

Typical states may include:

- new;
- acknowledged;
- preparing;
- ready;
- served/complete.

Do not invent states not supported by the canonical backend.

Kitchen display must prioritize:

- readability at distance;
- order age;
- item grouping;
- modifiers/notes;
- urgency;
- clear completion actions.

No cash controls on a kitchen-only terminal.

---

# 21. Manager operations

Manager operations must be permission-gated and optimized for exception handling, not daily cashier clutter.

Possible workflows include:

- shift oversight;
- expected cash;
- cash in/out;
- variance approval;
- void/refund approval;
- discount approval;
- reconciliation cases;
- print queue/reprint decisions;
- device status;
- staff lock/switch oversight;
- controlled terminal diagnostics.

Critical manager actions require explicit confirmation and audit evidence.

---

# 22. Cash movement and accountability

Cash movement must be first-class if supported by the canonical backend.

Possible movement types:

- opening float;
- cash sale;
- refund;
- cash in;
- cash out/drop;
- counted close;
- variance.

Never compute expected cash solely in React.

Expected cash must derive from authoritative shift facts.

---

# 23. Business date and Night Audit

## 23.1 Authority

For hybrid LODGING + POS properties, Lodging Night Audit is the sole business-date advancement authority.

Peak Terminal must not independently advance the property business date.

## 23.2 Open-shift blocker

Night Audit must fail closed while any required POS shift remains open.

Peak Terminal should make this operationally visible before Night Audit becomes a surprise blocker.

## 23.3 Cross-product journey

Required certification:

`POS shift open → Hospitality Night Audit attempt → blocked with clear reason → POS shift closes after all sync/reconciliation invariants → Night Audit retries → business date advances → Terminal sees new business date on next authoritative refresh/bootstrap`.

No split-brain business date.

---

# 24. Device lifecycle and revocation

Device lifecycle:

`UNPAIRED → PAIRED/ACTIVE → SUSPENDED/REVOKED → RETIRED/REPAIRED under governed process`.

Revocation must invalidate the terminal's ability to obtain/use authority according to the signed protocol and revocation-generation rules.

A revoked device should enter a clear terminal state:

**This terminal has been revoked. Contact your property administrator.**

Do not show a generic network error.

---

# 25. Trusted time

Offline authority must use trusted server UTC anchor + monotonic elapsed time.

OS wall clock is not authoritative.

The terminal must detect or safely handle:

- wall-clock rollback;
- wall-clock jump forward;
- restart;
- missing/corrupt anchor;
- expired lease;
- inability to establish trusted elapsed time.

When trusted time cannot be established, fail closed for operations whose legality depends on time validity.

Property timezone is for business-date/presentation semantics, not cryptographic lease validity.

---

# 26. Signing key lifecycle

Terminal supports bounded keyset lifecycle such as:

- current;
- previous;
- next;
- `kid`;
- revocation generation.

Requirements:

- reject unknown `kid`;
- reject invalid signature;
- reject revoked/invalid generation;
- install verified keysets durably;
- activate replacements atomically;
- never store server private signing material.

---

# 27. Security model

## 27.1 Least privilege

Every backend request executes under the authenticated/authorized staff/device/property context required by the contract.

## 27.2 Secrets

Never expose secrets through React bundles, logs, dialogs, or diagnostics.

Native credential storage must use the approved secure storage mechanism.

## 27.3 PIN handling

No plaintext PIN persistence.

PIN authentication follows the canonical backend/native protocol.

## 27.4 Local database

Use encrypted durable storage as approved.

Crash recovery must never yield an impossible financial state.

## 27.5 Audit

Security-sensitive and financial actions must produce adequate server/local evidence according to ownership boundaries.

---

# 28. Failure and recovery matrix

The implementation and certification plan must cover at least:

- backend unavailable before order;
- backend unavailable during ordinary online operation;
- network loss before cash commit;
- network loss after local cash commit;
- network returns during pending sync;
- server commits but response is lost;
- app crashes before local financial commit;
- app crashes after local financial commit but before UI success;
- app crashes during sync;
- app crashes after server acknowledgement but before local response persistence;
- printer unavailable;
- printer ambiguous send;
- keyset corrupt;
- unknown signing key;
- lease expired;
- trusted-time failure;
- catalog corrupt;
- device revoked;
- shift closed/revoked remotely;
- settlement claim absent/expired/consumed;
- server-known order already resolved;
- manual reconciliation required;
- business date changed;
- disk full / local durable-write failure where realistically testable.

For every case define:

- authoritative truth;
- operator message;
- allowed actions;
- blocked actions;
- recovery path;
- audit/evidence expectation.

---

# 29. Diagnostics and service mode

Diagnostics must exist but be separated from normal operations.

Protected diagnostics may expose:

- environment endpoint;
- terminal/device identifiers;
- software version;
- backend reachability;
- local DB health;
- current catalog version/digest;
- lease validity summary;
- keyset `kid` summary;
- sync queue counts;
- printer state;
- last safe error codes;
- application logs/export where approved.

Normal cashier UI must not expose raw diagnostic internals.

The server-address editor belongs here or in installer mode, not in normal first-run production UX.

---

# 30. Information architecture and screen inventory

Minimum production screen set:

## Foundation

1. Branded Splash / Starting
2. Pairing / Terminal Setup
3. Recovery / Device Revoked
4. PIN Unlock / Switch Staff

## Shift

5. Open Shift
6. Shift Summary
7. Close Shift / Counted Cash / Variance
8. Shift Blocked Resolution

## Register

9. Active Orders
10. New Order / Catalog
11. Current Order
12. Tender Selection
13. Cash Tender
14. Room Charge
15. Sale Success / Receipt State
16. Order Detail / Reprint

## Sync / resilience

17. Connectivity state
18. Sync Center
19. Manual Review / Exception Detail

## Service

20. Kitchen / Service Display where applicable

## Manager

21. Manager Overview
22. Cash Movements
23. Approval / Void / Refund flows where supported
24. Print Queue
25. Device / Register status

## Technical

26. Protected Diagnostics
27. Protected Installer/Environment Configuration

The final actual inventory may expand if canonical backend capabilities require it, but no existing legitimate operation may be hidden merely to keep this list small.

---

# 31. Role-aware UX

Representative roles:

- cashier;
- waiter/service staff;
- kitchen operator;
- supervisor;
- manager;
- property administrator.

Roles/capabilities determine available actions, not separate duplicated applications.

High-risk actions may require manager authorization even when initiated from a cashier terminal.

Do not show controls that will predictably fail authorization for the current staff member unless there is a deliberate request/approval workflow.

---

# 32. Accessibility and usability

Target WCAG 2.2 AA where applicable to a desktop terminal application.

Requirements:

- visible focus;
- keyboard operability;
- sufficient contrast;
- semantic labels;
- screen-reader-safe status alerts where practical;
- no color-only meaning;
- minimum target sizes;
- readable at 1024×768;
- no critical action clipped at common terminal dimensions;
- robust zoom/text scaling within practical desktop bounds.

---

# 33. Performance and resource standards

Peak Terminal must remain responsive under ordinary hospitality load on modest terminal hardware.

Avoid:

- unnecessary React rerenders;
- giant client dependency bundles;
- expensive animations;
- network-bound product search;
- unbounded in-memory event history;
- polling when event/native notification is available;
- storing large sensitive payloads in the frontend state.

Use lazy loading for infrequent manager/diagnostic surfaces where useful.

Native/background work must not block the UI thread.

---

# 34. Observability

Production Terminal should emit structured, privacy-conscious operational telemetry where approved.

Useful signals:

- app version;
- terminal/device ID;
- property/outlet/register context;
- startup success/failure category;
- sync backlog count/age;
- reconciliation outcome counts;
- print queue failures/ambiguity;
- shift open/close failure categories;
- connectivity transitions;
- crash/restart indicators;
- local DB integrity/recovery events.

Never log PINs, access tokens, private keys, guest identity documents, or unneeded PII.

---

# 35. End-to-end certification journeys

A build is not release-ready until the actual native Tauri application is certified end-to-end.

## Journey A — first installation

`fresh install → splash → pairing → secure terminal identity → PIN → open shift → register`.

No API URL exposed to normal operator.

## Journey B — ordinary online cash sale

`PIN → open shift → product → order → Pay → Cash → durable sale → receipt → order closed`.

## Journey C — offline cash

`online bootstrap → valid keyset/lease/catalog → active shift → network removed → order → cash → immutable local commit → close/reopen app → sale still exists → network restored → sync → exactly one backend result → local ACKNOWLEDGED`.

## Journey D — ambiguous sync response

`server commits → response lost → restart/retry → ALREADY_APPLIED → exactly one financial result`.

## Journey E — server-known shared order

`online claim → network loss → valid offline settlement → reconciliation → claim consumed → second terminal cannot duplicate settlement`.

## Journey F — invalid claim after cash fact

`cash fact exists → claim invalid/consumed → MANUAL_REVIEW_REQUIRED → evidence retained → shift/date close blocked → manager resolves through governed process`.

## Journey G — Room Charge

`online → order → Room Charge → eligible in-house stay → folio post → success → Hospitality folio reflects charge`.

Offline attempt must be refused before fake success.

## Journey H — printer failure

`sale completes → print job queued → printer unavailable → sale remains complete → print queue shows failure → printer restored → controlled retry/reprint`.

## Journey I — ambiguous printer send

`bytes may have been sent → state AMBIGUOUS → no blind duplicate auto-print → explicit operator/manager decision`.

## Journey J — shift close

`active shift → expected cash → count → variance → all sync clear → close`.

## Journey K — close blocker

`pending irreversible cash or manual-review case → close attempt → blocked with actionable reason → resolution → close succeeds`.

## Journey L — Night Audit

`POS shift open → Night Audit blocked → POS closes → Night Audit advances business date → Terminal receives new date`.

## Journey M — device revocation

`active terminal → revoked server-side → next authoritative check → terminal enters DEVICE_REVOKED → new financial operations blocked`.

---

# 36. Testing requirements

## Rust/native

Continuously maintain:

- `cargo fmt --check`
- `cargo clippy --all-targets --all-features -- -D warnings`
- `cargo test`

No ignored clippy error is acceptable at the production gate.

## Frontend

Maintain:

- TypeScript typecheck;
- lint;
- unit/component tests;
- production build;
- accessibility checks;
- interaction/E2E coverage for critical screens.

## Actual Tauri

Run the real Tauri app under Xvfb/real supported desktop environment during certification.

Browser-only React tests do not certify Peak Terminal.

## Backend integration

Maintain the POS backend integration band, authority/RLS gates, OpenAPI validation, migration certification, offline reconciliation, settlement-claim tests, shift/date-close blockers, and cross-product contract tests.

---

# 37. Implementation phases derived from this master plan

These phases are implementation organization only. They do not override the operational model above.

## T1 — Shell and first-run correction

- branded splash;
- production endpoint hidden from normal operator;
- pairing flow polish;
- PIN unlock polish;
- explicit terminal state routing;
- fix dead connectivity `queued > 0` state;
- Peak Terminal branding;
- remove developer/event copy from production shell.

## T2 — Register UX completion

- polished dark-first operational shell;
- Active Orders;
- New Order/catalog/current-order rail;
- high-speed product search;
- tender UX;
- order detail/reprint entry point;
- role-aware controls;
- 1024×768 certification.

## T3 — Native offline runtime completion

- trusted time;
- bounded keyset lifecycle;
- sync transport;
- ordered outbox;
- outcome persistence;
- settlement-claim UI legality;
- restart/crash certification;
- complete offline-cash E2E.

## T4 — Sync Center

- operator-friendly connectivity state;
- pending/retrying/review states;
- manager detail;
- safe retry/recovery UX.

## T5 — Room Charge

- online guest/stay lookup;
- folio posting;
- clear offline-disabled state;
- backend + Hospitality cross-product certification.

## T6 — Native durable printing

- native print queue;
- ESC/POS/native adapter;
- routing;
- retry;
- ambiguous state;
- reprint;
- crash recovery.

## T7 — Shift/cash operations

- Open Shift;
- shift summary;
- cash movement if supported;
- counted close;
- expected cash;
- variance;
- close blockers;
- manager approval where applicable.

## T8 — Kitchen/service and manager operations

- configured kitchen/service mode;
- manager workspace;
- governed exceptions/approvals;
- print/reconciliation oversight.

## T9 — Hospitality/Night Audit integration

- business-date consistency;
- open-shift blocker;
- Room Charge verification;
- capability/entitlement behavior.

## T10 — Full security/failure/restart certification

Execute the complete failure matrix, crash points, ambiguous network responses, device revocation, key/lease/time failures, local-database restart/recovery, and printer ambiguity.

## T11 — Actual native product certification

Run complete journeys A–M against the real Tauri application and real backend dependencies required for each journey.

## T12 — Cross-product Peak certification

Certify Peak Login + Platform + Hospitality + Terminal boundaries and no cross-plane authority leakage.

---

# 38. Production-readiness gates

Peak Terminal is not production-ready until all are true:

- no developer setup screen in normal operator path;
- branded polished splash/pairing/PIN/shift/register experience;
- full cash online journey green;
- full offline cash journey green;
- ambiguous sync exactly-once journey green;
- Room Charge cross-product journey green;
- durable printing green;
- printer ambiguity behavior green;
- shift/cash close green;
- Night Audit integration green;
- device revocation green;
- trusted time/keyset/lease failures green;
- Rust fmt/clippy/tests green;
- frontend type/lint/tests/build green;
- actual Tauri certification green;
- accessibility/usability gate green;
- no placeholder/dead control/fake success state;
- no critical operation deeper than necessary;
- no raw infrastructure details exposed to cashier;
- production logging/telemetry contains no secrets;
- rollback/recovery procedures documented;
- release build reproducible.

---

# 39. UX acceptance standard

A technically working screen is not complete if it is visually rough, confusing, slow, or operationally inefficient.

For every major workflow, reviewers must ask:

1. Can a trained cashier understand the current state immediately?
2. Can the main action be completed with minimal navigation?
3. Is the highest-frequency control visually dominant?
4. Are money, status, business date, shift, and connectivity unmistakable?
5. Does failure explain what the operator can do next?
6. Does the UI remain calm during offline/degraded conditions?
7. Does the screen look intentionally designed and production polished at 1024×768 and larger common resolutions?
8. Are destructive/financially irreversible actions explicit?
9. Is the interface free of engineering/debug vocabulary?
10. Does every visible control work and correspond to a real contract?

If the answer to any critical item is no, the workflow is not finished.

---

# 40. Explicit prohibited shortcuts

Do not:

- expose `Server address` as normal production onboarding;
- use fake local success for Room Charge;
- let React own authoritative money or reconciliation rules;
- use browser storage as the financial source of truth;
- require cloud availability for operations explicitly authorized offline;
- silently auto-reprint ambiguous jobs;
- allow shift close with unreconciled irreversible cash or required blocking cases;
- allow Peak Terminal to advance the Lodging business date;
- use Meilisearch for Terminal offline catalog search;
- merge debug/fixture screens into production flow;
- leave critical clippy/test failures as "non-blocking" at release;
- present raw API/database/event errors to cashiers;
- add decorative complexity that reduces speed or readability;
- make high-frequency operations navigation-heavy;
- create duplicate financial materializations after retries/restarts;
- weaken device/staff/property/shift authority for convenience.

---

# 41. Current implementation reconciliation

As of the current project state, the backend offline-cash protocol and reconciliation foundation is materially ahead of the operator-facing Terminal product.

Known current strengths include:

- signed bootstrap/keyset/lease/catalog infrastructure;
- durable offline cash/reconciliation protocol;
- exactly-once/idempotent server materialization semantics;
- governed reconciliation outcomes;
- server-known order settlement claims;
- close blockers;
- Rust sync/bootstrap/offline foundation;
- existing Active Orders/New Order/Kitchen/Manager/Diagnostics surfaces.

Known product gaps to close against this master specification include:

- normal production flow still exposing a server-address setup screen when environment is not provisioned;
- unpolished boot/splash and first-run surfaces;
- incomplete end-to-end native Tauri certification;
- Sync Center not yet a first-class operator workspace;
- durable native printing incomplete;
- shift expected/counted/variance UX incomplete;
- Room Charge end-to-end certification incomplete;
- full Night Audit integration certification incomplete;
- remaining failure/restart/security matrix incomplete;
- dead connectivity branch preventing `Offline · N waiting` from rendering correctly;
- broader visual polish still below the target defined in this document.

These gaps must be closed without regressing the already-certified backend financial invariants.

---

# 42. Definition of complete

Peak Terminal is complete when a real property can install a terminal and an operator can execute the entire lifecycle without developer intervention:

`install → pair → lock → PIN → open shift → take orders → tender cash/Room Charge as allowed → continue authorized cash operation offline → reconnect and reconcile exactly once → print/reprint safely → resolve exceptions → count cash → close shift → allow Night Audit → start next business day`.

And throughout that lifecycle the product must remain:

- secure;
- fast;
- durable;
- correct;
- recoverable;
- simple;
- elegant;
- modern;
- polished;
- accessible;
- operationally efficient;
- auditable;
- production-grade.

That — not the number of implemented screens or passing unit tests — is the release definition of Peak Terminal.

---

# 43. Agent execution directive

When handing this document to Claude Code/Codex or another implementation agent:

1. Read this document before modifying Peak Terminal.
2. Inspect current repository reality before assuming a phase is missing.
3. Preserve existing certified offline-cash, reconciliation, settlement-claim, authority, and migration semantics.
4. Implement from the operator lifecycle outward, not from arbitrary component lists.
5. Keep Rust authoritative and React thin.
6. Use focused commits and isolated worktrees.
7. Never disturb another active workstream.
8. Do not deploy unless explicitly instructed.
9. Do not stop for routine UI/library choices that are already settled here.
10. Stop only for a genuine financial-integrity, security, migration, authority, or active-workstream collision.
11. No fake UI, no placeholder business flows, and no "we will do this later" for functionality required by this document.
12. Certify using the actual Tauri application, not only browser/unit tests.
13. Treat visual quality, interaction efficiency, accessibility, and operational simplicity as release requirements equal in importance to backend correctness.

---

**END — PEAK TERMINAL MASTER OPERATIONS & PRODUCT EXECUTION SPECIFICATION**
