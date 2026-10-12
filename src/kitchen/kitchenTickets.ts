/**
 * What the kitchen board shows, shaped from what Yetu sends.
 *
 * A kitchen or bar display moves its station's own tickets
 * (GET /pos/station-tickets, POST /pos/station-tickets/{id}/status/{s}); a
 * selling till moves whole orders (GET /pos/orders?active=true,
 * POST /pos/orders/{id}/status/{s}). Either way the steps are Yetu's:
 * New (SENT), Preparing, Ready, then Served, which leaves the board.
 *
 * The time a ticket was sent is the time Yetu made its station ticket (it
 * makes them when an order is sent). An order carries no time of its own, so
 * a selling till takes it from the order's earliest station ticket, and says
 * so when there is none rather than guess.
 */
import type { OrderStatus, POSOrder, POSOrderItem, POSStationTicket, ServiceType } from "../lib/posContracts";

export type BoardStep = "SENT" | "PREPARING" | "READY";

export interface BoardTicket {
  /** What its next step moves: a station ticket's id, or an order's id on a selling till. */
  id: string;
  kind: "station" | "order";
  orderId: string;
  orderNumber: string;
  status: BoardStep;
  /** Yetu's version of what moves, echoed back with the step. */
  version: number;
  serviceType: ServiceType;
  tableLabel?: string;
  staffName?: string;
  notes?: string;
  station?: string;
  /** When it was sent, as Yetu wrote it; absent when Yetu gave no time. */
  sentAt?: string;
  items: POSOrderItem[];
}

const ON_BOARD: readonly string[] = ["SENT", "PREPARING", "READY"];

function onBoard(status: OrderStatus | POSStationTicket["status"]): status is BoardStep {
  return ON_BOARD.includes(status);
}

function stillMade(items: readonly POSOrderItem[]): POSOrderItem[] {
  return items.filter((line) => line.status !== "VOIDED");
}

/** Each order's sent time: its earliest station ticket's. */
export function sentTimesByOrder(tickets: readonly POSStationTicket[]): Map<string, string> {
  const sent = new Map<string, string>();
  for (const ticket of tickets) {
    const at = Date.parse(ticket.createdAt);
    if (!Number.isFinite(at)) continue;
    const known = sent.get(ticket.orderId);
    if (known === undefined || at < Date.parse(known)) sent.set(ticket.orderId, ticket.createdAt);
  }
  return sent;
}

export function ticketsFromOrders(orders: readonly POSOrder[], stationTickets: readonly POSStationTicket[]): BoardTicket[] {
  const sent = sentTimesByOrder(stationTickets);
  return orders.flatMap((order) => {
    const status = order.status;
    if (!onBoard(status)) return [];
    return [
      {
        id: order.id,
        kind: "order" as const,
        orderId: order.id,
        orderNumber: order.orderNumber,
        status,
        version: order.version,
        serviceType: order.serviceType,
        tableLabel: order.tableLabel,
        staffName: order.initiatedByName || undefined,
        notes: order.notes,
        sentAt: sent.get(order.id),
        items: stillMade(order.items),
      },
    ];
  });
}

export function ticketsFromStations(tickets: readonly POSStationTicket[]): BoardTicket[] {
  return tickets.flatMap((ticket) => {
    const status = ticket.status;
    if (!onBoard(status)) return [];
    return [
      {
        id: ticket.id,
        kind: "station" as const,
        orderId: ticket.orderId,
        orderNumber: ticket.orderNumber,
        status,
        version: ticket.version,
        serviceType: ticket.serviceType,
        tableLabel: ticket.tableLabel,
        staffName: ticket.waiterName || undefined,
        notes: ticket.notes,
        station: ticket.station,
        sentAt: ticket.createdAt,
        items: stillMade(ticket.items),
      },
    ];
  });
}

export interface BoardColumn {
  status: BoardStep;
  title: string;
  tickets: BoardTicket[];
}

const COLUMNS: ReadonlyArray<{ status: BoardStep; title: string }> = [
  { status: "SENT", title: "New" },
  { status: "PREPARING", title: "Preparing" },
  { status: "READY", title: "Ready" },
];

/** New, Preparing, Ready: each step's tickets in the order Yetu lists them (oldest first). */
export function boardColumns(tickets: readonly BoardTicket[]): BoardColumn[] {
  return COLUMNS.map((column) => ({ ...column, tickets: tickets.filter((ticket) => ticket.status === column.status) }));
}
