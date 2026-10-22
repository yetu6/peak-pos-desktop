import { describe, expect, it } from "vitest";
import { PAPER_58MM, PAPER_80MM, readable } from "./escpos";
import { kitchenTicketBytes, type KitchenTicketPaper } from "./kitchenTicket";

const TICKET: KitchenTicketPaper = {
  dailyNumber: 42,
  roundNumber: 2,
  station: "HOT",
  serviceType: "DINE_IN",
  label: "12",
  waiterName: "Amina Hassan",
  sentByName: "Juma Said",
  sentAt: "2026-10-19T09:40:00Z",
  notes: "Guest is in a hurry",
  lines: [
    { quantity: 2, name: "Nyama choma", options: ["Well done", "Extra kachumbari"], tags: "Halal" },
    { quantity: 1, name: "Satay", options: [], tags: "Contains nuts · Spicy" },
  ],
};

describe("kitchen ticket on paper (S8a)", () => {
  it("says the order large, its round, the station, where it goes and who took it", () => {
    const text = readable(kitchenTicketBytes(TICKET, PAPER_58MM));
    const lines = text.split("\n");
    // The paper's title first (2026-10-20): an order to make, and where.
    expect(lines.slice(0, 3)).toEqual(["KITCHEN ORDER", "ORDER 42 - ROUND 2 - ADDED", "Hot kitchen"]);
    expect(text).toContain("Table 12 - Dine in");
    expect(text).toContain("Taken by Amina Hassan");
    expect(text).toContain("Sent by Juma Said");
    expect(text).not.toContain("TSh");
  });

  it("lists each line with its options and staff's tags, and the note", () => {
    const text = readable(kitchenTicketBytes(TICKET, PAPER_80MM));
    expect(text).toContain("2 x Nyama choma\n   - Well done\n   - Extra kachumbari\n   ! Halal\n");
    expect(text).toContain("1 x Satay\n   ! Contains nuts - Spicy\n");
    expect(text).toContain("NOTE\nGuest is in a hurry\n");
  });

  it("large type for the number and the waiter; a cut at the end", () => {
    const bytes = Array.from(kitchenTicketBytes(TICKET, PAPER_58MM));
    const at = (needle: number[]) => bytes.findIndex((_, i) => needle.every((b, j) => bytes[i + j] === b));
    expect(at([0x1d, 0x21, 0x01])).toBeLessThan(at(Array.from(new TextEncoder().encode("KITCHEN ORDER")))); // double size before "ORDER"
    expect(bytes.slice(-4)).toEqual([0x1d, 0x56, 0x42, 3]);
  });

  it("a ticket printed again says COPY; round 1 and the waiter's own send say nothing more", () => {
    const again = readable(kitchenTicketBytes({ ...TICKET, copy: true, roundNumber: 1, sentByName: "Amina Hassan" }, PAPER_58MM));
    expect(again).toContain("*** COPY: printed again ***");
    expect(readable(kitchenTicketBytes({ ...TICKET, copy: true, printedAgainByName: "Grace Mushi" }, PAPER_58MM))).toContain("by Grace Mushi");
    expect(again).toContain("ROUND 1");
    expect(again).not.toContain("ADDED");
    expect(again).not.toContain("Sent by");
  });

  it("every line fits the paper", () => {
    for (const width of [PAPER_58MM, PAPER_80MM]) {
      const long = { ...TICKET, lines: [{ quantity: 1, name: "Grilled tilapia with coconut rice and a very long side", options: [], tags: undefined }] };
      for (const line of readable(kitchenTicketBytes(long, width)).split("\n")) expect(line.length).toBeLessThanOrEqual(width);
    }
  });
});

it.each([PAPER_58MM, PAPER_80MM])("keeps a short name and optional guests without inventing a table at width %s", (width) => {
  const text = readable(kitchenTicketBytes({ ...TICKET, askForTable: false, guestCount: 3 }, width));
  expect(text).toContain("12 - Dine in");
  expect(text).not.toContain("Table 12");
  expect(text).toContain("Guests: 3");
  const absent = readable(kitchenTicketBytes({ ...TICKET, label: undefined, guestCount: undefined }, width));
  expect(absent).not.toContain("Guests:");
  expect(absent).not.toContain("Table");
});
