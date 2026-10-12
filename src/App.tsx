import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { DeviceSessionProvider, useDeviceSession } from "./auth/DeviceSessionProvider";
import { AccessFrame } from "./access/AccessLayout";
import { IdleLockOverlay } from "./components/IdleLockOverlay";
import { ConnectivityIndicator } from "./components/ConnectivityIndicator";
import { KeyStorageBanner } from "./components/KeyStorageBanner";
import { UpdaterBanner } from "./components/UpdaterBanner";
import { ActiveOrders } from "./pages/ActiveOrders";
import { Kitchen } from "./pages/Kitchen";
import { Manager } from "./pages/Manager";
import { NewOrder } from "./pages/NewOrder";
import { OfflineNewOrder } from "./pages/OfflineNewOrder";
import { OpenShiftScreen } from "./pages/OpenShiftScreen";
import { PairingScreen } from "./pages/PairingScreen";
import { PinUnlock } from "./pages/PinUnlock";
import { SetupScreen } from "./pages/SetupScreen";
import { Splash } from "./pages/Splash";
import { Diagnostics } from "./pages/Diagnostics";
import { RealtimeClient } from "./realtime/RealtimeClient";
import { RealtimeProvider } from "./realtime/RealtimeProvider";
import { usePosShift } from "./hooks/usePosData";
import { REALTIME_BRIDGE_URL } from "./lib/env";
import { createRealtimeSocket } from "./lib/peakSocket";
import { getApiBaseUrl } from "./lib/peakConfig";
import {
  createRealtimeCursorStorage,
  noPosCatchUp,
} from "./lib/realtimeBackfill";
import { personLabel } from "./lib/staffLabel";
import { terminalRoute } from "./lib/terminalRoute";
import { applyModeDefaultTheme } from "./lib/theme";
import { clockTime, shiftChipWords } from "./lib/words";
import { defaultWorkspacePage, workspaceNav, type WorkspacePage } from "./lib/workspace";
import { TillShell } from "./shell/TillShell";

type Page = WorkspacePage;

function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);
  return clockTime(now);
}

/** Update and key-storage notices. Inside the shell they sit under the top bar. */
function ShellBanners() {
  return (
    <>
      <UpdaterBanner />
      <KeyStorageBanner />
    </>
  );
}

function PosShell() {
  const { session, switchStaff, identity, roster } = useDeviceSession();
  const offlineCash = session?.mode === "offline-cash";
  const nav = workspaceNav(offlineCash ? "offline-cash" : identity?.mode);
  const [page, setPage] = useState<Page>(() =>
    defaultWorkspacePage(offlineCash ? "offline-cash" : identity?.mode),
  );
  const clock = useClock();
  const { shift } = usePosShift();
  const person = personLabel(session?.staffId, roster);

  if (!nav.some((item) => item.page === page)) {
    setPage(nav[0]?.page ?? "orders");
  }

  return (
    <TillShell
      mode={identity?.mode}
      offlineCash={offlineCash}
      page={page}
      onNavigate={setPage}
      tillName={identity?.terminalName}
      person={person}
      shift={shiftChipWords(shift)}
      clock={clock}
      connection={<ConnectivityIndicator />}
      banners={<ShellBanners />}
      onSwitchPerson={() => switchStaff()}
      onLock={() => switchStaff()}
      workspaceVariant={page === "new" || page === "orders" || page === "kitchen" ? "full" : "padded"}
    >
      {page === "orders" ? (
        <ActiveOrders onNewOrder={() => setPage("new")} />
      ) : page === "new" ? (
        offlineCash ? <OfflineNewOrder /> : <NewOrder />
      ) : page === "kitchen" ? (
        <Kitchen />
      ) : page === "manager" ? (
        <Manager />
      ) : (
        <Diagnostics />
      )}
    </TillShell>
  );
}

function LiveRegister() {
  const queryClient = useQueryClient();
  const client = useMemo(
    () =>
      new RealtimeClient({
        createSocket: () => createRealtimeSocket({ peakApiUrl: getApiBaseUrl(), bridgeUrl: REALTIME_BRIDGE_URL }),
        backfillEvents: noPosCatchUp,
        cursorStorage: createRealtimeCursorStorage(),
      }),
    [],
  );

  return (
    <RealtimeProvider client={client} queryClient={queryClient}>
      <PosShell />
    </RealtimeProvider>
  );
}

/**
 * Only reached once `phase === "ready"` — i.e. a real staff session already
 * exists (PIN unlock sets it before ever advancing the phase this far). Only
 * here is it safe to call `usePosShift()`: it resolves the property/outlet
 * from that session, and calling it any earlier — before pairing, before
 * unlock — has nothing real to resolve. Split into its own component (rather
 * than an early return inside AuthGate) so the hook is never called
 * conditionally within one component, honoring the Rules of Hooks.
 */
function ReadyGate() {
  const { session } = useDeviceSession();
  const offlineCash = session?.mode === "offline-cash";
  const { shift, isLoading: shiftLoading } = usePosShift();
  // Offline cash resumes a lease-bound shift locally — never open a new one
  // while Peak is unreachable (ONLINE REQUIRED for OpenShift).
  const route = terminalRoute(
    "ready",
    offlineCash || !shiftLoading,
    offlineCash || Boolean(shift),
  );
  return (
    <>
      <span className="sr-only" data-testid="shell-state">
        {route}
      </span>
      {route === "NO_SHIFT" ? (
        <AccessFrame banners={<ShellBanners />}>
          <OpenShiftScreen />
        </AccessFrame>
      ) : (
        <LiveRegister />
      )}
    </>
  );
}

/**
 * Maps device phase to the single on-screen route. Terminal vocabulary is
 * enforced in `terminalRoute` / `shellStateOf` and their tests.
 */
function AuthGate() {
  const { phase, identity } = useDeviceSession();
  const mode = identity?.mode;

  // A device nobody has chosen a theme for follows its paired mode's default
  // (Light for tills, Dark for kitchen and bar displays). A choice made on the
  // device always wins; nothing is stored here.
  useEffect(() => {
    applyModeDefaultTheme(mode);
  }, [mode]);

  let screen: ReactNode;
  let route: string;
  switch (phase) {
    case "bootstrapping":
      route = "STARTING";
      screen = <Splash />;
      break;
    case "needs-url":
      route = "UNCONFIGURED";
      screen = <SetupScreen />;
      break;
    case "unpaired":
      route = "UNPROVISIONED";
      screen = <PairingScreen />;
      break;
    case "waiting":
      route = "PAIRING";
      screen = <PairingScreen />;
      break;
    case "locked":
      route = "LOCKED";
      screen = <PinUnlock />;
      break;
    case "ready":
      // ReadyGate renders its own shell-state marker once it knows the
      // shift outcome — nothing to render here.
      // Banners render inside the shell (under its top bar) from here on.
      return (
        <>
          <IdleLockOverlay />
          <ReadyGate />
        </>
      );
  }

  return (
    <AccessFrame
      banners={
        <>
          <UpdaterBanner />
          <KeyStorageBanner />
        </>
      }
    >
      <span className="sr-only" data-testid="shell-state">
        {route}
      </span>
      {screen}
    </AccessFrame>
  );
}

export function App() {
  return (
    <DeviceSessionProvider>
      <AuthGate />
    </DeviceSessionProvider>
  );
}
