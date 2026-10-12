import { Check } from "lucide-react";
import { useMemo, useState } from "react";
import { Banner, Button, Sheet, Stepper } from "../components/system";
import { formatMoney } from "../lib/money";
import type { POSCatalogProduct, POSModifierGroup } from "../lib/posContracts";
import { cn } from "../lib/utils";

/** A group is met when its count of choices is within the catalog's limits (as before: min, and max when set). */
function groupMet(group: POSModifierGroup, chosen: ReadonlySet<string>): boolean {
  const count = (group.options ?? []).filter((option) => chosen.has(option.id)).length;
  return count >= group.minSelect && (group.maxSelect == null || count <= group.maxSelect);
}

/** The group's rule in words: Choose 1, Choose 1 to 3, Choose at least 1, Up to 2, Optional. */
function ruleWords(group: POSModifierGroup): string {
  const { minSelect: min, maxSelect: max } = group;
  if (min > 0) {
    if (max === min) return `Choose ${min}`;
    return max != null ? `Choose ${min} to ${max}` : `Choose at least ${min}`;
  }
  return max != null ? `Up to ${max}` : "Optional";
}

/**
 * Options for an item: required choices first, then optional ones, then the
 * quantity, then Add. The catalog's limits hold exactly as before: a group
 * that allows one choice swaps it, and Add waits until every group is within
 * its limits. The figure on Add is the catalog's price and the options' extra
 * prices for this quantity, before VAT, as on the menu tiles; the order's
 * figures come from Yetu.
 */
export function OptionsSheet({
  product,
  currency,
  onCancel,
  onAdd,
  pending = false,
  error = null,
}: {
  product: POSCatalogProduct;
  currency: string | undefined;
  onCancel: () => void;
  onAdd: (choice: { quantity: number; modifierOptionIds: string[] }) => void;
  pending?: boolean;
  /** Why adding didn't work, said here as well as on the ticket behind. */
  error?: string | null;
}) {
  const groups = useMemo(() => {
    const active = (product.modifierGroups ?? []).filter((group) => group.isActive !== false);
    return [...active.filter((group) => group.minSelect > 0), ...active.filter((group) => group.minSelect <= 0)];
  }, [product.modifierGroups]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [quantity, setQuantity] = useState(1);
  const ready = groups.every((group) => groupMet(group, chosen));

  const extras = groups
    .flatMap((group) => group.options ?? [])
    .filter((option) => chosen.has(option.id))
    .reduce((sum, option) => sum + option.priceDeltaMinor, 0);
  const figure = (product.priceMinor + extras) * quantity;

  function toggle(group: POSModifierGroup, optionId: string) {
    setChosen((current) => {
      const next = new Set(current);
      if (group.maxSelect === 1) {
        for (const option of group.options ?? []) next.delete(option.id);
        next.add(optionId);
        return next;
      }
      if (next.has(optionId)) next.delete(optionId);
      else next.add(optionId);
      return next;
    });
  }

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={product.name}
      description={`${formatMoney(product.priceMinor, currency)} before options`}
      testId="modifier-dialog"
      footer={
        <div className="y-options__footer">
          <Button variant="quiet" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size={56}
            data-testid="modifier-confirm-add"
            disabled={!ready || pending}
            onClick={() => onAdd({ quantity, modifierOptionIds: Array.from(chosen) })}
          >
            {`Add to order · ${formatMoney(figure, currency)}`}
          </Button>
        </div>
      }
    >
      <div className="y-options">
        {groups.map((group) => {
          const rule = ruleWords(group);
          const count = (group.options ?? []).filter((option) => chosen.has(option.id)).length;
          const over = group.maxSelect != null && count > group.maxSelect;
          const single = group.maxSelect === 1;
          return (
            <div
              key={group.id}
              role="group"
              aria-label={`${group.name}, ${rule.charAt(0).toLowerCase()}${rule.slice(1)}`}
              data-option-group=""
              className="y-options__group"
            >
              <div className="y-options__head">
                <span className="y-options__name">{group.name}</span>
                <span className={cn("y-options__rule", over && "y-options__rule--over", group.minSelect > 0 && "y-options__rule--required")}>
                  {over ? `${rule}. Take one off.` : rule}
                </span>
              </div>
              <div className="y-options__list">
                {(group.options ?? [])
                  .filter((option) => option.isAvailable !== false)
                  .map((option) => {
                    const on = chosen.has(option.id);
                    return (
                      <button
                        key={option.id}
                        type="button"
                        role={single ? "radio" : "checkbox"}
                        aria-checked={on}
                        data-testid={`modifier-option-${option.id}`}
                        className="y-options__option"
                        onClick={() => toggle(group, option.id)}
                      >
                        <span className="y-options__tick" aria-hidden="true">
                          {on ? <Check /> : null}
                        </span>
                        <span className="y-options__label">{option.name}</span>
                        {option.priceDeltaMinor !== 0 ? (
                          <span className="y-options__price">+{formatMoney(option.priceDeltaMinor, currency)}</span>
                        ) : null}
                      </button>
                    );
                  })}
              </div>
            </div>
          );
        })}
        <div className="y-options__quantity">
          <span className="y-options__name">Quantity</span>
          <Stepper label={product.name} value={quantity} onChange={setQuantity} min={1} />
        </div>
        {error ? (
          <Banner inline tone="danger">
            {error}
          </Banner>
        ) : null}
      </div>
    </Sheet>
  );
}
