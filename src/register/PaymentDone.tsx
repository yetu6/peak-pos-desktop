import { CircleCheck, Receipt } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Dialog, Money } from "../components/system";
import { formatMoney } from "../lib/money";
import { paymentMethodWords } from "../lib/words";
import type { PaidInfo } from "./PaySheet";
import { REGISTER_AUTO_RETURN_SECONDS } from "./registerSettings";
import { orderName } from "../lib/orderNumber";

/**
 * The moment a sale is paid: a tick, Paid (or Charged to room 12), the
 * amount, how, and the change to give. It says nothing about printing: the
 * till doesn't learn here whether the receipt printed (S8). New sale starts
 * the next order; Sell also comes back on its own after
 * REGISTER_AUTO_RETURN_SECONDS, waiting while the person is using this screen:
 * the pointer over it, a finger on it, or one of its buttons focused.
 */
export function PaymentDone({
  paid,
  currency,
  onNewSale,
  onViewReceipt,
  returnTo = { place: "Sell", action: "New sale" },
}: {
  paid: PaidInfo;
  currency: string;
  /** Leaves this screen: its main button, and on its own (`byItself`) after the named setting's seconds. */
  onNewSale: (byItself: boolean) => void;
  onViewReceipt: () => void;
  /** Where it goes back to, and its main button's words: Sell and New sale, or Orders when paid from there. */
  returnTo?: { place: string; action: string };
}) {
  const [left, setLeft] = useState(REGISTER_AUTO_RETURN_SECONDS);
  const [hovered, setHovered] = useState(false);
  const [buttonFocused, setButtonFocused] = useState(false);
  const done = useRef(false);
  const newSaleButton = useRef<HTMLButtonElement>(null);
  // Focus starts on New sale; that first focus is the screen's, not the
  // person's, so it doesn't hold the return to Sell.
  const startingFocus = useRef(true);
  const paused = hovered || buttonFocused;

  function finish(byItself = false) {
    if (done.current) return;
    done.current = true;
    onNewSale(byItself);
  }

  useEffect(() => {
    if (paused) return;
    const tick = setInterval(() => setLeft((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => clearInterval(tick);
  }, [paused]);

  useEffect(() => {
    if (left <= 0) finish(true);
  });

  const room = paid.method === "ROOM_CHARGE";
  const title = room ? `Charged to room ${paid.roomNumber ?? ""}`.trim() : "Paid";
  const how = paid.split ? "Split payment" : paymentMethodWords(paid.method);
  const said = room
    ? `${orderName(paid.order)} is on the guest's room account.`
    : [paid.changeMinor > 0 ? `Change to give ${formatMoney(paid.changeMinor, currency)}.` : "", `${how} · ${orderName(paid.order)}.`]
        .filter(Boolean)
        .join(" ");

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) finish();
      }}
      title={title}
      description={said}
      descriptionHidden
      initialFocus={newSaleButton}
      testId="payment-done-dialog"
    >
      <div
        className="y-done"
        data-testid="payment-done"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        // A touch screen has no hover: a finger on the screen holds it too (F-232).
        onPointerDown={() => setHovered(true)}
      >
        <CircleCheck className="y-done__tick" aria-hidden="true" />
        <Money minor={paid.order.totalMinor} currency={currency} size="display" />
        <p className="y-done__how">
          {room ? `${orderName(paid.order)} is on the guest's room account.` : `${how} · ${orderName(paid.order)}`}
        </p>
        {/* 2026-10-20: Yetu is not connected to TRA's VFD; the restaurant's EFD gives the tax receipt. */}
        {room ? null : (
          <p className="y-done__efd" data-testid="done-efd">
            Give the guest their EFD receipt.
          </p>
        )}
        {paid.changeMinor > 0 ? (
          <p className="y-done__change" data-testid="done-change">
            Change to give {formatMoney(paid.changeMinor, currency)}
          </p>
        ) : null}
        <div
          className="y-done__actions"
          onFocus={(event) => {
            if (startingFocus.current && (event.target as Element) === newSaleButton.current) {
              startingFocus.current = false;
              return;
            }
            startingFocus.current = false;
            setButtonFocused(event.target instanceof HTMLButtonElement);
          }}
          onBlur={() => setButtonFocused(false)}
        >
          <Button size={56} icon={<Receipt />} onClick={onViewReceipt}>
            View bill
          </Button>
          <Button ref={newSaleButton} variant="primary" size={64} onClick={() => finish()}>
            {returnTo.action}
          </Button>
        </div>
        <p className="y-done__countdown" data-testid="done-countdown">
          {paused ? "Waiting while you look" : `Back to ${returnTo.place} in ${left} ${left === 1 ? "second" : "seconds"}`}
        </p>
      </div>
    </Dialog>
  );
}
