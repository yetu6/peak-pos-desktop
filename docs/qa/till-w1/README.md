# W1: Yetu Till visual foundation

Reference lock: the owner’s handover §§3/6 and researched brief, adapted into the existing React/Tauri views. Public Sans, paper/navy surfaces, existing category marks, orange Pay, inline Lucide SVG icons, tabular money, thin borders, 4px/8px radii. No new domain workflow.

Research used the Refero methodology and bundled colour/accessibility guidance (hosted search returned NO_SUBSCRIPTION), [Superdesign](https://superdesign.dev/teams/4da1caa0-7937-4a3d-b03c-90ba6a7f991e/projects/ea7390e3-4527-4fdc-b6d3-64d284814aa3), and 12UI’s four candidates. Generated dollars, gradients and invented operational content are rejected. The Superdesign preview was corrected using the real rendered app, with TSh and native SVG icons.

## Behavior

- Paper and saved-bill surfaces stay white in both themes with dedicated ink/muted tokens and contrast coverage.
- Shared radii use the 4px rhythm; action icons use 20px/2px SVG strokes.
- Open-order gutters align to the ticket; selection keeps a stable border width.
- Print order, Print bill and More fit the compact ticket. Decorative icons/key hints yield before action words do.
- The visual Sell fixture now includes the already-working open-orders bar and Print bill action. Their absence in the old fixture was not absence in the actual application.

## Evidence

Baseline: origin/main 651cd97. Files in `before/` and `after/` cover Sell, Pay, Orders, order details, Kitchen, Cash, blind count, Status, sign-in, item options, More and the saved bill at 1366×768 and 1920×1080, light/dark. Initial blank captures were discarded and recaptured after React/fonts settled.

- Typecheck, lint and frontend build passed.
- Vitest: 1,320 passed, six skipped before the fixture correction; its five tests passed again after that correction.
- Focused browser layout/paper checks: eight passed, including the open-orders bar and Print bill.
- Full visual harness: result recorded in the PR after completion; development fixtures are not live/native acceptance.
- The paper-colour tests were red against the original dark-paper tokens before implementation.

## Screenshots


### register

- 1366x768 light: [before](before/register-1366x768-light.png) · [after](after/register-1366x768-light.png)
- 1366x768 dark: [before](before/register-1366x768-dark.png) · [after](after/register-1366x768-dark.png)
- 1920x1080 light: [before](before/register-1920x1080-light.png) · [after](after/register-1920x1080-light.png)
- 1920x1080 dark: [before](before/register-1920x1080-dark.png) · [after](after/register-1920x1080-dark.png)

### pay-cash

- 1366x768 light: [before](before/pay-cash-1366x768-light.png) · [after](after/pay-cash-1366x768-light.png)
- 1366x768 dark: [before](before/pay-cash-1366x768-dark.png) · [after](after/pay-cash-1366x768-dark.png)
- 1920x1080 light: [before](before/pay-cash-1920x1080-light.png) · [after](after/pay-cash-1920x1080-light.png)
- 1920x1080 dark: [before](before/pay-cash-1920x1080-dark.png) · [after](after/pay-cash-1920x1080-dark.png)

### orders

- 1366x768 light: [before](before/orders-1366x768-light.png) · [after](after/orders-1366x768-light.png)
- 1366x768 dark: [before](before/orders-1366x768-dark.png) · [after](after/orders-1366x768-dark.png)
- 1920x1080 light: [before](before/orders-1920x1080-light.png) · [after](after/orders-1920x1080-light.png)
- 1920x1080 dark: [before](before/orders-1920x1080-dark.png) · [after](after/orders-1920x1080-dark.png)

### order-open

- 1366x768 light: [before](before/order-open-1366x768-light.png) · [after](after/order-open-1366x768-light.png)
- 1366x768 dark: [before](before/order-open-1366x768-dark.png) · [after](after/order-open-1366x768-dark.png)
- 1920x1080 light: [before](before/order-open-1920x1080-light.png) · [after](after/order-open-1920x1080-light.png)
- 1920x1080 dark: [before](before/order-open-1920x1080-dark.png) · [after](after/order-open-1920x1080-dark.png)

### kitchen

- 1366x768 light: [before](before/kitchen-1366x768-light.png) · [after](after/kitchen-1366x768-light.png)
- 1366x768 dark: [before](before/kitchen-1366x768-dark.png) · [after](after/kitchen-1366x768-dark.png)
- 1920x1080 light: [before](before/kitchen-1920x1080-light.png) · [after](after/kitchen-1920x1080-light.png)
- 1920x1080 dark: [before](before/kitchen-1920x1080-dark.png) · [after](after/kitchen-1920x1080-dark.png)

### cash

- 1366x768 light: [before](before/cash-1366x768-light.png) · [after](after/cash-1366x768-light.png)
- 1366x768 dark: [before](before/cash-1366x768-dark.png) · [after](after/cash-1366x768-dark.png)
- 1920x1080 light: [before](before/cash-1920x1080-light.png) · [after](after/cash-1920x1080-light.png)
- 1920x1080 dark: [before](before/cash-1920x1080-dark.png) · [after](after/cash-1920x1080-dark.png)

### close-count

- 1366x768 light: [before](before/close-count-1366x768-light.png) · [after](after/close-count-1366x768-light.png)
- 1366x768 dark: [before](before/close-count-1366x768-dark.png) · [after](after/close-count-1366x768-dark.png)
- 1920x1080 light: [before](before/close-count-1920x1080-light.png) · [after](after/close-count-1920x1080-light.png)
- 1920x1080 dark: [before](before/close-count-1920x1080-dark.png) · [after](after/close-count-1920x1080-dark.png)

### status

- 1366x768 light: [before](before/status-1366x768-light.png) · [after](after/status-1366x768-light.png)
- 1366x768 dark: [before](before/status-1366x768-dark.png) · [after](after/status-1366x768-dark.png)
- 1920x1080 light: [before](before/status-1920x1080-light.png) · [after](after/status-1920x1080-light.png)
- 1920x1080 dark: [before](before/status-1920x1080-dark.png) · [after](after/status-1920x1080-dark.png)

### locked-roster

- 1366x768 light: [before](before/locked-roster-1366x768-light.png) · [after](after/locked-roster-1366x768-light.png)
- 1366x768 dark: [before](before/locked-roster-1366x768-dark.png) · [after](after/locked-roster-1366x768-dark.png)
- 1920x1080 light: [before](before/locked-roster-1920x1080-light.png) · [after](after/locked-roster-1920x1080-light.png)
- 1920x1080 dark: [before](before/locked-roster-1920x1080-dark.png) · [after](after/locked-roster-1920x1080-dark.png)

### register-options

- 1366x768 light: [before](before/register-options-1366x768-light.png) · [after](after/register-options-1366x768-light.png)
- 1366x768 dark: [before](before/register-options-1366x768-dark.png) · [after](after/register-options-1366x768-dark.png)
- 1920x1080 light: [before](before/register-options-1920x1080-light.png) · [after](after/register-options-1920x1080-light.png)
- 1920x1080 dark: [before](before/register-options-1920x1080-dark.png) · [after](after/register-options-1920x1080-dark.png)

### register-more

- 1366x768 light: [before](before/register-more-1366x768-light.png) · [after](after/register-more-1366x768-light.png)
- 1366x768 dark: [before](before/register-more-1366x768-dark.png) · [after](after/register-more-1366x768-dark.png)
- 1920x1080 light: [before](before/register-more-1920x1080-light.png) · [after](after/register-more-1920x1080-light.png)
- 1920x1080 dark: [before](before/register-more-1920x1080-dark.png) · [after](after/register-more-1920x1080-dark.png)

### receipt

- 1366x768 light: [before](before/receipt-1366x768-light.png) · [after](after/receipt-1366x768-light.png)
- 1366x768 dark: [before](before/receipt-1366x768-dark.png) · [after](after/receipt-1366x768-dark.png)
- 1920x1080 light: [before](before/receipt-1920x1080-light.png) · [after](after/receipt-1920x1080-light.png)
- 1920x1080 dark: [before](before/receipt-1920x1080-dark.png) · [after](after/receipt-1920x1080-dark.png)
