import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { useDeviceSession } from "../auth/DeviceSessionProvider";
import {
  useActiveOrders,
  useIdempotencyKey,
  useMutationMessage,
  useStationTickets,
  useTransitionOrderStatus,
  useTransitionStationTicket,
} from "../hooks/usePosData";
import type { POSOrder, OrderStatus, POSStationTicket } from "../lib/posContracts";

/**
 * Kitchen production: order-level bump on the compact peek, station-ticket
 * bump on KITCHEN_DISPLAY / BAR_DISPLAY (Pass 4 multi-station routing).
 */
const NEXT_STATUS: Partial<Record<OrderStatus, "PREPARING" | "READY" | "SERVED">> = {
  SENT: "PREPARING",
  PREPARING: "READY",
  READY: "SERVED",
};

const NEXT_TICKET: Partial<Record<POSStationTicket["status"], "PREPARING" | "READY" | "SERVED">> = {
  SENT: "PREPARING",
  PREPARING: "READY",
  READY: "SERVED",
};

const ACTION_LABEL: Record<string, string> = {
  PREPARING: "Start",
  READY: "Ready",
  SERVED: "Served",
};

const COLUMNS: Array<{ status: OrderStatus; title: string }> = [
  { status: "SENT", title: "New" },
  { status: "PREPARING", title: "Preparing" },
  { status: "READY", title: "Ready" },
];

function isDisplayMode(mode?: string | null): boolean {
  const normalized = (mode ?? "").trim().toUpperCase().replace(/-/g, "_");
  return normalized === "KITCHEN_DISPLAY" || normalized === "BAR_DISPLAY";
}

function elapsedLabel(fromIso: string | undefined, nowMs: number): string {
  if (!fromIso) return "—";
  const started = Date.parse(fromIso);
  if (!Number.isFinite(started)) return "—";
  const minutes = Math.max(0, Math.floor((nowMs - started) / 60_000));
  if (minutes < 1) return "<1m";
  return `${minutes}m`;
}

function urgencyClass(fromIso: string | undefined, nowMs: number): string {
  if (!fromIso) return "";
  const started = Date.parse(fromIso);
  if (!Number.isFinite(started)) return "";
  const minutes = (nowMs - started) / 60_000;
  if (minutes >= 20) return "kds-card--critical";
  if (minutes >= 10) return "kds-card--urgent";
  return "";
}

function playNewTicketChime(): void {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.04;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.18);
    void ctx.close();
  } catch {
    // Audio is best-effort on shared kitchen hardware.
  }
}

function StationCard({
  ticket,
  ageLabel,
  urgency,
  pending,
  onBump,
}: {
  ticket: POSStationTicket;
  ageLabel: string;
  urgency: string;
  pending: boolean;
  onBump: (ticket: POSStationTicket) => void;
}) {
  const next = NEXT_TICKET[ticket.status];
  return (
    <article
      className={`kds-card kds-card--wall ${urgency}`}
      data-testid={`kitchen-ticket-${ticket.id}`}
    >
      <header className="kds-card__header">
        <div>
          <div className="kds-card__number">{ticket.orderNumber}</div>
          <div className="kds-card__meta">
            {(ticket.tableLabel ? `Table ${ticket.tableLabel}` : "No table") +
              " · " +
              ticket.serviceType.replaceAll("_", " ") +
              " · " +
              ticket.station}
          </div>
          {ticket.waiterName && (
            <div className="kds-card__waiter" data-testid={`waiter-${ticket.id}`}>
              {ticket.waiterName}
            </div>
          )}
        </div>
        <span className="kds-card__timer" data-testid={`timer-${ticket.id}`}>
          {ageLabel}
        </span>
      </header>
      <ul className="kds-card__lines">
        {ticket.items.map((item) => (
          <li key={item.id}>
            <span className="kds-card__qty">{item.quantity}×</span>
            <span className="kds-card__name">
              {item.name}
              {item.modifiers?.length ? (
                <span className="kds-card__mods">
                  {item.modifiers.map((mod) => mod.optionName).filter(Boolean).join(", ")}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {ticket.notes?.trim() && <p className="kds-card__notes">{ticket.notes}</p>}
      {next && (
        <button
          type="button"
          className="kds-bump"
          data-testid={`bump-ticket-${ticket.id}`}
          disabled={pending}
          onClick={() => onBump(ticket)}
        >
          {ACTION_LABEL[next] ?? next}
        </button>
      )}
    </article>
  );
}

function KitchenCard({
  order,
  ageLabel,
  urgency,
  display,
  pending,
  onBump,
}: {
  order: POSOrder;
  ageLabel: string;
  urgency: string;
  display: boolean;
  pending: boolean;
  onBump: (order: POSOrder) => void;
}) {
  const next = NEXT_STATUS[order.status];
  return (
    <article
      className={`kds-card ${display ? "kds-card--wall" : ""} ${urgency}`}
      data-testid={`kitchen-order-${order.id}`}
    >
      <header className="kds-card__header">
        <div>
          <div className="kds-card__number">{order.orderNumber}</div>
          <div className="kds-card__meta">
            {(order.tableLabel ? `Table ${order.tableLabel}` : "No table") +
              " · " +
              order.serviceType.replaceAll("_", " ")}
          </div>
          {order.initiatedByName && (
            <div className="kds-card__waiter" data-testid={`waiter-${order.id}`}>
              {order.initiatedByName}
            </div>
          )}
        </div>
        <span className="kds-card__timer" data-testid={`timer-${order.id}`}>
          {ageLabel}
        </span>
      </header>
      <ul className="kds-card__lines">
        {order.items.map((item) => (
          <li key={item.id}>
            <span className="kds-card__qty">{item.quantity}×</span>
            <span className="kds-card__name">
              {item.name}
              {item.modifiers?.length ? (
                <span className="kds-card__mods">
                  {item.modifiers.map((mod) => mod.optionName).filter(Boolean).join(", ")}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {order.notes?.trim() && <p className="kds-card__notes">{order.notes}</p>}
      {next && (
        <button
          type="button"
          className={display ? "kds-bump" : "btn-primary w-full"}
          data-testid={`bump-${order.id}`}
          disabled={pending}
          onClick={() => onBump(order)}
        >
          {ACTION_LABEL[next] ?? next}
        </button>
      )}
    </article>
  );
}

export function Kitchen() {
  const { identity } = useDeviceSession();
  const display = isDisplayMode(identity?.mode);
  const orders = useActiveOrders();
  const tickets = useStationTickets(display);
  const transition = useTransitionOrderStatus();
  const transitionTicket = useTransitionStationTicket();
  const transitionKey = useIdempotencyKey();
  const transitionError = useMutationMessage(transition.error) ?? useMutationMessage(transitionTicket.error);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const seenSent = useRef<Set<string>>(new Set());
  const firstSeen = useRef<Map<string, number>>(new Map());
  const primed = useRef(false);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (display) void tickets.refetch();
      else void orders.refetch();
    }, 15_000);
    return () => window.clearInterval(id);
  }, [display, orders, tickets]);

  const activeTickets = useMemo(
    () => (tickets.data ?? []).filter((t) => t.status === "SENT" || t.status === "PREPARING" || t.status === "READY"),
    [tickets.data],
  );

  const active = useMemo(
    () =>
      (orders.data ?? []).filter(
        (order) => order.status === "SENT" || order.status === "PREPARING" || order.status === "READY",
      ),
    [orders.data],
  );

  useEffect(() => {
    const source = display ? activeTickets.map((t) => ({ id: t.id, status: t.status })) : active.map((o) => ({ id: o.id, status: o.status }));
    for (const row of source) {
      if (!firstSeen.current.has(row.id)) firstSeen.current.set(row.id, Date.now());
    }
    if (!primed.current) {
      source.forEach((row) => {
        if (row.status === "SENT") seenSent.current.add(row.id);
      });
      primed.current = true;
      return;
    }
    for (const row of source) {
      if (row.status === "SENT" && !seenSent.current.has(row.id)) {
        seenSent.current.add(row.id);
        playNewTicketChime();
      }
    }
  }, [active, activeTickets, display]);

  function ageFor(id: string): { label: string; urgency: string } {
    const seenAt = firstSeen.current.get(id);
    if (!seenAt) return { label: "—", urgency: "" };
    const iso = new Date(seenAt).toISOString();
    return { label: elapsedLabel(iso, nowMs), urgency: urgencyClass(iso, nowMs) };
  }

  const filtered = useMemo(
    () => (statusFilter === "all" ? active : active.filter((order) => order.status === statusFilter)),
    [active, statusFilter],
  );

  const counts = useMemo(() => {
    const by = new Map<string, number>();
    active.forEach((order) => by.set(order.status, (by.get(order.status) ?? 0) + 1));
    return by;
  }, [active]);

  const stationLabel = useMemo(() => {
    const bound = identity?.prepStations ?? [];
    if (bound.length === 0) return "All stations";
    return bound.join(" · ");
  }, [identity?.prepStations]);

  function advance(order: POSOrder): void {
    const next = NEXT_STATUS[order.status];
    if (!next) return;
    transition.mutate({
      orderId: order.id,
      status: next,
      version: order.version,
      idempotencyKey: transitionKey.next(),
    });
  }

  function advanceTicket(ticket: POSStationTicket): void {
    const next = NEXT_TICKET[ticket.status];
    if (!next) return;
    transitionTicket.mutate({
      ticketId: ticket.id,
      status: next,
      version: ticket.version,
      idempotencyKey: transitionKey.next(),
    });
  }

  if ((display && tickets.isLoading) || (!display && orders.isLoading)) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-[96px] w-full rounded-xl" />
        <div className="skeleton h-[300px] w-full rounded-xl" />
      </div>
    );
  }

  if (display) {
    return (
      <div className="kds-board" data-testid="kds-board">
        <header className="kds-board__header">
          <div>
            <h1 className="kds-board__title">
              {(identity?.mode ?? "").includes("BAR") ? "Bar" : "Kitchen"}
            </h1>
            <p className="kds-board__subtitle">
              {activeTickets.length} active · {stationLabel} · tap a ticket to bump
            </p>
          </div>
          {transitionError && (
            <div className="badge badge-danger" data-testid="kitchen-error">
              {transitionError}
            </div>
          )}
        </header>
        <div className="kds-columns">
          {COLUMNS.map((column) => {
            const columnTickets = activeTickets.filter((ticket) => ticket.status === column.status);
            return (
              <section key={column.status} className="kds-column" data-testid={`kds-col-${column.status}`}>
                <div className="kds-column__head">
                  <span>{column.title}</span>
                  <span className="kds-column__count">{columnTickets.length}</span>
                </div>
                <div className="kds-column__body">
                  {columnTickets.map((ticket) => {
                    const age = ageFor(ticket.id);
                    return (
                      <StationCard
                        key={ticket.id}
                        ticket={ticket}
                        ageLabel={age.label}
                        urgency={age.urgency}
                        pending={transitionTicket.isPending}
                        onBump={advanceTicket}
                      />
                    );
                  })}
                  {columnTickets.length === 0 && <p className="kds-empty">Clear</p>}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="kitchen-compact">
      <div className="flex flex-wrap gap-4">
        <div className="kpi-card">
          <div className="kpi-icon tone-brand">
            <Icon name="orders" />
          </div>
          <div className="kpi-value" data-testid="kpi-active">
            {active.length}
          </div>
          <div className="kpi-label">Active tickets</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon tone-warning">
            <Icon name="clock" />
          </div>
          <div className="kpi-value" data-testid="kpi-queue">
            {counts.get("SENT") ?? 0}
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
          <div className="kpi-icon tone-green">
            <Icon name="check" />
          </div>
          <div className="kpi-value" data-testid="kpi-ready">
            {counts.get("READY") ?? 0}
          </div>
          <div className="kpi-label">Ready</div>
        </div>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <h2 className="text-lg font-semibold text-[var(--foreground)]">Kitchen</h2>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          data-testid="pill-all"
          className={`pill-filter-btn ${statusFilter === "all" ? "active" : ""}`}
          onClick={() => setStatusFilter("all")}
        >
          All <span className="pill-count">{active.length}</span>
        </button>
        {["SENT", "PREPARING", "READY"].map((status) => (
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

      {transitionError && (
        <div className="badge badge-danger" data-testid="kitchen-error">
          {transitionError}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((order) => {
          const age = ageFor(order.id);
          return (
            <KitchenCard
              key={order.id}
              order={order}
              ageLabel={age.label}
              urgency={age.urgency}
              display={false}
              pending={transition.isPending}
              onBump={advance}
            />
          );
        })}
        {filtered.length === 0 && (
          <p className="text-sm text-[var(--foreground-muted)]">No kitchen tickets right now.</p>
        )}
      </div>
    </div>
  );
}
