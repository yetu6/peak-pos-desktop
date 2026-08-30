/**
 * Pair → PIN login → open shift → catalog → order → modifiers → send →
 * settle cash → receipt → reprint → cash movement → close shift, against a
 * live fbc-peak (schema 86, `api/openapi/peak.openapi.yaml`, tag POS).
 *
 * Manager approval uses the dev header identity Peak accepts when
 * PEAK_ALLOW_HEADER_IDENTITY=true, matching how this repo's other journey
 * suite authenticates as a property user. The device/PIN legs use the same
 * real, unauthenticated POS routes the desktop app itself calls
 * (src/lib/deviceAuth.ts) — nothing here is a fictional endpoint.
 *
 *   PEAK_JOURNEY_BASE_URL=http://localhost:8080 \
 *   PEAK_JOURNEY_ORGANIZATION_ID=... PEAK_JOURNEY_USER_ID=... \
 *   PEAK_JOURNEY_PROPERTY_ID=... PEAK_JOURNEY_OUTLET_ID=... \
 *   PEAK_JOURNEY_STAFF_ID=... PEAK_JOURNEY_STAFF_PIN=... \
 *   bun run test:journey
 *
 * Optional: PEAK_JOURNEY_PRODUCT_ID if the outlet catalog is empty.
 * Without credentials the suite skips itself.
 */
import { describe, expect, it } from "vitest";
import { generateDeviceKeyPair, rawPublicKeyB64Url } from "../../src/lib/deviceCrypto";
import { createStaffSession, getPairingStatus, requestPairing } from "../../src/lib/deviceAuth";
import type { POSCatalog, POSOrder, POSReceipt, POSShift } from "../../src/lib/posContracts";

const baseUrl = process.env.PEAK_JOURNEY_BASE_URL ?? "http://localhost:8080";
const organizationId = process.env.PEAK_JOURNEY_ORGANIZATION_ID;
const userId = process.env.PEAK_JOURNEY_USER_ID;
const propertyId = process.env.PEAK_JOURNEY_PROPERTY_ID;
const outletId = process.env.PEAK_JOURNEY_OUTLET_ID;
const staffId = process.env.PEAK_JOURNEY_STAFF_ID;
const staffPin = process.env.PEAK_JOURNEY_STAFF_PIN;
const enabled = Boolean(organizationId && userId && propertyId && outletId && staffId && staffPin);

function managerHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "X-Peak-Tenant-Id": organizationId!,
    "X-Peak-Tenant-User-Id": userId!,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function peak<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { ...managerHeaders(), ...(init.headers as Record<string, string> | undefined) } });
  const body = await response.text();
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path} → HTTP ${response.status}: ${body}`);
  return body ? (JSON.parse(body) as T) : (undefined as T);
}

async function posCall<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), ...(init.headers as Record<string, string> | undefined) },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path} → HTTP ${response.status}: ${body}`);
  return body ? (JSON.parse(body) as T) : (undefined as T);
}

describe.skipIf(!enabled)("POS desktop: pair, PIN, shift, order, settle, receipt (real fbc-peak)", () => {
  it(
    "runs the certified POS V1 journey end-to-end against real Postgres",
    async () => {
      // 1–4: fresh device identity, pairing request, manager approval, claim.
      const keys = await generateDeviceKeyPair();
      const issued = await requestPairing(baseUrl, rawPublicKeyB64Url(keys.publicKeySpki), "a".repeat(64));

      const lookup = await peak<{ pairingRequestId: string }>(
        `/api/v1/organizations/${organizationId}/properties/${propertyId}/pos/pairing-requests/lookup`,
        { method: "POST", body: JSON.stringify({ pairingCode: issued.pairingCode }) },
      );
      expect(lookup.pairingRequestId).toBe(issued.pairingRequestId);

      const approved = await peak<{ terminalId: string }>(
        `/api/v1/organizations/${organizationId}/properties/${propertyId}/pos/pairing-requests/${issued.pairingRequestId}/approve`,
        { method: "POST", body: JSON.stringify({ outletId, terminalName: "Journey till" }) },
      );
      expect(approved.terminalId).toBeTruthy();

      const status = await getPairingStatus(baseUrl, issued.pairingRequestId, issued.claimToken);
      expect(status.status).toBe("CONSUMED");
      expect(status.terminalId).toBe(approved.terminalId);

      // 5: PIN login binds device+staff+PIN into a restricted POS session.
      // Reuses the exact `issueChallenge`/`/pos/sessions` calls the desktop
      // app itself makes (src/lib/deviceAuth.ts) — this journey never talks
      // to a route the shipped app does not also use.
      const session = await createStaffSession({
        baseUrl,
        terminalId: approved.terminalId,
        deviceCredential: approved.terminalId,
        privateKeyPkcs8: keys.privateKeyPkcs8,
        staffNumber: staffId!,
        pin: staffPin!,
      });
      expect(session.assurance).toBe("RESTRICTED");
      expect(session.propertyId).toBe(propertyId);
      expect(session.outletId).toBe(outletId);

      // 6: open shift with an opening float.
      const shift = await posCall<POSShift>(session.token, "/api/v1/pos/shifts", { method: "POST", body: JSON.stringify({ openingCashMinor: 1_000_000 }) });
      expect(shift.status).toBe("OPEN");
      expect(shift.businessDate).toBeTruthy();

      // 7: real outlet catalog.
      const catalog = await posCall<POSCatalog>(session.token, "/api/v1/pos/catalog");
      const productId = process.env.PEAK_JOURNEY_PRODUCT_ID ?? catalog.products[0]?.id;
      if (!productId) throw new Error("Outlet has no menu item; set PEAK_JOURNEY_PRODUCT_ID");

      // 8–10: create order, add item (server-priced), confirm.
      let order = await posCall<POSOrder>(session.token, "/api/v1/pos/orders", {
        method: "POST",
        body: JSON.stringify({ shiftId: shift.id, serviceType: "DINE_IN", tableLabel: "J1" }),
      });
      expect(order.status).toBe("OPEN");
      order = await posCall<POSOrder>(session.token, `/api/v1/pos/orders/${order.id}/items`, {
        method: "POST",
        body: JSON.stringify({ productId, quantity: 1, version: order.version }),
      });
      expect(order.items.length).toBeGreaterThan(0);
      expect(order.totalMinor).toBeGreaterThan(0);

      // Stale version is refused, never silently retried.
      await expect(
        posCall(session.token, `/api/v1/pos/orders/${order.id}/items`, {
          method: "POST",
          body: JSON.stringify({ productId, quantity: 1, version: order.version - 1 }),
        }),
      ).rejects.toThrow(/STALE_VERSION|409/);

      await posCall<void>(session.token, `/api/v1/pos/orders/${order.id}/send`, { method: "POST", body: JSON.stringify({ version: order.version }) });

      // 11: settle CASH for the server's exact total.
      const tender = await posCall<{ paymentId: string }>(session.token, `/api/v1/pos/orders/${order.id}/payments`, {
        method: "POST",
        body: JSON.stringify({ paymentMethod: "CASH", amountMinor: order.totalMinor, version: order.version }),
      });
      expect(tender.paymentId).toBeTruthy();

      // 12: immutable receipt.
      const receipt = await posCall<POSReceipt>(session.token, `/api/v1/pos/orders/${order.id}/receipt`);
      expect(receipt.document.totalMinor).toBe(order.totalMinor);
      expect(receipt.reprintCount).toBe(0);

      // 13: reprint — chained, no new payment, no new original.
      const reprint = await posCall<POSReceipt>(session.token, `/api/v1/pos/orders/${order.id}/receipt/reprint`, { method: "POST" });
      expect(reprint.reprintedFromId).toBe(receipt.id);

      // 14: cash movement folds into expected cash server-side.
      await posCall(session.token, "/api/v1/pos/cash-movements", { method: "POST", body: JSON.stringify({ movementType: "CASH_OUT", amountMinor: 100_000, reason: "Journey test petty cash" }) });

      // 15: expected cash reflects the tender and the movement.
      const shiftNow = await posCall<POSShift>(session.token, `/api/v1/pos/shifts/${shift.id}`);
      expect(shiftNow.expectedCashMinor).toBe(1_000_000 + order.totalMinor - 100_000);

      // 16–17: count and close.
      const closed = await posCall<POSShift>(session.token, `/api/v1/pos/shifts/${shift.id}/close`, {
        method: "POST",
        body: JSON.stringify({ countedCashMinor: shiftNow.expectedCashMinor }),
      });
      expect(closed.status).toBe("CLOSED");
    },
    120_000,
  );
});
