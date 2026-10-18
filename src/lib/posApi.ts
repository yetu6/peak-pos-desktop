import { createApiClient, type ApiResult } from "./api";
import type {
  CashMovementType,
  DiscountKind,
  PaymentMethod,
  POSBusinessDayCloseResult,
  POSCashMovement,
  POSCatalog,
  POSOrder,
  POSOrderPage,
  POSOrderRefunds,
  POSKitchenReprint,
  POSReceipt,
  POSRefund,
  POSRefundQuote,
  POSRefundQuoteRequest,
  POSRefundRequest,
  POSRoomChargeCandidate,
  POSShift,
  POSStationTicket,
  POSTenderResult,
  ServiceType,
} from "./posContracts";

/**
 * Every operationId here is named after fbc-peak's OpenAPI operationId
 * (`api/openapi/peak.openapi.yaml`, tag POS, schema 86) so the two can be
 * diffed by eye. No endpoint is invented; nothing here predates R5/R5C.
 *
 * Idempotency keys are always supplied by the CALLER, not generated inside
 * this module. A caller that retries the same intended mutation (a network
 * timeout, a lost response) must pass the same key back in; only a genuinely
 * new business action mints a new one (see useIdempotentAction).
 */

function idempotent(key: string): Record<string, string> {
  return { "Idempotency-Key": key };
}

export function createPosApi() {
  const client = createApiClient();
  return {
    client,

    // ---- Catalog -----------------------------------------------------
    getCatalog(): Promise<ApiResult<POSCatalog>> {
      return client.GET<POSCatalog>("/api/v1/pos/catalog");
    },
    setProductAvailability(
      productId: string,
      isAvailable: boolean,
    ): Promise<ApiResult<void>> {
      return client.POST<void>(
        `/api/v1/pos/catalog/products/${encodeURIComponent(productId)}/availability`,
        { body: { isAvailable } },
      );
    },

    // ---- Shifts --------------------------------------------------------
    openShift(openingCashMinor: number, idempotencyKey: string): Promise<ApiResult<POSShift>> {
      return client.POST<POSShift>("/api/v1/pos/shifts", {
        headers: idempotent(idempotencyKey),
        body: { openingCashMinor },
      });
    },
    /** Resume an open (or variance-pending) shift after restart. 404 when none. */
    getCurrentShift(): Promise<ApiResult<POSShift>> {
      return client.GET<POSShift>("/api/v1/pos/shifts/current");
    },
    getShift(shiftId: string): Promise<ApiResult<POSShift>> {
      return client.GET<POSShift>(`/api/v1/pos/shifts/${encodeURIComponent(shiftId)}`);
    },
    closeShift(
      shiftId: string,
      body: { countedCashMinor: number; supervisorStaffId?: string; supervisorPin?: string; handOver?: boolean },
      idempotencyKey: string,
    ): Promise<ApiResult<POSShift>> {
      return client.POST<POSShift>(`/api/v1/pos/shifts/${encodeURIComponent(shiftId)}/close`, {
        headers: idempotent(idempotencyKey),
        body,
      });
    },
    listCashMovements(shiftId: string): Promise<ApiResult<{ items: POSCashMovement[] }>> {
      return client.GET<{ items: POSCashMovement[] }>(
        `/api/v1/pos/shifts/${encodeURIComponent(shiftId)}/cash-movements`,
      );
    },
    recordCashMovement(
      body: {
        movementType: CashMovementType;
        amountMinor: number;
        reason: string;
        /** Required for CASH_OUT: a different supervisor's id and PIN. */
        supervisorStaffId?: string;
        supervisorPin?: string;
      },
      idempotencyKey: string,
    ): Promise<ApiResult<POSCashMovement>> {
      return client.POST<POSCashMovement>("/api/v1/pos/cash-movements", {
        headers: idempotent(idempotencyKey),
        body,
      });
    },

    // ---- Orders ----------------------------------------------------------
    /**
     * One page of the till's orders (S5b): view=open (not paid or voided,
     * oldest first) or view=paid (closed on one business day, latest paid
     * first). Keep asking with cursor=nextCursor until it is null. No limit
     * is sent: Yetu's own page size applies (YETU_POS_ORDERS_PAGE_DEFAULT).
     */
    listOrderPage(query: { view: "open" | "paid"; businessDate?: string; cursor?: string }): Promise<ApiResult<POSOrderPage>> {
      return client.GET<POSOrderPage>("/api/v1/pos/orders", { params: { query } });
    },
    getOrder(orderId: string): Promise<ApiResult<POSOrder>> {
      return client.GET<POSOrder>(`/api/v1/pos/orders/${encodeURIComponent(orderId)}`);
    },
    createOrder(
      body: { shiftId: string; serviceType?: ServiceType; tableLabel?: string; notes?: string },
      idempotencyKey: string,
    ): Promise<ApiResult<POSOrder>> {
      return client.POST<POSOrder>("/api/v1/pos/orders", { headers: idempotent(idempotencyKey), body });
    },
    addItem(
      orderId: string,
      body: { productId: string; variantId?: string; quantity: number; modifierOptionIds?: string[]; version: number },
      idempotencyKey: string,
    ): Promise<ApiResult<POSOrder>> {
      return client.POST<POSOrder>(`/api/v1/pos/orders/${encodeURIComponent(orderId)}/items`, {
        headers: idempotent(idempotencyKey),
        body,
      });
    },
    /** Removes an UNSENT item only. A sent item can only be corrected via voidOrder (supervisor). */
    removeItem(
      orderId: string,
      itemId: string,
      version: number,
      idempotencyKey: string,
    ): Promise<ApiResult<POSOrder>> {
      return client.DELETE<POSOrder>(
        `/api/v1/pos/orders/${encodeURIComponent(orderId)}/items/${encodeURIComponent(itemId)}`,
        { headers: idempotent(idempotencyKey), body: { version } },
      );
    },
    sendOrder(orderId: string, version: number, idempotencyKey: string): Promise<ApiResult<void>> {
      return client.POST<void>(`/api/v1/pos/orders/${encodeURIComponent(orderId)}/send`, {
        headers: idempotent(idempotencyKey),
        body: { version },
      });
    },
    transitionStatus(
      orderId: string,
      status: "PREPARING" | "READY" | "SERVED",
      version: number,
      idempotencyKey: string,
    ): Promise<ApiResult<void>> {
      return client.POST<void>(
        `/api/v1/pos/orders/${encodeURIComponent(orderId)}/status/${status}`,
        { headers: idempotent(idempotencyKey), body: { version } },
      );
    },
    listStationTickets(active = true): Promise<ApiResult<{ items: POSStationTicket[] }>> {
      return client.GET<{ items: POSStationTicket[] }>("/api/v1/pos/station-tickets", {
        params: { query: { active } },
      });
    },
    transitionStationTicket(
      ticketId: string,
      status: "PREPARING" | "READY" | "SERVED",
      version: number,
      idempotencyKey: string,
    ): Promise<ApiResult<void>> {
      return client.POST<void>(
        `/api/v1/pos/station-tickets/${encodeURIComponent(ticketId)}/status/${status}`,
        { headers: idempotent(idempotencyKey), body: { version } },
      );
    },
    recordTender(
      orderId: string,
      body: { paymentMethod: PaymentMethod; amountMinor: number; reference?: string; version: number },
      idempotencyKey: string,
    ): Promise<ApiResult<POSTenderResult>> {
      return client.POST<POSTenderResult>(
        `/api/v1/pos/orders/${encodeURIComponent(orderId)}/payments`,
        { headers: idempotent(idempotencyKey), body },
      );
    },
    applyDiscount(
      orderId: string,
      body: {
        kind: DiscountKind;
        value: number;
        reason: string;
        supervisorStaffId: string;
        supervisorPin: string;
        version: number;
      },
      idempotencyKey: string,
    ): Promise<ApiResult<POSOrder>> {
      return client.POST<POSOrder>(`/api/v1/pos/orders/${encodeURIComponent(orderId)}/discount`, {
        headers: idempotent(idempotencyKey),
        body,
      });
    },
    chargeToRoom(
      orderId: string,
      stayId: string,
      idempotencyKey: string,
    ): Promise<ApiResult<{ folioItemId: string }>> {
      return client.POST<{ folioItemId: string }>(
        `/api/v1/pos/orders/${encodeURIComponent(orderId)}/room-charge`,
        { headers: idempotent(idempotencyKey), body: { stayId } },
      );
    },
    voidOrder(
      orderId: string,
      body: { reason: string; supervisorStaffId: string; supervisorPin: string; version: number },
      idempotencyKey: string,
    ): Promise<ApiResult<void>> {
      return client.POST<void>(`/api/v1/pos/orders/${encodeURIComponent(orderId)}/void`, {
        headers: idempotent(idempotencyKey),
        body,
      });
    },

    // ---- Refunds (S7) ---------------------------------------------------
    /** listPOSOrderRefunds: what was given back, and each line's and payment's remaining room. */
    listPOSOrderRefunds(orderId: string): Promise<ApiResult<POSOrderRefunds>> {
      return client.GET<POSOrderRefunds>(`/api/v1/pos/orders/${encodeURIComponent(orderId)}/refunds`);
    },
    /** quotePOSRefund: the refund worked out by the server, nothing written, no approval asked. */
    quotePOSRefund(orderId: string, body: POSRefundQuoteRequest): Promise<ApiResult<POSRefundQuote>> {
      return client.POST<POSRefundQuote>(`/api/v1/pos/orders/${encodeURIComponent(orderId)}/refunds/quote`, { body });
    },
    /** recordPOSRefund: a different person's supervisor PIN; idempotent under the caller's key. */
    recordPOSRefund(orderId: string, body: POSRefundRequest, idempotencyKey: string): Promise<ApiResult<POSRefund>> {
      return client.POST<POSRefund>(`/api/v1/pos/orders/${encodeURIComponent(orderId)}/refunds`, {
        headers: idempotent(idempotencyKey),
        body,
      });
    },

    // ---- Receipts -------------------------------------------------------
    getReceipt(orderId: string): Promise<ApiResult<POSReceipt>> {
      return client.GET<POSReceipt>(`/api/v1/pos/orders/${encodeURIComponent(orderId)}/receipt`);
    },
    reprintReceipt(orderId: string, idempotencyKey: string): Promise<ApiResult<POSReceipt>> {
      return client.POST<POSReceipt>(
        `/api/v1/pos/orders/${encodeURIComponent(orderId)}/receipt/reprint`,
        { headers: idempotent(idempotencyKey) },
      );
    },

    /** S17b: a tab handed over to the next shift, taken onto this till's open shift. */
    takeOverTab(orderId: string, idempotencyKey: string): Promise<ApiResult<POSOrder>> {
      return client.POST<POSOrder>(`/api/v1/pos/orders/${encodeURIComponent(orderId)}/take-over`, {
        headers: idempotent(idempotencyKey),
      });
    },

    /** S8a: the latest round's kitchen tickets again (or the round named), marked COPY. */
    reprintKitchenTickets(orderId: string, idempotencyKey: string, roundNumber?: number): Promise<ApiResult<POSKitchenReprint>> {
      return client.POST<POSKitchenReprint>(
        `/api/v1/pos/orders/${encodeURIComponent(orderId)}/kitchen-tickets/reprint`,
        { headers: idempotent(idempotencyKey), body: roundNumber === undefined ? {} : { roundNumber } },
      );
    },

    // ---- Room charge -----------------------------------------------------
    listRoomChargeCandidates(query: string): Promise<ApiResult<POSRoomChargeCandidate[]>> {
      return client.GET<POSRoomChargeCandidate[]>("/api/v1/pos/room-charge-candidates", {
        params: { query: { q: query } },
      });
    },

    // ---- Business date (POS-only properties) ------------------------------
    closeBusinessDay(idempotencyKey: string): Promise<ApiResult<POSBusinessDayCloseResult>> {
      return client.POST<POSBusinessDayCloseResult>("/api/v1/pos/business-day/close", {
        headers: idempotent(idempotencyKey),
      });
    },
  };
}

export type PosApi = ReturnType<typeof createPosApi>;
