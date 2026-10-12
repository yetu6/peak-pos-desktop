import { describe, expect, it } from "vitest";
import { discountProblem, voidProblem } from "./registerWords";

const problem = (code: string, detail: string) => new Error(JSON.stringify({ code, detail }));

describe("discount and void refusals in words", () => {
  it("names a refused supervisor", () => {
    expect(discountProblem(problem("FORBIDDEN", "POS permission denied"))?.words).toBe(
      "A different supervisor must approve the discount. Their PIN wasn't accepted, or they can't approve discounts.",
    );
    // Yetu's refusal of a supervisor's PIN or role since fbc-peak #252: 403 FORBIDDEN, its own sentence.
    expect(voidProblem(problem("FORBIDDEN", "That approval was not accepted. A different person who may approve this, and is active at this property, must enter their own PIN. Several wrong PINs lock it for a while."))?.words).toBe(
      "A different supervisor must approve the void. Their PIN wasn't accepted, or they can't approve voids.",
    );
  });

  it("says an order changed on another till has been reloaded", () => {
    expect(voidProblem(problem("STALE_VERSION", "resource has changed"))).toEqual({
      kind: "stale",
      words: "This order changed on another till. It's been reloaded: check it, then ask a supervisor again.",
    });
  });

  it("says a paid order can't take a discount or be voided", () => {
    expect(discountProblem(problem("CONFLICT", "discount cannot be changed after a tender has been recorded"))?.words).toBe(
      "A discount can't be added once part of the bill is paid.",
    );
    expect(voidProblem(problem("INVALID_STATE", "This order has already taken payment, so it can no longer be voided or have items removed."))?.words).toBe(
      "This order has already taken payment, so it can't be voided.",
    );
  });

  it("keeps the till's words for a session that ended", () => {
    expect(discountProblem(problem("SESSION_EXPIRED", "x"))?.words).toBe("Your session expired — enter your PIN again.");
    expect(voidProblem(problem("SESSION_EXPIRED", "x"))?.words).toBe("Your session expired — enter your PIN again.");
  });

  it("never shows the backend's own sentence", () => {
    expect(discountProblem(problem("CONFLICT", "pq: something new"))?.words).toBe("The discount wasn't applied. Try again.");
    expect(voidProblem(problem("CONFLICT", "pq: something new"))?.words).toBe("The order wasn't voided. Try again.");
  });
});

describe("payment and room charge refusals in words", () => {
  it("names the tender refusals", async () => {
    const { tenderProblem } = await import("./registerWords");
    expect(tenderProblem(problem("CONFLICT", "tender exceeds remaining balance"))?.words).toBe(
      "That's more than is still owed. Check the amount, then try again.",
    );
    expect(tenderProblem(problem("CONFLICT", "order remaining balance is already settled"))?.words).toBe("This order is already paid.");
    expect(tenderProblem(problem("CONFLICT", "tender cannot be recorded on a closed or voided order"))?.words).toBe(
      "This order is closed, so it can't take a payment.",
    );
    expect(tenderProblem(problem("FORBIDDEN", "x"))?.words).toBe("Only a cashier or manager can take payment.");
    expect(tenderProblem(problem("CONFLICT", "pq: new"))?.words).toBe("The payment wasn't recorded. Try again.");
    expect(tenderProblem(problem("SESSION_EXPIRED", "x"))?.words).toBe("Your session expired — enter your PIN again.");
  });

  it("names the room charge refusals", async () => {
    const { roomChargeProblem } = await import("./registerWords");
    expect(roomChargeProblem(problem("CONFLICT", "room charge cannot follow a partial tender"))?.words).toBe(
      "Charge to room isn't possible once part of the bill is paid.",
    );
    expect(roomChargeProblem(problem("CONFLICT", "active stay with open folio not found"))?.words).toBe(
      "That guest's bill isn't open. Ask the front desk.",
    );
    expect(roomChargeProblem(problem("CONFLICT", "order is not eligible for room charge"))?.words).toBe(
      "This order can't go on a room bill.",
    );
    expect(roomChargeProblem(problem("CAPABILITY_NOT_ENABLED", "x"))?.words).toBe("This feature isn't enabled for this property.");
    expect(roomChargeProblem(problem("CONFLICT", "pq: new"))?.words).toBe("The room charge didn't go through. Try again.");
  });
});
