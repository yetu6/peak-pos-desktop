import { useState } from "react";
import { Icon } from "../components/Icon";
import { CashMovementDialog } from "../components/CashMovementDialog";
import { formatMinor } from "../lib/posMoney";
import { useCashMovements, useCloseBusinessDay, useIdempotencyKey, useMutationMessage, usePosShift } from "../hooks/usePosData";

/**
 * Deliberately out of the main selling workspace. Cash movements and POS
 * Day Close are periodic/administrative, not per-transaction — and the
 * backend, not this page, decides who may actually run Day Close
 * (`pos.report/manager` permission) or whether it is even offered at all
 * for this property (refused outright when LODGING is active; see
 * docs/POS_DESKTOP_R6A_CLOSURE.md for why the desktop cannot pre-check
 * either condition and instead surfaces the backend's own refusal).
 */
export function Manager() {
  const { shift } = usePosShift();
  const movements = useCashMovements(shift?.id);
  const [recordingMovement, setRecordingMovement] = useState(false);
  const closeBusinessDay = useCloseBusinessDay();
  const dayCloseKey = useIdempotencyKey();
  const dayCloseError = useMutationMessage(closeBusinessDay.error);
  const currency = "TZS";

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Manager</h2>

      <div className="glass-panel p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-[var(--color-text-primary)]">Cash movements</div>
          <button
            data-testid="open-cash-movement"
            onClick={() => setRecordingMovement(true)}
            disabled={!shift}
            className="btn-secondary btn-sm"
          >
            <Icon name="payments" size={14} />
            Cash in / out
          </button>
        </div>
        {!shift && <p className="mt-2 text-[12px] text-[var(--color-text-muted)]">Open a shift to record cash movements.</p>}
        {shift && (
          <ul className="mt-3 space-y-1 text-[13px]" data-testid="cash-movement-list">
            {(movements.data ?? []).length === 0 ? (
              <li className="text-[12px] text-[var(--color-text-muted)]">No cash movements this shift.</li>
            ) : (
              (movements.data ?? []).map((movement) => (
                <li key={movement.id} className="flex items-baseline justify-between gap-2">
                  <span>
                    {movement.movementType === "CASH_IN" ? "Cash in" : "Cash out"} · {movement.reason}
                  </span>
                  <span className="font-mono text-xs tabular-nums">{formatMinor(movement.amountMinor, currency)}</span>
                </li>
              ))
            )}
          </ul>
        )}
      </div>

      <div className="glass-panel p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-[var(--color-text-primary)]">POS day close</div>
            <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
              Advances the property's business date once every shift is closed. Not offered when Lodging Night Audit owns the date.
            </p>
          </div>
          <button
            data-testid="close-business-day"
            onClick={() => closeBusinessDay.mutate(dayCloseKey.next())}
            disabled={closeBusinessDay.isPending}
            className="btn-primary btn-sm"
          >
            {closeBusinessDay.isPending ? "Closing…" : "Close business day"}
          </button>
        </div>
        {dayCloseError && (
          <div className="badge badge-danger mt-3" data-testid="day-close-error">
            {dayCloseError}
          </div>
        )}
        {closeBusinessDay.data && (
          <div className="badge badge-success mt-3" data-testid="day-close-result">
            Business date advanced to {closeBusinessDay.data.nextBusinessDate}
          </div>
        )}
      </div>

      {recordingMovement && shift && <CashMovementDialog shiftId={shift.id} onClose={() => setRecordingMovement(false)} />}
    </div>
  );
}
