# ADR 0001 — Automatic POS updater (deferred)

**Status:** Deferred. **NOT IMPLEMENTED.** Not scheduled in the current
seven-wave certification plan.

**Date:** 2026-08-18

## Decision

Peak POS v1 is distributed by FBC as a checksummed, technician-installed
artifact. The till does not check for updates, download binaries, or
replace itself.

This ADR exists so later work cannot treat "we should add an updater" as
an undocumented assumption. No updater code ships until this ADR is
superseded by an accepted design and a dedicated implementation wave.

## Why V1 stays manual

- An update must never land mid-settlement, mid-PIN, or mid-print-claim.
- Signing-key custody, hosted release metadata, and channel policy are
  release-engineering problems, not till-feature problems.
- A missing updater cannot accept an unsigned binary. A half-built
  updater could.

## Required before any updater code

A replacement ADR must specify:

1. Signing-key generation and custody (who holds the private key, where,
   how many people).
2. Release signing and verification on the till (what is signed: bundle,
   manifest, both).
3. Release hosting (where manifests and artifacts live; TLS and
   authenticity).
4. Channels (stable / beta) if any, and who may promote a build.
5. Manifest security (hash list, size, version monotonicity, rollback
   windows).
6. Key rotation and compromised-key response (how a till learns a new
   key without trusting the attacker who already has the old one).
7. Rollback policy (when the till keeps the previous binary).
8. Scheduling around live shifts: an update must wait until the till is
   `locked` or `unpaired`, never during `ready` with an open cashier
   session or an in-flight payment.

## Current V1 path

`docs/v1-release.md` — deterministic build, checksums, FBC install,
identity survival, rollback, post-upgrade smoke.

## Consequences

- Wave 2 may close without an updater.
- Status reports must say **NOT IMPLEMENTED** for automatic updates
  until a later ADR is executed.
- Do not add Tauri updater plugins, hidden download tasks, or
  "check for updates" UI in the meantime.
