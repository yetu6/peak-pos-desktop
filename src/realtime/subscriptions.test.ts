import { describe, expect, it } from "vitest";
import { destinationOf, queryKeyForEvent, type SubscriptionTarget } from "./subscriptions";
import type { RealtimeEnvelope } from "./RealtimeEnvelope";

function envelope(overrides: Partial<RealtimeEnvelope>): RealtimeEnvelope {
  return {
    sequenceId: 1,
    eventId: "evt-1",
    type: "pos.order.created",
    schemaVersion: 1,
    aggregateType: "POS_ORDER",
    aggregateId: "order-1",
    aggregateVersion: 1,
    occurredAt: "2026-08-15T00:00:00Z",
    tenantId: "tenant-1",
    propertyId: "property-1",
    outletId: "outlet-1",
    payload: {},
    ...overrides,
  };
}

describe("destinationOf", () => {
  const cases: Array<[SubscriptionTarget, string]> = [
    [{ kind: "propertyOperations", propertyId: "p1" }, "/topic/properties/p1/operations"],
    [{ kind: "outletOrders", outletId: "o1" }, "/topic/outlets/o1/orders"],
    [{ kind: "outletKitchen", outletId: "o1" }, "/topic/outlets/o1/kitchen"],
    [{ kind: "order", orderId: "ord-1" }, "/topic/orders/ord-1"],
    [{ kind: "payment", paymentTransactionId: "pay-1" }, "/topic/payments/pay-1"],
  ];
  it.each(cases)("maps %j to %s", (target, expected) => {
    expect(destinationOf(target)).toBe(expected);
  });
});

describe("queryKeyForEvent", () => {
  it("invalidates order caches for order events", () => {
    const keys = queryKeyForEvent(envelope({}));
    expect(keys).toContainEqual(["orders"]);
    expect(keys).toContainEqual(["orders", "detail", "order-1"]);
    expect(keys).toContainEqual(["outlets", "outlet-1", "orders"]);
  });

  it("invalidates kitchen caches for kitchen ticket events", () => {
    const keys = queryKeyForEvent(
      envelope({ type: "pos.kitchen_ticket.created", aggregateType: "KITCHEN_TICKET" }),
    );
    expect(keys).toContainEqual(["kitchen", "tickets"]);
    expect(keys).toContainEqual(["kitchen", "tickets", "detail", "order-1"]);
  });

  it("invalidates orders when a payment references an order", () => {
    const keys = queryKeyForEvent(
      envelope({
        type: "payment.succeeded",
        aggregateType: "PAYMENT_TRANSACTION",
        payload: { orderId: "order-9" },
      }),
    );
    expect(keys).toContainEqual(["orders"]);
    expect(keys).toContainEqual(["payments", "detail", "order-1"]);
  });

  it("returns null for unrelated events", () => {
    expect(queryKeyForEvent(envelope({ type: "user.login", aggregateType: "USER" }))).toBeNull();
  });
});