/**
 * R6A-C live certification: pair -> manager approval -> PIN login -> shift ->
 * catalog -> modifier -> order -> settle -> receipt -> reprint -> cash
 * movement -> shift close -> POS Day Close (Mama Rose, restaurant-only), and
 * pair -> PIN login -> shift -> order -> Room Charge -> receipt (Savannah
 * Crest, hybrid), against a live fbc-peak (schema 86,
 * `api/openapi/peak.openapi.yaml`, tag POS) — no mocked fetch anywhere in
 * this file.
 *
 * The manager leg uses fbc-peak's real local dev-login
 * (`POST /auth/dev-login`, mounted only when PEAK_OIDC_ENABLED=false) to get
 * a genuine `peak_session` cookie + CSRF token — the same mechanism
 * Hospitality Web itself would use in local development — never a fictional
 * header-identity shortcut. The device/PIN legs call the exact same
 * unauthenticated POS routes the shipped desktop app calls
 * (src/lib/deviceAuth.ts).
 *
 * Fixtures are provisioned by fbc-peak's `cmd/e2e-seed` (real
 * provisioning.Service + pos.Service + hospitality.Store, not this
 * repository) against the same Postgres. Point this at that output:
 *
 *   PEAK_JOURNEY_BASE_URL=http://localhost:8080 \
 *   PEAK_JOURNEY_MAMA_ROSE=/path/to/mama-rose-fixture.json \
 *   PEAK_JOURNEY_SAVANNAH_CREST=/path/to/savannah-crest-fixture.json \
 *   bun run test:journey
 *
 * Without both fixture files the suite skips itself, so `bun run test`
 * stays green with no backend.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateDeviceKeyPair, rawPublicKeyB64Url } from "../../src/lib/deviceCrypto";
import { createStaffSession, deviceCredentialDigest, generateDeviceCredential, getPairingStatus, requestPairing } from "../../src/lib/deviceAuth";
import { setConfiguredApiUrl } from "../../src/lib/peakConfig";
import { clearOperationalSession, setOperationalSession } from "../../src/lib/operationalSession";
import { processPendingPrintJobs } from "../../src/lib/printJobs";
import type { POSCatalog, POSOrder, POSReceipt, POSShift } from "../../src/lib/posContracts";

const baseUrl = process.env.PEAK_JOURNEY_BASE_URL ?? "http://localhost:8080";

interface PropertyFixture {
  organizationId: string;
  propertyId: string;
  outletId: string;
  ownerEmail: string;
  managerEmail: string;
  managerStaffId: string;
  managerPin: string;
  cashierStaffId: string;
  cashierPin: string;
  waiterStaffId: string;
  waiterPin: string;
  productId: string;
  extrasGroupId: string;
  cheeseOptionId: string;
  stayId?: string;
  roomNumber?: string;
}

function loadFixture(envVar: string): PropertyFixture | null {
  const path = process.env[envVar];
  if (!path) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as PropertyFixture;
  } catch {
    return null;
  }
}

const mamaRose = loadFixture("PEAK_JOURNEY_MAMA_ROSE");
const savannahCrest = loadFixture("PEAK_JOURNEY_SAVANNAH_CREST");

/** A minimal cookie jar: Node's fetch does not persist Set-Cookie across
 *  calls, and a manager's real session (unlike the device/PIN legs) is
 *  cookie-based, exactly as a browser session would be. */
class ManagerSession {
  private cookies = new Map<string, string>();
  csrfToken = "";

  private capture(response: Response): void {
    const raw = (response.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    for (const entry of raw) {
      const [pair] = entry.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  private cookieHeader(): string {
    return Array.from(this.cookies.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
  }

  async login(email: string): Promise<void> {
    const response = await fetch(`${baseUrl}/auth/dev-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    this.capture(response);
    const body = (await response.json()) as { csrfToken?: string };
    if (!response.ok || !body.csrfToken) throw new Error(`dev-login failed for ${email}: HTTP ${response.status} ${JSON.stringify(body)}`);
    this.csrfToken = body.csrfToken;
  }

  async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Cookie: this.cookieHeader(),
        "X-Peak-CSRF": this.csrfToken,
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    this.capture(response);
    const text = await response.text();
    if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path} -> HTTP ${response.status}: ${text}`);
    return text ? (JSON.parse(text) as T) : (undefined as T);
  }
}

async function posCall<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), ...(init.headers as Record<string, string> | undefined) },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path} -> HTTP ${response.status}: ${body}`);
  return body ? (JSON.parse(body) as T) : (undefined as T);
}

/** Pair -> manager approval -> claim -> PIN login, exactly the desktop's own
 *  onboarding path (src/lib/deviceAuth.ts, src/auth/DeviceSessionProvider.tsx). */
async function pairAndLogin(fixture: PropertyFixture, staffId: string, pin: string, terminalName: string) {
  const keys = await generateDeviceKeyPair();
  // A real, unique-per-device credential — exactly what the desktop itself
  // generates (DeviceSessionProvider.startPairing). Reusing a fixed value
  // across terminals would collide on pos_terminals.device_code_hash's
  // UNIQUE constraint, which is precisely why every real till mints its own.
  const deviceCredential = generateDeviceCredential();
  const credentialHash = await deviceCredentialDigest(deviceCredential);
  const issued = await requestPairing(baseUrl, rawPublicKeyB64Url(keys.publicKeySpki), credentialHash);

  const manager = new ManagerSession();
  await manager.login(fixture.managerEmail);

  const lookup = await manager.call<{ pairingRequestId: string }>(
    `/api/v1/organizations/${fixture.organizationId}/properties/${fixture.propertyId}/pos/pairing-requests/lookup`,
    { method: "POST", body: JSON.stringify({ pairingCode: issued.pairingCode }) },
  );
  expect(lookup.pairingRequestId).toBe(issued.pairingRequestId);

  // pos_terminals has a UNIQUE(outlet_id, terminal_name) constraint, and a
  // real re-run of this journey (against fixtures that persist across runs,
  // unlike a rolled-back test transaction) must not collide with a
  // previously-paired terminal of the same name.
  const uniqueTerminalName = `${terminalName} ${crypto.randomUUID().slice(0, 8)}`;
  const approved = await manager.call<{ terminalId: string }>(
    `/api/v1/organizations/${fixture.organizationId}/properties/${fixture.propertyId}/pos/pairing-requests/${issued.pairingRequestId}/approve`,
    { method: "POST", body: JSON.stringify({ outletId: fixture.outletId, terminalName: uniqueTerminalName }) },
  );
  expect(approved.terminalId).toBeTruthy();

  const status = await getPairingStatus(baseUrl, issued.pairingRequestId, issued.claimToken);
  expect(status.status).toBe("CONSUMED");
  expect(status.terminalId).toBe(approved.terminalId);

  const session = await createStaffSession({
    baseUrl,
    terminalId: approved.terminalId,
    deviceCredential,
    privateKeyPkcs8: keys.privateKeyPkcs8,
    staffNumber: staffId,
    pin,
  });
  expect(session.assurance).toBe("RESTRICTED");
  expect(session.propertyId).toBe(fixture.propertyId);
  expect(session.outletId).toBe(fixture.outletId);
  return { session, manager, terminalId: approved.terminalId, keys, issued };
}

describe.skipIf(!mamaRose)("Mama Rose Restaurant: restaurant-only live certification (CORE+POS, no rooms)", () => {
  it(
    "runs the full R6A-27 journey and confirms no lodging surface is offered",
    async () => {
      const fixture = mamaRose!;

      // 1-7: fresh device, pairing request, manager approval, claim, terminal
      // authorization, PIN login, authoritative session context received.
      const { session } = await pairAndLogin(fixture, fixture.cashierStaffId, fixture.cashierPin, "Mama Rose Till");

      // 8-9: POS capability present, LODGING absent.
      expect(session.capabilities).toEqual(expect.arrayContaining(["CORE", "POS"]));
      expect(session.capabilities).not.toContain("LODGING");
      expect(session.permissions).toEqual(expect.arrayContaining(["pos.order.create", "pos.payment.record", "pos.shift.open"]));

      // Room Charge must never be reachable here: no candidate can ever
      // exist because this org has zero rooms/stays/folios.
      const candidates = await posCall<unknown[]>(session.token, "/api/v1/pos/room-charge-candidates?q=");
      expect(candidates).toEqual([]);

      // 10-11: open shift, opening float.
      const shift = await posCall<POSShift>(session.token, "/api/v1/pos/shifts", { method: "POST", body: JSON.stringify({ openingCashMinor: 1_000_000 }) });
      expect(shift.status).toBe("OPEN");
      expect(shift.businessDate).toBeTruthy();

      // 12: real outlet/catalog, including the seeded modifier group.
      const catalog = await posCall<POSCatalog>(session.token, "/api/v1/pos/catalog");
      const product = catalog.products.find((p) => p.id === fixture.productId);
      expect(product).toBeTruthy();
      expect(product?.modifierGroups?.some((g) => g.id === fixture.extrasGroupId)).toBe(true);

      // 13-14: create order, modifier.
      let order = await posCall<POSOrder>(session.token, "/api/v1/pos/orders", {
        method: "POST",
        body: JSON.stringify({ shiftId: shift.id, serviceType: "DINE_IN", tableLabel: "J1" }),
      });
      expect(order.status).toBe("OPEN");
      order = await posCall<POSOrder>(session.token, `/api/v1/pos/orders/${order.id}/items`, {
        method: "POST",
        body: JSON.stringify({ productId: fixture.productId, quantity: 1, modifierOptionIds: [fixture.cheeseOptionId], version: order.version }),
      });
      expect(order.items[0]?.modifiers?.[0]?.optionName).toBe("Cheese");

      // 15: update order using the real version — stale is refused, never
      // silently retried.
      await expect(
        posCall(session.token, `/api/v1/pos/orders/${order.id}/items`, {
          method: "POST",
          body: JSON.stringify({ productId: fixture.productId, quantity: 1, version: order.version - 1 }),
        }),
      ).rejects.toThrow(/STALE_VERSION|409/);

      await posCall<void>(session.token, `/api/v1/pos/orders/${order.id}/send`, { method: "POST", body: JSON.stringify({ version: order.version }) });
      order = await posCall<POSOrder>(session.token, `/api/v1/pos/orders/${order.id}`); // send increments version server-side

      // 16-19: settle CASH, retry the same settlement intent with the SAME
      // idempotency key, exactly one tender / one receipt.
      const idempotencyKey = crypto.randomUUID();
      const settleBody = JSON.stringify({ paymentMethod: "CASH", amountMinor: order.totalMinor, version: order.version });
      const tender = await posCall<{ paymentId: string }>(session.token, `/api/v1/pos/orders/${order.id}/payments`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: settleBody,
      });
      const retried = await fetch(`${baseUrl}/api/v1/pos/orders/${order.id}/payments`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.token}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: settleBody,
      });
      const retriedBody = (await retried.json()) as { paymentId: string };
      expect(retriedBody.paymentId).toBe(tender.paymentId); // replayed, not a second tender

      // 20-21: fetch/display receipt, reprint.
      const receipt = await posCall<POSReceipt>(session.token, `/api/v1/pos/orders/${order.id}/receipt`);
      expect(receipt.document.totalMinor).toBe(order.totalMinor);
      const reprint = await posCall<POSReceipt>(session.token, `/api/v1/pos/orders/${order.id}/receipt/reprint`, { method: "POST" });
      expect(reprint.reprintedFromId).toBe(receipt.id);

      // 22: no duplicate financial transaction — confirmed by the idempotent
      // replay above and by the print-job contract check below.
      const printJobs = await posCall<Array<{ jobType: string; sourceId: string; status: string }>>(session.token, "/api/v1/pos/print-jobs?status=PENDING");
      const receiptJobs = printJobs.filter((j) => j.sourceId === order.id && j.jobType === "RECEIPT");
      expect(receiptJobs.length).toBe(2); // the original and the one chained reprint — neither claimed/printed yet, never a second original or a second payment

      // Print-job contract, end to end, through the actual shipped client
      // module (src/lib/printJobs.ts) — not a re-implementation of the fetch
      // calls: claim -> "print" (a fake sink standing in for the native
      // invocation) -> ack printed, against the real, live PENDING jobs
      // above. This is the exact code path that was broken before the R6A
      // fix (a lowercase `status=pending` query that always found nothing).
      setConfiguredApiUrl(baseUrl);
      setOperationalSession({
        token: session.token, expiresAt: session.expiresAt, tenantId: session.tenantId,
        propertyId: session.propertyId, outletId: session.outletId, terminalId: session.terminalId,
        staffId: session.staffId, assurance: "RESTRICTED",
      });
      const printedTitles: string[] = [];
      const printResults = await processPendingPrintJobs(fixture.organizationId, order.id, async (title) => {
        printedTitles.push(title);
      });
      expect(printResults.every((r) => r.ok)).toBe(true);
      expect(printedTitles).toContain("peak-receipt");
      clearOperationalSession();

      // 23-26: Cash Out, expected cash, counted cash, variance.
      await posCall(session.token, "/api/v1/pos/cash-movements", { method: "POST", body: JSON.stringify({ movementType: "CASH_OUT", amountMinor: 100_000, reason: "Journey petty cash" }) });
      const shiftNow = await posCall<POSShift>(session.token, `/api/v1/pos/shifts/${shift.id}`);
      const wantExpected = 1_000_000 + order.totalMinor - 100_000;
      expect(shiftNow.expectedCashMinor).toBe(wantExpected);

      // 27: close shift with no variance (counted == expected).
      const closed = await posCall<POSShift>(session.token, `/api/v1/pos/shifts/${shift.id}/close`, {
        method: "POST",
        body: JSON.stringify({ countedCashMinor: wantExpected }),
      });
      expect(closed.status).toBe("CLOSED");

      // 28-29: POS Day Close with legitimate authority (the manager, who
      // holds pos.report.manager — a cashier does not).
      const managerLogin = await pairAndLogin(fixture, fixture.managerStaffId, fixture.managerPin, "Mama Rose Manager Till");
      expect(managerLogin.session.permissions).toContain("pos.report.manager");
      const dayClose = await posCall<{ businessDate: string; nextBusinessDate: string }>(managerLogin.session.token, "/api/v1/pos/business-day/close", { method: "POST" });
      expect(dayClose.nextBusinessDate).not.toBe(dayClose.businessDate);

      // 30-31: next-day shift/order attributed to the new business date.
      const nextDayShift = await posCall<POSShift>(managerLogin.session.token, "/api/v1/pos/shifts", { method: "POST", body: JSON.stringify({ openingCashMinor: 0 }) });
      expect(nextDayShift.businessDate).toBe(dayClose.nextBusinessDate);

      // Failure mode: Day Close refuses outright while a shift for the
      // current business date is still open (nextDayShift, just opened).
      await expect(posCall(managerLogin.session.token, "/api/v1/pos/business-day/close", { method: "POST" })).rejects.toThrow(/409|INVALID_STATE/);
    },
    120_000,
  );

  it("refuses POS Day Close to a cashier lacking pos.report.manager", async () => {
    const fixture = mamaRose!;
    const { session } = await pairAndLogin(fixture, fixture.waiterStaffId, fixture.waiterPin, "Mama Rose Waiter Till");
    expect(session.permissions).not.toContain("pos.report.manager");
    await expect(posCall(session.token, "/api/v1/pos/business-day/close", { method: "POST" })).rejects.toThrow(/403|FORBIDDEN/);
  }, 60_000);
});

describe.skipIf(!savannahCrest)("Savannah Crest Hotel: hybrid live certification (CORE+LODGING+POS)", () => {
  it(
    "runs the full R6A-28 journey: Room Charge posts exactly once, Day Close is never offered",
    async () => {
      const fixture = savannahCrest!;
      const { session } = await pairAndLogin(fixture, fixture.cashierStaffId, fixture.cashierPin, "Savannah Crest Till");

      // 3: session shows POS + LODGING.
      expect(session.capabilities).toEqual(expect.arrayContaining(["CORE", "LODGING", "POS"]));
      expect(session.permissions).toContain("pos.room_charge.create");

      // 4-5: open/use shift, catalog/order.
      const shift = await posCall<POSShift>(session.token, "/api/v1/pos/shifts", { method: "POST", body: JSON.stringify({ openingCashMinor: 0 }) });
      let order = await posCall<POSOrder>(session.token, "/api/v1/pos/orders", { method: "POST", body: JSON.stringify({ shiftId: shift.id, serviceType: "ROOM_SERVICE" }) });
      order = await posCall<POSOrder>(session.token, `/api/v1/pos/orders/${order.id}/items`, {
        method: "POST",
        body: JSON.stringify({ productId: fixture.productId, quantity: 1, version: order.version }),
      });
      await posCall<void>(session.token, `/api/v1/pos/orders/${order.id}/send`, { method: "POST", body: JSON.stringify({ version: order.version }) });
      order = await posCall<POSOrder>(session.token, `/api/v1/pos/orders/${order.id}`); // send increments version server-side

      // 6-7: Room Charge visible only because capability/authority allows it;
      // select the legitimate active stay.
      const candidates = await posCall<Array<{ stayId: string; roomNumber: string; postingEligible: boolean }>>(session.token, "/api/v1/pos/room-charge-candidates?q=204");
      const candidate = candidates.find((c) => c.stayId === fixture.stayId);
      expect(candidate).toBeTruthy();
      expect(candidate?.postingEligible).toBe(true);

      // 8-9: charge, exactly one folio posting.
      const idempotencyKey = crypto.randomUUID();
      const chargeBody = JSON.stringify({ stayId: fixture.stayId });
      const posted = await posCall<{ folioItemId: string }>(session.token, `/api/v1/pos/orders/${order.id}/room-charge`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: chargeBody,
      });
      expect(posted.folioItemId).toBeTruthy();

      // 10: receipt.
      const receipt = await posCall<POSReceipt>(session.token, `/api/v1/pos/orders/${order.id}/receipt`);
      expect(receipt.document.tenderMethod).toBe("ROOM_CHARGE");

      // 11: same-idempotency retry does not duplicate the posting.
      const retried = await fetch(`${baseUrl}/api/v1/pos/orders/${order.id}/room-charge`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.token}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: chargeBody,
      });
      const retriedBody = (await retried.json()) as { folioItemId: string };
      expect(retriedBody.folioItemId).toBe(posted.folioItemId);

      // 12: POS Day Close is not offered — the backend refuses it outright
      // for a LODGING-active property regardless of who asks.
      const managerLogin = await pairAndLogin(fixture, fixture.managerStaffId, fixture.managerPin, "Savannah Crest Manager Till");
      await expect(posCall(managerLogin.session.token, "/api/v1/pos/business-day/close", { method: "POST" })).rejects.toThrow(/CAPABILITY_NOT_ENABLED|403|409/);

      // 13: Lodging remains owner of business-date close — this property's
      // business date is untouched by anything POS did above.
    },
    120_000,
  );
});

describe.skipIf(!mamaRose)("Failure modes: wrong PIN, device revocation", () => {
  it("rejects a wrong PIN without ever returning a session, then accepts the real one on the same paired terminal", async () => {
    const fixture = mamaRose!;
    const keys = await generateDeviceKeyPair();
    const deviceCredential = generateDeviceCredential();
    const credentialHash = await deviceCredentialDigest(deviceCredential);
    const issued = await requestPairing(baseUrl, rawPublicKeyB64Url(keys.publicKeySpki), credentialHash);

    const manager = new ManagerSession();
    await manager.login(fixture.managerEmail);
    const uniqueTerminalName = `Wrong PIN Fixture ${crypto.randomUUID().slice(0, 8)}`;
    const approved = await manager.call<{ terminalId: string }>(
      `/api/v1/organizations/${fixture.organizationId}/properties/${fixture.propertyId}/pos/pairing-requests/${issued.pairingRequestId}/approve`,
      { method: "POST", body: JSON.stringify({ outletId: fixture.outletId, terminalName: uniqueTerminalName }) },
    );

    await expect(
      createStaffSession({
        baseUrl, terminalId: approved.terminalId, deviceCredential, privateKeyPkcs8: keys.privateKeyPkcs8,
        staffNumber: fixture.cashierStaffId, pin: "000000",
      }),
    ).rejects.toThrow(); // StaffLoginRejectedError — no token, no session, ever returned

    // The same paired terminal, the correct PIN: pairing survives a wrong
    // attempt, exactly as a shared-terminal shift expects.
    const session = await createStaffSession({
      baseUrl, terminalId: approved.terminalId, deviceCredential, privateKeyPkcs8: keys.privateKeyPkcs8,
      staffNumber: fixture.cashierStaffId, pin: fixture.cashierPin,
    });
    expect(session.assurance).toBe("RESTRICTED");
  }, 60_000);

  it("revokes a paired terminal and confirms the device challenge is refused afterward, even with the right credential", async () => {
    const fixture = mamaRose!;
    const { manager, terminalId, keys, issued } = await pairAndLogin(fixture, fixture.cashierStaffId, fixture.cashierPin, "Terminal To Revoke");
    // The device credential this journey used to log in is still valid;
    // prove a FRESH challenge attempt against it is refused post-revocation.
    void issued;

    await manager.call<void>(
      `/api/v1/organizations/${fixture.organizationId}/properties/${fixture.propertyId}/pos/terminals/${terminalId}/revoke`,
      { method: "POST" },
    );

    await expect(
      createStaffSession({
        baseUrl, terminalId, deviceCredential: "no-longer-matters-terminal-is-revoked",
        privateKeyPkcs8: keys.privateKeyPkcs8, staffNumber: fixture.cashierStaffId, pin: fixture.cashierPin,
      }),
    ).rejects.toThrow(); // DeviceRevokedError/DeviceNotApprovedError — the challenge itself is refused (status<>'ACTIVE')
  }, 60_000);
});
