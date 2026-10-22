import { stationWords } from "../kitchen/kitchenWords";
import type { ServiceType } from "../lib/posContracts";
import { clockTime, guestCountWords, orderPlaceWords, placeWords, serviceTypeWords } from "../lib/words";
import { EscPos, type PaperWidth } from "./escpos";

/**
 * A void slip on paper (fbc-peak 00125): a station making an item that was
 * voided is told to stop -- the order's number large, where it goes, what not
 * to make with its options, why, and who asked and who approved. It prints
 * where that station's kitchen tickets print. No prices: the kitchen makes,
 * the till charges.
 */
export interface VoidSlipPaper {
  dailyNumber?: number;
  /** The order's reference: printed only when it has no number for the day. */
  orderNumber?: string;
  station?: string;
  serviceType?: ServiceType;
  askForTable?: boolean;
  guestCount?: number;
  /** The table, room or tab the order goes to. */
  label?: string;
  /** Who took the order: the dish would have gone back to them. */
  waiterName?: string;
  askedByName?: string;
  approvedByName?: string;
  reason?: string;
  voidedAt?: string;
  /** The whole order was voided, not one item. */
  wholeOrder?: boolean;
  lines: { quantity: number; name: string; options: string[] }[];
}

/** What the paper is, at its top: "CANCELLED - BAR", beside the kitchen's "TO PREPARE - BAR". */
export function voidSlipTitle(station: string | undefined): string {
  return `CANCELLED - ${(station ? stationWords(station) : "Kitchen").toUpperCase()}`;
}

/** Who asked and who approved, in one line: "Asked by Baraka Mushi, approved by Neema Kweka". */
export function voidSlipWho(slip: Pick<VoidSlipPaper, "askedByName" | "approvedByName">): string {
  const asked = slip.askedByName?.trim();
  const approved = slip.approvedByName?.trim();
  if (asked && approved) return `Asked by ${asked}, approved by ${approved}`;
  if (asked) return `Asked by ${asked}`;
  return approved ? `Approved by ${approved}` : "";
}

export function voidSlipBytes(slip: VoidSlipPaper, width: PaperWidth): Uint8Array {
  const out = new EscPos(width).align("center").bold(true).line(voidSlipTitle(slip.station)).size(2, 2);
  const number = slip.dailyNumber ?? slip.orderNumber;
  out.line(number !== undefined ? `ORDER ${number}` : "ORDER");
  out.size(1, 2).line(slip.wholeOrder ? "WHOLE ORDER - DO NOT MAKE" : "DO NOT MAKE").size(1, 1);
  out.bold(false).align("left").rule();

  const place = slip.serviceType ? orderPlaceWords(slip.serviceType, slip.label, slip.askForTable) : placeWords(undefined, slip.label, slip.askForTable);
  const service = slip.serviceType ? serviceTypeWords(slip.serviceType) : "";
  const where = [place, service].filter(Boolean).join(" - ");
  if (where) out.bold(true).size(1, 2).wrapped(where).size(1, 1).bold(false);
  if (slip.guestCount) out.wrapped(guestCountWords(slip.guestCount));
  if (slip.waiterName) out.wrapped(`Taken by ${slip.waiterName}`);
  const voided = clockTime(slip.voidedAt);
  if (voided) out.line(`Cancelled ${voided}`);
  out.rule();

  for (const line of slip.lines) {
    out.bold(true).size(1, 2).wrapped(`${line.quantity} x ${line.name}`).size(1, 1).bold(false);
    for (const option of line.options) out.wrapped(option, width, "   - ");
  }
  if (slip.lines.length === 0) out.line("(nothing on this slip)");
  out.rule();
  if (slip.reason?.trim()) out.wrapped(`Why: ${slip.reason.trim()}`);
  const who = voidSlipWho(slip);
  if (who) out.wrapped(who);
  return out.rule().feed(3).cut().build();
}

const SERVICE_TYPES: readonly ServiceType[] = ["DINE_IN", "TAKEAWAY", "ROOM_SERVICE"];

/** Yetu's void print document (fbc-peak item_void.go createVoidPrintJobs) as the paper slip. */
export function voidSlipFromPrintDocument(document: Record<string, unknown>): VoidSlipPaper {
  const text = (key: string) => (typeof document[key] === "string" && (document[key] as string).trim() ? (document[key] as string) : undefined);
  const items = Array.isArray(document.items) ? document.items : [];
  const service = text("serviceType");
  return {
    dailyNumber: typeof document.dailyNumber === "number" ? document.dailyNumber : undefined,
    orderNumber: text("orderNumber"),
    station: text("station"),
    serviceType: service && (SERVICE_TYPES as readonly string[]).includes(service) ? (service as ServiceType) : undefined,
    label: text("tableLabel"),
    askForTable: typeof document.askForTable === "boolean" ? document.askForTable : undefined,
    guestCount: typeof document.guestCount === "number" ? document.guestCount : undefined,
    waiterName: text("waiterName"),
    askedByName: text("askedByName"),
    approvedByName: text("approvedByName"),
    reason: text("reason"),
    voidedAt: text("voidedAt"),
    wholeOrder: document.wholeOrder === true,
    lines: items.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      if (typeof row.name !== "string") return [];
      const options = Array.isArray(row.modifiers)
        ? row.modifiers.flatMap((m) => (m && typeof m === "object" && typeof (m as { name?: unknown }).name === "string" ? [(m as { name: string }).name] : []))
        : [];
      const quantity = typeof row.quantity === "number" ? row.quantity : Number(row.quantity) || 1;
      return [{ quantity, name: row.name, options }];
    }),
  };
}

/** The slip as plain text, for a till printing through the system's own printer. */
export function formatVoidSlip(slip: VoidSlipPaper): string {
  const number = slip.dailyNumber ?? slip.orderNumber;
  const place = slip.serviceType ? orderPlaceWords(slip.serviceType, slip.label, slip.askForTable) : placeWords(undefined, slip.label, slip.askForTable);
  const voided = clockTime(slip.voidedAt);
  const header = [
    voidSlipTitle(slip.station),
    number !== undefined ? `ORDER ${number}` : "ORDER",
    slip.wholeOrder ? "WHOLE ORDER - DO NOT MAKE" : "DO NOT MAKE",
    [place, slip.serviceType ? serviceTypeWords(slip.serviceType) : ""].filter(Boolean).join(" - "),
    slip.guestCount ? guestCountWords(slip.guestCount) : "",
    slip.waiterName ? `Taken by ${slip.waiterName}` : "",
    voided ? `Cancelled ${voided}` : "",
  ].filter(Boolean);
  const lines = slip.lines.map((line) => [`${String(line.quantity).padStart(3, " ")}  ${line.name}`, ...line.options.map((o) => `      ${o}`)].join("\n"));
  const footer = [slip.reason?.trim() ? `Why: ${slip.reason.trim()}` : "", voidSlipWho(slip)].filter(Boolean);
  return `${header.join("\n")}\n\n${lines.join("\n") || "(nothing on this slip)"}\n\n${footer.join("\n")}\n`;
}
