import { guestCountWords } from "../lib/words";
import { stationWords } from "../kitchen/kitchenWords";
import type { ServiceType } from "../lib/posContracts";
import { clockTime, dateTimeWords, orderPlaceWords, placeWords, serviceTypeWords } from "../lib/words";
import { EscPos, type PaperWidth } from "./escpos";

/**
 * A kitchen ticket on paper (S8a), for a kitchen or bar without a screen:
 * the order's number large, its round, the station, where it goes, and the
 * waiter who took it -- so the dish goes back to the right person -- then
 * each line with its options and staff's tags (allergies), the note, and a
 * cut. No prices: the kitchen makes, the till charges.
 */
export interface KitchenTicketPaper {
  dailyNumber?: number;
  /** The order's reference: printed only when it has no number for the day. */
  orderNumber?: string;
  roundNumber?: number;
  station?: string;
  serviceType?: ServiceType;
  askForTable?: boolean;
  guestCount?: number;
  /** The table, room or tab the order goes to. */
  label?: string;
  /** Who took the order: the dish goes back to them. */
  waiterName?: string;
  /** Who sent this round, when it isn't the waiter. */
  sentByName?: string;
  sentAt?: string;
  notes?: string;
  /** Printed again: says COPY, so nobody makes it twice. */
  copy?: boolean;
  /** Who printed it again. */
  printedAgainByName?: string;
  printedAgainAt?: string;
  lines: { fulfilment?: Fulfilment; quantity: number; name: string; options: string[]; tags?: string }[];
}

export type Fulfilment = "PREPARED" | "PICKED" | "DIRECT";
export interface QuantitySettings { quantityBold?: boolean; quantityLarge?: boolean }

export function kitchenTicketTitle(station: string | undefined): string {
  return station?.toUpperCase() === "BAR" ? "BAR ORDER" : "KITCHEN ORDER";
}

/** Missing modes on older documents retain the established prepared behaviour. */
export function productionGroups<T extends { fulfilment?: Fulfilment }>(lines: T[]): { title: string; lines: T[] }[] {
  return [
    { title: "HAND OVER", lines: lines.filter(line => line.fulfilment === "PICKED") },
    { title: "MAKE", lines: lines.filter(line => line.fulfilment !== "PICKED" && line.fulfilment !== "DIRECT") },
  ].filter(group => group.lines.length > 0);
}

export function kitchenTicketBytes(ticket: KitchenTicketPaper, width: PaperWidth, settings: QuantitySettings = {}): Uint8Array {
  const groups = productionGroups(ticket.lines);
  if (!groups.length) return new Uint8Array();
  const out = new EscPos(width).align("center").bold(true).size(1, 2).line(kitchenTicketTitle(ticket.station)).size(1, 1);
  const number = ticket.dailyNumber ?? ticket.orderNumber;
  out.wrapped(`${number !== undefined ? `ORDER ${number}` : "ORDER"}${ticket.roundNumber ? ` · ROUND ${ticket.roundNumber}${ticket.roundNumber > 1 ? " · ADDED" : ""}` : ""}`);
  if (ticket.copy) {
    out.line("*** COPY: printed again ***");
    if (ticket.printedAgainAt) out.wrapped(dateTimeWords(ticket.printedAgainAt));
    if (ticket.printedAgainByName) out.wrapped(`by ${ticket.printedAgainByName}`, width);
  }
  if (ticket.station && ticket.station !== "BAR") out.wrapped(stationWords(ticket.station));
  out.bold(false).align("left").rule();

  const place = ticket.serviceType ? orderPlaceWords(ticket.serviceType, ticket.label, ticket.askForTable) : placeWords(undefined, ticket.label, ticket.askForTable);
  const service = ticket.serviceType ? serviceTypeWords(ticket.serviceType) : "";
  const where = [place, service].filter(Boolean).join(" - ");
  if (where) out.bold(true).size(1, 2).wrapped(where).size(1, 1).bold(false);
  if (ticket.guestCount) out.wrapped(guestCountWords(ticket.guestCount));
  if (ticket.waiterName) out.bold(true).size(1, 2).wrapped(`Taken by ${ticket.waiterName}`).size(1, 1).bold(false);
  if (ticket.sentByName && ticket.sentByName !== ticket.waiterName) out.wrapped(`Sent by ${ticket.sentByName}`);
  const sent = clockTime(ticket.sentAt);
  if (sent) out.line(`Sent ${sent}`);
  out.rule();

  for (const group of groups) {
    out.bold(true).line(group.title).bold(false);
    for (const line of group.lines) {
      // Double height keeps all 32/48 characters available.
      out.bold(settings.quantityBold ?? true).size(1, (settings.quantityLarge ?? true) ? 2 : 1).wrapped(`${line.quantity} x ${line.name}`).size(1, 1).bold(false);
      for (const option of line.options) out.wrapped(option, width, "   - ");
      if (line.tags) out.bold(true).wrapped(line.tags, width, "   ! ").bold(false);
    }
  }
  if (ticket.notes?.trim()) {
    out.rule().bold(true).line("NOTE").bold(false).wrapped(ticket.notes.trim());
  }
  out.rule().wrapped(`*** END · ${groups.flatMap(group => group.lines).reduce((sum, line) => sum + line.quantity, 0)} ITEMS ***`);
  return out.feed(3).cut().build();
}
