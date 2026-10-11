/**
 * Plain words for the codes the backend sends. A screen never shows a code:
 * a status, method or type the till does not know yet gets a neutral word,
 * never the code itself.
 */
import type {
  CashMovementType,
  OrderStatus,
  PaymentMethod,
  POSShift,
  POSStationTicket,
  ServiceType,
  ShiftStatus,
} from "./posContracts";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "accent";

type TicketStep = POSStationTicket["status"];
/** Room charge settles an order too (the backend records it as the settlement method). */
export type SettlementMethod = PaymentMethod | "ROOM_CHARGE";

const ORDER_STATUS: Record<OrderStatus, { words: string; tone: Tone }> = {
  OPEN: { words: "Open", tone: "neutral" },
  SENT: { words: "Sent to kitchen", tone: "info" },
  PREPARING: { words: "Preparing", tone: "warning" },
  READY: { words: "Ready", tone: "success" },
  SERVED: { words: "Served", tone: "neutral" },
  CLOSED: { words: "Paid", tone: "success" },
  VOIDED: { words: "Voided", tone: "danger" },
};

const TICKET_STEP: Record<TicketStep, { words: string; next: string | null }> = {
  SENT: { words: "New", next: "Start" },
  PREPARING: { words: "Preparing", next: "Ready" },
  READY: { words: "Ready", next: "Served" },
  SERVED: { words: "Served", next: null },
};

const PAYMENT_METHOD: Record<SettlementMethod, string> = {
  CASH: "Cash",
  MOBILE_MONEY: "Mobile money",
  BANK_TRANSFER: "Bank transfer",
  EXTERNAL_CARD: "Card (own machine)",
  ROOM_CHARGE: "Charge to room",
  OTHER: "Other",
};

const CASH_MOVEMENT: Record<CashMovementType, string> = {
  CASH_IN: "Cash in",
  CASH_OUT: "Cash out",
};

const SERVICE_TYPE: Record<ServiceType, string> = {
  DINE_IN: "Dine in",
  TAKEAWAY: "Takeaway",
  ROOM_SERVICE: "Room service",
};

const SHIFT_STATUS: Record<ShiftStatus, string> = {
  OPEN: "Open",
  PENDING_VARIANCE_APPROVAL: "Waiting for a supervisor to approve the count",
  CLOSED: "Closed",
};

function lookup<T extends string, V>(map: Record<T, V>, code: string): V | undefined {
  return Object.prototype.hasOwnProperty.call(map, code) ? map[code as T] : undefined;
}

export function orderStatusWords(status: OrderStatus): string {
  return lookup(ORDER_STATUS, status)?.words ?? "Status not known";
}

export function orderStatusTone(status: OrderStatus): Tone {
  return lookup(ORDER_STATUS, status)?.tone ?? "neutral";
}

export function ticketStepWords(step: TicketStep): string {
  return lookup(TICKET_STEP, step)?.words ?? "Step not known";
}

/** The words on a ticket's one next-step button; null once it is served. */
export function ticketNextStepWords(step: TicketStep): string | null {
  return lookup(TICKET_STEP, step)?.next ?? null;
}

export function paymentMethodWords(method: SettlementMethod): string {
  return lookup(PAYMENT_METHOD, method) ?? "Other payment";
}

export function cashMovementWords(type: CashMovementType): string {
  return lookup(CASH_MOVEMENT, type) ?? "Cash movement";
}

export function serviceTypeWords(type: ServiceType): string {
  return lookup(SERVICE_TYPE, type) ?? "Other service";
}

export function shiftStatusWords(status: ShiftStatus): string {
  return lookup(SHIFT_STATUS, status) ?? "Status not known";
}

/** Named setting: times are written on a 24-hour clock ("07:02"). */
export const CLOCK_LOCALE = "en-GB";

export function clockTime(value: Date | string | null | undefined): string {
  if (value == null) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(CLOCK_LOCALE, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

/** The shift as the top bar says it: "Shift open since 07:02". */
export function shiftWords(shift: Pick<POSShift, "status" | "openedAt"> | null | undefined): string {
  if (!shift) return "No shift open";
  if (shift.status === "PENDING_VARIANCE_APPROVAL") return "Shift waiting for a supervisor";
  if (shift.status === "CLOSED") return "Shift closed";
  const since = clockTime(shift.openedAt);
  return since ? `Shift open since ${since}` : "Shift open";
}
