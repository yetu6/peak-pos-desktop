import { describe, expect, it } from "vitest";
import { REFUSED, rejected, reworded, type YetuProblem } from "../../tests/fixtures/yetuRefusals";
import { cashMovementProblem, closeShiftProblem } from "../cash/cashWords";
import { kitchenProblem } from "../kitchen/kitchenWords";
import { removeProblem, sendProblem } from "../orders/ordersWords";
import { discountProblem, roomChargeProblem, sellProblem, tenderProblem, voidProblem } from "../register/registerWords";
import { describePosError } from "./posErrors";

/**
 * Since S5b (fbc-peak #257) every refusal on the till's routes carries a code of its own. The till words each one
 * by that code: the same words whatever sentence Yetu writes in the detail.
 */
type Worder = (error: unknown) => { kind: string; words: string } | null;

function wordedByCode(worder: Worder, problem: YetuProblem) {
  const words = worder(rejected(problem));
  expect(worder(rejected(reworded(problem))), `${problem.code}: the detail must not decide`).toEqual(words);
  return words;
}

const NO_APPROVER_NEXT = "The owner chooses who approves in Team rules.";
const noApprover = (what: string) => ({ kind: "no-approver", words: `No one is set to approve ${what} here yet. ${NO_APPROVER_NEXT}` });
const sell = (step: Parameters<typeof sellProblem>[1]) => (error: unknown) => sellProblem(error, step);

describe("refusals worded by their code (S5b)", () => {
  it("payments", () => {
    expect(wordedByCode(tenderProblem, REFUSED.tenderAlreadyPaid)).toEqual({ kind: "paid", words: "This order is already paid." });
    expect(wordedByCode(tenderProblem, REFUSED.tenderTooMuch)).toEqual({
      kind: "other",
      words: "That's more than is still owed. Check the amount, then try again.",
    });
    expect(wordedByCode(tenderProblem, REFUSED.tenderOrderClosed)).toEqual({ kind: "paid", words: "This order is closed, so it can't take a payment." });
  });

  it("room charges", () => {
    expect(wordedByCode(roomChargeProblem, REFUSED.roomPartPaid)).toEqual({
      kind: "paid",
      words: "Charge to room isn't possible once part of the bill is paid.",
    });
    expect(wordedByCode(roomChargeProblem, REFUSED.roomNotEligible)).toEqual({ kind: "other", words: "This order can't go on a room bill." });
    expect(wordedByCode(roomChargeProblem, REFUSED.roomFolioNotOpen)).toEqual({
      kind: "other",
      words: "That guest's bill isn't open. Ask the front desk.",
    });
  });

  it("discounts", () => {
    expect(wordedByCode(discountProblem, REFUSED.discountPartPaid)).toEqual({
      kind: "paid",
      words: "A discount can't be added once part of the bill is paid.",
    });
    expect(wordedByCode(discountProblem, REFUSED.discountOrderClosed)).toEqual({
      kind: "paid",
      words: "This order is paid or cancelled, so it can't take a discount.",
    });
    expect(wordedByCode(discountProblem, { ...REFUSED.noApproverVoids, detail: "No one is set to approve discounts here yet." })).toEqual(
      noApprover("discounts"),
    );
  });

  it("cancellations", () => {
    expect(wordedByCode(voidProblem, REFUSED.voidPartPaid)).toEqual({ kind: "paid", words: "This order has already taken payment, so it can't be cancelled." });
    expect(wordedByCode(voidProblem, REFUSED.voidOrderClosed)).toEqual({ kind: "paid", words: "This order is already paid or cancelled." });
    expect(wordedByCode(voidProblem, REFUSED.noApproverVoids)).toEqual(noApprover("cancellations"));
  });

  it("selling", () => {
    expect(wordedByCode(sell("create"), REFUSED.createShiftNotOpen)).toEqual({ kind: "other", words: "No shift is open on this till. Open a shift first." });
    expect(wordedByCode(sell("add"), REFUSED.addSoldOut)).toEqual({ kind: "other", words: "That item is sold out or not on the menu now." });
    expect(wordedByCode(sell("add"), REFUSED.addOrderSent)).toEqual({
      kind: "other",
      words: "This order has gone to the kitchen. Start a new sale to add more.",
    });
    expect(wordedByCode(sell("send"), REFUSED.sendEmpty)).toEqual({ kind: "other", words: "Add something to the order before sending it." });
    expect(wordedByCode(sell("send"), REFUSED.sendOrderMoved)).toEqual({ kind: "other", words: "This order was already sent, paid or cancelled." });
    expect(wordedByCode(sell("remove"), REFUSED.removeSent)).toEqual({
      kind: "other",
      words: "This item has gone to the kitchen, so it can't be removed.",
    });
  });

  it("an order's detail: send and remove", () => {
    expect(wordedByCode(sendProblem, REFUSED.sendEmpty)).toEqual({ kind: "other", words: "Add something to the order before sending it." });
    expect(wordedByCode(sendProblem, REFUSED.sendOrderMoved)?.kind).toBe("moved");
    // The item went to the kitchen meanwhile: the screen reloads the order (kind "stale").
    expect(wordedByCode(removeProblem, REFUSED.removeSent)).toEqual({
      kind: "stale",
      words: "This item has gone to the kitchen, so it can't be removed. The order has been reloaded.",
    });
  });

  it("the kitchen: a ticket or order that moved on is shown where it is now", () => {
    const moved = { kind: "moved", words: "This ticket was moved on another screen. The board shows where it is now." };
    expect(wordedByCode(kitchenProblem, REFUSED.ticketMoved)).toEqual(moved);
    expect(wordedByCode(kitchenProblem, REFUSED.orderStepMoved)).toEqual(moved);
  });

  it("closing a shift", () => {
    expect(wordedByCode(closeShiftProblem, REFUSED.shiftHasOpenOrders)?.kind).toBe("open-orders");
    expect(wordedByCode(closeShiftProblem, REFUSED.shiftOfflineCash)?.kind).toBe("offline-cash");
    expect(wordedByCode(closeShiftProblem, REFUSED.shiftNotOpen)).toEqual({ kind: "not-open", words: "This shift is already closed." });
    expect(wordedByCode(closeShiftProblem, { ...REFUSED.noApproverVoids, detail: "No one is set to approve a short or over drawer here yet." })).toEqual(
      noApprover("a count that doesn't match"),
    );
  });

  it("cash in and out", () => {
    const cashOut = (error: unknown) => cashMovementProblem(error, "CASH_OUT");
    const cashIn = (error: unknown) => cashMovementProblem(error, "CASH_IN");
    expect(wordedByCode(cashIn, REFUSED.cashNoShift)).toEqual({ kind: "no-shift", words: "No shift is open on this till." });
    expect(wordedByCode(cashOut, { ...REFUSED.noApproverVoids, detail: "No one is set to approve cash out here yet." })).toEqual(
      noApprover("taking cash out"),
    );
    // Taking cash out: a refused approval, whatever Yetu's sentence says (cash.go writes two of them).
    const forbidden = { ...REFUSED.cashNoShift, status: 403, code: "FORBIDDEN", detail: "That approval was not accepted." };
    expect(wordedByCode(cashOut, forbidden)?.kind).toBe("supervisor");
    expect(wordedByCode(cashIn, forbidden)?.kind).toBe("permission");
  });
});

describe("the till's own kinds for the S5b codes", () => {
  it("a state conflict is a conflict, more than is owed is a check of the details, never 'something went wrong'", () => {
    for (const problem of Object.values(REFUSED)) {
      const kind = describePosError(problem).kind;
      expect(kind, problem.code).not.toBe("UNKNOWN");
    }
    expect(describePosError(REFUSED.tenderAlreadyPaid).kind).toBe("BUSINESS_CONFLICT");
    expect(describePosError(REFUSED.ticketMoved).kind).toBe("BUSINESS_CONFLICT");
    expect(describePosError(REFUSED.tenderTooMuch).kind).toBe("VALIDATION_ERROR");
  });

  it("a code Yetu adds later is read by its status: 409 a conflict, 422 a check of the details", () => {
    const later = (status: number) => ({ type: "about:blank", status, code: "A_LATER_CODE", title: "x", detail: "x", request_id: "r" });
    expect(describePosError(later(409)).kind).toBe("BUSINESS_CONFLICT");
    expect(describePosError(later(422)).kind).toBe("VALIDATION_ERROR");
  });

  it("nobody chosen to approve: says so and who chooses", () => {
    expect(describePosError(REFUSED.noApproverVoids)).toMatchObject({
      kind: "NO_APPROVER",
      message: `No one is set to approve this here yet. ${NO_APPROVER_NEXT}`,
      retryable: false,
    });
  });
});
