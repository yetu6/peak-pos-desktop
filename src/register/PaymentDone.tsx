import { CircleCheck, Receipt } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Dialog, Money } from "../components/system";
import { formatMoney } from "../lib/money";
import { paymentMethodWords } from "../lib/words";
import type { PaidInfo } from "./PaySheet";
import { REGISTER_AUTO_RETURN_SECONDS } from "./registerSettings";

/**
 * The moment a sale is paid: a tick, Paid (or Charged to room 12), the
 * amount, how, and the change to give. It says nothing about printing: the
 * till doesn't learn here whether the receipt printed (S8). New sale starts
 * the next order; Sell also comes back on its own after
 * REGISTER_AUTO_RETURN_SECONDS, waiting while the person is using this screen.
 */
export function PaymentDone({
  paid,
  currency,
  onNewSale,
  onViewReceipt,
}: {
  paid: PaidInfo;
  currency: string;
  onNewSale: () => void;
  onViewReceipt: () => void;
}) {
  const [left, setLeft] = useState(REGISTER_AUTO_RETURN_SECONDS);
  const [hovered, setHovered] = useState(false);
  const [buttonFocused, setButtonFocused] = useState(false);
  const done = useRef(false);
  const paused = hovered || buttonFocused;

  function finish() {
    if (done.current) return;
    done.current = true;
    onNewSale();
  }

  useEffect(() => {
    if (paused) return;
    const tick = setInterval(() => setLeft((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => clearInterval(tick);
  }, [paused]);

  useEffect(() => {
    if (left <= 0) finish();
  });

  const room = paid.method === "ROOM_CHARGE";
  const title = room ? `Charged to room ${paid.roomNumber ?? ""}`.trim() : "Paid";
  const how = paid.split ? "Split payment" : paymentMethodWords(paid.method);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) finish();
      }}
      title={title}
      testId="payment-done-dialog"
    >
      <div
        className="y-done"
        data-testid="payment-done"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <CircleCheck className="y-done__tick" aria-hidden="true" />
        <Money minor={paid.order.totalMinor} currency={currency} size="display" />
        <p className="y-done__how">
          {room ? `Order ${paid.order.orderNumber} is on the guest's bill.` : `${how} · Order ${paid.order.orderNumber}`}
        </p>
        {paid.changeMinor > 0 ? (
          <p className="y-done__change" data-testid="done-change">
            Change to give {formatMoney(paid.changeMinor, currency)}
          </p>
        ) : null}
        <div
          className="y-done__actions"
          onFocus={(event) => setButtonFocused(event.target instanceof HTMLButtonElement)}
          onBlur={() => setButtonFocused(false)}
        >
          <Button size={56} icon={<Receipt />} onClick={onViewReceipt}>
            View receipt
          </Button>
          <Button variant="primary" size={64} onClick={finish}>
            New sale
          </Button>
        </div>
        <p className="y-done__countdown" data-testid="done-countdown">
          {paused ? "Waiting while you look" : `Back to Sell in ${left} ${left === 1 ? "second" : "seconds"}`}
        </p>
      </div>
    </Dialog>
  );
}
