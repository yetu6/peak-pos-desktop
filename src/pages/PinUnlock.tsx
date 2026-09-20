import { useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import { useDeviceSession } from "../auth/DeviceSessionProvider";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "OK"] as const;

function initialsOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase() || "?";
}

export function PinUnlock() {
  const { unlock, error, identity, roster, offlineEligibility } = useDeviceSession();
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [staffNumber, setStaffNumber] = useState("");
  const [manualEntry, setManualEntry] = useState(false);
  const [pin, setPin] = useState("");
  const [pending, setPending] = useState(false);
  const till = identity?.terminalName?.trim();

  const sortedRoster = useMemo(
    () => [...roster].sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [roster],
  );

  const staffChosen = staffNumber.trim().length > 0;
  const showingRoster = !manualEntry && !selectedName && sortedRoster.length > 0;

  function chooseFromRoster(entry: { fullName: string; staffNumber: string }): void {
    setSelectedName(entry.fullName);
    setStaffNumber(entry.staffNumber);
    setPin("");
  }

  function changeStaff(): void {
    setSelectedName(null);
    setStaffNumber("");
    setPin("");
    setManualEntry(sortedRoster.length === 0);
  }

  async function submit(): Promise<void> {
    if (!staffChosen || pin.length < 4 || pending) return;
    setPending(true);
    try {
      await unlock(staffNumber.trim(), pin);
    } finally {
      setPin("");
      setPending(false);
    }
  }

  function onKey(key: (typeof KEYS)[number]): void {
    if (key === "⌫") {
      setPin((value) => value.slice(0, -1));
      return;
    }
    if (key === "OK") {
      void submit();
      return;
    }
    setPin((value) => (value.length < 8 ? value + key : value));
  }

  return (
    <div
      className="auth-shell flex h-screen items-center justify-center p-6"
      data-testid="pin-screen"
    >
      <div className={`glass-panel w-full p-8 ${showingRoster ? "max-w-xl" : "max-w-sm"}`}>
        <div className="mb-5 flex items-center justify-center gap-2">
          <Icon name="peak-logo" size={24} className="text-[var(--brass)]" />
          <span className="font-display text-xl text-[var(--foreground)]">Yetu POS</span>
        </div>
        {till && (
          <p
            className="text-center text-[13px] font-medium text-[var(--foreground-muted)]"
            data-testid="till-name"
          >
            {till}
          </p>
        )}
        {offlineEligibility && (
          <p
            className="mt-2 text-center text-[11px] font-medium text-[var(--foreground-muted)]"
            data-testid="offline-authority-state"
          >
            {offlineEligibility.state === "ELIGIBLE"
              ? "Ready for offline PIN if the network drops"
              : offlineEligibility.state === "CATALOG_REQUIRED"
                ? "Online · offline catalog certification pending"
                : "Online · offline authority unavailable"}
          </p>
        )}

        {showingRoster ? (
          <>
            <p className="mt-5 text-center text-sm font-medium text-[var(--foreground)]">
              Who&apos;s using this terminal?
            </p>
            <p className="mt-1 text-center text-[12px] text-[var(--foreground-muted)]">
              Select your name, then enter your PIN
            </p>
            <div
              className="mt-4 grid grid-cols-3 gap-3"
              data-testid="staff-roster"
            >
              {sortedRoster.map((entry) => (
                <button
                  key={entry.staffNumber}
                  data-testid={`roster-entry-${entry.staffNumber}`}
                  onClick={() => chooseFromRoster(entry)}
                  className="flex min-h-[112px] flex-col items-center justify-center gap-2 rounded-[var(--radius-tile)] border border-[var(--border)] bg-[var(--surface-raised)] p-3 transition-colors hover:border-[var(--brass)] hover:bg-[var(--surface-interactive)]"
                >
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--surface-interactive)] text-base font-semibold text-[var(--foreground)]">
                    {initialsOf(entry.fullName)}
                  </span>
                  <span className="text-center text-[13px] font-medium leading-tight text-[var(--foreground)]">
                    {entry.fullName}
                  </span>
                </button>
              ))}
            </div>
            <button
              data-testid="staff-manual-entry"
              onClick={() => setManualEntry(true)}
              className="mt-4 h-11 w-full text-center text-[12px] font-medium text-[var(--foreground-muted)] underline"
            >
              Enter staff number instead
            </button>
          </>
        ) : (
          <>
            {selectedName ? (
              <div className="mt-5 flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-medium text-[var(--foreground-muted)]">
                    Signing in as
                  </p>
                  <p
                    className="text-sm font-semibold text-[var(--foreground)]"
                    data-testid="selected-staff-name"
                  >
                    {selectedName}
                  </p>
                </div>
                <button
                  data-testid="staff-change"
                  onClick={changeStaff}
                  className="text-[12px] font-medium text-[var(--foreground-muted)] underline"
                >
                  Not you?
                </button>
              </div>
            ) : (
              <>
                <label className="mt-5 block text-[11px] font-medium text-[var(--foreground-muted)]">
                  Staff number
                </label>
                <input
                  data-testid="staff-number"
                  value={staffNumber}
                  onChange={(event) => setStaffNumber(event.target.value)}
                  className="input mt-1 w-full bg-[var(--surface-interactive)] text-[var(--foreground)]"
                  autoComplete="off"
                />
                {sortedRoster.length > 0 && (
                  <button
                    data-testid="staff-choose-from-roster"
                    onClick={() => setManualEntry(false)}
                    className="mt-2 text-[12px] font-medium text-[var(--foreground-muted)] underline"
                  >
                    Choose from list instead
                  </button>
                )}
              </>
            )}
            <label className="mt-3 block text-[11px] font-medium text-[var(--foreground-muted)]">
              PIN
            </label>
            <div
              className="mt-1 flex h-11 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-interactive)] font-mono text-lg tracking-[0.4em] text-[var(--foreground)]"
              data-testid="pin-dots"
            >
              {"•".repeat(pin.length) || " "}
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {KEYS.map((key) => (
                <button
                  key={key}
                  data-testid={`pin-key-${key}`}
                  onClick={() => onKey(key)}
                  className="h-12 rounded-lg border border-[var(--border)] text-sm font-medium text-[var(--foreground)] hover:bg-[var(--surface-interactive)]"
                >
                  {key}
                </button>
              ))}
            </div>
            {error && (
              <div className="badge badge-danger mt-4 w-full justify-center" data-testid="pin-error">
                {error}
              </div>
            )}
            <button
              data-testid="pin-unlock"
              onClick={() => void submit()}
              disabled={pending || !staffChosen || pin.length < 4}
              className="btn-primary mt-5 w-full"
            >
              {pending ? "Unlocking…" : "Unlock"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
