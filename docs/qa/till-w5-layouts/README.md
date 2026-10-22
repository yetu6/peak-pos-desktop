# W5 paper layouts and printer settings

Scope: kitchen/bar and bill formatting, ESC/POS raster output, logo conversion/cache, printer settings and their controls. No commits, releases, deployments or production writes performed by this layout worker. Other workers own jobs, native delivery, preview snapshots and contracts.

Reference lock: the owner's reconciled handover W5/§6, the existing W1 interface and `docs/qa/till-w1/README.md` research (Refero, 12UI, Superdesign). New controls use the existing switch, select, field and Lucide components, existing typography and spacing. No new visual system.

The latest owner instruction supersedes the earlier no-branding instruction: **Powered by Yetu-FBC** prints on every paper. Thermal footer type resets to normal size, centres and turns bold before the cut. Business identity remains above the bill and is independent of that signature. Paid bills say Thank you; unpaid bills retain the payment hint.

## Behaviour and interfaces

- KITCHEN ORDER / BAR ORDER, double-height title; round two onward says ADDED.
- PICKED under HAND OVER before PREPARED under MAKE. Missing fulfilment remains PREPARED. DIRECT is excluded; empty/direct-only paper emits no bytes. Kitchen daily numbers suppress the long reference; bills retain references.
- Quantity bold and large switches default on. `stationCopies(settings, station)` defaults to 1 and validates integers 1–3, bounded by `MAX_STATION_COPIES`.
- New printer choices prefer 80 mm; persisted legacy choices without a width retain 58 mm.
- Per-printer `billLogo` defaults off. No staff URL field. Authoritative branding is supplied by the hotel's backend; the integration worker owns preparation and property-scoped identity.
- `loadBillLogo(url, width, enabled, identity?)` fetches/decodes only when enabled; `cachedBillLogo(identity, width)` synchronously returns validated packed raster data. Cache persists across restarts, at most eight entries and 5 MiB, isolated by supplied identity and width. Unavailable cache/storage/image returns the text fallback.
- Raster uses GS v 0, 576 dots on 80 mm / 384 on 58 mm, packed MSB-first, alpha composited onto white. Tall images fit without cropping. Invalid raster is refused. The business name always remains text.
- Both copy paths retain actor/time. A copy rejects drawer opening even if the caller requests it.
- Backend `address` / `phone` map to internal `propertyAddress` / `propertyPhone`; earlier document field names remain compatible. Bill item columns explicitly label ITEM, QTY and AMOUNT and align supplied money words without recalculation.
- `renderPaperText(string | null)` styles headings and the footer, preserving exact decoded DOM text and null for an unavailable paper. Only the authorized rendering insertions changed the actual preview and W5 fixture.
- New wording is in `paperWords.ts`; the owner's signature is in `printBrand.ts`.

## Evidence

Tests were written and observed failing before implementation: original layout changes (seven failures), logo utility absent, settings controls absent, durable cache getter absent, bill contact fields absent. The isolated run recorded here passed **54 tests in seven files** before the subsequent explicit bill-column addition. The final bill-column/contact suite then passed **56 tests in seven files**. The renderer, bill and actual preview-sheet suite passed **44 tests in four files**; the nullable-text regression is recorded separately. Logs are included here.

`guard-results.json` and `guard-logs/` record actual source mutations followed by failing assertions. All mutated files were restored with `finally`. Sixteen currently applicable guards were killed; the earlier no-advertising proof is explicitly superseded. The footer and no-download proofs follow the final owner decisions. These are real deletion/alteration checks, not assertions merely added to the normal happy path.

Guard scope: Direct filter; empty-paper suppression; group order; quantity bold/size switches and their defaults; copies upper bound; copy drawer block; raster validation; persisted cache validation; footer styling; footer text; disabled-logo no-download; address mapping; thermal contact rendering.

Screenshots are fixture/browser observations, not live hardware or production acceptance. The full shared frontend and visual gates belong to the coordinating worker. No claim of physical printer, Windows, native image support or production verification is made here.

Recommended commit subject after coordination: `feat(print): add W5 paper layouts and printer controls`.

## Browser observations

`before/`: four W4 baseline printer screenshots served from the separate W4 checkout on port 5186. `after/`: four current printer screenshots plus four enabled-logo control screenshots, at 1366×768 and 1920×1080 in light/dark. The settings card was scrolled into view inside the existing app scroll area. `after/observations.json` records no horizontal document overflow, no manual logo URL field and the checked logo switch for all four combinations. Light settings and dark logo controls were visually inspected: existing navy controls, readable labels, 48px targets and Lucide print icons remain intact. The separate coordinating worker owns the final production-paper fixture captures and full visual harness.

## Owned files

Layouts/routing: `src/print/kitchenTicket.ts`, `receipt.ts`, `escpos.ts`, `kitchenRouting.ts`, `receiptRouting.ts`, `src/lib/kitchenTicketPrint.ts`, `receiptPrint.ts`. Settings: `src/print/printerSettings.ts`, `PrintersCard.tsx`. New helpers: `billLogo.ts`, `billColumns.ts`, `paperWords.ts`, `PaperText.tsx` and their related tests. Authorized display-only insertions: `src/register/PaperPreviewSheet.tsx`, `src/visual/W5Fixtures.tsx`. No edits to printJobs, native code or contracts by this worker.
