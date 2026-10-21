import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PRINTER_SETTINGS } from "../print/printerSettings";

const { preview, printers } = vi.hoisted(() => ({ preview: vi.fn(), printers: { kitchenTickets: true } }));
vi.mock("../hooks/usePosData", () => ({
  usePaperPreview: () => preview(),
  usePrinterSettings: () => ({ data: { ...DEFAULT_PRINTER_SETTINGS, ...printers }, isLoading: false, isError: false }),
}));
import { PaperPreviewSheet } from "./PaperPreviewSheet";

const paper = (station: string, item: string) => ({
  jobType: "KITCHEN_TICKET" as const,
  document: { orderId: "o1", orderNumber: "0007", dailyNumber: 7, station, roundNumber: 1, tableLabel: "T4", serviceType: "DINE_IN",
    items: [{ id: item, productId: item, name: item, quantity: 1, modifiers: [] }] },
});

function renderSheet(props: Partial<Parameters<typeof PaperPreviewSheet>[0]> = {}) {
  const onPrint = vi.fn();
  const onBack = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PaperPreviewSheet orderId="o1" kind="ROUND" busy={false} onPrint={onPrint} onBack={onBack} {...props} />
    </QueryClientProvider>,
  );
  return { onPrint, onBack };
}

describe("PaperPreviewSheet (owner, 2026-10-21)", () => {
  it("shows each station's paper on its own tab; Print prints", async () => {
    preview.mockReturnValue({ data: [paper("BAR", "Soda"), paper("HOT", "Chips")], isLoading: false, isError: false });
    const { onPrint, onBack } = renderSheet();
    const sheet = screen.getByRole("dialog", { name: "Print order" });
    expect(within(sheet).getByRole("tab", { name: "Bar" })).toHaveAttribute("aria-selected", "true");
    expect(within(sheet).getByTestId("paper-text")).toHaveTextContent("Soda");
    await userEvent.click(within(sheet).getByRole("tab", { name: "Hot kitchen" }));
    expect(within(sheet).getByTestId("paper-text")).toHaveTextContent("Chips");
    await userEvent.click(within(sheet).getByTestId("paper-print"));
    expect(onPrint).toHaveBeenCalledTimes(1);
    expect(onBack).not.toHaveBeenCalled();
  });

  it("Back prints nothing", async () => {
    preview.mockReturnValue({ data: [paper("BAR", "Soda")], isLoading: false, isError: false });
    const { onPrint, onBack } = renderSheet();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onPrint).not.toHaveBeenCalled();
  });

  it("a preview that can't be shown never stops the printing", () => {
    preview.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    renderSheet();
    expect(screen.getByTestId("paper-preview-problem")).toHaveTextContent("The papers can't be shown just now. You can still print.");
    expect(screen.getByTestId("paper-print")).toBeEnabled();
  });

  it("nothing to print: nothing to press", () => {
    preview.mockReturnValue({ data: [], isLoading: false, isError: false });
    renderSheet();
    expect(screen.getByText("Nothing to print yet.")).toBeInTheDocument();
    expect(screen.getByTestId("paper-print")).toBeDisabled();
  });

  it("nothing prints on this till: the order still goes to the kitchen's screen, and the button says Send", () => {
    printers.kitchenTickets = false;
    try {
      preview.mockReturnValue({ data: [paper("BAR", "Soda")], isLoading: false, isError: false });
      renderSheet();
      expect(screen.getByTestId("paper-not-here")).toHaveTextContent("This till prints no kitchen papers");
      expect(screen.getByTestId("paper-print")).toHaveTextContent("Send");
    } finally {
      printers.kitchenTickets = true;
    }
  });

  it("nothing new and no paper here: nothing to send, nothing to press", () => {
    printers.kitchenTickets = false;
    try {
      preview.mockReturnValue({ data: [paper("BAR", "Soda")], isLoading: false, isError: false });
      renderSheet({ nothingNew: true });
      expect(screen.getByTestId("paper-print")).toHaveTextContent("Nothing new to send");
      expect(screen.getByTestId("paper-print")).toBeDisabled();
    } finally {
      printers.kitchenTickets = true;
    }
  });

  it("Yetu's refusal is said in its words, and Print waits", () => {
    preview.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: new Error("TAB_WAITING_FOR_SHIFT") });
    renderSheet({ kind: "BILL", refusalOf: () => "Take this tab over first, then print its bill." });
    expect(screen.getByTestId("paper-preview-problem")).toHaveTextContent("Take this tab over first, then print its bill.");
    expect(screen.getByTestId("paper-print")).toBeDisabled();
  });

  it("nothing prints before it is shown: Print waits while the papers load", () => {
    preview.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    renderSheet();
    expect(screen.getByText("Getting the papers ready…")).toBeInTheDocument();
    expect(screen.getByTestId("paper-print")).toBeDisabled();
  });
});
