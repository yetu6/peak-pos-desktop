# Peak POS V1 release and update runbook

FBC-managed, **manual** installs only. There is no automatic updater in this
binary, the installer, or the till UI. That absence is an invariant, not a
gap to paper over: the till cannot accept an unsigned update because it
never pulls one. See `docs/adr/0001-automatic-updater-deferred.md`.

Version is `package.json` = `src-tauri/tauri.conf.json` = `src-tauri/Cargo.toml`
(`0.1.0` at the time this runbook landed). Diagnostics reads that embedded
version (`packagedAppVersion` / `host_diagnostics`), never a hardcoded
placeholder.

## Toolchain (pin these in the release record)

| Tool | How to read |
|---|---|
| Bun | `bun --version` |
| Node | `node --version` (Vitest/bridge) |
| Rustc | `rustc --version` |
| Cargo | `cargo --version` |
| Tauri CLI | `bunx tauri --version` |

Record the host OS and arch (`uname -a`) next to the checksums.

## Deterministic production build

From this repository, on a clean tree (`git status` empty except the
release notes you are writing):

```bash
git rev-parse HEAD
bun install --frozen-lockfile
bun run typecheck
bun run test
(cd src-tauri && cargo test)
bunx tauri build
```

`tauri build` runs `bun run build` first (`tsc -b && vite build`), then
produces the native bundle under `src-tauri/target/release/bundle/`.

Byte-identical rebuilds require the same OS, same toolchain versions, and
the same lockfiles. If the two artifacts differ, publish both checksums and
treat them as behavior-identical only after the smoke below passes on each.

Copy the installer(s) into a versioned directory and checksum them:

```bash
mkdir -p dist/release/0.1.0
# copy the .deb / .AppImage / .msi / .dmg the target OS actually uses
scripts/checksum-release.sh dist/release/0.1.0
```

Publish `SHA256SUMS` next to the artifacts. Never commit the binaries.

## Backend compatibility

This till talks directly to fbc-peak's REST contract (`api/openapi/peak.openapi.yaml`,
tag `POS`) via a small hand-rolled fetch client (`src/lib/api.ts`); there is
no packaged API client tarball. As of R6A (see
`docs/POS_DESKTOP_R6A_CLOSURE.md`), a POS `0.1.x` release needs a Peak
backend that is at **schema 86 or later** (R5C, the certified/frozen POS V1
contract) and serves, at minimum:

- `/api/v1/pos/pairing-requests`, `/api/v1/pos/device/challenges`, `/api/v1/pos/sessions`
- `/api/v1/pos/shifts`, `/api/v1/pos/shifts/{id}`, `/api/v1/pos/shifts/{id}/close`
- `/api/v1/pos/cash-movements`, `/api/v1/pos/shifts/{id}/cash-movements`
- `/api/v1/pos/catalog` (with `categories`/`modifierGroups`/`modifierOptions`)
- `/api/v1/pos/orders` and its `items`/`send`/`status/{status}`/`payments`/`room-charge`/`void` sub-routes, all version-checked
- `/api/v1/pos/orders/{id}/receipt` and `/receipt/reprint`
- `/api/v1/pos/business-day/close`
- `/api/v1/pos/print-jobs` (job types `KITCHEN_TICKET` and `RECEIPT` only — there is no `void_ticket` or `shift_report` job type)

A schema older than 86 is missing order versioning, modifiers, cash
movements, and the receipt/reprint contract this till now depends on for
every settled order — do not install against one.

## Supported upgrade path

| From | To | Path |
|---|---|---|
| none (new hardware) | `0.1.x` | Fresh install |
| `0.1.x` | later `0.1.y` | Install over the existing app |
| anything else | `0.1.x` | Not supported — re-pair as a new till |

There is no skip-level upgrade yet because there is no prior production
series.

## What must survive an ordinary upgrade

The Ed25519 device key is **not** in the install directory.

- OS keychain entry: service `com.peak.pos`, user `device-ed25519`
- Public identity file: Tauri `app_data_dir` + `device-identity.json`
- Peak URL: Tauri `app_config_dir` + `peak-config.json`

Replacing the binary must not regenerate those. `IdentityVault` tests cover
save/load at the same path; a copied identity file without the keychain
entry is a **new unpaired device**.

Till session ids live in the webview `localStorage`
(`peak-pos-session-{propertyId}-{outletId}`). They survive a same-profile
upgrade. Staff must PIN again.

## FBC install (v1)

1. Confirm the property's Peak backend is the compatible V1 above.
2. Verify `SHA256SUMS` on the technician laptop (`sha256sum -c SHA256SUMS`).
3. Install the OS-native bundle with the OS installer. Do not unpack a
   foreign-arch artifact onto the till.
4. Launch Peak POS. First boot is `needs-url` — type the Peak origin
   (HTTPS, or HTTP only for localhost).
5. Pair: six-digit code → manager approval in Hospitality Web (outlet +
   terminal name + mode). The till never picks property/outlet/mode.
6. Staff number + PIN. Eligibility gate: **UNKNOWN is not READY**.
7. Diagnostics → technician view: version, OS, printer, device code. No
   private key, no `ops_` token.
8. Smoke: open till → order → send → settle cash → close till. Printer
   failure must not unpay or reopen the till.

## FBC update (v1 → approved vN)

1. Close the till in Peak (`Close till`) so no shift is mid-transaction.
2. Switch Staff so no ops session is live.
3. Quit the app.
4. Verify checksums of the new artifact.
5. Install over the existing application (do not delete
   `~/.local/share/com.peak.pos`, macOS Application Support, or Windows
   AppData, and do not reset the OS keychain).
6. Launch. Confirm PIN unlock still works without a new pairing code.
7. Diagnostics version is the new one. Device code is the old one.
8. Run the post-upgrade smoke below.

## Post-upgrade smoke

- Splash → `locked` (not `unpaired`).
- Staff PIN succeeds.
- Open orders created under v1 are still listed.
- New order → send → Peak print job appears (or PRINT FAILURE if no
  printer — order still sent).
- Settle cash → receipt job; printer failure does not unpay.
- Diagnostics has no secrets.

## Failed or aborted upgrade

If the installer is killed mid-write:

1. Do not launch a half-written binary.
2. Re-run the **previous** approved installer from its checksummed copy.
3. If the app will not start, reinstall that previous artifact. Identity
   lives outside the binary dir, so a clean reinstall of the same version
   should still PIN-unlock.
4. If the keychain entry is gone, the till is unpaired — generate a new
   pairing code. Do not copy `device-identity.json` from another machine.
5. If Peak URL is lost, the technician re-enters it on `needs-url`.

A corrupted download is rejected by `sha256sum -c`. Do not install it.

## Secrets that must never be in the installer

The bundle must not embed:

- Peak DB passwords, Keycloak client secrets, JWT material
- Beem / Snippe / MinIO / webhook keys
- Device private keys, staff PINs, `ops_` tokens
- A property, outlet, or tenant id baked in as production identity

`VITE_PEAK_*` header identity is a **dev** bootstrap. Production tills
pair. Confirm a production build does not ship those env values.

## v1 → v2 upgrade test (as far as this OS can show)

Without two signed installers in CI, the proven slice is:

- `src-tauri` `installing_over_the_same_app_data_path_keeps_the_keypair`
- `deviceIdentity` save/load at the same store
- This runbook's "what must survive" path on a real till: install, pair,
  order, install over, PIN, prior orders visible

A full two-artifact installer test against Podman is an FBC lab step, not
something the unit suite can fake. Record pass/fail in the Wave 2 evidence
when that lab run happens.

## Automatic updater

**NOT IMPLEMENTED.** Do not classify it as implemented, partial, or
"coming in this binary."

## CI / GitHub Releases

Tag a version (`git tag v0.1.1 && git push origin v0.1.1`) to run
`.github/workflows/release.yml`. It builds linux / windows / macos Tauri
bundles, writes `SHA256SUMS`, and publishes a GitHub Release.

`workflow_dispatch` can build the same artifacts as a draft release for
smoke testing without a tag.

## VPS download hosting

Hotels should not need a GitHub account. Mirror the latest Release artifacts
onto the existing API/ops host (or object storage) under a stable URL:

```bash
# On the VPS (example paths — adjust to your Caddy/nginx root)
sudo mkdir -p /var/www/yetu-downloads/pos/latest
# copy .msi / .dmg / .deb / AppImage + SHA256SUMS from the GitHub Release
sudo chmod -R a+rX /var/www/yetu-downloads/pos
```

Serve that tree over TLS (same cert family as `api.yetu…`). Point Hospitality
Web at it:

```bash
NEXT_PUBLIC_POS_DOWNLOAD_URL=https://downloads.yetu.fbcsoftwares.com/pos/latest/
```

Registers & Devices then shows **Download Yetu POS**. The till still has no
auto-updater — managers download and install manually after verifying
checksums.
