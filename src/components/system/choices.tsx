import { Minus, Plus } from "lucide-react";
import { useRef, type KeyboardEvent } from "react";
import { cn } from "../../lib/utils";

export interface Choice<T extends string> {
  value: T;
  label: string;
}

function moveWithArrows<T extends string>(
  event: KeyboardEvent<HTMLElement>,
  values: readonly T[],
  current: T,
  select: (value: T) => void,
  focus: (index: number) => void,
) {
  const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
  const back = event.key === "ArrowLeft" || event.key === "ArrowUp";
  if (!forward && !back && event.key !== "Home" && event.key !== "End") return;
  event.preventDefault();
  const index = values.indexOf(current);
  let next = index;
  if (event.key === "Home") next = 0;
  else if (event.key === "End") next = values.length - 1;
  else next = (index + (forward ? 1 : -1) + values.length) % values.length;
  select(values[next]);
  focus(next);
}

/** One choice from a few (order type, theme). Arrow keys move the choice, like radio buttons. */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  size = 48,
  testIdPrefix,
  disabled = false,
  className,
}: {
  label: string;
  options: readonly Choice<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 48 | 56;
  /** Each option gets `${testIdPrefix}-${value}`. */
  testIdPrefix?: string;
  /** The choice is fixed; the screen says why. */
  disabled?: boolean;
  className?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const values = options.map((option) => option.value);
  return (
    <div role="radiogroup" aria-label={label} className={cn("y-segmented", `y-segmented--${size}`, className)}>
      {options.map((option, index) => {
        const checked = option.value === value;
        // With nothing chosen (a manual display size) the first option is still reachable by Tab.
        const tabStop = checked || (index === 0 && !values.includes(value));
        return (
          <button
            key={option.value}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={tabStop ? 0 : -1}
            data-testid={testIdPrefix ? `${testIdPrefix}-${option.value}` : undefined}
            disabled={disabled}
            className="y-segmented__option"
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => moveWithArrows(event, values, value, onChange, (next) => refs.current[next]?.focus())}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export interface TabItem<T extends string> extends Choice<T> {
  count?: number;
}

/** A row of tabs (menu categories, order lists). The page draws the panel for the open tab. */
export function Tabs<T extends string>({
  label,
  tabs,
  value,
  onChange,
  className,
}: {
  label: string;
  tabs: readonly TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const values = tabs.map((tab) => tab.value);
  return (
    <div role="tablist" aria-label={label} className={cn("y-tabs", className)}>
      {tabs.map((tab, index) => {
        const selected = tab.value === value;
        return (
          <button
            key={tab.value}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className="y-tab"
            onClick={() => onChange(tab.value)}
            onKeyDown={(event) => moveWithArrows(event, values, value, onChange, (next) => refs.current[next]?.focus())}
          >
            {tab.label}
            {tab.count !== undefined ? <span className="y-tab__count">{tab.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** Changes a count by one within its limits. The buttons say what they change. */
export function Stepper({
  label,
  value,
  onChange,
  min = 0,
  max = Number.POSITIVE_INFINITY,
  disabled = false,
  className,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  /** While a change is with Yetu: both buttons wait. */
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div role="group" aria-label={`${label} quantity`} className={cn("y-stepper", className)}>
      <button
        type="button"
        className="y-button y-button--secondary y-button--48 y-icon-button"
        aria-label={`One fewer ${label}`}
        disabled={disabled || value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        <Minus aria-hidden="true" />
      </button>
      <output className="y-stepper__value" aria-live="polite">
        {value}
      </output>
      <button
        type="button"
        className="y-button y-button--secondary y-button--48 y-icon-button"
        aria-label={`One more ${label}`}
        disabled={disabled || value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        <Plus aria-hidden="true" />
      </button>
    </div>
  );
}
