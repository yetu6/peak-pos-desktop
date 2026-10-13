import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { problemOf, READ_AFTER_RECORD_FAILED } from "../lib/problemWords";
import { useChargeToRoom, useRecordTender } from "./usePosData";

/**
 * Recording a payment or a room charge is two asks: the POST, then the order
 * read back. When the POST was recorded and only the read failed, the error
 * must say so (its own code), never look like Yetu refusing the payment.
 */

vi.mock("../lib/env", () => ({ devIdentityFromEnv: () => ({ tenantId: "t", userId: "u", propertyId: "p", outletId: "o" }) }));

const api = vi.hoisted(() => ({
  recordTender: vi.fn(async () => ({ data: { paymentId: "pay-1", orderClosed: true, paidMinor: 4_250_000, remainingMinor: 0, version: 3 } })),
  chargeToRoom: vi.fn(async () => ({ data: undefined })),
  getOrder: vi.fn(async () => ({ error: { status: 404, code: "NOT_FOUND", detail: "order not found" } })),
}));
vi.mock("../lib/posApi", () => ({ createPosApi: () => api }));

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

describe("a recorded payment whose order read failed", () => {
  it("tender: the error names the failed read, not a refusal", async () => {
    const { result } = renderHook(() => useRecordTender(), { wrapper });
    let caught: unknown;
    await act(async () => {
      await result.current
        .mutateAsync({ orderId: "order-1", paymentMethod: "CASH", amountMinor: 4_250_000, version: 2, idempotencyKey: "k" })
        .catch((error: unknown) => (caught = error));
    });
    expect(problemOf(caught)).toMatchObject({ code: READ_AFTER_RECORD_FAILED });
  });

  it("room charge: the same", async () => {
    const { result } = renderHook(() => useChargeToRoom(), { wrapper });
    let caught: unknown;
    await act(async () => {
      await result.current.mutateAsync({ orderId: "order-1", stayId: "stay-12", idempotencyKey: "k" }).catch((error: unknown) => (caught = error));
    });
    expect(problemOf(caught)).toMatchObject({ code: READ_AFTER_RECORD_FAILED });
  });

  it("a refused POST stays Yetu's refusal", async () => {
    api.recordTender.mockResolvedValueOnce({ error: { status: 403, code: "FORBIDDEN", detail: "POS permission denied" } } as never);
    const { result } = renderHook(() => useRecordTender(), { wrapper });
    let caught: unknown;
    await act(async () => {
      await result.current
        .mutateAsync({ orderId: "order-1", paymentMethod: "CASH", amountMinor: 1, version: 2, idempotencyKey: "k2" })
        .catch((error: unknown) => (caught = error));
    });
    expect(problemOf(caught)).toMatchObject({ code: "FORBIDDEN" });
  });
});
