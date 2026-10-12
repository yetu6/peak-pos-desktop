import { Plus, ReceiptText, SearchX } from "lucide-react";
import type { KeyboardEvent } from "react";
import { Banner, Button, EmptyState, Money, SearchField, Skeleton, StatusChip, Tabs } from "../components/system";
import { formatMoney } from "../lib/money";
import type { POSOrder } from "../lib/posContracts";
import { clockTime, orderPlaceWords, orderStatusTone, orderStatusWords, serviceTypeWords } from "../lib/words";
import { orderMatches } from "./ordersWords";

export type OrdersTab = "open" | "paid";

interface ListState {
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
}

export interface OrdersViewProps {
  tab: OrdersTab;
  onTab: (tab: OrdersTab) => void;
  /** Orders not yet paid or voided, as Yetu lists them. */
  openOrders: readonly POSOrder[];
  /** This shift's paid orders, latest first; null until they have been asked for. */
  paidOrders: readonly POSOrder[] | null;
  query: string;
  onQuery: (query: string) => void;
  currency: string | undefined;
  /** When each order was sent, from Yetu's station tickets. */
  sentTimes: ReadonlyMap<string, string>;
  onOpen: (order: POSOrder) => void;
  onNewSale?: () => void;
  openState: ListState;
  paidState: ListState;
  /** What just happened to an order, in words. */
  notice?: string | null;
}

const ROW_SELECTOR = "[data-order-row]";

function placeWords(order: POSOrder): string {
  return orderPlaceWords(order.serviceType, order.tableLabel) || serviceTypeWords(order.serviceType);
}

function matchWords(count: number): string {
  return `${count} ${count === 1 ? "order matches" : "orders match"}`;
}

/** Up and down move between rows; Home and End go to the first and last. Never into the search. */
function moveBetweenRows(event: KeyboardEvent<HTMLElement>) {
  const rows = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>(ROW_SELECTOR));
  const index = rows.indexOf(event.target as HTMLButtonElement);
  const moves: Record<string, number> = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: rows.length - 1 };
  const next = moves[event.key];
  if (next === undefined) return;
  event.preventDefault();
  rows[Math.max(0, Math.min(rows.length - 1, next))]?.focus();
}

/**
 * Orders: the open ones and this shift's paid ones, found by number, table,
 * room or amount. Each row shows the number, where it goes, who took it,
 * when it was sent (when Yetu has the time), its status in words and its
 * total; a press opens the order.
 */
export function OrdersView({
  tab,
  onTab,
  openOrders,
  paidOrders,
  query,
  onQuery,
  currency,
  sentTimes,
  onOpen,
  onNewSale,
  openState,
  paidState,
  notice = null,
}: OrdersViewProps) {
  const list = tab === "open" ? openOrders : (paidOrders ?? []);
  const state = tab === "open" ? openState : paidState;
  const shown = list.filter((order) => orderMatches(order, query));
  const searching = query.trim().length > 0;
  const status = [notice, searching && !state.loading ? matchWords(shown.length) : null].filter(Boolean).join(" ");

  function focusFirstRow(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "ArrowDown") return;
    const first = document.querySelector<HTMLButtonElement>(ROW_SELECTOR);
    if (!first) return;
    event.preventDefault();
    first.focus();
  }

  return (
    <div className="y-orders" data-testid="orders-page">
      <header className="y-orders__head">
        <h1 className="y-orders__title">Orders</h1>
        <Tabs
          label="Order lists"
          value={tab}
          onChange={onTab}
          tabs={[
            { value: "open", label: "Open", count: openState.loading ? undefined : openOrders.length },
            { value: "paid", label: "Paid this shift", count: paidOrders === null ? undefined : paidOrders.length },
          ]}
        />
        <SearchField
          label="Find an order"
          placeholder="Number, table, room or amount"
          value={query}
          onChange={onQuery}
          className="y-orders__search"
          inputProps={{ onKeyDown: focusFirstRow, "data-testid": "orders-search" } as Record<string, unknown>}
        />
      </header>
      <p className="y-orders__status" role="status" data-testid="orders-status">
        {status}
      </p>

      <div className="y-orders__list" aria-label={tab === "open" ? "Open orders" : "Paid this shift"} role="region">
        {state.failed ? (
          <Banner
            inline
            tone="danger"
            data-testid="orders-load-error"
            action={
              <Button size={48} onClick={state.onRetry}>
                Try again
              </Button>
            }
          >
            The orders couldn't be loaded. Check the connection, then try again.
          </Banner>
        ) : null}
        {state.loading ? (
          <div className="y-orders__loading" aria-label="Loading the orders" role="group">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} height={72} radius="card" />
            ))}
          </div>
        ) : list.length === 0 ? (
          state.failed ? null : tab === "open" ? (
            <EmptyState
              icon={<ReceiptText />}
              title="No open orders"
              description="Orders appear here once they're started on Sell."
              action={
                onNewSale ? (
                  <Button variant="primary" size={56} icon={<Plus />} onClick={onNewSale}>
                    New sale
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <EmptyState icon={<ReceiptText />} title="No paid orders on this shift yet" description="Orders appear here once they're paid." />
          )
        ) : shown.length === 0 ? (
          <EmptyState
            icon={<SearchX />}
            title={`No order matches “${query.trim()}”`}
            description="Check the number, table, room or amount."
            action={<Button onClick={() => onQuery("")}>Show all orders</Button>}
          />
        ) : (
          <ul className="y-orders__rows" onKeyDown={moveBetweenRows}>
            {shown.map((order) => (
              <li key={order.id}>
                <OrderRow order={order} currency={currency} sentAt={sentTimes.get(order.id)} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function OrderRow({
  order,
  currency,
  sentAt,
  onOpen,
}: {
  order: POSOrder;
  currency: string | undefined;
  sentAt?: string;
  onOpen: (order: POSOrder) => void;
}) {
  const sent = sentAt ? clockTime(sentAt) : "";
  const partPaid = order.paidMinor > 0 && order.remainingMinor > 0;
  const meta = [order.initiatedByName, sent ? `Sent ${sent}` : "", partPaid ? `${formatMoney(order.remainingMinor, currency)} still to pay` : ""]
    .filter(Boolean)
    .join(" · ");
  return (
    <button
      type="button"
      className="y-orow"
      data-order-row=""
      data-testid={`order-row-${order.id}`}
      aria-haspopup="dialog"
      onClick={() => onOpen(order)}
    >
      <span className="y-orow__number">{order.orderNumber}</span>
      <span className="y-orow__main">
        <span className="y-orow__place">{placeWords(order)}</span>
        {meta ? <span className="y-orow__meta">{meta}</span> : null}
      </span>
      <StatusChip tone={orderStatusTone(order.status)} className="y-orow__status">
        {orderStatusWords(order.status)}
      </StatusChip>
      <Money minor={order.totalMinor} currency={currency} size="lead" className="y-orow__total" />
    </button>
  );
}
