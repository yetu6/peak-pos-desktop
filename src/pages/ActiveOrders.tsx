import { useState, type ReactNode } from "react";
import { Icon } from "../components/Icon";
import { PaySheet } from "../register/PaySheet";
import { RemoveItemDialog } from "../components/RemoveItemDialog";
import { VoidOrderDialog } from "../components/VoidOrderDialog";
import { ReceiptView } from "../components/ReceiptView";
import { moneyFormatter } from "../lib/posMoney";
import { useActiveOrders, useCatalogCurrency, useHasPermission, useIdempotencyKey, useMutationMessage, usePrintAfter, usePropertyId, useSendOrder } from "../hooks/usePosData";
import type { POSOrder, POSOrderItem } from "../lib/posContracts";

const STATUS_BADGE: Record<POSOrder["status"], string> = {
  OPEN: "badge-brand badge-dot",
  SENT: "badge-warning badge-dot",
  PREPARING: "badge-warning badge-dot",
  READY: "badge-info badge-dot",
  SERVED: "badge-info badge-dot",
  CLOSED: "badge-success badge-dot",
  VOIDED: "badge-muted",
};

export function ActiveOrders({ onNewOrder }: { onNewOrder?: () => void } = {}) {
  const propertyId = usePropertyId();
  const orders = useActiveOrders();
  const sendOrder = useSendOrder();
  const sendKey = useIdempotencyKey();
  const sendError = useMutationMessage(sendOrder.error);
  const printAfter = usePrintAfter(propertyId);
  const canSettle = useHasPermission("pos.payment.record");
  const [settling, setSettling] = useState<POSOrder | null>(null);
  const [removing, setRemoving] = useState<{ order: POSOrder; item: POSOrderItem } | null>(null);
  const [voiding, setVoiding] = useState<POSOrder | null>(null);
  const [receiptOrderId, setReceiptOrderId] = useState<string | null>(null);

  const list = orders.data ?? [];
  const open = list.filter((o) => o.status === "OPEN");
  const inKitchen = list.filter((o) => ["SENT", "PREPARING", "READY", "SERVED"].includes(o.status));
  const closed = list.filter((o) => o.status === "CLOSED");
  const currency = useCatalogCurrency();
  const money = moneyFormatter(currency);

  async function sendToKitchen(order: POSOrder): Promise<void> {
    const key = sendKey.next();
    const updated = await sendOrder.mutateAsync({ orderId: order.id, version: order.version, idempotencyKey: key });
    await printAfter(updated.id);
  }

  async function afterSettled(orderId: string): Promise<void> {
    await printAfter(orderId);
    setSettling(null);
    setReceiptOrderId(orderId);
  }

  function renderOrderCard(order: POSOrder, canSend: boolean): ReactNode {
    return (
      <article key={order.id} className="active-order-row" data-testid={`order-${order.id}`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-mono text-sm font-bold text-[var(--foreground)]">{order.orderNumber}</div>
            <div className="mt-1 text-[11px] uppercase tracking-[0.05em] text-[var(--foreground-muted)]">
              {order.serviceType.replaceAll("_", " ")} · {order.tableLabel ?? "no table"}
              {order.initiatedByName ? ` · ${order.initiatedByName}` : ""}
            </div>
          </div>
          <span className={`badge ${STATUS_BADGE[order.status]}`}>{order.status}</span>
        </div>
        <ul className="min-w-0 space-y-1 text-[13px]">
          {order.items.slice(0, 4).map((item) => (
            <li key={item.id} className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-[var(--foreground)]">{item.name}</span>
              <span className="flex items-center gap-2">
                <span className="font-mono text-xs tabular-nums text-[var(--foreground-muted)]">×{item.quantity}</span>
                {item.status === "ADDED" && (
                  <button
                    type="button"
                    data-testid={`remove-item-${item.id}`}
                    onClick={() => setRemoving({ order, item })}
                    className="min-h-11 rounded-md px-2 text-[11px] text-[var(--foreground-muted)] hover:bg-[var(--surface-interactive)] hover:text-[var(--foreground)]"
                  >
                    Remove
                  </button>
                )}
              </span>
            </li>
          ))}
          {order.items.length > 4 && <li className="text-[11px] text-[var(--foreground-muted)]">+{order.items.length - 4} more items</li>}
        </ul>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          <div className="money-display mr-2 text-base font-bold text-[var(--foreground)]">{money(order.totalMinor)}</div>
          <div className="flex flex-wrap justify-end gap-2">
            <button data-testid={`void-order-${order.id}`} onClick={() => setVoiding(order)} className="btn-tertiary btn-sm">
              Void
            </button>
            {canSend && canSettle && (
              <button data-testid={`settle-${order.id}`} onClick={() => setSettling(order)} disabled={!currency} className="btn-secondary btn-sm">
                <Icon name="payments" size={14} />
                Settle
              </button>
            )}
            {canSend && (
              <button data-testid={`send-${order.id}`} onClick={() => void sendToKitchen(order)} disabled={sendOrder.isPending} className="btn-primary btn-sm">
                <Icon name="kitchen" size={14} />
                Send to kitchen
              </button>
            )}
            {!canSend && order.status !== "CLOSED" && canSettle && (
              <button data-testid={`settle-${order.id}`} onClick={() => setSettling(order)} disabled={!currency} className="btn-primary btn-sm">
                <Icon name="payments" size={14} />
                Settle
              </button>
            )}
          </div>
        </div>
      </article>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold tracking-[-0.02em] text-[var(--foreground)]">Active orders</h1>
          <p className="mt-0.5 text-xs text-[var(--foreground-muted)]">Open, preparing, and ready checks.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="badge badge-brand">{open.length + inKitchen.length} open</span>
        </div>
      </div>

      {sendError && (
        <div className="badge badge-danger" data-testid="send-error">
          {sendError}
        </div>
      )}

      {list.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <Icon name="orders" size={40} />
            </div>
            <div className="empty-state-title">No open orders</div>
            <div className="empty-state-desc">Start a sale when the next guest is ready.</div>
            {onNewOrder && (
              <button type="button" onClick={onNewOrder} className="btn-primary mt-3">
                <Icon name="plus" size={17} />
                New order
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="active-orders-list" data-testid="active-orders-list">
            {[...open, ...inKitchen].map((order) => renderOrderCard(order, order.status === "OPEN"))}
          </div>

          {closed.length > 0 && (
            <div className="space-y-2">
              <div className="pt-2 text-[11px] font-semibold uppercase tracking-[0.5px] text-[var(--foreground-muted)]">Settled this session</div>
              <div className="flex flex-wrap gap-2">
                {closed.map((order) => (
                  <button
                    key={order.id}
                    className="badge badge-success"
                    data-testid={`settled-${order.id}`}
                    onClick={() => setReceiptOrderId(order.id)}
                  >
                    {order.orderNumber}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {settling && currency && (
        <PaySheet
          order={settling}
          currency={currency}
          onClose={() => setSettling(null)}
          onOrderChange={setSettling}
          onPaid={(paid) => void afterSettled(paid.order.id)}
        />
      )}
      {removing && <RemoveItemDialog order={removing.order} item={removing.item} onClose={() => setRemoving(null)} />}
      {voiding && <VoidOrderDialog order={voiding} currency={currency} onClose={() => setVoiding(null)} />}
      {receiptOrderId && <ReceiptView orderId={receiptOrderId} onClose={() => setReceiptOrderId(null)} />}
    </div>
  );
}
