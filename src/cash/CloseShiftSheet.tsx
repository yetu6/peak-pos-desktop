import { useState } from "react";
import { PIN_LENGTH } from "../access/accessSettings";
import { Banner, Button, Money, MoneyField, Sheet, SupervisorApproval, type KeypadKey } from "../components/system";
import { useIdempotencyKey, usePosShift } from "../hooks/usePosData";
import type { RosterEntry } from "../lib/deviceAuth";
import { formatMoney } from "../lib/money";
import type { POSShift } from "../lib/posContracts";
import { toMinor } from "../lib/posMoney";
import { closeShiftProblem, countOutcome } from "./cashWords";
import { rememberClosedShift } from "./closedShift";
import { NoteCounterSheet, denominationsFor, moneyFieldText } from "./NoteCounterSheet";

const OUTCOME = {
  balanced: { tone: "success", words: "Balanced. The drawer matches what Yetu expects." },
  over: { tone: "warning", words: "Over. You counted more than Yetu expects." },
  short: { tone: "warning", words: "Short. You counted less than Yetu expects." },
} as const;

/**
 * Close the shift in three steps. Count: blind, the expected figure is not on
 * screen until a count is entered. Check: Yetu's expected figure against the
 * count, Balanced, Over or Short; when they differ a different manager
 * approves with their PIN, as the backend requires (CloseShift: any variance
 * needs pos.report.manager from someone else). Done: closing takes the till
 * to Open shift, which shows the result Yetu returned.
 */
export function CloseShiftSheet(props: Omit<CloseShiftSheetViewProps, "onClose">) {
  const { close } = usePosShift();
  const closeKey = useIdempotencyKey();
  return (
    <CloseShiftSheetView
      {...props}
      onClose={(args) => close.mutateAsync({ ...args, idempotencyKey: closeKey.next() })}
    />
  );
}

export interface CloseShiftSheetViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shift: POSShift;
  currency: string | undefined;
  requesterId: string;
  roster: readonly RosterEntry[];
  /** Closes the shift with Yetu and returns the closed shift it sends back. */
  onClose: (args: { countedCashMinor: number; supervisorStaffId?: string; supervisorPin?: string }) => Promise<POSShift>;
  /** Fixtures start part-way through. */
  initialCounted?: string;
  initialStep?: "count" | "check";
}

export function CloseShiftSheetView({
  open,
  onOpenChange,
  shift,
  currency,
  requesterId,
  roster,
  onClose,
  initialCounted = "",
  initialStep = "count",
}: CloseShiftSheetViewProps) {
  const [step, setStep] = useState<"count" | "check">(initialStep);
  const [counted, setCounted] = useState(initialCounted);
  const [noteCounter, setNoteCounter] = useState(false);
  const [supervisorId, setSupervisorId] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [yetuFoundDifference, setYetuFoundDifference] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const countedMinor = toMinor(counted);
  const outcome = countedMinor === null ? null : countOutcome(countedMinor, shift.expectedCashMinor);
  const needsSupervisor = outcome !== "balanced" || yetuFoundDifference;
  // Choosing yourself keeps the PIN keypad closed (SupervisorApproval), and choosing anyone clears the PIN,
  // so a full PIN always belongs to someone else; the backend refuses self-approval as well.
  const supervisor = supervisorId;
  const approved = Boolean(supervisor) && pin.length === PIN_LENGTH;
  const ready = countedMinor !== null && (!needsSupervisor || approved) && !pending;

  function onPinKey(key: KeypadKey) {
    if (key === "delete") setPin((value) => value.slice(0, -1));
    else if (key === "clear") setPin("");
    else if (/^\d$/.test(key)) setPin((value) => (value.length < PIN_LENGTH ? value + key : value));
  }

  async function submit() {
    if (!ready || countedMinor === null) return;
    setPending(true);
    setProblem(null);
    try {
      const result = await onClose({
        countedCashMinor: countedMinor,
        ...(needsSupervisor && supervisor ? { supervisorStaffId: supervisor, supervisorPin: pin } : {}),
      });
      rememberClosedShift({ shift: result, currency, at: new Date() });
      onOpenChange(false);
    } catch (error) {
      const refusal = closeShiftProblem(error);
      if (refusal?.kind === "supervisor") setYetuFoundDifference(true);
      setPin("");
      setProblem(refusal?.words ?? "The shift couldn't be closed. Try again.");
    } finally {
      setPending(false);
    }
  }

  const steps = (
    <ol className="y-steps-inline" aria-label="Steps">
      <li aria-current={step === "count" ? "step" : undefined}>1 Count</li>
      <li aria-current={step === "check" ? "step" : undefined}>2 Check</li>
      <li>3 Done</li>
    </ol>
  );

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
        title="Close the shift"
        footer={
          step === "count" ? (
            <div className="y-cash__footer">
              <Button variant="quiet" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button variant="primary" size={56} disabled={countedMinor === null} onClick={() => setStep("check")}>
                Check the count
              </Button>
            </div>
          ) : (
            <div className="y-cash__footer">
              <Button variant="quiet" onClick={() => setStep("count")}>
                Change the count
              </Button>
              <Button variant="primary" size={64} data-testid="close-shift" disabled={!ready} onClick={() => void submit()}>
                {pending ? "Closing…" : "Close shift"}
              </Button>
            </div>
          )
        }
      >
        {steps}
        {step === "count" ? (
          <div className="y-form" data-testid="close-step-count">
            <h3 className="y-cash__step-title">Count the cash in the drawer</h3>
            <p className="y-cash__muted">Count every note and coin. Yetu shows its own figure after you count.</p>
            <MoneyField
              label="Cash counted"
              currency={currency}
              value={counted}
              onValueChange={(text) => setCounted(text)}
              inputTestId="counted-cash"
              autoFocus
            />
            {denominationsFor(currency).length > 0 ? (
              <Button variant="secondary" onClick={() => setNoteCounter(true)}>
                Count note by note
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="y-form" data-testid="close-step-check">
            <dl className="y-cash__figures">
              <div>
                <dt>Expected in the drawer</dt>
                <dd data-testid="close-expected">
                  <Money minor={shift.expectedCashMinor} currency={currency} size="heading" />
                </dd>
              </div>
              <div>
                <dt>You counted</dt>
                <dd data-testid="close-counted">
                  <Money minor={countedMinor} currency={currency} size="heading" />
                </dd>
              </div>
            </dl>
            {outcome ? (
              <div data-testid="close-outcome">
                <Banner tone={OUTCOME[outcome].tone}>{OUTCOME[outcome].words}</Banner>
              </div>
            ) : null}
            {needsSupervisor ? (
              <SupervisorApproval
                request={`Close the shift with ${formatMoney(countedMinor, currency)} counted. Yetu expects ${formatMoney(shift.expectedCashMinor, currency)}.`}
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
                onCancel={() => onOpenChange(false)}
                actions="none"
                keyTestIdPrefix="close-pin-key"
              />
            ) : null}
            {problem ? (
              <p key={problem + String(pending)} className="y-pin__message" role="alert" data-testid="close-shift-error">
                {problem}
              </p>
            ) : null}
          </div>
        )}
      </Sheet>
      {currency ? (
        <NoteCounterSheet
          open={noteCounter}
          onOpenChange={setNoteCounter}
          currency={currency}
          onUse={(minor) => setCounted(moneyFieldText(minor))}
        />
      ) : null}
    </>
  );
}
