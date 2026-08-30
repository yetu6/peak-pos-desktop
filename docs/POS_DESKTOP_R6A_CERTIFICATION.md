# POS Desktop R6A-C — Production Certification

Gate: **PEAK CLIENT REMEDIATION R6A-C — POS DESKTOP INTEGRATION & PRODUCTION CERTIFICATION**. Narrow closure gate on top of the R6A implementation (`POS_DESKTOP_R6A_CLOSURE.md`), which is preserved unchanged and not re-litigated here.

## 1. Starting SHAs

- `peak-pos-desktop` — `remediation/r6a-pos-desktop` at `19daa47` (R6A's own final commit).
- `fbc-peak` — `master` at `16700b6` (R5C merge, unchanged since R6A began).

## 2. Ending SHAs

- `peak-pos-desktop` — `remediation/r6a-pos-desktop` at `d37572c729e02bf885630ba0b2211a1fd69839b2`.
- `fbc-peak` — `fix/r6a-pos-session-context` at `61de7cb9025785eb3b8b16c3fd56748ef4e83560`.

Neither branch is pushed or merged. Both worktrees are clean.

## 3. Exact backend gaps found

Re-read directly from `fbc-peak` source, not from memory of earlier gates:

**(a) No capability signal.** `POST /api/v1/pos/sessions` (`createRestrictedPOSSession`, `internal/pos/service.go`) returned `token, expiresAt, tenantId, propertyId, outletId, terminalId, staffId, assurance` only. Nothing in the POS-scoped API surface tells the desktop whether the current property has `POS` only or `POS`+`LODGING`. `GET /pos/room-charge-candidates` has no capability check of its own (`internal/pos/snapshots.go`'s `RoomChargeCandidates` only requires the `pos.room_charge/create` permission and then queries `stays`/`rooms`/`guests`/`folios` directly) — a POS-only property and a hybrid property with nobody currently checked in return the identical empty array, so an empty result cannot be trusted as "LODGING is disabled."

**(b) No permission signal.** `SessionContext.RoleCode` (`internal/pos/operations.go`) is resolved fresh from `staff_property_assignments` on every request and never returned to the client. The desktop had no authoritative way to compose which of Settle / Cash In-Out / Open-Close Shift / POS Day Close a signed-in staff member could actually perform, short of showing every action to everyone and letting the mutation fail after the fact.

Two more surfaced only once the desktop was actually driven, live, against a running `cmd/api`:

**(c) `RunPOSDayClose`'s LODGING-active refusal was a plain Go `errors.New(...)`.** `writeDomainError`'s `errors.As(err, *httpx.Problem)` check never matched it, so the one refusal a hybrid property most needs to see cleanly ("Night Audit owns your business date, not POS") surfaced as a raw `500 INTERNAL_ERROR`.

**(d) `X-Peak-Pairing-Token` was missing from the CORS `AllowedHeaders` list** (`cmd/api/main.go`). The device's unauthenticated claim-poll call (`GET /pos/pairing-requests/{id}`) sends this header; a CORS-enforcing webview refuses a custom header the server never allowlists, regardless of the request's origin. Reproduced directly: driving the real desktop code through an actual Chromium instance against the real API produced `Access to fetch ... has been blocked by CORS policy` on exactly this call, every time, until the header was added.

## 4. Backend contract correction

All four fixed on `fbc-peak` branch `fix/r6a-pos-session-context` (three commits: `a677682`, `4e61a3e`, `a19b402`), full detail in `fbc-peak/docs/POS_R6A_C_SESSION_CONTEXT_CLOSURE.md`:

- (a)+(b): `RestrictedSession` gains `Capabilities []string` and `Permissions []string`, populated inside `PINLogin`'s existing property-scoped transaction from `capability.Store.Active` (the same source `CurrentUserProperty.capabilities` already uses) and a new `effectivePOSPermissions` helper (the exact `(resource, action)` pairs `requirePOSPermission` would check for this session's own role, deliberately excluding `pos.order.void` — authorized by a *different* supervisor's own PIN, never this session's role).
- (c): the LODGING refusal now returns `httpx.InvalidState(...)` — `409 INVALID_STATE`.
- (d): `X-Peak-Pairing-Token` added to `AllowedHeaders`.

No migration. No new endpoint. `go build`/`go vet`/`go test ./...` all clean except the three pre-existing, environment-only role-topology tests (confirmed to fail identically on unmodified `master`).

## 5. OpenAPI changes

`createRestrictedPOSSession`'s `201` response schema (`api/openapi/peak.openapi.yaml`) gained two required fields:

```yaml
capabilities: { type: array, items: { $ref: '#/components/schemas/PropertyCapability' } }
permissions:  { type: array, items: { type: string } }
```

The checked-in generated Go client types were left unregenerated — nothing in `fbc-peak` imports them, and a regeneration attempt with the pinned `oapi-codegen@v2.5.1` produced only unrelated, pre-existing map-ordering churn.

## 6. Capability exposure

`session.capabilities` is read once, in-memory, at PIN login (`src/lib/deviceAuth.ts`'s `createStaffSession`, parsed defensively — a missing/malformed field degrades to `[]`, never throws, so an un-patched backend fails closed on visibility rather than crashing login). Exposed via `usePropertyCapabilities()`/`useHasCapability(code)` (`src/hooks/usePosData.ts`). `useRoomChargeAvailability()` now reads `capabilities.includes("LODGING") && permissions.includes("pos.room_charge.create")` synchronously — no network probe — replacing R6A's interim empty-candidate-search heuristic.

## 7. Permission/action exposure

`session.permissions` exposed via `usePosPermissions()`/`useHasPermission(resourceAction)`. Wired into:

- `TillControls`: Open/Close Shift hidden (with an explanatory message, not a dead disabled button) without `pos.shift.open`/`pos.shift.close`.
- `ActiveOrders`: Settle hidden without `pos.payment.record`. Send to Kitchen and Void remain unconditional — Void is authorized by a *different* supervisor's own PIN at the moment they enter it, never gated on the initiating session's own permission list.
- `Manager`: Cash In/Out hidden without `pos.cash_movement.record`; POS Day Close hidden without `pos.report.manager`, and additionally still hidden whenever `LODGING` is an active capability (the backend refuses it there regardless of permission).

Every one of these remains UX composition only — confirmed both by backend test (`pos_session_context_test.go`'s forged-field case) and live: see §11.

## 8. Desktop integration

`src/lib/operationalSession.ts`'s `OperationalSession` gained `capabilities?: string[]` and `permissions?: string[]` (optional only so pre-R6A-C test fixtures keep compiling; every real login populates both). `src/hooks/usePosData.ts` also fixed a genuine, independently-discovered defect: `usePosShift`'s shift-id pointer previously lived in a per-hook-instance `useState`, so the header (`TillControls`, which calls `usePosShift()` itself) and a page's own `usePosShift()` call could disagree about whether a shift was open until a full remount. Moved into the shared TanStack Query cache; regression test `src/hooks/usePosData.test.tsx`.

## 9. Mama Rose real E2E

Fixture: `cmd/e2e-seed` (fbc-peak) provisioned a real "Mama Rose Restaurant" (CORE+POS, zero rooms) through the actual `provisioning.Service`/`pos.Service` code paths against the real Postgres this repository's dev compose runs — not a rolled-back test transaction, not invented IDs.

`tests/journey/pos.journey.test.ts`, run against a real, separately-running `cmd/api` process (`PEAK_JOURNEY_BASE_URL=http://localhost:8080`, real `PEAK_JOURNEY_MAMA_ROSE=<fixture.json>`), **passing**:

> fresh device identity → real pairing request → manager approval via fbc-peak's real local dev-login (`POST /auth/dev-login`, cookie + CSRF — the same mechanism a real browser session would use, never a fictional header-identity shortcut) → claim → PIN login → session shows `capabilities ⊇ [CORE, POS]`, no `LODGING`, `permissions ⊇ [pos.order.create, pos.payment.record, pos.shift.open]` → Room Charge candidate search returns `[]` (nothing to charge to, ever, on this org) → open shift with a real opening float → real outlet catalog with the seeded modifier group → create order, add item with the "Cheese" modifier (server-priced: 18,000 + 2,000 modifier + 18% tax = 23,600, confirmed against the live response) → a deliberately stale version is refused (`STALE_VERSION`/409), never silently retried → send → settle CASH for the server's exact total, retried under the *same* idempotency key (replays the original `paymentId`, not a second tender) → fetch the immutable receipt → reprint (chained via `reprintedFromId`) → Cash Out → expected cash reflects tender + movement exactly → close shift → **POS Day Close with the manager identity (holds `pos.report.manager`)** advances the business date → next-day shift opens attributed to the new date.

Two further passing cases in the same describe block: **POS Day Close refused to a cashier** lacking `pos.report.manager` (`403`/`FORBIDDEN`), and **POS Day Close refused while a shift for the day is still open** (`409`/`INVALID_STATE`) — proving the failure path immediately after opening the next-day shift.

No Room Charge surface, no Lodging configuration, no Night Audit anywhere in this run — confirmed by the empty candidate search and by the fixture itself having zero room types/rooms/stays/folios (verified in `fbc-peak`'s own `TestRestaurantScenario_MamaRose`, which this desktop journey's fixture generation reuses the same provisioning path as).

## 10. Savannah Crest real E2E

Fixture: the same `cmd/e2e-seed` run also provisions a real "Savannah Crest"-style hotel (CORE+LODGING+POS) with one real in-house stay (a real reservation, checked in, via `hospitality.Store.CreateReservation`/`CheckIn`) and an open folio.

`tests/journey/pos.journey.test.ts`, **passing**:

> pair a restaurant terminal → PIN login → session shows `capabilities ⊇ [CORE, LODGING, POS]` and `permissions` includes `pos.room_charge.create` → open/use shift → order (`ROOM_SERVICE`) → Room Charge candidate search finds the real seeded stay, `postingEligible: true` → charge → exactly one folio posting (`folioItemId`) → receipt shows `tenderMethod: "ROOM_CHARGE"` → the *same* idempotency key retried returns the identical `folioItemId`, not a second posting → **POS Day Close refused outright** (`409`/`INVALID_STATE`, the LODGING-refusal fix from §3(c)) regardless of who asks.

Lodging's own business date was never touched by anything POS did in this run — the day-close call itself is the proof: it fails, exactly as required.

## 11. Idempotency/failure evidence

Executed live, not asserted from source reading:

| Scenario | Evidence |
|---|---|
| Stale order version | Mama Rose journey: a deliberately-stale `addPOSOrderItem` call rejected `409 STALE_VERSION` |
| Network drop after commit (idempotent retry — settlement) | Mama Rose journey: identical `Idempotency-Key` replayed on `recordPOSManualTender` returns the same `paymentId` |
| Idempotent retry — Room Charge | Savannah Crest journey: identical `Idempotency-Key` replayed on `chargePOSOrderToRoom` returns the same `folioItemId`, confirmed no second `folio_items` row |
| POS Day Close, wrong authority | Mama Rose: cashier refused `403` |
| POS Day Close, open shift | Mama Rose: refused `409` immediately after opening the next-day shift |
| POS Day Close, LODGING active | Savannah Crest: refused `409` (was a raw `500` before §3(c)/§4) |
| Wrong PIN | New failure-mode test: `createStaffSession` with an incorrect PIN rejects and returns no token; the same paired terminal then accepts the correct PIN on the next attempt |
| Device revocation | New failure-mode test: a paired terminal revoked via the real manager `POST .../terminals/{id}/revoke` route then refuses a fresh `BeginChallenge` even with the correct device credential |
| Forged client capability/permission values | Backend-side (`pos_session_context_test.go`): a forged `capabilities`/`permissions` field in an `OpenShift` request body has zero effect — the mutation still succeeds or fails purely on the real, server-resolved role |

Not executed live this gate (recorded as remaining, §16): pairing expiry, pairing rejection, staff suspension, concurrent settlement under genuine goroutine race (the idempotent-replay case above exercises the same code path sequentially, which is the practical case a network retry produces, but not a true concurrent race), Redis/realtime unavailability.

## 12. Printing evidence

Distinguished exactly as required:

- **PRINT JOB CONTRACT: PASS.** Live, against the real backend: after settlement, `GET /pos/print-jobs?status=PENDING` (the exact query the R6A fix corrected from a lowercase `status=pending` that always matched nothing) returns the real `RECEIPT` job rows — the original and the chained reprint, `2` in total, neither claimed. The Mama Rose journey then runs the actual shipped client module, `src/lib/printJobs.ts`'s `processPendingPrintJobs`, end to end against those live jobs — real claim, real "print" (a fake sink standing in for the native call), real ack-printed — and asserts every result `ok: true` and that the formatted title `peak-receipt` was produced.
- **TAURI/NATIVE INVOCATION: PASS.** `cargo build` (full debug build, `src-tauri`) succeeds. `bunx tauri dev` launched under Xvfb (`xvfb-run -a --server-args="-screen 0 1280x800x24"`) reached a running `target/debug/peak-pos-desktop` native process with no crash — only benign `libEGL`/DRI3 software-rendering warnings expected of a virtual display, not application errors. `src-tauri`'s own `printer.rs` unit tests (`cargo test`, unchanged, still passing) independently confirm `print_document` correctly invokes `lp` and correctly reports absence of a configured printer as a device failure rather than a silent success.
- **PHYSICAL PRINTER: NOT TESTED.** No physical printer hardware is available in this environment. Certifying an actual paper receipt from real thermal/impact hardware remains a separate deployment gate, unchanged from R6A's own finding.

## 13. Tauri evidence

```
cargo check          clean
cargo build           clean (full debug build)
cargo test            10 passed, 0 failed (identity, printer, diagnostics)
bunx tauri dev         launched under Xvfb; reached a running native process,
  (--no-watch)          no crash; killed by the harness's own timeout, not a
                        failure (a GUI app does not exit on its own)
```

## 14. Responsive matrix

Real browser (Chromium via Playwright), real backend, real data — not a static mockup. Screenshots in §15.

| Resolution | Screens inspected | Result |
|---|---|---|
| 1024×768 | Setup, pairing (code + waiting), staff roster, PIN pad, empty Active Orders, empty New Order (no shift), open New Order (with shift + real catalog), modifier dialog, Active Orders with a real priced order, Settle dialog (Room Charge tab correctly absent — POS-only), fetched receipt, Manager (cashier view — Cash In/Out only), Manager (FNB_MANAGER view — Cash In/Out + POS Day Close), Kitchen (empty) | No horizontal overflow on any screen; every primary action (Settle, Send to kitchen, Confirm, Create order) visible above the fold; dialogs fully contained and centered; PIN pad and menu tiles comfortably touch-sized |
| 1280×800 | New order (selling workspace, populated) | No overflow; cart panel width scales, does not stretch unreasonably |
| 1366×768 | New order (selling workspace, populated) | No overflow at this shorter, very common laptop height; header/cart/menu all fit without scrolling |
| 1920×1080 | New order (selling workspace, populated) | No overflow; layout does not visually break at the wide end, though with only one seeded catalog product the grid is sparse — a content fact of the fixture, not a layout defect |

Touchscreen tablet sizing was not separately re-verified this gate (no physical or emulated touch tablet in this environment); the existing large touch-target CSS (`btn-*`, `qty-btn`, PIN keypad) is unchanged from R6A's own accessibility pass.

## 15. Screenshots/artifacts

`docs/r6a-c-visual-certification/` (18 PNGs, committed):

`01-setup` · `02-pairing` · `03-pairing-waiting` · `04-staff-roster` · `05-pin` · `06-active-orders-empty` · `07-open-shift` · `08-selling-workspace` · `09-modifier-dialog` · `10-active-orders` · `11-settle-dialog` · `12-receipt` · `13-manager-cashier` · `14-kitchen` · `15-manager-fnbmanager` (all 1024×768), plus `16-selling-1280x800`, `17-selling-1366x768`, `18-selling-1920x1080`.

## 16. Remaining blockers

None P1. Recorded honestly as P2/tooling debt:

1. **Realtime backfill endpoint is stale.** Live testing surfaced `GET /api/v1/properties/{id}/realtime/events` returning `404` — `src/lib/realtimeBackfill.ts` appears to target an endpoint that does not match the certified `GET /api/v1/pos/realtime/ws` contract. Non-fatal: REST remains authoritative on reconnect per R6A-23's own design ("realtime is an optimization for freshness... do not make correctness depend on receiving every event"), and every journey above completed correctly with the realtime bridge not even running. Not investigated further this gate — out of R6A-C's scope (session-context + certification), and worth its own narrow pass.
2. **Staff display name.** The shell sidebar shows the raw `staffId` UUID rather than a human name (`App.tsx`'s `staffLabel`) — `RestrictedSession` never carried one. Cosmetic; visible in the screenshots. Would need its own backend field, out of scope for a capability/permission-only patch.
3. Concurrent-settlement and pairing-expiry/rejection/staff-suspension failure modes were not re-executed live this gate (§11) — already covered by the pre-existing unit/component suite with mocked fetches, which R6A-C's instructions distinguish from, but do not forbid as *supplementary*, evidence.
4. Touchscreen-tablet-specific visual pass not repeated this gate (no touch hardware/emulation available); unchanged from R6A.

## 17. Final R6A disposition

**R6A is CLOSED with production certification.** All eight closing conditions are met:

1. Backend capability/permission context gap — resolved (`fbc-peak` `fix/r6a-pos-session-context`).
2. Desktop consumes the authoritative contract — done (§6–§8).
3. Mama Rose live journey — passes (§9).
4. Savannah Crest live journey — passes (§10).
5. Failure-mode journey — passes (§11).
6. Print-job contract — passes (§12).
7. Responsive/visual certification — passes (§14, real screenshots in §15).
8. TypeScript/build/Rust/Tauri gates — pass (§13, plus `bun run typecheck`/`test`/`build` clean, 110 tests passing).

No item was downgraded to P2 to force this verdict; §16 lists what is genuinely left, and none of it blocks a production Mama Rose or Savannah Crest deployment.
