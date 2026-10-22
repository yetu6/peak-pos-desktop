# W3: opening float and cash choices

Opening cash follows standardFloat (minor units, default zero), including preferences arriving after the screen loads. Once staff edit the amount, refreshes preserve their count. The first typed digit replaces the prefill. Blind closing counts are unchanged.

Quick-cash choices use quickCashNotes (major TZS units; default 1000, 2000, 5000, 10000). TSh 37,500 offers TSh 40,000, TSh 50,000 and TSh 100,000. Exact, manual entry, live change and separate confirmation remain available. Card/mobile amounts were already prefilled and are preserved.

Preferences are cached by property/outlet as advisory values; signed offline financial authority is unchanged. No automatic post-payment printing or new printing setting is introduced.

Validation: combined W1–W3 suite 1,325 passed, six skipped; typecheck, lint and build passed. Removing the edited-cash guard makes its test fail; restored OpenShift suite: 16 passed. The late-arriving-float regression was red before implementation. The visual opening-shift fixture uses the existing shift fixture’s opening amount to demonstrate a configured float.

Merge backend #304, hotel W3, then this PR, after W1/W2. Screenshots are development fixture evidence, not native/live acceptance.

- no-shift, 1366x768, light: [before](before/no-shift-1366x768-light.png) · [after](after/no-shift-1366x768-light.png)
- no-shift, 1366x768, dark: [before](before/no-shift-1366x768-dark.png) · [after](after/no-shift-1366x768-dark.png)
- no-shift, 1920x1080, light: [before](before/no-shift-1920x1080-light.png) · [after](after/no-shift-1920x1080-light.png)
- no-shift, 1920x1080, dark: [before](before/no-shift-1920x1080-dark.png) · [after](after/no-shift-1920x1080-dark.png)
- pay-cash, 1366x768, light: [before](before/pay-cash-1366x768-light.png) · [after](after/pay-cash-1366x768-light.png)
- pay-cash, 1366x768, dark: [before](before/pay-cash-1366x768-dark.png) · [after](after/pay-cash-1366x768-dark.png)
- pay-cash, 1920x1080, light: [before](before/pay-cash-1920x1080-light.png) · [after](after/pay-cash-1920x1080-light.png)
- pay-cash, 1920x1080, dark: [before](before/pay-cash-1920x1080-dark.png) · [after](after/pay-cash-1920x1080-dark.png)
- pay-card, 1366x768, light: [before](before/pay-card-1366x768-light.png) · [after](after/pay-card-1366x768-light.png)
- pay-card, 1366x768, dark: [before](before/pay-card-1366x768-dark.png) · [after](after/pay-card-1366x768-dark.png)
- pay-card, 1920x1080, light: [before](before/pay-card-1920x1080-light.png) · [after](after/pay-card-1920x1080-light.png)
- pay-card, 1920x1080, dark: [before](before/pay-card-1920x1080-dark.png) · [after](after/pay-card-1920x1080-dark.png)
- pay-mobile, 1366x768, light: [before](before/pay-mobile-1366x768-light.png) · [after](after/pay-mobile-1366x768-light.png)
- pay-mobile, 1366x768, dark: [before](before/pay-mobile-1366x768-dark.png) · [after](after/pay-mobile-1366x768-dark.png)
- pay-mobile, 1920x1080, light: [before](before/pay-mobile-1920x1080-light.png) · [after](after/pay-mobile-1920x1080-light.png)
- pay-mobile, 1920x1080, dark: [before](before/pay-mobile-1920x1080-dark.png) · [after](after/pay-mobile-1920x1080-dark.png)
- close-count, 1366x768, light: [before](before/close-count-1366x768-light.png) · [after](after/close-count-1366x768-light.png)
- close-count, 1366x768, dark: [before](before/close-count-1366x768-dark.png) · [after](after/close-count-1366x768-dark.png)
- close-count, 1920x1080, light: [before](before/close-count-1920x1080-light.png) · [after](after/close-count-1920x1080-light.png)
- close-count, 1920x1080, dark: [before](before/close-count-1920x1080-dark.png) · [after](after/close-count-1920x1080-dark.png)
