import { BACK_WORDS } from "../lib/words";
import { useState } from "react";
import { Button, Sheet, Stepper } from "../components/system";
import { CASH_DENOMINATIONS, MINOR_PER_MAJOR, formatMoney } from "../lib/money";
import { noteCountMinor } from "./cashWords";

/** The till's notes and coins for a currency (a named setting); none means count one total. */
export function denominationsFor(currency: string | null | undefined): readonly number[] {
  return currency ? (CASH_DENOMINATIONS[currency.trim().toUpperCase()] ?? []) : [];
}

/** A minor-unit amount as the text a money field holds ("25000", or "25000.50"). */
export function moneyFieldText(minor: number): string {
  return minor % MINOR_PER_MAJOR === 0 ? String(minor / MINOR_PER_MAJOR) : (minor / MINOR_PER_MAJOR).toFixed(2);
}

/**
 * Count the drawer note by note: how many of each note and coin, with the
 * total, which then fills the amount. Optional; a person can type the total.
 */
export function NoteCounterSheet({
  open,
  onOpenChange,
  currency,
  onUse,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currency: string;
  onUse: (amountMinor: number) => void;
}) {
  const [counts, setCounts] = useState<Record<number, number>>({});
  const total = noteCountMinor(counts);
  const totalWords = formatMoney(total, currency);

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Count note by note"
      description="How many of each note and coin is in the drawer."
      footer={
        <div className="y-cash__footer">
          <Button variant="quiet" onClick={() => onOpenChange(false)}>
            {BACK_WORDS}
          </Button>
          <Button
            variant="primary"
            size={56}
            onClick={() => {
              onUse(total);
              onOpenChange(false);
            }}
          >
            Use {totalWords}
          </Button>
        </div>
      }
    >
      <ul className="y-notes" aria-label="Notes and coins">
        {denominationsFor(currency).map((denomination) => {
          const label = formatMoney(denomination * MINOR_PER_MAJOR, currency);
          const count = counts[denomination] ?? 0;
          return (
            <li key={denomination} className="y-notes__row">
              <span className="y-notes__label">{label}</span>
              <Stepper
                label={label}
                value={count}
                min={0}
                onChange={(next) => setCounts((current) => ({ ...current, [denomination]: next }))}
              />
              <span className="y-notes__line">{formatMoney(count * denomination * MINOR_PER_MAJOR, currency)}</span>
            </li>
          );
        })}
      </ul>
      <p className="y-notes__total">
        <span>Total</span>
        <span data-testid="note-count-total">{totalWords}</span>
      </p>
    </Sheet>
  );
}
