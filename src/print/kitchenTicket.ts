import { stationWords } from "../kitchen/kitchenWords";
import type { ServiceType } from "../lib/posContracts";
import { clockTime, orderPlaceWords, serviceTypeWords } from "../lib/words";
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
  lines: { quantity: number; name: string; options: string[]; tags?: string }[];
}

export function kitchenTicketBytes(ticket: KitchenTicketPaper, width: PaperWidth): Uint8Array {
  const out = new EscPos(width).align("center").bold(true).size(2, 2);
  const number = ticket.dailyNumber ?? ticket.orderNumber;
  out.line(number !== undefined ? `ORDER ${number}` : "ORDER");
  if (ticket.roundNumber && ticket.roundNumber > 1) out.size(1, 2).line(`ROUND ${ticket.roundNumber}`);
  out.size(1, 1);
  if (ticket.station) out.line(stationWords(ticket.station).toUpperCase());
  if (ticket.copy) out.line("*** COPY: printed again ***");
  out.bold(false).align("left").rule();

  const place = ticket.serviceType ? orderPlaceWords(ticket.serviceType, ticket.label) : ticket.label ? `Table ${ticket.label}` : "";
  const service = ticket.serviceType ? serviceTypeWords(ticket.serviceType) : "";
  const where = [place, service].filter(Boolean).join(" - ");
  if (where) out.bold(true).size(1, 2).wrapped(where).size(1, 1).bold(false);
  if (ticket.waiterName) out.bold(true).size(1, 2).wrapped(`Taken by ${ticket.waiterName}`).size(1, 1).bold(false);
  if (ticket.sentByName && ticket.sentByName !== ticket.waiterName) out.wrapped(`Sent by ${ticket.sentByName}`);
  const sent = clockTime(ticket.sentAt);
  if (sent) out.line(`Sent ${sent}`);
  out.rule();

  for (const line of ticket.lines) {
    // Large type holds half the characters a line does.
    out.bold(true).size(1, 2).wrapped(`${line.quantity} x ${line.name}`).size(1, 1).bold(false);
    for (const option of line.options) out.wrapped(option, width, "   - ");
    if (line.tags) out.bold(true).wrapped(line.tags, width, "   ! ").bold(false);
  }
  if (ticket.lines.length === 0) out.line("(nothing on this ticket)");
  if (ticket.notes?.trim()) {
    out.rule().bold(true).line("NOTE").bold(false).wrapped(ticket.notes.trim());
  }
  return out.rule().feed(3).cut().build();
}
