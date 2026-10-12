import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";

/**
 * Owner decision 2026-10-12: a kitchen or bar display takes no cash, so it
 * needs no shift. Yetu agrees: listing and stepping station tickets check only
 * the order permission and the display's prep stations (fbc-peak
 * internal/pos/stations.go). Tills still open a shift before they sell.
 */

const device = vi.hoisted(() => ({ mode: "KITCHEN_DISPLAY" }));

vi.mock("./auth/DeviceSessionProvider", () => ({
  DeviceSessionProvider: ({ children }: { children: React.ReactNode }) => children,
  useDeviceSession: () => ({
    shell: "OPERATIONAL",
    phase: "ready",
    session: {
      token: "ops-live-session-token-0123456789abcdef",
      expiresAt: "2099-01-01T00:00:00Z",
      tenantId: "organization-1",
      propertyId: "property-1",
      outletId: "outlet-1",
      terminalId: "terminal-1",
      staffId: "staff-1",
      assurance: "RESTRICTED",
      permissions: ["pos.order.read", "pos.order.send"],
    },
    identity: { mode: device.mode, terminalName: "Kitchen pass" },
    switchStaff: vi.fn(),
    keyStorageWarning: null,
    roster: [],
  }),
}));

vi.mock("./hooks/usePosData", () => ({
  useOutletId: () => "outlet-1",
  usePropertyId: () => "property-1",
  useHasPermission: () => true,
  usePosShift: () => ({
    shift: null,
    isLoading: false,
    open: { mutate: vi.fn(), isPending: false, error: null, reset: vi.fn() },
    close: { mutate: vi.fn(), isPending: false, error: null },
  }),
}));

vi.mock("./realtime/RealtimeProvider", () => ({
  RealtimeProvider: ({ children }: { children: React.ReactNode }) => children,
  useRealtimeEvents: vi.fn(),
  useRealtime: () => ({ state: { phase: "connected", attempt: 0, lastError: null, established: true, resyncGeneration: 1 } }),
}));

vi.mock("./pages/Kitchen", () => ({ Kitchen: () => <div data-testid="kitchen-screen" /> }));
vi.mock("./pages/ActiveOrders", () => ({ ActiveOrders: () => <div data-testid="active-orders-screen" /> }));
vi.mock("./pages/OpenShiftScreen", () => ({ OpenShiftScreen: () => <div data-testid="open-shift-screen" /> }));

function renderApp() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <App />
    </QueryClientProvider>,
  );
}

describe("a device with no shift open", () => {
  it.each(["KITCHEN_DISPLAY", "BAR_DISPLAY"])("a %s goes straight to its board", (mode) => {
    device.mode = mode;
    renderApp();
    expect(screen.getByTestId("shell-state")).toHaveTextContent("OPERATIONAL");
    expect(screen.getByTestId("kitchen-screen")).toBeInTheDocument();
    expect(screen.queryByTestId("open-shift-screen")).not.toBeInTheDocument();
  });

  it.each(["POS", "CASHIER"])("a %s till still opens its shift first", (mode) => {
    device.mode = mode;
    renderApp();
    expect(screen.getByTestId("shell-state")).toHaveTextContent("NO_SHIFT");
    expect(screen.getByTestId("open-shift-screen")).toBeInTheDocument();
  });
});
