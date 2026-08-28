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
| `ready` | Live register | Staff PIN succeeded, server authority was retained, and current catalog plus active-order bootstrap completed. |

`shellStateOf` maps those to `UNPAIRED` / `PAIRED_LOCKED` / `OPERATIONAL`.
`ready` is the only OPERATIONAL shell.

## Post-login bootstrap

The restricted session response is authoritative for organization, property,
outlet, terminal, and staff context. The client validates every required field,
then calls only the current session-bound routes:

- `GET /api/v1/pos/catalog`
- `GET /api/v1/pos/orders?active=true`

The catalog outlet must match the authenticated outlet. A missing field,
authority mismatch, rejected/expired token, malformed response, or unavailable
backend leaves the till in `locked`; no operational session is published. There
is no tenant onboarding request or client-selected production tenant.

## Switch Staff

Ends the waiter ops session and returns to `locked`. It does not:

- unpair the device
- regenerate the Ed25519 key
- close the cashier till (`peak-pos-session-{property}-{outlet}` stays)
- change property, outlet, or mode

## Autostart

The packaged window is the appliance. OS login-start is a technician
install choice, not an in-app toggle. There is no in-app auto-update
channel. Releases are FBC-managed; see `docs/v1-release.md`.
Automatic self-updating is **NOT IMPLEMENTED** (`docs/adr/0001-automatic-updater-deferred.md`).

## After a crash

Reopen the app. Stored Peak URL, pairing, and (if the OS keychain still
holds it) the device private key survive. Staff must PIN again. An open
till id in localStorage is reused only if Peak still reports that session
`open`.
