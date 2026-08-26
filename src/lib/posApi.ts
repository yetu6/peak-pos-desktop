import { createApiClient, type ApiResult } from "./api";
import { devIdentityFromEnv } from "./env";

export interface PosOrderItemResponse {
  id: string;
  menuItemId: string;
  itemName: string;
  name: string;
  quantity: number;
  unitPrice: number;
  taxAmount: number;
  totalPrice: number;
  status: string;
  serviceState: string;
}

export interface PosOrderResponse {
  id: string;
  shiftId: string;
  orderNumber: string;
  orderType?: string;
  tableNumber?: string;
  status: string;
  settlementStatus?: string;
  settlementMethod?: string;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  version: number;
  items: PosOrderItemResponse[];
}

export interface PosSessionResponse {
  id: string;
  status: string;
  openingFloat?: number;
  expectedCash?: number;
  actualCash?: number;
  variance?: number;
  openedAt?: string;
}

export interface KitchenTicketResponse {
  id: string;
  orderId: string;
  ticketNumber: string;
  status: string;
  sentAt?: string;
  items: Array<{ id: string; itemName: string; quantity: number }>;
}

export interface PaymentProviderAccountResponse { id: string; name: string; providerName: string; provider?: string; }
export interface PosRoomChargeCandidateResponse { stayId: string; roomId: string; roomNumber: string; guestDisplayName: string; postingEligible: boolean; }
export type TicketAction = "prepare" | "ready" | "deliver" | "void";
export type SettleMethod = "cash" | "room_charge" | "mobile_money";

interface GoOrderItem { id: string; productId: string; name: string; quantity: number; unitPriceMinor: number; taxMinor: number; totalMinor: number; status: string; }
interface GoOrder { id: string; shiftId: string; orderNumber: string; status: string; subtotalMinor: number; taxMinor: number; totalMinor: number; version: number; items: GoOrderItem[]; }
interface GoShift { id: string; status: string; openingCashMinor?: number; expectedCashMinor?: number; countedCashMinor?: number; varianceMinor?: number; openedAt?: string; }

const major = (minor = 0) => minor / 100;
const minor = (amount = 0) => Math.round(amount * 100);
const idempotencyHeader = () => ({ "Idempotency-Key": crypto.randomUUID() });

function mapOrder(order: GoOrder): PosOrderResponse {
  return {
    id: order.id,
    shiftId: order.shiftId,
    orderNumber: order.orderNumber,
    status: order.status.toLowerCase(),
    settlementStatus: order.status === "CLOSED" ? "confirmed" : undefined,
    subtotal: major(order.subtotalMinor),
    taxAmount: major(order.taxMinor),
    totalAmount: major(order.totalMinor),
    version: order.version,
    items: (order.items ?? []).map((item) => ({
      id: item.id,
      menuItemId: item.productId,
      itemName: item.name,
      name: item.name,
      quantity: item.quantity,
      unitPrice: major(item.unitPriceMinor),
      taxAmount: major(item.taxMinor),
      totalPrice: major(item.totalMinor),
      status: item.status.toLowerCase(),
      serviceState: item.status.toLowerCase(),
    })),
  };
}

function mapShift(shift: GoShift): PosSessionResponse {
  return { id: shift.id, status: shift.status.toLowerCase(), openingFloat: major(shift.openingCashMinor), expectedCash: major(shift.expectedCashMinor), actualCash: major(shift.countedCashMinor), variance: major(shift.varianceMinor), openedAt: shift.openedAt };
}

async function mapped<TIn, TOut>(result: Promise<ApiResult<TIn>>, map: (value: TIn) => TOut): Promise<ApiResult<TOut>> {
  const response = await result;
  return response.data === undefined ? response as unknown as ApiResult<TOut> : { ...response, data: map(response.data) };
}

export function createPosApi() {
  const client = createApiClient();
  let identity: ReturnType<typeof devIdentityFromEnv> | null = null;
  try { identity = devIdentityFromEnv(); } catch { /* production PIN sessions do not use dev identity */ }
  return {
    client,
    getOrder(_propertyId: string, orderId: string) {
      return mapped(client.GET<GoOrder>(`/api/v1/pos/orders/${encodeURIComponent(orderId)}`), mapOrder);
    },
    listOrders(_propertyId: string, active = true) {
      return mapped(client.GET<GoOrder[]>("/api/v1/pos/orders", { params: { query: { active } } }), (orders) => orders.map(mapOrder));
    },
    createOrder(_propertyId: string, body: { sessionId: string; orderType: string; tableNumber?: string }) {
      return mapped(client.POST<GoOrder>("/api/v1/pos/orders", { headers: idempotencyHeader(), body: { shiftId: body.sessionId } }), mapOrder);
    },
    addItem(_propertyId: string, orderId: string, body: { menuItemId: string; quantity: number; specialRequest?: string }) {
      return mapped(client.POST<GoOrder>(`/api/v1/pos/orders/${encodeURIComponent(orderId)}/items`, { headers: idempotencyHeader(), body: { productId: body.menuItemId, quantity: body.quantity } }), mapOrder);
    },
    async sendOrder(_propertyId: string, orderId: string) {
      const sent = await client.POST<void>(`/api/v1/pos/orders/${encodeURIComponent(orderId)}/send`, { headers: idempotencyHeader() });
      if (sent.error) return sent as unknown as ApiResult<PosOrderResponse>;
      return mapped(client.GET<GoOrder>(`/api/v1/pos/orders/${encodeURIComponent(orderId)}`), mapOrder);
    },
    async settleOrder(_propertyId: string, orderId: string, body: { paymentMethod: string; stayId?: string; roomNumber?: string; providerAccountId?: string; phoneNumber?: string }) {
      if (body.paymentMethod === "room_charge") {
        const posted = await client.POST<{ folioItemId: string }>(`/api/v1/pos/orders/${encodeURIComponent(orderId)}/room-charge`, { headers: idempotencyHeader(), body: { stayId: body.stayId } });
        if (posted.error) return posted as unknown as ApiResult<PosOrderResponse>;
        return mapped(client.GET<GoOrder>(`/api/v1/pos/orders/${encodeURIComponent(orderId)}`), mapOrder);
      }
      const snapshot = await client.GET<GoOrder>(`/api/v1/pos/orders/${encodeURIComponent(orderId)}`);
      if (!snapshot.data) return snapshot as unknown as ApiResult<PosOrderResponse>;
      const paid = await client.POST<{ paymentId: string }>(`/api/v1/pos/orders/${encodeURIComponent(orderId)}/payments`, { headers: idempotencyHeader(), body: { paymentMethod: body.paymentMethod === "mobile_money" ? "MOBILE_MONEY" : "CASH", amountMinor: snapshot.data.totalMinor, reference: body.phoneNumber } });
      if (paid.error) return paid as unknown as ApiResult<PosOrderResponse>;
      return mapped(client.GET<GoOrder>(`/api/v1/pos/orders/${encodeURIComponent(orderId)}`), mapOrder);
    },
    voidOrderItem(_propertyId: string, orderId: string, itemId: string, _body: { disposition?: "RETURN_TO_STOCK" | "WASTE"; reason: string }) {
      return mapped(client.DELETE<GoOrder>(`/api/v1/pos/orders/${encodeURIComponent(orderId)}/items/${encodeURIComponent(itemId)}`, { headers: idempotencyHeader() }), mapOrder);
    },
    openSession(_propertyId: string, _outletId: string, openingFloat: number) {
      return mapped(client.POST<GoShift>("/api/v1/pos/shifts", { headers: idempotencyHeader(), body: { openingCashMinor: minor(openingFloat) } }), mapShift);
    },
    async getSession(_propertyId: string, sessionId: string): Promise<ApiResult<{ session: PosSessionResponse }>> {
      const result = await client.GET<GoShift>(`/api/v1/pos/shifts/${encodeURIComponent(sessionId)}`);
      return result.data ? { ...result, data: { session: mapShift(result.data) } } : result as unknown as ApiResult<{ session: PosSessionResponse }>;
    },
    closeSession(_propertyId: string, sessionId: string, actualCash = 0) {
      return mapped(client.POST<GoShift>(`/api/v1/pos/shifts/${encodeURIComponent(sessionId)}/close`, { headers: idempotencyHeader(), body: { countedCashMinor: minor(actualCash) } }), mapShift);
    },
    async listKitchenTickets(_propertyId: string): Promise<ApiResult<KitchenTicketResponse[]>> {
      return mapped(client.GET<GoOrder[]>("/api/v1/pos/orders", { params: { query: { active: true } } }), (orders) => orders.filter((order) => ["SENT", "PREPARING", "READY"].includes(order.status)).map((order) => ({ id: order.id, orderId: order.id, ticketNumber: order.orderNumber, status: order.status === "SENT" ? "PENDING" : order.status, sentAt: undefined, items: order.items.map((item) => ({ id: item.id, itemName: item.name, quantity: item.quantity })) })));
    },
    transitionTicket(_propertyId: string, ticketId: string, action: TicketAction, _reason?: string) {
      if (action === "void") return Promise.resolve({ error: "Use supervisor-authorized order void", response: new Response(null, { status: 409 }) } as ApiResult<void>);
      const status = action === "prepare" ? "PREPARING" : action === "ready" ? "READY" : "SERVED";
      return client.POST<void>(`/api/v1/pos/orders/${encodeURIComponent(ticketId)}/status/${status}`, { headers: idempotencyHeader() });
    },
    listProviderAccounts(_propertyId: string): Promise<ApiResult<PaymentProviderAccountResponse[]>> {
      return Promise.resolve({ data: [], response: new Response(null, { status: 200 }) });
    },
    listRoomChargeCandidates(_propertyId: string, query: string) {
      return client.GET<PosRoomChargeCandidateResponse[]>("/api/v1/pos/room-charge-candidates", { params: { query: { q: query } } });
    },
    identity,
  };
}

export type PosApi = ReturnType<typeof createPosApi>;
