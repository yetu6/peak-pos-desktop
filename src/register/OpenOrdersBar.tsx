import { Plus } from "lucide-react";
import { Button } from "../components/system";
import { useActiveOrders } from "../hooks/usePosData";
import { formatMoney } from "../lib/money";
import type { POSOrder } from "../lib/posContracts";
import { barOrder, openOrderWords, openOrdersOf } from "./openOrders";

/**
 * The open orders on this till's outlet, across the top of the ticket (owner,
 * 2026-10-21: a waiter serving three customers works on three orders). One
 * tap moves the ticket to another order; New starts one. Each order reads as
 * the waiter knows it -- its table or name, else its number -- with what is
 * on it and what it comes to. Nothing open, no bar.
 */
export function OpenOrdersBar({
  orders,
  current,
  staffId,
  currency,
  disabled = false,
  onPick,
  onNew,
}: {
  orders: readonly POSOrder[];
  /** The order on the ticket, shown even before the list has caught up with it. */
  current: POSOrder | null;
  staffId: string | null | undefined;
  currency: string | undefined;
  /** While the ticket is busy with Yetu, the ticket stays where it is. */
  disabled?: boolean;
  onPick: (order: POSOrder) => void;
  onNew: () => void;
}) {
  const listed = current && !orders.some((order) => order.id === current.id) ? [...orders, current] : orders;
  const shown = barOrder(openOrdersOf(listed), staffId);
  if (shown.length === 0) return null;
  return (
    <nav className="y-open-orders" aria-label="Open orders" data-testid="open-orders">
      <ul className="y-open-orders__list">
        {shown.map((order) => {
          const words = openOrderWords(order);
          const here = order.id === current?.id;
          return (
            <li key={order.id}>
              <button
                type="button"
                className="y-open-orders__chip"
                aria-pressed={here}
                disabled={disabled && !here}
                data-testid={`open-order-${order.id}`}
                onClick={() => (here ? undefined : onPick(order))}
              >
                <span className="y-open-orders__name">{words.name}</span>
                <span className="y-open-orders__meta">
                  {[words.items, words.time, formatMoney(order.totalMinor, currency)].filter(Boolean).join(" · ")}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <Button
        variant="secondary"
        size={56}
        icon={<Plus />}
        disabled={disabled || current === null}
        onClick={onNew}
        data-testid="open-orders-new"
      >
        New
      </Button>
    </nav>
  );
}

/** Sell's bar: the outlet's open orders, kept up to date as orders change. */
export function LiveOpenOrdersBar(props: Omit<Parameters<typeof OpenOrdersBar>[0], "orders">) {
  const active = useActiveOrders();
  return <OpenOrdersBar {...props} orders={active.data ?? []} />;
}
