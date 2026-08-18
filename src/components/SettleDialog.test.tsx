import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SettleDialog } from "./SettleDialog";
import type { PosOrderResponse } from "../lib/posApi";

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

const { listCandidatesSpy, settleOrderSpy, listProviderAccountsSpy, processPendingPrintJobsSpy } =
  vi.hoisted(() => ({
    listCandidatesSpy: vi.fn(),
    settleOrderSpy: vi.fn(async () => ({ data: { id: "order-1" }, error: null })),
    listProviderAccountsSpy: vi.fn(async () => ({ data: [], error: null })),
    processPendingPrintJobsSpy: vi.fn(async (): Promise<Array<{ ok: boolean; error?: string }>> => [
      { ok: true },
    ]),
  }));

vi.mock("../lib/posApi", () => ({
  createPosApi: () => ({
    listRoomChargeCandidates: listCandidatesSpy,
    settleOrder: settleOrderSpy,
    listProviderAccounts: listProviderAccountsSpy,
  }),
}));

vi.mock("../lib/printJobs", () => ({
  processPendingPrintJobs: processPendingPrintJobsSpy,
}));

const ORDER = {
  id: "order-1",
  orderNumber: "POS-1",
  orderType: "DINE_IN",
  totalAmount: 24000,
} as PosOrderResponse;

function renderDialog(onClose = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <SettleDialog order={ORDER} onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
}

describe("SettleDialog room charge", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does not search rooms or reservations while the query is empty", () => {
    renderDialog();
    expect(screen.getByTestId("method-room_charge")).toBeInTheDocument();
    expect(listCandidatesSpy).not.toHaveBeenCalled();
  });

  it("posts the selected stay, not a folio UUID", async () => {
    listCandidatesSpy.mockResolvedValue({
      data: [
        {
          stayId: "stay-204",
          roomId: "room-204",
          roomNumber: "204",
          guestDisplayName: "Amina N.",
          postingEligible: true,
        },
      ],
      error: null,
    });
    const onClose = renderDialog();

    await userEvent.click(screen.getByTestId("method-room_charge"));
    await userEvent.type(screen.getByTestId("room-query"), "204");

    expect(await screen.findByTestId("room-candidate-stay-204")).toHaveTextContent("204 · Amina N.");
    expect(listCandidatesSpy).toHaveBeenCalledWith("property-1", "204");

    await userEvent.click(screen.getByTestId("room-candidate-stay-204"));
    await userEvent.click(screen.getByTestId("confirm-settle"));

    await waitFor(() =>
      expect(settleOrderSpy).toHaveBeenCalledWith("property-1", "order-1", {
        paymentMethod: "room_charge",
        stayId: "stay-204",
        roomNumber: "204",
        providerAccountId: undefined,
        phoneNumber: undefined,
      }),
    );
    expect(JSON.stringify(settleOrderSpy.mock.calls)).not.toMatch(/folioId/);
    expect(processPendingPrintJobsSpy).toHaveBeenCalledWith("property-1", "order-1");
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("still closes after cash settle when the receipt printer fails", async () => {
    processPendingPrintJobsSpy.mockResolvedValue([
      { ok: false, error: "No kitchen printer is configured" },
    ]);
    const onClose = renderDialog();
    await userEvent.click(screen.getByTestId("confirm-settle"));
    await waitFor(() =>
      expect(settleOrderSpy).toHaveBeenCalledWith(
        "property-1",
        "order-1",
        expect.objectContaining({ paymentMethod: "cash" }),
      ),
    );
    await waitFor(() =>
      expect(processPendingPrintJobsSpy).toHaveBeenCalledWith("property-1", "order-1"),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("keeps an ineligible stay from posting", async () => {
    listCandidatesSpy.mockResolvedValue({
      data: [
        {
          stayId: "stay-208",
          roomId: "room-208",
          roomNumber: "208",
          guestDisplayName: "Guest",
          postingEligible: false,
        },
      ],
      error: null,
    });
    renderDialog();

    await userEvent.click(screen.getByTestId("method-room_charge"));
    await userEvent.type(screen.getByTestId("room-query"), "208");
    const candidate = await screen.findByTestId("room-candidate-stay-208");
    expect(candidate).toBeDisabled();
    expect(screen.getByTestId("confirm-settle")).toBeDisabled();
    expect(settleOrderSpy).not.toHaveBeenCalled();
  });
});
