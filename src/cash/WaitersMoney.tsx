import { Banknote } from "lucide-react";
import { useState } from "react";
import { Button, EmptyState, ListRow, Money, MoneyField, RefusalNotice, Sheet } from "../components/system";
import { useIdempotencyKey, useReceiveFromWaiter } from "../hooks/usePosData";
import { formatMoney } from "../lib/money";
import type { POSWaiterMoney } from "../lib/posContracts";
import { toMinor } from "../lib/posMoney";
import { useHoldIdleLock } from "../lib/useHoldIdleLock";
import { BACK_WORDS } from "../lib/words";
import { MoneyKeypad } from "../register/MoneyKeypad";
import { waiterHandoverProblem } from "./cashWords";
import { moneyFieldText } from "./NoteCounterSheet";

/**
 * Waiters collect (owner, 2026-10-29; fbc-peak #327). A waiter takes payment
 * for their own tables and keeps the cash until they hand it to the cashier,
 * who counts it and confirms it here; it then goes into the drawer. What a
 * waiter still holds when the shift closes is recorded as owed by them.
 * Every figure is Yetu's own.
 */

/** How a waiter was paid, beside the cash: "Mobile money TSh 12,000 · Card TSh 6,000". */
function otherWays(money: POSWaiterMoney, currency: string | undefined): string[] {
  return [
    money.mobileMoneyMinor > 0 ? `Mobile money ${formatMoney(money.mobileMoneyMinor, currency)}` : "",
    money.cardMinor > 0 ? `Card ${formatMoney(money.cardMinor, currency)}` : "",
    money.otherMinor > 0 ? `Other ${formatMoney(money.otherMinor, currency)}` : "",
  ].filter(Boolean);
}

function ordersWords(money: POSWaiterMoney): string {
  const taken = `${money.ordersTaken} ${money.ordersTaken === 1 ? "order" : "orders"}`;
  return money.ordersOpen > 0 ? `${taken}, ${money.ordersOpen} not paid yet` : taken;
}

/** The waiter's own Cash page: what they hold, and what to do with it. */
export function WaiterOwnMoney({
  money,
  currency,
  loading,
}: {
  money: POSWaiterMoney | null;
  currency: string | undefined;
  loading: boolean;
}) {
  return (
    <section className="y-cash__card" aria-labelledby="own-money-title" data-testid="waiter-own-money">
      <h2 id="own-money-title" className="y-cash__card-title">
        Money you hold
      </h2>
      {loading ? (
        <p className="y-cash__muted">Checking with Yetu…</p>
      ) : !money || money.cashMinor + money.mobileMoneyMinor + money.cardMinor + money.otherMinor === 0 ? (
        <EmptyState
          icon={<Banknote />}
          title="No payments taken yet"
          description="Cash you take from your tables is counted here until you hand it to the cashier."
        />
      ) : (
        <>
          <dl className="y-cash__summary">
            <div>
              <dt>Cash to hand in</dt>
              <dd>
                <Money minor={money.heldMinor} currency={currency} size="title" />
              </dd>
              <dd className="y-cash__muted">Hand it to the cashier. They count it and confirm it on their till.</dd>
            </div>
          </dl>
          <ListRow title="Cash you took" meta={ordersWords(money)} trailing={<Money minor={money.cashMinor} currency={currency} size="lead" />} />
          <ListRow title="Handed in" trailing={<Money minor={money.handedInMinor} currency={currency} size="lead" />} />
          {money.owedMinor > 0 ? (
            <ListRow title="Owed by you" meta="Not handed in by the shift's close." trailing={<Money minor={money.owedMinor} currency={currency} size="lead" />} />
          ) : null}
          {otherWays(money, currency).length > 0 ? (
            <ListRow title="Paid another way" meta={otherWays(money, currency).join(" · ")} />
          ) : null}
        </>
      )}
    </section>
  );
}

/** The cashier's list of waiters on this shift, with Receive for anyone holding cash. */
export function WaitersMoneyCard({
  waiters,
  currency,
  onReceive,
}: {
  waiters: readonly POSWaiterMoney[];
  currency: string | undefined;
  onReceive: (waiter: POSWaiterMoney) => void;
}) {
  return (
    <section className="y-cash__card" aria-labelledby="waiters-money-title" data-testid="waiters-money">
      <h2 id="waiters-money-title" className="y-cash__card-title">
        Waiters' money
      </h2>
      {waiters.length === 0 ? (
        <p className="y-cash__muted">No waiter has taken an order on this shift yet.</p>
      ) : (
        waiters.map((waiter) => (
          <ListRow
            key={waiter.staffId}
            title={waiter.name}
            meta={[
              ordersWords(waiter),
              waiter.handedInMinor > 0 ? `Handed in ${formatMoney(waiter.handedInMinor, currency)}` : "",
              ...otherWays(waiter, currency),
            ]
              .filter(Boolean)
              .join(" · ")}
            trailing={
              waiter.heldMinor > 0 ? (
                <span className="y-cash__receive">
                  <span>
                    Holds <Money minor={waiter.heldMinor} currency={currency} size="lead" />
                  </span>
                  <Button variant="secondary" size={48} data-testid={`receive-${waiter.staffId}`} onClick={() => onReceive(waiter)}>
                    Receive
                  </Button>
                </span>
              ) : (
                <span className="y-cash__muted">Nothing to hand in</span>
              )
            }
          />
        ))
      )}
    </section>
  );
}

/** Count the notes a waiter hands in; Yetu puts them in the drawer. */
export function ReceiveFromWaiterSheet({
  waiter,
  currency,
  onClose,
  onReceived,
}: {
  waiter: POSWaiterMoney;
  currency: string | undefined;
  onClose: () => void;
  onReceived: (countedMinor: number) => void;
}) {
  const receive = useReceiveFromWaiter();
  const idempotencyKey = useIdempotencyKey();
  useHoldIdleLock(receive.isPending);
  const [amount, setAmount] = useState(moneyFieldText(waiter.heldMinor));
  const countedMinor = toMinor(amount);
  const problem = waiterHandoverProblem(receive.error);
  const canSubmit = countedMinor != null && countedMinor > 0 && countedMinor <= waiter.heldMinor && !receive.isPending;
  const left = countedMinor != null && countedMinor > 0 && countedMinor < waiter.heldMinor ? waiter.heldMinor - countedMinor : 0;

  function submit() {
    if (countedMinor == null || !canSubmit) return;
    receive.mutate(
      { staffId: waiter.staffId, countedMinor, idempotencyKey: idempotencyKey.next() },
      { onSuccess: () => onReceived(countedMinor) },
    );
  }

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !receive.isPending) onClose();
      }}
      title={`Receive from ${waiter.name}`}
      description={`${waiter.name} holds ${formatMoney(waiter.heldMinor, currency)}. Count the notes, then type what you counted.`}
      testId="receive-from-waiter"
      footer={
        <div className="y-cash__footer">
          <Button variant="quiet" disabled={receive.isPending} onClick={onClose}>
            {BACK_WORDS}
          </Button>
          <Button variant="primary" size={56} data-testid="confirm-receive" disabled={!canSubmit} onClick={submit}>
            {receive.isPending ? "Recording…" : "Put it in the drawer"}
          </Button>
        </div>
      }
    >
      <div className="y-form">
        <MoneyField label="Cash counted" currency={currency} value={amount} onValueChange={setAmount} inputTestId="receive-amount" autoFocus />
        <MoneyKeypad label="Cash counted" value={amount} onChange={setAmount} testIdPrefix="receive-key" />
        {countedMinor != null && countedMinor > waiter.heldMinor ? (
          <p className="y-cash__muted" role="status">
            That's more than {waiter.name} holds. Count the notes again.
          </p>
        ) : left > 0 ? (
          <p className="y-cash__muted" role="status">
            {formatMoney(left, currency)} stays with {waiter.name}. They can bring it later; if they don't by the shift's close, it's recorded
            as owed by them.
          </p>
        ) : null}
        {problem ? (
          <div data-testid="receive-error">
            <RefusalNotice refusal={problem} />
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
