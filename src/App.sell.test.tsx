import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import type { POSOrder } from "./lib/posContracts";

// The shell's part of F-236: Sell's order outlives a look at Orders, and
// Orders' Add items opens an order on Sell. The pages are stand-ins here;
// what each does with the order is in its own tests.

vi.mock("./auth/DeviceSessionProvider", () => ({
  DeviceSessionProvider: ({ children }: { children: React.ReactNode }) => children,
  useDeviceSession: () => ({
    phase: "ready",
    session: {
      token: "ops-live",
      expiresAt: "2099-01-01T00:00:00Z",
      tenantId: "organization-1",
      propertyId: "property-1",
      outletId: "outlet-1",
      terminalId: "terminal-1",
      staffId: "staff-1",
      assurance: "RESTRICTED",
    },
    identity: { mode: "POS", terminalName: "Main Bar" },
    switchStaff: vi.fn(),
    keyStorageWarning: null,
  }),
}));

vi.mock("./hooks/usePosData", () => ({
  useOutletId: () => "outlet-1",
  usePosShift: () => ({
    shift: { id: "shift-1", businessDate: "2026-09-04", status: "OPEN" },
    open: { mutate: vi.fn(), isPending: false, error: null },
    close: { mutate: vi.fn(), isPending: false, error: null },
    isLoading: false,
  }),
}));

vi.mock("./realtime/RealtimeProvider", () => ({
  RealtimeProvider: ({ children }: { children: React.ReactNode }) => children,
  useRealtimeEvents: vi.fn(),
  useRealtime: () => ({ state: { phase: "connected" } }),
}));

const TABLE_4 = { id: "order-4", dailyNumber: 4, status: "SENT" } as POSOrder;
const TABLE_7 = { id: "order-7", dailyNumber: 7, status: "OPEN" } as POSOrder;

vi.mock("./pages/ActiveOrders", () => ({
  ActiveOrders: ({ onAddItems }: { onAddItems?: (order: POSOrder) => void }) => (
    <button type="button" onClick={() => onAddItems?.(TABLE_4)}>
      Add items to order 4
    </button>
  ),
}));

vi.mock("./pages/NewOrder", () => ({
  NewOrder: ({ resume, onTicket }: { resume?: POSOrder | null; onTicket?: (order: POSOrder | null) => void }) => (
    <div>
      <p data-testid="sell-ticket">{resume ? `Ticket: ${resume.id}` : "Ticket: empty"}</p>
      <button type="button" onClick={() => onTicket?.(TABLE_7)}>
        Ring up order 7
      </button>
    </div>
  ),
}));

function renderApp() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
}

describe("the till shell keeps Sell's order (F-236)", () => {
  it("a look at Orders and back finds the same order on Sell", async () => {
    renderApp();
    await userEvent.click(screen.getByTestId("nav-new"));
    expect(screen.getByTestId("sell-ticket")).toHaveTextContent("Ticket: empty");
    await userEvent.click(screen.getByRole("button", { name: "Ring up order 7" }));
    await userEvent.click(screen.getByTestId("nav-orders"));
    await userEvent.click(screen.getByTestId("nav-new"));
    expect(screen.getByTestId("sell-ticket")).toHaveTextContent("Ticket: order-7");
  });

  it("Add items in Orders opens that order on Sell", async () => {
    renderApp();
    await userEvent.click(screen.getByRole("button", { name: "Add items to order 4" }));
    expect(screen.getByTestId("sell-ticket")).toHaveTextContent("Ticket: order-4");
  });
});
