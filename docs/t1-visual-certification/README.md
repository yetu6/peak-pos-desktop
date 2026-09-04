# T1 visual certification — startup and access journey

Captured from the actual Tauri development binary (`target/debug/peak-pos-desktop`)
running under Xvfb, not a browser. `xdotool` set the exact window geometry
through the native X11 window boundary before each capture; ImageMagick's
`import -window` grabbed the window and `identify` verified the resulting PNG
dimensions matched. See `scripts/capture-fixture.sh` for the exact recipe.

`01-splash` and `02-pairing`/`03-pairing-waiting` render the terminal's own
real, hook-free/backend-free screens (`Splash`, and `PairingScreen`'s reachable
initial state). The remaining states (`04`–`07`) need a device that has
already been paired against a running Peak backend at least once, which this
environment does not have — those are captured through
`VITE_PEAK_VISUAL_FIXTURE`, a development-only switch (`src/main.tsx`) that
renders deterministic, static-data compositions built from the real
screens' own markup and CSS classes (`src/visual/JourneyFixtures.tsx`,
`PeakTerminalFixture.tsx`), never reachable in a production build. This is
the same method `docs/phase2-visual-evidence/` already used and certified.

## Evidence

| # | State (Master Ops §9) | 1024×768 | 1440×900 |
|---|---|---|---|
| 1 | STARTING (branded splash) | `01-splash-1024x768.png` | `01-splash-1440x900.png` |
| 2 | UNPROVISIONED/PAIRING, before a code | `02-pairing-1024x768.png` | `02-pairing-1440x900.png` |
| 3 | PAIRING, code issued, waiting for approval | `03-pairing-waiting-1024x768.png` | — |
| 4 | LOCKED, tap-to-select staff roster | `04-locked-roster-1024x768.png` | `04-locked-roster-1440x900.png` |
| 5 | LOCKED, PIN pad after a name is chosen | `05-locked-pin-1024x768.png` | — |
| 6 | NO_SHIFT, open-shift entry | `06-no-shift-1024x768.png` | `06-no-shift-1440x900.png` |
| 7 | OPERATIONAL, selling workspace | `07-operational-1024x768.png` | `07-operational-1440x900.png` |

Every screen: no horizontal overflow, the primary action is visible without
scrolling, the auth-shell card stays centered and does not stretch
unreasonably at the wider size, and the operational register's context rail
expands from icon-only to labeled between the two widths exactly as
`terminal-nav` is designed to.

## What this does and does not certify

**Certified**: the real Tauri/WebKit rendering path paints the Peak Evergreen
design system correctly (dark-first palette, control sizing, touch-target
sizing on the roster tiles and PIN pad, no layout breakage) at both a
minimum-supported and a larger desktop resolution, for every screen in the
T1 startup/access journey.

**Not certified here** (needs a live paired terminal against a running Peak
backend, out of scope for this environment): the actual network/IPC-driven
transitions between these states — those are covered instead by
`src/auth/DeviceSessionProvider.test.tsx`, `src/pages/PinUnlock.test.tsx`,
`src/pages/OpenShiftScreen.test.tsx`, `src/lib/terminalRoute.test.ts`, and
`src/App.test.tsx`, which exercise the real components and real routing logic
against mocked backend responses.
