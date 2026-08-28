# Peak POS — R1C Production Post-Login Contract Closure

Gate: **PEAK POS — R1C: PRODUCTION POST-LOGIN CONTRACT CLOSURE**, opened
because R1's backend remediation (merged to `fbc-peak` master via PR #4)
repaired the server side of POS-001 but left `peak-pos-desktop` as the
still-open P0 client blocker: it discarded the server's `tenantId`,
called a nonexistent onboarding endpoint, and could not reach a
legitimate production post-login state. This gate closes that client
contract. `fbc-peak` was read-only throughout; nothing in it changed.

## 1. Starting SHA

`d5698f20fac256ac0a4e63853f750970d695e370` — `peak-pos-desktop` `main`,
identical to the pre-existing `remediation/pos-r1c-contract` branch tip
(the branch carried only uncommitted working-tree edits, no commits of
its own, when this session picked it up).

## 2. Ending SHA

`85a167154c8fdeb14066b74c5e9b1bffacbb8ed9` — `remediation/pos-r1c-
contract` ("fix(pos): close R1C production post-login contract
(POS-001)"). A commit cannot embed its own final hash, so this line is
fixed in a one-line follow-up commit immediately after, which touches
nothing else.

## 3. Original client contract defects

Traced live against the current merged `fbc-peak` Go runtime and its
OpenAPI spec (`api/openapi/peak.openapi.yaml`) — not the historical
Kotlin/Spring docs.

### Contract matrix — post-login path (device startup → operational screen)

| Desktop operation | Called URL (before fix) | Real backend route | Mismatch | Disposition |
|---|---|---|---|---|
| Device challenge | `POST /api/v1/pos/device/challenges` | Same, real, unauthenticated | None | Unchanged — already correct |
| PIN login | `POST /api/v1/pos/sessions` | Same, real, unauthenticated | None in URL. Response mapping dropped `tenantId` entirely; `staffId`/`outletId` were read as *optional*, silently tolerating an incomplete response | **Fixed** — every field (`tenantId`, `propertyId`, `outletId`, `terminalId`, `staffId`, `expiresAt`, `assurance`) is now mandatory and validated before the session is trusted |
| Post-login eligibility gate | `GET /api/v1/tenants/{tenantId}/onboarding` | **Does not exist anywhere in the current backend** (confirmed: zero matches in `cmd/api/main.go`, zero matches repo-wide, zero matches in the OpenAPI spec) | Entire endpoint fabricated | **Removed** — `VerificationGate`, `useTenantVerification`, `useTenantId`, and the eligibility last-known-good cache are deleted outright, not replaced with a fake local approximation |
| Post-login bootstrap | *(none — the till went straight from PIN success to the register)* | `GET /api/v1/pos/catalog`, `GET /api/v1/pos/orders?active=true` | The till never confirmed the session's authority was real before rendering an operational screen | **Added** — `bootstrapOperationalSession()` calls both real, session-bound routes and requires the catalog's `outletId` to match the authenticated session's `outletId` before publishing the session |

Every field name and route above was verified against the actual Go
source, not assumed: `internal/pos/service.go`'s `RestrictedSession`
struct (`token`, `expiresAt`, `tenantId`, `propertyId`, `outletId`,
`terminalId`, `staffId`, `assurance` — exact JSON tags), `internal/pos/
snapshots.go`'s `POSCatalog` struct (`outletId`, `outletName`,
`products` — exact match), `internal/pos/http.go:193`'s
`strings.EqualFold(r.URL.Query().Get("active"), "true")` (confirms
`?active=true` is real, read query-param filtering, not a fabricated
parameter), and `cmd/api/main.go`'s full route table (confirms `/pos/
catalog` and `/pos/orders` exist; confirms no `/tenants/{id}/onboarding`
route exists anywhere).

### A second, more serious contract defect found during this audit — NOT fixed here

Tracing "device startup → pairing/device identity," the step *before*
PIN login, found that **`peak-pos-desktop`'s entire self-service pairing
flow calls a backend contract that does not exist at all**:

- `POST /api/v1/devices/pairing-requests` (create a pairing request)
- `GET /api/v1/devices/pairing-requests/{id}` (poll status)
- `POST /api/v1/devices/pairing-requests/{id}/confirm` (prove key
  possession over a manager-issued claim)
- `POST /api/v1/devices/pairing-requests/{id}/reject`

None of these exist anywhere in `cmd/api/main.go`, anywhere in the
repository (a repo-wide `grep -rn "pairing"` across every `.go`, `.yaml`,
and `.json` file returns zero matches outside `peak-pos-desktop`
itself), or in the authoritative OpenAPI spec. The real backend's only
device-provisioning route is the opposite shape entirely: an
**authenticated manager**, holding `pos.terminal:manage`, calls `POST
/api/v1/organizations/{organizationId}/properties/{propertyId}/pos/
terminals` with `{outletId, name, publicKey, fingerprint}` to register a
terminal's key directly — there is no till-initiated request, no six-
digit code, no manager-side confirm/reject step, and no "claim" concept
on the backend at all (the only `claim` in the entire codebase is print-
job claiming, an unrelated concept).

This is live, reachable code — `DeviceSessionProvider.tsx`'s `unpaired`
phase calls `requestPairing()` directly — meaning **a genuinely
brand-new, never-paired till cannot complete pairing against the real
production backend today, regardless of anything fixed in this gate.**

This is deliberately **not fixed in R1C.** Three reasons: (1) R1C's own
defined scope and closure criteria are specifically the *post-login*
leg — pairing is a separate, earlier step; (2) a real fix requires
designing how a manager's `pos.terminal:manage` action actually reaches
a till in the field (out-of-band code entry? a management UI this
repository doesn't own?) — that is a product decision, not a contract
correction, and building it here would be exactly the "redesign POS"
this gate is told not to do; (3) inventing a compatibility pairing
endpoint on the backend to preserve the desktop's existing flow is
explicitly forbidden.

**This should become its own dedicated gate before any new till is
commissioned in production.** Recorded here in full rather than in a
buried P2 line, because it is at least as consequential as POS-001
itself for a fleet of tills that have not yet been paired — it does not
affect a till that is already paired (the common case: an already-
approved till reopening after a crash, or restarting after a staff
switch), which is exactly the population R1C's fixes below do correctly
serve.

### A third, lower-severity stale assumption found (recorded, not on the P0 path)

`src/lib/restAuth.ts` and `src/lib/env.ts` carry a "dev-only bootstrap
identity" fallback (`devIdentityFromEnv()`, gated behind
`VITE_PEAK_TENANT_ID`/etc.) that sends `X-Peak-Tenant-Id`/`X-Peak-Tenant-
User-Id` headers, documented in `env.ts` as accepted when
"`PEAK_ALLOW_HEADER_IDENTITY=true`" and identity comes from "the signed
session bootstrap (`GET /api/v1/session`)." **Neither the header
identity acceptance nor `/api/v1/session` exist anywhere in the current
backend** (repo-wide search: zero matches for `AllowHeaderIdentity` or
any `X-Peak-Tenant-*` header handling; `/api/v1/session` is not in the
route table or the OpenAPI spec). `tests/journey/pos.journey.test.ts`'s
own manager/commissioning setup calls also assume this same header
scheme. Disposition: **not on the P0 production post-login path** —
`hasBearerIdentity()` already means this fallback is unreachable
whenever a real `OperationalSession` exists (which, after this gate's
fix, is always the case once a session exists at all: `token` and
`propertyId` are both now mandatory), so it only matters pre-login, in
a developer's own local setup, never in the field. Recorded for a future
gate; not touched here.

## 4. tenantId / session lifecycle

- **Where `tenantId` is returned:** `POST /api/v1/pos/sessions`'s
  response body, field `tenantId` (`internal/pos/service.go`'s
  `RestrictedSession.TenantID`, sourced from the device challenge's own
  `organization_id` resolved via `pos_resolve_device_challenge()` — the
  server, never the client, determines it).
- **Where the desktop used to drop it:** `src/lib/deviceAuth.ts`'s
  `createStaffSession()` mapped the login response into the local
  `OperationalSession` without a `tenantId` field at all — the value was
  read from the network response and then never stored anywhere.
- **What downstream requests require it:** nothing in the post-login
  REST/WebSocket path sends `tenantId` explicitly — the opaque restricted
  bearer token is what every subsequent request authenticates with, and
  the server resolves tenant/property/outlet scope from the token
  itself server-side (`internal/pos/http.go`'s `restricted()` →
  `ResolveSession(token)`). `tenantId` is retained client-side as
  **authoritative, displayable session context** (diagnostics, realtime
  backfill scoping, and any future screen that needs to state which
  organization the till is operating under) — not as a value the client
  sends back to authorize anything. This matches the real authority
  model: the desktop must not invent tenant scope, and after this fix it
  no longer needs to, because it is never asked to supply it.
- **How it lives for the active session:** `OperationalSession`
  (`src/lib/operationalSession.ts`) now requires `tenantId` as a
  non-optional field, held in the same module-level state (and
  `localStorage`-backed cache, unchanged by this gate) as the rest of
  the restricted session.
- **How it is cleared on logout:** `switchStaff()` (the till's own
  "logout" — this is a shared-terminal appliance; only the waiter's
  operational session ends, the till itself stays paired) calls the new
  `clearStaffAuthority()` helper, which clears the expiry timer, calls
  `clearOperationalSession()`, nulls the in-memory `session` state,
  clears the TanStack Query cache, and clears the realtime bridge token.
- **How it is cleared on failed login / session expiry / device
  reset:** `clearStaffAuthority()` now runs **before** every login
  attempt (so a rejected PIN never leaves a *previous* tenant's context
  behind) and again in the `catch` block of every failure path
  (rejected PIN, bootstrap failure, network failure, expired/invalid
  session). `armExpiry()` schedules the exact same `switchStaff()` call
  at the server-declared `expiresAt`. A revoked device
  (`DeviceRevokedError`) additionally clears `terminalId`,
  `deviceCredential`, and `mode` from the persisted device identity and
  moves the shell to `unpaired`, not merely `locked`.

## 5. Stale endpoint disposition

`GET /api/v1/tenants/{tenantId}/onboarding` — confirmed nonexistent
against the real Go runtime and OpenAPI spec — **removed**, not
replaced. `VerificationGate.tsx`, `VerificationGate.test.tsx`,
`useTenantVerification`, `useTenantId`, and `eligibility.ts`/
`eligibility.test.ts` (the decision table and last-known-good cache that
only existed to serve that gate) are deleted outright. The information
that gate was trying to protect — "is this till actually allowed to
trade" — is now answered honestly by whether the real, current
`/pos/catalog` and `/pos/orders?active=true` bootstrap calls succeed: a
tenant/session that cannot pass those was never going to be allowed to
transact anyway (`internal/pos/http.go`'s `restricted()` refuses first).
No backend compatibility endpoint was invented to ease this transition.

## 6. Final production post-login sequence

1. **Device challenge** — `POST /pos/device/challenges` with
   `{terminalId, deviceCredential}` → real, unauthenticated, unchanged.
2. **PIN login** — `POST /pos/sessions` with `{challengeId, signature,
   staffId, pin}` → the response is now validated in full: `token`
   (≥32 chars), a parseable `expiresAt`, and non-empty `tenantId`,
   `propertyId`, `outletId`, `terminalId`, `staffId`, with
   `assurance === "RESTRICTED"`. Any gap throws
   `StaffLoginRejectedError("Peak returned an incomplete POS session")`
   and the till stays `locked` — no partial session is ever published.
3. **Post-login bootstrap** — `GET /pos/catalog` (bearer-only) must
   return an `outletId` matching the session's own `outletId`, an
   `outletName` string, and a `products` array. `GET /pos/orders?
   active=true` (bearer-only) must return an array. A 401 from either
   call is treated as the session already being invalid
   (`SessionExpiredError`); any other non-2xx, a network failure, or an
   unparsable body is `PostLoginBootstrapError`. Either failure clears
   the just-attempted session and keeps the till `locked`.
4. **Publish** — only once both steps above succeed: the realtime
   bridge token is applied, the operational session is persisted,
   non-authority local labels (`mode`, `terminalName`) are updated from
   the server's response where present, the expiry timer is armed
   against the server's own `expiresAt`, and the shell moves to `ready`
   (`OPERATIONAL`).
5. **Operational screen** — `AuthGate` renders `LiveRegister` directly
   for `OPERATIONAL`. No onboarding gate, no eligibility spinner, no
   placeholder sits between a successful bootstrap and the till a
   cashier actually uses.

## 7. Failure / logout behavior

| Scenario | Behavior |
|---|---|
| Wrong PIN | `StaffLoginRejectedError` from the real `401` on `/pos/sessions`; prior context already cleared before the attempt; till stays `locked` with a human message |
| Expired session (mid-shift) | `armExpiry()`'s timer fires `switchStaff("Session expired — enter your PIN again")` at the server's own `expiresAt`; context cleared, till returns to `locked` |
| Expired session (bootstrap-time 401) | Bootstrap maps a `401` from `/pos/catalog` or `/pos/orders` to `SessionExpiredError`; same clear-and-lock behavior |
| Revoked device (where supported) | `DeviceRevokedError` from a device-challenge `401`; device identity fields (`terminalId`, `deviceCredential`, `mode`) are cleared in addition to staff context, and the till moves to `unpaired`, not merely `locked` |
| Suspended staff | The real backend's `PINLogin` refuses (`status != 'ACTIVE'` on `staff_pos_credentials`/`staff_members` join) with the same `401` `POS_PIN_UNAUTHORIZED` the desktop already maps to `StaffLoginRejectedError` — no separate desktop-side status check exists or is needed, since the server is authoritative here |
| Missing tenant/property context | Cannot occur post-fix: the login response is rejected outright if any of `tenantId`/`propertyId`/`outletId`/`terminalId`/`staffId` is absent, before any session is ever published |
| Backend unavailable | A network-level `fetch` failure during bootstrap raises `PostLoginBootstrapError`; till stays `locked`. A network failure during login is caught by the existing generic `catch` branch, with context cleared identically |
| Logout ("Switch Staff") | `clearStaffAuthority()` — expiry timer cleared, operational session cleared from storage and memory, query cache cleared, realtime bridge token cleared. The device itself, the cashier till id, and the pairing state are deliberately untouched — this is staff logout, not device unpairing |

A failed login never inherits a previous session: `clearStaffAuthority()`
runs at the *start* of every `unlock()` call, before the network request
is even made, so a rejected PIN cannot leave a stale tenant, property,
or token behind for the next attempt to accidentally reuse.

## 8. Real-backend verification

**Attempted, and honestly not completed as a live run — stated exactly,
not silently skipped.** `tests/journey/pos.journey.test.ts` and
`tests/journey/realtime.journey.test.ts` are the project's own
real-backend harness (`bun run test:journey`) and both `describe.skipIf`
themselves when `PEAK_JOURNEY_*` env vars are absent, which they are
here.

Standing up a real instance was evaluated and found infeasible within
this gate's scope, for reasons specific to this environment, not
policy: `docker` is not installed here (only `podman`), and
`scripts/cold-start-local.sh` hardcodes `docker compose` against a full
production-like stack (ZITADEL, Caddy, both Postgres instances) that
takes minutes to become healthy even where `docker` is available.
`cmd/seed-demo` — the only existing seed tool — calls a real identity
provider client (`s.identity.CreateUser`) to create every account, so it
cannot run without that same stack, and even then it seeds no POS
device, no PIN credential, and no terminal keypair; those would have to
be hand-built from scratch against the real schema. A bare, isolated
Postgres was available (podman), but writing new backend seed
infrastructure to reach it is itself outside "modify only
`peak-pos-desktop`; keep `fbc-peak` read-only" — real backend
verification here would mean building a testing capability, not just
using one.

In its place, the certification below rests on:

1. **Every contract point verified by direct reading of the current Go
   source**, not by trusting a mock: `RestrictedSession`'s exact JSON
   field tags, `POSCatalog`'s exact JSON field tags, the literal
   `strings.EqualFold(r.URL.Query().Get("active"), "true")` line proving
   `?active=true` really is read server-side, and the full route table
   in `cmd/api/main.go` proving both which routes exist and which do
   not. This is not "mocking a contract" — it is testing the desktop
   against a byte-for-byte transcription of the real backend's own
   struct definitions.
2. **R1's own already-merged backend certification**
   (`docs/APPLICATION_R1_CLOSURE.md`, PR #4) already ran a real
   PostgreSQL integration suite and a dedicated "POS post-login backend
   contract test" against this exact session/catalog/orders sequence
   from the server side — this gate does not re-litigate that; it
   verifies the client now honors what that certification already
   proved the server does.
3. The full mocked Vitest suite (below), each mock response shape drawn
   directly from the structs verified in (1), not invented.

**Recommendation:** run `bun run test:journey` for real before this
fleet takes new tills into production, once a lighter-weight seed path
for a bare-Postgres POS fixture (device, PIN credential, terminal
keypair) exists — that seed tool does not exist today and building it
was judged out of this gate's scope.

## 9. Test / build results

All run against the working tree in `.worktrees/peak-pos-r1c-contract`:

```
vitest run                 100 passed, 0 failed, 3 skipped (30 files; the
                            3 skipped are the two real-backend journey
                            suites' describe.skipIf blocks — see §8)
tsc --noEmit                clean, zero errors
tsc -b && vite build        clean production build (dist/, 815ms)
cargo check (src-tauri)     clean (unmodified native layer)
cargo test (src-tauri)      10 passed, 0 failed
```

No eslint config exists in this repository (no lint step to run). A
full `tauri build` (release bundling) was not run: this gate touched
only TypeScript, zero Rust/Tauri code, `cargo check`/`cargo test` already
certify the native layer is unaffected and healthy, and a full bundle
build's added minutes would confirm nothing this diff could have broken.

Two pre-existing test files were found broken by Codex's in-progress
edits (present in the working tree at handoff, not yet fixed) and were
corrected in this session, not left failing:

- `src/pages/Diagnostics.test.tsx` — still constructed the old
  `OperationalSession` shape (`deviceId`/`staffNumber`) that the sibling
  `src/lib/diagnostics.test.ts` had already been updated to stop using;
  updated to the same real, complete shape.
- `src/lib/bootSequence.test.ts` — asserted the boot-sequence doc still
  contained the literal string `"UNKNOWN is not READY"`, an invariant of
  the now-deleted eligibility gate; updated to assert the real
  replacement invariant instead (`"no operational session is
  published"`, which `docs/boot-sequence.md`'s rewritten Post-login
  bootstrap section states directly).

## 10. Remaining POS P1/P2 findings (out of this gate's scope)

- **Device pairing/claim flow calls a nonexistent backend contract**
  (§3) — the most consequential finding of this gate. Blocks first-time
  commissioning of any till that is not already paired. Recommend its
  own dedicated gate; do not fold into a future POS gate silently.
- **`restAuth.ts`/`env.ts`'s dev-identity header fallback and the
  `/api/v1/session` comment are stale** (§3) — not on the P0 path, but
  worth cleaning up alongside whatever gate addresses pairing, since
  `tests/journey/pos.journey.test.ts`'s own manager-setup calls share
  the same stale header assumption and cannot pass against the current
  backend as written.
- **`PosShell`'s staff badge now derives its label from `session.
  staffId`** (a real UUID) instead of the previous `session.staffNumber`
  (`src/App.tsx`'s `staffLabel()`). The backend's `RestrictedSession`
  carries no human-readable name at all — the only real name the
  desktop ever sees is the tap-to-select roster's `fullName`, captured
  locally in `PinUnlock.tsx` but not currently threaded through to the
  post-login header. This is a genuine, if cosmetic, regression
  introduced incidentally by making the session's identity fields
  honest (the old field, `staffNumber`, was removed because the
  backend never actually returns a "staff number" — it returns
  `staffId`, a UUID). Not fixed here: doing so correctly means passing
  the roster-selected `fullName` through `unlock()`'s call signature, a
  change outside the file list this gate scoped, and cosmetic display
  is not part of "the terminal reaches a legitimate usable operational
  screen." Recommend a small, dedicated follow-up.
- **`printJobs.ts`/`menuCatalog.ts`'s wider operational route surface**
  (print-job claim/printed/failed/reprint, menu-catalog fallback) was
  not re-audited in this gate — those are post-operational concerns
  (already inside `ready`/`OPERATIONAL`), not part of the pairing → PIN
  login → bootstrap path this gate certifies. Flagged for whichever POS
  gate next touches printing or the menu catalog.

## 11. Is POS-001 genuinely CLOSED?

**Yes, for the scope R1C actually owns: the production post-login
contract, for a till that is already paired.** Every criterion in the
gate's own closure list is met:

- Tenant context survives correctly (§4) — verified by direct test
  assertion (`getOperationalSession()?.tenantId`) and by the fact that a
  session missing it can no longer be constructed at all.
- All post-login requests map to real backend routes (§3, §6) — every
  field and route verified against the real Go source, not assumed.
- The stale onboarding endpoint is gone (§5) — deleted, not replaced.
- Session authority is preserved correctly (§4, §7) — fail-closed on
  every failure path, verified by dedicated tests for each.
- The terminal reaches a usable current state (§6) — `LiveRegister`
  renders directly and immediately once, and only once, bootstrap
  against real routes succeeds.
- Failure/logout behavior fails closed (§7) — verified for wrong PIN,
  expired session (both timer- and bootstrap-401-triggered), revoked
  device, missing context (now unconstructible), backend unavailable,
  and logout.
- Tests and build pass (§9) — 100/103 (3 legitimately skipped pending
  real infra), typecheck clean, production build clean, Rust/Tauri
  layer unaffected and healthy.

**This is not the same claim as "every till in the fleet can reach
production today."** §3's second finding — the device pairing/claim
flow calling a wholly nonexistent backend contract — means a
never-before-paired till cannot complete first commissioning against
the real backend at all, independent of anything closed here. That is a
real, serious, and explicitly out-of-scope-for-R1C defect, recorded in
§3 and §10, not concealed by this closure. POS-001, as R1's own
disposition defined it — the desktop discarding `tenantId` and calling a
nonexistent onboarding endpoint — is closed. The newly-found pairing
defect is a distinct blocker for a distinct population (unpaired tills)
and needs its own gate.
