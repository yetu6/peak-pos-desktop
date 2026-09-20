import { useState } from "react";
import { Icon } from "./Icon";
import { useDeviceSessionOptional } from "../auth/DeviceSessionProvider";
import { useApplyDiscount, useIdempotencyKey, useMutationMessage } from "../hooks/usePosData";
import { formatMinor, toMinor } from "../lib/posMoney";
import type { DiscountKind, POSOrder } from "../lib/posContracts";

/**
 * Supervisor-gated order-level discount. Peak applies it to the pre-tax
 * subtotal and recomputes tax proportionally. Cleared on the next line
 * add/remove; refused after any tender.
 */
export function DiscountDialog({
  order,
  currency,
  onClose,
  onApplied,
}: {
  order: POSOrder;
  currency: string;
  onClose: () => void;
  onApplied: (order: POSOrder) => void;
}) {
  const roster = useDeviceSessionOptional()?.roster ?? [];
  const applyDiscount = useApplyDiscount();
  const idempotencyKey = useIdempotencyKey();
  const error = useMutationMessage(applyDiscount.error);
  const [kind, setKind] = useState<DiscountKind>("AMOUNT");
  const [valueText, setValueText] = useState("");
  const [reason, setReason] = useState("");
  const [supervisorStaffId, setSupervisorStaffId] = useState("");
  const [supervisorPin, setSupervisorPin] = useState("");

  const valueMinorOrBp =
    kind === "AMOUNT" ? toMinor(valueText) : (() => {
      const n = Number(valueText);
      if (!Number.isFinite(n) || n <= 0 || n > 100) return null;
      return Math.round(n * 100); // percent → basis points
    })();

  const canSubmit =
    supervisorStaffId.trim().length > 0 &&
    /^\d{6}$/.test(supervisorPin) &&
    reason.trim().length > 0 &&
    valueMinorOrBp != null &&
    valueMinorOrBp > 0 &&
    !applyDiscount.isPending;

  function submit(): void {
    if (valueMinorOrBp == null) return;
    applyDiscount.mutate(
      {
        orderId: order.id,
        kind,
        value: valueMinorOrBp,
        reason: reason.trim(),
        supervisorStaffId: supervisorStaffId.trim(),
        supervisorPin,
        version: order.version,
        idempotencyKey: idempotencyKey.next(),
      },
      { onSuccess: (updated) => { onApplied(updated); onClose(); } },
    );
  }

  return (
    <div className="glass-scrim fixed inset-0 z-50 flex items-center justify-center p-4" data-testid="discount-dialog">
      <div className="glass-dialog w-full max-w-sm p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-[var(--foreground)]">Discount {order.orderNumber}</div>
            <div className="mt-0.5 text-[11px] text-[var(--foreground-muted)]">
              Subtotal {formatMinor(order.subtotalMinor, currency)}. Requires a different supervisor&apos;s PIN.
            </div>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-[var(--foreground-muted)] hover:bg-[var(--border-subtle)]" aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            data-testid="discount-kind-amount"
            aria-pressed={kind === "AMOUNT"}
            onClick={() => { setKind("AMOUNT"); setValueText(""); }}
            className={`pill-filter-btn ${kind === "AMOUNT" ? "active" : ""}`}
          >
            Amount
          </button>
          <button
            type="button"
            data-testid="discount-kind-percent"
            aria-pressed={kind === "PERCENT"}
            onClick={() => { setKind("PERCENT"); setValueText(""); }}
            className={`pill-filter-btn ${kind === "PERCENT" ? "active" : ""}`}
          >
            Percent
          </button>
        </div>

        <label className="mt-3 block text-[12px] font-medium text-[var(--foreground-muted)]">
          {kind === "AMOUNT" ? "Discount amount" : "Discount percent"}
        </label>
        <input
          data-testid="discount-value"
          type="number"
          inputMode="decimal"
          value={valueText}
          onChange={(event) => setValueText(event.target.value)}
          placeholder={kind === "AMOUNT" ? "0.00" : "10"}
          className="input mt-1 w-full"
        />

        <label className="mt-3 block text-[12px] font-medium text-[var(--foreground-muted)]">Supervisor</label>
        {roster.length > 0 ? (
          <select
            data-testid="discount-supervisor-select"
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
            data-testid="discount-supervisor-id"
            value={supervisorStaffId}
            onChange={(event) => setSupervisorStaffId(event.target.value)}
            placeholder="Supervisor staff id"
            className="input mt-1 w-full"
          />
        )}

        <label className="mt-3 block text-[12px] font-medium text-[var(--foreground-muted)]">Supervisor PIN</label>
        <input
          data-testid="discount-supervisor-pin"
          type="password"
          inputMode="numeric"
          maxLength={6}
          value={supervisorPin}
          onChange={(event) => setSupervisorPin(event.target.value.replace(/\D/g, ""))}
          className="input mt-1 w-full"
        />

        <label className="mt-3 block text-[12px] font-medium text-[var(--foreground-muted)]">Reason</label>
        <input
          data-testid="discount-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className="input mt-1 w-full"
        />

        {error && (
          <div className="badge badge-danger mt-4" data-testid="discount-error">
            {error}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="btn-tertiary btn-sm">
            Cancel
          </button>
          <button data-testid="confirm-discount" onClick={submit} disabled={!canSubmit} className="btn-primary btn-sm">
            {applyDiscount.isPending ? "Applying…" : "Apply discount"}
          </button>
        </div>
      </div>
    </div>
  );
}
