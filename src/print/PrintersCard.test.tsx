import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrintersCard } from "./PrintersCard";
import { DEFAULT_PRINTER_SETTINGS } from "./printerSettings";

// The till app's printer bridge (src-tauri printer.rs): what it holds and what it was asked.
const till = vi.hoisted(() => ({
  saved: [] as unknown[],
  raw: [] as { target: unknown; bytes: Uint8Array }[],
  settings: null as unknown,
}));
vi.mock("./printerStore", () => ({
  loadPrinterSettings: async () => till.settings ?? DEFAULT_PRINTER_SETTINGS,
  listSystemPrinters: async () => ["EPSON TM-T20"],
  savePrinterSettings: async (settings: unknown) => void till.saved.push(settings),
  printRawToPrinter: async (target: unknown, bytes: Uint8Array) => void till.raw.push({ target, bytes }),
}));

const text = (bytes: Uint8Array) => Array.from(bytes, (b) => ((b >= 0x20 && b < 0x7f) || b === 0x0a ? String.fromCharCode(b) : "")).join("");

beforeEach(() => {
  till.saved = [];
  till.raw = [];
  till.settings = null;
});

describe("Status → Printers (S8a)", () => {
  it("sends kitchen tickets to a printer this computer knows, on 80 mm paper by default", async () => {
    render(<PrintersCard />);
    const picker = within(screen.getByTestId("kitchen-printer"));
    await userEvent.selectOptions(await picker.findByRole("combobox"), "system:EPSON TM-T20");
    await userEvent.click(screen.getByTestId("save-printers"));
    await waitFor(() => expect(till.saved).toHaveLength(1));
    expect(till.saved[0]).toEqual({ kitchenTickets: true, kitchen: { target: { kind: "system", name: "EPSON TM-T20" }, width: 48 }, stations: {}, receipt: null, cashDrawer: false });
    expect(screen.getByTestId("printers-words")).toHaveTextContent("Saved. Kitchen tickets print at EPSON TM-T20 (80 mm).");
  });

  it("takes a network printer's address as it reads on the printer, and says when it isn't one", async () => {
    render(<PrintersCard />);
    const picker = within(screen.getByTestId("kitchen-printer"));
    await userEvent.selectOptions(await picker.findByRole("combobox"), "network");
    const address = picker.getByLabelText(/Its address/);
    await userEvent.type(address, "192.168.1.300");
    expect(picker.getByText(/That isn't a printer in this building/)).toBeInTheDocument();
    await userEvent.clear(address);
    await userEvent.type(address, "192.168.1.50");
    await userEvent.click(within(screen.getByTestId("kitchen-printer")).getByRole("radio", { name: "58 mm paper" }));
    await userEvent.click(screen.getByTestId("save-printers"));
    await waitFor(() => expect(till.saved).toHaveLength(1));
    expect(till.saved[0]).toEqual({ kitchenTickets: true, kitchen: { target: { kind: "network", host: "192.168.1.50", port: 9100 }, width: 32 }, stations: {}, receipt: null, cashDrawer: false });
  });

  it("prints a test ticket to the chosen printer", async () => {
    till.settings = { kitchenTickets: true, kitchen: { target: { kind: "system", name: "EPSON TM-T20" }, width: 48 }, stations: {}, receipt: null, cashDrawer: false };
    render(<PrintersCard />);
    await waitFor(() => expect(within(screen.getByTestId("kitchen-printer")).getByRole("combobox")).toHaveValue("system:EPSON TM-T20"));
    await userEvent.click(screen.getByTestId("test-kitchen-printer"));
    await waitFor(() => expect(till.raw).toHaveLength(1));
    expect(till.raw[0].target).toEqual({ kind: "system", name: "EPSON TM-T20" });
    expect(text(till.raw[0].bytes)).toContain("Test ticket: this printer works");
  });

  it("a till whose kitchen has a screen prints no kitchen tickets", async () => {
    render(<PrintersCard />);
    await userEvent.click(await screen.findByTestId("kitchen-tickets-on"));
    expect(screen.queryByTestId("kitchen-printer")).toBeNull();
    await userEvent.click(screen.getByTestId("save-printers"));
    await waitFor(() => expect(till.saved).toHaveLength(1));
    expect(till.saved[0]).toEqual({ ...DEFAULT_PRINTER_SETTINGS, kitchenTickets: false });
    expect(screen.getByTestId("printers-words")).toHaveTextContent("Saved. This till won't print kitchen tickets.");
  });

  it("sends receipts to the receipt printer and opens its cash drawer for cash; a test receipt opens it too (S8b)", async () => {
    render(<PrintersCard />);
    const picker = within(screen.getByTestId("receipt-printer"));
    expect(screen.queryByTestId("cash-drawer-on")).toBeNull();
    await userEvent.selectOptions(await picker.findByRole("combobox"), "system:EPSON TM-T20");
    await userEvent.click(screen.getByTestId("cash-drawer-on"));
    await userEvent.click(screen.getByTestId("save-printers"));
    await waitFor(() => expect(till.saved).toHaveLength(1));
    expect(till.saved[0]).toMatchObject({ receipt: { target: { kind: "system", name: "EPSON TM-T20" }, width: 48 }, cashDrawer: true });
    expect(screen.getByTestId("printers-words")).toHaveTextContent("Bills print at EPSON TM-T20 (80 mm), and its cash drawer opens for cash.");
    await userEvent.click(screen.getByTestId("test-receipt-printer"));
    await waitFor(() => expect(till.raw).toHaveLength(1));
    expect(Array.from(till.raw[0].bytes).join(",")).toContain([0x1b, 0x70, 0, 25, 250].join(","));
    // Back to this till's own printer: no drawer to open.
    await userEvent.selectOptions(picker.getByRole("combobox"), "own");
    expect(screen.queryByTestId("cash-drawer-on")).toBeNull();
    await userEvent.click(screen.getByTestId("save-printers"));
    await waitFor(() => expect(till.saved).toHaveLength(2));
    expect(till.saved[1]).toMatchObject({ receipt: null, cashDrawer: false });
  });

  it("a station can print no paper on this till", async () => {
    render(<PrintersCard />);
    await userEvent.click(screen.getByText("A printer for one station (optional)"));
    await userEvent.selectOptions(within(screen.getByTestId("station-printer-BAR")).getByRole("combobox"), "nopaper");
    await userEvent.click(screen.getByTestId("save-printers"));
    await waitFor(() => expect(till.saved).toHaveLength(1));
    expect(till.saved[0]).toMatchObject({ stations: { BAR: "none" } });
  });
});
