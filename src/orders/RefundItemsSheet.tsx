import { CircleCheck, ShieldCheck, Undo2 } from "lucide-react";
import { useRef, useState } from "react";
import { PIN_LENGTH } from "../access/accessSettings";
import { useDeviceSessionOptional } from "../auth/DeviceSessionProvider";
import { Banner, Button, Field, MoneyField, RefusalNotice, Sheet, Skeleton, Stepper, SupervisorApproval, type KeypadKey } from "../components/system";
import { useOrderRefunds, usePropertyId, useRecordRefund, useRefundQuote } from "../hooks/usePosData";
import { formatMoney } from "../lib/money";
import { orderName } from "../lib/orderNumber";
import type {
  POSOrder,
  POSOrderRefunds,
  POSRefund,
  POSRefundLineRequest,
  POSRefundQuote,
  POSRefundRequest,
  POSRefundTenderRequest,
} from "../lib/posContracts";
import type { PrintResult } from "../lib/kitchenTicketPrint";
import { processPendingPrintJobs } from "../lib/printJobs";
import { useHoldIdleLock } from "../lib/useHoldIdleLock";
import { useRateLimitWait } from "../lib/useRateLimitWait";
import { useRequestKey } from "../lib/useRequestKey";
import { paymentMethodWords, type SettlementMethod } from "../lib/words";
import { REFUND_REASONS } from "./ordersSettings";
import { refundDoneWords, refundProblem, refundSummaryWords, type RefundProblem } from "./refundWords";

type Stage = "build" | "approve" | "done";
const OTHER_REASON = "other";

/** Refusals that mean the order or the drawer is not as the screen showed it: back to the items, asked again. */
const CHANGED: ReadonlySet<RefundProblem["kind"]> = new Set(["not-allowed", "quantity", "drawer", "room", "split"]);

type PrintState = { kind: "printing" } | { kind: "printed" } | { kind: "failed"; words: string };

/** The slip printed, or why not (no job found counts as not printed: the cashier is told). */
function printOutcome(results: readonly PrintResult[]): PrintState {
  const failed = results.find((result) => !result.ok);
  if (failed) return { kind: "failed", words: failed.error ?? "" };
  return results.length > 0 ? { kind: "printed" } : { kind: "failed", words: "" };
}

/** The quote answers the items on screen now (a kept answer may be for the last ones). */
function quoteMatches(quote: POSRefundQuote | undefined, lines: readonly POSRefundLineRequest[]): quote is POSRefundQuote {
  if (!quote || quote.lines.length !== lines.length) return false;
  return lines.every((line) => quote.lines.some((quoted) => quoted.orderItemId === line.orderItemId && quoted.quantity === line.quantity));
}

function itemsWords(lines: readonly POSRefundLineRequest[], refunds: POSOrderRefunds): string {
  return lines
    .map((line) => `${line.quantity} × ${refunds.lines.find((item) => item.orderItemId === line.orderItemId)?.name ?? "item"}`)
    .join(", ");
}

function majorText(minor: number): string {
  return String(minor / 100);
}

/**
 * Refund items (S7): chosen items and quantities of a paid order go back by
 * the ways it was paid. Yetu works out every amount (quotePOSRefund, then
 * recordPOSRefund); the till only says which items. A different person who
 * may approve refunds enters their PIN. Cash comes out of this drawer; a room
 * charge comes off the guest's bill, whole only. A refund slip prints.
 */
export function RefundItemsSheet({
  order,
  currency,
  onClose,
  onRefunded,
}: {
  order: POSOrder;
  currency: string;
  /** Back to the order (after Done, or Cancel). */
  onClose: () => void;
  /** Yetu has recorded the refund. */
  onRefunded?: (refund: POSRefund) => void;
}) {
  const device = useDeviceSessionOptional();
  const roster = device?.roster ?? [];
  const requesterId = device?.session?.staffId ?? "";
  const propertyId = usePropertyId();
  const refunds = useOrderRefunds(order.id);
  const record = useRecordRefund();
  const requestKey = useRequestKey();

  const [stage, setStage] = useState<Stage>("build");
  const [chosen, setChosen] = useState<Record<string, number>>({});
  const [reasonChoice, setReasonChoice] = useState<string | null>(null);
  const [otherReason, setOtherReason] = useState("");
  const [editingSplit, setEditingSplit] = useState(false);
  const [split, setSplit] = useState<Record<string, { text: string; minor: number | null }>>({});
  const [supervisorId, setSupervisorId] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [done, setDone] = useState<{ refund: POSRefund; print: PrintState } | null>(null);
  // The refund as it was sent, body and key, frozen until Yetu answers it: after a lost answer Try again
  // sends exactly this, never one rebuilt from figures that may have changed meanwhile.
  const sent = useRef<{ body: POSRefundRequest; idempotencyKey: string } | null>(null);

  const data = refunds.data;
  const whole = data?.wholeOrderOnly ?? false;
  // A room charge goes back whole: every item, all that is left of it. Otherwise what was chosen, never
  // more than Yetu says is left (it may have changed on another till).
  const quantities: Record<string, number> = data
    ? Object.fromEntries(
        data.lines.map((line) => [line.orderItemId, whole ? line.remainingQuantity : Math.min(chosen[line.orderItemId] ?? 0, line.remainingQuantity)]),
      )
    : {};
  const lines: POSRefundLineRequest[] = Object.entries(quantities)
    .filter(([, quantity]) => quantity > 0)
    .map(([orderItemId, quantity]) => ({ orderItemId, quantity }));
  const reason = reasonChoice === OTHER_REASON ? otherReason.trim() : (reasonChoice ?? "");

  // Yetu's figures for these items, with its own split of the money.
  const baseQuery = useRefundQuote(order.id, lines.length > 0 ? { lines } : null);
  const base = quoteMatches(baseQuery.data, lines) ? baseQuery.data : undefined;
  const splittable = !whole && (base?.tenders.filter((tender) => tender.capMinor > 0).length ?? 0) > 1;
  // A split of the cashier's own, asked about only once it adds up to Yetu's total.
  const typed: POSRefundTenderRequest[] | null =
    editingSplit && base && base.tenders.every((tender) => split[tender.paymentId]?.minor != null)
      ? base.tenders.map((tender) => ({ paymentId: tender.paymentId, amountMinor: split[tender.paymentId]?.minor ?? 0 }))
      : null;
  const typedTotal = typed?.reduce((sum, tender) => sum + tender.amountMinor, 0) ?? null;
  const typedAddsUp = typed !== null && base !== undefined && typedTotal === base.totalMinor;
  const splitQuery = useRefundQuote(
    order.id,
    typedAddsUp && typed ? { lines, tenders: typed.filter((tender) => tender.amountMinor > 0) } : null,
  );
  const quote = editingSplit ? (typedAddsUp && quoteMatches(splitQuery.data, lines) ? splitQuery.data : undefined) : base;
  const quoting = baseQuery.isFetching || (editingSplit && splitQuery.isFetching);
  const quoteProblem = refundProblem(editingSplit && typedAddsUp ? splitQuery.error : baseQuery.error, "quote");
  const tenders: POSRefundTenderRequest[] = (quote?.tenders ?? [])
    .filter((tender) => tender.amountMinor > 0)
    .map((tender) => ({ paymentId: tender.paymentId, amountMinor: tender.amountMinor }));
  const summary = quote ? refundSummaryWords(quote.tenders, currency) : "";

  const problem = refundProblem(record.error);
  // The answer may have been lost: the request stays exactly as sent until it is sent again or checked.
  const unsure = problem?.kind === "unsure";
  // The till doesn't lock itself while the refund is with Yetu.
  useHoldIdleLock(record.isPending);
  // After "too many attempts" the next one waits for Yetu's Retry-After.
  const waiting = useRateLimitWait(record.error, record.reset);

  const readyToAsk = stage === "build" && lines.length > 0 && reason.length > 0 && quote !== undefined && tenders.length > 0 && !quoting && !quoteProblem;
  const readyToGive = stage === "approve" && supervisorId !== null && pin.length === PIN_LENGTH && !record.isPending && !waiting;
  const readyToRetry = unsure && sent.current !== null && !record.isPending && !waiting;

  function choose(orderItemId: string, quantity: number) {
    setChosen((current) => ({ ...current, [orderItemId]: quantity }));
    setEditingSplit(false);
  }

  function onPinKey(key: KeypadKey) {
    if (unsure) return;
    if (key === "delete") setPin((current) => current.slice(0, -1));
    else if (key === "clear") setPin("");
    else if (/^\d$/.test(key)) setPin((current) => (current.length < PIN_LENGTH ? current + key : current));
  }

  function startSplit() {
    if (!base) return;
    setSplit(Object.fromEntries(base.tenders.map((tender) => [tender.paymentId, { text: majorText(tender.amountMinor), minor: tender.amountMinor }])));
    setEditingSplit(true);
  }

  function ask() {
    if (!readyToAsk) return;
    record.reset();
    setSupervisorId(null);
    setPin("");
    setStage("approve");
  }

  function backToItems() {
    if (record.isPending || unsure) return;
    record.reset();
    requestKey.forget();
    setSupervisorId(null);
    setPin("");
    setStage("build");
  }

  /** Yetu has the refund: what it gave, what to do with the money, and the slip. */
  function finish(refund: POSRefund) {
    setPin("");
    sent.current = null;
    setDone({ refund, print: { kind: "printing" } });
    setStage("done");
    onRefunded?.(refund);
    void processPendingPrintJobs(propertyId, refund.id).then(
      (results) => setDone((current) => (current ? { ...current, print: printOutcome(results) } : current)),
      () => setDone((current) => (current ? { ...current, print: { kind: "failed", words: "" } } : current)),
    );
  }

  function give() {
    if (!readyToGive || supervisorId === null) return;
    const body: POSRefundRequest = { reason, lines, tenders, supervisorStaffId: supervisorId, supervisorPin: pin };
    sent.current = { body, idempotencyKey: requestKey.keyFor(JSON.stringify({ reason, lines, tenders, supervisorId })) };
    send();
  }

  /**
   * Sends the frozen refund. After a lost answer this is Try again: the same body under the same key, so
   * Yetu gives the refund once -- replaying its first answer if it already gave it.
   */
  function send() {
    const request = sent.current;
    if (!request) return;
    record.mutate(
      { orderId: order.id, body: request.body, idempotencyKey: request.idempotencyKey },
      {
        onSuccess: finish,
        onError: (error) => {
          const refused = refundProblem(error);
          // A lost answer keeps the request frozen, body and key, for Try again.
          if (refused?.kind === "unsure") return;
          // A refused PIN counts toward the supervisor's lockout: never send it again.
          requestKey.forget();
          sent.current = null;
          setPin("");
          if (refused && CHANGED.has(refused.kind)) {
            // The order or drawer isn't as shown: what is left and Yetu's figures are asked for again.
            setStage("build");
            void refunds.refetch();
            void baseQuery.refetch();
          }
        },
      },
    );
  }

  const title = stage === "done" ? "Refund given" : `Refund items · ${orderName(order)}`;
  const description =
    stage === "build"
      ? "Choose what goes back. Yetu works out the money; a different person approves it."
      : stage === "approve"
        ? "A different person who may approve refunds enters their PIN."
        : undefined;

  const footer =
    stage === "build" ? (
      <div className="y-options__footer">
        <Button variant="quiet" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" size={64} icon={<ShieldCheck />} data-testid="refund-ask" disabled={!readyToAsk} onClick={ask}>
          Ask a supervisor
        </Button>
      </div>
    ) : stage === "approve" && unsure ? (
      <div className="y-options__footer">
        <Button variant="quiet" data-testid="refund-close" disabled={record.isPending} onClick={onClose}>
          Close
        </Button>
        <Button variant="danger" size={64} icon={<Undo2 />} data-testid="refund-retry" disabled={!readyToRetry} onClick={send}>
          {record.isPending ? "Trying again…" : "Try again"}
        </Button>
      </div>
    ) : stage === "approve" ? (
      <div className="y-options__footer">
        <Button variant="quiet" disabled={record.isPending} onClick={backToItems}>
          Back
        </Button>
        <Button variant="danger" size={64} icon={<Undo2 />} data-testid="refund-give" disabled={!readyToGive} onClick={give}>
          {record.isPending ? "Giving back…" : quote ? `Give back ${formatMoney(quote.totalMinor, currency)}` : "Give back"}
        </Button>
      </div>
    ) : (
      <div className="y-options__footer">
        <Button variant="primary" size={64} data-testid="refund-done" onClick={onClose}>
          Done
        </Button>
      </div>
    );

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !record.isPending) onClose();
      }}
      title={title}
      description={description}
      testId="refund-items"
      footer={footer}
    >
      {stage === "done" && done ? (
        <RefundDone refund={done.refund} print={done.print} currency={currency} />
      ) : refunds.isLoading ? (
        <div className="y-refund" aria-label="Loading what can be refunded" role="group">
          <Skeleton height={56} radius="card" />
          <Skeleton height={56} radius="card" />
        </div>
      ) : refunds.isError || !data ? (
        <Banner
          inline
          tone="danger"
          data-testid="refund-load-error"
          action={
            <Button size={48} onClick={() => void refunds.refetch()}>
              Try again
            </Button>
          }
        >
          What can be refunded couldn't be loaded. Check the connection, then try again.
        </Banner>
      ) : stage === "approve" ? (
        <div className="y-form">
          <SupervisorApproval
            request={`${summary} for ${itemsWords(lines, data)}: ${reason}`}
            supervisors={roster.map((entry) => ({ id: entry.staffNumber, name: entry.fullName }))}
            requesterId={requesterId}
            selectedId={supervisorId}
            onSelect={(id) => {
              if (unsure) return;
              setSupervisorId(id);
              setPin("");
            }}
            pinLength={pin.length}
            onPinKey={onPinKey}
            status={{ kind: "idle" }}
            onCancel={backToItems}
            actions="none"
            keyTestIdPrefix="refund-pin-key"
          />
          {problem ? <RefusalNotice refusal={problem} data-testid="refund-error" /> : null}
        </div>
      ) : (
        <div className="y-refund">
          {whole ? (
            <Banner inline tone="info" data-testid="refund-whole">
              This order was charged to a room, so it's refunded whole, in one go. To refund part of it, use the front desk.
            </Banner>
          ) : null}
          {problem ? <RefusalNotice refusal={problem} data-testid="refund-error" /> : null}

          <section className="y-detail__section" aria-labelledby="refund-items-heading">
            <h3 id="refund-items-heading" className="y-detail__heading">
              Items
            </h3>
            <ul className="y-refund__lines" data-testid="refund-lines">
              {data.lines.map((line) => {
                const quantity = quantities[line.orderItemId] ?? 0;
                const quoted = quote?.lines.find((item) => item.orderItemId === line.orderItemId);
                const left =
                  line.remainingQuantity === 0
                    ? "Refunded"
                    : line.refundedQuantity > 0
                      ? `${line.remainingQuantity} of ${line.quantity} left to refund`
                      : `${line.quantity} sold`;
                return (
                  <li key={line.orderItemId} className="y-refund__line" data-testid={`refund-line-${line.orderItemId}`}>
                    <span className="y-refund__name">{line.name}</span>
                    <span className="y-refund__left">{left}</span>
                    {line.remainingQuantity > 0 && !whole ? (
                      <Stepper label={line.name} value={quantity} max={line.remainingQuantity} onChange={(next) => choose(line.orderItemId, next)} />
                    ) : (
                      <span className="y-refund__fixed">{whole && line.remainingQuantity > 0 ? `${quantity}` : ""}</span>
                    )}
                    <span className="y-refund__amount">{quoted && quantity > 0 ? formatMoney(quoted.totalMinor, currency) : ""}</span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="y-detail__section" aria-labelledby="refund-reason-heading">
            <h3 id="refund-reason-heading" className="y-detail__heading">
              Why
            </h3>
            <div role="radiogroup" aria-labelledby="refund-reason-heading" className="y-refund__reasons">
              {[...REFUND_REASONS, OTHER_REASON].map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={reasonChoice === option}
                  className="y-refund__reason"
                  data-testid={option === OTHER_REASON ? "refund-reason-other" : `refund-reason-${REFUND_REASONS.indexOf(option)}`}
                  onClick={() => setReasonChoice(option)}
                >
                  {option === OTHER_REASON ? "Another reason" : option}
                </button>
              ))}
            </div>
            {reasonChoice === OTHER_REASON ? (
              <Field
                label="The reason"
                hint="Written on the refund slip and in the records."
                value={otherReason}
                onChange={setOtherReason}
                maxLength={500}
                autoComplete="off"
                data-testid="refund-reason-text"
              />
            ) : null}
          </section>

          {lines.length > 0 ? (
            <section className="y-detail__section y-refund__money" aria-labelledby="refund-money-heading" aria-busy={quoting}>
              <h3 id="refund-money-heading" className="y-detail__heading">
                Money back
              </h3>
              {quoteProblem ? (
                <RefusalNotice refusal={quoteProblem} data-testid="refund-quote-error" />
              ) : (
                <p className="y-refund__summary" role="status" data-testid="refund-summary">
                  {summary || (quoting || (editingSplit && typedAddsUp) ? "Working out the refund…" : "")}
                </p>
              )}
              {quote && quote.taxMinor > 0 ? (
                <p className="y-detail__line y-detail__muted">Includes VAT of {formatMoney(quote.taxMinor, currency)}</p>
              ) : null}
              {splittable && base ? (
                editingSplit ? (
                  <div className="y-refund__split" data-testid="refund-split">
                    {base.tenders.map((tender) => (
                      <MoneyField
                        key={tender.paymentId}
                        label={paymentMethodWords(tender.paymentMethod as SettlementMethod)}
                        currency={currency}
                        hint={`Up to ${formatMoney(tender.capMinor, currency)}`}
                        value={split[tender.paymentId]?.text ?? ""}
                        onValueChange={(text, minor) => setSplit((current) => ({ ...current, [tender.paymentId]: { text, minor } }))}
                        inputTestId={`refund-split-${tender.paymentMethod}`}
                      />
                    ))}
                    {typedTotal !== null && !typedAddsUp ? (
                      <p className="y-field__error" data-testid="refund-split-total">
                        Adds up to {formatMoney(typedTotal, currency)} of {formatMoney(base.totalMinor, currency)}.
                      </p>
                    ) : null}
                    <Button variant="quiet" onClick={() => setEditingSplit(false)}>
                      Use Yetu's split
                    </Button>
                  </div>
                ) : (
                  <Button variant="secondary" data-testid="refund-change-split" onClick={startSplit}>
                    Change how it goes back
                  </Button>
                )
              ) : null}
            </section>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}

function RefundDone({ refund, print, currency }: { refund: POSRefund; print: PrintState; currency: string }) {
  const words = refundDoneWords(refund.totalMinor, refund.tenders, refund.currency || currency);
  return (
    <div className="y-refund__done" data-testid="refund-done-view">
      <CircleCheck className="y-refund__tick" aria-hidden="true" />
      <p className="y-refund__done-title" role="status">
        {words.title}
      </p>
      <ul className="y-refund__done-lines">
        {words.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="y-detail__line y-detail__muted" data-testid="refund-print">
        {print.kind === "printing"
          ? "Printing the refund slip…"
          : print.kind === "printed"
            ? "The refund slip was printed."
            : `The refund slip didn't print${print.words ? ` (${print.words})` : ""}. The refund is recorded.`}
      </p>
    </div>
  );
}
