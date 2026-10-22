import type { ServiceType } from "../lib/posContracts";
import type { KitchenTicketPaper } from "./kitchenTicket";
import type { PrinterSettings, PrinterTarget } from "./printerSettings";

/**
 * How this till prints Yetu's kitchen tickets (S8a): its printer settings,
 * the raw path to a thermal printer, and staff's tags for each item.
 */
export interface KitchenPrintRoutes {
  settings: PrinterSettings;
  /** Raw bytes to a printer (the till's print_raw). */
  printRaw: (target: PrinterTarget, bytes: Uint8Array) => Promise<void>;
  /** What staff say about an item ("Contains nuts"), from the outlet's menu. */
  tagsOf?: (productId: string) => string | undefined;
}

const SERVICE_TYPES: readonly ServiceType[] = ["DINE_IN", "TAKEAWAY", "ROOM_SERVICE"];

/** Yetu's kitchen print document (fbc-peak createStationTicketsAndPrintJobs) as the paper ticket. */
export function paperFromPrintDocument(
  document: Record<string, unknown>,
  tagsOf?: (productId: string) => string | undefined,
): KitchenTicketPaper {
  const text = (key: string) => (typeof document[key] === "string" && (document[key] as string).trim() ? (document[key] as string) : undefined);
  const number = (key: string) => (typeof document[key] === "number" ? (document[key] as number) : undefined);
  const items = Array.isArray(document.items) ? document.items : [];
  const service = text("serviceType");
  return {
    dailyNumber: number("dailyNumber"),
    orderNumber: text("orderNumber"),
    roundNumber: number("roundNumber"),
    station: text("station"),
    serviceType: service && (SERVICE_TYPES as readonly string[]).includes(service) ? (service as ServiceType) : undefined,
    label: text("tableLabel"),
    askForTable: typeof document.askForTable === "boolean" ? document.askForTable : undefined,
    guestCount: number("guestCount"),
    waiterName: text("waiterName"),
    sentByName: text("sentByName"),
    sentAt: text("sentAt"),
    notes: text("notes"),
    copy: document.copy === true,
    printedAgainByName: text("printedAgainByName"),
    printedAgainAt: text("printedAgainAt"),
    lines: items.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      if (typeof row.name !== "string") return [];
      const options = Array.isArray(row.modifiers)
        ? row.modifiers.flatMap((m) => (m && typeof m === "object" && typeof (m as { name?: unknown }).name === "string" ? [(m as { name: string }).name] : []))
        : [];
      const quantity = typeof row.quantity === "number" ? row.quantity : Number(row.quantity) || 1;
      const productId = typeof row.productId === "string" ? row.productId : undefined;
      const fulfilment = row.fulfilment === "PICKED" || row.fulfilment === "DIRECT" ? row.fulfilment : "PREPARED";
      return [{ fulfilment, quantity, name: row.name, options, tags: productId ? tagsOf?.(productId) : undefined }];
    }),
  };
}

