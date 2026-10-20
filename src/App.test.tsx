import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";

// The till's phase, so a test can lock it (F-264).
const device = vi.hoisted(() => ({ phase: "ready" as "ready" | "locked" }));

vi.mock("./auth/DeviceSessionProvider", () => ({
  DeviceSessionProvider: ({ children }: { children: React.ReactNode }) => children,
  useDeviceSession: () => ({
    shell: device.phase === "ready" ? "OPERATIONAL" : "PAIRED_LOCKED",
    phase: device.phase,
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

vi.mock("./pages/ActiveOrders", () => ({
  ActiveOrders: () => <div data-testid="active-orders-screen">Active orders</div>,
}));

vi.mock("./pages/PinUnlock", () => ({
  PinUnlock: () => <div data-testid="pin-unlock">Enter your PIN</div>,
}));

describe("production post-login shell", () => {
  it("reaches the existing operational register without a legacy onboarding decision", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId("pos-register")).toBeInTheDocument();
    expect(screen.getByTestId("pos-register")).toHaveClass("terminal-shell");
    expect(screen.getByTestId("terminal-navigation")).toHaveAttribute("aria-label", "Till sections");
    expect(screen.getByTestId("terminal-workspace")).toHaveClass("terminal-workspace");
    expect(screen.getByTestId("active-orders-screen")).toBeInTheDocument();
    expect(screen.getByTestId("shell-state")).toHaveTextContent("OPERATIONAL");
    expect(screen.queryByTestId("verification-unknown")).not.toBeInTheDocument();
  });

  // F-264 (to check, 2026-10-20): a void sheet seemed to stay open across a
  // lock and a sign-in. Lock, Switch person, the idle lock and an expired
  // session all lock the till (switchStaff): the screens close, and with them
  // any sheet open on them. The next person starts afresh.
  it("locking the till closes the screens and anything open on them", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // A new element each time, so React renders the till again with its new phase.
    const app = () => (
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    );
    device.phase = "ready";
    const { rerender } = render(app());
    expect(screen.getByTestId("active-orders-screen")).toBeInTheDocument();

    device.phase = "locked";
    rerender(app());
    expect(screen.queryByTestId("active-orders-screen")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pos-register")).not.toBeInTheDocument();
    expect(screen.getByTestId("pin-unlock")).toBeInTheDocument();
    device.phase = "ready";
  });
});
