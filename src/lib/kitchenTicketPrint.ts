import { PAPER_WORDS, extraCopyWords, roundWords, type ExtraCopy } from "../print/paperWords";
import { printBrandFooter } from "../print/printBrand";
import { guestCountWords } from "./words";
import { kitchenTicketTitle, productionGroups, type Fulfilment } from "../print/kitchenTicket";
import { orderName } from "./orderNumber";
import { dateTimeWords, placeWords, serviceTypeWords } from "./words";
import { stationWords } from "../kitchen/kitchenWords";
import type { ServiceType } from "./posContracts";
export interface KitchenTicketLine {
  name: string;
  quantity: string;
  note?: string;
  fulfilment?: Fulfilment;
}

/** Device copy of a Peak kitchen ticket. No prices — Peak already owns those. */
export interface KitchenTicketCopy {
  roundNumber?: number;
  copy?: boolean;
  /** One of the station's extra copies (printer settings), numbered. */
  extraCopy?: ExtraCopy;
  printedAgainByName?: string;
  printedAgainAt?: string;
  ticketNumber?: string;
  /** The order's reference; printed only when it has no number for the day. */
  orderNumber?: string;
  /** S5b: the number the kitchen calls out ("Order 42"). */
  dailyNumber?: number;
  tableNumber?: string;
  serviceType?: string;
  askForTable?: boolean;
  guestCount?: number;
  /** The station it goes to (Kitchen, Bar), for the title. */
  station?: string;
  notes?: string;
  waiterName?: string;
  sentAt?: string;
  status?: string;
  lines: KitchenTicketLine[];
}

export interface PrintResult {
  ok: boolean;
  error?: string;
  /** Which paper: a void reports its own slips, not an older ticket waiting on the same order. */
  jobType?: string;
}

export function formatKitchenTicket(ticket: KitchenTicketCopy): string {
  const groups = productionGroups(ticket.lines);
  if (!groups.length) return "";
  const header = [
    // The paper's title (2026-10-20): an order to make, and where.
    kitchenTicketTitle(ticket.station),
    ticket.ticketNumber ? ticket.ticketNumber : null,
    ticket.dailyNumber || ticket.orderNumber ? `${orderName(ticket)}${roundWords(ticket.roundNumber)}` : null,
    ticket.extraCopy ? extraCopyWords(ticket.extraCopy) : null,
    ticket.copy ? PAPER_WORDS.printedAgain : null,
    ticket.copy && ticket.printedAgainAt ? dateTimeWords(ticket.printedAgainAt) : null,
    ticket.copy && ticket.printedAgainByName ? `by ${ticket.printedAgainByName}` : null,
    // As on the thermal paper: the station by name, the bar's own title says Bar.
    ticket.station && ticket.station !== "BAR" ? stationWords(ticket.station) : null,
    [
      placeWords(ticket.serviceType, ticket.tableNumber, ticket.askForTable) || null,
      ticket.serviceType ? serviceTypeWords(ticket.serviceType as ServiceType) : null,
    ]
      .filter(Boolean)
      .join("  "),
    ticket.guestCount ? guestCountWords(ticket.guestCount) : null,
    ticket.waiterName ? `Waiter ${ticket.waiterName}` : null,
    ticket.sentAt ? `Sent ${ticket.sentAt}` : null,
    ticket.notes?.trim() ? `Notes ${ticket.notes.trim()}` : null,
    ticket.status ? `Status ${ticket.status}` : null,
  ]
    .filter((line) => line && line.length > 0)
    .join("\n");

  const lines = groups.map(group => `${group.title}\n${group.lines
    .map((line) => {
      const qty = line.quantity.trim() || "1";
      const row = `${qty.padStart(3, " ")}  ${line.name}`;
      return line.note?.trim() ? `${row}\n      ${line.note.trim()}` : row;
    })
    .join("\n")}`).join("\n");

  return `${header}\n\n${lines || "(no items)"}\n\n${printBrandFooter()}\n`;
}

export function ticketCopyFromOrder(order: {
  orderNumber?: string | null;
  dailyNumber?: number | null;
  tableNumber?: string | null;
  guestCount?: number | null;
  askForTable?: boolean;
  tableLabel?: string | null;
  serviceType?: string | null;
  notes?: string | null;
  initiatedByName?: string | null;
  items?: Array<{
    name?: string | null;
    quantity?: number | string | null;
    specialRequest?: string | null;
    modifiers?: Array<{ optionName?: string | null; name?: string | null }> | null;
  }> | null;
}): KitchenTicketCopy {
  return {
    guestCount: order.guestCount ?? undefined,
    askForTable: order.askForTable,
    orderNumber: order.orderNumber ?? undefined,
    dailyNumber: order.dailyNumber ?? undefined,
    tableNumber: order.tableNumber ?? order.tableLabel ?? undefined,
    serviceType: order.serviceType ?? undefined,
    notes: order.notes ?? undefined,
    waiterName: order.initiatedByName ?? undefined,
    lines: (order.items ?? []).flatMap((item) => {
      if (!item.name) return [];
      const mods = (item.modifiers ?? [])
        .map((mod) => mod.optionName ?? mod.name)
        .filter((name): name is string => Boolean(name?.trim()));
      return [
        {
          name: item.name,
          quantity: String(item.quantity ?? 1),
          note: item.specialRequest?.trim() || (mods.length ? mods.join(", ") : undefined),
        },
      ];
    }),
  };
}

export function ticketCopyFromKitchenTicket(ticket: {
  ticketNumber?: string | null;
  orderId?: string | null;
  sentAt?: string | null;
  status?: string | null;
  items?: Array<{
    itemName?: string | null;
    quantity?: number | string | null;
    specialRequest?: string | null;
  }> | null;
}): KitchenTicketCopy {
  return {
    ticketNumber: ticket.ticketNumber ?? undefined,
    orderNumber: ticket.orderId ? ticket.orderId.slice(0, 8) : undefined,
    sentAt: ticket.sentAt ?? undefined,
    status: ticket.status ?? undefined,
    lines: (ticket.items ?? []).flatMap((item) => {
      if (!item.itemName) return [];
      return [
        {
          name: item.itemName,
          quantity: String(item.quantity ?? 1),
          note: item.specialRequest ?? undefined,
        },
      ];
    }),
  };
}

async function defaultInvoke(command: string, args: Record<string, unknown>): Promise<void> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    throw new Error("No printer is set up on this till");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke(command, args);
}

/**
 * Prints a copy of a Peak kitchen ticket. Failure is a device problem —
 * callers must not void or unsend the Peak ticket.
 */
export async function printKitchenTicket(
  ticket: KitchenTicketCopy,
  invokeFn: (command: string, args: Record<string, unknown>) => Promise<unknown> = defaultInvoke,
): Promise<PrintResult> {
  try {
    await invokeFn("print_kitchen_ticket", { ticket: { text: formatKitchenTicket(ticket) } });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message || "No printer is set up on this till" };
  }
}
