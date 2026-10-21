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
  // Progress, not trouble: warning is kept for what needs someone (late, waiting).
  PREPARING: { words: "Preparing", tone: "info" },
  READY: { words: "Ready", tone: "success" },
  SERVED: { words: "Served", tone: "neutral" },
  CLOSED: { words: "Paid", tone: "success" },
  VOIDED: { words: "Cancelled", tone: "danger" },
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
  DRAWER_OPENED: "Drawer opened",
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

/** Where the order goes, from the free-text label: Table 12, Room 204; nothing for takeaway. */
/**
 * Where an order goes, as staff and the kitchen read it. A table is a short
 * code with a number in it and no spaces ("9", "T4", "12A", "B-3") and reads
 * "Table T4"; anything else is the name the waiter typed ("Window", "Mama
 * Neema", "Bar stool 3") and reads as typed -- many places name no tables
 * and the waiter keeps track (owner, 2026-10-21).
 */
export function orderPlaceWords(type: ServiceType, label: string | null | undefined): string {
  const place = label?.trim();
  if (!place || type === "TAKEAWAY") return "";
  if (type === "ROOM_SERVICE") return `Room ${place}`;
  return /^(?=.*\d)[A-Za-z0-9-]{1,5}$/.test(place) ? `Table ${place}` : place;
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

/** Today in full, for the sign-in screen: "Monday 19 October". */
export function longDayWords(value: Date): string {
  if (Number.isNaN(value.getTime())) return "";
  const parts = new Intl.DateTimeFormat(CLOCK_LOCALE, { weekday: "long", day: "numeric", month: "long" }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((piece) => piece.type === type)?.value ?? "";
  return `${part("weekday")} ${part("day")} ${part("month")}`;
}

const CIVIL_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A business day ("2026-10-12", a calendar day, not a moment) as people say
 * it: "Mon 12 Oct". Read as that day, never shifted by the time zone; anything
 * else gives nothing rather than a machine date.
 */
export function businessDayWords(day: string | null | undefined): string {
  const match = day ? CIVIL_DAY.exec(day) : null;
  if (!match) return "";
  const [year, month, date] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const moment = new Date(Date.UTC(year, month - 1, date));
  if (moment.getUTCFullYear() !== year || moment.getUTCMonth() !== month - 1 || moment.getUTCDate() !== date) return "";
  const parts = new Intl.DateTimeFormat(CLOCK_LOCALE, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).formatToParts(moment);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((piece) => piece.type === type)?.value ?? "";
  return `${part("weekday")} ${part("day")} ${part("month")}`;
}

/**
 * A moment as a slip prints it: "Sun 18 Oct 2026 · 17:05", in the till's own
 * time; nothing for anything that isn't a moment.
 */
export function dateTimeWords(value: Date | string | null | undefined): string {
  if (value == null) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat(CLOCK_LOCALE, { weekday: "short", day: "numeric", month: "short", year: "numeric" }).formatToParts(
    date,
  );
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((piece) => piece.type === type)?.value ?? "";
  return `${part("weekday")} ${part("day")} ${part("month")} ${part("year")} · ${clockTime(date)}`;
}

/**
 * The top bar's shift chip: the shift and its business day, in full
 * ("Shift open since 07:02 · Mon 12 Oct") and shorter for compact screens
 * ("Since 07:02 · Mon 12 Oct"). A business day that isn't today is named as
 * one (F-266): after midnight, until the night audit, a shift opened at
 * 00:12 on Wed 21 counts for Tue 20, and "· Tue 20 Oct" alone read as the
 * day it opened. On any other day the chip stays short.
 */
export function shiftChipWords(
  shift: Pick<POSShift, "status" | "openedAt" | "businessDate"> | null | undefined,
  now: Date = new Date(),
): { full: string; short: string } {
  if (!shift) return { full: "No shift open", short: "No shift open" };
  const full = shiftWords(shift);
  const short = full.startsWith("Shift open since ")
    ? `Since ${full.slice("Shift open since ".length)}`
    : full.startsWith("Shift ")
      ? full.charAt(6).toUpperCase() + full.slice(7)
      : full;
  const named = businessDayWords(shift.businessDate);
  if (!named) return { full, short };
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const day = shift.businessDate === today ? named : `business day ${named}`;
  return { full: `${full} · ${day}`, short: `${short} · ${day}` };
}

/** The shift as the top bar says it: "Shift open since 07:02". */
export function shiftWords(shift: Pick<POSShift, "status" | "openedAt"> | null | undefined): string {
  if (!shift) return "No shift open";
  if (shift.status === "PENDING_VARIANCE_APPROVAL") return "Shift waiting for a supervisor";
  if (shift.status === "CLOSED") return "Shift closed";
  const since = clockTime(shift.openedAt);
  return since ? `Shift open since ${since}` : "Shift open";
}
