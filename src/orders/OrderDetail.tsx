import { ChefHat, Printer, Trash2, Wallet } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Banner, Button, PermissionNotice, Sheet, StatusChip, TicketLine } from "../components/system";
import {
  usePrintAfter,
  usePropertyId,
  useReceipt,
  useRemoveOrderItem,
  useReprintReceipt,
  useSendOrder,
  useStationTickets,
} from "../hooks/usePosData";
import { isComposing } from "../lib/keyboard";
import { formatMoney } from "../lib/money";
import type { POSOrder, POSOrderItem, POSReceipt } from "../lib/posContracts";
import { useHoldIdleLock } from "../lib/useHoldIdleLock";
import { useRequestKey } from "../lib/useRequestKey";
import { orderPlaceWords, orderStatusTone, orderStatusWords, paymentMethodWords, serviceTypeWords, type SettlementMethod } from "../lib/words";
import { REGISTER_KEYS } from "../register/TicketActions";
import { orderTimeline, removeProblem, reprintProblem, sendProblem, type TimelineEntry } from "./ordersWords";

export type DetailPending = "send" | "remove" | "reprint" | null;

export interface OrderDetailViewProps {
  order: POSOrder;
  currency: string | undefined;
  timeline: readonly TimelineEntry[];
  /** A paid order's receipt, once Yetu has sent it. */
  receipt?: POSReceipt;
  /** pos.order.send */
  canSend: boolean;
  /** pos.payment.record: take payment, and print a copy of a receipt. */
  canPay: boolean;
  pending: DetailPending;
  problem: string | null;
  result: string | null;
  selectedLineId: string | null;
  onSelectLine: (lineId: string | null) => void;
  onSend: () => void;
  onPay: () => void;
  onVoid: () => void;
  onRemoveLine: (line: POSOrderItem) => void;
  onReprint: () => void;
  onClose: () => void;
}

function settledWords(method: string): string {
  if (method === "SPLIT") return "Split payment";
  if (method === "ROOM_CHARGE") return "Charged to the room";
  return `Paid by ${paymentMethodWords(method as SettlementMethod)}`;
}

/**
 * One order: its lines, totals, payment and what happened to it, with the
 * actions its state allows. Open: Send to kitchen, Pay, Void. In the
 * kitchen: Pay, Void. Paid: Print receipt (a copy of the one Yetu kept).
 * Void is not offered once part is paid (Yetu refuses it). Pay is the one
 * primary action while anything is owed.
 */
export function OrderDetailView({
  order,
  currency,
  timeline,
  receipt,
  canSend,
  canPay,
  pending,
  problem,
  result,
  selectedLineId,
  onSelectLine,
  onSend,
  onPay,
  onVoid,
  onRemoveLine,
  onReprint,
  onClose,
}: OrderDetailViewProps) {
  const voidReasonId = useId();
  const primaryRef = useRef<HTMLButtonElement>(null);
  const busy = pending !== null;
  const lines = order.items.filter((line) => line.status !== "VOIDED");
  const open = order.status === "OPEN";
  const paid = order.status === "CLOSED";
  const voided = order.status === "VOIDED";
  const owing = !paid && !voided;
  const partPaid = order.paidMinor > 0;
  const sendable = open && lines.some((line) => line.status === "ADDED");
  const payable = owing && lines.length > 0 && order.remainingMinor > 0;
  const doc = receipt?.document;

  // Send (F8) and Pay (F9), as on Sell, while this sheet has the keys.
  const keys = useRef({ sendable, payable, canSend, canPay, busy, onSend, onPay });
  keys.current = { sendable, payable, canSend, canPay, busy, onSend, onPay };
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || isComposing(event)) return;
      const now = keys.current;
      if (now.busy) return;
      if (event.key === REGISTER_KEYS.send && now.canSend && now.sendable) {
        event.preventDefault();
        now.onSend();
      } else if (event.key === REGISTER_KEYS.pay && now.canPay && now.payable) {
        event.preventDefault();
        now.onPay();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const description = [orderPlaceWords(order.serviceType, order.tableLabel), serviceTypeWords(order.serviceType), order.initiatedByName]
    .filter(Boolean)
    .join(" · ");

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
      title={`Order ${order.orderNumber}`}
      description={description}
      bodyLabel={`Order ${order.orderNumber} details`}
      testId="order-detail"
      initialFocus={primaryRef}
      footer={
        <div className="y-detail__actions" data-testid="order-detail-actions">
          {owing ? (
            <>
              <div className="y-detail__row">
                <Button
                  variant="danger"
                  size={56}
                  disabled={busy || partPaid}
                  aria-describedby={partPaid ? voidReasonId : undefined}
                  onClick={onVoid}
                >
                  Void order
                </Button>
                {open ? (
                  canSend ? (
                    <Button
                      size={56}
                      icon={<ChefHat />}
                      keyHint={REGISTER_KEYS.send}
                      data-testid="detail-send"
                      disabled={busy || !sendable}
                      onClick={onSend}
                    >
                      {pending === "send" ? "Sending…" : "Send to kitchen"}
                    </Button>
                  ) : (
                    <PermissionNotice who="staff who take orders" action="send them to the kitchen" next="Ask one to help." />
                  )
                ) : null}
              </div>
              {partPaid ? (
                <p className="y-detail__why" id={voidReasonId}>
                  An order can't be voided once part of it is paid.
                </p>
              ) : null}
              {canPay ? (
                <Button
                  ref={primaryRef}
                  variant="primary"
                  size={64}
                  block
                  icon={<Wallet />}
                  keyHint={REGISTER_KEYS.pay}
                  data-testid="detail-pay"
                  disabled={busy || !payable}
                  onClick={onPay}
                >
                  {payable ? `Pay ${formatMoney(order.remainingMinor, currency)}` : "Pay"}
                </Button>
              ) : (
                <PermissionNotice who="a cashier or manager" action="take payment" next="Ask one to help." />
              )}
            </>
          ) : (
            <div className="y-detail__row">
              <Button variant="quiet" size={56} disabled={busy} onClick={onClose}>
                Close
              </Button>
              {paid ? (
                canPay ? (
                  <Button
                    ref={primaryRef}
                    variant="primary"
                    size={64}
                    icon={<Printer />}
                    data-testid="detail-reprint"
                    disabled={busy || !receipt}
                    onClick={onReprint}
                  >
                    {pending === "reprint" ? "Sending to the printer…" : "Print receipt"}
                  </Button>
                ) : (
                  <PermissionNotice who="a cashier or manager" action="print a copy of the receipt" next="Ask one to help." />
                )
              ) : null}
            </div>
          )}
        </div>
      }
    >
      <div className="y-detail">
        <div className="y-detail__state">
          <StatusChip tone={orderStatusTone(order.status)} data-testid="order-detail-status">
            {orderStatusWords(order.status)}
          </StatusChip>
          <p className="y-detail__result" role="status" data-testid="order-detail-result">
            {result ?? ""}
          </p>
        </div>
        {problem ? (
          <Banner inline tone="danger" data-testid="order-detail-error">
            {problem}
          </Banner>
        ) : null}

        <section className="y-detail__section" aria-labelledby="detail-timeline">
          <h3 id="detail-timeline" className="y-detail__heading">
            What happened
          </h3>
          <ol className="y-detail__timeline" data-testid="order-detail-timeline">
            {timeline.map((entry, index) => (
              <li key={index} className="y-detail__event">
                <span className="y-detail__time">{entry.time ?? ""}</span>
                <span>{entry.words}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="y-detail__section" aria-labelledby="detail-lines">
          <h3 id="detail-lines" className="y-detail__heading">
            Items
          </h3>
          <ul className="y-ticket__list" data-testid="order-detail-lines">
            {lines.map((line) => {
              const removable = open && line.status === "ADDED";
              const selected = removable && selectedLineId === line.id;
              return (
                <li key={line.id}>
                  <TicketLine
                    quantity={line.quantity}
                    name={line.name}
                    options={(line.modifiers ?? []).map((modifier) => modifier.optionName)}
                    amount={formatMoney(line.totalMinor, currency)}
                    sent={line.status === "SENT"}
                    selected={selected}
                    onSelect={removable && !busy ? () => onSelectLine(selected ? null : line.id) : undefined}
                  />
                  {selected ? (
                    <div className="y-ticket__line-actions">
                      <Button
                        variant="danger"
                        icon={<Trash2 />}
                        aria-label={`Remove ${line.name}`}
                        disabled={busy}
                        onClick={() => onRemoveLine(line)}
                      >
                        {pending === "remove" ? "Removing…" : "Remove"}
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>

        <dl className="y-ticket__totals" data-testid="order-detail-totals">
          <div>
            <dt>Subtotal</dt>
            <dd>{formatMoney(order.subtotalMinor, currency)}</dd>
          </div>
          {order.discountMinor > 0 ? (
            <div>
              <dt>Discount{order.discountReason ? ` · ${order.discountReason}` : ""}</dt>
              <dd>{formatMoney(-order.discountMinor, currency)}</dd>
            </div>
          ) : null}
          <div>
            <dt>VAT</dt>
            <dd>{formatMoney(order.taxMinor, currency)}</dd>
          </div>
          <div className="y-ticket__total">
            <dt>Total</dt>
            <dd>{formatMoney(order.totalMinor, currency)}</dd>
          </div>
        </dl>

        {paid || partPaid ? (
          <section className="y-detail__section" aria-labelledby="detail-payment" data-testid="order-detail-payment">
            <h3 id="detail-payment" className="y-detail__heading">
              Payment
            </h3>
            {paid ? (
              doc ? (
                <>
                  <p className="y-detail__line">
                    {[settledWords(doc.tenderMethod), doc.operatorName ? `Payment taken by ${doc.operatorName}` : ""].filter(Boolean).join(" · ")}
                  </p>
                  {receipt && receipt.reprintCount > 0 ? (
                    <p className="y-detail__line y-detail__muted">
                      Printed again {receipt.reprintCount} {receipt.reprintCount === 1 ? "time" : "times"}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="y-detail__line y-detail__muted">Getting the receipt…</p>
              )
            ) : (
              <p className="y-detail__line">
                Paid {formatMoney(order.paidMinor, currency)} of {formatMoney(order.totalMinor, currency)} ·{" "}
                {formatMoney(order.remainingMinor, currency)} still to pay
              </p>
            )}
          </section>
        ) : null}
      </div>
    </Sheet>
  );
}

/**
 * An order's detail against the live API: send it, remove a line not yet
 * sent, or print a copy of a paid order's receipt here; Pay and Void open
 * their own sheets (the parent's).
 */
export function OrderDetail({
  order,
  currency,
  canSend,
  canPay,
  onPay,
  onVoid,
  onClose,
}: {
  order: POSOrder;
  currency: string | undefined;
  canSend: boolean;
  canPay: boolean;
  onPay: () => void;
  onVoid: () => void;
  onClose: () => void;
}) {
  const propertyId = usePropertyId();
  const printAfter = usePrintAfter(propertyId);
  const tickets = useStationTickets(true);
  const receipt = useReceipt(order.status === "CLOSED" ? order.id : undefined);
  const sendOrder = useSendOrder();
  const removeItem = useRemoveOrderItem();
  const reprint = useReprintReceipt();
  const sendKey = useRequestKey();
  const removeKey = useRequestKey();
  const reprintKey = useRequestKey();
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const focusAfter = useRef(false);

  const pending: DetailPending = sendOrder.isPending ? "send" : removeItem.isPending ? "remove" : reprint.isPending ? "reprint" : null;
  // The till doesn't lock itself while a request is with Yetu.
  useHoldIdleLock(pending !== null);

  // After a send or a remove the pressed button is gone: focus goes to the sheet's main action.
  useEffect(() => {
    if (!focusAfter.current || pending !== null) return;
    focusAfter.current = false;
    const sheet = document.querySelector('[data-testid="order-detail"]');
    const target =
      sheet?.querySelector<HTMLButtonElement>('[data-testid="detail-pay"]:not(:disabled)') ??
      sheet?.querySelector<HTMLButtonElement>(".y-detail__actions button:not(:disabled)");
    target?.focus();
  });

  function begin() {
    setProblem(null);
    setResult(null);
  }

  function send() {
    if (pending !== null) return;
    begin();
    sendOrder.mutate(
      { orderId: order.id, version: order.version, idempotencyKey: sendKey([order.id, order.version].join("|")) },
      {
        onSuccess: (updated) => {
          focusAfter.current = true;
          setResult("Sent to the kitchen.");
          // The kitchen tickets Yetu made, printed as before.
          void printAfter(updated.id);
        },
        onError: (error) => setProblem(sendProblem(error)?.words ?? "The order wasn't sent. Try again."),
      },
    );
  }

  function remove(line: POSOrderItem) {
    if (pending !== null) return;
    begin();
    removeItem.mutate(
      {
        orderId: order.id,
        itemId: line.id,
        version: order.version,
        idempotencyKey: removeKey([order.id, line.id, order.version].join("|")),
      },
      {
        onSuccess: () => {
          focusAfter.current = true;
          setSelectedLineId(null);
          setResult(`${line.name} removed.`);
        },
        onError: (error) => setProblem(removeProblem(error)?.words ?? "The item wasn't removed. Try again."),
      },
    );
  }

  function printCopy() {
    if (pending !== null || !receipt.data) return;
    begin();
    reprint.mutate(
      { orderId: order.id, idempotencyKey: reprintKey([order.id, receipt.data.reprintCount].join("|")) },
      {
        onSuccess: () => setResult("A copy of the receipt was sent to the printer."),
        onError: (error) => setProblem(reprintProblem(error)?.words ?? "The copy wasn't printed. Try again."),
      },
    );
  }

  return (
    <OrderDetailView
      order={order}
      currency={currency}
      timeline={orderTimeline({
        order,
        tickets: (tickets.data ?? []).filter((ticket) => ticket.orderId === order.id && ticket.status !== "SERVED"),
        receipt: receipt.data,
      })}
      receipt={receipt.data}
      canSend={canSend}
      canPay={canPay}
      pending={pending}
      problem={problem}
      result={result}
      selectedLineId={selectedLineId}
      onSelectLine={setSelectedLineId}
      onSend={send}
      onPay={onPay}
      onVoid={onVoid}
      onRemoveLine={remove}
      onReprint={printCopy}
      onClose={onClose}
    />
  );
}
