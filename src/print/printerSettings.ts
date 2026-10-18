import type { PrepStation } from "../lib/posContracts";
import { PAPER_58MM, PAPER_80MM, type PaperWidth } from "./escpos";

/**
 * Where this till prints (S8a): kitchen tickets on paper for a kitchen or
 * bar without a screen, to a printer of the station's own, else the
 * kitchen's, else this till's own printer as before. Kept on the till: a
 * printer is a thing in this building, not in Yetu.
 */

/** A printer this computer knows (Windows or CUPS), or one on the network (raw, port 9100). */
export type PrinterTarget = { kind: "system"; name: string } | { kind: "network"; host: string; port: number };

export interface PrinterChoice {
  target: PrinterTarget;
  width: PaperWidth;
}

export interface PrinterSettings {
  /** Print kitchen tickets on paper when an order or a round is sent. */
  kitchenTickets: boolean;
  /** Where kitchen tickets go when their station has no printer of its own. */
  kitchen: PrinterChoice | null;
  /** A station's own printer: the bar's, the grill's. */
  stations: Partial<Record<PrepStation, PrinterChoice>>;
}

/** Paper kitchen tickets on, sent to this till's own printer until a kitchen printer is chosen. */
export const DEFAULT_PRINTER_SETTINGS: PrinterSettings = { kitchenTickets: true, kitchen: null, stations: {} };

/** The usual port a network receipt printer takes raw jobs on. */
export const RAW_PRINT_PORT = 9100;
/** The last port a print server with several printers uses (9100 to 9109): the till prints to no other (raw_print.rs RAW_PORTS). */
export const RAW_PRINT_PORT_LAST = 9109;

/** A numbered address on this building's network: private, link-local or this computer. */
function localIPv4(parts: number[]): boolean {
  const [a, b] = parts;
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

/** The printer a station's kitchen ticket goes to; null: this till's own printer, as before. */
export function printerFor(settings: PrinterSettings, station: string | undefined): PrinterChoice | null {
  const own = station ? settings.stations[station as PrepStation] : undefined;
  return own ?? settings.kitchen ?? null;
}

/**
 * A network printer's address as a person types it ("192.168.1.50" or
 * "kitchen-printer.local:9100"); null when it isn't one, or isn't a printer
 * in this building (a printing port, a local address).
 */
export function parseNetworkAddress(text: string): { host: string; port: number } | null {
  const trimmed = text.trim();
  const match = /^([A-Za-z0-9.-]+)(?::(\d{1,5}))?$/.exec(trimmed);
  if (!match) return null;
  const host = match[1];
  const port = match[2] ? Number(match[2]) : RAW_PRINT_PORT;
  if (port < RAW_PRINT_PORT || port > RAW_PRINT_PORT_LAST) return null;
  const ipv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  const parts = host.split(".").map(Number);
  if (ipv4 && (parts.some((part) => part > 255) || !localIPv4(parts))) return null;
  if (!ipv4 && (host.startsWith(".") || host.endsWith(".") || host.startsWith("-"))) return null;
  return { host, port };
}

/** A printer as staff read it: its name, or its network address. */
export function printerWords(choice: PrinterChoice | null): string {
  if (!choice) return "This till's own printer";
  const where = choice.target.kind === "system"
    ? choice.target.name
    : `${choice.target.host}${choice.target.port === RAW_PRINT_PORT ? "" : `:${choice.target.port}`}`;
  return `${where} (${choice.width === PAPER_80MM ? "80 mm" : "58 mm"})`;
}

/** Settings read back from the till, made whole: anything missing or wrong is the default. */
export function settingsFrom(raw: unknown): PrinterSettings {
  if (!raw || typeof raw !== "object") return DEFAULT_PRINTER_SETTINGS;
  const value = raw as Record<string, unknown>;
  const choice = (input: unknown): PrinterChoice | null => {
    if (!input || typeof input !== "object") return null;
    const c = input as { target?: Record<string, unknown>; width?: unknown };
    const width: PaperWidth = c.width === PAPER_80MM ? PAPER_80MM : PAPER_58MM;
    const t = c.target;
    if (t?.kind === "system" && typeof t.name === "string" && t.name.trim()) return { target: { kind: "system", name: t.name }, width };
    if (t?.kind === "network" && typeof t.host === "string" && typeof t.port === "number") {
      const parsed = parseNetworkAddress(`${t.host}:${t.port}`);
      return parsed ? { target: { kind: "network", ...parsed }, width } : null;
    }
    return null;
  };
  const stations: PrinterSettings["stations"] = {};
  if (value.stations && typeof value.stations === "object") {
    for (const [station, c] of Object.entries(value.stations as Record<string, unknown>)) {
      const parsed = choice(c);
      if (parsed) stations[station as PrepStation] = parsed;
    }
  }
  return {
    kitchenTickets: typeof value.kitchenTickets === "boolean" ? value.kitchenTickets : DEFAULT_PRINTER_SETTINGS.kitchenTickets,
    kitchen: choice(value.kitchen),
    stations,
  };
}
