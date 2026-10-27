import { List, Plus } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { Button, Sheet } from "../components/system";
import { useActiveOrders, useOwnOrdersOnly } from "../hooks/usePosData";
import { formatMoney } from "../lib/money";
import type { POSOrder } from "../lib/posContracts";
import { BACK_WORDS } from "../lib/words";
import { barOrder, openOrderItemsWords, openOrderWords, openOrdersOf } from "./openOrders";

/** Named setting: a chip's width in rem, wide enough for "Mama Neema · TSh 128,500". */
export const OPEN_ORDER_CHIP_REM = 12;
const CHIP_GAP_PX = 8;

/**
 * The open orders on this till's outlet, across the top of Sell (owner,
 * 2026-10-21: a waiter serving three customers works on three orders). Each
 * chip reads as the waiter knows the order -- its table or name, else its
 * number -- with what it comes to, when it started and what is on it. Only
 * whole chips are drawn, as many as fit, the order on the ticket always among
 * them; All lists every open order in full. One tap moves the ticket to
 * another order; New starts one. Nothing open, no bar.
 */
export function OpenOrdersBar({
  orders,
  current,
  staffId,
  currency,
  disabled = false,
  ownOnly = false,
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
  /** A waiter: the bar holds only the orders they took, and says so. */
  ownOnly?: boolean;
  onPick: (order: POSOrder) => void;
  onNew: () => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const [fit, setFit] = useState<number | null>(null);
  const [all, setAll] = useState(false);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      setFit(Math.max(1, Math.floor((list.clientWidth + CHIP_GAP_PX) / (OPEN_ORDER_CHIP_REM * rem + CHIP_GAP_PX))));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    measure();
    return () => observer.disconnect();
  }, []);
  const listed = current && !orders.some((order) => order.id === current.id) ? [...orders, current] : orders;
  const shown = barOrder(openOrdersOf(listed), staffId);
  if (shown.length === 0) return null;
  const chips = fit === null || shown.length <= fit ? shown : visibleChips(shown, current, fit);
  const pick = (order: POSOrder) => {
    setAll(false);
    if (order.id !== current?.id) onPick(order);
  };
  return (
    <nav className="y-open-orders" aria-label={ownOnly ? "Your open orders" : "Open orders"} data-testid="open-orders">
      <ul className="y-open-orders__list" ref={listRef}>
        {chips.map((order) => {
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
                onClick={() => pick(order)}
              >
                <span className="y-open-orders__top">
                  <span className="y-open-orders__name">{words.name}</span>
                  <span className="y-open-orders__amount">{formatMoney(order.totalMinor, currency)}</span>
                </span>
                <span className="y-open-orders__meta">{[words.time, words.items].filter(Boolean).join(" · ")}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <Button
        variant="secondary"
        size={56}
        icon={<List />}
        aria-label={ownOnly ? `Your ${shown.length} open orders` : `All ${shown.length} open orders`}
        onClick={() => setAll(true)}
        data-testid="open-orders-all"
      >
        {`${ownOnly ? "Yours" : "All"} ${shown.length}`}
      </Button>
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
      {all ? (
        <Sheet
          open
          onOpenChange={(open) => {
            if (!open) setAll(false);
          }}
          title={ownOnly ? "Your open orders" : "Open orders"}
          footer={
            <div className="y-options__footer">
              <span />
              <Button variant="quiet" onClick={() => setAll(false)}>
                {BACK_WORDS}
              </Button>
            </div>
          }
        >
          <ul className="y-open-orders__all">
            {shown.map((order) => {
              const words = openOrderWords(order);
              const here = order.id === current?.id;
              return (
                <li key={order.id}>
                  <button
                    type="button"
                    className="y-open-orders__row"
                    aria-current={here ? "true" : undefined}
                    disabled={disabled && !here}
                    data-testid={`open-order-row-${order.id}`}
                    onClick={() => pick(order)}
                  >
                    <span className="y-open-orders__top">
                      <span className="y-open-orders__name">
                        {words.name}
                        {here ? <span className="y-open-orders__here">On the ticket</span> : null}
                      </span>
                      <span className="y-open-orders__amount">{formatMoney(order.totalMinor, currency)}</span>
                    </span>
                    <span className="y-open-orders__meta">
                      {[words.time, order.initiatedByName ? `Taken by ${order.initiatedByName}` : ""].filter(Boolean).join(" · ")}
                    </span>
                    <span className="y-open-orders__items">{openOrderItemsWords(order)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Sheet>
      ) : null}
    </nav>
  );
}

/** The first chips that fit, with the order on the ticket kept among them. */
export function visibleChips(shown: readonly POSOrder[], current: POSOrder | null, fit: number): POSOrder[] {
  const first = shown.slice(0, fit);
  if (!current || first.some((order) => order.id === current.id)) return first;
  const here = shown.find((order) => order.id === current.id);
  return here ? [...first.slice(0, fit - 1), here] : first;
}

/** Sell's bar: the outlet's open orders, kept up to date as orders change. */
export function LiveOpenOrdersBar(props: Omit<Parameters<typeof OpenOrdersBar>[0], "orders">) {
  const active = useActiveOrders();
  const ownOnly = useOwnOrdersOnly();
  return <OpenOrdersBar {...props} ownOnly={ownOnly} orders={active.data ?? []} />;
}
