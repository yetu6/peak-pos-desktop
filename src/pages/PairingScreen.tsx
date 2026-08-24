import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { useDeviceSession } from "../auth/DeviceSessionProvider";

function useCountdown(iso: string | undefined): { label: string; expired: boolean } {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);
  if (!iso) return { label: "", expired: false };
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return { label: iso, expired: false };
  const ms = at - now;
  if (ms <= 0) return { label: "expired", expired: true };
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return {
    label: `${minutes}:${String(seconds % 60).padStart(2, "0")}`,
    expired: false,
  };
}

function ConfirmClaimPanel() {
  const { claim, confirmPairing, rejectPairing } = useDeviceSession();
  const countdown = useCountdown(claim?.expiresAt);
  const [busy, setBusy] = useState<"confirm" | "reject" | null>(null);

  if (!claim) return null;

  return (
    <>
      <p className="text-[12px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
        A manager wants to pair this till
      </p>
      <div className="mt-4 space-y-2 text-left" data-testid="claim-summary">
        <div className="flex items-center justify-between rounded-lg bg-black/5 px-3 py-2">
          <span className="text-[12px] text-[var(--color-text-muted)]">Property</span>
          <span className="text-[13px] font-medium text-[var(--color-text-primary)]">
            {claim.propertyName ?? claim.propertyId}
          </span>
        </div>
        {claim.outletName ? (
          <div className="flex items-center justify-between rounded-lg bg-black/5 px-3 py-2">
            <span className="text-[12px] text-[var(--color-text-muted)]">Outlet</span>
            <span className="text-[13px] font-medium text-[var(--color-text-primary)]">
              {claim.outletName}
            </span>
          </div>
        ) : null}
        <div className="flex items-center justify-between rounded-lg bg-black/5 px-3 py-2">
          <span className="text-[12px] text-[var(--color-text-muted)]">Terminal name</span>
          <span className="text-[13px] font-medium text-[var(--color-text-primary)]">
            {claim.terminalName}
          </span>
        </div>
        <div className="flex items-center justify-between rounded-lg bg-black/5 px-3 py-2">
          <span className="text-[12px] text-[var(--color-text-muted)]">Mode</span>
          <span className="text-[13px] font-medium text-[var(--color-text-primary)]">
            {claim.mode}
          </span>
        </div>
      </div>
      <p className="mt-3 text-[12px] text-[var(--color-text-secondary)]" data-testid="claim-countdown">
        {countdown.expired ? "This offer expired" : `Decide within ${countdown.label}`}
      </p>
      <div className="mt-6 flex gap-3">
        <button
          data-testid="claim-reject"
          disabled={busy !== null}
          onClick={() => {
            setBusy("reject");
            void rejectPairing().finally(() => setBusy(null));
          }}
          className="btn-secondary flex-1"
        >
          Not this till
        </button>
        <button
          data-testid="claim-confirm"
          disabled={busy !== null}
          onClick={() => {
            setBusy("confirm");
            void confirmPairing().finally(() => setBusy(null));
          }}
          className="btn-primary flex-1"
        >
          Confirm
        </button>
      </div>
    </>
  );
}

export function PairingScreen() {
  const { phase, identity, error, startPairing } = useDeviceSession();
  const pairing = identity?.pairing;
  const countdown = useCountdown(pairing?.expiresAt);

  useEffect(() => {
    if (phase === "unpaired") {
      void startPairing();
    }
  }, [phase, startPairing]);

  return (
    <div
      className="auth-shell flex h-screen items-center justify-center p-6"
      data-testid="pairing-screen"
    >
      <span className="sr-only" data-testid="shell-state">
        UNPAIRED
      </span>
      <div className="glass-panel w-full max-w-md p-8 text-center">
        <div className="mb-6 flex items-center justify-center gap-2">
          <Icon name="peak-logo" size={28} className="text-[#D4A017]" />
          <span className="font-display text-2xl text-[var(--color-text-primary)]">Peak POS</span>
        </div>
        {phase === "confirming" ? (
          <ConfirmClaimPanel />
        ) : phase === "unpaired" || !pairing ? (
          <>
            <p className="text-[13px] text-[var(--color-text-secondary)]">Getting a code…</p>
          </>
        ) : (
          <>
            <p className="text-[12px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
              Waiting for manager approval
            </p>
            <div
              className="mt-4 font-mono text-5xl font-semibold tracking-[0.35em] text-[var(--color-text-primary)]"
              data-testid="pairing-code"
            >
              {pairing.pairingCode}
            </div>
            <p className="mt-3 text-[12px] text-[var(--color-text-secondary)]" data-testid="pairing-countdown">
              {countdown.expired ? "Code expired" : `${countdown.label} left`}
            </p>
            <p
              className="mt-2 truncate text-[11px] text-[var(--color-text-muted)]"
              data-testid="device-code"
            >
              Device {identity?.deviceCode}
            </p>
            {countdown.expired && (
              <button
                data-testid="pairing-regenerate"
                onClick={() => void startPairing()}
                className="btn-primary mt-6 w-full"
              >
                Generate a new code
              </button>
            )}
          </>
        )}
        {error && (
          <div className="badge badge-danger mt-4" data-testid="pairing-error">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
