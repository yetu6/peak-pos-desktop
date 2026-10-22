import { BACK_WORDS } from "../lib/words";
import { Printer } from "lucide-react";
import { copyNotPrintedWords } from "../print/printProblems";
import { vatFigures } from "../lib/vatWords";
import { useReceipt, useReprintReceipt } from "../hooks/usePosData";
import { reprintProblem } from "../orders/ordersWords";
import { formatMoney } from "../lib/money";
import type { POSReceipt } from "../lib/posContracts";
import { useHoldIdleLock } from "../lib/useHoldIdleLock";
import { useRequestKey } from "../lib/useRequestKey";
import { businessDayWords, guestCountWords, clockTime, orderPlaceWords, paymentMethodWords, serviceTypeWords, type SettlementMethod } from "../lib/words";
import { Banner, Button, Dialog, RefusalNotice, Skeleton, type Refusal } from "./system";
import { orderName, orderReference } from "../lib/orderNumber";

/** How the order was settled: one method, or SPLIT when more than one tender paid it. */
function settledWords(method: string): string {
  return method === "SPLIT" ? "Split payment" : paymentMethodWords(method as SettlementMethod);
}

/**
 * The receipt Yetu kept when the order was settled
 * (`GET /pos/orders/{orderId}/receipt`), shown as it is: never rebuilt from
 * the live menu. It is not a tax receipt: those come from the outlet's EFD
 * machine. Print again uses the existing reprint.
 */
export function ReceiptView({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const receipt = useReceipt(orderId);
  const reprint = useReprintReceipt();
  // A copy asked for again after a lost answer reuses its key; each new copy (a new count) gets a new one.
  const requestKey = useRequestKey();
  // Yetu made the copy but the printer didn't print it: said, not passed over (F-233).
  const reprintError = reprintProblem(reprint.error) ?? (reprint.data?.failed ? copyNotPrintedWords(reprint.data.failed) : null);
  // The till doesn't lock itself while a copy is with Yetu.
  useHoldIdleLock(reprint.isPending);
  return (
    <ReceiptSheet
      receipt={receipt.data}
      loading={receipt.isLoading}
      failed={receipt.isError}
      reprinting={reprint.isPending}
      reprintError={reprintError}
      onReprint={() => {
        if (!receipt.data) return;
        reprint.mutate({ orderId, idempotencyKey: requestKey.keyFor([orderId, receipt.data.reprintCount].join("|")) });
      }}
      onClose={onClose}
    />
  );
}

export function ReceiptSheet({
  receipt,
  loading,
  failed,
  reprinting,
  reprintError,
  onReprint,
  onClose,
}: {
  receipt: POSReceipt | undefined;
  loading: boolean;
  failed: boolean;
  reprinting: boolean;
  /** Why Yetu didn't print a copy: a 403 shows as a permission notice. */
  reprintError: Refusal | string | null;
  onReprint: () => void;
  onClose: () => void;
}) {
  const doc = receipt?.document;
  // The figures as the guest reads them: with VAT inside the prices, the menu prices (F-229).
  const figures = doc ? vatFigures(doc) : null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        // While a copy is with Yetu the receipt stays open, so its answer is seen.
        if (!open && !reprinting) onClose();
      }}
      title="Bill"
      testId="receipt-view"
      footer={
        <div className="y-options__footer">
          <Button variant="quiet" disabled={reprinting} onClick={onClose}>
            {BACK_WORDS}
          </Button>
          <Button
            icon={<Printer />}
            data-testid="reprint-receipt"
            onClick={onReprint}
            disabled={!receipt || reprinting}
          >
            {reprinting ? "Sending to the printer…" : "Print again"}
          </Button>
        </div>
      }
    >
      <div className="y-receipt">
        {loading ? (
          <div className="y-receipt__loading" aria-label="Loading the bill">
            <Skeleton height={24} width="60%" />
            <Skeleton height={120} />
          </div>
        ) : null}
        {failed ? (
          <Banner inline tone="danger" data-testid="receipt-error">
            The receipt couldn't be loaded. Check the connection, then try again.
          </Banner>
        ) : null}
        {doc ? (
          <div className="y-receipt__paper" data-testid="receipt-document">
            <div className="y-receipt__head">
              <p className="y-receipt__property" data-testid="receipt-property">
                {doc.propertyName}
              </p>
              {doc.outletName ? <p className="y-receipt__meta">{doc.outletName}</p> : null}
            </div>
            <div className="y-receipt__meta-block">
              <p className="y-receipt__order">
                {[orderName(doc), doc.guestCount ? guestCountWords(doc.guestCount) : "", serviceTypeWords(doc.serviceType), orderPlaceWords(doc.serviceType, doc.tableLabel, doc.askForTable)]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {orderReference(doc) ? (
                <p className="y-receipt__meta" data-testid="receipt-reference">
                  Reference {orderReference(doc)}
                </p>
              ) : null}
              <p className="y-receipt__meta">
                {businessDayWords(doc.businessDate)} · {clockTime(doc.settledAt)}
              </p>
              {doc.initiatedByName ? (
                <p className="y-receipt__meta" data-testid="receipt-taken-by">
                  Taken by {doc.initiatedByName}
                </p>
              ) : null}
              {doc.operatorName && doc.operatorName !== doc.initiatedByName ? (
                <p className="y-receipt__meta" data-testid="receipt-settled-by">
                  Payment taken by {doc.operatorName}
                </p>
              ) : null}
            </div>
            <ul className="y-receipt__lines">
              {doc.items.map((line, index) => (
                <li key={index} className="y-receipt__line">
                  <span className="y-receipt__line-name">
                    {line.quantity} × {line.name}
                    {(line.modifiers ?? []).map((modifier) => (
                      <span key={modifier.id} className="y-receipt__option">
                        {modifier.optionName}
                      </span>
                    ))}
                  </span>
                  <span className="y-receipt__amount">{formatMoney(line.totalMinor, doc.currency)}</span>
                </li>
              ))}
            </ul>
            <dl className="y-receipt__totals">
              <div>
                <dt>{figures!.itemsLabel}</dt>
                <dd>{formatMoney(figures!.itemsMinor, doc.currency)}</dd>
              </div>
              {figures!.discountMinor > 0 ? (
                <div>
                  <dt>Discount{doc.discountReason ? ` · ${doc.discountReason}` : ""}</dt>
                  <dd>{formatMoney(-figures!.discountMinor, doc.currency)}</dd>
                </div>
              ) : null}
              <div>
                <dt>{figures!.vatLabel}</dt>
                <dd>{formatMoney(figures!.taxMinor, doc.currency)}</dd>
              </div>
              <div className="y-receipt__total">
                <dt>Total</dt>
                <dd>{formatMoney(doc.totalMinor, doc.currency)}</dd>
              </div>
            </dl>
            <p className="y-receipt__meta">Paid by {settledWords(doc.tenderMethod)}</p>
            {receipt && receipt.reprintCount > 0 ? (
              <p className="y-receipt__meta">
                Printed again {receipt.reprintCount} {receipt.reprintCount === 1 ? "time" : "times"}
              </p>
            ) : null}
            <p className="y-receipt__footer" data-testid="receipt-footer">
              Powered by Yetu-FBC
            </p>
          </div>
        ) : null}
        {reprintError ? <RefusalNotice refusal={reprintError} data-testid="reprint-error" /> : null}
      </div>
    </Dialog>
  );
}
