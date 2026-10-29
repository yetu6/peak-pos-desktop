import { BACK_WORDS } from "../lib/words";
import { BadgePercent, Plus, Printer, ReceiptText, Trash2, Undo2, Wallet } from "lucide-react";
import { lineAmountMinor, vatFigures } from "../lib/vatWords";
import { directOnlyUnsent, linesByRound, printWords, takesMore } from "../register/rounds";
import { orderStatusIcon } from "./orderStatusIcon";
import { useEffect, useId, useRef, useState } from "react";
import { Button, PermissionNotice, RefusalNotice, Sheet, StatusChip, Stepper, TicketLine, type Refusal } from "../components/system";
import { PaperPreviewSheet } from "../register/PaperPreviewSheet";
import {
  useOrderRefunds,
  usePosShift,
  usePrintAfter,
  usePropertyId,
  useReceipt,
  useRemoveOrderItem,
  useSetLineQuantity,
  useReprintKitchenTickets,
  useTakeOverTab,
  usePrintBill,
  useReprintReceipt,
  useSendOrder,
  useStationTickets,
  useHasPermission,
} from "../hooks/usePosData";
import { isComposing } from "../lib/keyboard";
import { formatMoney } from "../lib/money";
import type { POSOrder, POSOrderItem, POSOrderPayment, POSOrderRefunds, POSReceipt } from "../lib/posContracts";
import { MAX_LINE_QUANTITY } from "../lib/posContracts";
import { useHoldIdleLock } from "../lib/useHoldIdleLock";
import { useRequestKey } from "../lib/useRequestKey";
import { clockTime, orderPlaceWords, orderStatusTone, orderStatusWords, paymentMethodWords, serviceTypeWords } from "../lib/words";
import { REGISTER_KEYS } from "../register/TicketActions";
import {
  EMPTIED_WORDS,
  emptiedOrder,
  billProblem,
  kitchenReprintProblem,
  kitchenReprintWords,
  orderTimeline,
  removeProblem,
  quantityProblem,
  reprintProblem,
  sendProblem,
  takeOverProblem,
  type TimelineEntry,
} from "./ordersWords";
import { orderName, orderReference } from "../lib/orderNumber";
import { refundAvailability, refundGivenWords } from "./refundWords";
import { billNotPrintedWords, copyNotPrintedWords, printProblemOnce } from "../print/printProblems";
import { DIRECT_ORDER_SENT_WORDS, ORDER_SENT_WORDS, DISCOUNT_HELD_WORDS } from "../register/registerWords";

export type DetailPending = "send" | "remove" | "quantity" | "reprint" | "kitchen" | "take-over" | "bill" | null;

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
  /** Why Yetu refused the last action: a 403 shows as a permission notice. */
  problem: Refusal | string | null;
  result: string | null;
  selectedLineId: string | null;
  onSelectLine: (lineId: string | null) => void;
  onSend: () => void;
  onPay: () => void;
  onVoid: () => void;
  onRemoveLine: (line: POSOrderItem) => void;
  /** How many of a line not yet sent (round 2 on): Yetu keeps its price. */
  onQuantity: (line: POSOrderItem, quantity: number) => void;
  onReprint: () => void;
  /** The bill before payment (fbc-peak #288); absent for staff who can't send an order. */
  onPrintBill?: () => void;
  /** S8a: print the latest round's kitchen ticket again, marked COPY; absent when nothing has gone to the kitchen or this person can't send orders. */
  onKitchenReprint?: () => void;
  /** S17b: take a tab handed over to the next shift onto this till's shift. */
  onTakeOver?: () => void;
  /** F-236: carry on with the order on Sell (the next round, or more before it is sent). */
  onAddItems?: () => void;
  /** F-236: a discount, with a supervisor, as on Sell's More. */
  onDiscount?: () => void;
  onClose: () => void;
  /** A paid order's refunds and what is left to refund (S7); absent until Yetu has sent them. */
  refunds?: POSOrderRefunds;
  /** Whether this till offers Refund items now, and if not, why (refundAvailability). */
  refundOffer?: { offer: boolean; why: string | null };
  /** Opens Refund items (the parent's sheet). */
  onRefund?: () => void;
}

/** The order has had a round (or, before rounds, left the Open state): it has a kitchen ticket. */
function sentToKitchen(order: POSOrder): boolean {
  return (order.roundsSent ?? 0) > 0 || order.status !== "OPEN";
}

/** S17b: a tab waiting for a shift, as staff read it. */
function waitingWords(handedOverAt: string | undefined): string {
  const when = handedOverAt ? clockTime(handedOverAt) : "";
  return `${when ? `Handed over to the next shift at ${when}.` : "Handed over to the next shift."} Take it over on this till to add to it, send it or take payment.`;
}

/** Who took a payment and when, saying only what Yetu gave. */
function takenWords(payment: POSOrderPayment): string {
  const who = payment.recordedByName.trim();
  const when = clockTime(payment.createdAt);
  if (who && when) return `Taken by ${who} at ${when}`;
  if (who) return `Taken by ${who}`;
  return when ? `Taken at ${when}` : "";
}

/**
 * One order: its lines, totals, payment and what happened to it, with the
 * actions its state allows. Open: Print for the kitchen (the words and the key F8 of Sell's
 * button: new items, else the last papers again), Pay, Cancel. In the
 * kitchen: Pay, Cancel. Paid: Print bill again (a copy of the one Yetu kept).
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
  onQuantity,
  onReprint,
  onPrintBill,
  onKitchenReprint,
  onTakeOver,
  onAddItems,
  onDiscount,
  onClose,
  refunds,
  refundOffer,
  onRefund,
}: OrderDetailViewProps) {
  const voidReasonId = useId();
  const refundReasonId = useId();
  const primaryRef = useRef<HTMLButtonElement>(null);
  const busy = pending !== null;
  const lines = order.items.filter((line) => line.status !== "VOIDED");
  const paid = order.status === "CLOSED";
  const voided = order.status === "VOIDED";
  const owing = !paid && !voided;
  const partPaid = order.paidMinor > 0;
  // Rounds (S17a): an order takes more until it is paid, so what isn't sent can be sent.
  const takesLines = takesMore(order);
  const sendable = takesLines && lines.some((line) => line.status === "ADDED");
  // With nothing new, the same button prints the last papers again, as Sell's does.
  const reprintable = !sendable && Boolean(onKitchenReprint) && sentToKitchen(order);
  const payable = owing && lines.length > 0 && order.remainingMinor > 0;
  // Pay sends what isn't sent first (as Sell does): the kitchen hears of everything paid for.
  const sendsOnPay = canSend && sendable;
  const reference = orderReference(order);
  const payments = order.payments ?? [];
  const refunded = paid && refunds !== undefined && refunds.refundedMinor > 0;
  const refundedInFull = refunded && refunds.remainingMinor <= 0;
  // The figures as the guest reads them: with VAT inside the prices, the menu prices (F-229).
  const figures = vatFigures(order);

  // Send (F8) and Pay (F9), as on Sell, while this sheet has the keys.
  const keys = useRef({ sendable, reprintable, payable, canSend, canPay, busy, onSend, onKitchenReprint, onPay });
  keys.current = { sendable, reprintable, payable, canSend, canPay, busy, onSend, onKitchenReprint, onPay };
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || isComposing(event)) return;
      const now = keys.current;
      if (now.busy) return;
      if (event.key === REGISTER_KEYS.send && now.canSend && (now.sendable || now.reprintable)) {
        event.preventDefault();
        if (now.sendable) now.onSend();
        else now.onKitchenReprint?.();
      } else if (event.key === REGISTER_KEYS.pay && now.canPay && now.payable) {
        event.preventDefault();
        now.onPay();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const description = [orderPlaceWords(order.serviceType, order.tableLabel, order.askForTable), serviceTypeWords(order.serviceType), order.initiatedByName]
    .filter(Boolean)
    .join(" · ");

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
      title={orderName(order)}
      description={description}
      bodyLabel={`${orderName(order)} details`}
      testId="order-detail"
      initialFocus={primaryRef}
      footer={
        <div className="y-detail__actions" data-testid="order-detail-actions">
          {owing && order.waitingForShift ? (
            // S17b: a tab handed over waits for a shift; nothing else is done to it until one takes it.
            <div className="y-detail__waiting" data-testid="detail-waiting">
              <p className="y-detail__why">
                {waitingWords(order.handedOverAt)}
              </p>
              {onTakeOver ? (
                <Button
                  ref={primaryRef}
                  variant="primary"
                  size={64}
                  block
                  data-testid="detail-take-over"
                  disabled={busy}
                  onClick={onTakeOver}
                >
                  {pending === "take-over" ? "Taking it over…" : "Take over this tab"}
                </Button>
              ) : (
                <PermissionNotice who="staff who take orders" action="take a tab over" next="Ask one to help." />
              )}
            </div>
          ) : owing ? (
            <>
              <div className="y-detail__row">
                <Button
                  variant="danger"
                  size={56}
                  disabled={busy || partPaid}
                  aria-describedby={partPaid ? voidReasonId : undefined}
                  onClick={onVoid}
                >
                  Cancel order
                </Button>
                {takesLines ? (
                  canSend ? (
                    <Button
                      size={56}
                      icon={<Printer />}
                      keyHint={REGISTER_KEYS.send}
                      data-testid={reprintable ? "detail-kitchen-reprint" : "detail-send"}
                      disabled={busy || (!sendable && !reprintable)}
                      onClick={sendable ? onSend : onKitchenReprint}
                    >
                      {pending === "send" || pending === "kitchen" ? "Printing…" : printWords(order)}
                    </Button>
                  ) : (
                    <PermissionNotice who="staff who take orders" action="send them to the kitchen" next="Ask one to help." />
                  )
                ) : null}
              </div>
              {(takesLines && onAddItems) || onDiscount ? (
                <div className="y-detail__row">
                  {takesLines && onAddItems ? (
                    <Button size={56} icon={<Plus />} data-testid="detail-add-items" disabled={busy} onClick={onAddItems}>
                      Add items
                    </Button>
                  ) : null}
                  {onDiscount ? (
                    <Button
                      variant="quiet"
                      size={56}
                      icon={<BadgePercent />}
                      data-testid="detail-discount"
                      disabled={busy || partPaid || lines.length === 0}
                      aria-describedby={partPaid ? voidReasonId : undefined}
                      onClick={onDiscount}
                    >
                      Discount
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {partPaid ? (
                <p className="y-detail__why" id={voidReasonId}>
                  {onDiscount
                    ? "An order can't be cancelled or discounted once part of it is paid."
                    : "An order can't be cancelled once part of it is paid."}
                </p>
              ) : null}
              {onPrintBill ? (
                <Button
                  size={56}
                  block
                  icon={<ReceiptText />}
                  data-testid="detail-print-bill"
                  disabled={busy || lines.length === 0}
                  onClick={onPrintBill}
                >
                  {pending === "bill" ? "Printing…" : "Print bill"}
                </Button>
              ) : null}
              {canPay ? (
                <Button
                  ref={primaryRef}
                  variant="pay"
                  size={64}
                  block
                  icon={<Wallet />}
                  keyHint={REGISTER_KEYS.pay}
                  data-testid="detail-pay"
                  disabled={busy || !payable}
                  onClick={onPay}
                >
                  {payable ? `${sendsOnPay ? "Send and pay" : "Pay"} ${formatMoney(order.remainingMinor, currency)}` : "Pay"}
                </Button>
              ) : (
                <PermissionNotice who="a cashier or manager" action="take payment" next="Ask one to help." />
              )}
            </>
          ) : (
            <div className="y-detail__row">
              <Button variant="quiet" size={56} disabled={busy} onClick={onClose}>
                {BACK_WORDS}
              </Button>
              {paid && onRefund ? (
                <Button
                  variant="danger"
                  size={56}
                  icon={<Undo2 />}
                  data-testid="detail-refund"
                  disabled={busy || !refundOffer?.offer}
                  aria-describedby={refundOffer && !refundOffer.offer && refundOffer.why ? refundReasonId : undefined}
                  onClick={onRefund}
                >
                  Refund items
                </Button>
              ) : null}
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
                    {pending === "reprint" ? "Printing…" : "Print bill again"}
                  </Button>
                ) : (
                  <PermissionNotice who="a cashier or manager" action="print the bill again" next="Ask one to help." />
                )
              ) : null}
            </div>
          )}
          {paid && onRefund && refundOffer && !refundOffer.offer && refundOffer.why ? (
            <p className="y-detail__why" id={refundReasonId}>
              {refundOffer.why}
            </p>
          ) : null}
        </div>
      }
    >
      <div className="y-detail">
        <div className="y-detail__state">
          {refunded ? (
            <StatusChip tone="danger" data-testid="order-detail-status">
              {refundedInFull ? "Refunded" : "Partly refunded"}
            </StatusChip>
          ) : owing && order.waitingForShift ? (
            // S17b: the list and the detail say the same: it waits for a shift.
            <StatusChip tone="warning" data-testid="order-detail-status">
              Waiting for a shift
            </StatusChip>
          ) : (
            <StatusChip tone={emptiedOrder(order) ? "neutral" : orderStatusTone(order.status)} icon={orderStatusIcon(order.status)} data-testid="order-detail-status">
              {emptiedOrder(order) ? EMPTIED_WORDS : orderStatusWords(order.status)}
            </StatusChip>
          )}
          <p className="y-detail__result" role="status" data-testid="order-detail-result">
            {result ?? ""}
          </p>
        </div>
        {reference ? (
          <p className="y-detail__reference" data-testid="order-detail-reference">
            Reference {reference}
          </p>
        ) : null}
        {problem ? <RefusalNotice refusal={problem} data-testid="order-detail-error" /> : null}

        {order.notes?.trim() ? (
          <p className="y-detail__note" data-testid="order-detail-note">
            <strong>Note:</strong> {order.notes.trim()}
          </p>
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
          <div className="y-ticket__groups" data-testid="order-detail-lines">
            {linesByRound(lines).map((group) => (
              <section key={group.key} className="y-ticket__group" aria-label={group.title ?? undefined} data-testid={`detail-group-${group.key}`}>
                {group.title ? (
                  <h4 className={group.key === "unsent" ? "y-ticket__group-title y-ticket__group-title--unsent" : "y-ticket__group-title"}>
                    {group.title}
                  </h4>
                ) : null}
                <ul className="y-ticket__list">
                  {group.lines.map((line) => {
                    const removable = takesLines && line.status === "ADDED";
                    const selected = removable && selectedLineId === line.id;
                    return (
                      <li key={line.id}>
                        <TicketLine
                          quantity={line.quantity}
                          name={line.name}
                          options={(line.modifiers ?? []).map((modifier) => modifier.optionName)}
                          amount={formatMoney(lineAmountMinor(order.pricesIncludeTax, line), currency)}
                          sent={owing && line.status === "SENT"}
                          sentChip={false}
                          selected={selected}
                          onSelect={removable && !busy ? () => onSelectLine(selected ? null : line.id) : undefined}
                        />
                        {selected ? (
                          <div className="y-ticket__line-actions" role="group" aria-label={line.name}>
                            <Stepper label={line.name} value={line.quantity} min={1} max={MAX_LINE_QUANTITY} disabled={busy} onChange={(quantity) => onQuantity(line, quantity)} />
                            <Button
                              variant="danger-outline"
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
            ))}
          </div>
        </section>

        <dl className="y-ticket__totals" data-testid="order-detail-totals">
          <div>
            <dt>{figures.itemsLabel}</dt>
            <dd>{formatMoney(figures.itemsMinor, currency)}</dd>
          </div>
          {figures.discountMinor > 0 ? (
            <div>
              <dt>Discount{order.discountReason ? ` · ${order.discountReason}` : ""}</dt>
              <dd>{formatMoney(-figures.discountMinor, currency)}</dd>
            </div>
          ) : null}
          {order.discountCapped && figures.discountMinor > 0 ? (
            <div className="y-ticket__held-row">
              <dt className="sr-only">About the discount</dt>
              <dd className="y-ticket__held" data-testid="discount-held">
                {DISCOUNT_HELD_WORDS}
              </dd>
            </div>
          ) : null}
          <div>
            <dt>{figures.vatLabel}</dt>
            <dd>{formatMoney(figures.taxMinor, currency)}</dd>
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
            {payments.length > 0 ? (
              <ul className="y-detail__payments" data-testid="order-detail-payments">
                {payments.map((payment) => (
                  <li key={payment.id} className="y-detail__payment">
                    <span className="y-detail__line">
                      {payment.paymentMethod === "ROOM_CHARGE" ? "Charged to the room" : paymentMethodWords(payment.paymentMethod)} ·{" "}
                      {formatMoney(payment.amountMinor, currency)}
                    </span>
                    <span className="y-detail__line y-detail__muted">{takenWords(payment)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {partPaid && !paid ? (
              <p className="y-detail__line">
                Paid {formatMoney(order.paidMinor, currency)} of {formatMoney(order.totalMinor, currency)} ·{" "}
                {formatMoney(order.remainingMinor, currency)} still to pay
              </p>
            ) : null}
            {paid && receipt && receipt.reprintCount > 0 ? (
              <p className="y-detail__line y-detail__muted">
                Printed again {receipt.reprintCount} {receipt.reprintCount === 1 ? "time" : "times"}
              </p>
            ) : null}
          </section>
        ) : null}

        {refunded ? (
          <section className="y-detail__section" aria-labelledby="detail-refunds">
            <h3 id="detail-refunds" className="y-detail__heading">
              Refunds
            </h3>
            <ul className="y-detail__payments" data-testid="order-detail-refunds">
              {refunds.refunds.map((refund) => (
                <li key={refund.id} className="y-detail__payment">
                  <span className="y-detail__line">
                    {refundGivenWords(refund.totalMinor, refund.tenders, refund.currency || currency || "")}
                    {clockTime(refund.createdAt) ? ` · ${clockTime(refund.createdAt)}` : ""}
                  </span>
                  <span className="y-detail__line y-detail__muted">
                    {refund.reason} · {refund.initiatedByName}, approved by {refund.authorizedByName}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </Sheet>
  );
}

/**
 * An order's detail against the live API: send it, remove a line not yet
 * sent, or print a copy of a paid order's receipt here; Pay, Void and Refund
 * items open their own sheets (the parent's).
 */
export function OrderDetail({
  order,
  currency,
  canSend,
  canPay,
  onPay,
  onVoid,
  onRefund,
  onAddItems,
  onDiscount,
  onClose,
  onReload,
}: {
  order: POSOrder;
  currency: string | undefined;
  canSend: boolean;
  canPay: boolean;
  onPay: () => void;
  onVoid: () => void;
  onRefund?: () => void;
  /** Opens the order on Sell (the shell's). */
  onAddItems?: () => void;
  /** Opens the discount (the parent's sheet). */
  onDiscount?: () => void;
  onClose: () => void;
  /** Ask Yetu for the order again (it may have changed on another till). */
  onReload: () => void;
}) {
  const propertyId = usePropertyId();
  const printAfter = usePrintAfter(propertyId);
  const tickets = useStationTickets(true);
  const paid = order.status === "CLOSED";
  const receipt = useReceipt(paid ? order.id : undefined);
  const refunds = useOrderRefunds(paid ? order.id : undefined);
  const { shift } = usePosShift();
  // A refund goes back from the drawer, so whoever holds it gives it: not a waiter (fbc-peak #327).
  const holdsDrawer = useHasPermission("pos.shift.open");
  const refundOffer = refunds.data
    ? refundAvailability({
        refunds: refunds.data,
        shiftBusinessDate: shift?.status === "OPEN" ? shift.businessDate : null,
        canRefund: canPay && holdsDrawer,
      })
    : undefined;
  const sendOrder = useSendOrder();
  const removeItem = useRemoveOrderItem();
  const setLineQuantity = useSetLineQuantity();
  const reprint = useReprintReceipt();
  const printBill = usePrintBill();
  const kitchenReprint = useReprintKitchenTickets();
  const [preview, setPreview] = useState<{ kind: "ROUND" | "AGAIN" | "BILL"; print: (stations?: string[]) => void; allOnly: boolean } | null>(null);
  const takeOver = useTakeOverTab();
  const takeOverKey = useRequestKey();
  const sendKey = useRequestKey();
  const removeKey = useRequestKey();
  const quantityKey = useRequestKey();
  const reprintKey = useRequestKey();
  const kitchenKey = useRequestKey();
  const billKey = useRequestKey();
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [problem, setProblem] = useState<Refusal | null>(null);
  const focusAfter = useRef(false);

  const pending: DetailPending = sendOrder.isPending
    ? "send"
    : removeItem.isPending
      ? "remove"
      : setLineQuantity.isPending
        ? "quantity"
        : reprint.isPending
        ? "reprint"
        : kitchenReprint.isPending
          ? "kitchen"
          : takeOver.isPending
            ? "take-over"
            : printBill.isPending
              ? "bill"
              : null;
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

  /** Pay: what isn't sent goes to the kitchen first, then the payment opens. */
  function payAfterSending() {
    const unsent = order.items.some((line) => line.status === "ADDED");
    if (pending !== null) return;
    if (!(canSend && takesMore(order) && unsent)) {
      onPay();
      return;
    }
    begin();
    sendOrder.mutate(
      { orderId: order.id, version: order.version, idempotencyKey: sendKey.keyFor([order.id, order.version].join("|")) },
      {
        onSuccess: (updated) => {
          void printAfter(updated.id);
          onPay();
        },
        onError: (error) => {
          const refusal = sendProblem(error);
          setProblem(refusal ?? { kind: "other", words: "The order wasn't sent, so payment didn't open. Try again." });
          if (refusal?.kind !== "network") sendKey.forget();
          if (refusal?.kind === "moved") onReload();
        },
      },
    );
  }

  /** The new items to the kitchen and the bar: all of them, or only those stations' (Print for bar). */
  function send(stations?: string[]) {
    if (pending !== null) return;
    begin();
    sendOrder.mutate(
      {
        orderId: order.id,
        version: order.version,
        stations,
        idempotencyKey: sendKey.keyFor([order.id, order.version, ...(stations ?? [])].join("|")),
      },
      {
        onSuccess: (updated) => {
          focusAfter.current = true;
          const sentWords = directOnlyUnsent(order) ? DIRECT_ORDER_SENT_WORDS : ORDER_SENT_WORDS;
          setResult(sentWords);
          // The kitchen tickets Yetu made, printed as before; one that didn't print is said (F-233).
          void printAfter(updated.id).then((results) => {
            const words = printProblemOnce(results, "kitchen ticket");
            if (words) setResult(`${sentWords} ${words}`);
          });
        },
        onError: (error) => {
          const refusal = sendProblem(error);
          setProblem(refusal ?? { kind: "other", words: "The order wasn't sent. Try again." });
          // Only a lost answer is asked again under its key.
          if (refusal?.kind !== "network") sendKey.forget();
          // It may have changed on another till: show it as Yetu has it now.
          if (refusal?.kind === "moved") onReload();
        },
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
        idempotencyKey: removeKey.keyFor([order.id, line.id, order.version].join("|")),
      },
      {
        onSuccess: (next) => {
          focusAfter.current = true;
          setSelectedLineId(null);
          // F-260 (fbc-peak #286): the last line off, Yetu closes the order.
          setResult(
            next.status === "VOIDED"
              ? `${line.name} removed. Nothing is left on ${orderName(order)}, so it's closed.`
              : `${line.name} removed.`,
          );
        },
        onError: (error) => {
          const refusal = removeProblem(error);
          setProblem(refusal ?? { kind: "other", words: "The item wasn't removed. Try again." });
          if (refusal?.kind !== "network") removeKey.forget();
          if (refusal?.kind === "stale") onReload();
        },
      },
    );
  }

  function changeQuantity(line: POSOrderItem, quantity: number) {
    if (pending !== null || quantity < 1) return;
    begin();
    setLineQuantity.mutate(
      {
        orderId: order.id,
        itemId: line.id,
        quantity,
        version: order.version,
        idempotencyKey: quantityKey.keyFor([order.id, line.id, quantity, order.version].join("|")),
      },
      {
        onSuccess: () => setResult(`${line.name}: ${quantity}.`),
        onError: (error) => {
          const refusal = quantityProblem(error);
          setProblem(refusal ?? { kind: "other", words: "The quantity wasn't changed. Try again." });
          if (refusal?.kind !== "network") quantityKey.forget();
          if (refusal?.kind === "stale") onReload();
        },
      },
    );
  }

  function printCopy() {
    if (pending !== null || !receipt.data) return;
    begin();
    reprint.mutate(
      { orderId: order.id, idempotencyKey: reprintKey.keyFor([order.id, receipt.data.reprintCount].join("|")) },
      {
        onSuccess: ({ failed }) => {
          if (failed) setProblem({ kind: "other", words: copyNotPrintedWords(failed) });
          else setResult("A copy of the bill was sent to the printer.");
        },
        onError: (error) => {
          const refusal = reprintProblem(error);
          setProblem(refusal ?? { kind: "other", words: "The copy wasn't printed. Try again." });
          if (refusal?.kind !== "network") reprintKey.forget();
        },
      },
    );
  }

  // The bill before payment (fbc-peak #288): a new one for each version of the order.
  function printTheBill() {
    if (pending !== null) return;
    begin();
    printBill.mutate(
      { orderId: order.id, idempotencyKey: billKey.keyFor([order.id, order.version, order.billPrints?.length ?? 0].join("|")) },
      {
        onSuccess: ({ failed }) => {
          billKey.forget();
          if (failed) setProblem({ kind: "other", words: billNotPrintedWords(failed) });
          else setResult("The bill was sent to the printer.");
        },
        onError: (error) => {
          const refusal = billProblem(error);
          setProblem(refusal ?? { kind: "other", words: "The bill wasn't printed. Try again." });
          if (refusal?.kind !== "network") billKey.forget();
          if (refusal?.kind === "moved") onReload();
        },
      },
    );
  }

  function takeTabOver() {
    if (pending !== null) return;
    begin();
    takeOver.mutate(
      { orderId: order.id, idempotencyKey: takeOverKey.keyFor(order.id) },
      {
        onSuccess: () => {
          takeOverKey.forget();
          setResult("The tab is on this till's shift now.");
          onReload();
        },
        onError: (error) => {
          const refusal = takeOverProblem(error);
          setProblem(refusal ?? { kind: "other", words: "The tab wasn't taken over. Try again." });
          if (refusal?.kind !== "network") takeOverKey.forget();
          if (refusal?.kind === "moved") onReload();
        },
      },
    );
  }

  function printKitchenAgain() {
    if (pending !== null) return;
    begin();
    kitchenReprint.mutate(
      { orderId: order.id, idempotencyKey: kitchenKey.keyFor([order.id, "kitchen", order.roundsSent ?? 1].join("|")) },
      {
        onSuccess: ({ reprint: again, failed }) => {
          // Each press is another copy: the next press gets its own key.
          kitchenKey.forget();
          const words = kitchenReprintWords(again.roundNumber, order.roundsSent, failed);
          if (failed) setProblem({ kind: "other", words });
          else setResult(words);
        },
        onError: (error) => {
          const refusal = kitchenReprintProblem(error);
          setProblem(refusal ?? { kind: "other", words: "The kitchen ticket wasn't printed again. Try again." });
          if (refusal?.kind !== "network") kitchenKey.forget();
        },
      },
    );
  }

  // Every paper is shown before it prints (owner, 2026-10-21): which, and what Print then does.
  const unsent = order.items.some((line) => line.status === "ADDED");
  // allOnly: before payment every new item prints, so the guest pays for what the kitchen has heard of.
  function previewFirst(kind: "ROUND" | "AGAIN" | "BILL", print: (stations?: string[]) => void, allOnly = false) {
    return () => {
      if (pending === null) setPreview({ kind, print, allOnly });
    };
  }

  return (
    <>
      <OrderDetailView
        order={order}
        currency={currency}
        timeline={orderTimeline({
          order,
          tickets: (tickets.data ?? []).filter((ticket) => ticket.orderId === order.id && ticket.status !== "SERVED"),
          currency,
        })}
        receipt={receipt.data}
        canSend={canSend}
        canPay={canPay}
        pending={pending}
        problem={problem}
        result={result}
        selectedLineId={selectedLineId}
        onSelectLine={setSelectedLineId}
        onSend={previewFirst("ROUND", send)}
        onPay={canSend && takesMore(order) && unsent ? previewFirst("ROUND", payAfterSending, true) : payAfterSending}
        onVoid={onVoid}
        onRemoveLine={remove}
        onQuantity={changeQuantity}
        onReprint={printCopy}
        onPrintBill={canSend ? previewFirst("BILL", printTheBill) : undefined}
        onKitchenReprint={canSend && sentToKitchen(order) ? previewFirst("AGAIN", printKitchenAgain) : undefined}
        onTakeOver={canSend ? takeTabOver : undefined}
        onAddItems={onAddItems}
        onDiscount={onDiscount}
        onClose={onClose}
        refunds={refunds.data}
        refundOffer={refundOffer}
        onRefund={onRefund}
      />
      {preview ? (
        <PaperPreviewSheet
          orderId={order.id}
          directOnly={directOnlyUnsent(order)}
          kind={preview.kind}
          busy={pending !== null}
          nothingNew={!unsent}
          refusalOf={(error) => {
            const refusal = preview.kind === "BILL" ? billProblem(error) : preview.kind === "AGAIN" ? kitchenReprintProblem(error) : sendProblem(error);
            return refusal && refusal.kind !== "network" ? refusal.words : null;
          }}
          allOnly={preview.allOnly}
          onBack={() => setPreview(null)}
          onPrint={(stations) => {
            const print = preview.print;
            setPreview(null);
            print(stations);
          }}
        />
      ) : null}
    </>
  );
}
