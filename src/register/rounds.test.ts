import { describe, expect, it } from "vitest";
import type { POSOrderItem } from "../lib/posContracts";
import { payWaitsWords, roundWords, sendWords, takesMore, unsentLines } from "./rounds";

const line = (status: POSOrderItem["status"], roundNumber?: number) => ({ status, roundNumber }) as POSOrderItem;

describe("rounds on the till (S17a)", () => {
  it("a sent order takes more only from a Yetu with rounds; a paid or voided one never", () => {
    expect(takesMore(null)).toBe(true);
    expect(takesMore({ status: "OPEN", items: [] })).toBe(true);
    expect(takesMore({ status: "SERVED", items: [line("SENT", 1)], roundsSent: 1 })).toBe(true);
    expect(takesMore({ status: "SENT", items: [line("SENT")] })).toBe(false);
    expect(takesMore({ status: "CLOSED", items: [], roundsSent: 2 })).toBe(false);
    expect(takesMore({ status: "VOIDED", items: [], roundsSent: 1 })).toBe(false);
  });

  it("the send button says the next round once one was sent", () => {
    expect(sendWords(null)).toBe("Send to kitchen");
    expect(sendWords({ status: "OPEN", items: [line("ADDED")], roundsSent: 0 })).toBe("Send to kitchen");
    expect(sendWords({ status: "SERVED", items: [line("SENT", 1), line("ADDED")], roundsSent: 1 })).toBe("Send round 2");
  });

  it("paying waits for what isn't sent, once the order has had a round; a quick sale pays first", () => {
    const waiting = { status: "SERVED" as const, items: [line("SENT", 1), line("ADDED")], roundsSent: 1 };
    expect(unsentLines(waiting)).toBe(1);
    expect(payWaitsWords(waiting)).toBe("Send or remove what isn't sent yet, then take payment.");
    expect(payWaitsWords({ status: "OPEN", items: [line("ADDED")], roundsSent: 0 })).toBeNull();
    expect(payWaitsWords({ status: "SERVED", items: [line("SENT", 1)], roundsSent: 1 })).toBeNull();
  });

  it("a line's round is said once there is more than one", () => {
    expect(roundWords(1, 1)).toBeUndefined();
    expect(roundWords(2, 2)).toBe("Round 2");
    expect(roundWords(undefined, 2)).toBeUndefined();
  });
});
