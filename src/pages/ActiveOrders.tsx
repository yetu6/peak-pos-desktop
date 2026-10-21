import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DiscountDialog } from "../components/DiscountDialog";
import { ReceiptView } from "../components/ReceiptView";
import { VoidOrderDialog } from "../components/VoidOrderDialog";
import {
  useActiveOrders,
  useCatalogCurrency,
  useHasPermission,
  useOrder,
  usePosShift,
  useStationTickets,
} from "../hooks/usePosData";
import { sentTimesByOrder } from "../kitchen/kitchenTickets";
import type { POSOrder } from "../lib/posContracts";
import { OrderDetail } from "../orders/OrderDetail";
import { RefundItemsSheet } from "../orders/RefundItemsSheet";
import { OrdersView, type OrdersTab } from "../orders/OrdersView";
import { ORDERS_REFRESH_SECONDS } from "../orders/ordersSettings";
import { usePaidOrders } from "../orders/usePaidOrders";
import { PaymentDone } from "../register/PaymentDone";
import { PaySheet, type PaidInfo } from "../register/PaySheet";
import { formatMoney } from "../lib/money";
import { orderName } from "../lib/orderNumber";
import { voidedWords } from "../orders/ordersWords";

/** What is open over the list: an order, its Pay, Void, Discount or Refund sheet, payment done, or a receipt. */
type Overlay =
  | { kind: "detail"; orderId: string }
  | { kind: "pay"; orderId: string }
  | { kind: "discount"; orderId: string }
  | { kind: "void"; orderId: string }
  | { kind: "refund"; orderId: string }
  | { kind: "done"; paid: PaidInfo }
  | { kind: "receipt"; orderId: string }
  | null;

/**
 * Orders against the live API: the open orders (GET /pos/orders?view=open,
 * kept fresh by live updates) and today's paid ones at this outlet
 * (view=paid for the shift's business day, asked for only when that tab is
 * opened, a page at a time). An order opens in its detail; Pay is Sell's Pay sheet,
 * Void and Discount are the supervisor's, Add items carries on with it on Sell
 * (F-236), and a paid order prints a copy of its receipt.
 */
export function ActiveOrders({
  onNewOrder,
  onAddItems,
}: { onNewOrder?: () => void; onAddItems?: (order: POSOrder) => void } = {}) {
  const orders = useActiveOrders();
  const { shift } = usePosShift();
  const currency = useCatalogCurrency();
  const tickets = useStationTickets(true);
  const canSend = useHasPermission("pos.order.send");
  const canPay = useHasPermission("pos.payment.record");
  const [tab, setTab] = useState<OrdersTab>("open");
  const [query, setQuery] = useState("");
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // A late word (a slip that didn't print) follows the void it belongs to,
  // never replaces it -- and never attaches to something said since.
  const voidNotice = useRef<string | null>(null);
  const sayVoided = useCallback((words: string) => {
    voidNotice.current = words;
    setNotice(words);
  }, []);
  const addNotice = useCallback(
    (words: string) => setNotice((now) => (now !== null && now === voidNotice.current ? `${now} ${words}` : words)),
    [],
  );
  const paid = usePaidOrders(shift ?? undefined, tab === "paid", query.trim().length > 0);
  const voided = useRef(false);
  const refunded = useRef(false);
  // The order whose row gets focus back once nothing is open over the list.
  const returnFocusTo = useRef<string | null>(null);

  // Yetu's active list already leaves out paid and voided orders.
  const open = useMemo(() => orders.data ?? [], [orders.data]);
  const sentTimes = useMemo(() => sentTimesByOrder(tickets.data ?? []), [tickets.data]);

  // Live news keeps both lists current (a station ticket's news reloads the
  // open orders too: useActiveOrders). Besides it, ask again every so often,
  // so news missed while the connection was down still shows.
  const { refetch: refetchTickets } = tickets;
  const { refetch: refetchOrders } = orders;
  useEffect(() => {
    const id = window.setInterval(() => {
      void refetchTickets();
      void refetchOrders();
    }, ORDERS_REFRESH_SECONDS * 1000);
    return () => window.clearInterval(id);
  }, [refetchTickets, refetchOrders]);

  const overlayOrderId = overlay && overlay.kind !== "done" ? overlay.orderId : undefined;
  // The order as Yetu has it now: from the lists, or asked for on its own when it has left them.
  const listed = overlayOrderId
    ? (open.find((order) => order.id === overlayOrderId) ?? paid.orders?.find((order) => order.id === overlayOrderId))
    : undefined;
  const fetched = useOrder(overlayOrderId && !listed ? overlayOrderId : undefined);
  // While it is being asked for, the sheet keeps the order as it last was, so it never closes under the person.
  const lastSeen = useRef<POSOrder | null>(null);
  const known = listed ?? fetched.data ?? (lastSeen.current?.id === overlayOrderId ? lastSeen.current : null);
  lastSeen.current = known;
  const current: POSOrder | undefined = known ?? undefined;

  useEffect(() => {
    if (overlay !== null || returnFocusTo.current === null) return;
    const orderId = returnFocusTo.current;
    returnFocusTo.current = null;
    // After the sheet has handed focus back, the order's row (or, if it has left the list, the open tab) takes it.
    const timer = window.setTimeout(() => {
      const row = document.querySelector<HTMLElement>(`[data-testid="order-row-${orderId}"]`);
      (row ?? document.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]'))?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [overlay]);

  /** Ask Yetu again for the open orders (and the open order, if it has left the list). */
  function reloadOrders() {
    void orders.refetch();
    if (fetched.data) void fetched.refetch();
  }

  function close() {
    if (overlayOrderId) returnFocusTo.current = overlayOrderId;
    setOverlay(null);
  }

  function openOrder(order: POSOrder) {
    setNotice(null);
    setOverlay({ kind: "detail", orderId: order.id });
  }

  function afterPaid(info: PaidInfo) {
    returnFocusTo.current = info.order.id;
    setOverlay({ kind: "done", paid: info });
    // Nothing prints after payment (2026-10-20): the EFD gives the tax receipt, the bill came before.
    // The drawer opened as the cash was taken (Pay); one that didn't is said here.
  }

  return (
    <>
      <OrdersView
        tab={tab}
        onTab={setTab}
        openOrders={open}
        paidOrders={paid.orders}
        paidPaging={{ hasMore: paid.hasMore, loadingMore: paid.loadingMore, searchedAll: paid.searchedAll, reading: paid.reading, onMore: paid.loadMore }}
        query={query}
        onQuery={setQuery}
        currency={currency}
        sentTimes={sentTimes}
        onOpen={openOrder}
        onNewSale={onNewOrder}
        openState={{ loading: orders.isLoading, failed: orders.isError, onRetry: () => void orders.refetch() }}
        paidState={{ loading: paid.isLoading, failed: paid.isError, onRetry: paid.refetch }}
        notice={notice}
      />

      {overlay?.kind === "detail" && current ? (
        <OrderDetail
          order={current}
          currency={currency}
          canSend={canSend}
          canPay={canPay}
          onPay={() => setOverlay({ kind: "pay", orderId: current.id })}
          onVoid={() => {
            voided.current = false;
            setOverlay({ kind: "void", orderId: current.id });
          }}
          onRefund={() => {
            refunded.current = false;
            setOverlay({ kind: "refund", orderId: current.id });
          }}
          onAddItems={onAddItems ? () => onAddItems(current) : undefined}
          onDiscount={currency ? () => setOverlay({ kind: "discount", orderId: current.id }) : undefined}
          onClose={close}
          onReload={reloadOrders}
        />
      ) : null}
      {overlay?.kind === "discount" && current && currency ? (
        <DiscountDialog
          order={current}
          currency={currency}
          onApplied={() => reloadOrders()}
          onClose={() => setOverlay({ kind: "detail", orderId: current.id })}
        />
      ) : null}
      {overlay?.kind === "pay" && current && currency ? (
        <PaySheet
          order={current}
          currency={currency}
          onClose={() => setOverlay({ kind: "detail", orderId: current.id })}
          onPaid={afterPaid}
          onDrawerProblem={setNotice}
        />
      ) : null}
      {overlay?.kind === "void" && current ? (
        <VoidOrderDialog
          order={current}
          currency={currency}
          onVoided={() => {
            voided.current = true;
            sayVoided(voidedWords(current));
          }}
          onClose={() => {
            if (voided.current) close();
            else setOverlay({ kind: "detail", orderId: current.id });
          }}
          onStale={reloadOrders}
          onPrintProblem={addNotice}
        />
      ) : null}
      {overlay?.kind === "refund" && current && currency ? (
        <RefundItemsSheet
          order={current}
          currency={currency}
          onRefunded={(refund) => {
            refunded.current = true;
            setNotice(`${orderName(current)}: ${formatMoney(refund.totalMinor, refund.currency || currency)} refunded.`);
          }}
          // Done after a refund goes back to the list, which says what was given back, so the
          // till is free to move on (F-237); Cancel goes back to the order.
          onClose={() => {
            if (refunded.current) close();
            else setOverlay({ kind: "detail", orderId: current.id });
          }}
        />
      ) : null}
      {overlay?.kind === "done" && currency ? (
        <PaymentDone
          paid={overlay.paid}
          currency={currency}
          returnTo={{ place: "Orders", action: "Back to orders" }}
          onNewSale={() => setOverlay(null)}
          onViewReceipt={() => setOverlay({ kind: "receipt", orderId: overlay.paid.order.id })}
        />
      ) : null}
      {overlay?.kind === "receipt" ? <ReceiptView orderId={overlay.orderId} onClose={close} /> : null}
    </>
  );
}
