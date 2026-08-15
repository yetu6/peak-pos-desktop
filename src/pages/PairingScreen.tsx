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
      className="flex h-screen items-center justify-center bg-[var(--color-pos-sidebar)] p-6"
      data-testid="pairing-screen"
    >
      <span className="sr-only" data-testid="shell-state">
        UNPAIRED
      </span>
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-black/20 p-8 text-center">
        <div className="mb-6 flex items-center justify-center gap-2">
          <Icon name="peak-logo" size={28} className="text-[#D4A017]" />
          <span className="font-display text-2xl text-white">Peak POS</span>
        </div>
        {phase === "unpaired" || !pairing ? (
          <>
            <h1 className="text-lg font-semibold text-white">Pair this register</h1>
            <p className="mt-2 text-[13px] text-[rgba(255,255,255,0.65)]">
              Requesting a pairing code from Peak…
            </p>
          </>
        ) : (
          <>
            <p className="text-[12px] font-medium uppercase tracking-wide text-[rgba(255,255,255,0.5)]">
              Waiting for manager approval
            </p>
            <div
              className="mt-4 font-mono text-5xl font-semibold tracking-[0.35em] text-white"
              data-testid="pairing-code"
            >
              {pairing.pairingCode}
            </div>
            <p className="mt-3 text-[12px] text-[rgba(255,255,255,0.55)]" data-testid="pairing-countdown">
              {countdown.expired
                ? "This code expired. Generate a new one."
                : `Ask a manager to approve this code. ${countdown.label} left.`}
            </p>
            <p
              className="mt-2 truncate text-[11px] text-[rgba(255,255,255,0.35)]"
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
