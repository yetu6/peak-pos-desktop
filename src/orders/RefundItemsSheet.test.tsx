import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { POSOrder, POSOrderRefunds, POSRefund, POSRefundQuote, POSRefundQuoteRequest } from "../lib/posContracts";
import { RefundItemsSheet } from "./RefundItemsSheet";

// A stand-in for Yetu: each item's refund total is its price per unit with VAT
// (it is Yetu's job, the till only shows it), split over the payments in order.
const PRICE: Record<string, number> = { "oi-chips": 590_000, "oi-soda": 177_000 };

const {
  state,
  recordMutate,
  recordReset,
  refetchRefunds,
  refetchQuote,
  printJobs,
  keys,
} = vi.hoisted(() => ({
  state: {
    refunds: null as POSOrderRefunds | null,
    payments: [] as { paymentId: string; paymentMethod: string; capMinor: number }[],
    quoteError: null as Error | null,
    recordError: null as Error | null,
    recordPending: false,
    quoted: [] as POSRefundQuoteRequest[],
    roster: [] as { fullName: string; staffNumber: string }[],
    redraw: () => {},
    kept: null as POSRefundQuoteRequest | null,
    laterRefusal: null as Error | null,
    // A split asked for, while Yetu works it out: the last answer (Yetu's own split) is kept on screen.
    splitKept: false,
  },
  recordMutate: vi.fn(),
  recordReset: vi.fn(),
  refetchRefunds: vi.fn(),
  refetchQuote: vi.fn(),
  printJobs: vi.fn(async () => [{ ok: true }]),
  keys: { next: 0 },
}));

function quoteFor(orderId: string, body: POSRefundQuoteRequest): POSRefundQuote {
  const lines = body.lines.map((line) => ({
    orderItemId: line.orderItemId,
    name: line.orderItemId === "oi-chips" ? "Chips" : "Soda",
    quantity: line.quantity,
    grossMinor: Math.round((PRICE[line.orderItemId] * line.quantity) / 1.18),
    discountMinor: 0,
    netMinor: Math.round((PRICE[line.orderItemId] * line.quantity) / 1.18),
    taxMinor: PRICE[line.orderItemId] * line.quantity - Math.round((PRICE[line.orderItemId] * line.quantity) / 1.18),
    totalMinor: PRICE[line.orderItemId] * line.quantity,
  }));
  const totalMinor = lines.reduce((sum, line) => sum + line.totalMinor, 0);
  let left = totalMinor;
  const tenders = state.payments.map((payment) => {
    const typed = body.tenders?.find((tender) => tender.paymentId === payment.paymentId);
    const amountMinor = body.tenders ? (typed?.amountMinor ?? 0) : Math.min(left, payment.capMinor);
    left -= amountMinor;
    return { paymentId: payment.paymentId, paymentMethod: payment.paymentMethod as "CASH", amountMinor, capMinor: payment.capMinor };
  });
  return {
    orderId,
    currency: "TZS",
    netMinor: lines.reduce((sum, line) => sum + line.netMinor, 0),
    discountMinor: 0,
    taxMinor: lines.reduce((sum, line) => sum + line.taxMinor, 0),
    totalMinor,
    cashMinor: tenders.filter((tender) => tender.paymentMethod === "CASH").reduce((sum, tender) => sum + tender.amountMinor, 0),
    wholeOrderOnly: state.refunds?.wholeOrderOnly ?? false,
    lines,
    tenders,
  };
}

// useMutation draws the screen again when its error or pending state changes; so does this stand-in.
vi.mock("../hooks/usePosData", async () => {
  const { useReducer } = await import("react");
  return {
  usePropertyId: () => "property-1",
  useIdempotencyKey: () => ({ current: "unused", next: () => `key-${++keys.next}` }),
  useOrderRefunds: () => ({ data: state.refunds, isLoading: false, isError: false, isFetching: false, refetch: refetchRefunds }),
  useRefundQuote: (orderId: string, body: POSRefundQuoteRequest | null) => {
    if (!body || body.lines.length === 0) return { data: undefined, isFetching: false, error: null, refetch: refetchQuote };
    state.quoted.push(body);
    if (state.quoteError) return { data: undefined, isFetching: false, error: state.quoteError, refetch: refetchQuote };
    // A later ask of the same refund refused: React Query keeps the earlier answer beside the error.
    if (state.laterRefusal) return { data: quoteFor(orderId, body), isFetching: false, error: state.laterRefusal, refetch: refetchQuote };
    // React Query keeps the last answer on screen while the next is with Yetu.
    if (state.kept) return { data: quoteFor(orderId, state.kept), isFetching: true, error: null, refetch: refetchQuote };
    if (state.splitKept && body.tenders) return { data: quoteFor(orderId, { lines: body.lines }), isFetching: true, error: null, refetch: refetchQuote };
    return { data: quoteFor(orderId, body), isFetching: false, error: null, refetch: refetchQuote };
  },
  useRecordRefund: () => {
    const [, redraw] = useReducer((count: number) => count + 1, 0);
    state.redraw = redraw;
    return { mutate: recordMutate, reset: recordReset, error: state.recordError, isPending: state.recordPending };
  },
  };
});

vi.mock("../auth/DeviceSessionProvider", () => ({
  useDeviceSessionOptional: () => ({ session: { staffId: "staff-amina" }, roster: state.roster }),
}));

vi.mock("../lib/printJobs", () => ({ processPendingPrintJobs: printJobs }));

const ORDER = { id: "order-7", orderNumber: "POS-a3f90c14", dailyNumber: 7, status: "CLOSED" } as POSOrder;

function refunds(extra: Partial<POSOrderRefunds> = {}): POSOrderRefunds {
  return {
    orderId: "order-7",
    status: "CLOSED",
    totalMinor: 1_357_000,
    refundedMinor: 0,
    remainingMinor: 1_357_000,
    lastRefundDate: "2026-11-17",
    wholeOrderOnly: false,
    refunds: [],
    lines: [
      { orderItemId: "oi-chips", name: "Chips", quantity: 2, refundedQuantity: 0, remainingQuantity: 2 },
      { orderItemId: "oi-soda", name: "Soda", quantity: 1, refundedQuantity: 0, remainingQuantity: 1 },
    ],
    payments: [{ paymentId: "pay-cash", paymentMethod: "CASH", amountMinor: 1_357_000, refundedMinor: 0, remainingMinor: 1_357_000 }],
    ...extra,
  };
}

function given(refund: Partial<POSRefund> = {}): POSRefund {
  return {
    id: "refund-1",
    orderId: "order-7",
    orderNumber: "POS-a3f90c14",
    dailyNumber: 7,
    outletId: "outlet-1",
    shiftId: "shift-1",
    terminalId: "till-1",
    businessDate: "2026-10-18",
    reason: "Cold or not as ordered",
    initiatedById: "staff-amina",
    initiatedByName: "Amina Hassan",
    authorizedById: "staff-grace",
    authorizedByName: "Grace Mushi",
    netMinor: 500_000,
    discountMinor: 0,
    taxMinor: 90_000,
    totalMinor: 590_000,
    currency: "TZS",
    createdAt: "2026-10-18T15:40:00Z",
    lines: [],
    tenders: [{ id: "t-1", paymentId: "pay-cash", paymentMethod: "CASH", amountMinor: 590_000 }],
    ...refund,
  };
}

const lineOf = (id: string) => within(screen.getByTestId(`refund-line-${id}`));

async function chooseChipsAndReason() {
  await userEvent.click(lineOf("oi-chips").getByRole("button", { name: "One more Chips" }));
  await userEvent.click(screen.getByTestId("refund-reason-0"));
}

async function approveAsGrace() {
  await userEvent.click(screen.getByTestId("refund-ask"));
  await userEvent.click(screen.getByRole("radio", { name: /Grace Mushi/ }));
  for (const digit of "123456") await userEvent.click(screen.getByTestId(`refund-pin-key-${digit}`));
}

type Outcome = { ok: POSRefund } | { error: Error };
function nextOutcomes(...outcomes: Outcome[]) {
  recordMutate.mockImplementation((_vars: unknown, opts: { onSuccess?: (refund: POSRefund) => void; onError?: (error: Error) => void }) => {
    const outcome = outcomes.shift() ?? { ok: given() };
    if ("ok" in outcome) {
      state.recordError = null;
      opts.onSuccess?.(outcome.ok);
    } else {
      state.recordError = outcome.error;
      opts.onError?.(outcome.error);
      act(() => state.redraw());
    }
  });
}

beforeEach(() => {
  state.refunds = refunds();
  state.payments = [{ paymentId: "pay-cash", paymentMethod: "CASH", capMinor: 1_357_000 }];
  state.quoteError = null;
  state.recordError = null;
  state.recordPending = false;
  state.quoted = [];
  state.kept = null;
  state.laterRefusal = null;
  state.splitKept = false;
  state.roster = [
    { fullName: "Amina Hassan", staffNumber: "staff-amina" },
    { fullName: "Grace Mushi", staffNumber: "staff-grace" },
  ];
  keys.next = 0;
  recordMutate.mockReset();
  refetchRefunds.mockReset();
  refetchRefunds.mockImplementation(async () => ({ data: state.refunds }));
  refetchQuote.mockReset();
  // useMutation's reset clears its error, and the screen is drawn again.
  recordReset.mockReset();
  recordReset.mockImplementation(() => {
    state.recordError = null;
  });
  printJobs.mockClear();
  nextOutcomes();
});

describe("Refund items: choosing what goes back", () => {
  it("lets each item go back only as far as is left of it", async () => {
    state.refunds = refunds({
      lines: [
        { orderItemId: "oi-chips", name: "Chips", quantity: 2, refundedQuantity: 1, remainingQuantity: 1 },
        { orderItemId: "oi-soda", name: "Soda", quantity: 1, refundedQuantity: 1, remainingQuantity: 0 },
      ],
    });
    render(<RefundItemsSheet order={ORDER} currency="TZS" onClose={vi.fn()} />);
    expect(lineOf("oi-chips").getByText("1 of 2 left to refund")).toBeInTheDocument();
    await userEvent.click(lineOf("oi-chips").getByRole("button", { name: "One more Chips" }));
    expect(lineOf("oi-chips").getByRole("button", { name: "One more Chips" })).toBeDisabled();
    expect(lineOf("oi-soda").getByText("Refunded")).toBeInTheDocument();
    expect(lineOf("oi-soda").queryByRole("button", { name: "One more Soda" })).toBeNull();
  });

  it("needs an item, a reason and Yetu's figures before asking a supervisor", async () => {
    render(<RefundItemsSheet order={ORDER} currency="TZS" onClose={vi.fn()} />);
    const ask = screen.getByTestId("refund-ask");
    expect(ask).toBeDisabled();
    await userEvent.click(lineOf("oi-chips").getByRole("button", { name: "One more Chips" }));
    expect(ask).toBeDisabled();
    await userEvent.click(screen.getByTestId("refund-reason-0"));
    expect(ask).toBeEnabled();
  });

  it("shows Yetu's figures in words, never its own", async () => {
    render(<RefundItemsSheet order={ORDER} currency="TZS" onClose={vi.fn()} />);
    await chooseChipsAndReason();
    expect(screen.getByTestId("refund-summary")).toHaveTextContent("Give back TSh 5,900 in cash");
    expect(lineOf("oi-chips").getByText("TSh 5,900")).toBeInTheDocument();
    expect(screen.getByText("Includes VAT of TSh 900")).toBeInTheDocument();
    expect(state.quoted.at(-1)).toEqual({ lines: [{ orderItemId: "oi-chips", quantity: 1 }] });
  });

  it("never takes the last answer, kept while Yetu works, for the items on screen now", async () => {
    render(<RefundItemsSheet order={ORDER} currency="TZS" onClose={vi.fn()} />);
    await chooseChipsAndReason();
    state.kept = { lines: [{ orderItemId: "oi-chips", quantity: 1 }] };
    await userEvent.click(lineOf("oi-soda").getByRole("button", { name: "One more Soda" }));
    expect(screen.getByTestId("refund-summary")).toHaveTextContent("Working out the refund…");
    expect(screen.getByTestId("refund-ask")).toBeDisabled();
  });

  it("stops when Yetu refuses the same refund on a later ask, though the earlier figures are still kept", async () => {
    state.laterRefusal = new Error(
      JSON.stringify({ status: 409, code: "REFUND_NOT_ALLOWED", detail: "This till's shift closed while the refund was being given. Open a shift and try again." }),
    );
    render(<RefundItemsSheet order={ORDER} currency="TZS" onClose={vi.fn()} />);
    await chooseChipsAndReason();
    expect(screen.getByTestId("refund-quote-error")).toHaveTextContent("Open a shift and try again.");
    expect(screen.getByTestId("refund-ask")).toBeDisabled();
  });

  it("takes a reason of the cashier's own", async () => {
    render(<RefundItemsSheet order={ORDER} currency="TZS" onClose={vi.fn()} />);
    await userEvent.click(lineOf("oi-chips").getByRole("button", { name: "One more Chips" }));
    await userEvent.click(screen.getByTestId("refund-reason-other"));
    expect(screen.getByTestId("refund-ask")).toBeDisabled();
    await userEvent.type(screen.getByTestId("refund-reason-text"), "Found a hair");
    expect(screen.getByTestId("refund-ask")).toBeEnabled();
  });

  it("refunds a room charge whole: every item, no choosing", () => {
    state.refunds = refunds({ wholeOrderOnly: true });
    state.payments = [{ paymentId: "pay-room", paymentMethod: "ROOM_CHARGE", capMinor: 1_357_000 }];
    render(<RefundItemsSheet order={ORDER} currency="TZS" onClose={vi.fn()} />);
    expect(screen.getByTestId("refund-whole")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /One more/ })).toBeNull();
    expect(screen.getByTestId("refund-summary")).toHaveTextContent("Take TSh 13,570 off the room bill");
  });

  it("says why Yetu would refuse before anyone types a PIN, and doesn't ask", async () => {
    state.quoteError = new Error(
      JSON.stringify({ status: 409, code: "REFUND_EXCEEDS_DRAWER", detail: "The drawer holds TSh 2,000, less than the TSh 5,900 in cash going back." }),
    );
    render(<RefundItemsSheet order={ORDER} currency="TZS" onClose={vi.fn()} />);
    await chooseChipsAndReason();
    expect(screen.getByTestId("refund-quote-error")).toHaveTextContent("The drawer holds TSh 2,000, less than the TSh 5,900 in cash going back.");
    expect(screen.getByTestId("refund-ask")).toBeDisabled();
  });
});

describe("Refund items: a split payment", () => {
  beforeEach(() => {
    state.refunds = refunds({
      payments: [
        { paymentId: "pay-cash", paymentMethod: "CASH", amountMinor: 500_000, refundedMinor: 0, remainingMinor: 500_000 },
        { paymentId: "pay-mm", paymentMethod: "MOBILE_MONEY", amountMinor: 857_000, refundedMinor: 0, remainingMinor: 857_000 },
      ],
    });
    state.payments = [
      { paymentId: "pay-cash", paymentMethod: "CASH", capMinor: 500_000 },
      { paymentId: "pay-mm", paymentMethod: "MOBILE_MONEY", capMinor: 857_000 },
    ];
  });

  it("shows Yetu's proposed split, and changes it only to one that adds up", async () => {
    render(<RefundItemsSheet order={ORDER} currency="TZS" onClose={vi.fn()} />);
    await chooseChipsAndReason();
    expect(screen.getByTestId("refund-summary")).toHaveTextContent("Give back TSh 5,900: TSh 5,000 in cash and TSh 900 by mobile money");
    await userEvent.click(screen.getByTestId("refund-change-split"));
    const cash = screen.getByTestId("refund-split-CASH");
    await userEvent.clear(cash);
    await userEvent.type(cash, "1000");
    expect(screen.getByTestId("refund-split-total")).toHaveTextContent("Adds up to TSh 1,900 of TSh 5,900.");
    expect(screen.getByTestId("refund-ask")).toBeDisabled();
    const mobile = screen.getByTestId("refund-split-MOBILE_MONEY");
    await userEvent.clear(mobile);
    await userEvent.type(mobile, "4900");
    expect(screen.getByTestId("refund-summary")).toHaveTextContent("Give back TSh 5,900: TSh 1,000 in cash and TSh 4,900 by mobile money");
    expect(state.quoted.at(-1)?.tenders).toEqual([
      { paymentId: "pay-cash", amountMinor: 100_000 },
      { paymentId: "pay-mm", amountMinor: 490_000 },
    ]);
    expect(screen.getByTestId("refund-ask")).toBeEnabled();
  });

  it("never asks a supervisor while Yetu is still working out a changed split", async () => {
    state.splitKept = true;
    render(<RefundItemsSheet order={ORDER} currency="TZS" onClose={vi.fn()} />);
    await chooseChipsAndReason();
    await userEvent.click(screen.getByTestId("refund-change-split"));
    const cash = screen.getByTestId("refund-split-CASH");
    await userEvent.clear(cash);
    await userEvent.type(cash, "1000");
    const mobile = screen.getByTestId("refund-split-MOBILE_MONEY");
    await userEvent.clear(mobile);
    await userEvent.type(mobile, "4900");
    expect(screen.getByTestId("refund-ask")).toBeDisabled();
  });

  it("sends the split the supervisor approved, exactly", async () => {
    render(<RefundItemsSheet order={ORDER} currency="TZS" onClose={vi.fn()} />);
    await chooseChipsAndReason();
    await approveAsGrace();
    await userEvent.click(screen.getByTestId("refund-give"));
    expect(recordMutate.mock.calls[0][0].body.tenders).toEqual([
      { paymentId: "pay-cash", amountMinor: 500_000 },
      { paymentId: "pay-mm", amountMinor: 90_000 },
    ]);
  });
});

describe("Refund items: a supervisor approves", () => {
  it("asks a different person, says what they approve, and sends what was shown", async () => {
    render(<RefundItemsSheet order={ORDER} currency="TZS" onClose={vi.fn()} />);
    await chooseChipsAndReason();
    await userEvent.click(screen.getByTestId("refund-ask"));
    expect(screen.getByText("Give back TSh 5,900 in cash for 1 × Chips: Cold or not as ordered")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Amina Hassan/ })).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: /Grace Mushi/ }));
    for (const digit of "12345") await userEvent.click(screen.getByTestId(`refund-pin-key-${digit}`));
    expect(screen.getByTestId("refund-give")).toBeDisabled();
    await userEvent.click(screen.getByTestId("refund-pin-key-6"));
    expect(screen.getByTestId("refund-give")).toHaveTextContent("Give back TSh 5,900");
    await userEvent.click(screen.getByTestId("refund-give"));
    expect(recordMutate).toHaveBeenCalledWith(
      {
        orderId: "order-7",
        idempotencyKey: "key-1",
        body: {
          reason: "Cold or not as ordered",
          lines: [{ orderItemId: "oi-chips", quantity: 1 }],
          tenders: [{ paymentId: "pay-cash", amountMinor: 590_000 }],
          supervisorStaffId: "staff-grace",
          supervisorPin: "123456",
        },
      },
      expect.anything(),
    );
  });

  it("after a refused PIN, clears it and asks again under a new key", async () => {
    nextOutcomes({ error: new Error(JSON.stringify({ status: 403, code: "FORBIDDEN", detail: "x" })) });
    render(<RefundItemsSheet order={ORDER} currency="TZS" onClose={vi.fn()} />);
    await chooseChipsAndReason();
    await approveAsGrace();
    await userEvent.click(screen.getByTestId("refund-give"));
    expect(screen.getByTestId("refund-error")).toHaveTextContent("That PIN wasn't accepted, or they can't approve refunds.");
    expect(screen.getByTestId("refund-give")).toBeDisabled();
    for (const digit of "654321") await userEvent.click(screen.getByTestId(`refund-pin-key-${digit}`));
    await userEvent.click(screen.getByTestId("refund-give"));
    expect(recordMutate.mock.calls[1][0].idempotencyKey).not.toBe(recordMutate.mock.calls[0][0].idempotencyKey);
    expect(recordMutate.mock.calls[1][0].body.supervisorPin).toBe("654321");
  });

  it("after a lost answer, Try again sends the very same refund under the same key, so it is given once", async () => {
    nextOutcomes({ error: new TypeError("Failed to fetch") });
    render(<RefundItemsSheet order={ORDER} currency="TZS" onClose={vi.fn()} />);
    await chooseChipsAndReason();
    await approveAsGrace();
    await userEvent.click(screen.getByTestId("refund-give"));
    expect(screen.getByTestId("refund-error")).toHaveTextContent("can't tell whether the refund was given");
    await userEvent.click(screen.getByTestId("refund-retry"));
    expect(recordMutate).toHaveBeenCalledTimes(2);
    expect(recordMutate.mock.calls[1][0]).toEqual(recordMutate.mock.calls[0][0]);
  });

  it("after a lost answer, the request can't be changed: no Back, no other supervisor, no other PIN", async () => {
    state.roster = [...state.roster, { fullName: "Baraka Mushi", staffNumber: "staff-baraka" }];
    nextOutcomes({ error: new Error(JSON.stringify("<html><body>502 Bad Gateway</body></html>")) });
    render(<RefundItemsSheet order={ORDER} currency="TZS" onClose={vi.fn()} />);
    await chooseChipsAndReason();
    await approveAsGrace();
    await userEvent.click(screen.getByTestId("refund-give"));
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    expect(screen.queryByTestId("refund-give")).toBeNull();
    await userEvent.click(screen.getByRole("radio", { name: /Baraka Mushi/ }));
    await userEvent.click(screen.getByTestId("refund-pin-key-delete"));
    await userEvent.click(screen.getByTestId("refund-retry"));
    expect(recordMutate.mock.calls[1][0]).toEqual(recordMutate.mock.calls[0][0]);
  });

  it("Try again sends the refund exactly as it was sent, even after Yetu's figures changed meanwhile", async () => {
    nextOutcomes({ error: new TypeError("Failed to fetch") });
    render(<RefundItemsSheet order={ORDER} currency="TZS" onClose={vi.fn()} />);
    await chooseChipsAndReason();
    await approveAsGrace();
    await userEvent.click(screen.getByTestId("refund-give"));
    // The lost refund did go through: what is left, and so Yetu's figures for the items, change under the sheet.
    state.refunds = refunds({
      refundedMinor: 590_000,
      lines: [
        { orderItemId: "oi-chips", name: "Chips", quantity: 2, refundedQuantity: 1, remainingQuantity: 1 },
        { orderItemId: "oi-soda", name: "Soda", quantity: 1, refundedQuantity: 0, remainingQuantity: 1 },
      ],
    });
    PRICE["oi-chips"] = 590_001;
    try {
      act(() => state.redraw());
      await userEvent.click(screen.getByTestId("refund-retry"));
      expect(recordMutate.mock.calls[1][0]).toEqual(recordMutate.mock.calls[0][0]);
    } finally {
      PRICE["oi-chips"] = 590_000;
    }
  });

  it("can be closed while unsure: the order then shows what Yetu has", async () => {
    nextOutcomes({ error: new TypeError("Failed to fetch") });
    const onClose = vi.fn();
    render(<RefundItemsSheet order={ORDER} currency="TZS" onClose={onClose} />);
    await chooseChipsAndReason();
    await approveAsGrace();
    await userEvent.click(screen.getByTestId("refund-give"));
    await userEvent.click(screen.getByTestId("refund-close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("when the order changed meanwhile, goes back to the items, asks Yetu again, and keeps to what is left", async () => {
    recordMutate.mockImplementation((_vars: unknown, opts: { onError?: (error: Error) => void }) => {
      // Another till refunded both Chips first.
      state.refunds = refunds({
        refundedMinor: 1_180_000,
        lines: [
          { orderItemId: "oi-chips", name: "Chips", quantity: 2, refundedQuantity: 2, remainingQuantity: 0 },
          { orderItemId: "oi-soda", name: "Soda", quantity: 1, refundedQuantity: 0, remainingQuantity: 1 },
        ],
      });
      state.recordError = new Error(JSON.stringify({ status: 409, code: "REFUND_QUANTITY", detail: "Only 0 of Chips can still be refunded." }));
      opts.onError?.(state.recordError);
      act(() => state.redraw());
    });
    render(<RefundItemsSheet order={ORDER} currency="TZS" onClose={vi.fn()} />);
    await chooseChipsAndReason();
    await approveAsGrace();
    await userEvent.click(screen.getByTestId("refund-give"));
    expect(screen.getByTestId("refund-error")).toHaveTextContent("Only 0 of Chips can still be refunded.");
    expect(refetchRefunds).toHaveBeenCalled();
    expect(refetchQuote).toHaveBeenCalled();
    expect(lineOf("oi-chips").getByText("Refunded")).toBeInTheDocument();
    expect(screen.getByTestId("refund-ask")).toBeDisabled();
  });
});

describe("Refund items: done", () => {
  it("says what was refunded and what to do with the money, and prints the slip", async () => {
    const onRefunded = vi.fn();
    render(<RefundItemsSheet order={ORDER} currency="TZS" onClose={vi.fn()} onRefunded={onRefunded} />);
    await chooseChipsAndReason();
    await approveAsGrace();
    await userEvent.click(screen.getByTestId("refund-give"));
    const done = screen.getByTestId("refund-done-view");
    expect(within(done).getByText("Refunded TSh 5,900")).toBeInTheDocument();
    expect(within(done).getByText("Give TSh 5,900 back in cash from the drawer.")).toBeInTheDocument();
    expect(onRefunded).toHaveBeenCalledWith(expect.objectContaining({ id: "refund-1" }));
    expect(printJobs).toHaveBeenCalledWith("property-1", "refund-1");
    await waitFor(() => expect(screen.getByTestId("refund-print")).toHaveTextContent("The refund slip was printed."));
  });

  it("says when the slip didn't print, and that the refund stands", async () => {
    printJobs.mockResolvedValueOnce([{ ok: false, error: "No printer is configured" }] as never);
    render(<RefundItemsSheet order={ORDER} currency="TZS" onClose={vi.fn()} />);
    await chooseChipsAndReason();
    await approveAsGrace();
    await userEvent.click(screen.getByTestId("refund-give"));
    await waitFor(() =>
      expect(screen.getByTestId("refund-print")).toHaveTextContent("The refund slip didn't print (No printer is configured). The refund is recorded."),
    );
  });
});
