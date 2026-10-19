import { describe, expect, it } from "vitest";
import type { POSRefundQuoteTender } from "../lib/posContracts";
import { refundAvailability, refundDoneWords, refundGivenWords, refundProblem, refundSummaryWords } from "./refundWords";

function refused(code: string, detail = ""): Error {
  return new Error(JSON.stringify({ status: 409, code, detail }));
}

function tender(paymentMethod: POSRefundQuoteTender["paymentMethod"], amountMinor: number, capMinor = amountMinor): POSRefundQuoteTender {
  return { paymentId: `p-${paymentMethod}`, paymentMethod, amountMinor, capMinor };
}

describe("refund refusals in words", () => {
  it("shows Yetu's own words for a refund refusal: they are written for the till", () => {
    expect(refundProblem(refused("REFUND_NOT_ALLOWED", "Open a shift on this till before giving a refund."))).toEqual({
      kind: "not-allowed",
      words: "Open a shift on this till before giving a refund.",
    });
    expect(refundProblem(refused("REFUND_QUANTITY", "Only 1 of Chips can still be refunded."))?.words).toBe("Only 1 of Chips can still be refunded.");
    expect(refundProblem(refused("FOLIO_CLOSED", "Room 12's bill is closed. Refund it at the front desk."))?.words).toBe(
      "Room 12's bill is closed. Refund it at the front desk.",
    );
    expect(refundProblem(refused("REFUND_EXCEEDS_DRAWER", "The drawer holds TSh 2,000; this refund gives back TSh 5,900 in cash."))?.kind).toBe(
      "drawer",
    );
  });

  it("has words of its own when Yetu sends none", () => {
    expect(refundProblem(refused("ROOM_CHARGE_PARTIAL_REFUND"))?.words).toBe(
      "A room charge is refunded whole, in one go. Refund every item, or refund it at the front desk.",
    );
    expect(refundProblem(refused("REFUND_TENDER_MISMATCH"))?.words).toBe(
      "The money going back doesn't add up to the refund. Check how much goes back each way.",
    );
  });

  it("never shows a contract check's sentence for a refused body", () => {
    const words = refundProblem(
      new Error(JSON.stringify({ status: 422, code: "VALIDATION_FAILED", detail: 'doesn\'t match schema #/components/schemas/POSRefundRequest' })),
    )?.words;
    expect(words).toBe("Choose at least one item and say why the money is going back, then try again.");
  });

  it("says a refused approval in the till's words, and who chooses approvers", () => {
    expect(refundProblem(new Error(JSON.stringify({ status: 403, code: "FORBIDDEN", detail: "x" })))).toEqual({
      kind: "supervisor",
      words: "A different person who may approve refunds must enter their PIN. That PIN wasn't accepted, or they can't approve refunds.",
    });
    expect(refundProblem(new Error(JSON.stringify({ status: 409, code: "NO_APPROVER_SET" })))?.words).toBe(
      "No one is set to approve refunds here yet. The owner chooses who approves in Team rules.",
    );
  });

  it("never says a refund wasn't given when its answer may have been lost", () => {
    // No connection; a proxy's page with no code (an unreadable answer); Yetu busy or failing.
    for (const lost of [
      new TypeError("Failed to fetch"),
      new Error(JSON.stringify("<html><body>502 Bad Gateway</body></html>")),
      new Error(JSON.stringify({ status: 503, code: "SERVICE_UNAVAILABLE", detail: "x" })),
      new Error(JSON.stringify({ status: 500, code: "INTERNAL_ERROR", detail: "x" })),
    ]) {
      expect(refundProblem(lost)).toEqual({
        kind: "unsure",
        words:
          "Yetu's answer was lost, so this till can't tell whether the refund was given. Try again: Yetu gives a refund only once. If you close this, the order shows what Yetu has.",
      });
    }
  });

  it("for Yetu's figures, a lost answer only means the figures didn't come", () => {
    expect(refundProblem(new TypeError("Failed to fetch"), "quote")?.kind).toBe("network");
    expect(refundProblem(new Error(JSON.stringify("<html>502</html>")), "quote")).toEqual({
      kind: "other",
      words: "The refund couldn't be worked out. Try again.",
    });
  });

  it("a refusal of Yetu's figures is about the cashier, not a PIN nobody typed", () => {
    expect(refundProblem(new Error(JSON.stringify({ status: 403, code: "FORBIDDEN", detail: "x" })), "quote")).toEqual({
      kind: "permission",
      words: "Only a cashier or manager can give a refund. Ask one to help.",
    });
  });

  it("shows Yetu's own sentence for a refund it can't read as one", () => {
    const free = new Error(JSON.stringify({ status: 422, code: "VALIDATION_FAILED", detail: "Those items cost nothing, so there is nothing to give back." }));
    expect(refundProblem(free)?.words).toBe("Those items cost nothing, so there is nothing to give back.");
  });
});

describe("what a refund gives back, in words", () => {
  it("names the one way the money goes back", () => {
    expect(refundSummaryWords([tender("CASH", 950_000)], "TZS")).toBe("Give back TSh 9,500 in cash");
    expect(refundSummaryWords([tender("MOBILE_MONEY", 950_000)], "TZS")).toBe("Give back TSh 9,500 by mobile money");
    expect(refundSummaryWords([tender("ROOM_CHARGE", 950_000)], "TZS")).toBe("Take TSh 9,500 off the room bill");
  });

  it("names each way for a split, leaving out the ways that give nothing back", () => {
    expect(refundSummaryWords([tender("CASH", 500_000), tender("MOBILE_MONEY", 450_000), tender("EXTERNAL_CARD", 0, 300_000)], "TZS")).toBe(
      "Give back TSh 9,500: TSh 5,000 in cash and TSh 4,500 by mobile money",
    );
  });

  it("says nothing until there is something to give back", () => {
    expect(refundSummaryWords([], "TZS")).toBe("");
    expect(refundSummaryWords([tender("CASH", 0, 500_000)], "TZS")).toBe("");
  });

  it("says what was done once Yetu has recorded it", () => {
    expect(refundDoneWords(950_000, [{ paymentMethod: "CASH", amountMinor: 950_000 }], "TZS")).toEqual({
      title: "Refunded TSh 9,500",
      lines: ["Give TSh 9,500 back in cash from the drawer."],
    });
    expect(refundDoneWords(950_000, [{ paymentMethod: "ROOM_CHARGE", amountMinor: 950_000 }], "TZS").lines).toEqual([
      "TSh 9,500 taken off the room bill.",
    ]);
  });
});

describe("a refund already given, in words", () => {
  it("says how much went back and how", () => {
    expect(refundGivenWords(767_000, [{ paymentMethod: "CASH", amountMinor: 767_000 }], "TZS")).toBe("TSh 7,670 back in cash");
    expect(
      refundGivenWords(767_000, [{ paymentMethod: "CASH", amountMinor: 500_000 }, { paymentMethod: "MOBILE_MONEY", amountMinor: 267_000 }], "TZS"),
    ).toBe("TSh 7,670 back in cash and by mobile money");
    expect(refundGivenWords(767_000, [{ paymentMethod: "ROOM_CHARGE", amountMinor: 767_000 }], "TZS")).toBe("TSh 7,670 taken off the room bill");
  });
});

describe("whether this order can be refunded here, and why not", () => {
  const base = { status: "CLOSED" as const, remainingMinor: 950_000, lastRefundDate: "2026-10-20" };

  it("offers a refund on a paid order within its window, on a till with an open shift", () => {
    expect(refundAvailability({ refunds: base, shiftBusinessDate: "2026-10-18", canRefund: true })).toEqual({ offer: true, why: null });
  });

  it("still offers it on the window's last day", () => {
    expect(refundAvailability({ refunds: base, shiftBusinessDate: "2026-10-20", canRefund: true })).toEqual({ offer: true, why: null });
  });

  it("says why not, in words", () => {
    expect(refundAvailability({ refunds: { ...base, remainingMinor: 0 }, shiftBusinessDate: "2026-10-18", canRefund: true }).why).toBe(
      "Everything on this order has been refunded.",
    );
    expect(refundAvailability({ refunds: base, shiftBusinessDate: "2026-10-21", canRefund: true }).why).toBe(
      "Refunds for this order ended on Tue 20 Oct.",
    );
    expect(refundAvailability({ refunds: base, shiftBusinessDate: null, canRefund: true }).why).toBe("Open a shift on this till to give a refund.");
    expect(refundAvailability({ refunds: base, shiftBusinessDate: "2026-10-18", canRefund: false }).why).toBe(
      "Only a cashier or manager can give a refund. Ask one to help.",
    );
  });
});

// F-244: a bill paid partly in cash and partly on a room gives back the cash first, then the room's share.
describe("a split bill's refund in words", () => {
  it("names the cash and what comes off the room bill", () => {
    expect(
      refundSummaryWords(
        [
          { paymentMethod: "CASH", amountMinor: 500_000 },
          { paymentMethod: "ROOM_CHARGE", amountMinor: 680_000 },
        ],
        "TZS",
      ),
    ).toBe("Give back TSh 11,800: TSh 5,000 in cash and TSh 6,800 off the room bill");
    expect(
      refundDoneWords(11_800_00, [
        { paymentMethod: "CASH", amountMinor: 500_000 },
        { paymentMethod: "ROOM_CHARGE", amountMinor: 680_000 },
      ], "TZS").lines,
    ).toEqual(["Give TSh 5,000 back in cash from the drawer.", "TSh 6,800 taken off the room bill."]);
  });
});
