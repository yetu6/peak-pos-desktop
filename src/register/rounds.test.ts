import { describe, expect, it } from "vitest";
import type { POSOrderItem } from "../lib/posContracts";
import { directOnlyUnsent, payWaitsWords, printWords, roundWords, stationPrintWords, takesMore, unsentLines, unsentStations } from "./rounds";

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

  it("paying waits for what isn't sent, once the order has had a round; a quick sale pays first", () => {
    const waiting = { status: "SERVED" as const, items: [line("SENT", 1), line("ADDED")], roundsSent: 1 };
    expect(unsentLines(waiting)).toBe(1);
    expect(payWaitsWords(waiting)).toBe("Print the new items first, or remove them, then take payment.");
    expect(payWaitsWords({ status: "OPEN", items: [line("ADDED")], roundsSent: 0 })).toBeNull();
    expect(payWaitsWords({ status: "SERVED", items: [line("SENT", 1)], roundsSent: 1 })).toBeNull();
  });

  it("a line's round is said once there is more than one", () => {
    expect(roundWords(1, 1)).toBeUndefined();
    expect(roundWords(2, 2)).toBe("Round 2");
    expect(roundWords(undefined, 2)).toBeUndefined();
  });
});

// Print for bar (owner, 2026-10-22): the till picks each station's new items itself.
describe("printing one station at a time", () => {
  const at = (status: POSOrderItem["status"], prepStation?: POSOrderItem["prepStation"], roundNumber?: number) =>
    ({ status, prepStation, roundNumber }) as POSOrderItem;

  it("the stations with something new, each once, in the menu's order; none when a line doesn't say", () => {
    expect(unsentStations({ status: "OPEN", items: [at("ADDED", "BAR"), at("ADDED", "GENERAL"), at("ADDED", "BAR")] })).toEqual(["GENERAL", "BAR"]);
    expect(unsentStations({ status: "SERVED", items: [at("SENT", "GENERAL", 1), at("ADDED", "BAR")], roundsSent: 1 })).toEqual(["BAR"]);
    expect(unsentStations({ status: "SERVED", items: [at("SENT", "BAR", 1)], roundsSent: 1 })).toEqual([]);
    // A Yetu that doesn't say where a line is made: the till can't choose for it.
    expect(unsentStations({ status: "OPEN", items: [at("ADDED", "BAR"), at("ADDED")] })).toBeNull();
  });

  it("names the station it prints for, as staff say it", () => {
    expect(stationPrintWords("BAR")).toBe("Print for bar");
    expect(stationPrintWords("GENERAL")).toBe("Print for kitchen");
    expect(stationPrintWords("HOT")).toBe("Print for hot kitchen");
  });

  it("the print button: one station by name, several as the order, nothing new as again", () => {
    expect(printWords({ status: "OPEN", items: [at("ADDED", "BAR"), at("ADDED", "BAR")] })).toBe("Print for bar");
    expect(printWords({ status: "OPEN", items: [at("ADDED", "BAR"), at("ADDED", "GRILL")] })).toBe("Print order");
    expect(printWords({ status: "OPEN", items: [at("ADDED")] })).toBe("Print order");
    expect(printWords({ status: "SERVED", items: [at("SENT", "BAR", 1)], roundsSent: 1 })).toBe("Print again");
    expect(printWords(null)).toBe("Print order");
  });
});


describe("Direct hand-over rounds", () => {
  const direct = { ...line("ADDED"), fulfilment: "DIRECT" as const };
  it("only a nonempty round of explicit Direct new lines skips production paper", () => {
    expect(directOnlyUnsent({status:"OPEN",items:[direct]})).toBe(true);
    expect(directOnlyUnsent({status:"OPEN",items:[]})).toBe(false);
    expect(directOnlyUnsent(null)).toBe(false);
    expect(directOnlyUnsent({status:"OPEN",items:[line("ADDED")]})).toBe(false);
    expect(directOnlyUnsent({status:"OPEN",items:[direct,{...line("ADDED"),fulfilment:"PICKED"}]})).toBe(false);
    expect(directOnlyUnsent({status:"OPEN",items:[{...direct,status:"SENT"}]})).toBe(false);
    expect(directOnlyUnsent({status:"OPEN",items:[direct,line("SENT")]})).toBe(true);
    expect(printWords({status:"OPEN",items:[direct]})).toBe("Send order");
  });
  it("Direct lines do not add stations to a mixed production round", () => {
    expect(unsentStations({status:"OPEN",items:[direct,{...line("ADDED"),prepStation:"BAR",fulfilment:"PICKED"}]})).toEqual(["BAR"]);
  });
});
