import { useState } from "react";
import { Icon } from "./Icon";
import { useIdempotencyKey, useMutationMessage, useRemoveOrderItem } from "../hooks/usePosData";
import type { POSOrder, POSOrderItem } from "../lib/posContracts";

/**
 * `DELETE /pos/orders/{orderId}/items/{itemId}` removes only an UNSENT
 * item — that is the entire certified line-item correction. A sent item has
 * no per-line void in V1; the only certified correction for a sent/settled
 * order is the whole-order supervisor void (`VoidOrderDialog`). This dialog
 * is only ever opened for items whose status is still ADDED.
 */
export function RemoveItemDialog({
  order,
  item,
  onClose,
}: {
  order: POSOrder;
  item: POSOrderItem;
  onClose: () => void;
}) {
  const removeItem = useRemoveOrderItem();
  const idempotencyKey = useIdempotencyKey();
  const error = useMutationMessage(removeItem.error);
  const [confirming, setConfirming] = useState(false);

  function submit(): void {
    removeItem.mutate(
      { orderId: order.id, itemId: item.id, version: order.version, idempotencyKey: idempotencyKey.next() },
      { onSuccess: onClose },
    );
  }

  return (
    <div className="glass-scrim fixed inset-0 z-50 flex items-center justify-center p-4" data-testid="remove-item-dialog">
      <div className="glass-dialog w-full max-w-sm p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-[var(--foreground)]">Remove {item.name}</div>
            <div className="mt-0.5 text-[11px] text-[var(--foreground-muted)]">
              {order.orderNumber} · ×{item.quantity} · not yet sent
            </div>
          </div>
          <button
            data-testid="remove-item-close"
            onClick={onClose}
            className="rounded-md p-1 text-[var(--foreground-muted)] hover:bg-[var(--border-subtle)]"
            aria-label="Close"
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        {error && (
          <div className="badge badge-danger mt-4" data-testid="remove-item-error">
            {error}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="btn-tertiary btn-sm">
            Cancel
          </button>
          <button
            data-testid="confirm-remove-item"
            onClick={() => (confirming ? submit() : setConfirming(true))}
            disabled={removeItem.isPending}
            className="btn-primary btn-sm"
          >
            {removeItem.isPending ? "Removing…" : confirming ? "Confirm remove" : "Remove item"}
          </button>
        </div>
      </div>
    </div>
  );
}
