import { describe, expect, it } from "vitest";
import { destinationOf } from "./subscriptions";

describe("Go POS topic mapping", () => {
  it("maps outlet and order subscriptions to the bounded server vocabulary", () => {
    expect(destinationOf({ kind: "outletOrders", outletId: "o1" })).toBe("pos.outlet.o1");
    expect(destinationOf({ kind: "outletKitchen", outletId: "o1" })).toBe("pos.outlet.o1");
    expect(destinationOf({ kind: "order", orderId: "r1" })).toBe("pos.order.r1");
  });
  it("does not invent unsupported property/payment topics", () => {
    expect(destinationOf({ kind: "propertyOperations", propertyId: "p1" })).toBeNull();
    expect(destinationOf({ kind: "payment", paymentTransactionId: "x" })).toBeNull();
  });
});
