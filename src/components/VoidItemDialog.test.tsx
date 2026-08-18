import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { VoidItemDialog } from "./VoidItemDialog";
import type { PosOrderItemResponse, PosOrderResponse } from "../lib/posApi";

vi.mock("../lib/env", () => ({
  API_BASE_URL: "http://peak.test",
  getApiBaseUrl: () => "http://peak.test",
  REALTIME_BRIDGE_URL: "ws://localhost:5174/bridge",
  devIdentityFromEnv: () => ({
    tenantId: "tenant-1",
    userId: "user-1",
    propertyId: "property-1",
    outletId: "outlet-1",
  }),
}));

const { voidOrderItemSpy, processPendingPrintJobsSpy } = vi.hoisted(() => ({
  voidOrderItemSpy: vi.fn(async () => ({ data: { itemId: "item-1" }, error: null })),
  processPendingPrintJobsSpy: vi.fn(async (): Promise<Array<{ ok: boolean; error?: string }>> => [
    { ok: true },
  ]),
}));

vi.mock("../lib/posApi", () => ({
  createPosApi: () => ({
    voidOrderItem: voidOrderItemSpy,
  }),
}));

vi.mock("../lib/printJobs", () => ({
  processPendingPrintJobs: processPendingPrintJobsSpy,
}));

const ORDER = { id: "order-1", orderNumber: "POS-1" } as PosOrderResponse;
const ITEM = {
  id: "item-1",
  name: "Stew",
  quantity: 1,
  serviceState: "UNSENT",
} as PosOrderItemResponse;

describe("VoidItemDialog", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("voids the item and claims Peak's void ticket, even if the printer fails", async () => {
    processPendingPrintJobsSpy.mockResolvedValue([
      { ok: false, error: "No kitchen printer is configured" },
    ]);
    const onClose = vi.fn();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <VoidItemDialog order={ORDER} item={ITEM} onClose={onClose} />
      </QueryClientProvider>,
    );
    await userEvent.type(screen.getByTestId("void-reason"), "Guest left");
    await userEvent.click(screen.getByTestId("confirm-void-item"));
    await waitFor(() =>
      expect(voidOrderItemSpy).toHaveBeenCalledWith(
        "property-1",
        "order-1",
        "item-1",
        expect.objectContaining({ reason: "Guest left" }),
      ),
    );
    await waitFor(() =>
      expect(processPendingPrintJobsSpy).toHaveBeenCalledWith("property-1", "item-1"),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
