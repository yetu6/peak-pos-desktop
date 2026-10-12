import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";

/** A till signed in offline (PIN unlock with Yetu unreachable: the certified offline lease). */
vi.mock("./auth/DeviceSessionProvider", () => ({
  DeviceSessionProvider: ({ children }: { children: React.ReactNode }) => children,
  useDeviceSession: () => ({
    shell: "OPERATIONAL",
    phase: "ready",
    session: {
      token: "",
      expiresAt: "2099-01-01T00:00:00Z",
      tenantId: "offline-local",
      propertyId: "property-1",
      outletId: "outlet-1",
      terminalId: "terminal-1",
      staffId: "staff-amina",
      assurance: "RESTRICTED",
      mode: "offline-cash",
      capabilities: ["CORE", "POS"],
      permissions: [],
    },
    identity: { mode: "POS", terminalName: "Main Restaurant" },
    switchStaff: vi.fn(),
    keyStorageWarning: null,
    roster: [],
  }),
}));

vi.mock("./hooks/usePosData", () => ({
  useOutletId: () => "outlet-1",
  usePropertyId: () => "property-1",
  useHasPermission: () => false,
  usePosShift: () => ({ shift: null, isLoading: false, open: {}, close: {} }),
}));

vi.mock("./realtime/RealtimeProvider", () => ({
  RealtimeProvider: ({ children }: { children: React.ReactNode }) => children,
  useRealtimeEvents: vi.fn(),
  useRealtime: () => ({ state: { phase: "disconnected", attempt: 0, lastError: null, established: false, resyncGeneration: 0 } }),
}));

vi.mock("./pages/OfflineNewOrder", () => ({ OfflineNewOrder: () => <div data-testid="offline-new-order" /> }));

describe("working offline", () => {
  it("shows the fixed offline banner under the top bar, over Sell", () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <App />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("offline-new-order")).toBeInTheDocument();
    const banner = screen.getByTestId("offline-banner");
    expect(banner).toHaveTextContent("Working offline. Cash only. Sales are saved on this till and sent when the connection returns.");
    expect(banner.closest(".y-banners")).not.toBeNull();
  });
});
