import { useState } from "react";
import { Icon } from "../components/Icon";
import { useDeviceSession } from "../auth/DeviceSessionProvider";
import {
  useHasPermission,
  useIdempotencyKey,
  useMutationMessage,
  usePosShift,
} from "../hooks/usePosData";
import { staffLabel } from "../lib/staffLabel";
import { toMinor } from "../lib/posMoney";

/**
 * The focused Open Shift workspace the shift lifecycle
 * requires: an authenticated staff member with no open shift gets one
 * dominant job here, never a disabled register. Reuses the same
 * usePosShift() mutation TillControls uses so shift-open stays one contract.
 */
export function OpenShiftScreen() {
  const { session, identity, switchStaff } = useDeviceSession();
  const { open } = usePosShift();
  const [openingFloat, setOpeningFloat] = useState("");
  const canOpenShift = useHasPermission("pos.shift.open");
  const openError = useMutationMessage(open.error);
  const openKey = useIdempotencyKey();
  const staff = staffLabel(session?.staffId);
  const openingMinor = toMinor(openingFloat);

  function submit(): void {
    if (openingMinor == null || open.isPending) return;
    open.mutate({ openingCashMinor: openingMinor, idempotencyKey: openKey.next() });
  }

  return (
    <div
      className="auth-shell flex h-screen items-center justify-center p-6"
      data-testid="open-shift-screen"
    >
      <div className="glass-panel w-full max-w-sm p-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span
              className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--surface-interactive)] text-sm font-semibold text-[var(--foreground)]"
              aria-hidden="true"
            >
              {staff.initials}
            </span>
            <div className="leading-tight">
              <p className="text-sm font-semibold text-[var(--foreground)]" data-testid="shift-staff-name">
                {staff.name}
              </p>
              <p className="text-[12px] text-[var(--foreground-muted)]">
                {identity?.terminalName?.trim() || "This register"}
              </p>
            </div>
          </div>
          <button
            data-testid="open-shift-switch-staff"
            onClick={() => switchStaff()}
            className="btn-tertiary !h-9 !w-9 !p-0"
            aria-label="Switch staff"
            title="Switch staff"
          >
            <Icon name="logout" size={16} />
          </button>
        </div>

        <p className="mt-6 text-center text-sm font-medium text-[var(--foreground)]">
          No shift is open on this register
        </p>

        {canOpenShift ? (
          <>
            <label
              htmlFor="opening-float"
              className="mt-6 block text-[11px] font-medium text-[var(--foreground-muted)]"
            >
              Opening float
            </label>
            <input
              id="opening-float"
              data-testid="opening-float"
              type="number"
              inputMode="decimal"
              value={openingFloat}
              onChange={(event) => setOpeningFloat(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submit();
              }}
              placeholder="0"
              autoFocus
              className="input mt-1 w-full text-lg"
            />
            {openError && (
              <div className="badge badge-danger mt-4 w-full justify-center" data-testid="open-shift-error">
                {openError}
              </div>
            )}
            <button
              data-testid="open-shift"
              onClick={submit}
              disabled={open.isPending || openingMinor == null}
              className="btn-primary mt-5 w-full"
            >
              {open.isPending ? "Opening shift…" : "Open shift"}
            </button>
          </>
        ) : (
          <p
            className="mt-4 text-center text-[13px] text-[var(--foreground-muted)]"
            data-testid="open-shift-unavailable"
          >
            Ask a cashier or manager to open a shift on this register.
          </p>
        )}
      </div>
    </div>
  );
}
