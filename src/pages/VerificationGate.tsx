import type { ReactNode } from "react";
import { Icon } from "../components/Icon";
import { useDeviceSession } from "../auth/DeviceSessionProvider";
import { useTenantVerification } from "../hooks/usePosData";

/**
 * Sits between "paired and staff signed in" and the actual register. A tenant
 * isn't cleared to trade until FBC approves its KYB case — this is that gate,
 * not a security boundary (Peak's own authorization already enforces the
 * real one); it just keeps a not-yet-verified property from looking open for
 * business on a till that has no idea anything is pending.
 */
export function VerificationGate({ children }: { children: ReactNode }) {
  const { switchStaff } = useDeviceSession();
  const verification = useTenantVerification();

  if (verification.status === "loading") {
    return (
      <div className="auth-shell flex h-screen items-center justify-center" data-testid="verification-loading">
        <span className="spinner" aria-hidden />
      </div>
    );
  }

  if (verification.status === "verified" || verification.status === "unknown") {
    return <>{children}</>;
  }

  return (
    <div
      className="auth-shell flex h-screen items-center justify-center p-6"
      data-testid="verification-gate"
    >
      <div className="glass-panel w-full max-w-md p-8 text-center">
        <div className="mb-6 flex items-center justify-center gap-2">
          <Icon name="peak-logo" size={28} className="text-[#D4A017]" />
          <span className="font-display text-2xl text-[var(--color-text-primary)]">Peak POS</span>
        </div>
        <p className="text-[15px] font-medium text-[var(--color-text-primary)]">
          This account isn&apos;t verified yet
        </p>
        <p className="mt-2 text-[13px] text-[var(--color-text-secondary)]">
          Peak is still reviewing this business. The till opens for orders once verification is
          complete — check with whoever set up your Peak account if this is taking longer than
          expected.
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
