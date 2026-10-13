import { act, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";

/**
 * One realtime socket for each signed-in session. The shift check decides
 * between Open shift and the register; it must not decide whether the till
 * holds a live connection, or a till that opens its shift reconnects (S5's
 * live run: a socket opened while the check was in flight, closed at Open
 * shift, and another opened with the shift).
 */

const shiftState = vi.hoisted(() => ({
  current: { shift: null as null | { id: string; status: string; businessDate: string }, isLoading: true },
  listeners: new Set<() => void>(),
  set(next: { shift: null | { id: string; status: string; businessDate: string }; isLoading: boolean }) {
    this.current = next;
    this.listeners.forEach((listener) => listener());
  },
}));

const sockets = vi.hoisted(() => ({ opened: 0, closed: 0 }));

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
      permissions: ["pos.shift.open"],
    },
    identity: { mode: "POS", terminalName: "Main Bar" },
    switchStaff: vi.fn(),
    keyStorageWarning: null,
    roster: [],
  }),
}));

vi.mock("./hooks/usePosData", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useOutletId: () => "outlet-1",
    usePropertyId: () => "property-1",
    useHasPermission: () => true,
    useMutationMessage: () => null,
    useIdempotencyKey: () => ({ current: "key", next: () => crypto.randomUUID() }),
    usePosShift: () => {
      const state = useSyncExternalStore(
        (listener) => {
          shiftState.listeners.add(listener);
          return () => shiftState.listeners.delete(listener);
        },
        () => shiftState.current,
      );
      return {
        ...state,
        open: { mutate: vi.fn(), isPending: false, error: null, reset: vi.fn() },
        close: { mutate: vi.fn(), isPending: false, error: null },
      };
    },
  };
});

vi.mock("./lib/peakSocket", () => ({
  isTauriRuntime: () => false,
  usesRealtimeBridge: () => true,
  createRealtimeSocket: () => {
    sockets.opened += 1;
    const socket = {
      readyState: 0,
      onopen: null as null | (() => void),
      onclose: null as null | ((event: { reason: string }) => void),
      onmessage: null,
      onerror: null,
      send: () => undefined,
      close: () => {
        sockets.closed += 1;
        socket.readyState = 3;
      },
    };
    return socket;
  },
}));

vi.mock("./pages/ActiveOrders", () => ({ ActiveOrders: () => <div data-testid="active-orders-screen" /> }));
vi.mock("./pages/OpenShiftScreen", () => ({ OpenShiftScreen: () => <div data-testid="open-shift-screen" /> }));

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));

describe("realtime for a signed-in session", () => {
  it("keeps one socket from the shift check through Open shift to the register", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <App />
      </QueryClientProvider>,
    );
    await settle();
    // The shift check answers: no shift open.
    act(() => shiftState.set({ shift: null, isLoading: false }));
    await settle();
    expect(screen.getByTestId("open-shift-screen")).toBeInTheDocument();
    // The person opens the shift.
    act(() => shiftState.set({ shift: { id: "shift-1", status: "OPEN", businessDate: "2026-10-12" }, isLoading: false }));
    await settle();
    expect(screen.getByTestId("shell-state")).toHaveTextContent("OPERATIONAL");
    expect(sockets.opened).toBe(1);
    expect(sockets.closed).toBe(0);
  });
});
