# T2 — Register UX completion: CLOSED

Reconciled against `PEAK_TERMINAL_MASTER_OPERATIONS.md`'s T2 bullets (Active
Orders, New Order/catalog rail, high-speed product search, tender UX, order
detail/reprint entry point, role-aware controls, polished dark-first shell,
1024×768 certification). As-built audit, not a rewrite — most of this was
already solid from prior work.

## Already correct (verified, not touched)

- Product search is genuinely local: `NewOrder.tsx`'s `useLocalCatalog()`
  calls Rust's `catalog()` Tauri command directly — zero network round-trips
  per keystroke, satisfying §33's "avoid network-bound product search."
- Tender controls (`.tender-tile`) already use `--control-height-prominent`
  (56px) — "large and unmistakable" per §15.
- Role-aware gating (`pos.payment.record`, `pos.cash_movement.record`,
  `pos.report.manager` + LODGING-capability exclusion) was already correctly
  composed throughout `ActiveOrders`/`Manager`.
- Reprint (`ReceiptView`) already calls the certified chained-reprint
  endpoint, never a new original.

## Gaps closed

1. **Design-system consistency** (first commit, `5d404f9`): 10 files
   (`SettleDialog`, `ReceiptView`, `VoidOrderDialog`, `RemoveItemDialog`,
   `CashMovementDialog`, `ItemModifierDialog`, `ActiveOrders`, `Manager`,
   `Kitchen`, `Diagnostics`) still used `index.css`'s own labeled
   "compatibility aliases" (`--color-text-*`, `--color-border`,
   `--color-gold`) instead of the canonical Peak Evergreen tokens T1's new
   screens already use. Migrated mechanically — value-equivalent per the
   alias chain, confirmed by an unchanged test suite before/after.
2. **Test coverage** (`5d404f9`): `ReceiptView`, `RemoveItemDialog`,
   `VoidOrderDialog`, `CashMovementDialog`, `Manager` had none. Added 15
   tests.
3. **Hardcoded currency defect** (this closure): `ActiveOrders.tsx` and
   `Manager.tsx` both hardcoded `const currency = "TZS"`, ignoring the
   outlet's actual catalog currency entirely — a real defect for any
   non-TZS property. `posMoney.ts:formatMinor` also carried a silent
   `currency = "TZS"` default parameter that no real call site relied on
   (every call site already passed one explicitly) but stood as a trap for
   a future one; removed, `currency` is now required. `NewOrder.tsx`'s own
   `catalog.data?.currency??order?.currency??"TZS"` carried the same
   trailing-fallback defect — the very "authoritative source" this fix was
   told to reuse — fixed by dropping the `??"TZS"` there too.

   Fix: `usePosData.ts` gained `useCatalogCurrency()`, reading the
   authoritative currency from the outlet's own fetched catalog
   (`POSCatalog` has no top-level currency field — Peak catalogs are
   single-currency per outlet, so any product's `currency` is the outlet's
   currency — exactly mirroring how the local-first path already reads
   `LocalCatalogView.currency` from the signed offline snapshot). No new
   currency setting was introduced. `posMoney.ts` gained `moneyFormatter()`,
   a display-safe formatter that shows "—" rather than guessing when
   currency genuinely is not yet known, used everywhere a component derives
   its own currency (`ActiveOrders`, `Manager`, `NewOrder`, `TillControls`).
   Components that receive currency as a prop from a parent that already
   knows it (`SettleDialog`, `LocalCashSettlementDialog`) keep it as a
   required `string` with no default — the caller decides when settlement
   is safe to offer, guarded (and the Settle action itself disabled) until
   then.

   Searched the full production source for equivalent hardcoded currency
   assumptions (`grep` across `src` for `"TZS"` and other ISO codes) —
   none remain outside test fixtures, which legitimately declare an
   explicit test currency rather than assume one.

   Regression fixtures added: `ActiveOrders.test.tsx` and `Manager.test.tsx`
   each gained a KES-outlet test proving amounts render in the outlet's own
   currency and never fall back to TZS — both would have failed against the
   pre-fix hardcoded literal.

## Gate

`tsc --noEmit`, `oxlint --deny-warnings`, `vitest` (161 passed, up from 144
at T2's start), production build — all clean. No Rust changes this phase.

## Known, out-of-scope gap (not fixed, flagged honestly)

None found beyond the currency defect above after the source-wide search.

**T2 status: CLOSED.**
