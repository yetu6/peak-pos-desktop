# Peak POS boot sequence

The till is an appliance. It does not pick a property, outlet, or mode.
Those come from pairing. There is no automatic updater in this binary.

## Shell phases

Named in `src/auth/DeviceSessionProvider.tsx`. The first paint is
`bootstrapping` (the splash). After that:

| Phase | What the operator sees | What is true |
|---|---|---|
| `bootstrapping` | "Starting till…" | Identity and Peak URL are still loading. |
| `needs-url` | Setup screen | No Peak address is stored. The technician types `https://…` (HTTP only for localhost). |
| `unpaired` | Pairing screen | A device key exists. Peak has not approved this till. |
| `waiting` | Pairing wait | A six-digit code is live. The manager has not approved it yet. |
| `locked` | PIN unlock | The device is paired. No staff ops session. |
| `ready` | Live register, after eligibility | Staff PIN succeeded. |

`shellStateOf` maps those to `UNPAIRED` / `PAIRED_LOCKED` / `OPERATIONAL`.
`ready` is the only OPERATIONAL shell.

## Eligibility (after PIN)

`VerificationGate` sits between OPERATIONAL and the register. Peak already
refuses unverified POS commands; this gate stops the till looking open.

| Status | Register |
|---|---|
| `LOADING` | Spinner |
| `READY` | Register |
| `UNVERIFIED` | Closed — business not verified |
| `UNKNOWN` | Closed — Peak did not confirm. **UNKNOWN is not READY.** |

A two-minute last-known-good READY cache covers a transient onboarding-read
failure for the same tenant. A successful unverified answer clears it.

## Switch Staff

Ends the waiter ops session and returns to `locked`. It does not:

- unpair the device
- regenerate the Ed25519 key
- close the cashier till (`peak-pos-session-{property}-{outlet}` stays)
- change property, outlet, or mode

## Autostart

The packaged window is the appliance. OS login-start is a technician
install choice, not an in-app toggle. There is no in-app auto-update
channel. Releases are FBC-managed; see the (separate) V1 release runbook
when it exists.

## After a crash

Reopen the app. Stored Peak URL, pairing, and (if the OS keychain still
holds it) the device private key survive. Staff must PIN again. An open
till id in localStorage is reused only if Peak still reports that session
`open`.
