/**
 * Commissioning → order → settle → print against a live Peak.
 *
 * Requires the same identity env as `realtime.journey.test.ts`, plus a
 * verified tenant that can open a till. Pairing/revocation uses the
 * unauthenticated device routes and the manager approval/revoke routes.
 *
 *   PEAK_JOURNEY_TENANT_ID=... PEAK_JOURNEY_USER_ID=... \
 *   PEAK_JOURNEY_PROPERTY_ID=... PEAK_JOURNEY_OUTLET_ID=... \
 *   bun run test:journey
 *
 * Optional: PEAK_JOURNEY_MENU_ITEM_ID if the outlet catalog is empty.
 * Without credentials the suite skips itself.
 */
import { afterEach, describe, expect, it } from "vitest";
import { generateDeviceKeyPair } from "../../src/lib/deviceCrypto";
import { createStaffSession, DeviceRevokedError, issueChallenge } from "../../src/lib/deviceAuth";

const baseUrl = process.env.PEAK_JOURNEY_BASE_URL ?? "http://localhost:8080";
const tenantId = process.env.PEAK_JOURNEY_TENANT_ID;
const userId = process.env.PEAK_JOURNEY_USER_ID;
const propertyId = process.env.PEAK_JOURNEY_PROPERTY_ID;
const outletId = process.env.PEAK_JOURNEY_OUTLET_ID;
const enabled = Boolean(tenantId && userId && propertyId && outletId);

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "X-Peak-Tenant-Id": tenantId!,
    "X-Peak-Tenant-User-Id": userId!,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function peak<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...headers(), ...(init.headers as Record<string, string> | undefined) },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${init.method ?? "GET"} ${path} → HTTP ${response.status}: ${body}`);
  }
  if (!body) return undefined as T;
  return JSON.parse(body) as T;
}

function mutateHeaders(): Record<string, string> {
  return headers({ "Idempotency-Key": crypto.randomUUID() });
}

interface PrintJob {
  id: string;
  jobType: string;
  sourceId: string;
  status: string;
  document: Record<string, unknown>;
}

describe.skipIf(!enabled)("POS commissioning → order → settle → print", () => {
  const openedSessions: string[] = [];
  const pairedDevices: string[] = [];

  afterEach(async () => {
    while (openedSessions.length > 0) {
      const sessionId = openedSessions.pop();
      if (!sessionId) continue;
      try {
        await peak(`/api/v1/properties/${propertyId}/pos-sessions/${sessionId}/close`, {
          method: "POST",
          headers: mutateHeaders(),
          body: JSON.stringify({ actualCash: 0 }),
        });
      } catch {
        // Already closed, or the outlet was left for the next operator.
      }
    }
    while (pairedDevices.length > 0) {
      const deviceId = pairedDevices.pop();
      if (!deviceId) continue;
      try {
        await peak(`/api/v1/tenants/${tenantId}/devices/${deviceId}/revoke`, {
          method: "POST",
          headers: mutateHeaders(),
        });
      } catch {
        // Already revoked.
      }
    }
  });

  it(
    "pairs a till, then withholds the challenge after revoke even with a valid PIN",
    async () => {
      const keys = await generateDeviceKeyPair();
      const issued = await peak<{
        pairingRequestId: string;
        deviceCode: string;
        pairingCode: string;
      }>("/api/v1/devices/pairing-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicKey: keys.publicKeySpki }),
      });
      expect(issued.deviceCode).toMatch(/^dev_/);
      expect(issued.pairingCode).toMatch(/^\d{6}$/);

      const pending = await peak<{ status: string }>(
        `/api/v1/devices/pairing-requests/${issued.pairingRequestId}`,
      );
      expect(pending.status).toBe("pending");
      expect(pending).not.toHaveProperty("propertyId");
      expect(pending).not.toHaveProperty("tenantId");

      const approved = await peak<{ deviceId: string; deviceCode: string }>(
        `/api/v1/tenants/${tenantId}/devices/pairing-approvals`,
        {
          method: "POST",
          headers: mutateHeaders(),
          body: JSON.stringify({
            pairingCode: issued.pairingCode,
            propertyId,
            outletId,
            terminalName: "Journey till",
            mode: "POS",
          }),
        },
      );
      pairedDevices.push(approved.deviceId);
      expect(approved.deviceCode).toBe(issued.deviceCode);

      const status = await peak<{ status: string; deviceCode?: string; mode?: string }>(
        `/api/v1/devices/pairing-requests/${issued.pairingRequestId}`,
      );
      expect(status.status).toBe("approved");
      expect(status.deviceCode).toBe(issued.deviceCode);
      expect(status).not.toHaveProperty("propertyId");

      const challenge = await issueChallenge(baseUrl, issued.deviceCode);
      expect(challenge?.nonce).toBeTruthy();

      await peak(`/api/v1/tenants/${tenantId}/devices/${approved.deviceId}/revoke`, {
        method: "POST",
        headers: mutateHeaders(),
      });
      pairedDevices.pop();

      await expect(issueChallenge(baseUrl, issued.deviceCode)).resolves.toBeNull();
      await expect(
        createStaffSession({
          baseUrl,
          deviceCode: issued.deviceCode,
          privateKeyPkcs8: keys.privateKeyPkcs8,
          staffNumber: process.env.PEAK_JOURNEY_STAFF_NUMBER ?? "0001",
          pin: process.env.PEAK_JOURNEY_PIN ?? "418205",
          previouslyApproved: true,
        }),
      ).rejects.toBeInstanceOf(DeviceRevokedError);
    },
    60_000,
  );

  it(
    "opens a till, sends an order, settles cash, and leaves Peak print jobs",
    async () => {
      const session = await peak<{ id: string }>(
        `/api/v1/properties/${propertyId}/pos-sessions/open`,
        {
          method: "POST",
          headers: mutateHeaders(),
          body: JSON.stringify({ outletId, openingFloat: 10_000 }),
        },
      );
      openedSessions.push(session.id);

      const menuItemId =
        process.env.PEAK_JOURNEY_MENU_ITEM_ID ??
        (
          await peak<Array<{ id: string; isAvailable?: boolean }>>(
            `/api/v1/properties/${propertyId}/pos-config/menu-items?outletId=${outletId}`,
          )
        ).find((item) => item.isAvailable !== false)?.id;
      if (!menuItemId) {
        throw new Error("Outlet has no menu item; set PEAK_JOURNEY_MENU_ITEM_ID");
      }

      const order = await peak<{ id: string; orderNumber?: string; status: string }>(
        `/api/v1/properties/${propertyId}/pos-orders`,
        {
          method: "POST",
          headers: mutateHeaders(),
          body: JSON.stringify({
            sessionId: session.id,
            orderType: "dine_in",
            tableNumber: "J1",
            clientOperationId: crypto.randomUUID(),
          }),
        },
      );
      expect(order.status).toBe("open");

      const priced = await peak<{ items: Array<{ id: string }> }>(
        `/api/v1/properties/${propertyId}/pos-orders/${order.id}/items`,
        {
          method: "POST",
          headers: mutateHeaders(),
          body: JSON.stringify({
            menuItemId,
            quantity: 1,
            clientOperationId: crypto.randomUUID(),
          }),
        },
      );
      expect(priced.items.length).toBeGreaterThan(0);

      const ticket = await peak<{ id: string }>(
        `/api/v1/properties/${propertyId}/pos-orders/${order.id}/send`,
        {
          method: "POST",
          headers: mutateHeaders(),
          body: JSON.stringify({ clientOperationId: crypto.randomUUID() }),
        },
      );
      const kitchenJobs = (
        await peak<PrintJob[]>(
          `/api/v1/properties/${propertyId}/pos-print-jobs?status=pending`,
        )
      ).filter((job) => job.sourceId === ticket.id && job.jobType === "kitchen_ticket");
      expect(kitchenJobs.length).toBeGreaterThan(0);
      expect(kitchenJobs[0]?.document.kind).toBe("kitchen_ticket");

      const settled = await peak<{ id: string; status: string; settlementStatus: string }>(
        `/api/v1/properties/${propertyId}/pos-orders/${order.id}/settle`,
        {
          method: "POST",
          headers: mutateHeaders(),
          body: JSON.stringify({ paymentMethod: "cash" }),
        },
      );
      expect(settled.status).toBe("closed");
      expect(settled.settlementStatus).toBe("confirmed");
      const receipts = (
        await peak<PrintJob[]>(
          `/api/v1/properties/${propertyId}/pos-print-jobs?status=pending`,
        )
      ).filter((job) => job.sourceId === order.id && job.jobType === "receipt");
      expect(receipts.length).toBeGreaterThan(0);
      expect(receipts[0]?.document.kind).toBe("receipt");

      const closed = await peak<{ id: string; status: string }>(
        `/api/v1/properties/${propertyId}/pos-sessions/${session.id}/close`,
        {
          method: "POST",
          headers: mutateHeaders(),
          body: JSON.stringify({ actualCash: 10_000 }),
        },
      );
      openedSessions.pop();
      expect(closed.status).toBe("closed");
      const reports = (
        await peak<PrintJob[]>(
          `/api/v1/properties/${propertyId}/pos-print-jobs?status=pending`,
        )
      ).filter((job) => job.sourceId === session.id && job.jobType === "shift_report");
      expect(reports.length).toBeGreaterThan(0);
      expect(reports[0]?.document.kind).toBe("shift_report");
    },
    90_000,
  );
});
