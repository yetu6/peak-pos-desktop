import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { idleLockHeld } from "../lib/idleLock";
import type { SyncState } from "../lib/localPosCore";
import { clearOperationalSession, setOperationalSession } from "../lib/operationalSession";
import { SyncChip, SyncProblemBanner, SyncSheet, chipWords, useSyncCenter } from "./SyncCenter";

/** The three pieces as the shell places them: the chip in the top bar, the banner under it, the sheet. */
function SyncCenter() {
  const sync = useSyncCenter();
  return (
    <>
      <SyncChip sync={sync} />
      <SyncProblemBanner sync={sync} />
      <SyncSheet sync={sync} />
    </>
  );
}

/**
 * The Sync Center over the till's store. Every state here is the shape the
 * Rust store returns (src-tauri local_store/sync.rs SyncState), its status
 * label included ("Live", "Reconnecting", "Sync issue", "Offline · N waiting",
 * "Offline · Sales available").
 */

const LIVE: SyncState = {
  status: "Live",
  queuedOperations: 0,
  reconciledOperations: 12,
  exceptionOperations: 0,
  lastSuccessAtMs: new Date(2026, 9, 12, 14, 2).getTime(),
  lastAttemptAtMs: new Date(2026, 9, 12, 14, 2).getTime(),
  leaseStatus: "ACTIVE",
  catalogStatus: "ACTIVE",
  shiftOfflineEligible: true,
};
const WAITING: SyncState = { ...LIVE, status: "Offline · 3 waiting", queuedOperations: 3 };
const PROBLEM: SyncState = { ...LIVE, status: "Sync issue", exceptionOperations: 2 };

const core = vi.hoisted(() => ({ syncState: vi.fn(), retrySync: vi.fn() }));
vi.mock("../lib/localPosCore", () => ({ loadLocalPosCore: async () => core }));

const realtime = vi.hoisted(() => ({ phase: "connected" as string, lastError: null as string | null }));
vi.mock("../realtime/RealtimeProvider", () => ({
  useRealtime: () => ({ state: { phase: realtime.phase, attempt: 0, lastError: realtime.lastError, established: true, resyncGeneration: 1 } }),
}));

function renderCenter() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SyncCenter />
    </QueryClientProvider>,
  );
}

function asTauri(on: boolean) {
  if (on) (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  else delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
}

beforeEach(() => {
  asTauri(true);
  realtime.phase = "connected";
  setOperationalSession({
    token: "ops-live-session-token-0123456789abcdef",
    expiresAt: "2099-01-01T00:00:00Z",
    tenantId: "organization-1",
    propertyId: "property-1",
    outletId: "outlet-1",
    terminalId: "terminal-1",
    staffId: "staff-amina",
    assurance: "RESTRICTED",
  });
});

afterEach(() => {
  asTauri(false);
  vi.clearAllMocks();
  clearOperationalSession();
});

describe("the connection and sync chip", () => {
  it("says the connection and what is waiting, in the spec's words", () => {
    expect(chipWords(LIVE, "connected")).toEqual({ label: "Online", tone: "success" });
    expect(chipWords(WAITING, "disconnected")).toEqual({ label: "Offline · 3 sales waiting to send", tone: "warning" });
    expect(chipWords({ ...WAITING, status: "Offline · 1 waiting", queuedOperations: 1 }, "disconnected").label).toBe("Offline · 1 sale waiting to send");
    expect(chipWords(PROBLEM, "connected")).toEqual({ label: "Sales not sent", tone: "danger" });
    expect(chipWords({ ...LIVE, status: "Reconnecting" }, "connected").label).toBe("Reconnecting");
    expect(chipWords({ ...LIVE, status: "Offline · Sales available" }, "disconnected").label).toBe("Offline");
    // No store (a browser): the live connection alone.
    expect(chipWords(null, "connected").label).toBe("Online");
    expect(chipWords(null, "reconnecting").label).toBe("Reconnecting");
    expect(chipWords(null, "disconnected").label).toBe("Offline");
  });

  it("is a button that opens Sync, and announces changes politely", async () => {
    core.syncState.mockResolvedValue(WAITING);
    renderCenter();
    const chip = await screen.findByRole("button", { name: /Offline · 3 sales waiting to send/ });
    expect(screen.getByTestId("sync-announce")).toHaveAttribute("role", "status");
    expect(screen.getByTestId("sync-announce")).toHaveTextContent("Offline · 3 sales waiting to send");
    chip.focus();
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByRole("dialog", { name: "Sending sales" })).toBeInTheDocument();
  });
});

describe("the Sync Center", () => {
  it("shows what is waiting, sent and needs attention in words, with technical fields hidden", async () => {
    core.syncState.mockResolvedValue({ ...PROBLEM, status: "Offline · 3 waiting", queuedOperations: 3 });
    renderCenter();
    await userEvent.click(await screen.findByTestId("connectivity"));
    const sheet = await screen.findByRole("dialog", { name: "Sending sales" });
    expect(within(sheet).getByTestId("sync-waiting")).toHaveTextContent("3 sales waiting to send");
    expect(within(sheet).getByTestId("sync-waiting")).toHaveTextContent("They go to Yetu by themselves when the connection returns.");
    expect(within(sheet).getByTestId("sync-sent")).toHaveTextContent("12 sales sent to Yetu");
    expect(within(sheet).getByTestId("sync-sent")).toHaveTextContent("Last checked with Yetu at 14:02");
    expect(within(sheet).getByTestId("sync-attention")).toHaveTextContent("2 sales need a manager to check them.");
    expect(within(sheet).getByTestId("sync-attention")).toHaveTextContent("A manager checks them in Yetu.");
    const technical = within(sheet).getByText("Details for support").closest("details")!;
    expect(technical).not.toHaveAttribute("open");
    expect(technical).toHaveTextContent("Cash without internetReady");
    expect(technical).toHaveTextContent("Menu for offline useReady");
    // No engineering words, even in the details for support (owner, 2026-10-19).
    expect(technical).not.toHaveTextContent(/ACTIVE|Lease|Catalog|Queued|Reconciled|Exception|Realtime|eligibility/);
    expect(within(sheet).getByTestId("sync-sections")).not.toHaveTextContent(/Reconciled|Lease|Exception|Local financial evidence|Queued/);
  });

  it("Try again sends what is waiting and says what happened", async () => {
    core.syncState.mockResolvedValue(WAITING);
    core.retrySync.mockResolvedValue({ ...LIVE, reconciledOperations: 15 });
    renderCenter();
    await userEvent.click(await screen.findByTestId("connectivity"));
    const sheet = await screen.findByRole("dialog", { name: "Sending sales" });
    await userEvent.click(within(sheet).getByRole("button", { name: "Try again" }));
    expect(core.retrySync).toHaveBeenCalledWith(expect.any(String), "ops-live-session-token-0123456789abcdef");
    expect(await within(sheet).findByTestId("sync-result")).toHaveTextContent("Everything is sent.");
    expect(within(sheet).getByTestId("sync-result")).toHaveAttribute("role", "status");
    expect(within(sheet).getByTestId("sync-waiting")).toHaveTextContent("Nothing waiting to send.");
  });

  // F-228: a new till read "No sales sent from this till yet." beside "Last
  // sent 11:57", and Try again said "Everything is sent." with nothing to send.
  it("a till that has never had a sale to send says so, and when it last reached Yetu", async () => {
    const idle = { ...LIVE, queuedOperations: 0, reconciledOperations: 0, exceptionOperations: 0 };
    core.syncState.mockResolvedValue(idle);
    core.retrySync.mockResolvedValue(idle);
    renderCenter();
    await userEvent.click(await screen.findByTestId("connectivity"));
    const sheet = await screen.findByRole("dialog", { name: "Sending sales" });
    const sent = within(sheet).getByTestId("sync-sent");
    expect(sent).toHaveTextContent("No sales sent from this till yet.");
    expect(sent).not.toHaveTextContent("Last sent");
    await userEvent.click(within(sheet).getByRole("button", { name: "Try again" }));
    expect(await within(sheet).findByTestId("sync-result")).toHaveTextContent("Connected to Yetu. Nothing is waiting to send.");
  });

  it("when Yetu still can't be reached, says so as a failure; the sales stay", async () => {
    core.syncState.mockResolvedValue(WAITING);
    core.retrySync.mockResolvedValue(WAITING);
    renderCenter();
    await userEvent.click(await screen.findByTestId("connectivity"));
    const sheet = await screen.findByRole("dialog", { name: "Sending sales" });
    await userEvent.click(within(sheet).getByRole("button", { name: "Try again" }));
    const result = await within(sheet).findByTestId("sync-result");
    expect(result).toHaveAttribute("role", "alert");
    expect(result).toHaveTextContent("Can't reach Yetu yet. The 3 sales stay on this till and go when the connection returns.");
  });

  it("can't be closed while sending, and the till doesn't lock then", async () => {
    let finish: (state: SyncState) => void = () => undefined;
    core.syncState.mockResolvedValue(WAITING);
    core.retrySync.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    renderCenter();
    await userEvent.click(await screen.findByTestId("connectivity"));
    const sheet = await screen.findByRole("dialog", { name: "Sending sales" });
    await userEvent.click(within(sheet).getByRole("button", { name: "Try again" }));
    expect(within(sheet).getByRole("button", { name: "Sending…" })).toBeDisabled();
    expect(idleLockHeld()).toBe(true);
    fireEvent.keyDown(sheet, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Sending sales" })).toBeInTheDocument();
    await act(async () => finish(LIVE));
    await waitFor(() => expect(idleLockHeld()).toBe(false));
  });

  it("keeps the last live-updates problem for support, as the till saw it", async () => {
    asTauri(false);
    realtime.phase = "reconnecting";
    realtime.lastError = "websocket closed: 1006";
    try {
      renderCenter();
      await userEvent.click(await screen.findByRole("button", { name: /Reconnecting/ }));
      const sheet = await screen.findByRole("dialog", { name: "Sending sales" });
      const technical = within(sheet).getByText("Details for support").closest("details")!;
      expect(technical).toHaveTextContent("Last live-updates problem (for support)websocket closed: 1006");
      expect(within(sheet).getByTestId("sync-sections")).not.toHaveTextContent(/websocket/);
    } finally {
      realtime.lastError = null;
    }
  });

  it("in a browser (no store on the till) it shows the live connection only", async () => {
    asTauri(false);
    realtime.phase = "reconnecting";
    renderCenter();
    await userEvent.click(await screen.findByRole("button", { name: /Reconnecting/ }));
    const sheet = await screen.findByRole("dialog", { name: "Sending sales" });
    expect(sheet).toHaveTextContent("Sales go to Yetu as they happen. Nothing is kept on this till for later.");
    expect(within(sheet).queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(core.syncState).not.toHaveBeenCalled();
  });
});

describe("a sync problem", () => {
  it("shows a banner until it is resolved, which opens Sync", async () => {
    core.syncState.mockResolvedValueOnce(PROBLEM).mockResolvedValue(LIVE);
    const view = renderCenter();
    const banner = await screen.findByTestId("sync-problem-banner");
    expect(banner).toHaveTextContent("2 sales on this till need a manager to check them.");
    await userEvent.click(within(banner).getByRole("button", { name: "See what's waiting" }));
    expect(await screen.findByRole("dialog", { name: "Sending sales" })).toBeInTheDocument();
    core.retrySync.mockResolvedValue(LIVE);
    await userEvent.click(within(screen.getByRole("dialog", { name: "Sending sales" })).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByTestId("sync-problem-banner")).not.toBeInTheDocument());
    view.unmount();
  });
});
