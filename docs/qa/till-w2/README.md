# W2: consistent Back and cancellation wording

All sheet exits now read Back, including icon dismissals whose accessible name is Back to previous screen. Cancellation actions still describe cancelling an item or order; API/data names are unchanged. Busy dismissal and uncertain-refund guards remain in place.

Guard proofs: changing Back back to Cancel fails the approval-sheet test; restoring voided in staff wording fails the staff-language test; deleting the pending ReceiptView dismissal guard fails its busy test. Each mutation was restored. Original full suite: 1,319 passed, six skipped; combined W1/W2 rerun: 1,321 passed, six skipped; typecheck, lint and build passed.

Screenshots below cover the changed sheet surfaces at both required resolutions and themes. Before links point to W1 evidence; after images render W2. These are development visual fixtures, not live/native acceptance.

- register-options, 1366x768, light: [before](../till-w1/after/register-options-1366x768-light.png) · [after](after/register-options-1366x768-light.png)
- register-options, 1366x768, dark: [before](../till-w1/after/register-options-1366x768-dark.png) · [after](after/register-options-1366x768-dark.png)
- register-options, 1920x1080, light: [before](../till-w1/after/register-options-1920x1080-light.png) · [after](after/register-options-1920x1080-light.png)
- register-options, 1920x1080, dark: [before](../till-w1/after/register-options-1920x1080-dark.png) · [after](after/register-options-1920x1080-dark.png)
- register-more, 1366x768, light: [before](../till-w1/after/register-more-1366x768-light.png) · [after](after/register-more-1366x768-light.png)
- register-more, 1366x768, dark: [before](../till-w1/after/register-more-1366x768-dark.png) · [after](after/register-more-1366x768-dark.png)
- register-more, 1920x1080, light: [before](../till-w1/after/register-more-1920x1080-light.png) · [after](after/register-more-1920x1080-light.png)
- register-more, 1920x1080, dark: [before](../till-w1/after/register-more-1920x1080-dark.png) · [after](after/register-more-1920x1080-dark.png)
- receipt, 1366x768, light: [before](../till-w1/after/receipt-1366x768-light.png) · [after](after/receipt-1366x768-light.png)
- receipt, 1366x768, dark: [before](../till-w1/after/receipt-1366x768-dark.png) · [after](after/receipt-1366x768-dark.png)
- receipt, 1920x1080, light: [before](../till-w1/after/receipt-1920x1080-light.png) · [after](after/receipt-1920x1080-light.png)
- receipt, 1920x1080, dark: [before](../till-w1/after/receipt-1920x1080-dark.png) · [after](after/receipt-1920x1080-dark.png)
- close-count, 1366x768, light: [before](../till-w1/after/close-count-1366x768-light.png) · [after](after/close-count-1366x768-light.png)
- close-count, 1366x768, dark: [before](../till-w1/after/close-count-1366x768-dark.png) · [after](after/close-count-1366x768-dark.png)
- close-count, 1920x1080, light: [before](../till-w1/after/close-count-1920x1080-light.png) · [after](after/close-count-1920x1080-light.png)
- close-count, 1920x1080, dark: [before](../till-w1/after/close-count-1920x1080-dark.png) · [after](after/close-count-1920x1080-dark.png)

Recovery follow-up: the system-printer cancellation formatter still used “Voided” even though the thermal formatter already used “Cancelled”. Its paper-output regression failed before the fix; the restored paper/wording checks pass (six tests). Original transaction fields and API names are unchanged.
