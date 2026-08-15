import { createApiClient } from "./api";
import { devIdentityFromEnv } from "./env";

export type ApiClient = ReturnType<typeof createApiClient>;
export type PosOrderResponse =
  import("@peak/hospitality-api-client").components["schemas"]["PosOrderResponse"];
export type PosSessionResponse =
  import("@peak/hospitality-api-client").components["schemas"]["PosSessionResponse"];
export type KitchenTicketResponse =
  import("@peak/hospitality-api-client").components["schemas"]["KitchenTicketResponse"];
export type PaymentProviderAccountResponse =
  import("@peak/hospitality-api-client").components["schemas"]["PaymentProviderAccountResponse"];
export type RoomResponse =
  import("@peak/hospitality-api-client").components["schemas"]["RoomResponse"];
export type ReservationResponse =
  import("@peak/hospitality-api-client").components["schemas"]["ReservationResponse"];
export type FolioResponse =
  import("@peak/hospitality-api-client").components["schemas"]["FolioResponse"];

export type TicketAction = "prepare" | "ready" | "deliver" | "void";
export type SettleMethod = "cash" | "room_charge" | "mobile_money";

/**
 * Peak settles every POS mutation under an `Idempotency-Key` header (the
 * reliability module rejects unsafe commands without it). A fresh key per
 * command attempt is correct: reusing a key for a different command is a
 * conflict, and a retry of the same command is the server's own replay path.
 */
function idempotencyHeader(): Record<string, string> {
  return { "Idempotency-Key": crypto.randomUUID() };
}

/**
 * The generated client schema lags Peak's `SettlePosOrderRequest` (it omits
 * `roomNumber`). Peak validates the room the waiter heard against the folio's
 * checked-in stay, so the client MUST send it for a room charge. The schema
 * gap is bridged here and documented until the artifact is regenerated.
 */
type SettlePosOrderBody = {
  paymentMethod: string;
  folioId?: string;
  roomNumber?: string;
  providerAccountId?: string;
  phoneNumber?: string;
};

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
        headers: idempotencyHeader(),
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
        specialRequest?: string;
      },
    ) {
      return client.POST("/api/v1/properties/{propertyId}/pos-orders/{orderId}/items", {
        params: { path: { propertyId, orderId } },
        headers: idempotencyHeader(),
        body: {
          menuItemId: body.menuItemId,
          quantity: body.quantity,
          specialRequest: body.specialRequest,
          clientOperationId: crypto.randomUUID(),
        },
      });
    },
    sendOrder(propertyId: string, orderId: string) {
      return client.POST("/api/v1/properties/{propertyId}/pos-orders/{orderId}/send", {
        params: { path: { propertyId, orderId } },
        headers: idempotencyHeader(),
        body: { clientOperationId: crypto.randomUUID() },
      });
    },
    settleOrder(
      propertyId: string,
      orderId: string,
      body: SettlePosOrderBody,
    ) {
      return client.POST("/api/v1/properties/{propertyId}/pos-orders/{orderId}/settle", {
        params: { path: { propertyId, orderId } },
        headers: idempotencyHeader(),
        body: {
          paymentMethod: body.paymentMethod,
          folioId: body.folioId,
          roomNumber: body.roomNumber,
          providerAccountId: body.providerAccountId,
          phoneNumber: body.phoneNumber,
        } as never,
      });
    },
    voidOrderItem(
      propertyId: string,
      orderId: string,
      itemId: string,
      body: { disposition?: "RETURN_TO_STOCK" | "WASTE"; reason: string },
    ) {
      return client.POST(
        "/api/v1/properties/{propertyId}/pos-orders/{orderId}/items/{itemId}/void",
        {
          params: { path: { propertyId, orderId, itemId } },
          headers: idempotencyHeader(),
          body: { disposition: body.disposition, reason: body.reason },
        },
      );
    },
    openSession(propertyId: string, outletId: string, openingFloat: number) {
      return client.POST("/api/v1/properties/{propertyId}/pos-sessions/open", {
        params: { path: { propertyId } },
        headers: idempotencyHeader(),
        body: {
          outletId,
          openingFloat,
        },
      });
    },
    getSession(propertyId: string, sessionId: string) {
      return client.GET("/api/v1/properties/{propertyId}/pos-sessions/{sessionId}", {
        params: { path: { propertyId, sessionId } },
      });
    },
    closeSession(propertyId: string, sessionId: string, actualCash?: number) {
      return client.POST(
        "/api/v1/properties/{propertyId}/pos-sessions/{sessionId}/close",
        {
          params: { path: { propertyId, sessionId } },
          headers: idempotencyHeader(),
          body: actualCash === undefined ? {} : { actualCash },
        },
      );
    },
    listKitchenTickets(propertyId: string) {
      return client.GET("/api/v1/properties/{propertyId}/kitchen-tickets", {
        params: { path: { propertyId } },
      });
    },
    transitionTicket(
      propertyId: string,
      ticketId: string,
      action: TicketAction,
      reason?: string,
    ) {
      if (action === "void") {
        return client.POST(
          "/api/v1/properties/{propertyId}/kitchen-tickets/{ticketId}/void",
          {
            params: { path: { propertyId, ticketId } },
            headers: idempotencyHeader(),
            body: { reason: reason ?? "" },
          },
        );
      }
      return client.POST(
        `/api/v1/properties/{propertyId}/kitchen-tickets/{ticketId}/${action}`,
        {
          params: { path: { propertyId, ticketId } },
          headers: idempotencyHeader(),
          body: undefined as never,
        },
      );
    },
    listProviderAccounts(propertyId: string) {
      return client.GET("/api/v1/properties/{propertyId}/payments/provider-accounts", {
        params: { path: { propertyId } },
      });
    },
    listRooms(propertyId: string) {
      return client.GET("/api/v1/properties/{propertyId}/rooms", {
        params: { path: { propertyId } },
      });
    },
    listReservations(propertyId: string) {
      return client.GET("/api/v1/properties/{propertyId}/reservations", {
        params: { path: { propertyId } },
      });
    },
    listFolios(propertyId: string) {
      return client.GET("/api/v1/properties/{propertyId}/folios", {
        params: { path: { propertyId } },
      });
    },
    identity,
  };
}

export type PosApi = ReturnType<typeof createPosApi>;