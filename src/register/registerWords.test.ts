import { describe, expect, it } from "vitest";
import { discountProblem, itemVoidedWords, voidItemProblem, voidItemSheetWords, voidProblem } from "./registerWords";

const problem = (code: string, detail: string) => new Error(JSON.stringify({ code, detail }));

describe("discount and void refusals in words", () => {
  it("names a refused supervisor", () => {
    expect(discountProblem(problem("FORBIDDEN", "POS permission denied"))?.words).toBe(
      "A different supervisor must approve the discount. Their PIN wasn't accepted, or they can't approve discounts.",
    );
    // Yetu's refusal of a supervisor's PIN or role since fbc-peak #252: 403 FORBIDDEN, its own sentence.
    expect(voidProblem(problem("FORBIDDEN", "That approval was not accepted. A different person who may approve this, and is active at this property, must enter their own PIN. Several wrong PINs lock it for a while."))?.words).toBe(
      "A different supervisor must approve this. Their PIN wasn't accepted, or they can't approve cancellations.",
    );
  });

  it("says an order changed on another till has been reloaded", () => {
    expect(voidProblem(problem("STALE_VERSION", "resource has changed"))).toEqual({
      kind: "stale",
      words: "This order changed on another till. It's been reloaded: check it, then ask a supervisor again.",
    });
  });

  it("says a paid order can't take a discount or be voided", () => {
    // fbc-peak #285: an amount off more than the bill, refused before the supervisor's PIN is checked.
    expect(discountProblem(problem("DISCOUNT_MORE_THAN_BILL", "A discount can't be more than the bill."))?.words).toBe(
      "That's more than the bill. Take off no more than the bill comes to.",
    );
    expect(discountProblem(problem("ORDER_HAS_PAYMENT", "discount cannot be changed after a tender has been recorded"))?.words).toBe(
      "A discount can't be added once part of the bill is paid.",
    );
    expect(voidProblem(problem("INVALID_STATE", "This order has already taken payment, so it can no longer be voided or have items removed."))?.words).toBe(
      "This order has already taken payment, so it can't be cancelled.",
    );
  });

  it("keeps the till's words for a session that ended", () => {
    expect(discountProblem(problem("SESSION_EXPIRED", "x"))?.words).toBe("You were signed out. Enter your PIN to carry on.");
    expect(voidProblem(problem("SESSION_EXPIRED", "x"))?.words).toBe("You were signed out. Enter your PIN to carry on.");
  });

  it("never shows the backend's own sentence", () => {
    expect(discountProblem(problem("CONFLICT", "pq: something new"))?.words).toBe("The discount wasn't applied. Try again.");
    expect(voidProblem(problem("CONFLICT", "pq: something new"))?.words).toBe("The order wasn't cancelled. Try again.");
  });
});

describe("payment and room charge refusals in words", () => {
  it("names the tender refusals", async () => {
    const { tenderProblem } = await import("./registerWords");
    expect(tenderProblem(problem("TENDER_EXCEEDS_BALANCE", "tender exceeds remaining balance"))?.words).toBe(
      "That's more than is still owed. Check the amount, then try again.",
    );
    expect(tenderProblem(problem("ORDER_ALREADY_PAID", "order remaining balance is already settled"))?.words).toBe("This order is already paid.");
    expect(tenderProblem(problem("ORDER_STATE_CHANGED", "tender cannot be recorded on a closed or voided order"))?.words).toBe(
      "This order is closed, so it can't take a payment.",
    );
    expect(tenderProblem(problem("FORBIDDEN", "x"))).toEqual({ kind: "permission", words: "Only a cashier or manager can take payment. Ask one to help." });
    expect(tenderProblem(problem("CONFLICT", "pq: new"))?.words).toBe("The payment wasn't recorded. Try again.");
    expect(tenderProblem(problem("SESSION_EXPIRED", "x"))?.words).toBe("You were signed out. Enter your PIN to carry on.");
  });

  it("names the room charge refusals", async () => {
    const { roomChargeProblem } = await import("./registerWords");
    expect(roomChargeProblem(problem("ORDER_HAS_PAYMENT", "room charge cannot follow a partial tender"))?.words).toBe(
      "Charge to room isn't possible once part of the bill is paid.",
    );
    expect(roomChargeProblem(problem("FOLIO_NOT_OPEN", "active stay with open folio not found"))?.words).toBe(
      "That guest's bill isn't open. Ask the front desk.",
    );
    expect(roomChargeProblem(problem("ORDER_STATE_CHANGED", "order is not eligible for room charge"))?.words).toBe(
      "This order can't go on a room bill.",
    );
    expect(roomChargeProblem(problem("CAPABILITY_NOT_ENABLED", "x"))?.words).toBe("This isn't switched on for your business. Ask a manager to switch it on in Yetu.");
    expect(roomChargeProblem(problem("CONFLICT", "pq: new"))?.words).toBe("The room charge didn't go through. Try again.");
  });
});

/**
 * Yetu's refusals of a payment or room charge since S5b (fbc-peak #257, errors.go), as the till receives them:
 * each is Yetu looking at the request and refusing it, so a replay that gets one was not recorded.
 */
const s5b = (status: number, code: string, title: string, detail: string) =>
  new Error(JSON.stringify({ type: "about:blank", status, code, title, detail, request_id: "req-1" }));

const TENDER_REFUSED_S5B = {
  alreadyPaid: s5b(409, "ORDER_ALREADY_PAID", "Nothing is left to pay on this order.", "order remaining balance is already settled"),
  closed: s5b(409, "ORDER_STATE_CHANGED", "This order is not at the step this needs.", "tender cannot be recorded on a closed or voided order"),
  tooMuch: s5b(422, "TENDER_EXCEEDS_BALANCE", "That is more than is still owed.", "tender exceeds remaining balance"),
};
const ROOM_REFUSED_S5B = {
  partPaid: s5b(409, "ORDER_HAS_PAYMENT", "Part of this order is already paid.", "room charge cannot follow a partial tender"),
  notEligible: s5b(409, "ORDER_STATE_CHANGED", "This order is not at the step this needs.", "order is not eligible for room charge"),
  folio: s5b(409, "FOLIO_NOT_OPEN", "The guest's bill is not open.", "active stay with open folio not found"),
};

describe("a lost payment answer, settled by Yetu's S5b refusals", () => {
  it("takes each S5b refusal of a payment as proof it was not recorded", async () => {
    const { afterLostAnswer } = await import("./registerWords");
    for (const [name, error] of Object.entries(TENDER_REFUSED_S5B)) expect(afterLostAnswer(error), name).toBe("refused");
  });

  it("takes each S5b refusal of a room charge as proof it was not recorded", async () => {
    const { afterLostAnswer } = await import("./registerWords");
    for (const [name, error] of Object.entries(ROOM_REFUSED_S5B)) expect(afterLostAnswer(error), name).toBe("refused");
  });

  it("says the order was paid or changed on another till when that is why", async () => {
    const { lostAnswerRefusalWords } = await import("./registerWords");
    const moved = "This order was paid or changed on another till, so this payment wasn't recorded. The amounts here are Yetu's latest: check them before taking any money.";
    expect(lostAnswerRefusalWords(TENDER_REFUSED_S5B.alreadyPaid, false)).toBe(moved);
    expect(lostAnswerRefusalWords(TENDER_REFUSED_S5B.closed, false)).toBe(moved);
    expect(lostAnswerRefusalWords(TENDER_REFUSED_S5B.tooMuch, false)).toBe(moved);
    expect(lostAnswerRefusalWords(ROOM_REFUSED_S5B.partPaid, true)).toBe(moved.replace("this payment", "this charge"));
  });

  it("says the guest's bill isn't open when that is why, not that the order moved", async () => {
    const { lostAnswerRefusalWords } = await import("./registerWords");
    expect(lostAnswerRefusalWords(ROOM_REFUSED_S5B.folio, true)).toBe("That guest's bill isn't open. Ask the front desk.");
  });

  it("still keeps asking when Yetu's answer proves nothing", async () => {
    const { afterLostAnswer } = await import("./registerWords");
    expect(afterLostAnswer(s5b(500, "INTERNAL_ERROR", "Internal error", "x"))).toBe("unsure");
    expect(afterLostAnswer(s5b(404, "NOT_FOUND", "Not found", "x"))).toBe("unsure");
    expect(afterLostAnswer(s5b(409, "IDEMPOTENT_REQUEST_IN_PROGRESS", "In progress", "x"))).toBe("unsure");
    expect(afterLostAnswer(s5b(409, "SOMETHING_NEW", "New", "x"))).toBe("unsure");
  });
});

describe("voiding one item (fbc-peak 00125)", () => {
  const refusal = (code: string) => new Error(JSON.stringify({ code, detail: "Yetu's own sentence, never shown" }));

  it("says each refusal in the till's words", () => {
    expect(voidItemProblem(refusal("FORBIDDEN"))).toEqual({ kind: "supervisor", words: "A different supervisor must approve this. Their PIN wasn't accepted, or they can't approve cancellations." });
    expect(voidItemProblem(refusal("NO_APPROVER_SET"))?.kind).toBe("no-approver");
    expect(voidItemProblem(refusal("STALE_VERSION"))?.kind).toBe("stale");
    expect(voidItemProblem(problem("INVALID_STATE", "This order has already taken payment, so it can no longer be voided or have items removed.")))
      .toEqual({ kind: "paid", words: "Part of this bill is paid, so items can't be cancelled. Refund it after it's paid." });
    expect(voidItemProblem(refusal("TAB_WAITING_FOR_SHIFT"))?.words).toBe("Take this tab over first, then cancel the item.");
    expect(voidItemProblem(null)).toBeNull();
  });

  // Review 2026-10-21: one code, several meanings -- told apart by Yetu's words.
  it("reloads only for an item voided elsewhere; any other refusal is said, so it isn't asked again", () => {
    expect(voidItemProblem(problem("ITEM_NOT_VOIDABLE", "This item is already voided."))?.kind).toBe("stale");
    const vat = voidItemProblem(problem("ITEM_NOT_VOIDABLE", "This item was added before Yetu kept each item's VAT rate: void all of it."));
    expect(vat).toEqual({ kind: "other", words: "This item was added before Yetu kept each item's VAT rate: void all of it." });
    expect(voidItemProblem(problem("ITEM_NOT_VOIDABLE", "The order has 1 of this item: void 1 or fewer."))?.kind).toBe("other");
  });

  it("names the person's own role, not the supervisor, when their role can't void", () => {
    expect(voidItemProblem(problem("FORBIDDEN", "POS permission denied"))).toEqual({ kind: "permission", words: "Your role can't cancel items. Ask a manager to do it." });
  });

  it("never says the bill is part-paid when the day isn't ready", () => {
    expect(voidItemProblem(problem("INVALID_STATE", "a shift for this business date is still open"))?.kind).not.toBe("paid");
  });

  it("says who is told, by the station making it", () => {
    expect(itemVoidedWords(1, "Soda", "BAR")).toBe("1 × Soda cancelled. The bar has been told.");
    expect(itemVoidedWords(2, "Chips", "HOT")).toBe("2 × Chips cancelled. The hot kitchen has been told.");
    expect(itemVoidedWords(1, "Cake", "PASTRY")).toBe("1 × Cake cancelled. The pastry station has been told.");
    expect(itemVoidedWords(1, "Rice", undefined)).toBe("1 × Rice cancelled. The kitchen has been told.");
    expect(voidItemSheetWords("GENERAL")).toBe("Takes it off the order and tells the kitchen. This is not a refund: no money moves.");
  });
});
