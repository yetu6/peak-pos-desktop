import { useState } from "react";
import { moneyFieldText } from "../cash/NoteCounterSheet";
import { Banner, Button, Keypad, Money, MoneyField, QuickCash, Sheet, type KeypadKey } from "../components/system";
import { formatMoney } from "../lib/money";
import { toMinor } from "../lib/posMoney";

const FORM = "offline-cash";

/**
 * Taking cash while the till works offline. Money in words (TSh), typed in
 * whole shillings, never minor units. The till's store takes the sale only
 * paid in full in cash; the change is worked out from the cash received.
 * While the sale is being saved the sheet can't be closed.
 */
export function OfflineCashSheet({
  dueMinor,
  currency,
  saving,
  problem,
  onCancel,
  onConfirm,
  initialReceived = "",
}: {
  dueMinor: number;
  currency: string;
  saving: boolean;
  /** Why the sale wasn't saved, in words. */
  problem: string | null;
  onCancel: () => void;
  onConfirm: (cashReceivedMinor: number) => void;
  /** Fixtures start part-way through. */
  initialReceived?: string;
}) {
  const [received, setReceived] = useState(initialReceived);
  const receivedMinor = toMinor(received);
  const enough = receivedMinor !== null && receivedMinor >= dueMinor;

  function onKey(key: KeypadKey) {
    if (key === "delete") setReceived((text) => text.slice(0, -1));
    else if (key === "clear") setReceived("");
    else setReceived((text) => (text === "" && /^0+$/.test(key) ? text : text + key));
  }

  function confirm() {
    if (!enough || saving || receivedMinor === null) return;
    onConfirm(receivedMinor);
  }

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !saving) onCancel();
      }}
      title="Take cash"
      description="Cash only while offline. The sale is saved on this till and sent to Yetu when the connection returns."
      testId="offline-cash-sheet"
      footer={
        <div className="y-pay__footer">
          <Button variant="quiet" disabled={saving} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" form={FORM} variant="primary" size={64} data-testid="confirm-offline-cash" disabled={!enough || saving}>
            {saving ? "Saving on this till…" : `Take ${formatMoney(dueMinor, currency)} cash`}
          </Button>
        </div>
      }
    >
      <form
        id={FORM}
        className="y-pay__pane y-offline-cash"
        onSubmit={(event) => {
          event.preventDefault();
          confirm();
        }}
      >
        <p className="y-pay__label">Amount due</p>
        <Money minor={dueMinor} currency={currency} size="display" data-testid="amount-due" />
        <QuickCash dueMinor={dueMinor} currency={currency} onPick={(minor) => setReceived(moneyFieldText(minor))} />
        <MoneyField
          label="Cash received"
          currency={currency}
          value={received}
          onValueChange={(text) => setReceived(text)}
          inputTestId="offline-cash-received"
          autoFocus
        />
        <Keypad label="Cash received" variant="money" onKey={onKey} testIdPrefix="offline-cash-key" />
        <p className="y-pay__change" data-testid="change-due" aria-live="polite">
          {receivedMinor === null || receivedMinor <= 0
            ? "Type or pick the cash the guest gives you."
            : enough
              ? `Change to give ${formatMoney(receivedMinor - dueMinor, currency)}`
              : `Offline, a sale is paid in full in cash. ${formatMoney(dueMinor - receivedMinor, currency)} more is needed.`}
        </p>
        {problem ? (
          <Banner inline tone="danger" data-testid="offline-cash-error">
            {problem}
          </Banner>
        ) : null}
      </form>
    </Sheet>
  );
}
