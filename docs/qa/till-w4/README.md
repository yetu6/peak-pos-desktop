# W4: table and guest context on the till

Sell offers a short optional name when askForTable is off. Optional guest count uses the existing stepper for dine-in orders when captureGuestCount is enabled; takeaway never asks. Saved orders retain their original interpretation. Advisory prompt preferences are cached by property/outlet at authenticated bootstrap and catalogue refresh, separately from signed offline authority.

The context travels through native encrypted storage, immutable offline cash evidence, kitchen/bar views, thermal and system-printer production papers, cancellation slips and bills. Local schema 5 prevents changing guest/name interpretation after an order is committed. No payment, refund, printer-dispatch or shift-count behavior is replaced.

Validation: final combined W1–W4 frontend suite: 1,337 passed/six skipped. Paper-mapper and bootstrap regressions were red before fixes. Typecheck/lint/frontend build pass. Native full suite: 81 passed; six native guard removals fail their intended assertions, then all 16 order tests pass after restoration. Covered guards: native create/update rejection of takeaway guests, optional dine-in table, positive/bounded guest count and immutable completed-order context. Backend context validation removal also fails its real-database test.

Browser coverage: 16 new fixture layout/accessibility checks and four interactive prompt checks pass; all required sizes/themes are captured below. Existing contract fixtures are reused. These are development fixture and native unit results, not live acceptance. The stack rebase preserved both cash and order-prompt bootstrap caches and the system-printer cancellation wording.

Conflict recorded: the old native validator required a dine-in table despite the owner’s optional-table decision. It now permits an absent dine-in table while retaining its room-service context guard. The existing catalogue immutability guard is preserved; the validator test installs a separate snapshot rather than mutating a verified catalogue.

Merge all W3 first, then W4 backend → hotel → till. No merge/tag/deploy/production access performed.

- 1366x768, light: [before](before/register-1366x768-light.png) · [name only](after/name-1366x768-light.png) · [optional guests](after/guests-1366x768-light.png)
- 1366x768, dark: [before](before/register-1366x768-dark.png) · [name only](after/name-1366x768-dark.png) · [optional guests](after/guests-1366x768-dark.png)
- 1920x1080, light: [before](before/register-1920x1080-light.png) · [name only](after/name-1920x1080-light.png) · [optional guests](after/guests-1920x1080-light.png)
- 1920x1080, dark: [before](before/register-1920x1080-dark.png) · [name only](after/name-1920x1080-dark.png) · [optional guests](after/guests-1920x1080-dark.png)
