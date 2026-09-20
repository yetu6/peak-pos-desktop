import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { useDeviceSession } from "../auth/DeviceSessionProvider";
import { Icon } from "../components/Icon";

export function PairingScreen() {
  const { identity, phase, error, startPairing, continueAfterApproval, resetPairing } =
    useDeviceSession();
  const [busy, setBusy] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const pairing = identity?.pairing;

  useEffect(() => {
    let cancelled = false;
    const payload = pairing?.qrPayload ?? (pairing?.pairingCode ? `YETU-POS:1:${pairing.pairingCode}` : null);
    if (!payload) {
      setQrDataUrl(null);
      return;
    }
    void QRCode.toDataURL(payload, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 220,
      color: { dark: "#1A1C1F", light: "#F4EFE4" },
    }).then((url) => {
      if (!cancelled) setQrDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [pairing?.pairingCode, pairing?.qrPayload]);

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
          <Icon name="peak-logo" size={28} className="text-[var(--brass)]" />
          <span className="font-display text-2xl text-[var(--foreground)]">Yetu POS</span>
        </div>
        {pairing ? (
          <>
            <p className="text-center text-sm text-[var(--foreground-muted)]">
              This device isn&apos;t connected. Ask a manager to scan the QR or enter the pairing code.
            </p>
            <div className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--receipt-paper)] p-5 text-center text-[var(--slate-ink)]">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt="Pairing QR code"
                  data-testid="pairing-qr"
                  className="mx-auto size-[220px] rounded-md"
                />
              ) : (
                <div className="mx-auto grid size-[220px] place-items-center text-xs text-[var(--foreground-muted)]">
                  Preparing QR…
                </div>
              )}
              <div className="mt-4 text-[11px] font-medium uppercase tracking-wide text-[var(--slate-ink)]/70">
                Pairing code
              </div>
              <div
                className="mt-2 font-mono text-3xl font-semibold tracking-[0.16em] text-[var(--slate-ink)]"
                data-testid="pairing-code"
              >
                {pairing.pairingCode}
              </div>
              <div
                className="mt-3 break-all text-[11px] text-[var(--slate-ink)]/60"
                data-testid="pairing-fingerprint"
              >
                {pairing.fingerprint}
              </div>
            </div>
            <p className="mt-4 text-center text-xs text-[var(--foreground-muted)]" data-testid="pairing-state">
              {phase === "waiting" ? "Waiting for connection…" : "Preparing request…"}
            </p>
            {error ? (
              <div className="badge badge-danger mt-4" data-testid="pairing-error">
                {error}
              </div>
            ) : null}
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
              This terminal starts with no property authority. Generate a short-lived pairing code, then ask an
              authorized manager to bind it to the correct outlet.
            </p>
            {error ? (
              <div className="badge badge-danger mt-4" data-testid="pairing-error">
                {error}
              </div>
            ) : null}
            <button className="btn-primary mt-6 w-full" disabled={busy} onClick={() => void run(startPairing)}>
              {busy ? "Generating secure code…" : "Generate pairing code"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
