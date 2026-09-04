import { useState } from "react";
import { Icon } from "../components/Icon";
import { useDeviceSession } from "../auth/DeviceSessionProvider";

/**
 * PEAK_TERMINAL_MASTER_OPERATIONS.md §7: a normal operator never sees this
 * screen — the packaged server address (or a paired terminal's persisted
 * one) resolves before the app ever routes here. It only appears when
 * neither exists, which in production means an installer/service diagnostic
 * path, not a step in the daily launch journey. Framed as configuration, not
 * as the front door.
 */
export function SetupScreen() {
  const { saveApiUrl, error } = useDeviceSession();
  const [url, setUrl] = useState("https://");
  const [pending, setPending] = useState(false);

  async function submit(): Promise<void> {
    if (pending) return;
    setPending(true);
    try {
      await saveApiUrl(url);
    } catch {
      // saveApiUrl already set a human error
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className="auth-shell flex h-screen items-center justify-center p-6"
      data-testid="setup-screen"
    >
      <div className="glass-panel w-full max-w-md p-8">
        <div className="mb-2 flex items-center justify-center gap-2">
          <Icon name="peak-logo" size={28} className="text-[var(--gold-accent)]" />
          <span className="font-display text-2xl text-[var(--foreground)]">Peak Terminal</span>
        </div>
        <p className="mb-6 text-center text-[12px] text-[var(--foreground-muted)]">
          Installer configuration — set once when this device is first prepared
        </p>
        <label
          htmlFor="peak-url"
          className="block text-[11px] font-medium text-[var(--foreground-muted)]"
        >
          Server address
        </label>
        <input
          id="peak-url"
          data-testid="peak-url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void submit();
          }}
          placeholder="https://"
          autoFocus
          className="input mt-1 w-full bg-[var(--surface-interactive)] text-[var(--foreground)]"
          autoComplete="off"
        />
        {error && (
          <div className="badge badge-danger mt-4 w-full justify-center" data-testid="setup-error">
            {error}
          </div>
        )}
        <button
          data-testid="save-peak-url"
          onClick={() => void submit()}
          disabled={pending}
          className="btn-primary mt-5 w-full"
        >
          {pending ? "Connecting…" : "Connect"}
        </button>
      </div>
    </div>
  );
}
