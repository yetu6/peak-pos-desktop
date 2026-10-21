import { payWaitsWords, sendWords, takesMore, unsentLines } from "./rounds";
import { ChefHat, Ellipsis, Wallet } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Dialog, PermissionNotice } from "../components/system";
import { isComposing } from "../lib/keyboard";
import { formatMoney } from "../lib/money";
import type { POSOrder } from "../lib/posContracts";

/** Sell's own keys, shown on the buttons. F5, F6, F7, F10 and F11 belong to the window, F1-F4 and F12 to the rail. */
export const REGISTER_KEYS = { send: "F8", pay: "F9" } as const;

export interface TicketActionsProps {
  order: POSOrder | null;
  currency: string | undefined;
  busy: boolean;
  sending: boolean;
  /** pos.order.send */
  canSend: boolean;
  /** pos.payment.record */
  canPay: boolean;
  onSend: () => void;
  onPay: () => void;
  onDiscount: () => void;
  onVoid: () => void;
  onNote: () => void;
  /** The bill before payment (fbc-peak #288); absent for staff who can't send an order. */
  onPrintBill?: () => void;
  onNewSale: () => void;
  /** Fixtures start with More open. */
  initialMoreOpen?: boolean;
}

/**
 * The ticket's actions, kept apart by design: Send to kitchen is secondary,
 * on its own row at the left with a kitchen icon; Pay is the primary action,
 * full width at the bottom, larger, blue, with the amount still to pay. More
 * holds Discount, Void, the order note and a new sale.
 */
export function TicketActions({
  order,
  currency,
  busy,
  sending,
  canSend,
  canPay,
  onSend,
  onPay,
  onDiscount,
  onVoid,
  onNote,
  onPrintBill,
  onNewSale,
  initialMoreOpen = false,
}: TicketActionsProps) {
  const [moreOpen, setMoreOpen] = useState(initialMoreOpen);
  const lines = (order?.items ?? []).filter((line) => line.status !== "VOIDED");
  const settled = order !== null && (order.status === "CLOSED" || order.status === "VOIDED");
  // Each send is the next round (S17a); a Yetu before rounds sends an order once.
  const sendable = Boolean(order && takesMore(order) && unsentLines(order) > 0) && !busy;
  // Pay sends what isn't sent first, as a till does (Toast, Square): the
  // kitchen always hears of what is paid for. Only someone who can't send
  // waits for someone who can.
  const sendsOnPay = canSend && sendable;
  const payWaits = sendsOnPay ? null : payWaitsWords(order);
  const payable = Boolean(order && lines.length > 0 && !settled && order.remainingMinor > 0 && !payWaits) && !busy;

  const keys = useRef({ sendable, payable, canSend, canPay, onSend, onPay });
  keys.current = { sendable, payable, canSend, canPay, onSend, onPay };
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || isComposing(event) || document.querySelector('[role="dialog"]')) return;
      const now = keys.current;
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

  // Why Discount and Void can't be used just now, if they can't.
  const changeBlocked = !order || lines.length === 0
    ? "Add items first."
    : settled
      ? "This order is finished."
      : order.paidMinor > 0
        ? "Not once part of the bill is paid."
        : null;

  function choose(action: () => void) {
    setMoreOpen(false);
    action();
  }

  return (
    <div className="y-actions">
      <div className="y-actions__row">
        {canSend ? (
          <Button
            size={56}
            icon={<ChefHat />}
            keyHint={REGISTER_KEYS.send}
            data-testid="send-order"
            disabled={!sendable}
            onClick={onSend}
          >
            {sending ? "Sending…" : sendWords(order)}
          </Button>
        ) : (
          <PermissionNotice who="staff who take orders" action="send them to the kitchen" next="Ask one to help." />
        )}
        <Button variant="quiet" size={56} icon={<Ellipsis />} onClick={() => setMoreOpen(true)} className="y-actions__more">
          More
        </Button>
      </div>
      {payWaits && canPay ? (
        <p className="y-actions__why" data-testid="pay-waits">
          {payWaits}
        </p>
      ) : null}
      {canPay ? (
        <Button
          variant="primary"
          size={64}
          block
          icon={<Wallet />}
          keyHint={REGISTER_KEYS.pay}
          data-testid="pay-order"
          disabled={!payable}
          onClick={onPay}
        >
          {order && lines.length > 0 && !settled
            ? `${sendsOnPay ? "Send and pay" : "Pay"} ${formatMoney(order.remainingMinor, currency)}`
            : "Pay"}
        </Button>
      ) : (
        <PermissionNotice who="a cashier or manager" action="take payment" next="Ask one to help." />
      )}

      {moreOpen ? (
        <Dialog
          open
          onOpenChange={setMoreOpen}
          title="More for this order"
          footer={
            <Button variant="quiet" onClick={() => setMoreOpen(false)}>
              Back
            </Button>
          }
        >
          <div className="y-more">
            <MoreItem
              title="Discount"
              meta={changeBlocked ?? "Take an amount or a percentage off, with a supervisor."}
              disabled={changeBlocked !== null}
              onClick={() => choose(onDiscount)}
            />
            <MoreItem
              title="Cancel order"
              meta={changeBlocked ?? "Takes the whole order off. Needs a supervisor. Not a refund."}
              disabled={changeBlocked !== null}
              onClick={() => choose(onVoid)}
            />
            {onPrintBill ? (
              <MoreItem
                title="Print bill"
                meta={
                  !order || lines.length === 0
                    ? "Add an item first."
                    : settled
                      ? "This order is finished."
                      : "What the guest is to pay, before they pay."
                }
                disabled={!order || lines.length === 0 || settled || busy}
                onClick={() => choose(onPrintBill)}
              />
            ) : null}
            <MoreItem title="Order note" meta="A note that goes with the order to the kitchen." onClick={() => choose(onNote)} />
            {order ? (
              <MoreItem
                title="New sale"
                meta="Start another order. This one stays open in Orders."
                disabled={busy}
                onClick={() => choose(onNewSale)}
              />
            ) : null}
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}

function MoreItem({
  title,
  meta,
  disabled = false,
  onClick,
}: {
  title: string;
  meta: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className="y-more__item" disabled={disabled} onClick={onClick}>
      <span className="y-more__title">{title}</span>
      <span className="y-more__meta">{meta}</span>
    </button>
  );
}
