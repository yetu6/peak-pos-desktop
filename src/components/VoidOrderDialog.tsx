import { useState } from "react";
import { Icon } from "./Icon";
import { useDeviceSessionOptional } from "../auth/DeviceSessionProvider";
import { useIdempotencyKey, useMutationMessage, useVoidOrder } from "../hooks/usePosData";
import type { POSOrder } from "../lib/posContracts";

/**
 * `POST /pos/orders/{orderId}/void` — the one certified correction for a
 * sent or settled order. It requires a DIFFERENT supervisor's own PIN
 * (`pos.order.void`); Peak audits initiator and authorizer separately. This
 * is a void, never a refund — no money movement is invented here, and none
 * is implied in the copy.
 */
export function VoidOrderDialog({ order, onClose }: { order: POSOrder; onClose: () => void }) {
  const roster = useDeviceSessionOptional()?.roster ?? [];
  const voidOrder = useVoidOrder();
  const idempotencyKey = useIdempotencyKey();
  const error = useMutationMessage(voidOrder.error);
  const [supervisorStaffId, setSupervisorStaffId] = useState("");
  const [supervisorPin, setSupervisorPin] = useState("");
  const [reason, setReason] = useState("");

  const canSubmit =
    supervisorStaffId.trim().length > 0 &&
    /^\d{6}$/.test(supervisorPin) &&
    reason.trim().length > 0 &&
    !voidOrder.isPending;

  function submit(): void {
    voidOrder.mutate(
      {
        orderId: order.id,
        reason: reason.trim(),
        supervisorStaffId: supervisorStaffId.trim(),
        supervisorPin,
        version: order.version,
        idempotencyKey: idempotencyKey.next(),
      },
      { onSuccess: onClose },
    );
  }

  return (
    <div className="glass-scrim fixed inset-0 z-50 flex items-center justify-center p-4" data-testid="void-order-dialog">
      <div className="glass-dialog w-full max-w-sm p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-[var(--foreground)]">Void {order.orderNumber}</div>
            <div className="mt-0.5 text-[11px] text-[var(--foreground-muted)]">
              Requires a different supervisor's PIN. This is a void, not a refund.
            </div>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-[var(--foreground-muted)] hover:bg-[var(--border-subtle)]" aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </div>

        <label className="mt-4 block text-[12px] font-medium text-[var(--foreground-muted)]">Supervisor</label>
        {roster.length > 0 ? (
          <select
            data-testid="void-supervisor-select"
            value={supervisorStaffId}
            onChange={(event) => setSupervisorStaffId(event.target.value)}
            className="input mt-1 w-full"
          >
            <option value="">Select supervisor…</option>
            {roster.map((entry) => (
              <option key={entry.staffNumber} value={entry.staffNumber}>
                {entry.fullName}
              </option>
            ))}
          </select>
        ) : (
          <input
            data-testid="void-supervisor-id"
            value={supervisorStaffId}
            onChange={(event) => setSupervisorStaffId(event.target.value)}
            placeholder="Supervisor staff id"
            className="input mt-1 w-full"
          />
        )}

        <label className="mt-3 block text-[12px] font-medium text-[var(--foreground-muted)]">Supervisor PIN</label>
        <input
          data-testid="void-supervisor-pin"
          type="password"
          inputMode="numeric"
          maxLength={6}
          value={supervisorPin}
          onChange={(event) => setSupervisorPin(event.target.value.replace(/\D/g, ""))}
          className="input mt-1 w-full"
        />

        <label className="mt-3 block text-[12px] font-medium text-[var(--foreground-muted)]">Reason</label>
        <input
          data-testid="void-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className="input mt-1 w-full"
        />

        {error && (
          <div className="badge badge-danger mt-4" data-testid="void-order-error">
            {error}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="btn-tertiary btn-sm">
            Cancel
          </button>
          <button data-testid="confirm-void-order" onClick={submit} disabled={!canSubmit} className="btn-primary btn-sm">
            {voidOrder.isPending ? "Voiding…" : "Void order"}
          </button>
        </div>
      </div>
    </div>
  );
}
