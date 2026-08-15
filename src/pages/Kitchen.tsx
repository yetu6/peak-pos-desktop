import { useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import {
  useKitchenTickets,
  usePropertyId,
  useTransitionTicket,
} from "../hooks/usePosData";
import type { KitchenTicketResponse, TicketAction } from "../lib/posApi";

const NEXT_ACTION: Record<string, TicketAction> = {
  PENDING: "prepare",
  PREPARING: "ready",
  READY: "deliver",
};

const ACTION_LABEL: Record<string, string> = {
  prepare: "Start preparing",
  ready: "Mark ready",
  deliver: "Deliver",
};

function minutesSince(iso: string | undefined): number {
  if (!iso) return 0;
  const elapsed = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(elapsed / 60_000));
}

const STATUS_BADGE: Record<string, string> = {
  PENDING: "badge-info badge-dot",
  PREPARING: "badge-warning badge-dot",
  READY: "badge-success badge-dot",
  VOIDED: "badge-muted",
  DELIVERED: "badge-muted",
};

export function Kitchen() {
  const propertyId = usePropertyId();
  const { data: tickets = [], isLoading } = useKitchenTickets(propertyId);
  const transition = useTransitionTicket(propertyId);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const active = useMemo(
    () =>
      tickets.filter(
        (t: KitchenTicketResponse) =>
          t.status !== "DELIVERED" && t.status !== "VOIDED",
      ),
    [tickets],
  );

  const filtered = useMemo(
    () =>
      statusFilter === "all"
        ? active
        : active.filter((t: KitchenTicketResponse) => t.status === statusFilter),
    [active, statusFilter],
  );

  const counts = useMemo(() => {
    const by = new Map<string, number>();
    active.forEach((t: KitchenTicketResponse) => {
      if (t.status) by.set(t.status, (by.get(t.status) ?? 0) + 1);
    });
    return by;
  }, [active]);

  const late = active.filter((t: KitchenTicketResponse) => minutesSince(t.sentAt) >= 10).length;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-[96px] w-full rounded-xl" />
        <div className="skeleton h-[300px] w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Level 1: KPI strip */}
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
          <div className="kpi-value" data-testid="kpi-queue">
            {counts.get("PENDING") ?? 0}
          </div>
          <div className="kpi-label">In queue (new)</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon tone-accent">
            <Icon name="bolt" />
          </div>
          <div className="kpi-value" data-testid="kpi-preparing">
            {counts.get("PREPARING") ?? 0}
          </div>
          <div className="kpi-label">Preparing</div>
        </div>
        <div className="kpi-card">
          <div className={`kpi-icon ${late > 0 ? "tone-danger" : "tone-green"}`}>
            <Icon name="check" />
          </div>
          <div className="kpi-value" data-testid="kpi-ready">
            {counts.get("READY") ?? 0}
          </div>
          <div className="kpi-label">Ready · {late > 0 ? `${late} late` : "on time"}</div>
        </div>
      </div>

      {/* Level 3: page header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
            Kitchen Display
          </h2>
          <p className="mt-1 text-[13px] text-[var(--color-text-muted)]">
            Live ticket queue — updated in realtime from the committed event stream
          </p>
        </div>
      </div>

      {/* Level 4: status pills */}
      <div className="flex flex-wrap gap-2">
        <button
          data-testid="pill-all"
          className={`pill-filter-btn ${statusFilter === "all" ? "active" : ""}`}
          onClick={() => setStatusFilter("all")}
        >
          All <span className="pill-count">{active.length}</span>
        </button>
        {["PENDING", "PREPARING", "READY"].map((status) => (
          <button
            key={status}
            data-testid={`pill-${status.toLowerCase()}`}
            className={`pill-filter-btn ${statusFilter === status ? "active" : ""}`}
            onClick={() => setStatusFilter(status)}
          >
            {status.charAt(0) + status.slice(1).toLowerCase()}{" "}
            <span className="pill-count">{counts.get(status) ?? 0}</span>
          </button>
        ))}
      </div>

      {/* Level 5: ticket grid */}
      {filtered.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <Icon name="kitchen" size={40} />
            </div>
            <div className="empty-state-title">
              {active.length === 0 ? "Kitchen is quiet" : "No tickets match the filter"}
            </div>
            <div className="empty-state-desc">
              {active.length === 0
                ? "Tickets appear here in realtime when orders are sent from the floor."
                : "Clear the filter to see all active tickets."}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((ticket: KitchenTicketResponse) => {
            const age = minutesSince(ticket.sentAt);
            const action = ticket.status ? NEXT_ACTION[ticket.status] : undefined;
            return (
              <div
                key={ticket.id}
                className={`ticket-card ${ticket.status?.toLowerCase() ?? ""}`}
                data-testid={`ticket-${ticket.id}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-semibold text-[var(--color-text-primary)]">
                    {ticket.ticketNumber}
                  </div>
                  <div
                    className={`ticket-age ${age >= 10 ? "late" : ""}`}
                    data-testid={`age-${ticket.id}`}
                  >
                    {age}m
                  </div>
                </div>
                <div className="text-[11px] text-[var(--color-text-muted)]">
                  order {String(ticket.orderId).slice(0, 8)}…
                </div>
                <ul className="space-y-1 border-y border-[var(--color-border-subtle)] py-2 text-[13px]">
                  {(ticket.items ?? []).map((item) => (
                    <li
                      key={item.id}
                      className="flex items-baseline justify-between gap-2"
                    >
                      <span className="min-w-0 truncate text-[var(--color-text)]">
                        {item.itemName}
                      </span>
                      <span className="font-mono text-xs tabular-nums text-[var(--color-text-muted)]">
                        ×{item.quantity}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`badge ${STATUS_BADGE[ticket.status ?? ""] ?? "badge-muted"}`}
                  >
                    {ticket.status}
                  </span>
                  {action && (
                    <button
                      data-testid={`transition-${ticket.id}`}
                      onClick={() =>
                        transition.mutate({
                          ticketId: String(ticket.id),
                          action,
                        })
                      }
                      disabled={transition.isPending}
                      className="btn-primary btn-sm"
                    >
                      <Icon name="check" size={14} />
                      {ACTION_LABEL[action]}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}