import { useRealtime } from "../realtime/RealtimeProvider";

const LABELS: Record<string, string> = {
  connecting: "Connecting",
  connected: "Live",
  reconnecting: "Reconnecting",
  disconnected: "Offline",
  error: "Realtime error",
};

/**
 * Truthful API-vs-realtime connectivity indicator: it reflects the actual
 * STOMP connection state reported by the backend, never a local assumption.
 */
export function ConnectivityIndicator() {
  const { state } = useRealtime();
  const tone =
    state.phase === "connected"
      ? "live"
      : state.phase === "connecting" || state.phase === "reconnecting"
        ? "alert"
        : "down";
  return (
    <div
      className={`shift-pill ${tone}`}
      data-testid="connectivity"
      role="status"
      aria-live="polite"
      aria-label={`Connection status: ${LABELS[state.phase] ?? state.phase}${
        state.phase === "reconnecting" && state.attempt > 0 ? `, attempt ${state.attempt}` : ""
      }`}
      title={
        state.lastError ??
        `resync generation ${state.resyncGeneration}, attempt ${state.attempt}`
      }
    >
      <span className="dot" data-testid="conn-dot" />
      <span data-testid="conn-label">{LABELS[state.phase] ?? state.phase}</span>
      {state.phase === "reconnecting" && state.attempt > 0 && (
        <span className="opacity-70">#{state.attempt}</span>
      )}
    </div>
  );
}
