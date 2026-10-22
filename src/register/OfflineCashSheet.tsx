import { BACK_WORDS } from "../lib/words";
import { EXACT_WORDS, ignoreHeldEnter, startAmount, useFilledAmount } from "./moneyEntry";
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
  quickCashNotes,
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
  /** The outlet's quickCashNotes, from the copy kept for offline use. */
  quickCashNotes?: readonly number[];
}) {
  // The cash received starts at what is owed (owner, 2026-10-21; register.fillAmountDue);
  // the first key replaces it.
  const cash = useFilledAmount(startAmount(dueMinor, initialReceived));
  const received = cash.text;
  const receivedMinor = toMinor(received);
  const enough = receivedMinor !== null && receivedMinor >= dueMinor;

  function onKey(key: KeypadKey) {
    cash.keyed(key);
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
            {BACK_WORDS}
          </Button>
          <Button type="submit" form={FORM} variant="pay" size={64} data-testid="confirm-offline-cash" disabled={!enough || saving}>
            {saving ? "Saving on this till…" : `Take ${formatMoney(dueMinor, currency)} cash`}
          </Button>
        </div>
      }
    >
      <form
        id={FORM}
        className="y-pay__pane y-offline-cash"
        onKeyDown={ignoreHeldEnter}
        onSubmit={(event) => {
          event.preventDefault();
          confirm();
        }}
      >
        <p className="y-pay__label">To pay</p>
        <Money minor={dueMinor} currency={currency} size="display" data-testid="amount-due" />
        <QuickCash dueMinor={dueMinor} notes={quickCashNotes} currency={currency} onPick={(minor) => cash.picked(moneyFieldText(minor))} />
        <MoneyField
          label="Cash received"
          currency={currency}
          value={received}
          selectOnFocus
          onValueChange={(text, _minor, edit) => cash.typed(text, edit)}
          inputTestId="offline-cash-received"
          autoFocus
        />
        <Keypad label="Cash received" variant="money" onKey={onKey} testIdPrefix="offline-cash-key" />
        <p className="y-pay__change" data-testid="change-due" aria-live="polite">
          {receivedMinor === null || receivedMinor <= 0
            ? "Type or pick the cash the guest gives you."
            : receivedMinor === dueMinor
              ? EXACT_WORDS
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
