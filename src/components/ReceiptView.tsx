import { Icon } from "./Icon";
import { formatMinor } from "../lib/posMoney";
import { useIdempotencyKey, useMutationMessage, useReceipt, useReprintReceipt } from "../hooks/usePosData";

/**
 * Guest invoice from Peak settlement (`GET /pos/orders/{orderId}/receipt`).
 * Property brand at top, Yetu at bottom — never a TRA EFD fiscal receipt.
 */
export function ReceiptView({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const receipt = useReceipt(orderId);
  const reprint = useReprintReceipt();
  const idempotencyKey = useIdempotencyKey();
  const reprintError = useMutationMessage(reprint.error);
  const doc = receipt.data?.document;

  return (
    <div className="glass-scrim fixed inset-0 z-50 flex items-center justify-center p-4" data-testid="receipt-view">
      <div className="glass-dialog w-full max-w-sm overflow-hidden p-0">
        <div className="invoice-sheet px-5 py-5" data-testid="invoice-sheet">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-base font-bold tracking-tight text-[var(--slate-ink)]" data-testid="invoice-property">
                {doc?.propertyName ?? "Invoice"}
              </div>
              {doc?.outletName && (
                <div className="mt-0.5 text-[12px] text-[var(--slate-ink)]/70">{doc.outletName}</div>
              )}
            </div>
            <button
              onClick={onClose}
              className="rounded-md p-1 text-[var(--slate-ink)]/50 hover:bg-black/5"
              aria-label="Close"
            >
              <Icon name="x" size={16} />
            </button>
          </div>

          {receipt.isLoading && <p className="mt-4 text-[12px] text-[var(--slate-ink)]/60">Loading invoice…</p>}
          {receipt.isError && (
            <p className="mt-4 text-[12px] text-[var(--slate-ink)]/60" data-testid="receipt-error">
              Invoice unavailable.
            </p>
          )}
          {doc && (
            <div className="mt-4 space-y-3" data-testid="receipt-document">
              <div className="text-[12px] text-[var(--slate-ink)]/70">
                <div className="font-semibold text-[var(--slate-ink)]">{doc.orderNumber}</div>
                <div>{new Date(doc.settledAt).toLocaleString()}</div>
                <div>{doc.tenderMethod.replaceAll("_", " ")}</div>
                {doc.tableLabel && <div>Table {doc.tableLabel}</div>}
                {doc.initiatedByName && <div data-testid="invoice-taken-by">Taken by {doc.initiatedByName}</div>}
                {doc.operatorName && doc.operatorName !== doc.initiatedByName && (
                  <div data-testid="invoice-settled-by">Settled by {doc.operatorName}</div>
                )}
              </div>
              <ul className="space-y-1 border-y border-[var(--slate-ink)]/15 py-2 text-[13px] text-[var(--slate-ink)]">
                {doc.items.map((line, index) => (
                  <li key={index} className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate">
                      {line.quantity}× {line.name}
                    </span>
                    <span className="font-mono text-xs tabular-nums">
                      {formatMinor(line.totalMinor, doc.currency)}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="space-y-1 text-[12px] text-[var(--slate-ink)]">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span>{formatMinor(doc.subtotalMinor, doc.currency)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Tax</span>
                  <span>{formatMinor(doc.taxMinor, doc.currency)}</span>
                </div>
                <div className="flex justify-between text-sm font-semibold">
                  <span>Total</span>
                  <span>{formatMinor(doc.totalMinor, doc.currency)}</span>
                </div>
              </div>
              {receipt.data && receipt.data.reprintCount > 0 && (
                <p className="text-[11px] text-[var(--slate-ink)]/60">Reprinted {receipt.data.reprintCount}×</p>
              )}
              <div className="invoice-yetu-footer" data-testid="invoice-yetu-footer">
                <div className="font-semibold tracking-wide">Yetu</div>
                <div>Not a TRA fiscal receipt — use EFD for tax invoices.</div>
              </div>
            </div>
          )}
        </div>

        {reprintError && (
          <div className="badge badge-danger mx-5 mt-3" data-testid="reprint-error">
            {reprintError}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-[var(--border)] bg-[var(--surface)] px-5 py-4">
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
            {reprint.isPending ? "Printing…" : "Reprint invoice"}
          </button>
        </div>
      </div>
    </div>
  );
}
