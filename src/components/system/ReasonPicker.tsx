import { useId, useState } from "react";
import { Field } from "./fields";

/** The choice that opens the box to type. */
const OTHER = "other";

/**
 * "Why", in one tap (the owner, 2026-10-20: staff shouldn't have to think of
 * the words). The reasons are the place's named list (ordersSettings,
 * cashSettings); "Another reason" opens a box to type. What is chosen goes to
 * Yetu as the reason, in the same words, so history and reports read as they
 * did when reasons were typed.
 *
 * Test ids: `${testIdPrefix}-${index}` for a listed reason,
 * `${testIdPrefix}-other` for another reason, `${testIdPrefix}-text` for its box.
 */
export function ReasonPicker({
  label,
  reasons,
  onChange,
  initialReason = "",
  otherHint,
  testIdPrefix,
  labelledBy,
}: {
  /** Shown above the choices, unless the sheet's own heading names them (labelledBy). */
  label: string;
  reasons: readonly string[];
  /** The reason as it stands: a listed one, what is typed, or "" for nothing yet. */
  onChange: (reason: string) => void;
  /** Fixtures and resumed sheets start on a reason. */
  initialReason?: string;
  /** Where the typed reason is kept, in words. */
  otherHint?: string;
  testIdPrefix: string;
  /** The id of a heading the sheet already shows for this choice. */
  labelledBy?: string;
}) {
  const ownLabelId = useId();
  const labelId = labelledBy ?? ownLabelId;
  const listed = reasons.includes(initialReason);
  const [choice, setChoice] = useState<string | null>(listed ? initialReason : initialReason ? OTHER : null);
  const [typed, setTyped] = useState(listed ? "" : initialReason);
  // The box takes the focus when a tap opens it, not when a sheet starts on it.
  const [openedByTap, setOpenedByTap] = useState(false);

  function choose(option: string) {
    setChoice(option);
    if (option === OTHER) {
      setOpenedByTap(true);
      onChange(typed.trim());
    } else {
      onChange(option);
    }
  }

  return (
    <div className="y-reasons">
      {labelledBy ? null : (
        <span className="y-field__label" id={labelId}>
          {label}
        </span>
      )}
      <div role="radiogroup" aria-labelledby={labelId} className="y-reasons__choices">
        {[...reasons, OTHER].map((option, index) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={choice === option}
            className="y-reason"
            data-testid={option === OTHER ? `${testIdPrefix}-other` : `${testIdPrefix}-${index}`}
            onClick={() => choose(option)}
          >
            {option === OTHER ? "Another reason" : option}
          </button>
        ))}
      </div>
      {choice === OTHER ? (
        <Field
          label="The reason"
          hint={otherHint}
          value={typed}
          onChange={(text) => {
            setTyped(text);
            onChange(text.trim());
          }}
          maxLength={500}
          autoComplete="off"
          autoFocus={openedByTap}
          data-testid={`${testIdPrefix}-text`}
        />
      ) : null}
    </div>
  );
}
