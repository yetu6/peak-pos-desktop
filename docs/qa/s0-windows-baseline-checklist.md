# S0: Windows baseline run of today's till (before the redesign)

**Purpose.** Find the real Windows faults in the till as it is today, on the owner's PC with its thermal printer, before any redesign work. Every fault found here is fixed once instead of being rediscovered later.

**Build**
- GitHub Actions `release` run **38188424521** (green on Windows, macOS and Linux; release and download publishing skipped).
- Built from branch `ci/release-perl-only-on-windows` @ `fc287a9`. Its app code is identical to `main` @ `600e519`; only the release workflow's `PERL` fix (PR #12) differs.
- The first attempt on `main`, run 38187441201, failed on that CI defect.
- Download the `yetu-pos-windows` artifact (26 MB, kept until 2027-01-10) from the run page.
- It is an **unpublished test installer**. It carries the Tauri **updater** signature only and is **not Authenticode-signed**, so Windows SmartScreen will warn ("unknown publisher"). That warning is expected for this test build.
- **Known at start:** with no release ever published, a banner "Update check failed: Could not fetch a valid release JSON from the remote" appears at the top. Seen on Linux; it is fixed in S2. Note whether it appears on Windows too.

**Against**
- production `api.yetu.fbcsoftwares.com`, using a **test business** (e.g. Jacaranda), before the pre-launch clear-out;
- a manager signed in to the hotel web app on another device, to approve pairing and view reports.

**How to record:** for each step, write **OK** or what happened, word for word, plus a photo or screenshot of anything wrong. Note the time, so it can be matched to server logs.

| # | Step | What should happen | Result |
|---|---|---|---|
| 1 | Run the installer | SmartScreen warning (expected), then install completes. No admin errors. | |
| 2 | First start | The till opens. Note how long it takes and anything about "server address" or "key storage". | |
| 3 | Pair the till | A code and QR appear. The manager approves it in the hotel web app under Restaurant → Devices. The till moves on by itself. | |
| 4 | Staff sign-in | The staff list appears. Pick a waiter, enter their PIN. A wrong PIN is refused clearly. | |
| 5 | Open shift | Enter the starting float (e.g. 50,000). Selling becomes available. | |
| 6 | Dine-in order | Pick items (one with options), add a table label. Quantities and total look right. | |
| 7 | Send to kitchen | A kitchen ticket prints (note how it looks: width, cut, text size). The Kitchen screen shows it. | |
| 8 | Pay by cash | Pay with more than the total. The change is right. A receipt prints. Does the cash drawer open? | |
| 9 | Mobile money | Pay a second order by mobile money with a reference. | |
| 10 | Room charge | Charge a third order to an in-house test guest. It appears on their bill in the hotel web app (note the wording of the line). | |
| 11 | Void | Void an unpaid order with a supervisor's PIN (a different person). | |
| 12 | Cash out | Cash out a small amount; a different person's PIN is required. | |
| 13 | Close shift | Count the drawer. The expected figure and the difference make sense. A supervisor approves if needed. | |
| 14 | Close day | Close the business day. The hotel web app shows the day closed and the figures. | |
| 15 | Idle lock | Leave the till untouched until it locks. Sign back in. | |
| 16 | Status screen | Open Status: the internet, server, printer and secure-storage checks. Use "Print test page". | |
| 17 | Pull the network cable | What does the till say and allow? Plug it back in. Does it recover? | |
| 18 | Restart Windows | The till starts paired, asks for a PIN, and the shift is still open. | |
| 19 | Screen sizes | Note the PC's resolution and Windows scaling (Settings → Display). Is anything cut off? | |

**Also note:**
- the printer model, and how it is connected (USB or network);
- whether a cash drawer is wired to it;
- the screen size and resolution;
- anything staff found confusing.

The results go into `YETU-STATUS.md`, and each fault becomes a fix in the redesign slices (S1–S11) or a separate defect.
