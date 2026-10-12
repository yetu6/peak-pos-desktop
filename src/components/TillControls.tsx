import { useState } from "react";
import { Icon } from "./Icon";
import { useDeviceSessionOptional } from "../auth/DeviceSessionProvider";
import { CloseShiftSheet } from "../cash/CloseShiftSheet";
import { useExpectedCashVisible } from "../cash/useExpectedCashVisible";
import { formatMoney } from "../lib/money";
import { toMinor } from "../lib/posMoney";
import { useHasPermission, useIdempotencyKey, useMutationMessage, usePosShift } from "../hooks/usePosData";

/**
 * Opening float is money entry: parsed once via `toMinor` into an integer
 * minor-unit amount, never floating point. Closing goes through the
 * close-shift sheet (count, then check, then a manager when they differ);
 * Peak computes `expectedCashMinor` and `varianceMinor` itself. R6A-C:
 * open/close are additionally composed from this staff member's own
 * authoritative pos.shift.open/close grant (e.g. a WAITER cannot open a
 * shift) — the backend still refuses the mutation outright regardless of
 * this check. Yetu's expected figure shows only to those allowed to see it
 * before counting (EXPECTED_CASH_VISIBLE_TO).
 */
export function TillControls({ currency }: { currency?: string }) {
  const { shift, open } = usePosShift();
  const [openingFloat, setOpeningFloat] = useState("");
  const [closing, setClosing] = useState(false);
  const openKey = useIdempotencyKey();
  const openError = useMutationMessage(open.error);
  const canOpenShift = useHasPermission("pos.shift.open");
  const canCloseShift = useHasPermission("pos.shift.close");
  const showExpected = useExpectedCashVisible();
  const device = useDeviceSessionOptional();

  const openingMinor = toMinor(openingFloat);

  function submitOpen(): void {
    if (openingMinor == null) return;
    const key = openKey.next();
    open.mutate({ openingCashMinor: openingMinor, idempotencyKey: key });
  }

  const shiftBadge = shift ? (
    <span className="badge badge-success badge-dot" data-testid="shift-open">
      {showExpected ? `Shift open · expected ${formatMoney(shift.expectedCashMinor, currency)}` : "Shift open"}
    </span>
  ) : null;

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="till-controls">
      {shift ? (
        <>
          {shiftBadge}
          {canCloseShift ? (
            <button data-testid="open-close-shift" onClick={() => setClosing(true)} className="btn-tertiary btn-sm">
              Close shift
            </button>
          ) : null}
          {closing ? (
            <CloseShiftSheet
              open
              onOpenChange={setClosing}
              shift={shift}
              currency={currency}
              requesterId={device?.session?.staffId ?? ""}
              roster={device?.roster ?? []}
            />
          ) : null}
        </>
      ) : canOpenShift ? (
        <>
          <input
            data-testid="opening-float"
            type="number"
            value={openingFloat}
            onChange={(event) => setOpeningFloat(event.target.value)}
            placeholder="Opening float"
            className="input w-32"
          />
          <button
            data-testid="open-shift"
            onClick={submitOpen}
            disabled={open.isPending || openingMinor == null}
            className="btn-primary btn-sm"
          >
            <Icon name="check" size={14} />
            {open.isPending ? "Opening…" : "Open shift"}
          </button>
        </>
      ) : (
        <span className="badge badge-muted" data-testid="shift-open-unavailable">
          No shift open — ask a cashier to open one.
        </span>
      )}
      {openError && (
        <div className="badge badge-danger" data-testid="open-error">
          {openError}
        </div>
      )}
    </div>
  );
}
