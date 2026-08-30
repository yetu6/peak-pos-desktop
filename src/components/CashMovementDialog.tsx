import { useState } from "react";
import { Icon } from "./Icon";
import { toMinor } from "../lib/posMoney";
import { useIdempotencyKey, useMutationMessage, useRecordCashMovement } from "../hooks/usePosData";
import type { CashMovementType } from "../lib/posContracts";

/** Cash In / Cash Out against the open shift. Append-only: there is no edit
 *  or delete on `POSCashMovement` in the certified contract, and none is
 *  offered here — a mistake is corrected with an offsetting movement. */
export function CashMovementDialog({ shiftId, onClose }: { shiftId: string; onClose: () => void }) {
  const [movementType, setMovementType] = useState<CashMovementType>("CASH_IN");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const record = useRecordCashMovement(shiftId);
  const idempotencyKey = useIdempotencyKey();
  const error = useMutationMessage(record.error);
  const amountMinor = toMinor(amount);
  const canSubmit = amountMinor != null && amountMinor > 0 && reason.trim().length > 0 && !record.isPending;

  function submit(): void {
    if (amountMinor == null) return;
    record.mutate(
      { movementType, amountMinor, reason: reason.trim(), idempotencyKey: idempotencyKey.next() },
      { onSuccess: onClose },
    );
  }

  return (
    <div className="glass-scrim fixed inset-0 z-50 flex items-center justify-center p-4" data-testid="cash-movement-dialog">
      <div className="glass-dialog w-full max-w-sm p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="text-sm font-semibold text-[var(--color-text-primary)]">Cash movement</div>
          <button onClick={onClose} className="rounded-md p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-border-subtle)]" aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          {(["CASH_IN", "CASH_OUT"] as const).map((type) => (
            <button
              key={type}
              data-testid={`movement-type-${type}`}
              onClick={() => setMovementType(type)}
              className={`rounded-lg border px-2 py-2 text-[12px] font-medium ${
                movementType === type
                  ? "border-[var(--color-gold)] bg-[var(--color-gold)]/10 text-[var(--color-text-primary)]"
                  : "border-[var(--color-border-subtle)] text-[var(--color-text-muted)]"
              }`}
            >
              {type === "CASH_IN" ? "Cash in" : "Cash out"}
            </button>
          ))}
        </div>

        <label className="mt-4 block text-[12px] font-medium text-[var(--color-text-secondary)]">Amount</label>
        <input
          data-testid="movement-amount"
          type="number"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          className="input mt-1 w-full"
        />

        <label className="mt-3 block text-[12px] font-medium text-[var(--color-text-secondary)]">Reason</label>
        <input
          data-testid="movement-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="e.g. Change float top-up"
          className="input mt-1 w-full"
        />

        {error && (
          <div className="badge badge-danger mt-4" data-testid="movement-error">
            {error}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="btn-tertiary btn-sm">
            Cancel
          </button>
          <button data-testid="confirm-movement" onClick={submit} disabled={!canSubmit} className="btn-primary btn-sm">
            {record.isPending ? "Recording…" : "Record"}
          </button>
        </div>
      </div>
    </div>
  );
}
