import { useState } from "react";
import { Icon } from "../components/Icon";
import { useCreateOrder, useOutletMenu, usePosSession, usePropertyId } from "../hooks/usePosData";

interface CartLine {
  menuItemId: string;
  name: string;
  quantity: number;
}

const ORDER_TYPES = ["dine_in", "takeaway"] as const;

export function NewOrder() {
  const { session, open, close } = usePosSession();
  const createOrder = useCreateOrder(usePropertyId());
  const menuQuery = useOutletMenu();
  const menu = menuQuery.data?.items ?? [];
  const menuSource = menuQuery.data?.source;
  const [lines, setLines] = useState<CartLine[]>([]);
  const [orderType, setOrderType] = useState<(typeof ORDER_TYPES)[number]>("dine_in");
  const [tableNumber, setTableNumber] = useState("");
  const [specialRequest, setSpecialRequest] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [actualCash, setActualCash] = useState("");

  function addLine(item: (typeof menu)[number]): void {
    setCreated(null);
    setLines((prev) => {
      const existing = prev.find((l) => l.menuItemId === item.id);
      if (existing) {
        return prev.map((l) =>
          l.menuItemId === item.id ? { ...l, quantity: l.quantity + 1 } : l,
        );
      }
      return [...prev, { menuItemId: item.id, name: item.name, quantity: 1 }];
    });
  }

  function changeQuantity(menuItemId: string, delta: number): void {
    setLines((prev) =>
      prev
        .map((l) =>
          l.menuItemId === menuItemId ? { ...l, quantity: l.quantity + delta } : l,
        )
        .filter((l) => l.quantity > 0),
    );
  }

  const totalLines = lines.reduce((sum, l) => sum + l.quantity, 0);

  function submit(): void {
    if (!session?.id) return;
    createOrder.mutate(
      {
        sessionId: String(session.id),
        orderType,
        tableNumber: tableNumber.trim() || undefined,
        lines: lines.map((l) => ({
          menuItemId: l.menuItemId,
          quantity: l.quantity,
          specialRequest: lines.length === 1 ? specialRequest.trim() || undefined : undefined,
        })),
      },
      {
        onSuccess: (order) => {
          setLines([]);
          setSpecialRequest("");
          setTableNumber("");
          setCreated(order.orderNumber ?? null);
        },
      },
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
            New order
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {session ? (
            <>
              <span className="badge badge-success badge-dot" data-testid="session-open">
                Session open since {new Date(session.openedAt ?? "").toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
              <input
                data-testid="actual-cash"
                type="number"
                value={actualCash}
                onChange={(event) => setActualCash(event.target.value)}
                placeholder="Cash in drawer"
                className="input w-32"
              />
              <button
                data-testid="close-session"
                onClick={() => close.mutate(Number(actualCash))}
                disabled={close.isPending || !Number.isFinite(Number(actualCash)) || actualCash.trim() === ""}
                className="btn-tertiary btn-sm"
              >
                Close session
              </button>
            </>
          ) : (
            <button
              data-testid="open-session"
              onClick={() => open.mutate(0)}
              disabled={open.isPending}
              className="btn-primary btn-sm"
            >
              <Icon name="check" size={14} />
              {open.isPending ? "Opening…" : "Open session"}
            </button>
          )}
        </div>
      </div>

      {open.isError && (
        <div className="badge badge-danger" data-testid="open-error">
          {open.error instanceof Error ? open.error.message : "Could not open session"}
        </div>
      )}

      {!session ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <Icon name="clock" size={40} />
            </div>
            <div className="empty-state-title">No open drawer</div>
            <div className="empty-state-desc">Open one to start taking orders.</div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {ORDER_TYPES.map((type) => (
                <button
                  key={type}
                  data-testid={`order-type-${type}`}
                  onClick={() => setOrderType(type)}
                  className={`pill-filter-btn ${orderType === type ? "active" : ""}`}
                >
                  {type === "dine_in" ? "Dine in" : "Takeaway"}
                </button>
              ))}
              <input
                data-testid="table-number"
                value={tableNumber}
                onChange={(e) => setTableNumber(e.target.value)}
                placeholder="Table"
                className="input ml-auto w-44"
              />
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {menu.map((item) => (
                <button
                  key={item.id}
                  data-testid={`menu-${item.name}`}
                  onClick={() => addLine(item)}
                  className="card flex flex-col items-start gap-1 p-4 text-left transition-colors hover:border-[var(--color-gold)]"
                >
                  <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">
                    {item.name}
                  </span>
                  <span className="text-[11px] text-[var(--color-text-muted)]">
                    {item.category}
                  </span>
                </button>
              ))}
            </div>
            {/* A waiter can act on "the menu did not load". Which HTTP verb returned
                what, and where prices are computed, are facts about Peak — they belong
                in a log, not on a till in the middle of service. The fallback still
                reports itself, because serving yesterday's menu silently is worse. */}
            <p className="text-[11px] text-[var(--color-text-muted)]" data-testid="menu-source">
              {menuQuery.isError
                ? "Menu unavailable. Ask a manager."
                : menuSource === "peak"
                  ? ""
                  : "Menu may be out of date. Ask a manager."}
            </p>
          </div>

          <div className="glass-panel h-fit p-4">
            <div className="text-sm font-semibold text-[var(--color-text-primary)]">
              Order · {totalLines} {totalLines === 1 ? "item" : "items"}
            </div>
            <ul className="mt-3 space-y-2">
              {lines.length === 0 && (
                <li className="text-[12px] text-[var(--color-text-muted)]">
                  Tap menu items to add them.
                </li>
              )}
              {lines.map((line) => (
                <li
                  key={line.menuItemId}
                  className="flex items-center justify-between gap-2 text-[13px]"
                  data-testid={`cart-${line.name}`}
                >
                  <span className="min-w-0 truncate text-[var(--color-text)]">
                    {line.name}
                  </span>
                  <span className="flex items-center gap-1">
                    <button
                      onClick={() => changeQuantity(line.menuItemId, -1)}
                      className="qty-btn"
                      aria-label={`Decrease ${line.name}`}
                    >
                      −
                    </button>
                    <span className="w-6 text-center font-mono text-sm tabular-nums">
                      {line.quantity}
                    </span>
                    <button
                      onClick={() => changeQuantity(line.menuItemId, 1)}
                      className="qty-btn"
                      aria-label={`Increase ${line.name}`}
                    >
                      +
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            {lines.length === 1 && (
              <input
                data-testid="special-request"
                value={specialRequest}
                onChange={(e) => setSpecialRequest(e.target.value)}
                placeholder="Special request"
                className="input mt-3 w-full"
              />
            )}
            {created && (
              <div className="badge badge-success mt-3" data-testid="order-created">
                {created} sent to Active orders
              </div>
            )}
            {createOrder.isError && (
              <div className="badge badge-danger mt-3" data-testid="create-error">
                {createOrder.error instanceof Error
                  ? createOrder.error.message
                  : "Could not create the order"}
              </div>
            )}
            <button
              data-testid="create-order"
              onClick={submit}
              disabled={lines.length === 0 || createOrder.isPending}
              className="btn-primary btn-md mt-4 w-full"
            >
              <Icon name="orders" size={16} />
              {createOrder.isPending ? "Creating…" : "Create order"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}