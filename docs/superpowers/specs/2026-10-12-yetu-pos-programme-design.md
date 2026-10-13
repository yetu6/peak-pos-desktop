# Yetu POS programme: design

Date: 2026-10-12 · Status: for owner review · Repositories: `peak-pos-desktop` (till), `fbc-peak` (backend),
`peak-hospitality-web` (hotel web app)

Research brief behind the visual decisions: `~/.claude/ui-polish/briefs/yetu-pos/till-redesign-2026-10-12.md`
(cited principles, references, copy). Design library note: `~/.claude/ui-polish/library/pos-tills.md`.

## 1. Goal

**A world-class, pilot-ready Yetu till.** One pilot hotel's restaurant or bar trades on it every day:
- a Windows all-in-one touchscreen and an 80mm thermal printer with a cash drawer;
- the hotel web app as the manager's view.

It must be fast, obvious to a first-day waiter, exact with money, and look like the Yetu family in both light and dark.

**Done means** observed on the owner's Windows PC, against production with a test business:
- install the published release and pair the till;
- sell by cash, mobile money, card (own machine) and room charge;
- print kitchen tickets and cut receipts, with the drawer opening for cash;
- refund chosen items with a supervisor;
- cash in and out, close the shift with a blind count, and close the day;
- the hotel web app shows every figure correctly.

The four new capabilities (§10) are done when the same is true of them.

## 2. Ground rules (owner, binding)

1. **The repositories are the authority, not the inspiration boards.**
   - Use backend-defined service types, modifiers, order states, permissions, currency, taxes and prices.
   - No Kenyan examples, no imaginary fees, no fabricated data.
2. **Protect the reworked backend and hotel web app.** Before changing any of their code:
   - read how that area works now: query shape, paging (`items/total/limit/offset`), caching, React Query keys, realtime invalidation, `components/yetu/*`, `lib/yetu/format`;
   - follow those patterns;
   - measure hot paths before and after; nothing gets slower.
3. **Existing till first.** The four new capabilities start only after the existing till is redesigned, complete and correct (slices S1–S11). Nothing in them may weaken the existing till.
4. **Vertical slices.** Each slice ships everything together:
   - backend contract and OpenAPI;
   - migration and authority-matrix entry;
   - authorization;
   - till UI and hotel web UI;
   - integration tests and rollout control.
5. **The offline boundary is fixed.** The certified offline cash register keeps working as it does. No new action becomes available offline unless its local authorization, storage, sync and reconciliation are designed and certified.
6. **Preserve the existing protections:**
   - device pairing and authorization;
   - PIN sessions and their expiry;
   - Rust/SQLCipher local storage;
   - idempotency keys;
   - audit records;
   - the money guards (append-only tenders, exact settlement, migration 00090).
7. **Gates on every slice:**
   - Go: `gofmt`, `go vet`, `archcheck`, `go test ./...` on a fresh database, `deadcode`, coverage floors.
   - Web: typecheck, lint, unit tests, build, Playwright.
   - Till: typecheck, lint, vitest, journey tests, `cargo test`.
   - **Guard-removal proof:** each new guard's test fails with the guard deleted.
   - Merge only on green CI; then confirm the live container runs the merge SHA and check the behaviour live.
8. **Honest status.** Every report says, per slice, *done and verified on the real system*, *done but only tested*, *gated*, or *pending*.

## 3. Audit: what the till has today

Read from `main` @ `600e519`. Screens were rendered from the dev fixtures at 1366×768 and looked at.

### 3.1 Device states (`DeviceSessionProvider` → `terminalRoute`)

| State | Screen | Backend / native | Notes and defects |
|---|---|---|---|
| Starting | `Splash` | `ensure_device_identity`, `local_store_status`, `load_peak_config` | "POS · TERMINAL · Preparing this terminal" |
| Server not set | `SetupScreen` | `save_peak_config` | Installer-only path. "Installer configuration" wording |
| Not paired | `PairingScreen` | `POST /pos/pairing-requests`, QR | Paragraph says "no property authority… bind it to the correct outlet" (jargon) |
| Waiting for approval | `PairingScreen` | `GET /pos/pairing-requests/{id}` | No visible steps or expiry; `Start over` only |
| Locked | `PinUnlock` | `POST /pos/device/challenges`, `POST /pos/sessions`; offline roster via `get_offline_staff_roster` / `authenticate_offline_staff` | Roster, PIN, or staff number. `OK` and `Unlock` duplicate each other. Keys 47px |
| Ready, no shift | `OpenShiftScreen` | `POST /pos/shifts` (`pos.shift:open`) | One field; wording "No shift is open on this register" |
| Ready, shift open | `PosShell`: nav + header + workspace | realtime WS + backfill | 175px sidebar. Header: clock in a code font, "Business date 2026-…" (machine date) |

Overlays in every state:
- `UpdaterBanner`, which waits until the shift is safe (`useShiftSafeUpdater`);
- `KeyStorageBanner` (raw red bar);
- `IdleLockOverlay` ("Locking in…").

Session expiry returns to Locked with "Session expired — enter your PIN again".

### 3.2 Workspaces by till mode (`workspaceNav`; the mode is chosen at pairing)

| Mode | Pages |
|---|---|
| POS | Active Orders, New Order, Kitchen, Manager, Status |
| CASHIER | as POS, without Kitchen |
| KITCHEN_DISPLAY / BAR_DISPLAY | Kitchen, Status (no nav rail) |
| Offline cash (temporary, from PIN unlock when Peak is unreachable) | New Order (offline register), Status |

### 3.3 Screens and dialogs

| Screen / dialog | Data and actions (hook → route → permission) | Defects seen |
|---|---|---|
| **New Order** (`NewOrder`) | **Data:** `useCatalog` → `GET /pos/catalog`. **Actions:**<ul><li>create order: `POST /pos/orders` (`pos.order:create`)</li><li>add item: `POST …/items` (`pos.order.item:add`)</li><li>remove item: `DELETE …/items/{id}` (`pos.order.item:remove`)</li><li>send: `POST …/send` (`pos.order:send`)</li><li>86 / sold out: `PUT …/availability`</li></ul> | <ul><li>Quantity numbers invisible on the receipt panel.</li><li>Ticket header invisible.</li><li>Subtitle "Live catalog · ticket settles exactly".</li><li>`TZS` in a code font.</li><li>Grid stops at 3 columns.</li><li>Pay without its amount.</li></ul> |
| Item options (`ItemModifierDialog`) | Groups with min/max from the catalog | Generic "Add to order" without the price |
| Remove item (`RemoveItemDialog`) | `pos.order.item:remove` | n/a |
| Discount (`DiscountDialog`) | `POST …/discount`, supervisor (`pos.discount:apply`) | Its own supervisor form (one of three copies) |
| Void (`VoidOrderDialog`) | `POST …/void`, a different supervisor (`pos.order:void`) | "This is a void, not a refund" |
| **Settle** (`SettleDialog`) | <ul><li>tender: `POST …/payments` (`pos.payment:record`), split allowed</li><li>room: `GET /pos/room-charge-candidates`, then `POST …/room-charge` (`pos.room_charge:create`, LODGING capability)</li></ul> | <ul><li>"Tender amount (blank = remaining)".</li><li>"Applied / change (display only)".</li><li>No quick cash.</li></ul> |
| Receipt (`ReceiptView`) | `GET …/receipt`, `POST …/receipt/reprint` | Calls itself "invoice". "Not a TRA fiscal receipt" |
| **Active Orders** (`ActiveOrders`) | `GET /pos/orders`; actions Send, Settle, Remove, Void | Cards; no search; no history of paid orders beyond "Settled this session" |
| **Kitchen / Bar** (`Kitchen`) | <ul><li>tickets: `GET /pos/station-tickets`</li><li>ticket steps: `POST …/status/{s}` (SENT → PREPARING → READY → SERVED)</li><li>order status transitions</li></ul>Station filter per terminal `prep_stations` | Columns: In queue / Preparing / Ready. No ticket age in words; no undo |
| **Manager** (`Manager` + `TillControls`) | <ul><li>cash movements: `GET`/`POST /pos/shifts/{id}/cash-movements` (`pos.cash_movement:record`); cash out needs a *different* supervisor (`pos.report:manager`)</li><li>close shift: `POST /pos/shifts/{id}/close` with counted cash and supervisor</li><li>close day: `POST /pos/business-day/close` (`pos.report:manager`)</li></ul> | "POS day close". The count shows the expected figure (not blind) |
| Cash in / out (`CashMovementDialog`) | as above | Third supervisor form |
| **Status** (`Diagnostics`) | `host_diagnostics`, `printer_status`, `print_test_page`, realtime state; operator / technician views | "Peak, realtime, and the printer — without secrets" |
| **Sync Center** (popover in `ConnectivityIndicator`) | <ul><li>`get_sync_state`, `retry_sync`</li><li>queued / reconciled / exception counts</li><li>lease, catalog, offline eligibility</li></ul> | Engineering words throughout ("Lease", "Reconciled operations", "Local financial evidence") |
| **Offline register** (`OfflineNewOrder`) | <ul><li>`get_local_catalog`, `get_or_create_order_draft`</li><li>`add_local_order_item`, `set_local_order_line_quantity`, `remove_local_order_line`</li><li>`commit_offline_cash_sale`</li></ul> | "Cash only · sales queue on this terminal until Peak is reachable" |
| Offline cash settlement (`LocalCashSettlementDialog`) | `commit_offline_cash_sale` | "Cash received · smallest currency unit" (minor units on screen) |

### 3.4 Platform

- **Theme:**
  - `ThemeToggle` stores `peak-pos-theme` in `localStorage` and sets body classes. Dark is the default.
  - Tokens in `src/index.css` are a vendored copy of the *older* `fbc-tokens.css`, with orange as the primary action. The hotel web app's current copy is the authority (ink `#10417c`, leaf `#37b342`, paper, night ramp).
- **Printing:**
  - `printer.rs` sends plain text through PowerShell `Out-Printer` on Windows (`lp` elsewhere). The printer comes from the `PEAK_PRINTER` env var.
  - There's no cut and no drawer kick, and staff can't choose a printer.
  - Temp file names use the process id, so two prints at once can collide.
- **Release:**
  - `release.yml` builds signed updater artifacts for Windows, Linux and macOS.
  - Tags `v0.1.0`/`v0.1.1` exist, but no GitHub Release was published.
  - Installers carry no Authenticode signature, so Windows SmartScreen warns.
- **Keyboard:** typing goes into search on New Order. There's no shortcut model, no visible focus design beyond defaults, and no command access.

### 3.5 Backend facts that shape the design

- **Orders:**
  - `orders` has `table_label` (free text), `service_type` (DINE_IN / TAKEAWAY / ROOM_SERVICE), `status` (OPEN, SENT, PREPARING, READY, SERVED, CLOSED, VOIDED), an order-level discount (AMOUNT / PERCENT, pre-tax, tax scaled by `scaleRound`) and `business_date`.
  - There's no guest count, no service charge and no tables entity.
- **Lines:** `order_items` carry a per-line `tax_minor` from the product's **own** `tax_rate_bp`, always added on top. The till ignores the property's `tax_rate_bp`, `service_charge_bp` and `prices_include_tax`.
- **Room bills:** room charges are priced by `kernel.PriceCharge`:
  - VAT and service are both worked out on the net, and service is not taxed;
  - inclusive or exclusive pricing;
  - one rounding rule (`TaxOf`).
- **Payments:** `pos_payments` is append-only and checked by `app_validate_pos_payment` (no overpay, open orders only). Split payment is supported. Cash adds to `pos_shifts.expected_cash_minor`.
- **Room charge:** posts **one** folio line, "POS room charge", qty 1, with `tax_rate_bp` defaulting to 0 (F-212). A room charge can't follow a partial payment.
- **Refunds:** there are none. `VoidOrder` refuses closed orders ("requires a refund workflow"). Migration 00090 refuses voiding any order that has taken payment.
- **Reports:** the `pos.report:manager` permission exists. The hotel web app reads orders, shifts and cash through `ListOrdersManagement`, `ListShiftsManagement` and `ListCashMovementsManagement`.
- **Schema:** `master` is at 00092 and P2.7 (draft #251) holds 00093–00094. 00095 is the number of P2.7's rejected payment-cache experiment; per the Codex handover it stays unimplemented and is not reused, so the evidence stays unambiguous. POS migrations take the next free number above every merged or open migration when each slice merges: currently **00096** onward.

## 4. Slices and order

| # | Slice | Repos | Depends on |
|---|---|---|---|
| S0 | **Baseline:** an unpublished installer of today's `main` on the Windows PC; run every existing journey; record the faults | till CI | none |
| S1 | **Design foundation:** tokens (light and dark), type, spacing, density, components, shell, keyboard model, theme setting, pixel-test harness | till | none |
| S2 | **Access:** startup, server setup, pairing, waiting, roster, PIN / staff number, idle lock, session expired, key-storage and updater banners | till | S1 |
| S3 | **Shift and cash:** open shift, cash in/out, close shift (blind count), close day, the shared *Ask a supervisor* sheet | till | S1 |
| S4 | **Register:** menu, search, ticket, service type, options, remove, discount, void, send, settle (quick cash, split, room charge), payment done, receipt | till | S1, S3 sheet |
| S5 | **Orders and kitchen:** Active Orders (open + paid today, search, detail with timeline), Kitchen/Bar display (age, bump, undo) | till | S1 |
| S6 | **Offline, sync, status:** offline register, cash settlement, Sync Center, Status/diagnostics, every error, permission-denied and recovery state | till | S1 |
| S7 | **Refunds by item** | backend, till, web | S4 (receipt), S5 (order detail) |
| S8 | **Thermal printing:** raw ESC/POS, cut, drawer kick, printer choice, receipt / refund / kitchen / shift layouts | till (Rust) | S1 |
| S9 | **Room-charge correctness:** F-212, the guest-bill line in words, one line per VAT rate | backend | none |
| S10 | **Hotel web Restaurant section:** Today, Orders (with refunds), Shifts, Cash, Menu, Devices, Outlets | web | S7 |
| S11 | **Release v0.2.0 and acceptance** on the PC (Authenticode if the owner buys a certificate) | till CI | S2–S10 |
| S12 | **Guest count** | backend, till, web | S11 |
| S13 | **Service charge** | backend, till, web | S11 (S9 folio work) |
| S14 | **Tables map** | backend, till, web | S11 |
| S15 | **Reports on the till** | backend, till | S12, S13 (so the figures include covers and service) |

**How the work runs:**
- S0 runs on the owner's PC while S1 is built.
- S7–S9 backend work can run beside S2–S6.
- Each slice ends with its gates and a live check, then a report.
- New capabilities ship behind their rollout control (§10), so they are off for every property until switched on.

## 5. Design foundation (S1)

### 5.1 Themes

- **Two equal themes:** *Light* (Yetu canvas, for bright dining rooms and receptions) and *Dark* (Yetu night, for bars at night and kitchens). Both are designed and tested at every size; neither is an inversion of the other.
- **Choosing a theme:**
  - The existing mechanism stays: the `peak-pos-theme` per-device preference in `localStorage`, persistent, switched from the top bar and from *More → Display*.
  - A device with no stored choice starts in *Light* for POS and CASHIER, and in *Dark* for KITCHEN_DISPLAY / BAR_DISPLAY.
  - That default is a named setting in `src/lib/displayDefaults.ts`.
- **Tokens:**
  - Replace the vendored `src/fbc-tokens.css` with the hotel web app's current copy.
  - Map semantic till tokens (`--surface`, `--surface-raised`, `--text`, `--text-muted`, `--action`, `--action-hover`, `--accent`, `--success`, `--warning`, `--danger`, `--focus`, `--line`) onto it for each theme.
  - **Action = Yetu Blue.** Orange is used for accents only (the brand mark and the *New* marker on kitchen tickets), never for ordinary buttons.
  - `peakTerminalFoundation.test.ts` is extended to hold every text/surface pair to WCAG AA in **both** themes, and AA-large for display figures.
- **Surfaces:**
  - Subtle, layered fills in the manner of premium desktop apps: canvas, panel and raised, separated by 1px lines and tone rather than shadows.
  - Shadows only for sheets and dialogs.

### 5.2 Type, spacing, sizes

- **Fonts:** Public Sans (UI) and Bricolage Grotesque (display figures), bundled locally as in the web app. Tabular figures for all money and counts.
- **Type scale:** 13 (technical details only) / 14 / 16 / 18 / 20 / 24 / 32 / 44. Body 16; nothing operational under 14.
- **Spacing:** 4px base, laid out on 8. Radius 6 (controls) / 10 (cards, sheets).
- **Touch sizes:**

  | Kind | Size |
  |---|---|
  | Minimum | 48px |
  | Frequent actions | 56px |
  | Primary money actions (Pay, Take cash, Approve) | 64px |
  | Menu tiles | 88px |
  | Keypad keys | 72px (64px at 1024×768) |

  At least 8px between targets.
- **Size classes**, the same layout scaled with no reflow of positions:

  | Size class | Width |
  |---|---|
  | `compact` | 1024–1279 |
  | `regular` | 1280–1599 |
  | `wide` | 1600 and up |

  Heights from 768.

### 5.3 Shell

- **Top bar (52px):**
  - outlet name;
  - who is signed in (opens *Switch person*, *Lock*);
  - shift in words (`Shift open since 07:02`);
  - connection and sync chip (`Online` / `Offline · 3 sales waiting to send` / `Sync problem`), which opens the Sync Center;
  - time;
  - theme switch.
- **Navigation rail (76px):** icon over label, for *Sell*, *Orders*, *Kitchen*, *Cash*, *Status*. *Tables* and *Reports* are added only when their slice is on and the person may use them. Items the mode doesn't include don't render. Items a person may not use are shown disabled with the reason on focus or press, not hidden, so positions stay stable.
- **Banners** sit under the top bar and never cover the ticket or Pay:
  - update ready;
  - key storage problem;
  - session about to expire;
  - offline.

### 5.4 Components (one system, `src/components/system/`)

- **Controls:** `Button` (primary / secondary / quiet / danger; sizes 48/56/64), `IconButton` (always labelled), `SegmentedControl`, `Tabs`, `SearchField`, `Field`, `MoneyField`, `Keypad`, `QuickCash`, `Stepper`.
- **Display:** `Tile`, `TicketLine`, `StatusChip` (word + colour + icon), `Money` (one formatter, `TSh 42,500`), `ListRow`, `DataTable`.
- **Containers:** `Sheet` (side / full), `Dialog`, `Banner`, `Toast` (never over the ticket), `EmptyState`, `Skeleton`, `KeyHint` (shows the shortcut).
- **Shared flows:**
  - `SupervisorApproval` replaces the three copies in Discount, Void and Cash. It states the request in words, lists supervisors, takes a PIN, refuses self-approval, and shows the result in words.
  - `PermissionNotice` says who can do this and what to do now.
- **Words and money:**
  - `lib/money.ts` formats `TSh` from minor units using the currency the backend returns. There's no hard-coded currency.
  - `lib/words.ts` maps every status and type to words: order statuses, ticket steps, payment methods, cash movement types and service types.

### 5.5 Keyboard and input

Every action has a mouse-free path; **"discoverable alternatives to mouse-only actions"** is satisfied by visible key hints.

- **Global:**
  - `F1` Sell, `F2` Orders, `F3` Kitchen, `F4` Cash, `F12` Status;
  - `Ctrl+L` lock;
  - `Ctrl+K` command search ("refund", "close shift", "printer");
  - `Esc` closes the top sheet.
- **Sell:**
  - letters type into search;
  - `↑/↓` move in results, `Enter` adds;
  - `+`/`-` change the selected line, `Del` removes it;
  - `Ctrl+Enter` sends to kitchen, `F9` Pay.
- **Pay:**
  - digits type the amount;
  - `E` exact, `1–3` quick-cash amounts;
  - `Enter` confirms.
- **Focus:** a visible 3px ring in the action colour on every focusable element; focus order follows reading order.
- **Gestures:** long-press actions (sold out) also have a menu item. Swipe is never the only way.

### 5.6 Feedback and motion

- **Speed:** pressed state within 100ms; screens change within 400ms; no spinner on Sell.
- **Changes:**
  - Order changes appear at once.
  - Server confirmation keeps the version check.
  - A refusal puts the line back and says why in words (`posErrors.ts` mapped to plain messages).
- **Motion:** only to explain. Sheets slide from their side and the paid tick draws in 200ms. `prefers-reduced-motion` is respected.

### 5.7 Pixel testing

- A fixture harness (extending `src/visual/*`) renders **every screen and state** with real-shaped data from the backend contracts:
  - at **1024×768, 1280×800, 1366×768 and 1920×1080**;
  - in **both themes**.
- **Playwright screenshot tests** run in CI over the fixtures.
- **Checks in tests:** no text under 14px, no target under 48px, no horizontal overflow, axe clean.
- Each batch is also run in the **real Tauri app**, `tauri dev` on Linux and the installed build on the Windows PC, and judged from those pixels.
- The till joins ui-polish (`projects.json`) so `/ui-sweep` and `/ui-compare` work for it.

## 6. Screen designs (S2–S6)

Every screen exists in Light and Dark, at the four sizes, with empty, loading, error, offline and permission states.

### S2 Access

- **Starting.** A brand lockup, then checks in words: `Opening the till` → `Checking the printer` → `Connecting to Yetu`. A failure says which and what to do. No percentage bar.
- **Server setup** (installer only). Heading `Connect to your Yetu server`. One address field, then a check: `Can't reach that address. Check it and try again.` Advanced detail goes behind *Technical details*.
- **Pairing:**
  - Heading `Connect this till to your restaurant`.
  - A large code (grouped `7F3K-9ABC`) and a QR code.
  - Three numbered steps: *Open Yetu → Restaurant → Devices*, *Choose Connect a till*, *Enter this code*.
  - The expiry is shown with time left, plus `New code`.
- **Waiting** shows live steps: `Code shown` ✓ → `Waiting for a manager to approve` → `Connected to <outlet>`, with *Cancel*. Rejected: `A manager declined this till. Ask them why, then get a new code.`
- **Who's working:**
  - A roster of 72px tiles with initials, name and role, plus a search field when there are more than 12 staff.
  - `Use staff number instead` link.
  - The offline roster carries a `Working offline` banner.
- **PIN:**
  - A 72px keypad that submits when complete (no OK/Unlock), with `Not you?`.
  - Errors use the backend's lockout rules: `That PIN didn't match. 2 tries left.` / `Too many tries. Wait 30 seconds or ask a manager.`
- **Idle lock:** a sheet `Locking in 0:20 — touch anywhere to stay signed in`, then locked.
- **Session expired:** the PIN screen with `Your session ended. Enter your PIN to carry on.` The order in progress is kept server-side.
- **Banners:**
  - key storage: `This till can't store its key safely. Call support before taking payments.`;
  - update: `An update is ready. It installs when the shift is closed.`

### S3 Shift and cash

- **Open shift:**
  - `Count the cash in the drawer` with `MoneyField`, an optional note-by-note counter, and the person's name.
  - Primary `Open shift`.
  - Without `pos.shift:open`, a `PermissionNotice`: `Ask a cashier or manager to open the shift.`
- **Cash (page):**
  - shift summary: float, cash sales, cash refunds (after S7), cash in, cash out, and expected, each line explained;
  - the movement list with reasons and who;
  - actions `Cash in`, `Cash out`.
  - Cash out uses `SupervisorApproval` (a different person).
- **Close shift**, three steps:
  1. **Count** (blind): notes and coins, or a total.
  2. **Check:** Expected vs Counted, `Over` / `Short` / `Balanced`, with a reason required when not balanced. Supervisor approval as the backend requires.
  3. **Done:** the shift report and `Print`.
- **Close day:** a checklist of what blocks it, in words (`2 shifts still open: Bar till, Pool till`). Primary `Close the day`, needing `pos.report:manager`.

### S4 Register

- **Layout** (1366): rail 76 | menu | ticket 400px.
  - At 1024: rail 64 | menu (3 columns) | ticket 360.
  - At 1920: 6 columns.
- **Menu:**
  - Category tabs (56px), plus `All`.
  - Search always visible.
  - **Text-first tiles** (no photos): name (2 lines, 16–18px semibold), price, and a thin category colour mark.
  - Fixed positions in catalog order; sold out greys in place with the word.
  - Options open the options sheet.
- **Ticket** (always visible while browsing):
  - Service type `SegmentedControl` with the backend's types only. Then a table label field (dine-in) or room field (room service), as today's free text until S14.
  - Lines show quantity (clearly visible), name, options indented, and price.
  - Select a line to get `Stepper`, `Note`, `Remove`. Removing a sent item needs a supervisor (backend rule).
  - Totals: Subtotal / Discount / VAT / **Total** (backend figures only).
- **Actions, distinct by design:**
  - **Send to kitchen** is a secondary button with a kitchen icon and its own position (left, 56px). After sending: `Sent to kitchen 14:05` on the ticket.
  - **Pay TSh 42,500** is primary (blue, 64px, right).
  - `More` holds Discount, Void, and the order note.
  - Pay is never confused with Send: different colour, position, icon and words.
- **Options sheet:** required groups first (`Choose 1`), then optional (`Up to 2`), then quantity, then `Add to order · TSh 9,500`. Min/max are enforced from the catalog.
- **Pay sheet:**
  - Amount due large, then method tiles: `Cash`, `Mobile money`, `Card (own machine)`, `Bank transfer`, `Other`, and `Charge to room` (only with LODGING).
  - Card and mobile money: `Take payment on your own machine, then confirm here.` Optional reference, then `Confirm TSh 42,500 received`.
  - Cash: `QuickCash` (`Exact`, then the next amounts from the notes the currency uses), a keypad, `Change to give TSh 7,500` (44px).
  - Split: `Split payment` adds tenders one at a time with `Paid TSh 20,000 of TSh 42,500`.
  - Room: search in-house guests (`Room 12 · Asha Mollel · leaves Wed 14 Oct`), then `Charge TSh 42,500 to room 12`. The existing rule (no room charge after a partial payment) is explained in words.
- **Payment done:** tick, `Paid`, amount, change, receipt status (`Receipt printed` / `Receipt didn't print — Print again`). Primary `New sale`; it returns to Sell after a named setting `register.autoReturnSeconds` (default 8).
- **Receipt view** uses *receipt* (not *invoice*). `This is not a tax receipt. Use your EFD machine for tax receipts.`

### S5 Orders and kitchen

- **Orders:**
  - Tabs `Open` / `Paid today` (the backend list with status filter), plus search (number, table, room, amount).
  - Rows show number, table or room, time, staff, total, and status in words.
  - Selecting a row opens **Order detail**: the lines, payments, and a **timeline** built from existing timestamps and audit (created, sent, each ticket step, paid).
  - Actions by state: open orders get Send, Pay, Void; paid orders get Print receipt, and Refund items (after S7).
- **Kitchen / Bar:**
  - Columns `New` → `Preparing` → `Ready`, with counts in the header.
  - Tickets show table or room, staff, time sent, items in 20px, and options and notes highlighted.
  - **Age in words and minutes** (`On time · 4 min`, `Getting late · 12 min`, `Late · 18 min`). The thresholds are named settings (`kitchen.lateAfterMinutes` default 15, `kitchen.warnAfterMinutes` default 10).
  - One large next-step button per ticket (`Start`, `Ready`, `Served`). `Undo` for 10s, then `Recall` brings back the last 10 finished tickets.
  - The station filter comes from the terminal's `prep_stations`. A new ticket gets an orange `New` marker for 30s.
  - KDS-mode tills use full-screen columns without the rail.

### S6 Offline, sync, status, errors

- **Offline register** has the same layout as Sell, plus:
  - a fixed banner: `Working offline. Cash only. Sales are saved on this till and sent when the connection returns.`;
  - only actions the offline protocol certifies (cash sale, add/remove/quantity);
  - the cash sheet in money words, not minor units;
  - success: `Sale saved on this till · Change TSh 7,500`.
- **Sync Center** (sheet from the connection chip):
  - Plain sections: `Waiting to send` (count and list), `Sent`, `Needs attention` (with what to do), `Last sent 14:02`, and `Try again`.
  - Technical fields (lease, catalog version, eligibility) go behind *Technical details*.
  - Sync problems also show in the top-bar chip and a banner until resolved.
- **Status:**
  - Checks in words (`Internet`, `Yetu`, `Live updates`, `Receipt printer`, `Kitchen printer`, `Secure key storage`), each with a fix hint and `Print test page`.
  - *Technical details* shows the existing technician snapshot.
- **Errors:** every `posErrors.ts` case gets a sentence and a next step. Stale version: `This order changed on another till. We've reloaded it. Check it, then try again.`
- **Permission denied:** a `PermissionNotice` (`Only a supervisor can void orders. Ask one to help.`), never a raw 403.
- **Recovery:** a failed send, print or pay keeps the order intact and offers `Try again`. A lost connection mid-payment shows the server's truth after reconnect.

## 7. Refunds by item (S7)

**Rules (owner-approved):**
- Refund chosen lines and quantities of a **paid** order.
- A **different** person's supervisor PIN.
- Money goes back by the methods used, capped per method.
- It counts on the **current** business day and shift.
- Online only.
- Refunds are allowed up to a named setting `pos.refund.windowDays` (default 30) after the original business date.

**Data (migration ≥ 00096, numbered at merge time; see §3.5), all append-only:**
- `pos_refunds`: id, org, property, outlet, order, shift (the refunding till's open shift), terminal, business_date, reason, initiated_by, authorized_by, the money split (net, discount share, tax, total), currency, created_at.
- `pos_refund_lines`: refund, order_item, quantity, net, tax, total.
- `pos_refund_tenders`: refund, original payment, method, amount; plus `folio_item_id` for a room-charge reversal.
- **Database guards:**
  - refunded quantity per line ≤ sold;
  - refunded amount per payment ≤ paid;
  - the refund's total = its lines = its tenders;
  - refunds only of CLOSED orders.
- The guards are proven by deleting each and seeing its test fail.
- Rows are classified in the authority matrix with FORCE RLS like the other POS tables.

**Money:**
- Each refunded unit returns its share of the line net, less its share of the order discount, plus its share of the tax, worked out with the existing `scaleRound` rule.
- The **last** refund of anything takes exactly what remains, so rounding never leaves or invents a shilling.
- Server-authoritative; differential tests against an independent reference over generated orders (discounts, split payments, repeated partial refunds).

**Effects:**
- **Cash:** lowers `expected_cash_minor` of the refunding shift. A cash refund needs an open shift on that till.
- **Room charge:** posts a negative folio reversal (`reversal_of` the POS line, with the reason). If the guest's bill is closed: `Room 12's bill is closed. Refund it at the front desk.`
- **Other methods:** recorded as given back on the same method.
- **Everywhere:** audit records, a realtime event, and a refund receipt as a print job.

**API:**
- `POST /api/v1/pos/orders/{id}/refunds` (`pos.refund:create`, supervisor `pos.refund:approve`, idempotent);
- `GET /api/v1/pos/orders/{id}/refunds`;
- the property-scoped list for the hotel web app.

All in OpenAPI first; permissions seeded for the existing roles.

**UI:** till Order detail → `Refund items` (steppers, reason, per-method split when paid more than one way, then `SupervisorApproval`, then done with drawer and receipt). The hotel web app shows refunds on orders, shifts and the day.

## 8. Thermal printing (S8)

- **Rust, Windows:** send raw ESC/POS through the spooler (`OpenPrinterW` / `StartDocPrinterW` with `RAW` / `WritePrinter`) using the `windows` crate, and list printers with `EnumPrintersW`. On Linux / macOS, `lp -o raw`. Unique job names (fixes the pid collision).
- **Document model:**
  - The TypeScript side builds structured documents (receipt, refund, kitchen ticket, shift report, cash slip) from backend data, not plain text.
  - Rust encodes them: 48 columns at 80mm or 32 at 58mm, bold and double-height, cut, and drawer kick (`ESC p`).
  - Text uses only characters the printer's code page has.
- **Settings** (*More → Printers*), stored per device in the local config:
  - `Receipt printer` and `Kitchen printer` (from the Windows list, or *none*);
  - paper width;
  - `Open the drawer for cash` (on by default when a receipt printer is set);
  - `Print a test page`.
  - The `PEAK_PRINTER` env var remains as an installer fallback.
- **Kitchen tickets** keep the server's print-job claim/ack and idempotency.
- **Printer failures** never change money. They show `Didn't print — Print again`.

## 9. Room-charge correctness (S9)

- **One line per VAT rate.** The folio posting writes one line per distinct VAT rate on the order, each with its real `tax_rate_bp`. That fixes F-212 for mixed-rate orders too.
- **Line in words:** `<Outlet> · Order <number> (<n> items)`.
- **Totals:** the lines sum to the order total exactly. The last line takes the remainder.
- **Tests:** existing room-charge tests extended; a guard-removal check on the new tax-rate assertion.

## 10. New capabilities (S12–S15)

All online-only. Each sits behind a rollout control that is **off** until switched on for a property or outlet.

### S12 Guest count (covers)

- **Data:** `orders.guest_count` (nullable smallint, CHECK 1–200).
- **Outlet setting:** `covers_mode` = `off` (default) / `optional` / `required for dine-in`.
- **Editing:** set when starting or editing an open dine-in order, with `pos.order:create`. Changing it after payment is refused.
- **Till:** a `Guests` stepper next to the table field. It's required before Send or Pay when the outlet requires it, with the message `Add the number of guests for table 12.`
- **Reports:** covers and average spend per guest. Net sales ÷ covers, dine-in orders that have covers only, with the basis stated.
- **Offline:** offline sales keep no covers and are counted as "guests not recorded".

### S13 Service charge (documented financial policy)

- **Rate:** the property's effective `service_charge_bp` for the order's business date (from `property_tax_rates`). It is never typed on the till and has no built-in default.
- **Where it applies:** outlet setting `service_charge_applies` (default **off**) and the service types it applies to (default dine-in and room service). Each order records the rate it was priced with.
- **Basis:** the order net after discount.
  - **Not taxed**, matching `kernel.PriceCharge` and the hotel's room charges.
  - Rounded once per order with `TaxOf`.
  - The order total is net − discount + VAT + service.
- **Payments:** split payments settle the full total. Room posting carries `service_charge_minor` on the folio lines (S9 shape).
- **Receipts:** show `Service charge (10%)`.
- **Refunds:** return a proportional service share, with the last refund taking the remainder. Voids carry no money.
- **Reconciliation:** shift and day reports split service from sales.
- **Inclusive VAT:** till products carry their own exclusive VAT rates and ignore `prices_include_tax`. Service charge follows the same exclusive basis. Inclusive till pricing is a separate owner decision (§13), not changed here.
- **Offline:** while service charge applies to an outlet, offline cash selling is **refused** for it ("eligibility"), until offline pricing is certified to include service.
- **Tests:** differential tests against a reference model across rates, discounts, splits, refunds and room posting; guard-removal on the total identity.

### S14 Tables map

- **Data:**
  - `pos_tables`: outlet, label, seats, area, shape, x/y/w/h, rotation, active, sort. Property and outlet scoped, with RLS.
  - Orders gain a nullable `table_id`; `table_label` stays for history and for outlets without tables.
- **Hotel web:** *Restaurant → Tables* adds and edits tables per outlet and lays out the floor on a grid canvas (drag, snap, keyboard nudge, areas). It needs a new `pos.table:manage` permission for managers.
- **Table state** (authoritative, **derived from orders only**, no reservations, no occupancy):

  | State | Meaning |
  |---|---|
  | `Free` | no open order |
  | `Ordering` | OPEN |
  | `In the kitchen` | SENT / PREPARING |
  | `Ready to serve` | READY |
  | `Served · waiting to pay` | SERVED |

  A table with more than one open order shows the count.
- **Till:** *Tables* in the rail when the outlet has active tables. The floor view (touch, keyboard, list fallback at 1024) updates live from the existing order events. Tapping a table opens its order or starts a dine-in order on it. Moving an order to another table needs `pos.order:create`.
- **Offline:** the floor view is read-only and marked out of date. Offline sales use the free-text label.

### S15 Reports on the till

- **Permission:** `pos.report:manager`.
- **Scope:** the till's outlet, the current business date, and any of the last 7 business days.
- **Content:**
  - **This shift so far** (an X report) and **Business day** (an outlet summary);
  - sales: gross, discounts, net, VAT, service, refunds;
  - orders by status;
  - tenders by method;
  - covers and average (when S12 is on);
  - top 10 items by quantity.
- **Semantics** (stated on screen):
  - Sales = closed orders on that business date.
  - Refunds count on the day they are given.
  - Open orders are listed apart, not counted as sales.
- **Endpoints:** `GET /api/v1/pos/reports/shift/{id}` and `GET /api/v1/pos/reports/day?businessDate=`. One query each, with timing measured on realistic volumes before and after.
- **Printable** on 80mm. Advanced analytics stay in the hotel web app.

## 11. Rollout controls

| Capability | Control | Default |
|---|---|---|
| Refunds | permissions `pos.refund:create` / `pos.refund:approve` | waiter: create; supervisor/manager: approve |
| Covers | outlet `covers_mode` | off |
| Service charge | outlet `service_charge_applies` (+ property rate) | off |
| Tables | outlet has active tables | none configured |
| Till reports | `pos.report:manager` | managers only |
| Auto-return after payment | `register.autoReturnSeconds` | 8 |
| Kitchen ticket age | `kitchen.warnAfterMinutes` / `kitchen.lateAfterMinutes` | 10 / 15 |
| Refund window | `pos.refund.windowDays` | 30 |

## 12. Verification

- **Each slice:** the gates in §2.7, guard-removal proof for every new guard, and pixel tests at 4 sizes × 2 themes.
- **Each till batch:** a run in `tauri dev`, judged from screenshots.
- **Each web change:** `/ui-sweep` before and after, plus `/ui-compare`.
- **After merge:** confirm the deployed SHA and check the behaviour live with a real role.
- **S11 on the Windows PC:**
  - install the published v0.2.0;
  - every journey in §1;
  - a first-day person completing sale, room charge and refund unaided;
  - taps per sale measured (target: 4 for a repeat two-item exact-cash sale).
- **New capabilities:** a live check with the control switched on for the test business only.

## 13. Owner decisions still open (none block S0–S6)

1. **Windows code signing** (Authenticode). Without it, Windows warns *unknown publisher* on install. Yearly certificate cost.
2. **Swahili.** The till is English today with no translation layer. Adding Swahili is its own slice.
3. **VAT-inclusive pricing on the till** for properties set to *prices include VAT*. The till currently adds each product's own VAT on top.
4. **Defaults** in §11 (refund window 30 days; service charge types; covers off).
