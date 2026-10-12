import { CircleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDeviceSession } from "../auth/DeviceSessionProvider";
import { AccessLayout } from "../access/AccessLayout";
import { PIN_LENGTH, ROSTER_SEARCH_AFTER } from "../access/accessSettings";
import { offlineReadinessWords, pinNotice } from "../access/accessWords";
import { useNetworkOnline } from "../access/useNetworkOnline";
import { Banner, Button, Field, Keypad, SearchField, type KeypadKey } from "../components/system";
import type { RosterEntry } from "../lib/deviceAuth";
import { isComposing } from "../lib/keyboard";
import type { OfflineEligibilityStatus } from "../lib/offlineAuthorization";

/** The front door of every shift change: who's working, then their PIN. */
export function PinUnlock() {
  const { unlock, error, identity, roster, offlineEligibility } = useDeviceSession();
  const online = useNetworkOnline();
  return (
    <PinUnlockView
      tillName={identity?.terminalName?.trim() || null}
      roster={roster}
      offlineState={offlineEligibility?.state ?? null}
      error={error}
      online={online}
      onUnlock={unlock}
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
  tillName: string | null;
  roster: readonly RosterEntry[];
  offlineState: OfflineEligibilityStatus["state"] | null;
  /** The device session's message after the last attempt or lock. */
  error: string | null;
  online: boolean;
  onUnlock: (staffNumber: string, pin: string) => Promise<void>;
  /** Fixtures and tests start part-way through. */
  initialStaff?: RosterEntry | null;
  initialManual?: boolean;
  initialFailures?: number;
}

export function PinUnlockView({
  tillName,
  roster,
  offlineState,
  error,
  online,
  onUnlock,
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
  const [attempt, setAttempt] = useState<{ staff: string; count: number } | null>(null);
  const keypadRef = useRef<HTMLDivElement>(null);

  const choosing = !selected && !manual;
  const currentStaff = selected?.staffNumber ?? staffNumber.trim();

  // After each attempt that leaves the screen here: an online refusal counts toward the backend's
  // pause rule (offline refusals never do), and focus returns to the keypad for the next try.
  useEffect(() => {
    if (!attempt) return;
    if (pinNotice(error, { failures: 0, manual: false })?.kind === "pin-rejected") {
      setFailures((current) => ({ ...current, [attempt.staff]: (current[attempt.staff] ?? 0) + 1 }));
    }
    keypadRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    // Only a new attempt counts, not a re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  function setPinValue(next: string) {
    pinRef.current = next;
    setPin(next);
  }

  async function submit(pinValue: string) {
    const staff = currentStaff;
    if (!staff) {
      setLocalProblem("Type your staff number first.");
      setPinValue("");
      return;
    }
    setLocalProblem(null);
    setPending(true);
    try {
      await onUnlock(staff, pinValue);
    } finally {
      setPinValue("");
      setPending(false);
      setAttempt((last) => ({ staff, count: (last?.count ?? 0) + 1 }));
    }
  }

  function onKey(key: KeypadKey) {
    if (pendingRef.current) return;
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
  }

  function changePerson() {
    setSelected(null);
    setStaffNumber("");
    setPinValue("");
    setLocalProblem(null);
    setManual(false);
  }

  const notice = pinNotice(error, { failures: failures[currentStaff] ?? 0, manual: !selected });
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
        tillName={tillName}
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
                <span className="y-avatar" aria-hidden="true">
                  {initialsOf(entry.fullName)}
                </span>
                <span className="y-roster__name">{entry.fullName}</span>
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

  return (
    <AccessLayout
      testId="pin-screen"
      title={selected ? "Enter your PIN" : "Sign in with your staff number"}
      tillName={tillName}
      notice={notices}
    >
      <div className="y-pin">
        {selected ? (
          <div className="y-pin__who">
            <span className="y-pin__person">
              <span className="y-avatar" aria-hidden="true">
                {initialsOf(selected.fullName)}
              </span>
              <span className="y-pin__who-name" data-testid="selected-staff-name">
                {selected.fullName}
              </span>
            </span>
            <Button variant="quiet" data-testid="staff-change" onClick={changePerson}>
              Not you?
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
        <Keypad label="PIN" variant="pin" onKey={onKey} disabled={pending} testIdPrefix="pin-key" groupRef={keypadRef} />
        <p className="y-pin__status" role="status">
          {pending ? "Checking your PIN…" : ""}
        </p>
        {problemLine}
        {!selected && sortedRoster.length > 0 ? (
          <Button variant="quiet" data-testid="staff-choose-from-roster" onClick={() => setManual(false)}>
            Choose your name instead
          </Button>
        ) : null}
        {readiness}
      </div>
    </AccessLayout>
  );
}
