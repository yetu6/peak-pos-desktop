import { useState } from "react";
import { supervisorChoice, useApprovers } from "../approvals/supervisors";
import type { POSApprover } from "../lib/posContracts";
import { PIN_LENGTH } from "../access/accessSettings";
import { useDeviceSessionOptional } from "../auth/DeviceSessionProvider";
import { CASH_IN_REASONS, CASH_OUT_REASONS } from "../cash/cashSettings";
import { useTillReasons } from "../fnb/useTillReasons";
import { cashMovementProblem } from "../cash/cashWords";
import { useIdempotencyKey, useRecordCashMovement } from "../hooks/usePosData";
import { formatMoney } from "../lib/money";
import { useHoldIdleLock } from "../lib/useHoldIdleLock";
import { useRateLimitWait } from "../lib/useRateLimitWait";
import type { RosterEntry } from "../lib/deviceAuth";
import type { CashMoneyType } from "../lib/posContracts";
import { toMinor } from "../lib/posMoney";
import { Button, MoneyField, ReasonPicker, RefusalNotice, SegmentedControl, Sheet, SupervisorApproval, type KeypadKey } from "./system";

/** Cash in / Cash out against the open shift. Append-only: there is no edit
 *  or delete on `POSCashMovement` in the certified contract, and none is
 *  offered here — a mistake is corrected with an offsetting movement.
 *
 *  Cash out needs a DIFFERENT supervisor's own PIN, as the server requires:
 *  without it, whoever held the till could take cash out "for petty cash" and
 *  the drawer would still balance at close (money audit, 2026-10-06). */
export function CashMovementDialog({
  shiftId,
  onClose,
  onRecorded,
  currency,
  initialType = "CASH_IN",
}: {
  shiftId: string;
  onClose: () => void;
  /** Yetu recorded the cash: the page opens the drawer for it (2026-10-21). */
  onRecorded?: () => void;
  currency?: string;
  initialType?: CashMoneyType;
}) {
  const device = useDeviceSessionOptional();
  const record = useRecordCashMovement(shiftId);
  const idempotencyKey = useIdempotencyKey();
  // The till doesn't lock itself while the movement is with Yetu.
  useHoldIdleLock(record.isPending);
  // After "too many attempts" the next one waits for Yetu's Retry-After.
  const waiting = useRateLimitWait(record.error, record.reset);
  return (
    <CashMovementSheetView
      onClose={onClose}
      currency={currency}
      initialType={initialType}
      roster={device?.roster ?? []}
      approvers={useApprovers()}
      requesterId={device?.session?.staffId ?? ""}
      pending={record.isPending}
      waiting={waiting}
      error={record.error}
      errorMovementType={record.variables?.movementType}
      inReasons={useTillReasons("cashIn")}
      outReasons={useTillReasons("cashOut")}
      onRecord={(args) =>
        record.mutate({ ...args, idempotencyKey: idempotencyKey.next() }, {
          onSuccess: () => {
            onClose();
            onRecorded?.();
          },
        })
      }
    />
  );
}

export interface CashMovementSheetViewProps {
  onClose: () => void;
  currency?: string;
  initialType?: CashMoneyType;
  roster: readonly RosterEntry[];
  /** F-249: Yetu's approvers here; null until it answers, and then everyone is offered. */
  approvers?: readonly POSApprover[] | null;
  requesterId: string;
  pending: boolean;
  /** Yetu asked the till to wait before the next attempt (too many attempts). */
  waiting?: boolean;
  error: unknown;
  /** Which way the refused request went: its refusal is worded for it, whatever the sheet shows now. */
  errorMovementType?: CashMoneyType;
  onRecord: (args: {
    movementType: CashMoneyType;
    amountMinor: number;
    reason: string;
    supervisorStaffId?: string;
    supervisorPin?: string;
  }) => void;
  /** The outlet's reasons for cash in and cash out (useTillReasons); the till's own lists by default. */
  inReasons?: readonly string[];
  outReasons?: readonly string[];
  /** Fixtures start part-way through. */
  initialAmount?: string;
  initialReason?: string;
}

export function CashMovementSheetView({
  onClose,
  currency,
  initialType = "CASH_IN",
  roster,
  approvers = null,
  requesterId,
  pending,
  waiting = false,
  error,
  errorMovementType,
  onRecord,
  inReasons = CASH_IN_REASONS,
  outReasons = CASH_OUT_REASONS,
  initialAmount = "",
  initialReason = "",
}: CashMovementSheetViewProps) {
  const [movementType, setMovementType] = useState<CashMoneyType>(initialType);
  const [amount, setAmount] = useState(initialAmount);
  const [reason, setReason] = useState(initialReason);
  const [supervisorId, setSupervisorId] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const problem = cashMovementProblem(error, errorMovementType ?? movementType);
  const amountMinor = toMinor(amount);
  const cashOut = movementType === "CASH_OUT";
  const cashOutChoice = supervisorChoice(roster, approvers, "CASH_OUT");
  // Choosing yourself keeps the PIN keypad closed (SupervisorApproval), and choosing anyone clears the PIN,
  // so a full PIN always belongs to someone else; the backend refuses self-approval as well.
  const supervisor = supervisorId;
  const supervised = !cashOut || (Boolean(supervisor) && pin.length === PIN_LENGTH);
  const canSubmit = amountMinor != null && amountMinor > 0 && reason.trim().length > 0 && supervised && !pending && !waiting;

  /** A cash-out approval is for one amount, reason and direction: changing any of them asks again. */
  function clearApproval() {
    setSupervisorId(null);
    setPin("");
  }

  function onPinKey(key: KeypadKey) {
    if (key === "delete") setPin((value) => value.slice(0, -1));
    else if (key === "clear") setPin("");
    else if (/^\d$/.test(key)) setPin((value) => (value.length < PIN_LENGTH ? value + key : value));
  }

  function submit(): void {
    if (amountMinor == null || !canSubmit) return;
    onRecord({
      movementType,
      amountMinor,
      reason: reason.trim(),
      ...(cashOut && supervisor ? { supervisorStaffId: supervisor, supervisorPin: pin } : {}),
    });
  }

  const amountWords = amountMinor && amountMinor > 0 ? formatMoney(amountMinor, currency) : null;
  const request =
    amountWords && reason.trim() ? `Take ${amountWords} out of the drawer: ${reason.trim()}` : "Take cash out of the drawer";

  return (
    <Sheet
      open
      // While Yetu is recording it, Escape, Close and a tap outside do nothing.
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
      title={cashOut ? "Cash out" : "Cash in"}
      description={
        cashOut ? "Cash leaves the drawer. A different supervisor approves with their PIN." : "Cash goes into the drawer."
      }
      testId="cash-movement-dialog"
      footer={
        <div className="y-cash__footer">
          <Button variant="quiet" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size={56} data-testid="confirm-movement" disabled={!canSubmit} onClick={submit}>
            {pending ? "Recording…" : cashOut ? "Take cash out" : "Record cash in"}
          </Button>
        </div>
      }
    >
      <div className="y-form">
        <SegmentedControl
          label="Cash in or cash out"
          value={movementType}
          onChange={(type) => {
            setMovementType(type);
            // Cash in and cash out have their own reasons.
            if (type !== movementType) setReason("");
            clearApproval();
          }}
          options={[
            { value: "CASH_IN", label: "Cash in" },
            { value: "CASH_OUT", label: "Cash out" },
          ]}
          testIdPrefix="movement-type"
        />
        <MoneyField
          label="Amount"
          currency={currency}
          value={amount}
          onValueChange={(text) => {
            setAmount(text);
            clearApproval();
          }}
          inputTestId="movement-amount"
          autoFocus
        />
        <ReasonPicker
          key={movementType}
          label={cashOut ? "What the cash is for" : "Where the cash came from"}
          reasons={cashOut ? outReasons : inReasons}
          initialReason={reason}
          onChange={(chosen) => {
            setReason(chosen);
            clearApproval();
          }}
          otherHint="Written in the shift's cash record."
          testIdPrefix="movement-reason"
        />
        {cashOut ? (
          <SupervisorApproval
            request={request}
            supervisors={cashOutChoice.supervisors}
            emptyWords={cashOutChoice.emptyWords}
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
            keyTestIdPrefix="movement-pin-key"
          />
        ) : null}
        {problem ? (
          <div data-testid="movement-error">
            <RefusalNotice refusal={problem} />
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
