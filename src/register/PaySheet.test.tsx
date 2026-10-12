import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { POSOrder, POSRoomChargeCandidate } from "../lib/posContracts";
import { PaySheet } from "./PaySheet";

const ORDER: POSOrder = {
  id: "order-1",
  shiftId: "shift-1",
  orderNumber: "0142",
  status: "SENT",
  serviceType: "DINE_IN",
  tableLabel: "12",
  initiatedById: "staff-amina",
  initiatedByName: "Amina Hassan",
  subtotalMinor: 3_601_695,
  discountMinor: 0,
  discountKind: "NONE",
  discountInput: 0,
  taxMinor: 648_305,
  totalMinor: 4_250_000,
  paidMinor: 0,
  remainingMinor: 4_250_000,
  version: 2,
  items: [],
};

const CLOSED: POSOrder = { ...ORDER, status: "CLOSED", paidMinor: 4_250_000, remainingMinor: 0, version: 3 };

const { recordTenderMutate, chargeToRoomMutate, refs } = vi.hoisted(() => ({
  recordTenderMutate: vi.fn(),
  chargeToRoomMutate: vi.fn(),
  refs: {
    roomAvailable: false,
    candidates: [] as POSRoomChargeCandidate[],
    tender: { isPending: false, error: null as unknown },
  },
}));

vi.mock("../hooks/usePosData", () => ({
  useRecordTender: () => ({ mutate: recordTenderMutate, ...refs.tender }),
  useChargeToRoom: () => ({ mutate: chargeToRoomMutate, isPending: false, error: null }),
  useIdempotencyKey: () => ({ current: "key-1", next: () => "key-1" }),
  useRoomChargeAvailability: () => ({ data: refs.roomAvailable }),
  useRoomChargeCandidates: (query: string) => ({ data: query ? refs.candidates : [], isFetching: false }),
}));

type Paid = (paid: { order: POSOrder; method: string; changeMinor: number }) => void;

function renderPay(order: POSOrder = ORDER) {
  const onPaid = vi.fn<Paid>();
  const onOrderChange = vi.fn();
  const onClose = vi.fn();
  render(<PaySheet order={order} currency="TZS" onClose={onClose} onOrderChange={onOrderChange} onPaid={onPaid} />);
  return { onPaid, onOrderChange, onClose };
}

const pay = () => screen.getByTestId("confirm-settle");

beforeEach(() => {
  recordTenderMutate.mockImplementation((_vars: unknown, opts?: { onSuccess?: (order: POSOrder) => void }) =>
    opts?.onSuccess?.(CLOSED),
  );
  chargeToRoomMutate.mockImplementation((_vars: unknown, opts?: { onSuccess?: (order: POSOrder) => void }) =>
    opts?.onSuccess?.({ ...CLOSED }),
  );
});

afterEach(() => {
  vi.clearAllMocks();
  refs.roomAvailable = false;
  refs.candidates = [];
  refs.tender = { isPending: false, error: null };
});

describe("PaySheet", () => {
  it("shows the amount still to pay, large, and only the methods Yetu takes", () => {
    renderPay();
    expect(screen.getByRole("dialog", { name: "Take payment" })).toHaveAccessibleDescription("Order 0142 · Dine in · Table 12");
    expect(screen.getByTestId("amount-due")).toHaveTextContent("TSh 42,500");
    const methods = within(screen.getByRole("radiogroup", { name: "How the guest pays" })).getAllByRole("radio");
    expect(methods.map((method) => method.textContent)).toEqual([
      "Cash",
      "Mobile money",
      "Card (own machine)",
      "Bank transfer",
      "Other",
    ]);
    expect(screen.getByRole("radio", { name: "Cash" })).toBeChecked();
  });

  it("cash: Exact, then the next amounts the notes make above the bill", () => {
    renderPay();
    const quick = within(screen.getByRole("group", { name: "Quick cash" })).getAllByRole("button");
    expect(quick.map((button) => button.textContent)).toEqual(["ExactTSh 42,500", "TSh 44,000", "TSh 45,000", "TSh 50,000"]);
  });

  it("cash: works out the change from the cash received, and records only what is owed", async () => {
    const { onPaid } = renderPay();
    await userEvent.click(screen.getByRole("button", { name: "TSh 50,000" }));
    expect(screen.getByTestId("amount-received")).toHaveValue("50000");
    expect(screen.getByTestId("change-due")).toHaveTextContent("Change to give TSh 7,500");
    expect(pay()).toHaveTextContent("Take TSh 42,500 cash");
    await userEvent.click(pay());
    expect(recordTenderMutate).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: "order-1", paymentMethod: "CASH", amountMinor: 4_250_000, version: 2 }),
      expect.anything(),
    );
    expect(onPaid).toHaveBeenCalledWith(expect.objectContaining({ method: "CASH", changeMinor: 750_000 }));
  });

  it("cash: the keypad types the cash received", async () => {
    renderPay();
    for (const key of ["5", "0", "0", "00"]) await userEvent.click(screen.getByTestId(`cash-key-${key}`));
    expect(screen.getByTestId("amount-received")).toHaveValue("50000");
    await userEvent.click(screen.getByTestId("cash-key-delete"));
    expect(screen.getByTestId("amount-received")).toHaveValue("5000");
  });

  it("cash: less than owed is a part payment, and says what is still to pay", async () => {
    recordTenderMutate.mockImplementation((_vars: unknown, opts?: { onSuccess?: (order: POSOrder) => void }) =>
      opts?.onSuccess?.({ ...ORDER, paidMinor: 2_000_000, remainingMinor: 2_250_000, version: 3 }),
    );
    const { onPaid, onOrderChange } = renderPay();
    await userEvent.type(screen.getByTestId("amount-received"), "20000");
    expect(screen.getByTestId("change-due")).toHaveTextContent("Part payment: TSh 20,000 now, TSh 22,500 still to pay");
    expect(pay()).toHaveTextContent("Take TSh 20,000 cash");
    await userEvent.click(pay());
    expect(recordTenderMutate).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 2_000_000 }), expect.anything());
    expect(onPaid).not.toHaveBeenCalled();
    expect(onOrderChange).toHaveBeenCalledWith(expect.objectContaining({ paidMinor: 2_000_000 }));
    expect(screen.getByTestId("amount-due")).toHaveTextContent("TSh 22,500");
    expect(screen.getByRole("progressbar")).toHaveAccessibleName("Paid TSh 20,000 of TSh 42,500");
  });

  it("card: take it on your own machine, then confirm here; the reference is optional", async () => {
    const { onPaid } = renderPay();
    await userEvent.click(screen.getByRole("radio", { name: "Card (own machine)" }));
    expect(screen.getByText("Take payment on your own machine, then confirm here.")).toBeInTheDocument();
    expect(pay()).toHaveTextContent("Confirm TSh 42,500 received");
    await userEvent.click(pay());
    expect(recordTenderMutate).toHaveBeenCalledWith(
      expect.objectContaining({ paymentMethod: "EXTERNAL_CARD", amountMinor: 4_250_000, reference: undefined }),
      expect.anything(),
    );
    expect(onPaid).toHaveBeenCalledWith(expect.objectContaining({ method: "EXTERNAL_CARD", changeMinor: 0 }));
  });

  it("mobile money: a reference goes with it when given, and a smaller amount splits the bill", async () => {
    renderPay();
    await userEvent.click(screen.getByRole("radio", { name: "Mobile money" }));
    await userEvent.type(screen.getByTestId("tender-reference"), "MP-1234");
    await userEvent.type(screen.getByTestId("tender-amount"), "10000");
    expect(pay()).toHaveTextContent("Confirm TSh 10,000 received");
    await userEvent.click(pay());
    expect(recordTenderMutate).toHaveBeenCalledWith(
      expect.objectContaining({ paymentMethod: "MOBILE_MONEY", amountMinor: 1_000_000, reference: "MP-1234" }),
      expect.anything(),
    );
  });

  it("won't take more than is owed by a recorded method", async () => {
    renderPay();
    await userEvent.click(screen.getByRole("radio", { name: "Bank transfer" }));
    await userEvent.type(screen.getByTestId("tender-amount"), "50000");
    expect(pay()).toBeDisabled();
    expect(screen.getByText("That's more than the TSh 42,500 still to pay.")).toBeInTheDocument();
  });

  it("charge to room: only with lodging and the permission; posts the stay, never a folio", async () => {
    refs.roomAvailable = true;
    refs.candidates = [
      { stayId: "stay-12", roomId: "room-12", roomNumber: "12", guestDisplayName: "Asha Mollel", postingEligible: true },
    ];
    const { onPaid } = renderPay();
    await userEvent.click(screen.getByRole("radio", { name: "Charge to room" }));
    await userEvent.type(screen.getByTestId("room-query"), "12");
    await userEvent.click(await screen.findByTestId("room-candidate-stay-12"));
    expect(screen.getByTestId("confirm-room-charge")).toHaveTextContent("Charge TSh 42,500 to room 12");
    await userEvent.click(screen.getByTestId("confirm-room-charge"));
    expect(chargeToRoomMutate).toHaveBeenCalledWith(expect.objectContaining({ orderId: "order-1", stayId: "stay-12" }), expect.anything());
    expect(JSON.stringify(chargeToRoomMutate.mock.calls)).not.toMatch(/folio/i);
    expect(onPaid).toHaveBeenCalledWith(expect.objectContaining({ method: "ROOM_CHARGE", roomNumber: "12" }));
  });

  it("charge to room isn't offered without lodging", () => {
    renderPay();
    expect(screen.queryByRole("radio", { name: "Charge to room" })).not.toBeInTheDocument();
  });

  it("charge to room isn't possible once part is paid, and says so", () => {
    refs.roomAvailable = true;
    renderPay({ ...ORDER, paidMinor: 1_000_000, remainingMinor: 3_250_000 });
    expect(screen.getByRole("radio", { name: "Charge to room" })).toBeDisabled();
    expect(screen.getByText("Charge to room isn't possible once part of the bill is paid.")).toBeInTheDocument();
  });

  it("a guest whose bill isn't open can't be charged", async () => {
    refs.roomAvailable = true;
    refs.candidates = [
      { stayId: "stay-8", roomId: "room-8", roomNumber: "8", guestDisplayName: "Guest", postingEligible: false },
    ];
    renderPay();
    await userEvent.click(screen.getByRole("radio", { name: "Charge to room" }));
    await userEvent.type(screen.getByTestId("room-query"), "8");
    const row = await screen.findByTestId("room-candidate-stay-8");
    expect(row).toBeDisabled();
    expect(row).toHaveTextContent("Bill not open. Ask the front desk.");
    expect(screen.getByTestId("confirm-room-charge")).toBeDisabled();
  });

  it("arrow keys move between the methods", async () => {
    renderPay();
    screen.getByRole("radio", { name: "Cash" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Mobile money" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Mobile money" })).toHaveFocus();
  });

  it("Enter in the cash field takes the cash", async () => {
    renderPay();
    await userEvent.type(screen.getByTestId("amount-received"), "42500{Enter}");
    expect(recordTenderMutate).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 4_250_000 }), expect.anything());
  });

  it("can't be dismissed while the payment is with Yetu", async () => {
    refs.tender = { isPending: true, error: null };
    const { onClose } = renderPay();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("says why a payment was refused, in words", () => {
    refs.tender = { isPending: false, error: new Error(JSON.stringify({ code: "CONFLICT", detail: "tender exceeds remaining balance" })) };
    renderPay();
    expect(screen.getByTestId("settle-error")).toHaveTextContent("That's more than is still owed. Check the amount, then try again.");
  });

  it("closes the sheet when the order is paid", async () => {
    const { onPaid } = renderPay();
    await userEvent.click(screen.getByRole("button", { name: /^Exact/ }));
    await userEvent.click(pay());
    await waitFor(() => expect(onPaid).toHaveBeenCalledWith(expect.objectContaining({ order: CLOSED })));
  });
});
