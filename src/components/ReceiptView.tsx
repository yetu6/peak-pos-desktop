import { Printer } from "lucide-react";
import { useIdempotencyKey, useMutationMessage, useReceipt, useReprintReceipt } from "../hooks/usePosData";
import { formatMoney } from "../lib/money";
import { businessDayWords, clockTime, paymentMethodWords, serviceTypeWords, type SettlementMethod } from "../lib/words";
import { Banner, Button, Dialog, Skeleton } from "./system";

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
  const idempotencyKey = useIdempotencyKey();
  const reprintError = useMutationMessage(reprint.error);
  const doc = receipt.data?.document;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Receipt"
      testId="receipt-view"
      footer={
        <div className="y-options__footer">
          <Button variant="quiet" onClick={onClose}>
            Close
          </Button>
          <Button
            icon={<Printer />}
            data-testid="reprint-receipt"
            onClick={() => reprint.mutate({ orderId, idempotencyKey: idempotencyKey.next() })}
            disabled={!receipt.data || reprint.isPending}
          >
            {reprint.isPending ? "Sending to the printer…" : "Print again"}
          </Button>
        </div>
      }
    >
      <div className="y-receipt">
        {receipt.isLoading ? (
          <div className="y-receipt__loading" aria-label="Loading the receipt">
            <Skeleton height={24} width="60%" />
            <Skeleton height={120} />
          </div>
        ) : null}
        {receipt.isError ? (
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
                Order {doc.orderNumber} · {serviceTypeWords(doc.serviceType)}
                {doc.tableLabel ? ` · ${doc.tableLabel}` : ""}
              </p>
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
                  Paid with {doc.operatorName}
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
                <dt>Subtotal</dt>
                <dd>{formatMoney(doc.subtotalMinor, doc.currency)}</dd>
              </div>
              <div>
                <dt>VAT</dt>
                <dd>{formatMoney(doc.taxMinor, doc.currency)}</dd>
              </div>
              <div className="y-receipt__total">
                <dt>Total</dt>
                <dd>{formatMoney(doc.totalMinor, doc.currency)}</dd>
              </div>
            </dl>
            <p className="y-receipt__meta">Paid by {settledWords(doc.tenderMethod)}</p>
            {receipt.data && receipt.data.reprintCount > 0 ? (
              <p className="y-receipt__meta">
                Printed again {receipt.data.reprintCount} {receipt.data.reprintCount === 1 ? "time" : "times"}
              </p>
            ) : null}
            <p className="y-receipt__footer" data-testid="receipt-footer">
              This is not a tax receipt. Use your EFD machine for tax receipts.
            </p>
          </div>
        ) : null}
        {reprintError ? (
          <Banner inline tone="danger" data-testid="reprint-error">
            {reprintError}
          </Banner>
        ) : null}
      </div>
    </Dialog>
  );
}
