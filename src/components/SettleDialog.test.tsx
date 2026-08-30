import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettleDialog } from "./SettleDialog";
import type { POSOrder, POSRoomChargeCandidate } from "../lib/posContracts";

const {
  recordTenderMutate,
  chargeToRoomMutate,
  roomChargeAvailableRef,
  candidatesRef,
} = vi.hoisted(() => ({
  recordTenderMutate: vi.fn((_vars: unknown, opts?: { onSuccess?: (id: string) => void }) => opts?.onSuccess?.("order-1")),
  chargeToRoomMutate: vi.fn((_vars: unknown, opts?: { onSuccess?: (id: string) => void }) => opts?.onSuccess?.("order-1")),
  roomChargeAvailableRef: { data: false as boolean | undefined },
  candidatesRef: { data: [] as POSRoomChargeCandidate[] },
}));

vi.mock("../hooks/usePosData", () => ({
  useRecordTender: () => ({ mutate: recordTenderMutate, isPending: false, error: null }),
  useChargeToRoom: () => ({ mutate: chargeToRoomMutate, isPending: false, error: null }),
  useIdempotencyKey: () => ({ current: "key-1", next: () => "key-1" }),
  useMutationMessage: () => null,
  useRoomChargeAvailability: () => ({ data: roomChargeAvailableRef.data }),
  useRoomChargeCandidates: () => ({ data: candidatesRef.data, isFetching: false }),
}));

const ORDER: POSOrder = {
  id: "order-1",
  shiftId: "shift-1",
  orderNumber: "POS-1",
  status: "OPEN",
  serviceType: "DINE_IN",
  subtotalMinor: 20_000,
  taxMinor: 4_000,
  totalMinor: 24_000,
  version: 2,
  items: [],
};

function renderDialog(onSettled = vi.fn()) {
  render(<SettleDialog order={ORDER} onClose={vi.fn()} onSettled={onSettled} />);
  return onSettled;
}

describe("SettleDialog", () => {
  afterEach(() => {
    vi.clearAllMocks();
    roomChargeAvailableRef.data = false;
    candidatesRef.data = [];
  });

  it("hides the room charge tab entirely when no candidate has ever been found", () => {
    renderDialog();
    expect(screen.queryByTestId("settle-tab-room")).not.toBeInTheDocument();
  });

  it("settles cash for the server's total, never a client-computed amount", async () => {
    const onSettled = renderDialog();
    await userEvent.type(screen.getByTestId("amount-received"), "24000");
    expect(screen.getByTestId("change-due")).toHaveTextContent("0");
    await userEvent.click(screen.getByTestId("confirm-settle"));
    await waitFor(() =>
      expect(recordTenderMutate).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: "order-1", paymentMethod: "CASH", amountMinor: 24_000, version: 2 }),
        expect.anything(),
      ),
    );
    await waitFor(() => expect(onSettled).toHaveBeenCalledWith("order-1"));
  });

  it("blocks cash settlement until the amount received covers the total", async () => {
    renderDialog();
    await userEvent.type(screen.getByTestId("amount-received"), "100");
    expect(screen.getByTestId("confirm-settle")).toBeDisabled();
  });

  it("requires a reference for a recorded (non-integrated) mobile money payment", async () => {
    renderDialog();
    await userEvent.click(screen.getByTestId("method-MOBILE_MONEY"));
    expect(screen.getByTestId("confirm-settle")).toBeDisabled();
    await userEvent.type(screen.getByTestId("tender-reference"), "MM-12345");
    expect(screen.getByTestId("confirm-settle")).not.toBeDisabled();
  });

  it("posts the selected stay id, never a folio id, when room charge is available", async () => {
    roomChargeAvailableRef.data = true;
    candidatesRef.data = [
      { stayId: "stay-204", roomId: "room-204", roomNumber: "204", guestDisplayName: "Amina N.", postingEligible: true },
    ];
    const onSettled = renderDialog();

    await userEvent.click(screen.getByTestId("settle-tab-room"));
    await userEvent.type(screen.getByTestId("room-query"), "204");
    await userEvent.click(await screen.findByTestId("room-candidate-stay-204"));
    await userEvent.click(screen.getByTestId("confirm-room-charge"));

    await waitFor(() =>
      expect(chargeToRoomMutate).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: "order-1", stayId: "stay-204" }),
        expect.anything(),
      ),
    );
    expect(JSON.stringify(chargeToRoomMutate.mock.calls)).not.toMatch(/folio/i);
    await waitFor(() => expect(onSettled).toHaveBeenCalledWith("order-1"));
  });

  it("keeps an ineligible stay from posting", async () => {
    roomChargeAvailableRef.data = true;
    candidatesRef.data = [
      { stayId: "stay-208", roomId: "room-208", roomNumber: "208", guestDisplayName: "Guest", postingEligible: false },
    ];
    renderDialog();
    await userEvent.click(screen.getByTestId("settle-tab-room"));
    await userEvent.type(screen.getByTestId("room-query"), "208");
    const candidate = await screen.findByTestId("room-candidate-stay-208");
    expect(candidate).toBeDisabled();
    expect(screen.getByTestId("confirm-room-charge")).toBeDisabled();
    expect(chargeToRoomMutate).not.toHaveBeenCalled();
  });
});
