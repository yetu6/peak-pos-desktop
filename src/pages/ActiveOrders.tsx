import { useState } from "react";
import { Icon } from "../components/Icon";
import { SettleDialog } from "../components/SettleDialog";
import {
  usePropertyId,
  useRealtimeOrders,
  useOutletId,
  useSendOrder,
} from "../hooks/usePosData";
import type { PosOrderResponse } from "../lib/posApi";

function statusBadge(order: PosOrderResponse): string {
  if (order.settlementStatus === "pending") return "badge-warning badge-dot";
  if (order.status === "open") return "badge-brand badge-dot";
  if (order.status === "closed") return "badge-success badge-dot";
  return "badge-muted";
}

function settlementLabel(order: PosOrderResponse): string {
  if (order.settlementStatus === "pending") return `settling · ${order.settlementMethod ?? ""}`;
  if (order.settlementStatus === "confirmed" || order.settlementStatus === "transferred") {
    return order.settlementMethod ?? "settled";
  }
  return order.status ?? "unknown";
}

export function ActiveOrders() {
  const propertyId = usePropertyId();
  const outletId = useOutletId();
  const orders = useRealtimeOrders(outletId);
  const sendOrder = useSendOrder(propertyId);
  const [settling, setSettling] = useState<PosOrderResponse | null>(null);

  const open = orders.filter((o) => o.status === "open");
  const settled = orders.filter((o) => o.status !== "open");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
            Active Orders
          </h2>
          <p className="mt-1 text-[13px] text-[var(--color-text-muted)]">
            REST is authoritative — the committed event stream announces changes and the
            board refetches each order
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="badge badge-brand">{open.length} open</span>
          <span className="badge badge-muted">seen {orders.length}</span>
        </div>
      </div>

      {orders.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <Icon name="orders" size={40} />
            </div>
            <div className="empty-state-title">No orders on this connection yet</div>
            <div className="empty-state-desc">
              Orders appear here in realtime as they are created on this outlet. The event
              stream announces every change; each order is fetched from REST.
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {open.map((order) => (
              <div
                key={order.id}
                className="card flex flex-col gap-3 p-4"
                data-testid={`order-${order.id}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-[var(--color-text-primary)]">
                      {order.orderNumber}
                    </div>
                    <div className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
                      {order.orderType} · {order.tableNumber ?? "no table"}
                    </div>
                  </div>
                  <span className={`badge ${statusBadge(order)}`}>
                    {settlementLabel(order)}
                  </span>
                </div>
                <ul className="space-y-1 border-y border-[var(--color-border-subtle)] py-2 text-[13px]">
                  {(order.items ?? []).slice(0, 4).map((item) => (
                    <li key={item.id} className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate text-[var(--color-text)]">
                        {item.name}
                      </span>
                      <span className="font-mono text-xs tabular-nums text-[var(--color-text-muted)]">
                        ×{item.quantity}
                      </span>
                    </li>
                  ))}
                  {(order.items?.length ?? 0) > 4 && (
                    <li className="text-[11px] text-[var(--color-text-muted)]">
                      +{order.items!.length - 4} more items
                    </li>
                  )}
                </ul>
                <div className="flex items-center justify-between gap-2">
                  <div className="font-display text-lg tabular-nums text-[var(--color-text-primary)]">
                    {order.totalAmount != null ? String(order.totalAmount) : "—"}
                  </div>
                  <div className="flex gap-2">
                    <button
                      data-testid={`settle-${order.id}`}
                      onClick={() => setSettling(order)}
                      disabled={order.settlementStatus === "pending"}
                      className="btn-secondary btn-sm"
                    >
                      <Icon name="payments" size={14} />
                      Settle
                    </button>
                    <button
                      data-testid={`send-${order.id}`}
                      onClick={() => sendOrder.mutate({ orderId: String(order.id) })}
                      disabled={sendOrder.isPending}
                      className="btn-primary btn-sm"
                    >
                      <Icon name="kitchen" size={14} />
                      Send to kitchen
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {settled.length > 0 && (
            <div className="space-y-2">
              <div className="pt-2 text-[11px] font-semibold uppercase tracking-[0.5px] text-[var(--color-text-muted)]">
                Settled this session
              </div>
              <div className="flex flex-wrap gap-2">
                {settled.map((order) => (
                  <span
                    key={order.id}
                    className="badge badge-success"
                    data-testid={`settled-${order.id}`}
                  >
                    {order.orderNumber}
                    {order.settlementMethod ? ` · ${order.settlementMethod}` : ""}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {settling && (
        <SettleDialog order={settling} onClose={() => setSettling(null)} />
      )}
    </div>
  );
}