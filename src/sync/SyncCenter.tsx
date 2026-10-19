import { useMutation, useQuery, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { liveUpdatesWords, offlineReadyWords, savedSalesWords } from "../lib/supportWords";
import { CircleAlert, CloudOff, RefreshCw, Wifi } from "lucide-react";
import { useState } from "react";
import { Banner, Button, Sheet, StatusChip, TechnicalDetails } from "../components/system";
import { loadLocalPosCore, type SyncState } from "../lib/localPosCore";
import { getOperationalSession } from "../lib/operationalSession";
import { getApiBaseUrl } from "../lib/peakConfig";
import { isTauriRuntime } from "../lib/peakSocket";
import { useHoldIdleLock } from "../lib/useHoldIdleLock";
import { CLOCK_LOCALE, clockTime } from "../lib/words";
import { useRealtime } from "../realtime/RealtimeProvider";
import type { ConnectionPhase } from "../realtime/RealtimeEnvelope";
import { SYNC_REFRESH_SECONDS } from "./syncSettings";

type Tone = "success" | "warning" | "danger" | "info";

/** A moment as people say it: 12 Oct 2026, 14:02:31. */
/** When the till last checked with Yetu: "14:02" today, "Mon 12 Oct, 14:02" before. */
function attemptWords(ms: number, now = Date.now()): string {
  const when = new Date(ms);
  const today = new Date(now);
  const sameDay = when.getFullYear() === today.getFullYear() && when.getMonth() === today.getMonth() && when.getDate() === today.getDate();
  if (sameDay) return clockTime(when);
  const day = new Intl.DateTimeFormat(CLOCK_LOCALE, { weekday: "short", day: "numeric", month: "short" }).format(when).replace(",", "");
  return `${day}, ${clockTime(when)}`;
}

function sales(count: number): string {
  return `${count} ${count === 1 ? "sale" : "sales"}`;
}

/** The store says a sale needs a manager, or Yetu didn't accept the till's sales. */
function hasProblem(state: SyncState): boolean {
  return state.exceptionOperations > 0 || state.status === "Sync issue";
}

/**
 * The top bar's connection and sync words. With the till's store (the
 * desktop app) they come from its sync state (Rust decides Live,
 * Reconnecting, Sync issue or offline); without one (a browser) from the
 * live connection alone.
 */
export function chipWords(state: SyncState | null, realtime: ConnectionPhase | string): { label: string; tone: Tone } {
  if (state) {
    if (hasProblem(state)) return { label: "Sales not sent", tone: "danger" };
    const waiting = state.queuedOperations;
    if (state.status === "Live") return { label: waiting > 0 ? `Online · ${waiting} waiting to send` : "Online", tone: "success" };
    if (state.status === "Reconnecting") return { label: "Reconnecting", tone: "warning" };
    return { label: waiting > 0 ? `Offline · ${sales(waiting)} waiting to send` : "Offline", tone: "warning" };
  }
  if (realtime === "connected") return { label: "Online", tone: "success" };
  if (realtime === "connecting") return { label: "Connecting", tone: "info" };
  if (realtime === "reconnecting") return { label: "Reconnecting", tone: "warning" };
  return { label: "Offline", tone: "warning" };
}

export interface SyncCenterState {
  /** The till has its own store (the desktop app). */
  native: boolean;
  state: SyncState | null;
  realtime: ReturnType<typeof useRealtime>["state"];
  open: boolean;
  setOpen: (open: boolean) => void;
  retry: UseMutationResult<SyncState, unknown, void>;
  /** The state before the last Try again, to say what it did. */
  before: SyncState | null;
}

/** The sync state, refreshed every SYNC_REFRESH_SECONDS, and Try again. */
export function useSyncCenter(): SyncCenterState {
  const native = isTauriRuntime();
  const queryClient = useQueryClient();
  const { state: realtime } = useRealtime();
  const [open, setOpen] = useState(false);
  const [before, setBefore] = useState<SyncState | null>(null);
  const sync = useQuery({
    queryKey: ["local-pos", "sync"],
    queryFn: async () => (await loadLocalPosCore()).syncState(),
    refetchInterval: SYNC_REFRESH_SECONDS * 1000,
    retry: false,
    enabled: native,
  });
  const retry = useMutation({
    mutationFn: async (): Promise<SyncState> => {
      const session = getOperationalSession();
      setBefore(sync.data ?? null);
      // The same call the till has always used to send its waiting sales (retry_sync).
      return (await loadLocalPosCore()).retrySync(getApiBaseUrl(), session?.token ?? "");
    },
    onSuccess: (next) => queryClient.setQueryData(["local-pos", "sync"], next),
  });
  // The till doesn't lock itself while its sales are being sent.
  useHoldIdleLock(retry.isPending);
  return { native, state: native ? (sync.data ?? null) : null, realtime, open, setOpen, retry, before };
}

/** The connection and sync chip: a button that opens Sync. Changes are announced politely. */
export function SyncChip({ sync }: { sync: SyncCenterState }) {
  const { label, tone } = chipWords(sync.state, sync.realtime.phase);
  const Icon = tone === "danger" ? CircleAlert : label.startsWith("Offline") ? CloudOff : Wifi;
  return (
    <>
      <button
        type="button"
        className="y-sync-chip"
        data-testid="connectivity"
        aria-haspopup="dialog"
        aria-label={`${label}. See what's waiting`}
        onClick={() => sync.setOpen(true)}
      >
        <StatusChip tone={tone} icon={<Icon aria-hidden="true" />}>
          <span data-testid="conn-label">{label}</span>
        </StatusChip>
      </button>
      <span className="y-visually-hidden" role="status" aria-live="polite" data-testid="sync-announce">
        {label}
      </span>
    </>
  );
}

/** Under the top bar while sales need attention, until they don't. */
export function SyncProblemBanner({ sync }: { sync: SyncCenterState }) {
  if (!sync.state || !hasProblem(sync.state)) return null;
  const count = sync.state.exceptionOperations;
  return (
    <Banner
      tone="warning"
      data-testid="sync-problem-banner"
      action={
        <Button variant="secondary" onClick={() => sync.setOpen(true)}>
          See what's waiting
        </Button>
      }
    >
      {count > 0
        ? `${sales(count)} on this till ${count === 1 ? "needs" : "need"} a manager to check ${count === 1 ? "it" : "them"}.`
        : "Yetu didn't accept this till's sales just now. See what's waiting to try again."}
    </Banner>
  );
}

/** What the last Try again did, in words, and whether it is a failure. */
function resultWords(sync: SyncCenterState): { words: string; failed: boolean } | null {
  if (sync.retry.isError) return { words: "Something went wrong on this till. The sales stay on it. Try again.", failed: true };
  const after = sync.retry.data;
  if (!sync.retry.isSuccess || !after) return null;
  if (after.queuedOperations === 0 && !hasProblem(after)) {
    // Nothing was waiting: say that, not that something was sent (F-228).
    const waited = (sync.before?.queuedOperations ?? 0) > 0 || after.reconciledOperations > (sync.before?.reconciledOperations ?? after.reconciledOperations);
    return { words: waited ? "Everything is sent." : "Connected to Yetu. Nothing is waiting to send.", failed: false };
  }
  if (after.status !== "Live" && after.queuedOperations > 0) {
    return {
      words: `Can't reach Yetu yet. The ${sales(after.queuedOperations)} stay on this till and go when the connection returns.`,
      failed: true,
    };
  }
  const sent = Math.max(0, after.reconciledOperations - (sync.before?.reconciledOperations ?? after.reconciledOperations));
  return { words: `${sent > 0 ? `${sales(sent)} sent. ` : ""}Some sales need attention: see below.`, failed: false };
}

/** Sync: what is waiting, what is sent, what needs attention, and Try again. Technical fields stay hidden. */
export function SyncSheet({ sync }: { sync: SyncCenterState }) {
  const sending = sync.retry.isPending;
  const state = sync.state;
  const result = resultWords(sync);
  return (
    <Sheet
      open={sync.open}
      onOpenChange={(open) => {
        if (!open && sending) return;
        sync.setOpen(open);
      }}
      title="Sending sales"
      description="Sales saved on this till, and sending them to Yetu."
      testId="sync-center"
      footer={
        state ? (
          <div className="y-sync__footer">
            <Button variant="quiet" disabled={sending} onClick={() => sync.setOpen(false)}>
              Close
            </Button>
            <Button variant="primary" size={56} icon={<RefreshCw />} disabled={sending || !getOperationalSession()} onClick={() => sync.retry.mutate()}>
              {sending ? "Sending…" : "Try again"}
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="y-sync">
        <div className="y-sync__sections" data-testid="sync-sections">
        <p className="y-sync__summary">{chipWords(state, sync.realtime.phase).label}</p>
        {state ? (
          <>
            <section className="y-sync__section" data-testid="sync-waiting" aria-labelledby="sync-waiting-title">
              <h3 id="sync-waiting-title">Waiting to send</h3>
              {state.queuedOperations > 0 ? (
                <>
                  <p className="y-sync__figure">{sales(state.queuedOperations)} waiting to send</p>
                  <p>They go to Yetu by themselves when the connection returns. Keep the till on.</p>
                </>
              ) : (
                <p className="y-sync__figure">Nothing waiting to send.</p>
              )}
            </section>
            <section className="y-sync__section" data-testid="sync-sent" aria-labelledby="sync-sent-title">
              <h3 id="sync-sent-title">Sent</h3>
              <p className="y-sync__figure">
                {state.reconciledOperations > 0 ? `${sales(state.reconciledOperations)} sent to Yetu` : "No sales sent from this till yet."}
              </p>
              {/* When the till last reached Yetu for its sales, whether or not it had any to send (F-228). */}
              <p>{state.lastSuccessAtMs ? `Last checked with Yetu at ${clockTime(new Date(state.lastSuccessAtMs))}` : "Not checked with Yetu yet."}</p>
            </section>
            <section className="y-sync__section" data-testid="sync-attention" aria-labelledby="sync-attention-title">
              <h3 id="sync-attention-title">Needs attention</h3>
              {state.exceptionOperations > 0 ? (
                <>
                  <p className="y-sync__figure">{sales(state.exceptionOperations)} need a manager to check them.</p>
                  <p>Yetu took them but found something to check. A manager checks them in Yetu. They stay on this till until then.</p>
                </>
              ) : state.status === "Sync issue" ? (
                <p>Yetu didn't accept this till's sales just now. Try again. If it keeps happening, call support.</p>
              ) : (
                <p>Nothing needs attention.</p>
              )}
            </section>
            {result ? (
              <p className="y-sync__result" role={result.failed ? "alert" : "status"} data-testid="sync-result">
                {result.words}
              </p>
            ) : null}
          </>
        ) : (
          <p>Sales go to Yetu as they happen. Nothing is kept on this till for later.</p>
        )}
        </div>
        <TechnicalDetails>
          <dl className="y-sync__technical">
            {state ? (
              <>
                <dt>Sales saved on this till</dt>
                <dd>{savedSalesWords(state.status)}</dd>
                <dt>Sales waiting to send</dt>
                <dd>{state.queuedOperations}</dd>
                <dt>Sales sent</dt>
                <dd>{state.reconciledOperations}</dd>
                <dt>Need a manager's look</dt>
                <dd>{state.exceptionOperations}</dd>
                <dt>Cash without internet</dt>
                <dd>{offlineReadyWords(state.leaseStatus)}</dd>
                <dt>Menu for offline use</dt>
                <dd>{offlineReadyWords(state.catalogStatus)}</dd>
                <dt>Can take cash offline this shift</dt>
                <dd>{state.shiftOfflineEligible ? "Yes" : "No"}</dd>
                <dt>Last checked</dt>
                <dd>{state.lastAttemptAtMs ? attemptWords(state.lastAttemptAtMs) : "Not yet"}</dd>
              </>
            ) : null}
            <dt>Live updates</dt>
            <dd>{liveUpdatesWords(sync.realtime)}</dd>
          </dl>
        </TechnicalDetails>
      </div>
    </Sheet>
  );
}
