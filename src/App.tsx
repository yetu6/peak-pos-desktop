import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { DeviceSessionProvider, useDeviceSession } from "./auth/DeviceSessionProvider";
import { Icon } from "./components/Icon";
import { ConnectivityIndicator } from "./components/ConnectivityIndicator";
import { ThemeToggle } from "./components/ThemeToggle";
import { ActiveOrders } from "./pages/ActiveOrders";
import { Kitchen } from "./pages/Kitchen";
import { Manager } from "./pages/Manager";
import { NewOrder } from "./pages/NewOrder";
import { PairingScreen } from "./pages/PairingScreen";
import { PinUnlock } from "./pages/PinUnlock";
import { SetupScreen } from "./pages/SetupScreen";
import { Diagnostics } from "./pages/Diagnostics";
import { RealtimeClient } from "./realtime/RealtimeClient";
import { RealtimeProvider, useRealtimeEvents } from "./realtime/RealtimeProvider";
import { useOutletId, usePropertyId } from "./hooks/usePosData";
import { REALTIME_BRIDGE_URL } from "./lib/env";
import { createRealtimeSocket } from "./lib/peakSocket";
import { getApiBaseUrl } from "./lib/peakConfig";
import {
  createRealtimeBackfill,
  createRealtimeCursorStorage,
} from "./lib/realtimeBackfill";
import { SessionExpiredError } from "./lib/operationalSession";
import { defaultWorkspacePage, workspaceNav, type WorkspacePage } from "./lib/workspace";
import { usePosShift } from "./hooks/usePosData";

type Page = WorkspacePage;

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
  const nav = workspaceNav(identity?.mode);
  const [page, setPage] = useState<Page>(() => defaultWorkspacePage(identity?.mode));
  const outletId = useOutletId();
  const propertyId = usePropertyId();
  const clock = useClock();
  const { shift } = usePosShift();
  const [lastEvent, setLastEvent] = useState<string | null>(null);
  const staff = staffLabel(session?.staffId);

  if (!nav.some((item) => item.page === page)) {
    setPage(nav[0]?.page ?? "orders");
  }

  useRealtimeEvents(
    { kind: "propertyOperations", propertyId },
    (event) => setLastEvent(`${event.type} #${event.aggregateVersion ?? "?"}`),
  );

  return (
    <div className="terminal-shell" data-testid="pos-register">
      <aside
        className="terminal-nav"
        data-testid="terminal-navigation"
        aria-label="Terminal navigation"
      >
        <div className="terminal-brand">
          <Icon name="peak-logo" size={24} className="text-[var(--gold-accent)]" />
          <span className="terminal-brand__name">Peak POS</span>
        </div>
        <nav className="terminal-nav__items">
          {nav.map((item) => (
            <button
              key={item.page}
              data-testid={`nav-${item.page}`}
              onClick={() => setPage(item.page)}
              className="terminal-nav__action"
              aria-current={page === item.page ? "page" : undefined}
              aria-label={item.label}
              title={item.label}
            >
              <Icon name={item.icon} size={20} />
              <span className="terminal-nav__label">{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="terminal-staff">
          <span className="terminal-staff__avatar">
              {staff.initials}
          </span>
          <div className="terminal-staff__meta">
            <div className="truncate text-xs font-semibold" data-testid="staff-name">
              {staff.name}
            </div>
            <div className="truncate text-[11px] text-[var(--foreground-muted)]" data-testid="till-label">
              {identity?.terminalName?.trim() ||
                (outletId ? `outlet ${outletId.slice(0, 8)}` : "property till")}
            </div>
          </div>
          <button
            data-testid="switch-staff"
            onClick={() => switchStaff()}
            className="btn-tertiary ml-auto !h-11 !w-11 !p-0"
            aria-label="Switch staff"
            title="Switch staff"
          >
            <Icon name="logout" size={18} />
          </button>
          <div className="sr-only" data-testid="shell-state">
            {shell}
          </div>
        </div>
      </aside>

      <div className="terminal-frame">
        <header className="terminal-header px-4">
          <span className="font-mono text-[13px] font-semibold tabular-nums text-[var(--foreground-muted)]">
            {clock}
          </span>
          <span className="h-5 w-px bg-[var(--border)]" />
          {shift ? (
            <span className="badge badge-success badge-dot" data-testid="shell-business-date">
              Business date {shift.businessDate}
            </span>
          ) : (
            <span className="badge badge-muted" data-testid="shell-shift-state">
              No shift open
            </span>
          )}
          <div className="min-w-0 flex-1">
            {lastEvent && (
              <span
                className="truncate text-[11px] text-[var(--foreground-muted)]"
                data-testid="last-event"
              >
                last event: {lastEvent}
              </span>
            )}
          </div>
          <ThemeToggle />
          <ConnectivityIndicator />
        </header>

        <main
          className={`terminal-workspace ${page === "new" ? "terminal-workspace--order" : ""}`}
          data-testid="terminal-workspace"
        >
          {page === "orders" ? (
            <ActiveOrders onNewOrder={() => setPage("new")} />
          ) : page === "new" ? (
            <NewOrder />
          ) : page === "kitchen" ? (
            <Kitchen />
          ) : page === "manager" ? (
            <Manager />
          ) : (
            <Diagnostics />
          )}
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
        createSocket: () => createRealtimeSocket({ peakApiUrl: getApiBaseUrl(), bridgeUrl: REALTIME_BRIDGE_URL }),
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

function KeyStorageBanner() {
  const { keyStorageWarning } = useDeviceSession();
  if (!keyStorageWarning) return null;
  return (
    <div
      className="fixed inset-x-0 top-0 z-50 bg-[#8B1E1E] px-4 py-2 text-center text-[12px] font-medium text-white"
      data-testid="key-storage-warning"
      role="alert"
    >
      {keyStorageWarning}
    </div>
  );
}

function AuthGate() {
  const { shell, phase } = useDeviceSession();
  let screen;
  if (phase === "bootstrapping") {
    screen = (
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
  } else if (phase === "needs-url") {
    screen = <SetupScreen />;
  } else if (shell === "PAIRED_LOCKED") {
    screen = <PinUnlock />;
  } else if (shell === "OPERATIONAL") {
    screen = <LiveRegister />;
  } else {
    screen = <PairingScreen />;
  }
  return (
    <>
      <KeyStorageBanner />
      {screen}
    </>
  );
}

export function App() {
  return (
    <DeviceSessionProvider>
      <AuthGate />
    </DeviceSessionProvider>
  );
}
