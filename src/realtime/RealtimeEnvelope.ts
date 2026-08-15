/**
 * Canonical realtime envelope, matching the backend journal envelope
 * (see RealTimeStreamService.envelope in the peak backend).
 */
export interface RealtimeEnvelope {
  /** Monotonic committed position in the journal; backfill and dedup key. */
  sequenceId: number;
  eventId: string;
  type: string;
  schemaVersion: number;
  aggregateType: string | null;
  aggregateId: string | null;
  aggregateVersion: number | null;
  occurredAt: string;
  tenantId: string;
  propertyId: string;
  outletId: string | null;
  payload: Record<string, unknown>;
}

export const EVENT_TYPES = {
  ORDER_CREATED: "pos.order.created",
  ORDER_UPDATED: "pos.order.updated",
  ORDER_SENT: "pos.order.sent",
  ORDER_PAYMENT_INITIATED: "pos.order.payment_initiated",
  ORDER_SETTLED: "pos.order.settled",
  ORDER_ITEM_VOIDED: "pos.order_item.voided",
  KITCHEN_TICKET_CREATED: "pos.kitchen_ticket.created",
  KITCHEN_TICKET_PREPARING: "pos.kitchen_ticket.preparing",
  KITCHEN_TICKET_READY: "pos.kitchen_ticket.ready",
  KITCHEN_TICKET_DELIVERED: "pos.kitchen_ticket.delivered",
  KITCHEN_TICKET_VOIDED: "pos.kitchen_ticket.voided",
  SESSION_OPENED: "pos.session.opened",
  SESSION_CLOSING: "pos.session.closing",
  SESSION_CLOSED: "pos.session.closed",
  PAYMENT_CREATED: "payment.created",
  PAYMENT_PENDING: "payment.pending",
  PAYMENT_SUCCEEDED: "payment.succeeded",
  PAYMENT_FAILED: "payment.failed",
} as const;

export type RealtimeEventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

export type ConnectionPhase =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "error";

export interface ConnectionState {
  phase: ConnectionPhase;
  attempt: number;
  lastError: string | null;
  /** True after the first successful connect of this session. */
  established: boolean;
  /** Monotonic resync counter — increments each time the socket re-establishes. */
  resyncGeneration: number;
}