import { describe, expect, it } from "vitest";
import type { POSOrder, POSOrderItem, POSStationTicket } from "../lib/posContracts";
import { boardColumns, sentTimesByOrder, ticketsFromOrders, ticketsFromStations } from "./kitchenTickets";

const NOW = Date.now();
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

function item(id: string, name: string, status: POSOrderItem["status"] = "SENT"): POSOrderItem {
  return { id, productId: `p-${id}`, name, quantity: 1, unitPriceMinor: 100_000, taxMinor: 18_000, totalMinor: 118_000, status };
}

function order(id: string, status: POSOrder["status"], extra: Partial<POSOrder> = {}): POSOrder {
  return {
    id,
    shiftId: "shift-1",
    orderNumber: id.replace("order-", "0"),
    dailyNumber: Number(id.replace(/\D/g, "")) || 1,
    createdAt: new Date(Date.now() - 30 * 60_000).toISOString(),
    closedAt: null,
    payments: [],
    status,
    serviceType: "DINE_IN",
    tableLabel: "4",
    initiatedById: "staff-1",
    initiatedByName: "Amina Hassan",
    subtotalMinor: 100_000,
    discountMinor: 0,
    discountKind: "NONE",
    discountInput: 0,
    taxMinor: 18_000,
    totalMinor: 118_000,
    paidMinor: 0,
    remainingMinor: 118_000,
    version: 3,
    items: [item(`${id}-a`, "Chips")],
    ...extra,
  };
}

function ticket(id: string, orderId: string, status: POSStationTicket["status"], createdAt: string, station: POSStationTicket["station"] = "GENERAL"): POSStationTicket {
  return {
    id,
    orderId,
    orderNumber: orderId.replace("order-", "0"),
    dailyNumber: Number(orderId.replace(/\D/g, "")) || 1,
    station,
    status,
    serviceType: "DINE_IN",
    tableLabel: "4",
    waiterName: "Amina Hassan",
    version: 2,
    createdAt,
    lastStepAt: createdAt,
    items: [item(`${id}-a`, "Chips")],
  };
}

describe("sentTimesByOrder", () => {
  it("takes when an order was sent from its earliest kitchen ticket (Yetu makes them when it is sent)", () => {
    const sent = sentTimesByOrder([
      ticket("t-2", "order-1", "SENT", ago(3), "BAR"),
      ticket("t-1", "order-1", "PREPARING", ago(5), "GRILL"),
      ticket("t-4", "order-1", "SENT", ago(4), "PASTRY"),
      ticket("t-3", "order-2", "READY", ago(9)),
    ]);
    expect(sent.get("order-1")).toBe(ago(5));
    expect(sent.get("order-2")).toBe(ago(9));
    expect(sent.has("order-3")).toBe(false);
  });
});

describe("ticketsFromOrders (a selling till moves whole orders)", () => {
  it("shows orders in the kitchen's steps, with the time sent when Yetu has it, and never an open, served or paid one", () => {
    const tickets = ticketsFromOrders(
      [
        order("order-1", "OPEN"),
        order("order-2", "SENT"),
        order("order-3", "PREPARING", { notes: "No onions" }),
        order("order-4", "READY"),
        order("order-5", "SERVED"),
        order("order-6", "CLOSED"),
        order("order-7", "VOIDED"),
      ],
      [ticket("t-2", "order-2", "SENT", ago(2))],
    );
    expect(tickets.map((entry) => [entry.id, entry.status])).toEqual([
      ["order-2", "SENT"],
      ["order-3", "PREPARING"],
      ["order-4", "READY"],
    ]);
    expect(tickets[0]).toMatchObject({ kind: "order", orderNumber: "02", version: 3, sentAt: ago(2), staffName: "Amina Hassan" });
    expect(tickets[1].sentAt).toBeUndefined();
    expect(tickets[1].notes).toBe("No onions");
  });

  it("leaves voided lines off the ticket", () => {
    const [entry] = ticketsFromOrders([order("order-2", "SENT", { items: [item("a", "Chips"), item("b", "Tea", "VOIDED")] })], []);
    expect(entry.items.map((line) => line.name)).toEqual(["Chips"]);
  });
});

describe("ticketsFromStations (a kitchen or bar display moves its own station's ticket)", () => {
  it("shows the station tickets still in the kitchen, sent at the time Yetu made them", () => {
    const tickets = ticketsFromStations([
      ticket("t-1", "order-1", "SENT", ago(1), "GRILL"),
      ticket("t-2", "order-2", "SERVED", ago(20)),
      ticket("t-3", "order-3", "READY", ago(7), "BAR"),
    ]);
    expect(tickets.map((entry) => [entry.id, entry.status, entry.station, entry.sentAt])).toEqual([
      ["t-1", "SENT", "GRILL", ago(1)],
      ["t-3", "READY", "BAR", ago(7)],
    ]);
    expect(tickets[0]).toMatchObject({ kind: "station", orderNumber: "01", version: 2, staffName: "Amina Hassan" });
  });
});

describe("boardColumns", () => {
  it("puts each ticket in its step's column, oldest first as Yetu lists them, with counts", () => {
    const tickets = ticketsFromStations([
      ticket("t-1", "order-1", "PREPARING", ago(9)),
      ticket("t-2", "order-2", "SENT", ago(6)),
      ticket("t-3", "order-3", "SENT", ago(2)),
    ]);
    const columns = boardColumns(tickets);
    expect(columns.map((column) => [column.status, column.title, column.tickets.map((entry) => entry.id)])).toEqual([
      ["SENT", "New", ["t-2", "t-3"]],
      ["PREPARING", "Preparing", ["t-1"]],
      ["READY", "Ready", []],
    ]);
  });
});
