import type { ReactNode } from "react";
import { Icon } from "../components/Icon";
import { useDeviceSession } from "../auth/DeviceSessionProvider";
import { useTenantVerification } from "../hooks/usePosData";

/**
 * Sits between "paired and staff signed in" and the actual register. Peak
 * already refuses unverified POS commands; this keeps a not-yet-verified
 * or unconfirmed till from looking open. UNKNOWN is not READY.
 */
export function VerificationGate({ children }: { children: ReactNode }) {
  const { switchStaff } = useDeviceSession();
  const verification = useTenantVerification();

  if (verification.status === "LOADING") {
    return (
      <div className="auth-shell flex h-screen items-center justify-center" data-testid="verification-loading">
        <span className="spinner" aria-hidden />
      </div>
    );
  }

  if (verification.status === "READY") {
    return <>{children}</>;
  }

  const unknown = verification.status === "UNKNOWN";

  return (
    <div
      className="auth-shell flex h-screen items-center justify-center p-6"
      data-testid={unknown ? "verification-unknown" : "verification-gate"}
    >
      <div className="glass-panel w-full max-w-md p-8 text-center">
        <div className="mb-6 flex items-center justify-center gap-2">
          <Icon name="peak-logo" size={28} className="text-[#D4A017]" />
          <span className="font-display text-2xl text-[var(--color-text-primary)]">Peak POS</span>
        </div>
        <p className="text-[15px] font-medium text-[var(--color-text-primary)]">
          {unknown ? "Peak couldn't confirm this till is cleared to trade" : "This account isn't verified yet"}
        </p>
        <p className="mt-2 text-[13px] text-[var(--color-text-secondary)]">
          {unknown
            ? "The register stays closed until Peak can confirm this business is verified. Check the connection and try again, or switch staff."
            : "Peak is still reviewing this business. The till opens for orders once verification is complete — check with whoever set up your Peak account if this is taking longer than expected."}
        </p>
        <button
          type="button"
          onClick={() => switchStaff()}
          className="mt-6 text-[13px] text-[var(--color-brand)]"
        >
          Switch staff
        </button>
      </div>
    </div>
  );
}
