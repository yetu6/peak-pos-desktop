import { Icon } from "./Icon";
import { formatMinor } from "../lib/posMoney";
import { useIdempotencyKey, useMutationMessage, useReceipt, useReprintReceipt } from "../hooks/usePosData";

/**
 * The one immutable receipt Peak generated at settlement
 * (`GET /pos/orders/{orderId}/receipt`) — never a reconstruction from the
 * current live menu. Reprint calls the certified reprint endpoint, which
 * creates a new, auditable, chained print job; it never opens a new
 * payment or a new original receipt identity.
 */
export function ReceiptView({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const receipt = useReceipt(orderId);
  const reprint = useReprintReceipt();
  const idempotencyKey = useIdempotencyKey();
  const reprintError = useMutationMessage(reprint.error);

  return (
    <div className="glass-scrim fixed inset-0 z-50 flex items-center justify-center p-4" data-testid="receipt-view">
      <div className="glass-dialog w-full max-w-sm p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="text-sm font-semibold text-[var(--foreground)]">Receipt</div>
          <button onClick={onClose} className="rounded-md p-1 text-[var(--foreground-muted)] hover:bg-[var(--border-subtle)]" aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </div>

        {receipt.isLoading && <p className="mt-4 text-[12px] text-[var(--foreground-muted)]">Loading receipt…</p>}
        {receipt.isError && (
          <p className="mt-4 text-[12px] text-[var(--foreground-muted)]" data-testid="receipt-error">
            Receipt unavailable.
          </p>
        )}
        {receipt.data && (
          <div className="mt-4 space-y-3" data-testid="receipt-document">
            <div className="text-[12px] text-[var(--foreground-muted)]">
              <div>{receipt.data.document.orderNumber}</div>
              <div>{receipt.data.document.outletName}</div>
              <div>{new Date(receipt.data.document.settledAt).toLocaleString()}</div>
              <div>{receipt.data.document.tenderMethod.replaceAll("_", " ")}</div>
            </div>
            <ul className="space-y-1 border-y border-[var(--border-subtle)] py-2 text-[13px]">
              {receipt.data.document.items.map((line, index) => (
                <li key={index} className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate">
                    {line.quantity}× {line.name}
                  </span>
                  <span className="font-mono text-xs tabular-nums">
                    {formatMinor(line.totalMinor, receipt.data!.document.currency)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="space-y-1 text-[12px]">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span>{formatMinor(receipt.data.document.subtotalMinor, receipt.data.document.currency)}</span>
              </div>
              <div className="flex justify-between">
                <span>Tax</span>
                <span>{formatMinor(receipt.data.document.taxMinor, receipt.data.document.currency)}</span>
              </div>
              <div className="flex justify-between font-semibold text-[var(--foreground)]">
                <span>Total</span>
                <span>{formatMinor(receipt.data.document.totalMinor, receipt.data.document.currency)}</span>
              </div>
            </div>
            {receipt.data.reprintCount > 0 && (
              <p className="text-[11px] text-[var(--foreground-muted)]">Reprinted {receipt.data.reprintCount}×</p>
            )}
          </div>
        )}

        {reprintError && (
          <div className="badge badge-danger mt-3" data-testid="reprint-error">
            {reprintError}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="btn-tertiary btn-sm">
            Close
          </button>
          <button
            data-testid="reprint-receipt"
            onClick={() => reprint.mutate({ orderId, idempotencyKey: idempotencyKey.next() })}
            disabled={!receipt.data || reprint.isPending}
            className="btn-primary btn-sm"
          >
            <Icon name="orders" size={14} />
            {reprint.isPending ? "Printing…" : "Reprint"}
          </button>
        </div>
      </div>
    </div>
  );
}
