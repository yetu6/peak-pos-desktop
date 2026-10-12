import { describe, expect, it } from "vitest";
import { discountProblem, voidProblem } from "./registerWords";

const problem = (code: string, detail: string) => new Error(JSON.stringify({ code, detail }));

describe("discount and void refusals in words", () => {
  it("names a refused supervisor", () => {
    expect(discountProblem(problem("FORBIDDEN", "POS permission denied"))?.words).toBe(
      "A different supervisor must approve the discount. Their PIN wasn't accepted, or they can't approve discounts.",
    );
    expect(voidProblem(problem("CONFLICT", "supervisor approval failed"))?.words).toBe(
      "A different supervisor must approve the void. Their PIN wasn't accepted, or they can't approve voids.",
    );
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
