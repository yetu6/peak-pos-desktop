import { BACK_WORDS } from "../lib/words";
import { useState } from "react";
import { useSupervisors } from "../approvals/supervisors";
import { PIN_LENGTH } from "../access/accessSettings";
import { useDeviceSessionOptional } from "../auth/DeviceSessionProvider";
import { useApplyDiscount, useIdempotencyKey } from "../hooks/usePosData";
import { formatMoney } from "../lib/money";
import { useHoldIdleLock } from "../lib/useHoldIdleLock";
import { useRateLimitWait } from "../lib/useRateLimitWait";
import type { DiscountKind, POSOrder } from "../lib/posContracts";
import { toMinor } from "../lib/posMoney";
import { discountProblem } from "../register/registerWords";
import { Banner, Button, Field, MoneyField, ReasonPicker, SegmentedControl, Sheet, SupervisorApproval, type KeypadKey } from "./system";
import { orderNumberWords } from "../lib/orderNumber";
import { useTillReasons } from "../fnb/useTillReasons";

/**
 * A percentage as Yetu takes it: basis points (12.5% → 1250), from more than
 * 0 up to 100%, to two decimals at most so what is sent is exactly what was
 * typed (no rounding).
 */
function percentBasisPoints(text: string): number | null {
  const typed = text.trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(typed)) return null;
  const value = Number(typed);
  if (value <= 0 || value > 100) return null;
  return Math.round(value * 100);
}

/**
 * A discount on the order, approved by a different supervisor with their
 * PIN. Yetu applies it to the subtotal before VAT (to what the guest pays
 * when the prices include VAT, F-229) and works out the new figures. The discount stays when lines are added or taken
 * off (the owner, 2026-10-20): a percent applies to the bill as it grows, an amount stays the same money. Yetu refuses it
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
  const { supervisors, emptyWords } = useSupervisors("DISCOUNT");
  const requesterId = device?.session?.staffId ?? "";
  const applyDiscount = useApplyDiscount();
  const reasons = useTillReasons("discount");
  const idempotencyKey = useIdempotencyKey();
  const [kind, setKind] = useState<DiscountKind>("AMOUNT");
  const [valueText, setValueText] = useState("");
  const [reason, setReason] = useState("");
  const [supervisorId, setSupervisorId] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const problem = discountProblem(applyDiscount.error);
  // The till doesn't lock itself while the discount is with Yetu.
  useHoldIdleLock(applyDiscount.isPending);
  // After "too many attempts" the next one waits for Yetu's Retry-After.
  const waiting = useRateLimitWait(applyDiscount.error, applyDiscount.reset);

  const value = kind === "AMOUNT" ? toMinor(valueText) : percentBasisPoints(valueText);
  const valueWords =
    value != null && value > 0 ? (kind === "AMOUNT" ? formatMoney(value, currency) : `${Number(valueText.trim())}%`) : null;
  const ready =
    value != null && value > 0 && reason.trim().length > 0 && supervisorId !== null && pin.length === PIN_LENGTH && !applyDiscount.isPending && !waiting;

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
      // F-229: with VAT inside the prices it comes off what the guest pays; with VAT on top, off the price before VAT.
      description={`On order ${orderNumberWords(order)}, ${order.pricesIncludeTax ? "off what the guest pays" : "before VAT"}. A different supervisor approves with their PIN.`}
      testId="discount-dialog"
      footer={
        <div className="y-options__footer">
          <Button variant="quiet" disabled={applyDiscount.isPending} onClick={onClose}>
            {BACK_WORDS}
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
            hint="Up to two decimals, for example 12.5."
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
        <ReasonPicker
          label="Reason"
          reasons={reasons}
          onChange={(chosen) => {
            setReason(chosen);
            clearApproval();
          }}
          otherHint="Written in the order's history."
          testIdPrefix="discount-reason"
        />
        <SupervisorApproval
          request={
            valueWords && reason.trim()
              ? `Take ${valueWords} off order ${orderNumberWords(order)}: ${reason.trim()}`
              : `A discount on order ${orderNumberWords(order)}`
          }
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
