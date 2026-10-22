# W6 · 0.1.4 release handoff

Codex prepared this checklist on W4 (`a7caa61`) before stopping at its usage limit on 22 Oct. Claude Code rebased it onto the finished W5 (till #58, backend #306, hotel #152) and added the release-review fixes below. Every unchecked item is still pending: Claude runs the merges, the release and the live check; the owner types the PINs.

## Review fixes in this PR (Claude Code, 22 Oct)

- One guard that no staff word or paper says "void" (screens parsed with vite's `parseAst`; every paper kind at 32 and 48 columns, both printer paths).
- Quick cash from every configured note (owner's 37,500 → 40,000 / 50,000 / 100,000 holds; 3,500 → 4,000 / 5,000 / 10,000), offline cash uses the outlet's notes, W3 words ("To pay", "Checking…", the split hint), and tests for the blind close, pick-is-not-pay and the notes reaching both sheets.
- Open-order chips say when the order was started (W4).
- A station's extra copies read "COPY 2 OF 3", never "printed again"; plain-text kitchen papers name their station and say the service in words.
- "It did not print": staff can resolve an uncertain paper either way; the native journal turns that attempt's UNKNOWN into NOT_SENT so Print again prints the job itself.
- Every guard above was broken on purpose and a test failed; the native one fails "unknown" vs "not_sent".

## Reconcile and merge in this order

- [ ] Owner rebases W6 onto committed W5; resolve version conflicts to 0.1.4 in all four manifests, inspect the complete diff and record W5 backend/hotel/till PRs and SHAs here. Do not invent W5 PR numbers.
- [ ] Claude reviews binding handover §§3/6, [W1](../till-w1/README.md), [W2](../till-w2/README.md), [W3](../till-w3/README.md), [W4](../till-w4/README.md), then W5 evidence. Historical fixture/unit results do not replace native, live or physical acceptance.
- [ ] Merge till [W1 #54](https://github.com/yetu6/peak-pos-desktop/pull/54), then [W2 #55](https://github.com/yetu6/peak-pos-desktop/pull/55). Retarget/rebase each child after its parent merges; require green checks on the resulting head. Till main does not release without a tag.
- [ ] W3: backend [#304](https://github.com/yetu6/fbc-peak/pull/304) → confirm master-tip deploy and live container SHA/schema/contract → hotel [#150](https://github.com/yetu6/peak-hospitality-web/pull/150) → confirm deployed SHA/settings → till [#56](https://github.com/yetu6/peak-pos-desktop/pull/56).
- [ ] W4, only after all W3: backend [#305](https://github.com/yetu6/fbc-peak/pull/305) → confirm deploy/context contract → hotel [#151](https://github.com/yetu6/peak-hospitality-web/pull/151) → confirm deploy/prompts → till [#57](https://github.com/yetu6/peak-pos-desktop/pull/57).
- [ ] W5, only after all W4: reconciled backend papers/fulfilment/branding → deploy and confirm contract → hotel editors/branding → deploy and check → till papers. Confirm actual scope and evidence against committed W5; missing work blocks release.
- [ ] W6 last: review final checklist and version-only change, obtain green checks and owner approval, then Claude merges. No Codex merge/tag/release/deploy.

## Migrations and gates before release

- [ ] Claude reads the actual deployed migration head read-only. Allocate unique new migrations **00130+** at merge: W3 00130 and W4 00131 are provisional; renumber W5 and any collisions above the actual head. Never reuse 00095, renumber an applied migration, or assume head is still 129. Update references and test the final sequence on a fresh local DB.
- [ ] Contract first; classify every new table/grant in `testdata/security/database-authority-matrix.json`; FORCE-RLS DML calls `app_assert_owner_policy`; no NOT VALID.
- [ ] Backend: gofmt clean, vet, archcheck, empty `deadcode -test ./...`, full tests with `source scripts/test-db-env.sh` and a unique `PEAK_TEST_DB`; skip only the documented local Meilisearch hang. Resolve failures and CI gaps recorded in #304/#305 before merge.
- [ ] Hotel: typecheck, lint, unit tests, build, Playwright against the production build. Till: typecheck, lint, full unit/contrast/guard-removal evidence, build, visual harness and native tests. No local Rust/Tauri build alongside CI on this machine.
- [ ] After W5 rebase rerun `scripts/verify-release-version.sh v0.1.4` and explicitly inspect the `peak-pos-desktop` package entry in `src-tauri/Cargo.lock` (the script checks only package.json, tauri.conf.json and Cargo.toml).

## Backup, upgrade, offline and recovery

- [ ] Before migrations, Claude records running SHAs/schema, creates a consistent database backup and proves restore in isolation; retain the previous signed 0.1.3 installer and stable manifest. Record backup location/checksum and restore evidence privately, without secrets in this document.
- [ ] Before till upgrade, stop the app cleanly; preserve its complete profile (data/config/cache, encrypted SQLite and any WAL/SHM/rekey-recovery files), pairing and OS keyring access. Record queue counts and printer settings. A DB file without its key is not a recovery plan.
- [ ] On an isolated copy, upgrade an existing paired 0.1.3 profile; retain identity, settings, catalogue, orders and pending operations. Confirm local schema 5 or the reviewed W5 successor, not an assumed schema number. Exercise crash/restart and encrypted-store recovery without clearing/re-pairing the profile.
- [ ] Offline with valid signed authority: sell cash, restart before sync, restore connection, replay twice. One sale, one payment and one stock movement only; completed order context and signed evidence stay immutable. Wrong/expired authority, unavailable key or corrupt store must refuse safely without discarding queued sales.
- [ ] Payment response lost: freeze body/key, retry that same request and reconcile server outcome; no second payment. Refusal and unknown outcome remain distinct; no new payment while uncertain.
- [ ] Reconcile before/after totals: quantities, VAT-inclusive prices, approved discount cap after adding items, partial/split payments, change, refunds within remaining caps, stock and blind shift cash. Compare till, backend records and hotel reports; investigate any difference before rollout.
- [ ] Recovery drill: stop rollout on mismatch; preserve current DB/profile/outbox and audit evidence before action. Claude chooses compatible forward fix or tested rollback. Never run 0.1.3 against an upgraded profile without proving schema compatibility; never restore an old production DB over new financial activity or replay a restored queue into production blindly. Reconcile later transactions first, with owner approval for production writes.

## Native till and physical printer acceptance

Run on the owner's Windows till with touch **and** mouse; record OS, app/backend/hotel SHAs, printer model/connection/firmware, width, timestamps, order/job references and outcome. Also smoke installed macOS/Linux builds. A TCP stand-in is supporting evidence, never physical acceptance.

- [ ] Switch three open orders; own orders first and correct amounts. Test optional tables/names and guests, takeaway omission and unchanged saved context after settings change. Every sheet exits with Back; no staff-facing “void”.
- [ ] Open shift with configured standardFloat; edits survive refresh. Exact cash needs no typing; manual entry, quick notes, live change, card/mobile prefill, split and partial payment still work; choosing an amount never confirms payment. Drawer opens on cash; manual drawer opening is audited. Close shift starts empty and stays blind.
- [ ] At **80 mm / 48 columns** and **58 mm / 32 columns**, physically print kitchen, bar, bill and cancellation slips; check wrapping, cut, quantities/options/notes, date, staff and optional guests. Preview matches decoded emitted text at each width; raster/control bytes are assessed separately.
- [ ] Print bar alone while kitchen items stay new; next send prints only its station's new items as the next ROUND / ADDED. Prepared → MAKE; Picked → HAND OVER; Direct → no production paper, but still counted financially/in stock. Product override/category inheritance works; no empty or duplicate station papers.
- [ ] NO_PAPER and kitchen-paper-off routes produce no physical paper and remain distinct from failure. Normal configured printers must not silently acknowledge unprinted work as done.
- [ ] Explicit station/bill reprint is auditable **COPY**, with time/person; configured station copy count is exact (default 1), retry does not multiply copies. Cancellation after send requires the correct supervisor and prints CANCELLED / DO NOT MAKE with reason/requester/approver, without prices.
- [ ] Bill says BILL, business name always present, correct VAT/discount/total, no TRA/fiscal wording or Yetu footer. **No automatic paper after payment**, including partial/final cash/card/mobile and recovered payment; guest receives the business's separate EFD receipt.
- [ ] Refund full/partial and replay after lost answer: one refund only, correct remaining cap, approval and balances. Inspect any explicitly requested refund paper/preview at both widths; no unsolicited post-payment paper. Missing W5 refund evidence remains a blocker.
- [ ] Logo default off per printer; enabled bill uses centred monochrome raster (576 dots at 80 mm, 384 at 58 mm, 203 dpi). No production-paper logo. Missing/bad/offline-cached image and image-incapable printer fall back to readable text with business name and correct money; no crash or lost bill.
- [ ] Printer powered off, paper out and network cable removed: visible Not printed / Print again, job remains recoverable, no false success. Restore printer and retry; prove original job identity and correct copies.
- [ ] Lose network before write, mid-write, and **after paper prints but before acknowledgement**. Record bytes/paper plus server job state. An uncertain physical outcome must remain visible; no silent acknowledgement or blind automatic duplicate. Explicit recovery/reprint is audited and marked COPY where applicable. TCP write success alone does not prove paper emerged.
- [ ] Supporting capture: use a local `socat` TCP stand-in on 127.0.0.1:9100, retain raw ESC/POS and decode with `readable()` from `src/print/escpos.ts`; compare preview/output for both widths. Keep this distinct from the real-printer results above.
- [ ] Attach final native screenshots for **1366×768 light**, **1366×768 dark**, **1920×1080 light**, **1920×1080 dark**: Sell/order bar, Pay, Orders/details, Kitchen, Cash/open/blind close, Status/sign-in, options/discount/cancel/preview and W5 printing settings. Capture before/after changed surfaces; paper stays white, no clipping, touch targets and Pay visible. Record touch and mouse journey results separately. Existing W1–W4 fixture images are references, not W6 captures.

## Claude release and sign-off

- [ ] Only after dependencies, recovery and acceptance gates pass and owner authorizes: Claude tags the reviewed main SHA **v0.1.4** and watches `.github/workflows/release.yml`. A tag or dispatch with create_release can publish; do not dispatch as a harmless check.
- [ ] Require all three matrix builds (Windows/macOS/Linux), release and publish-downloads jobs green. Inspect installer names/version/API URL and updater signatures; do not equate updater signing with Authenticode/notarization. Scripts collect → flatten → generate URL-encoded manifest → checksum → publish downloads; review their final W5 versions before execution.
- [ ] Verify GitHub assets and `/pos/0.1.4/`, `/pos/latest/`, `/pos/stable/latest.json`: 0.1.4, required platform entries, nonempty matching signatures, encoded URLs, HTTPS downloads and SHA256SUMS. Publication checks checksums first but replaces latest files and stable manifest separately; retain the previous manifest/artifacts for Claude's recovery plan.
- [ ] Test update from installed 0.1.3 at lock, relaunch and confirm 0.1.4 with pairing/data intact; rerun financial/no-post-payment-print smoke. Record release run URL, tag SHA, deployed backend/hotel SHAs, actual schema head, evidence links, unresolved issues and Claude/owner sign-off. Any unchecked acceptance item means release acceptance is pending.

Preparation evidence: four app versions set to 0.1.4; `scripts/verify-release-version.sh v0.1.4` passed; Cargo.lock app entry independently matched. No app build, live run, physical test, W5 validation or release was performed for this handoff.
