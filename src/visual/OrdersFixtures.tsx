import { useState, type ReactNode } from "react";
import { sentTimesByOrder } from "../kitchen/kitchenTickets";
import type { POSOrder } from "../lib/posContracts";
import { OrderDetailView, type OrderDetailViewProps } from "../orders/OrderDetail";
import { OrdersView, type OrdersTab, type OrdersViewProps } from "../orders/OrdersView";
import { orderTimeline } from "../orders/ordersWords";
import { OPEN_ORDERS, PAID_ORDERS, PAID_RECEIPT, ROOM_ORDER, STATION_TICKETS, TAKEAWAY_ORDER } from "./ordersData";
import { CURRENCY, ORDER } from "./registerData";
import { FixtureShell } from "./ShellFixtures";

/**
 * Development-only Orders compositions for the pixel harness: the real
 * Orders list and order detail with data in the backend's shapes
 * (ordersData.ts). Nothing here talks to a server.
 */

const nothing = () => undefined;
const SENT_TIMES = sentTimesByOrder(STATION_TICKETS);
const READY = { loading: false, failed: false, onRetry: nothing };

function Orders({
  tab: initialTab = "open",
  query: initialQuery = "",
  children,
  ...props
}: Partial<Omit<OrdersViewProps, "onTab" | "onQuery">> & { children?: ReactNode }) {
  const [tab, setTab] = useState<OrdersTab>(initialTab);
  const [query, setQuery] = useState(initialQuery);
  return (
    <FixtureShell initialPage="orders" workspaceVariant="full">
      <OrdersView
        openOrders={OPEN_ORDERS}
        paidOrders={PAID_ORDERS}
        currency={CURRENCY}
        sentTimes={SENT_TIMES}
        onOpen={nothing}
        onNewSale={nothing}
        openState={READY}
        paidState={READY}
        {...props}
        tab={tab}
        onTab={setTab}
        query={query}
        onQuery={setQuery}
      />
      {children}
    </FixtureShell>
  );
}

/** The open orders: every state an order has before it is paid. */
export function OrdersFixture() {
  return <Orders />;
}

/** This shift's paid orders. */
export function OrdersPaidFixture() {
  return <Orders tab="paid" />;
}

/** Found by room number. */
export function OrdersSearchFixture() {
  return <Orders query="204" />;
}

/** Nothing matches the search. */
export function OrdersNoMatchFixture() {
  return <Orders query="0999" />;
}

/** No open orders: start a new sale. */
export function OrdersEmptyFixture() {
  return <Orders openOrders={[]} />;
}

/** The paid orders being asked for. */
export function OrdersLoadingFixture() {
  return <Orders tab="paid" paidOrders={null} paidState={{ loading: true, failed: false, onRetry: nothing }} />;
}

/** The open orders couldn't be loaded. */
export function OrdersErrorFixture() {
  return <Orders openOrders={[]} openState={{ loading: false, failed: true, onRetry: nothing }} />;
}

function Detail({ order, tab = "open", ...props }: { order: POSOrder; tab?: OrdersTab } & Partial<OrderDetailViewProps>) {
  const receipt = order.status === "CLOSED" ? PAID_RECEIPT : undefined;
  return (
    <Orders tab={tab}>
      <OrderDetailView
        order={order}
        currency={CURRENCY}
        timeline={orderTimeline({ order, tickets: STATION_TICKETS.filter((ticket) => ticket.orderId === order.id), currency: CURRENCY })}
        receipt={receipt}
        canSend
        canPay
        pending={null}
        problem={null}
        result={null}
        selectedLineId={null}
        onSelectLine={nothing}
        onSend={nothing}
        onPay={nothing}
        onVoid={nothing}
        onRemoveLine={nothing}
        onReprint={nothing}
        onClose={nothing}
        {...props}
      />
    </Orders>
  );
}

/** An open order, one line chosen: Remove, Send to kitchen, Pay, Void. */
export function OrderOpenFixture() {
  return <Detail order={ORDER} selectedLineId={ORDER.items[1].id} />;
}

/** An order in the kitchen: sent at, where each station is now; Pay and Void. */
export function OrderKitchenFixture() {
  return <Detail order={ROOM_ORDER} />;
}

/** Part paid: what is left to pay, and Void closed with why. */
export function OrderPartPaidFixture() {
  return <Detail order={TAKEAWAY_ORDER} />;
}

/** Paid: how and by whom, and a copy of the receipt just sent to the printer. */
export function OrderPaidFixture() {
  return <Detail order={PAID_ORDERS[0]} tab="paid" result="A copy of the receipt was sent to the printer." />;
}

/** A waiter who can neither send nor take payment. */
export function OrderLimitedFixture() {
  return <Detail order={ORDER} canSend={false} canPay={false} />;
}

/** Sending was refused. */
export function OrderProblemFixture() {
  return <Detail order={ORDER} problem="This order changed on another till. It's been reloaded: check it, then send it again." />;
}
