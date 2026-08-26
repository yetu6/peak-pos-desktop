import type { RealtimeEnvelope } from "./RealtimeEnvelope";

/**
 * The destinations a client may subscribe to. The tenant is never part of a
 * scoped destination — the backend derives it from the authenticated session.
 */
export type SubscriptionTarget =
  | { kind: "propertyOperations"; propertyId: string }
  | { kind: "outletOrders"; outletId: string }
  | { kind: "outletKitchen"; outletId: string }
  | { kind: "order"; orderId: string }
  | { kind: "payment"; paymentTransactionId: string };

export function destinationOf(target: SubscriptionTarget): string | null {
  switch (target.kind) {
    case "propertyOperations":
      return null;
    case "outletOrders":
      return `pos.outlet.${target.outletId}`;
    case "outletKitchen":
      return `pos.outlet.${target.outletId}`;
    case "order":
      return `pos.order.${target.orderId}`;
    case "payment":
      return null;
  }
}

export function isKitchenEvent(type: string): boolean {
  return ["pos.order.sent", "pos.order.preparing", "pos.order.ready", "pos.order.served"].includes(type);
}

export function isOrderEvent(type: string): boolean {
  return type.startsWith("pos.order.");
}

export function isPaymentEvent(type: string): boolean {
  return type.startsWith("payment.");
}

/**
 * Determines which TanStack Query keys an event invalidates. Returns null for
 * events with no cache consequence.
 */
export function queryKeyForEvent(
  event: RealtimeEnvelope,
): (string | unknown)[][] | null {
  if (event.aggregateType === "POS_ORDER" && isOrderEvent(event.type)) {
    const keys: (string | unknown)[][] = [
      ["orders"],
      event.aggregateId ? ["orders", "detail", event.aggregateId] : [],
      event.outletId ? ["outlets", event.outletId, "orders"] : [],
    ];
    if (isKitchenEvent(event.type)) keys.push(["kitchen"]);
    return keys;
  }
  if (event.aggregateType === "KITCHEN_TICKET" && isKitchenEvent(event.type)) {
    return [
      ["kitchen", "tickets"],
      event.outletId ? ["outlets", event.outletId, "kitchen"] : [],
      event.aggregateId ? ["kitchen", "tickets", "detail", event.aggregateId] : [],
    ];
  }
  if (event.aggregateType === "PAYMENT_TRANSACTION" && isPaymentEvent(event.type)) {
    return [
      ["payments"],
      event.aggregateId ? ["payments", "detail", event.aggregateId] : [],
      event.payload.orderId ? ["orders"] : [],
    ];
  }
  return null;
}
