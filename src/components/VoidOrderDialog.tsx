import { useState } from "react";
import { PIN_LENGTH } from "../access/accessSettings";
import { useDeviceSessionOptional } from "../auth/DeviceSessionProvider";
import { useIdempotencyKey, useVoidOrder } from "../hooks/usePosData";
import { formatMoney } from "../lib/money";
import { useHoldIdleLock } from "../lib/useHoldIdleLock";
import { useRateLimitWait } from "../lib/useRateLimitWait";
import type { POSOrder } from "../lib/posContracts";
import { voidProblem } from "../register/registerWords";
import { Banner, Button, Field, Sheet, SupervisorApproval, type KeypadKey } from "./system";
import { orderNumberWords } from "../lib/orderNumber";

/**
 * `POST /pos/orders/{orderId}/void`: the one certified correction for a sent
 * order. It needs a DIFFERENT supervisor's own PIN (`pos.order.void`); Yetu
 * records who asked and who approved. It is a void, never a refund: no money
 * moves, and a part-paid order can't be voided. The approval is for one
 * reason: changing it asks again.
 */
export function VoidOrderDialog({
  order,
  currency,
  onClose,
  onVoided,
  onStale,
}: {
  order: POSOrder;
  /** The currency the backend returned; without it the request says no amount. */
  currency?: string;
  onClose: () => void;
  /** Called once Yetu has voided the order, before the sheet closes. */
  onVoided?: () => void;
  /** Yetu says the order changed on another till: ask for it again. */
  onStale?: () => void;
}) {
  const device = useDeviceSessionOptional();
  const roster = device?.roster ?? [];
  const requesterId = device?.session?.staffId ?? "";
  const voidOrder = useVoidOrder();
  const idempotencyKey = useIdempotencyKey();
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
  const problem = voidProblem(voidOrder.error);
  // The till doesn't lock itself while the void is with Yetu.
  useHoldIdleLock(voidOrder.isPending);
  // After "too many attempts" the next one waits for Yetu's Retry-After.
  const waiting = useRateLimitWait(voidOrder.error, voidOrder.reset);
  const ready = reason.trim().length > 0 && supervisorId !== null && pin.length === PIN_LENGTH && !voidOrder.isPending && !waiting;

  function onPinKey(key: KeypadKey) {
    if (key === "delete") setPin((current) => current.slice(0, -1));
    else if (key === "clear") setPin("");
    else if (/^\d$/.test(key)) setPin((current) => (current.length < PIN_LENGTH ? current + key : current));
  }

  function submit() {
    if (!ready || supervisorId === null) return;
    voidOrder.mutate(
      {
        orderId: order.id,
        reason: reason.trim(),
        supervisorStaffId: supervisorId,
        supervisorPin: pin,
        version: order.version,
        idempotencyKey: idempotencyKey.next(),
      },
      {
        onSuccess: () => {
          onVoided?.();
          onClose();
        },
        // A refused PIN counts toward the supervisor's lockout: never send it again.
        onError: (error) => {
          setPin("");
          if (voidProblem(error)?.kind === "stale") onStale?.();
        },
      },
    );
  }

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !voidOrder.isPending) onClose();
      }}
      title="Void the order"
      description="Takes the whole order off and tells the kitchen. This is not a refund: no money moves."
      testId="void-order-dialog"
      footer={
        <div className="y-options__footer">
          <Button variant="quiet" disabled={voidOrder.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" size={56} data-testid="confirm-void-order" disabled={!ready} onClick={submit}>
            {voidOrder.isPending ? "Voiding…" : "Void order"}
          </Button>
        </div>
      }
    >
      <div className="y-form">
        <Field
          label="Reason"
          hint="For example, the wrong table or a guest who left."
          value={reason}
          onChange={(text) => {
            setReason(text);
            setSupervisorId(null);
            setPin("");
          }}
          autoComplete="off"
          data-testid="void-reason"
        />
        <SupervisorApproval
          request={
            reason.trim()
              ? `Void order ${orderNumberWords(order)}${currency ? ` (${formatMoney(order.totalMinor, currency)})` : ""}: ${reason.trim()}`
              : `Void order ${orderNumberWords(order)}`
          }
          supervisors={roster.map((entry) => ({ id: entry.staffNumber, name: entry.fullName }))}
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
          keyTestIdPrefix="void-pin-key"
        />
        {problem ? <Banner inline tone="danger">{problem.words}</Banner> : null}
      </div>
    </Sheet>
  );
}
