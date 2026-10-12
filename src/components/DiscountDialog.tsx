import { useState } from "react";
import { PIN_LENGTH } from "../access/accessSettings";
import { useDeviceSessionOptional } from "../auth/DeviceSessionProvider";
import { useApplyDiscount, useIdempotencyKey } from "../hooks/usePosData";
import { formatMoney } from "../lib/money";
import type { DiscountKind, POSOrder } from "../lib/posContracts";
import { toMinor } from "../lib/posMoney";
import { discountProblem } from "../register/registerWords";
import { Banner, Button, Field, MoneyField, SegmentedControl, Sheet, SupervisorApproval, type KeypadKey } from "./system";

/** A percentage as Yetu takes it: basis points (12.5% → 1250), from more than 0 up to 100%. */
function percentBasisPoints(text: string): number | null {
  const value = Number(text.trim());
  if (!text.trim() || !Number.isFinite(value) || value <= 0 || value > 100) return null;
  return Math.round(value * 100);
}

/**
 * A discount on the order, approved by a different supervisor with their
 * PIN. Yetu applies it to the subtotal before VAT and works out the new
 * figures; it clears it when a line is added or removed, and refuses it
 * once part of the bill is paid. The approval is for one amount, kind and
 * reason: changing any of them asks again.
 */
export function DiscountDialog({
  order,
  currency,
  onClose,
  onApplied,
}: {
  order: POSOrder;
  currency: string;
  onClose: () => void;
  onApplied: (order: POSOrder) => void;
}) {
  const device = useDeviceSessionOptional();
  const roster = device?.roster ?? [];
  const requesterId = device?.session?.staffId ?? "";
  const applyDiscount = useApplyDiscount();
  const idempotencyKey = useIdempotencyKey();
  const [kind, setKind] = useState<DiscountKind>("AMOUNT");
  const [valueText, setValueText] = useState("");
  const [reason, setReason] = useState("");
  const [supervisorId, setSupervisorId] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const problem = discountProblem(applyDiscount.error);

  const value = kind === "AMOUNT" ? toMinor(valueText) : percentBasisPoints(valueText);
  const valueWords =
    value != null && value > 0 ? (kind === "AMOUNT" ? formatMoney(value, currency) : `${Number(valueText.trim())}%`) : null;
  const ready =
    value != null && value > 0 && reason.trim().length > 0 && supervisorId !== null && pin.length === PIN_LENGTH && !applyDiscount.isPending;

  function clearApproval() {
    setSupervisorId(null);
    setPin("");
  }

  function onPinKey(key: KeypadKey) {
    if (key === "delete") setPin((current) => current.slice(0, -1));
    else if (key === "clear") setPin("");
    else if (/^\d$/.test(key)) setPin((current) => (current.length < PIN_LENGTH ? current + key : current));
  }

  function submit() {
    if (!ready || value == null || supervisorId === null) return;
    applyDiscount.mutate(
      {
        orderId: order.id,
        kind,
        value,
        reason: reason.trim(),
        supervisorStaffId: supervisorId,
        supervisorPin: pin,
        version: order.version,
        idempotencyKey: idempotencyKey.next(),
      },
      {
        onSuccess: (updated) => {
          onApplied(updated);
          onClose();
        },
        // A refused PIN counts toward the supervisor's lockout: never send it again.
        onError: () => setPin(""),
      },
    );
  }

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !applyDiscount.isPending) onClose();
      }}
      title="Discount"
      description={`On order ${order.orderNumber}, before VAT. A different supervisor approves with their PIN.`}
      testId="discount-dialog"
      footer={
        <div className="y-options__footer">
          <Button variant="quiet" disabled={applyDiscount.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size={56} data-testid="confirm-discount" disabled={!ready} onClick={submit}>
            {applyDiscount.isPending ? "Applying…" : "Apply discount"}
          </Button>
        </div>
      }
    >
      <div className="y-form">
        <SegmentedControl
          label="Discount by"
          value={kind}
          onChange={(next) => {
            setKind(next);
            setValueText("");
            clearApproval();
          }}
          options={[
            { value: "AMOUNT", label: "Amount" },
            { value: "PERCENT", label: "Percent" },
          ]}
        />
        {kind === "AMOUNT" ? (
          <MoneyField
            label="Amount off"
            currency={currency}
            value={valueText}
            onValueChange={(text) => {
              setValueText(text);
              clearApproval();
            }}
            inputTestId="discount-value"
          />
        ) : (
          <Field
            label="Percent off"
            hint="From more than 0 up to 100."
            value={valueText}
            onChange={(text) => {
              setValueText(text);
              clearApproval();
            }}
            inputMode="decimal"
            autoComplete="off"
            data-testid="discount-value"
          />
        )}
        <Field
          label="Reason"
          hint="For example, a regular guest or a staff meal."
          value={reason}
          onChange={(text) => {
            setReason(text);
            clearApproval();
          }}
          autoComplete="off"
          data-testid="discount-reason"
        />
        <SupervisorApproval
          request={
            valueWords && reason.trim()
              ? `Take ${valueWords} off order ${order.orderNumber}: ${reason.trim()}`
              : `A discount on order ${order.orderNumber}`
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
          keyTestIdPrefix="discount-pin-key"
        />
        {problem ? (
          <Banner inline tone="danger" data-testid="discount-error">
            {problem.words}
          </Banner>
        ) : null}
      </div>
    </Sheet>
  );
}
