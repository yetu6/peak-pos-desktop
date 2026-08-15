import { createApiClient } from "./api";
import { devIdentityFromEnv } from "./env";

export type ApiClient = ReturnType<typeof createApiClient>;
export type PosOrderResponse =
  import("@peak/hospitality-api-client").components["schemas"]["PosOrderResponse"];
export type KitchenTicketResponse =
  import("@peak/hospitality-api-client").components["schemas"]["KitchenTicketResponse"];

export type TicketAction = "prepare" | "ready" | "deliver" | "void";

export function createPosApi() {
  const client = createApiClient();
  const identity = devIdentityFromEnv();
  return {
    client,
    getOrder(propertyId: string, orderId: string) {
      return client.GET("/api/v1/properties/{propertyId}/pos-orders/{orderId}", {
        params: { path: { propertyId, orderId } },
      });
    },
    createOrder(
      propertyId: string,
      body: {
        sessionId: string;
        orderType: string;
        tableNumber?: string;
      },
    ) {
      return client.POST("/api/v1/properties/{propertyId}/pos-orders", {
        params: { path: { propertyId } },
        body: {
          sessionId: body.sessionId,
          orderType: body.orderType,
          tableNumber: body.tableNumber,
          clientOperationId: crypto.randomUUID(),
        },
      });
    },
    addItem(
      propertyId: string,
      orderId: string,
      body: {
        menuItemId: string;
        quantity: number;
      },
    ) {
      return client.POST("/api/v1/properties/{propertyId}/pos-orders/{orderId}/items", {
        params: { path: { propertyId, orderId } },
        body: {
          menuItemId: body.menuItemId,
          quantity: body.quantity,
          clientOperationId: crypto.randomUUID(),
        },
      });
    },
    sendOrder(propertyId: string, orderId: string) {
      return client.POST("/api/v1/properties/{propertyId}/pos-orders/{orderId}/send", {
        params: { path: { propertyId, orderId } },
        body: { clientOperationId: crypto.randomUUID() },
      });
    },
    settleOrder(
      propertyId: string,
      orderId: string,
      body: {
        paymentMethod: string;
        roomNumber?: string;
        phoneNumber?: string;
      },
    ) {
      return client.POST("/api/v1/properties/{propertyId}/pos-orders/{orderId}/settle", {
        params: { path: { propertyId, orderId } },
        body: {
          paymentMethod: body.paymentMethod,
          roomNumber: body.roomNumber,
          phoneNumber: body.phoneNumber,
        },
      });
    },
    listKitchenTickets(propertyId: string) {
      return client.GET("/api/v1/properties/{propertyId}/kitchen-tickets", {
        params: { path: { propertyId } },
      });
    },
    transitionTicket(propertyId: string, ticketId: string, action: TicketAction) {
      return client.POST(
        `/api/v1/properties/{propertyId}/kitchen-tickets/{ticketId}/${action}`,
        {
          params: { path: { propertyId, ticketId } },
          body: undefined as never,
        },
      );
    },
    openSession(propertyId: string, outletId: string, openingFloat: number) {
      return client.POST("/api/v1/properties/{propertyId}/pos-sessions/open", {
        params: { path: { propertyId } },
        body: {
          outletId,
          openingFloat,
          clientOperationId: crypto.randomUUID(),
          operatorId: identity.userId,
        },
      });
    },
  };
}

export type PosApi = ReturnType<typeof createPosApi>;