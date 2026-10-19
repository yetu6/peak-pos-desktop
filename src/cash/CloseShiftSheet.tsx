import { useQueryClient } from "@tanstack/react-query";
import { supervisorChoice, useApprovers } from "../approvals/supervisors";
import type { POSApprover } from "../lib/posContracts";
import { useEffect, useRef, useState } from "react";
import { PIN_LENGTH } from "../access/accessSettings";
import { Banner, Button, Money, MoneyField, PermissionNotice, Sheet, SupervisorApproval, type KeypadKey } from "../components/system";
import { useIdempotencyKey, useOpenTabsOf, usePosShift, type OpenTabs } from "../hooks/usePosData";
import { orderName } from "../lib/orderNumber";
import { orderPlaceWords } from "../lib/words";
import type { RosterEntry } from "../lib/deviceAuth";
import { formatMoney } from "../lib/money";
import { useHoldIdleLock } from "../lib/useHoldIdleLock";
import type { POSShift } from "../lib/posContracts";
import { toMinor } from "../lib/posMoney";
import { closeShiftProblem, countOutcome, openTabsWords } from "./cashWords";
import { useRateLimitWait } from "../lib/useRateLimitWait";
import { rememberClosedShift } from "./closedShift";
import { NoteCounterSheet, denominationsFor, moneyFieldText } from "./NoteCounterSheet";

const OUTCOME = {
  balanced: { tone: "success", words: "Balanced. The drawer matches what Yetu expects." },
  over: { tone: "warning", words: "Over. You counted more than Yetu expects." },
  short: { tone: "warning", words: "Short. You counted less than Yetu expects." },
} as const;

const APPROVAL_REASON = {
  revealed: "The count changed after Yetu showed its figure, so a manager must approve this close.",
  yetu: "Yetu found a difference the till didn't see, so a manager must approve this close.",
} as const;

/**
 * Close the shift in three steps. Count: blind, the expected figure is not on
 * screen until a count is entered. Check: Yetu's expected figure against the
 * count, Balanced, Over or Short; when they differ a different manager
 * approves with their PIN, as the backend requires (CloseShift: any variance
 * needs pos.report.manager from someone else). Done: closing takes the till
 * to Open shift, which shows the result Yetu returned.
 */
/** The close button when tabs go over: what pressing it does. */
function handOverButtonWords(count: number): string {
  if (count === 0) return "Hand over and close";
  return count === 1 ? "Hand over 1 tab and close" : `Hand over ${count} tabs and close`;
}

export function CloseShiftSheet(props: Omit<CloseShiftSheetViewProps, "onClose" | "onRefreshShift" | "openTabs">) {
  const { close } = usePosShift();
  // S17b: the shift's tabs still open go to the next shift when it closes.
  const openTabs = useOpenTabsOf(props.shift.id);
  const approvers = useApprovers();
  const closeKey = useIdempotencyKey();
  const queryClient = useQueryClient();
  // The lock waits (within its bound) while the close is with Yetu: the mutation's own status.
  useHoldIdleLock(close.isPending);
  return (
    <CloseShiftSheetView
      {...props}
      approvers={approvers}
      openTabs={openTabs}
      onClose={(args) => close.mutateAsync({ ...args, idempotencyKey: closeKey.next() })}
      // The shift query refetches as usePosData already does after cash in or out ("pos", "shift").
      onRefreshShift={() => queryClient.invalidateQueries({ queryKey: ["pos", "shift"] })}
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
  /** F-249: Yetu's approvers here; null until it answers, and then everyone is offered. */
  approvers?: readonly POSApprover[] | null;
  /** S17b: the shift's tabs still open, and what they owe: closing hands them over to the next shift. */
  openTabs: OpenTabs;
  /** Closes the shift with Yetu and returns the closed shift it sends back. */
  onClose: (args: { countedCashMinor: number; supervisorStaffId?: string; supervisorPin?: string; handOver?: boolean }) => Promise<POSShift>;
  /** Gets the shift from Yetu again; its new figures arrive through `shift`. */
  onRefreshShift?: () => Promise<unknown>;
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
  approvers = null,
  openTabs,
  onClose,
  onRefreshShift,
  initialCounted = "",
  initialStep = "count",
}: CloseShiftSheetViewProps) {
  const varianceChoice = supervisorChoice(roster, approvers, "SHIFT_VARIANCE");
  const [step, setStep] = useState<"count" | "check">(initialStep);
  const [checkVisit, setCheckVisit] = useState(0);
  const checkHeading = useRef<HTMLHeadingElement>(null);
  const [counted, setCounted] = useState(initialCounted);
  const [noteCounter, setNoteCounter] = useState(false);
  const [supervisorId, setSupervisorId] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  // Why this close needs a manager even when the count now matches: the Check
  // already showed a difference (so the count could be matched to the figure
  // on screen), or Yetu found one the till didn't see. It holds for the rest
  // of this close.
  const [approvalRequired, setApprovalRequired] = useState<"revealed" | "yetu" | null>(() => {
    const initialMinor = toMinor(initialCounted);
    return initialStep === "check" && initialMinor !== null && countOutcome(initialMinor, shift.expectedCashMinor) !== "balanced"
      ? "revealed"
      : null;
  });
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // The last refusal: after "too many attempts" the next close waits for Yetu's Retry-After.
  const [refused, setRefused] = useState<unknown>(null);
  // A 403 shows as a permission notice.
  const refusedKind = closeShiftProblem(refused)?.kind ?? null;
  const waiting = useRateLimitWait(refused, () => {
    setRefused(null);
    setProblem(null);
  });
  const [refreshing, setRefreshing] = useState(false);
  // Yetu found open tabs this till didn't know of (another till's order on this shift): hand them over too, when asked.
  const [handOverFound, setHandOverFound] = useState(false);
  const handOver = openTabs.count > 0 || handOverFound;

  const countedMinor = toMinor(counted);
  const outcome = countedMinor === null ? null : countOutcome(countedMinor, shift.expectedCashMinor);
  const needsSupervisor = outcome !== "balanced" || approvalRequired !== null;
  // Choosing yourself keeps the PIN keypad closed (SupervisorApproval), and choosing anyone clears the PIN,
  // so a full PIN always belongs to someone else; the backend refuses self-approval as well.
  const supervisor = supervisorId;
  const approved = Boolean(supervisor) && pin.length === PIN_LENGTH;
  const ready = countedMinor !== null && (!needsSupervisor || approved) && !pending && !waiting;

  /**
   * An approval is for one count, seen on one Check. Leaving the Check clears
   * the chosen supervisor and the PIN, and the count can only be changed on
   * the Count step, so a changed count always needs a fresh approval.
   */
  function backToCount() {
    setSupervisorId(null);
    setPin("");
    setStep("count");
  }

  function showCheck() {
    if (countedMinor === null) return;
    if (countOutcome(countedMinor, shift.expectedCashMinor) !== "balanced") {
      setApprovalRequired((reason) => reason ?? "revealed");
    }
    setStep("check");
    setCheckVisit((visit) => visit + 1);
  }

  // Focus follows the step: on the Check, its heading, never the Close shift button.
  useEffect(() => {
    if (checkVisit > 0) checkHeading.current?.focus();
  }, [checkVisit]);

  function onPinKey(key: KeypadKey) {
    if (key === "delete") setPin((value) => value.slice(0, -1));
    else if (key === "clear") setPin("");
    else if (/^\d$/.test(key)) setPin((value) => (value.length < PIN_LENGTH ? value + key : value));
  }

  async function submit() {
    if (!ready || countedMinor === null) return;
    setPending(true);
    setProblem(null);
    setRefused(null);
    const withSupervisor = needsSupervisor && supervisor !== null;
    try {
      const result = await onClose({
        countedCashMinor: countedMinor,
        ...(withSupervisor ? { supervisorStaffId: supervisor, supervisorPin: pin } : {}),
        ...(handOver ? { handOver: true } : {}),
      });
      rememberClosedShift({ shift: result, currency, at: new Date() });
      onOpenChange(false);
    } catch (error) {
      const refusal = closeShiftProblem(error);
      setRefused(error);
      setPin("");
      if (refusal?.kind === "supervisor") setApprovalRequired("yetu");
      if (refusal?.kind === "supervisor" && !withSupervisor) {
        // The till saw a balanced drawer but Yetu's figure differs: get it
        // again and show the difference before anyone is asked to approve.
        setProblem("Yetu's figure changed since this screen opened, so a manager must approve the difference.");
        setRefreshing(true);
        try {
          await onRefreshShift?.();
        } finally {
          setRefreshing(false);
        }
      } else {
        setProblem(refusal?.words ?? "The shift couldn't be closed. Try again.");
      }
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
        // While the close is with Yetu, Escape, Close and a tap outside do nothing.
        onOpenChange={(next) => {
          if (!next && (pending || refreshing)) return;
          onOpenChange(next);
        }}
        title="Close the shift"
        footer={
          // Separate keys: the button pressed for Check is never reused as Close shift,
          // so a double click or a second Enter can't close the shift.
          step === "count" ? (
            <div key="count-actions" className="y-cash__footer">
              <Button variant="quiet" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button variant="primary" size={56} disabled={countedMinor === null} onClick={showCheck}>
                Check the count
              </Button>
            </div>
          ) : (
            <div key="check-actions" className="y-cash__footer">
              <Button variant="quiet" disabled={pending} onClick={backToCount}>
                Change the count
              </Button>
              <Button variant="primary" size={64} data-testid="close-shift" disabled={!ready} onClick={() => void submit()}>
                {pending ? "Closing…" : handOver ? handOverButtonWords(openTabs.count) : "Close shift"}
              </Button>
            </div>
          )
        }
      >
        {steps}
        <div className="y-form">
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
              <h3 ref={checkHeading} tabIndex={-1} className="y-cash__step-title">
                Check the count
              </h3>
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
            </div>
          )}
          {/* Always in the page, so screen readers announce the result when it appears. */}
          <div role="status" aria-live="polite" data-testid="close-outcome">
            {step === "check" && refreshing ? (
              <Banner inline tone="info" live={false}>
                Getting Yetu's latest figure…
              </Banner>
            ) : step === "check" && outcome ? (
              <Banner inline tone={OUTCOME[outcome].tone} live={false}>
                {OUTCOME[outcome].words}
              </Banner>
            ) : null}
          </div>
          {step === "check" ? (
            <>
              {outcome === "balanced" && approvalRequired && !refreshing ? (
                <p className="y-cash__muted" data-testid="close-approval-reason">
                  {APPROVAL_REASON[approvalRequired]}
                </p>
              ) : null}
              {needsSupervisor && !refreshing ? (
                <SupervisorApproval
                  request={`Close the shift with ${formatMoney(countedMinor, currency)} counted. Yetu expects ${formatMoney(shift.expectedCashMinor, currency)}.`}
                  supervisors={varianceChoice.supervisors}
                  emptyWords={varianceChoice.emptyWords}
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
              {openTabs.count > 0 ? (
                // Money owed changes hands: each tab going over is listed, as a till's close-out lists open checks.
                <section className="y-cash__tabs" aria-labelledby="close-tabs-title">
                  <h4 id="close-tabs-title" className="y-cash__tabs-title">
                    Going to the next shift
                  </h4>
                  <p className="y-cash__muted" data-testid="close-open-tabs">
                    {openTabsWords(openTabs.count, openTabs.owedMinor, currency)}
                  </p>
                  {openTabs.tabs?.length ? (
                    <ul className="y-cash__tabs-list" data-testid="close-tabs-list">
                      {openTabs.tabs.map((tab) => (
                        <li key={tab.id}>
                          <span>
                            {orderName(tab)}
                            {tab.tableLabel || tab.serviceType !== "DINE_IN" ? ` · ${orderPlaceWords(tab.serviceType, tab.tableLabel)}` : ""}
                          </span>
                          <Money minor={tab.remainingMinor} currency={currency} />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </section>
              ) : null}
              {refusedKind === "open-orders" && !handOverFound ? (
                <Button
                  variant="secondary"
                  size={56}
                  data-testid="close-hand-over-found"
                  disabled={pending}
                  onClick={() => {
                    setHandOverFound(true);
                    setRefused(null);
                    setProblem("They'll be handed over to the next shift. Close the shift to hand them over.");
                  }}
                >
                  Hand them over to the next shift
                </Button>
              ) : null}
              {problem && refusedKind === "permission" ? (
                <div data-testid="close-shift-error">
                  <PermissionNotice live words={problem} />
                </div>
              ) : problem ? (
                <p key={problem + String(pending)} className="y-pin__message" role="alert" data-testid="close-shift-error">
                  {problem}
                </p>
              ) : null}
            </>
          ) : null}
        </div>
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
