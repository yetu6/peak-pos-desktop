import { useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import { useActiveOrders, useIdempotencyKey, useMutationMessage, useTransitionOrderStatus } from "../hooks/usePosData";
import type { POSOrder, OrderStatus } from "../lib/posContracts";

/**
 * Kitchen production state is the order's own status
 * (`SENT → PREPARING → READY → SERVED`, `transitionPOSOrderProductionStatus`)
 * — there is no separate "kitchen ticket" resource in the certified
 * backend, and no per-ticket void endpoint. A correction to a sent order is
 * the whole-order supervisor void from Active Orders, not a kitchen action.
 */
const NEXT_STATUS: Partial<Record<OrderStatus, "PREPARING" | "READY" | "SERVED">> = {
  SENT: "PREPARING",
  PREPARING: "READY",
  READY: "SERVED",
};

const ACTION_LABEL: Record<string, string> = {
  PREPARING: "Start preparing",
  READY: "Mark ready",
  SERVED: "Mark served",
};

const STATUS_BADGE: Record<string, string> = {
  SENT: "badge-info badge-dot",
  PREPARING: "badge-warning badge-dot",
  READY: "badge-success badge-dot",
};

export function Kitchen() {
  const orders = useActiveOrders();
  const transition = useTransitionOrderStatus();
  const transitionKey = useIdempotencyKey();
  const transitionError = useMutationMessage(transition.error);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const active = useMemo(
    () => (orders.data ?? []).filter((order) => order.status === "SENT" || order.status === "PREPARING" || order.status === "READY"),
    [orders.data],
  );

  const filtered = useMemo(
    () => (statusFilter === "all" ? active : active.filter((order) => order.status === statusFilter)),
    [active, statusFilter],
  );

  const counts = useMemo(() => {
    const by = new Map<string, number>();
    active.forEach((order) => by.set(order.status, (by.get(order.status) ?? 0) + 1));
    return by;
  }, [active]);

  function advance(order: POSOrder): void {
    const next = NEXT_STATUS[order.status];
    if (!next) return;
    transition.mutate({ orderId: order.id, status: next, version: order.version, idempotencyKey: transitionKey.next() });
  }

  if (orders.isLoading) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-[96px] w-full rounded-xl" />
        <div className="skeleton h-[300px] w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-4">
        <div className="kpi-card">
          <div className="kpi-icon tone-brand">
            <Icon name="orders" />
          </div>
          <div className="kpi-value" data-testid="kpi-active">{active.length}</div>
          <div className="kpi-label">Active tickets</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon tone-warning">
            <Icon name="clock" />
          </div>
          <div className="kpi-value" data-testid="kpi-queue">{counts.get("SENT") ?? 0}</div>
          <div className="kpi-label">In queue (new)</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon tone-accent">
            <Icon name="bolt" />
          </div>
          <div className="kpi-value" data-testid="kpi-preparing">{counts.get("PREPARING") ?? 0}</div>
          <div className="kpi-label">Preparing</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon tone-green">
            <Icon name="check" />
          </div>
          <div className="kpi-value" data-testid="kpi-ready">{counts.get("READY") ?? 0}</div>
          <div className="kpi-label">Ready</div>
        </div>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <h2 className="text-lg font-semibold text-[var(--foreground)]">Kitchen</h2>
      </div>

      <div className="flex flex-wrap gap-2">
        <button data-testid="pill-all" className={`pill-filter-btn ${statusFilter === "all" ? "active" : ""}`} onClick={() => setStatusFilter("all")}>
          All <span className="pill-count">{active.length}</span>
        </button>
        {["SENT", "PREPARING", "READY"].map((status) => (
          <button
            key={status}
            data-testid={`pill-${status.toLowerCase()}`}
            className={`pill-filter-btn ${statusFilter === status ? "active" : ""}`}
            onClick={() => setStatusFilter(status)}
          >
            {status.charAt(0) + status.slice(1).toLowerCase()} <span className="pill-count">{counts.get(status) ?? 0}</span>
          </button>
        ))}
      </div>

      {transitionError && (
        <div className="badge badge-danger" data-testid="transition-error">
          {transitionError}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <Icon name="kitchen" size={40} />
            </div>
            <div className="empty-state-title">{active.length === 0 ? "Kitchen is quiet" : "No tickets match the filter"}</div>
            <div className="empty-state-desc">
              {active.length === 0 ? "Tickets appear when the floor sends an order." : "Clear the filter to see all active tickets."}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((order) => {
            const next = NEXT_STATUS[order.status];
            return (
              <div key={order.id} className={`ticket-card ${order.status.toLowerCase()}`} data-testid={`ticket-${order.id}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-semibold text-[var(--foreground)]">{order.orderNumber}</div>
                  <span className={`badge ${STATUS_BADGE[order.status] ?? "badge-muted"}`}>{order.status}</span>
                </div>
                <div className="text-[11px] text-[var(--foreground-muted)]">
                  {order.serviceType.replaceAll("_", " ")} · {order.tableLabel ?? "no table"}
                </div>
                <ul className="space-y-1 border-y border-[var(--border-subtle)] py-2 text-[13px]">
                  {order.items.map((item) => (
                    <li key={item.id} className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate text-[var(--foreground)]">{item.name}</span>
                      <span className="font-mono text-xs tabular-nums text-[var(--foreground-muted)]">×{item.quantity}</span>
                    </li>
                  ))}
                </ul>
                {next && (
                  <button
                    data-testid={`transition-${order.id}`}
                    onClick={() => advance(order)}
                    disabled={transition.isPending}
                    className="btn-primary btn-sm w-full"
                  >
                    <Icon name="check" size={14} />
                    {ACTION_LABEL[next]}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
