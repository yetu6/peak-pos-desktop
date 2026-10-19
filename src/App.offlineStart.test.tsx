import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";

// F-228: Yetu gives a till its offline start-up only while a shift is open.
// A till signed in before its shift opened asks again once it opens.

const { state, prepareOffline } = vi.hoisted(() => ({
  state: { shift: null as null | { id: string; businessDate: string; status: string } },
  prepareOffline: vi.fn(async () => {}),
}));

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
    prepareOffline,
    keyStorageWarning: null,
  }),
}));

vi.mock("./hooks/usePosData", () => ({
  useOutletId: () => "outlet-1",
  usePosShift: () => ({
    shift: state.shift,
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

vi.mock("./pages/OpenShiftScreen", () => ({ OpenShiftScreen: () => <p>Open a shift</p> }));
vi.mock("./pages/ActiveOrders", () => ({ ActiveOrders: () => <p>The open orders</p> }));

function app() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  );
}

describe("the till's offline start-up once a shift opens (F-228)", () => {
  it("asks Yetu again when the shift opens on this till, once", () => {
    prepareOffline.mockClear();
    state.shift = null;
    const { rerender } = render(app());
    expect(screen.getByText("Open a shift")).toBeInTheDocument();
    expect(prepareOffline).not.toHaveBeenCalled();

    state.shift = { id: "shift-1", businessDate: "2026-10-19", status: "OPEN" };
    rerender(app());
    expect(screen.getByText("The open orders")).toBeInTheDocument();
    expect(prepareOffline).toHaveBeenCalledTimes(1);
    rerender(app());
    expect(prepareOffline).toHaveBeenCalledTimes(1);
  });

  it("a person signing in to a shift already open had it at sign-in: not asked again", () => {
    prepareOffline.mockClear();
    state.shift = { id: "shift-1", businessDate: "2026-10-19", status: "OPEN" };
    render(app());
    expect(prepareOffline).not.toHaveBeenCalled();
  });
});
