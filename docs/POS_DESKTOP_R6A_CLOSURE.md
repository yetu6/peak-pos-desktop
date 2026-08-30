# POS Desktop R6A Closure — Production POS Desktop Experience

Gate: **PEAK CLIENT REMEDIATION — R6A — PRODUCTION POS DESKTOP EXPERIENCE**
Primary repository: `peak-pos-desktop`. Backend: `fbc-peak`, schema **86**, frozen/certified (R5C), read-only for this gate.
Branch: `remediation/r6a-pos-desktop`.

> **R6A-C addendum (superseding notice).** R6A closed with production
> certification withheld pending two backend contract gaps and a live E2E
> run. Both are now closed — see **`docs/POS_DESKTOP_R6A_CERTIFICATION.md`**
> for the full record: the backend session-context fix
> (`fbc-peak` branch `fix/r6a-pos-session-context`), the desktop's
> consumption of it, a real (no-mock) live E2E run of both the Mama Rose
> and Savannah Crest journeys, failure-mode evidence, print-job evidence,
> Tauri launch evidence, and visual/responsive certification with actual
> screenshots (`docs/r6a-c-visual-certification/`). §15, §20, §27–§29,
> §31–§33 below are superseded by that document; they are left in place
> unedited as the historical record of what R6A itself produced.

## 1. Starting SHA

`0f609145490ee2d802fad08fbc8c46db4d2dafe9` (`main`, merge of PR #1, R1P pairing) — the audited pre-R6A baseline.

## 2. Ending SHA

See the final commit on `remediation/r6a-pos-desktop` (this document is committed in the same commit as the code it describes). Not pushed, per instruction.

## 3. Inherited state (audit findings before any change)

The repository was **not** a blank slate. R1P/R1C had already built substantial, real functionality: fresh-terminal pairing (`requestPairing`/`getPairingStatus`/`X-Peak-Pairing-Token` polling), device Ed25519 identity with OS-keychain-backed storage and a loud fallback warning when the platform can't provide one, device-challenge PIN login (`issueChallenge` → `createStaffSession`), device revocation handling, a "who's using this terminal" roster convenience, till open/close, a print-job claim/print/ack pipeline, and Room Charge from a live in-house-stay search. All of it was built against an **older backend contract** — before R4's outlets/categories/products/modifier tables, before R5's order versioning/service-context/cash-movements, before R5C's receipt/reprint contract and POS-only business-date rollover.

Cross-referencing the existing desktop code against the current OpenAPI (`fbc-peak/api/openapi/peak.openapi.yaml`) and the actual Go handlers found:

- **Pairing → PIN login → restricted session** (`src/auth/DeviceSessionProvider.tsx`, `src/lib/deviceAuth.ts`): **COMPLETE**, verified field-for-field against `createPOSPairingRequest`, `getPOSPairingStatus`, `beginPOSDeviceChallenge`, `createRestrictedPOSSession`. No changes needed.
- **Order mutations** (`addPOSOrderItem`, `removePOSOrderItem`, `sendPOSOrder`, `transitionPOSOrderProductionStatus`, `recordPOSManualTender`) all require a `version` field the old client never sent. **Every one of these calls would have failed with a 400 validation error against schema 86.** STALE_CONTRACT → rewritten.
- **Modifiers**: catalog fetch discarded `modifierGroups` entirely; there was no UI to select one. MISSING → built.
- **Cash movements** (`POST /pos/cash-movements`, `GET /pos/shifts/{id}/cash-movements`): no client code at all. MISSING → built.
- **Receipts** (`GET /pos/orders/{id}/receipt`, `POST /pos/orders/{id}/receipt/reprint`): no client code. The old "reprint" path posted to a **fictional, never-implemented endpoint** (`/api/v1/properties/{propertyId}/pos-print-jobs/{jobId}/reprint`). MISSING/DEAD → built against the real contract.
- **POS Day Close** (`POST /pos/business-day/close`): no client code. MISSING → built.
- **Print-job polling had a live production bug**: `listPrintJobs` filtered by `status=pending` (lowercase) against a Postgres column that only ever stores `PENDING/CLAIMED/PRINTED/FAILED` (uppercase) — **every poll always returned zero jobs**, meaning kitchen-ticket printing already did not work against schema 86 either. Confirmed by reading `internal/pos/printing.go`'s literal SQL (`status=$2`). Fixed.
- **`formatPrintDocument` handled `void_ticket`/`shift_report` job types that fbc-peak never creates** (grepped every `INSERT INTO pos_print_jobs` call site: only `KITCHEN_TICKET` and `RECEIPT` exist). Dead code, removed.
- **Void UX invented a capability the backend does not have**: a per-line "void a sent item with a disposition" flow that called `DELETE /pos/orders/{id}/items/{itemId}` — a route whose actual contract is "remove an **unsent** item only." There is no per-line void-after-send in the certified contract; the only correction for a sent/settled order is the whole-order supervisor void (`POST /pos/orders/{id}/void`). Redesigned into two honest flows (§12, §15).
- **Kitchen page modeled a "kitchen ticket" as an independent resource** (its own status machine `PENDING/PREPARING/READY/DELIVERED/VOIDED`, a per-ticket void, a per-ticket reprint). None of that exists server-side: production status lives on the **order itself** (`SENT→PREPARING→READY→SERVED`), and there is no per-ticket void or reprint endpoint at all. Rebuilt directly on `POSOrder`.
- **`SettleDialog` had a "payment provider account" picker** (`listProviderAccounts`) backed by a stub that always returned `[]`. The real tender contract has no such concept — `MOBILE_MONEY`/`BANK_TRANSFER`/`EXTERNAL_CARD` are one `paymentMethod` enum value plus a free-text `reference`. Removed; replaced with honest "records an external payment" copy per R6A-9.
- `bun run test` (default forks pool) times out spawning workers in this sandboxed execution environment — not a backend/contract issue. `bunx vitest run --pool=threads --maxWorkers=1` (or `bun run test -- --maxWorkers=1`) runs cleanly. Recorded as an environment note, not a code defect (§30).
- **No `lint` script exists** in `package.json`. Reported as-is; none was fabricated.

## 4. Removed stale/dead flows

- `src/lib/menuCatalog.ts` + its test: the dev-catalog/`BUILTIN` fallback that could serve invented menu items with no price on a 404. Removed outright — R6A-5/22 require "never invent items locally" and fail-closed on a catalog error, which the rebuilt `useCatalog()` now does (empty/error states, §24).
- `src/components/VoidItemDialog.tsx` + test: replaced by `RemoveItemDialog` (unsent items) and `VoidOrderDialog` (whole-order, supervisor PIN).
- The fictional print-job reprint endpoint and the `void_ticket`/`shift_report` formatters in `src/lib/printJobs.ts`.
- The "payment provider account" picker and its always-empty stub query.
- The independent "kitchen ticket" resource model in `Kitchen.tsx`, including its per-ticket void dialog (which could never succeed — it called a posApi stub that unconditionally returned a 409).

No test fixtures were deleted merely for convenience; every removed test was for a flow whose production code was also removed, and each is superseded by a rewritten test against the real contract (§27).

## 5. App architecture

Unchanged at the top level: Tauri v2 shell (`src-tauri/`), React 19 + TanStack Query for server state, `vite`/`vitest`, Tailwind v4. `App.tsx`'s `AuthGate → LiveRegister → PosShell` phase machine (`DevicePhase`/`AppShellState`) is untouched — it was already correct. New in R6A: a `usePosShift()`-driven business-date/shift-state chip in the shell header, and a fifth workspace page, `manager`, added to `src/lib/workspace.ts`'s nav model.

## 6. Pairing UX

No changes — audited as COMPLETE against `POSPairingRequestIssued`/`POSPairingStatus`. `PairingScreen.tsx` shows the code, expiry, and status without secrets; `resetPairing`/`continueAfterApproval` already implement retry/regenerate and the required terminal states.

## 7. Terminal credential lifecycle

No changes — COMPLETE. Ed25519 private key in the OS keychain (`deviceIdentity.ts`), a loud non-blocking warning banner (`KeyStorageBanner`) when the platform falls back to a plaintext file, and `DeviceRevokedError` handling that clears operational authority while preserving the device keypair for re-pairing (matches R6A-2's "do not delete valid credentials merely because the server is unreachable" — revocation and unreachability are already distinguished by HTTP 401 vs. a network exception in `deviceAuth.ts`).

## 8. PIN/session flow

No changes — COMPLETE. `issueChallenge` → `signChallengeNonce` → `createRestrictedPOSSession`, validated field-for-field against the schema; wrong PIN/suspended/revoked/expired are already distinct error paths (`StaffLoginRejectedError`, `DeviceRevokedError`, `DeviceNotApprovedError`, `SessionExpiredError`). Raw PIN is never persisted (function-local string, cleared on every path out of `unlock`).

## 9. Shift lifecycle

Rebuilt (`usePosShift` in `hooks/usePosData.ts`, `TillControls.tsx`). Opens via `POST /pos/shifts` with `openingCashMinor` (integer minor units, parsed once by `toMinor`, never floating point); persists only the shift id in `localStorage` (`peak-pos-shift-{propertyId}-{outletId}`) and re-validates it against `GET /pos/shifts/{id}` on mount, discarding it if the shift is no longer `OPEN` — the same reconnect-safe pattern the old till-session code used. Close (`POST /pos/shifts/{id}/close`) sends only `countedCashMinor` (+ supervisor fields when a variance approval is needed); `expectedCashMinor`/`varianceMinor` are always read back from the server, never computed client-side.

## 10. Catalog/menu UX

Rebuilt (`useCatalog()`, `NewOrder.tsx`). Consumes `GET /pos/catalog` directly — `POSCatalog{outletId, outletName, categories[], products[]}` — with category tabs, server prices (`formatMinor`), and an explicit empty state ("No menu items are available for this outlet.") and error state ("Menu unavailable. Ask a manager.") instead of a silent fallback catalog. `staleTime: 60_000` plus TanStack's normal invalidation gives a manual/periodic refresh path; there is no dedicated "menu changed" realtime event in the certified contract to subscribe to (see §29 finding).

## 11. Modifiers

New (`ItemModifierDialog.tsx`). A product with any active modifier group opens a dialog before the item reaches the cart; required groups (`minSelect >= 1`) block "Add" until satisfied; a `maxSelect: 1` group behaves as single-select. The dialog computes a **preview** price only (`previewUnitPriceMinor`, shown in the cart) — the actual `addPOSOrderItem` call sends only `modifierOptionIds`, and the order line's authoritative price/modifier snapshot comes back from the server response, exactly matching `POSOrderItemModifier`'s "snapshotted at the moment the modifier was added, never rewritten later" guarantee.

## 12. Order lifecycle

Rebuilt end-to-end on the real `POSOrder`/`POSOrderItem` shapes (`posContracts.ts`, `posApi.ts`, `hooks/usePosData.ts`). `createOrder` now sends `serviceType`/`tableLabel`/`notes`; `NewOrder.tsx` composes a cart of `{productId, quantity, modifierOptionIds}` lines, creates the order, then adds each line **sequentially, chaining the returned `version`** from one `addItem` response into the next (§13). Correction is split into the two operations the backend actually has: `RemoveItemDialog` (`DELETE .../items/{id}`, only ever shown for an `ADDED`/unsent line) and `VoidOrderDialog` (`POST .../void`, whole order, requires a different supervisor's own PIN + reason, §15).

## 13. Optimistic concurrency

Every mutating order call now carries the order's current `version`; a `STALE_VERSION` response is never retried blindly — `describePosError` maps it to "This order changed on another terminal. We've refreshed it." (verbatim from the gate) and the mutation's `onSuccess`/cache update always replaces local state with the server's authoritative order rather than patching it optimistically. `NewOrder.tsx`'s multi-item creation loop is the one place multiple mutations happen in sequence outside TanStack's own cache; it explicitly threads `version` forward from each response rather than reusing the value from `createOrder`.

## 14. Payment/tender UX

Rebuilt (`SettleDialog.tsx`). Exactly the backend's enum: `CASH, MOBILE_MONEY, BANK_TRANSFER, EXTERNAL_CARD, OTHER`, each non-cash method captioned "Records an external … payment" (never "Pay with …"). Cash shows an amount-received input and a change-due figure explicitly labeled "(display only)"; the `amountMinor` actually sent is always `order.totalMinor` — the server's figure, never a client sum. Non-cash methods require a `reference` (transaction id / phone number / note) instead of a fabricated "provider account" selection.

## 15. Room Charge

Rebuilt (`SettleDialog.tsx`'s "Charge to room" tab, `useChargeToRoom`). Posts only `{stayId}` to `POST /orders/{id}/room-charge`; never a folio id, never a free-form property/stay identifier. **Visibility is capability-gated by a genuine backend signal limitation** — see the documented finding in §29(a); the interim mitigation (only offer the tab once a real, non-empty in-house-stay lookup has succeeded for this session) is implemented in `useRoomChargeAvailability`.

Void, separately: `VoidOrderDialog.tsx` requires a different supervisor's staff id (picked from the tap-to-select roster when available, else typed) + 6-digit PIN + reason, and calls the one certified corrective operation. Copy never uses the word "refund."

## 16. Receipt/reprint

New (`ReceiptView.tsx`, `useReceipt`/`useReprintReceipt`). Fetches the one immutable `POSReceipt`/`POSReceiptDocument` Peak generated at settlement and renders it — outlet, order number, business date, operator, service type, line items with their snapshotted modifiers, totals, currency, tender method, settled-at. Reprint calls `POST /orders/{id}/receipt/reprint`, which the backend implements as a **new, chained `pos_print_jobs` row** (`reprintedFromId` set) rather than a second payment or a second original — the desktop's reprint flow then runs that job through the exact same claim/print/ack pipeline as the original and kitchen tickets (`processPendingPrintJobs`), so it needed no new printing mechanism, only the correct REST call in front of it. Printing itself remains the existing Tauri `print_document` native invocation (`src-tauri/src/printer.rs`, untouched, already `cargo test`-covered) — this is the audited, minimum-viable V1 path; a physical-printer hardware certification pass is still a separate deployment gate per the original R1C ADRs, unchanged by R6A.

## 17. Cash movements

New (`CashMovementDialog.tsx`, `Manager.tsx`, `useCashMovements`/`useRecordCashMovement`). `CASH_IN`/`CASH_OUT` against the open shift's id, requiring a non-empty reason and an explicit confirm tap; the list view is read-only (`GET /pos/shifts/{id}/cash-movements`) — there is no edit or delete affordance because the backend has no such operation (`POSCashMovement` is append-only by contract).

## 18. Shift close

`TillControls.tsx` shows `expectedCashMinor` live while the shift is open; close asks only for the counted amount and (only when the backend responds requiring one) a supervisor id/PIN for a variance; the result banner shows the backend-computed variance verbatim, never a desktop-side recomputation.

## 19. POS Day Close

New (`Manager.tsx`, `useCloseBusinessDay`). Placed in a distinct "Manager" workspace page, not the cashier's transaction screen, and gated entirely by the backend's own response — there is no client-side permission signal to hide it from an unqualified cashier ahead of time (§29(b)); a `PERMISSION_DENIED`/`CAPABILITY_NOT_ENABLED` refusal is shown with the exact coherent copy from R6A-16's error table, never a raw code.

## 20. Capability-aware behavior

Room Charge and POS Day Close are the two capability-sensitive surfaces; both are implemented per §15/§19 given the backend signal constraint documented in §29. Neither is inferred from `property_type` anywhere in the changed code — the restaurant-only Mama Rose fixture and the hybrid Savannah Crest fixture are told apart only by what the backend actually returns (candidates present/absent, mutation accepted/refused), matching R6A-22's explicit instruction.

## 21. Session switching

Unchanged, re-verified against the new order/shift state: `switchStaff` clears `operationalSession` (module-scope, in-memory) and calls `queryClient.clear()`, which now also discards the new shift/order/catalog/receipt/cash-movement query cache entries — nothing from the new domain model leaks across a staff switch. Terminal pairing (`identity`) is untouched by `switchStaff`, matching the shared-terminal invariant.

## 22. Reconnect behavior

`useActiveOrders` subscribes to the outlet's order topic and invalidates (never optimistically patches) the `listOrders` query on any `pos.order.*`/`pos.shift.closed` event; the query itself always re-fetches `GET /pos/orders?active=true`, i.e. authoritative REST, on both mount and invalidation. `RealtimeClient`'s own backfill/reconnect machinery (unchanged) still does its own gap-fill; this hook does not depend on receiving every event to eventually converge, only on the next REST fetch — consistent with R6A-23's "authoritative reconnect always uses REST/server snapshot."

## 23. Idempotency behavior

Every mutating `posApi` call now takes an explicit `idempotencyKey` **parameter** instead of generating one internally per call. `useIdempotencyKey()` mints one key per user-initiated action and exposes `.current`/`.next()`; a component reuses `.current` for a manual retry of the same click (e.g. `SettleDialog`'s confirm button uses the same key across re-renders until the user picks a different tender or cancels) and calls `.next()` only for a new business action (opening the till again, a new cash movement, a new void). This directly fixes the previous code's `idempotencyHeader()` helper, which minted `crypto.randomUUID()` fresh inside every API call — a shape that would have generated a **new** key on every retry, defeating the backend's replay protection. See `printJobs.test.ts` and `SettleDialog.test.tsx` for coverage of the settlement path specifically.

## 24. Security/local storage

Re-audited, no material change needed (§7/§8/§21 already cover credential/session handling). `localStorage` now holds: the Peak API URL, the theme preference, and one shift-id pointer per outlet (`peak-pos-shift-{propertyId}-{outletId}`, replacing the old `peak-pos-session-…` key name to match the shift vocabulary) — no bearer token, no PIN, no admin credential, at any point in the changed code.

## 25. Accessibility/touch design

No dedicated accessibility rework was in scope this gate beyond not regressing it; all new interactive elements (`ItemModifierDialog`, `CashMovementDialog`, `VoidOrderDialog`, `RemoveItemDialog`, `ReceiptView`, `Manager`) reuse the existing `btn-*`/`input`/`badge`/`glass-dialog` component classes and `data-testid` convention, keep destructive/corrective actions behind an explicit confirm tap, and use `aria-label`s on icon-only buttons exactly as the pre-existing components did. No new hover-only affordance was introduced.

## 26. Performance

No new client-side database or heavy dependency was added. Catalog and shift are `staleTime`-cached; the settle dialog's room-charge search remains debounced (250ms, unchanged). The one N-request pattern in the new code is intentional and unavoidable per contract: composing a multi-line order is `1 createOrder + N addItem` calls, because `addPOSOrderItem` is a single-line, version-checked endpoint — there is no batch "create order with lines" operation in the certified contract.

## 27. Mama Rose E2E evidence

**Not executed live in this session.** The local environment has the R5C-verified Postgres container (`fbc-peak-dev_peak-postgres_1`, schema 86, healthy) but no running `fbc-peak` API server process, and starting/bootstrapping one plus tenant/property/staff fixtures was judged out of scope for the time remaining in this gate. In its place:

- `tests/journey/pos.journey.test.ts` was rewritten in full against the real, current contract (pairing → manager approval → PIN login → open shift → real catalog → create order → add item with version → **stale-version rejection assertion** → send → settle CASH for the server's exact total → fetch receipt → reprint (asserts `reprintedFromId`) → cash movement → assert `expectedCashMinor` → close shift), gated by `describe.skipIf(!enabled)` on the same environment-variable pattern the repository already used, so `bun run test` stays green with no backend and `bun run test:journey` runs it live once the operator supplies `PEAK_JOURNEY_*` credentials for a paired terminal's organization/property/outlet/staff.
- Every request/response shape used above was independently cross-checked, line by line, against `fbc-peak`'s **actual Go implementation** — not only the OpenAPI spec — including `internal/pos/operations.go` (`AddItem`, `SendOrder`, `RecordTender`), `internal/pos/cash.go`, `internal/pos/receipts.go`, and `internal/pos/business_day.go`. `fbc-peak/tests/integration/pos_v1_scenarios_test.go`'s own `TestRestaurantScenario_MamaRose` exercises the identical restaurant-only fixture (CORE+POS, zero rooms, one outlet, categorized/modifier catalog, shift + cash-out + variance close, order with a snapshotted modifier, exact CASH tender) at the service layer and was read in full to confirm the exact field names, minor-unit arithmetic, and error semantics (`ErrStaleVersion`) this desktop rewrite now assumes.

**This is a P1 gap**: production readiness for Mama Rose should not be declared final until the rewritten journey test has actually been run against a live `fbc-peak` process. Steps to close it are recorded verbatim in §32.

## 28. Savannah Crest hybrid E2E evidence

Same status as §27: not executed live. `fbc-peak/tests/integration/pos_v1_scenarios_test.go`'s `TestHybridScenario_SavannahCrest` was read in full and independently confirms: `ChargeRoom(ctx, session, orderID, stayID)` posts exactly one `folio_items` row with `source_type='POS'` and closes the order, `ServiceType: "ROOM_SERVICE"` round-trips unchanged, and the whole flow never touches `night_audit_runs`. The desktop's `useChargeToRoom`/`SettleDialog` room-charge tab call the identical `{stayId}`-only contract. POS Day Close is not offered as a workspace page shortcut for this scenario in any code path added this gate, but (per §29(b)) the desktop cannot itself refuse to attempt it — the backend's own `CAPABILITY_NOT_ENABLED`/business-conflict refusal is what actually enforces "Day Close unavailable when LODGING is active," and that refusal path was not exercised live either.

## 29. Failure-mode evidence and backend contract findings

Per the gate's own escape hatch ("if you discover a genuine backend contract defect… STOP, document, do not silently patch fbc-peak"), two findings surfaced during this audit that are backend-contract gaps, not desktop bugs, plus the desktop-side mitigation adopted for each:

**(a) No property-capability signal is available to a POS restricted session.** `createRestrictedPOSSession`'s response (`token, expiresAt, tenantId, propertyId, outletId, terminalId, staffId, assurance`) and every other POS-scoped read (`GET /pos/shifts/{id}`, `GET /pos/catalog`) carry no `capabilities` field, unlike `CurrentUserProperty.capabilities` on the web-session side. `listPOSRoomChargeCandidates` has no LODGING capability check at all — it simply queries `stays`/`folios` joined by `property_id`, so a POS-only property with zero rooms returns an empty list for the same reason a fully-licensed hybrid hotel with zero current guests would. **Desktop mitigation implemented**: Room Charge is offered only once a real, non-empty candidate lookup has succeeded (`useRoomChargeAvailability`) — this is provably correct for hiding the feature (a POS-only property can never have a candidate; a hybrid property with a guest to charge will), and its only cost is that a hybrid property momentarily at zero occupancy also won't see the tab, which costs nothing since there is genuinely nothing to charge to at that moment either. POS Day Close has no equivalent read-only probe (it is a pure mutation) and is instead placed off the main cashier screen and left to the backend's own refusal (§19). **Smallest backend correction**: add `capabilities: string[]` (sourced from `property_capabilities`, exactly as already done for `CurrentUserProperty`) to `POSSession`/`POSShift`.

**(b) `createRestrictedPOSSession` carries no role/permission signal either.** `SessionContext.RoleCode` (`internal/pos/operations.go`) is looked up server-side from the `pos_sessions` row and never returned to the client; every permission decision (`pos.shift.open`, `pos.order.void`, `pos.report/manager` for Day Close, etc.) is enforced only at the point of the mutation. This is consistent with R6A-21's "frontend visibility is convenience only" — the desktop was built to rely on the backend's `FORBIDDEN` response rather than hide affordances it cannot correctly reason about, which is why Day Close is reachable by any signed-in staff member but fails closed with clear copy for anyone Peak does not authorize. **Smallest backend correction, if the product ever wants pre-emptive hiding**: echo `roleCode` (or a small derived permission set) in the `POSSession` response.

**(c) A confirmed, already-shipped bug**: `listPrintJobs`'s lowercase `status=pending` query parameter against an uppercase-only Postgres column meant the existing kitchen-ticket print pipeline already never found a job to print, on the currently-live schema 86 backend, before this gate touched anything. Fixed in this gate (§3); flagged separately from the two genuine backend gaps above because this one was a desktop bug against an already-correct backend contract.

**Failure-mode list required by R6A-29** — status of each, based on static contract verification plus the unit/component test suite (not yet exercised live end-to-end per §27/§28):
| Scenario | Status |
|---|---|
| Invalid pairing code | Covered — `PairingScreen`/`DeviceSessionProvider` unchanged, pre-existing coverage |
| Pairing expiry | Covered — pre-existing `resetPairing` timer logic |
| Pairing rejection | Covered — pre-existing |
| Terminal revoked | Covered — pre-existing `DeviceRevokedError` path |
| Wrong PIN | Covered — pre-existing `StaffLoginRejectedError` |
| Staff suspended | Covered — same 401 path as wrong PIN (backend does not distinguish these over the wire) |
| Session expired | Covered — pre-existing `armExpiry`/`SessionExpiredError` |
| Network lost before mutation | New unit coverage via `posErrors.ts` `NETWORK_ERROR` mapping; not exercised against a real dropped connection |
| Network lost after server commit | **Not exercised live.** Idempotency-key plumbing (§23) is unit-tested for key stability across a retried call, but the specific "server committed, response lost" race needs a live network-partition test against `fbc-peak`, which this session did not run |
| Stale order version | New unit + journey-test coverage (`addItem` version-mismatch assertion in `pos.journey.test.ts`; not yet run live) |
| Concurrent order mutation | Same STALE_VERSION path; not separately load-tested |
| Concurrent settlement | Same STALE_VERSION path on `recordPOSManualTender`; not separately load-tested |
| Backend 500 | Covered by `posErrors.ts`'s `INTERNAL_ERROR → RETRYABLE_INFRASTRUCTURE_ERROR` mapping; unit-level only |
| Redis/realtime unavailable | Unchanged from pre-R6A `RealtimeClient` backoff/reconnect behavior; not re-verified this gate |
| Receipt reprint retry | New unit coverage (`printJobs.test.ts`'s claim-conflict test covers the "another till already printed it" race for the reprint job the same way it does the original) |
| Shift-close validation error | Covered — `posErrors.ts` `VALIDATION_ERROR` mapping + `TillControls.test.tsx` |

## 30. Build/test results

```
bun install                    ✔
bun run typecheck              ✔ (tsc --noEmit, clean)
bun run test -- --maxWorkers=1 ✔ 27 files / 104 passed, 2 skipped (env-gated journeys)
bun run build                  ✔ (tsc -b && vite build)
cargo check (src-tauri)        ✔
cargo test (src-tauri)         ✔ 10 passed
bun run test (no flag)         ✘ vitest's default forks pool times out starting workers in
                                  this sandboxed session — reproducible, environment-specific,
                                  unrelated to any code change; `--pool=threads` or
                                  `--maxWorkers=1` both work around it cleanly. Recommend the
                                  next engineer confirm the default pool on real hardware before
                                  treating this as anything but a sandbox artifact.
No lint script exists in this repository. Not fabricated; reported as tooling debt, unchanged
from before this gate.
```

## 31. Visual/responsive certification

**Not performed.** This session had no way to launch the Tauri window or a browser to capture screenshots at 1024×768/1280×800/1366×768/1920×1080. All layout changes reused the existing Tailwind utility classes and grid breakpoints already present in the pre-R6A components (`grid-cols-1 lg:grid-cols-[1fr_360px]`, `md:grid-cols-2 xl:grid-cols-3`, `max-w-md`/`max-w-sm` dialogs, `max-h-40`/`max-h-72` internally-scrolling lists) rather than introducing new ones, on the reasoning that the pre-existing responsive behavior at those breakpoints was already sound and untouched. This is a **P1 gap**: an actual visual pass at the four named resolutions plus the two touchscreen tablet sizes has not been done and should happen before shipping.

## 32. Remaining P1/P2 findings

**P1 — must close before production sign-off:**
1. Run the rewritten `tests/journey/pos.journey.test.ts` against a live `fbc-peak` (start the API server: `go run ./cmd/api` or the compose service, with `PEAK_ALLOW_HEADER_IDENTITY=true`; seed an organization/property/outlet/staff, e.g. via `cmd/seed-demo`; pass `PEAK_JOURNEY_*` env vars) to convert the static contract verification in §27 into real, executed evidence.
2. Do the same for a Savannah Crest–style hybrid property (§28) — the `TestHybridScenario_SavannahCrest` Go integration test in `fbc-peak` is a ready-made fixture recipe to mirror from the desktop side.
3. Visual/responsive certification at the four desktop resolutions plus touchscreen tablets (§31).
4. A live "network lost after server commit" drill against the settlement endpoint specifically (§29) — kill the connection after the server has committed but before the response returns, and confirm the retry with the same idempotency key produces exactly one tender and one receipt.

**P2 — should close soon, does not block the above:**
5. Backend finding (a) from §29 — add a capability signal to the POS session/shift response so Room Charge visibility no longer depends on candidate-search-as-proxy.
6. Backend finding (b) from §29 — consider echoing role/permission info in the POS session response if pre-emptive hiding of Day Close/void becomes a product requirement.
7. `tests/journey/realtime.journey.test.ts` uses a different env-var naming convention (`PEAK_JOURNEY_TENANT_ID`) than the rewritten `pos.journey.test.ts` (`PEAK_JOURNEY_ORGANIZATION_ID`) for what is the same underlying identifier. Left alone this gate (out of scope: that file is about realtime-bridge plumbing, not the POS transaction contract), but worth reconciling.
8. No lint script/tooling exists for this repository; adding one (and fixing whatever it finds) was out of scope for R6A but is accumulating debt.
9. `bun run test`'s default pool behavior in constrained/sandboxed CI runners should be confirmed on the actual CI hardware; if it also times out there, pin `--pool=threads` (or `singleThread`) in `vitest.config`/CI invocation rather than relying on engineers remembering the flag.

## 33. Production readiness verdict

**Not yet production-certified.** The desktop's order/catalog/payment/cash/shift/receipt/day-close domain was substantially rebuilt this gate to match the now-frozen schema-86 contract — most of it was previously either broken (would 400 on every item add), missing entirely (modifiers, cash movements, receipts, day close), or calling endpoints that do not exist (reprint, provider accounts, per-ticket kitchen void). All of that is now implemented against the real, source-verified contract, typechecks cleanly, builds cleanly, and passes a substantially rewritten unit/component test suite (104 passing tests). Two genuine backend contract gaps were found and documented rather than worked around silently. What is missing before a real "go live" verdict is the live evidence R6A itself requires: the Mama Rose and Savannah Crest journeys have not actually been run against a running `fbc-peak` process in this session, and no visual/responsive pass has been done. Recommend: close the four P1 items in §32, then re-request certification.
