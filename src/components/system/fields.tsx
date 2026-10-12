import { CircleAlert, Search, X } from "lucide-react";
import { useId, type InputHTMLAttributes } from "react";
import { currencySymbol } from "../../lib/money";
import { toMinor } from "../../lib/posMoney";
import { cn } from "../../lib/utils";

function describedBy(...ids: Array<string | false | undefined>): string | undefined {
  const joined = ids.filter(Boolean).join(" ");
  return joined || undefined;
}

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Help in words, shown under the label. */
  hint?: string;
  /** What is wrong and how to fix it, in words. */
  error?: string;
  errorTestId?: string;
}

/** A labelled text field. Its hint and its error are read with it. */
export function Field({ label, value, onChange, hint, error, errorTestId, className, id, ...props }: FieldProps) {
  const autoId = useId();
  const inputId = id ?? `field-${autoId}`;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  return (
    <div className={cn("y-field", className)}>
      <label className="y-field__label" htmlFor={inputId}>
        {label}
      </label>
      {hint ? (
        <p className="y-field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      <input
        id={inputId}
        className="y-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(hintId, errorId)}
        {...props}
      />
      {error ? (
        <p className="y-field__error" id={errorId} data-testid={errorTestId}>
          <CircleAlert aria-hidden="true" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Search that is always there. Typing filters; the clear button empties it. */
export function SearchField({
  label,
  value,
  onChange,
  placeholder,
  size = 48,
  className,
  inputProps,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  size?: 48 | 56;
  className?: string;
  inputProps?: InputHTMLAttributes<HTMLInputElement>;
}) {
  return (
    <div className={cn("y-search", `y-search--${size}`, className)}>
      <Search className="y-search__icon" aria-hidden="true" />
      <input
        type="search"
        className="y-input y-search__input"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        {...inputProps}
      />
      {value ? (
        <button
          type="button"
          className="y-button y-button--quiet y-button--48 y-icon-button y-search__clear"
          aria-label="Clear the search"
          onClick={() => onChange("")}
        >
          <X aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

/**
 * An amount typed in the currency's main unit ("42500" for TSh 42,500). The
 * parent keeps the text; `onValueChange` also hands back the minor-unit amount
 * Peak expects (null when the text is not an amount).
 */
export function MoneyField({
  label,
  currency,
  value,
  onValueChange,
  hint,
  error,
  className,
  id,
}: {
  label: string;
  currency: string;
  value: string;
  onValueChange: (value: string, minor: number | null) => void;
  hint?: string;
  error?: string;
  className?: string;
  id?: string;
}) {
  const autoId = useId();
  const inputId = id ?? `money-${autoId}`;
  const unitId = `${inputId}-unit`;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  return (
    <div className={cn("y-field", "y-money-field", className)}>
      <label className="y-field__label" htmlFor={inputId}>
        {label}
      </label>
      {hint ? (
        <p className="y-field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      <div className="y-money-field__box">
        <span className="y-money-field__unit" id={unitId}>
          {currencySymbol(currency)}
        </span>
        <input
          id={inputId}
          className="y-input y-money-field__input"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(event) => {
            const text = event.target.value.replace(/[^\d.]/g, "");
            onValueChange(text, toMinor(text));
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(unitId, hintId, errorId)}
        />
      </div>
      {error ? (
        <p className="y-field__error" id={errorId}>
          <CircleAlert aria-hidden="true" />
          {error}
        </p>
      ) : null}
    </div>
  );
}
