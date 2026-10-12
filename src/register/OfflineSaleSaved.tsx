import { CircleCheck } from "lucide-react";
import { useRef } from "react";
import { Button, Dialog, Money } from "../components/system";
import type { OfflineCashCommitResult } from "../lib/localPosCore";
import { formatMoney } from "../lib/money";

/** The words for a saved offline sale: where it is, and the change to give. */
export function offlineSavedWords(changeMinor: number, currency: string): string {
  return `Sale saved on this till · ${changeMinor > 0 ? `Change ${formatMoney(changeMinor, currency)}` : "No change to give"}`;
}

/**
 * An offline cash sale saved on the till: the tick, the change to give, and
 * that it is waiting to be sent to Yetu. New sale starts the next one.
 */
export function OfflineSaleSaved({
  result,
  currency,
  onNewSale,
}: {
  result: OfflineCashCommitResult;
  currency: string;
  onNewSale: () => void;
}) {
  const newSale = useRef<HTMLButtonElement>(null);
  const waiting = result.syncState !== "ACKNOWLEDGED";
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onNewSale();
      }}
      title="Sale saved"
      description={offlineSavedWords(result.changeMinor, currency)}
      descriptionHidden
      initialFocus={newSale}
      testId="offline-sale-saved"
    >
      <div className="y-done">
        <CircleCheck className="y-done__tick" aria-hidden="true" />
        <p className="y-done__change" role="status" data-testid="offline-sale-saved-line">
          {offlineSavedWords(result.changeMinor, currency)}
        </p>
        <Money minor={result.amountDueMinor} currency={currency} size="display" />
        <p className="y-done__how">
          {waiting ? "Waiting to send to Yetu. It goes when the connection returns." : "Sent to Yetu."}
        </p>
        <Button ref={newSale} variant="primary" size={64} block onClick={onNewSale}>
          New sale
        </Button>
      </div>
    </Dialog>
  );
}
