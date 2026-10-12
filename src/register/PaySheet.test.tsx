import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { POSOrder, POSRoomChargeCandidate } from "../lib/posContracts";
import { idleLockHeld } from "../lib/idleLock";
import { PAY_CHECK_EVERY_SECONDS, PaySheet } from "./PaySheet";

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
    refetchOrder: vi.fn(),
  },
}));

vi.mock("../hooks/usePosData", async (importOriginal) => ({
  // The real key generator: a retry must reuse its key, a new request must not.
  useIdempotencyKey: (await importOriginal<typeof import("../hooks/usePosData")>()).useIdempotencyKey,
  useRecordTender: () => ({ mutate: recordTenderMutate, reset: () => undefined, ...refs.tender }),
  useChargeToRoom: () => ({ mutate: chargeToRoomMutate, reset: () => undefined, isPending: false, error: null }),
  useRoomChargeAvailability: () => ({ data: refs.roomAvailable }),
  useRoomChargeCandidates: (query: string) => ({ data: query ? refs.candidates : [], isFetching: false }),
  useOrder: () => ({ data: undefined, refetch: refs.refetchOrder }),
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
    expect(screen.getByTestId("tender-recorded")).toHaveTextContent("Recorded TSh 20,000. TSh 22,500 still to pay.");
  });

  it("after a part payment in cash, the cash received is empty and a second tap sends nothing", async () => {
    recordTenderMutate.mockImplementation((_vars: unknown, opts?: { onSuccess?: (order: POSOrder) => void }) =>
      opts?.onSuccess?.({ ...ORDER, paidMinor: 3_000_000, remainingMinor: 1_250_000, version: 3 }),
    );
    renderPay();
    await userEvent.type(screen.getByTestId("amount-received"), "30000");
    await userEvent.click(pay());
    expect(screen.getByTestId("amount-received")).toHaveValue("");
    expect(screen.getByTestId("change-due")).not.toHaveTextContent(/Change to give/);
    expect(pay()).toBeDisabled();
    await userEvent.click(pay());
    expect(recordTenderMutate).toHaveBeenCalledTimes(1);
  });

  it("after a part payment by card, the amount and the reference are cleared", async () => {
    recordTenderMutate.mockImplementation((_vars: unknown, opts?: { onSuccess?: (order: POSOrder) => void }) =>
      opts?.onSuccess?.({ ...ORDER, paidMinor: 1_000_000, remainingMinor: 3_250_000, version: 3 }),
    );
    renderPay();
    await userEvent.click(screen.getByRole("radio", { name: "Card (own machine)" }));
    await userEvent.type(screen.getByTestId("tender-amount"), "10000");
    await userEvent.type(screen.getByTestId("tender-reference"), "C-991");
    await userEvent.click(pay());
    expect(screen.getByTestId("tender-amount")).toHaveValue("");
    expect(screen.getByTestId("tender-reference")).toHaveValue("");
    expect(pay()).toHaveTextContent("Confirm TSh 32,500 received");
  });

  it("with nothing left to pay, shows no change and offers no tender", () => {
    renderPay({ ...ORDER, paidMinor: 4_250_000, remainingMinor: 0 });
    expect(screen.queryByRole("group", { name: "Quick cash" })).not.toBeInTheDocument();
    expect(screen.getByTestId("change-due")).toHaveTextContent("Nothing left to pay.");
    expect(pay()).toBeDisabled();
    fireEvent.change(screen.getByTestId("amount-received"), { target: { value: "1000" } });
    expect(screen.getByTestId("change-due")).toHaveTextContent("Nothing left to pay.");
    expect(pay()).toBeDisabled();
    for (const method of within(screen.getByRole("radiogroup", { name: "How the guest pays" })).getAllByRole("radio")) {
      expect(method).toBeDisabled();
    }
  });

  it("a split ends with the last tender, told to payment done as a split", async () => {
    recordTenderMutate.mockImplementation((_vars: unknown, opts?: { onSuccess?: (order: POSOrder) => void }) =>
      opts?.onSuccess?.({ ...ORDER, paidMinor: 2_000_000, remainingMinor: 2_250_000, version: 3 }),
    );
    const { onPaid } = renderPay();
    await userEvent.type(screen.getByTestId("amount-received"), "20000");
    await userEvent.click(pay());
    recordTenderMutate.mockImplementation((_vars: unknown, opts?: { onSuccess?: (order: POSOrder) => void }) =>
      opts?.onSuccess?.(CLOSED),
    );
    await userEvent.type(screen.getByTestId("amount-received"), "22500");
    await userEvent.click(pay());
    expect(onPaid).toHaveBeenCalledWith(expect.objectContaining({ method: "CASH", split: true, changeMinor: 0 }));
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

  it("charge to room waits until the order has gone to the kitchen, and says so", () => {
    refs.roomAvailable = true;
    renderPay({ ...ORDER, status: "OPEN" });
    expect(screen.getByRole("radio", { name: "Charge to room" })).toBeDisabled();
    expect(screen.getByText("Charge to room: send it to the kitchen first.")).toBeInTheDocument();
  });

  it("charge to room isn't taken while the kitchen is preparing it (the backend's rule), and says so", () => {
    refs.roomAvailable = true;
    renderPay({ ...ORDER, status: "PREPARING" });
    expect(screen.getByRole("radio", { name: "Charge to room" })).toBeDisabled();
    expect(screen.getByText("Charge to room: once the kitchen has it ready.")).toBeInTheDocument();
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

  it("arrowing onto a method keeps focus on the methods; pressing one moves into its field", async () => {
    refs.roomAvailable = true;
    renderPay();
    screen.getByRole("radio", { name: "Cash" }).focus();
    await userEvent.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Charge to room" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Charge to room" })).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.getByRole("radio", { name: "Other" })).toBeChecked();
    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.getByRole("radio", { name: "Bank transfer" })).toHaveFocus();
    await userEvent.click(screen.getByRole("radio", { name: "Charge to room" }));
    expect(screen.getByTestId("room-query")).toHaveFocus();
    await userEvent.click(screen.getByRole("radio", { name: "Cash" }));
    expect(screen.getByTestId("amount-received")).toHaveFocus();
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

  it("when the order changed on another till, gets Yetu's latest and retries on it", async () => {
    const latest = { ...ORDER, version: 5, paidMinor: 1_000_000, remainingMinor: 3_250_000 };
    refs.refetchOrder.mockResolvedValue({ data: latest });
    const stale = new Error(JSON.stringify({ code: "STALE_VERSION", detail: "resource changed" }));
    recordTenderMutate.mockImplementationOnce((_vars: unknown, opts?: { onError?: (error: Error) => void }) => opts?.onError?.(stale));
    const { onOrderChange } = renderPay();
    await userEvent.click(screen.getByRole("radio", { name: "Card (own machine)" }));
    await userEvent.click(pay());
    expect(refs.refetchOrder).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId("amount-due")).toHaveTextContent("TSh 32,500"));
    expect(onOrderChange).toHaveBeenCalledWith(latest);
    await userEvent.click(pay());
    expect(recordTenderMutate).toHaveBeenLastCalledWith(
      expect.objectContaining({ amountMinor: 3_250_000, version: 5 }),
      expect.anything(),
    );
  });

  describe("idempotency keys", () => {
    const keyOf = (call: number) => (recordTenderMutate.mock.calls[call][0] as { idempotencyKey: string }).idempotencyKey;
    const lost = (_vars: unknown, opts?: { onError?: (error: Error) => void }) => opts?.onError?.(new TypeError("Failed to fetch"));

    it("a retry after a lost response sends the same key", async () => {
      recordTenderMutate.mockImplementationOnce(lost);
      refs.refetchOrder.mockResolvedValue({ status: "success", data: ORDER });
      renderPay();
      await userEvent.click(screen.getByRole("radio", { name: "Card (own machine)" }));
      await userEvent.click(pay());
      await screen.findByText(/Yetu didn't record that payment/);
      await userEvent.click(pay());
      expect(recordTenderMutate).toHaveBeenCalledTimes(2);
      expect(keyOf(0)).toMatch(/^[0-9a-f-]{36}$/);
      expect(keyOf(1)).toBe(keyOf(0));
    });

    it("a changed amount is a new request with a new key", async () => {
      recordTenderMutate.mockImplementationOnce(lost);
      refs.refetchOrder.mockResolvedValue({ status: "success", data: ORDER });
      renderPay();
      await userEvent.click(screen.getByRole("radio", { name: "Card (own machine)" }));
      await userEvent.click(pay());
      await screen.findByText(/Yetu didn't record that payment/);
      await userEvent.type(screen.getByTestId("tender-amount"), "10000");
      await userEvent.click(pay());
      expect(keyOf(1)).not.toBe(keyOf(0));
    });

    it("after Yetu records a payment, the next payment has a new key", async () => {
      recordTenderMutate.mockImplementationOnce((_vars: unknown, opts?: { onSuccess?: (order: POSOrder) => void }) =>
        opts?.onSuccess?.({ ...ORDER, paidMinor: 1_000_000, remainingMinor: 3_250_000, version: 3 }),
      );
      renderPay();
      await userEvent.type(screen.getByTestId("amount-received"), "10000");
      await userEvent.click(pay());
      await userEvent.type(screen.getByTestId("amount-received"), "10000");
      await userEvent.click(pay());
      expect(keyOf(1)).not.toBe(keyOf(0));
    });

    it("a room charge retried after a lost response keeps its key", async () => {
      refs.roomAvailable = true;
      refs.candidates = [
        { stayId: "stay-12", roomId: "room-12", roomNumber: "12", guestDisplayName: "Asha Mollel", postingEligible: true },
      ];
      chargeToRoomMutate.mockImplementationOnce(lost);
      refs.refetchOrder.mockResolvedValue({ status: "success", data: ORDER });
      renderPay();
      await userEvent.click(screen.getByRole("radio", { name: "Charge to room" }));
      await userEvent.type(screen.getByTestId("room-query"), "12");
      await userEvent.click(await screen.findByTestId("room-candidate-stay-12"));
      await userEvent.click(screen.getByTestId("confirm-room-charge"));
      await screen.findByText(/Yetu didn't record that charge/);
      await userEvent.click(screen.getByTestId("confirm-room-charge"));
      const keys = chargeToRoomMutate.mock.calls.map(([vars]) => (vars as { idempotencyKey: string }).idempotencyKey);
      expect(keys).toHaveLength(2);
      expect(keys[1]).toBe(keys[0]);
    });
  });

  it("a room charge to a different guest is a new request with a new key", async () => {
    refs.roomAvailable = true;
    refs.candidates = [
      { stayId: "stay-12", roomId: "room-12", roomNumber: "12", guestDisplayName: "Asha Mollel", postingEligible: true },
      { stayId: "stay-14", roomId: "room-14", roomNumber: "14", guestDisplayName: "Daniel Mrema", postingEligible: true },
    ];
    chargeToRoomMutate.mockImplementationOnce((_vars: unknown, opts?: { onError?: (error: Error) => void }) =>
      opts?.onError?.(new TypeError("Failed to fetch")),
    );
    refs.refetchOrder.mockResolvedValue({ status: "success", data: ORDER });
    renderPay();
    await userEvent.click(screen.getByRole("radio", { name: "Charge to room" }));
    await userEvent.type(screen.getByTestId("room-query"), "1");
    await userEvent.click(await screen.findByTestId("room-candidate-stay-12"));
    await userEvent.click(screen.getByTestId("confirm-room-charge"));
    await screen.findByText(/Yetu didn't record that charge/);
    await userEvent.click(screen.getByTestId("room-candidate-stay-14"));
    await userEvent.click(screen.getByTestId("confirm-room-charge"));
    const keys = chargeToRoomMutate.mock.calls.map(([vars]) => (vars as { idempotencyKey: string }).idempotencyKey);
    expect(keys[1]).not.toBe(keys[0]);
  });

  it("says a changed order honestly", () => {
    refs.tender = { isPending: false, error: new Error(JSON.stringify({ code: "STALE_VERSION", detail: "x" })) };
    renderPay();
    expect(screen.getByTestId("settle-error")).toHaveTextContent(
      "This order changed on another till. The amounts here are Yetu's latest: check them, then try again.",
    );
  });

  it("keeps the till from locking while the payment is with Yetu", () => {
    refs.tender = { isPending: true, error: null };
    renderPay();
    expect(idleLockHeld()).toBe(true);
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

  describe("the connection drops while the payment is with Yetu (S6)", () => {
    const lost = (_vars: unknown, opts?: { onError?: (error: Error) => void }) => opts?.onError?.(new TypeError("Failed to fetch"));

    it("asks Yetu, and when Yetu recorded it, shows the payment done without taking it again", async () => {
      recordTenderMutate.mockImplementationOnce(lost);
      refs.refetchOrder.mockResolvedValue({ status: "success", data: CLOSED });
      const { onPaid } = renderPay();
      await userEvent.click(screen.getByRole("button", { name: /^Exact/ }));
      await userEvent.click(pay());
      await waitFor(() => expect(onPaid).toHaveBeenCalledWith(expect.objectContaining({ order: CLOSED, method: "CASH" })));
      expect(recordTenderMutate).toHaveBeenCalledTimes(1);
    });

    it("never assumes: while Yetu can't be reached it says so, offers no payment, and keeps asking", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        recordTenderMutate.mockImplementationOnce(lost);
        refs.refetchOrder.mockResolvedValueOnce({ status: "error", data: ORDER });
        refs.refetchOrder.mockResolvedValueOnce({ status: "success", data: CLOSED });
        const { onPaid, onClose } = renderPay();
        await userEvent.click(screen.getByRole("button", { name: /^Exact/ }));
        await userEvent.click(pay());
        const alert = await screen.findByTestId("pay-unsure");
        expect(alert).toHaveTextContent("The connection dropped while Yetu was recording this payment. We don't know yet if it went through.");
        await waitFor(() => expect(alert).toHaveTextContent("Still can't reach Yetu. Don't take the money again until Yetu answers."));
        expect(screen.queryByTestId("confirm-settle")).not.toBeInTheDocument();
        expect(screen.getByTestId("pay-check")).toBeEnabled();
        // A question about money is open: the till doesn't lock early and the sheet stays.
        expect(idleLockHeld()).toBe(true);
        fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
        expect(onClose).not.toHaveBeenCalled();
        expect(onPaid).not.toHaveBeenCalled();
        await act(async () => vi.advanceTimersByTime(PAY_CHECK_EVERY_SECONDS * 1000));
        await waitFor(() => expect(onPaid).toHaveBeenCalledWith(expect.objectContaining({ order: CLOSED })));
        expect(refs.refetchOrder).toHaveBeenCalledTimes(2);
        expect(recordTenderMutate).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("when Yetu recorded part of it, shows what is recorded and what is still to pay", async () => {
      recordTenderMutate.mockImplementationOnce(lost);
      const part = { ...ORDER, paidMinor: 1_000_000, remainingMinor: 3_250_000, version: 3 };
      refs.refetchOrder.mockResolvedValue({ status: "success", data: part });
      const { onOrderChange } = renderPay();
      await userEvent.type(screen.getByTestId("amount-received"), "10000");
      await userEvent.click(pay());
      expect(await screen.findByTestId("tender-recorded")).toHaveTextContent("Recorded TSh 10,000. TSh 32,500 still to pay.");
      expect(screen.getByTestId("amount-due")).toHaveTextContent("TSh 32,500");
      expect(onOrderChange).toHaveBeenCalledWith(part);
      expect(screen.queryByTestId("pay-unsure")).not.toBeInTheDocument();
    });

    it("when Yetu recorded nothing, says so: nothing was taken", async () => {
      recordTenderMutate.mockImplementationOnce(lost);
      refs.refetchOrder.mockResolvedValue({ status: "success", data: ORDER });
      renderPay();
      await userEvent.click(screen.getByRole("button", { name: /^Exact/ }));
      await userEvent.click(pay());
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Yetu didn't record that payment, so nothing was taken. Take it again when the guest is ready.",
      );
      expect(pay()).toBeEnabled();
    });

    it("a room charge whose answer was lost: Yetu's answer decides", async () => {
      refs.roomAvailable = true;
      refs.candidates = [{ stayId: "stay-12", roomId: "room-12", roomNumber: "12", guestDisplayName: "Asha Mollel", postingEligible: true }];
      chargeToRoomMutate.mockImplementationOnce(lost);
      refs.refetchOrder.mockResolvedValue({ status: "success", data: CLOSED });
      const { onPaid } = renderPay();
      await userEvent.click(screen.getByRole("radio", { name: "Charge to room" }));
      await userEvent.type(screen.getByTestId("room-query"), "12");
      await userEvent.click(await screen.findByTestId("room-candidate-stay-12"));
      await userEvent.click(screen.getByTestId("confirm-room-charge"));
      await waitFor(() => expect(onPaid).toHaveBeenCalledWith(expect.objectContaining({ order: CLOSED, method: "ROOM_CHARGE", roomNumber: "12" })));
      expect(chargeToRoomMutate).toHaveBeenCalledTimes(1);
    });
  });
});
