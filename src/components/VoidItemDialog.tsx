import { useMemo, useState } from "react";
import { Icon } from "./Icon";
import { usePropertyId, useVoidOrderItem } from "../hooks/usePosData";
import { processPendingPrintJobs } from "../lib/printJobs";
import type { PosOrderItemResponse, PosOrderResponse } from "../lib/posApi";

export function VoidItemDialog({
  order,
  item,
  onClose,
}: {
  order: PosOrderResponse;
  item: PosOrderItemResponse;
  onClose: () => void;
}) {
  const propertyId = usePropertyId();
  const voidItem = useVoidOrderItem(propertyId);
  const sent = (item.serviceState ?? "UNSENT") !== "UNSENT";
  const [reason, setReason] = useState("");
  const [disposition, setDisposition] = useState<"RETURN_TO_STOCK" | "WASTE">("RETURN_TO_STOCK");

  const canSubmit = useMemo(() => {
    if (voidItem.isPending) return false;
    if (reason.trim().length < 3) return false;
    return true;
  }, [reason, voidItem.isPending]);

  function submit(): void {
    voidItem.mutate(
      {
        orderId: String(order.id),
        itemId: String(item.id),
        disposition: sent ? disposition : "RETURN_TO_STOCK",
        reason: reason.trim(),
      },
      {
        onSuccess: async () => {
          try {
            await processPendingPrintJobs(propertyId, String(item.id));
          } catch {
            // Printer failure does not un-void the item.
          }
          onClose();
        },
      },
    );
  }

  return (
    <div
      className="glass-scrim fixed inset-0 z-50 flex items-center justify-center p-4"
      data-testid="void-item-dialog"
    >
      <div className="glass-dialog w-full max-w-md p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-[var(--color-text-primary)]">
              Void {item.name}
            </div>
            <div className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
              {order.orderNumber} · ×{item.quantity}
            </div>
          </div>
          <button
            data-testid="void-item-close"
            onClick={onClose}
            className="rounded-md p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-border-subtle)]"
            aria-label="Close"
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        {sent && (
          <div className="mt-4 grid grid-cols-2 gap-2">
            {(["RETURN_TO_STOCK", "WASTE"] as const).map((option) => (
              <button
                key={option}
                data-testid={`void-disposition-${option}`}
                onClick={() => setDisposition(option)}
                className={`rounded-lg border px-2 py-2 text-[12px] font-medium ${
                  disposition === option
                    ? "border-[var(--color-gold)] bg-[var(--color-gold)]/10 text-[var(--color-text-primary)]"
                    : "border-[var(--color-border-subtle)] text-[var(--color-text-muted)]"
                }`}
              >
                {option === "WASTE" ? "Waste" : "Return to stock"}
              </button>
            ))}
          </div>
        )}

        <label className="mt-4 block text-[12px] font-medium text-[var(--color-text-secondary)]">
          Reason
        </label>
        <input
          data-testid="void-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className="input mt-1 w-full"
        />

        {voidItem.isError && (
          <div className="badge badge-danger mt-4" data-testid="void-item-error">
            {voidItem.error instanceof Error ? voidItem.error.message : "Void failed"}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="btn-tertiary btn-sm">
            Cancel
          </button>
          <button
            data-testid="confirm-void-item"
            onClick={submit}
            disabled={!canSubmit}
            className="btn-primary btn-sm"
          >
            {voidItem.isPending ? "Voiding…" : "Void item"}
          </button>
        </div>
      </div>
    </div>
  );
}
