import { useMemo, useState } from "react";
import { Icon } from "./Icon";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "./ui/sheet";
import { formatMinor } from "../lib/posMoney";

interface ModifierOption { id:string;name:string;priceDeltaMinor:number;isAvailable?:boolean }
interface ModifierGroup { id:string;name:string;minSelect:number;maxSelect?:number|null;isActive?:boolean;options?:ModifierOption[] }
interface ModifierProduct { id:string;name:string;priceMinor:number;modifierGroups?:ModifierGroup[] }

export interface ModifierSelection {
  productId: string;
  quantity: number;
  modifierOptionIds: string[];
}

function groupIsSatisfied(group: ModifierGroup, chosen: Set<string>): boolean {
  const count = (group.options ?? []).filter((option) => chosen.has(option.id)).length;
  return count >= group.minSelect && (group.maxSelect == null || count <= group.maxSelect);
}

/**
 * Required groups (minSelect >= 1) must be satisfied before "Add" is
 * enabled. React returns selection IDs only; the Rust transaction core owns
 * modifier validation and every committed money calculation.
 */
export function ItemModifierDialog({
  product,
  currency,
  onCancel,
  onConfirm,
}: {
  product: ModifierProduct;
  currency: string;
  onCancel: () => void;
  onConfirm: (selection: ModifierSelection) => void;
}) {
  const groups = product.modifierGroups?.filter((g) => g.isActive !== false) ?? [];
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [quantity, setQuantity] = useState(1);

  const unmet = useMemo(() => groups.filter((group) => !groupIsSatisfied(group, chosen)), [groups, chosen]);

  function toggle(group: ModifierGroup, optionId: string): void {
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
    <Sheet open onOpenChange={(open) => !open && onCancel()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        data-testid="modifier-dialog"
        aria-modal="true"
        className="terminal-sheet w-[min(460px,100vw)] max-w-none gap-0 sm:max-w-[460px]"
      >
        <header className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-5">
          <div>
            <SheetTitle className="text-base text-[var(--foreground)]">{product.name}</SheetTitle>
            <SheetDescription className="mt-1 font-mono text-xs tabular-nums text-[var(--foreground-muted)]">
              Base {formatMinor(product.priceMinor, currency)} · final price calculated securely
            </SheetDescription>
          </div>
          <button
            data-testid="modifier-dialog-close"
            onClick={onCancel}
            className="grid size-11 place-items-center rounded-md text-[var(--foreground-muted)] hover:bg-[var(--surface-interactive)]"
            aria-label="Close"
          >
            <Icon name="x" size={16} />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {groups.map((group) => (
            <div key={group.id}>
              <div className="flex items-baseline justify-between">
                <span className="text-[12px] font-semibold text-[var(--color-text-primary)]">{group.name}</span>
                <span className="text-[11px] text-[var(--color-text-muted)]">
                  {group.minSelect > 0 ? `Choose ${group.minSelect}${group.maxSelect ? `–${group.maxSelect}` : "+"}` : "Optional"}
                </span>
              </div>
              <div className="mt-2 grid gap-2">
                {(group.options ?? [])
                  .filter((option) => option.isAvailable !== false)
                  .map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      data-testid={`modifier-option-${option.id}`}
                      onClick={() => toggle(group, option.id)}
                      aria-pressed={chosen.has(option.id)}
                      className={`flex min-h-12 w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm ${
                        chosen.has(option.id)
                          ? "border-[var(--gold-accent)] bg-[var(--gold-subtle)] text-[var(--foreground)]"
                          : "border-[var(--border)] bg-[var(--surface-interactive)] text-[var(--foreground)] hover:border-[var(--border-strong)]"
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
          <div className="flex items-center justify-between border-t border-[var(--border)] pt-5">
            <span className="text-sm font-medium text-[var(--foreground-muted)]">Quantity</span>
            <span className="flex items-center gap-2">
              <button className="qty-btn" onClick={() => setQuantity((q) => Math.max(1, q - 1))} aria-label="Decrease quantity">
                −
              </button>
              <span className="w-8 text-center font-mono text-sm tabular-nums">{quantity}</span>
              <button className="qty-btn" onClick={() => setQuantity((q) => q + 1)} aria-label="Increase quantity">
                +
              </button>
            </span>
          </div>
        </div>

        <footer className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-4">
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
              })
            }
            disabled={unmet.length > 0}
            className="btn-primary btn-sm"
          >
            <Icon name="check" size={14} />
            Add to order
          </button>
        </footer>
      </SheetContent>
    </Sheet>
  );
}
