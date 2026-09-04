import { useState } from "react";
import { useDeviceSession } from "../auth/DeviceSessionProvider";
import { Icon } from "../components/Icon";

export function PairingScreen() {
  const { identity, phase, error, startPairing, continueAfterApproval, resetPairing } =
    useDeviceSession();
  const [busy, setBusy] = useState(false);
  const pairing = identity?.pairing;

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell flex h-screen items-center justify-center p-6" data-testid="pairing-screen">
      <div className="glass-panel w-full max-w-lg p-8">
        <div className="mb-6 flex items-center justify-center gap-2">
          <Icon name="peak-logo" size={28} className="text-[var(--gold-accent)]" />
          <span className="font-display text-2xl text-[var(--foreground)]">Pair this terminal</span>
        </div>
        {pairing ? (
          <>
            <p className="text-sm text-[var(--foreground-muted)]">
              Ask an authorized property manager to approve this terminal using the pairing code.
            </p>
            <div className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--surface-interactive)] p-5 text-center">
              <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--foreground-muted)]">Pairing code</div>
              <div className="mt-2 font-mono text-3xl font-semibold tracking-[0.16em] text-[var(--foreground)]" data-testid="pairing-code">
                {pairing.pairingCode}
              </div>
              <div className="mt-3 break-all text-[11px] text-[var(--foreground-muted)]" data-testid="pairing-fingerprint">
                {pairing.fingerprint}
              </div>
            </div>
            <p className="mt-4 text-center text-xs text-[var(--foreground-muted)]" data-testid="pairing-state">
              {phase === "waiting" ? "Waiting for manager approval…" : "Preparing request…"}
            </p>
            {error ? <div className="badge badge-danger mt-4" data-testid="pairing-error">{error}</div> : null}
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <button className="btn-primary" disabled={busy} onClick={() => void run(continueAfterApproval)}>
                {busy ? "Checking…" : "Check approval"}
              </button>
              <button className="btn-secondary" disabled={busy} onClick={() => void run(resetPairing)}>
                Start over
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-[var(--foreground-muted)]">
              This terminal starts with no hotel authority. Generate a short-lived code, then ask an authorized manager to bind it to the correct property and outlet.
            </p>
            {error ? <div className="badge badge-danger mt-4" data-testid="pairing-error">{error}</div> : null}
            <button className="btn-primary mt-6 w-full" disabled={busy} onClick={() => void run(startPairing)}>
              {busy ? "Generating secure code…" : "Generate pairing code"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
