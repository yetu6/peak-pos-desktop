import { describe, expect, it } from "vitest";
import { ticketAge, isNewTicket } from "../kitchen/kitchenWords";
import type { POSOrder, POSStationTicket } from "../lib/posContracts";
import {
  FIXTURE_NOW,
  LATE_ORDER,
  LONG_ORDER,
  LONG_TICKETS,
  NEW_ORDER,
  OPEN_ORDERS,
  PAID_ORDERS,
  PAID_RECEIPT,
  ROOM_ORDER,
  SHIFT_ID,
  STATION_TICKETS,
  TAKEAWAY_ORDER,
} from "./ordersData";
import { expectYetuArithmetic } from "./yetuArithmetic";

const RANK: Record<POSStationTicket["status"], number> = { SENT: 0, PREPARING: 1, READY: 2, SERVED: 3 };

describe("the Orders and Kitchen fixtures' data", () => {
  it.each([...OPEN_ORDERS, ...PAID_ORDERS, LONG_ORDER].map((entry) => [entry.orderNumber, entry] as [string, POSOrder]))(
    "order %s adds up from its own lines",
    (_number, entry) => {
      expectYetuArithmetic(entry);
    },
  );

  it("numbers each order once, as Yetu writes numbers (POS- and eight letters and digits), all on this shift", () => {
    const all = [...OPEN_ORDERS, ...PAID_ORDERS, LONG_ORDER];
    expect(new Set(all.map((entry) => entry.orderNumber)).size).toBe(all.length);
    // fbc-peak operations.go CreateOrder: "POS-" + the first eight characters of a new UUID.
    for (const entry of all) expect(entry.orderNumber).toMatch(/^POS-[0-9a-f]{8}$/);
    expect(all.every((entry) => entry.shiftId === SHIFT_ID)).toBe(true);
  });

  it("gives each sent order one ticket per station it uses, holding exactly that station's lines", () => {
    for (const ticket of [...STATION_TICKETS, ...LONG_TICKETS]) {
      const owner = [...OPEN_ORDERS, LONG_ORDER].find((entry) => entry.id === ticket.orderId)!;
      expect(ticket.orderNumber).toBe(owner.orderNumber);
      expect([ticket.serviceType, ticket.tableLabel, ticket.waiterName]).toEqual([owner.serviceType, owner.tableLabel, owner.initiatedByName]);
      expect(ticket.items).toEqual(owner.items.filter((item) => item.prepStation === ticket.station));
    }
    for (const sent of [LATE_ORDER, TAKEAWAY_ORDER, ROOM_ORDER, NEW_ORDER]) {
      const stations = new Set(sent.items.map((item) => item.prepStation));
      expect(STATION_TICKETS.filter((ticket) => ticket.orderId === sent.id).map((ticket) => ticket.station).sort()).toEqual([...stations].sort());
    }
  });

  it("puts each sent order at its slowest station's step, as Yetu does", () => {
    for (const sent of [LATE_ORDER, TAKEAWAY_ORDER, ROOM_ORDER, NEW_ORDER]) {
      const slowest = Math.min(...STATION_TICKETS.filter((ticket) => ticket.orderId === sent.id).map((ticket) => RANK[ticket.status]));
      expect(RANK[sent.status as POSStationTicket["status"]], sent.orderNumber).toBe(slowest);
    }
  });

  it("is seen at the moments its notes say: one just sent, one getting late, one late", () => {
    const sentAt = (entry: POSOrder) => STATION_TICKETS.find((ticket) => ticket.orderId === entry.id)!.createdAt;
    expect(isNewTicket("SENT", sentAt(NEW_ORDER), FIXTURE_NOW)).toBe(true);
    expect(ticketAge(sentAt(ROOM_ORDER), FIXTURE_NOW).words).toBe("Getting late · 12 min");
    expect(ticketAge(sentAt(LATE_ORDER), FIXTURE_NOW).words).toBe("Late · 18 min");
  });

  it("has the part payment and the paid orders Yetu would: paid in full, or part with the rest to pay", () => {
    expect(TAKEAWAY_ORDER.paidMinor).toBeGreaterThan(0);
    expect(TAKEAWAY_ORDER.remainingMinor).toBe(TAKEAWAY_ORDER.totalMinor - TAKEAWAY_ORDER.paidMinor);
    for (const paid of PAID_ORDERS) {
      expect(paid.paidMinor).toBe(paid.totalMinor);
      expect(paid.remainingMinor).toBe(0);
    }
  });

  it("keeps the paid order's receipt as the order itself: its lines and totals", () => {
    const paid = PAID_ORDERS.find((entry) => entry.id === PAID_RECEIPT.orderId)!;
    const doc = PAID_RECEIPT.document;
    expect(doc.orderNumber).toBe(paid.orderNumber);
    expect(doc.items.map(({ name, quantity, totalMinor }) => [name, quantity, totalMinor])).toEqual(
      paid.items.map(({ name, quantity, totalMinor }) => [name, quantity, totalMinor]),
    );
    expect([doc.subtotalMinor, doc.taxMinor, doc.totalMinor]).toEqual([paid.subtotalMinor, paid.taxMinor, paid.totalMinor]);
  });
});
