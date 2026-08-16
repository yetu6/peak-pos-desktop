import { useState } from "react";
import { Icon } from "../components/Icon";
import { useDeviceSession } from "../auth/DeviceSessionProvider";

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
      <span className="sr-only" data-testid="shell-state">
        UNPAIRED
      </span>
      <div className="glass-panel w-full max-w-md p-8">
        <div className="mb-6 flex items-center justify-center gap-2">
          <Icon name="peak-logo" size={28} className="text-[#D4A017]" />
          <span className="font-display text-2xl text-[var(--color-text-primary)]">Peak POS</span>
        </div>
        <label
          htmlFor="peak-url"
          className="block text-[11px] font-medium text-[var(--color-text-secondary)]"
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
          className="input mt-1 w-full bg-[var(--color-surface-hover)] text-[var(--color-text-primary)]"
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
