import { useState } from "react";
import { Icon } from "../components/Icon";
import { CashMovementDialog } from "../components/CashMovementDialog";
import { moneyFormatter } from "../lib/posMoney";
import {
  useCashMovements,
  useCatalogCurrency,
  useCloseBusinessDay,
  useHasCapability,
  useHasPermission,
  useIdempotencyKey,
  useMutationMessage,
  usePosShift,
} from "../hooks/usePosData";

/**
 * Deliberately out of the main selling workspace. Cash movements and POS
 * Day Close are periodic/administrative, not per-transaction. R6A-C: the
 * session now carries this staff member's own authoritative permission set
 * and this property's authoritative capabilities, so both actions are
 * composed from that real signal rather than shown to everyone and left to
 * fail — the backend remains the final authority either way; hiding here is
 * convenience, not a security boundary.
 */
export function Manager() {
  const { shift } = usePosShift();
  const movements = useCashMovements(shift?.id);
  const [recordingMovement, setRecordingMovement] = useState(false);
  const closeBusinessDay = useCloseBusinessDay();
  const dayCloseKey = useIdempotencyKey();
  const dayCloseError = useMutationMessage(closeBusinessDay.error);
  const currency = useCatalogCurrency();
  const money = moneyFormatter(currency);

  const canRecordCash = useHasPermission("pos.cash_movement.record");
  const canRunDayClose = useHasPermission("pos.report.manager") && !useHasCapability("LODGING");

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold text-[var(--foreground)]">Manager</h2>

      {canRecordCash ? (
        <div className="glass-panel p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-[var(--foreground)]">Cash movements</div>
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
          {!shift && <p className="mt-2 text-[12px] text-[var(--foreground-muted)]">Open a shift to record cash movements.</p>}
          {shift && (
            <ul className="mt-3 space-y-1 text-[13px]" data-testid="cash-movement-list">
              {(movements.data ?? []).length === 0 ? (
                <li className="text-[12px] text-[var(--foreground-muted)]">No cash movements this shift.</li>
              ) : (
                (movements.data ?? []).map((movement) => (
                  <li key={movement.id} className="flex items-baseline justify-between gap-2">
                    <span>
                      {movement.movementType === "CASH_IN" ? "Cash in" : "Cash out"} · {movement.reason}
                    </span>
                    <span className="font-mono text-xs tabular-nums">{money(movement.amountMinor)}</span>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
      ) : (
        <div className="glass-panel p-4">
          <p className="text-[12px] text-[var(--foreground-muted)]" data-testid="cash-movement-unavailable">
            Cash movements aren't available to this staff account. Ask a manager.
          </p>
        </div>
      )}

      {canRunDayClose && (
        <div className="glass-panel p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-[var(--foreground)]">POS day close</div>
              <p className="mt-0.5 text-[11px] text-[var(--foreground-muted)]">
                Advances the property's business date once every shift is closed.
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
      )}

      {recordingMovement && shift && <CashMovementDialog shiftId={shift.id} onClose={() => setRecordingMovement(false)} />}
    </div>
  );
}
