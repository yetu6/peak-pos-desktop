import { useMemo, useState } from "react";
import { Icon } from "./Icon";
import { formatMinor } from "../lib/posMoney";
import type { POSCatalogProduct, POSModifierGroup } from "../lib/posContracts";

export interface ModifierSelection {
  productId: string;
  quantity: number;
  modifierOptionIds: string[];
  /** Display-only preview total; the server re-prices every option from its
   *  current row and that response — never this value — is authoritative. */
  previewUnitPriceMinor: number;
}

function groupIsSatisfied(group: POSModifierGroup, chosen: Set<string>): boolean {
  const count = (group.options ?? []).filter((option) => chosen.has(option.id)).length;
  return count >= group.minSelect && (group.maxSelect == null || count <= group.maxSelect);
}

/**
 * Required groups (minSelect >= 1) must be satisfied before "Add" is
 * enabled. Modifier economics are a preview only — Peak re-prices and
 * snapshots every selected option server-side on addPOSOrderItem.
 */
export function ItemModifierDialog({
  product,
  currency,
  onCancel,
  onConfirm,
}: {
  product: POSCatalogProduct;
  currency: string;
  onCancel: () => void;
  onConfirm: (selection: ModifierSelection) => void;
}) {
  const groups = product.modifierGroups?.filter((g) => g.isActive) ?? [];
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [quantity, setQuantity] = useState(1);

  const unmet = useMemo(() => groups.filter((group) => !groupIsSatisfied(group, chosen)), [groups, chosen]);

  const previewUnitPriceMinor = useMemo(() => {
    const delta = groups
      .flatMap((group) => group.options ?? [])
      .filter((option) => chosen.has(option.id))
      .reduce((sum, option) => sum + option.priceDeltaMinor, 0);
    return product.priceMinor + delta;
  }, [groups, chosen, product.priceMinor]);

  function toggle(group: POSModifierGroup, optionId: string): void {
    setChosen((prev) => {
      const next = new Set(prev);
      const singleSelect = group.maxSelect === 1;
      if (singleSelect) {
        (group.options ?? []).forEach((option) => next.delete(option.id));
        next.add(optionId);
        return next;
      }
      if (next.has(optionId)) next.delete(optionId);
      else next.add(optionId);
      return next;
    });
  }

  return (
    <div className="glass-scrim fixed inset-0 z-50 flex items-center justify-center p-4" data-testid="modifier-dialog">
      <div className="glass-dialog w-full max-w-md p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-[var(--color-text-primary)]">{product.name}</div>
            <div className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
              {formatMinor(previewUnitPriceMinor, currency)} each
            </div>
          </div>
          <button
            data-testid="modifier-dialog-close"
            onClick={onCancel}
            className="rounded-md p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-border-subtle)]"
            aria-label="Close"
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="mt-4 max-h-72 space-y-4 overflow-y-auto">
          {groups.map((group) => (
            <div key={group.id}>
              <div className="flex items-baseline justify-between">
                <span className="text-[12px] font-semibold text-[var(--color-text-primary)]">{group.name}</span>
                <span className="text-[11px] text-[var(--color-text-muted)]">
                  {group.minSelect > 0 ? `Choose ${group.minSelect}${group.maxSelect ? `–${group.maxSelect}` : "+"}` : "Optional"}
                </span>
              </div>
              <div className="mt-2 space-y-1">
                {(group.options ?? [])
                  .filter((option) => option.isAvailable)
                  .map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      data-testid={`modifier-option-${option.id}`}
                      onClick={() => toggle(group, option.id)}
                      className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-[12px] ${
                        chosen.has(option.id)
                          ? "border-[var(--color-gold)] bg-[var(--color-gold)]/10 text-[var(--color-text-primary)]"
                          : "border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:border-[var(--color-border)]"
                      }`}
                    >
                      <span>{option.name}</span>
                      {option.priceDeltaMinor !== 0 && (
                        <span className="font-mono text-[11px] tabular-nums">
                          +{formatMinor(option.priceDeltaMinor, currency)}
                        </span>
                      )}
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between">
          <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">Quantity</span>
          <span className="flex items-center gap-2">
            <button className="qty-btn" onClick={() => setQuantity((q) => Math.max(1, q - 1))} aria-label="Decrease quantity">
              −
            </button>
            <span className="w-6 text-center font-mono text-sm tabular-nums">{quantity}</span>
            <button className="qty-btn" onClick={() => setQuantity((q) => q + 1)} aria-label="Increase quantity">
              +
            </button>
          </span>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} className="btn-tertiary btn-sm">
            Cancel
          </button>
          <button
            data-testid="modifier-confirm-add"
            onClick={() =>
              onConfirm({
                productId: product.id,
                quantity,
                modifierOptionIds: Array.from(chosen),
                previewUnitPriceMinor,
              })
            }
            disabled={unmet.length > 0}
            className="btn-primary btn-sm"
          >
            <Icon name="check" size={14} />
            Add to order
          </button>
        </div>
      </div>
    </div>
  );
}
