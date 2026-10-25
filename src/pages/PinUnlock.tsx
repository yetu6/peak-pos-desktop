import { CircleAlert, UserPlus } from "lucide-react";
import { placeOf, type TillPlace } from "../lib/tillPlace";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDeviceSession, type UnlockOutcome } from "../auth/DeviceSessionProvider";
import { AccessLayout } from "../access/AccessLayout";
import { PIN_LENGTH, ROSTER_SEARCH_AFTER } from "../access/accessSettings";
import { offlineReadinessWords, pinNotice } from "../access/accessWords";
import { rateLimitWords } from "../lib/posErrors";
import { useNetworkOnline } from "../access/useNetworkOnline";
import { Avatar, Banner, Button, Field, Keypad, SearchField, StatusChip, type KeypadKey } from "../components/system";
import type { RosterEntry } from "../lib/deviceAuth";
import { isComposing } from "../lib/keyboard";
import type { OfflineEligibilityStatus } from "../lib/offlineAuthorization";

/** The front door of every shift change: who's working, then their PIN. */
export function PinUnlock() {
  const { unlock, error, identity, roster, offlineEligibility, signInHeldUntil } = useDeviceSession();
  const online = useNetworkOnline();
  return (
    <PinUnlockView
      place={placeOf(identity)}
      roster={roster}
      offlineState={offlineEligibility?.state ?? null}
      error={error}
      online={online}
      onUnlock={unlock}
      heldUntil={signInHeldUntil ?? null}
    />
  );
}

function initialsOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase() || "?";
}

export interface PinUnlockViewProps {
  /** The hotel, the outlet and the till (F-252). */
  place: TillPlace;
  roster: readonly RosterEntry[];
  offlineState: OfflineEligibilityStatus["state"] | null;
  /** The device session's message after the last attempt or lock. */
  error: string | null;
  online: boolean;
  /** `newPin`: with a setup code as `pin`, the PIN the person chose. */
  onUnlock: (staffNumber: string, pin: string, newPin?: string) => Promise<UnlockOutcome | undefined>;
  /** After too many sign-in attempts: when Yetu allows the next one (ms since the epoch). */
  heldUntil?: number | null;
  /** Fixtures and tests start part-way through. */
  initialStaff?: RosterEntry | null;
  initialManual?: boolean;
  initialFailures?: number;
}

/**
 * What the keypad is for now. A new person types the setup code their manager
 * gave them, then chooses their own PIN and types it again; a person typing a
 * setup code on "Enter your PIN" (a list from before they were given one) is
 * taken the same way once Yetu says the code is right.
 */
type PinStep = "pin" | "setup-code" | "choose" | "confirm";

const STEP_TITLE: Record<Exclude<PinStep, "pin">, string> = {
  "setup-code": "Enter the setup code your manager gave you",
  choose: "Choose your own six-digit PIN",
  confirm: "Type it again",
};

export function PinUnlockView({
  place,
  roster,
  offlineState,
  error,
  online,
  onUnlock,
  heldUntil = null,
  initialStaff = null,
  initialManual = false,
  initialFailures = 0,
}: PinUnlockViewProps) {
  const sortedRoster = useMemo(() => [...roster].sort((a, b) => a.fullName.localeCompare(b.fullName)), [roster]);
  const [selected, setSelected] = useState<RosterEntry | null>(initialStaff);
  // Typing a staff number is the person's own choice; with no names to show
  // (the roster still loading, or none) it is the only way in, until the
  // names arrive.
  const [manualChosen, setManual] = useState(initialManual);
  const manual = manualChosen || sortedRoster.length === 0;
  const [staffNumber, setStaffNumber] = useState("");
  const [pin, setPin] = useState("");
  const pinRef = useRef("");
  const [pending, setPendingState] = useState(false);
  // Read by the keypad at once: a tap right after an attempt finishes is never lost to a stale render.
  const pendingRef = useRef(false);
  const setPending = (value: boolean) => {
    pendingRef.current = value;
    setPendingState(value);
  };
  const [query, setQuery] = useState("");
  const [localProblem, setLocalProblem] = useState<string | null>(null);
  const [failures, setFailures] = useState<Record<string, number>>(() =>
    initialStaff && initialFailures ? { [initialStaff.staffNumber]: initialFailures } : {},
  );
  const [attempt, setAttempt] = useState<{ staff: string; count: number; finishing: boolean } | null>(null);
  const [step, setStepState] = useState<PinStep>(initialStaff?.needsSetup ? "setup-code" : "pin");
  // Read at once by a submit that follows a step change, like pendingRef.
  const stepRef = useRef(step);
  const setStep = (next: PinStep) => {
    stepRef.current = next;
    setStepState(next);
  };
  // The setup code and the PIN chosen from it, until both go to Yetu. Never shown.
  const setupCodeRef = useRef("");
  const chosenPinRef = useRef("");
  const keypadRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => Date.now());
  // Read by the keypad and the keyboard at once, like pendingRef.
  const heldRef = useRef(false);
  // The screen looks again when Yetu's wait is over.
  useEffect(() => {
    setNow(Date.now());
    if (heldUntil === null) return;
    const left = heldUntil - Date.now();
    if (left <= 0) return;
    const timer = setTimeout(() => setNow(Date.now()), left);
    return () => clearTimeout(timer);
  }, [heldUntil]);

  const choosing = !selected && !manual;
  const currentStaff = selected?.staffNumber ?? staffNumber.trim();

  // After each attempt that leaves the screen here: an online refusal counts toward the backend's
  // pause rule (offline refusals never do), and focus returns to the keypad for the next try.
  useEffect(() => {
    if (!attempt) return;
    const kind = pinNotice(error, { failures: 0, manual: false })?.kind;
    if (kind === "pin-rejected") {
      setFailures((current) => ({ ...current, [attempt.staff]: (current[attempt.staff] ?? 0) + 1 }));
    }
    // The setup code was refused with the chosen PIN (a new code was issued, or it ran out
    // meanwhile): the chosen PIN goes with it, and the person starts again from the code.
    if (attempt.finishing && (kind === "pin-rejected" || kind === "setup-code-expired")) {
      setupCodeRef.current = "";
      chosenPinRef.current = "";
      setStep("setup-code");
    }
    focusKeypad();
    // Only a new attempt counts, not a re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  // Each step is a new panel (and a new keypad): focus goes to it, as after an attempt.
  const shownStep = useRef(step);
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    focusKeypad();
  }, [step]);

  function focusKeypad() {
    keypadRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }

  function setPinValue(next: string) {
    pinRef.current = next;
    setPin(next);
  }

  function forgetSetup() {
    setupCodeRef.current = "";
    chosenPinRef.current = "";
  }

  async function submit(pinValue: string) {
    const staff = currentStaff;
    if (!staff) {
      setLocalProblem("Type your staff number first.");
      setPinValue("");
      return;
    }
    const at = stepRef.current;
    if (at === "choose") {
      chosenPinRef.current = pinValue;
      setLocalProblem(null);
      setPinValue("");
      setStep("confirm");
      return;
    }
    if (at === "confirm" && pinValue !== chosenPinRef.current) {
      chosenPinRef.current = "";
      setLocalProblem("The two PINs were different. Choose your PIN again.");
      setPinValue("");
      setStep("choose");
      return;
    }
    const finishing = at === "confirm";
    setLocalProblem(null);
    setPending(true);
    let outcome: UnlockOutcome | undefined;
    try {
      outcome = finishing
        ? await onUnlock(staff, setupCodeRef.current, chosenPinRef.current)
        : await onUnlock(staff, pinValue);
    } finally {
      setPinValue("");
      setPending(false);
      setAttempt((last) => ({ staff, count: (last?.count ?? 0) + 1, finishing }));
    }
    if (outcome?.next === "choose-pin") {
      // Yetu says only a right setup code: it goes with the chosen PIN at the end.
      setupCodeRef.current = pinValue;
      setStep("choose");
    } else if (outcome?.next === "choose-again") {
      chosenPinRef.current = "";
      setLocalProblem(outcome.words);
      setStep("choose");
    }
  }

  function onKey(key: KeypadKey) {
    if (pendingRef.current || heldRef.current) return;
    if (key === "delete") return setPinValue(pinRef.current.slice(0, -1));
    if (key === "clear") return setPinValue("");
    if (!/^\d$/.test(key) || pinRef.current.length >= PIN_LENGTH) return;
    const next = pinRef.current + key;
    setPinValue(next);
    if (next.length === PIN_LENGTH) void submit(next);
  }

  // A keyboard types the PIN too, unless the staff number field has focus.
  const onKeyRef = useRef(onKey);
  onKeyRef.current = onKey;
  useEffect(() => {
    if (choosing) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || isComposing(event) || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (/^\d$/.test(event.key)) onKeyRef.current(event.key as KeypadKey);
      else if (event.key === "Backspace") onKeyRef.current("delete");
      else return;
      event.preventDefault();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [choosing]);

  function chooseFromRoster(entry: RosterEntry) {
    setSelected(entry);
    setManual(false);
    setPinValue("");
    setLocalProblem(null);
    forgetSetup();
    setStep(entry.needsSetup ? "setup-code" : "pin");
  }

  function changePerson() {
    setSelected(null);
    setStaffNumber("");
    setPinValue("");
    setLocalProblem(null);
    setManual(false);
    forgetSetup();
    setStep("pin");
  }

  // After too many attempts Yetu says when the next one is allowed: the keypad waits until then.
  const held = heldUntil !== null && now < heldUntil;
  heldRef.current = held;
  const rawNotice = pinNotice(error, { failures: failures[currentStaff] ?? 0, manual: !selected, setup: step !== "pin" });
  // Once the wait is over, "too many attempts" no longer applies.
  const notice = rawNotice?.kind === "sign-in-held" ? (held ? { ...rawNotice, words: rateLimitWords((heldUntil! - now) / 1000, new Date(now)) } : null) : rawNotice;
  const info = notice?.tone === "info" ? notice : null;
  const problem = localProblem ?? (notice && notice.tone !== "info" ? notice.words : null);

  const notices =
    !online || info ? (
      <>
        {!online ? (
          <div data-testid="offline-banner">
            <Banner tone="warning">Working offline. Only cash sales are possible until the connection returns.</Banner>
          </div>
        ) : null}
        {info ? (
          <div data-testid="pin-notice">
            <Banner tone="info">{info.words}</Banner>
          </div>
        ) : null}
      </>
    ) : null;

  const readiness = offlineState ? (
    <p className="y-access__muted" data-testid="offline-authority-state">
      {offlineReadinessWords(offlineState)}
    </p>
  ) : null;

  // A new element for each attempt, so a refusal worded the same as the last is announced again.
  const problemLine = problem ? (
    <p key={`${attempt?.count ?? 0}-${localProblem ? "here" : "session"}`} className="y-pin__message" data-testid="pin-error" role="alert">
      <CircleAlert aria-hidden="true" />
      {problem}
    </p>
  ) : null;

  if (choosing) {
    const needle = query.trim().toLowerCase();
    const shown = needle ? sortedRoster.filter((entry) => entry.fullName.toLowerCase().includes(needle)) : sortedRoster;
    return (
      <AccessLayout
        testId="pin-screen"
        title="Who's working?"
        lede={<p>Tap your name.</p>}
        place={place}
        width="wide"
        notice={notices}
      >
        {sortedRoster.length > ROSTER_SEARCH_AFTER ? (
          <SearchField label="Find your name" placeholder="Find your name" value={query} onChange={setQuery} />
        ) : null}
        <div className="y-roster__scroll">
          <div className="y-roster" data-testid="staff-roster">
            {shown.map((entry) => (
              <button
                key={entry.staffNumber}
                type="button"
                className="y-roster__person"
                data-testid={`roster-entry-${entry.staffNumber}`}
                onClick={() => chooseFromRoster(entry)}
              >
                <Avatar name={entry.fullName} initials={initialsOf(entry.fullName)} />
                <span className="y-roster__name">{entry.fullName}</span>
                {entry.needsSetup ? (
                  <StatusChip tone="info" icon={<UserPlus aria-hidden="true" />} className="y-roster__new">
                    New
                  </StatusChip>
                ) : null}
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <p className="y-access__muted">No one called “{query.trim()}” works here. Use your staff number instead.</p>
          ) : null}
        </div>
        {problemLine}
        <div className="y-access__actions">
          <Button variant="quiet" data-testid="staff-manual-entry" onClick={() => setManual(true)}>
            Use staff number instead
          </Button>
        </div>
        {readiness}
      </AccessLayout>
    );
  }

  const title = step === "pin" ? (selected ? "Enter your PIN" : "Sign in with your staff number") : STEP_TITLE[step];
  const checking =
    step === "confirm" ? "Signing you in…" : step === "setup-code" ? "Checking your setup code…" : "Checking your PIN…";

  return (
    <AccessLayout
      testId="pin-screen"
      title={title}
      lede={step === "choose" ? <p>Six digits only you know. You will sign in with it from now on.</p> : undefined}
      place={place}
      notice={notices}
    >
      <div className="y-pin">
        {selected ? (
          <div className="y-pin__who">
            <span className="y-pin__person">
              <Avatar name={selected.fullName} initials={initialsOf(selected.fullName)} />
              <span className="y-pin__who-name" data-testid="selected-staff-name">
                {selected.fullName}
              </span>
            </span>
            <Button variant="quiet" data-testid="staff-change" onClick={changePerson}>
              Not you?
            </Button>
          </div>
        ) : step !== "pin" ? (
          // Typed by number and choosing a PIN: the number stays as typed, or the person starts again.
          <div className="y-pin__who y-pin__who--manual">
            <Button variant="quiet" data-testid="staff-change" onClick={changePerson}>
              Start again
            </Button>
          </div>
        ) : (
          <div className="y-pin__who y-pin__who--manual">
            <Field
              label="Staff number"
              value={staffNumber}
              onChange={(value) => {
                setStaffNumber(value);
                setLocalProblem(null);
                // Started typing before the names arrived: keep the number entry when they do.
                if (value) setManual(true);
              }}
              data-testid="staff-number"
              inputMode="numeric"
              autoComplete="off"
              className="y-pin__staff-number"
            />
          </div>
        )}
        <div
          className="y-pin__dots"
          data-testid="pin-dots"
          role="img"
          aria-label={`${pin.length} of ${PIN_LENGTH} digits entered`}
        >
          {Array.from({ length: PIN_LENGTH }, (_, index) => (
            <span key={index} className={index < pin.length ? "y-pin__dot y-pin__dot--filled" : "y-pin__dot"} />
          ))}
        </div>
        <Keypad label="PIN" variant="pin" onKey={onKey} disabled={pending || held} testIdPrefix="pin-key" groupRef={keypadRef} />
        <p className="y-pin__status" role="status">
          {pending ? checking : ""}
        </p>
        {problemLine}
        {!selected && step === "pin" && sortedRoster.length > 0 ? (
          <Button variant="quiet" data-testid="staff-choose-from-roster" onClick={() => setManual(false)}>
            Choose your name instead
          </Button>
        ) : null}
        {readiness}
      </div>
    </AccessLayout>
  );
}
