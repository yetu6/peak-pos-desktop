import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { DeviceSessionProvider, useDeviceSession } from "./auth/DeviceSessionProvider";
import { Icon } from "./components/Icon";
import { ConnectivityIndicator } from "./components/ConnectivityIndicator";
import { ThemeToggle } from "./components/ThemeToggle";
import { ActiveOrders } from "./pages/ActiveOrders";
import { Kitchen } from "./pages/Kitchen";
import { NewOrder } from "./pages/NewOrder";
import { PairingScreen } from "./pages/PairingScreen";
import { PinUnlock } from "./pages/PinUnlock";
import { SetupScreen } from "./pages/SetupScreen";
import { RealtimeClient } from "./realtime/RealtimeClient";
import { RealtimeProvider, useRealtimeEvents } from "./realtime/RealtimeProvider";
import { useOutletId, usePropertyId } from "./hooks/usePosData";
import { REALTIME_BRIDGE_URL } from "./lib/env";
import {
  createRealtimeBackfill,
  createRealtimeCursorStorage,
} from "./lib/realtimeBackfill";
import { SessionExpiredError } from "./lib/operationalSession";

type Page = "orders" | "new" | "kitchen";

const NAV: Array<{ page: Page; label: string; icon: "orders" | "kitchen" | "plus" }> = [
  { page: "orders", label: "Active Orders", icon: "orders" },
  { page: "new", label: "New Order", icon: "plus" },
  { page: "kitchen", label: "Kitchen", icon: "kitchen" },
];

function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);
  return now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function staffLabel(staffNumber: string | undefined): { name: string; initials: string } {
  const name = staffNumber?.trim() || "Staff";
  return { name, initials: name.slice(0, 2).toUpperCase() };
}

function PosShell() {
  const { session, switchStaff, shell, identity } = useDeviceSession();
  const [page, setPage] = useState<Page>("orders");
  const outletId = useOutletId();
  const propertyId = usePropertyId();
  const clock = useClock();
  const [lastEvent, setLastEvent] = useState<string | null>(null);
  const staff = staffLabel(session?.staffNumber);

  useRealtimeEvents(
    { kind: "propertyOperations", propertyId },
    (event) => setLastEvent(`${event.type} #${event.aggregateVersion ?? "?"}`),
  );

  return (
    <div className="flex h-screen overflow-hidden" data-testid="pos-register">
      <aside className="flex w-60 shrink-0 flex-col bg-[var(--color-pos-sidebar)]">
        <div className="flex h-14 items-center gap-2 px-4">
          <Icon name="peak-logo" size={22} className="text-[#D4A017]" />
          <span className="font-display text-lg text-white">Peak POS</span>
        </div>
        <nav className="flex-1 overflow-y-auto py-2">
          {NAV.map((item) => (
            <button
              key={item.page}
              data-testid={`nav-${item.page}`}
              onClick={() => setPage(item.page)}
              className={`flex h-10 w-full items-center gap-3 border-l-[3px] px-4 text-left text-sm transition-colors ${
                page === item.page
                  ? "border-[var(--color-gold)] bg-black/20 font-medium text-white"
                  : "border-transparent text-[rgba(255,255,255,0.65)] hover:bg-white/5 hover:text-white"
              }`}
            >
              <Icon name={item.icon} size={18} />
              {item.label}
            </button>
          ))}
        </nav>
        <div className="border-t border-white/10 p-3">
          <div className="flex items-center gap-3 px-2 py-1">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-brand)] text-xs font-semibold text-white">
              {staff.initials}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold text-white" data-testid="staff-name">
                {staff.name}
              </div>
              <div className="truncate text-[11px] text-[rgba(255,255,255,0.5)]" data-testid="till-label">
                {identity?.terminalName?.trim() ||
                  (outletId ? `outlet ${outletId.slice(0, 8)}` : "property till")}
              </div>
            </div>
            <button
              data-testid="switch-staff"
              onClick={() => switchStaff()}
              className="rounded-md p-1 text-[rgba(255,255,255,0.5)] hover:bg-white/10 hover:text-white"
              aria-label="Switch staff"
              title="Switch staff"
            >
              <Icon name="logout" size={16} />
            </button>
          </div>
          <div className="sr-only" data-testid="shell-state">
            {shell}
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass flex h-14 shrink-0 items-center gap-4 border-b border-[var(--color-border)] px-5">
          <span className="text-[13px] font-semibold text-[var(--color-text-secondary)]">
            {clock}
          </span>
          <span className="h-5 w-px bg-[var(--color-border)]" />
          <div className="min-w-0 flex-1">
            {lastEvent && (
              <span
                className="truncate text-[11px] text-[var(--color-text-muted)]"
                data-testid="last-event"
              >
                last event: {lastEvent}
              </span>
            )}
          </div>
          <ThemeToggle />
          <ConnectivityIndicator />
        </header>

        <main className="flex-1 overflow-auto p-6">
          {page === "orders" ? <ActiveOrders /> : page === "new" ? <NewOrder /> : <Kitchen />}
        </main>
      </div>
    </div>
  );
}

function LiveRegister() {
  const { switchStaff } = useDeviceSession();
  const queryClient = useQueryClient();
  const client = useMemo(
    () =>
      new RealtimeClient({
        createSocket: () => new WebSocket(REALTIME_BRIDGE_URL),
        backfillEvents: async (after) => {
          try {
            return await createRealtimeBackfill().fetchEvents(after);
          } catch (error) {
            if (error instanceof SessionExpiredError) {
              switchStaff("Session expired — enter your PIN again");
            }
            throw error;
          }
        },
        cursorStorage: createRealtimeCursorStorage(),
      }),
    [switchStaff],
  );

  return (
    <RealtimeProvider client={client} queryClient={queryClient}>
      <PosShell />
    </RealtimeProvider>
  );
}

function AuthGate() {
  const { shell, phase } = useDeviceSession();
  if (phase === "bootstrapping") {
    return (
      <div
        className="flex h-screen items-center justify-center bg-[var(--color-pos-sidebar)] text-white"
        data-testid="boot-screen"
      >
        <span className="sr-only" data-testid="shell-state">
          {shell}
        </span>
        Starting till…
      </div>
    );
  }
  if (phase === "needs-url") return <SetupScreen />;
  if (shell === "PAIRED_LOCKED") return <PinUnlock />;
  if (shell === "OPERATIONAL") return <LiveRegister />;
  return <PairingScreen />;
}

export function App() {
  return (
    <DeviceSessionProvider>
      <AuthGate />
    </DeviceSessionProvider>
  );
}
