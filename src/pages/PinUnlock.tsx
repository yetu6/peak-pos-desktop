import { useState } from "react";
import { Icon } from "../components/Icon";
import { useDeviceSession } from "../auth/DeviceSessionProvider";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "OK"] as const;

export function PinUnlock() {
  const { unlock, error, identity } = useDeviceSession();
  const [staffNumber, setStaffNumber] = useState("");
  const [pin, setPin] = useState("");
  const [pending, setPending] = useState(false);
  const till = identity?.terminalName?.trim();

  async function submit(): Promise<void> {
    if (!staffNumber.trim() || pin.length < 4 || pending) return;
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
      className="flex h-screen items-center justify-center bg-[var(--color-pos-sidebar)] p-6"
      data-testid="pin-screen"
    >
      <span className="sr-only" data-testid="shell-state">
        PAIRED_LOCKED
      </span>
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-black/20 p-8">
        <div className="mb-5 flex items-center justify-center gap-2">
          <Icon name="peak-logo" size={24} className="text-[#D4A017]" />
          <span className="font-display text-xl text-white">Peak POS</span>
        </div>
        <h1 className="text-center text-lg font-semibold text-white">Unlock register</h1>
        <p className="mt-1 text-center text-[12px] text-[rgba(255,255,255,0.55)]">
          {till ? till : "Staff number and PIN for this till"}
        </p>
        <label className="mt-5 block text-[11px] font-medium text-[rgba(255,255,255,0.55)]">
          Staff number
        </label>
        <input
          data-testid="staff-number"
          value={staffNumber}
          onChange={(event) => setStaffNumber(event.target.value)}
          className="input mt-1 w-full bg-white/5 text-white"
          autoComplete="off"
        />
        <label className="mt-3 block text-[11px] font-medium text-[rgba(255,255,255,0.55)]">
          PIN
        </label>
        <div
          className="mt-1 flex h-11 items-center justify-center rounded-lg border border-white/10 bg-white/5 font-mono text-lg tracking-[0.4em] text-white"
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
              className="h-12 rounded-lg border border-white/10 text-sm font-medium text-white hover:bg-white/10"
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
          disabled={pending || !staffNumber.trim() || pin.length < 4}
          className="btn-primary mt-5 w-full"
        >
          {pending ? "Unlocking…" : "Unlock"}
        </button>
      </div>
    </div>
  );
}
