import type { POSOrder, POSOrderItem, POSReceipt, POSStationTicket, PrepStation } from "../lib/posContracts";
import { CURRENCY, line, ORDER, order, PRODUCTS } from "./registerData";

/**
 * The Orders and Kitchen fixtures' data in the backend's shapes, built the
 * way Yetu builds it: each order's figures from its own lines (registerData's
 * line and order), its station tickets from its sent lines (one per station,
 * made when it was sent), and a paid order's receipt from the order itself.
 * The screens are seen at 14:32 on Mon 12 Oct, the shell's clock.
 */

/** The moment the fixtures are seen: the shell's clock, 14:32. */
export const FIXTURE_NOW = new Date(2026, 9, 12, 14, 32).getTime();
export const BUSINESS_DATE = "2026-10-12";
export const SHIFT_ID = "shift-1";

const at = (secondsBefore: number) => new Date(FIXTURE_NOW - secondsBefore * 1000).toISOString();

/** Where each item is made (a product's prep station in Yetu): drinks at the bar, food at the grill. */
const STATION_OF: Readonly<Record<string, PrepStation>> = {
  capp: "BAR",
  flat: "BAR",
  spiced: "BAR",
  tusker: "BAR",
  juice: "BAR",
  water: "BAR",
};

function made(productId: string, quantity: number, options: Array<[string, string]> = []): POSOrderItem {
  return { ...line(productId, quantity, options, "SENT"), prepStation: STATION_OF[productId] ?? "GRILL" };
}

function sentOrder(id: string, number: string, items: POSOrderItem[], extra: Partial<POSOrder>): POSOrder {
  return order(
    items.map((item) => ({ ...item, id: `${id}-${item.id}` })),
    { id, orderNumber: number, shiftId: SHIFT_ID, ...extra },
  );
}

/** 0141: room service for room 204, two stations, sent 12 minutes ago, the grill cooking. */
export const ROOM_ORDER = sentOrder("order-141", "0141", [made("chicken", 1), made("juice", 2)], {
  status: "PREPARING",
  serviceType: "ROOM_SERVICE",
  tableLabel: "204",
  initiatedById: "staff-juma",
  initiatedByName: "Juma Ally",
  notes: "Guest has a nut allergy",
  version: 6,
});

/** 0140: takeaway, ready, TSh 10,000 paid in cash so far. */
export const TAKEAWAY_ORDER = sentOrder("order-140", "0140", [made("curry", 1), made("burger", 1, [["Cooked", "Well done"], ["Extras", "Fried egg"]])], {
  status: "READY",
  serviceType: "TAKEAWAY",
  tableLabel: undefined,
  initiatedById: "staff-grace",
  initiatedByName: "Grace Mushi",
  paidMinor: 1_000_000,
  version: 7,
});

/** 0143: table 4, sent 15 seconds ago, nobody has started it. */
export const NEW_ORDER = sentOrder("order-143", "0143", [made("breakfast", 2), made("flat", 2)], {
  status: "SENT",
  tableLabel: "4",
  version: 3,
});

/** 0138: table 7, sent 18 minutes ago and still waiting. */
export const LATE_ORDER = sentOrder("order-138", "0138", [made("nyama", 2), made("tusker", 3)], {
  status: "SENT",
  tableLabel: "7",
  initiatedById: "staff-juma",
  initiatedByName: "Juma Ally",
  version: 3,
});

/** 0137: table 9, served, nothing paid yet. */
export const SERVED_ORDER = sentOrder("order-137", "0137", [made("chicken", 2), made("water", 2)], {
  status: "SERVED",
  tableLabel: "9",
  version: 9,
});

/** When each sent order was sent, in seconds before the fixtures' moment. */
const SENT_SECONDS_AGO: Readonly<Record<string, number>> = {
  "order-143": 15,
  "order-141": 12 * 60,
  "order-140": 4 * 60,
  "order-138": 18 * 60,
};

/** Each station's step for a sent order (one ticket per station, as Yetu makes them). */
const STATION_STEP: Readonly<Record<string, Partial<Record<PrepStation, POSStationTicket["status"]>>>> = {
  "order-141": { GRILL: "PREPARING", BAR: "READY" },
  "order-140": { GRILL: "READY" },
};

function ticketsFor(sent: POSOrder): POSStationTicket[] {
  const stations = [...new Set(sent.items.map((item) => item.prepStation ?? "GENERAL"))];
  return stations.map((station) => ({
    id: `${sent.id}-${station.toLowerCase()}`,
    orderId: sent.id,
    orderNumber: sent.orderNumber,
    station,
    status: STATION_STEP[sent.id]?.[station] ?? (sent.status === "SENT" ? "SENT" : (sent.status as POSStationTicket["status"])),
    serviceType: sent.serviceType,
    tableLabel: sent.tableLabel,
    notes: sent.notes,
    waiterName: sent.initiatedByName,
    version: 2,
    createdAt: at(SENT_SECONDS_AGO[sent.id] ?? 0),
    items: sent.items.filter((item) => (item.prepStation ?? "GENERAL") === station),
  }));
}

/** The open orders, as Yetu lists them (oldest first). */
export const OPEN_ORDERS: POSOrder[] = [SERVED_ORDER, LATE_ORDER, TAKEAWAY_ORDER, ROOM_ORDER, ORDER, NEW_ORDER];

/** The station tickets still in the kitchen (served ones leave Yetu's active list). */
export const STATION_TICKETS: POSStationTicket[] = [LATE_ORDER, TAKEAWAY_ORDER, ROOM_ORDER, NEW_ORDER].flatMap(ticketsFor);

/** 0136 and 0135: paid on this shift, the latest first. */
export const PAID_ORDERS: POSOrder[] = [
  sentOrder("order-136", "0136", [made("capp", 2), made("tart", 1)], { status: "CLOSED", tableLabel: "3", version: 8 }),
  sentOrder("order-135", "0135", [made("nyama", 1), made("tusker", 2)], {
    status: "CLOSED",
    serviceType: "ROOM_SERVICE",
    tableLabel: "112",
    initiatedById: "staff-juma",
    initiatedByName: "Juma Ally",
    version: 6,
  }),
].map((paid) => ({ ...paid, paidMinor: paid.totalMinor, remainingMinor: 0 }));

/** The receipt Yetu kept for paid order 0136: taken in cash by Grace, printed again once. */
export const PAID_RECEIPT: POSReceipt = (() => {
  const paid = PAID_ORDERS[0];
  return {
    id: "receipt-136",
    orderId: paid.id,
    status: "PRINTED",
    reprintCount: 1,
    createdAt: at(9 * 60),
    document: {
      orderId: paid.id,
      orderNumber: paid.orderNumber,
      businessDate: BUSINESS_DATE,
      propertyName: "Jacaranda Lodge",
      outletId: "o",
      outletName: "Main Restaurant",
      terminalId: "t",
      initiatedById: paid.initiatedById,
      initiatedByName: paid.initiatedByName,
      operatorId: "staff-grace",
      operatorName: "Grace Mushi",
      serviceType: paid.serviceType,
      tableLabel: paid.tableLabel,
      items: paid.items.map(({ name, quantity, unitPriceMinor, taxMinor, totalMinor, modifiers }) => ({
        name,
        quantity,
        unitPriceMinor,
        taxMinor,
        totalMinor,
        ...(modifiers ? { modifiers } : {}),
      })),
      subtotalMinor: paid.subtotalMinor,
      taxMinor: paid.taxMinor,
      totalMinor: paid.totalMinor,
      currency: CURRENCY,
      tenderMethod: "CASH",
      settledAt: at(9 * 60),
    },
  };
})();

/** A long order for the busy kitchen: every item on the menu, so the ticket is taller than its column. */
export const LONG_ORDER = sentOrder(
  "order-144",
  "0144",
  PRODUCTS.filter((product) => product.isAvailable && !product.modifierGroups?.length).map((product) => made(product.id, 1)),
  { status: "SENT", tableLabel: "15", version: 2 },
);

export const LONG_TICKETS: POSStationTicket[] = ticketsFor(LONG_ORDER).map((ticket) => ({ ...ticket, createdAt: at(6 * 60) }));
