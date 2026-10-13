import { Delete } from "lucide-react";
import type { KeyboardEvent, Ref } from "react";
import { formatMoney, quickCashAmounts } from "../../lib/money";
import { cn } from "../../lib/utils";

export type KeypadKey = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "00" | "clear" | "delete";

const DIGITS: KeypadKey[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

/**
 * One keypad everywhere (PIN, cash, counts), laid out like a phone with 1-2-3
 * on top. A money keypad has 00; a PIN keypad has Clear. Digits typed on a
 * keyboard while the keypad has focus count too.
 */
export function Keypad({
  label,
  onKey,
  variant = "money",
  disabled = false,
  testIdPrefix,
  groupRef,
  className,
}: {
  label: string;
  onKey: (key: KeypadKey) => void;
  variant?: "money" | "pin";
  disabled?: boolean;
  /** Each key gets `${testIdPrefix}-${key}` (e.g. pin-key-7, pin-key-delete). */
  testIdPrefix?: string;
  /** The keypad's group, so a screen can return focus to it. */
  groupRef?: Ref<HTMLDivElement>;
  className?: string;
}) {
  const testId = (key: KeypadKey) => (testIdPrefix ? `${testIdPrefix}-${key}` : undefined);
  const extra: KeypadKey = variant === "pin" ? "clear" : "00";

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    if (/^\d$/.test(event.key)) {
      event.preventDefault();
      onKey(event.key as KeypadKey);
    } else if (event.key === "Backspace") {
      event.preventDefault();
      onKey("delete");
    }
  }

  return (
    <div ref={groupRef} role="group" aria-label={label} className={cn("y-keypad", className)} onKeyDown={onKeyDown}>
      {DIGITS.map((digit) => (
        <button
          key={digit}
          type="button"
          className="y-keypad__key"
          data-testid={testId(digit)}
          disabled={disabled}
          onClick={() => onKey(digit)}
        >
          {digit}
        </button>
      ))}
      <button
        type="button"
        className={cn("y-keypad__key", extra === "clear" && "y-keypad__key--word")}
        data-testid={testId(extra)}
        disabled={disabled}
        onClick={() => onKey(extra)}
      >
        {extra === "clear" ? "Clear" : "00"}
      </button>
      <button type="button" className="y-keypad__key" data-testid={testId("0")} disabled={disabled} onClick={() => onKey("0")}>
        0
      </button>
      <button
        type="button"
        className="y-keypad__key"
        aria-label="Delete the last digit"
        data-testid={testId("delete")}
        disabled={disabled}
        onClick={() => onKey("delete")}
      >
        <Delete aria-hidden="true" />
      </button>
    </div>
  );
}

/** Exact, then the next amounts a guest is likely to hand over. */
export function QuickCash({
  dueMinor,
  currency,
  onPick,
  className,
}: {
  dueMinor: number;
  currency: string;
  onPick: (amountMinor: number) => void;
  className?: string;
}) {
  return (
    <div role="group" aria-label="Quick cash" className={cn("y-quick-cash", className)}>
      <button type="button" className="y-button y-button--secondary y-button--64 y-quick-cash__exact" onClick={() => onPick(dueMinor)}>
        <span>Exact</span>
        <span className="y-quick-cash__amount">{formatMoney(dueMinor, currency)}</span>
      </button>
      {quickCashAmounts(dueMinor, currency).map((amount) => (
        <button
          key={amount}
          type="button"
          className="y-button y-button--secondary y-button--64 y-quick-cash__amount"
          onClick={() => onPick(amount)}
        >
          {formatMoney(amount, currency)}
        </button>
      ))}
    </div>
  );
}
