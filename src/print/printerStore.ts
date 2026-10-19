import { DEFAULT_PRINTER_SETTINGS, settingsFrom, type PrinterSettings, type PrinterTarget } from "./printerSettings";

/**
 * This till's printer settings and its raw print path (S8a), through the
 * till app (src-tauri printer.rs). In a browser there is no printer: the
 * settings are the defaults and printing says so.
 */

function inTill(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(command, args);
}

export async function loadPrinterSettings(): Promise<PrinterSettings> {
  if (!inTill()) return DEFAULT_PRINTER_SETTINGS;
  try {
    return settingsFrom(await invoke<unknown>("load_printer_settings"));
  } catch {
    return DEFAULT_PRINTER_SETTINGS;
  }
}

export async function savePrinterSettings(settings: PrinterSettings): Promise<void> {
  if (!inTill()) throw new Error("Printers are set up in the till app on this computer.");
  await invoke("save_printer_settings", { settings });
}

export async function listSystemPrinters(): Promise<string[]> {
  if (!inTill()) return [];
  try {
    return await invoke<string[]>("list_printers");
  } catch {
    return [];
  }
}

export async function printRawToPrinter(target: PrinterTarget, bytes: Uint8Array): Promise<void> {
  if (!inTill()) throw new Error("No printer is set up on this till");
  await invoke("print_raw", { target, bytes: Array.from(bytes) });
}
