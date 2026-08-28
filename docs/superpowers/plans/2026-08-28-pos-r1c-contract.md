# POS R1C Production Post-Login Contract Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close POS-001 by retaining the authoritative server session context and reaching the existing register only after successful bootstrap through current Go POS routes.

**Architecture:** Treat the merged `fbc-peak` restricted-session response as the sole production authority for organization, property, outlet, terminal, and staff identity. Validate that response, then probe the existing session-bound catalog and active-order endpoints before publishing any operational session to the application. Remove the obsolete onboarding/eligibility gate entirely and fail closed by clearing prior session state before every authentication attempt and on logout, expiry, revocation, or bootstrap failure.

**Tech Stack:** React 19, TypeScript 7, TanStack Query, Vitest/Testing Library, Tauri 2, Rust.

**Spec:** User-approved `PEAK POS — R1C PRODUCTION POST-LOGIN CONTRACT CLOSURE` request in this work session.

## Global Constraints

- Modify only `peak-pos-desktop`; keep `fbc-peak` read-only.
- Current merged Go runtime/OpenAPI is authoritative.
- Do not add endpoints, POS features, capabilities, redesign, or unrelated cleanup.
- Commit and stop after the closure report.

---

### Task 1: Authoritative session DTO and post-login bootstrap

**Files:**
- Modify: `src/lib/operationalSession.ts`
- Modify: `src/lib/deviceAuth.ts`
- Create: `src/lib/postLoginBootstrap.ts`
- Modify: `src/lib/deviceAuth.test.ts`
- Create: `src/lib/postLoginBootstrap.test.ts`

**Interfaces:**
- Consumes: merged backend `POST /api/v1/pos/sessions`, `GET /api/v1/pos/catalog`, and `GET /api/v1/pos/orders?active=true`.
- Produces: a complete `OperationalSession` and `bootstrapOperationalSession(baseUrl, session)`.

- [ ] Add a failing authentication test proving `tenantId` is retained and missing server context is rejected.
- [ ] Run the focused test and confirm failure because `createStaffSession` currently discards `tenantId`.
- [ ] Make server-required context fields mandatory and validate/map the complete login response.
- [ ] Add failing bootstrap tests for exact routes, bearer-only authority, outlet mismatch, 401 expiry, and backend failure.
- [ ] Run the bootstrap tests and confirm failure because the bootstrap module does not exist.
- [ ] Implement the minimal real-route bootstrap and rerun focused tests to green.

### Task 2: Fail-closed provider lifecycle and usable operational state

**Files:**
- Modify: `src/auth/DeviceSessionProvider.tsx`
- Modify: `src/auth/DeviceSessionProvider.test.tsx`

**Interfaces:**
- Consumes: complete `OperationalSession` and `bootstrapOperationalSession` from Task 1.
- Produces: a `ready` phase only after real backend bootstrap succeeds.

- [ ] Add failing provider tests proving successful bootstrap reaches `OPERATIONAL`, previous tenant state is cleared before a failed login, bootstrap/network failure remains locked, logout clears context, and revoked device clears device authority.
- [ ] Run focused provider tests and confirm the expected failures against the current publish-before-bootstrap behavior.
- [ ] Clear session/cache/bridge authority before login, bootstrap before publishing the new session, preserve existing non-authority terminal labels, and clear authority on every failure/logout path.
- [ ] Rerun provider tests to green.

### Task 3: Remove the nonexistent onboarding contract

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/hooks/usePosData.ts`
- Delete: `src/pages/VerificationGate.tsx`
- Delete: `src/pages/VerificationGate.test.tsx`
- Delete: `src/lib/eligibility.ts`
- Delete: `src/lib/eligibility.test.ts`
- Modify: `docs/boot-sequence.md`

**Interfaces:**
- Consumes: provider `ready` phase certified by Task 2.
- Produces: direct rendering of the existing usable `LiveRegister`; no onboarding request remains reachable.

- [ ] Add/adjust a flow assertion that records all post-login URLs and fails if any onboarding URL appears.
- [ ] Remove `VerificationGate`, `useTenantVerification`, and its stale last-known-good cache.
- [ ] Render `LiveRegister` directly for `OPERATIONAL` and update the boot sequence documentation.
- [ ] Run focused frontend tests to green.

### Task 4: Closure evidence and certification

**Files:**
- Create: `docs/POS_R1C_CONTRACT_CLOSURE.md`

**Interfaces:**
- Consumes: final implementation and all verification output.
- Produces: the requested ten-part R1C closure record.

- [ ] Record the operation/URL/request/response/mismatch/correction matrix and tenant lifecycle.
- [ ] Record original defects, final sequence, failure behavior, deferred P1/P2 findings, and honest POS-001 disposition.
- [ ] Run all frontend tests, journey tests where configured, typecheck, production build, Rust tests, Cargo check, and Tauri build/check where supported.
- [ ] Run the read-only real PostgreSQL backend POS contract test and correlate it with desktop route tests.
- [ ] Confirm no `fbc-peak` changes and no obsolete onboarding URL remains in executable desktop code.
- [ ] Commit the implementation and closure documentation, verify a clean worktree, and stop.
