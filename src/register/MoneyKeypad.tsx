import { Keypad, type KeypadKey } from "../components/system";
import { keyedOver } from "./moneyEntry";

/**
 * The on-screen keypad for a money (or percent) field, so it can be filled by
 * touch alone: the same pad and the same rule as paying cash (the first key
 * replaces an amount the till filled in). A keyboard still types in the field.
 */
export function MoneyKeypad({
  label,
  value,
  onChange,
  filled = false,
  variant = "money",
  testIdPrefix,
  disabled,
}: {
  label: string;
  value: string;
  /** The text the field holds after the key. */
  onChange: (text: string) => void;
  /** The field still shows an amount the till filled in: the first key replaces it. */
  filled?: boolean;
  variant?: "money" | "decimal";
  testIdPrefix: string;
  disabled?: boolean;
}) {
  return (
    <Keypad
      label={label}
      variant={variant}
      className="y-keypad--compact"
      testIdPrefix={testIdPrefix}
      disabled={disabled}
      onKey={(key: KeypadKey) => onChange(keyedOver(value, key, filled))}
    />
  );
}
