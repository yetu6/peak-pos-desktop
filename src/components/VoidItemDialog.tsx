import { useState } from "react";
import { useSupervisors } from "../approvals/supervisors";
import { PIN_LENGTH } from "../access/accessSettings";
import { useDeviceSessionOptional } from "../auth/DeviceSessionProvider";
import { useIdempotencyKey, usePrintAfter, usePropertyId, useVoidItem } from "../hooks/usePosData";
import { printProblemOnce } from "../print/printProblems";
import { formatMoney } from "../lib/money";
import { useHoldIdleLock } from "../lib/useHoldIdleLock";
import { useRateLimitWait } from "../lib/useRateLimitWait";
import type { POSOrder, POSOrderItem } from "../lib/posContracts";
import { itemVoidedWords, voidItemProblem, voidItemSheetWords } from "../register/registerWords";
import { Banner, Button, ReasonPicker, Sheet, Stepper, SupervisorApproval, type KeypadKey } from "./system";
import { orderNumberWords } from "../lib/orderNumber";
import { useTillReasons } from "../fnb/useTillReasons";

/**
 * `POST /pos/orders/{orderId}/items/{itemId}/void` (fbc-peak 00125): some or
 * all of a line already sent to the kitchen comes off, with a reason and a
 * DIFFERENT supervisor's own PIN (the owner, 2026-10-21). Yetu tells the
 * station making it. It is a void, never a refund: no money moves, and once
 * the bill is part paid an item is refunded after payment instead. The
 * approval is for one item, one quantity and one reason: changing any asks
 * again.
 */
export function VoidItemDialog({
  order,
  line,
  currency,
  onClose,
  onVoided,
  onStale,
  onPrintProblem,
}: {
  order: POSOrder;
  line: POSOrderItem;
  /** The currency the backend returned; without it the request says no amount. */
  currency?: string;
  onClose: () => void;
  /** Yetu's order with the item voided, and what to say. */
  onVoided: (order: POSOrder, words: string) => void;
  /** Yetu says the order changed on another till: ask for it again. */
  onStale?: () => void;
  /** The void slip for the kitchen didn't print: what to say. */
  onPrintProblem?: (words: string) => void;
}) {
  const device = useDeviceSessionOptional();
  const { supervisors, emptyWords } = useSupervisors("VOID");
  const requesterId = device?.session?.staffId ?? "";
  const voidItem = useVoidItem();
  const printAfter = usePrintAfter(usePropertyId());
  const reasons = useTillReasons("void");
  const idempotencyKey = useIdempotencyKey();
  const [quantity, setQuantity] = useState(line.quantity);
  const [reason, setReason] = useState("");
  const [supervisorId, setSupervisorId] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  // An approval is for the order as it was: when it changes (a new version) the supervisor is asked again.
  const [approvedVersion, setApprovedVersion] = useState(order.version);
  if (order.version !== approvedVersion) {
    setApprovedVersion(order.version);
    setSupervisorId(null);
    setPin("");
  }
  // The line came down on another till: never offer more than it holds now.
  if (quantity > line.quantity) setQuantity(line.quantity);
  const problem = voidItemProblem(voidItem.error);
  useHoldIdleLock(voidItem.isPending);
  const waiting = useRateLimitWait(voidItem.error, voidItem.reset);
  const ready = reason.trim().length > 0 && supervisorId !== null && pin.length === PIN_LENGTH && !voidItem.isPending && !waiting;
  const all = quantity === line.quantity;
  const what = `${quantity} × ${line.name}`;

  function askAgain() {
    setSupervisorId(null);
    setPin("");
  }

  function onPinKey(key: KeypadKey) {
    if (key === "delete") setPin((current) => current.slice(0, -1));
    else if (key === "clear") setPin("");
    else if (/^\d$/.test(key)) setPin((current) => (current.length < PIN_LENGTH ? current + key : current));
  }

  function submit() {
    if (!ready || supervisorId === null) return;
    voidItem.mutate(
      {
        orderId: order.id,
        itemId: line.id,
        quantity,
        reason: reason.trim(),
        supervisorStaffId: supervisorId,
        supervisorPin: pin,
        version: order.version,
        idempotencyKey: idempotencyKey.next(),
      },
      {
        onSuccess: (fresh) => {
          onVoided(fresh, itemVoidedWords(quantity, line.name, line.prepStation));
          // The slip for the station making it prints on its own time.
          void printAfter(order.id).then((results) => {
            const words = printProblemOnce(results, "void slip");
            if (words) onPrintProblem?.(words);
          });
          onClose();
        },
        // A refused PIN counts toward the supervisor's lockout: never send it again.
        onError: (error) => {
          setPin("");
          if (voidItemProblem(error)?.kind === "stale") onStale?.();
        },
      },
    );
  }

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !voidItem.isPending) onClose();
      }}
      title={`Void ${line.name}`}
      description={voidItemSheetWords(line.prepStation)}
      testId="void-item-dialog"
      footer={
        <div className="y-options__footer">
          <Button variant="quiet" disabled={voidItem.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" size={56} data-testid="confirm-void-item" disabled={!ready} onClick={submit}>
            {voidItem.isPending ? "Voiding…" : `Void ${what}`}
          </Button>
        </div>
      }
    >
      <div className="y-form">
        {line.quantity > 1 ? (
          <div className="y-field" data-testid="void-item-quantity">
            <span className="y-field__label">How many to void</span>
            <span className="y-field__hint">The order has {line.quantity}. The rest stay on it.</span>
            <Stepper
              label={line.name}
              value={quantity}
              min={1}
              max={line.quantity}
              disabled={voidItem.isPending}
              onChange={(next) => {
                setQuantity(next);
                askAgain();
              }}
            />
          </div>
        ) : null}
        <ReasonPicker
          label="Reason"
          reasons={reasons}
          onChange={(chosen) => {
            setReason(chosen);
            askAgain();
          }}
          otherHint="Written in the order's history."
          testIdPrefix="void-item-reason"
        />
        <SupervisorApproval
          request={`Void ${what} on order ${orderNumberWords(order)}${all && currency ? ` (${formatMoney(line.totalMinor, currency)})` : ""}${reason.trim() ? `: ${reason.trim()}` : ""}`}
          supervisors={supervisors}
          emptyWords={emptyWords}
          requesterId={requesterId}
          selectedId={supervisorId}
          onSelect={(id) => {
            setSupervisorId(id);
            setPin("");
          }}
          pinLength={pin.length}
          onPinKey={onPinKey}
          status={{ kind: "idle" }}
          onCancel={onClose}
          actions="none"
          keyTestIdPrefix="void-item-pin-key"
        />
        {problem ? <Banner inline tone="danger">{problem.words}</Banner> : null}
      </div>
    </Sheet>
  );
}
