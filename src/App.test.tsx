import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";

vi.mock("./auth/DeviceSessionProvider", () => ({
  DeviceSessionProvider: ({ children }: { children: React.ReactNode }) => children,
  useDeviceSession: () => ({
    shell: "OPERATIONAL",
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
  usePropertyId: () => "property-1",
  useRealtimeEvents: vi.fn(),
  usePosShift: () => ({ shift: null, open: { mutate: vi.fn(), isPending: false, error: null }, close: { mutate: vi.fn(), isPending: false, error: null } }),
}));

vi.mock("./realtime/RealtimeProvider", () => ({
  RealtimeProvider: ({ children }: { children: React.ReactNode }) => children,
  useRealtimeEvents: vi.fn(),
  useRealtime: () => ({ state: { phase: "connected" } }),
}));

vi.mock("./pages/ActiveOrders", () => ({
  ActiveOrders: () => <div data-testid="active-orders-screen">Active orders</div>,
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
    expect(screen.getByTestId("active-orders-screen")).toBeInTheDocument();
    expect(screen.queryByTestId("verification-unknown")).not.toBeInTheDocument();
  });
});
