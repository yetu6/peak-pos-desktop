import { CircleCheck, CircleDot, LoaderCircle } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { useDeviceSession } from "../auth/DeviceSessionProvider";
import { AccessLayout } from "../access/AccessLayout";
import { PAIRING_STEPS, QR_COLOURS } from "../access/accessSettings";
import { accessNotice, countdownWords, groupPairingCode } from "../access/accessWords";
import { Banner, Button, TechnicalDetails } from "../components/system";
import type { PairingRecord } from "../lib/deviceIdentity";

/** Connecting this till to the restaurant: get a code, a manager enters it in Yetu, the till is connected. */
export function PairingScreen() {
  const { identity, phase, error, startPairing, resetPairing } = useDeviceSession();
  return (
    <PairingView
      pairing={identity?.pairing ?? null}
      waiting={phase === "waiting"}
      error={error}
      onStart={startPairing}
      onCancel={resetPairing}
      onNewCode={async () => {
        await resetPairing();
        await startPairing();
      }}
    />
  );
}

function useSecondsLeft(expiresAt: string | undefined): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);
  if (!expiresAt) return null;
  const left = Date.parse(expiresAt) - now;
  return Number.isFinite(left) ? Math.max(0, Math.ceil(left / 1_000)) : null;
}

function useQrImage(payload: string | null): string | null {
  const [image, setImage] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!payload) {
      setImage(null);
      return;
    }
    // An SVG string: no canvas needed, and the till's security policy allows data: images.
    QRCode.toString(payload, { type: "svg", errorCorrectionLevel: "M", margin: 1, color: QR_COLOURS })
      .then((svg) => {
        if (!cancelled) setImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
      })
      .catch(() => {
        if (!cancelled) setImage(null);
      });
    return () => {
      cancelled = true;
    };
  }, [payload]);
  return image;
}

export function PairingView({
  pairing,
  waiting,
  error,
  onStart,
  onCancel,
  onNewCode,
}: {
  pairing: PairingRecord | null;
  waiting: boolean;
  error: string | null;
  onStart: () => Promise<void>;
  onCancel: () => Promise<void>;
  onNewCode: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const notice = accessNotice(error);
  const code = pairing ? groupPairingCode(pairing.pairingCode) : null;
  const qr = useQrImage(pairing ? (pairing.qrPayload ?? `YETU-POS:1:${pairing.pairingCode}`) : null);
  const secondsLeft = useSecondsLeft(pairing?.expiresAt);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  const errorBanner = notice ? (
    <div data-testid="pairing-error">
      <Banner tone={notice.tone}>{notice.words}</Banner>
    </div>
  ) : null;

  if (!pairing || !code) {
    const again = notice && ["declined", "expired", "revoked"].includes(notice.kind);
    return (
      <AccessLayout
        testId="pairing-screen"
        title="Connect this till to your restaurant"
        lede={<p>Get a code, then a manager types it in Yetu. The till connects by itself once they approve.</p>}
        notice={errorBanner}
      >
        <Button variant="primary" size={64} block disabled={busy} onClick={() => void run(onStart)}>
          {busy ? "Getting a code…" : again ? "Get a new code" : "Get a code"}
        </Button>
      </AccessLayout>
    );
  }

  return (
    <AccessLayout
      testId="pairing-screen"
      title="Connect this till to your restaurant"
      width="wide"
      notice={errorBanner}
    >
      <div className="y-pairing">
        <div className="y-pairing__code-card">
          {qr ? (
            <img src={qr} alt={`QR code for pairing code ${code}`} data-testid="pairing-qr" className="y-pairing__qr" />
          ) : (
            <div className="y-pairing__qr y-pairing__qr--waiting" aria-hidden="true" />
          )}
          <p className="y-pairing__code-label">Pairing code</p>
          <p className="y-pairing__code" data-testid="pairing-code">
            {code}
          </p>
          {secondsLeft !== null ? (
            <p className="y-pairing__expiry" data-testid="pairing-expiry">
              This code works for {countdownWords(secondsLeft)} more
            </p>
          ) : null}
        </div>

        <div className="y-access__column">
          <h2 className="y-section-title">Ask a manager to</h2>
          <ol className="y-steps" aria-label="How to connect">
            {PAIRING_STEPS.map((step, index) => (
              <li key={step}>
                <span className="y-steps__number" aria-hidden="true">
                  {index + 1}
                </span>
                <span className="y-steps__text">{step}</span>
              </li>
            ))}
          </ol>

          <h2 className="y-section-title y-section-title--spaced">Progress</h2>
          <ul className="y-live" data-testid="pairing-state" aria-live="polite">
            <li className="y-live__done">
              <CircleCheck aria-hidden="true" />
              <span>Code shown</span>
              <span className="sr-only">, done</span>
            </li>
            <li className={waiting ? "y-live__now" : undefined}>
              {waiting ? <LoaderCircle className="y-spin" aria-hidden="true" /> : <CircleDot aria-hidden="true" />}
              <span>Waiting for a manager to approve</span>
              <span className="sr-only">{waiting ? ", now" : ", next"}</span>
            </li>
            <li>
              <CircleDot aria-hidden="true" />
              <span>Connected to your restaurant</span>
              <span className="sr-only">, next</span>
            </li>
          </ul>

          <div className="y-access__actions">
            <Button variant="quiet" disabled={busy} onClick={() => void run(onCancel)}>
              Cancel
            </Button>
            <Button variant="secondary" size={56} disabled={busy} onClick={() => void run(onNewCode)}>
              {busy ? "Getting a code…" : "New code"}
            </Button>
          </div>

          <TechnicalDetails>
            <span data-testid="pairing-fingerprint">{pairing.fingerprint}</span>
          </TechnicalDetails>
        </div>
      </div>
    </AccessLayout>
  );
}
