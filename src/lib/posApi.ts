import { createApiClient, type ApiResult } from "./api";
import type {
  CashMovementType,
  PaymentMethod,
  POSBusinessDayCloseResult,
  POSCashMovement,
  POSCatalog,
  POSOrder,
  POSReceipt,
  POSRoomChargeCandidate,
  POSShift,
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

    // ---- Shifts --------------------------------------------------------
    openShift(openingCashMinor: number, idempotencyKey: string): Promise<ApiResult<POSShift>> {
      return client.POST<POSShift>("/api/v1/pos/shifts", {
        headers: idempotent(idempotencyKey),
        body: { openingCashMinor },
      });
    },
    getShift(shiftId: string): Promise<ApiResult<POSShift>> {
      return client.GET<POSShift>(`/api/v1/pos/shifts/${encodeURIComponent(shiftId)}`);
    },
    closeShift(
      shiftId: string,
      body: { countedCashMinor: number; supervisorStaffId?: string; supervisorPin?: string },
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
      body: { movementType: CashMovementType; amountMinor: number; reason: string },
      idempotencyKey: string,
    ): Promise<ApiResult<POSCashMovement>> {
      return client.POST<POSCashMovement>("/api/v1/pos/cash-movements", {
        headers: idempotent(idempotencyKey),
        body,
      });
    },

    // ---- Orders ----------------------------------------------------------
    listOrders(active = true): Promise<ApiResult<POSOrder[]>> {
      return client.GET<POSOrder[]>("/api/v1/pos/orders", { params: { query: { active } } });
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
      body: { productId: string; quantity: number; modifierOptionIds?: string[]; version: number },
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
    recordTender(
      orderId: string,
      body: { paymentMethod: PaymentMethod; amountMinor: number; reference?: string; version: number },
      idempotencyKey: string,
    ): Promise<ApiResult<{ paymentId: string }>> {
      return client.POST<{ paymentId: string }>(
        `/api/v1/pos/orders/${encodeURIComponent(orderId)}/payments`,
        { headers: idempotent(idempotencyKey), body },
      );
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
